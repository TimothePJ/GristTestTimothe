import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowModel,
  buildSections,
  findGroup,
  groupCollapseKey,
  readTask,
  summarizeTasks,
} from "../assets/js/services/syntheseTaskModel.js";
import { datedRows, templateRows } from "./helpers/templateRows.mjs";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);
const itemKey = (item) => (item.kind === "task" ? item.task.id : `g${item.group.rowId}`);

test("étage du modèle : tâches, cycles et sous-groupes rangés par ordre de création", () => {
  const [section] = buildSections({ rows: templateRows() });
  const [floor] = section.floors;
  assert.equal(floor.name, "SS1");
  assert.deepEqual(floor.items.map(itemKey), [202, "g203", "g210", "g217"]);
  const c2 = findGroup([section], 210);
  assert.equal(c2.name, "CYCLE 2");
  assert.equal(c2.natureKey, "cycle");
  assert.equal(c2.floorKey, "ss1");
  assert.equal(c2.zoneName, "Zone Z3A");
  assert.deepEqual(c2.items.map(itemKey), [211, "g212", 216]);
  const s2 = findGroup([section], 212);
  assert.equal(s2.parentGroup, c2);
  assert.deepEqual(s2.items.map(itemKey), [213, 214, 215]);
  assert.deepEqual(c2.tasks.map((task) => task.id).sort((a, b) => a - b), [211, 213, 214, 215, 216]);
  assert.deepEqual(c2.groups.map((group) => group.rowId), [212]);
  assert.equal(floor.tasks.length, 20);
  assert.deepEqual(floor.groups.map((group) => group.rowId), [203, 210, 212, 217, 220]);
  assert.equal(findGroup([section], 999), null);
  assert.equal(section.tasks.find((task) => task.id === 213).groupRowId, 212);
  assert.equal(section.tasks.find((task) => task.id === 202).groupRowId, null);
});

test("modèle de lignes : zone, étage, cycle, sous-groupe, tâches, sur 5 niveaux", () => {
  const lines = buildRowModel(buildSections({ rows: templateRows() }));
  assert.equal(lines.length, 27);
  const byKey = new Map(lines.map((line) => [line.key, line]));
  assert.deepEqual(lines.slice(0, 5).map((line) => [line.key, line.level]), [
    ["zone:zonez3a", 0],
    ["floor:zonez3a/ss1", 1],
    ["task:202", 2],
    ["group:203", 2],
    ["task:204", 3],
  ]);
  const s2 = byKey.get("group:212");
  assert.deepEqual(
    [s2.kind, s2.level, s2.nature, s2.groupRowId, s2.groupLabel, s2.childCount, s2.taskId],
    ["group", 3, "sous-groupe", 212, "PLAN SYT CYCLE 2", 3, null]
  );
  const reseaux = byKey.get("task:213");
  assert.deepEqual([reseaux.level, reseaux.groupRowId, reseaux.groupLabel, reseaux.floorKey], [4, 212, "PLAN SYT CYCLE 2", "ss1"]);
  assert.deepEqual(reseaux.link, { predId: 211, type: "FD", lag: 0 });
  assert.equal(byKey.get("task:209").nature, "reunion");
  assert.equal(byKey.get("task:226").nature, "demarrage");
  assert.equal(byKey.get("task:204").durationDays, 0, "tâche du modèle créée sans durée : 0");
  const floorLine = byKey.get("floor:zonez3a/ss1");
  assert.deepEqual([floorLine.groupRowId, floorLine.groupLabel, floorLine.nature, floorLine.childCount], [null, "", "", 4]);
  assert.deepEqual([byKey.get("task:202").groupRowId, byKey.get("task:202").id2], [null, ""]);
});

test("repli : un cycle replié masque ses tâches et son sous-groupe", () => {
  const sections = buildSections({ rows: templateRows() });
  const lines = buildRowModel(sections, { collapsedGroupKeys: new Set([groupCollapseKey(210)]) });
  const keys = lines.map((line) => line.key);
  assert.equal(groupCollapseKey(210), "group:210");
  assert.ok(keys.includes("group:210"));
  for (const hidden of ["task:211", "group:212", "task:213", "task:216"]) assert.ok(!keys.includes(hidden), hidden);
  assert.ok(keys.includes("group:217"));
  assert.equal(lines.find((line) => line.key === "group:210").collapsed, true);
});

test("récapitulatifs de la capture : étage 47 j, cycles 22 / 10 / 20 j, PLAN SYT CYCLE 2 5 j", () => {
  const [section] = buildSections({ rows: datedRows() });
  const [floor] = section.floors;
  const summary = (item) => [iso(item.summary.start), iso(item.summary.end), item.summary.durationDays];
  assert.deepEqual(summary(floor), ["2026-01-02", "2026-03-09", 47]);
  assert.deepEqual(summary(findGroup([section], 203)), ["2026-01-02", "2026-02-02", 22]);
  assert.deepEqual(summary(findGroup([section], 210)), ["2026-01-27", "2026-02-09", 10]);
  assert.deepEqual(summary(findGroup([section], 212)), ["2026-02-03", "2026-02-09", 5]);
  assert.deepEqual(summary(findGroup([section], 217)), ["2026-02-10", "2026-03-09", 20]);
  assert.equal(floor.summary.endsWithMilestone, false, "jalons liés en FD : fin de journée");
  assert.equal(floor.summary.startsWithMilestone, false, "FOND DE PLAN commence le jour du premier jalon");
});

test("récapitulatif : un jalon final lié en FD compte son jour, un jalon libre non", () => {
  const task = (id, start, end, duration, link = "") => readTask({
    id, Taches: `T${id}`, Type_doc: "", ID2: "", Zone: "Z", Diff_coffrage: start, Diff_armature: end, Duree_1: duration, Lien: link,
  });
  const work = task(1, "2026-03-02", "2026-03-06", 5);
  assert.equal(summarizeTasks([work, task(2, "2026-03-09", "2026-03-09", 0)]).durationDays, 5);
  const linked = summarizeTasks([work, task(3, "2026-03-09", "2026-03-09", 0, "1 FD+1")]);
  assert.equal(linked.durationDays, 6);
  assert.equal(linked.endsWithMilestone, false);
});

// Review Focus 1 : Parent abîmé à la main dans Grist.
test("Parent cassé : la ligne se range directement dans son étage ; cycle sans étage ignoré", () => {
  const rows = templateRows();
  rows.find((row) => row.id === 204).Parent = "999";
  rows.find((row) => row.id === 205).Parent = "20";
  rows.find((row) => row.id === 212).Parent = "204";
  const extra = (id, fields) => ({
    id, NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z3A", Etage: false, Nature: "", Parent: "", Lien: "",
    Diff_coffrage: null, Diff_armature: null, Duree_1: 1, ...fields,
  });
  rows.push(extra(300, { Taches: "Tâche d'un autre étage", Groupe: "PH RDB", Parent: "203" }));
  rows.push(extra(301, { Taches: "CYCLE ORPHELIN", Groupe: "", Nature: "Cycle" }));
  rows.push(extra(302, { Taches: "Tâche du cycle orphelin", Groupe: "", Parent: "301" }));
  const [section] = buildSections({ rows });
  const ss1 = section.floors.find((floor) => floor.key === "ss1");
  assert.deepEqual(ss1.items.map(itemKey), [202, "g203", 204, 205, "g210", "g212", "g217"]);
  const rdb = section.floors.find((floor) => floor.key === "phrdb");
  assert.deepEqual(rdb.items.map(itemKey), [300], "Parent d'un autre étage : directement dans son étage");
  assert.ok(section.items.some((item) => item.kind === "task" && item.task.id === 302));
  assert.equal(findGroup([section], 301), null);
});

test("étage existant : ses tâches suivent l'ordre de création, plus l'ordre des dates", () => {
  const rows = [
    { id: 20, NomProjet: "HOTEL DIEU", Taches: "PH RDB", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: true },
    { id: 30, NomProjet: "HOTEL DIEU", Taches: "Tardive", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "PH RDB", Diff_coffrage: "2026-10-20", Diff_armature: "2026-10-21", Duree_1: 2 },
    { id: 31, NomProjet: "HOTEL DIEU", Taches: "Précoce", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "PH RDB", Diff_coffrage: "2026-10-01", Diff_armature: "2026-10-02", Duree_1: 2 },
  ];
  const keys = buildRowModel(buildSections({ rows })).map((line) => line.key);
  assert.deepEqual(keys, ["zone:zonez3a", "floor:zonez3a/phrdb", "task:30", "task:31"]);
});
