export const HUB_URL_PARAMS =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

export const LAYOUT_DEBUG_ENABLED = HUB_URL_PARAMS?.get("debugLayout") === "1";
export const DEBUG_DISABLE_STICKY_SHELL = HUB_URL_PARAMS?.get("noStickyShell") === "1";

export const DAY_IN_MS = 86400000;
export const DEFAULT_PLANNING_FRAME_HEIGHT = 820;
export const MIN_PLANNING_FRAME_HEIGHT = 280;
export const MAX_PLANNING_FRAME_HEIGHT = 1600;
export const PLANNING_FRAME_HEIGHT_STORAGE_KEY = "sync-planning.top-frame-height";

export const FRAME_LOAD_TIMEOUT_MS = 30000;
export const CHILD_API_POLL_INTERVAL_MS = 120;
export const EXPENSES_ALIGNMENT_INITIAL_DELAY_MS = 90;
export const EXPENSES_ALIGNMENT_RETRY_DELAY_MS = 140;
export const PROJECT_SELECTION_STABILIZE_DELAY_MS = 180;

export const SHARED_VIEWPORT_RULES = {
  referenceMonthDays: 30.4375,
  minVisibleDays: 7,
  yearMaxVisibleMonths: 14,
};
