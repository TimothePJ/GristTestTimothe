// planningRetard.js — retard des documents du planning Structure (colonne Retards de
// Planning_Projet), en jours ouvrés : week-ends et jours fériés français exclus.
//
// Module pur, sans DOM ni Grist. C'est la SEULE règle de calcul du retard : Planning Projet
// (frise, synchronisation, vue Global) et ListeDePlan (synchronisation des indices)
// écrivent la même colonne et doivent donc trouver le même nombre. Deux copies du calcul
// ont longtemps coexisté et s'écrasaient l'une l'autre.
import "../../../../shared/planning-closure-core.js";
import { isFrenchHoliday } from "./frenchHolidays.js";

// Date_Cloture se lit avec le lecteur du noyau de clôture partagé, celui qui décide du
// réalisé (100 %) et de la Date_Realise forcée : sinon le retard pourrait voir une clôture
// que le réalisé ne voit pas, ou l'arrêter un autre jour.
const parseClosureDay = globalThis.PlanningClosureCore?.parsePlanningCalendarDate;
if (typeof parseClosureDay !== "function") {
  throw new Error("Noyau de réalisation forcée Planning Projet indisponible.");
}

const DAY_MS = 86400000;
// Au-delà, la valeur est une erreur de saisie : elle ne doit ni produire un retard
// absurde ni faire construire des siècles de calendrier.
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value.trim().replace(/\s/g, "").replace(",", ".") : value;
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

// Minuit local du jour donné, ou null si le jour n'existe pas (31/02) ou sort des bornes.
function localDay(year, month, date) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(date);
  if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) return null;
  const day = new Date(y, m - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return null;
  return day;
}

// Une colonne Date Grist vaut minuit UTC : ses composantes UTC donnent le jour, quel que
// soit le fuseau du navigateur. Un autre instant (DateTime) se lit à l'heure locale.
function dayOfInstant(milliseconds) {
  const instant = new Date(milliseconds);
  if (Number.isNaN(instant.getTime())) return null;
  return milliseconds % DAY_MS === 0
    ? localDay(instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate())
    : localDay(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
}

// Jour calendaire (minuit local) d'une valeur de cellule : Date, secondes ou millisecondes
// Grist (nombre ou texte), « AAAA-MM-JJ », instant ISO avec fuseau, « JJ/MM/AAAA ».
export function parsePlanningDay(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return localDay(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return dayOfInstant(Math.abs(value) < 1e11 ? value * 1000 : value);
  }

  const text = toText(value);
  if (!text) return null;

  // Certaines voies REST/RPC rendent les secondes Grist en texte.
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return parsePlanningDay(Number(text));

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:([T\s])(.*))?$/);
  if (iso) {
    // Un instant avec fuseau (« Z », « +02:00 ») désigne un moment, pas un jour du calendrier.
    if (iso[4] && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso[5])) {
      return dayOfInstant(new Date(text).getTime());
    }
    return localDay(iso[1], iso[2], iso[3]);
  }

  const french = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/);
  if (french) return localDay(french[3], french[2], french[1]);

  return null;
}

export function isPlanningWorkingDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const weekday = date.getDay();
  return weekday !== 0 && weekday !== 6 && !isFrenchHoliday(date);
}

// Rang du jour dans son année (0 = 1er janvier), calculé en UTC : aucun changement
// d'heure ne peut le décaler.
function dayOfYear(date) {
  return Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / DAY_MS
  );
}

// Par année, cumul des jours ouvrés : cumul[i] = jours ouvrés parmi les i premiers jours.
// Construit une fois par année : un retard se compte ensuite sans parcourir les jours.
const workingDayTotals = new Map();

function workingDayTotalsOf(year) {
  let totals = workingDayTotals.get(year);
  if (totals) return totals;
  const length = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS);
  totals = new Uint16Array(length + 1);
  for (let index = 0; index < length; index += 1) {
    totals[index + 1] = totals[index] + (isPlanningWorkingDay(new Date(year, 0, 1 + index)) ? 1 : 0);
  }
  workingDayTotals.set(year, totals);
  return totals;
}

// Jours ouvrés du 1er janvier de `fromYear` jusqu'au jour `date` compris.
function workingDaysSince(fromYear, date) {
  let count = 0;
  for (let year = fromYear; year < date.getFullYear(); year += 1) {
    const totals = workingDayTotalsOf(year);
    count += totals[totals.length - 1];
  }
  return count + workingDayTotalsOf(date.getFullYear())[dayOfYear(date) + 1];
}

// Jours de retard : les jours ouvrés situés APRÈS l'échéance, jusqu'au jour de référence
// compris. Rendu le jour même ou plus tôt : 0. L'heure des deux dates est ignorée.
export function countPlanningLateWorkingDays(dueDate, referenceDate) {
  const due = parsePlanningDay(dueDate);
  const reference = parsePlanningDay(referenceDate);
  if (!due || !reference || reference <= due) return 0;
  const fromYear = due.getFullYear();
  return workingDaysSince(fromYear, reference) - workingDaysSince(fromYear, due);
}

// Un coffrage est lié à une ligne de planning quand Ligne_planning porte une valeur autre que 0.
function hasPlanningLinkValue(value) {
  const text = toText(value);
  if (!text) return false;
  const number = Number(text);
  return Number.isFinite(number) ? number !== 0 : true;
}

// Échéance d'un document = fin de sa barre dans le planning Structure :
//   - ARMATURES : Diff_armature ;
//   - COFFRAGE lié à une ligne de planning : Demarrages_travaux moins Duree_3 semaines
//     (calendaires, comme tout le planning Structure), sinon Diff_coffrage ;
//   - tout autre type (COFFRAGE non lié, NDC, COUPES, DEMOLITION, libre) : Diff_coffrage.
// Sans type de document, pas d'échéance.
export function resolvePlanningDueDate({
  typeDoc,
  lignePlanning,
  diffCoffrage,
  diffArmature,
  demarrage,
  duree3,
} = {}) {
  const type = toText(typeDoc).toUpperCase();
  if (!type) return null;

  if (type.includes("COFFRAGE")) {
    if (hasPlanningLinkValue(lignePlanning)) {
      const start = parsePlanningDay(demarrage);
      const weeks = toNumber(duree3);
      if (start && weeks != null && weeks >= 0) {
        // Même soustraction que la frise (jour tronqué), pour que l'échéance soit la Fin affichée.
        return parsePlanningDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() - weeks * 7));
      }
    }
    return parsePlanningDay(diffCoffrage);
  }

  if (type.includes("ARMATURES")) return parsePlanningDay(diffArmature);

  return parsePlanningDay(diffCoffrage);
}

// Nombre de jours de retard d'un document du planning Structure.
//   - Non réalisé (réalisé < 100 %) : jours ouvrés de l'échéance à aujourd'hui (`now`).
//   - Réalisé (100 %, ou Date_Cloture renseignée) : figé à sa date de réalisation —
//     Date_Cloture si le plan a été réalisé à la main, sinon `dateRealise`.
//   - Réalisé sans date ou sans échéance connue : la valeur enregistrée est gardée.
// `realise` est le pourcentage déjà calculé par l'appelant (indice atteint / indice cible).
export function computePlanningRetardDays(
  {
    typeDoc,
    realise,
    lignePlanning,
    diffCoffrage,
    diffArmature,
    demarrage,
    duree3,
    dateRealise,
    dateCloture,
    currentRetard,
  } = {},
  now = new Date()
) {
  if (!toText(typeDoc)) return 0;

  const dueDate = resolvePlanningDueDate({ typeDoc, lignePlanning, diffCoffrage, diffArmature, demarrage, duree3 });
  const closureDay = parseClosureDay(dateCloture);
  const isRealised = Boolean(closureDay) || Number(realise) >= 100;

  if (isRealised) {
    const realisedOn = closureDay || parsePlanningDay(dateRealise);
    if (realisedOn && dueDate) return countPlanningLateWorkingDays(dueDate, realisedOn);
    const stored = toNumber(currentRetard);
    return stored != null && stored >= 0 ? Math.trunc(stored) : 0;
  }

  return dueDate ? countPlanningLateWorkingDays(dueDate, now) : 0;
}
