import { DEBUG_DISABLE_STICKY_SHELL } from "./constants.js";
import { dom } from "./dom.js";
import { state } from "./state.js";
import { bindPlanningLayoutDebug, schedulePlanningLayoutDebug } from "../layout/debugLayout.js";
import { scheduleExpensesChartFramePresentation, scheduleExpensesFramePresentation } from "../layout/framePresentation.js";
import {
  applyPlanningFrameHeight,
  bindPlanningFrameResizeHandle,
  getStoredPlanningFrameHeight,
} from "../layout/resizeHandle.js";
import {
  appendLog,
  renderProjectOptions,
  setExpensesPlanningControlsDisabled,
  setHubStatus,
} from "../layout/shell.js";
import { attachExpensesChartFrameApi, attachExpensesFrameApi, waitForChildApi } from "../services/childApi.js";
import { applySharedProject } from "../services/projectSync.js";
import { bindExpensesPlanningShellControls, handleViewportChange } from "../services/viewportSync.js";

function applyDebugBodyClass() {
  if (DEBUG_DISABLE_STICKY_SHELL && typeof document !== "undefined") {
    document.body.classList.add("layout-debug-no-sticky");
  }
}

function bindFrameLoadListeners() {
  dom.expensesFrameEl?.addEventListener("load", () => {
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug("expenses-frame-load");
    void attachExpensesFrameApi();
  });

  dom.expensesChartFrameEl?.addEventListener("load", () => {
    scheduleExpensesChartFramePresentation();
    void attachExpensesChartFrameApi();
  });

  dom.planningFrameEl?.addEventListener("load", () => {
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    schedulePlanningLayoutDebug("planning-frame-load");
  });
}

function bindProjectSelector() {
  if (!(dom.projectSelectEl instanceof HTMLSelectElement)) {
    return;
  }

  dom.projectSelectEl.addEventListener("change", () => {
    applySharedProject(dom.projectSelectEl.value).catch((error) => {
      console.error(error);
      setHubStatus(`Erreur projet : ${error.message}`);
      appendLog(`Erreur projet : ${error.message}`);
    });
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
    scheduleExpensesFramePresentation();
    scheduleExpensesChartFramePresentation();
    bindPlanningLayoutDebug();
    bindFrameLoadListeners();

    const planningProjects = (state.planningApi.listProjects?.() || []).filter(Boolean);
    renderProjectOptions(planningProjects);
    setExpensesPlanningControlsDisabled(planningProjects.length === 0);

    const initialProject =
      String(state.planningApi.getSelectedProject?.() || "").trim() ||
      planningProjects[0] ||
      "";

    state.planningApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-main" })
    );
    state.planningAxisApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-axis" })
    );

    bindProjectSelector();

    if (initialProject) {
      await applySharedProject(initialProject);
    } else {
      setHubStatus("Aucun projet disponible.");
    }

    void attachExpensesFrameApi();
    void attachExpensesChartFrameApi();
    schedulePlanningLayoutDebug("bootstrap-ready");
  } catch (error) {
    console.error("Erreur synchronisation plannings :", error);
    setHubStatus(`Erreur : ${error.message}`);
    appendLog(`Erreur initialisation : ${error.message}`);
  }
}
