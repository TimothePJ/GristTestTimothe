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
    grist.ready({ requiredAccess: "read table" });
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

/* Utilitaires exportés pour planningService */
export { toText };