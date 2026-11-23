const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const servicePath = path.join(
  __dirname,
  "..",
  "assets",
  "js",
  "services",
  "gristService.js"
);

const TEST_CONFIG = {
  grist: {
    msProjectTable: {
      enabled: true,
      sourceTable: "MsProject",
      columns: {
        id: "id",
        uniqueNumber: "Numero_Unique",
        indicator: "Indicateur",
        taskName: "Nom_Tache",
        sourceName: "Nom",
        duration: "Duree",
        start: "Debut",
        end: "Fin",
        team: "Equipe",
        subTeam: "Sous_Equipe",
        barStyle: "Style_Barre",
        bold: "Bold",
        title: "Titre",
        effort: "Eff",
        projectLink: "NomProjet",
      },
      sourceNameCandidates: ["Nom"],
    },
    msProjectNamesTable: {
      sourceTable: "MsProjectNom",
      columns: { name: "Nom" },
    },
    planningSyncTable: { enabled: false },
  },
};

// Même configuration, synchronisation de Planning_Projet activée (celle du widget).
const SYNC_CONFIG = {
  grist: {
    ...TEST_CONFIG.grist,
    planningSyncTable: {
      enabled: true,
      sourceTable: "Planning_Projet",
      columns: {
        id: "id",
        projectLink: "NomProjet",
        linePlanning: "Ligne_planning",
        nomXml: "Nom_XML",
        demarragesTravaux: "Demarrages_travaux",
      },
      linePlanningCandidates: ["Ligne_planning", "LignePlanning"],
      nomXmlCandidates: ["Nom_XML", "NomXml"],
      demarrageCandidates: ["Demarrages_travaux", "Demarrage_travaux", "DemarrageTravaux"],
    },
  },
};

// Modules purs partagés avec Planning Projet : le service chargé par URL « data: » ne peut
// pas résoudre un chemin relatif, on lui donne leur adresse absolue.
const sharedUtilsUrl = `${pathToFileURL(
  path.join(__dirname, "..", "..", "gestion-depenses2", "assets", "js", "utils")
).href}/`;

let moduleSequence = 0;

async function loadService({ grist, fetch = null, DOMParser = null, config = TEST_CONFIG }) {
  const source = fs.readFileSync(servicePath, "utf8").replace(
    'import { APP_CONFIG } from "../config.js";',
    "const APP_CONFIG = globalThis.__MS_PROJECT_TEST_CONFIG;"
  ).replaceAll(
    '"../../../../gestion-depenses2/assets/js/utils/',
    `"${sharedUtilsUrl}`
  );
  global.__MS_PROJECT_TEST_CONFIG = config;
  global.window = { grist, fetch };
  if (DOMParser) global.DOMParser = DOMParser;
  moduleSequence += 1;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleSequence}`;
  return import(url);
}

// `restHiddenTables` : tables dont le jeton REST (lecture seule) ne montre aucune ligne,
// alors que le canal Grist du widget les lit — un propriétaire absent de la table Team.
function createGristHarness(
  initialTables,
  { failMsProjectMutation = false, restHiddenTables = [], failTables = [] } = {}
) {
  const tables = structuredClone(initialTables);
  const fetchCalls = [];
  const actionBatches = [];
  const restCalls = [];
  let nextId = 1000;

  const grist = {
    ready() {},
    docApi: {
      async getAccessToken() {
        return {
          baseUrl: "https://grist.invalid/api/docs/test-doc",
          token: "test-token",
          ttlMsecs: 60000,
        };
      },
      async fetchTable(tableName, options = {}) {
        fetchCalls.push({ tableName, options });
        if (!Object.prototype.hasOwnProperty.call(tables, tableName)) {
          throw new Error(`Table inconnue: ${tableName}`);
        }
        return tables[tableName];
      },
      async applyUserActions(actions) {
        actionBatches.push(structuredClone(actions));
        if (
          failMsProjectMutation &&
          actions.some((action) => action?.[1] === "MsProject")
        ) {
          throw new Error("écriture MsProject refusée");
        }
        const refusedTable = failTables.find((tableName) => actions.some((action) => action?.[1] === tableName));
        if (refusedTable) {
          throw new Error(`écriture ${refusedTable} refusée`);
        }

        for (const [kind, tableName, rowId, fields = {}] of actions) {
          const table = tables[tableName];
          if (!table) throw new Error(`Table inconnue: ${tableName}`);
          if (kind === "AddRecord") {
            const id = nextId++;
            const columns = new Set([...Object.keys(table), ...Object.keys(fields), "id"]);
            const currentLength = Array.isArray(table.id) ? table.id.length : 0;
            for (const column of columns) {
              if (!Array.isArray(table[column])) {
                table[column] = Array(currentLength).fill(null);
              }
              table[column].push(column === "id" ? id : (fields[column] ?? null));
            }
          } else if (kind === "RemoveRecord") {
            const index = table.id.indexOf(rowId);
            if (index >= 0) {
              Object.values(table).forEach((values) => {
                if (Array.isArray(values)) values.splice(index, 1);
              });
            }
          } else if (kind === "UpdateRecord") {
            const index = table.id.indexOf(rowId);
            if (index >= 0) {
              Object.entries(fields).forEach(([column, value]) => {
                if (!Array.isArray(table[column])) {
                  table[column] = Array(table.id.length).fill(null);
                }
                table[column][index] = value;
              });
            }
          }
        }
      },
    },
  };

  const fetch = async (url) => {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const tableName = decodeURIComponent(segments.at(-2));
    const filter = JSON.parse(parsed.searchParams.get("filter") || "null");
    const limit = Number(parsed.searchParams.get("limit")) || 0;
    restCalls.push({ tableName, filter, limit, url });
    if (!Object.prototype.hasOwnProperty.call(tables, tableName)) {
      return { ok: false, status: 404, async json() { return {}; } };
    }
    if (restHiddenTables.includes(tableName)) {
      return { ok: true, status: 200, async json() { return { records: [] }; } };
    }
    const rows = [];
    const table = tables[tableName];
    const ids = Array.isArray(table.id) ? table.id : [];
    for (let index = 0; index < ids.length; index += 1) {
      if (limit && rows.length >= limit) break;
      const fields = {};
      Object.entries(table).forEach(([column, values]) => {
        if (column !== "id" && Array.isArray(values)) fields[column] = values[index];
      });
      const matches = !filter || Object.entries(filter).every(([column, values]) => (
        (Array.isArray(values) ? values : [values]).some((value) => Object.is(fields[column], value))
      ));
      if (matches) rows.push({ id: ids[index], fields });
    }
    return { ok: true, status: 200, async json() { return { records: rows }; } };
  };

  return { grist, fetch, tables, fetchCalls, restCalls, actionBatches };
}

function createXmlParser() {
  const child = (localName, textContent) => ({ localName, textContent });
  const task = {
    children: [
      child("UID", "1"),
      child("Name", "Tâche importée"),
      child("Start", "2026-08-10T08:00:00"),
      child("Finish", "2026-08-11T17:00:00"),
      child("Duration", "PT7H24M"),
      child("Summary", "0"),
    ],
  };
  const document = {
    documentElement: { children: [] },
    querySelector() { return null; },
    getElementsByTagNameNS(_namespace, localName) {
      return localName === "Task" ? [task] : [];
    },
  };
  return class DOMParser {
    parseFromString() { return document; }
  };
}

function emptyMsProjectTable() {
  return {
    id: [],
    Numero_Unique: [],
    Indicateur: [],
    Nom_Tache: [],
    Nom: [],
    Duree: [],
    Debut: [],
    Fin: [],
    Equipe: [],
    Sous_Equipe: [],
    Style_Barre: [],
    Style: [],
    Bold: [],
    Titre: [],
    Eff: [],
    NomProjet: [],
  };
}

test("le démarrage construit les options uniquement depuis MsProjectNom", async () => {
  const harness = createGristHarness({
    MsProjectNom: {
      id: [1, 2, 3, 4, 5, 6],
      Nom: [" Projet B ", "", null, "Projet A", "Projet B", "   "],
    },
    MsProject: {
      id: [10],
      Nom: ["Ne doit pas être lu"],
    },
  });
  const service = await loadService({ grist: harness.grist, fetch: harness.fetch });

  const names = await service.buildProjectOptions();

  assert.deepEqual(names, ["Projet A", "Projet B"]);
  assert.deepEqual(harness.fetchCalls.map((call) => call.tableName), ["MsProjectNom"]);
  assert.deepEqual(harness.restCalls, []);
});

test("aucun nom sélectionné ne déclenche aucune lecture de MsProject", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [1], Nom: ["Projet A"] },
    MsProject: { id: [10], Nom: ["Projet A"] },
  });
  const service = await loadService({ grist: harness.grist, fetch: harness.fetch });

  const rows = await service.fetchMsProjectRows("");

  assert.deepEqual(rows, []);
  assert.deepEqual(harness.fetchCalls, []);
  assert.deepEqual(harness.restCalls, []);
});

test("le projet sélectionné est demandé par filtre REST puis vérifié strictement localement", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [1], Nom: ["Projet A"] },
    MsProject: {
      id: [10, 11, 12],
      Nom: ["Projet A", "Projet B", " Projet A "],
      Nom_Tache: ["A", "B", "A avec espaces"],
    },
  });
  const service = await loadService({ grist: harness.grist, fetch: harness.fetch });

  const rows = await service.fetchMsProjectRows("Projet A");

  assert.deepEqual(rows.map((row) => row.id), [10]);
  assert.deepEqual(harness.fetchCalls, []);
  assert.deepEqual(harness.restCalls.map(({ tableName, filter }) => ({ tableName, filter })), [
    { tableName: "MsProject", filter: { Nom: ["Projet A"] } },
  ]);
});

test("un import réussi ajoute le nom après MsProject et un remplacement ne le duplique pas", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [], Nom: [] },
    MsProject: emptyMsProjectTable(),
  });
  const service = await loadService({
    grist: harness.grist,
    fetch: harness.fetch,
    DOMParser: createXmlParser(),
  });
  const file = {
    name: "Projet A.xml",
    async text() { return "<Project />"; },
  };

  const firstResult = await service.importMsProjectXmlFile(file);
  const firstCatalogActions = harness.actionBatches
    .flat()
    .filter((action) => action[1] === "MsProjectNom");

  assert.equal(firstResult.catalogNameAdded, true);
  assert.equal(firstCatalogActions.length, 1);
  assert.deepEqual(firstCatalogActions[0][3], { Nom: "Projet A" });
  const flattenedFirstActions = harness.actionBatches.flat();
  assert.ok(
    flattenedFirstActions.findIndex((action) => action[1] === "MsProject") <
      flattenedFirstActions.findIndex((action) => action[1] === "MsProjectNom")
  );

  const secondResult = await service.importMsProjectXmlFile(file);
  const allCatalogActions = harness.actionBatches
    .flat()
    .filter((action) => action[1] === "MsProjectNom");

  assert.equal(secondResult.catalogNameAdded, false);
  assert.equal(allCatalogActions.length, 1);
  assert.deepEqual(harness.tables.MsProjectNom.Nom, ["Projet A"]);
  assert.equal(harness.tables.MsProject.Nom.filter((name) => name === "Projet A").length, 1);
  assert.equal(harness.fetchCalls.some((call) => call.tableName === "MsProject"), false);
});

test("un nouvel import ne lit pas toute la table quand le filtre REST ne renvoie aucune ligne", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [], Nom: [] },
    MsProject: emptyMsProjectTable(),
  });
  const service = await loadService({
    grist: harness.grist,
    fetch: harness.fetch,
    DOMParser: createXmlParser(),
  });
  const file = {
    name: "Nouveau projet.xml",
    async text() { return "<Project />"; },
  };

  const result = await service.importMsProjectXmlFile(file);
  const msProjectFetches = harness.restCalls.filter(
    (call) => call.tableName === "MsProject"
  );
  const importedAction = harness.actionBatches
    .flat()
    .find((action) => action[0] === "AddRecord" && action[1] === "MsProject");

  assert.equal(result.importedCount, 1);
  assert.equal(msProjectFetches.length, 1);
  assert.deepEqual(msProjectFetches[0].filter, { Nom: ["Nouveau projet"] });
  assert.equal(importedAction[3].Nom, "Nouveau projet");
  assert.deepEqual(harness.tables.MsProjectNom.Nom, ["Nouveau projet"]);
});

function unreachableRestFetch(restCalls) {
  return async (url) => {
    restCalls.push(url);
    throw new TypeError("Failed to fetch");
  };
}

test("REST injoignable : la lecture d'un nom bascule sur fetchTable et garde le filtre exact", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [1], Nom: ["Projet A"] },
    MsProject: {
      id: [10, 11, 12],
      Nom: ["Projet A", "Projet B", " Projet A "],
      Nom_Tache: ["A", "B", "A avec espaces"],
    },
  });
  const restCalls = [];
  const service = await loadService({
    grist: harness.grist,
    fetch: unreachableRestFetch(restCalls),
  });

  const firstRows = await service.fetchMsProjectRows("Projet A");
  const secondRows = await service.fetchMsProjectRows("Projet B");

  assert.deepEqual(firstRows.map((row) => row.id), [10]);
  assert.deepEqual(secondRows.map((row) => row.id), [11]);
  assert.equal(restCalls.length, 1, "REST n'est plus retenté après une panne");
  assert.deepEqual(harness.fetchCalls.map((call) => call.tableName), ["MsProject", "MsProject"]);
});

test("REST injoignable : un réimport remplace les lignes du nom sans doublon", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [], Nom: [] },
    MsProject: emptyMsProjectTable(),
  });
  const service = await loadService({
    grist: harness.grist,
    fetch: unreachableRestFetch([]),
    DOMParser: createXmlParser(),
  });
  const file = {
    name: "Projet A.xml",
    async text() { return "<Project />"; },
  };

  await service.importMsProjectXmlFile(file);
  const secondResult = await service.importMsProjectXmlFile(file);

  assert.equal(secondResult.deletedCount, 1);
  assert.equal(harness.tables.MsProject.Nom.filter((name) => name === "Projet A").length, 1);
  assert.deepEqual(harness.tables.MsProjectNom.Nom, ["Projet A"]);
});

test("un import dont l'écriture MsProject échoue ne modifie jamais MsProjectNom", async () => {
  const harness = createGristHarness(
    {
      MsProjectNom: { id: [], Nom: [] },
      MsProject: emptyMsProjectTable(),
    },
    { failMsProjectMutation: true }
  );
  const service = await loadService({
    grist: harness.grist,
    fetch: harness.fetch,
    DOMParser: createXmlParser(),
  });
  const file = {
    name: "Projet en échec.xml",
    async text() { return "<Project />"; },
  };

  await assert.rejects(
    service.importMsProjectXmlFile(file),
    /écriture MsProject refusée/
  );
  assert.equal(
    harness.actionBatches.flat().filter((action) => action[1] === "MsProjectNom").length,
    0
  );
  assert.deepEqual(harness.tables.MsProjectNom.Nom, []);
});

/* ---------- Synchronisation de Planning_Projet (lien avec le planning Structure) ---------- */

const PROJECT = "PROJET TEST";

// Table Grist en colonnes, à partir de lignes.
function toColumns(rows) {
  const columns = new Set(["id"]);
  rows.forEach((row) => Object.keys(row).forEach((key) => columns.add(key)));
  const table = {};
  columns.forEach((column) => {
    table[column] = rows.map((row) => row[column] ?? null);
  });
  return table;
}

function msTask(overrides = {}) {
  return {
    id: 10,
    Numero_Unique: "42",
    Nom: "Planning A",
    Nom_Tache: "Coffrage RDC",
    Debut: "2026-09-21",
    Fin: "2026-09-25",
    ...overrides,
  };
}

function linkedPlanningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    ID2: "001",
    Taches: "RDC",
    Type_doc: "COFFRAGE",
    Zone: "Zone A",
    Ligne_planning: "42",
    Nom_XML: "Planning A",
    Date_limite: "2026-07-01",
    Duree_1: 2,
    Diff_coffrage: "2026-07-15",
    Duree_2: "",
    Diff_armature: "",
    Duree_3: 3,
    Demarrages_travaux: "2026-08-05",
    ...overrides,
  };
}

function referenceRow(overrides = {}) {
  return {
    id: 11,
    NomProjet: PROJECT,
    NumeroDocument: "001",
    NomDocument: "RDC",
    Type_document: "COFFRAGE",
    Zone: "Zone A",
    Recu: "2026-08-10",
    DateLimite: "2026-06-17",
    DureeLimite: "2",
    Retard: "54",
    Bloquant: true,
    ...overrides,
  };
}

// Une donnée d'entrée d'un autre document : References2 n'est pas vide, mais rien n'y
// concerne les lignes testées.
const OTHER_REFERENCE = referenceRow({ id: 90, NumeroDocument: "900", NomDocument: "Autre" });

async function loadSyncService({
  planning = [linkedPlanningRow()],
  references = [OTHER_REFERENCE],
  tasks = [msTask()],
  options = {},
  fetch = null,
  DOMParser = null,
} = {}) {
  const harness = createGristHarness({
    MsProjectNom: { id: [], Nom: [] },
    MsProject: tasks.length ? toColumns(tasks) : emptyMsProjectTable(),
    Planning_Projet: toColumns(planning),
    References2: toColumns(references),
  }, options);
  const service = await loadService({
    grist: harness.grist,
    fetch: fetch || harness.fetch,
    DOMParser,
    config: SYNC_CONFIG,
  });
  return { harness, service };
}

const restCallsOn = (harness, tableName) => harness.restCalls
  .filter((call) => call.tableName === tableName)
  .map(({ filter, limit }) => (limit ? { filter, limit } : { filter }));
const fetchCallsOn = (harness, tableName) => harness.fetchCalls
  .filter((call) => call.tableName === tableName).length;
const actionsOn = (harness, tableName) => harness.actionBatches
  .flat()
  .filter((action) => action[1] === tableName);

const MOVED_DATES = {
  Demarrages_travaux: "2026-09-21",
  Diff_coffrage: "2026-08-31",
  Date_limite: "2026-08-17",
};

test("édition du début : le coffrage lié reprend ses dates depuis le nouveau début", async () => {
  const { harness, service } = await loadSyncService();

  const result = await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(actionsOn(harness, "Planning_Projet"), [
    ["UpdateRecord", "Planning_Projet", 1, MOVED_DATES],
  ]);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.matchedCount, 1);
});

// La même règle que le dépôt dans Planning Projet et que l'import XML : avant, seul le
// démarrage bougeait pour ces types, la barre restait à ses anciennes dates.
for (const typeDoc of ["NDC", "COUPES", "DEMOLITION", "Plan de phasage"]) {
  test(`édition du début : ${typeDoc} lié voit aussi sa diffusion et sa date limite recalculées`, async () => {
    const { harness, service } = await loadSyncService({
      planning: [linkedPlanningRow({ Type_doc: typeDoc })],
    });

    await service.syncPlanningDemarrageFromMsProjectStart(
      10, "2026-09-21", "Planning A", { msRow: msTask() }
    );

    assert.deepEqual(actionsOn(harness, "Planning_Projet"), [
      ["UpdateRecord", "Planning_Projet", 1, MOVED_DATES],
    ]);
  });
}

test("édition du début : la tâche vient du widget et Planning_Projet est lu par filtre sur le numéro unique", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow(), linkedPlanningRow({ id: 2, Ligne_planning: "7" })],
  });

  await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(restCallsOn(harness, "MsProject"), [], "la tâche n'est pas relue");
  assert.deepEqual(restCallsOn(harness, "Planning_Projet"), [
    { filter: { Ligne_planning: ["42", 42] } },
  ]);
  assert.equal(fetchCallsOn(harness, "Planning_Projet"), 0, "aucune lecture de la table entière");
  assert.deepEqual(actionsOn(harness, "Planning_Projet").map((action) => action[2]), [1]);
});

test("édition du début : sans tâche fournie, elle est relue par filtre sur son nom", async () => {
  const { harness, service } = await loadSyncService();

  const result = await service.syncPlanningDemarrageFromMsProjectStart(10, "2026-09-21", "Planning A");

  assert.deepEqual(restCallsOn(harness, "MsProject"), [{ filter: { Nom: ["Planning A"] } }]);
  assert.equal(result.updatedCount, 1);
});

test("édition du début : une ligne liée à un autre fichier XML n'est pas touchée", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow({ Nom_XML: "Planning B" })],
  });

  const result = await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(harness.actionBatches, []);
  assert.equal(result.matchedCount, 0);
});

test("édition du début : une ligne déjà aux bonnes dates n'est pas réécrite", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow(MOVED_DATES)],
  });

  const result = await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(harness.actionBatches, []);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.skipped, false);
});

test("édition du début : seules les dates qui changent sont écrites", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow({ Demarrages_travaux: "2026-09-21" })],
  });

  await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(actionsOn(harness, "Planning_Projet"), [
    ["UpdateRecord", "Planning_Projet", 1, { Diff_coffrage: "2026-08-31", Date_limite: "2026-08-17" }],
  ]);
});

const MOVED_REFERENCE = ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "7" }];

test("édition du début : les données d'entrée de la ligne suivent, juste après les dates du planning", async () => {
  const { harness, service } = await loadSyncService({
    references: [referenceRow(), OTHER_REFERENCE],
  });

  const result = await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  // Début de barre : 2026-07-01 → 2026-08-17. La référence reste 2 semaines avant, et son
  // retard est recompté jusqu'à sa réception (2026-08-10).
  assert.deepEqual(harness.actionBatches, [
    [["UpdateRecord", "Planning_Projet", 1, MOVED_DATES]],
    [MOVED_REFERENCE],
  ]);
  assert.equal(result.referenceUpdatedCount, 1);
  assert.equal(result.referenceFailed, false);
  assert.deepEqual(restCallsOn(harness, "References2"), [
    { filter: { NomDocument: ["RDC"], NumeroDocument: ["001"] } },
  ]);
  assert.equal(fetchCallsOn(harness, "References2"), 0, "aucune lecture de la table entière");
});

test("édition du début : une barre dont le début ne bouge pas ne fait pas lire les données d'entrée", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow({
      Type_doc: "ARMATURES",
      Duree_3: 1,
      Diff_armature: "2026-08-01",
    })],
    references: [referenceRow({ Type_document: "ARMATURES" })],
  });

  await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  // Armatures sans Durée 2 : la diffusion du coffrage (début de la barre) reste en place.
  assert.deepEqual(actionsOn(harness, "Planning_Projet"), [
    ["UpdateRecord", "Planning_Projet", 1, { Demarrages_travaux: "2026-09-21", Diff_armature: "2026-09-14" }],
  ]);
  assert.deepEqual(restCallsOn(harness, "References2"), []);
  assert.deepEqual(actionsOn(harness, "References2"), []);
});

test("jeton REST sans visibilité sur Planning_Projet : la table est relue en entier, une fois constaté", async () => {
  const { harness, service } = await loadSyncService({
    options: { restHiddenTables: ["Planning_Projet"] },
  });
  const edit = () => service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  const first = await edit();
  await edit();

  assert.equal(first.updatedCount, 1, "la ligne liée est trouvée malgré la réponse REST vide");
  assert.deepEqual(restCallsOn(harness, "Planning_Projet"), [
    { filter: { Ligne_planning: ["42", 42] } },
    { filter: null, limit: 1 },
  ], "REST n'est plus interrogé pour cette table");
  assert.equal(fetchCallsOn(harness, "Planning_Projet"), 2);
});

test("REST voit Planning_Projet mais aucune ligne liée : pas de lecture de la table entière", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow({ Ligne_planning: "7" })],
  });
  const edit = () => service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  const first = await edit();
  await edit();

  assert.equal(first.matchedCount, 0);
  assert.deepEqual(restCallsOn(harness, "Planning_Projet"), [
    { filter: { Ligne_planning: ["42", 42] } },
    { filter: null, limit: 1 },
    { filter: { Ligne_planning: ["42", 42] } },
  ], "la visibilité n'est vérifiée qu'une fois");
  assert.equal(fetchCallsOn(harness, "Planning_Projet"), 0);
});

test("REST injoignable : Planning_Projet et References2 sont lus en entier, même résultat", async () => {
  const restCalls = [];
  const { harness, service } = await loadSyncService({
    references: [referenceRow(), OTHER_REFERENCE],
    fetch: unreachableRestFetch(restCalls),
  });

  await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(harness.actionBatches, [
    [["UpdateRecord", "Planning_Projet", 1, MOVED_DATES]],
    [MOVED_REFERENCE],
  ]);
  assert.equal(fetchCallsOn(harness, "Planning_Projet"), 1);
  assert.equal(fetchCallsOn(harness, "References2"), 1);
});

// Avant, MS Project n'écrivait pas References2 : un refus sur cette table (droits, ligne
// supprimée entre la lecture et l'écriture) ne doit pas bloquer les dates du planning.
test("écriture des données d'entrée refusée : les dates du planning sont écrites, l'échec est signalé", async () => {
  const { harness, service } = await loadSyncService({
    references: [referenceRow(), OTHER_REFERENCE],
    options: { failTables: ["References2"] },
  });

  const result = await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.equal(harness.tables.Planning_Projet.Date_limite[0], "2026-08-17");
  assert.equal(harness.tables.References2.DateLimite[0], "2026-06-17");
  assert.equal(result.updatedCount, 1);
  assert.equal(result.referenceUpdatedCount, 0);
  assert.equal(result.referenceFailed, true);
});

// Planning Projet ne lit que les données d'entrée du service affiché. MS Project n'a pas de
// service : il se cale sur celui de la ligne du planning qu'il déplace.
test("une donnée d'entrée d'un autre service que la ligne n'est pas déplacée", async () => {
  const { harness, service } = await loadSyncService({
    planning: [linkedPlanningRow({ Service: "Structure" })],
    references: [
      referenceRow({ Service: "Synthese" }),
      referenceRow({ id: 12, Service: "Structure" }),
      referenceRow({ id: 13, Service: "" }),
      OTHER_REFERENCE,
    ],
  });

  await service.syncPlanningDemarrageFromMsProjectStart(
    10, "2026-09-21", "Planning A", { msRow: msTask() }
  );

  assert.deepEqual(actionsOn(harness, "References2").map((action) => action[2]), [12, 13]);
});

test("REST injoignable : References2 n'est relue en entier qu'une fois tant que rien n'y est écrit", async () => {
  const { harness, service } = await loadSyncService({
    fetch: unreachableRestFetch([]),
  });
  const edit = (isoDate) => service.syncPlanningDemarrageFromMsProjectStart(
    10, isoDate, "Planning A", { msRow: msTask({ Debut: isoDate }) }
  );

  await edit("2026-09-21");
  await edit("2026-09-28");

  assert.equal(actionsOn(harness, "Planning_Projet").length, 2, "la barre a bougé deux fois");
  assert.equal(fetchCallsOn(harness, "References2"), 1);
});

test("REST injoignable : après une écriture dans References2, la table est relue", async () => {
  const { harness, service } = await loadSyncService({
    references: [referenceRow(), OTHER_REFERENCE],
    fetch: unreachableRestFetch([]),
  });
  const edit = (isoDate) => service.syncPlanningDemarrageFromMsProjectStart(
    10, isoDate, "Planning A", { msRow: msTask({ Debut: isoDate }) }
  );

  await edit("2026-09-21");
  await edit("2026-09-28");

  assert.equal(actionsOn(harness, "References2").length, 2);
  assert.equal(fetchCallsOn(harness, "References2"), 2);
});

// L'import de test contient une tâche : numéro unique 1, du 2026-08-10 au 2026-08-11.
const IMPORT_FILE = {
  name: "Projet A.xml",
  async text() { return "<Project />"; },
};
const importedPlanningRow = (overrides = {}) => linkedPlanningRow({
  Ligne_planning: "1",
  Nom_XML: "Projet A",
  Duree_1: 1,
  Duree_3: 1,
  ...overrides,
});
const IMPORTED_DATES = {
  Demarrages_travaux: "2026-08-10",
  Diff_coffrage: "2026-08-03",
  Date_limite: "2026-07-27",
};

test("import : seules les lignes dont une date change sont réécrites et comptées", async () => {
  const { harness, service } = await loadSyncService({
    planning: [
      importedPlanningRow(IMPORTED_DATES),
      importedPlanningRow({ id: 2, ID2: "002", Taches: "R+1" }),
    ],
    tasks: [],
    DOMParser: createXmlParser(),
  });

  const result = await service.importMsProjectXmlFile(IMPORT_FILE);

  assert.deepEqual(actionsOn(harness, "Planning_Projet"), [
    ["UpdateRecord", "Planning_Projet", 2, IMPORTED_DATES],
  ]);
  assert.equal(result.planningSyncUpdatedCount, 1);
  assert.equal(result.planningSyncMatchedCount, 2);
});

test("import : un réimport sans changement de date n'écrit rien dans Planning_Projet", async () => {
  const { harness, service } = await loadSyncService({
    planning: [importedPlanningRow()],
    tasks: [],
    DOMParser: createXmlParser(),
  });

  await service.importMsProjectXmlFile(IMPORT_FILE);
  const second = await service.importMsProjectXmlFile(IMPORT_FILE);

  assert.equal(actionsOn(harness, "Planning_Projet").length, 1, "une seule écriture, au premier import");
  assert.equal(second.planningSyncUpdatedCount, 0);
  assert.equal(second.planningSyncMatchedCount, 1);
});

test("import : Planning_Projet est lu par filtre sur le nom du fichier XML", async () => {
  const { harness, service } = await loadSyncService({
    planning: [
      importedPlanningRow(),
      importedPlanningRow({ id: 2, Nom_XML: "Autre fichier" }),
    ],
    tasks: [],
    DOMParser: createXmlParser(),
  });

  await service.importMsProjectXmlFile(IMPORT_FILE);

  assert.deepEqual(restCallsOn(harness, "Planning_Projet"), [
    { filter: { Nom_XML: ["Projet A"] } },
  ]);
  assert.equal(fetchCallsOn(harness, "Planning_Projet"), 0, "aucune lecture de la table entière");
  assert.deepEqual(actionsOn(harness, "Planning_Projet").map((action) => action[2]), [1]);
});

test("import : les données d'entrée des lignes déplacées suivent, juste après les dates du planning", async () => {
  const { harness, service } = await loadSyncService({
    planning: [importedPlanningRow()],
    references: [referenceRow({ Recu: "2026-07-20" }), OTHER_REFERENCE],
    tasks: [],
    DOMParser: createXmlParser(),
  });

  const result = await service.importMsProjectXmlFile(IMPORT_FILE);

  // Début de barre : 2026-07-01 → 2026-07-27. La référence reste 2 semaines avant
  // (2026-07-13) ; reçue le 2026-07-20, elle a 7 jours de retard.
  const planningBatchIndex = harness.actionBatches.findIndex(
    (batch) => batch.some((action) => action[1] === "Planning_Projet")
  );
  assert.deepEqual(harness.actionBatches.slice(planningBatchIndex), [
    [["UpdateRecord", "Planning_Projet", 1, IMPORTED_DATES]],
    [["UpdateRecord", "References2", 11, { DateLimite: "2026-07-13", Retard: "7" }]],
  ]);
  assert.equal(result.planningSyncReferenceUpdatedCount, 1);
  assert.equal(result.planningSyncReferenceFailed, false);
});

test("l'édition d'une date transmet la tâche déjà affichée, sans la faire relire", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "assets", "js", "main.js"),
    "utf8"
  );

  assert.match(
    source,
    /syncPlanningDemarrageFromMsProjectStart\([^;]*\{\s*msRow:/,
    "handleDateCellEdit doit passer la ligne MS Project du cache"
  );
});
