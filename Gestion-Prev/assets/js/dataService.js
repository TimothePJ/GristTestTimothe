import { COLUMN_CANDIDATES, TABLES } from "./config.js";
import {
  compareText,
  findColumn,
  normalizePersonName,
  tableToRows,
  toText,
} from "./utils.js";

function getCell(row, columnName) {
  return columnName ? row?.[columnName] : "";
}

function resolveColumns(tableData, columnConfig) {
  return Object.fromEntries(
    Object.entries(columnConfig).map(([key, candidates]) => [key, findColumn(tableData, candidates)])
  );
}

function buildEmployees(teamTable, teamRows) {
  const columns = resolveColumns(teamTable, COLUMN_CANDIDATES.team);
  const employees = new Map();

  teamRows.forEach((row) => {
    const fullName =
      toText(getCell(row, columns.fullName)) ||
      [getCell(row, columns.firstName), getCell(row, columns.lastName)]
        .map(toText)
        .filter(Boolean)
        .join(" ");
    const key = normalizePersonName(fullName);
    if (!key || employees.has(key)) return;

    employees.set(key, {
      key,
      name: fullName,
      firstName: toText(getCell(row, columns.firstName)),
      lastName: toText(getCell(row, columns.lastName)),
      email: toText(getCell(row, columns.email)),
      service: toText(getCell(row, columns.service)),
      role: toText(getCell(row, columns.role)),
      external: getCell(row, columns.external),
      idTrefle: toText(getCell(row, columns.idTrefle)),
    });
  });

  return Array.from(employees.values()).sort((left, right) =>
    compareText(left.name, right.name)
  );
}

function buildProjects(projectTable, projectRows) {
  const columns = resolveColumns(projectTable, COLUMN_CANDIDATES.projects);
  const projects = new Map();

  projectRows.forEach((row) => {
    const number = toText(getCell(row, columns.number));
    if (!number) return;
    projects.set(number, {
      number,
      name: toText(getCell(row, columns.name)),
    });
  });

  return projects;
}

function buildSegments(timeSegmentTable, segmentRows) {
  const columns = resolveColumns(timeSegmentTable, COLUMN_CANDIDATES.timeSegment);
  return segmentRows.map((row) => ({
    employeeName: getCell(row, columns.employeeName),
    startAt: getCell(row, columns.startAt),
    endAt: getCell(row, columns.endAt),
    allocationDays: getCell(row, columns.allocationDays),
    effectif: getCell(row, columns.effectif),
    projectNumber: getCell(row, columns.projectNumber),
  }));
}

export async function loadGestionPrevData() {
  if (!window.grist?.docApi) {
    throw new Error("API Grist indisponible.");
  }

  const [timeSegmentTable, teamTable, projectTable] = await Promise.all([
    grist.docApi.fetchTable(TABLES.timeSegment),
    grist.docApi.fetchTable(TABLES.team),
    grist.docApi.fetchTable(TABLES.projects),
  ]);

  const teamRows = tableToRows(teamTable);
  const projectRows = tableToRows(projectTable);
  const segmentRows = tableToRows(timeSegmentTable);

  return {
    employees: buildEmployees(teamTable, teamRows),
    projects: buildProjects(projectTable, projectRows),
    segments: buildSegments(timeSegmentTable, segmentRows),
  };
}
