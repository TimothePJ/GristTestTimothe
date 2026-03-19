import {
  clearExpenseTimeline,
  renderExpenseTimeline,
  renderRealExpenseTimeline,
} from "./expenseTimeline.js";

export function renderTables(dom, project, viewState) {
  renderExpenseTimeline(dom.expenseBoard, project);
  renderRealExpenseTimeline(dom.realExpenseBoard, project);
}

export function clearTables(dom) {
  clearExpenseTimeline(dom.expenseBoard);
  clearExpenseTimeline(dom.realExpenseBoard);
}
