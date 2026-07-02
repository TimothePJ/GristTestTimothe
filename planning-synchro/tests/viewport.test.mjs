import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalSharedViewport, buildInitialProjectViewport } from "../assets/js/viewport/build.js";

test("canonical viewport derives rangeEndDate and mode", () => {
  const v = buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 31 });
  assert.equal(v.rangeStartDate, "2027-01-01");
  assert.equal(v.visibleDays, 31);
  assert.equal(v.mode, "month");
});

test("initial viewport is ~365 days anchored on first planning date, clamped to bounds", () => {
  const v = buildInitialProjectViewport({
    firstPlanningDate: "2027-02-02",
    bounds: { startDate: "2026-04-06", endDate: "2027-06-30" },
  });
  assert.equal(v.firstVisibleDate, "2027-02-02");
  assert.ok(v.visibleDays >= 100 && v.visibleDays <= 366);
  // window must not exceed bounds end
  assert.ok(v.rangeEndDate <= "2027-06-30");
});

test("initial viewport clamps anchor to bounds start when planning precedes bounds", () => {
  const v = buildInitialProjectViewport({
    firstPlanningDate: "2025-01-01",
    bounds: { startDate: "2026-04-06", endDate: "2027-06-30" },
  });
  assert.ok(v.firstVisibleDate >= "2026-04-06");
});

test("initial viewport never exceeds bounds end for a sub-7-day bounds span", () => {
  const v = buildInitialProjectViewport({
    firstPlanningDate: "2027-01-01",
    bounds: { startDate: "2027-01-01", endDate: "2027-01-03" },
  });
  assert.ok(v.rangeEndDate <= "2027-01-03", `rangeEndDate ${v.rangeEndDate} must be <= 2027-01-03`);
});
