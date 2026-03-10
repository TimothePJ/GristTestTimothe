import { APP_CONFIG } from "../config.js";

function getGrist() {
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
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;

  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];

    const maxLen = Math.max(...keys.map((key) => (Array.isArray(raw[key]) ? raw[key].length : 0)));
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

function extractColumnNamesFromFetchResult(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.records) && raw.records.length > 0) {
    return Object.keys(raw.records[0] || {});
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return Object.keys(raw[0] || {});
  }
  if (typeof raw === "object") {
    return Object.keys(raw);
  }
  return [];
}

async function fetchTableSnapshot(tableName) {
  const grist = getGrist();

  if (!grist.docApi || typeof grist.docApi.fetchTable !== "function") {
    throw new Error("grist.docApi.fetchTable(...) indisponible.");
  }

  const raw = await grist.docApi.fetchTable(tableName);
  return {
    rows: normalizeFetchTableResult(raw),
    columnNames: extractColumnNamesFromFetchResult(raw),
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

function extractIsoDatePart(value) {
  const text = toText(value);
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function toDurationNumber(value) {
  if (value == null || value === "") return 0;
  const normalized = String(value).replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parseIsoDurationToHours(durationValue) {
  const text = toText(durationValue);
  if (!text) return null;

  const match = text.match(
    /^P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i
  );
  if (!match) return null;

  const years = toDurationNumber(match[1]);
  const months = toDurationNumber(match[2]);
  const weeks = toDurationNumber(match[3]);
  const days = toDurationNumber(match[4]);
  const hours = toDurationNumber(match[5]);
  const minutes = toDurationNumber(match[6]);
  const seconds = toDurationNumber(match[7]);

  // Les durées mois/année dépendent du calendrier; on ne les convertit pas ici.
  if (years !== 0 || months !== 0) {
    return null;
  }

  return weeks * 7 * 24 + days * 24 + hours + minutes / 60 + seconds / 3600;
}

function convertIsoDurationToWorkDays(durationValue) {
  const totalHours = parseIsoDurationToHours(durationValue);
  if (totalHours == null) return "";

  // Base métier demandée: 37h/semaine = 5 jours de travail.
  const workDays = (totalHours * 5) / 37;
  const rounded = Math.round(workDays * 100) / 100;
  if (!Number.isFinite(rounded)) return "";
  return Number.isInteger(rounded) ? Math.trunc(rounded) : rounded;
}

function getDirectChildTextByLocalName(parentNode, localName) {
  if (!parentNode || typeof localName !== "string") return "";
  const child = Array.from(parentNode.children || []).find(
    (node) => node?.localName === localName
  );
  return toText(child?.textContent);
}

function getFileNameWithoutExtension(fileName) {
  const text = toText(fileName);
  if (!text) return "";
  const dotIndex = text.lastIndexOf(".");
  if (dotIndex <= 0) return text;
  return text.slice(0, dotIndex);
}

function findExtendedAttributeValue(taskNode, expectedFieldId) {
  if (!taskNode || !expectedFieldId) return "";
  const expected = toText(expectedFieldId);
  if (!expected) return "";

  const attributes = Array.from(taskNode.children || []).filter(
    (node) => node?.localName === "ExtendedAttribute"
  );

  for (const attributeNode of attributes) {
    const fieldId = getDirectChildTextByLocalName(attributeNode, "FieldID");
    if (fieldId !== expected) continue;
    return getDirectChildTextByLocalName(attributeNode, "Value");
  }

  return "";
}

function normalizeBarStyleLabel(rawValue) {
  const text = toText(rawValue);
  if (!text) return "";
  return text.replace(/^\s*\d+\s*-\s*/, "").trim();
}

async function applyUserActionsInBatches(actions, batchSize = 200) {
  if (!Array.isArray(actions) || !actions.length) return;
  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  for (let index = 0; index < actions.length; index += batchSize) {
    const batch = actions.slice(index, index + batchSize);
    await grist.docApi.applyUserActions(batch);
  }
}

function hasColumn(rows, columnName) {
  if (!columnName) return false;
  return rows.some(
    (row) =>
      row &&
      typeof row === "object" &&
      Object.prototype.hasOwnProperty.call(row, columnName)
  );
}

function resolveColumn(rows, explicit, candidates = []) {
  if (explicit && hasColumn(rows, explicit)) return explicit;
  const fallback = candidates.find((candidate) => hasColumn(rows, candidate));
  return fallback || explicit || "";
}

function parseComparableNumber(value) {
  if (value == null || value === "") return null;
  const text = toText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function equalsByTextOrNumber(a, b) {
  const aText = toText(a);
  const bText = toText(b);
  if (!aText || !bText) return false;
  if (aText === bText) return true;

  const aNumber = parseComparableNumber(aText);
  const bNumber = parseComparableNumber(bText);
  if (aNumber == null || bNumber == null) return false;
  return aNumber === bNumber;
}

export async function importMsProjectXmlFile(file) {
  const table = APP_CONFIG.grist.msProjectTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table MS Project manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const uniqueNumberCol = columns.uniqueNumber;
  const taskNameCol = columns.taskName;
  const startCol = columns.start;
  const endCol = columns.end;
  const durationCol = columns.duration;
  const barStyleCol = columns.barStyle;
  const teamCol = columns.team;
  const subTeamCol = columns.subTeam;
  const effortCol = columns.effort;
  const projectLinkCol = columns.projectLink;
  const titleCol = columns.title;

  if (!uniqueNumberCol || !taskNameCol || !startCol || !endCol || !durationCol) {
    throw new Error("Mapping des colonnes MS Project incomplet dans la configuration.");
  }

  if (!file || typeof file.text !== "function") {
    throw new Error("Fichier XML invalide.");
  }

  const xmlContent = await file.text();
  const parser = new DOMParser();
  const xmlDocument = parser.parseFromString(xmlContent, "application/xml");
  if (xmlDocument.querySelector("parsererror")) {
    throw new Error("Le fichier XML est invalide ou illisible.");
  }

  const taskNodes = Array.from(xmlDocument.getElementsByTagNameNS("*", "Task"));
  if (!taskNodes.length) {
    throw new Error("Aucune tache <Task> trouvee dans le fichier XML.");
  }

  const sourceFileName = getFileNameWithoutExtension(file.name);
  const importedRecords = [];

  for (const taskNode of taskNodes) {
    const uid = getDirectChildTextByLocalName(taskNode, "UID");
    const taskName = getDirectChildTextByLocalName(taskNode, "Name");
    if (!uid || !taskName) continue;

    const uidAsNumber = Number(uid);
    if (Number.isFinite(uidAsNumber) && uidAsNumber <= 0) continue;

    const record = {
      [uniqueNumberCol]: uid,
      [taskNameCol]: taskName,
      [startCol]: extractIsoDatePart(getDirectChildTextByLocalName(taskNode, "Start")),
      [endCol]: extractIsoDatePart(getDirectChildTextByLocalName(taskNode, "Finish")),
      [durationCol]: convertIsoDurationToWorkDays(
        getDirectChildTextByLocalName(taskNode, "Duration")
      ),
    };

    if (teamCol) record[teamCol] = "";
    if (subTeamCol) record[subTeamCol] = "";
    if (effortCol) record[effortCol] = "";
    if (projectLinkCol) record[projectLinkCol] = "";
    if (titleCol) record[titleCol] = "";

    const styleValue = findExtendedAttributeValue(taskNode, "188744016");
    const normalizedStyle = normalizeBarStyleLabel(styleValue);
    if (barStyleCol) record[barStyleCol] = normalizedStyle;
    // Some tables use "Style" instead of the configured "Style_Barre".
    record.Style = normalizedStyle;

    record.Nom = sourceFileName;

    importedRecords.push(record);
  }

  if (!importedRecords.length) {
    throw new Error("Aucune tache exploitable trouvee (UID/Name manquants).");
  }

  const { columnNames } = await fetchTableSnapshot(table.sourceTable);
  const hasKnownColumns = columnNames.length > 0;
  const canUseColumn = (columnName) => {
    if (!columnName) return false;
    return !hasKnownColumns || columnNames.includes(columnName);
  };

  const actions = [];

  for (const rawRecord of importedRecords) {
    const record = {};
    for (const [column, value] of Object.entries(rawRecord)) {
      if (canUseColumn(column)) {
        record[column] = value;
      }
    }

    if (!Object.keys(record).length) continue;

    actions.push(["AddRecord", table.sourceTable, null, record]);
  }

  await applyUserActionsInBatches(actions);

  return {
    extractedTaskCount: taskNodes.length,
    processedCount: importedRecords.length,
    importedCount: actions.length,
    addedCount: actions.length,
    updatedCount: 0,
    sourceFileName,
  };
}

export async function updateMsProjectDate(rowId, columnName, isoDate) {
  const table = APP_CONFIG.grist.msProjectTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table MS Project manquant dans la configuration.");
  }

  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne MS Project invalide.");
  }

  const field = String(columnName ?? "").trim();
  if (!field) {
    throw new Error("Nom de colonne cible invalide.");
  }

  const normalizedIsoDate = String(isoDate ?? "").trim();
  if (!isIsoDate(normalizedIsoDate)) {
    throw new Error("Format de date invalide (attendu YYYY-MM-DD).");
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
        [field]: normalizedIsoDate,
      },
    ],
  ]);
}

export async function syncPlanningDemarrageFromMsProjectStart(
  rowId,
  isoDate
) {
  const msTable = APP_CONFIG.grist.msProjectTable;
  const planningTable = APP_CONFIG.grist.planningSyncTable;

  if (!planningTable?.enabled) {
    return { updatedCount: 0, matchedCount: 0, skipped: true };
  }

  if (!msTable?.sourceTable) {
    throw new Error("Configuration table MS Project manquante.");
  }
  if (!planningTable?.sourceTable) {
    throw new Error("Configuration table Planning_Projet manquante.");
  }

  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne MS Project invalide.");
  }

  const normalizedIsoDate = String(isoDate ?? "").trim();
  if (!isIsoDate(normalizedIsoDate)) {
    throw new Error("Format de date invalide (attendu YYYY-MM-DD).");
  }

  const msRows = await fetchTableRows(msTable.sourceTable);
  const msIdCol = msTable.columns?.id || "id";
  const msUniqueCol = msTable.columns?.uniqueNumber;

  if (!msUniqueCol) {
    throw new Error("Colonne Numero_Unique non configuree dans MsProject.");
  }

  const msRow = msRows.find((row) => Number(row?.[msIdCol]) === recordId);
  if (!msRow) {
    return { updatedCount: 0, matchedCount: 0, skipped: true };
  }

  const msUniqueValue = msRow[msUniqueCol];
  if (msUniqueValue == null || msUniqueValue === "") {
    return { updatedCount: 0, matchedCount: 0, skipped: true };
  }

  const planningRows = await fetchTableRows(planningTable.sourceTable);
  const planningIdCol = planningTable.columns?.id || "id";
  const planningLineCol = resolveColumn(
    planningRows,
    planningTable.columns?.linePlanning,
    planningTable.linePlanningCandidates || []
  );
  const planningDemarrageCol = resolveColumn(
    planningRows,
    planningTable.columns?.demarragesTravaux,
    planningTable.demarrageCandidates || []
  );

  if (!planningLineCol || !planningDemarrageCol) {
    throw new Error("Colonnes Planning_Projet introuvables pour la synchronisation.");
  }

  const matchingRows = planningRows.filter((row) => {
    return equalsByTextOrNumber(row[planningLineCol], msUniqueValue);
  });

  if (!matchingRows.length) {
    return { updatedCount: 0, matchedCount: 0, skipped: false };
  }

  const actions = matchingRows
    .map((row) => Number(row?.[planningIdCol]))
    .filter((id) => Number.isInteger(id) && id > 0)
    .map((id) => [
      "UpdateRecord",
      planningTable.sourceTable,
      id,
      { [planningDemarrageCol]: normalizedIsoDate },
    ]);

  if (!actions.length) {
    return { updatedCount: 0, matchedCount: matchingRows.length, skipped: false };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions(actions);
  return {
    updatedCount: actions.length,
    matchedCount: matchingRows.length,
    skipped: false,
  };
}

export function isMsProjectEnabled() {
  return Boolean(APP_CONFIG.grist.msProjectTable?.enabled);
}

export function getMsProjectSetupMessage() {
  const sourceTable = APP_CONFIG.grist.msProjectTable?.sourceTable || "(table non definie)";
  return `Base MS Project creee. Active APP_CONFIG.grist.msProjectTable.enabled puis ajuste le mapping de la table ${sourceTable}.`;
}

export async function buildProjectOptions() {
  const table = APP_CONFIG.grist.msProjectTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table MS Project manquant dans la configuration.");
  }

  const rows = await fetchTableRows(table.sourceTable);
  const preferredColumn = table.columns?.sourceName || "Nom";
  const candidateColumns = [
    preferredColumn,
    ...(table.sourceNameCandidates || []),
    "Nom",
  ].filter(Boolean);

  const selectedColumn =
    candidateColumns.find((column) =>
      rows.some((row) => row && Object.prototype.hasOwnProperty.call(row, column))
    ) || preferredColumn;

  const values = new Set();
  for (const row of rows) {
    const value = toText(row[selectedColumn]);
    if (value) values.add(value);
  }

  return [...values].sort((a, b) => a.localeCompare(b, "fr"));
}

export async function fetchMsProjectRows() {
  const table = APP_CONFIG.grist.msProjectTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table MS Project manquant dans la configuration.");
  }
  return fetchTableRows(table.sourceTable);
}

export { toText };
