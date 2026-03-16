export function getDomRefs() {
  if (typeof document === "undefined") {
    return null;
  }

  return {
    projectSelect: document.getElementById("project-select"),
    addProjectBtn: document.getElementById("add-project-btn"),
    addProjectForm: document.getElementById("add-project-form"),
    projectNameInput: document.getElementById("project-name"),
    projectNumberInput: document.getElementById("project-number"),
    budgetLinesContainer: document.getElementById("budget-lines-container"),
    budgetChapterInput: document.getElementById("budget-chapter"),
    budgetAmountInput: document.getElementById("budget-amount"),
    addBudgetLineBtn: document.getElementById("add-budget-line-btn"),
    saveProjectBtn: document.getElementById("save-project-btn"),
    editBudgetBtn: document.getElementById("edit-budget-btn"),
    editBudgetModal: document.getElementById("edit-budget-modal"),
    editBudgetLinesContainer: document.getElementById("edit-budget-lines-container"),
    editBudgetChapterInput: document.getElementById("edit-budget-chapter"),
    editBudgetAmountInput: document.getElementById("edit-budget-amount"),
    addEditBudgetLineBtn: document.getElementById("add-edit-budget-line-btn"),
    saveEditedBudgetBtn: document.getElementById("save-edited-budget-btn"),
    cancelEditBudgetBtn: document.getElementById("cancel-edit-budget-btn"),
    currentProjectName: document.getElementById("current-project-name"),
    currentProjectNumber: document.getElementById("current-project-number"),
    totalProjectBudget: document.getElementById("total-project-budget"),
    currentProjectBudgetBreakdown: document.getElementById(
      "current-project-budget-breakdown"
    ),
    kpiTotalBudget: document.getElementById("kpi-total-budget"),
    kpiTotalSpending: document.getElementById("kpi-total-spending"),
    kpiRemainingBudget: document.getElementById("kpi-remaining-budget"),
    kpiRemainingPercentage: document.getElementById("kpi-remaining-percentage"),
    yearSelect: document.getElementById("year-select"),
    prevMonthBtn: document.getElementById("prev-month-btn"),
    nextMonthBtn: document.getElementById("next-month-btn"),
    currentMonthYear: document.getElementById("current-month-year"),
    monthSpanInput: document.getElementById("month-span-input"),
    chargePlanBoard: document.getElementById("charge-plan-board"),
    expenseHeadRow: document.querySelector("#expense-table thead tr"),
    expenseTableBody: document.querySelector("#expense-table tbody"),
    realExpenseHeadRow: document.querySelector("#real-expense-table thead tr"),
    realExpenseTableBody: document.querySelector("#real-expense-table tbody"),
    addWorkerBtn: document.getElementById("add-worker-btn"),
    addWorkerForm: document.getElementById("add-worker-form"),
    workerNameSelect: document.getElementById("worker-name-select"),
    saveWorkerBtn: document.getElementById("save-worker-btn"),
    spendingChartCanvas: document.getElementById("spending-chart"),
    prevMonthTableBtns: Array.from(
      document.querySelectorAll(".prev-month-table-btn")
    ),
    nextMonthTableBtns: Array.from(
      document.querySelectorAll(".next-month-table-btn")
    ),
  };
}

export function assertDomRefs(domRefs) {
  const requiredKeys = [
    "projectSelect",
    "addProjectBtn",
    "addProjectForm",
    "projectNameInput",
    "projectNumberInput",
    "budgetLinesContainer",
    "budgetChapterInput",
    "budgetAmountInput",
    "addBudgetLineBtn",
    "saveProjectBtn",
    "editBudgetBtn",
    "editBudgetModal",
    "editBudgetLinesContainer",
    "editBudgetChapterInput",
    "editBudgetAmountInput",
    "addEditBudgetLineBtn",
    "saveEditedBudgetBtn",
    "cancelEditBudgetBtn",
    "currentProjectName",
    "currentProjectNumber",
    "totalProjectBudget",
    "currentProjectBudgetBreakdown",
    "kpiTotalBudget",
    "kpiTotalSpending",
    "kpiRemainingBudget",
    "kpiRemainingPercentage",
    "yearSelect",
    "prevMonthBtn",
    "nextMonthBtn",
    "currentMonthYear",
    "monthSpanInput",
    "chargePlanBoard",
    "expenseHeadRow",
    "expenseTableBody",
    "realExpenseHeadRow",
    "realExpenseTableBody",
    "addWorkerBtn",
    "addWorkerForm",
    "workerNameSelect",
    "saveWorkerBtn",
    "spendingChartCanvas",
  ];

  const missing = requiredKeys.filter((key) => !domRefs?.[key]);
  if (missing.length) {
    throw new Error(`Elements DOM introuvables : ${missing.join(", ")}`);
  }

  return domRefs;
}
