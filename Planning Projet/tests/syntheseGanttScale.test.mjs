import test from "node:test";
import assert from "node:assert/strict";

import {
  DAY_MS,
  MAX_SPAN_MS,
  MIN_SPAN_MS,
  buildScaleTiers,
  createTimeScale,
  currentWeekWindow,
  isoWeekNumber,
  panWindow,
  wheelZoomSteps,
  zoomWindow,
} from "../assets/js/services/syntheseGanttGeometry.js";

const day = (year, month, date) => new Date(year, month - 1, date);

test("numéro de semaine ISO", () => {
  assert.equal(isoWeekNumber(day(2026, 9, 14)), 38);
  assert.equal(isoWeekNumber(day(2027, 1, 1)), 53);
  assert.equal(isoWeekNumber(day(2027, 1, 4)), 1);
});

test("échelle Semaine : semaines ISO en haut, jours en bas", () => {
  const tiers = buildScaleTiers(createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 700 }));
  assert.equal(tiers.mode, "week");
  assert.deepEqual(tiers.top.map((tick) => [tick.x1, tick.x2, tick.label]), [[0, 700, "sept. 2026 · S38"]]);
  assert.deepEqual(tiers.bottom.map((tick) => tick.label), [
    "lun 14", "mar 15", "mer 16", "jeu 17", "ven 18", "sam 19", "dim 20",
  ]);
  assert.deepEqual([tiers.bottom[1].x1, tiers.bottom[1].x2], [100, 200]);
});

test("échelle Mois : mois en haut, jours (ou semaines si trop serré) en bas", () => {
  const month = buildScaleTiers(createTimeScale({ start: day(2026, 9, 1), end: day(2026, 10, 1), width: 900 }));
  assert.equal(month.mode, "month");
  assert.deepEqual(month.top.map((tick) => tick.label), ["septembre 2026"]);
  assert.equal(month.bottom.length, 30);
  assert.deepEqual([month.bottom[0].label, month.bottom[29].label], ["1", "30"]);
  const narrow = buildScaleTiers(createTimeScale({ start: day(2026, 9, 1), end: day(2026, 10, 1), width: 300 }));
  assert.equal(narrow.bottom[0].label, "S36");
});

test("échelle Année : années en haut, mois en bas", () => {
  const year = buildScaleTiers(createTimeScale({ start: day(2026, 1, 1), end: day(2027, 1, 1), width: 1200 }));
  assert.equal(year.mode, "year");
  assert.deepEqual(year.top.map((tick) => tick.label), ["2026"]);
  assert.deepEqual(year.bottom.map((tick) => tick.label), [
    "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  ]);
});

test("graduations coupées aux bords, libellés trop longs masqués", () => {
  const tiers = buildScaleTiers(createTimeScale({
    start: new Date(2026, 8, 16, 12),
    end: new Date(2026, 8, 23, 12),
    width: 700,
  }));
  assert.deepEqual([tiers.bottom[0].x1, tiers.bottom[0].x2, tiers.bottom[0].label], [0, 50, "mer 16"]);
  assert.equal(tiers.bottom.at(-1).x2, 700);
  const tight = buildScaleTiers(createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 140 }));
  assert.equal(tight.bottom[0].label, "", "20 px ne suffisent pas pour « lun 14 »");
});

test("glisser : la date saisie reste sous le curseur", () => {
  const next = panWindow({ start: day(2026, 9, 14), end: day(2026, 9, 21) }, 100, 700);
  assert.equal(next.start.getTime(), day(2026, 9, 13).getTime());
  assert.equal(next.end.getTime(), day(2026, 9, 20).getTime());
});

// Review Focus 4.
test("zoom centré sous le curseur, étendue bornée", () => {
  const zoomed = zoomWindow({ start: day(2026, 9, 14), end: day(2026, 9, 21) }, 0.5, true);
  const center = day(2026, 9, 14).getTime() + 3.5 * DAY_MS;
  assert.equal((zoomed.start.getTime() + zoomed.end.getTime()) / 2, center);
  assert.equal(zoomed.end - zoomed.start, (7 * DAY_MS) / 1.25);
  const min = zoomWindow({ start: day(2026, 9, 14), end: day(2026, 9, 16) }, 0, true);
  assert.equal(min.end - min.start, MIN_SPAN_MS);
  const max = zoomWindow({ start: day(2020, 1, 1), end: day(2029, 12, 31) }, 1, false);
  assert.equal(max.end - max.start, MAX_SPAN_MS);
});

// Review Focus 3.
test("semaine en cours quand la période du planning manque", () => {
  const week = currentWeekWindow(new Date(2026, 8, 23, 15));
  assert.equal(week.start.getTime(), day(2026, 9, 21).getTime());
  assert.equal(week.end.getTime(), day(2026, 9, 28).getTime() - 1);
});

test("molette : un cran = un pas, les petits deltas s'additionnent, changer de sens repart de zéro", () => {
  assert.deepEqual(wheelZoomSteps(0, -100, 0), { steps: -1, pending: 0 });
  assert.deepEqual(wheelZoomSteps(0, 100, 0), { steps: 1, pending: 0 });
  assert.deepEqual(wheelZoomSteps(0, 250, 0), { steps: 2, pending: 50 });
  let pending = 0;
  const steps = [];
  for (let index = 0; index < 4; index += 1) {
    const result = wheelZoomSteps(pending, -25, 0);
    steps.push(result.steps);
    pending = result.pending;
  }
  assert.deepEqual(steps, [0, 0, 0, -1]);
  assert.equal(pending, 0);
  assert.deepEqual(wheelZoomSteps(60, -30, 0), { steps: 0, pending: -30 });
  const lines = wheelZoomSteps(0, 3, 1);
  assert.equal(lines.steps, 1);
  assert.ok(Math.abs(lines.pending) < 1e-9);
  assert.deepEqual(wheelZoomSteps(undefined, Number.NaN), { steps: 0, pending: 0 });
});
