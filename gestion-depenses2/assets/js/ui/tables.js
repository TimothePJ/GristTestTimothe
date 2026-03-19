import {
  clearExpenseTimeline,
  clearExpenseRateControls,
  renderExpenseRateControls,
  renderExpenseTimeline,
  renderRealExpenseTimeline,
} from "./expenseTimeline.js";

export function renderTables(dom, project, viewState) {
  renderExpenseRateControls(dom.teamManagementRates, project);
  renderExpenseTimeline(dom.expenseBoard, project);
  renderRealExpenseTimeline(dom.realExpenseBoard, project);
}

export function clearTables(dom) {
  clearExpenseRateControls(dom.teamManagementRates);
  clearExpenseTimeline(dom.expenseBoard);
  clearExpenseTimeline(dom.realExpenseBoard);
}
