import test from "node:test";
import assert from "node:assert/strict";

import { buildExpenseData } from "../assets/js/services/projectService.js";
import { buildAverageIndexTimeline } from "../assets/js/ui/avancementDashboard.js";

const NOW = new Date(2026, 2, 15);

function plan(overrides) {
  return {
    Service: "Structure",
    Zone: "A",
    Designation: "Plan",
    ...overrides,
  };
}

test("courbe mensuelle par type : sans indice = 0, 0 = 1, A = 2, B = 3", () => {
  const timeline = buildAverageIndexTimeline([
    // Plan 1 : 0 en janvier, A en février.
    plan({ NumeroDocument: "1", Type_document: "COFFRAGE", Indice: "", DateDiffusion: "" }),
    plan({ NumeroDocument: "1", Type_document: "COFFRAGE", Indice: "0", DateDiffusion: "2026-01-10" }),
    plan({ NumeroDocument: "1", Type_document: "COFFRAGE", Indice: "A", DateDiffusion: "2026-02-20" }),
    // Plan 2 : jamais diffusé, compte 0.
    plan({ NumeroDocument: "2", Type_document: "COFFRAGE", Indice: "", DateDiffusion: "" }),
    // Plan 3 : B diffusé en mars.
    plan({ NumeroDocument: "3", Type_document: "ARMATURES", Indice: "B", DateDiffusion: "2026-03-01" }),
  ], { now: NOW });

  assert.deepEqual(timeline.months.map((month) => month.key), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(timeline.groupBy, "type");
  assert.deepEqual(timeline.series, [
    { label: "COFFRAGE", documentCount: 2, values: [0.5, 1, 1] },
    { label: "ARMATURES", documentCount: 1, values: [0, 0, 3] },
  ]);
  assert.deepEqual(timeline.total, { label: "Total", documentCount: 3, values: [1 / 3, 2 / 3, 5 / 3] });
});

test("la plage de mois va jusqu'au mois courant même sans diffusion récente", () => {
  const timeline = buildAverageIndexTimeline([
    plan({ NumeroDocument: "1", Type_document: "NDC", Indice: "0", DateDiffusion: "2025-12-05" }),
  ], { now: NOW });

  assert.deepEqual(timeline.months.map((month) => month.key), ["2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(timeline.total.values, [1, 1, 1, 1]);
});

test("aucune date de diffusion : pas de courbe", () => {
  const timeline = buildAverageIndexTimeline([
    plan({ NumeroDocument: "1", Type_document: "NDC", Indice: "", DateDiffusion: "" }),
  ], { now: NOW });

  assert.equal(timeline, null);
});

test("plusieurs projets (Gestion-globale) : une courbe par projet + total", () => {
  const timeline = buildAverageIndexTimeline([
    plan({ NumeroDocument: "P1 - 1", ProjectLabel: "Projet A", Type_document: "COFFRAGE", Indice: "C", DateDiffusion: "2026-03-02" }),
    plan({ NumeroDocument: "P1 - 2", ProjectLabel: "Projet A", Type_document: "NDC", Indice: "", DateDiffusion: "" }),
    plan({ NumeroDocument: "P2 - 1", ProjectLabel: "Projet B", Type_document: "COFFRAGE", Indice: "0", DateDiffusion: "2026-03-03" }),
  ], { groupBy: "project", now: NOW });

  assert.equal(timeline.groupBy, "project");
  assert.deepEqual(timeline.series, [
    { label: "Projet A", documentCount: 2, values: [2] },
    { label: "Projet B", documentCount: 1, values: [1] },
  ]);
  assert.deepEqual(timeline.total.values, [5 / 3]);
});

test("les dates Grist en secondes epoch (fetchTable) alimentent bien la courbe", () => {
  const { projects: [project] } = buildExpenseData({
    projectRows: [{ id: 1, Numero_de_projet: "100", Nom_de_projet: "Projet A", Avancement: "" }],
    budgetRows: [],
    listePlanRows: [
      // 2026-01-09 et 2026-02-20 à minuit UTC, tels que renvoyés par Grist.
      { id: 11, Nom_projet: "Projet A", Service: "Structure", NumeroDocument: "1", Designation: "Mur", Type_document: "COFFRAGE", Zone: "A", Indice: "0", DateDiffusion: 1767916800 },
      { id: 12, Nom_projet: "Projet A", Service: "Structure", NumeroDocument: "1", Designation: "Mur", Type_document: "COFFRAGE", Zone: "A", Indice: "A", DateDiffusion: 1771545600 },
    ],
    planningProjectRows: [],
    projectTeamRows: [],
    timesheetRows: [],
    timeSegmentRows: [],
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
  });

  const timeline = buildAverageIndexTimeline(project.avancementRecords, { now: NOW });
  assert.deepEqual(timeline.months.map((month) => month.key), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(timeline.total.values, [1, 2, 2]);
});
