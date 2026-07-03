import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskLoadSeries } from "../assets/js/top/planningChart.js";

const columns = {
  taskName: "Taches",
  taskNameAlt: "Tache",
  typeDoc: "Type_doc",
  dateLimite: "Date_limite",
  diffCoffrage: "Diff_coffrage",
  diffArmature: "Diff_armature",
  demarragesTravaux: "Demarrages_travaux",
};

// Window covering all of 2027 (month buckets Jan..Dec 2027).
const viewport = { firstVisibleDate: "2027-01-01", rangeEndDate: "2027-12-31" };

const rows = [
  // Coffrage due (Diff_coffrage) in Feb 2027.
  { Taches: "FOND", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-20" },
  // Another coffrage due in Feb 2027.
  { Taches: "PH RDC", Type_doc: "COFFRAGE", Date_limite: "2027-02-05", Diff_coffrage: "2027-02-25" },
  // Armature due (Diff_armature) in Mar 2027.
  { Taches: "LONG", Type_doc: "ARMATURES", Diff_coffrage: "2027-03-01", Diff_armature: "2027-03-20" },
  // NDC due (Diff_coffrage) in Feb 2027.
  { Taches: "RSO", Type_doc: "NDC", Date_limite: "2027-02-10", Diff_coffrage: "2027-02-28" },
  // Custom type -> "AUTRES", due May 2027.
  { Taches: "PLAN X", Type_doc: "PLAN SPECIAL", Date_limite: "2027-05-01", Diff_coffrage: "2027-05-15" },
  // Outside the window (2029) -> not counted.
  { Taches: "FUTUR", Type_doc: "COFFRAGE", Date_limite: "2029-01-01", Diff_coffrage: "2029-01-20" },
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

test("buildTaskLoadSeries: empty / invalid viewport -> empty series", () => {
  assert.deepEqual(buildTaskLoadSeries(rows, columns, {}), {
    points: [],
    byType: {},
    total: [],
    typesPresent: [],
  });
});
