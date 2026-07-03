import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimelineDataFromPlanningRows } from "../assets/js/top/vendor/planningProjetBuilder.js";

const P = "ERA";
const rows = [
  { id: 1, NomProjet: P, ID2: "3001", Zone: "Zone 1", Groupe: "1", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-15", Realise: "0" },
  { id: 2, NomProjet: P, ID2: "3002", Zone: "Zone 2", Groupe: "1", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-10", Diff_coffrage: "2027-02-24", Realise: "100" },
];

test("builder: one group per record + zone headers", () => {
  const { groups, items } = buildTimelineDataFromPlanningRows(rows, P, "", null, null);
  const taskGroups = groups.filter((g) => !g.isZoneHeader);
  const zoneHeaders = groups.filter((g) => g.isZoneHeader);
  assert.equal(taskGroups.length, 2, "two homonym records -> two task rows");
  assert.ok(zoneHeaders.length >= 2, "zone headers present");
  // Each task group gets a coffrage phase band linked to it.
  const phaseItems = items.filter((it) => String(it.className || "").includes("phase-coffrage"));
  assert.equal(phaseItems.length, 2, "one coffrage band per task record");
  const taskGroupIds = new Set(taskGroups.map((g) => g.id));
  phaseItems.forEach((it) => assert.ok(taskGroupIds.has(it.group), "phase band links to a task group"));
});

test("builder: task groups expose taches + zone for the renderer", () => {
  const { groups } = buildTimelineDataFromPlanningRows(rows, P, "", null, null);
  const task = groups.find((g) => !g.isZoneHeader);
  assert.equal(task.tachesLabel, "FONDATIONS - COF");
  assert.ok(task.zoneLabel === "Zone 1" || task.zoneLabel === "Zone 2");
});

test("builder: past phase splits into a phase-past band, retard yields a red inline style", () => {
  const pastRows = [
    { id: 9, NomProjet: P, ID2: "1", Zone: "Zone 1", Taches: "PAST", Type_doc: "COFFRAGE", Date_limite: "2020-01-01", Diff_coffrage: "2020-02-01", Realise: "100" },
    { id: 10, NomProjet: P, ID2: "2", Zone: "Zone 1", Taches: "RETARD", Type_doc: "ARMATURES", Diff_coffrage: "2020-01-10", Diff_armature: "2020-02-10", Realise: "50", Retards: "30" },
  ];
  const { items } = buildTimelineDataFromPlanningRows(pastRows, P, "", null, null);
  assert.ok(items.some((it) => String(it.className || "").includes("phase-past")), "past-dated phase -> phase-past");
  assert.ok(
    items.some((it) => /border-color/i.test(String(it.style || ""))),
    "a retarded row carries an inline retard style"
  );
});
