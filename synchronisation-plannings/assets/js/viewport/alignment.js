import {
  DAY_IN_MS,
  EXPENSES_ALIGNMENT_INITIAL_DELAY_MS,
  EXPENSES_ALIGNMENT_RETRY_DELAY_MS,
} from "../app/constants.js";
import { dom } from "../app/dom.js";
import { getReferencePlanningApi, state } from "../app/state.js";
import { buildCanonicalSharedViewport } from "./build.js";
import { syncPlanningViewportBounds } from "./bounds.js";
import { normalizeIsoDate, parseSharedExactNumber } from "./normalize.js";

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function getPlanningMainScrollbarGutterWidth() {
  const planningDocument = dom.planningFrameEl?.contentDocument;
  const planningWindow = dom.planningFrameEl?.contentWindow;
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

export function getPlanningReferencePanelContext() {
  const axisDocument = dom.planningAxisFrameEl?.contentDocument;
  const axisWindow = dom.planningAxisFrameEl?.contentWindow;
  const axisTopPanel = axisDocument?.querySelector("#planningTimeline .vis-panel.vis-top");
  if (
    dom.planningAxisFrameEl &&
    axisDocument &&
    axisWindow &&
    axisTopPanel instanceof axisWindow.HTMLElement
  ) {
    return {
      frameEl: dom.planningAxisFrameEl,
      document: axisDocument,
      window: axisWindow,
      panelEl: axisTopPanel,
      panelKind: "top",
    };
  }

  const planningDocument = dom.planningFrameEl?.contentDocument;
  const planningWindow = dom.planningFrameEl?.contentWindow;
  const planningCenterPanel = planningDocument?.querySelector("#planningTimeline .vis-panel.vis-center");
  if (
    dom.planningFrameEl &&
    planningDocument &&
    planningWindow &&
    planningCenterPanel instanceof planningWindow.HTMLElement
  ) {
    return {
      frameEl: dom.planningFrameEl,
      document: planningDocument,
      window: planningWindow,
      panelEl: planningCenterPanel,
      panelKind: "center",
    };
  }

  return null;
}

export function getPlanningReferenceViewportState() {
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

export function getPlanningMainExactVisibleDaySpan() {
  const viewport = getPlanningReferenceViewportState();
  const windowStartMs = parseSharedExactNumber(viewport?.windowStartMs);
  const windowEndMs = parseSharedExactNumber(viewport?.windowEndMs);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return Number.NaN;
  }

  return (windowEndMs - windowStartMs) / DAY_IN_MS;
}

export function getMedianLayoutMetric(values = []) {
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

export function getPlanningReferenceDayBoundaryPositions() {
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

export function getPlanningMainReferenceDayWidth(referencePanelContext = null) {
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

export function getExpensesVisibleDayBoundaryPositions(expensesFrameDocument = null) {
  const expensesDocument = expensesFrameDocument || dom.expensesFrameEl?.contentDocument;
  const expensesWindow = dom.expensesFrameEl?.contentWindow;
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

export function calibrateExpensesViewportPixelOffset(expensesFrameDocument = null) {
  if (!state.expensesApi?.nudgeViewportByPixels) {
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
    state.lastExpensesPixelAlignmentDelta = Number.NaN;
    return false;
  }

  if (
    Number.isFinite(state.lastExpensesPixelAlignmentDelta) &&
    Math.abs(state.lastExpensesPixelAlignmentDelta - alignmentDelta) <= 0.2
  ) {
    return false;
  }

  state.lastExpensesPixelAlignmentDelta = alignmentDelta;
  return Boolean(state.expensesApi.nudgeViewportByPixels(alignmentDelta));
}

export function getPlanningMainTimelineViewportMetrics(expensesFrameDocument = null) {
  const expensesDocument = expensesFrameDocument || dom.expensesFrameEl?.contentDocument;
  const expensesWindow = dom.expensesFrameEl?.contentWindow;
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
  const expensesFrameRect = dom.expensesFrameEl.getBoundingClientRect();
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
  const expensesContentRight = expensesTimelineContentLeft + expensesTimelineViewportWidth;

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

export function getPlanningMainTimelineViewportWidth() {
  const metrics = getPlanningMainTimelineViewportMetrics();
  return metrics ? Math.round(metrics.planningReferenceViewportWidth * 100) / 100 : 0;
}

export function getPlanningMainVisibleWidthAdjustment(expensesFrameDocument = null) {
  const metrics = getPlanningMainTimelineViewportMetrics(expensesFrameDocument);
  if (!metrics) {
    return 0;
  }

  const rightDelta = metrics.expensesContentRight - metrics.planningContentRight;
  const widthDelta = metrics.expensesTimelineViewportWidth - metrics.planningReferenceViewportWidth;
  const adjustment = Math.max(0, rightDelta, widthDelta);

  return Math.round(adjustment * 100) / 100;
}

export async function alignExpensesViewportToPlanning(
  baseViewport = null,
  { maxAttempts = 4, onAfterApply = null } = {}
) {
  const referencePlanningApi = getReferencePlanningApi();
  if (!referencePlanningApi || !state.expensesApi) {
    return null;
  }

  let planningViewport = buildCanonicalSharedViewport(
    referencePlanningApi.getViewport?.() || baseViewport || state.sharedViewportState || {}
  );
  if (!planningViewport.firstVisibleDate) {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    syncPlanningViewportBounds(planningViewport);
    await Promise.resolve(state.expensesApi.applyViewport(planningViewport));
    if (typeof onAfterApply === "function") {
      onAfterApply();
    }
    await sleep(attempt === 0 ? EXPENSES_ALIGNMENT_INITIAL_DELAY_MS : EXPENSES_ALIGNMENT_RETRY_DELAY_MS);

    const refreshedPlanningViewport = buildCanonicalSharedViewport(
      referencePlanningApi.getViewport?.() || planningViewport
    );
    const refreshedExpensesViewport = buildCanonicalSharedViewport(
      state.expensesApi.getViewport?.() || planningViewport
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
