import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDisplayedMonths, toFiniteNumber } from "../assets/js/utils/format.js";
import { getSegmentEffectiveDays } from "../assets/js/utils/timeSegments.js";

test("buildDisplayedMonths returns contiguous months with day dates", () => {
  const months = buildDisplayedMonths(2027, 0, 2, ["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"]);
  assert.equal(months.length, 2);
  assert.equal(months[0].calendarDayCount, 31);
  assert.equal(months[0].calendarDayDates.length, 31);
});

// Un segment = un mois (Task 5) : getSegmentEffectiveDays raisonne desormais
// exclusivement sur segment.monthKey (via getMonthBusinessDays), plus jamais
// sur segment.allocationDays/startAt/endAt. Memes tests, verbatim, que
// gestion-depenses2/tests/chargeAggregation.test.mjs (Task 2), puisque les
// deux copies de timeSegments.js partagent desormais la meme logique.
test("getSegmentEffectiveDays plafonne l'effectif aux jours ouvres du mois", () => {
  // Septembre 2026 : 22 jours ouvres.
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: 8 }), 8);
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: 30 }), 22);
});

test("getSegmentEffectiveDays vaut 0 sans effectif", () => {
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: null }), 0);
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: "" }), 0);
});

test("getSegmentEffectiveDays vaut 0 sans mois resoluble", () => {
  assert.equal(getSegmentEffectiveDays({ monthKey: "", effectifDays: 8 }), 0);
});

test("toFiniteNumber fallback", () => {
  assert.equal(toFiniteNumber("x", 3), 3);
  assert.equal(toFiniteNumber("2,5".replace(",", "."), 0), 2.5);
});
