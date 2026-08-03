import test from "node:test";
import assert from "node:assert/strict";

import { buildExpenseData } from "../assets/js/services/projectService.js";
import {
  buildStatsByType,
  isAvancementRecordComplete,
} from "../assets/js/ui/avancementDashboard.js";

const projectRows = [{
  id: 1,
  Numero_de_projet: "100",
  Nom_de_projet: "Projet A",
  Avancement: JSON.stringify([{ typeDocument: "COFFRAGE", indice: "C" }]),
}];

function buildData() {
  return buildExpenseData({
    projectRows,
    budgetRows: [],
    listePlanRows: [
      { id: 11, Nom_projet: "Projet A", Service: "Structure", NumeroDocument: "42", Designation: "Mur", Type_document: "COFFRAGE", Zone: "A", Indice: "B", DateDiffusion: "2026-07-01" },
      { id: 12, Nom_projet: "Projet A", Service: "Structure", NumeroDocument: "42", Designation: "Mur", Type_document: "COFFRAGE", Zone: "B", Indice: "B", DateDiffusion: "2026-07-01" },
      { id: 13, Nom_projet: "Projet A", Service: "Structure", NumeroDocument: "43", Designation: "Dalle", Type_document: "COFFRAGE", Zone: "A", Indice: "D", DateDiffusion: "2026-07-02" },
    ],
    planningProjectRows: [
      { id: 21, NomProjet: "Projet A", Service: "Structure", ID2: "42", Taches: "Mur", Type_doc: "COFFRAGE", Zone: "A", Indice: "B", Date_Cloture: "2026-07-15", Date_limite: "2026-07-01", Diff_coffrage: "2026-07-10", Retards: 5 },
      { id: 22, NomProjet: "Projet A", Service: "Structure", ID2: "42", Taches: "Mur", Type_doc: "COFFRAGE", Zone: "B", Indice: "B", Date_Cloture: null, Date_limite: "2026-07-01", Diff_coffrage: "2026-07-10", Retards: 10 },
      { id: 23, NomProjet: "Projet A", Service: "Structure", ID2: "43", Taches: "Dalle", Type_doc: "COFFRAGE", Zone: "A", Indice: "D", Date_Cloture: null, Date_limite: "2026-07-01", Diff_coffrage: "2026-07-10", Retards: 0 },
    ],
    projectTeamRows: [],
    timesheetRows: [],
    timeSegmentRows: [],
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
  });
}

test("gestion-depenses2 enrichit ListePlan avec la bonne clôture sans collision de zone", () => {
  const { projects: [project] } = buildData();
  const zoneA = project.avancementRecords.find((record) => record.Zone === "A" && record.NumeroDocument === "42");
  const zoneB = project.avancementRecords.find((record) => record.Zone === "B");
  assert.equal(zoneA.Date_Cloture, "2026-07-15");
  assert.equal(zoneA.PlanningRowId, 21);
  assert.equal(zoneB.Date_Cloture, null);
  assert.equal(zoneB.PlanningRowId, 22);
});

test("planningTasks conserve Date_Cloture, force 100 % et laisse les autres règles naturelles", () => {
  const { projects: [project] } = buildData();
  const closedTask = project.planningTasks.find((task) => task.id === 21);
  const openTask = project.planningTasks.find((task) => task.id === 22);
  const aboveTargetTask = project.planningTasks.find((task) => task.id === 23);
  assert.equal(closedTask.dateCloture, "2026-07-15");
  assert.equal(closedTask.realisationPct, 100);
  assert.ok(openTask.realisationPct < 100);
  assert.equal(aboveTargetTask.realisationPct, 100);
});

test("le tableau Avancement compte clôture et indice supérieur comme terminés", () => {
  const { projects: [project] } = buildData();
  const records = project.avancementRecords;
  assert.equal(isAvancementRecordComplete(records[0], "C"), true);
  assert.equal(isAvancementRecordComplete(records[1], "C"), false);
  assert.equal(isAvancementRecordComplete(records[2], "C"), true);

  const stats = buildStatsByType(records, { COFFRAGE: "C" });
  assert.equal(stats.COFFRAGE.totalDocs.size, 3);
  assert.equal(stats.COFFRAGE.advancedDocs.size, 2);
});
