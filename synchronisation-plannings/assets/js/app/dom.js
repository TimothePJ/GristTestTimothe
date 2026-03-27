export function getHubDom() {
  return {
    planningFrameEl: document.getElementById("planning-projet-frame"),
    planningAxisFrameEl: document.getElementById("planning-projet-axis-frame"),
    expensesFrameEl: document.getElementById("gestion-depenses2-frame"),
    expensesChartFrameEl: document.getElementById("gestion-depenses2-chart-frame"),
    planningResizeHandleEl: document.getElementById("sync-planning-resize-handle"),
    projectSelectEl: document.getElementById("shared-project-select"),
    statusValueEl: document.getElementById("hub-status-value"),
    lastSourceValueEl: document.getElementById("last-source-value"),
    lastRangeValueEl: document.getElementById("last-range-value"),
    sharedPrevBtnEl: document.getElementById("shared-prev-btn"),
    sharedCenterBtnEl: document.getElementById("shared-center-btn"),
    sharedNextBtnEl: document.getElementById("shared-next-btn"),
    sharedCurrentDateRangeEl: document.getElementById("shared-current-date-range"),
    expensesModeButtons: Array.from(document.querySelectorAll("[data-expenses-sync-mode]")),
  };
}

export const dom = getHubDom();
