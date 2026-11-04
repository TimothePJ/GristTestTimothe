// Opérations sur un étage de toutes les zones (affichage par étage) : un « étage » regroupe
// les étages de même clé de chaque zone ; renommer ou supprimer agit sur toutes ses zones.
// Module pur, bâti sur les helpers par étage de syntheseTaskModel.js.

import {
  MAX_TASK_NAME_LENGTH,
  NO_ZONE_KEY,
  buildFloorRenameActions,
  buildFloorRenameChanges,
  floorKeyOf,
  floorRemovalIds,
  validateFloorName,
  zoneKeyOf,
} from "./syntheseTaskModel.js";

// Les étages de clé `floorKey` dans chaque zone (ordre des sections, sans « Sans zone »).
export function storeyFloorsOf(sections = [], floorKey = "") {
  const entries = [];
  (sections || []).forEach((section) => {
    if (section.zoneKey === NO_ZONE_KEY) return;
    const floor = (section.floors || []).find((candidate) => candidate.key === floorKey);
    if (floor) entries.push({ section, floor });
  });
  return entries;
}

// Nouveau nom d'un étage : les règles d'un étage de zone, vérifiées dans chaque zone de
// l'étage (un doublon dans une autre zone est permis : les étages se rejoignent).
export function validateStoreyRename(rawValue, { sections = [], floorKey = "" } = {}) {
  const general = validateFloorName(rawValue);
  if (!general.ok) return general;
  for (const { section, floor } of storeyFloorsOf(sections, floorKey)) {
    const result = validateFloorName(rawValue, { floors: section.floors, currentKey: floor.key });
    if (!result.ok) return { ok: false, error: `Dans « ${section.label} » : ${result.error}` };
  }
  return general;
}

// Renommer un étage dans toutes ses zones : fusion des changements (ligne par ligne) et des
// actions Grist de chaque zone.
export function buildStoreyRename(entries = [], name = "") {
  const changes = new Map();
  const actions = [];
  (entries || []).forEach(({ floor }) => {
    buildFloorRenameChanges(floor, name).forEach((fields, rowId) => changes.set(rowId, fields));
    actions.push(...buildFloorRenameActions(floor, name));
  });
  return { changes, actions };
}

// Toutes les lignes à supprimer pour l'étage, dans chacune de ses zones.
export function storeyRemovalIds(entries = []) {
  return (entries || []).flatMap(({ floor }) => floorRemovalIds(floor));
}

export function buildStoreyDeleteQuestion({ name = "", zoneCount = 0, taskCount = 0 } = {}) {
  const zones = `${zoneCount} zone${zoneCount > 1 ? "s" : ""}`;
  if (!taskCount) return `Supprimer l'étage « ${name} » dans ${zones} ?`;
  if (taskCount === 1) return `Supprimer l'étage « ${name} » dans ${zones} et sa tâche ?`;
  return `Supprimer l'étage « ${name} » dans ${zones} et ses ${taskCount} tâches ?`;
}

// Les zones nommées dont une zone a déjà un étage de ce nom (« Sans zone » n'est jamais listée) :
// la fenêtre « Ajouter un étage » les grise.
export function zonesWithFloorName(sections = [], rawName = "") {
  const key = floorKeyOf(rawName);
  const zoneKeys = new Set();
  if (!key) return zoneKeys;
  storeyFloorsOf(sections, key).forEach(({ section }) => zoneKeys.add(section.zoneKey));
  return zoneKeys;
}

// Nom d'une zone saisie dans la fenêtre « Ajouter un étage… » : refusé s'il est vide, « Sans zone »,
// sans lettre ni chiffre ou trop long ; accepté sinon, `existing` disant si une zone du projet (tous
// services, même comparaison que les zones de la vue) porte déjà ce nom — alors `label` est le sien.
export function checkNewZoneName(rawName, { sections = [] } = {}) {
  const text = String(rawName ?? "").trim();
  if (!text) return { ok: false, error: "Donnez un nom à la zone." };
  const zoneKey = zoneKeyOf(text);
  if (zoneKey === NO_ZONE_KEY) {
    return text.toLocaleLowerCase("fr") === "sans zone"
      ? { ok: false, error: "« Sans zone » est réservé : choisissez un autre nom." }
      : { ok: false, error: "Le nom de la zone doit contenir au moins une lettre ou un chiffre." };
  }
  if (text.length > MAX_TASK_NAME_LENGTH) {
    return { ok: false, error: `Le nom de la zone est limité à ${MAX_TASK_NAME_LENGTH} caractères.` };
  }
  const section = (sections || []).find((candidate) => candidate.zoneKey === zoneKey);
  return section
    ? { ok: true, existing: true, zoneKey, label: section.label }
    : { ok: true, existing: false, zoneKey, label: text };
}

// Création d'un étage dans les zones cochées et les nouvelles zones saisies (`newZones`, leurs noms) :
// nom valide, au moins une zone, zones cochées toujours là, aucune ayant déjà l'étage. Une « nouvelle »
// zone créée entre-temps rejoint les zones cochées. Rend { ok, name, key, zoneKeys, newZones } —
// zoneKeys dans l'ordre des sections, sans doublon ; newZones [{ zoneKey, label }] sans doublon —
// ou { ok: false, error }.
export function validateNewStorey(rawName, zoneKeys = [], { sections = [], newZones = [] } = {}) {
  const general = validateFloorName(rawName);
  if (!general.ok) return general;
  const wanted = new Set(zoneKeys || []);
  const created = new Map();
  for (const raw of newZones || []) {
    const result = checkNewZoneName(raw, { sections });
    if (!result.ok) return { ok: false, error: `Zone « ${raw} » : ${result.error}` };
    if (result.existing) wanted.add(result.zoneKey);
    else if (!created.has(result.zoneKey)) created.set(result.zoneKey, { zoneKey: result.zoneKey, label: result.label });
  }
  if (!wanted.size && !created.size) return { ok: false, error: "Cochez au moins une zone." };
  const named = (sections || []).filter((section) => section.zoneKey !== NO_ZONE_KEY);
  if ([...wanted].some((zoneKey) => !named.some((section) => section.zoneKey === zoneKey))) {
    return { ok: false, error: "Une zone cochée n'existe plus : rouvrez la fenêtre." };
  }
  const ticked = named.filter((section) => wanted.has(section.zoneKey));
  for (const section of ticked) {
    const result = validateFloorName(rawName, { floors: section.floors });
    if (!result.ok) return { ok: false, error: `Dans « ${section.label} » : ${result.error}` };
  }
  return {
    ok: true,
    name: general.name,
    key: general.key,
    zoneKeys: ticked.map((section) => section.zoneKey),
    newZones: [...created.values()],
  };
}
