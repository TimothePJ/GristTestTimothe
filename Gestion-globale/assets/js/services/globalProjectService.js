import { APP_CONFIG } from "../../../../gestion-depenses2/assets/js/config.js";
import {
  buildExpenseData,
  getBillingPercentageForMonth,
  getProjectDateBounds,
  getProjectBudgetTotal,
  normalizeBillingPercentageValue,
} from "../../../../gestion-depenses2/assets/js/services/projectService.js";
import {
  getMonthEndDate,
  getMonthKeyFromRawMonth,
  getMonthStartDate,
  toFiniteNumber,
  toText,
} from "../../../../gestion-depenses2/assets/js/utils/format.js";

const DOP_COLUMN = "DOP";
export const WITHOUT_DOP_FILTER = "__without_dop__";

function clampPercentage(value) {
  return Math.max(0, Math.min(100, toFiniteNumber(value, 0)));
}

function getProjectDisplayName(project) {
  return toText(project?.name) || toText(project?.projectNumber) || "Projet sans nom";
}

function getProjectPrefix(project, index) {
  return toText(project?.projectNumber) || getProjectDisplayName(project) || `Projet ${index + 1}`;
}

function isProjectFromProjectsTable(project) {
  return !project?.isTimeRealSynthetic;
}

function normalizeBudgetChapter(value) {
  return toText(value) || "Sans chapitre";
}

function normalizePersonKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function normalizeAvancementTypeKey(value) {
  const normalizedType = toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
  const compactType = normalizedType.replace(/\s+/g, "");

  if (
    compactType === "ndc" ||
    normalizedType.includes("note de calcul") ||
    normalizedType.includes("notes de calcul") ||
    normalizedType.includes("note calcul") ||
    normalizedType.includes("notes calcul")
  ) {
    return "ndc";
  }

  return normalizedType;
}

function getPersonKeyFromParts(collaboratorId, name) {
  const normalizedCollaboratorId = toText(collaboratorId);
  if (normalizedCollaboratorId) {
    return `collaborator:${normalizedCollaboratorId}`;
  }

  const normalizedName = normalizePersonKey(name);
  return normalizedName ? `name:${normalizedName}` : "";
}

function getWorkerPersonKey(worker) {
  return getPersonKeyFromParts(worker?.collaboratorId, worker?.name);
}

function getTimeRealColumns() {
  return APP_CONFIG.grist.columns.timeReal || {};
}

function addNumericMapValue(target, key, value) {
  const mapKey = toText(key);
  if (!mapKey) {
    return;
  }

  target[mapKey] = toFiniteNumber(target[mapKey], 0) + toFiniteNumber(value, 0);
}

function mergeNumericMapValues(target, source) {
  Object.entries(source || {}).forEach(([key, value]) => {
    addNumericMapValue(target, key, value);
  });
}

function mergeWorkerMonthValues(targetWorker, sourceWorker, daysField, costsField) {
  const dailyRate = toFiniteNumber(sourceWorker?.dailyRate, 0);

  Object.entries(sourceWorker?.[daysField] || {}).forEach(([monthKey, days]) => {
    const numericDays = toFiniteNumber(days, 0);
    addNumericMapValue(targetWorker[daysField], monthKey, numericDays);
    addNumericMapValue(targetWorker[costsField], monthKey, numericDays * dailyRate);
  });
}

function buildDailyRateByPersonKey(projects) {
  const rates = new Map();

  (projects || []).forEach((project) => {
    (project?.workers || []).forEach((worker) => {
      const dailyRate = toFiniteNumber(worker?.dailyRate, 0);
      if (dailyRate <= 0) {
        return;
      }

      const personKeys = [
        getWorkerPersonKey(worker),
        getPersonKeyFromParts("", worker?.name),
      ].filter(Boolean);

      personKeys.forEach((personKey) => {
        if (!rates.has(personKey)) {
          rates.set(personKey, dailyRate);
        }
      });
    });
  });

  return rates;
}

function buildUniqueCollaboratorIdByName(timeRealRows) {
  const columns = getTimeRealColumns();
  const idsByName = new Map();

  (timeRealRows || []).forEach((row) => {
    const nameKey = normalizePersonKey(row?.[columns.name]);
    const collaboratorId = toText(row?.[columns.collaboratorId]);
    if (!nameKey || !collaboratorId) {
      return;
    }

    const ids = idsByName.get(nameKey) || new Set();
    ids.add(collaboratorId);
    idsByName.set(nameKey, ids);
  });

  return new Map(
    [...idsByName.entries()]
      .filter(([_nameKey, ids]) => ids.size === 1)
      .map(([nameKey, ids]) => [nameKey, [...ids][0]])
  );
}

function applyTimeRealCollaboratorIds(projects, timeRealRows) {
  const collaboratorIdByName = buildUniqueCollaboratorIdByName(timeRealRows);
  if (!collaboratorIdByName.size) {
    return;
  }

  (projects || []).forEach((project) => {
    const workersByName = new Map();

    (project?.workers || []).forEach((worker) => {
      const nameKey = normalizePersonKey(worker?.name);
      if (!nameKey) {
        return;
      }

      const workers = workersByName.get(nameKey) || [];
      workers.push(worker);
      workersByName.set(nameKey, workers);
    });

    workersByName.forEach((workers, nameKey) => {
      if (workers.length !== 1) {
        return;
      }

      const [worker] = workers;
      if (toText(worker?.collaboratorId)) {
        return;
      }

      const collaboratorId = collaboratorIdByName.get(nameKey);
      if (collaboratorId) {
        worker.collaboratorId = collaboratorId;
      }
    });
  });
}

function buildTimeRealEntries(timeRealRows) {
  const columns = getTimeRealColumns();
  const entriesByKey = new Map();

  (timeRealRows || []).forEach((row) => {
    const projectNumber = toText(row?.[columns.projectNumber]);
    const monthKey = getMonthKeyFromRawMonth(row?.[columns.month]);
    const allocationDays = Math.max(0, toFiniteNumber(row?.[columns.allocationDays], 0));
    const name = toText(row?.[columns.name]);
    const collaboratorId = toText(row?.[columns.collaboratorId]);
    const personKey = getPersonKeyFromParts(collaboratorId, name);

    if (!projectNumber || !monthKey || !personKey || allocationDays <= 0) {
      return;
    }

    const key = `${projectNumber}::${personKey}::${monthKey}`;
    const current = entriesByKey.get(key) || {
      projectNumber,
      monthKey,
      name,
      collaboratorId,
      personKey,
      allocationDays: 0,
    };

    current.allocationDays += allocationDays;
    current.name = current.name || name;
    entriesByKey.set(key, current);
  });

  return [...entriesByKey.values()];
}

function getWorkersMatchingTimeRealEntry(project, entry) {
  const fallbackNameKey = getPersonKeyFromParts("", entry?.name);
  const entryCollaboratorId = toText(entry?.collaboratorId);
  const workers = project?.workers || [];

  if (entryCollaboratorId) {
    const collaboratorMatches = workers.filter((worker) => (
      toText(worker?.collaboratorId) === entryCollaboratorId
    ));

    if (collaboratorMatches.length) {
      return collaboratorMatches;
    }
  }

  if (!fallbackNameKey) {
    return [];
  }

  const nameMatches = workers.filter((worker) => (
    getPersonKeyFromParts("", worker?.name) === fallbackNameKey
  ));

  return nameMatches.length === 1 ? nameMatches : [];
}

function findRealOnlyWorker(project, entry) {
  return (
    (project?.workers || []).find((worker) => (
      worker?.isRealOnly && getWorkerPersonKey(worker) === entry.personKey
    )) || null
  );
}

function createTimeRealSyntheticProject(entry) {
  return {
    id: `time-real-${entry.projectNumber}`,
    projectNumber: entry.projectNumber,
    name: `Projet TimeReal ${entry.projectNumber}`,
    dop: "",
    avancementConfigRaw: "",
    billingPercentage: 0,
    billingPercentageByMonth: {},
    budgetLines: [],
    avancementRecords: [],
    planningTasks: [],
    workers: [],
    isTimeRealSynthetic: true,
  };
}

function createRealOnlyWorker(project, entry, dailyRateByPersonKey) {
  const fallbackRate =
    toFiniteNumber(dailyRateByPersonKey.get(entry.personKey), 0) ||
    toFiniteNumber(dailyRateByPersonKey.get(getPersonKeyFromParts("", entry.name)), 0);

  const worker = {
    id: `real-${entry.projectNumber}-${entry.personKey}`,
    role: "Sans role",
    name: entry.name || "Collaborateur sans nom",
    collaboratorId: entry.collaboratorId,
    dailyRate: fallbackRate,
    provisionalDays: {},
    workedDays: {},
    timesheetWorkedDays: {},
    segments: [],
    realSegments: [],
    isRealOnly: true,
  };

  project.workers = Array.isArray(project.workers) ? project.workers : [];
  project.workers.push(worker);
  return worker;
}

function addTimeRealEntryToWorker(worker, entry, dailyRateByPersonKey) {
  worker.workedDays = worker.workedDays || {};
  worker.realSegments = worker.realSegments || [];

  if (entry.collaboratorId && !toText(worker.collaboratorId)) {
    worker.collaboratorId = entry.collaboratorId;
  }

  const inferredRate =
    toFiniteNumber(worker.dailyRate, 0) ||
    toFiniteNumber(dailyRateByPersonKey.get(entry.personKey), 0) ||
    toFiniteNumber(dailyRateByPersonKey.get(getPersonKeyFromParts("", entry.name)), 0);
  if (inferredRate > 0 && toFiniteNumber(worker.dailyRate, 0) <= 0) {
    worker.dailyRate = inferredRate;
  }

  addNumericMapValue(worker.workedDays, entry.monthKey, entry.allocationDays);

  const startAt = getMonthStartDate(entry.monthKey);
  const endAt = getMonthEndDate(entry.monthKey) || startAt;
  worker.realSegments.push({
    id: `real-${entry.projectNumber}-${entry.personKey}-${entry.monthKey}`,
    projectTeamLink: worker.id,
    startAt,
    endAt,
    segmentType: "real",
    allocationDays: entry.allocationDays,
    effectifDays: entry.allocationDays,
    label: "",
    collaboratorId: entry.collaboratorId,
  });
}

function completeProjectsWithTimeRealRows(projects, timeRealRows) {
  const completedProjects = Array.isArray(projects) ? [...projects] : [];

  applyTimeRealCollaboratorIds(completedProjects, timeRealRows);

  const projectsByNumber = new Map(
    completedProjects
      .map((project) => [toText(project?.projectNumber), project])
      .filter(([projectNumber]) => projectNumber)
  );
  const dailyRateByPersonKey = buildDailyRateByPersonKey(completedProjects);

  buildTimeRealEntries(timeRealRows).forEach((entry) => {
    let project = projectsByNumber.get(entry.projectNumber);
    if (!project) {
      project = createTimeRealSyntheticProject(entry);
      projectsByNumber.set(entry.projectNumber, project);
      completedProjects.push(project);
    }

    const matchingWorkers = getWorkersMatchingTimeRealEntry(project, entry);
    matchingWorkers.forEach((worker) => {
      if (entry.collaboratorId && !toText(worker.collaboratorId)) {
        worker.collaboratorId = entry.collaboratorId;
      }
    });

    const targetWorker =
      matchingWorkers[0] ||
      findRealOnlyWorker(project, entry) ||
      createRealOnlyWorker(project, entry, dailyRateByPersonKey);
    addTimeRealEntryToWorker(targetWorker, entry, dailyRateByPersonKey);
  });

  return completedProjects;
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

function buildAvancementIndiceByType(project) {
  const indiceByType = new Map();

  parseAvancementConfig(project?.avancementConfigRaw).forEach((item) => {
    const typeKey = normalizeAvancementTypeKey(item?.typeDocument);
    const indice = toText(item?.indice);
    if (!typeKey || !indice || indiceByType.has(typeKey)) {
      return;
    }

    indiceByType.set(typeKey, indice);
  });

  return indiceByType;
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
  const workersByPerson = new Map();

  projects.forEach((project, projectIndex) => {
    const prefix = getProjectPrefix(project, projectIndex);

    (project?.workers || []).forEach((worker, workerIndex) => {
      const collaboratorId = toText(worker?.collaboratorId);
      const rawWorkerName = toText(worker?.name);
      const workerName = rawWorkerName || "Collaborateur sans nom";
      const personKey = collaboratorId
        ? `collaborator:${collaboratorId}`
        : rawWorkerName
          ? normalizePersonKey(rawWorkerName)
        : `${prefix}-${worker?.id ?? workerIndex}`;
      const workerRole = toText(worker?.role);
      let aggregatedWorker = workersByPerson.get(personKey);

      if (!aggregatedWorker) {
        aggregatedWorker = {
          id: nextWorkerId,
          role: workerRole || "Sans role",
          name: workerName,
          collaboratorId,
          dailyRate: 0,
          provisionalDays: {},
          workedDays: {},
          timesheetWorkedDays: {},
          provisionalCosts: {},
          workedCosts: {},
          segments: [],
          realSegments: [],
        };
        nextWorkerId += 1;
        workersByPerson.set(personKey, aggregatedWorker);
      } else if (aggregatedWorker.role === "Sans role" && workerRole) {
        aggregatedWorker.role = workerRole;
      } else if (!toText(aggregatedWorker.collaboratorId) && collaboratorId) {
        aggregatedWorker.collaboratorId = collaboratorId;
      }

      mergeWorkerMonthValues(aggregatedWorker, worker, "provisionalDays", "provisionalCosts");
      mergeWorkerMonthValues(aggregatedWorker, worker, "workedDays", "workedCosts");
      mergeNumericMapValues(aggregatedWorker.timesheetWorkedDays, worker?.timesheetWorkedDays);

      aggregatedWorker.segments.push(
        ...(worker?.segments || []).map((segment, segmentIndex) => ({
          ...segment,
          id: `${prefix}-planned-${segment?.id ?? segmentIndex}`,
          projectTeamLink: aggregatedWorker.id,
        }))
      );
      aggregatedWorker.realSegments.push(
        ...(worker?.realSegments || []).map((segment, segmentIndex) => ({
          ...segment,
          id: `${prefix}-real-${segment?.id ?? segmentIndex}`,
          projectTeamLink: aggregatedWorker.id,
        }))
      );
    });
  });

  return [...workersByPerson.values()].sort((left, right) => (
    toText(left?.name).localeCompare(toText(right?.name), "fr", {
      numeric: true,
      sensitivity: "base",
    })
  ));
}

function buildAggregatedAvancementRecords(projects) {
  return projects.flatMap((project, projectIndex) => {
    const prefix = getProjectPrefix(project, projectIndex);
    const indiceByType = buildAvancementIndiceByType(project);

    return (project?.avancementRecords || []).map((record, recordIndex) => {
      const selectedIndice = indiceByType.get(normalizeAvancementTypeKey(record?.Type_document));

      return {
        ...record,
        id: `${prefix}-doc-${record?.id ?? recordIndex}`,
        NumeroDocument: `${prefix} - ${toText(record?.NumeroDocument)}`,
        AvancementSelectedIndice: selectedIndice || "",
      };
    });
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

function getMonthKeyFromDateValue(value) {
  const match = toText(value).match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function buildGlobalExpenseMonthBounds(projects) {
  const startMonthKeys = [];
  const endMonthKeys = [];
  const startDates = [];
  const endDates = [];

  (projects || []).forEach((project) => {
    const dateBounds = getProjectDateBounds(project);
    const startMonthKey = getMonthKeyFromDateValue(dateBounds?.startDate);
    const endMonthKey = getMonthKeyFromDateValue(dateBounds?.endDate);

    if (startMonthKey) {
      startMonthKeys.push(startMonthKey);
    }

    if (endMonthKey) {
      endMonthKeys.push(endMonthKey);
    }

    if (dateBounds?.startDate) {
      startDates.push(dateBounds.startDate);
    }

    if (dateBounds?.endDate) {
      endDates.push(dateBounds.endDate);
    }
  });

  if (!startMonthKeys.length || !endMonthKeys.length || !startDates.length || !endDates.length) {
    return null;
  }

  const sortedStartMonthKeys = startMonthKeys.sort();
  const sortedEndMonthKeys = endMonthKeys.sort();
  const sortedStartDates = startDates.sort();
  const sortedEndDates = endDates.sort();

  return {
    startDate: sortedStartDates[0],
    endDate: sortedEndDates[sortedEndDates.length - 1],
    startMonthKey: sortedStartMonthKeys[0],
    endMonthKey: sortedEndMonthKeys[sortedEndMonthKeys.length - 1],
    exact: true,
  };
}

export function normalizeDopValue(value) {
  return toText(value).replace(/^dop\s*/i, "").trim();
}

export function getDopLabel(value) {
  const dop = normalizeDopValue(value);
  return dop ? `DOP ${dop}` : "Sans DOP";
}

function normalizeRelationKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function normalizeDopKey(value) {
  return normalizeRelationKey(normalizeDopValue(value));
}

function toRecordId(value) {
  const numericId = Number(value);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function toReferenceId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = toReferenceId(item);
      if (id != null) return id;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const key of ["id", "rowId", "recordId"]) {
      const id = toReferenceId(value[key]);
      if (id != null) return id;
    }
    return null;
  }

  return toRecordId(value);
}

function getFirstMeaningfulValue(rows, columnId) {
  if (!columnId) return "";
  const row = (rows || []).find((candidate) => {
    const value = candidate?.[columnId];
    return value != null && !(typeof value === "string" && value.trim() === "");
  });
  return row?.[columnId] ?? "";
}

function getUniqueTexts(values) {
  const byKey = new Map();
  (values || []).forEach((value) => {
    const text = toText(value);
    const key = normalizeRelationKey(text);
    if (key && !byKey.has(key)) {
      byKey.set(key, text);
    }
  });
  return [...byKey.values()];
}

function buildMergedProjectName(projectNumber, names) {
  const uniqueNames = getUniqueTexts(names);
  if (uniqueNames.length === 1) return uniqueNames[0];
  if (uniqueNames.length > 1) return uniqueNames.join(" / ");
  return projectNumber ? `Projet ${projectNumber}` : "Projet sans nom";
}

function buildCanonicalProjectRegistry(projectRows = []) {
  const columns = APP_CONFIG.grist.columns.projects;
  const groupedRows = new Map();

  projectRows.forEach((row, index) => {
    const projectNumber = toText(row?.[columns.projectNumber]);
    const rowId = toRecordId(row?.[columns.id]);
    const groupKey = projectNumber
      ? `number:${normalizeRelationKey(projectNumber)}`
      : `row:${rowId || index}`;
    const group = groupedRows.get(groupKey) || {
      key: groupKey,
      number: projectNumber,
      rows: [],
    };
    group.rows.push(row);
    groupedRows.set(groupKey, group);
  });

  const groups = [];
  const dopConflicts = [];

  groupedRows.forEach((group) => {
    const sourceIds = group.rows.map((row) => toRecordId(row?.[columns.id])).filter(Boolean);
    const sourceNames = getUniqueTexts(group.rows.map((row) => row?.[columns.name]));
    const dopByKey = new Map();
    group.rows.forEach((row) => {
      const dop = normalizeDopValue(row?.[columns.dop || DOP_COLUMN]);
      const dopKey = normalizeDopKey(dop);
      if (!dopByKey.has(dopKey)) dopByKey.set(dopKey, dop);
    });

    if (dopByKey.size > 1) {
      dopConflicts.push({
        projectNumber: group.number,
        projectNames: sourceNames,
        dopValues: [...dopByKey.values()],
      });
      return;
    }

    const canonicalId = sourceIds[0] || null;
    const canonicalName = buildMergedProjectName(group.number, sourceNames);
    const canonicalDop = [...dopByKey.values()][0] || "";
    const canonicalRow = {
      ...(group.rows[0] || {}),
      [columns.id]: canonicalId,
      [columns.projectNumber]: group.number,
      [columns.name]: canonicalName,
      [columns.dop || DOP_COLUMN]: canonicalDop,
    };

    [
      columns.avancement,
      columns.billingPercentage,
      columns.billingPercentageByMonth,
    ].filter(Boolean).forEach((columnId) => {
      canonicalRow[columnId] = getFirstMeaningfulValue(group.rows, columnId);
    });

    groups.push({
      ...group,
      canonicalId,
      canonicalName,
      canonicalDop,
      canonicalRow,
      sourceIds,
      sourceNames,
    });
  });

  const byNumber = new Map();
  const byName = new Map();
  groups.forEach((group) => {
    const numberKey = normalizeRelationKey(group.number);
    if (numberKey) byNumber.set(numberKey, group);

    [group.number, ...group.sourceNames, ...group.sourceIds].forEach((alias) => {
      const aliasKey = normalizeRelationKey(alias);
      if (!aliasKey) return;
      const matches = byName.get(aliasKey) || [];
      matches.push(group);
      byName.set(aliasKey, matches);
    });
  });

  return { groups, byNumber, byName, dopConflicts };
}

function dedupeRowsById(rows = []) {
  const seenIds = new Set();
  return rows.filter((row) => {
    const rowId = toRecordId(row?.id);
    if (rowId == null) return true;
    if (seenIds.has(rowId)) return false;
    seenIds.add(rowId);
    return true;
  });
}

function addUnmatchedDiagnostic(diagnostics, table, row, relation, value, reason = "projet introuvable") {
  diagnostics.unmatchedRows.push({
    table,
    rowId: toRecordId(row?.id),
    relation,
    value: toText(value),
    reason,
  });
}

function resolveGroupByNumber(registry, value) {
  const key = normalizeRelationKey(value);
  return key ? registry.byNumber.get(key) || null : null;
}

function resolveGroupByNames(registry, values = []) {
  const matches = new Map();
  values.forEach((value) => {
    const key = normalizeRelationKey(value);
    (registry.byName.get(key) || []).forEach((group) => matches.set(group.key, group));
  });
  return matches.size === 1 ? [...matches.values()][0] : null;
}

function normalizeRowsLinkedByNumber(rows, tableName, projectNumberColumn, registry, diagnostics) {
  return dedupeRowsById((rows || []).flatMap((row) => {
    const projectNumber = row?.[projectNumberColumn];
    const group = resolveGroupByNumber(registry, projectNumber);
    if (!group) {
      addUnmatchedDiagnostic(diagnostics, tableName, row, projectNumberColumn, projectNumber);
      return [];
    }
    return [{ ...row, [projectNumberColumn]: group.number }];
  }));
}

function normalizeRowsLinkedByName(
  rows,
  tableName,
  projectNameColumns,
  canonicalProjectNameColumn,
  registry,
  diagnostics
) {
  return dedupeRowsById((rows || []).flatMap((row) => {
    const names = projectNameColumns.flatMap((columnId) => {
      const value = row?.[columnId];
      const referenceId = toReferenceId(value);
      return referenceId != null ? [value, referenceId] : [value];
    }).filter((value) => toText(value));
    const group = resolveGroupByNames(registry, names);
    if (!group) {
      addUnmatchedDiagnostic(
        diagnostics,
        tableName,
        row,
        projectNameColumns.join(", "),
        names.join(" / "),
        names.length ? "projet introuvable ou ambigu" : "liaison projet vide"
      );
      return [];
    }
    return [{ ...row, [canonicalProjectNameColumn]: group.canonicalName }];
  }));
}

function normalizeGlobalTables(tables = {}) {
  const registry = buildCanonicalProjectRegistry(tables.projectRows || []);
  const columns = APP_CONFIG.grist.columns;
  const diagnostics = {
    dopConflicts: registry.dopConflicts,
    unmatchedRows: [],
  };
  const projectTeamRows = normalizeRowsLinkedByNumber(
    tables.projectTeamRows,
    APP_CONFIG.grist.tables.projectTeam,
    columns.projectTeam.projectNumber,
    registry,
    diagnostics
  );
  const retainedProjectTeamIds = new Set(
    projectTeamRows.map((row) => toRecordId(row?.[columns.projectTeam.id])).filter(Boolean)
  );
  const timesheetRows = dedupeRowsById((tables.timesheetRows || []).flatMap((row) => {
    const workerId = toReferenceId(row?.[columns.timesheet.workerId]);
    if (workerId != null && retainedProjectTeamIds.has(workerId)) {
      return [{ ...row, [columns.timesheet.workerId]: workerId }];
    }
    addUnmatchedDiagnostic(
      diagnostics,
      APP_CONFIG.grist.tables.timesheet,
      row,
      columns.timesheet.workerId,
      workerId,
      "collaborateur projet introuvable"
    );
    return [];
  }));

  const normalizedTables = {
    ...tables,
    projectRows: registry.groups.map((group) => group.canonicalRow),
    budgetRows: normalizeRowsLinkedByNumber(
      tables.budgetRows,
      APP_CONFIG.grist.tables.budget,
      columns.budget.projectNumber,
      registry,
      diagnostics
    ),
    listePlanRows: normalizeRowsLinkedByName(
      tables.listePlanRows,
      APP_CONFIG.grist.tables.listePlan,
      [
        columns.listePlan.projectName,
        columns.listePlan.projectNameAlt,
        "NomProjetString",
        "Nom_de_projet",
      ],
      columns.listePlan.projectName,
      registry,
      diagnostics
    ),
    planningProjectRows: normalizeRowsLinkedByName(
      tables.planningProjectRows,
      APP_CONFIG.grist.tables.planningProject,
      [columns.planningProject.projectName, "Nom_projet"],
      columns.planningProject.projectName,
      registry,
      diagnostics
    ),
    projectTeamRows,
    timesheetRows,
    timeSegmentRows: normalizeRowsLinkedByNumber(
      tables.timeSegmentRows,
      APP_CONFIG.grist.tables.timeSegment,
      columns.timeSegment.projectNumber,
      registry,
      diagnostics
    ),
    timeRealRows: normalizeRowsLinkedByNumber(
      tables.timeRealRows,
      APP_CONFIG.grist.tables.timeReal,
      columns.timeReal.projectNumber,
      registry,
      diagnostics
    ),
  };

  return { normalizedTables, registry, diagnostics };
}

export function getAvailableDopValues(projects) {
  const byKey = new Map();
  (projects || []).forEach((project) => {
    const dop = normalizeDopValue(project?.dop);
    const key = normalizeDopKey(dop);
    if (key && !byKey.has(key)) byKey.set(key, dop);
  });
  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right, "fr", { numeric: true, sensitivity: "base" })
  );
}

export function buildGlobalExpenseData(tables) {
  const { normalizedTables, registry, diagnostics } = normalizeGlobalTables(tables);
  const expenseData = buildExpenseData({
    ...normalizedTables,
    timeRealRows: [],
  });
  const groupByCanonicalId = new Map(
    registry.groups.map((group) => [group.canonicalId, group])
  );
  const projects = completeProjectsWithTimeRealRows(
    expenseData.projects.map((project) => {
      const group = groupByCanonicalId.get(toRecordId(project?.id));
      return {
        ...project,
        dop: normalizeDopValue(group?.canonicalDop),
        sourceProjectIds: [...(group?.sourceIds || [])],
        sourceProjectNames: [...(group?.sourceNames || [])],
      };
    }),
    normalizedTables.timeRealRows
  );

  return {
    ...expenseData,
    projects,
    diagnostics,
  };
}

export function filterProjectsByDop(projects, selectedDop) {
  if (selectedDop === "all") return [...(projects || [])];

  return (projects || []).filter((project) => {
    const dop = normalizeDopValue(project?.dop);
    if (selectedDop === WITHOUT_DOP_FILTER) return !dop;
    return normalizeDopKey(dop) === normalizeDopKey(selectedDop);
  });
}

export function buildAggregatedProject(projects) {
  const selectedProjects = Array.isArray(projects)
    ? projects.filter(isProjectFromProjectsTable)
    : [];
  if (!selectedProjects.length) {
    return null;
  }

  const totalBudget = selectedProjects.reduce(
    (sum, project) => sum + getProjectBudgetTotal(project),
    0
  );
  const billing = buildAggregatedBilling(selectedProjects, totalBudget);

  return {
    id: "global",
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
    globalExpenseMonthBounds: buildGlobalExpenseMonthBounds(selectedProjects),
    globalSourceProjectCount: selectedProjects.length,
    globalSourceProjectIds: selectedProjects
      .map((project) => toText(project?.id) || toText(project?.projectNumber))
      .filter(Boolean),
  };
}
