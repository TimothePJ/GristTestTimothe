// Contrôleur du tableau Synthese : un nouvel étage suit le modèle du projet (lignes, durées, Parent et
// Lien, Controle_Coffrage si la colonne existe, message si le modèle est illisible), et renommer un
// étage « Nouvel étage » fait suivre son nom dans ses tâches et ses cycles.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { FLOOR_TEMPLATE } from "../assets/js/services/syntheseFloorTemplate.js";
import { buildFloorRenameActions, isDefaultFloorName, zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";

const Z1 = "Zone 1 / BAT BC";
const Z2 = "Zone 2 / BAT B";
const Z2K = zoneKeyOf(Z2);

const THREE = [
  { code: "A", name: "RECEPTION {E}", days: 3 },
  { code: "C", name: "CYCLE 1", nature: "Cycle" },
  { code: "B", name: "PLAN {E}", parent: "C", link: "A FD", days: 5, control: true },
];

function row(id, fields = {}) {
  return {
    id, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "", Groupe: "", Etage: false,
    Nature: "", Parent: "", Lien: "", Controle_Coffrage: false, Diff_coffrage: null, Diff_armature: null, Duree_1: 0, ...fields,
  };
}

const floorRow = (id, name, zone) => row(id, { Taches: name, Zone: zone, Etage: true });

function rowsOf() {
  return [
    floorRow(20, "SS1", Z1),
    floorRow(21, "R+1", Z1),
    floorRow(22, "SS1", Z2),
    row(1, { Taches: "Plans SS1 Z1", Zone: Z1, Groupe: "SS1", Diff_coffrage: "2026-01-05", Diff_armature: "2026-01-06", Duree_1: 2 }),
  ];
}

function withoutColumns(rows, columns) {
  return rows.map((source) => {
    const copy = { ...source };
    columns.forEach((column) => delete copy[column]);
    return copy;
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ rows = rowsOf(), floorTemplate } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode: "editable" };
  const context = {
    async fetchContextRows() {
      return rows.map((source) => ({ ...source }));
    },
    getState: () => ({ ...state, currentProject: { ...state.currentProject } }),
    subscribe() { return () => {}; },
    watchProjectZones() { return () => {}; },
  };
  const writes = [];
  const docApi = {
    async applyUserActions(actions) {
      writes.push(actions);
      if (actions[0][0] !== "BulkAddRecord") return { retValues: [] };
      return { retValues: [Array.from({ length: actions[0][2].length }, (_, index) => 301 + index)] };
    },
  };
  const table = { statuses: [] };
  const floorDialog = { onSubmit: null };
  const calls = { template: 0 };
  const controller = createSyntheseTasksController({
    context,
    docApi,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return {
        render: () => {},
        setStatus: (text, tone) => table.statuses.push({ text, tone }),
        startEditing: () => {},
        startEditingFloor: () => {},
        startEditingGroup: () => {},
        startEditingStorey: () => {},
      };
    },
    confirm: () => true,
    now: () => new Date(2026, 8, 23),
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    createFloorDialog({ onSubmit }) {
      floorDialog.onSubmit = onSubmit;
      return { open: () => {}, close: () => {} };
    },
    createLinkDialog: () => ({ open: () => {}, close: () => {} }),
    ...(floorTemplate ? { getFloorTemplate: () => { calls.template += 1; return floorTemplate; } } : {}),
  });
  return { writes, table, controller, floorDialog, calls };
}

async function activate(env) {
  env.controller.setEditingEnabled(true);
  env.controller.setActive(true);
  await flush();
  env.controller.setLayout("floor");
}

test("Ajouter un étage : les lignes et les durées du modèle du projet", async () => {
  const env = setup({ floorTemplate: { template: THREE, invalid: false } });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2K);
  assert.equal(env.writes.length, 2);
  const [add] = env.writes[0];
  assert.equal(add[0], "BulkAddRecord");
  assert.equal(add[2].length, 4);
  assert.deepEqual(add[3].Duree_1, [0, 3, 0, 5]);
  assert.deepEqual(add[3].Taches, ["Nouvel étage", "RECEPTION Nouvel étage", "CYCLE 1", "PLAN Nouvel étage"]);
  const [parentAndLink] = env.writes[1];
  assert.equal(parentAndLink[0], "BulkUpdateRecord");
  assert.deepEqual(parentAndLink[2], [304]);
  assert.deepEqual(parentAndLink[3].Parent, ["303"]);
  assert.deepEqual(parentAndLink[3].Lien, ["302 FD"]);
  assert.equal(env.calls.template, 1);
});

test("Controle_Coffrage écrit seulement si la colonne existe", async () => {
  const withColumn = setup({ floorTemplate: { template: THREE, invalid: false } });
  await activate(withColumn);
  await withColumn.table.callbacks.onAddFloor(Z2K);
  assert.deepEqual(withColumn.writes[0][0][3].Controle_Coffrage, [false, false, false, true]);

  const without = setup({
    rows: withoutColumns(rowsOf(), ["Controle_Coffrage"]),
    floorTemplate: { template: THREE, invalid: false },
  });
  await activate(without);
  await without.table.callbacks.onAddFloor(Z2K);
  assert.equal("Controle_Coffrage" in without.writes[0][0][3], false);
});

test("modèle illisible : étage créé avec le modèle d'origine, message", async () => {
  const env = setup({ floorTemplate: { template: FLOOR_TEMPLATE, invalid: true } });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2K);
  assert.equal(env.writes[0][0][2].length, 26);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Modèle d'étage du projet illisible : étage créé avec le modèle d'origine.",
    tone: "info",
  });
});

test("sans option : le modèle d'origine, pas de message", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2K);
  assert.equal(env.writes[0][0][2].length, 26);
  assert.notEqual(env.table.statuses.at(-1).text, "Modèle d'étage du projet illisible : étage créé avec le modèle d'origine.");
});

test("« Ajouter un étage… » : le modèle du projet, lu une fois pour deux zones", async () => {
  const env = setup({ floorTemplate: { template: THREE, invalid: false } });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [zoneKeyOf(Z1), Z2K] });
  assert.equal(env.writes[0][0][2].length, 8);
  assert.equal(env.calls.template, 1);
});

test("« Ajouter dans une zone » : le modèle du projet", async () => {
  const env = setup({ floorTemplate: { template: THREE, invalid: false } });
  await activate(env);
  await env.table.callbacks.onAddZoneToFloor("rp1", Z2K);
  assert.equal(env.writes[0][0][2].length, 4);
  assert.equal(env.writes[0][0][3].Zone[0], Z2);
});

test("renommer « Nouvel étage » : le nom suit partout dans ses tâches et cycles", () => {
  const floor = {
    name: "Nouvel étage",
    rowIds: [10],
    tasks: [{ id: 11, name: "PLAN Nouvel étage RDC" }, { id: 12, name: "Autre" }],
    groups: [{ rowId: 13, name: "CYCLE Nouvel étage" }, { rowId: 14, name: "CYCLE 2" }],
  };
  assert.deepEqual(buildFloorRenameActions(floor, "R+1"), [
    ["UpdateRecord", "Planning_Projet", 10, { Taches: "R+1" }],
    ["BulkUpdateRecord", "Planning_Projet", [11, 12, 13, 14], { Groupe: ["R+1", "R+1", "R+1", "R+1"] }],
    ["BulkUpdateRecord", "Planning_Projet", [11], { Taches: ["PLAN R+1 RDC"] }],
    ["BulkUpdateRecord", "Planning_Projet", [13], { Taches: ["CYCLE R+1"] }],
  ]);
  const second = { ...floor, name: "Nouvel étage 2", tasks: [{ id: 11, name: "PLAN Nouvel étage 2 RDC" }], groups: [] };
  assert.deepEqual(buildFloorRenameActions(second, "R+3").at(-1), ["BulkUpdateRecord", "Planning_Projet", [11], { Taches: ["PLAN R+3 RDC"] }]);
});

test("renommer un étage nommé : seuls « NIV » et « GO » suivent, comme avant", () => {
  const floor = {
    name: "R+1",
    rowIds: [10],
    tasks: [{ id: 11, name: "PLAN NIV R+1" }, { id: 12, name: "DEMARRAGE GO R+1 X" }, { id: 15, name: "R+1 libre" }],
    groups: [{ rowId: 13, name: "CYCLE R+1" }],
  };
  const actions = buildFloorRenameActions(floor, "R+2");
  assert.deepEqual(actions.at(-1), ["BulkUpdateRecord", "Planning_Projet", [11, 12], { Taches: ["PLAN NIV R+2", "DEMARRAGE GO R+2 X"] }]);
  assert.equal(actions.length, 3);
});

test("isDefaultFloorName", () => {
  assert.equal(isDefaultFloorName("Nouvel étage"), true);
  assert.equal(isDefaultFloorName("Nouvel étage 2"), true);
  assert.equal(isDefaultFloorName("Nouvel étage 12"), true);
  assert.equal(isDefaultFloorName("Nouvel étage 1"), false);
  assert.equal(isDefaultFloorName("Nouvel étage X"), false);
  assert.equal(isDefaultFloorName("R+1"), false);
  assert.equal(isDefaultFloorName(""), false);
});
