import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRowPhases,
  buildPlanningItems,
  aggregatePlanningItems,
  getFirstPhaseDate,
  buildPhaseTooltipHtml,
} from "../assets/js/top/phases.js";
import { formatIsoDate, parseCalendarDate } from "../assets/js/utils/dates.js";

const cols = {
  id: "id", id2: "ID2", groupe: "Groupe",
  taskName: "Taches", taskNameAlt: "Tache", typeDoc: "Type_doc", lignePlanning: "Ligne_planning",
  zone: "Zone", dateLimite: "Date_limite", diffCoffrage: "Diff_coffrage", diffArmature: "Diff_armature",
  demarragesTravaux: "Demarrages_travaux",
};

test("coffrage phase spans Date_limite -> Diff_coffrage", () => {
  const phases = buildRowPhases({ Taches: "FONDATIONS", Type_doc: "COFFRAGE", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16" }, cols);
  const coff = phases.find((p) => p.type === "coffrage");
  assert.ok(coff);
  assert.equal(coff.start.getFullYear(), 2027);
});

test("zone-only row yields no phases", () => {
  assert.equal(buildRowPhases({ Taches: "", Type_doc: "", Zone: "Z02" }, cols).length, 0);
});

test("aggregate merges overlapping same-type into one item with aggregateTasks", () => {
  const rows = [
    { id: 1, Taches: "A", Type_doc: "COFFRAGE", Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" },
    { id: 2, Taches: "B", Type_doc: "COFFRAGE", Date_limite: "2027-01-15", Diff_coffrage: "2027-03-01" },
  ];
  const { groups, items } = aggregatePlanningItems(rows, cols);
  assert.equal(groups.length, 1);
  const merged = items.find((i) => Array.isArray(i.aggregateTasks) && i.aggregateTasks.length === 2);
  assert.ok(merged);
});

test("getFirstPhaseDate returns earliest phase start", () => {
  const rows = [
    { id: 1, Taches: "A", Type_doc: "COFFRAGE", Date_limite: "2027-02-02", Diff_coffrage: "2027-03-16" },
    { id: 2, Taches: "B", Type_doc: "ARMATURES", Diff_coffrage: "2027-01-10", Diff_armature: "2027-02-01" },
  ];
  assert.equal(getFirstPhaseDate(rows, cols), "2027-01-10");
});

test("buildPlanningItems (adapter): task-only labels + zone headers + item type/className", () => {
  // Delegates to the vendored Planning Projet builder; the adapter keeps the
  // visible label = Tâche only and preserves zone headers + item type/style.
  // (Grouping/ordering fidelity is covered by planningProjetBuilder.test.mjs.)
  const P = "ERA";
  const rows = [
    { id: 10, NomProjet: P, ID2: "3002", Zone: "Zone 2 / BAT B", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2026-08-19", Diff_coffrage: "2026-09-02" },
    { id: 11, NomProjet: P, ID2: "3001", Zone: "Zone 1 / BAT BC", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2026-12-30", Diff_coffrage: "2027-01-13" },
  ];
  const { groups, items } = buildPlanningItems(rows, cols, { project: P });

  const taskGroups = groups.filter((g) => !g.isZoneHeader);
  const zoneHeaders = groups.filter((g) => g.isZoneHeader);
  assert.equal(taskGroups.length, 2, "homonyms stay distinct task rows");
  assert.ok(zoneHeaders.length >= 2, "zone header rows present");
  taskGroups.forEach((g) => assert.equal(g.label, "FONDATIONS - COF", "visible label = task name only"));
  const z1 = taskGroups.find((g) => g.titleText.includes("Zone 1 / BAT BC"));
  assert.ok(z1 && z1.titleText.includes("3001"), "task hover title carries ID2 + Zone");
  assert.ok(zoneHeaders.some((g) => g.label.includes("Zone 1")), "zone header label = zone name");

  const phaseItems = items.filter((it) => String(it.className).includes("phase-coffrage"));
  assert.equal(phaseItems.length, 2, "one coffrage band per task record");
  phaseItems.forEach((it) => assert.equal(it.type, "range"));
  assert.ok(
    items.some((it) => it.type === "background" && String(it.className).includes("zone-header-fill")),
    "zone header background band present"
  );
});

test("buildPhaseTooltipHtml: coffrage tooltip carries label and both dates", () => {
  const start = parseCalendarDate("2027-01-01");
  const end = parseCalendarDate("2027-02-01");
  const item = { className: "phase-coffrage", taskLabel: "SEMELLE S1", start, end, phaseLabel: "Coffrage" };
  const html = buildPhaseTooltipHtml(item);

  assert.ok(html.includes("SEMELLE S1"), "tooltip should contain the task label");
  assert.ok(html.includes(formatIsoDate(start)), "tooltip should contain start date");
  assert.ok(html.includes(formatIsoDate(end)), "tooltip should contain end date");
});

test("buildPhaseTooltipHtml: aggregated tooltip lists both composing task labels", () => {
  const rows = [
    { id: 1, Taches: "A", Type_doc: "COFFRAGE", Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" },
    { id: 2, Taches: "B", Type_doc: "COFFRAGE", Date_limite: "2027-01-15", Diff_coffrage: "2027-03-01" },
  ];
  const { items } = aggregatePlanningItems(rows, cols);
  const merged = items.find((i) => Array.isArray(i.aggregateTasks) && i.aggregateTasks.length === 2);
  assert.ok(merged, "expected a merged item with 2 aggregate tasks");

  const html = buildPhaseTooltipHtml(merged);
  assert.ok(html.includes("A"), "aggregated tooltip should list task A");
  assert.ok(html.includes("B"), "aggregated tooltip should list task B");
  // Each composing task's start/end appears in the aggregate list.
  assert.ok(html.includes(formatIsoDate(parseCalendarDate("2027-01-01"))));
  assert.ok(html.includes(formatIsoDate(parseCalendarDate("2027-03-01"))));
});
