// Lien d'une tâche de la vue Synthese, comme dans MS Project : chaque ligne du tableau a un numéro
// (toutes les lignes, comme si tout était déplié : replier ou filtrer ne le change pas) ; la colonne
// Lien, en lecture seule, montre la tâche à suivre par son numéro (« 45FD+5 »). Le lien se choisit
// dans la fenêtre ouverte par le clic droit sur une tâche : la tâche à suivre, le type, le décalage.
// Une tâche n'a qu'un prédécesseur. Grist garde le lien par id de ligne (« 993 FD+5 »). Module pur,
// sans DOM ni Grist.
import { MAX_DURATION_DAYS, TASK_COLUMNS, buildRowModel, dateFieldsOf, formatDate } from "./syntheseTaskModel.js";
import { computeLinkedDates, formatLink } from "./syntheseLinks.js";
import { allTasksOf, findUpstream, linkMap } from "./syntheseTaskOrder.js";

// Numéros des lignes des sections, toutes dépliées : `byKey` (clé de ligne → numéro) et `lineAt`
// (numéro → ligne).
export function lineNumbersOf(sections) {
  const byKey = new Map();
  const lineAt = new Map();
  buildRowModel(sections).forEach((line, index) => {
    byKey.set(line.key, index + 1);
    lineAt.set(index + 1, line);
  });
  return { byKey, lineAt };
}

// Le lien d'une tâche tel que la colonne l'affiche : numéro de la tâche à suivre, type, décalage
// (« 21FD+5 ») ; « » sans lien ; « ? » à la place du numéro si la tâche à suivre n'a pas de ligne.
export function formatLineLink(link, numbering) {
  if (!link) return "";
  const number = numbering.byKey.get(`task:${link.predId}`) ?? "?";
  const lag = link.lag > 0 ? `+${link.lag}` : link.lag < 0 ? `${link.lag}` : "";
  return `${number}${link.type}${lag}`;
}

// Chaque ligne porte son numéro (`lineNumber`) et, pour une tâche, son lien affiché (`linkText`).
export function applyLineNumbers(lines, numbering) {
  return (lines || []).map((line) => ({
    ...line,
    lineNumber: numbering.byKey.get(line.key) ?? null,
    linkText: line.kind === "task" ? formatLineLink(line.link, numbering) : "",
  }));
}

function sameLink(left, right) {
  if (!left || !right) return !left && !right;
  return left.predId === right.predId && left.type === right.type && (left.lag || 0) === (right.lag || 0);
}

function datesText(task) {
  return task.start || task.end ? `${formatDate(task.start)} → ${formatDate(task.end)}` : "sans dates";
}

// Choix de la fenêtre de lien de la tâche `taskId` : son nom, son lien actuel, et les lignes à
// proposer — les tâches de sa zone, dans l'ordre du tableau (tout déplié), sous les en-têtes de leurs
// étages et cycles (`level` : 0 pour un étage ou une tâche hors étage). Chaque tâche porte son numéro,
// ses dates, si elle est le lien actuel (`selected`) et si elle ne peut pas l'être (`disabled`,
// `note` : la tâche elle-même, ou une tâche qui dépend d'elle — ce serait une boucle). Une tâche à
// suivre d'une autre zone est ajoutée à la fin, sous « Autres zones ».
export function linkChoices({ sections, taskId, numbering }) {
  const tasks = allTasksOf(sections);
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;
  const links = linkMap(tasks);
  const current = task.link || null;
  const taskRow = (line, level) => {
    const self = line.taskId === taskId;
    const dependent = !self && findUpstream(links, line.taskId, (rowId) => rowId === taskId) != null;
    const candidate = tasks.find((item) => item.id === line.taskId);
    return {
      kind: "task",
      taskId: line.taskId,
      lineNumber: numbering.byKey.get(line.key) ?? null,
      name: line.name,
      level,
      dates: datesText(candidate || line),
      disabled: self || dependent,
      note: self ? "elle-même" : dependent ? "dépend d'elle" : "",
      selected: current?.predId === line.taskId,
    };
  };
  const section = sections.find((candidate) => candidate.zoneKey === task.zoneKey);
  const rows = [];
  buildRowModel(section ? [section] : []).forEach((line) => {
    if (line.kind === "zone") return;
    const level = Math.max(0, line.level - 1);
    if (line.kind === "task") rows.push(taskRow(line, level));
    else rows.push({ kind: "header", label: line.name, level });
  });
  if (current && !rows.some((row) => row.taskId === current.predId)) {
    const line = numbering.lineAt.get(numbering.byKey.get(`task:${current.predId}`));
    if (line) rows.push({ kind: "header", label: "Autres zones", level: 0 }, taskRow(line, 0));
  }
  return { taskName: task.name, current, rows };
}

// Nouveau lien de la tâche `taskId` (`link` : { predId, type, lag }, ou null pour plus de lien).
// Accepté : la tâche, son lien, et les colonnes à écrire — Lien, puis les dates que lui donne son
// lien (avec sa durée) si la tâche à suivre est datée ; sans lien : dates gardées ; même lien : les
// dates seules, si la tâche s'en était écartée (Valider la recale), sinon rien. Refusé, avec le motif : la tâche elle-même, une boucle, une tâche à suivre disparue, un
// décalage qui n'est pas un entier ou dépasse MAX_DURATION_DAYS jours.
export function planLinkChange({ sections, taskId, link }) {
  const tasks = allTasksOf(sections);
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return { ok: false, error: "Tâche introuvable." };
  if (!link) {
    return { ok: true, task: { ...task, link: null }, fields: task.link ? { [TASK_COLUMNS.link]: "" } : {} };
  }
  const lag = Number(link.lag) || 0;
  if (!Number.isInteger(lag)) return { ok: false, error: "Le décalage doit être un nombre entier de jours ouvrés." };
  // Plafonné comme la Durée : un décalage démesuré ferait compter des millions de jours ouvrés.
  if (Math.abs(lag) > MAX_DURATION_DAYS) {
    return { ok: false, error: `Le décalage est limité à ${MAX_DURATION_DAYS} jours ouvrés.` };
  }
  if (link.predId === taskId) return { ok: false, error: "Une tâche ne peut pas se suivre elle-même." };
  const pred = tasks.find((candidate) => candidate.id === link.predId);
  if (!pred) return { ok: false, error: "La tâche à suivre n'existe plus." };
  if (findUpstream(linkMap(tasks), pred.id, (rowId) => rowId === taskId) != null) {
    return { ok: false, error: `Ce lien ferait une boucle : « ${pred.name} » dépend déjà de « ${task.name} ».` };
  }
  const next = { predId: pred.id, type: link.type, lag };
  const dates = computeLinkedDates(pred, next, task.isMilestone ? 0 : task.durationDays);
  const changed = { ...task, ...(dates || {}), link: next };
  if (sameLink(task.link, next)) {
    const moved = dates && JSON.stringify(dateFieldsOf(changed)) !== JSON.stringify(dateFieldsOf(task));
    return { ok: true, task: moved ? changed : task, fields: moved ? dateFieldsOf(changed) : {} };
  }
  return {
    ok: true,
    task: changed,
    fields: { [TASK_COLUMNS.link]: formatLink(next), ...(dates ? dateFieldsOf(changed) : {}) },
  };
}

// Ce que fera le lien choisi, en une phrase pour la fenêtre : les nouvelles dates, ou pourquoi il
// est refusé, ou qu'il ne change rien.
export function previewLink({ sections, taskId, link }) {
  const result = planLinkChange({ sections, taskId, link });
  if (!result.ok) return result.error;
  if (!Object.keys(result.fields).length) return "Lien inchangé.";
  if (!link) return "Sans lien : la tâche garde ses dates.";
  if (!(TASK_COLUMNS.start in result.fields)) return "La tâche à suivre n'a pas de dates : seul le lien sera enregistré.";
  return `Nouvelles dates : ${formatDate(result.task.start)} → ${formatDate(result.task.end)}`;
}
