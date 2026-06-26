import { LAYOUT_DEBUG_ENABLED } from "../app/constants.js";
import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
import { getPlanningMainScrollbarGutterWidth } from "../viewport/alignment.js";

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
  const planningDocument = dom.planningFrameEl?.contentDocument;
  const planningWindow = dom.planningFrameEl?.contentWindow;
  if (!planningDocument || !planningWindow) {
    return null;
  }

  const wrapper = planningDocument.getElementById("timelineWrapper");
  const planningRoot = planningDocument.getElementById("planningTimeline");
  const headerRow = planningDocument.querySelector(".planning-header-row");
  const topPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-top");
  const leftPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-left");
  const centerPanel = planningDocument.querySelector("#planningTimeline .vis-panel.vis-center");
  const firstTaskCell = planningDocument.querySelector("#planningTimeline .group-row-grid .cell-task");
  const firstLabelInner = planningDocument.querySelector("#planningTimeline .vis-labelset .vis-label .vis-inner");
  if (
    !(wrapper instanceof planningWindow.HTMLElement) ||
    !(planningRoot instanceof planningWindow.HTMLElement)
  ) {
    return null;
  }

  const frameRect = dom.planningFrameEl?.getBoundingClientRect?.() || null;
  const wrapperRect = wrapper.getBoundingClientRect();
  const headerRect = headerRow instanceof planningWindow.HTMLElement ? headerRow.getBoundingClientRect() : null;
  const topPanelRect = topPanel instanceof planningWindow.HTMLElement ? topPanel.getBoundingClientRect() : null;
  const leftPanelRect = leftPanel instanceof planningWindow.HTMLElement ? leftPanel.getBoundingClientRect() : null;
  const centerPanelRect = centerPanel instanceof planningWindow.HTMLElement ? centerPanel.getBoundingClientRect() : null;
  const firstTaskCellRect =
    firstTaskCell instanceof planningWindow.HTMLElement ? firstTaskCell.getBoundingClientRect() : null;
  const firstLabelInnerRect =
    firstLabelInner instanceof planningWindow.HTMLElement
      ? firstLabelInner.getBoundingClientRect()
      : null;
  const topPanelStyle =
    topPanel instanceof planningWindow.HTMLElement ? planningWindow.getComputedStyle(topPanel) : null;
  const leftPanelStyle =
    leftPanel instanceof planningWindow.HTMLElement ? planningWindow.getComputedStyle(leftPanel) : null;
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

export function schedulePlanningLayoutDebug(reason = "") {
  if (!LAYOUT_DEBUG_ENABLED) {
    return;
  }

  if (reason) {
    state.pendingPlanningLayoutDebugReasons.add(reason);
  }

  if (state.planningLayoutDebugRafId) {
    return;
  }

  state.planningLayoutDebugRafId = window.requestAnimationFrame(() => {
    state.planningLayoutDebugRafId = 0;
    const reasonLabel = Array.from(state.pendingPlanningLayoutDebugReasons).join(",");
    state.pendingPlanningLayoutDebugReasons.clear();
    const snapshot = getPlanningLayoutSnapshot(reasonLabel || "layout");
    if (!snapshot) {
      return;
    }

    const nextSignature = JSON.stringify(snapshot);
    if (nextSignature === state.lastPlanningLayoutDebugSignature) {
      return;
    }

    state.lastPlanningLayoutDebugSignature = nextSignature;
    console.info("[sync-layout]", snapshot);
  });
}

export function bindPlanningLayoutDebug() {
  if (!LAYOUT_DEBUG_ENABLED) {
    return;
  }

  if (state.planningLayoutDebugCleanup) {
    state.planningLayoutDebugCleanup();
    state.planningLayoutDebugCleanup = null;
  }

  const planningDocument = dom.planningFrameEl?.contentDocument;
  const planningWindow = dom.planningFrameEl?.contentWindow;
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

  state.planningLayoutDebugCleanup = () => {
    wrapper.removeEventListener("scroll", handleWrapperScroll);
    window.removeEventListener("scroll", handlePageScroll);
    window.removeEventListener("resize", handleResize);
    window.visualViewport?.removeEventListener("resize", handleResize);
  };

  schedulePlanningLayoutDebug("bind");
}
