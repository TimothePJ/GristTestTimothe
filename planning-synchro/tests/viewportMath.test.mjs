import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMode, panByDays, clampToBounds, getDayBoundaryLeftPx } from "../assets/js/sync/viewportMath.js";
import { buildCanonicalSharedViewport } from "../assets/js/viewport/build.js";

const base = buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 31 });

test("applyMode(week) sets 7 visible days", () => {
  assert.equal(applyMode(base, "week").visibleDays, 7);
});

test("panByDays shifts start", () => {
  assert.equal(panByDays(base, 7).firstVisibleDate, "2027-01-08");
});

test("clampToBounds keeps window inside bounds", () => {
  const v = clampToBounds(buildCanonicalSharedViewport({ firstVisibleDate: "2027-06-01", visibleDays: 60 }), { startDate: "2026-04-06", endDate: "2027-06-30" });
  assert.ok(v.rangeEndDate <= "2027-06-30");
});

test("clampToBounds keeps anchorDate within the window for narrow bounds", () => {
  const v = clampToBounds(
    buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 31 }),
    { startDate: "2027-01-01", endDate: "2027-01-03" }
  );
  assert.ok(v.rangeEndDate <= "2027-01-03", `rangeEndDate ${v.rangeEndDate}`);
  assert.ok(v.anchorDate >= v.firstVisibleDate && v.anchorDate <= v.rangeEndDate,
    `anchorDate ${v.anchorDate} must be within [${v.firstVisibleDate}, ${v.rangeEndDate}]`);
});

test("getDayBoundaryLeftPx is proportional", () => {
  const w = 620; // content width
  const x0 = getDayBoundaryLeftPx(base, "2027-01-01", w);
  const x1 = getDayBoundaryLeftPx(base, "2027-01-02", w);
  assert.ok(Math.abs((x1 - x0) - w / 31) < 0.001);
});
