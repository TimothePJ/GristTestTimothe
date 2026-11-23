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

// Une saisie est suivie de relectures (ses propres lignes relues, les coffrages, un signal voisin) qui
// redemandent le même tableau : ni les lignes ni le Gantt ne sont refaits.
function makeTableWithGantt() {
  const ganttRenders = [];
  const ganttResizes = [];
  const made = makeTable({}, {
    createGantt: () => ({ render: (lines) => ganttRenders.push(lines), resize: () => ganttResizes.push(1) }),
  });
  return { ...made, ganttRenders, ganttResizes };
}

test("même contenu redemandé : les lignes déjà dessinées sont gardées, le Gantt n'est pas redessiné", () => {
  const { table, lineOf, ganttRenders } = makeTableWithGantt();
  table.render([zoneLine(), floorLine(), taskLine()], { editable: true });
  const drawn = lineOf("task:1");
  table.render([zoneLine(), floorLine(), taskLine()], { editable: true });
  assert.equal(lineOf("task:1"), drawn);
  assert.equal(ganttRenders.length, 1);
});

test("contenu changé : le tableau et le Gantt sont redessinés", () => {
  const { table, lineOf, ganttRenders } = makeTableWithGantt();
  table.render([taskLine()], { editable: true });
  const drawn = lineOf("task:1");
  table.render([taskLine({ end: new Date(2026, 0, 12), durationDays: 6 })], { editable: true });
  assert.notEqual(lineOf("task:1"), drawn);
  assert.equal(ganttRenders.length, 2);
  assert.equal(ganttRenders[1][0].durationDays, 6);
});

test("mêmes lignes mais tableau devenu non modifiable : redessiné, plus de cellule de saisie", () => {
  const { table, host, lineOf } = makeTableWithGantt();
  table.render([taskLine()], { editable: true });
  const drawn = lineOf("task:1");
  assert.ok(host.querySelector(".stt-cell.is-editable"));
  table.render([taskLine()], { editable: false });
  assert.notEqual(lineOf("task:1"), drawn);
  assert.equal(host.querySelector(".stt-cell.is-editable"), null);
});

// La vue a pu être masquée (autre service) pendant que la fenêtre changeait de taille : au retour, le
// même contenu redemandé recale la largeur du tableau sur la place disponible. Les lignes, elles, n'ont
// pas changé : elles gardent leur élément.
test("même contenu mais place disponible changée depuis le dernier dessin : largeur recalée, Gantt prévenu", () => {
  const { table, host, lineOf, ganttRenders, ganttResizes } = makeTableWithGantt();
  const root = host.querySelector(".stt");
  const leftWidth = () => Number.parseInt(root.style["--stt-left-width"], 10);
  table.render([taskLine()], { editable: true });
  const drawn = lineOf("task:1");
  const wide = leftWidth();
  const resizes = ganttResizes.length;
  root.clientWidth = 640;
  table.render([taskLine()], { editable: true });
  assert.ok(leftWidth() < wide, `largeur du tableau : ${wide} px puis ${leftWidth()} px`);
  assert.equal(ganttResizes.length, resizes + 1, "le Gantt est prévenu de sa nouvelle largeur");
  assert.equal(lineOf("task:1"), drawn, "les lignes ne sont pas refaites pour autant");
  assert.equal(ganttRenders.length, 1, "ni les barres");
  table.render([taskLine()], { editable: true });
  assert.equal(ganttResizes.length, resizes + 1, "à largeur égale, plus rien n'est refait");
});

// Chaque dessin reposait la largeur et faisait redessiner le Gantt, même sans changement.
test("largeur inchangée : un dessin ne fait pas redessiner le Gantt pour sa largeur", () => {
  const { table, ganttResizes } = makeTableWithGantt();
  table.render([taskLine()], { editable: true });
  const resizes = ganttResizes.length;
  table.render([taskLine({ name: "Coffrage RDC" })], { editable: true });
  table.render([taskLine({ name: "Coffrage RDC" }), taskLine({ key: "task:2", taskId: 2 })], { editable: true });
  assert.equal(ganttResizes.length, resizes);
});

test("saisie annulée sans changement : la cellule redevient une cellule", async () => {
  const { table, host, lineOf } = makeTableWithGantt();
  table.render([taskLine()], { editable: true });
  click(lineOf("task:1").querySelector(".stt-cell--duration"));
  assert.ok(host.querySelector(".stt-input"));
  dispatch(host.querySelector(".stt-input"), "keydown", { key: "Escape", preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.querySelector(".stt-input"), null);
  assert.equal(lineOf("task:1").querySelector(".stt-cell--duration").textContent, "5 jours");
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

test("repère du mode : sur chaque tâche liée, après son nom ; jamais sur un cycle", () => {
  const { table, lineOf } = makeTable();
  const link = (type) => ({ predId: 9, type, lag: 0 });
  table.render([
    { ...groupLine(), cycleMode: "parallel" },
    taskLine({ link: link("FD"), linkText: "3FD" }),
    taskLine({ key: "task:2", taskId: 2, name: "Avec", link: link("FF"), linkText: "4FF" }),
    taskLine({ key: "task:3", taskId: 3, name: "Sans lien", link: null }),
  ], { editable: true });
  assert.equal(lineOf("group:7").querySelector(".stt-task-mode"), null);
  const children = lineOf("task:1").querySelector(".stt-cell--name").children.map((child) => child.className);
  assert.equal(children[children.length - 1], "stt-task-mode is-series");
  assert.equal(children[children.length - 2], "stt-text");
  assert.ok(lineOf("task:2").querySelector(".stt-task-mode.is-parallel"));
  assert.equal(lineOf("task:3").querySelector(".stt-task-mode"), null);
  // En lecture seule aussi : c'est une information, pas une action.
  table.render([taskLine({ link: link("DD"), linkText: "3DD" })], { editable: false });
  assert.ok(lineOf("task:1").querySelector(".stt-task-mode.is-start"));
});

test("repère de la tâche contrôlée : après son nom et son mode, dans le tableau comme dans la fenêtre Paramètre", () => {
  const { table, lineOf } = makeTable();
  table.render([
    taskLine({ isControlTask: true, isChosenControlTask: true, link: { predId: 9, type: "FF", lag: 0 }, linkText: "9FF" }),
    taskLine({ key: "task:2", taskId: 2, name: "Autre" }),
  ], { editable: true });
  const cell = lineOf("task:1").querySelector(".stt-cell--name");
  const children = cell.children.map((child) => child.className);
  assert.equal(children[children.length - 1], "stt-control-task");
  assert.equal(children[children.length - 2], "stt-task-mode is-parallel");
  assert.equal(children[children.length - 3], "stt-text");
  assert.equal(lineOf("task:1").querySelector(".stt-control-task").title, "Tâche contrôlée par rapport au coffrage.");
  assert.equal(lineOf("task:2").querySelector(".stt-control-task"), null);
  const inWindow = makeTable({}, { templateMode: true });
  inWindow.table.render([taskLine({ isControlTask: true, isChosenControlTask: false })], { editable: false });
  assert.ok(inWindow.lineOf("task:1").querySelector(".stt-control-task"));
});

// ---------- Seules les lignes modifiées sont refaites ----------

const bodyOf = (host) => host.querySelector(".stt-body");
const keysOf = (host) => bodyOf(host).children.map((element) => element.dataset.lineKey);
const elementsOf = (host) => new Map(bodyOf(host).children.map((element) => [element.dataset.lineKey, element]));
const otherTask = (id, overrides = {}) => taskLine({ key: `task:${id}`, taskId: id, name: `Tâche ${id}`, ...overrides });

test("une valeur changée dans une ligne : seule cette ligne est refaite, les autres gardent leur élément", () => {
  const { table, host } = makeTableWithGantt();
  table.render([zoneLine(), floorLine(), taskLine(), otherTask(2)], { editable: true });
  const before = elementsOf(host);
  table.render([zoneLine(), floorLine(), taskLine(), otherTask(2, { durationDays: 8 })], { editable: true });
  const after = elementsOf(host);
  assert.deepEqual(keysOf(host), ["zone:zone1", "floor:zone1/ss1", "task:1", "task:2"]);
  ["zone:zone1", "floor:zone1/ss1", "task:1"].forEach((key) => assert.equal(after.get(key), before.get(key), key));
  assert.notEqual(after.get("task:2"), before.get("task:2"));
  assert.equal(after.get("task:2").querySelector(".stt-cell--duration").textContent, "8 jours");
});

test("ligne ajoutée, retirée ou déplacée : les lignes inchangées gardent leur élément, l'ordre du tableau suit", () => {
  const { table, host } = makeTableWithGantt();
  table.render([zoneLine(), floorLine(), taskLine(), otherTask(2)], { editable: true });
  const first = elementsOf(host);
  // Ajout au milieu.
  table.render([zoneLine(), floorLine(), otherTask(3), taskLine(), otherTask(2)], { editable: true });
  assert.deepEqual(keysOf(host), ["zone:zone1", "floor:zone1/ss1", "task:3", "task:1", "task:2"]);
  const second = elementsOf(host);
  ["zone:zone1", "floor:zone1/ss1", "task:1", "task:2"].forEach((key) => assert.equal(second.get(key), first.get(key), key));
  // Retrait et déplacement : la tâche 1 disparaît, la tâche 2 passe avant la tâche 3.
  table.render([zoneLine(), floorLine(), otherTask(2), otherTask(3)], { editable: true });
  assert.deepEqual(keysOf(host), ["zone:zone1", "floor:zone1/ss1", "task:2", "task:3"]);
  const third = elementsOf(host);
  ["zone:zone1", "floor:zone1/ss1", "task:2", "task:3"].forEach((key) => assert.equal(third.get(key), second.get(key), key));
  assert.equal(first.get("task:1").parentNode, null, "la ligne retirée a quitté le tableau");
  // Une ligne remontée tout en haut, une autre descendue tout en bas.
  table.render([otherTask(3), floorLine(), otherTask(2), zoneLine()], { editable: true });
  assert.deepEqual(keysOf(host), ["task:3", "floor:zone1/ss1", "task:2", "zone:zone1"]);
  const fourth = elementsOf(host);
  ["zone:zone1", "floor:zone1/ss1", "task:2", "task:3"].forEach((key) => assert.equal(fourth.get(key), third.get(key), key));
});

test("fin de saisie sans changement : seule la ligne saisie est refaite, le Gantt n'est pas redessiné", async () => {
  const { table, host, lineOf, ganttRenders } = makeTableWithGantt();
  table.render([zoneLine(), floorLine(), taskLine(), otherTask(2)], { editable: true });
  const before = elementsOf(host);
  click(lineOf("task:1").querySelector(".stt-cell--duration"));
  assert.ok(host.querySelector(".stt-input"));
  dispatch(host.querySelector(".stt-input"), "keydown", { key: "Escape", preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  const after = elementsOf(host);
  assert.equal(host.querySelector(".stt-input"), null);
  ["zone:zone1", "floor:zone1/ss1", "task:2"].forEach((key) => assert.equal(after.get(key), before.get(key), key));
  assert.notEqual(after.get("task:1"), before.get("task:1"));
  assert.equal(after.get("task:1").querySelector(".stt-cell--duration").textContent, "5 jours");
  assert.equal(ganttRenders.length, 1);
});

test("Gantt : redessiné quand une ligne change, s'ajoute, disparaît ou change de place ; pas quand seuls les droits changent", () => {
  const { table, host, lineOf, ganttRenders } = makeTableWithGantt();
  table.render([zoneLine(), taskLine(), otherTask(2)], { editable: true });
  assert.equal(ganttRenders.length, 1);
  table.render([zoneLine(), taskLine({ name: "Coffrage RDC" }), otherTask(2)], { editable: true });
  assert.equal(ganttRenders.length, 2, "ligne changée");
  table.render([zoneLine(), taskLine({ name: "Coffrage RDC" }), otherTask(2), otherTask(3)], { editable: true });
  assert.equal(ganttRenders.length, 3, "ligne ajoutée");
  table.render([zoneLine(), otherTask(2), taskLine({ name: "Coffrage RDC" }), otherTask(3)], { editable: true });
  assert.equal(ganttRenders.length, 4, "ligne déplacée");
  table.render([zoneLine(), otherTask(2), otherTask(3)], { editable: true });
  assert.equal(ganttRenders.length, 5, "ligne retirée");
  assert.deepEqual(ganttRenders[4].map((line) => line.key), ["zone:zone1", "task:2", "task:3"]);
  const drawn = lineOf("task:2");
  table.render([zoneLine(), otherTask(2), otherTask(3)], { editable: false });
  assert.equal(ganttRenders.length, 5, "seuls les droits changent : les barres sont les mêmes");
  assert.notEqual(lineOf("task:2"), drawn, "mais les lignes du tableau sont refaites");
  assert.equal(host.querySelector(".stt-cell.is-editable"), null);
});

test("tableau vidé par un message, puis rempli de nouveau : lignes et Gantt suivent", () => {
  const { table, host, ganttRenders } = makeTableWithGantt();
  table.render([zoneLine(), taskLine()], { editable: true });
  table.render([], { editable: true, emptyMessage: "Chargement des tâches…" });
  assert.deepEqual(keysOf(host), []);
  assert.deepEqual(ganttRenders.at(-1), []);
  table.render([zoneLine(), taskLine()], { editable: true });
  assert.deepEqual(keysOf(host), ["zone:zone1", "task:1"]);
  assert.deepEqual(ganttRenders.at(-1).map((line) => line.key), ["zone:zone1", "task:1"]);
  assert.equal(ganttRenders.length, 3);
});

// Garde-fou : un tableau redessiné de proche en proche doit montrer exactement ce que montre un tableau
// neuf dessiné d'un coup avec les mêmes lignes — sur une longue suite de changements tirés au hasard.
function snapshot(element) {
  const style = Object.fromEntries(Object.entries(element.style || {}).filter(([, value]) => typeof value !== "function"));
  return {
    tag: element.tagName,
    classes: [...element.classes].sort(),
    dataset: { ...element.dataset },
    attributes: { ...(element.attributes || {}) },
    style,
    title: element.title ?? null,
    tabIndex: element.tabIndex ?? null,
    text: element.children.length ? "" : element.textContent,
    children: element.children.map(snapshot),
  };
}

test("tableau redessiné de proche en proche : identique à un tableau neuf, sur 300 changements au hasard", () => {
  let seed = 4242;
  const random = (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  let nextId = 10;
  const newTask = () => {
    nextId += 1;
    return otherTask(nextId, { level: 1 + random(3), durationDays: random(9), isMilestone: random(6) === 0 });
  };
  let lines = [zoneLine(), floorLine(), groupLine(), taskLine(), otherTask(2), otherTask(3), otherTask(4)];
  let options = { editable: true, canMoveCycles: true };
  const { table, host } = makeTableWithGantt();
  const changes = [
    () => {
      const at = random(lines.length);
      lines = lines.map((line, index) => (index === at ? { ...line, name: `${line.name} ${random(9)}` } : line));
    },
    () => {
      lines = lines.map((line) => (line.kind === "task" && random(3) === 0
        ? { ...line, durationDays: random(15), end: new Date(2026, 0, 9 + random(20)) }
        : line));
    },
    () => {
      lines = lines.map((line) => (line.kind === "task" && random(4) === 0
        ? { ...line, link: { predId: 1, type: ["FD", "DD", "FF"][random(3)], lag: 0 }, linkText: `${random(30)}FD` }
        : line));
    },
    () => {
      lines = lines.map((line) => (line.kind !== "task" && random(2) === 0 ? { ...line, collapsed: !line.collapsed } : line));
    },
    () => {
      lines = lines.map((line) => (line.kind === "task" && random(5) === 0
        ? { ...line, isOverEndLimit: !line.isOverEndLimit, nature: random(2) ? "reunion" : "" }
        : line));
    },
    () => {
      lines = lines.map((line, index) => ({ ...line, lineNumber: index + 1 }));
    },
    () => {
      const at = random(lines.length + 1);
      lines = [...lines.slice(0, at), newTask(), ...lines.slice(at)];
    },
    () => {
      const at = random(lines.length + 1);
      lines = [...lines.slice(0, at), newTask(), newTask(), ...lines.slice(at)];
    },
    () => {
      if (lines.length <= 2) return;
      const at = random(lines.length);
      lines = lines.filter((_, index) => index !== at);
    },
    () => {
      if (lines.length < 2) return;
      const from = random(lines.length);
      const moved = lines[from];
      const rest = lines.filter((_, index) => index !== from);
      const to = random(rest.length + 1);
      lines = [...rest.slice(0, to), moved, ...rest.slice(to)];
    },
    () => {
      lines = [...lines].reverse();
    },
    () => {
      options = { ...options, editable: !options.editable };
    },
    () => {
      options = { ...options, canMoveCycles: !options.canMoveCycles };
    },
    () => {
      options = { ...options, emptyMessage: options.emptyMessage ? "" : "Chargement des tâches…" };
    },
  ];
  for (let step = 1; step <= 300; step += 1) {
    const index = random(changes.length);
    changes[index]();
    table.render(lines, options);
    const fresh = makeTableWithGantt();
    fresh.table.render(lines, options);
    assert.deepEqual(snapshot(bodyOf(host)), snapshot(bodyOf(fresh.host)), `changement ${step} (n° ${index})`);
  }
});
