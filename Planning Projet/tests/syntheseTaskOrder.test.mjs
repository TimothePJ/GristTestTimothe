// Ordre libre des tâches : conteneurs, liste des tâches d'un étage, renumérotation, écritures
// groupées et cible d'un dépôt (module pur syntheseTaskOrder.js).
import test from "node:test";
import assert from "node:assert/strict";

import { buildRowModel, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import {
  NEW_TASK_ID,
  buildUpdateActions,
  findContainer,
  locateTask,
  planTaskMove,
  renumberItems,
  resolveDropSlot,
  taskOrder,
} from "../assets/js/services/syntheseTaskOrder.js";
import { templateRows } from "./helpers/templateRows.mjs";
import { ERA_ZONE, ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

// Modèle d'étage SS1 (Zone Z3A), ids 201 à 226 (voir tests/helpers/templateRows.mjs) ; plus une
// tâche « Visa MOE » (301) au niveau zone.
const ZONE = "zonez3a";
function rows() {
  return [
    ...templateRows(),
    {
      id: 301, NomProjet: "HOTEL DIEU", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "",
      Etage: false, Nature: "", Parent: "", Lien: "", Diff_coffrage: "2026-02-02", Diff_armature: "2026-02-06", Duree_1: 5,
    },
  ];
}
const sections = () => buildSections({ rows: rows() });
const idsOf = (items) => items.map((item) => (item.kind === "task" ? item.task.id : item.group.rowId));
const FLOOR_ORDER = [202, 204, 205, 206, 207, 208, 209, 211, 213, 214, 215, 216, 218, 219, 221, 222, 223, 224, 225, 226];

test("conteneurs : niveau zone (ses tâches), étage, cycle, sous-groupe ; introuvable → null", () => {
  const all = sections();
  const zone = findContainer(all, { zoneKey: ZONE });
  assert.deepEqual([zone.key, idsOf(zone.items), zone.floor], [`zone:${ZONE}`, [301], null]);
  const floor = findContainer(all, { zoneKey: ZONE, floorKey: "ss1" });
  assert.deepEqual([floor.key, idsOf(floor.items)], [`floor:${ZONE}/ss1`, [202, 203, 210, 217]]);
  const cycle = findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 217 });
  assert.deepEqual([cycle.key, idsOf(cycle.items), cycle.floor.key], ["group:217", [218, 219, 220, 224, 225, 226], "ss1"]);
  assert.deepEqual(idsOf(findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 220 }).items), [221, 222, 223]);
  assert.equal(findContainer(all, { zoneKey: "inconnue" }), null);
  assert.equal(findContainer(all, { zoneKey: ZONE, floorKey: "r1" }), null);
  assert.equal(findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 999 }), null);
});

test("conteneur d'une tâche : son sous-groupe, son cycle, son étage ou le niveau zone", () => {
  const all = sections();
  assert.equal(locateTask(all, 222).key, "group:220");
  assert.equal(locateTask(all, 219).key, "group:217");
  assert.equal(locateTask(all, 202).key, `floor:${ZONE}/ss1`);
  assert.equal(locateTask(all, 301).key, `zone:${ZONE}`);
  assert.equal(locateTask(all, 999), null);
});

test("liste des tâches d'un étage : cycles et sous-groupes traversés, dans l'ordre affiché", () => {
  const all = sections();
  assert.deepEqual(taskOrder(findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 220 })), FLOOR_ORDER);
  assert.deepEqual(taskOrder(findContainer(all, { zoneKey: ZONE })), [301]);
  // Contenu d'un conteneur remplacé : simulation d'un placement.
  const group = findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 220 });
  const reversed = new Map([["group:220", group.items.slice().reverse()]]);
  // PLAN SYT CYCLE 3 est en parallèle : sa tâche pilote RÉSEAUX (221) mène la chaîne, même affichée
  // en dernier ; les autres suivent dans l'ordre affiché.
  assert.deepEqual(taskOrder(group, reversed).slice(14, 17), [221, 223, 222]);
  const placeholder = { kind: "task", task: { id: NEW_TASK_ID } };
  const withNew = new Map([["group:220", [...group.items, placeholder]]]);
  assert.deepEqual(taskOrder(group, withNew).slice(14, 18), [221, 222, 223, NEW_TASK_ID]);
});

test("renumérotation : 1, 2, 3… en texte, seulement pour les lignes dont le rang change", () => {
  const group = findContainer(sections(), { zoneKey: ZONE, floorKey: "ss1", groupRowId: 217 });
  const changes = renumberItems(group.items);
  assert.deepEqual([...changes.entries()], [
    [218, { Ordre: "1" }], [219, { Ordre: "2" }], [220, { Ordre: "3" }],
    [224, { Ordre: "4" }], [225, { Ordre: "5" }], [226, { Ordre: "6" }],
  ]);
  const ranked = group.items.map((item, index) => (item.kind === "task"
    ? { kind: "task", task: { ...item.task, order: index + 1 } }
    : { kind: "group", group: { ...item.group, order: index + 1 } }));
  assert.equal(renumberItems(ranked).size, 0, "déjà rangés");
  const withNew = [{ kind: "task", task: { id: NEW_TASK_ID, order: null } }, ...ranked];
  assert.deepEqual([...renumberItems(withNew).keys()], [218, 219, 220, 224, 225, 226], "la nouvelle tâche est ignorée");
});

test("écritures : une par jeu de colonnes, ids triés ; une seule ligne → UpdateRecord", () => {
  const changes = new Map([
    [223, { Ordre: "3" }],
    [221, { Ordre: "1" }],
    [225, { Lien: "219 FD+5", Diff_coffrage: "2026-04-01" }],
    [222, { Ordre: "2" }],
    [230, {}],
  ]);
  assert.deepEqual(buildUpdateActions(changes), [
    ["BulkUpdateRecord", "Planning_Projet", [221, 222, 223], { Ordre: ["1", "2", "3"] }],
    ["UpdateRecord", "Planning_Projet", 225, { Lien: "219 FD+5", Diff_coffrage: "2026-04-01" }],
  ]);
  assert.deepEqual(buildUpdateActions(new Map()), []);
});

test("cible d'un dépôt : sans colonne Ordre, le conteneur seul, comme avant", () => {
  const lines = buildRowModel(sections());
  const line = (key) => lines.find((candidate) => candidate.key === key);
  assert.deepEqual(resolveDropSlot(line("task:222"), "before"), {
    key: "group:220", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 220,
    label: "Déplacer dans « PLAN SYT CYCLE 3 »",
  });
});

test("cible d'un dépôt avec la colonne Ordre : avant ou après une tâche ; fin d'un conteneur", () => {
  const lines = buildRowModel(sections());
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const before = resolveDropSlot(line("task:219"), "before", { canOrder: true, draggedTaskId: 301 });
  assert.deepEqual(before, {
    key: "slot:219:before", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 217,
    label: "Placer avant « VISA Indice A »", position: { taskId: 219, side: "before" },
  });
  const after = resolveDropSlot(line("task:223"), "after", { canOrder: true });
  assert.deepEqual([after.key, after.label, after.position], [
    "slot:223:after", "Placer après « PLAN DE SYNTHESE TERMINAUX NIV SS1 »", { taskId: 223, side: "after" },
  ]);
  assert.equal(resolveDropSlot(line("task:219"), "after", { canOrder: true, draggedTaskId: 219 }), null, "sur elle-même");
  assert.deepEqual(
    ["group:220", "group:217", `floor:${ZONE}/ss1`, `zone:${ZONE}`].map((key) => {
      const target = resolveDropSlot(line(key), "after", { canOrder: true });
      return [target.key, target.label, target.position ?? null];
    }),
    [
      ["group:220", "Déplacer à la fin de « PLAN SYT CYCLE 3 »", null],
      ["group:217", "Déplacer à la fin de « CYCLE 3 »", null],
      [`floor:${ZONE}/ss1`, "Déplacer à la fin de « SS1 »", null],
      [`zone:${ZONE}`, "Déplacer à la fin du niveau de la zone « Zone Z3A »", null],
    ]
  );
  assert.equal(resolveDropSlot(null, "after", { canOrder: true }), null);
});

test("tâche glissée sur la moitié haute d'un cycle : avant le cycle, dans son conteneur", () => {
  const lines = buildRowModel(sections());
  const cycle = lines.find((candidate) => candidate.key === "group:217");
  const before = resolveDropSlot(cycle, "before", { canOrder: true });
  assert.deepEqual(before, {
    key: "slot:group:217:before", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: null,
    label: "Placer avant « CYCLE 3 »", position: { groupRowId: 217, side: "before" },
  });
  const after = resolveDropSlot(cycle, "after", { canOrder: true });
  assert.deepEqual([after.key, after.groupRowId, after.position], ["group:217", 217, undefined], "moitié basse : fin du cycle");
  assert.deepEqual(resolveDropSlot(cycle, "before"), resolveDropSlot(cycle, "after"), "sans Ordre, rien ne change");
  assert.equal(resolveDropSlot(cycle, "before").position, undefined);
  // Dans un sous-groupe : le conteneur est le cycle qui le contient.
  const nested = resolveDropSlot(lines.find((candidate) => candidate.key === "group:220"), "before", { canOrder: true });
  assert.deepEqual([nested.groupRowId, nested.position], [217, { groupRowId: 220, side: "before" }]);

  const all = buildSections({ rows: eraSs1Rows() });
  const changes = planTaskMove({
    sections: all,
    taskId: 1061,
    target: { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: null, position: { groupRowId: 992, side: "before" } },
    canOrder: true,
    canLink: false,
  });
  assert.deepEqual(changes.get(1061), { Parent: "", Ordre: "3" });
  assert.deepEqual(
    [984, 985, 992, 999].map((rowId) => changes.get(rowId)),
    [{ Ordre: "1" }, { Ordre: "2" }, { Ordre: "4" }, { Ordre: "5" }]
  );
});
