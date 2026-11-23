// Garde-fou de suppression d'une zone : une zone appartient au projet, mais
// « Supprimer » ne vide que les lignes du service courant. On refuse donc la
// suppression quand un AUTRE service (Structure / Synthese / Topographie) a des
// données dans la zone. Module pur : pas de DOM, pas de Grist.

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

export function findZoneDataInOtherServices(rowsByTable, { zone, service } = {}) {
  const zoneKey = zoneSoftKey(zone);
  if (!zoneKey) return [];
  const currentService = canonicalService(service);
  const counts = new Map();

  for (const tableName of ZONE_DATA_TABLES) {
    const rows = Array.isArray(rowsByTable?.[tableName]) ? rowsByTable[tableName] : [];
    for (const row of rows) {
      if (zoneSoftKey(row?.Zone) !== zoneKey) continue;
      const rowService = canonicalService(row?.Service);
      if (!rowService || rowService === currentService) continue;
      if (tableName === "Planning_Projet" && isEmptyAnchor(row)) continue;
      counts.set(rowService, (counts.get(rowService) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ service: name, count }))
    .sort((a, b) => a.service.localeCompare(b.service, "fr"));
}

function formatLineCount(count) {
  return `${count} ligne${count > 1 ? "s" : ""}`;
}

export function buildZoneDeletionRefusal(zone, found) {
  if (found.length === 1) {
    const { service, count } = found[0];
    return `Impossible de supprimer la zone « ${zone} » : le service ${service} y a des données (${formatLineCount(count)}).`;
  }
  const list = found.map(({ service, count }) => `${service} (${formatLineCount(count)})`).join(", ");
  return `Impossible de supprimer la zone « ${zone} » : d'autres services y ont des données — ${list}.`;
}
