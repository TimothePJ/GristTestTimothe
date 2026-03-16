import { APP_CONFIG } from "../config.js";
import {
  buildDisplayedMonths,
  clamp,
  getMonthKeyFromRawMonth,
  toFiniteNumber,
  toReferenceId,
  toText,
} from "../utils/format.js";
import {
  getSegmentAllocationByMonth,
  parseRawDateTime,
} from "../utils/timeSegments.js";

function parseBillingPercentageByMonth(rawValue, projectNumber) {
  if (!rawValue) return {};

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    console.warn(
      "Pourcentage_Facturation_Par_Mois JSON invalide pour le projet",
      projectNumber,
      error
    );
    return {};
  }
}

function createProjectNumberIndex(projects) {
  const index = new Map();

  projects.forEach((project) => {
    if (!project.projectNumber) return;

    if (index.has(project.projectNumber)) {
      console.warn(
        "Numero de projet duplique detecte dans Projets :",
        project.projectNumber
      );
    }

    index.set(project.projectNumber, project);
  });

  return index;
}

function isPrevisionalSegment(segmentType) {
  const normalizedType = toText(segmentType).toLowerCase();
  return !normalizedType || normalizedType === "previsionnel";
}

function mergeMonthlyDays(target, monthKey, value) {
  target[monthKey] = Math.round((toFiniteNumber(target[monthKey], 0) + value) * 100) / 100;
}

export function buildExpenseData({
  projectRows,
  budgetRows,
  projectTeamRows,
  timesheetRows,
  timeSegmentRows,
  teamRows,
}) {
  const columns = APP_CONFIG.grist.columns;

  const projects = (projectRows || []).map((row) => {
    const projectNumber = toText(row?.[columns.projects.projectNumber]);

    return {
      id: Number(row?.[columns.projects.id]),
      projectNumber,
      name: toText(row?.[columns.projects.name]),
      billingPercentage: toFiniteNumber(
        row?.[columns.projects.billingPercentage],
        100
      ),
      billingPercentageByMonth: parseBillingPercentageByMonth(
        row?.[columns.projects.billingPercentageByMonth],
        projectNumber
      ),
      budgetLines: [],
      workers: [],
    };
  });

  const projectsByNumber = createProjectNumberIndex(projects);

  (budgetRows || []).forEach((row) => {
    const project = projectsByNumber.get(toText(row?.[columns.budget.projectNumber]));
    if (!project) return;

    project.budgetLines.push({
      id: Number(row?.[columns.budget.id]),
      chapter: toText(row?.[columns.budget.chapter]),
      amount: toFiniteNumber(row?.[columns.budget.amount], 0),
    });
  });

  const workersById = new Map();

  (projectTeamRows || []).forEach((row) => {
    const project = projectsByNumber.get(
      toText(row?.[columns.projectTeam.projectNumber])
    );
    if (!project) return;

    const worker = {
      id: Number(row?.[columns.projectTeam.id]),
      role: toText(row?.[columns.projectTeam.role]),
      name: toText(row?.[columns.projectTeam.name]),
      dailyRate: toFiniteNumber(row?.[columns.projectTeam.dailyRate], 0),
      segments: [],
      provisionalDays: {},
      workedDays: {},
    };

    project.workers.push(worker);
    workersById.set(worker.id, worker);
  });

  (timeSegmentRows || []).forEach((row) => {
    const workerId = toReferenceId(row?.[columns.timeSegment.projectTeamLink]);
    const worker = workersById.get(workerId);
    if (!worker) return;

    const startAt = parseRawDateTime(row?.[columns.timeSegment.startDate]);
    const endAt = parseRawDateTime(row?.[columns.timeSegment.endDate]);
    if (!startAt || !endAt) return;

    const segmentType = toText(row?.[columns.timeSegment.segmentType]);
    if (!isPrevisionalSegment(segmentType)) return;

    const segment = {
      id: Number(row?.[columns.timeSegment.id]),
      projectTeamLink: workerId,
      startAt,
      endAt,
      segmentType,
      allocationDays: toFiniteNumber(row?.[columns.timeSegment.allocationDays], 0),
      label: toText(row?.[columns.timeSegment.label]),
    };

    worker.segments.push(segment);

    const monthlyAllocation = getSegmentAllocationByMonth(segment);
    Object.entries(monthlyAllocation).forEach(([monthKey, days]) => {
      mergeMonthlyDays(worker.provisionalDays, monthKey, toFiniteNumber(days, 0));
    });
  });

  workersById.forEach((worker) => {
    worker.segments.sort((left, right) => left.startAt - right.startAt);
  });

  (timesheetRows || []).forEach((row) => {
    const workerId = Number(row?.[columns.timesheet.workerId]);
    const worker = workersById.get(workerId);
    if (!worker) return;

    const monthKey = getMonthKeyFromRawMonth(row?.[columns.timesheet.month]);
    if (!monthKey) return;

    const workedDays = row?.[columns.timesheet.workedDays];

    if (workedDays != null) {
      worker.workedDays[monthKey] = toFiniteNumber(workedDays, 0);
    }
  });

  const teamMembers = (teamRows || []).map((row) => ({
    id: Number(row?.[columns.team.id]),
    firstName: toText(row?.[columns.team.firstName]),
    lastName: toText(row?.[columns.team.lastName]),
    role: toText(row?.[columns.team.role]),
  }));

  return {
    projects,
    teamMembers,
  };
}

export function getProjectBudgetTotal(project) {
  return (project?.budgetLines || []).reduce(
    (sum, line) => sum + toFiniteNumber(line?.amount, 0),
    0
  );
}

export function getWorkerTotalDays(daysByMonth) {
  return Object.values(daysByMonth || {}).reduce(
    (sum, days) => sum + toFiniteNumber(days, 0),
    0
  );
}

export function calculateProvisionalSpending(project, monthKey) {
  return (project?.workers || []).reduce((total, worker) => {
    const days = toFiniteNumber(worker?.provisionalDays?.[monthKey], 0);
    return total + days * toFiniteNumber(worker?.dailyRate, 0);
  }, 0);
}

export function calculateRealSpending(project, monthKey) {
  return (project?.workers || []).reduce((total, worker) => {
    const days = toFiniteNumber(worker?.workedDays?.[monthKey], 0);
    return total + days * toFiniteNumber(worker?.dailyRate, 0);
  }, 0);
}

export function getBillingPercentageForMonth(project, monthKey) {
  const raw = project?.billingPercentageByMonth?.[monthKey];
  if (raw != null && raw !== "") {
    return clamp(toFiniteNumber(raw, 100), 0, 100);
  }

  return clamp(toFiniteNumber(project?.billingPercentage, 100), 0, 100);
}

export function getPriorCumulativeSpending(project, boundaryMonthKey) {
  let real = 0;
  let provisional = 0;

  (project?.workers || []).forEach((worker) => {
    Object.entries(worker?.workedDays || {}).forEach(([monthKey, days]) => {
      if (monthKey < boundaryMonthKey) {
        real += toFiniteNumber(days, 0) * toFiniteNumber(worker?.dailyRate, 0);
      }
    });

    Object.entries(worker?.provisionalDays || {}).forEach(([monthKey, days]) => {
      if (monthKey < boundaryMonthKey) {
        provisional +=
          toFiniteNumber(days, 0) * toFiniteNumber(worker?.dailyRate, 0);
      }
    });
  });

  return { real, provisional };
}

export function getPriorCumulativeBilling(project, boundaryMonthKey) {
  let total = 0;
  const allMonthKeys = new Set();

  (project?.workers || []).forEach((worker) => {
    Object.keys(worker?.workedDays || {}).forEach((monthKey) => {
      allMonthKeys.add(monthKey);
    });
  });

  [...allMonthKeys]
    .sort()
    .forEach((monthKey) => {
      if (monthKey >= boundaryMonthKey) return;
      const monthlyReal = calculateRealSpending(project, monthKey);
      const billingPct = getBillingPercentageForMonth(project, monthKey) / 100;
      total += monthlyReal * billingPct;
    });

  return total;
}

export function groupWorkersByRole(workers) {
  return (workers || []).reduce((groups, worker) => {
    const role = worker?.role || "Sans role";
    if (!groups[role]) {
      groups[role] = [];
    }
    groups[role].push(worker);
    return groups;
  }, {});
}

export function getEarliestProjectMonth(project) {
  const monthKeys = new Set();

  (project?.workers || []).forEach((worker) => {
    Object.keys(worker?.provisionalDays || {}).forEach((monthKey) => {
      monthKeys.add(monthKey);
    });
    Object.keys(worker?.workedDays || {}).forEach((monthKey) => {
      monthKeys.add(monthKey);
    });
  });

  if (!monthKeys.size) return null;

  const firstMonthKey = [...monthKeys].sort()[0];
  const [year, month] = firstMonthKey.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;

  return {
    year,
    monthIndex: month - 1,
    monthKey: firstMonthKey,
  };
}

export function getProjectKpis(project) {
  const totalBudget = getProjectBudgetTotal(project);
  const totalProvisionalSpending = (project?.workers || []).reduce((total, worker) => {
    return total + getWorkerTotalDays(worker?.provisionalDays) * toFiniteNumber(worker?.dailyRate, 0);
  }, 0);

  const totalRealSpending = (project?.workers || []).reduce((total, worker) => {
    return total + getWorkerTotalDays(worker?.workedDays) * toFiniteNumber(worker?.dailyRate, 0);
  }, 0);

  const remainingBudget = totalBudget - totalRealSpending;
  const remainingPercentage =
    totalBudget > 0 ? (remainingBudget / totalBudget) * 100 : 0;

  return {
    totalBudget,
    totalProvisionalSpending,
    totalRealSpending,
    remainingBudget,
    remainingPercentage,
  };
}

export function buildChartSeries(project, { selectedYear, selectedMonth, monthSpan }) {
  const allMonthKeys = new Set();

  (project?.workers || []).forEach((worker) => {
    Object.keys(worker?.provisionalDays || {}).forEach((monthKey) => {
      allMonthKeys.add(monthKey);
    });
    Object.keys(worker?.workedDays || {}).forEach((monthKey) => {
      allMonthKeys.add(monthKey);
    });
  });

  const sortedKeys = [...allMonthKeys].sort();
  const cumulativeProvisionalMap = new Map();
  const cumulativeRealMap = new Map();

  if (sortedKeys.length > 0) {
    const [startYear, startMonth] = sortedKeys[0].split("-").map(Number);
    const [endYear, endMonth] = sortedKeys[sortedKeys.length - 1].split("-").map(Number);

    let currentYear = startYear;
    let currentMonth = startMonth;
    let runningProvisionalTotal = 0;
    let runningRealTotal = 0;

    while (
      currentYear < endYear ||
      (currentYear === endYear && currentMonth <= endMonth)
    ) {
      const monthKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
      runningProvisionalTotal += calculateProvisionalSpending(project, monthKey);
      runningRealTotal += calculateRealSpending(project, monthKey);

      cumulativeProvisionalMap.set(monthKey, runningProvisionalTotal);
      cumulativeRealMap.set(monthKey, runningRealTotal);

      currentMonth += 1;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear += 1;
      }
    }
  }

  const displayedMonths = buildDisplayedMonths(
    selectedYear,
    selectedMonth,
    monthSpan,
    APP_CONFIG.months
  );

  const totalBudget = getProjectBudgetTotal(project);
  const labels = [];
  const provisionalSpendingData = [];
  const realSpendingData = [];
  const provisionalPercentData = [];
  const realPercentData = [];
  const billingPercentData = [];

  displayedMonths.forEach(({ monthKey, monthLabel, year }) => {
    labels.push([monthLabel, String(year)]);
    billingPercentData.push(getBillingPercentageForMonth(project, monthKey));

    let provisionalValue = 0;
    let realValue = 0;

    if (sortedKeys.length > 0) {
      const firstKey = sortedKeys[0];
      const lastKey = sortedKeys[sortedKeys.length - 1];

      if (monthKey < firstKey) {
        provisionalValue = 0;
        realValue = 0;
      } else if (monthKey > lastKey) {
        provisionalValue = cumulativeProvisionalMap.get(lastKey) || 0;
        realValue = cumulativeRealMap.get(lastKey) || 0;
      } else {
        provisionalValue = cumulativeProvisionalMap.get(monthKey) || 0;
        realValue = cumulativeRealMap.get(monthKey) || 0;
      }
    }

    provisionalSpendingData.push(provisionalValue);
    realSpendingData.push(realValue);
    provisionalPercentData.push(
      totalBudget > 0 ? (provisionalValue / totalBudget) * 100 : 0
    );
    realPercentData.push(totalBudget > 0 ? (realValue / totalBudget) * 100 : 0);
  });

  return {
    labels,
    provisionalSpendingData,
    realSpendingData,
    provisionalPercentData,
    realPercentData,
    billingPercentData,
  };
}
