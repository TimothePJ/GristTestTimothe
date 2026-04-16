import { PROJECT_SELECTION_STABILIZE_DELAY_MS } from "../app/constants.js";
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
  normalizeIsoDate,
  shiftIsoDateValue,
} from "../viewport/normalize.js";
import { flushViewportSyncQueue } from "./viewportSync.js";

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getViewportDateBounds(viewport = {}) {
  const startDate = normalizeIsoDate(
    viewport?.firstVisibleDate || viewport?.rangeStartDate || viewport?.anchorDate
  );
  const explicitEndDate = normalizeIsoDate(viewport?.rangeEndDate);
  const visibleDays = Number(viewport?.visibleDays);
  const derivedEndDate =
    startDate && Number.isFinite(visibleDays) && visibleDays > 0
      ? shiftIsoDateValue(startDate, Math.max(0, Math.round(visibleDays) - 1))
      : "";
  const endDate = explicitEndDate || derivedEndDate || startDate;

  if (!startDate || !endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
  };
}

function dateBoundsIntersect(leftBounds = null, rightBounds = null) {
  if (!leftBounds?.startDate || !leftBounds?.endDate || !rightBounds?.startDate || !rightBounds?.endDate) {
    return false;
  }

  return !(leftBounds.endDate < rightBounds.startDate || leftBounds.startDate > rightBounds.endDate);
}

function isViewportConsistentWithProjectBounds(viewport = {}, projectDateBounds = null) {
  const normalizedProjectDateBounds = normalizeProjectDateBounds(projectDateBounds);
  if (!normalizedProjectDateBounds) {
    return true;
  }

  const viewportDateBounds = getViewportDateBounds(viewport);
  if (!viewportDateBounds) {
    return false;
  }

  return dateBoundsIntersect(viewportDateBounds, {
    startDate: shiftIsoDateValue(normalizedProjectDateBounds.startDate, -31),
    endDate: shiftIsoDateValue(normalizedProjectDateBounds.endDate, 31),
  });
}

export function clearSharedProjectSelection() {
  state.activeProjectKey = "";
  state.requestedProjectKey = "";
  state.allowChildProjectSelectionSync = false;
  state.lastPlanningWarningsPopupSignature = "";
  state.lastAppliedViewportLogicalSignature = "";
  state.sharedViewportState = null;
  state.sharedToolbarActionInProgress = false;
  closePlanningWarningsPopup();
  setActiveProjectSelection("");
  setProjectContentVisibility(false);
  setLastSource("");
  setLastRange(null);
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
  state.allowChildProjectSelectionSync = true;
  state.lastPlanningWarningsPopupSignature = "";
  closePlanningWarningsPopup();
  state.projectSyncInProgress = true;
  state.pendingViewportPayload = null;
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);
  syncSharedPlanningControlsAvailability();

  try {
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
    state.activeProjectKey = normalizedProjectKey;
    setActiveProjectSelection(normalizedProjectKey);
    setProjectContentVisibility(true);
    scheduleOverviewFramePresentation();
    scheduleExpensesFramePresentation();
    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    const planningProjectDateBounds =
      referencePlanningApi.getProjectDateBounds?.() || state.planningApi.getProjectDateBounds?.() || null;
    const expensesProjectDateBounds = state.expensesApi?.getProjectDateBounds?.() || null;
    const referenceProjectDateBounds =
      normalizeProjectDateBounds(planningProjectDateBounds) ||
      normalizeProjectDateBounds(expensesProjectDateBounds);
    const planningViewportAfterProjectSelection =
      referencePlanningApi.getViewport?.() || state.planningApi.getViewport?.() || null;
    const selectionFallbackViewport =
      planningViewportAfterProjectSelection ||
      state.sharedViewportState ||
      state.expensesApi?.getViewport?.() ||
      {};
    let sharedViewport = buildPlanningLedProjectSelectionViewport(
      planningViewportAfterProjectSelection || {},
      selectionFallbackViewport
    );
    if (!sharedViewport?.firstVisibleDate) {
      sharedViewport = buildProjectSelectionViewport(
        referenceProjectDateBounds,
        selectionFallbackViewport
      );
    }
    if (sharedViewport?.firstVisibleDate) {
      const initialViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        sharedViewport
      );
      syncPlanningViewportBounds(sharedViewport);
      await Promise.all([
        Promise.resolve(state.planningApi.applyViewport(sharedViewport)),
        Promise.resolve(state.planningAxisApi?.applyViewport?.(sharedViewport)),
      ]);

      await sleep(PROJECT_SELECTION_STABILIZE_DELAY_MS);
      const planningViewportAfterSelection = referencePlanningApi.getViewport?.() || null;
      const stabilizedPlanningViewport = buildPlanningLedProjectSelectionViewport(
        planningViewportAfterSelection || {},
        sharedViewport
      );
      const stabilizedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        stabilizedPlanningViewport
      );
      const shouldTrustStabilizedViewport = isViewportConsistentWithProjectBounds(
        stabilizedPlanningViewport,
        referenceProjectDateBounds
      );

      if (shouldTrustStabilizedViewport) {
        sharedViewport = stabilizedPlanningViewport;
      } else {
        console.warn("[sync] viewport planning stabilise ignore car hors plage projet", {
          projectKey: normalizedProjectKey,
          selectedProjectDateBounds: referenceProjectDateBounds,
          stabilizedPlanningViewport,
        });
        appendLog(`Viewport planning ignore pour ${normalizedProjectKey} : plage hors projet`);
      }

      if (
        shouldTrustStabilizedViewport &&
        stabilizedViewportLogicalSignature &&
        stabilizedViewportLogicalSignature !== initialViewportLogicalSignature
      ) {
        syncPlanningViewportBounds(sharedViewport);
        await Promise.all([
          Promise.resolve(state.planningApi.applyViewport(sharedViewport)),
          Promise.resolve(state.planningAxisApi?.applyViewport?.(sharedViewport)),
        ]);
      }

      if (state.expensesApi) {
        const stabilizedViewport = await alignExpensesViewportToPlanning(sharedViewport, {
          onAfterApply: () => scheduleExpensesFramePresentation(),
        });
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
    state.projectSyncInProgress = false;
    syncSharedPlanningControlsAvailability();
    void flushViewportSyncQueue();
  }
}
