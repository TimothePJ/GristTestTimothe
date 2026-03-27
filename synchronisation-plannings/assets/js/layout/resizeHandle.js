import {
  DEFAULT_PLANNING_FRAME_HEIGHT,
  MAX_PLANNING_FRAME_HEIGHT,
  MIN_PLANNING_FRAME_HEIGHT,
  PLANNING_FRAME_HEIGHT_STORAGE_KEY,
} from "../app/constants.js";
import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
import { schedulePlanningLayoutDebug } from "./debugLayout.js";
import { scheduleExpensesFramePresentation } from "./framePresentation.js";

export function clampPlanningFrameHeight(height) {
  const numericHeight = Number(height);
  if (!Number.isFinite(numericHeight)) {
    return DEFAULT_PLANNING_FRAME_HEIGHT;
  }

  return Math.min(MAX_PLANNING_FRAME_HEIGHT, Math.max(MIN_PLANNING_FRAME_HEIGHT, numericHeight));
}

export function persistPlanningFrameHeight(height) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      PLANNING_FRAME_HEIGHT_STORAGE_KEY,
      String(Math.round(clampPlanningFrameHeight(height)))
    );
  } catch (error) {
    console.warn("[sync] impossible d'enregistrer la hauteur du planning", error);
  }
}

export function getStoredPlanningFrameHeight() {
  if (typeof window === "undefined") {
    return Number.NaN;
  }

  try {
    const storedValue = Number(window.localStorage.getItem(PLANNING_FRAME_HEIGHT_STORAGE_KEY));
    return Number.isFinite(storedValue) ? clampPlanningFrameHeight(storedValue) : Number.NaN;
  } catch (error) {
    console.warn("[sync] impossible de relire la hauteur du planning", error);
    return Number.NaN;
  }
}

export function schedulePlanningFrameResizeRefresh(reason = "planning-frame-resize") {
  if (state.planningFrameResizeRefreshRafId) {
    return;
  }

  state.planningFrameResizeRefreshRafId = window.requestAnimationFrame(() => {
    state.planningFrameResizeRefreshRafId = 0;
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug(reason);
  });
}

export function applyPlanningFrameHeight(nextHeight, { persist = true, refresh = true } = {}) {
  const appliedHeight = clampPlanningFrameHeight(nextHeight);

  if (dom.planningFrameEl instanceof HTMLIFrameElement) {
    dom.planningFrameEl.style.height = `${appliedHeight}px`;
    dom.planningFrameEl.style.minHeight = `${appliedHeight}px`;
  }

  if (dom.planningResizeHandleEl instanceof HTMLElement) {
    dom.planningResizeHandleEl.setAttribute("aria-valuemin", String(MIN_PLANNING_FRAME_HEIGHT));
    dom.planningResizeHandleEl.setAttribute("aria-valuemax", String(MAX_PLANNING_FRAME_HEIGHT));
    dom.planningResizeHandleEl.setAttribute("aria-valuenow", String(Math.round(appliedHeight)));
    dom.planningResizeHandleEl.setAttribute("aria-valuetext", `${Math.round(appliedHeight)} pixels`);
  }

  if (persist) {
    persistPlanningFrameHeight(appliedHeight);
  }

  if (refresh) {
    schedulePlanningFrameResizeRefresh();
  }

  return appliedHeight;
}

export function bindPlanningFrameResizeHandle() {
  if (!(dom.planningResizeHandleEl instanceof HTMLElement)) {
    return;
  }

  const finishResize = () => {
    if (!state.planningFrameResizeState) {
      return;
    }

    const finalHeight =
      dom.planningFrameEl?.getBoundingClientRect?.().height || state.planningFrameResizeState.startHeight;

    document.body.classList.remove("is-sync-planning-resizing");
    applyPlanningFrameHeight(finalHeight, { persist: true, refresh: true });
    state.planningFrameResizeState = null;
  };

  dom.planningResizeHandleEl.addEventListener("dblclick", () => {
    applyPlanningFrameHeight(DEFAULT_PLANNING_FRAME_HEIGHT, { persist: true, refresh: true });
  });

  dom.planningResizeHandleEl.addEventListener("keydown", (event) => {
    const currentHeight =
      dom.planningFrameEl?.getBoundingClientRect?.().height || DEFAULT_PLANNING_FRAME_HEIGHT;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyPlanningFrameHeight(currentHeight - 32, { persist: true, refresh: true });
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      applyPlanningFrameHeight(currentHeight + 32, { persist: true, refresh: true });
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      applyPlanningFrameHeight(MIN_PLANNING_FRAME_HEIGHT, { persist: true, refresh: true });
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      applyPlanningFrameHeight(DEFAULT_PLANNING_FRAME_HEIGHT, { persist: true, refresh: true });
    }
  });

  dom.planningResizeHandleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const startHeight =
      dom.planningFrameEl?.getBoundingClientRect?.().height || DEFAULT_PLANNING_FRAME_HEIGHT;

    state.planningFrameResizeState = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
    };

    document.body.classList.add("is-sync-planning-resizing");
    dom.planningResizeHandleEl.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  dom.planningResizeHandleEl.addEventListener("pointermove", (event) => {
    if (!state.planningFrameResizeState || event.pointerId !== state.planningFrameResizeState.pointerId) {
      return;
    }

    const nextHeight =
      state.planningFrameResizeState.startHeight + (event.clientY - state.planningFrameResizeState.startY);
    applyPlanningFrameHeight(nextHeight, { persist: false, refresh: true });
  });

  dom.planningResizeHandleEl.addEventListener("pointerup", (event) => {
    if (!state.planningFrameResizeState || event.pointerId !== state.planningFrameResizeState.pointerId) {
      return;
    }

    dom.planningResizeHandleEl.releasePointerCapture?.(event.pointerId);
    finishResize();
  });

  dom.planningResizeHandleEl.addEventListener("pointercancel", (event) => {
    if (!state.planningFrameResizeState || event.pointerId !== state.planningFrameResizeState.pointerId) {
      return;
    }

    dom.planningResizeHandleEl.releasePointerCapture?.(event.pointerId);
    finishResize();
  });

  dom.planningResizeHandleEl.addEventListener("lostpointercapture", () => {
    finishResize();
  });
}
