import { DEBUG_DISABLE_STICKY_SHELL } from "./constants.js";
import { dom } from "./dom.js";
import { state } from "./state.js";
import { bindPlanningLayoutDebug, schedulePlanningLayoutDebug } from "../layout/debugLayout.js";
import {
  resetOverviewFramePresentation,
  scheduleExpensesFramePresentation,
  scheduleOverviewFramePresentation,
} from "../layout/framePresentation.js";
import {
  applyPlanningFrameHeight,
  bindPlanningFrameResizeHandle,
  getStoredPlanningFrameHeight,
} from "../layout/resizeHandle.js";
import {
  appendLog,
  closePlanningWarningsPopup,
  renderProjectOptions,
  setExpensesPlanningControlsDisabled,
  setProjectContentVisibility,
  setHubStatus,
  setSelectionWarning,
  showPlanningWarningsPopup,
} from "../layout/shell.js";
import {
  attachExpensesFrameApi,
  attachOverviewFrameApi,
  waitForChildApi,
} from "../services/childApi.js";
import { applySharedProject, clearSharedProjectSelection } from "../services/projectSync.js";
import { bindExpensesPlanningShellControls, handleViewportChange } from "../services/viewportSync.js";

function applyDebugBodyClass() {
  if (DEBUG_DISABLE_STICKY_SHELL && typeof document !== "undefined") {
    document.body.classList.add("layout-debug-no-sticky");
  }
}

function bindFrameLoadListeners() {
  dom.overviewFrameEl?.addEventListener("load", () => {
    state.overviewApi = null;
    state.overviewProjectSubscriptionCleanup?.();
    state.overviewProjectSubscriptionCleanup = null;
    state.overviewProjectSubscriptionApi = null;
    resetOverviewFramePresentation();
    scheduleOverviewFramePresentation();
    void attachOverviewFrameApi({ force: true });
  });

  dom.expensesFrameEl?.addEventListener("load", () => {
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug("expenses-frame-load");
    void attachExpensesFrameApi();
  });

  dom.planningFrameEl?.addEventListener("load", () => {
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    schedulePlanningLayoutDebug("planning-frame-load");
  });
}

export async function bootstrapHubApp() {
  applyDebugBodyClass();
  applyPlanningFrameHeight(getStoredPlanningFrameHeight(), {
    persist: false,
    refresh: false,
  });
  bindPlanningFrameResizeHandle();

  try {
    if (window.grist && typeof window.grist.ready === "function") {
      window.grist.ready({ requiredAccess: "full" });
    }

    setHubStatus("Connexion aux plannings...");

    [state.planningApi, state.planningAxisApi] = await Promise.all([
      waitForChildApi(dom.planningFrameEl, "__planningProjetSyncApi"),
      waitForChildApi(dom.planningAxisFrameEl, "__planningProjetSyncApi"),
    ]);

    bindExpensesPlanningShellControls();
    scheduleOverviewFramePresentation();
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    bindFrameLoadListeners();

    const planningProjects = (state.planningApi.listProjects?.() || []).filter(Boolean);
    renderProjectOptions(planningProjects);
    setExpensesPlanningControlsDisabled(planningProjects.length === 0);
    setProjectContentVisibility(false);

    state.planningApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-main" })
    );
    if (typeof state.planningApi.subscribeSelectionChange === "function") {
      state.planningApi.subscribeSelectionChange((payload) => {
        if (!String(state.activeProjectKey || "").trim()) {
          setSelectionWarning(null);
          return;
        }

        setSelectionWarning(payload?.selection || null);
      });
    }
    if (typeof state.planningApi.subscribeWarningsChange === "function") {
      state.planningApi.subscribeWarningsChange((payload) => {
        if (!String(state.activeProjectKey || "").trim()) {
          closePlanningWarningsPopup();
          return;
        }

        const projectKey = String(payload?.projectKey || state.activeProjectKey || "").trim();
        const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
        const popupSignature = JSON.stringify({
          projectKey,
          warnings: warnings.map((warning) => ({
            severity: String(warning?.severity || "").trim(),
            label: String(warning?.label || "").trim(),
            days: Number(warning?.days) || 0,
            segmentEndDate: String(warning?.segmentEndDate || "").trim(),
          })),
        });

        if (!warnings.length) {
          closePlanningWarningsPopup();
          return;
        }

        if (popupSignature === state.lastPlanningWarningsPopupSignature) {
          return;
        }

        state.lastPlanningWarningsPopupSignature = popupSignature;
        showPlanningWarningsPopup(projectKey, warnings);
      });
    }
    state.planningAxisApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-axis" })
    );
    void attachOverviewFrameApi();

    if (dom.projectSelectEl instanceof HTMLSelectElement) {
      dom.projectSelectEl.addEventListener("change", () => {
        const nextProjectKey = String(dom.projectSelectEl.value || "").trim();
        if (!nextProjectKey) {
          clearSharedProjectSelection();
          return;
        }

        void applySharedProject(nextProjectKey);
      });
    }

    if (planningProjects.length) {
      clearSharedProjectSelection();
    } else {
      clearSharedProjectSelection();
      setHubStatus("Aucun projet disponible.");
    }

    void attachExpensesFrameApi();
    schedulePlanningLayoutDebug("bootstrap-ready");
  } catch (error) {
    console.error("Erreur synchronisation plannings :", error);
    setHubStatus(`Erreur : ${error.message}`);
    appendLog(`Erreur initialisation : ${error.message}`);
  }
}
