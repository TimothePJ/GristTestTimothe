import test from "node:test";
import assert from "node:assert/strict";

import { buildFloorDeleteQuestion, buildSections, zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";
import {
  buildStoreyDeleteQuestion,
  checkNewZoneName,
  buildStoreyRename,
  storeyFloorsOf,
  storeyRemovalIds,
  validateNewStorey,
  validateStoreyRename,
  zonesWithFloorName,
} from "../assets/js/services/syntheseStoreys.js";

function row(id, fields = {}) {
  return {
    id, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "",
    Diff_coffrage: null, Diff_armature: null, Duree_1: 0, ...fields,
  };
}
const task = (id, name, zone, group) => row(id, {
  Taches: name, Zone: zone, Diff_coffrage: "2026-01-05", Diff_armature: "2026-01-06", Duree_1: 2, Groupe: group,
});

const floorRow = (id, name, zone) => row(id, { Taches: name, Zone: zone, Etage: true });

const Z1 = "Zone 1 / BAT BC";
const Z2 = "Zone 2 / BAT B";
const Z3 = "Zone 3 / BAT A";
const base = () => [
  floorRow(10, "SS1", Z1),
  floorRow(11, "ss1", Z2),
  task(1, "Plans SS1", Z1, "SS1"),
  task(2, "Plans R+1", Z1, "R+1"),
  task(3, "Plans ss1", Z2, "ss1"),
  task(4, "Plans SS1", Z3, "SS1"),
];
const build = (rows) => buildSections({ rows });
const allIds = (entries) => entries.flatMap(({ floor }) => [
  ...floor.rowIds, ...floor.groups.map((g) => g.rowId), ...floor.tasks.map((t) => t.id),
]);

test("storeyFloorsOf : zones de l'étage, dans l'ordre, sans Sans zone", () => {
  const sections = build([...base(), task(5, "Libre", "", "SS1")]);
  assert.deepEqual(storeyFloorsOf(sections, "ss1").map(({ section }) => section.zoneName), [Z1, Z2, Z3]);
  assert.deepEqual(storeyFloorsOf(sections, "rp1").map(({ section }) => section.zoneName), [Z1]);
});

test("validateStoreyRename : doublon dans une zone de l'étage", () => {
  const sections = build(base());
  assert.deepEqual(validateStoreyRename("R+1", { sections, floorKey: "ss1" }), {
    ok: false, error: "Dans « Zone 1 / BAT BC » : Un étage « R+1 » existe déjà dans cette zone.",
  });
});

test("validateStoreyRename : nom pris seulement dans une zone hors étage", () => {
  const sections = build([task(1, "a", Z1, "SS1"), task(2, "b", Z2, "ss1"), task(3, "c", Z3, "R+1")]);
  assert.deepEqual(validateStoreyRename("R+1", { sections, floorKey: "ss1" }), { ok: true, name: "R+1", key: "rp1" });
});

test("validateStoreyRename : vide et changement de casse", () => {
  const sections = build(base());
  assert.deepEqual(validateStoreyRename("  ", { sections, floorKey: "ss1" }), {
    ok: false, error: "Le nom de l'étage ne peut pas être vide.",
  });
  assert.equal(validateStoreyRename("Ss1", { sections, floorKey: "ss1" }).ok, true);
});

test("buildStoreyRename : changements et actions des deux zones", () => {
  const entries = storeyFloorsOf(build(base()), "ss1").slice(0, 2);
  const { changes, actions } = buildStoreyRename(entries, "SOUS-SOL");
  const expected = allIds(entries);
  assert.ok(expected.length >= 4);
  assert.deepEqual([...changes.keys()].sort(), [...expected].sort());
  const touched = actions.flatMap((action) => (Array.isArray(action[2]) ? action[2] : [action[2]]));
  expected.forEach((id) => assert.ok(touched.includes(id), `ligne ${id} renommée`));
});

test("storeyRemovalIds : union des deux zones", () => {
  const entries = storeyFloorsOf(build(base()), "ss1").slice(0, 2);
  assert.deepEqual(storeyRemovalIds(entries).sort(), allIds(entries).sort());
  assert.deepEqual(storeyRemovalIds([]), []);
});

test("buildStoreyDeleteQuestion", () => {
  assert.equal(buildStoreyDeleteQuestion({ name: "SS1", zoneCount: 2, taskCount: 52 }),
    "Supprimer l'étage « SS1 » dans 2 zones et ses 52 tâches ?");
  assert.equal(buildStoreyDeleteQuestion({ name: "SS1", zoneCount: 1, taskCount: 1 }),
    "Supprimer l'étage « SS1 » dans 1 zone et sa tâche ?");
  assert.equal(buildStoreyDeleteQuestion({ name: "SS1", zoneCount: 2, taskCount: 0 }),
    "Supprimer l'étage « SS1 » dans 2 zones ?");
});

test("buildFloorDeleteQuestion : zoneLabel optionnel", () => {
  const floor = (n) => ({ name: "SS1", tasks: Array.from({ length: n }, (_, i) => ({ id: i })) });
  const zoneLabel = "Zone 1 / BAT BC";
  assert.equal(buildFloorDeleteQuestion(floor(20), { zoneLabel }),
    "Supprimer l'étage « SS1 » de « Zone 1 / BAT BC » et ses 20 tâches ?");
  assert.equal(buildFloorDeleteQuestion(floor(1), { zoneLabel }),
    "Supprimer l'étage « SS1 » de « Zone 1 / BAT BC » et sa tâche ?");
  assert.equal(buildFloorDeleteQuestion(floor(0), { zoneLabel }),
    "Supprimer l'étage « SS1 » de « Zone 1 / BAT BC » ?");
  assert.equal(buildFloorDeleteQuestion(floor(20)), "Supprimer l'étage « SS1 » et ses 20 tâches ?");
});

test("zonesWithFloorName : zones ayant l'étage, sans casse ni accents, jamais Sans zone", () => {
  const sections = build([...base(), task(5, "Libre", "", "R+1")]);
  assert.deepEqual([...zonesWithFloorName(sections, "r+1")], [zoneKeyOf(Z1)]);
  assert.deepEqual([...zonesWithFloorName(sections, "R+1")], [zoneKeyOf(Z1)]);
  assert.equal(zonesWithFloorName(sections, "R-1").size, 0);
  assert.equal(zonesWithFloorName(sections, "  ").size, 0);
  assert.deepEqual([...zonesWithFloorName(sections, "ss1")], [zoneKeyOf(Z1), zoneKeyOf(Z2), zoneKeyOf(Z3)]);
});

test("validateNewStorey : erreurs dans l'ordre, textes exacts", () => {
  const sections = build(base());
  const named = sections.filter((section) => section.zoneKey);
  const k1 = named[0].zoneKey;
  const k2 = named[1].zoneKey;
  assert.deepEqual(validateNewStorey("  ", [k1], { sections }), { ok: false, error: "Le nom de l'étage ne peut pas être vide." });
  assert.deepEqual(validateNewStorey("R+2", [], { sections }), { ok: false, error: "Cochez au moins une zone." });
  assert.deepEqual(validateNewStorey("R+2", ["disparue"], { sections }), {
    ok: false, error: "Une zone cochée n'existe plus : rouvrez la fenêtre.",
  });
  assert.deepEqual(validateNewStorey("R+1", [k2, k1], { sections }), {
    ok: false, error: "Dans « Zone 1 / BAT BC » : Un étage « R+1 » existe déjà dans cette zone.",
  });
});

test("validateNewStorey : ok, zones dédoublonnées et rangées dans l'ordre des sections", () => {
  const sections = build(base());
  const named = sections.filter((section) => section.zoneKey);
  const [k1, k2] = [named[0].zoneKey, named[1].zoneKey];
  assert.deepEqual(validateNewStorey(" R+1 ", [k2, k2], { sections }), { ok: true, name: "R+1", key: "rp1", zoneKeys: [k2], newZones: [] });
  assert.deepEqual(validateNewStorey("R+2", [k2, k1, k2], { sections }), { ok: true, name: "R+2", key: "rp2", zoneKeys: [k1, k2], newZones: [] });
});

// --- Nouvelles zones saisies dans la fenêtre « Ajouter un étage… » ---

test("checkNewZoneName : chaque cas, textes exacts", () => {
  const sections = build(base());
  assert.deepEqual(checkNewZoneName("  ", { sections }), { ok: false, error: "Donnez un nom à la zone." });
  assert.deepEqual(checkNewZoneName("Sans zone", { sections }), {
    ok: false, error: "« Sans zone » est réservé : choisissez un autre nom.",
  });
  assert.deepEqual(checkNewZoneName("---", { sections }), {
    ok: false, error: "Le nom de la zone doit contenir au moins une lettre ou un chiffre.",
  });
  assert.deepEqual(checkNewZoneName("x".repeat(201), { sections }), {
    ok: false, error: "Le nom de la zone est limité à 200 caractères.",
  });
  assert.deepEqual(checkNewZoneName("ZONE 1 / bat bc", { sections }), {
    ok: true, existing: true, zoneKey: zoneKeyOf(Z1), label: Z1,
  });
  assert.deepEqual(checkNewZoneName(" Zone 4 ", { sections }), {
    ok: true, existing: false, zoneKey: zoneKeyOf("Zone 4"), label: "Zone 4",
  });
});

test("validateNewStorey avec de nouvelles zones", () => {
  const sections = build(base());
  const named = sections.filter((section) => section.zoneKey);
  const [k1, k2] = [named[0].zoneKey, named[1].zoneKey];
  const k4 = zoneKeyOf("Zone 4");
  // Seulement une nouvelle zone.
  assert.deepEqual(validateNewStorey("R+2", [], { sections, newZones: [" Zone 4 "] }), {
    ok: true, name: "R+2", key: "rp2", zoneKeys: [], newZones: [{ zoneKey: k4, label: "Zone 4" }],
  });
  // Existante et nouvelle ; deux nouvelles de même clé n'en font qu'une.
  assert.deepEqual(validateNewStorey("R+2", [k2], { sections, newZones: ["Zone 4", "ZONE 4"] }), {
    ok: true, name: "R+2", key: "rp2", zoneKeys: [k2], newZones: [{ zoneKey: k4, label: "Zone 4" }],
  });
  // Sans newZones : comportement inchangé, plus newZones: [].
  assert.deepEqual(validateNewStorey("R+2", [k1], { sections }), {
    ok: true, name: "R+2", key: "rp2", zoneKeys: [k1], newZones: [],
  });
  // Une nouvelle zone devenue existante : fusionnée dans zoneKeys, puis le conflit d'étage est vu.
  assert.deepEqual(validateNewStorey("R+2", [k2], { sections, newZones: ["zone 1 / bat bc"] }), {
    ok: true, name: "R+2", key: "rp2", zoneKeys: [k1, k2], newZones: [],
  });
  assert.deepEqual(validateNewStorey("R+1", [k2], { sections, newZones: ["zone 1 / bat bc"] }), {
    ok: false, error: "Dans « Zone 1 / BAT BC » : Un étage « R+1 » existe déjà dans cette zone.",
  });
  // Nouvelle zone invalide : message préfixé.
  assert.deepEqual(validateNewStorey("R+2", [k1], { sections, newZones: ["Sans zone"] }), {
    ok: false, error: "Zone « Sans zone » : « Sans zone » est réservé : choisissez un autre nom.",
  });
  // Rien du tout.
  assert.deepEqual(validateNewStorey("R+2", [], { sections, newZones: [] }), { ok: false, error: "Cochez au moins une zone." });
  // Le nom de l'étage est vérifié en premier.
  assert.equal(validateNewStorey(" ", [], { sections, newZones: ["Sans zone"] }).error, "Le nom de l'étage ne peut pas être vide.");
});
