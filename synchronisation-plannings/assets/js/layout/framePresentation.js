import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
import { DEFAULT_OVERVIEW_FRAME_MIN_HEIGHT } from "../app/constants.js";
import { getCurrentSharedViewport } from "../viewport/build.js";
import {
  calibrateExpensesViewportPixelOffset,
  getPlanningMainReferenceDayWidth,
  getPlanningMainTimelineViewportWidth,
  getPlanningMainVisibleWidthAdjustment,
  getPlanningReferencePanelContext,
  getPlanningMainScrollbarGutterWidth,
} from "../viewport/alignment.js";
import { schedulePlanningLayoutDebug } from "./debugLayout.js";

let expensesFrameTraceSequence = 0;

function roundExpensesFrameTraceNumber(value, digits = 2) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const precision = 10 ** digits;
  return Math.round(numericValue * precision) / precision;
}

function summarizeExpensesFrameViewport(viewport = {}) {
  if (!viewport || typeof viewport !== "object") {
    return null;
  }

  return {
    mode: String(viewport.mode || "").trim(),
    firstVisibleDate: String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim(),
    rangeEndDate: String(viewport.rangeEndDate || "").trim(),
    visibleDays: roundExpensesFrameTraceNumber(viewport.visibleDays, 4),
    leftDayOffset: roundExpensesFrameTraceNumber(viewport.leftDayOffset, 6),
    windowStartMs: roundExpensesFrameTraceNumber(viewport.windowStartMs, 0),
    windowEndMs: roundExpensesFrameTraceNumber(viewport.windowEndMs, 0),
  };
}

function traceExpensesFramePresentation(event, details = {}) {
  expensesFrameTraceSequence += 1;
  console.info(`[sync-trace][hub-expenses-frame][${expensesFrameTraceSequence}] ${event}`, details);
}

function cleanupOverviewFrameResizeObserver() {
  if (typeof state.overviewFrameResizeCleanup === "function") {
    state.overviewFrameResizeCleanup();
  }

  state.overviewFrameResizeCleanup = null;
  state.overviewFrameResizeDocument = null;
}

function ensureOverviewFrameResizeObserver(frameDocument) {
  if (!frameDocument || state.overviewFrameResizeDocument === frameDocument) {
    return;
  }

  cleanupOverviewFrameResizeObserver();

  const frameWindow = dom.overviewFrameEl?.contentWindow;
  const ResizeObserverCtor = frameWindow?.ResizeObserver;
  const observedElements = [
    frameDocument.querySelector(".header"),
    frameDocument.querySelector(".container"),
    frameDocument.body,
    frameDocument.documentElement,
  ].filter(Boolean);

  if (typeof ResizeObserverCtor !== "function" || observedElements.length === 0) {
    state.overviewFrameResizeDocument = frameDocument;
    return;
  }

  const resizeObserver = new ResizeObserverCtor(() => {
    scheduleOverviewFramePresentation(1);
  });

  observedElements.forEach((element) => {
    resizeObserver.observe(element);
  });

  state.overviewFrameResizeCleanup = () => {
    resizeObserver.disconnect();
  };
  state.overviewFrameResizeDocument = frameDocument;
}

export function resetOverviewFramePresentation() {
  window.clearTimeout(state.overviewFramePresentationTimer);
  cleanupOverviewFrameResizeObserver();
}

export function ensureOverviewFramePresentation() {
  const frameDocument = dom.overviewFrameEl?.contentDocument;
  if (!frameDocument?.body) {
    return false;
  }

  ensureOverviewFrameResizeObserver(frameDocument);

  const measuredHeight = Math.max(
    DEFAULT_OVERVIEW_FRAME_MIN_HEIGHT,
    Math.ceil(
      Math.max(
        frameDocument.documentElement?.scrollHeight || 0,
        frameDocument.body?.scrollHeight || 0,
        frameDocument.querySelector(".header")?.scrollHeight || 0,
        frameDocument.querySelector(".main-content")?.scrollHeight || 0
      )
    ) + 8
  );

  if (dom.overviewFrameEl instanceof HTMLIFrameElement) {
    dom.overviewFrameEl.style.height = `${measuredHeight}px`;
    dom.overviewFrameEl.style.minHeight = `${measuredHeight}px`;
  }

  dom.overviewFrameEl?.classList.add("is-ready");
  return true;
}

export function scheduleOverviewFramePresentation(attempt = 0) {
  window.clearTimeout(state.overviewFramePresentationTimer);
  state.overviewFramePresentationTimer = window.setTimeout(() => {
    const applied = ensureOverviewFramePresentation();
    if (applied || attempt >= 20) {
      dom.overviewFrameEl?.classList.add("is-ready");
      return;
    }

    scheduleOverviewFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}

export function ensureExpensesFramePresentation() {
  const frameDocument = dom.expensesFrameEl?.contentDocument;
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

  if (dom.expensesFrameEl instanceof HTMLIFrameElement) {
    dom.expensesFrameEl.style.height = `${measuredHeight}px`;
    dom.expensesFrameEl.style.minHeight = `${measuredHeight}px`;
  }

  const visibleWidthAdjustmentChanged =
    Number.isFinite(mainPlanningVisibleWidthAdjustment) &&
    (!Number.isFinite(state.lastExpensesVisibleWidthAdjustment) ||
      Math.abs(mainPlanningVisibleWidthAdjustment - state.lastExpensesVisibleWidthAdjustment) > 0.25);
  const referenceVisibleWidthChanged =
    Number.isFinite(mainPlanningReferenceVisibleWidth) &&
    (!Number.isFinite(state.lastExpensesReferenceVisibleWidth) ||
      Math.abs(mainPlanningReferenceVisibleWidth - state.lastExpensesReferenceVisibleWidth) > 0.25);

  if (visibleWidthAdjustmentChanged) {
    state.lastExpensesVisibleWidthAdjustment = mainPlanningVisibleWidthAdjustment;
  }

  if (referenceVisibleWidthChanged) {
    state.lastExpensesReferenceVisibleWidth = mainPlanningReferenceVisibleWidth;
  }

  if (visibleWidthAdjustmentChanged || referenceVisibleWidthChanged) {
    traceExpensesFramePresentation("width-adjustment-detected", {
      visibleWidthAdjustmentChanged,
      referenceVisibleWidthChanged,
      mainPlanningVisibleWidthAdjustment: roundExpensesFrameTraceNumber(
        mainPlanningVisibleWidthAdjustment
      ),
      mainPlanningReferenceVisibleWidth: roundExpensesFrameTraceNumber(
        mainPlanningReferenceVisibleWidth
      ),
      mainPlanningReferenceDayWidth: roundExpensesFrameTraceNumber(mainPlanningReferenceDayWidth, 6),
      embeddedScrollWidth: roundExpensesFrameTraceNumber(embeddedScrollWidth),
      rerenderPending: state.expensesVisibleWidthAdjustmentRerenderPending,
    });
    if (!state.expensesVisibleWidthAdjustmentRerenderPending && state.expensesApi?.applyViewport) {
      state.expensesVisibleWidthAdjustmentRerenderPending = true;
      requestAnimationFrame(() => {
        try {
          const viewportToReapply =
            state.sharedViewportState || state.expensesApi.getViewport?.() || getCurrentSharedViewport() || null;
          if (viewportToReapply) {
            traceExpensesFramePresentation("reapply-viewport-for-width", {
              viewport: summarizeExpensesFrameViewport(viewportToReapply),
            });
            state.expensesApi.applyViewport(viewportToReapply);
          }
          schedulePlanningLayoutDebug("expenses-width-adjustment");
        } finally {
          window.setTimeout(() => {
            state.expensesVisibleWidthAdjustmentRerenderPending = false;
            scheduleExpensesFramePresentation(1);
          }, 0);
        }
      });
    }
  }

  requestAnimationFrame(() => {
    const calibrationAdjusted = calibrateExpensesViewportPixelOffset(frameDocument);
    if (calibrationAdjusted) {
      traceExpensesFramePresentation("pixel-calibration-rerender", {
        activeProjectKey: state.activeProjectKey,
      });
      scheduleExpensesFramePresentation(1);
    }
  });

  dom.expensesFrameEl?.classList.add("is-ready");
  schedulePlanningLayoutDebug("expenses-presentation");
  return true;
}

export function scheduleExpensesFramePresentation(attempt = 0) {
  window.clearTimeout(state.expensesFramePresentationTimer);
  state.expensesFramePresentationTimer = window.setTimeout(() => {
    const applied = ensureExpensesFramePresentation();
    if (applied || attempt >= 20) {
      dom.expensesFrameEl?.classList.add("is-ready");
      return;
    }

    scheduleExpensesFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}

export function ensureExpensesChartFramePresentation() {
  const frameDocument = dom.expensesChartFrameEl?.contentDocument;
  if (!frameDocument) {
    return false;
  }

  const measuredHeight = Math.max(
    360,
    Math.ceil(
      Math.max(frameDocument.documentElement?.scrollHeight || 0, frameDocument.body?.scrollHeight || 0)
    )
  );

  if (dom.expensesChartFrameEl instanceof HTMLIFrameElement) {
    dom.expensesChartFrameEl.style.height = `${measuredHeight}px`;
    dom.expensesChartFrameEl.style.minHeight = `${measuredHeight}px`;
  }

  return true;
}

export function scheduleExpensesChartFramePresentation(attempt = 0) {
  window.clearTimeout(state.expensesChartFramePresentationTimer);
  state.expensesChartFramePresentationTimer = window.setTimeout(() => {
    const applied = ensureExpensesChartFramePresentation();
    if (applied || attempt >= 20) {
      return;
    }

    scheduleExpensesChartFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}
