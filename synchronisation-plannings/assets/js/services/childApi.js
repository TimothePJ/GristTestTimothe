import {
  CHILD_API_POLL_INTERVAL_MS,
  FRAME_LOAD_TIMEOUT_MS,
} from "../app/constants.js";
import { dom } from "../app/dom.js";
import { getReferencePlanningApi, state } from "../app/state.js";
import {
  scheduleExpensesFramePresentation,
  schedulePlanningFramePresentation,
} from "../layout/framePresentation.js";
import {
  setActiveProjectSelection,
  setLastRange,
  setProjectContentVisibility,
  syncExpensesPlanningShell,
  syncSharedPlanningControlsAvailability,
} from "../layout/shell.js";
import {
  buildCanonicalSharedViewport,
  buildPlanningLedProjectSelectionViewport,
} from "../viewport/build.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import {
  getDesiredProjectKey,
  getViewportLogicalSignature,
} from "../viewport/normalize.js";
import {
  drainExpensesViewportQueue,
  flushViewportSyncQueue,
  handleViewportChange,
  syncViewportToExpensesNow,
} from "./viewportSync.js";
import { readSharedProjectSelection } from "./projectSync.js";

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
      schedulePlanningFramePresentation();

      // Masquer gestion-depenses2 pendant la synchro projet + alignement viewport.
      // Il sera révélé (.is-aligned) une fois les dates alignées avec Planning Projet.
      dom.expensesFrameEl?.classList.remove("is-aligned");

      // Récupérer le projet à appliquer.
      // getDesiredProjectKey() regarde state.requestedProjectKey et state.activeProjectKey.
      // Si les deux sont vides (applyRestoredSharedProject a échoué), chercher dans :
      //   1. les iframes Planning Projet (déjà chargé depuis leur propre localStorage)
      //   2. localStorage directement (readSharedProjectSelection)
      let targetProjectKey = getDesiredProjectKey();
      if (!targetProjectKey) {
        targetProjectKey =
          state.planningApi?.getSelectedProject?.() ||
          state.planningAxisApi?.getSelectedProject?.() ||
          readSharedProjectSelection() ||
          "";
        if (targetProjectKey) {
          state.activeProjectKey = targetProjectKey;
          state.requestedProjectKey = targetProjectKey;
        }
      }
      if (targetProjectKey) {
        state.activeProjectKey = targetProjectKey;
        state.requestedProjectKey = targetProjectKey;
        setActiveProjectSelection(targetProjectKey);
        setProjectContentVisibility(true);
        syncSharedPlanningControlsAvailability();
        await Promise.resolve(api.setSelectedProject(targetProjectKey));
      }

      // Appliquer le viewport partagé actuel à gestion-depenses2 (une fois, sans boucle de retry).
      const referenceViewport = getLateAttachReferenceViewport();
      if (referenceViewport?.firstVisibleDate) {
        syncPlanningViewportBounds(referenceViewport);
        syncViewportToExpensesNow(referenceViewport);
        state.sharedViewportState = referenceViewport;
        state.lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
          targetProjectKey || state.activeProjectKey,
          referenceViewport
        );
        syncExpensesPlanningShell(referenceViewport);
        setLastRange(referenceViewport);
      }

      drainExpensesViewportQueue();

      // Révéler gestion-depenses2 maintenant que les dates sont alignées avec Planning Projet.
      dom.expensesFrameEl?.classList.add("is-aligned");
      schedulePlanningFramePresentation();
      scheduleExpensesFramePresentation();

      // S'abonner aux changements viewport de gestion-depenses2.
      // IMPORTANT : passer app: "gestion-depenses2" dans le payload pour que le routage
      // dans flushViewportSyncQueue puisse correctement cibler Planning Projet.
      // Sans ce champ, getViewportTargetApis("") retourne [] → Planning Projet ne suit jamais.
      if (state.expensesViewportSubscriptionApi !== api) {
        api.subscribeViewportChange((payload) =>
          handleViewportChange({ ...payload, app: "gestion-depenses2" })
        );
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
        // Restaurer la visibilité en cas d'échec (timeout, etc.)
        dom.expensesFrameEl?.classList.add("is-aligned");
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
