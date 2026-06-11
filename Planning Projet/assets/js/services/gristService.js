import { APP_CONFIG } from "../config.js";
import { normalizePlanningDocumentType } from "../../../../gestion-depenses2/assets/js/utils/planningRealisation.js";

const REFERENCES_TABLE_NAME = "References2";
const REFERENCE_EMPTY_DATE_ISO = "1900-01-01";
const REFERENCE_DATA_CHANGE_STORAGE_KEY = "grist.references-data-change";
const DAY_MS = 86400000;
const LISTEPLAN_TABLE_CANDIDATES = [
  "ListePlan_NDC_COF",
  "ListePlan NDC+COF",
  "ListePlan_NDC+COF",
];

// Cache leger pour les lignes Planning_Projet du dialog "Details".
let _planningRowsCache = null;  // tableau de lignes Planning_Projet
let _listePlanTableNameCache = "";
const PLANNING_ACTION_CHUNK_SIZE = 250;
const _planningServiceDiagnostics = {
  fetchTableCount: 0,
  actionBatchCount: 0,
  actionCount: 0,
};

export function getPlanningServiceDiagnostics() {
  return { ..._planningServiceDiagnostics };
}

function emitReferenceDataChangeSignal() {
  try {
    window.localStorage?.setItem(
      REFERENCE_DATA_CHANGE_STORAGE_KEY,
      JSON.stringify({ at: Date.now(), source: "planning-projet", nonce: Math.random() })
    );
  } catch (_error) {
    // localStorage can be unavailable in embedded contexts.
  }
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

export function initGrist() {
  const grist = getGrist();
  if (typeof grist.ready === "function") {
    grist.ready({ requiredAccess: "full" });
  }
}

function toText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (typeof value === "object") {
    if (typeof value.details === "string") return value.details.trim();
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.Name === "string") return value.Name.trim();
  }

  return String(value).trim();
}

function normalizeFetchTableResult(raw) {
  if (!raw) return [];

  // Cas 1: tableau d'objets
  if (Array.isArray(raw)) return raw;

  // Cas 2: { records: [...] }
  if (Array.isArray(raw.records)) return raw.records;

  // Cas 3: format colonnes -> tableaux
  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];

    const maxLen = Math.max(...keys.map((k) => (Array.isArray(raw[k]) ? raw[k].length : 0)));
    if (maxLen <= 0) return [];

    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const row = {};
      for (const key of keys) {
        row[key] = Array.isArray(raw[key]) ? raw[key][i] : undefined;
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

  _planningServiceDiagnostics.fetchTableCount += 1;
  const raw = await grist.docApi.fetchTable(tableName);
  return normalizeFetchTableResult(raw);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

function toInteger(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function subtractWeeksFromDate(date, weeks) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const w = toInteger(weeks);
  if (w == null || w < 0) return null;
  const d = new Date(date);
  d.setDate(d.getDate() - (w * 7));
  return d;
}

function addWeeksToDate(date, weeks) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const w = toInteger(weeks);
  if (w == null || w < 0) return null;
  const d = new Date(date);
  d.setDate(d.getDate() + (w * 7));
  return d;
}

function normalizeUtcDateToLocalCalendar(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseCalendarDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return normalizeUtcDateToLocalCalendar(value);
  }

  if (typeof value === "number") {
    const absValue = Math.abs(value);
    const n = absValue >= 86400 && absValue < 1e11 ? value * 1000 : value;
    return normalizeUtcDateToLocalCalendar(new Date(n));
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
    return null;
  }

  const frMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const d = Number(frMatch[1]);
    const m = Number(frMatch[2]);
    const y = Number(frMatch[3]);
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
    return null;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isCoffrageTypeDoc(value) {
  return String(value ?? "").toUpperCase().includes("COFFRAGE");
}

function isArmaturesTypeDoc(value) {
  return String(value ?? "").toUpperCase().includes("ARMATURES");
}

function isNdcTypeDoc(value) {
  return normalizePlanningDocumentType(value) === "NDC";
}

function isCoupesTypeDoc(value) {
  return normalizePlanningDocumentType(value) === "COUPES";
}

function isDemolitionTypeDoc(value) {
  return normalizePlanningDocumentType(value) === "DEMOLITION";
}

function normalizeZoneValueForStorage(value) {
  const text = toText(value);
  if (!text) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
}

function normalizeZoneSoftKey(value) {
  return normalizeZoneValueForStorage(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeProjectSoftKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function getLookupValueKeys(value) {
  const values = [];

  if (value && typeof value === "object" && !Array.isArray(value)) {
    [
      value.details,
      value.label,
      value.name,
      value.display,
      value.Name,
      value.id,
      value.value,
    ].forEach((candidate) => {
      const key = normalizeProjectSoftKey(candidate);
      if (key) values.push(key);
    });
  } else {
    const key = normalizeProjectSoftKey(value);
    if (key) values.push(key);
  }

  return [...new Set(values)];
}

function normalizeGroupValue(value) {
  const text = toText(value);
  return text ? text.toLocaleLowerCase("fr") : "";
}

function hasPlanningLinkValue(value) {
  const text = toText(value);
  if (!text) return false;

  const numericValue = Number(text);
  if (Number.isFinite(numericValue)) {
    return numericValue !== 0;
  }

  return true;
}

function buildGroupZoneKey(zoneValue, groupValue) {
  const groupKey = normalizeGroupValue(groupValue);
  if (!groupKey) return "";

  const zoneKey = normalizeZoneValueForStorage(zoneValue).toLocaleLowerCase("fr");
  return `${zoneKey}||${groupKey}`;
}

function projectMatchesScope(rowProjectValue, scopedProjectValue) {
  const rowProject = toText(rowProjectValue);
  const scopedProject = toText(scopedProjectValue);
  if (!scopedProject || !rowProject) return true;
  return rowProject === scopedProject;
}

function getUsedGroupNumbersForZone(rows, {
  idCol,
  zoneCol,
  groupCol,
  projectCol,
  zoneValue,
  projectValue = "",
  excludeRowIds = [],
} = {}) {
  const excludedIds = new Set(
    Array.isArray(excludeRowIds)
      ? excludeRowIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : []
  );
  const normalizedZone = normalizeZoneValueForStorage(zoneValue);
  const usedGroupNumbers = new Set();

  for (const row of rows || []) {
    const rowId = Number(row?.[idCol]);
    if (!Number.isInteger(rowId) || excludedIds.has(rowId)) continue;

    const rowZone = normalizeZoneValueForStorage(row?.[zoneCol]);
    if (rowZone !== normalizedZone) continue;

    if (!projectMatchesScope(row?.[projectCol], projectValue)) continue;

    const groupNum = Number(toText(row?.[groupCol]));
    if (Number.isInteger(groupNum) && groupNum > 0) {
      usedGroupNumbers.add(groupNum);
    }
  }

  return usedGroupNumbers;
}

function getNextAvailableGroupValue(rows, options = {}) {
  const usedGroupNumbers = getUsedGroupNumbersForZone(rows, options);
  let candidate = 1;
  while (usedGroupNumbers.has(candidate)) {
    candidate += 1;
  }
  return String(candidate);
}

function findCoffrageRowsForZoneGroup(rows, {
  idCol,
  zoneCol,
  groupCol,
  projectCol,
  typeDocCol,
  zoneValue,
  groupValue,
  projectValue = "",
  excludeRowIds = [],
} = {}) {
  const excludedIds = new Set(
    Array.isArray(excludeRowIds)
      ? excludeRowIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : []
  );
  const normalizedZone = normalizeZoneValueForStorage(zoneValue);
  const normalizedGroup = toText(groupValue);

  if (!normalizedGroup) return [];

  return (rows || []).filter((row) => {
    const rowId = Number(row?.[idCol]);
    if (!Number.isInteger(rowId) || excludedIds.has(rowId)) return false;
    if (!isCoffrageTypeDoc(row?.[typeDocCol])) return false;
    if (normalizeZoneValueForStorage(row?.[zoneCol]) !== normalizedZone) return false;
    if (toText(row?.[groupCol]) !== normalizedGroup) return false;
    if (!projectMatchesScope(row?.[projectCol], projectValue)) return false;
    return true;
  });
}

function groupHasArmaturesRow(rows, {
  idCol,
  zoneCol,
  groupCol,
  projectCol,
  typeDocCol,
  zoneValue,
  groupValue,
  projectValue = "",
  excludeRowIds = [],
} = {}) {
  const excludedIds = new Set(
    Array.isArray(excludeRowIds)
      ? excludeRowIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : []
  );
  const normalizedZone = normalizeZoneValueForStorage(zoneValue);
  const normalizedGroup = toText(groupValue);

  if (!normalizedGroup) return false;

  return (rows || []).some((row) => {
    const rowId = Number(row?.[idCol]);
    if (!Number.isInteger(rowId) || excludedIds.has(rowId)) return false;
    if (!isArmaturesTypeDoc(row?.[typeDocCol])) return false;
    if (normalizeZoneValueForStorage(row?.[zoneCol]) !== normalizedZone) return false;
    if (toText(row?.[groupCol]) !== normalizedGroup) return false;
    if (!projectMatchesScope(row?.[projectCol], projectValue)) return false;
    return true;
  });
}

function buildCoffragePlanningLinkResetActions(rows, {
  idCol,
  zoneCol,
  groupCol,
  projectCol,
  typeDocCol,
  linePlanningCol,
  nomXmlCol,
  demarrageCol,
  tableName,
  zoneValue,
  groupValue,
  projectValue = "",
  excludeRowIds = [],
} = {}) {
  const coffrageRows = findCoffrageRowsForZoneGroup(rows, {
    idCol,
    zoneCol,
    groupCol,
    projectCol,
    typeDocCol,
    zoneValue,
    groupValue,
    projectValue,
    excludeRowIds,
  });

  return coffrageRows
    .map((row) => {
      const rowId = Number(row?.[idCol]);
      if (!Number.isInteger(rowId) || rowId <= 0) return null;

      const updates = {};
      if (hasPlanningLinkValue(row?.[linePlanningCol])) {
        updates[linePlanningCol] = null;
      }

      if (nomXmlCol && toText(row?.[nomXmlCol])) {
        updates[nomXmlCol] = null;
      }

      const currentDemarrageValue = row?.[demarrageCol];
      if (currentDemarrageValue != null && toText(currentDemarrageValue) !== "") {
        updates[demarrageCol] = null;
      }

      if (!Object.keys(updates).length) return null;

      return [
        "UpdateRecord",
        tableName,
        rowId,
        updates,
      ];
    })
    .filter(Boolean);
}

function collectRowColumnNames(rows) {
  const names = new Set();
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    Object.keys(row).forEach((key) => names.add(String(key)));
  }
  return names;
}

function findFirstExistingColumnName(columnNames, candidates = [], fallback = "") {
  for (const candidate of candidates) {
    const name = String(candidate || "").trim();
    if (name && columnNames.has(name)) {
      return name;
    }
  }
  return String(fallback || candidates[0] || "").trim();
}

function normalizeLookupText(value) {
  return toText(value).toLocaleLowerCase("fr");
}

function normalizeDocumentNumberForMatch(value) {
  const text = toText(value);
  if (!text) return "";
  if (/^-?\d+$/.test(text)) {
    return String(Number(text));
  }
  return text.toLocaleLowerCase("fr");
}

function sameLookupText(left, right) {
  return normalizeLookupText(left) === normalizeLookupText(right);
}

function sameDocumentNumber(left, right) {
  return normalizeDocumentNumberForMatch(left) === normalizeDocumentNumberForMatch(right);
}

function getFirstNonEmptyRowValue(row, columnNames = []) {
  for (const columnName of columnNames) {
    const value = toText(row?.[columnName]);
    if (value) return value;
  }
  return "";
}

async function fetchFirstAvailableTable(candidates = []) {
  let lastError = null;
  const orderedCandidates = _listePlanTableNameCache
    ? [
        _listePlanTableNameCache,
        ...candidates.filter((candidate) => candidate !== _listePlanTableNameCache),
      ]
    : candidates;
  for (const candidate of orderedCandidates) {
    const tableName = String(candidate || "").trim();
    if (!tableName) continue;
    try {
      const rows = await fetchTableRows(tableName);
      if (LISTEPLAN_TABLE_CANDIDATES.includes(tableName)) {
        _listePlanTableNameCache = tableName;
      }
      return { tableName, rows };
    } catch (error) {
      if (_listePlanTableNameCache === tableName) {
        _listePlanTableNameCache = "";
      }
      lastError = error;
    }
  }
  return { tableName: "", rows: [], error: lastError };
}

function buildZoneSyncTableContext(tableName, rows, {
  projectCandidates = [],
  numberCandidates = [],
  typeCandidates = [],
  zoneCandidates = [],
  designationCandidates = [],
} = {}) {
  if (!tableName) return null;

  const columnNames = collectRowColumnNames(rows);
  return {
    tableName,
    rows: Array.isArray(rows) ? rows : [],
    projectCol: findFirstExistingColumnName(columnNames, projectCandidates, projectCandidates[0] || ""),
    numberCol: findFirstExistingColumnName(columnNames, numberCandidates, numberCandidates[0] || ""),
    typeCol: findFirstExistingColumnName(columnNames, typeCandidates, typeCandidates[0] || ""),
    zoneCol: findFirstExistingColumnName(columnNames, zoneCandidates, zoneCandidates[0] || ""),
    designationCols: designationCandidates.filter((name) => columnNames.has(name)),
  };
}

function filterMatchingRowsForZoneSync(context, change, {
  requireDesignation = true,
  sourceZoneFallbackToBlank = false,
} = {}) {
  if (!context?.tableName || !context.numberCol) return [];

  const normalizedProject = toText(change?.projectName);
  const normalizedNumber = toText(change?.numeroDocument);
  const normalizedType = toText(change?.typeDocument);
  const normalizedDesignation = toText(change?.designation);
  const normalizedSourceZone = normalizeZoneValueForStorage(change?.sourceZone);

  const baseMatches = (context.rows || []).filter((row) => {
    const rowId = Number(row?.id);
    if (!Number.isInteger(rowId) || rowId <= 0) return false;
    if (context.projectCol && normalizedProject && !sameLookupText(row?.[context.projectCol], normalizedProject)) {
      return false;
    }
    if (!sameDocumentNumber(row?.[context.numberCol], normalizedNumber)) {
      return false;
    }
    if (context.typeCol && normalizedType && !sameLookupText(row?.[context.typeCol], normalizedType)) {
      return false;
    }
    if (requireDesignation && normalizedDesignation && context.designationCols.length) {
      const rowDesignation = getFirstNonEmptyRowValue(row, context.designationCols);
      if (rowDesignation && !sameLookupText(rowDesignation, normalizedDesignation)) {
        return false;
      }
    }
    return true;
  });

  if (!baseMatches.length) return [];

  if (!context.zoneCol) {
    return baseMatches;
  }

  const exactZoneMatches = baseMatches.filter(
    (row) => normalizeZoneValueForStorage(row?.[context.zoneCol]) === normalizedSourceZone
  );
  if (exactZoneMatches.length) {
    return exactZoneMatches;
  }

  if (sourceZoneFallbackToBlank && normalizedSourceZone) {
    const blankZoneMatches = baseMatches.filter(
      (row) => normalizeZoneValueForStorage(row?.[context.zoneCol]) === ""
    );
    if (blankZoneMatches.length) {
      return blankZoneMatches;
    }
  }

  return [];
}

function buildZoneSyncActionsForTable(context, zoneChanges = []) {
  if (!context?.tableName || !context.zoneCol) return [];

  const actions = [];
  const seenRows = new Set();

  for (const change of zoneChanges) {
    const targetZone = normalizeZoneValueForStorage(change?.targetZone);

    const exactMatches = filterMatchingRowsForZoneSync(context, change, {
      requireDesignation: true,
      sourceZoneFallbackToBlank: true,
    });
    const looseMatches = exactMatches.length
      ? exactMatches
      : filterMatchingRowsForZoneSync(context, change, {
          requireDesignation: false,
          sourceZoneFallbackToBlank: true,
        });

    for (const row of looseMatches) {
      const rowId = Number(row?.id);
      if (!Number.isInteger(rowId) || rowId <= 0) continue;
      if (normalizeZoneValueForStorage(row?.[context.zoneCol]) === targetZone) continue;

      const rowKey = `${context.tableName}:${rowId}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);

      actions.push([
        "UpdateRecord",
        context.tableName,
        rowId,
        {
          [context.zoneCol]: targetZone,
        },
      ]);
    }
  }

  return actions;
}

function getPlanningSegmentStartDate(row, columns = {}) {
  const typeDoc = row?.[columns.typeDoc || "Type_doc"];
  if (isArmaturesTypeDoc(typeDoc)) {
    return parseCalendarDate(row?.[columns.diffCoffrage || "Diff_coffrage"]);
  }

  return (
    parseCalendarDate(row?.[columns.dateLimite || "Date_limite"]) ||
    parseCalendarDate(row?.[columns.diffCoffrage || "Diff_coffrage"]) ||
    parseCalendarDate(row?.[columns.demarragesTravaux || "Demarrages_travaux"])
  );
}

function isEmptyReferenceDate(date) {
  return (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime()) ||
    (
      date.getFullYear() === 1900 &&
      date.getMonth() === 0 &&
      date.getDate() === 1
    )
  );
}

function formatReferenceDateIso(value) {
  const date = parseCalendarDate(value);
  return isEmptyReferenceDate(date) ? "" : formatIsoDate(date);
}

function getReferenceCalendarMs(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function computeReferenceRetardDays(recuValue, dateLimiteValue, currentDateValue = new Date()) {
  const recuDate = parseCalendarDate(recuValue);
  const dateLimite = parseCalendarDate(dateLimiteValue);
  const currentDate = currentDateValue instanceof Date
    ? new Date(
        currentDateValue.getFullYear(),
        currentDateValue.getMonth(),
        currentDateValue.getDate()
      )
    : parseCalendarDate(currentDateValue);

  if (isEmptyReferenceDate(dateLimite)) {
    return null;
  }

  const comparisonDate = isEmptyReferenceDate(recuDate) ? currentDate : recuDate;
  if (isEmptyReferenceDate(comparisonDate)) {
    return null;
  }

  const recuMs = getReferenceCalendarMs(comparisonDate);
  const limiteMs = getReferenceCalendarMs(dateLimite);
  if (recuMs <= limiteMs) {
    return null;
  }

  return Math.floor((recuMs - limiteMs) / DAY_MS);
}

function toReferenceRetardStorageValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? String(Math.trunc(numericValue))
    : "";
}

function referenceRetardStoredValueMatches(currentValue, expectedValue) {
  return toText(currentValue) === toReferenceRetardStorageValue(expectedValue);
}

function buildChangedReferenceFields(referenceRow, fields = {}) {
  const changedFields = {};
  Object.entries(fields || {}).forEach(([fieldName, nextValue]) => {
    if (fieldName === "Bloquant") {
      if (Boolean(referenceRow?.Bloquant) !== Boolean(nextValue)) {
        changedFields[fieldName] = Boolean(nextValue);
      }
      return;
    }
    if (fieldName === "DureeLimite") {
      const currentDuration = parseReferenceDurationLimit(referenceRow?.DureeLimite);
      const nextDuration = parseReferenceDurationLimit(nextValue);
      if (currentDuration !== nextDuration) {
        changedFields[fieldName] = nextValue;
      }
      return;
    }
    if (fieldName === "DateLimite") {
      if (formatReferenceDateIso(referenceRow?.DateLimite) !== formatReferenceDateIso(nextValue)) {
        changedFields[fieldName] = nextValue;
      }
      return;
    }
    if (fieldName === "Retard") {
      if (!referenceRetardStoredValueMatches(referenceRow?.Retard, nextValue)) {
        changedFields[fieldName] = toReferenceRetardStorageValue(nextValue);
      }
      return;
    }
    if (toText(referenceRow?.[fieldName]) !== toText(nextValue)) {
      changedFields[fieldName] = nextValue;
    }
  });
  return changedFields;
}

async function syncReferenceRetardRows(referenceRows = [], currentDateValue = new Date()) {
  const actions = [];

  (Array.isArray(referenceRows) ? referenceRows : []).forEach((referenceRow) => {
    const referenceId = Number(referenceRow?.id);
    if (!Number.isInteger(referenceId) || referenceId <= 0) return;

    const nextRetard = toReferenceRetardStorageValue(
      computeReferenceRetardDays(
        referenceRow?.Recu,
        referenceRow?.DateLimite,
        currentDateValue
      )
    );
    if (referenceRetardStoredValueMatches(referenceRow?.Retard, nextRetard)) return;

    referenceRow.Retard = nextRetard;
    actions.push([
      "UpdateRecord",
      REFERENCES_TABLE_NAME,
      referenceId,
      { Retard: nextRetard },
    ]);
  });

  if (!actions.length) return 0;

  await applyUserActionsInChunks(actions);
  emitReferenceDataChangeSignal();
  return actions.length;
}

function parseReferenceDurationLimit(value) {
  const text = toText(value);
  if (!text) return null;
  const normalized = text.replace(",", ".");
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 0) {
    return null;
  }
  return numericValue;
}

function getReferenceDurationWeeksFromLimitDate(startDate, limitDate) {
  if (
    !(startDate instanceof Date) ||
    Number.isNaN(startDate.getTime()) ||
    !(limitDate instanceof Date) ||
    Number.isNaN(limitDate.getTime())
  ) {
    return null;
  }

  const startMs = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const limitMs = Date.UTC(limitDate.getFullYear(), limitDate.getMonth(), limitDate.getDate());
  const diffDays = Math.round((startMs - limitMs) / DAY_MS);
  if (diffDays < 0 || diffDays % 7 !== 0) return null;
  return diffDays / 7;
}

function buildPlanningReferenceChange(row, columns = {}) {
  return {
    projectName: row?.[columns.projectLink || columns.nomProjet || "NomProjet"],
    numeroDocument: row?.[columns.id2 || "ID2"],
    typeDocument: row?.[columns.typeDoc || "Type_doc"],
    designation: row?.[columns.taches || columns.tacheAlt || "Taches"],
    sourceZone: row?.[columns.zone || "Zone"],
  };
}

function filterReferenceRowsForPlanningRows(referenceRows = [], planningRows = [], columns = {}) {
  const targetKeys = new Set();
  (Array.isArray(planningRows) ? planningRows : []).forEach((planningRow) => {
    const change = buildPlanningReferenceChange(planningRow, columns);
    const project = normalizeLookupText(change.projectName);
    const number = normalizeDocumentNumberForMatch(change.numeroDocument);
    if (project && number) {
      targetKeys.add(`${project}||${number}`);
    }
  });
  if (!targetKeys.size) return [];

  return (Array.isArray(referenceRows) ? referenceRows : []).filter((referenceRow) => {
    const project = normalizeLookupText(
      getFirstNonEmptyRowValue(referenceRow, ["NomProjetString", "NomProjet", "Nom_projet"])
    );
    const number = normalizeDocumentNumberForMatch(referenceRow?.NumeroDocument);
    return project && number && targetKeys.has(`${project}||${number}`);
  });
}

function findLinkedReferenceRowsForPlanningRow(planningRow, referenceRows, columns = {}) {
  const context = buildZoneSyncTableContext(REFERENCES_TABLE_NAME, referenceRows, {
    projectCandidates: ["NomProjetString", "NomProjet", "Nom_projet"],
    numberCandidates: ["NumeroDocument"],
    typeCandidates: ["Type_document", "TypeDocument"],
    zoneCandidates: ["Zone"],
    designationCandidates: ["NomDocument", "Designation"],
  });
  if (!context) return [];

  const change = buildPlanningReferenceChange(planningRow, columns);
  const exactMatches = filterMatchingRowsForZoneSync(context, change, {
    requireDesignation: true,
    sourceZoneFallbackToBlank: true,
  });
  return exactMatches.length
    ? exactMatches
    : filterMatchingRowsForZoneSync(context, change, {
        requireDesignation: false,
        sourceZoneFallbackToBlank: true,
      });
}

function addReferenceLookupRow(map, key, row) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(row);
}

function buildLinkedReferenceLookup(referenceRows = []) {
  const context = buildZoneSyncTableContext(REFERENCES_TABLE_NAME, referenceRows, {
    projectCandidates: ["NomProjetString", "NomProjet", "Nom_projet"],
    numberCandidates: ["NumeroDocument"],
    typeCandidates: ["Type_document", "TypeDocument"],
    zoneCandidates: ["Zone"],
    designationCandidates: ["NomDocument", "Designation"],
  });
  if (!context) return null;

  const strict = new Map();
  const loose = new Map();
  context.rows.forEach((row) => {
    const rowId = Number(row?.id);
    if (!Number.isInteger(rowId) || rowId <= 0) return;
    const project = context.projectCol ? normalizeLookupText(row?.[context.projectCol]) : "";
    const number = normalizeDocumentNumberForMatch(row?.[context.numberCol]);
    const type = context.typeCol ? normalizeLookupText(row?.[context.typeCol]) : "";
    const designation = context.designationCols.length
      ? normalizeLookupText(getFirstNonEmptyRowValue(row, context.designationCols))
      : "";
    const zone = context.zoneCol ? normalizeZoneValueForStorage(row?.[context.zoneCol]) : "";
    addReferenceLookupRow(strict, [project, number, type, designation, zone].join("||"), row);
    addReferenceLookupRow(loose, [project, number, type, zone].join("||"), row);
  });
  return { context, strict, loose };
}

function getUniqueReferenceLookupRows(map, keys = []) {
  const rowsById = new Map();
  keys.forEach((key) => {
    (map.get(key) || []).forEach((row) => rowsById.set(Number(row.id), row));
  });
  return [...rowsById.values()];
}

function findLinkedReferenceRowsFromLookup(planningRow, lookup, columns = {}) {
  if (!lookup?.context) return [];
  const change = buildPlanningReferenceChange(planningRow, columns);
  const project = lookup.context.projectCol ? normalizeLookupText(change.projectName) : "";
  const number = normalizeDocumentNumberForMatch(change.numeroDocument);
  const type = lookup.context.typeCol ? normalizeLookupText(change.typeDocument) : "";
  const designation = lookup.context.designationCols.length
    ? normalizeLookupText(change.designation)
    : "";
  const sourceZone = lookup.context.zoneCol
    ? normalizeZoneValueForStorage(change.sourceZone)
    : "";
  const zones = sourceZone ? [sourceZone, ""] : [""];

  for (const zone of zones) {
    const strictRows = getUniqueReferenceLookupRows(lookup.strict, [
      [project, number, type, designation, zone].join("||"),
      [project, number, type, "", zone].join("||"),
    ]);
    if (strictRows.length) return strictRows;
  }
  for (const zone of zones) {
    const looseRows = getUniqueReferenceLookupRows(lookup.loose, [
      [project, number, type, zone].join("||"),
    ]);
    if (looseRows.length) return looseRows;
  }
  return [];
}

async function fetchPlanningRowById(rowId) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const idCol = columns.id || "id";
  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  const rows = _planningRowsCache ?? await fetchTableRows(table.sourceTable);
  const row = rows.find((candidate) => Number(candidate?.[idCol]) === recordId) || null;
  if (!row) {
    throw new Error("Ligne Planning_Projet introuvable.");
  }

  return { row, columns };
}

async function buildReferenceOffsetSnapshotForPlanningRow(
  planningRow,
  columns = {},
  referenceRowsOverride = null,
  referenceLookupOverride = null
) {
  const startDate = getPlanningSegmentStartDate(planningRow, columns);
  const hasValidStartDate = startDate instanceof Date && !Number.isNaN(startDate.getTime());

  const allReferenceRows = Array.isArray(referenceRowsOverride)
    ? referenceRowsOverride
    : await fetchTableRows(REFERENCES_TABLE_NAME).catch(() => []);
  const referenceRows = filterReferenceRowsForPlanningRows(allReferenceRows, [planningRow], columns);
  const linkedRows = referenceLookupOverride
    ? findLinkedReferenceRowsFromLookup(planningRow, referenceLookupOverride, columns)
    : findLinkedReferenceRowsForPlanningRow(planningRow, referenceRows, columns);
  const seenReferenceIds = new Set();
  const offsets = [];

  linkedRows.forEach((row) => {
    const referenceId = Number(row?.id);
    if (!Number.isInteger(referenceId) || referenceId <= 0 || seenReferenceIds.has(referenceId)) {
      return;
    }

    const referenceLimitDate = parseCalendarDate(row?.DateLimite);
    const durationWeeks =
      parseReferenceDurationLimit(row?.DureeLimite) ??
      (
        !hasValidStartDate || isEmptyReferenceDate(referenceLimitDate)
          ? null
          : getReferenceDurationWeeksFromLimitDate(startDate, referenceLimitDate)
      );

    if (durationWeeks == null) {
      return;
    }

    seenReferenceIds.add(referenceId);
    offsets.push({
      referenceId,
      durationWeeks,
      recuValue: row?.Recu,
      currentDateLimiteIso: formatReferenceDateIso(row?.DateLimite),
      currentDurationWeeks: parseReferenceDurationLimit(row?.DureeLimite),
      currentRetardValue: row?.Retard,
    });
  });

  return offsets.length ? { offsets } : null;
}

async function buildReferenceOffsetSnapshotsForPlanningRows(planningRows = [], columns = {}) {
  const idCol = columns.id || "id";
  const uniqueRowsById = new Map();
  (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
    const rowId = Number(row?.[idCol]);
    if (Number.isInteger(rowId) && rowId > 0 && !uniqueRowsById.has(rowId)) {
      uniqueRowsById.set(rowId, row);
    }
  });

  if (!uniqueRowsById.size) {
    return new Map();
  }

  const allReferenceRows = await fetchTableRows(REFERENCES_TABLE_NAME).catch(() => []);
  const referenceRows = filterReferenceRowsForPlanningRows(
    allReferenceRows,
    [...uniqueRowsById.values()],
    columns
  );
  const referenceLookup = buildLinkedReferenceLookup(referenceRows);
  const snapshotsByRowId = new Map();
  for (const [rowId, row] of uniqueRowsById.entries()) {
    const snapshot = await buildReferenceOffsetSnapshotForPlanningRow(
      row,
      columns,
      referenceRows,
      referenceLookup
    );
    if (snapshot?.offsets?.length) {
      snapshotsByRowId.set(rowId, snapshot);
    }
  }

  return snapshotsByRowId;
}

function buildReferenceDateLimiteSyncActions(snapshot, planningRow, columns = {}) {
  if (!snapshot?.offsets?.length) return [];

  const startDate = getPlanningSegmentStartDate(planningRow, columns);
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    return [];
  }

  return snapshot.offsets
    .map((offset) => {
      const dateLimite = subtractWeeksFromDate(startDate, offset.durationWeeks);
      const dateLimiteIso = formatIsoDate(dateLimite);
      if (!dateLimiteIso) return null;
      const nextRetard = toReferenceRetardStorageValue(
        computeReferenceRetardDays(offset.recuValue, dateLimiteIso)
      );
      const fields = {};
      if (offset.currentDateLimiteIso !== dateLimiteIso) {
        fields.DateLimite = dateLimiteIso;
      }
      if (offset.currentDurationWeeks !== offset.durationWeeks) {
        fields.DureeLimite = offset.durationWeeks;
      }
      if (!referenceRetardStoredValueMatches(offset.currentRetardValue, nextRetard)) {
        fields.Retard = nextRetard;
      }
      if (!Object.keys(fields).length) return null;

      return [
        "UpdateRecord",
        REFERENCES_TABLE_NAME,
        offset.referenceId,
        fields,
      ];
    })
    .filter(Boolean);
}

async function applyReferenceDateLimiteSyncActions(actions = []) {
  const actionsByReferenceId = new Map();
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    const referenceId = Number(action?.[2]);
    if (Number.isInteger(referenceId) && referenceId > 0) {
      actionsByReferenceId.set(referenceId, action);
    }
  });

  const dedupedActions = [...actionsByReferenceId.values()];
  if (!dedupedActions.length) return 0;

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await applyUserActionsInChunks(dedupedActions);
  _planningRowsCache = null;
  emitReferenceDataChangeSignal();
  return dedupedActions.length;
}

function isPlanningUpdateActionForTable(action, tableName) {
  return (
    Array.isArray(action) &&
    action[0] === "UpdateRecord" &&
    action[1] === tableName &&
    Number.isInteger(Number(action[2])) &&
    action[3] &&
    typeof action[3] === "object"
  );
}

async function captureReferenceDateLimiteSyncContext(
  planningRows = [],
  planningActions = [],
  tableName = "",
  columns = {}
) {
  const idCol = columns.id || "id";
  const rowById = new Map();
  (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
    const rowId = Number(row?.[idCol]);
    if (Number.isInteger(rowId) && rowId > 0) {
      rowById.set(rowId, row);
    }
  });

  const affectedRowsById = new Map();
  (Array.isArray(planningActions) ? planningActions : []).forEach((action) => {
    if (!isPlanningUpdateActionForTable(action, tableName)) return;
    const rowId = Number(action[2]);
    const row = rowById.get(rowId);
    if (row) {
      affectedRowsById.set(rowId, row);
    }
  });

  if (!affectedRowsById.size) {
    return null;
  }

  const snapshotsByRowId = await buildReferenceOffsetSnapshotsForPlanningRows(
    [...affectedRowsById.values()],
    columns
  );
  if (!snapshotsByRowId.size) {
    return null;
  }

  const mergedRowsById = new Map(
    [...affectedRowsById.entries()].map(([rowId, row]) => [rowId, { ...row }])
  );
  (Array.isArray(planningActions) ? planningActions : []).forEach((action) => {
    if (!isPlanningUpdateActionForTable(action, tableName)) return;
    const rowId = Number(action[2]);
    const currentMergedRow = mergedRowsById.get(rowId);
    if (!currentMergedRow) return;
    mergedRowsById.set(rowId, {
      ...currentMergedRow,
      ...(action[3] || {}),
    });
  });

  return {
    snapshotsByRowId,
    mergedRowsById,
  };
}

async function syncReferenceDateLimitesFromContext(context, columns = {}) {
  if (!context?.snapshotsByRowId?.size || !context?.mergedRowsById?.size) {
    return 0;
  }

  const actions = [];
  context.snapshotsByRowId.forEach((snapshot, rowId) => {
    const planningRow = context.mergedRowsById.get(rowId);
    if (!planningRow) return;
    actions.push(...buildReferenceDateLimiteSyncActions(snapshot, planningRow, columns));
  });

  return applyReferenceDateLimiteSyncActions(actions);
}

async function buildExternalZoneSyncActionsForPlanningChanges(zoneChanges = []) {
  const normalizedChanges = (zoneChanges || [])
    .map((change) => ({
      projectName: toText(change?.projectName),
      numeroDocument: toText(change?.numeroDocument),
      typeDocument: toText(change?.typeDocument),
      designation: toText(change?.designation),
      sourceZone: normalizeZoneValueForStorage(change?.sourceZone),
      targetZone: normalizeZoneValueForStorage(change?.targetZone),
    }))
    .filter((change) =>
      change.projectName &&
      change.numeroDocument &&
      change.typeDocument &&
      change.sourceZone !== change.targetZone
    );

  if (!normalizedChanges.length) {
    return [];
  }

  const uniqueChanges = [];
  const seenChanges = new Set();
  normalizedChanges.forEach((change) => {
    const key = [
      normalizeLookupText(change.projectName),
      normalizeDocumentNumberForMatch(change.numeroDocument),
      normalizeLookupText(change.typeDocument),
      normalizeLookupText(change.designation),
      normalizeLookupText(change.sourceZone),
      normalizeLookupText(change.targetZone),
    ].join("||");
    if (seenChanges.has(key)) return;
    seenChanges.add(key);
    uniqueChanges.push(change);
  });

  const [referencesResult, listePlanResult] = await Promise.all([
    fetchTableRows(REFERENCES_TABLE_NAME)
      .then((rows) => ({ tableName: REFERENCES_TABLE_NAME, rows }))
      .catch((error) => ({ tableName: "", rows: [], error })),
    fetchFirstAvailableTable(LISTEPLAN_TABLE_CANDIDATES),
  ]);

  const contexts = [
    buildZoneSyncTableContext(referencesResult.tableName, referencesResult.rows, {
      projectCandidates: ["NomProjetString", "NomProjet", "Nom_projet"],
      numberCandidates: ["NumeroDocument"],
      typeCandidates: ["Type_document", "TypeDocument"],
      zoneCandidates: ["Zone"],
      designationCandidates: ["NomDocument", "Designation"],
    }),
    buildZoneSyncTableContext(listePlanResult.tableName, listePlanResult.rows, {
      projectCandidates: ["Nom_projet", "NomProjet"],
      numberCandidates: ["NumeroDocument"],
      typeCandidates: ["Type_document", "Type_doc"],
      zoneCandidates: ["Zone"],
      designationCandidates: ["Designation", "NomDocument"],
    }),
  ].filter(Boolean);

  return contexts.flatMap((context) =>
    buildZoneSyncActionsForTable(context, uniqueChanges)
  );
}

async function buildProjectAliasKeys(projectName) {
  const aliases = new Set(getLookupValueKeys(projectName));
  const table = APP_CONFIG.grist.projectsTable;
  if (!table?.sourceTable) {
    return aliases;
  }

  try {
    const rows = await fetchTableRows(table.sourceTable);
    const columns = table.columns || {};
    const projectCol = String(columns.project || "Nom_de_projet").trim();
    const projectNumberCol = String(columns.projectNumber || "Numero_de_projet").trim();
    const projectKey = normalizeProjectSoftKey(projectName);

    for (const row of rows || []) {
      const rowProjectKeys = getLookupValueKeys(row?.[projectCol]);
      if (!rowProjectKeys.includes(projectKey)) continue;

      [
        row?.id,
        row?.[projectCol],
        row?.[projectNumberCol],
        row?.NomProjet,
        row?.Nom_de_projet,
        row?.NumeroProjet,
        row?.Numero_de_projet,
      ].forEach((value) => {
        getLookupValueKeys(value).forEach((key) => aliases.add(key));
      });
    }
  } catch (error) {
    console.warn("Impossible de charger les alias projet pour la gestion de zone :", error);
  }

  return aliases;
}

function buildManageZoneTableContext(tableName, rows, {
  projectCandidates = [],
  zoneCandidates = [],
  id2Candidates = [],
  taskCandidates = [],
  typeCandidates = [],
  planning = false,
} = {}) {
  if (!tableName) return null;
  const columnNames = collectRowColumnNames(rows);

  return {
    tableName,
    rows: Array.isArray(rows) ? rows : [],
    projectCol: findFirstExistingColumnName(columnNames, projectCandidates, projectCandidates[0] || ""),
    zoneCol: findFirstExistingColumnName(columnNames, zoneCandidates, zoneCandidates[0] || ""),
    id2Col: findFirstExistingColumnName(columnNames, id2Candidates, id2Candidates[0] || ""),
    taskCols: taskCandidates.filter((candidate) => columnNames.has(candidate)),
    typeCol: findFirstExistingColumnName(columnNames, typeCandidates, typeCandidates[0] || ""),
    planning,
  };
}

function rowMatchesProjectAlias(row, projectCol, projectAliasKeys) {
  if (!projectCol) return false;
  const keys = getLookupValueKeys(row?.[projectCol]);
  return keys.some((key) => projectAliasKeys.has(key));
}

function rowMatchesZoneSoftKey(row, zoneCol, sourceZoneKey) {
  if (!zoneCol || !sourceZoneKey) return false;
  return normalizeZoneSoftKey(row?.[zoneCol]) === sourceZoneKey;
}

function isEmptyPlanningZoneAnchorRow(row, context) {
  if (!context?.planning) return false;
  if (context.id2Col && toText(row?.[context.id2Col])) return false;
  if (context.typeCol && toText(row?.[context.typeCol])) return false;

  const taskCols = Array.isArray(context.taskCols) ? context.taskCols : [];
  if (!taskCols.length) {
    return false;
  }

  return taskCols.every((columnName) => !toText(row?.[columnName]));
}

async function fetchManageZoneContexts() {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const [planningRows, referencesResult, listePlanResult] = await Promise.all([
    fetchTableRows(table.sourceTable),
    fetchTableRows(REFERENCES_TABLE_NAME)
      .then((rows) => ({ tableName: REFERENCES_TABLE_NAME, rows }))
      .catch((error) => ({ tableName: "", rows: [], error })),
    fetchFirstAvailableTable(LISTEPLAN_TABLE_CANDIDATES),
  ]);

  return [
    buildManageZoneTableContext(table.sourceTable, planningRows, {
      projectCandidates: [
        columns.projectLink,
        columns.nomProjet,
        "NomProjet",
        "Nom_projet",
      ],
      zoneCandidates: [columns.zone, "Zone"],
      id2Candidates: [columns.id2, "ID2", "NumeroDocument"],
      taskCandidates: [columns.taches, columns.tacheAlt, "Taches", "Tache"],
      typeCandidates: [columns.typeDoc, "Type_doc", "Type_document", "TypeDoc"],
      planning: true,
    }),
    buildManageZoneTableContext(referencesResult.tableName, referencesResult.rows, {
      projectCandidates: ["NomProjetString", "NomProjet", "Nom_projet"],
      zoneCandidates: ["Zone"],
    }),
    buildManageZoneTableContext(listePlanResult.tableName, listePlanResult.rows, {
      projectCandidates: ["Nom_projet", "NomProjet", "NomProjetString"],
      zoneCandidates: ["Zone"],
    }),
  ].filter(Boolean);
}

function assertProjectZoneInput({ projectName, sourceZone, targetZone = null }) {
  const normalizedProject = toText(projectName);
  const normalizedSourceZone = normalizeZoneValueForStorage(sourceZone);
  const normalizedTargetZone =
    targetZone == null ? null : normalizeZoneValueForStorage(targetZone);

  if (!normalizedProject) {
    throw new Error("Projet obligatoire pour modifier une zone.");
  }
  if (!normalizedSourceZone) {
    throw new Error("Zone source obligatoire.");
  }
  if (targetZone != null && !normalizedTargetZone) {
    throw new Error("Nouveau nom de zone obligatoire.");
  }

  return {
    normalizedProject,
    normalizedSourceZone,
    normalizedTargetZone,
    sourceZoneKey: normalizeZoneSoftKey(normalizedSourceZone),
    targetZoneKey:
      targetZone == null ? null : normalizeZoneSoftKey(normalizedTargetZone),
  };
}

function buildProjectZoneActions({
  contexts,
  projectAliasKeys,
  sourceZoneKey,
  targetZone,
  removeAnchors = false,
}) {
  const actions = [];
  const seenRows = new Set();

  for (const context of contexts || []) {
    if (!context?.tableName || !context.zoneCol || !context.projectCol) continue;

    for (const row of context.rows || []) {
      const rowId = Number(row?.id);
      if (!Number.isInteger(rowId) || rowId <= 0) continue;
      if (!rowMatchesProjectAlias(row, context.projectCol, projectAliasKeys)) continue;
      if (!rowMatchesZoneSoftKey(row, context.zoneCol, sourceZoneKey)) continue;

      const rowKey = `${context.tableName}:${rowId}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);

      if (removeAnchors && isEmptyPlanningZoneAnchorRow(row, context)) {
        actions.push(["RemoveRecord", context.tableName, rowId]);
        continue;
      }

      const normalizedTarget = normalizeZoneValueForStorage(targetZone);
      if (normalizeZoneValueForStorage(row?.[context.zoneCol]) === normalizedTarget) {
        continue;
      }

      actions.push([
        "UpdateRecord",
        context.tableName,
        rowId,
        {
          [context.zoneCol]: normalizedTarget,
        },
      ]);
    }
  }

  return actions;
}

function countProjectZoneActions(actions = []) {
  return actions.reduce(
    (counts, action) => {
      const actionType = action?.[0];
      const tableName = String(action?.[1] || "");
      if (actionType === "RemoveRecord") {
        counts.deletedCount += 1;
      } else if (actionType === "UpdateRecord") {
        counts.updatedCount += 1;
      }

      if (tableName === REFERENCES_TABLE_NAME) {
        counts.referencesUpdatedCount += 1;
      } else if (LISTEPLAN_TABLE_CANDIDATES.includes(tableName)) {
        counts.listePlanUpdatedCount += 1;
      } else if (tableName === APP_CONFIG.grist.planningTable?.sourceTable) {
        if (actionType === "RemoveRecord") {
          counts.planningDeletedCount += 1;
        } else {
          counts.planningUpdatedCount += 1;
        }
      }

      return counts;
    },
    {
      updatedCount: 0,
      deletedCount: 0,
      planningUpdatedCount: 0,
      planningDeletedCount: 0,
      referencesUpdatedCount: 0,
      listePlanUpdatedCount: 0,
    }
  );
}

function ensureNoProjectZoneDuplicate({
  contexts,
  projectAliasKeys,
  sourceZoneKey,
  targetZoneKey,
}) {
  if (!targetZoneKey || targetZoneKey === sourceZoneKey) return;

  for (const context of contexts || []) {
    if (!context?.projectCol || !context.zoneCol) continue;

    for (const row of context.rows || []) {
      if (!rowMatchesProjectAlias(row, context.projectCol, projectAliasKeys)) continue;

      const zoneKey = normalizeZoneSoftKey(row?.[context.zoneCol]);
      if (zoneKey && zoneKey === targetZoneKey) {
        throw new Error("Une zone avec ce nom existe deja pour ce projet.");
      }
    }
  }
}

export async function renameProjectZone({
  projectName,
  sourceZone,
  targetZone,
}) {
  const {
    normalizedProject,
    normalizedSourceZone,
    normalizedTargetZone,
    sourceZoneKey,
    targetZoneKey,
  } = assertProjectZoneInput({ projectName, sourceZone, targetZone });

  if (!sourceZoneKey || !targetZoneKey) {
    throw new Error("Nom de zone invalide.");
  }

  const [projectAliasKeys, contexts] = await Promise.all([
    buildProjectAliasKeys(normalizedProject),
    fetchManageZoneContexts(),
  ]);

  ensureNoProjectZoneDuplicate({
    contexts,
    projectAliasKeys,
    sourceZoneKey,
    targetZoneKey,
  });

  const actions = buildProjectZoneActions({
    contexts,
    projectAliasKeys,
    sourceZoneKey,
    targetZone: normalizedTargetZone,
    removeAnchors: false,
  });

  if (!actions.length) {
    return {
      updated: false,
      sourceZone: normalizedSourceZone,
      targetZone: normalizedTargetZone,
      ...countProjectZoneActions(actions),
    };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await applyUserActionsInChunks(actions);

  return {
    updated: true,
    sourceZone: normalizedSourceZone,
    targetZone: normalizedTargetZone,
    ...countProjectZoneActions(actions),
  };
}

export async function clearProjectZone({
  projectName,
  sourceZone,
}) {
  const {
    normalizedProject,
    normalizedSourceZone,
    sourceZoneKey,
  } = assertProjectZoneInput({ projectName, sourceZone });

  if (!sourceZoneKey) {
    throw new Error("Zone source invalide.");
  }

  const [projectAliasKeys, contexts] = await Promise.all([
    buildProjectAliasKeys(normalizedProject),
    fetchManageZoneContexts(),
  ]);

  const actions = buildProjectZoneActions({
    contexts,
    projectAliasKeys,
    sourceZoneKey,
    targetZone: "",
    removeAnchors: true,
  });

  if (!actions.length) {
    return {
      updated: false,
      sourceZone: normalizedSourceZone,
      ...countProjectZoneActions(actions),
    };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await applyUserActionsInChunks(actions);

  return {
    updated: true,
    sourceZone: normalizedSourceZone,
    ...countProjectZoneActions(actions),
  };
}

export function buildCoffrageDiffCoffrageUpdates(planningRows, selectedProject = "") {
  const table = APP_CONFIG.grist.planningTable;
  const columns = table?.columns || {};

  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const idCol = columns.id || "id";
  const groupCol = columns.groupe || "Groupe";
  const zoneCol = columns.zone || "Zone";
  const typeDocCol = columns.typeDoc || "Type_doc";
  const diffCoffrageCol = columns.diffCoffrage || "Diff_coffrage";
  const dateLimiteCol = columns.dateLimite || "Date_limite";
  const duree1Col = columns.duree1 || "Duree_1";
  const linePlanningCol = columns.lignePlanning || "Ligne_planning";
  const projectCol = columns.projectLink || columns.nomProjet || "NomProjet";

  const rows = Array.isArray(planningRows) ? planningRows : [];
  if (!rows.length) {
    return { updates: [], rows, matchedCoffrageCount: 0, skipped: true };
  }

  const selectedProjectText = toText(selectedProject);
  if (!selectedProjectText) {
    return { updates: [], rows, matchedCoffrageCount: 0, skipped: true };
  }

  const scopedRows = rows.filter((row) => {
    return toText(row?.[projectCol]) === selectedProjectText;
  });

  if (!scopedRows.length) {
    return { updates: [], rows, matchedCoffrageCount: 0, skipped: true };
  }

  const minArmatureDiffByGroup = new Map();
  scopedRows.forEach((row) => {
    const groupZoneKey = buildGroupZoneKey(row?.[zoneCol], row?.[groupCol]);
    if (!groupZoneKey) return;
    if (!isArmaturesTypeDoc(row?.[typeDocCol])) return;

    const diffDate = parseCalendarDate(row?.[diffCoffrageCol]);
    if (!diffDate) return;

    const currentMin = minArmatureDiffByGroup.get(groupZoneKey);
    if (!currentMin || diffDate < currentMin) {
      minArmatureDiffByGroup.set(groupZoneKey, diffDate);
    }
  });

  const derivedUpdates = [];
  let matchedCoffrageCount = 0;

  scopedRows.forEach((row) => {
    const groupZoneKey = buildGroupZoneKey(row?.[zoneCol], row?.[groupCol]);
    if (!groupZoneKey) return;
    if (!isCoffrageTypeDoc(row?.[typeDocCol])) return;
    if (hasPlanningLinkValue(row?.[linePlanningCol])) return;

    const targetDate = minArmatureDiffByGroup.get(groupZoneKey);
    if (!targetDate) return;

    matchedCoffrageCount += 1;

    const recordId = Number(row?.[idCol]);
    if (!Number.isInteger(recordId) || recordId <= 0) return;

    const targetIso = formatIsoDate(targetDate);
    if (!targetIso) return;

    const updates = {};
    const currentIso = formatIsoDate(parseCalendarDate(row?.[diffCoffrageCol]));
    if (currentIso !== targetIso) {
      updates[diffCoffrageCol] = targetIso;
    }

    const duree1Weeks = toInteger(row?.[duree1Col]);
    if (duree1Weeks != null && duree1Weeks >= 0) {
      const computedDateLimite = subtractWeeksFromDate(targetDate, duree1Weeks);
      const computedDateLimiteIso = formatIsoDate(computedDateLimite);
      if (computedDateLimiteIso) {
        const currentDateLimiteIso = formatIsoDate(parseCalendarDate(row?.[dateLimiteCol]));
        if (currentDateLimiteIso !== computedDateLimiteIso) {
          updates[dateLimiteCol] = computedDateLimiteIso;
        }
      }
    }

    if (!Object.keys(updates).length) return;

    derivedUpdates.push({ id: recordId, fields: updates });
  });

  const fieldsById = new Map(
    derivedUpdates.map((update) => [Number(update.id), update.fields])
  );
  const mergedRows = fieldsById.size
    ? rows.map((row) => {
        const fields = fieldsById.get(Number(row?.[idCol]));
        return fields ? { ...row, ...fields } : row;
      })
    : rows;

  return {
    updates: derivedUpdates,
    rows: mergedRows,
    matchedCoffrageCount,
    skipped: false,
  };
}

function buildPlanningComputedActions(updates = []) {
  const table = APP_CONFIG.grist.planningTable;
  const columns = table?.columns || {};
  const indiceCol = String(columns.indice || "Indice").trim();
  const realiseCol = String(columns.realise || "Realise").trim();
  const dateRealiseCol = String(columns.dateRealise || "Date_Realise").trim();
  const retardsCol = String(columns.retards || "Retards").trim();
  const fieldsById = new Map();

  (Array.isArray(updates) ? updates : []).forEach((update) => {
    const rowId = Number(update?.id);
    if (!Number.isInteger(rowId) || rowId <= 0) return;

    const fields = {
      ...(fieldsById.get(rowId) || {}),
      ...(update?.fields && typeof update.fields === "object" ? update.fields : {}),
    };

    if (Object.prototype.hasOwnProperty.call(update, "indice")) {
      fields[indiceCol] = toText(update.indice);
    }
    if (
      Object.prototype.hasOwnProperty.call(update, "realise") &&
      (update.realise == null || Number.isFinite(Number(update.realise)))
    ) {
      fields[realiseCol] = update.realise == null ? null : Number(update.realise);
    }
    if (Object.prototype.hasOwnProperty.call(update, "dateRealise")) {
      fields[dateRealiseCol] = update.dateRealise || null;
    }
    if (
      Object.prototype.hasOwnProperty.call(update, "retards") &&
      (update.retards == null || Number.isFinite(Number(update.retards)))
    ) {
      fields[retardsCol] = update.retards == null ? null : Number(update.retards);
    }

    if (Object.keys(fields).length) {
      fieldsById.set(rowId, fields);
    }
  });

  return [...fieldsById.entries()].map(([rowId, fields]) => [
    "UpdateRecord",
    table.sourceTable,
    rowId,
    fields,
  ]);
}

async function applyUserActionsInChunks(actions = []) {
  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  for (let offset = 0; offset < actions.length; offset += PLANNING_ACTION_CHUNK_SIZE) {
    const chunk = actions.slice(offset, offset + PLANNING_ACTION_CHUNK_SIZE);
    _planningServiceDiagnostics.actionBatchCount += 1;
    _planningServiceDiagnostics.actionCount += chunk.length;
    await grist.docApi.applyUserActions(
      chunk
    );
  }
}

export async function syncPlanningDerivedValues({
  planningRows = [],
  updates = [],
} = {}) {
  const table = APP_CONFIG.grist.planningTable;
  const columns = table?.columns || {};
  const actions = buildPlanningComputedActions(updates);
  if (!actions.length) {
    return { updatedCount: 0, referenceDateLimiteUpdatedCount: 0 };
  }

  const referenceDateFields = new Set([
    columns.dateLimite || "Date_limite",
    columns.diffCoffrage || "Diff_coffrage",
    columns.diffArmature || "Diff_armature",
    columns.demarragesTravaux || "Demarrages_travaux",
  ]);
  const referenceRelevantActions = actions.filter((action) =>
    Object.keys(action?.[3] || {}).some((fieldName) => referenceDateFields.has(fieldName))
  );
  const referenceSyncContext = await captureReferenceDateLimiteSyncContext(
    planningRows,
    referenceRelevantActions,
    table.sourceTable,
    columns
  );

  await applyUserActionsInChunks(actions);
  const referenceDateLimiteUpdatedCount = await syncReferenceDateLimitesFromContext(
    referenceSyncContext,
    columns
  );
  _planningRowsCache = null;
  return {
    updatedCount: actions.length,
    referenceDateLimiteUpdatedCount,
  };
}

export async function updatePlanningDurationAndLeftDate(
  rowId,
  durationColumnName,
  durationValue,
  leftDateColumnName,
  leftIsoDate
) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  const durationField = String(durationColumnName ?? "").trim();
  if (!durationField) {
    throw new Error("Colonne durée invalide.");
  }

  const leftDateField = String(leftDateColumnName ?? "").trim();
  if (!leftDateField) {
    throw new Error("Colonne date de gauche invalide.");
  }

  if (!Number.isFinite(Number(durationValue))) {
    throw new Error("Valeur de durée invalide.");
  }

  const normalizedLeftIsoDate = String(leftIsoDate ?? "").trim();
  if (!isIsoDate(normalizedLeftIsoDate)) {
    throw new Error("Format de date invalide (attendu YYYY-MM-DD).");
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const idCol = columns.id || "id";
  const typeDocCol = columns.typeDoc || "Type_doc";
  const dateLimiteCol = columns.dateLimite || "Date_limite";
  const duree1Col = columns.duree1 || "Duree_1";
  const diffCoffrageCol = columns.diffCoffrage || "Diff_coffrage";
  const duree2Col = columns.duree2 || "Duree_2";
  const diffArmatureCol = columns.diffArmature || "Diff_armature";
  const duree3Col = columns.duree3 || "Duree_3";
  const demarrageCol = columns.demarragesTravaux || "Demarrages_travaux";

  const updates = {
    [durationField]: Number(durationValue),
    [leftDateField]: normalizedLeftIsoDate,
  };

  let currentRow = null;
  try {
    const rows = await fetchTableRows(table.sourceTable);
    currentRow = rows.find((row) => Number(row?.[idCol]) === recordId) || null;
  } catch (error) {
    console.warn("Impossible de relire la ligne planning pour recalcul auto des dates :", error);
  }

  if (currentRow) {
    const typeDoc = String(currentRow[typeDocCol] ?? "").toUpperCase();
    const isNdc = isNdcTypeDoc(currentRow[typeDocCol]);

    if (typeDoc.includes("ARMATURES")) {
      const finalDuree2 = durationField === duree2Col
        ? toInteger(durationValue)
        : toInteger(currentRow[duree2Col]);
      const finalDuree3 = durationField === duree3Col
        ? toInteger(durationValue)
        : toInteger(currentRow[duree3Col]);

      let diffArmatureDate = leftDateField === diffArmatureCol
        ? parseCalendarDate(normalizedLeftIsoDate)
        : parseCalendarDate(currentRow[diffArmatureCol]);

      const demarrageDate = parseCalendarDate(currentRow[demarrageCol]);
      const shouldRecomputeDiffArmature =
        durationField === duree3Col || leftDateField === diffArmatureCol;
      if (shouldRecomputeDiffArmature && demarrageDate && finalDuree3 != null && finalDuree3 >= 0) {
        const computedDiffArmature = subtractWeeksFromDate(demarrageDate, finalDuree3);
        const computedIso = formatIsoDate(computedDiffArmature);
        if (computedIso) {
          updates[diffArmatureCol] = computedIso;
          diffArmatureDate = computedDiffArmature;
        }
      }

      if (diffArmatureDate && finalDuree2 != null && finalDuree2 >= 0) {
        const computedDiffCoffrage = subtractWeeksFromDate(diffArmatureDate, finalDuree2);
        const computedIso = formatIsoDate(computedDiffCoffrage);
        if (computedIso) {
          updates[diffCoffrageCol] = computedIso;
        }
      }
    } else if (typeDoc.includes("COFFRAGE") || isNdc) {
      const finalDuree1 = durationField === duree1Col
        ? toInteger(durationValue)
        : toInteger(currentRow[duree1Col]);
      const finalDuree3 = durationField === duree3Col
        ? toInteger(durationValue)
        : toInteger(currentRow[duree3Col]);
      const demarrageDate = parseCalendarDate(currentRow[demarrageCol]);
      let diffCoffrageDate = leftDateField === diffCoffrageCol
        ? parseCalendarDate(normalizedLeftIsoDate)
        : parseCalendarDate(currentRow[diffCoffrageCol]);
      const shouldRecomputeDiffCoffrage =
        durationField === duree3Col || leftDateField === diffCoffrageCol;

      if (
        demarrageDate &&
        finalDuree3 != null &&
        finalDuree3 >= 0 &&
        (shouldRecomputeDiffCoffrage || !diffCoffrageDate)
      ) {
        const computedDiffCoffrage = subtractWeeksFromDate(demarrageDate, finalDuree3);
        const computedIso = formatIsoDate(computedDiffCoffrage);
        if (computedIso) {
          updates[diffCoffrageCol] = computedIso;
          diffCoffrageDate = computedDiffCoffrage;
        }
      }

      if (diffCoffrageDate && finalDuree1 != null && finalDuree1 >= 0) {
        const computedDateLimite = subtractWeeksFromDate(diffCoffrageDate, finalDuree1);
        const computedIso = formatIsoDate(computedDateLimite);
        if (computedIso) {
          updates[dateLimiteCol] = computedIso;
        }
      }
    }
  }

  const actions = [
    [
      "UpdateRecord",
      table.sourceTable,
      recordId,
      updates,
    ],
  ];
  const referenceSyncContext = await captureReferenceDateLimiteSyncContext(
    currentRow ? [currentRow] : [],
    actions,
    table.sourceTable,
    columns
  );

  await applyUserActionsInChunks(actions);
  const referenceDateLimiteUpdatedCount = await syncReferenceDateLimitesFromContext(
    referenceSyncContext,
    columns
  );

  return {
    updatedCount: 1,
    referenceDateLimiteUpdatedCount,
  };
}

export async function updatePlanningLignePlanning(rowId, lignePlanningValue) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  const lignePlanningField = String(columns.lignePlanning || "Ligne_planning").trim();
  if (!lignePlanningField) {
    throw new Error("Colonne Ligne_planning invalide.");
  }

  const normalizedValue = toText(lignePlanningValue);
  if (!normalizedValue) {
    throw new Error("Numero unique MS Project vide.");
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      table.sourceTable,
      recordId,
      { [lignePlanningField]: normalizedValue },
    ],
  ]);
}

export async function updatePlanningFromMsProjectDrop({
  rowId,
  uniqueNumber,
  xmlName = "",
  msStartIso = "",
  msEndIso = "",
}) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  const normalizedUniqueNumber = toText(uniqueNumber);
  if (!normalizedUniqueNumber) {
    throw new Error("Numero unique MS Project vide.");
  }

  const lignePlanningField = String(columns.lignePlanning || "Ligne_planning").trim();
  const nomXmlField = String(columns.nomXml || "Nom_XML").trim();
  const idCol = columns.id || "id";
  const groupCol = String(columns.groupe || "Groupe").trim();
  const zoneCol = String(columns.zone || "Zone").trim();
  const typeDocCol = columns.typeDoc || "Type_doc";
  const projectCol = String(columns.projectLink || columns.nomProjet || "NomProjet").trim();
  const dateLimiteCol = columns.dateLimite || "Date_limite";
  const duree1Col = columns.duree1 || "Duree_1";
  const diffCoffrageCol = columns.diffCoffrage || "Diff_coffrage";
  const duree2Col = columns.duree2 || "Duree_2";
  const diffArmatureCol = columns.diffArmature || "Diff_armature";
  const duree3Col = columns.duree3 || "Duree_3";
  const demarrageCol = columns.demarragesTravaux || "Demarrages_travaux";

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const rows = await fetchTableRows(table.sourceTable);
  const currentRow = rows.find((row) => Number(row?.[idCol]) === recordId) || null;
  if (!currentRow) {
    throw new Error("Ligne Planning_Projet introuvable.");
  }
  const typeDoc = String(currentRow[typeDocCol] ?? "").toUpperCase();
  const isNdc = isNdcTypeDoc(currentRow[typeDocCol]);
  const isCoupes = isCoupesTypeDoc(currentRow[typeDocCol]);
  const isDemolition = isDemolitionTypeDoc(currentRow[typeDocCol]);
  const isNdcLike = isNdc || isCoupes || isDemolition;
  const currentGroup = toText(currentRow[groupCol]);
  const currentZone = normalizeZoneValueForStorage(currentRow[zoneCol]);
  const currentProject = toText(currentRow[projectCol]);
  const droppedStartDate = parseCalendarDate(msStartIso);
  const droppedEndDate = parseCalendarDate(msEndIso);
  const droppedStartIso = formatIsoDate(droppedStartDate);
  const droppedEndIso = formatIsoDate(droppedEndDate);

  const updates = {
    [lignePlanningField]: normalizedUniqueNumber,
  };
  if (nomXmlField) {
    updates[nomXmlField] = toText(xmlName);
  }

  if (isCoffrageTypeDoc(typeDoc) || isNdcLike) {
    let demarrageDate = droppedStartDate || parseCalendarDate(currentRow[demarrageCol]);
    let diffCoffrageDate = parseCalendarDate(currentRow[diffCoffrageCol]);
    let dateLimiteDate = parseCalendarDate(currentRow[dateLimiteCol]);
    const duree1 = toInteger(currentRow[duree1Col]);
    const duree3 = toInteger(currentRow[duree3Col]);

    // COFFRAGE/NDC lie a MS Project:
    // Demarrage travaux = Debut MS Project
    // Diff_coffrage = Demarrage travaux - Duree_3
    // Date_limite = Diff_coffrage - Duree_1
    if (demarrageDate && duree3 != null && duree3 >= 0) {
      diffCoffrageDate = subtractWeeksFromDate(demarrageDate, duree3);
    } else if (!diffCoffrageDate && droppedEndDate) {
      diffCoffrageDate = droppedEndDate;
    }

    if (diffCoffrageDate && duree1 != null && duree1 >= 0) {
      dateLimiteDate = subtractWeeksFromDate(diffCoffrageDate, duree1);
    } else if (droppedStartIso) {
      updates[dateLimiteCol] = droppedStartIso;
    }

    const computedDemarrageIso = formatIsoDate(demarrageDate);
    const computedDateLimiteIso = formatIsoDate(dateLimiteDate);
    const computedDiffCoffrageIso = formatIsoDate(diffCoffrageDate);
    if (computedDemarrageIso) updates[demarrageCol] = computedDemarrageIso;
    if (computedDateLimiteIso) updates[dateLimiteCol] = computedDateLimiteIso;
    if (computedDiffCoffrageIso) updates[diffCoffrageCol] = computedDiffCoffrageIso;
    if (isNdcLike && groupCol) updates[groupCol] = "";
  } else if (isArmaturesTypeDoc(typeDoc)) {
    let demarrageDate =
      droppedStartDate ||
      parseCalendarDate(currentRow[demarrageCol]);
    let diffArmatureDate = parseCalendarDate(currentRow[diffArmatureCol]);
    let diffCoffrageDate = parseCalendarDate(currentRow[diffCoffrageCol]);
    const duree2 = toInteger(currentRow[duree2Col]);
    const duree3 = toInteger(currentRow[duree3Col]);

    // Le drop MS fixe prioritairement le "Debut des travaux" (demarrage),
    // puis on recalcule les autres dates en remontant les durées.
    if (demarrageDate && duree3 != null && duree3 >= 0) {
      diffArmatureDate = subtractWeeksFromDate(demarrageDate, duree3);
    } else if (!diffArmatureDate && droppedEndDate) {
      diffArmatureDate = droppedEndDate;
    }

    if (diffArmatureDate && duree2 != null && duree2 >= 0) {
      diffCoffrageDate = subtractWeeksFromDate(diffArmatureDate, duree2);
    } else if (!diffCoffrageDate && droppedStartDate) {
      diffCoffrageDate = droppedStartDate;
    }

    if (!demarrageDate && diffArmatureDate && duree3 != null && duree3 >= 0) {
      demarrageDate = addWeeksToDate(diffArmatureDate, duree3);
    }

    const computedDemarrageIso = formatIsoDate(demarrageDate);
    const computedDiffCoffrageIso = formatIsoDate(diffCoffrageDate);
    const computedDiffArmatureIso = formatIsoDate(diffArmatureDate);
    if (computedDemarrageIso) updates[demarrageCol] = computedDemarrageIso;
    if (computedDiffCoffrageIso) updates[diffCoffrageCol] = computedDiffCoffrageIso;
    if (computedDiffArmatureIso) updates[diffArmatureCol] = computedDiffArmatureIso;
  } else {
    // Fallback for unexpected Type_doc values.
    if (droppedStartIso) updates[dateLimiteCol] = droppedStartIso;
    if (droppedEndIso) updates[diffCoffrageCol] = droppedEndIso;
  }

  const groupHasArmatures =
    !isNdcLike &&
    Boolean(currentZone) &&
    Boolean(currentGroup) &&
    groupHasArmaturesRow(rows, {
      idCol,
      zoneCol,
      groupCol,
      projectCol,
      typeDocCol,
      zoneValue: currentZone,
      groupValue: currentGroup,
      projectValue: currentProject,
    });

  if (isCoffrageTypeDoc(typeDoc) && groupHasArmatures) {
    updates[lignePlanningField] = null;
    if (nomXmlField) updates[nomXmlField] = null;
    updates[demarrageCol] = null;
  }

  const shouldResetGroupCoffragePlanningLinks =
    !isNdcLike &&
    Boolean(currentZone) &&
    Boolean(currentGroup) &&
    (
      isArmaturesTypeDoc(typeDoc) ||
      (isCoffrageTypeDoc(typeDoc) && groupHasArmatures)
    );

  const planningLinkResetActions = shouldResetGroupCoffragePlanningLinks
    ? buildCoffragePlanningLinkResetActions(rows, {
        idCol,
        zoneCol,
        groupCol,
        projectCol,
        typeDocCol,
        linePlanningCol: lignePlanningField,
        nomXmlCol: nomXmlField,
        demarrageCol,
        tableName: table.sourceTable,
        zoneValue: currentZone,
        groupValue: currentGroup,
        projectValue: currentProject,
        excludeRowIds: isCoffrageTypeDoc(typeDoc) ? [recordId] : [],
      })
    : [];

  const actions = [
    [
      "UpdateRecord",
      table.sourceTable,
      recordId,
      updates,
    ],
    ...planningLinkResetActions,
  ];
  const referenceSyncContext = await captureReferenceDateLimiteSyncContext(
    rows,
    actions,
    table.sourceTable,
    columns
  );

  await applyUserActionsInChunks(actions);
  const referenceDateLimiteUpdatedCount = await syncReferenceDateLimitesFromContext(
    referenceSyncContext,
    columns
  );

  return {
    updatedCount: actions.length,
    referenceDateLimiteUpdatedCount,
  };
}

export async function updatePlanningGroupZoneFromPlanningDrop({
  sourceRowId,
  targetRowId,
  linkedRowIds = [],
}) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const idCol = columns.id || "id";
  const groupCol = String(columns.groupe || "Groupe").trim();
  const zoneCol = String(columns.zone || "Zone").trim();
  const typeDocCol = String(columns.typeDoc || "Type_doc").trim();
  const taskCol = String(columns.taches || columns.tacheAlt || "Taches").trim();
  const projectCol = String(columns.projectLink || columns.nomProjet || "NomProjet").trim();
  const linePlanningCol = String(columns.lignePlanning || "Ligne_planning").trim();
  const demarrageCol = String(columns.demarragesTravaux || "Demarrages_travaux").trim();

  const sourceId = Number(sourceRowId);
  const targetId = Number(targetRowId);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    throw new Error("Ligne source Planning_Projet invalide.");
  }
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error("Ligne cible Planning_Projet invalide.");
  }
  if (sourceId === targetId) {
    return { updated: false, groupe: "", zone: "" };
  }

  const rows = await fetchTableRows(table.sourceTable);
  const sourceRow = rows.find((row) => Number(row?.[idCol]) === sourceId) || null;
  const targetRow = rows.find((row) => Number(row?.[idCol]) === targetId) || null;
  if (!sourceRow) {
    throw new Error("Ligne source introuvable dans Planning_Projet.");
  }
  if (!targetRow) {
    throw new Error("Ligne cible introuvable dans Planning_Projet.");
  }

  const targetZone = normalizeZoneValueForStorage(targetRow[zoneCol]);
  const targetRowGroupe = toText(targetRow[groupCol]);
  const sourceGroupe = toText(sourceRow[groupCol]);
  const sourceZone = normalizeZoneValueForStorage(sourceRow[zoneCol]);
  const sourceTypeDoc = toText(sourceRow[typeDocCol]);
  const sourceProject = toText(sourceRow[projectCol]);
  const targetTypeDoc = toText(targetRow[typeDocCol]);
  const targetProject = toText(targetRow[projectCol]);
  const sourceIsCoffrage = isCoffrageTypeDoc(sourceTypeDoc);
  const sourceIsArmatures = isArmaturesTypeDoc(sourceTypeDoc);
  const targetIsCoffrage = isCoffrageTypeDoc(targetTypeDoc);
  const isCrossZoneMove = sourceZone !== targetZone;
  const normalizedLinkedIds = Array.isArray(linkedRowIds)
    ? [...new Set(
      linkedRowIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== sourceId)
    )]
    : [];

  let nextGroupValue = targetRowGroupe;
  if (sourceIsCoffrage) {
    const conflictingCoffrages = findCoffrageRowsForZoneGroup(rows, {
      idCol,
      zoneCol,
      groupCol,
      projectCol,
      typeDocCol,
      zoneValue: targetZone,
      groupValue: nextGroupValue,
      projectValue: sourceProject,
      excludeRowIds: [sourceId],
    });
    const mustAllocateUniqueGroup =
      !nextGroupValue || isCrossZoneMove || conflictingCoffrages.length > 0;

    if (mustAllocateUniqueGroup) {
      nextGroupValue = getNextAvailableGroupValue(rows, {
        idCol,
        zoneCol,
        groupCol,
        projectCol,
        zoneValue: targetZone,
        projectValue: sourceProject,
        excludeRowIds: [sourceId, ...normalizedLinkedIds],
      });
    }
  } else if (sourceIsArmatures && targetIsCoffrage && !nextGroupValue) {
    nextGroupValue = getNextAvailableGroupValue(rows, {
      idCol,
      zoneCol,
      groupCol,
      projectCol,
      zoneValue: targetZone,
      projectValue: sourceProject || targetProject,
      excludeRowIds: [sourceId, targetId, ...normalizedLinkedIds],
    });
  }

  const updates = {};
  if (sourceGroupe !== nextGroupValue) {
    updates[groupCol] = nextGroupValue;
  }
  if (sourceZone !== targetZone) {
    updates[zoneCol] = targetZone;
  }

  const targetUpdates = {};
  if (sourceIsArmatures && targetIsCoffrage && targetRowGroupe !== nextGroupValue) {
    targetUpdates[groupCol] = nextGroupValue;
    if (hasPlanningLinkValue(targetRow?.[linePlanningCol])) {
      targetUpdates[linePlanningCol] = null;
    }
    const targetDemarrageValue = targetRow?.[demarrageCol];
    if (targetDemarrageValue != null && toText(targetDemarrageValue) !== "") {
      targetUpdates[demarrageCol] = null;
    }
  }

  const linkedActions = [];
  const zoneChanges = [];

  if (sourceZone !== targetZone) {
    zoneChanges.push({
      projectName: sourceProject,
      numeroDocument: sourceRow?.[columns.id2 || "ID2"],
      typeDocument: sourceTypeDoc,
      designation: sourceRow?.[taskCol],
      sourceZone,
      targetZone,
    });
  }

  normalizedLinkedIds.forEach((linkedId) => {
    const linkedRow = rows.find((row) => Number(row?.[idCol]) === linkedId) || null;
    if (!linkedRow) return;

    const linkedTypeDoc = toText(linkedRow[typeDocCol]);
    if (!isArmaturesTypeDoc(linkedTypeDoc)) return;

    const linkedZone = normalizeZoneValueForStorage(linkedRow[zoneCol]);
    const linkedGroup = toText(linkedRow[groupCol]);
    const linkedUpdates = {};
    if (linkedZone !== targetZone) linkedUpdates[zoneCol] = targetZone;
    if (linkedGroup !== nextGroupValue) linkedUpdates[groupCol] = nextGroupValue;
    if (!Object.keys(linkedUpdates).length) return;

    linkedActions.push([
      "UpdateRecord",
      table.sourceTable,
      linkedId,
      linkedUpdates,
    ]);

    if (linkedZone !== targetZone) {
      zoneChanges.push({
        projectName: sourceProject,
        numeroDocument: linkedRow?.[columns.id2 || "ID2"],
        typeDocument: linkedTypeDoc,
        designation: linkedRow?.[taskCol],
        sourceZone: linkedZone,
        targetZone,
      });
    }
  });

  const finalGroupHasArmatures =
    Boolean(nextGroupValue) &&
    (
      sourceIsArmatures ||
      normalizedLinkedIds.length > 0 ||
      groupHasArmaturesRow(rows, {
        idCol,
        zoneCol,
        groupCol,
        projectCol,
        typeDocCol,
        zoneValue: targetZone,
        groupValue: nextGroupValue,
        projectValue: sourceProject,
        excludeRowIds: [sourceId, ...normalizedLinkedIds],
      })
    );

  if (sourceIsCoffrage && finalGroupHasArmatures) {
    if (hasPlanningLinkValue(sourceRow?.[linePlanningCol])) {
      updates[linePlanningCol] = null;
    }
    const currentDemarrageValue = sourceRow?.[demarrageCol];
    if (currentDemarrageValue != null && toText(currentDemarrageValue) !== "") {
      updates[demarrageCol] = null;
    }
  }

  const planningLinkResetActions = finalGroupHasArmatures
    ? buildCoffragePlanningLinkResetActions(rows, {
        idCol,
        zoneCol,
        groupCol,
        projectCol,
        typeDocCol,
        linePlanningCol,
        demarrageCol,
        tableName: table.sourceTable,
        zoneValue: targetZone,
        groupValue: nextGroupValue,
        projectValue: sourceProject,
        excludeRowIds: sourceIsCoffrage ? [sourceId] : [],
      })
    : [];

  const externalZoneSyncActions = await buildExternalZoneSyncActionsForPlanningChanges(zoneChanges);

  if (!Object.keys(updates).length && !Object.keys(targetUpdates).length && !linkedActions.length && !planningLinkResetActions.length && !externalZoneSyncActions.length) {
    return {
      updated: false,
      groupe: nextGroupValue,
      zone: targetZone,
      linkedUpdatedCount: 0,
    };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const actions = [];
  if (Object.keys(updates).length) {
    actions.push([
      "UpdateRecord",
      table.sourceTable,
      sourceId,
      updates,
    ]);
  }
  if (Object.keys(targetUpdates).length) {
    actions.push([
      "UpdateRecord",
      table.sourceTable,
      targetId,
      targetUpdates,
    ]);
  }
  actions.push(...linkedActions);
  actions.push(...planningLinkResetActions);
  actions.push(...externalZoneSyncActions);
  const referenceSyncContext = await captureReferenceDateLimiteSyncContext(
    rows,
    actions,
    table.sourceTable,
    columns
  );

  await applyUserActionsInChunks(actions);
  const referenceDateLimiteUpdatedCount = await syncReferenceDateLimitesFromContext(
    referenceSyncContext,
    columns
  );

  return {
    updated: true,
    groupe: nextGroupValue,
    zone: targetZone,
    linkedUpdatedCount: linkedActions.length,
    referenceDateLimiteUpdatedCount,
  };
}

export async function updatePlanningZoneFromZoneHeaderDrop({
  sourceRowId,
  targetZone,
  targetZoneKey = "",
  linkedRowIds = [],
}) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const idCol = columns.id || "id";
  const zoneCol = String(columns.zone || "Zone").trim();
  const groupCol = String(columns.groupe || "Groupe").trim();
  const typeDocCol = String(columns.typeDoc || "Type_doc").trim();
  const taskCol = String(columns.taches || columns.tacheAlt || "Taches").trim();
  const projectCol = String(columns.projectLink || columns.nomProjet || "NomProjet").trim();
  const linePlanningCol = String(columns.lignePlanning || "Ligne_planning").trim();
  const demarrageCol = String(columns.demarragesTravaux || "Demarrages_travaux").trim();
  const sourceId = Number(sourceRowId);
  const normalizedTargetZoneKey = toText(targetZoneKey);
  const normalizedZoneFromLabel = normalizeZoneValueForStorage(targetZone);
  const isSansZoneTarget =
    normalizedTargetZoneKey === "" &&
    (normalizedZoneFromLabel === "" ||
      toText(targetZone).toLocaleLowerCase("fr") === "sans zone");
  const normalizedZone = isSansZoneTarget ? "" : normalizedZoneFromLabel;

  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    throw new Error("Ligne source Planning_Projet invalide.");
  }
  if (!normalizedZone && !isSansZoneTarget) {
    throw new Error("Zone cible invalide.");
  }

  const rows = await fetchTableRows(table.sourceTable);
  const sourceRow = rows.find((row) => Number(row?.[idCol]) === sourceId) || null;
  if (!sourceRow) {
    throw new Error("Ligne source introuvable dans Planning_Projet.");
  }

  const sourceZone = normalizeZoneValueForStorage(sourceRow[zoneCol]);
  const sourceGroup = toText(sourceRow[groupCol]);
  const sourceTypeDoc = toText(sourceRow[typeDocCol]);
  const sourceProject = toText(sourceRow[projectCol]);
  const shouldAssignAutoGroup = isCoffrageTypeDoc(sourceTypeDoc);
  const shouldClearGroupOnZoneDrop = !shouldAssignAutoGroup;
  const sourceIsArmatures = isArmaturesTypeDoc(sourceTypeDoc);

  let nextGroupValue = sourceGroup;
  if (shouldAssignAutoGroup) {
    nextGroupValue = getNextAvailableGroupValue(rows, {
      idCol,
      zoneCol,
      groupCol,
      projectCol,
      zoneValue: normalizedZone,
      projectValue: sourceProject,
      excludeRowIds: [sourceId],
    });
  } else if (shouldClearGroupOnZoneDrop) {
    nextGroupValue = "";
  }

  const updates = {};
  if (sourceZone !== normalizedZone) {
    updates[zoneCol] = normalizedZone;
  }
  if ((shouldAssignAutoGroup || shouldClearGroupOnZoneDrop) && sourceGroup !== nextGroupValue) {
    updates[groupCol] = nextGroupValue;
  }

  const normalizedLinkedIds = Array.isArray(linkedRowIds)
    ? [...new Set(
      linkedRowIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== sourceId)
    )]
    : [];

  const linkedActions = [];
  const zoneChanges = [];

  if (sourceZone !== normalizedZone) {
    zoneChanges.push({
      projectName: sourceProject,
      numeroDocument: sourceRow?.[columns.id2 || "ID2"],
      typeDocument: sourceTypeDoc,
      designation: sourceRow?.[taskCol],
      sourceZone,
      targetZone: normalizedZone,
    });
  }

  normalizedLinkedIds.forEach((linkedId) => {
    const linkedRow = rows.find((row) => Number(row?.[idCol]) === linkedId) || null;
    if (!linkedRow) return;

    const linkedTypeDoc = toText(linkedRow[typeDocCol]);
    if (!isArmaturesTypeDoc(linkedTypeDoc)) return;

    const linkedZone = normalizeZoneValueForStorage(linkedRow[zoneCol]);
    const linkedGroup = toText(linkedRow[groupCol]);
    const linkedUpdates = {};
    if (linkedZone !== normalizedZone) linkedUpdates[zoneCol] = normalizedZone;
    if (linkedGroup !== nextGroupValue) linkedUpdates[groupCol] = nextGroupValue;
    if (!Object.keys(linkedUpdates).length) return;

    linkedActions.push([
      "UpdateRecord",
      table.sourceTable,
      linkedId,
      linkedUpdates,
    ]);

    if (linkedZone !== normalizedZone) {
      zoneChanges.push({
        projectName: sourceProject,
        numeroDocument: linkedRow?.[columns.id2 || "ID2"],
        typeDocument: linkedTypeDoc,
        designation: linkedRow?.[taskCol],
        sourceZone: linkedZone,
        targetZone: normalizedZone,
      });
    }
  });

  const finalGroupHasArmatures =
    Boolean(nextGroupValue) &&
    (
      sourceIsArmatures ||
      normalizedLinkedIds.length > 0 ||
      groupHasArmaturesRow(rows, {
        idCol,
        zoneCol,
        groupCol,
        projectCol,
        typeDocCol,
        zoneValue: normalizedZone,
        groupValue: nextGroupValue,
        projectValue: sourceProject,
        excludeRowIds: [sourceId, ...normalizedLinkedIds],
      })
    );

  if (shouldAssignAutoGroup && finalGroupHasArmatures) {
    if (hasPlanningLinkValue(sourceRow?.[linePlanningCol])) {
      updates[linePlanningCol] = null;
    }
    const currentDemarrageValue = sourceRow?.[demarrageCol];
    if (currentDemarrageValue != null && toText(currentDemarrageValue) !== "") {
      updates[demarrageCol] = null;
    }
  }

  const planningLinkResetActions = finalGroupHasArmatures
    ? buildCoffragePlanningLinkResetActions(rows, {
        idCol,
        zoneCol,
        groupCol,
        projectCol,
        typeDocCol,
        linePlanningCol,
        demarrageCol,
        tableName: table.sourceTable,
        zoneValue: normalizedZone,
        groupValue: nextGroupValue,
        projectValue: sourceProject,
        excludeRowIds: shouldAssignAutoGroup ? [sourceId] : [],
      })
    : [];

  const externalZoneSyncActions = await buildExternalZoneSyncActionsForPlanningChanges(zoneChanges);

  if (!Object.keys(updates).length && !linkedActions.length && !planningLinkResetActions.length && !externalZoneSyncActions.length) {
    return {
      updated: false,
      zone: normalizedZone,
      groupe: sourceGroup,
      linkedUpdatedCount: 0,
    };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const actions = [];
  if (Object.keys(updates).length) {
    actions.push([
      "UpdateRecord",
      table.sourceTable,
      sourceId,
      updates,
    ]);
  }
  actions.push(...linkedActions);
  actions.push(...planningLinkResetActions);
  actions.push(...externalZoneSyncActions);
  const referenceSyncContext = await captureReferenceDateLimiteSyncContext(
    rows,
    actions,
    table.sourceTable,
    columns
  );

  await applyUserActionsInChunks(actions);
  const referenceDateLimiteUpdatedCount = await syncReferenceDateLimitesFromContext(
    referenceSyncContext,
    columns
  );

  return {
    updated: true,
    zone: normalizedZone,
    groupe: nextGroupValue,
    linkedUpdatedCount: linkedActions.length,
    referenceDateLimiteUpdatedCount,
  };
}

export async function addPlanningZoneRow({
  projectName,
  zoneName,
}) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const normalizedProject = toText(projectName);
  const normalizedZone = toText(zoneName);

  if (!normalizedProject) {
    throw new Error("Projet obligatoire pour ajouter une zone.");
  }
  if (!normalizedZone) {
    throw new Error("Nom de zone obligatoire.");
  }

  const id2Col = String(columns.id2 || "ID2").trim();
  const tachesCol = String(columns.taches || columns.tacheAlt || "Taches").trim();
  const typeDocCol = String(columns.typeDoc || "Type_doc").trim();
  const lignePlanningCol = String(columns.lignePlanning || "Ligne_planning").trim();
  const dateLimiteCol = String(columns.dateLimite || "Date_limite").trim();
  const duree1Col = String(columns.duree1 || "Duree_1").trim();
  const diffCoffrageCol = String(columns.diffCoffrage || "Diff_coffrage").trim();
  const duree2Col = String(columns.duree2 || "Duree_2").trim();
  const diffArmatureCol = String(columns.diffArmature || "Diff_armature").trim();
  const duree3Col = String(columns.duree3 || "Duree_3").trim();
  const demarrageCol = String(columns.demarragesTravaux || "Demarrages_travaux").trim();
  const retardsCol = String(columns.retards || "Retards").trim();
  const indiceCol = String(columns.indice || "Indice").trim();
  const realiseCol = String(columns.realise || "Realise").trim();
  const dateRealiseCol = String(columns.dateRealise || "Date_Realise").trim();
  const projectCol = String(columns.projectLink || columns.nomProjet || "NomProjet").trim();
  const groupCol = String(columns.groupe || "Groupe").trim();
  const zoneCol = String(columns.zone || "Zone").trim();

  const fields = {
    [id2Col]: "",
    [tachesCol]: "",
    [typeDocCol]: "",
    [dateLimiteCol]: null,
    [duree1Col]: 0,
    [diffCoffrageCol]: null,
    [duree2Col]: 0,
    [diffArmatureCol]: null,
    [duree3Col]: 0,
    [demarrageCol]: null,
    [retardsCol]: 0,
    [indiceCol]: "",
    [realiseCol]: 0,
    [dateRealiseCol]: null,
    [projectCol]: normalizedProject,
    [groupCol]: "",
    [zoneCol]: normalizedZone,
  };

  // Colonne optionnelle presente sur certaines bases.
  fields.Prev_Indice_0 = null;
  const optionalFieldNames = ["Prev_Indice_0", dateRealiseCol];

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const addAction = ["AddRecord", table.sourceTable, null, fields];
  try {
    await grist.docApi.applyUserActions([addAction]);
  } catch (error) {
    const message = String(error?.message ?? "");
    const lowerMessage = message.toLowerCase();
    const canRetryWithoutOptionalColumn =
      optionalFieldNames.some((fieldName) =>
        lowerMessage.includes(String(fieldName || "").toLowerCase())
      ) ||
      lowerMessage.includes("unknown column");
    if (!canRetryWithoutOptionalColumn) {
      throw error;
    }

    // Si une colonne optionnelle n'existe pas, on retente sans celles-ci.
    optionalFieldNames.forEach((fieldName) => {
      delete fields[fieldName];
    });
    await grist.docApi.applyUserActions([["AddRecord", table.sourceTable, null, fields]]);
  }
}

/* ---------- Projets ---------- */

function buildProjectOptionsFromRows(rows = []) {
  const table = APP_CONFIG.grist.projectsTable;
  const columns = table.columns || {};

  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const id = Number(row?.id);
    const name = toText(row[columns.project || "Nom_de_projet"]);
    const number = toText(row[columns.projectNumber || "Numero_de_projet"]);
    if (!name || !Number.isInteger(id) || id <= 0) continue;
    // Pas de dédoublonnage par nom : chaque ligne Projets est distincte par ID
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ id, number, name });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function buildProjectAvancementConfigsFromRows(rows = []) {
  const table = APP_CONFIG.grist.projectsTable;
  const columns = table.columns || {};

  return rows.map((row) => ({
    projectId: toText(row?.id),
    projectName: toText(row?.[columns.project]),
    projectNumber: toText(row?.[columns.projectNumber]),
    avancementConfigRaw: row?.[columns.avancement],
  }));
}

export async function fetchProjectBootstrapData() {
  const table = APP_CONFIG.grist.projectsTable;
  const rows = await fetchTableRows(table.sourceTable);
  return {
    projectOptions: buildProjectOptionsFromRows(rows),
    projectAvancementConfigs: buildProjectAvancementConfigsFromRows(rows),
  };
}

/* ---------- Planning ---------- */

export async function initializePlanningRow(rowId) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }
  const columns = table.columns || {};
  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const updates = {
    [columns.dateLimite || "Date_limite"]: null,
    [columns.duree1 || "Duree_1"]: null,
    [columns.diffCoffrage || "Diff_coffrage"]: null,
    [columns.duree2 || "Duree_2"]: null,
    [columns.diffArmature || "Diff_armature"]: null,
    [columns.duree3 || "Duree_3"]: null,
    [columns.demarragesTravaux || "Demarrages_travaux"]: null,
    [columns.lignePlanning || "Ligne_planning"]: null,
  };
  if (columns.nomXml) {
    updates[columns.nomXml] = null;
  }

  await grist.docApi.applyUserActions([
    ["UpdateRecord", table.sourceTable, recordId, updates],
  ]);
}

export async function reorganizePlanningRowForTypeChange({ rowId, oldTypeDoc, newTypeDoc }) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) return;
  const columns = table.columns || {};
  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) return;

  const oldIsArmatures = isArmaturesTypeDoc(oldTypeDoc);
  const newIsArmatures = isArmaturesTypeDoc(newTypeDoc);
  const newIsCoffrage = isCoffrageTypeDoc(newTypeDoc);

  const rows = await fetchTableRows(table.sourceTable);
  const idCol = columns.id || "id";
  const currentRow = rows.find((row) => Number(row?.[idCol]) === recordId);
  if (!currentRow) return;

  const dateLimiteCol = columns.dateLimite || "Date_limite";
  const duree1Col = columns.duree1 || "Duree_1";
  const diffCoffrageCol = columns.diffCoffrage || "Diff_coffrage";
  const duree2Col = columns.duree2 || "Duree_2";
  const diffArmatureCol = columns.diffArmature || "Diff_armature";
  const groupeCol = columns.groupe || "Groupe";

  const updates = {};

  // Non-COFFRAGE, non-ARMATURES → vider le Groupe.
  if (!newIsCoffrage && !newIsArmatures) {
    updates[groupeCol] = "";
  }

  if (oldIsArmatures && !newIsArmatures) {
    // ARMATURES → autre : Diff_coffrage → Date_limite, Diff_armature → Diff_coffrage.
    // Les dates brutes Grist sont des timestamps : on passe par parseCalendarDate + formatIsoDate.
    const diffCoffrageDate = parseCalendarDate(currentRow[diffCoffrageCol]);
    const diffArmatureDate = parseCalendarDate(currentRow[diffArmatureCol]);
    const duree2Int = toInteger(currentRow[duree2Col]);

    const dateLimiteIso = formatIsoDate(diffCoffrageDate);
    const diffCoffrageIso = formatIsoDate(diffArmatureDate);

    if (dateLimiteIso) updates[dateLimiteCol] = dateLimiteIso;
    if (diffCoffrageIso) updates[diffCoffrageCol] = diffCoffrageIso;
    updates[duree1Col] = duree2Int ?? null;
    updates[diffArmatureCol] = null;
    updates[duree2Col] = null;

  } else if (!oldIsArmatures && newIsArmatures) {
    // Autre → ARMATURES : Date_limite effective → Diff_coffrage, Diff_coffrage → Diff_armature.
    const dateLimiteDate = parseCalendarDate(currentRow[dateLimiteCol]);
    const diffCoffrageDate = parseCalendarDate(currentRow[diffCoffrageCol]);
    const duree1Int = toInteger(currentRow[duree1Col]);

    // Date_limite effective = Diff_coffrage − Duree_1 semaines (préserve le segment affiché).
    const effectiveDateLimite =
      diffCoffrageDate && duree1Int != null && duree1Int >= 0
        ? subtractWeeksFromDate(diffCoffrageDate, duree1Int)
        : dateLimiteDate;

    const newDiffCoffrageIso = formatIsoDate(effectiveDateLimite);
    const newDiffArmatureIso = formatIsoDate(diffCoffrageDate);

    if (newDiffCoffrageIso) updates[diffCoffrageCol] = newDiffCoffrageIso;
    if (newDiffArmatureIso) updates[diffArmatureCol] = newDiffArmatureIso;
    updates[duree2Col] = duree1Int ?? null;
    updates[dateLimiteCol] = null;
    updates[duree1Col] = null;
  }

  if (Object.keys(updates).length === 0) return;

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") return;
  await grist.docApi.applyUserActions([
    ["UpdateRecord", table.sourceTable, recordId, updates],
  ]);
}

export async function fetchPlanningRows() {
  const table = APP_CONFIG.grist.planningTable;
  const rows = await fetchTableRows(table.sourceTable);
  _planningRowsCache = rows;  // alimente le cache pour fetchPlanningRowById
  return rows;
}

export async function fetchListePlanRows() {
  return fetchFirstAvailableTable(LISTEPLAN_TABLE_CANDIDATES);
}

export async function updatePlanningRetardJustification(rowId, remarque) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  const columns = table.columns || {};
  const remarqueCol = String(columns.remarque || "Remarque").trim();
  if (!remarqueCol) {
    throw new Error("Colonne Remarque invalide.");
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      table.sourceTable,
      recordId,
      {
        [remarqueCol]: toText(remarque),
      },
    ],
  ]);

  return {
    updatedCount: 1,
  };
}

export async function fetchPlanningReferenceDetails(rowId) {
  const { row, columns } = await fetchPlanningRowById(rowId);
  const startDate = getPlanningSegmentStartDate(row, columns);
  const startIso = formatIsoDate(startDate);
  const allReferenceRows = await fetchTableRows(REFERENCES_TABLE_NAME);
  const referenceRows = filterReferenceRowsForPlanningRows(allReferenceRows, [row], columns);
  const linkedRows = findLinkedReferenceRowsForPlanningRow(row, referenceRows, columns);
  await syncReferenceRetardRows(linkedRows);

  return {
    planningRowId: Number(rowId),
    segmentStartIso: startIso,
    references: linkedRows.map((referenceRow) => {
      const referenceId = Number(referenceRow?.id);
      return {
        id: Number.isInteger(referenceId) && referenceId > 0 ? referenceId : null,
        emetteur: toText(referenceRow?.Emetteur),
        reference: toText(referenceRow?.Reference),
        bloquant: Boolean(referenceRow?.Bloquant),
        recu: formatReferenceDateIso(referenceRow?.Recu),
        dateLimite: formatReferenceDateIso(referenceRow?.DateLimite),
        durationWeeks: parseReferenceDurationLimit(referenceRow?.DureeLimite),
        retard: computeReferenceRetardDays(referenceRow?.Recu, referenceRow?.DateLimite),
      };
    }),
  };
}

export async function updatePlanningReferenceDetails(rowId, updates = []) {
  const { row, columns } = await fetchPlanningRowById(rowId);
  const startDate = getPlanningSegmentStartDate(row, columns);
  const hasStartDate = startDate instanceof Date && !Number.isNaN(startDate.getTime());

  const allReferenceRows = await fetchTableRows(REFERENCES_TABLE_NAME);
  const referenceRows = filterReferenceRowsForPlanningRows(allReferenceRows, [row], columns);
  const linkedRows = findLinkedReferenceRowsForPlanningRow(row, referenceRows, columns);
  const linkedIds = new Set(
    linkedRows
      .map((referenceRow) => Number(referenceRow?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const linkedRowsById = new Map(
    linkedRows
      .map((referenceRow) => [Number(referenceRow?.id), referenceRow])
      .filter(([id]) => Number.isInteger(id) && id > 0)
  );

  const candidateActions = (Array.isArray(updates) ? updates : [])
    .map((update) => {
      const referenceId = Number(update?.id);
      if (!Number.isInteger(referenceId) || referenceId <= 0 || !linkedIds.has(referenceId)) {
        return null;
      }
      const linkedReferenceRow = linkedRowsById.get(referenceId) || null;

      const durationText = toText(update?.durationWeeks);
      const rawDateLimiteText = toText(update?.dateLimite);
      const rawDateLimiteIsEmptyValue =
        !rawDateLimiteText ||
        rawDateLimiteText === REFERENCE_EMPTY_DATE_ISO ||
        rawDateLimiteText.startsWith(`${REFERENCE_EMPTY_DATE_ISO}T`) ||
        rawDateLimiteText === "01/01/1900";
      const parsedDateLimite = parseCalendarDate(rawDateLimiteText);
      const hasRawDateLimite = Boolean(rawDateLimiteText);
      const dateLimiteIso = isEmptyReferenceDate(parsedDateLimite)
        ? ""
        : formatIsoDate(parsedDateLimite);

      if (hasRawDateLimite && !rawDateLimiteIsEmptyValue && !dateLimiteIso) {
        throw new Error("Date limite invalide.");
      }

      if (!hasStartDate && dateLimiteIso) {
        throw new Error("Date de debut du segment introuvable.");
      }

      if (dateLimiteIso) {
        const durationWeeks = getReferenceDurationWeeksFromLimitDate(startDate, parsedDateLimite);
        if (durationWeeks == null) {
          throw new Error(
            "La date limite doit etre un nombre entier de semaines avant le debut du segment."
          );
        }

        return [
          "UpdateRecord",
          REFERENCES_TABLE_NAME,
          referenceId,
          {
            Bloquant: Boolean(update?.bloquant),
            DureeLimite: durationWeeks,
            DateLimite: dateLimiteIso,
            Retard: toReferenceRetardStorageValue(
              computeReferenceRetardDays(linkedReferenceRow?.Recu, dateLimiteIso)
            ),
          },
        ];
      }

      if (!durationText) {
        return [
          "UpdateRecord",
          REFERENCES_TABLE_NAME,
          referenceId,
          {
            Bloquant: Boolean(update?.bloquant),
            DureeLimite: "",
            DateLimite: REFERENCE_EMPTY_DATE_ISO,
            Retard: "",
          },
        ];
      }

      const durationWeeks = parseReferenceDurationLimit(durationText);
      if (durationWeeks == null) {
        throw new Error("La duree doit etre un nombre entier de semaines.");
      }

      if (!hasStartDate) {
        return [
          "UpdateRecord",
          REFERENCES_TABLE_NAME,
          referenceId,
          {
            Bloquant: Boolean(update?.bloquant),
            DureeLimite: durationWeeks,
            DateLimite: REFERENCE_EMPTY_DATE_ISO,
            Retard: "",
          },
        ];
      }

      const dateLimite = subtractWeeksFromDate(startDate, durationWeeks);
      const computedDateLimiteIso = formatIsoDate(dateLimite);
      if (!computedDateLimiteIso) {
        throw new Error("Impossible de calculer DateLimite.");
      }

      return [
        "UpdateRecord",
        REFERENCES_TABLE_NAME,
        referenceId,
        {
          Bloquant: Boolean(update?.bloquant),
          DureeLimite: durationWeeks,
          DateLimite: computedDateLimiteIso,
          Retard: toReferenceRetardStorageValue(
            computeReferenceRetardDays(linkedReferenceRow?.Recu, computedDateLimiteIso)
          ),
        },
      ];
    })
    .filter(Boolean);
  const actions = candidateActions
    .map((action) => {
      const referenceId = Number(action?.[2]);
      const linkedReferenceRow = linkedRowsById.get(referenceId) || null;
      const changedFields = buildChangedReferenceFields(linkedReferenceRow, action?.[3]);
      return Object.keys(changedFields).length
        ? [action[0], action[1], referenceId, changedFields]
        : null;
    })
    .filter(Boolean);

  if (!actions.length) {
    return { updatedCount: 0 };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await applyUserActionsInChunks(actions);
  // Invalider le cache après écriture — prochain "Détails" rechargera des données fraîches
  _planningRowsCache = null;
  emitReferenceDataChangeSignal();
  return { updatedCount: actions.length };
}

export function invalidateDetailsCache() {
  _planningRowsCache = null;
}

export { toText };
