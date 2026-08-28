import assert from "node:assert/strict";
import test from "node:test";

function emptyTable() {
  return { id: [] };
}

async function importFreshService(label) {
  const url = new URL("../assets/js/services/gristService.js", import.meta.url);
  url.searchParams.set("test", label);
  return import(url.href);
}

test("la creation du projet et de son budget est une transaction unique", async () => {
  const appliedTransactions = [];
  const previousWindow = globalThis.window;
  const previousServiceContext = globalThis.GristServiceContext;
  globalThis.GristServiceContext = { getService: () => "Structure" };
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() { return emptyTable(); },
        async applyUserActions(actions) {
          appliedTransactions.push(actions);
          return { retValues: [52, 53, 54] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("atomic-project-budget");
    await service.createProjectWithBudget({
      name: "Projet synchronise",
      projectNumber: "4242",
      budgetLines: [
        { chapter: "Etudes", amount: 1000 },
        { chapter: "Travaux", amount: 2000 },
      ],
    });

    assert.equal(appliedTransactions.length, 1);
    assert.deepEqual(
      appliedTransactions[0].map((action) => [action[0], action[1]]),
      [
        ["AddRecord", "Projets2"],
        ["AddRecord", "Budget"],
        ["AddRecord", "Budget"],
      ]
    );
  } finally {
    globalThis.window = previousWindow;
    globalThis.GristServiceContext = previousServiceContext;
  }
});

test("createTimeSegment ecrit Mois et n'ecrit plus Start_At/End_At", async () => {
  const appliedActions = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() {
          return {
            id: [],
            NumeroProjet: [],
            Name: [],
            Mois: [],
            Allocation_Days: [],
            Effectif: [],
            Label: [],
            Service: [],
          };
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [42] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("create-time-segment-mois");
    await service.createTimeSegment({
      projectNumber: "25-0142",
      name: "Marie DUPONT",
      monthKey: "2026-09",
      effectif: 8,
    });

    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(fields.Effectif, 8);
    assert.equal(fields.Allocation_Days, 22);
    assert.ok(!("Start_At" in fields), "Start_At ne doit plus etre ecrite");
    assert.ok(!("End_At" in fields), "End_At ne doit plus etre ecrite");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("createTimeSegment rafraichit les alias de colonnes avant l'ecriture", async () => {
  let timeSegmentTable = {
    id: [1],
    NumeroProjet: ["1111"],
    Name: ["Abdelkarim Trabelsi"],
    Month: [1785668400],
    Allocation_Days: [28.5],
    Effectif: [5],
    Service: ["Structure"],
  };
  const fetchCalls = [];
  const appliedActions = [];
  const previousWindow = globalThis.window;

  globalThis.window = {
    grist: {
      docApi: {
        __serviceContextPatched: true,
        async fetchTable(tableName, options) {
          fetchCalls.push({ tableName, options });
          return tableName === "TimeSegment" ? timeSegmentTable : emptyTable();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [42] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("fresh-time-segment-columns");
    await service.fetchProjectDataTables();

    // La colonne Mois est renommee en base (repli "Month" -> "Mois") entre le
    // chargement initial et l'ecriture : createTimeSegment doit repartir du
    // schema courant, pas de cette ancienne photo mise en cache par
    // fetchProjectDataTables.
    timeSegmentTable = {
      ...timeSegmentTable,
      Mois: timeSegmentTable.Month,
    };
    delete timeSegmentTable.Month;

    const createdId = await service.createTimeSegment({
      projectNumber: "1111",
      name: "Abdelkarim Trabelsi",
      monthKey: "2026-09",
      effectif: 5,
    });

    assert.equal(createdId, 42);
    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Month, undefined);
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(
      fetchCalls.some((call) =>
        call.tableName === "TimeSegment" && call.options?.forceRefresh === true
      ),
      true
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("le repli de schema vide utilise Mois et Allocation_Days", async () => {
  const appliedActions = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() {
          return emptyTable();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [43] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("empty-schema-fallback");
    await service.createTimeSegment({
      projectNumber: "1111",
      name: "Abdelkarim Trabelsi",
      monthKey: "2026-09",
      effectif: 5,
    });

    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(fields.Allocation_Days, 22);
    assert.ok(!("Start_At" in fields));
    assert.ok(!("End_At" in fields));
  } finally {
    globalThis.window = previousWindow;
  }
});

test("updateTimeSegment ecrit Mois et Allocation_Days derives, plus de Start_At/End_At", async () => {
  const appliedActions = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable() {
          return emptyTable();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          return { retValues: [] };
        },
      },
    },
  };

  try {
    const service = await importFreshService("update-time-segment-mois");
    await service.updateTimeSegment({
      segmentId: 7,
      monthKey: "2026-09",
      effectif: 12,
    });

    const [action, tableName, id, fields] = appliedActions.at(-1);
    assert.equal(action, "UpdateRecord");
    assert.equal(tableName, "TimeSegment");
    assert.equal(id, 7);
    assert.equal(fields.Mois, Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    assert.equal(fields.Allocation_Days, 22);
    assert.equal(fields.Effectif, 12);
    assert.ok(!("Start_At" in fields), "Start_At ne doit plus etre ecrite");
    assert.ok(!("End_At" in fields), "End_At ne doit plus etre ecrite");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("la detection de schema inspecte toutes les lignes d'un tableau", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable(tableName) {
          if (tableName !== "TimeSegment") return emptyTable();
          return [
            {
              id: 1,
              NumeroProjet: "1111",
              Name: "Premiere ligne",
              Start_Date: 1785668400,
              Allocation_Days: 1,
              Service: "Structure",
            },
            {
              id: 2,
              NumeroProjet: "1111",
              Name: "Deuxieme ligne",
              Start_Date: 1785754800,
              EndDate: 1785841200,
              Allocation_Days: 1,
              Service: "Structure",
            },
          ];
        },
        async applyUserActions() {
          throw new Error("Aucune ecriture attendue dans ce test.");
        },
      },
    },
  };

  try {
    const service = await importFreshService("all-row-column-detection");
    const data = await service.fetchProjectDataTables();
    assert.equal(data.timeSegmentRows[1].End_At, 1785841200);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("fetchNormalizedTimeSegmentRows conserve Mois pour une ligne sans Start_At", async () => {
  const previousWindow = globalThis.window;
  const moisValue = Math.floor(new Date(2026, 8, 1).getTime() / 1000);
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable(tableName) {
          if (tableName !== "TimeSegment") return emptyTable();
          // Ligne posterieure a la bascule : Mois est renseigne, Start_At n'a
          // jamais existe sur cette ligne (colonne absente, pas seulement
          // vide). C'est le cas normal de tout nouveau segment une fois que
          // createTimeSegment n'ecrit plus Start_At.
          return [
            {
              id: 5,
              NumeroProjet: "1111",
              Name: "Alix Martin",
              Mois: moisValue,
              Allocation_Days: 22,
              Effectif: 10,
              Service: "Structure",
            },
          ];
        },
        async applyUserActions() {
          throw new Error("Aucune ecriture attendue dans ce test.");
        },
      },
    },
  };

  try {
    const service = await importFreshService("normalized-rows-mois-without-start-at");
    const data = await service.fetchProjectDataTables();
    assert.equal(data.timeSegmentRows[0].Mois, moisValue);
    assert.equal(data.timeSegmentRows[0].Start_At, undefined);
  } finally {
    globalThis.window = previousWindow;
  }
});

// --- BUG : la barre « charge du mois » ne voyait qu un seul projet ------------
//
// `grist.docApi.fetchTable` est patche par shared/grist-service-context.js, et
// TimeSegment y a une politique REST_PROJECT_SERVICE
// (shared/service-context-core.js) : une lecture ORDINAIRE est deja filtree par
// projet ET par service avant que ce service ne voie une ligne. Ce que
// `buildExpenseData` appelait allTimeSegmentRows etait donc en realite restreint
// au projet affiche. La sortie prevue par le contrat est { fullTable: true },
// verifiee sur le vrai module partage dans
// shared/tests/service-context-runtime.test.cjs.
//
// Le bouchon ci-dessous imite ce contrat, filtre compris.
function contextPatchedDocApi(rows, { project = "1111", service = "Structure", patched = true } = {}) {
  const calls = [];
  const docApi = {
    async fetchTable(tableName, options) {
      calls.push({ tableName, options });
      if (tableName !== "TimeSegment") return emptyTable();
      if (options && options.fullTable === true) return rows.map((row) => ({ ...row }));
      return rows
        .filter((row) => row.NumeroProjet === project && row.Service === service)
        .map((row) => ({ ...row }));
    },
    async applyUserActions() {
      throw new Error("Aucune ecriture attendue dans ce test.");
    },
  };
  if (patched) docApi.__serviceContextPatched = true;
  return { docApi, calls };
}

const CROSS_PROJECT_SEGMENT_ROWS = [
  { id: 1, NumeroProjet: "1111", Name: "Alix Martin", Effectif: 4, Allocation_Days: 20, Service: "Structure" },
  { id: 2, NumeroProjet: "2222", Name: "Alix Martin", Effectif: 5, Allocation_Days: 20, Service: "Fluides" },
];

test("fetchProjectDataTables expose allTimeSegmentRows : tous projets, tous services", async () => {
  const previousWindow = globalThis.window;
  const { docApi, calls } = contextPatchedDocApi(CROSS_PROJECT_SEGMENT_ROWS);
  globalThis.window = { grist: { docApi } };

  try {
    const service = await importFreshService("all-time-segment-rows-full-table");
    const data = await service.fetchProjectDataTables();

    assert.deepEqual(
      data.timeSegmentRows.map((row) => row.id),
      [1],
      "la vue projet reste filtree projet + service (non-regression)"
    );
    assert.deepEqual(
      data.allTimeSegmentRows.map((row) => row.id),
      [1, 2],
      "la barre doit voir la ligne du projet 2222, service Fluides"
    );
    assert.equal(
      data.allTimeSegmentRows[1].NumeroProjet,
      "2222",
      "les lignes completes restent normalisees comme les autres"
    );
    assert.ok(
      calls.some((call) => call.tableName === "TimeSegment" && call.options && call.options.fullTable === true),
      "la lecture non filtree doit bien etre demandee au contrat partage"
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("hors couche de contexte, aucune option n atteint fetchTable", async () => {
  // Le RPC Grist natif n accepte qu un nom de table : lui passer un second
  // argument serait au mieux ignore. La barre retombe sur les lignes deja lues.
  const previousWindow = globalThis.window;
  const { docApi, calls } = contextPatchedDocApi(CROSS_PROJECT_SEGMENT_ROWS, { patched: false });
  globalThis.window = { grist: { docApi } };

  try {
    const service = await importFreshService("all-time-segment-rows-unpatched");
    const data = await service.fetchProjectDataTables();
    assert.ok(
      calls.filter((call) => call.tableName === "TimeSegment").every((call) => call.options === undefined),
      "aucune option ne doit atteindre un fetchTable non patche"
    );
    assert.ok(Array.isArray(data.allTimeSegmentRows), "la barre garde un tableau exploitable");
  } finally {
    globalThis.window = previousWindow;
  }
});
