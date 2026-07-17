import { test } from "node:test";
import assert from "node:assert/strict";
import { startOfWeek, computeViewport, shiftAnchor } from "../assets/js/utils/viewportModes.js";

test("startOfWeek returns the Monday of the week", () => {
  assert.deepEqual(startOfWeek("2026-07-17"), new Date(2026, 6, 13)); // Fri → Mon 13
  assert.deepEqual(startOfWeek("2026-07-19"), new Date(2026, 6, 13)); // Sun → Mon 13
  assert.deepEqual(startOfWeek("2026-07-13"), new Date(2026, 6, 13)); // Mon → itself
});

test("computeViewport week / month / quarter", () => {
  assert.deepEqual(computeViewport("week", "2026-07-17"), {
    mode: "week", firstVisibleDate: "2026-07-13", rangeStartDate: "2026-07-13", rangeEndDate: "2026-07-19", visibleDays: 7,
  });
  const mo = computeViewport("month", "2026-07-17");
  assert.equal(mo.firstVisibleDate, "2026-07-01");
  assert.equal(mo.rangeEndDate, "2026-07-31");
  assert.equal(mo.visibleDays, 31);
  assert.equal(computeViewport("month", "2028-02-10").visibleDays, 29); // leap February
  const q = computeViewport("quarter", "2026-07-17");
  assert.equal(q.firstVisibleDate, "2026-07-01");
  assert.equal(q.rangeEndDate, "2026-09-30");
  assert.equal(q.visibleDays, 92);
  assert.equal(computeViewport("quarter", "2026-11-05").firstVisibleDate, "2026-10-01");
  assert.equal(computeViewport("quarter", "2026-02-20").rangeEndDate, "2026-03-31");
});

test("shiftAnchor moves one period per mode", () => {
  assert.deepEqual(shiftAnchor("week", "2026-07-13", 1), new Date(2026, 6, 20));
  assert.deepEqual(shiftAnchor("week", "2026-07-13", -1), new Date(2026, 6, 6));
  assert.deepEqual(shiftAnchor("month", "2026-07-01", 1), new Date(2026, 7, 1));
  assert.deepEqual(shiftAnchor("month", "2026-01-01", -1), new Date(2025, 11, 1));
  assert.deepEqual(shiftAnchor("quarter", "2026-07-01", 1), new Date(2026, 9, 1));
  assert.deepEqual(shiftAnchor("quarter", "2026-07-01", -1), new Date(2026, 3, 1));
});
