import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createSyntheseGantt } from "../assets/js/ui/syntheseGantt.js";
import { currentWeekWindow, panWindow, zoomWindow } from "../assets/js/services/syntheseGanttGeometry.js";

// DOM minimal : seulement ce que le Gantt utilise (arbre, classes, écouteurs, capture).
class FakeElement {
  constructor(tag = "div", className = "") {
    this.tagName = tag;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set(className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
    this.style = {};
    this.textContent = "";
    this.clientWidth = 0;
    this.rectLeft = 0;
    this.captures = new Set();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  closest(selector) {
    const name = selector.replace(/^\./, "");
    for (let node = this; node; node = node.parentNode) {
      if (node.classes.has(name)) return node;
    }
    return null;
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  getBoundingClientRect() {
    return { left: this.rectLeft, top: 0, width: this.clientWidth, right: this.rectLeft + this.clientWidth, height: 0 };
  }

  setPointerCapture(pointerId) {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
  }
}

// Évènement qui remonte de la cible jusqu'à la racine, comme dans le navigateur.
function dispatch(target, type, init = {}) {
  const event = {
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...init,
  };
  for (let node = target; node; node = node.parentNode) {
    (node.listeners.get(type) || []).forEach((listener) => listener(event));
  }
  return event;
}

const day = (year, month, date) => new Date(year, month - 1, date);
// Semaine du lun 14/09/2026 au lun 21/09/2026, panneau droit de 400 px.
const WINDOW = { start: day(2026, 9, 14), end: day(2026, 9, 21) };
const ZONE = {
  key: "zone:a",
  kind: "zone",
  level: 0,
  zoneKey: "a",
  zoneName: "Zone A",
  taskId: null,
  name: "Zone A",
  start: day(2026, 9, 15),
  end: day(2026, 9, 17),
  durationDays: 3,
  isMilestone: false,
  startsWithMilestone: false,
  endsWithMilestone: false,
  collapsed: false,
  childCount: 1,
};

afterEach(() => {
  delete globalThis.Element;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.ResizeObserver;
});

function setup({ width = 400, hasPlanningWindow = true } = {}) {
  const frames = [];
  globalThis.Element = FakeElement;
  globalThis.document = { createElementNS: (_namespace, tag) => new FakeElement(tag) };
  globalThis.window = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  };
  // Même arbre que le tableau : en-tête (gauche, échelle), corps (lignes), couche du Gantt.
  const scroller = new FakeElement("div", "stt-scroll");
  const head = scroller.appendChild(new FakeElement("div", "stt-line stt-line--head"));
  head.appendChild(new FakeElement("div", "stt-left"));
  const headRight = head.appendChild(new FakeElement("div", "stt-right stt-right--head"));
  const body = scroller.appendChild(new FakeElement("div", "stt-body"));
  const row = body.appendChild(new FakeElement("div", "stt-line stt-line--zone"));
  const rowLeft = row.appendChild(new FakeElement("div", "stt-left"));
  const rowRight = row.appendChild(new FakeElement("div", "stt-right"));
  const layer = scroller.appendChild(new FakeElement("div", "stt-gantt-layer"));
  layer.clientWidth = width;

  const calls = [];
  const listeners = [];
  let current = WINDOW;
  const gantt = createSyntheseGantt({ headHost: headRight, layerHost: layer, interactionHost: scroller }, {
    getWindow: () => (hasPlanningWindow ? current : null),
    setWindow: (start, end) => {
      calls.push({ start, end });
      if (hasPlanningWindow) current = { start, end };
    },
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {};
    },
    now: () => new Date(2026, 8, 16, 12),
  });
  return { gantt, frames, calls, listeners, scroller, headRight, rowLeft, rowRight, layer };
}

const scaleSvg = (context) => context.headRight.children[0];
const layerSvg = (context) => context.layer.children[0];

test("molette seule sur les lignes : défilement normal du tableau, pas de zoom", () => {
  const { calls, rowRight } = setup();
  const event = dispatch(rowRight, "wheel", { deltaY: 100, deltaMode: 0, ctrlKey: false, clientX: 200 });
  assert.equal(event.defaultPrevented, false);
  assert.equal(calls.length, 0);
});

test("Ctrl + molette : un cran = un pas de zoom centré sous le curseur", () => {
  const { calls, rowRight } = setup();
  const event = dispatch(rowRight, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 100 });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, [zoomWindow(WINDOW, 0.25, true)]);
});

test("pavé tactile : les petits deltas s'additionnent jusqu'à un cran", () => {
  const { calls, rowRight } = setup();
  const events = [1, 2, 3].map(() => dispatch(rowRight, "wheel", { deltaY: -25, deltaMode: 0, ctrlKey: true, clientX: 200 }));
  assert.ok(events.every((event) => event.defaultPrevented));
  assert.equal(calls.length, 0);
  dispatch(rowRight, "wheel", { deltaY: -25, deltaMode: 0, ctrlKey: true, clientX: 200 });
  assert.deepEqual(calls, [zoomWindow(WINDOW, 0.5, true)]);
});

test("molette sur l'échelle, sans Ctrl : zoom arrière", () => {
  const context = setup();
  dispatch(scaleSvg(context), "wheel", { deltaY: 100, deltaMode: 0, ctrlKey: false, clientX: 200 });
  assert.deepEqual(context.calls, [zoomWindow(WINDOW, 0.5, false)]);
});

test("glisser dans le panneau droit : la date saisie reste sous le curseur", () => {
  const { calls, scroller, rowRight } = setup();
  const down = dispatch(rowRight, "pointerdown", { button: 0, buttons: 1, pointerId: 7, clientX: 300 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(scroller.classList.contains("is-panning"), true);
  assert.equal(scroller.captures.has(7), true);
  dispatch(scroller, "pointermove", { pointerId: 7, buttons: 1, clientX: 200 });
  dispatch(scroller, "pointermove", { pointerId: 7, buttons: 1, clientX: 100 });
  assert.deepEqual(calls, [panWindow(WINDOW, -100, 400), panWindow(WINDOW, -200, 400)]);
  dispatch(scroller, "pointerup", { pointerId: 7, buttons: 0, clientX: 100 });
  assert.equal(scroller.classList.contains("is-panning"), false);
  assert.equal(scroller.captures.has(7), false);
  dispatch(scroller, "pointermove", { pointerId: 7, buttons: 0, clientX: 50 });
  assert.equal(calls.length, 2);
});

test("glisser : bouton relâché sans pointerup ou capture perdue, le glisser s'arrête", () => {
  const { calls, scroller, rowRight } = setup();
  dispatch(rowRight, "pointerdown", { button: 0, buttons: 1, pointerId: 3, clientX: 300 });
  dispatch(scroller, "pointermove", { pointerId: 3, buttons: 0, clientX: 250 });
  assert.equal(calls.length, 0);
  assert.equal(scroller.classList.contains("is-panning"), false);
  dispatch(scroller, "pointermove", { pointerId: 3, buttons: 1, clientX: 200 });
  assert.equal(calls.length, 0);

  dispatch(rowRight, "pointerdown", { button: 0, buttons: 1, pointerId: 4, clientX: 300 });
  dispatch(scroller, "lostpointercapture", { pointerId: 4 });
  assert.equal(scroller.classList.contains("is-panning"), false);
  dispatch(scroller, "pointermove", { pointerId: 4, buttons: 1, clientX: 200 });
  assert.equal(calls.length, 0);
});

test("clic dans le tableau de gauche ou clic droit : pas de glisser", () => {
  const { calls, scroller, rowLeft, rowRight } = setup();
  const left = dispatch(rowLeft, "pointerdown", { button: 0, buttons: 1, pointerId: 1, clientX: 50 });
  const right = dispatch(rowRight, "pointerdown", { button: 2, buttons: 2, pointerId: 2, clientX: 300 });
  assert.equal(left.defaultPrevented, false);
  assert.equal(right.defaultPrevented, false);
  assert.equal(scroller.classList.contains("is-panning"), false);
  dispatch(scroller, "pointermove", { pointerId: 1, buttons: 1, clientX: 10 });
  assert.equal(calls.length, 0);
});

test("un seul dessin par image ; panneau masqué : rien n'est dessiné", () => {
  const context = setup({ width: 0 });
  const { gantt, frames, listeners, layer } = context;
  gantt.render([ZONE]);
  gantt.resize();
  listeners.forEach((listener) => listener());
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(layer.style.height, "26px");
  assert.equal(layerSvg(context).children.length, 0);
  assert.equal(scaleSvg(context).children.length, 0);

  layer.clientWidth = 400;
  gantt.resize();
  assert.equal(frames.length, 1);
  frames.shift()();
  const classes = layerSvg(context).children.map((node) => node.getAttribute("class"));
  assert.ok(classes.includes("stg-off"));
  assert.ok(classes.includes("stg-today"));
  assert.ok(classes.includes("stg-zone"));
  assert.ok(scaleSvg(context).children.length > 0);
});

test("un changement de largeur du panneau redessine, pas un changement de hauteur", () => {
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe(target) {
      this.target = target;
    }
  };
  const { frames, layer } = setup();
  assert.equal(observers.length, 1);
  assert.equal(observers[0].target, layer);
  observers[0].callback([{ contentRect: { width: 400, height: 0 } }]);
  assert.equal(frames.length, 1);
  frames.shift()();
  observers[0].callback([{ contentRect: { width: 400, height: 26 } }]);
  assert.equal(frames.length, 0);
  observers[0].callback([{ contentRect: { width: 380, height: 26 } }]);
  assert.equal(frames.length, 1);
});

test("planning sans période : le Gantt part de la semaine en cours et garde sa propre période", () => {
  const { calls, frames, scroller, rowRight } = setup({ hasPlanningWindow: false });
  const week = currentWeekWindow(new Date(2026, 8, 16, 12));
  dispatch(rowRight, "pointerdown", { button: 0, buttons: 1, pointerId: 5, clientX: 300 });
  dispatch(scroller, "pointermove", { pointerId: 5, buttons: 1, clientX: 200 });
  const moved = panWindow(week, -100, 400);
  assert.deepEqual(calls, [moved]);
  assert.equal(frames.length, 1);
  dispatch(scroller, "pointerup", { pointerId: 5, buttons: 0, clientX: 200 });
  dispatch(rowRight, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 100 });
  assert.deepEqual(calls[1], zoomWindow(moved, 0.25, true));
});

test("Ctrl + molette sur le tableau de gauche : pas de zoom du Gantt", () => {
  const { calls, rowLeft } = setup();
  const event = dispatch(rowLeft, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 50 });
  assert.equal(event.defaultPrevented, false);
  assert.equal(calls.length, 0);
});

test("un grand delta de molette : plusieurs pas de zoom en un seul évènement, même point fixe", () => {
  const { calls, rowRight } = setup();
  dispatch(rowRight, "wheel", { deltaY: -250, deltaMode: 0, ctrlKey: true, clientX: 100 });
  assert.deepEqual(calls, [zoomWindow(zoomWindow(WINDOW, 0.25, true), 0.25, true)]);
});

test("zone vide sous les lignes, à l'aplomb du Gantt : Ctrl + molette zoome, glisser déplace", () => {
  const { calls, scroller, layer } = setup();
  layer.rectLeft = 300;
  const wheel = dispatch(scroller, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 400 });
  assert.equal(wheel.defaultPrevented, true);
  assert.deepEqual(calls, [zoomWindow(WINDOW, 0.25, true)]);
  const down = dispatch(scroller, "pointerdown", { button: 0, buttons: 1, pointerId: 9, clientX: 500 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(scroller.classList.contains("is-panning"), true);
});

test("zone vide hors du Gantt (sous le tableau de gauche, barre de défilement) : rien", () => {
  const { calls, scroller, layer } = setup();
  layer.rectLeft = 300;
  const left = dispatch(scroller, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 250 });
  const bar = dispatch(scroller, "pointerdown", { button: 0, buttons: 1, pointerId: 9, clientX: 705 });
  assert.equal(left.defaultPrevented, false);
  assert.equal(bar.defaultPrevented, false);
  assert.equal(calls.length, 0);
  assert.equal(scroller.classList.contains("is-panning"), false);
});

test("étages et flèches dessinés : crochet, trait et pointe, sous les barres", () => {
  const context = setup();
  const floorLine = { ...ZONE, key: "floor:a/f", kind: "floor", level: 1, floorKey: "f", floorName: "PH RDB", name: "PH RDB" };
  const first = {
    ...ZONE,
    key: "task:1",
    kind: "task",
    level: 2,
    floorKey: "f",
    taskId: 1,
    name: "Plans",
    start: day(2026, 9, 15),
    end: day(2026, 9, 15),
    durationDays: 1,
  };
  const second = { ...first, key: "task:2", taskId: 2, name: "Visa", start: day(2026, 9, 16), end: day(2026, 9, 17), durationDays: 2 };
  context.gantt.render([ZONE, floorLine, first, second]);
  context.frames.shift()();
  const classes = layerSvg(context).children.map((node) => node.getAttribute("class"));
  assert.ok(classes.includes("stg-floor"));
  assert.ok(classes.includes("stg-link"));
  assert.ok(classes.includes("stg-link-head"));
  assert.ok(classes.indexOf("stg-link") < classes.indexOf("stg-task"), "flèches sous les barres");
});
