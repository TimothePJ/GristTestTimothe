import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_FLOOR_LABEL,
  buildRowModel,
  buildSections,
  floorCollapseKey,
  storeyCollapseKey,
} from "../assets/js/services/syntheseTaskModel.js";
import { lineNumbersOf } from "../assets/js/services/syntheseLinkColumn.js";

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

function task(id, name, zone, start, end, duration, group = "") {
  return row(id, { Taches: name, Zone: zone, Diff_coffrage: start, Diff_armature: end, Duree_1: duration, Groupe: group });
}

const Z1 = "Zone 1 / BAT BC";
const Z2 = "Zone 2 / BAT B";
const rows = () => [
  task(1, "Plans SS1", Z1, "2026-01-05", "2026-01-06", 2, "SS1"),
  task(2, "Plans R+1", Z1, "2026-03-02", "2026-03-02", 1, "R+1"),
  task(3, "Plans ss1", Z2, "2026-02-02", "2026-02-03", 2, "ss1"),
  task(4, "Hors étage Z2", Z2, "2026-04-01", "2026-04-02", 2),
  task(5, "Sans zone", "", "2026-05-04", "2026-05-05", 2),
];
const sections = (extra = {}) => buildSections({ rows: rows(), ...extra });
const keys = (lines) => lines.map((line) => line.key);

test("mode étage : ordre des lignes", () => {
  const lines = buildRowModel(sections(), { layout: "floor" });
  assert.deepEqual(keys(lines), [
    "storey:ss1", "floor:zone1batbc/ss1", "task:1", "floor:zone2batb/ss1", "task:3",
    "storey:rp1", "floor:zone1batbc/rp1", "task:2",
    "storey:", "zone:zone1batbc", "zone:zone2batb", "task:4", "zone:", "task:5",
  ]);
  assert.ok(lines.every((line) => line.layout === "floor" && line.look));
});

test("ligne étage : nom de la première zone, dates fusionnées, zones manquantes", () => {
  const lines = buildRowModel(sections(), { layout: "floor" });
  const ss1 = lines.find((line) => line.key === "storey:ss1");
  assert.equal(ss1.kind, "storey");
  assert.equal(ss1.name, "SS1");
  assert.equal(ss1.level, 0);
  assert.equal(ss1.look, "floor");
  assert.equal(iso(ss1.start), "2026-01-05");
  assert.equal(iso(ss1.end), "2026-02-03");
  assert.equal(ss1.zoneCount, 2);
  assert.deepEqual(ss1.missingZones, []);
  const rp1 = lines.find((line) => line.key === "storey:rp1");
  assert.deepEqual(rp1.missingZones, [{ zoneKey: "zone2batb", zoneName: Z2, label: Z2 }]);
});

test("zone dans l'étage : niveau 1, nom de la zone, aspect zone", () => {
  const lines = buildRowModel(sections(), { layout: "floor" });
  const zone = lines.find((line) => line.key === "floor:zone2batb/ss1");
  assert.equal(zone.kind, "floor");
  assert.equal(zone.level, 1);
  assert.equal(zone.name, Z2);
  assert.equal(zone.look, "zone");
  assert.equal(zone.floorName, "ss1");
  assert.equal(lines.find((line) => line.key === "task:3").level, 2);
});

test("bloc « Sans étage » : zones et tâches hors étage", () => {
  const lines = buildRowModel(sections(), { layout: "floor" });
  const block = lines.find((line) => line.key === "storey:");
  assert.equal(block.name, NO_FLOOR_LABEL);
  assert.equal(block.floorKey, "");
  assert.equal(block.zoneCount, 3);
  assert.deepEqual(block.missingZones, []);
  assert.equal(iso(block.start), "2026-04-01");
  assert.equal(iso(block.end), "2026-05-05");
  const z2 = lines.find((line) => line.key === "zone:zone2batb");
  assert.equal(z2.level, 1);
  assert.equal(z2.childCount, 1);
  assert.equal(z2.look, "zone");
  assert.equal(lines.find((line) => line.key === "task:4").level, 2);
  assert.equal(lines.find((line) => line.key === "zone:").name, "Sans zone");
});

test("replis : étage et zone dans l'étage", () => {
  const byStorey = buildRowModel(sections(), {
    layout: "floor", collapsedStoreyKeys: new Set([storeyCollapseKey("ss1")]),
  });
  assert.deepEqual(keys(byStorey).slice(0, 3), ["storey:ss1", "storey:rp1", "floor:zone1batbc/rp1"]);
  assert.equal(byStorey[0].collapsed, true);
  const byFloor = buildRowModel(sections(), {
    layout: "floor", collapsedFloorKeys: new Set([floorCollapseKey("zone1batbc", "ss1")]),
  });
  assert.deepEqual(keys(byFloor).slice(0, 4), ["storey:ss1", "floor:zone1batbc/ss1", "floor:zone2batb/ss1", "task:3"]);
});

test("projet sans étage : « Sans étage » puis une ligne par zone", () => {
  const flat = buildSections({ rows: [task(1, "A", Z1, "2026-01-05", "2026-01-06", 2), task(2, "B", Z2, "2026-02-02", "2026-02-03", 2)] });
  assert.deepEqual(keys(buildRowModel(flat, { layout: "floor" })), [
    "storey:", "zone:zone1batbc", "task:1", "zone:zone2batb", "task:2",
  ]);
});

// Comme en mode zone : aucune ligne, pour que le tableau dise qu'il n'y a pas de zone.
test("projet sans zone : aucune ligne, pas même « Sans étage »", () => {
  const empty = buildSections({ rows: [] });
  assert.deepEqual(empty, []);
  assert.deepEqual(buildRowModel(empty, { layout: "floor" }), []);
  assert.deepEqual(buildRowModel(empty), []);
});

test("filtre de zone : l'étage n'a que la zone filtrée", () => {
  const lines = buildRowModel(sections({ zoneFilter: Z2 }), { layout: "floor" });
  const ss1 = lines.find((line) => line.key === "storey:ss1");
  assert.equal(ss1.zoneCount, 1);
  assert.equal(iso(ss1.start), "2026-02-02");
  assert.equal(iso(ss1.end), "2026-02-03");
  assert.deepEqual(ss1.missingZones, []);
});

test("mode zone : sortie inchangée, aucun champ layout/look", () => {
  const base = buildRowModel(sections());
  assert.deepEqual(buildRowModel(sections(), { layout: "zone" }), base);
  assert.ok(base.every((line) => !("layout" in line) && !("look" in line)));
});

test("numéros de ligne en mode étage", () => {
  const { byKey } = lineNumbersOf(sections(), { layout: "floor" });
  assert.equal(byKey.get("storey:ss1"), 1);
  assert.equal(byKey.get("floor:zone1batbc/ss1"), 2);
});
