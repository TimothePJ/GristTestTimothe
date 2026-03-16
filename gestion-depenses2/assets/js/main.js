import { clamp, parseOptionalNumberInput, shiftMonthCursor } from "./utils/format.js";
import { APP_CONFIG } from "./config.js";
import { getSelectedProject, setState, state } from "./state.js";
import {
  addWorkerToProject,
  createProjectWithBudget,
  fetchExpenseAppTables,
  initGrist,
  removeProjectWorker,
  saveBudgetChanges,
  updateProjectBillingPercentages,
  updateWorkerDailyRate,
  upsertTimesheetBatch,
  upsertTimesheetValue,
} from "./services/gristService.js";
import {
  buildExpenseData,
  getEarliestProjectMonth,
  getProjectBudgetTotal,
} from "./services/projectService.js";
import { assertDomRefs, getDomRefs } from "./ui/dom.js";
import { destroyChart, renderSpendingChart } from "./ui/chart.js";
import {
  clearChargePlanSelectionPreview,
  clearChargePlanTimeline,
  computeChargePlanSelection,
  getEmptyChargePlanUpdates,
  renderChargePlanTimeline,
  updateChargePlanSelectionPreview,
} from "./ui/chargeTimeline.js";
import { clearKpi, renderKpi } from "./ui/kpi.js";
import {
  populateYearOptions,
  renderCurrentMonthYear,
  renderProjectOptions,
  renderWorkerOptions,
} from "./ui/selectors.js";
import {
  clearProjectSummary,
  closeModal,
  openModal,
  renderBudgetPreview,
  renderEditBudgetLines,
  renderProjectSummary,
  toggleElement,
} from "./ui/summary.js";
import { clearTables, renderTables } from "./ui/tables.js";

let dom = null;
let chargeTimelineDrag = null;

function cloneBudgetLines(lines) {
  return JSON.parse(JSON.stringify(lines || []));
}

function syncStateToProjectStart(project) {
  const earliestMonth = getEarliestProjectMonth(project);
  if (earliestMonth) {
    setState({
      selectedYear: earliestMonth.year,
      selectedMonth: earliestMonth.monthIndex,
    });
    return;
  }

  const now = new Date();
  setState({
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
  });
}

function renderApp() {
  renderProjectOptions(dom.projectSelect, state.projects, state.selectedProjectId);
  renderWorkerOptions(dom.workerNameSelect, state.teamMembers);
  populateYearOptions(dom.yearSelect, state.selectedYear);
  renderCurrentMonthYear(dom.currentMonthYear, state.selectedMonth, state.selectedYear);
  dom.monthSpanInput.value = String(state.monthSpan);
  renderBudgetPreview(dom.budgetLinesContainer, state.newProjectBudgetLines);

  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    clearProjectSummary(dom);
    clearKpi(dom);
    clearChargePlanTimeline(dom);
    clearTables(dom);
    state.spendingChart = destroyChart(state.spendingChart);
    return;
  }

  renderProjectSummary(dom, selectedProject, getProjectBudgetTotal(selectedProject));
  renderChargePlanTimeline(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  });
  renderTables(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  });
  renderKpi(dom, selectedProject);
  state.spendingChart = renderSpendingChart(
    dom.spendingChartCanvas,
    state.spendingChart,
    selectedProject,
    {
      selectedYear: state.selectedYear,
      selectedMonth: state.selectedMonth,
      monthSpan: state.monthSpan,
    }
  );
}

async function loadData({ preferredProjectNumber = "" } = {}) {
  const tables = await fetchExpenseAppTables();
  const { projects, teamMembers } = buildExpenseData(tables);

  setState({
    projects,
    teamMembers,
  });

  let selectedProject =
    projects.find((project) => project.id === state.selectedProjectId) || null;

  if (preferredProjectNumber) {
    const preferredProject =
      projects.find((project) => project.projectNumber === preferredProjectNumber) || null;
    if (preferredProject) {
      setState({ selectedProjectId: preferredProject.id });
      selectedProject = preferredProject;
      syncStateToProjectStart(preferredProject);
    }
  } else if (!selectedProject && projects.length > 0) {
    setState({ selectedProjectId: projects[0].id });
    selectedProject = projects[0];
    syncStateToProjectStart(selectedProject);
  } else if (!selectedProject) {
    setState({ selectedProjectId: null });
  }

  renderApp();
}

function shiftCurrentMonth(delta) {
  const nextState = shiftMonthCursor(state.selectedYear, state.selectedMonth, delta);
  setState(nextState);
  renderApp();
}

function resetNewProjectForm() {
  dom.projectNameInput.value = "";
  dom.projectNumberInput.value = "";
  dom.budgetChapterInput.value = "";
  dom.budgetAmountInput.value = "";
  setState({ newProjectBudgetLines: [] });
  renderBudgetPreview(dom.budgetLinesContainer, state.newProjectBudgetLines);
  toggleElement(dom.addProjectForm, false);
}

function resetEditBudgetForm() {
  dom.editBudgetChapterInput.value = "";
  dom.editBudgetAmountInput.value = "";
  setState({ editingBudgetLines: [] });
  closeModal(dom.editBudgetModal);
}

async function handleProjectSave() {
  const name = dom.projectNameInput.value.trim();
  const projectNumber = dom.projectNumberInput.value.trim();

  if (!name || !projectNumber || !state.newProjectBudgetLines.length) {
    return;
  }

  await createProjectWithBudget({
    name,
    projectNumber,
    budgetLines: state.newProjectBudgetLines,
  });

  resetNewProjectForm();
  await loadData({ preferredProjectNumber: projectNumber });
}

async function handleWorkerSave() {
  const selectedProject = getSelectedProject();
  if (!selectedProject) return;

  const selectedTeamMemberId = Number(dom.workerNameSelect.value);
  const selectedTeamMember =
    state.teamMembers.find((member) => member.id === selectedTeamMemberId) || null;

  if (!selectedTeamMember) {
    return;
  }

  await addWorkerToProject(selectedProject, selectedTeamMember);
  toggleElement(dom.addWorkerForm, false);
  await loadData();
}

async function saveWorkerProvisionalUpdates(workerId, updates) {
  const selectedProject = getSelectedProject();
  const worker =
    selectedProject?.workers.find((currentWorker) => currentWorker.id === workerId) || null;
  if (!selectedProject || !worker) return;

  const normalizedUpdates = (updates || []).filter((update) => update.monthKey);
  normalizedUpdates.forEach((update) => {
    worker.provisionalDays[update.monthKey] = update.provisionalDays;
  });

  await upsertTimesheetBatch({
    workerId,
    updates: normalizedUpdates,
  });

  renderApp();
}

function handleProjectSelectionChange() {
  const selectedValue = String(dom.projectSelect.value || "").trim();
  const selectedProjectId = selectedValue ? Number(selectedValue) : null;
  setState({
    selectedProjectId: Number.isInteger(selectedProjectId) ? selectedProjectId : null,
  });

  const selectedProject = getSelectedProject();
  if (selectedProject) {
    syncStateToProjectStart(selectedProject);
  }

  renderApp();
}

async function handleTableInputChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const selectedProject = getSelectedProject();
  if (!selectedProject) return;

  if (target.classList.contains("daily-rate")) {
    const workerId = Number(target.dataset.workerId);
    const worker =
      selectedProject.workers.find((currentWorker) => currentWorker.id === workerId) || null;
    if (!worker) return;

    const dailyRate = parseOptionalNumberInput(target.value) ?? 0;
    worker.dailyRate = dailyRate;
    await updateWorkerDailyRate(worker.id, dailyRate);
    renderApp();
    return;
  }

  if (target.classList.contains("billing-percentage")) {
    const monthKey = target.dataset.month || "";
    if (!monthKey) return;

    const billingPct = clamp(parseOptionalNumberInput(target.value) ?? 100, 0, 100);
    selectedProject.billingPercentageByMonth = {
      ...(selectedProject.billingPercentageByMonth || {}),
      [monthKey]: billingPct,
    };

    await updateProjectBillingPercentages(
      selectedProject.id,
      selectedProject.billingPercentageByMonth
    );
    renderApp();
    return;
  }

  if (
    !target.classList.contains("provisional-days") &&
    !target.classList.contains("worked-days")
  ) {
    return;
  }

  const workerId = Number(target.dataset.workerId);
  const monthKey = target.dataset.month || "";
  const worker =
    selectedProject.workers.find((currentWorker) => currentWorker.id === workerId) || null;
  if (!worker || !monthKey) return;

  const value = parseOptionalNumberInput(target.value) ?? 0;

  if (target.classList.contains("provisional-days")) {
    worker.provisionalDays[monthKey] = value;
    await upsertTimesheetValue({
      workerId,
      monthKey,
      fieldName: "provisionalDays",
      value,
    });
  } else {
    worker.workedDays[monthKey] = value;
    await upsertTimesheetValue({
      workerId,
      monthKey,
      fieldName: "workedDays",
      value,
    });
  }

  renderApp();
}

async function handleDeleteWorker(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (!target.classList.contains("delete-worker-btn")) return;

  const workerId = Number(target.dataset.workerId);
  if (!Number.isInteger(workerId)) return;

  await removeProjectWorker(workerId);
  await loadData();
}

function handleChargePlanPointerDown(event) {
  if (!(event.target instanceof Element)) return;
  if (event.button !== 0) return;

  const trackEl = event.target.closest(".charge-plan-track");
  if (!trackEl || trackEl.classList.contains("charge-plan-track--readonly")) return;

  event.preventDefault();

  const workerId = Number(trackEl.dataset.workerId);
  if (!Number.isInteger(workerId)) return;

  chargeTimelineDrag = {
    trackEl,
    workerId,
    startClientX: event.clientX,
    currentSelection: computeChargePlanSelection(trackEl, event.clientX, event.clientX),
  };

  updateChargePlanSelectionPreview(trackEl, chargeTimelineDrag.currentSelection);
}

function handleChargePlanPointerMove(event) {
  if (!chargeTimelineDrag) return;

  chargeTimelineDrag.currentSelection = computeChargePlanSelection(
    chargeTimelineDrag.trackEl,
    chargeTimelineDrag.startClientX,
    event.clientX
  );

  updateChargePlanSelectionPreview(
    chargeTimelineDrag.trackEl,
    chargeTimelineDrag.currentSelection
  );
}

async function handleChargePlanPointerUp() {
  if (!chargeTimelineDrag) return;

  const { trackEl, workerId, currentSelection } = chargeTimelineDrag;
  clearChargePlanSelectionPreview(trackEl);
  chargeTimelineDrag = null;

  if (
    !currentSelection ||
    currentSelection.widthPx <= 0 ||
    currentSelection.totalDays <= 0
  ) {
    return;
  }

  await saveWorkerProvisionalUpdates(workerId, currentSelection.updates);
}

async function handleChargePlanDoubleClick(event) {
  if (!(event.target instanceof Element)) return;

  const trackEl = event.target.closest(".charge-plan-track");
  if (!trackEl || trackEl.classList.contains("charge-plan-track--readonly")) return;

  const workerId = Number(trackEl.dataset.workerId);
  if (!Number.isInteger(workerId)) return;

  await saveWorkerProvisionalUpdates(workerId, getEmptyChargePlanUpdates(trackEl));
}

async function handlePaste(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (
    !target.classList.contains("provisional-days") &&
    !target.classList.contains("worked-days")
  ) {
    return;
  }

  event.preventDefault();

  const clipboardData = event.clipboardData || window.clipboardData;
  const pastedData = clipboardData?.getData("text") || "";
  const rows = pastedData.split(/\r?\n/).filter((row) => row.trim() !== "");
  if (!rows.length) return;

  const currentRow = target.closest("tr");
  if (!currentRow) return;

  const inputFields = Array.from(currentRow.querySelectorAll("input[type='number']"));
  const currentIndex = inputFields.indexOf(target);
  if (currentIndex === -1) return;

  const workerId = Number(target.dataset.workerId);
  const selectedProject = getSelectedProject();
  const worker =
    selectedProject?.workers.find((currentWorker) => currentWorker.id === workerId) || null;
  if (!selectedProject || !worker) return;

  const fieldName = target.classList.contains("worked-days")
    ? "workedDays"
    : "provisionalDays";
  const values = rows[0].split("\t");
  const updates = [];

  for (
    let offset = 0;
    offset < values.length && currentIndex + offset < inputFields.length;
    offset += 1
  ) {
    const field = inputFields[currentIndex + offset];
    const monthKey = field.dataset.month || "";
    if (!monthKey) continue;

    const value = parseOptionalNumberInput(values[offset]) ?? 0;
    if (fieldName === "provisionalDays") {
      worker.provisionalDays[monthKey] = value;
      updates.push({ monthKey, provisionalDays: value });
    } else {
      worker.workedDays[monthKey] = value;
      updates.push({ monthKey, workedDays: value });
    }
  }

  if (!updates.length) return;

  await upsertTimesheetBatch({
    workerId,
    updates,
  });

  renderApp();
}

function bindEvents() {
  dom.projectSelect.addEventListener("change", handleProjectSelectionChange);

  dom.yearSelect.addEventListener("change", () => {
    const selectedYear = Number(dom.yearSelect.value);
    if (!Number.isInteger(selectedYear)) return;

    setState({ selectedYear });
    renderApp();
  });

  dom.prevMonthBtn.addEventListener("click", () => {
    shiftCurrentMonth(-1);
  });

  dom.nextMonthBtn.addEventListener("click", () => {
    shiftCurrentMonth(1);
  });

  dom.prevMonthTableBtns.forEach((button) => {
    button.addEventListener("click", () => {
      shiftCurrentMonth(-1);
    });
  });

  dom.nextMonthTableBtns.forEach((button) => {
    button.addEventListener("click", () => {
      shiftCurrentMonth(1);
    });
  });

  dom.monthSpanInput.addEventListener("change", () => {
    const nextMonthSpan = clamp(
      Number(dom.monthSpanInput.value) || APP_CONFIG.defaultMonthSpan,
      1,
      24
    );
    setState({ monthSpan: nextMonthSpan });
    renderApp();
  });

  dom.addProjectBtn.addEventListener("click", (event) => {
    if (!event.isTrusted) return;

    const shouldShow =
      dom.addProjectForm.style.display === "none" || !dom.addProjectForm.style.display;
    toggleElement(dom.addProjectForm, shouldShow);
  });

  dom.addBudgetLineBtn.addEventListener("click", () => {
    const chapter = dom.budgetChapterInput.value.trim();
    const amount = parseOptionalNumberInput(dom.budgetAmountInput.value);
    if (!chapter || amount == null) return;

    setState({
      newProjectBudgetLines: [
        ...state.newProjectBudgetLines,
        {
          chapter,
          amount,
        },
      ],
    });

    dom.budgetChapterInput.value = "";
    dom.budgetAmountInput.value = "";
    renderBudgetPreview(dom.budgetLinesContainer, state.newProjectBudgetLines);
  });

  dom.saveProjectBtn.addEventListener("click", async () => {
    await handleProjectSave();
  });

  dom.editBudgetBtn.addEventListener("click", () => {
    const selectedProject = getSelectedProject();
    if (!selectedProject) return;

    setState({
      editingBudgetLines: cloneBudgetLines(selectedProject.budgetLines),
    });
    renderEditBudgetLines(dom.editBudgetLinesContainer, state.editingBudgetLines);
    openModal(dom.editBudgetModal);
  });

  dom.editBudgetLinesContainer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.classList.contains("delete-budget-line-btn")) return;

    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;

    const nextLines = [...state.editingBudgetLines];
    nextLines.splice(index, 1);
    setState({ editingBudgetLines: nextLines });
    renderEditBudgetLines(dom.editBudgetLinesContainer, state.editingBudgetLines);
  });

  dom.addEditBudgetLineBtn.addEventListener("click", () => {
    const chapter = dom.editBudgetChapterInput.value.trim();
    const amount = parseOptionalNumberInput(dom.editBudgetAmountInput.value);
    if (!chapter || amount == null) return;

    setState({
      editingBudgetLines: [
        ...state.editingBudgetLines,
        {
          chapter,
          amount,
        },
      ],
    });

    dom.editBudgetChapterInput.value = "";
    dom.editBudgetAmountInput.value = "";
    renderEditBudgetLines(dom.editBudgetLinesContainer, state.editingBudgetLines);
  });

  dom.saveEditedBudgetBtn.addEventListener("click", async () => {
    const selectedProject = getSelectedProject();
    if (!selectedProject) return;

    await saveBudgetChanges(selectedProject, state.editingBudgetLines);
    resetEditBudgetForm();
    await loadData();
  });

  dom.cancelEditBudgetBtn.addEventListener("click", () => {
    resetEditBudgetForm();
  });

  dom.addWorkerBtn.addEventListener("click", () => {
    const shouldShow =
      dom.addWorkerForm.style.display === "none" || !dom.addWorkerForm.style.display;
    toggleElement(dom.addWorkerForm, shouldShow);
  });

  dom.saveWorkerBtn.addEventListener("click", async () => {
    await handleWorkerSave();
  });

  dom.expenseTableBody.addEventListener("change", handleTableInputChange);
  dom.realExpenseTableBody.addEventListener("change", handleTableInputChange);

  dom.realExpenseTableBody.addEventListener("paste", handlePaste, true);
  dom.chargePlanBoard.addEventListener("click", handleDeleteWorker);
  dom.chargePlanBoard.addEventListener("pointerdown", handleChargePlanPointerDown);
  dom.chargePlanBoard.addEventListener("dblclick", (event) => {
    handleChargePlanDoubleClick(event).catch((error) => {
      console.error("Erreur effacement timeline :", error);
    });
  });
  window.addEventListener("pointermove", handleChargePlanPointerMove);
  window.addEventListener("pointerup", () => {
    handleChargePlanPointerUp().catch((error) => {
      console.error("Erreur sauvegarde timeline :", error);
    });
  });
  window.addEventListener("pointercancel", () => {
    if (!chargeTimelineDrag) return;
    clearChargePlanSelectionPreview(chargeTimelineDrag.trackEl);
    chargeTimelineDrag = null;
  });
}

export async function bootstrap() {
  dom = assertDomRefs(getDomRefs());
  toggleElement(dom.addProjectForm, false);
  toggleElement(dom.addWorkerForm, false);
  closeModal(dom.editBudgetModal);

  initGrist();
  bindEvents();
  await loadData();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap().catch((error) => {
      console.error("Erreur initialisation gestion-depenses2 :", error);
    });
  });
}
