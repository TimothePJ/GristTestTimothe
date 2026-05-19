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

let expensesProjectSyncSequence = 0;

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
  state.activeProjectKey = "";
  state.requestedProjectKey = "";
  state.lastPlanningWarningsPopupSignature = "";
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

  state.requestedProjectKey = normalizedProjectKey;
  state.lastPlanningWarningsPopupSignature = "";
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
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();

    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    let focusedPlanningViewport = null;
    if (referencePlanningApi?.focusDataAnchor) {
      focusedPlanningViewport = await Promise.resolve(referencePlanningApi.focusDataAnchor());
    } else if (state.planningApi?.focusDataAnchor) {
      focusedPlanningViewport = await Promise.resolve(state.planningApi.focusDataAnchor());
    }
    const planningProjectDateBounds =
      referencePlanningApi.getProjectDateBounds?.() || state.planningApi.getProjectDateBounds?.() || null;
    const referenceProjectDateBounds = normalizeProjectDateBounds(planningProjectDateBounds);
    const planningViewportAfterProjectSelection =
      focusedPlanningViewport ||
      referencePlanningApi.getViewport?.() ||
      state.planningApi.getViewport?.() ||
      null;
    const planningSelectionAnchorViewport = buildPlanningSelectionAnchorViewport(
      planningViewportAfterProjectSelection || {}
    );
    const selectionFallbackViewport =
      state.sharedViewportState ||
      planningViewportAfterProjectSelection ||
      {};
    let sharedViewport = buildPlanningLedProjectSelectionViewport(
      planningSelectionAnchorViewport,
      selectionFallbackViewport
    );
    if (!sharedViewport?.firstVisibleDate) {
      sharedViewport = buildProjectSelectionViewport(
        referenceProjectDateBounds,
        selectionFallbackViewport
      );
    }

    if (sharedViewport?.firstVisibleDate) {
      syncPlanningViewportBounds(sharedViewport);
      await Promise.all([
        Promise.resolve(state.planningApi.applyViewport(sharedViewport)),
        Promise.resolve(state.planningAxisApi?.applyViewport?.(sharedViewport)),
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
