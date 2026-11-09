// Dates manuelles du lissage : lecture, conversion et comparaison (spec
// 2026-11-09 §3, §4.4).
//
// Une date manuelle impose la date de fin d'un plan en mode lissé ; elle vit
// dans la colonne Date `Planning_Projet.Date_Manuel_Lissage` et n'est utilisée
// que par la vue de lissage (jamais par le planning réel).
//
// Module PUR, sans DOM ni Grist : il transforme des lignes de Planning_Projet
// en `{ [idLigne]: "AAAA-MM-JJ" }` (forme de `settings.manualDates` attendue par
// smoothTasks), et compare deux de ces dictionnaires pour n'écrire que ce qui
// a changé.

import { parseCalendarDate, formatIsoDate } from "../utils/dates.js";
import { monthKeyOf } from "./taskSmoothing.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Vrai pour une date AAAA-MM-JJ réelle (le 30 février est refusé).
export function isIsoDate(value) {
  const match = ISO_DATE.exec(String(value ?? ""));
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Lit les dates manuelles des lignes de Planning_Projet. `hasColumn` dit si la
// colonne existe dans le document (au moins une ligne porte la propriété) ;
// une valeur vide ou illisible n'a pas d'entrée.
export function readManualDates(rows, columns) {
  const key = columns.manualSmoothingDate;
  let hasColumn = false;
  const dates = {};
  for (const row of rows || []) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, key)) continue;
    hasColumn = true;
    const iso = formatIsoDate(parseCalendarDate(row[key]));
    if (iso) dates[String(row[columns.id])] = iso;
  }
  return { hasColumn, dates };
}

// "AAAA-MM-JJ" -> secondes à minuit UTC (format d'une colonne Date de Grist) ;
// null pour une date vide ou invalide (efface la cellule).
export function isoToGristDate(iso) {
  if (!isIsoDate(iso)) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

// Différences entre deux dictionnaires : une entrée par clé dont la valeur
// change (clé absente = null), triée par rowId croissant.
export function diffManualDates(before, after) {
  const a = before || {};
  const b = after || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes = [];
  for (const key of keys) {
    const was = a[key] ?? null;
    const now = b[key] ?? null;
    if (was !== now) changes.push({ rowId: Number(key), iso: now });
  }
  return changes.sort((x, y) => x.rowId - y.rowId);
}

export function sameManualDates(a, b) {
  return diffManualDates(a, b).length === 0;
}

// Première date qu'on peut imposer : aujourd'hui si le mois de départ est le mois
// en cours, sinon le 1er du mois de départ.
export function firstAllowedManualIso(startMonthKey, todayIso) {
  return startMonthKey === monthKeyOf(todayIso) ? todayIso : `${startMonthKey}-01`;
}
