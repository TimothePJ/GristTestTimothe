// Données d'entrée (References2) d'une ligne du planning Structure : quand le début de sa
// barre bouge, leur date limite garde son écart en semaines et leur retard est recompté.
// Module partagé par Planning Projet (toutes ses écritures de dates) et MS Project (import
// XML, édition d'une date).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildReferenceDocumentRestFilter,
  computeReferenceRetardDays,
  getPlanningSegmentStartDate,
  planReferenceDeadlineActions,
} from "../assets/js/utils/planningReferenceDeadlines.js";

const PROJECT = "PROJET TEST";
const TODAY = new Date(2026, 10, 23);

function planningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    ID2: "001",
    Taches: "RDC",
    Type_doc: "COFFRAGE",
    Zone: "Zone A",
    Date_limite: "2026-07-01",
    Diff_coffrage: "2026-07-15",
    Demarrages_travaux: "",
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

function plan({ planningRows = [planningRow()], fields = { Date_limite: "2026-08-17" }, referenceRows }) {
  return planReferenceDeadlineActions({
    planningRows,
    fieldsByRowId: fields instanceof Map ? fields : new Map([[1, fields]]),
    referenceRows,
    today: TODAY,
  });
}

test("la date limite suit le début de la barre, à la même durée, et le retard est recompté", () => {
  assert.deepEqual(plan({ referenceRows: [referenceRow()] }), [
    ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "7" }],
  ]);
});

test("une donnée d'entrée non reçue est en retard jusqu'à aujourd'hui", () => {
  assert.deepEqual(plan({ referenceRows: [referenceRow({ Recu: "", Retard: "" })] }), [
    ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "112" }],
  ]);
});

test("armatures : le début de la barre est la diffusion du coffrage", () => {
  const row = planningRow({ Type_doc: "ARMATURES", Date_limite: "", Diff_coffrage: "2026-07-01" });

  assert.deepEqual(getPlanningSegmentStartDate(row), new Date(2026, 6, 1));
  assert.deepEqual(
    plan({
      planningRows: [row],
      fields: { Diff_coffrage: "2026-08-17" },
      referenceRows: [referenceRow({ Type_document: "ARMATURES" })],
    }),
    [["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "7" }]]
  );
});

test("sans durée, un écart d'un nombre entier de semaines devient la durée", () => {
  assert.deepEqual(
    plan({ referenceRows: [referenceRow({ DureeLimite: "", Bloquant: false, Recu: "2026-08-01", Retard: "" })] }),
    [["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", DureeLimite: 2 }]]
  );
});

test("sans durée ni écart en semaines entières, la donnée d'entrée n'est pas déplacée", () => {
  assert.deepEqual(
    plan({ referenceRows: [referenceRow({ DureeLimite: "", DateLimite: "2026-06-20" })] }),
    []
  );
});

test("bloquante sans durée ni date : elle se cale sur le début de la barre et reste sans durée", () => {
  assert.deepEqual(
    plan({ referenceRows: [referenceRow({ DureeLimite: "", DateLimite: "1900-01-01", Recu: "2026-08-01", Retard: "" })] }),
    [["UpdateRecord", "References2", 11, { DateLimite: "2026-08-17" }]]
  );
});

test("seules les données d'entrée du même projet, document, type et zone sont concernées", () => {
  const others = [
    referenceRow({ id: 12, NomProjet: "AUTRE" }),
    referenceRow({ id: 13, NumeroDocument: "002" }),
    referenceRow({ id: 14, NomDocument: "R+1" }),
    referenceRow({ id: 15, Type_document: "ARMATURES" }),
    referenceRow({ id: 16, Zone: "Zone B" }),
  ];

  assert.deepEqual(plan({ referenceRows: others }), []);
});

test("faute de donnée d'entrée dans la zone de la ligne, celles sans zone sont prises", () => {
  assert.deepEqual(plan({ referenceRows: [referenceRow({ Zone: "" })] }), [
    ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "7" }],
  ]);
  assert.deepEqual(
    plan({ referenceRows: [referenceRow(), referenceRow({ id: 12, Zone: "" })] }).map((action) => action[2]),
    [11]
  );
});

test("un début de barre qui ne bouge pas ne produit aucune écriture", () => {
  assert.deepEqual(
    plan({ fields: { Demarrages_travaux: "2026-09-21" }, referenceRows: [referenceRow({ Retard: "54" })] }),
    []
  );
});

test("une ligne qui n'est pas écrite ne déplace pas ses données d'entrée", () => {
  assert.deepEqual(plan({ fields: new Map([[99, { Date_limite: "2026-08-17" }]]), referenceRows: [referenceRow()] }), []);
});

test("plusieurs lignes écrites : chacune déplace ses propres données d'entrée", () => {
  const rows = [planningRow(), planningRow({ id: 2, ID2: "002", Taches: "R+1", Date_limite: "2026-07-08" })];
  const fields = new Map([
    [1, { Date_limite: "2026-08-17" }],
    [2, { Date_limite: "2026-08-24" }],
  ]);
  const references = [
    referenceRow(),
    referenceRow({ id: 21, NumeroDocument: "002", NomDocument: "R+1", DateLimite: "2026-07-01", DureeLimite: "1", Recu: "2026-08-01", Retard: "31" }),
  ];

  assert.deepEqual(plan({ planningRows: rows, fields, referenceRows: references }), [
    ["UpdateRecord", "References2", 11, { DateLimite: "2026-08-03", Retard: "7" }],
    ["UpdateRecord", "References2", 21, { DateLimite: "2026-08-17", Retard: "" }],
  ]);
});

test("le retard d'une donnée d'entrée compte les jours calendaires après sa date limite", () => {
  assert.equal(computeReferenceRetardDays("2026-08-10", "2026-08-03", TODAY), 7);
  assert.equal(computeReferenceRetardDays("2026-08-03", "2026-08-03", TODAY), null);
  assert.equal(computeReferenceRetardDays("", "2026-11-20", TODAY), 3);
  assert.equal(computeReferenceRetardDays("", "1900-01-01", TODAY), null);
});

test("le filtre de lecture porte sur les noms et numéros de document des lignes", () => {
  assert.deepEqual(
    buildReferenceDocumentRestFilter([
      planningRow(),
      planningRow({ id: 2, ID2: "002", Taches: "", Tache: "R+1" }),
      planningRow({ id: 3, ID2: "", Taches: "Sans numéro" }),
    ]),
    { NomDocument: ["RDC", "R+1"], NumeroDocument: ["001", "002"] }
  );
  assert.equal(buildReferenceDocumentRestFilter([planningRow({ ID2: "", Taches: "" })]), null);
});
