import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectionFromSlotIndexes } from "../assets/js/bottom/chargeEditing.js";

// Builds a synthetic getVisibleSlots()-shaped fixture: two half-day slots
// (am/pm) per date, laid out left-to-right at a constant half-day width,
// mirroring bottom/chargeBoard.js's buildVisibleSlots() output shape
// ({ slotIndex, leftPx, widthPx, startAt, endAt, isWorkingDay }).
const HALF_DAY_WIDTH_PX = 40;

function makeSlots(days) {
  const slots = [];
  days.forEach(({ year, month, day, isWorkingDay }) => {
    const am = {
      slotIndex: slots.length,
      leftPx: slots.length * HALF_DAY_WIDTH_PX,
      widthPx: HALF_DAY_WIDTH_PX,
      isWorkingDay,
      startAt: new Date(year, month - 1, day, 8, 0, 0, 0),
      endAt: new Date(year, month - 1, day, 12, 0, 0, 0),
    };
    slots.push(am);
    const pm = {
      slotIndex: slots.length,
      leftPx: slots.length * HALF_DAY_WIDTH_PX,
      widthPx: HALF_DAY_WIDTH_PX,
      isWorkingDay,
      startAt: new Date(year, month - 1, day, 13, 0, 0, 0),
      endAt: new Date(year, month - 1, day, 17, 0, 0, 0),
    };
    slots.push(pm);
  });
  return slots;
}

test("full 2-business-day selection yields allocationDays = workingSlots/2 and ISO start/end", () => {
  const slots = makeSlots([
    { year: 2026, month: 1, day: 5, isWorkingDay: true }, // Monday
    { year: 2026, month: 1, day: 6, isWorkingDay: true }, // Tuesday
  ]);

  const selection = buildSelectionFromSlotIndexes(slots, 0, 3);

  assert.ok(selection);
  assert.equal(selection.allocationDays, 2); // 4 working half-day slots / 2
  assert.equal(selection.startDate, new Date(2026, 0, 5, 8, 0, 0, 0).toISOString());
  assert.equal(selection.endDate, new Date(2026, 0, 6, 17, 0, 0, 0).toISOString());
  assert.equal(selection.startSlotIndex, 0);
  assert.equal(selection.endSlotIndex, 3);
  assert.equal(selection.leftPx, 0);
  assert.equal(selection.widthPx, 4 * HALF_DAY_WIDTH_PX);
});

test("a single half-day slot yields allocationDays = 0.5", () => {
  const slots = makeSlots([{ year: 2026, month: 1, day: 5, isWorkingDay: true }]);

  const selection = buildSelectionFromSlotIndexes(slots, 0, 0);

  assert.ok(selection);
  assert.equal(selection.allocationDays, 0.5);
  assert.equal(selection.startDate, new Date(2026, 0, 5, 8, 0, 0, 0).toISOString());
  assert.equal(selection.endDate, new Date(2026, 0, 5, 12, 0, 0, 0).toISOString());
});

test("weekend half-day slots inside the range are excluded from allocationDays but still span the full pixel width", () => {
  const slots = makeSlots([
    { year: 2026, month: 1, day: 9, isWorkingDay: true }, // Friday
    { year: 2026, month: 1, day: 10, isWorkingDay: false }, // Saturday
  ]);

  const selection = buildSelectionFromSlotIndexes(slots, 0, 3);

  assert.ok(selection);
  // Only the 2 Friday half-day slots count; the 2 Saturday slots are excluded.
  assert.equal(selection.allocationDays, 1);
  assert.equal(selection.widthPx, 4 * HALF_DAY_WIDTH_PX);
});

test("reversed indices (lastIdx < firstIdx) normalize to the same selection as ascending order", () => {
  const slots = makeSlots([
    { year: 2026, month: 1, day: 5, isWorkingDay: true },
    { year: 2026, month: 1, day: 6, isWorkingDay: true },
  ]);

  const ascending = buildSelectionFromSlotIndexes(slots, 0, 3);
  const reversed = buildSelectionFromSlotIndexes(slots, 3, 0);

  assert.deepEqual(reversed, ascending);
});

test("returns null when a slot index isn't present in the slots array", () => {
  const slots = makeSlots([{ year: 2026, month: 1, day: 5, isWorkingDay: true }]);

  assert.equal(buildSelectionFromSlotIndexes(slots, 0, 99), null);
  assert.equal(buildSelectionFromSlotIndexes([], 0, 0), null);
});
