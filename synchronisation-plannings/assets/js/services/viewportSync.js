import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
import { scheduleExpensesChartFramePresentation, scheduleExpensesFramePresentation } from "../layout/framePresentation.js";
import {
  appendLog,
  getViewportSourceApi,
  getViewportSourceLabel,
  getViewportTargetApis,
  setHubStatus,
  setLastRange,
  setLastSource,
  syncExpensesPlanningShell,
} from "../layout/shell.js";
import {
  buildCanonicalSharedViewport,
  buildPlanningExactSharedViewport,
  getCurrentSharedViewport,
} from "../viewport/build.js";
import { getTargetVisibleDaysForMode, syncPlanningViewportBounds } from "../viewport/bounds.js";
import {
  getViewportLogicalSignature,
  normalizeIsoDate,
  normalizeProjectKey,
} from "../viewport/normalize.js";

export async function applyViewportFromParentControls(viewport = {}) {
  if (!state.planningApi || state.projectSyncInProgress || state.viewportSyncInProgress) {
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportLogicalSignature = getViewportLogicalSignature(state.activeProjectKey, canonicalViewport);
  state.viewportSyncInProgress = true;

  try {
    const applyCalls = [
      Promise.resolve(state.planningApi.applyViewport(canonicalViewport)),
      Promise.resolve(state.planningAxisApi?.applyViewport?.(canonicalViewport)),
    ];

    if (state.expensesApi?.applyViewport) {
      applyCalls.push(Promise.resolve(state.expensesApi.applyViewport(canonicalViewport)));
    }

    await Promise.all(applyCalls);

    state.lastAppliedViewportLogicalSignature = viewportLogicalSignature;
    state.sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    setLastSource(getViewportSourceLabel("Pilotage commun"));
    setLastRange(canonicalViewport);
    setHubStatus("Synchro active depuis Pilotage commun");
    appendLog(
      `pilotage commun -> ${canonicalViewport.firstVisibleDate || "?"} / ${
        canonicalViewport.rangeEndDate || "?"
      } / ${canonicalViewport.mode || "?"}`
    );
  } catch (error) {
    console.error("Erreur controle planning synchronise :", error);
    setHubStatus(`Erreur pilotage : ${error.message}`);
    appendLog(`Erreur pilotage : ${error.message}`);
  } finally {
    state.viewportSyncInProgress = false;
    if (state.pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

export function shiftViewportByMode(viewport = {}, direction = 1) {
  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  const baseDateValue =
    normalizeIsoDate(canonicalViewport.firstVisibleDate) ||
    normalizeIsoDate(canonicalViewport.rangeStartDate);
  if (!baseDateValue) {
    return canonicalViewport;
  }

  const baseDate = new Date(`${baseDateValue}T12:00:00`);
  if (Number.isNaN(baseDate.getTime())) {
    return canonicalViewport;
  }

  const safeDirection = direction >= 0 ? 1 : -1;
  const nextDate = new Date(baseDate);
  const mode = String(canonicalViewport.mode || "").trim();

  if (mode === "week") {
    nextDate.setDate(nextDate.getDate() + safeDirection * 7);
  } else if (mode === "month") {
    nextDate.setMonth(nextDate.getMonth() + safeDirection);
  } else if (mode === "year") {
    nextDate.setFullYear(nextDate.getFullYear() + safeDirection);
  } else {
    nextDate.setDate(nextDate.getDate() + safeDirection * canonicalViewport.visibleDays);
  }

  const nextDateValue = normalizeIsoDate(
    `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(
      nextDate.getDate()
    ).padStart(2, "0")}`
  );

  return buildCanonicalSharedViewport({
    ...canonicalViewport,
    anchorDate: nextDateValue,
    firstVisibleDate: nextDateValue,
    rangeStartDate: nextDateValue,
    rangeEndDate: "",
  });
}

export function bindExpensesPlanningShellControls() {
  dom.expensesModeButtons.forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const nextMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
      if (!nextMode) {
        return;
      }

      if (state.planningAxisApi?.setZoomMode) {
        state.planningAxisApi.setZoomMode(nextMode);
        return;
      }

      const currentViewport = getCurrentSharedViewport();
      if (!currentViewport) {
        return;
      }

      void applyViewportFromParentControls({
        ...currentViewport,
        mode: nextMode,
        visibleDays: getTargetVisibleDaysForMode(nextMode, currentViewport),
        rangeEndDate: "",
      });
    });
  });

  dom.sharedPrevBtnEl?.addEventListener("click", () => {
    if (state.planningAxisApi?.moveViewportByMode) {
      state.planningAxisApi.moveViewportByMode(-1);
      return;
    }

    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    void applyViewportFromParentControls(shiftViewportByMode(currentViewport, -1));
  });

  dom.sharedCenterBtnEl?.addEventListener("click", () => {
    if (state.planningAxisApi?.focusDataAnchor) {
      state.planningAxisApi.focusDataAnchor();
      return;
    }

    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    void applyViewportFromParentControls(currentViewport);
  });

  dom.sharedNextBtnEl?.addEventListener("click", () => {
    if (state.planningAxisApi?.moveViewportByMode) {
      state.planningAxisApi.moveViewportByMode(1);
      return;
    }

    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    void applyViewportFromParentControls(shiftViewportByMode(currentViewport, 1));
  });

  window.addEventListener("resize", () => {
    syncExpensesPlanningShell();
    scheduleExpensesFramePresentation();
    scheduleExpensesChartFramePresentation();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncExpensesPlanningShell();
      scheduleExpensesFramePresentation();
      scheduleExpensesChartFramePresentation();
    });
  }
}

export async function flushViewportSyncQueue() {
  if (state.projectSyncInProgress || state.viewportSyncInProgress || !state.pendingViewportPayload) {
    return;
  }

  const payload = state.pendingViewportPayload;
  state.pendingViewportPayload = null;
  const payloadProjectKey = String(payload.projectKey || "").trim();
  if (
    state.activeProjectKey &&
    payloadProjectKey &&
    normalizeProjectKey(payloadProjectKey) !== normalizeProjectKey(state.activeProjectKey)
  ) {
    void flushViewportSyncQueue();
    return;
  }

  const sourceApi = getViewportSourceApi(payload.app);
  const targetApis = getViewportTargetApis(payload.app);
  if (targetApis.length === 0) {
    void flushViewportSyncQueue();
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(payload.viewport);
  const exactSharedViewport = buildPlanningExactSharedViewport(payload.viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportLogicalSignature = getViewportLogicalSignature(payloadProjectKey, canonicalViewport);
  if (
    viewportLogicalSignature &&
    viewportLogicalSignature === state.lastAppliedViewportLogicalSignature
  ) {
    state.sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    void flushViewportSyncQueue();
    return;
  }

  state.viewportSyncInProgress = true;

  try {
    const sourceLogicalSignature = getViewportLogicalSignature(payloadProjectKey, payload.viewport);
    const getViewportForApi = () => exactSharedViewport;
    const applyCalls = targetApis.map((api) =>
      Promise.resolve(api.applyViewport(getViewportForApi(api)))
    );

    if (sourceApi && sourceLogicalSignature !== viewportLogicalSignature) {
      applyCalls.push(Promise.resolve(sourceApi.applyViewport(getViewportForApi(sourceApi))));
    }

    await Promise.all(applyCalls);
    state.lastAppliedViewportLogicalSignature = viewportLogicalSignature;
    state.sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    setLastSource(getViewportSourceLabel(payload.app));
    setLastRange(canonicalViewport);
    setHubStatus(`Synchro active depuis ${getViewportSourceLabel(payload.app)}`);
    appendLog(
      `${getViewportSourceLabel(payload.app)} -> ${canonicalViewport.firstVisibleDate || "?"} / ${
        canonicalViewport.rangeEndDate || "?"
      } / ${canonicalViewport.mode || "?"}`
    );
  } catch (error) {
    console.error("Erreur synchro viewport :", error);
    setHubStatus(`Erreur synchro : ${error.message}`);
    appendLog(`Erreur synchro viewport : ${error.message}`);
  } finally {
    state.viewportSyncInProgress = false;
    if (state.pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

export function handleViewportChange(payload) {
  if (!payload || state.projectSyncInProgress) {
    return;
  }

  state.pendingViewportPayload = payload;
  void flushViewportSyncQueue();
}
