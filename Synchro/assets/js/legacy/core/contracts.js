import {
  addDays,
  getTodayIsoDate,
  normalizeIsoDate,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "../utils/date.js";

export const PLANNING_SYNC_VERSION = 1;
export const DEFAULT_SYNC_STORAGE_KEY = "planning-viewport-sync:v1";
export const DEFAULT_SYNC_EVENT_NAME = "planning-viewport-sync";
export const VIEWPORT_MODES = ["week", "month", "year", "custom"];

function normalizeAppId(rawValue) {
  return String(rawValue || "").trim();
}

function normalizeScopeValue(rawValue) {
  return String(rawValue || "").trim();
}

function getDefaultVisibleDays(mode) {
  if (mode === "week") {
    return 7;
  }
  if (mode === "month") {
    return 31;
  }
  if (mode === "year") {
    return 365;
  }
  return 31;
}

function getModeFallbackStart(mode, anchorDate) {
  if (mode === "week") {
    return startOfWeek(anchorDate);
  }
  if (mode === "month") {
    return startOfMonth(anchorDate);
  }
  if (mode === "year") {
    return startOfYear(anchorDate);
  }
  return normalizeIsoDate(anchorDate);
}

function normalizeMode(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return VIEWPORT_MODES.includes(normalized) ? normalized : "month";
}

function normalizeExactNumber(rawValue) {
  if (rawValue == null || rawValue === "") {
    return null;
  }

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function normalizePlanningScope(rawScope = {}) {
  return {
    projectId: normalizeScopeValue(rawScope.projectId),
    zoneId: normalizeScopeValue(rawScope.zoneId),
  };
}

export function normalizePlanningViewport(rawViewport = {}) {
  const mode = normalizeMode(rawViewport.mode);
  const windowStartMs = normalizeExactNumber(rawViewport.windowStartMs);
  const windowEndMs = normalizeExactNumber(rawViewport.windowEndMs);
  const anchorDate =
    normalizeIsoDate(rawViewport.anchorDate) ||
    normalizeIsoDate(rawViewport.firstVisibleDate) ||
    getTodayIsoDate();

  const rawVisibleDays = Number(rawViewport.visibleDays);
  const visibleDays =
    Number.isFinite(rawVisibleDays) && rawVisibleDays > 0
      ? Math.round(rawVisibleDays)
      : getDefaultVisibleDays(mode);

  const firstVisibleDate =
    normalizeIsoDate(rawViewport.firstVisibleDate) || getModeFallbackStart(mode, anchorDate);

  const rangeStartDate = normalizeIsoDate(rawViewport.rangeStartDate) || firstVisibleDate;
  const rangeEndDate =
    normalizeIsoDate(rawViewport.rangeEndDate) ||
    addDays(rangeStartDate, Math.max(visibleDays - 1, 0));

  return {
    mode,
    anchorDate,
    firstVisibleDate,
    visibleDays,
    rangeStartDate,
    rangeEndDate,
    windowStartMs,
    windowEndMs,
    leftDayOffset: normalizeExactNumber(rawViewport.leftDayOffset),
    rightDayOffset: normalizeExactNumber(rawViewport.rightDayOffset),
    exactVisibleDays: normalizeExactNumber(rawViewport.exactVisibleDays),
    contentStartDate: normalizeIsoDate(rawViewport.contentStartDate),
    contentStartMs: normalizeExactNumber(rawViewport.contentStartMs),
  };
}

export function createPlanningViewportSnapshot({
  appId = "",
  scope = {},
  viewport = {},
  sentAt = "",
} = {}) {
  return {
    version: PLANNING_SYNC_VERSION,
    appId: normalizeAppId(appId),
    sentAt: String(sentAt || new Date().toISOString()),
    scope: normalizePlanningScope(scope),
    viewport: normalizePlanningViewport(viewport),
  };
}

export function isPlanningViewportSnapshot(value) {
  return (
    value &&
    typeof value === "object" &&
    Number(value.version) === PLANNING_SYNC_VERSION &&
    typeof value.appId === "string" &&
    value.scope &&
    typeof value.scope === "object" &&
    value.viewport &&
    typeof value.viewport === "object"
  );
}

export function scopesOverlap(localScope = {}, remoteScope = {}) {
  const normalizedLocalScope = normalizePlanningScope(localScope);
  const normalizedRemoteScope = normalizePlanningScope(remoteScope);

  if (!normalizedLocalScope.projectId || !normalizedRemoteScope.projectId) {
    return false;
  }

  if (normalizedLocalScope.projectId !== normalizedRemoteScope.projectId) {
    return false;
  }

  if (
    normalizedLocalScope.zoneId &&
    normalizedRemoteScope.zoneId &&
    normalizedLocalScope.zoneId !== normalizedRemoteScope.zoneId
  ) {
    return false;
  }

  return true;
}

export function areViewportsEqual(leftViewport = {}, rightViewport = {}) {
  const left = normalizePlanningViewport(leftViewport);
  const right = normalizePlanningViewport(rightViewport);

  return (
    left.mode === right.mode &&
    left.anchorDate === right.anchorDate &&
    left.firstVisibleDate === right.firstVisibleDate &&
    left.visibleDays === right.visibleDays &&
    left.rangeStartDate === right.rangeStartDate &&
    left.rangeEndDate === right.rangeEndDate &&
    left.windowStartMs === right.windowStartMs &&
    left.windowEndMs === right.windowEndMs &&
    left.leftDayOffset === right.leftDayOffset &&
    left.rightDayOffset === right.rightDayOffset &&
    left.contentStartDate === right.contentStartDate &&
    left.contentStartMs === right.contentStartMs
  );
}

export function formatSnapshotSummary(snapshot) {
  if (!isPlanningViewportSnapshot(snapshot)) {
    return "message invalide";
  }

  const projectPart = snapshot.scope.projectId || "aucun projet";
  const zonePart = snapshot.scope.zoneId ? ` / zone ${snapshot.scope.zoneId}` : "";
  const viewport = snapshot.viewport;

  return [
    snapshot.appId || "app inconnue",
    `${projectPart}${zonePart}`,
    viewport.mode,
    `${viewport.rangeStartDate} -> ${viewport.rangeEndDate}`,
    `${viewport.visibleDays} jours`,
  ].join(" | ");
}
