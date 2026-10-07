import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";
import { buildFloorFromTemplate } from "../assets/js/services/syntheseFloorTemplate.js";
import { datedRows, templateRows } from "./helpers/templateRows.mjs";

const TODAY = new Date(2026, 8, 23);
const Z2A = zoneKeyOf("Zone Z2A");

function planningRows() {
  return [
    { id: 10, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "Zone Z2A", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { id: 5, NomProjet: "HOTEL DIEU", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Zone Z2A", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 },
  ];
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Minuteries réglées à la main : rien ne part tout seul pendant les tests.
function manualTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    pending,
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    runAll() {
      const entries = [...pending.values()];
      pending.clear();
      entries.forEach(({ callback }) => callback());
    },
  };
}

function setup({ rows = planningRows(), accessMode = "editable", applyUserActions = null, confirm = () => true, timers = manualTimers() } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode };
  const listeners = { tables: [], context: [], zones: [] };
  const context = {
    rows,
    nextFetch: null,
    fetches: [],
    async fetchContextRows(tableName, options) {
      context.fetches.push({ tableName, options });
      if (typeof context.nextFetch === "function") return context.nextFetch();
      return context.rows.map((row) => ({ ...row }));
    },
    getState: () => ({ ...state, currentProject: state.currentProject ? { ...state.currentProject } : null }),
    watchContextTables(tableNames, callback) { listeners.tables.push(callback); return () => {}; },
    subscribe(listener) { listeners.context.push(listener); return () => {}; },
    watchProjectZones(listener) { listeners.zones.push(listener); return () => {}; },
  };
  const writes = [];
  const docApi = {
    async applyUserActions(actions) {
      writes.push(actions);
      return applyUserActions ? applyUserActions(actions) : { retValues: [] };
    },
  };
  const table = { renders: [], statuses: [], editing: [], callbacks: null };
  const controller = createSyntheseTasksController({
    context,
    docApi,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return {
        render: (lines, options) => table.renders.push({ lines, options }),
        setStatus: (text, tone) => table.statuses.push({ text, tone }),
        startEditing: (taskId, field) => table.editing.push({ taskId, field }),
        startEditingFloor: (zoneKey, floorKey) => table.editing.push({ zoneKey, floorKey }),
      };
    },
    confirm,
    now: () => TODAY,
    timers,
  });
  const lastRender = () => table.renders.at(-1);
  const taskLine = (taskId) => lastRender().lines.find((line) => line.taskId === taskId);
  return { state, listeners, context, writes, table, controller, lastRender, taskLine, timers };
}

async function activate(env, { editing = true } = {}) {
  env.controller.setEditingEnabled(editing);
  env.controller.setActive(true);
  await flush();
}

function twoTaskRows() {
  return [
    ...planningRows(),
    { id: 6, NomProjet: "HOTEL DIEU", Taches: "Plans CET", Type_doc: "", ID2: "", Zone: "Zone Z2A", Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-16", Duree_1: 5 },
  ];
}

// Écritures réglées à la main : chaque appel attend qu'on le résolve ou le rejette.
function manualWrites() {
  const calls = [];
  return {
    calls,
    applyUserActions: (actions) => new Promise((resolve, reject) => calls.push({ actions, resolve, reject })),
  };
}

// Zone Z2A : l'étage PH RDB (Visa MOE dedans) et la tâche Plans CET au niveau zone.
function floorRows() {
  return [
    { id: 10, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: false, Nature: "", Parent: "", Lien: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { id: 20, NomProjet: "HOTEL DIEU", Taches: "PH RDB", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: true, Nature: "", Parent: "", Lien: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { id: 5, NomProjet: "HOTEL DIEU", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "PH RDB", Etage: false, Nature: "", Parent: "", Lien: "", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 },
    { id: 6, NomProjet: "HOTEL DIEU", Taches: "Plans CET", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: false, Nature: "", Parent: "", Lien: "", Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-16", Duree_1: 5 },
  ];
}

test("charge les lignes du projet et dessine zones et tâches", async () => {
  const env = setup();
  await activate(env, { editing: false });
  assert.equal(env.context.fetches[0].tableName, "Planning_Projet");
  const { lines, options } = env.lastRender();
  assert.deepEqual(lines.map((line) => line.key), [`zone:${Z2A}`, "task:5"]);
  assert.equal(options.editable, false);
  assert.equal(options.emptyMessage, "");
});

test("inactif : aucune lecture", async () => {
  const env = setup();
  env.controller.setEditingEnabled(true);
  env.controller.setZoneFilter("Zone Z2A");
  await flush();
  assert.equal(env.context.fetches.length, 0);
  assert.equal(env.table.renders.length, 0);
});

test("aucun projet : message d'invite", async () => {
  const env = setup();
  env.state.currentProject = null;
  await activate(env);
  assert.match(env.lastRender().options.emptyMessage, /Choisissez un projet/);
});

test("sans « Editer », aucune écriture et un message", async () => {
  const env = setup();
  await activate(env, { editing: false });
  await env.table.callbacks.onEdit(5, "duration", "5");
  await env.table.callbacks.onAddTask(Z2A);
  await env.table.callbacks.onDeleteTask(5);
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /Activez « Editer »/);
});

// Review Focus 2.
test("service passé en lecture seule avant la validation : rien n'est écrit", async () => {
  const env = setup();
  await activate(env);
  env.state.accessMode = "readonly";
  await env.table.callbacks.onEdit(5, "duration", "5");
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /lecture seule/);
});

test("modification : affichage immédiat, UpdateRecord aussitôt, la main rendue sans attendre Grist", async () => {
  let release;
  const env = setup({ applyUserActions: () => new Promise((resolve) => { release = resolve; }) });
  await activate(env);
  const returned = env.table.callbacks.onEdit(5, "duration", "5");
  assert.equal(returned, undefined, "le tableau n'attend pas l'enregistrement");
  assert.equal(env.taskLine(5).durationDays, 5, "affiché avant la réponse de Grist");
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 5, {
    Diff_coffrage: "2026-10-09",
    Diff_armature: "2026-10-15",
    Duree_1: 5,
  }]]);
  release({ retValues: [null] });
  await flush();
  assert.equal(env.taskLine(5).durationDays, 5);
});

test("écriture refusée par Grist : l'ancienne valeur revient avec un message", async () => {
  const env = setup({
    applyUserActions: () => Promise.reject(new Error("Le service Structure est accessible en lecture seule.")),
  });
  await activate(env);
  await env.table.callbacks.onEdit(5, "duration", "5");
  await flush();
  assert.equal(env.taskLine(5).durationDays, 11);
  assert.match(env.table.statuses.at(-1).text, /lecture seule/);
});

test("saisie refusée par les règles : rien n'est écrit", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onEdit(5, "start", "1999-01-01");
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /entre 2000 et 2100/);
});

// Review Focus 3.
test("ajout dans une zone repliée : AddRecord, zone dépliée, nom en saisie", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [42] }) });
  await activate(env);
  env.table.callbacks.onToggleZone(Z2A);
  assert.equal(env.lastRender().lines.length, 1, "zone repliée");
  await env.table.callbacks.onAddTask(Z2A);
  assert.deepEqual(env.writes[0], [["AddRecord", "Planning_Projet", null, {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z2A",
  }]]);
  assert.ok(env.taskLine(42), "la nouvelle ligne est affichée");
  assert.deepEqual(env.table.editing.at(-1), { taskId: 42, field: "name" });
});

test("suppression : rien sans confirmation, RemoveRecord sinon", async () => {
  let answer = false;
  const env = setup({ confirm: () => answer });
  await activate(env);
  await env.table.callbacks.onDeleteTask(5);
  assert.equal(env.writes.length, 0);
  answer = true;
  await env.table.callbacks.onDeleteTask(5);
  assert.deepEqual(env.writes[0], [["RemoveRecord", "Planning_Projet", 5]]);
  assert.equal(env.taskLine(5), undefined);
});

test("zones des autres services : ajoutées pour le projet courant seulement", async () => {
  const env = setup();
  await activate(env);
  env.listeners.zones.forEach((listener) => listener(["PH SS1"], { projectNames: ["HOTEL DIEU"] }));
  assert.ok(env.lastRender().lines.some((line) => line.name === "PH SS1"));
  env.listeners.zones.forEach((listener) => listener(["Autre projet"], { projectNames: ["VENTADOUR"] }));
  assert.equal(env.lastRender().lines.some((line) => line.name === "Autre projet"), false);
});

test("filtre de zone du bandeau", async () => {
  const env = setup({
    rows: [...planningRows(), { id: 11, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "PH SS1" }],
  });
  await activate(env);
  env.controller.setZoneFilter("ph ss1");
  assert.deepEqual(env.lastRender().lines.map((line) => line.name), ["PH SS1"]);
  env.controller.setZoneFilter("");
  assert.equal(env.lastRender().lines.length, 3);
});

test("changement de projet : une réponse arrivée trop tard est ignorée", async () => {
  const env = setup();
  let releaseFirst;
  env.context.nextFetch = () => new Promise((resolve) => { releaseFirst = resolve; });
  env.controller.setActive(true);
  env.state.currentProject = { name: "VENTADOUR", names: ["VENTADOUR"] };
  env.context.nextFetch = () => [{ id: 20, NomProjet: "VENTADOUR", Taches: "", Type_doc: "", ID2: "", Zone: "ZONE 01" }];
  env.listeners.context.forEach((listener) => listener(env.context.getState()));
  await flush();
  releaseFirst(planningRows());
  await flush();
  assert.deepEqual(env.lastRender().lines.map((line) => line.name), ["ZONE 01"]);
});

test("refresh() relit le cache frais ; inactif, il ne lit rien", async () => {
  const env = setup();
  await activate(env);
  const before = env.context.fetches.length;
  await env.controller.refresh();
  assert.equal(env.context.fetches.length, before + 1);
  assert.deepEqual(env.context.fetches.at(-1).options, {});
  await env.controller.refresh({ forceRefresh: true });
  assert.deepEqual(env.context.fetches.at(-1).options, { forceRefresh: true });
  env.controller.setActive(false);
  await env.controller.refresh();
  assert.equal(env.context.fetches.length, before + 2);
});

test("le contrôleur ne pose pas sa propre surveillance de Planning_Projet", async () => {
  const env = setup();
  await activate(env);
  assert.equal(env.listeners.tables.length, 0);
});

test("saisies rapides : enregistrées une à une, dans l'ordre, la suivante calculée sur la précédente", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(5, "start", "2026-10-12");
  assert.equal(env.writes.length, 1, "la seconde attend la première");
  assert.equal(env.taskLine(5).durationDays, 4);
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.equal(env.writes.length, 2);
  assert.deepEqual(env.writes[1], [["UpdateRecord", "Planning_Projet", 5, {
    Diff_coffrage: "2026-10-12",
    Diff_armature: "2026-10-15",
    Duree_1: 4,
  }]]);
  manual.calls[1].resolve({ retValues: [null] });
  await flush();
  assert.equal(env.taskLine(5).durationDays, 4);
});

test("écriture refusée : la saisie et les suivantes de la même tâche sont annulées, les autres tâches gardent les leurs", async () => {
  const manual = manualWrites();
  const env = setup({ rows: twoTaskRows(), applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(5, "name", "Visa MOE (2e)");
  env.table.callbacks.onEdit(6, "duration", "3");
  manual.calls[0].reject(new Error("Le service Structure est accessible en lecture seule."));
  await flush();
  assert.equal(env.taskLine(5).durationDays, 11, "valeur de Grist revenue");
  assert.equal(env.taskLine(5).name, "Visa MOE", "saisie suivante de la même tâche annulée");
  assert.equal(env.taskLine(6).durationDays, 3, "l'autre tâche garde sa saisie");
  assert.match(env.table.statuses.at(-1).text, /lecture seule[\s\S]*saisies suivantes/);
  assert.equal(env.writes.length, 2, "la saisie annulée n'est jamais envoyée");
  assert.deepEqual(env.writes[1][0].slice(0, 3), ["UpdateRecord", "Planning_Projet", 6]);
});

test("relecture pendant un enregistrement : la saisie reste affichée", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  await env.controller.refresh();
  assert.equal(env.taskLine(5).durationDays, 5, "pas de retour à l'ancienne valeur");
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.equal(env.taskLine(5).durationDays, 5);
});

test("ajout pendant un enregistrement : envoyé après lui", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  const adding = env.table.callbacks.onAddTask(Z2A);
  await flush();
  assert.equal(env.writes.length, 1);
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.equal(env.writes[1][0][0], "AddRecord");
  manual.calls[1].resolve({ retValues: [42] });
  await adding;
  assert.ok(env.taskLine(42));
});

test("une erreur affichée n'est pas effacée par un enregistrement réussi en arrière-plan", async () => {
  const manual = manualWrites();
  const env = setup({ rows: twoTaskRows(), applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(6, "duration", "3");
  manual.calls[0].reject(new Error("réseau"));
  await flush();
  manual.calls[1].resolve({ retValues: [null] });
  await flush();
  assert.match(env.table.statuses.at(-1).text, /échoué/);
});

test("écriture en attente : pas envoyée si le service a changé avant son tour", async () => {
  const manual = manualWrites();
  const env = setup({ rows: twoTaskRows(), applyUserActions: manual.applyUserActions });
  env.state.selectedService = "Synthese";
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(6, "duration", "3");
  env.state.selectedService = "Structure";
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.equal(env.writes.length, 1, "la seconde écriture n'est pas partie");
  assert.equal(env.taskLine(6).durationDays, 5, "sa saisie est retirée de l'affichage");
  assert.equal(env.table.statuses.at(-1).text, "Le projet ou le service a changé avant l'enregistrement : recommencez.");
});

test("enregistrement lent : « Enregistrement… » après une seconde, effacé à la fin", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  assert.deepEqual([...env.timers.pending.values()].map((entry) => entry.delay), [1000]);
  env.timers.runAll();
  assert.deepEqual(env.table.statuses.at(-1), { text: "Enregistrement…", tone: "saving" });
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.deepEqual(env.table.statuses.at(-1), { text: "", tone: "info" });
});

test("« Enregistrement… » ne remplace pas une erreur affichée", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(5, "start", "1999-01-01");
  env.timers.runAll();
  assert.match(env.table.statuses.at(-1).text, /entre 2000 et 2100/);
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.match(env.table.statuses.at(-1).text, /entre 2000 et 2100/);
});

test("suppression en attente : la tâche reste masquée même si une relecture la ramène", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  const deleting = env.table.callbacks.onDeleteTask(5);
  assert.equal(env.taskLine(5), undefined);
  await env.controller.refresh();
  assert.equal(env.taskLine(5), undefined, "la relecture ne la fait pas revenir");
  manual.calls[0].resolve({ retValues: [null] });
  await deleting;
  assert.equal(env.taskLine(5), undefined);
});

test("suppression refusée : la tâche revient telle que lue dans Grist", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  const deleting = env.table.callbacks.onDeleteTask(5);
  // Relecture pendant la suppression : la tâche a changé dans Grist (Fin repoussée au 30/10).
  env.context.rows = env.context.rows.map((row) => (
    row.id === 5 ? { ...row, Diff_armature: "2026-10-30", Duree_1: 16 } : row
  ));
  await env.controller.refresh();
  manual.calls[0].reject(new Error("réseau"));
  await deleting;
  assert.equal(env.taskLine(5).durationDays, 16, "la valeur relue, pas l'ancienne photo");
  assert.match(env.table.statuses.at(-1).text, /échoué/);
});

test("un ajout réussi en arrière-plan ne remplace pas une erreur affichée", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  const adding = env.table.callbacks.onAddTask(Z2A);
  manual.calls[0].reject(new Error("réseau"));
  await flush();
  manual.calls[1].resolve({ retValues: [42] });
  await adding;
  assert.ok(env.taskLine(42), "la tâche est bien ajoutée");
  assert.match(env.table.statuses.at(-1).text, /échoué/);
});

test("« Enregistrement… » reste affiché tant que la file n'est pas vide, même après une nouvelle saisie", async () => {
  const manual = manualWrites();
  const env = setup({ rows: twoTaskRows(), applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.timers.runAll();
  assert.deepEqual(env.table.statuses.at(-1), { text: "Enregistrement…", tone: "saving" });
  env.table.callbacks.onEdit(6, "duration", "3");
  assert.deepEqual(env.table.statuses.at(-1), { text: "Enregistrement…", tone: "saving" });
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.deepEqual(
    env.table.statuses.at(-1),
    { text: "Enregistrement…", tone: "saving" },
    "la seconde écriture est encore en route"
  );
  manual.calls[1].resolve({ retValues: [null] });
  await flush();
  assert.deepEqual(env.table.statuses.at(-1), { text: "", tone: "info" });
});

test("un ajout ou une suppression acceptés effacent une erreur précédente", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [null] }) });
  await activate(env, { editing: false });
  await env.table.callbacks.onDeleteTask(5);
  assert.match(env.table.statuses.at(-1).text, /Activez « Editer »/);
  env.controller.setEditingEnabled(true);
  await env.table.callbacks.onDeleteTask(5);
  assert.equal(env.table.statuses.at(-1).text, "Tâche « Visa MOE » supprimée.");
});

test("ajout en attente : pas envoyé si le projet a changé avant son tour", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  const adding = env.table.callbacks.onAddTask(Z2A);
  env.state.currentProject = { name: "VENTADOUR", names: ["VENTADOUR"] };
  manual.calls[0].resolve({ retValues: [null] });
  await adding;
  assert.equal(env.writes.length, 1, "l'ajout n'est pas parti");
  assert.equal(
    env.table.statuses.at(-1).text,
    "Le projet ou le service a changé avant l'enregistrement : recommencez."
  );
});

test("étages : tâches hors étage en haut, ligne d'étage, tâches rangées dessous ; colonne Etage présente", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  assert.deepEqual(env.lastRender().lines.map((line) => [line.key, line.level]), [
    [`zone:${Z2A}`, 0],
    ["task:6", 1],
    [`floor:${Z2A}/phrdb`, 1],
    ["task:5", 2],
  ]);
  assert.equal(env.lastRender().options.canAddFloor, true);
});

test("colonne Etage absente : pas d'étage, message", async () => {
  const env = setup();
  await activate(env);
  assert.equal(env.lastRender().options.canAddFloor, false);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.table.statuses.at(-1).text,
    "La colonne « Etage » n'existe pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages."
  );
});

test("renommer un étage : ligne-étage et Groupe des tâches en une écriture, affiché tout de suite", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onRenameFloor(Z2A, "phrdb", "PH R+1");
  assert.deepEqual(env.writes[0], [
    ["UpdateRecord", "Planning_Projet", 20, { Taches: "PH R+1" }],
    ["BulkUpdateRecord", "Planning_Projet", [5], { Groupe: ["PH R+1"] }],
  ]);
  assert.ok(env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/phrp1`));
  assert.equal(env.lastRender().lines.find((line) => line.taskId === 5).floorName, "PH R+1");
});

test("renommer un étage avec le nom d'un autre étage de la zone : refusé", async () => {
  const rows = [
    ...floorRows(),
    { id: 21, NomProjet: "HOTEL DIEU", Taches: "PH RDH", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: true },
  ];
  const env = setup({ rows });
  await activate(env);
  env.table.callbacks.onRenameFloor(Z2A, "phrdb", "ph rdh");
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.at(-1).text, "Un étage « PH RDH » existe déjà dans cette zone.");
});

test("supprimer un étage : confirmation avec le nombre de tâches, une écriture, masqué tout de suite", async () => {
  let question = "";
  const env = setup({ rows: floorRows(), confirm: (message) => { question = message; return true; } });
  await activate(env);
  await env.table.callbacks.onDeleteFloor(Z2A, "phrdb");
  assert.equal(question, "Supprimer l'étage « PH RDB » et sa tâche ?");
  assert.deepEqual(env.writes[0], [["BulkRemoveRecord", "Planning_Projet", [20, 5]]]);
  assert.equal(env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/phrdb` || line.taskId === 5), false);
});

test("déplacer une tâche dans un étage : Groupe écrit, rangée dessous tout de suite", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onMoveTask(6, {
    key: `floor:${Z2A}/phrdb`,
    zoneKey: Z2A,
    zoneName: "Zone Z2A",
    floorKey: "phrdb",
    floorName: "PH RDB",
    label: "Déplacer dans « PH RDB »",
  });
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 6, { Groupe: "PH RDB" }]]);
  const moved = env.lastRender().lines.find((line) => line.taskId === 6);
  assert.equal(moved.floorKey, "phrdb");
  assert.equal(moved.level, 2);
});

test("déplacer une tâche vers son conteneur actuel : rien", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onMoveTask(6, { key: `zone:${Z2A}`, zoneKey: Z2A, zoneName: "Zone Z2A", floorKey: "", floorName: "", label: "" });
  assert.equal(env.writes.length, 0);
});

test("ajouter une tâche dans un étage : Groupe rempli, dates d'après l'étage", async () => {
  const env = setup({ rows: floorRows(), applyUserActions: () => ({ retValues: [42] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(Z2A, "phrdb");
  assert.deepEqual(env.writes[0], [["AddRecord", "Planning_Projet", null, {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z2A",
    Groupe: "PH RDB",
  }]]);
  assert.equal(env.lastRender().lines.find((line) => line.taskId === 42).floorKey, "phrdb");
  assert.deepEqual(env.table.editing.at(-1), { taskId: 42, field: "name" });
});

test("replier un étage masque ses tâches", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onToggleFloor(Z2A, "phrdb");
  assert.equal(env.lastRender().lines.some((line) => line.taskId === 5), false);
  assert.equal(env.lastRender().lines.find((line) => line.key === `floor:${Z2A}/phrdb`).collapsed, true);
  env.table.callbacks.onToggleFloor(Z2A, "phrdb");
  assert.equal(env.lastRender().lines.some((line) => line.taskId === 5), true);
});

test("suppression d'étage refusée : l'étage et ses tâches reviennent, avec le message", async () => {
  const manual = manualWrites();
  const env = setup({ rows: floorRows(), applyUserActions: manual.applyUserActions });
  await activate(env);
  const deleting = env.table.callbacks.onDeleteFloor(Z2A, "phrdb");
  assert.equal(
    env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/phrdb`),
    false,
    "masqué en attendant Grist"
  );
  manual.calls[0].reject(new Error("réseau"));
  await deleting;
  assert.ok(env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/phrdb`));
  assert.ok(env.lastRender().lines.some((line) => line.taskId === 5));
  assert.match(env.table.statuses.at(-1).text, /échoué/);
});

test("déplacer une tâche d'étage vers une autre zone : Zone et Groupe écrits", async () => {
  const rows = [
    ...floorRows(),
    { id: 11, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: false },
  ];
  const env = setup({ rows });
  await activate(env);
  const z3a = zoneKeyOf("Zone Z3A");
  env.table.callbacks.onMoveTask(5, {
    key: `zone:${z3a}`,
    zoneKey: z3a,
    zoneName: "Zone Z3A",
    floorKey: "",
    floorName: "",
    label: "Déplacer au niveau de la zone « Zone Z3A »",
  });
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 5, { Zone: "Zone Z3A", Groupe: "" }]]);
  const moved = env.lastRender().lines.find((line) => line.taskId === 5);
  assert.equal(moved.zoneKey, z3a);
  assert.equal(moved.level, 1);
});

// ---------- Modèle d'étage : cycles, liens, cascade ----------

const isoOf = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);
const TEMPLATE_IDS = Array.from({ length: 26 }, (_, index) => 301 + index);

// Zone Z2A avec l'étage SS1 du modèle (ids 201 à 226), sans dates.
function ss1Rows() {
  return templateRows({ zoneName: "Zone Z2A" });
}

// Trois tâches liées de l'étage PH RDB : FOND DE PLAN (daté), DIFFUSION FDS (FD, jalon prévu),
// RECEPTION RENDU (FD, 10 jours prévus).
function linkedRows() {
  const base = { NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "PH RDB", Etage: false, Nature: "", Parent: "" };
  return [
    ...floorRows(),
    { ...base, id: 30, Taches: "FOND DE PLAN", Lien: "", Diff_coffrage: "2026-01-02", Diff_armature: "2026-01-05", Duree_1: 2 },
    { ...base, id: 31, Taches: "DIFFUSION FDS", Lien: "30 FD", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { ...base, id: 32, Taches: "RECEPTION RENDU", Lien: "31 FD", Diff_coffrage: null, Diff_armature: null, Duree_1: 10 },
  ];
}

test("ajouter un étage : les 26 lignes du modèle, puis Parent et Lien ; nom de l'étage en saisie", async () => {
  const env = setup({
    rows: floorRows(),
    applyUserActions: (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [TEMPLATE_IDS] } : { retValues: [] }),
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.equal(env.writes[0].length, 1);
  const [add] = env.writes[0];
  assert.equal(add[0], "BulkAddRecord");
  assert.deepEqual(add[2], new Array(26).fill(null));
  assert.equal(add[3].Taches[0], "Nouvel étage");
  assert.equal(add[3].Etage[0], true);
  assert.equal(add[3].Zone[0], "Zone Z2A");
  assert.equal(add[3].Taches[3], "FOND DE PLAN DE SYNTHESE NIV Nouvel étage");
  assert.equal(add[3].Groupe[3], "Nouvel étage");
  const [links] = env.writes[1];
  assert.equal(links[0], "BulkUpdateRecord");
  assert.equal(links[2].length, 21);
  const line = (key) => env.lastRender().lines.find((candidate) => candidate.key === key);
  assert.ok(line(`floor:${Z2A}/nouveletage`));
  assert.deepEqual([line("group:303").kind, line("group:303").level], ["group", 2]);
  assert.equal(line("task:304").level, 3);
  assert.deepEqual(env.table.editing.at(-1), { zoneKey: Z2A, floorKey: "nouveletage" });
});

test("création d'étage : si Parent et Lien ne s'écrivent pas, les lignes créées sont retirées", async () => {
  const env = setup({
    rows: floorRows(),
    applyUserActions: (actions) => {
      if (actions[0][0] === "BulkAddRecord") return { retValues: [TEMPLATE_IDS] };
      if (actions[0][0] === "BulkUpdateRecord") throw new Error("réseau");
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.deepEqual(env.writes[2], [["BulkRemoveRecord", "Planning_Projet", TEMPLATE_IDS]]);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez.",
    tone: "error",
  });
  assert.ok(!env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/nouveletage`));
});

// Review fix 1 : le projet change entre les deux temps de l'écriture de l'étage.
test("création d'étage : le projet change entre les deux écritures, le second temps n'est pas envoyé", async () => {
  let env;
  env = setup({
    rows: floorRows(),
    applyUserActions: (actions) => {
      if (actions[0][0] === "BulkAddRecord") {
        env.state.currentProject = { name: "AUTRE", names: ["AUTRE"] };
        return { retValues: [TEMPLATE_IDS] };
      }
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.ok(!env.writes.some((actions) => actions[0][0] === "BulkUpdateRecord"));
  assert.deepEqual(env.writes.at(-1), [["BulkRemoveRecord", "Planning_Projet", TEMPLATE_IDS]]);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Le projet ou le service a changé avant l'enregistrement : recommencez.",
    tone: "error",
  });
});

test("colonnes Nature, Parent et Lien absentes : « Ajouter un étage » grisé, message", async () => {
  const rows = floorRows().map(({ Nature, Parent, Lien, ...row }) => row);
  const env = setup({ rows });
  await activate(env);
  assert.equal(env.lastRender().options.canAddFloor, false);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.table.statuses.at(-1).text,
    "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des étages."
  );
});

test("cascade : changer la Fin d'une tâche date ses tâches liées, dans la même écriture", async () => {
  const env = setup({ rows: linkedRows() });
  await activate(env);
  env.table.callbacks.onEdit(30, "end", "2026-01-06");
  assert.deepEqual(env.writes[0], [
    ["UpdateRecord", "Planning_Projet", 30, { Diff_coffrage: "2026-01-02", Diff_armature: "2026-01-06", Duree_1: 3 }],
    ["BulkUpdateRecord", "Planning_Projet", [31, 32], {
      Diff_coffrage: ["2026-01-06", "2026-01-07"],
      Diff_armature: ["2026-01-06", "2026-01-20"],
      Duree_1: [0, 10],
    }],
  ]);
  assert.equal(isoOf(env.taskLine(32).start), "2026-01-07");
  assert.equal(env.taskLine(31).isMilestone, true);
});

// Review Focus 4 : une cascade refusée par Grist ne laisse rien à moitié.
test("cascade refusée par Grist : la tâche et ses tâches liées reviennent à l'état lu", async () => {
  const env = setup({ rows: linkedRows(), applyUserActions: () => { throw new Error("réseau"); } });
  await activate(env);
  env.table.callbacks.onEdit(30, "end", "2026-01-06");
  await flush();
  assert.equal(isoOf(env.taskLine(30).end), "2026-01-05");
  assert.equal(env.taskLine(31).start, null);
  assert.equal(env.taskLine(32).start, null);
  assert.equal(env.table.statuses.at(-1).tone, "error");
});

test("N° et Indice : écrits dans ID2 et Indice ; la tâche reste dans la vue", async () => {
  const env = setup({ rows: linkedRows().map((row) => ({ ...row, Service: "Synthese" })) });
  await activate(env);
  env.table.callbacks.onEdit(30, "id2", "1001");
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 30, { ID2: "1001" }]]);
  assert.equal(env.taskLine(30).id2, "1001");
  await flush();
  env.table.callbacks.onEdit(30, "indice", " A ");
  await flush();
  assert.deepEqual(env.writes[1], [["UpdateRecord", "Planning_Projet", 30, { Indice: "A" }]]);
  assert.equal(env.taskLine(30).indice, "A");
});

test("étage du modèle : cycles repliables et renommables", async () => {
  const env = setup({ rows: ss1Rows() });
  await activate(env);
  const keys = () => env.lastRender().lines.map((line) => line.key);
  assert.deepEqual(keys().slice(0, 5), [`zone:${Z2A}`, `floor:${Z2A}/ss1`, "task:202", "group:203", "task:204"]);
  env.table.callbacks.onToggleGroup(203);
  assert.ok(!keys().includes("task:204"));
  env.table.callbacks.onToggleGroup(203);
  assert.ok(keys().includes("task:204"));
  env.table.callbacks.onRenameGroup(203, " CYCLE 1 bis ");
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 203, { Taches: "CYCLE 1 bis" }]]);
  assert.equal(env.lastRender().lines.find((line) => line.key === "group:203").name, "CYCLE 1 bis");
  env.table.callbacks.onRenameGroup(203, "   ");
  assert.equal(env.table.statuses.at(-1).text, "Le nom ne peut pas être vide.");
});

test("supprimer un cycle : confirmation avec le nombre de tâches, tout son contenu en une écriture", async () => {
  const questions = [];
  const env = setup({ rows: ss1Rows(), confirm: (question) => { questions.push(question); return true; } });
  await activate(env);
  await env.table.callbacks.onDeleteGroup(210);
  assert.deepEqual(questions, ["Supprimer « CYCLE 2 » et ses 5 tâches ?"]);
  assert.equal(env.writes[0][0][0], "BulkRemoveRecord");
  assert.deepEqual([...env.writes[0][0][2]].sort((a, b) => a - b), [210, 211, 212, 213, 214, 215, 216]);
  assert.ok(!env.lastRender().lines.some((line) => line.key === "group:210" || line.key === "task:213"));
});

test("ajouter une tâche dans un sous-groupe : Parent écrit, sous-groupe et cycle dépliés", async () => {
  const env = setup({ rows: ss1Rows(), applyUserActions: () => ({ retValues: [400] }) });
  await activate(env);
  env.table.callbacks.onToggleGroup(210);
  await env.table.callbacks.onAddTask(Z2A, "ss1", 212);
  const [[verb, table, id, fields]] = env.writes[0];
  assert.deepEqual([verb, table, id], ["AddRecord", "Planning_Projet", null]);
  assert.deepEqual([fields.Parent, fields.Groupe, fields.Zone], ["212", "SS1", "Zone Z2A"]);
  const line = env.lastRender().lines.find((candidate) => candidate.key === "task:400");
  assert.deepEqual([line.groupRowId, line.level], [212, 4]);
  assert.deepEqual(env.table.editing.at(-1), { taskId: 400, field: "name" });
});

test("glisser une tâche dans un cycle : Parent écrit, rangée dedans tout de suite", async () => {
  const env = setup({ rows: ss1Rows() });
  await activate(env);
  env.table.callbacks.onMoveTask(202, {
    key: "group:203", zoneKey: Z2A, zoneName: "Zone Z2A", floorKey: "ss1", floorName: "SS1", groupRowId: 203,
  });
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 202, { Parent: "203" }]]);
  const line = env.lastRender().lines.find((candidate) => candidate.key === "task:202");
  assert.deepEqual([line.groupRowId, line.level], [203, 3]);
});

// Review Focus 3 : renommer l'étage juste après sa création.
test("renommer l'étage du modèle : noms NIV / GO et cycles suivent, en une écriture", async () => {
  const env = setup({ rows: ss1Rows() });
  await activate(env);
  env.table.callbacks.onRenameFloor(Z2A, "ss1", "SS2");
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].length, 3);
  const line = (key) => env.lastRender().lines.find((candidate) => candidate.key === key);
  assert.ok(line(`floor:${Z2A}/ss2`));
  assert.equal(line("task:204").name, "FOND DE PLAN DE SYNTHESE NIV SS2");
  assert.equal(line("group:203").floorKey, "ss2");
});

// ---------- Vague de correction finale : F1 à F3 ----------

// F1 : le contexte partagé relit Planning_Projet après le BulkAddRecord, avant que Parent et
// Lien soient écrits (main.js ne bloque pas sur ce second temps). Les 26 lignes se retrouvent
// alors déjà connues du contrôleur, sans Parent ni Lien.
test("F1 : une relecture pendant l'écriture ne laisse pas l'étage à plat", async () => {
  const templateFields = buildFloorFromTemplate({ floorName: "Nouvel étage", zoneName: "Zone Z2A", projectName: "HOTEL DIEU" });
  const preReadRows = templateFields.map((fields, index) => ({ id: TEMPLATE_IDS[index], ...fields }));
  let env;
  env = setup({
    rows: floorRows(),
    applyUserActions: async (actions) => {
      if (actions[0][0] === "BulkAddRecord") {
        // La relecture partagée arrive avant Parent/Lien : les lignes sont déjà dans `rows`.
        env.context.rows = [...env.context.rows, ...preReadRows];
        await env.controller.refresh();
        return { retValues: [TEMPLATE_IDS] };
      }
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  const line = (key) => env.lastRender().lines.find((candidate) => candidate.key === key);
  assert.equal(line("task:304").level, 3, "la tâche déjà relue est rattachée à son cycle, pas à plat");
  assert.deepEqual([line("group:303").kind, line("group:303").level], ["group", 2]);
});

// F2 : Grist réutilise les ids (max(id)+1) ; un étage supprimé puis recréé peut retomber sur
// les mêmes ids qu'un cycle replié avant la suppression. Le repli ne doit pas survivre.
test("F2 : un étage recréé avec les ids réutilisés garde ses cycles dépliés", async () => {
  const SS1_IDS = Array.from({ length: 26 }, (_, index) => 201 + index);
  const env = setup({
    rows: ss1Rows(),
    confirm: () => true,
    applyUserActions: (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [SS1_IDS] } : { retValues: [] }),
  });
  await activate(env);
  env.table.callbacks.onToggleGroup(203);
  assert.ok(!env.lastRender().lines.some((line) => line.taskId === 204), "CYCLE 1 replié avant la suppression");
  await env.table.callbacks.onDeleteFloor(Z2A, "ss1");
  await env.table.callbacks.onAddFloor(Z2A);
  const line = (key) => env.lastRender().lines.find((candidate) => candidate.key === key);
  assert.equal(line("group:203").collapsed, false, "le cycle recréé n'est plus replié");
  assert.ok(env.lastRender().lines.some((line) => line.taskId === 204), "sa tâche est visible");
});

// F3 : si le nettoyage du BulkAddRecord échoue aussi, l'utilisateur doit savoir que des lignes
// bancales restent dans Grist et lesquelles supprimer.
test("F3 : nettoyage refusé après un échec : message demandant de supprimer l'étage à la main", async () => {
  const env = setup({
    rows: floorRows(),
    applyUserActions: (actions) => {
      if (actions[0][0] === "BulkAddRecord") return { retValues: [TEMPLATE_IDS] };
      if (actions[0][0] === "BulkUpdateRecord") throw new Error("réseau");
      if (actions[0][0] === "BulkRemoveRecord") throw new Error("réseau");
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "L'étage n'a pas pu être créé complètement et ses lignes n'ont pas pu être retirées : supprimez l'étage « Nouvel étage » à la main.",
    tone: "error",
  });
});

// ---------- Lien Structure : coffrage d'un étage et date d'indice 0 ----------

const SS1 = { zoneKey: Z2A, floorKey: "ss1" };
const NOV_27 = new Date(2025, 10, 27); // jeudi
const NO_LINK_COLUMN = "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.";

// Zone Z2A, étage SS1 du modèle (ligne-étage 201, RECEPTION 202, FOND DE PLAN 204), colonne
// Lien_Structure présente. `dated` : durées de la capture, RECEPTION au 02/01/26.
function linkFloorRows({ dated = false, link = "" } = {}) {
  const rows = dated ? datedRows({ zoneName: "Zone Z2A" }) : templateRows({ zoneName: "Zone Z2A" });
  return rows.map((row) => ({ ...row, Lien_Structure: row.id === 201 ? link : "" }));
}

const linkOf = (env, rowId) => env.controller.getStructureLinkSource().rows.find((row) => row.id === rowId).Lien_Structure;

test("lien Structure : le N° sur la ligne-étage, la date sur RECEPTION, la suite en cascade — une seule écriture", async () => {
  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: " 3021 ", date: NOV_27 });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.writes.length, 1);
  const [link, anchor, cascade] = env.writes[0];
  assert.deepEqual(link, ["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3021"] }]);
  assert.deepEqual(anchor, ["UpdateRecord", "Planning_Projet", 202, {
    Diff_coffrage: "2025-11-27",
    Diff_armature: "2025-11-27",
    Duree_1: 0,
  }]);
  assert.equal(cascade[0], "BulkUpdateRecord");
  assert.deepEqual(cascade[2], [204, 205, 206, 207, 208, 209, 211, 213, 214, 215, 216, 218, 219, 221, 222, 223, 224, 225, 226]);
  assert.equal(cascade[3].Diff_coffrage[0], "2025-11-27", "FOND DE PLAN démarre le même jour");
  assert.equal(cascade[3].Diff_coffrage.at(-1), "2025-12-04", "DEMARRAGE GO : 5 jours ouvrés après le visa");
  assert.equal(isoOf(env.taskLine(204).start), "2025-11-27");
  assert.equal(linkOf(env, 201), "3021");
});

test("lien Structure : étage déjà daté, les tâches se décalent en gardant leur durée", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true }) });
  await activate(env);
  await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: NOV_27 });
  assert.equal(isoOf(env.taskLine(202).start), "2025-11-27");
  assert.deepEqual(
    [isoOf(env.taskLine(204).start), isoOf(env.taskLine(204).end), env.taskLine(204).durationDays],
    ["2025-11-27", "2025-11-28", 2]
  );
  assert.equal(isoOf(env.taskLine(206).start), "2025-12-01");
});

// Review Focus 3.
test("lien Structure : « Mettre à jour » recale un fond de plan retouché à la main, sans toucher au lien", async () => {
  const rows = linkFloorRows({ dated: true, link: "3021" })
    .map((row) => (row.id === 204 ? { ...row, Diff_coffrage: "2026-01-06", Diff_armature: "2026-01-07" } : row));
  const env = setup({ rows });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, date: new Date(2026, 0, 2) });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(env.writes, [[
    ["BulkUpdateRecord", "Planning_Projet", [204], {
      Diff_coffrage: ["2026-01-02"],
      Diff_armature: ["2026-01-05"],
      Duree_1: [2],
    }],
  ]]);
});

test("lien Structure : délier vide la colonne et laisse les dates", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true, link: "3021" }) });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "" });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(env.writes, [[["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: [""] }]]]);
  assert.equal(isoOf(env.taskLine(202).start), "2026-01-02");
});

test("lien Structure : un autre coffrage remplace le premier", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true, link: "3021" }) });
  await activate(env);
  await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3031", date: NOV_27 });
  assert.deepEqual(env.writes[0][0], ["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3031"] }]);
  assert.equal(linkOf(env, 201), "3031");
  assert.equal(isoOf(env.taskLine(204).start), "2025-11-27");
});

test("lien Structure : rien ne change, rien n'est écrit", async () => {
  const env = setup({ rows: linkFloorRows({ dated: true, link: "3021" }) });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: new Date(2026, 0, 2) });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.writes.length, 0);
});

// Review Focus 1.
test("lien Structure : une zone filtrée dans le bandeau n'empêche pas d'écrire ailleurs", async () => {
  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  env.controller.setZoneFilter("Zone Autre");
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: NOV_27 });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].length, 3);
});

test("lien Structure : refus sans écriture", async () => {
  const locked = setup({ rows: linkFloorRows() });
  await activate(locked, { editing: false });
  const lockedResult = await locked.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" });
  assert.equal(lockedResult.ok, false);
  assert.match(lockedResult.error, /Activez « Editer »/);

  const readOnly = setup({ rows: linkFloorRows(), accessMode: "readonly" });
  await activate(readOnly);
  assert.match((await readOnly.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" })).error, /lecture seule/);

  const noColumn = setup({ rows: templateRows({ zoneName: "Zone Z2A" }) });
  await activate(noColumn);
  assert.deepEqual(
    await noColumn.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" }),
    { ok: false, error: NO_LINK_COLUMN }
  );

  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  assert.deepEqual(
    await env.controller.applyStructureLink({ zoneKey: Z2A, floorKey: "inconnu", formworkNumber: "3021" }),
    { ok: false, error: "Cet étage n'existe plus : fermez la fenêtre puis rouvrez-la." }
  );

  // Étage connu par le Groupe de ses tâches, sans ligne-étage.
  const loose = setup({ rows: floorRows().filter((row) => row.id !== 20).map((row) => ({ ...row, Lien_Structure: "" })) });
  await activate(loose);
  assert.deepEqual(
    await loose.controller.applyStructureLink({ zoneKey: Z2A, floorKey: "phrdb", formworkNumber: "3001" }),
    { ok: false, error: "Cet étage n'a pas de ligne « étage » dans Planning_Projet : le lien ne peut pas être mémorisé." }
  );

  // Étage sans tâche « FOND DE PLAN DE SYNTHESE ».
  const noPlan = setup({ rows: floorRows().map((row) => ({ ...row, Lien_Structure: "" })) });
  await activate(noPlan);
  assert.deepEqual(
    await noPlan.controller.applyStructureLink({ zoneKey: Z2A, floorKey: "phrdb", date: NOV_27 }),
    { ok: false, error: "Cet étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE » : aucune date ne peut être posée." }
  );

  [locked, readOnly, noColumn, env, loose, noPlan].forEach((each) => assert.equal(each.writes.length, 0));
});

// Review Focus 4.
test("lien Structure : écriture refusée par Grist — l'affichage revient et l'erreur est rendue", async () => {
  const env = setup({ rows: linkFloorRows(), applyUserActions: () => { throw new Error("réseau"); } });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: NOV_27 });
  assert.deepEqual(result, { ok: false, error: "L'enregistrement dans Grist a échoué. Réessayez." });
  assert.equal(linkOf(env, 201), "");
  assert.equal(env.taskLine(202).start, null);
  assert.equal(env.taskLine(204).start, null);
  assert.equal(env.table.statuses.at(-1).tone, "error");
});

// Review Focus 4 : colonne absente du document (production) alors que rien ne le laissait voir.
test("lien Structure : Grist ne connaît pas la colonne — message précis, colonne notée absente", async () => {
  const env = setup({
    rows: linkFloorRows(),
    applyUserActions: () => { throw new Error("Invalid column 'Lien_Structure'"); },
  });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" });
  assert.deepEqual(result, { ok: false, error: NO_LINK_COLUMN });
  assert.equal(env.controller.getStructureLinkSource().linkColumn, false);
});

test("source de la fenêtre : lignes affichées (écriture en attente comprise), droits, colonne", async () => {
  const pending = manualWrites();
  const env = setup({ rows: linkFloorRows(), applyUserActions: pending.applyUserActions });
  assert.equal(env.controller.getStructureLinkSource().ready, false, "rien n'est chargé avant l'activation");
  await activate(env);
  const before = env.controller.getStructureLinkSource();
  assert.deepEqual([before.ready, before.editable, before.lockedMessage, before.linkColumn], [true, true, "", true]);
  const writing = env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021" });
  assert.equal(linkOf(env, 201), "3021", "visible avant la réponse de Grist");
  pending.calls[0].resolve({ retValues: [] });
  assert.deepEqual(await writing, { ok: true });
  env.controller.setEditingEnabled(false);
  const locked = env.controller.getStructureLinkSource();
  assert.equal(locked.editable, false);
  assert.match(locked.lockedMessage, /Activez « Editer »/);
});

test("source de la fenêtre : colonne Lien_Structure absente des lignes lues", async () => {
  const env = setup({ rows: templateRows({ zoneName: "Zone Z2A" }) });
  await activate(env);
  assert.equal(env.controller.getStructureLinkSource().linkColumn, false);
});

test("lien Structure : date d'indice 0 inutilisable — refus qui la nomme, rien n'est écrit", async () => {
  const env = setup({ rows: linkFloorRows() });
  await activate(env);
  const result = await env.controller.applyStructureLink({ ...SS1, formworkNumber: "3021", date: new Date(1925, 10, 27) });
  assert.deepEqual(result, {
    ok: false,
    error: "La date de diffusion à l'indice 0 de ce coffrage n'est pas utilisable (elle doit être entre 2000 et 2100) : corrigez-la dans la liste de plans.",
  });
  assert.equal(env.writes.length, 0);
  assert.equal(linkOf(env, 201), "");
});
