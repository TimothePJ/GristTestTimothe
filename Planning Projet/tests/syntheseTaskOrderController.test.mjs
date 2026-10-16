// Contrôleur du tableau Synthese avec la colonne Ordre : ajout sous la tâche cliquée, ajout en deux
// temps quand la tâche du dessous doit suivre, déplacement à une place, suppression qui referme la
// chaîne ; sans la colonne, comme avant.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { datedRows } from "./helpers/templateRows.mjs";

const ZONE = "zonez3a";
const TODAY = new Date(2026, 8, 23);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Étage SS1 du modèle daté (ids 201 à 226) ; `withOrder` : la colonne Ordre existe (vide).
function floorRows({ withOrder = true } = {}) {
  return datedRows().map((row) => (withOrder ? { ...row, Ordre: "" } : row));
}

function setup({ rows = floorRows(), applyUserActions = null } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode: "editable", selectedService: "Synthese" };
  const context = {
    async fetchContextRows() {
      return rows.map((row) => ({ ...row }));
    },
    getState: () => ({ ...state, currentProject: { ...state.currentProject } }),
    subscribe() { return () => {}; },
    watchProjectZones() { return () => {}; },
  };
  const writes = [];
  const docApi = {
    async applyUserActions(actions) {
      writes.push(actions);
      return applyUserActions ? applyUserActions(actions, writes.length) : { retValues: [] };
    },
  };
  const table = { renders: [], statuses: [], editing: [] };
  const controller = createSyntheseTasksController({
    context,
    docApi,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return {
        render: (lines, options) => table.renders.push({ lines, options }),
        setStatus: (text, tone) => table.statuses.push({ text, tone }),
        startEditing: (taskId, field) => table.editing.push({ taskId, field }),
        startEditingFloor: () => {},
      };
    },
    confirm: () => true,
    now: () => TODAY,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const keys = () => table.renders.at(-1).lines.map((line) => line.key);
  return { writes, table, controller, keys };
}

async function activate(env) {
  env.controller.setEditingEnabled(true);
  env.controller.setActive(true);
  await flush();
}

test("colonne Ordre : le tableau le sait (glisser entre deux tâches)", async () => {
  const withColumn = setup();
  await activate(withColumn);
  assert.equal(withColumn.table.renders.at(-1).options.canOrder, true);
  const without = setup({ rows: floorRows({ withOrder: false }) });
  await activate(without);
  assert.equal(without.table.renders.at(-1).options.canOrder, false);
});

test("« Ajouter une tâche » sur TERMINAUX : une écriture — la tâche, son rang, son lien, les rangs des autres", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [400] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 220, 223);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.writes[0], [
    ["AddRecord", "Planning_Projet", null, {
      Taches: "Nouvelle tâche", Diff_coffrage: "2026-02-24", Diff_armature: "2026-02-24", Duree_1: 1,
      NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "220", Ordre: "4", Lien: "223 FD",
    }],
    ["BulkUpdateRecord", "Planning_Projet", [221, 222, 223], { Ordre: ["1", "2", "3"] }],
  ]);
  const keys = env.keys();
  assert.deepEqual(keys.slice(keys.indexOf("task:221"), keys.indexOf("task:221") + 4), ["task:221", "task:222", "task:223", "task:400"]);
  assert.deepEqual(env.table.editing.at(-1), { taskId: 400, field: "name" });
  assert.equal(env.table.statuses.at(-1).text, "Tâche ajoutée dans « PLAN SYT CYCLE 3 ».");
});

test("ajout dans une chaîne : la tâche d'abord, puis la tâche du dessous la suit (deuxième écriture)", async () => {
  const env = setup({ applyUserActions: (_actions, count) => ({ retValues: count === 1 ? [400] : [] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 203, 206);
  assert.equal(env.writes.length, 2);
  assert.deepEqual(env.writes[0][0][3].Lien, "206 FD");
  assert.deepEqual(env.writes[1], [
    ["UpdateRecord", "Planning_Projet", 207, { Lien: "400 FD", Diff_coffrage: "2026-01-21", Diff_armature: "2026-02-03", Duree_1: 10 }],
  ]);
  const visa = env.table.renders.at(-1).lines.find((line) => line.key === "task:207");
  assert.equal(visa.link.predId, 400, "VISA 0 suit la nouvelle tâche à l'affichage");
});

test("second temps refusé : la tâche créée est retirée, rien n'est gardé", async () => {
  const env = setup({
    applyUserActions: (actions, count) => {
      if (count === 2) throw new Error("refus Grist");
      return { retValues: count === 1 ? [400] : [] };
    },
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await activate(env);
    await env.table.callbacks.onAddTask(ZONE, "ss1", 203, 206);
  } finally {
    console.error = original;
  }
  assert.deepEqual(env.writes[2], [["RemoveRecord", "Planning_Projet", 400]]);
  assert.equal(env.table.statuses.at(-1).text, "La tâche n'a pas pu être ajoutée complètement : elle a été retirée. Réessayez.");
  assert.equal(env.keys().includes("task:400"), false);
});

test("glisser TERMINAUX avant RÉSERVATIONS : les rangs, en une écriture, affichés tout de suite", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onMoveTask(223, {
    key: "slot:222:before", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 220,
    label: "", position: { taskId: 222, side: "before" },
  });
  assert.deepEqual(env.writes[0], [
    ["BulkUpdateRecord", "Planning_Projet", [221, 222, 223], { Ordre: ["1", "3", "2"] }],
  ]);
  const keys = env.keys();
  assert.deepEqual(keys.slice(keys.indexOf("task:221"), keys.indexOf("task:221") + 3), ["task:221", "task:223", "task:222"]);
});

test("supprimer DIFFUSION FDS : la chaîne se referme dans la même écriture", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onDeleteTask(205);
  assert.deepEqual(env.writes[0], [
    ["RemoveRecord", "Planning_Projet", 205],
    ["UpdateRecord", "Planning_Projet", 206, { Lien: "204 FD" }],
  ]);
});

test("sans la colonne Ordre : la tâche va à la fin, sans rang ni lien, et la barre d'état le dit", async () => {
  const env = setup({ rows: floorRows({ withOrder: false }), applyUserActions: () => ({ retValues: [400] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 220, 221);
  assert.equal(env.writes[0].length, 1);
  const fields = env.writes[0][0][3];
  assert.deepEqual([fields.Ordre, fields.Lien, fields.Parent], [undefined, undefined, "220"]);
  assert.equal(
    env.table.statuses.at(-1).text,
    "Tâche ajoutée à la fin de « PLAN SYT CYCLE 3 » : la colonne « Ordre » (Texte) manque dans Planning_Projet pour la placer sous « PLAN DE SYNTHESE RESEAUX NIV SS1 »."
  );
});

test("« Ajouter une tâche » sur la ligne de CYCLE 2 : à la fin du cycle, après sa dernière tâche, en deux temps", async () => {
  const env = setup({ applyUserActions: (_actions, count) => ({ retValues: count === 1 ? [400] : [] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 210);
  assert.equal(env.writes.length, 2);
  // Première écriture : la tâche, après REUNION + DIFFUSION SYT (216, fin 09/02) : 10/02, 1 jour.
  assert.deepEqual(env.writes[0], [
    ["AddRecord", "Planning_Projet", null, {
      Taches: "Nouvelle tâche", Diff_coffrage: "2026-02-10", Diff_armature: "2026-02-10", Duree_1: 1,
      NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "210", Ordre: "4", Lien: "216 FD",
    }],
    ["BulkUpdateRecord", "Planning_Projet", [211, 212, 216], { Ordre: ["1", "2", "3"] }],
  ]);
  // Seconde écriture : RECEPTION RENDU du cycle 3 (218, « 216 FD », juste en dessous) la suit,
  // 11/02 → 17/02 (5 jours ouvrés), et sa chaîne suit.
  const second = env.writes[1];
  assert.deepEqual(second[0], ["UpdateRecord", "Planning_Projet", 218, {
    Lien: "400 FD", Diff_coffrage: "2026-02-11", Diff_armature: "2026-02-17", Duree_1: 5,
  }]);
  assert.equal(second.length > 1, true, "les tâches liées en aval de 218 suivent");
});
