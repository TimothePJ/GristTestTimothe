// « Ajouter une réunion » (clic droit) : comme « Ajouter une tâche », mais la ligne est une réunion
// du modèle — « REUNION + DIFFUSION SYT », Nature « Reunion » (ligne bleue), jalon de 0 jour.
// Étage du modèle daté (templateRows, Zone Z3A) : CYCLE 3 = 217, VISA A 219 (17/02 → 02/03/26).
import test from "node:test";
import assert from "node:assert/strict";

import { NEW_MEETING_NAME, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import { planTaskInsert } from "../assets/js/services/syntheseTaskOrder.js";
import { buildMenuItems } from "../assets/js/ui/syntheseTaskTable.js";
import { datedRows } from "./helpers/templateRows.mjs";

const ZONE = "zonez3a";
const insert = (options) => planTaskInsert({
  sections: buildSections({ rows: datedRows() }), container: { zoneKey: ZONE, floorKey: "ss1", groupRowId: 217 },
  afterTaskId: 219, canOrder: true, canLink: true, today: new Date(2026, 8, 23), projectName: "HOTEL DIEU", ...options,
});

test("réunion ajoutée sous VISA A : REUNION + DIFFUSION SYT, Nature Reunion, jalon le jour de la Fin de VISA A", () => {
  assert.equal(NEW_MEETING_NAME, "REUNION + DIFFUSION SYT");
  const plan = insert({ meeting: true });
  assert.deepEqual(
    [plan.fields.Taches, plan.fields.Nature, plan.fields.Duree_1, plan.fields.Diff_coffrage, plan.fields.Diff_armature],
    ["REUNION + DIFFUSION SYT", "Reunion", 0, "2026-03-02", "2026-03-02"],
  );
  assert.deepEqual([plan.fields.Lien, plan.fields.Ordre, plan.fields.Parent], ["219 FD", "3", "217"]);
  assert.equal(plan.task.isMilestone, true);
});

test("sans la colonne Ordre : réunion quand même, jalon d'un jour", () => {
  const plan = insert({ meeting: true, canOrder: false, canLink: false });
  assert.deepEqual([plan.fields.Taches, plan.fields.Nature, plan.fields.Duree_1], ["REUNION + DIFFUSION SYT", "Reunion", 0]);
  assert.equal(plan.fields.Diff_coffrage, plan.fields.Diff_armature);
});

test("une tâche ordinaire reste inchangée : ni Nature ni nom de réunion", () => {
  const plan = insert({});
  assert.equal(plan.fields.Taches, "Nouvelle tâche");
  assert.equal("Nature" in plan.fields, false);
  assert.equal(plan.fields.Duree_1, 1);
});

test("menus : « Ajouter une réunion » juste sous chaque « Ajouter une tâche », même place visée", () => {
  const actions = (items) => items.map((item) => item.action);
  const task = { kind: "task", taskId: 219, zoneKey: ZONE, floorKey: "ss1", groupRowId: 217, nature: "", name: "VISA" };
  const taskItems = buildMenuItems(task);
  assert.deepEqual(actions(taskItems).slice(0, 2), ["addTask", "addMeeting"]);
  const [addTask, addMeeting] = taskItems;
  assert.deepEqual({ ...addMeeting, label: undefined, action: undefined, disabled: undefined }, { ...addTask, label: undefined, action: undefined, disabled: undefined });
  assert.equal(addMeeting.label, "Ajouter une réunion");
  assert.equal(addMeeting.disabled, false);
  const group = { kind: "group", groupRowId: 217, zoneKey: ZONE, floorKey: "ss1", nature: "cycle", groupLabel: "CYCLE 3" };
  assert.deepEqual(actions(buildMenuItems(group)).slice(0, 3), ["addTask", "addMeeting", "addCycle"]);
  const floor = { kind: "floor", zoneKey: ZONE, floorKey: "ss1" };
  assert.deepEqual(actions(buildMenuItems(floor)), ["addTask", "addMeeting", "addCycle", "deleteFloor"]);
  const zone = { kind: "zone", zoneKey: ZONE };
  assert.deepEqual(actions(buildMenuItems(zone)), ["addTask", "addMeeting", "addFloor"]);
  // Sans les colonnes du modèle (Nature…) : grisée, comme l'ajout d'un cycle.
  assert.equal(buildMenuItems(task, { canAddCycle: false }).find((item) => item.action === "addMeeting").disabled, true);
  // Fenêtre « Paramètre » : l'étage du modèle propose aussi la réunion.
  assert.deepEqual(actions(buildMenuItems(floor, { templateMode: true })), ["addTask", "addMeeting", "addCycle"]);
});
