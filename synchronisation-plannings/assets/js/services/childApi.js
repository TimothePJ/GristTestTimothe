import {
  CHILD_API_POLL_INTERVAL_MS,
  FRAME_LOAD_TIMEOUT_MS,
} from "../app/constants.js";
import { dom } from "../app/dom.js";
import { getReferencePlanningApi, state } from "../app/state.js";
import { scheduleExpensesChartFramePresentation, scheduleExpensesFramePresentation } from "../layout/framePresentation.js";
import { setLastRange, syncExpensesPlanningShell } from "../layout/shell.js";
import { alignExpensesViewportToPlanning } from "../viewport/alignment.js";
import { buildCanonicalSharedViewport } from "../viewport/build.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import { getDesiredProjectKey, getViewportLogicalSignature } from "../viewport/normalize.js";
import { flushViewportSyncQueue, handleViewportChange } from "./viewportSync.js";

export function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForFrameLoad(frameEl) {
  if (!(frameEl instanceof HTMLIFrameElement)) {
    throw new Error("Iframe introuvable.");
  }

  if (frameEl.contentWindow?.document?.readyState === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      frameEl.removeEventListener("load", handleLoad);
      reject(new Error(`Timeout chargement iframe ${frameEl.id}`));
    }, FRAME_LOAD_TIMEOUT_MS);

    function handleLoad() {
      window.clearTimeout(timeoutId);
      resolve();
    }

    frameEl.addEventListener("load", handleLoad, { once: true });
  });
}

export async function waitForChildApi(frameEl, apiName, timeoutMs = FRAME_LOAD_TIMEOUT_MS) {
  await waitForFrameLoad(frameEl);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const api = frameEl.contentWindow?.[apiName];
    if (api?.isReady) {
      return api;
    }
    await sleep(CHILD_API_POLL_INTERVAL_MS);
  }

  throw new Error(`API ${apiName} indisponible.`);
}

export function getLateAttachReferenceViewport() {
  const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
  const baseViewport =
    state.sharedViewportState ||
    referencePlanningApi?.getViewport?.() ||
    state.planningApi?.getViewport?.() ||
    null;

  return baseViewport ? buildCanonicalSharedViewport(baseViewport) : null;
}

export async function attachExpensesFrameApi({ force = false } = {}) {
  if (!(dom.expensesFrameEl instanceof HTMLIFrameElement)) {
    return null;
  }

  if (!force && state.expensesFrameAttachPromise) {
    return state.expensesFrameAttachPromise;
  }

  const attachAttempt = ++state.expensesFrameAttachAttempt;
  state.expensesFrameAttachPromise = waitForChildApi(dom.expensesFrameEl, "__gestionDepenses2PlanningSyncApi")
    .then(async (api) => {
      if (attachAttempt !== state.expensesFrameAttachAttempt) {
        return api;
      }

      state.expensesApi = api;
      scheduleExpensesFramePresentation();

      const targetProjectKey = getDesiredProjectKey();
      if (targetProjectKey) {
        await Promise.resolve(api.setSelectedProject(targetProjectKey));
      }

      let referenceViewport = getLateAttachReferenceViewport();
      if (referenceViewport?.firstVisibleDate) {
        syncPlanningViewportBounds(referenceViewport);
        const stabilizedViewport = await alignExpensesViewportToPlanning(referenceViewport, {
          onAfterApply: () => scheduleExpensesFramePresentation(),
        });
        if (stabilizedViewport?.firstVisibleDate) {
          referenceViewport = buildCanonicalSharedViewport({
            ...referenceViewport,
            ...stabilizedViewport,
          });
        }

        state.sharedViewportState = referenceViewport;
        state.lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
          targetProjectKey || state.activeProjectKey,
          referenceViewport
        );
        syncExpensesPlanningShell(referenceViewport);
        setLastRange(referenceViewport);
      }

      scheduleExpensesFramePresentation();

      if (state.expensesViewportSubscriptionApi !== api) {
        api.subscribeViewportChange(handleViewportChange);
        state.expensesViewportSubscriptionApi = api;
      }

      if (!state.projectSyncInProgress && state.pendingViewportPayload) {
        void flushViewportSyncQueue();
      }

      return api;
    })
    .catch((error) => {
      if (attachAttempt === state.expensesFrameAttachAttempt) {
        console.error("Erreur attache du planning gestion-depenses2 :", error);
      }
      return null;
    })
    .finally(() => {
      if (attachAttempt === state.expensesFrameAttachAttempt) {
        state.expensesFrameAttachPromise = null;
      }
    });

  return state.expensesFrameAttachPromise;
}

export async function attachExpensesChartFrameApi({ force = false } = {}) {
  if (!(dom.expensesChartFrameEl instanceof HTMLIFrameElement)) {
    return null;
  }

  if (!force && state.expensesChartFrameAttachPromise) {
    return state.expensesChartFrameAttachPromise;
  }

  const attachAttempt = ++state.expensesChartFrameAttachAttempt;
  state.expensesChartFrameAttachPromise = waitForChildApi(
    dom.expensesChartFrameEl,
    "__gestionDepenses2PlanningSyncApi"
  )
    .then(async (api) => {
      if (attachAttempt !== state.expensesChartFrameAttachAttempt) {
        return api;
      }

      state.expensesChartApi = api;
      const targetProjectKey = getDesiredProjectKey();
      if (targetProjectKey) {
        await Promise.resolve(api.setSelectedProject(targetProjectKey));
      }

      scheduleExpensesChartFramePresentation();
      return api;
    })
    .catch((error) => {
      if (attachAttempt === state.expensesChartFrameAttachAttempt) {
        console.error("Erreur attache du graphique des depenses :", error);
      }
      return null;
    })
    .finally(() => {
      if (attachAttempt === state.expensesChartFrameAttachAttempt) {
        state.expensesChartFrameAttachPromise = null;
      }
    });

  return state.expensesChartFrameAttachPromise;
}
