// Bootstrap — wires every planning-synchro module into a working app.
// Runs on load against `index.html` (real Grist) and `dev/harness.html`
// (mock-grist.js + dev/fixtures.js).
//
// Flow: initGrist() -> fetch Projets2 -> buildRegistry() -> populate
// #ps-project-select -> reconcile against the shared cross-widget selection
// (readSharedSelection(), same localStorage keys other widgets in this repo
// use) -> loadProject(project) fetches Planning_Projet/TimeSegment/
// ProjectTeam for that project, builds workers + bounds, (re)creates the top
// (vis-timeline) and bottom (charge-plan grid) renderers, mounts the shared
// sync controller, and attaches charge-plan editing.
//
// Interface-mismatch note (see task-14-report.md for detail): the task
// brief's pseudo-code shows `onRangeLabel: (v) => { ...textContent = <
// formatted range>; persistViewport(v); }` (single argument). The REAL
// sync/controller.js calls `onRangeLabel(formatRangeLabel(next), next)` —
// TWO arguments, a pre-formatted "DD/MM/YYYY - DD/MM/YYYY" label string
// first, the full canonical viewport second. This file adapts to that real
// signature (uses the ready-made label directly instead of re-formatting).

import { APP_CONFIG } from "./config.js";
import { initGrist, fetchTableRows, fetchProjectData, updatePlanningDurations } from "./services/gristService.js";
import {
  buildRegistry,
  resolveProjectNameByNumber,
  resolveProject,
  readSharedSelection,
  writeSharedSelection,
} from "./services/projectRegistry.js";
import { getFirstPhaseDate, buildRowPhases, computePlanningPhaseBounds, buildPlanningTaskRanges } from "./top/phases.js";
import { computeTimeSegmentBounds } from "./top/bounds.js";
import { createPlanningRenderer } from "./top/planningRenderer.js";
import { createPlanningChart } from "./top/planningChart.js";
import { createChargeBoard, buildWorkersFromSegments } from "./bottom/chargeBoard.js";
import { attachChargeEditing } from "./bottom/chargeEditing.js";
import { createChargeAssignModal } from "./bottom/chargeAssignModal.js";
import { applySegmentChangeLocally, timeSegmentRowsSignature } from "./bottom/localSegmentUpdate.js";
import { buildAbsenceIndex, normalizeName } from "./utils/leaveAbsences.js";
import { createTopPaneResizer } from "./ui/topPaneResizer.js";
import { buildProjectRealisationTargetLookup } from "./top/vendor/planningProjetBuilder.js";
import { buildInitialProjectViewport, buildCanonicalSharedViewport } from "./viewport/build.js";
import { normalizeIsoDate } from "./viewport/normalize.js";
import { formatIsoDate } from "./utils/dates.js";
import { createSyncController } from "./sync/controller.js";
import { state, loadPersistedViewport, persistViewport } from "./state.js";

const DEFAULT_MONTH_VISIBLE_DAYS = 31;

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectionKeyFor(project) {
  return project ? `${project.id}|${project.name}` : "";
}

// Bounds fallback used when a project has zero TimeSegment rows (bottom pane
// is empty/hidden): derives a start/end from the Planning_Projet phase dates
// themselves (via the already-exported buildRowPhases), so the top pane can
// still be panned/zoomed across its own real date range instead of being
// locked to the tiny default-month window. Falls back to that default
// window's own start/end when there isn't a single dated phase either (e.g.
// an entirely empty project) so the controller always gets a non-null,
// internally consistent bounds object.
// Union of two { startDate, endDate } ISO bounds (either may be null). ISO dates
// compare lexicographically, so min-start / max-end is a plain string compare.
function unionDateBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return {
    startDate: a.startDate < b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate > b.endDate ? a.endDate : b.endDate,
  };
}

function computePlanningDerivedBounds(planningRows, columns, fallbackViewport) {
  let minMs = Infinity;
  let maxMs = -Infinity;

  (planningRows || []).forEach((row) => {
    buildRowPhases(row, columns).forEach((phase) => {
      if (phase.start instanceof Date && !Number.isNaN(phase.start.getTime())) {
        minMs = Math.min(minMs, phase.start.getTime());
        maxMs = Math.max(maxMs, phase.start.getTime());
      }
      if (phase.end instanceof Date && !Number.isNaN(phase.end.getTime())) {
        minMs = Math.min(minMs, phase.end.getTime());
        maxMs = Math.max(maxMs, phase.end.getTime());
      }
    });
  });

  if (Number.isFinite(minMs) && Number.isFinite(maxMs) && maxMs >= minMs) {
    return { startDate: formatIsoDate(new Date(minMs)), endDate: formatIsoDate(new Date(maxMs)) };
  }

  return { startDate: fallbackViewport.firstVisibleDate, endDate: fallbackViewport.rangeEndDate };
}

function buildDefaultMonthViewport(anchorIsoDate) {
  const anchor = normalizeIsoDate(anchorIsoDate) || todayIsoDate();
  return buildCanonicalSharedViewport({
    firstVisibleDate: anchor,
    rangeStartDate: anchor,
    anchorDate: anchor,
    visibleDays: DEFAULT_MONTH_VISIBLE_DAYS,
  });
}

function viewportFitsWithinBounds(viewport, bounds) {
  if (!viewport || !bounds) return false;

  const firstVisibleDate = normalizeIsoDate(viewport.firstVisibleDate);
  const rangeEndDate = normalizeIsoDate(viewport.rangeEndDate);
  if (!firstVisibleDate || !rangeEndDate) return false;

  return firstVisibleDate >= bounds.startDate && rangeEndDate <= bounds.endDate;
}

// Mémorise le défilement autour d'un re-rendu du plan de charge : le tableau est
// reconstruit d'un bloc et, si sa hauteur bouge, le navigateur ramène la page en
// haut — l'utilisateur perd la ligne qu'il vient d'éditer.
function captureChargeScroll() {
  const scroller = document.scrollingElement || document.documentElement;
  const documentTop = scroller ? scroller.scrollTop : 0;
  const chargeScrollLeft = document.querySelector(".charge-plan-scroll")?.scrollLeft || 0;

  return () => {
    const restore = () => {
      if (scroller) scroller.scrollTop = documentTop;
      // Le conteneur est recréé par le rendu : on le relit au moment de restituer.
      const chargeScrollEl = document.querySelector(".charge-plan-scroll");
      if (chargeScrollEl instanceof HTMLElement) chargeScrollEl.scrollLeft = chargeScrollLeft;
    };
    // Une fois tout de suite, une fois après la mise en page : la hauteur des
    // lignes n'est figée qu'à la frame suivante.
    restore();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
  };
}

// Lignes TimeSegment BRUTES d'un retour de fetchProjectData : tous projets, tous
// services. Elles alimentent la barre de charge mensuelle de la fenetre segment,
// qui raisonne sur la PERSONNE et non sur le projet affiche (cf.
// utils/monthLoad.js). Accesseur defensif : un vieux retour sans la cle, ou un
// fetch en echec, donne [] plutot qu'un plantage a l'ouverture de la fenetre.
function readAllTimeSegmentRows(payload) {
  return Array.isArray(payload?.allTimeSegmentRows) ? payload.allTimeSegmentRows : [];
}

// Empreinte du CATALOGUE projets : ce que ce widget en affiche vraiment, a savoir
// l'identifiant, le nom et le numero de chaque projet. Meme principe que
// timeSegmentRowsSignature (bottom/localSegmentUpdate.js) : comparer le CONTENU
// plutot que se fier au nom de la table qui a bouge.
//
// POURQUOI : le relais de synchronisation inter-widgets
// (shared/project-mutation-sync-relay.js) ajoute une ecriture de COLONNE DE
// SIGNAL sur Projets2 au meme lot que chaque mutation. Projets2 est donc annoncee
// comme « changee » apres absolument toutes nos ecritures, alors que rien de ce
// que le selecteur montre n'a bouge. L'empreinte ne retient que les colonnes
// affichees : la colonne de signal, elle, n'y figure pas.
//
// Separateurs (unites ASCII 0x1F/0x1E) impossibles a rencontrer dans une valeur
// Grist, et tri prealable : l'ordre de Projets2 n'est pas significatif.
function projectRegistrySignature(projects) {
  const fieldSeparator = "";
  const rowSeparator = "";
  return (Array.isArray(projects) ? projects : [])
    .map((project) => [project?.id, project?.name, project?.number]
      .map((value) => (value == null ? "" : String(value)))
      .join(fieldSeparator))
    .sort()
    .join(rowSeparator);
}

// Une livraison de `watchContextTables` annonce les tables qui ont change. Trois
// suites possibles :
//
// - "charge"                       : seuls TimeSegment et/ou Planning_Projet ont
//                                    bouge. Le rafraichissement EN PLACE du pane
//                                    bas (reloadChargeFromGrist) sait traiter les
//                                    deux, et lui seul decide, apres relecture, si
//                                    un rechargement complet reste necessaire.
// - "charge-si-catalogue-inchange" : les memes, plus Projets2. Projets2 est
//                                    TOUJOURS de la partie apres nos propres
//                                    ecritures (colonne de signal du relais), donc
//                                    son nom ne prouve rien : il faut comparer
//                                    l'empreinte du catalogue avant de choisir.
// - "full"                         : toute autre table, ou liste vide/absente.
//                                    Dans le doute on recharge tout, on ne perd
//                                    jamais un changement.
//
// POURQUOI Planning_Projet EST ICI. C'est la table qu'ecrit la fenetre « Assigner
// la charge de reference » (updatePlanningDurations, jusqu'a ~112 lignes en un
// lot). Sans cette route, le relais rappelait ce widget juste apres l'ecriture,
// le signal tombait sur "full" -> reconcileAndLoad({ force: true }) ->
// loadProject() complet, et le rechargement VISIBLE que ce widget a
// explicitement retire (perte du mode Editer, retour en haut de page) revenait
// sur l'ecriture la plus lourde du produit — en ecrasant au passage la mise a
// jour locale que handleChargeAssignSubmit venait de poser. Le rechargement
// complet n'est pas perdu pour autant : reloadChargeFromGrist y retombe des que
// la relecture montre qu'AUTRE CHOSE que les colonnes de duree a bouge (une
// phase deplacee, une ligne ajoutee), car cela concerne le pane HAUT que seul
// loadProject() sait reconstruire.
function classifyContextSignal(tables, timeSegmentTableName, projectsTableName, planningProjectTableName) {
  if (!Array.isArray(tables) || tables.length === 0) return "full";
  const isChargeTable = (tableName) => (
    tableName === timeSegmentTableName || tableName === planningProjectTableName
  );
  if (tables.every(isChargeTable)) return "charge";
  if (tables.every((tableName) => (
    isChargeTable(tableName) || tableName === projectsTableName
  ))) return "charge-si-catalogue-inchange";
  return "full";
}

// Empreinte des lignes Planning_Projet, en DEUX moities exclusives :
//   - `durationsOnly = true`  : les seules colonnes Duree_Projet / Duree_Zone /
//     Duree_Force, dont depend uniquement la LIGNE CHARGE du pane bas ;
//   - `durationsOnly = false` : tout le reste, c'est-a-dire ce qui dessine le
//     pane HAUT (dates, libelles, Realise, ...) et la composition des lignes.
// C'est cette separation qui permet a reloadChargeFromGrist de rafraichir la
// ligne Charge en place quand SEULES les durees ont bouge, et de retomber sur le
// rechargement complet des que la frise est concernee.
//
// `JSON.stringify` sur un objet aux cles TRIEES : les colonnes Reference/Choice
// de Grist portent des tableaux ou des objets, qu'un simple String() reduirait
// tous a "[object Object]" — l'empreinte avalerait alors silencieusement leurs
// changements. Separateur (unite ASCII 0x1E) impossible dans une valeur Grist,
// comme projectRegistrySignature plus haut.
function planningRowsSignature(rows, columns, durationsOnly) {
  const cols = columns || {};
  const durationColumns = new Set(
    [cols.dureeProjet, cols.dureeZone, cols.dureeForce].filter(Boolean)
  );
  const rowSeparator = "\u001E";
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const source = row || {};
      const picked = {};
      Object.keys(source)
        .filter((key) => durationColumns.has(key) === Boolean(durationsOnly))
        .sort()
        .forEach((key) => {
          picked[key] = source[key] === undefined ? null : source[key];
        });
      return JSON.stringify(picked);
    })
    .join(rowSeparator);
}

function bootstrapApp() {
  const els = {
    select: document.getElementById("ps-project-select"),
    toolbar: document.getElementById("ps-toolbar"),
    empty: document.getElementById("ps-empty"),
    main: document.getElementById("ps-main"),
    planning: document.getElementById("ps-planning"),
    splitter: document.getElementById("ps-splitter"),
    charge: document.getElementById("ps-charge"),
    chargeEmpty: document.getElementById("ps-charge-empty"),
    aggregateToggle: document.getElementById("ps-aggregate-toggle"),
    range: document.getElementById("ps-range"),
    editModal: document.getElementById("ps-edit-segment-modal"),
    chargeAssignModal: document.getElementById("ps-charge-assign-modal"),
    viewSwitch: document.getElementById("ps-view-switch"),
    chart: document.getElementById("ps-chart"),
    chartCanvas: document.getElementById("ps-chart-canvas"),
    chartFilter: document.getElementById("ps-chart-filter"),
    chartGranularity: document.getElementById("ps-chart-granularity"),
    chartLegend: document.getElementById("ps-chart-legend"),
  };

  if (!(els.select instanceof HTMLElement)) {
    // Markup not present (unexpected host page) — nothing to wire.
    return;
  }

  // Mutable per-project instances. Recreated on every loadProject() call
  // (both on project switch and on clearing the selection): teardown() runs
  // first, so there is never more than one live planningRenderer/chargeBoard/
  // controller/editing at a time — no listener leaks, no double-mount.
  let planningRenderer = null;
  let planningChart = null;
  let chargeBoard = null;
  let controller = null;
  let editing = null;
  let topPaneResizer = null;
  let loadSeq = 0;
  let lastAppliedSelectionKey = "";

  // Fenetre "Assigner la charge de reference" (Tache 4) : montee/demontee au
  // meme rythme qu'`editing` (attachChargeEditing), juste a cote. Elle-meme
  // ne garde jamais planningRows en memoire au-dela d'un `open()` — c'est ce
  // module (`currentPlanningRows`, ci-dessous) qui tient l'instantane du
  // projet courant pour le bouton delegue (cf. bootstrap()).
  let chargeAssignModal = null;
  let currentPlanningRows = [];

  // Rafraichissement NON DESTRUCTIF du plan de charge du projet courant, publie
  // par loadProject() (c'est son `reloadChargeFromGrist`). Null tant qu'aucun
  // projet n'est charge — le signal retombe alors sur le rechargement complet.
  let refreshChargeOnly = null;

  // Empreinte du catalogue projets tel que ce widget l'affiche, posee par
  // bootstrap() puis remise a jour a chaque changement REEL. Elle sert a
  // distinguer une ecriture de colonne de signal sur Projets2 (rien n'a bouge)
  // d'un vrai changement du catalogue (creation, renommage, suppression).
  let projectRegistryFingerprint = "";

  // Top-pane view: "planning" (the read-only timeline) or "chart" (the task-load
  // graph). The chart is available at any time — it does NOT require the aggregate
  // ("Rassembler visuellement") toggle (its data is derived from the planning rows
  // directly, independent of how the timeline is grouped).
  let topView = "planning";
  let lastTopPaneHeightPx = 0;
  // Planning rows/columns kept for the chart (same data the timeline renders).
  let chartRows = [];
  let chartColumns = null;

  // Session-scoped visible-rows target for the top pane's splitter: kept here
  // (not per-project, not persisted to localStorage) so a height chosen on one
  // project carries to the next, re-clamped to that project's row count by the
  // resizer (see ui/topPaneResizer.js + top/paneMath.js).
  let desiredTopRows = APP_CONFIG.topPane.defaultRows;

  // Realisation target-indice lookup, keyed by project (name/number/id), built
  // from Projets2.Avancement — feeds the vendored builder so a row with an empty
  // `Realise` still gets the exact realisation state Planning Projet would show.
  let realisationTargetLookup = null;

  function teardown() {
    if (chargeAssignModal) {
      chargeAssignModal.destroy();
      chargeAssignModal = null;
    }
    if (editing) {
      editing.detach();
      editing = null;
    }
    if (planningChart) {
      planningChart.destroy();
      planningChart = null;
    }
    if (topPaneResizer) {
      topPaneResizer.destroy();
      topPaneResizer = null;
    }
    if (controller) {
      controller.destroy();
      controller = null;
    }
    if (chargeBoard) {
      chargeBoard.destroy();
      chargeBoard = null;
    }
    if (planningRenderer) {
      planningRenderer.destroy();
      planningRenderer = null;
    }
  }

  function populateProjectSelect() {
    const previousValue = els.select.value;
    els.select.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Choisir un projet";
    els.select.appendChild(placeholderOption);

    state.registry.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.name;
      option.textContent = `${project.number} - ${project.name}`;
      option.dataset.projectId = String(project.id);
      els.select.appendChild(option);
    });

    els.select.value = previousValue;
  }

  async function loadProject(project) {
    const seq = ++loadSeq;
    // Le rafraichissement en place publie plus bas appartient au projet PRECEDENT :
    // tant que celui-ci n est pas remplace, un signal TimeSegment partirait relire
    // l ancien numero et son resultat serait jete par `seq !== loadSeq` — l ecriture
    // externe serait perdue. Pendant un chargement, le signal doit retomber sur le
    // chemin complet ; loadProject republiera le sien a la fin.
    refreshChargeOnly = null;

    state.selectedProject = project || null;

    if (!project) {
      teardown();
      currentPlanningRows = [];
      els.empty.hidden = false;
      els.main.hidden = true;
      return;
    }

    // Le teardown n'a volontairement pas lieu ici : il viderait les deux panneaux
    // pendant tout le fetch, la page s'effondrerait en hauteur et le navigateur
    // ramènerait le défilement à zéro (écran blanc entre-temps). On garde
    // l'affichage précédent et on ne démonte qu'au moment de reconstruire.

    let data = { planningRows: [], timeSegmentRows: [], projectTeamRows: [], teamRows: [], timeOutRows: [] };
    try {
      data = await fetchProjectData({ name: project.name, number: project.number });
    } catch (error) {
      console.error("Erreur chargement des donnees du projet :", error);
    }

    if (seq !== loadSeq) return; // superseded by a newer project switch

    const pc = APP_CONFIG.grist.columns;
    const { planningRows, timeSegmentRows, projectTeamRows } = data;
    const workerColumns = { timeSegment: pc.timeSegment, projectTeam: pc.projectTeam };
    // Instantane relu par le bouton "Charge" delegue (cf. bootstrap()) : la
    // fenetre d'assignation construit son arbre a l'ouverture, jamais avant.
    currentPlanningRows = Array.isArray(planningRows) ? planningRows : [];

    // Lignes TimeSegment VIVANTES du projet affiche : point de depart des mises
    // a jour LOCALES post-ecriture (cf. onChanged plus bas). Mutable, la ou
    // `timeSegmentRows` reste l'instantane du chargement.
    let projectTimeSegmentRows = Array.isArray(timeSegmentRows) ? timeSegmentRows : [];

    // Reference MUTABLE, relue par la fenetre a chaque rendu de sa barre de
    // charge : le chemin onChanged (ci-dessous) la met a jour apres chaque
    // ecriture, sinon la barre resterait sur l'instantane d'avant.
    let allTimeSegmentRows = readAllTimeSegmentRows(data);

    // Per-worker absence index (Map<normalizeName, Set<"YYYY-MM-DD:am|pm">>) built
    // from the global Team + Time-Out rows. Time-Out is global and unaffected by
    // charge-segment edits, so the same index is reused for the onChanged re-render
    // (closure) and provided to the editing layer via getAbsenceSet.
    const absencesByWorker = buildAbsenceIndex(
      data.timeOutRows,
      data.teamRows,
      pc.timeOut,
      pc.team,
      APP_CONFIG.absenceTypes
    );

    const workers = buildWorkersFromSegments(timeSegmentRows, projectTeamRows, workerColumns);
    const bounds = computeTimeSegmentBounds(timeSegmentRows, pc.timeSegment);
    const firstPlanningDate = getFirstPhaseDate(planningRows, pc.planningProject);

    // Widen the shared frise to cover the planning PHASES (union with the
    // TimeSegment bounds) so rows outside the prévisionnel window stay visible.
    // Reception ("Données d'entrées") bands are deliberately NOT included in the
    // bounds: a band precedes its phase (received N weeks before the deadline),
    // so counting it would drag bounds.start left of every phase and leave the
    // band sitting at the far-left edge of the frise (the "segment généré à
    // gauche" bug). Excluded, a band that would fall before the first phase is
    // simply out of range — never shown as a stray leftmost segment — while bands
    // near their phase (the normal case) still render in context. vis
    // `align:'center'` (planningRenderer) makes sure an out-of-window band never
    // pins its content to the left edge either.
    const planBounds = computePlanningPhaseBounds(planningRows, project.name);
    if (seq !== loadSeq) return; // superseded while awaiting References2

    // Démontage juste avant la reconstruction : tout ce qui suit est synchrone,
    // l'ancien affichage est donc remplacé sans passer par un écran vide.
    teardown();
    planningRenderer = createPlanningRenderer(els.planning);
    chargeBoard = createChargeBoard(els.charge);
    planningChart = createPlanningChart(
      els.chartCanvas,
      els.chartFilter,
      els.chartGranularity,
      els.chartLegend
    );
    // Keep the planning data for the chart view; always arrive on the planning
    // (timeline) view, scrolled to the first rows (see scrollToTop below).
    chartRows = planningRows;
    chartColumns = pc.planningProject;
    topView = "planning";

    const aggregate = Boolean(els.aggregateToggle && els.aggregateToggle.checked);
    planningRenderer.render({
      rows: planningRows,
      columns: pc.planningProject,
      aggregate,
      project: project.name,
      targetLookup: realisationTargetLookup,
      // Reception ("Données d'entrées") bands are intentionally NOT rendered
      // (referenceReceptionLookup omitted) — removed at the user's request.
    });

    let viewport;
    let controllerBounds;

    // Planning task ranges for the bottom-pane segment hover title (how many
    // planning tasks to do during each segment) — like gestion-depenses2.
    const planningTasks = buildPlanningTaskRanges(planningRows, pc.planningProject);

    if (bounds) {
      els.chargeEmpty.hidden = true;
      els.charge.hidden = false;
      controllerBounds = unionDateBounds(bounds, planBounds) || bounds;

      const initialViewport = buildInitialProjectViewport({ firstPlanningDate, bounds: controllerBounds });
      // Only reuse a persisted window for the SAME project it was saved from
      // (persisted.projectId === project.id) AND only if it still fits the
      // current bounds. Any other case (different project, or a window that no
      // longer fits) always falls back to the fresh ~1-year initial window —
      // this preserves same-project reload continuity without letting Project
      // A's stale window leak onto Project B just because B's bounds happen to
      // contain it.
      const persisted = loadPersistedViewport();
      const canReusePersisted =
        persisted &&
        persisted.projectId === project.id &&
        viewportFitsWithinBounds(persisted.viewport, controllerBounds);
      viewport = canReusePersisted ? buildCanonicalSharedViewport(persisted.viewport) : initialViewport;

      // `allTimeSegmentRows` : la surcharge d'une personne se compte tous projets
      // confondus, le board ne peut pas la deduire de ses seuls `workers`.
      chargeBoard.render({
        workers,
        viewport,
        editMode: false,
        planningTasks,
        absencesByWorker,
        planningRows,
        allTimeSegmentRows,
      });
    } else {
      // No TimeSegment data for this project: bottom pane stays empty, but
      // the top (Planning_Projet) pane must still render on a sane default
      // window instead of crashing — anchor on the first phase date (or
      // today) for ~1 month, per the task brief.
      els.chargeEmpty.hidden = false;
      // Le conteneur n'est plus masque sur la seule absence de TimeSegment : la
      // ligne Charge y est rendue elle aussi, et son bouton « Charge » est le
      // SEUL point d'entree de la fenetre d'assignation. Le masquer ici le
      // rendait introuvable exactement dans le cas que cette fonctionnalite
      // sert — definir les charges de reference AVANT d'avoir pose le moindre
      // previsionnel (cf. les projets « toutes les lignes COFFRAGE » de
      // tests/documentCharge.test.mjs). Le message « Aucun previsionnel » reste,
      // lui, affiche : il parle des lignes de PERSONNES, qui, elles, manquent
      // bien.
      els.charge.hidden = !(Array.isArray(planningRows) && planningRows.length > 0);

      viewport = buildDefaultMonthViewport(firstPlanningDate);
      // No TimeSegment: the frise still spans the planning phases (builder bounds),
      // falling back to the phase-derived range when the builder yields none.
      controllerBounds = planBounds || computePlanningDerivedBounds(planningRows, pc.planningProject, viewport);
      chargeBoard.render({
        workers: [],
        viewport,
        editMode: false,
        absencesByWorker,
        planningRows,
        allTimeSegmentRows,
      });
    }

    // Dernier mode de zoom appliqué (semaine/mois/année). La hauteur bornée du
    // pane haut ne dépend que du nombre de lignes (invariant au zoom/pan) et de la
    // hauteur de bande d'axe, qui ne change qu'au changement de mode — on évite
    // donc de re-mesurer + rappeler setMaxHeight (redraw vis) à chaque cran.
    let lastAppliedMode = null;

    controller = createSyncController({
      planningRenderer,
      chargeBoard,
      bounds: controllerBounds,
      onRangeLabel: (label, appliedViewport) => {
        if (els.range) els.range.textContent = label || "-";
        state.viewport = appliedViewport;
        // On persiste sous le projet DE CE contrôleur (`project`), pas sous
        // `state.selectedProject` : le démontage n'a plus lieu au début de
        // loadProject(), donc l'ancien contrôleur reste vivant pendant le fetch
        // du projet suivant, alors que `state.selectedProject` pointe déjà sur
        // ce dernier. Un pan/zoom pendant cette fenêtre enregistrerait la
        // fenêtre du projet A sous l'identifiant du projet B, et B s'ouvrirait
        // sur la chronologie de A (le cas que loadPersistedViewport cherche
        // justement à empêcher).
        persistViewport(appliedViewport, project);
        // Ne re-mesurer/re-borner que si le MODE a changé (bande d'axe) ; un pan
        // ou un zoom intra-mode ne change ni le nb de lignes ni l'axe.
        if (topPaneResizer && appliedViewport && appliedViewport.mode !== lastAppliedMode) {
          lastAppliedMode = appliedViewport.mode;
          topPaneResizer.refresh();
        }
        // Keep the chart's chronology in sync with the frise (both panes move
        // together) when the chart view is showing.
        if (topView === "chart" && planningChart) planningChart.setViewport(appliedViewport);
      },
    });

    // Splitter/resizer for the top pane's visible height (min 5 / max 16 rows).
    // Created after render so the first refresh() can measure the rendered axis
    // and row heights; shares the session-scoped desiredTopRows.
    topPaneResizer = createTopPaneResizer({
      planningEl: els.planning,
      splitterEl: els.splitter,
      getGroupCount: () => (planningRenderer ? planningRenderer.getGroupCount() : 0),
      setMaxHeight: (px) => {
        lastTopPaneHeightPx = px;
        if (planningRenderer) planningRenderer.setMaxHeight(px);
        // Keep the chart the same height as the timeline it replaces so the
        // layout does not jump when switching views or dragging the splitter.
        if (planningChart) planningChart.setHeight(px);
      },
      config: APP_CONFIG.topPane,
      getDesiredRows: () => desiredTopRows,
      setDesiredRows: (rows) => {
        desiredTopRows = rows;
      },
    });

    controller.bindToolbar(els.toolbar);
    controller.bindWheel(els.main);
    // Drag-to-pan the planning ONLY from the date axis (the "frise"): dragging the
    // task rows must not move the chronology (they scroll vertically instead).
    controller.bindPan(els.planning, {
      startFilter: (event) =>
        event.target instanceof Element && Boolean(event.target.closest(".vis-panel.vis-top")),
    });
    // The chart view keeps the SAME navigable chronology: drag-to-pan the chart
    // (wheel-zoom already works — #ps-chart is not #ps-planning — as does the
    // toolbar), so both panes move together whether the timeline or the chart is
    // showing.
    controller.bindPan(els.chart);
    controller.setViewport(viewport);
    topPaneResizer.refresh();

    // Arrive on the planning view, at the FIRST rows (not wherever the previous
    // project was scrolled), and show/hide the Planning/Graphique switch to match
    // the current aggregate state.
    planningRenderer.scrollToTop();
    updateViewSwitchVisibility();
    applyTopView();

    // Redessine le pane bas a partir des lignes DEJA en memoire. Aucun fetch :
    // c'est ce qui supprime le rechargement visible apres chaque ecriture.
    function renderChargeFromLocalRows() {
      if (!chargeBoard || !controller) return;

      const nextWorkers = buildWorkersFromSegments(
        projectTimeSegmentRows,
        projectTeamRows,
        workerColumns
      );
      const nextBounds = computeTimeSegmentBounds(projectTimeSegmentRows, pc.timeSegment);

      if (nextBounds) {
        els.chargeEmpty.hidden = true;
        els.charge.hidden = false;
      } else {
        // Meme regle qu'au premier rendu (cf. loadProject) : sans TimeSegment le
        // pane bas garde sa ligne Charge — donc son bouton — des qu'il y a des
        // lignes de planning.
        els.chargeEmpty.hidden = false;
        els.charge.hidden = !(Array.isArray(planningRows) && planningRows.length > 0);
      }

      // Un segment cree sur un mois hors des bornes actuelles doit rester
      // atteignable : la frise partagee s'ELARGIT pour le couvrir. Jamais
      // l'inverse — retrecir les bornes (apres une suppression) deplacerait la
      // fenetre courante sous les yeux de l'utilisateur.
      const widenedBounds = unionDateBounds(
        controllerBounds,
        unionDateBounds(nextBounds, planBounds)
      );
      if (
        widenedBounds &&
        controllerBounds &&
        (widenedBounds.startDate !== controllerBounds.startDate ||
          widenedBounds.endDate !== controllerBounds.endDate)
      ) {
        controllerBounds = widenedBounds;
        controller.setBounds(widenedBounds);
      }

      // Preserve the sticky edit mode across the post-write re-render:
      // chargeEditing.persistWrite() re-asserts editModeEnabled synchronously
      // in its finally, but this render() (and the controller's follow-up rAF
      // re-render below, which reuses chargeBoard.lastEditMode) would reset it
      // to locked if we hardcoded false here. Read the live flag from the
      // editing controller so ONE source of truth drives both.
      const currentEditMode = editing ? editing.isEditModeEnabled() : false;
      const restoreScroll = captureChargeScroll();
      chargeBoard.render({
        workers: nextWorkers,
        viewport: controller.getViewport(),
        editMode: currentEditMode,
        absencesByWorker,
        planningRows,
        // Chemin post-ecriture : sans cette ligne, la couleur de surcharge
        // resterait celle d'avant la modification.
        allTimeSegmentRows,
      });
      controller.setViewport(controller.getViewport());
      restoreScroll();
    }

    // Numero de sequence PROPRE au rafraichissement en place. `loadSeq` ne bouge
    // pas sur ce chemin : aucun loadProject() n est relance. Sans compteur dedie,
    // deux relectures concurrentes — le debounce du relais est de 100 ms alors que
    // fetchProjectData enchaine 5+ requetes REST, donc deux signaux espaces de plus
    // de 100 ms se chevauchent tres ordinairement — se resolvent dans un ordre que
    // rien ne garantit, et la reponse PERIMEE ecrase la fraiche : le segment tout
    // juste cree disparait de l ecran. Une seule reponse compte, la DERNIERE partie.
    let chargeRefreshSeq = 0;

    // Relit les lignes du projet et redessine LE PANE BAS. Deux usages : le repli
    // des changements qu'on ne sait pas appliquer localement, et le
    // rafraichissement en place declenche par le relais de synchronisation
    // (cf. handleContextTablesChanged). Rien n'est demonte : ni la fenetre
    // d'edition, ni le pane haut, ni le mode Editer, ni la position de defilement.
    //
    // Couvre les DEUX tables que classifyContextSignal route ici :
    //   - TimeSegment      : les barres de personnes du pane bas ;
    //   - Planning_Projet  : les trois colonnes de duree de la ligne Charge.
    // Un seul chemin, une seule relecture (fetchProjectData ramene deja les
    // deux) — un second mecanisme parallele finirait par diverger de celui-ci.
    // Ce qui, dans Planning_Projet, ne concerne PAS la ligne Charge appartient au
    // pane HAUT : ce chemin ne sait pas le redessiner et retombe alors, en toute
    // conscience, sur le rechargement complet.
    async function reloadChargeFromGrist() {
      const refreshSeq = ++chargeRefreshSeq;
      let refreshed;
      try {
        refreshed = await fetchProjectData({ name: project.name, number: project.number });
      } catch (error) {
        console.error("Erreur rechargement du plan de charge :", error);
        return;
      }
      // Reponse d une relecture DEPASSEE par une plus recente : la jeter. Sans
      // cela elle repeindrait un instantane plus ancien que celui deja a l ecran.
      if (seq !== loadSeq || refreshSeq !== chargeRefreshSeq || !chargeBoard || !controller) return;

      const nextProjectRows = Array.isArray(refreshed.timeSegmentRows)
        ? refreshed.timeSegmentRows
        : [];
      const nextAllRows = readAllTimeSegmentRows(refreshed);

      // --- Planning_Projet -----------------------------------------------------
      //
      // Tout ce qui n'est PAS une colonne de duree dessine le pane haut (dates de
      // phase, libelles, Realise, composition des lignes) : seul loadProject()
      // sait le reconstruire, on lui rend donc la main — c'est exactement le
      // comportement d'avant pour ces changements-la, on ne perd rien.
      const chargeColumns = pc.planningProject;
      const nextPlanningRows = Array.isArray(refreshed.planningRows)
        ? refreshed.planningRows
        : [];
      if (
        planningRowsSignature(nextPlanningRows, chargeColumns, false) !==
        planningRowsSignature(planningRows, chargeColumns, false)
      ) {
        reconcileAndLoad({ force: true });
        return;
      }

      // Seules les durees ont bouge : la ligne Charge est la seule concernee. On
      // recopie les trois colonnes dans les objets-ligne DEJA en memoire plutot
      // que de remplacer le tableau — `currentPlanningRows` (bouton delegue),
      // `chartRows` (vue graphique) et le `planningRows` passe au board tiennent
      // tous CETTE meme reference, et handleChargeAssignSubmit mute de la meme
      // facon. Les remplacer ici les laisserait pointer sur l'instantane d'avant.
      const planningDurationsChanged =
        planningRowsSignature(nextPlanningRows, chargeColumns, true) !==
        planningRowsSignature(planningRows, chargeColumns, true);
      if (planningDurationsChanged) {
        const nextRowsById = new Map(
          nextPlanningRows.map((row) => [row?.[chargeColumns.id], row])
        );
        (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
          const nextRow = nextRowsById.get(row?.[chargeColumns.id]);
          if (!nextRow) return;
          row[chargeColumns.dureeProjet] = nextRow[chargeColumns.dureeProjet];
          row[chargeColumns.dureeZone] = nextRow[chargeColumns.dureeZone];
          row[chargeColumns.dureeForce] = nextRow[chargeColumns.dureeForce];
        });
      }

      // Relecture qui ne ramene RIEN de neuf : c'est le cas apres notre propre
      // ecriture, deja posee a l'ecran par la mise a jour locale. Redessiner ne
      // ferait alors que faire clignoter le pane bas. On compare les lignes plutot
      // que d'armer un jeton « ignorer le prochain signal » : un jeton avalerait
      // l'ecriture simultanee d'un autre utilisateur, alors qu'une empreinte
      // differente redessine toujours.
      const columns = pc.timeSegment;
      const sameProjectRows =
        timeSegmentRowsSignature(nextProjectRows, columns) ===
        timeSegmentRowsSignature(projectTimeSegmentRows, columns);
      const sameAllRows =
        timeSegmentRowsSignature(nextAllRows, columns) ===
        timeSegmentRowsSignature(allTimeSegmentRows, columns);
      if (sameProjectRows && sameAllRows && !planningDurationsChanged) return;

      projectTimeSegmentRows = nextProjectRows;
      allTimeSegmentRows = nextAllRows;
      renderChargeFromLocalRows();
    }

    // Publie pour le relais : un changement qui ne touche que TimeSegment se
    // rafraichit ainsi, sans repasser par loadProject().
    refreshChargeOnly = reloadChargeFromGrist;

    editing = attachChargeEditing(els.charge, {
      getProjectNumber: () => project.number,
      getVisibleSlots: () => (chargeBoard ? chargeBoard.getVisibleSlots() : []),
      editSegmentModalEl: els.editModal,
      // Per-worker absence half-day set for the edit modal's leave-adjusted
      // readout (consumed in Task 7). Harmless extra option until then.
      getAbsenceSet: (workerName) => absencesByWorker.get(normalizeName(workerName)) || new Set(),
      // Barre de charge mensuelle de la fenetre : toutes les lignes TimeSegment,
      // tous projets et tous services. Un ACCESSEUR et non le tableau lui-meme,
      // pour que la mise a jour locale de `onChanged` soit visible aussitot.
      getAllTimeSegmentRows: () => allTimeSegmentRows,
      // Lit `state.registry` A CHAQUE APPEL et non une copie capturee : le
      // catalogue est reconstruit quand Projets2 change, et la fenetre peut
      // rester ouverte pendant.
      resolveProjectLabel: (projectNumber) =>
        resolveProjectNameByNumber(state.registry, projectNumber),
      // MISE A JOUR LOCALE apres une ecriture reussie : plus de
      // fetchProjectData() ni de re-rendu sur donnees rechargees. Le
      // rechargement faisait clignoter le planning et sautait la position de
      // defilement — c'est exactement ce que gestion-depenses2 evite. La
      // coherence a terme reste assuree par le relais de synchronisation
      // inter-widgets (watchContextTables) : rien a reconcilier ici.
      //
      // `change` decrit l'ecriture qui vient d'aboutir (cf. chargeEditing.js).
      // La garde `seq !== loadSeq` est conservee : un changement de projet
      // pendant l'ecriture ne doit jamais appliquer la modification au projet
      // suivant.
      onChanged: async (change) => {
        if (seq !== loadSeq || !chargeBoard || !controller) return;

        const applied = applySegmentChangeLocally({
          change,
          projectRows: projectTimeSegmentRows,
          allRows: allTimeSegmentRows,
          columns: pc.timeSegment,
          projectNumber: project.number,
        });

        if (!applied.applied) {
          // Changement non applicable a coup sur (creation dont Grist n'a pas
          // rendu l'id, ligne introuvable) : plutot qu'un etat invente, on
          // retombe sur le rechargement complet d'avant.
          await reloadChargeFromGrist();
          return;
        }

        // La barre de charge mensuelle de la fenetre lit TOUTES les lignes
        // TimeSegment : sans cette mise a jour, elle afficherait des chiffres
        // perimes des la premiere sauvegarde.
        projectTimeSegmentRows = applied.projectRows;
        allTimeSegmentRows = applied.allRows;
        renderChargeFromLocalRows();
      },
    });

    // onSubmit de la fenetre d'assignation de charge (bottom/chargeAssignModal.js).
    // La fenetre elle-meme ne fait AUCUNE ecriture Grist : elle collecte les
    // intentions de l'utilisateur (buildChargeTree + collectChargeWrites) et
    // les remet ici, deja sous la forme `writes` attendue par
    // updatePlanningDurations.
    //
    // Meme discipline que renderChargeFromLocalRows/onChanged plus haut :
    // AUCUN fetchProjectData() apres l'ecriture — un refetch complet
    // ramenerait le rechargement visible qui a ete retire de ce widget. Ce
    // n'est vrai que parce que le signal que le relais renvoie sur NOTRE lot
    // est route (classifyContextSignal -> "charge") : sans la route
    // Planning_Projet, il tombait sur "full" et un loadProject() complet
    // ecrasait la mise a jour en place ci-dessous quelques instants plus tard.
    // Les
    // objets-ligne de `planningRows` sont donc mutes EN PLACE (pas le tableau
    // qui les contient) : c'est cette meme reference que `currentPlanningRows`
    // et `chartRows` retiennent deja, nul besoin de la republier ailleurs.
    // Une ligne absente de `planningRows` (jamais le cas en pratique, la
    // fenetre construit ses ecritures a partir de ces memes lignes) est
    // ignoree plutot que de planter le rendu.
    //
    // Un recordId peut revenir plusieurs fois dans `writes` (Tache 5 point B,
    // meme scenario que dans gristService.updatePlanningDurations) : le
    // Object.assign ci-dessous fusionne alors chaque entree sur la MEME ligne,
    // cf. son commentaire pour le detail du choix.
    async function handleChargeAssignSubmit(writes) {
      try {
        await updatePlanningDurations(writes);
      } catch (error) {
        console.error("Erreur enregistrement de la charge de reference :", error);
        return {
          ok: false,
          error: "L'enregistrement de la charge a echoue. Reessayez.",
        };
      }

      const chargeCols = pc.planningProject;
      const rowsById = new Map(
        planningRows.map((row) => [row?.[chargeCols.id], row])
      );
      (Array.isArray(writes) ? writes : []).forEach((write) => {
        const row = rowsById.get(write?.recordId);
        if (row) Object.assign(row, write?.fields || {});
      });

      renderChargeFromLocalRows();
      return { ok: true };
    }

    // Fenetre "Assigner la charge de reference" (Tache 4) : montee/demontee
    // au meme rythme qu'`editing` juste au-dessus (teardown()/loadProject()).
    chargeAssignModal = createChargeAssignModal(els.chargeAssignModal, {
      onSubmit: handleChargeAssignSubmit,
    });

    els.main.hidden = false;
    els.empty.hidden = true;
  }

  function reconcileAndLoad({ force = false } = {}) {
    const shared = readSharedSelection();
    const project = resolveProject(state.registry, shared);
    els.select.value = project ? project.name : "";

    const key = selectionKeyFor(project);
    if (!force && key === lastAppliedSelectionKey) return; // avoid redundant reload
    lastAppliedSelectionKey = key;
    loadProject(project);
  }

  function handleProjectSelectChange() {
    const selectedOption = els.select.selectedOptions && els.select.selectedOptions[0];
    const idAttr = selectedOption ? selectedOption.dataset.projectId : "";
    const id = Number(idAttr);
    const name = els.select.value || "";

    const project = resolveProject(state.registry, { name, id: Number.isInteger(id) ? id : null });
    writeSharedSelection({ name: project ? project.name : "", id: project ? project.id : null });
    lastAppliedSelectionKey = selectionKeyFor(project);
    loadProject(project);
  }

  function handleStorageEvent(event) {
    if (event.key !== APP_CONFIG.sharedProjectStorageKey && event.key !== APP_CONFIG.sharedProjectIdStorageKey) {
      return;
    }
    reconcileAndLoad();
  }

  function handleServiceChange() {
    reconcileAndLoad({ force: true });
  }

  // Rappel du relais de synchronisation inter-widgets.
  //
  // ATTENTION : il se declenche AUSSI sur NOS PROPRES ecritures. `applyActions`
  // appelle `grist.docApi.applyUserActions`, que shared/grist-service-context.js
  // patche pour enchainer `synchronizeAfterMutation` ->
  // `refreshContextWatchers(["TimeSegment"])` -> livraison « mutation » -> ce
  // rappel, ~100 ms plus tard. Le fichier partage le dit en toutes lettres : le
  // rendu est rappele « que le changement vienne de LUI, d'un autre widget de la
  // page, ou d'un autre utilisateur ».
  //
  // Un `reconcileAndLoad({ force: true })` inconditionnel relance donc
  // loadProject() apres chaque ajout de segment : teardown() de la fenetre
  // d'edition, recreation des deux panes, scrollToTop() du pane haut et pane bas
  // re-rendu en lecture seule — le « quand j'ajoute un segment, ca me reactualise
  // la page » signale par l'utilisateur.
  //
  // Une ecriture qui ne touche QUE TimeSegment ne concerne pourtant que le pane
  // bas : on relit ses seules donnees et on redessine EN PLACE. Le chemin est le
  // meme pour un changement reellement externe (autre widget, autre utilisateur) :
  // les lignes sont bien relues depuis Grist, jamais avalees.
  //
  // ROUTER SUR LES NOMS DE TABLES NE SUFFIT PAS. Le relais ajoute
  // `["UpdateRecord", "Projets2", projectId, signalFields]` AU MEME LOT que notre
  // ecriture, et son enveloppe est plus externe que celle de la couche de
  // contexte : `getModifiedTables` voit donc toujours TimeSegment ET Projets2, et
  // un predicat « uniquement TimeSegment » ne pouvait jamais etre vrai pour nos
  // propres ecritures. On route donc sur ce qui a REELLEMENT change : quand les
  // tables annoncees tiennent dans {TimeSegment, Projets2}, on compare l'empreinte
  // du catalogue avant de renoncer au rechargement complet.

  // Relit Projets2 et dit si le catalogue AFFICHE (id / nom / numero) a bouge.
  // Illisible -> true : dans le doute on recharge tout plutot que d'avaler un
  // changement.
  async function projectCatalogHasChanged() {
    let projectRows = [];
    try {
      projectRows = await fetchTableRows(APP_CONFIG.grist.tables.projects);
    } catch (error) {
      console.error("Erreur relecture du catalogue projets :", error);
      return true;
    }

    const signature = projectRegistrySignature(
      buildRegistry(projectRows, APP_CONFIG.grist.columns.projects)
    );
    if (signature === projectRegistryFingerprint) return false;

    projectRegistryFingerprint = signature;
    return true;
  }

  async function refreshChargeUnlessCatalogChanged() {
    const refresh = refreshChargeOnly;
    if (await projectCatalogHasChanged()) {
      reconcileAndLoad({ force: true });
      return;
    }
    // Un chargement de projet a pu demarrer pendant la relecture du catalogue :
    // son rafraichissement en place a alors change (ou disparu), et celui qu'on
    // tenait appartient au projet precedent.
    if (refreshChargeOnly !== refresh || !refreshChargeOnly) {
      reconcileAndLoad({ force: true });
      return;
    }
    refresh();
  }

  function handleContextTablesChanged(signal) {
    const tables = signal && Array.isArray(signal.tables) ? signal.tables : null;
    const route = refreshChargeOnly
      ? classifyContextSignal(
          tables,
          APP_CONFIG.grist.tables.timeSegment,
          APP_CONFIG.grist.tables.projects,
          APP_CONFIG.grist.tables.planningProject
        )
      : "full";

    if (route === "charge") {
      refreshChargeOnly();
      return;
    }

    if (route === "charge-si-catalogue-inchange") {
      refreshChargeUnlessCatalogChanged().catch((error) => {
        console.error("Verification du catalogue projets impossible :", error);
        reconcileAndLoad({ force: true });
      });
      return;
    }

    reconcileAndLoad({ force: true });
  }

  function handleAggregateToggle() {
    if (!planningRenderer || !controller) return;
    const aggregate = Boolean(els.aggregateToggle.checked);
    planningRenderer.setAggregate(aggregate);
    // The chart is available regardless of aggregate mode, so toggling aggregate no
    // longer changes the top view — it only re-aggregates the timeline. applyTopView
    // re-bounds the (visible) timeline height for the new row count.
    applyTopView();
    controller.setViewport(controller.getViewport());
  }

  // Show the Planning/Graphique switch whenever the project has planning data —
  // independent of the aggregate toggle (the chart is always available).
  function updateViewSwitchVisibility() {
    if (!(els.viewSwitch instanceof HTMLElement)) return;
    els.viewSwitch.hidden = !(Array.isArray(chartRows) && chartRows.length > 0);
  }

  function setTopView(view) {
    topView = view === "chart" ? "chart" : "planning";
    applyTopView();
  }

  // Swap the top pane between the timeline (#ps-planning) and the chart
  // (#ps-chart), reflect the active button, and (when showing the chart) size it
  // to the current top-pane height and render it for the current viewport.
  function applyTopView() {
    // The chart no longer depends on the aggregate toggle — it is shown whenever
    // the user selected the "Graphique" view.
    const chartActive = topView === "chart";

    if (els.planning instanceof HTMLElement) els.planning.hidden = chartActive;
    if (els.chart instanceof HTMLElement) els.chart.hidden = !chartActive;
    if (els.chartFilter instanceof HTMLElement) els.chartFilter.hidden = !chartActive;
    if (els.chartGranularity instanceof HTMLElement) els.chartGranularity.hidden = !chartActive;

    if (els.viewSwitch instanceof HTMLElement) {
      els.viewSwitch.querySelectorAll("[data-ps-view]").forEach((button) => {
        const isActive = button.dataset.psView === (chartActive ? "chart" : "planning");
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    if (chartActive && planningChart && controller) {
      const heightPx = lastTopPaneHeightPx || (els.planning ? els.planning.offsetHeight : 0) || 320;
      planningChart.setHeight(heightPx);
      planningChart.render({
        rows: chartRows,
        columns: chartColumns,
        viewport: controller.getViewport(),
      });
    } else if (!chartActive && topPaneResizer) {
      // Timeline is (re)shown: re-bound its height for the current row count, which
      // may have changed while it was hidden (e.g. an aggregate toggle). onRangeLabel's
      // own refresh is mode-gated and wouldn't catch a row-count change.
      topPaneResizer.refresh();
    }
  }

  function handleViewSwitchClick(event) {
    const button = event.target instanceof Element ? event.target.closest("[data-ps-view]") : null;
    if (!(button instanceof HTMLElement)) return;
    event.preventDefault();
    setTopView(button.dataset.psView === "chart" ? "chart" : "planning");
  }

  async function bootstrap() {
    try {
      initGrist();
    } catch (error) {
      console.error("Erreur initialisation Grist :", error);
    }

    let projectRows = [];
    try {
      projectRows = await fetchTableRows(APP_CONFIG.grist.tables.projects);
    } catch (error) {
      console.error("Erreur chargement Projets2 :", error);
    }

    state.registry = buildRegistry(projectRows, APP_CONFIG.grist.columns.projects);
    // Reference a laquelle comparer les signaux Projets2 a venir : sans elle, le
    // premier signal croirait voir un changement et rechargerait toute la page.
    projectRegistryFingerprint = projectRegistrySignature(state.registry);

    const pcp = APP_CONFIG.grist.columns.projects;
    realisationTargetLookup = buildProjectRealisationTargetLookup(
      (projectRows || []).map((row) => ({
        projectId: String(row?.id ?? ""),
        projectName: String(row?.[pcp.name] ?? ""),
        projectNumber: String(row?.[pcp.number] ?? ""),
        avancementConfigRaw: row?.[pcp.avancement],
      }))
    );

    populateProjectSelect();

    els.select.addEventListener("change", handleProjectSelectChange);
    if (els.aggregateToggle) {
      els.aggregateToggle.addEventListener("change", handleAggregateToggle);
    }
    if (els.viewSwitch) {
      els.viewSwitch.addEventListener("click", handleViewSwitchClick);
    }
    // Bouton "Charge" de la ligne Charge du board (Tache 3, [data-charge-assign-open]).
    // Delegue sur `els.charge` UNE SEULE FOIS ici (pas dans loadProject()) :
    // `els.charge` lui-meme n'est jamais remplace, seul son contenu l'est a
    // chaque `chargeBoard.render()` — un ecouteur pose directement sur le
    // bouton ne survivrait donc pas au premier re-rendu (cf. brief Tache 4).
    // `chargeAssignModal`/`currentPlanningRows` sont relus au moment du clic
    // (fermeture sur les `let` du scope englobant), toujours ceux du projet
    // courant meme si loadProject() les a recrees entre-temps.
    if (els.charge instanceof HTMLElement) {
      els.charge.addEventListener("click", (event) => {
        const target =
          event.target instanceof Element ? event.target.closest("[data-charge-assign-open]") : null;
        if (!(target instanceof HTMLElement)) return;
        event.preventDefault();
        if (!chargeAssignModal) return;
        chargeAssignModal.open({
          planningRows: currentPlanningRows,
          columns: APP_CONFIG.grist.columns.planningProject,
        });
      });
    }
    window.addEventListener("storage", handleStorageEvent);
    window.GristServiceContext?.onServiceChange?.(handleServiceChange);

    // Le planning synchronisé croise quatre tables, toutes éditées depuis
    // d'autres widgets. Sans cette liaison, une modification n'apparaîtrait
    // qu'après rechargement de la page. Le rappel est routé (cf.
    // handleContextTablesChanged) : un rappel inline réintroduirait le
    // rechargement complet inconditionnel après chaque écriture locale.
    const psTables = APP_CONFIG.grist.tables;
    window.GristServiceContext?.watchContextTables?.(
      [psTables.planningProject, psTables.projects, psTables.timeSegment, psTables.projectTeam],
      handleContextTablesChanged,
      {
        nativeSignalFilter: window.ProjectMutationSyncRelay?.acceptNativeSignalForCurrentProject,
        projectScopedSignals: true,
        acceptAnyNativeTableSignal: true,
      }
    );

    reconcileAndLoad({ force: true });
  }

  bootstrap().catch((error) => {
    console.error("Erreur initialisation planning-synchro :", error);
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapApp);
  } else {
    bootstrapApp();
  }
}
