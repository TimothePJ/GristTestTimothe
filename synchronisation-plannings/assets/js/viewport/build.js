import { getReferencePlanningApi, state } from "../app/state.js";
import {
  clamp,
  getInclusiveDaySpan,
  getIsoDateFromExactTimestamp,
  normalizeIsoDate,
  parseSharedExactNumber,
  shiftIsoDateValue,
} from "./normalize.js";
import {
  deriveSharedModeFromVisibleDays,
  getSharedVisibleDaysBounds,
  isSupportedSharedMode,
} from "./bounds.js";

export function buildCanonicalSharedViewport(viewport = {}) {
  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds(viewport);
  const rawVisibleDays = Number(viewport.visibleDays);
  const exactWindowStartMs = parseSharedExactNumber(viewport.windowStartMs);
  const fallbackStartDate = normalizeIsoDate(viewport.rangeStartDate);
  const firstVisibleDate =
    normalizeIsoDate(viewport.firstVisibleDate) ||
    getIsoDateFromExactTimestamp(exactWindowStartMs) ||
    fallbackStartDate;
  const visibleDays = clamp(
    Number.isFinite(rawVisibleDays) && rawVisibleDays > 0 ? Math.round(rawVisibleDays) : 31,
    minVisibleDays,
    maxVisibleDays
  );
  const rangeEndDate = shiftIsoDateValue(firstVisibleDate, visibleDays - 1);
  const anchorDate =
    normalizeIsoDate(viewport.anchorDate) ||
    shiftIsoDateValue(firstVisibleDate, Math.floor(visibleDays / 2)) ||
    firstVisibleDate;
  const explicitMode = String(viewport.mode || "").trim();

  return {
    ...viewport,
    mode: isSupportedSharedMode(explicitMode)
      ? explicitMode
      : deriveSharedModeFromVisibleDays(visibleDays, {
          ...viewport,
          firstVisibleDate,
          rangeStartDate: firstVisibleDate,
          visibleDays,
        }),
    anchorDate,
    firstVisibleDate,
    visibleDays,
    rangeStartDate: firstVisibleDate,
    rangeEndDate,
  };
}

export function buildPlanningExactSharedViewport(viewport = {}) {
  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  const windowStartMs = parseSharedExactNumber(viewport?.windowStartMs);
  const windowEndMs = parseSharedExactNumber(viewport?.windowEndMs);

  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
    return canonicalViewport;
  }

  return {
    ...canonicalViewport,
    windowStartMs,
    windowEndMs,
    leftDayOffset: Number.isFinite(parseSharedExactNumber(viewport?.leftDayOffset))
      ? Number(viewport.leftDayOffset)
      : canonicalViewport.leftDayOffset,
    rightDayOffset: Number.isFinite(parseSharedExactNumber(viewport?.rightDayOffset))
      ? Number(viewport.rightDayOffset)
      : canonicalViewport.rightDayOffset,
    exactVisibleDays: Number.isFinite(parseSharedExactNumber(viewport?.exactVisibleDays))
      ? Number(viewport.exactVisibleDays)
      : canonicalViewport.exactVisibleDays,
    contentStartDate: normalizeIsoDate(viewport?.contentStartDate) || canonicalViewport.contentStartDate,
    contentStartMs: Number.isFinite(parseSharedExactNumber(viewport?.contentStartMs))
      ? Number(viewport.contentStartMs)
      : canonicalViewport.contentStartMs,
  };
}

export function stripExactWindowViewportState(viewport = {}) {
  const nextViewport = { ...viewport };
  delete nextViewport.windowStartMs;
  delete nextViewport.windowEndMs;
  delete nextViewport.leftDayOffset;
  delete nextViewport.rightDayOffset;
  delete nextViewport.exactVisibleDays;
  delete nextViewport.contentStartDate;
  delete nextViewport.contentStartMs;
  return nextViewport;
}

export function normalizeProjectDateBounds(projectDateBounds = null) {
  const startDate = normalizeIsoDate(projectDateBounds?.startDate || projectDateBounds?.firstDate);
  const endDate = normalizeIsoDate(projectDateBounds?.endDate || projectDateBounds?.lastDate);

  if (!startDate && !endDate) {
    return null;
  }

  const normalizedStartDate = startDate || endDate;
  const normalizedEndDate = endDate || startDate;
  if (!normalizedStartDate || !normalizedEndDate) {
    return null;
  }

  return {
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    spanDays:
      Math.max(
        1,
        Number(projectDateBounds?.spanDays) ||
          getInclusiveDaySpan(normalizedStartDate, normalizedEndDate)
      ) || 1,
  };
}

export function buildSharedProjectDateBounds({
  planningDateBounds = null,
  expensesDateBounds = null,
} = {}) {
  const normalizedPlanningBounds = normalizeProjectDateBounds(planningDateBounds);
  const normalizedExpensesBounds = normalizeProjectDateBounds(expensesDateBounds);

  if (normalizedPlanningBounds) {
    return normalizedPlanningBounds;
  }

  return normalizedExpensesBounds;
}

export function buildProjectSelectionViewport(projectDateBounds = null, fallbackViewport = {}) {
  const fallbackSharedViewport = buildCanonicalSharedViewport(
    stripExactWindowViewportState(fallbackViewport)
  );
  const projectStartDate = normalizeIsoDate(
    projectDateBounds?.startDate || projectDateBounds?.firstDate
  );
  const projectEndDate = normalizeIsoDate(projectDateBounds?.endDate || projectDateBounds?.lastDate);

  if (!projectStartDate || !projectEndDate) {
    return fallbackSharedViewport;
  }

  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds({
    ...fallbackViewport,
    firstVisibleDate: projectStartDate,
    rangeStartDate: projectStartDate,
    anchorDate: projectStartDate,
  });
  const projectSpanDays = clamp(
    Number(projectDateBounds?.spanDays) || getInclusiveDaySpan(projectStartDate, projectEndDate) || minVisibleDays,
    minVisibleDays,
    maxVisibleDays
  );

  return buildCanonicalSharedViewport({
    ...fallbackSharedViewport,
    windowStartMs: null,
    windowEndMs: null,
    leftDayOffset: null,
    rightDayOffset: null,
    exactVisibleDays: null,
    contentStartDate: "",
    contentStartMs: null,
    anchorDate: projectStartDate,
    firstVisibleDate: projectStartDate,
    rangeStartDate: projectStartDate,
    visibleDays: projectSpanDays,
    rangeEndDate: shiftIsoDateValue(projectStartDate, projectSpanDays - 1),
  });
}

export function getCurrentSharedViewport() {
  const referencePlanningApi = getReferencePlanningApi();
  const baseViewport =
    state.sharedViewportState ||
    state.expensesApi?.getViewport?.() ||
    referencePlanningApi?.getViewport?.() ||
    null;

  return baseViewport ? buildCanonicalSharedViewport(baseViewport) : null;
}
