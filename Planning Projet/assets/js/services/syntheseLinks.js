// Liens entre les tâches de la vue Synthese, comme les liens de MS Project : texte de la
// colonne Lien (« 131 FD+5 » : après la tâche 131, fin → début, 5 jours ouvrés plus tard),
// dates d'une tâche liée et cascade des dates vers l'aval. Module pur, sans DOM ni Grist.
import { endAfterWorkingDays, isWorkingDay } from "./syntheseTasks.js";

export const LINK_TYPES = Object.freeze(["FD", "DD", "FF"]);

// « 131 FD », « 131FD+5 », « 7 ff - 2 j » ; le décalage est en jours ouvrés.
const LINK_PATTERN = /^\s*(\d+)\s*(FD|DD|FF)\s*(?:([+-])\s*(\d+)\s*(?:j|jours?)?)?\s*$/i;

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isDated(task) {
  return task?.start instanceof Date && task?.end instanceof Date;
}

function isSameDay(left, right) {
  if (!(left instanceof Date) || !(right instanceof Date)) return left == null && right == null;
  return left.getTime() === right.getTime();
}

// Un Début tombant un week-end ou un férié avance au jour ouvré suivant ; une Fin
// recule au jour ouvré précédent. Une date déjà ouvrée est gardée telle quelle.
export function nextWorkingDay(date) {
  let cursor = toDay(date);
  while (!isWorkingDay(cursor)) cursor = shiftDays(cursor, 1);
  return cursor;
}

export function previousWorkingDay(date) {
  let cursor = toDay(date);
  while (!isWorkingDay(cursor)) cursor = shiftDays(cursor, -1);
  return cursor;
}

// Début d'un segment de `days` jours ouvrés finissant à `end` (déjà ouvré) : l'inverse de
// endAfterWorkingDays.
export function startBeforeWorkingDays(end, days) {
  const wanted = Math.max(1, Math.round(Number(days) || 1));
  let cursor = toDay(end);
  let counted = isWorkingDay(cursor) ? 1 : 0;
  while (counted < wanted) {
    cursor = shiftDays(cursor, -1);
    if (isWorkingDay(cursor)) counted += 1;
  }
  return cursor;
}

// `count` jours ouvrés après (count > 0) ou avant (count < 0) une date ; 0 : la date même.
export function addWorkingDays(date, count) {
  const steps = Math.trunc(Number(count) || 0);
  const direction = steps < 0 ? -1 : 1;
  let remaining = Math.abs(steps);
  let cursor = toDay(date);
  while (remaining > 0) {
    cursor = shiftDays(cursor, direction);
    if (isWorkingDay(cursor)) remaining -= 1;
  }
  return cursor;
}

export function parseLink(value) {
  const match = LINK_PATTERN.exec(value == null ? "" : String(value));
  if (!match) return null;
  const predId = Number(match[1]);
  if (!Number.isInteger(predId) || predId <= 0) return null;
  const lag = match[4] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  return { predId, type: match[2].toUpperCase(), lag };
}

export function formatLink({ predId, type, lag = 0 } = {}) {
  const shift = lag > 0 ? `+${lag}` : lag < 0 ? `${lag}` : "";
  return `${predId} ${type}${shift}`;
}

// Dates d'une tâche liée à un prédécesseur daté, pour sa durée en jours ouvrés (0 = jalon ;
// inconnue = un jour). FD : le jour ouvré qui suit la Fin du prédécesseur (un jalon se pose
// le jour même de cette Fin) ; DD : le Début du prédécesseur ; FF : la Fin du prédécesseur,
// Début à rebours. Le décalage ajoute (ou retire) des jours ouvrés.
export function computeLinkedDates(pred, link, durationDays) {
  if (!isDated(pred) || !link) return null;
  const days = Number.isInteger(durationDays) && durationDays >= 0 ? durationDays : 1;
  const lag = Number(link.lag) || 0;
  if (link.type === "FF") {
    const end = previousWorkingDay(addWorkingDays(pred.end, lag));
    if (days === 0) return { start: end, end, durationDays: 0, isMilestone: true };
    return { start: startBeforeWorkingDays(end, days), end, durationDays: days, isMilestone: false };
  }
  const anchor = link.type === "DD"
    ? addWorkingDays(pred.start, lag)
    : addWorkingDays(pred.end, days === 0 ? lag : lag + 1);
  const start = nextWorkingDay(anchor);
  if (days === 0) return { start, end: start, durationDays: 0, isMilestone: true };
  return { start, end: endAfterWorkingDays(start, days), durationDays: days, isMilestone: false };
}

// Tâches liées en aval d'une tâche qui vient de changer, recalculées de proche en proche
// (une tâche n'a qu'un prédécesseur). Une tâche dont le prédécesseur n'a pas de dates reste
// telle quelle, avec tout ce qui en dépend ; une tâche déjà traitée ne l'est pas deux fois
// (une boucle saisie à la main s'arrête). Renvoie les seules tâches dont les dates changent.
export function cascadeFrom(changed, tasks = []) {
  if (!changed) return [];
  const successors = new Map();
  (tasks || []).forEach((task) => {
    const predId = task?.link?.predId;
    if (!predId || task.id === changed.id) return;
    if (!successors.has(predId)) successors.set(predId, []);
    successors.get(predId).push(task);
  });
  const current = new Map([[changed.id, changed]]);
  const seen = new Set([changed.id]);
  const queue = [changed.id];
  const updates = [];
  while (queue.length) {
    const pred = current.get(queue.shift());
    (successors.get(pred.id) || []).forEach((task) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      const dates = computeLinkedDates(pred, task.link, task.durationDays);
      if (!dates) return;
      const next = { ...task, ...dates };
      current.set(task.id, next);
      if (!isSameDay(task.start, next.start) || !isSameDay(task.end, next.end) || task.isMilestone !== next.isMilestone) {
        updates.push(next);
      }
      queue.push(task.id);
    });
  }
  return updates.sort((a, b) => a.id - b.id);
}
