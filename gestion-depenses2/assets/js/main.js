import {
  clamp,
  getMonthKeyFromDate,
  parseMonthKey,
  parseOptionalNumberInput,
  toMonthKey,
} from "./utils/format.js";
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
} from "./services/gristService.js";
import {
  buildExpenseData,
  getProjectAverageAnchorDate,
  getEarliestProjectMonth,
  getProjectFirstAnchorDate,
  getProjectBudgetTotal,
} from "./services/projectService.js";
import { assertDomRefs, getDomRefs } from "./ui/dom.js";
import {
  clearSpendingBillingEditor,
  clearSpendingChartControls,
  destroyChart,
  getSpendingChartBarsFromTop,
  renderSpendingBillingEditor,
  renderSpendingChartControls,
  renderSpendingChart,
  setSpendingChartBarsFromTop,
} from "./ui/chart.js";
import {
  clearChargePlanSelectionPreview,
  clearChargePlanTimeline,
  clearRealChargeTimeline,
  computeChargePlanSelection,
  computeChargePlanSelectionFromSlotIndexes,
  getChargePlanSlotIndexAtClientX,
  hideChargePlanContextMenu,
  hideChargePlanDatePicker,
  renderChargePlanTimeline,
  renderRealChargeTimeline,
  setChargePlanFeedback,
  showChargePlanDatePicker,
  showChargePlanContextMenu,
  updateChargePlanSelectionPreview,
} from "./ui/chargeTimeline.js";
import {
  getExpenseGraphDisplayMode,
  getTeamManagementSummaryDisplayMode,
  getTeamManagementSummaryGroupedByRole,
  getTeamManagementSummaryMode,
  setExpenseGraphDisplayMode,
  setTeamManagementSummaryDisplayMode,
  setTeamManagementSummaryGroupedByRole,
  setTeamManagementSummaryMode,
} from "./ui/expenseTimeline.js";
import { clearKpi, renderKpi } from "./ui/kpi.js";
import {
  clearPlanningManagement,
  renderPlanningManagement,
} from "./ui/planningManagement.js";
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
import {
  getHalfDaySlotRange,
  getSegmentAllocationDays,
  parseRawDateTime,
} from "./utils/timeSegments.js";

let dom = null;
let chargeTimelineDrag = null;
let chargePlanPan = null;
let chargePlanVisibleDateTimer = null;
let chargePlanViewportRestoreFrame = null;
let suppressChargePlanScrollEvents = false;
let chargePlanScrollSyncFrame = null;
let pendingChargePlanScrollSync = null;
let chargePlanWheelZoomFrame = null;
let pendingChargePlanWheelRequest = null;
let renderedChargePlanRangeStartDate = "";
let chargePlanRangeStartDate = "";
let editingBudgetLineIndex = null;
let editingChargePlanSegment = null;
let planningManagementHover = null;
let planningManagementMonthKey = getMonthKeyFromDate(new Date());
let planningManagementMonthPickerOpen = false;
let planningManagementMonthPickerViewYear = new Date().getFullYear();
let chargePlanSyncApiReady = false;
let suppressChargePlanSyncEvents = false;
let chargePlanSyncSuppressionToken = 0;
let chargePlanSyncAlignmentTimer = null;
const chargePlanSyncListeners = new Set();
const budgetLineDragState = {
  sourceIndex: null,
  targetIndex: null,
  position: "after",
};
const chargePlanViewport = {
  scrollRatio: 0,
  leftDayOffset: null,
  pendingLeftDayOffset: null,
};
let pendingChargePlanFocusDate = "";
let pendingChargePlanFocusAlign = "center";
let chargePlanDatePickerView = null;
const PARIS_TIMEZONE = "Europe/Paris";
const EMBEDDED_PLANNING_SYNC_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("embedded") === "planning-sync";

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

function applyEmbeddedPlanningSyncMode() {
  if (!EMBEDDED_PLANNING_SYNC_MODE || typeof document === "undefined") {
    return;
  }

  document.body.classList.add("planning-sync-embedded");

  const selectorsToHide = [
    ".header",
    ".project-header",
    ".kpi-report",
    ".plan-management-section",
    ".team-management-section",
    "#expense-board",
    "#real-charge-board",
    "#real-expense-board",
    "#spending-billing-editor",
    "#spending-chart-shell",
  ];

  selectorsToHide.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (element instanceof HTMLElement) {
        element.hidden = true;
        element.style.display = "none";
      }
    });
  });

  ["expense-board", "real-charge-board", "real-expense-board", "spending-billing-editor"].forEach(
    (id) => {
      const boardEl = document.getElementById(id);
      const headerEl = boardEl?.previousElementSibling;
      if (headerEl instanceof HTMLElement && headerEl.classList.contains("table-header")) {
        headerEl.hidden = true;
        headerEl.style.display = "none";
      }
    }
  );
}

function beginChargePlanSyncSuppression() {
  suppressChargePlanSyncEvents = true;
  chargePlanSyncSuppressionToken += 1;
  return chargePlanSyncSuppressionToken;
}

function finishChargePlanSyncSuppression(token, attempt = 0) {
  if (token !== chargePlanSyncSuppressionToken) {
    return;
  }

  const hasPendingInternalWork =
    chargePlanViewportRestoreFrame != null ||
    chargePlanVisibleDateTimer != null ||
    chargePlanScrollSyncFrame != null ||
    chargePlanWheelZoomFrame != null ||
    chargePlanSyncAlignmentTimer != null;

  if (hasPendingInternalWork && attempt < 16) {
    setTimeout(() => {
      finishChargePlanSyncSuppression(token, attempt + 1);
    }, 24);
    return;
  }

  requestAnimationFrame(() => {
    if (token !== chargePlanSyncSuppressionToken) {
      return;
    }
    suppressChargePlanSyncEvents = false;
  });
}

function clearChargePlanSyncAlignmentTimer() {
  if (chargePlanSyncAlignmentTimer == null) {
    return;
  }

  clearTimeout(chargePlanSyncAlignmentTimer);
  chargePlanSyncAlignmentTimer = null;
}

function ensureChargePlanSyncAlignedDate(targetDateValue, attempt = 0) {
  const normalizedTargetDate = normalizeChargePlanDateValue(targetDateValue);
  if (!normalizedTargetDate) {
    clearChargePlanSyncAlignmentTimer();
    return;
  }

  clearChargePlanSyncAlignmentTimer();
  chargePlanSyncAlignmentTimer = setTimeout(() => {
    chargePlanSyncAlignmentTimer = null;

    const currentFirstVisibleDate =
      normalizeChargePlanDateValue(
        getChargePlanViewportEdgeDate(getChargePlanScrollElement(dom?.chargePlanBoard || null), "left")
      ) || "";

    if (currentFirstVisibleDate === normalizedTargetDate) {
      return;
    }

    setPendingChargePlanFocus(normalizedTargetDate, "left");
    restoreChargePlanViewport(dom?.chargePlanBoard || null);

    const realChargeBoardVisible =
      dom?.realChargeBoard instanceof HTMLElement &&
      !dom.realChargeBoard.hidden &&
      window.getComputedStyle(dom.realChargeBoard).display !== "none";

    if (realChargeBoardVisible) {
      restoreChargePlanViewport(dom.realChargeBoard);
    }

    if (attempt < 12) {
      ensureChargePlanSyncAlignedDate(normalizedTargetDate, attempt + 1);
    }
  }, attempt === 0 ? 0 : 36);
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
    return 150 + 100;
  }

  const styles = window.getComputedStyle(boardEl);
  const nameWidth = parseFloat(styles.getPropertyValue("--charge-plan-name-col-width"));
  const totalWidth = parseFloat(styles.getPropertyValue("--charge-plan-total-col-width"));

  return (
    (Number.isFinite(nameWidth) ? nameWidth : 150) +
    (Number.isFinite(totalWidth) ? totalWidth : 100)
  );
}

function getChargePlanTimelineViewportGeometry(scrollEl = getChargePlanScrollElement()) {
  const boardEl =
    scrollEl instanceof Element
      ? getTimelineBoardFromElement(scrollEl)
      : dom?.chargePlanBoard || null;
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

function moveBudgetLine(lines, fromIndex, toIndex) {
  const nextLines = Array.isArray(lines) ? [...lines] : [];
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= nextLines.length ||
    toIndex > nextLines.length
  ) {
    return nextLines;
  }

  const [movedLine] = nextLines.splice(fromIndex, 1);
  if (!movedLine) {
    return nextLines;
  }

  nextLines.splice(toIndex, 0, movedLine);
  return nextLines;
}

function clearBudgetLineDropIndicators() {
  if (!(dom?.editBudgetLinesContainer instanceof HTMLElement)) {
    return;
  }

  dom.editBudgetLinesContainer
    .querySelectorAll(".budget-edit-row")
    .forEach((rowEl) => {
      rowEl.classList.remove(
        "is-dragging",
        "is-drop-target-before",
        "is-drop-target-after"
      );
    });
}

function resetBudgetLineDragState() {
  budgetLineDragState.sourceIndex = null;
  budgetLineDragState.targetIndex = null;
  budgetLineDragState.position = "after";
  clearBudgetLineDropIndicators();
}

function syncBudgetLineEditorUi() {
  if (!(dom?.addEditBudgetLineBtn instanceof HTMLButtonElement)) {
    return;
  }

  dom.addEditBudgetLineBtn.textContent = Number.isInteger(editingBudgetLineIndex)
    ? "Enregistrer la modification"
    : "Ajouter";
}

function resetBudgetLineEditor() {
  editingBudgetLineIndex = null;
  if (dom?.editBudgetChapterInput instanceof HTMLInputElement) {
    dom.editBudgetChapterInput.value = "";
  }
  if (dom?.editBudgetAmountInput instanceof HTMLInputElement) {
    dom.editBudgetAmountInput.value = "";
  }
  syncBudgetLineEditorUi();
}

function startBudgetLineEditor(index) {
  const line = state.editingBudgetLines[index];
  if (!line) {
    resetBudgetLineEditor();
    renderEditingBudgetLines();
    return;
  }

  editingBudgetLineIndex = index;
  dom.editBudgetChapterInput.value = line.chapter || "";
  dom.editBudgetAmountInput.value = String(line.amount ?? "");
  syncBudgetLineEditorUi();
  renderEditingBudgetLines();
  dom.editBudgetChapterInput.focus();
  dom.editBudgetChapterInput.select();
}

function renderEditingBudgetLines() {
  renderEditBudgetLines(
    dom.editBudgetLinesContainer,
    state.editingBudgetLines,
    editingBudgetLineIndex
  );
  resetBudgetLineDragState();
}

function getBudgetEditRowFromEventTarget(target) {
  return target instanceof Element
    ? target.closest(".budget-edit-row")
    : null;
}

function updateBudgetLineDropIndicators() {
  clearBudgetLineDropIndicators();

  if (!(dom?.editBudgetLinesContainer instanceof HTMLElement)) {
    return;
  }

  const { sourceIndex, targetIndex, position } = budgetLineDragState;
  if (Number.isInteger(sourceIndex)) {
    const sourceRow = dom.editBudgetLinesContainer.querySelector(
      `.budget-edit-row[data-index="${sourceIndex}"]`
    );
    sourceRow?.classList.add("is-dragging");
  }

  if (!Number.isInteger(targetIndex)) {
    return;
  }

  const targetRow = dom.editBudgetLinesContainer.querySelector(
    `.budget-edit-row[data-index="${targetIndex}"]`
  );

  if (!targetRow) {
    return;
  }

  targetRow.classList.add(
    position === "before" ? "is-drop-target-before" : "is-drop-target-after"
  );
}

function commitBudgetLineDrop() {
  const { sourceIndex, targetIndex, position } = budgetLineDragState;
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) {
    resetBudgetLineDragState();
    return;
  }

  let destinationIndex = targetIndex + (position === "after" ? 1 : 0);
  if (destinationIndex > sourceIndex) {
    destinationIndex -= 1;
  }

  if (destinationIndex === sourceIndex) {
    resetBudgetLineDragState();
    return;
  }

  setState({
    editingBudgetLines: moveBudgetLine(
      state.editingBudgetLines,
      sourceIndex,
      destinationIndex
    ),
  });
  resetBudgetLineEditor();
  renderEditingBudgetLines();
}

function getTimelineBoards() {
  return [dom?.chargePlanBoard, dom?.realChargeBoard].filter((boardEl) => {
    if (!(boardEl instanceof HTMLElement)) {
      return false;
    }

    if (boardEl.hidden) {
      return false;
    }

    const computedStyle = window.getComputedStyle(boardEl);
    return computedStyle.display !== "none" && computedStyle.visibility !== "hidden";
  });
}

function getTimelineBoardFromElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  return element.closest("#charge-plan-board, #real-charge-board");
}

function getTimelineKind(boardEl) {
  return boardEl?.dataset?.timelineBoardKind === "real" ? "real" : "previsionnel";
}

function getTimelineSegmentField(boardEl) {
  return getTimelineKind(boardEl) === "real" ? "realSegments" : "segments";
}

function getTimelineSegmentType(boardEl) {
  return getTimelineKind(boardEl) === "real" ? "reel" : "previsionnel";
}

function setEditChargePlanFeedback(message = "") {
  if (!(dom?.editSegmentFeedback instanceof HTMLElement)) {
    return;
  }

  const text = String(message || "").trim();
  dom.editSegmentFeedback.textContent = text;
  dom.editSegmentFeedback.hidden = !text;
}

function getSegmentHalfDayPart(date, edge = "start") {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "am";
  }

  const hours = date.getHours();
  if (edge === "end") {
    return hours <= 12 ? "am" : "pm";
  }

  return hours < 12 ? "am" : "pm";
}

function buildSegmentHalfDayBoundary(dateValue, part, edge = "start") {
  const normalizedDateValue = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateValue)) {
    return null;
  }

  const anchorDate = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(anchorDate.getTime())) {
    return null;
  }

  const slotRange = getHalfDaySlotRange(anchorDate, part);
  if (!slotRange) {
    return null;
  }

  return edge === "end" ? slotRange.endAt : slotRange.startAt;
}

function buildChargePlanSelectionFromEditValues({
  startDateValue,
  startPart,
  endDateValue,
  endPart,
}) {
  const startAt = buildSegmentHalfDayBoundary(startDateValue, startPart, "start");
  const endAt = buildSegmentHalfDayBoundary(endDateValue, endPart, "end");

  if (!startAt || !endAt) {
    return {
      error: "Veuillez choisir une date de debut et une date de fin valides.",
    };
  }

  if (endAt <= startAt) {
    return {
      error: "La fin doit etre strictement apres le debut.",
    };
  }

  const totalDays = getSegmentAllocationDays({
    startAt,
    endAt,
  });

  if (totalDays <= 0) {
    return {
      error: "La plage choisie ne contient aucun demi-jour ouvrable.",
    };
  }

  return {
    startDate: startAt.toISOString(),
    endDate: endAt.toISOString(),
    totalDays,
  };
}

function resetEditChargePlanForm() {
  editingChargePlanSegment = null;

  if (dom?.editSegmentStartDateInput instanceof HTMLInputElement) {
    dom.editSegmentStartDateInput.value = "";
  }
  if (dom?.editSegmentStartPartInput instanceof HTMLSelectElement) {
    dom.editSegmentStartPartInput.value = "am";
  }
  if (dom?.editSegmentEndDateInput instanceof HTMLInputElement) {
    dom.editSegmentEndDateInput.value = "";
  }
  if (dom?.editSegmentEndPartInput instanceof HTMLSelectElement) {
    dom.editSegmentEndPartInput.value = "pm";
  }

  setEditChargePlanFeedback("");
  closeModal(dom?.editSegmentModal);
}

function findChargePlanSegmentContext(segmentId, boardEl) {
  const normalizedSegmentId = Number(segmentId);
  const selectedProject = getSelectedProject();
  if (!Number.isInteger(normalizedSegmentId) || !selectedProject) {
    return null;
  }

  const segmentField = getTimelineSegmentField(boardEl);
  for (const worker of selectedProject.workers || []) {
    const segment = (worker?.[segmentField] || []).find(
      (currentSegment) => Number(currentSegment?.id) === normalizedSegmentId
    );
    if (segment) {
      return {
        projectId: Number(selectedProject.id),
        boardEl,
        worker,
        segment,
        segmentField,
      };
    }
  }

  return null;
}

function openEditChargePlanModal(segmentId, boardEl) {
  const segmentContext = findChargePlanSegmentContext(segmentId, boardEl);
  if (!segmentContext) {
    return;
  }

  const startAt = parseRawDateTime(segmentContext.segment?.startAt);
  const endAt = parseRawDateTime(segmentContext.segment?.endAt);
  if (!startAt || !endAt) {
    return;
  }

  editingChargePlanSegment = segmentContext;
  dom.editSegmentStartDateInput.value = toDateInputValue(startAt);
  dom.editSegmentStartPartInput.value = getSegmentHalfDayPart(startAt, "start");
  dom.editSegmentEndDateInput.value = toDateInputValue(endAt);
  dom.editSegmentEndPartInput.value = getSegmentHalfDayPart(endAt, "end");
  setEditChargePlanFeedback("");
  openModal(dom.editSegmentModal);
}

async function saveEditedChargePlanSegment() {
  if (!editingChargePlanSegment) {
    return;
  }

  const selection = buildChargePlanSelectionFromEditValues({
    startDateValue: dom.editSegmentStartDateInput.value,
    startPart: dom.editSegmentStartPartInput.value,
    endDateValue: dom.editSegmentEndDateInput.value,
    endPart: dom.editSegmentEndPartInput.value,
  });

  if (selection.error) {
    setEditChargePlanFeedback(selection.error);
    return;
  }

  const annotatedSelection = annotateChargePlanSelection(
    editingChargePlanSegment.worker?.id,
    selection,
    {
      ignoreSegmentId: editingChargePlanSegment.segment?.id,
      segmentField: editingChargePlanSegment.segmentField,
    }
  );

  if (annotatedSelection?.hasOverlap) {
    setEditChargePlanFeedback(
      "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
    );
    return;
  }

  await updateTimeSegment({
    segmentId: editingChargePlanSegment.segment?.id,
    startDate: selection.startDate,
    endDate: selection.endDate,
    allocationDays: selection.totalDays,
  });

  resetEditChargePlanForm();
  await loadData();
}

function isChargePlanWheelZoomZone(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(".charge-plan-header-day-strip") ||
      target.closest(".charge-plan-header-month-title") ||
      target.closest(".charge-plan-day-tick")
  );
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
  if (
    editingChargePlanSegment &&
    (!selectedProject || Number(selectedProject.id) !== editingChargePlanSegment.projectId)
  ) {
    resetEditChargePlanForm();
  }
  renderWorkerOptions(dom.workerNameSelect, state.teamMembers, selectedProject);
  dom.saveWorkerBtn.disabled = dom.workerNameSelect.disabled || !selectedProject;
  renderBudgetPreview(dom.budgetLinesContainer, state.newProjectBudgetLines);

  if (!selectedProject) {
    clearProjectSummary(dom);
    clearKpi(dom);
    clearChargePlanTimeline(dom);
    clearRealChargeTimeline(dom);
    clearPlanningManagement(dom.planManagementBoard);
    clearTables(dom);
    clearSpendingBillingEditor(dom.spendingBillingEditor);
    clearSpendingChartControls(dom.spendingChartControls);
    state.spendingChart = destroyChart(state.spendingChart);
    return;
  }

  renderProjectSummary(dom, selectedProject, getProjectBudgetTotal(selectedProject));
  renderChargePlanSection(selectedProject);
  renderPlanningManagementSection(selectedProject);
  renderTables(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  });
  renderSpendingBillingEditor(dom.spendingBillingEditor, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  });
  renderSpendingChartControls(dom.spendingChartControls);
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

function renderPlanningManagementSection(selectedProject = getSelectedProject()) {
  if (!selectedProject) {
    planningManagementMonthPickerOpen = false;
    clearPlanningManagement(dom.planManagementBoard);
    return;
  }

  renderPlanningManagement(dom.planManagementBoard, selectedProject, planningManagementMonthKey, {
    monthPickerOpen: planningManagementMonthPickerOpen,
    monthPickerViewYear: planningManagementMonthPickerViewYear,
  });
}

function shiftPlanningManagementMonth(monthKey, deltaMonths = 0) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return getMonthKeyFromDate(new Date());
  }

  const cursor = new Date(parsed.year, parsed.monthNumber - 1, 1, 12, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() + deltaMonths);
  return toMonthKey(cursor.getFullYear(), cursor.getMonth() + 1);
}

function syncPlanningManagementMonthPickerViewYear(monthKey = planningManagementMonthKey) {
  const parsed = parseMonthKey(monthKey);
  planningManagementMonthPickerViewYear = parsed?.year || new Date().getFullYear();
}

function handlePlanningManagementControlClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  if (target.classList.contains("planning-management-month-trigger")) {
    if (!planningManagementMonthPickerOpen) {
      syncPlanningManagementMonthPickerViewYear();
    }

    planningManagementMonthPickerOpen = !planningManagementMonthPickerOpen;
    renderPlanningManagementSection();
    return;
  }

  if (target.classList.contains("planning-management-month-picker-nav-btn")) {
    const yearDelta = Number(target.dataset.monthPickerYearDelta);
    if (!Number.isInteger(yearDelta)) {
      return;
    }

    planningManagementMonthPickerOpen = true;
    planningManagementMonthPickerViewYear += yearDelta;
    renderPlanningManagementSection();
    return;
  }

  if (target.classList.contains("planning-management-month-picker-month-btn")) {
    const normalizedMonthKey = parseMonthKey(target.dataset.monthValue)
      ? String(target.dataset.monthValue).trim()
      : "";
    if (!normalizedMonthKey) {
      return;
    }

    planningManagementMonthKey = normalizedMonthKey;
    planningManagementMonthPickerOpen = false;
    syncPlanningManagementMonthPickerViewYear(normalizedMonthKey);
    renderPlanningManagementSection();
    return;
  }

  if (!target.classList.contains("planning-management-nav-btn")) return;

  const monthDelta = Number(target.dataset.monthDelta);
  if (!Number.isInteger(monthDelta)) {
    return;
  }

  planningManagementMonthKey = shiftPlanningManagementMonth(
    planningManagementMonthKey,
    monthDelta
  );
  planningManagementMonthPickerOpen = false;
  syncPlanningManagementMonthPickerViewYear(planningManagementMonthKey);
  renderPlanningManagementSection();
}

function handlePlanningManagementControlChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("planning-management-month-input")) return;

  const normalizedMonthKey = parseMonthKey(target.value)
    ? String(target.value).trim()
    : "";
  if (!normalizedMonthKey || normalizedMonthKey === planningManagementMonthKey) {
    return;
  }

  planningManagementMonthKey = normalizedMonthKey;
  planningManagementMonthPickerOpen = false;
  syncPlanningManagementMonthPickerViewYear(planningManagementMonthKey);
  renderPlanningManagementSection();
}

function clearPlanningManagementHover() {
  if (!planningManagementHover) {
    return;
  }

  planningManagementHover = null;
  renderPlanningManagementSection();
}

function getPlanningBoardLabel(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return "";
  }

  return boardEl === dom?.realChargeBoard ? "Reel" : "Previsionnel";
}

function updatePlanningManagementHoverFromSegment(segmentEl, boardEl) {
  if (!(segmentEl instanceof HTMLElement)) {
    clearPlanningManagementHover();
    return;
  }

  const startAtMs = Number(segmentEl.dataset.startAtMs);
  const endAtMs = Number(segmentEl.dataset.endAtMs);
  const workerId = Number(segmentEl.dataset.workerId);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) {
    clearPlanningManagementHover();
    return;
  }

  const startAt = new Date(startAtMs);
  const endAt = new Date(endAtMs);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    clearPlanningManagementHover();
    return;
  }

  const worker = getSelectedProjectWorker(workerId);
  const nextHover = {
    segmentId: Number(segmentEl.dataset.segmentId),
    workerId,
    workerName: worker?.name || "",
    boardLabel: getPlanningBoardLabel(boardEl),
    startAt,
    endAt,
  };

  const currentHover = planningManagementHover;
  if (
    currentHover &&
    currentHover.segmentId === nextHover.segmentId &&
    currentHover.workerId === nextHover.workerId &&
    currentHover.startAt?.getTime?.() === nextHover.startAt.getTime() &&
    currentHover.endAt?.getTime?.() === nextHover.endAt.getTime() &&
    currentHover.boardLabel === nextHover.boardLabel
  ) {
    return;
  }

  planningManagementHover = nextHover;
  renderPlanningManagementSection();
}

function renderChargePlanSection(selectedProject = getSelectedProject()) {
  if (!selectedProject) {
    renderedChargePlanRangeStartDate = "";
    setChargePlanRangeStartDate("");
    clearChargePlanTimeline(dom);
    clearRealChargeTimeline(dom);
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
  const realChargeBoardVisible =
    dom?.realChargeBoard instanceof HTMLElement &&
    !dom.realChargeBoard.hidden &&
    window.getComputedStyle(dom.realChargeBoard).display !== "none";

  if (realChargeBoardVisible) {
    renderRealChargeTimeline(dom, selectedProject, {
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
  } else {
    clearRealChargeTimeline(dom);
  }

  restoreChargePlanViewport(dom?.chargePlanBoard || null);
  if (realChargeBoardVisible) {
    restoreChargePlanViewport(dom?.realChargeBoard || null);
  }
}

function normalizePlanningSyncProjectKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findProjectByPlanningSyncKey(projectKey) {
  const normalizedProjectKey = normalizePlanningSyncProjectKey(projectKey);
  if (!normalizedProjectKey) {
    return null;
  }

  return (
    state.projects.find((project) => {
      const nameKey = normalizePlanningSyncProjectKey(project?.name);
      const numberKey = normalizePlanningSyncProjectKey(project?.projectNumber);
      return normalizedProjectKey === nameKey || normalizedProjectKey === numberKey;
    }) || null
  );
}

function setSelectedProjectForPlanningSync(projectKey = "") {
  const nextProject = findProjectByPlanningSyncKey(projectKey);
  if (!nextProject) {
    return false;
  }

  const suppressionToken = beginChargePlanSyncSuppression();
  clearChargePlanWheelZoomFrame();
  clearChargePlanScrollSyncFrame();
  clearChargePlanVisibleDateTimer();
  clearChargePlanSyncAlignmentTimer();
  planningManagementHover = null;
  setState({
    selectedProjectId: nextProject.id,
  });
  syncStateToProjectStart(nextProject);
  renderApp();
  finishChargePlanSyncSuppression(suppressionToken);
  return true;
}

function applyChargePlanSyncViewport(viewport = {}) {
  const suppressionToken = beginChargePlanSyncSuppression();

  try {
    const nextVisibleDays = Number(viewport.visibleDays);
    const nextMode = String(viewport.mode || "").trim();
    const nextDateValue =
      normalizeChargePlanDateValue(viewport.firstVisibleDate) ||
      normalizeChargePlanDateValue(viewport.anchorDate) ||
      normalizeChargePlanDateValue(viewport.rangeStartDate);

    if (
      nextMode &&
      Object.prototype.hasOwnProperty.call(APP_CONFIG.chargeTimeline.zoomModes, nextMode)
    ) {
      setState({
        chargePlanZoomMode: nextMode,
      });
    }

    if (Number.isFinite(nextVisibleDays) && nextVisibleDays > 0) {
      const derivedZoomState = getChargePlanZoomStateFromVisibleDays(nextVisibleDays);
      setState(derivedZoomState);
    }

    if (nextDateValue) {
      const targetDate = new Date(`${nextDateValue}T12:00:00`);
      if (!Number.isNaN(targetDate.getTime())) {
        setPendingChargePlanFocus(nextDateValue, "left");
        clearChargePlanWheelZoomFrame();
        clearChargePlanVisibleDateTimer();
        setChargePlanRangeStartDate(nextDateValue);
        setState({
          selectedYear: targetDate.getFullYear(),
          selectedMonth: targetDate.getMonth(),
          chargePlanAnchorDate: nextDateValue,
        });
      }
    }

    renderChargePlanSection();
    if (nextDateValue) {
      ensureChargePlanSyncAlignedDate(nextDateValue);
    }
  } finally {
    finishChargePlanSyncSuppression(suppressionToken);
  }
}

async function loadData({ preferredProjectNumber = "" } = {}) {
  const tables = await fetchExpenseAppTables();
  const { projects, teamMembers } = buildExpenseData(tables);
  planningManagementHover = null;

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
  dom.editBudgetLinesContainer.innerHTML = "";
  resetBudgetLineEditor();
  setState({ editingBudgetLines: [] });
  resetBudgetLineDragState();
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

async function createChargePlanSegment(workerId, selection, segmentType = "previsionnel") {
  if (!selection?.startDate || !selection?.endDate || selection.totalDays <= 0) {
    return;
  }

  await createTimeSegment({
    projectTeamLink: workerId,
    startDate: selection.startDate,
    endDate: selection.endDate,
    allocationDays: selection.totalDays,
    segmentType,
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
  const segmentField = options.segmentField || "segments";
  if (!worker || !selection?.startDate || !selection?.endDate) {
    return false;
  }

  const selectionStart = parseRawDateTime(selection.startDate);
  const selectionEnd = parseRawDateTime(selection.endDate);
  if (!selectionStart || !selectionEnd) {
    return false;
  }

  return (worker?.[segmentField] || []).some((segment) => {
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
  const segmentField = options.segmentField || "segments";
  return {
    ...selection,
    hasOverlap: selectionOverlapsWorkerSegments(worker, selection, {
      ...options,
      segmentField,
    }),
  };
}

function syncChargePlanFeedback(selection, boardEl = dom?.chargePlanBoard || null) {
  if (!(boardEl instanceof HTMLElement)) return;

  if (selection?.hasOverlap) {
    setChargePlanFeedback(
      boardEl,
      "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
    );
    return;
  }

  setChargePlanFeedback(boardEl, "");
}

function getChargePlanScrollElement(boardEl = dom?.chargePlanBoard || null) {
  return boardEl?.querySelector(".charge-plan-scroll") || null;
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

function updateChargePlanDateTrigger(dateValue, boardEl = dom?.chargePlanBoard || null) {
  if (!(boardEl instanceof HTMLElement)) {
    getTimelineBoards().forEach((timelineBoardEl) => {
      updateChargePlanDateTrigger(dateValue, timelineBoardEl);
    });
    return;
  }

  const { triggerEl, popoverEl } = getChargePlanDatePickerElements(boardEl);
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

function captureChargePlanViewport(
  scrollEl = getChargePlanScrollElement(),
  leftDayOffset = null
) {
  if (!(scrollEl instanceof HTMLElement)) return;

  const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
  chargePlanViewport.scrollRatio =
    maxScrollLeft > 0 ? scrollEl.scrollLeft / maxScrollLeft : 0;
  chargePlanViewport.leftDayOffset = Number.isFinite(leftDayOffset)
    ? Number(leftDayOffset)
    : getChargePlanViewportLeftDayOffset(scrollEl);
}

function syncChargePlanScrollAcrossBoards(sourceScrollEl, sourceLeftDayOffset = null) {
  if (!(sourceScrollEl instanceof HTMLElement)) {
    return;
  }

  if (suppressChargePlanScrollEvents) {
    return;
  }

  const maxScrollLeft = Math.max(0, sourceScrollEl.scrollWidth - sourceScrollEl.clientWidth);
  const sourceRatio = maxScrollLeft > 0 ? sourceScrollEl.scrollLeft / maxScrollLeft : 0;
  const resolvedSourceLeftDayOffset = Number.isFinite(sourceLeftDayOffset)
    ? Number(sourceLeftDayOffset)
    : getChargePlanViewportLeftDayOffset(sourceScrollEl);

  suppressChargePlanScrollEvents = true;
  getTimelineBoards().forEach((boardEl) => {
    const targetScrollEl = getChargePlanScrollElement(boardEl);
    if (!(targetScrollEl instanceof HTMLElement) || targetScrollEl === sourceScrollEl) {
      return;
    }

    const targetMetrics = getChargePlanTimelineMetrics(targetScrollEl);
    const targetGeometry = getChargePlanTimelineViewportGeometry(targetScrollEl);
    const targetMaxScrollLeft = Math.max(
      0,
      targetScrollEl.scrollWidth - targetScrollEl.clientWidth
    );

    if (Number.isFinite(resolvedSourceLeftDayOffset) && targetMetrics) {
      const absoluteOffset =
        targetMetrics.trackLeft +
        clamp(
          Number(resolvedSourceLeftDayOffset),
          0,
          Math.max(targetMetrics.totalDays, 0)
        ) *
          targetMetrics.dayWidth;
      targetScrollEl.scrollLeft = clamp(
        absoluteOffset - targetGeometry.clientLeft,
        0,
        targetMaxScrollLeft
      );
      return;
    }

    targetScrollEl.scrollLeft = targetMaxScrollLeft * sourceRatio;
  });
  requestAnimationFrame(() => {
    suppressChargePlanScrollEvents = false;
  });
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

function restoreChargePlanViewport(boardEl = dom?.chargePlanBoard || null, attempt = 0) {
  const scrollEl = getChargePlanScrollElement(boardEl);
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
      if (!metrics && attempt < 8) {
        chargePlanViewportRestoreFrame = null;
        restoreChargePlanViewport(boardEl, attempt + 1);
        return;
      }

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

    if (
      nextScrollLeft == null &&
      Number.isFinite(chargePlanViewport.leftDayOffset) &&
      metrics
    ) {
      const absoluteOffset =
        metrics.trackLeft +
        clamp(
          Number(chargePlanViewport.leftDayOffset),
          0,
          Math.max(metrics.totalDays, 0)
        ) *
          metrics.dayWidth;
      nextScrollLeft = absoluteOffset - geometry.clientLeft;
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

    const leftDayOffset = getChargePlanViewportLeftDayOffset(scrollEl);
    captureChargePlanViewport(scrollEl, leftDayOffset);
    syncChargePlanVisibleDate(scrollEl, { persist: true }, boardEl);
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

function shiftIsoDateValue(dateValue, dayDelta = 0) {
  const normalizedDateValue = normalizeChargePlanDateValue(dateValue);
  if (!normalizedDateValue) {
    return "";
  }

  const date = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setDate(date.getDate() + Number(dayDelta || 0));
  return toDateInputValue(date);
}

function getChargePlanInclusiveDaySpan(startDateValue, endDateValue) {
  const normalizedStartDate = normalizeChargePlanDateValue(startDateValue);
  const normalizedEndDate = normalizeChargePlanDateValue(endDateValue);
  if (!normalizedStartDate || !normalizedEndDate) {
    return 0;
  }

  const startDate = new Date(`${normalizedStartDate}T12:00:00`);
  const endDate = new Date(`${normalizedEndDate}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }

  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}

function getChargePlanSyncProjectKey() {
  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    return "";
  }

  return String(selectedProject.name || selectedProject.projectNumber || "").trim();
}

function getChargePlanSyncViewport() {
  const scrollEl = getChargePlanScrollElement(dom?.chargePlanBoard || null);
  const firstVisibleDate =
    normalizeChargePlanDateValue(getChargePlanViewportEdgeDate(scrollEl, "left")) ||
    normalizeChargePlanDateValue(state.chargePlanAnchorDate) ||
    normalizeChargePlanDateValue(getChargePlanRangeStartDate());
  const lastVisibleDate =
    normalizeChargePlanDateValue(getChargePlanViewportEdgeDate(scrollEl, "right")) ||
    shiftIsoDateValue(
      firstVisibleDate,
      Math.max(0, Math.round(getCurrentChargePlanVisibleDays()) - 1)
    );
  const visibleDays = Math.max(
    1,
    getChargePlanInclusiveDaySpan(firstVisibleDate, lastVisibleDate) ||
      Math.round(getCurrentChargePlanVisibleDays())
  );

  const contentStartDate =
    normalizeChargePlanDateValue(getChargePlanRangeStartDate()) || firstVisibleDate;
  const rangeStartDate = firstVisibleDate;
  const rangeEndDate = lastVisibleDate || shiftIsoDateValue(firstVisibleDate, visibleDays - 1);

  return {
    mode: String(state.chargePlanZoomMode || "month").trim() || "month",
    anchorDate: normalizeChargePlanDateValue(state.chargePlanAnchorDate) || firstVisibleDate,
    firstVisibleDate,
    visibleDays,
    rangeStartDate,
    rangeEndDate,
    contentStartDate,
  };
}

function emitChargePlanSyncViewportChange(reason = "") {
  if (suppressChargePlanSyncEvents) {
    return;
  }

  const payload = {
    app: "gestion-depenses2",
    projectKey: getChargePlanSyncProjectKey(),
    viewport: getChargePlanSyncViewport(),
    meta: { reason },
  };

  chargePlanSyncListeners.forEach((listener) => {
    listener(payload);
  });
}

function syncChargePlanVisibleDate(
  scrollEl = getChargePlanScrollElement(),
  options = {},
  boardEl = dom?.chargePlanBoard || null
) {
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
    emitChargePlanSyncViewportChange("scroll");
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
    pendingChargePlanScrollSync = null;
    return;
  }

  cancelAnimationFrame(chargePlanScrollSyncFrame);
  chargePlanScrollSyncFrame = null;
  pendingChargePlanScrollSync = null;
}

function scheduleChargePlanScrollSync(
  sourceScrollEl,
  boardEl = getTimelineBoardFromElement(sourceScrollEl),
  options = {}
) {
  if (!(sourceScrollEl instanceof HTMLElement)) {
    return;
  }

  pendingChargePlanScrollSync = {
    sourceScrollEl,
    boardEl,
    persistVisibleDate:
      Boolean(options.persistVisibleDate) ||
      Boolean(pendingChargePlanScrollSync?.persistVisibleDate),
  };

  if (chargePlanScrollSyncFrame != null) {
    return;
  }

  chargePlanScrollSyncFrame = requestAnimationFrame(() => {
    chargePlanScrollSyncFrame = null;

    const pendingSync = pendingChargePlanScrollSync;
    pendingChargePlanScrollSync = null;
    if (!(pendingSync?.sourceScrollEl instanceof HTMLElement)) {
      return;
    }

    const leftDayOffset = getChargePlanViewportLeftDayOffset(
      pendingSync.sourceScrollEl
    );

    captureChargePlanViewport(pendingSync.sourceScrollEl, leftDayOffset);
    syncChargePlanScrollAcrossBoards(
      pendingSync.sourceScrollEl,
      leftDayOffset
    );
    syncChargePlanVisibleDate(
      pendingSync.sourceScrollEl,
      { persist: Boolean(pendingSync.persistVisibleDate) },
      pendingSync.boardEl
    );
  });
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

function scheduleChargePlanVisibleDateSync(
  scrollEl = getChargePlanScrollElement(),
  boardEl = dom?.chargePlanBoard || null
) {
  if (!(scrollEl instanceof HTMLElement)) {
    return;
  }

  clearChargePlanVisibleDateTimer();
  chargePlanVisibleDateTimer = setTimeout(() => {
    chargePlanVisibleDateTimer = null;
    syncChargePlanVisibleDate(scrollEl, { persist: true }, boardEl);
  }, 140);
}

function getChargePlanZoomAnchorDate() {
  const normalizedDateValue = normalizeChargePlanDateValue(state.chargePlanAnchorDate);
  const anchorDate = normalizedDateValue
    ? new Date(`${normalizedDateValue}T12:00:00`)
    : new Date();

  return Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate;
}

function getChargePlanReferenceMonthDayCountForDate(dateValue = "") {
  const normalizedDateValue = normalizeChargePlanDateValue(dateValue);
  const anchorDate = normalizedDateValue
    ? new Date(`${normalizedDateValue}T12:00:00`)
    : getChargePlanZoomAnchorDate();

  if (Number.isNaN(anchorDate.getTime())) {
    return getChargePlanReferenceMonthDayCount();
  }

  return new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
}

function getChargePlanReferenceMonthDayCount() {
  return getChargePlanReferenceMonthDayCountForDate();
}

function getChargePlanVisibleDaysBounds(dateValue = "") {
  const configuredReferenceMonthDays = Number(
    APP_CONFIG.chargeTimeline.referenceMonthDays
  );
  const monthVisibleDays =
    Number.isFinite(configuredReferenceMonthDays) && configuredReferenceMonthDays > 0
      ? configuredReferenceMonthDays
      : getChargePlanReferenceMonthDayCountForDate(dateValue);
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

  const boardEl = options.boardEl || dom?.chargePlanBoard || null;
  const scrollEl = getChargePlanScrollElement(boardEl);
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
  emitChargePlanSyncViewportChange("zoom");
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

function scheduleChargePlanWheelZoom(boardEl, clientX, deltaY, deltaMode = 0) {
  const normalizedDelta = normalizeChargePlanWheelDelta(deltaY, deltaMode);
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
    return;
  }

  pendingChargePlanWheelRequest = {
    boardEl,
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
      boardEl: request.boardEl || null,
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
  emitChargePlanSyncViewportChange("navigate");
}

function getChargePlanDatePickerElements(boardEl = dom?.chargePlanBoard || null) {
  return {
    shellEl: boardEl?.querySelector(".charge-plan-date-picker-shell") || null,
    triggerEl: boardEl?.querySelector(".charge-plan-date-trigger") || null,
    popoverEl: boardEl?.querySelector(".charge-plan-date-popover") || null,
  };
}

function getChargePlanDatePickerValue(boardEl = dom?.chargePlanBoard || null) {
  const { triggerEl } = getChargePlanDatePickerElements(boardEl);
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

function isChargePlanDatePickerOpen(boardEl = dom?.chargePlanBoard || null) {
  const { popoverEl } = getChargePlanDatePickerElements(boardEl);
  return popoverEl instanceof HTMLElement && !popoverEl.hidden;
}

function closeChargePlanDatePicker(boardEl = null) {
  if (boardEl instanceof HTMLElement) {
    hideChargePlanDatePicker(boardEl);
    return;
  }

  getTimelineBoards().forEach((timelineBoardEl) => {
    hideChargePlanDatePicker(timelineBoardEl);
  });
}

function openChargePlanDatePicker(boardEl = dom?.chargePlanBoard || null) {
  if (!(boardEl instanceof HTMLElement)) return;

  const selectedDateValue = getChargePlanDatePickerValue(boardEl);
  const view = chargePlanDatePickerView || syncChargePlanDatePickerView(selectedDateValue);
  showChargePlanDatePicker(boardEl, {
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

function closeChargePlanContextMenu(boardEl = null) {
  if (boardEl instanceof HTMLElement) {
    hideChargePlanContextMenu(boardEl);
    return;
  }

  getTimelineBoards().forEach((timelineBoardEl) => {
    hideChargePlanContextMenu(timelineBoardEl);
  });
}

function handleProjectSelectionChange() {
  const selectedValue = String(dom.projectSelect.value || "").trim();
  const selectedProjectId = selectedValue ? Number(selectedValue) : null;
  clearChargePlanWheelZoomFrame();
  clearChargePlanVisibleDateTimer();
  planningManagementHover = null;
  setState({
    selectedProjectId: Number.isInteger(selectedProjectId) ? selectedProjectId : null,
  });

  const selectedProject = getSelectedProject();
  if (selectedProject) {
    syncStateToProjectStart(selectedProject);
  }

  renderApp();
  emitChargePlanSyncViewportChange("project-change");
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
}

function handleExpenseGraphControlChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("expense-graph-unit-toggle-input")) return;

  const graphKind = target.dataset.graphKind === "real" ? "real" : "provisional";
  const nextDisplayMode = target.checked ? "days" : "currency";

  if (getExpenseGraphDisplayMode(graphKind) === nextDisplayMode) {
    return;
  }

  setExpenseGraphDisplayMode(graphKind, nextDisplayMode);

  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    return;
  }

  renderTables(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  });
}

function handleSpendingChartControlChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("spending-chart-bars-toggle-input")) return;

  const nextBarsFromTop = target.checked;
  if (getSpendingChartBarsFromTop() === nextBarsFromTop) {
    return;
  }

  setSpendingChartBarsFromTop(nextBarsFromTop);

  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    return;
  }

  const viewState = {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  };

  renderSpendingChartControls(dom.spendingChartControls);
  state.spendingChart = renderSpendingChart(
    dom.spendingChartCanvas,
    state.spendingChart,
    selectedProject,
    viewState
  );
}

function handleTeamManagementSummaryToggleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.classList.contains("team-summary-mode-toggle-input")) {
    const nextMode = target.checked ? "real" : "provisional";
    if (getTeamManagementSummaryMode() === nextMode) {
      return;
    }

    setTeamManagementSummaryMode(nextMode);
  } else if (target.classList.contains("team-summary-group-toggle-input")) {
    const nextGroupedState = target.checked;
    if (getTeamManagementSummaryGroupedByRole() === nextGroupedState) {
      return;
    }

    setTeamManagementSummaryGroupedByRole(nextGroupedState);
  } else if (target.classList.contains("team-summary-display-toggle-input")) {
    const nextDisplayMode = target.checked ? "days" : "currency";
    if (getTeamManagementSummaryDisplayMode() === nextDisplayMode) {
      return;
    }

    setTeamManagementSummaryDisplayMode(nextDisplayMode);
  } else {
    return;
  }

  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    return;
  }

  renderTables(dom, selectedProject, {
    selectedYear: state.selectedYear,
    selectedMonth: state.selectedMonth,
    monthSpan: state.monthSpan,
  });
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
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
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
  if (boardEl instanceof HTMLElement) {
    hideChargePlanContextMenu(boardEl);
  }

  if (!Number.isInteger(segmentId)) {
    return;
  }

  if (action === "edit-segment") {
    openEditChargePlanModal(segmentId, boardEl);
    return;
  }

  if (action !== "delete-segment") {
    return;
  }

  if (boardEl instanceof HTMLElement) {
    setChargePlanFeedback(boardEl, "");
  }
  await removeTimeSegment(segmentId);
  await loadData();
}

function handleChargePlanContextMenu(event) {
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
  if (!(boardEl instanceof HTMLElement)) return;
  if (!(event.target instanceof Element)) return;

  const segmentEl = event.target.closest(".charge-plan-segment-bar");
  if (!(segmentEl instanceof HTMLElement)) {
    hideChargePlanContextMenu(boardEl);
    return;
  }

  const segmentId = Number(segmentEl.dataset.segmentId);
  if (!Number.isInteger(segmentId)) {
    hideChargePlanContextMenu(boardEl);
    return;
  }

  event.preventDefault();
  setChargePlanFeedback(boardEl, "");
  showChargePlanContextMenu(boardEl, {
    clientX: event.clientX,
    clientY: event.clientY,
    segmentId,
  });
}

function handleChargePlanSegmentMouseOver(event) {
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
  if (!(boardEl instanceof HTMLElement)) return;
  if (!(event.target instanceof Element)) return;

  const segmentEl = event.target.closest(".charge-plan-segment-bar");
  if (!(segmentEl instanceof HTMLElement)) {
    return;
  }

  const relatedTarget =
    event.relatedTarget instanceof Node ? event.relatedTarget : null;
  if (relatedTarget && segmentEl.contains(relatedTarget)) {
    return;
  }

  updatePlanningManagementHoverFromSegment(segmentEl, boardEl);
}

function handleChargePlanSegmentMouseOut(event) {
  if (!(event.target instanceof Element)) return;

  const segmentEl = event.target.closest(".charge-plan-segment-bar");
  if (!(segmentEl instanceof HTMLElement)) {
    return;
  }

  const relatedTarget =
    event.relatedTarget instanceof Node ? event.relatedTarget : null;
  if (relatedTarget && segmentEl.contains(relatedTarget)) {
    return;
  }

  clearPlanningManagementHover();
}

function handleChargePlanHeaderWheel(event) {
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
  if (!(boardEl instanceof HTMLElement)) return;
  if (!(event.target instanceof Element)) return;
  if (!isChargePlanWheelZoomZone(event.target)) return;

  const headerTrack = event.target.closest(".charge-plan-header-track");
  if (!(headerTrack instanceof HTMLElement)) return;
  if (chargePlanPan || chargeTimelineDrag) return;
  event.preventDefault();

  hideChargePlanContextMenu(boardEl);
  closeChargePlanDatePicker(boardEl);
  scheduleChargePlanWheelZoom(boardEl, event.clientX, event.deltaY, event.deltaMode);
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
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
  if (!(boardEl instanceof HTMLElement)) return;
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

    if (isChargePlanDatePickerOpen(boardEl)) {
      closeChargePlanDatePicker(boardEl);
      return;
    }

    syncChargePlanDatePickerView(dateTrigger.dataset.dateValue || state.chargePlanAnchorDate);
    closeChargePlanDatePicker();
    openChargePlanDatePicker(boardEl);
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
    openChargePlanDatePicker(boardEl);
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
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
  if (!(boardEl instanceof HTMLElement)) return;
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
  openChargePlanDatePicker(boardEl);
}

function handleChargePlanPointerDown(event) {
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(event.target);
  if (!(boardEl instanceof HTMLElement)) return;
  if (!(event.target instanceof Element)) return;
  if (event.button !== 0) return;
  clearChargePlanWheelZoomFrame();
  if (event.target.closest(".charge-plan-context-menu")) return;
  if (event.target.closest(".charge-plan-date-picker-shell")) {
    hideChargePlanContextMenu(boardEl);
    return;
  }

  const headerTrack = event.target.closest(".charge-plan-header-track");
  if (headerTrack instanceof HTMLElement) {
    const scrollEl = headerTrack.closest(".charge-plan-scroll");
    if (!(scrollEl instanceof HTMLElement)) return;

    event.preventDefault();
    hideChargePlanContextMenu(boardEl);
    closeChargePlanDatePicker(boardEl);
    chargePlanPan = {
      boardEl,
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

  hideChargePlanContextMenu(boardEl);
  closeChargePlanDatePicker(boardEl);

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
        {
          ignoreSegmentId: segmentId,
          segmentField: getTimelineSegmentField(boardEl),
        }
      );

      setChargePlanFeedback(boardEl, "");
      segmentEl.classList.add("is-resizing");
      chargeTimelineDrag = {
        mode: "resize",
        boardEl,
        trackEl,
        workerId,
        segmentId,
        segmentEl,
        edge,
        fixedSlotIndex: edge === "start" ? endSlotIndex : startSlotIndex,
        currentSelection: initialSelection,
      };

      syncChargePlanFeedback(initialSelection, boardEl);
      updateChargePlanSelectionPreview(trackEl, initialSelection);
      return;
    }
  }

  if (segmentEl) return;

  const workerId = Number(trackEl.dataset.workerId);
  if (!Number.isInteger(workerId)) return;

  setChargePlanFeedback(boardEl, "");

  chargeTimelineDrag = {
    mode: "create",
    boardEl,
    trackEl,
    workerId,
    startClientX: event.clientX,
    currentSelection: annotateChargePlanSelection(
      workerId,
      computeChargePlanSelection(trackEl, event.clientX, event.clientX),
      {
        segmentField: getTimelineSegmentField(boardEl),
      }
    ),
  };

  syncChargePlanFeedback(chargeTimelineDrag.currentSelection, boardEl);
  updateChargePlanSelectionPreview(trackEl, chargeTimelineDrag.currentSelection);
}

function handleChargePlanPointerMove(event) {
  if (chargePlanPan) {
    chargePlanPan.lastClientX = event.clientX;
    const deltaX = event.clientX - chargePlanPan.startClientX;
    chargePlanPan.scrollEl.scrollLeft = chargePlanPan.startScrollLeft - deltaX;
    scheduleChargePlanScrollSync(chargePlanPan.scrollEl, chargePlanPan.boardEl);
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
      {
        ignoreSegmentId: chargeTimelineDrag.segmentId,
        segmentField: getTimelineSegmentField(chargeTimelineDrag.boardEl),
      }
    );
  } else {
    chargeTimelineDrag.currentSelection = annotateChargePlanSelection(
      chargeTimelineDrag.workerId,
      computeChargePlanSelection(
        chargeTimelineDrag.trackEl,
        chargeTimelineDrag.startClientX,
        event.clientX
      ),
      {
        segmentField: getTimelineSegmentField(chargeTimelineDrag.boardEl),
      }
    );
  }

  syncChargePlanFeedback(chargeTimelineDrag.currentSelection, chargeTimelineDrag.boardEl);
  updateChargePlanSelectionPreview(
    chargeTimelineDrag.trackEl,
    chargeTimelineDrag.currentSelection
  );
}

async function handleChargePlanPointerUp() {
  if (chargePlanPan) {
    chargePlanPan.scrollEl.classList.remove("is-panning");
    tryReleasePointerCapture(chargePlanPan.scrollEl, chargePlanPan.pointerId);
    scheduleChargePlanScrollSync(chargePlanPan.scrollEl, chargePlanPan.boardEl, {
      persistVisibleDate: true,
    });
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
    setChargePlanFeedback(dragState.boardEl, "");
    return;
  }

  if (currentSelection.hasOverlap) {
    syncChargePlanFeedback(currentSelection, dragState.boardEl);
    return;
  }

  setChargePlanFeedback(dragState.boardEl, "");
  if (dragState.mode === "resize") {
    await resizeChargePlanSegment(dragState.segmentId, currentSelection);
    return;
  }

  await createChargePlanSegment(
    workerId,
    currentSelection,
    getTimelineSegmentType(dragState.boardEl)
  );
}

function handleChargePlanScroll(event) {
  const target = event.target;
  const boardEl =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : getTimelineBoardFromElement(target);
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("charge-plan-scroll")) return;
  if (suppressChargePlanScrollEvents) return;

  scheduleChargePlanScrollSync(target, boardEl);
  scheduleChargePlanVisibleDateSync(target, boardEl);
}

function bindEvents() {
  dom.projectSelect.addEventListener("change", handleProjectSelectionChange);

  dom.addProjectBtn.addEventListener("click", (event) => {
    if (!event.isTrusted) return;

    const shouldShow = dom.addProjectForm.hidden;
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
    resetBudgetLineEditor();
    renderEditingBudgetLines();
    openModal(dom.editBudgetModal);
  });

  dom.editBudgetLinesContainer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;

    if (target.classList.contains("modify-budget-line-btn")) {
      if (editingBudgetLineIndex === index) {
        resetBudgetLineEditor();
        renderEditingBudgetLines();
        return;
      }

      startBudgetLineEditor(index);
      return;
    }

    if (!target.classList.contains("delete-budget-line-btn")) return;

    const nextLines = [...state.editingBudgetLines];
    nextLines.splice(index, 1);
    setState({ editingBudgetLines: nextLines });
    resetBudgetLineEditor();
    renderEditingBudgetLines();
  });

  dom.editBudgetLinesContainer.addEventListener("dragstart", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button")
    ) {
      event.preventDefault();
      return;
    }

    const rowEl = getBudgetEditRowFromEventTarget(event.target);
    if (!(rowEl instanceof HTMLElement) || !(event.dataTransfer instanceof DataTransfer)) {
      return;
    }

    const sourceIndex = Number(rowEl.dataset.index);
    if (!Number.isInteger(sourceIndex)) {
      return;
    }

    budgetLineDragState.sourceIndex = sourceIndex;
    budgetLineDragState.targetIndex = sourceIndex;
    budgetLineDragState.position = "after";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(sourceIndex));
    updateBudgetLineDropIndicators();
  });

  dom.editBudgetLinesContainer.addEventListener("dragover", (event) => {
    if (!Number.isInteger(budgetLineDragState.sourceIndex)) {
      return;
    }

    event.preventDefault();

    const rowEl = getBudgetEditRowFromEventTarget(event.target);
    if (!(rowEl instanceof HTMLElement)) {
      const lastIndex = state.editingBudgetLines.length - 1;
      if (lastIndex >= 0) {
        budgetLineDragState.targetIndex = lastIndex;
        budgetLineDragState.position = "after";
        updateBudgetLineDropIndicators();
      }
      return;
    }

    const targetIndex = Number(rowEl.dataset.index);
    if (!Number.isInteger(targetIndex)) {
      return;
    }

    const rowRect = rowEl.getBoundingClientRect();
    budgetLineDragState.targetIndex = targetIndex;
    budgetLineDragState.position =
      event.clientY < rowRect.top + rowRect.height / 2 ? "before" : "after";
    updateBudgetLineDropIndicators();
  });

  dom.editBudgetLinesContainer.addEventListener("drop", (event) => {
    if (!Number.isInteger(budgetLineDragState.sourceIndex)) {
      return;
    }

    event.preventDefault();
    commitBudgetLineDrop();
  });

  dom.editBudgetLinesContainer.addEventListener("dragend", () => {
    resetBudgetLineDragState();
  });

  dom.addEditBudgetLineBtn.addEventListener("click", () => {
    const chapter = dom.editBudgetChapterInput.value.trim();
    const amount = parseOptionalNumberInput(dom.editBudgetAmountInput.value);
    if (!chapter || amount == null) return;

    if (Number.isInteger(editingBudgetLineIndex)) {
      const nextLines = [...state.editingBudgetLines];
      if (!nextLines[editingBudgetLineIndex]) {
        resetBudgetLineEditor();
        renderEditingBudgetLines();
        return;
      }

      nextLines[editingBudgetLineIndex] = {
        ...nextLines[editingBudgetLineIndex],
        chapter,
        amount,
      };

      setState({ editingBudgetLines: nextLines });
    } else {
      setState({
        editingBudgetLines: [
          ...state.editingBudgetLines,
          {
            chapter,
            amount,
          },
        ],
      });
    }

    resetBudgetLineEditor();
    renderEditingBudgetLines();
    dom.editBudgetChapterInput.focus();
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

  dom.editBudgetModal.addEventListener("click", (event) => {
    if (event.target === dom.editBudgetModal) {
      resetEditBudgetForm();
    }
  });

  dom.saveEditSegmentBtn.addEventListener("click", () => {
    saveEditedChargePlanSegment().catch((error) => {
      console.error("Erreur modification segment :", error);
      setEditChargePlanFeedback("Une erreur est survenue pendant la modification du segment.");
    });
  });

  dom.cancelEditSegmentBtn.addEventListener("click", () => {
    resetEditChargePlanForm();
  });

  dom.editSegmentModal.addEventListener("click", (event) => {
    if (event.target === dom.editSegmentModal) {
      resetEditChargePlanForm();
    }
  });

  [
    dom.editSegmentStartDateInput,
    dom.editSegmentStartPartInput,
    dom.editSegmentEndDateInput,
    dom.editSegmentEndPartInput,
  ].forEach((fieldEl) => {
    fieldEl.addEventListener("input", () => {
      setEditChargePlanFeedback("");
    });
    fieldEl.addEventListener("change", () => {
      setEditChargePlanFeedback("");
    });
  });

  dom.addWorkerBtn.addEventListener("click", () => {
    const shouldShow = dom.addWorkerForm.hidden;
    toggleElement(dom.addWorkerForm, shouldShow);
  });

  dom.saveWorkerBtn.addEventListener("click", async () => {
    await handleWorkerSave();
  });

  dom.expenseBoard.addEventListener("change", handleExpenseGraphControlChange);
  dom.expenseBoard.addEventListener("change", handleTableInputChange);
  dom.realExpenseBoard.addEventListener("change", handleExpenseGraphControlChange);
  dom.spendingBillingEditor.addEventListener("change", handleTableInputChange);
  dom.spendingChartControls.addEventListener("change", handleSpendingChartControlChange);
  dom.planManagementBoard.addEventListener("click", handlePlanningManagementControlClick);
  dom.planManagementBoard.addEventListener("change", handlePlanningManagementControlChange);
  document.addEventListener("pointerdown", (event) => {
    if (!planningManagementMonthPickerOpen) {
      return;
    }

    if (!(dom?.planManagementBoard instanceof HTMLElement)) {
      planningManagementMonthPickerOpen = false;
      return;
    }

    const target = event.target;
    if (target instanceof Node && dom.planManagementBoard.contains(target)) {
      return;
    }

    planningManagementMonthPickerOpen = false;
    renderPlanningManagementSection();
  });
  dom.teamManagementRates.addEventListener("change", handleTeamManagementSummaryToggleChange);
  dom.teamManagementRates.addEventListener("change", handleTableInputChange);
  dom.teamManagementRates.addEventListener("click", handleDeleteWorker);
  const timelineBoards = [dom.chargePlanBoard, dom.realChargeBoard];

  timelineBoards.forEach((boardEl) => {
    boardEl.addEventListener("click", handleDeleteWorker);
    boardEl.addEventListener("click", handleChargePlanZoomButtonClick);
    boardEl.addEventListener("click", handleChargePlanDateControls);
    boardEl.addEventListener("click", (event) => {
      handleChargePlanContextAction(event).catch((error) => {
        console.error("Erreur action menu timeline :", error);
      });
    });
    boardEl.addEventListener("change", handleChargePlanDatePickerChange);
    boardEl.addEventListener("pointerup", (event) => {
      handleChargePlanContextAction(event).catch((error) => {
        console.error("Erreur action menu timeline :", error);
      });
    });
    boardEl.addEventListener("contextmenu", handleChargePlanContextMenu);
    boardEl.addEventListener("wheel", handleChargePlanHeaderWheel, {
      passive: false,
    });
    boardEl.addEventListener("scroll", handleChargePlanScroll, true);
    boardEl.addEventListener("pointerdown", handleChargePlanPointerDown);
  });
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
      scheduleChargePlanScrollSync(chargePlanPan.scrollEl, chargePlanPan.boardEl, {
        persistVisibleDate: true,
      });
      chargePlanPan = null;
    }
    if (!chargeTimelineDrag) return;
    if (chargeTimelineDrag.segmentEl instanceof HTMLElement) {
      chargeTimelineDrag.segmentEl.classList.remove("is-resizing");
    }
    clearChargePlanSelectionPreview(chargeTimelineDrag.trackEl);
    setChargePlanFeedback(chargeTimelineDrag.boardEl, "");
    closeChargePlanContextMenu();
    chargeTimelineDrag = null;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || dom.editBudgetModal.hidden) return;
    resetEditBudgetForm();
  });
}

export async function bootstrap() {
  dom = assertDomRefs(getDomRefs());
  applyEmbeddedPlanningSyncMode();
  toggleElement(dom.addProjectForm, false);
  toggleElement(dom.addWorkerForm, false);
  closeModal(dom.editBudgetModal);

  initGrist();
  bindEvents();
  await loadData();
  chargePlanSyncApiReady = true;
}

function exposeChargePlanSyncApi() {
  if (typeof window === "undefined") {
    return;
  }

  window.__gestionDepenses2PlanningSyncApi = {
    get isReady() {
      return chargePlanSyncApiReady;
    },
    listProjects() {
      return state.projects.map((project) => String(project?.name || project?.projectNumber || "").trim());
    },
    getSelectedProject() {
      return getChargePlanSyncProjectKey();
    },
    setSelectedProject(projectKey = "") {
      return setSelectedProjectForPlanningSync(projectKey);
    },
    getViewportBounds(viewport = {}) {
      const referenceDateValue =
        normalizeChargePlanDateValue(viewport.firstVisibleDate) ||
        normalizeChargePlanDateValue(viewport.anchorDate) ||
        normalizeChargePlanDateValue(viewport.rangeStartDate) ||
        "";
      return getChargePlanVisibleDaysBounds(referenceDateValue);
    },
    getViewport() {
      return getChargePlanSyncViewport();
    },
    applyViewport(viewport = {}) {
      applyChargePlanSyncViewport(viewport);
    },
    subscribeViewportChange(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      chargePlanSyncListeners.add(listener);
      return () => {
        chargePlanSyncListeners.delete(listener);
      };
    },
  };
}

exposeChargePlanSyncApi();

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap().catch((error) => {
      console.error("Erreur initialisation gestion-depenses2 :", error);
    });
  });
}
