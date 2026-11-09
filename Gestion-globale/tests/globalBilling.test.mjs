import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildAggregatedProject,
  buildGlobalExpenseData,
} from "../assets/js/services/globalProjectService.js";
import { buildChartSeries } from "../../gestion-depenses2/assets/js/services/projectService.js";

// Meme rattachement que gestion-depenses2 : avc_ID_Service -> Service.ID_Service
// -> colonne Service (24 et 25 = Structure, 13 = Methodes, sans equivalent).
const SERVICE_ROWS = [
  { ID_Service: 13, Service: "" },
  { ID_Service: 24, Service: "Structure" },
  { ID_Service: 25, Service: "Structure" },
];

function avc(affaire, date, service, montant) {
  return { avc_ID_Affaire: affaire, avc_Date: date, avc_ID_Service: service, avc_Montant: montant };
}

const AVANCEMENT_ROWS = [
  avc(252035, 202509, 24, 1625),
  avc(252035, 202509, 24, 10175),
  avc(252035, 202510, 24, 10575),
  avc(242033, 202509, 25, 4000),
  avc(242033, 202509, 13, 999),
];

function globalTables(extra = {}) {
  return {
    projectRows: [
      { id: 1, Numero_de_projet: "252035", Nom_de_projet: "ERA QUAI D'ORSAY", DOP: "1" },
      { id: 2, Numero_de_projet: "242033", Nom_de_projet: "FNV", DOP: "2" },
      // Doublon Projets2 du meme numero : fusionne en un seul projet canonique,
      // sa facturation ne doit pas etre comptee deux fois.
      { id: 3, Numero_de_projet: "252035", Nom_de_projet: "ERA QUAI D'ORSAY", DOP: "1" },
    ],
    budgetRows: [
      { id: 11, NumeroProjet: "252035", Chapter: "Etudes", Amount: 100000, Service: "Structure" },
      { id: 12, NumeroProjet: "242033", Chapter: "Etudes", Amount: 300000, Service: "Structure" },
    ],
    listePlanRows: [],
    planningProjectRows: [],
    projectTeamRows: [],
    timesheetRows: [],
    timeSegmentRows: [],
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
    avancementRows: AVANCEMENT_ROWS,
    serviceRows: SERVICE_ROWS,
    activeService: "Structure",
    ...extra,
  };
}

function projectsByNumber(projects) {
  return Object.fromEntries(projects.map((project) => [project.projectNumber, project]));
}

test("Gestion-globale : chaque projet porte sa facturation T_Avancement, doublons Projets2 compris une seule fois", () => {
  const { projects } = buildGlobalExpenseData(globalTables());
  const byNumber = projectsByNumber(projects);

  assert.deepEqual(byNumber["252035"].billedAmountByMonth, { "2025-09": 11800, "2025-10": 10575 });
  assert.deepEqual(byNumber["242033"].billedAmountByMonth, { "2025-09": 4000 });
});

test("Gestion-globale : sans service choisi, aucune facturation n'est attribuee", () => {
  const { projects } = buildGlobalExpenseData(globalTables({ activeService: "" }));

  projects.forEach((project) => {
    assert.deepEqual(project.billedAmountByMonth, {});
  });
});

test("Gestion-globale : le projet agrege additionne mois par mois la facturation des projets selectionnes", () => {
  const { projects } = buildGlobalExpenseData(globalTables());
  const aggregated = buildAggregatedProject(projects);

  assert.deepEqual(aggregated.billedAmountByMonth, { "2025-09": 15800, "2025-10": 10575 });
  assert.equal("billingPercentage" in aggregated, false);
  assert.equal("billingPercentageByMonth" in aggregated, false);
});

test("Gestion-globale : la serie bleue du graphique est le cumul agrege, en % du budget total selectionne", () => {
  const { projects } = buildGlobalExpenseData(globalTables());
  const aggregated = buildAggregatedProject(projects);

  const series = buildChartSeries(aggregated, { selectedYear: 2025, selectedMonth: 8, monthSpan: 6 });

  assert.deepEqual(
    series.displayedMonths.map((month) => month.monthKey),
    ["2025-09", "2025-10"]
  );
  assert.deepEqual(series.billedAmountData, [15800, 26375]);
  assert.deepEqual(series.billingPercentData, [3.95, 6.59375]);
});

test("Gestion-globale : un seul projet selectionne garde sa propre facturation", () => {
  const { projects } = buildGlobalExpenseData(globalTables());
  const fnv = projects.filter((project) => project.projectNumber === "242033");

  assert.deepEqual(buildAggregatedProject(fnv).billedAmountByMonth, { "2025-09": 4000 });
});

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Gestion-globale : la facturation suit le service du filtre personnes et T_Avancement est surveillee", () => {
  const main = read("../assets/js/main.js");

  const filter = main.match(/function filterTablesByPersonService\(tables\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(filter, "filterTablesByPersonService introuvable : adapter le test");
  // Les deux branches (service choisi ou non) transmettent le service retenu.
  assert.equal((filter[1].match(/activeService:\s*selectedService/g) || []).length, 2);

  const watch = main.match(/watchContextTables\s*\(\s*\[([\s\S]*?)\]/);
  assert.ok(watch, "watchContextTables introuvable");
  assert.match(watch[1], /tables\.avancement/);
  assert.match(watch[1], /tables\.services/);
});

test("Gestion-globale : plus aucune lecture de l'ancienne facturation Projets2", () => {
  const service = read("../assets/js/services/globalProjectService.js");

  assert.doesNotMatch(service, /billingPercentage|BillingPercentage/);
});
