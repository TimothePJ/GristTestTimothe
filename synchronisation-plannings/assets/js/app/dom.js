export function getHubDom() {
  return {
    overviewFrameEl: document.getElementById("gestion-depenses2-overview-frame"),
    planningFrameEl: document.getElementById("planning-projet-frame"),
    planningAxisFrameEl: document.getElementById("planning-projet-axis-frame"),
    expensesFrameEl: document.getElementById("gestion-depenses2-frame"),
    expensesChartFrameEl: document.getElementById("gestion-depenses2-chart-frame"),
    planningResizeHandleEl: document.getElementById("sync-planning-resize-handle"),
    selectionWarningEl: document.getElementById("selected-page-warning"),
    selectionWarningTitleEl: document.getElementById("selected-page-warning-title"),
    selectionWarningMessageEl: document.getElementById("selected-page-warning-message"),
    planningWarningsModalEl: document.getElementById("planning-warnings-modal"),
    planningWarningsModalCloseBtnEl: document.getElementById(
      "planning-warnings-modal-close-btn"
    ),
    planningWarningsModalTitleEl: document.getElementById("planning-warnings-modal-title"),
    planningWarningsModalSubtitleEl: document.getElementById(
      "planning-warnings-modal-subtitle"
    ),
    planningWarningsModalSummaryEl: document.getElementById("planning-warnings-modal-summary"),
    planningWarningsModalListEl: document.getElementById("planning-warnings-modal-list"),
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
