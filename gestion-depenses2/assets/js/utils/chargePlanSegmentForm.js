// Noyau pur de la fenetre « segment mensuel » : resolution du mois clique et
// validation de l'effectif. Aucun DOM, aucun appel Grist — testable sous
// `node --test` (cf. tests/chargePlanSegmentForm.test.mjs), pendant que le reste
// du geste (pointeur, barre provisoire) reste dans main.js.

import { getMonthBounds, monthKeyFromDate } from "./monthSegments.js";

export const EFFECTIF_REQUIRED_MESSAGE =
  "Saisissez un nombre de jours effectifs superieur a 0.";
export const EFFECTIF_STEP_MESSAGE =
  "Le nombre de jours effectifs doit etre un entier ou un multiple de 0,5.";

export function isHalfDayIncrement(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return false;
  }

  return Math.abs(numericValue * 2 - Math.round(numericValue * 2)) < 1e-9;
}

// Mois du creneau sous le curseur. La selection vient de
// computeChargePlanSelectionFromSlotIndexes : `startDate` est une chaine ISO.
export function resolveClickedMonthKey(selection) {
  const rawStartDate = selection?.startDate;
  if (rawStartDate == null || rawStartDate === "") {
    return "";
  }

  const startDate =
    rawStartDate instanceof Date ? rawStartDate : new Date(rawStartDate);
  return monthKeyFromDate(startDate);
}

// Emprise en pixels d'un mois dans une frise deja rendue, a partir des creneaux
// demi-journee (`{ startAt, endAt, leftPx, widthPx }`) que chargeTimeline.js a
// calcules. Sert a la fois a la barre provisoire et au surlignage de survol.
// Renvoie null si le mois est hors de la fenetre rendue ; si le mois n'y est
// que partiellement, l'emprise se limite a la partie visible.
export function computeMonthSlotGeometry(slots, monthKey) {
  const bounds = getMonthBounds(monthKey);
  if (!bounds || !Array.isArray(slots) || !slots.length) {
    return null;
  }

  const firstSlot = slots.find((slot) => slot?.startAt >= bounds.startAt);
  const lastSlot = [...slots].reverse().find((slot) => slot?.endAt <= bounds.endAt);
  if (!firstSlot || !lastSlot || lastSlot.leftPx < firstSlot.leftPx) {
    return null;
  }

  return {
    leftPx: firstSlot.leftPx,
    widthPx: lastSlot.leftPx + lastSlot.widthPx - firstSlot.leftPx,
  };
}

function toSegmentId(value) {
  if (value == null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

// Que faire d'un clic sur une piste ? C'est ici que vit l'invariant « un segment
// = un mois » : un mois deja occupe s'edite, il ne se double jamais.
//
// `clickedSegmentId` = id de la barre effectivement sous le curseur (null si le
// clic tombe dans le vide du mois) ; `monthSegmentId` = id de la premiere barre
// du mois trouvee dans la piste. La barre cliquee PRIME : avec des doublons
// legacy empiles par assignSegmentLanes, se fier au seul mois reviendrait a
// toujours editer la barre du dessus.
export function resolveChargePlanClickIntent({
  monthKey,
  clickedSegmentId = null,
  monthSegmentId = null,
} = {}) {
  if (!monthKey) {
    return { action: "ignore" };
  }

  const clickedOnBar = clickedSegmentId != null && clickedSegmentId !== "";
  const segmentId = toSegmentId(clickedOnBar ? clickedSegmentId : monthSegmentId);

  if (segmentId == null) {
    // Barre cliquee sans id lisible : on ne devine pas laquelle editer.
    return clickedOnBar ? { action: "ignore" } : { action: "create", monthKey };
  }

  // Segment optimiste : son id Grist n'est pas encore connu, l'editer ecrirait
  // sur un identifiant negatif.
  if (segmentId <= 0) {
    return { action: "pending" };
  }

  return { action: "edit", segmentId };
}

// Delai de garde de l'ecriture : au-dela, on considere que la promesse Grist ne
// se reglera jamais (document deconnecte, frame parente disparue, worker bloque).
export const CHARGE_PLAN_SAVE_STALL_TIMEOUT_MS = 30000;

export const CHARGE_PLAN_SAVE_STALL_MESSAGE =
  "L'enregistrement ne repond pas. Fermez la fenetre et rechargez le widget pour verifier si le segment a bien ete enregistre.";

// Verrou d'ecriture de la fenetre. `Enregistrer` n'est dans aucun <form> et
// `editingChargePlanSegment.segment` reste null pendant tout l'await d'une
// creation : sans verrou, deux clics rapides produisent deux AddRecord sur le
// meme (projet, personne, mois) — exactement le doublon que la cle unique
// interdit. Il ferme aussi la course « Enregistrer puis Annuler ».
//
// DEUX ETATS DISTINCTS, et c'est tout l'objet du delai de garde :
//   - `isSaving()`   : une ecriture est partie, aucune autre ne doit partir ;
//   - `blocksClose()`: la fenetre doit rester ouverte le temps de l'aller-retour.
// Si la promesse ne se regle jamais, le `finally` de l'appelant ne s'execute
// jamais et le verrou resterait tenu a vie : la fenetre deviendrait
// indefermable, sans meme Echap. Au bout de `stallTimeoutMs` on relache donc la
// SEULE garde de fermeture (`blocksClose()` retombe a false) ; le verrou de
// soumission, lui, reste tenu — le relacher autoriserait une seconde ecriture
// pendant que la premiere est encore en vol. On debloque l'interface, jamais
// l'ecriture. `setTimer`/`clearTimer` sont injectables pour les tests.
export function createChargePlanSaveLock({
  stallTimeoutMs = CHARGE_PLAN_SAVE_STALL_TIMEOUT_MS,
  setTimer = (fn, delay) => setTimeout(fn, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
  onStall = null,
} = {}) {
  let saving = false;
  let stalled = false;
  let timerId = null;

  function cancelTimer() {
    if (timerId != null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  return {
    isSaving: () => saving,
    isStalled: () => stalled,
    // Seule garde consultee par les chemins de fermeture (Annuler, Echap, fond).
    blocksClose: () => saving && !stalled,
    // true si le verrou vient d'etre pris, false s'il etait deja tenu.
    acquire() {
      if (saving) return false;
      saving = true;
      stalled = false;
      cancelTimer();
      if (stallTimeoutMs > 0) {
        timerId = setTimer(() => {
          timerId = null;
          stalled = true;
          if (typeof onStall === "function") onStall();
        }, stallTimeoutMs);
      }
      return true;
    },
    release() {
      cancelTimer();
      saving = false;
      stalled = false;
    },
  };
}

// Jeton de session de la fenetre, indispensable des lors que le delai de garde
// existe. Passe ce delai, la fenetre redevient fermable PUIS reouvrable, alors
// que l'ecriture d'origine est toujours en vol. Si elle finit par se regler, la
// suite de CE `saveEditedChargePlanSegment` s'executerait sur la fenetre
// partagee, c'est-a-dire sur le mois que l'utilisateur vient de rouvrir : elle
// la fermerait de force (saisie en cours et barre provisoire perdues) ou y
// afficherait le message d'echec perime de la premiere ecriture.
//
// Chaque ouverture ET chaque fermeture ouvrent donc une session neuve : une
// resolution dont le jeton n'est plus le jeton courant ne pilote plus rien. Le
// verrou, lui, est relache dans tous les cas — il appartient a l'ecriture, pas a
// la session, et le retenir interdirait toute ecriture ulterieure.
export function createChargePlanEditSession() {
  let token = 0;

  return {
    current: () => token,
    // Ouverture ou fermeture : tout ce qui etait parti avant devient « tardif ».
    renew: () => (token += 1),
    owns: (candidate) => candidate === token,
  };
}

// Effectif obligatoire, strictement positif, au demi-jour pres (cf. spec §6).
// Renvoie soit { ok: true, effectif }, soit { ok: false, message }.
export function validateEffectifInput(rawEffectif) {
  if (rawEffectif == null || rawEffectif === "") {
    return { ok: false, message: EFFECTIF_REQUIRED_MESSAGE };
  }

  const numericValue = Number(rawEffectif);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return { ok: false, message: EFFECTIF_REQUIRED_MESSAGE };
  }

  if (!isHalfDayIncrement(numericValue)) {
    return { ok: false, message: EFFECTIF_STEP_MESSAGE };
  }

  return { ok: true, effectif: numericValue };
}
