import { getPlanningTasksOverlappingRange } from "../services/projectService.js";
import {
  getMonthEndDate,
  getMonthKeyFromDate,
  getMonthStartDate,
  parseMonthKey,
} from "../utils/format.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPlanningDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "Non renseignee";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatPlanningRealisation(value) {
  const normalizedValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${normalizedValue} %`;
}

function renderPlanningManagementEmptyState(message) {
  return `
    <div class="planning-management-empty-state">
      ${escapeHtml(message)}
    </div>
  `;
}

function getCurrentMonthKey() {
  return getMonthKeyFromDate(new Date());
}

function normalizeMonthKey(monthKey) {
  return parseMonthKey(monthKey) ? String(monthKey).trim() : getCurrentMonthKey();
}

function formatPlanningMonth(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return "Mois inconnu";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(new Date(parsed.year, parsed.monthNumber - 1, 1, 12));
}

function formatPlanningMonthShort(year, monthNumber) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "short",
  })
    .format(new Date(year, monthNumber - 1, 1, 12))
    .replace(/\.$/, "");
}

function getPlanningMonthWindow(monthKey) {
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const startAt = getMonthStartDate(normalizedMonthKey);
  const endAt = getMonthEndDate(normalizedMonthKey);
  if (!(startAt instanceof Date) || !(endAt instanceof Date)) {
    return null;
  }

  endAt.setHours(23, 59, 59, 999);
  return {
    monthKey: normalizedMonthKey,
    startAt,
    endAt,
  };
}

function getTaskExecutionWindowForMonth(task, monthWindow) {
  if (!task || !monthWindow) {
    return null;
  }

  const taskStartAt = task.startAt instanceof Date ? task.startAt : null;
  const taskEndAt = task.endAt instanceof Date ? task.endAt : null;
  if (!taskStartAt || !taskEndAt) {
    return null;
  }

  const startAt = taskStartAt > monthWindow.startAt ? taskStartAt : monthWindow.startAt;
  const endAt = taskEndAt < monthWindow.endAt ? taskEndAt : monthWindow.endAt;
  if (endAt < startAt) {
    return null;
  }

  return { startAt, endAt };
}

export function clearPlanningManagement(boardEl) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  boardEl.innerHTML = "";
}

function renderPlanningMonthPicker(selectedMonthKey, options = {}) {
  const normalizedMonthKey = normalizeMonthKey(selectedMonthKey);
  const parsedSelectedMonth = parseMonthKey(normalizedMonthKey);
  const fallbackDate = new Date();
  const pickerYear = Number.isInteger(options.monthPickerViewYear)
    ? Number(options.monthPickerViewYear)
    : parsedSelectedMonth?.year || fallbackDate.getFullYear();
  const currentMonthKey = getCurrentMonthKey();

  return `
    <div class="planning-management-month-picker" role="dialog" aria-label="Choisir un mois">
      <div class="planning-management-month-picker-header">
        <button
          type="button"
          class="planning-management-month-picker-nav-btn"
          data-month-picker-year-delta="-1"
          aria-label="Annee precedente"
        >
          &#8249;
        </button>
        <strong class="planning-management-month-picker-year">${escapeHtml(
          String(pickerYear)
        )}</strong>
        <button
          type="button"
          class="planning-management-month-picker-nav-btn"
          data-month-picker-year-delta="1"
          aria-label="Annee suivante"
        >
          &#8250;
        </button>
      </div>
      <div class="planning-management-month-picker-grid">
        ${Array.from({ length: 12 }, (_, index) => {
          const monthNumber = index + 1;
          const monthKey = `${pickerYear}-${String(monthNumber).padStart(2, "0")}`;
          const isSelected = monthKey === normalizedMonthKey;
          const isCurrent = monthKey === currentMonthKey;

          return `
            <button
              type="button"
              class="planning-management-month-picker-month-btn${
                isSelected ? " is-selected" : ""
              }${isCurrent ? " is-current" : ""}"
              data-month-value="${escapeHtml(monthKey)}"
              aria-pressed="${isSelected ? "true" : "false"}"
            >
              ${escapeHtml(formatPlanningMonthShort(pickerYear, monthNumber))}
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

export function renderPlanningManagement(
  boardEl,
  project,
  selectedMonthKey = "",
  options = {}
) {
  if (!(boardEl instanceof HTMLElement)) {
    return;
  }

  if (!project) {
    clearPlanningManagement(boardEl);
    return;
  }

  const monthWindow = getPlanningMonthWindow(selectedMonthKey);
  if (!monthWindow) {
    clearPlanningManagement(boardEl);
    return;
  }

  const overlappingTasks = getPlanningTasksOverlappingRange(
    project.planningTasks || [],
    monthWindow.startAt,
    monthWindow.endAt
  );
  const monthLabel = formatPlanningMonth(monthWindow.monthKey);

  boardEl.innerHTML = `
    <section class="planning-management-panel">
      <div class="planning-management-toolbar">
        <div class="planning-management-copy">
          <strong class="planning-management-title">Plans du mois</strong>
          <span class="planning-management-subtitle">${escapeHtml(monthLabel)}</span>
        </div>
        <div class="planning-management-controls">
          <button
            type="button"
            class="planning-management-nav-btn"
            data-month-delta="-1"
            aria-label="Mois precedent"
          >
            &#8249;
          </button>
          <div class="planning-management-month-picker-wrap">
            <button
              type="button"
              class="planning-management-month-trigger${
                options.monthPickerOpen ? " is-open" : ""
              }"
              aria-label="Choisir un mois"
              aria-haspopup="dialog"
              aria-expanded="${options.monthPickerOpen ? "true" : "false"}"
            >
              ${escapeHtml(monthLabel)}
            </button>
            ${
              options.monthPickerOpen
                ? renderPlanningMonthPicker(monthWindow.monthKey, options)
                : ""
            }
          </div>
          <button
            type="button"
            class="planning-management-nav-btn"
            data-month-delta="1"
            aria-label="Mois suivant"
          >
            &#8250;
          </button>
        </div>
      </div>
      <div class="planning-management-summary">
        <div class="planning-management-count">
          <span class="planning-management-count-label">Nombre de plans</span>
          <strong>${overlappingTasks.length}</strong>
        </div>
      </div>
      ${
        overlappingTasks.length
          ? `
      <div class="planning-management-list">
        <div class="planning-management-list-head" aria-hidden="true">
          <span class="planning-management-list-head-main">Plan</span>
          <span class="planning-management-list-head-deadline">Echeance</span>
          <span class="planning-management-list-head-realisation">
            <span>Realisation</span>
            <span>(En %)</span>
          </span>
        </div>
        ${overlappingTasks
          .map((task) => {
            const taskLabel = task.taskCode
              ? `${task.taskCode} - ${task.name}`
              : task.name;

            return `
              <article class="planning-management-item">
                <div class="planning-management-item-main">
                  <strong class="planning-management-item-title">${escapeHtml(taskLabel)}</strong>
                  <span class="planning-management-item-meta">${escapeHtml(
                    task.typeDoc || "Type non renseigne"
                  )}</span>
                  <span class="planning-management-item-window">
                    Execution ce mois :
                    ${escapeHtml(
                      (() => {
                        const executionWindow = getTaskExecutionWindowForMonth(task, monthWindow);
                        if (!executionWindow) {
                          return "non renseignee";
                        }

                        return `${formatPlanningDate(executionWindow.startAt)} au ${formatPlanningDate(
                          executionWindow.endAt
                        )}`;
                      })()
                    )}
                  </span>
                </div>
                <div class="planning-management-item-deadline">
                  <span class="planning-management-item-deadline-label">Echeance</span>
                  <strong>${escapeHtml(formatPlanningDate(task.deadlineAt))}</strong>
                </div>
                <div class="planning-management-item-realisation">
                  <span class="planning-management-item-realisation-label">Realisation</span>
                  <strong>${escapeHtml(
                    formatPlanningRealisation(task.realisationPct)
                  )}</strong>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
      `
          : renderPlanningManagementEmptyState(
              `Aucun plan Planning Projet en execution sur ${monthLabel}.`
            )
      }
    </section>
  `;
}
