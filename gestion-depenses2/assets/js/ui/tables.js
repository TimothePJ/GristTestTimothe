import { clearExpenseTimeline, renderExpenseTimeline } from "./expenseTimeline.js";

export function renderTables(dom, project, viewState) {
  renderExpenseTimeline(dom.expenseBoard, project);
}

export function clearTables(dom) {
  clearExpenseTimeline(dom.expenseBoard);
}
