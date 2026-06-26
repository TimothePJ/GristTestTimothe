import { COLUMN_CANDIDATES, TABLES } from "./config.js";
import {
  countWorkingHalfDayUnits,
  parseDateTime,
} from "./dateRange.js";
import {
  compareText,
  findColumn,
  normalizePersonName,
  parseFrenchNumber,
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
  return segmentRows
    .map((row) => {
      const employeeName = toText(getCell(row, columns.employeeName));
      const employeeKey = normalizePersonName(employeeName);
      const startDate = parseDateTime(getCell(row, columns.startAt));
      const endDate = parseDateTime(getCell(row, columns.endAt));
      if (!employeeKey || !startDate || !endDate || endDate <= startDate) return null;

      const fullHalfDayUnits = countWorkingHalfDayUnits(startDate, endDate);
      if (fullHalfDayUnits <= 0) return null;

      return {
        employeeName,
        employeeKey,
        startDate,
        endDate,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        allocationDays: parseFrenchNumber(getCell(row, columns.allocationDays)),
        effectif: toText(getCell(row, columns.effectif)),
        projectNumber: toText(getCell(row, columns.projectNumber)) || "Sans projet",
        fullHalfDayUnits,
      };
    })
    .filter(Boolean);
}

function addSegmentOnlyEmployees(employees, segments) {
  const byKey = new Map(employees.map((employee) => [employee.key, employee]));

  segments.forEach((segment) => {
    const name = segment.employeeName;
    const key = segment.employeeKey;
    if (!key || byKey.has(key)) return;

    byKey.set(key, {
      key,
      name,
      firstName: "",
      lastName: "",
      email: "",
      service: "",
      role: "",
      external: "",
      idTrefle: "",
      fromSegmentsOnly: true,
    });
  });

  return Array.from(byKey.values()).sort((left, right) =>
    compareText(left.service, right.service) ||
    compareText(left.role, right.role) ||
    compareText(left.name, right.name)
  );
}

function buildSegmentsByEmployee(segments) {
  const grouped = new Map();

  segments.forEach((segment) => {
    const list = grouped.get(segment.employeeKey) || [];
    list.push(segment);
    grouped.set(segment.employeeKey, list);
  });

  grouped.forEach((list) => {
    list.sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
  });

  return grouped;
}

export async function loadGestionUserData() {
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

  const employees = buildEmployees(teamTable, teamRows);
  const segments = buildSegments(timeSegmentTable, segmentRows);

  return {
    employees: addSegmentOnlyEmployees(employees, segments),
    projects: buildProjects(projectTable, projectRows),
    segments,
    segmentsByEmployee: buildSegmentsByEmployee(segments),
  };
}
