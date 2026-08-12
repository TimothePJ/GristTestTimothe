const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SHARED = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(SHARED, "project-mutation-sync-relay.js"), "utf8");

function createHarness({ projectId = 12, signalColumns = [] } = {}) {
  const calls = [];
  let currentProjectId = projectId;
  const projects = {
    id: [12, 99],
    Numero_de_projet: ["1111", "9999"],
    Nom_de_projet: ["Test", "Autre"],
  };
  signalColumns.forEach((column) => { projects[column] = ["", ""]; });
  const docApi = {
    async fetchTable(tableName) {
      assert.equal(tableName, "Projets2");
      return projects;
    },
    async applyUserActions(actions) {
      calls.push(actions);
      actions.forEach((action) => {
        if (action?.[0] === "AddColumn") projects[action[2]] = ["", ""];
      });
      return "ok";
    },
  };
  const window = {
    ProjectMutationSyncConfig: {
      mutationSignals: {
        GestionDepenses_Sync: ["Budget", "TimeSegment"],
        ChargePlanning_Sync: ["TimeSegment"],
      },
      observedSignalColumns: ["PlanningProjet_Sync"],
      directSignalTables: ["Budget", "TimeSegment"],
      dropdownIds: ["project-select"],
    },
    grist: { docApi },
    document: { getElementById() { return null; } },
    localStorage: { getItem() { return null; } },
    GristServiceContext: {
      getCurrentProject() {
        return currentProjectId ? { id: currentProjectId, number: "1111" } : null;
      },
    },
    addEventListener() {},
  };
  vm.runInNewContext(source, {
    window,
    console,
    Date,
    Set,
    Map,
    Object,
  }, { filename: path.join(SHARED, "project-mutation-sync-relay.js") });
  return {
    window,
    calls,
    setCurrentProjectId(value) { currentProjectId = value; },
  };
}

test("une mutation ne met a jour que les canaux qui consomment sa table", async () => {
  const harness = createHarness();
  const action = ["AddRecord", "TimeSegment", null, { NumeroProjet: "1111" }];

  await harness.window.grist.docApi.applyUserActions([action]);

  assert.equal(harness.calls.length, 3, "deux colonnes creees une fois puis une transaction metier");
  assert.deepEqual(
    new Set(harness.calls.slice(0, 2).map((actions) => actions[0][2])),
    new Set(["GestionDepenses_Sync", "ChargePlanning_Sync"])
  );
  const transaction = harness.calls.at(-1);
  assert.equal(transaction.length, 2);
  assert.deepEqual(Array.from(transaction[0]), action);
  assert.equal(transaction[1][0], "UpdateRecord");
  assert.equal(transaction[1][1], "Projets2");
  assert.equal(transaction[1][2], 12);
  assert.deepEqual(Object.keys(transaction[1][3]).sort(), [
    "ChargePlanning_Sync",
    "GestionDepenses_Sync",
  ]);
  assert.match(transaction[1][3].ChargePlanning_Sync, /^\d+:\d+\|TimeSegment$/);
  assert.match(transaction[1][3].GestionDepenses_Sync, /^\d+:\d+\|TimeSegment$/);
});

test("une table sans rapport ne touche jamais Projets2", async () => {
  const harness = createHarness({
    signalColumns: ["GestionDepenses_Sync", "ChargePlanning_Sync"],
  });
  const action = ["UpdateRecord", "References2", 4, { Indice: "B" }];
  await harness.window.grist.docApi.applyUserActions([action]);

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].length, 1);
  assert.deepEqual(Array.from(harness.calls[0][0]), action);
});

test("la premiere modification du projet courant reveille sans clic", () => {
  const harness = createHarness();
  assert.equal(
    harness.window.ProjectMutationSyncRelay.acceptNativeSignalForCurrentProject({
      sectionTableId: "Projets2",
      delivery: { reason: "records" },
      records: [{ id: 12, GestionDepenses_Sync: "premiere-modification" }],
    }),
    true
  );
});

test("les changements d'un autre projet sont ignores", () => {
  const harness = createHarness();
  const accepts = harness.window.ProjectMutationSyncRelay.acceptNativeSignalForCurrentProject;
  accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "selection" },
    records: [
      { id: 12, GestionDepenses_Sync: "initial-12" },
      { id: 99, GestionDepenses_Sync: "initial-99" },
    ],
  });

  assert.equal(accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [
      { id: 12, GestionDepenses_Sync: "initial-12" },
      { id: 99, GestionDepenses_Sync: "modifie-99" },
    ],
  }), false);
  assert.equal(accepts({
    sectionTableId: "Projets2",
    delivery: { reason: "records" },
    records: [
      { id: 12, GestionDepenses_Sync: "modifie-12" },
      { id: 99, GestionDepenses_Sync: "modifie-99" },
    ],
  }), true);
});

test("la creation d'un projet reveille le catalogue meme sans projet courant", () => {
  const harness = createHarness({ projectId: null });
  const accepts = harness.window.ProjectMutationSyncRelay.acceptNativeSignalForCurrentProject;

  assert.equal(accepts({
    sectionTableId: "Projets2",
    watchedTableName: "Projets2",
    delivery: { reason: "selection" },
    records: [{ id: 12 }, { id: 99 }],
  }), false);
  assert.equal(accepts({
    sectionTableId: "Projets2",
    watchedTableName: "Projets2",
    delivery: { reason: "records" },
    records: [{ id: 12 }, { id: 99 }, { id: 123 }],
  }), true);
  assert.equal(accepts({
    sectionTableId: "Projets2",
    watchedTableName: "Budget",
    delivery: { reason: "records" },
    records: [{ id: 12 }, { id: 99 }, { id: 123 }],
  }), false, "seul le catalogue Projets2 doit etre relu");
});

test("le signal invalide la table metier ciblee et pas les autres caches", () => {
  const harness = createHarness();
  const accepts = harness.window.ProjectMutationSyncRelay.acceptNativeSignalForCurrentProject;
  for (const watchedTableName of ["Budget", "TimeSegment"]) {
    accepts({
      sectionTableId: "Projets2",
      watchedTableName,
      delivery: { reason: "selection" },
      records: [{ id: 12, GestionDepenses_Sync: "initial|Budget" }],
    });
  }

  const records = [{ id: 12, GestionDepenses_Sync: "modifie|TimeSegment" }];
  assert.equal(accepts({
    sectionTableId: "Projets2",
    watchedTableName: "Budget",
    delivery: { reason: "records" },
    records,
  }), false, "Budget ne doit pas etre relu pour un segment");
  assert.equal(accepts({
    sectionTableId: "Projets2",
    watchedTableName: "TimeSegment",
    delivery: { reason: "records" },
    records,
  }), true, "le cache TimeSegment doit etre invalide puis relu");
});

test("une source metier directe reste compatible et aucun polling n'est arme", () => {
  const harness = createHarness();
  assert.equal(
    harness.window.ProjectMutationSyncRelay.acceptNativeSignalForCurrentProject({
      sectionTableId: "TimeSegment",
      delivery: { reason: "records" },
      records: [],
    }),
    true
  );
  assert.equal(
    harness.window.ProjectMutationSyncRelay.acceptNativeSignalForCurrentProject({
      sectionTableId: "TimeSegment",
      watchedTableName: "Budget",
      delivery: { reason: "records" },
      records: [],
    }),
    false
  );
  assert.doesNotMatch(source, /setInterval\s*\(|setTimeout\s*\(/);
});
