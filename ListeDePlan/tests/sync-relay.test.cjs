const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LISTE_DE_PLAN = path.join(__dirname, "..");
const relaySource = fs.readFileSync(
  path.join(LISTE_DE_PLAN, "liste-plan-sync-relay.js"),
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
    id: [projectId],
    Numero_de_projet: ["1111"],
    Nom_de_projet: ["Test"],
  };
  if (signalColumnExists) projectsTable.ListePlan_Sync = [""];

  const docApi = {
    async fetchTable(tableName) {
      assert.equal(tableName, "Projets2");
      return projectsTable;
    },
    async applyUserActions(actions) {
      calls.push(actions);
      const addColumn = actions.find((action) => action?.[0] === "AddColumn");
      if (addColumn) projectsTable[addColumn[2]] = [""];
      return "ok";
    },
  };
  const selectedOption = selectedProjectId
    ? { dataset: { projectId: String(selectedProjectId) } }
    : null;
  const storage = new Map();
  if (storedProjectId) storage.set("LP_LAST_PROJECT_ID", String(storedProjectId));
  const window = {
    grist: { docApi },
    document: {
      getElementById(id) {
        if (id !== "projectDropdown" || !selectedOption) return null;
        return { selectedOptions: [selectedOption], selectedIndex: 0, options: [selectedOption] };
      },
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    },
    GristServiceContext: {
      getCurrentProject() {
        return currentProjectId
          ? { id: currentProjectId, number: "1111", name: "Test" }
          : null;
      },
    },
    addEventListener() {},
  };

  vm.runInNewContext(relaySource, { window, console, Date, Set, Object }, {
    filename: path.join(LISTE_DE_PLAN, "liste-plan-sync-relay.js"),
  });
  return {
    window,
    calls,
    setCurrentProjectId(value) { currentProjectId = value; },
  };
}

test("une mutation ListePlan touche Projets2 dans la meme transaction", async () => {
  const harness = createHarness();
  const action = ["AddRecord", "ListePlan_NDC_COF", null, {
    Nom_projet: "Test",
    NumeroDocument: "100",
  }];

  await harness.window.grist.docApi.applyUserActions([action]);

  assert.equal(harness.calls.length, 2, "la colonne est créée une seule fois avant la transaction");
  assert.equal(harness.calls[0][0][0], "AddColumn");
  assert.equal(harness.calls[0][0][1], "Projets2");
  assert.equal(harness.calls[0][0][2], "ListePlan_Sync");
  assert.equal(harness.calls[0][0][3].type, "Text");
  assert.equal(
    harness.calls[0][0][3].label,
    "Synchronisation liste de plan"
  );
  assert.equal(harness.calls[1].length, 2);
  assert.deepEqual(Array.from(harness.calls[1][0]), action);
  assert.equal(harness.calls[1][1][0], "UpdateRecord");
  assert.equal(harness.calls[1][1][1], "Projets2");
  assert.equal(harness.calls[1][1][2], 12);
  assert.match(harness.calls[1][1][3].ListePlan_Sync, /^\d+:1$/);
});

test("la colonne et le signal sont réutilisés sans lecture périodique", async () => {
  const harness = createHarness({ signalColumnExists: true });

  await harness.window.grist.docApi.applyUserActions([
    ["UpdateRecord", "ListePlan_NDC_COF", 4, { DateDiffusion: "2026-08-10" }],
  ]);
  await harness.window.grist.docApi.applyUserActions([
    ["RemoveRecord", "ListePlan_NDC_COF", 4],
  ]);

  assert.equal(harness.calls.length, 2);
  const firstSignal = harness.calls[0][1][3].ListePlan_Sync;
  const secondSignal = harness.calls[1][1][3].ListePlan_Sync;
  assert.notEqual(firstSignal, secondSignal);
  assert.doesNotMatch(relaySource, /setInterval\s*\(|setTimeout\s*\(/);
});

test("une écriture sans rapport ne modifie jamais Projets2", async () => {
  const harness = createHarness({ signalColumnExists: true });
  const action = ["UpdateRecord", "References2", 9, { Indice: "B" }];

  await harness.window.grist.docApi.applyUserActions([action]);

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(Array.from(harness.calls[0][0]), action);
  assert.equal(harness.calls[0].length, 1);
});

test("une mutation reste possible si aucun projet n'est sélectionné", async () => {
  const harness = createHarness({ projectId: null, signalColumnExists: true });
  const action = ["UpdateRecord", "ListePlan_NDC_COF", 4, { Indice: "A" }];

  await harness.window.grist.docApi.applyUserActions([action]);

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(Array.from(harness.calls[0][0]), action);
});

test("le signal d'un autre projet ne réveille pas ListeDePlan", () => {
  const harness = createHarness({ projectId: 12, signalColumnExists: true });
  const acceptSignal = harness.window.ListePlanSyncRelay.acceptNativeSignalForCurrentProject;

  assert.equal(acceptSignal({
    sectionTableId: "Projets2",
    delivery: { reason: "subscribe" },
    records: [
      { id: 12, ListePlan_Sync: "initial-12" },
      { id: 99, ListePlan_Sync: "initial-99" },
    ],
  }), false, "le premier lot sert seulement de référence");

  assert.equal(acceptSignal({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [
      { id: 12, ListePlan_Sync: "initial-12" },
      { id: 99, ListePlan_Sync: "modifie-99" },
    ],
  }), false, "une autre ligne projet est ignorée");

  assert.equal(acceptSignal({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [
      { id: 12, ListePlan_Sync: "modifie-12" },
      { id: 99, ListePlan_Sync: "modifie-99" },
    ],
  }), true, "la ligne du projet courant réveille le watcher");
});

test("la premiere modification reveille meme sans amorcage ni clic", () => {
  const harness = createHarness({ projectId: 12, signalColumnExists: true });
  assert.equal(
    harness.window.ListePlanSyncRelay.acceptNativeSignalForCurrentProject({
      sectionTableId: "Projets2",
      delivery: { reason: "records" },
      records: [{ id: 12, ListePlan_Sync: "premiere-modification" }],
    }),
    true
  );
});

test("un changement de projet amorce le filtre sans avaler sa première modification", () => {
  const harness = createHarness({ projectId: 12, signalColumnExists: true });
  const acceptSignal = harness.window.ListePlanSyncRelay.acceptNativeSignalForCurrentProject;

  acceptSignal({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [{ id: 12, ListePlan_Sync: "initial-12" }],
  });
  harness.setCurrentProjectId(99);

  assert.equal(acceptSignal({
    sectionTableId: "Projets2",
    delivery: { reason: "selection" },
    records: [{ id: 99, ListePlan_Sync: "initial-99" }],
  }), false, "la sélection fait déjà sa propre relecture");

  assert.equal(acceptSignal({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [{ id: 99, ListePlan_Sync: "modifie-99" }],
  }), true, "la première modification qui suit ne doit pas être ignorée");
});

test("l'ID affiché ou mémorisé prime sur un ancien contexte asynchrone", () => {
  const fromDropdown = createHarness({ projectId: 7, selectedProjectId: 12 });
  assert.equal(fromDropdown.window.ListePlanSyncRelay.getCurrentProjectId(), 12);

  const fromStorage = createHarness({ projectId: 7, storedProjectId: 99 });
  assert.equal(fromStorage.window.ListePlanSyncRelay.getCurrentProjectId(), 99);
});

test("une source ListePlan directe reste compatible", () => {
  const harness = createHarness({ projectId: 12, signalColumnExists: true });
  assert.equal(
    harness.window.ListePlanSyncRelay.acceptNativeSignalForCurrentProject({
      sectionTableId: "ListePlan_NDC_COF",
      delivery: { reason: "records" },
      records: [],
    }),
    true
  );
});

test("ListeDePlan charge le relais après le runtime partagé", () => {
  const html = fs.readFileSync(path.join(LISTE_DE_PLAN, "index.html"), "utf8");
  const runtimeIndex = html.indexOf("../shared/grist-service-context.js");
  const relayIndex = html.indexOf("liste-plan-sync-relay.js");
  assert.ok(runtimeIndex >= 0 && relayIndex > runtimeIndex);

  const avancementHtml = fs.readFileSync(
    path.join(LISTE_DE_PLAN, "avancement.html"),
    "utf8"
  );
  assert.ok(avancementHtml.includes("liste-plan-sync-relay.js"));
});
