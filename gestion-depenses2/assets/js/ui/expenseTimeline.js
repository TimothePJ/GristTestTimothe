import { APP_CONFIG } from "../config.js";
import {
  calculateProvisionalSpending,
  getProjectProvisionalMonthBounds,
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

let currentExpenseChart = null;
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

function buildExpenseMonths(project) {
  const monthBounds = getProjectProvisionalMonthBounds(project) || getFallbackMonthBounds();
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

function getWorkerMonthlyCost(worker, monthKey) {
  return (
    toFiniteNumber(worker?.provisionalDays?.[monthKey], 0) *
    toFiniteNumber(worker?.dailyRate, 0)
  );
}

function getTotalProvisionalCost(project) {
  return (project?.workers || []).reduce((sum, worker) => {
    return sum + getWorkerTotalDays(worker.provisionalDays) * toFiniteNumber(worker.dailyRate, 0);
  }, 0);
}

function getMonthLabels(months) {
  return months.map(({ monthLabel, year }) => `${monthLabel} ${year}`);
}

function getExpenseScrollKey(project) {
  const projectId = project?.id ?? project?.projectId ?? "";
  const projectNumber = project?.number ?? project?.projectNumber ?? "";
  return String(projectId || projectNumber || "default");
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
  const visibleMonthCount = Math.min(Math.max(months.length, 1), visibleMonthTarget);
  const viewportDrivenMonthWidth = hostWidth / visibleMonthCount;
  const workerDrivenMonthWidth = Math.max(
    config.minMonthWidth || 118,
    workerCount * (config.workerSlotWidth || 18) + (config.monthPadding || 54)
  );
  const monthColumnWidth = Math.max(viewportDrivenMonthWidth, workerDrivenMonthWidth);
  const graphWidth = Math.max(hostWidth, months.length * monthColumnWidth);

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

function buildExpenseChartDatasets(project, months) {
  const workers = project?.workers || [];
  const totalSeriesCount = workers.length;

  return workers.map((worker, index) => {
    const color = getSeriesColor(index, totalSeriesCount);

    return {
      type: "bar",
      label: worker.name,
      data: months.map(({ monthKey }) => getWorkerMonthlyCost(worker, monthKey)),
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

function getSuggestedMax(project, months) {
  let maxValue = 0;

  (project?.workers || []).forEach((worker) => {
    months.forEach(({ monthKey }) => {
      maxValue = Math.max(maxValue, getWorkerMonthlyCost(worker, monthKey));
    });
  });

  months.forEach(({ monthKey }) => {
    maxValue = Math.max(maxValue, calculateProvisionalSpending(project, monthKey));
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
        <strong>${formatNumber(getTotalProvisionalCost(project))} EUR</strong>
      </div>
    </div>
  `;
}

function restoreExpenseGraphScroll(boardEl, project) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const scrollEl = boardEl.querySelector(".expense-graph-scroll");
  if (!(scrollEl instanceof HTMLElement)) {
    return;
  }

  const scrollKey = getExpenseScrollKey(project);
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

function mountExpenseChart(boardEl, project, months) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const canvas = boardEl.querySelector(".expense-graph-canvas");
  if (!canvas) {
    return;
  }

  currentExpenseChart = renderGroupedExpenseChart(canvas, currentExpenseChart, {
    labels: getMonthLabels(months),
    datasets: buildExpenseChartDatasets(project, months),
    suggestedMax: getSuggestedMax(project, months),
  });
}

export function renderExpenseTimeline(boardEl, project) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  currentExpenseChart = destroyChart(currentExpenseChart);

  const months = buildExpenseMonths(project);
  const { graphWidth, isScrollable } = getExpenseGraphMetrics(boardEl, project, months);

  boardEl.innerHTML = `
    <div class="expense-graph-layout">
      <div class="expense-rate-panel">
        ${renderRateControls(project)}
      </div>
      <div class="expense-graph-shell${isScrollable ? " is-scrollable" : ""}">
        ${renderExpenseSummary(project, months)}
        ${
          isScrollable
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

  mountExpenseChart(boardEl, project, months);
  restoreExpenseGraphScroll(boardEl, project);
}

export function clearExpenseTimeline(boardEl) {
  currentExpenseChart = destroyChart(currentExpenseChart);

  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}
