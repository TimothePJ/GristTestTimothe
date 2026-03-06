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

function normalizeGroupValue(value) {
  const text = toText(value);
  return text ? text.toLocaleLowerCase("fr") : "";
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
  const typeDocCol = columns.typeDoc || "Type_doc";
  const diffCoffrageCol = columns.diffCoffrage || "Diff_coffrage";
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
    const groupKey = normalizeGroupValue(row?.[groupCol]);
    if (!groupKey) return;
    if (!isArmaturesTypeDoc(row?.[typeDocCol])) return;

    const diffDate = parseCalendarDate(row?.[diffCoffrageCol]);
    if (!diffDate) return;

    const currentMin = minArmatureDiffByGroup.get(groupKey);
    if (!currentMin || diffDate < currentMin) {
      minArmatureDiffByGroup.set(groupKey, diffDate);
    }
  });

  const actions = [];
  let matchedCoffrageCount = 0;

  scopedRows.forEach((row) => {
    const groupKey = normalizeGroupValue(row?.[groupCol]);
    if (!groupKey) return;
    if (!isCoffrageTypeDoc(row?.[typeDocCol])) return;

    const targetDate = minArmatureDiffByGroup.get(groupKey);
    if (!targetDate) return;

    matchedCoffrageCount += 1;

    const recordId = Number(row?.[idCol]);
    if (!Number.isInteger(recordId) || recordId <= 0) return;

    const targetIso = formatIsoDate(targetDate);
    if (!targetIso) return;

    const currentIso = formatIsoDate(parseCalendarDate(row?.[diffCoffrageCol]));
    if (currentIso === targetIso) return;

    actions.push([
      "UpdateRecord",
      table.sourceTable,
      recordId,
      { [diffCoffrageCol]: targetIso },
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
      const diffCoffrageDate = parseCalendarDate(currentRow[diffCoffrageCol]);

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
