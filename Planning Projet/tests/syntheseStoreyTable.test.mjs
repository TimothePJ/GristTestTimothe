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
globalThis.document = document;
globalThis.Element = TableElement;
globalThis.window = {
  localStorage: { getItem: () => null, setItem() {} },
  addEventListener() {},
  clearTimeout() {},
  setTimeout: () => 0,
  innerWidth: 1200,
};

const { createSyntheseTaskTable, buildMenuItems, cellText, isEditableCell } = await import("../assets/js/ui/syntheseTaskTable.js");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

const storeyLine = (overrides = {}) => ({
  layout: "floor",
  look: "floor",
  kind: "storey",
  key: "storey:ss1",
  level: 0,
  zoneKey: "",
  floorKey: "ss1",
  name: "SS1",
  collapsed: false,
  durationDays: 5,
  start: new Date(2026, 0, 5),
  end: new Date(2026, 0, 9),
  childCount: 2,
  zoneCount: 1,
  missingZones: [{ zoneKey: "zone2batb", zoneName: "zone2batb", label: "Zone 2 Bât B" }],
  ...overrides,
});

const zoneInStorey = (overrides = {}) => ({
  layout: "floor",
  look: "zone",
  kind: "floor",
  key: "floor:zone1/ss1",
  level: 1,
  zoneKey: "zone1",
  floorKey: "ss1",
  name: "Zone 1",
  floorName: "SS1",
  collapsed: false,
  durationDays: 5,
  start: new Date(2026, 0, 5),
  end: new Date(2026, 0, 9),
  ...overrides,
});

const blockLine = () => storeyLine({ key: "storey:", floorKey: "", name: "Sans étage", missingZones: [] });

function makeTable(callbacks = {}) {
  const host = new TableElement("div");
  host.replaceChildren = function replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  };
  const table = createSyntheseTaskTable(host, callbacks);
  const lineOf = (key) => host.querySelector(`.stt-line[data-line-key="${key}"]`);
  return { host, table, lineOf };
}

const click = (element) => dispatch(element, "click", { button: 0 });

test("menu de la ligne étage : une entrée par zone manquante, puis suppression", () => {
  const items = buildMenuItems(storeyLine({
    missingZones: [
      { zoneKey: "zone2batb", zoneName: "zone2batb", label: "Zone 2 Bât B" },
      { zoneKey: "zone3", zoneName: "zone3", label: "Zone 3" },
    ],
  }));
  assert.deepEqual(items, [
    { label: "Ajouter un étage…", action: "addStorey", zoneKey: "", disabled: false },
    { label: "Ajouter « SS1 » dans « Zone 2 Bât B »", action: "addZoneToFloor", floorKey: "ss1", zoneKey: "zone2batb", disabled: false },
    { label: "Ajouter « SS1 » dans « Zone 3 »", action: "addZoneToFloor", floorKey: "ss1", zoneKey: "zone3", disabled: false },
    { label: "Supprimer l'étage", action: "deleteStorey", floorKey: "ss1", danger: true },
  ]);
  assert.equal(buildMenuItems(storeyLine(), { canAddFloor: false })[1].disabled, true);
  assert.equal(buildMenuItems(storeyLine(), { canAddFloor: false })[0].disabled, true);
});

test("menu de la ligne étage : aucune zone manquante, filtre de zone, bloc « Sans étage »", () => {
  assert.deepEqual(buildMenuItems(storeyLine({ missingZones: [] })), [
    { label: "Ajouter un étage…", action: "addStorey", zoneKey: "", disabled: false },
    { label: "Ajouter une zone", action: "addZoneToFloor", floorKey: "ss1", zoneKey: "", disabled: true },
    { label: "Supprimer l'étage", action: "deleteStorey", floorKey: "ss1", danger: true },
  ]);
  assert.deepEqual(buildMenuItems(storeyLine(), { zoneFiltered: true }), [
    { label: "Ajouter un étage…", action: "addStorey", zoneKey: "", disabled: true },
    { label: "Ajouter une zone", action: "addZoneToFloor", floorKey: "ss1", zoneKey: "", disabled: true },
    { label: "Supprimer l'étage", action: "deleteStorey", floorKey: "ss1", danger: true, disabled: true },
  ]);
  assert.deepEqual(buildMenuItems(blockLine()), [
    { label: "Ajouter un étage…", action: "addStorey", zoneKey: "", disabled: false },
  ]);
  assert.equal(buildMenuItems(blockLine(), { canAddFloor: false })[0].disabled, true);
  assert.equal(buildMenuItems(blockLine(), { zoneFiltered: true })[0].disabled, true);
});

test("menu d'une zone du bloc « Sans étage » : tâche, puis « Ajouter un étage… » avec la zone ; mode zone inchangé", () => {
  const zoneInBlock = { layout: "floor", look: "zone", kind: "zone", key: "zone:zone1", level: 1, zoneKey: "zone1", floorKey: "", name: "Zone 1" };
  assert.deepEqual(buildMenuItems(zoneInBlock), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zone1", floorKey: "" },
    { label: "Ajouter un étage…", action: "addStorey", zoneKey: "zone1", disabled: false },
  ]);
  assert.equal(buildMenuItems(zoneInBlock, { zoneFiltered: true })[1].disabled, true);
  assert.equal(buildMenuItems(zoneInBlock, { canAddFloor: false })[1].disabled, true);
  const { layout, look, ...legacy } = zoneInBlock;
  assert.deepEqual(buildMenuItems(legacy)[1], { label: "Ajouter un étage", action: "addFloor", zoneKey: "zone1", disabled: false });
});

test("menu d'une zone dans un étage : tâche, cycle, puis suppression dans cette zone", () => {
  assert.deepEqual(buildMenuItems(zoneInStorey()), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zone1", floorKey: "ss1" },
    { label: "Ajouter un cycle", action: "addCycle", zoneKey: "zone1", floorKey: "ss1", parentGroupRowId: null, disabled: false },
    { label: "Supprimer l'étage dans cette zone", action: "deleteFloor", zoneKey: "zone1", floorKey: "ss1", danger: true },
  ]);
  // Mode par zone : inchangé.
  const { look, layout, ...legacy } = zoneInStorey();
  assert.equal(buildMenuItems(legacy)[2].label, "Supprimer l'étage");
});

test("cellules : la ligne étage est récapitulative, son nom se saisit sauf « Sans étage » et zone dans l'étage", () => {
  assert.equal(cellText(storeyLine(), "duration"), "5 jours");
  assert.equal(cellText(storeyLine({ durationDays: null }), "duration"), "");
  assert.equal(isEditableCell(storeyLine(), "name", { editable: true }), true);
  assert.equal(isEditableCell(storeyLine(), "name", { editable: false }), false);
  assert.equal(isEditableCell(storeyLine(), "start", { editable: true }), false);
  assert.equal(isEditableCell(blockLine(), "name", { editable: true }), false);
  assert.equal(isEditableCell(zoneInStorey(), "name", { editable: true }), false);
  const { look, layout, ...legacy } = zoneInStorey();
  assert.equal(isEditableCell(legacy, "name", { editable: true }), true);
});

test("rendu : ligne étage au look étage, zone dans l'étage au look zone avec son emblème", () => {
  const { table, lineOf } = makeTable();
  table.render([
    storeyLine(),
    zoneInStorey({ structureLink: true, structureLinkNote: "Étage lié au coffrage 3021 de Structure." }),
    blockLine(),
    { layout: "floor", look: "zone", kind: "zone", key: "zone:zone1", level: 1, zoneKey: "zone1", floorKey: "", name: "Zone 1", collapsed: false },
    { layout: "floor", look: "task", kind: "task", key: "task:7", level: 2, zoneKey: "zone1", floorKey: "", taskId: 7, name: "Tâche", collapsed: false },
  ], { editable: true });

  const storey = lineOf("storey:ss1");
  assert.ok(storey.classes.has("stt-line--floor"));
  assert.equal(storey.dataset.kind, "storey");
  assert.equal(storey.dataset.look, "floor");
  assert.ok(storey.querySelector(".stt-toggle"));
  assert.equal(storey.querySelector(".stt-cell--duration").textContent, "5 jours");

  const zone = lineOf("floor:zone1/ss1");
  assert.ok(zone.classes.has("stt-line--zone"));
  assert.equal(zone.dataset.kind, "floor");
  assert.equal(zone.dataset.look, "zone");
  assert.equal(zone.querySelector(".stt-floor-link").title, "Étage lié au coffrage 3021 de Structure.");

  // Zone du bloc « Sans étage » et sa tâche : retrait par le niveau.
  assert.ok(lineOf("zone:zone1").classes.has("stt-line--zone"));
  assert.equal(lineOf("zone:zone1").dataset.layout, "floor");
  const task = lineOf("task:7");
  assert.ok(task.classes.has("is-in-block"));
  assert.equal(task.classes.has("is-in-floor"), false);
});

test("rendu en mode zone : classes et attributs inchangés", () => {
  const { table, lineOf } = makeTable();
  table.render([
    { kind: "floor", key: "floor:zone1/ss1", level: 1, zoneKey: "zone1", floorKey: "ss1", name: "SS1", collapsed: false },
    { kind: "task", key: "task:7", level: 2, zoneKey: "zone1", floorKey: "ss1", taskId: 7, name: "Tâche", collapsed: false },
  ], { editable: true });
  const floor = lineOf("floor:zone1/ss1");
  assert.ok(floor.classes.has("stt-line--floor"));
  assert.equal(floor.dataset.look, undefined);
  assert.equal(floor.dataset.layout, undefined);
  const task = lineOf("task:7");
  assert.ok(task.classes.has("is-in-floor"));
  assert.equal(task.classes.has("is-in-block"), false);
});

test("clic sur le triangle d'une ligne étage : onToggleStorey, « Sans étage » avec une clé vide", () => {
  const toggled = [];
  const { table, lineOf } = makeTable({ onToggleStorey: (floorKey) => toggled.push(floorKey) });
  table.render([storeyLine(), blockLine()], { editable: true });
  click(lineOf("storey:ss1").querySelector(".stt-toggle"));
  click(lineOf("storey:").querySelector(".stt-toggle"));
  assert.deepEqual(toggled, ["ss1", ""]);
});

test("clic sur le nom d'une ligne étage : saisie, Entrée renomme ; rien sur « Sans étage » ni la zone dans l'étage", () => {
  const renamed = [];
  const { table, lineOf, host } = makeTable({ onRenameStorey: (floorKey, value) => renamed.push([floorKey, value]) });
  table.render([storeyLine(), zoneInStorey(), blockLine()], { editable: true });

  click(lineOf("storey:").querySelector(".stt-cell--name"));
  click(lineOf("floor:zone1/ss1").querySelector(".stt-cell--name"));
  assert.equal(host.querySelector(".stt-input"), null);

  click(lineOf("storey:ss1").querySelector(".stt-cell--name"));
  const input = host.querySelector(".stt-input");
  assert.ok(input);
  assert.equal(input.value, "SS1");
  input.value = "SS2";
  dispatch(input, "keydown", { key: "Enter" });
  assert.deepEqual(renamed, [["ss1", "SS2"]]);
});

test("tableau non modifiable : le nom d'une ligne étage ne s'ouvre pas, un message de verrou est signalé", () => {
  let locked = 0;
  const { table, lineOf, host } = makeTable({ onLockedAttempt: () => { locked += 1; } });
  table.render([storeyLine()], { editable: false });
  click(lineOf("storey:ss1").querySelector(".stt-cell--name"));
  assert.equal(host.querySelector(".stt-input"), null);
  assert.equal(locked, 1);
});

test("startEditingStorey ouvre la saisie du nom de l'étage", () => {
  const { table, host } = makeTable();
  table.render([storeyLine(), blockLine()], { editable: true });
  table.startEditingStorey("");
  assert.equal(host.querySelector(".stt-input"), null);
  table.startEditingStorey("ss1");
  assert.equal(host.querySelector(".stt-input").value, "SS1");
});

test("entrées de menu : addZoneToFloor et deleteStorey appellent les rappels", async () => {
  const calls = [];
  const { table, lineOf, host } = makeTable({
    onAddZoneToFloor: (...args) => calls.push(["add", ...args]),
    onDeleteStorey: (...args) => calls.push(["delete", ...args]),
    onAddStorey: (...args) => calls.push(["storey", ...args]),
  });
  table.render([storeyLine({ floorKey: "rp1", key: "storey:rp1", name: "RP1" })], { editable: true });
  dispatch(lineOf("storey:rp1"), "contextmenu", { clientX: 10, clientY: 10 });
  const items = host.querySelector(".stt-menu").querySelectorAll("button");
  assert.deepEqual(items.map((item) => item.textContent), ["Ajouter un étage…", "Ajouter « RP1 » dans « Zone 2 Bât B »", "Supprimer l'étage"]);
  click(items[1]);
  dispatch(lineOf("storey:rp1"), "contextmenu", { clientX: 10, clientY: 10 });
  click(host.querySelector(".stt-menu").querySelectorAll("button")[2]);
  dispatch(lineOf("storey:rp1"), "contextmenu", { clientX: 10, clientY: 10 });
  click(host.querySelector(".stt-menu").querySelectorAll("button")[0]);
  assert.deepEqual(calls, [["add", "rp1", "zone2batb"], ["delete", "rp1"], ["storey", ""]]);
});

test("filtre de zone : les entrées du menu étage restent cliquables mais grisées", () => {
  const added = [];
  const { table, lineOf, host } = makeTable({ onAddStorey: (zoneKey) => added.push(zoneKey) });
  table.render([storeyLine()], { editable: true, zoneFiltered: true });
  dispatch(lineOf("storey:ss1"), "contextmenu", { clientX: 10, clientY: 10 });
  const items = host.querySelector(".stt-menu").querySelectorAll("button");
  assert.deepEqual(items.map((item) => item.textContent), ["Ajouter un étage…", "Ajouter une zone", "Supprimer l'étage"]);
  assert.ok(items.every((item) => item.getAttribute("aria-disabled") === "true"));
  click(items[0]);
  assert.deepEqual(added, [""], "grisée mais cliquable : le contrôleur explique le refus");

  // Zone du bloc « Sans étage » : même filtre.
  const block = makeTable({ onAddStorey: (zoneKey) => added.push(zoneKey) });
  block.table.render([{ layout: "floor", look: "zone", kind: "zone", key: "zone:zone1", level: 1, zoneKey: "zone1", floorKey: "", name: "Zone 1" }], { editable: true, zoneFiltered: true });
  dispatch(block.lineOf("zone:zone1"), "contextmenu", { clientX: 10, clientY: 10 });
  const zoneItems = block.host.querySelector(".stt-menu").querySelectorAll("button");
  assert.equal(zoneItems[1].getAttribute("aria-disabled"), "true");
  click(zoneItems[1]);
  assert.deepEqual(added, ["", "zone1"]);
});

// Retraits du nom en affichage par étage : étage 4 px, zone dans l'étage 20 px, cycle 32 px, tâche
// 46 px (affichage par zone : 4 / 16 / 32 / 46). La règle de l'étage ne touche que le retrait, et
// la saisie de son nom garde toute la cellule.
test("CSS : la ligne étage a le retrait du niveau 0", () => {
  assert.match(css, /\.stt-line\[data-kind="storey"\] \.stt-cell--name\s*\{\s*padding-left:\s*4px;\s*\}/);
  assert.match(css, /\.stt-line\[data-kind="storey"\] \.stt-cell--name\.is-editing\s*\{\s*padding-left:\s*0;\s*\}/);
  assert.match(css, /\.stt-line--zone\[data-layout="floor"\] \.stt-cell--name\s*\{[^}]*padding-left:\s*calc\(4px \+ var\(--stt-level, 0\) \* 16px\);/);
});

// Demande de l'utilisateur (04/11) : en affichage par étage, les tailles de texte s'inversent —
// l'étage prend celle d'une zone de l'affichage par zone (14 px), les zones celle d'un étage (taille
// du tableau). L'affichage par zone garde sa zone à 14 px.
test("CSS : tailles de texte inversées entre étage et zone en affichage par étage", () => {
  assert.match(css, /\.stt-line\[data-kind="storey"\]\[data-layout="floor"\] \.stt-cell--name\s*\{\s*font-size:\s*14px;\s*\}/);
  assert.match(css, /\.stt-line--zone\[data-layout="floor"\] \.stt-cell--name\s*\{\s*font-size:\s*inherit;\s*\}/);
  assert.match(css, /\.stt-line--zone \.stt-cell--name\s*\{[^}]*font-size:\s*14px;/);
});
