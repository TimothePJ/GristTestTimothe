const planningFrameEl = document.getElementById("planning-projet-frame");
const planningAxisFrameEl = document.getElementById("planning-projet-axis-frame");
const expensesFrameEl = document.getElementById("gestion-depenses2-frame");
const expensesChartFrameEl = document.getElementById("gestion-depenses2-chart-frame");
const planningResizeHandleEl = document.getElementById("sync-planning-resize-handle");
const projectSelectEl = document.getElementById("shared-project-select");
const statusValueEl = document.getElementById("hub-status-value");
const lastSourceValueEl = document.getElementById("last-source-value");
const lastRangeValueEl = document.getElementById("last-range-value");
const logEl = document.getElementById("sync-log");
const clearLogBtn = document.getElementById("clear-log-btn");
const sharedPrevBtnEl = document.getElementById("shared-prev-btn");
const sharedCenterBtnEl = document.getElementById("shared-center-btn");
const sharedNextBtnEl = document.getElementById("shared-next-btn");
const sharedCurrentDateRangeEl = document.getElementById("shared-current-date-range");
const expensesModeButtons = Array.from(
  document.querySelectorAll("[data-expenses-sync-mode]")
);
const HUB_URL_PARAMS =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const LAYOUT_DEBUG_ENABLED = HUB_URL_PARAMS?.get("debugLayout") === "1";
const DEBUG_DISABLE_STICKY_SHELL = HUB_URL_PARAMS?.get("noStickyShell") === "1";
const DAY_IN_MS = 86400000;
const DEFAULT_PLANNING_FRAME_HEIGHT = 820;
const MIN_PLANNING_FRAME_HEIGHT = 280;
const MAX_PLANNING_FRAME_HEIGHT = 1600;
const PLANNING_FRAME_HEIGHT_STORAGE_KEY = "sync-planning.top-frame-height";

let planningApi = null;
let planningAxisApi = null;
let expensesApi = null;
let expensesChartApi = null;
let activeProjectKey = "";
let requestedProjectKey = "";
let projectSyncInProgress = false;
let viewportSyncInProgress = false;
let pendingViewportPayload = null;
let lastAppliedViewportLogicalSignature = "";
let sharedViewportState = null;
let expensesFramePresentationTimer = 0;
let expensesChartFramePresentationTimer = 0;
let lastExpensesVisibleWidthAdjustment = Number.NaN;
let lastExpensesReferenceVisibleWidth = Number.NaN;
let lastExpensesPixelAlignmentDelta = Number.NaN;
let expensesVisibleWidthAdjustmentRerenderPending = false;
let planningLayoutDebugRafId = 0;
let planningLayoutDebugCleanup = null;
let lastPlanningLayoutDebugSignature = "";
let planningFrameResizeState = null;
let planningFrameResizeRefreshRafId = 0;
let expensesFrameAttachPromise = null;
let expensesFrameAttachAttempt = 0;
let expensesViewportSubscriptionApi = null;
let expensesChartFrameAttachPromise = null;
let expensesChartFrameAttachAttempt = 0;
const pendingPlanningLayoutDebugReasons = new Set();
const SHARED_VIEWPORT_RULES = {
  referenceMonthDays: 30.4375,
  minVisibleDays: 7,
  yearMaxVisibleMonths: 14,
};

if (DEBUG_DISABLE_STICKY_SHELL && typeof document !== "undefined") {
  document.body.classList.add("layout-debug-no-sticky");
}

function getReferencePlanningApi() {
  return planningAxisApi || planningApi || null;
}

function getViewportSourceLabel(sourceApp = "") {
  if (sourceApp === "planning-projet-axis") {
    return "frise commune";
  }

  if (sourceApp === "planning-projet-main") {
    return "planning-projet";
  }

  if (sourceApp === "gestion-depenses2") {
    return "gestion-depenses2";
  }

  if (sourceApp === "Pilotage commun") {
    return "Pilotage commun";
  }

  return String(sourceApp || "").trim() || "source inconnue";
}

function getViewportSourceApi(sourceApp = "") {
  if (sourceApp === "planning-projet-axis") {
    return planningAxisApi;
  }

  if (sourceApp === "planning-projet-main") {
    return planningApi;
  }

  if (sourceApp === "gestion-depenses2") {
    return expensesApi;
  }

  return null;
}

function getViewportTargetApis(sourceApp = "") {
  if (sourceApp === "planning-projet-axis") {
    return [planningApi, expensesApi].filter(Boolean);
  }

  if (sourceApp === "planning-projet-main") {
    return [planningAxisApi, expensesApi].filter(Boolean);
  }

  if (sourceApp === "gestion-depenses2") {
    return [planningApi, planningAxisApi].filter(Boolean);
  }

  return [];
}

function setHubStatus(message) {
  if (statusValueEl) {
    statusValueEl.textContent = String(message || "").trim() || "-";
  }
}

function setLastSource(message) {
  if (lastSourceValueEl) {
    lastSourceValueEl.textContent = String(message || "").trim() || "-";
  }
}

function setLastRange(viewport = null) {
  if (!lastRangeValueEl) {
    return;
  }

  if (!viewport) {
    lastRangeValueEl.textContent = "-";
    return;
  }

  const visibleDays = Number(viewport.visibleDays);
  const start = String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim();
  const end =
    String(viewport.rangeEndDate || "").trim() ||
    shiftIsoDateValue(start, Math.max(0, visibleDays - 1));
  const mode = String(viewport.mode || "").trim();

  lastRangeValueEl.textContent = [
    start && end ? `${start} -> ${end}` : start || end || "-",
    mode || "mode ?",
    Number.isFinite(visibleDays) ? `${visibleDays} j` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function setExpensesPlanningControlsDisabled(disabled = true) {
  expensesModeButtons.forEach((buttonEl) => {
    buttonEl.disabled = Boolean(disabled);
  });

  if (sharedPrevBtnEl instanceof HTMLButtonElement) {
    sharedPrevBtnEl.disabled = Boolean(disabled);
  }

  if (sharedCenterBtnEl instanceof HTMLButtonElement) {
    sharedCenterBtnEl.disabled = Boolean(disabled);
  }

  if (sharedNextBtnEl instanceof HTMLButtonElement) {
    sharedNextBtnEl.disabled = Boolean(disabled);
  }
}

function clampPlanningFrameHeight(height) {
  const numericHeight = Number(height);
  if (!Number.isFinite(numericHeight)) {
    return DEFAULT_PLANNING_FRAME_HEIGHT;
  }

  return Math.min(MAX_PLANNING_FRAME_HEIGHT, Math.max(MIN_PLANNING_FRAME_HEIGHT, numericHeight));
}

function persistPlanningFrameHeight(height) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      PLANNING_FRAME_HEIGHT_STORAGE_KEY,
      String(Math.round(clampPlanningFrameHeight(height)))
    );
  } catch (error) {
    console.warn("[sync] impossible d'enregistrer la hauteur du planning", error);
  }
}

function getStoredPlanningFrameHeight() {
  if (typeof window === "undefined") {
    return Number.NaN;
  }

  try {
    const storedValue = Number(window.localStorage.getItem(PLANNING_FRAME_HEIGHT_STORAGE_KEY));
    return Number.isFinite(storedValue) ? clampPlanningFrameHeight(storedValue) : Number.NaN;
  } catch (error) {
    console.warn("[sync] impossible de relire la hauteur du planning", error);
    return Number.NaN;
  }
}

function schedulePlanningFrameResizeRefresh(reason = "planning-frame-resize") {
  if (planningFrameResizeRefreshRafId) {
    return;
  }

  planningFrameResizeRefreshRafId = window.requestAnimationFrame(() => {
    planningFrameResizeRefreshRafId = 0;
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug(reason);
  });
}

function applyPlanningFrameHeight(nextHeight, { persist = true, refresh = true } = {}) {
  const appliedHeight = clampPlanningFrameHeight(nextHeight);

  if (planningFrameEl instanceof HTMLIFrameElement) {
    planningFrameEl.style.height = `${appliedHeight}px`;
    planningFrameEl.style.minHeight = `${appliedHeight}px`;
  }

  if (planningResizeHandleEl instanceof HTMLElement) {
    planningResizeHandleEl.setAttribute("aria-valuemin", String(MIN_PLANNING_FRAME_HEIGHT));
    planningResizeHandleEl.setAttribute("aria-valuemax", String(MAX_PLANNING_FRAME_HEIGHT));
    planningResizeHandleEl.setAttribute("aria-valuenow", String(Math.round(appliedHeight)));
    planningResizeHandleEl.setAttribute("aria-valuetext", `${Math.round(appliedHeight)} pixels`);
  }

  if (persist) {
    persistPlanningFrameHeight(appliedHeight);
  }

  if (refresh) {
    schedulePlanningFrameResizeRefresh();
  }

  return appliedHeight;
}

function bindPlanningFrameResizeHandle() {
  if (!(planningResizeHandleEl instanceof HTMLElement)) {
    return;
  }

  const finishResize = () => {
    if (!planningFrameResizeState) {
      return;
    }

    const finalHeight =
      planningFrameEl?.getBoundingClientRect?.().height || planningFrameResizeState.startHeight;

    document.body.classList.remove("is-sync-planning-resizing");
    applyPlanningFrameHeight(finalHeight, { persist: true, refresh: true });
    planningFrameResizeState = null;
  };

  planningResizeHandleEl.addEventListener("dblclick", () => {
    applyPlanningFrameHeight(DEFAULT_PLANNING_FRAME_HEIGHT, { persist: true, refresh: true });
  });

  planningResizeHandleEl.addEventListener("keydown", (event) => {
    const currentHeight =
      planningFrameEl?.getBoundingClientRect?.().height || DEFAULT_PLANNING_FRAME_HEIGHT;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyPlanningFrameHeight(currentHeight - 32, { persist: true, refresh: true });
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      applyPlanningFrameHeight(currentHeight + 32, { persist: true, refresh: true });
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      applyPlanningFrameHeight(MIN_PLANNING_FRAME_HEIGHT, { persist: true, refresh: true });
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      applyPlanningFrameHeight(DEFAULT_PLANNING_FRAME_HEIGHT, { persist: true, refresh: true });
    }
  });

  planningResizeHandleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const startHeight =
      planningFrameEl?.getBoundingClientRect?.().height || DEFAULT_PLANNING_FRAME_HEIGHT;

    planningFrameResizeState = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
    };

    document.body.classList.add("is-sync-planning-resizing");
    planningResizeHandleEl.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  planningResizeHandleEl.addEventListener("pointermove", (event) => {
    if (!planningFrameResizeState || event.pointerId !== planningFrameResizeState.pointerId) {
      return;
    }

    const nextHeight =
      planningFrameResizeState.startHeight + (event.clientY - planningFrameResizeState.startY);
    applyPlanningFrameHeight(nextHeight, { persist: false, refresh: true });
  });

  planningResizeHandleEl.addEventListener("pointerup", (event) => {
    if (!planningFrameResizeState || event.pointerId !== planningFrameResizeState.pointerId) {
      return;
    }

    planningResizeHandleEl.releasePointerCapture?.(event.pointerId);
    finishResize();
  });

  planningResizeHandleEl.addEventListener("pointercancel", (event) => {
    if (!planningFrameResizeState || event.pointerId !== planningFrameResizeState.pointerId) {
      return;
    }

    planningResizeHandleEl.releasePointerCapture?.(event.pointerId);
    finishResize();
  });

  planningResizeHandleEl.addEventListener("lostpointercapture", () => {
    finishResize();
  });
}

function formatSharedCenterLabel(mode = "", anchorDateValue = "") {
  const normalizedMode = String(mode || "").trim() || "week";
  const normalizedAnchorDate = normalizeIsoDate(anchorDateValue);
  const anchorDate = normalizedAnchorDate
    ? new Date(`${normalizedAnchorDate}T12:00:00`)
    : new Date();

  if (Number.isNaN(anchorDate.getTime())) {
    return "Aujourd'hui";
  }

  if (normalizedMode === "week") {
    const day = anchorDate.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(anchorDate);
    monday.setDate(anchorDate.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return `Semaine du ${monday.toLocaleDateString("fr-FR")}`;
  }

  if (normalizedMode === "month") {
    const monthLabel = anchorDate.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  }

  if (normalizedMode === "year") {
    return String(anchorDate.getFullYear());
  }

  return "Aujourd'hui";
}

function formatSharedRangeLabel(startDateValue, endDateValue, availableWidth = Infinity) {
  const normalizedStartDate = normalizeIsoDate(startDateValue);
  const normalizedEndDate = normalizeIsoDate(endDateValue);
  if (!normalizedStartDate) {
    return "-";
  }

  const startDate = new Date(`${normalizedStartDate}T12:00:00`);
  if (Number.isNaN(startDate.getTime())) {
    return "-";
  }

  if (!normalizedEndDate) {
    return startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const endDate = new Date(`${normalizedEndDate}T12:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

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

function syncExpensesPlanningShell(viewport = null) {
  const canonicalViewport = viewport ? buildCanonicalSharedViewport(viewport) : null;
  if (canonicalViewport) {
    sharedViewportState = canonicalViewport;
  }

  const activeViewport = canonicalViewport || sharedViewportState;
  const activeMode = String(activeViewport?.mode || "").trim();
  const activeDateValue =
    normalizeIsoDate(activeViewport?.firstVisibleDate) ||
    normalizeIsoDate(activeViewport?.rangeStartDate) ||
    "";

  expensesModeButtons.forEach((buttonEl) => {
    const buttonMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
    const isActive = buttonMode && buttonMode === activeMode;
    buttonEl.classList.toggle("is-active", isActive);
    buttonEl.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (sharedCenterBtnEl instanceof HTMLButtonElement) {
    sharedCenterBtnEl.textContent = formatSharedCenterLabel(
      activeMode,
      activeViewport?.anchorDate || activeDateValue
    );
  }

  if (sharedCurrentDateRangeEl instanceof HTMLElement) {
    const availableWidth = Math.max(
      0,
      Math.round(
        sharedCurrentDateRangeEl.getBoundingClientRect().width ||
          sharedCurrentDateRangeEl.clientWidth ||
          0
      )
    );
    const fullLabel = formatSharedRangeLabel(
      activeViewport?.firstVisibleDate || activeViewport?.rangeStartDate || "",
      activeViewport?.rangeEndDate || "",
      Number.MAX_SAFE_INTEGER
    );
    sharedCurrentDateRangeEl.textContent = formatSharedRangeLabel(
      activeViewport?.firstVisibleDate || activeViewport?.rangeStartDate || "",
      activeViewport?.rangeEndDate || "",
      availableWidth
    );
    sharedCurrentDateRangeEl.title = fullLabel;
  }
}

function appendLog(message) {
  if (!(logEl instanceof HTMLElement)) {
    return;
  }

  const existing = logEl.textContent === "En attente d'activite..." ? "" : logEl.textContent;
  logEl.textContent = [`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`, existing]
    .filter(Boolean)
    .join("\n");
}

function roundLayoutDebugValue(value, digits = 2) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const precision = 10 ** digits;
  return Math.round(numericValue * precision) / precision;
}

function getSharedTimelineShellState() {
  const shellEl = document.querySelector(".shared-timeline-shell");
  if (!(shellEl instanceof HTMLElement)) {
    return null;
  }

  const shellRect = shellEl.getBoundingClientRect();
  const shellTop = roundLayoutDebugValue(shellRect.top);
  return {
    top: shellTop,
    width: roundLayoutDebugValue(shellRect.width),
    height: roundLayoutDebugValue(shellRect.height),
    sticky: Number.isFinite(shellTop) ? shellTop <= 10.5 : false,
  };
}

function getPlanningLayoutSnapshot(reason = "") {
  const planningDocument = planningFrameEl?.contentDocument;
  const planningWindow = planningFrameEl?.contentWindow;
  if (!planningDocument || !planningWindow) {
    return null;
  }

  const wrapper = planningDocument.getElementById("timelineWrapper");
  const planningRoot = planningDocument.getElementById("planningTimeline");
  const headerRow = planningDocument.querySelector(".planning-header-row");
  const topPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-top");
  const leftPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-left");
  const centerPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-center");
  const firstTaskCell = planningDocument.querySelector(
    "#planningTimeline .group-row-grid .cell-task"
  );
  const firstLabelInner = planningDocument.querySelector(
    "#planningTimeline .vis-labelset .vis-label .vis-inner"
  );
  if (
    !(wrapper instanceof planningWindow.HTMLElement) ||
    !(planningRoot instanceof planningWindow.HTMLElement)
  ) {
    return null;
  }

  const frameRect = planningFrameEl?.getBoundingClientRect?.() || null;
  const wrapperRect = wrapper.getBoundingClientRect();
  const headerRect = headerRow instanceof planningWindow.HTMLElement ? headerRow.getBoundingClientRect() : null;
  const topPanelRect =
    topPanel instanceof planningWindow.HTMLElement ? topPanel.getBoundingClientRect() : null;
  const leftPanelRect =
    leftPanel instanceof planningWindow.HTMLElement ? leftPanel.getBoundingClientRect() : null;
  const centerPanelRect =
    centerPanel instanceof planningWindow.HTMLElement ? centerPanel.getBoundingClientRect() : null;
  const firstTaskCellRect =
    firstTaskCell instanceof planningWindow.HTMLElement ? firstTaskCell.getBoundingClientRect() : null;
  const firstLabelInnerRect =
    firstLabelInner instanceof planningWindow.HTMLElement
      ? firstLabelInner.getBoundingClientRect()
      : null;
  const topPanelStyle =
    topPanel instanceof planningWindow.HTMLElement
      ? planningWindow.getComputedStyle(topPanel)
      : null;
  const leftPanelStyle =
    leftPanel instanceof planningWindow.HTMLElement
      ? planningWindow.getComputedStyle(leftPanel)
      : null;
  const firstTaskCellStyle =
    firstTaskCell instanceof planningWindow.HTMLElement
      ? planningWindow.getComputedStyle(firstTaskCell)
      : null;
  const syncPlanningCardEl = document.querySelector(".sync-planning-card");
  const scrollbarShift =
    syncPlanningCardEl instanceof HTMLElement
      ? syncPlanningCardEl.style.getPropertyValue("--sync-planning-scrollbar-shift").trim()
      : "";

  return {
    reason,
    pageScrollY: roundLayoutDebugValue(window.scrollY, 0),
    shell: getSharedTimelineShellState(),
    frame: frameRect
      ? {
          top: roundLayoutDebugValue(frameRect.top),
          bottom: roundLayoutDebugValue(frameRect.bottom),
          width: roundLayoutDebugValue(frameRect.width),
          height: roundLayoutDebugValue(frameRect.height),
        }
      : null,
    wrapper: {
      top: roundLayoutDebugValue(wrapperRect.top),
      scrollTop: roundLayoutDebugValue(wrapper.scrollTop, 0),
      clientWidth: roundLayoutDebugValue(wrapper.clientWidth, 0),
      offsetWidth: roundLayoutDebugValue(wrapper.offsetWidth, 0),
      scrollHeight: roundLayoutDebugValue(wrapper.scrollHeight, 0),
      gutterWidth: roundLayoutDebugValue(getPlanningMainScrollbarGutterWidth()),
    },
    headerRow:
      headerRect && frameRect
        ? {
            topInFrame: roundLayoutDebugValue(headerRect.top - frameRect.top),
            height: roundLayoutDebugValue(headerRect.height),
          }
        : null,
    topPanel:
      topPanelRect && frameRect
        ? {
            display: topPanelStyle?.display || "",
            transform: topPanelStyle?.transform || "",
            topInFrame: roundLayoutDebugValue(topPanelRect.top - frameRect.top),
            height: roundLayoutDebugValue(topPanelRect.height),
          }
        : null,
    leftPanel:
      leftPanelRect && frameRect
        ? {
            leftInFrame: roundLayoutDebugValue(leftPanelRect.left - frameRect.left),
            width: roundLayoutDebugValue(leftPanelRect.width),
            overflow: leftPanelStyle?.overflow || "",
          }
        : null,
    centerPanel:
      centerPanelRect && frameRect
        ? {
            leftInFrame: roundLayoutDebugValue(centerPanelRect.left - frameRect.left),
            width: roundLayoutDebugValue(centerPanelRect.width),
          }
        : null,
    firstLabelInner:
      firstLabelInnerRect && frameRect
        ? {
            leftInFrame: roundLayoutDebugValue(firstLabelInnerRect.left - frameRect.left),
            width: roundLayoutDebugValue(firstLabelInnerRect.width),
          }
        : null,
    firstTaskCell:
      firstTaskCellRect && frameRect
        ? {
            leftInFrame: roundLayoutDebugValue(firstTaskCellRect.left - frameRect.left),
            width: roundLayoutDebugValue(firstTaskCellRect.width),
            scrollWidth: roundLayoutDebugValue(firstTaskCell.scrollWidth, 0),
            clientWidth: roundLayoutDebugValue(firstTaskCell.clientWidth, 0),
            textAlign: firstTaskCellStyle?.textAlign || "",
          }
        : null,
    syncScrollbarShift: scrollbarShift || "0px",
  };
}

function schedulePlanningLayoutDebug(reason = "") {
  if (!LAYOUT_DEBUG_ENABLED) {
    return;
  }

  if (reason) {
    pendingPlanningLayoutDebugReasons.add(reason);
  }

  if (planningLayoutDebugRafId) {
    return;
  }

  planningLayoutDebugRafId = window.requestAnimationFrame(() => {
    planningLayoutDebugRafId = 0;
    const reasonLabel = Array.from(pendingPlanningLayoutDebugReasons).join(",");
    pendingPlanningLayoutDebugReasons.clear();
    const snapshot = getPlanningLayoutSnapshot(reasonLabel || "layout");
    if (!snapshot) {
      return;
    }

    const nextSignature = JSON.stringify(snapshot);
    if (nextSignature === lastPlanningLayoutDebugSignature) {
      return;
    }

    lastPlanningLayoutDebugSignature = nextSignature;
    console.info("[sync-layout]", snapshot);
  });
}

function bindPlanningLayoutDebug() {
  if (!LAYOUT_DEBUG_ENABLED) {
    return;
  }

  if (planningLayoutDebugCleanup) {
    planningLayoutDebugCleanup();
    planningLayoutDebugCleanup = null;
  }

  const planningDocument = planningFrameEl?.contentDocument;
  const planningWindow = planningFrameEl?.contentWindow;
  const wrapper = planningDocument?.getElementById("timelineWrapper");
  if (!(planningWindow && wrapper instanceof planningWindow.HTMLElement)) {
    return;
  }

  const handleWrapperScroll = () => schedulePlanningLayoutDebug("planning-scroll");
  const handlePageScroll = () => schedulePlanningLayoutDebug("page-scroll");
  const handleResize = () => schedulePlanningLayoutDebug("resize");

  wrapper.addEventListener("scroll", handleWrapperScroll, { passive: true });
  window.addEventListener("scroll", handlePageScroll, { passive: true });
  window.addEventListener("resize", handleResize);
  window.visualViewport?.addEventListener("resize", handleResize);

  planningLayoutDebugCleanup = () => {
    wrapper.removeEventListener("scroll", handleWrapperScroll);
    window.removeEventListener("scroll", handlePageScroll);
    window.removeEventListener("resize", handleResize);
    window.visualViewport?.removeEventListener("resize", handleResize);
  };

  schedulePlanningLayoutDebug("bind");
}

function normalizeProjectKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getDesiredProjectKey() {
  return String(requestedProjectKey || activeProjectKey || projectSelectEl?.value || "").trim();
}

function normalizeViewportSignatureTimestamp(timestampMs) {
  const numericTimestamp = parseSharedExactNumber(timestampMs);
  if (!Number.isFinite(numericTimestamp)) {
    return "";
  }

  return String(Math.round(numericTimestamp / 10) * 10);
}

function getViewportLogicalSignature(projectKey, viewport = {}) {
  const normalizedProjectKey = normalizeProjectKey(projectKey || activeProjectKey || "");
  const rangeStartDate = String(viewport?.firstVisibleDate || viewport?.rangeStartDate || "").trim();
  const mode = String(viewport?.mode || "").trim();
  const visibleDays = Number(viewport?.visibleDays);
  const windowStartMs = normalizeViewportSignatureTimestamp(viewport?.windowStartMs);
  const windowEndMs = normalizeViewportSignatureTimestamp(viewport?.windowEndMs);
  const leftDayOffset = parseSharedExactNumber(viewport?.leftDayOffset);

  return [
    normalizedProjectKey,
    rangeStartDate,
    mode,
    Number.isFinite(visibleDays) ? Math.round(visibleDays) : "",
    windowStartMs,
    windowEndMs,
    Number.isFinite(leftDayOffset) ? leftDayOffset.toFixed(4) : "",
  ].join("|");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseSharedExactNumber(value) {
  if (value == null || value === "") {
    return Number.NaN;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

function getIsoDateFromExactTimestamp(timestampMs) {
  const numericTimestamp = parseSharedExactNumber(timestampMs);
  if (!Number.isFinite(numericTimestamp)) {
    return "";
  }

  const date = new Date(numericTimestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return normalizeIsoDate(
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`
  );
}

function normalizeIsoDate(value) {
  const normalizedValue = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) ? normalizedValue : "";
}

function shiftIsoDateValue(dateValue, dayDelta = 0) {
  const normalizedDate = normalizeIsoDate(dateValue);
  if (!normalizedDate) {
    return "";
  }

  const date = new Date(`${normalizedDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setDate(date.getDate() + Number(dayDelta || 0));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getInclusiveDaySpan(startDateValue, endDateValue) {
  const normalizedStartDate = normalizeIsoDate(startDateValue);
  const normalizedEndDate = normalizeIsoDate(endDateValue);
  if (!normalizedStartDate || !normalizedEndDate) {
    return 0;
  }

  const startDate = new Date(`${normalizedStartDate}T12:00:00`);
  const endDate = new Date(`${normalizedEndDate}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }

  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}

function getSharedVisibleDaysBounds(viewport = {}) {
  const fallbackMonthVisibleDays = Number(SHARED_VIEWPORT_RULES.referenceMonthDays) || 30.4375;
  const fallbackMinVisibleDays = Number(SHARED_VIEWPORT_RULES.minVisibleDays) || 7;
  const fallbackMaxVisibleDays =
    fallbackMonthVisibleDays *
    Math.max(1, Number(SHARED_VIEWPORT_RULES.yearMaxVisibleMonths) || 14);
  let sourceBounds = null;

  if (expensesApi?.getViewportBounds) {
    try {
      sourceBounds = expensesApi.getViewportBounds(viewport) || null;
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

function isSupportedSharedMode(mode) {
  return mode === "week" || mode === "month" || mode === "year";
}

function deriveSharedModeFromVisibleDays(nextVisibleDays, viewport = {}) {
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

function buildCanonicalSharedViewport(viewport = {}) {
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

function buildPlanningExactSharedViewport(viewport = {}) {
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

function stripExactWindowViewportState(viewport = {}) {
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

function normalizeProjectDateBounds(projectDateBounds = null) {
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

function buildSharedProjectDateBounds({
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

function buildProjectSelectionViewport(projectDateBounds = null, fallbackViewport = {}) {
  const fallbackSharedViewport = buildCanonicalSharedViewport(
    stripExactWindowViewportState(fallbackViewport)
  );
  const projectStartDate = normalizeIsoDate(
    projectDateBounds?.startDate || projectDateBounds?.firstDate
  );
  const projectEndDate = normalizeIsoDate(
    projectDateBounds?.endDate || projectDateBounds?.lastDate
  );

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

function getTargetVisibleDaysForMode(nextMode, viewport = {}) {
  const { monthVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds(viewport);

  if (nextMode === "week") {
    return 7;
  }

  if (nextMode === "year") {
    return Math.round(Math.min(maxVisibleDays, monthVisibleDays * 12));
  }

  return Math.ceil(monthVisibleDays);
}

function getCurrentSharedViewport() {
  const referencePlanningApi = getReferencePlanningApi();
  const baseViewport =
    sharedViewportState ||
    expensesApi?.getViewport?.() ||
    referencePlanningApi?.getViewport?.() ||
    null;

  return baseViewport ? buildCanonicalSharedViewport(baseViewport) : null;
}

function syncPlanningViewportBounds(viewport = {}) {
  if (!planningApi?.setViewportBounds || !expensesApi?.getViewportBounds) {
    return;
  }

  try {
    const bounds = expensesApi.getViewportBounds(viewport) || null;
    if (bounds) {
      planningApi.setViewportBounds(bounds);
      if (planningAxisApi?.setViewportBounds) {
        planningAxisApi.setViewportBounds(bounds);
      }
    }
  } catch (error) {
    console.warn("Impossible de synchroniser les bornes du planning :", error);
  }
}

async function alignExpensesViewportToPlanning(baseViewport = null, maxAttempts = 4) {
  const referencePlanningApi = getReferencePlanningApi();
  if (!referencePlanningApi || !expensesApi) {
    return null;
  }

  let planningViewport = buildCanonicalSharedViewport(
    referencePlanningApi.getViewport?.() || baseViewport || sharedViewportState || {}
  );
  if (!planningViewport.firstVisibleDate) {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    syncPlanningViewportBounds(planningViewport);
    await Promise.resolve(expensesApi.applyViewport(planningViewport));
    scheduleExpensesFramePresentation();
    await sleep(attempt === 0 ? 90 : 140);

    const refreshedPlanningViewport = buildCanonicalSharedViewport(
      referencePlanningApi.getViewport?.() || planningViewport
    );
    const refreshedExpensesViewport = buildCanonicalSharedViewport(
      expensesApi.getViewport?.() || planningViewport
    );
    const planningWindowStartMs = parseSharedExactNumber(refreshedPlanningViewport.windowStartMs);
    const planningWindowEndMs = parseSharedExactNumber(refreshedPlanningViewport.windowEndMs);
    const expensesWindowStartMs = parseSharedExactNumber(refreshedExpensesViewport.windowStartMs);
    const expensesWindowEndMs = parseSharedExactNumber(refreshedExpensesViewport.windowEndMs);
    const exactWindowAligned =
      Number.isFinite(planningWindowStartMs) &&
      Number.isFinite(planningWindowEndMs) &&
      Number.isFinite(expensesWindowStartMs) &&
      Number.isFinite(expensesWindowEndMs) &&
      Math.abs(planningWindowStartMs - expensesWindowStartMs) <= 10 &&
      Math.abs(planningWindowEndMs - expensesWindowEndMs) <= 10;

    const isAligned =
      exactWindowAligned ||
      (refreshedPlanningViewport.firstVisibleDate === refreshedExpensesViewport.firstVisibleDate &&
        refreshedPlanningViewport.visibleDays === refreshedExpensesViewport.visibleDays &&
        refreshedPlanningViewport.mode === refreshedExpensesViewport.mode);

    planningViewport = refreshedPlanningViewport;
    if (isAligned) {
      return refreshedPlanningViewport;
    }
  }

  return planningViewport;
}

async function applyViewportFromParentControls(viewport = {}) {
  if (!planningApi || projectSyncInProgress || viewportSyncInProgress) {
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportLogicalSignature = getViewportLogicalSignature(activeProjectKey, canonicalViewport);
  viewportSyncInProgress = true;

  try {
    const applyCalls = [
      Promise.resolve(planningApi.applyViewport(canonicalViewport)),
      Promise.resolve(planningAxisApi?.applyViewport?.(canonicalViewport)),
    ];

    if (expensesApi?.applyViewport) {
      applyCalls.push(Promise.resolve(expensesApi.applyViewport(canonicalViewport)));
    }

    await Promise.all(applyCalls);

    lastAppliedViewportLogicalSignature = viewportLogicalSignature;
    sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    setLastSource(getViewportSourceLabel("Pilotage commun"));
    setLastRange(canonicalViewport);
    setHubStatus("Synchro active depuis Pilotage commun");
    appendLog(
      `pilotage commun -> ${canonicalViewport.firstVisibleDate || "?"} / ${
        canonicalViewport.rangeEndDate || "?"
      } / ${canonicalViewport.mode || "?"}`
    );
  } catch (error) {
    console.error("Erreur controle planning synchronise :", error);
    setHubStatus(`Erreur pilotage : ${error.message}`);
    appendLog(`Erreur pilotage : ${error.message}`);
  } finally {
    viewportSyncInProgress = false;
    if (pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

function ensureExpensesFramePresentation() {
  const frameDocument = expensesFrameEl?.contentDocument;
  if (!frameDocument?.head || !frameDocument?.body) {
    return false;
  }

  const syncPlanningCardEl = document.querySelector(".sync-planning-card");
  if (syncPlanningCardEl instanceof HTMLElement) {
    syncPlanningCardEl.style.setProperty(
      "--sync-planning-scrollbar-shift",
      `${getPlanningMainScrollbarGutterWidth()}px`
    );
  }

  const boardEl = frameDocument.getElementById("charge-plan-board");
  if (!boardEl) {
    return false;
  }

  const styleId = "sync-expenses-planning-style";
  let styleEl = frameDocument.getElementById(styleId);
  if (!(styleEl instanceof frameDocument.defaultView.HTMLStyleElement)) {
    styleEl = frameDocument.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      body.planning-sync-embedded {
        --sync-planning-visible-width-adjustment: 0px;
        --sync-planning-reference-visible-width: 0px;
        --sync-planning-reference-day-width: 0px;
        --sync-planning-embedded-scroll-width: calc(
          100% - var(--sync-planning-visible-width-adjustment)
        );
        background: transparent !important;
      }

      body.planning-sync-embedded [data-sync-externalized="charge-plan-header"] {
        display: none !important;
      }

      body.planning-sync-embedded .main-content {
        padding: 0 !important;
        background: transparent !important;
      }

      body.planning-sync-embedded .container {
        width: 100% !important;
        max-width: none !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-helper {
        display: none !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-scroll {
        width: var(--sync-planning-embedded-scroll-width) !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-row--header {
        min-height: 0 !important;
        height: 0 !important;
        border: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-row--header > .charge-plan-cell {
        min-height: 0 !important;
        height: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        border: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-row--header .charge-plan-header-track {
        min-height: 0 !important;
        height: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-scroll {
        border-top: 0 !important;
        border-top-left-radius: 0 !important;
        border-top-right-radius: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-timeline {
        padding-top: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board {
        margin-bottom: 0 !important;
      }
    `;
    frameDocument.head.appendChild(styleEl);
  }

  const boardStyles = frameDocument.defaultView.getComputedStyle(boardEl);
  const fixedColumnsWidth =
    (parseFloat(boardStyles.getPropertyValue("--charge-plan-name-col-width")) || 150) +
    (parseFloat(boardStyles.getPropertyValue("--charge-plan-total-col-width")) || 100);
  const embeddedScrollEl = boardEl.querySelector(".charge-plan-scroll");
  const embeddedScrollStyles =
    embeddedScrollEl instanceof frameDocument.defaultView.HTMLElement
      ? frameDocument.defaultView.getComputedStyle(embeddedScrollEl)
      : null;
  const embeddedScrollBorderWidth =
    (parseFloat(embeddedScrollStyles?.borderLeftWidth || "0") || 0) +
    (parseFloat(embeddedScrollStyles?.borderRightWidth || "0") || 0);
  const mainPlanningVisibleWidthAdjustment = getPlanningMainVisibleWidthAdjustment(frameDocument);
  const mainPlanningReferenceVisibleWidth = getPlanningMainTimelineViewportWidth();
  const mainPlanningReferenceDayWidth = getPlanningMainReferenceDayWidth(
    getPlanningReferencePanelContext()
  );
  const embeddedScrollWidth = Math.max(
    280,
    fixedColumnsWidth + mainPlanningReferenceVisibleWidth + embeddedScrollBorderWidth
  );
  frameDocument.documentElement.style.setProperty(
    "--sync-planning-visible-width-adjustment",
    `${mainPlanningVisibleWidthAdjustment}px`
  );
  frameDocument.body.style.setProperty(
    "--sync-planning-visible-width-adjustment",
    `${mainPlanningVisibleWidthAdjustment}px`
  );
  frameDocument.documentElement.style.setProperty(
    "--sync-planning-reference-visible-width",
    `${mainPlanningReferenceVisibleWidth}px`
  );
  frameDocument.documentElement.style.setProperty(
    "--sync-planning-reference-day-width",
    `${mainPlanningReferenceDayWidth}px`
  );
  frameDocument.documentElement.style.setProperty(
    "--sync-planning-embedded-scroll-width",
    `${embeddedScrollWidth}px`
  );
  frameDocument.body.style.setProperty(
    "--sync-planning-reference-visible-width",
    `${mainPlanningReferenceVisibleWidth}px`
  );
  frameDocument.body.style.setProperty(
    "--sync-planning-reference-day-width",
    `${mainPlanningReferenceDayWidth}px`
  );
  frameDocument.body.style.setProperty(
    "--sync-planning-embedded-scroll-width",
    `${embeddedScrollWidth}px`
  );
  boardEl.style.setProperty(
    "--sync-planning-reference-visible-width",
    `${mainPlanningReferenceVisibleWidth}px`
  );
  boardEl.style.setProperty(
    "--sync-planning-reference-day-width",
    `${mainPlanningReferenceDayWidth}px`
  );
  boardEl.style.setProperty(
    "--sync-planning-embedded-scroll-width",
    `${embeddedScrollWidth}px`
  );

  const chargePlanHeaderEl = boardEl.previousElementSibling;
  if (chargePlanHeaderEl?.classList?.contains("table-header")) {
    chargePlanHeaderEl.setAttribute("data-sync-externalized", "charge-plan-header");
  }

  const measuredHeight = Math.max(
    620,
    Math.ceil(
      Math.max(
        frameDocument.documentElement.scrollHeight || 0,
        frameDocument.body.scrollHeight || 0,
        boardEl.scrollHeight || 0
      )
    )
  );

  if (expensesFrameEl instanceof HTMLIFrameElement) {
    expensesFrameEl.style.height = `${measuredHeight}px`;
    expensesFrameEl.style.minHeight = `${measuredHeight}px`;
  }

  const visibleWidthAdjustmentChanged =
    Number.isFinite(mainPlanningVisibleWidthAdjustment) &&
    (!Number.isFinite(lastExpensesVisibleWidthAdjustment) ||
      Math.abs(mainPlanningVisibleWidthAdjustment - lastExpensesVisibleWidthAdjustment) > 0.25);
  const referenceVisibleWidthChanged =
    Number.isFinite(mainPlanningReferenceVisibleWidth) &&
    (!Number.isFinite(lastExpensesReferenceVisibleWidth) ||
      Math.abs(mainPlanningReferenceVisibleWidth - lastExpensesReferenceVisibleWidth) > 0.25);

  if (visibleWidthAdjustmentChanged) {
    lastExpensesVisibleWidthAdjustment = mainPlanningVisibleWidthAdjustment;
  }

  if (referenceVisibleWidthChanged) {
    lastExpensesReferenceVisibleWidth = mainPlanningReferenceVisibleWidth;
  }

  if (visibleWidthAdjustmentChanged || referenceVisibleWidthChanged) {

    if (!expensesVisibleWidthAdjustmentRerenderPending && expensesApi?.applyViewport) {
      expensesVisibleWidthAdjustmentRerenderPending = true;
      requestAnimationFrame(() => {
        try {
          const viewportToReapply =
            sharedViewportState || expensesApi.getViewport?.() || getCurrentSharedViewport() || null;
          if (viewportToReapply) {
            expensesApi.applyViewport(viewportToReapply);
          }
          schedulePlanningLayoutDebug("expenses-width-adjustment");
        } finally {
          window.setTimeout(() => {
            expensesVisibleWidthAdjustmentRerenderPending = false;
            scheduleExpensesFramePresentation(1);
          }, 0);
        }
      });
    }
  }

  requestAnimationFrame(() => {
    if (calibrateExpensesViewportPixelOffset(frameDocument)) {
      scheduleExpensesFramePresentation(1);
    }
  });

  expensesFrameEl?.classList.add("is-ready");
  schedulePlanningLayoutDebug("expenses-presentation");
  return true;
}

function scheduleExpensesFramePresentation(attempt = 0) {
  window.clearTimeout(expensesFramePresentationTimer);
  expensesFramePresentationTimer = window.setTimeout(() => {
    const applied = ensureExpensesFramePresentation();
    if (applied || attempt >= 20) {
      expensesFrameEl?.classList.add("is-ready");
      return;
    }

    scheduleExpensesFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}

function ensureExpensesChartFramePresentation() {
  const frameDocument = expensesChartFrameEl?.contentDocument;
  if (!frameDocument) {
    return false;
  }

  const measuredHeight = Math.max(
    360,
    Math.ceil(
      Math.max(
        frameDocument.documentElement?.scrollHeight || 0,
        frameDocument.body?.scrollHeight || 0
      )
    )
  );

  if (expensesChartFrameEl instanceof HTMLIFrameElement) {
    expensesChartFrameEl.style.height = `${measuredHeight}px`;
    expensesChartFrameEl.style.minHeight = `${measuredHeight}px`;
  }

  return true;
}

function scheduleExpensesChartFramePresentation(attempt = 0) {
  window.clearTimeout(expensesChartFramePresentationTimer);
  expensesChartFramePresentationTimer = window.setTimeout(() => {
    const applied = ensureExpensesChartFramePresentation();
    if (applied || attempt >= 20) {
      return;
    }

    scheduleExpensesChartFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}

function getPlanningMainScrollbarGutterWidth() {
  const planningDocument = planningFrameEl?.contentDocument;
  const planningWindow = planningFrameEl?.contentWindow;
  if (!planningDocument || !planningWindow) {
    return 0;
  }

  const wrapper = planningDocument.getElementById("timelineWrapper");
  if (!(wrapper instanceof planningWindow.HTMLElement)) {
    return 0;
  }

  const rectWidth = Number(wrapper.getBoundingClientRect?.().width || 0);
  const clientWidth = Number(wrapper.clientWidth || 0);
  const offsetWidth = Number(wrapper.offsetWidth || 0);
  const gutterWidth = Math.max(0, rectWidth - clientWidth, offsetWidth - clientWidth);

  return Math.round(gutterWidth * 100) / 100;
}

function getPlanningReferencePanelContext() {
  const axisDocument = planningAxisFrameEl?.contentDocument;
  const axisWindow = planningAxisFrameEl?.contentWindow;
  const axisTopPanel = axisDocument?.querySelector("#planningTimeline .vis-panel.vis-top");
  if (
    planningAxisFrameEl &&
    axisDocument &&
    axisWindow &&
    axisTopPanel instanceof axisWindow.HTMLElement
  ) {
    return {
      frameEl: planningAxisFrameEl,
      document: axisDocument,
      window: axisWindow,
      panelEl: axisTopPanel,
      panelKind: "top",
    };
  }

  const planningDocument = planningFrameEl?.contentDocument;
  const planningWindow = planningFrameEl?.contentWindow;
  const planningCenterPanel = planningDocument?.querySelector("#planningTimeline .vis-panel.vis-center");
  if (
    planningFrameEl &&
    planningDocument &&
    planningWindow &&
    planningCenterPanel instanceof planningWindow.HTMLElement
  ) {
    return {
      frameEl: planningFrameEl,
      document: planningDocument,
      window: planningWindow,
      panelEl: planningCenterPanel,
      panelKind: "center",
    };
  }

  return null;
}

function getPlanningReferenceViewportState() {
  const referencePlanningApi = getReferencePlanningApi();
  if (referencePlanningApi?.getViewport) {
    try {
      const viewport = referencePlanningApi.getViewport();
      if (viewport) {
        return viewport;
      }
    } catch (error) {
      console.warn("[sync] impossible de lire le viewport de reference", error);
    }
  }

  return null;
}

function getPlanningMainExactVisibleDaySpan() {
  const viewport = getPlanningReferenceViewportState();
  const windowStartMs = parseSharedExactNumber(viewport?.windowStartMs);
  const windowEndMs = parseSharedExactNumber(viewport?.windowEndMs);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return Number.NaN;
  }

  return (windowEndMs - windowStartMs) / DAY_IN_MS;
}

function getMedianLayoutMetric(values = []) {
  const numericValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!numericValues.length) {
    return 0;
  }

  const middleIndex = Math.floor(numericValues.length / 2);
  if (numericValues.length % 2 === 1) {
    return numericValues[middleIndex];
  }

  return (numericValues[middleIndex - 1] + numericValues[middleIndex]) / 2;
}

function getPlanningReferenceDayBoundaryPositions() {
  const referencePanelContext = getPlanningReferencePanelContext();
  if (!referencePanelContext || referencePanelContext.panelKind !== "top") {
    return [];
  }

  const { document: planningDocument, window: planningWindow, panelEl } = referencePanelContext;
  const topPanelRect = panelEl.getBoundingClientRect();
  return Array.from(
    planningDocument.querySelectorAll(
      "#planningTimeline .vis-panel.vis-top .vis-time-axis .vis-grid.vis-minor"
    )
  )
    .map((gridLineEl) =>
      gridLineEl instanceof planningWindow.HTMLElement ? gridLineEl.getBoundingClientRect().left : Number.NaN
    )
    .filter(
      (left) =>
        Number.isFinite(left) &&
        left >= topPanelRect.left - 0.5 &&
        left <= topPanelRect.right + 0.5
    )
    .sort((a, b) => a - b);
}

function getPlanningMainReferenceDayWidth(referencePanelContext = null) {
  if (!referencePanelContext || referencePanelContext.panelKind !== "top") {
    return 0;
  }

  const { document: planningDocument, window: planningWindow, panelEl } = referencePanelContext;
  if (!(panelEl instanceof planningWindow.HTMLElement)) {
    return 0;
  }

  const topPanelRect = panelEl.getBoundingClientRect();
  const gridLinePositions = Array.from(
    planningDocument.querySelectorAll(
      "#planningTimeline .vis-panel.vis-top .vis-time-axis .vis-grid.vis-minor"
    )
  )
    .map((gridLineEl) =>
      gridLineEl instanceof planningWindow.HTMLElement ? gridLineEl.getBoundingClientRect().left : Number.NaN
    )
    .filter(
      (left) =>
        Number.isFinite(left) &&
        left >= topPanelRect.left - 1 &&
        left <= topPanelRect.right + 1
    )
    .sort((a, b) => a - b);

  if (gridLinePositions.length < 2) {
    return 0;
  }

  const candidateDiffs = [];
  for (let index = 1; index < gridLinePositions.length; index += 1) {
    const diff = gridLinePositions[index] - gridLinePositions[index - 1];
    if (diff > 2) {
      candidateDiffs.push(diff);
    }
  }

  const medianDayWidth = getMedianLayoutMetric(candidateDiffs);
  return medianDayWidth > 0 ? Math.round(medianDayWidth * 1000) / 1000 : 0;
}

function getExpensesVisibleDayBoundaryPositions(expensesFrameDocument = null) {
  const expensesDocument = expensesFrameDocument || expensesFrameEl?.contentDocument;
  const expensesWindow = expensesFrameEl?.contentWindow;
  if (!expensesDocument || !expensesWindow) {
    return [];
  }

  const expensesScrollEl = expensesDocument.querySelector("#charge-plan-board .charge-plan-scroll");
  const firstTrackGrid = expensesDocument.querySelector(
    "#charge-plan-board .charge-plan-row:not(.charge-plan-row--header):not(.charge-plan-row--total) .charge-plan-track-grid"
  );
  if (
    !(expensesScrollEl instanceof expensesWindow.HTMLElement) ||
    !(firstTrackGrid instanceof expensesWindow.HTMLElement)
  ) {
    return [];
  }

  const scrollRect = expensesScrollEl.getBoundingClientRect();
  return Array.from(firstTrackGrid.querySelectorAll(".charge-plan-grid-day"))
    .map((dayEl) =>
      dayEl instanceof expensesWindow.HTMLElement ? dayEl.getBoundingClientRect().left : Number.NaN
    )
    .filter(
      (left) =>
        Number.isFinite(left) &&
        left >= scrollRect.left - 0.5 &&
        left <= scrollRect.right + 0.5
    )
    .sort((a, b) => a - b);
}

function calibrateExpensesViewportPixelOffset(expensesFrameDocument = null) {
  if (!expensesApi?.nudgeViewportByPixels) {
    return false;
  }

  const referencePositions = getPlanningReferenceDayBoundaryPositions();
  const expensesPositions = getExpensesVisibleDayBoundaryPositions(expensesFrameDocument);
  const pairCount = Math.min(referencePositions.length, expensesPositions.length, 6);
  if (pairCount < 2) {
    return false;
  }

  const deltas = [];
  for (let index = 0; index < pairCount; index += 1) {
    deltas.push(expensesPositions[index] - referencePositions[index]);
  }

  const alignmentDelta = getMedianLayoutMetric(deltas);
  if (!Number.isFinite(alignmentDelta) || Math.abs(alignmentDelta) <= 0.6 || Math.abs(alignmentDelta) > 16) {
    lastExpensesPixelAlignmentDelta = Number.NaN;
    return false;
  }

  if (
    Number.isFinite(lastExpensesPixelAlignmentDelta) &&
    Math.abs(lastExpensesPixelAlignmentDelta - alignmentDelta) <= 0.2
  ) {
    return false;
  }

  lastExpensesPixelAlignmentDelta = alignmentDelta;
  return Boolean(expensesApi.nudgeViewportByPixels(alignmentDelta));
}

function getPlanningMainTimelineViewportMetrics(expensesFrameDocument = null) {
  const expensesDocument = expensesFrameDocument || expensesFrameEl?.contentDocument;
  const expensesWindow = expensesFrameEl?.contentWindow;
  const referencePanelContext = getPlanningReferencePanelContext();
  if (!referencePanelContext || !expensesDocument || !expensesWindow) {
    return null;
  }

  const expensesBoard = expensesDocument.getElementById("charge-plan-board");
  const expensesScrollEl = expensesDocument.querySelector("#charge-plan-board .charge-plan-scroll");
  if (
    !(expensesBoard instanceof expensesWindow.HTMLElement) ||
    !(expensesScrollEl instanceof expensesWindow.HTMLElement)
  ) {
    return null;
  }

  const planningPanelEl = referencePanelContext.panelEl;
  const planningFrameRect = referencePanelContext.frameEl.getBoundingClientRect();
  const expensesFrameRect = expensesFrameEl.getBoundingClientRect();
  const planningPanelRect = planningPanelEl.getBoundingClientRect();
  const expensesScrollRect = expensesScrollEl.getBoundingClientRect();
  const boardStyles = expensesWindow.getComputedStyle(expensesBoard);
  const nameWidth = parseFloat(boardStyles.getPropertyValue("--charge-plan-name-col-width"));
  const totalWidth = parseFloat(boardStyles.getPropertyValue("--charge-plan-total-col-width"));
  const fixedColumnsWidth =
    (Number.isFinite(nameWidth) ? nameWidth : 150) + (Number.isFinite(totalWidth) ? totalWidth : 100);
  const planningViewportWidth = Math.max(
    0,
    Number(planningPanelEl.clientWidth) || Number(planningPanelRect.width) || 0
  );
  const planningExactVisibleDaySpan = getPlanningMainExactVisibleDaySpan();
  const planningReferenceDayWidth = getPlanningMainReferenceDayWidth(referencePanelContext);
  const planningReferenceViewportWidth =
    Number.isFinite(planningReferenceDayWidth) &&
    planningReferenceDayWidth > 0 &&
    Number.isFinite(planningExactVisibleDaySpan) &&
    planningExactVisibleDaySpan > 0
      ? planningReferenceDayWidth * planningExactVisibleDaySpan
      : planningViewportWidth;
  const expensesScrollContentWidth = Math.max(
    0,
    Number(expensesScrollEl.clientWidth) || Number(expensesScrollRect.width) || 0
  );
  const expensesTimelineViewportWidth = Math.max(0, expensesScrollContentWidth - fixedColumnsWidth);
  const planningContentLeft =
    planningFrameRect.left +
    planningPanelRect.left +
    Number(planningPanelEl.clientLeft || 0);
  const planningContentRight = planningContentLeft + planningReferenceViewportWidth;
  const expensesTimelineContentLeft =
    expensesFrameRect.left +
    expensesScrollRect.left +
    Number(expensesScrollEl.clientLeft || 0) +
    fixedColumnsWidth;
  const expensesContentRight =
    expensesTimelineContentLeft + expensesTimelineViewportWidth;

  return {
    planningViewportWidth,
    planningReferenceViewportWidth,
    planningReferenceDayWidth,
    planningExactVisibleDaySpan,
    expensesTimelineViewportWidth,
    planningContentRight,
    expensesContentRight,
  };
}

function getPlanningMainTimelineViewportWidth() {
  const metrics = getPlanningMainTimelineViewportMetrics();
  return metrics ? Math.round(metrics.planningReferenceViewportWidth * 100) / 100 : 0;
}

function getPlanningMainVisibleWidthAdjustment(expensesFrameDocument = null) {
  const metrics = getPlanningMainTimelineViewportMetrics(expensesFrameDocument);
  if (!metrics) {
    return 0;
  }

  const rightDelta = metrics.expensesContentRight - metrics.planningContentRight;
  const widthDelta =
    metrics.expensesTimelineViewportWidth - metrics.planningReferenceViewportWidth;
  const adjustment = Math.max(0, rightDelta, widthDelta);

  return Math.round(adjustment * 100) / 100;
}

function shiftViewportByMode(viewport = {}, direction = 1) {
  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  const baseDateValue =
    normalizeIsoDate(canonicalViewport.firstVisibleDate) ||
    normalizeIsoDate(canonicalViewport.rangeStartDate);
  if (!baseDateValue) {
    return canonicalViewport;
  }

  const baseDate = new Date(`${baseDateValue}T12:00:00`);
  if (Number.isNaN(baseDate.getTime())) {
    return canonicalViewport;
  }

  const safeDirection = direction >= 0 ? 1 : -1;
  const nextDate = new Date(baseDate);
  const mode = String(canonicalViewport.mode || "").trim();

  if (mode === "week") {
    nextDate.setDate(nextDate.getDate() + safeDirection * 7);
  } else if (mode === "month") {
    nextDate.setMonth(nextDate.getMonth() + safeDirection);
  } else if (mode === "year") {
    nextDate.setFullYear(nextDate.getFullYear() + safeDirection);
  } else {
    nextDate.setDate(nextDate.getDate() + safeDirection * canonicalViewport.visibleDays);
  }

  const nextDateValue = normalizeIsoDate(
    `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(
      nextDate.getDate()
    ).padStart(2, "0")}`
  );

  return buildCanonicalSharedViewport({
    ...canonicalViewport,
    anchorDate: nextDateValue,
    firstVisibleDate: nextDateValue,
    rangeStartDate: nextDateValue,
    rangeEndDate: "",
  });
}

function bindExpensesPlanningShellControls() {
  expensesModeButtons.forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const nextMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
      if (!nextMode) {
        return;
      }

      if (planningAxisApi?.setZoomMode) {
        planningAxisApi.setZoomMode(nextMode);
        return;
      }

      const currentViewport = getCurrentSharedViewport();
      if (!currentViewport) {
        return;
      }

      void applyViewportFromParentControls({
        ...currentViewport,
        mode: nextMode,
        visibleDays: getTargetVisibleDaysForMode(nextMode, currentViewport),
        rangeEndDate: "",
      });
    });
  });

  sharedPrevBtnEl?.addEventListener("click", () => {
    if (planningAxisApi?.moveViewportByMode) {
      planningAxisApi.moveViewportByMode(-1);
      return;
    }

    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    void applyViewportFromParentControls(shiftViewportByMode(currentViewport, -1));
  });

  sharedCenterBtnEl?.addEventListener("click", () => {
    if (planningAxisApi?.focusDataAnchor) {
      planningAxisApi.focusDataAnchor();
      return;
    }

    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    void applyViewportFromParentControls(currentViewport);
  });

  sharedNextBtnEl?.addEventListener("click", () => {
    if (planningAxisApi?.moveViewportByMode) {
      planningAxisApi.moveViewportByMode(1);
      return;
    }

    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    void applyViewportFromParentControls(shiftViewportByMode(currentViewport, 1));
  });

  window.addEventListener("resize", () => {
    syncExpensesPlanningShell();
    scheduleExpensesFramePresentation();
    scheduleExpensesChartFramePresentation();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncExpensesPlanningShell();
      scheduleExpensesFramePresentation();
      scheduleExpensesChartFramePresentation();
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForFrameLoad(frameEl) {
  if (!(frameEl instanceof HTMLIFrameElement)) {
    throw new Error("Iframe introuvable.");
  }

  if (frameEl.contentWindow?.document?.readyState === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      frameEl.removeEventListener("load", handleLoad);
      reject(new Error(`Timeout chargement iframe ${frameEl.id}`));
    }, 30000);

    function handleLoad() {
      window.clearTimeout(timeoutId);
      resolve();
    }

    frameEl.addEventListener("load", handleLoad, { once: true });
  });
}

async function waitForChildApi(frameEl, apiName, timeoutMs = 30000) {
  await waitForFrameLoad(frameEl);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const api = frameEl.contentWindow?.[apiName];
    if (api?.isReady) {
      return api;
    }
    await sleep(120);
  }

  throw new Error(`API ${apiName} indisponible.`);
}

function getLateAttachReferenceViewport() {
  const referencePlanningApi = getReferencePlanningApi() || planningApi;
  const baseViewport =
    sharedViewportState ||
    referencePlanningApi?.getViewport?.() ||
    planningApi?.getViewport?.() ||
    null;

  return baseViewport ? buildCanonicalSharedViewport(baseViewport) : null;
}

async function attachExpensesFrameApi({ force = false } = {}) {
  if (!(expensesFrameEl instanceof HTMLIFrameElement)) {
    return null;
  }

  if (!force && expensesFrameAttachPromise) {
    return expensesFrameAttachPromise;
  }

  const attachAttempt = ++expensesFrameAttachAttempt;
  expensesFrameAttachPromise = waitForChildApi(expensesFrameEl, "__gestionDepenses2PlanningSyncApi")
    .then(async (api) => {
      if (attachAttempt !== expensesFrameAttachAttempt) {
        return api;
      }

      expensesApi = api;
      scheduleExpensesFramePresentation();

      const targetProjectKey = getDesiredProjectKey();
      if (targetProjectKey) {
        await Promise.resolve(api.setSelectedProject(targetProjectKey));
      }

      let referenceViewport = getLateAttachReferenceViewport();
      if (referenceViewport?.firstVisibleDate) {
        syncPlanningViewportBounds(referenceViewport);
        const stabilizedViewport = await alignExpensesViewportToPlanning(referenceViewport);
        if (stabilizedViewport?.firstVisibleDate) {
          referenceViewport = buildCanonicalSharedViewport({
            ...referenceViewport,
            ...stabilizedViewport,
          });
        }

        sharedViewportState = referenceViewport;
        lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
          targetProjectKey || activeProjectKey,
          referenceViewport
        );
        syncExpensesPlanningShell(referenceViewport);
        setLastRange(referenceViewport);
      }

      scheduleExpensesFramePresentation();

      if (expensesViewportSubscriptionApi !== api) {
        api.subscribeViewportChange(handleViewportChange);
        expensesViewportSubscriptionApi = api;
      }

      if (!projectSyncInProgress && pendingViewportPayload) {
        void flushViewportSyncQueue();
      }

      return api;
    })
    .catch((error) => {
      if (attachAttempt === expensesFrameAttachAttempt) {
        console.error("Erreur attache du planning gestion-depenses2 :", error);
      }
      return null;
    })
    .finally(() => {
      if (attachAttempt === expensesFrameAttachAttempt) {
        expensesFrameAttachPromise = null;
      }
    });

  return expensesFrameAttachPromise;
}

async function attachExpensesChartFrameApi({ force = false } = {}) {
  if (!(expensesChartFrameEl instanceof HTMLIFrameElement)) {
    return null;
  }

  if (!force && expensesChartFrameAttachPromise) {
    return expensesChartFrameAttachPromise;
  }

  const attachAttempt = ++expensesChartFrameAttachAttempt;
  expensesChartFrameAttachPromise = waitForChildApi(
    expensesChartFrameEl,
    "__gestionDepenses2PlanningSyncApi"
  )
    .then(async (api) => {
      if (attachAttempt !== expensesChartFrameAttachAttempt) {
        return api;
      }

      expensesChartApi = api;
      const targetProjectKey = getDesiredProjectKey();
      if (targetProjectKey) {
        await Promise.resolve(api.setSelectedProject(targetProjectKey));
      }

      scheduleExpensesChartFramePresentation();
      return api;
    })
    .catch((error) => {
      if (attachAttempt === expensesChartFrameAttachAttempt) {
        console.error("Erreur attache du graphique des depenses :", error);
      }
      return null;
    })
    .finally(() => {
      if (attachAttempt === expensesChartFrameAttachAttempt) {
        expensesChartFrameAttachPromise = null;
      }
    });

  return expensesChartFrameAttachPromise;
}

function renderProjectOptions(projectKeys) {
  if (!(projectSelectEl instanceof HTMLSelectElement)) {
    return;
  }

  projectSelectEl.innerHTML = "";

  const placeholderOptionEl = document.createElement("option");
  placeholderOptionEl.value = "";
  placeholderOptionEl.textContent = "Choisir un projet";
  projectSelectEl.appendChild(placeholderOptionEl);

  projectKeys.forEach((projectKey) => {
    const optionEl = document.createElement("option");
    optionEl.value = projectKey;
    optionEl.textContent = projectKey;
    projectSelectEl.appendChild(optionEl);
  });

  projectSelectEl.disabled = projectKeys.length === 0;
}

async function applySharedProject(projectKey) {
  const normalizedProjectKey = String(projectKey || "").trim();
  if (!normalizedProjectKey || !planningApi) {
    return;
  }

  requestedProjectKey = normalizedProjectKey;
  projectSyncInProgress = true;
  pendingViewportPayload = null;
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);

  try {
    const projectApplyCalls = [
      Promise.resolve(planningApi.setSelectedProject(normalizedProjectKey)),
      Promise.resolve(planningAxisApi?.setSelectedProject?.(normalizedProjectKey)),
    ];

    if (expensesApi?.setSelectedProject) {
      projectApplyCalls.push(Promise.resolve(expensesApi.setSelectedProject(normalizedProjectKey)));
    }

    if (expensesChartApi?.setSelectedProject) {
      projectApplyCalls.push(
        Promise.resolve(expensesChartApi.setSelectedProject(normalizedProjectKey))
      );
    }

    await Promise.all(projectApplyCalls);
    activeProjectKey = normalizedProjectKey;
    scheduleExpensesFramePresentation();
    scheduleExpensesChartFramePresentation();
    const referencePlanningApi = getReferencePlanningApi() || planningApi;
    const planningProjectDateBounds =
      referencePlanningApi.getProjectDateBounds?.() || planningApi.getProjectDateBounds?.() || null;
    const expensesProjectDateBounds = expensesApi?.getProjectDateBounds?.() || null;
    let sharedViewport = buildProjectSelectionViewport(
      buildSharedProjectDateBounds({
        planningDateBounds: planningProjectDateBounds,
        expensesDateBounds: expensesProjectDateBounds,
      }),
      expensesApi?.getViewport?.() ||
        referencePlanningApi.getViewport?.() ||
        planningApi.getViewport?.() ||
        {}
    );
    if (sharedViewport?.firstVisibleDate) {
      const initialViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        sharedViewport
      );
      syncPlanningViewportBounds(sharedViewport);
      await Promise.all([
        Promise.resolve(planningApi.applyViewport(sharedViewport)),
        Promise.resolve(planningAxisApi?.applyViewport?.(sharedViewport)),
      ]);

      await sleep(180);
      const planningViewportAfterSelection = referencePlanningApi.getViewport?.() || null;
      const stabilizedPlanningViewport = buildCanonicalSharedViewport({
        ...sharedViewport,
        ...(planningViewportAfterSelection || {}),
        firstVisibleDate:
          planningViewportAfterSelection?.firstVisibleDate ||
          planningViewportAfterSelection?.rangeStartDate ||
          sharedViewport.firstVisibleDate,
        rangeStartDate:
          planningViewportAfterSelection?.firstVisibleDate ||
          planningViewportAfterSelection?.rangeStartDate ||
          sharedViewport.rangeStartDate,
        visibleDays:
          Number(planningViewportAfterSelection?.visibleDays) || sharedViewport.visibleDays,
        mode: String(planningViewportAfterSelection?.mode || sharedViewport.mode || "").trim(),
        anchorDate:
          planningViewportAfterSelection?.anchorDate ||
          planningViewportAfterSelection?.firstVisibleDate ||
          sharedViewport.anchorDate,
      });
      const stabilizedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        stabilizedPlanningViewport
      );

      sharedViewport = stabilizedPlanningViewport;
      if (
        stabilizedViewportLogicalSignature &&
        stabilizedViewportLogicalSignature !== initialViewportLogicalSignature
      ) {
        syncPlanningViewportBounds(sharedViewport);
        await Promise.all([
          Promise.resolve(planningApi.applyViewport(sharedViewport)),
          Promise.resolve(planningAxisApi?.applyViewport?.(sharedViewport)),
        ]);
      }

      if (expensesApi) {
        const stabilizedViewport = await alignExpensesViewportToPlanning(sharedViewport);
        if (stabilizedViewport?.firstVisibleDate) {
          sharedViewport = buildCanonicalSharedViewport({
            ...sharedViewport,
            ...stabilizedViewport,
          });
        }
      }

      lastAppliedViewportLogicalSignature = getViewportLogicalSignature(
        normalizedProjectKey,
        sharedViewport
      );
      sharedViewportState = sharedViewport;
      setLastRange(sharedViewport);
      syncExpensesPlanningShell(sharedViewport);
      scheduleExpensesFramePresentation();
    }

    if (projectSelectEl instanceof HTMLSelectElement) {
      projectSelectEl.value = normalizedProjectKey;
    }

    setLastSource(getViewportSourceLabel("Pilotage commun"));
    setHubStatus(`Projet synchronise : ${normalizedProjectKey}`);
    appendLog(`Projet partage applique : ${normalizedProjectKey}`);
  } finally {
    projectSyncInProgress = false;
    void flushViewportSyncQueue();
  }
}

async function flushViewportSyncQueue() {
  if (projectSyncInProgress || viewportSyncInProgress || !pendingViewportPayload) {
    return;
  }

  const payload = pendingViewportPayload;
  pendingViewportPayload = null;
  const payloadProjectKey = String(payload.projectKey || "").trim();
  if (
    activeProjectKey &&
    payloadProjectKey &&
    normalizeProjectKey(payloadProjectKey) !== normalizeProjectKey(activeProjectKey)
  ) {
    void flushViewportSyncQueue();
    return;
  }

  const sourceApi = getViewportSourceApi(payload.app);
  const targetApis = getViewportTargetApis(payload.app);
  if (targetApis.length === 0) {
    void flushViewportSyncQueue();
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(payload.viewport);
  const exactSharedViewport = buildPlanningExactSharedViewport(payload.viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportLogicalSignature = getViewportLogicalSignature(
    payloadProjectKey,
    canonicalViewport
  );
  if (
    viewportLogicalSignature &&
    viewportLogicalSignature === lastAppliedViewportLogicalSignature
  ) {
    sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    void flushViewportSyncQueue();
    return;
  }

  viewportSyncInProgress = true;

  try {
    const sourceLogicalSignature = getViewportLogicalSignature(
      payloadProjectKey,
      payload.viewport
    );
    const getViewportForApi = () => exactSharedViewport;
    const applyCalls = targetApis.map((api) =>
      Promise.resolve(api.applyViewport(getViewportForApi(api)))
    );

    if (sourceApi && sourceLogicalSignature !== viewportLogicalSignature) {
      applyCalls.push(Promise.resolve(sourceApi.applyViewport(getViewportForApi(sourceApi))));
    }

    await Promise.all(applyCalls);
    lastAppliedViewportLogicalSignature = viewportLogicalSignature;
    sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    setLastSource(getViewportSourceLabel(payload.app));
    setLastRange(canonicalViewport);
    setHubStatus(`Synchro active depuis ${getViewportSourceLabel(payload.app)}`);
    appendLog(
      `${getViewportSourceLabel(payload.app)} -> ${canonicalViewport.firstVisibleDate || "?"} / ${
        canonicalViewport.rangeEndDate || "?"
      } / ${canonicalViewport.mode || "?"}`
    );
  } catch (error) {
    console.error("Erreur synchro viewport :", error);
    setHubStatus(`Erreur synchro : ${error.message}`);
    appendLog(`Erreur synchro viewport : ${error.message}`);
  } finally {
    viewportSyncInProgress = false;
    if (pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

function handleViewportChange(payload) {
  if (!payload || projectSyncInProgress) {
    return;
  }

  pendingViewportPayload = payload;
  void flushViewportSyncQueue();
}

async function bootstrap() {
  try {
    if (window.grist && typeof window.grist.ready === "function") {
      window.grist.ready({ requiredAccess: "full" });
    }

    setHubStatus("Connexion aux plannings...");

    [planningApi, planningAxisApi] = await Promise.all([
      waitForChildApi(planningFrameEl, "__planningProjetSyncApi"),
      waitForChildApi(planningAxisFrameEl, "__planningProjetSyncApi"),
    ]);
    bindExpensesPlanningShellControls();
    scheduleExpensesFramePresentation();
    scheduleExpensesChartFramePresentation();
    bindPlanningLayoutDebug();

    expensesFrameEl?.addEventListener("load", () => {
      scheduleExpensesFramePresentation();
      schedulePlanningLayoutDebug("expenses-frame-load");
      void attachExpensesFrameApi();
    });
    expensesChartFrameEl?.addEventListener("load", () => {
      scheduleExpensesChartFramePresentation();
      void attachExpensesChartFrameApi();
    });
    planningFrameEl?.addEventListener("load", () => {
      scheduleExpensesFramePresentation();
      bindPlanningLayoutDebug();
      schedulePlanningLayoutDebug("planning-frame-load");
    });

    const planningProjects = (planningApi.listProjects?.() || []).filter(Boolean);
    renderProjectOptions(planningProjects);
    setExpensesPlanningControlsDisabled(planningProjects.length === 0);

    const initialProject =
      String(planningApi.getSelectedProject?.() || "").trim() ||
      planningProjects[0] ||
      "";

    planningApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-main" })
    );
    planningAxisApi.subscribeViewportChange((payload) =>
      handleViewportChange({ ...payload, app: "planning-projet-axis" })
    );

    if (projectSelectEl instanceof HTMLSelectElement) {
      projectSelectEl.disabled = planningProjects.length === 0;
      projectSelectEl.addEventListener("change", () => {
        applySharedProject(projectSelectEl.value).catch((error) => {
          console.error(error);
          setHubStatus(`Erreur projet : ${error.message}`);
          appendLog(`Erreur projet : ${error.message}`);
        });
      });
    }

    if (initialProject) {
      await applySharedProject(initialProject);
    } else {
      setHubStatus("Aucun projet disponible.");
    }

    void attachExpensesFrameApi();
    schedulePlanningLayoutDebug("bootstrap-ready");
  } catch (error) {
    console.error("Erreur synchronisation plannings :", error);
    setHubStatus(`Erreur : ${error.message}`);
    appendLog(`Erreur initialisation : ${error.message}`);
  }
}

clearLogBtn?.addEventListener("click", () => {
  if (logEl) {
    logEl.textContent = "En attente d'activite...";
  }
});

applyPlanningFrameHeight(getStoredPlanningFrameHeight(), {
  persist: false,
  refresh: false,
});
bindPlanningFrameResizeHandle();
bootstrap();
