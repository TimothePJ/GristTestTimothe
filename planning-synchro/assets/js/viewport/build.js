// Canonical shared viewport model — construction helpers.
//
// buildCanonicalSharedViewport() is ported from Synchro's
// assets/js/viewport/build.js. Dropped from the Synchro original:
// buildPlanningExactSharedViewport, stripExactWindowViewportState,
// buildPlanningLedProjectSelectionViewport, buildProjectSelectionViewport,
// getCurrentSharedViewport, normalizeProjectDateBounds and
// buildSharedProjectDateBounds — all iframe/exact-window-specific or
// dependent on `../app/state.js` / getReferencePlanningApi, none of which
// exist in planning-synchro and none of which are part of this task's
// interface.
//
// buildInitialProjectViewport() is new: it anchors a ~365-day window
// (APP_CONFIG.initialWindowDays) on the project's first planning date,
// clamped to the supplied project date bounds.
//
// No top-level access to window/document/localStorage/state: safe to
// import under Node.

import { APP_CONFIG } from "../config.js";
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
  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds();
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
    mode: isSupportedSharedMode(explicitMode) ? explicitMode : deriveSharedModeFromVisibleDays(visibleDays),
    anchorDate,
    firstVisibleDate,
    visibleDays,
    rangeStartDate: firstVisibleDate,
    rangeEndDate,
  };
}

export function buildInitialProjectViewport({ firstPlanningDate, bounds }) {
  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds();
  const boundsStart = normalizeIsoDate(bounds?.startDate);
  const boundsEnd = normalizeIsoDate(bounds?.endDate);
  let anchor = normalizeIsoDate(firstPlanningDate) || boundsStart;
  if (boundsStart && anchor && anchor < boundsStart) anchor = boundsStart;
  if (!anchor) anchor = boundsStart || boundsEnd;
  const boundsSpan = boundsStart && boundsEnd ? getInclusiveDaySpan(boundsStart, boundsEnd) : APP_CONFIG.initialWindowDays;
  let visibleDays = clamp(Math.min(APP_CONFIG.initialWindowDays, boundsSpan), minVisibleDays, maxVisibleDays);
  // keep window within bounds end
  if (boundsEnd && anchor) {
    const maxSpanFromAnchor = getInclusiveDaySpan(anchor, boundsEnd);
    // The "don't exceed bounds end" cap takes priority over the minVisibleDays
    // floor: for a narrow bounds span (< minVisibleDays) we must NOT clamp back
    // up, or rangeEndDate would run past bounds.endDate.
    visibleDays = Math.max(1, Math.min(visibleDays, maxSpanFromAnchor));
  }
  const canonicalViewport = buildCanonicalSharedViewport({
    firstVisibleDate: anchor, rangeStartDate: anchor, anchorDate: anchor, visibleDays,
  });
  // buildCanonicalSharedViewport re-imposes the minVisibleDays floor on
  // visibleDays; re-apply the narrow-span cap so the returned window still
  // never extends past bounds.endDate (the invariant later tasks depend on).
  if (boundsEnd && canonicalViewport.rangeEndDate > boundsEnd) {
    return {
      ...canonicalViewport,
      visibleDays,
      rangeEndDate: shiftIsoDateValue(anchor, visibleDays - 1),
    };
  }
  return canonicalViewport;
}
