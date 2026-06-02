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
import { handlePlanningWarningsChange } from "../services/planningWarnings.js";
import { applySharedProject, clearSharedProjectSelection } from "../services/projectSync.js";
import { bindExpensesPlanningShellControls, handleViewportChange } from "../services/viewportSync.js";

const COMPACT_PLANNING_FRAME_MIN_HEIGHT = 80;
const COMPACT_PLANNING_FRAME_FALLBACK_HEIGHT = 124;
const PLANNING_TOOLTIP_MESSAGE_TYPE = "planning-projet-hover-tooltip";

let planningIframeTooltipEl = null;
let planningIframeTooltipHideTimer = 0;

function applyDebugBodyClass() {
  if (DEBUG_DISABLE_STICKY_SHELL && typeof document !== "undefined") {
    document.body.classList.add("layout-debug-no-sticky");
  }
}

function waitForAnimationFrames(count = 1) {
  const frameCount = Math.max(1, Number(count) || 1);
  return new Promise((resolve) => {
    const step = (remaining) => {
      window.requestAnimationFrame(() => {
        if (remaining <= 1) {
          resolve();
          return;
        }

        step(remaining - 1);
      });
    };

    step(frameCount);
  });
}

function getPlanningTooltipSourceFrame(sourceWindow) {
  const frames = [dom.planningFrameEl, dom.planningAxisFrameEl].filter(Boolean);
  return frames.find((frameEl) => frameEl?.contentWindow === sourceWindow) || null;
}

function ensurePlanningIframeTooltip() {
  if (planningIframeTooltipEl instanceof HTMLElement) {
    return planningIframeTooltipEl;
  }

  planningIframeTooltipEl = document.createElement("div");
  planningIframeTooltipEl.className = "planning-iframe-tooltip";
  planningIframeTooltipEl.hidden = true;
  planningIframeTooltipEl.addEventListener("mouseenter", () => {
    if (planningIframeTooltipHideTimer) {
      window.clearTimeout(planningIframeTooltipHideTimer);
      planningIframeTooltipHideTimer = 0;
    }
  });
  planningIframeTooltipEl.addEventListener("mouseleave", () => {
    hidePlanningIframeTooltip();
  });
  document.body.appendChild(planningIframeTooltipEl);
  return planningIframeTooltipEl;
}

function hidePlanningIframeTooltip({ delay = 0 } = {}) {
  if (planningIframeTooltipHideTimer) {
    window.clearTimeout(planningIframeTooltipHideTimer);
    planningIframeTooltipHideTimer = 0;
  }

  const hideNow = () => {
    if (!(planningIframeTooltipEl instanceof HTMLElement)) return;
    planningIframeTooltipEl.hidden = true;
    planningIframeTooltipEl.innerHTML = "";
  };

  if (delay > 0) {
    planningIframeTooltipHideTimer = window.setTimeout(() => {
      planningIframeTooltipHideTimer = 0;
      hideNow();
    }, delay);
    return;
  }

  hideNow();
}

function placePlanningIframeTooltip(clientX, clientY) {
  if (!(planningIframeTooltipEl instanceof HTMLElement) || planningIframeTooltipEl.hidden) {
    return;
  }

  const offset = 14;
  const verticalBias = 96;
  const viewportPadding = 8;
  const maxWidth = Math.max(180, Math.min(680, window.innerWidth - viewportPadding * 2));
  const anchorY = Math.max(viewportPadding + offset, clientY - verticalBias);

  planningIframeTooltipEl.style.maxWidth = `${maxWidth}px`;
  planningIframeTooltipEl.style.maxHeight = `${Math.max(48, window.innerHeight - viewportPadding * 2)}px`;

  const initialRect = planningIframeTooltipEl.getBoundingClientRect();
  const naturalHeight = Math.min(
    planningIframeTooltipEl.scrollHeight,
    window.innerHeight - viewportPadding * 2
  );
  const availableBelow = Math.max(0, window.innerHeight - anchorY - offset - viewportPadding);
  const availableAbove = Math.max(0, anchorY - offset - viewportPadding);
  const shouldOpenAbove =
    availableBelow < Math.min(naturalHeight, initialRect.height) &&
    availableAbove > availableBelow;
  const availableHeight = shouldOpenAbove ? availableAbove : availableBelow;
  const preferredTooltipHeight = Math.min(
    naturalHeight,
    Math.max(180, window.innerHeight - viewportPadding * 2)
  );
  const maxHeight = Math.max(
    120,
    Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(Math.floor(availableHeight), preferredTooltipHeight)
    )
  );

  planningIframeTooltipEl.style.maxHeight = `${maxHeight}px`;

  const rect = planningIframeTooltipEl.getBoundingClientRect();
  const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);

  let left = clientX + offset;
  if (left > maxLeft) {
    left = Math.max(viewportPadding, clientX - rect.width - offset);
  }

  const top = shouldOpenAbove
    ? Math.max(viewportPadding, anchorY - rect.height - offset)
    : Math.min(
        anchorY + offset,
        Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding)
      );

  planningIframeTooltipEl.style.left = `${Math.round(left)}px`;
  planningIframeTooltipEl.style.top = `${Math.round(top)}px`;
}

function bindPlanningIframeTooltipBridge() {
  window.addEventListener("message", (event) => {
    const payload = event?.data;
    if (!payload || payload.type !== PLANNING_TOOLTIP_MESSAGE_TYPE) {
      return;
    }

    const frameEl = getPlanningTooltipSourceFrame(event.source);
    if (!(frameEl instanceof HTMLElement)) {
      return;
    }

    if (payload.action === "hide") {
      hidePlanningIframeTooltip({ delay: 120 });
      return;
    }

    const frameRect = frameEl.getBoundingClientRect();
    const localX = Number(payload.clientX);
    const localY = Number(payload.clientY);
    if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
      return;
    }

    const tooltipClientX = frameRect.left + localX;
    const tooltipClientY = frameRect.top + localY;

    if (payload.action === "show") {
      const tooltipEl = ensurePlanningIframeTooltip();
      if (planningIframeTooltipHideTimer) {
        window.clearTimeout(planningIframeTooltipHideTimer);
        planningIframeTooltipHideTimer = 0;
      }
      tooltipEl.innerHTML = String(payload.html || "");
      tooltipEl.hidden = false;
      placePlanningIframeTooltip(tooltipClientX, tooltipClientY);
      return;
    }

    if (payload.action === "move") {
      placePlanningIframeTooltip(tooltipClientX, tooltipClientY);
    }
  });
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
    void applyPlanningAggregateModeFromToggle();
  });
}

function setPlanningAggregateShellState(enabled) {
  document.body.classList.toggle("is-planning-aggregate-mode", enabled);

  if (dom.planningResizeHandleEl instanceof HTMLElement) {
    dom.planningResizeHandleEl.hidden = enabled;
    dom.planningResizeHandleEl.setAttribute("aria-hidden", enabled ? "true" : "false");
    dom.planningResizeHandleEl.setAttribute("aria-disabled", enabled ? "true" : "false");
  }
}

function getPlanningCompactFrameHeight() {
  const preferredHeight = Number(state.planningApi?.getPreferredEmbeddedHeight?.());
  return Number.isFinite(preferredHeight) && preferredHeight > 0
    ? preferredHeight
    : COMPACT_PLANNING_FRAME_FALLBACK_HEIGHT;
}

function applyPlanningCompactFrameHeight() {
  const compactHeight = getPlanningCompactFrameHeight();
  applyPlanningFrameHeight(compactHeight, {
    persist: false,
    refresh: true,
    minHeight: COMPACT_PLANNING_FRAME_MIN_HEIGHT,
  });
}

function applyPlanningNormalFrameHeight() {
  applyPlanningFrameHeight(getStoredPlanningFrameHeight(), {
    persist: false,
    refresh: true,
  });
}

async function refreshPlanningAggregatePresentation() {
  if (!state.planningVisualAggregateMode) {
    return;
  }

  await waitForAnimationFrames(2);
  if (!state.planningVisualAggregateMode) {
    return;
  }

  state.planningApi?.refreshLayout?.();
  await waitForAnimationFrames(2);
  if (!state.planningVisualAggregateMode) {
    return;
  }

  applyPlanningCompactFrameHeight();
  schedulePlanningFramePresentation();
  scheduleExpensesFramePresentation();
  schedulePlanningLayoutDebug("planning-aggregate-height");
}

async function applyPlanningAggregateModeFromToggle() {
  const enabled =
    dom.planningAggregateToggleEl instanceof HTMLInputElement &&
    dom.planningAggregateToggleEl.checked;

  state.planningVisualAggregateMode = enabled;
  setPlanningAggregateShellState(enabled);
  await Promise.resolve(state.planningApi?.setVisualAggregateMode?.(enabled));

  if (enabled) {
    await refreshPlanningAggregatePresentation();
    return;
  }

  applyPlanningNormalFrameHeight();
  schedulePlanningFramePresentation();
  scheduleExpensesFramePresentation();
  schedulePlanningLayoutDebug("planning-aggregate-disabled");
}

function bindPlanningAggregateToggle() {
  if (!(dom.planningAggregateToggleEl instanceof HTMLInputElement)) {
    return;
  }

  dom.planningAggregateToggleEl.addEventListener("change", () => {
    void applyPlanningAggregateModeFromToggle();
  });
}

export async function bootstrapHubApp() {
  applyDebugBodyClass();
  bindPlanningIframeTooltipBridge();
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
    bindPlanningAggregateToggle();
    void applyPlanningAggregateModeFromToggle();

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

        void applySharedProject(nextProjectKey).then(() => {
          void refreshPlanningAggregatePresentation();
        });
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
