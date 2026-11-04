// Fenêtre « Ajouter un étage » de la vue Synthese (affichage par étage) : nom, zones à cocher
// (celles qui ont déjà l'étage grisées pendant la saisie), « Créer » et « Annuler ».
import test from "node:test";
import assert from "node:assert/strict";

import { dispatch } from "./helpers/fakeDom.mjs";
import { createFloorDialog } from "../assets/js/ui/syntheseFloorDialog.js";

// Mini DOM : arbre, classes, état des champs (value, checked, disabled, hidden), <dialog> modale.
class Node {
  constructor(tag, className = "") {
    this.tagName = String(tag).toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set(String(className).split(/\s+/).filter(Boolean));
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    const owner = this;
    this.classList = {
      add: (...names) => names.forEach((name) => owner.classes.add(name)),
      remove: (...names) => names.forEach((name) => owner.classes.delete(name)),
      toggle: (name, force) => ((force === undefined ? !owner.classes.has(name) : force) ? owner.classes.add(name) : owner.classes.delete(name)),
      contains: (name) => owner.classes.has(name),
    };
  }

  get className() {
    return [...this.classes].join(" ");
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ listener });
  }

  all(predicate, found = []) {
    this.children.forEach((child) => {
      if (predicate(child)) found.push(child);
      child.all(predicate, found);
    });
    return found;
  }

  byClass(name) {
    return this.all((node) => node.classes.has(name));
  }

  focus() {}

  select() {
    this.selected = true;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }
}

function setup() {
  const body = new Node("body");
  const doc = {
    body,
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => Object.assign(new Node("#text"), { textContent: text }),
  };
  const submitted = [];
  const dialog = createFloorDialog({ doc, onSubmit: (value) => submitted.push(value) });
  const root = body.children[0];
  const els = {
    root,
    name: root.all((node) => node.tagName === "INPUT" && node.type === "text")[0],
    zones: () => root.byClass("synthese-floor-dialog__zone"),
    boxes: () => root.all((node) => node.tagName === "INPUT" && node.type === "checkbox"),
    notes: () => root.byClass("synthese-floor-dialog__note"),
    error: root.byClass("synthese-link-dialog__error")[0],
    submit: root.byClass("synthese-link-dialog__submit")[0],
    cancel: root.byClass("synthese-link-dialog__cancel")[0],
    close: root.byClass("synthese-link-dialog__close")[0],
    form: root.byClass("synthese-link-dialog__form")[0],
    zoneInput: root.all((node) => node.tagName === "INPUT" && node.type === "text")[1],
    addZone: root.byClass("synthese-floor-dialog__add")[0],
  };
  return { dialog, els, submitted };
}

const ZONES = [
  { zoneKey: "z1", label: "Zone 1" },
  { zoneKey: "z2", label: "Zone 2" },
  { zoneKey: "z3", label: "Zone 3" },
];

function makeModel(overrides = {}) {
  return {
    name: "Nouvel étage",
    zones: ZONES,
    checked: ["z2"],
    takenZones: (name) => new Set(name.trim().toLowerCase() === "ss1" ? ["z1", "z3"] : []),
    validate: () => ({ ok: true }),
    checkZoneName: (raw) => {
      const text = raw.trim();
      if (!text) return { ok: false, error: "Donnez un nom à la zone." };
      const known = ZONES.find((zone) => zone.label.toLowerCase() === text.toLowerCase());
      return known
        ? { ok: true, existing: true, zoneKey: known.zoneKey, label: known.label }
        : { ok: true, existing: false, zoneKey: `k:${text.toLowerCase()}`, label: text };
    },
    ...overrides,
  };
}

function typeName(els, value) {
  els.name.value = value;
  dispatch(els.name, "input");
}

function tick(els, index, checked) {
  els.boxes()[index].checked = checked;
  dispatch(els.boxes()[index], "change");
}

test("ouverture : modale, titre, nom proposé en indication grisée (champ vide), zones avec la zone cliquée cochée", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel());
  assert.equal(dialog.isOpen(), true);
  assert.ok(els.root.classes.has("synthese-link-dialog") && els.root.classes.has("synthese-floor-dialog"));
  assert.equal(els.root.all((node) => node.tagName === "H3")[0].textContent, "Ajouter un étage");
  assert.equal(els.name.value, "", "le champ part vide");
  assert.equal(els.name.placeholder, "Nouvel étage", "le nom proposé n'est qu'une indication");
  assert.deepEqual(
    els.zones().map((zone) => zone.all((node) => node.tagName === "SPAN")[0].textContent),
    ["Zone 1", "Zone 2", "Zone 3"],
  );
  assert.deepEqual(els.boxes().map((box) => box.checked), [false, true, false]);
  assert.equal(els.submit.disabled, true, "« Créer » attend un nom tapé");
  assert.equal(els.error.hidden, true);
  typeName(els, "R+1");
  assert.equal(els.submit.disabled, false);
});

test("nom pris dans une zone : zone décochée, grisée, « déjà présent » ; un autre nom la libère", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel({ checked: ["z1"] }));
  assert.equal(els.boxes()[0].checked, true);
  typeName(els, "SS1");
  assert.deepEqual(els.boxes().map((box) => box.disabled), [true, false, true]);
  assert.deepEqual(els.boxes().map((box) => box.checked), [false, false, false]);
  assert.deepEqual(els.notes().map((note) => [note.hidden, note.textContent]), [
    [false, "déjà présent"], [true, "déjà présent"], [false, "déjà présent"],
  ]);
  assert.ok(els.zones()[0].classes.has("is-disabled"));
  assert.equal(els.submit.disabled, true, "plus aucune zone cochée");
  typeName(els, "R+1");
  assert.deepEqual(els.boxes().map((box) => box.disabled), [false, false, false]);
  assert.ok(els.notes().every((note) => note.hidden));
  assert.equal(els.zones()[0].classes.has("is-disabled"), false);
  assert.equal(els.boxes()[0].checked, true, "la coche voulue revient avec le nom libre");
  assert.equal(els.submit.disabled, false);
});

test("« Créer » grisé : nom vide, ou aucune zone cochée", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel());
  typeName(els, "   ");
  assert.equal(els.submit.disabled, true);
  typeName(els, "R+2");
  assert.equal(els.submit.disabled, false);
  tick(els, 1, false);
  assert.equal(els.submit.disabled, true);
  tick(els, 0, true);
  assert.equal(els.submit.disabled, false);
});

test("validation refusée : message dans la fenêtre, elle reste ouverte, rien n'est rendu", () => {
  const calls = [];
  const { dialog, els, submitted } = setup();
  dialog.open(makeModel({ validate: (name, keys, news) => { calls.push([name, keys, news]); return { ok: false, error: "Refusé." }; } }));
  typeName(els, "R+1");
  dispatch(els.form, "submit");
  assert.deepEqual(calls, [["R+1", ["z2"], []]]);
  assert.equal(els.error.hidden, false);
  assert.equal(els.error.textContent, "Refusé.");
  assert.equal(dialog.isOpen(), true);
  assert.deepEqual(submitted, []);
  typeName(els, "Autre");
  assert.equal(els.error.hidden, true, "le message part à la saisie suivante");
});

test("validation acceptée : la fenêtre se ferme puis onSubmit({ name, zoneKeys })", () => {
  const { dialog, els, submitted } = setup();
  dialog.open(makeModel({ checked: ["z1"] }));
  typeName(els, "  R+3 ");
  tick(els, 2, true);
  dispatch(els.form, "submit");
  assert.equal(dialog.isOpen(), false);
  assert.deepEqual(submitted, [{ name: "R+3", zoneKeys: ["z1", "z3"], newZones: [] }]);
});

test("« Annuler », « × » et Échap ferment sans rien rendre", () => {
  const { dialog, els, submitted } = setup();
  dialog.open(makeModel());
  dispatch(els.cancel, "click");
  assert.equal(dialog.isOpen(), false);
  dialog.open(makeModel());
  dispatch(els.close, "click");
  assert.equal(dialog.isOpen(), false);
  dialog.open(makeModel());
  dispatch(els.root, "cancel");
  els.root.close();
  dialog.open(makeModel());
  typeName(els, "R+1");
  dispatch(els.form, "submit");
  assert.equal(submitted.length, 1, "seul le dernier envoi compte");
  assert.deepEqual(submitted, [{ name: "R+1", zoneKeys: ["z2"], newZones: [] }]);
});

test("réouverture : zones et nom refaits à partir du nouveau modèle", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel());
  dialog.open(makeModel({ name: "Autre", zones: ZONES.slice(0, 1), checked: [] }));
  assert.equal(els.name.value, "");
  assert.equal(els.name.placeholder, "Autre");
  assert.equal(els.boxes().length, 1);
  assert.equal(els.submit.disabled, true);
});

// --- Nouvelles zones ---

function addNewZone(els, value) {
  els.zoneInput.value = value;
  dispatch(els.addZone, "click");
}

const rowLabels = (els) => els.zones().map((zone) => zone.all((node) => node.tagName === "SPAN")[0].textContent);

test("« Nouvelle zone » : champ et bouton « Ajouter la zone » (type button) sous la liste", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel());
  assert.equal(els.addZone.textContent, "Ajouter la zone");
  assert.equal(els.addZone.type, "button");
  assert.ok(els.root.all((node) => node.textContent === "Nouvelle zone").length >= 1);
});

test("ajouter une zone : ligne cochée « nouvelle », champ vidé, « Créer » possible avec elle seule", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel({ checked: [] }));
  typeName(els, "R+1");
  assert.equal(els.submit.disabled, true);
  addNewZone(els, " Zone 4 ");
  assert.deepEqual(rowLabels(els), ["Zone 1", "Zone 2", "Zone 3", "Zone 4"]);
  assert.equal(els.boxes()[3].checked, true);
  assert.equal(els.boxes()[3].disabled, false);
  assert.deepEqual(els.notes().map((note) => [note.hidden, note.textContent]).at(-1), [false, "nouvelle"]);
  assert.equal(els.zoneInput.value, "");
  assert.equal(els.error.hidden, true);
  assert.equal(els.submit.disabled, false);
  // Une seconde fois : pas de doublon, la zone est simplement recochée.
  tick(els, 3, false);
  addNewZone(els, "zone 4");
  assert.equal(els.boxes().length, 4);
  assert.equal(els.boxes()[3].checked, true);
});

test("Entrée dans le champ de zone = « Ajouter la zone », sans envoyer le formulaire", () => {
  const { dialog, els, submitted } = setup();
  dialog.open(makeModel());
  els.zoneInput.value = "Zone 4";
  const event = dispatch(els.zoneInput, "keydown", { key: "Enter" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(rowLabels(els).at(-1), "Zone 4");
  assert.deepEqual(submitted, []);
  assert.equal(dialog.isOpen(), true);
  const other = dispatch(els.zoneInput, "keydown", { key: "a" });
  assert.equal(other.defaultPrevented, false);
});

test("zone existante : cochée avec un message ; déjà présent dans cet étage : pas cochée, autre message", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel({ checked: [] }));
  addNewZone(els, "zone 3");
  assert.equal(els.boxes().length, 3, "pas de doublon");
  assert.deepEqual(els.boxes().map((box) => box.checked), [false, false, true]);
  assert.equal(els.error.hidden, false);
  assert.equal(els.error.textContent, "La zone « Zone 3 » existe déjà : elle est cochée.");
  assert.equal(els.error.classList.contains("is-info"), true, "simple information, pas un refus");
  assert.equal(els.zoneInput.value, "", "la saisie est consommée");
  typeName(els, "SS1");
  addNewZone(els, "Zone 1");
  assert.equal(els.boxes()[0].checked, false);
  assert.equal(els.error.textContent, "La zone « Zone 1 » a déjà l'étage « SS1 ».");
  assert.equal(els.error.classList.contains("is-info"), false);
});

test("zone refusée : message, saisie conservée", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel());
  addNewZone(els, "   ");
  assert.equal(els.error.hidden, false);
  assert.equal(els.error.textContent, "Donnez un nom à la zone.");
  assert.equal(els.boxes().length, 3);
  const refusing = setup();
  refusing.dialog.open(makeModel({ checkZoneName: () => ({ ok: false, error: "Refusée." }) }));
  addNewZone(refusing.els, "---");
  assert.equal(refusing.els.error.textContent, "Refusée.");
  assert.equal(refusing.els.zoneInput.value, "---");
});

test("envoi : seules les nouvelles zones cochées partent, dans l'ordre d'ajout", () => {
  const calls = [];
  const { dialog, els, submitted } = setup();
  dialog.open(makeModel({ checked: [], validate: (name, keys, news) => { calls.push([name, keys, news]); return { ok: true }; } }));
  addNewZone(els, "Zone 4");
  addNewZone(els, "Zone 5");
  addNewZone(els, "Zone 6");
  tick(els, 4, false);
  typeName(els, "R+1");
  dispatch(els.form, "submit");
  assert.deepEqual(calls, [["R+1", [], ["Zone 4", "Zone 6"]]]);
  assert.deepEqual(submitted, [{ name: "R+1", zoneKeys: [], newZones: ["Zone 4", "Zone 6"] }]);
  assert.equal(dialog.isOpen(), false);
});

test("réouverture : les nouvelles zones de la fois précédente disparaissent", () => {
  const { dialog, els } = setup();
  dialog.open(makeModel());
  addNewZone(els, "Zone 4");
  dialog.open(makeModel());
  assert.equal(els.boxes().length, 3);
  assert.equal(els.zoneInput.value, "");
});
