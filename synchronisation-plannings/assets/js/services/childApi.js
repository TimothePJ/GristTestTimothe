import {
  CHILD_API_POLL_INTERVAL_MS,
  FRAME_LOAD_TIMEOUT_MS,
} from "../app/constants.js";
import { dom } from "../app/dom.js";
import { getReferencePlanningApi, state } from "../app/state.js";
import {
  resetOverviewFramePresentation,
  scheduleExpensesFramePresentation,
  scheduleOverviewFramePresentation,
} from "../layout/framePresentation.js";
import {
  appendLog,
  setHubStatus,
  setLastRange,
  syncExpensesPlanningShell,
  syncSharedPlanningControlsAvailability,
} from "../layout/shell.js";
import { alignExpensesViewportToPlanning } from "../viewport/alignment.js";
import {
  buildCanonicalSharedViewport,
  buildPlanningLedProjectSelectionViewport,
} from "../viewport/build.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import {
  getDesiredProjectKey,
  getViewportLogicalSignature,
  normalizeProjectKey,
} from "../viewport/normalize.js";
import { applySharedProject } from "./projectSync.js";
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
  const planningViewport =
    referencePlanningApi?.getViewport?.() || state.planningApi?.getViewport?.() || null;
  const baseViewport =
    state.sharedViewportState ||
    planningViewport ||
    state.expensesApi?.getViewport?.() ||
    null;

  if (!baseViewport) {
    return null;
  }

  if (state.sharedViewportState?.firstVisibleDate) {
    return buildCanonicalSharedViewport(state.sharedViewportState);
  }

  if (planningViewport) {
    return buildPlanningLedProjectSelectionViewport(planningViewport, baseViewport);
  }

  return buildCanonicalSharedViewport(baseViewport);
}

export async function attachOverviewFrameApi({ force = false } = {}) {
  if (!(dom.overviewFrameEl instanceof HTMLIFrameElement)) {
    return null;
  }

  if (!force && state.overviewFrameAttachPromise) {
    return state.overviewFrameAttachPromise;
  }

  const attachAttempt = ++state.overviewFrameAttachAttempt;
  syncSharedPlanningControlsAvailability();
  state.overviewFrameAttachPromise = waitForChildApi(
    dom.overviewFrameEl,
    "__gestionDepenses2PlanningSyncApi"
  )
    .then(async (api) => {
      if (attachAttempt !== state.overviewFrameAttachAttempt) {
        return api;
      }

      state.overviewApi = api;
      scheduleOverviewFramePresentation();

      const targetProjectKey = getDesiredProjectKey();
      if (targetProjectKey) {
        await Promise.resolve(api.setSelectedProject(targetProjectKey));
      }

      scheduleOverviewFramePresentation();

      if (state.overviewProjectSubscriptionApi !== api) {
        state.overviewProjectSubscriptionCleanup?.();
        state.overviewProjectSubscriptionCleanup = null;

        if (typeof api.subscribeProjectChange === "function") {
          state.overviewProjectSubscriptionCleanup = api.subscribeProjectChange((payload) => {
            if (!state.allowChildProjectSelectionSync) {
              return;
            }

            const nextProjectKey = String(payload?.projectKey || payload || "").trim();
            if (!nextProjectKey) {
              return;
            }

            const currentProjectKey = String(
              state.requestedProjectKey || state.activeProjectKey || ""
            ).trim();
            if (normalizeProjectKey(nextProjectKey) === normalizeProjectKey(currentProjectKey)) {
              return;
            }

            scheduleOverviewFramePresentation();
            applySharedProject(nextProjectKey).catch((error) => {
              console.error("Erreur synchronisation projet depuis overview :", error);
              setHubStatus(`Erreur projet : ${error.message}`);
              appendLog(`Erreur projet overview : ${error.message}`);
            });
          });
        }

        state.overviewProjectSubscriptionApi = api;
      }

      return api;
    })
    .catch((error) => {
      if (attachAttempt === state.overviewFrameAttachAttempt) {
        console.error("Erreur attache du cockpit projet :", error);
      }
      return null;
    })
    .finally(() => {
      if (attachAttempt === state.overviewFrameAttachAttempt) {
        state.overviewFrameAttachPromise = null;
        syncSharedPlanningControlsAvailability();
      }
    });

  return state.overviewFrameAttachPromise;
}

export async function attachExpensesFrameApi({ force = false } = {}) {
  if (!(dom.expensesFrameEl instanceof HTMLIFrameElement)) {
    return null;
  }

  if (!force && state.expensesFrameAttachPromise) {
    return state.expensesFrameAttachPromise;
  }

  const attachAttempt = ++state.expensesFrameAttachAttempt;
  state.expensesApi = null;
  state.expensesViewportSubscriptionApi = null;
  syncSharedPlanningControlsAvailability();
  state.expensesFrameAttachPromise = waitForChildApi(dom.expensesFrameEl, "__gestionDepenses2PlanningSyncApi")
    .then(async (api) => {
      if (attachAttempt !== state.expensesFrameAttachAttempt) {
        return api;
      }

      state.expensesApi = api;
      syncSharedPlanningControlsAvailability();
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
        syncSharedPlanningControlsAvailability();
      }
    });

  return state.expensesFrameAttachPromise;
}
