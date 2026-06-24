import {
  countWorkingHalfDayUnits,
  getIntersection,
  getRangeCapacityDays,
  parseDateTime,
} from "./dateRange.js";
import {
  compareText,
  normalizePersonName,
  parseFrenchNumber,
  toText,
} from "./utils.js";

function getProjectLabel(projectNumber, projects) {
  const number = toText(projectNumber);
  const project = projects.get(number);
  if (!project) return `${number || "Sans projet"} - Projet introuvable`;
  return project.name ? `${number} - ${project.name}` : number;
}

function getSegmentDaysInRange(segment, range) {
  const start = parseDateTime(segment.startAt);
  const end = parseDateTime(segment.endAt);
  if (!start || !end || end <= start) return 0;

  const intersection = getIntersection(start, end, range.start, range.end);
  if (!intersection) return 0;

  const fullUnits = countWorkingHalfDayUnits(start, end);
  const overlapUnits = countWorkingHalfDayUnits(intersection.start, intersection.end);
  if (overlapUnits <= 0) return 0;

  const allocationDays = parseFrenchNumber(segment.allocationDays);
  if (allocationDays != null && allocationDays > 0 && fullUnits > 0) {
    return allocationDays * (overlapUnits / fullUnits);
  }

  return overlapUnits / 2;
}

export function computeOccupationByProject({ employeeKey, segments, projects, range }) {
  const byProject = new Map();

  segments.forEach((segment) => {
    if (normalizePersonName(segment.employeeName) !== employeeKey) return;

    const days = getSegmentDaysInRange(segment, range);
    if (days <= 0) return;

    const projectNumber = toText(segment.projectNumber) || "Sans projet";
    const current = byProject.get(projectNumber) || {
      projectNumber,
      label: getProjectLabel(projectNumber, projects),
      days: 0,
    };
    current.days += days;
    byProject.set(projectNumber, current);
  });

  const rows = Array.from(byProject.values()).sort((left, right) =>
    right.days - left.days || compareText(left.label, right.label)
  );
  const occupiedDays = rows.reduce((sum, row) => sum + row.days, 0);
  const capacityDays = getRangeCapacityDays(range);
  const freeDays = Math.max(0, capacityDays - occupiedDays);
  const overloadDays = Math.max(0, occupiedDays - capacityDays);
  const chartTotalDays = Math.max(capacityDays, occupiedDays);
  const occupationRate = capacityDays > 0 ? (occupiedDays / capacityDays) * 100 : 0;

  const projectRows = rows.map((row) => ({
    ...row,
    type: "project",
    percent: chartTotalDays > 0 ? (row.days / chartTotalDays) * 100 : 0,
  }));

  const freeRow = freeDays > 0
    ? [{
        projectNumber: "",
        label: "Temps libre",
        days: freeDays,
        percent: chartTotalDays > 0 ? (freeDays / chartTotalDays) * 100 : 0,
        type: "free",
        color: "#c9d2dc",
      }]
    : [];

  return {
    totalDays: occupiedDays,
    occupiedDays,
    capacityDays,
    freeDays,
    overloadDays,
    occupationRate,
    isOverloaded: overloadDays > 0,
    rows: projectRows,
    chartRows: [...projectRows, ...freeRow],
  };
}
