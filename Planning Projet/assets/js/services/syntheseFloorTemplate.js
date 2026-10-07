// Modèle d'étage de la vue Synthese, repris du planning MS Project de l'utilisateur
// (« NIVEAU Sous-Sol 1 ») : trois cycles, deux sous-groupes « PLAN SYT CYCLE n » et vingt
// tâches avec leurs liens, créées sans durée (0) : les durées se saisissent. {E} = nom de l'étage.
// Module pur : les lignes à ajouter, puis Parent et Lien une fois les ids connus.
import {
  NATURES,
  PLANNING_TABLE,
  TASK_COLUMNS,
  buildFloorFields,
} from "./syntheseTaskModel.js";

export const FLOOR_NAME_TOKEN = "{E}";

// code : repère dans le modèle (Parent et Lien s'y réfèrent).
export const FLOOR_TEMPLATE = Object.freeze([
  { code: "T0", name: "RECEPTION ARCH/TOPO/STR" },
  { code: "C1", name: "CYCLE 1", nature: NATURES.cycle },
  { code: "T1", name: "FOND DE PLAN DE SYNTHESE NIV {E}", parent: "C1", link: "T0 DD" },
  { code: "T2", name: "DIFFUSION FDS Indice 0", parent: "C1", link: "T1 FD" },
  { code: "T3", name: "RECEPTION RENDU CET RESEAUX (GED)", parent: "C1", link: "T2 FD" },
  { code: "T4", name: "VISA Indice 0", parent: "C1", link: "T3 FD" },
  { code: "T5", name: "PLAN DE SYNTHESE RESEAUX NIV {E}", parent: "C1", link: "T3 FD" },
  { code: "T6", name: "REUNION + DIFFUSION SYT RSX Indice 0", nature: NATURES.meeting, parent: "C1", link: "T5 FD" },
  { code: "C2", name: "CYCLE 2", nature: NATURES.cycle },
  { code: "T7", name: "RECEPTION RENDU CET RSX RESA TER", parent: "C2", link: "T6 FD" },
  { code: "S2", name: "PLAN SYT CYCLE 2", nature: NATURES.subgroup, parent: "C2" },
  { code: "T8", name: "PLAN DE SYNTHESE RESEAUX NIV {E}", parent: "S2", link: "T7 FD" },
  { code: "T9", name: "PLAN DE SYNTHESE RESERVATIONS NIV {E}", parent: "S2", link: "T8 FF" },
  { code: "T10", name: "PLAN DE SYNTHESE TERMINAUX NIV {E}", parent: "S2", link: "T8 FF" },
  { code: "T11", name: "REUNION + DIFFUSION SYT", nature: NATURES.meeting, parent: "C2", link: "T8 FD" },
  { code: "C3", name: "CYCLE 3", nature: NATURES.cycle },
  { code: "T12", name: "RECEPTION RENDU CET RSX RESA TER", parent: "C3", link: "T11 FD" },
  { code: "T13", name: "VISA Indice A", parent: "C3", link: "T12 FD" },
  { code: "S3", name: "PLAN SYT CYCLE 3", nature: NATURES.subgroup, parent: "C3" },
  { code: "T14", name: "PLAN DE SYNTHESE RESEAUX NIV {E}", parent: "S3", link: "T12 FD" },
  { code: "T15", name: "PLAN DE SYNTHESE RESERVATIONS NIV {E}", parent: "S3", link: "T14 FF" },
  { code: "T16", name: "PLAN DE SYNTHESE TERMINAUX NIV {E}", parent: "S3", link: "T14 FF" },
  { code: "T17", name: "REUNION + DIFFUSION SYT", nature: NATURES.meeting, parent: "C3", link: "T14 FD" },
  { code: "T18", name: "SIGNATURE PLANS SYNTHESE", parent: "C3", link: "T13 FD+5" },
  { code: "T19", name: "DEMARRAGE GO {E} (date prévisionnelle)", nature: NATURES.kickoff, parent: "C3", link: "T18 FD" },
].map((item) => Object.freeze(item)));

function toText(value) {
  return value == null ? "" : String(value).trim();
}

// Les 26 lignes d'un nouvel étage, dans l'ordre du modèle : la ligne-étage, puis tâches,
// cycles et sous-groupes. Mêmes colonnes pour toutes (une seule écriture) ; pas de dates ;
// Parent et Lien viendront avec les ids.
export function buildFloorFromTemplate({ floorName = "", zoneName = "", projectName = "" } = {}) {
  const floor = toText(floorName);
  const zone = toText(zoneName);
  const project = toText(projectName);
  const floorRow = {
    ...buildFloorFields({ name: floor, zoneName: zone, projectName: project }),
    [TASK_COLUMNS.nature]: "",
    [TASK_COLUMNS.duration]: 0,
  };
  const rows = FLOOR_TEMPLATE.map((item) => ({
    [TASK_COLUMNS.name]: item.name.split(FLOOR_NAME_TOKEN).join(floor),
    [TASK_COLUMNS.zone]: zone,
    [TASK_COLUMNS.group]: floor,
    [TASK_COLUMNS.floor]: false,
    [TASK_COLUMNS.project]: project,
    [TASK_COLUMNS.nature]: item.nature || "",
    [TASK_COLUMNS.duration]: 0,
  }));
  return [floorRow, ...rows];
}

// Lignes → une écriture BulkAddRecord (ids choisis par Grist).
export function buildBulkAddAction(rows) {
  const names = [];
  rows.forEach((row) => Object.keys(row).forEach((name) => {
    if (!names.includes(name)) names.push(name);
  }));
  const columns = {};
  names.forEach((name) => {
    columns[name] = rows.map((row) => (name in row ? row[name] : null));
  });
  return ["BulkAddRecord", PLANNING_TABLE, rows.map(() => null), columns];
}

// « T13 FD+5 » → « 219 FD+5 » : le code de la tâche remplacé par son id.
function resolveLink(text, idByCode) {
  const [code, ...rest] = text.split(" ");
  return [String(idByCode.get(code)), ...rest].join(" ");
}

// Parent et Lien des lignes du modèle, d'après les ids rendus par Grist dans l'ordre des
// lignes de buildFloorFromTemplate : l'écriture à faire et les valeurs par ligne.
export function buildTemplateLinks(ids) {
  const rowIds = Array.isArray(ids) ? ids.map(Number) : [];
  if (rowIds.length !== FLOOR_TEMPLATE.length + 1 || !rowIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error("Ids des lignes du modèle d'étage incomplets.");
  }
  const idByCode = new Map(FLOOR_TEMPLATE.map((item, index) => [item.code, rowIds[index + 1]]));
  const fieldsById = new Map();
  FLOOR_TEMPLATE.forEach((item, index) => {
    if (!item.parent && !item.link) return;
    fieldsById.set(rowIds[index + 1], {
      [TASK_COLUMNS.parent]: item.parent ? String(idByCode.get(item.parent)) : "",
      [TASK_COLUMNS.link]: item.link ? resolveLink(item.link, idByCode) : "",
    });
  });
  const targetIds = [...fieldsById.keys()];
  const action = ["BulkUpdateRecord", PLANNING_TABLE, targetIds, {
    [TASK_COLUMNS.parent]: targetIds.map((id) => fieldsById.get(id)[TASK_COLUMNS.parent]),
    [TASK_COLUMNS.link]: targetIds.map((id) => fieldsById.get(id)[TASK_COLUMNS.link]),
  }];
  return { action, fieldsById };
}
