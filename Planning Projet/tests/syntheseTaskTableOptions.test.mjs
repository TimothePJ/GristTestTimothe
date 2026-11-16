import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FakeElement, dispatch } from "./helpers/fakeDom.mjs";

// Mini DOM pour le tableau : sélecteurs composés (étiquette, .classe, [attribut], [attribut="valeur"])
// séparés par des espaces, recherche dans l'arbre, focus. Local à ce test : le harnais commun ne les gère pas.
class TableElement extends FakeElement {
  constructor(tag, className) {
    super(tag, className);
    const base = this.classList;
    this.classList = {
      ...base,
      toggle: (name, force) => (force === undefined ? !this.classes.has(name) : force) ? this.classes.add(name) : this.classes.delete(name),
    };
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
    this.hidden = false;
    this.value = "";
  }

  get firstChild() {
    return this.children[0] || null;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  setAttribute(name, value) {
    super.setAttribute(name, value);
    if (name === "class") this.className = value;
  }

  attribute(name) {
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
      return this.dataset[key];
    }
    return this.getAttribute(name);
  }

  matchesCompound(compound) {
    const tag = compound.match(/^[a-z][a-z0-9]*/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const classes = [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    if (!classes.every((name) => this.classes.has(name))) return false;
    return [...compound.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) => {
      const actual = this.attribute(name);
      return value === undefined ? actual !== undefined : actual === value;
    });
  }

  matches(selector) {
    const parts = selector.trim().split(/\s+/);
    if (!this.matchesCompound(parts[parts.length - 1])) return false;
    let node = this.parentNode;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (node && !(node.matchesCompound && node.matchesCompound(parts[i]))) node = node.parentNode;
      if (!node) return false;
      node = node.parentNode;
    }
    return true;
  }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches?.(selector)) return node;
    return null;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => node.children.forEach((child) => {
      if (child.matches?.(selector)) found.push(child);
      walk(child);
    });
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  focus() {
    document.activeElement = this;
  }

  select() {}

  scrollIntoView() {}
}

const documentListeners = new FakeElement("#document");
const document = Object.assign(documentListeners, {
  createElement: (tag) => new TableElement(tag),
  activeElement: null,
});
document.documentElement = new TableElement("html");
globalThis.document = document;
globalThis.Element = TableElement;
const storage = new Map();
globalThis.window = {
  localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => { storage.set(key, String(value)); } },
  addEventListener() {},
  clearTimeout() {},
  setTimeout: () => 0,
  innerWidth: 1200,
};

const { createSyntheseTaskTable, buildMenuItems, isEditableCell } = await import("../assets/js/ui/syntheseTaskTable.js");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");


const taskLine = (overrides = {}) => ({
  kind: "task", key: "task:1", level: 2, zoneKey: "zone1", floorKey: "ss1", taskId: 1, groupRowId: null,
  name: "Coffrage", durationDays: 5, start: new Date(2026, 0, 5), end: new Date(2026, 0, 9),
  ...overrides,
});
const floorLine = (overrides = {}) => ({
  kind: "floor", key: "floor:zone1/ss1", level: 1, zoneKey: "zone1", floorKey: "ss1", name: "SS1",
  collapsed: false, durationDays: 5, start: new Date(2026, 0, 5), end: new Date(2026, 0, 9), ...overrides,
});
const zoneLine = (overrides = {}) => ({
  kind: "zone", key: "zone:zone1", level: 0, zoneKey: "zone1", floorKey: "", name: "Zone 1", collapsed: false, ...overrides,
});
const groupLine = () => ({
  kind: "group", key: "group:7", level: 2, zoneKey: "zone1", floorKey: "ss1", groupRowId: 7, nature: "cycle", name: "Cycle",
});

function makeTable(callbacks = {}, options = {}) {
  const host = new TableElement("div");
  host.replaceChildren = function replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  };
  const table = createSyntheseTaskTable(host, callbacks, options);
  const lineOf = (key) => host.querySelector(`.stt-line[data-line-key="${key}"]`);
  return { host, table, lineOf };
}
const click = (element) => dispatch(element, "click", { button: 0 });

test("hiddenFields: start et end : ni en-tête ni cellule, Tab saute ces champs", async () => {
  const edits = [];
  const { table, host, lineOf } = makeTable({ onEdit: (id, field, value) => edits.push([id, field, value]) }, { hiddenFields: ["start", "end"] });
  table.render([taskLine()], { editable: true });
  assert.equal(host.querySelector(".stt-cell--start"), null);
  assert.equal(host.querySelector(".stt-cell--end"), null);
  assert.ok(lineOf("task:1").querySelector(".stt-cell--duration"));

  click(lineOf("task:1").querySelector(".stt-cell--duration"));
  const input = host.querySelector(".stt-input");
  assert.ok(input);
  input.value = "8";
  dispatch(input, "keydown", { key: "Tab" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.querySelector(".stt-input[type=\"date\"]"), null);
  assert.equal(host.querySelector(".stt-input"), null);
  assert.deepEqual(edits, [[1, "duration", "8"]]);
});

test("hiddenFields: seul start masqué : Tab sur la Durée ouvre la Fin", async () => {
  const { table, host, lineOf } = makeTable({ onEdit() {} }, { hiddenFields: ["start"] });
  table.render([taskLine()], { editable: true });
  click(lineOf("task:1").querySelector(".stt-cell--duration"));
  dispatch(host.querySelector(".stt-input"), "keydown", { key: "Tab" });
  await new Promise((resolve) => setImmediate(resolve));
  const next = host.querySelector(".stt-input");
  assert.ok(next);
  assert.equal(next.getAttribute("aria-label"), "Fin");
});

test("rightPane: false : ni .stt-right, ni séparateur", () => {
  const { table, host } = makeTable({}, { rightPane: false });
  table.render([taskLine()], { editable: true });
  assert.equal(host.querySelector(".stt-right"), null);
  assert.equal(host.querySelector(".stt-splitter"), null);
  assert.ok(host.querySelector(".stt").classes.has("stt--no-right"));
  assert.ok(css.includes(".stt--no-right"));
});

test("templateMode : menus réduits", () => {
  const floorItems = buildMenuItems(floorLine(), { templateMode: true });
  assert.deepEqual(floorItems.map((item) => item.action), ["addTask", "addMeeting", "addCycle"]);
  assert.deepEqual(buildMenuItems(zoneLine(), { templateMode: true }), []);
  assert.deepEqual(buildMenuItems(taskLine(), { templateMode: true }), buildMenuItems(taskLine()));
  assert.deepEqual(buildMenuItems(groupLine(), { templateMode: true }), buildMenuItems(groupLine()));
  assert.ok(buildMenuItems(floorLine()).some((item) => item.action === "deleteFloor"));
});

test("templateMode : ligne de zone masquée, nom de l'étage non modifiable", () => {
  const renamed = [];
  const { table, host, lineOf } = makeTable({ onRenameFloor: (...args) => renamed.push(args) }, { templateMode: true });
  table.render([zoneLine(), floorLine(), taskLine()], { editable: true });
  assert.equal(host.querySelector(".stt-line[data-kind=\"zone\"]"), null);
  assert.ok(lineOf("floor:zone1/ss1"));
  assert.equal(isEditableCell(floorLine(), "name", { editable: true, templateMode: true }), false);
  assert.equal(isEditableCell(floorLine(), "name", { editable: true }), true);
  assert.ok(lineOf("floor:zone1/ss1").querySelector(".stt-toggle"));
  click(lineOf("floor:zone1/ss1").querySelector(".stt-cell--name"));
  assert.equal(host.querySelector(".stt-input"), null);
  table.startEditingFloor("zone1", "ss1");
  assert.equal(host.querySelector(".stt-input"), null);
});

test("sans options : zone rendue, étage modifiable, panneau droit présent", () => {
  const { table, host, lineOf } = makeTable();
  table.render([zoneLine(), floorLine()], { editable: true });
  assert.ok(lineOf("zone:zone1"));
  assert.ok(host.querySelector(".stt-right"));
  assert.ok(host.querySelector(".stt-splitter"));
  assert.ok(host.querySelector(".stt-cell--start"));
  click(lineOf("floor:zone1/ss1").querySelector(".stt-cell--name"));
  assert.ok(host.querySelector(".stt-input"));
});

test("storageKeys : largeurs lues et écrites sous les clés fournies", () => {
  storage.clear();
  storage.set("k.left", "900");
  storage.set("k.cols", JSON.stringify({ duration: 120 }));
  const { host } = makeTable({}, { storageKeys: { leftWidth: "k.left", columnWidths: "k.cols" } });
  assert.equal(host.querySelector(".stt").style["--stt-col-duration"], "120px");
  assert.ok(Number.parseInt(host.querySelector(".stt").style["--stt-left-width"], 10) >= 900);
  const splitter = host.querySelector(".stt-splitter");
  dispatch(splitter, "keydown", { key: "ArrowRight", preventDefault() {} });
  assert.ok(storage.has("k.left"));
  assert.ok(Number(storage.get("k.left")) > 900);
  assert.equal([...storage.keys()].some((key) => key.startsWith("planning-projet.")), false);
});

test("templateMode : la ligne de zone n'est pas dans la liste du tableau, le trait d'insertion suit les lignes rendues", () => {
  const { table, host } = makeTable({}, { templateMode: true });
  table.render([zoneLine(), floorLine(), taskLine(), taskLine({ key: "task:2", taskId: 2, name: "Armature" })], { editable: true, canOrder: true });
  const scroller = host.querySelector(".stt-scroll");
  scroller.rect = { left: 0, top: 0, width: 800, height: 400 };
  const body = host.querySelector(".stt-body");
  body.rect = { left: 0, top: 32, width: 800, height: 78 };
  const rendered = body.children;
  assert.equal(rendered.length, 3, "étage + 2 tâches, pas de zone");
  rendered.forEach((element, index) => { element.rect = { left: 0, top: 32 + index * 26, width: 800, height: 26 }; });
  const grip = rendered[2].querySelector(".stt-grip");
  // Appui sur la tâche 2 (3e ligne rendue), puis survol de la moitié haute de la tâche 1 (2e ligne rendue).
  dispatch(grip, "pointerdown", { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 32 + 2 * 26 + 5 });
  dispatch(scroller, "pointermove", { pointerId: 1, buttons: 1, clientX: 40, clientY: 32 + 26 + 3 });
  const dropLine = host.querySelector(".stt-drop-line");
  assert.equal(dropLine.hidden, false);
  // Avant la tâche 1 : en-tête (32) + 1 ligne rendue (l'étage) × 26 = 58, sans compter la zone masquée.
  assert.equal(dropLine.style.top, "58px");
  dispatch(scroller, "pointerup", { pointerId: 1, buttons: 0, clientX: 40, clientY: 32 + 26 + 3 });
});

test("hiddenFields : la grille ne liste que les colonnes affichées, minimum sans les champs masqués", () => {
  const all = makeTable();
  all.table.render([taskLine()], { editable: true });
  assert.equal(all.host.querySelector(".stt").style["--stt-left-columns"], undefined, "sans option : pistes du CSS");
  const hiddenOnes = makeTable({}, { hiddenFields: ["start", "end"] });
  assert.equal(
    hiddenOnes.host.querySelector(".stt").style["--stt-left-columns"],
    "var(--stt-col-line) minmax(0, 1fr) var(--stt-col-id2) var(--stt-col-indice) var(--stt-col-duration) var(--stt-col-link)",
  );
  assert.ok(css.includes("var(--stt-left-columns, var(--stt-col-line) minmax(0, 1fr)"));
  storage.clear();
  storage.set("k.left", "50");
  const small = makeTable({}, { hiddenFields: ["start", "end"], storageKeys: { leftWidth: "k.left", columnWidths: "k.cols" } });
  // 36 + 56 + 56 + 60 + 72 = 280 de colonnes + 120 de nom ; Début et Fin (184) ne comptent pas.
  assert.equal(small.host.querySelector(".stt").style["--stt-left-width"], "400px");
  storage.clear();
  const standard = makeTable({}, { hiddenFields: ["start", "end"] });
  assert.equal(standard.host.querySelector(".stt").style["--stt-left-width"], "600px", "largeur par défaut sans Début ni Fin");
});

test("templateMode : pas d'emblème de lien Structure sur la ligne étage ; par défaut, il y est", () => {
  const note = "Étage non lié à un coffrage de Structure.";
  const inWindow = makeTable({}, { templateMode: true });
  inWindow.table.render([floorLine({ structureLinkNote: note })], { editable: true });
  assert.equal(inWindow.host.querySelector(".stt-floor-link"), null);
  const main = makeTable();
  main.table.render([zoneLine(), floorLine({ structureLinkNote: note })], { editable: true });
  assert.ok(main.host.querySelector(".stt-floor-link"));
});
