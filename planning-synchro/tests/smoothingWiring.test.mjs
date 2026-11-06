// Tests du BRANCHEMENT du lissage dans main.js : ce que loadProject,
// projectCatalogHasChanged et la creation du controleur font du controleur de
// lissage et du graphique (spec 2026-10-23, §5.2, §5.4 et §6.5).
//
// Meme technique que postWriteRefresh.test.mjs : `main.js` n'est pas importable
// sous Node (il s'amorce au chargement du document). On extrait le TEXTE REEL
// des fonctions concernees et on l'execute dans un `vm` sur un environnement
// bouchonne ; les dependances PURES restent les vraies (buildChartTasks,
// viewports, bornes...). On observe le COMPORTEMENT : qui est appele, avec quoi,
// dans quel ordre.
//
// Ce qui est verifie :
//   - meme projet et meme service : la vue Graphique est gardee et l'etat du
//     graphique (filtre, regroupement) repasse en initialUiState ;
//   - autre projet ou autre service : retour sur la vue Planning, etat neuf ;
//   - getUiState() est lu AVANT teardown(), qui detruit le graphique ;
//   - selection videe : smoothing.clear() ;
//   - signal Projets2 : refreshFromProjectRows recoit les lignes relues ;
//   - les deux relectures de Projets2 (chargement du projet et relecture avant
//     ecriture) demandent une lecture FRAICHE ({ fresh: true }).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { APP_CONFIG } from "../assets/js/config.js";
import { buildChartTasks } from "../assets/js/top/taskLoadModel.js";
import * as chargeBoardModule from "../assets/js/bottom/chargeBoard.js";
import * as chargePaneStateModule from "../assets/js/bottom/chargePaneState.js";
import * as boundsModule from "../assets/js/top/bounds.js";
import * as phasesModule from "../assets/js/top/phases.js";
import * as leaveAbsencesModule from "../assets/js/utils/leaveAbsences.js";
import * as projectRegistryModule from "../assets/js/services/projectRegistry.js";
import * as viewportBuildModule from "../assets/js/viewport/build.js";
import * as viewportNormalizeModule from "../assets/js/viewport/normalize.js";

const MAIN_PATH = new URL("../assets/js/main.js", import.meta.url);
const source = fs.readFileSync(MAIN_PATH, "utf8");

// --- extraction du texte reel de main.js -------------------------------------

// Extrait un bloc a partir de son en-tete (qui doit se terminer par une
// accolade ouvrante) en equilibrant les accolades. ECHOUE BRUYAMMENT si l'en-tete
// a disparu ou s'il est ambigu : une extraction muette ne testerait plus rien.
function extractBlock(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `bloc introuvable dans main.js : ${header}`);
  assert.equal(source.indexOf(header, start + 1), -1, `en-tete ambigu dans main.js : ${header}`);
  const open = start + header.length - 1;
  assert.equal(source[open], "{", `l'en-tete doit se terminer par une accolade : ${header}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`bloc non ferme dans main.js : ${header}`);
}

const LOAD_BLOCKS = [
  "function todayIsoDate() {",
  "function selectionKeyFor(project) {",
  "function viewportFitsWithinBounds(viewport, bounds) {",
  "function readAllTimeSegmentRows(payload) {",
  "function projectRegistrySignature(projects) {",
  "  function teardown() {",
  "  async function loadProject(project) {",
  "  async function projectCatalogHasChanged() {",
].map(extractBlock);

// --- jeu de donnees ------------------------------------------------------------

const PC = APP_CONFIG.grist.columns.planningProject;
const PROJECT_A = { id: 1, name: "A", number: "1" };
const PROJECT_B = { id: 2, name: "B", number: "2" };
const PLANNING_ROWS = [
  {
    id: 11,
    [PC.projectName]: "A",
    [PC.id2]: "1",
    [PC.taskName]: "T1",
    [PC.typeDoc]: "NDC",
    [PC.zone]: "Z",
    [PC.dateLimite]: "2027-03-01",
    [PC.diffCoffrage]: "2027-03-20",
  },
];
const CATALOG = [
  { id: 1, Nom_de_projet: "A", Numero_de_projet: "1", Lissage: '{"version":1,"services":{"Structure":{"maxTotal":1}}}' },
  { id: 2, Nom_de_projet: "B", Numero_de_projet: "2", Lissage: "" },
];
const UI_STATE = { visibleLabels: ["NDC"], knownLabels: ["NDC", "Total"], granularity: "week" };

// --- environnement bouchonne ---------------------------------------------------

function makeHarness() {
  const log = [];
  const chartOptions = [];
  const projectRowCalls = [];
  // smoothedBounds : ce que renvoie smoothing.getSmoothedBounds() ;
  // controllerBounds / setBounds : bornes donnees au controleur de la frise.
  const env = { service: "Structure", smoothedBounds: null, controllerBounds: [], setBounds: [] };

  const sandbox = {
    console,
    APP_CONFIG,
    state: { registry: [], selectedProject: null, viewport: null },
    els: {
      select: {}, toolbar: {}, empty: { hidden: false }, main: { hidden: true }, planning: {}, splitter: {},
      charge: { hidden: true }, chargeEmpty: { hidden: false }, aggregateToggle: { checked: false }, range: {},
      editModal: {}, chargeAssignModal: {}, viewSwitch: null, chart: {}, chartCanvas: {}, chartFilter: {},
      chartGranularity: {}, chartLegend: {},
    },
    ...chargeBoardModule,
    ...chargePaneStateModule,
    ...boundsModule,
    ...phasesModule,
    ...leaveAbsencesModule,
    ...projectRegistryModule,
    ...viewportBuildModule,
    ...viewportNormalizeModule,
    buildChartTasks,
    getRealisationTargetLookup: () => null,
    currentService: () => env.service,
    fetchProjectData: async ({ name }) => ({
      planningRows: PLANNING_ROWS.filter((row) => row[PC.projectName] === name).map((row) => ({ ...row })),
      timeSegmentRows: [], projectTeamRows: [], teamRows: [], timeOutRows: [], allTimeSegmentRows: [],
    }),
    fetchProjectRow: async (...args) => {
      projectRowCalls.push(sameRealm(args));
      return CATALOG.find((row) => row.id === args[0]) || null;
    },
    fetchTableRows: async () => CATALOG.map((row) => ({ ...row })),
    smoothing: {
      setProjectData: (data) => log.push(["setProjectData", data.contextKey, data.tasks.length, data.projectRow?.id ?? null]),
      getChartInput: () => ({ tasks: [], mode: "raw", active: false }),
      getSmoothedBounds: () => env.smoothedBounds,
      openMonthTasks: (bucket) => log.push(["openMonthTasks", bucket]),
      refreshFromProjectRows: (rows) => log.push(["refreshFromProjectRows", rows.map((row) => row.id)]),
      clear: () => log.push(["clear"]),
    },
    attachChargeEditing: () => ({ detach() {}, isEditModeEnabled: () => false }),
    createChargeAssignModal: () => ({ destroy() {} }),
    updatePlanningDurations: async () => {},
    loadPersistedViewport: () => null,
    persistViewport: () => {},
    captureChargeScroll: () => () => {},
    updateViewSwitchVisibility: () => {},
    applyTopView: () => log.push(["applyTopView"]),
    reconcileAndLoad: () => {},
    createPlanningRenderer: () => ({ render() {}, scrollToTop() {}, destroy() {}, getGroupCount: () => 1, setMaxHeight() {} }),
    createChargeBoard: () => ({ render() {}, destroy() {}, getVisibleSlots: () => [] }),
    // Graphique factice : une fois detruit (teardown), il n'a plus d'etat a
    // rendre — exactement comme le vrai, dont destroy() libere Chart.js.
    createPlanningChart: (_canvas, _filter, _granularity, _legend, options) => {
      chartOptions.push(options);
      let destroyed = false;
      return {
        render() {}, setChartInput() {}, setHeight() {}, setViewport() {},
        destroy() {
          destroyed = true;
        },
        getUiState: () => (destroyed ? null : { ...UI_STATE }),
      };
    },
    createSyncController: (options) => {
      env.controllerBounds.push(sameRealm(options.bounds));
      let viewport = null;
      return {
        bindToolbar() {}, bindWheel() {}, bindPan() {}, destroy() {},
        setBounds: (next) => env.setBounds.push(sameRealm(next)),
        setViewport: (next) => {
          viewport = next;
        },
        getViewport: () => viewport,
      };
    },
    createTopPaneResizer: () => ({ refresh() {}, destroy() {} }),
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      "let planningRenderer = null; let planningChart = null; let chargeBoard = null; let controller = null;",
      "let editing = null; let chargeAssignModal = null; let currentPlanningRows = []; let topPaneResizer = null;",
      "let loadSeq = 0; let topView = 'planning'; let lastTopPaneHeightPx = 0; let chartTasks = [];",
      "let chartContextKey = ''; let desiredTopRows = APP_CONFIG.topPane.defaultRows; let refreshChargeOnly = null;",
      "let projectRegistryFingerprint = ''; let widenBoundsForSmoothing = null;",
      ...LOAD_BLOCKS,
      "globalThis.__api = {",
      "  loadProject,",
      "  projectCatalogHasChanged,",
      "  widenForSmoothing: () => widenBoundsForSmoothing && widenBoundsForSmoothing(),",
      "  setTopView: (view) => { topView = view; },",
      "  getTopView: () => topView,",
      "  getChartTasks: () => chartTasks,",
      "};",
    ].join("\n"),
    context
  );

  return { api: context.__api, log, chartOptions, projectRowCalls, env };
}

// Les objets crees dans le `vm` ont d'autres prototypes : on les recopie dans
// ce contexte avant de les comparer (deepStrictEqual compare les prototypes).
function sameRealm(value) {
  return JSON.parse(JSON.stringify(value));
}

const setProjectDataCalls = (log) => log.filter((entry) => entry[0] === "setProjectData");

// --- tests -----------------------------------------------------------------------

test("premier chargement : vue Planning, aucun etat repasse, setProjectData avant applyTopView", async () => {
  const { api, log, chartOptions } = makeHarness();
  await api.loadProject(PROJECT_A);
  assert.equal(api.getTopView(), "planning");
  assert.equal(chartOptions.at(-1).initialUiState, null);
  assert.deepEqual(setProjectDataCalls(log), [["setProjectData", "1|A|Structure", 1, 1]]);
  const setIndex = log.findIndex((entry) => entry[0] === "setProjectData");
  const applyIndex = log.findIndex((entry) => entry[0] === "applyTopView");
  assert.ok(setIndex >= 0 && setIndex < applyIndex, "setProjectData doit preceder applyTopView");

  // Le clic sur un mois du graphique ouvre la liste du mois du controleur.
  assert.equal(typeof chartOptions.at(-1).onBucketClick, "function");
  chartOptions.at(-1).onBucketClick({ label: "mars 2027" });
  assert.deepEqual(log.at(-1), ["openMonthTasks", { label: "mars 2027" }]);
});

test("meme projet, meme service : vue Graphique gardee, etat du graphique lu avant teardown", async () => {
  const { api, chartOptions } = makeHarness();
  await api.loadProject(PROJECT_A);
  api.setTopView("chart");
  await api.loadProject(PROJECT_A);
  assert.equal(api.getTopView(), "chart", "meme contexte : la vue Graphique est gardee");
  // Lu APRES teardown(), getUiState() du graphique detruit rendrait null.
  assert.deepEqual(chartOptions.at(-1).initialUiState, UI_STATE);
});

test("autre service : retour sur Planning, etat neuf, nouvelle cle de contexte", async () => {
  const { api, log, chartOptions, env } = makeHarness();
  await api.loadProject(PROJECT_A);
  api.setTopView("chart");
  env.service = "Synthese";
  await api.loadProject(PROJECT_A);
  assert.equal(api.getTopView(), "planning");
  assert.equal(chartOptions.at(-1).initialUiState, null);
  assert.equal(setProjectDataCalls(log).at(-1)[1], "1|A|Synthese");
});

test("autre projet : retour sur Planning ; meme projet sans tache : Planning aussi", async () => {
  const { api } = makeHarness();
  await api.loadProject(PROJECT_A);
  api.setTopView("chart");
  await api.loadProject(PROJECT_B);
  assert.equal(api.getTopView(), "planning");
  assert.equal(api.getChartTasks().length, 0);
  // Meme contexte B, mais plus rien a tracer : la vue Graphique n'est pas gardee.
  api.setTopView("chart");
  await api.loadProject(PROJECT_B);
  assert.equal(api.getTopView(), "planning");
});

test("selection videe : smoothing.clear(), puis le projet suivant repart de Planning", async () => {
  const { api, log } = makeHarness();
  await api.loadProject(PROJECT_A);
  await api.loadProject(null);
  assert.deepEqual(log.at(-1), ["clear"]);
  // La cle de contexte a ete remise a vide : A revient comme un nouveau contexte.
  api.setTopView("chart");
  await api.loadProject(PROJECT_A);
  assert.equal(api.getTopView(), "planning");
});

test("signal Projets2 : refreshFromProjectRows recoit les lignes relues", async () => {
  const { api, log } = makeHarness();
  await api.loadProject(PROJECT_A);
  await api.projectCatalogHasChanged();
  assert.deepEqual(log.filter((entry) => entry[0] === "refreshFromProjectRows").at(-1), ["refreshFromProjectRows", [1, 2]]);
});

test("chargement du projet : la ligne Projets2 est relue FRAICHE (caches de la couche partagee contournes)", async () => {
  const { api, projectRowCalls } = makeHarness();
  await api.loadProject(PROJECT_A);
  assert.deepEqual(projectRowCalls, [[1, { fresh: true }]]);
});

// La relecture faite juste avant d'ecrire la cellule Lissage (ruling 10) passe
// par l'option loadProjectRow donnee au controleur a sa creation.
test("controleur du lissage : loadProjectRow relit la ligne Projets2 FRAICHE", async () => {
  const block = `${extractBlock("  const smoothing = createSmoothingController({")});`;
  const captured = [];
  const projectRowCalls = [];
  const sandbox = {
    els: { chartDisplay: {}, smoothingOpen: {}, smoothingModal: {}, monthTasksModal: {} },
    window: {},
    topView: "planning",
    planningChart: null,
    createSmoothingController: (options) => {
      captured.push(options);
      return {};
    },
    updateProjectSmoothing: async () => {},
    fetchProjectRow: async (...args) => {
      projectRowCalls.push(sameRealm(args));
      return { id: args[0], Lissage: "" };
    },
    currentService: () => "Structure",
    todayIsoDate: () => "2027-01-10",
  };
  vm.runInContext(block, vm.createContext(sandbox));
  assert.equal(captured.length, 1);
  assert.equal(typeof captured[0].loadProjectRow, "function");
  assert.deepEqual(await captured[0].loadProjectRow(7), { id: 7, Lissage: "" });
  assert.deepEqual(projectRowCalls, [[7, { fresh: true }]]);
});

// --- bornes de la frise et taches lissees plus tot ------------------------------

// Le planning de A tient en mars 2027 ; un lissage peut avancer des taches en
// 2025 : la frise doit s'ouvrir jusque-la pour qu'on puisse y naviguer.
test("chargement : les mois lisses avant le planning elargissent les bornes de la frise", async () => {
  const { api, env } = makeHarness();
  env.smoothedBounds = { startDate: "2025-06-01", endDate: "2027-03-31" };
  await api.loadProject(PROJECT_A);
  assert.equal(env.controllerBounds.at(-1).startDate, "2025-06-01");
});

test("lissage enregistre apres le chargement : la frise s'elargit, sans jamais retrecir", async () => {
  const { api, env } = makeHarness();
  await api.loadProject(PROJECT_A);
  const loaded = env.controllerBounds.at(-1);
  assert.ok(loaded.startDate > "2026-01-01", loaded.startDate);

  // Les mois lisses vont jusqu'a la fin de mars : la fin s'aligne aussi.
  env.smoothedBounds = { startDate: "2025-06-01", endDate: "2027-03-31" };
  api.widenForSmoothing();
  assert.deepEqual(env.setBounds, [{ startDate: "2025-06-01", endDate: "2027-03-31" }]);

  // Un lissage moins etendu ensuite (ou supprime) : rien ne retrecit sous les
  // yeux de l'utilisateur ; le prochain chargement repart des donnees.
  env.smoothedBounds = null;
  api.widenForSmoothing();
  env.smoothedBounds = { startDate: "2027-01-01", endDate: "2027-03-31" };
  api.widenForSmoothing();
  assert.equal(env.setBounds.length, 1);
});

test("controleur du lissage : onChange elargit la frise avant de redessiner le graphique", () => {
  const block = `${extractBlock("  const smoothing = createSmoothingController({")});`;
  const captured = [];
  const order = [];
  const sandbox = {
    els: { chartDisplay: {}, smoothingOpen: {}, smoothingModal: {}, monthTasksModal: {} },
    window: {},
    topView: "chart",
    planningChart: { setChartInput: () => order.push("setChartInput") },
    widenBoundsForSmoothing: () => order.push("widen"),
    createSmoothingController: (options) => {
      captured.push(options);
      return { getChartInput: () => ({}) };
    },
    updateProjectSmoothing: async () => {},
    fetchProjectRow: async () => null,
    currentService: () => "Structure",
    todayIsoDate: () => "2027-01-10",
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(`${block}\nglobalThis.smoothing = smoothing;`, context);
  captured[0].onChange();
  assert.deepEqual(order, ["widen", "setChartInput"]);
});
