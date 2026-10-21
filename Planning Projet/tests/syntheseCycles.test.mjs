// Création d'un cycle ou d'un sous-cycle : champs de la ligne et renumérotation du conteneur.
import test from "node:test";
import assert from "node:assert/strict";

import { buildRowModel, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import { NEW_CYCLE_NAME, NEW_SUBCYCLE_NAME, natureForDepth, planCycleInsert, resolveCycleDropSlot } from "../assets/js/services/syntheseCycles.js";
import { ERA_PROJECT, ERA_ZONE, ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

const sections = () => buildSections({ rows: eraSs1Rows() });

test("nature écrite selon la profondeur", () => {
  assert.equal(natureForDepth(1), "Cycle");
  assert.equal(natureForDepth(2), "Sous-groupe");
  assert.equal(natureForDepth(4), "Sous-groupe");
  assert.equal(NEW_CYCLE_NAME, "Nouveau cycle");
  assert.equal(NEW_SUBCYCLE_NAME, "Nouveau sous-cycle");
});

test("nouveau cycle dans l'étage : fin de l'étage, Nature Cycle, sans Parent", () => {
  const plan = planCycleInsert({
    sections: sections(), zoneKey: ERA_ZONE_KEY, floorKey: "ss1", canOrder: true, projectName: ERA_PROJECT,
  });
  assert.deepEqual(plan.fields, {
    Taches: "Nouveau cycle", Zone: ERA_ZONE, Groupe: "SS1", NomProjet: ERA_PROJECT, Nature: "Cycle", Duree_1: 0, Ordre: "5",
  });
  assert.deepEqual(
    [...plan.changes],
    [[984, { Ordre: "1" }], [985, { Ordre: "2" }], [992, { Ordre: "3" }], [999, { Ordre: "4" }]]
  );
  assert.equal(plan.depth, 1);
  assert.equal(plan.parent, null);
  assert.equal(plan.floor.name, "SS1");
});

test("nouveau sous-cycle dans PLAN SYT CYCLE 2 : Parent, Nature Sous-groupe, fin du sous-cycle", () => {
  const plan = planCycleInsert({
    sections: sections(), zoneKey: ERA_ZONE_KEY, floorKey: "ss1", parentGroupRowId: 994, canOrder: true, projectName: ERA_PROJECT,
  });
  assert.equal(plan.fields.Parent, "994");
  assert.equal(plan.fields.Nature, "Sous-groupe");
  assert.equal(plan.fields.Taches, "Nouveau sous-cycle");
  assert.equal(plan.fields.Ordre, "4");
  assert.deepEqual([...plan.changes], [[997, { Ordre: "3" }]]);
  assert.equal(plan.depth, 3);
  assert.equal(plan.parent.rowId, 994);
});

test("sans Ordre : pas de rang", () => {
  const plan = planCycleInsert({ sections: sections(), zoneKey: ERA_ZONE_KEY, floorKey: "ss1", canOrder: false });
  assert.equal("Ordre" in plan.fields, false);
  assert.equal(plan.changes.size, 0);
});

test("conteneur introuvable ou niveau zone : null", () => {
  assert.equal(planCycleInsert({ sections: sections(), zoneKey: ERA_ZONE_KEY, floorKey: "" }), null);
  assert.equal(planCycleInsert({ sections: sections(), zoneKey: ERA_ZONE_KEY, floorKey: "ss1", parentGroupRowId: 9999 }), null);
  assert.equal(planCycleInsert({ sections: sections(), zoneKey: "inconnue", floorKey: "ss1" }), null);
});

test("cibles d'un cycle glissé", () => {
  const lines = buildRowModel(sections());
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const zoneFloor = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1" };
  const dragged = (groupRowId) => ({ groupRowId, zoneKey: ERA_ZONE_KEY, floorKey: "ss1" });
  assert.deepEqual(resolveCycleDropSlot(line("task:1000"), "before", dragged(994)), {
    key: "slot:1000:before", ...zoneFloor, groupRowId: 999,
    label: "Placer avant « RECEPTION RENDU CET RSX RESA TER »", position: { taskId: 1000, side: "before" },
  });
  const beforeCycle = resolveCycleDropSlot(line("group:985"), "before", dragged(992));
  assert.deepEqual(beforeCycle, {
    key: "slot:group:985:before", ...zoneFloor, groupRowId: null,
    label: "Placer avant « CYCLE 1 »", position: { groupRowId: 985, side: "before" },
  });
  assert.deepEqual(resolveCycleDropSlot(line("group:985"), "after", dragged(992)), {
    key: "group:985", ...zoneFloor, groupRowId: 985, label: "Déplacer à la fin de « CYCLE 1 »",
  });
  const floor = resolveCycleDropSlot(line("floor:zone1batbc/ss1"), "before", dragged(992));
  assert.deepEqual([floor.key, floor.groupRowId, floor.label, floor.position], [
    "floor:zone1batbc/ss1", null, "Déplacer à la fin de « SS1 »", undefined,
  ]);
  assert.equal(resolveCycleDropSlot(line("floor:zone1batbc/ss1"), "after", dragged(992)).key, floor.key);
  ["group:992", "group:994", "task:995", "task:998"].forEach((key) => {
    assert.equal(resolveCycleDropSlot(line(key), "before", dragged(992)), null, `${key} est dans le cycle glissé`);
    assert.equal(resolveCycleDropSlot(line(key), "after", dragged(992)), null, `${key} est dans le cycle glissé`);
  });
  assert.equal(resolveCycleDropSlot(line("zone:zone1batbc"), "after", dragged(992)), null, "ligne de zone");
  assert.equal(resolveCycleDropSlot(null, "after", dragged(992)), null);
});

test("cibles d'un cycle glissé : un autre étage n'est jamais visé", () => {
  const rows = [
    ...eraSs1Rows(),
    { ...eraSs1Rows()[0], id: 5000, Taches: "R+1", Etage: true, Lien_Structure: "", Ordre: "" },
    { ...eraSs1Rows()[1], id: 5001, Taches: "Une tâche", Groupe: "R+1", Nature: "", Parent: "", Lien: "", Ordre: "1" },
  ];
  const lines = buildRowModel(buildSections({ rows }));
  const other = lines.filter((candidate) => candidate.floorName === "R+1");
  assert.ok(other.length >= 2, "l'étage ajouté est affiché");
  other.forEach((candidate) => {
    assert.equal(resolveCycleDropSlot(candidate, "before", { groupRowId: 992, zoneKey: ERA_ZONE_KEY, floorKey: "ss1" }), null, candidate.key);
  });
});
