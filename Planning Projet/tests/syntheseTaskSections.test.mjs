import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  buildRowModel,
  buildSections,
  floorCollapseKey,
  readTask,
  summarizeTasks,
  zoneKeyOf,
} from "../assets/js/services/syntheseTaskModel.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function row(id, fields = {}) {
  return {
    id,
    NomProjet: "HOTEL DIEU",
    Taches: "",
    Type_doc: "",
    ID2: "",
    Zone: "",
    Diff_coffrage: null,
    Diff_armature: null,
    Duree_1: 0,
    ...fields,
  };
}

function task(id, name, zone, start, end, duration) {
  return row(id, { Taches: name, Zone: zone, Diff_coffrage: start, Diff_armature: end, Duree_1: duration });
}

test("récapitulatif : premier Début, dernière Fin, jours ouvrés entre les deux", () => {
  const summary = summarizeTasks([
    readTask(task(1, "Plans avant synthèse", "Z", "2026-09-15", "2026-10-08", 18)),
    readTask(task(2, "Visa MOE", "Z", "2026-10-09", "2026-10-23", 11)),
  ]);
  assert.equal(iso(summary.start), "2026-09-15");
  assert.equal(iso(summary.end), "2026-10-23");
  assert.equal(summary.durationDays, 29);
});

test("récapitulatif façon MS Project : un jalon final ne compte pas son jour (cas « PH RDB »)", () => {
  const summary = summarizeTasks([
    readTask(task(1, "FOND DE PLAN NIV PH RDB ind 0", "Z", "2026-09-14", "2026-09-14", 0)),
    readTask(task(2, "Plans avant synthèse des CET", "Z", "2026-09-15", "2026-10-08", 18)),
    readTask(task(3, "Démarrage PH RDB", "Z", "2027-02-22", "2027-02-22", 0)),
  ]);
  assert.equal(iso(summary.start), "2026-09-14");
  assert.equal(iso(summary.end), "2027-02-22");
  // 113 jours ouvrés du 14/09/26 au 22/02/27 (11/11, 25/12, 01/01 fériés), moins le jour du jalon final.
  assert.equal(summary.durationDays, 112);
});

test("récapitulatif : jalon seul = 0 jour ; tâche finissant le jour du jalon = jour compté ; rien de daté = null", () => {
  assert.equal(summarizeTasks([readTask(task(1, "Jalon", "Z", "2026-10-19", "2026-10-19", 0))]).durationDays, 0);
  const sameDay = summarizeTasks([
    readTask(task(1, "Tâche", "Z", "2026-09-21", "2026-09-25", 5)),
    readTask(task(2, "Jalon", "Z", "2026-09-25", "2026-09-25", 0)),
  ]);
  assert.equal(sameDay.durationDays, 5);
  assert.equal(summarizeTasks([readTask(task(1, "Sans date", "Z", null, null, 0))]), null);
  assert.equal(summarizeTasks([]), null);
});

// Review Focus 5 : une même zone écrite différemment selon les services.
test("sections : zones de toutes les sources, une seule par graphie, triées", () => {
  const rows = [
    row(10, { Zone: "Zone Z2A" }),
    task(1, "Visa MOE", "zone z2a", "2026-10-09", "2026-10-23", 11),
    row(11, { Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001", Zone: "PH SS1" }),
  ];
  const sections = buildSections({ rows, sharedZones: ["ZONE Z1A", "Zone Z2A", "PH SS1"] });
  assert.deepEqual(sections.map((section) => section.label), ["PH SS1", "ZONE Z1A", "Zone Z2A"]);
  const z2a = sections.find((section) => section.zoneKey === zoneKeyOf("Zone Z2A"));
  assert.deepEqual(z2a.tasks.map((item) => item.name), ["Visa MOE"]);
  assert.equal(z2a.summary.durationDays, 11);
  assert.equal(sections[0].tasks.length, 0, "un document n'est pas une tâche");
});

test("sections : tâches triées par date, sans date en dernier, « Sans zone » à la fin", () => {
  const rows = [
    task(1, "B", "Z1", "2026-10-12", "2026-10-13", 2),
    task(2, "Sans date", "Z1", null, null, 0),
    task(3, "A", "Z1", "2026-10-05", "2026-10-06", 2),
    task(4, "Orpheline", "", "2026-10-05", "2026-10-05", 1),
  ];
  const sections = buildSections({ rows });
  assert.deepEqual(sections.map((section) => [section.label, section.zoneKey]), [
    ["Z1", "z1"],
    [NO_ZONE_LABEL, NO_ZONE_KEY],
  ]);
  assert.deepEqual(sections[0].tasks.map((item) => item.name), ["A", "B", "Sans date"]);
});

test("filtre de zone : une seule section, même vide", () => {
  const rows = [task(1, "Visa MOE", "Zone Z2A", "2026-10-09", "2026-10-23", 11), row(2, { Zone: "PH SS1" })];
  assert.deepEqual(buildSections({ rows, zoneFilter: "zone-z2a" }).map((section) => section.label), ["Zone Z2A"]);
  assert.deepEqual(buildSections({ rows, zoneFilter: "PH SS1" })[0].tasks, []);
  assert.deepEqual(buildSections({ rows, zoneFilter: "Zone X" }).map((section) => section.label), ["Zone X"]);
});

test("modèle de lignes : zone puis ses tâches, repli, clés stables", () => {
  const rows = [
    task(1, "Visa MOE", "Zone Z2A", "2026-10-09", "2026-10-23", 11),
    task(2, "Réunion", "Zone Z2A", "2026-11-12", "2026-11-12", 0),
    row(3, { Zone: "PH SS1" }),
  ];
  const sections = buildSections({ rows });
  const open = buildRowModel(sections);
  assert.deepEqual(open.map((line) => [line.key, line.kind, line.level]), [
    ["zone:phss1", "zone", 0],
    ["zone:zonez2a", "zone", 0],
    ["task:1", "task", 1],
    ["task:2", "task", 1],
  ]);
  assert.equal(open[1].childCount, 2);
  assert.equal(open[3].isMilestone, true);
  assert.equal(open[0].durationDays, null, "zone vide : pas de récapitulatif");
  const collapsed = buildRowModel(sections, { collapsedZoneKeys: new Set(["zonez2a"]) });
  assert.deepEqual(collapsed.map((line) => line.key), ["zone:phss1", "zone:zonez2a"]);
  assert.equal(collapsed[1].collapsed, true);
});

function floor(id, name, zone) {
  return row(id, { Taches: name, Zone: zone, Etage: true });
}

function floorTask(id, name, zone, group, start, end, duration) {
  return row(id, { Taches: name, Zone: zone, Groupe: group, Diff_coffrage: start, Diff_armature: end, Duree_1: duration });
}

// Capture MS Project : Zone Z3A = un jalon au niveau zone, puis les étages PH RDB et PH RDH.
function z3aRows() {
  return [
    task(1, "Jalon démarrage GO", "Zone Z3A", "2026-02-02", "2026-02-02", 0),
    floor(20, "PH RDB", "Zone Z3A"),
    floorTask(2, "FOND DE PLAN NIV PH RDB ind 0", "Zone Z3A", "PH RDB", "2026-08-10", "2026-08-10", 0),
    floorTask(3, "Plans avant synthèse des CET", "Zone Z3A", "PH RDB", "2026-08-11", "2026-09-03", 18),
    floor(21, "PH RDH", "Zone Z3A"),
    floorTask(4, "FOND DE PLAN NIV PH RDH ind 0", "Zone Z3A", "PH RDH", "2026-08-24", "2026-08-24", 0),
  ];
}

test("étages : tâches rangées sous leur étage, tâches de zone en haut puis étages", () => {
  const [section] = buildSections({ rows: z3aRows() });
  assert.deepEqual(
    section.items.map((item) => (item.kind === "task" ? `task:${item.task.id}` : `floor:${item.floor.key}`)),
    ["task:1", "floor:phrdb", "floor:phrdh"]
  );
  const rdb = section.floors[0];
  assert.equal(rdb.name, "PH RDB");
  assert.deepEqual(rdb.rowIds, [20]);
  assert.deepEqual(rdb.tasks.map((item) => item.id), [2, 3]);
  assert.equal(iso(rdb.summary.start), "2026-08-10");
  assert.equal(iso(rdb.summary.end), "2026-09-03");
  assert.equal(rdb.summary.durationDays, 19);
  assert.equal(rdb.summary.startsWithMilestone, true);
  assert.deepEqual(section.tasks.map((item) => item.id), [1, 2, 3, 4], "toutes les tâches de la zone");
  assert.equal(iso(section.summary.start), "2026-02-02");
  assert.equal(iso(section.summary.end), "2026-09-03");
});

// Review Focus 5 : un Groupe qui nomme l'étage d'une autre zone.
test("étages issus du Groupe, doublons fusionnés, pas d'étage sans zone ni dans « Sans zone »", () => {
  const rows = [
    ...z3aRows(),
    floor(22, "ph rdb", "Zone Z3A"),
    floorTask(5, "Orpheline", "Zone Z3A", "PH RDC", "2026-09-07", "2026-09-11", 5),
    floor(23, "PH X", ""),
    floorTask(6, "Sans zone", "", "PH RDB", "2026-09-07", "2026-09-07", 1),
    floorTask(7, "Ailleurs", "Zone Z2A", "PH RDB", "2026-09-07", "2026-09-07", 1),
  ];
  const sections = buildSections({ rows });
  assert.deepEqual(sections.map((section) => section.label), ["Zone Z2A", "Zone Z3A", NO_ZONE_LABEL]);
  const z3a = sections[1];
  assert.deepEqual(z3a.floors.map((item) => [item.key, item.name, item.rowIds]), [
    ["phrdb", "PH RDB", [20, 22]],
    ["phrdh", "PH RDH", [21]],
    ["phrdc", "PH RDC", []],
  ]);
  const z2a = sections[0];
  assert.deepEqual(z2a.floors.map((item) => [item.key, item.rowIds, item.tasks.map((entry) => entry.id)]), [
    ["phrdb", [], [7]],
  ]);
  const noZone = sections[2];
  assert.deepEqual(noZone.floors, []);
  assert.deepEqual(noZone.items.map((item) => item.task.id), [6]);
});

test("modèle de lignes : zone, tâches de zone, étages puis leurs tâches ; repli d'un étage", () => {
  const sections = buildSections({ rows: z3aRows() });
  const open = buildRowModel(sections);
  assert.deepEqual(open.map((line) => [line.key, line.kind, line.level, line.floorKey]), [
    ["zone:zonez3a", "zone", 0, ""],
    ["task:1", "task", 1, ""],
    ["floor:zonez3a/phrdb", "floor", 1, "phrdb"],
    ["task:2", "task", 2, "phrdb"],
    ["task:3", "task", 2, "phrdb"],
    ["floor:zonez3a/phrdh", "floor", 1, "phrdh"],
    ["task:4", "task", 2, "phrdh"],
  ]);
  const rdb = open[2];
  assert.equal(rdb.name, "PH RDB");
  assert.equal(rdb.floorName, "PH RDB");
  assert.deepEqual(rdb.floorRowIds, [20]);
  assert.equal(rdb.durationDays, 19);
  assert.equal(rdb.startsWithMilestone, true);
  assert.equal(rdb.childCount, 2);
  assert.equal(open[0].childCount, 3);
  assert.equal(open[3].floorName, "PH RDB");
  const folded = buildRowModel(sections, { collapsedFloorKeys: new Set([floorCollapseKey("zonez3a", "phrdb")]) });
  assert.deepEqual(folded.map((line) => line.key), [
    "zone:zonez3a",
    "task:1",
    "floor:zonez3a/phrdb",
    "floor:zonez3a/phrdh",
    "task:4",
  ]);
  assert.equal(folded[2].collapsed, true);
});

test("niveau zone : tâches hors étage en haut, puis étages, même quand un étage commence avant", () => {
  const sections = buildSections({
    rows: [
      ...z3aRows(),
      task(8, "Réception", "Zone Z3A", "2026-12-14", "2026-12-14", 0),
      task(9, "Sans date", "Zone Z3A", null, null, 0),
      floor(24, "PH RDC", "Zone Z3A"),
    ],
  });
  assert.deepEqual(buildRowModel(sections).map((line) => line.key), [
    "zone:zonez3a",
    "task:1",
    "task:8",
    "task:9",
    "floor:zonez3a/phrdb",
    "task:2",
    "task:3",
    "floor:zonez3a/phrdh",
    "task:4",
    "floor:zonez3a/phrdc",
  ]);
});

test("étages signés : « PH R-1 » et « PH R+1 » restent deux étages distincts", () => {
  const [section] = buildSections({
    rows: [
      floor(30, "PH R-1", "Zone Z3A"),
      floor(31, "PH R+1", "Zone Z3A"),
      floorTask(32, "Tâche du sous-sol", "Zone Z3A", "PH R-1", "2026-09-07", "2026-09-07", 1),
      floorTask(33, "Tâche de l'étage", "Zone Z3A", "PH R+1", "2026-09-08", "2026-09-08", 1),
    ],
  });
  assert.deepEqual(section.floors.map((item) => [item.name, item.rowIds, item.tasks.map((entry) => entry.id)]), [
    ["PH R-1", [30], [32]],
    ["PH R+1", [31], [33]],
  ]);
});
