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
import { initGrist, fetchTableRows, fetchProjectData } from "./services/gristService.js";
import {
  buildRegistry,
  resolveProject,
  readSharedSelection,
  writeSharedSelection,
} from "./services/projectRegistry.js";
import { getFirstPhaseDate, buildRowPhases, computePlanningPhaseBounds } from "./top/phases.js";
import { computeTimeSegmentBounds } from "./top/bounds.js";
import { createPlanningRenderer } from "./top/planningRenderer.js";
import { createPlanningChart } from "./top/planningChart.js";
import { createChargeBoard, buildWorkersFromSegments } from "./bottom/chargeBoard.js";
import { attachChargeEditing } from "./bottom/chargeEditing.js";
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
    viewSwitch: document.getElementById("ps-view-switch"),
    chart: document.getElementById("ps-chart"),
    chartCanvas: document.getElementById("ps-chart-canvas"),
    chartFilter: document.getElementById("ps-chart-filter"),
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

  // Top-pane view: "planning" (the read-only timeline) or "chart" (the task-load
  // graph). The chart view is only reachable when the aggregate toggle is on.
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
    teardown();

    state.selectedProject = project || null;

    if (!project) {
      els.empty.hidden = false;
      els.main.hidden = true;
      return;
    }

    let data = { planningRows: [], timeSegmentRows: [], projectTeamRows: [] };
    try {
      data = await fetchProjectData({ name: project.name, number: project.number });
    } catch (error) {
      console.error("Erreur chargement des donnees du projet :", error);
    }

    if (seq !== loadSeq) return; // superseded by a newer project switch

    const pc = APP_CONFIG.grist.columns;
    const { planningRows, timeSegmentRows, projectTeamRows } = data;
    const workerColumns = { timeSegment: pc.timeSegment, projectTeam: pc.projectTeam };

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

    planningRenderer = createPlanningRenderer(els.planning);
    chargeBoard = createChargeBoard(els.charge);
    planningChart = createPlanningChart(els.chartCanvas, els.chartFilter);
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

      chargeBoard.render({ workers, viewport, editMode: false });
    } else {
      // No TimeSegment data for this project: bottom pane stays empty, but
      // the top (Planning_Projet) pane must still render on a sane default
      // window instead of crashing — anchor on the first phase date (or
      // today) for ~1 month, per the task brief.
      els.chargeEmpty.hidden = false;
      els.charge.hidden = true;

      viewport = buildDefaultMonthViewport(firstPlanningDate);
      // No TimeSegment: the frise still spans the planning phases (builder bounds),
      // falling back to the phase-derived range when the builder yields none.
      controllerBounds = planBounds || computePlanningDerivedBounds(planningRows, pc.planningProject, viewport);
      chargeBoard.render({ workers: [], viewport, editMode: false });
    }

    controller = createSyncController({
      planningRenderer,
      chargeBoard,
      bounds: controllerBounds,
      onRangeLabel: (label, appliedViewport) => {
        if (els.range) els.range.textContent = label || "-";
        state.viewport = appliedViewport;
        persistViewport(appliedViewport, state.selectedProject);
        // The top-axis band height changes with the zoom mode (week/month/year),
        // so recompute the top pane's bounded height after every viewport apply.
        if (topPaneResizer) topPaneResizer.refresh();
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
    controller.bindPan(els.planning);
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

    editing = attachChargeEditing(els.charge, {
      getProjectNumber: () => project.number,
      getVisibleSlots: () => (chargeBoard ? chargeBoard.getVisibleSlots() : []),
      editSegmentModalEl: els.editModal,
      onChanged: async () => {
        if (seq !== loadSeq || !chargeBoard || !controller) return;

        let refreshed;
        try {
          refreshed = await fetchProjectData({ name: project.name, number: project.number });
        } catch (error) {
          console.error("Erreur rechargement du plan de charge :", error);
          return;
        }
        if (seq !== loadSeq || !chargeBoard || !controller) return;

        const nextWorkers = buildWorkersFromSegments(
          refreshed.timeSegmentRows,
          refreshed.projectTeamRows,
          workerColumns
        );
        const nextBounds = computeTimeSegmentBounds(refreshed.timeSegmentRows, pc.timeSegment);

        if (nextBounds) {
          els.chargeEmpty.hidden = true;
          els.charge.hidden = false;
        } else {
          els.chargeEmpty.hidden = false;
          els.charge.hidden = true;
        }

        // Preserve the sticky edit mode across the post-write re-render:
        // chargeEditing.persistWrite() re-asserts editModeEnabled synchronously
        // in its finally, but this render() (and the controller's follow-up rAF
        // re-render below, which reuses chargeBoard.lastEditMode) would reset it
        // to locked if we hardcoded false here. Read the live flag from the
        // editing controller so ONE source of truth drives both.
        const currentEditMode = editing ? editing.isEditModeEnabled() : false;
        chargeBoard.render({ workers: nextWorkers, viewport: controller.getViewport(), editMode: currentEditMode });
        controller.setViewport(controller.getViewport());
      },
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

  function handleAggregateToggle() {
    if (!planningRenderer || !controller) return;
    const aggregate = Boolean(els.aggregateToggle.checked);
    planningRenderer.setAggregate(aggregate);
    // The "Graphique" view is only offered in aggregate mode; leaving aggregate
    // forces back to the planning (timeline) view.
    if (!aggregate) topView = "planning";
    updateViewSwitchVisibility();
    applyTopView();
    controller.setViewport(controller.getViewport());
  }

  // Show the Planning/Graphique switch only while the aggregate toggle is on.
  function updateViewSwitchVisibility() {
    if (!(els.viewSwitch instanceof HTMLElement)) return;
    els.viewSwitch.hidden = !(els.aggregateToggle && els.aggregateToggle.checked);
  }

  function setTopView(view) {
    topView = view === "chart" ? "chart" : "planning";
    applyTopView();
  }

  // Swap the top pane between the timeline (#ps-planning) and the chart
  // (#ps-chart), reflect the active button, and (when showing the chart) size it
  // to the current top-pane height and render it for the current viewport.
  function applyTopView() {
    const chartActive = topView === "chart" && els.aggregateToggle && els.aggregateToggle.checked;

    if (els.planning instanceof HTMLElement) els.planning.hidden = chartActive;
    if (els.chart instanceof HTMLElement) els.chart.hidden = !chartActive;
    if (els.chartFilter instanceof HTMLElement) els.chartFilter.hidden = !chartActive;

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
    window.addEventListener("storage", handleStorageEvent);

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
