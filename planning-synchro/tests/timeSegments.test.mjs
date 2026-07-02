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

test("getSegmentEffectiveDays uses allocation when present", () => {
  const seg = { allocationDays: 4.5, effectif: 1, startAt: new Date(2026,3,6,8), endAt: new Date(2026,3,10,17) };
  assert.equal(getSegmentEffectiveDays(seg) > 0, true);
});

test("toFiniteNumber fallback", () => {
  assert.equal(toFiniteNumber("x", 3), 3);
  assert.equal(toFiniteNumber("2,5".replace(",", "."), 0), 2.5);
});
