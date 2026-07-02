// Pure viewport interaction math — converts user interactions (mode
// change, pan, zoom, bounds-clamp) into new canonical shared viewports,
// plus a day->pixel projection used by the sync controller's alignment.
//
// Only imports from ../viewport/* and ../config.js: no top-level access
// to window/document/localStorage/state, safe to import under Node.

import { APP_CONFIG } from "../config.js";
import { buildCanonicalSharedViewport } from "../viewport/build.js";
import { getInclusiveDaySpan, normalizeIsoDate, shiftIsoDateValue } from "../viewport/normalize.js";

// applyMode(viewport, mode) -> canonical viewport with visibleDays set to
// the target mode's targetVisibleDays, keeping the same left anchor
// (firstVisibleDate unchanged).
export function applyMode(viewport, mode) {
  const zoomMode = APP_CONFIG.zoomModes[mode];
  const visibleDays = zoomMode ? zoomMode.targetVisibleDays : viewport.visibleDays;

  return buildCanonicalSharedViewport({
    mode,
    firstVisibleDate: viewport.firstVisibleDate,
    visibleDays,
  });
}

// panByDays(viewport, deltaDays) -> canonical viewport whose
// firstVisibleDate is shifted by deltaDays (via shiftIsoDateValue), same
// visibleDays.
export function panByDays(viewport, deltaDays) {
  const firstVisibleDate = shiftIsoDateValue(viewport.firstVisibleDate, deltaDays);

  return buildCanonicalSharedViewport({
    mode: viewport.mode,
    firstVisibleDate,
    visibleDays: viewport.visibleDays,
  });
}

// clampToBounds(viewport, bounds) -> canonical viewport whose
// [firstVisibleDate, rangeEndDate] stays within bounds.{startDate,endDate}:
// shift left if the window overruns the end, then shrink if it still can't
// fit; the window never starts before bounds.startDate.
export function clampToBounds(viewport, bounds) {
  const boundsStart = normalizeIsoDate(bounds && bounds.startDate);
  const boundsEnd = normalizeIsoDate(bounds && bounds.endDate);

  if (!boundsStart || !boundsEnd) {
    return buildCanonicalSharedViewport({ ...viewport });
  }

  let firstVisibleDate = normalizeIsoDate(viewport.firstVisibleDate) || boundsStart;
  let visibleDays = viewport.visibleDays;

  // Never start before bounds.startDate.
  if (firstVisibleDate < boundsStart) {
    firstVisibleDate = boundsStart;
  }

  // Shift left if the window overruns bounds.endDate.
  const rangeEndDate = shiftIsoDateValue(firstVisibleDate, visibleDays - 1);
  if (rangeEndDate > boundsEnd) {
    const shiftedStart = shiftIsoDateValue(boundsEnd, -(visibleDays - 1));
    firstVisibleDate = shiftedStart > boundsStart ? shiftedStart : boundsStart;
  }

  // Shrink if the window still can't fit within bounds (bounds span
  // narrower than visibleDays).
  const availableSpan = getInclusiveDaySpan(firstVisibleDate, boundsEnd);
  if (availableSpan > 0 && availableSpan < visibleDays) {
    visibleDays = availableSpan;
  }

  const canonicalViewport = buildCanonicalSharedViewport({
    mode: viewport.mode,
    firstVisibleDate,
    visibleDays,
  });

  // buildCanonicalSharedViewport re-imposes a minVisibleDays floor on
  // visibleDays; for a bounds span narrower than that floor, re-apply the
  // shrink so the returned window still never extends past bounds.endDate
  // (the invariant this function must guarantee). anchorDate must also be
  // re-derived from the FINAL shrunk visibleDays, otherwise it (computed
  // by buildCanonicalSharedViewport off the floored visibleDays) can land
  // past the shrunk rangeEndDate — an invalid canonical viewport that
  // later centering / today-marker logic keys off.
  if (canonicalViewport.rangeEndDate > boundsEnd) {
    return {
      ...canonicalViewport,
      visibleDays,
      anchorDate: shiftIsoDateValue(firstVisibleDate, Math.floor(visibleDays / 2)),
      rangeEndDate: shiftIsoDateValue(firstVisibleDate, visibleDays - 1),
    };
  }

  return canonicalViewport;
}

// getDayBoundaryLeftPx(viewport, isoDate, contentWidthPx) -> x pixel for a
// date's left edge: daysFromFirstVisible * (contentWidthPx / visibleDays),
// where daysFromFirstVisible is 0 for the viewport's first visible day.
export function getDayBoundaryLeftPx(viewport, isoDate, contentWidthPx) {
  const daysFromFirstVisible = getInclusiveDaySpan(viewport.firstVisibleDate, isoDate) - 1;
  return daysFromFirstVisible * (contentWidthPx / viewport.visibleDays);
}
