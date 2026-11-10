// Bouton « Par étage » : changeLayout du contrôleur Synthese (droits, double clic, échec).
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";

const LOCKED = "Activez « Editer » dans le bandeau pour modifier les tâches.";
const READ_ONLY = "Ce service est en lecture seule pour vous : les tâches ne sont pas modifiables.";
const FAILED = "Le mode d'affichage n'a pas pu être enregistré dans Projets2 : l'affichage ne change pas. Vérifiez vos droits sur Projets2, puis réessayez.";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ accessMode = "editable", saveLayout } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode };
  const context = {
    async fetchContextRows() { return []; },
    getState: () => ({ ...state, currentProject: { ...state.currentProject } }),
    subscribe() { return () => {}; },
    watchProjectZones() { return () => {}; },
  };
  const statuses = [];
  const calls = [];
  const controller = createSyntheseTasksController({
    context,
    docApi: { async applyUserActions() { return { retValues: [] }; } },
    createTable: () => ({
      render() {},
      setStatus: (text, tone) => statuses.push({ text, tone }),
      startEditing() {},
    }),
    confirm: () => true,
    saveLayout: saveLayout ? async (layout) => { calls.push(layout); return saveLayout(layout); } : null,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  return { controller, statuses, calls, lastStatus: () => statuses.at(-1) };
}

async function activate(env, editing = true) {
  env.controller.setEditingEnabled(editing);
  env.controller.setActive(true);
  await flush();
}

test("changeLayout : modifiable, saveLayout appelé une fois avec floor, résultat true", async () => {
  const env = setup({ saveLayout: async () => {} });
  await activate(env);
  assert.equal(await env.controller.changeLayout("floor"), true);
  assert.deepEqual(env.calls, ["floor"]);
});

test("changeLayout : Editer désactivé, message habituel, rien écrit", async () => {
  const env = setup({ saveLayout: async () => {} });
  await activate(env, false);
  assert.equal(await env.controller.changeLayout("floor"), false);
  assert.deepEqual(env.lastStatus(), { text: LOCKED, tone: "error" });
  assert.deepEqual(env.calls, []);
});

test("changeLayout : service en lecture seule, message de lecture seule, rien écrit", async () => {
  const env = setup({ accessMode: "readonly", saveLayout: async () => {} });
  await activate(env);
  assert.equal(await env.controller.changeLayout("floor"), false);
  assert.deepEqual(env.lastStatus(), { text: READ_ONLY, tone: "error" });
  assert.deepEqual(env.calls, []);
});

test("changeLayout : même affichage, rien écrit, true", async () => {
  const env = setup({ saveLayout: async () => {} });
  await activate(env);
  assert.equal(await env.controller.changeLayout("zone"), true);
  assert.deepEqual(env.calls, []);
});

test("changeLayout : échec, message d'échec dans la barre d'état, false", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = setup({ saveLayout: async () => { throw new Error("refusé"); } });
  await activate(env);
  assert.equal(await env.controller.changeLayout("floor"), false);
  assert.deepEqual(env.lastStatus(), { text: FAILED, tone: "error" });
});

test("changeLayout : échec avec userMessage, ce message est affiché", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = setup({
    saveLayout: async () => { throw Object.assign(new Error("x"), { userMessage: "Droits insuffisants." }); },
  });
  await activate(env);
  assert.equal(await env.controller.changeLayout("floor"), false);
  assert.deepEqual(env.lastStatus(), { text: "Droits insuffisants.", tone: "error" });
});

test("changeLayout : second appel pendant l'enregistrement ignoré", async () => {
  let release;
  const env = setup({ saveLayout: () => new Promise((resolve) => { release = resolve; }) });
  await activate(env);
  const first = env.controller.changeLayout("floor");
  assert.equal(await env.controller.changeLayout("floor"), false);
  release();
  assert.equal(await first, true);
  assert.deepEqual(env.calls, ["floor"]);
  // Le drapeau est levé : un nouvel essai est possible.
  const again = env.controller.changeLayout("floor");
  release();
  assert.equal(await again, true);
  assert.equal(env.calls.length, 2);
});

test("changeLayout : sans saveLayout, false", async () => {
  const env = setup();
  await activate(env);
  assert.equal(await env.controller.changeLayout("floor"), false);
});
