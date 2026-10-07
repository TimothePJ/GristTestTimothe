import test from "node:test";
import assert from "node:assert/strict";

import { createStructureLinkDialog, renderStructureLink } from "../assets/js/ui/structureLinkDialog.js";
import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

const HINT = "Faites glisser un coffrage sur un étage de la même zone.";
const NO_LINK_COLUMN = "La colonne « Lien_Structure » (Texte) manque dans Planning_Projet : ajoutez-la pour lier les étages aux coffrages.";

// Planning_Projet, tous services : trois coffrages de Structure (Zone 1 : 3001 et 3002 ; Zone 2 : 3010).
const PROJECT_ROWS = [
  { id: 20, Taches: "PH SS1", Zone: "Zone 1", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3001" },
  { id: 21, Taches: "PH SS2", Zone: "Zone 1", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3002" },
  { id: 22, Taches: "RDC", Zone: "Zone 2", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3010" },
];
// Liste de plans : seul le coffrage 3001 a été diffusé à l'indice 0 (jeudi 27/11/25).
const PLAN_ROWS = [
  { Type_document: "COFFRAGE", NumeroDocument: "3001", Indice: "0", DateDiffusion: "2025-11-27", Service: "Structure" },
];

// Lignes du tableau de tâches : Zone 1 avec SS1 (RECEPTION et FOND DE PLAN liés « même début »)
// et SS2 (vide) ; Zone 2 avec RDC (vide).
function syntheseRows({ ss1Link = "", planStart = null } = {}) {
  const base = {
    NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Groupe: "", Etage: false, Nature: "", Parent: "", Lien: "",
    Lien_Structure: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0,
  };
  return [
    { ...base, id: 11, Taches: "SS1", Zone: "Zone 1", Etage: true, Lien_Structure: ss1Link },
    { ...base, id: 12, Taches: "SS2", Zone: "Zone 1", Etage: true },
    { ...base, id: 13, Taches: "RDC", Zone: "Zone 2", Etage: true },
    { ...base, id: 30, Taches: "RECEPTION ARCH/TOPO/STR", Zone: "Zone 1", Groupe: "SS1", Diff_coffrage: planStart, Diff_armature: planStart },
    { ...base, id: 31, Taches: "FOND DE PLAN DE SYNTHESE NIV SS1", Zone: "Zone 1", Groupe: "SS1", Lien: "30 DD", Diff_coffrage: planStart, Diff_armature: planStart },
  ];
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Descendants portant une classe, dans l'ordre du document.
function all(node, className) {
  const found = [];
  const visit = (element) => {
    if (element.classes?.has(className)) found.push(element);
    element.children.forEach(visit);
  };
  visit(node);
  return found;
}
const textsOf = (node, className) => all(node, className).map((element) => element.textContent);
const floorElement = (env, zoneKey, floorKey) => all(env.body, "structure-link-floor")
  .find((element) => element.dataset.zoneKey === zoneKey && element.dataset.floorKey === floorKey);
const formworkElement = (env, number) => all(env.body, "structure-link-formwork")
  .find((element) => element.dataset.number === number);
const actionOf = (element, action) => all(element, "structure-link-action").find((button) => button.dataset.action === action);

function fakeTransfer() {
  return { data: {}, setData(type, value) { this.data[type] = value; } };
}

// Un glisser complet : prise du coffrage, survol puis dépôt sur l'étage.
function dragOnto(env, number, floor) {
  const source = formworkElement(env, number);
  const dataTransfer = fakeTransfer();
  dispatch(source, "dragstart", { dataTransfer });
  const over = dispatch(floor, "dragover", { dataTransfer });
  const drop = dispatch(floor, "drop", { dataTransfer });
  dispatch(source, "dragend");
  return { dataTransfer, over, drop };
}

function setup({
  rows = syntheseRows(),
  loadRows = async () => ({ projectRows: PROJECT_ROWS, planRows: PLAN_ROWS }),
  projectName = "HOTEL DIEU",
  source: sourceOverrides = {},
  applyLink = null,
} = {}) {
  const { doc } = createFakeEnvironment();
  const project = { name: projectName };
  const dialog = new FakeElement("dialog");
  dialog.open = false;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dispatch(dialog, "close");
  };
  const elements = {
    dialog,
    title: new FakeElement("h3"),
    status: new FakeElement("p"),
    body: new FakeElement("div"),
    closeButton: new FakeElement("button"),
  };
  elements.status.hidden = true;
  // Doublure du tableau de tâches : `source.rows` peut être remplacé par un test.
  const source = { ready: true, rows, editable: true, lockedMessage: "", linkColumn: true, ...sourceOverrides };
  const calls = [];
  const requests = [];
  const controller = createStructureLinkDialog(elements, {
    loadRows: (...args) => {
      calls.push(args);
      return loadRows(...args);
    },
    getSource: () => source,
    applyLink: (request) => {
      requests.push(request);
      return applyLink ? applyLink(request, source) : Promise.resolve({ ok: true });
    },
    getProjectName: () => project.name,
    doc,
  });
  return { ...elements, controller, calls, requests, source, project, doc };
}

function silenceConsoleError(run) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  return Promise.resolve().then(run).finally(() => {
    console.error = original;
  }).then(() => errors);
}

test("rendu : étages avec leur fond de plan et leur lien, coffrages avec leur indice 0", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  const formwork = {
    id: 20, number: "3001", name: "PH SS1", label: "3001 — PH SS1", zoneKey: "zone1",
    issueDate: new Date(2025, 10, 27), floorNames: ["SS1", "SS2"],
  };
  const result = renderStructureLink(body, {
    zones: [
      {
        zoneKey: "zone1",
        label: "Zone 1",
        floors: [
          { key: "ss1", name: "SS1", state: "current", formworkNumber: "3001", formwork, plan: { id: 31, name: "FOND DE PLAN", start: new Date(2025, 10, 27) } },
          { key: "ss2", name: "SS2", state: "stale", formworkNumber: "3001", formwork, plan: { id: 41, name: "FOND DE PLAN", start: null } },
          { key: "ss3", name: "SS3", state: "none", formworkNumber: "", formwork: null, plan: null },
        ],
        formworks: [
          formwork,
          { id: 21, number: "", name: "Sans numéro", label: "Sans numéro", zoneKey: "zone1", issueDate: null, floorNames: [] },
        ],
      },
      { zoneKey: "zone2", label: "Zone 2", floors: [], formworks: [] },
    ],
  }, { editable: true, doc });
  assert.equal(body.children.length, 2);
  const [zone1, zone2] = body.children;
  assert.ok(zone1.classes.has("structure-link-zone"));
  const [left, right] = zone1.children;
  assert.ok(left.classes.has("structure-link-side--synthese"));
  assert.ok(right.classes.has("structure-link-side--structure"));
  assert.deepEqual(textsOf(left, "structure-link-zone-name"), ["Zone 1"]);
  assert.deepEqual(textsOf(left, "structure-link-floor-name"), ["SS1", "SS2", "SS3"]);
  assert.deepEqual(textsOf(left, "structure-link-plan"), ["Fond de plan : début Jeu 27/11/25", "Fond de plan : début —"]);
  assert.deepEqual(textsOf(left, "structure-link-link"), [
    "3001 — PH SS1 · à jour",
    "3001 — PH SS1 · à mettre à jour : ind. 0 le Jeu 27/11/25",
    "Déposez un coffrage ici",
  ]);
  assert.deepEqual(all(left, "structure-link-action").map((button) => [button.dataset.action, button.textContent]), [
    ["unlink", "×"],
    ["refresh", "Mettre à jour"],
    ["unlink", "×"],
  ]);
  assert.equal(all(left, "structure-link-unlink")[0].getAttribute("aria-label"), "Délier SS1");
  assert.ok(all(left, "structure-link-floor")[1].classes.has("is-state-stale"));
  assert.deepEqual(textsOf(right, "structure-link-formwork-label"), ["3001 — PH SS1", "Sans numéro"]);
  assert.deepEqual(textsOf(right, "structure-link-issue"), ["ind. 0 : Jeu 27/11/25", "pas d'indice 0"]);
  assert.deepEqual(textsOf(right, "structure-link-used"), ["lié : SS1, SS2"]);
  assert.deepEqual(all(right, "structure-link-formwork").map((item) => Boolean(item.draggable)), [true, false], "sans N° : ne se déplace pas");
  assert.deepEqual(textsOf(zone2, "structure-link-empty"), ["Aucun étage", "Aucun coffrage"]);
  assert.deepEqual([result.floors.length, result.formworks.length], [3, 2]);
});

test("rendu : coffrage introuvable, étage sans fond de plan, coffrage sans indice 0", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  const formwork = { id: 20, number: "3001", name: "PH SS1", label: "3001 — PH SS1", zoneKey: "zone1", issueDate: null, floorNames: [] };
  renderStructureLink(body, {
    zones: [{
      zoneKey: "zone1",
      label: "Zone 1",
      floors: [
        { key: "a", name: "A", state: "missing", formworkNumber: "9999", formwork: null, plan: null },
        { key: "b", name: "B", state: "noPlan", formworkNumber: "3001", formwork, plan: null },
        { key: "c", name: "C", state: "waiting", formworkNumber: "3001", formwork, plan: { id: 1, name: "FOND DE PLAN", start: null } },
      ],
      formworks: [formwork],
    }],
  }, { editable: true, doc });
  assert.deepEqual(textsOf(body, "structure-link-link"), [
    "Coffrage 9999 introuvable",
    "3001 — PH SS1 · pas de tâche « FOND DE PLAN DE SYNTHESE » dans cet étage",
    "3001 — PH SS1 · en attente de l'indice 0",
  ]);
  assert.deepEqual(all(body, "structure-link-action").map((button) => button.dataset.action), ["unlink", "unlink", "unlink"]);
});

test("rendu en lecture seule : rien ne se déplace, aucun bouton", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  const formwork = { id: 20, number: "3001", name: "PH SS1", label: "3001 — PH SS1", zoneKey: "zone1", issueDate: new Date(2025, 10, 27), floorNames: ["SS1"] };
  renderStructureLink(body, {
    zones: [{
      zoneKey: "zone1",
      label: "Zone 1",
      floors: [
        { key: "ss1", name: "SS1", state: "stale", formworkNumber: "3001", formwork, plan: { id: 31, name: "FOND DE PLAN", start: null } },
        { key: "ss2", name: "SS2", state: "none", formworkNumber: "", formwork: null, plan: null },
      ],
      formworks: [formwork],
    }],
  }, { doc });
  assert.equal(all(body, "structure-link-action").length, 0);
  assert.equal(Boolean(all(body, "structure-link-formwork")[0].draggable), false);
  assert.equal(textsOf(body, "structure-link-link")[1], "Aucun coffrage lié");
});

test("un nouveau rendu remplace le précédent", () => {
  const { doc } = createFakeEnvironment();
  const body = new FakeElement("div");
  renderStructureLink(body, { zones: [{ zoneKey: "zone1", label: "Zone 1", floors: [], formworks: [] }] }, { doc });
  renderStructureLink(body, { zones: [] }, { doc });
  assert.equal(body.children.length, 0);
});

test("ouverture : titre, lecture, étages du tableau de tâches en face des coffrages, invite à glisser", async () => {
  const env = setup();
  const opening = env.controller.open();
  assert.equal(env.dialog.open, true);
  assert.equal(env.title.textContent, "Lien Structure — HOTEL DIEU");
  assert.deepEqual([env.status.textContent, env.status.hidden], ["Chargement…", false]);
  await opening;
  assert.equal(env.calls.length, 1);
  assert.deepEqual([env.status.textContent, env.status.hidden], [HINT, false]);
  assert.deepEqual(textsOf(env.body, "structure-link-floor-name"), ["SS1", "SS2", "RDC"]);
  assert.deepEqual(textsOf(env.body, "structure-link-formwork-label"), ["3001 — PH SS1", "3002 — PH SS2", "3010 — RDC"]);
  assert.deepEqual(textsOf(env.body, "structure-link-issue"), ["ind. 0 : Jeu 27/11/25", "pas d'indice 0", "pas d'indice 0"]);
});

test("aucun projet choisi : un message, aucune lecture", async () => {
  const env = setup({ projectName: "" });
  await env.controller.open();
  assert.equal(env.calls.length, 0);
  assert.equal(env.title.textContent, "Lien Structure");
  assert.deepEqual([env.status.textContent, env.status.hidden], ["Choisissez d'abord un projet.", false]);
});

test("projet sans zone : un message à la place des colonnes", async () => {
  const env = setup({ rows: [], loadRows: async () => ({ projectRows: [], planRows: [] }) });
  await env.controller.open();
  assert.deepEqual([env.status.textContent, env.status.hidden], ["Aucune zone pour ce projet.", false]);
  assert.equal(env.body.children.length, 0);
});

test("lecture impossible : un message, la fenêtre reste ouverte et vide", async () => {
  const env = setup({ loadRows: async () => { throw new Error("réseau"); } });
  const errors = await silenceConsoleError(() => env.controller.open());
  assert.equal(errors.length, 1);
  assert.equal(env.dialog.open, true);
  assert.equal(
    env.status.textContent,
    "Les étages et les coffrages n'ont pas pu être lus. Fermez la fenêtre puis rouvrez-la."
  );
  assert.ok(env.status.classes.has("is-error"));
  assert.equal(env.body.children.length, 0);
});

test("tableau de tâches pas encore chargé : un message, rien n'est dessiné", async () => {
  const env = setup({ source: { ready: false } });
  await env.controller.open();
  assert.equal(env.status.textContent, "Les étages ne sont pas encore chargés : fermez la fenêtre puis rouvrez-la.");
  assert.equal(env.body.children.length, 0);
});

test("lecture seule : le message du tableau, rien ne se déplace", async () => {
  const lockedMessage = "Activez « Editer » dans le bandeau pour modifier les tâches.";
  const env = setup({ rows: syntheseRows({ ss1Link: "3001" }), source: { editable: false, lockedMessage } });
  await env.controller.open();
  assert.equal(env.status.textContent, lockedMessage);
  assert.ok(!env.status.classes.has("is-error"));
  assert.equal(all(env.body, "structure-link-action").length, 0);
  const item = formworkElement(env, "3001");
  dispatch(item, "dragstart", { dataTransfer: fakeTransfer() });
  assert.ok(!item.classes.has("is-dragging"));
  assert.equal(dispatch(floorElement(env, "zone1", "ss1"), "dragover").defaultPrevented, false);
  assert.equal(env.requests.length, 0);
});

test("colonne Lien_Structure absente : le dire, et rester en lecture seule", async () => {
  const env = setup({ source: { linkColumn: false } });
  await env.controller.open();
  assert.equal(env.status.textContent, NO_LINK_COLUMN);
  assert.ok(env.status.classes.has("is-error"));
  assert.equal(Boolean(formworkElement(env, "3001").draggable), false);
});

test("fermée avant la fin de la lecture : la réponse tardive n'est pas affichée", async () => {
  let release;
  const env = setup({ loadRows: () => new Promise((resolve) => { release = resolve; }) });
  const opening = env.controller.open();
  dispatch(env.closeButton, "click");
  assert.equal(env.dialog.open, false);
  release({ projectRows: PROJECT_ROWS, planRows: PLAN_ROWS });
  await opening;
  await flush();
  assert.equal(env.body.children.length, 0);
});

test("rouverte pendant une lecture : seule la dernière lecture est affichée", async () => {
  const pending = [];
  const env = setup({ loadRows: () => new Promise((resolve) => pending.push(resolve)) });
  const first = env.controller.open();
  const second = env.controller.open();
  pending[1]({ projectRows: [], planRows: [] });
  await second;
  pending[0]({ projectRows: PROJECT_ROWS, planRows: PLAN_ROWS });
  await first;
  assert.deepEqual(textsOf(env.body, "structure-link-formwork-label"), [], "les coffrages de la première lecture ne sont pas affichés");
});

test("glisser un coffrage sur un étage de sa zone : lien et date d'indice 0 envoyés au tableau", async () => {
  const env = setup({
    applyLink: (request, source) => {
      // Le tableau affiche tout de suite l'écriture en attente.
      source.rows = syntheseRows({ ss1Link: request.formworkNumber, planStart: "2025-11-27" });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  const { dataTransfer, over, drop } = dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
  assert.deepEqual(dataTransfer.data, { "application/x-planning-coffrage": "3001" }, "type privé, pas text/plain");
  assert.equal(over.defaultPrevented, true, "dépôt accepté");
  assert.equal(drop.defaultPrevented, true);
  assert.equal(env.requests.length, 1);
  const [request] = env.requests;
  assert.deepEqual(
    [request.zoneKey, request.floorKey, request.formworkNumber, iso(request.date)],
    ["zone1", "ss1", "3001", "2025-11-27"]
  );
  assert.equal(env.status.textContent, "Enregistrement…");
  assert.deepEqual(textsOf(floorElement(env, "zone1", "ss1"), "structure-link-link"), ["3001 — PH SS1 · à jour"], "affiché avant la réponse");
  await flush();
  assert.equal(env.status.textContent, "SS1 lié au coffrage 3001 : le fond de plan débute le Jeu 27/11/25.");
  assert.ok(!env.status.classes.has("is-error"));
  assert.deepEqual(textsOf(formworkElement(env, "3001"), "structure-link-used"), ["lié : SS1"]);
});

test("coffrage sans indice 0 : le lien seul, la date viendra", async () => {
  const env = setup();
  await env.controller.open();
  dragOnto(env, "3002", floorElement(env, "zone1", "ss1"));
  const [request] = env.requests;
  assert.deepEqual([request.formworkNumber, "date" in request], ["3002", false]);
  await flush();
  assert.equal(env.status.textContent, "SS1 lié au coffrage 3002. La date sera à reprendre quand l'indice 0 sera diffusé.");
});

test("étage sans fond de plan : le lien seul, aucune date posée", async () => {
  const env = setup();
  await env.controller.open();
  dragOnto(env, "3001", floorElement(env, "zone1", "ss2"));
  const [request] = env.requests;
  assert.deepEqual([request.floorKey, request.formworkNumber, "date" in request], ["ss2", "3001", false]);
  await flush();
  assert.equal(
    env.status.textContent,
    "SS2 lié au coffrage 3001. Aucune date posée : l'étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE »."
  );
});

test("glisser : seuls les étages de la zone du coffrage acceptent le dépôt", async () => {
  const env = setup();
  await env.controller.open();
  const source = formworkElement(env, "3010"); // Zone 2
  const dataTransfer = fakeTransfer();
  const ss1 = floorElement(env, "zone1", "ss1");
  const rdc = floorElement(env, "zone2", "rdc");
  dispatch(source, "dragstart", { dataTransfer });
  assert.ok(source.classes.has("is-dragging"));
  assert.deepEqual(all(env.body, "structure-link-floor").map((element) => element.classes.has("is-droppable")), [false, false, true]);
  assert.equal(dispatch(ss1, "dragover", { dataTransfer }).defaultPrevented, false, "autre zone : refusé");
  assert.equal(dispatch(rdc, "dragover", { dataTransfer }).defaultPrevented, true);
  assert.ok(rdc.classes.has("is-drop-target"));
  dispatch(ss1, "dragover", { dataTransfer });
  assert.ok(!rdc.classes.has("is-drop-target"), "le survol a quitté l'étage");
  dispatch(ss1, "drop", { dataTransfer });
  assert.equal(env.requests.length, 0);
  assert.ok(!source.classes.has("is-dragging"));
  assert.ok(!rdc.classes.has("is-droppable"));
});

test("glisser abandonné : les repères disparaissent", async () => {
  const env = setup();
  await env.controller.open();
  const source = formworkElement(env, "3001");
  dispatch(source, "dragstart", { dataTransfer: fakeTransfer() });
  dispatch(source, "dragend");
  assert.ok(!source.classes.has("is-dragging"));
  assert.ok(all(env.body, "structure-link-floor").every((element) => !element.classes.has("is-droppable")));
  assert.equal(env.requests.length, 0);
});

test("« Mettre à jour » : la date d'indice 0 est renvoyée au tableau, sans toucher au lien", async () => {
  const env = setup({
    rows: syntheseRows({ ss1Link: "3001", planStart: "2026-01-02" }),
    applyLink: (request, source) => {
      source.rows = syntheseRows({ ss1Link: "3001", planStart: "2025-11-27" });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  const floor = floorElement(env, "zone1", "ss1");
  assert.deepEqual(textsOf(floor, "structure-link-link"), ["3001 — PH SS1 · à mettre à jour : ind. 0 le Jeu 27/11/25"]);
  dispatch(actionOf(floor, "refresh"), "click");
  const [request] = env.requests;
  assert.deepEqual(
    [request.zoneKey, request.floorKey, iso(request.date), "formworkNumber" in request],
    ["zone1", "ss1", "2025-11-27", false]
  );
  await flush();
  assert.equal(env.status.textContent, "SS1 : le fond de plan débute le Jeu 27/11/25.");
  assert.equal(actionOf(floorElement(env, "zone1", "ss1"), "refresh"), undefined, "à jour : plus de bouton");
});

test("« × » : l'étage est délié", async () => {
  const env = setup({
    rows: syntheseRows({ ss1Link: "3001", planStart: "2025-11-27" }),
    applyLink: (request, source) => {
      source.rows = syntheseRows({ planStart: "2025-11-27" });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  dispatch(actionOf(floorElement(env, "zone1", "ss1"), "unlink"), "click");
  assert.deepEqual(env.requests, [{ zoneKey: "zone1", floorKey: "ss1", formworkNumber: "" }]);
  await flush();
  assert.equal(env.status.textContent, "SS1 n'est plus lié à un coffrage.");
  assert.deepEqual(textsOf(floorElement(env, "zone1", "ss1"), "structure-link-link"), ["Déposez un coffrage ici"]);
});

// Review Focus 4.
test("écriture refusée : le message du tableau en erreur, l'affichage d'avant", async () => {
  const env = setup({
    applyLink: () => Promise.resolve({ ok: false, error: "L'enregistrement dans Grist a échoué. Réessayez." }),
  });
  await env.controller.open();
  dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
  await flush();
  assert.equal(env.status.textContent, "L'enregistrement dans Grist a échoué. Réessayez.");
  assert.ok(env.status.classes.has("is-error"));
  assert.deepEqual(textsOf(floorElement(env, "zone1", "ss1"), "structure-link-link"), ["Déposez un coffrage ici"]);
});

test("écriture qui lève une erreur : même message, sans planter", async () => {
  const env = setup({ applyLink: () => Promise.reject(new Error("imprévu")) });
  await env.controller.open();
  const errors = await silenceConsoleError(async () => {
    dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
    await flush();
  });
  assert.equal(errors.length, 1);
  assert.equal(env.status.textContent, "L'enregistrement dans Grist a échoué. Réessayez.");
  assert.ok(env.status.classes.has("is-error"));
});

// Review Focus 5.
test("fenêtre fermée pendant une écriture : la réponse tardive n'affiche rien", async () => {
  let release;
  const env = setup({ applyLink: () => new Promise((resolve) => { release = resolve; }) });
  await env.controller.open();
  dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
  dispatch(env.closeButton, "click");
  assert.equal(env.dialog.open, false);
  release({ ok: true });
  await flush();
  assert.equal(env.status.textContent, "Enregistrement…", "pas de message de réussite dans une fenêtre fermée");
});

test("écriture en route : ni nouveau glisser ni bouton avant la réponse", async () => {
  let release;
  const env = setup({
    rows: syntheseRows({ ss1Link: "3001", planStart: "2025-11-27" }),
    applyLink: () => new Promise((resolve) => { release = resolve; }),
  });
  await env.controller.open();
  dragOnto(env, "3002", floorElement(env, "zone1", "ss2"));
  assert.equal(env.requests.length, 1);
  assert.ok(env.body.classes.has("is-busy"));
  const blocked = dispatch(formworkElement(env, "3001"), "dragstart", { dataTransfer: fakeTransfer() });
  assert.equal(blocked.defaultPrevented, true, "le glisser ne démarre pas");
  assert.ok(!formworkElement(env, "3001").classes.has("is-dragging"));
  dispatch(actionOf(floorElement(env, "zone1", "ss1"), "unlink"), "click");
  assert.equal(env.requests.length, 1, "le bouton attend aussi");
  assert.equal(env.status.textContent, "Enregistrement…");
  release({ ok: true });
  await flush();
  assert.ok(!env.body.classes.has("is-busy"));
  const source = formworkElement(env, "3001");
  assert.equal(dispatch(source, "dragstart", { dataTransfer: fakeTransfer() }).defaultPrevented, false);
  assert.ok(source.classes.has("is-dragging"), "après la réponse, on peut de nouveau glisser");
});

test("redessin impossible après une écriture réussie : dit à part, l'écriture n'est pas dite refusée", async () => {
  const env = setup({
    applyLink: (request, source) => {
      // Les lignes du tableau deviennent illisibles : tout redessin échoue désormais.
      Object.defineProperty(source, "rows", { get() { throw new Error("lignes illisibles"); } });
      return Promise.resolve({ ok: true });
    },
  });
  await env.controller.open();
  const errors = await silenceConsoleError(async () => {
    dragOnto(env, "3001", floorElement(env, "zone1", "ss1"));
    await flush();
  });
  assert.equal(errors.length, 2, "les deux redessins (immédiat, puis à la réponse) sont tracés");
  assert.equal(
    env.status.textContent,
    "L'enregistrement est fait, mais l'affichage n'a pas pu être mis à jour : fermez la fenêtre puis rouvrez-la."
  );
  assert.ok(env.status.classes.has("is-error"));
  assert.ok(!env.body.classes.has("is-busy"));
});

test("projet changé sous la fenêtre ouverte : rien n'est envoyé, puis la fenêtre se ferme", async () => {
  const env = setup({ rows: syntheseRows({ ss1Link: "3001", planStart: "2026-01-02" }) });
  await env.controller.open();
  env.controller.closeIfStale();
  assert.equal(env.dialog.open, true, "même projet : la fenêtre reste ouverte");
  env.project.name = "AUTRE PROJET";
  dragOnto(env, "3002", floorElement(env, "zone1", "ss2"));
  dispatch(actionOf(floorElement(env, "zone1", "ss1"), "refresh"), "click");
  dispatch(actionOf(floorElement(env, "zone1", "ss1"), "unlink"), "click");
  assert.equal(env.requests.length, 0);
  assert.equal(env.status.textContent, "Le projet a changé depuis l'ouverture de cette fenêtre : fermez-la puis rouvrez-la.");
  assert.ok(env.status.classes.has("is-error"));
  assert.ok(!env.body.classes.has("is-busy"));
  env.controller.closeIfStale();
  assert.equal(env.dialog.open, false);
});

test("glisser déjà refusé par un autre écouteur de la page : la fenêtre ne le suit pas", async () => {
  const env = setup();
  await env.controller.open();
  const source = formworkElement(env, "3001");
  dispatch(source, "dragstart", { dataTransfer: fakeTransfer(), defaultPrevented: true });
  assert.ok(!source.classes.has("is-dragging"));
  assert.ok(all(env.body, "structure-link-floor").every((element) => !element.classes.has("is-droppable")));
  assert.equal(dispatch(floorElement(env, "zone1", "ss1"), "dragover").defaultPrevented, false);
});
