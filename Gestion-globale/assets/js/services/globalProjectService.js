import { APP_CONFIG } from "../../../../gestion-depenses2/assets/js/config.js";
import {
  buildExpenseData,
  getBillingPercentageForMonth,
  getProjectBudgetTotal,
  getProjectKpis,
  normalizeBillingPercentageValue,
} from "../../../../gestion-depenses2/assets/js/services/projectService.js";
import {
  toFiniteNumber,
  toText,
} from "../../../../gestion-depenses2/assets/js/utils/format.js";

const DOP_COLUMN = "DOP";
const ALL_DOP_VALUES = new Set(["", "1", "2"]);

function clampPercentage(value) {
  return Math.max(0, Math.min(100, toFiniteNumber(value, 0)));
}

function getProjectDisplayName(project) {
  return toText(project?.name) || toText(project?.projectNumber) || "Projet sans nom";
}

function getProjectPrefix(project, index) {
  return toText(project?.projectNumber) || getProjectDisplayName(project) || `Projet ${index + 1}`;
}

function normalizeBudgetChapter(value) {
  return toText(value) || "Sans chapitre";
}

function cloneNumericMap(source) {
  return Object.fromEntries(
    Object.entries(source || {})
      .map(([key, value]) => [toText(key), toFiniteNumber(value, 0)])
      .filter(([key]) => key)
  );
}

function parseAvancementConfig(rawValue) {
  if (rawValue == null || rawValue === "") {
    return [];
  }

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function getBudgetProgressByKey(project) {
  const progressByKey = new Map();

  parseAvancementConfig(project?.avancementConfigRaw).forEach((item) => {
    const key = toText(item?.budgetKey);
    if (!key) return;
    progressByKey.set(key, clampPercentage(item?.percentage));
  });

  return progressByKey;
}

function buildAggregatedBudgetLines(projects) {
  const byChapter = new Map();

  projects.forEach((project) => {
    (project?.budgetLines || []).forEach((line) => {
      const chapter = normalizeBudgetChapter(line?.chapter);
      const amount = toFiniteNumber(line?.amount, 0);
      const current = byChapter.get(chapter) || { chapter, amount: 0 };
      current.amount += amount;
      byChapter.set(chapter, current);
    });
  });

  return [...byChapter.values()].map((line, index) => ({
    id: `global-budget-${index + 1}`,
    chapter: line.chapter,
    amount: line.amount,
  }));
}

function buildAggregatedBudgetProgress(projects) {
  const progressByChapter = new Map();

  projects.forEach((project) => {
    const projectProgress = getBudgetProgressByKey(project);

    (project?.budgetLines || []).forEach((line) => {
      const chapter = normalizeBudgetChapter(line?.chapter);
      const amount = Math.max(0, toFiniteNumber(line?.amount, 0));
      const percentage = projectProgress.get(chapter) ?? 0;
      const current = progressByChapter.get(chapter) || {
        budgetKey: chapter,
        amount: 0,
        doneAmount: 0,
      };

      current.amount += amount;
      current.doneAmount += amount * (percentage / 100);
      progressByChapter.set(chapter, current);
    });
  });

  return [...progressByChapter.values()].map((item) => ({
    budgetKey: item.budgetKey,
    percentage: item.amount > 0 ? (item.doneAmount / item.amount) * 100 : 0,
  }));
}

function buildAggregatedSelections(projects) {
  const countsByType = new Map();

  projects.forEach((project) => {
    parseAvancementConfig(project?.avancementConfigRaw).forEach((item) => {
      const typeDocument = toText(item?.typeDocument);
      const indice = toText(item?.indice);
      if (!typeDocument || !indice) return;

      const countsByIndice = countsByType.get(typeDocument) || new Map();
      countsByIndice.set(indice, toFiniteNumber(countsByIndice.get(indice), 0) + 1);
      countsByType.set(typeDocument, countsByIndice);
    });
  });

  return [...countsByType.entries()].map(([typeDocument, countsByIndice]) => {
    const [indice] = [...countsByIndice.entries()].sort((left, right) => {
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) return countDelta;
      return String(left[0]).localeCompare(String(right[0]), "fr", {
        numeric: true,
        sensitivity: "base",
      });
    })[0];

    return { typeDocument, indice };
  });
}

function buildAggregatedAvancementConfig(projects) {
  return JSON.stringify([
    ...buildAggregatedSelections(projects),
    ...buildAggregatedBudgetProgress(projects),
  ]);
}

function buildAggregatedWorkers(projects) {
  let nextWorkerId = 1;

  return projects.flatMap((project, projectIndex) => {
    const prefix = getProjectPrefix(project, projectIndex);

    return (project?.workers || []).map((worker) => {
      const workerId = nextWorkerId;
      nextWorkerId += 1;
      const workerName = toText(worker?.name) || "Collaborateur sans nom";

      return {
        id: workerId,
        role: toText(worker?.role) || "Sans role",
        name: `${prefix} - ${workerName}`,
        dailyRate: toFiniteNumber(worker?.dailyRate, 0),
        provisionalDays: cloneNumericMap(worker?.provisionalDays),
        workedDays: cloneNumericMap(worker?.workedDays),
        timesheetWorkedDays: cloneNumericMap(worker?.timesheetWorkedDays),
        segments: (worker?.segments || []).map((segment, segmentIndex) => ({
          ...segment,
          id: `${prefix}-planned-${segment?.id ?? segmentIndex}`,
          projectTeamLink: workerId,
        })),
        realSegments: (worker?.realSegments || []).map((segment, segmentIndex) => ({
          ...segment,
          id: `${prefix}-real-${segment?.id ?? segmentIndex}`,
          projectTeamLink: workerId,
        })),
      };
    });
  });
}

function buildAggregatedAvancementRecords(projects) {
  return projects.flatMap((project, projectIndex) => {
    const prefix = getProjectPrefix(project, projectIndex);

    return (project?.avancementRecords || []).map((record, recordIndex) => ({
      ...record,
      id: `${prefix}-doc-${record?.id ?? recordIndex}`,
      NumeroDocument: `${prefix} - ${toText(record?.NumeroDocument)}`,
    }));
  });
}

function buildAggregatedPlanningTasks(projects) {
  return projects.flatMap((project, projectIndex) => {
    const prefix = getProjectPrefix(project, projectIndex);

    return (project?.planningTasks || []).map((task, taskIndex) => ({
      ...task,
      id: `${prefix}-task-${task?.id ?? taskIndex}`,
      name: `${prefix} - ${toText(task?.name) || "Plan"}`,
      taskCode: [prefix, toText(task?.taskCode)].filter(Boolean).join(" - "),
    }));
  });
}

function collectBillingMonthKeys(projects) {
  const monthKeys = new Set();

  projects.forEach((project) => {
    Object.keys(project?.billingPercentageByMonth || {}).forEach((monthKey) => {
      if (monthKey) monthKeys.add(monthKey);
    });

    (project?.workers || []).forEach((worker) => {
      Object.keys(worker?.provisionalDays || {}).forEach((monthKey) => monthKeys.add(monthKey));
      Object.keys(worker?.workedDays || {}).forEach((monthKey) => monthKeys.add(monthKey));
    });
  });

  return [...monthKeys].sort();
}

function buildAggregatedBilling(projects, totalBudget) {
  const billingPercentageByMonth = {};

  collectBillingMonthKeys(projects).forEach((monthKey) => {
    const billedAmount = projects.reduce((sum, project) => {
      const projectBudget = getProjectBudgetTotal(project);
      const percentage = getBillingPercentageForMonth(project, monthKey);
      return sum + projectBudget * (percentage / 100);
    }, 0);

    billingPercentageByMonth[monthKey] = totalBudget > 0
      ? (billedAmount / totalBudget) * 100
      : 0;
  });

  const fallbackBilledAmount = projects.reduce((sum, project) => {
    const projectBudget = getProjectBudgetTotal(project);
    return sum + projectBudget * (normalizeBillingPercentageValue(project?.billingPercentage, 0) / 100);
  }, 0);

  return {
    billingPercentage: totalBudget > 0 ? (fallbackBilledAmount / totalBudget) * 100 : 0,
    billingPercentageByMonth,
  };
}

export function normalizeDopValue(value) {
  const raw = toText(value).replace(/^dop\s*/i, "").trim();
  if (raw === "1" || raw === "2" || raw === "") {
    return raw;
  }

  return raw;
}

export function getDopLabel(value) {
  const dop = normalizeDopValue(value);
  if (dop === "1" || dop === "2") {
    return `DOP ${dop}`;
  }

  return dop ? `DOP ${dop}` : "Sans DOP";
}

export function buildGlobalExpenseData(tables) {
  const expenseData = buildExpenseData(tables);
  const projectNumberColumn = APP_CONFIG.grist.columns.projects.projectNumber;
  const dopByProjectNumber = new Map(
    (tables?.projectRows || []).map((row) => [
      toText(row?.[projectNumberColumn]),
      normalizeDopValue(row?.[DOP_COLUMN]),
    ])
  );

  return {
    ...expenseData,
    projects: expenseData.projects.map((project) => ({
      ...project,
      dop: dopByProjectNumber.get(project.projectNumber) ?? "",
    })),
  };
}

export function filterProjectsByDop(projects, selectedDop) {
  return (projects || []).filter((project) => {
    const dop = normalizeDopValue(project?.dop);

    if (selectedDop === "1" || selectedDop === "2") {
      return dop === selectedDop;
    }

    return ALL_DOP_VALUES.has(dop);
  });
}

export function buildAggregatedProject(projects) {
  const selectedProjects = Array.isArray(projects) ? projects : [];
  if (!selectedProjects.length) {
    return null;
  }

  const totalBudget = selectedProjects.reduce(
    (sum, project) => sum + getProjectBudgetTotal(project),
    0
  );
  const billing = buildAggregatedBilling(selectedProjects, totalBudget);

  return {
    id: null,
    projectNumber: "GLOBAL",
    name: `${selectedProjects.length} projet(s) selectionne(s)`,
    dop: "global",
    avancementConfigRaw: buildAggregatedAvancementConfig(selectedProjects),
    billingPercentage: billing.billingPercentage,
    billingPercentageByMonth: billing.billingPercentageByMonth,
    budgetLines: buildAggregatedBudgetLines(selectedProjects),
    avancementRecords: buildAggregatedAvancementRecords(selectedProjects),
    planningTasks: buildAggregatedPlanningTasks(selectedProjects),
    workers: buildAggregatedWorkers(selectedProjects),
    globalSourceProjectCount: selectedProjects.length,
  };
}

export function buildProjectBudgetRows(projects) {
  return (projects || []).map((project) => {
    const kpis = getProjectKpis(project);

    return {
      id: project.id,
      projectNumber: toText(project.projectNumber),
      name: getProjectDisplayName(project),
      dop: normalizeDopValue(project.dop),
      budget: kpis.totalBudget,
      provisionalSpending: kpis.totalProvisionalSpending,
      realSpending: kpis.totalRealSpending,
      remainingBudget: kpis.remainingBudget,
    };
  });
}
