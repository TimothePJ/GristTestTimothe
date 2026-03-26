import { APP_CONFIG } from "../config.js";
import {
  countPlanningTasksOverlappingRange,
  getWorkerTotalDays,
  groupWorkersByRole,
} from "../services/projectService.js";
import {
  buildDisplayedMonths,
  clamp,
  formatNumber,
  toFiniteNumber,
} from "../utils/format.js";
import {
  HALF_DAY_PARTS,
  isBusinessDay,
  createHalfDaySlotKey,
  getHalfDaySlotRange,
  getSegmentAllocationDays,
} from "../utils/timeSegments.js";

const activeVisibleSlotsByBoard = new WeakMap();
let currentBoardEl = null;
const DEFAULT_TIMELINE_OPTIONS = {
  daysField: "provisionalDays",
  segmentsField: "segments",
  timelineKind: "previsionnel",
  showControls: true,
  helperText:
    "Glissez dans une ligne pour creer un segment. Redimensionnez-le avec ses poignees. Utilisez le clic droit sur une barre pour la modifier ou la supprimer.",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getTimelineOptions(options = {}) {
  return {
    ...DEFAULT_TIMELINE_OPTIONS,
    ...(options || {}),
  };
}

function getBoardVisibleSlots(boardEl) {
  return activeVisibleSlotsByBoard.get(boardEl) || [];
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
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return fallbackDate instanceof Date ? new Date(fallbackDate) : null;
  }

  const date = new Date(`${text}T12:00:00`);
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

function getChargePlanZoomMode(mode) {
  if (Object.prototype.hasOwnProperty.call(APP_CONFIG.chargeTimeline.zoomModes, mode)) {
    return mode;
  }

  return APP_CONFIG.defaultChargePlanZoomMode;
}

function getZoomPreset(zoomMode) {
  return (
    APP_CONFIG.chargeTimeline.zoomModes[getChargePlanZoomMode(zoomMode)] ||
    APP_CONFIG.chargeTimeline.zoomModes[APP_CONFIG.defaultChargePlanZoomMode]
  );
}

function getChargePlanFixedColumnsWidth(boardEl = currentBoardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return 150 + 100;
  }

  const styles = window.getComputedStyle(boardEl);
  const nameWidth = parseFloat(
    styles.getPropertyValue("--charge-plan-name-col-width")
  );
  const totalWidth = parseFloat(
    styles.getPropertyValue("--charge-plan-total-col-width")
  );

  return (
    (Number.isFinite(nameWidth) ? nameWidth : 150) +
    (Number.isFinite(totalWidth) ? totalWidth : 100)
  );
}

function getEmbeddedPlanningVisibleWidthAdjustment(boardEl = currentBoardEl) {
  if (!(boardEl instanceof HTMLElement) || typeof window === "undefined") {
    return 0;
  }

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles =
    document.body instanceof HTMLElement ? window.getComputedStyle(document.body) : null;
  const boardStyles = window.getComputedStyle(boardEl);
  const rawValue =
    boardStyles.getPropertyValue("--sync-planning-visible-width-adjustment") ||
    bodyStyles?.getPropertyValue("--sync-planning-visible-width-adjustment") ||
    rootStyles.getPropertyValue("--sync-planning-visible-width-adjustment") ||
    "0";
  const adjustment = parseFloat(rawValue);

  return Number.isFinite(adjustment) && adjustment > 0 ? adjustment : 0;
}

function getEmbeddedPlanningReferenceVisibleWidth(boardEl = currentBoardEl) {
  if (!(boardEl instanceof HTMLElement) || typeof window === "undefined") {
    return 0;
  }

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles =
    document.body instanceof HTMLElement ? window.getComputedStyle(document.body) : null;
  const boardStyles = window.getComputedStyle(boardEl);
  const rawValue =
    boardStyles.getPropertyValue("--sync-planning-reference-visible-width") ||
    bodyStyles?.getPropertyValue("--sync-planning-reference-visible-width") ||
    rootStyles.getPropertyValue("--sync-planning-reference-visible-width") ||
    "0";
  const width = parseFloat(rawValue);

  return Number.isFinite(width) && width > 0 ? width : 0;
}

function getEmbeddedPlanningReferenceDayWidth(boardEl = currentBoardEl) {
  if (!(boardEl instanceof HTMLElement) || typeof window === "undefined") {
    return 0;
  }

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles =
    document.body instanceof HTMLElement ? window.getComputedStyle(document.body) : null;
  const boardStyles = window.getComputedStyle(boardEl);
  const rawValue =
    boardStyles.getPropertyValue("--sync-planning-reference-day-width") ||
    bodyStyles?.getPropertyValue("--sync-planning-reference-day-width") ||
    rootStyles.getPropertyValue("--sync-planning-reference-day-width") ||
    "0";
  const width = parseFloat(rawValue);

  return Number.isFinite(width) && width > 0 ? width : 0;
}

function getTimelineViewportWidth(
  boardEl = currentBoardEl,
  visibleDays = APP_CONFIG.chargeTimeline.defaultVisibleDays
) {
  const scrollEl = boardEl?.querySelector(".charge-plan-scroll");
  const fixedColumnsWidth = getChargePlanFixedColumnsWidth(boardEl);
  const embeddedVisibleWidthAdjustment = getEmbeddedPlanningVisibleWidthAdjustment(boardEl);
  const embeddedReferenceVisibleWidth = getEmbeddedPlanningReferenceVisibleWidth(boardEl);
  const embeddedReferenceDayWidth = getEmbeddedPlanningReferenceDayWidth(boardEl);
  const isEmbeddedPlanningSync =
    typeof document !== "undefined" &&
    document.body instanceof HTMLElement &&
    document.body.classList.contains("planning-sync-embedded");
  const normalizedVisibleDays = Math.max(
    APP_CONFIG.chargeTimeline.minVisibleDays,
    toFiniteNumber(visibleDays, APP_CONFIG.chargeTimeline.defaultVisibleDays)
  );

  if (isEmbeddedPlanningSync) {
    if (embeddedReferenceDayWidth > 0) {
      return Math.max(280, embeddedReferenceDayWidth * normalizedVisibleDays);
    }

    const embeddedScrollWidth = scrollEl?.clientWidth || 0;
    if (embeddedScrollWidth > 0) {
      return Math.max(280, embeddedScrollWidth - fixedColumnsWidth);
    }

    if (embeddedReferenceVisibleWidth > 0) {
      return Math.max(280, embeddedReferenceVisibleWidth);
    }

    const embeddedContainerWidth =
      boardEl?.clientWidth ||
      boardEl?.getBoundingClientRect?.().width ||
      (typeof window !== "undefined" ? window.innerWidth - 64 : 0) ||
      960;

    return Math.max(
      280,
      embeddedContainerWidth - fixedColumnsWidth - embeddedVisibleWidthAdjustment
    );
  }

  const containerWidth = Math.max(
    scrollEl?.clientWidth || 0,
    boardEl?.clientWidth || 0,
    boardEl?.getBoundingClientRect?.().width || 0,
    typeof window !== "undefined" ? window.innerWidth - 64 : 0,
    960
  );
  return Math.max(280, containerWidth - fixedColumnsWidth);
}

function getAnchorMonthDayCount(anchorDate) {
  if (!(anchorDate instanceof Date) || Number.isNaN(anchorDate.getTime())) {
    return 30;
  }

  return new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
}

function getSizingContext({
  zoomMode,
  zoomScale = APP_CONFIG.chargeTimeline.defaultZoomScale,
  visibleDays = APP_CONFIG.chargeTimeline.defaultVisibleDays,
  anchorDate = new Date(),
  boardEl = currentBoardEl,
} = {}) {
  const normalizedVisibleDays = Math.max(
    APP_CONFIG.chargeTimeline.minVisibleDays,
    toFiniteNumber(visibleDays, APP_CONFIG.chargeTimeline.defaultVisibleDays)
  );
  const isEmbeddedPlanningSync =
    typeof document !== "undefined" &&
    document.body instanceof HTMLElement &&
    document.body.classList.contains("planning-sync-embedded");

  return {
    zoomMode: getChargePlanZoomMode(zoomMode),
    zoomScale: Math.max(0.1, toFiniteNumber(zoomScale, 1)),
    visibleDays: normalizedVisibleDays,
    timelineViewportWidth: getTimelineViewportWidth(boardEl, normalizedVisibleDays),
    isEmbeddedPlanningSync,
    referenceDayWidth: isEmbeddedPlanningSync
      ? getEmbeddedPlanningReferenceDayWidth(boardEl)
      : 0,
    anchorMonthDayCount: getAnchorMonthDayCount(anchorDate),
  };
}

function getVisibleMonthEstimate(sizingContext) {
  const context =
    sizingContext ||
    getSizingContext({
      zoomMode: APP_CONFIG.defaultChargePlanZoomMode,
      zoomScale: APP_CONFIG.chargeTimeline.defaultZoomScale,
      visibleDays: APP_CONFIG.chargeTimeline.defaultVisibleDays,
    });

  return context.visibleDays / Math.max(context.anchorMonthDayCount, 1);
}

function getHeaderLabelDensity(sizingContext) {
  const visibleMonths = getVisibleMonthEstimate(sizingContext);

  if (visibleMonths <= 0.5) {
    return {
      showAllDayLabels: true,
      showEveryOtherMondayOnly: false,
      hideAllMondayLabels: false,
      monthLabelStep: 1,
    };
  }

  if (visibleMonths >= 12) {
    return {
      showAllDayLabels: false,
      showEveryOtherMondayOnly: false,
      hideAllMondayLabels: true,
      monthLabelStep: 2,
    };
  }

  if (visibleMonths >= 6) {
    return {
      showAllDayLabels: false,
      showEveryOtherMondayOnly: true,
      hideAllMondayLabels: false,
      monthLabelStep: 1,
    };
  }

  return {
    showAllDayLabels: false,
    showEveryOtherMondayOnly: false,
    hideAllMondayLabels: false,
    monthLabelStep: 1,
  };
}

function shouldShowMondayLabel(date, density) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return false;
  }

  if (density.showAllDayLabels) {
    return true;
  }

  if (date.getDay() !== 1) {
    return false;
  }

  if (density.hideAllMondayLabels) {
    return false;
  }

  if (!density.showEveryOtherMondayOnly) {
    return true;
  }

  const utcDayCount = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
  const weekIndex = Math.floor(utcDayCount / 7);
  return weekIndex % 2 === 0;
}

function getMonthWidth(
  month,
  zoomMode,
  zoomScale = APP_CONFIG.chargeTimeline.defaultZoomScale,
  sizingContext = null
) {
  const context =
    sizingContext ||
    getSizingContext({
      zoomMode,
      zoomScale,
    });
  const safeDayCount = Math.max(1, month?.calendarDayCount || 0);
  const dayWidth =
    context.isEmbeddedPlanningSync && context.referenceDayWidth > 0
      ? context.referenceDayWidth
      : context.timelineViewportWidth / Math.max(context.visibleDays, 1);

  return Math.max(1, dayWidth * safeDayCount);
}

function getTimelineWidth(
  months,
  zoomMode,
  zoomScale = APP_CONFIG.chargeTimeline.defaultZoomScale,
  sizingContext = null
) {
  return months.reduce(
    (total, month) => total + getMonthWidth(month, zoomMode, zoomScale, sizingContext),
    0
  );
}

function buildVisibleSlots(
  months,
  zoomMode,
  zoomScale = APP_CONFIG.chargeTimeline.defaultZoomScale,
  sizingContext = null
) {
  const slots = [];
  let slotIndex = 0;
  let monthOffset = 0;

  months.forEach((month) => {
    const monthWidth = getMonthWidth(month, zoomMode, zoomScale, sizingContext);
    const dayWidth =
      month.calendarDayCount > 0
        ? monthWidth / month.calendarDayCount
        : monthWidth;
    const halfDayWidth = dayWidth / 2;

    (month.calendarDayDates || []).forEach((date, dayIndex) => {
      const isWorkingDay = isBusinessDay(date);
      HALF_DAY_PARTS.forEach((part, partIndex) => {
        const slotRange = getHalfDaySlotRange(date, part);
        if (!slotRange) {
          return;
        }

        slots.push({
          key: createHalfDaySlotKey(date, part),
          slotIndex,
          dateKey: toDateInputValue(date),
          part,
          isWorkingDay,
          leftPx: monthOffset + dayIndex * dayWidth + partIndex * halfDayWidth,
          widthPx: halfDayWidth,
          startAt: slotRange.startAt,
          endAt: slotRange.endAt,
        });
        slotIndex += 1;
      });
    });

    monthOffset += monthWidth;
  });

  return slots;
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
  const firstOfMonth = new Date(year, monthIndex, 1, 12);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStartDate = new Date(year, monthIndex, 1 - startOffset, 12);
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
        ‹
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
        ›
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

function renderHeaderMonth(
  month,
  monthIndex,
  zoomMode,
  zoomScale = APP_CONFIG.chargeTimeline.defaultZoomScale,
  sizingContext = null
) {
  const monthWidth = getMonthWidth(month, zoomMode, zoomScale, sizingContext);
  const dayWidth =
    month.calendarDayCount > 0
      ? monthWidth / month.calendarDayCount
      : monthWidth;
  const density = getHeaderLabelDensity(sizingContext);
  const showMonthLabel = monthIndex % density.monthLabelStep === 0;

  return `
    <div class="charge-plan-header-month" style="width:${monthWidth}px">
      <div class="charge-plan-header-month-title">
        <span>${showMonthLabel ? escapeHtml(month.monthLabel) : "&nbsp;"}</span>
        <span>${showMonthLabel ? month.year : "&nbsp;"}</span>
      </div>
      <div class="charge-plan-header-day-strip">
        ${(month.calendarDayDates || [])
          .map(
            (date) => `
              <span
                class="charge-plan-header-day-tick charge-plan-day-tick ${
                  isBusinessDay(date) ? "" : "is-weekend"
                }"
                style="width:${dayWidth}px"
                data-date-key="${toDateInputValue(date)}"
              >
                ${shouldShowMondayLabel(date, density) ? date.getDate() : ""}
              </span>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderTrackGrid(
  months,
  zoomMode,
  zoomScale = APP_CONFIG.chargeTimeline.defaultZoomScale,
  sizingContext = null
) {
  return `
    <div class="charge-plan-track-grid">
      ${months
        .map((month) => {
          const monthWidth = getMonthWidth(month, zoomMode, zoomScale, sizingContext);
          const dayWidth =
            month.calendarDayCount > 0
              ? monthWidth / month.calendarDayCount
              : monthWidth;
          const dayBlocks = (month.calendarDayDates || [])
            .map((date, dayIndex) => {
              return `
                <span
                  class="charge-plan-grid-day ${
                    isBusinessDay(date) ? "" : "is-weekend"
                  } ${dayIndex === 0 ? "is-first-day" : ""}"
                  style="left:${dayIndex * dayWidth}px; width:${dayWidth}px"
                  data-date-key="${toDateInputValue(date)}"
                ></span>
              `;
            })
            .join("");

          return `
            <span
              class="charge-plan-grid-month"
              style="width:${monthWidth}px"
            >
              ${dayBlocks}
            </span>
          `;
        })
        .join("")}
    </div>
  `;
}

function getVisibleSlotRange(startAt, endAt, visibleSlots) {
  let firstSlot = null;
  let lastSlot = null;

  for (const slot of visibleSlots) {
    if (startAt < slot.endAt && endAt > slot.startAt) {
      if (!firstSlot) {
        firstSlot = slot;
      }
      lastSlot = slot;
    }
  }

  if (!firstSlot || !lastSlot) {
    return null;
  }

  return {
    firstSlot,
    lastSlot,
  };
}

function buildVisibleSegmentBars(worker, visibleSlots, options = {}) {
  const timelineOptions = getTimelineOptions(options);
  const planningTasks = timelineOptions.planningTasks || [];

  return (worker?.[timelineOptions.segmentsField] || [])
    .map((segment) => {
      const startAt = segment?.startAt instanceof Date ? segment.startAt : null;
      const endAt = segment?.endAt instanceof Date ? segment.endAt : null;
      if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return null;
      }

      const slotRange = getVisibleSlotRange(startAt, endAt, visibleSlots);
      if (!slotRange) {
        return null;
      }

      const allocationDays = getSegmentAllocationDays(segment);
      const label = segment?.label || `${formatDayValue(allocationDays)} j`;
      const planningTaskCount = countPlanningTasksOverlappingRange(
        planningTasks,
        startAt,
        endAt
      );
      const leftPx = slotRange.firstSlot.leftPx;
      const widthPx =
        slotRange.lastSlot.leftPx +
        slotRange.lastSlot.widthPx -
        slotRange.firstSlot.leftPx;

      return {
        segmentId: segment.id,
        workerId: worker.id,
        startSlotIndex: slotRange.firstSlot.slotIndex,
        endSlotIndex: slotRange.lastSlot.slotIndex,
        startAtMs: startAt.getTime(),
        endAtMs: endAt.getTime(),
        leftPx,
        widthPx,
        label,
        planningTaskCount,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.leftPx !== right.leftPx) {
        return left.leftPx - right.leftPx;
      }
      return left.widthPx - right.widthPx;
    });
}

function assignSegmentLanes(bars) {
  const lanes = [];

  return bars.map((bar) => {
    let laneIndex = lanes.findIndex((laneRightEdge) => bar.leftPx >= laneRightEdge + 8);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(0);
    }

    lanes[laneIndex] = bar.leftPx + bar.widthPx;
    return {
      ...bar,
      laneIndex,
    };
  });
}

function renderSegmentBars(assignedBars) {
  return assignedBars
    .map((bar) => {
      const compact = bar.widthPx < 64;
      const planningTooltip = `${bar.planningTaskCount} plan(s) Planning Projet sur cette periode`;
      return `
        <div
          class="charge-plan-segment-bar ${compact ? "is-compact" : ""}"
          style="left:${bar.leftPx}px; top:${10 + bar.laneIndex * 32}px; width:${Math.max(
            12,
            bar.widthPx
          )}px"
          data-segment-id="${bar.segmentId}"
          data-worker-id="${bar.workerId}"
          data-start-slot-index="${bar.startSlotIndex}"
          data-end-slot-index="${bar.endSlotIndex}"
          data-start-at-ms="${bar.startAtMs}"
          data-end-at-ms="${bar.endAtMs}"
          data-planning-tooltip="${escapeHtml(planningTooltip)}"
          title="${escapeHtml(planningTooltip)}"
        >
          <span
            class="charge-plan-segment-handle is-start"
            data-resize-edge="start"
          ></span>
          <span class="charge-plan-segment-label">${escapeHtml(bar.label)}</span>
          <span
            class="charge-plan-segment-handle is-end"
            data-resize-edge="end"
          ></span>
        </div>
      `;
    })
    .join("");
}

function renderWorkerRow(
  worker,
  months,
  visibleSlots,
  zoomMode,
  zoomScale,
  sizingContext = null,
  options = {}
) {
  const timelineOptions = getTimelineOptions(options);
  const totalDays = getWorkerTotalDays(worker?.[timelineOptions.daysField]);
  const timelineWidth = getTimelineWidth(months, zoomMode, zoomScale, sizingContext);
  const visibleSegmentBars = buildVisibleSegmentBars(worker, visibleSlots, timelineOptions);
  const assignedBars = assignSegmentLanes(visibleSegmentBars);
  const laneCount = Math.max(
    1,
    assignedBars.reduce((maxLane, bar) => Math.max(maxLane, bar.laneIndex + 1), 0)
  );
  const rowHeight = Math.max(72, 20 + laneCount * 32);

  return `
    <div
      class="charge-plan-row"
      style="--timeline-width:${timelineWidth}px; --row-height:${rowHeight}px"
    >
      <div class="charge-plan-cell charge-plan-cell--name">${escapeHtml(worker.name)}</div>
      <div class="charge-plan-cell charge-plan-cell--total">${formatDayValue(totalDays)} j</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div
          class="charge-plan-track"
          data-worker-id="${worker.id}"
          data-timeline-width="${timelineWidth}"
        >
          ${renderTrackGrid(months, zoomMode, zoomScale, sizingContext)}
          <div class="charge-plan-track-bars">
            ${renderSegmentBars(assignedBars)}
          </div>
          <div class="charge-plan-selection-preview" hidden>
            <span class="charge-plan-selection-label"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRoleRow(roleLabel, timelineWidth) {
  return `
    <div
      class="charge-plan-role-row"
      style="--timeline-width:${timelineWidth}px; --row-height:48px"
    >
      <div class="charge-plan-role-cell charge-plan-role-cell--label">
        ${escapeHtml(roleLabel)}
      </div>
      <div class="charge-plan-role-cell charge-plan-role-cell--filler"></div>
    </div>
  `;
}

function renderReadonlyTrack(
  project,
  months,
  zoomMode,
  zoomScale,
  sizingContext = null,
  options = {}
) {
  const timelineOptions = getTimelineOptions(options);
  const monthlyTotals = {};

  (project?.workers || []).forEach((worker) => {
    Object.entries(worker?.[timelineOptions.daysField] || {}).forEach(([monthKey, value]) => {
      monthlyTotals[monthKey] =
        Math.round((toFiniteNumber(monthlyTotals[monthKey], 0) + toFiniteNumber(value, 0)) * 100) /
        100;
    });
  });

  return months
    .map((month) => {
      const monthWidth = getMonthWidth(month, zoomMode, zoomScale, sizingContext);
      const totalDays = toFiniteNumber(monthlyTotals[month.monthKey], 0);
      const fillRatio =
        totalDays > 0
          ? clamp(totalDays / Math.max(1, month.businessDayCount || 1), 0.08, 1)
          : 0;

      return `
        <span class="charge-plan-month-segment" style="width:${monthWidth}px">
          ${
            totalDays > 0
              ? `
                <span class="charge-plan-month-fill" style="width:calc((100% - 12px) * ${fillRatio})">
                  <span class="charge-plan-month-label">${formatDayValue(totalDays)} j</span>
                </span>
              `
              : ""
          }
        </span>
      `;
    })
    .join("");
}

function renderTotalRow(
  project,
  months,
  zoomMode,
  zoomScale,
  sizingContext = null,
  options = {}
) {
  const timelineOptions = getTimelineOptions(options);
  const timelineWidth = getTimelineWidth(months, zoomMode, zoomScale, sizingContext);
  const totalDays = (project?.workers || []).reduce(
    (sum, worker) => sum + getWorkerTotalDays(worker?.[timelineOptions.daysField]),
    0
  );

  return `
    <div
      class="charge-plan-row charge-plan-row--total"
      style="--timeline-width:${timelineWidth}px; --row-height:72px"
    >
      <div class="charge-plan-cell charge-plan-cell--name">Total</div>
      <div class="charge-plan-cell charge-plan-cell--total">${formatDayValue(totalDays)} j</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderReadonlyTrack(
            project,
            months,
            zoomMode,
            zoomScale,
            sizingContext,
            timelineOptions
          )}
        </div>
      </div>
    </div>
  `;
}

function getTrackSlots(trackEl) {
  const boardEl =
    trackEl instanceof Element ? trackEl.closest("[data-timeline-board-kind]") : null;
  return getBoardVisibleSlots(boardEl);
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
    startDate: orderedFirst.startAt.toISOString(),
    endDate: orderedLast.endAt.toISOString(),
    totalDays: Math.round(totalDays * 100) / 100,
    leftPx: orderedFirst.leftPx,
    widthPx:
      orderedLast.leftPx + orderedLast.widthPx - orderedFirst.leftPx,
    startSlotIndex: orderedFirst.slotIndex,
    endSlotIndex: orderedLast.slotIndex,
  };
}

function getSlotIndexFromClientX(trackEl, clientX) {
  const slotEls = getTrackSlots(trackEl);
  if (!slotEls.length) return -1;

  const trackRect = trackEl.getBoundingClientRect();
  const x = clamp(clientX - trackRect.left, 0, trackRect.width - 1);

  for (const slotEl of slotEls) {
    const startX = slotEl.leftPx;
    const endX = slotEl.leftPx + slotEl.widthPx;
    if (x >= startX && x < endX) {
      return Number(slotEl.slotIndex);
    }
  }

  return Number(slotEls[slotEls.length - 1].slotIndex);
}

function renderTimelineControls(
  zoomMode,
  selectedDate,
  selectedDateValue
) {
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

export function renderChargePlanTimeline(dom, project, viewState, options = {}) {
  const timelineOptions = getTimelineOptions(options);
  currentBoardEl = timelineOptions.boardEl || dom?.chargePlanBoard || null;
  if (!currentBoardEl || !project) {
    clearChargePlanTimeline(currentBoardEl);
    return;
  }

  currentBoardEl.dataset.timelineBoardKind = timelineOptions.timelineKind;

  const zoomMode = getChargePlanZoomMode(viewState?.chargePlanZoomMode);
  const zoomScale = clamp(
    toFiniteNumber(
      viewState?.chargePlanZoomScale,
      APP_CONFIG.chargeTimeline.defaultZoomScale
    ),
    APP_CONFIG.chargeTimeline.minZoomScale,
    APP_CONFIG.chargeTimeline.maxZoomScale
  );

  const rangeStartDate = parseDateInputValue(
    viewState?.chargePlanRangeStartDate,
    parseDateInputValue(viewState?.chargePlanAnchorDate, new Date())
  );

  const months = buildDisplayedMonths(
    rangeStartDate.getFullYear(),
    rangeStartDate.getMonth(),
    APP_CONFIG.chargeTimeline.visibleMonthSpan,
    APP_CONFIG.months
  );
  const totalCalendarDays = months.reduce(
    (sum, month) => sum + Math.max(0, month.calendarDayCount || 0),
    0
  );
  const selectedDateValue =
    String(viewState?.chargePlanDisplayedDate || "").trim() ||
    String(viewState?.chargePlanAnchorDate || "").trim() ||
    toDateInputValue(new Date());
  const selectedDate = parseDateInputValue(selectedDateValue, new Date());
  const sizingContext = getSizingContext({
    zoomMode,
    zoomScale,
    visibleDays: viewState?.chargePlanVisibleDays,
    anchorDate: selectedDate,
    boardEl: currentBoardEl,
  });
  const timelineWidth = getTimelineWidth(months, zoomMode, zoomScale, sizingContext);

  const activeVisibleSlots = buildVisibleSlots(months, zoomMode, zoomScale, sizingContext);
  activeVisibleSlotsByBoard.set(currentBoardEl, activeVisibleSlots);

  const groupedWorkers = groupWorkersByRole(project?.workers || []);
  const rows = Object.entries(groupedWorkers)
    .map(([roleLabel, workers]) => {
      return [
        renderRoleRow(roleLabel, timelineWidth),
        ...(workers || []).map((worker) =>
          renderWorkerRow(
            worker,
            months,
            activeVisibleSlots,
            zoomMode,
            zoomScale,
            sizingContext,
            {
              ...timelineOptions,
              planningTasks: project?.planningTasks || [],
            }
          )
        ),
      ].join("");
    })
    .join("");

  currentBoardEl.innerHTML = `
    <div class="charge-plan-helper">
      <div class="charge-plan-helper-copy">
        <span>${escapeHtml(timelineOptions.helperText)}</span>
        <span class="charge-plan-feedback" hidden></span>
      </div>
      ${timelineOptions.showControls ? renderTimelineControls(zoomMode, selectedDate, selectedDateValue) : ""}
    </div>
    <div class="charge-plan-scroll">
      <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px">
        <div
          class="charge-plan-row charge-plan-row--header"
          style="--timeline-width:${timelineWidth}px; --row-height:90px"
        >
          <div class="charge-plan-cell charge-plan-cell--name">Nom</div>
          <div class="charge-plan-cell charge-plan-cell--total">Total jours</div>
          <div class="charge-plan-cell charge-plan-cell--timeline">
            <div
              class="charge-plan-header-track"
              data-timeline-width="${timelineWidth}"
              data-total-days="${totalCalendarDays}"
              data-range-start-date="${toDateInputValue(rangeStartDate)}"
            >
              ${months
                .map((month, monthIndex) =>
                  renderHeaderMonth(month, monthIndex, zoomMode, zoomScale, sizingContext)
                )
                .join("")}
            </div>
          </div>
        </div>
        ${rows}
        ${renderTotalRow(
          project,
          months,
          zoomMode,
          zoomScale,
          sizingContext,
          timelineOptions
        )}
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
  currentBoardEl =
    target instanceof HTMLElement ? target : target?.chargePlanBoard || null;

  if (currentBoardEl) {
    activeVisibleSlotsByBoard.delete(currentBoardEl);
    currentBoardEl.innerHTML = "";
  }
}

export function clearRealChargeTimeline(target) {
  const boardEl = target instanceof HTMLElement ? target : target?.realChargeBoard || null;
  if (boardEl) {
    activeVisibleSlotsByBoard.delete(boardEl);
    boardEl.innerHTML = "";
  }
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

export function computeChargePlanSelectionFromSlotIndexes(trackEl, firstSlotIndex, lastSlotIndex) {
  const slots = getTrackSlots(trackEl);
  const firstSlot = slots.find((slot) => slot.slotIndex === Number(firstSlotIndex));
  const lastSlot = slots.find((slot) => slot.slotIndex === Number(lastSlotIndex));
  return buildSelectionFromSlots(firstSlot, lastSlot, slots);
}

export function getChargePlanSlotIndexAtClientX(trackEl, clientX) {
  return getSlotIndexFromClientX(trackEl, clientX);
}

export function computeChargePlanSelection(trackEl, startClientX, endClientX) {
  const firstSlotIndex = getSlotIndexFromClientX(trackEl, startClientX);
  const lastSlotIndex = getSlotIndexFromClientX(trackEl, endClientX);
  return computeChargePlanSelectionFromSlotIndexes(trackEl, firstSlotIndex, lastSlotIndex);
}

export function updateChargePlanSelectionPreview(trackEl, selection) {
  const previewEl = trackEl?.querySelector(".charge-plan-selection-preview");
  const labelEl = previewEl?.querySelector(".charge-plan-selection-label");
  if (!(previewEl instanceof HTMLElement) || !(labelEl instanceof HTMLElement)) {
    return;
  }

  if (!selection || selection.widthPx <= 0 || selection.totalDays <= 0) {
    clearChargePlanSelectionPreview(trackEl);
    return;
  }

  previewEl.hidden = false;
  previewEl.style.left = `${selection.leftPx}px`;
  previewEl.style.width = `${selection.widthPx}px`;
  previewEl.classList.toggle("is-invalid", Boolean(selection.hasOverlap));
  labelEl.textContent = `${formatDayValue(selection.totalDays)} j`;
}

export function clearChargePlanSelectionPreview(trackEl) {
  const previewEl = trackEl?.querySelector(".charge-plan-selection-preview");
  if (!(previewEl instanceof HTMLElement)) {
    return;
  }

  previewEl.hidden = true;
  previewEl.style.left = "0px";
  previewEl.style.width = "0px";
  previewEl.classList.remove("is-invalid");

  const labelEl = previewEl.querySelector(".charge-plan-selection-label");
  if (labelEl instanceof HTMLElement) {
    labelEl.textContent = "";
  }
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
