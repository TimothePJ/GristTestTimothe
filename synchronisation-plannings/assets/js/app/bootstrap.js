import { DEBUG_DISABLE_STICKY_SHELL } from "./constants.js";
import { dom } from "./dom.js";
import { state } from "./state.js";
import { bindPlanningLayoutDebug, schedulePlanningLayoutDebug } from "../layout/debugLayout.js";
import {
  scheduleExpensesFramePresentation,
  schedulePlanningFramePresentation,
} from "../layout/framePresentation.js";
import {
  applyPlanningFrameHeight,
  bindPlanningFrameResizeHandle,
  getStoredPlanningFrameHeight,
} from "../layout/resizeHandle.js";
import {
  appendLog,
  renderProjectOptions,
  syncSharedPlanningControlsAvailability,
  setProjectContentVisibility,
  setHubStatus,
  setSelectionWarning,
} from "../layout/shell.js";
import { attachExpensesFrameApi, waitForChildApi } from "../services/childApi.js";
import {
  handlePlanningWarningsChange,
  showCurrentPlanningWarningsPopup,
} from "../services/planningWarnings.js";
import { applySharedProject, clearSharedProjectSelection } from "../services/projectSync.js";
import { bindExpensesPlanningShellControls, handleViewportChange } from "../services/viewportSync.js";

function showPlanningWarningsOnWidgetArrival() {
  window.setTimeout(() => {
    showCurrentPlanningWarningsPopup({ force: true });
  }, 0);
}

function applyDebugBodyClass() {
  if (DEBUG_DISABLE_STICKY_SHELL && typeof document !== "undefined") {
    document.body.classList.add("layout-debug-no-sticky");
  }
}

function bindFrameLoadListeners() {
  dom.expensesFrameEl?.addEventListener("load", () => {
    state.expensesApi = null;
    state.expensesViewportSubscriptionApi = null;
    state.lastPlanningWarningsPopupSignature = "";
    syncSharedPlanningControlsAvailability();
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug("expenses-frame-load");
    void attachExpensesFrameApi();
  });

  dom.planningAxisFrameEl?.addEventListener("load", () => {
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug("planning-axis-frame-load");
  });

  dom.planningFrameEl?.addEventListener("load", () => {
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    schedulePlanningLayoutDebug("planning-frame-load");
  });
}

function bindWidgetArrivalWarningsListeners() {
  window.addEventListener("pageshow", showPlanningWarningsOnWidgetArrival);
  window.addEventListener("focus", showPlanningWarningsOnWidgetArrival);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      showPlanningWarningsOnWidgetArrival();
    }
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
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    bindFrameLoadListeners();
    bindWidgetArrivalWarningsListeners();

    const planningProjects = (state.planningApi.listProjects?.() || []).filter(Boolean);
    renderProjectOptions(planningProjects);
    setProjectContentVisibility(false);
    syncSharedPlanningControlsAvailability();

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
        handlePlanningWarningsChange(payload);
      });
    }
    state.planningAxisApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-axis" })
    );

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
