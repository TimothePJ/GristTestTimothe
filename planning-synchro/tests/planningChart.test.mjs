import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskLoadSeries, getChartWindowBounds } from "../assets/js/top/planningChart.js";

const columns = {
  taskName: "Taches",
  taskNameAlt: "Tache",
  typeDoc: "Type_doc",
  dateLimite: "Date_limite",
  diffCoffrage: "Diff_coffrage",
  diffArmature: "Diff_armature",
  demarragesTravaux: "Demarrages_travaux",
  realise: "Realise",
};

// Window covering all of 2027 (month buckets Jan..Dec 2027).
const viewport = { firstVisibleDate: "2027-01-01", rangeEndDate: "2027-12-31" };

const rows = [
  // Coffrage due (Diff_coffrage) in Feb 2027 — REALISED 100.
  { Taches: "FOND", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-20", Realise: "100" },
  // Another coffrage due in Feb 2027 — only 50% (not realised).
  { Taches: "PH RDC", Type_doc: "COFFRAGE", Date_limite: "2027-02-05", Diff_coffrage: "2027-02-25", Realise: "50" },
  // Armature due (Diff_armature) in Mar 2027 — REALISED 100.
  { Taches: "LONG", Type_doc: "ARMATURES", Diff_coffrage: "2027-03-01", Diff_armature: "2027-03-20", Realise: "100" },
  // NDC due (Diff_coffrage) in Feb 2027 — 0%.
  { Taches: "RSO", Type_doc: "NDC", Date_limite: "2027-02-10", Diff_coffrage: "2027-02-28", Realise: "0" },
  // Custom type -> "AUTRES", due May 2027 — REALISED 100.
  { Taches: "PLAN X", Type_doc: "PLAN SPECIAL", Date_limite: "2027-05-01", Diff_coffrage: "2027-05-15", Realise: "100" },
  // Outside the window (2029) -> not counted.
  { Taches: "FUTUR", Type_doc: "COFFRAGE", Date_limite: "2029-01-01", Diff_coffrage: "2029-01-20", Realise: "100" },
];

test("buildTaskLoadSeries: buckets tasks per month by type + total", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);

  assert.equal(series.points.length, 12, "12 month buckets for the 2027 window");
  const febIndex = series.points.findIndex((p) => p.monthKey === "2027-02");
  const marIndex = series.points.findIndex((p) => p.monthKey === "2027-03");
  const mayIndex = series.points.findIndex((p) => p.monthKey === "2027-05");

  // Feb: 2 coffrage + 1 ndc = 3 total.
  assert.equal(series.byType.COFFRAGE[febIndex], 2);
  assert.equal(series.byType.NDC[febIndex], 1);
  assert.equal(series.total[febIndex], 3);

  // Mar: 1 armature.
  assert.equal(series.byType.ARMATURES[marIndex], 1);
  assert.equal(series.total[marIndex], 1);

  // May: 1 "AUTRES" (custom type).
  assert.equal(series.byType.AUTRES[mayIndex], 1);
  assert.equal(series.total[mayIndex], 1);
});

test("buildTaskLoadSeries: total equals the sum of typed lines per month", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);
  series.points.forEach((_, index) => {
    const typedSum = series.typesPresent.reduce((sum, type) => sum + (series.byType[type][index] || 0), 0);
    assert.equal(series.total[index], typedSum, `month ${index} total == sum of typed lines`);
  });
});

test("buildTaskLoadSeries: tasks outside the visible window are excluded", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);
  const grandTotal = series.total.reduce((a, b) => a + b, 0);
  // 5 in-window tasks (the 2029 one is dropped).
  assert.equal(grandTotal, 5);
});

test("buildTaskLoadSeries: typesPresent is ordered and only includes present types", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);
  assert.deepEqual(series.typesPresent, ["COFFRAGE", "ARMATURES", "NDC", "AUTRES"]);
});

test("buildTaskLoadSeries: realized (100%) counts feed the dotted companion lines", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);
  const febIndex = series.points.findIndex((p) => p.monthKey === "2027-02");
  const marIndex = series.points.findIndex((p) => p.monthKey === "2027-03");
  const mayIndex = series.points.findIndex((p) => p.monthKey === "2027-05");

  // Feb coffrage: 2 due, only FOND realized -> 1 realized.
  assert.equal(series.byType.COFFRAGE[febIndex], 2);
  assert.equal(series.byTypeRealized.COFFRAGE[febIndex], 1);
  // Feb NDC: 1 due, 0 realized.
  assert.equal(series.byTypeRealized.NDC[febIndex], 0);
  // Feb total realized = 1 (FOND only).
  assert.equal(series.totalRealized[febIndex], 1);

  // Mar armature realized, May "autres" realized.
  assert.equal(series.byTypeRealized.ARMATURES[marIndex], 1);
  assert.equal(series.byTypeRealized.AUTRES[mayIndex], 1);
});

test("buildTaskLoadSeries: realized never exceeds total per month/type", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);
  series.typesPresent.forEach((type) => {
    series.points.forEach((_, index) => {
      assert.ok(series.byTypeRealized[type][index] <= series.byType[type][index]);
    });
  });
  series.points.forEach((_, index) => {
    assert.ok(series.totalRealized[index] <= series.total[index]);
  });
});

test("buildTaskLoadSeries: week granularity buckets tasks per ISO week", () => {
  // Feb 2027 Mondays are the 1st, 8th, 15th, 22nd. FOND due 2027-02-20 (Sat) is in
  // the week of Mon 2027-02-15; PH RDC due 2027-02-25 (Thu) and RSO due 2027-02-28
  // (Sun) are both in the week of Mon 2027-02-22.
  const series = buildTaskLoadSeries(rows, columns, viewport, { granularity: "week" });

  // Weekly buckets across the whole 2027 window (~53 weeks) — far more than 12.
  assert.ok(series.points.length > 40, "weekly buckets span the year");
  assert.ok(series.points.every((p) => typeof p.weekKey === "string"), "week points carry weekKey");

  const wk15 = series.points.findIndex((p) => p.weekKey === "2027-02-15");
  const wk22 = series.points.findIndex((p) => p.weekKey === "2027-02-22");
  assert.ok(wk15 >= 0 && wk22 >= 0, "both February weeks exist");

  // FOND alone in the week of the 15th; PH RDC + RSO in the week of the 22nd.
  assert.equal(series.byType.COFFRAGE[wk15], 1);
  assert.equal(series.total[wk15], 1);
  assert.equal(series.byType.COFFRAGE[wk22], 1);
  assert.equal(series.byType.NDC[wk22], 1);
  assert.equal(series.total[wk22], 2);

  // Same grand total as the month view (5 in-window tasks), just spread by week.
  assert.equal(series.total.reduce((a, b) => a + b, 0), 5);
});

// --- calibration against the frise below -------------------------------------
// The chart must span exactly the same window, with the same date -> x mapping,
// as the planning in the bottom pane (sync/viewportMath.getDayBoundaryLeftPx:
// a day is contentWidthPx / visibleDays wide, day 0 starting at
// firstVisibleDate 00:00).

const DAY_MS = 24 * 60 * 60 * 1000;

test("getChartWindowBounds: covers whole days, ending at rangeEndDate + 1 day 00:00", () => {
  const bounds = getChartWindowBounds({ firstVisibleDate: "2027-01-01", rangeEndDate: "2027-12-31" });

  assert.equal(bounds.minTs, new Date(2027, 0, 1).getTime(), "starts at the first visible day 00:00");
  assert.equal(bounds.maxTs, new Date(2028, 0, 1).getTime(), "ends at the day AFTER rangeEndDate");
  // 2027 is not a leap year: 365 whole days, matching visibleDays for this window.
  assert.equal((bounds.maxTs - bounds.minTs) / DAY_MS, 365);
});

test("getChartWindowBounds: window width equals visibleDays whole days", () => {
  // A 30-day window (mode "mois"): Jun 1 .. Jun 30 inclusive.
  const bounds = getChartWindowBounds({ firstVisibleDate: "2027-06-01", rangeEndDate: "2027-06-30" });
  assert.equal((bounds.maxTs - bounds.minTs) / DAY_MS, 30);
});

test("getChartWindowBounds: invalid viewport -> null", () => {
  assert.equal(getChartWindowBounds({}), null);
  assert.equal(getChartWindowBounds({ firstVisibleDate: "2027-06-10", rangeEndDate: "2027-06-01" }), null);
});

test("month points sit at the true midpoint of their month, not the 15th", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport);

  series.points.forEach((point) => {
    const startTs = new Date(point.year, point.monthNumber - 1, 1).getTime();
    const endTs = new Date(point.year, point.monthNumber, 1).getTime();
    assert.equal(point.startTs, startTs, `${point.monthKey} starts on the 1st at 00:00`);
    assert.equal(point.midTs, startTs + (endTs - startTs) / 2, `${point.monthKey} midpoint`);
  });

  // A 31-day month's centre is the 16th at 12:00 — the old 15th-at-00:00 point
  // was 1.5 days (~4% of the month's width) to its left.
  const january = series.points.find((point) => point.monthKey === "2027-01");
  assert.equal(january.midTs, new Date(2027, 0, 16, 12, 0, 0).getTime());
});

test("week points sit at the bucket midpoint, Thursday 12:00 (Monday + 3.5 days)", () => {
  const series = buildTaskLoadSeries(rows, columns, viewport, { granularity: "week" });

  const week = series.points.find((point) => point.weekKey === "2027-02-15");
  assert.equal(week.startTs, new Date(2027, 1, 15).getTime(), "bucket starts Monday 00:00");
  assert.equal(week.midTs, new Date(2027, 1, 18, 12, 0, 0).getTime(), "midpoint is Thursday 12:00");

  // Every bucket's midpoint is halfway between its two Monday boundaries. The
  // next Monday is derived by CALENDAR arithmetic, not startTs + 7 * DAY_MS:
  // across a DST transition the week is 167h or 169h long, and the midpoint
  // moves with it (this is exactly what the boundary-derived midTs gets right).
  series.points.forEach((point) => {
    const monday = new Date(point.startTs);
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    const expected = point.startTs + (nextMonday.getTime() - point.startTs) / 2;
    assert.equal(point.midTs, expected, `week ${point.weekKey} midpoint`);
  });

  // The DST weeks prove the point: in Europe/Paris, the spring-forward week is
  // 167h so its midpoint is Thursday 11:00, and the autumn week is 169h so its
  // midpoint is Thursday 13:00 — the old fixed "Thursday 12:00" was an hour off
  // on both, which the linear timestamp axis would have shown as drift.
  const springWeek = series.points.find((point) => point.weekKey === "2027-03-22");
  const autumnWeek = series.points.find((point) => point.weekKey === "2027-10-25");
  if (springWeek) {
    const offsetHours = (springWeek.midTs - springWeek.startTs) / (60 * 60 * 1000);
    assert.ok(offsetHours === 83.5 || offsetHours === 84, `spring week offset ${offsetHours}h`);
  }
  if (autumnWeek) {
    const offsetHours = (autumnWeek.midTs - autumnWeek.startTs) / (60 * 60 * 1000);
    assert.ok(offsetHours === 84.5 || offsetHours === 84, `autumn week offset ${offsetHours}h`);
  }
});

test("bucket startTs values are the gridline boundaries, inside the window", () => {
  const bounds = getChartWindowBounds(viewport);
  const series = buildTaskLoadSeries(rows, columns, viewport);

  series.points.forEach((point) => {
    assert.ok(
      point.startTs >= bounds.minTs && point.startTs < bounds.maxTs,
      `${point.monthKey} boundary is inside the visible window`
    );
  });
  // The window starts on a 1st, so the first gridline is the window's left edge.
  assert.equal(series.points[0].startTs, bounds.minTs);
});

test("buildTaskLoadSeries: empty / invalid viewport -> empty series", () => {
  assert.deepEqual(buildTaskLoadSeries(rows, columns, {}), {
    points: [],
    byType: {},
    total: [],
    byTypeRealized: {},
    totalRealized: [],
    typesPresent: [],
  });
});
