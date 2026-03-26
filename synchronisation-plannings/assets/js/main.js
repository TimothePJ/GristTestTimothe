const planningFrameEl = document.getElementById("planning-projet-frame");
const planningAxisFrameEl = document.getElementById("planning-projet-axis-frame");
const expensesFrameEl = document.getElementById("gestion-depenses2-frame");
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

let planningApi = null;
let planningAxisApi = null;
let expensesApi = null;
let activeProjectKey = "";
let projectSyncInProgress = false;
let viewportSyncInProgress = false;
let pendingViewportPayload = null;
let lastAppliedViewportLogicalSignature = "";
let sharedViewportState = null;
let expensesFramePresentationTimer = 0;
let lastExpensesVisibleWidthAdjustment = Number.NaN;
let expensesVisibleWidthAdjustmentRerenderPending = false;
let planningLayoutDebugRafId = 0;
let planningLayoutDebugCleanup = null;
let lastPlanningLayoutDebugSignature = "";
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

function getViewportLogicalSignature(projectKey, viewport = {}) {
  const normalizedProjectKey = normalizeProjectKey(projectKey || activeProjectKey || "");
  const rangeStartDate = String(viewport?.firstVisibleDate || viewport?.rangeStartDate || "").trim();
  const mode = String(viewport?.mode || "").trim();
  const visibleDays = Number(viewport?.visibleDays);

  return [
    normalizedProjectKey,
    rangeStartDate,
    mode,
    Number.isFinite(visibleDays) ? Math.round(visibleDays) : "",
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

  if (!normalizedPlanningBounds) {
    return normalizedExpensesBounds;
  }

  if (!normalizedExpensesBounds) {
    return normalizedPlanningBounds;
  }

  const startDate = normalizedExpensesBounds.startDate || normalizedPlanningBounds.startDate;
  const endDateCandidates = [normalizedPlanningBounds.endDate, normalizedExpensesBounds.endDate]
    .filter(Boolean)
    .sort();
  const endDate = endDateCandidates.length
    ? endDateCandidates[endDateCandidates.length - 1]
    : "";

  if (!startDate || !endDate) {
    return normalizedExpensesBounds || normalizedPlanningBounds;
  }

  return {
    startDate,
    endDate,
    spanDays: getInclusiveDaySpan(startDate, endDate),
  };
}

function buildProjectSelectionViewport(projectDateBounds = null, fallbackViewport = {}) {
  const fallbackSharedViewport = buildCanonicalSharedViewport(fallbackViewport);
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
  if (!planningApi || !expensesApi || projectSyncInProgress || viewportSyncInProgress) {
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportLogicalSignature = getViewportLogicalSignature(activeProjectKey, canonicalViewport);
  viewportSyncInProgress = true;

  try {
    await Promise.all([
      Promise.resolve(planningApi.applyViewport(canonicalViewport)),
      Promise.resolve(planningAxisApi?.applyViewport?.(canonicalViewport)),
      Promise.resolve(expensesApi.applyViewport(canonicalViewport)),
    ]);

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
        width: calc(100% - var(--sync-planning-visible-width-adjustment)) !important;
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

  const mainPlanningVisibleWidthAdjustment = getPlanningMainVisibleWidthAdjustment(frameDocument);
  frameDocument.documentElement.style.setProperty(
    "--sync-planning-visible-width-adjustment",
    `${mainPlanningVisibleWidthAdjustment}px`
  );
  frameDocument.body.style.setProperty(
    "--sync-planning-visible-width-adjustment",
    `${mainPlanningVisibleWidthAdjustment}px`
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

  if (
    Number.isFinite(mainPlanningVisibleWidthAdjustment) &&
    Math.abs(mainPlanningVisibleWidthAdjustment - lastExpensesVisibleWidthAdjustment) > 0.25
  ) {
    lastExpensesVisibleWidthAdjustment = mainPlanningVisibleWidthAdjustment;

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

function getPlanningMainVisibleWidthAdjustment(expensesFrameDocument = null) {
  const planningDocument = planningFrameEl?.contentDocument;
  const planningWindow = planningFrameEl?.contentWindow;
  const expensesDocument = expensesFrameDocument || expensesFrameEl?.contentDocument;
  const expensesWindow = expensesFrameEl?.contentWindow;
  if (!planningDocument || !planningWindow || !expensesDocument || !expensesWindow) {
    return 0;
  }

  const centerPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-center");
  const expensesBoard = expensesDocument.getElementById("charge-plan-board");
  const expensesScrollEl = expensesDocument.querySelector("#charge-plan-board .charge-plan-scroll");
  if (
    !(centerPanel instanceof planningWindow.HTMLElement) ||
    !(expensesBoard instanceof expensesWindow.HTMLElement) ||
    !(expensesScrollEl instanceof expensesWindow.HTMLElement)
  ) {
    return 0;
  }

  const planningFrameRect = planningFrameEl.getBoundingClientRect();
  const expensesFrameRect = expensesFrameEl.getBoundingClientRect();
  const planningCenterRect = centerPanel.getBoundingClientRect();
  const expensesScrollRect = expensesScrollEl.getBoundingClientRect();
  const boardStyles = expensesWindow.getComputedStyle(expensesBoard);
  const nameWidth = parseFloat(boardStyles.getPropertyValue("--charge-plan-name-col-width"));
  const totalWidth = parseFloat(boardStyles.getPropertyValue("--charge-plan-total-col-width"));
  const fixedColumnsWidth =
    (Number.isFinite(nameWidth) ? nameWidth : 150) + (Number.isFinite(totalWidth) ? totalWidth : 100);

  const planningAbsRight = planningFrameRect.left + planningCenterRect.right;
  const expensesAbsRight = expensesFrameRect.left + expensesScrollRect.right;
  const planningVisibleWidth = Math.max(0, planningCenterRect.width);
  const expensesVisibleWidth = Math.max(0, expensesScrollRect.width - fixedColumnsWidth);
  const rightDelta = expensesAbsRight - planningAbsRight;
  const widthDelta = expensesVisibleWidth - planningVisibleWidth;
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
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncExpensesPlanningShell();
      scheduleExpensesFramePresentation();
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
  if (!normalizedProjectKey || !planningApi || !expensesApi) {
    return;
  }

  projectSyncInProgress = true;
  pendingViewportPayload = null;
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);

  try {
    await Promise.all([
      Promise.resolve(planningApi.setSelectedProject(normalizedProjectKey)),
      Promise.resolve(planningAxisApi?.setSelectedProject?.(normalizedProjectKey)),
      Promise.resolve(expensesApi.setSelectedProject(normalizedProjectKey)),
    ]);
    activeProjectKey = normalizedProjectKey;
    scheduleExpensesFramePresentation();
    const referencePlanningApi = getReferencePlanningApi() || planningApi;
    const planningProjectDateBounds =
      referencePlanningApi.getProjectDateBounds?.() || planningApi.getProjectDateBounds?.() || null;
    const expensesProjectDateBounds = expensesApi.getProjectDateBounds?.() || null;
    let sharedViewport = buildProjectSelectionViewport(
      buildSharedProjectDateBounds({
        planningDateBounds: planningProjectDateBounds,
        expensesDateBounds: expensesProjectDateBounds,
      }),
      expensesApi.getViewport?.() || referencePlanningApi.getViewport?.() || planningApi.getViewport?.() || {}
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

      const stabilizedViewport = await alignExpensesViewportToPlanning(sharedViewport);
      if (stabilizedViewport?.firstVisibleDate) {
        sharedViewport = buildCanonicalSharedViewport({
          ...sharedViewport,
          ...stabilizedViewport,
        });
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

    [planningApi, planningAxisApi, expensesApi] = await Promise.all([
      waitForChildApi(planningFrameEl, "__planningProjetSyncApi"),
      waitForChildApi(planningAxisFrameEl, "__planningProjetSyncApi"),
      waitForChildApi(expensesFrameEl, "__gestionDepenses2PlanningSyncApi"),
    ]);
    bindExpensesPlanningShellControls();
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();

    expensesFrameEl?.addEventListener("load", () => {
      scheduleExpensesFramePresentation();
      schedulePlanningLayoutDebug("expenses-frame-load");
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
    expensesApi.subscribeViewportChange(handleViewportChange);

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

bootstrap();
