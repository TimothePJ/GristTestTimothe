// Le vrai tableau de tâches et la vraie fenêtre « Lien Structure », branchés comme dans
// main.js ; seuls Grist, le contexte partagé et le DOM sont doublés.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { createStructureLinkDialog } from "../assets/js/ui/structureLinkDialog.js";
import { datedRows, templateRows } from "./helpers/templateRows.mjs";
import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

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

// Zone Z2A, étage SS1 du modèle (ligne-étage 201, RECEPTION 202, FOND DE PLAN 204) ; côté
// Structure, le coffrage 3021 de la même zone, avec un 0 Prev au jeudi 27/11/25. Par défaut,
// l'étage sort du modèle, sans aucune date.
async function setup({ floorRows = templateRows({ zoneName: "Zone Z2A" }) } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode: "editable" };
  const rows = floorRows.map((row) => ({ ...row, Lien_Structure: "" }));
  const context = {
    async fetchContextRows() {
      return rows.map((row) => ({ ...row }));
    },
    getState: () => ({ ...state, currentProject: state.currentProject ? { ...state.currentProject } : null }),
    subscribe: () => () => {},
    watchProjectZones: () => () => {},
  };
  const writes = [];
  const tasks = createSyntheseTasksController({
    context,
    docApi: {
      async applyUserActions(actions) {
        writes.push(actions);
        return { retValues: [] };
      },
    },
    createTable: () => ({ render() {}, setStatus() {}, startEditing() {}, startEditingFloor() {} }),
    confirm: () => true,
    now: () => new Date(2026, 8, 23),
    timers: { setTimeout: () => 0, clearTimeout() {} },
  });
  tasks.setEditingEnabled(true);
  tasks.setActive(true);
  await flush();

  const { doc } = createFakeEnvironment();
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
  const linkWindow = createStructureLinkDialog(elements, {
    loadRows: async () => ({
      projectRows: [
        { id: 900, NomProjet: "HOTEL DIEU", Taches: "PH SS1 - COF", Zone: "Zone Z2A", Service: "Structure", Type_doc: "COFFRAGE", ID2: "3021" },
      ],
      planRows: [
        { Type_document: "COFFRAGE", NumeroDocument: "3021", Indice: "Prev 0", DateDiffusion: "2025-11-27", Service: "Structure" },
      ],
    }),
    getSource: () => tasks.getStructureLinkSource(),
    applyLink: (request) => tasks.applyStructureLink(request),
    getProjectName: () => state.currentProject?.name || "",
    doc,
  });
  await linkWindow.open();
  return { state, writes, elements };
}

// Le coffrage 3021 glissé sur l'étage SS1.
async function dropFormworkOnFloor(env) {
  const [formwork] = all(env.elements.body, "structure-link-formwork");
  const [floor] = all(env.elements.body, "structure-link-floor");
  const dataTransfer = { data: {}, setData(type, value) { this.data[type] = value; } };
  dispatch(formwork, "dragstart", { dataTransfer });
  dispatch(floor, "dragover", { dataTransfer });
  dispatch(floor, "drop", { dataTransfer });
  await flush();
}

test("du glisser à Grist : le lien, la date sur RECEPTION et la cascade en une écriture, puis l'état « à jour »", async () => {
  const env = await setup();
  await dropFormworkOnFloor(env);
  assert.equal(env.writes.length, 1);
  const [link, anchor, cascade] = env.writes[0];
  assert.deepEqual(link, ["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3021"] }]);
  assert.deepEqual(anchor, ["UpdateRecord", "Planning_Projet", 202, {
    Diff_coffrage: "2025-11-27",
    Diff_armature: "2025-11-27",
    Duree_1: 0,
  }]);
  assert.equal(cascade[2][0], 204, "FOND DE PLAN suit par son lien");
  assert.equal(env.elements.status.textContent, "SS1 lié au coffrage 3021 : le fond de plan débute le Jeu 27/11/25.");
  assert.deepEqual(
    all(env.elements.body, "structure-link-link").map((element) => element.textContent),
    ["3021 — PH SS1 - COF · à jour"]
  );
  assert.deepEqual(
    all(env.elements.body, "structure-link-used").map((element) => element.textContent),
    ["lié : SS1"]
  );
});

// L'étage du modèle sans date sur ses premières tâches, mais avec une date saisie sur sa
// dernière (226) : le dépôt ne recale rien.
test("étage daté seulement sur une tâche plus loin : le dépôt n'écrit que le lien", async () => {
  const floorRows = templateRows({ zoneName: "Zone Z2A" })
    .map((row) => (row.id === 226 ? { ...row, Diff_coffrage: "2026-03-02", Diff_armature: "2026-03-02" } : row));
  const env = await setup({ floorRows });
  await dropFormworkOnFloor(env);
  assert.deepEqual(env.writes, [
    [["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3021"] }]],
  ], "aucune date écrite");
  assert.deepEqual(
    all(env.elements.body, "structure-link-link").map((element) => element.textContent),
    ["3021 — PH SS1 - COF · à mettre à jour : 0 Prev le Jeu 27/11/25"]
  );
  const refresh = all(env.elements.body, "structure-link-action").find((button) => button.dataset.action === "refresh");
  dispatch(refresh, "click");
  await flush();
  assert.equal(env.writes.length, 2);
  assert.deepEqual(env.writes[1][0].slice(0, 3), ["UpdateRecord", "Planning_Projet", 202], "« Mettre à jour » pose la date");
});

test("étage déjà daté : le dépôt n'écrit que le lien ; « Mettre à jour » pose ensuite la date et la cascade", async () => {
  const env = await setup({ floorRows: datedRows({ zoneName: "Zone Z2A" }) });
  const linkTexts = () => all(env.elements.body, "structure-link-link").map((element) => element.textContent);
  await dropFormworkOnFloor(env);
  assert.deepEqual(env.writes, [
    [["BulkUpdateRecord", "Planning_Projet", [201], { Lien_Structure: ["3021"] }]],
  ], "aucune date écrite");
  assert.deepEqual(
    all(env.elements.body, "structure-link-plan").map((element) => element.textContent),
    ["Fond de plan : début Ven 02/01/26"]
  );
  assert.deepEqual(linkTexts(), ["3021 — PH SS1 - COF · à mettre à jour : 0 Prev le Jeu 27/11/25"]);
  const refresh = all(env.elements.body, "structure-link-action").find((button) => button.dataset.action === "refresh");
  dispatch(refresh, "click");
  await flush();
  assert.equal(env.writes.length, 2);
  const [anchor, cascade] = env.writes[1];
  assert.deepEqual(anchor, ["UpdateRecord", "Planning_Projet", 202, {
    Diff_coffrage: "2025-11-27",
    Diff_armature: "2025-11-27",
    Duree_1: 0,
  }]);
  assert.ok(cascade[2].includes(204), "FOND DE PLAN suit par son lien");
  assert.deepEqual(linkTexts(), ["3021 — PH SS1 - COF · à jour"]);
});

test("projet changé pendant que la fenêtre est ouverte : le dépôt n'écrit rien dans l'autre projet", async () => {
  const env = await setup();
  env.state.currentProject = { name: "AUTRE PROJET", names: ["AUTRE PROJET"] };
  await dropFormworkOnFloor(env);
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.elements.status.textContent,
    "Le projet a changé depuis l'ouverture de cette fenêtre : fermez-la puis rouvrez-la."
  );
});
