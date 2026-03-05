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

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
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
  const table = APP_CONFIG.grist.projectsTable;
  const rows = await fetchTableRows(table.sourceTable);

  const values = new Set();
  for (const row of rows) {
    const value = toText(row[table.columns.project]);
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
