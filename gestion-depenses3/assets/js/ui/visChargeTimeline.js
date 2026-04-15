import { APP_CONFIG } from "../config.js";
import {
  countPlanningTasksOverlappingRange,
  getWorkerTotalDays,
  groupWorkersByRole,
} from "../services/projectService.js";
import { clamp, formatNumber, toFiniteNumber } from "../utils/format.js";
import {
  HALF_DAY_PARTS,
  getHalfDaySlotRange,
  getSegmentAllocationDays,
  isBusinessDay,
} from "../utils/timeSegments.js";

const timelineStates = new WeakMap();
const DAY_IN_MS = 86400000;
const ACTIVE_DRAFT_ITEM_ID = "__charge-plan-vis-draft__";
const ROLE_ROW_HEIGHT = 44;
const WORKER_ROW_HEIGHT = 72;
const DEFAULT_TIMELINE_OPTIONS = {
  daysField: "provisionalDays",
  segmentsField: "segments",
  timelineKind: "previsionnel",
  showControls: true,
  helperText:
    "Glissez dans une ligne pour creer un segment. Redimensionnez-le avec ses poignees. Utilisez le clic droit sur une barre pour la modifier ou la supprimer.",
};
const timelineCallbacks = {
  annotateSelection: null,
  onCreateSelection: null,
  onUpdateSelection: null,
  onRangeChanged: null,
};

let activeCreateDrag = null;
let activeHeaderPan = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDateValue(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value, fallbackDate = null) {
  const normalized = normalizeDateValue(value);
  if (!normalized) {
    return fallbackDate instanceof Date ? new Date(fallbackDate) : null;
  }

  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return fallbackDate instanceof Date ? new Date(fallbackDate) : null;
  }

  return date;
}

function formatDateDisplayValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDayValue(value) {
  const formatted = formatNumber(value);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

function getTimelineOptions(options = {}) {
  return {
    ...DEFAULT_TIMELINE_OPTIONS,
    ...(options || {}),
  };
}

function getBoardKind(boardEl) {
  return boardEl?.dataset?.timelineBoardKind === "real" ? "real" : "previsionnel";
}

function getSegmentFieldForKind(kind) {
  return kind === "real" ? "realSegments" : "segments";
}

function getSegmentTypeForKind(kind) {
  return kind === "real" ? "reel" : "previsionnel";
}

function getState(boardEl) {
  return boardEl instanceof HTMLElement ? timelineStates.get(boardEl) || null : null;
}

function getTimelineViewportRange(state) {
  if (!state?.timeline) {
    return null;
  }

  const currentRange = state.timeline.getWindow?.();
  const start = currentRange?.start instanceof Date ? new Date(currentRange.start) : null;
  const end = currentRange?.end instanceof Date ? new Date(currentRange.end) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return { start, end };
}

function getInclusiveVisibleDays(range) {
  if (!range?.start || !range?.end) {
    return APP_CONFIG.chargeTimeline.defaultVisibleDays;
  }

  const firstVisibleDate = toDateInputValue(range.start);
  const lastVisibleDate = toDateInputValue(new Date(range.end.getTime() - 1));
  const firstDate = parseDateInputValue(firstVisibleDate);
  const lastDate = parseDateInputValue(lastVisibleDate);
  if (!firstDate || !lastDate) {
    return APP_CONFIG.chargeTimeline.defaultVisibleDays;
  }

  return Math.max(
    1,
    Math.round((lastDate.getTime() - firstDate.getTime()) / DAY_IN_MS) + 1
  );
}

function getWindowStartFromViewState(viewState = {}) {
  const candidates = [
    viewState?.chargePlanRangeStartDate,
    viewState?.chargePlanDisplayedDate,
    viewState?.chargePlanAnchorDate,
  ];
  const selectedDateValue =
    candidates.map(normalizeDateValue).find(Boolean) || toDateInputValue(new Date());
  const anchorDate = parseDateInputValue(selectedDateValue, new Date());
  return new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    anchorDate.getDate(),
    0,
    0,
    0,
    0
  );
}

function buildWindowFromViewState(viewState = {}) {
  const start = getWindowStartFromViewState(viewState);
  const visibleDays = Math.max(
    1,
    toFiniteNumber(viewState?.chargePlanVisibleDays, APP_CONFIG.chargeTimeline.defaultVisibleDays)
  );
  const end = new Date(start.getTime() + visibleDays * DAY_IN_MS);
  return { start, end };
}

function setRangeEventsSuppressed(state, suppressed = true) {
  if (!state) {
    return;
  }

  state.suppressedRangeEvents += suppressed ? 1 : -1;
  if (state.suppressedRangeEvents < 0) {
    state.suppressedRangeEvents = 0;
  }
}

function setTimelineWindow(state, start, end, { suppressEvents = true } = {}) {
  if (!state?.timeline || !(start instanceof Date) || !(end instanceof Date)) {
    return false;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return false;
  }

  const currentRange = getTimelineViewportRange(state);
  if (
    currentRange &&
    Math.abs(currentRange.start.getTime() - start.getTime()) < 1 &&
    Math.abs(currentRange.end.getTime() - end.getTime()) < 1
  ) {
    return true;
  }

  if (suppressEvents) {
    setRangeEventsSuppressed(state, true);
  }

  try {
    state.timeline.setWindow(start, end, { animation: false });
  } finally {
    if (suppressEvents) {
      window.setTimeout(() => {
        setRangeEventsSuppressed(state, false);
      }, 0);
    }
  }

  return true;
}

function renderDatePickerMonthOptions(selectedMonthIndex) {
  return APP_CONFIG.months
    .map(
      (monthLabel, currentMonthIndex) => `
        <option
          value="${currentMonthIndex}"
          ${currentMonthIndex === selectedMonthIndex ? "selected" : ""}
        >
          ${escapeHtml(monthLabel)}
        </option>
      `
    )
    .join("");
}

function renderDatePickerYearOptions(selectedYear) {
  const options = [];

  for (let year = selectedYear - 15; year <= selectedYear + 15; year += 1) {
    options.push(`
      <option value="${year}" ${year === selectedYear ? "selected" : ""}>
        ${year}
      </option>
    `);
  }

  return options.join("");
}

function renderChargePlanDatePicker(year, monthIndex, selectedDateValue) {
  const selectedDate = parseDateInputValue(selectedDateValue, new Date());
  const normalizedSelectedDateValue = toDateInputValue(selectedDate);
  const todayValue = toDateInputValue(new Date());
  const firstOfMonth = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStartDate = new Date(year, monthIndex, 1 - startOffset, 12, 0, 0, 0);
  const weekdayLabels = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
  const dayButtons = [];

  for (let dayOffset = 0; dayOffset < 42; dayOffset += 1) {
    const currentDate = new Date(gridStartDate);
    currentDate.setDate(gridStartDate.getDate() + dayOffset);

    const dateValue = toDateInputValue(currentDate);
    const isCurrentMonth = currentDate.getMonth() === monthIndex;
    const isSelected = dateValue === normalizedSelectedDateValue;
    const isToday = dateValue === todayValue;
    const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;

    dayButtons.push(`
      <button
        type="button"
        class="charge-plan-date-picker-day ${isCurrentMonth ? "" : "is-outside-month"} ${
          isSelected ? "is-selected" : ""
        } ${isToday ? "is-today" : ""} ${isWeekend ? "is-weekend" : ""}"
        data-date-value="${dateValue}"
      >
        ${currentDate.getDate()}
      </button>
    `);
  }

  return `
    <div class="charge-plan-date-picker-header">
      <button
        type="button"
        class="charge-plan-date-picker-nav"
        data-month-delta="-1"
        aria-label="Mois precedent"
      >
        <
      </button>
      <div class="charge-plan-date-picker-period-controls">
        <select class="charge-plan-date-picker-month-select" aria-label="Choisir un mois">
          ${renderDatePickerMonthOptions(monthIndex)}
        </select>
        <select class="charge-plan-date-picker-year-select" aria-label="Choisir une annee">
          ${renderDatePickerYearOptions(year)}
        </select>
      </div>
      <button
        type="button"
        class="charge-plan-date-picker-nav"
        data-month-delta="1"
        aria-label="Mois suivant"
      >
        >
      </button>
    </div>
    <div class="charge-plan-date-picker-weekdays">
      ${weekdayLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
    </div>
    <div class="charge-plan-date-picker-grid">
      ${dayButtons.join("")}
    </div>
  `;
}

function renderTimelineControls(zoomMode, selectedDate, selectedDateValue) {
  const zoomButtons = Object.entries(APP_CONFIG.chargeTimeline.zoomModes)
    .map(
      ([mode, preset]) => `
        <button
          type="button"
          class="charge-plan-zoom-btn ${mode === zoomMode ? "is-active" : ""}"
          data-charge-plan-zoom="${mode}"
        >
          ${escapeHtml(preset.label)}
        </button>
      `
    )
    .join("");

  return `
    <div class="charge-plan-view-controls">
      <span class="charge-plan-view-label">Vue</span>
      <div class="charge-plan-zoom-buttons" role="group" aria-label="Zoom planning">
        ${zoomButtons}
      </div>
      <div class="charge-plan-date-picker-shell">
        <button
          type="button"
          class="charge-plan-date-trigger"
          data-date-value="${escapeHtml(selectedDateValue)}"
          aria-expanded="false"
        >
          <span class="charge-plan-date-trigger-label">Date</span>
          <span class="charge-plan-date-trigger-value">${escapeHtml(
            formatDateDisplayValue(selectedDate)
          )}</span>
        </button>
        <div
          class="charge-plan-date-popover"
          data-selected-date="${escapeHtml(selectedDateValue)}"
          data-visible-year="${selectedDate.getFullYear()}"
          data-visible-month="${selectedDate.getMonth()}"
          hidden
        >
          ${renderChargePlanDatePicker(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDateValue
          )}
        </div>
      </div>
      <button
        type="button"
        class="charge-plan-date-jump-btn"
        data-charge-plan-date-action="today"
      >
        Aujourd'hui
      </button>
    </div>
  `;
}

function ensureBoardStructure(boardEl, timelineOptions, viewState = {}) {
  boardEl.dataset.timelineBoardKind = timelineOptions.timelineKind;

  const selectedDateValue =
    normalizeDateValue(viewState?.chargePlanDisplayedDate) ||
    normalizeDateValue(viewState?.chargePlanAnchorDate) ||
    toDateInputValue(new Date());
  const selectedDate = parseDateInputValue(selectedDateValue, new Date());
  const zoomMode =
    Object.prototype.hasOwnProperty.call(
      APP_CONFIG.chargeTimeline.zoomModes,
      viewState?.chargePlanZoomMode
    )
      ? viewState.chargePlanZoomMode
      : APP_CONFIG.defaultChargePlanZoomMode;

  let helperEl = boardEl.querySelector(".charge-plan-helper");
  let timelineShellEl = boardEl.querySelector(".charge-plan-vis-shell");
  let contextMenuEl = boardEl.querySelector(".charge-plan-context-menu");

  if (
    !(helperEl instanceof HTMLElement) ||
    !(timelineShellEl instanceof HTMLElement) ||
    !(contextMenuEl instanceof HTMLElement)
  ) {
    boardEl.innerHTML = `
      <div class="charge-plan-helper">
        <div class="charge-plan-helper-copy">
          <span>${escapeHtml(timelineOptions.helperText)}</span>
          <span class="charge-plan-feedback" hidden></span>
        </div>
        ${timelineOptions.showControls ? renderTimelineControls(zoomMode, selectedDate, selectedDateValue) : ""}
      </div>
      <div class="charge-plan-vis-shell">
        <div class="charge-plan-vis-header">
          <div class="charge-plan-vis-header-fixed">
            <div class="charge-plan-vis-header-cell charge-plan-vis-header-cell--name">Nom</div>
            <div class="charge-plan-vis-header-cell charge-plan-vis-header-cell--total">Total jours</div>
          </div>
          <div class="charge-plan-vis-header-axis">Planning</div>
        </div>
        <div class="charge-plan-vis-board">
          <div class="charge-plan-vis-canvas"></div>
        </div>
      </div>
      <div class="charge-plan-context-menu" hidden>
        <button
          type="button"
          class="charge-plan-context-action"
          data-action="edit-segment"
        >
          Modifier
        </button>
        <button
          type="button"
          class="charge-plan-context-action"
          data-action="delete-segment"
        >
          Supprimer le segment
        </button>
      </div>
    `;

    helperEl = boardEl.querySelector(".charge-plan-helper");
    timelineShellEl = boardEl.querySelector(".charge-plan-vis-shell");
    contextMenuEl = boardEl.querySelector(".charge-plan-context-menu");
  }

  if (helperEl instanceof HTMLElement) {
    const copyEl = helperEl.querySelector(".charge-plan-helper-copy > span");
    if (copyEl instanceof HTMLElement) {
      copyEl.textContent = timelineOptions.helperText;
    }

    const controlsEl = helperEl.querySelector(".charge-plan-view-controls");
    if (timelineOptions.showControls) {
      if (!(controlsEl instanceof HTMLElement)) {
        helperEl.insertAdjacentHTML(
          "beforeend",
          renderTimelineControls(zoomMode, selectedDate, selectedDateValue)
        );
      } else {
        controlsEl.outerHTML = renderTimelineControls(zoomMode, selectedDate, selectedDateValue);
      }
    } else if (controlsEl instanceof HTMLElement) {
      controlsEl.remove();
    }
  }

  if (timelineShellEl instanceof HTMLElement) {
    timelineShellEl.dataset.timelineKind = timelineOptions.timelineKind;
  }

  if (contextMenuEl instanceof HTMLElement) {
    contextMenuEl.hidden = true;
  }
}

function buildGroupLabel(group) {
  if (group?.kind === "role") {
    return `
      <div
        class="charge-plan-vis-label charge-plan-vis-label--role"
        style="--charge-plan-vis-row-height:${ROLE_ROW_HEIGHT}px"
      >
        <span class="charge-plan-vis-role-text">${escapeHtml(group.roleLabel || "")}</span>
      </div>
    `;
  }

  return `
    <div
      class="charge-plan-vis-label ${group?.kind === "summary" ? "charge-plan-vis-label--summary" : ""}"
      style="--charge-plan-vis-row-height:${WORKER_ROW_HEIGHT}px"
    >
      <span class="charge-plan-vis-label-name">${escapeHtml(group?.label || "")}</span>
      <span class="charge-plan-vis-label-total">${escapeHtml(group?.totalLabel || "")}</span>
    </div>
  `;
}

function buildSegmentItemContent({
  segmentId,
  workerId,
  startAt,
  endAt,
  label,
  planningTaskCount,
  draft = false,
  invalid = false,
}) {
  const compact = endAt.getTime() - startAt.getTime() <= 0.6 * DAY_IN_MS;
  const planningTooltip = `${planningTaskCount} plan(s) Planning Projet sur cette periode`;

  return `
    <div
      class="charge-plan-segment-bar ${compact ? "is-compact" : ""} ${invalid ? "is-invalid" : ""}"
      data-segment-id="${segmentId != null ? escapeHtml(segmentId) : ""}"
      data-worker-id="${workerId != null ? escapeHtml(workerId) : ""}"
      data-start-at-ms="${startAt.getTime()}"
      data-end-at-ms="${endAt.getTime()}"
      data-planning-tooltip="${escapeHtml(planningTooltip)}"
      data-draft="${draft ? "true" : "false"}"
      title="${escapeHtml(planningTooltip)}"
    >
      <span
        class="charge-plan-segment-handle is-start"
        data-resize-edge="start"
      ></span>
      <span class="charge-plan-segment-label">${escapeHtml(label)}</span>
      <span
        class="charge-plan-segment-handle is-end"
        data-resize-edge="end"
      ></span>
    </div>
  `;
}

function buildSegmentItems(project, worker, timelineOptions, planningTasks = []) {
  return (worker?.[timelineOptions.segmentsField] || [])
    .map((segment) => {
      const startAt = segment?.startAt instanceof Date ? segment.startAt : null;
      const endAt = segment?.endAt instanceof Date ? segment.endAt : null;
      if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return null;
      }

      const allocationDays = getSegmentAllocationDays(segment);
      const label = segment?.label || `${formatDayValue(allocationDays)} j`;
      const planningTaskCount = countPlanningTasksOverlappingRange(
        planningTasks,
        startAt,
        endAt
      );

      return {
        id: `segment:${segment.id}`,
        group: `worker:${worker.id}`,
        start: startAt,
        end: endAt,
        type: "range",
        editable: true,
        selectable: false,
        className: "charge-plan-vis-item charge-plan-vis-item--segment",
        content: buildSegmentItemContent({
          segmentId: segment.id,
          workerId: worker.id,
          startAt,
          endAt,
          label,
          planningTaskCount,
        }),
        segmentId: Number(segment.id),
        workerId: Number(worker.id),
        label,
        timelineKind: timelineOptions.timelineKind,
      };
    })
    .filter(Boolean);
}

function parseMonthKey(monthKey) {
  const text = String(monthKey || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  return { year, monthIndex };
}

function buildSummaryItems(project, timelineOptions) {
  const totalsByMonth = {};

  (project?.workers || []).forEach((worker) => {
    Object.entries(worker?.[timelineOptions.daysField] || {}).forEach(([monthKey, days]) => {
      totalsByMonth[monthKey] =
        Math.round((toFiniteNumber(totalsByMonth[monthKey], 0) + toFiniteNumber(days, 0)) * 100) /
        100;
    });
  });

  return Object.entries(totalsByMonth)
    .map(([monthKey, totalDays]) => {
      const parsed = parseMonthKey(monthKey);
      if (!parsed || totalDays <= 0) {
        return null;
      }

      const start = new Date(parsed.year, parsed.monthIndex, 1, 0, 0, 0, 0);
      const end = new Date(parsed.year, parsed.monthIndex + 1, 1, 0, 0, 0, 0);

      return {
        id: `summary:${timelineOptions.timelineKind}:${monthKey}`,
        group: `summary:${timelineOptions.timelineKind}`,
        start,
        end,
        type: "range",
        editable: false,
        selectable: false,
        className: "charge-plan-vis-item charge-plan-vis-item--summary",
        content: `<span class="charge-plan-vis-summary-pill">${escapeHtml(
          `${formatDayValue(totalDays)} j`
        )}</span>`,
      };
    })
    .filter(Boolean);
}

function buildTimelineDatasets(project, timelineOptions) {
  const groups = [];
  const items = [];
  const planningTasks = project?.planningTasks || [];
  let sortIndex = 0;

  Object.entries(groupWorkersByRole(project?.workers || [])).forEach(([roleLabel, workers]) => {
    groups.push({
      id: `role:${roleLabel}:${timelineOptions.timelineKind}`,
      kind: "role",
      roleLabel,
      label: roleLabel,
      totalLabel: "",
      className: "charge-plan-vis-group charge-plan-vis-group--role",
      style: `height:${ROLE_ROW_HEIGHT}px;`,
      sortIndex,
    });
    sortIndex += 1;

    (workers || []).forEach((worker) => {
      const totalDays = getWorkerTotalDays(worker?.[timelineOptions.daysField]);
      groups.push({
        id: `worker:${worker.id}`,
        kind: "worker",
        workerId: Number(worker.id),
        label: worker?.name || "",
        totalLabel: `${formatDayValue(totalDays)} j`,
        className: "charge-plan-vis-group charge-plan-vis-group--worker",
        style: `height:${WORKER_ROW_HEIGHT}px;`,
        sortIndex,
      });
      sortIndex += 1;

      items.push(...buildSegmentItems(project, worker, timelineOptions, planningTasks));
    });
  });

  const totalDays = (project?.workers || []).reduce(
    (sum, worker) => sum + getWorkerTotalDays(worker?.[timelineOptions.daysField]),
    0
  );
  groups.push({
    id: `summary:${timelineOptions.timelineKind}`,
    kind: "summary",
    label: "Total",
    totalLabel: `${formatDayValue(totalDays)} j`,
    className: "charge-plan-vis-group charge-plan-vis-group--summary",
    style: `height:${WORKER_ROW_HEIGHT}px;`,
    sortIndex,
  });

  items.push(...buildSummaryItems(project, timelineOptions));

  return { groups, items };
}

function getTimeFromClientX(state, clientX) {
  const centerPanelEl = state?.boardEl?.querySelector(".vis-panel.vis-center");
  if (!(centerPanelEl instanceof HTMLElement) || !state?.timeline?.toTime) {
    return null;
  }

  const rect = centerPanelEl.getBoundingClientRect();
  const offsetX = clamp(clientX - rect.left, 0, rect.width);
  const time = state.timeline.toTime(offsetX);
  return time instanceof Date && !Number.isNaN(time.getTime()) ? time : null;
}

function getVisibleSlotsForState(state) {
  const range = getTimelineViewportRange(state);
  const centerPanelEl = state?.boardEl?.querySelector(".vis-panel.vis-center");
  if (!range?.start || !range?.end || !(centerPanelEl instanceof HTMLElement)) {
    return [];
  }

  const visibleWidth = centerPanelEl.getBoundingClientRect().width;
  if (!Number.isFinite(visibleWidth) || visibleWidth <= 0) {
    return [];
  }

  const firstVisibleDate = parseDateInputValue(toDateInputValue(range.start));
  const lastVisibleDate = parseDateInputValue(
    toDateInputValue(new Date(range.end.getTime() - 1))
  );
  if (!firstVisibleDate || !lastVisibleDate) {
    return [];
  }

  const visibleDays = Math.max(
    1,
    Math.round((lastVisibleDate.getTime() - firstVisibleDate.getTime()) / DAY_IN_MS) + 1
  );
  const dayWidth = visibleWidth / visibleDays;
  const halfDayWidth = dayWidth / 2;
  const slots = [];
  let slotIndex = 0;

  for (let dayIndex = 0; dayIndex < visibleDays; dayIndex += 1) {
    const date = new Date(firstVisibleDate);
    date.setDate(firstVisibleDate.getDate() + dayIndex);

    HALF_DAY_PARTS.forEach((part, partIndex) => {
      const slotRange = getHalfDaySlotRange(date, part);
      if (!slotRange) {
        return;
      }

      slots.push({
        slotIndex,
        dateKey: toDateInputValue(date),
        part,
        isWorkingDay: isBusinessDay(date),
        leftPx: dayIndex * dayWidth + partIndex * halfDayWidth,
        widthPx: halfDayWidth,
        startAt: new Date(slotRange.startAt),
        endAt: new Date(slotRange.endAt),
      });
      slotIndex += 1;
    });
  }

  return slots;
}

function buildSelectionFromSlots(firstSlot, lastSlot, allSlots = []) {
  if (!firstSlot || !lastSlot) {
    return null;
  }

  const orderedFirst =
    firstSlot.slotIndex <= lastSlot.slotIndex ? firstSlot : lastSlot;
  const orderedLast =
    firstSlot.slotIndex <= lastSlot.slotIndex ? lastSlot : firstSlot;

  const selectedSlots = allSlots.filter(
    (slot) =>
      slot.slotIndex >= orderedFirst.slotIndex && slot.slotIndex <= orderedLast.slotIndex
  );
  const totalDays =
    selectedSlots.filter((slot) => slot.isWorkingDay).length / 2;

  return {
    startAt: new Date(orderedFirst.startAt),
    endAt: new Date(orderedLast.endAt),
    startDate: orderedFirst.startAt.toISOString(),
    endDate: orderedLast.endAt.toISOString(),
    totalDays: Math.round(totalDays * 100) / 100,
    startSlotIndex: orderedFirst.slotIndex,
    endSlotIndex: orderedLast.slotIndex,
  };
}

function getSlotIndexFromClientX(state, clientX) {
  const slots = getVisibleSlotsForState(state);
  const centerPanelEl = state?.boardEl?.querySelector(".vis-panel.vis-center");
  if (!slots.length || !(centerPanelEl instanceof HTMLElement)) {
    return -1;
  }

  const rect = centerPanelEl.getBoundingClientRect();
  const offsetX = clamp(clientX - rect.left, 0, Math.max(0, rect.width - 1));

  for (const slot of slots) {
    const startX = slot.leftPx;
    const endX = slot.leftPx + slot.widthPx;
    if (offsetX >= startX && offsetX < endX) {
      return Number(slot.slotIndex);
    }
  }

  return Number(slots[slots.length - 1]?.slotIndex ?? -1);
}

function buildSelectionFromClientRange(state, startClientX, endClientX) {
  const slots = getVisibleSlotsForState(state);
  if (!slots.length) {
    return null;
  }

  const firstSlotIndex = getSlotIndexFromClientX(state, startClientX);
  const lastSlotIndex = getSlotIndexFromClientX(state, endClientX);
  if (firstSlotIndex < 0 || lastSlotIndex < 0) {
    return null;
  }

  const firstSlot = slots.find((slot) => slot.slotIndex === firstSlotIndex) || null;
  const lastSlot = slots.find((slot) => slot.slotIndex === lastSlotIndex) || null;
  return buildSelectionFromSlots(firstSlot, lastSlot, slots);
}

function getHalfDayPartFromDate(date) {
  const hours = date.getHours() + date.getMinutes() / 60;
  return hours < 12.5 ? "am" : "pm";
}

function buildSelectionFromDates(startValue, endValue) {
  const rawStart = startValue instanceof Date ? new Date(startValue) : null;
  const rawEnd = endValue instanceof Date ? new Date(endValue) : null;
  if (!rawStart || !rawEnd || Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime())) {
    return null;
  }

  const orderedStart = rawStart <= rawEnd ? rawStart : rawEnd;
  const orderedEnd = rawStart <= rawEnd ? rawEnd : rawStart;
  const startSlot = getHalfDaySlotRange(orderedStart, getHalfDayPartFromDate(orderedStart));
  const endSlot = getHalfDaySlotRange(orderedEnd, getHalfDayPartFromDate(orderedEnd));
  if (!startSlot || !endSlot) {
    return null;
  }

  const startAt = new Date(startSlot.startAt);
  const endAt = new Date(endSlot.endAt);
  const totalDays = getSegmentAllocationDays({ startAt, endAt });
  return {
    startAt,
    endAt,
    startDate: startAt.toISOString(),
    endDate: endAt.toISOString(),
    totalDays,
  };
}

function annotateSelectionForBoard(boardEl, workerId, selection, options = {}) {
  if (!selection) {
    return null;
  }

  if (typeof timelineCallbacks.annotateSelection === "function") {
    return timelineCallbacks.annotateSelection(workerId, selection, {
      ...options,
      segmentField: getSegmentFieldForKind(getBoardKind(boardEl)),
    });
  }

  return selection;
}

function getDraftItem(selection, workerId, boardEl) {
  const planningTaskCount = countPlanningTasksOverlappingRange(
    getState(boardEl)?.currentPlanningTasks || [],
    selection.startAt,
    selection.endAt
  );

  return {
    id: ACTIVE_DRAFT_ITEM_ID,
    group: `worker:${workerId}`,
    start: selection.startAt,
    end: selection.endAt,
    type: "range",
    editable: false,
    selectable: false,
    className: `charge-plan-vis-item charge-plan-vis-item--draft ${
      selection.hasOverlap ? "charge-plan-vis-item--invalid" : ""
    }`,
    content: buildSegmentItemContent({
      segmentId: "",
      workerId,
      startAt: selection.startAt,
      endAt: selection.endAt,
      label: `${formatDayValue(selection.totalDays)} j`,
      planningTaskCount,
      draft: true,
      invalid: Boolean(selection.hasOverlap),
    }),
  };
}

function updateDraftItem(state, selection, workerId) {
  if (!state?.itemsDataSet) {
    return;
  }

  const nextDraftItem = getDraftItem(selection, workerId, state.boardEl);
  if (state.itemsDataSet.get(ACTIVE_DRAFT_ITEM_ID)) {
    state.itemsDataSet.update(nextDraftItem);
    return;
  }

  state.itemsDataSet.add(nextDraftItem);
}

function clearDraftItem(state) {
  if (state?.itemsDataSet?.get(ACTIVE_DRAFT_ITEM_ID)) {
    state.itemsDataSet.remove(ACTIVE_DRAFT_ITEM_ID);
  }
}

function setActiveBoardDateValue(boardEl, selectedDateValue) {
  const triggerEl = boardEl?.querySelector(".charge-plan-date-trigger");
  const valueEl = triggerEl?.querySelector(".charge-plan-date-trigger-value");
  if (!(triggerEl instanceof HTMLButtonElement) || !(valueEl instanceof HTMLElement)) {
    return;
  }

  const normalizedDateValue = normalizeDateValue(selectedDateValue);
  const selectedDate = parseDateInputValue(normalizedDateValue, new Date());
  triggerEl.dataset.dateValue = normalizedDateValue;
  valueEl.textContent = formatDateDisplayValue(selectedDate);
}

function handleBoardRangeChanged(state) {
  const viewport = getChargePlanTimelineViewport(state?.boardEl, state?.latestViewState || {});
  if (viewport?.firstVisibleDate) {
    setActiveBoardDateValue(state.boardEl, viewport.firstVisibleDate);
  }

  if (!state || state.suppressedRangeEvents > 0) {
    return;
  }

  if (typeof timelineCallbacks.onRangeChanged === "function") {
    timelineCallbacks.onRangeChanged({
      boardEl: state.boardEl,
      timelineKind: getBoardKind(state.boardEl),
      viewport,
    });
  }
}

function handleItemMoving(state, item, callback) {
  if (!item || !String(item.id || "").startsWith("segment:")) {
    callback(item);
    return;
  }

  const workerId = Number(item.workerId);
  const selection = annotateSelectionForBoard(
    state.boardEl,
    workerId,
    buildSelectionFromDates(item.start, item.end),
    {
      ignoreSegmentId: Number(item.segmentId),
    }
  );

  if (!selection || selection.totalDays <= 0) {
    callback(null);
    return;
  }

  const planningTaskCount = countPlanningTasksOverlappingRange(
    state.currentPlanningTasks || [],
    selection.startAt,
    selection.endAt
  );
  const nextItem = {
    ...item,
    start: selection.startAt,
    end: selection.endAt,
    className: `charge-plan-vis-item charge-plan-vis-item--segment ${
      selection.hasOverlap ? "charge-plan-vis-item--invalid" : ""
    }`,
    content: buildSegmentItemContent({
      segmentId: item.segmentId,
      workerId,
      startAt: selection.startAt,
      endAt: selection.endAt,
      label: item.label || `${formatDayValue(selection.totalDays)} j`,
      planningTaskCount,
      invalid: Boolean(selection.hasOverlap),
    }),
  };

  setChargePlanFeedback(
    state.boardEl,
    selection.hasOverlap
      ? "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
      : ""
  );
  callback(nextItem);
}

function handleItemMove(state, item, callback) {
  if (!item || !String(item.id || "").startsWith("segment:")) {
    callback(null);
    return;
  }

  const workerId = Number(item.workerId);
  const selection = annotateSelectionForBoard(
    state.boardEl,
    workerId,
    buildSelectionFromDates(item.start, item.end),
    {
      ignoreSegmentId: Number(item.segmentId),
    }
  );

  callback(null);

  if (!selection || selection.totalDays <= 0 || selection.hasOverlap) {
    setChargePlanFeedback(
      state.boardEl,
      selection?.hasOverlap
        ? "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
        : ""
    );
    return;
  }

  setChargePlanFeedback(state.boardEl, "");
  if (typeof timelineCallbacks.onUpdateSelection === "function") {
    Promise.resolve(
      timelineCallbacks.onUpdateSelection({
        boardEl: state.boardEl,
        timelineKind: getBoardKind(state.boardEl),
        segmentId: Number(item.segmentId),
        workerId,
        selection,
      })
    ).catch((error) => {
      console.error("Erreur mise a jour segment vis-timeline :", error);
      setChargePlanFeedback(
        state.boardEl,
        "Une erreur est survenue pendant la mise a jour du segment."
      );
    });
  }
}

function startCreateDrag(state, event) {
  if (!(event instanceof PointerEvent) || event.button !== 0 || !state?.timeline) {
    return false;
  }

  if (event.target instanceof Element && event.target.closest(".vis-panel.vis-left")) {
    return false;
  }

  const props = state.timeline.getEventProperties?.(event);
  const groupId = String(props?.group || "");
  if (!groupId || props?.item != null || !groupId.startsWith("worker:")) {
    return false;
  }

  const workerId = Number(groupId.replace("worker:", ""));
  if (!Number.isInteger(workerId)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  const selection = annotateSelectionForBoard(
    state.boardEl,
    workerId,
    buildSelectionFromClientRange(state, event.clientX, event.clientX)
  );
  if (!selection) {
    return false;
  }

  activeCreateDrag = {
    boardEl: state.boardEl,
    pointerId: event.pointerId,
    state,
    workerId,
    startClientX: event.clientX,
  };

  updateDraftItem(state, selection, workerId);
  setChargePlanFeedback(
    state.boardEl,
    selection.hasOverlap
      ? "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
      : ""
  );
  window.addEventListener("pointermove", handleCreateDragPointerMove);
  window.addEventListener("pointerup", handleCreateDragPointerUp);
  window.addEventListener("pointercancel", handleCreateDragPointerCancel);
  return true;
}

function finishActiveCreateDrag({ commit = false } = {}) {
  if (!activeCreateDrag) {
    return;
  }

  const { state, workerId, boardEl } = activeCreateDrag;
  const startClientX = activeCreateDrag.startClientX;
  const endClientX = activeCreateDrag.currentClientX ?? startClientX;
  const selection = annotateSelectionForBoard(
    boardEl,
    workerId,
    buildSelectionFromClientRange(state, startClientX, endClientX)
  );

  clearDraftItem(state);
  window.removeEventListener("pointermove", handleCreateDragPointerMove);
  window.removeEventListener("pointerup", handleCreateDragPointerUp);
  window.removeEventListener("pointercancel", handleCreateDragPointerCancel);
  activeCreateDrag = null;

  if (!commit || !selection || selection.totalDays <= 0 || selection.hasOverlap) {
    setChargePlanFeedback(
      boardEl,
      selection?.hasOverlap
        ? "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
        : ""
    );
    return;
  }

  setChargePlanFeedback(boardEl, "");
  if (typeof timelineCallbacks.onCreateSelection === "function") {
    Promise.resolve(
      timelineCallbacks.onCreateSelection({
        boardEl,
        timelineKind: getBoardKind(boardEl),
        segmentType: getSegmentTypeForKind(getBoardKind(boardEl)),
        workerId,
        selection,
      })
    ).catch((error) => {
      console.error("Erreur creation segment vis-timeline :", error);
      setChargePlanFeedback(
        boardEl,
        "Une erreur est survenue pendant la creation du segment."
      );
    });
  }
}

function startHeaderPan(state, event) {
  if (!(event instanceof PointerEvent) || event.button !== 0 || !state?.timeline) {
    return false;
  }

  if (!(event.target instanceof Element) || !event.target.closest(".vis-panel.vis-top")) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  const range = getTimelineViewportRange(state);
  const centerPanelEl = state.boardEl?.querySelector(".vis-panel.vis-center");
  if (!range?.start || !range?.end || !(centerPanelEl instanceof HTMLElement)) {
    return false;
  }

  const visibleWidth = centerPanelEl.getBoundingClientRect().width;
  if (!Number.isFinite(visibleWidth) || visibleWidth <= 0) {
    return false;
  }

  activeHeaderPan = {
    state,
    boardEl: state.boardEl,
    startClientX: event.clientX,
    startMs: range.start.getTime(),
    endMs: range.end.getTime(),
    visibleWidth,
  };

  state.boardEl.classList.add("is-header-panning");
  window.addEventListener("pointermove", handleHeaderPanPointerMove);
  window.addEventListener("pointerup", handleHeaderPanPointerUp);
  window.addEventListener("pointercancel", handleHeaderPanPointerCancel);
  return true;
}

function finishHeaderPan() {
  if (!activeHeaderPan) {
    return;
  }

  activeHeaderPan.boardEl?.classList?.remove?.("is-header-panning");
  window.removeEventListener("pointermove", handleHeaderPanPointerMove);
  window.removeEventListener("pointerup", handleHeaderPanPointerUp);
  window.removeEventListener("pointercancel", handleHeaderPanPointerCancel);
  activeHeaderPan = null;
}

function handleHeaderPanPointerMove(event) {
  if (!activeHeaderPan?.state?.timeline) {
    return;
  }

  const deltaX = event.clientX - activeHeaderPan.startClientX;
  const visibleDurationMs = activeHeaderPan.endMs - activeHeaderPan.startMs;
  if (!Number.isFinite(visibleDurationMs) || visibleDurationMs <= 0) {
    return;
  }

  const deltaMs = (-deltaX / activeHeaderPan.visibleWidth) * visibleDurationMs;
  activeHeaderPan.state.timeline.setWindow(
    new Date(activeHeaderPan.startMs + deltaMs),
    new Date(activeHeaderPan.endMs + deltaMs),
    { animation: false }
  );
}

function handleHeaderPanPointerUp() {
  finishHeaderPan();
}

function handleHeaderPanPointerCancel() {
  finishHeaderPan();
}

function handleCreateDragPointerMove(event) {
  if (!activeCreateDrag?.state) {
    return;
  }

  activeCreateDrag.currentClientX = event.clientX;
  const selection = annotateSelectionForBoard(
    activeCreateDrag.boardEl,
    activeCreateDrag.workerId,
    buildSelectionFromClientRange(
      activeCreateDrag.state,
      activeCreateDrag.startClientX,
      event.clientX
    )
  );
  if (!selection) {
    return;
  }

  updateDraftItem(activeCreateDrag.state, selection, activeCreateDrag.workerId);
  setChargePlanFeedback(
    activeCreateDrag.boardEl,
    selection.hasOverlap
      ? "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne."
      : ""
  );
}

function handleCreateDragPointerUp() {
  finishActiveCreateDrag({ commit: true });
}

function handleCreateDragPointerCancel() {
  finishActiveCreateDrag({ commit: false });
}

function ensureTimelineState(boardEl) {
  const existingState = getState(boardEl);
  if (existingState) {
    return existingState;
  }

  if (!window.vis || !window.vis.DataSet || !window.vis.Timeline) {
    throw new Error("vis-timeline n'est pas charge.");
  }

  const timelineEl = boardEl.querySelector(".charge-plan-vis-canvas");
  if (!(timelineEl instanceof HTMLElement)) {
    throw new Error("Zone timeline vis introuvable.");
  }

  const groupsDataSet = new window.vis.DataSet([]);
  const itemsDataSet = new window.vis.DataSet([]);
  const state = {
    boardEl,
    timelineEl,
    groupsDataSet,
    itemsDataSet,
    timeline: null,
    latestViewState: {},
    currentPlanningTasks: [],
    suppressedRangeEvents: 0,
  };

  const timeline = new window.vis.Timeline(timelineEl, itemsDataSet, groupsDataSet, {
    locale: "fr",
    orientation: {
      axis: "top",
      item: "top",
    },
    stack: false,
    multiselect: false,
    selectable: false,
    moveable: false,
    zoomable: false,
    verticalScroll: true,
    groupHeightMode: "fixed",
    editable: {
      add: false,
      remove: false,
      updateGroup: false,
      updateTime: true,
    },
    margin: {
      item: { horizontal: 6, vertical: 10 },
      axis: 0,
    },
    showCurrentTime: false,
    tooltip: {
      followMouse: true,
      overflowMethod: "cap",
    },
    showTooltips: false,
    groupOrder: (left, right) => {
      const leftIndex = Number.isFinite(left?.sortIndex) ? left.sortIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isFinite(right?.sortIndex) ? right.sortIndex : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    },
    groupTemplate: (group) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = buildGroupLabel(group);
      return wrapper.firstElementChild || wrapper;
    },
    onMoving: (item, callback) => {
      handleItemMoving(state, item, callback);
    },
    onMove: (item, callback) => {
      handleItemMove(state, item, callback);
    },
  });

  state.timeline = timeline;
  timeline.on("rangechanged", () => {
    handleBoardRangeChanged(state);
  });

  const boardSurfaceEl = boardEl.querySelector(".charge-plan-vis-board");
  if (boardSurfaceEl instanceof HTMLElement) {
    boardSurfaceEl.addEventListener(
      "pointerdown",
      (event) => {
        if (startHeaderPan(state, event)) {
          return;
        }
        startCreateDrag(state, event);
      },
      true
    );
  }

  timelineStates.set(boardEl, state);
  return state;
}

function destroyTimelineState(boardEl) {
  const state = getState(boardEl);
  if (!state) {
    return;
  }

  clearDraftItem(state);
  if (activeCreateDrag?.boardEl === boardEl) {
    finishActiveCreateDrag({ commit: false });
  }
  if (activeHeaderPan?.boardEl === boardEl) {
    finishHeaderPan();
  }

  try {
    state.timeline?.destroy?.();
  } catch (_error) {
    // Ignore vis destroy edge cases.
  }

  timelineStates.delete(boardEl);
}

function syncBoardControls(boardEl, viewState = {}) {
  const zoomMode =
    Object.prototype.hasOwnProperty.call(
      APP_CONFIG.chargeTimeline.zoomModes,
      viewState?.chargePlanZoomMode
    )
      ? viewState.chargePlanZoomMode
      : APP_CONFIG.defaultChargePlanZoomMode;
  boardEl
    ?.querySelectorAll?.(".charge-plan-zoom-btn")
    ?.forEach?.((buttonEl) => {
      if (buttonEl instanceof HTMLButtonElement) {
        buttonEl.classList.toggle(
          "is-active",
          String(buttonEl.dataset.chargePlanZoom || "") === zoomMode
        );
      }
    });

  const selectedDateValue =
    normalizeDateValue(viewState?.chargePlanDisplayedDate) ||
    normalizeDateValue(viewState?.chargePlanAnchorDate) ||
    "";
  if (selectedDateValue) {
    setActiveBoardDateValue(boardEl, selectedDateValue);
  }
}

export function setChargePlanTimelineCallbacks(callbacks = {}) {
  Object.keys(timelineCallbacks).forEach((key) => {
    timelineCallbacks[key] =
      typeof callbacks[key] === "function" ? callbacks[key] : timelineCallbacks[key];
  });
}

export function renderChargePlanTimeline(dom, project, viewState, options = {}) {
  const timelineOptions = getTimelineOptions(options);
  const boardEl = timelineOptions.boardEl || dom?.chargePlanBoard || null;
  if (!(boardEl instanceof HTMLElement) || !project) {
    clearChargePlanTimeline(boardEl);
    return;
  }

  ensureBoardStructure(boardEl, timelineOptions, viewState);
  const state = ensureTimelineState(boardEl);
  state.latestViewState = { ...(viewState || {}) };
  state.currentPlanningTasks = [...(project?.planningTasks || [])];

  syncBoardControls(boardEl, viewState);

  const { groups, items } = buildTimelineDatasets(project, timelineOptions);
  state.groupsDataSet.clear();
  state.itemsDataSet.clear();
  state.groupsDataSet.add(groups);
  state.itemsDataSet.add(items);

  const { start, end } = buildWindowFromViewState(viewState);
  setTimelineWindow(state, start, end, { suppressEvents: true });
}

export function renderRealChargeTimeline(dom, project, viewState) {
  return renderChargePlanTimeline(dom, project, viewState, {
    boardEl: dom?.realChargeBoard || null,
    daysField: "workedDays",
    segmentsField: "realSegments",
    timelineKind: "real",
    showControls: true,
    helperText:
      "Glissez dans une ligne pour creer un segment reel. Redimensionnez-le avec ses poignees. Utilisez le clic droit sur une barre pour la modifier ou la supprimer.",
  });
}

export function clearChargePlanTimeline(target) {
  const boardEl = target instanceof HTMLElement ? target : target?.chargePlanBoard || null;
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  destroyTimelineState(boardEl);
  boardEl.innerHTML = "";
}

export function clearRealChargeTimeline(target) {
  const boardEl = target instanceof HTMLElement ? target : target?.realChargeBoard || null;
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  destroyTimelineState(boardEl);
  boardEl.innerHTML = "";
}

export function showChargePlanDatePicker(
  boardEl,
  { selectedDateValue, visibleYear, visibleMonth }
) {
  const popoverEl = boardEl?.querySelector(".charge-plan-date-popover");
  const triggerEl = boardEl?.querySelector(".charge-plan-date-trigger");
  if (!(popoverEl instanceof HTMLElement) || !(triggerEl instanceof HTMLButtonElement)) {
    return;
  }

  popoverEl.innerHTML = renderChargePlanDatePicker(
    visibleYear,
    visibleMonth,
    selectedDateValue
  );
  popoverEl.dataset.selectedDate = selectedDateValue;
  popoverEl.dataset.visibleYear = String(visibleYear);
  popoverEl.dataset.visibleMonth = String(visibleMonth);
  popoverEl.hidden = false;
  triggerEl.setAttribute("aria-expanded", "true");
}

export function hideChargePlanDatePicker(boardEl) {
  const popoverEl = boardEl?.querySelector(".charge-plan-date-popover");
  const triggerEl = boardEl?.querySelector(".charge-plan-date-trigger");
  if (popoverEl instanceof HTMLElement) {
    popoverEl.hidden = true;
  }
  if (triggerEl instanceof HTMLButtonElement) {
    triggerEl.setAttribute("aria-expanded", "false");
  }
}

export function computeChargePlanSelectionFromSlotIndexes() {
  return null;
}

export function getChargePlanSlotIndexAtClientX() {
  return -1;
}

export function computeChargePlanSelection() {
  return null;
}

export function updateChargePlanSelectionPreview() {
  // Selection preview is handled by draft vis items.
}

export function clearChargePlanSelectionPreview() {
  // Selection preview is handled by draft vis items.
}

export function setChargePlanFeedback(boardEl, message = "") {
  const feedbackEl = boardEl?.querySelector(".charge-plan-feedback");
  if (!(feedbackEl instanceof HTMLElement)) {
    return;
  }

  feedbackEl.textContent = String(message || "").trim();
  feedbackEl.hidden = !feedbackEl.textContent;
}

export function hideChargePlanContextMenu(boardEl) {
  const menuEl = boardEl?.querySelector(".charge-plan-context-menu");
  if (!(menuEl instanceof HTMLElement)) {
    return;
  }

  menuEl.hidden = true;
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  delete menuEl.dataset.segmentId;

  menuEl.querySelectorAll(".charge-plan-context-action").forEach((actionEl) => {
    if (actionEl instanceof HTMLElement) {
      delete actionEl.dataset.segmentId;
    }
  });
}

export function showChargePlanContextMenu(boardEl, { clientX, clientY, segmentId }) {
  const menuEl = boardEl?.querySelector(".charge-plan-context-menu");
  if (!(menuEl instanceof HTMLElement)) {
    return;
  }

  menuEl.hidden = false;
  menuEl.dataset.segmentId = String(segmentId);

  menuEl.querySelectorAll(".charge-plan-context-action").forEach((actionEl) => {
    if (actionEl instanceof HTMLElement) {
      actionEl.dataset.segmentId = String(segmentId);
    }
  });

  menuEl.style.left = `${clientX}px`;
  menuEl.style.top = `${clientY}px`;

  const margin = 8;
  const menuRect = menuEl.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);

  menuEl.style.left = `${Math.min(clientX, maxLeft)}px`;
  menuEl.style.top = `${Math.min(clientY, maxTop)}px`;
}

export function getChargePlanTimelineViewport(boardEl, viewState = {}) {
  const state = getState(boardEl);
  const range = getTimelineViewportRange(state);
  if (!range) {
    return null;
  }

  const firstVisibleDate = toDateInputValue(range.start);
  const lastVisibleDate = toDateInputValue(new Date(range.end.getTime() - 1));
  const visibleDays = getInclusiveVisibleDays(range);

  return {
    mode: String(viewState?.chargePlanZoomMode || APP_CONFIG.defaultChargePlanZoomMode).trim(),
    anchorDate:
      normalizeDateValue(viewState?.chargePlanAnchorDate) ||
      firstVisibleDate,
    firstVisibleDate,
    visibleDays,
    rangeStartDate: firstVisibleDate,
    rangeEndDate: lastVisibleDate,
    contentStartDate: firstVisibleDate,
    contentStartMs: range.start.getTime(),
    leftDayOffset: 0,
    rightDayOffset: visibleDays,
    exactVisibleDays: (range.end.getTime() - range.start.getTime()) / DAY_IN_MS,
    windowStartMs: range.start.getTime(),
    windowEndMs: range.end.getTime(),
  };
}

export function applyChargePlanTimelineViewport(boardEl, viewport = {}) {
  const state = getState(boardEl);
  if (!state?.timeline) {
    return false;
  }

  let start = Number.isFinite(Number(viewport.windowStartMs))
    ? new Date(Number(viewport.windowStartMs))
    : null;
  let end = Number.isFinite(Number(viewport.windowEndMs))
    ? new Date(Number(viewport.windowEndMs))
    : null;

  if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime()) || end <= start) {
    const fallbackDateValue =
      normalizeDateValue(viewport.firstVisibleDate) ||
      normalizeDateValue(viewport.anchorDate) ||
      normalizeDateValue(viewport.rangeStartDate) ||
      toDateInputValue(new Date());
    const fallbackVisibleDays = Math.max(
      1,
      toFiniteNumber(viewport.visibleDays, APP_CONFIG.chargeTimeline.defaultVisibleDays)
    );
    start = new Date(`${fallbackDateValue}T00:00:00`);
    end = new Date(start.getTime() + fallbackVisibleDays * DAY_IN_MS);
  }

  return setTimelineWindow(state, start, end, { suppressEvents: true });
}

export function nudgeChargePlanTimelineViewport(boardEl, pixelDelta = 0) {
  const state = getState(boardEl);
  const range = getTimelineViewportRange(state);
  const centerPanelEl = state?.boardEl?.querySelector(".vis-panel.vis-center");
  if (!(centerPanelEl instanceof HTMLElement) || !range) {
    return false;
  }

  const normalizedDelta = Number(pixelDelta);
  if (!Number.isFinite(normalizedDelta) || Math.abs(normalizedDelta) < 0.1) {
    return false;
  }

  const visibleWidth = centerPanelEl.getBoundingClientRect().width;
  if (!Number.isFinite(visibleWidth) || visibleWidth <= 0) {
    return false;
  }

  const visibleDurationMs = range.end.getTime() - range.start.getTime();
  if (!Number.isFinite(visibleDurationMs) || visibleDurationMs <= 0) {
    return false;
  }

  const deltaMs = (normalizedDelta / visibleWidth) * visibleDurationMs;
  if (!Number.isFinite(deltaMs) || Math.abs(deltaMs) < 1) {
    return false;
  }

  return setTimelineWindow(
    state,
    new Date(range.start.getTime() + deltaMs),
    new Date(range.end.getTime() + deltaMs),
    { suppressEvents: true }
  );
}
