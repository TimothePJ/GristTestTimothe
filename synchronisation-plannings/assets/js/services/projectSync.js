import { getReferencePlanningApi, state } from "../app/state.js";
import {
  scheduleExpensesFramePresentation,
  schedulePlanningFramePresentation,
} from "../layout/framePresentation.js";
import {
  appendLog,
  setActiveProjectSelection,
  getViewportSourceLabel,
  setProjectContentVisibility,
  setHubStatus,
  setLastRange,
  setLastSource,
  syncSharedPlanningControlsAvailability,
  syncExpensesPlanningShell,
} from "../layout/shell.js";
import { syncPlanningViewportBounds } from "../viewport/bounds.js";
import { getViewportLogicalSignature } from "../viewport/normalize.js";
import { flushViewportSyncQueue } from "./viewportSync.js";

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
    const normalized = String(projectKey || "").trim();
    if (normalized) {
      localStorage.setItem(SHARED_PROJECT_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(SHARED_PROJECT_STORAGE_KEY);
    }
  } catch (_error) {}
}

export function clearSharedProjectSelection() {
  saveSharedProjectSelection("");
  state.activeProjectKey = "";
  state.requestedProjectKey = "";
  state.lastAppliedViewportLogicalSignature = "";
  state.sharedViewportState = null;
  state.sharedToolbarActionInProgress = false;
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
  if (!normalizedProjectKey || !state.planningApi) return;

  // Toujours sauvegarder la dernière sélection.
  saveSharedProjectSelection(normalizedProjectKey);

  // Anti-concurrence : mémoriser le projet et laisser la synchro en cours finir.
  if (state.projectSyncInProgress) {
    state.requestedProjectKey = normalizedProjectKey;
    return;
  }

  state.requestedProjectKey = normalizedProjectKey;
  state.projectSyncInProgress = true;
  state.pendingViewportPayload = null;

  setActiveProjectSelection(normalizedProjectKey);
  setProjectContentVisibility(true);
  syncSharedPlanningControlsAvailability();
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);

  try {
    // 1. Appliquer le projet sur les 2 iframes Planning Projet et attendre leur rendu.
    //    Après setSelectedProject, le viewport est déjà positionné sur les données
    //    grâce au fix RAF (setWindow sur la plage réelle des items).
    await Promise.all([
      Promise.resolve(state.planningApi.setSelectedProject(normalizedProjectKey)),
      Promise.resolve(state.planningAxisApi?.setSelectedProject?.(normalizedProjectKey)),
    ]);
    state.activeProjectKey = normalizedProjectKey;
    setActiveProjectSelection(normalizedProjectKey);

    // 2. Lire le viewport résultant de Planning Projet.
    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    const planningViewport = referencePlanningApi.getViewport?.() || null;

    // 3. Synchroniser gestion-depenses2 en arrière-plan (ne bloque pas l'UI).
    if (state.expensesApi) {
      const expensesApi = state.expensesApi;
      const viewportToApply = planningViewport;
      Promise.resolve(expensesApi.setSelectedProject(normalizedProjectKey))
        .then(() => {
          if (state.activeProjectKey !== normalizedProjectKey) return;
          if (viewportToApply?.firstVisibleDate) {
            return Promise.resolve(expensesApi.applyViewport?.(viewportToApply));
          }
        })
        .then(() => scheduleExpensesFramePresentation())
        .catch((err) => console.error("Erreur sync gestion-depenses2 :", err));
    }

    // 4. Mettre à jour l'état partagé et l'affichage.
    if (planningViewport?.firstVisibleDate) {
      syncPlanningViewportBounds(planningViewport);
      state.sharedViewportState = planningViewport;
      state.lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        planningViewport
      );
      setLastRange(planningViewport);
      syncExpensesPlanningShell(planningViewport);
    }

    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    setLastSource(getViewportSourceLabel("Pilotage commun"));
    setHubStatus(`Projet : ${normalizedProjectKey}`);
    appendLog(`Projet partage applique : ${normalizedProjectKey}`);
  } finally {
    state.projectSyncInProgress = false;
    syncSharedPlanningControlsAvailability();
    void flushViewportSyncQueue();

    // Si l'utilisateur a sélectionné un autre projet pendant cette synchro, l'appliquer.
    const next = String(state.requestedProjectKey || "").trim();
    if (next && next !== normalizedProjectKey) {
      void applySharedProject(next);
    }
  }
}
