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
import { flushViewportSyncQueue, syncViewportToExpensesNow } from "./viewportSync.js";

const SHARED_PROJECT_STORAGE_KEY = "grist.selected-project";
const SHARED_PROJECT_ID_STORAGE_KEY = "grist.selected-project-id";
const SHARED_PROJECT_STORAGE_FALLBACK_KEYS = [
  SHARED_PROJECT_STORAGE_KEY,
  "LP_LAST_PROJECT_LABEL",
  "nouveau-projet.selected-project",
];

export function readSharedProjectSelection() {
  try {
    for (const key of SHARED_PROJECT_STORAGE_FALLBACK_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const trimmed = String(raw).trim();
      if (!trimmed) continue;

      // "nouveau-projet.selected-project" stocke un objet JSON complet ;
      // on en extrait le champ selectedProject si nécessaire.
      if (key === "nouveau-projet.selected-project") {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed.selectedProject === "string" && parsed.selectedProject.trim()) {
            return parsed.selectedProject.trim();
          }
        } catch (_) {
          // pas du JSON → utiliser la valeur brute si elle ne ressemble pas à un objet
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
            return trimmed;
          }
          continue;
        }
      }

      return trimmed;
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function saveSharedProjectSelection(projectKey = "", projectId = null) {
  try {
    const normalized = String(projectKey || "").trim();
    if (normalized) {
      localStorage.setItem(SHARED_PROJECT_STORAGE_KEY, normalized);
      if (projectId != null) {
        localStorage.setItem(SHARED_PROJECT_ID_STORAGE_KEY, String(projectId));
      }
    } else {
      localStorage.removeItem(SHARED_PROJECT_STORAGE_KEY);
      localStorage.removeItem(SHARED_PROJECT_ID_STORAGE_KEY);
    }
  } catch (_error) {}
}

export function clearSharedProjectSelection() {
  saveSharedProjectSelection("", null);
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

  // Toujours sauvegarder la dernière sélection (nom). L'ID est écrit par bootstrap.js
  // depuis _projectIdByNormalizedKey lors de la sélection dans le hub.
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
    // 1. Appliquer le projet sur les iframes Planning Projet.
    //    Optimisation : si une iframe a déjà le bon projet chargé (ex. depuis localStorage
    //    au démarrage), on skip setSelectedProject pour éviter un double fetch Grist.
    //    On appelle quand même waitForPlanningViewportSettled pour que le viewport soit stable.
    const currentMain = state.planningApi.getSelectedProject?.() || "";
    const currentAxis = state.planningAxisApi?.getSelectedProject?.() || "";

    const calls = [];
    if (currentMain !== normalizedProjectKey) {
      calls.push(Promise.resolve(state.planningApi.setSelectedProject(normalizedProjectKey)));
    }
    if (state.planningAxisApi && currentAxis !== normalizedProjectKey) {
      calls.push(Promise.resolve(state.planningAxisApi.setSelectedProject(normalizedProjectKey)));
    }
    if (calls.length > 0) {
      await Promise.all(calls);
    }

    state.activeProjectKey = normalizedProjectKey;
    setActiveProjectSelection(normalizedProjectKey);

    // 2. Lire le viewport résultant de Planning Projet.
    const referencePlanningApi = getReferencePlanningApi() || state.planningApi;
    const planningViewport = referencePlanningApi.getViewport?.() || null;

    // 3. Synchroniser gestion-depenses2 en arrière-plan.
    //    Son iframe peut mettre du temps à charger (hors viewport au démarrage).
    //    On ne bloque pas : les boutons s'activent dès que Planning Projet est synced.
    //    Si gestion-depenses2 n'est pas encore prêt (expensesApi null), attachExpensesFrameApi
    //    s'en chargera automatiquement quand l'iframe sera chargée.
    if (state.expensesApi) {
      const expensesApi = state.expensesApi;
      const viewportToApply = planningViewport;
      Promise.resolve(expensesApi.setSelectedProject(normalizedProjectKey))
        .then(() => {
          if (state.activeProjectKey !== normalizedProjectKey || state.expensesApi !== expensesApi) return;
          if (viewportToApply?.firstVisibleDate) {
            syncViewportToExpensesNow(viewportToApply);
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
