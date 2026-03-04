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

function fmtDuration(value) {
  const number = toNumber(value);
  if (number == null) return "";
  return `${number} j`;
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
    <div class="group-row-grid" style="display:grid;grid-template-columns:var(--col-id) var(--col-task) var(--col-start) var(--col-end) var(--col-duration) var(--col-team) var(--col-style);align-items:center;width:var(--left-grid-width);min-height:var(--row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id">${escapeHtml(row.id)}</div>
      <div class="cell-task">${escapeHtml(row.task)}</div>
      <div class="cell-start">${escapeHtml(row.start)}</div>
      <div class="cell-end">${escapeHtml(row.end)}</div>
      <div class="cell-duration">${escapeHtml(row.durationLabel)}</div>
      <div class="cell-team">${escapeHtml(row.teamLabel)}</div>
      <div class="cell-style">${escapeHtml(row.barStyleLabel)}</div>
    </div>
  `;
}

function normalizeStyleToken(value) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "default";
}

function resolveTaskClass(row) {
  return `phase-task bar-style-${normalizeStyleToken(row.barStyleLabel)}`;
}

function resolveProjectLinkColumn(rawRows, config) {
  const explicit = config.columns.projectLink;
  if (explicit && rawRows.some((row) => row && Object.prototype.hasOwnProperty.call(row, explicit))) {
    return explicit;
  }

  const candidates = config.projectLinkCandidates || [];
  return candidates.find((column) =>
    rawRows.some((row) => row && Object.prototype.hasOwnProperty.call(row, column))
  ) || null;
}

export function buildTimelineDataFromMsProjectRows(rawRows, selectedProject = "") {
  const config = APP_CONFIG.grist.msProjectTable;
  const columns = config.columns;
  const projectLinkColumn = resolveProjectLinkColumn(rawRows, config);

  let rows = rawRows.map((rawRow, index) => {
    const startDate = parseDate(rawRow[columns.start]);
    const durationValue = toNumber(rawRow[columns.duration]);
    const parsedEndDate = parseDate(rawRow[columns.end]);
    const endDate = startDate
      ? parsedEndDate && parsedEndDate > startDate
        ? parsedEndDate
        : durationValue != null && durationValue > 0
          ? addDays(startDate, durationValue)
          : addDays(startDate, 1)
      : null;
    const task = toText(rawRow[columns.taskName]) || `Tache ${index + 1}`;
    const uniqueNumber = toText(rawRow[columns.uniqueNumber]);
    const team = [toText(rawRow[columns.team]), toText(rawRow[columns.subTeam])]
      .filter(Boolean)
      .join(" / ");
    const barStyle = toText(rawRow[columns.barStyle]);
    const level = toText(rawRow[columns.level]);
    const indicator = toText(rawRow[columns.indicator]);
    const effort = toNumber(rawRow[columns.effort]);

    return {
      rowId: rawRow[columns.id] ?? index + 1,
      id: uniqueNumber || toText(rawRow[columns.id]) || String(index + 1),
      task,
      startDate,
      endDate,
      start: fmtCellDate(startDate),
      end: fmtCellDate(endDate),
      durationValue,
      durationLabel: fmtDuration(rawRow[columns.duration]),
      teamLabel: team,
      subTeamLabel: toText(rawRow[columns.subTeam]),
      levelLabel: level,
      barStyleLabel: barStyle,
      indicatorLabel: indicator,
      effortValue: effort,
      projectLink: projectLinkColumn ? toText(rawRow[projectLinkColumn]) : "",
    };
  });

  if (!selectedProject) {
    rows = [];
  } else if (projectLinkColumn) {
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
      durationLabel: row.durationLabel,
      teamLabel: row.teamLabel,
      styleLabel: row.barStyleLabel,
      levelLabel: row.levelLabel,
      indicatorLabel: row.indicatorLabel,
      effortValue: row.effortValue,
      sortIndex: index,
    });

    if (!row.startDate || !row.endDate) return;

    items.push({
      id: `${groupId}-task`,
      group: groupId,
      start: row.startDate,
      end: row.endDate,
      content: row.barStyleLabel || "",
      className: resolveTaskClass(row),
      type: "range",
      title: `
        <b>${escapeHtml(row.task)}</b><br>
        Numero : ${escapeHtml(row.id)}<br>
        Debut : ${escapeHtml(fmtIsoDate(row.startDate))}<br>
        Fin : ${escapeHtml(fmtIsoDate(row.endDate))}<br>
        Duree : ${escapeHtml(row.durationLabel || "Non renseignee")}<br>
        Equipe : ${escapeHtml(row.teamLabel || "Non renseignee")}<br>
        Niveau : ${escapeHtml(row.levelLabel || "Non renseigne")}<br>
        Style : ${escapeHtml(row.barStyleLabel || "Non renseigne")}<br>
        Effort : ${escapeHtml(row.effortValue == null ? "Non renseigne" : String(row.effortValue))}
      `,
    });
  });

  return {
    groups,
    items,
    rowCount: rows.length,
  };
}
