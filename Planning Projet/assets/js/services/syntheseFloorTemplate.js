// Modèle d'étage de la vue Synthese, repris du planning MS Project de l'utilisateur
// (« NIVEAU Sous-Sol 1 ») : trois cycles, deux sous-groupes « PLAN SYT CYCLE n » et vingt
// tâches avec leurs liens, créées sans durée (0) : les durées se saisissent. {E} = nom de l'étage.
// SIGNATURE et DEMARRAGE GO ne sont dans aucun cycle : c'est la fin d'étage fixe (voir floorEndOf).
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
  // Fin d'étage fixe, hors des cycles : 5 jours ouvrés après la dernière tâche du dernier cycle (ici la
  // REUNION + DIFFUSION SYT du cycle 3) ; DEMARRAGE GO la suit le même jour.
  { code: "T18", name: "SIGNATURE PLANS SYNTHESE", nature: NATURES.signature, link: "T17 FD+5" },
  { code: "T19", name: "DEMARRAGE GO {E} (date prévisionnelle)", nature: NATURES.kickoff, link: "T18 FD" },
].map((item) => Object.freeze(item)));

function toText(value) {
  return value == null ? "" : String(value).trim();
}

// Profondeur d'un élément dans le modèle : 1 = à la racine, +1 par parent (garde contre un cycle).
function templateDepth(item, byCode) {
  let depth = 1;
  let current = item;
  while (current.parent && byCode.has(current.parent) && depth <= byCode.size) {
    current = byCode.get(current.parent);
    depth += 1;
  }
  return depth;
}

// Les lignes d'un nouvel étage, dans l'ordre du modèle : la ligne-étage, puis tâches, cycles et
// sous-groupes (26 lignes pour FLOOR_TEMPLATE). Mêmes colonnes pour toutes (une seule écriture) ;
// pas de dates ; Parent et Lien viendront avec les ids. Un groupe prend sa Nature d'après sa
// profondeur réelle dans le modèle (1 = cycle, au-delà = sous-groupe) ; une tâche garde celle de
// l'élément. Les colonnes N° / Indice / Contrôle coffrage ne s'ajoutent, à toutes les lignes, que
// si le modèle s'en sert (le contrôle seulement avec withFormworkCheck).
export function buildFloorFromTemplate({
  floorName = "",
  zoneName = "",
  projectName = "",
  template = FLOOR_TEMPLATE,
  replaceToken = true,
  withFormworkCheck = false,
} = {}) {
  const floor = toText(floorName);
  const zone = toText(zoneName);
  const project = toText(projectName);
  const byCode = new Map(template.map((item) => [item.code, item]));
  const isGroup = (item) => template.some((other) => other.parent === item.code);
  const useId2 = template.some((item) => toText(item.id2));
  const useIndice = template.some((item) => toText(item.indice));
  const useCheck = withFormworkCheck && template.some((item) => item.control === true);
  const optional = (item) => ({
    ...(useId2 ? { [TASK_COLUMNS.id2]: toText(item?.id2) } : {}),
    ...(useIndice ? { [TASK_COLUMNS.indice]: toText(item?.indice) } : {}),
    ...(useCheck ? { [TASK_COLUMNS.formworkCheck]: item?.control === true } : {}),
  });
  const floorRow = {
    ...buildFloorFields({ name: floor, zoneName: zone, projectName: project }),
    [TASK_COLUMNS.nature]: "",
    [TASK_COLUMNS.duration]: 0,
    ...optional(null),
  };
  const rows = template.map((item) => {
    const group = isGroup(item) || item.nature === NATURES.cycle || item.nature === NATURES.subgroup;
    let nature = item.nature || "";
    if (group) nature = templateDepth(item, byCode) === 1 ? NATURES.cycle : NATURES.subgroup;
    const days = Number.parseInt(item.days, 10);
    return {
      [TASK_COLUMNS.name]: replaceToken ? item.name.split(FLOOR_NAME_TOKEN).join(floor) : item.name,
      [TASK_COLUMNS.zone]: zone,
      [TASK_COLUMNS.group]: floor,
      [TASK_COLUMNS.floor]: false,
      [TASK_COLUMNS.project]: project,
      [TASK_COLUMNS.nature]: nature,
      [TASK_COLUMNS.duration]: !group && Number.isInteger(days) && days > 0 ? days : 0,
      ...optional(item),
    };
  });
  return [floorRow, ...rows];
}

// La ligne vide qui garde une zone créée depuis la fenêtre « Ajouter un étage… » (comme « Ajouter
// une zone » du bandeau) : ni tâche, ni N°, ni type de document, donc jamais une ligne du tableau ;
// elle fait seulement exister la zone, qui reste si l'étage est supprimé. Mêmes colonnes que les
// lignes du modèle, pour une seule écriture.
export function buildZoneAnchorRow({ zoneName = "", projectName = "" } = {}) {
  return {
    [TASK_COLUMNS.name]: "",
    [TASK_COLUMNS.zone]: toText(zoneName),
    [TASK_COLUMNS.group]: "",
    [TASK_COLUMNS.floor]: false,
    [TASK_COLUMNS.project]: toText(projectName),
    [TASK_COLUMNS.nature]: "",
    [TASK_COLUMNS.duration]: 0,
  };
}

// Les colonnes optionnelles (N°, Indice, Contrôle coffrage) de la ligne-étage `floorRow`, reprises
// vides ("" / false) sur une ligne d'ancrage : toutes les lignes d'une écriture ont les mêmes colonnes.
export function completeZoneAnchorRow(anchor, floorRow) {
  const optional = {};
  [TASK_COLUMNS.id2, TASK_COLUMNS.indice, TASK_COLUMNS.formworkCheck].forEach((column) => {
    if (floorRow && column in floorRow) optional[column] = typeof floorRow[column] === "boolean" ? false : "";
  });
  return { ...optional, ...anchor };
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

// « T17 FD+5 » → « 224 FD+5 » : le code de la tâche remplacé par son id.
function resolveLink(text, idByCode) {
  const [code, ...rest] = text.split(" ");
  return [String(idByCode.get(code)), ...rest].join(" ");
}

// Parent et Lien des lignes du modèle, d'après les ids rendus par Grist dans l'ordre des
// lignes de buildFloorFromTemplate : l'écriture à faire et les valeurs par ligne.
export function buildTemplateLinks(ids, template = FLOOR_TEMPLATE) {
  const rowIds = Array.isArray(ids) ? ids.map(Number) : [];
  if (rowIds.length !== template.length + 1 || !rowIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error("Ids des lignes du modèle d'étage incomplets.");
  }
  const idByCode = new Map(template.map((item, index) => [item.code, rowIds[index + 1]]));
  const fieldsById = new Map();
  template.forEach((item, index) => {
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
