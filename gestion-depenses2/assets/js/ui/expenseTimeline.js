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
  toFiniteNumber,
  toMonthKey,
} from "../utils/format.js";
import { destroyChart, renderGroupedExpenseChart } from "./chart.js";

const expenseCharts = new WeakMap();
const expenseGraphScrollPositions = new Map();
const expenseGraphDisplayModes = new Map([
  ["provisional", "currency"],
  ["real", "currency"],
]);

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

function buildExpenseMonths(project, monthBoundsGetter) {
  const monthBounds = monthBoundsGetter(project) || getFallbackMonthBounds();
  const baseMonths = buildMonthRangeBetween(
    monthBounds.startMonthKey,
    monthBounds.endMonthKey,
    APP_CONFIG.months
  );

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

function getWorkerMonthlyCost(worker, monthKey, daysField = "provisionalDays") {
  return (
    toFiniteNumber(worker?.[daysField]?.[monthKey], 0) *
    toFiniteNumber(worker?.dailyRate, 0)
  );
}

function getWorkerMonthlyValue(
  worker,
  monthKey,
  daysField = "provisionalDays",
  displayMode = "currency"
) {
  if (displayMode === "days") {
    return toFiniteNumber(worker?.[daysField]?.[monthKey], 0);
  }

  return getWorkerMonthlyCost(worker, monthKey, daysField);
}

function getTotalCost(project, daysField = "provisionalDays", displayMode = "currency") {
  return (project?.workers || []).reduce((sum, worker) => {
    if (displayMode === "days") {
      return sum + getWorkerTotalDays(worker[daysField]);
    }

    return sum + getWorkerTotalDays(worker[daysField]) * toFiniteNumber(worker.dailyRate, 0);
  }, 0);
}

function getMonthLabels(months) {
  return months.map(({ monthLabel, year }) => `${monthLabel} ${year}`);
}

function getExpenseScrollKey(project, graphKind = "provisional") {
  const projectId = project?.id ?? project?.projectId ?? "";
  const projectNumber = project?.number ?? project?.projectNumber ?? "";
  return `${String(projectId || projectNumber || "default")}::${graphKind}`;
}

function getExpenseGraphMetrics(boardEl, project, months) {
  const workerCount = Math.max(project?.workers?.length || 0, 1);
  const config = APP_CONFIG.expenseTimeline || {};
  const hostWidth = Math.max(
    config.minGraphViewportWidth || 720,
    boardEl?.clientWidth || 0,
    boardEl?.getBoundingClientRect?.().width || 0
  );
  const visibleMonthTarget = Math.max(1, config.minVisibleMonths || 6);
  const visibleMonthCount = Math.max(months.length, 1);
  const viewportDrivenMonthWidth = hostWidth / visibleMonthTarget;
  const workerDrivenMonthWidth = Math.max(
    config.minMonthWidth || 118,
    workerCount * (config.workerSlotWidth || 18) + (config.monthPadding || 54)
  );
  const overflowMonthWidth = Math.max(viewportDrivenMonthWidth, workerDrivenMonthWidth);
  const graphWidth =
    visibleMonthCount <= visibleMonthTarget
      ? hostWidth
      : Math.max(hostWidth, visibleMonthCount * overflowMonthWidth);

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
  displayMode = "currency"
) {
  const workers = project?.workers || [];
  const totalSeriesCount = workers.length;

  return workers.map((worker, index) => {
    const color = getSeriesColor(index, totalSeriesCount);

    return {
      type: "bar",
      label: worker.name,
      data: months.map(({ monthKey }) =>
        getWorkerMonthlyValue(worker, monthKey, daysField, displayMode)
      ),
      backgroundColor: getSeriesColor(index, totalSeriesCount, 0.55),
      borderColor: color,
      borderWidth: 2,
      borderRadius: 4,
      grouped: true,
      minBarLength: 2,
      barThickness: 12,
      maxBarThickness: 14,
      barPercentage: 0.92,
      categoryPercentage: 0.92,
    };
  });
}

function getSuggestedMax(
  project,
  months,
  daysField = "provisionalDays",
  aggregateSpendingCalculator = calculateProvisionalSpending,
  displayMode = "currency"
) {
  let maxValue = 0;

  (project?.workers || []).forEach((worker) => {
    months.forEach(({ monthKey }) => {
      maxValue = Math.max(
        maxValue,
        getWorkerMonthlyValue(worker, monthKey, daysField, displayMode)
      );
    });
  });

  months.forEach(({ monthKey }) => {
    if (displayMode === "days") {
      const monthDays = (project?.workers || []).reduce((sum, worker) => {
        return sum + toFiniteNumber(worker?.[daysField]?.[monthKey], 0);
      }, 0);
      maxValue = Math.max(maxValue, monthDays);
      return;
    }

    maxValue = Math.max(maxValue, aggregateSpendingCalculator(project, monthKey));
  });

  return Math.max(maxValue, 1);
}

function renderRateGroup(role, workers) {
  const workerCards = workers
    .map((worker) => {
      const dailyRate = toFiniteNumber(worker.dailyRate, 0);
      const provisionalDays = getWorkerTotalDays(worker.provisionalDays);
      const realDays = getWorkerTotalDays(worker.workedDays);
      const provisionalCost = provisionalDays * dailyRate;
      const realCost = realDays * dailyRate;
      const differenceDays = realDays - provisionalDays;
      const differenceCost = realCost - provisionalCost;
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
                  <strong>${formatNumber(provisionalCost)} EUR</strong>
                  <em>${formatNumber(provisionalDays)} j</em>
                </span>
                <span class="expense-rate-card-total is-real">
                  <span class="expense-rate-card-total-label">Reel</span>
                  <strong>${formatNumber(realCost)} EUR</strong>
                  <em>${formatNumber(realDays)} j</em>
                </span>
                <span class="expense-rate-card-total is-delta ${differenceClass}">
                  <span class="expense-rate-card-total-label">Difference</span>
                  <strong>${formatSignedNumber(differenceCost)} EUR</strong>
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

export function renderExpenseRateControls(boardEl, project) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = renderRateControls(project);
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
  const summarySuffix = displayMode === "days" ? "j" : "EUR";

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
  const nextChart = renderGroupedExpenseChart(canvas, currentExpenseChart, {
    labels: getMonthLabels(months),
    datasets: buildExpenseChartDatasets(project, months, options.daysField, displayMode),
    suggestedMax: getSuggestedMax(
      project,
      months,
      options.daysField,
      options.aggregateSpendingCalculator,
      displayMode
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
  const { graphWidth, isScrollable } = getExpenseGraphMetrics(boardEl, project, months);
  const showRatePanel = options.showRatePanel !== false;
  const showSummary = options.showSummary !== false;
  const showHelper = options.showHelper !== false;
  const displayMode = getExpenseGraphDisplayMode(options.graphKind);

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
      </div>
    </div>
  `;

  mountExpenseChart(boardEl, project, months, options);
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
