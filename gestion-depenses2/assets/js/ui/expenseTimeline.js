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

function buildExpenseMonths(project) {
  const monthBounds = getProjectProvisionalMonthBounds(project) || getFallbackMonthBounds();
  return buildMonthRangeBetween(
    monthBounds.startMonthKey,
    monthBounds.endMonthKey,
    APP_CONFIG.months
  );
}

function getWorkerMonthlyCost(worker, monthKey) {
  return (
    toFiniteNumber(worker?.provisionalDays?.[monthKey], 0) *
    toFiniteNumber(worker?.dailyRate, 0)
  );
}

function getGlobalMaxMonthlyCost(project, months) {
  let maxValue = 0;

  (project?.workers || []).forEach((worker) => {
    months.forEach(({ monthKey }) => {
      maxValue = Math.max(maxValue, getWorkerMonthlyCost(worker, monthKey));
    });
  });

  months.forEach(({ monthKey }) => {
    maxValue = Math.max(maxValue, calculateProvisionalSpending(project, monthKey));
  });

  return maxValue;
}

function renderMonthHeader(months) {
  return months
    .map(
      ({ monthLabel, year }) => `
        <div class="expense-plan-header-month">
          <span class="expense-plan-header-month-name">${escapeHtml(monthLabel)}</span>
          <span class="expense-plan-header-month-year">${year}</span>
        </div>
      `
    )
    .join("");
}

function renderMonthlyCostCells(months, getValue, maxMonthlyCost, options = {}) {
  const isTotalRow = Boolean(options.isTotalRow);
  const barClassName = isTotalRow
    ? "expense-plan-month-bar expense-plan-month-bar--total"
    : "expense-plan-month-bar";

  return months
    .map(({ monthKey }) => {
      const value = getValue(monthKey);
      const safeValue = toFiniteNumber(value, 0);
      const heightRatio = maxMonthlyCost > 0 ? safeValue / maxMonthlyCost : 0;
      const heightPercent =
        safeValue > 0 ? Math.max(12, Math.round(heightRatio * 100)) : 0;

      return `
        <div class="expense-plan-month-cell ${safeValue > 0 ? "has-value" : "is-empty"}">
          <span class="expense-plan-month-amount">${
            safeValue > 0 ? `${formatNumber(safeValue)} EUR` : "—"
          }</span>
          <div class="expense-plan-month-bar-shell">
            <div class="${barClassName}" style="height:${heightPercent}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderRoleRow(role, timelineWidth) {
  return `
    <div class="expense-plan-role-row" style="--expense-timeline-width:${timelineWidth}px;">
      <div class="expense-plan-role-cell expense-plan-role-cell--label">${escapeHtml(role)}</div>
      <div class="expense-plan-role-cell expense-plan-role-cell--filler"></div>
    </div>
  `;
}

function renderWorkerRow(worker, months, maxMonthlyCost, timelineWidth) {
  const totalDays = getWorkerTotalDays(worker.provisionalDays);
  const totalCost = totalDays * toFiniteNumber(worker.dailyRate, 0);

  return `
    <div class="expense-plan-row" style="--expense-timeline-width:${timelineWidth}px;">
      <div class="expense-plan-cell expense-plan-cell--name">${escapeHtml(worker.name)}</div>
      <div class="expense-plan-cell expense-plan-cell--rate">
        <input
          type="number"
          class="cell-input daily-rate"
          data-worker-id="${worker.id}"
          step="0.1"
          value="${escapeHtml(worker.dailyRate || "")}"
        >
      </div>
      <div class="expense-plan-cell expense-plan-cell--total">${formatNumber(totalCost)} EUR</div>
      <div class="expense-plan-cell expense-plan-cell--timeline">
        <div class="expense-plan-track">
          ${renderMonthlyCostCells(
            months,
            (monthKey) => getWorkerMonthlyCost(worker, monthKey),
            maxMonthlyCost
          )}
        </div>
      </div>
    </div>
  `;
}

function renderTotalRow(project, months, maxMonthlyCost, timelineWidth) {
  const totalCost = (project?.workers || []).reduce((sum, worker) => {
    return sum + getWorkerTotalDays(worker.provisionalDays) * toFiniteNumber(worker.dailyRate, 0);
  }, 0);

  return `
    <div class="expense-plan-row expense-plan-row--total" style="--expense-timeline-width:${timelineWidth}px;">
      <div class="expense-plan-cell expense-plan-cell--name"><strong>Total</strong></div>
      <div class="expense-plan-cell expense-plan-cell--rate">—</div>
      <div class="expense-plan-cell expense-plan-cell--total"><strong>${formatNumber(
        totalCost
      )} EUR</strong></div>
      <div class="expense-plan-cell expense-plan-cell--timeline">
        <div class="expense-plan-track">
          ${renderMonthlyCostCells(
            months,
            (monthKey) => calculateProvisionalSpending(project, monthKey),
            maxMonthlyCost,
            { isTotalRow: true }
          )}
        </div>
      </div>
    </div>
  `;
}

export function renderExpenseTimeline(boardEl, project) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const months = buildExpenseMonths(project);
  const groupedWorkers = groupWorkersByRole(project?.workers || []);
  const monthWidth = 138;
  const timelineWidth = months.length * monthWidth;
  const maxMonthlyCost = getGlobalMaxMonthlyCost(project, months);

  let html = `
    <div class="expense-plan-scroll">
      <div class="expense-plan-board" style="--expense-month-width:${monthWidth}px; --expense-timeline-width:${timelineWidth}px;">
        <div class="expense-plan-row expense-plan-row--header" style="--expense-timeline-width:${timelineWidth}px;">
          <div class="expense-plan-cell expense-plan-cell--name">Nom</div>
          <div class="expense-plan-cell expense-plan-cell--rate">Depense journaliere</div>
          <div class="expense-plan-cell expense-plan-cell--total">Total depense</div>
          <div class="expense-plan-cell expense-plan-cell--timeline">
            <div class="expense-plan-header-track">
              ${renderMonthHeader(months)}
            </div>
          </div>
        </div>
  `;

  Object.entries(groupedWorkers).forEach(([role, workers]) => {
    html += renderRoleRow(role, timelineWidth);
    workers.forEach((worker) => {
      html += renderWorkerRow(worker, months, maxMonthlyCost, timelineWidth);
    });
  });

  html += renderTotalRow(project, months, maxMonthlyCost, timelineWidth);
  html += `
      </div>
    </div>
  `;

  boardEl.innerHTML = html;
}

export function clearExpenseTimeline(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}
