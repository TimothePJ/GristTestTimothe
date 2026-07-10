import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectionFromSlotIndexes } from "../assets/js/ui/editing.js";

test("buildSelectionFromSlotIndexes: 2 half-day slots on a weekday = 1 day", () => {
  const slots = [
    { slotIndex: 0, startAt: new Date(2027, 1, 1, 8), endAt: new Date(2027, 1, 1, 12), leftPx: 0, widthPx: 20, isWorkingDay: true },
    { slotIndex: 1, startAt: new Date(2027, 1, 1, 13), endAt: new Date(2027, 1, 1, 17), leftPx: 20, widthPx: 20, isWorkingDay: true },
  ];
  const sel = buildSelectionFromSlotIndexes(slots, 0, 1);
  assert.equal(sel.allocationDays, 1);
  assert.equal(new Date(sel.startDate).getHours(), 8);
});
