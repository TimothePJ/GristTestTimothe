import { getReferencePlanningApi, state } from "../app/state.js";
import {
  scheduleExpensesFramePresentation,
  schedulePlanningFramePresentation,
} from "../layout/framePresentation.js";
import {
  appendLog,
  closePlanningWarningsPopup,
  setActiveProjectSelection,
  getViewportSourceLabel,
  setProjectContentVisibility,
  setHubStatus,
  setLastRange,
  setLastSource,
  setSelectionWarning,
  syncSharedPlanningControlsAvailability,
  syncExpensesPlanningShell,
} from "../layout/shell.js";
import { alignExpensesViewportToPlanning } from "../viewport/alignment.js";
import {
  buildPlanningLedProjectSelectionViewport,
  buildProjectSelectionViewport,
  buildSharedProjectDateBounds,
  normalizeProjectDateBounds,
} from "../viewport/build.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import {
  getViewportLogicalSignature,
} from "../viewport/normalize.js";
import { showCurrentPlanningWarningsPopup } from "./planningWarnings.js";
import { flushViewportSyncQueue } from "./viewportSync.js";

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function wait(ms = 0) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

let expensesProjectSyncSequence = 0;
const SHARED_PROJECT_STORAGE_KEY = "grist.selected-project";
const SHARED_PROJECT_STORAGE_FALLBACK_KEYS = [
  SHARED_PROJECT_STORAGE_KEY,
  "LP_LAST_PROJECT_LABEL",
  "nouveau-projet.selected-project",
];

export function readSharedProjectSelection() {
  try {
    for (const key of SHARED_PROJECT_STORAGE_FALLBACK_KEYS) {
      const value = String(localStorage.getItem(key) || "").trim();
      if (value) return value;
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function saveSharedProjectSelection(projectKey = "") {
  try {
    const normalizedProject = String(projectKey || "").trim();
    if (normalizedProject) {
      localStorage.setItem(SHARED_PROJECT_STORAGE_KEY, normalizedProject);
    } else {
      localStorage.removeItem(SHARED_PROJECT_STORAGE_KEY);
    }
  } catch (_error) {
    // localStorage peut etre indisponible dans certains contextes embarques.
  }
}

function buildPlanningSelectionAnchorViewport(viewport = {}) {
  if (!viewport || typeof viewport !== "object") {
    return {};
  }

  return {
    ...viewport,
    mode: "",
    visibleDays: Number.NaN,
    rangeEndDate: "",
    windowStartMs: null,
    windowEndMs: null,
    leftDayOffset: null,
    rightDayOffset: null,
    exactVisibleDays: null,
    contentStartDate: "",
    contentStartMs: null,
  };
}

function getSynchronizedProjectDateBounds(referencePlanningApi) {
  const planningProjectDateBounds =
    referencePlanningApi?.getProjectDateBounds?.() ||
    state.planningApi?.getProjectDateBounds?.() ||
    null;
  const expensesProjectDateBounds = state.expensesApi?.getProjectDateBounds?.() || null;

  return buildSharedProjectDateBounds({
    planningDateBounds: normalizeProjectDateBounds(planningProjectDateBounds),
    expensesDateBounds: normalizeProjectDateBounds(expensesProjectDateBounds),
  });
}

async function waitForSynchronizedProjectDateBounds(referencePlanningApi) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const projectDateBounds = getSynchronizedProjectDateBounds(referencePlanningApi);
    if (projectDateBounds?.startDate) {
      return projectDateBounds;
    }

    await wait(attempt < 4 ? 80 : 150);
  }

  return getSynchronizedProjectDateBounds(referencePlanningApi);
}

function syncExpensesProjectWhenReady(projectKey = "", viewport = null) {
  const expensesApi = state.expensesApi;
  const normalizedProjectKey = String(projectKey || "").trim();
  if (!normalizedProjectKey || !expensesApi) {
    return;
  }

  const syncSequence = ++expensesProjectSyncSequence;
  Promise.resolve()
    .then(async () => {
      if (expensesApi.setSelectedProject) {
        await Promise.resolve(expensesApi.setSelectedProject(normalizedProjectKey));
      }

      if (
        syncSequence !== expensesProjectSyncSequence ||
        String(state.activeProjectKey || "").trim() !== normalizedProjectKey
      ) {
        return;
      }

      if (viewport?.firstVisibleDate) {
        await alignExpensesViewportToPlanning(viewport, {
          onAfterApply: () => scheduleExpensesFramePresentation(),
        });
      }

      scheduleExpensesFramePresentation();
    })
    .catch((error) => {
      console.error("Erreur synchronisation differee gestion-depenses2 :", error);
      appendLog(`Erreur synchro gestion-depenses2 : ${error.message}`);
    });
}

export function clearSharedProjectSelection() {
  saveSharedProjectSelection("");
  state.activeProjectKey = "";
  state.requestedProjectKey = "";
  state.lastPlanningWarningsPopupSignature = "";
  state.pendingPlanningWarningsPopupProjectKey = "";
  state.lastAppliedViewportLogicalSignature = "";
  state.sharedViewportState = null;
  state.sharedToolbarActionInProgress = false;
  closePlanningWarningsPopup();
  setActiveProjectSelection("");
  setProjectContentVisibility(false);
  setLastSource("");
  setLastRange(null);
  setSelectionWarning(null);
  syncExpensesPlanningShell(null);
  setHubStatus("Choisis un projet pour afficher les plannings.");
  syncSharedPlanningControlsAvailability();
}

export async function applySharedProject(projectKey) {
  const normalizedProjectKey = String(projectKey || "").trim();
  if (!normalizedProjectKey || !state.planningApi) {
    return;
  }

  saveSharedProjectSelection(normalizedProjectKey);
  state.requestedProjectKey = normalizedProjectKey;
  state.lastPlanningWarningsPopupSignature = "";
  state.pendingPlanningWarningsPopupProjectKey = normalizedProjectKey;
  closePlanningWarningsPopup();
  state.projectSyncInProgress = true;
  state.pendingViewportPayload = null;
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);
  setActiveProjectSelection(normalizedProjectKey);
  setProjectContentVisibility(true);
  syncSharedPlanningControlsAvailability();

  try {
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    await waitForAnimationFrame();

    const projectApplyCalls = [
      Promise.resolve(state.planningApi.setSelectedProject(normalizedProjectKey)),
      Promise.resolve(state.planningAxisApi?.setSelectedProject?.(normalizedProjectKey)),
    ];

    await Promise.all(projectApplyCalls);
    state.activeProjectKey = normalizedProjectKey;
    setActiveProjectSelection(normalizedProjectKey);

    if (state.expensesApi?.setSelectedProject) {
      await Promise.resolve(state.expensesApi.setSelectedProject(normalizedProjectKey));
    }

    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    await waitForAnimationFrame();

    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    const referenceProjectDateBounds = await waitForSynchronizedProjectDateBounds(
      referencePlanningApi
    );
    let focusedPlanningViewport = null;
    if (referencePlanningApi?.focusDataAnchor) {
      focusedPlanningViewport = await Promise.resolve(referencePlanningApi.focusDataAnchor());
    } else if (state.planningApi?.focusDataAnchor) {
      focusedPlanningViewport = await Promise.resolve(state.planningApi.focusDataAnchor());
    }
    const planningViewportAfterProjectSelection =
      focusedPlanningViewport ||
      referencePlanningApi.getViewport?.() ||
      state.planningApi.getViewport?.() ||
      null;
    const planningSelectionAnchorViewport = buildPlanningSelectionAnchorViewport(
      planningViewportAfterProjectSelection || {}
    );
    const selectionFallbackViewport =
      referenceProjectDateBounds?.startDate
        ? {}
        : state.sharedViewportState ||
          planningViewportAfterProjectSelection ||
          {};
    let sharedViewport = buildProjectSelectionViewport(
      referenceProjectDateBounds,
      selectionFallbackViewport
    );
    if (!sharedViewport?.firstVisibleDate) {
      sharedViewport = buildPlanningLedProjectSelectionViewport(
        planningSelectionAnchorViewport,
        selectionFallbackViewport
      );
    }

    if (sharedViewport?.firstVisibleDate) {
      syncPlanningViewportBounds(sharedViewport);
      await Promise.all([
        Promise.resolve(state.planningApi.applyViewport(sharedViewport)),
        Promise.resolve(state.planningAxisApi?.applyViewport?.(sharedViewport)),
        Promise.resolve(state.expensesApi?.applyViewport?.(sharedViewport)),
      ]);

      state.lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        sharedViewport
      );
      state.sharedViewportState = sharedViewport;
      setLastRange(sharedViewport);
      syncExpensesPlanningShell(sharedViewport);
      schedulePlanningFramePresentation();
      scheduleExpensesFramePresentation();
    }

    syncExpensesProjectWhenReady(normalizedProjectKey, sharedViewport);
    showCurrentPlanningWarningsPopup({ force: true });

    setLastSource(getViewportSourceLabel("Pilotage commun"));
    setHubStatus(`Projet synchronise : ${normalizedProjectKey}`);
    appendLog(`Projet partage applique : ${normalizedProjectKey}`);
  } finally {
    state.projectSyncInProgress = false;
    syncSharedPlanningControlsAvailability();
    void flushViewportSyncQueue();
  }
}
