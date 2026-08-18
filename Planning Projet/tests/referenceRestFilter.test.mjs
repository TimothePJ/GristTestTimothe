import test from "node:test";
import assert from "node:assert/strict";

// Le service lit `window.grist` au moment de l'appel : le bac à sable doit être en
// place avant l'import, mais il reste modifiable ensuite.
const fetchCalls = [];
let referenceRows = [];
let planningRows = [];

globalThis.window = {
  grist: {
    docApi: {
      async fetchTable(tableName, options) {
        fetchCalls.push({ tableName, options });
        if (tableName === "References2") return referenceRows;
        if (tableName === "Planning_Projet") return planningRows;
        return [];
      },
      async applyUserActions() {
        return { retValues: [] };
      },
    },
  },
};

const {
  fetchPlanningReferenceDetails,
  fetchPlanningReferenceReceptionSummaries,
  invalidateDetailsCache,
} = await import("../assets/js/services/gristService.js");

const PROJECT = "PROJET TEST";

function planningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: "001",
    Taches: "RDC",
    Type_doc: "COFFRAGE",
    Zone: "Zone A",
    Date_limite: "2026-07-01",
    Duree_1: 2,
    Diff_coffrage: "2026-07-15",
    ...overrides,
  };
}

function referenceRow(overrides = {}) {
  return {
    id: 11,
    NomProjet: PROJECT,
    Service: "Structure",
    NumeroDocument: "001",
    NomDocument: "RDC",
    Type_document: "COFFRAGE",
    Zone: "Zone A",
    Emetteur: "BET",
    Reference: "R-1",
    Recu: "",
    DateLimite: "2026-06-17",
    DureeLimite: "2",
    Retard: "",
    Bloquant: true,
    Archive: false,
    ...overrides,
  };
}

function reset() {
  fetchCalls.length = 0;
  referenceRows = [];
  planningRows = [];
  invalidateDetailsCache();
}

function referenceFetchOptions() {
  return fetchCalls
    .filter((call) => call.tableName === "References2")
    .map((call) => call.options);
}

test("la timeline ne lit que les données d'entrée bloquantes", async () => {
  reset();
  referenceRows = [referenceRow()];

  await fetchPlanningReferenceReceptionSummaries([planningRow()]);

  assert.deepEqual(referenceFetchOptions(), [
    { restFilter: { Bloquant: [true] } },
  ]);
});

test("le détail d'une ligne ne lit que les références de son document", async () => {
  reset();
  planningRows = [planningRow()];
  referenceRows = [referenceRow()];

  const details = await fetchPlanningReferenceDetails(1);

  assert.deepEqual(referenceFetchOptions(), [
    { restFilter: { NomDocument: ["RDC"], NumeroDocument: ["001"] } },
  ]);
  assert.deepEqual(details.references.map((reference) => reference.id), [11]);
});

// Sans document exploitable, restreindre reviendrait à ne rien lire : il vaut mieux
// lire la table du contexte que d'afficher « aucune référence liée » à tort.
test("une ligne de planning sans document ne pose aucun filtre document", async () => {
  reset();
  planningRows = [planningRow({ Taches: "", ID2: "" })];
  referenceRows = [];

  await fetchPlanningReferenceDetails(1);

  assert.deepEqual(referenceFetchOptions(), [{}]);
});

// La surveillance relit la table à chaque signal. Si elle n'hérite pas du filtre,
// elle rapatrie tout le projet et le filtre des lectures du widget ne sert à rien.
test("la surveillance de References2 hérite du filtre bloquant", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../assets/js/main.js", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /tableRestFilters:\s*\{\s*References2:\s*REFERENCE_BLOQUANT_REST_FILTER\s*\}/,
    "watchContextTables doit passer le filtre bloquant pour References2"
  );
});

// Le gabarit du dialogue est une chaîne HTML, les contrôles sont retrouvés par
// `querySelector` : une classe mal orthographiée d'un côté ne casse rien à
// l'exécution, elle rend juste le bouton inerte. On vérifie donc l'accord.
test("les contrôles groupés du dialogue Détails sont posés et câblés", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../assets/js/ui/timeline.js", import.meta.url),
    "utf8"
  );

  [
    "planning-ref-select-all",
    "planning-ref-bulk-duration",
    "planning-ref-bulk-duration-apply",
  ].forEach((className) => {
    assert.ok(
      source.includes(`class="${className}"`),
      `classe ${className} absente du gabarit HTML`
    );
    assert.ok(
      source.includes(`querySelector(".${className}")`),
      `classe ${className} jamais retrouvée pour être câblée`
    );
  });
});

test("le filtre document couvre chaque document visé, sans lire les autres", async () => {
  reset();
  referenceRows = [referenceRow()];

  await fetchPlanningReferenceReceptionSummaries([
    planningRow(),
    planningRow({ id: 2, ID2: "002", Taches: "R+1" }),
  ]);

  // Les résumés de timeline restent sur le filtre bloquant, le plus sélectif ici.
  assert.deepEqual(referenceFetchOptions(), [
    { restFilter: { Bloquant: [true] } },
  ]);
});
