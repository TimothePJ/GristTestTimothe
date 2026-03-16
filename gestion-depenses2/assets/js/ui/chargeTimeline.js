import { APP_CONFIG } from "../config.js";
import { getWorkerTotalDays, groupWorkersByRole } from "../services/projectService.js";
import { buildDisplayedMonths, clamp, formatNumber, toFiniteNumber } from "../utils/format.js";
import {
  HALF_DAY_PARTS,
  isBusinessDay,
  getCalendarHalfDaySlotsBetween,
  createHalfDaySlotKey,
  getHalfDaySlotRange,
  getSegmentAllocationDays,
} from "../utils/timeSegments.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDayValue(value) {
  const formatted = formatNumber(value);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

function formatSlotDate(date) {
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getChargePlanZoomMode(mode) {
  if (Object.prototype.hasOwnProperty.call(APP_CONFIG.chargeTimeline.zoomModes, mode)) {
    return mode;
  }

  return APP_CONFIG.defaultChargePlanZoomMode;
}

function getZoomPreset(mode) {
  return APP_CONFIG.chargeTimeline.zoomModes[getChargePlanZoomMode(mode)];
}

function getMonthWidth(month, zoomMode) {
  const preset = getZoomPreset(zoomMode);
  const widthFromDays = month.calendarDayCount * preset.dayWidth;
  return Math.max(preset.minimumMonthWidth, widthFromDays);
}

function getTimelineWidth(months, zoomMode) {
  return months.reduce((sum, month) => sum + getMonthWidth(month, zoomMode), 0);
}

function buildVisibleSlots(months, zoomMode) {
  const slots = [];
  let nextLeftPx = 0;
  let slotIndex = 0;

  months.forEach((month) => {
    const preset = getZoomPreset(zoomMode);
    const monthWidth = getMonthWidth(month, zoomMode);
    const dayWidth =
      month.calendarDayCount > 0
        ? monthWidth / month.calendarDayCount
        : preset.minimumMonthWidth;
    const slotWidth = dayWidth / HALF_DAY_PARTS.length;
    const lastDayIndex = Math.max(0, (month.calendarDayDates || []).length - 1);

    (month.calendarDayDates || []).forEach((date, dayIndex) => {
      const workingDay = isBusinessDay(date);
      HALF_DAY_PARTS.forEach((part, partIndex) => {
        const slotRange = getHalfDaySlotRange(date, part);
        if (!slotRange) return;

        slots.push({
          slotIndex,
          key: createHalfDaySlotKey(date, part),
          monthKey: month.monthKey,
          part,
          date,
          startAt: slotRange.startAt,
          endAt: slotRange.endAt,
          isWorkingDay: workingDay,
          isWeekend: !workingDay,
          leftPx: nextLeftPx,
          widthPx: slotWidth,
          isMonthStart: dayIndex === 0 && partIndex === 0,
          isMonthEnd: dayIndex === lastDayIndex && partIndex === HALF_DAY_PARTS.length - 1,
        });

        nextLeftPx += slotWidth;
        slotIndex += 1;
      });
    });
  });

  return slots;
}

function renderHeaderMonth(month, zoomMode) {
  const preset = getZoomPreset(zoomMode);
  const monthWidth = getMonthWidth(month, zoomMode);
  const dayWidth =
    month.calendarDayCount > 0
      ? monthWidth / month.calendarDayCount
      : preset.minimumMonthWidth;

  const dayTicks = (month.calendarDayDates || [])
    .map((date, index) => {
      const weekend = !isBusinessDay(date);
      const showLabel =
        index === 0 ||
        index === month.calendarDayDates.length - 1 ||
        index % 5 === 0;

      return `
        <span
          class="charge-plan-day-tick ${weekend ? "is-weekend" : ""}"
          style="width:${dayWidth}px"
        >
          ${showLabel ? `<span>${date.getDate()}</span>` : ""}
        </span>
      `;
    })
    .join("");

  return `
    <div
      class="charge-plan-header-month"
      style="width:${monthWidth}px"
    >
      <div class="charge-plan-header-month-title">
        <strong>${escapeHtml(month.monthLabel)} ${month.year}</strong>
        <span>${month.businessDayCount} j ouvres</span>
      </div>
      <div class="charge-plan-header-day-strip">${dayTicks}</div>
    </div>
  `;
}

function renderTotalMonthSegments(
  months,
  worker = null,
  { showTotals = false, zoomMode } = {}
) {
  return months
    .map((month) => {
      const monthWidth = getMonthWidth(month, zoomMode);
      const days = worker
        ? toFiniteNumber(worker.provisionalDays?.[month.monthKey], 0)
        : toFiniteNumber(month.totalDays, 0);
      const safeBusinessDayCount = Math.max(month.businessDayCount, 1);
      const widthPercent = clamp((days / safeBusinessDayCount) * 100, 0, 100);
      const overflowDays = Math.max(0, days - safeBusinessDayCount);
      const backgroundSize =
        month.businessDayCount > 0
          ? `${monthWidth / month.businessDayCount}px 100%`
          : `${monthWidth}px 100%`;

      return `
        <div
          class="charge-plan-month-segment ${showTotals ? "is-total" : ""}"
          data-month-key="${month.monthKey}"
          style="width:${monthWidth}px; background-size:${backgroundSize}"
        >
          ${
            days > 0
              ? `
                <div
                  class="charge-plan-month-fill"
                  style="width:${widthPercent}%"
                >
                  <span class="charge-plan-month-label">${formatDayValue(days)} j</span>
                </div>
              `
              : ""
          }
          ${
            overflowDays > 0 && !showTotals
              ? `<span class="charge-plan-month-overflow">+${formatDayValue(
                  overflowDays
                )} j</span>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function renderTrackGrid(visibleSlots) {
  return `
    <div class="charge-plan-track-grid">
      ${visibleSlots
        .map(
          (slot) => `
            <span
              class="charge-plan-slot ${slot.part === "am" ? "is-am" : "is-pm"} ${
                slot.isMonthStart ? "is-month-start" : ""
              } ${slot.isWeekend ? "is-weekend" : ""} ${
                !slot.isWorkingDay ? "is-nonworking" : ""
              }"
              data-slot-index="${slot.slotIndex}"
              data-slot-key="${slot.key}"
              data-slot-start="${slot.startAt.toISOString()}"
              data-slot-end="${slot.endAt.toISOString()}"
              data-is-working="${slot.isWorkingDay ? "1" : "0"}"
              style="width:${slot.widthPx}px"
            ></span>
          `
        )
        .join("")}
    </div>
  `;
}

function buildVisibleSegmentBars(worker, visibleSlots) {
  const slotByKey = new Map(visibleSlots.map((slot) => [slot.key, slot]));

  return (worker?.segments || [])
    .map((segment) => {
      const coveredSlots = getCalendarHalfDaySlotsBetween(
        segment.startAt,
        segment.endAt
      )
        .map((slot) => slotByKey.get(slot.key))
        .filter(Boolean)
        .sort((left, right) => left.slotIndex - right.slotIndex);

      if (!coveredSlots.length) {
        return null;
      }

      const firstVisibleSlot = coveredSlots[0];
      const lastVisibleSlot = coveredSlots[coveredSlots.length - 1];
      const allocationDays = getSegmentAllocationDays(segment);
      const leftPx = firstVisibleSlot.leftPx;
      const widthPx =
        lastVisibleSlot.leftPx + lastVisibleSlot.widthPx - firstVisibleSlot.leftPx;

      return {
        segment,
        startIndex: firstVisibleSlot.slotIndex,
        endIndex: lastVisibleSlot.slotIndex,
        leftPx,
        widthPx,
        allocationDays,
        title:
          segment.label ||
          `${formatDayValue(allocationDays)} j - ${formatSlotDate(
            firstVisibleSlot.startAt
          )}`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);
}

function assignSegmentLanes(segmentBars) {
  const laneEndByIndex = [];

  return segmentBars.map((segmentBar) => {
    let laneIndex = laneEndByIndex.findIndex((laneEnd) => laneEnd < segmentBar.startIndex);

    if (laneIndex < 0) {
      laneIndex = laneEndByIndex.length;
      laneEndByIndex.push(segmentBar.endIndex);
    } else {
      laneEndByIndex[laneIndex] = segmentBar.endIndex;
    }

    return {
      ...segmentBar,
      laneIndex,
    };
  });
}

function renderSegmentBars(assignedBars) {
  return assignedBars
    .map((bar) => {
      const topPx = 10 + bar.laneIndex * 32;
      const buttonWidth = Math.max(bar.widthPx - 4, 8);
      const isCompact = buttonWidth < 64;
      return `
        <button
          type="button"
          class="charge-plan-segment-bar ${isCompact ? "is-compact" : ""}"
          data-segment-id="${bar.segment.id}"
          data-worker-id="${bar.segment.projectTeamLink}"
          data-start-slot-index="${bar.startIndex}"
          data-end-slot-index="${bar.endIndex}"
          style="left:${bar.leftPx}px; width:${buttonWidth}px; top:${topPx}px"
          title="${escapeHtml(bar.title)}"
        >
          <span class="charge-plan-segment-handle is-start" data-resize-edge="start"></span>
          <span class="charge-plan-segment-label">${escapeHtml(
            bar.segment.label || `${formatDayValue(bar.allocationDays)} j`
          )}</span>
          <span class="charge-plan-segment-handle is-end" data-resize-edge="end"></span>
        </button>
      `;
    })
    .join("");
}

function renderWorkerRow(worker, months, visibleSlots, zoomMode) {
  const totalDays = getWorkerTotalDays(worker.provisionalDays);
  const timelineWidth = getTimelineWidth(months, zoomMode);
  const visibleSegmentBars = buildVisibleSegmentBars(worker, visibleSlots);
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
      <div class="charge-plan-cell charge-plan-cell--actions">
        <button class="delete-worker-btn" data-worker-id="${worker.id}">Supprimer</button>
      </div>
      <div class="charge-plan-cell charge-plan-cell--total">${formatDayValue(totalDays)} j</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div
          class="charge-plan-track"
          data-worker-id="${worker.id}"
          data-timeline-width="${timelineWidth}"
        >
          ${renderTrackGrid(visibleSlots)}
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

function renderTotalRow(project, months, zoomMode) {
  const monthsWithTotals = months.map((month) => ({
    ...month,
    totalDays: (project.workers || []).reduce((sum, worker) => {
      return sum + toFiniteNumber(worker.provisionalDays?.[month.monthKey], 0);
    }, 0),
  }));
  const totalDays = monthsWithTotals.reduce((sum, month) => sum + month.totalDays, 0);
  const timelineWidth = getTimelineWidth(months, zoomMode);

  return `
    <div class="charge-plan-row charge-plan-row--total" style="--timeline-width:${timelineWidth}px">
      <div class="charge-plan-cell charge-plan-cell--name"><strong>Total</strong></div>
      <div class="charge-plan-cell charge-plan-cell--actions"></div>
      <div class="charge-plan-cell charge-plan-cell--total"><strong>${formatDayValue(
        totalDays
      )} j</strong></div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderTotalMonthSegments(monthsWithTotals, null, {
            showTotals: true,
            zoomMode,
          })}
        </div>
      </div>
    </div>
  `;
}

export function renderChargePlanTimeline(dom, project, viewState) {
  const zoomMode = getChargePlanZoomMode(viewState.chargePlanZoomMode);
  const displayedMonths = buildDisplayedMonths(
    viewState.selectedYear,
    viewState.selectedMonth,
    viewState.monthSpan,
    APP_CONFIG.months
  );
  const groupedWorkers = groupWorkersByRole(project.workers);
  const timelineWidth = getTimelineWidth(displayedMonths, zoomMode);
  const visibleSlots = buildVisibleSlots(displayedMonths, zoomMode);
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

  const rows = Object.entries(groupedWorkers)
    .map(
      ([role, workers]) => `
        <div class="charge-plan-role-row" style="--timeline-width:${timelineWidth}px">
          <div class="charge-plan-role-cell">${escapeHtml(role)}</div>
        </div>
        ${workers
          .map((worker) => renderWorkerRow(worker, displayedMonths, visibleSlots, zoomMode))
          .join("")}
      `
    )
    .join("");

  dom.chargePlanBoard.innerHTML = `
    <div class="charge-plan-helper">
      <div class="charge-plan-helper-copy">
        <span>
          Glissez sur une ligne pour creer un segment en demi-journees.
          Tirez les poignees d'un trait pour le redimensionner.
          Clic droit sur un trait pour afficher les actions.
        </span>
        <span class="charge-plan-feedback" hidden></span>
      </div>
      <div class="charge-plan-view-controls">
        <span class="charge-plan-view-label">Vue</span>
        <div class="charge-plan-zoom-buttons" role="group" aria-label="Zoom planning">
          ${zoomButtons}
        </div>
      </div>
    </div>
    <div class="charge-plan-scroll">
      <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px">
        <div class="charge-plan-row charge-plan-row--header">
          <div class="charge-plan-cell charge-plan-cell--name">Nom</div>
          <div class="charge-plan-cell charge-plan-cell--actions">Actions</div>
          <div class="charge-plan-cell charge-plan-cell--total">Total jours</div>
          <div class="charge-plan-cell charge-plan-cell--timeline">
            <div class="charge-plan-header-track" data-charge-plan-pan-zone="1">
              ${displayedMonths.map((month) => renderHeaderMonth(month, zoomMode)).join("")}
            </div>
          </div>
        </div>
        ${rows}
        ${renderTotalRow(project, displayedMonths, zoomMode)}
      </div>
    </div>
    <div class="charge-plan-context-menu" hidden>
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

export function clearChargePlanTimeline(dom) {
  dom.chargePlanBoard.innerHTML = "";
}

function getTrackSlots(trackEl) {
  return Array.from(trackEl.querySelectorAll(".charge-plan-slot"));
}

function buildSelectionFromSlots(firstSlot, lastSlot) {
  if (!firstSlot || !lastSlot) return null;

  const firstIndex = Number(firstSlot.dataset.slotIndex);
  const lastIndex = Number(lastSlot.dataset.slotIndex);
  const selectedSlots = [];
  let currentSlot = firstSlot;
  while (currentSlot) {
    selectedSlots.push(currentSlot);
    if (currentSlot === lastSlot) break;
    currentSlot = currentSlot.nextElementSibling;
  }

  const workingSlots = selectedSlots.filter(
    (slotEl) => slotEl.dataset.isWorking === "1"
  );
  const startPx = firstSlot.offsetLeft;
  const endPx = lastSlot.offsetLeft + lastSlot.offsetWidth;
  const firstWorkingSlot = workingSlots[0] || null;
  const lastWorkingSlot = workingSlots[workingSlots.length - 1] || null;

  return {
    startSlotIndex: firstIndex,
    endSlotIndex: lastIndex,
    startPx,
    endPx,
    widthPx: Math.max(endPx - startPx, firstSlot.offsetWidth),
    totalDays: workingSlots.length / 2,
    startDate: firstWorkingSlot?.dataset.slotStart || "",
    endDate: lastWorkingSlot?.dataset.slotEnd || "",
  };
}

function getSlotIndexFromClientX(trackEl, clientX) {
  const slotEls = getTrackSlots(trackEl);
  if (!slotEls.length) return -1;

  const trackRect = trackEl.getBoundingClientRect();
  const x = clamp(clientX - trackRect.left, 0, trackRect.width - 1);

  for (const slotEl of slotEls) {
    const startX = slotEl.offsetLeft;
    const endX = slotEl.offsetLeft + slotEl.offsetWidth;
    if (x >= startX && x < endX) {
      return Number(slotEl.dataset.slotIndex);
    }
  }

  return Number(slotEls[slotEls.length - 1].dataset.slotIndex);
}

export function computeChargePlanSelectionFromSlotIndexes(
  trackEl,
  startSlotIndex,
  endSlotIndex
) {
  const slotEls = getTrackSlots(trackEl);
  if (!slotEls.length) return null;

  const firstIndex = Math.min(startSlotIndex, endSlotIndex);
  const lastIndex = Math.max(startSlotIndex, endSlotIndex);
  const firstSlot = slotEls[firstIndex];
  const lastSlot = slotEls[lastIndex];

  return buildSelectionFromSlots(firstSlot, lastSlot);
}

export function getChargePlanSlotIndexAtClientX(trackEl, clientX) {
  return getSlotIndexFromClientX(trackEl, clientX);
}

export function computeChargePlanSelection(trackEl, startClientX, endClientX) {
  const slotEls = getTrackSlots(trackEl);
  if (!slotEls.length) return null;

  const startIndex = getSlotIndexFromClientX(trackEl, startClientX);
  const endIndex = getSlotIndexFromClientX(trackEl, endClientX);
  if (startIndex < 0 || endIndex < 0) return null;

  const firstIndex = Math.min(startIndex, endIndex);
  const lastIndex = Math.max(startIndex, endIndex);
  const firstSlot = slotEls[firstIndex];
  const lastSlot = slotEls[lastIndex];
  return buildSelectionFromSlots(firstSlot, lastSlot);
}

export function updateChargePlanSelectionPreview(trackEl, selection) {
  const previewEl = trackEl.querySelector(".charge-plan-selection-preview");
  const labelEl = previewEl?.querySelector(".charge-plan-selection-label");
  if (!previewEl || !labelEl || !selection) return;

  previewEl.hidden = false;
  previewEl.classList.toggle("is-invalid", Boolean(selection.hasOverlap));
  previewEl.style.left = `${selection.startPx}px`;
  previewEl.style.width = `${Math.max(selection.widthPx, 8)}px`;
  labelEl.textContent = selection.hasOverlap
    ? "Chevauchement interdit"
    : `${formatDayValue(selection.totalDays)} j`;
}

export function clearChargePlanSelectionPreview(trackEl) {
  const previewEl = trackEl.querySelector(".charge-plan-selection-preview");
  if (!previewEl) return;
  previewEl.hidden = true;
  previewEl.classList.remove("is-invalid");
  previewEl.style.left = "0px";
  previewEl.style.width = "0px";
}

export function setChargePlanFeedback(boardEl, message = "") {
  const feedbackEl = boardEl?.querySelector(".charge-plan-feedback");
  if (!feedbackEl) return;

  feedbackEl.textContent = String(message || "").trim();
  feedbackEl.hidden = !feedbackEl.textContent;
}

export function hideChargePlanContextMenu(boardEl) {
  const menuEl = boardEl?.querySelector(".charge-plan-context-menu");
  if (!menuEl) return;

  menuEl.hidden = true;
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  delete menuEl.dataset.segmentId;
}

export function showChargePlanContextMenu(boardEl, { clientX, clientY, segmentId }) {
  const menuEl = boardEl?.querySelector(".charge-plan-context-menu");
  if (!menuEl) return;

  menuEl.hidden = false;
  menuEl.dataset.segmentId = String(segmentId);
  menuEl.style.left = `${clientX}px`;
  menuEl.style.top = `${clientY}px`;

  const margin = 8;
  const menuRect = menuEl.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);

  menuEl.style.left = `${Math.min(clientX, maxLeft)}px`;
  menuEl.style.top = `${Math.min(clientY, maxTop)}px`;
}
