// Grist fetch + TimeSegment CRUD for planning-synchro.
// Ported from `gestion-depenses2/assets/js/services/gristService.js`
// (getGrist, normalizeFetchTableResult, normalizeColumnName, resolveColumnId,
// getAvailableColumnIds, fetchTableRaw, fetchTableRows, initGrist,
// createTimeSegment, updateTimeSegment, removeTimeSegment, applyActions,
// ~lines 1-146, 253-258, 311-320, 563-693) trimmed to what planning-synchro
// needs (no timeReal / timesheet / budget tables). `toReferenceId` is not
// available in this widget's utils, so it is ported locally (verbatim from
// gestion-depenses2/assets/js/utils/format.js ~lines 29-58) rather than
// imported across widget folders.
//
// `normalizeFetchTableResult` and `resolveColumnId` are pure (no top-level
// window/DOM access) and are exported for unit testing under `node --test`.
// The rest of the module only touches `window.grist` inside function bodies
// (via `getGrist()`), so the module still imports cleanly in Node.

import { APP_CONFIG } from "../config.js";
import { toText } from "../utils/dates.js";
import { toFiniteNumber } from "../utils/format.js";
import { toGristDateTimeValue } from "../utils/timeSegments.js";

const resolvedColumnCache = new Map();

const TIME_SEGMENT_COLUMN_ALIASES = {
  id: ["id"],
  projectNumber: ["NumeroProjet", "Numero_Projet", "Project_Number", "ProjectNumber"],
  name: ["Name", "Nom", "Worker_Name", "Team_Member_Name"],
  startDate: ["Start_At", "Start_Date", "StartAt", "StartDate", "Start"],
  endDate: ["End_At", "End_Date", "EndAt", "EndDate", "End"],
  allocationDays: [
    "Allocation_Days",
    "AllocationDays",
    "Allocation",
    "Days",
  ],
  effectif: ["Effectif"],
  label: ["Label", "Title"],
};

function toReferenceId(value) {
  if (value == null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const numeric = Number(value.trim());
    return Number.isInteger(numeric) ? numeric : null;
  }

  if (Array.isArray(value) && value.length > 0) {
    return toReferenceId(value[0]);
  }

  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "id")) {
      return toReferenceId(value.id);
    }
    if (Object.prototype.hasOwnProperty.call(value, "rowId")) {
      return toReferenceId(value.rowId);
    }
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return toReferenceId(value.value);
    }
  }

  return null;
}

function getGrist() {
  try {
    if (window.parent && window.parent !== window && window.parent.grist) {
      return window.parent.grist;
    }
  } catch (_error) {
    // Ignore cross-context access issues and fallback to local window.
  }

  if (!window.grist) {
    throw new Error("API Grist introuvable (window.grist).");
  }
  return window.grist;
}

export function normalizeFetchTableResult(raw) {
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

export function resolveColumnId(availableColumns, requestedColumnId, aliases = []) {
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

export async function fetchTableRows(tableName) {
  const raw = await fetchTableRaw(tableName);
  return normalizeFetchTableResult(raw);
}

async function getResolvedColumns(tableName, configuredColumns, aliasesByKey = {}) {
  const cacheKey = tableName;
  if (resolvedColumnCache.has(cacheKey)) {
    return resolvedColumnCache.get(cacheKey);
  }

  const raw = await fetchTableRaw(cacheKey);
  const availableColumns = getAvailableColumnIds(raw);

  const resolved = Object.fromEntries(
    Object.entries(configuredColumns).map(([key, requestedColumnId]) => [
      key,
      resolveColumnId(
        availableColumns,
        requestedColumnId,
        aliasesByKey[key] || []
      ),
    ])
  );

  resolvedColumnCache.set(cacheKey, resolved);
  return resolved;
}

async function getResolvedTimeSegmentColumns() {
  return getResolvedColumns(
    APP_CONFIG.grist.tables.timeSegment,
    APP_CONFIG.grist.columns.timeSegment,
    TIME_SEGMENT_COLUMN_ALIASES
  );
}

function setTimeSegmentLabelField(fields, columns, label) {
  if (
    !columns.label ||
    columns.label === columns.name ||
    columns.label === columns.projectNumber ||
    Object.prototype.hasOwnProperty.call(fields, columns.label)
  ) {
    return;
  }

  fields[columns.label] = label;
}

export function initGrist() {
  const grist = getGrist();
  if (typeof grist.ready === "function") {
    grist.ready({ requiredAccess: "full" });
  }
}

export async function applyActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return;

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  return grist.docApi.applyUserActions(actions);
}

// Grist maps `Time-Out` (hyphen) to a `Time_Out` table id; some docs also use
// `TimeOut`. Try each id in turn and keep the first that fetches without error.
async function resolveTimeOutTableId() {
  for (const id of ["Time-Out", "Time_Out", "TimeOut"]) {
    try {
      await fetchTableRows(id);
      return id;
    } catch (_e) {
      // next
    }
  }
  return "Time-Out";
}

// Charge Planning_Projet (filtre par NomProjet), TimeSegment + ProjectTeam
// (filtres par NumeroProjet) pour un projet donne. Team + Time-Out sont
// recuperes globalement (non filtres) pour construire l'index d'absences.
export async function fetchProjectData({ name, number }) {
  const t = APP_CONFIG.grist.tables;
  const timeOutTableId = await resolveTimeOutTableId();
  const [planningRows, timeSegmentRows, projectTeamRows, teamRows, timeOutRows] = await Promise.all([
    fetchTableRows(t.planningProject).catch(() => []),
    fetchTableRows(t.timeSegment).catch(() => []),
    fetchTableRows(t.projectTeam).catch(() => []),
    fetchTableRows(t.team).catch(() => []),
    fetchTableRows(timeOutTableId).catch(() => []),
  ]);
  const pc = APP_CONFIG.grist.columns;
  return {
    planningRows: planningRows.filter((r) => String(r?.[pc.planningProject.projectName] ?? "").trim() === name),
    timeSegmentRows: timeSegmentRows.filter((r) => String(r?.[pc.timeSegment.projectNumber] ?? "").trim() === String(number).trim()),
    projectTeamRows: projectTeamRows.filter((r) => String(r?.[pc.projectTeam.projectNumber] ?? "").trim() === String(number).trim()),
    // Team + Time-Out are global (unfiltered): buildAbsenceIndex maps them per-worker.
    teamRows,
    timeOutRows,
  };
}

export async function createTimeSegment({
  projectNumber,
  name,
  startDate,
  endDate,
  allocationDays,
  effectif,
  label = "",
}) {
  const tableName = APP_CONFIG.grist.tables.timeSegment;
  const columns = await getResolvedTimeSegmentColumns();
  const startValue = toGristDateTimeValue(startDate);
  const endValue = toGristDateTimeValue(endDate);
  const normalizedProjectNumber = toText(projectNumber);
  const normalizedName = toText(name);

  if (!normalizedProjectNumber || !normalizedName || startValue == null || endValue == null) {
    throw new Error("Segment invalide : numero projet, nom, date debut ou date fin manquant.");
  }

  const fields = Object.fromEntries(
    Object.entries({
      [columns.projectNumber]: normalizedProjectNumber,
      [columns.name]: normalizedName,
      [columns.startDate]: startValue,
      [columns.endDate]: endValue,
      [columns.allocationDays]: toFiniteNumber(allocationDays, 0),
      [columns.effectif]:
        effectif === undefined
          ? undefined
          : effectif === ""
          ? ""
          : toFiniteNumber(effectif, 0),
    }).filter(([, value]) => value !== undefined)
  );
  if (toText(label)) {
    setTimeSegmentLabelField(fields, columns, label);
  }

  const result = await applyActions([
    [
      "AddRecord",
      tableName,
      null,
      fields,
    ],
  ]);

  return result?.retValues?.[0] ?? null;
}

export async function updateTimeSegment({
  segmentId,
  projectNumber,
  name,
  startDate,
  endDate,
  allocationDays,
  effectif,
  label,
}) {
  const normalizedId = toReferenceId(segmentId);
  if (!normalizedId) {
    throw new Error("Segment invalide : id manquant.");
  }

  const columns = await getResolvedTimeSegmentColumns();
  const fields = {};

  if (projectNumber != null) {
    const normalizedProjectNumber = toText(projectNumber);
    if (!normalizedProjectNumber) {
      throw new Error("Numero projet invalide pour la mise a jour du segment.");
    }
    fields[columns.projectNumber] = normalizedProjectNumber;
  }

  if (name != null) {
    const normalizedName = toText(name);
    if (!normalizedName) {
      throw new Error("Nom invalide pour la mise a jour du segment.");
    }
    fields[columns.name] = normalizedName;
  }

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

  if (effectif !== undefined) {
    fields[columns.effectif] =
      effectif === "" ? "" : toFiniteNumber(effectif, 0);
  }

  if (label != null) {
    setTimeSegmentLabelField(fields, columns, label);
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
