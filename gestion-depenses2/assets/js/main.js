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
let chargePlanRangeRefreshPending = false;
let chargePlanRangeRefreshTimer = null;
let lastChargePlanScrollDirection = "";
let lastChargePlanScrollLeft = 0;
let renderedChargePlanRangeStartDate = "";
let chargePlanRangeStartDate = "";
const chargePlanViewport = {
  scrollRatio: 0,
  pendingTrackRatio: null,
  pendingAnchorRatio: null,
  pendingClientOffset: 0,
};
let pendingChargePlanFocusDate = "";
let pendingChargePlanFocusAlign = "center";
let chargePlanDatePickerView = null;

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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

  const fallbackRangeStartDate = getChargePlanMonthStartDateValue(state.chargePlanAnchorDate);
  chargePlanRangeStartDate = fallbackRangeStartDate;
  return fallbackRangeStartDate;
}

function cloneBudgetLines(lines) {
  return JSON.parse(JSON.stringify(lines || []));
}

function syncStateToProjectStart(project) {
  const earliestMonth = getEarliestProjectMonth(project);
  if (earliestMonth) {
    const anchorDate = `${earliestMonth.year}-${String(
      earliestMonth.monthIndex + 1
    ).padStart(2, "0")}-01`;
    pendingChargePlanFocusDate = anchorDate;
    pendingChargePlanFocusAlign = "left";
    setChargePlanRangeStartDate(anchorDate);
    setState({
      selectedYear: earliestMonth.year,
      selectedMonth: earliestMonth.monthIndex,
      chargePlanAnchorDate: anchorDate,
    });
    return;
  }

  const now = new Date();
  const anchorDate = toDateInputValue(now);
  pendingChargePlanFocusDate = anchorDate;
  pendingChargePlanFocusAlign = "left";
  setChargePlanRangeStartDate(anchorDate);
  setState({
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    chargePlanAnchorDate: anchorDate,
  });
}

function renderApp() {
  renderProjectOptions(dom.projectSelect, state.projects, state.selectedProjectId);
  renderWorkerOptions(dom.workerNameSelect, state.teamMembers);
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
      pendingChargePlanFocusDate = initialVisibleDate;
      pendingChargePlanFocusAlign = "left";
    }
  }

  const rangeStartDate = getChargePlanRangeStartDate();
  renderedChargePlanRangeStartDate = rangeStartDate;

  renderChargePlanTimeline(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
    chargePlanZoomMode: state.chargePlanZoomMode,
    chargePlanZoomScale: state.chargePlanZoomScale,
    chargePlanAnchorDate: state.chargePlanAnchorDate,
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
  lastChargePlanScrollLeft = scrollEl.scrollLeft;
}

function rememberChargePlanAnchor(scrollEl, clientX) {
  if (!(scrollEl instanceof HTMLElement)) return;

  const rect = scrollEl.getBoundingClientRect();
  const localOffset = clamp(clientX - rect.left, 0, rect.width);
  const absoluteOffset = scrollEl.scrollLeft + localOffset;
  const headerTrack = getChargePlanHeaderTrack(scrollEl);

  if (headerTrack instanceof HTMLElement) {
    const trackWidth = Math.max(headerTrack.scrollWidth || headerTrack.offsetWidth, 1);
    const relativeTrackOffset = clamp(
      absoluteOffset - headerTrack.offsetLeft,
      0,
      trackWidth
    );

    chargePlanViewport.pendingTrackRatio = relativeTrackOffset / trackWidth;
    chargePlanViewport.pendingAnchorRatio = null;
    chargePlanViewport.pendingClientOffset = localOffset;
    return;
  }

  const safeScrollWidth = Math.max(scrollEl.scrollWidth, 1);

  chargePlanViewport.pendingTrackRatio = null;
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

  if (chargePlanViewportRestoreFrame != null) {
    cancelAnimationFrame(chargePlanViewportRestoreFrame);
    chargePlanViewportRestoreFrame = null;
  }

  suppressChargePlanScrollEvents = true;
  requestAnimationFrame(() => {
    const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
    let didRestoreSpecificPosition = false;

    if (pendingChargePlanFocusDate) {
      const targetDayTick = scrollEl.querySelector(
        `.charge-plan-header-day-tick[data-date-key="${pendingChargePlanFocusDate}"]`
      );
      if (targetDayTick instanceof HTMLElement) {
        let nextScrollLeft =
          targetDayTick.offsetLeft - scrollEl.clientWidth / 2 + targetDayTick.offsetWidth / 2;

        if (pendingChargePlanFocusAlign === "left") {
          nextScrollLeft = targetDayTick.offsetLeft;
        } else if (pendingChargePlanFocusAlign === "right") {
          nextScrollLeft =
            targetDayTick.offsetLeft - scrollEl.clientWidth + targetDayTick.offsetWidth;
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

    if (
      !didRestoreSpecificPosition &&
      Number.isFinite(chargePlanViewport.pendingTrackRatio)
    ) {
      const headerTrack = getChargePlanHeaderTrack(scrollEl);
      if (headerTrack instanceof HTMLElement) {
        const trackWidth = Math.max(headerTrack.scrollWidth || headerTrack.offsetWidth, 1);
        const absoluteOffset =
          headerTrack.offsetLeft + chargePlanViewport.pendingTrackRatio * trackWidth;

        scrollEl.scrollLeft = clamp(
          absoluteOffset - chargePlanViewport.pendingClientOffset,
          0,
          maxScrollLeft
        );
        chargePlanViewport.pendingTrackRatio = null;
        chargePlanViewport.pendingClientOffset = 0;
        didRestoreSpecificPosition = true;
      } else {
        chargePlanViewport.pendingTrackRatio = null;
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
    syncChargePlanVisibleDate(scrollEl);
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

function getChargePlanViewportCenterDate(scrollEl) {
  if (!(scrollEl instanceof HTMLElement)) return "";

  const targetX = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
  const daySlots = Array.from(
    scrollEl.querySelectorAll(".charge-plan-header-day-tick[data-date-key]")
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
    scrollEl.querySelectorAll(".charge-plan-header-day-tick[data-date-key]")
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

function queueChargePlanRangeRefresh({ anchorDate, focusDate, focusAlign = "center" }) {
  const normalizedRangeStartDate = getChargePlanMonthStartDateValue(anchorDate);
  const normalizedFocusDate = normalizeChargePlanDateValue(
    focusDate || normalizedRangeStartDate
  );
  if (!normalizedRangeStartDate) {
    return;
  }

  if (
    chargePlanRangeRefreshPending ||
    normalizedRangeStartDate === renderedChargePlanRangeStartDate
  ) {
    return;
  }

  chargePlanRangeRefreshPending = true;
  pendingChargePlanFocusDate = normalizedFocusDate;
  pendingChargePlanFocusAlign = focusAlign;

  requestAnimationFrame(() => {
    chargePlanRangeRefreshPending = false;
    setChargePlanRangeStartDate(normalizedRangeStartDate);
    renderChargePlanSection();
  });
}

function clearChargePlanRangeRefreshTimer() {
  if (chargePlanRangeRefreshTimer == null) {
    return;
  }

  clearTimeout(chargePlanRangeRefreshTimer);
  chargePlanRangeRefreshTimer = null;
}

function maybeExtendChargePlanRange(scrollEl, direction = "") {
  return;
}

function scheduleChargePlanRangeRefresh(scrollEl, direction = "") {
  clearChargePlanRangeRefreshTimer();
}

function setChargePlanZoomMode(nextMode, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(APP_CONFIG.chargeTimeline.zoomModes, nextMode)) {
    return;
  }

  const scrollEl = getChargePlanScrollElement();
  clearChargePlanRangeRefreshTimer();
  if (options.anchorClientX != null && scrollEl) {
    rememberChargePlanAnchor(scrollEl, options.anchorClientX);
  } else {
    rememberChargePlanCenterAnchor(scrollEl);
  }

  setState({
    chargePlanZoomMode: nextMode,
    chargePlanZoomScale: APP_CONFIG.chargeTimeline.defaultZoomScale,
  });
  renderChargePlanSection();
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
  clearChargePlanRangeRefreshTimer();
  if (options.anchorClientX != null && scrollEl) {
    rememberChargePlanAnchor(scrollEl, options.anchorClientX);
  } else {
    rememberChargePlanCenterAnchor(scrollEl);
  }

  setState({ chargePlanZoomScale: normalizedScale });
  renderChargePlanSection();
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

  pendingChargePlanFocusDate = dateValue;
  pendingChargePlanFocusAlign = "left";
  clearChargePlanVisibleDateTimer();
  clearChargePlanRangeRefreshTimer();
  setChargePlanRangeStartDate(dateValue);
  setState({
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

  const nextScale =
    event.deltaY < 0
      ? state.chargePlanZoomScale * APP_CONFIG.chargeTimeline.wheelZoomFactor
      : state.chargePlanZoomScale / APP_CONFIG.chargeTimeline.wheelZoomFactor;

  closeChargePlanContextMenu();
  closeChargePlanDatePicker();
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
  closeChargePlanDatePicker();
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
    navigateChargePlanToDate(toDateInputValue(new Date()));
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
      direction: "",
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
    if (deltaX > 0) {
      chargePlanPan.direction = "earlier";
    } else if (deltaX < 0) {
      chargePlanPan.direction = "later";
    }
    chargePlanPan.scrollEl.scrollLeft = chargePlanPan.startScrollLeft - deltaX;
    captureChargePlanViewport(chargePlanPan.scrollEl);
    syncChargePlanVisibleDate(chargePlanPan.scrollEl);
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

  const previousScrollLeft = lastChargePlanScrollLeft;
  captureChargePlanViewport(target);
  clearChargePlanScrollSyncFrame();
  chargePlanScrollSyncFrame = requestAnimationFrame(() => {
    chargePlanScrollSyncFrame = null;
    syncChargePlanVisibleDate(target);
  });
  if (!chargePlanPan) {
    if (target.scrollLeft < previousScrollLeft) {
      lastChargePlanScrollDirection = "earlier";
    } else if (target.scrollLeft > previousScrollLeft) {
      lastChargePlanScrollDirection = "later";
    }
  }
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
    clearChargePlanRangeRefreshTimer();
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
