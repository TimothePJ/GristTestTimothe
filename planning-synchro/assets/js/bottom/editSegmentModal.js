// Fenetre « segment mensuel » du plan de charge de planning-synchro
// (#ps-edit-segment-modal). Depuis le passage de TimeSegment au modele « un
// segment = un mois », elle ne fait plus saisir de plage : le mois vient du clic
// sur la piste, la fenetre ne demande que les jours effectivement travailles.
//
// Portee/adaptee de gestion-depenses2 (utils/chargePlanSegmentForm.js
// createChargePlanSaveLock + validateEffectifInput, main.js
// formatChargePlanMonthLabel, syncEditChargePlanDerivedValues,
// setEditChargePlanFormBusy, formatEditSegmentInputValue,
// saveEditedChargePlanSegment) et de l'ancien portage du #edit-segment-modal.
//
// ADAPTATIONS vs la source :
// - Pas de modele `state.projects` / `editingChargePlanSegment` : ce widget est
//   pilote par le DOM, donc l'appelant (chargeEditing.js) passe a `open()` le
//   couple (mois, personne) et l'effectif lus sur la barre rendue ; l'ecriture
//   Grist se fait dans son `onSubmit`.
// - Creation ET edition partagent la meme fenetre : `segmentId: null` = creation.
//   RIEN n'est ecrit tant que l'utilisateur n'a pas valide.
// - Les helpers purs (validation, libelles, verrou) sont exportes et sans DOM
//   (testes sous `node --test`) ; `createEditSegmentModal()` est le controleur
//   DOM, verifie dans le harnais dev.

import { formatNumber, parseOptionalNumberInput } from "../utils/format.js";
import {
  getMonthBounds,
  getMonthAvailableDays,
  getMonthBusinessDays,
} from "../utils/monthSegments.js";
import { computeMonthLoad, formatLoadProjectEntries } from "../utils/monthLoad.js";
import { APP_CONFIG } from "../config.js";

// --- helpers purs (aucun DOM) ------------------------------------------------

function isHalfDayIncrement(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return false;
  }
  return Math.abs(numericValue * 2 - Math.round(numericValue * 2)) < 1e-9;
}

// Un segment mensuel sans effectif ne represente rien : il compterait 0 jour
// partout tout en occupant une ligne. La valeur est donc obligatoire.
export function validateEditSegmentEffectif(rawEffectifValue) {
  const rawEffectifInput = parseOptionalNumberInput(rawEffectifValue);

  if (rawEffectifInput == null || rawEffectifInput <= 0) {
    return { error: "Saisissez un nombre de jours effectifs superieur a 0." };
  }
  if (!isHalfDayIncrement(rawEffectifInput)) {
    return { error: "Le nombre de jours effectifs doit etre un entier ou un multiple de 0,5." };
  }

  return { effectifDays: rawEffectifInput, effectifValueForSave: rawEffectifInput };
}

// « Mars 2026 » a partir d'une cle "YYYY-MM". APP_CONFIG.months est deja sans
// accents, comme le reste des chaines JS du widget.
export function formatSegmentMonthLabel(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ""));
  if (!match) return "";

  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return "";

  const label = APP_CONFIG.months[monthNumber - 1] || "";
  const capitalized = label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "";
  return `${capitalized} ${match[1]}`.trim();
}

// Delai de garde de l'ecriture : au-dela, on considere que la promesse Grist ne
// se reglera jamais (document deconnecte, frame parente disparue, worker bloque).
export const SUBMIT_STALL_TIMEOUT_MS = 30000;

export const SUBMIT_STALL_MESSAGE =
  "L'enregistrement ne repond pas. Fermez la fenetre et rechargez le widget pour verifier si le segment a bien ete enregistre.";

// Verrou d'ecriture de la fenetre. « Enregistrer » n'est dans aucun <form> et
// l'etat « segment en cours » reste null pendant tout l'await d'une creation :
// sans verrou, deux clics rapides produisent deux AddRecord sur le meme
// (projet, personne, mois) — exactement le doublon que la cle unique interdit.
// Il ferme aussi la course « Enregistrer puis Annuler/Echap ».
//
// DEUX ETATS DISTINCTS, et c'est tout l'objet du delai de garde :
//   - `isLocked()`   : une ecriture est partie, aucune autre ne doit partir ;
//   - `blocksClose()`: la fenetre doit rester ouverte le temps de l'aller-retour.
// Si la promesse ne se regle jamais, le `finally` de l'appelant ne s'execute
// jamais et le verrou resterait tenu a vie : la fenetre deviendrait
// indeformable, sans meme Echap. Au bout de `stallTimeoutMs` on relache donc la
// SEULE garde de fermeture (`blocksClose()` retombe a false) ; le verrou de
// soumission, lui, reste tenu — le relacher autoriserait une seconde ecriture
// pendant que la premiere est encore en vol. On debloque l'interface, jamais
// l'ecriture. `setTimer`/`clearTimer` sont injectables pour les tests.
export function createSubmitLock({
  stallTimeoutMs = SUBMIT_STALL_TIMEOUT_MS,
  setTimer = (fn, delay) => setTimeout(fn, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
  onStall = null,
} = {}) {
  let locked = false;
  let stalled = false;
  let timerId = null;

  function cancelTimer() {
    if (timerId != null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  return {
    isLocked: () => locked,
    isStalled: () => stalled,
    // Seule garde consultee par les chemins de fermeture (Fermer, Echap, fond).
    blocksClose: () => locked && !stalled,
    // true si le verrou vient d'etre pris, false s'il etait deja tenu.
    // `overrideStallTimeoutMs` : delai propre a CETTE prise. Le verrou etant
    // partage par toutes les fenetres montees (cf. plus bas), c'est le seul
    // endroit ou une instance peut encore imposer le sien.
    acquire(overrideStallTimeoutMs) {
      if (locked) return false;
      locked = true;
      stalled = false;
      cancelTimer();
      const delay = Number.isFinite(overrideStallTimeoutMs)
        ? overrideStallTimeoutMs
        : stallTimeoutMs;
      if (delay > 0) {
        timerId = setTimer(() => {
          timerId = null;
          stalled = true;
          if (typeof onStall === "function") onStall();
        }, delay);
      }
      return true;
    },
    release() {
      cancelTimer();
      locked = false;
      stalled = false;
    },
  };
}

// Jeton de session de la fenetre, indispensable des lors que le delai de garde
// existe. Passe ce delai, la fenetre redevient fermable PUIS reouvrable, alors
// que l'ecriture d'origine est toujours en vol. Si elle finit par se regler, la
// suite de CE `handleSave` s'executerait sur l'instance de fenetre partagee,
// c'est-a-dire sur le segment que l'utilisateur vient de rouvrir : elle le
// fermerait de force (saisie en cours perdue) ou y afficherait le message
// d'echec perime de la premiere ecriture.
//
// Chaque ouverture ET chaque fermeture ouvrent donc une session neuve : une
// resolution dont le jeton n'est plus le jeton courant ne pilote plus rien. Le
// verrou, lui, est relache dans tous les cas — il appartient a l'ecriture, pas a
// la session, et le retenir interdirait toute ecriture ulterieure.
export function createSubmitSession() {
  let token = 0;

  return {
    current: () => token,
    // Ouverture ou fermeture : tout ce qui etait parti avant devient « tardif ».
    renew: () => (token += 1),
    owns: (candidate) => candidate === token,
  };
}

// --- verrou et session PARTAGES par toutes les fenetres montees --------------
//
// POURQUOI AU NIVEAU MODULE, et pas dans la fermeture de createEditSegmentModal :
// `main.js` appelle `teardown()` a chaque `loadProject()`, ce qui enchaine
// `attachChargeEditing().detach()` -> `editSegmentModal.destroy()` puis une
// re-creation complete. Avec un verrou par instance, ce cycle rendait un verrou
// NEUF alors que l'ecriture precedente etait toujours en vol : l'utilisateur qui
// change de projet puis revient (les 30 s du delai de garde lui en laissent
// largement le temps), rouvre le meme mois et re-enregistre produisait DEUX
// AddRecord sur le meme (projet, personne, mois) — le doublon meme que la cle
// unique interdit. `gestion-depenses2` n'a jamais eu le probleme : ses
// `chargePlanSaveLock`/`chargePlanEditSession` sont des singletons de module.
// Le verrou appartient donc a l'ECRITURE, pas a l'instance de fenetre.
//
// Le delai de garde reste arme apres un `destroy()` : c'est lui, et lui seul,
// qui finira par rendre la fenetre fermable. Ce qui est demonte a l'occasion,
// c'est le CONTROLEUR (retire de `liveControllers`), donc le timer ne retient
// plus aucun noeud DOM mort.
const liveControllers = new Set();

function notifyLiveControllers(hookName) {
  [...liveControllers].forEach((controller) => {
    if (typeof controller?.[hookName] === "function") controller[hookName]();
  });
}

// Point d'abonnement PUBLIC au registre de controleurs vivants de
// `sharedSubmitLock`. Toute fenetre qui reutilise `sharedSubmitLock`/
// `sharedSubmitSession` (ex. bottom/chargeAssignModal.js) DOIT s'abonner ICI
// pour recevoir `onStall`/`onLockStateChanged` — sinon son ecriture peut caler
// ou se resoudre pendant que SEULES les fenetres de segment sont notifiees, ce
// qui desactive son Enregistrer A VIE (defaut corrige en Tache 4, fix round 1 :
// une fenetre de segment qui cale, se ferme, se rouvre ailleurs comme fenetre
// de charge, puis se resout tardivement, ne notifiait jamais cette derniere).
// Renvoie une fonction de desabonnement, a appeler depuis le `destroy()` de
// l'appelant — meme discipline que `liveControllers.delete()` ci-dessous.
export function subscribeToSharedSubmitLock(hooks) {
  liveControllers.add(hooks);
  return () => liveControllers.delete(hooks);
}

// Point de notification PUBLIC du meme registre : toute fenetre abonnee via
// `subscribeToSharedSubmitLock` (pas seulement celle qui vient d'ecrire) doit
// pouvoir prevenir les AUTRES apres avoir pris/rendu le verrou partage —
// sinon le defaut corrige ci-dessus reapparaitrait a l'envers (ecriture de
// charge qui cale, fenetre de charge fermee, fenetre de segment ouverte,
// resolution tardive : sans ce point d'entree, chargeAssignModal.js n'aurait
// aucun moyen de notifier le registre prive de CE module).
export function notifySharedSubmitLockSubscribers(hookName) {
  notifyLiveControllers(hookName);
}

export const sharedSubmitLock = createSubmitLock({
  onStall: () => notifyLiveControllers("onStall"),
});

export const sharedSubmitSession = createSubmitSession();

function formatEditSegmentDayValue(value) {
  const formatted = formatNumber(value);
  return `${formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted} j`;
}

// Legende de la barre de charge mensuelle, dans les termes de la specification.
// Meme texte que gestion-depenses2 (formatChargePlanMonthLoadMessage) : la meme
// charge doit se lire a l'identique dans les deux widgets.
export function formatMonthLoadMessage(load) {
  if (load?.state === "overload") {
    return `SURCHARGE : ${formatEditSegmentDayValue(load.overloadDays)} de trop`;
  }
  if (load?.state === "balanced") {
    return "charge complete";
  }
  return `il reste ${formatEditSegmentDayValue(load?.remainingDays)} avant 100 %`;
}

// Formate un effectif stocke pour le champ nombre (vide si absent, sans zeros
// de queue : 2 affiche "2" et 1.5 affiche "1.5").
export function formatEditSegmentInputValue(value) {
  if (value == null || value === "") {
    return "";
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return "";
  }
  return numericValue
    .toFixed(2)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

// --- controleur DOM (navigateur uniquement) ----------------------------------

// createEditSegmentModal(rootEl, { onSubmit, stallTimeoutMs })
//   -> { open, close, isOpen, destroy }
//
// `open({ segmentId, monthKey, workerName, effectif, absenceSet })` : segmentId
// null = creation, sinon edition. `onSubmit({ segmentId, monthKey, workerName,
// selection })` est appele sur Enregistrer une fois le formulaire valide ; il
// peut renvoyer (une promesse de) { ok: true } pour fermer la fenetre, ou
// { ok: false, error } pour afficher `error` et la laisser ouverte.
// `selection` = { effectifDays, effectifValueForSave }.
// `stallTimeoutMs` : delai au-dela duquel une ecriture qui n'a jamais rendu la
// main cesse de bloquer la fermeture (defaut SUBMIT_STALL_TIMEOUT_MS). Il est
// passe a `acquire()` et non a la construction du verrou : celui-ci est partage
// par toutes les fenetres montees (cf. `sharedSubmitLock`).
// `getAllTimeSegmentRows` : ACCESSEUR (et non un tableau fige) rendant TOUTES les
// lignes TimeSegment, tous projets et tous services confondus, pour la barre de
// charge mensuelle. Un accesseur parce que main.js recharge la table apres chaque
// ecriture (`onChanged`) : un tableau capture a l'attache figerait la barre sur
// l'instantane d'avant la premiere ecriture.
export function createEditSegmentModal(
  rootEl,
  { onSubmit, stallTimeoutMs, getAllTimeSegmentRows, resolveProjectLabel } = {}
) {
  if (!(rootEl instanceof HTMLElement)) {
    return { open() {}, close() {}, isOpen: () => false, destroy() {} };
  }

  const monthLabelEl = rootEl.querySelector("#ps-edit-segment-month-label");
  const workerLabelEl = rootEl.querySelector("#ps-edit-segment-worker-label");
  const effectifInput = rootEl.querySelector("#ps-edit-segment-effectif");
  const calculatedEl = rootEl.querySelector("#ps-edit-segment-calculated-days");
  const feedbackEl = rootEl.querySelector("#ps-edit-segment-feedback");
  const saveBtn = rootEl.querySelector("#ps-edit-segment-save");
  const cancelBtn = rootEl.querySelector("#ps-edit-segment-cancel");
  // Barre de charge mensuelle (charge TOTALE de la personne sur le mois).
  const loadEl = rootEl.querySelector("#ps-edit-segment-load");
  const loadTrackEl = rootEl.querySelector("#ps-edit-segment-load-track");
  const loadFillEl = rootEl.querySelector("#ps-edit-segment-load-fill");
  const loadDaysEl = rootEl.querySelector("#ps-edit-segment-load-days");
  const loadMessageEl = rootEl.querySelector("#ps-edit-segment-load-message");
  // Liste « Deja engage ce mois-ci » : le detail par projet du chiffre porte
  // par la barre.
  const loadProjectsEl = rootEl.querySelector("#ps-edit-segment-load-projects");
  const loadProjectsListEl = rootEl.querySelector("#ps-edit-segment-load-projects-list");

  let currentSegmentId = null;
  let currentMonthKey = "";
  let currentWorkerName = "";
  let currentAbsenceSet = new Set();
  // Verrou et session PARTAGES (niveau module) : ils survivent au
  // destroy()/re-creation declenche par un changement de projet, sans quoi une
  // ecriture encore en vol pourrait etre doublee. Cf. `sharedSubmitLock`.
  const saveLock = sharedSubmitLock;
  const session = sharedSubmitSession;
  // L'ecriture n'a jamais rendu la main : on rend la fenetre fermable et on
  // l'explique, mais Enregistrer reste desactive (le verrou, lui, tient).
  // Le verrou etant partage, il previent TOUS les controleurs encore montes.
  const controllerHooks = {
    onStall: () => {
      setFeedback(SUBMIT_STALL_MESSAGE);
      applyLockStateToUi();
    },
    onLockStateChanged: () => {
      // Le verrou vient d'etre rendu : le message « l'enregistrement ne repond
      // pas » est devenu faux alors que le formulaire redevient utilisable. On
      // ne retire QUE ce message-la — jamais une erreur de validation, jamais la
      // saisie d'une autre session (ce serait le defaut B a l'envers).
      if (!saveLock.isStalled() && getFeedback() === SUBMIT_STALL_MESSAGE) {
        setFeedback("");
      }
      applyLockStateToUi();
    },
  };
  const unsubscribeFromSharedSubmitLock = subscribeToSharedSubmitLock(controllerHooks);

  function setFeedback(message) {
    if (!(feedbackEl instanceof HTMLElement)) return;
    const text = String(message || "").trim();
    feedbackEl.textContent = text;
    feedbackEl.hidden = !text;
  }

  function getFeedback() {
    return feedbackEl instanceof HTMLElement ? feedbackEl.textContent : "";
  }

  // Toutes les lignes TimeSegment, tous projets et tous services confondus.
  // La barre raisonne sur la PERSONNE : lui passer les seuls segments du projet
  // affiche lui ferait montrer une disponibilite qui n'existe pas. Le tri (mois,
  // nom, segment edite) revient a computeMonthLoad.
  function readAllSegmentRows() {
    if (typeof getAllTimeSegmentRows !== "function") return [];
    const rows = getAllTimeSegmentRows();
    return Array.isArray(rows) ? rows : [];
  }

  // Barre de charge du mois : charge TOTALE de la personne sur le mois de la
  // fenetre, tous projets et tous services confondus, saisie en cours comprise.
  // Le calcul est entierement porte par utils/monthLoad.js (module vendorise,
  // identique octet pour octet avec celui de gestion-depenses2) : on ne fait ici
  // que le nourrir et le rendre.
  // Liste construite par API DOM et non par innerHTML : les noms de projet
  // viennent de Grist, donc d'une saisie utilisateur. textContent ferme la
  // question de l'echappement au lieu de la deplacer dans un helper.
  function renderLoadProjects(byProject) {
    if (!(loadProjectsEl instanceof HTMLElement)) return;

    const entries = formatLoadProjectEntries(byProject, resolveProjectLabel);
    // Mois libre : on masque la section au lieu de laisser un titre sans liste.
    loadProjectsEl.hidden = entries.length === 0;

    if (!(loadProjectsListEl instanceof HTMLElement)) return;
    loadProjectsListEl.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement("li");
        item.className = "ps-segment-edit-load-project";

        const name = document.createElement("span");
        name.className = "ps-segment-edit-load-project-name";
        name.textContent = entry.label;

        const days = document.createElement("strong");
        days.className = "ps-segment-edit-load-project-days";
        days.textContent = formatEditSegmentDayValue(entry.days);

        item.append(name, days);
        return item;
      })
    );
  }

  function renderMonthLoadBar() {
    if (!(loadEl instanceof HTMLElement)) return null;

    // Fenetre fermee ou mois illisible : rien a montrer. On efface au lieu de
    // laisser les chiffres de la session precedente a l'ecran.
    if (!getMonthBounds(currentMonthKey)) {
      loadEl.hidden = true;
      loadEl.classList.remove("is-partial");
      loadEl.classList.remove("is-balanced");
      loadEl.classList.remove("is-overload");
      if (loadFillEl instanceof HTMLElement) {
        loadFillEl.style.width = "0%";
        // Barre vide : le plancher `min-width` du CSS ferait sinon apparaitre
        // une pastille de 14 px alors qu'il n'y a rien a montrer.
        loadFillEl.hidden = true;
      }
      if (loadDaysEl instanceof HTMLElement) loadDaysEl.textContent = "--";
      if (loadMessageEl instanceof HTMLElement) loadMessageEl.textContent = "";
      if (loadTrackEl instanceof HTMLElement) loadTrackEl.setAttribute("aria-valuenow", "0");
      renderLoadProjects([]);
      return null;
    }

    const load = computeMonthLoad({
      monthKey: currentMonthKey,
      personName: currentWorkerName,
      allSegmentRows: readAllSegmentRows(),
      columns: APP_CONFIG.grist.columns.timeSegment,
      absenceSet: currentAbsenceSet instanceof Set ? currentAbsenceSet : null,
      // EDITION : sans cet id, l'effectif deja stocke du segment ouvert
      // s'ajouterait a ce que l'utilisateur tape et le mois serait compte deux
      // fois. CREATION : aucune ligne n'existe encore, `currentSegmentId` est
      // null et rien n'est ecarte.
      excludeSegmentId: currentSegmentId,
      draftEffectif: effectifInput instanceof HTMLInputElement ? effectifInput.value : null,
    });

    // `ratio` est deja borne par le module ; ce clamp-ci garantit qu'une barre en
    // surcharge SATURE a 100 % au lieu de deborder de son conteneur.
    const fillPercent = Math.min(1, Math.max(0, load.ratio)) * 100;

    loadEl.hidden = false;
    loadEl.classList.toggle("is-partial", load.state === "partial");
    loadEl.classList.toggle("is-balanced", load.state === "balanced");
    loadEl.classList.toggle("is-overload", load.state === "overload");

    if (loadFillEl instanceof HTMLElement) {
      loadFillEl.style.width = `${fillPercent}%`;
      // Voir la regle `.ps-segment-edit-load-fill[hidden]` : le plancher de
      // largeur ne doit pas ressusciter le remplissage a 0 j.
      loadFillEl.hidden = fillPercent <= 0;
    }
    if (loadDaysEl instanceof HTMLElement) {
      loadDaysEl.textContent = `${formatEditSegmentDayValue(
        load.totalDays
      )} / ${formatEditSegmentDayValue(load.availableDays)}`;
    }
    if (loadMessageEl instanceof HTMLElement) {
      loadMessageEl.textContent = formatMonthLoadMessage(load);
    }
    if (loadTrackEl instanceof HTMLElement) {
      loadTrackEl.setAttribute("aria-valuenow", String(Math.round(fillPercent)));
    }
    renderLoadProjects(load.byProject);

    return load;
  }

  // Le mois ne se saisit plus : ne restent derives que les jours disponibles du
  // mois (absences deduites), le signalement « au-dela du disponible » et la
  // barre de charge mensuelle.
  function syncDerived() {
    if (!getMonthBounds(currentMonthKey)) {
      if (effectifInput instanceof HTMLInputElement) {
        effectifInput.removeAttribute("max");
        effectifInput.classList.remove("is-over-available");
      }
      if (calculatedEl instanceof HTMLElement) calculatedEl.textContent = "--";
      renderMonthLoadBar();
      return;
    }

    const available = getMonthAvailableDays(currentMonthKey, currentAbsenceSet);
    if (calculatedEl instanceof HTMLElement) {
      calculatedEl.textContent = formatEditSegmentDayValue(available);
    }
    if (effectifInput instanceof HTMLInputElement) {
      effectifInput.max = String(getMonthBusinessDays(currentMonthKey));
      const effectifValue = Number(effectifInput.value);
      const over =
        effectifInput.value !== "" && Number.isFinite(effectifValue) && effectifValue > available;
      effectifInput.classList.toggle("is-over-available", over);
    }

    // Meme point d'accroche que « Jours disponibles » : la barre se recalcule
    // donc a chaque frappe (handleFieldInput -> syncDerived), sans ecouteur
    // supplementaire a maintenir.
    renderMonthLoadBar();
  }

  function open({ segmentId, monthKey, workerName, effectif, absenceSet } = {}) {
    // Une ecriture est en cours : ne pas ecraser le contexte sous ses pieds.
    // Apres expiration du delai de garde on laisse rouvrir : mieux vaut
    // rafficher le message d'echec que laisser le clic sans aucune reponse.
    if (saveLock.blocksClose()) return;

    // Nouvelle session : une ecriture encore en vol ne parle plus de ce segment.
    session.renew();
    currentSegmentId = segmentId != null && segmentId !== "" ? segmentId : null;
    currentMonthKey = String(monthKey || "");
    currentWorkerName = String(workerName || "").trim();
    currentAbsenceSet = absenceSet instanceof Set ? absenceSet : new Set();

    if (monthLabelEl instanceof HTMLElement) {
      monthLabelEl.textContent = formatSegmentMonthLabel(currentMonthKey);
    }
    if (workerLabelEl instanceof HTMLElement) {
      workerLabelEl.textContent = currentWorkerName;
    }
    if (effectifInput instanceof HTMLInputElement) {
      effectifInput.value = formatEditSegmentInputValue(effectif);
    }

    syncDerived();
    setFeedback(saveLock.isStalled() ? SUBMIT_STALL_MESSAGE : "");
    applyLockStateToUi();
    rootEl.style.display = "flex";
    rootEl.classList.add("is-open");
  }

  // Fermeture demandee par l'utilisateur (Fermer, Echap, clic hors fenetre) :
  // refusee tant que l'ecriture n'est pas terminee — mais PLUS refusee une fois
  // le delai de garde expire, sinon la fenetre serait indeformable a vie.
  function close() {
    if (saveLock.blocksClose()) return;
    closeNow();
  }

  function closeNow() {
    // Fermer clot la session : ce qui se reglera apres n'a plus rien a fermer.
    session.renew();
    currentSegmentId = null;
    currentMonthKey = "";
    currentWorkerName = "";
    currentAbsenceSet = new Set();
    rootEl.style.display = "none";
    rootEl.classList.remove("is-open");
    setFeedback("");
    // `currentMonthKey` vient d'etre vide : la barre s'efface (chiffres, teinte,
    // largeur). Sans cet appel, la fenetre rouverte sur un AUTRE mois montrerait
    // la charge du precedent pendant la fraction de seconde precedant la frappe.
    renderMonthLoadBar();
  }

  function isOpen() {
    return rootEl.classList.contains("is-open");
  }

  // Une seule source de verite pour l'etat visuel : Enregistrer suit le VERROU
  // (donc reste desactive apres expiration du delai de garde, l'ecriture etant
  // toujours en vol), Fermer suit la GARDE DE FERMETURE (donc redevient
  // cliquable a l'expiration).
  function applyLockStateToUi() {
    const busy = saveLock.isLocked();
    const blocking = saveLock.blocksClose();
    rootEl.classList.toggle("is-submitting", blocking);
    rootEl.classList.toggle("is-stalled", busy && !blocking);
    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = busy;
    if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = blocking;
  }

  async function handleSave() {
    if (!isOpen()) return;
    if (saveLock.isLocked()) {
      if (saveLock.isStalled()) setFeedback(SUBMIT_STALL_MESSAGE);
      return;
    }

    if (!getMonthBounds(currentMonthKey)) {
      setFeedback("Mois introuvable pour ce segment.");
      return;
    }

    const effectifResult = validateEditSegmentEffectif(effectifInput?.value);
    if (effectifResult.error) {
      setFeedback(effectifResult.error);
      return;
    }

    if (typeof onSubmit !== "function") {
      closeNow();
      return;
    }

    // Verrou pose AVANT le premier await, relache dans le finally. `acquire()`
    // arme au passage le delai de garde : si la promesse Grist ne se regle
    // jamais, ce finally n'arrivera pas et c'est lui qui rendra la main.
    if (!saveLock.acquire(stallTimeoutMs)) return;
    // Jeton de la session pour laquelle cette ecriture part : apres expiration
    // du delai de garde, la fenetre a pu etre fermee puis rouverte sur un autre
    // segment avant que la promesse ne se regle.
    const submitToken = session.current();
    applyLockStateToUi();
    setFeedback("");

    let result;
    try {
      result = await onSubmit({
        segmentId: currentSegmentId,
        monthKey: currentMonthKey,
        workerName: currentWorkerName,
        selection: {
          effectifDays: effectifResult.effectifDays,
          effectifValueForSave: effectifResult.effectifValueForSave,
        },
      });
    } catch (error) {
      console.error("Erreur enregistrement segment (fenetre) :", error);
      // Rejet tardif : le message d'echec de CETTE ecriture n'a plus rien a dire
      // de ce que l'utilisateur est en train de saisir.
      if (session.owns(submitToken)) {
        setFeedback("Une erreur est survenue pendant l'enregistrement du segment.");
      }
      return;
    } finally {
      saveLock.release(); // desarme aussi le delai de garde
      // Le verrou est partage : toutes les fenetres montees doivent voir
      // Enregistrer redevenir cliquable, pas seulement celle qui a ecrit.
      notifyLiveControllers("onLockStateChanged");
    }

    // Resolution tardive d'une session abandonnee : le verrou vient d'etre rendu
    // (ci-dessus), mais on ne ferme rien de force et on n'ecrase aucun message.
    if (!session.owns(submitToken)) return;

    if (result && result.ok === false) {
      setFeedback(result.error || "L'enregistrement du segment a echoue.");
      return;
    }
    closeNow();
  }

  function handleSaveClick(event) {
    event.preventDefault();
    // `handleSave` avale deja les erreurs de l'ecriture elle-meme, mais tout ce
    // qui leve AVANT son `try` (validation, libelles, DOM disparu) partirait en
    // rejet non gere. Meme enveloppe que gestion-depenses2.
    handleSave().catch((error) => {
      console.error("Erreur enregistrement segment (fenetre) :", error);
      setFeedback("Une erreur est survenue pendant l'enregistrement du segment.");
    });
  }

  function handleCancelClick(event) {
    event.preventDefault();
    close();
  }

  function handleBackdropClick(event) {
    if (event.target === rootEl) {
      close();
    }
  }

  function handleFieldInput() {
    // Le message d'ecriture bloquee doit survivre a la saisie : il est la seule
    // explication de l'etat, et l'utilisateur ne peut de toute facon plus valider.
    if (!saveLock.isStalled()) setFeedback("");
    syncDerived();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && isOpen()) {
      close();
    }
  }

  saveBtn?.addEventListener("click", handleSaveClick);
  cancelBtn?.addEventListener("click", handleCancelClick);
  rootEl.addEventListener("click", handleBackdropClick);
  effectifInput?.addEventListener("input", handleFieldInput);
  effectifInput?.addEventListener("change", handleFieldInput);
  document.addEventListener("keydown", handleKeyDown);

  function destroy() {
    // `closeNow()` renouvelle la session : une ecriture encore en vol ne pilotera
    // pas la fenetre que `attachChargeEditing()` va recreer juste apres.
    closeNow();
    // Le controleur est demonte, PAS le verrou : le relacher ici rendrait un
    // verrou neuf a la fenetre recreee alors que l'ecriture est toujours en vol,
    // et deux AddRecord partiraient sur la meme cle metier. On se contente de
    // retirer ce controleur des destinataires, si bien que le delai de garde
    // encore arme ne retient plus aucun noeud DOM mort.
    unsubscribeFromSharedSubmitLock();
    saveBtn?.removeEventListener("click", handleSaveClick);
    cancelBtn?.removeEventListener("click", handleCancelClick);
    rootEl.removeEventListener("click", handleBackdropClick);
    effectifInput?.removeEventListener("input", handleFieldInput);
    effectifInput?.removeEventListener("change", handleFieldInput);
    document.removeEventListener("keydown", handleKeyDown);
  }

  return { open, close, isOpen, destroy };
}
