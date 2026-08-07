const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

let moduleSequence = 0;

async function loadService({ grist, runtime = null, DOMParser = null }) {
  const source = fs.readFileSync(servicePath, "utf8").replace(
    'import { APP_CONFIG } from "../config.js";',
    "const APP_CONFIG = globalThis.__MS_PROJECT_TEST_CONFIG;"
  );
  global.__MS_PROJECT_TEST_CONFIG = TEST_CONFIG;
  global.window = { grist, GristServiceContext: runtime };
  if (DOMParser) global.DOMParser = DOMParser;
  moduleSequence += 1;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${moduleSequence}`;
  return import(url);
}

function createGristHarness(
  initialTables,
  { failMsProjectMutation = false, fetchTableOverride = null } = {}
) {
  const tables = structuredClone(initialTables);
  const fetchCalls = [];
  const actionBatches = [];
  let nextId = 1000;

  const grist = {
    ready() {},
    docApi: {
      async fetchTable(tableName, options = {}) {
        fetchCalls.push({ tableName, options });
        if (typeof fetchTableOverride === "function") {
          const overridden = await fetchTableOverride({ tableName, options, tables });
          if (overridden !== undefined) return overridden;
        }
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
          }
        }
      },
    },
  };

  return { grist, tables, fetchCalls, actionBatches };
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
  const service = await loadService({ grist: harness.grist });

  const names = await service.buildProjectOptions();

  assert.deepEqual(names, ["Projet A", "Projet B"]);
  assert.deepEqual(harness.fetchCalls.map((call) => call.tableName), ["MsProjectNom"]);
  assert.equal(harness.fetchCalls[0].options.fullTable, true);
  assert.deepEqual(harness.fetchCalls[0].options.requiredColumns, ["Nom"]);
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
  const service = await loadService({ grist: harness.grist });

  const rows = await service.fetchMsProjectRows("Projet A");

  assert.deepEqual(rows.map((row) => row.id), [10]);
  assert.deepEqual(harness.fetchCalls[0], {
    tableName: "MsProject",
    options: {
      restFilter: { Nom: ["Projet A"] },
      requiredColumns: ["Nom"],
    },
  });
});

test("un import réussi ajoute le nom après MsProject et un remplacement ne le duplique pas", async () => {
  const harness = createGristHarness({
    MsProjectNom: { id: [], Nom: [] },
    MsProject: emptyMsProjectTable(),
  });
  const invalidated = [];
  const runtime = { invalidateCache(tableName) { invalidated.push(tableName); } };
  const service = await loadService({
    grist: harness.grist,
    runtime,
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
  assert.ok(invalidated.includes("MsProject"));
  assert.ok(invalidated.includes("MsProjectNom"));
});

test("un nouvel import récupère le schéma si le filtre REST ne renvoie encore aucune ligne", async () => {
  const harness = createGristHarness(
    {
      MsProjectNom: { id: [], Nom: [] },
      MsProject: emptyMsProjectTable(),
    },
    {
      fetchTableOverride({ tableName, options }) {
        if (tableName === "MsProject" && options.restFilter) return { id: [] };
        return undefined;
      },
    }
  );
  const service = await loadService({
    grist: harness.grist,
    DOMParser: createXmlParser(),
  });
  const file = {
    name: "Nouveau projet.xml",
    async text() { return "<Project />"; },
  };

  const result = await service.importMsProjectXmlFile(file);
  const msProjectFetches = harness.fetchCalls.filter(
    (call) => call.tableName === "MsProject"
  );
  const importedAction = harness.actionBatches
    .flat()
    .find((action) => action[0] === "AddRecord" && action[1] === "MsProject");

  assert.equal(result.importedCount, 1);
  assert.equal(msProjectFetches.length, 2);
  assert.deepEqual(msProjectFetches[0].options.restFilter, { Nom: ["Nouveau projet"] });
  assert.equal(msProjectFetches[1].options.fullTable, true);
  assert.equal(importedAction[3].Nom, "Nouveau projet");
  assert.deepEqual(harness.tables.MsProjectNom.Nom, ["Nouveau projet"]);
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
