import { APP_CONFIG } from "../config.js";

const REFERENCES_TABLE_NAME = "References";
const LISTEPLAN_TABLE_CANDIDATES = [
  "ListePlan_NDC_COF",
  "ListePlan NDC+COF",
  "ListePlan_NDC+COF",
];

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
    const n = value > 1e9 && value < 1e11 ? value * 1000 : value;
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

function normalizeZoneValueForStorage(value) {
  const text = toText(value);
  if (!text) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
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
  for (const candidate of candidates) {
    const tableName = String(candidate || "").trim();
    if (!tableName) continue;
    try {
      const rows = await fetchTableRows(tableName);
      return { tableName, rows };
    } catch (error) {
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

export async function syncCoffrageDiffCoffrageFromGroups(
  planningRows,
  selectedProject = ""
) {
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
    return { updatedCount: 0, matchedCoffrageCount: 0, skipped: true };
  }

  const selectedProjectText = toText(selectedProject);
  if (!selectedProjectText) {
    return { updatedCount: 0, matchedCoffrageCount: 0, skipped: true };
  }

  const scopedRows = rows.filter((row) => {
    return toText(row?.[projectCol]) === selectedProjectText;
  });

  if (!scopedRows.length) {
    return { updatedCount: 0, matchedCoffrageCount: 0, skipped: true };
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

  const actions = [];
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

    actions.push([
      "UpdateRecord",
      table.sourceTable,
      recordId,
      updates,
    ]);
  });

  if (!actions.length) {
    return { updatedCount: 0, matchedCoffrageCount, skipped: false };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions(actions);
  return {
    updatedCount: actions.length,
    matchedCoffrageCount,
    skipped: false,
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
    } else if (typeDoc.includes("COFFRAGE")) {
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

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      table.sourceTable,
      recordId,
      updates,
    ],
  ]);
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

  if (isCoffrageTypeDoc(typeDoc)) {
    let demarrageDate = droppedStartDate || parseCalendarDate(currentRow[demarrageCol]);
    let diffCoffrageDate = parseCalendarDate(currentRow[diffCoffrageCol]);
    let dateLimiteDate = parseCalendarDate(currentRow[dateLimiteCol]);
    const duree1 = toInteger(currentRow[duree1Col]);
    const duree3 = toInteger(currentRow[duree3Col]);

    // Nouveau cas COFFRAGE lie a MS Project:
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
    updates[demarrageCol] = null;
  }

  const shouldResetGroupCoffragePlanningLinks =
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

  await grist.docApi.applyUserActions(actions);
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
  const targetIsSansZone = !targetZone;
  const targetRowGroupe = targetIsSansZone ? "" : toText(targetRow[groupCol]);
  const sourceGroupe = toText(sourceRow[groupCol]);
  const sourceZone = normalizeZoneValueForStorage(sourceRow[zoneCol]);
  const sourceTypeDoc = toText(sourceRow[typeDocCol]);
  const sourceProject = toText(sourceRow[projectCol]);
  const sourceIsCoffrage = isCoffrageTypeDoc(sourceTypeDoc);
  const sourceIsArmatures = isArmaturesTypeDoc(sourceTypeDoc);
  const isCrossZoneMove = sourceZone !== targetZone;

  let nextGroupValue = targetRowGroupe;
  if (targetIsSansZone) {
    nextGroupValue = "";
  } else if (sourceIsCoffrage) {
    const normalizedLinkedIds = Array.isArray(linkedRowIds)
      ? linkedRowIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0 && value !== sourceId)
      : [];
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
      isCrossZoneMove || conflictingCoffrages.length > 0;

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
  }

  const updates = {};
  if (sourceGroupe !== nextGroupValue) {
    updates[groupCol] = nextGroupValue;
  }
  if (sourceZone !== targetZone) {
    updates[zoneCol] = targetZone;
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
    Boolean(targetZone) &&
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

  if (!Object.keys(updates).length && !linkedActions.length && !planningLinkResetActions.length && !externalZoneSyncActions.length) {
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
  actions.push(...linkedActions);
  actions.push(...planningLinkResetActions);
  actions.push(...externalZoneSyncActions);
  await grist.docApi.applyUserActions(actions);

  return {
    updated: true,
    groupe: nextGroupValue,
    zone: targetZone,
    linkedUpdatedCount: linkedActions.length,
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
  const shouldClearGroupOnZoneDrop = !isSansZoneTarget && !shouldAssignAutoGroup;
  const sourceIsArmatures = isArmaturesTypeDoc(sourceTypeDoc);

  let nextGroupValue = sourceGroup;
  if (isSansZoneTarget) {
    nextGroupValue = "";
  } else if (shouldAssignAutoGroup) {
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
  if ((isSansZoneTarget || shouldAssignAutoGroup || shouldClearGroupOnZoneDrop) && sourceGroup !== nextGroupValue) {
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
    !isSansZoneTarget &&
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
  await grist.docApi.applyUserActions(actions);

  return {
    updated: true,
    zone: normalizedZone,
    groupe: nextGroupValue,
    linkedUpdatedCount: linkedActions.length,
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
  const projectCol = String(columns.projectLink || columns.nomProjet || "NomProjet").trim();
  const groupCol = String(columns.groupe || "Groupe").trim();
  const zoneCol = String(columns.zone || "Zone").trim();

  const fields = {
    [id2Col]: "",
    [tachesCol]: "",
    [typeDocCol]: "",
    [lignePlanningCol]: 0,
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
    [projectCol]: normalizedProject,
    [groupCol]: "",
    [zoneCol]: normalizedZone,
  };

  // Colonne optionnelle presente sur certaines bases.
  fields.Prev_Indice_0 = null;

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  const addAction = ["AddRecord", table.sourceTable, null, fields];
  try {
    await grist.docApi.applyUserActions([addAction]);
  } catch (error) {
    const message = String(error?.message ?? "");
    const canRetryWithoutPrevIndice =
      message.toLowerCase().includes("prev_indice_0") ||
      message.toLowerCase().includes("unknown column");
    if (!canRetryWithoutPrevIndice) {
      throw error;
    }

    // Si la colonne optionnelle n'existe pas, on retente sans celle-ci.
    delete fields.Prev_Indice_0;
    await grist.docApi.applyUserActions([["AddRecord", table.sourceTable, null, fields]]);
  }
}

/* ---------- Projets ---------- */

export async function buildProjectOptions() {
  const table = APP_CONFIG.grist.projectsTable;
  const rows = await fetchTableRows(table.sourceTable);

  const values = new Set();
  for (const row of rows) {
    const v = toText(row[table.columns.project]);
    if (v) values.add(v);
  }

  return [...values].sort((a, b) => a.localeCompare(b, "fr"));
}

/* ---------- Planning ---------- */

export async function fetchPlanningRows() {
  const table = APP_CONFIG.grist.planningTable;
  const rows = await fetchTableRows(table.sourceTable);

  // On renvoie brut, le mapping métier se fait dans planningService.js
  return rows;
}

export async function syncPlanningRealiseValues(updates) {
  const normalizedUpdates = (updates || []).filter((update) => {
    const rowId = Number(update?.id);
    const realiseValue = update?.realise;
    return (
      Number.isInteger(rowId) &&
      rowId > 0 &&
      (realiseValue == null || Number.isFinite(Number(realiseValue)))
    );
  });

  if (!normalizedUpdates.length) {
    return { updatedCount: 0 };
  }

  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const realiseCol = String(columns.realise || "Realise").trim();

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions(
    normalizedUpdates.map((update) => [
      "UpdateRecord",
      table.sourceTable,
      Number(update.id),
      {
        [realiseCol]: update.realise == null ? null : Number(update.realise),
      },
    ])
  );

  return {
    updatedCount: normalizedUpdates.length,
  };
}

/* Utilitaires exportés pour planningService */
export async function syncPlanningRetardValues(updates) {
  const normalizedUpdates = (updates || []).filter((update) => {
    const rowId = Number(update?.id);
    const retardValue = update?.retards;
    return (
      Number.isInteger(rowId) &&
      rowId > 0 &&
      (retardValue == null || Number.isFinite(Number(retardValue)))
    );
  });

  if (!normalizedUpdates.length) {
    return { updatedCount: 0 };
  }

  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const retardsCol = String(columns.retards || "Retards").trim();

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions(
    normalizedUpdates.map((update) => [
      "UpdateRecord",
      table.sourceTable,
      Number(update.id),
      {
        [retardsCol]: update.retards == null ? null : Number(update.retards),
      },
    ])
  );

  return {
    updatedCount: normalizedUpdates.length,
  };
}

export { toText };
