import { clamp, parseOptionalNumberInput, shiftMonthCursor } from "./utils/format.js";
import { APP_CONFIG } from "./config.js";
import { getSelectedProject, setState, state } from "./state.js";
import {
  addWorkerToProject,
  createTimeSegment,
  createProjectWithBudget,
  fetchExpenseAppTables,
  initGrist,
  removeProjectWorker,
  removeTimeSegment,
  saveBudgetChanges,
  updateTimeSegment,
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
  computeChargePlanSelectionFromSlotIndexes,
  getChargePlanSlotIndexAtClientX,
  hideChargePlanContextMenu,
  renderChargePlanTimeline,
  setChargePlanFeedback,
  showChargePlanContextMenu,
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
import { parseRawDateTime } from "./utils/timeSegments.js";

let dom = null;
let chargeTimelineDrag = null;
let chargePlanPan = null;
let chargePlanRangeRefreshPending = false;
const chargePlanViewport = {
  scrollRatio: 0,
  pendingAnchorRatio: null,
  pendingClientOffset: 0,
};
let pendingChargePlanFocusDate = "";
let pendingChargePlanFocusAlign = "center";

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cloneBudgetLines(lines) {
  return JSON.parse(JSON.stringify(lines || []));
}

function syncStateToProjectStart(project) {
  const earliestMonth = getEarliestProjectMonth(project);
  if (earliestMonth) {
    setState({
      selectedYear: earliestMonth.year,
      selectedMonth: earliestMonth.monthIndex,
      chargePlanAnchorDate: `${earliestMonth.year}-${String(
        earliestMonth.monthIndex + 1
      ).padStart(2, "0")}-01`,
    });
    return;
  }

  const now = new Date();
  setState({
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    chargePlanAnchorDate: toDateInputValue(now),
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
    chargePlanZoomMode: state.chargePlanZoomMode,
    chargePlanZoomScale: state.chargePlanZoomScale,
    chargePlanAnchorDate: state.chargePlanAnchorDate,
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
  restoreChargePlanViewport();
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

async function createChargePlanSegment(workerId, selection) {
  if (!selection?.startDate || !selection?.endDate || selection.totalDays <= 0) {
    return;
  }

  await createTimeSegment({
    projectTeamLink: workerId,
    startDate: selection.startDate,
    endDate: selection.endDate,
    allocationDays: selection.totalDays,
    segmentType: "previsionnel",
    label: "",
  });

  await loadData();
}

async function resizeChargePlanSegment(segmentId, selection) {
  if (!selection?.startDate || !selection?.endDate || selection.totalDays <= 0) {
    return;
  }

  await updateTimeSegment({
    segmentId,
    startDate: selection.startDate,
    endDate: selection.endDate,
    allocationDays: selection.totalDays,
  });

  await loadData();
}

function getSelectedProjectWorker(workerId) {
  const selectedProject = getSelectedProject();
  if (!selectedProject) return null;

  return (
    selectedProject.workers.find((currentWorker) => currentWorker.id === workerId) || null
  );
}

function selectionOverlapsWorkerSegments(worker, selection, options = {}) {
  const ignoredSegmentId = Number(options.ignoreSegmentId);
  if (!worker || !selection?.startDate || !selection?.endDate) {
    return false;
  }

  const selectionStart = parseRawDateTime(selection.startDate);
  const selectionEnd = parseRawDateTime(selection.endDate);
  if (!selectionStart || !selectionEnd) {
    return false;
  }

  return (worker.segments || []).some((segment) => {
    if (Number(segment?.id) === ignoredSegmentId) {
      return false;
    }

    const segmentStart = parseRawDateTime(segment?.startAt);
    const segmentEnd = parseRawDateTime(segment?.endAt);
    if (!segmentStart || !segmentEnd) {
      return false;
    }

    return selectionStart < segmentEnd && selectionEnd > segmentStart;
  });
}

function annotateChargePlanSelection(workerId, selection, options = {}) {
  if (!selection) return null;

  const worker = getSelectedProjectWorker(workerId);
  return {
    ...selection,
    hasOverlap: selectionOverlapsWorkerSegments(worker, selection, options),
  };
}

function syncChargePlanFeedback(selection) {
  if (!dom?.chargePlanBoard) return;

  if (selection?.hasOverlap) {
    setChargePlanFeedback(
      dom.chargePlanBoard,
      "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
    );
    return;
  }

  setChargePlanFeedback(dom.chargePlanBoard, "");
}

function getChargePlanScrollElement() {
  return dom?.chargePlanBoard?.querySelector(".charge-plan-scroll") || null;
}

function captureChargePlanViewport(scrollEl = getChargePlanScrollElement()) {
  if (!(scrollEl instanceof HTMLElement)) return;

  const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
  chargePlanViewport.scrollRatio =
    maxScrollLeft > 0 ? scrollEl.scrollLeft / maxScrollLeft : 0;
}

function rememberChargePlanAnchor(scrollEl, clientX) {
  if (!(scrollEl instanceof HTMLElement)) return;

  const rect = scrollEl.getBoundingClientRect();
  const localOffset = clamp(clientX - rect.left, 0, rect.width);
  const absoluteOffset = scrollEl.scrollLeft + localOffset;
  const safeScrollWidth = Math.max(scrollEl.scrollWidth, 1);

  chargePlanViewport.pendingAnchorRatio = absoluteOffset / safeScrollWidth;
  chargePlanViewport.pendingClientOffset = localOffset;
}

function rememberChargePlanCenterAnchor(scrollEl = getChargePlanScrollElement()) {
  if (!(scrollEl instanceof HTMLElement)) return;

  const rect = scrollEl.getBoundingClientRect();
  rememberChargePlanAnchor(scrollEl, rect.left + rect.width / 2);
}

function restoreChargePlanViewport() {
  const scrollEl = getChargePlanScrollElement();
  if (!(scrollEl instanceof HTMLElement)) return;

  requestAnimationFrame(() => {
    const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
    let didRestoreSpecificPosition = false;

    if (pendingChargePlanFocusDate) {
      const targetSlot = scrollEl.querySelector(
        `.charge-plan-slot[data-date-key="${pendingChargePlanFocusDate}"][data-slot-part="am"]`
      );
      if (targetSlot instanceof HTMLElement) {
        let nextScrollLeft =
          targetSlot.offsetLeft - scrollEl.clientWidth / 2 + targetSlot.offsetWidth;

        if (pendingChargePlanFocusAlign === "left") {
          nextScrollLeft = targetSlot.offsetLeft - scrollEl.clientWidth * 0.25;
        } else if (pendingChargePlanFocusAlign === "right") {
          nextScrollLeft = targetSlot.offsetLeft - scrollEl.clientWidth * 0.75;
        }

        scrollEl.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft);
        pendingChargePlanFocusDate = "";
        pendingChargePlanFocusAlign = "center";
        chargePlanViewport.pendingAnchorRatio = null;
        chargePlanViewport.pendingClientOffset = 0;
        didRestoreSpecificPosition = true;
      } else {
        pendingChargePlanFocusDate = "";
        pendingChargePlanFocusAlign = "center";
      }
    }

    if (!didRestoreSpecificPosition && Number.isFinite(chargePlanViewport.pendingAnchorRatio)) {
      const absoluteOffset =
        chargePlanViewport.pendingAnchorRatio * Math.max(scrollEl.scrollWidth, 1);
      scrollEl.scrollLeft = clamp(
        absoluteOffset - chargePlanViewport.pendingClientOffset,
        0,
        maxScrollLeft
      );
      chargePlanViewport.pendingAnchorRatio = null;
      chargePlanViewport.pendingClientOffset = 0;
      didRestoreSpecificPosition = true;
    }

    if (!didRestoreSpecificPosition) {
      scrollEl.scrollLeft = clamp(
        chargePlanViewport.scrollRatio * maxScrollLeft,
        0,
        maxScrollLeft
      );
    }

    captureChargePlanViewport(scrollEl);
    if (chargePlanPan) {
      chargePlanPan.scrollEl = scrollEl;
      chargePlanPan.startClientX = chargePlanPan.lastClientX;
      chargePlanPan.startScrollLeft = scrollEl.scrollLeft;
      chargePlanPan.isRebinding = false;
      scrollEl.classList.add("is-panning");
    }
  });
}

function getChargePlanViewportCenterDate(scrollEl) {
  if (!(scrollEl instanceof HTMLElement)) return "";

  const targetX = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
  const daySlots = Array.from(
    scrollEl.querySelectorAll('.charge-plan-slot[data-slot-part="am"]')
  );

  for (const slotEl of daySlots) {
    const slotMidX = slotEl.offsetLeft + slotEl.offsetWidth / 2;
    if (slotMidX >= targetX) {
      return String(slotEl.dataset.dateKey || "").trim();
    }
  }

  const lastSlot = daySlots[daySlots.length - 1];
  return String(lastSlot?.dataset?.dateKey || "").trim();
}

function getChargePlanViewportEdgeDate(scrollEl, side = "left") {
  if (!(scrollEl instanceof HTMLElement)) return "";

  const leftBound = scrollEl.scrollLeft;
  const rightBound = scrollEl.scrollLeft + scrollEl.clientWidth;
  const daySlots = Array.from(
    scrollEl.querySelectorAll('.charge-plan-slot[data-slot-part="am"]')
  );

  if (side === "right") {
    for (let index = daySlots.length - 1; index >= 0; index -= 1) {
      const slotEl = daySlots[index];
      const slotMidX = slotEl.offsetLeft + slotEl.offsetWidth / 2;
      if (slotMidX <= rightBound) {
        return String(slotEl.dataset.dateKey || "").trim();
      }
    }
  } else {
    for (const slotEl of daySlots) {
      const slotMidX = slotEl.offsetLeft + slotEl.offsetWidth / 2;
      if (slotMidX >= leftBound) {
        return String(slotEl.dataset.dateKey || "").trim();
      }
    }
  }

  const fallbackSlot = side === "right" ? daySlots[daySlots.length - 1] : daySlots[0];
  return String(fallbackSlot?.dataset?.dateKey || "").trim();
}

function queueChargePlanRangeRefresh({ anchorDate, focusDate, focusAlign = "center" }) {
  const normalizedAnchorDate = String(anchorDate || "").trim();
  const normalizedFocusDate = String(focusDate || normalizedAnchorDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedAnchorDate)) {
    return;
  }

  if (
    chargePlanRangeRefreshPending ||
    normalizedAnchorDate === String(state.chargePlanAnchorDate || "").trim()
  ) {
    return;
  }

  chargePlanRangeRefreshPending = true;
  pendingChargePlanFocusDate = normalizedFocusDate;
  pendingChargePlanFocusAlign = focusAlign;
  if (chargePlanPan) {
    chargePlanPan.isRebinding = true;
  }

  requestAnimationFrame(() => {
    chargePlanRangeRefreshPending = false;
    setState({ chargePlanAnchorDate: normalizedAnchorDate });
    renderApp();
  });
}

function maybeExtendChargePlanRange(scrollEl, direction = "") {
  if (!(scrollEl instanceof HTMLElement)) return;
  if (chargeTimelineDrag || chargePlanRangeRefreshPending) return;

  const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
  if (maxScrollLeft <= 0) return;

  const threshold = APP_CONFIG.chargeTimeline.edgeNavigationThresholdPx;
  const nearLeftEdge = scrollEl.scrollLeft <= threshold;
  const nearRightEdge = maxScrollLeft - scrollEl.scrollLeft <= threshold;

  if (direction === "earlier" && nearLeftEdge) {
    const edgeDate = getChargePlanViewportEdgeDate(scrollEl, "left");
    if (!edgeDate) return;

    queueChargePlanRangeRefresh({
      anchorDate: edgeDate,
      focusDate: edgeDate,
      focusAlign: "left",
    });
    return;
  }

  if (direction === "later" && nearRightEdge) {
    const edgeDate = getChargePlanViewportEdgeDate(scrollEl, "right");
    if (!edgeDate) return;

    queueChargePlanRangeRefresh({
      anchorDate: edgeDate,
      focusDate: edgeDate,
      focusAlign: "right",
    });
    return;
  }
}

function setChargePlanZoomMode(nextMode, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(APP_CONFIG.chargeTimeline.zoomModes, nextMode)) {
    return;
  }

  const scrollEl = getChargePlanScrollElement();
  if (options.anchorClientX != null && scrollEl) {
    rememberChargePlanAnchor(scrollEl, options.anchorClientX);
  } else {
    rememberChargePlanCenterAnchor(scrollEl);
  }

  setState({
    chargePlanZoomMode: nextMode,
    chargePlanZoomScale: APP_CONFIG.chargeTimeline.defaultZoomScale,
  });
  renderApp();
}

function setChargePlanZoomScale(nextScale, options = {}) {
  const normalizedScale = clamp(
    Number(nextScale) || APP_CONFIG.chargeTimeline.defaultZoomScale,
    APP_CONFIG.chargeTimeline.minZoomScale,
    APP_CONFIG.chargeTimeline.maxZoomScale
  );

  if (Math.abs(normalizedScale - state.chargePlanZoomScale) < 0.001) {
    return;
  }

  const scrollEl = getChargePlanScrollElement();
  if (options.anchorClientX != null && scrollEl) {
    rememberChargePlanAnchor(scrollEl, options.anchorClientX);
  } else {
    rememberChargePlanCenterAnchor(scrollEl);
  }

  setState({ chargePlanZoomScale: normalizedScale });
  renderApp();
}

function navigateChargePlanToDate(rawDateValue) {
  const dateValue = String(rawDateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return;
  }

  const targetDate = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(targetDate.getTime())) {
    return;
  }

  pendingChargePlanFocusDate = dateValue;
  pendingChargePlanFocusAlign = "center";
  setState({
    chargePlanAnchorDate: dateValue,
  });
  renderApp();
}

function closeChargePlanContextMenu() {
  if (!dom?.chargePlanBoard) return;
  hideChargePlanContextMenu(dom.chargePlanBoard);
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

async function handleChargePlanContextAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (!target.classList.contains("charge-plan-context-action")) return;

  const action = target.dataset.action || "";
  const menuEl = target.closest(".charge-plan-context-menu");
  const segmentId = Number(menuEl?.dataset.segmentId);
  closeChargePlanContextMenu();

  if (action !== "delete-segment" || !Number.isInteger(segmentId)) {
    return;
  }

  setChargePlanFeedback(dom.chargePlanBoard, "");
  await removeTimeSegment(segmentId);
  await loadData();
}

function handleChargePlanContextMenu(event) {
  if (!(event.target instanceof Element)) return;

  const segmentEl = event.target.closest(".charge-plan-segment-bar");
  if (!(segmentEl instanceof HTMLElement)) {
    closeChargePlanContextMenu();
    return;
  }

  const segmentId = Number(segmentEl.dataset.segmentId);
  if (!Number.isInteger(segmentId)) {
    closeChargePlanContextMenu();
    return;
  }

  event.preventDefault();
  setChargePlanFeedback(dom.chargePlanBoard, "");
  showChargePlanContextMenu(dom.chargePlanBoard, {
    clientX: event.clientX,
    clientY: event.clientY,
    segmentId,
  });
}

function handleChargePlanHeaderWheel(event) {
  if (!(event.target instanceof Element)) return;

  const headerTrack = event.target.closest(".charge-plan-header-track");
  if (!(headerTrack instanceof HTMLElement)) return;
  if (chargePlanPan || chargeTimelineDrag) return;
  event.preventDefault();

  const nextScale =
    event.deltaY < 0
      ? state.chargePlanZoomScale * APP_CONFIG.chargeTimeline.wheelZoomFactor
      : state.chargePlanZoomScale / APP_CONFIG.chargeTimeline.wheelZoomFactor;

  closeChargePlanContextMenu();
  setChargePlanZoomScale(nextScale, { anchorClientX: event.clientX });
}

function handleChargePlanZoomButtonClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (!target.classList.contains("charge-plan-zoom-btn")) return;

  const nextZoomMode = target.dataset.chargePlanZoom || "";
  if (!nextZoomMode) {
    return;
  }

  closeChargePlanContextMenu();
  setChargePlanZoomMode(nextZoomMode);
}

function handleChargePlanDateControls(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const todayButton = target.closest(".charge-plan-date-jump-btn");
  if (todayButton instanceof HTMLButtonElement) {
    closeChargePlanContextMenu();
    navigateChargePlanToDate(toDateInputValue(new Date()));
  }
}

function handleChargePlanDateInputChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("charge-plan-date-input")) return;

  closeChargePlanContextMenu();
  navigateChargePlanToDate(target.value);
}

function handleChargePlanPointerDown(event) {
  if (!(event.target instanceof Element)) return;
  if (event.button !== 0) return;
  if (event.target.closest(".charge-plan-context-menu")) return;

  const headerTrack = event.target.closest(".charge-plan-header-track");
  if (headerTrack instanceof HTMLElement) {
    const scrollEl = headerTrack.closest(".charge-plan-scroll");
    if (!(scrollEl instanceof HTMLElement)) return;

    event.preventDefault();
    closeChargePlanContextMenu();
    chargePlanPan = {
      scrollEl,
      startClientX: event.clientX,
      startScrollLeft: scrollEl.scrollLeft,
      lastClientX: event.clientX,
      isRebinding: false,
      direction: "",
    };
    scrollEl.classList.add("is-panning");
    return;
  }

  closeChargePlanContextMenu();

  const trackEl = event.target.closest(".charge-plan-track");
  if (!trackEl || trackEl.classList.contains("charge-plan-track--readonly")) return;

  const resizeHandleEl = event.target.closest(".charge-plan-segment-handle");
  const segmentEl = event.target.closest(".charge-plan-segment-bar");

  event.preventDefault();

  if (segmentEl instanceof HTMLElement) {
    const workerId = Number(segmentEl.dataset.workerId);
    const segmentId = Number(segmentEl.dataset.segmentId);
    const startSlotIndex = Number(segmentEl.dataset.startSlotIndex);
    const endSlotIndex = Number(segmentEl.dataset.endSlotIndex);
    let edge = resizeHandleEl?.dataset.resizeEdge || "";

    if (!edge && segmentEl.classList.contains("is-compact")) {
      const segmentRect = segmentEl.getBoundingClientRect();
      const clickRatio =
        segmentRect.width > 0
          ? (event.clientX - segmentRect.left) / segmentRect.width
          : 1;
      edge = clickRatio <= 0.5 ? "start" : "end";
    }

    if (
      !Number.isInteger(workerId) ||
      !Number.isInteger(segmentId) ||
      !Number.isInteger(startSlotIndex) ||
      !Number.isInteger(endSlotIndex) ||
      (edge !== "start" && edge !== "end")
    ) {
      if (segmentEl) return;
    }

    if (edge === "start" || edge === "end") {
      const initialSelection = annotateChargePlanSelection(
        workerId,
        computeChargePlanSelectionFromSlotIndexes(trackEl, startSlotIndex, endSlotIndex),
        { ignoreSegmentId: segmentId }
      );

      setChargePlanFeedback(dom.chargePlanBoard, "");
      segmentEl.classList.add("is-resizing");
      chargeTimelineDrag = {
        mode: "resize",
        trackEl,
        workerId,
        segmentId,
        segmentEl,
        edge,
        fixedSlotIndex: edge === "start" ? endSlotIndex : startSlotIndex,
        currentSelection: initialSelection,
      };

      syncChargePlanFeedback(initialSelection);
      updateChargePlanSelectionPreview(trackEl, initialSelection);
      return;
    }
  }

  if (segmentEl) return;

  const workerId = Number(trackEl.dataset.workerId);
  if (!Number.isInteger(workerId)) return;

  setChargePlanFeedback(dom.chargePlanBoard, "");

  chargeTimelineDrag = {
    mode: "create",
    trackEl,
    workerId,
    startClientX: event.clientX,
    currentSelection: annotateChargePlanSelection(
      workerId,
      computeChargePlanSelection(trackEl, event.clientX, event.clientX)
    ),
  };

  syncChargePlanFeedback(chargeTimelineDrag.currentSelection);
  updateChargePlanSelectionPreview(trackEl, chargeTimelineDrag.currentSelection);
}

function handleChargePlanPointerMove(event) {
  if (chargePlanPan) {
    if (chargePlanPan.isRebinding) {
      return;
    }

    chargePlanPan.lastClientX = event.clientX;
    const deltaX = event.clientX - chargePlanPan.startClientX;
    if (deltaX > 0) {
      chargePlanPan.direction = "earlier";
    } else if (deltaX < 0) {
      chargePlanPan.direction = "later";
    }
    chargePlanPan.scrollEl.scrollLeft = chargePlanPan.startScrollLeft - deltaX;
    captureChargePlanViewport(chargePlanPan.scrollEl);
    maybeExtendChargePlanRange(chargePlanPan.scrollEl, chargePlanPan.direction);
    return;
  }

  if (!chargeTimelineDrag) return;

  if (chargeTimelineDrag.mode === "resize") {
    const movingSlotIndex = getChargePlanSlotIndexAtClientX(
      chargeTimelineDrag.trackEl,
      event.clientX
    );
    if (movingSlotIndex < 0) return;

    let startSlotIndex =
      chargeTimelineDrag.edge === "start"
        ? Math.min(movingSlotIndex, chargeTimelineDrag.fixedSlotIndex)
        : chargeTimelineDrag.fixedSlotIndex;
    let endSlotIndex =
      chargeTimelineDrag.edge === "end"
        ? Math.max(movingSlotIndex, chargeTimelineDrag.fixedSlotIndex)
        : chargeTimelineDrag.fixedSlotIndex;

    if (chargeTimelineDrag.edge === "start") {
      endSlotIndex = chargeTimelineDrag.fixedSlotIndex;
    } else {
      startSlotIndex = chargeTimelineDrag.fixedSlotIndex;
    }

    chargeTimelineDrag.currentSelection = annotateChargePlanSelection(
      chargeTimelineDrag.workerId,
      computeChargePlanSelectionFromSlotIndexes(
        chargeTimelineDrag.trackEl,
        startSlotIndex,
        endSlotIndex
      ),
      { ignoreSegmentId: chargeTimelineDrag.segmentId }
    );
  } else {
    chargeTimelineDrag.currentSelection = annotateChargePlanSelection(
      chargeTimelineDrag.workerId,
      computeChargePlanSelection(
        chargeTimelineDrag.trackEl,
        chargeTimelineDrag.startClientX,
        event.clientX
      )
    );
  }

  syncChargePlanFeedback(chargeTimelineDrag.currentSelection);
  updateChargePlanSelectionPreview(
    chargeTimelineDrag.trackEl,
    chargeTimelineDrag.currentSelection
  );
}

async function handleChargePlanPointerUp() {
  if (chargePlanPan) {
    chargePlanPan.scrollEl.classList.remove("is-panning");
    captureChargePlanViewport(chargePlanPan.scrollEl);
    maybeExtendChargePlanRange(chargePlanPan.scrollEl, chargePlanPan.direction);
    chargePlanPan = null;
  }

  if (!chargeTimelineDrag) return;

  const { trackEl, workerId, currentSelection } = chargeTimelineDrag;
  if (chargeTimelineDrag.segmentEl instanceof HTMLElement) {
    chargeTimelineDrag.segmentEl.classList.remove("is-resizing");
  }
  clearChargePlanSelectionPreview(trackEl);
  const dragState = chargeTimelineDrag;
  chargeTimelineDrag = null;

  if (
    !currentSelection ||
    currentSelection.totalDays <= 0
  ) {
    setChargePlanFeedback(dom.chargePlanBoard, "");
    return;
  }

  if (currentSelection.hasOverlap) {
    syncChargePlanFeedback(currentSelection);
    return;
  }

  setChargePlanFeedback(dom.chargePlanBoard, "");
  if (dragState.mode === "resize") {
    await resizeChargePlanSegment(dragState.segmentId, currentSelection);
    return;
  }

  await createChargePlanSegment(workerId, currentSelection);
}

async function handleChargePlanDoubleClick(event) {
  closeChargePlanContextMenu();
}

function handleChargePlanScroll(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("charge-plan-scroll")) return;

  captureChargePlanViewport(target);
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
  dom.chargePlanBoard.addEventListener("click", handleChargePlanZoomButtonClick);
  dom.chargePlanBoard.addEventListener("click", handleChargePlanDateControls);
  dom.chargePlanBoard.addEventListener("change", handleChargePlanDateInputChange);
  dom.chargePlanBoard.addEventListener("click", (event) => {
    handleChargePlanContextAction(event).catch((error) => {
      console.error("Erreur action menu timeline :", error);
    });
  });
  dom.chargePlanBoard.addEventListener("contextmenu", handleChargePlanContextMenu);
  dom.chargePlanBoard.addEventListener("wheel", handleChargePlanHeaderWheel, {
    passive: false,
  });
  dom.chargePlanBoard.addEventListener("scroll", handleChargePlanScroll, true);
  dom.chargePlanBoard.addEventListener("pointerdown", handleChargePlanPointerDown);
  dom.chargePlanBoard.addEventListener("dblclick", (event) => {
    handleChargePlanDoubleClick(event);
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      closeChargePlanContextMenu();
      return;
    }

    if (event.target.closest(".charge-plan-context-menu")) {
      return;
    }

    closeChargePlanContextMenu();
  });
  window.addEventListener("scroll", closeChargePlanContextMenu, true);
  window.addEventListener("pointermove", handleChargePlanPointerMove);
  window.addEventListener("pointerup", () => {
    handleChargePlanPointerUp().catch((error) => {
      console.error("Erreur sauvegarde timeline :", error);
    });
  });
  window.addEventListener("pointercancel", () => {
    if (chargePlanPan) {
      chargePlanPan.scrollEl.classList.remove("is-panning");
      captureChargePlanViewport(chargePlanPan.scrollEl);
      chargePlanPan = null;
    }
    if (!chargeTimelineDrag) return;
    if (chargeTimelineDrag.segmentEl instanceof HTMLElement) {
      chargeTimelineDrag.segmentEl.classList.remove("is-resizing");
    }
    clearChargePlanSelectionPreview(chargeTimelineDrag.trackEl);
    setChargePlanFeedback(dom.chargePlanBoard, "");
    closeChargePlanContextMenu();
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
