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
import { getFirstPhaseDate, buildRowPhases } from "./top/phases.js";
import { computeTimeSegmentBounds } from "./top/bounds.js";
import { createPlanningRenderer } from "./top/planningRenderer.js";
import { createChargeBoard, buildWorkersFromSegments } from "./bottom/chargeBoard.js";
import { attachChargeEditing } from "./bottom/chargeEditing.js";
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
    charge: document.getElementById("ps-charge"),
    chargeEmpty: document.getElementById("ps-charge-empty"),
    aggregateToggle: document.getElementById("ps-aggregate-toggle"),
    range: document.getElementById("ps-range"),
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
  let chargeBoard = null;
  let controller = null;
  let editing = null;
  let loadSeq = 0;
  let lastAppliedSelectionKey = "";

  function teardown() {
    if (editing) {
      editing.detach();
      editing = null;
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

    planningRenderer = createPlanningRenderer(els.planning);
    chargeBoard = createChargeBoard(els.charge);

    const aggregate = Boolean(els.aggregateToggle && els.aggregateToggle.checked);
    planningRenderer.render({ rows: planningRows, columns: pc.planningProject, aggregate });

    let viewport;
    let controllerBounds;

    if (bounds) {
      els.chargeEmpty.hidden = true;
      els.charge.hidden = false;
      controllerBounds = bounds;

      const initialViewport = buildInitialProjectViewport({ firstPlanningDate, bounds });
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
        viewportFitsWithinBounds(persisted.viewport, bounds);
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
      controllerBounds = computePlanningDerivedBounds(planningRows, pc.planningProject, viewport);
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
      },
    });

    controller.bindToolbar(els.toolbar);
    controller.bindWheel(els.main);
    controller.setViewport(viewport);

    editing = attachChargeEditing(els.charge, {
      getProjectNumber: () => project.number,
      getVisibleSlots: () => (chargeBoard ? chargeBoard.getVisibleSlots() : []),
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

        chargeBoard.render({ workers: nextWorkers, viewport: controller.getViewport(), editMode: false });
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
    planningRenderer.setAggregate(Boolean(els.aggregateToggle.checked));
    controller.setViewport(controller.getViewport());
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
    populateProjectSelect();

    els.select.addEventListener("change", handleProjectSelectChange);
    if (els.aggregateToggle) {
      els.aggregateToggle.addEventListener("change", handleAggregateToggle);
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
