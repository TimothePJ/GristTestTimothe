// Garde-fou de suppression et de renommage d'une zone : une zone appartient au projet, mais
// « Supprimer » et « Renommer » ne touchent que les lignes du service courant. On refuse donc
// l'opération quand un AUTRE service (Structure / Synthese / Topographie) a des données dans
// la zone. Module pur : pas de DOM, pas de Grist.

// Tables qui portent les zones (même liste que ZONE_SOURCE_TABLES du contexte partagé).
export const ZONE_DATA_TABLES = Object.freeze(["Planning_Projet", "References2", "ListePlan_NDC_COF"]);

export const ZONE_DATA_READ_FAILED =
  "La zone n'a pas été supprimée : les données des autres services n'ont pas pu être lues. Réessayez.";

const KNOWN_SERVICES = Object.freeze(["Structure", "Synthese", "Topographie"]);

// Même normalisation que normalizeService du contexte partagé.
function normalizeServiceText(value) {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalService(value) {
  const key = normalizeServiceText(value);
  if (!key) return "";
  return KNOWN_SERVICES.find((name) => normalizeServiceText(name) === key) || "";
}

// Même clé souple que normalizeZoneSoftKey de gristService : « sans zone » et vide → "".
function zoneSoftKey(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "sans zone") return "";
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]/g, "");
}

function isBlank(value) {
  return String(value ?? "").trim() === "";
}

// Ligne de Planning_Projet sans tâche, sans N° et sans type de document : elle ne fait
// que garder la zone dans son service, ce n'est pas une donnée.
function isEmptyAnchor(row) {
  return isBlank(row?.Taches) && isBlank(row?.Tache) && isBlank(row?.ID2) && isBlank(row?.Type_doc);
}

// Services qui détiennent la zone, hors service courant :
//  - data  : ceux qui y ont des données (avec le nombre de lignes) ;
//  - empty : ceux dont les seules lignes dans la zone sont des ancres vides de Planning_Projet.
export function findZoneHolders(rowsByTable, { zone, service } = {}) {
  const zoneKey = zoneSoftKey(zone);
  if (!zoneKey) return { data: [], empty: [] };
  const currentService = canonicalService(service);
  const counts = new Map();
  const anchored = new Set();

  for (const tableName of ZONE_DATA_TABLES) {
    const rows = Array.isArray(rowsByTable?.[tableName]) ? rowsByTable[tableName] : [];
    for (const row of rows) {
      if (zoneSoftKey(row?.Zone) !== zoneKey) continue;
      const rowService = canonicalService(row?.Service);
      if (!rowService || rowService === currentService) continue;
      if (tableName === "Planning_Projet" && isEmptyAnchor(row)) {
        anchored.add(rowService);
        continue;
      }
      counts.set(rowService, (counts.get(rowService) || 0) + 1);
    }
  }

  return {
    data: [...counts.entries()]
      .map(([name, count]) => ({ service: name, count }))
      .sort((a, b) => a.service.localeCompare(b.service, "fr")),
    empty: [...anchored].filter((name) => !counts.has(name)).sort((a, b) => a.localeCompare(b, "fr")),
  };
}

function formatLineCount(count) {
  return `${count} ligne${count > 1 ? "s" : ""}`;
}

// « X », « X et Y », « X, Y et Z ».
function formatServiceList(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

export const ZONE_RENAME_READ_FAILED =
  "La zone n'a pas été renommée : les données des autres services n'ont pas pu être lues. Réessayez.";

export function buildZoneRefusal(zone, found, { action = "supprimer" } = {}) {
  if (found.length === 1) {
    const { service, count } = found[0];
    return `Impossible de ${action} la zone « ${zone} » : le service ${service} y a des données (${formatLineCount(count)}).`;
  }
  const list = found.map(({ service, count }) => `${service} (${formatLineCount(count)})`).join(", ");
  return `Impossible de ${action} la zone « ${zone} » : d'autres services y ont des données — ${list}.`;
}

// Réussite, mais d'autres services gardent la zone vide (leur ligne d'ancrage).
export function buildZoneLeftoverNotice({ action, zone, targetZone = "", empty }) {
  const one = empty.length === 1;
  const list = formatServiceList(empty);
  if (action === "renommer") {
    const head = `Zone renommée : « ${zone} » → « ${targetZone} ».`;
    return one
      ? `${head} Le service ${list} garde une zone « ${zone} » vide : supprimez-la depuis ce service.`
      : `${head} Les services ${list} gardent une zone « ${zone} » vide : supprimez-la depuis ces services.`;
  }
  const head = `Zone « ${zone} » supprimée dans ce service.`;
  return one
    ? `${head} Le service ${list} la garde (vide) : supprimez-la aussi depuis ce service.`
    : `${head} Les services ${list} la gardent (vide) : supprimez-la aussi depuis ces services.`;
}

// Le service courant n'a aucune ligne dans la zone : rien n'a été écrit.
export function buildZoneNotHereMessage({ action, zone, service, empty }) {
  const renaming = action === "renommer";
  const where = service ? `le service ${service}` : "ce service";
  let message = `La zone « ${zone} » n'a aucune ligne dans ${where} : rien n'a été ${renaming ? "renommé" : "supprimé"}.`;
  if (empty?.length) {
    const verb = renaming ? "renommez" : "supprimez";
    const list = formatServiceList(empty);
    message +=
      empty.length === 1
        ? ` Elle vient du service ${list} : ${verb}-la depuis ce service.`
        : ` Elle vient des services ${list} : ${verb}-la depuis ces services.`;
  }
  return message;
}
