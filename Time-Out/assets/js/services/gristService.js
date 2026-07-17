// Time-Out/assets/js/services/gristService.js
// Grist fetch + Time-Out CRUD + current-user detection.
// Reusable helpers ported verbatim from
// `planning-synchro/assets/js/services/gristService.js`
// (getGrist, fetchTableRaw, fetchTableRows, normalizeFetchTableResult,
// normalizeColumnName, resolveColumnId, getAvailableColumnIds,
// getResolvedColumns, applyActions, initGrist, toReferenceId).
//
// `normalizeFetchTableResult` and `resolveColumnId` are pure (no top-level
// window/DOM access) and are exported for unit testing under `node --test`.
// The rest of the module only touches `window.grist` inside function bodies
// (via `getGrist()`), so the module still imports cleanly in Node.

import { APP_CONFIG } from "../config.js";
import { toText } from "../utils/dates.js";
import { normalizePeriod } from "../utils/textSegments.js";

const resolvedColumnCache = new Map();

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

// --- current-user detection (NEW) ---
export function isCensoredCell(value) {
  if (value == null || value === "") return true;
  if (Array.isArray(value) && value[0] === "C") return true;
  return false;
}
function truthyFlag(value) {
  if (isCensoredCell(value)) return false;
  if (value === true || value === 1) return true;
  const t = String(value).trim().toLowerCase();
  return t === "true" || t === "1" || t === "oui" || t === "yes";
}
// L'utilisateur courant est identifié par le CENSURAGE ACL : la colonne `Moi` de la
// table Team n'est lisible (non censurée) QUE sur la ligne du viewer. La VALEUR du
// toggle n'a aucune importance — une cellule `Moi` lisible (même `false`) désigne
// « moi ». On se base donc sur la NON-censure, pas sur la véracité (sinon un `Moi`
// à `false`/décoché — ou un « Voir en tant que » d'un user qui n'a pas coché — casse
// la détection et renvoie « non reconnu »).
export const isMoiPresent = (value) => !isCensoredCell(value);
export const isAdminValue = truthyFlag;

export function findCurrentUser(teamRows, columns) {
  const row = (teamRows || []).find((r) => isMoiPresent(r?.[columns.moi]));
  if (!row) return null;
  return { email: toText(row[columns.email]), isAdmin: isAdminValue(row[columns.admin]) };
}

// --- alias maps ---
const TEAM_COLUMN_ALIASES = {
  id: ["id"], email: ["Email", "Mail"], prenomNom: ["PrenomNom", "Prenom_Nom"],
  prenom: ["Prenom", "Prénom"], nom: ["Nom"], service: ["Service"], role: ["Role"],
  admin: ["Admin"], moi: ["Moi"],
};
const TIME_OUT_COLUMN_ALIASES = {
  id: ["id"], owner: ["Owner"], startDate: ["Start_Date", "Start"], startPeriod: ["Start_Period"],
  endDate: ["End_Date", "End"], endPeriod: ["End_Period"], type: ["Type"],
};

// --- table-id resolution ("Time-Out" vs "Time_Out") ---
const resolvedTableIdCache = new Map();
const TABLE_ID_CANDIDATES = { timeOut: ["Time-Out", "Time_Out", "TimeOut"], team: ["Team"] };
async function resolveTableId(logicalKey) {
  if (resolvedTableIdCache.has(logicalKey)) return resolvedTableIdCache.get(logicalKey);
  const configured = APP_CONFIG.grist.tables[logicalKey];
  const candidates = [configured, ...(TABLE_ID_CANDIDATES[logicalKey] || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  for (const c of candidates) {
    try { await fetchTableRaw(c); resolvedTableIdCache.set(logicalKey, c); return c; } catch (_e) { /* next */ }
  }
  const fallback = configured ?? candidates[0];
  resolvedTableIdCache.set(logicalKey, fallback);
  return fallback;
}
async function resolveTimeOutTableId() { return resolveTableId("timeOut"); }
async function resolveTeamTableId() { return resolveTableId("team"); }

export async function getResolvedTeamColumns() {
  return getResolvedColumns(await resolveTeamTableId(), APP_CONFIG.grist.columns.team, TEAM_COLUMN_ALIASES);
}
export async function getResolvedTimeOutColumns() {
  return getResolvedColumns(await resolveTimeOutTableId(), APP_CONFIG.grist.columns.timeOut, TIME_OUT_COLUMN_ALIASES);
}
export async function fetchTeamRows() { return fetchTableRows(await resolveTeamTableId()); }
export async function fetchSegments() { return fetchTableRows(await resolveTimeOutTableId()); }

// --- all-Text CRUD ---
export async function createSegment({ owner, startDate, startPeriod, endDate, endPeriod, type }) {
  const tableId = await resolveTimeOutTableId();
  const columns = await getResolvedTimeOutColumns();
  const fields = {
    [columns.owner]: toText(owner),
    [columns.startDate]: toText(startDate),
    [columns.startPeriod]: normalizePeriod(startPeriod),
    [columns.endDate]: toText(endDate),
    [columns.endPeriod]: normalizePeriod(endPeriod),
    [columns.type]: toText(type),
  };
  if (Object.values(fields).some((v) => !v)) throw new Error("Segment invalide.");
  const result = await applyActions([["AddRecord", tableId, null, fields]]);
  return result?.retValues?.[0] ?? null;
}
export async function updateSegment(id, patch = {}) {
  const normalizedId = toReferenceId(id);
  if (!normalizedId) throw new Error("id manquant.");
  const tableId = await resolveTimeOutTableId();
  const columns = await getResolvedTimeOutColumns();
  const map = { owner: "owner", startDate: "startDate", startPeriod: "startPeriod", endDate: "endDate", endPeriod: "endPeriod", type: "type" };
  const fields = {};
  for (const key of Object.keys(map)) {
    if (patch[key] == null) continue;
    fields[columns[key]] = key.endsWith("Period") ? normalizePeriod(patch[key]) : toText(patch[key]);
  }
  if (!Object.keys(fields).length) return;
  await applyActions([["UpdateRecord", tableId, normalizedId, fields]]);
}
export async function removeSegment(id) {
  const normalizedId = toReferenceId(id);
  if (!normalizedId) return;
  const tableId = await resolveTimeOutTableId();
  await applyActions([["RemoveRecord", tableId, normalizedId]]);
}
