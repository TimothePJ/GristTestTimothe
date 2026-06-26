import {
  countWorkingHalfDayUnits,
  getIntersection,
  getRangeCapacityDays,
} from "./dateRange.js";
import {
  compareText,
  toText,
} from "./utils.js";

function getProjectLabel(projectNumber, projects) {
  const number = toText(projectNumber);
  const project = projects.get(number);
  if (!project) return `${number || "Sans projet"} - Projet introuvable`;
  return project.name ? `${number} - ${project.name}` : number;
}

function getSegmentDaysInRange(segment, range) {
  const intersection = getIntersection(segment.startDate, segment.endDate, range.start, range.end);
  if (!intersection) return 0;

  const overlapUnits = countWorkingHalfDayUnits(intersection.start, intersection.end);
  if (overlapUnits <= 0) return 0;

  if (segment.allocationDays != null && segment.allocationDays > 0 && segment.fullHalfDayUnits > 0) {
    return segment.allocationDays * (overlapUnits / segment.fullHalfDayUnits);
  }

  return overlapUnits / 2;
}

function createWeekValues(weeks) {
  return Object.fromEntries(weeks.map((week) => [week.value, 0]));
}

function getEmployeeDisplayName(employee) {
  const firstName = toText(employee.firstName);
  const lastName = toText(employee.lastName);
  if (firstName || lastName) {
    return [firstName, lastName.toLocaleUpperCase("fr-FR")].filter(Boolean).join(" ");
  }

  const parts = toText(employee.name).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts.join(" ").toLocaleUpperCase("fr-FR");

  const inferredLastName = parts.pop();
  return [...parts, inferredLastName.toLocaleUpperCase("fr-FR")].join(" ");
}

function getEmployeesWithSegmentOnlyEntries(employees, segmentsByEmployee) {
  const byKey = new Map(employees.map((employee) => [employee.key, employee]));

  segmentsByEmployee.forEach((segments, key) => {
    if (!key || byKey.has(key)) return;
    const name = segments[0]?.employeeName || "";

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
    compareText(getEmployeeDisplayName(left), getEmployeeDisplayName(right))
  );
}

function groupSegmentsByEmployee(segments = []) {
  const grouped = new Map();

  segments.forEach((segment) => {
    const key = segment.employeeKey;
    if (!key) return;
    const list = grouped.get(key) || [];
    list.push(segment);
    grouped.set(key, list);
  });

  return grouped;
}

function getPreparedWeeks(weeks) {
  return weeks.map((week, index) => ({
    ...week,
    index,
    startTime: week.startTime ?? week.range.start.getTime(),
    endTime: week.endTime ?? week.range.end.getTime(),
    capacityDays: week.capacityDays ?? getRangeCapacityDays(week.range),
  }));
}

function findFirstOverlappingWeekIndex(weeks, startTime) {
  let low = 0;
  let high = weeks.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (weeks[middle].endTime <= startTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function formatEmployeeDisplayName(employee) {
  return getEmployeeDisplayName(employee);
}

export function computeWeeklyUtilizationMatrix({ employees, segments = [], segmentsByEmployee = null, projects, weeks }) {
  const normalizedWeeks = getPreparedWeeks(weeks);
  const groupedSegments = segmentsByEmployee || groupSegmentsByEmployee(segments);
  const matrixEmployees = getEmployeesWithSegmentOnlyEntries(employees, groupedSegments);

  return matrixEmployees.map((employee) => {
    const projectRowsByNumber = new Map();
    const totals = createWeekValues(normalizedWeeks);
    const employeeSegments = groupedSegments.get(employee.key) || [];

    employeeSegments.forEach((segment) => {
      const projectNumber = segment.projectNumber || "Sans projet";
      let row = projectRowsByNumber.get(projectNumber);
      if (!row) {
        row = {
          type: "project",
          projectNumber,
          projectLabel: getProjectLabel(projectNumber, projects),
          employee,
          employeeLabel: getEmployeeDisplayName(employee),
          weekPercents: createWeekValues(normalizedWeeks),
        };
        projectRowsByNumber.set(projectNumber, row);
      }

      let weekIndex = findFirstOverlappingWeekIndex(normalizedWeeks, segment.startTime);
      while (weekIndex < normalizedWeeks.length) {
        const week = normalizedWeeks[weekIndex];
        if (week.startTime >= segment.endTime) break;

        const days = getSegmentDaysInRange(segment, week.range);
        if (days > 0 && week.capacityDays > 0) {
          const percent = (days / week.capacityDays) * 100;
          row.weekPercents[week.value] += percent;
        }

        weekIndex += 1;
      }
    });

    const projectRows = Array.from(projectRowsByNumber.values())
      .filter((row) =>
        normalizedWeeks.some((week) => row.weekPercents[week.value] > 0)
      )
      .sort((left, right) => compareText(left.projectLabel, right.projectLabel));

    projectRows.forEach((row) => {
      normalizedWeeks.forEach((week) => {
        // Plusieurs segments peuvent se chevaucher sur le meme projet ; une ligne projet reste plafonnee a 100 %.
        const percent = Math.min(100, row.weekPercents[week.value] || 0);
        row.weekPercents[week.value] = percent;
        totals[week.value] += percent;
      });
    });

    const visibleProjectRows = projectRows.length
      ? projectRows
      : [{
          type: "empty",
          projectNumber: "",
          projectLabel: "Aucun projet planifi\u00e9",
          employee,
          employeeLabel: getEmployeeDisplayName(employee),
          weekPercents: createWeekValues(normalizedWeeks),
        }];

    return {
      employee,
      employeeLabel: getEmployeeDisplayName(employee),
      projectRows: visibleProjectRows,
      totalRow: {
        type: "total",
        projectNumber: "",
        projectLabel: "Total employ\u00e9",
        employee,
        employeeLabel: getEmployeeDisplayName(employee),
        weekPercents: totals,
      },
    };
  });
}
