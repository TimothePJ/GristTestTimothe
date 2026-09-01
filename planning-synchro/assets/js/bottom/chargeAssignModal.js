// Fenetre « assigner la charge de reference » du plan de charge de
// planning-synchro (#ps-charge-assign-modal). Ouverte depuis le bouton
// [data-charge-assign-open] de la ligne Charge (Tache 3), elle deplie les
// documents de Planning_Projet par type puis par zone puis par document, et
// laisse saisir les trois niveaux de la cascade (Task 1, bottom/documentCharge.js) :
//   Duree_Projet  -> ecrit sur TOUTES les lignes du type
//   Duree_Zone    -> ecrit sur toutes les lignes du type, dans cette zone
//   Duree_Force   -> ecrit sur la ligne visee, et elle seule
//
// Cette fenetre ne fait AUCUNE ecriture Grist : elle rend, collecte les
// intentions de l'utilisateur, et les remet a `onSubmit(writes)`. C'est la
// Tache 5 (services/gristService.js, updatePlanningDurations) qui ecrit.
//
// Modele du fichier : bottom/editSegmentModal.js. Meme decoupage — helpers
// purs exportes et testes (tests/chargeAssignModal.test.mjs) en tete de
// fichier, controleur DOM (createChargeAssignModal) en fin de fichier. Le
// verrou de soumission N'EST PAS reimplemente ici : `sharedSubmitLock` /
// `sharedSubmitSession` / `SUBMIT_STALL_TIMEOUT_MS` / `SUBMIT_STALL_MESSAGE`
// / `subscribeToSharedSubmitLock` / `notifySharedSubmitLockSubscribers` sont
// importes tels quels d'editSegmentModal.js (meme lot de defauts a eviter :
// double-clic -> deux lots d'ecriture, promesse Grist qui ne se regle jamais
// -> fenetre indeformable, ET, depuis fix round 1, resolution tardive qui ne
// notifiait que les fenetres de segment) — voir la note "VERROU PARTAGE" plus
// bas pour la seule piece que ce fichier reimplemente malgre tout (un timer
// local, pas un registre de controleurs).
//
// PORTEE DES CHAMPS, EN UN COUP D'OEIL (verifie contre plus d'une zone dans
// les tests) :
//   - Duree_Projet d'un bloc TYPE s'ecrit sur CHAQUE ligne de ce type, quelle
//     que soit sa zone.
//   - Duree_Zone d'un bloc ZONE s'ecrit sur chaque ligne de CE type, dans
//     CETTE zone seulement — les autres zones du meme type restent intactes.
//   - Duree_Force d'une ligne DOCUMENT ne touche que cette ligne.
// Vider un champ ecrit "" (jamais 0, qui pour la cascade est une valeur
// legitime a un autre niveau — cf. documentCharge.js) : "" rend la main au
// niveau du dessus.

import { computeProjectCharge, isDocumentRow, resolveDocumentCharge } from "./documentCharge.js";
import { toText } from "../utils/dates.js";
import { parseOptionalNumberInput } from "../utils/format.js";
import {
  formatEditSegmentInputValue,
  sharedSubmitLock,
  sharedSubmitSession,
  SUBMIT_STALL_TIMEOUT_MS,
  SUBMIT_STALL_MESSAGE,
  subscribeToSharedSubmitLock,
  notifySharedSubmitLockSubscribers,
} from "./editSegmentModal.js";

// --- helpers purs (aucun DOM) -------------------------------------------------

// Lecture BRUTE d'une duree a UN niveau precis (pas la cascade resolue) :
// vide/nulle/negative/non-numerique -> null. Copie volontaire de la regle
// privee `readDuration` de documentCharge.js (meme comportement, virgule
// francaise comprise) : ce fichier ne doit pas etre modifie (cf. brief), et
// cette regle n'y est pas exportee. Duplication d'une fonction de 5 lignes,
// pas d'une logique metier — le seul cout d'un contrat prive.
function readRawDuration(value) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function firstNonNull(values) {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

// Meme regle que le `toText` prive et non exporte de documentCharge.js
// (String(value).trim() simple, sans deballage d'objet Reference/Choice) —
// utilisee UNIQUEMENT pour Type_doc/Zone, qui servent de cle de jointure avec
// les divergences de computeProjectCharge (elle-meme construite avec cette
// meme regle simple, en interne). Le `toText` de utils/dates.js (utilise
// ailleurs dans ce fichier, ex. ID2/libelle) deballe label/name d'un objet :
// les deux textes divergeraient sur une colonne Reference/Choice et la cle de
// jointure ne matcherait plus rien, faisant disparaitre SILENCIEUSEMENT la
// banniere de divergence (brief fix round 1, minor). Latent aujourd'hui
// (Type_doc/Zone sont des colonnes Texte/Choix dans ce projet) : on fige la
// convention avant qu'elle ne derive plutot que d'attendre qu'elle le fasse.
function joinKeyText(value) {
  return value == null ? "" : String(value).trim();
}

// Etiquette d'un document dans la fenetre : le nom de tache si disponible
// (Taches, repli Tache), sinon son ID2.
function documentLabel(row, cols) {
  return toText(row?.[cols.taskName]) || toText(row?.[cols.taskNameAlt]) || toText(row?.[cols.id2]);
}

// buildChargeTree(planningRows, columns)
//   -> [{ typeDoc, value, divergent, divergentIds,
//         zones: [{ zone, value, inherited, divergent, divergentIds,
//                    documents: [{ id, id2, label, value, inherited }] }] }]
//
// Un noeud par type de document (ordre d'apparition dans `planningRows`), un
// noeud par zone A L'INTERIEUR de ce type (meme ordre), une entree par
// document a l'interieur de cette zone. `value`/`divergent`/`divergentIds`
// REUTILISENT le calcul de divergence de Task 1 (`computeProjectCharge` ->
// `divergences`) : la majorite ("kept") et les ecarts y sont deja calcules,
// les recalculer ici les ferait tot ou tard deriver l'un de l'autre.
//
// `value` d'un document est la charge RESOLUE (resolveDocumentCharge, la
// cascade Force > Zone > Projet) : c'est ce que l'utilisateur doit voir a cote
// de ce document, qu'il vienne de son propre Duree_Force ou d'un niveau
// au-dessus. `inherited` (zone/document) dit si CE niveau a sa propre valeur
// ou s'il affiche celle du niveau au-dessus, grisee dans la fenetre.
export function buildChargeTree(planningRows, columns) {
  const cols = columns || {};
  const rows = Array.isArray(planningRows) ? planningRows : [];

  const documents = rows
    .filter((row) => isDocumentRow(row, cols))
    .map((row) => ({
      row,
      id: row?.[cols.id],
      id2: toText(row?.[cols.id2]),
      typeDoc: joinKeyText(row?.[cols.typeDoc]),
      zone: joinKeyText(row?.[cols.zone]),
      label: documentLabel(row, cols),
    }));

  // Divergences de Task 1, indexees pour un acces direct par cle de groupe.
  const { divergences } = computeProjectCharge(rows, cols);
  const typeDivergenceByKey = new Map();
  const zoneDivergenceByKey = new Map();
  divergences.forEach((entry) => {
    if (entry.scope === "project") typeDivergenceByKey.set(entry.typeDoc, entry);
    if (entry.scope === "zone") zoneDivergenceByKey.set(`${entry.typeDoc}|${entry.zone}`, entry);
  });

  const typeOrder = [];
  const byType = new Map();
  documents.forEach((doc) => {
    if (!byType.has(doc.typeDoc)) {
      byType.set(doc.typeDoc, []);
      typeOrder.push(doc.typeDoc);
    }
    byType.get(doc.typeDoc).push(doc);
  });

  return typeOrder.map((typeDoc) => {
    const docsOfType = byType.get(typeDoc);
    const typeDivergence = typeDivergenceByKey.get(typeDoc) || null;
    // Groupe non divergent : par construction toutes les valeurs non-nulles
    // du groupe sont identiques (sinon computeProjectCharge l'aurait signale)
    // — la premiere suffit donc, pas besoin de refaire le calcul de majorite.
    const typeValue = typeDivergence
      ? typeDivergence.kept
      : firstNonNull(docsOfType.map((doc) => readRawDuration(doc.row?.[cols.dureeProjet])));

    const zoneOrder = [];
    const byZone = new Map();
    docsOfType.forEach((doc) => {
      if (!byZone.has(doc.zone)) {
        byZone.set(doc.zone, []);
        zoneOrder.push(doc.zone);
      }
      byZone.get(doc.zone).push(doc);
    });

    const zones = zoneOrder.map((zone) => {
      const docsOfZone = byZone.get(zone);
      const zoneDivergence = zoneDivergenceByKey.get(`${typeDoc}|${zone}`) || null;
      const ownZoneValue = zoneDivergence
        ? zoneDivergence.kept
        : firstNonNull(docsOfZone.map((doc) => readRawDuration(doc.row?.[cols.dureeZone])));
      const zoneInherited = ownZoneValue == null;
      const zoneValue = zoneInherited ? typeValue : ownZoneValue;

      const documentsOut = docsOfZone.map((doc) => {
        const ownForce = readRawDuration(doc.row?.[cols.dureeForce]);
        return {
          id: doc.id,
          id2: doc.id2,
          label: doc.label,
          value: resolveDocumentCharge(doc.row, cols),
          inherited: ownForce == null,
        };
      });

      return {
        zone,
        value: zoneValue,
        inherited: zoneInherited,
        divergent: Boolean(zoneDivergence),
        divergentIds: zoneDivergence ? zoneDivergence.others.map((entry) => entry.id2) : [],
        documents: documentsOut,
      };
    });

    return {
      typeDoc,
      value: typeValue,
      divergent: Boolean(typeDivergence),
      divergentIds: typeDivergence ? typeDivergence.others.map((entry) => entry.id2) : [],
      zones,
    };
  });
}

// collectChargeWrites(tree, planningRows, columns) -> [{ recordId, fields }]
//
// `tree` a la FORME de buildChargeTree, mais avec une semantique differente
// pour `value` : ici, `value` dit ce qu'il faut ECRIRE, pas ce qu'il faut
// AFFICHER.
//   - `value == null` (jamais touche par l'utilisateur)   -> rien n'est ecrit
//     a ce niveau.
//   - `value === ""` (champ vide explicitement)            -> ecrit "" (rend
//     la main au niveau du dessus).
//   - `value` = un nombre                                  -> ecrit ce nombre.
// Le controleur DOM ne repasse donc QUE les niveaux reellement edites par
// l'utilisateur, jamais l'arbre entier tel qu'affiche — sinon rouvrir la
// fenetre et cliquer Enregistrer sans rien toucher re-ecrirait chaque ligne du
// projet avec sa propre valeur actuelle, un lot enorme pour rien.
//
// `planningRows` est relu independamment de `tree` : un bloc TYPE/ZONE peut
// n'avoir aucun document dans l'arbre passe (les tests unitaires en donnent
// souvent une version allegee) alors que la portee de l'ecriture (« toutes
// les lignes du type », « toutes les lignes de cette zone ») se lit dans les
// VRAIES lignes du projet.
export function collectChargeWrites(tree, planningRows, columns) {
  const cols = columns || {};
  const rows = Array.isArray(planningRows) ? planningRows : [];

  const documents = rows
    .filter((row) => isDocumentRow(row, cols))
    .map((row) => ({
      id: row?.[cols.id],
      typeDoc: joinKeyText(row?.[cols.typeDoc]),
      zone: joinKeyText(row?.[cols.zone]),
    }));

  const writes = [];

  (Array.isArray(tree) ? tree : []).forEach((typeNode) => {
    const typeDoc = joinKeyText(typeNode?.typeDoc);

    if (typeNode?.value !== null && typeNode?.value !== undefined) {
      documents
        .filter((doc) => doc.typeDoc === typeDoc)
        .forEach((doc) => writes.push({ recordId: doc.id, fields: { [cols.dureeProjet]: typeNode.value } }));
    }

    (Array.isArray(typeNode?.zones) ? typeNode.zones : []).forEach((zoneNode) => {
      const zone = joinKeyText(zoneNode?.zone);

      if (zoneNode?.value !== null && zoneNode?.value !== undefined) {
        documents
          .filter((doc) => doc.typeDoc === typeDoc && doc.zone === zone)
          .forEach((doc) => writes.push({ recordId: doc.id, fields: { [cols.dureeZone]: zoneNode.value } }));
      }

      (Array.isArray(zoneNode?.documents) ? zoneNode.documents : []).forEach((docNode) => {
        if (docNode?.value !== null && docNode?.value !== undefined) {
          writes.push({ recordId: docNode.id, fields: { [cols.dureeForce]: docNode.value } });
        }
      });
    });
  });

  return writes;
}

// Message de divergence en tete de bloc, forme de la brief : « 4 lignes
// divergent sur COFFRAGE (1021, 1031, …) ». `label` est le type de document
// (bloc TYPE) ou la zone (bloc ZONE).
// Au-dela de ce nombre d'IDs divergents, la liste est tronquee ("...") : un
// type a 40 lignes divergentes n'a pas besoin des 40 dans l'en-tete de bloc.
const DIVERGENCE_IDS_SHOWN_MAX = 5;

function formatDivergenceMessage(label, divergentIds) {
  const ids = Array.isArray(divergentIds) ? divergentIds : [];
  const count = ids.length;
  const shown = ids.slice(0, DIVERGENCE_IDS_SHOWN_MAX);
  const idsText = shown.join(", ") + (count > DIVERGENCE_IDS_SHOWN_MAX ? ", ..." : "");
  // Accord sujet/verbe : "1 ligne diverge" (singulier), "4 lignes divergent"
  // (pluriel) — le texte hardcodait "divergent" meme au singulier.
  const verb = count > 1 ? "divergent" : "diverge";
  return `${count} ligne${count > 1 ? "s" : ""} ${verb} sur ${label} (${idsText})`;
}

// Valeur d'un champ nombre : vide si null/undefined, sinon formatee sans zero
// de queue (reprend formatEditSegmentInputValue d'editSegmentModal.js — meme
// convention d'affichage partout dans le widget).
function formatChargeValue(value) {
  return value == null ? "" : formatEditSegmentInputValue(value);
}

// --- controleur DOM (navigateur uniquement) -----------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDivergenceBanner(label, node) {
  if (!node?.divergent) return "";
  return `<p class="ps-charge-assign-divergence">${escapeHtml(
    formatDivergenceMessage(label, node.divergentIds)
  )}</p>`;
}

// Champ de saisie d'un niveau. `original` porte la valeur RENDUE (vide si
// heritee) : c'est a elle que le controleur compare la saisie courante pour
// decider si le champ a reellement ete touche (cf. handleFieldChange) — sans
// ca, un champ herite jamais ouvert par l'utilisateur ecrirait quand meme "".
function renderField({ scope, typeDoc, zone, docId, value, inherited }) {
  const shown = inherited ? "" : formatChargeValue(value);
  const placeholder = inherited && value != null ? `${formatChargeValue(value)} (herite)` : "—";
  const dataAttrs = [
    `data-scope="${escapeHtml(scope)}"`,
    typeDoc != null ? `data-type-doc="${escapeHtml(typeDoc)}"` : "",
    zone != null ? `data-zone="${escapeHtml(zone)}"` : "",
    docId != null ? `data-doc-id="${escapeHtml(String(docId))}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <input
      type="number" min="0.5" step="0.5"
      class="ps-charge-assign-input"
      ${dataAttrs}
      data-original="${escapeHtml(shown)}"
      value="${escapeHtml(shown)}"
      placeholder="${escapeHtml(placeholder)}"
    >
  `;
}

function renderDocumentRow(doc) {
  return `
    <div class="ps-charge-assign-document">
      <span class="ps-charge-assign-document-label">${escapeHtml(doc.label || doc.id2)}</span>
      <label class="ps-charge-assign-field">
        <span>Duree_Force</span>
        ${renderField({ scope: "document", docId: doc.id, value: doc.value, inherited: doc.inherited })}
      </label>
    </div>
  `;
}

function renderZoneBlock(typeDoc, zoneNode) {
  return `
    <div class="ps-charge-assign-zone">
      <div class="ps-charge-assign-zone-head">
        <span class="ps-charge-assign-zone-name">${escapeHtml(zoneNode.zone)}</span>
        <label class="ps-charge-assign-field">
          <span>Duree_Zone</span>
          ${renderField({
            scope: "zone",
            typeDoc,
            zone: zoneNode.zone,
            value: zoneNode.value,
            inherited: zoneNode.inherited,
          })}
        </label>
      </div>
      ${renderDivergenceBanner(zoneNode.zone, zoneNode)}
      <details class="ps-charge-assign-disclosure">
        <summary>Par document (${zoneNode.documents.length})</summary>
        <div class="ps-charge-assign-documents">
          ${zoneNode.documents.map((doc) => renderDocumentRow(doc)).join("")}
        </div>
      </details>
    </div>
  `;
}

function renderTypeBlock(typeNode) {
  return `
    <div class="ps-charge-assign-type">
      <div class="ps-charge-assign-type-head">
        <span class="ps-charge-assign-type-name">${escapeHtml(typeNode.typeDoc)}</span>
        <label class="ps-charge-assign-field">
          <span>Duree_Projet</span>
          ${renderField({
            scope: "type",
            typeDoc: typeNode.typeDoc,
            value: typeNode.value,
            inherited: false,
          })}
        </label>
      </div>
      ${renderDivergenceBanner(typeNode.typeDoc, typeNode)}
      <details class="ps-charge-assign-disclosure">
        <summary>Par zone (${typeNode.zones.length})</summary>
        <div class="ps-charge-assign-zones">
          ${typeNode.zones.map((zoneNode) => renderZoneBlock(typeNode.typeDoc, zoneNode)).join("")}
        </div>
      </details>
    </div>
  `;
}

function renderTreeHtml(tree) {
  if (!Array.isArray(tree) || !tree.length) {
    return `<p class="ps-charge-assign-empty">Aucun document dans ce projet.</p>`;
  }
  return tree.map(renderTypeBlock).join("");
}

// --- verrou partage : reutilise, jamais reimplemente --------------------------
//
// `sharedSubmitLock`/`sharedSubmitSession` viennent d'editSegmentModal.js : UN
// SEUL verrou pour les DEUX fenetres du widget, pour que l'ecriture ~112
// lignes d'un « Enregistrer » ici ne puisse jamais partir en meme temps qu'un
// enregistrement de segment (les deux ecrivent dans des tables differentes,
// mais rien n'empeche l'utilisateur d'ouvrir les deux fenetres l'une apres
// l'autre avant que la premiere ecriture ait fini).
//
// CORRECTION fix round 1 : la premiere version de ce fichier tenait SON PROPRE
// registre de controleurs (`liveChargeAssignControllers`), au pretexte que
// `liveControllers`/`notifyLiveControllers` (editSegmentModal.js) etaient
// prives et non exportes. C'ETAIT LE BUG : le `finally` d'editSegmentModal.js
// ne notifiait donc QUE les fenetres de segment quand une ecriture se
// resolvait tardivement — un segment qui cale, se ferme, puis une fenetre de
// charge ouverte a la place, puis la resolution tardive : Enregistrer restait
// desactive A VIE ici, sans aucun recours sinon fermer/rouvrir la fenetre.
// editSegmentModal.js expose maintenant `subscribeToSharedSubmitLock(hooks) ->
// unsubscribe` ET `notifySharedSubmitLockSubscribers(hookName)` : cette
// fenetre s'abonne comme le fait `createEditSegmentModal` (juste en dessous,
// `controllerHooks`/`subscribeToSharedSubmitLock`), et notifie par le meme
// point d'entree public dans son propre `handleSave` (cf. plus bas). Les DEUX
// fenetres partagent donc desormais le MEME registre de controleurs vivants,
// pas seulement le meme verrou — sans jamais creer de second verrou : l'objet
// `sharedSubmitLock` reste unique et importe.

// createChargeAssignModal(rootEl, { onSubmit, stallTimeoutMs }) -> { open, close, isOpen, destroy }
//
// `open({ planningRows, columns })` construit l'arbre (buildChargeTree) et
// rend la fenetre ; rien n'est fige entre deux ouvertures, chaque `open()`
// repart d'un instantane frais. `onSubmit(writes)` est appele sur
// Enregistrer avec les ecritures collectees (collectChargeWrites) ; il peut
// renvoyer (une promesse de) { ok: true } pour fermer la fenetre, ou
// { ok: false, error } pour afficher `error` et la laisser ouverte.
export function createChargeAssignModal(rootEl, { onSubmit, stallTimeoutMs } = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    return { open() {}, close() {}, isOpen: () => false, destroy() {} };
  }

  const bodyEl = rootEl.querySelector("#ps-charge-assign-body");
  const feedbackEl = rootEl.querySelector("#ps-charge-assign-feedback");
  const saveBtn = rootEl.querySelector("#ps-charge-assign-save");
  const cancelBtn = rootEl.querySelector("#ps-charge-assign-cancel");

  let currentTree = [];
  let planningRowsSnapshot = [];
  let columnsSnapshot = {};
  // Editions de l'utilisateur, PAR NIVEAU touche seulement (cf. handleFieldChange) :
  // un champ jamais ouvert, ou ramene a sa valeur affichee, n'y figure pas.
  const editsByType = new Map();
  const editsByZone = new Map();
  const editsByDoc = new Map();
  // Timer local du delai de garde (cf. note "VERROU PARTAGE" plus haut et le
  // commentaire pres de son armement dans handleSave : cette fenetre n'a pas
  // d'`onStall` dans `controllerHooks`, donc une ecriture PARTIE D'ICI doit se
  // signaler son propre delai expire).
  let localStallTimerId = null;
  // Nombre de refus deja opposes par `confirm` DEPUIS L'OUVERTURE courante
  // (cf. confirmDiscard) : c'est la soupape qui empeche une fenetre infermable
  // quand l'hote supprime les dialogues.
  let discardRefusals = 0;

  const saveLock = sharedSubmitLock;
  const session = sharedSubmitSession;

  const controllerHooks = {
    onLockStateChanged: () => {
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

  function clearLocalStallTimer() {
    if (localStallTimerId != null) {
      clearTimeout(localStallTimerId);
      localStallTimerId = null;
    }
  }

  function zoneKey(typeDoc, zone) {
    return `${typeDoc}|${zone}`;
  }

  function rememberEdit(target, value) {
    const scope = target.dataset.scope;
    if (scope === "type") {
      editsByType.set(target.dataset.typeDoc, value);
    } else if (scope === "zone") {
      editsByZone.set(zoneKey(target.dataset.typeDoc, target.dataset.zone), value);
    } else if (scope === "document") {
      editsByDoc.set(target.dataset.docId, value);
    }
  }

  function forgetEdit(target) {
    const scope = target.dataset.scope;
    if (scope === "type") {
      editsByType.delete(target.dataset.typeDoc);
    } else if (scope === "zone") {
      editsByZone.delete(zoneKey(target.dataset.typeDoc, target.dataset.zone));
    } else if (scope === "document") {
      editsByDoc.delete(target.dataset.docId);
    }
  }

  function hasPendingEdits() {
    return editsByType.size > 0 || editsByZone.size > 0 || editsByDoc.size > 0;
  }

  function renderTree() {
    if (bodyEl instanceof HTMLElement) {
      bodyEl.innerHTML = renderTreeHtml(currentTree);
    }
  }

  // Traduit l'arbre AFFICHE + les editions en attente en l'arbre "intentions
  // d'ecriture" attendu par collectChargeWrites (value = null si non touche).
  function buildEditsTree() {
    return currentTree.map((typeNode) => ({
      typeDoc: typeNode.typeDoc,
      value: editsByType.has(typeNode.typeDoc) ? editsByType.get(typeNode.typeDoc) : null,
      zones: typeNode.zones.map((zoneNode) => {
        const key = zoneKey(typeNode.typeDoc, zoneNode.zone);
        return {
          zone: zoneNode.zone,
          value: editsByZone.has(key) ? editsByZone.get(key) : null,
          documents: zoneNode.documents.map((doc) => ({
            id: doc.id,
            value: editsByDoc.has(String(doc.id)) ? editsByDoc.get(String(doc.id)) : null,
          })),
        };
      }),
    }));
  }

  function open({ planningRows, columns } = {}) {
    // Une ecriture est en cours : ne pas ecraser le contexte sous ses pieds
    // (meme garde qu'editSegmentModal.open).
    if (saveLock.blocksClose()) return;

    session.renew();
    planningRowsSnapshot = Array.isArray(planningRows) ? planningRows : [];
    columnsSnapshot = columns || {};
    currentTree = buildChargeTree(planningRowsSnapshot, columnsSnapshot);
    editsByType.clear();
    editsByZone.clear();
    editsByDoc.clear();
    discardRefusals = 0;

    renderTree();
    setFeedback(saveLock.isStalled() ? SUBMIT_STALL_MESSAGE : "");
    applyLockStateToUi();
    rootEl.style.display = "flex";
    rootEl.classList.add("is-open");
  }

  function close() {
    if (saveLock.blocksClose()) return;
    // Fond, Echap et Fermer partagent tous les trois `close()` : une seule
    // garde suffit pour les trois chemins. Contrairement a la fenetre de
    // segment (un seul champ), celle-ci peut porter des dizaines d'editions
    // en attente — les perdre sans un mot n'est plus anodin (brief fix
    // round 1, minor). Une fenetre ouverte puis fermee sans y toucher se
    // ferme quand meme en un clic : la garde ne se declenche que si quelque
    // chose serait reellement perdu.
    if (hasPendingEdits() && !confirmDiscard()) return;
    closeNow();
  }

  function confirmDiscard() {
    if (typeof confirm !== "function") return true;

    // DEUXIEME demande de fermeture d'affilee : on ferme, quoi qu'ait repondu
    // `confirm`. Un widget Grist vit dans une IFRAME SANDBOXEE : si
    // `allow-modals` n'est pas accorde, la specification HTML impose a
    // `confirm()` de renvoyer `false` IMMEDIATEMENT, sans avoir rien montre a
    // personne. Fond, Echap et Fermer partageant tous `close()`, la fenetre
    // deviendrait alors INFERMABLE — sans autre recours que de changer de
    // projet. Un `false` reste honore une premiere fois (c'est la meme valeur
    // qu'un vrai clic sur « Annuler », rien ne les distingue) ; si
    // l'utilisateur redemande la fermeture, c'est qu'il la veut.
    if (discardRefusals > 0) return true;

    let answer;
    try {
      answer = confirm("Fermer sans enregistrer ? Les modifications seront perdues.");
    } catch (_error) {
      // Un hote qui refuse le dialogue ne doit pas emprisonner l'utilisateur.
      return true;
    }

    // Seul un `false` BOOLEEN est un refus. Un hote qui DEFINIT `confirm` sans
    // rien demander renvoie typiquement `undefined`/`null` : c'est un dialogue
    // supprime, pas un « non », donc un consentement.
    if (answer === false) {
      discardRefusals += 1;
      return false;
    }
    return true;
  }

  function closeNow() {
    session.renew();
    clearLocalStallTimer();
    planningRowsSnapshot = [];
    columnsSnapshot = {};
    currentTree = [];
    editsByType.clear();
    editsByZone.clear();
    editsByDoc.clear();
    discardRefusals = 0;
    rootEl.style.display = "none";
    rootEl.classList.remove("is-open");
    setFeedback("");
    if (bodyEl instanceof HTMLElement) bodyEl.innerHTML = "";
  }

  function isOpen() {
    return rootEl.classList.contains("is-open");
  }

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

    if (bodyEl instanceof HTMLElement && bodyEl.querySelector(".ps-charge-assign-input.is-invalid")) {
      setFeedback("Corrigez les valeurs invalides avant d'enregistrer.");
      return;
    }

    if (typeof onSubmit !== "function") {
      closeNow();
      return;
    }

    const writes = collectChargeWrites(buildEditsTree(), planningRowsSnapshot, columnsSnapshot);

    // Rien n'a ete edite : fermer directement, sans prendre le verrou ni
    // appeler onSubmit([]) — un aller-retour Grist pour rien qui bloquerait
    // l'interface le temps qu'il se resolve (brief fix round 1, minor).
    if (!writes.length) {
      closeNow();
      return;
    }

    // Verrou pose AVANT le premier await, relache dans le finally — meme
    // discipline qu'editSegmentModal.handleSave (double-clic, promesse qui ne
    // se regle jamais).
    if (!saveLock.acquire(stallTimeoutMs)) return;
    const submitToken = session.current();
    const effectiveStallTimeoutMs = Number.isFinite(stallTimeoutMs)
      ? stallTimeoutMs
      : SUBMIT_STALL_TIMEOUT_MS;
    // Mirroir local du delai de garde du verrou partage (cf. note "VERROU
    // PARTAGE" en tete de fichier) : depuis fix round 1 cette fenetre EST
    // abonnee au registre partage (`subscribeToSharedSubmitLock`), mais ses
    // hooks n'implementent QUE `onLockStateChanged`, pas `onStall` — le verrou
    // partage arme deja SON propre timer (via acquire) pour passer stalled et
    // appeler `onStall`, mais seuls les controleurs qui l'implementent (les
    // fenetres de segment) en sont directement prevenus. Ce timer-ci, de la
    // MEME duree + 1 ms, met a jour NOTRE UI quand le delai expire pendant une
    // ecriture PARTIE DEPUIS CETTE fenetre. Le "+1" evite de dependre de
    // l'ordre d'insertion de deux `setTimeout` au meme delai : aujourd'hui
    // `acquire()` arme le sien avant celui-ci, donc `isStalled()` y est deja
    // vrai en pratique, mais rien ne le garantissait si l'ordre d'armement
    // changeait un jour (brief fix round 1, minor).
    clearLocalStallTimer();
    localStallTimerId = setTimeout(() => {
      localStallTimerId = null;
      if (saveLock.isStalled()) {
        setFeedback(SUBMIT_STALL_MESSAGE);
        applyLockStateToUi();
      }
    }, effectiveStallTimeoutMs + 1);
    applyLockStateToUi();
    setFeedback("");

    let result;
    try {
      result = await onSubmit(writes);
    } catch (error) {
      console.error("Erreur enregistrement charge (fenetre) :", error);
      if (session.owns(submitToken)) {
        setFeedback("Une erreur est survenue pendant l'enregistrement de la charge.");
      }
      return;
    } finally {
      clearLocalStallTimer();
      saveLock.release();
      // Point de notification PARTAGE (editSegmentModal.js) : previent AUSSI
      // les fenetres de segment abonnees, pas seulement celle-ci — symetrique
      // de la correction du fix round 1 (Important 1).
      notifySharedSubmitLockSubscribers("onLockStateChanged");
    }

    // Resolution tardive d'une session abandonnee : le verrou vient d'etre
    // rendu (ci-dessus), mais on ne ferme rien de force et on n'ecrase aucun
    // message — meme discipline qu'editSegmentModal.handleSave.
    if (!session.owns(submitToken)) return;

    if (result && result.ok === false) {
      setFeedback(result.error || "L'enregistrement de la charge a echoue.");
      return;
    }
    closeNow();
  }

  function handleSaveClick(event) {
    event.preventDefault();
    handleSave().catch((error) => {
      console.error("Erreur enregistrement charge (fenetre) :", error);
      setFeedback("Une erreur est survenue pendant l'enregistrement de la charge.");
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

  function handleKeyDown(event) {
    if (event.key === "Escape" && isOpen()) {
      close();
    }
  }

  // Delegue sur `bodyEl` : les champs sont recrees a chaque `open()`
  // (renderTree remplace tout le contenu), un ecouteur pose directement dessus
  // ne survivrait pas — meme raison que la delegation du bouton d'ouverture
  // sur le board (Tache 3/4, cf. main.js).
  function handleFieldChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("ps-charge-assign-input")) return;

    if (!saveLock.isStalled()) setFeedback("");
    // Cf. brief fix round 1, Important 1 : sans cet appel, taper dans un champ
    // pendant un blocage stalled ne remettait pas Enregistrer/Fermer dans
    // l'etat que le verrou partage dicte reellement (idempotent sinon).
    applyLockStateToUi();

    // SAISIE ILLISIBLE POUR LE NAVIGATEUR — teste AVANT tout le reste.
    //
    // Ces champs sont des <input type="number"> : quand le texte tape n'est pas
    // un nombre flottant valide pour l'UA, celle-ci rapporte `.value === ""`.
    // Plus bas, "" est indiscernable d'un champ VIDE explicitement — sauf que
    // dans CETTE fenetre "" est une valeur qui S'ECRIT (elle rend la main au
    // niveau du dessus, cf. collectChargeWrites). « Je tape 2,5 » partait donc
    // en « j'efface ma valeur a ce niveau », sans marqueur ni message ; et
    // comme le niveau du dessus reaffiche aussitot un nombre, RIEN a l'ecran ne
    // distinguait les deux. Le cas est ordinaire, pas theorique : tout le reste
    // du widget accepte la VIRGULE decimale (utils/format.js,
    // documentCharge.js), et dans un navigateur en locale francaise la virgule
    // entre bien dans le champ tout en laissant `.value` vide.
    //
    // `validity.badInput` est exactement « l'utilisateur a fourni une saisie que
    // l'agent utilisateur ne sait pas convertir » : c'est lui, et lui seul, qui
    // separe EFFACE de MAL TAPE. On marque donc le champ comme n'importe quelle
    // autre saisie illisible — la garde d'`handleSave` bloque alors
    // l'enregistrement tant que ce n'est pas corrige.
    //
    // editSegmentModal.js n'est pas expose : "" n'y est pas une valeur
    // ecrivable, validateEditSegmentEffectif en fait une erreur VISIBLE.
    if (target.validity?.badInput) {
      target.classList.add("is-invalid");
      forgetEdit(target);
      return;
    }

    const original = target.dataset.original ?? "";
    const raw = target.value;
    const trimmed = String(raw ?? "").trim();

    if (trimmed === original) {
      // Retour a l'etat affiche a l'ouverture : plus rien a ecrire ici.
      target.classList.remove("is-invalid");
      forgetEdit(target);
      return;
    }

    if (trimmed === "") {
      // Champ explicitement vide : rend la main au niveau du dessus.
      target.classList.remove("is-invalid");
      rememberEdit(target, "");
      return;
    }

    const parsed = parseOptionalNumberInput(raw);
    if (parsed == null || parsed <= 0) {
      // Saisie illisible : pas d'ecriture tant que ce n'est pas corrige.
      target.classList.add("is-invalid");
      forgetEdit(target);
      return;
    }

    target.classList.remove("is-invalid");
    rememberEdit(target, parsed);
  }

  saveBtn?.addEventListener("click", handleSaveClick);
  cancelBtn?.addEventListener("click", handleCancelClick);
  rootEl.addEventListener("click", handleBackdropClick);
  bodyEl?.addEventListener("input", handleFieldChange);
  bodyEl?.addEventListener("change", handleFieldChange);
  document.addEventListener("keydown", handleKeyDown);

  function destroy() {
    closeNow();
    unsubscribeFromSharedSubmitLock();
    saveBtn?.removeEventListener("click", handleSaveClick);
    cancelBtn?.removeEventListener("click", handleCancelClick);
    rootEl.removeEventListener("click", handleBackdropClick);
    bodyEl?.removeEventListener("input", handleFieldChange);
    bodyEl?.removeEventListener("change", handleFieldChange);
    document.removeEventListener("keydown", handleKeyDown);
  }

  return { open, close, isOpen, destroy };
}
