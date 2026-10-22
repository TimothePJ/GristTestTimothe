// Contrôleur du tableau Synthese : création d'un cycle ou d'un sous-cycle (une écriture, nom en
// saisie, replis dépliés), déplacement et suppression d'un cycle, passage en escalier ou en
// parallèle ; refus sans les colonnes du modèle, verrouillé, sans la colonne Ordre.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { buildSections } from "../assets/js/services/syntheseTaskModel.js";
import { buildUpdateActions } from "../assets/js/services/syntheseTaskOrder.js";
import { planCycleMove } from "../assets/js/services/syntheseCycles.js";
import { planCycleMode } from "../assets/js/services/syntheseCycleModes.js";
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
  // Fenêtre de lien doublée : ce qu'on lui montre, et son « Valider ».
  const linkDialog = { opens: [], submit: null, closes: 0 };
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
    createLinkDialog({ onSubmit }) {
      linkDialog.submit = onSubmit;
      return { open: (model) => linkDialog.opens.push(model), close: () => { linkDialog.closes += 1; } };
    },
  });
  const keys = () => table.renders.at(-1).lines.map((line) => line.key);
  return { writes, table, controller, keys, linkDialog };
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

test("mode des cycles : lu dans les liens et passé au tableau avec la colonne Lien", async () => {
  const env = setup();
  await activate(env);
  const { lines, options } = env.table.renders.at(-1);
  const modeOf = (key) => lines.find((line) => line.key === key).cycleMode;
  assert.equal(options.canSetCycleMode, true);
  assert.equal(modeOf("group:994"), "parallel");
  assert.equal(modeOf("group:992"), "series");
});

test("passer PLAN SYT CYCLE 2 en escalier : une écriture, celle du plan, et un message", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onSetCycleMode(994, "series");
  const expected = planCycleMode({ sections: buildSections({ rows: eraSs1Rows() }), groupRowId: 994, mode: "series", canLink: true });
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.writes[0], buildUpdateActions(expected));
  assert.equal(env.table.statuses.at(-1).text, "« PLAN SYT CYCLE 2 » passé en escalier.");
  assert.equal(env.table.renders.at(-1).lines.find((line) => line.key === "group:994").cycleMode, "series");
});

test("sans les colonnes du modèle : pas de changement de mode", async () => {
  const env = setup({ rows: withoutColumns(eraSs1Rows(), ["Nature", "Parent", "Lien"]) });
  await activate(env);
  assert.equal(env.table.renders.at(-1).options.canSetCycleMode, false);
});

test("changer le mode d'un cycle verrouillé : refus", async () => {
  const env = setup();
  await activate(env);
  env.controller.setEditingEnabled(false);
  await env.table.callbacks.onSetCycleMode(994, "series");
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.at(-1).text, "Activez « Editer » dans le bandeau pour modifier les tâches.");
});

test("passage bloqué en partie par une boucle : le message le dit", async () => {
  // La RECEPTION de CYCLE 2 dépend de sa REUNION, qui n'a plus de lien : la REUNION ne peut pas
  // finir avec elle.
  const rows = eraSs1Rows().map((row) => {
    if (row.id === 993) return { ...row, Lien: "998 FD" };
    if (row.id === 998) return { ...row, Lien: "" };
    return row;
  });
  const env = setup({ rows });
  await activate(env);
  await env.table.callbacks.onSetCycleMode(992, "parallel");
  assert.equal(env.writes.length, 1);
  assert.equal(
    env.table.statuses.at(-1).text,
    "« CYCLE 2 » n'est passé qu'en partie en parallèle.",
  );
});

test("durée d'une tâche en fin → fin : sa Fin reste celle de la tâche pilote", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEdit(996, "duration", "4");
  await flush();
  assert.deepEqual(env.writes[0][0], ["UpdateRecord", "Planning_Projet", 996, {
    Diff_coffrage: "2025-12-17", Diff_armature: "2025-12-22", Duree_1: 4,
  }]);
});

test("étage neuf : la durée d'une tâche à 0 jour la fait commencer le jour ouvré qui suit (escalier), l'aval suit", async () => {
  // VISA Indice A (1001, « 1000 FD ») encore à 0 jour : jalon le mardi 30/12, Fin de RECEPTION RENDU ;
  // SIGNATURE (« 1001 FD+5 ») et DEMARRAGE GO (« 1007 FD ») le 07/01.
  const fresh = { 1001: ["2025-12-30", 0], 1007: ["2026-01-07", 0], 1008: ["2026-01-07", 0] };
  const rows = eraSs1Rows().map((row) => (row.id in fresh
    ? { ...row, Diff_coffrage: fresh[row.id][0], Diff_armature: fresh[row.id][0], Duree_1: fresh[row.id][1] }
    : row));
  const env = setup({ rows });
  await activate(env);
  env.table.callbacks.onEdit(1001, "duration", "10");
  await flush();
  assert.deepEqual(env.writes[0], [
    ["UpdateRecord", "Planning_Projet", 1001, { Diff_coffrage: "2025-12-31", Diff_armature: "2026-01-14", Duree_1: 10 }],
    ["BulkUpdateRecord", "Planning_Projet", [1007, 1008], {
      Diff_coffrage: ["2026-01-21", "2026-01-21"], Diff_armature: ["2026-01-21", "2026-01-21"], Duree_1: [0, 0],
    }],
  ]);
});

test("passer un sous-cycle en parallèle : un cycle qui l'englobe et se lit alors en parallèle prend sa tâche la plus longue", async () => {
  // CYCLE 2 : RECEPTION (993, 7 j) et la REUNION (998) finissent avec RESEAUX (995, 5 j, « 991 FD ») ;
  // PLAN SYT CYCLE 2 est en escalier. Passé en parallèle, CYCLE 2 se lirait en parallèle autour de
  // RESEAUX, et la RECEPTION commencerait avant la Fin de CYCLE 1.
  const rows = withRows(eraSs1Rows(), {
    995: { Lien: "991 FD", Diff_coffrage: "2025-12-09", Diff_armature: "2025-12-15" },
    993: { Lien: "995 FF", Diff_coffrage: "2025-12-05", Diff_armature: "2025-12-15", Duree_1: 7 },
    998: { Lien: "995 FF", Diff_coffrage: "2025-12-15", Diff_armature: "2025-12-15" },
    996: { Lien: "995 FD", Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-17" },
    997: { Lien: "996 FD", Diff_coffrage: "2025-12-18", Diff_armature: "2025-12-19" },
  });
  const env = setup({ rows });
  await activate(env);
  await env.table.callbacks.onSetCycleMode(994, "parallel");
  assert.equal(env.writes.length, 1);
  const written = (rowId) => writtenFields(env.writes[0], rowId);
  assert.deepEqual([993, 995, 998].map((rowId) => written(rowId).Lien), ["991 FD", "993 FF", "993 FF"]);
  // RECEPTION, 7 jours, le lendemain de la REUNION de CYCLE 1 (08/12) : 09/12 → 17/12.
  assert.deepEqual([written(993).Diff_coffrage, written(993).Diff_armature], ["2025-12-09", "2025-12-17"]);
  assert.deepEqual([modeShown(env, 994), modeShown(env, 992)], ["parallel", "parallel"]);
});

test("la Fin d'une tâche en fin → fin ne se saisit pas : message, rien n'est écrit", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEdit(996, "end", "2025-12-24");
  await flush();
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.table.statuses.at(-1).text,
    "« PLAN DE SYNTHESE RESERVATIONS NIV SS1 » finit avec « PLAN DE SYNTHESE RESEAUX NIV SS1 » (lien FF) : changez sa durée, ou la fin de « PLAN DE SYNTHESE RESEAUX NIV SS1 ».",
  );
});

test("ajouter une tâche dans un cycle en parallèle : elle finit avec la tâche pilote, une seule écriture", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [5000] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ERA_ZONE_KEY, "ss1", 994, null);
  assert.equal(env.writes.length, 1);
  const [add] = env.writes[0];
  assert.equal(add[0], "AddRecord");
  assert.equal(add[3].Lien, "995 FF");
  assert.equal(add[3].Diff_armature, "2025-12-22");
  assert.equal(env.table.renders.at(-1).lines.find((line) => line.key === "group:994").cycleMode, "parallel");
});

// Champs écrits pour une ligne, toutes actions de l'écriture confondues.
function writtenFields(actions, rowId) {
  return actions.reduce((fields, [kind, , ids, values]) => {
    if (kind === "UpdateRecord" && ids === rowId) return { ...fields, ...values };
    if (kind !== "BulkUpdateRecord" || !ids.includes(rowId)) return fields;
    const at = ids.indexOf(rowId);
    return { ...fields, ...Object.fromEntries(Object.entries(values).map(([column, list]) => [column, list[at]])) };
  }, {});
}

// Une ligne de cycle de l'étage SS1.
const cycleRow = (id, name, parent) => ({
  id, NomProjet: ERA_PROJECT, Zone: ERA_ZONE, Groupe: "SS1", Taches: name, Type_doc: "", ID2: "", Etage: false,
  Nature: "Sous-groupe", Parent: parent, Lien: "", Ordre: "", Duree_1: 0, Diff_coffrage: null, Diff_armature: null,
  Service: "Synthese",
});
const withRows = (rows, fieldsById) => rows.map((row) => (fieldsById[row.id] ? { ...row, ...fieldsById[row.id] } : row));
const INTO_PLAN_SYT_CYCLE_2 = { key: "group:994", label: "PLAN SYT CYCLE 2", zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994 };
const modeShown = (env, groupRowId) => env.table.renders.at(-1).lines.find((line) => line.key === `group:${groupRowId}`).cycleMode;

test("glisser une tâche dans un cycle en parallèle : elle finit avec la tâche pilote, dans la même écriture", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onMoveTask(1061, INTO_PLAN_SYT_CYCLE_2);
  await flush();
  assert.equal(env.writes.length, 1);
  const moved = writtenFields(env.writes[0], 1061);
  assert.deepEqual([moved.Parent, moved.Lien, moved.Diff_armature], ["994", "995 FF", "2025-12-22"]);
  assert.equal(modeShown(env, 994), "parallel");
});

test("supprimer la tâche pilote : la suivante prend sa place, dans la même écriture", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onDeleteTask(995);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.writes[0][0], ["RemoveRecord", "Planning_Projet", 995]);
  assert.deepEqual([996, 997, 998].map((rowId) => writtenFields(env.writes[0], rowId).Lien), ["993 FD", "996 FF", "996 FD"]);
  assert.equal(modeShown(env, 994), "parallel");
});

test("supprimer le sous-cycle qui porte la tâche pilote : la tâche restante reprend le lien d'entrée", async () => {
  // RESEAUX et RESERVATIONS dans un sous-sous-cycle en tête de PLAN SYT CYCLE 2.
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    995: { Parent: "2030" }, 996: { Parent: "2030" }, 2030: { Ordre: "1" }, 997: { Ordre: "2" },
  });
  const env = setup({ rows });
  await activate(env);
  await env.table.callbacks.onDeleteGroup(2030);
  assert.equal(env.writes.length, 1);
  assert.deepEqual([997, 998].map((rowId) => writtenFields(env.writes[0], rowId).Lien), ["993 FD", "997 FD"]);
});

test("glisser un sous-cycle en escalier dans un cycle en parallèle : il y est bâti en parallèle", async () => {
  const rows = withRows([...eraSs1Rows(), cycleRow(2020, "SOUS-CYCLE", "999")], {
    1007: { Parent: "2020" }, 1008: { Parent: "2020" },
  });
  const env = setup({ rows });
  await activate(env);
  env.table.callbacks.onMoveCycle(2020, INTO_PLAN_SYT_CYCLE_2);
  await flush();
  assert.equal(env.writes.length, 1);
  assert.deepEqual([1007, 1008].map((rowId) => writtenFields(env.writes[0], rowId).Lien), ["995 FF", "1007 FF"]);
  assert.deepEqual([modeShown(env, 994), modeShown(env, 2020)], ["parallel", "parallel"]);
});

test("ajouter une tâche dans un sous-cycle vide d'un cycle en parallèle : elle finit avec la tâche pilote", async () => {
  const env = setup({ rows: [...eraSs1Rows(), { ...cycleRow(2040, "VIDE", "994"), Ordre: "5" }], applyUserActions: () => ({ retValues: [5000] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ERA_ZONE_KEY, "ss1", 2040, null);
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0][0][3].Lien, "995 FF");
  assert.equal(modeShown(env, 994), "parallel");
});

test("ajouter une tâche dans un sous-cycle vide en tête d'un cycle en parallèle : elle finit avec la tâche pilote, plus longue", async () => {
  const rows = [...eraSs1Rows(), { ...cycleRow(2040, "VIDE", "994"), Ordre: "0" }];
  const env = setup({ rows, applyUserActions: () => ({ retValues: [5000] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ERA_ZONE_KEY, "ss1", 2040, null);
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0][0][3].Lien, "995 FF");
  assert.equal(modeShown(env, 994), "parallel");
});

test("ajoutée dans un cycle en parallèle de jalons, elle est la plus longue : tâche pilote, lien d'entrée repris, décalage compris", async () => {
  // Étage neuf : RESEAUX, RESERVATIONS et TERMINAUX encore à 0 jour, le 17/12 (« 993 FD+2 »).
  const milestone = { Duree_1: 0, Diff_coffrage: "2025-12-17", Diff_armature: "2025-12-17" };
  const rows = withRows([...eraSs1Rows(), { ...cycleRow(2040, "VIDE", "994"), Ordre: "0" }], {
    995: { ...milestone, Lien: "993 FD+2" }, 996: milestone, 997: milestone, 998: milestone,
  });
  const env = setup({ rows, applyUserActions: (_actions, count) => ({ retValues: count === 1 ? [5000] : [] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ERA_ZONE_KEY, "ss1", 2040, null);
  assert.equal(env.writes.length, 2);
  assert.deepEqual([5000, 995, 996, 997, 998].map((rowId) => writtenFields(env.writes[1], rowId).Lien), [
    "993 FD+2", "5000 FF", "5000 FF", "5000 FF", "5000 FD",
  ]);
  assert.equal(writtenFields(env.writes[1], 5000).Diff_coffrage, "2025-12-18");
  assert.equal(modeShown(env, 994), "parallel");
});

test("durée d'une tâche d'un cycle en parallèle allongée au-delà de la tâche pilote : elle la remplace, une écriture", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEdit(996, "duration", "8");
  await flush();
  assert.equal(env.writes.length, 1);
  const written = (rowId) => writtenFields(env.writes[0], rowId);
  assert.deepEqual(written(996), { Lien: "993 FD", Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-26", Duree_1: 8 });
  assert.deepEqual([written(995).Lien, written(995).Diff_coffrage, written(995).Diff_armature], ["996 FF", "2025-12-19", "2025-12-26"]);
  assert.deepEqual([written(998).Lien, written(998).Diff_coffrage], ["996 FD", "2025-12-26"]);
  assert.deepEqual([written(1000).Diff_coffrage, written(1000).Diff_armature], ["2025-12-29", "2026-01-05"]);
  assert.equal(modeShown(env, 994), "parallel");
});

// Lien d'une tâche (numéros de ligne de l'étage SS1 : 12 CYCLE 2, 13 RECEPTION 993, 20 RECEPTION
// 1000, 21 VISA A 1001, 27 SIGNATURE 1007) : affiché dans la colonne Lien, en lecture seule ; choisi
// dans la fenêtre ouverte par « Modifier le lien… » au clic droit sur une tâche.
const fd = (predId, lag = 0) => ({ predId, type: "FD", lag });

test("colonne Lien : chaque ligne a son numéro, chaque tâche son lien par numéro ; menu de lien actif avec la colonne Lien", async () => {
  const env = setup();
  await activate(env);
  const { lines, options } = env.table.renders.at(-1);
  const at = (key) => lines.find((line) => line.key === key);
  assert.deepEqual(
    [at("group:992").lineNumber, at("task:1001").lineNumber, at("task:1001").linkText, at("task:1007").linkText],
    [12, 21, "20FD", "21FD+5"],
  );
  assert.equal(options.canEditLink, true);
});

test("« Modifier le lien… » : la fenêtre s'ouvre sur la tâche, son lien, les tâches de sa zone et l'aperçu", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(1001);
  assert.equal(env.linkDialog.opens.length, 1);
  const model = env.linkDialog.opens[0];
  assert.equal(model.taskName, "VISA Indice A");
  assert.deepEqual(model.current, fd(1000));
  assert.equal(model.rows.find((row) => row.taskId === 1000).selected, true);
  assert.equal(model.preview(fd(993)), "Nouvelles dates : Mar 16/12/25 → Mar 30/12/25");
});

test("lien choisi : la tâche prend les dates de son lien, l'aval suit, une seule écriture", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(1001);
  await env.linkDialog.submit(fd(993));
  await flush();
  assert.equal(env.writes.length, 1);
  assert.deepEqual(writtenFields(env.writes[0], 1001), { Lien: "993 FD", Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-30", Duree_1: 10 });
  // SIGNATURE (« 1001 FD+5 ») et DEMARRAGE GO la suivent : 07/01.
  assert.deepEqual([writtenFields(env.writes[0], 1007).Diff_coffrage, writtenFields(env.writes[0], 1008).Diff_coffrage], ["2026-01-07", "2026-01-07"]);
  assert.equal(env.table.renders.at(-1).lines.find((line) => line.key === "task:1001").linkText, "13FD");
});

test("lien refusé : message, rien n'est écrit", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(1000);
  await env.linkDialog.submit(fd(1001));
  await flush();
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.table.statuses.at(-1).text,
    "Ce lien ferait une boucle : « VISA Indice A » dépend déjà de « RECEPTION RENDU CET RSX RESA TER ».",
  );
});

test("un lien choisi est écrit tel quel : pas de recalage du cycle en parallèle, qui devient mélangé", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(996);
  await env.linkDialog.submit(fd(993));
  await flush();
  assert.deepEqual(env.writes[0], [
    ["UpdateRecord", "Planning_Projet", 996, { Lien: "993 FD", Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-17", Duree_1: 2 }],
  ]);
  assert.equal(modeShown(env, 994), "mixed");
});

test("sans la colonne Lien : lecture seule, et « Modifier le lien… » dit qu'elle manque", async () => {
  const env = setup({ rows: withoutColumns(eraSs1Rows(), ["Lien"]) });
  await activate(env);
  assert.equal(env.table.renders.at(-1).options.canEditLink, false);
  env.table.callbacks.onEditLink(1001);
  assert.equal(env.linkDialog.opens.length, 0);
  assert.equal(env.table.statuses.at(-1).text, "La colonne « Lien » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les tâches.");
});

test("tableau verrouillé : la fenêtre de lien ne s'ouvre pas", async () => {
  const env = setup();
  await activate(env);
  env.controller.setEditingEnabled(false);
  env.table.callbacks.onEditLink(1001);
  assert.equal(env.linkDialog.opens.length, 0);
});

test("CYCLE 3 passé en escalier, puis remis comme à la création par la fenêtre de lien", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onSetCycleMode(999, "series");
  assert.equal(modeShown(env, 999), "series");
  // L'escalier a changé RESEAUX de PLAN SYT CYCLE 3 (après VISA A) et SIGNATURE (après la REUNION) :
  // RESEAUX repart après la RECEPTION (1000), SIGNATURE 5 jours après VISA A (1001).
  for (const [taskId, link] of [[1003, fd(1000)], [1007, fd(1001, 5)]]) {
    env.table.callbacks.onEditLink(taskId);
    await env.linkDialog.submit(link);
    await flush();
  }
  const links = {};
  env.writes.forEach((actions) => [1001, 1003, 1006, 1007, 1008].forEach((rowId) => {
    const fields = writtenFields(actions, rowId);
    if ("Lien" in fields) links[rowId] = fields.Lien;
  }));
  const original = Object.fromEntries(eraSs1Rows().filter((row) => row.id in links).map((row) => [row.id, row.Lien]));
  assert.deepEqual(Object.keys(links).map(Number), [1003, 1007]);
  assert.deepEqual(links, original);
  assert.deepEqual([modeShown(env, 999), modeShown(env, 1002)], ["mixed", "parallel"]);
  const at = (key) => env.table.renders.at(-1).lines.find((line) => line.key === key);
  assert.deepEqual(["task:1001", "task:1003", "task:1006", "task:1007"].map((key) => at(key).linkText), ["20FD", "20FD", "23FD", "21FD+5"]);
});

// Une tâche d'une autre zone, liée à une tâche de SS1 : un filtre de zone ne l'empêche pas de suivre.
const zone2Task = (fields) => ({
  ...eraSs1Rows().find((row) => row.id === 1061), Zone: "Zone 2", Groupe: "", Parent: "", Ordre: "", ...fields,
});

test("lien choisi avec un filtre de zone : une tâche d'une zone masquée qui suit l'aval suit aussi", async () => {
  // 2000 (Zone 2, 3 jours) suit DEMARRAGE GO (1008) : après 07/01, du 08/01 au 12/01.
  const rows = [...eraSs1Rows(), zone2Task({ id: 2000, Taches: "Visa zone 2", Lien: "1008 FD", Diff_coffrage: "2026-01-22", Diff_armature: "2026-01-26", Duree_1: 3 })];
  const env = setup({ rows });
  await activate(env);
  env.controller.setZoneFilter(ERA_ZONE);
  env.table.callbacks.onEditLink(1001);
  await env.linkDialog.submit({ predId: 993, type: "FD", lag: 0 });
  await flush();
  assert.deepEqual([writtenFields(env.writes[0], 2000).Diff_coffrage, writtenFields(env.writes[0], 2000).Diff_armature], ["2026-01-08", "2026-01-12"]);
});

test("durée saisie avec un filtre de zone : le prédécesseur d'une zone masquée compte (fin → fin)", async () => {
  // 2003 (Zone 2) finit avec VISA A (1001, Fin 14/01) ; 5 jours : 08/01 → 14/01.
  const rows = [...eraSs1Rows(), zone2Task({ id: 2003, Taches: "Tâche zone 2", Lien: "1001 FF", Diff_coffrage: "2026-01-13", Diff_armature: "2026-01-14", Duree_1: 2 })];
  const env = setup({ rows });
  await activate(env);
  env.controller.setZoneFilter("Zone 2");
  env.table.callbacks.onEdit(2003, "duration", "5");
  await flush();
  assert.deepEqual(writtenFields(env.writes[0], 2003), { Diff_coffrage: "2026-01-08", Diff_armature: "2026-01-14", Duree_1: 5 });
});

test("fenêtre de lien ouverte : elle se ferme si le tableau est verrouillé, la vue quittée ou le projet changé", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(1001);
  env.controller.setEditingEnabled(false);
  assert.equal(env.linkDialog.closes, 1);
  env.controller.setActive(false);
  assert.equal(env.linkDialog.closes, 2);
});
