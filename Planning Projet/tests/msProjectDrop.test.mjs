// Dépôt d'une tâche MS Project sur une ligne du planning Structure : ce qui est écrit dans
// Planning_Projet (lien + dates), puis dans References2 (données d'entrée de la ligne).
import test from "node:test";
import assert from "node:assert/strict";

// Le service lit `window.grist` au moment de l'appel : le bac à sable doit être en
// place avant l'import, mais il reste modifiable ensuite.
const fetchCalls = [];
const actionBatches = [];
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
      async applyUserActions(actions) {
        actionBatches.push(structuredClone(actions));
        return { retValues: [] };
      },
    },
  },
};

const {
  invalidateDetailsCache,
  planPlanningMsProjectDrop,
  updatePlanningFromMsProjectDrop,
} = await import("../assets/js/services/gristService.js");

const PROJECT = "PROJET TEST";
const DROP = {
  uniqueNumber: "42",
  xmlName: "Planning A",
  msStartIso: "2026-09-21",
  msEndIso: "2026-09-25",
};

function planningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: "001",
    Taches: "RDC",
    Type_doc: "COFFRAGE",
    Zone: "Zone A",
    Groupe: "",
    Ligne_planning: "",
    Nom_XML: "",
    Date_limite: "2026-07-01",
    Duree_1: 2,
    Diff_coffrage: "2026-07-15",
    Duree_2: "",
    Diff_armature: "",
    Duree_3: 3,
    Demarrages_travaux: "",
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
    Recu: "2026-08-10",
    DateLimite: "2026-06-17",
    DureeLimite: "2",
    Retard: "54",
    Bloquant: true,
    Archive: false,
    ...overrides,
  };
}

function reset() {
  fetchCalls.length = 0;
  actionBatches.length = 0;
  referenceRows = [];
  planningRows = [];
  invalidateDetailsCache();
}

test("coffrage : le lien est posé et les dates remontent depuis le début MS", async () => {
  reset();
  planningRows = [planningRow()];

  await updatePlanningFromMsProjectDrop({ rowId: 1, ...DROP });

  assert.deepEqual(actionBatches, [[
    ["UpdateRecord", "Planning_Projet", 1, {
      Ligne_planning: "42",
      Nom_XML: "Planning A",
      Demarrages_travaux: "2026-09-21",
      Date_limite: "2026-08-17",
      Diff_coffrage: "2026-08-31",
    }],
  ]]);
});

test("note de calcul : même calcul que le coffrage, et la ligne quitte son groupe", async () => {
  reset();
  planningRows = [planningRow({ Type_doc: "NDC", Groupe: "3" })];

  await updatePlanningFromMsProjectDrop({ rowId: 1, ...DROP });

  assert.deepEqual(actionBatches, [[
    ["UpdateRecord", "Planning_Projet", 1, {
      Ligne_planning: "42",
      Nom_XML: "Planning A",
      Demarrages_travaux: "2026-09-21",
      Date_limite: "2026-08-17",
      Diff_coffrage: "2026-08-31",
      Groupe: "",
    }],
  ]]);
});

test("armatures : ses dates remontent du début MS et le coffrage du groupe perd son lien", async () => {
  reset();
  planningRows = [
    planningRow({ Groupe: "1", Ligne_planning: "7", Nom_XML: "Ancien", Demarrages_travaux: "2026-05-04" }),
    planningRow({ id: 2, ID2: "002", Type_doc: "ARMATURES", Groupe: "1", Duree_2: 4, Duree_3: 1 }),
  ];

  await updatePlanningFromMsProjectDrop({ rowId: 2, ...DROP });

  assert.deepEqual(actionBatches, [[
    ["UpdateRecord", "Planning_Projet", 2, {
      Ligne_planning: "42",
      Nom_XML: "Planning A",
      Demarrages_travaux: "2026-09-21",
      Diff_coffrage: "2026-08-17",
      Diff_armature: "2026-09-14",
    }],
    ["UpdateRecord", "Planning_Projet", 1, {
      Ligne_planning: null,
      Nom_XML: null,
      Demarrages_travaux: null,
    }],
  ]]);
});

test("coffrage d'un groupe qui a des armatures : ses dates bougent mais il ne garde pas de lien", async () => {
  reset();
  planningRows = [
    planningRow({ Groupe: "1" }),
    planningRow({ id: 2, ID2: "002", Type_doc: "ARMATURES", Groupe: "1" }),
  ];

  await updatePlanningFromMsProjectDrop({ rowId: 1, ...DROP });

  assert.deepEqual(actionBatches, [[
    ["UpdateRecord", "Planning_Projet", 1, {
      Ligne_planning: null,
      Nom_XML: null,
      Demarrages_travaux: null,
      Date_limite: "2026-08-17",
      Diff_coffrage: "2026-08-31",
    }],
  ]]);
});

test("les données d'entrée de la ligne gardent leur écart en semaines avec le début de sa barre", async () => {
  reset();
  planningRows = [planningRow()];
  referenceRows = [referenceRow()];

  const result = await updatePlanningFromMsProjectDrop({ rowId: 1, ...DROP });

  // Début de barre : 2026-07-01 → 2026-08-17. La référence reste 2 semaines avant, et son
  // retard est recompté jusqu'à sa réception (2026-08-10).
  assert.deepEqual(actionBatches[1], [
    ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "7" }],
  ]);
  assert.equal(result.referenceDateLimiteUpdatedCount, 1);
  assert.deepEqual(
    fetchCalls.filter((call) => call.tableName === "References2").map((call) => call.options),
    [{ restFilter: { NomDocument: ["RDC"], NumeroDocument: ["001"] } }]
  );
});

test("une donnée d'entrée sans durée mais à un nombre entier de semaines reçoit sa durée", async () => {
  reset();
  planningRows = [planningRow()];
  referenceRows = [referenceRow({ DureeLimite: "", Bloquant: false, Recu: "2026-08-01", Retard: "" })];

  await updatePlanningFromMsProjectDrop({ rowId: 1, ...DROP });

  assert.deepEqual(actionBatches[1], [
    ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", DureeLimite: 2 }],
  ]);
});

test("une donnée d'entrée d'un autre document n'est pas touchée", async () => {
  reset();
  planningRows = [planningRow()];
  referenceRows = [referenceRow({ NomDocument: "R+1" })];

  const result = await updatePlanningFromMsProjectDrop({ rowId: 1, ...DROP });

  assert.equal(actionBatches.length, 1);
  assert.equal(result.referenceDateLimiteUpdatedCount, 0);
});

// Le dépôt s'affiche avant d'être écrit : ce que le planning montre tout de suite doit être
// exactement ce que l'écriture enverra.
test("le dépôt se calcule sans lecture ni écriture, ligne par ligne", () => {
  reset();
  const rows = [
    planningRow({ Groupe: "1", Ligne_planning: "7", Nom_XML: "Ancien", Demarrages_travaux: "2026-05-04" }),
    planningRow({ id: 2, ID2: "002", Type_doc: "ARMATURES", Groupe: "1", Duree_2: 4, Duree_3: 1 }),
  ];

  const plan = planPlanningMsProjectDrop(rows, { rowId: 2, ...DROP });

  assert.deepEqual(plan.fieldsByRowId, new Map([
    [2, {
      Ligne_planning: "42",
      Nom_XML: "Planning A",
      Demarrages_travaux: "2026-09-21",
      Diff_coffrage: "2026-08-17",
      Diff_armature: "2026-09-14",
    }],
    [1, { Ligne_planning: null, Nom_XML: null, Demarrages_travaux: null }],
  ]));
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(actionBatches, []);
});

test("le calcul du dépôt refuse une ligne absente", () => {
  assert.throws(
    () => planPlanningMsProjectDrop([planningRow()], { rowId: 99, ...DROP }),
    /Ligne Planning_Projet introuvable/
  );
});
