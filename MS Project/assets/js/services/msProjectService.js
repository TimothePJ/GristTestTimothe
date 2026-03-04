import { APP_CONFIG } from "../config.js";
import { toText } from "./gristService.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const date = new Date(value > 1e9 && value < 1e11 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) return null;

  const frMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
    return null;
  }

  const isoDate = new Date(text);
  return Number.isNaN(isoDate.getTime()) ? null : isoDate;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function fmtCellDate(date) {
  return date ? date.toLocaleDateString("fr-FR") : "";
}

function fmtIsoDate(date) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildGroupContent(row) {
  return `
    <div class="group-row-grid" style="display:grid;grid-template-columns:var(--col-id) var(--col-task) var(--col-start) var(--col-end) var(--col-progress) var(--col-status);align-items:center;width:var(--left-grid-width);min-height:var(--row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id">${escapeHtml(row.id)}</div>
      <div class="cell-task">${escapeHtml(row.task)}</div>
      <div class="cell-start">${escapeHtml(row.start)}</div>
      <div class="cell-end">${escapeHtml(row.end)}</div>
      <div class="cell-progress">${escapeHtml(row.progress)}</div>
      <div class="cell-status">${escapeHtml(row.status)}</div>
    </div>
  `;
}

function resolveTaskClass(row) {
  const today = new Date();
  const status = String(row.status || "").toLowerCase();

  if (row.progressValue != null && row.progressValue >= 100) {
    return "phase-task phase-complete";
  }

  if (status.includes("termine") || status.includes("completed")) {
    return "phase-task phase-complete";
  }

  if (row.endDate && row.endDate < today && (row.progressValue == null || row.progressValue < 100)) {
    return "phase-task phase-delayed";
  }

  if ((row.progressValue != null && row.progressValue > 0) || status.includes("cours") || status.includes("progress")) {
    return "phase-task phase-active";
  }

  return "phase-task";
}

export function buildTimelineDataFromMsProjectRows(rawRows, selectedProject = "") {
  const columns = APP_CONFIG.grist.msProjectTable.columns;

  let rows = rawRows.map((rawRow, index) => {
    const startDate = parseDate(rawRow[columns.start]);
    const parsedEndDate = parseDate(rawRow[columns.end]);
    const endDate = startDate
      ? parsedEndDate && parsedEndDate > startDate
        ? parsedEndDate
        : addDays(startDate, 1)
      : null;
    const progressValue = toNumber(rawRow[columns.progress]);
    const task = toText(rawRow[columns.taskName]) || toText(rawRow[columns.taskNameAlt]) || `Tache ${index + 1}`;
    const status = toText(rawRow[columns.status]);

    return {
      rowId: rawRow[columns.id] ?? index + 1,
      projectLink: columns.project ? toText(rawRow[columns.project]) : "",
      id: toText(rawRow[columns.id]) || String(index + 1),
      task,
      startDate,
      endDate,
      start: fmtCellDate(startDate),
      end: fmtCellDate(endDate),
      progressValue,
      progress: progressValue == null ? "" : `${progressValue}%`,
      status,
    };
  });

  if (!selectedProject) {
    rows = [];
  } else if (columns.project) {
    rows = rows.filter((row) => row.projectLink === selectedProject);
  }

  rows = rows.filter((row) => row.startDate);

  rows.sort((a, b) => {
    if (a.startDate && b.startDate && a.startDate.valueOf() !== b.startDate.valueOf()) {
      return a.startDate - b.startDate;
    }

    if (a.endDate && b.endDate && a.endDate.valueOf() !== b.endDate.valueOf()) {
      return a.endDate - b.endDate;
    }

    return a.task.localeCompare(b.task, "fr");
  });

  const groups = [];
  const items = [];

  rows.forEach((row, index) => {
    const groupId = `ms-${row.rowId}-${index}`;

    groups.push({
      id: groupId,
      content: buildGroupContent(row),
      idLabel: row.id,
      taskLabel: row.task,
      startLabel: row.start,
      endLabel: row.end,
      progressLabel: row.progress,
      statusLabel: row.status,
      sortIndex: index,
    });

    if (!row.startDate || !row.endDate) return;

    items.push({
      id: `${groupId}-task`,
      group: groupId,
      start: row.startDate,
      end: row.endDate,
      content: row.progressValue != null && row.progressValue >= 15 ? `${row.progressValue}%` : "",
      className: resolveTaskClass(row),
      type: "range",
      title: `
        <b>${escapeHtml(row.task)}</b><br>
        Debut : ${escapeHtml(fmtIsoDate(row.startDate))}<br>
        Fin : ${escapeHtml(fmtIsoDate(row.endDate))}<br>
        Avancement : ${escapeHtml(row.progress || "Non renseigne")}<br>
        Statut : ${escapeHtml(row.status || "Non renseigne")}
      `,
    });
  });

  return {
    groups,
    items,
    rowCount: rows.length,
  };
}
