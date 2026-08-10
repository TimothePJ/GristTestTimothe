import {
  clearExpenseTimeline,
  clearExpenseRateControls,
  renderExpenseRateControls,
  renderExpenseTimeline,
  renderRealExpenseTimeline,
} from "./expenseTimeline.js";

export function renderTables(dom, project, viewState) {
  // Reconstruire les taux pendant que l'utilisateur y saisit detruirait son champ
  // sans prevenir : la valeur tapee disparait et aucun evenement de validation ne
  // part. L'appelant nous dit de sauter ce bloc et le redessinera au depart du focus.
  if (!viewState?.skipRateControls) {
    renderExpenseRateControls(dom.teamManagementRates, project);
  }
  renderExpenseTimeline(dom.expenseBoard, project);
  renderRealExpenseTimeline(dom.realExpenseBoard, project);
}

export function clearTables(dom) {
  clearExpenseRateControls(dom.teamManagementRates);
  clearExpenseTimeline(dom.expenseBoard);
  clearExpenseTimeline(dom.realExpenseBoard);
}
