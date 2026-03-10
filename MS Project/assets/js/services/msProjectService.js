import { APP_CONFIG } from "../config.js";
import { toText } from "./gristService.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeUtcDateToLocalCalendar(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function toLocalNoon(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  return noon;
}

function parseDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return normalizeUtcDateToLocalCalendar(value);
  }

  if (typeof value === "number") {
    const date = new Date(value > 1e9 && value < 1e11 ? value * 1000 : value);
    return normalizeUtcDateToLocalCalendar(date);
  }

  const text = String(value).trim();
  if (!text) return null;

  // ISO/Date-only: on conserve strictement le jour source (sans effet fuseau).
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]);
    const day = Number(isoDateMatch[3]);
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

function isSameCalendarDay(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtCellDate(date) {
  return date ? date.toLocaleDateString("fr-FR") : "";
}

function fmtIsoDate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    <div class="group-row-grid${row.isTitleRow ? " row-is-title" : ""}" style="display:grid;grid-template-columns:var(--col-id) var(--col-task) var(--col-start) var(--col-end) var(--col-duration) var(--col-team);align-items:center;width:var(--left-grid-width);min-height:var(--row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id">${escapeHtml(row.id)}</div>
      <div class="cell-task">${escapeHtml(row.task)}</div>
      <div class="cell-start">${escapeHtml(row.start)}</div>
      <div class="cell-end">${escapeHtml(row.end)}</div>
      <div class="cell-duration">${escapeHtml(row.durationLabel)}</div>
      <div class="cell-team">${escapeHtml(row.teamLabel)}</div>
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

function resolveProjectFilterColumn(rawRows, config) {
  const explicitSourceName = config.columns.sourceName;
  if (
    explicitSourceName &&
    rawRows.some((row) => row && Object.prototype.hasOwnProperty.call(row, explicitSourceName))
  ) {
    return explicitSourceName;
  }

  const sourceNameCandidates = config.sourceNameCandidates || ["Nom"];
  const sourceCandidateMatch = sourceNameCandidates.find((column) =>
    rawRows.some((row) => row && Object.prototype.hasOwnProperty.call(row, column))
  );
  if (sourceCandidateMatch) {
    return sourceCandidateMatch;
  }

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
  const projectFilterColumn = resolveProjectFilterColumn(rawRows, config);

  let rows = rawRows.map((rawRow, index) => {
    const startDate = parseDate(rawRow[columns.start]);
    const durationValue = toNumber(rawRow[columns.duration]);
    const parsedEndDate = parseDate(rawRow[columns.end]);
    const endDate = parsedEndDate;
    const task = toText(rawRow[columns.taskName]) || `Tache ${index + 1}`;
    const uniqueNumber = toText(rawRow[columns.uniqueNumber]);
    const team = [toText(rawRow[columns.team]), toText(rawRow[columns.subTeam])]
      .filter(Boolean)
      .join(" / ");
    const barStyle = toText(rawRow[columns.barStyle]);
    const titleMarker = toText(rawRow[columns.title]);
    const level = toText(rawRow[columns.level]);
    const indicator = toText(rawRow[columns.indicator]);
    const effort = toNumber(rawRow[columns.effort]);
    const isTitleRow = titleMarker.toLocaleLowerCase("fr") === "titre";

    return {
      rowId: rawRow[columns.id] ?? index + 1,
      id: uniqueNumber || toText(rawRow[columns.id]) || String(index + 1),
      task,
      startDate,
      endDate,
      startIso: fmtIsoDate(startDate),
      endIso: fmtIsoDate(endDate),
      start: fmtCellDate(startDate),
      end: fmtCellDate(endDate),
      durationValue,
      durationLabel: fmtDuration(rawRow[columns.duration]),
      teamLabel: team,
      subTeamLabel: toText(rawRow[columns.subTeam]),
      levelLabel: level,
      barStyleLabel: barStyle,
      titleMarkerLabel: titleMarker,
      isTitleRow,
      indicatorLabel: indicator,
      effortValue: effort,
      projectLabel: projectFilterColumn ? toText(rawRow[projectFilterColumn]) : "",
      sourceIndex: index,
    };
  });

  if (!selectedProject) {
    rows = [];
  } else if (projectFilterColumn) {
    rows = rows.filter((row) => row.projectLabel === selectedProject);
  }

  rows.sort((a, b) => {
    const aHasStart = a.startDate instanceof Date;
    const bHasStart = b.startDate instanceof Date;
    if (aHasStart && bHasStart && a.startDate.valueOf() !== b.startDate.valueOf()) {
      return a.startDate - b.startDate;
    }

    if (aHasStart !== bHasStart) {
      return aHasStart ? -1 : 1;
    }

    const aHasEnd = a.endDate instanceof Date;
    const bHasEnd = b.endDate instanceof Date;
    if (aHasEnd && bHasEnd && a.endDate.valueOf() !== b.endDate.valueOf()) {
      return a.endDate - b.endDate;
    }

    if (aHasEnd !== bHasEnd) {
      return aHasEnd ? -1 : 1;
    }

    return a.sourceIndex - b.sourceIndex;
  });

  const groups = [];
  const items = [];

  rows.forEach((row, index) => {
    const groupId = `ms-${row.rowId}-${index}`;

    groups.push({
      id: groupId,
      rowId: row.rowId,
      content: buildGroupContent(row),
      idLabel: row.id,
      taskLabel: row.task,
      startLabel: row.start,
      endLabel: row.end,
      startIso: row.startIso,
      endIso: row.endIso,
      durationLabel: row.durationLabel,
      teamLabel: row.teamLabel,
      styleLabel: row.barStyleLabel,
      isTitleRow: Boolean(row.isTitleRow),
      levelLabel: row.levelLabel,
      indicatorLabel: row.indicatorLabel,
      effortValue: row.effortValue,
      sortIndex: index,
    });

    if (!row.startDate || !row.endDate) return;
    const sharedTitle = `
      <b>${escapeHtml(row.task)}</b><br>
      Numero : ${escapeHtml(row.id)}<br>
      Debut : ${escapeHtml(fmtIsoDate(row.startDate))}<br>
      Fin : ${escapeHtml(fmtIsoDate(row.endDate))}<br>
      Duree : ${escapeHtml(row.durationLabel || "Non renseignee")}<br>
      Equipe : ${escapeHtml(row.teamLabel || "Non renseignee")}<br>
      Niveau : ${escapeHtml(row.levelLabel || "Non renseigne")}<br>
      Style : ${escapeHtml(row.barStyleLabel || "Non renseigne")}<br>
      Effort : ${escapeHtml(row.effortValue == null ? "Non renseigne" : String(row.effortValue))}
    `;

    const singleDayTask = isSameCalendarDay(row.startDate, row.endDate);

    if (row.endDate > row.startDate && !singleDayTask) {
      items.push({
        id: `${groupId}-task`,
        group: groupId,
        start: row.startDate,
        end: row.endDate,
        content: row.barStyleLabel || "",
        className: `${resolveTaskClass(row)}${row.isTitleRow ? " title-task" : ""}`,
        type: "range",
        title: sharedTitle,
      });
      return;
    }

    if (singleDayTask) {
      const milestoneStart = toLocalNoon(row.startDate) || row.startDate;
      items.push({
        id: `${groupId}-milestone`,
        group: groupId,
        start: milestoneStart,
        content: "",
        className: `${resolveTaskClass(row)} milestone-task${row.isTitleRow ? " title-task" : ""}`,
        type: "box",
        title: sharedTitle,
      });
      return;
    }

    const invalidStart = toLocalNoon(row.startDate) || row.startDate;
    items.push({
      id: `${groupId}-invalid-date-order`,
      group: groupId,
      start: invalidStart,
      content: "",
      className: `${resolveTaskClass(row)} milestone-task${row.isTitleRow ? " title-task" : ""}`,
      type: "box",
      title: `
        ${sharedTitle}<br>
        <i>Attention: Fin anterieure a Debut.</i>
      `,
    });
  });

  return {
    groups,
    items,
    rowCount: rows.length,
  };
}
