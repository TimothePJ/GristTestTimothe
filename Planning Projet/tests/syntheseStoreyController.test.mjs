// Contrôleur du tableau Synthese en affichage par étage : mode et replis, numéros de ligne (tableau
// et fenêtre de lien), renommage, suppression et ajout de zone sur la ligne étage, ajout d'un étage,
// refus pendant un filtre de zone ; le mode par zone ne change pas.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { resolveDropTarget, zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";

const TODAY = new Date(2026, 8, 23);
const Z1 = "Zone 1 / BAT BC";
const Z2 = "Zone 2 / BAT B";
const Z1K = zoneKeyOf(Z1);
const Z2K = zoneKeyOf(Z2);
const TEMPLATE_IDS = Array.from({ length: 26 }, (_, index) => 301 + index);

function row(id, fields = {}) {
  return {
    id, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "", Groupe: "", Etage: false,
    Nature: "", Parent: "", Lien: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0, ...fields,
  };
}

const floorRow = (id, name, zone) => row(id, { Taches: name, Zone: zone, Etage: true });
const task = (id, name, zone, group, start, end, fields = {}) => row(id, {
  Taches: name, Zone: zone, Groupe: group, Diff_coffrage: start, Diff_armature: end, Duree_1: 2, ...fields,
});

// Deux zones avec « SS1 », la Zone 1 avec « R+1 » ; Plans R+1 suit Plans SS1 Z1, Plans SS1 Z2
// suit Plans R+1.
function storeyRows() {
  return [
    floorRow(20, "SS1", Z1),
    floorRow(21, "R+1", Z1),
    floorRow(22, "SS1", Z2),
    task(1, "Plans SS1 Z1", Z1, "SS1", "2026-01-05", "2026-01-06"),
    task(2, "Plans R+1 Z1", Z1, "R+1", "2026-03-02", "2026-03-03", { Lien: "1 FD" }),
    task(3, "Plans SS1 Z2", Z2, "SS1", "2026-02-02", "2026-02-03", { Lien: "2 FD" }),
  ];
}

function withoutColumns(rows, columns) {
  return rows.map((source) => {
    const copy = { ...source };
    columns.forEach((column) => delete copy[column]);
    return copy;
  });
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup({ rows = storeyRows(), applyUserActions = null, confirm = () => true } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode: "editable" };
  const listeners = { context: [] };
  const context = {
    async fetchContextRows() {
      return rows.map((source) => ({ ...source }));
    },
    getState: () => ({ ...state, currentProject: state.currentProject ? { ...state.currentProject } : null }),
    subscribe(listener) { listeners.context.push(listener); return () => {}; },
    watchProjectZones() { return () => {}; },
  };
  const writes = [];
  const docApi = {
    async applyUserActions(actions) {
      writes.push(actions);
      return applyUserActions ? applyUserActions(actions) : { retValues: [] };
    },
  };
  const questions = [];
  const table = { renders: [], statuses: [], editing: [], editingStoreys: [], callbacks: null };
  // Fenêtre de lien doublée : ce qu'on lui montre, et combien de fois on la ferme.
  const linkDialog = { opens: [], closes: 0 };
  // Fenêtre « Ajouter un étage » doublée : modèles montrés, fermetures, rappel d'envoi.
  const floorDialog = { opens: [], closes: 0, onSubmit: null };
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
        startEditingGroup: (groupRowId) => table.editing.push({ groupRowId }),
        startEditingStorey: (floorKey) => table.editingStoreys.push(floorKey),
      };
    },
    confirm: (question) => {
      questions.push(question);
      return confirm(question);
    },
    now: () => TODAY,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    createFloorDialog({ onSubmit }) {
      floorDialog.onSubmit = onSubmit;
      return {
        open: (model) => floorDialog.opens.push(model),
        close: () => {
          floorDialog.closes += 1;
        },
      };
    },
    createLinkDialog() {
      return {
        open: (model) => linkDialog.opens.push(model),
        close: () => {
          linkDialog.closes += 1;
        },
      };
    },
  });
  const lastRender = () => table.renders.at(-1);
  const keys = () => lastRender().lines.map((line) => line.key);
  const line = (key) => lastRender().lines.find((candidate) => candidate.key === key);
  return { state, listeners, writes, questions, table, controller, linkDialog, floorDialog, lastRender, keys, line };
}

async function activate(env, { layout = "floor" } = {}) {
  env.controller.setEditingEnabled(true);
  env.controller.setActive(true);
  await flush();
  if (layout) env.controller.setLayout(layout);
}

// Ids touchés par une écriture (UpdateRecord, BulkUpdateRecord, BulkRemoveRecord…).
function touchedIds(actions) {
  return actions.flatMap((action) => (Array.isArray(action[2]) ? action[2] : [action[2]]));
}

const FLOOR_KEYS = [
  "storey:ss1", `floor:${Z1K}/ss1`, "task:1", `floor:${Z2K}/ss1`, "task:3",
  "storey:rp1", `floor:${Z1K}/rp1`, "task:2",
  "storey:", `zone:${Z1K}`, `zone:${Z2K}`,
];

test("mode étage : lignes et numéros de ligne du mode étage, Lien compris", async () => {
  const env = setup();
  await activate(env);
  assert.deepEqual(env.keys(), FLOOR_KEYS);
  assert.equal(env.lastRender().lines[0].key, "storey:ss1");
  assert.equal(env.line(`floor:${Z1K}/ss1`).lineNumber, 2);
  // Plans SS1 Z2 suit Plans R+1, ligne 8 en mode étage (5 en mode zone).
  assert.equal(env.line("task:3").linkText, "8FD");
  assert.equal(env.line("task:2").linkText, "3FD");
  assert.equal(env.lastRender().options.zoneFiltered, false);
});

test("mode étage : la fenêtre « Modifier le lien… » reçoit les numéros du mode étage", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(3);
  assert.equal(env.linkDialog.opens.length, 1);
  const tasks = env.linkDialog.opens[0].rows.filter((choice) => choice.kind === "task");
  assert.deepEqual(tasks.map((choice) => [choice.taskId, choice.lineNumber]), [[3, 5], [2, 8]]);
});

test("mode zone (sans setLayout) : lignes et numéros inchangés", async () => {
  const env = setup();
  await activate(env, { layout: null });
  assert.equal(env.keys()[0], `zone:${Z1K}`);
  assert.equal(env.line("task:3").linkText, "5FD");
  env.table.callbacks.onEditLink(3);
  const tasks = env.linkDialog.opens[0].rows.filter((choice) => choice.kind === "task");
  assert.deepEqual(tasks.map((choice) => [choice.taskId, choice.lineNumber]), [[3, 8], [2, 5]]);
});

test("setLayout : tous les replis remis à zéro ; même valeur : aucun rendu ; autre valeur : par zone", async () => {
  const env = setup();
  await activate(env, { layout: null });
  env.table.callbacks.onToggleZone(Z1K);
  env.table.callbacks.onToggleFloor(Z2K, "ss1");
  assert.equal(env.line(`zone:${Z1K}`).collapsed, true);
  env.controller.setLayout("floor");
  assert.deepEqual(env.keys(), FLOOR_KEYS);
  assert.ok(env.lastRender().lines.every((line) => !line.collapsed));
  const renders = env.table.renders.length;
  env.controller.setLayout("floor");
  assert.equal(env.table.renders.length, renders, "aucun nouveau rendu forcé");
  env.controller.setLayout("n'importe quoi");
  assert.equal(env.keys()[0], `zone:${Z1K}`);
});

// § 5.5 : la fenêtre montrait les numéros de ligne de l'ancien mode.
test("setLayout : la fenêtre « Modifier le lien… » ouverte se ferme au changement de mode, pas sinon", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onEditLink(3);
  assert.equal(env.linkDialog.opens.length, 1);
  assert.equal(env.linkDialog.closes, 0);
  env.controller.setLayout("floor");
  assert.equal(env.linkDialog.closes, 0, "même mode : la fenêtre reste ouverte");
  env.controller.setLayout("zone");
  assert.equal(env.linkDialog.closes, 1, "mode changé : la fenêtre se ferme");
});

test("setLayout : un repli d'étage est remis à zéro au changement de mode", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  env.controller.setLayout("zone");
  env.controller.setLayout("floor");
  assert.equal(env.line("storey:ss1").collapsed, false);
});

test("replier une ligne étage cache ses zones ; le changement de projet remet le repli à zéro", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  assert.equal(env.line("storey:ss1").collapsed, true);
  assert.ok(!env.keys().includes(`floor:${Z1K}/ss1`));
  env.table.callbacks.onToggleStorey("ss1");
  assert.ok(env.keys().includes(`floor:${Z1K}/ss1`));
  env.table.callbacks.onToggleStorey("ss1");
  env.state.currentProject = { name: "AUTRE", names: ["AUTRE"] };
  env.listeners.context.forEach((listener) => listener());
  await flush();
  env.state.currentProject = { name: "HOTEL DIEU", names: ["HOTEL DIEU"] };
  env.listeners.context.forEach((listener) => listener());
  await flush();
  assert.equal(env.line("storey:ss1").collapsed, false);
});

test("renommer l'étage : une seule écriture pour les deux zones, replis suivis, message", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  env.table.callbacks.onRenameStorey("ss1", "SS2");
  await flush();
  assert.equal(env.writes.length, 1);
  const touched = touchedIds(env.writes[0]);
  [20, 22, 1, 3].forEach((id) => assert.ok(touched.includes(id), `ligne ${id} renommée`));
  [21, 2].forEach((id) => assert.ok(!touched.includes(id), `ligne ${id} non touchée`));
  assert.equal(env.line("storey:ss2").name, "SS2");
  assert.equal(env.line("storey:ss2").collapsed, true, "le repli suit le nouveau nom");
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage renommé dans 2 zones.", tone: "info" });
});

test("renommer l'étage d'une seule zone : message au singulier", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onRenameStorey("rp1", "R+2");
  await flush();
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage renommé dans 1 zone.", tone: "info" });
});

test("renommer l'étage vers un nom pris dans une de ses zones : refus nommant la zone, aucune écriture", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onRenameStorey("ss1", "R+1");
  await flush();
  assert.equal(env.writes.length, 0);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Dans « Zone 1 / BAT BC » : Un étage « R+1 » existe déjà dans cette zone.",
    tone: "error",
  });
});

test("renommer l'étage sans « Editer » : refus, aucune écriture", async () => {
  const env = setup();
  await activate(env);
  env.controller.setEditingEnabled(false);
  env.table.callbacks.onRenameStorey("ss1", "SS2");
  await flush();
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /Activez « Editer »/);
});

test("supprimer l'étage : question, une écriture pour les deux zones, liens orphelins effacés, message", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onDeleteStorey("ss1");
  assert.deepEqual(env.questions, ["Supprimer l'étage « SS1 » dans 2 zones et ses 2 tâches ?"]);
  assert.equal(env.writes.length, 1);
  const [remove, ...updates] = env.writes[0];
  assert.equal(remove[0], "BulkRemoveRecord");
  assert.deepEqual([...remove[2]].sort((a, b) => a - b), [1, 3, 20, 22]);
  // Plans R+1 suivait Plans SS1 Z1, supprimée : son lien est effacé dans la même écriture.
  assert.deepEqual(updates, [["UpdateRecord", "Planning_Projet", 2, { Lien: "" }]]);
  assert.ok(!env.keys().includes("storey:ss1"));
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage « SS1 » supprimé dans 2 zones.", tone: "info" });
});

test("supprimer l'étage : refus de la confirmation, rien n'est écrit", async () => {
  const env = setup({ confirm: () => false });
  await activate(env);
  await env.table.callbacks.onDeleteStorey("ss1");
  assert.equal(env.writes.length, 0);
});

test("filtre de zone actif : supprimer l'étage et ajouter une zone refusés, rendu « zoneFiltered »", async () => {
  const env = setup();
  await activate(env);
  env.controller.setZoneFilter(Z1);
  assert.equal(env.lastRender().options.zoneFiltered, true);
  await env.table.callbacks.onDeleteStorey("ss1");
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Retirez le filtre de zone pour supprimer l'étage dans toutes ses zones.",
    tone: "error",
  });
  await env.table.callbacks.onAddZoneToFloor("rp1", Z2K);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Retirez le filtre de zone pour ajouter une zone à cet étage.",
    tone: "error",
  });
  await env.table.callbacks.onAddZoneToFloor("rp1", "");
  assert.equal(env.table.statuses.at(-1).text, "Retirez le filtre de zone pour ajouter une zone à cet étage.");
  await flush();
  assert.equal(env.writes.length, 0);
  assert.equal(env.questions.length, 0);
});

test("ajouter une zone à l'étage : modèle de 26 lignes dans la zone choisie, puis Parent et Lien ; dépliés, message", async () => {
  const env = setup({
    applyUserActions: (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [TEMPLATE_IDS] } : { retValues: [] }),
  });
  await activate(env);
  env.table.callbacks.onToggleStorey("rp1");
  await env.table.callbacks.onAddZoneToFloor("rp1", Z2K);
  assert.equal(env.writes.length, 2);
  const [add] = env.writes[0];
  assert.equal(add[0], "BulkAddRecord");
  assert.equal(add[2].length, 26);
  assert.equal(add[3].Zone[0], Z2);
  assert.equal(add[3].Taches[0], "R+1");
  assert.equal(add[3].Etage[0], true);
  assert.equal(add[3].Groupe[3], "R+1");
  assert.equal(env.writes[1][0][0], "BulkUpdateRecord");
  assert.equal(env.line("storey:rp1").collapsed, false);
  assert.equal(env.line(`floor:${Z2K}/rp1`).collapsed, false);
  assert.ok(env.keys().includes("group:303"), "le contenu du nouvel étage est visible");
  assert.deepEqual(env.table.editing, [], "pas de saisie ouverte");
  assert.deepEqual(env.table.editingStoreys, []);
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage « R+1 » ajouté dans « Zone 2 / BAT B ».", tone: "info" });
});

test("ajouter une zone à l'étage : toutes les zones l'ont déjà, ou la zone l'a déjà", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onAddZoneToFloor("ss1", "");
  assert.deepEqual(env.table.statuses.at(-1), { text: "Toutes les zones du projet ont déjà cet étage.", tone: "error" });
  const statuses = env.table.statuses.length;
  await env.table.callbacks.onAddZoneToFloor("ss1", Z2K);
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.length, statuses, "rien ne se passe");
});

test("ajouter une zone à l'étage : colonnes du modèle absentes, même message qu'« Ajouter un étage »", async () => {
  const env = setup({ rows: withoutColumns(storeyRows(), ["Nature", "Parent", "Lien"]) });
  await activate(env);
  await env.table.callbacks.onAddZoneToFloor("rp1", Z2K);
  assert.equal(env.writes.length, 0);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des étages.",
    tone: "error",
  });
  const noFloor = setup({ rows: withoutColumns(storeyRows(), ["Etage"]) });
  await activate(noFloor);
  await noFloor.table.callbacks.onAddZoneToFloor("rp1", Z2K);
  assert.equal(noFloor.writes.length, 0);
  assert.equal(
    noFloor.table.statuses.at(-1).text,
    "La colonne « Etage » n'existe pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages."
  );
});

test("ajouter un étage en mode étage : nom libre dans tout le projet, saisie sur la ligne étage", async () => {
  const env = setup({
    rows: [...storeyRows(), floorRow(23, "Nouvel étage", Z1)],
    applyUserActions: (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [TEMPLATE_IDS] } : { retValues: [] }),
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2K);
  const [add] = env.writes[0];
  assert.equal(add[3].Taches[0], "Nouvel étage 2");
  assert.equal(add[3].Zone[0], Z2);
  assert.deepEqual(env.table.editingStoreys, ["nouveletage2"]);
  assert.deepEqual(env.table.editing, [], "pas de saisie sur l'étage de zone");
  assert.equal(env.line("storey:nouveletage2").collapsed, false);
  assert.ok(env.keys().includes(`floor:${Z2K}/nouveletage2`));
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage ajouté dans « Zone 2 / BAT B ».", tone: "info" });
});

test("mode zone : « Ajouter un étage » garde le nom libre dans la zone et la saisie sur l'étage", async () => {
  const env = setup({
    rows: [...storeyRows(), floorRow(23, "Nouvel étage", Z1)],
    applyUserActions: (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [TEMPLATE_IDS] } : { retValues: [] }),
  });
  await activate(env, { layout: null });
  await env.table.callbacks.onAddFloor(Z2K);
  assert.equal(env.writes[0][0][3].Taches[0], "Nouvel étage");
  assert.deepEqual(env.table.editing, [{ zoneKey: Z2K, floorKey: "nouveletage" }]);
  assert.deepEqual(env.table.editingStoreys, []);
});

test("supprimer l'étage dans une zone : la question nomme la zone en mode étage, pas en mode zone", async () => {
  const byFloor = setup({ confirm: () => false });
  await activate(byFloor);
  await byFloor.table.callbacks.onDeleteFloor(Z1K, "ss1");
  assert.deepEqual(byFloor.questions, ["Supprimer l'étage « SS1 » de « Zone 1 / BAT BC » et sa tâche ?"]);
  const byZone = setup({ confirm: () => false });
  await activate(byZone, { layout: null });
  await byZone.table.callbacks.onDeleteFloor(Z1K, "ss1");
  assert.deepEqual(byZone.questions, ["Supprimer l'étage « SS1 » et sa tâche ?"]);
});

test("ajout d'une tâche, d'un cycle, déplacement : la ligne étage qui reçoit est dépliée", async () => {
  let nextId = 500;
  const env = setup({ applyUserActions: (actions) => (actions[0][0] === "AddRecord" ? { retValues: [nextId++] } : { retValues: [] }) });
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  await env.table.callbacks.onAddTask(Z1K, "ss1");
  assert.equal(env.line("storey:ss1").collapsed, false);
  assert.ok(env.keys().includes("task:500"));

  env.table.callbacks.onToggleStorey("ss1");
  await env.table.callbacks.onAddCycle(Z2K, "ss1");
  assert.equal(env.line("storey:ss1").collapsed, false);

  env.table.callbacks.onToggleStorey("");
  await env.table.callbacks.onAddTask(Z2K, "");
  assert.equal(env.line("storey:").collapsed, false, "le bloc « Sans étage » est déplié");

  const target = resolveDropTarget(env.line(`floor:${Z1K}/rp1`));
  env.table.callbacks.onToggleStorey("rp1");
  env.table.callbacks.onMoveTask(1, target);
  await flush();
  assert.equal(env.line("storey:rp1").collapsed, false);
});

test("déplacer un cycle : la ligne étage qui le reçoit est dépliée", async () => {
  const cycle = (id, name, order) => row(id, { Taches: name, Zone: Z1, Groupe: "SS1", Nature: "Cycle", Ordre: order });
  const env = setup({ rows: [...storeyRows(), cycle(30, "Cycle A", "1"), cycle(31, "Cycle B", "2")] });
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  env.table.callbacks.onMoveCycle(31, {
    zoneKey: Z1K, floorKey: "ss1", groupRowId: null, position: { groupRowId: 30, side: "before" },
  });
  await flush();
  assert.equal(env.writes.length, 1);
  assert.equal(env.line("storey:ss1").collapsed, false);
});

test("supprimer l'étage : un étage recréé sous ce nom ne naît pas replié", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  await env.table.callbacks.onDeleteStorey("ss1");
  env.table.callbacks.onRenameStorey("rp1", "SS1");
  await flush();
  assert.equal(env.line("storey:ss1").collapsed, false);
});

test("filtre de zone actif : renommer l'étage agit quand même dans toutes ses zones", async () => {
  const env = setup();
  await activate(env);
  env.controller.setZoneFilter(Z1);
  env.table.callbacks.onRenameStorey("ss1", "SS2");
  await flush();
  assert.equal(env.writes.length, 1);
  const touched = touchedIds(env.writes[0]);
  [20, 22, 1, 3].forEach((id) => assert.ok(touched.includes(id), `ligne ${id} renommée`));
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage renommé dans 2 zones.", tone: "info" });
});

// --- « Ajouter un étage… » : fenêtre de choix des zones (affichage par étage) ---

const TWO_TEMPLATES = Array.from({ length: 52 }, (_, index) => 301 + index);
const bulkAddOrIds = (ids) => (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [ids] } : { retValues: [] });

test("ajouter un étage… refusé sans « Editer », en lecture seule, avec un filtre de zone : aucune fenêtre", async () => {
  const locked = setup();
  locked.controller.setActive(true);
  await flush();
  locked.controller.setLayout("floor");
  await locked.table.callbacks.onAddStorey("");
  assert.equal(locked.floorDialog.opens.length, 0);
  assert.equal(locked.table.statuses.at(-1).text, "Activez « Editer » dans le bandeau pour modifier les tâches.");

  const readOnly = setup();
  readOnly.state.accessMode = "readonly";
  await activate(readOnly);
  await readOnly.table.callbacks.onAddStorey("");
  assert.equal(readOnly.floorDialog.opens.length, 0);

  const filtered = setup();
  await activate(filtered);
  filtered.controller.setZoneFilter(Z1);
  await filtered.table.callbacks.onAddStorey("");
  assert.deepEqual(filtered.table.statuses.at(-1), {
    text: "Retirez le filtre de zone pour ajouter un étage.",
    tone: "error",
  });
  assert.equal(filtered.floorDialog.opens.length, 0);
  assert.equal(filtered.writes.length, 0);
});

test("ajouter un étage… : le modèle de la fenêtre (nom libre, zones nommées, zone cliquée cochée)", async () => {
  const env = setup({ rows: [...storeyRows(), floorRow(23, "Nouvel étage", Z1), task(9, "Libre", "", "")] });
  await activate(env);
  await env.table.callbacks.onAddStorey(Z2K);
  assert.equal(env.floorDialog.opens.length, 1);
  const model = env.floorDialog.opens[0];
  assert.equal(model.name, "Nouvel étage 2");
  assert.deepEqual(model.zones, [{ zoneKey: Z1K, label: Z1 }, { zoneKey: Z2K, label: Z2 }]);
  assert.deepEqual(model.checked, [Z2K]);
  assert.deepEqual([...model.takenZones("ss1")], [Z1K, Z2K]);
  assert.deepEqual([...model.takenZones("R+1")], [Z1K]);
  assert.equal(model.validate("R+1", [Z2K, Z1K]).error, `Dans « ${Z1} » : Un étage « R+1 » existe déjà dans cette zone.`);
  assert.deepEqual(model.validate("R+2", [Z2K, Z1K]), { ok: true, name: "R+2", key: "rp2", zoneKeys: [Z1K, Z2K], newZones: [] });
  assert.equal(model.checkZoneName("ZONE 2 / bat b").existing, true);
  assert.deepEqual(model.checkZoneName("Zone 4"), { ok: true, existing: false, zoneKey: zoneKeyOf("Zone 4"), label: "Zone 4" });
  assert.deepEqual(model.validate("R+2", [], ["Zone 4"]).newZones, [{ zoneKey: zoneKeyOf("Zone 4"), label: "Zone 4" }]);

  // Depuis une ligne étage ou « Sans étage » : aucune zone cochée.
  await env.table.callbacks.onAddStorey("");
  assert.deepEqual(env.floorDialog.opens[1].checked, []);
  assert.equal(env.writes.length, 0, "rien n'est écrit avant « Créer »");
});

test("ajouter un étage… : aucune zone nommée, la fenêtre s'ouvre quand même avec une liste vide ; colonnes du modèle absentes", async () => {
  const none = setup({ rows: [task(9, "Libre", "", "")] });
  await activate(none);
  await none.table.callbacks.onAddStorey("");
  assert.equal(none.floorDialog.opens.length, 1);
  assert.deepEqual(none.floorDialog.opens[0].zones, []);
  assert.deepEqual(none.floorDialog.opens[0].checked, []);

  const noTemplate = setup({ rows: withoutColumns(storeyRows(), ["Nature", "Parent", "Lien"]) });
  await activate(noTemplate);
  await noTemplate.table.callbacks.onAddStorey("");
  assert.equal(noTemplate.floorDialog.opens.length, 0);
  assert.match(noTemplate.table.statuses.at(-1).text, /^Les colonnes « Nature », « Parent » et « Lien »/);
});

test("« Créer » pour deux zones : un BulkAddRecord de 52 lignes, deux liens, étage déplié, message", async () => {
  const env = setup({ applyUserActions: bulkAddOrIds(TWO_TEMPLATES) });
  await activate(env);
  env.table.callbacks.onToggleStorey("ss1");
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z1K, Z2K] });
  assert.equal(env.writes.length, 2);
  const [add] = env.writes[0];
  assert.equal(env.writes[0].length, 1);
  assert.equal(add[0], "BulkAddRecord");
  assert.equal(add[2].length, 52);
  assert.deepEqual(add[3].Zone.slice(0, 26), Array(26).fill(Z1));
  assert.deepEqual(add[3].Zone.slice(26), Array(26).fill(Z2));
  assert.equal(add[3].Taches[0], "R+2");
  assert.equal(add[3].Taches[26], "R+2");
  assert.equal(env.writes[1].length, 2);
  assert.ok(env.writes[1].every((action) => action[0] === "BulkUpdateRecord"));
  assert.ok(touchedIds([env.writes[1][0]]).every((id) => id <= 326));
  assert.ok(touchedIds([env.writes[1][1]]).every((id) => id >= 327));
  assert.equal(env.line("storey:rp2").collapsed, false);
  assert.equal(env.line(`floor:${Z1K}/rp2`).collapsed, false);
  assert.equal(env.line(`floor:${Z2K}/rp2`).collapsed, false);
  assert.deepEqual(env.table.editingStoreys, [], "pas de saisie du nom");
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage « R+2 » ajouté dans 2 zones.", tone: "info" });
});

test("« Créer » pour une zone : message nommant la zone", async () => {
  const env = setup({ applyUserActions: bulkAddOrIds(TEMPLATE_IDS) });
  await activate(env);
  await env.table.callbacks.onAddStorey(Z2K);
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z2K] });
  assert.equal(env.writes[0][0][2].length, 26);
  assert.equal(env.writes[1].length, 1);
  assert.deepEqual(env.table.statuses.at(-1), { text: `Étage « R+2 » ajouté dans « ${Z2} ».`, tone: "info" });
});

test("« Créer » : le second temps échoue, tous les ids créés sont retirés, rien n'est gardé", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = setup({
    applyUserActions: (actions) => {
      if (actions[0][0] === "BulkAddRecord") return { retValues: [TWO_TEMPLATES] };
      if (actions[0][0] === "BulkUpdateRecord") throw new Error("boom");
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z1K, Z2K] });
  assert.equal(env.writes.length, 3);
  assert.deepEqual(env.writes[2], [["BulkRemoveRecord", "Planning_Projet", TWO_TEMPLATES]]);
  assert.equal(env.keys().includes("storey:rp2"), false);
  assert.equal(env.table.statuses.at(-1).tone, "error");
});

test("« Créer » après un changement concurrent (le nom existe désormais dans une zone cochée) : refus, aucune écriture", async () => {
  const changed = setup({ rows: [...storeyRows(), floorRow(30, "R+2", Z2)] });
  await activate(changed);
  await changed.table.callbacks.onAddStorey("");
  await changed.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z1K, Z2K] });
  assert.equal(changed.writes.length, 0);
  assert.deepEqual(changed.table.statuses.at(-1), {
    text: `Dans « ${Z2} » : Un étage « R+2 » existe déjà dans cette zone.`,
    tone: "error",
  });
  // Un envoi dont le verrou « Editer » est tombé entre-temps.
  const env = setup({ applyUserActions: bulkAddOrIds(TWO_TEMPLATES) });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  env.controller.setEditingEnabled(false);
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z1K] });
  assert.equal(env.writes.length, 0);
});

test("la fenêtre « Ajouter un étage » se ferme au changement d'affichage, à la désactivation d'« Editer », au changement de projet et à la désactivation de la vue", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  env.controller.setLayout("floor");
  assert.equal(env.floorDialog.closes, 0, "même affichage : elle reste ouverte");
  env.controller.setLayout("zone");
  assert.equal(env.floorDialog.closes, 1);
  env.controller.setEditingEnabled(false);
  assert.equal(env.floorDialog.closes, 2);
  env.controller.setEditingEnabled(true);
  env.controller.setLayout("floor");
  await env.table.callbacks.onAddStorey("");
  const closed = env.floorDialog.closes;
  env.state.currentProject = { name: "AUTRE", names: ["AUTRE"] };
  env.listeners.context.forEach((listener) => listener());
  assert.equal(env.floorDialog.closes, closed + 1);
  env.controller.setActive(false);
  assert.equal(env.floorDialog.closes, closed + 2);
});

// --- Zones créées depuis la fenêtre « Ajouter un étage… » ---

const THREE_TEMPLATES = Array.from({ length: 53 }, (_, index) => 301 + index);
const Z4 = "Zone 4";
const Z4K = zoneKeyOf(Z4);

test("« Créer » dans une zone existante et une nouvelle : un seul BulkAddRecord (2 × 26 lignes + ligne vide), deux liens, message, tableau sans ligne parasite", async () => {
  const env = setup({ applyUserActions: bulkAddOrIds(THREE_TEMPLATES) });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z2K], newZones: [Z4] });
  assert.equal(env.writes.length, 2);
  assert.equal(env.writes[0].length, 1);
  const [add] = env.writes[0];
  assert.equal(add[0], "BulkAddRecord");
  assert.equal(add[2].length, 53);
  assert.deepEqual(add[3].Zone.slice(0, 26), Array(26).fill(Z2));
  assert.deepEqual(add[3].Zone.slice(26, 52), Array(26).fill(Z4));
  assert.equal(add[3].Zone[52], Z4);
  assert.equal(add[3].Taches[52], "");
  assert.equal(add[3].Etage[52], false);
  assert.equal(add[3].Groupe[52], "");
  assert.equal(add[3].NomProjet[52], "HOTEL DIEU");
  Object.values(add[3]).forEach((column) => assert.equal(column.includes(null), false));
  // Deux liens (une zone chacune), l'ancre n'en reçoit aucun.
  assert.equal(env.writes[1].length, 2);
  assert.ok(touchedIds([env.writes[1][0]]).every((id) => id >= 302 && id <= 326));
  assert.ok(touchedIds([env.writes[1][1]]).every((id) => id >= 328 && id <= 352));
  assert.deepEqual(env.table.statuses.at(-1), { text: "Étage « R+2 » ajouté dans 2 zones, dont 1 nouvelle.", tone: "info" });
  // La nouvelle zone est sous l'étage R+2, et la ligne vide n'affiche rien.
  assert.ok(env.keys().includes("storey:rp2"));
  assert.ok(env.keys().includes(`floor:${Z4K}/rp2`));
  assert.ok(env.keys().includes(`floor:${Z2K}/rp2`));
  assert.equal(env.keys().includes("task:353"), false);
  assert.ok(env.keys().includes(`zone:${Z4K}`), "la zone figure dans le bloc « Sans étage » comme les autres zones");
  assert.equal(env.keys().filter((key) => key.startsWith("task:")).length, 3 + 2 * 20, "aucune ligne pour la ligne vide");
  assert.equal(env.line(`floor:${Z4K}/rp2`).collapsed, false);
});

test("la ligne vide ne fait exister que la zone : elle reste quand l'étage est supprimé", async () => {
  const rows = [...storeyRows(), row(353, { Zone: Z4 })];
  const env = setup({ rows });
  await activate(env, { layout: "zone" });
  const zoneLines = env.lastRender().lines.filter((line) => line.kind === "zone");
  assert.ok(zoneLines.some((line) => line.zoneKey === Z4K), "la zone vide est listée");
  assert.equal(env.lastRender().lines.some((line) => line.kind === "task" && line.id === 353), false);
});

test("« Créer » avec seulement une nouvelle zone : 26 lignes + ligne vide, message dédié", async () => {
  const env = setup({ applyUserActions: bulkAddOrIds([...TEMPLATE_IDS, 327]) });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [], newZones: [Z4] });
  assert.equal(env.writes[0][0][2].length, 27);
  assert.equal(env.writes[1].length, 1);
  assert.deepEqual(env.table.statuses.at(-1), { text: "Zone « Zone 4 » créée, avec l'étage « R+2 ».", tone: "info" });
});

test("« Créer » : deux nouvelles zones et une existante, message au pluriel", async () => {
  const ids = Array.from({ length: 82 }, (_, index) => 301 + index);
  const env = setup({ applyUserActions: bulkAddOrIds(ids) });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z1K], newZones: [Z4, "Zone 5"] });
  assert.equal(env.writes[0][0][2].length, 80);
  assert.equal(env.table.statuses.at(-1).text, "Étage « R+2 » ajouté dans 3 zones, dont 2 nouvelles.");
});

test("« Créer » : une zone « nouvelle » créée entre-temps par un autre est rejointe, sans ligne vide", async () => {
  const env = setup({ rows: [...storeyRows(), row(40, { Zone: Z4 })], applyUserActions: bulkAddOrIds(TEMPLATE_IDS) });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [], newZones: ["zone 4"] });
  assert.equal(env.writes[0][0][2].length, 26);
  assert.equal(env.writes[0][0][3].Zone[0], Z4);
  assert.equal(env.table.statuses.at(-1).text, `Étage « R+2 » ajouté dans « ${Z4} ».`);
});

test("« Créer » avec une nouvelle zone invalide : refus, aucune écriture", async () => {
  const env = setup({ applyUserActions: bulkAddOrIds(THREE_TEMPLATES) });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z1K], newZones: ["Sans zone"] });
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.at(-1).tone, "error");
  assert.match(env.table.statuses.at(-1).text, /^Zone « Sans zone » : /);
});

test("« Créer » avec une nouvelle zone : le second temps échoue, tous les ids (ligne vide comprise) sont retirés", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = setup({
    applyUserActions: (actions) => {
      if (actions[0][0] === "BulkAddRecord") return { retValues: [THREE_TEMPLATES] };
      if (actions[0][0] === "BulkUpdateRecord") throw new Error("boom");
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddStorey("");
  await env.floorDialog.onSubmit({ name: "R+2", zoneKeys: [Z2K], newZones: [Z4] });
  assert.equal(env.writes.length, 3);
  assert.deepEqual(env.writes[2], [["BulkRemoveRecord", "Planning_Projet", THREE_TEMPLATES]]);
  assert.equal(env.keys().includes("storey:rp2"), false);
  assert.equal(env.table.statuses.at(-1).tone, "error");
});
