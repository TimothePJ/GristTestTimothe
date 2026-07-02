import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRowPhases, aggregatePlanningItems, getFirstPhaseDate } from "../assets/js/top/phases.js";

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
