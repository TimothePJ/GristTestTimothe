import { APP_CONFIG } from "../config.js";
import {
  getMonthKeyFromRawMonth,
  toGristMonthValue,
} from "../utils/format.js";

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

async function fetchTableRows(tableName) {
  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.fetchTable !== "function") {
    throw new Error("grist.docApi.fetchTable(...) indisponible.");
  }

  const raw = await grist.docApi.fetchTable(tableName);
  return normalizeFetchTableResult(raw);
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
    projectTeamRows,
    timesheetRows,
    teamRows,
  ] = await Promise.all([
    fetchTableRows(tables.projects),
    fetchTableRows(tables.budget),
    fetchTableRows(tables.projectTeam),
    fetchTableRows(tables.timesheet),
    fetchTableRows(tables.team),
  ]);

  return {
    projectRows,
    budgetRows,
    projectTeamRows,
    timesheetRows,
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

  const originalIds = new Set(originalLines.map((line) => line.id));
  const editedIds = new Set(nextLines.map((line) => line.id).filter(Boolean));

  const toDelete = originalLines.filter((line) => !editedIds.has(line.id));
  const toAdd = nextLines.filter((line) => !line.id);
  const toUpdate = nextLines.filter((line) => line.id && originalIds.has(line.id));

  const actions = [];

  toDelete.forEach((line) => {
    actions.push(["RemoveRecord", tables.budget, line.id]);
  });

  toAdd.forEach((line) => {
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

  toUpdate.forEach((line) => {
    const original = originalLines.find((item) => item.id === line.id);
    if (!original) return;

    if (original.chapter !== line.chapter || original.amount !== line.amount) {
      actions.push([
        "UpdateRecord",
        tables.budget,
        line.id,
        {
          [columns.budget.chapter]: line.chapter,
          [columns.budget.amount]: line.amount,
        },
      ]);
    }
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
  await applyActions([
    ["RemoveRecord", APP_CONFIG.grist.tables.projectTeam, workerId],
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

    if (existingRow) {
      actions.push([
        "UpdateRecord",
        tables.timesheet,
        existingRow[columns.id],
        fields,
      ]);
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
