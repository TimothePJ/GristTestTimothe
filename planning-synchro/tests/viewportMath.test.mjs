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

// Dézoom régulé (2026-10-26) : jamais au-delà des limites des données. Une
// fenêtre plus large que les bornes est ramenée exactement sur elles.
test("clampToBounds stops zooming out at the data span, never beyond the limits", () => {
  const bounds = { startDate: "2027-01-01", endDate: "2027-03-31" };
  for (const firstVisibleDate of ["2026-06-01", "2027-02-01", "2024-01-01"]) {
    const v = clampToBounds(buildCanonicalSharedViewport({ firstVisibleDate, visibleDays: 700 }), bounds);
    assert.equal(v.firstVisibleDate, bounds.startDate, `depuis ${firstVisibleDate}`);
    assert.equal(v.rangeEndDate, bounds.endDate, `depuis ${firstVisibleDate}`);
    assert.equal(v.visibleDays, 90);
  }
});

test("clampToBounds still lets a long project zoom out over more than a year, inside its limits", () => {
  const bounds = { startDate: "2025-06-01", endDate: "2028-02-29" };
  const v = clampToBounds(buildCanonicalSharedViewport({ firstVisibleDate: "2025-01-01", visibleDays: 700 }), bounds);
  assert.equal(v.visibleDays, 700);
  assert.equal(v.firstVisibleDate, bounds.startDate);
  assert.ok(v.rangeEndDate <= bounds.endDate, `rangeEndDate ${v.rangeEndDate}`);
});

test("the widest window now reaches 5 years (wheel zoom is no longer capped at ~14 months)", () => {
  const v = buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 1826 });
  assert.equal(v.visibleDays, 1826);
  assert.equal(v.mode, "year");
  const tooWide = buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 5000 });
  assert.equal(tooWide.visibleDays, 1826);
});

test("getDayBoundaryLeftPx is proportional", () => {
  const w = 620; // content width
  const x0 = getDayBoundaryLeftPx(base, "2027-01-01", w);
  const x1 = getDayBoundaryLeftPx(base, "2027-01-02", w);
  assert.ok(Math.abs((x1 - x0) - w / 31) < 0.001);
});
