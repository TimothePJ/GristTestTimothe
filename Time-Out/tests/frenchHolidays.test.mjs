import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEaster, isFrenchHoliday } from "../assets/js/utils/frenchHolidays.js";

test("computeEaster: 2026 = 5 April, 2027 = 28 March, 2025 = 20 April", () => {
  assert.deepEqual(computeEaster(2026), new Date(2026, 3, 5));
  assert.deepEqual(computeEaster(2027), new Date(2027, 2, 28));
  assert.deepEqual(computeEaster(2025), new Date(2025, 3, 20));
});

test("isFrenchHoliday: the 11 métropole holidays of 2026 are holidays", () => {
  const days = [
    [2026, 1, 1], [2026, 4, 6], [2026, 5, 1], [2026, 5, 8], [2026, 5, 14],
    [2026, 5, 25], [2026, 7, 14], [2026, 8, 15], [2026, 11, 1], [2026, 11, 11], [2026, 12, 25],
  ];
  for (const [y, m, d] of days) {
    assert.equal(isFrenchHoliday(new Date(y, m - 1, d)), true, `${y}-${m}-${d}`);
  }
});

test("isFrenchHoliday: normal weekday + invalid date are not holidays", () => {
  assert.equal(isFrenchHoliday(new Date(2026, 6, 15)), false); // 15 July 2026
  assert.equal(isFrenchHoliday(new Date("nope")), false);
  assert.equal(isFrenchHoliday(null), false);
});
