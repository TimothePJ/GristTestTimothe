// Segments de travail de la vue Synthese, stockés dans Planning_Projet.
// Module pur (ni DOM ni Grist) : jours ouvrés, charge de travail, lecture des
// lignes et champs à écrire. Testable sous Node.
import { isFrenchHoliday } from "../utils/frenchHolidays.js";
import { normalizeName } from "../utils/leaveAbsences.js";

export const SYNTHESE_TYPE_DOC = "SYNTHESE";
export const HOURS_PER_WORKING_DAY = 7;

export const SYNTHESE_TASK_COLUMNS = Object.freeze({
  id: "id",
  project: "NomProjet",
  name: "Taches",
  typeDoc: "Type_doc",
  start: "Diff_coffrage",
  end: "Diff_armature",
  duration: "Duree_1",
  realise: "Realise",
  service: "Service",
  resource: "Ressource",
});

export function isSyntheseTypeDoc(value) {
  return normalizeName(value).toUpperCase() === SYNTHESE_TYPE_DOC;
}

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function isWorkingDay(date) {
  const weekDay = date.getDay();
  return weekDay !== 0 && weekDay !== 6 && !isFrenchHoliday(date);
}

// Une date Grist arrive en secondes (colonne Date lue par REST), en texte ISO ou
// au format jj/mm/aaaa. On la ramène au jour calendaire local.
export function parseGristDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toDay(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
    const utc = new Date(ms);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }
  const text = toText(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const french = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : french
      ? [Number(french[3]), Number(french[2]), Number(french[1])]
      : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Un segment commence et finit sur un jour travaillé : le début avance au
// premier jour ouvré, la fin recule au dernier. Les week-ends et fériés situés
// à l'intérieur restent dans le segment mais ne comptent pas dans sa durée.
// Renvoie null quand la plage ne contient aucun jour ouvré.
export function snapToWorkingRange(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  let first = toDay(start <= end ? start : end);
  let last = toDay(start <= end ? end : start);
  while (first <= last && !isWorkingDay(first)) first = shiftDays(first, 1);
  while (last >= first && !isWorkingDay(last)) last = shiftDays(last, -1);
  return first <= last ? { start: first, end: last } : null;
}

// Jours ouvrés entre deux dates, bornes incluses.
export function countWorkingDays(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end < start) return 0;
  let count = 0;
  for (let cursor = toDay(start); cursor <= end; cursor = shiftDays(cursor, 1)) {
    if (isWorkingDay(cursor)) count += 1;
  }
  return count;
}

// Fin d'un segment de `days` jours ouvrés commençant à `start` (déjà ouvré).
export function endAfterWorkingDays(start, days) {
  const wanted = Math.max(1, Math.round(Number(days) || 1));
  let cursor = toDay(start);
  let counted = isWorkingDay(cursor) ? 1 : 0;
  while (counted < wanted) {
    cursor = shiftDays(cursor, 1);
    if (isWorkingDay(cursor)) counted += 1;
  }
  return cursor;
}

export function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

export function computeWorkHours(workingDays) {
  return Math.max(0, Number(workingDays) || 0) * HOURS_PER_WORKING_DAY;
}

export function computeRemainingHours(workHours, realise) {
  const remaining = workHours * (1 - clampPercent(realise) / 100);
  // Arrondi à la minute : c'est la précision affichée (« 19H15min »).
  return Math.round(remaining * 60) / 60;
}

// En retard : la date de fin est passée (avant aujourd'hui) sans que la tâche
// soit réalisée à 100 %.
export function isTaskLate(task, today = new Date()) {
  if (!(task?.end instanceof Date) || clampPercent(task.realise) >= 100) return false;
  return task.end < toDay(today);
}

export function getProgressState(realise) {
  const percent = clampPercent(realise);
  if (percent >= 100) return "done";
  if (percent > 0) return "progress";
  return "todo";
}

// Lignes Planning_Projet -> segments. Seules les lignes SYNTHESE datées sont
// retenues ; la durée est recalculée depuis les dates, qui font foi.
export function buildSyntheseTasks(rows, columns = SYNTHESE_TASK_COLUMNS) {
  return (rows || []).flatMap((row) => {
    const id = Number(row?.[columns.id]);
    if (!Number.isInteger(id) || id <= 0) return [];
    if (!isSyntheseTypeDoc(row?.[columns.typeDoc])) return [];
    const range = snapToWorkingRange(
      parseGristDate(row?.[columns.start]),
      parseGristDate(row?.[columns.end])
    );
    if (!range) return [];
    const durationDays = countWorkingDays(range.start, range.end);
    const realise = clampPercent(row?.[columns.realise]);
    const workHours = computeWorkHours(durationDays);
    const resourceName = toText(row?.[columns.resource]);
    return [{
      id,
      name: toText(row?.[columns.name]) || "Sans nom",
      start: range.start,
      end: range.end,
      durationDays,
      realise,
      workHours,
      remainingHours: computeRemainingHours(workHours, realise),
      resourceName,
      resourceKey: normalizeName(resourceName),
    }];
  });
}

// Champs écrits pour un segment. Service et NomProjet sont aussi imposés par le
// contexte partagé à l'écriture ; on les pose quand même pour qu'une ligne créée
// ici soit lisible telle quelle.
export function buildSyntheseTaskFields({
  name,
  start,
  end,
  realise = 0,
  resourceName,
  projectName,
  service,
} = {}, columns = SYNTHESE_TASK_COLUMNS) {
  const range = snapToWorkingRange(start, end);
  if (!range) throw new Error("Le segment doit contenir au moins un jour ouvré.");
  const fields = {
    [columns.name]: toText(name),
    [columns.typeDoc]: SYNTHESE_TYPE_DOC,
    [columns.start]: toIsoDate(range.start),
    [columns.end]: toIsoDate(range.end),
    [columns.duration]: countWorkingDays(range.start, range.end),
    [columns.realise]: clampPercent(realise),
  };
  if (resourceName !== undefined) fields[columns.resource] = toText(resourceName);
  if (projectName) fields[columns.project] = toText(projectName);
  if (service) fields[columns.service] = toText(service);
  return fields;
}

const WEEK_DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// « Lun 21/09/26 », comme l'infobulle de MS Project.
export function formatTaskDate(date) {
  if (!(date instanceof Date)) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${WEEK_DAYS[date.getDay()]} ${day}/${month}/${year}`;
}

// « 35H00min », « 19H15min ».
export function formatHours(hours) {
  const totalMinutes = Math.max(0, Math.round((Number(hours) || 0) * 60));
  const wholeHours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${wholeHours}H${minutes}min`;
}

export function formatDays(days) {
  const count = Math.max(0, Number(days) || 0);
  return `${count} jour${count > 1 ? "s" : ""}`;
}
