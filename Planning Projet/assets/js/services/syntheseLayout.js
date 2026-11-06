// Mode d'affichage de la vue Synthese pour un projet, lu dans la colonne « Mode » de Projets2 :
// « Étage » = étages d'abord, sinon (défaut) zones d'abord. Module pur.
export const LAYOUT_ZONE = "zone";
export const LAYOUT_FLOOR = "floor";

const toText = (value) => (value === null || value === undefined ? "" : String(value).trim());

// Clé de comparaison : sans accents, casse, espaces ni ponctuation.
const modeKey = (value) =>
  toText(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");

export function parseLayoutMode(value) {
  const key = modeKey(value);
  return key === "etage" || key === "paretage" ? LAYOUT_FLOOR : LAYOUT_ZONE;
}

// Valeurs écrites dans Projets2.Mode par le bouton « Par étage » (relues par parseLayoutMode).
export const LAYOUT_MODE_VALUES = Object.freeze({ [LAYOUT_FLOOR]: "Étage", [LAYOUT_ZONE]: "Zone" });

// Les lignes du projet : celles dont l'id est dans project.ids (ou égale project.id), ou dont le
// numéro (non vide) est celui du projet. Par id croissant.
function projectRows(configs, project) {
  if (!project || !Array.isArray(configs)) return [];
  const ids = new Set((project.ids || []).map(toText));
  if (project.id !== undefined && project.id !== null) ids.add(toText(project.id));
  const number = toText(project.number);
  return configs
    .filter((config) => {
      const projectNumber = toText(config.projectNumber);
      return ids.has(toText(config.projectId)) || (projectNumber !== "" && projectNumber === number);
    })
    .sort((a, b) => Number(a.projectId) - Number(b.projectId));
}

// La première valeur non vide des lignes du projet décide.
export function layoutForProject(configs, project) {
  const decisive = projectRows(configs, project).find((config) => toText(config.modeRaw) !== "");
  return decisive ? parseLayoutMode(decisive.modeRaw) : LAYOUT_ZONE;
}

// La colonne Mode existe-t-elle pour ce projet ? (modeRaw absent = colonne absente de Projets2.)
export function hasLayoutModeColumn(configs, project) {
  return projectRows(configs, project).some((config) => config.modeRaw !== undefined);
}

const valueOfLayout = (layout) => LAYOUT_MODE_VALUES[layout === LAYOUT_FLOOR ? LAYOUT_FLOOR : LAYOUT_ZONE];

// Une seule action Grist qui écrit le mode dans toutes les lignes du projet ([] si aucune).
export function buildLayoutModeActions(configs, project, layout, { table, column }) {
  const ids = projectRows(configs, project).map((config) => Number(config.projectId));
  const value = valueOfLayout(layout);
  if (!ids.length) return [];
  if (ids.length === 1) return [["UpdateRecord", table, ids[0], { [column]: value }]];
  return [["BulkUpdateRecord", table, ids, { [column]: ids.map(() => value) }]];
}

// Copie des configurations où les lignes du projet portent déjà le nouveau mode.
export function withLayoutMode(configs, project, layout) {
  const rows = new Set(projectRows(configs, project));
  const value = valueOfLayout(layout);
  return configs.map((config) => (rows.has(config) ? { ...config, modeRaw: value } : config));
}
