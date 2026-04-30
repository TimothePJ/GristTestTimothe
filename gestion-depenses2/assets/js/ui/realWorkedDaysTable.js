import {
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
import { APP_CONFIG } from "../config.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDayValue(value) {
  const numericValue = toFiniteNumber(value, 0);
  if (numericValue === 0) {
    return "";
  }

  const formatted = formatNumber(numericValue);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

function shiftMonthKey(monthKey, deltaMonths) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const cursor = new Date(Number(match[1]), Number(match[2]) - 1, 1, 12, 0, 0, 0);
  if (Number.isNaN(cursor.getTime())) {
    return "";
  }

  cursor.setMonth(cursor.getMonth() + deltaMonths);
  return toMonthKey(cursor.getFullYear(), cursor.getMonth() + 1);
}

function buildRealWorkedMonths(project) {
  const bounds = getProjectRealMonthBounds(project);
  if (!bounds?.startMonthKey || !bounds?.endMonthKey) {
    return [];
  }

  const baseMonths = buildMonthRangeBetween(
    bounds.startMonthKey,
    bounds.endMonthKey,
    APP_CONFIG.months
  );

  if (baseMonths.length >= 6) {
    return baseMonths;
  }

  return buildMonthRangeBetween(
    bounds.startMonthKey,
    shiftMonthKey(bounds.startMonthKey, 5),
    APP_CONFIG.months
  );
}

function renderHeader(months) {
  return `
    <div class="real-worked-table-row real-worked-table-row--header">
      <div class="real-worked-table-cell real-worked-table-cell--name">Nom</div>
      <div class="real-worked-table-cell real-worked-table-cell--total">Total jours</div>
      ${months
        .map(
          (month) => `
            <div class="real-worked-table-cell real-worked-table-cell--month">
              <span>${escapeHtml(month.monthLabel)}</span>
              <span>${month.year}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRoleRow(role, monthCount) {
  return `
    <div
      class="real-worked-table-row real-worked-table-row--role"
      style="--real-worked-month-count:${monthCount}"
    >
      <div class="real-worked-table-role-label">${escapeHtml(role)}</div>
    </div>
  `;
}

function renderWorkerRow(worker, months) {
  const totalDays = getWorkerTotalDays(worker?.workedDays);

  return `
    <div class="real-worked-table-row">
      <div class="real-worked-table-cell real-worked-table-cell--name">
        ${escapeHtml(worker?.name || "")}
      </div>
      <div class="real-worked-table-cell real-worked-table-cell--total">
        ${formatDayValue(totalDays) || "0"} j
      </div>
      ${months
        .map((month) => {
          const days = toFiniteNumber(worker?.workedDays?.[month.monthKey], 0);
          return `
            <div class="real-worked-table-cell real-worked-table-cell--value">
              ${formatDayValue(days)}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTotalRow(project, months) {
  const totalDays = (project?.workers || []).reduce(
    (sum, worker) => sum + getWorkerTotalDays(worker?.workedDays),
    0
  );

  return `
    <div class="real-worked-table-row real-worked-table-row--total">
      <div class="real-worked-table-cell real-worked-table-cell--name">Total</div>
      <div class="real-worked-table-cell real-worked-table-cell--total">
        ${formatDayValue(totalDays) || "0"} j
      </div>
      ${months
        .map((month) => {
          const monthTotal = (project?.workers || []).reduce((sum, worker) => {
            return sum + toFiniteNumber(worker?.workedDays?.[month.monthKey], 0);
          }, 0);

          return `
            <div class="real-worked-table-cell real-worked-table-cell--value">
              ${formatDayValue(monthTotal) || "0"}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getTableMinWidth(monthCount) {
  return 180 + 110 + Math.max(0, monthCount) * 118;
}

export function renderRealWorkedDaysTable(boardEl, project) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  const months = buildRealWorkedMonths(project);
  if (!project || months.length === 0) {
    boardEl.innerHTML = `
      <div class="real-worked-empty-state">
        Aucun jour reel travaille a afficher pour ce projet.
      </div>
    `;
    return;
  }

  const groupedWorkers = groupWorkersByRole(project?.workers || []);
  const monthCount = months.length;
  const rows = Object.entries(groupedWorkers)
    .map(([role, workers]) => {
      return [
        renderRoleRow(role, monthCount),
        ...(workers || []).map((worker) => renderWorkerRow(worker, months)),
      ].join("");
    })
    .join("");

  boardEl.innerHTML = `
    <div class="real-worked-table-shell">
      <div
        class="real-worked-table"
        style="--real-worked-month-count:${monthCount}; --real-worked-table-min-width:${getTableMinWidth(monthCount)}px"
      >
        ${renderHeader(months)}
        ${rows}
        ${renderTotalRow(project, months)}
      </div>
    </div>
  `;
}

export function clearRealWorkedDaysTable(boardEl) {
  if (boardEl instanceof HTMLElement) {
    boardEl.innerHTML = "";
  }
}
