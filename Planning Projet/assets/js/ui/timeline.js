let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;
let toolbarListenersBound = false;
let dataAnchorDate = null;
let hoverTooltipEl = null;
let hoverTooltipBound = false;
let clickTooltipTimer = null;
let itemElementsObserver = null;
let timelineBulkUpdateInProgress = false;
let lastRenderedTimelineSignature = "";
let timelineHasRenderedData = false;
let durationCellEditHandler = null;
let durationCellEditBound = false;
let activeDurationEditor = null;
let retardJustificationHandler = null;
let referenceDetailsHandler = null;
let activeRetardJustificationContext = null;
let retardContextMenuEl = null;
let retardDialogEl = null;
let referenceDetailsDialogEl = null;
let referenceDetailsRefreshInFlight = false;
let referenceDetailsRefreshPending = false;
let referenceDetailsLifecycleBound = false;
let referenceDetailsMidnightTimer = 0;
let stickyAxisBound = false;
let stickyAxisRafPending = false;
let axisLeftFillerEl = null;
let msProjectRowDropHandler = null;
let msProjectDropBound = false;
let activeMsDropRowEl = null;
let activeMsDropCellEl = null;
let msProjectGlobalDragCursorActive = false;
let planningRowDragBound = false;
let planningRowDragGlobalListenersBound = false;
let planningRowDragContainerEl = null;
let activePlanningDraggedRowEl = null;
let activePlanningDraggedLinkedRowEls = [];
let activePlanningNativeDragImageEl = null;
let planningRowDropBound = false;
let planningRowDropHandler = null;
let activePlanningDropRowEl = null;
let activePlanningDropZoneEl = null;
let activePlanningDropPosition = "";
let activePlanningDropPreviewRowEl = null;
let activePlanningDropPreviewLabelEl = null;
let planningDropPlacementOverlayEl = null;
let planningDragAutoScrollRafId = 0;
let planningDragAutoScrollVelocityY = 0;
let planningDragAutoScrollTargetEl = null;
let planningDragAutoScrollLastTs = 0;
const planningViewportListeners = new Set();
const planningSelectionListeners = new Set();
const REFERENCE_DATA_CHANGE_STORAGE_KEY = "grist.references-data-change";
let lastPlanningViewportEmissionSignature = "";
let lastPlanningSelectionEmissionSignature = "";
let pendingProgrammaticPlanningViewportSignature = "";
let pendingProgrammaticPlanningViewportTimer = 0;
let pendingProgrammaticPlanningViewportExpiresAt = 0;
const EMBEDDED_PLANNING_SYNC_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("embedded") === "planning-sync";
const EXTERNAL_AXIS_EMBEDDED_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("externalAxis") === "1";
let embeddedPlanningViewportBounds = {
  minVisibleDays: 7,
  maxVisibleDays: 392,
};
let planningViewportBoundsCorrectionPending = false;
const PROGRAMMATIC_PLANNING_VIEWPORT_SUPPRESSION_MS = 600;
const PLANNING_SYNC_TRACE_LABEL =
  typeof window === "undefined"
    ? "planning"
    : new URLSearchParams(window.location.search).get("headerOnly") === "1"
    ? "planning-axis"
    : EXTERNAL_AXIS_EMBEDDED_MODE
    ? "planning-main"
    : EMBEDDED_PLANNING_SYNC_MODE
    ? "planning-embedded"
    : "planning";
let planningSyncTraceSequence = 0;
let planningViewportSettlePending = false;
let planningViewportSettleToken = 0;
let planningViewportSettleWaiters = [];
let planningPaneResizerBound = false;
let activePlanningPaneResize = null;
let pendingPlanningPaneResizeWidth = null;
let planningPaneResizeRafId = 0;
let visualAggregateModeEnabled = false;
let lastPlanningTimelineData = { groups: [], items: [] };

const PLANNING_PARENT_TOOLTIP_MESSAGE_TYPE = "planning-projet-hover-tooltip";
const REFERENCE_DETAILS_EMPTY_DATE_ISO = "1900-01-01";
const REFERENCE_DETAILS_DAY_MS = 86400000;

const PLANNING_ROW_DRAG_HANDLED_FLAG = "__planningRowDragHandled";
const PLANNING_PANE_MIN_WIDTH = 260;
const PLANNING_PANE_MIN_TIMELINE_WIDTH = 320;
const PLANNING_PANE_RESIZE_STEP = 24;
const LEGACY_PLANNING_PANE_WIDTH_STORAGE_KEY = "planning-projet.left-panel-width";

function roundPlanningTraceNumber(value, digits = 2) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const precision = 10 ** digits;
  return Math.round(numericValue * precision) / precision;
}

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function summarizePlanningViewportForTrace(viewport = null) {
  if (!viewport || typeof viewport !== "object") {
    return null;
  }

  return {
    mode: String(viewport.mode || "").trim(),
    anchorDate: String(viewport.anchorDate || "").trim(),
    firstVisibleDate: String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim(),
    rangeEndDate: String(viewport.rangeEndDate || "").trim(),
    visibleDays: roundPlanningTraceNumber(viewport.visibleDays, 4),
    windowStartMs: roundPlanningTraceNumber(viewport.windowStartMs, 0),
    windowEndMs: roundPlanningTraceNumber(viewport.windowEndMs, 0),
  };
}

function tracePlanningSync(event, details = {}) {
  planningSyncTraceSequence += 1;
  console.info(`[sync-trace][${PLANNING_SYNC_TRACE_LABEL}][${planningSyncTraceSequence}] ${event}`, details);
}

function resolvePlanningViewportSettled(viewport = getPlanningViewportState()) {
  planningViewportSettlePending = false;
  const waiters = planningViewportSettleWaiters;
  planningViewportSettleWaiters = [];
  waiters.forEach((resolve) => {
    resolve(viewport);
  });
}

function beginPlanningViewportSettle() {
  planningViewportSettlePending = true;
  planningViewportSettleToken += 1;
  return planningViewportSettleToken;
}

function queuePlanningViewportSettled(token, frameCount = 2) {
  const safeFrameCount = Math.max(1, Math.round(Number(frameCount) || 1));

  const step = (remainingFrames) => {
    requestAnimationFrame(() => {
      if (token !== planningViewportSettleToken) {
        return;
      }

      if (remainingFrames <= 1) {
        resolvePlanningViewportSettled(getPlanningViewportState());
        return;
      }

      step(remainingFrames - 1);
    });
  };

  step(safeFrameCount);
}

export function waitForPlanningViewportSettled() {
  if (!planningViewportSettlePending) {
    return Promise.resolve(getPlanningViewportState());
  }

  return new Promise((resolve) => {
    planningViewportSettleWaiters.push(resolve);
  });
}

function isPlanningPaneResizeEnabled() {
  return !EMBEDDED_PLANNING_SYNC_MODE && !EXTERNAL_AXIS_EMBEDDED_MODE;
}

function readPlanningCssPixelVar(name) {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getPlanningPaneNaturalWidth() {
  const columnNames = [
    "--col-id2",
    "--col-task",
    "--col-ligne-planning",
    "--col-start",
    "--col-duration-1",
    "--col-end",
    "--col-duration-2",
    "--col-demarrage",
    "--col-indice",
    "--col-realise",
    "--col-retards",
  ];
  const columnsWidth = columnNames.reduce(
    (sum, name) => sum + readPlanningCssPixelVar(name),
    0
  );
  const padX = readPlanningCssPixelVar("--left-pad-x");
  const computedWidth = columnsWidth + (padX * 2);
  if (computedWidth > 0) {
    return computedWidth;
  }

  const headerLeft = document.querySelector(".planning-header-left");
  return headerLeft instanceof HTMLElement
    ? headerLeft.getBoundingClientRect().width
    : 0;
}

function getPlanningPaneWidthBounds() {
  const viewportWidth =
    window.innerWidth ||
    document.documentElement?.clientWidth ||
    getPlanningPaneNaturalWidth();
  const naturalWidth = getPlanningPaneNaturalWidth();
  const maxWidth = Math.max(
    PLANNING_PANE_MIN_WIDTH,
    Math.min(naturalWidth || PLANNING_PANE_MIN_WIDTH, viewportWidth - PLANNING_PANE_MIN_TIMELINE_WIDTH)
  );
  const minWidth = Math.min(PLANNING_PANE_MIN_WIDTH, maxWidth);

  return {
    minWidth,
    maxWidth,
    naturalWidth,
  };
}

function clampPlanningPaneWidth(width) {
  const numericWidth = Number(width);
  const { minWidth, maxWidth } = getPlanningPaneWidthBounds();
  if (!Number.isFinite(numericWidth)) return maxWidth;
  return Math.min(maxWidth, Math.max(minWidth, numericWidth));
}

function clearLegacyStoredPlanningPaneWidth() {
  try {
    window.localStorage?.removeItem(LEGACY_PLANNING_PANE_WIDTH_STORAGE_KEY);
  } catch (_error) {
    // localStorage can be unavailable in embedded contexts.
  }
}

function getCurrentPlanningPaneWidth() {
  const inlineValue = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--planning-left-panel-width");
  const inlineNumber = Number.parseFloat(inlineValue);
  if (Number.isFinite(inlineNumber)) {
    return inlineNumber;
  }

  const leftPanel = document.querySelector("#planningTimeline .vis-panel.vis-left");
  if (leftPanel instanceof HTMLElement) {
    const panelWidth = leftPanel.getBoundingClientRect().width;
    if (panelWidth > 0) return panelWidth;
  }

  const headerLeft = document.querySelector(".planning-header-left");
  if (headerLeft instanceof HTMLElement) {
    const headerWidth = headerLeft.getBoundingClientRect().width;
    if (headerWidth > 0) return headerWidth;
  }

  return getPlanningPaneNaturalWidth();
}

function syncPlanningPaneResizerAria(width) {
  const handle = document.getElementById("planningPaneResizer");
  if (!(handle instanceof HTMLElement)) return;

  const { minWidth, maxWidth } = getPlanningPaneWidthBounds();
  handle.setAttribute("aria-valuemin", String(Math.round(minWidth)));
  handle.setAttribute("aria-valuemax", String(Math.round(maxWidth)));
  handle.setAttribute("aria-valuenow", String(Math.round(width)));
}

function refreshPlanningPaneLayout() {
  if (timelineInstance) {
    timelineInstance.redraw();
  }

  requestStickyAxisSync();
}

function setPlanningPaneWidth(width, { redraw = true } = {}) {
  if (!isPlanningPaneResizeEnabled()) return;

  const nextWidth = clampPlanningPaneWidth(width);
  document.documentElement.style.setProperty(
    "--planning-left-panel-width",
    `${nextWidth}px`
  );
  syncPlanningPaneResizerAria(nextWidth);
  if (redraw) {
    refreshPlanningPaneLayout();
  }
}

function resetPlanningPaneWidth() {
  document.documentElement.style.removeProperty("--planning-left-panel-width");
  syncPlanningPaneResizerAria(clampPlanningPaneWidth(getPlanningPaneNaturalWidth()));
  refreshPlanningPaneLayout();
}

function queuePlanningPaneWidthForDrag(width) {
  pendingPlanningPaneResizeWidth = width;
  if (planningPaneResizeRafId) return;

  planningPaneResizeRafId = requestAnimationFrame(() => {
    planningPaneResizeRafId = 0;
    const nextWidth = pendingPlanningPaneResizeWidth;
    pendingPlanningPaneResizeWidth = null;
    setPlanningPaneWidth(nextWidth, { redraw: false });
  });
}

function handlePlanningPaneResizeStart(event) {
  if (!isPlanningPaneResizeEnabled()) return;
  if (!(event.currentTarget instanceof HTMLElement)) return;

  event.preventDefault();
  activePlanningPaneResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: getCurrentPlanningPaneWidth(),
  };

  event.currentTarget.setPointerCapture?.(event.pointerId);
  document.documentElement.classList.add("is-planning-pane-resizing");
  document.body?.classList?.add("is-planning-pane-resizing");
}

function handlePlanningPaneResizeMove(event) {
  if (!activePlanningPaneResize || event.pointerId !== activePlanningPaneResize.pointerId) {
    return;
  }

  const deltaX = event.clientX - activePlanningPaneResize.startX;
  queuePlanningPaneWidthForDrag(activePlanningPaneResize.startWidth + deltaX);
}

function handlePlanningPaneResizeEnd(event) {
  if (!activePlanningPaneResize || event.pointerId !== activePlanningPaneResize.pointerId) {
    return;
  }

  if (planningPaneResizeRafId) {
    cancelAnimationFrame(planningPaneResizeRafId);
    planningPaneResizeRafId = 0;
  }
  if (pendingPlanningPaneResizeWidth != null) {
    setPlanningPaneWidth(pendingPlanningPaneResizeWidth, { redraw: false });
    pendingPlanningPaneResizeWidth = null;
  }

  activePlanningPaneResize = null;
  document.documentElement.classList.remove("is-planning-pane-resizing");
  document.body?.classList?.remove("is-planning-pane-resizing");
  refreshPlanningPaneLayout();
}

function handlePlanningPaneResizerKeydown(event) {
  if (!isPlanningPaneResizeEnabled()) return;

  const currentWidth = getCurrentPlanningPaneWidth();
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    setPlanningPaneWidth(currentWidth - PLANNING_PANE_RESIZE_STEP);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setPlanningPaneWidth(currentWidth + PLANNING_PANE_RESIZE_STEP);
  } else if (event.key === "Home") {
    event.preventDefault();
    setPlanningPaneWidth(getPlanningPaneWidthBounds().minWidth);
  } else if (event.key === "End") {
    event.preventDefault();
    setPlanningPaneWidth(getPlanningPaneWidthBounds().maxWidth);
  }
}

function bindPlanningPaneResizer() {
  if (!isPlanningPaneResizeEnabled()) return;
  const handle = document.getElementById("planningPaneResizer");
  if (!(handle instanceof HTMLElement)) return;

  if (!planningPaneResizerBound) {
    clearLegacyStoredPlanningPaneWidth();
    document.documentElement.style.removeProperty("--planning-left-panel-width");
    syncPlanningPaneResizerAria(getCurrentPlanningPaneWidth());
  }

  if (planningPaneResizerBound) return;
  planningPaneResizerBound = true;

  handle.addEventListener("pointerdown", handlePlanningPaneResizeStart);
  handle.addEventListener("pointermove", handlePlanningPaneResizeMove);
  handle.addEventListener("pointerup", handlePlanningPaneResizeEnd);
  handle.addEventListener("pointercancel", handlePlanningPaneResizeEnd);
  handle.addEventListener("lostpointercapture", () => {
    if (!activePlanningPaneResize) return;
    if (planningPaneResizeRafId) {
      cancelAnimationFrame(planningPaneResizeRafId);
      planningPaneResizeRafId = 0;
    }
    if (pendingPlanningPaneResizeWidth != null) {
      setPlanningPaneWidth(pendingPlanningPaneResizeWidth, { redraw: false });
      pendingPlanningPaneResizeWidth = null;
    }
    activePlanningPaneResize = null;
    document.documentElement.classList.remove("is-planning-pane-resizing");
    document.body?.classList?.remove("is-planning-pane-resizing");
    refreshPlanningPaneLayout();
  });
  handle.addEventListener("keydown", handlePlanningPaneResizerKeydown);
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    resetPlanningPaneWidth();
  });
  window.addEventListener("resize", () => {
    if (!isPlanningPaneResizeEnabled()) return;
    setPlanningPaneWidth(getCurrentPlanningPaneWidth(), {
      redraw: true,
    });
  });
}

function ensureStickyAxisLeftFiller(container) {
  if (!(container instanceof HTMLElement)) return null;
  if (axisLeftFillerEl instanceof HTMLElement && axisLeftFillerEl.isConnected) {
    return axisLeftFillerEl;
  }

  const filler = document.createElement("div");
  filler.className = "timeline-axis-left-filler";
  filler.setAttribute("aria-hidden", "true");
  container.appendChild(filler);
  axisLeftFillerEl = filler;
  return axisLeftFillerEl;
}

function syncStickyTimelineAxisWithWrapperScroll() {
  if (EXTERNAL_AXIS_EMBEDDED_MODE) {
    return;
  }

  const wrapper = document.getElementById("timelineWrapper");
  const container = document.getElementById("planningTimeline");
  if (!(wrapper instanceof HTMLElement) || !(container instanceof HTMLElement)) return;

  const topPanel = container.querySelector(".vis-panel.vis-top");
  if (!(topPanel instanceof HTMLElement)) return;

  const y = wrapper.scrollTop || 0;
  topPanel.style.transform = y ? `translateY(${y}px)` : "translateY(0)";
  topPanel.style.zIndex = "80";

  const leftFiller = ensureStickyAxisLeftFiller(container);
  if (leftFiller instanceof HTMLElement) {
    const axisHeight = Math.max(
      0,
      topPanel.offsetHeight || topPanel.getBoundingClientRect().height || 0
    );
    leftFiller.style.height = `${axisHeight}px`;
    leftFiller.style.transform = y ? `translateY(${y}px)` : "translateY(0)";
  }
}

function requestStickyAxisSync() {
  if (EXTERNAL_AXIS_EMBEDDED_MODE) {
    return;
  }

  if (stickyAxisRafPending) return;
  stickyAxisRafPending = true;
  requestAnimationFrame(() => {
    stickyAxisRafPending = false;
    syncStickyTimelineAxisWithWrapperScroll();
  });
}

function syncStickyTimelineAxisOnScroll() {
  syncStickyTimelineAxisWithWrapperScroll();
}

function bindStickyTimelineAxis() {
  if (EXTERNAL_AXIS_EMBEDDED_MODE) return;

  const wrapper = document.getElementById("timelineWrapper");
  if (!(wrapper instanceof HTMLElement) || stickyAxisBound) return;

  stickyAxisBound = true;
  wrapper.addEventListener("scroll", syncStickyTimelineAxisOnScroll, { passive: true });
  window.addEventListener("resize", requestStickyAxisSync);
  requestStickyAxisSync();
}

function normalizePlanningViewportBounds(bounds = {}) {
  const nextMinVisibleDays = Math.max(1, Math.round(Number(bounds.minVisibleDays) || 7));
  const nextMaxVisibleDays = Math.max(
    nextMinVisibleDays,
    Math.round(Number(bounds.maxVisibleDays) || 392)
  );

  return {
    minVisibleDays: nextMinVisibleDays,
    maxVisibleDays: nextMaxVisibleDays,
  };
}

function clampPlanningVisibleDaysToBounds(nextVisibleDays, bounds = embeddedPlanningViewportBounds) {
  const normalizedBounds = normalizePlanningViewportBounds(bounds);
  return Math.min(
    Math.max(Math.round(Number(nextVisibleDays) || normalizedBounds.minVisibleDays), normalizedBounds.minVisibleDays),
    normalizedBounds.maxVisibleDays
  );
}

function buildClampedPlanningRange(range, bounds = embeddedPlanningViewportBounds) {
  if (!range?.start || !range?.end) {
    return null;
  }

  const visibleDays = getVisibleDaysFromRange(range);
  const clampedVisibleDays = clampPlanningVisibleDaysToBounds(visibleDays, bounds);
  if (clampedVisibleDays === visibleDays) {
    return null;
  }

  const centerMs = (range.start.valueOf() + range.end.valueOf()) / 2;
  const centerDate = new Date(centerMs);
  if (Number.isNaN(centerDate.getTime())) {
    return null;
  }

  const start = new Date(centerDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.floor((clampedVisibleDays - 1) / 2));

  const end = new Date(start);
  end.setDate(start.getDate() + clampedVisibleDays - 1);
  end.setHours(23, 59, 59, 999);

  return { start, end, visibleDays: clampedVisibleDays };
}

function enforceEmbeddedPlanningViewportBounds(range = null) {
  if (!EMBEDDED_PLANNING_SYNC_MODE || !timelineInstance || planningViewportBoundsCorrectionPending) {
    return false;
  }

  const effectiveRange = range || timelineInstance.getWindow();
  const clampedRange = buildClampedPlanningRange(effectiveRange, embeddedPlanningViewportBounds);
  if (!clampedRange) {
    return false;
  }

  planningViewportBoundsCorrectionPending = true;
  timelineInstance.setWindow(clampedRange.start, clampedRange.end, { animation: false });
  updateDateRangeDisplay();
  updateNavCenterButtonLabel();
  requestStickyAxisSync();
  requestAnimationFrame(() => {
    planningViewportBoundsCorrectionPending = false;
  });
  return true;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toIsoDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftIsoDateValue(dateValue, dayDelta = 0) {
  const normalizedDateValue = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateValue)) {
    return "";
  }

  const date = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setDate(date.getDate() + Number(dayDelta || 0));
  return toIsoDateValue(date);
}

function getExactIsoDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function ensureHoverTooltip() {
  if (hoverTooltipEl) return hoverTooltipEl;

  const el = document.createElement("div");
  el.id = "planning-hover-tooltip";
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.background = "rgba(18, 24, 33, 0.95)";
  el.style.color = "#fff";
  el.style.border = "1px solid rgba(255, 255, 255, 0.2)";
  el.style.borderRadius = "8px";
  el.style.padding = "8px 10px";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.35";
  el.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.35)";
  document.body.appendChild(el);

  hoverTooltipEl = el;
  return hoverTooltipEl;
}

function canUseParentHoverTooltip() {
  const isHeaderOnlyFrame =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("headerOnly") === "1";

  return Boolean(
    window.parent &&
    window.parent !== window &&
    EMBEDDED_PLANNING_SYNC_MODE &&
    !isHeaderOnlyFrame
  );
}

function postParentHoverTooltip(action, html = "", eventLike = null) {
  if (!canUseParentHoverTooltip()) return false;

  const pos = getPointerClientPos(eventLike);
  window.parent.postMessage(
    {
      type: PLANNING_PARENT_TOOLTIP_MESSAGE_TYPE,
      action,
      html,
      clientX: pos?.x ?? null,
      clientY: pos?.y ?? null,
    },
    "*"
  );
  return true;
}

function getPointerClientPos(eventLike) {
  const src = eventLike?.srcEvent || eventLike;
  if (!src) return null;

  if (typeof src.clientX === "number" && typeof src.clientY === "number") {
    return { x: src.clientX, y: src.clientY };
  }

  if (src.center && typeof src.center.x === "number" && typeof src.center.y === "number") {
    return { x: src.center.x, y: src.center.y };
  }

  return null;
}

function placeHoverTooltip(eventLike) {
  if (canUseParentHoverTooltip()) {
    postParentHoverTooltip("move", "", eventLike);
    return;
  }

  if (!hoverTooltipEl || hoverTooltipEl.style.display === "none") return;

  const pos = getPointerClientPos(eventLike);
  if (!pos) return;

  const offset = 14;
  const rect = hoverTooltipEl.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);

  let left = pos.x + offset;
  let top = pos.y + offset;

  if (left > maxLeft) {
    left = Math.max(8, pos.x - rect.width - offset);
  }

  if (top > maxTop) {
    top = Math.max(8, pos.y - rect.height - offset);
  }

  hoverTooltipEl.style.left = `${left}px`;
  hoverTooltipEl.style.top = `${top}px`;
}

function hideHoverTooltip() {
  postParentHoverTooltip("hide");
  if (!hoverTooltipEl) return;
  hoverTooltipEl.style.display = "none";
  hoverTooltipEl.innerHTML = "";
}

function showHoverTooltip(html, eventLike) {
  if (postParentHoverTooltip("show", html, eventLike)) {
    if (hoverTooltipEl) {
      hoverTooltipEl.style.display = "none";
      hoverTooltipEl.innerHTML = "";
    }
    return;
  }

  ensureHoverTooltip();
  hoverTooltipEl.innerHTML = html;
  hoverTooltipEl.style.display = "block";
  placeHoverTooltip(eventLike);
}

function getPhaseTooltipMetaFromClassName(className) {
  const cls = String(className || "");

  if (cls.includes("phase-coffrage")) {
    return {
      label: "Coffrage",
      startLabel: "Date limite",
      endLabel: "Diff coffrage",
    };
  }

  if (cls.includes("phase-armature")) {
    return {
      label: "Armature",
      startLabel: "Diff coffrage",
      endLabel: "Diff armature",
    };
  }

  if (cls.includes("phase-ndc")) {
    return {
      label: "NDC",
      startLabel: "Date limite",
      endLabel: "Diff coffrage",
    };
  }

  if (cls.includes("phase-coupes")) {
    return {
      label: "COUPES",
      startLabel: "Date limite",
      endLabel: "Diff coffrage",
    };
  }

  if (cls.includes("phase-demolition")) {
    return {
      label: "DÉMOLITION",
      startLabel: "Date limite",
      endLabel: "Diff coffrage",
    };
  }

  if (cls.includes("phase-generic")) {
    return {
      label: "Type personnalisé",
      startLabel: "Date limite",
      endLabel: "Diff coffrage",
    };
  }

  return null;
}

function buildPhaseTooltipHtml(item, group) {
  const cls = String(item?.className || "");
  const tache = String(item?.taskLabel || group?.tachesLabel || "Tache");
  const aggregateTasks = Array.isArray(item?.aggregateTasks)
    ? item.aggregateTasks.filter(Boolean)
    : [];

  if (aggregateTasks.length > 0) {
    const meta = getPhaseTooltipMetaFromClassName(cls) || {
      label: "Phase",
      startLabel: "Debut",
      endLabel: "Fin",
    };
    if (cls.includes("phase-generic")) {
      meta.label = String(item?.phaseLabel || item?.content || "Type personnalisé");
    }
    const rows = aggregateTasks
      .map((task) => {
        const taskLabel = escapeHtml(task.label || "Tache");
        const startDateLabel = escapeHtml(getExactIsoDate(task.start));
        const endDateLabel = escapeHtml(getExactIsoDate(task.end));
        return `<div><strong>${taskLabel}</strong> : ${meta.startLabel} ${startDateLabel} -> ${meta.endLabel} ${endDateLabel}</div>`;
      })
      .join("");

    return `
      <div><strong>${meta.label}</strong></div>
      ${rows}
    `;
  }

  if (cls.includes("phase-coffrage")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Coffrage</div>
      <div>Date limite : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-armature")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Armature</div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff armature : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-ndc")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>NDC</div>
      <div>Date limite : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-coupes")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>COUPES</div>
      <div>Date limite : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-demolition")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>DÉMOLITION</div>
      <div>Date limite : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-generic")) {
    const typeLabel = String(
      group?.typeDocLabel || item?.phaseLabel || item?.content || "Type personnalisé"
    );
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>${escapeHtml(typeLabel)}</div>
      <div>Date limite : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-demarrage")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Debut des travaux</div>
      <div>Date : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
    `;
  }

  return "";
}

function getNativePhaseTitle(item, group) {
  const cls = String(item?.className || "");
  const tache = String(item?.taskLabel || group?.tachesLabel || "Tache");
  const aggregateTasks = Array.isArray(item?.aggregateTasks)
    ? item.aggregateTasks.filter(Boolean)
    : [];

  if (aggregateTasks.length > 0) {
    const meta = getPhaseTooltipMetaFromClassName(cls) || {
      label: "Phase",
      startLabel: "Debut",
      endLabel: "Fin",
    };
    if (cls.includes("phase-generic")) {
      meta.label = String(item?.phaseLabel || item?.content || "Type personnalisé");
    }
    return [
      meta.label,
      ...aggregateTasks.map((task) => {
        const taskLabel = String(task.label || "Tache");
        return `${taskLabel} : ${meta.startLabel} ${getExactIsoDate(task.start)} -> ${meta.endLabel} ${getExactIsoDate(task.end)}`;
      }),
    ].join("\n");
  }

  if (cls.includes("phase-coffrage")) {
    return [
      tache,
      `Coffrage`,
      `Date limite : ${getExactIsoDate(item.start)}`,
      `Diff coffrage : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-armature")) {
    return [
      tache,
      `Armature`,
      `Diff coffrage : ${getExactIsoDate(item.start)}`,
      `Diff armature : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-ndc")) {
    return [
      tache,
      `NDC`,
      `Date limite : ${getExactIsoDate(item.start)}`,
      `Diff coffrage : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-coupes")) {
    return [
      tache,
      `COUPES`,
      `Date limite : ${getExactIsoDate(item.start)}`,
      `Diff coffrage : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-demolition")) {
    return [
      tache,
      `DÉMOLITION`,
      `Date limite : ${getExactIsoDate(item.start)}`,
      `Diff coffrage : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-generic")) {
    return [
      tache,
      String(group?.typeDocLabel || item?.phaseLabel || item?.content || "Type personnalisé"),
      `Date limite : ${getExactIsoDate(item.start)}`,
      `Diff coffrage : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-demarrage")) {
    return [
      tache,
      `Debut des travaux`,
      `Date : ${getExactIsoDate(item.start)}`,
    ].join("\n");
  }

  return "";
}

function getTimelineItemFromElement(itemEl) {
  if (!itemEl || !itemsDataSet) return null;

  const decoratedItemEl = itemEl.closest?.("[data-planning-item-id]");
  const decoratedItemId = decoratedItemEl?.getAttribute("data-planning-item-id");
  if (decoratedItemId) {
    const decoratedItem =
      itemsDataSet.get(decoratedItemId) ||
      itemsDataSet.get(String(decoratedItemId)) ||
      itemsDataSet.get(Number(decoratedItemId)) ||
      null;
    if (decoratedItem) return decoratedItem;
  }

  const rawId =
    itemEl.getAttribute("data-id") ||
    itemEl.getAttribute("data-item-id") ||
    itemEl.dataset?.id ||
    "";

  if (!rawId) return null;

  let item = itemsDataSet.get(rawId);
  if (item) return item;

  if (/^\d+$/.test(rawId)) {
    item = itemsDataSet.get(Number(rawId));
    if (item) return item;
  }

  return null;
}

function getRenderedTimelineItemEntries() {
  const renderedItems = timelineInstance?.itemSet?.items;
  if (!renderedItems || typeof renderedItems !== "object") {
    return [];
  }

  return Object.values(renderedItems);
}

function clearRenderedPlanningItemStyle(node) {
  if (!(node instanceof HTMLElement)) return;

  node.style.removeProperty("background");
  node.style.removeProperty("background-color");
  node.style.removeProperty("border-color");
  node.style.removeProperty("color");
  node.style.removeProperty("opacity");
  node.style.removeProperty("z-index");
}

function applyRenderedPlanningItemStyle(node, styleText) {
  if (!(node instanceof HTMLElement)) return;

  clearRenderedPlanningItemStyle(node);

  const normalizedStyleText = String(styleText || "").trim();
  if (!normalizedStyleText) {
    return;
  }

  normalizedStyleText
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .forEach((declaration) => {
      const separatorIndex = declaration.indexOf(":");
      if (separatorIndex <= 0) {
        return;
      }

      const propertyName = declaration.slice(0, separatorIndex).trim();
      let propertyValue = declaration.slice(separatorIndex + 1).trim();
      if (!propertyName || !propertyValue) {
        return;
      }

      let priority = "";
      if (/!important\s*$/i.test(propertyValue)) {
        propertyValue = propertyValue.replace(/!important\s*$/i, "").trim();
        priority = "important";
      }

      if (!propertyValue) {
        return;
      }

      node.style.setProperty(propertyName, propertyValue, priority);
    });
}

function decorateRenderedTimelineItems(containerEl) {
  if (!containerEl || !timelineInstance) return;

  const entries = getRenderedTimelineItemEntries();
  entries.forEach((entry) => {
    const itemId = entry?.data?.id ?? entry?.id;
    if (itemId == null) return;

    const item =
      itemsDataSet?.get(itemId) ||
      itemsDataSet?.get(String(itemId)) ||
      itemsDataSet?.get(Number(itemId)) ||
      null;
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const title = getNativePhaseTitle(item, group);
    const domNodes = [
      entry?.dom?.box,
      entry?.dom?.point,
      entry?.dom?.range,
      entry?.dom?.line,
      entry?.dom?.dot,
      entry?.dom?.content,
    ].filter(Boolean);

    const styledNodes = new Set();
    domNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.setAttribute("data-planning-item-id", String(itemId));
      if (title) {
        node.setAttribute("title", title);
        node.setAttribute("aria-label", title);
      }

      applyRenderedPlanningItemStyle(node, item.style);
      styledNodes.add(node);
    });

    const itemElement = [...containerEl.querySelectorAll(".vis-item")].find((candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      return (
        candidate.getAttribute("data-id") === String(itemId) ||
        candidate.getAttribute("data-item-id") === String(itemId)
      );
    });
    if (itemElement instanceof HTMLElement && !styledNodes.has(itemElement)) {
      applyRenderedPlanningItemStyle(itemElement, item.style);
    }
  });
}

function getTimelineItemFromEvent(event, containerEl) {
  if (timelineInstance && typeof timelineInstance.getEventProperties === "function" && itemsDataSet) {
    const props = timelineInstance.getEventProperties(event);
    const itemId = props?.item;
    if (itemId != null) {
      let item = itemsDataSet.get(itemId);
      if (item) return item;

      if (typeof itemId === "number") {
        item = itemsDataSet.get(String(itemId));
        if (item) return item;
      } else if (typeof itemId === "string" && /^\d+$/.test(itemId)) {
        item = itemsDataSet.get(Number(itemId));
        if (item) return item;
      }
    }
  }

  const itemEl = event?.target?.closest?.(".vis-item");
  if (!itemEl || (containerEl && !containerEl.contains(itemEl))) return null;
  return getTimelineItemFromElement(itemEl);
}

function getHoverElementFromPoint(event, containerEl) {
  const directHoverEl = event.target?.closest?.("[data-planning-item-id], .vis-item");
  if (directHoverEl && (!containerEl || containerEl.contains(directHoverEl))) {
    return directHoverEl;
  }

  if (
    typeof document.elementsFromPoint === "function" &&
    typeof event?.clientX === "number" &&
    typeof event?.clientY === "number"
  ) {
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    const hoveredFromStack = stack.find((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const candidate = el.closest?.("[data-planning-item-id], .vis-item");
      return candidate && (!containerEl || containerEl.contains(candidate));
    });

    if (hoveredFromStack instanceof HTMLElement) {
      return hoveredFromStack.closest?.("[data-planning-item-id], .vis-item") || hoveredFromStack;
    }
  }

  return null;
}

function showTooltipForItem(item, eventLike) {
  if (!item) {
    hideHoverTooltip();
    return;
  }

  const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
  const html = buildPhaseTooltipHtml(item, group);
  if (!html) {
    hideHoverTooltip();
    return;
  }

  if (hoverTooltipEl?.innerHTML !== html || hoverTooltipEl?.style.display === "none") {
    showHoverTooltip(html, eventLike);
  } else {
    placeHoverTooltip(eventLike);
  }
}

function syncNativeItemTitles(containerEl) {
  if (!containerEl || !itemsDataSet) return;

  const itemElements = containerEl.querySelectorAll(".vis-item");
  itemElements.forEach((itemEl) => {
    const item = getTimelineItemFromElement(itemEl);
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const title = getNativePhaseTitle(item, group);
    if (!title) return;

    itemEl.setAttribute("title", title);
    itemEl.setAttribute("aria-label", title);

    const contentEl = itemEl.querySelector(".vis-item-content");
    if (contentEl) {
      contentEl.setAttribute("title", title);
      contentEl.setAttribute("aria-label", title);
    }
  });
}

function bindItemHoverInteractions(_containerEl) {
  // Le tooltip est géré par délégation sur le container via pointermove + mouseleave
  // (cf. bindHoverTooltip). Ajouter des listeners sur chaque .vis-item accumulait
  // des milliers de closures en mémoire à chaque re-render du timeline (vis.js
  // recrée les éléments DOM à chaque mise à jour). Aucun listener per-item nécessaire.
}

function bindHoverTooltip(containerEl) {
  if (!timelineInstance || hoverTooltipBound || !containerEl) return;
  hoverTooltipBound = true;

  ensureHoverTooltip();

  containerEl.addEventListener("pointermove", (event) => {
    const hoverEl = getHoverElementFromPoint(event, containerEl);
    if (!hoverEl || !containerEl.contains(hoverEl)) {
      hideHoverTooltip();
      return;
    }

    const item = getTimelineItemFromElement(hoverEl) || getTimelineItemFromEvent(event, containerEl);
    if (!item) {
      hideHoverTooltip();
      return;
    }

    showTooltipForItem(item, event);
  });

  containerEl.addEventListener("mouseleave", () => {
    hideHoverTooltip();
  });

  const syncInteractiveElements = () => {
    decorateRenderedTimelineItems(containerEl);
    syncNativeItemTitles(containerEl);
    bindItemHoverInteractions(containerEl);
  };

  syncInteractiveElements();

  if (!itemElementsObserver && typeof MutationObserver !== "undefined") {
    itemElementsObserver = new MutationObserver(() => {
      if (timelineBulkUpdateInProgress) return;
      requestAnimationFrame(syncInteractiveElements);
    });
    itemElementsObserver.observe(containerEl, {
      childList: true,
      subtree: true,
    });
  }

  containerEl.addEventListener("click", (event) => {
    if (event.button !== 0) return; // clic gauche uniquement

    const item = getTimelineItemFromEvent(event, containerEl);
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const html = buildPhaseTooltipHtml(item, group);
    if (!html) return;

    showHoverTooltip(html, event);

    if (clickTooltipTimer) clearTimeout(clickTooltipTimer);
    clickTooltipTimer = setTimeout(() => {
      hideHoverTooltip();
      clickTooltipTimer = null;
    }, 5000);
  });
}

function normalizeDurationInput(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

function formatDurationForCell(value) {
  const n = normalizeDurationInput(value);
  if (n == null) return "";
  return String(n);
}

function resetDurationCellView(cellEl, displayText, durationValue = null) {
  if (!(cellEl instanceof HTMLElement)) return;
  cellEl.classList.remove("is-editing-duration", "is-saving-duration");
  cellEl.dataset.planningDurationEditing = "0";
  cellEl.dataset.durationValue =
    durationValue == null ? "" : String(durationValue);
  cellEl.textContent = displayText;
}

function startDurationCellEditing(cellEl) {
  if (!(cellEl instanceof HTMLElement) || !durationCellEditHandler) return;

  if (!cellEl.classList.contains("editable-duration-cell")) return;

  if (activeDurationEditor && activeDurationEditor.cellEl !== cellEl) {
    activeDurationEditor.cancel();
    activeDurationEditor = null;
  } else if (activeDurationEditor?.cellEl === cellEl) {
    return;
  }

  const rowId = Number(cellEl.dataset.rowId);
  if (!Number.isInteger(rowId) || rowId <= 0) return;

  const durationColumnKey = String(cellEl.dataset.durationColumnKey || "");
  const leftDateColumnKey = String(cellEl.dataset.leftDateColumnKey || "");
  const rightIsoDate = String(cellEl.dataset.rightIsoDate || "");
  const durationSlot = String(cellEl.dataset.durationSlot || "1");
  const typeDoc = String(cellEl.dataset.typeDoc || "");

  const initialDisplay = String(cellEl.textContent || "").trim();
  const initialValue = normalizeDurationInput(
    cellEl.dataset.durationValue || initialDisplay
  );

  cellEl.classList.add("is-editing-duration");
  cellEl.dataset.planningDurationEditing = "1";
  cellEl.textContent = "";

  const inputEl = document.createElement("input");
  inputEl.type = "number";
  inputEl.className = "editable-duration-input";
  inputEl.min = "0";
  inputEl.step = "1";
  inputEl.value = initialValue == null ? "" : String(initialValue);
  cellEl.appendChild(inputEl);

  let finalized = false;
  const finalize = () => {
    if (activeDurationEditor?.cellEl === cellEl) {
      activeDurationEditor = null;
    }
  };

  const cancel = () => {
    if (finalized) return;
    finalized = true;
    resetDurationCellView(cellEl, initialDisplay, initialValue);
    finalize();
  };

  const commit = async () => {
    if (finalized) return;

    const nextValue = normalizeDurationInput(inputEl.value);
    if (nextValue == null) {
      cancel();
      return;
    }

    if (nextValue === initialValue) {
      finalized = true;
      resetDurationCellView(cellEl, formatDurationForCell(nextValue), nextValue);
      finalize();
      return;
    }

    finalized = true;
    cellEl.classList.add("is-saving-duration");
    inputEl.disabled = true;

    try {
      await durationCellEditHandler({
        rowId,
        durationWeeks: nextValue,
        durationSlot,
        typeDoc,
        durationColumnKey,
        leftDateColumnKey,
        rightIsoDate,
      });

      if (cellEl.isConnected) {
        resetDurationCellView(cellEl, formatDurationForCell(nextValue), nextValue);
      }
    } catch (error) {
      console.error("Erreur edition duree planning :", error);
      if (cellEl.isConnected) {
        resetDurationCellView(cellEl, initialDisplay, initialValue);
      }
    } finally {
      finalize();
    }
  };

  activeDurationEditor = {
    cellEl,
    cancel,
  };

  inputEl.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });

  inputEl.addEventListener("blur", () => {
    commit();
  });

  inputEl.focus();
  inputEl.select?.();
}

function bindDurationCellEditing(containerEl) {
  if (!containerEl || durationCellEditBound) return;
  durationCellEditBound = true;

  containerEl.addEventListener("click", (event) => {
    const targetEl = event.target;
    if (!(targetEl instanceof Element)) return;

    const cellEl = targetEl.closest(".group-row-grid .editable-duration-cell");
    if (!(cellEl instanceof HTMLElement) || !containerEl.contains(cellEl)) return;

    event.preventDefault();
    event.stopPropagation();
    startDurationCellEditing(cellEl);
  }, true);
}

function normalizeRetardJustification(value) {
  return String(value ?? "").trim();
}

function getRetardJustificationLabel(context = activeRetardJustificationContext) {
  const id2 = normalizeRetardJustification(context?.id2);
  const task = normalizeRetardJustification(context?.task);
  return [id2, task].filter(Boolean).join(" - ") || "Ligne planning";
}

function closeRetardContextMenu() {
  if (retardContextMenuEl) {
    retardContextMenuEl.style.display = "none";
  }
}

function positionFixedElementNearPointer(element, event) {
  if (!(element instanceof HTMLElement)) return;

  const margin = 8;
  const left = Number(event?.clientX || 0);
  const top = Number(event?.clientY || 0);
  element.style.display = "block";

  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.height;

  element.style.left = `${Math.max(margin, Math.min(left, viewportWidth - rect.width - margin))}px`;
  element.style.top = `${Math.max(margin, Math.min(top, viewportHeight - rect.height - margin))}px`;
}

function ensureRetardContextMenu() {
  if (retardContextMenuEl instanceof HTMLElement) return retardContextMenuEl;

  const menu = document.createElement("div");
  menu.className = "planning-retard-context-menu";
  menu.style.display = "none";
  menu.innerHTML = `
    <button type="button" class="planning-retard-context-menu__button" data-planning-retard-action="justify">
      Justifier le retard
    </button>
    <button type="button" class="planning-retard-context-menu__button" data-planning-retard-action="details">
      Détails
    </button>
  `;

  menu.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-planning-retard-action]")
      : null;
    if (!(button instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopPropagation();
    closeRetardContextMenu();
    const action = button.dataset.planningRetardAction || "";
    if (action === "details") {
      void openReferenceDetailsDialog();
    } else {
      openRetardJustificationDialog();
    }
  });

  document.body.appendChild(menu);
  retardContextMenuEl = menu;

  document.addEventListener("click", (event) => {
    if (!retardContextMenuEl || retardContextMenuEl.style.display === "none") return;
    if (event.target instanceof Node && retardContextMenuEl.contains(event.target)) return;
    closeRetardContextMenu();
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!retardContextMenuEl || retardContextMenuEl.style.display === "none") return;
      if (event.target instanceof Node && retardContextMenuEl.contains(event.target)) return;
      closeRetardContextMenu();
    },
    true
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRetardContextMenu();
    }
  });

  return retardContextMenuEl;
}

async function commitRetardJustification(nextValue) {
  if (!retardJustificationHandler || !activeRetardJustificationContext) return;

  const rowId = Number(activeRetardJustificationContext.rowId);
  if (!Number.isInteger(rowId) || rowId <= 0) return;

  const dialog = ensureRetardJustificationDialog();
  const controls = dialog.querySelectorAll("button, textarea");
  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    await retardJustificationHandler({
      rowId,
      remarque: normalizeRetardJustification(nextValue),
    });
    dialog.close();
  } catch (error) {
    console.error("Erreur justification retard :", error);
    alert(`Erreur justification retard : ${error.message}`);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
}

function ensureRetardJustificationDialog() {
  if (retardDialogEl instanceof HTMLDialogElement) return retardDialogEl;

  const dialog = document.createElement("dialog");
  dialog.className = "planning-retard-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="planning-retard-dialog__form">
      <h3>Justifier le retard</h3>
      <p class="planning-retard-dialog__line"></p>
      <label for="planningRetardJustificationText">Justification</label>
      <textarea id="planningRetardJustificationText" rows="6"></textarea>
      <div class="planning-retard-dialog__actions">
        <button type="submit" class="planning-retard-dialog__save">Enregistrer</button>
        <button type="button" class="planning-retard-dialog__clear">Effacer</button>
        <button type="button" class="planning-retard-dialog__cancel">Annuler</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector("form");
  const textarea = dialog.querySelector("textarea");
  const clearButton = dialog.querySelector(".planning-retard-dialog__clear");
  const cancelButton = dialog.querySelector(".planning-retard-dialog__cancel");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void commitRetardJustification(textarea?.value || "");
  });

  clearButton?.addEventListener("click", (event) => {
    event.preventDefault();
    void commitRetardJustification("");
  });

  cancelButton?.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.close();
  });

  document.body.appendChild(dialog);
  retardDialogEl = dialog;
  return retardDialogEl;
}

function openRetardJustificationDialog() {
  const context = activeRetardJustificationContext;
  if (!context) return;

  const dialog = ensureRetardJustificationDialog();
  const lineEl = dialog.querySelector(".planning-retard-dialog__line");
  const textarea = dialog.querySelector("textarea");

  if (lineEl) {
    lineEl.textContent = getRetardJustificationLabel(context);
  }
  if (textarea) {
    textarea.value = normalizeRetardJustification(context.remarque);
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }

  requestAnimationFrame(() => {
    textarea?.focus();
    textarea?.select();
  });
}

function ensureReferenceDetailsDialog() {
  if (referenceDetailsDialogEl instanceof HTMLDialogElement) return referenceDetailsDialogEl;

  const dialog = document.createElement("dialog");
  dialog.className = "planning-reference-details-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="planning-reference-details-dialog__form">
      <div class="planning-reference-details-dialog__header">
        <h3>Détails</h3>
        <button type="button" class="planning-reference-details-dialog__close" aria-label="Fermer">&times;</button>
      </div>
      <p class="planning-reference-details-dialog__line"></p>
      <div class="planning-reference-details-dialog__body"></div>
      <div class="planning-reference-details-dialog__actions">
        <button type="submit" class="planning-reference-details-dialog__save">Enregistrer</button>
        <button type="button" class="planning-reference-details-dialog__cancel">Annuler</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector("form");
  const closeButton = dialog.querySelector(".planning-reference-details-dialog__close");
  const cancelButton = dialog.querySelector(".planning-reference-details-dialog__cancel");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void commitReferenceDetailsDialog();
  });

  closeButton?.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.close();
  });

  cancelButton?.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.close();
  });

  dialog.addEventListener("close", () => {
    dialog.dataset.referenceDetailsDirty = "false";
    referenceDetailsRefreshPending = false;
  });

  document.body.appendChild(dialog);
  referenceDetailsDialogEl = dialog;
  return referenceDetailsDialogEl;
}

function normalizeReferenceDetailsLimitDateIso(value = "") {
  const rawValue = String(value || "").trim();
  const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    if (
      `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` === REFERENCE_DETAILS_EMPTY_DATE_ISO
    ) {
      return "";
    }
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const frMatch = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frMatch) {
    const day = frMatch[1].padStart(2, "0");
    const month = frMatch[2].padStart(2, "0");
    const year = frMatch[3];
    if (`${year}-${month}-${day}` === REFERENCE_DETAILS_EMPTY_DATE_ISO) return "";
    return `${year}-${month}-${day}`;
  }

  return "";
}

function parseReferenceDetailsDurationWeeks(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const numericValue = Number(text.replace(",", "."));
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 0) {
    return null;
  }
  return numericValue;
}

function computeReferenceDetailsLimitDateIso(segmentStartIso = "", durationWeeksValue = "") {
  const startIso = String(segmentStartIso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso)) return "";

  const durationWeeks = parseReferenceDetailsDurationWeeks(durationWeeksValue);
  if (durationWeeks == null) return "";

  return shiftIsoDateValue(startIso, -(durationWeeks * 7));
}

function parseReferenceDetailsIsoDate(value = "") {
  const isoValue = normalizeReferenceDetailsLimitDateIso(value);
  if (!isoValue) return null;

  const date = new Date(`${isoValue}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeReferenceDetailsDurationWeeks(segmentStartIso = "", dateLimiteValue = "") {
  const startDate = parseReferenceDetailsIsoDate(segmentStartIso);
  const limitDate = parseReferenceDetailsIsoDate(dateLimiteValue);
  if (!startDate || !limitDate) return null;

  const diffDays = Math.round((startDate.getTime() - limitDate.getTime()) / REFERENCE_DETAILS_DAY_MS);
  if (diffDays < 0 || diffDays % 7 !== 0) return null;
  return diffDays / 7;
}

function computeReferenceDetailsRetardDays(
  recuValue = "",
  dateLimiteValue = "",
  currentDateValue = new Date()
) {
  const recuDate = parseReferenceDetailsIsoDate(recuValue);
  const limitDate = parseReferenceDetailsIsoDate(dateLimiteValue);
  const currentDate = currentDateValue instanceof Date
    ? currentDateValue
    : parseReferenceDetailsIsoDate(currentDateValue);
  const comparisonDate = recuDate || (
    !(currentDate instanceof Date) || Number.isNaN(currentDate.getTime()) ? null : currentDate
  );
  if (!comparisonDate || !limitDate) return null;

  const comparisonMs = Date.UTC(
    comparisonDate.getFullYear(),
    comparisonDate.getMonth(),
    comparisonDate.getDate()
  );
  const limitMs = Date.UTC(limitDate.getFullYear(), limitDate.getMonth(), limitDate.getDate());
  const diffDays = Math.floor((comparisonMs - limitMs) / REFERENCE_DETAILS_DAY_MS);
  return diffDays > 0 ? diffDays : null;
}

function formatReferenceDetailsRetardValue(value) {
  if (value == null || value === "") return "";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? String(Math.trunc(numericValue))
    : "";
}

function formatPositiveRetardValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? String(Math.trunc(numericValue))
    : "";
}

function hasPositiveReferenceDetailsRetard(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
}

function isReferenceDetailsDialogOpen() {
  return referenceDetailsDialogEl instanceof HTMLDialogElement && referenceDetailsDialogEl.open;
}

function isReferenceDetailsDialogDirty(dialog = referenceDetailsDialogEl) {
  return dialog instanceof HTMLDialogElement && dialog.dataset.referenceDetailsDirty === "true";
}

function markReferenceDetailsDialogDirty(dialog = referenceDetailsDialogEl) {
  if (dialog instanceof HTMLDialogElement) {
    dialog.dataset.referenceDetailsDirty = "true";
  }
}

function markReferenceDetailsControlDirty(control, dialog = referenceDetailsDialogEl) {
  if (control instanceof HTMLInputElement) {
    control.dataset.referenceDetailsDirty = "true";
  }
  markReferenceDetailsDialogDirty(dialog);
}

function refreshReferenceDetailsRetardCells(dialog = referenceDetailsDialogEl) {
  if (!(dialog instanceof HTMLDialogElement)) return;

  dialog.querySelectorAll("tbody tr").forEach((row) => {
    const dateLimite = row.querySelector(".planning-reference-details-table__date-limite");
    const retardCell = row.querySelector(".planning-reference-details-table__retard");
    if (!(dateLimite instanceof HTMLInputElement) || !(retardCell instanceof HTMLElement)) return;

    const currentRetardValue = computeReferenceDetailsRetardDays(
      row.dataset.referenceRecu || "",
      normalizeReferenceDetailsLimitDateIso(dateLimite.value)
    );
    retardCell.textContent = formatReferenceDetailsRetardValue(currentRetardValue);
    retardCell.classList.toggle(
      "has-retard",
      hasPositiveReferenceDetailsRetard(currentRetardValue)
    );
  });
}

function applyReferenceDetailsFreshReceptionData(dialog, data = {}) {
  if (!(dialog instanceof HTMLDialogElement)) return;

  const referencesById = new Map(
    (Array.isArray(data.references) ? data.references : [])
      .map((reference) => [String(reference?.id ?? ""), reference])
      .filter(([id]) => id)
  );

  dialog.querySelectorAll("tbody tr").forEach((row) => {
    const freshReference = referencesById.get(String(row.dataset.referenceId || ""));
    if (!freshReference) return;

    row.dataset.referenceRecu = String(freshReference.recu || "");

    const bloquant = row.querySelector(".planning-reference-details-table__bloquant");
    if (
      bloquant instanceof HTMLInputElement &&
      bloquant.dataset.referenceDetailsDirty !== "true"
    ) {
      bloquant.checked = Boolean(freshReference.bloquant);
    }

    const duration = row.querySelector(".planning-reference-details-table__duration");
    const dateLimite = row.querySelector(".planning-reference-details-table__date-limite");
    const durationIsDirty =
      duration instanceof HTMLInputElement &&
      duration.dataset.referenceDetailsDirty === "true";
    const dateLimiteIsDirty =
      dateLimite instanceof HTMLInputElement &&
      dateLimite.dataset.referenceDetailsDirty === "true";

    if (
      duration instanceof HTMLInputElement &&
      dateLimite instanceof HTMLInputElement &&
      !durationIsDirty &&
      !dateLimiteIsDirty
    ) {
      const freshDuration = freshReference.durationWeeks == null
        ? ""
        : String(freshReference.durationWeeks);
      const freshDateLimite = dateLimite.disabled
        ? ""
        : normalizeReferenceDetailsLimitDateIso(freshReference.dateLimite);
      duration.value = freshDuration;
      dateLimite.value = freshDateLimite;
      row.dataset.referenceSavedDuration = freshDuration;
      row.dataset.referenceSavedDateLimite = freshDateLimite;
    }
  });
  refreshReferenceDetailsRetardCells(dialog);
}

async function refreshOpenReferenceDetailsDialog() {
  if (
    !referenceDetailsHandler ||
    !activeRetardJustificationContext ||
    !isReferenceDetailsDialogOpen()
  ) {
    return;
  }

  if (referenceDetailsRefreshInFlight) {
    referenceDetailsRefreshPending = true;
    return;
  }

  referenceDetailsRefreshInFlight = true;
  try {
    const context = { ...activeRetardJustificationContext };
    const data = await referenceDetailsHandler({ action: "load", context });
    const dialog = referenceDetailsDialogEl;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;

    if (isReferenceDetailsDialogDirty(dialog)) {
      applyReferenceDetailsFreshReceptionData(dialog, data);
    } else {
      renderReferenceDetailsBody(dialog, data);
    }
  } catch (error) {
    console.error("Erreur actualisation détails références :", error);
  } finally {
    referenceDetailsRefreshInFlight = false;
    if (referenceDetailsRefreshPending) {
      referenceDetailsRefreshPending = false;
      void refreshOpenReferenceDetailsDialog();
    }
  }
}

function scheduleReferenceDetailsMidnightRefresh() {
  if (referenceDetailsMidnightTimer) {
    window.clearTimeout(referenceDetailsMidnightTimer);
  }

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 1, 0);
  referenceDetailsMidnightTimer = window.setTimeout(() => {
    referenceDetailsMidnightTimer = 0;
    void refreshOpenReferenceDetailsDialog();
    scheduleReferenceDetailsMidnightRefresh();
  }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
}

function bindReferenceDetailsLifecycleRefresh() {
  if (referenceDetailsLifecycleBound || typeof window === "undefined") return;
  referenceDetailsLifecycleBound = true;

  window.addEventListener("storage", (event) => {
    if (event.key === REFERENCE_DATA_CHANGE_STORAGE_KEY) {
      void refreshOpenReferenceDetailsDialog();
    }
  });
  window.addEventListener("focus", () => {
    void refreshOpenReferenceDetailsDialog();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshOpenReferenceDetailsDialog();
    }
  });
  scheduleReferenceDetailsMidnightRefresh();
}

function renderReferenceDetailsBody(dialog, data = {}) {
  const body = dialog.querySelector(".planning-reference-details-dialog__body");
  if (!(body instanceof HTMLElement)) return;
  dialog.dataset.referenceDetailsDirty = "false";

  const references = Array.isArray(data.references) ? data.references : [];
  if (!references.length) {
    body.innerHTML = `<div class="planning-reference-details-dialog__empty">Aucune référence liée.</div>`;
    return;
  }

  const segmentStartIso = String(data.segmentStartIso || "").trim();
  const hasSegmentStartIso = /^\d{4}-\d{2}-\d{2}$/.test(segmentStartIso);

  body.innerHTML = `
    <table class="planning-reference-details-table">
      <thead>
        <tr>
          <th>Données d'entrées</th>
          <th>Reference</th>
          <th><label class="planning-ref-select-all-label"><input type="checkbox" class="planning-ref-select-all" title="Tout sélectionner / désélectionner"> Bloquant</label></th>
          <th>Durée (sem.)</th>
          <th>Durée Limite</th>
          <th>Retards</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = body.querySelector("tbody");
  references.forEach((reference) => {
    const tr = document.createElement("tr");
    tr.dataset.referenceId = String(reference?.id ?? "");
    tr.dataset.referenceRecu = String(reference?.recu || "");

    const emetteur = document.createElement("td");
    emetteur.textContent = String(reference?.emetteur ?? "");

    const referenceCell = document.createElement("td");
    referenceCell.textContent = String(reference?.reference ?? "");

    const bloquantCell = document.createElement("td");
    const bloquant = document.createElement("input");
    bloquant.type = "checkbox";
    bloquant.className = "planning-reference-details-table__bloquant";
    bloquant.checked = Boolean(reference?.bloquant);
    bloquantCell.append(bloquant);

    const durationCell = document.createElement("td");
    const duration = document.createElement("input");
    duration.type = "number";
    duration.min = "0";
    duration.step = "1";
    duration.inputMode = "numeric";
    duration.className = "planning-reference-details-table__duration";
    duration.value = reference?.durationWeeks == null ? "" : String(reference.durationWeeks);
    durationCell.append(duration);

    const dateLimiteCell = document.createElement("td");
    dateLimiteCell.className = "planning-reference-details-table__date-limite-cell";
    const dateLimite = document.createElement("input");
    dateLimite.type = "date";
    dateLimite.className = "planning-reference-details-table__date-limite";
    dateLimite.disabled = !hasSegmentStartIso;
    if (hasSegmentStartIso) {
      dateLimite.max = segmentStartIso;
    }
    const savedDurationValue = duration.value;
    const savedDateLimiteIso = hasSegmentStartIso
      ? normalizeReferenceDetailsLimitDateIso(reference?.dateLimite)
      : "";
    dateLimite.value = savedDateLimiteIso;
    dateLimiteCell.append(dateLimite);
    tr.dataset.referenceSavedDuration = savedDurationValue;
    tr.dataset.referenceSavedDateLimite = savedDateLimiteIso;

    const retardCell = document.createElement("td");
    retardCell.className = "planning-reference-details-table__retard";
    const savedRetardValue = computeReferenceDetailsRetardDays(
      tr.dataset.referenceRecu,
      savedDateLimiteIso
    );
    retardCell.textContent = formatReferenceDetailsRetardValue(savedRetardValue);
    retardCell.classList.toggle("has-retard", hasPositiveReferenceDetailsRetard(savedRetardValue));

    let syncingReferenceDetailsInputs = false;

    const updateReferenceDetailsPreviewState = () => {
      const durationText = String(duration.value || "").trim();
      const currentDateIso = normalizeReferenceDetailsLimitDateIso(dateLimite.value);
      const hasDuration = Boolean(durationText);
      const hasDate = Boolean(currentDateIso);
      const durationWeeks = parseReferenceDetailsDurationWeeks(durationText);
      const dateFromDurationIso = computeReferenceDetailsLimitDateIso(segmentStartIso, durationText);
      const durationFromDate = computeReferenceDetailsDurationWeeks(segmentStartIso, currentDateIso);
      const invalidDuration =
        hasDuration &&
        (
          durationWeeks == null ||
          (hasSegmentStartIso && !dateFromDurationIso)
        );
      const invalidDate = hasDate && (!hasSegmentStartIso || durationFromDate == null);
      const changed =
        durationText !== String(tr.dataset.referenceSavedDuration || "") ||
        currentDateIso !== String(tr.dataset.referenceSavedDateLimite || "");
      const currentRetardValue = computeReferenceDetailsRetardDays(
        tr.dataset.referenceRecu,
        currentDateIso
      );

      duration.classList.toggle("is-preview", changed && !invalidDuration && !invalidDate);
      dateLimite.classList.toggle(
        "is-preview",
        hasSegmentStartIso && changed && !invalidDuration && !invalidDate
      );
      retardCell.textContent = formatReferenceDetailsRetardValue(currentRetardValue);
      retardCell.classList.toggle("is-preview", changed && !invalidDuration && !invalidDate);
      retardCell.classList.toggle(
        "has-retard",
        hasPositiveReferenceDetailsRetard(currentRetardValue)
      );
      duration.classList.toggle("is-invalid-preview", invalidDuration || invalidDate);
      dateLimite.classList.toggle("is-invalid-preview", invalidDuration || invalidDate);
    };

    const updateDateLimitePreview = () => {
      if (syncingReferenceDetailsInputs) return;

      const durationText = String(duration.value || "").trim();
      syncingReferenceDetailsInputs = true;
      dateLimite.value = durationText
        ? computeReferenceDetailsLimitDateIso(segmentStartIso, durationText)
        : "";
      syncingReferenceDetailsInputs = false;
      updateReferenceDetailsPreviewState();
    };

    const updateDurationPreview = () => {
      if (syncingReferenceDetailsInputs) return;

      const dateLimiteIso = normalizeReferenceDetailsLimitDateIso(dateLimite.value);
      const durationWeeks = computeReferenceDetailsDurationWeeks(segmentStartIso, dateLimiteIso);
      syncingReferenceDetailsInputs = true;
      if (!dateLimiteIso && dateLimite.value) {
        dateLimite.value = "";
      }
      duration.value = dateLimiteIso && durationWeeks != null ? String(durationWeeks) : "";
      syncingReferenceDetailsInputs = false;
      updateReferenceDetailsPreviewState();
    };

    bloquant.addEventListener("change", () => {
      markReferenceDetailsControlDirty(bloquant, dialog);
    });
    duration.addEventListener("input", () => {
      markReferenceDetailsControlDirty(duration, dialog);
      markReferenceDetailsControlDirty(dateLimite, dialog);
      updateDateLimitePreview();
    });
    dateLimite.addEventListener("input", () => {
      markReferenceDetailsControlDirty(dateLimite, dialog);
      markReferenceDetailsControlDirty(duration, dialog);
      updateDurationPreview();
    });
    dateLimite.addEventListener("change", () => {
      markReferenceDetailsControlDirty(dateLimite, dialog);
      markReferenceDetailsControlDirty(duration, dialog);
      updateDurationPreview();
    });
    updateReferenceDetailsPreviewState();

    tr.append(emetteur, referenceCell, bloquantCell, durationCell, dateLimiteCell, retardCell);
    tbody?.append(tr);
  });

  // Logique "Tout sélectionner / désélectionner"
  const selectAllCb = body.querySelector(".planning-ref-select-all");
  const bloquantCbs = [...body.querySelectorAll(".planning-reference-details-table__bloquant")];

  function syncSelectAll() {
    if (!selectAllCb) return;
    const allChecked = bloquantCbs.length > 0 && bloquantCbs.every((cb) => cb.checked);
    const someChecked = bloquantCbs.some((cb) => cb.checked);
    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = someChecked && !allChecked;
  }

  if (selectAllCb) {
    selectAllCb.addEventListener("change", () => {
      markReferenceDetailsDialogDirty(dialog);
      bloquantCbs.forEach((cb) => {
        cb.checked = selectAllCb.checked;
        markReferenceDetailsControlDirty(cb, dialog);
      });
    });
    syncSelectAll();
    bloquantCbs.forEach((cb) => cb.addEventListener("change", syncSelectAll));
  }
}

async function openReferenceDetailsDialog() {
  if (!referenceDetailsHandler || !activeRetardJustificationContext) return;

  const dialog = ensureReferenceDetailsDialog();
  dialog.dataset.referenceDetailsDirty = "false";
  const lineEl = dialog.querySelector(".planning-reference-details-dialog__line");
  const body = dialog.querySelector(".planning-reference-details-dialog__body");
  const saveButton = dialog.querySelector(".planning-reference-details-dialog__save");

  if (lineEl) {
    lineEl.textContent = getRetardJustificationLabel(activeRetardJustificationContext);
  }
  if (body) {
    body.innerHTML = `<div class="planning-reference-details-dialog__empty">Chargement...</div>`;
  }
  if (saveButton instanceof HTMLButtonElement) {
    saveButton.disabled = true;
  }

  if (typeof dialog.showModal === "function" && !dialog.open) {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }

  try {
    const data = await referenceDetailsHandler({
      action: "load",
      context: { ...activeRetardJustificationContext },
    });
    renderReferenceDetailsBody(dialog, data);
  } catch (error) {
    console.error("Erreur détails références :", error);
    if (body) {
      body.innerHTML = `<div class="planning-reference-details-dialog__empty">Erreur : ${escapeHtml(error.message || error)}</div>`;
    }
  } finally {
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = false;
    }
  }
}

async function commitReferenceDetailsDialog() {
  if (!referenceDetailsHandler || !activeRetardJustificationContext) return;

  const dialog = ensureReferenceDetailsDialog();
  const controls = dialog.querySelectorAll("button, input");
  const rows = [...dialog.querySelectorAll("tbody tr")];
  const updates = rows.map((row) => {
    const id = Number(row.dataset.referenceId || "");
    const bloquant = row.querySelector(".planning-reference-details-table__bloquant");
    const duration = row.querySelector(".planning-reference-details-table__duration");
    const dateLimite = row.querySelector(".planning-reference-details-table__date-limite");
    return {
      id,
      bloquant: Boolean(bloquant instanceof HTMLInputElement && bloquant.checked),
      durationWeeks: duration instanceof HTMLInputElement ? duration.value : "",
      dateLimite: dateLimite instanceof HTMLInputElement ? dateLimite.value : "",
    };
  });

  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    await referenceDetailsHandler({
      action: "save",
      context: { ...activeRetardJustificationContext },
      updates,
    });
    dialog.close();
  } catch (error) {
    console.error("Erreur sauvegarde détails références :", error);
    alert(`Erreur détails références : ${error.message}`);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
}

function buildRetardContextFromRow(rowEl) {
  if (!(rowEl instanceof HTMLElement)) return null;

  const rowId = Number(rowEl.dataset.planningRowId || "");
  if (!Number.isInteger(rowId) || rowId <= 0) return;

  return {
    rowId,
    project: rowEl.dataset.planningProject || "",
    id2: rowEl.dataset.planningId2 || "",
    task: rowEl.dataset.planningTask || "",
    typeDoc: rowEl.dataset.planningTypeDoc || "",
    zone: rowEl.dataset.planningZone || "",
    debutIso: rowEl.dataset.planningStartIso || "",
    retards: rowEl.dataset.planningRetards || "",
    remarque: rowEl.dataset.planningRemarque || "",
  };
}

function openRetardContextMenu(event, rowEl) {
  if (!(rowEl instanceof HTMLElement) || (!retardJustificationHandler && !referenceDetailsHandler)) return;

  const context = buildRetardContextFromRow(rowEl);
  if (!context) return;

  event.preventDefault();
  event.stopPropagation();

  activeRetardJustificationContext = context;

  const menu = ensureRetardContextMenu();
  positionFixedElementNearPointer(menu, event);
}

function getEventTargetElement(event) {
  const directTarget = event?.target;
  if (directTarget instanceof Element) {
    return directTarget;
  }

  if (typeof event?.composedPath === "function") {
    const elementFromPath = event.composedPath().find((node) => node instanceof Element);
    if (elementFromPath instanceof Element) {
      return elementFromPath;
    }
  }

  return null;
}

function setPlanningRowDraggingClass(active) {
  document.body?.classList.toggle("planning-row-dragging", Boolean(active));
  document.documentElement?.classList.toggle("planning-row-dragging", Boolean(active));
}

function normalizePlanningZoneForMatch(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
}

function isPlanningTypeDocMatch(value, keyword) {
  const normalizedValue = String(value ?? "").toUpperCase();
  return normalizedValue.includes(String(keyword ?? "").toUpperCase());
}

function isPlanningRealiseComplete(value) {
  const normalizedValue = String(value ?? "").trim().replace(",", ".");
  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue) && numericValue >= 100;
}

function collectLinkedArmatureRowIdsForCoffrage(sourceRowEl) {
  if (!(sourceRowEl instanceof HTMLElement)) return [];

  const sourceTypeDoc = String(sourceRowEl.dataset.planningTypeDoc || "");
  if (!isPlanningTypeDocMatch(sourceTypeDoc, "COFFRAGE")) return [];

  const sourceRowId = Number(sourceRowEl.dataset.planningRowId || "");
  if (!Number.isInteger(sourceRowId) || sourceRowId <= 0) return [];

  const sourceGroup = String(sourceRowEl.dataset.planningGroupe || "").trim();
  if (!sourceGroup) return [];

  const sourceZone = normalizePlanningZoneForMatch(sourceRowEl.dataset.planningZone || "");
  const linkedRowIds = [];

  if (groupsDataSet && typeof groupsDataSet.forEach === "function") {
    groupsDataSet.forEach((group) => {
      if (!group || group.isZoneHeader) return;

      const candidateRowId = Number(group.rowId || "");
      if (!Number.isInteger(candidateRowId) || candidateRowId <= 0 || candidateRowId === sourceRowId) {
        return;
      }

      const candidateTypeDoc = String(group.typeDocLabel || "");
      if (!isPlanningTypeDocMatch(candidateTypeDoc, "ARMATURES")) return;

      const candidateGroup = String(group.groupeLabel || "").trim();
      if (!candidateGroup || candidateGroup !== sourceGroup) return;

      const candidateZone = normalizePlanningZoneForMatch(group.zoneLabel || "");
      if (candidateZone !== sourceZone) return;

      linkedRowIds.push(candidateRowId);
    });
  }

  return [...new Set(linkedRowIds)];
}

function getPlanningRowElementByRowId(rowId) {
  const normalizedRowId = Number(rowId);
  if (!Number.isInteger(normalizedRowId) || normalizedRowId <= 0) return null;

  const container =
    planningRowDragContainerEl instanceof HTMLElement
      ? planningRowDragContainerEl
      : document;
  const rowEl = container.querySelector(
    `.group-row-grid.planning-draggable-row[data-planning-row-id="${normalizedRowId}"]`
  );
  return rowEl instanceof HTMLElement ? rowEl : null;
}

function collectLinkedArmatureRowElements(rowIds = []) {
  if (!Array.isArray(rowIds) || !rowIds.length) return [];
  const linkedRows = [];

  rowIds.forEach((rowId) => {
    const rowEl = getPlanningRowElementByRowId(rowId);
    if (rowEl instanceof HTMLElement) {
      linkedRows.push(rowEl);
    }
  });

  return linkedRows;
}

function buildPlanningRowDragPayload(rowEl, linkedArmatureRowIds = []) {
  if (!(rowEl instanceof HTMLElement)) return null;

  const rowId = Number(rowEl.dataset.planningRowId || "");
  if (!Number.isInteger(rowId) || rowId <= 0) return null;

  const normalizedLinkedArmatureRowIds = (Array.isArray(linkedArmatureRowIds) ? linkedArmatureRowIds : [])
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0 && id !== rowId);

  return {
    type: "planning-row",
    rowId,
    id2: String(rowEl.dataset.planningId2 ?? "").trim(),
    task: String(rowEl.dataset.planningTask ?? "").trim(),
    groupe: String(rowEl.dataset.planningGroupe ?? "").trim(),
    zone: String(rowEl.dataset.planningZone ?? "").trim(),
    lignePlanning: String(rowEl.dataset.planningLignePlanning ?? "").trim(),
    typeDoc: String(rowEl.dataset.planningTypeDoc ?? "").trim(),
    startIso: String(rowEl.dataset.planningStartIso ?? "").trim(),
    endIso: String(rowEl.dataset.planningEndIso ?? "").trim(),
    demarrageIso: String(rowEl.dataset.planningDemarrageIso ?? "").trim(),
    indice: String(rowEl.dataset.planningIndice ?? "").trim(),
    retards: String(rowEl.dataset.planningRetards ?? "").trim(),
    linkedArmatureRowIds: normalizedLinkedArmatureRowIds,
    linkedArmatureCount: normalizedLinkedArmatureRowIds.length,
  };
}

function setPlanningRowDragData(dataTransfer, payload) {
  if (!dataTransfer || !payload) return;
  const jsonPayload = JSON.stringify(payload);

  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData("application/x-planning-row", jsonPayload);
  dataTransfer.setData("text/x-planning-row", jsonPayload);
}

function clearPlanningNativeDragImage() {
  if (activePlanningNativeDragImageEl && activePlanningNativeDragImageEl.isConnected) {
    activePlanningNativeDragImageEl.remove();
  }
  activePlanningNativeDragImageEl = null;
}

function getPlanningScrollWrapper() {
  const wrapper = document.getElementById("timelineWrapper");
  return wrapper instanceof HTMLElement ? wrapper : null;
}

function stopPlanningDragAutoScroll() {
  if (planningDragAutoScrollRafId) {
    cancelAnimationFrame(planningDragAutoScrollRafId);
  }
  planningDragAutoScrollRafId = 0;
  planningDragAutoScrollVelocityY = 0;
  planningDragAutoScrollTargetEl = null;
  planningDragAutoScrollLastTs = 0;
}

function runPlanningDragAutoScroll(ts) {
  const target = planningDragAutoScrollTargetEl;
  const velocity = planningDragAutoScrollVelocityY;
  if (!(target instanceof HTMLElement) || !Number.isFinite(velocity) || Math.abs(velocity) < 0.1) {
    stopPlanningDragAutoScroll();
    return;
  }

  const dtSeconds = planningDragAutoScrollLastTs
    ? Math.min(0.05, Math.max(0.001, (ts - planningDragAutoScrollLastTs) / 1000))
    : (1 / 60);
  planningDragAutoScrollLastTs = ts;

  const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
  const nextTop = Math.max(0, Math.min(maxTop, target.scrollTop + (velocity * dtSeconds)));
  target.scrollTop = nextTop;

  planningDragAutoScrollRafId = requestAnimationFrame(runPlanningDragAutoScroll);
}

function startPlanningDragAutoScrollIfNeeded() {
  if (planningDragAutoScrollRafId) return;
  planningDragAutoScrollLastTs = 0;
  planningDragAutoScrollRafId = requestAnimationFrame(runPlanningDragAutoScroll);
}

function computePlanningAutoScrollVelocity(distanceToEdge, threshold, maxAbsSpeedPxPerSec) {
  if (!Number.isFinite(distanceToEdge) || distanceToEdge >= threshold) return 0;
  const clamped = Math.max(0, Math.min(threshold, distanceToEdge));
  const ratio = 1 - (clamped / threshold);
  const eased = ratio * ratio;
  return eased * maxAbsSpeedPxPerSec;
}

function updatePlanningDragAutoScrollFromPointer(clientX, clientY) {
  if (!(activePlanningDraggedRowEl instanceof HTMLElement)) {
    stopPlanningDragAutoScroll();
    return;
  }

  const wrapper = getPlanningScrollWrapper();
  if (!(wrapper instanceof HTMLElement)) {
    stopPlanningDragAutoScroll();
    return;
  }

  const x = Number(clientX);
  const y = Number(clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    stopPlanningDragAutoScroll();
    return;
  }

  const rect = wrapper.getBoundingClientRect();
  const isInsideX = x >= rect.left && x <= rect.right;
  const nearX =
    isInsideX ||
    (x >= rect.left - 64 && x <= rect.right + 64);
  if (!nearX) {
    stopPlanningDragAutoScroll();
    return;
  }

  const threshold = Math.max(56, Math.min(140, Math.round(rect.height * 0.2)));
  const topDist = y - rect.top;
  const bottomDist = rect.bottom - y;
  const maxSpeed = 1500;

  let velocityY = 0;
  if (topDist < threshold) {
    velocityY = -computePlanningAutoScrollVelocity(topDist, threshold, maxSpeed);
  } else if (bottomDist < threshold) {
    velocityY = computePlanningAutoScrollVelocity(bottomDist, threshold, maxSpeed);
  }

  if (!Number.isFinite(velocityY) || Math.abs(velocityY) < 1) {
    stopPlanningDragAutoScroll();
    return;
  }

  planningDragAutoScrollTargetEl = wrapper;
  planningDragAutoScrollVelocityY = velocityY;
  startPlanningDragAutoScrollIfNeeded();
}

function cloneSinglePlanningRowPreview(rowEl, payload, { isLinked = false } = {}) {
  if (!(rowEl instanceof HTMLElement)) return null;
  const preview = rowEl.cloneNode(true);
  if (!(preview instanceof HTMLElement)) return null;

  const rowRect = rowEl.getBoundingClientRect();
  preview.className = "group-row-grid planning-native-drag-row";
  if (isLinked) {
    preview.classList.add("planning-native-drag-row-linked");
  }
  preview.style.width = `${Math.max(420, Math.round(rowRect.width))}px`;
  preview.style.pointerEvents = "none";
  preview.style.position = "static";
  preview.style.top = "";
  preview.style.left = "";

  preview.querySelectorAll(".editable-duration-cell").forEach((cell) => {
    if (!(cell instanceof HTMLElement)) return;
    cell.classList.remove("editable-duration-cell", "is-editing-duration", "is-saving-duration");
    cell.removeAttribute("title");
  });

  if (!preview.childElementCount) {
    preview.textContent = payload?.task || payload?.id2 || "Ligne planning";
  }

  return preview;
}

function clonePlanningRowForDragPreview(rowEl, payload, linkedArmatureRows = []) {
  if (!(rowEl instanceof HTMLElement)) return null;

  const linkedRows = Array.isArray(linkedArmatureRows)
    ? linkedArmatureRows.filter((candidate) => candidate instanceof HTMLElement)
    : [];

  const sourcePreview = cloneSinglePlanningRowPreview(rowEl, payload);
  if (!(sourcePreview instanceof HTMLElement)) return null;

  if (!linkedRows.length) {
    sourcePreview.style.position = "fixed";
    sourcePreview.style.top = "-10000px";
    sourcePreview.style.left = "-10000px";
    sourcePreview.style.zIndex = "1000002";
    document.body.appendChild(sourcePreview);
    return sourcePreview;
  }

  const stackEl = document.createElement("div");
  stackEl.className = "planning-native-drag-stack";
  stackEl.style.position = "fixed";
  stackEl.style.top = "-10000px";
  stackEl.style.left = "-10000px";
  stackEl.style.pointerEvents = "none";
  stackEl.style.zIndex = "1000002";

  stackEl.appendChild(sourcePreview);

  linkedRows.forEach((linkedRowEl) => {
    const linkedPreview = cloneSinglePlanningRowPreview(linkedRowEl, payload, {
      isLinked: true,
    });
    if (!(linkedPreview instanceof HTMLElement)) return;
    stackEl.appendChild(linkedPreview);
  });

  document.body.appendChild(stackEl);
  return stackEl;
}

function clearPlanningRowDraggingState(containerEl = null) {
  setPlanningRowDraggingClass(false);
  stopPlanningDragAutoScroll();

  if (activePlanningDraggedRowEl && activePlanningDraggedRowEl.isConnected) {
    activePlanningDraggedRowEl.classList.remove("is-dragging-row");
  }
  if (Array.isArray(activePlanningDraggedLinkedRowEls)) {
    activePlanningDraggedLinkedRowEls.forEach((linkedRowEl) => {
      if (!(linkedRowEl instanceof HTMLElement) || !linkedRowEl.isConnected) return;
      linkedRowEl.classList.remove("is-dragging-row");
    });
  }
  activePlanningDraggedLinkedRowEls = [];
  activePlanningDraggedRowEl = null;
  clearPlanningNativeDragImage();

  const effectiveContainer =
    containerEl instanceof HTMLElement
      ? containerEl
      : (planningRowDragContainerEl instanceof HTMLElement ? planningRowDragContainerEl : document);
  const draggingRows = effectiveContainer.querySelectorAll(
    ".group-row-grid.planning-draggable-row.is-dragging-row"
  );
  draggingRows.forEach((rowEl) => rowEl.classList.remove("is-dragging-row"));
}

function resolvePlanningDragRowElement(event, forcedRowEl = null) {
  if (forcedRowEl instanceof HTMLElement) return forcedRowEl;

  const targetEl = getEventTargetElement(event);
  if (!(targetEl instanceof Element)) return null;

  const rowEl = targetEl.closest(".group-row-grid.planning-draggable-row");
  if (!(rowEl instanceof HTMLElement)) return null;
  return rowEl;
}

function handlePlanningNativeDragStart(event, forcedRowEl = null) {
  if (!event) return;
  if (event[PLANNING_ROW_DRAG_HANDLED_FLAG]) return;

  const rowEl = resolvePlanningDragRowElement(event, forcedRowEl);
  if (!(rowEl instanceof HTMLElement)) return;
  if (
    planningRowDragContainerEl instanceof HTMLElement &&
    !planningRowDragContainerEl.contains(rowEl)
  ) {
    return;
  }

  event[PLANNING_ROW_DRAG_HANDLED_FLAG] = true;

  const linkedArmatureRowIds = collectLinkedArmatureRowIdsForCoffrage(rowEl);
  const linkedArmatureRows = collectLinkedArmatureRowElements(linkedArmatureRowIds);
  const payload = buildPlanningRowDragPayload(rowEl, linkedArmatureRowIds);
  if (!payload) {
    event.preventDefault();
    return;
  }

  setPlanningRowDragData(event.dataTransfer, payload);
  clearPlanningNativeDragImage();
  const nativeImage = clonePlanningRowForDragPreview(rowEl, payload, linkedArmatureRows);
  if (nativeImage) {
    activePlanningNativeDragImageEl = nativeImage;
    if (event.dataTransfer?.setDragImage) {
      event.dataTransfer.setDragImage(nativeImage, 20, 16);
    }
  }

  rowEl.classList.add("is-dragging-row");
  linkedArmatureRows.forEach((linkedRowEl) => {
    if (!(linkedRowEl instanceof HTMLElement)) return;
    linkedRowEl.classList.add("is-dragging-row");
  });
  activePlanningDraggedLinkedRowEls = linkedArmatureRows;
  activePlanningDraggedRowEl = rowEl;
  setPlanningRowDraggingClass(true);
}

function bindGlobalPlanningRowDragging() {
  if (planningRowDragGlobalListenersBound) return;
  planningRowDragGlobalListenersBound = true;

  window.addEventListener(
    "dragover",
    (event) => {
      if (!hasPlanningRowPayloadType(event.dataTransfer)) return;
      updatePlanningDragAutoScrollFromPointer(event.clientX, event.clientY);
      updatePlanningDropTargetPreview(event);
    },
    true
  );

  window.addEventListener(
    "dragstart",
    (event) => {
      handlePlanningNativeDragStart(event);
    },
    true
  );

  window.addEventListener(
    "dragend",
    () => {
      stopPlanningDragAutoScroll();
      clearPlanningRowDraggingState(null);
    },
    true
  );

  window.addEventListener(
    "drop",
    () => {
      stopPlanningDragAutoScroll();
      clearPlanningRowDraggingState(null);
    },
    true
  );
}

function bindPlanningRowDragging(containerEl) {
  if (!(containerEl instanceof HTMLElement) || planningRowDragBound) return;
  planningRowDragBound = true;
  planningRowDragContainerEl = containerEl;
  bindGlobalPlanningRowDragging();
}

function hasPlanningRowPayloadType(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes("application/x-planning-row") ||
    types.includes("text/x-planning-row")
  );
}

function extractPlanningRowPayloadFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return null;

  const readData = (mimeType) => {
    try {
      return dataTransfer.getData(mimeType);
    } catch (error) {
      return "";
    }
  };

  const rawPayload =
    readData("application/x-planning-row") || readData("text/x-planning-row");
  if (!rawPayload) return null;

  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || parsed.type !== "planning-row") return null;
    const rowId = Number(parsed.rowId);
    if (!Number.isInteger(rowId) || rowId <= 0) return null;
    const linkedArmatureRowIds = Array.isArray(parsed.linkedArmatureRowIds)
      ? [...new Set(
        parsed.linkedArmatureRowIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0 && value !== rowId)
      )]
      : [];
    return {
      ...parsed,
      rowId,
      linkedArmatureRowIds,
    };
  } catch (error) {
    return null;
  }
}

function normalizePlanningDropPosition(position) {
  return position === "before" ? "before" : "after";
}

function getPlanningDropEventClientY(eventLike) {
  if (!eventLike) return NaN;

  const directClientY = Number(eventLike.clientY);
  if (Number.isFinite(directClientY)) return directClientY;

  const sourceEvent = eventLike?.srcEvent || eventLike?.event || null;
  const sourceClientY = Number(sourceEvent?.clientY);
  if (Number.isFinite(sourceClientY)) return sourceClientY;

  return NaN;
}

function getPlanningDropCandidateElements(containerEl) {
  if (!(containerEl instanceof HTMLElement)) return [];
  return Array.from(
    containerEl.querySelectorAll(".zone-header-band, .group-row-grid.planning-draggable-row")
  ).filter((element) => element instanceof HTMLElement);
}

function findPlanningDropCandidateAtClientY(containerEl, clientY) {
  if (!(containerEl instanceof HTMLElement)) return null;

  const pointerY = Number(clientY);
  if (!Number.isFinite(pointerY)) return null;

  const candidates = getPlanningDropCandidateElements(containerEl);
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (pointerY >= rect.top && pointerY <= rect.bottom) {
      return candidate;
    }
  }

  return null;
}

function resolvePlanningRowDropPosition(rowEl, clientY) {
  if (!(rowEl instanceof HTMLElement)) return "after";

  const pointerY = Number(clientY);
  if (!Number.isFinite(pointerY)) return "after";

  const rect = rowEl.getBoundingClientRect();
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) {
    return "after";
  }

  const midpoint = rect.top + (rect.height / 2);
  return pointerY < midpoint ? "before" : "after";
}

function clearPlanningRowDropTarget(containerEl = null) {
  if (activePlanningDropRowEl && activePlanningDropRowEl.isConnected) {
    activePlanningDropRowEl.classList.remove(
      "is-planning-row-drop-target",
      "is-planning-row-drop-before",
      "is-planning-row-drop-after",
      "is-planning-row-drop-committing"
    );
  }
  if (activePlanningDropZoneEl && activePlanningDropZoneEl.isConnected) {
    activePlanningDropZoneEl.classList.remove(
      "is-planning-zone-drop-target",
      "is-planning-zone-drop-committing"
    );
  }
  if (activePlanningDropPreviewRowEl && activePlanningDropPreviewRowEl.isConnected) {
    activePlanningDropPreviewRowEl.classList.remove("is-planning-drop-placement-row");
  }
  if (activePlanningDropPreviewLabelEl && activePlanningDropPreviewLabelEl.isConnected) {
    activePlanningDropPreviewLabelEl.classList.remove("is-planning-drop-placement-label");
  }

  activePlanningDropRowEl = null;
  activePlanningDropZoneEl = null;
  activePlanningDropPosition = "";
  activePlanningDropPreviewRowEl = null;
  activePlanningDropPreviewLabelEl = null;
  hidePlanningDropPlacementOverlay();

  const effectiveContainer =
    containerEl instanceof HTMLElement
      ? containerEl
      : document.getElementById("planningTimeline");
  if (effectiveContainer instanceof HTMLElement) {
    effectiveContainer.classList.remove("is-planning-row-drop-active");
  }
}

function ensurePlanningDropPlacementOverlay(containerEl) {
  if (
    planningDropPlacementOverlayEl instanceof HTMLElement &&
    planningDropPlacementOverlayEl.isConnected
  ) {
    return planningDropPlacementOverlayEl;
  }

  if (planningDropPlacementOverlayEl instanceof HTMLElement && planningDropPlacementOverlayEl.isConnected) {
    planningDropPlacementOverlayEl.remove();
  }

  const overlayEl = document.createElement("div");
  overlayEl.className = "planning-drop-placement-overlay";
  overlayEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlayEl);
  planningDropPlacementOverlayEl = overlayEl;
  return planningDropPlacementOverlayEl;
}

function hidePlanningDropPlacementOverlay() {
  if (!(planningDropPlacementOverlayEl instanceof HTMLElement)) return;
  planningDropPlacementOverlayEl.classList.remove(
    "is-visible",
    "is-before",
    "is-after",
    "is-coffrage"
  );
  planningDropPlacementOverlayEl.style.removeProperty("left");
  planningDropPlacementOverlayEl.style.removeProperty("top");
  planningDropPlacementOverlayEl.style.removeProperty("width");
  planningDropPlacementOverlayEl.style.removeProperty("height");
}

function setPlanningDropPlacementOverlay(rowEl, containerEl, position = "after") {
  if (!(rowEl instanceof HTMLElement) || !(containerEl instanceof HTMLElement)) {
    hidePlanningDropPlacementOverlay();
    return;
  }

  const overlayEl = ensurePlanningDropPlacementOverlay(containerEl);
  if (!(overlayEl instanceof HTMLElement)) return;

  const anchorRect = rowEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const normalizedPosition = normalizePlanningDropPosition(position);
  const insertionY =
    normalizedPosition === "before"
      ? anchorRect.top
      : anchorRect.bottom;
  const indicatorHeight = 10;
  const top = Math.round(insertionY - (indicatorHeight / 2));
  const left = Math.round(containerRect.left);
  const width = Math.max(1, Math.round(containerRect.width));

  overlayEl.style.left = `${left}px`;
  overlayEl.style.top = `${top}px`;
  overlayEl.style.width = `${width}px`;
  overlayEl.style.height = `${indicatorHeight}px`;
  overlayEl.classList.add("is-visible");
  overlayEl.classList.toggle("is-before", normalizedPosition === "before");
  overlayEl.classList.toggle("is-after", normalizedPosition !== "before");
  overlayEl.classList.toggle("is-coffrage", rowEl.classList.contains("row-type-coffrage"));
}

function updatePlanningDropTargetPreview(eventLike) {
  const containerEl =
    planningRowDragContainerEl instanceof HTMLElement
      ? planningRowDragContainerEl
      : document.getElementById("planningTimeline");
  if (!(containerEl instanceof HTMLElement)) return;

  const clientX = Number(eventLike?.clientX);
  const clientY = getPlanningDropEventClientY(eventLike);
  const containerRect = containerEl.getBoundingClientRect();
  const isInsideContainer =
    Number.isFinite(clientX) &&
    Number.isFinite(clientY) &&
    clientX >= containerRect.left &&
    clientX <= containerRect.right &&
    clientY >= containerRect.top &&
    clientY <= containerRect.bottom;

  if (!isInsideContainer) {
    clearPlanningRowDropTarget(containerEl);
    return;
  }

  const candidateEl = findPlanningDropCandidateAtClientY(containerEl, clientY);
  if (
    candidateEl instanceof HTMLElement &&
    candidateEl.classList.contains("group-row-grid")
  ) {
    const targetRowId = Number(candidateEl.dataset.planningRowId || "");
    const sourceRowId = Number(activePlanningDraggedRowEl?.dataset?.planningRowId || "");
    if (
      Number.isInteger(targetRowId) &&
      targetRowId > 0 &&
      targetRowId !== sourceRowId
    ) {
      setPlanningRowDropTarget(
        candidateEl,
        containerEl,
        resolvePlanningRowDropPosition(candidateEl, clientY)
      );
      return;
    }
  }

  if (
    candidateEl instanceof HTMLElement &&
    candidateEl.classList.contains("zone-header-band")
  ) {
    setPlanningZoneDropTarget(candidateEl, containerEl);
    return;
  }

  clearPlanningRowDropTarget(containerEl);
}

function setPlanningDropPreviewRow(rowEl) {
  if (activePlanningDropPreviewRowEl === rowEl) return;

  if (activePlanningDropPreviewRowEl && activePlanningDropPreviewRowEl.isConnected) {
    activePlanningDropPreviewRowEl.classList.remove("is-planning-drop-placement-row");
  }
  if (activePlanningDropPreviewLabelEl && activePlanningDropPreviewLabelEl.isConnected) {
    activePlanningDropPreviewLabelEl.classList.remove("is-planning-drop-placement-label");
  }

  activePlanningDropPreviewRowEl = rowEl instanceof HTMLElement ? rowEl : null;
  if (activePlanningDropPreviewRowEl) {
    activePlanningDropPreviewRowEl.classList.add("is-planning-drop-placement-row");
    activePlanningDropPreviewLabelEl =
      activePlanningDropPreviewRowEl.closest(".vis-label") instanceof HTMLElement
        ? activePlanningDropPreviewRowEl.closest(".vis-label")
        : null;
    if (activePlanningDropPreviewLabelEl) {
      activePlanningDropPreviewLabelEl.classList.add("is-planning-drop-placement-label");
    }
  } else {
    activePlanningDropPreviewLabelEl = null;
  }
}

function setPlanningRowDropTarget(rowEl, containerEl, position = "after") {
  if (!(containerEl instanceof HTMLElement)) return;
  containerEl.classList.add("is-planning-row-drop-active");

  if (!(rowEl instanceof HTMLElement)) {
    if (activePlanningDropRowEl || activePlanningDropZoneEl) {
      clearPlanningRowDropTarget(containerEl);
      containerEl.classList.add("is-planning-row-drop-active");
    }
    return;
  }

  const normalizedPosition = normalizePlanningDropPosition(position);
  if (
    activePlanningDropRowEl === rowEl &&
    activePlanningDropPosition === normalizedPosition
  ) {
    return;
  }

  clearPlanningRowDropTarget(containerEl);
  containerEl.classList.add("is-planning-row-drop-active");
  rowEl.classList.add("is-planning-row-drop-target");
  rowEl.classList.add(
    normalizedPosition === "before"
      ? "is-planning-row-drop-before"
      : "is-planning-row-drop-after"
  );
  activePlanningDropRowEl = rowEl;
  activePlanningDropPosition = normalizedPosition;
  setPlanningDropPreviewRow(rowEl);
  setPlanningDropPlacementOverlay(rowEl, containerEl, normalizedPosition);
}

function setPlanningZoneDropTarget(zoneEl, containerEl) {
  if (!(containerEl instanceof HTMLElement)) return;
  containerEl.classList.add("is-planning-row-drop-active");

  if (!(zoneEl instanceof HTMLElement)) {
    if (activePlanningDropRowEl || activePlanningDropZoneEl) {
      clearPlanningRowDropTarget(containerEl);
      containerEl.classList.add("is-planning-row-drop-active");
    }
    return;
  }

  if (activePlanningDropZoneEl === zoneEl) return;

  clearPlanningRowDropTarget(containerEl);
  containerEl.classList.add("is-planning-row-drop-active");
  zoneEl.classList.add("is-planning-zone-drop-target");
  activePlanningDropZoneEl = zoneEl;
  const previewRow = findPlanningZonePreviewRow(zoneEl, containerEl);
  setPlanningDropPreviewRow(previewRow);
  setPlanningDropPlacementOverlay(
    previewRow || zoneEl,
    containerEl,
    previewRow ? "before" : "after"
  );
}

function findZoneHeaderBandElement(containerEl, zoneKey = "", zoneLabel = "") {
  if (!(containerEl instanceof HTMLElement)) return null;
  const bands = containerEl.querySelectorAll(".zone-header-band");
  if (!bands.length) return null;

  const normalizedZoneKey = String(zoneKey ?? "").trim();
  const normalizedZoneLabel = String(zoneLabel ?? "").trim().toLocaleLowerCase("fr");

  for (const band of bands) {
    if (!(band instanceof HTMLElement)) continue;
    const bandZoneKey = String(band.dataset.planningZoneKey || "").trim();
    if (normalizedZoneKey && bandZoneKey === normalizedZoneKey) {
      return band;
    }
  }

  for (const band of bands) {
    if (!(band instanceof HTMLElement)) continue;
    const bandZoneLabel = String(
      band.dataset.planningZoneLabel || band.textContent || ""
    )
      .trim()
      .toLocaleLowerCase("fr");
    if (normalizedZoneLabel && bandZoneLabel === normalizedZoneLabel) {
      return band;
    }
  }

  return null;
}

function findPlanningZonePreviewRow(zoneEl, containerEl) {
  if (!(zoneEl instanceof HTMLElement) || !(containerEl instanceof HTMLElement)) return null;

  const orderedTargets = getPlanningDropCandidateElements(containerEl);
  const zoneIndex = orderedTargets.findIndex((el) => el === zoneEl);
  if (zoneIndex < 0) return null;

  for (let i = zoneIndex + 1; i < orderedTargets.length; i += 1) {
    const candidate = orderedTargets[i];
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate.classList.contains("zone-header-band")) {
      return null;
    }
    if (candidate.classList.contains("group-row-grid")) {
      return candidate;
    }
  }

  return null;
}

function resolvePlanningZoneDropTarget(targetEl, containerEl, eventLike = null) {
  const targetFromPointer = findPlanningDropCandidateAtClientY(
    containerEl,
    getPlanningDropEventClientY(eventLike)
  );
  if (
    targetFromPointer instanceof HTMLElement &&
    targetFromPointer.classList.contains("zone-header-band")
  ) {
    return {
      zoneKey: String(targetFromPointer.dataset.planningZoneKey || "").trim(),
      zoneLabel: String(
        targetFromPointer.dataset.planningZoneLabel || targetFromPointer.textContent || ""
      ).trim(),
      zoneEl: targetFromPointer,
    };
  }

  if (targetEl instanceof Element) {
    const zoneBand = targetEl.closest(".zone-header-band");
    if (zoneBand instanceof HTMLElement && containerEl.contains(zoneBand)) {
      return {
        zoneKey: String(zoneBand.dataset.planningZoneKey || "").trim(),
        zoneLabel: String(zoneBand.dataset.planningZoneLabel || zoneBand.textContent || "").trim(),
        zoneEl: zoneBand,
      };
    }
  }

  if (
    timelineInstance &&
    typeof timelineInstance.getEventProperties === "function" &&
    groupsDataSet &&
    eventLike
  ) {
    const props = timelineInstance.getEventProperties(eventLike);
    const groupId = props?.group;
    if (groupId != null) {
      const group =
        groupsDataSet.get(groupId) ||
        groupsDataSet.get(String(groupId)) ||
        groupsDataSet.get(Number(groupId)) ||
        null;

      if (group?.isZoneHeader) {
        const zoneKey = String(group?.meta?.zoneKey || group?.zoneKey || "").trim();
        const zoneLabel = String(group?.zoneLabel || "").trim();
        return {
          zoneKey,
          zoneLabel,
          zoneEl: findZoneHeaderBandElement(containerEl, zoneKey, zoneLabel),
        };
      }
    }
  }

  return null;
}

function bindPlanningRowDrop(containerEl) {
  if (!(containerEl instanceof HTMLElement) || planningRowDropBound) return;
  planningRowDropBound = true;

  containerEl.addEventListener("dragover", (event) => {
    if (!hasPlanningRowPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    updatePlanningDragAutoScrollFromPointer(event.clientX, event.clientY);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const payload = extractPlanningRowPayloadFromDataTransfer(event.dataTransfer);
    if (!payload) {
      clearPlanningRowDropTarget(containerEl);
      return;
    }

    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);
    const targetRowId = Number(rowEl?.dataset?.planningRowId || "");
    const isValidRowTarget =
      rowEl instanceof HTMLElement &&
      Number.isInteger(targetRowId) &&
      targetRowId > 0 &&
      targetRowId !== payload.rowId;

    if (isValidRowTarget) {
      const targetDropPosition = resolvePlanningRowDropPosition(rowEl, event.clientY);
      setPlanningRowDropTarget(rowEl, containerEl, targetDropPosition);
      return;
    }

    const zoneTarget = resolvePlanningZoneDropTarget(targetEl, containerEl, event);
    const zoneLabel = String(zoneTarget?.zoneLabel || "").trim();
    if (zoneLabel) {
      setPlanningZoneDropTarget(zoneTarget?.zoneEl, containerEl);
      return;
    }

    setPlanningRowDropTarget(null, containerEl);
  });

  containerEl.addEventListener("dragleave", (event) => {
    if (!containerEl.classList.contains("is-planning-row-drop-active")) return;
    const rect = containerEl.getBoundingClientRect();
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    const outsideContainer =
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom;

    if (outsideContainer) {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    }
  });

  containerEl.addEventListener("drop", async (event) => {
    if (!hasPlanningRowPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();

    const payload = extractPlanningRowPayloadFromDataTransfer(event.dataTransfer);
    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);
    const targetRowId = Number(rowEl?.dataset?.planningRowId || "");
    const zoneTarget = resolvePlanningZoneDropTarget(targetEl, containerEl, event);
    const targetZoneLabel = String(zoneTarget?.zoneLabel || "").trim();
    const isValidRowTarget =
      rowEl instanceof HTMLElement &&
      Number.isInteger(targetRowId) &&
      targetRowId > 0 &&
      targetRowId !== payload?.rowId;
    const targetDropPosition = isValidRowTarget
      ? resolvePlanningRowDropPosition(rowEl, event.clientY)
      : "";

    if (!payload || (!isValidRowTarget && !targetZoneLabel)) {
      clearPlanningRowDropTarget(containerEl);
      return;
    }

    if (isValidRowTarget) {
      setPlanningRowDropTarget(rowEl, containerEl, targetDropPosition);
      rowEl.classList.add("is-planning-row-drop-committing");
    } else {
      setPlanningZoneDropTarget(zoneTarget?.zoneEl, containerEl);
      if (activePlanningDropZoneEl instanceof HTMLElement) {
        activePlanningDropZoneEl.classList.add("is-planning-zone-drop-committing");
      }
    }

    try {
      if (typeof planningRowDropHandler === "function") {
        await planningRowDropHandler({
          sourcePlanningRowId: payload.rowId,
          targetPlanningRowId: isValidRowTarget ? targetRowId : null,
          payload,
          targetTask: isValidRowTarget
            ? String(rowEl.querySelector(".cell-task")?.textContent || "").trim()
            : "",
          targetGroupe: isValidRowTarget ? String(rowEl.dataset.planningGroupe || "").trim() : "",
          targetDropPosition: targetDropPosition || "",
          targetZone: isValidRowTarget
            ? String(rowEl.dataset.planningZone || "").trim()
            : targetZoneLabel,
          targetZoneKey: String(zoneTarget?.zoneKey || "").trim(),
        });
      }
    } catch (error) {
      console.error("Erreur drop Planning -> Planning :", error);
    } finally {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    }
  });

  window.addEventListener(
    "dragend",
    () => {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    },
    true
  );

  window.addEventListener(
    "drop",
    () => {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    },
    true
  );
}

function hasMsProjectPayloadType(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  if (
    types.includes("application/x-planning-row") ||
    types.includes("text/x-planning-row")
  ) {
    return false;
  }
  return (
    types.includes("application/x-ms-project-row") ||
    types.includes("application/json") ||
    types.includes("text/plain")
  );
}

function setMsProjectGlobalDragCursor(active) {
  const nextState = Boolean(active);
  if (msProjectGlobalDragCursorActive === nextState) return;
  msProjectGlobalDragCursorActive = nextState;
  document.body?.classList.toggle("is-ms-project-drag-cursor", nextState);
  document.documentElement?.classList.toggle("is-ms-project-drag-cursor", nextState);
}

function extractMsProjectPayloadFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return null;

  const readData = (mimeType) => {
    try {
      return dataTransfer.getData(mimeType);
    } catch (error) {
      return "";
    }
  };

  const rawPayload =
    readData("application/x-ms-project-row") || readData("application/json");
  if (!rawPayload) return null;

  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || parsed.type !== "ms-project-row") return null;
    const uniqueNumber = String(parsed.uniqueNumber ?? "").trim();
    if (!uniqueNumber) return null;
    return {
      ...parsed,
      uniqueNumber,
    };
  } catch (error) {
    const plainText = String(readData("text/plain") ?? "").trim();
    if (!plainText || !/^\d{1,20}$/.test(plainText)) {
      return null;
    }

    return {
      type: "ms-project-row",
      rowId: null,
      uniqueNumber: plainText,
      task: "",
      startIso: "",
      endIso: "",
    };
  }
}

function clearMsProjectDropTarget(containerEl = null) {
  if (activeMsDropRowEl && activeMsDropRowEl.isConnected) {
    activeMsDropRowEl.classList.remove("is-ms-drop-target", "is-ms-drop-committing");
  }
  if (activeMsDropCellEl && activeMsDropCellEl.isConnected) {
    activeMsDropCellEl.classList.remove(
      "is-ms-drop-target-cell",
      "is-ms-drop-committing-cell"
    );
  }

  activeMsDropRowEl = null;
  activeMsDropCellEl = null;

  const effectiveContainer =
    containerEl instanceof HTMLElement
      ? containerEl
      : document.getElementById("planningTimeline");
  if (effectiveContainer instanceof HTMLElement) {
    effectiveContainer.classList.remove("is-ms-drop-active");
  }
  setMsProjectGlobalDragCursor(false);
}

function setMsProjectDropTarget(rowEl, containerEl) {
  if (!(containerEl instanceof HTMLElement)) return;
  containerEl.classList.add("is-ms-drop-active");
  setMsProjectGlobalDragCursor(true);

  if (!(rowEl instanceof HTMLElement)) {
    if (activeMsDropRowEl || activeMsDropCellEl) {
      clearMsProjectDropTarget(containerEl);
      containerEl.classList.add("is-ms-drop-active");
    }
    return;
  }

  if (activeMsDropRowEl === rowEl) return;
  clearMsProjectDropTarget(containerEl);
  containerEl.classList.add("is-ms-drop-active");

  rowEl.classList.add("is-ms-drop-target");
  activeMsDropRowEl = rowEl;

  const lineCell = rowEl.querySelector(".cell-ligne-planning");
  if (lineCell instanceof HTMLElement) {
    lineCell.classList.add("is-ms-drop-target-cell");
    activeMsDropCellEl = lineCell;
  }
}

function resolvePlanningRowDropTarget(targetEl, containerEl, eventLike = null) {
  const targetFromPointer = findPlanningDropCandidateAtClientY(
    containerEl,
    getPlanningDropEventClientY(eventLike)
  );
  if (
    targetFromPointer instanceof HTMLElement &&
    targetFromPointer.classList.contains("group-row-grid")
  ) {
    const pointerRowId = Number(targetFromPointer.dataset.planningRowId || "");
    if (Number.isInteger(pointerRowId) && pointerRowId > 0) {
      return targetFromPointer;
    }
  }

  if (targetEl instanceof Element) {
    const rowEl = targetEl.closest(".group-row-grid");
    if (rowEl instanceof HTMLElement && containerEl.contains(rowEl)) {
      const rowId = Number(rowEl.dataset.planningRowId || "");
      if (Number.isInteger(rowId) && rowId > 0) {
        return rowEl;
      }
    }
  }

  if (
    timelineInstance &&
    typeof timelineInstance.getEventProperties === "function" &&
    groupsDataSet &&
    eventLike
  ) {
    const props = timelineInstance.getEventProperties(eventLike);
    const groupId = props?.group;
    if (groupId != null) {
      const group =
        groupsDataSet.get(groupId) ||
        groupsDataSet.get(String(groupId)) ||
        groupsDataSet.get(Number(groupId)) ||
        null;
      const rowId = Number(group?.rowId || "");
      if (Number.isInteger(rowId) && rowId > 0) {
        const fallbackRow = containerEl.querySelector(
          `.group-row-grid[data-planning-row-id="${rowId}"]`
        );
        if (fallbackRow instanceof HTMLElement) {
          return fallbackRow;
        }
      }
    }
  }

  return null;
}

function bindMsProjectRowDrop(containerEl) {
  if (!(containerEl instanceof HTMLElement) || msProjectDropBound) return;
  msProjectDropBound = true;

  window.addEventListener(
    "dragenter",
    (event) => {
      if (!hasMsProjectPayloadType(event.dataTransfer)) return;
      setMsProjectGlobalDragCursor(true);
    },
    true
  );

  window.addEventListener(
    "dragover",
    (event) => {
      if (!hasMsProjectPayloadType(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setMsProjectGlobalDragCursor(true);
    },
    true
  );

  containerEl.addEventListener("dragover", (event) => {
    if (!hasMsProjectPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }

    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);
    setMsProjectDropTarget(rowEl, containerEl);
  });

  containerEl.addEventListener("dragleave", (event) => {
    if (!containerEl.classList.contains("is-ms-drop-active")) return;
    const rect = containerEl.getBoundingClientRect();
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    const outsideContainer =
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom;

    if (outsideContainer) {
      clearMsProjectDropTarget(containerEl);
    }
  });

  containerEl.addEventListener("drop", async (event) => {
    if (!hasMsProjectPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();

    const payload = extractMsProjectPayloadFromDataTransfer(event.dataTransfer);
    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);

    if (!(rowEl instanceof HTMLElement) || !payload) {
      clearMsProjectDropTarget(containerEl);
      return;
    }

    const planningRowId = Number(rowEl.dataset.planningRowId || "");
    if (!Number.isInteger(planningRowId) || planningRowId <= 0) {
      clearMsProjectDropTarget(containerEl);
      return;
    }

    setMsProjectDropTarget(rowEl, containerEl);
    rowEl.classList.add("is-ms-drop-committing");
    const lineCell = rowEl.querySelector(".cell-ligne-planning");
    if (lineCell instanceof HTMLElement) {
      lineCell.classList.add("is-ms-drop-committing-cell");
    }

    try {
      if (typeof msProjectRowDropHandler === "function") {
        await msProjectRowDropHandler({
          planningRowId,
          uniqueNumber: payload.uniqueNumber,
          payload,
          targetTask: String(rowEl.querySelector(".cell-task")?.textContent || "").trim(),
        });
      }
    } catch (error) {
      console.error("Erreur drop MS Project vers Planning :", error);
    } finally {
      clearMsProjectDropTarget(containerEl);
    }
  });

  window.addEventListener(
    "dragend",
    () => {
      clearMsProjectDropTarget(containerEl);
    },
    true
  );

  window.addEventListener(
    "drop",
    () => {
      clearMsProjectDropTarget(containerEl);
    },
    true
  );
}

function createAggregateGroup(id, label, className, sortIndex) {
  return {
    id,
    isAggregateGroup: true,
    aggregateLabel: label,
    className,
    sortIndex,
    sortLignePlanning: sortIndex,
    sortID2: sortIndex,
  };
}

function getAggregateGroupId(type = "") {
  const normalizedType = String(type || "");
  if (normalizedType === "coffrage") return "aggregate-coffrage";
  if (normalizedType === "armatures") return "aggregate-armatures";
  if (normalizedType === "ndc") return "aggregate-ndc";
  if (normalizedType === "coupes") return "aggregate-coupes";
  if (normalizedType === "demolition") return "aggregate-demolition";
  const slug = normalizedType
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `aggregate-${slug || "unknown"}`;
}

function getAggregatePhaseClassName(type = "") {
  const normalizedType = String(type || "");
  if (normalizedType === "coffrage") return "phase-coffrage";
  if (normalizedType === "armatures") return "phase-armature";
  if (normalizedType === "ndc") return "phase-ndc";
  if (normalizedType === "coupes") return "phase-coupes";
  if (normalizedType === "demolition") return "phase-demolition";
  if (normalizedType.startsWith("generic:")) return "phase-generic";
  return "";
}

function isPlanningNdcTypeDoc(typeDoc) {
  return (
    isPlanningTypeDocMatch(typeDoc, "NDC") ||
    isPlanningTypeDocMatch(typeDoc, "NOTE DE CALCUL") ||
    isPlanningTypeDocMatch(typeDoc, "NOTE CALCUL")
  );
}

function isPlanningCoupesTypeDoc(typeDoc) {
  return isPlanningTypeDocMatch(typeDoc, "COUPE");
}

function isPlanningDemolitionTypeDoc(typeDoc) {
  return isPlanningTypeDocMatch(
    String(typeDoc ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""),
    "DEMOLITION"
  );
}

function isPlanningCustomTypeDoc(typeDoc) {
  const normalized = String(typeDoc ?? "").trim();
  if (!normalized) return false;
  return !(
    isPlanningTypeDocMatch(normalized, "COFFRAGE") ||
    isPlanningTypeDocMatch(normalized, "ARMATURE") ||
    isPlanningNdcTypeDoc(normalized) ||
    isPlanningTypeDocMatch(normalized, "COUPE") ||
    isPlanningTypeDocMatch(
      normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      "DEMOLITION"
    )
  );
}

function getPlanningCustomAggregateType(typeDoc) {
  return `generic:${String(typeDoc ?? "").trim().toLocaleUpperCase("fr")}`;
}

function parseAggregateDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value);
  }

  if (typeof value === "number") {
    let numericValue = value;
    if (numericValue > 1e9 && numericValue < 1e11) {
      numericValue *= 1000;
    }

    const date = new Date(numericValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value || "").trim();
  if (!text) return null;

  const frenchDateMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frenchDateMatch) {
    const day = Number(frenchDateMatch[1]);
    const month = Number(frenchDateMatch[2]);
    const year = Number(frenchDateMatch[3]);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    )
      ? date
      : null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function createAggregateRange(startDateRaw, endDateRaw) {
  const start = parseAggregateDate(startDateRaw);
  const end = parseAggregateDate(endDateRaw);
  if (!start || !end || end <= start) {
    return null;
  }

  return { start, end };
}

function clampAggregatePercentage(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, numericValue));
}

function getAggregatePhasePalette(className) {
  const normalizedClassName = String(className || "");

  if (normalizedClassName.includes("phase-coffrage")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#ead7a2",
        border: "#d6bd74",
        text: "#7a4b12",
        overdueBackground: "#d88f8f",
        overdueBorder: "#bb6b6b",
      };
    }

    return {
      background: "#fef3c7",
      border: "#fde68a",
      text: "#92400e",
      overdueBackground: "#d99b9b",
      overdueBorder: "#c97c7c",
    };
  }

  if (normalizedClassName.includes("phase-armature")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#e5e7eb",
        border: "#cbd5e1",
        text: "#334155",
        overdueBackground: "#efc2c2",
        overdueBorder: "#dc9f9f",
      };
    }

    return {
      background: "#f3f4f6",
      border: "#d1d5db",
      text: "#475569",
      overdueBackground: "#fee2e2",
      overdueBorder: "#fecaca",
    };
  }

  if (normalizedClassName.includes("phase-ndc")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#d8d2e6",
        border: "#b8aecf",
        text: "#3f365a",
        overdueBackground: "#e7bdd7",
        overdueBorder: "#d99bc4",
      };
    }

    return {
      background: "#e9e6f2",
      border: "#c9c0de",
      text: "#4d426a",
      overdueBackground: "#fce7f3",
      overdueBorder: "#fbcfe8",
    };
  }

  if (normalizedClassName.includes("phase-coupes")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#b8e8d0",
        border: "#2da862",
        text: "#14452a",
        overdueBackground: "#fef08a",
        overdueBorder: "#facc15",
      };
    }

    return {
      background: "#d4f7e6",
      border: "#43CD80",
      text: "#1a5c38",
      overdueBackground: "#fef9c3",
      overdueBorder: "#fde047",
    };
  }

  if (normalizedClassName.includes("phase-demolition")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#f5cfcf",
        border: "#a80000",
        text: "#5c0000",
        overdueBackground: "#fde68a",
        overdueBorder: "#f59e0b",
      };
    }

    return {
      background: "#fde8e8",
      border: "#CD0000",
      text: "#7a0000",
      overdueBackground: "#fef3c7",
      overdueBorder: "#fcd34d",
    };
  }

  if (normalizedClassName.includes("phase-generic")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#cde4e7",
        border: "#9bc9cf",
        text: "#164e63",
        overdueBackground: "#e1b6be",
        overdueBorder: "#c98794",
      };
    }

    return {
      background: "#e0f2f1",
      border: "#99d5d1",
      text: "#155e75",
      overdueBackground: "#f3cbd2",
      overdueBorder: "#dda6b0",
    };
  }

  return null;
}

function buildAggregateRetardPhaseStyle(className, realiseValue, retardDays) {
  const palette = getAggregatePhasePalette(className);
  if (!palette) return "";

  const normalizedRetardDays = toFiniteNumber(retardDays);
  if (normalizedRetardDays == null || normalizedRetardDays <= 0) {
    return "";
  }

  const normalizedRealise = clampAggregatePercentage(realiseValue);
  if (normalizedRealise >= 100) {
    return "";
  }

  if (normalizedRealise <= 0) {
    return [
      `background: ${palette.overdueBackground} !important`,
      `border-color: ${palette.overdueBorder} !important`,
      `color: ${palette.text} !important`,
    ].join("; ");
  }

  return [
    `background: linear-gradient(to right, ${palette.background} 0%, ${palette.background} ${normalizedRealise}%, ${palette.overdueBackground} ${normalizedRealise}%, ${palette.overdueBackground} 100%) !important`,
    `border-color: ${palette.border} !important`,
    `color: ${palette.text} !important`,
  ].join("; ");
}

function buildAggregatePhaseClassName(className, realiseValue) {
  return clampAggregatePercentage(realiseValue) >= 100
    ? `${className} phase-realise-complete`
    : className;
}

function createAggregatePhaseItem({
  itemId,
  groupId,
  start,
  end,
  label,
  className,
  taskLabel,
  aggregateTasks = [],
  style = "",
}) {
  return {
    id: itemId,
    group: groupId,
    start,
    end,
    content: label,
    phaseLabel: label,
    className: [className, "planning-aggregate-phase"].filter(Boolean).join(" "),
    taskLabel,
    aggregateTasks,
    title: taskLabel || label,
    type: "range",
    style,
  };
}

function createSplitAggregatePhaseItems({
  itemIdBase,
  groupId,
  start,
  end,
  label,
  className,
  taskLabel,
  aggregateTasks = [],
  style = "",
  pastStyle = "",
}) {
  const currentInstant = new Date();
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) {
    return [];
  }

  if (end <= currentInstant) {
    return [
      createAggregatePhaseItem({
        itemId: itemIdBase,
        groupId,
        start,
        end,
        label,
        className: `${className} phase-past`,
        taskLabel,
        aggregateTasks,
        style: pastStyle,
      }),
    ];
  }

  if (start >= currentInstant) {
    return [
      createAggregatePhaseItem({
        itemId: itemIdBase,
        groupId,
        start,
        end,
        label,
        className,
        taskLabel,
        aggregateTasks,
        style,
      }),
    ];
  }

  return [
    createAggregatePhaseItem({
      itemId: `${itemIdBase}-past`,
      groupId,
      start,
      end: currentInstant,
      label: "",
      className: `${className} phase-past`,
      taskLabel,
      aggregateTasks,
      style: pastStyle,
    }),
    createAggregatePhaseItem({
      itemId: `${itemIdBase}-current`,
      groupId,
      start: currentInstant,
      end,
      label,
      className,
      taskLabel,
      aggregateTasks,
      style,
    }),
  ];
}

function mergeOverlappingAggregateSegments(segments = []) {
  const sortedSegments = (segments || [])
    .filter((segment) => segment?.start && segment?.end && segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const mergedSegments = [];
  sortedSegments.forEach((segment) => {
    const previous = mergedSegments[mergedSegments.length - 1];
    if (previous && segment.start <= previous.end) {
      if (segment.end > previous.end) {
        previous.end = new Date(segment.end);
      }
      previous.tasks.push(...segment.tasks);
      previous.realiseValues.push(...segment.realiseValues);
      previous.retardValues.push(...segment.retardValues);
      return;
    }

    mergedSegments.push({
      type: segment.type,
      groupId: segment.groupId,
      label: segment.label,
      start: new Date(segment.start),
      end: new Date(segment.end),
      tasks: [...segment.tasks],
      realiseValues: [...segment.realiseValues],
      retardValues: [...segment.retardValues],
    });
  });

  return mergedSegments.map((segment) => ({
    ...segment,
    tasks: segment.tasks.sort((left, right) => left.start - right.start || left.end - right.end),
  }));
}

function buildAggregateItemsFromGroups(groups = []) {
  const segmentsByType = new Map([
    ["coffrage", []],
    ["armatures", []],
    ["ndc", []],
    ["coupes", []],
    ["demolition", []],
  ]);

  (groups || []).forEach((group) => {
    if (!group || group.isZoneHeader || !group.meta) return;

    const row = group.meta;
    const typeDoc = String(row.typeDoc || group.typeDocLabel || "");
    const isCoffrage = isPlanningTypeDocMatch(typeDoc, "COFFRAGE");
    const isArmature = isPlanningTypeDocMatch(typeDoc, "ARMATURE");
    const isNdc = isPlanningNdcTypeDoc(typeDoc);
    const isCoupes = isPlanningCoupesTypeDoc(typeDoc);
    const isDemolition = isPlanningDemolitionTypeDoc(typeDoc);
    const isCustom = isPlanningCustomTypeDoc(typeDoc);
    if (!isCoffrage && !isArmature && !isNdc && !isCoupes && !isDemolition && !isCustom) return;

    const aggregateType = isCoffrage
      ? "coffrage"
      : isArmature
        ? "armatures"
        : isNdc
          ? "ndc"
          : isCoupes
            ? "coupes"
            : isDemolition
              ? "demolition"
              : getPlanningCustomAggregateType(typeDoc);
    const range = isArmature
      ? createAggregateRange(row.diffCoffrage, row.diffArmature)
      : createAggregateRange(row.dateLimite, row.diffCoffrage);
    if (!range) return;

    const realiseValue =
      toFiniteNumber(row.realise) ?? toFiniteNumber(group.realiseLabel) ?? 0;
    const taskLabel = String(row.taches || group.tachesLabel || "").trim();

    if (!segmentsByType.has(aggregateType)) {
      segmentsByType.set(aggregateType, []);
    }
    segmentsByType.get(aggregateType).push({
      type: aggregateType,
      groupId: getAggregateGroupId(aggregateType),
      label: isCoffrage
        ? "Coffrage"
        : isArmature
          ? "Armature"
          : isNdc
            ? "NDC"
            : isCoupes
              ? "COUPES"
              : isDemolition
                ? "DÉMOLITION"
                : String(typeDoc).trim(),
      start: range.start,
      end: range.end,
      tasks: [
        {
          label: taskLabel,
          start: range.start,
          end: range.end,
        },
      ],
      realiseValues: [realiseValue],
      retardValues: [toFiniteNumber(row.retards) || 0],
    });
  });

  const items = [];
  segmentsByType.forEach((segments, aggregateType) => {
    const mergedSegments = mergeOverlappingAggregateSegments(segments);
    mergedSegments.forEach((segment, index) => {
      const maxRealiseValue = Math.max(0, ...segment.realiseValues);
      const maxRetardValue = Math.max(0, ...segment.retardValues);
      const baseClassName = buildAggregatePhaseClassName(
        getAggregatePhaseClassName(aggregateType),
        maxRealiseValue
      );

      items.push(
        ...createSplitAggregatePhaseItems({
          itemIdBase: `aggregate-${aggregateType}-merged-${index}`,
          groupId: segment.groupId,
          start: segment.start,
          end: segment.end,
          label: segment.label,
          className: baseClassName,
          taskLabel: `${segment.tasks.length} tache(s)`,
          aggregateTasks: segment.tasks,
          style: buildAggregateRetardPhaseStyle(baseClassName, maxRealiseValue, maxRetardValue),
          pastStyle: buildAggregateRetardPhaseStyle(
            `${baseClassName} phase-past`,
            maxRealiseValue,
            maxRetardValue
          ),
        })
      );
    });
  });

  return items;
}

function buildVisualAggregateTimelineData(timelineData = {}) {
  const groups = [
    createAggregateGroup(
      "aggregate-coffrage",
      "Coffrages",
      "planning-aggregate-group planning-aggregate-group--coffrage",
      0
    ),
    createAggregateGroup(
      "aggregate-armatures",
      "Armatures",
      "planning-aggregate-group planning-aggregate-group--armatures",
      1
    ),
    createAggregateGroup(
      "aggregate-ndc",
      "NDC",
      "planning-aggregate-group planning-aggregate-group--ndc",
      2
    ),
    createAggregateGroup(
      "aggregate-coupes",
      "COUPES",
      "planning-aggregate-group planning-aggregate-group--coupes",
      3
    ),
    createAggregateGroup(
      "aggregate-demolition",
      "DÉMOLITION",
      "planning-aggregate-group planning-aggregate-group--demolition",
      4
    ),
  ];

  const customTypes = new Map();
  (timelineData.groups || []).forEach((group) => {
    const typeDoc = String(group?.meta?.typeDoc || group?.typeDocLabel || "").trim();
    if (!isPlanningCustomTypeDoc(typeDoc)) return;
    const aggregateType = getPlanningCustomAggregateType(typeDoc);
    if (!customTypes.has(aggregateType)) customTypes.set(aggregateType, typeDoc);
  });
  [...customTypes.entries()]
    .sort((left, right) =>
      left[1].localeCompare(right[1], "fr", { sensitivity: "base", numeric: true })
    )
    .forEach(([aggregateType, label], index) => {
      groups.push(
        createAggregateGroup(
          getAggregateGroupId(aggregateType),
          label,
          "planning-aggregate-group planning-aggregate-group--generic",
          5 + index
        )
      );
    });

  const items = buildAggregateItemsFromGroups(timelineData.groups || []);

  return { groups, items };
}

function getDisplayedTimelineData(timelineData = {}) {
  if (!visualAggregateModeEnabled) {
    return {
      groups: timelineData.groups || [],
      items: timelineData.items || [],
    };
  }

  return buildVisualAggregateTimelineData(timelineData);
}

function getCssPixelValue(propertyName, fallbackValue = 0) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallbackValue;
  }

  const rawValue = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(propertyName);
  const numericValue = Number.parseFloat(rawValue);
  return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function getVisibleElementHeight(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    return 0;
  }

  const styles = window.getComputedStyle(element);
  if (styles.display === "none" || styles.visibility === "hidden") {
    return 0;
  }

  return element.getBoundingClientRect().height || 0;
}

export function getPlanningPreferredEmbeddedHeight() {
  const displayedData = getDisplayedTimelineData(lastPlanningTimelineData);

  if (visualAggregateModeEnabled) {
    const rowHeight = getCssPixelValue("--planning-row-height", 40);
    const toolbarHeight = getVisibleElementHeight("#toolbar");
    const headerHeight = getVisibleElementHeight(".planning-header-row") || rowHeight;
    const rowCount = Math.max(2, (displayedData.groups || []).length);
    return Math.ceil(toolbarHeight + headerHeight + rowHeight * rowCount + 4);
  }

  const timelineWrapperHeight = getVisibleElementHeight("#timelineWrapper");
  return Math.ceil(
    Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      timelineWrapperHeight
    )
  );
}

function buildGroupLabelElement(group) {
  if (group?.isAggregateGroup) {
    const row = document.createElement("div");
    row.className = [
      "group-row-grid",
      "planning-aggregate-row",
      String(group?.className || ""),
    ]
      .filter(Boolean)
      .join(" ");

    const labelCell = document.createElement("div");
    labelCell.className = "planning-aggregate-row-label";
    labelCell.textContent = String(group?.aggregateLabel || "");

    row.append(labelCell);
    return row;
  }

  if (group?.isZoneHeader) {
    const zoneBand = document.createElement("div");
    zoneBand.className = "zone-header-band";
    zoneBand.dataset.planningZoneKey = String(group?.meta?.zoneKey || group?.zoneKey || "");
    zoneBand.dataset.planningZoneLabel = String(group?.zoneLabel || "");
    zoneBand.textContent = String(group?.zoneHeaderLabel ?? "");
    return zoneBand;
  }

  const row = document.createElement("div");
  row.className = "group-row-grid";
  // Le drag-and-drop de lignes est désactivé en mode embedded (synchronisation-plannings).
  if (!EMBEDDED_PLANNING_SYNC_MODE) {
    row.classList.add("planning-draggable-row");
    row.draggable = true;
    row.setAttribute("draggable", "true");
  }
  row.dataset.planningRowId = String(group?.rowId ?? "");
  row.dataset.planningGroupId = String(group?.id ?? "");
  row.dataset.planningProject = String(group?.projectLabel ?? "");
  row.dataset.planningId2 = String(group?.id2Label ?? "");
  row.dataset.planningTask = String(group?.tachesLabel ?? "");
  row.dataset.planningGroupe = String(group?.groupeLabel ?? "");
  row.dataset.planningZone = String(group?.zoneLabel ?? "");
  row.dataset.planningLignePlanning = String(group?.lignePlanningLabel ?? "");
  row.dataset.planningTypeDoc = String(group?.typeDocLabel ?? "");
  row.dataset.planningStartIso = String(group?.debutIso ?? "");
  row.dataset.planningEndIso = String(group?.finIso ?? "");
  row.dataset.planningDemarrageIso = String(group?.demarrageIso ?? "");
  row.dataset.planningIndice = String(group?.indiceLabel ?? "");
  row.dataset.planningRealise = String(group?.realiseLabel ?? "");
  row.dataset.planningRetards = String(group?.retardsLabel ?? "");
  row.dataset.planningRemarque = String(group?.remarqueLabel ?? "");
  const typeDocLabel = String(group?.typeDocLabel ?? "");
  const isCoffrageRow = isPlanningTypeDocMatch(typeDocLabel, "COFFRAGE");
  const isArmatureRow = isPlanningTypeDocMatch(typeDocLabel, "ARMATURE");
  const isNdcRow = isPlanningNdcTypeDoc(typeDocLabel);
  const isCoupesRow = isPlanningCoupesTypeDoc(typeDocLabel);
  const isDemolitionRow = isPlanningDemolitionTypeDoc(typeDocLabel);
  const isGenericRow = isPlanningCustomTypeDoc(typeDocLabel);
  const isRealiseComplete = isPlanningRealiseComplete(group?.realiseLabel);

  if (isCoffrageRow) {
    row.classList.add("row-type-coffrage");
  }
  if (isArmatureRow) {
    row.classList.add("row-type-armature");
  }
  if (isNdcRow) {
    row.classList.add("row-type-ndc");
  }
  if (isCoupesRow) {
    row.classList.add("row-type-coupes");
  }
  if (isDemolitionRow) {
    row.classList.add("row-type-demolition");
  }
  if (isGenericRow) {
    row.classList.add("row-type-generic");
  }
  if (isRealiseComplete) {
    row.classList.add("row-realise-complete");
  }

  const id2 = document.createElement("div");
  id2.className = "cell-id2";
  id2.textContent = String(group?.id2Label ?? "");

  const tache = document.createElement("div");
  tache.className = "cell-task";
  tache.textContent = String(group?.tachesLabel ?? "");

  const lignePlanning = document.createElement("div");
  lignePlanning.className = "cell-ligne-planning";
  lignePlanning.textContent = String(group?.lignePlanningLabel ?? "");
  lignePlanning.dataset.planningRowId = String(group?.rowId ?? "");

  const debut = document.createElement("div");
  debut.className = "cell-start";
  debut.textContent = String(group?.debutLabel ?? "");

  const dureeDebutFin = document.createElement("div");
  dureeDebutFin.className = "cell-duration-1";
  dureeDebutFin.textContent = String(group?.dureeDebutFinLabel ?? "");
  dureeDebutFin.dataset.rowId = String(group?.rowId ?? "");
  dureeDebutFin.dataset.durationSlot = "1";
  dureeDebutFin.dataset.typeDoc = String(group?.typeDocLabel ?? "");
  dureeDebutFin.dataset.durationValue = String(group?.dureeDebutFinLabel ?? "");
  dureeDebutFin.dataset.durationColumnKey = String(
    group?.dureeDebutFinColumnKey ?? ""
  );
  dureeDebutFin.dataset.leftDateColumnKey = String(
    group?.dureeDebutFinLeftDateColumnKey ?? ""
  );
  dureeDebutFin.dataset.rightIsoDate = String(group?.dureeDebutFinRightIso ?? "");
  if (group?.dureeDebutFinEditable) {
    dureeDebutFin.classList.add("editable-duration-cell");
    dureeDebutFin.setAttribute("draggable", "false");
    dureeDebutFin.title = "Cliquer pour modifier la durée";
  }

  const fin = document.createElement("div");
  fin.className = "cell-end";
  fin.textContent = String(group?.finLabel ?? "");

  const dureeFinDemarrage = document.createElement("div");
  dureeFinDemarrage.className = "cell-duration-2";
  dureeFinDemarrage.textContent = String(group?.dureeFinDemarrageLabel ?? "");
  dureeFinDemarrage.dataset.rowId = String(group?.rowId ?? "");
  dureeFinDemarrage.dataset.durationSlot = "2";
  dureeFinDemarrage.dataset.typeDoc = String(group?.typeDocLabel ?? "");
  dureeFinDemarrage.dataset.durationValue = String(
    group?.dureeFinDemarrageLabel ?? ""
  );
  dureeFinDemarrage.dataset.durationColumnKey = String(
    group?.dureeFinDemarrageColumnKey ?? ""
  );
  dureeFinDemarrage.dataset.leftDateColumnKey = String(
    group?.dureeFinDemarrageLeftDateColumnKey ?? ""
  );
  dureeFinDemarrage.dataset.rightIsoDate = String(
    group?.dureeFinDemarrageRightIso ?? ""
  );
  if (group?.dureeFinDemarrageEditable) {
    dureeFinDemarrage.classList.add("editable-duration-cell");
    dureeFinDemarrage.setAttribute("draggable", "false");
    dureeFinDemarrage.title = "Cliquer pour modifier la durée";
  }

  const demarrage = document.createElement("div");
  demarrage.className = "cell-demarrage";
  demarrage.textContent = String(group?.demarrageLabel ?? "");

  const indice = document.createElement("div");
  indice.className = "cell-indice";
  indice.textContent = String(group?.indiceLabel ?? "");

  const realise = document.createElement("div");
  realise.className = "cell-realise";
  realise.textContent = String(group?.realiseLabel ?? "");

  const retards = document.createElement("div");
  retards.className = "cell-retards";
  const positiveRetardLabel = formatPositiveRetardValue(group?.retardsLabel);
  retards.textContent = positiveRetardLabel;
  retards.classList.toggle("has-retard", Boolean(positiveRetardLabel));
  retards.dataset.rowId = String(group?.rowId ?? "");
  retards.dataset.id2 = String(group?.id2Label ?? "");
  retards.dataset.task = String(group?.tachesLabel ?? "");
  retards.dataset.retards = String(group?.retardsLabel ?? "");
  retards.dataset.remarque = String(group?.remarqueLabel ?? "");
  retards.setAttribute("aria-haspopup", "dialog");
  const remarqueText = String(group?.remarqueLabel ?? "").trim();
  if (remarqueText) {
    retards.classList.add("has-retard-justification");
    retards.title = remarqueText;
    retards.setAttribute("aria-label", remarqueText);
  }

  [
    id2,
    tache,
    lignePlanning,
    debut,
    dureeDebutFin,
    fin,
    dureeFinDemarrage,
    demarrage,
    indice,
    realise,
    retards,
  ].forEach((cellEl) => {
    cellEl.setAttribute("draggable", "true");
  });

  row.addEventListener("dragstart", (event) => {
    handlePlanningNativeDragStart(event, row);
  });

  row.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
  });

  row.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
  });

  row.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    event.stopPropagation();
    emitPlanningSelectionChange(buildPlanningSelectionPayloadFromGroup(group), {
      reason: "group-click",
    });
  });

  if (!EMBEDDED_PLANNING_SYNC_MODE) {
    row.addEventListener("contextmenu", (event) => {
      openRetardContextMenu(event, row);
    });
  }

  row.append(
    id2,
    tache,
    lignePlanning,
    debut,
    dureeDebutFin,
    fin,
    dureeFinDemarrage,
    demarrage,
    indice,
    realise,
    retards
  );
  return row;
}

function getTimelineContainer() {
  const el = document.getElementById("planningTimeline");
  if (!el) throw new Error("Conteneur #planningTimeline introuvable.");
  return el;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeRange(items) {
  if (!items || !items.length) return null;

  let min = null;
  let max = null;

  for (const item of items) {
    if (item?.type === "background") continue;

    const s = toDate(item.start);
    if (!s) continue;
    const e = toDate(item.end) || s;

    if (!min || s < min) min = s;
    if (!max || e > max) max = e;
  }

  if (!min || !max) return null;

  // marge visuelle autour des données
  const start = new Date(min);
  start.setDate(start.getDate() - 7);

  const end = new Date(max);
  end.setDate(end.getDate() + 7);

  return { start, end };
}

function computePlanningDataRange(displayedItems = [], sourceTimelineData = {}) {
  const sourceItems = Array.isArray(sourceTimelineData?.items) ? sourceTimelineData.items : [];
  return computeRange(sourceItems) || computeRange(displayedItems);
}

function hasPlanningDataItems(displayedItems = [], sourceTimelineData = {}) {
  const sourceItems = Array.isArray(sourceTimelineData?.items) ? sourceTimelineData.items : [];
  return [...sourceItems, ...displayedItems].some((item) => item?.type !== "background");
}

function computeRangeCenter(range) {
  if (!range?.start || !range?.end) return null;
  const centerMs = (range.start.valueOf() + range.end.valueOf()) / 2;
  return new Date(centerMs);
}

function buildDateRangeDisplayText(startDate, endDate, availableWidth = Infinity) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return "";
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return "";

  const full = [
    startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    endDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  ].join(" - ");

  const medium = [
    startDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  ].join(" - ");

  const compact = [
    startDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }),
  ].join(" - ");

  const minimal = [
    startDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }),
  ].join(" - ");

  if (availableWidth >= 340) return full;
  if (availableWidth >= 255) return medium;
  if (availableWidth >= 185) return compact;
  return minimal;
}

function updateDateRangeDisplay() {
  if (!timelineInstance) return;

  const el = document.getElementById("current-date-range");
  if (!el) return;

  const range = timelineInstance.getWindow();
  const availableWidth = Math.max(
    0,
    Math.round(el.getBoundingClientRect().width || el.clientWidth || 0)
  );
  const fullText = buildDateRangeDisplayText(range.start, range.end, Number.MAX_SAFE_INTEGER);
  const displayText = buildDateRangeDisplayText(range.start, range.end, availableWidth);

  el.textContent = displayText || fullText;
  el.title = fullText;
}

function getCurrentZoomMode() {
  const activeBtn = document.querySelector(".zoom-buttons button.active");
  return activeBtn?.dataset.zoom || "week";
}

function normalizePlanningZoomMode(mode) {
  const normalizedMode = String(mode || "").trim();
  if (normalizedMode === "week" || normalizedMode === "month" || normalizedMode === "year") {
    return normalizedMode;
  }
  return getCurrentZoomMode();
}

function resolvePlanningAnchorDate(anchorDate = null) {
  if (anchorDate instanceof Date) {
    return Number.isNaN(anchorDate.getTime()) ? null : new Date(anchorDate);
  }

  const normalizedAnchorDate = String(anchorDate || "").trim();
  if (!normalizedAnchorDate) {
    return null;
  }

  const date = new Date(`${normalizedAnchorDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWindowCenterDate() {
  if (!timelineInstance) return new Date();
  const w = timelineInstance.getWindow();
  const centerMs = (w.start.valueOf() + w.end.valueOf()) / 2;
  return new Date(centerMs);
}

function getVisibleDaysFromRange(range) {
  if (!range?.start || !range?.end) {
    return 0;
  }

  const startMs = range.start.valueOf();
  const endMs = range.end.valueOf();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }

  return Math.max(1, Math.ceil((endMs - startMs) / 86400000));
}

function parsePlanningExactNumber(value) {
  if (value == null || value === "") {
    return Number.NaN;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

function normalizePlanningViewportSignatureTimestamp(timestampMs) {
  const numericTimestamp = parsePlanningExactNumber(timestampMs);
  if (!Number.isFinite(numericTimestamp)) {
    return "";
  }

  return String(Math.round(numericTimestamp / 10) * 10);
}

function buildPlanningViewportLogicalSignature({
  mode = "",
  firstVisibleDate = "",
  rangeStartDate = "",
  visibleDays = Number.NaN,
  windowStartMs = Number.NaN,
  windowEndMs = Number.NaN,
} = {}) {
  const normalizedMode = String(mode || "").trim();
  const normalizedFirstVisibleDate = String(firstVisibleDate || rangeStartDate || "").trim();
  const normalizedVisibleDays = Number(visibleDays);
  const normalizedWindowStartMs =
    normalizePlanningViewportSignatureTimestamp(windowStartMs);
  const normalizedWindowEndMs =
    normalizePlanningViewportSignatureTimestamp(windowEndMs);

  return [
    normalizedMode,
    normalizedFirstVisibleDate,
    Number.isFinite(normalizedVisibleDays) ? Math.round(normalizedVisibleDays) : "",
    normalizedWindowStartMs,
    normalizedWindowEndMs,
  ].join("|");
}

function getPlanningViewportLogicalSignature(viewport = null) {
  if (!viewport) {
    return "";
  }

  return buildPlanningViewportLogicalSignature({
    mode: viewport.mode,
    firstVisibleDate: viewport.firstVisibleDate,
    rangeStartDate: viewport.rangeStartDate,
    visibleDays: viewport.visibleDays,
    windowStartMs: viewport.windowStartMs,
    windowEndMs: viewport.windowEndMs,
  });
}

function clearPendingProgrammaticPlanningViewport(expectedSignature = "") {
  if (
    expectedSignature &&
    pendingProgrammaticPlanningViewportSignature !== expectedSignature
  ) {
    return;
  }

  if (pendingProgrammaticPlanningViewportTimer) {
    window.clearTimeout(pendingProgrammaticPlanningViewportTimer);
    pendingProgrammaticPlanningViewportTimer = 0;
  }

  pendingProgrammaticPlanningViewportSignature = "";
  pendingProgrammaticPlanningViewportExpiresAt = 0;
}

function rememberProgrammaticPlanningViewport(logicalSignature = "") {
  clearPendingProgrammaticPlanningViewport();

  if (!logicalSignature) {
    return "";
  }

  pendingProgrammaticPlanningViewportSignature = logicalSignature;
  pendingProgrammaticPlanningViewportExpiresAt =
    Date.now() + PROGRAMMATIC_PLANNING_VIEWPORT_SUPPRESSION_MS;
  pendingProgrammaticPlanningViewportTimer = window.setTimeout(() => {
    clearPendingProgrammaticPlanningViewport(logicalSignature);
  }, PROGRAMMATIC_PLANNING_VIEWPORT_SUPPRESSION_MS);

  return logicalSignature;
}

function rememberProgrammaticPlanningViewportFromRange(mode = "", range = null) {
  if (!range?.start || !range?.end) {
    return "";
  }

  return rememberProgrammaticPlanningViewport(
    buildPlanningViewportLogicalSignature({
      mode,
      firstVisibleDate: toIsoDateValue(range.start),
      visibleDays: getVisibleDaysFromRange(range),
      windowStartMs: range.start.valueOf(),
      windowEndMs: range.end.valueOf(),
    })
  );
}

function shouldSuppressProgrammaticPlanningViewport(logicalSignature = "") {
  if (!logicalSignature || !pendingProgrammaticPlanningViewportSignature) {
    return false;
  }

  if (Date.now() > pendingProgrammaticPlanningViewportExpiresAt) {
    clearPendingProgrammaticPlanningViewport();
    return false;
  }

  return logicalSignature === pendingProgrammaticPlanningViewportSignature;
}

function emitPlanningViewportChange(reason = "") {
  const viewport = getPlanningViewportState();
  if (!viewport) {
    return;
  }

  const logicalSignature = getPlanningViewportLogicalSignature(viewport);
  if (shouldSuppressProgrammaticPlanningViewport(logicalSignature)) {
    tracePlanningSync("emit-suppressed-programmatic", {
      reason,
      logicalSignature,
      viewport: summarizePlanningViewportForTrace(viewport),
    });
    lastPlanningViewportEmissionSignature = logicalSignature;
    clearPendingProgrammaticPlanningViewport(logicalSignature);
    return;
  }

  if (logicalSignature && logicalSignature === lastPlanningViewportEmissionSignature) {
    tracePlanningSync("emit-skipped-duplicate", {
      reason,
      logicalSignature,
      viewport: summarizePlanningViewportForTrace(viewport),
    });
    return;
  }

  lastPlanningViewportEmissionSignature = logicalSignature;
  tracePlanningSync("emit", {
    reason,
    logicalSignature,
    viewport: summarizePlanningViewportForTrace(viewport),
  });

  planningViewportListeners.forEach((listener) => {
    listener(viewport, { reason });
  });
}

function getSelectionDayStart(rawDate) {
  const nextDate = rawDate instanceof Date ? new Date(rawDate) : new Date(rawDate);
  if (Number.isNaN(nextDate.getTime())) {
    return null;
  }

  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function buildPlanningSelectionLabel(group = {}) {
  const id2Label = String(group?.id2Label || "").trim();
  const taskLabel = String(group?.tachesLabel || "").trim();
  return [id2Label, taskLabel].filter(Boolean).join(" - ") || taskLabel || id2Label || "Page";
}

function buildPlanningSelectionWarning(group = {}) {
  const realizeValue = toFiniteNumber(group?.realiseLabel);
  const retardDays = toFiniteNumber(group?.retardsLabel) || 0;
  const segmentEndIso = String(group?.finIso || "").trim();
  const segmentEndDate = segmentEndIso ? new Date(`${segmentEndIso}T12:00:00`) : null;
  const normalizedEndDate =
    segmentEndDate instanceof Date && !Number.isNaN(segmentEndDate.getTime()) ? segmentEndDate : null;
  const selectedLabel = buildPlanningSelectionLabel(group);
  const formattedEndDate = normalizedEndDate
    ? normalizedEndDate.toLocaleDateString("fr-FR")
    : "";

  if (realizeValue != null && realizeValue >= 100) {
    return null;
  }

  if (retardDays > 0) {
    return {
      kind: "retard-active",
      severity: "danger",
      days: retardDays,
      message: `${selectedLabel} a ${retardDays} jour(s) de retard. Fin prevue le ${formattedEndDate}.`,
    };
  }

  if (!(realizeValue != null && realizeValue < 100) || !normalizedEndDate) {
    return null;
  }

  const today = getSelectionDayStart(new Date());
  const endDay = getSelectionDayStart(normalizedEndDate);
  if (!(today && endDay)) {
    return null;
  }

  const diffDays = Math.round((endDay.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0 || diffDays >= 7) {
    return null;
  }

  let timingLabel = `${diffDays} jour(s)`;
  if (diffDays === 0) timingLabel = "aujourd'hui";
  if (diffDays === 1) timingLabel = "demain";

  return {
    kind: "due-soon",
    severity: "warning",
    days: diffDays,
    message:
      diffDays === 0
        ? `${selectedLabel} se termine aujourd'hui et n'est pas realise a 100 %.`
        : `${selectedLabel} se termine dans ${timingLabel} et n'est pas realise a 100 %.`,
    endDateLabel: formattedEndDate,
  };
}

function buildPlanningSelectionPayloadFromGroup(group = {}) {
  if (!group || group.isZoneHeader || !group.meta) {
    return null;
  }

  const warning = buildPlanningSelectionWarning(group);
  return {
    rowId: String(group?.rowId || "").trim(),
    groupId: String(group?.id || "").trim(),
    label: buildPlanningSelectionLabel(group),
    typeDoc: String(group?.typeDocLabel || "").trim(),
    realise: toFiniteNumber(group?.realiseLabel),
    retards: toFiniteNumber(group?.retardsLabel) || 0,
    segmentEndDate: String(group?.finIso || "").trim(),
    warning,
  };
}

function emitPlanningSelectionChange(selection = null, meta = {}) {
  const payload = selection && typeof selection === "object" ? selection : null;
  const nextSignature = JSON.stringify(payload || null);
  if (nextSignature === lastPlanningSelectionEmissionSignature) {
    return;
  }

  lastPlanningSelectionEmissionSignature = nextSignature;
  planningSelectionListeners.forEach((listener) => {
    listener(payload, meta);
  });
}

export function getPlanningViewportState() {
  if (!timelineInstance) {
    return null;
  }

  const range = timelineInstance.getWindow();
  const anchorDate = getWindowCenterDate();
  const firstVisibleDate = toIsoDateValue(range.start);
  const visibleDays = getVisibleDaysFromRange(range);

  return {
    mode: getCurrentZoomMode(),
    anchorDate: toIsoDateValue(anchorDate),
    firstVisibleDate,
    visibleDays,
    windowStartMs:
      range.start instanceof Date && !Number.isNaN(range.start.getTime())
        ? range.start.getTime()
        : null,
    windowEndMs:
      range.end instanceof Date && !Number.isNaN(range.end.getTime()) ? range.end.getTime() : null,
    rangeStartDate: firstVisibleDate,
    rangeEndDate: shiftIsoDateValue(firstVisibleDate, visibleDays - 1),
  };
}

export function refreshPlanningTimelineLayout() {
  if (!timelineInstance) {
    return null;
  }

  timelineInstance.redraw();
  updateDateRangeDisplay();
  updateNavCenterButtonLabel();
  requestStickyAxisSync();
  return getPlanningViewportState();
}

export function applyPlanningViewportState(viewport = {}) {
  if (!timelineInstance) {
    return Promise.resolve(null);
  }

  tracePlanningSync("apply-viewport-request", {
    viewport: summarizePlanningViewportForTrace(viewport),
  });
  const nextMode = String(viewport.mode || "").trim() || getCurrentZoomMode();
  const nextStartDate = String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim();
  const nextVisibleDays = EMBEDDED_PLANNING_SYNC_MODE
    ? clampPlanningVisibleDaysToBounds(
        Number(viewport.visibleDays),
        normalizePlanningViewportBounds(viewport.viewportBounds || embeddedPlanningViewportBounds)
      )
    : Number(viewport.visibleDays);
  const nextEndDate =
    nextStartDate && Number.isFinite(nextVisibleDays) && nextVisibleDays > 0
      ? shiftIsoDateValue(nextStartDate, Math.round(nextVisibleDays) - 1)
      : String(viewport.rangeEndDate || "").trim();
  const nextAnchorDate = String(viewport.anchorDate || "").trim();

  if (nextMode) {
    setActiveZoomButton(nextMode);
  }

  const nextWindowStartMs = parsePlanningExactNumber(viewport.windowStartMs);
  const nextWindowEndMs = parsePlanningExactNumber(viewport.windowEndMs);
  if (Number.isFinite(nextWindowStartMs) && Number.isFinite(nextWindowEndMs)) {
    const exactRange = {
      start: new Date(nextWindowStartMs),
      end: new Date(nextWindowEndMs),
    };
    if (
      !Number.isNaN(exactRange.start.getTime()) &&
      !Number.isNaN(exactRange.end.getTime()) &&
      exactRange.end >= exactRange.start
    ) {
      const clampedRange = EMBEDDED_PLANNING_SYNC_MODE
        ? buildClampedPlanningRange(
            exactRange,
            normalizePlanningViewportBounds(viewport.viewportBounds || embeddedPlanningViewportBounds)
          ) || exactRange
        : exactRange;

      tracePlanningSync("apply-viewport-exact-range", {
        nextMode,
        viewport: summarizePlanningViewportForTrace(viewport),
        appliedRange: {
          start: roundPlanningTraceNumber(clampedRange.start?.getTime?.(), 0),
          end: roundPlanningTraceNumber(clampedRange.end?.getTime?.(), 0),
        },
      });
      const settleToken = beginPlanningViewportSettle();
      rememberProgrammaticPlanningViewportFromRange(nextMode, clampedRange);
      timelineInstance.setWindow(clampedRange.start, clampedRange.end, { animation: false });
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      requestStickyAxisSync();
      queuePlanningViewportSettled(settleToken);
      return waitForPlanningViewportSettled();
    }
  }

  if (nextStartDate && nextEndDate) {
    const start = new Date(`${nextStartDate}T00:00:00`);
    const end = new Date(`${nextEndDate}T23:59:59.999`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      tracePlanningSync("apply-viewport-date-range", {
        nextMode,
        viewport: summarizePlanningViewportForTrace(viewport),
        appliedRange: {
          start: roundPlanningTraceNumber(start.getTime(), 0),
          end: roundPlanningTraceNumber(end.getTime(), 0),
        },
      });
      const settleToken = beginPlanningViewportSettle();
      rememberProgrammaticPlanningViewportFromRange(nextMode, { start, end });
      timelineInstance.setWindow(start, end, { animation: false });
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      requestStickyAxisSync();
      queuePlanningViewportSettled(settleToken);
      return waitForPlanningViewportSettled();
    }
  }

  const anchorDate = nextAnchorDate
    ? new Date(`${nextAnchorDate}T12:00:00`)
    : getWindowCenterDate();

  if (!Number.isNaN(anchorDate.getTime())) {
    tracePlanningSync("apply-viewport-anchor", {
      nextMode,
      anchorDate: toIsoDateValue(anchorDate),
      viewport: summarizePlanningViewportForTrace(viewport),
    });
    const settleToken = beginPlanningViewportSettle();
    setWindowForMode(nextMode, anchorDate);
    rememberProgrammaticPlanningViewport(getPlanningViewportLogicalSignature(getPlanningViewportState()));
    updateNavCenterButtonLabel();
    requestStickyAxisSync();
    queuePlanningViewportSettled(settleToken);
    return waitForPlanningViewportSettled();
  }

  return Promise.resolve(getPlanningViewportState());
}

export function setPlanningViewportBounds(bounds = {}) {
  embeddedPlanningViewportBounds = normalizePlanningViewportBounds(bounds);

  if (timelineInstance) {
    const zoomMinMs = embeddedPlanningViewportBounds.minVisibleDays * 86400000;
    const zoomMaxMs = embeddedPlanningViewportBounds.maxVisibleDays * 86400000;
    timelineInstance.setOptions({
      zoomMin: zoomMinMs,
      zoomMax: zoomMaxMs,
    });
    enforceEmbeddedPlanningViewportBounds();
  }
}

export function subscribePlanningViewportChanges(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  planningViewportListeners.add(listener);
  return () => {
    planningViewportListeners.delete(listener);
  };
}

export function subscribePlanningSelectionChanges(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  planningSelectionListeners.add(listener);
  return () => {
    planningSelectionListeners.delete(listener);
  };
}

function updateNavCenterButtonLabel() {
  const todayBtn = document.getElementById("btn-today");
  if (!todayBtn) return;
  const mode = getCurrentZoomMode();
  const anchorDate = getWindowCenterDate();
  todayBtn.textContent = getDynamicNavLabel(mode, anchorDate);
}

function getDynamicNavLabel(mode, anchorDate = new Date()) {
  if (mode === "week") {
    const d = new Date(anchorDate);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return `Semaine du ${monday.toLocaleDateString("fr-FR")}`;
  }
  if (mode === "month") {
    const monthLabel = anchorDate.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  }
  if (mode === "year") return String(anchorDate.getFullYear());
  return "Période";
}

function setActiveZoomButton(mode) {
  const buttons = document.querySelectorAll(".zoom-buttons button");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.zoom === mode);
  });
  updateNavCenterButtonLabel();
}

function setWindowForMode(mode, anchorDate = new Date()) {
  if (!timelineInstance) return;

  let start = null;
  let end = null;

  if (mode === "week") {
    const d = new Date(anchorDate);
    const day = d.getDay(); // 0 = dimanche
    const diffToMonday = day === 0 ? -6 : 1 - day;

    start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (mode === "month") {
    start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else if (mode === "year") {
    start = new Date(anchorDate.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(anchorDate.getFullYear(), 11, 31);
    end.setHours(23, 59, 59, 999);
  } else {
    // fallback
    return;
  }

  timelineInstance.setWindow(start, end, { animation: false });
  updateDateRangeDisplay();
}

function moveWindowByMode(direction) {
  if (!timelineInstance) return;

  const mode = getCurrentZoomMode();
  const current = timelineInstance.getWindow();

  // ancre = milieu de la fenêtre actuelle
  const centerMs = (current.start.valueOf() + current.end.valueOf()) / 2;
  const anchor = new Date(centerMs);

  if (mode === "week") {
    anchor.setDate(anchor.getDate() + (direction * 7));
  } else if (mode === "month") {
    anchor.setMonth(anchor.getMonth() + direction);
  } else if (mode === "year") {
    anchor.setFullYear(anchor.getFullYear() + direction);
  }

  setWindowForMode(mode, anchor);
}

export function setPlanningZoomMode(mode, anchorDate = null) {
  if (!timelineInstance) {
    return Promise.resolve(null);
  }

  const nextMode = normalizePlanningZoomMode(mode);
  const nextAnchorDate =
    resolvePlanningAnchorDate(anchorDate) || dataAnchorDate || getWindowCenterDate();

  setActiveZoomButton(nextMode);
  const settleToken = beginPlanningViewportSettle();
  setWindowForMode(nextMode, nextAnchorDate);
  updateNavCenterButtonLabel();
  requestStickyAxisSync();
  queuePlanningViewportSettled(settleToken);
  return waitForPlanningViewportSettled();
}

export function movePlanningViewportByMode(direction = 1) {
  if (!timelineInstance) {
    return Promise.resolve(null);
  }

  const settleToken = beginPlanningViewportSettle();
  moveWindowByMode(direction >= 0 ? 1 : -1);
  updateNavCenterButtonLabel();
  requestStickyAxisSync();
  queuePlanningViewportSettled(settleToken);
  return waitForPlanningViewportSettled();
}

export function focusPlanningDataAnchor() {
  if (!timelineInstance) {
    return Promise.resolve(null);
  }

  const mode = getCurrentZoomMode();
  const settleToken = beginPlanningViewportSettle();
  setWindowForMode(mode, dataAnchorDate || getWindowCenterDate());
  updateNavCenterButtonLabel();
  requestStickyAxisSync();
  queuePlanningViewportSettled(settleToken);
  return waitForPlanningViewportSettled();
}

export function setPlanningDurationEditHandler(handler) {
  durationCellEditHandler = typeof handler === "function" ? handler : null;
}

export function setPlanningRetardJustificationHandler(handler) {
  retardJustificationHandler = typeof handler === "function" ? handler : null;
}

export function setPlanningReferenceDetailsHandler(handler) {
  referenceDetailsHandler = typeof handler === "function" ? handler : null;
  if (referenceDetailsHandler) {
    bindReferenceDetailsLifecycleRefresh();
  }
}

export function setPlanningMsProjectDropHandler(handler) {
  msProjectRowDropHandler = typeof handler === "function" ? handler : null;
}

export function setPlanningRowDropHandler(handler) {
  planningRowDropHandler = typeof handler === "function" ? handler : null;
}

function buildTimelineRenderSignature(groups = [], items = []) {
  return JSON.stringify({ groups, items });
}

function syncTimelineDataSet(dataSet, records = []) {
  if (!dataSet) return;
  const nextRecords = Array.isArray(records) ? records : [];
  const currentRecords = dataSet.get();
  const currentById = new Map(currentRecords.map((record) => [record?.id, record]));
  const nextIds = new Set(nextRecords.map((record) => record?.id));
  const removedIds = currentRecords
    .filter((record) => !nextIds.has(record?.id))
    .map((record) => record.id);
  const changedRecords = nextRecords.filter((record) => {
    const current = currentById.get(record?.id);
    return !current || JSON.stringify(current) !== JSON.stringify(record);
  });
  const changedIds = changedRecords
    .filter((record) => currentById.has(record?.id))
    .map((record) => record.id);
  const idsToRemove = [...new Set([...removedIds, ...changedIds])];
  if (idsToRemove.length) {
    dataSet.remove(idsToRemove);
  }
  if (changedRecords.length) {
    dataSet.add(changedRecords);
  }
}

function isUsableTimelineWindow(range) {
  return (
    range?.start instanceof Date &&
    range?.end instanceof Date &&
    !Number.isNaN(range.start.getTime()) &&
    !Number.isNaN(range.end.getTime()) &&
    range.end > range.start
  );
}

export function renderPlanningTimeline(timelineData = {}) {
  lastPlanningTimelineData = {
    groups: timelineData.groups || [],
    items: timelineData.items || [],
    resetViewport: Boolean(timelineData.resetViewport),
  };
  const { groups, items } = getDisplayedTimelineData(lastPlanningTimelineData);
  const container = getTimelineContainer();
  bindPlanningPaneResizer();

  if (!window.vis || !window.vis.DataSet || !window.vis.Timeline) {
    throw new Error("vis-timeline non chargé.");
  }

  const renderSignature = buildTimelineRenderSignature(groups, items);
  const shouldResetViewport =
    Boolean(timelineData.resetViewport) || !timelineHasRenderedData;
  if (
    timelineInstance &&
    renderSignature === lastRenderedTimelineSignature &&
    !shouldResetViewport
  ) {
    return;
  }
  const previousWindow = timelineInstance?.getWindow?.() || null;

  // Création de l'instance une seule fois
  if (!timelineInstance) {
    groupsDataSet = new window.vis.DataSet([]);
    itemsDataSet = new window.vis.DataSet([]);

    timelineInstance = new window.vis.Timeline(container, itemsDataSet, groupsDataSet, {
      locale: "fr",
      orientation: {
        axis: "top",
        item: "top",
      },
      stack: false, // important pour garder plusieurs segments sur la même ligne
      multiselect: false,
      selectable: true,
      editable: {
        add: false,
        remove: false,
        updateGroup: false,
        updateTime: false,
      },
      groupHeightMode: "fixed", // important pour l'alignement des 4 colonnes
      margin: {
        item: { horizontal: 2, vertical: 0 },
        axis: 0,
      },
      showCurrentTime: true,
      zoomable: true,
      moveable: true,
      verticalScroll: true,
      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },
      showTooltips: false,
      groupTemplate: (group) => buildGroupLabelElement(group),

      groupOrder: (a, b) => {
        if (Number.isFinite(a.sortIndex) && Number.isFinite(b.sortIndex)) {
          return a.sortIndex - b.sortIndex;
        }

        if (Number.isFinite(a.sortLignePlanning) && Number.isFinite(b.sortLignePlanning)) {
          if (a.sortLignePlanning !== b.sortLignePlanning) {
            return a.sortLignePlanning - b.sortLignePlanning;
          }
        }

        if (Number.isFinite(a.sortID2) && Number.isFinite(b.sortID2)) {
          if (a.sortID2 !== b.sortID2) {
            return a.sortID2 - b.sortID2;
          }
        }

        return String(a.id || "").localeCompare(String(b.id || ""), "fr");
      },
    });

    bindHoverTooltip(container);
    bindDurationCellEditing(container);
    // Drag désactivé en mode embedded (synchronisation-plannings) : réservé à Planning Projet direct.
    if (!EMBEDDED_PLANNING_SYNC_MODE) {
      bindMsProjectRowDrop(container);
      bindPlanningRowDragging(container);
      bindPlanningRowDrop(container);
    }
    bindStickyTimelineAxis();

    timelineInstance.on("select", (properties = {}) => {
      const selectedItemId = Array.isArray(properties.items) ? properties.items[0] : "";
      if (!selectedItemId) {
        emitPlanningSelectionChange(null, { reason: "timeline-select-clear" });
        return;
      }

      const selectedItem = itemsDataSet?.get?.(selectedItemId) || null;
      const selectedGroupId = String(selectedItem?.group || "").trim();
      if (!selectedGroupId) {
        emitPlanningSelectionChange(null, { reason: "timeline-select-missing-group" });
        return;
      }

      const selectedGroup = groupsDataSet?.get?.(selectedGroupId) || null;
      emitPlanningSelectionChange(buildPlanningSelectionPayloadFromGroup(selectedGroup), {
        reason: "timeline-select",
        itemId: String(selectedItemId),
      });
    });

    // Initialiser la fenêtre sur aujourd'hui dès la création de l'instance.
    // Empêche vis-timeline de fitter automatiquement sur les items de fond
    // (zone-header-fill) quand les datasets sont remplis juste après.
    // Cette fenêtre sera immédiatement remplacée par le bon viewport
    // (setWindow dans le RAF non-embedded, ou applyViewport depuis le parent en embedded).
    const _t0 = new Date();
    const _s0 = new Date(_t0); _s0.setDate(_t0.getDate() - 7);
    const _e0 = new Date(_t0); _e0.setDate(_t0.getDate() + 7);
    timelineInstance.setWindow(_s0, _e0, { animation: false });
  }

  // Mise à jour différentielle : évite de détruire et reconstruire tout le DOM.
  timelineBulkUpdateInProgress = true;
  syncTimelineDataSet(groupsDataSet, groups || []);
  syncTimelineDataSet(itemsDataSet, items || []);
  lastRenderedTimelineSignature = renderSignature;
  timelineHasRenderedData = true;
  const settleToken = beginPlanningViewportSettle();

  // Recalage automatique sur les dates des données
  requestAnimationFrame(() => {
    timelineBulkUpdateInProgress = false;
    timelineInstance.redraw();
    decorateRenderedTimelineItems(container);
    syncNativeItemTitles(container);
    bindItemHoverInteractions(container);

    const range = computePlanningDataRange(items || [], lastPlanningTimelineData);
    const hasNonBackgroundItems = hasPlanningDataItems(items || [], lastPlanningTimelineData);
    if (!shouldResetViewport && isUsableTimelineWindow(previousWindow)) {
      if (range) {
        dataAnchorDate = computeRangeCenter(range);
      }
      timelineInstance.setWindow(previousWindow.start, previousWindow.end, { animation: false });
    } else if (EMBEDDED_PLANNING_SYNC_MODE) {
      if (range) {
        dataAnchorDate = computeRangeCenter(range);
        // Positionner vis-timeline sur la plage réelle des données.
        // Sans ce setWindow, vis-timeline auto-fit sur les zone-header backgrounds
        // (2021-2041) ce qui produit un viewport erroné (~2030) au lieu de la
        // période du projet. Le parent (synchronisation-plannings) remplacera ce
        // viewport via applyViewport juste après, mais il en a besoin pour
        // correctement synchroniser gestion-depenses2.
        timelineInstance.setWindow(range.start, range.end, { animation: false });
      } else if (hasNonBackgroundItems) {
        const fitted = timelineInstance.getWindow();
        dataAnchorDate = computeRangeCenter(fitted);
      } else if ((groups || []).length) {
        dataAnchorDate = new Date();
      } else {
        dataAnchorDate = null;
      }
    } else if (range) {
      dataAnchorDate = computeRangeCenter(range);
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if (hasNonBackgroundItems) {
      timelineInstance.fit({ animation: false });
      const fitted = timelineInstance.getWindow();
      dataAnchorDate = computeRangeCenter(fitted);
    } else if ((groups || []).length) {
      const today = new Date();
      const start = new Date(today);
      const end = new Date(today);
      start.setDate(start.getDate() - 7);
      end.setDate(end.getDate() + 7);
      dataAnchorDate = today;
      timelineInstance.setWindow(start, end, { animation: false });
    } else {
      dataAnchorDate = null;
    }

    updateDateRangeDisplay();
    updateNavCenterButtonLabel();
    requestStickyAxisSync();
    queuePlanningViewportSettled(settleToken);
  });
}

export function bindTimelineToolbar() {
  // Évite de binder plusieurs fois si refreshPlanning est rappelé
  if (toolbarListenersBound) return;
  toolbarListenersBound = true;

  const prevBtn = document.getElementById("btn-prev");
  const todayBtn = document.getElementById("btn-today");
  const nextBtn = document.getElementById("btn-next");
  const zoomButtons = document.querySelectorAll(".zoom-buttons button");

  prevBtn?.addEventListener("click", () => {
    moveWindowByMode(-1);
  });

  nextBtn?.addEventListener("click", () => {
    moveWindowByMode(1);
  });

  todayBtn?.addEventListener("click", () => {
    const mode = getCurrentZoomMode();
    setWindowForMode(mode, dataAnchorDate || getWindowCenterDate());
  });

  zoomButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const mode = e.currentTarget?.dataset?.zoom;
      if (!mode) return;

      setActiveZoomButton(mode);
      setWindowForMode(mode, dataAnchorDate || new Date());
    });
  });

  // Mettre à jour le texte quand l’utilisateur déplace/zoome à la souris
  if (timelineInstance) {
    timelineInstance.on("rangechange", () => {
      if (enforceEmbeddedPlanningViewportBounds()) {
        return;
      }
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
    });
    timelineInstance.on("rangechanged", () => {
      if (enforceEmbeddedPlanningViewportBounds()) {
        return;
      }
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      emitPlanningViewportChange("rangechanged");
    });
  }

  // Initialisation affichage
  updateNavCenterButtonLabel();
  updateDateRangeDisplay();
  window.addEventListener("resize", () => {
    refreshPlanningTimelineLayout();
  });
}

export function clearPlanningTimeline() {
  if (!timelineInstance || !groupsDataSet || !itemsDataSet) return;

  groupsDataSet.clear();
  itemsDataSet.clear();
  lastRenderedTimelineSignature = "";
  timelineHasRenderedData = false;
  lastPlanningViewportEmissionSignature = "";
  lastPlanningSelectionEmissionSignature = "";
  clearPendingProgrammaticPlanningViewport();
  emitPlanningSelectionChange(null, { reason: "timeline-clear" });

  const rangeEl = document.getElementById("current-date-range");
  if (rangeEl) {
    rangeEl.textContent = "";
    rangeEl.removeAttribute("title");
  }

  hideHoverTooltip();
  clearMsProjectDropTarget();
  clearPlanningRowDropTarget();
  clearPlanningRowDraggingState();
  resolvePlanningViewportSettled(getPlanningViewportState());
}

export function setPlanningVisualAggregateMode(enabled = false) {
  const nextEnabled = Boolean(enabled);
  document.body?.classList?.toggle("planning-visual-aggregate-mode", nextEnabled);
  if (visualAggregateModeEnabled === nextEnabled) {
    return visualAggregateModeEnabled;
  }

  const previousWindow =
    timelineInstance && typeof timelineInstance.getWindow === "function"
      ? timelineInstance.getWindow()
      : null;
  visualAggregateModeEnabled = nextEnabled;
  if (timelineInstance) {
    renderPlanningTimeline(lastPlanningTimelineData);
    if (
      previousWindow?.start instanceof Date &&
      previousWindow?.end instanceof Date &&
      !Number.isNaN(previousWindow.start.getTime()) &&
      !Number.isNaN(previousWindow.end.getTime()) &&
      previousWindow.end >= previousWindow.start
    ) {
      requestAnimationFrame(() => {
        if (!timelineInstance) return;
        rememberProgrammaticPlanningViewportFromRange(getCurrentZoomMode(), previousWindow);
        timelineInstance.setWindow(previousWindow.start, previousWindow.end, { animation: false });
        updateDateRangeDisplay();
        updateNavCenterButtonLabel();
        requestStickyAxisSync();
      });
    }
    emitPlanningSelectionChange(null, {
      reason: "visual-aggregate-mode-change",
    });
  }

  return visualAggregateModeEnabled;
}
