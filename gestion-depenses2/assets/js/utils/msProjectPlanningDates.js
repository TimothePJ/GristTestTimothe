// msProjectPlanningDates.js — dates d'une ligne de Planning_Projet liée à une tâche MS Project.
//
// Module pur, sans DOM ni Grist. C'est la SEULE règle de calcul : le dépôt d'une tâche dans
// Planning Projet, l'import XML et l'édition d'une date dans MS Project écrivent les mêmes
// colonnes et doivent trouver les mêmes dates. Trois copies ont coexisté ; l'édition d'une
// date ne recalculait plus ni la diffusion ni la date limite des notes de calcul, coupes,
// démolitions et types libres.
//
//   - COFFRAGE et tout autre type (NDC, COUPES, DEMOLITION, libre) :
//       démarrage = début MS ; diffusion coffrage = démarrage − Durée 3 ;
//       date limite = diffusion coffrage − Durée 1.
//   - ARMATURES :
//       démarrage = début MS ; diffusion armatures = démarrage − Durée 3 ;
//       diffusion coffrage = diffusion armatures − Durée 2.
//   - Sans type de document : la barre prend les dates de la tâche MS
//       (date limite = début, diffusion coffrage = fin).
// Les durées sont en semaines calendaires. Une durée absente laisse la date en place ; s'il
// n'y en a aucune, la tâche MS la donne.
import { normalizePlanningDocumentType, parsePlanningDay } from "./planningRealisation.js";

function toText(value) {
  return value == null ? "" : String(value).trim();
}

// Famille de calcul d'un type de document, lue comme le dépôt dans Planning Projet l'a
// toujours lue : une note de calcul reste une note de calcul même si son intitulé contient
// « armatures », et un intitulé que le planning ne tient ni pour un coffrage ni pour des
// armatures (« Armature » au singulier) suit la règle sans type.
function resolveDateFamily(typeDoc) {
  const text = toText(typeDoc);
  if (!text) return "";
  const upper = text.toUpperCase();
  const normalized = normalizePlanningDocumentType(text);
  if (upper.includes("COFFRAGE") || !["COFFRAGE", "ARMATURES"].includes(normalized)) {
    return "coffrage";
  }
  return upper.includes("ARMATURES") ? "armatures" : "";
}

function toWeeks(value) {
  if (value == null || value === "") return null;
  const weeks = Number(value);
  return Number.isInteger(weeks) && weeks >= 0 ? weeks : null;
}

function toIso(day) {
  if (!day) return "";
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

// Décalage en jours du calendrier : le changement d'heure ne déplace pas le jour.
function shiftWeeks(day, weeks) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + weeks * 7);
}

function withoutEmpty(dates) {
  return Object.fromEntries(Object.entries(dates).filter(([, iso]) => iso));
}

// Dates à écrire, en « AAAA-MM-JJ » : seules celles que la règle sait donner sont rendues.
// Les dates en place (`demarrage`, `diffCoffrage`, `diffArmature`, `dateLimite`) se lisent
// sous toutes les écritures Grist.
export function computeMsLinkedPlanningDates({
  typeDoc,
  msStart,
  msEnd,
  demarrage,
  diffCoffrage,
  diffArmature,
  dateLimite,
  duree1,
  duree2,
  duree3,
} = {}) {
  const family = resolveDateFamily(typeDoc);
  const start = parsePlanningDay(msStart);
  const end = parsePlanningDay(msEnd);

  if (!family) {
    return withoutEmpty({ dateLimite: toIso(start), diffCoffrage: toIso(end) });
  }

  let work = start || parsePlanningDay(demarrage);
  const weeks3 = toWeeks(duree3);

  if (family === "armatures") {
    let armature = parsePlanningDay(diffArmature);
    let coffrage = parsePlanningDay(diffCoffrage);
    const weeks2 = toWeeks(duree2);

    if (work && weeks3 != null) armature = shiftWeeks(work, -weeks3);
    else if (!armature && end) armature = end;

    if (armature && weeks2 != null) coffrage = shiftWeeks(armature, -weeks2);
    else if (!coffrage && start) coffrage = start;

    if (!work && armature && weeks3 != null) work = shiftWeeks(armature, weeks3);

    return withoutEmpty({
      demarrage: toIso(work),
      diffArmature: toIso(armature),
      diffCoffrage: toIso(coffrage),
    });
  }

  let coffrage = parsePlanningDay(diffCoffrage);
  let limit = parsePlanningDay(dateLimite);
  const weeks1 = toWeeks(duree1);

  if (work && weeks3 != null) coffrage = shiftWeeks(work, -weeks3);
  else if (!coffrage && end) coffrage = end;

  if (coffrage && weeks1 != null) limit = shiftWeeks(coffrage, -weeks1);
  else if (!limit && start) limit = start;

  return withoutEmpty({
    demarrage: toIso(work),
    diffCoffrage: toIso(coffrage),
    dateLimite: toIso(limit),
  });
}

// Noms des colonnes de Planning_Projet ; chaque widget peut donner les siens.
function resolveColumns(columns = {}) {
  return {
    typeDoc: columns.typeDoc || "Type_doc",
    dateLimite: columns.dateLimite || "Date_limite",
    duree1: columns.duree1 || "Duree_1",
    diffCoffrage: columns.diffCoffrage || "Diff_coffrage",
    duree2: columns.duree2 || "Duree_2",
    diffArmature: columns.diffArmature || "Diff_armature",
    duree3: columns.duree3 || "Duree_3",
    demarrage: columns.demarragesTravaux || "Demarrages_travaux",
  };
}

// La même règle, lue sur une ligne Grist et rendue par nom de colonne.
export function buildMsLinkedPlanningDateFields(row, columns = {}, { msStart, msEnd } = {}) {
  const names = resolveColumns(columns);
  const dates = computeMsLinkedPlanningDates({
    typeDoc: row?.[names.typeDoc],
    msStart,
    msEnd,
    demarrage: row?.[names.demarrage],
    diffCoffrage: row?.[names.diffCoffrage],
    diffArmature: row?.[names.diffArmature],
    dateLimite: row?.[names.dateLimite],
    duree1: row?.[names.duree1],
    duree2: row?.[names.duree2],
    duree3: row?.[names.duree3],
  });
  return Object.fromEntries(
    Object.entries(dates).map(([key, iso]) => [names[key], iso])
  );
}

// Parmi des dates à écrire, celles qui déplacent réellement le jour enregistré. Une ligne
// dont rien ne bouge n'a pas à être réécrite : l'écriture coûte au serveur et réveille les
// autres widgets pour rien.
export function keepChangedPlanningDateFields(row, fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).filter(([column, iso]) => toIso(parsePlanningDay(row?.[column])) !== toText(iso))
  );
}
