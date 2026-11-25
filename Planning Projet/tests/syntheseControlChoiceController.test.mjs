// Contrôleur du tableau Synthese : la tâche contrôlée par rapport au coffrage changée dans tous les
// étages du projet (onglet « Tâche contrôlée » de la fenêtre « Paramètre ») — ce que l'onglet lit,
// l'écriture unique, les droits, la colonne absente, les échecs.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";

const Z1 = "Zone 1";
const Z2 = "Zone 2";
const RESA = "PLAN DE SYNTHESE RESERVATIONS NIV";
const TERM = "PLAN DE SYNTHESE TERMINAUX NIV";
const LOCKED = "Activez « Editer » dans le bandeau pour modifier les tâches.";
const NO_COLUMN = "La colonne « Controle_Coffrage » (Booléen) manque dans Planning_Projet : ajoutez-la pour choisir la tâche contrôlée par rapport au coffrage.";

function row(id, fields = {}) {
  return {
    id, NomProjet: "HOTEL DIEU", Service: "Synthese", Taches: "", Type_doc: "", ID2: "", Zone: Z1, Groupe: "",
    Etage: false, Nature: "", Parent: "", Lien: "", Lien_Structure: "", Controle_Coffrage: false,
    Diff_coffrage: null, Diff_armature: null, Duree_1: 0, ...fields,
  };
}

const floor = (id, name, zone = Z1) => row(id, { Taches: name, Etage: true, Zone: zone });
const cycle = (id, floorName, name, zone = Z1) => row(id, { Groupe: floorName, Taches: name, Nature: "Cycle", Zone: zone });
const task = (id, floorName, name, parent, fields = {}) => row(id, { Groupe: floorName, Taches: name, Parent: String(parent), ...fields });

// Zone 1 : R+1 (trois cycles) et R+2 (un cycle 4 en plus). Zone 2 : R+1, terminaux cochés à la main.
function projectRows() {
  return [
    floor(100, "R+1"),
    cycle(110, "R+1", "CYCLE 3"),
    task(111, "R+1", `${RESA} R+1`, 110),
    task(112, "R+1", `${TERM} R+1`, 110),
    floor(200, "R+2"),
    cycle(210, "R+2", "CYCLE 3"),
    task(211, "R+2", `${RESA} R+2`, 210),
    task(212, "R+2", `${TERM} R+2`, 210),
    cycle(220, "R+2", "CYCLE 4"),
    task(221, "R+2", `${RESA} R+2`, 220),
    floor(300, "R+1", Z2),
    cycle(310, "R+1", "CYCLE 3", Z2),
    task(311, "R+1", `${RESA} R+1`, 310, { Zone: Z2 }),
    task(312, "R+1", `${TERM} R+1`, 310, { Zone: Z2, Controle_Coffrage: true }),
  ];
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ rows = projectRows(), applyUserActions = null } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode: "editable" };
  const writes = [];
  const table = { statuses: [], renders: [] };
  const controller = createSyntheseTasksController({
    context: {
      async fetchContextRows() {
        return rows.map((source) => ({ ...source }));
      },
      getState: () => ({ ...state, currentProject: { ...state.currentProject } }),
      subscribe() { return () => {}; },
      watchProjectZones() { return () => {}; },
    },
    docApi: {
      async applyUserActions(actions) {
        writes.push(actions);
        return applyUserActions ? applyUserActions(actions) : { retValues: [] };
      },
    },
    createTable() {
      return {
        render: (lines) => table.renders.push(lines),
        setStatus: (text, tone) => table.statuses.push({ text, tone }),
        startEditing: () => {},
        startEditingFloor: () => {},
        startEditingGroup: () => {},
        startEditingStorey: () => {},
      };
    },
    confirm: () => true,
    now: () => new Date(2026, 10, 25),
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    createFloorDialog: () => ({ open: () => {}, close: () => {} }),
    createLinkDialog: () => ({ open: () => {}, close: () => {} }),
  });
  return { state, writes, table, controller };
}

async function activate(env, { editing = true } = {}) {
  env.controller.setEditingEnabled(editing);
  env.controller.setActive(true);
  await flush();
}

const choiceOf = (source, name, cycleName) => source.choices.find((choice) => (
  choice.name === name && choice.path.join(" > ") === cycleName
));

test("source de l'onglet : les tâches de tous les étages du projet, même sous un filtre de zone", async () => {
  const env = setup();
  await activate(env);
  env.controller.setZoneFilter(Z2);
  const source = env.controller.getControlTaskSource();
  assert.equal(source.ready, true);
  assert.equal(source.blockedMessage, "");
  assert.equal(source.floorCount, 3);
  assert.deepEqual(source.choices.map((choice) => [choice.path.join(" > "), choice.name]), [
    ["CYCLE 3", `${RESA} {E}`],
    ["CYCLE 3", `${TERM} {E}`],
    ["CYCLE 4", `${RESA} {E}`],
  ]);
  assert.deepEqual(choiceOf(source, `${RESA} {E}`, "CYCLE 4").missing, ["R+1 (Zone 1)", "R+1 (Zone 2)"]);
});

test("appliquer : une seule écriture, les étages sans la tâche ne changent pas et sont rendus", async () => {
  const env = setup();
  await activate(env);
  const { key } = choiceOf(env.controller.getControlTaskSource(), `${RESA} {E}`, "CYCLE 4");
  const outcome = await env.controller.applyControlTask({ key });
  assert.deepEqual(outcome, {
    ok: true,
    change: ["R+2 (Zone 1)"],
    current: [],
    missing: ["R+1 (Zone 1)", "R+1 (Zone 2)"],
  });
  assert.deepEqual(env.writes, [[["BulkUpdateRecord", "Planning_Projet", [221], { Controle_Coffrage: [true] }]]]);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Tâche contrôlée par rapport au coffrage changée dans 1 étage.",
    tone: "info",
  });
  // Le tableau le montre tout de suite : la tâche du cycle 4 est contrôlée, par choix.
  const line = env.table.renders.at(-1).find((entry) => entry.taskId === 221);
  assert.equal(line.isControlTask, true);
  assert.equal(line.isChosenControlTask, true);
  // Relu : elle est en place dans R+2, toujours absente ailleurs.
  const after = choiceOf(env.controller.getControlTaskSource(), `${RESA} {E}`, "CYCLE 4");
  assert.deepEqual(after.current, ["R+2 (Zone 1)"]);
  assert.deepEqual(after.change, []);
});

test("appliquer : dans un étage où une autre tâche était cochée, elle est décochée dans la même écriture", async () => {
  const env = setup();
  await activate(env);
  const { key } = choiceOf(env.controller.getControlTaskSource(), `${RESA} {E}`, "CYCLE 3");
  const outcome = await env.controller.applyControlTask({ key });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.change, ["R+1 (Zone 2)"]);
  assert.deepEqual(outcome.current, ["R+1 (Zone 1)", "R+2 (Zone 1)"]);
  assert.deepEqual(env.writes, [[["BulkUpdateRecord", "Planning_Projet", [311, 312], { Controle_Coffrage: [true, false] }]]]);
});

test("rien à changer : aucune écriture", async () => {
  const env = setup();
  await activate(env);
  const { key } = choiceOf(env.controller.getControlTaskSource(), `${RESA} {E}`, "CYCLE 3");
  await env.controller.applyControlTask({ key });
  const again = await env.controller.applyControlTask({ key });
  assert.equal(again.ok, true);
  assert.deepEqual(again.change, []);
  assert.equal(again.current.length, 3);
  assert.equal(env.writes.length, 1);
});

test("tableau verrouillé : refus, aucune écriture", async () => {
  const env = setup();
  await activate(env, { editing: false });
  const source = env.controller.getControlTaskSource();
  assert.equal(source.blockedMessage, LOCKED);
  assert.equal(source.choices.length, 3, "les tâches restent lisibles");
  const outcome = await env.controller.applyControlTask({ key: source.choices[0].key });
  assert.deepEqual(outcome, { ok: false, error: LOCKED });
  assert.equal(env.writes.length, 0);
});

test("colonne Controle_Coffrage absente : dit avant d'écrire", async () => {
  const rows = projectRows().map((source) => {
    const { Controle_Coffrage, ...rest } = source;
    return rest;
  });
  const env = setup({ rows });
  await activate(env);
  const source = env.controller.getControlTaskSource();
  assert.equal(source.blockedMessage, NO_COLUMN);
  const outcome = await env.controller.applyControlTask({ key: source.choices[0].key });
  assert.deepEqual(outcome, { ok: false, error: NO_COLUMN });
  assert.equal(env.writes.length, 0);
});

test("tâche disparue, étages pas encore lus : refus", async () => {
  const env = setup();
  // « Editer » actif mais vue pas encore ouverte : rien n'a été lu.
  env.controller.setEditingEnabled(true);
  assert.equal(env.controller.getControlTaskSource().ready, false);
  const early = await env.controller.applyControlTask({ key: "x" });
  assert.deepEqual(early, {
    ok: false,
    error: "Les étages ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.",
  });
  await activate(env);
  const gone = await env.controller.applyControlTask({ key: "pas une clé" });
  assert.deepEqual(gone, {
    ok: false,
    error: "Cette tâche n'existe plus dans les étages du projet : choisissez-en une autre.",
  });
  assert.equal(env.writes.length, 0);
});

test("écriture refusée par Grist : l'affichage revient, l'erreur est rendue", async () => {
  const env = setup({
    applyUserActions: async () => {
      throw new Error("réseau coupé");
    },
  });
  await activate(env);
  const { key } = choiceOf(env.controller.getControlTaskSource(), `${TERM} {E}`, "CYCLE 3");
  const outcome = await env.controller.applyControlTask({ key });
  assert.deepEqual(outcome, { ok: false, error: "L'enregistrement dans Grist a échoué. Réessayez." });
  const after = choiceOf(env.controller.getControlTaskSource(), `${TERM} {E}`, "CYCLE 3");
  assert.deepEqual(after.change, ["R+1 (Zone 1)", "R+2 (Zone 1)"], "rien n'a changé");
});
