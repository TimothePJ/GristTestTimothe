import { APP_CONFIG } from "../config.js";
import { getWorkerTotalDays, groupWorkersByRole } from "../services/projectService.js";
import {
  buildDisplayedMonths,
  clamp,
  formatNumber,
  roundToStep,
  toFiniteNumber,
} from "../utils/format.js";

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

function getMonthWidth(month) {
  const widthFromDays =
    month.businessDayCount * APP_CONFIG.chargeTimeline.businessDayWidth;
  return Math.max(APP_CONFIG.chargeTimeline.minimumMonthWidth, widthFromDays);
}

function renderHeaderMonth(month) {
  const monthWidth = getMonthWidth(month);
  const dayWidth =
    month.businessDayCount > 0
      ? monthWidth / month.businessDayCount
      : APP_CONFIG.chargeTimeline.minimumMonthWidth;

  const dayTicks = (month.businessDayDates || [])
    .map((date, index) => {
      const showLabel =
        index === 0 ||
        index === month.businessDayDates.length - 1 ||
        index % 5 === 0;

      return `
        <span class="charge-plan-day-tick" style="width:${dayWidth}px">
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

function renderTrackSegments(months, worker = null, { showTotals = false } = {}) {
  return months
    .map((month) => {
      const monthWidth = getMonthWidth(month);
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
          data-business-days="${month.businessDayCount}"
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
            overflowDays > 0
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

function renderWorkerRow(worker, months) {
  const totalDays = getWorkerTotalDays(worker.provisionalDays);
  const timelineWidth = months.reduce((sum, month) => sum + getMonthWidth(month), 0);

  return `
    <div class="charge-plan-row" style="--timeline-width:${timelineWidth}px">
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
          ${renderTrackSegments(months, worker)}
          <div class="charge-plan-selection-preview" hidden>
            <span class="charge-plan-selection-label"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTotalRow(project, months) {
  const monthsWithTotals = months.map((month) => ({
    ...month,
    totalDays: (project.workers || []).reduce((sum, worker) => {
      return sum + toFiniteNumber(worker.provisionalDays?.[month.monthKey], 0);
    }, 0),
  }));
  const totalDays = monthsWithTotals.reduce((sum, month) => sum + month.totalDays, 0);
  const timelineWidth = months.reduce((sum, month) => sum + getMonthWidth(month), 0);

  return `
    <div class="charge-plan-row charge-plan-row--total" style="--timeline-width:${timelineWidth}px">
      <div class="charge-plan-cell charge-plan-cell--name"><strong>Total</strong></div>
      <div class="charge-plan-cell charge-plan-cell--actions"></div>
      <div class="charge-plan-cell charge-plan-cell--total"><strong>${formatDayValue(
        totalDays
      )} j</strong></div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderTrackSegments(monthsWithTotals, null, { showTotals: true })}
        </div>
      </div>
    </div>
  `;
}

export function renderChargePlanTimeline(dom, project, viewState) {
  const displayedMonths = buildDisplayedMonths(
    viewState.selectedYear,
    viewState.selectedMonth,
    viewState.monthSpan,
    APP_CONFIG.months
  );
  const groupedWorkers = groupWorkersByRole(project.workers);
  const timelineWidth = displayedMonths.reduce(
    (sum, month) => sum + getMonthWidth(month),
    0
  );

  const rows = Object.entries(groupedWorkers)
    .map(
      ([role, workers]) => `
        <div class="charge-plan-role-row" style="--timeline-width:${timelineWidth}px">
          <div class="charge-plan-role-cell">${escapeHtml(role)}</div>
        </div>
        ${workers.map((worker) => renderWorkerRow(worker, displayedMonths)).join("")}
      `
    )
    .join("");

  dom.chargePlanBoard.innerHTML = `
    <div class="charge-plan-helper">
      Glissez sur une ligne pour affecter les jours sur la periode affichee.
      Double-cliquez sur une ligne pour effacer la plage visible de la personne.
    </div>
    <div class="charge-plan-scroll">
      <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px">
        <div class="charge-plan-row charge-plan-row--header">
          <div class="charge-plan-cell charge-plan-cell--name">Nom</div>
          <div class="charge-plan-cell charge-plan-cell--actions">Actions</div>
          <div class="charge-plan-cell charge-plan-cell--total">Total jours</div>
          <div class="charge-plan-cell charge-plan-cell--timeline">
            <div class="charge-plan-header-track">
              ${displayedMonths.map((month) => renderHeaderMonth(month)).join("")}
            </div>
          </div>
        </div>
        ${rows}
        ${renderTotalRow(project, displayedMonths)}
      </div>
    </div>
  `;
}

export function clearChargePlanTimeline(dom) {
  dom.chargePlanBoard.innerHTML = "";
}

function getTrackRectValues(trackEl) {
  const rect = trackEl.getBoundingClientRect();
  return {
    rect,
    trackWidth: rect.width,
  };
}

function getSelectionBounds(trackEl, startClientX, endClientX) {
  const { rect, trackWidth } = getTrackRectValues(trackEl);
  const rawStart = clamp(Math.min(startClientX, endClientX) - rect.left, 0, trackWidth);
  const rawEnd = clamp(Math.max(startClientX, endClientX) - rect.left, 0, trackWidth);

  return {
    startPx: rawStart,
    endPx: rawEnd,
    widthPx: Math.max(0, rawEnd - rawStart),
  };
}

export function computeChargePlanSelection(trackEl, startClientX, endClientX) {
  const bounds = getSelectionBounds(trackEl, startClientX, endClientX);
  const monthSegments = Array.from(
    trackEl.querySelectorAll(".charge-plan-month-segment")
  ).map((segmentEl) => ({
    monthKey: segmentEl.dataset.monthKey || "",
    businessDayCount: Number(segmentEl.dataset.businessDays) || 0,
    leftPx: segmentEl.offsetLeft,
    rightPx: segmentEl.offsetLeft + segmentEl.offsetWidth,
    widthPx: segmentEl.offsetWidth,
  }));

  const updates = monthSegments.map((segment) => {
    const overlapPx =
      Math.max(
        0,
        Math.min(bounds.endPx, segment.rightPx) - Math.max(bounds.startPx, segment.leftPx)
      ) || 0;

    const rawDays =
      overlapPx > 0 && segment.widthPx > 0
        ? (overlapPx / segment.widthPx) * segment.businessDayCount
        : 0;
    const roundedDays = roundToStep(rawDays, APP_CONFIG.chargeTimeline.snapStepDays);

    return {
      monthKey: segment.monthKey,
      provisionalDays: roundedDays,
    };
  });

  return {
    ...bounds,
    totalDays: updates.reduce((sum, update) => sum + update.provisionalDays, 0),
    updates,
  };
}

export function updateChargePlanSelectionPreview(trackEl, selection) {
  const previewEl = trackEl.querySelector(".charge-plan-selection-preview");
  const labelEl = previewEl?.querySelector(".charge-plan-selection-label");
  if (!previewEl || !labelEl || !selection) return;

  previewEl.hidden = false;
  previewEl.style.left = `${selection.startPx}px`;
  previewEl.style.width = `${Math.max(selection.widthPx, 2)}px`;
  labelEl.textContent = `${formatDayValue(selection.totalDays)} j`;
}

export function clearChargePlanSelectionPreview(trackEl) {
  const previewEl = trackEl.querySelector(".charge-plan-selection-preview");
  if (!previewEl) return;
  previewEl.hidden = true;
  previewEl.style.left = "0px";
  previewEl.style.width = "0px";
}

export function getEmptyChargePlanUpdates(trackEl) {
  return Array.from(trackEl.querySelectorAll(".charge-plan-month-segment")).map((segmentEl) => ({
    monthKey: segmentEl.dataset.monthKey || "",
    provisionalDays: 0,
  }));
}
