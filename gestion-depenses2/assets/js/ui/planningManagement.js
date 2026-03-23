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

export function renderPlanningManagement(boardEl, project, selectedMonthKey = "") {
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
            ‹
          </button>
          <input
            type="month"
            class="planning-management-month-input"
            value="${escapeHtml(monthWindow.monthKey)}"
            aria-label="Selectionner un mois"
          >
          <button
            type="button"
            class="planning-management-nav-btn"
            data-month-delta="1"
            aria-label="Mois suivant"
          >
            ›
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
