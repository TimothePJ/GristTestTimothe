// Canonical shared viewport model — visible-days bounds and zoom-mode
// helpers, adapted from Synchro's assets/js/viewport/bounds.js.
//
// Synchro's getSharedVisibleDaysBounds() sourced its bounds from
// `state.expensesApi.getViewportBounds(viewport)`, falling back to
// `SHARED_VIEWPORT_RULES`. planning-synchro has no expenses API / shared
// app state to consult, so this version reads bounds directly (and only)
// from APP_CONFIG.viewport, per the task brief.
//
// No top-level access to window/document/localStorage/state: safe to
// import under Node.

import { APP_CONFIG } from "../config.js";
import { clamp } from "./normalize.js";

export function getSharedVisibleDaysBounds() {
  const monthVisibleDays = Number(APP_CONFIG.viewport.referenceMonthDays) || 30.4375;
  const minVisibleDays = Number(APP_CONFIG.viewport.minVisibleDays) || 7;
  const maxVisibleDays = Number(APP_CONFIG.viewport.maxVisibleDays) || 366;
  return { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold: monthVisibleDays * 10 };
}

export function isSupportedSharedMode(mode) {
  return mode === "week" || mode === "month" || mode === "year";
}

export function deriveSharedModeFromVisibleDays(nextVisibleDays) {
  const { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold } = getSharedVisibleDaysBounds();
  const visibleDays = clamp(Math.round(nextVisibleDays || 0), minVisibleDays, maxVisibleDays);

  if (visibleDays < monthVisibleDays) {
    return "week";
  }

  if (visibleDays >= yearThreshold) {
    return "year";
  }

  return "month";
}

export function getTargetVisibleDaysForMode(nextMode) {
  const { monthVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds();

  if (nextMode === "week") {
    return 7;
  }

  if (nextMode === "year") {
    return Math.round(Math.min(maxVisibleDays, monthVisibleDays * 12));
  }

  return Math.ceil(monthVisibleDays);
}
