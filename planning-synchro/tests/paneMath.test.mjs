import { test } from "node:test";
import assert from "node:assert/strict";
import { clampRows, computeTopPaneHeight } from "../assets/js/top/paneMath.js";

const BOUNDS = { minRows: 5, maxRows: 16 };
const AXIS = 40; // measured vis top-axis band
const ROW = 30; // measured per-row height

function compute(overrides) {
  return computeTopPaneHeight({
    axisHeightPx: AXIS,
    rowHeightPx: ROW,
    ...BOUNDS,
    ...overrides,
  });
}

test("clampRows keeps values inside [min,max]", () => {
  assert.equal(clampRows(3, BOUNDS), 5);
  assert.equal(clampRows(20, BOUNDS), 16);
  assert.equal(clampRows(10, BOUNDS), 10);
});

test("content beyond ceiling: cap = axis + 16 rows and scrolls", () => {
  const r = compute({ groupCount: 25, desiredRows: 16 });
  assert.equal(r.clampedRows, 16);
  assert.equal(r.effectiveRows, 16);
  assert.equal(r.maxHeightPx, AXIS + 16 * ROW);
  assert.equal(r.scrolls, true);
});

test("dragging below floor clamps desired to 5 rows", () => {
  const r = compute({ groupCount: 25, desiredRows: 2 });
  assert.equal(r.clampedRows, 5);
  assert.equal(r.maxHeightPx, AXIS + 5 * ROW);
  assert.equal(r.scrolls, true);
});

test("fewer tasks than desired: content shorter than cap, no scroll", () => {
  const r = compute({ groupCount: 8, desiredRows: 12 });
  assert.equal(r.effectiveRows, 8);
  assert.equal(r.maxHeightPx, AXIS + 12 * ROW); // cap given to vis
  assert.equal(r.contentHeightPx, AXIS + 8 * ROW); // what vis renders
  assert.equal(r.scrolls, false);
});

test("fewer than floor tasks: renders real count, never blank rows", () => {
  const r = compute({ groupCount: 3, desiredRows: 10 });
  assert.equal(r.effectiveRows, 3);
  assert.equal(r.contentHeightPx, AXIS + 3 * ROW);
  assert.equal(r.scrolls, false);
});

test("content exactly at desired: fills, does not scroll", () => {
  const r = compute({ groupCount: 10, desiredRows: 10 });
  assert.equal(r.effectiveRows, 10);
  assert.equal(r.scrolls, false);
});

test("empty project: content height is the axis band only", () => {
  const r = compute({ groupCount: 0, desiredRows: 10 });
  assert.equal(r.effectiveRows, 0);
  assert.equal(r.contentHeightPx, AXIS);
  assert.equal(r.scrolls, false);
});

test("fractional desiredRows (mid-drag) is honored within bounds", () => {
  const r = compute({ groupCount: 25, desiredRows: 7.5 });
  assert.equal(r.clampedRows, 7.5);
  assert.equal(r.maxHeightPx, AXIS + 7.5 * ROW);
  assert.equal(r.scrolls, true);
});
