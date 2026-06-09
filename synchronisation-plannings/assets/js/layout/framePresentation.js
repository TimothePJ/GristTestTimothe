import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
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

// eslint-disable-next-line no-unused-vars
function traceExpensesFramePresentation(_event, _details = {}) {
  // Traces désactivées — console.info impacte la fluidité du rendu.
}

function scheduleExpensesPresentationBurst() {
  scheduleExpensesFramePresentation(1);
  window.requestAnimationFrame(() => {
    scheduleExpensesFramePresentation(1);
  });
  window.setTimeout(() => {
    scheduleExpensesFramePresentation(1);
  }, 120);
}

export function ensurePlanningFramePresentation() {
  const syncPlanningCardEl = document.querySelector(".sync-planning-card");
  const planningWrapperEl = dom.planningFrameEl?.contentDocument?.getElementById("timelineWrapper");
  if (!(syncPlanningCardEl instanceof HTMLElement) || !planningWrapperEl) {
    return false;
  }

  const scrollbarShift = getPlanningMainScrollbarGutterWidth();
  syncPlanningCardEl.style.setProperty("--sync-planning-scrollbar-shift", `${scrollbarShift}px`);

  if (
    !Number.isFinite(state.lastPlanningScrollbarShift) ||
    Math.abs(scrollbarShift - state.lastPlanningScrollbarShift) > 0.25
  ) {
    state.lastPlanningScrollbarShift = scrollbarShift;
    requestAnimationFrame(() => {
      state.planningAxisApi?.refreshLayout?.();
      state.planningApi?.refreshLayout?.();
    });
    schedulePlanningLayoutDebug("planning-scrollbar-shift");
  }

  return true;
}

export function schedulePlanningFramePresentation(attempt = 0) {
  window.clearTimeout(state.planningFramePresentationTimer);
  state.planningFramePresentationTimer = window.setTimeout(() => {
    const applied = ensurePlanningFramePresentation();
    if (applied || attempt >= 20) {
      return;
    }

    schedulePlanningFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}

export function ensureExpensesFramePresentation() {
  const frameDocument = dom.expensesFrameEl?.contentDocument;
  if (!frameDocument?.head || !frameDocument?.body) {
    return false;
  }

  ensurePlanningFramePresentation();

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
  const referenceDayWidthChanged =
    Number.isFinite(mainPlanningReferenceDayWidth) &&
    mainPlanningReferenceDayWidth > 0 &&
    (!Number.isFinite(state.lastExpensesReferenceDayWidth) ||
      Math.abs(mainPlanningReferenceDayWidth - state.lastExpensesReferenceDayWidth) > 0.05);

  if (visibleWidthAdjustmentChanged) {
    state.lastExpensesVisibleWidthAdjustment = mainPlanningVisibleWidthAdjustment;
  }

  if (referenceVisibleWidthChanged) {
    state.lastExpensesReferenceVisibleWidth = mainPlanningReferenceVisibleWidth;
  }

  if (referenceDayWidthChanged) {
    state.lastExpensesReferenceDayWidth = mainPlanningReferenceDayWidth;
  }

  if (visibleWidthAdjustmentChanged || referenceVisibleWidthChanged || referenceDayWidthChanged) {
    if (!state.expensesVisibleWidthAdjustmentRerenderPending && state.expensesApi?.applyViewport) {
      state.expensesVisibleWidthAdjustmentRerenderPending = true;
      requestAnimationFrame(() => {
        try {
          const viewportToReapply =
            state.sharedViewportState || state.expensesApi.getViewport?.() || getCurrentSharedViewport() || null;
          if (viewportToReapply) {
            void Promise.resolve(state.expensesApi.applyViewport(viewportToReapply))
              .catch((error) => console.error("reapply-viewport-for-width error:", error));
          }
          schedulePlanningLayoutDebug("expenses-width-adjustment");
        } finally {
          window.setTimeout(() => {
            state.expensesVisibleWidthAdjustmentRerenderPending = false;
            scheduleExpensesPresentationBurst();
          }, 0);
        }
      });
    }
  }

  requestAnimationFrame(() => {
    const calibrationAdjusted = calibrateExpensesViewportPixelOffset(frameDocument);
    if (calibrationAdjusted) {
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
