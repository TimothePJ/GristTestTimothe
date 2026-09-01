// Tests du CHEMIN POST-ECRITURE de planning-synchro : ce que le widget fait
// APRES qu'une ligne TimeSegment a bouge — la sienne comme celle d'un voisin.
//
// POURQUOI CE FICHIER EXISTE : la garde precedente (localSegmentUpdate.test.mjs)
// decoupait le TEXTE du gestionnaire `onChanged` et verifiait qu'il ne contenait
// plus la chaine « fetchProjectData ». Le fetch avait simplement demenage dans
// `reloadChargeFromGrist()`, appelee depuis ce meme gestionnaire : la regle
// metier n'etait pas testee, seul le jeton l'etait. Un mutant qui remplacait
// `if (!applied.applied)` par `if (true)` — soit le rechargement complet
// inconditionnel d'avant — passait la suite au vert.
//
// ET SURTOUT : supprimer le fetch de `onChanged` ne suffisait pas. Le
// rechargement qui fait vraiment mal arrive par un AUTRE chemin :
//   applyActions -> grist.docApi.applyUserActions (patche par
//   shared/grist-service-context.js) -> synchronizeAfterMutation ->
//   refreshContextWatchers(["TimeSegment"]) -> livraison « mutation » ->
//   le rappel de watchContextTables -> reconcileAndLoad({ force: true }) ->
//   loadProject() COMPLET : teardown() de la fenetre d'edition, recreation des
//   deux panes, scrollToTop() du pane haut, pane bas re-rendu en lecture seule.
// Le relais se declenche AUSSI sur nos propres ecritures (grist-service-context
// le dit en toutes lettres : « que le changement vienne de LUI, d'un autre widget
// de la page, ou d'un autre utilisateur »). D'ou le « quand j'ajoute un segment,
// il me reactualise la page » signale par l'utilisateur.
//
// COMMENT ON TESTE : `main.js` n'est pas importable sous Node (il s'amorce au
// chargement du document et tire toute l'application). On extrait donc le TEXTE
// REEL de `loadProject`, `teardown`, `handleContextTablesChanged` et de leurs
// aides, et on l'execute dans un `vm` sur un environnement bouchonne. Les
// dependances PURES restent les vraies (applySegmentChangeLocally,
// buildWorkersFromSegments, computeTimeSegmentBounds, viewports...) : aucune
// reimplementation. On observe ensuite le COMPORTEMENT — qui a ete appele, avec
// quoi — et jamais la presence d'une chaine de caracteres.
//
// TROIS PROPRIETES NON NEGOCIABLES, une par famille de tests plus bas :
//   1. apres SA PROPRE ecriture : ni clignotement, ni retour en haut du pane
//      haut, ni perte du mode Editer ;
//   2. un changement REELLEMENT externe rafraichit toujours le widget ;
//   3. la garde `seq !== loadSeq` (changement de projet en cours d'ecriture)
//      reste intacte.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { APP_CONFIG } from "../assets/js/config.js";
import { applySegmentChangeLocally, timeSegmentRowsSignature } from "../assets/js/bottom/localSegmentUpdate.js";
import { buildWorkersFromSegments } from "../assets/js/bottom/chargeBoard.js";
import { computeTimeSegmentBounds } from "../assets/js/top/bounds.js";
import { getFirstPhaseDate, buildRowPhases, computePlanningPhaseBounds, buildPlanningTaskRanges } from "../assets/js/top/phases.js";
import { buildAbsenceIndex, normalizeName } from "../assets/js/utils/leaveAbsences.js";
import { buildRegistry } from "../assets/js/services/projectRegistry.js";
import { buildInitialProjectViewport, buildCanonicalSharedViewport } from "../assets/js/viewport/build.js";
import { normalizeIsoDate } from "../assets/js/viewport/normalize.js";
import { formatIsoDate } from "../assets/js/utils/dates.js";
import { toGristMonthValue } from "../assets/js/utils/monthSegments.js";

const MAIN_PATH = new URL("../assets/js/main.js", import.meta.url);
const source = fs.readFileSync(MAIN_PATH, "utf8");

const SEGMENT_COLUMNS = APP_CONFIG.grist.columns.timeSegment;
const PLANNING_COLUMNS = APP_CONFIG.grist.columns.planningProject;
const TIME_SEGMENT_TABLE = APP_CONFIG.grist.tables.timeSegment;
const PLANNING_TABLE = APP_CONFIG.grist.tables.planningProject;
const PROJECTS_TABLE = APP_CONFIG.grist.tables.projects;
const PROJECT_COLUMNS = APP_CONFIG.grist.columns.projects;
const PROJECT = { id: 7, name: "Projet A", number: "25-0142" };
const PROJECT_B = { id: 8, name: "Projet B", number: "24-0007" };

// Catalogue Projets2 de depart. La colonne de SIGNAL que le relais inter-widgets
// ecrit a chaque mutation (cf. shared/project-mutation-sync-relay.js) est posee
// ici sous son vrai nom de famille : elle change a chaque ecriture SANS que le
// catalogue ait bouge — c'est exactement ce que l'empreinte doit ignorer.
function projectCatalogRows() {
  return [
    {
      id: 7,
      [PROJECT_COLUMNS.name]: "Projet A",
      [PROJECT_COLUMNS.number]: "25-0142",
      TimeSegment_Sync: "sig-1",
    },
    {
      id: 8,
      [PROJECT_COLUMNS.name]: "Projet B",
      [PROJECT_COLUMNS.number]: "24-0007",
      TimeSegment_Sync: "sig-1",
    },
  ];
}

// --- extraction du texte reel de main.js -------------------------------------

// Extrait un bloc a partir de son en-tete (qui doit se terminer par « { ») en
// equilibrant les accolades. ECHOUE BRUYAMMENT si l'en-tete a disparu : une
// extraction muette produirait « aucun test ne tombe », indiscernable d'une vraie
// garde.
function extractBlock(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `bloc introuvable dans main.js : ${header}`);
  assert.equal(
    source.indexOf(header, start + 1),
    -1,
    `en-tete ambigue dans main.js (plusieurs occurrences) : ${header}`
  );

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
  throw new Error(`accolades non equilibrees dans main.js : ${header}`);
}

const BLOCK_HEADERS = [
  "function todayIsoDate() {",
  "function unionDateBounds(a, b) {",
  "function computePlanningDerivedBounds(planningRows, columns, fallbackViewport) {",
  "function buildDefaultMonthViewport(anchorIsoDate) {",
  "function viewportFitsWithinBounds(viewport, bounds) {",
  "function readAllTimeSegmentRows(payload) {",
  "function projectRegistrySignature(projects) {",
  "function planningRowsSignature(rows, columns, durationsOnly) {",
  "function classifyContextSignal(tables, timeSegmentTableName, projectsTableName, planningProjectTableName) {",
  "  function teardown() {",
  "  async function loadProject(project) {",
  "  async function projectCatalogHasChanged() {",
  "  async function refreshChargeUnlessCatalogChanged() {",
  "  function handleContextTablesChanged(signal) {",
];

const BLOCKS = BLOCK_HEADERS.map(extractBlock);

test("extraction : main.js expose bien les blocs du chemin post-ecriture", () => {
  assert.equal(BLOCKS.length, BLOCK_HEADERS.length);
  BLOCKS.forEach((body, index) => {
    assert.ok(body.length > 30, `bloc vide : ${BLOCK_HEADERS[index]}`);
    assert.ok(body.endsWith("}"), `bloc tronque : ${BLOCK_HEADERS[index]}`);
  });
});

// --- lignes de fixture --------------------------------------------------------

function segmentRow({
  id,
  name,
  monthKey,
  effectif,
  projectNumber = PROJECT.number,
  allocationDays = 20,
  label = "",
}) {
  return {
    id,
    [SEGMENT_COLUMNS.projectNumber]: projectNumber,
    [SEGMENT_COLUMNS.name]: name,
    [SEGMENT_COLUMNS.mois]: toGristMonthValue(monthKey),
    [SEGMENT_COLUMNS.allocationDays]: allocationDays,
    [SEGMENT_COLUMNS.effectif]: effectif,
    [SEGMENT_COLUMNS.label]: label,
  };
}

function initialRemoteRows() {
  return [
    segmentRow({ id: 41, name: "Alice", monthKey: "2026-09", effectif: 5, allocationDays: 22 }),
    segmentRow({ id: 42, name: "Bob", monthKey: "2026-10", effectif: 3, allocationDays: 22 }),
    segmentRow({ id: 90, name: "Alice", monthKey: "2026-09", effectif: 4, projectNumber: "24-0007", allocationDays: 22 }),
  ];
}

// Lignes Planning_Projet du projet affiche. Depuis la Tache 5, le widget ECRIT
// dans cette table (Duree_Projet / Duree_Zone / Duree_Force, jusqu'a ~112 lignes
// en un lot), et le relais inter-widgets le reveille sur son PROPRE lot : elle
// suit donc exactement le meme chemin post-ecriture que TimeSegment.
function planningRow({ id, id2, typeDoc = "COFFRAGE", zone = "Zone 1", taskName = "" }) {
  return {
    id,
    [PLANNING_COLUMNS.projectName]: PROJECT.name,
    [PLANNING_COLUMNS.id2]: id2,
    [PLANNING_COLUMNS.taskName]: taskName || `Tache ${id2}`,
    [PLANNING_COLUMNS.typeDoc]: typeDoc,
    [PLANNING_COLUMNS.zone]: zone,
    [PLANNING_COLUMNS.dureeProjet]: "",
    [PLANNING_COLUMNS.dureeZone]: "",
    [PLANNING_COLUMNS.dureeForce]: "",
  };
}

function initialPlanningRows() {
  return [
    planningRow({ id: 501, id2: "3001" }),
    planningRow({ id: 502, id2: "3002" }),
  ];
}

// --- montage du vrai loadProject sur un environnement bouchonne ---------------

async function mount({ segmentRows, planningRows = [] } = {}) {
  const calls = {
    fetchProjectData: 0,
    reconcileAndLoad: 0,
    teardown: 0,
    fetchProjectCatalog: 0,
    createPlanningRenderer: 0,
    createChargeBoard: 0,
    planningRender: 0,
    scrollToTop: 0,
    chargeRender: 0,
    setBounds: 0,
    detach: 0,
    destroyChargeBoard: 0,
  };
  const chargeRenders = [];
  const setBoundsCalls = [];
  const pendingFetches = [];

  // La base : mutable, pour simuler l'ecriture d'un autre widget/utilisateur.
  let remoteRows = segmentRows === undefined ? initialRemoteRows() : segmentRows;
  // Les lignes Planning_Projet, mutables pour les memes raisons (notre propre
  // ecriture de charge, ou celle d'un voisin).
  let remotePlanningRows = planningRows;
  // Le catalogue Projets2, lui aussi mutable : le relais y ecrit une colonne de
  // signal a CHAQUE mutation, et un vrai widget de creation de projet peut y
  // ajouter une ligne. Les deux se ressemblent par le nom de table, jamais par
  // le contenu.
  let remoteProjectRows = projectCatalogRows();

  // Le vrai `fetchTableRows` du service : seul le catalogue projets est relu par
  // ce chemin dans les blocs extraits.
  let projectCatalogBroken = false;
  const fetchTableRows = async (tableName) => {
    assert.equal(tableName, PROJECTS_TABLE, `relecture inattendue de ${tableName}`);
    calls.fetchProjectCatalog += 1;
    if (projectCatalogBroken) throw new Error("Projets2 illisible");
    return remoteProjectRows.map((row) => ({ ...row }));
  };

  // Relectures a RESOLUTION CONTROLEE. Sans cela, impossible d'exercer deux
  // relectures CONCURRENTES resolues dans le desordre — or le debounce du relais
  // est de 100 ms alors que fetchProjectData enchaine 5+ requetes REST : deux
  // signaux espaces de plus de 100 ms se chevauchent tres ordinairement, et rien
  // ne garantit que la premiere partie soit la premiere revenue.
  let deferFetches = false;
  const heldFetches = [];

  const fetchProjectData = ({ name, number }) => {
    calls.fetchProjectData += 1;
    // Instantane pris a l'APPEL : une reponse rendue plus tard porte donc l'etat
    // de la base au moment ou la requete est partie, comme un vrai aller-retour.
    const all = remoteRows.map((row) => ({ ...row }));
    const payload = {
      planningRows: remotePlanningRows.map((row) => ({ ...row })),
      timeSegmentRows: all.filter((row) => String(row[SEGMENT_COLUMNS.projectNumber]) === String(number)),
      projectTeamRows: [],
      teamRows: [],
      timeOutRows: [],
      allTimeSegmentRows: all,
      _requested: { name, number },
    };

    if (!deferFetches) {
      const promise = Promise.resolve(payload);
      pendingFetches.push(promise);
      return promise;
    }

    // Volontairement HORS de pendingFetches : flush() les attend toutes, une
    // reponse retenue y bloquerait la suite du test.
    let settle;
    const promise = new Promise((resolve) => {
      settle = () => resolve(payload);
    });
    heldFetches.push(settle);
    return promise;
  };

  // Mode Editer : une seule source de verite, comme le vrai chargeEditing.
  let editModeEnabled = false;
  let editingOptions = null;

  const attachChargeEditing = (_boardEl, options) => {
    editingOptions = options;
    return {
      detach: () => {
        calls.detach += 1;
      },
      isEditModeEnabled: () => editModeEnabled,
    };
  };

  // Fenetre d'assignation de charge (Tache 4) : bouchon monte/demonte au meme
  // rythme qu'attachChargeEditing ci-dessus, mais qui RETIENT ses options —
  // c'est par `onSubmit` que le VRAI `handleChargeAssignSubmit` de main.js
  // (ecriture Grist, puis mise a jour EN PLACE de planningRows, puis re-rendu
  // local) devient executable depuis ce fichier.
  //
  // Ce bouchon-la remplace un `handleChargeAssignSubmit: () => {}` pose dans le
  // bac a sable : il etait MORT. `loadProject` est extrait puis execute, et il
  // declare `handleChargeAssignSubmit` dans son propre corps — la vraie
  // fonction masquait donc le bouchon, qui laissait croire a une couverture
  // inexistante.
  let chargeAssignOptions = null;
  const createChargeAssignModal = (_rootEl, options) => {
    chargeAssignOptions = options;
    return {
      open: () => {},
      close: () => {},
      isOpen: () => false,
      destroy: () => {},
    };
  };

  // L'ecriture Grist elle-meme (services/gristService.js) : bouchonnee, mais
  // elle applique bien le lot a la « base » pour que la relecture declenchee
  // par le relais retrouve ce que Grist a reellement enregistre.
  const planningWrites = [];
  const updatePlanningDurations = async (writes) => {
    planningWrites.push(writes);
    const fieldsById = new Map();
    (Array.isArray(writes) ? writes : []).forEach((write) => {
      const previous = fieldsById.get(write?.recordId) || {};
      fieldsById.set(write?.recordId, { ...previous, ...(write?.fields || {}) });
    });
    remotePlanningRows = remotePlanningRows.map((row) => (
      fieldsById.has(row.id) ? { ...row, ...fieldsById.get(row.id) } : row
    ));
  };

  const els = {
    select: {},
    toolbar: {},
    empty: { hidden: false },
    main: { hidden: true },
    planning: {},
    splitter: {},
    charge: { hidden: true },
    chargeEmpty: { hidden: false },
    aggregateToggle: { checked: false },
    range: { textContent: "" },
    editModal: {},
    chargeAssignModal: {},
    viewSwitch: null,
    chart: {},
    chartCanvas: {},
    chartFilter: {},
    chartGranularity: {},
    chartLegend: {},
  };

  let currentViewport = null;

  const sandbox = {
    console,
    // --- etat et elements bouchonnes -----------------------------------------
    state: { registry: [], selectedProject: null, viewport: null },
    els,
    APP_CONFIG,
    realisationTargetLookup: null,

    // --- dependances reelles (pures) -----------------------------------------
    buildRegistry,
    applySegmentChangeLocally,
    timeSegmentRowsSignature,
    buildWorkersFromSegments,
    computeTimeSegmentBounds,
    getFirstPhaseDate,
    buildRowPhases,
    computePlanningPhaseBounds,
    buildPlanningTaskRanges,
    buildAbsenceIndex,
    normalizeName,
    buildInitialProjectViewport,
    buildCanonicalSharedViewport,
    normalizeIsoDate,
    formatIsoDate,

    // --- bouchons ------------------------------------------------------------
    fetchProjectData,
    fetchTableRows,
    attachChargeEditing,
    createChargeAssignModal,
    updatePlanningDurations,
    loadPersistedViewport: () => null,
    persistViewport: () => {},
    captureChargeScroll: () => () => {},
    updateViewSwitchVisibility: () => {},
    applyTopView: () => {},
    reconcileAndLoad: () => {
      calls.reconcileAndLoad += 1;
    },
    createPlanningRenderer: () => {
      calls.createPlanningRenderer += 1;
      return {
        render: () => {
          calls.planningRender += 1;
        },
        scrollToTop: () => {
          calls.scrollToTop += 1;
        },
        destroy: () => {},
        getGroupCount: () => 3,
        setMaxHeight: () => {},
        setAggregate: () => {},
      };
    },
    createChargeBoard: () => {
      calls.createChargeBoard += 1;
      return {
        render: (payload) => {
          calls.chargeRender += 1;
          chargeRenders.push(payload);
        },
        destroy: () => {
          calls.destroyChargeBoard += 1;
        },
        getVisibleSlots: () => [],
      };
    },
    createPlanningChart: () => ({
      render: () => {},
      destroy: () => {},
      setHeight: () => {},
      setViewport: () => {},
    }),
    createSyncController: ({ bounds }) => {
      let activeBounds = bounds;
      return {
        bindToolbar: () => {},
        bindWheel: () => {},
        bindPan: () => {},
        setViewport: (viewport) => {
          currentViewport = viewport;
        },
        getViewport: () => currentViewport,
        setBounds: (next) => {
          calls.setBounds += 1;
          activeBounds = next;
          setBoundsCalls.push(next);
        },
        getBounds: () => activeBounds,
        destroy: () => {},
      };
    },
    createTopPaneResizer: () => ({
      refresh: () => {},
      destroy: () => {},
    }),
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      "let planningRenderer = null;",
      "let planningChart = null;",
      "let chargeBoard = null;",
      "let controller = null;",
      "let editing = null;",
      "let chargeAssignModal = null;",
      "let currentPlanningRows = [];",
      "let topPaneResizer = null;",
      "let loadSeq = 0;",
      "let topView = 'planning';",
      "let lastTopPaneHeightPx = 0;",
      "let chartRows = [];",
      "let chartColumns = null;",
      "let desiredTopRows = APP_CONFIG.topPane.defaultRows;",
      "let refreshChargeOnly = null;",
      "let projectRegistryFingerprint = '';",
      "const DEFAULT_MONTH_VISIBLE_DAYS = 31;",
      ...BLOCKS,
      `globalThis.__api = {
         loadProject,
         handleContextTablesChanged,
         classifyContextSignal,
         projectRegistrySignature,
         bumpLoadSeq: () => { loadSeq += 1; },
         hasRefreshChargeOnly: () => typeof refreshChargeOnly === 'function',
         seedProjectCatalog: (rows) => {
           projectRegistryFingerprint = projectRegistrySignature(
             buildRegistry(rows, APP_CONFIG.grist.columns.projects)
           );
         },
       };`,
    ].join("\n\n"),
    context,
    { filename: "main.js (extrait)" }
  );

  // Laisse les micro-taches ET les continuations post-await s'ecouler.
  const flush = async () => {
    for (let round = 0; round < 4; round += 1) {
      await Promise.all(pendingFetches.slice());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  // Ce que bootstrap() fait apres avoir peuple le selecteur : l'empreinte de
  // depart du catalogue projets.
  context.__api.seedProjectCatalog(remoteProjectRows);

  await context.__api.loadProject(PROJECT);
  await flush();

  return {
    api: context.__api,
    els,
    setRemoteProjectRows: (rows) => {
      remoteProjectRows = rows;
    },
    getRemoteProjectRows: () => remoteProjectRows,
    setRemotePlanningRows: (rows) => {
      remotePlanningRows = rows;
    },
    getRemotePlanningRows: () => remotePlanningRows,
    planningWrites,
    // Options passees a createChargeAssignModal par le VRAI loadProject :
    // `onSubmit` EST handleChargeAssignSubmit.
    getChargeAssignOptions: () => chargeAssignOptions,
    breakProjectCatalog: () => {
      projectCatalogBroken = true;
    },
    calls,
    chargeRenders,
    setBoundsCalls,
    flush,
    setEditMode: (value) => {
      editModeEnabled = value;
    },
    getEditingOptions: () => editingOptions,
    // Retient les reponses des relectures suivantes pour les rendre dans l'ordre
    // choisi par le test (cf. fetchProjectData ci-dessus).
    deferFetches: (value = true) => {
      deferFetches = value;
    },
    heldFetchCount: () => heldFetches.filter(Boolean).length,
    // Rend la reponse de la n-ieme relecture retenue (0 = la premiere partie).
    resolveFetch: async (index) => {
      const settle = heldFetches[index];
      assert.ok(settle, `aucune relecture retenue a l'indice ${index}`);
      heldFetches[index] = null;
      settle();
      await flush();
    },
    setRemoteRows: (rows) => {
      remoteRows = rows;
    },
    getRemoteRows: () => remoteRows,
    reset: () => {
      Object.keys(calls).forEach((key) => {
        calls[key] = 0;
      });
      chargeRenders.length = 0;
      setBoundsCalls.length = 0;
    },
    lastChargeRender: () => chargeRenders[chargeRenders.length - 1] || null,
  };
}

function workerNames(render) {
  return (render?.workers || []).map((worker) => worker.name);
}

// Libelles des barres effectivement passes au pane bas : c'est le texte que
// chargeBoard.js ecrit dans chaque barre (`segment?.label || "X j"`).
function segmentLabels(render) {
  return (render?.workers || []).flatMap((worker) =>
    (worker.segments || []).map((segment) => segment.label)
  );
}

// Ligne telle que Grist la rendra apres la creation faite par le widget : memes
// colonnes que la ligne synthetique posee par applySegmentChangeLocally.
const CREATED_REMOTE_ROW = segmentRow({
  id: 77,
  name: "Chloe",
  monthKey: "2026-11",
  effectif: 6,
  allocationDays: 20,
});

// --- 0. le montage represente bien l'etat de depart ---------------------------

test("montage : le projet est charge, le pane bas rendu, le pane haut remonte une fois", async () => {
  const h = await mount();

  assert.equal(h.calls.createChargeBoard, 1);
  assert.equal(h.calls.scrollToTop, 1, "un VRAI chargement de projet remonte bien le pane haut");
  assert.deepEqual(workerNames(h.lastChargeRender()).sort(), ["Alice", "Bob"]);
  assert.equal(h.api.hasRefreshChargeOnly(), true, "loadProject publie son rafraichissement en place");
});

// --- 1. apres SA PROPRE ecriture : rien ne bouge -------------------------------

test("l'ecriture est appliquee EN LOCAL : aucun rechargement du projet", async () => {
  const h = await mount();
  h.setEditMode(true);
  h.reset();

  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });
  await h.flush();

  // LE test que l'ancienne garde textuelle ne faisait pas : le fetch a demenage
  // dans reloadChargeFromGrist(), donc c'est l'APPEL qu'il faut compter.
  assert.equal(h.calls.fetchProjectData, 0, "le chemin nominal ne relit pas Grist");
  assert.equal(h.calls.chargeRender, 1, "le pane bas est redessine depuis la memoire");
  assert.ok(workerNames(h.lastChargeRender()).includes("Chloe"), "la personne creee apparait aussitot");
  assert.equal(h.lastChargeRender().editMode, true, "le mode Editer survit au re-rendu local");
  assert.equal(h.calls.scrollToTop, 0, "le pane haut n'est pas touche");
  assert.equal(h.calls.teardown, 0);
});

test("un mois cree hors des bornes elargit la frise partagee", async () => {
  const h = await mount();
  h.setEditMode(true);
  h.reset();

  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 78,
    monthKey: "2027-03",
    workerName: "Chloe",
    effectif: 6,
  });
  await h.flush();

  assert.equal(h.calls.setBounds, 1, "sans cela le controleur ecreterait la fenetre avant la barre creee");
  assert.equal(h.setBoundsCalls[0].endDate, "2027-03-31");
});

test("le VRAI controleur n'atteint le mois cree qu'apres setBounds", async () => {
  // La contrepartie du test precedent, sur le vrai createSyncController : sans
  // l'elargissement, la fenetre est ecretee juste avant la barre qui vient
  // d'apparaitre — l'utilisateur ne la verrait jamais.
  globalThis.HTMLElement = globalThis.HTMLElement || class {};
  globalThis.document = globalThis.document || {
    querySelector: () => null,
    body: { classList: { add: () => {}, remove: () => {} } },
  };
  const { createSyncController } = await import("../assets/js/sync/controller.js");

  const build = () =>
    createSyncController({
      planningRenderer: { setWindow: () => {}, getWindow: () => null },
      chargeBoard: { setWindow: () => {}, render: () => {}, getVisibleSlots: () => [] },
      bounds: { startDate: "2026-09-01", endDate: "2026-10-31" },
      onRangeLabel: () => {},
    });

  const target = buildCanonicalSharedViewport({
    firstVisibleDate: "2027-03-01",
    rangeStartDate: "2027-03-01",
    anchorDate: "2027-03-01",
    visibleDays: 31,
  });

  const clamped = build();
  clamped.setViewport(target);
  assert.equal(clamped.getViewport().firstVisibleDate, "2026-10-01", "bornes d'origine : la fenetre est ecretee");

  const widened = build();
  widened.setBounds({ startDate: "2026-09-01", endDate: "2027-03-31" });
  widened.setViewport(target);
  assert.equal(widened.getViewport().firstVisibleDate, "2027-03-01", "bornes elargies : le mois cree est atteignable");
});

test("un changement inapplicable localement retombe sur le rechargement complet", async () => {
  const h = await mount();
  h.setEditMode(true);
  h.reset();

  // Creation dont Grist n'a pas rendu l'id : la barre creee ne serait pas
  // editable, mieux vaut relire.
  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: null,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });
  await h.flush();

  assert.equal(h.calls.fetchProjectData, 1, "le repli relit bien le projet");
});

test("le signal du relais declenche par NOTRE ecriture ne reactualise pas la page", async () => {
  const h = await mount();
  h.setEditMode(true);

  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });
  await h.flush();

  // Grist a bien enregistre la ligne : le relais reveille la surveillance
  // TimeSegment, exactement comme apres n'importe quelle ecriture locale.
  h.setRemoteRows([...h.getRemoteRows(), { ...CREATED_REMOTE_ROW }]);
  h.reset();

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 0, "PAS de loadProject() complet : c'est lui qui reactualisait la page");
  assert.equal(h.calls.teardown, 0, "la fenetre d'edition n'est pas demontee");
  assert.equal(h.calls.createPlanningRenderer, 0, "le pane haut n'est pas reconstruit (clignotement)");
  assert.equal(h.calls.scrollToTop, 0, "le pane haut ne remonte pas en tete de liste");
  assert.equal(h.calls.chargeRender, 0, "rien de neuf a afficher : pas de re-rendu, donc pas de clignotement");
  assert.equal(h.calls.detach, 0, "le mode Editer n'est pas perdu");
});

// --- 1 bis. la barre de charge mensuelle de la fenetre voit les memes lignes ---
//
// `attachChargeEditing` recoit un ACCESSEUR de lignes TimeSegment tous projets
// confondus : c'est lui qui alimente la barre de charge de la fenetre segment
// (cf. utils/monthLoad.js, qui raisonne sur la PERSONNE). Les trois chemins qui
// l'alimentent sont executes ici.

test("la fenetre voit les lignes de TOUS les projets des le chargement", async () => {
  const h = await mount();
  const rows = h.getEditingOptions().getAllTimeSegmentRows();

  assert.equal(rows.length, 3, "y compris la ligne du projet 24-0007");
  assert.ok(
    rows.some((row) => String(row[SEGMENT_COLUMNS.projectNumber]) === "24-0007"),
    "la barre raisonne sur la personne, pas sur le projet affiche"
  );
});

test("la fenetre voit l'ecriture locale sans attendre un rechargement", async () => {
  const h = await mount();
  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });
  await h.flush();

  assert.ok(
    h.getEditingOptions().getAllTimeSegmentRows().some((row) => Number(row.id) === 77),
    "sinon la barre resterait sur l'instantane d'avant l'ecriture"
  );
});

test("la fenetre voit la charge saisie AILLEURS apres un rafraichissement", async () => {
  const h = await mount();
  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 91, name: "Alice", monthKey: "2026-11", effectif: 7, projectNumber: "24-0007" }),
  ]);

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  const rows = h.getEditingOptions().getAllTimeSegmentRows();
  assert.ok(
    rows.some((row) => Number(row.id) === 91),
    "une charge posee sur un autre projet doit apparaitre dans la barre"
  );
});

// --- 2. un changement REELLEMENT externe rafraichit toujours -------------------

test("l'ecriture d'un AUTRE utilisateur sur TimeSegment redessine bien le pane bas", async () => {
  const h = await mount();
  h.setEditMode(true);
  h.reset();

  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 55, name: "Dora", monthKey: "2026-10", effectif: 4, allocationDays: 22 }),
  ]);

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  assert.equal(h.calls.fetchProjectData, 1, "les donnees sont bien relues depuis Grist");
  assert.equal(h.calls.chargeRender, 1, "le pane bas montre le changement distant");
  assert.ok(workerNames(h.lastChargeRender()).includes("Dora"), "la personne ajoutee par le voisin apparait");
  assert.equal(h.lastChargeRender().editMode, true, "sans perdre le mode Editer au passage");
  assert.equal(h.calls.scrollToTop, 0);
  assert.equal(h.calls.reconcileAndLoad, 0);
});

test("une suppression distante disparait aussi du pane bas", async () => {
  const h = await mount();
  h.reset();

  h.setRemoteRows(h.getRemoteRows().filter((row) => row.id !== 42));

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  assert.equal(h.calls.chargeRender, 1);
  assert.deepEqual(workerNames(h.lastChargeRender()), ["Alice"]);
});

test("un renommage distant du LIBELLE d'une barre se voit tout de suite", async () => {
  // SEULE la colonne Label bouge. Elle EST affichee : chargeBoard.js la lit
  // (buildWorkersFromSegments) et s'en sert comme texte de la barre
  // (`segment?.label || "X j"`). L'exclure de l'empreinte avalait ce changement
  // — le libelle restait perime jusqu'au prochain changement d'une AUTRE colonne.
  const h = await mount();
  h.setEditMode(true);
  h.reset();

  h.setRemoteRows(
    h.getRemoteRows().map((row) =>
      row.id === 41 ? { ...row, [SEGMENT_COLUMNS.label]: "Chantier Nord" } : row
    )
  );

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  assert.equal(h.calls.fetchProjectData, 1, "les donnees sont bien relues depuis Grist");
  assert.equal(h.calls.chargeRender, 1, "le pane bas est redessine : le texte de la barre change");
  assert.ok(
    segmentLabels(h.lastChargeRender()).includes("Chantier Nord"),
    "le nouveau libelle doit atteindre la barre"
  );
  assert.equal(h.lastChargeRender().editMode, true, "sans perdre le mode Editer au passage");
});

test("un changement sur une AUTRE table recharge tout le projet", async () => {
  const h = await mount();
  h.reset();

  // ProjectTeam : surveillee, mais rien du chemin leger ne sait l'appliquer
  // (elle change la composition des lignes de personnes).
  h.api.handleContextTablesChanged({ tables: [APP_CONFIG.grist.tables.projectTeam] });
  assert.equal(h.calls.reconcileAndLoad, 1, "le pane haut ne se met a jour que par loadProject()");

  h.reset();
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE, APP_CONFIG.grist.tables.projectTeam] });
  assert.equal(h.calls.reconcileAndLoad, 1, "des qu'une autre table bouge, on recharge tout");
  assert.equal(h.calls.fetchProjectCatalog, 0, "et sans relire le catalogue pour rien");

  // Le chemin leger ne s'elargit PAS parce que Planning_Projet l'a rejoint :
  // melangee a une table inconnue de ce chemin, elle retombe sur "full".
  h.reset();
  h.api.handleContextTablesChanged({ tables: [PLANNING_TABLE, APP_CONFIG.grist.tables.projectTeam] });
  assert.equal(h.calls.reconcileAndLoad, 1, "Planning_Projet ne blanchit pas les tables qui l'accompagnent");
});

test("un signal sans table connue recharge tout : dans le doute, jamais moins", async () => {
  const h = await mount();

  h.reset();
  h.api.handleContextTablesChanged({ tables: [] });
  assert.equal(h.calls.reconcileAndLoad, 1);

  h.reset();
  h.api.handleContextTablesChanged({});
  assert.equal(h.calls.reconcileAndLoad, 1);

  h.reset();
  h.api.handleContextTablesChanged();
  assert.equal(h.calls.reconcileAndLoad, 1);
});

test("classifyContextSignal : TimeSegment seul est direct, Projets2 demande une verification", async () => {
  const h = await mount();
  const classify = (tables) => h.api.classifyContextSignal(
    tables,
    TIME_SEGMENT_TABLE,
    PROJECTS_TABLE,
    PLANNING_TABLE
  );

  assert.equal(classify([TIME_SEGMENT_TABLE]), "charge");
  assert.equal(classify([TIME_SEGMENT_TABLE, TIME_SEGMENT_TABLE]), "charge");
  // Le lot que le relais fabrique pour NOS PROPRES ecritures.
  assert.equal(classify([TIME_SEGMENT_TABLE, PROJECTS_TABLE]), "charge-si-catalogue-inchange");
  assert.equal(classify([PROJECTS_TABLE]), "charge-si-catalogue-inchange");
  // Planning_Projet : la table qu'ecrit la fenetre « Assigner la charge de
  // reference ». Meme chemin que TimeSegment — le rafraichissement en place
  // sait traiter les deux et decide lui-meme, apres relecture, s'il faut
  // finalement recharger tout le projet.
  assert.equal(classify([PLANNING_TABLE]), "charge");
  assert.equal(classify([PLANNING_TABLE, TIME_SEGMENT_TABLE]), "charge");
  // Le lot que le relais fabrique pour NOTRE ecriture de charge.
  assert.equal(classify([PLANNING_TABLE, PROJECTS_TABLE]), "charge-si-catalogue-inchange");
  // Toute autre table : rechargement complet, comme avant.
  assert.equal(classify([TIME_SEGMENT_TABLE, APP_CONFIG.grist.tables.projectTeam]), "full");
  assert.equal(classify([PLANNING_TABLE, APP_CONFIG.grist.tables.projectTeam]), "full");
  assert.equal(classify([APP_CONFIG.grist.tables.projectTeam]), "full");
  assert.equal(classify([APP_CONFIG.grist.tables.team]), "full");
  // Dans le doute, jamais moins qu'un rechargement complet.
  assert.equal(classify([]), "full");
  assert.equal(classify(null), "full");
  assert.equal(classify(undefined), "full");
});

// --- 2 quater. Planning_Projet : la charge de reference suit le meme chemin ----
//
// La fenetre « Assigner la charge de reference » ecrit les trois colonnes de
// duree de Planning_Projet — jusqu'a ~112 lignes en un lot. Le relais reveille
// alors ce widget sur son PROPRE lot. Tant que Planning_Projet n'etait pas
// routee, le signal tombait sur "full" -> reconcileAndLoad({ force: true }) ->
// loadProject() complet : le rechargement VISIBLE que ce widget a explicitement
// retire revenait sur l'ecriture la plus lourde du produit, et ecrasait au
// passage la mise a jour EN PLACE que handleChargeAssignSubmit venait de poser.

test("Planning_Projet — le signal declenche par NOTRE ecriture de charge ne reactualise pas la page", async () => {
  const h = await mount({ planningRows: initialPlanningRows() });
  h.setEditMode(true);
  h.reset(); // on ne compte plus le chargement initial

  // Le VRAI handleChargeAssignSubmit de main.js : ecriture Grist, mise a jour
  // EN PLACE des objets-ligne, re-rendu local du pane bas.
  const result = await h.getChargeAssignOptions().onSubmit([
    { recordId: 501, fields: { [PLANNING_COLUMNS.dureeProjet]: 5 } },
    { recordId: 502, fields: { [PLANNING_COLUMNS.dureeProjet]: 5 } },
  ]);
  await h.flush();

  // `result` nait dans le vm : sa comparaison stricte de prototype echouerait.
  assert.equal(result.ok, true, "l'enregistrement est rendu comme reussi a la fenetre");
  assert.equal(h.planningWrites.length, 1, "un seul lot d'ecriture est parti");
  assert.equal(h.calls.fetchProjectData, 0, "l'ecriture ne relit rien : la mise a jour est locale");
  assert.equal(
    h.lastChargeRender().planningRows.find((row) => row.id === 501)[PLANNING_COLUMNS.dureeProjet],
    5,
    "la nouvelle duree est a l'ecran des l'enregistrement"
  );

  // Grist a enregistre le lot ; le relais nous reveille avec Planning_Projet
  // ET Projets2 (colonne de signal), comme pour n'importe quelle ecriture.
  h.setRemoteProjectRows(
    h.getRemoteProjectRows().map((row) => ({ ...row, PlanningProjet_Sync: "sig-2" }))
  );
  h.reset();

  h.api.handleContextTablesChanged({ tables: [PLANNING_TABLE, PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 0, "PAS de loadProject() complet : c'est lui qui reactualisait la page");
  assert.equal(h.calls.createPlanningRenderer, 0, "le pane haut n'est pas reconstruit (clignotement)");
  assert.equal(h.calls.scrollToTop, 0, "le pane haut ne remonte pas en tete de liste");
  assert.equal(h.calls.detach, 0, "le mode Editer n'est pas perdu");
  assert.equal(h.calls.chargeRender, 0, "rien de neuf : la mise a jour locale est deja a l'ecran");
});

test("Planning_Projet — une duree saisie AILLEURS rafraichit la ligne Charge sans rechargement", async () => {
  const h = await mount({ planningRows: initialPlanningRows() });
  h.setEditMode(true);
  const boardRows = h.lastChargeRender().planningRows;
  h.reset();

  h.setRemotePlanningRows(h.getRemotePlanningRows().map((row) => (
    row.id === 502 ? { ...row, [PLANNING_COLUMNS.dureeForce]: 3 } : row
  )));

  h.api.handleContextTablesChanged({ tables: [PLANNING_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 0, "une duree qui change ne concerne que la ligne Charge");
  assert.equal(h.calls.scrollToTop, 0);
  assert.equal(h.calls.chargeRender, 1, "le pane bas est redessine");
  assert.equal(h.lastChargeRender().editMode, true, "sans perdre le mode Editer au passage");
  assert.equal(
    h.lastChargeRender().planningRows.find((row) => row.id === 502)[PLANNING_COLUMNS.dureeForce],
    3,
    "la duree saisie par le voisin atteint bien la ligne Charge"
  );
  assert.equal(
    h.lastChargeRender().planningRows,
    boardRows,
    "MEME tableau : currentPlanningRows (bouton delegue) et chartRows le tiennent aussi"
  );
});

test("Planning_Projet — un changement HORS colonnes de duree recharge tout le projet", async () => {
  // Une phase deplacee, une tache renommee, une ligne ajoutee : cela dessine le
  // pane HAUT, que seul loadProject() sait reconstruire. Le chemin leger doit
  // rendre la main, sinon le routage de Planning_Projet ferait perdre au widget
  // les changements de planning venus d'un autre widget.
  const h = await mount({ planningRows: initialPlanningRows() });
  h.reset();

  h.setRemotePlanningRows(h.getRemotePlanningRows().map((row) => (
    row.id === 502 ? { ...row, [PLANNING_COLUMNS.taskName]: "Tache renommee" } : row
  )));

  h.api.handleContextTablesChanged({ tables: [PLANNING_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 1, "le pane haut ne se met a jour que par loadProject()");
  assert.equal(h.calls.chargeRender, 0, "et surtout pas un demi-rafraichissement du seul pane bas");
});

test("Planning_Projet — une ligne ajoutee ailleurs recharge tout le projet", async () => {
  const h = await mount({ planningRows: initialPlanningRows() });
  h.reset();

  h.setRemotePlanningRows([...h.getRemotePlanningRows(), planningRow({ id: 503, id2: "3003" })]);

  h.api.handleContextTablesChanged({ tables: [PLANNING_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 1);
});

// --- 2 quinquies. le conteneur du pane bas porte AUSSI la ligne Charge ---------
//
// `els.charge` etait masque des que le projet n'avait aucune ligne TimeSegment.
// La ligne Charge s'y rendait quand meme — DANS UN CONTENEUR CACHE — et son
// bouton « Charge », seul point d'entree de la fenetre d'assignation, devenait
// introuvable exactement dans le cas que cette fonctionnalite sert : definir les
// charges de reference AVANT d'avoir pose le moindre previsionnel. Le test de la
// Tache 3 ne pouvait pas le voir : il appelle `renderChargeRow` dans un vm, deux
// couches sous le conteneur qui le masque.

test("sans aucun TimeSegment, le conteneur du pane bas reste visible pour la ligne Charge", async () => {
  const h = await mount({ segmentRows: [], planningRows: initialPlanningRows() });

  assert.equal(h.els.charge.hidden, false, "sinon le bouton « Charge » serait introuvable");
  assert.equal(
    h.els.chargeEmpty.hidden,
    false,
    "le message « Aucun previsionnel » reste : il parle des lignes de PERSONNES"
  );
  assert.equal(h.calls.chargeRender, 1, "la ligne Charge est bien rendue dans ce conteneur visible");
});

test("sans TimeSegment NI ligne de planning, le pane bas reste masque", async () => {
  // Contrepartie : rien a montrer, donc rien a afficher — l'etat vide d'origine
  // n'est pas devenu un conteneur vide toujours visible.
  const h = await mount({ segmentRows: [], planningRows: [] });

  assert.equal(h.els.charge.hidden, true);
  assert.equal(h.els.chargeEmpty.hidden, false);
});

test("la suppression du DERNIER segment ne fait pas disparaitre la ligne Charge", async () => {
  // Meme regle sur le chemin de RE-rendu (renderChargeFromLocalRows), pas
  // seulement au premier chargement.
  const h = await mount({ planningRows: initialPlanningRows() });
  h.reset();

  h.setRemoteRows([]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  assert.equal(h.calls.chargeRender, 1, "le pane bas est bien redessine");
  assert.equal(h.els.charge.hidden, false, "et son conteneur reste visible pour la ligne Charge");
  assert.equal(h.els.chargeEmpty.hidden, false);
});

// --- 2 ter. BUG A : le lot de NOTRE PROPRE ecriture annonce AUSSI Projets2 ------
//
// shared/project-mutation-sync-relay.js ajoute
// `["UpdateRecord", "Projets2", projectId, signalFields]` AU MEME LOT que notre
// ecriture TimeSegment, et son enveloppe est plus externe que celle de
// grist-service-context.js : `getModifiedTables` voit donc TOUJOURS les deux
// tables. Router sur les seuls NOMS DE TABLES ne pouvait donc jamais prendre le
// chemin leger pour nos propres ecritures — d'ou le « ca me refait cliquer sur
// Editer et ca me remet en haut de la page ».
//
// La regle : quand les tables annoncees tiennent dans {TimeSegment, Projets2}, on
// verifie ce qui a REELLEMENT change — l'empreinte du catalogue projets — avant
// de renoncer au rechargement complet.

test("A — le lot TimeSegment + Projets2 de notre ecriture ne reactualise pas la page", async () => {
  const h = await mount();
  h.setEditMode(true);

  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });
  await h.flush();
  h.setRemoteRows([...h.getRemoteRows(), { ...CREATED_REMOTE_ROW }]);

  // Le relais a bien touche la colonne de signal de Projets2 : le catalogue lui
  // meme (id / nom / numero) n'a pas bouge d'un iota.
  h.setRemoteProjectRows(
    h.getRemoteProjectRows().map((row) => ({ ...row, TimeSegment_Sync: "sig-2" }))
  );
  h.reset();

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE, PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 0, "PAS de loadProject() complet : c'est lui qui reactualisait la page");
  assert.equal(h.calls.teardown, 0, "la fenetre d'edition n'est pas demontee");
  assert.equal(h.calls.createPlanningRenderer, 0, "le pane haut n'est pas reconstruit (clignotement)");
  assert.equal(h.calls.scrollToTop, 0, "le pane haut ne remonte pas en tete de liste");
  assert.equal(h.calls.detach, 0, "le mode Editer n'est pas perdu");
  assert.equal(h.calls.chargeRender, 0, "rien de neuf a afficher : pas de clignotement du pane bas");
});

test("A — l'ecriture d'un voisin annoncee avec Projets2 redessine quand meme le pane bas", async () => {
  const h = await mount();
  h.setEditMode(true);

  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 55, name: "Dora", monthKey: "2026-10", effectif: 4, allocationDays: 22 }),
  ]);
  h.setRemoteProjectRows(
    h.getRemoteProjectRows().map((row) => ({ ...row, TimeSegment_Sync: "sig-2" }))
  );
  h.reset();

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE, PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.fetchProjectData, 1, "les donnees sont bien relues depuis Grist");
  assert.ok(workerNames(h.lastChargeRender()).includes("Dora"), "le changement du voisin apparait");
  assert.equal(h.lastChargeRender().editMode, true, "sans perdre le mode Editer");
  assert.equal(h.calls.reconcileAndLoad, 0);
  assert.equal(h.calls.scrollToTop, 0);
});

test("A — un VRAI changement du catalogue projets recharge tout, meme melange a TimeSegment", async () => {
  const h = await mount();
  h.reset();

  // Un widget de creation de projet a ajoute une ligne : le catalogue a bouge.
  h.setRemoteProjectRows([
    ...h.getRemoteProjectRows(),
    { id: 9, [PROJECT_COLUMNS.name]: "Projet C", [PROJECT_COLUMNS.number]: "26-0001" },
  ]);

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE, PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 1, "un catalogue qui bouge doit toujours rafraichir");
});

test("A — un renommage de projet recharge tout, meme annonce seul", async () => {
  const h = await mount();
  h.reset();

  h.setRemoteProjectRows(
    h.getRemoteProjectRows().map((row) => (
      row.id === 7 ? { ...row, [PROJECT_COLUMNS.name]: "Projet A bis" } : row
    ))
  );

  h.api.handleContextTablesChanged({ tables: [PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 1, "le nom affiche dans le selecteur a change");
});

test("A — un signal Projets2 seul sans changement de catalogue reste leger", async () => {
  // Un widget voisin qui edite une table que nous NE surveillons PAS (Budget...)
  // ne nous reveille que par la colonne de signal de Projets2. Rien de ce qui est
  // affiche ici n'a change : recharger toute la page serait gratuit.
  const h = await mount();
  h.reset();

  h.setRemoteProjectRows(
    h.getRemoteProjectRows().map((row) => ({ ...row, TimeSegment_Sync: "sig-3" }))
  );

  h.api.handleContextTablesChanged({ tables: [PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 0);
  assert.equal(h.calls.scrollToTop, 0);
});

test("A — deux ecritures d'affilee restent legeres : l'empreinte ne derive pas", async () => {
  // Piege classique d'une empreinte memorisee au mauvais moment : la premiere
  // verification passe, la seconde croit voir un changement.
  const h = await mount();
  h.reset();

  for (const signature of ["sig-2", "sig-3", "sig-4"]) {
    h.setRemoteProjectRows(
      h.getRemoteProjectRows().map((row) => ({ ...row, TimeSegment_Sync: signature }))
    );
    h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE, PROJECTS_TABLE] });
    await h.flush();
  }

  assert.equal(h.calls.reconcileAndLoad, 0, "aucune de ces trois ecritures n'a change le catalogue");
  assert.equal(h.calls.fetchProjectCatalog, 3, "une verification par signal, pas davantage");
});

test("A — catalogue illisible : on recharge tout plutot que d'avaler un changement", async () => {
  const h = await mount();
  h.reset();
  h.breakProjectCatalog();

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE, PROJECTS_TABLE] });
  await h.flush();

  assert.equal(h.calls.reconcileAndLoad, 1);
});

test("A — un signal TimeSegment seul ne relit PAS le catalogue projets", async () => {
  // Le cout compte : le chemin le plus frequent doit rester a une seule relecture.
  const h = await mount();
  h.reset();

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.flush();

  assert.equal(h.calls.fetchProjectCatalog, 0);
});

// --- 2 bis. deux relectures concurrentes resolues DANS LE DESORDRE ------------
//
// `reloadChargeFromGrist` n'a pas de garde `loadSeq` utile : ce chemin ne relance
// AUCUN loadProject(), donc loadSeq ne bouge pas. Sans numero de sequence propre,
// deux relectures en vol se resolvent dans un ordre que rien ne garantit et la
// reponse PERIMEE ecrase la fraiche. C'est visible avec un SEUL utilisateur.

test("B2 — la reponse perimee ne doit pas effacer le segment tout juste cree", async () => {
  const h = await mount();
  h.setEditMode(true);
  h.deferFetches();

  // 1. l'utilisateur cree Chloe. Pose en local, Grist l'enregistre, le relais
  //    reveille la surveillance : relecture n°1 part sur l'instantane A,B,Chloe.
  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 77,
    monthKey: "2026-11",
    workerName: "Chloe",
    effectif: 6,
  });
  h.setRemoteRows([...h.getRemoteRows(), { ...CREATED_REMOTE_ROW }]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });

  // 2. il enchaine avec Denis : relecture n°2, instantane A,B,Chloe,Denis.
  await h.getEditingOptions().onChanged({
    type: "create",
    segmentId: 78,
    monthKey: "2026-11",
    workerName: "Denis",
    effectif: 4,
  });
  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 78, name: "Denis", monthKey: "2026-11", effectif: 4 }),
  ]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });

  assert.equal(h.heldFetchCount(), 2, "les deux relectures sont bien en vol");
  const screenBefore = workerNames(h.lastChargeRender()).sort();
  assert.deepEqual(screenBefore, ["Alice", "Bob", "Chloe", "Denis"], "etat de depart a l'ecran");

  h.reset(); // on ne compte plus que ce que font les deux reponses

  // La n°2 (fraiche) revient d'abord : identique au local, donc aucun redessin —
  // c'est correct. Puis la n°1 (perimee), qui ignore Denis.
  await h.resolveFetch(1);
  await h.resolveFetch(0);

  const redrawn = h.lastChargeRender();
  assert.deepEqual(
    redrawn ? workerNames(redrawn).sort() : screenBefore,
    ["Alice", "Bob", "Chloe", "Denis"],
    "la reponse perimee a fait disparaitre de l'ecran le segment tout juste cree"
  );
  assert.equal(h.calls.chargeRender, 0, "aucune des deux reponses n'apporte du neuf : pas de redessin");
});

test("deux rafraichissements distants dans le desordre : le plus RECENT gagne", async () => {
  const h = await mount();
  h.deferFetches();

  // Un voisin ajoute Dora, un signal part ; puis Eva, un second signal part.
  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 55, name: "Dora", monthKey: "2026-10", effectif: 4, allocationDays: 22 }),
  ]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });

  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 56, name: "Eva", monthKey: "2026-10", effectif: 2, allocationDays: 22 }),
  ]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });

  assert.equal(h.heldFetchCount(), 2);
  h.reset();

  await h.resolveFetch(1); // fraiche : Alice, Bob, Dora, Eva
  await h.resolveFetch(0); // perimee : Alice, Bob, Dora

  assert.deepEqual(
    workerNames(h.lastChargeRender()).sort(),
    ["Alice", "Bob", "Dora", "Eva"],
    "la reponse perimee ne doit pas effacer Eva de l'ecran"
  );
  assert.equal(h.calls.chargeRender, 1, "seule la reponse fraiche redessine");
});

test("resolues DANS L'ORDRE, les deux relectures aboutissent normalement", async () => {
  // Contrepartie : le compteur de sequence ne doit pas jeter une reponse
  // legitime — sans quoi un changement distant resterait invisible.
  const h = await mount();
  h.deferFetches();

  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 55, name: "Dora", monthKey: "2026-10", effectif: 4, allocationDays: 22 }),
  ]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  h.reset();

  await h.resolveFetch(0);
  assert.deepEqual(workerNames(h.lastChargeRender()).sort(), ["Alice", "Bob", "Dora"]);

  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 56, name: "Eva", monthKey: "2026-10", effectif: 2, allocationDays: 22 }),
  ]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  await h.resolveFetch(1);

  assert.deepEqual(
    workerNames(h.lastChargeRender()).sort(),
    ["Alice", "Bob", "Dora", "Eva"],
    "deux relectures successives doivent toutes deux s'appliquer"
  );
});

// --- 3. la garde de changement de projet reste intacte ------------------------

test("un changement de projet en cours de route annule le rafraichissement", async () => {
  const h = await mount();
  h.reset();

  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({ id: 55, name: "Dora", monthKey: "2026-10", effectif: 4, allocationDays: 22 }),
  ]);

  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  // L'utilisateur change de projet pendant la relecture : loadSeq avance.
  h.api.bumpLoadSeq();
  await h.flush();

  assert.equal(h.calls.fetchProjectData, 1, "la relecture est bien partie");
  assert.equal(h.calls.chargeRender, 0, "mais son resultat n'est PAS applique au projet suivant");
});

test("C — un signal TimeSegment pendant un changement de projet EN VOL retombe sur le chemin complet", async () => {
  // `refreshChargeOnly` n'etait reaffecte qu'a la FIN de loadProject : pendant
  // tout le fetch il pointait encore sur la fermeture du projet PRECEDENT. Un
  // signal TimeSegment arrivant a ce moment-la partait relire l'ANCIEN projet, et
  // son resultat etait de toute facon jete par `seq !== loadSeq` — l'ecriture
  // externe etait purement et simplement perdue.
  const h = await mount();
  h.deferFetches();
  h.reset();

  // L'utilisateur bascule sur le projet B : loadProject part, son fetch est en
  // vol (5+ requetes REST, ce n'est pas instantane).
  const loading = h.api.loadProject(PROJECT_B);
  assert.equal(h.heldFetchCount(), 1, "le chargement du projet B est bien en vol");
  assert.equal(h.calls.reconcileAndLoad, 0);

  // Pendant ce temps, un voisin ecrit une ligne TimeSegment.
  h.setRemoteRows([
    ...h.getRemoteRows(),
    segmentRow({
      id: 57,
      name: "Fanny",
      monthKey: "2026-09",
      effectif: 3,
      projectNumber: PROJECT_B.number,
      allocationDays: 22,
    }),
  ]);
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });

  assert.equal(
    h.calls.reconcileAndLoad,
    1,
    "pendant un chargement, le signal doit retomber sur le rechargement complet"
  );
  assert.equal(
    h.heldFetchCount(),
    1,
    "et surtout PAS lancer une relecture en place sur le projet precedent"
  );

  // Le chargement de B s'acheve normalement, et republie son rafraichissement.
  await h.resolveFetch(0);
  await loading;
  assert.equal(h.api.hasRefreshChargeOnly(), true, "une fois charge, B rafraichit de nouveau en place");
});

test("une ecriture qui aboutit apres un changement de projet n'est pas appliquee", async () => {
  const h = await mount();
  const { onChanged } = h.getEditingOptions();
  h.reset();

  h.api.bumpLoadSeq();
  await onChanged({ type: "create", segmentId: 77, monthKey: "2026-11", workerName: "Chloe", effectif: 6 });
  await h.flush();

  assert.equal(h.calls.chargeRender, 0, "la garde seq !== loadSeq protege le projet suivant");
  assert.equal(h.calls.fetchProjectData, 0);
});

// --- CABLAGE ------------------------------------------------------------------
//
// Les tests ci-dessus executent le vrai texte de `handleContextTablesChanged`.
// Reste a verifier qu'il est bien CE qu'on abonne au relais : ce raccord-la n'a
// pas d'observable sous Node (bootstrap() touche window/document au chargement).

test("le rappel du relais de synchronisation est handleContextTablesChanged", () => {
  assert.match(
    source,
    /watchContextTables\?\.\(\s*\[[^\]]*\],\s*handleContextTablesChanged,/,
    "le rappel inline reintroduirait le reconcileAndLoad({ force: true }) inconditionnel"
  );
});

test("loadProject publie son rafraichissement en place, et l'oublie des son entree", () => {
  // Garde SECONDAIRE : les deux regles ci-dessous sont deja EXERCEES plus haut
  // (« C — un signal TimeSegment pendant un changement de projet EN VOL » pour
  // l'oubli, le montage pour la publication). Ce test ne fait que nommer le
  // raccord dans le texte.
  const loadProjectSource = extractBlock("  async function loadProject(project) {");
  assert.match(
    loadProjectSource,
    /refreshChargeOnly = reloadChargeFromGrist;/,
    "sans publication, le signal TimeSegment retomberait sur le rechargement complet"
  );
  assert.match(
    loadProjectSource,
    /const seq = \+\+loadSeq;\s*(?:\/\/[^\n]*\n\s*)*refreshChargeOnly = null;/,
    "l'oubli doit avoir lieu A L'ENTREE, pas seulement quand la selection est vidée"
  );
});

test("selection vidée : plus rien a rafraichir en place", async () => {
  const h = await mount();
  assert.equal(h.api.hasRefreshChargeOnly(), true);

  await h.api.loadProject(null);

  assert.equal(h.api.hasRefreshChargeOnly(), false, "sans projet, le signal retombe sur le chemin complet");

  h.reset();
  h.api.handleContextTablesChanged({ tables: [TIME_SEGMENT_TABLE] });
  assert.equal(h.calls.reconcileAndLoad, 1);
  assert.equal(h.calls.fetchProjectData, 0);
});
