import { resolveSegmentMonthKey, getMonthBounds } from "../utils/monthSegments.js";
import { formatIsoDate } from "../utils/dates.js";

// Bornes de la frise cote previsionnel : du 1er jour du plus petit mois au
// dernier jour du plus grand. Les monthKey "YYYY-MM" se comparent
// lexicographiquement, donc un simple min/max de chaines suffit.
export function computeTimeSegmentBounds(rows, columns) {
  let minMonthKey = "";
  let maxMonthKey = "";

  (rows || []).forEach((row) => {
    const monthKey = resolveSegmentMonthKey(row, columns);
    if (!monthKey) return;
    if (!minMonthKey || monthKey < minMonthKey) minMonthKey = monthKey;
    if (!maxMonthKey || monthKey > maxMonthKey) maxMonthKey = monthKey;
  });

  if (!minMonthKey || !maxMonthKey) return null;

  // La branche ISO de getMonthKeyFromRawMonth ne valide pas l'intervalle du
  // mois (contrairement a la branche "MM/YYYY") : un monthKey syntaxiquement
  // valide ("2026-13") peut donc etre semantiquement invalide. getMonthBounds
  // renvoie null dans ce cas — s'en degrader proprement plutot que planter.
  const minBounds = getMonthBounds(minMonthKey);
  const maxBounds = getMonthBounds(maxMonthKey);
  if (!minBounds || !maxBounds) return null;

  return {
    startDate: formatIsoDate(minBounds.startAt),
    endDate: formatIsoDate(maxBounds.endAt),
  };
}
