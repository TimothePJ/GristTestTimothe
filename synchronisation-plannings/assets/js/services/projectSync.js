import { getReferencePlanningApi, state } from "../app/state.js";
import {
  scheduleExpensesFramePresentation,
  scheduleOverviewFramePresentation,
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
  buildCanonicalSharedViewport,
  buildPlanningLedProjectSelectionViewport,
  buildProjectSelectionViewport,
  normalizeProjectDateBounds,
} from "../viewport/build.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import {
  getViewportLogicalSignature,
  normalizeProjectKey,
} from "../viewport/normalize.js";
import { flushViewportSyncQueue } from "./viewportSync.js";

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
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

export function clearSharedProjectSelection() {
  const requestId = ++state.projectSyncRequestId;
  state.activeProjectKey = "";
  state.requestedProjectKey = "";
  state.allowChildProjectSelectionSync = false;
  state.lastPlanningWarningsPopupSignature = "";
  state.lastAppliedViewportLogicalSignature = "";
  state.sharedViewportState = null;
  state.sharedToolbarActionInProgress = false;
  state.pendingViewportPayload = null;
  state.projectSyncInProgress = true;
  closePlanningWarningsPopup();
  setActiveProjectSelection("");
  setProjectContentVisibility(false);
  setLastSource("");
  setLastRange(null);
  setSelectionWarning(null);
  syncExpensesPlanningShell(null);
  setHubStatus("Choisis un projet pour afficher les plannings.");
  syncSharedPlanningControlsAvailability();

  const clearCalls = [
    Promise.resolve(state.planningApi?.setSelectedProject?.("")),
    Promise.resolve(state.planningAxisApi?.setSelectedProject?.("")),
    Promise.resolve(state.overviewApi?.setSelectedProject?.("")),
    Promise.resolve(state.expensesApi?.setSelectedProject?.("")),
  ];

  Promise.allSettled(clearCalls)
    .then(() => {
      if (requestId !== state.projectSyncRequestId) {
        return;
      }

      scheduleOverviewFramePresentation();
      scheduleExpensesFramePresentation();
    })
    .finally(() => {
      if (requestId !== state.projectSyncRequestId) {
        return;
      }

      state.projectSyncInProgress = false;
      syncSharedPlanningControlsAvailability();
      void flushViewportSyncQueue();
    });
}

export async function applySharedProject(projectKey) {
  const normalizedProjectKey = String(projectKey || "").trim();
  if (!normalizedProjectKey || !state.planningApi) {
    return;
  }

  const requestId = ++state.projectSyncRequestId;
  state.requestedProjectKey = normalizedProjectKey;
  state.allowChildProjectSelectionSync = true;
  state.lastPlanningWarningsPopupSignature = "";
  closePlanningWarningsPopup();
  state.projectSyncInProgress = true;
  state.pendingViewportPayload = null;
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);
  setActiveProjectSelection(normalizedProjectKey);
  setProjectContentVisibility(true);
  syncSharedPlanningControlsAvailability();

  try {
    scheduleOverviewFramePresentation();
    scheduleExpensesFramePresentation();
    await waitForAnimationFrame();
    if (
      requestId !== state.projectSyncRequestId ||
      normalizeProjectKey(state.requestedProjectKey) !== normalizeProjectKey(normalizedProjectKey)
    ) {
      return;
    }

    const projectApplyCalls = [
      Promise.resolve(state.planningApi.setSelectedProject(normalizedProjectKey)),
      Promise.resolve(state.planningAxisApi?.setSelectedProject?.(normalizedProjectKey)),
    ];

    if (state.overviewApi?.setSelectedProject) {
      projectApplyCalls.push(Promise.resolve(state.overviewApi.setSelectedProject(normalizedProjectKey)));
    }
    if (state.expensesApi?.setSelectedProject) {
      projectApplyCalls.push(Promise.resolve(state.expensesApi.setSelectedProject(normalizedProjectKey)));
    }
    await Promise.all(projectApplyCalls);
    if (
      requestId !== state.projectSyncRequestId ||
      normalizeProjectKey(state.requestedProjectKey) !== normalizeProjectKey(normalizedProjectKey)
    ) {
      return;
    }

    state.activeProjectKey = normalizedProjectKey;
    setActiveProjectSelection(normalizedProjectKey);
    scheduleOverviewFramePresentation();
    scheduleExpensesFramePresentation();

    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    let focusedPlanningViewport = null;
    if (referencePlanningApi?.focusDataAnchor) {
      focusedPlanningViewport = await Promise.resolve(referencePlanningApi.focusDataAnchor());
    } else if (state.planningApi?.focusDataAnchor) {
      focusedPlanningViewport = await Promise.resolve(state.planningApi.focusDataAnchor());
    }
    if (
      requestId !== state.projectSyncRequestId ||
      normalizeProjectKey(state.requestedProjectKey) !== normalizeProjectKey(normalizedProjectKey)
    ) {
      return;
    }

    const planningProjectDateBounds =
      referencePlanningApi.getProjectDateBounds?.() || state.planningApi.getProjectDateBounds?.() || null;
    const expensesProjectDateBounds = state.expensesApi?.getProjectDateBounds?.() || null;
    const referenceProjectDateBounds =
      normalizeProjectDateBounds(planningProjectDateBounds) ||
      normalizeProjectDateBounds(expensesProjectDateBounds);
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
      state.expensesApi?.getViewport?.() ||
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
      if (
        requestId !== state.projectSyncRequestId ||
        normalizeProjectKey(state.requestedProjectKey) !== normalizeProjectKey(normalizedProjectKey)
      ) {
        return;
      }

      if (state.expensesApi) {
        const stabilizedViewport = await alignExpensesViewportToPlanning(sharedViewport, {
          onAfterApply: () => scheduleExpensesFramePresentation(),
        });
        if (
          requestId !== state.projectSyncRequestId ||
          normalizeProjectKey(state.requestedProjectKey) !== normalizeProjectKey(normalizedProjectKey)
        ) {
          return;
        }

        if (stabilizedViewport?.firstVisibleDate) {
          sharedViewport = buildCanonicalSharedViewport({
            ...sharedViewport,
            ...stabilizedViewport,
          });
        }
      }

      state.lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        sharedViewport
      );
      state.sharedViewportState = sharedViewport;
      setLastRange(sharedViewport);
      syncExpensesPlanningShell(sharedViewport);
      scheduleExpensesFramePresentation();
    }

    setLastSource(getViewportSourceLabel("Pilotage commun"));
    setHubStatus(`Projet synchronise : ${normalizedProjectKey}`);
    appendLog(`Projet partage applique : ${normalizedProjectKey}`);
  } finally {
    if (requestId === state.projectSyncRequestId) {
      state.projectSyncInProgress = false;
      syncSharedPlanningControlsAvailability();
      void flushViewportSyncQueue();
    }
  }
}
