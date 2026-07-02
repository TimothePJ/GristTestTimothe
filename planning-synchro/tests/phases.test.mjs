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

test("buildPlanningItems: one group per Ligne_planning, items link to groups", () => {
  const rows = [
    { id: 1, Ligne_planning: "1", Taches: "SEMELLE S1", Type_doc: "COFFRAGE", Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" },
    { id: 2, Ligne_planning: "2", Taches: "SEMELLE S2", Type_doc: "COFFRAGE", Date_limite: "2027-03-01", Diff_coffrage: "2027-04-01" },
  ];
  const { groups, items } = buildPlanningItems(rows, cols);

  // One group per distinct Ligne_planning.
  assert.equal(groups.length, 2);
  const groupIds = new Set(groups.map((g) => g.id));
  assert.equal(groupIds.size, 2);

  // Two coffrage items, one per row; each links to an existing group.
  assert.equal(items.length, 2);
  items.forEach((item) => {
    assert.ok(groupIds.has(item.group), `item.group ${item.group} must match an existing group id`);
    assert.equal(typeof item.tooltip, "string");
    assert.ok(item.tooltip.length > 0);
  });

  const s1Item = items.find((i) => i.taskLabel === "SEMELLE S1");
  assert.ok(s1Item, "expected an item for SEMELLE S1");
  assert.equal(s1Item.className, "phase-coffrage");
  assert.equal(formatIsoDate(s1Item.start), "2027-01-01");
  assert.equal(formatIsoDate(s1Item.end), "2027-02-01");

  const s2Item = items.find((i) => i.taskLabel === "SEMELLE S2");
  assert.ok(s2Item, "expected an item for SEMELLE S2");
  assert.equal(s2Item.className, "phase-coffrage");
  // The two items must belong to different groups (different Ligne_planning).
  assert.notEqual(s1Item.group, s2Item.group);
});

test("buildPhaseTooltipHtml: non-aggregated coffrage tooltip carries label and both dates", () => {
  const rows = [
    { id: 1, Ligne_planning: "1", Taches: "SEMELLE S1", Type_doc: "COFFRAGE", Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" },
  ];
  const { items } = buildPlanningItems(rows, cols);
  const item = items[0];
  const html = buildPhaseTooltipHtml(item);

  const startExpected = formatIsoDate(parseCalendarDate("2027-01-01"));
  const endExpected = formatIsoDate(parseCalendarDate("2027-02-01"));

  assert.ok(html.includes("SEMELLE S1"), "tooltip should contain the task label");
  assert.ok(html.includes(startExpected), `tooltip should contain start date ${startExpected}`);
  assert.ok(html.includes(endExpected), `tooltip should contain end date ${endExpected}`);
  // Item's own precomputed tooltip must match the standalone builder output.
  assert.equal(item.tooltip, html);
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
