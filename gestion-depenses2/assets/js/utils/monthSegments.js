// Modele « un segment = un mois » — noyau pur du plan de charge previsionnel.
//
// COPIE IDENTIQUE OCTET POUR OCTET dans :
//   gestion-depenses2/assets/js/utils/monthSegments.js
//   planning-synchro/assets/js/utils/monthSegments.js
//   Gestion-User/assets/js/monthSegments.js
// Verrouille par shared/tests/vendored-charge-modules-parity.test.cjs : toute
// modification doit etre repercutee dans les trois fichiers.
//
// CONTRAINTE DE PORTABILITE : ce module n'importe QUE ./leaveAbsences.js, seul
// fichier present au meme chemin relatif dans les trois widgets. Il ne peut donc
// pas s'appuyer sur les utilitaires locaux (utils/format.js chez les deux
// widgets de charge, utils.js chez Gestion-User) — d'ou la duplication assumee
// de getMonthKeyFromRawMonth, qui existe deja dans
// gestion-depenses2/assets/js/utils/format.js pour TimeReal / Timesheet.
//
// Aucun DOM, aucun appel Grist : testable sous `node --test`.

import { availableDaysAfterLeave } from "./leaveAbsences.js";

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function toMonthKey(year, monthNumber) {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

export function monthKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return toMonthKey(date.getFullYear(), date.getMonth() + 1);
}

// Tolere Date, epoch (secondes ou millisecondes), "YYYY-MM", "YYYY-MM-DD",
// "MM/YYYY". Meme contrat que format.js pour TimeReal.Mois.
export function getMonthKeyFromRawMonth(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return monthKeyFromDate(value);

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const timestamp = value > 1e11 ? value : value * 1000;
    return monthKeyFromDate(new Date(timestamp));
  }

  const text = String(value).trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  const frenchMatch = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (frenchMatch) {
    const monthNumber = Number(frenchMatch[1]);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return toMonthKey(Number(frenchMatch[2]), monthNumber);
    }
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : monthKeyFromDate(date);
}

// Mois d'une ligne TimeSegment : `Mois` d'abord, repli legacy sur `Start_At`.
// Devient naturellement inerte le jour ou Start_At disparait de la table : la
// cellule vaut alors undefined et getMonthKeyFromRawMonth renvoie "".
export function resolveSegmentMonthKey(row, columns) {
  return (
    getMonthKeyFromRawMonth(row?.[columns?.mois]) ||
    getMonthKeyFromRawMonth(row?.[columns?.startDate]) ||
    ""
  );
}

// [1er du mois 00:00:00.000, dernier jour du mois 23:59:59.999], heure locale.
export function getMonthBounds(monthKey) {
  const match = MONTH_KEY_PATTERN.exec(String(monthKey ?? ""));
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;

  return {
    startAt: new Date(year, monthNumber - 1, 1, 0, 0, 0, 0),
    // Jour 0 du mois suivant = dernier jour du mois courant.
    endAt: new Date(year, monthNumber, 0, 23, 59, 59, 999),
  };
}

// Valeur ecrite dans la colonne Grist `Mois` (type Date) : epoch en SECONDES du
// 1er du mois, comme toGristMonthValue de format.js pour TimeReal.
export function toGristMonthValue(monthKey) {
  const bounds = getMonthBounds(monthKey);
  return bounds ? Math.floor(bounds.startAt.getTime() / 1000) : null;
}

// Jours ouvres du mois : week-ends ET jours feries exclus. absenceSet null =>
// availableDaysAfterLeave renvoie la geometrie brute (cf. son garde-fou).
export function getMonthBusinessDays(monthKey) {
  const bounds = getMonthBounds(monthKey);
  return bounds ? availableDaysAfterLeave(bounds.startAt, bounds.endAt, null) : 0;
}

// Jours reellement disponibles : jours ouvres moins les demi-journees d'absence.
export function getMonthAvailableDays(monthKey, absenceSet) {
  const bounds = getMonthBounds(monthKey);
  return bounds ? availableDaysAfterLeave(bounds.startAt, bounds.endAt, absenceSet) : 0;
}

// Part du mois couverte par [rangeStart, rangeEnd], ponderee par la
// disponibilite reelle de la personne. Gestion-User s'en sert pour etaler
// l'effectif mensuel sur ses semaines ISO : somme des parts sur toutes les
// semaines touchant le mois == 1.
//
// REPLI : si la personne est absente TOUT le mois, la ponderation par
// disponibilite vaudrait 0/0 et la charge disparaitrait sans bruit. On retombe
// alors sur une ponderation en jours ouvres (aveugle aux conges) pour que les
// jours planifies restent visibles quelque part — l'incoherence, elle, est deja
// signalee en rouge dans les widgets d'edition.
export function getMonthShareForRange(monthKey, rangeStart, rangeEnd, absenceSet) {
  const bounds = getMonthBounds(monthKey);
  if (!bounds) return 0;
  if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date)) return 0;

  const overlapStart = rangeStart > bounds.startAt ? rangeStart : bounds.startAt;
  const overlapEnd = rangeEnd < bounds.endAt ? rangeEnd : bounds.endAt;
  if (overlapEnd <= overlapStart) return 0;

  const monthAvailable = availableDaysAfterLeave(bounds.startAt, bounds.endAt, absenceSet);
  if (monthAvailable > 0) {
    return availableDaysAfterLeave(overlapStart, overlapEnd, absenceSet) / monthAvailable;
  }

  const monthBusiness = availableDaysAfterLeave(bounds.startAt, bounds.endAt, null);
  if (monthBusiness <= 0) return 0;
  return availableDaysAfterLeave(overlapStart, overlapEnd, null) / monthBusiness;
}
