// Draggable splitter that controls the top (planning) pane's visible height.
//
// The pure clamp/height math lives in top/paneMath.js (unit-tested). This
// module is the DOM half: it measures the rendered vis-timeline (axis band +
// per-row heights), applies the computed pixel height to #ps-planning, and
// wires the splitter's pointer/keyboard interactions. It cannot be unit-tested
// under `node --test` (needs a real layout); it is verified in the browser
// harness.
//
// `desiredRows` (the user's chosen visible-rows target, 5..16) is owned by the
// caller (main.js keeps it in a session-scoped closure via
// getDesiredRows/setDesiredRows) so it survives project switches. It is stored
// in ROW units, not pixels, because the axis band height changes with the zoom
// mode — rows are stable, pixels are not.

import { computeTopPaneHeight, clampRows } from "../top/paneMath.js";

export function createTopPaneResizer({
  planningEl,
  splitterEl,
  getGroupCount,
  setMaxHeight,
  config,
  getDesiredRows,
  setDesiredRows,
} = {}) {
  const bounds = { minRows: config.minRows, maxRows: config.maxRows };

  let pointerId = null;
  let dragStartY = 0;
  let dragStartRows = 0;
  let dragRowHeightPx = config.fallbackRowHeightPx;

  // --- measurement ---------------------------------------------------------

  function measureAxisHeightPx() {
    const axisEl = planningEl && planningEl.querySelector(".vis-panel.vis-top");
    const h = axisEl ? axisEl.getBoundingClientRect().height : 0;
    return h > 0 ? h : config.fallbackAxisHeightPx;
  }

  function measureRowHeightPx() {
    // One vis group label == one task row; vis keeps the label height in sync
    // with the row height. Use the first real label's height (uniform in the
    // common one-line case); fall back to the labelset average, then a constant.
    const labels = planningEl ? planningEl.querySelectorAll(".vis-labelset .vis-label") : [];
    if (labels.length) {
      const first = labels[0].getBoundingClientRect().height;
      if (first > 0) return first;
      const set = planningEl.querySelector(".vis-labelset");
      if (set && set.scrollHeight > 0) return set.scrollHeight / labels.length;
    }
    return config.fallbackRowHeightPx;
  }

  function measure() {
    return {
      axisHeightPx: measureAxisHeightPx(),
      rowHeightPx: measureRowHeightPx(),
      groupCount: typeof getGroupCount === "function" ? getGroupCount() || 0 : 0,
    };
  }

  // --- apply ---------------------------------------------------------------

  function applyWith(measured, desiredRows) {
    const result = computeTopPaneHeight({
      axisHeightPx: measured.axisHeightPx,
      rowHeightPx: measured.rowHeightPx,
      groupCount: measured.groupCount,
      desiredRows,
      minRows: bounds.minRows,
      maxRows: bounds.maxRows,
    });
    // Hand the cap to vis-timeline (maxHeight): it renders min(content, cap),
    // adapting to content below the cap and scrolling internally above it.
    if (typeof setMaxHeight === "function") setMaxHeight(result.maxHeightPx);
    if (planningEl && typeof planningEl.classList?.toggle === "function") {
      planningEl.classList.toggle("is-scrolling", result.scrolls);
    }
    if (splitterEl) {
      splitterEl.setAttribute("aria-valuenow", String(Math.round(result.clampedRows)));
    }
    return result;
  }

  // Re-measure and re-apply on the next frame (post-layout): used after render,
  // after a viewport change (the axis band height changes between week/month/
  // year), and after a drag ends.
  let rafId = null;
  function refresh() {
    if (typeof requestAnimationFrame !== "function") {
      applyWith(measure(), getDesiredRows());
      return;
    }
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      applyWith(measure(), getDesiredRows());
    });
  }

  // --- drag ----------------------------------------------------------------

  function onPointerDown(event) {
    if (pointerId != null) return;
    pointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartRows = clampRows(getDesiredRows(), bounds);
    // Freeze the row height for the whole gesture (a drag never changes zoom),
    // so pointermove only writes layout — no read/write thrash.
    dragRowHeightPx = measureRowHeightPx();
    if (typeof splitterEl.setPointerCapture === "function") {
      try {
        splitterEl.setPointerCapture(pointerId);
      } catch (_) {
        /* pointer may not be active (e.g. synthetic events) — capture is best-effort */
      }
    }
    document.body.classList.add("ps-resizing");
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (event.pointerId !== pointerId) return;
    // Drag down => more visible rows (taller top pane); drag up => fewer.
    const deltaRows = (event.clientY - dragStartY) / dragRowHeightPx;
    const nextRows = clampRows(dragStartRows + deltaRows, bounds);
    setDesiredRows(nextRows);
    // Reuse the frozen axis/row measurements for a fluid, thrash-free update.
    applyWith(
      {
        axisHeightPx: measureAxisHeightPx(),
        rowHeightPx: dragRowHeightPx,
        groupCount: typeof getGroupCount === "function" ? getGroupCount() || 0 : 0,
      },
      nextRows
    );
  }

  function endDrag(event) {
    if (event.pointerId !== pointerId) return;
    if (typeof splitterEl.releasePointerCapture === "function") {
      try {
        splitterEl.releasePointerCapture(pointerId);
      } catch (_) {
        /* capture may already be gone */
      }
    }
    pointerId = null;
    document.body.classList.remove("ps-resizing");
    refresh(); // one clean re-measure/apply at the resting position
  }

  function onKeyDown(event) {
    let step = 0;
    if (event.key === "ArrowDown") step = 1;
    else if (event.key === "ArrowUp") step = -1;
    else return;
    event.preventDefault();
    const nextRows = clampRows(clampRows(getDesiredRows(), bounds) + step, bounds);
    setDesiredRows(nextRows);
    applyWith(measure(), nextRows);
  }

  // --- wiring --------------------------------------------------------------

  function onWindowResize() {
    refresh();
  }

  if (splitterEl) {
    splitterEl.setAttribute("aria-valuemin", String(bounds.minRows));
    splitterEl.setAttribute("aria-valuemax", String(bounds.maxRows));
    splitterEl.addEventListener("pointerdown", onPointerDown);
    splitterEl.addEventListener("pointermove", onPointerMove);
    splitterEl.addEventListener("pointerup", endDrag);
    splitterEl.addEventListener("pointercancel", endDrag);
    splitterEl.addEventListener("keydown", onKeyDown);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", onWindowResize);
  }

  function destroy() {
    if (rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (splitterEl) {
      splitterEl.removeEventListener("pointerdown", onPointerDown);
      splitterEl.removeEventListener("pointermove", onPointerMove);
      splitterEl.removeEventListener("pointerup", endDrag);
      splitterEl.removeEventListener("pointercancel", endDrag);
      splitterEl.removeEventListener("keydown", onKeyDown);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onWindowResize);
    }
    document.body.classList.remove("ps-resizing");
  }

  return { refresh, destroy };
}
