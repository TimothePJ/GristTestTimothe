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

function setup({ width = 400, hasPlanningWindow = true, period = WINDOW } = {}) {
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
  let current = period;
  // Période déplacée par le planning lui-même (boutons du bandeau) : il prévient ses abonnés.
  const movePlanningWindow = (next) => {
    current = next;
    listeners.forEach((listener) => listener());
  };
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
  return {
    gantt, frames, calls, listeners, scroller, headRight, rowLeft, rowRight, layer,
    movePlanningWindow,
    currentWindow: () => current,
  };
}

const scaleSvg = (context) => context.headRight.children[0];
const layerSvg = (context) => context.layer.children[0];
// La couche : le fond (jours non travaillés, aujourd'hui), puis le contenu (flèches et barres).
const backdropGroup = (context) => layerSvg(context).children[0];
const contentGroup = (context) => layerSvg(context).children[1];
const layerNodes = (context) => layerSvg(context).children.flatMap((group) => group.children);
const shiftOf = (group) => Number(/^translate\((-?[\d.]+) 0\)$/.exec(group.getAttribute("transform"))[1]);

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
  assert.equal(layerNodes(context).length, 0);
  assert.equal(scaleSvg(context).children.length, 0);

  layer.clientWidth = 400;
  gantt.resize();
  assert.equal(frames.length, 1);
  frames.shift()();
  const classes = layerNodes(context).map((node) => node.getAttribute("class"));
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
  const classes = layerNodes(context).map((node) => node.getAttribute("class"));
  assert.ok(classes.includes("stg-floor"));
  assert.ok(classes.includes("stg-link"));
  assert.ok(classes.includes("stg-link-head"));
  assert.ok(classes.indexOf("stg-link") < classes.indexOf("stg-task"), "flèches sous les barres");
  assert.ok(classes.indexOf("stg-off") < classes.indexOf("stg-link"), "jours non travaillés sous les flèches");
});

/* ---------- Glisser sans tout redessiner ----------
   Déplacer la période sans changer le zoom ne change la place d'aucune forme par rapport aux
   autres : les flèches et les barres déjà dessinées sont décalées d'un bloc, sans être
   reconstruites. Seuls l'échelle et le fond (jours non travaillés, aujourd'hui), qui dépendent
   de la période visible, sont redessinés. */

const FLOOR = { ...ZONE, key: "floor:a/f", kind: "floor", level: 1, floorKey: "f", floorName: "PH RDB", name: "PH RDB" };
const PLANS = {
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
const VISA = {
  ...PLANS,
  key: "task:2",
  taskId: 2,
  name: "Visa",
  start: day(2026, 9, 16),
  end: day(2026, 9, 17),
  durationDays: 2,
  link: { predId: 1, type: "FD" },
  endLimit: day(2026, 9, 18),
};
const START = {
  ...PLANS,
  key: "task:3",
  taskId: 3,
  name: "Démarrage",
  start: day(2026, 9, 18),
  end: day(2026, 9, 18),
  durationDays: 0,
  isMilestone: true,
  link: { predId: 2, type: "FD" },
};
// Document Structure de la vue Global : ses barres, dont une en retard (peinte en deux parts).
const PLAN = {
  key: "doc:3021",
  kind: "document",
  level: 2,
  name: "3021",
  segments: [
    { kind: "phase", classes: "phase-coffrage", label: "Coffrage", paint: null, start: day(2026, 9, 14), end: day(2026, 9, 16) },
    {
      kind: "phase",
      classes: "phase-armature",
      label: "Armature",
      paint: { realise: 40, done: "#00aa00", late: "#aa0000", border: "#000000", text: "#ffffff" },
      start: day(2026, 9, 16),
      end: day(2026, 9, 19),
    },
    { kind: "reference", classes: "phase-reference-reception", label: "DE", paint: null, start: day(2026, 9, 12), end: day(2026, 9, 13) },
  ],
};
const LINES = [ZONE, FLOOR, PLANS, VISA, START, PLAN];

function drawLines(context, lines = LINES) {
  context.gantt.render(lines);
  context.frames.shift()();
}

// Glisser de `deltaPx` pixels, puis l'image suivante.
function dragBy(context, deltaPx, pointerId = 21) {
  dispatch(context.rowRight, "pointerdown", { button: 0, buttons: 1, pointerId, clientX: 300 });
  dispatch(context.scroller, "pointermove", { pointerId, buttons: 1, clientX: 300 + deltaPx });
  dispatch(context.scroller, "pointerup", { pointerId, buttons: 0, clientX: 300 + deltaPx });
  context.frames.shift()();
}

const X_ATTRIBUTES = new Set(["x", "x1", "x2"]);

// Ce que montre une forme : ses nombres (abscisses décalées de `shift`, le décalage de son
// groupe), son texte et ses autres attributs. Les enfants d'un <svg> imbriqué sont placés par
// rapport à lui ; ceux d'un <g>, par rapport à la couche.
function shown(node, shift = 0) {
  const numbers = [];
  const others = [];
  node.attributes.forEach((value, name) => {
    if (name === "transform") return;
    if (name === "points") {
      value.split(" ").forEach((pair) => {
        const [x, y] = pair.split(",").map(Number);
        numbers.push(x + shift, y);
      });
    } else if (value !== "" && Number.isFinite(Number(value))) {
      numbers.push(Number(value) + (X_ATTRIBUTES.has(name) ? shift : 0));
    } else {
      others.push(`${name}=${value}`);
    }
  });
  return {
    tag: node.tagName,
    text: node.textContent,
    others,
    numbers,
    children: node.children.map((child) => shown(child, node.tagName === "svg" ? 0 : shift)),
  };
}

// Dessin complet : l'échelle et le fond tels quels, le contenu à sa place réelle.
function drawingOf(context) {
  const content = contentGroup(context);
  const shift = shiftOf(content);
  return {
    scale: scaleSvg(context).children.map((node) => shown(node)),
    backdrop: backdropGroup(context).children.map((node) => shown(node)),
    content: content.children.map((node) => shown(node, shift)),
  };
}

// Deux arrondis au dixième de pixel (la forme, le décalage) séparent au plus les deux dessins.
const SAME_PLACE_PX = 0.2;

function assertSameShapes(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label} : nombre de formes`);
  actual.forEach((shape, index) => {
    const other = expected[index];
    const where = `${label} › ${shape.tag} n° ${index}`;
    assert.deepEqual(
      { tag: shape.tag, text: shape.text, others: shape.others },
      { tag: other.tag, text: other.text, others: other.others },
      where,
    );
    assert.equal(shape.numbers.length, other.numbers.length, `${where} : nombres`);
    shape.numbers.forEach((value, rank) => {
      assert.ok(
        Math.abs(value - other.numbers[rank]) <= tolerance,
        `${where} : ${value} au lieu de ${other.numbers[rank]}`,
      );
    });
    assertSameShapes(shape.children, other.children, tolerance, where);
  });
}

function assertSameDrawing(actual, expected, label = "dessin") {
  assert.ok(expected.scale.length > 0 && expected.backdrop.length > 0 && expected.content.length > 0, `${label} : dessin vide`);
  assertSameShapes(actual.scale, expected.scale, 0, `${label}, échelle`);
  assertSameShapes(actual.backdrop, expected.backdrop, 0, `${label}, fond`);
  assertSameShapes(actual.content, expected.content, SAME_PLACE_PX, `${label}, contenu`);
}

// Le dessin d'un Gantt neuf pour ces lignes, cette période et cette largeur.
function freshDrawing({ period, width = 400, lines = LINES }) {
  const fresh = setup({ period, width });
  drawLines(fresh, lines);
  return drawingOf(fresh);
}

function randomOf(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test("glisser : les barres ne sont pas reconstruites, leur groupe est décalé", () => {
  const context = setup();
  drawLines(context);
  const drawn = [...contentGroup(context).children];
  assert.ok(drawn.length > 10, "flèches et barres dessinées");
  assert.equal(shiftOf(contentGroup(context)), 0);

  dragBy(context, -100);
  const kept = contentGroup(context).children;
  assert.equal(kept.length, drawn.length);
  assert.ok(kept.every((node, index) => node === drawn[index]), "aucune forme reconstruite");
  assert.equal(shiftOf(contentGroup(context)), -100);

  // Un second glisser repart de la période atteinte ; le décalage se mesure depuis le dessin.
  dragBy(context, 30, 22);
  assert.ok(contentGroup(context).children.every((node, index) => node === drawn[index]));
  assert.equal(shiftOf(contentGroup(context)), -70);
});

// Réécrire la taille d'un <svg>, même avec la même valeur, fait refaire au navigateur la mise en
// page de tout son contenu (mesuré : 38 ms pour 4 000 formes, contre 0,3 ms pour le décalage).
test("la taille de la couche et de l'échelle n'est réécrite que quand elle change", () => {
  const context = setup();
  drawLines(context);
  const written = [];
  [["couche", layerSvg(context)], ["échelle", scaleSvg(context)]].forEach(([label, svg]) => {
    const write = svg.setAttribute.bind(svg);
    svg.setAttribute = (name, value) => {
      written.push(`${label} ${name}`);
      write(name, value);
    };
  });
  dragBy(context, -100);
  assert.deepEqual(written, []);

  context.layer.clientWidth = 520;
  context.gantt.resize();
  context.frames.shift()();
  assert.deepEqual(written, ["échelle width", "couche width"]);
  assert.equal(layerSvg(context).getAttribute("width"), "520");
  assert.equal(scaleSvg(context).getAttribute("width"), "520");

  drawLines(context, [...LINES, { ...PLANS, key: "task:9", taskId: 9, link: null }]);
  assert.deepEqual(written.slice(2), ["couche height"]);
  assert.equal(layerSvg(context).getAttribute("height"), String(7 * 26));
});

test("glisser : l'échelle et le fond suivent la période, comme sur un Gantt neuf", () => {
  const context = setup();
  drawLines(context);
  const todayBefore = backdropGroup(context).children.find((node) => node.getAttribute("class") === "stg-today");
  dragBy(context, -100);
  const todayAfter = backdropGroup(context).children.find((node) => node.getAttribute("class") === "stg-today");
  const todayMove = Number(todayAfter.getAttribute("x1")) - Number(todayBefore.getAttribute("x1"));
  assert.ok(Math.abs(todayMove + 100) < 0.01, `trait d'aujourd'hui déplacé de ${todayMove} px`);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow() }));
});

test("glissers au hasard : le dessin reste celui d'un Gantt neuf sur la période atteinte", () => {
  for (const seed of [3, 17, 41]) {
    const random = randomOf(seed);
    const context = setup();
    drawLines(context);
    const drawn = [...contentGroup(context).children];
    assert.ok(drawn.length > 10);
    for (let pointerId = 30; pointerId < 36; pointerId += 1) {
      let x = 50 + Math.floor(random() * 300);
      dispatch(context.rowRight, "pointerdown", { button: 0, buttons: 1, pointerId, clientX: x });
      for (let move = 0; move < 5; move += 1) {
        x += Math.floor(random() * 241) - 120;
        dispatch(context.scroller, "pointermove", { pointerId, buttons: 1, clientX: x });
        // Plusieurs mouvements peuvent arriver entre deux images.
        if (random() < 0.7) context.frames.shift()?.();
      }
      dispatch(context.scroller, "pointerup", { pointerId, buttons: 0, clientX: x });
      context.frames.shift()?.();
    }
    assert.equal(context.frames.length, 0);
    assert.ok(contentGroup(context).children.every((node, index) => node === drawn[index]), `graine ${seed} : rien de reconstruit`);
    assert.notDeepEqual(context.currentWindow(), WINDOW);
    assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow() }), `graine ${seed}`);
  }
});

test("période déplacée par le planning, même zoom : décalage sans reconstruire", () => {
  const context = setup();
  drawLines(context);
  const drawn = [...contentGroup(context).children];
  // Semaine suivante ; le planning arrondit à la milliseconde, la durée peut en changer d'une.
  const next = { start: day(2026, 9, 21), end: new Date(day(2026, 9, 28).getTime() + 1) };
  context.movePlanningWindow(next);
  context.frames.shift()();
  assert.ok(contentGroup(context).children.every((node, index) => node === drawn[index]));
  assert.equal(shiftOf(contentGroup(context)), -400);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: next }));
});

test("durée de la période à peine changée (une heure sur une semaine) : redessiné, pas décalé", () => {
  const context = setup();
  drawLines(context);
  const drawn = [...contentGroup(context).children];
  // Décalées, les formes de droite seraient à plus d'un pixel de leur place.
  const next = { start: day(2026, 9, 21), end: new Date(day(2026, 9, 28).getTime() + 3600000) };
  context.movePlanningWindow(next);
  context.frames.shift()();
  assert.ok(contentGroup(context).children.every((node) => !drawn.includes(node)), "tout est reconstruit");
  assert.equal(shiftOf(contentGroup(context)), 0);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: next }));
});

test("zoom : les barres sont redessinées à la nouvelle échelle", () => {
  const context = setup();
  drawLines(context);
  dragBy(context, -100);
  const drawn = [...contentGroup(context).children];
  dispatch(context.rowRight, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 100 });
  context.frames.shift()();
  assert.ok(contentGroup(context).children.every((node) => !drawn.includes(node)), "tout est reconstruit");
  assert.equal(shiftOf(contentGroup(context)), 0);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow() }));
});

test("glisser après un zoom : décalage mesuré depuis le dessin refait, sans reconstruire", () => {
  const context = setup();
  drawLines(context);
  dragBy(context, -100);
  dispatch(context.rowRight, "wheel", { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 100 });
  context.frames.shift()();
  const drawn = [...contentGroup(context).children];

  dragBy(context, -60, 22);
  assert.ok(contentGroup(context).children.every((node, index) => node === drawn[index]), "aucune forme reconstruite");
  assert.equal(shiftOf(contentGroup(context)), -60);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow() }));
});

test("nouvelles lignes : redessinées, même après un glisser", () => {
  const context = setup();
  drawLines(context);
  dragBy(context, -100);
  const drawn = [...contentGroup(context).children];
  const lines = [ZONE, FLOOR, { ...PLANS, end: day(2026, 9, 16), durationDays: 2 }, VISA, START];
  drawLines(context, lines);
  assert.ok(contentGroup(context).children.every((node) => !drawn.includes(node)));
  assert.equal(shiftOf(contentGroup(context)), 0);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow(), lines }));
});

test("largeur du panneau changée : redessinées à la nouvelle largeur", () => {
  const context = setup();
  drawLines(context);
  dragBy(context, -100);
  const drawn = [...contentGroup(context).children];
  context.layer.clientWidth = 520;
  context.gantt.resize();
  context.frames.shift()();
  assert.ok(contentGroup(context).children.every((node) => !drawn.includes(node)));
  assert.equal(shiftOf(contentGroup(context)), 0);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow(), width: 520 }));
});

test("panneau masqué puis réaffiché sur une autre période : tout est redessiné", () => {
  const context = setup();
  drawLines(context);
  context.layer.clientWidth = 0;
  context.gantt.resize();
  context.frames.shift()();
  assert.equal(layerNodes(context).length, 0);
  const next = { start: day(2026, 9, 21), end: day(2026, 9, 28) };
  context.movePlanningWindow(next);
  context.frames.shift()();
  assert.equal(layerNodes(context).length, 0);
  context.layer.clientWidth = 400;
  context.gantt.resize();
  context.frames.shift()();
  assertSameDrawing(drawingOf(context), freshDrawing({ period: next }));
});

test("glisser très loin : le dessin est refait autour de la période atteinte", () => {
  const context = setup();
  drawLines(context);
  dragBy(context, -99000);
  const drawn = [...contentGroup(context).children];
  assert.equal(shiftOf(contentGroup(context)), -99000);
  // Au-delà de 100 000 px de décalage, les grandes abscisses perdraient en précision.
  dragBy(context, -2000, 22);
  assert.ok(contentGroup(context).children.every((node) => !drawn.includes(node)), "dessin refait");
  assert.equal(shiftOf(contentGroup(context)), 0);
  assertSameDrawing(drawingOf(context), freshDrawing({ period: context.currentWindow() }));
});
