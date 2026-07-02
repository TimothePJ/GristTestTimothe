import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTimeSegmentBounds } from "../assets/js/top/bounds.js";

const cols = { startDate: "Start_At", endDate: "End_At" };

test("bounds = min(start) .. max(end)", () => {
  const rows = [
    { Start_At: "06/04/2026 08:00", End_At: "10/04/2026 17:00" },
    { Start_At: "01/06/2026 08:00", End_At: "30/06/2026 17:00" },
  ];
  const b = computeTimeSegmentBounds(rows, cols);
  assert.equal(b.startDate, "2026-04-06");
  assert.equal(b.endDate, "2026-06-30");
});

test("no rows => null", () => {
  assert.equal(computeTimeSegmentBounds([], cols), null);
});
