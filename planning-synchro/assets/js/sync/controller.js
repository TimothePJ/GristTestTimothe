// Single-window shared viewport controller — the heart of planning-synchro.
//
// ONE canonical viewport `{ mode, firstVisibleDate, visibleDays,
// rangeStartDate, rangeEndDate, anchorDate }` drives BOTH the top pane
// (Task 10's read-only vis-timeline planning renderer) and the bottom pane
// (Task 11's editable charge-plan grid) synchronously, inside a single
// `requestAnimationFrame`, feeding both the SAME firstVisibleDate/visibleDays
// numbers. Because both panes live in the same document at the same content
// width and compute `dayWidth = contentWidthPx / visibleDays` off those same
// numbers (see bottom/chargeBoard.js "KEY ADAPTATIONS" #1 and
// sync/viewportMath.js's getDayBoundaryLeftPx), pixel alignment is
// ARITHMETIC — true by construction, not by measuring the DOM and nudging
// one pane toward the other. See docs/superpowers/specs/2026-07-02-planning-
// synchro-design.md section 6 ("Contrôleur de synchronisation") for the
// rationale: this replaces the fragile measure-DOM + nudgeViewportByPixels +
// retry-loop pattern with plain arithmetic, keeping only ONE post-layout
// assertion (console.warn, dev signal only — never a retry loop).
//
// DOM/orchestration module: requestAnimationFrame/window/document are only
// referenced inside function bodies (never at module top level), so this
// file imports cleanly, but createSyncController() itself cannot be
// unit-tested under `node --test` (no rAF/DOM there). Verified via
// `node --check` + structural read-through against the Task 9/10/11
// interfaces it consumes; real-browser pixel-alignment verification is
// deferred to Task 14, which wires main.js and actually mounts both panes
// against the dev harness (see task-13-report.md).

import {
  applyMode as applyViewportMode,
  panByDays,
  clampToBounds,
  getDayBoundaryLeftPx,
} from "./viewportMath.js";
import { buildCanonicalSharedViewport } from "../viewport/build.js";
import { shiftIsoDateValue } from "../viewport/normalize.js";
import { APP_CONFIG } from "../config.js";

// Post-layout alignment tolerance, in CSS pixels. Kept at the brief's exact
// "≤ 1px" acceptance threshold.
const ALIGNMENT_TOLERANCE_PX = 1;

// Fixed DOM ids from index.html / dev/harness.html — this widget mounts a
// single instance per page (no multi-instance/component-reuse requirement),
// so the alignment assertion queries these directly rather than requiring
// callers to pass container elements through the constructor (the Produce
// signature is fixed to `{ planningRenderer, chargeBoard, bounds,
// onRangeLabel }` per the task interface; neither renderer object exposes
// its own containerEl).
const PLANNING_PANE_SELECTOR = "#ps-planning";
const CHARGE_PANE_SELECTOR = "#ps-charge";

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoToFrDate(isoDate) {
  const parts = String(isoDate || "").split("-");
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

// Formats "DD/MM/YYYY - DD/MM/YYYY" out of the viewport's own
// firstVisibleDate/rangeEndDate — the brief's onRangeLabel contract accepts
// either the raw viewport ("call onRangeLabel(v)") or a formatted string
// ("or format a range string and pass it"); this passes BOTH (string first,
// full viewport second) so callers can use the ready-made label or re-derive
// their own without extra parsing.
function formatRangeLabel(viewport) {
  if (!viewport) return "";
  const start = isoToFrDate(viewport.firstVisibleDate);
  const end = isoToFrDate(viewport.rangeEndDate);
  return start && end ? `${start} - ${end}` : "";
}

export function createSyncController({ planningRenderer, chargeBoard, bounds, onRangeLabel } = {}) {
  let current = null;
  let pendingFrameId = null;
  let toolbarEl = null;
  let toolbarClickHandler = null;
  const wheelBindings = []; // [{ el, handler }] — bindWheel may be called once per pane.

  function getBaseViewport() {
    // Before the first setViewport() call, `current` is null: fall back to
    // an empty canonical viewport. clampToBounds already treats a missing/
    // empty firstVisibleDate as "start at bounds.startDate" (see
    // sync/viewportMath.js), so this degrades gracefully rather than
    // throwing — callers are expected to call setViewport() once up front
    // (Task 14 does, via buildInitialProjectViewport) before wiring
    // toolbar/wheel, but nothing here requires that ordering to avoid a
    // crash.
    return current || buildCanonicalSharedViewport({});
  }

  function refreshToolbarZoomButtons() {
    if (!(toolbarEl instanceof HTMLElement)) return;
    const activeMode = current ? current.mode : null;
    toolbarEl.querySelectorAll("[data-ps-zoom]").forEach((buttonEl) => {
      buttonEl.classList.toggle("is-active", buttonEl.dataset.psZoom === activeMode);
    });
  }

  // Single post-layout alignment assertion (dev safety net, NOT a retry
  // loop): runs exactly once per setViewport(), after the rAF that applied
  // the window to both panes. Bottom pane: getDayBoundaryLeftPx(viewport,
  // viewport.firstVisibleDate, contentWidthPx) is always 0 by construction
  // (see viewportMath.js), so the bottom pane's day-0 boundary sits exactly
  // at its timeline content-area's left edge. Top pane: vis-timeline exposes
  // no public "window start x" API, and probing its internals to compute an
  // exact pixel would invite exactly the fragile measure-and-nudge pattern
  // this controller replaces — so, per the task brief's explicit fallback,
  // this compares the two panes' timeline CONTENT-AREA left offsets
  // (getBoundingClientRect().left) instead: vis-timeline's own "center"
  // panel (to the right of its left label column) is where its window start
  // renders, analogous to the bottom pane's .charge-plan-cell--timeline /
  // .charge-plan-track. If either pane isn't mounted yet (e.g. before
  // Task 14 wires main.js), this silently no-ops — it is a dev signal, not
  // a correctness gate.
  function assertAlignment(viewport) {
    if (typeof document === "undefined" || !viewport) return;

    try {
      const contentWidthPx =
        typeof chargeBoard?.getContentWidthPx === "function" ? chargeBoard.getContentWidthPx() : 0;
      if (!(contentWidthPx > 0)) return;

      // Bottom pane's day-0 boundary offset from its own content-area left
      // edge — always 0 for viewport.firstVisibleDate, kept explicit here so
      // the intent ("compare getDayBoundaryLeftPx of the shared start on
      // both panes") reads directly rather than being hard-coded as a bare 0.
      const chargeDayZeroOffsetPx = getDayBoundaryLeftPx(viewport, viewport.firstVisibleDate, contentWidthPx);

      const chargeContentEl = document.querySelector(
        `${CHARGE_PANE_SELECTOR} .charge-plan-cell--timeline, ${CHARGE_PANE_SELECTOR} .charge-plan-track`
      );
      const planningContentEl = document.querySelector(
        `${PLANNING_PANE_SELECTOR} .vis-panel.vis-center, ${PLANNING_PANE_SELECTOR} .vis-center`
      );

      if (!(chargeContentEl instanceof Element) || !(planningContentEl instanceof Element)) {
        return; // panes not mounted yet — nothing to assert
      }

      const chargeStartLeftPx = chargeContentEl.getBoundingClientRect().left + chargeDayZeroOffsetPx;
      const planningStartLeftPx = planningContentEl.getBoundingClientRect().left;
      const delta = Math.abs(planningStartLeftPx - chargeStartLeftPx);

      if (delta > ALIGNMENT_TOLERANCE_PX) {
        console.warn("[planning-synchro] pane misalignment", delta);
      }
    } catch (error) {
      // Dev safety net only — never let a measurement error break real usage.
    }
  }

  function setViewport(viewport) {
    const next = clampToBounds(buildCanonicalSharedViewport(viewport || {}), bounds);
    current = next;
    refreshToolbarZoomButtons();

    if (pendingFrameId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(pendingFrameId);
      pendingFrameId = null;
    }

    if (typeof requestAnimationFrame !== "function") {
      // Non-browser environment guard (this module is never unit-tested
      // under Node, but staying defensive costs nothing here).
      return next;
    }

    pendingFrameId = requestAnimationFrame(() => {
      pendingFrameId = null;

      // ONE rAF drives BOTH panes off the SAME window, so alignment is
      // arithmetic rather than a race between two independently-scheduled
      // updates.
      if (typeof planningRenderer?.setWindow === "function") {
        planningRenderer.setWindow(next.firstVisibleDate, next.rangeEndDate);
      }
      if (typeof chargeBoard?.setWindow === "function") {
        chargeBoard.setWindow(next);
      }

      if (typeof onRangeLabel === "function") {
        onRangeLabel(formatRangeLabel(next), next);
      }

      // Follow-up rAF: run the single post-layout alignment assertion after
      // both panes have had a chance to lay out from the setWindow() calls
      // above (no retry loop — see assertAlignment's own comment).
      requestAnimationFrame(() => {
        assertAlignment(next);
      });
    });

    return next;
  }

  function getViewport() {
    return current;
  }

  function applyMode(mode) {
    return setViewport(applyViewportMode(getBaseViewport(), mode));
  }

  function pan(deltaDays) {
    return setViewport(panByDays(getBaseViewport(), deltaDays));
  }

  function today() {
    const base = getBaseViewport();
    // Left-anchor on today; setViewport()'s clampToBounds call handles the
    // case where today falls outside bounds (clamps into range).
    return setViewport({
      mode: base.mode,
      firstVisibleDate: todayIsoDate(),
      visibleDays: base.visibleDays,
    });
  }

  function handleToolbarClick(event) {
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-ps-zoom], #ps-prev, #ps-next, #ps-today")
        : null;
    if (!target) return;

    const zoomMode = target.dataset ? target.dataset.psZoom : "";
    if (zoomMode) {
      event.preventDefault();
      applyMode(zoomMode);
      return;
    }

    if (target.id === "ps-prev") {
      event.preventDefault();
      pan(-getBaseViewport().visibleDays);
      return;
    }

    if (target.id === "ps-next") {
      event.preventDefault();
      pan(getBaseViewport().visibleDays);
      return;
    }

    if (target.id === "ps-today") {
      event.preventDefault();
      today();
    }
  }

  function bindToolbar(nextToolbarEl) {
    unbindToolbar();
    if (!(nextToolbarEl instanceof HTMLElement)) return;

    toolbarEl = nextToolbarEl;
    toolbarClickHandler = handleToolbarClick;
    toolbarEl.addEventListener("click", toolbarClickHandler);
    refreshToolbarZoomButtons();
  }

  function unbindToolbar() {
    if (toolbarEl instanceof HTMLElement && toolbarClickHandler) {
      toolbarEl.removeEventListener("click", toolbarClickHandler);
    }
    toolbarEl = null;
    toolbarClickHandler = null;
  }

  // Zooms visibleDays around the date under the cursor. Simple, approximate
  // anchor: the cursor's fractional x position within the pane it's over is
  // assumed to stay at the same fractional position after the resize (this
  // is the same anchor-preservation idea as a typical map/timeline
  // ctrl+wheel zoom, just computed off viewport day-math instead of a
  // pixel-precise DOM slot lookup — "keep it simple", per the brief).
  function handleWheel(event) {
    event.preventDefault();

    const base = getBaseViewport();
    if (!base.firstVisibleDate || !(base.visibleDays > 0)) return;

    const { minVisibleDays, maxVisibleDays } = APP_CONFIG.viewport;
    const direction = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
    if (direction === 0) return;

    const zoomStepDays = Math.max(1, Math.round(base.visibleDays * 0.1));
    const nextVisibleDays = clampNumber(base.visibleDays + direction * zoomStepDays, minVisibleDays, maxVisibleDays);
    if (nextVisibleDays === base.visibleDays) return;

    const paneEl =
      (event.target instanceof Element && event.target.closest(".ps-pane")) || event.currentTarget;
    const rect =
      paneEl && typeof paneEl.getBoundingClientRect === "function" ? paneEl.getBoundingClientRect() : null;
    const fraction = rect && rect.width > 0 ? clampNumber((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;

    const cursorDayOffset = Math.round(fraction * (base.visibleDays - 1));
    const cursorIsoDate = shiftIsoDateValue(base.firstVisibleDate, cursorDayOffset);

    const nextCursorDayOffset = Math.round(fraction * (nextVisibleDays - 1));
    const nextFirstVisibleDate = shiftIsoDateValue(cursorIsoDate, -nextCursorDayOffset);

    // mode is intentionally left unset here: buildCanonicalSharedViewport
    // (inside setViewport) then derives mode from the new visibleDays, so a
    // wheel-zoom crossing a week/month/year threshold updates the toolbar's
    // active button — unlike applyMode/pan/today, which deliberately keep
    // the user's chosen zoom mode fixed.
    setViewport({ firstVisibleDate: nextFirstVisibleDate, visibleDays: nextVisibleDays });
  }

  function bindWheel(targetEl) {
    if (!(targetEl instanceof HTMLElement)) return;
    targetEl.addEventListener("wheel", handleWheel, { passive: false });
    wheelBindings.push({ el: targetEl, handler: handleWheel });
  }

  function unbindWheel() {
    wheelBindings.splice(0).forEach(({ el, handler }) => {
      el.removeEventListener("wheel", handler);
    });
  }

  function destroy() {
    if (pendingFrameId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(pendingFrameId);
      pendingFrameId = null;
    }
    unbindToolbar();
    unbindWheel();
  }

  return {
    setViewport,
    getViewport,
    applyMode,
    pan,
    today,
    bindToolbar,
    bindWheel,
    destroy,
  };
}
