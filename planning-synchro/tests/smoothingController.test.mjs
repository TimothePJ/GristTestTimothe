// Tests du controleur du lissage (top/smoothingController.js) : fenetres injectees
// par des espions, DOM simule a la main, localStorage simule sur globalThis.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSmoothingController } from "../assets/js/top/smoothingController.js";
import { loadSmoothingView, persistSmoothingView } from "../assets/js/state.js";

// --- localStorage simule -------------------------------------------------------

function withLocalStorage(fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  });
  const restore = () => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  };
  try {
    const out = fn(store);
    if (out && typeof out.then === "function") return out.finally(restore);
    restore();
    return out;
  } catch (error) {
    restore();
    throw error;
  }
}

// --- DOM minimal ---------------------------------------------------------------

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.hidden = false;
    this.disabled = false;
    this.title = "";
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    };
  }
  querySelectorAll() {
    return this.children;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const bucket = this.listeners.get(type) || [];
    const index = bucket.indexOf(fn);
    if (index >= 0) bucket.splice(index, 1);
  }
  click(target = this) {
    (this.listeners.get("click") || []).slice().forEach((fn) => fn({ target }));
  }
}

function makeEls() {
  const rawBtn = new FakeElement({ smoothingView: "raw" });
  const smoothedBtn = new FakeElement({ smoothingView: "smoothed" });
  const bothBtn = new FakeElement({ smoothingView: "both" });
  const displayGroup = new FakeElement();
  displayGroup.hidden = true;
  displayGroup.children = [rawBtn, smoothedBtn, bothBtn];
  return {
    els: {
      displayGroup,
      openButton: new FakeElement(),
      smoothingModalEl: new FakeElement(),
      monthTasksModalEl: new FakeElement(),
    },
    rawBtn,
    smoothedBtn,
    bothBtn,
  };
}

// Espions a la place des deux fenetres.
function makeSpies() {
  const spies = { smoothing: null, month: null };
  const calls = { smoothing: [], month: [] };
  spies.createSmoothingModal = (rootEl, options) => {
    let opened = false;
    spies.smoothing = {
      options,
      open: (context) => {
        opened = true;
        calls.smoothing.push(["open", context]);
      },
      refresh: (arg) => calls.smoothing.push(["refresh", arg]),
      close: () => {
        opened = false;
        calls.smoothing.push(["close"]);
      },
      isOpen: () => opened,
      destroy: () => calls.smoothing.push(["destroy"]),
    };
    return spies.smoothing;
  };
  spies.createMonthTasksModal = () => {
    let opened = false;
    spies.month = {
      open: (model) => {
        opened = true;
        calls.month.push(["open", model]);
      },
      update: (model) => calls.month.push(["update", model]),
      close: () => {
        opened = false;
        calls.month.push(["close"]);
      },
      isOpen: () => opened,
      destroy: () => calls.month.push(["destroy"]),
    };
    return spies.month;
  };
  return { spies, calls };
}

const TODAY = "2026-10-05";

function task(rowId, type, dueIso, extra = {}) {
  return { rowId, id2: String(rowId), name: `T${rowId}`, zone: "", groupe: "", groupKey: "", type, dueIso, realized: false, ...extra };
}

// Quatre coffrages : un maximum de 2 par mois en avance un en octobre.
const TASKS = [
  task(1, "COFFRAGE", "2026-10-20"),
  task(2, "COFFRAGE", "2026-11-10"),
  task(3, "COFFRAGE", "2026-11-12"),
  task(4, "COFFRAGE", "2026-11-14"),
];

const CELL_MAX2 = JSON.stringify({ version: 1, services: { Structure: { maxTotal: 2, maxParType: {} } } });
const CELL_OTHER = JSON.stringify({ version: 1, services: { Autre: { maxTotal: 7, maxParType: {} } } });

function build(overrides = {}) {
  const { els, rawBtn, smoothedBtn, bothBtn } = makeEls();
  const { spies, calls } = makeSpies();
  const saved = [];
  const changes = [];
  const options = {
    els,
    saveCell: async (projectId, value) => {
      saved.push([projectId, value]);
    },
    getService: () => "Structure",
    isReadOnly: () => false,
    todayIso: () => TODAY,
    onChange: () => changes.push(1),
    createSmoothingModal: spies.createSmoothingModal,
    createMonthTasksModal: spies.createMonthTasksModal,
    ...overrides,
  };
  const controller = createSmoothingController(options);
  return { controller, els, rawBtn, smoothedBtn, bothBtn, spies, calls, saved, changes };
}

function data(projectRow, extra = {}) {
  return { contextKey: "7|Structure", project: { id: 7, name: "Projet X" }, tasks: TASKS, projectRow, ...extra };
}

const NO_COLUMN_TITLE = "Ajoutez une colonne texte « Lissage » dans Projets2 pour activer le lissage.";

test("colonne absente : bouton grise avec l'explication, pas de lissage, aucune exception", () =>
  withLocalStorage(() => {
    const { controller, els } = build();
    controller.setProjectData(data({ id: 7, Nom_de_projet: "X" }));
    assert.equal(els.openButton.disabled, true);
    assert.equal(els.openButton.title, NO_COLUMN_TITLE);
    const input = controller.getChartInput();
    assert.equal(input.active, false);
    assert.equal(input.mode, "raw");
    assert.equal(els.displayGroup.hidden, true);
    // projectRow nul : meme comportement
    controller.setProjectData(data(null));
    assert.equal(controller.getChartInput().active, false);
  }));

test("aucune tache : bouton grise « Aucune tâche à lisser »", () =>
  withLocalStorage(() => {
    const { controller, els } = build();
    controller.setProjectData(data({ id: 7, Lissage: "" }, { tasks: [] }));
    assert.equal(els.openButton.disabled, true);
    assert.equal(els.openButton.title, "Aucune tâche à lisser");
    assert.equal(controller.getChartInput().active, false);
  }));

test("colonne presente mais vide : bouton actif, lissage inactif", () =>
  withLocalStorage(() => {
    const { controller, els } = build();
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    assert.equal(els.openButton.disabled, false);
    assert.equal(els.openButton.classList.contains("is-active"), false);
    assert.equal(els.displayGroup.hidden, true);
    assert.equal(controller.getChartInput().active, false);
  }));

test("cellule valide : lissage actif, groupe « Afficher » visible, mode memorise", () =>
  withLocalStorage(() => {
    persistSmoothingView("smoothed");
    const { controller, els, smoothedBtn, bothBtn } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    const input = controller.getChartInput();
    assert.equal(input.active, true);
    assert.equal(input.mode, loadSmoothingView());
    assert.equal(input.mode, "smoothed");
    assert.equal(input.tasks.length, TASKS.length);
    assert.ok(input.tasks.some((t) => t.smoothedIso && t.smoothedIso !== t.dueIso), "une tache a avance");
    assert.equal(els.displayGroup.hidden, false);
    assert.equal(els.openButton.classList.contains("is-active"), true);
    assert.equal(els.openButton.disabled, false);
    assert.equal(smoothedBtn.classList.contains("is-active"), true);
    assert.equal(bothBtn.classList.contains("is-active"), false);
  }));

test("memoire du mode : defaut « both », valeur inconnue -> defaut", () =>
  withLocalStorage((store) => {
    assert.equal(loadSmoothingView(), "both");
    store.set("planning-synchro.smoothing-view", "n'importe quoi");
    assert.equal(loadSmoothingView(), "both");
    persistSmoothingView("raw");
    assert.equal(store.get("planning-synchro.smoothing-view"), "raw");
    assert.equal(loadSmoothingView(), "raw");
  }));

test("sans localStorage : le mode retombe sur « both » sans exception", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  delete globalThis.localStorage;
  try {
    assert.equal(typeof localStorage, "undefined");
    assert.equal(loadSmoothingView(), "both");
    persistSmoothingView("raw");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  }
});

test("meme contextKey : fenetres gardees ouvertes, refresh / update appeles ; autre contextKey : fermees", () =>
  withLocalStorage(() => {
    const { controller, els, calls } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.openButton.click();
    controller.openMonthTasks({ startIso: "2026-11-01", endIso: "2026-12-01", label: "novembre 2026", granularity: "month", visibleTypeKeys: [] });
    assert.ok(calls.month.some((c) => c[0] === "open"));
    // la fermeture du premier chargement (contexte vide) ne compte pas
    calls.smoothing.length = 0;
    calls.month.length = 0;

    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    assert.ok(!calls.smoothing.some((c) => c[0] === "close"));
    assert.ok(!calls.month.some((c) => c[0] === "close"));
    assert.ok(calls.smoothing.some((c) => c[0] === "refresh"));
    assert.ok(calls.month.some((c) => c[0] === "update"));

    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }, { contextKey: "7|Autre" }));
    assert.ok(calls.smoothing.some((c) => c[0] === "close"));
    assert.ok(calls.month.some((c) => c[0] === "close"));
  }));

test("meme contexte, types presents changes : la fenetre Lissage est rouverte", () =>
  withLocalStorage(() => {
    const { controller, els, calls } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.openButton.click();
    assert.equal(calls.smoothing.filter((c) => c[0] === "open").length, 1);
    const withNdc = [...TASKS, task(9, "NDC", "2026-11-20")];
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }, { tasks: withNdc }));
    const opens = calls.smoothing.filter((c) => c[0] === "open");
    assert.equal(opens.length, 2);
    assert.deepEqual(opens[1][1].typesPresent, ["COFFRAGE", "NDC"]);
    assert.ok(!calls.smoothing.some((c) => c[0] === "refresh"));
  }));

test("ouverture : contexte complet, lecture seule transmise", () =>
  withLocalStorage(() => {
    let readOnly = false;
    const { controller, els, calls } = build({ isReadOnly: () => readOnly });
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.openButton.click();
    const ctx = calls.smoothing.find((c) => c[0] === "open")[1];
    assert.equal(ctx.readOnly, false);
    assert.equal(ctx.saved, true);
    assert.equal(ctx.todayIso, TODAY);
    assert.deepEqual(ctx.typesPresent, ["COFFRAGE"]);
    assert.equal(ctx.tasks.length, TASKS.length);
    assert.equal(ctx.settings.maxTotal, 2);
    assert.match(ctx.title, /Projet X · Structure/);
    assert.match(ctx.title, /^Lissage des tâches — /);
    readOnly = true;
    els.openButton.click();
    const last = calls.smoothing.filter((c) => c[0] === "open").pop()[1];
    assert.equal(last.readOnly, true);
  }));

test("bouton grise : le clic n'ouvre rien", () =>
  withLocalStorage(() => {
    const { controller, els, calls } = build();
    controller.setProjectData(data({ id: 7 }));
    els.openButton.click();
    assert.equal(calls.smoothing.filter((c) => c[0] === "open").length, 0);
  }));

test("compute de la fenetre : recalcule sur les taches courantes", () =>
  withLocalStorage(() => {
    const { controller, spies } = build();
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    const result = spies.smoothing.options.compute({ maxTotal: 2, maxByType: {} });
    assert.equal(result.active, true);
    assert.ok(result.movedCount >= 1);
  }));

test("enregistrement reussi : saveCell, mode « both », onChange, cellule en memoire", () =>
  withLocalStorage(async (store) => {
    persistSmoothingView("raw");
    const { controller, spies, saved, changes } = build();
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    const outcome = await spies.smoothing.options.onSubmit({ maxTotal: 2, maxByType: {} });
    assert.deepEqual(outcome, { ok: true });
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0], 7);
    assert.deepEqual(JSON.parse(saved[0][1]), { version: 1, services: { Structure: { maxTotal: 2, maxParType: {} } } });
    assert.equal(store.get("planning-synchro.smoothing-view"), "both");
    assert.equal(changes.length, 1);
    const input = controller.getChartInput();
    assert.equal(input.active, true);
    assert.equal(input.mode, "both");
    // cellule en memoire : un refresh avec la meme valeur ne change rien
    assert.equal(controller.refreshFromProjectRows([{ id: 7, Lissage: saved[0][1] }]), false);
  }));

test("enregistrement en echec : message, rien de change", () =>
  withLocalStorage(async (store) => {
    persistSmoothingView("raw");
    const { controller, spies, changes } = build({
      saveCell: async () => {
        throw new Error("reseau");
      },
    });
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    const outcome = await spies.smoothing.options.onSubmit({ maxTotal: 2, maxByType: {} });
    assert.deepEqual(outcome, { ok: false, error: "L'enregistrement du lissage a échoué. Réessayez." });
    assert.equal(changes.length, 0);
    assert.equal(store.get("planning-synchro.smoothing-view"), "raw");
    assert.equal(controller.getChartInput().active, false);
  }));

test("suppression : cellule sans l'entree du service, chaine vide s'il n'en reste aucune", () =>
  withLocalStorage(async () => {
    const a = build();
    a.controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    assert.deepEqual(await a.spies.smoothing.options.onDelete(), { ok: true });
    assert.deepEqual(a.saved, [[7, ""]]);
    assert.equal(a.controller.getChartInput().active, false);
    assert.equal(a.changes.length, 1);

    const both = JSON.stringify({ version: 1, services: { Structure: { maxTotal: 2, maxParType: {} }, Autre: { maxTotal: 7, maxParType: {} } } });
    const b = build();
    b.controller.setProjectData(data({ id: 7, Lissage: both }));
    await b.spies.smoothing.options.onDelete();
    assert.deepEqual(Object.keys(JSON.parse(b.saved[0][1]).services), ["Autre"]);
  }));

test("ruling 10 : la cellule est relue avant d'ecrire, l'autre service est conserve", () =>
  withLocalStorage(async () => {
    const loaded = [];
    const { controller, spies, saved } = build({
      loadProjectRow: async (projectId) => {
        loaded.push(projectId);
        return { id: 7, Lissage: CELL_OTHER };
      },
    });
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} });
    assert.deepEqual(loaded, [7]);
    const services = JSON.parse(saved[0][1]).services;
    assert.equal(services.Autre.maxTotal, 7);
    assert.equal(services.Structure.maxTotal, 3);
  }));

test("ruling 10 : relecture en echec ou nulle -> derniere valeur connue", () =>
  withLocalStorage(async () => {
    const failing = async () => {
      throw new Error("x");
    };
    for (const loadProjectRow of [failing, async () => null]) {
      const { controller, spies, saved } = build({ loadProjectRow });
      controller.setProjectData(data({ id: 7, Lissage: CELL_OTHER }));
      await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} });
      const services = JSON.parse(saved[0][1]).services;
      assert.equal(services.Autre.maxTotal, 7);
      assert.equal(services.Structure.maxTotal, 3);
    }
  }));

test("refreshFromProjectRows : meme valeur -> false ; valeur differente -> true + onChange", () =>
  withLocalStorage(() => {
    const { controller, changes } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    assert.equal(controller.refreshFromProjectRows([{ id: 3, Lissage: "" }, { id: 7, Lissage: CELL_MAX2 }]), false);
    assert.equal(changes.length, 0);
    assert.equal(controller.refreshFromProjectRows([{ id: 7, Lissage: "" }]), true);
    assert.equal(changes.length, 1);
    assert.equal(controller.getChartInput().active, false);
    assert.equal(controller.refreshFromProjectRows([{ id: 99, Lissage: CELL_MAX2 }]), false);
    assert.equal(controller.refreshFromProjectRows(null), false);
  }));

test("clic sur « Lissé » : mode memorise et onChange", () =>
  withLocalStorage((store) => {
    const { controller, els, smoothedBtn, changes } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.displayGroup.click(smoothedBtn);
    assert.equal(store.get("planning-synchro.smoothing-view"), "smoothed");
    assert.equal(changes.length, 1);
    assert.equal(controller.getChartInput().mode, "smoothed");
    assert.equal(smoothedBtn.classList.contains("is-active"), true);
  }));

test("Tâches du mois : le modele suit le mode et les types coches", () =>
  withLocalStorage(() => {
    persistSmoothingView("smoothed");
    const { controller, calls } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    controller.openMonthTasks({ startIso: "2026-11-01", endIso: "2026-12-01", label: "novembre 2026", granularity: "month", visibleTypeKeys: ["COFFRAGE"] });
    const model = calls.month.find((c) => c[0] === "open")[1];
    assert.match(model.title, /novembre 2026/);
    assert.match(model.title, /lissé/);
  }));

test("clear et destroy : fenetres fermees puis detruites", () =>
  withLocalStorage(() => {
    const { controller, els, calls } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    controller.clear();
    assert.ok(calls.smoothing.some((c) => c[0] === "close"));
    assert.equal(controller.getChartInput().active, false);
    assert.equal(els.openButton.disabled, true);
    controller.destroy();
    assert.ok(calls.smoothing.some((c) => c[0] === "destroy"));
    assert.ok(calls.month.some((c) => c[0] === "destroy"));
    assert.equal((els.displayGroup.listeners.get("click") || []).length, 0);
  }));

test("le service change pendant la relecture : l'entree du service d'origine est ecrite", () =>
  withLocalStorage(async () => {
    let service = "Structure";
    const { controller, spies, saved } = build({
      getService: () => service,
      loadProjectRow: async () => {
        service = "Autre";
        return { id: 7, Lissage: CELL_OTHER };
      },
    });
    controller.setProjectData(data({ id: 7, Lissage: CELL_OTHER }));
    await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} });
    const services = JSON.parse(saved[0][1]).services;
    assert.equal(services.Autre.maxTotal, 7);
    assert.equal(services.Structure.maxTotal, 3);
  }));

test("setProjectData du meme projet (autre objet) pendant l'ecriture : mise a jour locale conservee", () =>
  withLocalStorage(async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { controller, spies, changes } = build({ saveCell: async () => gate });
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    const pending = spies.smoothing.options.onSubmit({ maxTotal: 2, maxByType: {} });
    controller.setProjectData(data({ id: 7, Lissage: "" }, { project: { id: 7, name: "Projet X" } }));
    release();
    assert.deepEqual(await pending, { ok: true });
    assert.equal(changes.length, 1);
    assert.equal(controller.getChartInput().active, true);
  }));

test("verrou : second enregistrement refuse, et setProjectData rafraichit au lieu de rouvrir", () =>
  withLocalStorage(async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const written = [];
    const { controller, els, spies, calls } = build({
      saveCell: async (id, value) => {
        written.push([id, value]);
        await gate;
      },
    });
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    els.openButton.click();
    const first = spies.smoothing.options.onSubmit({ maxTotal: 2, maxByType: {} });
    const second = await spies.smoothing.options.onSubmit({ maxTotal: 5, maxByType: {} });
    const third = await spies.smoothing.options.onDelete();
    assert.equal(second.ok, false);
    assert.equal(third.ok, false);
    assert.ok(second.error);
    // types changes pendant l'ecriture : refresh, pas open
    const opensBefore = calls.smoothing.filter((c) => c[0] === "open").length;
    controller.setProjectData(data({ id: 7, Lissage: "" }, { tasks: [...TASKS, task(9, "NDC", "2026-11-20")] }));
    assert.equal(calls.smoothing.filter((c) => c[0] === "open").length, opensBefore);
    assert.ok(calls.smoothing.some((c) => c[0] === "refresh"));
    release();
    assert.deepEqual(await first, { ok: true });
    assert.equal(written.length, 1);
    // le verrou est libere
    assert.deepEqual(await spies.smoothing.options.onDelete(), { ok: true });
    assert.equal(written.length, 2);
  }));

test("suppression : le mode memorise n'est pas force a « both »", () =>
  withLocalStorage(async (store) => {
    persistSmoothingView("raw");
    const { controller, spies, changes } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    await spies.smoothing.options.onDelete();
    assert.equal(store.get("planning-synchro.smoothing-view"), "raw");
    assert.equal(changes.length, 1);
    // un enregistrement avec maximum, lui, passe en « both »
    await spies.smoothing.options.onSubmit({ maxTotal: 2, maxByType: {} });
    assert.equal(store.get("planning-synchro.smoothing-view"), "both");
  }));

test("boutons « Afficher » : aria-pressed suit le mode", () =>
  withLocalStorage(() => {
    persistSmoothingView("smoothed");
    const { controller, els, rawBtn, smoothedBtn, bothBtn } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    assert.equal(smoothedBtn.attributes.get("aria-pressed"), "true");
    assert.equal(rawBtn.attributes.get("aria-pressed"), "false");
    els.displayGroup.click(bothBtn);
    assert.equal(bothBtn.attributes.get("aria-pressed"), "true");
    assert.equal(smoothedBtn.attributes.get("aria-pressed"), "false");
  }));

// index.html reste en cache sans les nouveaux blocs : ni en-tete (groupe
// « Afficher », bouton « Lisser… ») ni fenetres. Le controleur est cree au
// demarrage, AVANT bootstrap() : une exception ici laisserait tout le widget
// blanc. Les VRAIES fenetres sont utilisees (pas d'espions), sur des elements
// absents.
test("balisage absent : controleur et vraies fenetres inertes, aucune exception", () =>
  withLocalStorage(() => {
    const variants = [
      undefined,
      {},
      { displayGroup: null, openButton: null, smoothingModalEl: null, monthTasksModalEl: null },
    ];
    for (const els of variants) {
      let controller = null;
      assert.doesNotThrow(() => {
        controller = createSmoothingController({
          els,
          saveCell: async () => {},
          getService: () => "Structure",
          isReadOnly: () => false,
          todayIso: () => TODAY,
        });
      });
      assert.doesNotThrow(() => {
        controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
        assert.equal(controller.getChartInput().active, true, "le lissage enregistre reste trace");
        controller.openMonthTasks({ startIso: "2026-11-01", endIso: "2026-12-01", label: "novembre 2026", granularity: "month", visibleTypeKeys: [] });
        controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
        controller.refreshFromProjectRows([{ id: 7, Lissage: "" }]);
        controller.clear();
        controller.destroy();
      });
    }
  }));

// --- lecture de Projets2 impossible (projectRow === null) ----------------------

const READ_FAILED_TITLE = "Lecture de Projets2 impossible : rechargez le projet.";
const READ_FAILED_SAVE_ERROR = "Lecture de Projets2 impossible : l'enregistrement est annulé. Réessayez.";

// main.js passe projectRow = null quand la relecture de Projets2 echoue (erreur
// REST passagere, table rendue vide). Ce n'est PAS « colonne absente » : au
// rechargement du meme projet, le lissage actif ne doit pas disparaitre.
test("lecture impossible, meme contexte : cellule et colonne deja connues gardees", () =>
  withLocalStorage(() => {
    const { controller, els, calls } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.openButton.click();
    calls.smoothing.length = 0;

    controller.setProjectData(data(null));
    assert.equal(controller.getChartInput().active, true, "le lissage actif reste trace");
    assert.equal(els.openButton.disabled, false);
    assert.equal(els.openButton.title, "");
    assert.equal(els.displayGroup.hidden, false);
    assert.ok(!calls.smoothing.some((c) => c[0] === "close"), "la fenetre reste ouverte");
    assert.ok(calls.smoothing.some((c) => c[0] === "refresh"));
  }));

test("lecture impossible, autre contexte : bouton grise « rechargez le projet », pas de lissage", () =>
  withLocalStorage(() => {
    const { controller, els } = build();
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    controller.setProjectData(data(null, { contextKey: "8|Structure", project: { id: 8, name: "Projet Y" } }));
    assert.equal(els.openButton.disabled, true);
    assert.equal(els.openButton.title, READ_FAILED_TITLE);
    assert.equal(controller.getChartInput().active, false);
    assert.equal(els.displayGroup.hidden, true);

    // Rechargement du meme projet, lecture enfin reussie : tout revient.
    controller.setProjectData(data({ id: 8, Lissage: CELL_MAX2 }, { contextKey: "8|Structure", project: { id: 8, name: "Projet Y" } }));
    assert.equal(els.openButton.disabled, false);
    assert.equal(els.openButton.title, "");
    assert.equal(controller.getChartInput().active, true);
  }));

test("lecture impossible au premier chargement, puis signal Projets2 : l'etat se retablit", () =>
  withLocalStorage(() => {
    const a = build();
    a.controller.setProjectData(data(null));
    assert.equal(a.els.openButton.title, READ_FAILED_TITLE);
    // Meme contexte, lecture toujours impossible : le message reste.
    a.controller.setProjectData(data(null));
    assert.equal(a.els.openButton.title, READ_FAILED_TITLE);
    assert.equal(a.controller.refreshFromProjectRows([{ id: 7, Lissage: CELL_MAX2 }]), true);
    assert.equal(a.els.openButton.disabled, false);
    assert.equal(a.els.openButton.title, "");
    assert.equal(a.controller.getChartInput().active, true);

    // Ligne relue sans la colonne : c'est bien « colonne absente », plus « rechargez ».
    const b = build();
    b.controller.setProjectData(data(null));
    b.controller.refreshFromProjectRows([{ id: 7, Nom_de_projet: "X" }]);
    assert.equal(b.els.openButton.disabled, true);
    assert.equal(b.els.openButton.title, NO_COLUMN_TITLE);
  }));

test("cellule jamais lue et relecture en echec ou nulle : ecriture refusee, rien n'est ecrit", () =>
  withLocalStorage(async () => {
    const failing = async () => {
      throw new Error("REST indisponible");
    };
    for (const loadProjectRow of [failing, async () => null]) {
      const { controller, spies, saved, changes } = build({ loadProjectRow });
      controller.setProjectData(data(null));
      for (const action of [
        () => spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} }),
        () => spies.smoothing.options.onDelete(),
      ]) {
        assert.deepEqual(await action(), { ok: false, error: READ_FAILED_SAVE_ERROR });
      }
      assert.deepEqual(saved, [], "une ecriture partie d'une cellule vide effacerait les autres services");
      assert.equal(changes.length, 0);
    }
  }));

test("cellule jamais lue mais relecture reussie : ecriture sur la cellule relue", () =>
  withLocalStorage(async () => {
    const { controller, spies, saved } = build({ loadProjectRow: async () => ({ id: 7, Lissage: CELL_OTHER }) });
    controller.setProjectData(data(null));
    assert.deepEqual(await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} }), { ok: true });
    const services = JSON.parse(saved[0][1]).services;
    assert.equal(services.Autre.maxTotal, 7);
    assert.equal(services.Structure.maxTotal, 3);
  }));

test("lecture impossible au rechargement, cellule deja lue : la relecture en echec garde la valeur connue", () =>
  withLocalStorage(async () => {
    const { controller, spies, saved } = build({
      loadProjectRow: async () => {
        throw new Error("REST indisponible");
      },
    });
    controller.setProjectData(data({ id: 7, Lissage: CELL_OTHER }));
    controller.setProjectData(data(null)); // meme contexte, lecture impossible
    assert.deepEqual(await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} }), { ok: true });
    const services = JSON.parse(saved[0][1]).services;
    assert.equal(services.Autre.maxTotal, 7, "l'entree de l'autre service n'est pas effacee");
    assert.equal(services.Structure.maxTotal, 3);
  }));

// --- ruling 16 : service fige a l'ouverture de la fenetre « Lissage » ----------

const SERVICE_CHANGED_ERROR = "Le service a changé : fermez la fenêtre et recommencez.";

// La fenetre ne se ferme qu'a la fin du loadProject declenche par le changement
// de service : entre-temps, « Enregistrer » ecrirait la saisie faite pour le
// service d'origine dans l'entree du nouveau service.
test("ruling 16 : service change fenetre ouverte -> enregistrement et suppression refuses", () =>
  withLocalStorage(async () => {
    let service = "Structure";
    const { controller, els, spies, saved, changes } = build({ getService: () => service });
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.openButton.click();
    service = "Autre";
    assert.deepEqual(await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} }), {
      ok: false,
      error: SERVICE_CHANGED_ERROR,
    });
    assert.deepEqual(await spies.smoothing.options.onDelete(), { ok: false, error: SERVICE_CHANGED_ERROR });
    assert.deepEqual(saved, []);
    assert.equal(changes.length, 0);

    // Retour au service d'origine, fenetre toujours ouverte : l'ecriture passe,
    // sur l'entree du service fige.
    service = "Structure";
    assert.deepEqual(await spies.smoothing.options.onSubmit({ maxTotal: 3, maxByType: {} }), { ok: true });
    assert.equal(JSON.parse(saved[0][1]).services.Structure.maxTotal, 3);
  }));

// Fenetre ouverte APRES le changement de service, avant la fin du loadProject :
// elle montre encore les reglages de l'ancien service. C'est ce service-la qui
// est fige, et l'enregistrement est refuse tant que le contexte n'a pas suivi.
test("ruling 16 : fenetre ouverte entre le changement de service et le rechargement -> refus", () =>
  withLocalStorage(async () => {
    let service = "Structure";
    const { controller, els, spies, saved, calls } = build({ getService: () => service });
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    service = "Autre";
    els.openButton.click();
    const ctx = calls.smoothing.find((c) => c[0] === "open")[1];
    assert.match(ctx.title, /Projet X · Structure/, "le titre nomme le service des reglages affiches");
    assert.equal(ctx.settings.maxTotal, 2);
    assert.deepEqual(await spies.smoothing.options.onSubmit({ maxTotal: 2, maxByType: {} }), {
      ok: false,
      error: SERVICE_CHANGED_ERROR,
    });
    assert.deepEqual(saved, []);
  }));

test("ruling 16 : la fenetre rouverte apres un changement de contexte fige le nouveau service", () =>
  withLocalStorage(async () => {
    let service = "Structure";
    const { controller, els, spies, saved } = build({ getService: () => service });
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }));
    els.openButton.click();
    service = "Autre";
    controller.setProjectData(data({ id: 7, Lissage: CELL_MAX2 }, { contextKey: "7|Autre" }));
    els.openButton.click();
    assert.deepEqual(await spies.smoothing.options.onSubmit({ maxTotal: 5, maxByType: {} }), { ok: true });
    const services = JSON.parse(saved[0][1]).services;
    assert.equal(services.Autre.maxTotal, 5);
    assert.equal(services.Structure.maxTotal, 2, "l'entree Structure est conservee");
  }));

// Bornes de la frise : un lissage qui avance des taches avant le planning doit
// pouvoir etre parcouru. Depart en juin, maximum 1 : les trois taches de
// novembre et celle d'octobre se repartissent d'aout a novembre.
test("getSmoothedBounds : mois des dates lissees quand le lissage est actif, null sinon", () =>
  withLocalStorage(() => {
    const { controller } = build();
    controller.setProjectData(data({ id: 7, Lissage: "" }));
    assert.equal(controller.getSmoothedBounds(), null);

    const cell = JSON.stringify({ version: 1, services: { Structure: { maxTotal: 1, maxParType: {}, debut: "2026-06" } } });
    controller.setProjectData(data({ id: 7, Lissage: cell }));
    assert.deepEqual(controller.getSmoothedBounds(), { startDate: "2026-08-01", endDate: "2026-11-30" });

    controller.clear();
    assert.equal(controller.getSmoothedBounds(), null);
  }));
