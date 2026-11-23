// planningReferenceDeadlines.js — données d'entrée (References2) d'une ligne du planning
// Structure : quelles références lui appartiennent, et ce que deviennent leur date limite
// et leur retard quand le début de sa barre bouge.
//
// Module pur, sans DOM ni Grist. Planning Projet l'utilise à chacune de ses écritures de
// dates ; MS Project aussi, pour l'import XML et l'édition d'une date, qui déplaçaient les
// barres sans que leurs données d'entrée suivent. Une seule règle pour les deux widgets.

const REFERENCES_TABLE_NAME = "References2";
const DAY_MS = 86400000;

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

function isArmaturesTypeDoc(value) {
  return String(value ?? "").toUpperCase().includes("ARMATURES");
}

function normalizeZoneValueForStorage(value) {
  const text = toText(value);
  if (!text) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
}

function normalizeLookupText(value) {
  return toText(value).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function normalizeDocumentNumberForMatch(value) {
  return normalizeLookupText(value);
}

function getFirstNonEmptyRowValue(row, columnNames = []) {
  for (const columnName of columnNames) {
    const value = toText(row?.[columnName]);
    if (value) return value;
  }
  return "";
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

/* ---------- Lecture ---------- */

// Les références d'une ligne de planning se reconnaissent à leur document. Le
// filtre porte donc sur le couple (nom, numéro) des lignes visées : avec plusieurs
// lignes il laisse passer quelques croisements en trop, que la jointure client
// écarte ensuite — mais il divise la lecture par l'ordre de grandeur du document.
export function buildReferenceDocumentRestFilter(planningRows = [], columns = {}) {
  const nameCol = columns.taches || "Taches";
  const altNameCol = columns.tacheAlt || "Tache";
  const numberCol = columns.id2 || "ID2";
  const names = new Set();
  const numbers = new Set();

  (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
    const name = toText(row?.[nameCol]) || toText(row?.[altNameCol]);
    const number = toText(row?.[numberCol]);
    if (!name || !number) return;
    names.add(name);
    numbers.add(number);
  });

  if (!names.size || !numbers.size) return null;
  return { NomDocument: [...names], NumeroDocument: [...numbers] };
}

/* ---------- Dates, durée et retard d'une donnée d'entrée ---------- */

// Début de la barre d'une ligne : ce à quoi ses données d'entrée sont accrochées.
export function getPlanningSegmentStartDate(row, columns = {}) {
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

export function isEmptyReferenceDate(date) {
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

export function formatReferenceDateIso(value) {
  const date = parseCalendarDate(value);
  return isEmptyReferenceDate(date) ? "" : formatIsoDate(date);
}

function getReferenceCalendarMs(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function computeReferenceRetardDays(recuValue, dateLimiteValue, currentDateValue = new Date()) {
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

export function toReferenceRetardStorageValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? String(Math.trunc(numericValue))
    : "";
}

export function referenceRetardStoredValueMatches(currentValue, expectedValue) {
  return toText(currentValue) === toReferenceRetardStorageValue(expectedValue);
}

export function parseReferenceDurationLimit(value) {
  const text = toText(value);
  if (!text) return null;
  const normalized = text.replace(",", ".");
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 0) {
    return null;
  }
  return numericValue;
}

export function getReferenceDurationWeeksFromLimitDate(startDate, limitDate) {
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

/* ---------- Références d'une ligne ---------- */

// Ce qui identifie le document d'une ligne de planning dans References2.
export function buildPlanningReferenceChange(row, columns = {}) {
  return {
    projectName: row?.[columns.projectLink || columns.nomProjet || "NomProjet"],
    numeroDocument: row?.[columns.id2 || "ID2"],
    typeDocument: row?.[columns.typeDoc || "Type_doc"],
    designation: row?.[columns.taches || columns.tacheAlt || "Taches"],
    sourceZone: row?.[columns.zone || "Zone"],
  };
}

export function filterReferenceRowsForPlanningRows(referenceRows = [], planningRows = [], columns = {}) {
  const targetKeys = new Set();
  (Array.isArray(planningRows) ? planningRows : []).forEach((planningRow) => {
    const change = buildPlanningReferenceChange(planningRow, columns);
    const project = normalizeLookupText(change.projectName);
    const number = normalizeDocumentNumberForMatch(change.numeroDocument);
    const type = normalizeLookupText(change.typeDocument);
    const designation = normalizeLookupText(change.designation);
    if (project && number && type && designation) {
      targetKeys.add([project, number, type, designation].join("||"));
    }
  });
  if (!targetKeys.size) return [];

  return (Array.isArray(referenceRows) ? referenceRows : []).filter((referenceRow) => {
    const project = normalizeLookupText(
      getFirstNonEmptyRowValue(referenceRow, ["NomProjetString", "NomProjet", "Nom_projet"])
    );
    const number = normalizeDocumentNumberForMatch(referenceRow?.NumeroDocument);
    const type = normalizeLookupText(referenceRow?.Type_document ?? referenceRow?.TypeDocument);
    const designation = normalizeLookupText(
      getFirstNonEmptyRowValue(referenceRow, ["NomDocument", "Designation"])
    );
    return (
      project &&
      number &&
      type &&
      designation &&
      targetKeys.has([project, number, type, designation].join("||"))
    );
  });
}

// Colonnes de References2 qui portent le projet, le document, son type, sa zone : la table
// a connu plusieurs noms, on prend ceux que les lignes portent réellement.
export function buildReferenceTableContext(referenceRows) {
  const columnNames = collectRowColumnNames(referenceRows);
  const projectCandidates = ["NomProjetString", "NomProjet", "Nom_projet"];
  const typeCandidates = ["Type_document", "TypeDocument"];
  return {
    tableName: REFERENCES_TABLE_NAME,
    rows: Array.isArray(referenceRows) ? referenceRows : [],
    projectCol: findFirstExistingColumnName(columnNames, projectCandidates, projectCandidates[0]),
    numberCol: findFirstExistingColumnName(columnNames, ["NumeroDocument"], "NumeroDocument"),
    typeCol: findFirstExistingColumnName(columnNames, typeCandidates, typeCandidates[0]),
    zoneCol: findFirstExistingColumnName(columnNames, ["Zone"], "Zone"),
    designationCols: ["NomDocument", "Designation"].filter((name) => columnNames.has(name)),
  };
}

function addReferenceLookupRow(map, key, row) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(row);
}

export function buildLinkedReferenceLookup(referenceRows = []) {
  const context = buildReferenceTableContext(referenceRows);

  const strict = new Map();
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
    if (project && number && type && designation) {
      addReferenceLookupRow(strict, [project, number, type, designation, zone].join("||"), row);
    }
  });
  return { context, strict };
}

function getUniqueReferenceLookupRows(map, keys = []) {
  const rowsById = new Map();
  keys.forEach((key) => {
    (map.get(key) || []).forEach((row) => rowsById.set(Number(row.id), row));
  });
  return [...rowsById.values()];
}

export function findLinkedReferenceRowsFromLookup(planningRow, lookup, columns = {}) {
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
  if (!project || !number || !type || !designation) return [];

  for (const zone of zones) {
    const strictRows = getUniqueReferenceLookupRows(lookup.strict, [
      [project, number, type, designation, zone].join("||"),
    ]);
    if (strictRows.length) return strictRows;
  }
  return [];
}

/* ---------- Suivi d'un déplacement de barre ---------- */

// Photo, AVANT l'écriture, de l'écart en semaines entre chaque donnée d'entrée d'une ligne
// et le début de sa barre : c'est cet écart qui est conservé une fois la barre déplacée.
function buildReferenceOffsetSnapshot(planningRow, linkedRows, columns = {}) {
  const startDate = getPlanningSegmentStartDate(planningRow, columns);
  const hasValidStartDate = startDate instanceof Date && !Number.isNaN(startDate.getTime());
  const seenReferenceIds = new Set();
  const offsets = [];

  linkedRows.forEach((row) => {
    const referenceId = Number(row?.id);
    if (!Number.isInteger(referenceId) || referenceId <= 0 || seenReferenceIds.has(referenceId)) {
      return;
    }

    const currentDurationWeeks = parseReferenceDurationLimit(row?.DureeLimite);
    const referenceLimitDate = parseCalendarDate(row?.DateLimite);
    const durationWeeks =
      currentDurationWeeks ??
      (
        !hasValidStartDate || isEmptyReferenceDate(referenceLimitDate)
          ? (Boolean(row?.Bloquant) && hasValidStartDate ? 0 : null)
          : getReferenceDurationWeeksFromLimitDate(startDate, referenceLimitDate)
      );

    if (durationWeeks == null) {
      return;
    }

    seenReferenceIds.add(referenceId);
    offsets.push({
      referenceId,
      durationWeeks,
      preserveBlankDuration: currentDurationWeeks == null && Boolean(row?.Bloquant),
      recuValue: row?.Recu,
      currentDateLimiteIso: formatReferenceDateIso(row?.DateLimite),
      currentDurationWeeks,
      currentRetardValue: row?.Retard,
    });
  });

  return offsets.length ? { offsets } : null;
}

// Photos des lignes données, par identifiant de ligne. `referenceRows` : les références
// lues pour ces lignes (le filtre document peut en avoir laissé passer d'autres).
export function buildReferenceOffsetSnapshots(planningRows = [], referenceRows = [], columns = {}) {
  const idCol = columns.id || "id";
  const uniqueRowsById = new Map();
  (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
    const rowId = Number(row?.[idCol]);
    if (Number.isInteger(rowId) && rowId > 0 && !uniqueRowsById.has(rowId)) {
      uniqueRowsById.set(rowId, row);
    }
  });

  const snapshotsByRowId = new Map();
  if (!uniqueRowsById.size) return snapshotsByRowId;

  const affectedRows = [...uniqueRowsById.values()];
  const linkedReferenceRows = filterReferenceRowsForPlanningRows(referenceRows, affectedRows, columns);
  const referenceLookup = buildLinkedReferenceLookup(linkedReferenceRows);
  for (const [rowId, row] of uniqueRowsById.entries()) {
    const snapshot = buildReferenceOffsetSnapshot(
      row,
      findLinkedReferenceRowsFromLookup(row, referenceLookup, columns),
      columns
    );
    if (snapshot?.offsets?.length) {
      snapshotsByRowId.set(rowId, snapshot);
    }
  }

  return snapshotsByRowId;
}

// Écritures References2 d'une ligne dont la barre a bougé : `planningRow` est la ligne
// APRÈS l'écriture. Seuls les champs qui changent sont écrits.
export function buildReferenceDateLimiteSyncActions(snapshot, planningRow, columns = {}, today = new Date()) {
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
        computeReferenceRetardDays(offset.recuValue, dateLimiteIso, today)
      );
      const fields = {};
      if (offset.currentDateLimiteIso !== dateLimiteIso) {
        fields.DateLimite = dateLimiteIso;
      }
      if (offset.currentDurationWeeks !== offset.durationWeeks && !offset.preserveBlankDuration) {
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

// Une référence visée plusieurs fois ne reçoit qu'une écriture, la dernière.
export function dedupeReferenceActions(actions = []) {
  const actionsByReferenceId = new Map();
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    const referenceId = Number(action?.[2]);
    if (Number.isInteger(referenceId) && referenceId > 0) {
      actionsByReferenceId.set(referenceId, action);
    }
  });
  return [...actionsByReferenceId.values()];
}

// En une passe, pour qui connaît d'avance ce qu'il va écrire : `planningRows` sont les
// lignes telles qu'elles sont, `fieldsByRowId` les champs qui vont y être écrits. Rend les
// écritures References2 à joindre au même lot.
export function planReferenceDeadlineActions({
  planningRows = [],
  fieldsByRowId = new Map(),
  referenceRows = [],
  columns = {},
  today = new Date(),
} = {}) {
  const idCol = columns.id || "id";
  const writtenRowsById = new Map();
  (Array.isArray(planningRows) ? planningRows : []).forEach((row) => {
    const rowId = Number(row?.[idCol]);
    if (fieldsByRowId.has(rowId) && !writtenRowsById.has(rowId)) writtenRowsById.set(rowId, row);
  });

  const snapshotsByRowId = buildReferenceOffsetSnapshots([...writtenRowsById.values()], referenceRows, columns);
  const actions = [];
  snapshotsByRowId.forEach((snapshot, rowId) => {
    const writtenRow = { ...writtenRowsById.get(rowId), ...fieldsByRowId.get(rowId) };
    actions.push(...buildReferenceDateLimiteSyncActions(snapshot, writtenRow, columns, today));
  });
  return dedupeReferenceActions(actions);
}
