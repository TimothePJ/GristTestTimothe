// Fenêtre « Paramètre » de la vue Synthese : le modèle d'étage du projet montré comme un étage du vrai
// tableau (sans Début, Fin, zone ni Gantt) et modifié par le vrai contrôleur sur des lignes en mémoire.
// Rien ne part avant « Enregistrer », qui rend le JSON à onSave (jamais au vrai docApi de Grist).
// Droits, abandon, retour au modèle d'origine, avertissements, échecs ; whenIdle du contrôleur.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FakeElement, dispatch } from "./helpers/fakeDom.mjs";

// Mini DOM pour le tableau (copié de syntheseStoreyTable.test.mjs) : sélecteurs composés (étiquette,
// .classe, [attribut], [attribut="valeur"]) séparés par des espaces, recherche dans l'arbre, focus ;
// plus une <dialog> modale (showModal, close, open, évènement « close »).
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
    this.open = false;
    this.disabled = false;
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

  showModal() {
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    dispatch(this, "close");
  }
}

const documentListeners = new FakeElement("#document");
const document = Object.assign(documentListeners, {
  createElement: (tag) => new TableElement(tag),
  createTextNode: (text) => Object.assign(new TableElement("#text"), { textContent: text }),
  activeElement: null,
});
document.documentElement = new TableElement("html");
document.body = new TableElement("body");
globalThis.document = document;
globalThis.Element = TableElement;
const storage = new Map();
globalThis.window = {
  localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => { storage.set(key, String(value)); } },
  addEventListener() {},
  clearTimeout() {},
  setTimeout: () => 0,
  innerWidth: 1200,
  innerHeight: 800,
  confirm() {
    throw new Error("window.confirm ne doit pas être appelé : la confirmation est injectée.");
  },
};
// Le vrai docApi de Grist : la fenêtre ne doit jamais s'en servir.
const gristCalls = [];
globalThis.grist = {
  docApi: {
    async applyUserActions(actions) {
      gristCalls.push(actions);
      return { retValues: [] };
    },
  },
};

const { createParameterDialog } = await import("../assets/js/ui/syntheseParameterDialog.js");
const { createSyntheseTasksController } = await import("../assets/js/ui/syntheseTasksController.js");
const { FLOOR_TEMPLATE } = await import("../assets/js/services/syntheseFloorTemplate.js");
const {
  MODEL_PROJECT_NAME,
  serializeFloorTemplate,
  templateItemsFromRows,
  templateToRows,
} = await import("../assets/js/services/syntheseFloorParameter.js");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

const HELP = "Un nouvel étage de ce projet reçoit ces lignes, ces liens et ces durées. {E} est remplacé par le nom de l'étage. Les étages déjà créés ne changent pas.";
const ABANDON = "Abandonner les modifications du modèle ?";
const NO_TASK = "Le modèle doit garder au moins une tâche.";
const NO_COLUMN = "Créez la colonne Texte « Synthese_Parametre » dans Projets2 pour enregistrer un modèle.";
const INVALID = "Le modèle enregistré est illisible : modèle d'origine affiché.";
const NO_KICKOFF = "Sans tâche de Nature « Demarrage », la vue Global ne comparera pas le démarrage à celui de Structure.";
const SIGNATURE = "SIGNATURE PLANS SYNTHESE";
const KICKOFF = "DEMARRAGE GO {E} (date prévisionnelle)";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const click = (element) => dispatch(element, "click", { button: 0 });

function model(overrides = {}) {
  return { projectName: "HOTEL DIEU", items: FLOOR_TEMPLATE, invalid: false, canEdit: true, columnMissing: false, ...overrides };
}

// Tableau doublé : garde les rappels, les options et les rendus que lui envoie le contrôleur.
function spyTable(store) {
  return (host, callbacks, options) => {
    const table = { host, callbacks, options, renders: [], statuses: [] };
    store.push(table);
    return {
      render: (lines, renderOptions) => table.renders.push({ lines, options: renderOptions }),
      setStatus: (text, tone) => table.statuses.push({ text, tone }),
      startEditing() {},
      startEditingFloor() {},
      startEditingGroup() {},
      startEditingStorey() {},
    };
  };
}

// Fenêtre « Lien de la tâche » doublée : ce que le contrôleur lui montre.
function spyLinkDialog(opens) {
  return () => ({ open: (linkModel) => opens.push(linkModel), close() {} });
}

function setup({ spy = true, answer = () => true, onSave = null, linkOpens = null } = {}) {
  const saves = [];
  const questions = [];
  const tables = [];
  const controllers = [];
  const dialog = createParameterDialog({
    doc: document,
    confirm: (message) => {
      questions.push(message);
      return answer(message);
    },
    onSave: onSave || (async (text) => { saves.push(text); }),
    createController: (options) => {
      const controller = createSyntheseTasksController(linkOpens ? { ...options, createLinkDialog: spyLinkDialog(linkOpens) } : options);
      const activations = [];
      controllers.push({ options, controller, activations });
      const setActive = controller.setActive;
      return { ...controller, setActive: (active) => { activations.push(active); setActive(active); } };
    },
    ...(spy ? { createTable: spyTable(tables) } : {}),
  });
  const root = document.body.children.at(-1);
  const button = (label) => root.querySelectorAll("button").find((element) => element.textContent === label);
  const messageZone = () => root.querySelector(".synthese-parameter-dialog__messages");
  const messages = () => (messageZone().hidden ? [] : messageZone().children.map((line) => line.textContent));
  const table = () => tables.at(-1);
  const lines = () => table().renders.at(-1).lines;
  const taskLine = (name) => lines().find((line) => line.kind === "task" && line.name === name);
  return { dialog, root, saves, questions, tables, controllers, table, lines, taskLine, button, messageZone, messages };
}

const textOf = (line) => line.querySelector(".stt-text").textContent;

test("ouvrir : le modèle comme un étage, sans Début ni Fin ni zone", async () => {
  const env = setup({ spy: false });
  env.dialog.open(model());
  await flush();

  assert.equal(env.dialog.isOpen(), true);
  assert.equal(env.root.open, true);
  assert.equal(env.dialog.openedProject(), "HOTEL DIEU");
  assert.ok(env.root.classes.has("synthese-parameter-dialog"));
  const title = env.root.querySelector("h3").textContent;
  assert.ok(title.includes("Paramètre — modèle d'étage"));
  assert.ok(title.includes("HOTEL DIEU"));
  assert.equal(env.root.querySelector(".synthese-parameter-dialog__help").textContent, HELP);

  // L'étage « Étage type », sans sa ligne de zone ; ni Début, ni Fin, ni panneau du Gantt.
  const floor = env.root.querySelector('.stt-line[data-kind="floor"]');
  assert.equal(textOf(floor), "Étage type");
  assert.notEqual(floor.querySelector(".stt-cell--duration").textContent, "", "Durée récapitulative de l'étage");
  assert.equal(floor.querySelector(".stt-cell--name").classes.has("is-editable"), false, "nom de l'étage non modifiable");
  assert.equal(env.root.querySelector('.stt-line[data-kind="zone"]'), null);
  assert.equal(env.root.querySelector(".stt-cell--start"), null);
  assert.equal(env.root.querySelector(".stt-cell--end"), null);
  assert.equal(env.root.querySelector(".stt-right"), null);

  // La REUNION du cycle 3, puis SIGNATURE et DEMARRAGE en dernier.
  const tasks = env.root.querySelectorAll(".stt-line--task");
  assert.equal(tasks.length, 20);
  assert.deepEqual(tasks.slice(-2).map(textOf), [SIGNATURE, KICKOFF]);
  const cycle3 = env.root.querySelectorAll(".stt-line--group").find((line) => textOf(line) === "CYCLE 3");
  assert.ok(cycle3);
  const meetings = tasks.filter((line) => textOf(line) === "REUNION + DIFFUSION SYT" && line.dataset.groupRowId === cycle3.dataset.groupRowId);
  assert.equal(meetings.length, 1);
  assert.ok(tasks[0].querySelector(".stt-cell--duration").classes.has("is-editable"), "les tâches se saisissent");

  // Clic droit sur l'étage : seulement « Ajouter une tâche » et « Ajouter un cycle ».
  dispatch(floor, "contextmenu", { clientX: 10, clientY: 10 });
  assert.deepEqual(env.root.querySelector(".stt-menu").querySelectorAll("button").map((item) => item.textContent), ["Ajouter une tâche", "Ajouter une réunion", "Ajouter un cycle"]);

  // Pied : « Revenir au modèle d'origine » à gauche, « Annuler » et « Enregistrer » (principal) à droite.
  assert.ok(env.button("Revenir au modèle d'origine"));
  assert.ok(env.button("Annuler"));
  const save = env.button("Enregistrer");
  assert.ok(save.classes.has("synthese-button--primary"));
  assert.equal(save.disabled, false);
  assert.equal(env.messageZone().getAttribute("role"), "status");
  assert.deepEqual(env.messages(), [], "modèle d'origine : aucun avertissement");
  assert.equal(gristCalls.length, 0);
});

// Spec §9 : la numérotation suit ce qui est affiché. La ligne de zone, masquée, ne prend pas de numéro.
test("numéros de ligne : la ligne de zone masquée ne compte pas, dans le tableau et la fenêtre de lien", async () => {
  const linkOpens = [];
  const env = setup({ spy: false, linkOpens });
  env.dialog.open(model());
  await flush();
  const body = env.root.querySelector(".stt-body");
  const shown = body.children;
  const numberOf = (line) => line.querySelector(".stt-cell--line").textContent;
  const linkOf = (line) => line.querySelector(".stt-cell--link").textContent;
  const byName = (name) => shown.find((line) => textOf(line) === name);
  assert.equal(shown.length, 26);
  assert.deepEqual(shown.map(numberOf), shown.map((_, index) => String(index + 1)), "1 à 26, sans trou");
  assert.equal(numberOf(byName("Étage type")), "1");
  assert.equal(numberOf(byName("RECEPTION ARCH/TOPO/STR")), "2");
  assert.equal(linkOf(byName("FOND DE PLAN DE SYNTHESE NIV {E}")), "2DD");
  assert.equal(linkOf(byName("DIFFUSION FDS Indice 0")), "4FD");
  assert.equal(linkOf(byName(SIGNATURE)), "24FD+5");

  // « Modifier le lien… » : la fenêtre de lien propose les mêmes numéros que le tableau.
  dispatch(byName("FOND DE PLAN DE SYNTHESE NIV {E}"), "contextmenu", { clientX: 10, clientY: 10 });
  click(env.root.querySelector(".stt-menu").querySelectorAll("button").find((item) => item.textContent === "Modifier le lien…"));
  assert.equal(linkOpens.length, 1);
  const choices = linkOpens[0].rows.filter((row) => row.kind === "task");
  assert.equal(choices.length, 20);
  choices.forEach((row) => {
    const line = body.querySelector(`.stt-line--task[data-task-id="${row.taskId}"]`);
    assert.equal(String(row.lineNumber), numberOf(line), row.name);
  });
  assert.equal(choices.find((row) => row.selected).lineNumber, 2, "le lien actuel : RECEPTION, ligne 2");
});

test("scénario : ajouter un cycle, une tâche de 3 jours, enregistrer", async () => {
  const env = setup();
  env.dialog.open(model());
  await flush();
  assert.deepEqual(env.table().options, {
    hiddenFields: ["start", "end"],
    rightPane: false,
    templateMode: true,
    storageKeys: {
      leftWidth: "planning-projet.synthese-parametre.left-width",
      columnWidths: "planning-projet.synthese-parametre.column-widths",
    },
  });
  const { options } = env.controllers[0];
  assert.equal(options.loadFormworkStarts, null);
  assert.equal(options.saveLayout, null);
  assert.equal(options.skipZoneLines, true, "numéros de ligne sans la ligne de zone masquée");
  assert.notEqual(options.docApi, globalThis.grist.docApi, "le contrôleur écrit dans le faux docApi");
  assert.equal(options.context.getState().currentProject.name, MODEL_PROJECT_NAME);
  assert.equal(options.context.getState().selectedService, "Synthese");
  assert.equal(options.context.getState().accessMode, "editable");

  const floor = env.lines().find((line) => line.kind === "floor");
  await env.table().callbacks.onAddCycle(floor.zoneKey, floor.floorKey, null);
  const cycle = env.lines().find((line) => line.kind === "group" && line.name === "Nouveau cycle");
  assert.ok(cycle);
  await env.table().callbacks.onAddTask(floor.zoneKey, floor.floorKey, cycle.groupRowId, null);
  const task = env.taskLine("Nouvelle tâche");
  assert.ok(task);
  // La Durée attend derrière le nom dans la file du contrôleur : « Enregistrer » cliqué aussitôt doit
  // l'attendre (Review Focus 4).
  env.table().callbacks.onEdit(task.taskId, "name", "PLAN {E} BIS");
  env.table().callbacks.onEdit(task.taskId, "duration", "3");
  assert.equal(env.saves.length, 0, "rien d'enregistré avant le clic");
  click(env.button("Enregistrer"));
  await flush();

  assert.equal(env.saves.length, 1);
  const { version, items } = JSON.parse(env.saves[0]);
  assert.equal(version, 1);
  const names = items.map((item) => item.name);
  const cycleItem = items.find((item) => item.name === "Nouveau cycle");
  const taskItem = items.find((item) => item.name === "PLAN {E} BIS");
  assert.ok(taskItem, "les saisies encore en file sont dans le JSON");
  assert.ok(names.indexOf("Nouveau cycle") < names.indexOf(SIGNATURE), "le cycle arrive avant SIGNATURE");
  assert.deepEqual(names.slice(-2), [SIGNATURE, KICKOFF]);
  assert.equal(taskItem.parent, cycleItem.code);
  assert.equal(taskItem.days, 3);
  const cycle3 = items.find((item) => item.name === "CYCLE 3");
  const meeting = items.find((item) => item.name === "REUNION + DIFFUSION SYT" && item.parent === cycle3.code);
  assert.equal(taskItem.link, `${meeting.code} FD`);
  assert.equal(env.dialog.isOpen(), false, "fermée une fois onSave résolu");
  assert.equal(env.dialog.openedProject(), "");
  assert.deepEqual(env.controllers[0].activations, [true, false]);
  assert.equal(gristCalls.length, 0, "aucune écriture vers le vrai docApi");
});

test("Annuler avec modifications : confirmation, rien d'enregistré ; sans modification : pas de question", async () => {
  const clean = setup();
  clean.dialog.open(model());
  await flush();
  click(clean.button("Annuler"));
  assert.deepEqual(clean.questions, []);
  assert.equal(clean.dialog.isOpen(), false);

  let answer = false;
  const env = setup({ answer: () => answer });
  env.dialog.open(model());
  await flush();
  env.table().callbacks.onEdit(env.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "2");
  await flush();
  click(env.button("Annuler"));
  assert.deepEqual(env.questions, [ABANDON]);
  assert.equal(env.dialog.isOpen(), true, "refus : la fenêtre reste ouverte");
  // Échap : même question, la fermeture du navigateur est empêchée.
  const escape = dispatch(env.root, "cancel");
  assert.equal(escape.defaultPrevented, true);
  assert.deepEqual(env.questions, [ABANDON, ABANDON]);
  assert.equal(env.dialog.isOpen(), true);
  answer = true;
  click(env.root.querySelector(".synthese-link-dialog__close"));
  assert.deepEqual(env.questions, [ABANDON, ABANDON, ABANDON]);
  assert.equal(env.dialog.isOpen(), false);
  assert.equal(env.saves.length, 0);
  assert.deepEqual(env.controllers[0].activations, [true, false]);
});

test("close() : fermeture sans question (projet ou service changé), l'instance est oubliée", async () => {
  const env = setup();
  env.dialog.open(model());
  await flush();
  env.table().callbacks.onEdit(env.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "2");
  await flush();
  env.dialog.close();
  assert.deepEqual(env.questions, []);
  assert.equal(env.dialog.isOpen(), false);
  assert.equal(env.dialog.openedProject(), "");
  assert.deepEqual(env.controllers[0].activations, [true, false]);
  assert.equal(env.saves.length, 0);
  // Rouverte : modèle relu, sans modification en cours.
  env.dialog.open(model({ projectName: "ERA" }));
  await flush();
  assert.equal(env.dialog.openedProject(), "ERA");
  assert.equal(env.controllers.length, 2);
  assert.equal(env.taskLine("RECEPTION ARCH/TOPO/STR").durationDays, 0);
  click(env.button("Annuler"));
  assert.deepEqual(env.questions, []);
});

test("Revenir au modèle d'origine : contenu remplacé, rien d'enregistré tant qu'on n'enregistre pas", async () => {
  const custom = [
    { code: "A", name: "RECEPTION {E}", days: 3 },
    { code: "C", name: "CYCLE 1", nature: "Cycle" },
    { code: "B", name: "PLAN {E}", parent: "C", link: "A FD", days: 5 },
  ];
  let answer = false;
  const env = setup({ answer: () => answer });
  env.dialog.open(model({ items: custom }));
  await flush();
  assert.deepEqual(env.lines().filter((line) => line.kind === "task").map((line) => line.name), ["RECEPTION {E}", "PLAN {E}"]);

  click(env.button("Revenir au modèle d'origine"));
  await flush();
  const names = env.lines().filter((line) => line.kind === "task").map((line) => line.name);
  assert.equal(names.length, 20);
  assert.deepEqual(names.slice(-2), [SIGNATURE, KICKOFF]);
  assert.equal(env.saves.length, 0);
  assert.equal(env.dialog.isOpen(), true);
  assert.deepEqual(env.controllers[0].activations, [true, false], "l'ancienne instance est arrêtée");

  // Le contenu a changé : l'abandon se confirme.
  click(env.button("Annuler"));
  assert.deepEqual(env.questions, [ABANDON]);
  assert.equal(env.dialog.isOpen(), true);
  click(env.button("Enregistrer"));
  await flush();
  assert.deepEqual(env.saves, [serializeFloorTemplate(templateItemsFromRows(templateToRows(FLOOR_TEMPLATE)))]);
  assert.equal(env.dialog.isOpen(), false);
});

test("lecture seule (canEdit false) ou colonne absente : pas de saisie, Enregistrer grisé, message de la spec", async () => {
  // Vrai tableau : aucune cellule en saisie.
  const real = setup({ spy: false });
  real.dialog.open(model({ canEdit: false }));
  await flush();
  assert.ok(real.root.querySelector(".stt-line--task"));
  assert.equal(real.root.querySelector(".is-editable"), null);
  assert.equal(real.button("Enregistrer").disabled, true);
  assert.equal(real.button("Revenir au modèle d'origine").disabled, true);
  assert.equal(real.messages().length, 1, "la lecture seule est dite");
  real.dialog.close();

  // canEdit false : onEdit ne change rien, pas d'enregistrement.
  const env = setup();
  env.dialog.open(model({ canEdit: false }));
  await flush();
  assert.equal(env.controllers[0].options.context.getState().accessMode, "readonly");
  const reception = env.taskLine("RECEPTION ARCH/TOPO/STR");
  env.table().callbacks.onEdit(reception.taskId, "duration", "4");
  await flush();
  assert.equal(env.taskLine("RECEPTION ARCH/TOPO/STR").durationDays, 0);
  assert.equal(env.table().statuses.at(-1).tone, "error");
  click(env.button("Enregistrer"));
  await flush();
  assert.deepEqual(env.saves, []);
  click(env.button("Annuler"));
  assert.deepEqual(env.questions, [], "rien n'a changé : pas de question");

  // Colonne absente : modèle d'origine affiché en lecture, message de la spec, même avec « Editer ».
  const missing = setup();
  missing.dialog.open(model({ columnMissing: true, canEdit: true, items: [{ code: "A", name: "AUTRE" }] }));
  await flush();
  assert.equal(missing.lines().filter((line) => line.kind === "task").length, 20);
  assert.ok(missing.messages().includes(NO_COLUMN));
  assert.equal(missing.button("Enregistrer").disabled, true);
  missing.table().callbacks.onEdit(missing.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "4");
  await flush();
  assert.equal(missing.taskLine("RECEPTION ARCH/TOPO/STR").durationDays, 0);
  click(missing.button("Enregistrer"));
  await flush();
  assert.deepEqual(missing.saves, []);
  missing.dialog.setCanEdit(true);
  assert.equal(missing.button("Enregistrer").disabled, true, "sans colonne, jamais d'enregistrement");
  assert.equal(gristCalls.length, 0);
});

test("setCanEdit : la fenêtre suit « Editer » pendant qu'elle est ouverte", async () => {
  const env = setup();
  env.dialog.open(model());
  await flush();
  env.dialog.setCanEdit(false);
  assert.equal(env.button("Enregistrer").disabled, true);
  assert.equal(env.table().renders.at(-1).options.editable, false);
  env.table().callbacks.onEdit(env.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "4");
  await flush();
  assert.equal(env.taskLine("RECEPTION ARCH/TOPO/STR").durationDays, 0);

  env.dialog.setCanEdit(true);
  assert.equal(env.button("Enregistrer").disabled, false);
  assert.equal(env.table().renders.at(-1).options.editable, true);
  env.table().callbacks.onEdit(env.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "4");
  await flush();
  assert.equal(env.taskLine("RECEPTION ARCH/TOPO/STR").durationDays, 4);
  click(env.button("Enregistrer"));
  await flush();
  assert.equal(JSON.parse(env.saves[0]).items[0].days, 4);
});

test("modèle sans tâche : refus d'enregistrer, message", async () => {
  const env = setup();
  env.dialog.open(model({ items: [{ code: "C", name: "CYCLE 1", nature: "Cycle" }, { code: "A", name: "SEULE", parent: "C" }] }));
  await flush();
  await env.table().callbacks.onDeleteTask(env.taskLine("SEULE").taskId);
  await flush();
  assert.equal(env.lines().some((line) => line.kind === "task"), false);
  click(env.button("Enregistrer"));
  await flush();
  assert.deepEqual(env.saves, []);
  assert.ok(env.messages().includes(NO_TASK));
  assert.equal(env.dialog.isOpen(), true);
  assert.equal(env.button("Enregistrer").disabled, false, "on peut ajouter une tâche puis réessayer");

  // Une tâche ajoutée : le refus disparaît, l'enregistrement passe.
  const floor = env.lines().find((line) => line.kind === "floor");
  await env.table().callbacks.onAddTask(floor.zoneKey, floor.floorKey, null, null);
  await flush();
  assert.equal(env.messages().includes(NO_TASK), false);
  click(env.button("Enregistrer"));
  await flush();
  assert.equal(env.saves.length, 1);
});

test("modèle illisible : message affiché à l'ouverture", async () => {
  const env = setup();
  env.dialog.open(model({ invalid: true, items: [{ code: "A", name: "AUTRE" }] }));
  await flush();
  assert.deepEqual(env.messages(), [INVALID]);
  assert.equal(env.lines().filter((line) => line.kind === "task").length, 20, "modèle d'origine affiché");
  assert.equal(env.button("Enregistrer").disabled, false);
});

test("avertissements affichés et mis à jour après un geste", async () => {
  const env = setup();
  env.dialog.open(model());
  await flush();
  assert.deepEqual(env.messages(), []);
  await env.table().callbacks.onDeleteTask(env.taskLine(KICKOFF).taskId);
  await flush();
  assert.deepEqual(env.messages(), [NO_KICKOFF]);
  const warning = env.messageZone().children[0];
  assert.ok(warning.classes.has("is-warning"));
  // Sans blocage : « Enregistrer » reste possible.
  assert.equal(env.button("Enregistrer").disabled, false);
  click(env.button("Enregistrer"));
  await flush();
  assert.equal(env.saves.length, 1);
  assert.equal(JSON.parse(env.saves[0]).items.some((item) => item.nature === "Demarrage"), false);
});

test("échec de onSave : la fenêtre reste ouverte avec l'erreur", async () => {
  const env = setup({ onSave: async () => { throw new Error("réseau"); } });
  env.dialog.open(model());
  await flush();
  env.table().callbacks.onEdit(env.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "2");
  click(env.button("Enregistrer"));
  await flush();
  assert.equal(env.dialog.isOpen(), true);
  assert.equal(env.messages().length, 1);
  assert.ok(env.messageZone().children[0].classes.has("is-error"));
  assert.equal(env.button("Enregistrer").disabled, false, "on peut réessayer");

  const told = setup({ onSave: async () => { throw Object.assign(new Error("x"), { userMessage: "Vos droits sur Projets2 ne permettent pas d'enregistrer." }); } });
  told.dialog.open(model());
  await flush();
  click(told.button("Enregistrer"));
  await flush();
  assert.deepEqual(told.messages(), ["Vos droits sur Projets2 ne permettent pas d'enregistrer."]);
  assert.equal(told.dialog.isOpen(), true);
});

test("CSS : grande fenêtre dans la charte de la fenêtre de lien", () => {
  assert.match(css, /\.synthese-parameter-dialog\s*\{[^}]*width:\s*90vw;[^}]*height:\s*85vh;/);
  assert.match(css, /\.synthese-parameter-dialog\[open\]\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.synthese-parameter-dialog__table\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/);
  assert.match(css, /\.synthese-parameter-dialog__messages\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});

test("contrôleur : skipZoneLines numérote sans la ligne de zone ; par défaut (tableau principal), inchangé", async () => {
  async function numbers(extra) {
    const renders = [];
    const opens = [];
    let callbacks = null;
    const rows = templateToRows(FLOOR_TEMPLATE);
    const controller = createSyntheseTasksController({
      context: {
        getState: () => ({ currentProject: { name: MODEL_PROJECT_NAME, names: [MODEL_PROJECT_NAME] }, accessMode: "editable", selectedService: "Synthese" }),
        fetchContextRows: async () => rows.map((row) => ({ ...row })),
      },
      docApi: { applyUserActions: async () => ({ retValues: [] }) },
      createTable(tableCallbacks) {
        callbacks = tableCallbacks;
        return { render: (lines) => renders.push(lines), setStatus() {}, startEditing() {}, startEditingFloor() {}, startEditingGroup() {} };
      },
      createLinkDialog: spyLinkDialog(opens),
      timers: { setTimeout: () => 0, clearTimeout() {} },
      ...extra,
    });
    controller.setEditingEnabled(true);
    controller.setActive(true);
    await flush();
    const lines = renders.at(-1);
    const at = (name) => lines.find((line) => line.name === name);
    callbacks.onEditLink(at("FOND DE PLAN DE SYNTHESE NIV {E}").taskId);
    return {
      zone: lines.find((line) => line.kind === "zone").lineNumber,
      floor: at("Étage type").lineNumber,
      link: at("FOND DE PLAN DE SYNTHESE NIV {E}").linkText,
      choice: opens[0].rows.find((row) => row.selected).lineNumber,
    };
  }
  assert.deepEqual(await numbers({}), { zone: 1, floor: 2, link: "3DD", choice: 3 });
  assert.deepEqual(await numbers({ skipZoneLines: true }), { zone: null, floor: 1, link: "2DD", choice: 2 });
});

test("contrôleur : whenIdle se résout quand la file d'écriture est vide", async () => {
  const pending = [];
  const docApi = {
    applyUserActions: () => new Promise((resolve, reject) => pending.push({ resolve: () => resolve({ retValues: [null] }), reject })),
  };
  const rows = templateToRows(FLOOR_TEMPLATE);
  const table = {};
  const controller = createSyntheseTasksController({
    context: {
      getState: () => ({ currentProject: { name: MODEL_PROJECT_NAME, names: [MODEL_PROJECT_NAME] }, accessMode: "editable", selectedService: "Synthese" }),
      fetchContextRows: async () => rows.map((row) => ({ ...row })),
    },
    docApi,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return { render() {}, setStatus() {}, startEditing() {}, startEditingFloor() {}, startEditingGroup() {} };
    },
    timers: { setTimeout: () => 0, clearTimeout() {} },
  });
  controller.setEditingEnabled(true);
  controller.setActive(true);
  await flush();

  await controller.whenIdle();
  table.callbacks.onEdit(2, "duration", "2");
  table.callbacks.onEdit(2, "name", "RECEPTION");
  let idle = false;
  void controller.whenIdle().then(() => { idle = true; });
  await flush();
  assert.equal(pending.length, 1, "la seconde écriture attend la première");
  assert.equal(idle, false);
  pending.shift().resolve();
  await flush();
  assert.equal(pending.length, 1);
  assert.equal(idle, false, "la seconde écriture est encore en route");
  pending.shift().reject(new Error("refus"));
  await flush();
  assert.equal(idle, true, "résolue même après un échec");
});

test("Chrome : un second Échap sans activation ferme la fenêtre malgré preventDefault, la session est gardée", async () => {
  let answer = false;
  const env = setup({ answer: () => answer });
  env.dialog.open(model());
  await flush();
  env.table().callbacks.onEdit(env.taskLine("RECEPTION ARCH/TOPO/STR").taskId, "duration", "2");
  await flush();
  // Fermeture par le navigateur (close sans passer par la fenêtre) : la fenêtre se rouvre.
  env.root.close();
  assert.equal(env.dialog.isOpen(), true, "rouverte");
  assert.equal(env.dialog.openedProject(), "HOTEL DIEU", "session gardée");
  assert.equal(env.taskLine("RECEPTION ARCH/TOPO/STR").durationDays, 2, "lignes gardées");
  assert.deepEqual(env.controllers[0].activations, [true]);
  // Fermeture confirmée : elle reste fermée.
  answer = true;
  click(env.button("Annuler"));
  assert.equal(env.dialog.isOpen(), false);
  assert.equal(env.dialog.openedProject(), "");
  assert.deepEqual(env.controllers[0].activations, [true, false]);
});

test("fermeture : la fenêtre « Lien de la tâche » ouverte est fermée avec la fenêtre", async () => {
  const env = setup({ spy: false });
  env.dialog.open(model());
  await flush();
  const body = env.root.querySelector(".stt-body");
  const target = body.children.find((line) => textOf(line) === "FOND DE PLAN DE SYNTHESE NIV {E}");
  dispatch(target, "contextmenu", { clientX: 10, clientY: 10 });
  click(env.root.querySelector(".stt-menu").querySelectorAll("button").find((item) => item.textContent === "Modifier le lien…"));
  const linkDialog = document.body.children.find((node) => node !== env.root && node.className === "synthese-link-dialog");
  assert.ok(linkDialog, "fenêtre de lien trouvée");
  assert.equal(linkDialog.open, true, "ouverte");
  env.dialog.close();
  assert.equal(linkDialog.open, false, "fermée avec la fenêtre Paramètre");
});

// ---------- Onglet « Tâche contrôlée » : la tâche contrôlée des étages déjà créés ----------

const RESA_E = "PLAN DE SYNTHESE RESERVATIONS NIV {E}";
const CONTROL_HELP = "Choisissez la tâche contrôlée par rapport au coffrage des étages déjà créés. « Appliquer aux étages » la coche tout de suite dans chaque étage qui a cette tâche, au même nom et dans le même cycle ; un étage qui ne l'a pas n'est pas modifié. {E} remplace le nom de l'étage. Pour les étages à venir, cochez la tâche dans l'onglet « Modèle d'étage ».";
const ALL_FLOORS = ["R+1 (Zone 1)", "R+2 (Zone 1)", "R+1 (Zone 2)"];

// Ce que le tableau de tâches rend à l'onglet : trois étages, dont un seul (R+2) a un cycle 4.
function controlSource(overrides = {}) {
  return {
    ready: true,
    blockedMessage: "",
    floorCount: 3,
    choices: [
      { key: "c3-resa", name: RESA_E, path: ["CYCLE 3", "PLAN SYT CYCLE 3"], rank: 1, controlled: 2, change: ["R+1 (Zone 2)"], current: ["R+1 (Zone 1)", "R+2 (Zone 1)"], missing: [] },
      { key: "c3-reunion-2", name: "REUNION + DIFFUSION SYT", path: ["CYCLE 3"], rank: 2, controlled: 0, change: ALL_FLOORS, current: [], missing: [] },
      { key: "c4-resa", name: RESA_E, path: ["CYCLE 4"], rank: 1, controlled: 0, change: ["R+2 (Zone 1)"], current: [], missing: ["R+1 (Zone 1)", "R+1 (Zone 2)"] },
      { key: "go", name: "DEMARRAGE GO {E} (date prévisionnelle)", path: [], rank: 1, controlled: 0, change: ALL_FLOORS, current: [], missing: [] },
    ],
    ...overrides,
  };
}

function setupControl({ source = controlSource(), apply = null, answer = () => true } = {}) {
  const state = { source };
  const reads = [];
  const applied = [];
  const questions = [];
  const controllers = [];
  const tables = [];
  const dialog = createParameterDialog({
    doc: document,
    confirm: (message) => {
      questions.push(message);
      return answer(message);
    },
    onSave: async () => {},
    createController: (options) => {
      const controller = createSyntheseTasksController(options);
      controllers.push(controller);
      return controller;
    },
    createTable: spyTable(tables),
    getControlSource: () => {
      reads.push(1);
      return state.source;
    },
    applyControlTask: async (request) => {
      applied.push(request);
      return apply ? apply(request) : { ok: true, change: [], current: [], missing: [] };
    },
  });
  const root = document.body.children.at(-1);
  const button = (label) => root.querySelectorAll("button").find((element) => element.textContent === label);
  const panel = () => root.querySelector(".synthese-control-panel");
  const modelPanel = () => root.querySelectorAll(".synthese-parameter-dialog__panel").find((element) => element !== panel());
  const options = () => panel().querySelectorAll(".synthese-control-panel__option");
  const inputOf = (row) => row.querySelector("input");
  const option = (key) => options().find((row) => inputOf(row).value === key);
  const choose = (key) => dispatch(inputOf(option(key)), "change");
  const lines = () => {
    const zone = panel().querySelector(".synthese-control-panel__messages");
    return zone.hidden ? [] : zone.children.map((line) => [line.textContent, line.className]);
  };
  const title = () => root.querySelector("h3").textContent;
  return {
    dialog, root, state, reads, applied, questions, controllers, tables,
    button, panel, modelPanel, options, inputOf, option, choose, lines, title,
  };
}

const INFO = "synthese-parameter-dialog__message";
const WARNING = "synthese-parameter-dialog__message is-warning";
const ERROR = "synthese-parameter-dialog__message is-error";

test("onglets : le modèle d'abord ; « Tâche contrôlée » relit le tableau, le modèle reste monté", async () => {
  const env = setupControl();
  env.dialog.open(model());
  await flush();
  const bar = env.root.querySelector(".synthese-parameter-dialog__tabs");
  const tabs = bar.children;
  assert.equal(bar.getAttribute("role"), "tablist");
  assert.deepEqual(tabs.map((tab) => tab.textContent), ["Modèle d'étage", "Tâche contrôlée"]);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-selected")), ["true", "false"]);
  assert.equal(env.modelPanel().hidden, false);
  assert.equal(env.panel().hidden, true);
  assert.equal(env.title(), "Paramètre — modèle d'étage · HOTEL DIEU");
  assert.equal(env.reads.length, 0, "le tableau n'est pas lu tant que l'onglet n'est pas montré");

  click(env.button("Tâche contrôlée"));
  assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-selected")), ["false", "true"]);
  assert.deepEqual(tabs.map((tab) => tab.classes.has("is-active")), [false, true]);
  assert.equal(env.modelPanel().hidden, true);
  assert.equal(env.panel().hidden, false);
  assert.equal(env.title(), "Paramètre — tâche contrôlée · HOTEL DIEU");
  assert.equal(env.reads.length, 1);
  assert.equal(env.panel().querySelector(".synthese-control-panel__help").textContent, CONTROL_HELP);

  click(env.button("Modèle d'étage"));
  assert.equal(env.modelPanel().hidden, false);
  assert.equal(env.panel().hidden, true);
  assert.equal(env.title(), "Paramètre — modèle d'étage · HOTEL DIEU");
  assert.equal(env.controllers.length, 1, "le tableau du modèle n'a pas été recréé");
  click(env.button("Tâche contrôlée"));
  assert.equal(env.reads.length, 2, "relu à chaque retour sur l'onglet");
});

test("liste : les tâches rangées par cycle, le nombre d'étages qui les ont, celles déjà contrôlées", async () => {
  const env = setupControl();
  env.dialog.open(model());
  await flush();
  click(env.button("Tâche contrôlée"));
  const list = env.panel().querySelector(".synthese-control-panel__list");
  assert.equal(list.getAttribute("role"), "radiogroup");
  const isCycle = (node) => node.classes.has("synthese-control-panel__group");
  const shown = list.children.map((node) => [
    isCycle(node) ? "cycle" : "tâche",
    node.style["--scp-level"],
    isCycle(node) ? node.textContent : node.querySelector(".synthese-control-panel__name").textContent,
  ]);
  assert.deepEqual(shown, [
    ["cycle", "0", "CYCLE 3"],
    ["cycle", "1", "PLAN SYT CYCLE 3"],
    ["tâche", "2", RESA_E],
    // Retour dans le cycle 3 : son titre n'est pas répété ; la seconde réunion du cycle porte son rang.
    ["tâche", "1", "REUNION + DIFFUSION SYT (2)"],
    ["cycle", "0", "CYCLE 4"],
    ["tâche", "1", RESA_E],
    ["tâche", "0", "DEMARRAGE GO {E} (date prévisionnelle)"],
  ]);
  const cell = (key, name) => env.option(key).querySelector(`.synthese-control-panel__${name}`);
  assert.equal(cell("c3-resa", "count").textContent, "3 étages sur 3");
  assert.equal(cell("c3-resa", "count").classes.has("is-partial"), false);
  assert.equal(cell("c3-resa", "state").textContent, "contrôlée dans 2 étages");
  assert.equal(cell("c4-resa", "count").textContent, "1 étage sur 3");
  assert.equal(cell("c4-resa", "count").classes.has("is-partial"), true, "des étages n'ont pas cette tâche");
  assert.equal(cell("c4-resa", "state").textContent, "");
  const inputs = env.options().map(env.inputOf);
  assert.ok(inputs.every((input) => input.type === "radio" && input.name === "syntheseControlTask" && !input.checked));
  assert.equal(env.button("Appliquer aux étages").disabled, true, "rien de choisi");
  assert.deepEqual(env.lines(), []);
});

test("choisir une tâche du cycle 4 : les étages à trois cycles sont annoncés, puis laissés tels quels", async () => {
  const env = setupControl({
    apply: () => {
      env.state.source = controlSource({
        choices: controlSource().choices.map((choice) => (choice.key === "c4-resa"
          ? { ...choice, controlled: 1, change: [], current: ["R+2 (Zone 1)"] }
          : choice)),
      });
      return { ok: true, change: ["R+2 (Zone 1)"], current: [], missing: ["R+1 (Zone 1)", "R+1 (Zone 2)"] };
    },
  });
  env.dialog.open(model());
  await flush();
  click(env.button("Tâche contrôlée"));
  env.choose("c4-resa");
  assert.equal(env.inputOf(env.option("c4-resa")).checked, true);
  assert.equal(env.option("c4-resa").classes.has("is-selected"), true);
  assert.equal(env.option("c3-resa").classes.has("is-selected"), false);
  assert.deepEqual(env.lines(), [
    [`« ${RESA_E} » deviendra la tâche contrôlée de 1 étage.`, INFO],
    ["2 étages n'ont pas cette tâche et ne seront pas modifiés : R+1 (Zone 1), R+1 (Zone 2).", WARNING],
  ]);
  const apply = env.button("Appliquer aux étages");
  assert.equal(apply.disabled, false);
  assert.ok(apply.classes.has("synthese-button--primary"));

  click(apply);
  assert.equal(apply.disabled, true, "écriture en cours");
  assert.ok(env.options().every((row) => env.inputOf(row).disabled));
  await flush();
  assert.deepEqual(env.applied, [{ key: "c4-resa" }]);
  assert.deepEqual(env.lines(), [
    [`« ${RESA_E} » est maintenant la tâche contrôlée de 1 étage.`, INFO],
    ["2 étages non modifiés, la tâche n'y existe pas : R+1 (Zone 1), R+1 (Zone 2).", WARNING],
  ]);
  // La liste est relue : la tâche est en place dans R+2, plus rien à appliquer.
  assert.equal(env.option("c4-resa").querySelector(".synthese-control-panel__state").textContent, "contrôlée dans 1 étage");
  assert.equal(env.inputOf(env.option("c4-resa")).checked, true, "le choix reste coché");
  assert.equal(env.inputOf(env.option("c4-resa")).disabled, false);
  assert.equal(apply.disabled, true);
  assert.equal(gristCalls.length, 0, "l'onglet n'écrit que par le tableau de tâches");

  // Un autre choix efface le résultat et montre ce qu'il changerait.
  env.choose("c3-resa");
  assert.deepEqual(env.lines(), [
    [`« ${RESA_E} » deviendra la tâche contrôlée de 1 étage ; elle l'est déjà dans 2 étages.`, INFO],
  ]);
});

test("déjà en place partout : rien à appliquer", async () => {
  const source = controlSource({
    floorCount: 1,
    choices: [{ key: "only", name: RESA_E, path: ["CYCLE 3"], rank: 1, controlled: 1, change: [], current: ["R+1 (Zone 1)"], missing: [] }],
  });
  const env = setupControl({ source });
  env.dialog.open(model());
  await flush();
  click(env.button("Tâche contrôlée"));
  env.choose("only");
  assert.deepEqual(env.lines(), [[`Rien à changer : « ${RESA_E} » est déjà la tâche contrôlée du seul étage qui l'a.`, INFO]]);
  assert.equal(env.button("Appliquer aux étages").disabled, true);
  click(env.button("Appliquer aux étages"));
  await flush();
  assert.deepEqual(env.applied, []);
});

test("écriture impossible : tableau verrouillé, étages pas lus, projet sans étage", async () => {
  const locked = "Activez « Editer » dans le bandeau pour modifier les tâches.";
  const env = setupControl({ source: controlSource({ blockedMessage: locked }) });
  env.dialog.open(model());
  await flush();
  click(env.button("Tâche contrôlée"));
  assert.deepEqual(env.lines(), [[locked, INFO]]);
  env.choose("c4-resa");
  assert.equal(env.lines()[0][0], locked);
  assert.equal(env.lines().length, 3, "ce que le choix changerait reste lisible");
  assert.equal(env.button("Appliquer aux étages").disabled, true);

  // Pas encore lus, ou tableau absent (null).
  for (const source of [controlSource({ ready: false }), null]) {
    env.state.source = source;
    click(env.button("Modèle d'étage"));
    click(env.button("Tâche contrôlée"));
    assert.deepEqual(env.lines(), [["Les étages du projet ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.", INFO]]);
    assert.equal(env.options().length, 0);
    assert.equal(env.panel().querySelector(".synthese-control-panel__list").hidden, true);
    assert.equal(env.button("Appliquer aux étages").disabled, true);
  }

  env.state.source = controlSource({ floorCount: 0, choices: [] });
  click(env.button("Modèle d'étage"));
  click(env.button("Tâche contrôlée"));
  assert.deepEqual(env.lines(), [["Ce projet n'a pas encore d'étage.", INFO]]);
});

test("refus ou erreur à l'écriture : dit en rouge, on peut réessayer", async () => {
  let attempt = 0;
  const env = setupControl({
    apply: () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, error: "L'enregistrement dans Grist a échoué. Réessayez." };
      throw new Error("coupure");
    },
  });
  env.dialog.open(model());
  await flush();
  click(env.button("Tâche contrôlée"));
  env.choose("go");
  click(env.button("Appliquer aux étages"));
  await flush();
  assert.deepEqual(env.lines(), [["L'enregistrement dans Grist a échoué. Réessayez.", ERROR]]);
  assert.equal(env.button("Appliquer aux étages").disabled, false);
  click(env.button("Appliquer aux étages"));
  await flush();
  assert.deepEqual(env.lines(), [["La tâche contrôlée n'a pas pu être changée. Réessayez.", ERROR]]);
  assert.equal(attempt, 2);
});

test("« Fermer » ferme la fenêtre ; rouverte, elle revient au modèle sans choix ni résultat", async () => {
  let release = null;
  const env = setupControl({
    apply: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, change: ["R+2 (Zone 1)"], current: [], missing: [] });
    }),
  });
  env.dialog.open(model());
  await flush();
  click(env.button("Tâche contrôlée"));
  env.choose("c4-resa");
  click(env.button("Appliquer aux étages"));
  await flush();
  click(env.button("Fermer"));
  assert.equal(env.dialog.isOpen(), false);
  assert.deepEqual(env.questions, [], "modèle non modifié : pas de question");

  env.dialog.open(model());
  await flush();
  assert.equal(env.modelPanel().hidden, false, "onglet du modèle");
  assert.equal(env.panel().hidden, true);
  click(env.button("Tâche contrôlée"));
  const untouched = () => env.options().every((row) => !env.inputOf(row).checked && !env.inputOf(row).disabled);
  assert.ok(untouched(), "ni choix ni écriture en cours");
  assert.deepEqual(env.lines(), []);

  // La réponse de l'écriture d'avant la fermeture arrive maintenant : elle n'est montrée nulle part.
  release();
  await flush();
  assert.ok(untouched());
  assert.deepEqual(env.lines(), [], "pas de résultat d'une écriture de la session précédente");
});

test("« Fermer » avec un modèle modifié : l'abandon se confirme, comme « Annuler »", async () => {
  let answer = false;
  const env = setupControl({ answer: () => answer });
  env.dialog.open(model());
  await flush();
  const table = env.tables.at(-1);
  const first = table.renders.at(-1).lines.find((line) => line.kind === "task");
  table.callbacks.onEdit(first.taskId, "duration", "2");
  await flush();
  click(env.button("Tâche contrôlée"));
  click(env.button("Fermer"));
  assert.deepEqual(env.questions, [ABANDON]);
  assert.equal(env.dialog.isOpen(), true, "refus : la fenêtre reste ouverte, sur le même onglet");
  assert.equal(env.panel().hidden, false);
  answer = true;
  click(env.button("Fermer"));
  assert.equal(env.dialog.isOpen(), false);
});

test("CSS : onglets, panneaux masqués, liste qui défile, pied en bas", () => {
  assert.match(css, /\.synthese-parameter-dialog__tab\.is-active\s*\{[^}]*color:\s*#004990;/);
  assert.match(css, /\.synthese-parameter-dialog__panel\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*display:\s*flex;/);
  assert.match(css, /\.synthese-parameter-dialog__panel\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.synthese-control-panel__list\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/);
  assert.match(css, /\.synthese-control-panel__option\s*\{[^}]*padding:[^;]*var\(--scp-level, 0\) \* 16px\)/);
  assert.match(css, /\.synthese-control-panel__messages\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.synthese-control-panel__footer\s*\{[^}]*margin-top:\s*auto;/);
});
