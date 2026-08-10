const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SHARED = path.join(__dirname, "..");
const relaySource = fs.readFileSync(
  path.join(SHARED, "reference-project-sync-relay.js"),
  "utf8"
);

function createHarness({
  projectId = 12,
  selectedProjectId = null,
  storedProjectId = null,
  signalColumnExists = false,
} = {}) {
  const calls = [];
  let currentProjectId = projectId;
  const projectsTable = {
    id: [12, 99],
    Numero_de_projet: ["1111", "9999"],
    Nom_de_projet: ["Test", "Autre"],
  };
  if (signalColumnExists) projectsTable.References2_Sync = ["", ""];

  const docApi = {
    async fetchTable(tableName) {
      assert.equal(tableName, "Projets2");
      return projectsTable;
    },
    async applyUserActions(actions) {
      calls.push(actions);
      const addColumn = actions.find((action) => action?.[0] === "AddColumn");
      if (addColumn) projectsTable[addColumn[2]] = ["", ""];
      return "ok";
    },
  };
  const selectedOption = selectedProjectId
    ? { dataset: { projectId: String(selectedProjectId), projectNumber: "1111" } }
    : null;
  const storage = new Map();
  if (storedProjectId) storage.set("grist.selected-project-id", String(storedProjectId));
  const window = {
    grist: { docApi },
    document: {
      getElementById(id) {
        if (id !== "firstColumnDropdown" || !selectedOption) return null;
        return { selectedOptions: [selectedOption], selectedIndex: 0, options: [selectedOption] };
      },
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    },
    GristServiceContext: {
      getCurrentProject() {
        return currentProjectId
          ? { id: currentProjectId, number: currentProjectId === 99 ? "9999" : "1111" }
          : null;
      },
    },
    addEventListener() {},
  };

  vm.runInNewContext(relaySource, { window, console, Date, Set, Map, Object }, {
    filename: path.join(SHARED, "reference-project-sync-relay.js"),
  });
  return {
    window,
    calls,
    setCurrentProjectId(value) { currentProjectId = value; },
  };
}

test("une mutation References2 touche le projet dans la meme transaction", async () => {
  const harness = createHarness();
  const action = ["AddRecord", "References2", null, { Reference: "A" }];

  await harness.window.grist.docApi.applyUserActions([action]);

  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0][0][0], "AddColumn");
  assert.equal(harness.calls[0][0][1], "Projets2");
  assert.equal(harness.calls[0][0][2], "References2_Sync");
  assert.equal(harness.calls[1].length, 2);
  assert.deepEqual(Array.from(harness.calls[1][0]), action);
  assert.equal(harness.calls[1][1][0], "UpdateRecord");
  assert.equal(harness.calls[1][1][1], "Projets2");
  assert.equal(harness.calls[1][1][2], 12);
  assert.match(harness.calls[1][1][3].References2_Sync, /^\d+:1$/);
});

test("References et References2 sont relayees, les autres tables non", async () => {
  const harness = createHarness({ signalColumnExists: true });
  await harness.window.grist.docApi.applyUserActions([
    ["UpdateRecord", "References", 4, { Indice: "B" }],
  ]);
  await harness.window.grist.docApi.applyUserActions([
    ["UpdateRecord", "Budget", 8, { Montant: 20 }],
  ]);

  assert.equal(harness.calls[0].length, 2);
  assert.equal(harness.calls[1].length, 1);
  assert.doesNotMatch(relaySource, /setInterval\s*\(|setTimeout\s*\(/);
});

test("seul le signal du projet courant reveille les references", () => {
  const harness = createHarness({ signalColumnExists: true });
  const accepts = harness.window.ReferenceProjectSyncRelay.acceptNativeSignalForCurrentProject;

  assert.equal(accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "selection" },
    records: [
      { id: 12, References2_Sync: "initial-12" },
      { id: 99, References2_Sync: "initial-99" },
    ],
  }), false);
  assert.equal(accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [
      { id: 12, References2_Sync: "initial-12" },
      { id: 99, References2_Sync: "modifie-99" },
    ],
  }), false);
  assert.equal(accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [
      { id: 12, References2_Sync: "modifie-12" },
      { id: 99, References2_Sync: "modifie-99" },
    ],
  }), true);
});

test("la premiere modification reveille sans clic prealable", () => {
  const harness = createHarness({ projectId: 12, signalColumnExists: true });
  assert.equal(
    harness.window.ReferenceProjectSyncRelay.acceptNativeSignalForCurrentProject({
      sectionTableId: "Projets2",
      delivery: { reason: "records" },
      records: [{ id: 12, References2_Sync: "premiere-modification" }],
    }),
    true
  );
});

test("le changement de projet amorce la ligne avant sa premiere mutation", () => {
  const harness = createHarness({ signalColumnExists: true });
  const accepts = harness.window.ReferenceProjectSyncRelay.acceptNativeSignalForCurrentProject;
  accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "selection" },
    records: [{ id: 12, References2_Sync: "initial-12" }],
  });
  harness.setCurrentProjectId(99);
  accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "selection" },
    records: [{ id: 99, References2_Sync: "initial-99" }],
  });

  assert.equal(accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [{ id: 99, References2_Sync: "modifie-99" }],
  }), true);
});

test("le projet affiche prime sur un contexte asynchrone ancien", () => {
  const dropdown = createHarness({ projectId: 7, selectedProjectId: 12 });
  assert.equal(dropdown.window.ReferenceProjectSyncRelay.getCurrentProjectId(), 12);
  assert.deepEqual(
    { ...dropdown.window.ReferenceProjectSyncRelay.getCurrentProjectScope() },
    { projectId: 12, projectNumber: "1111" }
  );

  const storage = createHarness({ projectId: 7, storedProjectId: 99 });
  assert.equal(storage.window.ReferenceProjectSyncRelay.getCurrentProjectId(), 99);
});

test("Reference2 et EnAttente chargent le relais apres le runtime", () => {
  for (const widget of ["Reference2", "EnAttente"]) {
    const html = fs.readFileSync(path.join(SHARED, "..", widget, "index.html"), "utf8");
    const runtimeIndex = html.indexOf("../shared/grist-service-context.js");
    const relayIndex = html.indexOf("../shared/reference-project-sync-relay.js");
    assert.ok(runtimeIndex >= 0 && relayIndex > runtimeIndex, `${widget} doit charger le relais`);
  }
});
