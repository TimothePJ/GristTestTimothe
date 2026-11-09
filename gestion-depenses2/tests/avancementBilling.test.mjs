import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  avcDateToMonthKey,
  buildBilledAmountsByProject,
  parseAvcAmount,
} from "../assets/js/utils/avancementBilling.js";
import * as projectService from "../assets/js/services/projectService.js";
import { APP_CONFIG } from "../assets/js/config.js";

const { buildChartSeries, buildExpenseData } = projectService;

// Extraits reels de BaseDRTO (Service + T_Avancement), types tels que Grist
// les rend apres import : nombres pour les identifiants, montants et mois.
const SERVICE_ROWS = [
  { id: 8, ID_Service: 8, Libelle_service: "Synthèse et Bim Management", Service: "Synthese" },
  { id: 12, ID_Service: 13, Libelle_service: "Méthodes Dumez", Service: "" },
  { id: 13, ID_Service: 14, Libelle_service: "Topographie", Service: "Topographie" },
  { id: 20, ID_Service: 24, Libelle_service: "Structures DUMEZ", Service: "Structure" },
  { id: 21, ID_Service: 25, Libelle_service: "Structures PETIT", Service: "Structure" },
];

function avc(affaire, chapitre, date, service, montant) {
  return {
    avc_ID_Affaire: affaire,
    avc_ID_Chapitre: chapitre,
    avc_Date: date,
    avc_ID_Service: service,
    avc_Montant: montant,
  };
}

const AVANCEMENT_ROWS = [
  avc(252035, 610, 202509, 24, 1625),
  avc(252035, 612, 202509, 24, 10175),
  avc(252035, 610, 202510, 24, 5400),
  avc(252035, 611, 202510, 24, 1800),
  avc(252035, 612, 202510, 24, 3375),
  avc(252035, 617, 202510, 24, null),
  avc(252035, 478, 202510, 13, 675),
  avc(252035, 659, 202512, 8, 1500),
  avc(242033, 610, 202409, 24, 100),
  avc(242033, 621, 202506, 25, 3974.8739),
  avc(242033, 493, 202508, 13, -27570.112),
];

test("T_Avancement : avc_Montant additionne par affaire et par mois pour Structure (services 24 + 25)", () => {
  const byProject = buildBilledAmountsByProject(AVANCEMENT_ROWS, SERVICE_ROWS, "Structure");

  assert.deepEqual(byProject.get("252035"), { "2025-09": 11800, "2025-10": 10575 });
  assert.deepEqual(byProject.get("242033"), { "2024-09": 100, "2025-06": 3974.8739 });
});

test("T_Avancement : un service sans valeur dans la colonne Service (Methodes) est ignore", () => {
  const onlyMethodes = AVANCEMENT_ROWS.filter((row) => row.avc_ID_Service === 13);
  const byProject = buildBilledAmountsByProject(onlyMethodes, SERVICE_ROWS, "Structure");

  assert.equal(byProject.size, 0);
});

test("T_Avancement : le service Synthese ne voit que les lignes du service 8", () => {
  const byProject = buildBilledAmountsByProject(AVANCEMENT_ROWS, SERVICE_ROWS, "Synthese");

  assert.deepEqual([...byProject.keys()], ["252035"]);
  assert.deepEqual(byProject.get("252035"), { "2025-12": 1500 });
});

test("T_Avancement : le rapprochement du service ignore accents et casse", () => {
  const serviceRows = [{ ID_Service: 8, Service: "Synthèse" }];
  const byProject = buildBilledAmountsByProject(
    [avc(1234, 1, 202601, 8, 50)],
    serviceRows,
    "synthese"
  );

  assert.deepEqual(byProject.get("1234"), { "2026-01": 50 });
});

test("T_Avancement : identifiants de service et d'affaire en texte rapproches comme en nombre", () => {
  const byProject = buildBilledAmountsByProject(
    [avc("252035", 610, "202509", "24", "1625")],
    [{ ID_Service: "24", Service: "Structure" }],
    "Structure"
  );

  assert.deepEqual(byProject.get("252035"), { "2025-09": 1625 });
});

test("avc_Montant : virgule decimale, vide et negatif", () => {
  assert.equal(parseAvcAmount("1986,2"), 1986.2);
  assert.equal(parseAvcAmount(""), 0);
  assert.equal(parseAvcAmount(null), 0);
  assert.equal(parseAvcAmount(-3010), -3010);
  assert.equal(parseAvcAmount("-27570,112"), -27570.112);
});

test("avc_Date : 202509, '202509' et '2025-09' designent septembre 2025", () => {
  assert.equal(avcDateToMonthKey(202509), "2025-09");
  assert.equal(avcDateToMonthKey("202509"), "2025-09");
  assert.equal(avcDateToMonthKey("2025-09"), "2025-09");
  assert.equal(avcDateToMonthKey(202513), "");
  assert.equal(avcDateToMonthKey(""), "");
});

test("avc_Date : un nombre qui n'est pas AAAAMM (cellule vide = 0) ne devient pas janvier 1970", () => {
  [0, 2025, 20259, "0", "2025", "20259"].forEach((value) => {
    assert.equal(avcDateToMonthKey(value), "", `valeur ${JSON.stringify(value)}`);
  });
  // Une vraie colonne Date Grist (secondes depuis 1970) reste lue.
  assert.equal(avcDateToMonthKey(Date.UTC(2025, 8, 15) / 1000), "2025-09");
});

function projectWithBudget(extra = {}) {
  return {
    id: 1,
    projectNumber: "252035",
    name: "ERA QUAI D'ORSAY",
    budgetLines: [{ id: 1, chapter: "Etudes", amount: 100000 }],
    workers: [],
    ...extra,
  };
}

const VIEW_STATE = { selectedYear: 2025, selectedMonth: 7, monthSpan: 6 };

test("graphique : la facturation est le cumul des montants T_Avancement, en euros et en % du budget", () => {
  const project = projectWithBudget({
    billedAmountByMonth: { "2025-09": 11800, "2025-10": 10575 },
    workers: [{
      id: 1,
      dailyRate: 500,
      provisionalDays: { "2025-08": 2, "2025-11": 3 },
      workedDays: {},
    }],
  });

  const series = buildChartSeries(project, VIEW_STATE);

  assert.deepEqual(
    series.displayedMonths.map((month) => month.monthKey),
    ["2025-08", "2025-09", "2025-10", "2025-11"]
  );
  assert.deepEqual(series.billedAmountData, [0, 11800, 22375, 22375]);
  assert.deepEqual(series.billingPercentData, [0, 11.8, 22.375, 22.375]);
});

test("graphique : les mois factures elargissent la plage meme sans pointage", () => {
  const project = projectWithBudget({
    billedAmountByMonth: { "2025-09": 1000, "2025-11": 500 },
  });

  const series = buildChartSeries(project, VIEW_STATE);

  assert.deepEqual(
    series.displayedMonths.map((month) => month.monthKey),
    ["2025-09", "2025-10", "2025-11"]
  );
  assert.deepEqual(series.billedAmountData, [1000, 1000, 1500]);
});

test("graphique : l'ancienne saisie Projets2 n'est plus jamais lue", () => {
  const legacyBilling = { "2025-09": 50 };
  const withEmptyAvancement = projectWithBudget({
    billedAmountByMonth: {},
    billingPercentageByMonth: legacyBilling,
    workers: [{ id: 1, dailyRate: 500, provisionalDays: { "2025-09": 2 }, workedDays: {} }],
  });
  const withoutAvancement = projectWithBudget({
    billingPercentageByMonth: legacyBilling,
    workers: [{ id: 1, dailyRate: 500, provisionalDays: { "2025-09": 2 }, workedDays: {} }],
  });

  [withEmptyAvancement, withoutAvancement].forEach((project) => {
    const series = buildChartSeries(project, VIEW_STATE);
    assert.deepEqual(series.billingPercentData, [0]);
    assert.deepEqual(series.billedAmountData, [0]);
  });
});

function expenseTables(extra = {}) {
  return {
    projectRows: [
      { id: 1, Numero_de_projet: "252035", Nom_de_projet: "ERA QUAI D'ORSAY" },
      { id: 2, Numero_de_projet: 242033, Nom_de_projet: "FNV" },
      { id: 3, Numero_de_projet: "262023", Nom_de_projet: "CACHAN" },
    ],
    budgetRows: [],
    listePlanRows: [],
    planningProjectRows: [],
    projectTeamRows: [],
    timesheetRows: [],
    timeSegmentRows: [],
    timeRealRows: [],
    teamRows: [],
    timeOutRows: [],
    ...extra,
  };
}

test("buildExpenseData rattache la facturation T_Avancement a chaque projet par son numero, pour le service lu", () => {
  const { projects } = buildExpenseData(expenseTables({
    avancementRows: AVANCEMENT_ROWS,
    serviceRows: SERVICE_ROWS,
    activeService: "Structure",
  }));

  const byNumber = Object.fromEntries(projects.map((project) => [project.projectNumber, project]));
  assert.deepEqual(byNumber["252035"].billedAmountByMonth, { "2025-09": 11800, "2025-10": 10575 });
  assert.deepEqual(byNumber["242033"].billedAmountByMonth, { "2024-09": 100, "2025-06": 3974.8739 });
  assert.deepEqual(byNumber["262023"].billedAmountByMonth, {});
});

test("buildExpenseData sans lignes T_Avancement pose une facturation vide sur chaque projet", () => {
  const { projects } = buildExpenseData(expenseTables());

  projects.forEach((project) => {
    assert.deepEqual(project.billedAmountByMonth, {});
  });
});

test("l'ancienne facturation Projets2 a disparu du modele et de la configuration", () => {
  const { projects } = buildExpenseData(expenseTables({
    projectRows: [{
      id: 1,
      Numero_de_projet: "252035",
      Nom_de_projet: "ERA QUAI D'ORSAY",
      Pourcentage_Facturation: 12,
      Pourcentage_Facturation_Par_Mois: JSON.stringify({ "2025-09": 50 }),
    }],
  }));

  assert.equal("billingPercentage" in projects[0], false);
  assert.equal("billingPercentageByMonth" in projects[0], false);
  assert.equal("billingPercentage" in APP_CONFIG.grist.columns.projects, false);
  assert.equal("billingPercentageByMonth" in APP_CONFIG.grist.columns.projects, false);
  [
    "getBillingPercentageForMonth",
    "getBillingAmountFromPercentage",
    "getBillingPercentageFromAmount",
    "normalizeBillingPercentageValue",
    "getPriorCumulativeBilling",
  ].forEach((legacyExport) => {
    assert.equal(legacyExport in projectService, false, `${legacyExport} doit disparaitre`);
  });
});

function tableFromRows(rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return Object.fromEntries(keys.map((key) => [key, rows.map((row) => row[key])]));
}

test("fetchProjectDataTables lit T_Avancement et Service et date la lecture du service actif", async () => {
  const previousWindow = globalThis.window;
  const previousServiceContext = globalThis.GristServiceContext;
  const tablesByName = {
    T_Avancement: tableFromRows(AVANCEMENT_ROWS),
    Service: tableFromRows(SERVICE_ROWS),
  };
  globalThis.GristServiceContext = { getService: () => "Structure" };
  globalThis.window = {
    grist: {
      docApi: {
        async fetchTable(tableName) {
          return tablesByName[tableName] || { id: [] };
        },
      },
    },
  };

  try {
    const url = new URL("../assets/js/services/gristService.js", import.meta.url);
    url.searchParams.set("test", "avancement-billing-tables");
    const service = await import(url.href);
    const data = await service.fetchProjectDataTables();

    assert.equal(data.avancementRows.length, AVANCEMENT_ROWS.length);
    assert.equal(data.avancementRows[0].avc_Montant, 1625);
    assert.equal(data.serviceRows.length, SERVICE_ROWS.length);
    assert.equal(data.activeService, "Structure");
  } finally {
    globalThis.window = previousWindow;
    globalThis.GristServiceContext = previousServiceContext;
  }
});

function captureChartConfig(project) {
  const previousChart = globalThis.Chart;
  let captured = null;
  globalThis.Chart = function FakeChart(_canvas, config) {
    captured = config;
    this.destroy = () => {};
  };
  return import("../assets/js/ui/chart.js").then(({ renderSpendingChart }) => {
    try {
      renderSpendingChart({}, null, project, VIEW_STATE);
      return captured;
    } finally {
      globalThis.Chart = previousChart;
    }
  });
}

test("graphique : les barres bleues T_Avancement sont libellees comme un cumul", async () => {
  const config = await captureChartConfig(projectWithBudget({
    billedAmountByMonth: { "2025-09": 1000, "2025-10": 500 },
  }));

  const bars = config.data.datasets.find((dataset) => /Montant facture/.test(dataset.label));
  assert.equal(bars.label, "Montant facture cumule (€)");
  assert.deepEqual(bars.data, [1000, 1500]);
});

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("le bloc de saisie « Facturation mensuelle » a disparu du widget", () => {
  const html = read("../index.html");
  const main = read("../assets/js/main.js");
  const dom = read("../assets/js/ui/dom.js");
  const chart = read("../assets/js/ui/chart.js");
  const service = read("../assets/js/services/gristService.js");

  assert.doesNotMatch(html, /spending-billing-editor/);
  assert.doesNotMatch(main, /spendingBillingEditor|billing-percentage|billing-amount|BillingEditor/);
  assert.doesNotMatch(dom, /spendingBillingEditor|spending-billing-editor/);
  assert.doesNotMatch(chart, /Facturation mensuelle|renderSpendingBillingEditor/);
  assert.doesNotMatch(service, /updateProjectBillingPercentages/);
});
