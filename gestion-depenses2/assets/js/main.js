import { clamp, parseOptionalNumberInput } from "./utils/format.js";
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
  getProjectAverageAnchorDate,
  getEarliestProjectMonth,
  getProjectFirstAnchorDate,
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
  hideChargePlanDatePicker,
  renderChargePlanTimeline,
  setChargePlanFeedback,
  showChargePlanDatePicker,
  showChargePlanContextMenu,
  updateChargePlanSelectionPreview,
} from "./ui/chargeTimeline.js";
import { clearKpi, renderKpi } from "./ui/kpi.js";
import {
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
let chargePlanVisibleDateTimer = null;
let chargePlanViewportRestoreFrame = null;
let suppressChargePlanScrollEvents = false;
let chargePlanScrollSyncFrame = null;
let chargePlanWheelZoomFrame = null;
let pendingChargePlanWheelRequest = null;
let renderedChargePlanRangeStartDate = "";
let chargePlanRangeStartDate = "";
const chargePlanViewport = {
  scrollRatio: 0,
  pendingLeftDayOffset: null,
};
let pendingChargePlanFocusDate = "";
let pendingChargePlanFocusAlign = "center";
let chargePlanDatePickerView = null;
const PARIS_TIMEZONE = "Europe/Paris";

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayDateValueInTimeZone(timeZone = PARIS_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";

  if (!year || !month || !day) {
    return toDateInputValue(new Date());
  }

  return `${year}-${month}-${day}`;
}

function normalizeChargePlanDateValue(rawValue) {
  const normalizedValue = String(rawValue || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) ? normalizedValue : "";
}

function getChargePlanMonthStartDateValue(rawValue) {
  const normalizedDateValue = normalizeChargePlanDateValue(rawValue);
  if (!normalizedDateValue) {
    return "";
  }

  const date = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return toDateInputValue(new Date(date.getFullYear(), date.getMonth(), 1, 12));
}

function shiftChargePlanRangeStartDate(rawValue, monthDelta = 0) {
  const monthStartDateValue = getChargePlanMonthStartDateValue(rawValue);
  if (!monthStartDateValue) {
    return "";
  }

  const date = new Date(`${monthStartDateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setMonth(date.getMonth() + monthDelta);
  return toDateInputValue(new Date(date.getFullYear(), date.getMonth(), 1, 12));
}

function getChargePlanWindowStartDate(rawValue) {
  const monthStartDateValue = getChargePlanMonthStartDateValue(rawValue);
  if (!monthStartDateValue) {
    return "";
  }

  const monthOffset = -Math.floor(APP_CONFIG.chargeTimeline.visibleMonthSpan / 2);
  return shiftChargePlanRangeStartDate(monthStartDateValue, monthOffset);
}

function setChargePlanRangeStartDate(rawValue) {
  chargePlanRangeStartDate = getChargePlanWindowStartDate(rawValue);
}

function getChargePlanRangeStartDate() {
  const normalizedRangeStartDate = getChargePlanMonthStartDateValue(chargePlanRangeStartDate);
  if (normalizedRangeStartDate) {
    return normalizedRangeStartDate;
  }

  const fallbackRangeStartDate = getChargePlanWindowStartDate(state.chargePlanAnchorDate);
  chargePlanRangeStartDate = fallbackRangeStartDate;
  return fallbackRangeStartDate;
}

function getChargePlanFixedColumnsWidthEstimate(boardEl = dom?.chargePlanBoard || null) {
  if (!(boardEl instanceof HTMLElement)) {
    return 150 + 120 + 100;
  }

  const styles = window.getComputedStyle(boardEl);
  const nameWidth = parseFloat(styles.getPropertyValue("--charge-plan-name-col-width"));
  const actionsWidth = parseFloat(
    styles.getPropertyValue("--charge-plan-actions-col-width")
  );
  const totalWidth = parseFloat(styles.getPropertyValue("--charge-plan-total-col-width"));

  return (
    (Number.isFinite(nameWidth) ? nameWidth : 150) +
    (Number.isFinite(actionsWidth) ? actionsWidth : 120) +
    (Number.isFinite(totalWidth) ? totalWidth : 100)
  );
}

function getChargePlanTimelineViewportGeometry(scrollEl = getChargePlanScrollElement()) {
  const boardEl = dom?.chargePlanBoard || null;
  const fixedColumnsWidth = getChargePlanFixedColumnsWidthEstimate(boardEl);
  const viewportWidth = Math.max(
    280,
    Math.max(scrollEl?.clientWidth || 0, 0) - fixedColumnsWidth
  );

  return {
    clientLeft: fixedColumnsWidth,
    viewportWidth,
  };
}

function estimateChargePlanDisplayedDate(rangeStartDate, visibleDays) {
  const normalizedRangeStartDate = normalizeChargePlanDateValue(rangeStartDate);
  const rangeStartDateObject = parseChargePlanDateValue(normalizedRangeStartDate);
  const rangeStartDayNumber = getChargePlanUtcDayNumber(rangeStartDateObject);
  if (!normalizedRangeStartDate || rangeStartDayNumber == null) {
    return "";
  }

  if (pendingChargePlanFocusDate) {
    if (pendingChargePlanFocusAlign === "left") {
      return pendingChargePlanFocusDate;
    }

    const focusDate = parseChargePlanDateValue(pendingChargePlanFocusDate);
    const focusDayNumber = getChargePlanUtcDayNumber(focusDate);
    if (focusDayNumber != null) {
      let leftDayOffset = focusDayNumber - rangeStartDayNumber;
      if (pendingChargePlanFocusAlign === "center") {
        leftDayOffset -= visibleDays / 2;
      } else if (pendingChargePlanFocusAlign === "right") {
        leftDayOffset -= visibleDays - 1;
      }

      return getChargePlanDateValueFromUtcDayNumber(
        rangeStartDayNumber + Math.max(0, Math.floor(leftDayOffset))
      );
    }
  }

  if (Number.isFinite(chargePlanViewport.pendingLeftDayOffset)) {
    return getChargePlanDateValueFromUtcDayNumber(
      rangeStartDayNumber +
        Math.max(0, Math.floor(Number(chargePlanViewport.pendingLeftDayOffset)))
    );
  }

  return normalizeChargePlanDateValue(state.chargePlanAnchorDate);
}

function cloneBudgetLines(lines) {
  return JSON.parse(JSON.stringify(lines || []));
}

function syncStateToProjectStart(project) {
  const firstAnchor = getProjectFirstAnchorDate(project);
  if (firstAnchor?.dateValue) {
    const anchorDate = firstAnchor.dateValue;
    setPendingChargePlanFocus(anchorDate, "left");
    setChargePlanRangeStartDate(anchorDate);
    setState({
      selectedYear: firstAnchor.year,
      selectedMonth: firstAnchor.monthIndex,
      chargePlanAnchorDate: anchorDate,
    });
    return;
  }

  const averageAnchor = getProjectAverageAnchorDate(project);
  if (averageAnchor?.dateValue) {
    const anchorDate = averageAnchor.dateValue;
    setPendingChargePlanFocus(anchorDate, "center");
    setChargePlanRangeStartDate(anchorDate);
    setState({
      selectedYear: averageAnchor.year,
      selectedMonth: averageAnchor.monthIndex,
      chargePlanAnchorDate: anchorDate,
    });
    return;
  }

  const earliestMonth = getEarliestProjectMonth(project);
  if (earliestMonth) {
    const anchorDate = `${earliestMonth.year}-${String(
      earliestMonth.monthIndex + 1
    ).padStart(2, "0")}-01`;
    setPendingChargePlanFocus(anchorDate, "left");
    setChargePlanRangeStartDate(anchorDate);
    setState({
      selectedYear: earliestMonth.year,
      selectedMonth: earliestMonth.monthIndex,
      chargePlanAnchorDate: anchorDate,
    });
    return;
  }

  const now = new Date();
  const anchorDate = getTodayDateValueInTimeZone();
  setPendingChargePlanFocus(anchorDate, "left");
  setChargePlanRangeStartDate(anchorDate);
  setState({
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    chargePlanAnchorDate: anchorDate,
  });
}

function renderApp() {
  renderProjectOptions(dom.projectSelect, state.projects, state.selectedProjectId);
  const selectedProject = getSelectedProject();
  renderWorkerOptions(dom.workerNameSelect, state.teamMembers, selectedProject);
  dom.saveWorkerBtn.disabled = dom.workerNameSelect.disabled || !selectedProject;
  renderBudgetPreview(dom.budgetLinesContainer, state.newProjectBudgetLines);

  if (!selectedProject) {
    clearProjectSummary(dom);
    clearKpi(dom);
    clearChargePlanTimeline(dom);
    clearTables(dom);
    state.spendingChart = destroyChart(state.spendingChart);
    return;
  }

  renderProjectSummary(dom, selectedProject, getProjectBudgetTotal(selectedProject));
  renderChargePlanSection(selectedProject);
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

function renderChargePlanSection(selectedProject = getSelectedProject()) {
  if (!selectedProject) {
    renderedChargePlanRangeStartDate = "";
    setChargePlanRangeStartDate("");
    clearChargePlanTimeline(dom);
    return;
  }

  if (!renderedChargePlanRangeStartDate) {
    const initialVisibleDate = normalizeChargePlanDateValue(state.chargePlanAnchorDate);
    if (initialVisibleDate && !pendingChargePlanFocusDate) {
      setPendingChargePlanFocus(initialVisibleDate, "left");
    }
  }

  const rangeStartDate = getChargePlanRangeStartDate();
  renderedChargePlanRangeStartDate = rangeStartDate;
  const derivedZoomState = getChargePlanZoomStateFromVisibleDays(
    state.chargePlanVisibleDays
  );
  const displayedDateValue =
    estimateChargePlanDisplayedDate(
      rangeStartDate,
      derivedZoomState.chargePlanVisibleDays
    ) ||
    normalizeChargePlanDateValue(getChargePlanDatePickerValue()) ||
    normalizeChargePlanDateValue(getChargePlanViewportEdgeDate(getChargePlanScrollElement(), "left")) ||
    normalizeChargePlanDateValue(state.chargePlanAnchorDate);

  renderChargePlanTimeline(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
    chargePlanZoomMode: derivedZoomState.chargePlanZoomMode,
    chargePlanZoomScale: derivedZoomState.chargePlanZoomScale,
    chargePlanVisibleDays: derivedZoomState.chargePlanVisibleDays,
    chargePlanAnchorDate: state.chargePlanAnchorDate,
    chargePlanDisplayedDate: displayedDateValue,
    chargePlanRangeStartDate: rangeStartDate,
  });
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
    setChargePlanRangeStartDate("");
    setState({ selectedProjectId: null });
  }

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

function getChargePlanHeaderTrack(scrollEl = getChargePlanScrollElement()) {
  return scrollEl?.querySelector(".charge-plan-header-track") || null;
}

function formatChargePlanDateLabel(dateValue) {
  const date = new Date(`${String(dateValue || "").trim()}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(dateValue || "").trim();
  }

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function updateChargePlanDateTrigger(dateValue) {
  const { triggerEl, popoverEl } = getChargePlanDatePickerElements();
  if (!(triggerEl instanceof HTMLButtonElement)) {
    return;
  }

  const normalizedDateValue = String(dateValue || "").trim();
  if (triggerEl.dataset.dateValue === normalizedDateValue) {
    return;
  }

  triggerEl.dataset.dateValue = normalizedDateValue;

  const valueEl = triggerEl.querySelector(".charge-plan-date-trigger-value");
  if (valueEl instanceof HTMLElement) {
    valueEl.textContent = formatChargePlanDateLabel(normalizedDateValue);
  }

  if (popoverEl instanceof HTMLElement) {
    popoverEl.dataset.selectedDate = normalizedDateValue;
  }
}

function captureChargePlanViewport(scrollEl = getChargePlanScrollElement()) {
  if (!(scrollEl instanceof HTMLElement)) return;

  const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
  chargePlanViewport.scrollRatio =
    maxScrollLeft > 0 ? scrollEl.scrollLeft / maxScrollLeft : 0;
}

function getElementContentLeft(element, scrollEl) {
  if (!(element instanceof HTMLElement) || !(scrollEl instanceof HTMLElement)) {
    return 0;
  }

  const elementRect = element.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  const offset = scrollEl.scrollLeft + (elementRect.left - scrollRect.left);

  return Number.isFinite(offset) ? offset : 0;
}

function parseChargePlanDateValue(rawValue) {
  const normalizedDateValue = normalizeChargePlanDateValue(rawValue);
  if (!normalizedDateValue) {
    return null;
  }

  const date = new Date(`${normalizedDateValue}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getChargePlanUtcDayNumber(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}

function getChargePlanDateValueFromUtcDayNumber(dayNumber) {
  if (!Number.isFinite(dayNumber)) {
    return "";
  }

  const utcDate = new Date(dayNumber * 86400000);
  if (Number.isNaN(utcDate.getTime())) {
    return "";
  }

  return toDateInputValue(
    new Date(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth(),
      utcDate.getUTCDate(),
      12
    )
  );
}

function getChargePlanDateValueFromDayOffset(metrics, dayOffset, rounding = "floor") {
  if (!metrics || !Number.isFinite(dayOffset)) {
    return "";
  }

  const normalizedDayOffset =
    rounding === "round" ? Math.round(dayOffset) : Math.floor(dayOffset);
  const clampedDayOffset = clamp(
    normalizedDayOffset,
    0,
    Math.max(metrics.totalDays - 1, 0)
  );

  return getChargePlanDateValueFromUtcDayNumber(
    metrics.rangeStartDayNumber + clampedDayOffset
  );
}

function getChargePlanTimelineMetrics(scrollEl = getChargePlanScrollElement()) {
  if (!(scrollEl instanceof HTMLElement)) {
    return null;
  }

  const headerTrack = getChargePlanHeaderTrack(scrollEl);
  if (!(headerTrack instanceof HTMLElement)) {
    return null;
  }

  const trackWidth = Math.max(
    Number(headerTrack.dataset.timelineWidth) || 0,
    headerTrack.scrollWidth || 0,
    headerTrack.offsetWidth || 0
  );
  const totalDays = Math.max(Number(headerTrack.dataset.totalDays) || 0, 0);
  const rangeStartDate = parseChargePlanDateValue(headerTrack.dataset.rangeStartDate);
  const rangeStartDayNumber = getChargePlanUtcDayNumber(rangeStartDate);

  if (!trackWidth || !totalDays || rangeStartDayNumber == null) {
    return null;
  }

  return {
    trackLeft: getElementContentLeft(headerTrack, scrollEl),
    trackWidth,
    totalDays,
    dayWidth: trackWidth / totalDays,
    rangeStartDayNumber,
  };
}

function getChargePlanDayOffsetAtContentOffset(scrollEl, contentOffset) {
  const metrics = getChargePlanTimelineMetrics(scrollEl);
  if (!metrics) {
    return null;
  }

  const relativeOffset = clamp(
    contentOffset - metrics.trackLeft,
    0,
    metrics.trackWidth
  );

  return {
    metrics,
    dayOffset: relativeOffset / Math.max(metrics.dayWidth, 0.0001),
  };
}

function getChargePlanDateValueAtContentOffset(
  scrollEl,
  contentOffset,
  rounding = "floor"
) {
  const measurement = getChargePlanDayOffsetAtContentOffset(scrollEl, contentOffset);
  if (!measurement) {
    return "";
  }

  const { metrics, dayOffset } = measurement;
  const clampedDayIndex = clamp(
    rounding === "round" ? Math.round(dayOffset) : Math.floor(dayOffset),
    0,
    Math.max(metrics.totalDays - 1, 0)
  );

  return getChargePlanDateValueFromUtcDayNumber(
    metrics.rangeStartDayNumber + clampedDayIndex
  );
}

function clearChargePlanPendingViewportAnchor() {
  chargePlanViewport.pendingLeftDayOffset = null;
}

function setPendingChargePlanLeftDayOffset(dayOffset) {
  clearChargePlanPendingViewportAnchor();
  if (Number.isFinite(dayOffset)) {
    chargePlanViewport.pendingLeftDayOffset = Number(dayOffset);
  }
}

function setPendingChargePlanFocus(dateValue, align = "left") {
  clearChargePlanPendingViewportAnchor();
  pendingChargePlanFocusDate = normalizeChargePlanDateValue(dateValue);
  pendingChargePlanFocusAlign = align;
}

function getChargePlanViewportAnchorRatio(
  scrollEl = getChargePlanScrollElement(),
  clientX = null
) {
  if (!(scrollEl instanceof HTMLElement)) {
    return 0;
  }

  if (clientX == null) {
    return 0;
  }

  const rect = scrollEl.getBoundingClientRect();
  const geometry = getChargePlanTimelineViewportGeometry(scrollEl);
  const localOffset = clamp(
    clientX - rect.left - geometry.clientLeft,
    0,
    geometry.viewportWidth
  );

  return geometry.viewportWidth > 0 ? localOffset / geometry.viewportWidth : 0;
}

function getChargePlanViewportLeftDayOffset(scrollEl = getChargePlanScrollElement()) {
  if (!(scrollEl instanceof HTMLElement)) {
    return null;
  }

  const geometry = getChargePlanTimelineViewportGeometry(scrollEl);
  const leftContentOffset = scrollEl.scrollLeft + geometry.clientLeft;
  const measurement = getChargePlanDayOffsetAtContentOffset(scrollEl, leftContentOffset);
  return measurement ? measurement.dayOffset : null;
}

function getChargePlanNextLeftDayOffset(
  scrollEl,
  nextVisibleDays,
  anchorRatio = 0
) {
  const currentLeftDayOffset = getChargePlanViewportLeftDayOffset(scrollEl);
  if (!Number.isFinite(currentLeftDayOffset)) {
    return null;
  }

  const currentVisibleDays = getCurrentChargePlanVisibleDays();
  const normalizedAnchorRatio = clamp(anchorRatio, 0, 1);
  const metrics = getChargePlanTimelineMetrics(scrollEl);

  return clamp(
    currentLeftDayOffset +
      normalizedAnchorRatio * currentVisibleDays -
      normalizedAnchorRatio * Math.max(nextVisibleDays, 1),
    0,
    Math.max((metrics?.totalDays || 1) - 1, 0)
  );
}

function restoreChargePlanViewport() {
  const scrollEl = getChargePlanScrollElement();
  if (!(scrollEl instanceof HTMLElement)) return;

  if (chargePlanViewportRestoreFrame != null) {
    cancelAnimationFrame(chargePlanViewportRestoreFrame);
    chargePlanViewportRestoreFrame = null;
  }

  suppressChargePlanScrollEvents = true;
  requestAnimationFrame(() => {
    const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
    const metrics = getChargePlanTimelineMetrics(scrollEl);
    const geometry = getChargePlanTimelineViewportGeometry(scrollEl);
    let nextScrollLeft = null;

    if (pendingChargePlanFocusDate) {
      const targetDate = parseChargePlanDateValue(pendingChargePlanFocusDate);
      const targetDayNumber = getChargePlanUtcDayNumber(targetDate);
      if (metrics && targetDayNumber != null) {
        const dayOffset = clamp(
          targetDayNumber - metrics.rangeStartDayNumber,
          0,
          Math.max(metrics.totalDays - 1, 0)
        );
        const tickOffset = metrics.trackLeft + dayOffset * metrics.dayWidth;
        nextScrollLeft =
          tickOffset -
          geometry.clientLeft -
          geometry.viewportWidth / 2 +
          metrics.dayWidth / 2;

        if (pendingChargePlanFocusAlign === "left") {
          nextScrollLeft = tickOffset - geometry.clientLeft;
        } else if (pendingChargePlanFocusAlign === "right") {
          nextScrollLeft =
            tickOffset - geometry.clientLeft - geometry.viewportWidth + metrics.dayWidth;
        }

        clearChargePlanPendingViewportAnchor();
        pendingChargePlanFocusDate = "";
        pendingChargePlanFocusAlign = "center";
      } else {
        pendingChargePlanFocusDate = "";
        pendingChargePlanFocusAlign = "center";
      }
    }

    if (
      nextScrollLeft == null &&
      Number.isFinite(chargePlanViewport.pendingLeftDayOffset) &&
      metrics
    ) {
      const absoluteOffset =
        metrics.trackLeft +
        clamp(
          Number(chargePlanViewport.pendingLeftDayOffset),
          0,
          Math.max(metrics.totalDays, 0)
        ) *
          metrics.dayWidth;
      nextScrollLeft = absoluteOffset - geometry.clientLeft;
      clearChargePlanPendingViewportAnchor();
    }

    if (nextScrollLeft == null && metrics) {
      const anchorDate = parseChargePlanDateValue(state.chargePlanAnchorDate);
      const anchorDayNumber = getChargePlanUtcDayNumber(anchorDate);

      if (anchorDayNumber != null) {
        const dayOffset = clamp(
          anchorDayNumber - metrics.rangeStartDayNumber,
          0,
          Math.max(metrics.totalDays - 1, 0)
        );
        nextScrollLeft =
          metrics.trackLeft + dayOffset * metrics.dayWidth - geometry.clientLeft;
      }
    }

    if (nextScrollLeft == null) {
      nextScrollLeft = chargePlanViewport.scrollRatio * maxScrollLeft;
    }

    scrollEl.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft);

    captureChargePlanViewport(scrollEl);
    syncChargePlanVisibleDate(scrollEl, { persist: true });
    if (chargePlanPan) {
      chargePlanPan.scrollEl = scrollEl;
      chargePlanPan.startClientX = chargePlanPan.lastClientX;
      chargePlanPan.startScrollLeft = scrollEl.scrollLeft;
      scrollEl.classList.add("is-panning");
    }

    chargePlanViewportRestoreFrame = requestAnimationFrame(() => {
      suppressChargePlanScrollEvents = false;
      chargePlanViewportRestoreFrame = null;
    });
  });
}

function getChargePlanViewportEdgeDate(scrollEl, side = "left") {
  if (!(scrollEl instanceof HTMLElement)) return "";
  const geometry = getChargePlanTimelineViewportGeometry(scrollEl);

  return getChargePlanDateValueAtContentOffset(
    scrollEl,
    side === "right"
      ? scrollEl.scrollLeft + geometry.clientLeft + geometry.viewportWidth - 1
      : scrollEl.scrollLeft + geometry.clientLeft,
    "floor"
  );
}

function syncChargePlanVisibleDate(scrollEl = getChargePlanScrollElement(), options = {}) {
  if (!(scrollEl instanceof HTMLElement)) {
    return "";
  }

  const firstVisibleDate = getChargePlanViewportEdgeDate(scrollEl, "left");
  if (!firstVisibleDate) {
    return "";
  }

  updateChargePlanDateTrigger(firstVisibleDate);

  if (options.persist && firstVisibleDate !== String(state.chargePlanAnchorDate || "").trim()) {
    setState({ chargePlanAnchorDate: firstVisibleDate });
  }

  return firstVisibleDate;
}

function clearChargePlanVisibleDateTimer() {
  if (chargePlanVisibleDateTimer == null) {
    return;
  }

  clearTimeout(chargePlanVisibleDateTimer);
  chargePlanVisibleDateTimer = null;
}

function clearChargePlanScrollSyncFrame() {
  if (chargePlanScrollSyncFrame == null) {
    return;
  }

  cancelAnimationFrame(chargePlanScrollSyncFrame);
  chargePlanScrollSyncFrame = null;
}

function clearChargePlanWheelZoomFrame() {
  if (chargePlanWheelZoomFrame == null) {
    pendingChargePlanWheelRequest = null;
    return;
  }

  cancelAnimationFrame(chargePlanWheelZoomFrame);
  chargePlanWheelZoomFrame = null;
  pendingChargePlanWheelRequest = null;
}

function scheduleChargePlanVisibleDateSync(scrollEl = getChargePlanScrollElement()) {
  if (!(scrollEl instanceof HTMLElement)) {
    return;
  }

  clearChargePlanVisibleDateTimer();
  chargePlanVisibleDateTimer = setTimeout(() => {
    chargePlanVisibleDateTimer = null;
    syncChargePlanVisibleDate(scrollEl, { persist: true });
  }, 140);
}

function getChargePlanZoomAnchorDate() {
  const normalizedDateValue = normalizeChargePlanDateValue(state.chargePlanAnchorDate);
  const anchorDate = normalizedDateValue
    ? new Date(`${normalizedDateValue}T12:00:00`)
    : new Date();

  return Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate;
}

function getChargePlanReferenceMonthDayCount() {
  const anchorDate = getChargePlanZoomAnchorDate();
  return new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
}

function getChargePlanVisibleDaysBounds() {
  const configuredReferenceMonthDays = Number(
    APP_CONFIG.chargeTimeline.referenceMonthDays
  );
  const monthVisibleDays =
    Number.isFinite(configuredReferenceMonthDays) && configuredReferenceMonthDays > 0
      ? configuredReferenceMonthDays
      : getChargePlanReferenceMonthDayCount();
  const maxVisibleDays = Math.max(
    monthVisibleDays,
    monthVisibleDays * Math.max(1, APP_CONFIG.chargeTimeline.yearMaxVisibleMonths || 14)
  );

  return {
    monthVisibleDays,
    minVisibleDays: APP_CONFIG.chargeTimeline.minVisibleDays,
    maxVisibleDays,
    yearThreshold: monthVisibleDays * 10,
  };
}

function getChargePlanZoomModeForVisibleDays(nextVisibleDays) {
  const { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold } =
    getChargePlanVisibleDaysBounds();
  const visibleDays = clamp(nextVisibleDays, minVisibleDays, maxVisibleDays);

  let derivedMode = "month";
  if (visibleDays < monthVisibleDays) {
    derivedMode = "week";
  } else if (visibleDays >= yearThreshold) {
    derivedMode = "year";
  }

  return derivedMode;
}

function getChargePlanZoomScaleForVisibleDays(nextVisibleDays, zoomMode) {
  const { monthVisibleDays, minVisibleDays, maxVisibleDays } =
    getChargePlanVisibleDaysBounds();
  const visibleDays = clamp(nextVisibleDays, minVisibleDays, maxVisibleDays);

  if (zoomMode === "week") {
    return clamp(
      7 / Math.max(visibleDays, 1),
      APP_CONFIG.chargeTimeline.minZoomScale,
      APP_CONFIG.chargeTimeline.maxZoomScale
    );
  }

  if (zoomMode === "year") {
    return clamp(
      365 / Math.max(visibleDays, 1),
      APP_CONFIG.chargeTimeline.minZoomScale,
      APP_CONFIG.chargeTimeline.maxZoomScale
    );
  }

  return clamp(
    monthVisibleDays / Math.max(visibleDays, 1),
    APP_CONFIG.chargeTimeline.minZoomScale,
    APP_CONFIG.chargeTimeline.maxZoomScale
  );
}

function getChargePlanZoomStateFromVisibleDays(nextVisibleDays) {
  const { minVisibleDays, maxVisibleDays } = getChargePlanVisibleDaysBounds();
  const visibleDays = clamp(nextVisibleDays, minVisibleDays, maxVisibleDays);
  const derivedMode = getChargePlanZoomModeForVisibleDays(visibleDays);
  const derivedScale = getChargePlanZoomScaleForVisibleDays(
    visibleDays,
    derivedMode
  );

  return {
    chargePlanZoomMode: derivedMode,
    chargePlanZoomScale: derivedScale,
    chargePlanVisibleDays: visibleDays,
  };
}

function getCurrentChargePlanVisibleDays() {
  const { minVisibleDays, maxVisibleDays } = getChargePlanVisibleDaysBounds();
  return clamp(
    Number(state.chargePlanVisibleDays) || APP_CONFIG.chargeTimeline.defaultVisibleDays,
    minVisibleDays,
    maxVisibleDays
  );
}

function buildChargePlanZoomStatePatch(nextVisibleDays, options = {}) {
  const derivedZoomState = getChargePlanZoomStateFromVisibleDays(nextVisibleDays);
  if (!derivedZoomState) {
    return null;
  }

  const scrollEl = getChargePlanScrollElement();
  let nextLeftDayOffset = null;

  if (scrollEl) {
    const anchorRatio =
      options.anchorClientX != null
        ? getChargePlanViewportAnchorRatio(scrollEl, options.anchorClientX)
        : 0;
    nextLeftDayOffset = getChargePlanNextLeftDayOffset(
      scrollEl,
      derivedZoomState.chargePlanVisibleDays,
      anchorRatio
    );
  }

  return {
    derivedZoomState,
    nextLeftDayOffset,
  };
}

function applyChargePlanVisibleDays(nextVisibleDays, options = {}) {
  const zoomStatePatch = buildChargePlanZoomStatePatch(nextVisibleDays, options);
  if (!zoomStatePatch) {
    return;
  }
  const { derivedZoomState, nextLeftDayOffset } = zoomStatePatch;

  if (
    derivedZoomState.chargePlanZoomMode === state.chargePlanZoomMode &&
    Math.abs(derivedZoomState.chargePlanZoomScale - state.chargePlanZoomScale) < 0.001 &&
    Math.abs(derivedZoomState.chargePlanVisibleDays - state.chargePlanVisibleDays) < 0.01
  ) {
    return;
  }

  if (Number.isFinite(nextLeftDayOffset)) {
    setPendingChargePlanLeftDayOffset(nextLeftDayOffset);
  } else {
    clearChargePlanPendingViewportAnchor();
  }

  setState(derivedZoomState);
  renderChargePlanSection();
}

function getChargePlanTargetVisibleDaysForMode(nextMode) {
  const { monthVisibleDays, maxVisibleDays } = getChargePlanVisibleDaysBounds();

  if (nextMode === "week") {
    return 7;
  }

  if (nextMode === "year") {
    return Math.min(maxVisibleDays, monthVisibleDays * 12);
  }

  return monthVisibleDays;
}

function setChargePlanZoomMode(nextMode, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(APP_CONFIG.chargeTimeline.zoomModes, nextMode)) {
    return;
  }

  applyChargePlanVisibleDays(
    getChargePlanTargetVisibleDaysForMode(nextMode),
    options
  );
}

function adjustChargePlanZoomByFactor(factor, options = {}) {
  const safeFactor = Number(factor);
  if (!Number.isFinite(safeFactor) || safeFactor <= 0) {
    return;
  }

  applyChargePlanVisibleDays(getCurrentChargePlanVisibleDays() * safeFactor, options);
}

function normalizeChargePlanWheelDelta(deltaY, deltaMode = 0) {
  const numericDelta = Number(deltaY);
  if (!Number.isFinite(numericDelta)) {
    return 0;
  }

  if (deltaMode === 1) {
    return numericDelta * 16;
  }

  if (deltaMode === 2) {
    return numericDelta * 120;
  }

  return numericDelta;
}

function getChargePlanWheelStepDays(currentVisibleDays) {
  const stepRatio = Number(APP_CONFIG.chargeTimeline.wheelZoomStepRatio) || 0.12;
  const minStepDays = Number(APP_CONFIG.chargeTimeline.wheelZoomMinStepDays) || 1;
  const maxStepDays = Number(APP_CONFIG.chargeTimeline.wheelZoomMaxStepDays) || 21;

  return clamp(currentVisibleDays * stepRatio, minStepDays, maxStepDays);
}

function scheduleChargePlanWheelZoom(clientX, deltaY, deltaMode = 0) {
  const normalizedDelta = normalizeChargePlanWheelDelta(deltaY, deltaMode);
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
    return;
  }

  pendingChargePlanWheelRequest = {
    clientX,
    delta: clamp(
      normalizedDelta,
      -APP_CONFIG.chargeTimeline.wheelZoomMaxDeltaPerFrame,
      APP_CONFIG.chargeTimeline.wheelZoomMaxDeltaPerFrame
    ),
  };

  if (chargePlanWheelZoomFrame != null) {
    return;
  }

  const flushWheelZoom = () => {
    if (chargePlanViewportRestoreFrame != null || suppressChargePlanScrollEvents) {
      chargePlanWheelZoomFrame = requestAnimationFrame(flushWheelZoom);
      return;
    }

    chargePlanWheelZoomFrame = null;

    const request = pendingChargePlanWheelRequest;
    pendingChargePlanWheelRequest = null;
    if (!request) {
      return;
    }

    const currentVisibleDays = getCurrentChargePlanVisibleDays();
    const stepDays = getChargePlanWheelStepDays(currentVisibleDays);
    const nextVisibleDays =
      currentVisibleDays + Math.sign(request.delta) * stepDays;

    applyChargePlanVisibleDays(nextVisibleDays, {
      anchorClientX: request.clientX,
    });

    if (pendingChargePlanWheelRequest) {
      chargePlanWheelZoomFrame = requestAnimationFrame(flushWheelZoom);
    }
  };

  chargePlanWheelZoomFrame = requestAnimationFrame(flushWheelZoom);
}

function navigateChargePlanToDate(rawDateValue) {
  const dateValue = normalizeChargePlanDateValue(rawDateValue);
  if (!dateValue) {
    return;
  }

  const targetDate = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(targetDate.getTime())) {
    return;
  }

  setPendingChargePlanFocus(dateValue, "left");
  clearChargePlanWheelZoomFrame();
  clearChargePlanVisibleDateTimer();
  setChargePlanRangeStartDate(dateValue);
  setState({
    selectedYear: targetDate.getFullYear(),
    selectedMonth: targetDate.getMonth(),
    chargePlanAnchorDate: dateValue,
  });
  renderChargePlanSection();
}

function getChargePlanDatePickerElements() {
  return {
    shellEl: dom?.chargePlanBoard?.querySelector(".charge-plan-date-picker-shell") || null,
    triggerEl: dom?.chargePlanBoard?.querySelector(".charge-plan-date-trigger") || null,
    popoverEl: dom?.chargePlanBoard?.querySelector(".charge-plan-date-popover") || null,
  };
}

function getChargePlanDatePickerValue() {
  const { triggerEl } = getChargePlanDatePickerElements();
  return String(triggerEl?.dataset?.dateValue || state.chargePlanAnchorDate || "").trim();
}

function syncChargePlanDatePickerView(dateValue = getChargePlanDatePickerValue()) {
  const pickerDate = new Date(`${String(dateValue || "").trim()}T12:00:00`);
  if (Number.isNaN(pickerDate.getTime())) {
    const now = new Date();
    chargePlanDatePickerView = {
      year: now.getFullYear(),
      month: now.getMonth(),
    };
    return chargePlanDatePickerView;
  }

  chargePlanDatePickerView = {
    year: pickerDate.getFullYear(),
    month: pickerDate.getMonth(),
  };
  return chargePlanDatePickerView;
}

function isChargePlanDatePickerOpen() {
  const { popoverEl } = getChargePlanDatePickerElements();
  return popoverEl instanceof HTMLElement && !popoverEl.hidden;
}

function closeChargePlanDatePicker() {
  if (!dom?.chargePlanBoard) return;
  hideChargePlanDatePicker(dom.chargePlanBoard);
}

function openChargePlanDatePicker() {
  if (!dom?.chargePlanBoard) return;

  const selectedDateValue = getChargePlanDatePickerValue();
  const view = chargePlanDatePickerView || syncChargePlanDatePickerView(selectedDateValue);
  showChargePlanDatePicker(dom.chargePlanBoard, {
    selectedDateValue,
    visibleYear: view.year,
    visibleMonth: view.month,
  });
}

function trySetPointerCapture(target, pointerId) {
  if (!(target instanceof Element) || !Number.isInteger(pointerId)) {
    return;
  }

  if (typeof target.setPointerCapture !== "function") {
    return;
  }

  try {
    target.setPointerCapture(pointerId);
  } catch (_error) {
    // Ignore browsers that reject pointer capture on this element.
  }
}

function tryReleasePointerCapture(target, pointerId) {
  if (!(target instanceof Element) || !Number.isInteger(pointerId)) {
    return;
  }

  if (typeof target.releasePointerCapture !== "function") {
    return;
  }

  try {
    target.releasePointerCapture(pointerId);
  } catch (_error) {
    // Ignore browsers that already released the pointer capture.
  }
}

function closeChargePlanContextMenu() {
  if (!dom?.chargePlanBoard) return;
  hideChargePlanContextMenu(dom.chargePlanBoard);
}

function handleProjectSelectionChange() {
  const selectedValue = String(dom.projectSelect.value || "").trim();
  const selectedProjectId = selectedValue ? Number(selectedValue) : null;
  clearChargePlanWheelZoomFrame();
  clearChargePlanVisibleDateTimer();
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
  const actionButton = event.target instanceof Element
    ? event.target.closest(".charge-plan-context-action")
    : null;
  if (!(actionButton instanceof HTMLButtonElement)) return;

  event.preventDefault();
  event.stopPropagation();

  const action = actionButton.dataset.action || "";
  const menuEl = actionButton.closest(".charge-plan-context-menu");
  const segmentId = Number(
    actionButton.dataset.segmentId || menuEl?.dataset.segmentId
  );
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

  closeChargePlanContextMenu();
  closeChargePlanDatePicker();
  scheduleChargePlanWheelZoom(event.clientX, event.deltaY, event.deltaMode);
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
  closeChargePlanDatePicker();
  clearChargePlanWheelZoomFrame();
  setChargePlanZoomMode(nextZoomMode);
}

function handleChargePlanDateControls(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const todayButton = target.closest(".charge-plan-date-jump-btn");
  if (todayButton instanceof HTMLButtonElement) {
    event.stopPropagation();
    closeChargePlanContextMenu();
    closeChargePlanDatePicker();
    clearChargePlanWheelZoomFrame();
    navigateChargePlanToDate(getTodayDateValueInTimeZone());
    return;
  }

  const dateTrigger = target.closest(".charge-plan-date-trigger");
  if (dateTrigger instanceof HTMLButtonElement) {
    event.stopPropagation();
    closeChargePlanContextMenu();

    if (isChargePlanDatePickerOpen()) {
      closeChargePlanDatePicker();
      return;
    }

    syncChargePlanDatePickerView(dateTrigger.dataset.dateValue || state.chargePlanAnchorDate);
    openChargePlanDatePicker();
    return;
  }

  const datePickerNav = target.closest(".charge-plan-date-picker-nav");
  if (datePickerNav instanceof HTMLButtonElement) {
    event.stopPropagation();
    closeChargePlanContextMenu();

    const monthDelta = Number(datePickerNav.dataset.monthDelta);
    if (!Number.isInteger(monthDelta)) {
      return;
    }

    const currentView = chargePlanDatePickerView || syncChargePlanDatePickerView();
    const nextMonthDate = new Date(currentView.year, currentView.month, 1, 12);
    nextMonthDate.setMonth(nextMonthDate.getMonth() + monthDelta);
    chargePlanDatePickerView = {
      year: nextMonthDate.getFullYear(),
      month: nextMonthDate.getMonth(),
    };
    openChargePlanDatePicker();
    return;
  }

  const monthSelect = target.closest(".charge-plan-date-picker-month-select");
  if (monthSelect instanceof HTMLSelectElement) {
    event.stopPropagation();
    return;
  }

  const yearSelect = target.closest(".charge-plan-date-picker-year-select");
  if (yearSelect instanceof HTMLSelectElement) {
    event.stopPropagation();
    return;
  }

  closeChargePlanContextMenu();
  const dayButton = target.closest(".charge-plan-date-picker-day");
  if (!(dayButton instanceof HTMLButtonElement)) {
    return;
  }

  event.stopPropagation();

  const dateValue = String(dayButton.dataset.dateValue || "").trim();
  if (!dateValue) {
    return;
  }

  const selectedDate = new Date(`${dateValue}T12:00:00`);
  if (!Number.isNaN(selectedDate.getTime())) {
    chargePlanDatePickerView = {
      year: selectedDate.getFullYear(),
      month: selectedDate.getMonth(),
    };
  }

  closeChargePlanDatePicker();
  navigateChargePlanToDate(dateValue);
}

function handleChargePlanDatePickerChange(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const monthSelect = target.closest(".charge-plan-date-picker-month-select");
  const yearSelect = target.closest(".charge-plan-date-picker-year-select");
  if (
    !(monthSelect instanceof HTMLSelectElement) &&
    !(yearSelect instanceof HTMLSelectElement)
  ) {
    return;
  }

  const currentView = chargePlanDatePickerView || syncChargePlanDatePickerView();
  const nextMonth =
    monthSelect instanceof HTMLSelectElement
      ? Number(monthSelect.value)
      : currentView.month;
  const nextYear =
    yearSelect instanceof HTMLSelectElement
      ? Number(yearSelect.value)
      : currentView.year;

  if (!Number.isInteger(nextMonth) || !Number.isInteger(nextYear)) {
    return;
  }

  chargePlanDatePickerView = {
    year: nextYear,
    month: nextMonth,
  };
  openChargePlanDatePicker();
}

function handleChargePlanPointerDown(event) {
  if (!(event.target instanceof Element)) return;
  if (event.button !== 0) return;
  clearChargePlanWheelZoomFrame();
  if (event.target.closest(".charge-plan-context-menu")) return;
  if (event.target.closest(".charge-plan-date-picker-shell")) {
    closeChargePlanContextMenu();
    return;
  }

  const headerTrack = event.target.closest(".charge-plan-header-track");
  if (headerTrack instanceof HTMLElement) {
    const scrollEl = headerTrack.closest(".charge-plan-scroll");
    if (!(scrollEl instanceof HTMLElement)) return;

    event.preventDefault();
    closeChargePlanContextMenu();
    closeChargePlanDatePicker();
    chargePlanPan = {
      scrollEl,
      startClientX: event.clientX,
      startScrollLeft: scrollEl.scrollLeft,
      lastClientX: event.clientX,
      pointerId: event.pointerId,
    };
    trySetPointerCapture(scrollEl, event.pointerId);
    scrollEl.classList.add("is-panning");
    return;
  }

  closeChargePlanContextMenu();
  closeChargePlanDatePicker();

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
    chargePlanPan.lastClientX = event.clientX;
    const deltaX = event.clientX - chargePlanPan.startClientX;
    chargePlanPan.scrollEl.scrollLeft = chargePlanPan.startScrollLeft - deltaX;
    captureChargePlanViewport(chargePlanPan.scrollEl);
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
    tryReleasePointerCapture(chargePlanPan.scrollEl, chargePlanPan.pointerId);
    captureChargePlanViewport(chargePlanPan.scrollEl);
    syncChargePlanVisibleDate(chargePlanPan.scrollEl, { persist: true });
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

function handleChargePlanScroll(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("charge-plan-scroll")) return;
  if (suppressChargePlanScrollEvents) return;

  captureChargePlanViewport(target);
  clearChargePlanScrollSyncFrame();
  chargePlanScrollSyncFrame = requestAnimationFrame(() => {
    chargePlanScrollSyncFrame = null;
    syncChargePlanVisibleDate(target);
  });
  scheduleChargePlanVisibleDateSync(target);
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

  dom.expenseBoard.addEventListener("change", handleTableInputChange);
  dom.realExpenseTableBody.addEventListener("change", handleTableInputChange);

  dom.realExpenseTableBody.addEventListener("paste", handlePaste, true);
  dom.chargePlanBoard.addEventListener("click", handleDeleteWorker);
  dom.chargePlanBoard.addEventListener("click", handleChargePlanZoomButtonClick);
  dom.chargePlanBoard.addEventListener("click", handleChargePlanDateControls);
  dom.chargePlanBoard.addEventListener("click", (event) => {
    handleChargePlanContextAction(event).catch((error) => {
      console.error("Erreur action menu timeline :", error);
    });
  });
  dom.chargePlanBoard.addEventListener("change", handleChargePlanDatePickerChange);
  dom.chargePlanBoard.addEventListener("pointerup", (event) => {
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
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      closeChargePlanContextMenu();
      return;
    }

    const eventPath =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    const clickedInsideContextMenu =
      event.target.closest(".charge-plan-context-menu") ||
      eventPath.some(
        (node) =>
          node instanceof Element && node.classList.contains("charge-plan-context-menu")
      );
    if (clickedInsideContextMenu) {
      return;
    }

    const clickedInsideDatePicker =
      event.target.closest(".charge-plan-date-picker-shell") ||
      eventPath.some(
        (node) =>
          node instanceof Element && node.classList.contains("charge-plan-date-picker-shell")
      );
    if (clickedInsideDatePicker) {
      return;
    }

    closeChargePlanContextMenu();
    closeChargePlanDatePicker();
  });
  window.addEventListener(
    "scroll",
    () => {
      closeChargePlanContextMenu();
      closeChargePlanDatePicker();
    },
    true
  );
  window.addEventListener("pointermove", handleChargePlanPointerMove);
  window.addEventListener("pointerup", () => {
    clearChargePlanScrollSyncFrame();
    handleChargePlanPointerUp().catch((error) => {
      console.error("Erreur sauvegarde timeline :", error);
    });
  });
  window.addEventListener("pointercancel", () => {
    clearChargePlanScrollSyncFrame();
    clearChargePlanVisibleDateTimer();
    clearChargePlanWheelZoomFrame();
    if (chargePlanPan) {
      chargePlanPan.scrollEl.classList.remove("is-panning");
      tryReleasePointerCapture(chargePlanPan.scrollEl, chargePlanPan.pointerId);
      captureChargePlanViewport(chargePlanPan.scrollEl);
      syncChargePlanVisibleDate(chargePlanPan.scrollEl, { persist: true });
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
