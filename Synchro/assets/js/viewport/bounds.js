import { SHARED_VIEWPORT_RULES } from "../app/constants.js";
import { state } from "../app/state.js";
import { clamp } from "./normalize.js";

export function getSharedVisibleDaysBounds(viewport = {}) {
  const fallbackMonthVisibleDays = Number(SHARED_VIEWPORT_RULES.referenceMonthDays) || 30.4375;
  const fallbackMinVisibleDays = Number(SHARED_VIEWPORT_RULES.minVisibleDays) || 7;
  const fallbackMaxVisibleDays =
    fallbackMonthVisibleDays *
    Math.max(1, Number(SHARED_VIEWPORT_RULES.yearMaxVisibleMonths) || 14);
  let sourceBounds = null;

  if (state.expensesApi?.getViewportBounds) {
    try {
      sourceBounds = state.expensesApi.getViewportBounds(viewport) || null;
    } catch (error) {
      console.warn("Impossible de lire les bornes de gestion-depenses2 :", error);
    }
  }

  const monthVisibleDays =
    Number(sourceBounds?.monthVisibleDays) > 0
      ? Number(sourceBounds.monthVisibleDays)
      : fallbackMonthVisibleDays;
  const minVisibleDays =
    Number(sourceBounds?.minVisibleDays) > 0
      ? Number(sourceBounds.minVisibleDays)
      : fallbackMinVisibleDays;
  const maxVisibleDays =
    Number(sourceBounds?.maxVisibleDays) > 0
      ? Math.max(monthVisibleDays, Number(sourceBounds.maxVisibleDays))
      : Math.max(monthVisibleDays, fallbackMaxVisibleDays);
  const yearThreshold =
    Number(sourceBounds?.yearThreshold) > 0
      ? Number(sourceBounds.yearThreshold)
      : monthVisibleDays * 10;

  return {
    monthVisibleDays,
    minVisibleDays,
    maxVisibleDays,
    yearThreshold,
  };
}

export function isSupportedSharedMode(mode) {
  return mode === "week" || mode === "month" || mode === "year";
}

export function deriveSharedModeFromVisibleDays(nextVisibleDays, viewport = {}) {
  const { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold } =
    getSharedVisibleDaysBounds(viewport);
  const visibleDays = clamp(Math.round(nextVisibleDays || 0), minVisibleDays, maxVisibleDays);

  if (visibleDays < monthVisibleDays) {
    return "week";
  }

  if (visibleDays >= yearThreshold) {
    return "year";
  }

  return "month";
}

export function getTargetVisibleDaysForMode(nextMode, viewport = {}) {
  const { monthVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds(viewport);

  if (nextMode === "week") {
    return 7;
  }

  if (nextMode === "year") {
    return Math.round(Math.min(maxVisibleDays, monthVisibleDays * 12));
  }

  return Math.ceil(monthVisibleDays);
}

export function syncPlanningViewportBounds(viewport = {}) {
  if (!state.planningApi?.setViewportBounds || !state.expensesApi?.getViewportBounds) {
    return;
  }

  try {
    const bounds = state.expensesApi.getViewportBounds(viewport) || null;
    if (bounds) {
      state.planningApi.setViewportBounds(bounds);
      if (state.planningAxisApi?.setViewportBounds) {
        state.planningAxisApi.setViewportBounds(bounds);
      }
    }
  } catch (error) {
    console.warn("Impossible de synchroniser les bornes du planning :", error);
  }
}
