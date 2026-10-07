import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFloorDeleteActions,
  buildFloorRenameActions,
  buildFloorRenameChanges,
  buildGroupDeleteActions,
  buildGroupDeleteQuestion,
  buildGroupRenameAction,
  buildMoveFields,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
  containerKeyOf,
  findGroup,
  floorRemovalIds,
  groupRemovalIds,
  renameFloorInTaskName,
  resolveDropTarget,
  validateGroupName,
} from "../assets/js/services/syntheseTaskModel.js";
import { templateRows } from "./helpers/templateRows.mjs";

const TODAY = new Date(2026, 8, 23); // mercredi
const byNumber = (left, right) => left - right;

function ss1() {
  const sections = buildSections({ rows: templateRows() });
  return { sections, section: sections[0], floor: sections[0].floors[0] };
}

test("nom de l'étage dans les noms des tâches : « NIV » et « GO » suivis du nom exact", () => {
  assert.equal(
    renameFloorInTaskName("FOND DE PLAN DE SYNTHESE NIV Nouvel étage", "Nouvel étage", "SS1"),
    "FOND DE PLAN DE SYNTHESE NIV SS1"
  );
  assert.equal(
    renameFloorInTaskName("DEMARRAGE GO Nouvel étage (date prévisionnelle)", "Nouvel étage", "SS1"),
    "DEMARRAGE GO SS1 (date prévisionnelle)"
  );
  assert.equal(renameFloorInTaskName("VISA Indice 0", "SS1", "SS2"), "VISA Indice 0");
  assert.equal(renameFloorInTaskName("PLAN NIV SS10", "SS1", "SS2"), "PLAN NIV SS10", "nom exact seulement");
  assert.equal(renameFloorInTaskName("PLAN NIV R+1", "R+1", "R+2"), "PLAN NIV R+2", "caractères spéciaux");
  assert.equal(renameFloorInTaskName("PLAN NIV SS1", "", "SS2"), "PLAN NIV SS1");
});

// Review Focus 3 : renommer l'étage juste après sa création.
test("renommer un étage du modèle : Groupe des tâches et des groupes, noms NIV / GO, en une écriture", () => {
  const { floor } = ss1();
  const changes = buildFloorRenameChanges(floor, "SS2");
  assert.equal(changes.size, 26);
  assert.deepEqual(changes.get(201), { Taches: "SS2" });
  assert.deepEqual(changes.get(203), { Groupe: "SS2" });
  assert.deepEqual(changes.get(204), { Groupe: "SS2", Taches: "FOND DE PLAN DE SYNTHESE NIV SS2" });
  assert.deepEqual(changes.get(205), { Groupe: "SS2" });
  assert.deepEqual(changes.get(226), { Groupe: "SS2", Taches: "DEMARRAGE GO SS2 (date prévisionnelle)" });
  const actions = buildFloorRenameActions(floor, "SS2");
  assert.deepEqual(actions[0], ["UpdateRecord", "Planning_Projet", 201, { Taches: "SS2" }]);
  assert.equal(actions[1][0], "BulkUpdateRecord");
  assert.deepEqual([...actions[1][2]].sort(byNumber), Array.from({ length: 25 }, (_, index) => 202 + index));
  assert.ok(actions[1][3].Groupe.every((name) => name === "SS2"));
  assert.equal(actions[2][0], "BulkUpdateRecord");
  assert.deepEqual([...actions[2][2]].sort(byNumber), [204, 208, 213, 214, 215, 221, 222, 223, 226]);
  assert.ok(actions[2][3].Taches.every((name) => name.includes("SS2")));
});

test("supprimer un étage du modèle : ses 26 lignes en une écriture", () => {
  const { floor } = ss1();
  const ids = floorRemovalIds(floor);
  assert.deepEqual([...ids].sort(byNumber), Array.from({ length: 26 }, (_, index) => 201 + index));
  assert.deepEqual(buildFloorDeleteActions(floor), [["BulkRemoveRecord", "Planning_Projet", ids]]);
});

test("groupes : nom obligatoire, renommer, supprimer avec tout leur contenu", () => {
  const { sections } = ss1();
  assert.deepEqual(validateGroupName("  "), { ok: false, error: "Le nom ne peut pas être vide." });
  assert.deepEqual(validateGroupName("x".repeat(201)), { ok: false, error: "Le nom est limité à 200 caractères." });
  assert.deepEqual(validateGroupName(" CYCLE 1 bis "), { ok: true, name: "CYCLE 1 bis" });
  const c2 = findGroup(sections, 210);
  assert.deepEqual(buildGroupRenameAction(c2, "CYCLE 2 bis"), ["UpdateRecord", "Planning_Projet", 210, { Taches: "CYCLE 2 bis" }]);
  assert.equal(buildGroupDeleteQuestion(c2), "Supprimer « CYCLE 2 » et ses 5 tâches ?");
  assert.deepEqual([...groupRemovalIds(c2)].sort(byNumber), [210, 211, 212, 213, 214, 215, 216]);
  assert.deepEqual(buildGroupDeleteActions(c2), [["BulkRemoveRecord", "Planning_Projet", groupRemovalIds(c2)]]);
  assert.deepEqual([...groupRemovalIds(findGroup(sections, 212))].sort(byNumber), [212, 213, 214, 215]);
  assert.equal(buildGroupDeleteQuestion({ name: "VIDE", tasks: [] }), "Supprimer « VIDE » ?");
  assert.equal(buildGroupDeleteQuestion({ name: "UN", tasks: [{ id: 1 }] }), "Supprimer « UN » et sa tâche ?");
});

test("cible d'un dépôt : une ligne de groupe ou une tâche d'un groupe → ce groupe", () => {
  const lines = buildRowModel(ss1().sections);
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const toS2 = {
    key: "group:212",
    zoneKey: "zonez3a",
    zoneName: "Zone Z3A",
    floorKey: "ss1",
    floorName: "SS1",
    groupRowId: 212,
    label: "Déplacer dans « PLAN SYT CYCLE 2 »",
  };
  assert.deepEqual(resolveDropTarget(line("group:212")), toS2);
  assert.deepEqual(resolveDropTarget(line("task:213")), toS2);
  assert.equal(containerKeyOf(line("task:213")), "group:212");
  assert.equal(resolveDropTarget(line("task:202")).key, "floor:zonez3a/ss1");
  assert.equal("groupRowId" in resolveDropTarget(line("task:202")), false);
  assert.equal(containerKeyOf(line("task:202")), "floor:zonez3a/ss1");
});

test("déplacer une tâche : vers un groupe, Parent écrit ; vers l'étage ou la zone, Parent vidé", () => {
  const { section } = ss1();
  const task = (id) => section.tasks.find((candidate) => candidate.id === id);
  const toC1 = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 203 };
  const toFloor = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1" };
  const toZone = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  assert.deepEqual(buildMoveFields(task(202), toC1), { Parent: "203" });
  assert.deepEqual(buildMoveFields(task(213), toFloor), { Parent: "" });
  assert.deepEqual(buildMoveFields(task(204), toC1), {}, "déjà dans ce cycle");
  assert.deepEqual(buildMoveFields(task(213), toZone), { Groupe: "", Parent: "" });
});

test("nouvelle tâche dans un groupe : Parent écrit en texte", () => {
  const created = buildNewTask({ zoneName: "Zone Z3A", groupName: "SS1", groupTasks: [], today: TODAY, parentId: 212 });
  assert.equal(created.parentId, 212);
  assert.deepEqual(buildTaskFields(created, { projectName: "HOTEL DIEU" }), {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-09-23",
    Diff_armature: "2026-09-23",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z3A",
    Groupe: "SS1",
    Parent: "212",
  });
  assert.equal("Parent" in buildTaskFields(buildNewTask({ zoneName: "Z", today: TODAY })), false);
});
