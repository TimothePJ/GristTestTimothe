import { PROJECT_SELECTION_STABILIZE_DELAY_MS } from "../app/constants.js";
import { getReferencePlanningApi, state } from "../app/state.js";
import {
  scheduleExpensesChartFramePresentation,
  scheduleExpensesFramePresentation,
  scheduleOverviewFramePresentation,
} from "../layout/framePresentation.js";
import {
  appendLog,
  closePlanningWarningsPopup,
  getViewportSourceLabel,
  setHubStatus,
  setLastRange,
  setLastSource,
  syncExpensesPlanningShell,
} from "../layout/shell.js";
import { alignExpensesViewportToPlanning } from "../viewport/alignment.js";
import {
  buildCanonicalSharedViewport,
  buildProjectSelectionViewport,
  buildSharedProjectDateBounds,
} from "../viewport/build.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import { getViewportLogicalSignature } from "../viewport/normalize.js";
import { flushViewportSyncQueue } from "./viewportSync.js";

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

    if (state.expensesChartApi?.setSelectedProject) {
      projectApplyCalls.push(
        Promise.resolve(state.expensesChartApi.setSelectedProject(normalizedProjectKey))
      );
    }

    await Promise.all(projectApplyCalls);
    state.activeProjectKey = normalizedProjectKey;
    scheduleOverviewFramePresentation();
    scheduleExpensesFramePresentation();
    scheduleExpensesChartFramePresentation();
    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    const planningProjectDateBounds =
      referencePlanningApi.getProjectDateBounds?.() || state.planningApi.getProjectDateBounds?.() || null;
    const expensesProjectDateBounds = state.expensesApi?.getProjectDateBounds?.() || null;
    let sharedViewport = buildProjectSelectionViewport(
      buildSharedProjectDateBounds({
        planningDateBounds: planningProjectDateBounds,
        expensesDateBounds: expensesProjectDateBounds,
      }),
      state.expensesApi?.getViewport?.() ||
        referencePlanningApi.getViewport?.() ||
        state.planningApi.getViewport?.() ||
        {}
    );
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
      const stabilizedPlanningViewport = buildCanonicalSharedViewport({
        ...sharedViewport,
        ...(planningViewportAfterSelection || {}),
        firstVisibleDate:
          planningViewportAfterSelection?.firstVisibleDate ||
          planningViewportAfterSelection?.rangeStartDate ||
          sharedViewport.firstVisibleDate,
        rangeStartDate:
          planningViewportAfterSelection?.firstVisibleDate ||
          planningViewportAfterSelection?.rangeStartDate ||
          sharedViewport.rangeStartDate,
        visibleDays:
          Number(planningViewportAfterSelection?.visibleDays) || sharedViewport.visibleDays,
        mode: String(planningViewportAfterSelection?.mode || sharedViewport.mode || "").trim(),
        anchorDate:
          planningViewportAfterSelection?.anchorDate ||
          planningViewportAfterSelection?.firstVisibleDate ||
          sharedViewport.anchorDate,
      });
      const stabilizedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        stabilizedPlanningViewport
      );

      sharedViewport = stabilizedPlanningViewport;
      if (
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
    void flushViewportSyncQueue();
  }
}
