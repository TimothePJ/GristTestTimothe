import { APP_CONFIG } from "../config.js";
import {
  calculateProvisionalSpending,
  calculateRealSpending,
  getProjectProvisionalMonthBounds,
  getProjectRealMonthBounds,
  getWorkerTotalDays,
  groupWorkersByRole,
} from "../services/projectService.js";
import {
  buildMonthRangeBetween,
  formatNumber,
  getBusinessDayDates,
  getMonthEndDate,
  getMonthStartDate,
  toFiniteNumber,
  toMonthKey,
} from "../utils/format.js";
import { destroyChart, renderGroupedExpenseChart } from "./chart.js";

const expenseCharts = new WeakMap();
const expenseGraphScrollPositions = new Map();
const expenseGraphHiddenSeriesByKey = new Map();
const expenseGraphDisplayModes = new Map([
  ["provisional", "currency"],
  ["real", "currency"],
]);
let teamManagementSummaryMode = "provisional";
let teamManagementSummaryGroupedByRole = false;
let teamManagementSummaryDisplayMode = "currency";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getFallbackMonthBounds() {
  const now = new Date();
  const monthKey = toMonthKey(now.getFullYear(), now.getMonth() + 1);
  return {
    startMonthKey: monthKey,
    endMonthKey: monthKey,
  };
}

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function parseDateValue(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getDayEnd(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonths(date, months) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function addYears(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() + years);
  return nextDate;
}

function getWeekStart(date) {
  const start = getDayStart(date);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  return start;
}

function getMonthLabel(monthIndex, year) {
  return `${APP_CONFIG.months[monthIndex] || ""} ${year}`.trim();
}

function getWeekLabel(startDate, endDate) {
  return `Sem. ${startDate.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  })} - ${endDate.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  })}`;
}

function createPeriod({ mode, startDate, endDate, rangeStart, rangeEnd }) {
  const clippedStart = new Date(Math.max(getDayStart(startDate).getTime(), getDayStart(rangeStart).getTime()));
  const clippedEnd = new Date(Math.min(getDayEnd(endDate).getTime(), getDayEnd(rangeEnd).getTime()));

  if (clippedStart > clippedEnd) {
    return null;
  }

  if (mode === "week") {
    return {
      periodMode: mode,
      periodKey: `week:${toDateInputValue(startDate)}`,
      label: getWeekLabel(startDate, endDate),
      startDate: clippedStart,
      endDate: clippedEnd,
    };
  }

  if (mode === "year") {
    const year = startDate.getFullYear();
    return {
      periodMode: mode,
      periodKey: `year:${year}`,
      label: String(year),
      startDate: clippedStart,
      endDate: clippedEnd,
    };
  }

  const monthKey = toMonthKey(startDate.getFullYear(), startDate.getMonth() + 1);
  return {
    periodMode: "month",
    periodKey: `month:${monthKey}`,
    monthKey,
    label: getMonthLabel(startDate.getMonth(), startDate.getFullYear()),
    monthLabel: APP_CONFIG.months[startDate.getMonth()] || "",
    year: startDate.getFullYear(),
    startDate: clippedStart,
    endDate: clippedEnd,
  };
}

function buildTimelinePeriods(view = {}) {
  const mode = ["week", "month", "year"].includes(view.mode) ? view.mode : "month";
  const rangeStart = parseDateValue(view.rangeStartDate);
  const rangeEnd = parseDateValue(view.rangeEndDate);
  const anchor = parseDateValue(view.startDate);
  const periodCount = Math.max(1, Math.trunc(toFiniteNumber(view.periodCount, 1)));

  if (!rangeStart || !rangeEnd || !anchor) {
    return [];
  }

  const periods = [];
  let cursor;

  if (mode === "week") {
    cursor = getWeekStart(anchor);
  } else if (mode === "year") {
    cursor = new Date(anchor.getFullYear(), 0, 1, 12, 0, 0, 0);
  } else {
    cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0, 0);
  }

  for (let index = 0; index < periodCount; index += 1) {
    let periodStart = cursor;
    let periodEnd;

    if (mode === "week") {
      periodEnd = addDays(periodStart, 6);
      cursor = addDays(cursor, 7);
    } else if (mode === "year") {
      periodEnd = new Date(periodStart.getFullYear(), 11, 31, 12, 0, 0, 0);
      cursor = addYears(cursor, 1);
    } else {
      periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 12, 0, 0, 0);
      cursor = addMonths(cursor, 1);
    }

    const period = createPeriod({
      mode,
      startDate: periodStart,
      endDate: periodEnd,
      rangeStart,
      rangeEnd,
    });

    if (period) {
      periods.push(period);
    }
  }

  return periods;
}

function shiftMonthKey(monthKey, deltaMonths) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const cursor = new Date(year, monthNumber - 1, 1, 12, 0, 0, 0);
  if (Number.isNaN(cursor.getTime())) {
    return "";
  }

  cursor.setMonth(cursor.getMonth() + deltaMonths);
  return toMonthKey(cursor.getFullYear(), cursor.getMonth() + 1);
}

function getExpenseChart(boardEl) {
  return boardEl instanceof HTMLElement ? expenseCharts.get(boardEl) || null : null;
}

function setExpenseChart(boardEl, chart) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  if (!chart) {
    expenseCharts.delete(boardEl);
    return;
  }

  expenseCharts.set(boardEl, chart);
}

function normalizeExpenseGraphDisplayMode(mode) {
  return mode === "days" ? "days" : "currency";
}

export function getExpenseGraphDisplayMode(graphKind = "provisional") {
  return normalizeExpenseGraphDisplayMode(expenseGraphDisplayModes.get(graphKind));
}

export function setExpenseGraphDisplayMode(graphKind = "provisional", mode = "currency") {
  expenseGraphDisplayModes.set(graphKind, normalizeExpenseGraphDisplayMode(mode));
}

export function getTeamManagementSummaryMode() {
  return teamManagementSummaryMode === "real" ? "real" : "provisional";
}

export function setTeamManagementSummaryMode(mode = "provisional") {
  teamManagementSummaryMode = mode === "real" ? "real" : "provisional";
}

export function getTeamManagementSummaryGroupedByRole() {
  return Boolean(teamManagementSummaryGroupedByRole);
}

export function setTeamManagementSummaryGroupedByRole(value) {
  teamManagementSummaryGroupedByRole = Boolean(value);
}

export function getTeamManagementSummaryDisplayMode() {
  return teamManagementSummaryDisplayMode === "days" ? "days" : "currency";
}

export function setTeamManagementSummaryDisplayMode(mode = "currency") {
  teamManagementSummaryDisplayMode = mode === "days" ? "days" : "currency";
}

function buildExpenseMonths(project, monthBoundsGetter) {
  if (project?.globalExpenseTimelineView) {
    return buildTimelinePeriods(project.globalExpenseTimelineView);
  }

  const monthBounds = project?.globalExpenseMonthBounds || monthBoundsGetter(project) || getFallbackMonthBounds();
  const baseMonths = buildMonthRangeBetween(
    monthBounds.startMonthKey,
    monthBounds.endMonthKey,
    APP_CONFIG.months
  );

  if (monthBounds.exact) {
    return baseMonths;
  }

  if (baseMonths.length >= 6) {
    return baseMonths;
  }

  const expandedEndMonthKey = shiftMonthKey(
    monthBounds.startMonthKey,
    Math.max(5, baseMonths.length - 1)
  );

  return buildMonthRangeBetween(
    monthBounds.startMonthKey,
    expandedEndMonthKey,
    APP_CONFIG.months
  );
}

function getCostFieldForDaysField(daysField = "provisionalDays") {
  return daysField === "workedDays" ? "workedCosts" : "provisionalCosts";
}

function getWorkerSingleMonthCost(worker, monthKey, daysField = "provisionalDays") {
  const costsByMonth = worker?.[getCostFieldForDaysField(daysField)];
  if (
    costsByMonth &&
    typeof costsByMonth === "object" &&
    Object.prototype.hasOwnProperty.call(costsByMonth, monthKey)
  ) {
    return toFiniteNumber(costsByMonth?.[monthKey], 0);
  }

  return (
    toFiniteNumber(worker?.[daysField]?.[monthKey], 0) *
    toFiniteNumber(worker?.dailyRate, 0)
  );
}

function getWorkerTotalCost(worker, daysField = "provisionalDays") {
  const costField = getCostFieldForDaysField(daysField);
  const monthKeys = new Set([
    ...Object.keys(worker?.[daysField] || {}),
    ...Object.keys(worker?.[costField] || {}),
  ]);

  return [...monthKeys].reduce((sum, monthKey) => {
    return sum + getWorkerSingleMonthCost(worker, monthKey, daysField);
  }, 0);
}

function getMonthBusinessDayRatio(monthKey, period) {
  if (!period?.startDate || !period?.endDate) {
    return 0;
  }

  const businessDays = getBusinessDayDates(monthKey);
  if (!businessDays.length) {
    return 0;
  }

  const periodStart = getDayStart(period.startDate);
  const periodEnd = getDayEnd(period.endDate);
  const overlappingDays = businessDays.filter((date) => (
    getDayStart(date) <= periodEnd && getDayEnd(date) >= periodStart
  )).length;

  return overlappingDays / businessDays.length;
}

function getWorkerPeriodDays(worker, period, daysField = "provisionalDays") {
  const daysByMonth = worker?.[daysField] || {};

  if (!period?.periodMode || period.periodMode === "month") {
    const monthDays = toFiniteNumber(daysByMonth?.[period.monthKey], 0);
    const monthStart = getMonthStartDate(period.monthKey);
    const monthEnd = getMonthEndDate(period.monthKey);

    if (
      !monthStart ||
      !monthEnd ||
      !period?.startDate ||
      !period?.endDate ||
      (getDayStart(period.startDate) <= getDayStart(monthStart) &&
        getDayEnd(period.endDate) >= getDayEnd(monthEnd))
    ) {
      return monthDays;
    }

    return monthDays * getMonthBusinessDayRatio(period.monthKey, period);
  }

  return Object.entries(daysByMonth).reduce((sum, [monthKey, days]) => {
    const monthStart = getMonthStartDate(monthKey);
    const monthEnd = getMonthEndDate(monthKey);
    if (!monthStart || !monthEnd) {
      return sum;
    }

    if (getDayStart(monthStart) > getDayEnd(period.endDate) || getDayEnd(monthEnd) < getDayStart(period.startDate)) {
      return sum;
    }

    return sum + toFiniteNumber(days, 0) * getMonthBusinessDayRatio(monthKey, period);
  }, 0);
}

function getWorkerPeriodCost(worker, period, daysField = "provisionalDays") {
  const costField = getCostFieldForDaysField(daysField);

  if (typeof period === "string") {
    return getWorkerSingleMonthCost(worker, period, daysField);
  }

  if (!period?.periodMode || period.periodMode === "month") {
    const monthCost = getWorkerSingleMonthCost(worker, period.monthKey, daysField);
    const monthStart = getMonthStartDate(period.monthKey);
    const monthEnd = getMonthEndDate(period.monthKey);

    if (
      !monthStart ||
      !monthEnd ||
      !period?.startDate ||
      !period?.endDate ||
      (getDayStart(period.startDate) <= getDayStart(monthStart) &&
        getDayEnd(period.endDate) >= getDayEnd(monthEnd))
    ) {
      return monthCost;
    }

    return monthCost * getMonthBusinessDayRatio(period.monthKey, period);
  }

  const monthKeys = new Set([
    ...Object.keys(worker?.[daysField] || {}),
    ...Object.keys(worker?.[costField] || {}),
  ]);

  return [...monthKeys].reduce((sum, monthKey) => {
    const monthStart = getMonthStartDate(monthKey);
    const monthEnd = getMonthEndDate(monthKey);
    if (!monthStart || !monthEnd) {
      return sum;
    }

    if (getDayStart(monthStart) > getDayEnd(period.endDate) || getDayEnd(monthEnd) < getDayStart(period.startDate)) {
      return sum;
    }

    return sum + getWorkerSingleMonthCost(worker, monthKey, daysField) * getMonthBusinessDayRatio(monthKey, period);
  }, 0);
}

function getWorkerMonthlyValue(
  worker,
  period,
  daysField = "provisionalDays",
  displayMode = "currency"
) {
  const days = typeof period === "string"
    ? toFiniteNumber(worker?.[daysField]?.[period], 0)
    : getWorkerPeriodDays(worker, period, daysField);

  if (displayMode === "days") {
    return days;
  }

  return getWorkerPeriodCost(worker, period, daysField);
}

function getTotalCost(project, daysField = "provisionalDays", displayMode = "currency") {
  return (project?.workers || []).reduce((sum, worker) => {
    if (displayMode === "days") {
      return sum + getWorkerTotalDays(worker[daysField]);
    }

    return sum + getWorkerTotalCost(worker, daysField);
  }, 0);
}

function getMonthLabels(months) {
  return months.map((period) => period.label || `${period.monthLabel} ${period.year}`);
}

function hasWorkerPeriodValue(worker, period, daysField = "provisionalDays") {
  return (
    getWorkerPeriodDays(worker, period, daysField) > 0.0001 ||
    getWorkerPeriodCost(worker, period, daysField) > 0.0001
  );
}

function getWorkersWithPeriodValues(project, periods, daysField = "provisionalDays") {
  return (project?.workers || []).filter((worker) => (
    (periods || []).some((period) => hasWorkerPeriodValue(worker, period, daysField))
  ));
}

function getMaxPeriodActiveWorkerCount(project, periods, daysField = "provisionalDays") {
  const maxCount = (periods || []).reduce((maxValue, period) => {
    const activeCount = (project?.workers || []).filter((worker) => (
      hasWorkerPeriodValue(worker, period, daysField)
    )).length;

    return Math.max(maxValue, activeCount);
  }, 0);

  return Math.max(maxCount, 1);
}

function getExpenseScrollKey(project, graphKind = "provisional") {
  const projectId = project?.id ?? project?.projectId ?? "";
  const projectNumber = project?.number ?? project?.projectNumber ?? "";
  const view = project?.globalExpenseTimelineView || {};
  return [
    String(projectId || projectNumber || "default"),
    graphKind,
    view.mode || "",
    view.startDate || "",
    view.rangeStartDate || "",
    view.rangeEndDate || "",
  ].join("::");
}

function getExpenseVisibilityKey(project, graphKind = "provisional") {
  const projectId = project?.id ?? project?.projectId ?? "";
  const projectNumber = project?.number ?? project?.projectNumber ?? "";
  const sourceProjectIds = Array.isArray(project?.globalSourceProjectIds)
    ? project.globalSourceProjectIds.join("|")
    : "";

  return [
    String(projectId || projectNumber || "default"),
    graphKind,
    sourceProjectIds,
  ].join("::");
}

function getHiddenExpenseSeries(project, graphKind = "provisional") {
  const visibilityKey = getExpenseVisibilityKey(project, graphKind);
  if (!expenseGraphHiddenSeriesByKey.has(visibilityKey)) {
    expenseGraphHiddenSeriesByKey.set(visibilityKey, new Set());
  }

  return expenseGraphHiddenSeriesByKey.get(visibilityKey);
}

function getWorkerSeriesKey(worker, index) {
  const collaboratorId = String(worker?.collaboratorId ?? "").trim();
  const name = String(worker?.name ?? "").trim();
  const workerId = String(worker?.id ?? "").trim();

  return [
    collaboratorId ? `collaborator:${collaboratorId}` : "",
    name ? `name:${name}` : "",
    workerId ? `worker:${workerId}` : "",
    `index:${index}`,
  ].filter(Boolean)[0];
}

function getExpenseGraphMetrics(boardEl, project, months, daysField = "provisionalDays") {
  const workerCount = getMaxPeriodActiveWorkerCount(project, months, daysField);
  const config = APP_CONFIG.expenseTimeline || {};
  const isGlobalTimeline = Boolean(project?.globalExpenseTimelineView);
  const hostWidth = Math.max(
    config.minGraphViewportWidth || 720,
    boardEl?.clientWidth || 0,
    boardEl?.getBoundingClientRect?.().width || 0
  );
  const periodCount = Math.max(months.length, 1);
  const visiblePeriodTarget = isGlobalTimeline
    ? periodCount
    : Math.max(1, config.minVisibleMonths || 6);
  const minPeriodWidth = isGlobalTimeline
    ? config.globalMinMonthWidth || 84
    : config.minMonthWidth || 118;
  const workerSlotWidth = isGlobalTimeline
    ? config.globalWorkerSlotWidth || 10
    : config.workerSlotWidth || 18;
  const periodPadding = isGlobalTimeline
    ? config.globalMonthPadding || 24
    : config.monthPadding || 54;
  const viewportDrivenPeriodWidth = hostWidth / visiblePeriodTarget;
  const workerDrivenPeriodWidth = Math.max(
    minPeriodWidth,
    workerCount * workerSlotWidth + periodPadding
  );
  const overflowPeriodWidth = Math.max(viewportDrivenPeriodWidth, workerDrivenPeriodWidth);
  const viewportGraphWidth =
    periodCount <= visiblePeriodTarget
      ? hostWidth
      : Math.max(hostWidth, periodCount * overflowPeriodWidth);
  const graphWidth = Math.max(
    hostWidth,
    periodCount * workerDrivenPeriodWidth,
    viewportGraphWidth
  );

  return {
    graphWidth,
    isScrollable: graphWidth > hostWidth + 1,
  };
}

function getSeriesColor(index, totalSeriesCount, alpha = 1) {
  const safeTotal = Math.max(1, Number(totalSeriesCount) || 1);
  const hue = Math.round((index * 360) / safeTotal);
  const saturation = 72;
  const lightness = 46;

  if (alpha >= 1) {
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  return `hsla(${hue} ${saturation}% ${lightness}% / ${alpha})`;
}

function formatSignedNumber(value) {
  const numericValue = toFiniteNumber(value, 0);
  const prefix = numericValue > 0 ? "+" : "";
  return `${prefix}${formatNumber(numericValue)}`;
}

function buildExpenseChartDatasets(
  project,
  months,
  daysField = "provisionalDays",
  displayMode = "currency",
  hiddenSeries = new Set()
) {
  const workers = getWorkersWithPeriodValues(project, months, daysField);
  const totalSeriesCount = workers.length;
  const activeSeriesCount = getMaxPeriodActiveWorkerCount(project, months, daysField);
  const barThickness = Math.max(5, Math.min(12, Math.floor(150 / activeSeriesCount)));

  return workers.map((worker, index) => {
    const color = getSeriesColor(index, totalSeriesCount);
    const seriesKey = getWorkerSeriesKey(worker, index);

    return {
      type: "bar",
      label: worker.name,
      expenseSeriesKey: seriesKey,
      hidden: hiddenSeries.has(seriesKey),
      data: months.map((period) => (
        hasWorkerPeriodValue(worker, period, daysField)
          ? getWorkerMonthlyValue(worker, period, daysField, displayMode)
          : null
      )),
      backgroundColor: getSeriesColor(index, totalSeriesCount, 0.55),
      borderColor: color,
      borderWidth: barThickness <= 6 ? 1 : 2,
      borderRadius: 4,
      grouped: true,
      minBarLength: 2,
      skipNull: true,
      barThickness,
      maxBarThickness: barThickness,
      barPercentage: 0.96,
      categoryPercentage: 0.96,
    };
  });
}

function renderExpenseGraphLegend(datasets) {
  const items = (datasets || []).filter((dataset) => dataset?.label);
  if (!items.length) {
    return "";
  }

  const allVisible = items.every((dataset) => !dataset.hidden);
  const allHidden = items.every((dataset) => dataset.hidden);

  return `
    <div class="expense-graph-legend" aria-label="Legende des personnes">
      <div class="expense-graph-legend-head">
        <span class="expense-graph-legend-title">Personnes</span>
        <div class="expense-graph-legend-actions" aria-label="Actions de la legende">
          <button
            type="button"
            class="expense-graph-legend-action"
            data-legend-action="show"
            ${allVisible ? "disabled" : ""}
          >
            Tout afficher
          </button>
          <button
            type="button"
            class="expense-graph-legend-action"
            data-legend-action="hide"
            ${allHidden ? "disabled" : ""}
          >
            Tout masquer
          </button>
        </div>
      </div>
      <div class="expense-graph-legend-list">
        ${items
          .map((dataset, index) => `
            <button
              type="button"
              class="expense-graph-legend-item${dataset.hidden ? " is-hidden" : ""}"
              data-dataset-index="${index}"
              data-series-key="${escapeHtml(dataset.expenseSeriesKey || dataset.label)}"
              aria-pressed="${dataset.hidden ? "false" : "true"}"
              title="Afficher ou masquer ${escapeHtml(dataset.label)}"
            >
              <span
                class="expense-graph-legend-swatch"
                style="background:${escapeHtml(dataset.backgroundColor)}; border-color:${escapeHtml(dataset.borderColor)};"
              ></span>
              <span class="expense-graph-legend-label">${escapeHtml(dataset.label)}</span>
            </button>
          `)
          .join("")}
      </div>
    </div>
  `;
}

function getSuggestedMax(
  project,
  months,
  daysField = "provisionalDays",
  displayMode = "currency",
  datasets = null
) {
  const sourceDatasets = datasets || buildExpenseChartDatasets(
    project,
    months,
    daysField,
    displayMode
  );
  const visibleDatasets = sourceDatasets.filter((dataset) => !dataset?.hidden);
  const maxValue = visibleDatasets.reduce((datasetMax, dataset) => {
    const dataMax = (dataset?.data || []).reduce((valueMax, value) => (
      Math.max(valueMax, toFiniteNumber(value, 0))
    ), 0);

    return Math.max(datasetMax, dataMax);
  }, 0);

  return Math.max(maxValue * 1.12, 1);
}

function renderRateGroup(role, workers) {
  const workerCards = workers
    .map((worker) => {
      const provisionalDays = getWorkerTotalDays(worker.provisionalDays);
      const realDays = getWorkerTotalDays(worker.workedDays);
      const provisionalCost = getWorkerTotalCost(worker, "provisionalDays");
      const realCost = getWorkerTotalCost(worker, "workedDays");
      const differenceDays = provisionalDays - realDays;
      const differenceCost = provisionalCost - realCost;
      const differenceClass =
        differenceCost > 0 || differenceDays > 0
          ? "is-positive"
          : differenceCost < 0 || differenceDays < 0
            ? "is-negative"
            : "is-neutral";

      return `
        <div class="expense-rate-card">
          <div class="expense-rate-card-head">
            <div class="expense-rate-card-head-main">
              <span class="expense-rate-card-name">${escapeHtml(worker.name)}</span>
              <div class="expense-rate-card-totals">
                <span class="expense-rate-card-total">
                  <span class="expense-rate-card-total-label">Previsionnel</span>
                  <strong>${formatNumber(provisionalCost)} €</strong>
                  <em>${formatNumber(provisionalDays)} j</em>
                </span>
                <span class="expense-rate-card-total is-real">
                  <span class="expense-rate-card-total-label">Reel</span>
                  <strong>${formatNumber(realCost)} €</strong>
                  <em>${formatNumber(realDays)} j</em>
                </span>
                <span class="expense-rate-card-total is-delta ${differenceClass}">
                  <span class="expense-rate-card-total-label">Difference</span>
                  <strong>${formatSignedNumber(differenceCost)} €</strong>
                  <em>${formatSignedNumber(differenceDays)} j</em>
                </span>
              </div>
            </div>
            <button
              type="button"
              class="delete-worker-btn expense-rate-card-delete-btn"
              data-worker-id="${worker.id}"
            >
              Supprimer
            </button>
          </div>
          <label class="expense-rate-card-label">
            <span>Depense journaliere</span>
            <input
              type="number"
              class="cell-input daily-rate expense-rate-card-input"
              data-worker-id="${worker.id}"
              step="0.1"
              value="${escapeHtml(worker.dailyRate || "")}"
            >
          </label>
        </div>
      `;
    })
    .join("");

  return `
    <section class="expense-rate-group">
      <div class="expense-rate-group-title">${escapeHtml(role)}</div>
      <div class="expense-rate-group-list">${workerCards}</div>
    </section>
  `;
}

function renderRateControls(project) {
  const groupedWorkers = groupWorkersByRole(project?.workers || []);

  return Object.entries(groupedWorkers)
    .map(([role, workers]) => renderRateGroup(role, workers))
    .join("");
}

function buildTeamManagementSummaryEntries(project, mode = "provisional") {
  const daysField = mode === "real" ? "workedDays" : "provisionalDays";
  const workers = project?.workers || [];

  return workers
    .map((worker, index) => {
      const days = getWorkerTotalDays(worker?.[daysField]);
      const value = getWorkerTotalCost(worker, daysField);

      return {
        id: worker.id,
        name: worker.name,
        days,
        value,
        color: getSeriesColor(index, Math.max(workers.length, 1), 0.9),
      };
    })
    .filter((entry) => entry.value > 0 || entry.days > 0);
}

function buildTeamManagementSummaryRoleEntries(project, mode = "provisional") {
  const daysField = mode === "real" ? "workedDays" : "provisionalDays";
  const groupedWorkers = groupWorkersByRole(project?.workers || []);
  const roles = Object.entries(groupedWorkers);

  return roles
    .map(([role, workers], index) => {
      const days = (workers || []).reduce((sum, worker) => {
        return sum + getWorkerTotalDays(worker?.[daysField]);
      }, 0);
      const value = (workers || []).reduce((sum, worker) => {
        return sum + getWorkerTotalCost(worker, daysField);
      }, 0);

      return {
        id: `role-${role}`,
        name: role,
        days,
        value,
        color: getSeriesColor(index, Math.max(roles.length, 1), 0.9),
      };
    })
    .filter((entry) => entry.value > 0 || entry.days > 0);
}

function renderTeamManagementSummary(project) {
  const mode = getTeamManagementSummaryMode();
  const groupedByRole = getTeamManagementSummaryGroupedByRole();
  const displayMode = getTeamManagementSummaryDisplayMode();
  const rawEntries = groupedByRole
    ? buildTeamManagementSummaryRoleEntries(project, mode)
    : buildTeamManagementSummaryEntries(project, mode);
  const entries = [...rawEntries].sort((left, right) => {
    const leftMetric = displayMode === "days" ? left.days : left.value;
    const rightMetric = displayMode === "days" ? right.days : right.value;
    return rightMetric - leftMetric;
  });
  const totalMetric = entries.reduce((sum, entry) => {
    return sum + (displayMode === "days" ? entry.days : entry.value);
  }, 0);
  const modeChecked = mode === "real" ? "checked" : "";
  const groupChecked = groupedByRole ? "checked" : "";
  const displayChecked = displayMode === "days" ? "checked" : "";
  const modeLabel = mode === "real" ? "Reel" : "Previsionnel";
  const groupingLabel = groupedByRole ? "Par role" : "Par personne";
  const valueSuffix = displayMode === "days" ? "j" : "\u20ac";

  return `
    <section class="team-summary-panel">
      <div class="team-summary-toolbar">
        <div class="team-summary-copy">
          <strong class="team-summary-title">Synthese equipe</strong>
          <span class="team-summary-subtitle">${modeLabel} - ${groupingLabel} - ${formatNumber(totalMetric)} ${valueSuffix}</span>
        </div>
        <div class="team-summary-toggle-group">
          <label class="team-summary-toggle">
            <input
              type="checkbox"
              class="team-summary-mode-toggle-input"
              ${modeChecked}
            >
            <span class="team-summary-toggle-label">Afficher en reel</span>
          </label>
          <label class="team-summary-toggle">
            <input
              type="checkbox"
              class="team-summary-group-toggle-input"
              ${groupChecked}
            >
            <span class="team-summary-toggle-label">Regrouper par role</span>
          </label>
          <label class="team-summary-toggle">
            <input
              type="checkbox"
              class="team-summary-display-toggle-input"
              ${displayChecked}
            >
            <span class="team-summary-toggle-label">Afficher en jours</span>
          </label>
        </div>
      </div>
      ${
        entries.length
          ? `
      <div class="team-summary-layout">
        <div class="team-summary-bar">
          ${entries
            .map((entry) => {
              const metricValue = displayMode === "days" ? entry.days : entry.value;
              const share = totalMetric > 0 ? (metricValue / totalMetric) * 100 : 0;
              const showInlineLabel = share >= 10;
              const segmentTitle = `${entry.name} : ${formatNumber(metricValue)} ${valueSuffix}`;

              return `
                <div
                  class="team-summary-segment"
                  style="flex:${Math.max(metricValue, 1)} 1 0; background:${entry.color};"
                  title="${escapeHtml(segmentTitle)}"
                >
                  ${
                    showInlineLabel
                      ? `<span class="team-summary-segment-label">${formatNumber(metricValue)} ${valueSuffix}</span>`
                      : ""
                  }
                </div>
              `;
            })
            .join("")}
        </div>
        <div class="team-summary-legend">
          ${entries
            .map(
              (entry) => `
                <div class="team-summary-legend-item">
                  <span class="team-summary-legend-swatch" style="background:${entry.color};"></span>
                  <span class="team-summary-legend-name">${escapeHtml(entry.name)}</span>
                  <strong class="team-summary-legend-value">${formatNumber(
                    displayMode === "days" ? entry.days : entry.value
                  )} ${valueSuffix}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
      `
          : `
      <div class="team-summary-empty-state">
        Aucune donnee ${mode === "real" ? "reelle" : "previsionnelle"} a afficher pour le moment.
      </div>
      `
      }
    </section>
  `;
}

export function renderExpenseRateControls(boardEl, project) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = `
    ${renderRateControls(project)}
    ${renderTeamManagementSummary(project)}
  `;
}

export function clearExpenseRateControls(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}

function renderExpenseSummary(project, summaryKind = "provisional") {
  const isRealSummary = summaryKind === "real";
  const summaryLabel = isRealSummary ? "Total reel" : "Total previsionnel";
  const daysField = isRealSummary ? "workedDays" : "provisionalDays";
  const displayMode = getExpenseGraphDisplayMode(isRealSummary ? "real" : "provisional");
  const summaryValue = getTotalCost(project, daysField, displayMode);
  const summarySuffix = displayMode === "days" ? "j" : "€";

  return `
    <div class="expense-graph-summary">
      <div class="expense-graph-summary-item">
        <span class="expense-graph-summary-label">${summaryLabel}</span>
        <strong>${formatNumber(summaryValue)} ${summarySuffix}</strong>
      </div>
    </div>
  `;
}

function renderExpenseGraphControls(graphKind, displayMode) {
  const checked = displayMode === "days" ? "checked" : "";
  const inputId = `expense-graph-unit-toggle-${graphKind}`;

  return `
    <label class="expense-graph-unit-toggle" for="${escapeHtml(inputId)}">
      <input
        id="${escapeHtml(inputId)}"
        type="checkbox"
        class="expense-graph-unit-toggle-input"
        data-graph-kind="${escapeHtml(graphKind)}"
        ${checked}
      >
      <span class="expense-graph-unit-toggle-label">Afficher en jours travailles</span>
    </label>
  `;
}

function restoreExpenseGraphScroll(boardEl, project, graphKind) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const scrollEl = boardEl.querySelector(".expense-graph-scroll");
  if (!(scrollEl instanceof HTMLElement)) {
    return;
  }

  const scrollKey = getExpenseScrollKey(project, graphKind);
  const savedScrollLeft = expenseGraphScrollPositions.get(scrollKey) || 0;

  scrollEl.addEventListener(
    "scroll",
    () => {
      expenseGraphScrollPositions.set(scrollKey, scrollEl.scrollLeft);
    },
    { passive: true }
  );

  requestAnimationFrame(() => {
    scrollEl.scrollLeft = savedScrollLeft;
  });
}

function bindExpenseGraphLegend(boardEl, project, graphKind = "provisional") {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const hiddenSeries = getHiddenExpenseSeries(project, graphKind);
  const legendButtons = boardEl.querySelectorAll(".expense-graph-legend-item");
  const actionButtons = boardEl.querySelectorAll(".expense-graph-legend-action");

  function setDatasetVisibility(datasetIndex, visible) {
    const chart = getExpenseChart(boardEl);
    if (!chart) {
      return;
    }

    if (typeof chart.setDatasetVisibility === "function") {
      chart.setDatasetVisibility(datasetIndex, visible);
      return;
    }

    if (typeof chart.getDatasetMeta === "function") {
      chart.getDatasetMeta(datasetIndex).hidden = !visible;
    }
  }

  function syncLegendState() {
    const itemButtons = [...boardEl.querySelectorAll(".expense-graph-legend-item")];
    itemButtons.forEach((button) => {
      const seriesKey = button.dataset.seriesKey;
      const isHidden = Boolean(seriesKey && hiddenSeries.has(seriesKey));

      button.classList.toggle("is-hidden", isHidden);
      button.setAttribute("aria-pressed", isHidden ? "false" : "true");
    });

    const allVisible = itemButtons.length > 0 && itemButtons.every((button) => (
      !hiddenSeries.has(button.dataset.seriesKey)
    ));
    const allHidden = itemButtons.length > 0 && itemButtons.every((button) => (
      hiddenSeries.has(button.dataset.seriesKey)
    ));

    boardEl.querySelectorAll(".expense-graph-legend-action").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }

      if (button.dataset.legendAction === "show") {
        button.disabled = allVisible;
      } else if (button.dataset.legendAction === "hide") {
        button.disabled = allHidden;
      }
    });
  }

  actionButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.addEventListener("click", () => {
      const action = button.dataset.legendAction;
      if (!["show", "hide"].includes(action)) {
        return;
      }

      legendButtons.forEach((legendButton) => {
        if (!(legendButton instanceof HTMLButtonElement)) {
          return;
        }

        const seriesKey = legendButton.dataset.seriesKey;
        const datasetIndex = Number(legendButton.dataset.datasetIndex);
        if (!seriesKey || !Number.isInteger(datasetIndex)) {
          return;
        }

        if (action === "hide") {
          hiddenSeries.add(seriesKey);
          setDatasetVisibility(datasetIndex, false);
        } else {
          hiddenSeries.delete(seriesKey);
          setDatasetVisibility(datasetIndex, true);
        }
      });

      getExpenseChart(boardEl)?.update?.();
      syncLegendState();
    });
  });

  legendButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.addEventListener("click", () => {
      const seriesKey = button.dataset.seriesKey;
      const datasetIndex = Number(button.dataset.datasetIndex);
      if (!seriesKey || !Number.isInteger(datasetIndex)) {
        return;
      }

      const shouldHide = !hiddenSeries.has(seriesKey);
      if (shouldHide) {
        hiddenSeries.add(seriesKey);
      } else {
        hiddenSeries.delete(seriesKey);
      }

      setDatasetVisibility(datasetIndex, !shouldHide);
      getExpenseChart(boardEl)?.update?.();
      syncLegendState();
    });
  });
}

function mountExpenseChart(boardEl, project, months, options = {}) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const canvas = boardEl.querySelector(".expense-graph-canvas");
  if (!canvas) {
    return;
  }

  const currentExpenseChart = getExpenseChart(boardEl);
  const displayMode = getExpenseGraphDisplayMode(options.graphKind);
  const hiddenSeries = getHiddenExpenseSeries(project, options.graphKind);
  const datasets = options.datasets || buildExpenseChartDatasets(
    project,
    months,
    options.daysField,
    displayMode,
    hiddenSeries
  );
  const nextChart = renderGroupedExpenseChart(canvas, currentExpenseChart, {
    labels: getMonthLabels(months),
    datasets,
    suggestedMax: getSuggestedMax(
      project,
      months,
      options.daysField,
      displayMode,
      datasets
    ),
    unit: displayMode === "days" ? "days" : "currency",
  });
  setExpenseChart(boardEl, nextChart);
}

function renderExpenseGraphBoard(boardEl, project, options = {}) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const currentExpenseChart = getExpenseChart(boardEl);
  setExpenseChart(boardEl, destroyChart(currentExpenseChart));

  const months = buildExpenseMonths(project, options.monthBoundsGetter);
  const { graphWidth, isScrollable } = getExpenseGraphMetrics(
    boardEl,
    project,
    months,
    options.daysField
  );
  const showRatePanel = options.showRatePanel !== false;
  const showSummary = options.showSummary !== false;
  const showHelper = options.showHelper !== false;
  const displayMode = getExpenseGraphDisplayMode(options.graphKind);
  const hiddenSeries = getHiddenExpenseSeries(project, options.graphKind);
  const datasets = buildExpenseChartDatasets(
    project,
    months,
    options.daysField,
    displayMode,
    hiddenSeries
  );

  boardEl.innerHTML = `
    <div class="expense-graph-layout${showRatePanel ? "" : " expense-graph-layout--chart-only"}">
      ${
        showRatePanel
          ? `
      <div class="expense-rate-panel">
        ${renderRateControls(project)}
      </div>
      `
          : ""
      }
      <div class="expense-graph-shell${isScrollable ? " is-scrollable" : ""}">
        <div class="expense-graph-toolbar">
          ${showSummary ? renderExpenseSummary(project, options.summaryKind) : ""}
          ${renderExpenseGraphControls(options.graphKind, displayMode)}
        </div>
        ${
          isScrollable && showHelper
            ? '<div class="expense-graph-helper">Faites defiler horizontalement pour parcourir tous les mois.</div>'
            : ""
        }
        <div class="expense-graph-scroll">
          <div class="expense-graph-stage" style="width:${graphWidth}px;">
            <canvas class="expense-graph-canvas"></canvas>
          </div>
        </div>
        ${renderExpenseGraphLegend(datasets)}
      </div>
    </div>
  `;

  mountExpenseChart(boardEl, project, months, {
    ...options,
    datasets,
  });
  bindExpenseGraphLegend(boardEl, project, options.graphKind);
  restoreExpenseGraphScroll(boardEl, project, options.graphKind);
}

export function renderExpenseTimeline(boardEl, project) {
  renderExpenseGraphBoard(boardEl, project, {
    graphKind: "provisional",
    daysField: "provisionalDays",
    monthBoundsGetter: getProjectProvisionalMonthBounds,
    aggregateSpendingCalculator: calculateProvisionalSpending,
    showRatePanel: false,
    showSummary: true,
    summaryKind: "provisional",
    showHelper: true,
  });
}

export function renderRealExpenseTimeline(boardEl, project) {
  renderExpenseGraphBoard(boardEl, project, {
    graphKind: "real",
    daysField: "workedDays",
    monthBoundsGetter: getProjectRealMonthBounds,
    aggregateSpendingCalculator: calculateRealSpending,
    showRatePanel: false,
    showSummary: true,
    summaryKind: "real",
    showHelper: false,
  });
}

export function clearExpenseTimeline(boardEl) {
  const currentExpenseChart = getExpenseChart(boardEl);
  setExpenseChart(boardEl, destroyChart(currentExpenseChart));

  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}
