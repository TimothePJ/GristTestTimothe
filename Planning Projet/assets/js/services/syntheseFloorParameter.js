// Paramètre du projet : le modèle d'étage de la vue Synthese, enregistré en JSON dans
// Projets2.Synthese_Parametre (même valeur sur toutes les lignes du projet). Module pur :
// lecture tolérante du JSON, écriture, lignes en mémoire datées pour la fenêtre « Paramètre »,
// relecture de ces lignes et avertissements. Format : voir la spec (§4.2).
import {
  FLOOR_TEMPLATE,
  buildFloorFromTemplate,
  buildTemplateLinks,
} from "./syntheseFloorTemplate.js";
import {
  MAX_CODE_LENGTH,
  MAX_DURATION_DAYS,
  MAX_TASK_NAME_LENGTH,
  NATURES,
  TASK_COLUMNS,
  buildRowModel,
  buildSections,
  dateFieldsOf,
  isFloorValue,
  isTaskRow,
  natureKeyOf,
  readTask,
} from "./syntheseTaskModel.js";
import { cascadeFrom, computeLinkedDates, formatLink } from "./syntheseLinks.js";
import { findFloorStart, readControlTasks } from "./structureLinkModel.js";
import { projectRows } from "./syntheseLayout.js";
import { parseGristDate } from "./syntheseTasks.js";

export const MODEL_ANCHOR_DATE = "2026-01-05"; // un lundi : les tâches sans lien y commencent
export const MODEL_FLOOR_NAME = "Étage type";
export const MODEL_ZONE_NAME = "Modèle";
export const MODEL_PROJECT_NAME = "Modèle d'étage";

const FORMAT_VERSION = 1;
const LINK_TEXT = /^(\S+)\s+(FD|DD|FF)(?:([+-])(\d+))?$/i;

const toText = (value) => (value == null ? "" : String(value).trim());

const GROUP_NATURES = new Map([["cycle", NATURES.cycle], ["sous-groupe", NATURES.subgroup]]);
const TASK_NATURES = new Map([
  ["reunion", NATURES.meeting],
  ["demarrage", NATURES.kickoff],
  ["signature", NATURES.signature],
]);

// « CODE FD+5 » lu en { code, type, lag } ; null si illisible.
function readLinkText(value) {
  const match = LINK_TEXT.exec(toText(value));
  if (!match) return null;
  const lag = match[4] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  return { code: match[1], type: match[2].toUpperCase(), lag };
}

function linkText({ code, type, lag = 0 }) {
  return formatLink({ predId: code, type, lag });
}

function readDays(value) {
  const days = typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number(value) : NaN;
  return Number.isInteger(days) && days >= 0 && days <= MAX_DURATION_DAYS ? days : 0;
}

// Forme canonique d'un élément : seuls les champs utiles à son type, dans un ordre fixe.
// id2, indice et control n'y figurent que s'ils servent (tâches seulement).
function canonicalItem(item) {
  const natureKey = natureKeyOf(item.nature);
  const code = toText(item.code);
  const name = toText(item.name).slice(0, MAX_TASK_NAME_LENGTH);
  const parent = toText(item.parent);
  if (GROUP_NATURES.has(natureKey)) return { code, name, nature: GROUP_NATURES.get(natureKey), parent };
  const link = readLinkText(item.link);
  const id2 = toText(item.id2).slice(0, MAX_CODE_LENGTH);
  const indice = toText(item.indice).slice(0, MAX_CODE_LENGTH);
  return {
    code,
    name,
    nature: TASK_NATURES.get(natureKey) || "",
    parent,
    link: link ? linkText(link) : "",
    days: readDays(item.days),
    ...(id2 ? { id2 } : {}),
    ...(indice ? { indice } : {}),
    ...(item.control === true ? { control: true } : {}),
  };
}

const isGroupItem = (item) => item.nature === NATURES.cycle || item.nature === NATURES.subgroup;

// Texte → éléments du modèle, ou null (vide, illisible, version inconnue, aucune tâche : on
// prend alors le modèle d'origine). Un élément invalide est ignoré sans faire échouer le reste.
export function parseFloorTemplate(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.version !== FORMAT_VERSION || !Array.isArray(data.items)) return null;
  const items = [];
  const codes = new Set();
  const groupCodes = new Set();
  data.items.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const item = canonicalItem(raw);
    if (!item.code || !item.name || codes.has(item.code)) return;
    codes.add(item.code);
    if (item.parent && !groupCodes.has(item.parent)) item.parent = "";
    if (isGroupItem(item)) groupCodes.add(item.code);
    items.push(item);
  });
  const taskCodes = new Set(items.filter((item) => !isGroupItem(item)).map((item) => item.code));
  items.forEach((item) => {
    if (isGroupItem(item) || !item.link) return;
    const link = readLinkText(item.link);
    if (!link || link.code === item.code || !taskCodes.has(link.code)) item.link = "";
  });
  return taskCodes.size ? items : null;
}

// Éléments → texte JSON (version 1).
export function serializeFloorTemplate(items) {
  const canonical = (Array.isArray(items) ? items : []).map(canonicalItem);
  return JSON.stringify({ version: FORMAT_VERSION, items: canonical });
}

// Les lignes en mémoire de la fenêtre : la ligne-étage, puis les éléments du modèle, avec toutes
// les colonnes que le contrôleur de la vue Synthese détecte. Les noms gardent « {E} ». Les
// tâches sans lien commencent le lundi fictif ; les autres prennent leurs dates par la cascade.
export function templateToRows(items, { firstId = 1 } = {}) {
  const template = Array.isArray(items) ? items : [];
  const built = buildFloorFromTemplate({
    floorName: MODEL_FLOOR_NAME,
    zoneName: MODEL_ZONE_NAME,
    projectName: MODEL_PROJECT_NAME,
    template,
    replaceToken: false,
    withFormworkCheck: true,
  });
  const ids = built.map((_, index) => firstId + index);
  const { fieldsById } = buildTemplateLinks(ids, template);
  const rows = built.map((row, index) => ({
    id: ids[index],
    [TASK_COLUMNS.service]: "Synthese",
    [TASK_COLUMNS.typeDoc]: "",
    [TASK_COLUMNS.id2]: "",
    [TASK_COLUMNS.indice]: "",
    [TASK_COLUMNS.order]: "",
    [TASK_COLUMNS.formworkCheck]: false,
    [TASK_COLUMNS.start]: null,
    [TASK_COLUMNS.end]: null,
    [TASK_COLUMNS.parent]: "",
    [TASK_COLUMNS.link]: "",
    ...row,
    ...(fieldsById.get(ids[index]) || {}),
  }));
  dateRows(rows);
  return rows;
}

// Pose Début, Fin et Durée sur les tâches : racines au lundi fictif, le reste par cascade.
function dateRows(rows) {
  const tasks = rows.filter(isTaskRow).map(readTask);
  const anchor = parseGristDate(MODEL_ANCHOR_DATE);
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  tasks.filter((entry) => !entry.link).forEach((root) => {
    const dates = computeLinkedDates({ start: anchor, end: anchor }, { type: "DD", lag: 0 }, root.durationDays);
    if (dates) byId.set(root.id, { ...root, ...dates });
  });
  tasks.filter((entry) => !entry.link).forEach((root) => {
    cascadeFrom(byId.get(root.id), [...byId.values()]).forEach((next) => byId.set(next.id, next));
  });
  rows.forEach((row) => {
    const entry = byId.get(row.id);
    if (entry?.start && entry?.end) Object.assign(row, dateFieldsOf(entry));
  });
}

// Lignes de la fenêtre → éléments du modèle, dans l'ordre affiché, tout déplié. Les codes sont
// régénérés (T1… pour les tâches, C1… pour les cycles et sous-groupes) ; Parent et Lien passent
// d'id en code.
export function templateItemsFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const rowById = new Map(list.map((row) => [Number(row?.[TASK_COLUMNS.id]), row]));
  const lines = buildRowModel(buildSections({ rows: list }))
    .filter((line) => (line.kind === "task" || line.kind === "group") && line.floorKey);
  const codeByKey = new Map();
  let tasks = 0;
  let groups = 0;
  lines.forEach((line) => {
    if (line.kind === "group") codeByKey.set(`g${line.groupRowId}`, `C${++groups}`);
    else codeByKey.set(`t${line.taskId}`, `T${++tasks}`);
  });
  return lines.map((line) => {
    if (line.kind === "group") {
      const parent = codeByKey.get(`g${line.parentGroupRowId}`) || "";
      return {
        code: codeByKey.get(`g${line.groupRowId}`),
        name: toText(line.name).slice(0, MAX_TASK_NAME_LENGTH),
        nature: line.depth === 1 ? NATURES.cycle : NATURES.subgroup,
        parent,
      };
    }
    const predCode = line.link ? codeByKey.get(`t${line.link.predId}`) : "";
    return canonicalItem({
      code: codeByKey.get(`t${line.taskId}`),
      name: line.name,
      nature: TASK_NATURES.get(line.nature) || "",
      parent: codeByKey.get(`g${line.groupRowId}`) || "",
      link: predCode ? linkText({ code: predCode, type: line.link.type, lag: line.link.lag }) : "",
      days: line.durationDays ?? 0,
      id2: line.id2,
      indice: line.indice,
      control: isFloorValue(rowById.get(line.taskId)?.[TASK_COLUMNS.formworkCheck]),
    });
  });
}

// Ce que d'autres fonctions retrouvent par nom ou Nature : s'il manque, un message (sans blocage).
export function templateWarnings(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const tasks = list.filter(isTaskRow).map(readTask);
  const warnings = [];
  if (!findFloorStart(tasks).plan) {
    warnings.push("Sans tâche « FOND DE PLAN DE SYNTHESE… », « Lien Structure » ne pourra pas poser la date 0 Prev.");
  }
  if (readControlTasks(list).size === 0) {
    warnings.push("Sans tâche cochée « Contrôler par rapport au coffrage » et sans « PLAN DE SYNTHESE RESERVATIONS… » dans un cycle « CYCLE 3 », aucune tâche n'est contrôlée par défaut.");
  }
  if (!tasks.some((task) => task.natureKey === "demarrage")) {
    warnings.push("Sans tâche de Nature « Demarrage », la vue Global ne comparera pas le démarrage à celui de Structure.");
  }
  return warnings;
}

// Le paramètre d'un projet : la colonne existe-t-elle (valeur non undefined sur une ligne du
// projet), les éléments lus (première valeur non vide), et si cette valeur est illisible.
export function readProjectParameter(configs, project) {
  const projectConfigs = projectRows(configs, project);
  const column = projectConfigs.some((config) => config.parametreRaw !== undefined);
  const decisive = projectConfigs.find((config) => toText(config.parametreRaw) !== "");
  if (!decisive) return { column, items: null, invalid: false };
  const items = parseFloorTemplate(decisive.parametreRaw);
  return { column, items, invalid: items === null };
}

// Le modèle à appliquer à un nouvel étage : celui du projet, sinon le modèle d'origine.
export function floorTemplateFor(configs, project) {
  const { items, invalid } = readProjectParameter(configs, project);
  return { template: items || FLOOR_TEMPLATE, invalid };
}

// Une seule action Grist qui écrit le texte dans toutes les lignes Projets2 du projet.
export function buildParametreActions(configs, project, text, { table, column }) {
  const ids = projectRows(configs, project).map((config) => Number(config.projectId));
  if (!ids.length) return [];
  if (ids.length === 1) return [["UpdateRecord", table, ids[0], { [column]: text }]];
  return [["BulkUpdateRecord", table, ids, { [column]: ids.map(() => text) }]];
}

// Copie des configurations où les lignes du projet portent déjà le nouveau texte.
export function withParametre(configs, project, text) {
  const rows = new Set(projectRows(configs, project));
  return configs.map((config) => (rows.has(config) ? { ...config, parametreRaw: text } : config));
}

// Clé stable d'un projet du contexte partagé (objet { id, number, name, … }) : identifiant, sinon
// numéro, sinon nom ; vide sans projet. Sert à reconnaître « le même projet » d'une ouverture à l'autre.
export function projectKeyOf(project) {
  if (project == null) return "";
  return [project.id, project.number, project.name].map(toText).find((text) => text !== "") || "";
}

// La fenêtre « Paramètre » se ferme sans confirmation si le service n'est plus Synthese ou si le
// projet courant n'est plus celui qu'elle a ouvert.
export function shouldCloseParameterDialog({ selectedService, currentKey, openedKey, service = "Synthese" }) {
  return selectedService !== service || currentKey !== openedKey;
}
