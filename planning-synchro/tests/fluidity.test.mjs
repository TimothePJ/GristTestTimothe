// Fluidite de la frise (glisser au pixel pres, molette, pane bas decale).
//
// Le glisser ne s'arrondit plus au jour : la fenetre porte une fraction de jour
// (offsetDays) que le pane haut, le pane bas et le graphique appliquent tous les
// trois. Pendant un glisser, le pane bas dessine une marge et se contente de
// decaler ses pistes ; ses week-ends sont un degrade, ses couloirs de barres ne
// dependent plus de la fenetre.
//
// COMMENT ON TESTE : comme segmentBarOverload.test.mjs, on extrait le TEXTE REEL
// des fonctions module-privees (chargeBoard.js, sync/controller.js) et on
// l'execute dans un `vm` avec leurs VRAIES dependances. L'extraction echoue
// bruyamment si un en-tete disparait ou devient ambigu.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { parseCalendarDate, formatIsoDate } from "../assets/js/utils/dates.js";
import {
  HALF_DAY_PARTS,
  isBusinessDay,
  getHalfDaySlotRange,
  createHalfDaySlotKey,
} from "../assets/js/utils/timeSegments.js";
import { isAbsenceSlot } from "../assets/js/utils/leaveAbsences.js";
import { getMonthBounds } from "../assets/js/utils/monthSegments.js";
import { normalizeIsoDate, shiftIsoDateValue } from "../assets/js/viewport/normalize.js";
import { buildCanonicalSharedViewport } from "../assets/js/viewport/build.js";
import { clampToBounds } from "../assets/js/sync/viewportMath.js";
import { getChartWindowBounds } from "../assets/js/top/planningChart.js";

function makeExtractor(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const block = (header) => {
    const start = source.indexOf(header);
    assert.ok(start >= 0, `bloc introuvable dans ${relativePath} : ${header}`);
    assert.equal(source.indexOf(header, start + 1), -1, `en-tete ambigu dans ${relativePath} : ${header}`);
    const open = start + header.length - 1;
    assert.equal(source[open], "{", `l'en-tete doit se terminer par une accolade : ${header}`);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }
    throw new Error(`accolades non equilibrees : ${header}`);
  };
  const line = (pattern, label) => {
    const match = pattern.exec(source);
    assert.ok(match, `ligne introuvable dans ${relativePath} : ${label}`);
    return match[0];
  };
  return { block, line };
}

function mount(code, sandbox, exportsList) {
  const context = vm.createContext({ Math, Number, String, Date, Map, Set, Array, Object, ...sandbox });
  vm.runInContext(`${code}\nglobalThis.__api = { ${exportsList.join(", ")} };`, context);
  return context.__api;
}

// --- chargeBoard.js -----------------------------------------------------------

const board = makeExtractor("../assets/js/bottom/chargeBoard.js");
const boardApi = mount(
  [
    board.line(/const DAY_MS = [^;]+;/, "DAY_MS"),
    board.line(/const MAX_PAN_BUFFER_DAYS = [^;]+;/, "MAX_PAN_BUFFER_DAYS"),
    board.line(/const WEEKEND_SHADE = [^;]+;/, "WEEKEND_SHADE"),
    board.block("function shiftIsoDays(iso, days) {"),
    board.block("function daysBetweenIso(fromIso, toIso) {"),
    board.block("function normalizeOffsetDays(value) {"),
    board.block("function resolveRenderRange(viewport, visibleDays, { panning = false, bounds = null } = {}) {"),
    board.block("function buildVisibleSlots(windowDays, dayWidth) {"),
    board.block("function getVisibleSlotRange(startAt, endAt, visibleSlots) {"),
    board.block("function buildWeekendGradient(firstDate, dayWidth) {"),
    board.block("function isWeekendDay(date) {"),
    board.block("function renderTrackGrid(windowDays, dayWidth, absenceSet = new Set()) {"),
    board.block("function placeInLanes(entries) {"),
    board.block("function calendarDayNumber(date) {"),
    board.block("function computeWorkerLanes(worker, dayWidth) {"),
    board.block("function assignSegmentLanes(bars, workerLanes = null) {"),
  ].join("\n\n"),
  { parseCalendarDate, formatIsoDate, HALF_DAY_PARTS, isBusinessDay, getHalfDaySlotRange, createHalfDaySlotKey, isAbsenceSlot },
  [
    "resolveRenderRange",
    "buildVisibleSlots",
    "getVisibleSlotRange",
    "buildWeekendGradient",
    "renderTrackGrid",
    "computeWorkerLanes",
    "assignSegmentLanes",
    "MAX_PAN_BUFFER_DAYS",
  ]
);

function daysBetween(firstIso, lastIso) {
  const days = [];
  const cursor = parseCalendarDate(firstIso);
  const last = parseCalendarDate(lastIso);
  while (cursor <= last) {
    days.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// Reference : le balayage lineaire d'avant la recherche dichotomique.
function linearSlotRange(startAt, endAt, slots) {
  let firstSlot = null;
  let lastSlot = null;
  for (const slot of slots) {
    if (startAt < slot.endAt && endAt > slot.startAt) {
      if (!firstSlot) firstSlot = slot;
      lastSlot = slot;
    }
  }
  return firstSlot ? { firstSlot, lastSlot } : null;
}

test("getVisibleSlotRange (dichotomie) rend exactement ce que rendait le balayage lineaire", () => {
  const slots = boardApi.buildVisibleSlots(daysBetween("2026-09-14", "2027-02-20"), 7);
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const origin = new Date(2026, 7, 1).getTime();
  const spanMs = 260 * 24 * 3600 * 1000;
  for (let run = 0; run < 500; run += 1) {
    const a = origin + random() * spanMs;
    const b = a + random() * 90 * 24 * 3600 * 1000;
    const startAt = new Date(a);
    const endAt = new Date(b);
    const expected = linearSlotRange(startAt, endAt, slots);
    const actual = boardApi.getVisibleSlotRange(startAt, endAt, slots);
    assert.equal(actual?.firstSlot?.slotIndex, expected?.firstSlot?.slotIndex, `debut ${startAt} -> ${endAt}`);
    assert.equal(actual?.lastSlot?.slotIndex, expected?.lastSlot?.slotIndex, `fin ${startAt} -> ${endAt}`);
  }
  // Un mois entier a cheval sur le bord gauche : coupe au premier creneau dessine.
  const september = getMonthBounds("2026-09");
  assert.equal(boardApi.getVisibleSlotRange(september.startAt, september.endAt, slots).firstSlot.slotIndex, 0);
});

test("resolveRenderRange : fenetre exacte, jour de plus pour une fraction, marge de glisser bornee", () => {
  const viewport = { firstVisibleDate: "2026-06-01", rangeEndDate: "2026-06-30", visibleDays: 30 };
  assert.deepEqual(
    { ...boardApi.resolveRenderRange(viewport, 30) },
    { startIso: "2026-06-01", endIso: "2026-06-30", leadDays: 0, offsetDays: 0 }
  );
  // Fraction de jour : le jour entame en fin de fenetre est dessine aussi.
  assert.deepEqual(
    { ...boardApi.resolveRenderRange({ ...viewport, offsetDays: 0.25 }, 30) },
    { startIso: "2026-06-01", endIso: "2026-07-01", leadDays: 0, offsetDays: 0.25 }
  );
  // Glisser : une fenetre de marge de chaque cote.
  assert.deepEqual(
    { ...boardApi.resolveRenderRange(viewport, 30, { panning: true }) },
    { startIso: "2026-05-02", endIso: "2026-07-30", leadDays: 30, offsetDays: 0 }
  );
  // ... jamais au-dela des bornes de la frise, jamais en deca de la fenetre.
  assert.deepEqual(
    {
      ...boardApi.resolveRenderRange(viewport, 30, {
        panning: true,
        bounds: { startDate: "2026-05-20", endDate: "2026-07-10" },
      }),
    },
    { startIso: "2026-05-20", endIso: "2026-07-10", leadDays: 12, offsetDays: 0 }
  );
  // Marge plafonnee : un dezoom de 5 ans ne dessine pas 15 ans.
  const wide = boardApi.resolveRenderRange(
    { firstVisibleDate: "2026-01-01", rangeEndDate: "2030-12-31", visibleDays: 1826 },
    1826,
    { panning: true }
  );
  assert.equal(wide.leadDays, boardApi.MAX_PAN_BUFFER_DAYS);
});

// Couleur du degrade a l'abscisse x (motif repete) : sert a verifier, jour par
// jour, que le degrade ombre exactement les samedis et dimanches.
function gradientColorAt(gradient, x) {
  const stops = [...gradient.matchAll(/(rgba\([^)]+\)|transparent) (-?[\d.]+)px/g)].map((match) => ({
    color: match[1],
    position: Number(match[2]),
  }));
  const period = stops.at(-1).position;
  const local = ((x % period) + period) % period;
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (local >= stops[index].position && local < stops[index + 1].position) return stops[index].color;
  }
  return stops.at(-1).color;
}

test("buildWeekendGradient : ombre les samedis et dimanches, quel que soit le premier jour dessine", () => {
  const dayWidth = 9.5;
  for (const firstIso of ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-07"]) {
    const days = daysBetween(firstIso, shiftIsoDateValue(firstIso, 27));
    const gradient = boardApi.buildWeekendGradient(days[0], dayWidth);
    days.forEach((date, index) => {
      const shaded = gradientColorAt(gradient, (index + 0.5) * dayWidth) !== "transparent";
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      assert.equal(shaded, weekend, `${firstIso} : jour ${formatIsoDate(date)}`);
    });
  }
});

test("renderTrackGrid : une case par suite de feries en semaine et par suite d'absences, aucune pour les week-ends", () => {
  const dayWidth = 10;
  // Du lundi 2 au dimanche 15 novembre 2026 : 11 novembre ferie (mercredi).
  const days = daysBetween("2026-11-02", "2026-11-15");
  const absences = new Set(["2026-11-03:pm", "2026-11-04:am", "2026-11-04:pm"]);
  const html = boardApi.renderTrackGrid(days, dayWidth, absences);
  const spans = [...html.matchAll(/class="charge-plan-grid-day ([^"]+)" style="left:([\d.]+)px; width:([\d.]+)px"/g)].map(
    (match) => ({ kind: match[1], left: Number(match[2]), width: Number(match[3]) })
  );
  assert.deepEqual(spans, [
    { kind: "is-absence", left: 15, width: 15 },
    { kind: "is-weekend", left: 90, width: 10 },
  ]);
});

test("assignSegmentLanes : ni le couloir d'une barre ni la hauteur de la ligne ne dependent de la fenetre", () => {
  const segments = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((monthKey) => ({
    id: monthKey,
    ...getMonthBounds(monthKey),
  }));
  const workerLanes = boardApi.computeWorkerLanes({ name: "Marie", segments }, 10);
  // Barres VISIBLES a partir de fevrier, fevrier coupe au bord gauche (left 0).
  const visible = [
    { segmentId: "2026-02", leftPx: 0, widthPx: 100 },
    { segmentId: "2026-03", leftPx: 100, widthPx: 310 },
    { segmentId: "2026-04", leftPx: 410, widthPx: 300 },
  ];
  const lanes = (bars) => Object.fromEntries(bars.map((bar) => [bar.segmentId, bar.laneIndex]));
  // Sur tous les segments : janvier en 0, fevrier en 1, mars en 0, avril en 1.
  assert.deepEqual(lanes(boardApi.assignSegmentLanes(visible, workerLanes)), {
    "2026-02": 1,
    "2026-03": 0,
    "2026-04": 1,
  });
  // Meme reponse si la fenetre commence en mars : rien ne saute de couloir.
  assert.deepEqual(lanes(boardApi.assignSegmentLanes(visible.slice(1), workerLanes)), {
    "2026-03": 0,
    "2026-04": 1,
  });
  // Deux couloirs pour cette personne, meme quand une seule barre est visible :
  // la ligne garde sa hauteur.
  assert.equal(workerLanes.laneCount, 2);
  // Un segment isole (mois non contigus) reste dans le premier couloir.
  assert.equal(
    boardApi.computeWorkerLanes({ segments: [{ id: "a", ...getMonthBounds("2026-01") }, { id: "b", ...getMonthBounds("2026-03") }] }, 10)
      .laneCount,
    1
  );
  // Sans personne (appel d'avant), la regle d'origine sur les barres seules.
  assert.deepEqual(lanes(boardApi.assignSegmentLanes(visible)), { "2026-02": 0, "2026-03": 1, "2026-04": 0 });
});

// --- sync/controller.js ---------------------------------------------------------

const controller = makeExtractor("../assets/js/sync/controller.js");
const controllerApi = mount(
  [
    controller.line(/const WHEEL_MAX_DELTA_PX = [^;]+;/, "WHEEL_MAX_DELTA_PX"),
    controller.line(/const WHEEL_LINE_PX = [^;]+;/, "WHEEL_LINE_PX"),
    controller.line(/const WHEEL_PAGE_PX = [^;]+;/, "WHEEL_PAGE_PX"),
    controller.block("function clampNumber(value, min, max) {"),
    controller.block("function resolveOffsetDays(rawOffset, requested, clamped, bounds) {"),
    controller.line(/const WHOLE_DAY_EPSILON = [^;]+;/, "WHOLE_DAY_EPSILON"),
    controller.block("function splitExactStartDays(originIso, exactDays) {"),
    controller.block("function normalizeWheelDeltaPx(event) {"),
  ].join("\n\n"),
  { normalizeIsoDate, shiftIsoDateValue },
  ["resolveOffsetDays", "splitExactStartDays", "normalizeWheelDeltaPx"]
);

test("splitExactStartDays : un bord gauche fractionnaire devient un jour entier + une fraction", () => {
  assert.deepEqual({ ...controllerApi.splitExactStartDays("2026-03-10", 3.5) }, {
    firstVisibleDate: "2026-03-13",
    offsetDays: 0.5,
  });
  assert.deepEqual({ ...controllerApi.splitExactStartDays("2026-03-10", -2.25) }, {
    firstVisibleDate: "2026-03-07",
    offsetDays: 0.75,
  });
  // Arrondi flottant juste sous un jour entier (0,3 - 0,30000000000000004) : le
  // jour entier, pas une fraction de 1 que le controleur ecarterait (recul d'un jour).
  assert.deepEqual({ ...controllerApi.splitExactStartDays("2026-03-10", 0.3 - 0.30000000000000004) }, {
    firstVisibleDate: "2026-03-10",
    offsetDays: 0,
  });
});

test("resolveOffsetDays : la fraction survit dans les bornes et tombe en butee", () => {
  const bounds = { startDate: "2026-01-01", endDate: "2026-12-31" };
  const offsetFor = (viewport, offset) => {
    const requested = buildCanonicalSharedViewport(viewport);
    return controllerApi.resolveOffsetDays(offset, requested, clampToBounds(requested, bounds), bounds);
  };
  assert.equal(offsetFor({ firstVisibleDate: "2026-03-10", visibleDays: 31 }, 0.4), 0.4);
  // Fenetre deja collee a la fin : le jour entame par la fraction n'existe pas.
  assert.equal(offsetFor({ firstVisibleDate: "2026-12-01", visibleDays: 31 }, 0.4), 0);
  // Fenetre ramenee dans les bornes : elle s'arrete sur un jour entier.
  assert.equal(offsetFor({ firstVisibleDate: "2025-12-20", visibleDays: 31 }, 0.4), 0);
  assert.equal(offsetFor({ firstVisibleDate: "2026-03-10", visibleDays: 31 }, 1), 0);
  assert.equal(offsetFor({ firstVisibleDate: "2026-03-10", visibleDays: 31 }, -0.2), 0);
});

test("normalizeWheelDeltaPx : un cran vaut 100 px quel que soit le mode, les lancers sont bornes", () => {
  assert.equal(controllerApi.normalizeWheelDeltaPx({ deltaY: 100, deltaMode: 0 }), 100);
  assert.equal(controllerApi.normalizeWheelDeltaPx({ deltaY: 3, deltaMode: 1 }), 100);
  assert.equal(controllerApi.normalizeWheelDeltaPx({ deltaY: 4, deltaMode: 0 }), 4);
  assert.equal(controllerApi.normalizeWheelDeltaPx({ deltaY: 5000, deltaMode: 0 }), 300);
  assert.equal(controllerApi.normalizeWheelDeltaPx({ deltaY: -1, deltaMode: 2 }), -300);
});

// --- top/planningChart.js -------------------------------------------------------

test("getChartWindowBounds : le graphique se decale de la meme fraction de jour que la frise", () => {
  const whole = getChartWindowBounds({ firstVisibleDate: "2027-06-01", rangeEndDate: "2027-06-30" });
  const shifted = getChartWindowBounds({ firstVisibleDate: "2027-06-01", rangeEndDate: "2027-06-30", offsetDays: 0.5 });
  assert.equal(shifted.minTs - whole.minTs, 12 * 3600 * 1000);
  assert.equal(shifted.maxTs - whole.maxTs, 12 * 3600 * 1000);
});
