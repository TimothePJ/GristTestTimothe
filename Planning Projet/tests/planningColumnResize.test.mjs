import test from "node:test";
import assert from "node:assert/strict";

import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";
import { COLUMN_WIDTHS_STORAGE_KEY, PLANNING_COLUMNS } from "../assets/js/services/planningColumnWidths.js";
import { bindPlanningColumnResize } from "../assets/js/ui/planningColumnResize.js";

// Largeurs de la feuille de style (styles.css, :root).
const DEFAULTS = {
  id2: 52,
  task: 196,
  "ligne-planning": 84,
  start: 84,
  "duration-1": 64,
  end: 84,
  "duration-2": 64,
  demarrage: 100,
  indice: 60,
  realise: 190,
  retards: 64,
};

// Style en ligne de l'élément racine : seules les variables posées par le module y figurent.
function fakeStyle() {
  const values = new Map();
  return {
    values,
    setProperty: (name, value) => values.set(name, String(value)),
    removeProperty: (name) => values.delete(name),
    getPropertyValue: (name) => values.get(name) || "",
  };
}

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const stored = (widths) => ({ [COLUMN_WIDTHS_STORAGE_KEY]: JSON.stringify(widths) });

function setup({ storage = fakeStorage(), maxWidth = Infinity, fitWidths } = {}) {
  const env = createFakeEnvironment();
  const root = env.doc.documentElement;
  root.style = fakeStyle();
  const header = new FakeElement("div", "planning-header-left");
  const cells = new Map();
  PLANNING_COLUMNS.forEach(({ key }) => {
    cells.set(key, header.appendChild(new FakeElement("div", `hcol c-${key}`)));
  });
  const calls = [];
  const maxRequests = [];
  // Ordre des demandes faites au volet au début d'un glisser.
  const order = [];
  const api = bindPlanningColumnResize({
    header,
    root,
    doc: env.doc,
    storage,
    // Largeur affichée : celle posée en ligne, sinon celle de la feuille de style.
    readWidth: (key) => Number.parseFloat(root.style.getPropertyValue(`--col-${key}`)) || DEFAULTS[key],
    getMaxWidth: (request) => {
      maxRequests.push(request);
      order.push("max");
      return maxWidth;
    },
    fitWidths,
    onResizeStart: () => {
      calls.push("start");
      order.push("start");
    },
    onResize: (delta) => calls.push(["resize", delta]),
    onResizeEnd: ({ moved }) => calls.push(["end", moved]),
  });
  const handleOf = (key) => cells.get(key).children.find((child) => child.classList.contains("planning-col-resize"));
  const widthVar = (key) => root.style.getPropertyValue(`--col-${key}`);
  const storedWidths = () => {
    const raw = storage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    return raw == null ? null : JSON.parse(raw);
  };
  return { api, root, header, cells, calls, maxRequests, order, handleOf, widthVar, storedWidths, storage };
}

function drag(handle, fromX, toX) {
  dispatch(handle, "pointerdown", { button: 0, clientX: fromX, pointerId: 7 });
  dispatch(handle, "pointermove", { clientX: toX, pointerId: 7 });
}

test("chaque titre de colonne reçoit une poignée sur son bord", () => {
  const { handleOf } = setup();
  PLANNING_COLUMNS.forEach(({ key, label }) => {
    const handle = handleOf(key);
    assert.ok(handle, `pas de poignée pour ${key}`);
    assert.equal(handle.dataset.column, key);
    assert.ok(handle.title.includes(`« ${label} »`), `le titre de la poignée nomme la colonne ${key}`);
    assert.match(handle.title, /double-clic/);
  });
});

test("sans largeur mémorisée, les colonnes gardent celles de la feuille de style", () => {
  const { api, root } = setup();
  assert.equal(root.style.values.size, 0);
  assert.equal(api.hasCustomWidths(), false);
});

test("les largeurs mémorisées sont reprises à l'ouverture", () => {
  const { api, root, widthVar } = setup({ storage: fakeStorage(stored({ task: 260, retards: 90 })) });
  assert.equal(widthVar("task"), "260px");
  assert.equal(widthVar("retards"), "90px");
  assert.equal(root.style.values.size, 2);
  assert.equal(api.hasCustomWidths(), true);
});

test("glisser une poignée change la largeur de sa colonne, et de elle seule", () => {
  const { root, calls, handleOf, widthVar } = setup();
  drag(handleOf("task"), 252, 316);
  assert.equal(widthVar("task"), "260px");
  assert.equal(root.style.values.size, 1);
  assert.deepEqual(calls, ["start", ["resize", 64]]);
});

test("pendant le glisser, la poignée garde le pointeur et la page montre le curseur de largeur", () => {
  const { root, handleOf } = setup();
  const handle = handleOf("task");
  const down = dispatch(handle, "pointerdown", { button: 0, clientX: 252, pointerId: 7 });
  assert.equal(down.defaultPrevented, true, "pas de sélection de texte en glissant");
  assert.ok(handle.captures.has(7));
  assert.ok(root.classList.contains("is-planning-col-resizing"));
  dispatch(handle, "pointerup", { clientX: 252, pointerId: 7 });
  assert.equal(root.classList.contains("is-planning-col-resizing"), false);
});

test("relâcher mémorise la largeur et termine le glisser", () => {
  const { calls, handleOf, widthVar, storedWidths, api } = setup({ storage: fakeStorage(stored({ start: 100 })) });
  const handle = handleOf("task");
  drag(handle, 252, 316);
  dispatch(handle, "pointerup", { clientX: 316, pointerId: 7 });
  assert.deepEqual(storedWidths(), { start: 100, task: 260 });
  assert.deepEqual(calls.at(-1), ["end", true]);
  assert.equal(api.hasCustomWidths(), true);
  // Le pointeur relâché ne déplace plus rien.
  dispatch(handle, "pointermove", { clientX: 500, pointerId: 7 });
  assert.equal(widthVar("task"), "260px");
  assert.equal(calls.filter((call) => call === "start").length, 1);
});

test("un glisser interrompu garde la largeur atteinte", () => {
  const { calls, handleOf, storedWidths } = setup();
  const handle = handleOf("task");
  drag(handle, 252, 300);
  dispatch(handle, "pointercancel", { pointerId: 7 });
  assert.deepEqual(storedWidths(), { task: 244 });
  assert.deepEqual(calls.at(-1), ["end", true]);
});

test("une colonne ne descend pas sous la largeur minimale", () => {
  const { calls, handleOf, widthVar } = setup();
  drag(handleOf("task"), 252, -900);
  assert.equal(widthVar("task"), "36px");
  assert.deepEqual(calls.at(-1), ["resize", -160]);
});

test("une colonne ne dépasse pas la largeur permise, demandée pour sa colonne au début du glisser", () => {
  const { cells, calls, maxRequests, handleOf, widthVar } = setup({ maxWidth: 300 });
  drag(handleOf("task"), 252, 900);
  assert.equal(widthVar("task"), "300px");
  assert.deepEqual(calls.at(-1), ["resize", 104]);
  assert.deepEqual(maxRequests, [{ key: "task", width: 196, cell: cells.get("task") }]);
});

test("un mouvement qui ne change pas la largeur ne signale rien", () => {
  const { calls, handleOf } = setup({ maxWidth: 300 });
  const handle = handleOf("task");
  drag(handle, 252, 900);
  dispatch(handle, "pointermove", { clientX: 950, pointerId: 7 });
  assert.deepEqual(calls, ["start", ["resize", 104]]);
});

test("un clic sans glisser ne règle ni ne mémorise rien", () => {
  const { root, calls, handleOf, storedWidths } = setup();
  const handle = handleOf("task");
  dispatch(handle, "pointerdown", { button: 0, clientX: 252, pointerId: 7 });
  dispatch(handle, "pointerup", { clientX: 252, pointerId: 7 });
  assert.equal(root.style.values.size, 0);
  assert.equal(storedWidths(), null);
  assert.deepEqual(calls, ["start", ["end", false]]);
});

test("le bouton droit ne lance pas de glisser", () => {
  const { root, calls, handleOf } = setup();
  const handle = handleOf("task");
  dispatch(handle, "pointerdown", { button: 2, clientX: 252, pointerId: 7 });
  dispatch(handle, "pointermove", { clientX: 316, pointerId: 7 });
  assert.equal(root.style.values.size, 0);
  assert.deepEqual(calls, []);
});

test("un appui sur le titre, hors de la poignée, ne lance pas de glisser", () => {
  const { root, cells, calls } = setup();
  dispatch(cells.get("task"), "pointerdown", { button: 0, clientX: 100, pointerId: 7 });
  dispatch(cells.get("task"), "dblclick", {});
  assert.equal(root.style.values.size, 0);
  assert.deepEqual(calls, []);
});

test("un double-clic sur la poignée rend à la colonne sa largeur par défaut", () => {
  const { calls, handleOf, widthVar, storedWidths } = setup({ storage: fakeStorage(stored({ task: 260, start: 100 })) });
  dispatch(handleOf("task"), "dblclick", {});
  assert.equal(widthVar("task"), "");
  assert.equal(widthVar("start"), "100px");
  assert.deepEqual(storedWidths(), { start: 100 });
  assert.deepEqual(calls, ["start", ["resize", -64], ["end", true]]);
});

test("la dernière colonne remise par défaut vide le stockage", () => {
  const { api, handleOf, storedWidths } = setup({ storage: fakeStorage(stored({ task: 260 })) });
  dispatch(handleOf("task"), "dblclick", {});
  assert.equal(storedWidths(), null);
  assert.equal(api.hasCustomWidths(), false);
});

test("un double-clic sur une colonne déjà par défaut ne signale aucun changement", () => {
  const { calls, handleOf } = setup();
  dispatch(handleOf("task"), "dblclick", {});
  assert.deepEqual(calls, []);
});

test("un stockage indisponible n'empêche pas de régler les colonnes", () => {
  const broken = {
    getItem() {
      throw new Error("stockage refusé");
    },
    setItem() {
      throw new Error("stockage refusé");
    },
    removeItem() {
      throw new Error("stockage refusé");
    },
  };
  const { calls, handleOf, widthVar } = setup({ storage: broken });
  const handle = handleOf("task");
  drag(handle, 252, 316);
  dispatch(handle, "pointerup", { clientX: 316, pointerId: 7 });
  assert.equal(widthVar("task"), "260px");
  assert.deepEqual(calls.at(-1), ["end", true]);
  dispatch(handle, "dblclick", {});
  assert.equal(widthVar("task"), "");
});

test("sans stockage du tout, les colonnes se règlent pour la session", () => {
  const { handleOf, widthVar } = setup({ storage: null });
  const handle = handleOf("indice");
  drag(handle, 800, 830);
  dispatch(handle, "pointerup", { clientX: 830, pointerId: 7 });
  assert.equal(widthVar("indice"), "90px");
});

// La largeur permise dépend de la place du volet, relevée au début du glisser.
test("l'état du volet est relevé avant de demander la largeur permise", () => {
  const { order, handleOf } = setup();
  dispatch(handleOf("task"), "pointerdown", { button: 0, clientX: 252, pointerId: 7 });
  assert.deepEqual(order, ["start", "max"]);
});

// Colonne élargie sur un grand écran, planning rouvert dans une fenêtre étroite : la largeur
// affichée est ramenée à ce qui tient, la largeur mémorisée reste celle de l'utilisateur.
test("à l'ouverture, les largeurs mémorisées sont ajustées à la fenêtre sans être réécrites", () => {
  const requests = [];
  const { widthVar, storedWidths } = setup({
    storage: fakeStorage(stored({ task: 1540, realise: 100 })),
    fitWidths: (request) => {
      requests.push(request);
      return { task: 720, realise: 100 };
    },
  });
  assert.equal(widthVar("task"), "720px");
  assert.equal(widthVar("realise"), "100px");
  assert.deepEqual(requests, [{ custom: { task: 1540, realise: 100 }, defaults: DEFAULTS }]);
  assert.deepEqual(storedWidths(), { task: 1540, realise: 100 });
});

test("réajuster relit les largeurs d'origine sans les réglages, puis réapplique", () => {
  let room = 720;
  const defaultsSeen = [];
  const { api, widthVar, storedWidths } = setup({
    storage: fakeStorage(stored({ task: 1540 })),
    fitWidths: ({ custom, defaults }) => {
      defaultsSeen.push(defaults);
      return { task: Math.min(custom.task, room) };
    },
  });
  assert.equal(widthVar("task"), "720px");
  // Fenêtre agrandie : la largeur de l'utilisateur revient.
  room = 2000;
  api.refit();
  assert.equal(widthVar("task"), "1540px");
  assert.deepEqual(defaultsSeen[1], DEFAULTS, "les largeurs d'origine se lisent sans les réglages posés");
  assert.deepEqual(storedWidths(), { task: 1540 });
});

test("sans colonne réglée, réajuster ne fait rien", () => {
  let fits = 0;
  const { api, root } = setup({
    fitWidths: () => {
      fits += 1;
      return {};
    },
  });
  api.refit();
  assert.equal(fits, 0);
  assert.equal(root.style.values.size, 0);
});

test("un clic sur la poignée d'une colonne retenue garde la largeur mémorisée", () => {
  const { handleOf, widthVar, storedWidths } = setup({
    storage: fakeStorage(stored({ task: 1540 })),
    fitWidths: () => ({ task: 720 }),
  });
  const handle = handleOf("task");
  dispatch(handle, "pointerdown", { button: 0, clientX: 776, pointerId: 7 });
  dispatch(handle, "pointerup", { clientX: 776, pointerId: 7 });
  assert.equal(widthVar("task"), "720px");
  assert.deepEqual(storedWidths(), { task: 1540 });
});

test("régler une colonne retenue part de la largeur affichée et mémorise la nouvelle", () => {
  const { handleOf, widthVar, storedWidths } = setup({
    storage: fakeStorage(stored({ task: 1540 })),
    fitWidths: () => ({ task: 720 }),
  });
  const handle = handleOf("task");
  drag(handle, 776, 676);
  dispatch(handle, "pointerup", { clientX: 676, pointerId: 7 });
  assert.equal(widthVar("task"), "620px");
  assert.deepEqual(storedWidths(), { task: 620 });
});

// Le volet a suivi la colonne pendant le glisser : même revenue à sa largeur, il faut le signaler
// pour que la timeline soit redessinée. Rien n'est mémorisé et la colonne suit de nouveau la feuille de style.
test("un glisser revenu à sa largeur de départ a bougé, mais ne règle ni ne mémorise rien", () => {
  const { calls, handleOf, widthVar, storedWidths } = setup();
  const handle = handleOf("task");
  drag(handle, 252, 316);
  dispatch(handle, "pointermove", { clientX: 252, pointerId: 7 });
  dispatch(handle, "pointerup", { clientX: 252, pointerId: 7 });
  assert.deepEqual(calls, ["start", ["resize", 64], ["resize", 0], ["end", true]]);
  assert.equal(widthVar("task"), "");
  assert.equal(storedWidths(), null);
});

test("un glisser revenu à sa largeur de départ garde le réglage qu'avait la colonne", () => {
  const { handleOf, widthVar, storedWidths } = setup({ storage: fakeStorage(stored({ task: 260 })) });
  const handle = handleOf("task");
  drag(handle, 316, 400);
  dispatch(handle, "pointermove", { clientX: 316, pointerId: 7 });
  dispatch(handle, "pointerup", { clientX: 316, pointerId: 7 });
  assert.equal(widthVar("task"), "260px");
  assert.deepEqual(storedWidths(), { task: 260 });
});

// Relâchement jamais reçu (capture refusée, bouton lâché hors de la fenêtre) : sans ces gardes, le
// simple survol de la poignée continuerait de régler la colonne.
test("un mouvement sans bouton enfoncé termine le glisser", () => {
  const { root, calls, handleOf, widthVar, storedWidths } = setup();
  const handle = handleOf("task");
  drag(handle, 252, 316);
  dispatch(handle, "pointermove", { clientX: 500, buttons: 0, pointerId: 7 });
  assert.equal(widthVar("task"), "260px");
  assert.deepEqual(calls.at(-1), ["end", true]);
  assert.deepEqual(storedWidths(), { task: 260 });
  assert.equal(root.classList.contains("is-planning-col-resizing"), false);
});

test("la capture du pointeur perdue termine le glisser, une seule fois", () => {
  const { calls, handleOf, storedWidths } = setup();
  const handle = handleOf("task");
  drag(handle, 252, 316);
  dispatch(handle, "lostpointercapture", { pointerId: 7 });
  dispatch(handle, "pointerup", { clientX: 316, pointerId: 7 });
  assert.deepEqual(calls, ["start", ["resize", 64], ["end", true]]);
  assert.deepEqual(storedWidths(), { task: 260 });
});

test("un nouvel appui termine d'abord le glisser resté ouvert", () => {
  const { calls, handleOf, storedWidths } = setup();
  drag(handleOf("task"), 252, 316);
  dispatch(handleOf("start"), "pointerdown", { button: 0, clientX: 500, pointerId: 8 });
  assert.deepEqual(calls, ["start", ["resize", 64], ["end", true], "start"]);
  assert.deepEqual(storedWidths(), { task: 260 });
});
