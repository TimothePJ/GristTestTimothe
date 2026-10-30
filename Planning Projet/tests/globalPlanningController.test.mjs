// Contrôleur de la vue Global : lecture des deux tables, rafraîchissement, replis, « Alertes
// seulement », filtre de zone, messages — et jamais d'écriture.
import test from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const { createGlobalPlanningController } = await import("../assets/js/ui/globalPlanningController.js");
const { PROJECT, TODAY, ZONE_1, ZONE_2, planRows, projectRows, structureRows } = await import("./helpers/globalRows.mjs");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Lectures réglées à la main : chaque appel attend qu'on le résolve ou le rejette.
function manualLoads() {
  const calls = [];
  return { calls, loadRows: () => new Promise((resolve, reject) => calls.push({ resolve, reject })) };
}

function setup({ loadRows = null, project = { name: PROJECT }, immediateSubscribe = false } = {}) {
  const state = { currentProject: project, selectedService: "Structure" };
  const listeners = [];
  const context = {
    getState: () => ({ ...state }),
    subscribe(listener) {
      listeners.push(listener);
      // Le vrai contexte appelle l'abonné tout de suite quand il est prêt.
      if (immediateSubscribe) listener(context.getState());
      return () => {};
    },
  };
  const data = { projectRows: projectRows(), planRows: planRows() };
  const loads = [];
  const table = { renders: [], callbacks: null };
  const controller = createGlobalPlanningController({
    context,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return { render: (lines, options) => table.renders.push({ lines, options }) };
    },
    loadRows: (...args) => {
      loads.push(args);
      return loadRows ? loadRows() : Promise.resolve(data);
    },
    now: () => TODAY,
  });
  const lastRender = () => table.renders.at(-1);
  const keys = () => lastRender().lines.map((line) => line.key);
  const notify = () => listeners.forEach((listener) => listener(context.getState()));
  return { state, context, data, loads, table, controller, lastRender, keys, notify };
}

async function activate(env) {
  env.controller.setActive(true);
  await flush();
}

const DEFAULT_KEYS = [
  "zone:zone1batbc", "level:101",
  "zone:zone2batb", "level:113", "doc:111", "level:112", "floor:zone2batb/rp1", "task:600", "type:zone2batb/coupes", "doc:142",
  "zone:", "type:/ndc",
];

test("inactive : aucune lecture, aucun dessin", async () => {
  const env = setup();
  env.controller.setZoneFilter(ZONE_1);
  await env.controller.refresh();
  env.notify();
  await flush();
  assert.equal(env.loads.length, 0);
  assert.equal(env.table.renders.length, 0);
});

test("activation : « Chargement… », puis le planning fusionné et ses compteurs", async () => {
  const env = setup();
  env.controller.setActive(true);
  assert.deepEqual(env.lastRender().options, { emptyMessage: "Chargement du planning global…", alertsOnly: false });
  await flush();
  assert.equal(env.loads.length, 1);
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
  assert.deepEqual(env.lastRender().options, {
    emptyMessage: "",
    totals: { linkedFloors: 3, unlinkedFloors: 1, synthese: 1, missing: 0, stale: 1, structure: 2 },
    alertsOnly: false,
    notice: "",
  });
});

test("les retards sont comptés au jour de l'horloge", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  const formwork = env.lastRender().lines.find((line) => line.key === "doc:113");
  assert.equal(formwork.state.parts[0].text, "retard 37 j", "Fin le 02/09/26, aujourd'hui le 09/10/26");
});

test("barres Structure : indices de référence et données d'entrées lus avec les tables vont au modèle", async () => {
  const referenceLookup = new Map([[111, {
    rowId: 111, firstDateLimiteIso: "2026-09-01", firstTimelineDateLimiteIso: "2026-09-01", status: "complete",
    receivedCount: 1, missingCount: 0, totalCount: 1, references: [],
  }]]);
  const targetLookup = new Map([["era quai d'orsay", new Map([["COFFRAGE", "C"]])]]);
  const env = setup({ loadRows: () => Promise.resolve({ projectRows: projectRows(), planRows: planRows(), targetLookup, referenceLookup }) });
  await activate(env);
  // Déplié : ses propres barres (replié, il montre la barre de toute sa section).
  env.table.callbacks.onToggle("doc:111");
  const formwork = env.lastRender().lines.find((line) => line.key === "doc:111");
  assert.ok(formwork.segments.some((segment) => segment.kind === "reference" && segment.classes.endsWith("--complete")));
  assert.ok(formwork.segments.every((segment) => !segment.classes.includes("phase-realise-complete")), "indice A sur C : pas réalisé");
});

test("aucun projet : invite, sans lecture", async () => {
  const env = setup({ project: null });
  await activate(env);
  assert.equal(env.lastRender().options.emptyMessage, "Choisissez un projet pour afficher son planning global.");
  assert.equal(env.loads.length, 0);
});

test("projet sans ligne : message", async () => {
  const env = setup();
  env.data.projectRows = [];
  env.data.planRows = [];
  await activate(env);
  assert.equal(env.lastRender().options.emptyMessage, "Aucune ligne de planning pour ce projet.");
  assert.deepEqual(env.lastRender().lines, []);
});

test("triangle : la ligne bascule, les autres gardent leur état", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  assert.deepEqual(env.keys().slice(3, 6), ["level:113", "floor:zone2batb/rdc", "doc:113"]);
  env.table.callbacks.onToggle("zone:zone1batbc");
  assert.deepEqual(env.keys().slice(0, 4), ["zone:zone1batbc", "zone:zone2batb", "level:113", "floor:zone2batb/rdc"]);
  env.table.callbacks.onToggle("level:113");
  env.table.callbacks.onToggle("zone:zone1batbc");
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
  assert.equal(env.loads.length, 1, "un repli ne relit rien");
});

test("« Alertes seulement » : filtre, replis à part, retour à l'affichage précédent", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("doc:111");
  const before = env.keys();
  env.table.callbacks.onToggleAlertsOnly();
  assert.equal(env.lastRender().options.alertsOnly, true);
  assert.deepEqual(env.keys(), [
    "zone:zone1batbc", "level:101", "floor:zone1batbc/ss1",
    "zone:zone2batb", "level:113", "floor:zone2batb/rdc", "group:416", "group:419", "task:420", "doc:113", "doc:123",
  ]);
  env.table.callbacks.onToggle("level:113");
  assert.equal(env.keys().includes("task:420"), false);
  env.table.callbacks.onToggleAlertsOnly();
  assert.deepEqual(env.keys(), before, "les replis d'avant sont retrouvés");
  env.table.callbacks.onToggleAlertsOnly();
  assert.equal(env.keys().includes("task:420"), true, "les replis du mode alertes repartent de zéro");
});

test("« Alertes seulement » sans alerte : message, bouton toujours enfoncé", async () => {
  const env = setup();
  env.data.projectRows = structureRows().filter((row) => row.id === 2 || row.id === 111 || row.id === 121);
  env.data.planRows = [];
  await activate(env);
  assert.deepEqual(env.keys(), ["zone:zone2batb", "doc:111"]);
  env.table.callbacks.onToggleAlertsOnly();
  assert.deepEqual([env.lastRender().options.emptyMessage, env.lastRender().options.alertsOnly], ["Aucune alerte sur ce projet.", true]);
});

test("filtre de zone du bandeau : une section, sans nouvelle lecture", async () => {
  const env = setup();
  await activate(env);
  env.controller.setZoneFilter(ZONE_1);
  assert.deepEqual(env.keys(), ["zone:zone1batbc", "level:101"]);
  assert.equal(env.lastRender().options.totals.linkedFloors, 1);
  const count = env.table.renders.length;
  env.controller.setZoneFilter(` ${ZONE_1} `);
  assert.equal(env.table.renders.length, count, "même zone : rien à redessiner");
  env.controller.setZoneFilter("");
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
  assert.equal(env.loads.length, 1);
});

test("rafraîchissement (signal de la surveillance) : nouvelle lecture, replis gardés, pas de « Chargement… »", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  env.data.projectRows = projectRows().map((row) => (row.id === 420 ? { ...row, Diff_armature: "2026-08-19" } : row));
  const count = env.table.renders.length;
  await env.controller.refresh();
  assert.equal(env.loads.length, 2);
  assert.equal(env.table.renders.length, count + 1, "un seul dessin, celui des nouvelles données");
  assert.equal(env.keys().includes("floor:zone2batb/rdc"), true, "le niveau reste déplié");
  assert.equal(env.lastRender().options.totals.synthese, 0, "la tâche contrôlée finit maintenant à temps");
});

test("changement de projet : nouvelle lecture, replis remis à zéro ; changement de service : rien", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  env.state.selectedService = "Synthese";
  env.notify();
  await flush();
  assert.equal(env.loads.length, 1, "même projet : même contenu");
  env.state.currentProject = { name: "HOTEL DIEU" };
  env.notify();
  assert.equal(env.lastRender().options.emptyMessage, "Chargement du planning global…");
  await flush();
  assert.equal(env.loads.length, 2);
  assert.deepEqual(env.keys(), DEFAULT_KEYS, "les replis de l'ancien projet sont oubliés");
});

test("réponse arrivée après un changement de projet ou une désactivation : ignorée", async () => {
  const loads = manualLoads();
  const env = setup({ loadRows: loads.loadRows });
  await activate(env);
  env.state.currentProject = { name: "HOTEL DIEU" };
  env.notify();
  loads.calls[0].resolve(env.data);
  await flush();
  assert.equal(env.lastRender().options.emptyMessage, "Chargement du planning global…", "la lecture de l'ancien projet ne s'affiche pas");
  loads.calls[1].resolve({ projectRows: [], planRows: [] });
  await flush();
  assert.equal(env.lastRender().options.emptyMessage, "Aucune ligne de planning pour ce projet.");

  const count = env.table.renders.length;
  void env.controller.refresh();
  env.controller.setActive(false);
  loads.calls[2].resolve(env.data);
  await flush();
  assert.equal(env.table.renders.length, count, "vue inactive : plus aucun dessin");
});

test("désactivée puis réactivée : relit le projet", async () => {
  const env = setup();
  await activate(env);
  env.controller.setActive(false);
  env.controller.setActive(true);
  await flush();
  assert.equal(env.loads.length, 2);
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
});

test("première lecture impossible : message, puis relue en rouvrant la vue ou au signal suivant", async () => {
  const loads = manualLoads();
  const env = setup({ loadRows: loads.loadRows });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await activate(env);
    loads.calls[0].reject(new Error("réseau"));
    await flush();
    assert.equal(env.lastRender().options.emptyMessage, "Le planning global n'a pas pu être lu. Rouvrez la vue Global pour réessayer.");
    env.controller.setActive(false);
    env.controller.setActive(true);
    loads.calls[1].reject(new Error("réseau"));
    await flush();
    assert.equal(env.lastRender().options.emptyMessage, "Le planning global n'a pas pu être lu. Rouvrez la vue Global pour réessayer.");
    void env.controller.refresh();
    loads.calls[2].resolve(env.data);
    await flush();
    assert.deepEqual(env.keys(), DEFAULT_KEYS);
    assert.equal(errors.length, 2);
  } finally {
    console.error = original;
  }
});

test("relecture impossible : les données restent, avec un avertissement jusqu'à la prochaine lecture réussie", async () => {
  const loads = manualLoads();
  const env = setup({ loadRows: loads.loadRows });
  const original = console.error;
  console.error = () => {};
  try {
    await activate(env);
    loads.calls[0].resolve(env.data);
    await flush();
    void env.controller.refresh();
    loads.calls[1].reject(new Error("réseau"));
    await flush();
    assert.deepEqual(env.keys(), DEFAULT_KEYS);
    assert.equal(env.lastRender().options.notice, "La dernière relecture a échoué : les dates affichées peuvent être anciennes.");
    void env.controller.refresh();
    loads.calls[2].resolve(env.data);
    await flush();
    assert.equal(env.lastRender().options.notice, "");
  } finally {
    console.error = original;
  }
});

// Des lignes dont la lecture du service lève : le modèle échoue après une lecture réussie.
function poisonedRows() {
  const poisoned = {
    id: 999,
    get Service() {
      throw new Error("donnée inattendue");
    },
  };
  return { projectRows: [...projectRows(), poisoned], planRows: planRows() };
}

test("lecture réussie mais construction impossible : message d'échec, pas de « Chargement… » éternel", async () => {
  const env = setup({ loadRows: () => Promise.resolve(poisonedRows()) });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await activate(env);
    assert.equal(env.lastRender().options.emptyMessage, "Le planning global n'a pas pu être lu. Rouvrez la vue Global pour réessayer.");
    assert.ok(errors.length >= 1);
  } finally {
    console.error = original;
  }
});

test("relecture dont la construction échoue : les données restent, avec un avertissement, et refresh() se résout", async () => {
  let poison = false;
  const env = setup({ loadRows: () => Promise.resolve(poison ? poisonedRows() : { projectRows: projectRows(), planRows: planRows() }) });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await activate(env);
    assert.deepEqual(env.keys(), DEFAULT_KEYS);
    poison = true;
    await env.controller.refresh();
    assert.deepEqual(env.keys(), DEFAULT_KEYS);
    assert.equal(env.lastRender().options.notice, "La dernière relecture a échoué : les dates affichées peuvent être anciennes.");
    assert.equal(errors.length, 1);
  } finally {
    console.error = original;
  }
});

test("contexte qui prévient dès l'abonnement : une seule lecture à la première ouverture", async () => {
  const env = setup({ immediateSubscribe: true });
  await activate(env);
  assert.equal(env.loads.length, 1);
});

test("contexte pas encore prêt, sans projet : « Chargement… » ; prêt : l'invitation", async () => {
  const env = setup({ project: null });
  env.context.getState = () => ({ currentProject: null, ready: false });
  await activate(env);
  assert.equal(env.lastRender().options.emptyMessage, "Chargement du planning global…");
  env.context.getState = () => ({ currentProject: null, ready: true });
  env.controller.setZoneFilter("autre");
  assert.equal(env.lastRender().options.emptyMessage, "Choisissez un projet pour afficher son planning global.");
});

test("filtre sur une zone sans ligne : messages propres à la zone", async () => {
  const env = setup();
  await activate(env);
  env.controller.setZoneFilter("Zone inconnue");
  assert.equal(env.lastRender().options.emptyMessage, "Aucune ligne de planning dans cette zone.");
  env.controller.setZoneFilter("");
  const quiet = setup();
  quiet.data.projectRows = structureRows().filter((row) => row.id === 2 || row.id === 111 || row.id === 121);
  quiet.data.planRows = [];
  await activate(quiet);
  quiet.table.callbacks.onToggleAlertsOnly();
  assert.equal(quiet.lastRender().options.emptyMessage, "Aucune alerte sur ce projet.");
  quiet.controller.setZoneFilter(ZONE_2);
  assert.equal(quiet.lastRender().options.emptyMessage, "Aucune alerte dans cette zone.");
});

test("lecture seule : le contrôleur ne connaît que la lecture des deux tables", async () => {
  const env = setup();
  env.context.docApi = { applyUserActions: () => { throw new Error("écriture interdite"); } };
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  env.table.callbacks.onToggleAlertsOnly();
  await env.controller.refresh();
  assert.deepEqual(Object.keys(env.table.callbacks).sort(), ["onToggle", "onToggleAlertsOnly"]);
  assert.deepEqual(env.loads.map((args) => args.length), [0, 0]);
});
