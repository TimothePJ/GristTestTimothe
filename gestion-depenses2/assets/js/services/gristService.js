import { APP_CONFIG } from "../config.js";
import {
  getMonthKeyFromRawMonth,
  toReferenceId,
  toFiniteNumber,
  toGristMonthValue,
  toText,
} from "../utils/format.js";
import { toGristDateTimeValue } from "../utils/timeSegments.js";

const resolvedColumnCache = new Map();

const TIME_SEGMENT_COLUMN_ALIASES = {
  id: ["id"],
  projectTeamLink: [
    "ProjectTeam_Link",
    "ProjectTeamLink",
    "Project_Team_Link",
    "ProjectTeam",
  ],
  startDate: ["Start_Date", "Start_At", "StartDate", "Start"],
  endDate: ["End_Date", "End_At", "EndDate", "End"],
  segmentType: ["Segment_Type", "SegmentType", "Type"],
  allocationDays: [
    "Allocation_Days",
    "AllocationDays",
    "Allocation",
    "Days",
  ],
  label: ["Label", "Name", "Title"],
};

function getGrist() {
  if (!window.grist) {
    throw new Error("API Grist introuvable (window.grist).");
  }
  return window.grist;
}

function normalizeFetchTableResult(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;

  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];

    const maxLen = Math.max(
      ...keys.map((key) => (Array.isArray(raw[key]) ? raw[key].length : 0))
    );

    if (maxLen <= 0) return [];

    const rows = [];
    for (let index = 0; index < maxLen; index += 1) {
      const row = {};
      for (const key of keys) {
        row[key] = Array.isArray(raw[key]) ? raw[key][index] : undefined;
      }
      rows.push(row);
    }
    return rows;
  }

  return [];
}

function normalizeColumnName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveColumnId(availableColumns, requestedColumnId, aliases = []) {
  const allCandidates = [requestedColumnId, ...aliases].filter(Boolean);
  const directMatch = allCandidates.find((candidate) =>
    availableColumns.includes(candidate)
  );
  if (directMatch) {
    return directMatch;
  }

  const normalizedAvailable = new Map(
    availableColumns.map((columnId) => [normalizeColumnName(columnId), columnId])
  );

  for (const candidate of allCandidates) {
    const normalizedCandidate = normalizeColumnName(candidate);
    if (normalizedAvailable.has(normalizedCandidate)) {
      return normalizedAvailable.get(normalizedCandidate);
    }
  }

  return requestedColumnId;
}

function getAvailableColumnIds(raw) {
  if (Array.isArray(raw)) {
    return raw.length > 0 && typeof raw[0] === "object" && raw[0] != null
      ? Object.keys(raw[0])
      : [];
  }

  if (raw && typeof raw === "object") {
    return Object.keys(raw);
  }

  return [];
}

async function fetchTableRaw(tableName) {
  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.fetchTable !== "function") {
    throw new Error("grist.docApi.fetchTable(...) indisponible.");
  }

  return grist.docApi.fetchTable(tableName);
}

async function fetchTableRows(tableName) {
  const raw = await fetchTableRaw(tableName);
  return normalizeFetchTableResult(raw);
}

async function fetchOptionalTableRows(tableName) {
  if (!tableName) {
    return [];
  }

  try {
    return await fetchTableRows(tableName);
  } catch (error) {
    console.warn(`Lecture optionnelle impossible pour la table ${tableName} :`, error);
    return [];
  }
}

async function getResolvedTimeSegmentColumns() {
  const cacheKey = APP_CONFIG.grist.tables.timeSegment;
  if (resolvedColumnCache.has(cacheKey)) {
    return resolvedColumnCache.get(cacheKey);
  }

  const raw = await fetchTableRaw(cacheKey);
  const availableColumns = getAvailableColumnIds(raw);
  const configuredColumns = APP_CONFIG.grist.columns.timeSegment;

  const resolved = Object.fromEntries(
    Object.entries(configuredColumns).map(([key, requestedColumnId]) => [
      key,
      resolveColumnId(
        availableColumns,
        requestedColumnId,
        TIME_SEGMENT_COLUMN_ALIASES[key] || []
      ),
    ])
  );

  resolvedColumnCache.set(cacheKey, resolved);
  return resolved;
}

async function fetchNormalizedTimeSegmentRows() {
  const tableName = APP_CONFIG.grist.tables.timeSegment;
  const raw = await fetchTableRaw(tableName);
  const rows = normalizeFetchTableResult(raw);
  const resolvedColumns = await getResolvedTimeSegmentColumns();
  const canonicalColumns = APP_CONFIG.grist.columns.timeSegment;

  return rows.map((row) => ({
    [canonicalColumns.id]: row?.[resolvedColumns.id],
    [canonicalColumns.projectTeamLink]: row?.[resolvedColumns.projectTeamLink],
    [canonicalColumns.startDate]: row?.[resolvedColumns.startDate],
    [canonicalColumns.endDate]: row?.[resolvedColumns.endDate],
    [canonicalColumns.segmentType]: row?.[resolvedColumns.segmentType],
    [canonicalColumns.allocationDays]: row?.[resolvedColumns.allocationDays],
    [canonicalColumns.label]: row?.[resolvedColumns.label],
  }));
}

export function initGrist() {
  const grist = getGrist();
  if (typeof grist.ready === "function") {
    grist.ready({ requiredAccess: "full" });
  }
}

export async function fetchExpenseAppTables() {
  const tables = APP_CONFIG.grist.tables;
  const [
    projectRows,
    budgetRows,
    planningProjectRows,
    projectTeamRows,
    timesheetRows,
    timeSegmentRows,
    teamRows,
  ] = await Promise.all([
    fetchTableRows(tables.projects),
    fetchTableRows(tables.budget),
    fetchOptionalTableRows(tables.planningProject),
    fetchTableRows(tables.projectTeam),
    fetchTableRows(tables.timesheet),
    fetchNormalizedTimeSegmentRows(),
    fetchTableRows(tables.team),
  ]);

  return {
    projectRows,
    budgetRows,
    planningProjectRows,
    projectTeamRows,
    timesheetRows,
    timeSegmentRows,
    teamRows,
  };
}

export async function applyActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return;

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions(actions);
}

export async function createProjectWithBudget({ name, projectNumber, budgetLines }) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns;

  await applyActions([
    [
      "AddRecord",
      tables.projects,
      null,
      {
        [columns.projects.name]: name,
        [columns.projects.projectNumber]: projectNumber,
      },
    ],
  ]);

  const actions = (budgetLines || []).map((line) => [
    "AddRecord",
    tables.budget,
    null,
    {
      [columns.budget.projectNumber]: projectNumber,
      [columns.budget.chapter]: line.chapter,
      [columns.budget.amount]: line.amount,
    },
  ]);

  await applyActions(actions);
}

export async function saveBudgetChanges(project, editedLines) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns;

  const originalLines = Array.isArray(project?.budgetLines) ? project.budgetLines : [];
  const nextLines = Array.isArray(editedLines) ? editedLines : [];

  const actions = [];

  // The budget table has no explicit sort column, so we fully rewrite the rows
  // to preserve the exact visual order chosen in the modal.
  originalLines.forEach((line) => {
    actions.push(["RemoveRecord", tables.budget, line.id]);
  });

  nextLines.forEach((line) => {
    actions.push([
      "AddRecord",
      tables.budget,
      null,
      {
        [columns.budget.projectNumber]: project.projectNumber,
        [columns.budget.chapter]: line.chapter,
        [columns.budget.amount]: line.amount,
      },
    ]);
  });

  await applyActions(actions);
}

export async function addWorkerToProject(project, teamMember) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns;

  await applyActions([
    [
      "AddRecord",
      tables.projectTeam,
      null,
      {
        [columns.projectTeam.projectNumber]: project.projectNumber,
        [columns.projectTeam.role]: teamMember.role,
        [columns.projectTeam.name]: `${teamMember.firstName} ${teamMember.lastName}`.trim(),
        [columns.projectTeam.dailyRate]: 0,
      },
    ],
  ]);
}

export async function removeProjectWorker(workerId) {
  const normalizedWorkerId = toReferenceId(workerId);
  if (!normalizedWorkerId) return;

  const timeSegmentRows = await fetchNormalizedTimeSegmentRows();
  const segmentRemovals = (timeSegmentRows || [])
    .filter((row) => {
      const projectTeamLink = toReferenceId(
        row?.[APP_CONFIG.grist.columns.timeSegment.projectTeamLink]
      );
      return projectTeamLink === normalizedWorkerId;
    })
    .map((row) => [
      "RemoveRecord",
      APP_CONFIG.grist.tables.timeSegment,
      row?.[APP_CONFIG.grist.columns.timeSegment.id],
    ]);

  await applyActions([
    ...segmentRemovals,
    ["RemoveRecord", APP_CONFIG.grist.tables.projectTeam, normalizedWorkerId],
  ]);
}

export async function updateWorkerDailyRate(workerId, dailyRate) {
  await applyActions([
    [
      "UpdateRecord",
      APP_CONFIG.grist.tables.projectTeam,
      workerId,
      {
        [APP_CONFIG.grist.columns.projectTeam.dailyRate]: dailyRate,
      },
    ],
  ]);
}

function findTimesheetRecord(timesheetRows, workerId, monthKey) {
  const columns = APP_CONFIG.grist.columns.timesheet;

  return (
    timesheetRows.find((row) => {
      const rowWorkerId = Number(row?.[columns.workerId]);
      const rowMonthKey = getMonthKeyFromRawMonth(row?.[columns.month]);
      return rowWorkerId === workerId && rowMonthKey === monthKey;
    }) || null
  );
}

function buildTimesheetFields(update) {
  const columns = APP_CONFIG.grist.columns.timesheet;
  const fields = {};

  if (Object.prototype.hasOwnProperty.call(update, "provisionalDays")) {
    fields[columns.provisionalDays] = update.provisionalDays;
  }
  if (Object.prototype.hasOwnProperty.call(update, "workedDays")) {
    fields[columns.workedDays] = update.workedDays;
  }

  return fields;
}

export async function upsertTimesheetValue({ workerId, monthKey, fieldName, value }) {
  const normalizedField =
    fieldName === "workedDays" ? "workedDays" : "provisionalDays";

  return upsertTimesheetBatch({
    workerId,
    updates: [
      {
        monthKey,
        [normalizedField]: value,
      },
    ],
  });
}

export async function upsertTimesheetBatch({ workerId, updates }) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns.timesheet;
  const timesheetRows = await fetchTableRows(tables.timesheet);
  const actions = [];

  for (const update of updates || []) {
    const monthKey = toText(update?.monthKey);
    if (!monthKey) continue;

    const existingRow = findTimesheetRecord(timesheetRows, workerId, monthKey);
    const fields = buildTimesheetFields(update);
    if (!Object.keys(fields).length) continue;
    const hasNonZeroValue = Object.values(fields).some(
      (fieldValue) => toFiniteNumber(fieldValue, 0) !== 0
    );

    if (existingRow) {
      actions.push([
        "UpdateRecord",
        tables.timesheet,
        existingRow[columns.id],
        fields,
      ]);
      continue;
    }

    if (!hasNonZeroValue) {
      continue;
    }

    actions.push([
      "AddRecord",
      tables.timesheet,
      null,
      {
        [columns.workerId]: workerId,
        [columns.month]: toGristMonthValue(monthKey),
        ...fields,
      },
    ]);
  }

  await applyActions(actions);
}

export async function createTimeSegment({
  projectTeamLink,
  startDate,
  endDate,
  allocationDays,
  segmentType = "previsionnel",
  label = "",
}) {
  const tableName = APP_CONFIG.grist.tables.timeSegment;
  const columns = await getResolvedTimeSegmentColumns();
  const startValue = toGristDateTimeValue(startDate);
  const endValue = toGristDateTimeValue(endDate);

  if (!Number.isInteger(Number(projectTeamLink)) || startValue == null || endValue == null) {
    throw new Error("Segment invalide : ProjectTeam, date debut ou date fin manquant.");
  }

  await applyActions([
    [
      "AddRecord",
      tableName,
      null,
      {
        [columns.projectTeamLink]: Number(projectTeamLink),
        [columns.startDate]: startValue,
        [columns.endDate]: endValue,
        [columns.segmentType]: segmentType,
        [columns.allocationDays]: toFiniteNumber(allocationDays, 0),
        [columns.label]: label,
      },
    ],
  ]);
}

export async function updateTimeSegment({
  segmentId,
  startDate,
  endDate,
  allocationDays,
  segmentType,
  label,
}) {
  const normalizedId = toReferenceId(segmentId);
  if (!normalizedId) {
    throw new Error("Segment invalide : id manquant.");
  }

  const columns = await getResolvedTimeSegmentColumns();
  const fields = {};

  if (startDate != null) {
    const startValue = toGristDateTimeValue(startDate);
    if (startValue == null) {
      throw new Error("Date de debut invalide pour la mise a jour du segment.");
    }
    fields[columns.startDate] = startValue;
  }

  if (endDate != null) {
    const endValue = toGristDateTimeValue(endDate);
    if (endValue == null) {
      throw new Error("Date de fin invalide pour la mise a jour du segment.");
    }
    fields[columns.endDate] = endValue;
  }

  if (allocationDays != null) {
    fields[columns.allocationDays] = toFiniteNumber(allocationDays, 0);
  }

  if (segmentType != null) {
    fields[columns.segmentType] = segmentType;
  }

  if (label != null) {
    fields[columns.label] = label;
  }

  if (!Object.keys(fields).length) {
    return;
  }

  await applyActions([
    ["UpdateRecord", APP_CONFIG.grist.tables.timeSegment, normalizedId, fields],
  ]);
}

export async function removeTimeSegment(segmentId) {
  const normalizedId = toReferenceId(segmentId);
  if (!normalizedId) return;

  await applyActions([
    ["RemoveRecord", APP_CONFIG.grist.tables.timeSegment, normalizedId],
  ]);
}

export async function updateProjectBillingPercentages(projectId, billingPercentageByMonth) {
  await applyActions([
    [
      "UpdateRecord",
      APP_CONFIG.grist.tables.projects,
      projectId,
      {
        [APP_CONFIG.grist.columns.projects.billingPercentageByMonth]: JSON.stringify(
          billingPercentageByMonth || {}
        ),
      },
    ],
  ]);
}
