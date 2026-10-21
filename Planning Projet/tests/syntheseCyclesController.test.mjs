// Contrôleur du tableau Synthese : création d'un cycle ou d'un sous-cycle (une écriture, nom en
// saisie, replis dépliés), refus sans les colonnes du modèle, verrouillé, sans la colonne Ordre.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { buildSections } from "../assets/js/services/syntheseTaskModel.js";
import { buildUpdateActions } from "../assets/js/services/syntheseTaskOrder.js";
import { planCycleMove } from "../assets/js/services/syntheseCycles.js";
import { ERA_PROJECT, ERA_ZONE, ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function withoutColumns(rows, columns) {
  return rows.map((row) => {
    const copy = { ...row };
    columns.forEach((column) => delete copy[column]);
    return copy;
  });
}

function setup({ rows = eraSs1Rows(), applyUserActions = null, confirm = () => true } = {}) {
  const state = { currentProject: { name: ERA_PROJECT, names: [ERA_PROJECT] }, accessMode: "editable", selectedService: "Synthese" };
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
  const table = { renders: [], statuses: [], editing: [], editingGroups: [] };
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
        startEditingGroup: (groupRowId) => table.editingGroups.push(groupRowId),
      };
    },
    confirm,
    now: () => new Date(2026, 9, 20),
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

test("Ajouter un cycle : une écriture, nom en saisie, message", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [3000] }) });
  await activate(env);
  await env.table.callbacks.onAddCycle(ERA_ZONE_KEY, "ss1", null);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.writes[0], [
    ["AddRecord", "Planning_Projet", null, {
      Taches: "Nouveau cycle", Zone: ERA_ZONE, Groupe: "SS1", NomProjet: ERA_PROJECT, Nature: "Cycle", Duree_1: 0, Ordre: "5",
    }],
    ["BulkUpdateRecord", "Planning_Projet", [984, 985, 992, 999], { Ordre: ["1", "2", "3", "4"] }],
  ]);
  assert.deepEqual(env.table.editingGroups, [3000]);
  assert.ok(env.keys().includes("group:3000"));
  assert.deepEqual(env.table.statuses.at(-1), { text: "Cycle ajouté dans l'étage « SS1 ».", tone: "info" });
});

test("Ajouter un sous-cycle dans un cycle replié : la chaîne de ses cycles est dépliée", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [3000] }) });
  await activate(env);
  env.table.callbacks.onToggleGroup(992);
  assert.equal(env.keys().includes("group:994"), false, "le cycle replié cache ses sous-cycles");
  await env.table.callbacks.onAddCycle(ERA_ZONE_KEY, "ss1", 994);
  assert.equal(env.writes[0][0][3].Parent, "994");
  assert.ok(env.keys().includes("group:994"));
  assert.ok(env.keys().includes("group:3000"));
  assert.deepEqual(env.table.statuses.at(-1), { text: "Sous-cycle ajouté dans « PLAN SYT CYCLE 2 ».", tone: "info" });
});

test("colonnes du modèle absentes : entrée grisée, clic expliqué, rien n'est écrit", async () => {
  const env = setup({ rows: withoutColumns(eraSs1Rows(), ["Nature", "Parent", "Lien"]) });
  await activate(env);
  assert.equal(env.table.renders.at(-1).options.canAddCycle, false);
  await env.table.callbacks.onAddCycle(ERA_ZONE_KEY, "ss1", null);
  assert.equal(env.writes.length, 0);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des cycles.",
    tone: "error",
  });
});

test("verrouillé : refus", async () => {
  const env = setup();
  await activate(env);
  env.controller.setEditingEnabled(false);
  await env.table.callbacks.onAddCycle(ERA_ZONE_KEY, "ss1", null);
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.at(-1).text, "Activez « Editer » dans le bandeau pour modifier les tâches.");
  assert.equal(env.table.statuses.at(-1).tone, "error");
});

test("sans Ordre : création possible, sans rang", async () => {
  const env = setup({ rows: withoutColumns(eraSs1Rows(), ["Ordre"]), applyUserActions: () => ({ retValues: [3000] }) });
  await activate(env);
  assert.equal(env.table.renders.at(-1).options.canAddCycle, true);
  await env.table.callbacks.onAddCycle(ERA_ZONE_KEY, "ss1", null);
  assert.equal(env.writes.length, 1);
  assert.equal("Ordre" in env.writes[0][0][3], false);
  assert.equal(env.writes[0].length, 1, "aucune renumérotation");
});

test("Grist refuse les colonnes du modèle : l'entrée est grisée et le message le dit", async () => {
  const env = setup({
    applyUserActions: () => { throw new Error('Invalid column "Nature"'); },
  });
  const original = console.error;
  console.error = () => {};
  try {
    await activate(env);
    await env.table.callbacks.onAddCycle(ERA_ZONE_KEY, "ss1", null);
  } finally {
    console.error = original;
  }
  assert.equal(env.table.renders.at(-1).options.canAddCycle, false);
  assert.match(env.table.statuses.at(-1).text, /pour créer des cycles\.$/);
});

const BEFORE_CYCLE_1 = { key: "group:985", label: "CYCLE 1", zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: null, position: { groupRowId: 985, side: "before" } };

test("glisser CYCLE 2 avant CYCLE 1 : une écriture, celle du plan", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onMoveCycle(992, BEFORE_CYCLE_1);
  await flush();
  const expected = buildUpdateActions(planCycleMove({
    sections: buildSections({ rows: eraSs1Rows() }), groupRowId: 992, target: BEFORE_CYCLE_1, canLink: true,
  }));
  assert.ok(expected.length > 0);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.writes[0], expected);
  assert.equal(env.table.renders.at(-1).options.canMoveCycles, true);
});

test("cycle replié déplié : le cycle d'arrivée est déplié et le cycle déplacé s'y voit", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggleGroup(985);
  assert.equal(env.keys().includes("group:986") || env.keys().includes("task:986"), false);
  env.table.callbacks.onMoveCycle(992, { ...BEFORE_CYCLE_1, groupRowId: 985, position: undefined });
  await flush();
  assert.equal(env.writes.length, 1);
  assert.ok(env.keys().includes("group:985"));
  assert.ok(env.keys().includes("group:992"));
  const header = env.table.renders.at(-1).lines.find((line) => line.key === "group:985");
  assert.equal(header.collapsed, false);
});

test("sans Ordre : pas de poignée, rien n'est écrit", async () => {
  const env = setup({ rows: withoutColumns(eraSs1Rows(), ["Ordre"]) });
  await activate(env);
  assert.equal(env.table.renders.at(-1).options.canMoveCycles, false);
  env.table.callbacks.onMoveCycle(992, BEFORE_CYCLE_1);
  await flush();
  assert.equal(env.writes.length, 0);
});

test("déplacer un cycle verrouillé : refus", async () => {
  const env = setup();
  await activate(env);
  env.controller.setEditingEnabled(false);
  env.table.callbacks.onMoveCycle(992, BEFORE_CYCLE_1);
  await flush();
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.at(-1).text, "Activez « Editer » dans le bandeau pour modifier les tâches.");
});

test("supprimer CYCLE 2 : toutes ses lignes, la chaîne se referme", async () => {
  const questions = [];
  const env = setup({ confirm: (question) => { questions.push(question); return true; } });
  await activate(env);
  await env.table.callbacks.onDeleteGroup(992);
  assert.deepEqual(questions, ["Supprimer « CYCLE 2 », son sous-cycle et ses 5 tâches ?"]);
  assert.equal(env.writes.length, 1);
  const [removal, ...updates] = env.writes[0];
  assert.equal(removal[0], "BulkRemoveRecord");
  assert.deepEqual([...removal[2]].sort((a, b) => a - b), [992, 993, 994, 995, 996, 997, 998]);
  const linkUpdate = updates.find((action) => action[0] === "UpdateRecord" && action[2] === 1000);
  assert.ok(linkUpdate, "CYCLE 3 est relié");
  assert.equal(linkUpdate[3].Lien, "991 FD");
});
