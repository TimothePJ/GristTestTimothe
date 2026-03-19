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

function getTotalCost(project, daysField = "provisionalDays") {
  return (project?.workers || []).reduce((sum, worker) => {
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

function buildExpenseChartDatasets(project, months, daysField = "provisionalDays") {
  const workers = project?.workers || [];
  const totalSeriesCount = workers.length;

  return workers.map((worker, index) => {
    const color = getSeriesColor(index, totalSeriesCount);

    return {
      type: "bar",
      label: worker.name,
      data: months.map(({ monthKey }) => getWorkerMonthlyCost(worker, monthKey, daysField)),
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
  aggregateSpendingCalculator = calculateProvisionalSpending
) {
  let maxValue = 0;

  (project?.workers || []).forEach((worker) => {
    months.forEach(({ monthKey }) => {
      maxValue = Math.max(maxValue, getWorkerMonthlyCost(worker, monthKey, daysField));
    });
  });

  months.forEach(({ monthKey }) => {
    maxValue = Math.max(maxValue, aggregateSpendingCalculator(project, monthKey));
  });

  return Math.max(maxValue, 1);
}

function renderRateGroup(role, workers) {
  const workerCards = workers
    .map((worker) => {
      const totalDays = getWorkerTotalDays(worker.provisionalDays);
      const totalCost = totalDays * toFiniteNumber(worker.dailyRate, 0);

      return `
        <div class="expense-rate-card">
          <div class="expense-rate-card-head">
            <span class="expense-rate-card-name">${escapeHtml(worker.name)}</span>
            <span class="expense-rate-card-total">${formatNumber(totalCost)} EUR</span>
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

function renderExpenseSummary(project, months) {
  return `
    <div class="expense-graph-summary">
      <div class="expense-graph-summary-item">
        <span class="expense-graph-summary-label">Mois affiches</span>
        <strong>${months.length}</strong>
      </div>
      <div class="expense-graph-summary-item">
        <span class="expense-graph-summary-label">Total previsionnel</span>
        <strong>${formatNumber(getTotalCost(project, "provisionalDays"))} EUR</strong>
      </div>
    </div>
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
  const nextChart = renderGroupedExpenseChart(canvas, currentExpenseChart, {
    labels: getMonthLabels(months),
    datasets: buildExpenseChartDatasets(project, months, options.daysField),
    suggestedMax: getSuggestedMax(
      project,
      months,
      options.daysField,
      options.aggregateSpendingCalculator
    ),
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
        ${showSummary ? renderExpenseSummary(project, months) : ""}
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
    showRatePanel: true,
    showSummary: true,
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
    showSummary: false,
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
