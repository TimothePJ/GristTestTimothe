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
  const dateLimiteCol = columns.dateLimite || "Date_limite";
  const duree1Col = columns.duree1 || "Duree_1";
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
  const typeDocCol = columns.typeDoc || "Type_doc";
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
  const droppedStartDate = parseCalendarDate(msStartIso);
  const droppedEndDate = parseCalendarDate(msEndIso);
  const droppedStartIso = formatIsoDate(droppedStartDate);
  const droppedEndIso = formatIsoDate(droppedEndDate);

  const updates = {
    [lignePlanningField]: normalizedUniqueNumber,
  };
  if (droppedStartIso) {
    updates[demarrageCol] = droppedStartIso;
  }

  if (isCoffrageTypeDoc(typeDoc)) {
    let diffCoffrageDate = droppedEndDate || parseCalendarDate(currentRow[diffCoffrageCol]);
    const duree1 = toInteger(currentRow[duree1Col]);
    let dateLimiteDate = droppedStartDate || parseCalendarDate(currentRow[dateLimiteCol]);

    if (droppedEndIso) updates[diffCoffrageCol] = droppedEndIso;

    // Regle COFFRAGE: Date_limite est calculee a partir de Diff_coffrage - Duree_1 (semaines).
    if (diffCoffrageDate && duree1 != null && duree1 >= 0) {
      dateLimiteDate = subtractWeeksFromDate(diffCoffrageDate, duree1);
    } else if (droppedStartIso) {
      updates[dateLimiteCol] = droppedStartIso;
    }

    if (!diffCoffrageDate && dateLimiteDate && duree1 != null && duree1 >= 0) {
      diffCoffrageDate = addWeeksToDate(dateLimiteDate, duree1);
    }

    if (!dateLimiteDate && diffCoffrageDate && duree1 != null && duree1 >= 0) {
      dateLimiteDate = subtractWeeksFromDate(diffCoffrageDate, duree1);
    }

    const computedDateLimiteIso = formatIsoDate(dateLimiteDate);
    const computedDiffCoffrageIso = formatIsoDate(diffCoffrageDate);
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

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      table.sourceTable,
      recordId,
      updates,
    ],
  ]);
}

export async function updatePlanningGroupZoneFromPlanningDrop({
  sourceRowId,
  targetRowId,
}) {
  const table = APP_CONFIG.grist.planningTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table Planning_Projet manquant dans la configuration.");
  }

  const columns = table.columns || {};
  const idCol = columns.id || "id";
  const groupCol = String(columns.groupe || "Groupe").trim();
  const zoneCol = String(columns.zone || "Zone").trim();

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

  const targetGroupe = toText(targetRow[groupCol]);
  const targetZone = toText(targetRow[zoneCol]);
  const sourceGroupe = toText(sourceRow[groupCol]);
  const sourceZone = toText(sourceRow[zoneCol]);

  const updates = {};
  if (sourceGroupe !== targetGroupe) {
    updates[groupCol] = targetGroupe;
  }
  if (sourceZone !== targetZone) {
    updates[zoneCol] = targetZone;
  }

  if (!Object.keys(updates).length) {
    return {
      updated: false,
      groupe: targetGroupe,
      zone: targetZone,
    };
  }

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      table.sourceTable,
      sourceId,
      updates,
    ],
  ]);

  return {
    updated: true,
    groupe: targetGroupe,
    zone: targetZone,
  };
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
