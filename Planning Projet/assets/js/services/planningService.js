import { APP_CONFIG } from "../config.js";
import { toText } from "./gristService.js";
import {
  buildPlanningIndiceProgress,
  buildTargetIndiceByTypeFromAvancement,
  computePlanningRealisationValue,
  getPlanningIndiceRank,
  getTargetIndiceForDocumentType,
  normalizePlanningDocumentType,
  normalizePlanningIndice,
} from "../../../../gestion-depenses2/assets/js/utils/planningRealisation.js";

function toNumber(value) {
  if (value == null || value === "") return null;
  const normalizedValue =
    typeof value === "string" ? value.trim().replace(/\s/g, "").replace(",", ".") : value;
  const n = Number(normalizedValue);
  return Number.isFinite(n) ? n : null;
}

function formatPositiveRetardValue(value) {
  const numericValue = toNumber(value);
  return numericValue != null && numericValue > 0 ? String(Math.trunc(numericValue)) : "";
}

function parseDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    let n = value;

    // timestamp en secondes -> ms
    if (n > 1e9 && n < 1e11) n *= 1000;

    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const str = String(value).trim();
  if (!str) return null;

  // DD/MM/YYYY
  const frMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);

    const d = new Date(year, month - 1, day);
    if (
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    ) {
      return d;
    }
    return null;
  }

  // ISO
  const iso = new Date(str);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function subtractWeeks(date, weeks) {
  return addDays(date, -(weeks * 7));
}

function getCurrentInstant() {
  return new Date();
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDelayDays(segmentEndDate, referenceDate) {
  if (
    !(segmentEndDate instanceof Date) ||
    Number.isNaN(segmentEndDate.getTime()) ||
    !(referenceDate instanceof Date) ||
    Number.isNaN(referenceDate.getTime())
  ) {
    return 0;
  }

  const segmentEndDay = startOfDay(segmentEndDate);
  const referenceDay = startOfDay(referenceDate);
  if (referenceDay <= segmentEndDay) {
    return 0;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((referenceDay.getTime() - segmentEndDay.getTime()) / msPerDay);
  return Math.max(0, diffDays);
}

function isAllowedTypeDoc(value) {
  return Boolean(toText(value));
}

function isCoffrageTypeDoc(value) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("COFFRAGE");
}

function isArmaturesTypeDoc(value) {
  const normalized = String(value ?? "").toUpperCase();
  return normalized.includes("ARMATURES");
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

function isCustomTypeDoc(value) {
  if (!toText(value)) return false;
  const normalizedType = normalizePlanningDocumentType(value);
  return !["NDC", "COFFRAGE", "ARMATURES", "DEMOLITION", "COUPES"].includes(normalizedType);
}

function normalizeProjectLookupKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildProjectRealisationTargetLookup(projectConfigs = []) {
  const lookup = new Map();

  (projectConfigs || []).forEach((projectConfig) => {
    const targetIndiceByType = buildTargetIndiceByTypeFromAvancement(
      projectConfig?.avancementConfigRaw
    );

    [
      projectConfig?.projectId,
      projectConfig?.projectName,
      projectConfig?.projectNumber,
    ].forEach((projectKey) => {
      const normalizedProjectKey = normalizeProjectLookupKey(projectKey);
      if (normalizedProjectKey && !lookup.has(normalizedProjectKey)) {
        lookup.set(normalizedProjectKey, targetIndiceByType);
      }
    });
  });

  return lookup;
}

function getProjectTargetIndiceByType(projectKey, targetLookup) {
  if (!(targetLookup instanceof Map)) {
    return null;
  }

  return targetLookup.get(normalizeProjectLookupKey(projectKey)) || null;
}

function getPlanningTargetIndice(typeDoc, projectKey, targetLookup) {
  return getTargetIndiceForDocumentType(
    typeDoc,
    getProjectTargetIndiceByType(projectKey, targetLookup)
  );
}

export function computePlanningRealiseValue(typeDoc, indice, targetIndice = "") {
  return computePlanningRealisationValue(typeDoc, indice, targetIndice);
}

function resolvePlanningSegmentEndDate({
  typeDoc,
  lignePlanningRaw,
  diffCoffrageRaw,
  diffArmatureRaw,
  demarrageRaw,
  duree3Raw,
}) {
  if (isCoffrageTypeDoc(typeDoc)) {
    return resolveCoffrageDiffCoffrageDate({
      typeDoc,
      lignePlanningRaw,
      diffCoffrageRaw,
      demarrageRaw,
      duree3Raw,
    });
  }

  if (isArmaturesTypeDoc(typeDoc)) {
    return parseDate(diffArmatureRaw);
  }

  if (isAllowedTypeDoc(typeDoc)) {
    return parseDate(diffCoffrageRaw);
  }

  return null;
}

export function computePlanningRetardValue(
  {
    typeDoc,
    indice,
    targetIndice,
    currentRetard,
    lignePlanningRaw,
    diffCoffrageRaw,
    diffArmatureRaw,
    demarrageRaw,
    duree3Raw,
    dateRealiseRaw,
  },
  currentInstant = getCurrentInstant()
) {
  if (!isAllowedTypeDoc(typeDoc)) {
    return 0;
  }

  const realiseValue = computePlanningRealiseValue(typeDoc, indice, targetIndice);
  const segmentEndDate = resolvePlanningSegmentEndDate({
    typeDoc,
    lignePlanningRaw,
    diffCoffrageRaw,
    diffArmatureRaw,
    demarrageRaw,
    duree3Raw,
  });

  if (realiseValue >= 100) {
    const dateRealise = parseDate(dateRealiseRaw);
    if (dateRealise && segmentEndDate) {
      return getDelayDays(segmentEndDate, dateRealise);
    }

    const frozenRetard = toNumber(currentRetard);
    return frozenRetard != null && frozenRetard >= 0 ? frozenRetard : 0;
  }

  if (!segmentEndDate) {
    return 0;
  }

  return getDelayDays(segmentEndDate, currentInstant);
}

export function buildPlanningRealiseUpdates(rawRows, targetLookup = null) {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink || cfg.nomProjet;

  return (rawRows || []).reduce((updates, row) => {
    const rowId = Number(row?.[cfg.id]);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return updates;
    }

    const typeDoc = toText(row?.[cfg.typeDoc]);
    const nextRealise = computePlanningRealiseValue(
      typeDoc,
      toText(row?.[cfg.indice]),
      getPlanningTargetIndice(typeDoc, row?.[projectLinkCol], targetLookup)
    );
    const currentRealise = toNumber(row?.[cfg.realise]);
    if (currentRealise === nextRealise) {
      return updates;
    }

    updates.push({
      id: rowId,
      realise: nextRealise,
    });
    return updates;
  }, []);
}

export function buildPlanningRetardUpdates(
  rawRows,
  currentInstant = getCurrentInstant(),
  targetLookup = null
) {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink || cfg.nomProjet;

  return (rawRows || []).reduce((updates, row) => {
    const rowId = Number(row?.[cfg.id]);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return updates;
    }

    const typeDoc = toText(row?.[cfg.typeDoc]);
    const nextRetard = computePlanningRetardValue(
      {
        typeDoc,
        indice: toText(row?.[cfg.indice]),
        targetIndice: getPlanningTargetIndice(typeDoc, row?.[projectLinkCol], targetLookup),
        currentRetard: row?.[cfg.retards],
        lignePlanningRaw: row?.[cfg.lignePlanning],
        diffCoffrageRaw: row?.[cfg.diffCoffrage],
        diffArmatureRaw: row?.[cfg.diffArmature],
        demarrageRaw: row?.[cfg.demarragesTravaux],
        duree3Raw: row?.[cfg.duree3],
        dateRealiseRaw: row?.[cfg.dateRealise],
      },
      currentInstant
    );
    const currentRetard = toNumber(row?.[cfg.retards]);
    if (currentRetard === nextRetard) {
      return updates;
    }

    updates.push({
      id: rowId,
      retards: nextRetard,
    });
    return updates;
  }, []);
}

function getPlanningDateSortValue(value) {
  const date = parseDate(value);
  return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

function normalizePlanningLinkPart(value) {
  return toText(value).toLocaleLowerCase("fr");
}

function buildPlanningLinkKey(project, numeroDocument, typeDocument, designation, zone = "") {
  return [
    normalizePlanningLinkPart(project),
    normalizePlanningLinkPart(numeroDocument),
    normalizePlanningLinkPart(typeDocument),
    normalizePlanningLinkPart(designation),
    normalizePlanningLinkPart(zone),
  ].join("||");
}

function buildPlanningLinkKeyWithoutDesignation(project, numeroDocument, typeDocument, zone = "") {
  return [
    normalizePlanningLinkPart(project),
    normalizePlanningLinkPart(numeroDocument),
    normalizePlanningLinkPart(typeDocument),
    normalizePlanningLinkPart(zone),
  ].join("||");
}

function getFirstPlanningValue(row, columnNames = []) {
  for (const columnName of columnNames) {
    if (row?.[columnName] != null && row?.[columnName] !== "") {
      return row[columnName];
    }
  }

  return "";
}

function buildProjectIdToNameLookup(projectConfigs = []) {
  const lookup = new Map();

  (projectConfigs || []).forEach((projectConfig) => {
    const projectId = toText(projectConfig?.projectId);
    const projectName = toText(projectConfig?.projectName);
    if (projectId && projectName && !lookup.has(projectId)) {
      lookup.set(projectId, projectName);
    }
  });

  return lookup;
}

function normalizeSyncProjectValue(value, projectIdToName = null) {
  const rawValue = toText(value);
  if (projectIdToName instanceof Map && projectIdToName.has(rawValue)) {
    return projectIdToName.get(rawValue);
  }

  return rawValue;
}

function shouldReplaceLatestPlanRecord(current, candidate) {
  if (!current) return true;
  if (candidate.indiceRank !== current.indiceRank) {
    return candidate.indiceRank > current.indiceRank;
  }

  return candidate.dateSortValue > current.dateSortValue;
}

function rememberLatestPlanRecord(map, key, candidate) {
  if (shouldReplaceLatestPlanRecord(map.get(key), candidate)) {
    map.set(key, candidate);
  }
}

function normalizeIsoDateValue(value) {
  const parsed = parseDate(value);
  if (parsed) {
    return fmtIsoCellDate(parsed);
  }

  return toText(value);
}

export function buildPlanningListePlanSyncUpdates(
  planningRows,
  listePlanRows,
  projectConfigs = [],
  targetLookup = null,
  currentInstant = getCurrentInstant()
) {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink || cfg.nomProjet;
  const projectIdToName = buildProjectIdToNameLookup(projectConfigs);
  const effectiveTargetLookup =
    targetLookup instanceof Map ? targetLookup : buildProjectRealisationTargetLookup(projectConfigs);

  const latestByKeyStrict = new Map();
  const latestByKeyNoDesignation = new Map();
  const latestByKeyStrictLegacy = new Map();
  const latestByKeyNoDesignationLegacy = new Map();

  (listePlanRows || []).forEach((row) => {
    const indice = normalizePlanningIndice(row?.Indice);
    const indiceRank = getPlanningIndiceRank(indice);
    const dateDiffusion = row?.DateDiffusion;
    const dateSortValue = getPlanningDateSortValue(dateDiffusion);
    if (!indice || indiceRank == null || !Number.isFinite(dateSortValue)) {
      return;
    }

    const projectValue = normalizeSyncProjectValue(
      getFirstPlanningValue(row, ["Nom_projet", "NomProjet"]),
      projectIdToName
    );
    const documentNumber = getFirstPlanningValue(row, ["NumeroDocument", "ID2"]);
    const typeDocument = getFirstPlanningValue(row, ["Type_document", "Type_doc", "TypeDoc"]);
    const designation = getFirstPlanningValue(row, ["Designation", "NomDocument", "Taches", "Tache"]);
    const zone = getFirstPlanningValue(row, ["Zone"]);
    const latestRecord = {
      indice,
      indiceRank,
      dateDiffusion,
      dateSortValue,
    };

    rememberLatestPlanRecord(
      latestByKeyStrict,
      buildPlanningLinkKey(projectValue, documentNumber, typeDocument, designation, zone),
      latestRecord
    );
    rememberLatestPlanRecord(
      latestByKeyNoDesignation,
      buildPlanningLinkKeyWithoutDesignation(projectValue, documentNumber, typeDocument, zone),
      latestRecord
    );
    rememberLatestPlanRecord(
      latestByKeyStrictLegacy,
      buildPlanningLinkKey(projectValue, documentNumber, typeDocument, designation),
      latestRecord
    );
    rememberLatestPlanRecord(
      latestByKeyNoDesignationLegacy,
      buildPlanningLinkKeyWithoutDesignation(projectValue, documentNumber, typeDocument),
      latestRecord
    );
  });

  return (planningRows || []).reduce((updates, row) => {
    const rowId = Number(row?.[cfg.id]);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return updates;
    }

    const projectValue = normalizeSyncProjectValue(row?.[projectLinkCol], projectIdToName);
    const documentNumber = row?.[cfg.id2];
    const typeDoc = toText(row?.[cfg.typeDoc]);
    const designation = row?.[cfg.taches] ?? row?.[cfg.tacheAlt];
    const zone = row?.[cfg.zone];

    const latestRecord =
      latestByKeyStrict.get(buildPlanningLinkKey(projectValue, documentNumber, typeDoc, designation, zone)) ??
      latestByKeyNoDesignation.get(buildPlanningLinkKeyWithoutDesignation(projectValue, documentNumber, typeDoc, zone)) ??
      latestByKeyStrictLegacy.get(buildPlanningLinkKey(projectValue, documentNumber, typeDoc, designation)) ??
      latestByKeyNoDesignationLegacy.get(buildPlanningLinkKeyWithoutDesignation(projectValue, documentNumber, typeDoc)) ??
      null;

    const targetIndice = getPlanningTargetIndice(typeDoc, projectValue, effectiveTargetLookup);
    const progress = buildPlanningIndiceProgress(
      latestRecord ? [latestRecord] : [],
      targetIndice
    );
    const latestIndice = progress.latestIndice;
    const targetRealise = progress.realisation;
    const nextDateRealise = progress.targetReached && progress.latestRecord
      ? fmtIsoCellDate(parseDate(progress.latestRecord.dateDiffusion))
      : null;
    const targetRetard = computePlanningRetardValue(
      {
        typeDoc,
        indice: latestIndice,
        targetIndice,
        currentRetard: row?.[cfg.retards],
        lignePlanningRaw: row?.[cfg.lignePlanning],
        diffCoffrageRaw: row?.[cfg.diffCoffrage],
        diffArmatureRaw: row?.[cfg.diffArmature],
        demarrageRaw: row?.[cfg.demarragesTravaux],
        duree3Raw: row?.[cfg.duree3],
        dateRealiseRaw: targetRealise >= 100 ? nextDateRealise : "",
      },
      currentInstant
    );

    const update = { id: rowId };
    if (toText(row?.[cfg.indice]) !== latestIndice) {
      update.indice = latestIndice;
    }
    if (toNumber(row?.[cfg.realise]) !== targetRealise) {
      update.realise = targetRealise;
    }
    if ((normalizeIsoDateValue(row?.[cfg.dateRealise]) || "") !== (nextDateRealise || "")) {
      update.dateRealise = nextDateRealise;
    }
    if (toNumber(row?.[cfg.retards]) !== targetRetard) {
      update.retards = targetRetard;
    }

    if (Object.keys(update).length > 1) {
      updates.push(update);
    }

    return updates;
  }, []);
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

function resolveCoffrageDiffCoffrageDate({
  typeDoc,
  lignePlanningRaw,
  diffCoffrageRaw,
  demarrageRaw,
  duree3Raw,
}) {
  if (!isCoffrageTypeDoc(typeDoc)) {
    return parseDate(diffCoffrageRaw);
  }

  if (!hasPlanningLinkValue(lignePlanningRaw)) {
    return parseDate(diffCoffrageRaw);
  }

  const demarrageDate = parseDate(demarrageRaw);
  const duree3Weeks = toNumber(duree3Raw);
  if (demarrageDate && duree3Weeks != null && duree3Weeks >= 0) {
    return subtractWeeks(demarrageDate, duree3Weeks);
  }

  return parseDate(diffCoffrageRaw);
}

function resolveCoffrageDateLimiteDate(dateLimiteRaw, diffCoffrageRaw, duree1Raw) {
  const diffCoffrageDate = parseDate(diffCoffrageRaw);
  const duree1Weeks = toNumber(duree1Raw);

  if (diffCoffrageDate && duree1Weeks != null && duree1Weeks >= 0) {
    return subtractWeeks(diffCoffrageDate, duree1Weeks);
  }

  return parseDate(dateLimiteRaw);
}

function resolveBandStartDate(typeDoc, dateLimiteRaw, diffCoffrageRaw, duree1Raw) {
  const normalized = String(typeDoc ?? "").toUpperCase();
  if (normalized.includes("ARMATURES")) return parseDate(diffCoffrageRaw);
  if (normalized.includes("COFFRAGE") || isNdcTypeDoc(typeDoc) || isCoupesTypeDoc(typeDoc) || isDemolitionTypeDoc(typeDoc)) {
    return resolveCoffrageDateLimiteDate(dateLimiteRaw, diffCoffrageRaw, duree1Raw);
  }
  if (isCustomTypeDoc(typeDoc)) return parseDate(dateLimiteRaw);
  return null;
}

function resolveBandEndDate(typeDoc, diffCoffrageRaw, diffArmatureRaw) {
  const normalized = String(typeDoc ?? "").toUpperCase();
  if (normalized.includes("ARMATURES")) return parseDate(diffArmatureRaw);
  if (normalized.includes("COFFRAGE") || isNdcTypeDoc(typeDoc) || isCoupesTypeDoc(typeDoc) || isDemolitionTypeDoc(typeDoc)) return parseDate(diffCoffrageRaw);
  if (isCustomTypeDoc(typeDoc)) return parseDate(diffCoffrageRaw);
  return null;
}

function resolveDisplayedDurations(
  typeDoc,
  duree1Raw,
  duree2Raw,
  duree3Raw,
  { showPlanningLinkedCoffrageDuration2 = false } = {}
) {
  if (isArmaturesTypeDoc(typeDoc)) {
    return {
      dureeDebutFin: toText(duree2Raw),
      dureeFinDemarrage: toText(duree3Raw),
    };
  }

  if (isCoffrageTypeDoc(typeDoc)) {
    return {
      dureeDebutFin: toText(duree1Raw),
      dureeFinDemarrage: showPlanningLinkedCoffrageDuration2
        ? toText(duree3Raw)
        : "",
    };
  }

  if (isNdcTypeDoc(typeDoc) || isCoupesTypeDoc(typeDoc) || isDemolitionTypeDoc(typeDoc)) {
    return {
      dureeDebutFin: toText(duree1Raw),
      dureeFinDemarrage: toText(duree3Raw),
    };
  }

  return {
    dureeDebutFin: "",
    dureeFinDemarrage: "",
  };
}

function fmtCellDate(date) {
  if (!date) return "";
  return date.toLocaleDateString("fr-FR");
}

function fmtIsoCellDate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(date) {
  if (!date) return "â€”";
  return date.toLocaleDateString("fr-FR");
}

function fmtDateIso(date) {
  if (!date) return "â€”";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isIsoDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function getInclusiveDaySpan(startDateValue, endDateValue) {
  if (!isIsoDateValue(startDateValue) || !isIsoDateValue(endDateValue)) {
    return 0;
  }

  const startDate = new Date(`${startDateValue}T12:00:00`);
  const endDate = new Date(`${endDateValue}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }

  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}

function getTimelineRowsDateBounds(rows) {
  let startDate = "";
  let endDate = "";

  (rows || []).forEach((row) => {
    const candidates = [row?.debutIso, row?.finIso, row?.demarrageIso]
      .map((value) => String(value || "").trim())
      .filter(isIsoDateValue);

    candidates.forEach((dateValue) => {
      if (!startDate || dateValue < startDate) {
        startDate = dateValue;
      }

      if (!endDate || dateValue > endDate) {
        endDate = dateValue;
      }
    });
  });

  if (!startDate || !endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
    spanDays: getInclusiveDaySpan(startDate, endDate),
  };
}

function getTimelineItemsDateBounds(items) {
  let startDate = "";
  let endDate = "";

  (items || []).forEach((item) => {
    if (item?.type === "background") {
      return;
    }

    const start = parseDate(item?.start);
    const end = parseDate(item?.end) || start;
    if (!start || !end) {
      return;
    }

    const startIso = fmtIsoCellDate(start);
    const endReferenceDate = new Date(Math.max(start.getTime(), end.getTime() - 1));
    const endIso = fmtIsoCellDate(endReferenceDate);
    if (!startIso || !endIso) {
      return;
    }

    if (!startDate || startIso < startDate) {
      startDate = startIso;
    }

    if (!endDate || endIso > endDate) {
      endDate = endIso;
    }
  });

  if (!startDate || !endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
    spanDays: getInclusiveDaySpan(startDate, endDate),
  };
}

function buildGroupContent(row) {
  const retardLabel = formatPositiveRetardValue(row.retards);
  const retardClassName = `cell-retards${retardLabel ? " has-retard" : ""}`;
  return `
    <div class="group-row-grid" style="display:grid;grid-template-columns:var(--col-id2) var(--col-task) var(--col-ligne-planning) var(--col-start) var(--col-duration-1) var(--col-end) var(--col-duration-2) var(--col-demarrage) var(--col-indice) var(--col-realise) var(--col-retards);align-items:center;width:var(--left-grid-width);min-height:var(--planning-row-height);padding:0 var(--left-pad-x);box-sizing:content-box;">
      <div class="cell-id2">${escapeHtml(row.id2 ?? "")}</div>
      <div class="cell-task">${escapeHtml(row.taches ?? "")}</div>
      <div class="cell-ligne-planning">${escapeHtml(row.lignePlanning ?? "")}</div>
      <div class="cell-start">${escapeHtml(row.debut ?? "")}</div>
      <div class="cell-duration-1">${escapeHtml(row.dureeDebutFin ?? "")}</div>
      <div class="cell-end">${escapeHtml(row.fin ?? "")}</div>
      <div class="cell-duration-2">${escapeHtml(row.dureeFinDemarrage ?? "")}</div>
      <div class="cell-demarrage">${escapeHtml(row.demarrage ?? "")}</div>
      <div class="cell-indice">${escapeHtml(row.indice ?? "")}</div>
      <div class="cell-realise">${escapeHtml(row.realise ?? "")}</div>
      <div class="${retardClassName}">${escapeHtml(retardLabel)}</div>
    </div>
  `;
}

function createPhaseItem({
  itemId,
  groupId,
  start,
  end,
  label,
  className,
  title,
  style = "",
}) {
  return {
    id: itemId,
    group: groupId,
    start,
    end,
    content: label,
    phaseLabel: label,
    className,
    title,
    type: "range",
    style,
  };
}

function clampPercentage(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, numericValue));
}

function getPhasePalette(className) {
  const normalizedClassName = String(className || "");

  if (normalizedClassName.includes("phase-coffrage")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#ead7a2",
        border: "#d6bd74",
        text: "#7a4b12",
        overdueBackground: "#d88f8f",
        overdueBorder: "#bb6b6b",
      };
    }

    return {
      background: "#fef3c7",
      border: "#fde68a",
      text: "#92400e",
      overdueBackground: "#d99b9b",
      overdueBorder: "#c97c7c",
    };
  }

  if (normalizedClassName.includes("phase-armature")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#e5e7eb",
        border: "#cbd5e1",
        text: "#334155",
        overdueBackground: "#efc2c2",
        overdueBorder: "#dc9f9f",
      };
    }

    return {
      background: "#f3f4f6",
      border: "#d1d5db",
      text: "#475569",
      overdueBackground: "#fee2e2",
      overdueBorder: "#fecaca",
    };
  }

  if (normalizedClassName.includes("phase-ndc")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#d8d2e6",
        border: "#b8aecf",
        text: "#3f365a",
        overdueBackground: "#e3b7c4",
        overdueBorder: "#c991a4",
      };
    }

    return {
      background: "#e9e6f2",
      border: "#c9c0de",
      text: "#4d426a",
      overdueBackground: "#efd0d9",
      overdueBorder: "#d8a8b8",
    };
  }

  if (normalizedClassName.includes("phase-coupes")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#b8e8d0",
        border: "#2da862",
        text: "#14452a",
        overdueBackground: "#fef08a",
        overdueBorder: "#facc15",
      };
    }

    return {
      background: "#d4f7e6",
      border: "#43CD80",
      text: "#1a5c38",
      overdueBackground: "#fef9c3",
      overdueBorder: "#fde047",
    };
  }

  if (normalizedClassName.includes("phase-demolition")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#f5cfcf",
        border: "#a80000",
        text: "#5c0000",
        overdueBackground: "#fde68a",
        overdueBorder: "#f59e0b",
      };
    }

    return {
      background: "#fde8e8",
      border: "#CD0000",
      text: "#7a0000",
      overdueBackground: "#fef3c7",
      overdueBorder: "#fcd34d",
    };
  }

  if (normalizedClassName.includes("phase-generic")) {
    if (normalizedClassName.includes("phase-past")) {
      return {
        background: "#cde4e7",
        border: "#9bc9cf",
        text: "#164e63",
        overdueBackground: "#e1b6be",
        overdueBorder: "#c98794",
      };
    }

    return {
      background: "#e0f2f1",
      border: "#99d5d1",
      text: "#155e75",
      overdueBackground: "#f3cbd2",
      overdueBorder: "#dda6b0",
    };
  }

  return null;
}

function buildRetardPhaseStyle(className, realiseValue, retardDays) {
  const palette = getPhasePalette(className);
  if (!palette) {
    return "";
  }

  const normalizedRetardDays = toNumber(retardDays);
  if (normalizedRetardDays == null || normalizedRetardDays <= 0) {
    return "";
  }

  const normalizedRealise = clampPercentage(realiseValue);
  if (normalizedRealise >= 100) {
    return "";
  }

  if (normalizedRealise <= 0) {
    return [
      `background: ${palette.overdueBackground} !important`,
      `border-color: ${palette.overdueBorder} !important`,
      `color: ${palette.text} !important`,
    ].join("; ");
  }

  return [
    `background: linear-gradient(to right, ${palette.background} 0%, ${palette.background} ${normalizedRealise}%, ${palette.overdueBackground} ${normalizedRealise}%, ${palette.overdueBackground} 100%) !important`,
    `border-color: ${palette.border} !important`,
    `color: ${palette.text} !important`,
  ].join("; ");
}

function buildPhaseClassName(className, realiseValue) {
  return clampPercentage(realiseValue) >= 100
    ? `${className} phase-realise-complete`
    : className;
}

function createSplitPhaseItems({
  itemIdBase,
  groupId,
  start,
  end,
  label,
  className,
  title,
  style = "",
  pastStyle = "",
}) {
  const currentInstant = getCurrentInstant();

  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) {
    return [];
  }

  if (end <= currentInstant) {
    return [
      createPhaseItem({
        itemId: itemIdBase,
        groupId,
        start,
        end,
        label,
        className: `${className} phase-past`,
        title,
        style: pastStyle,
      }),
    ];
  }

  if (start >= currentInstant) {
    return [
      createPhaseItem({
        itemId: itemIdBase,
        groupId,
        start,
        end,
        label,
        className,
        title,
        style,
      }),
    ];
  }

  return [
    createPhaseItem({
      itemId: `${itemIdBase}-past`,
      groupId,
      start,
      end: currentInstant,
      label: "",
      className: `${className} phase-past`,
      title,
      style: pastStyle,
    }),
    createPhaseItem({
      itemId: `${itemIdBase}-current`,
      groupId,
      start: currentInstant,
      end,
      label,
      className,
      title,
      style,
    }),
  ];
}

function createRangeFromStartAndWeeks(startDateRaw, weeksRaw) {
  const start = parseDate(startDateRaw);
  const weeks = toNumber(weeksRaw);

  if (!start || weeks == null || weeks <= 0) return null;

  const end = addWeeks(start, weeks);
  return { start, end, durationLabel: `${weeks} sem.` };
}

function createRangeFromStartAndDays(startDateRaw, daysRaw) {
  const start = parseDate(startDateRaw);
  const days = toNumber(daysRaw);

  if (!start || days == null || days <= 0) return null;

  const end = addDays(start, days);
  return { start, end, durationLabel: `${days} j` };
}

function createRangeBetweenDates(startDateRaw, endDateRaw) {
  const start = parseDate(startDateRaw);
  const end = parseDate(endDateRaw);
  if (!start || !end) return null;
  if (end <= start) return null;
  return { start, end };
}

function resolveDurationEditMeta(
  typeDoc,
  bandEndDate,
  demarrageDate,
  { allowPlanningLinkedCoffrageDuration2 = false } = {}
) {
  if (isArmaturesTypeDoc(typeDoc)) {
    return {
      dureeDebutFinColumnKey: "duree2",
      dureeDebutFinLeftDateColumnKey: "diffCoffrage",
      dureeDebutFinRightIso: fmtIsoCellDate(bandEndDate),
      dureeDebutFinEditable: Boolean(bandEndDate),
      dureeFinDemarrageColumnKey: "duree3",
      dureeFinDemarrageLeftDateColumnKey: "diffArmature",
      dureeFinDemarrageRightIso: fmtIsoCellDate(demarrageDate),
      dureeFinDemarrageEditable: Boolean(demarrageDate),
    };
  }

  if (isCoffrageTypeDoc(typeDoc)) {
    return {
      dureeDebutFinColumnKey: "duree1",
      dureeDebutFinLeftDateColumnKey: "dateLimite",
      dureeDebutFinRightIso: fmtIsoCellDate(bandEndDate),
      dureeDebutFinEditable: Boolean(bandEndDate),
      dureeFinDemarrageColumnKey: allowPlanningLinkedCoffrageDuration2
        ? "duree3"
        : "",
      dureeFinDemarrageLeftDateColumnKey: allowPlanningLinkedCoffrageDuration2
        ? "diffCoffrage"
        : "",
      dureeFinDemarrageRightIso: allowPlanningLinkedCoffrageDuration2
        ? fmtIsoCellDate(demarrageDate)
        : "",
      dureeFinDemarrageEditable: allowPlanningLinkedCoffrageDuration2 && Boolean(demarrageDate),
    };
  }

  if (isNdcTypeDoc(typeDoc) || isCoupesTypeDoc(typeDoc) || isDemolitionTypeDoc(typeDoc)) {
    return {
      dureeDebutFinColumnKey: "duree1",
      dureeDebutFinLeftDateColumnKey: "dateLimite",
      dureeDebutFinRightIso: fmtIsoCellDate(bandEndDate),
      dureeDebutFinEditable: Boolean(bandEndDate),
      dureeFinDemarrageColumnKey: "duree3",
      dureeFinDemarrageLeftDateColumnKey: "diffCoffrage",
      dureeFinDemarrageRightIso: fmtIsoCellDate(demarrageDate),
      dureeFinDemarrageEditable: Boolean(demarrageDate),
    };
  }

  return {
    dureeDebutFinColumnKey: "",
    dureeDebutFinLeftDateColumnKey: "",
    dureeDebutFinRightIso: "",
    dureeDebutFinEditable: false,
    dureeFinDemarrageColumnKey: "",
    dureeFinDemarrageLeftDateColumnKey: "",
    dureeFinDemarrageRightIso: "",
    dureeFinDemarrageEditable: false,
  };
}

function compareRowsBaseOrder(a, b) {
  const aLine = a.lignePlanningNum;
  const bLine = b.lignePlanningNum;
  if (aLine != null && bLine != null && aLine !== bLine) return aLine - bLine;
  if (aLine != null && bLine == null) return -1;
  if (aLine == null && bLine != null) return 1;

  const aId2 = a.id2Num;
  const bId2 = b.id2Num;
  if (aId2 != null && bId2 != null && aId2 !== bId2) return aId2 - bId2;
  if (aId2 != null && bId2 == null) return -1;
  if (aId2 == null && bId2 != null) return 1;

  const typeCmp = (a.typeDoc || "").localeCompare(b.typeDoc || "", "fr");
  if (typeCmp !== 0) return typeCmp;

  return (a.taches || "").localeCompare(b.taches || "", "fr");
}

function compareNullableDatesAsc(aDate, bDate) {
  const aValid = aDate instanceof Date && !Number.isNaN(aDate.getTime());
  const bValid = bDate instanceof Date && !Number.isNaN(bDate.getTime());
  if (aValid && bValid) {
    if (aDate.valueOf() !== bDate.valueOf()) {
      return aDate - bDate;
    }
    return 0;
  }
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return 0;
}

function compareRowsChronologicalOrder(a, b) {
  const dateCmp = compareNullableDatesAsc(a?.dateLimiteDate, b?.dateLimiteDate);
  if (dateCmp !== 0) return dateCmp;
  return compareRowsBaseOrder(a, b);
}

function compareArmaturesByDemarrageOrder(a, b) {
  const demarrageCmp = compareNullableDatesAsc(
    a?.demarragesTravauxDate,
    b?.demarragesTravauxDate
  );
  if (demarrageCmp !== 0) return demarrageCmp;
  return compareRowsChronologicalOrder(a, b);
}

function getGroupMinDateLimite(rows) {
  let minDate = null;
  for (const row of rows || []) {
    const date = row?.dateLimiteDate;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    if (!minDate || date < minDate) {
      minDate = date;
    }
  }
  return minDate;
}

function compareZoneKeys(a, b) {
  const aKey = String(a ?? "");
  const bKey = String(b ?? "");
  if (aKey && bKey) {
    const cmp = aKey.localeCompare(bKey, "fr", {
      sensitivity: "base",
      numeric: true,
    });
    if (cmp !== 0) return cmp;
  }
  if (aKey && !bKey) return -1;
  if (!aKey && bKey) return 1;
  return 0;
}

function buildGroupCompositeKey(zoneKey, groupeKey) {
  const g = String(groupeKey ?? "");
  if (!g) return "";
  const z = String(zoneKey ?? "");
  return `${z}||${g}`;
}

function formatZoneHeaderLabel(zoneLabel) {
  const normalized = String(zoneLabel ?? "").trim();
  if (!normalized) return "Sans zone";
  return normalized;
}

export function buildTimelineDataFromPlanningRows(
  rawRows,
  selectedProject = "",
  selectedZone = "",
  targetLookup = null
) {
  const cfg = APP_CONFIG.grist.planningTable.columns;
  const projectLinkCol = cfg.projectLink || cfg.nomProjet;
  const selectedZoneKey = String(selectedZone ?? "")
    .trim()
    .toLocaleLowerCase("fr");

  // Toutes les lignes du projet (y compris sans typeDoc) pour le catalogue de zones.
  const allProjectRows = !selectedProject
    ? []
    : (rawRows || []).filter((row) => {
        if (projectLinkCol && toText(row?.[projectLinkCol]) !== selectedProject) {
          return false;
        }
        const zoneKey = toText(row?.[cfg.zone]).toLocaleLowerCase("fr");
        if (selectedZoneKey && zoneKey !== selectedZoneKey) {
          return false;
        }
        return true;
      });

  const sourceRows = allProjectRows.filter((row) => isAllowedTypeDoc(row?.[cfg.typeDoc]));

  let rows = sourceRows.map((r) => {
    const id2Text = toText(r[cfg.id2]);
    const groupeText = toText(r[cfg.groupe]);
    const zoneText = toText(r[cfg.zone]);
    const lignePlanningText = toText(r[cfg.lignePlanning]);
    const tachesText = toText(r[cfg.taches]) || toText(r[cfg.tacheAlt]);
    const typeDocText = toText(r[cfg.typeDoc]);
    const projectLinkText = projectLinkCol ? toText(r[projectLinkCol]) : "";
    const targetIndice = getPlanningTargetIndice(typeDocText, projectLinkText, targetLookup);
    const dateLimiteValue = r[cfg.dateLimite];
    const diffCoffrageValue = r[cfg.diffCoffrage];
    const diffArmatureValue = r[cfg.diffArmature];
    const duree1Value = r[cfg.duree1];
    const duree2Value = r[cfg.duree2];
    const duree3Value = r[cfg.duree3];
    const demarrageTravauxValue = r[cfg.demarragesTravaux];
    const demarrageTravauxDate = parseDate(demarrageTravauxValue);
    const isCoffrage = isCoffrageTypeDoc(typeDocText);
    const isNdc = isNdcTypeDoc(typeDocText);
    const isCoupes = isCoupesTypeDoc(typeDocText);
    const isDemolition = isDemolitionTypeDoc(typeDocText);
    const isPlanningLinkedCoffrage =
      isCoffrage && hasPlanningLinkValue(lignePlanningText);
    const resolvedDiffCoffrageDate = resolveCoffrageDiffCoffrageDate({
      typeDoc: typeDocText,
      lignePlanningRaw: lignePlanningText,
      diffCoffrageRaw: diffCoffrageValue,
      demarrageRaw: demarrageTravauxValue,
      duree3Raw: duree3Value,
    });
    const diffCoffrageForDisplay = resolvedDiffCoffrageDate || diffCoffrageValue;
    const dateLimiteDate = isCoffrage || isNdc || isCoupes || isDemolition
      ? resolveCoffrageDateLimiteDate(
          dateLimiteValue,
          diffCoffrageForDisplay,
          duree1Value
        )
      : parseDate(dateLimiteValue);
    const bandStartDate = resolveBandStartDate(
      typeDocText,
      dateLimiteValue,
      diffCoffrageForDisplay,
      duree1Value
    );
    const bandEndDate = resolveBandEndDate(
      typeDocText,
      diffCoffrageForDisplay,
      diffArmatureValue
    );
    const demarrageDisplayDate =
      !isCoffrage || isPlanningLinkedCoffrage ? demarrageTravauxDate : null;
    const displayedDurations = resolveDisplayedDurations(
      typeDocText,
      duree1Value,
      duree2Value,
      duree3Value,
      {
        showPlanningLinkedCoffrageDuration2: isPlanningLinkedCoffrage,
      }
    );
    const durationEditMeta = resolveDurationEditMeta(
      typeDocText,
      bandEndDate,
      demarrageTravauxDate,
      {
        allowPlanningLinkedCoffrageDuration2: isPlanningLinkedCoffrage,
      }
    );

    return {
      rowId: r[cfg.id] ?? null,
      projectLink: projectLinkText,

      // Colonnes affichees
      id2: id2Text,
      groupe: groupeText,
      groupeKey: !(isNdc || isCoupes || isDemolition) && groupeText ? groupeText.toLocaleLowerCase("fr") : "",
      zone: zoneText,
      zoneKey: zoneText ? zoneText.toLocaleLowerCase("fr") : "",
      groupCompositeKey: (isNdc || isCoupes || isDemolition)
        ? ""
        : buildGroupCompositeKey(
            zoneText ? zoneText.toLocaleLowerCase("fr") : "",
            groupeText ? groupeText.toLocaleLowerCase("fr") : ""
          ),
      taches: tachesText,
      typeDoc: typeDocText,
      debut: fmtCellDate(bandStartDate),
      fin: fmtCellDate(bandEndDate),
      demarrage: fmtCellDate(demarrageDisplayDate),
      debutIso: fmtIsoCellDate(bandStartDate),
      finIso: fmtIsoCellDate(bandEndDate),
      demarrageIso: fmtIsoCellDate(demarrageDisplayDate),
      dureeDebutFin: displayedDurations.dureeDebutFin,
      dureeFinDemarrage: displayedDurations.dureeFinDemarrage,
      dureeDebutFinColumnKey: durationEditMeta.dureeDebutFinColumnKey,
      dureeDebutFinLeftDateColumnKey: durationEditMeta.dureeDebutFinLeftDateColumnKey,
      dureeDebutFinRightIso: durationEditMeta.dureeDebutFinRightIso,
      dureeDebutFinEditable: durationEditMeta.dureeDebutFinEditable,
      dureeFinDemarrageColumnKey: durationEditMeta.dureeFinDemarrageColumnKey,
      dureeFinDemarrageLeftDateColumnKey: durationEditMeta.dureeFinDemarrageLeftDateColumnKey,
      dureeFinDemarrageRightIso: durationEditMeta.dureeFinDemarrageRightIso,
      dureeFinDemarrageEditable: durationEditMeta.dureeFinDemarrageEditable,
      lignePlanning: lignePlanningText,
      hasPlanningLink: isPlanningLinkedCoffrage,

      // Valeurs numeriques de tri (robustes)
      id2Num: toNumber(id2Text),
      lignePlanningNum: toNumber(lignePlanningText),

      // Phases planning
      dateLimite: dateLimiteDate || dateLimiteValue,
      dateLimiteDate,
      duree1: duree1Value,

      diffCoffrage: diffCoffrageForDisplay,
      duree2: duree2Value,

      diffArmature: diffArmatureValue,
      duree3: duree3Value,

      demarragesTravaux: demarrageTravauxValue,
      demarragesTravauxDate: demarrageTravauxDate,
      indice: toText(r[cfg.indice]),
      targetIndice,
      realise: (() => {
        const computedRealise = computePlanningRealiseValue(
          typeDocText,
          toText(r[cfg.indice]),
          targetIndice
        );
        return String(computedRealise ?? 0);
      })(),
      retards: toText(r[cfg.retards]),
      remarque: toText(r[cfg.remarque || "Remarque"]),
    };
  });

  // Catalogue de zones construit depuis toutes les lignes du projet,
  // y compris les lignes sans typeDoc utilisées comme marqueurs de zone.
  const zoneCatalog = new Map();
  allProjectRows.forEach((row) => {
    const zoneText = toText(row[cfg.zone]);
    const zoneKey = zoneText.toLocaleLowerCase("fr");
    if (!zoneCatalog.has(zoneKey)) {
      zoneCatalog.set(zoneKey, zoneText);
    }
  });
  // Complète avec les zones issues des lignes traitées (sécurité).
  rows.forEach((row) => {
    const zoneKey = String(row.zoneKey || "");
    if (!zoneCatalog.has(zoneKey)) {
      zoneCatalog.set(zoneKey, String(row.zone || ""));
    }
  });
  // "Sans zone" toujours présente par défaut.
  if (!zoneCatalog.has("")) {
    zoneCatalog.set("", "");
  }

  const minArmatureDiffByGroup = new Map();
  rows.forEach((row) => {
    if (!row.groupCompositeKey || !isArmaturesTypeDoc(row.typeDoc)) return;
    const armatureDiffDate = parseDate(row.diffCoffrage);
    if (!armatureDiffDate) return;

    const existingMin = minArmatureDiffByGroup.get(row.groupCompositeKey);
    if (!existingMin || armatureDiffDate < existingMin) {
      minArmatureDiffByGroup.set(row.groupCompositeKey, armatureDiffDate);
    }
  });

  rows = rows.map((row) => {
    if (
      !row.groupCompositeKey ||
      !isCoffrageTypeDoc(row.typeDoc) ||
      row.hasPlanningLink
    ) {
      return row;
    }

    const resolvedDiffCoffrage = minArmatureDiffByGroup.get(row.groupCompositeKey);
    if (!resolvedDiffCoffrage) return row;

    const normalizedDiffCoffrage = new Date(resolvedDiffCoffrage);
    const normalizedDateLimite = resolveCoffrageDateLimiteDate(
      row.dateLimite,
      normalizedDiffCoffrage,
      row.duree1
    );
    const durationEditMeta = resolveDurationEditMeta(
      row.typeDoc,
      normalizedDiffCoffrage,
      parseDate(row.demarragesTravaux),
      {
        allowPlanningLinkedCoffrageDuration2: Boolean(row.hasPlanningLink),
      }
    );

    return {
      ...row,
      dateLimite: normalizedDateLimite || row.dateLimite,
      dateLimiteDate: normalizedDateLimite || row.dateLimiteDate,
      debut: fmtCellDate(normalizedDateLimite || row.dateLimiteDate),
      debutIso: fmtIsoCellDate(normalizedDateLimite || row.dateLimiteDate),
      diffCoffrage: normalizedDiffCoffrage,
      fin: fmtCellDate(normalizedDiffCoffrage),
      finIso: fmtIsoCellDate(normalizedDiffCoffrage),
      ...durationEditMeta,
    };
  });

  rows.sort(compareRowsChronologicalOrder);

  const groupedRows = new Map();
  const ungroupedRows = [];

  rows.forEach((row) => {
    if (!row.groupCompositeKey) {
      ungroupedRows.push(row);
      return;
    }

    if (!groupedRows.has(row.groupCompositeKey)) {
      groupedRows.set(row.groupCompositeKey, {
        zoneKey: row.zoneKey || "",
        zoneLabel: row.zone || "",
        groupeKey: row.groupeKey || "",
        groupeLabel: row.groupe || "",
        coffrage: [],
        armatures: [],
        others: [],
      });
    }

    const bucket = groupedRows.get(row.groupCompositeKey);
    if (isCoffrageTypeDoc(row.typeDoc)) {
      bucket.coffrage.push(row);
    } else if (isArmaturesTypeDoc(row.typeDoc)) {
      bucket.armatures.push(row);
    } else {
      bucket.others.push(row);
    }
  });

  const groupedEntries = [...groupedRows.values()].map((bucket) => {
    bucket.coffrage.sort(compareRowsChronologicalOrder);
    bucket.armatures.sort(compareArmaturesByDemarrageOrder);
    bucket.others.sort(compareRowsChronologicalOrder);

    const orderedRows = [...bucket.coffrage, ...bucket.armatures, ...bucket.others];
    const minDateLimite = getGroupMinDateLimite(orderedRows);

    return {
      zoneKey: bucket.zoneKey || "",
      zoneLabel: bucket.zoneLabel || "",
      groupeKey: bucket.groupeKey || "",
      groupeLabel: bucket.groupeLabel || "",
      minDateLimite,
      orderedRows,
    };
  });

  groupedEntries.sort((a, b) => {
    const zoneCmp = compareZoneKeys(a.zoneKey, b.zoneKey);
    if (zoneCmp !== 0) return zoneCmp;

    const chronoCmp = compareNullableDatesAsc(a.minDateLimite, b.minDateLimite);
    if (chronoCmp !== 0) return chronoCmp;

    const groupCmp = String(a.groupeLabel || a.groupeKey || "").localeCompare(
      String(b.groupeLabel || b.groupeKey || ""),
      "fr",
      { sensitivity: "base", numeric: true }
    );
    if (groupCmp !== 0) return groupCmp;

    const aFirst = a.orderedRows[0];
    const bFirst = b.orderedRows[0];
    if (aFirst && bFirst) {
      return compareRowsBaseOrder(aFirst, bFirst);
    }

    return 0;
  });

  ungroupedRows.sort((a, b) => {
    const zoneCmp = compareZoneKeys(a.zoneKey, b.zoneKey);
    if (zoneCmp !== 0) return zoneCmp;
    return compareRowsChronologicalOrder(a, b);
  });

  rows = [];
  groupedEntries.forEach((entry) => {
    rows.push(...entry.orderedRows);
  });
  rows.push(...ungroupedRows);

  const rowsByZone = new Map();
  rows.forEach((row) => {
    const zoneKey = String(row.zoneKey || "");
    if (!rowsByZone.has(zoneKey)) {
      rowsByZone.set(zoneKey, []);
    }
    rowsByZone.get(zoneKey).push(row);
  });

  for (const [zoneKey, zoneRows] of rowsByZone.entries()) {
    if (zoneCatalog.has(zoneKey)) continue;
    zoneCatalog.set(zoneKey, String(zoneRows?.[0]?.zone || ""));
  }

  const orderedZoneKeys = [...new Set([...zoneCatalog.keys(), ...rowsByZone.keys()])].sort(
    compareZoneKeys
  );

  const groups = [];
  const items = [];
  let groupSortIndex = 0;
  let zoneHeaderIndex = 0;
  let fallbackRowIndex = 0;

  const appendPlanningRow = (row) => {
    const rowFallbackIndex = fallbackRowIndex++;
    const groupId = `g-${row.rowId ?? `${row.id2 || "x"}-${row.lignePlanning || "x"}-${rowFallbackIndex}`}`;
    const realiseValue =
      toNumber(row.realise) ?? computePlanningRealiseValue(row.typeDoc, row.indice, row.targetIndice);

    // Groupe avec champs de tri explicites (pour vis-timeline)
    groups.push({
      id: groupId,
      rowId: row.rowId,
      isZoneHeader: false,
      className: "planning-row-group",
      content: buildGroupContent(row),
      projectLabel: row.projectLink ?? "",
      id2Label: row.id2 ?? "",
      tachesLabel: row.taches ?? "",
      typeDocLabel: row.typeDoc ?? "",
      groupeLabel: row.groupe ?? "",
      zoneLabel: row.zone ?? "",
      debutLabel: row.debut ?? "",
      debutIso: row.debutIso ?? "",
      dureeDebutFinLabel: row.dureeDebutFin ?? "",
      dureeDebutFinColumnKey: row.dureeDebutFinColumnKey ?? "",
      dureeDebutFinLeftDateColumnKey: row.dureeDebutFinLeftDateColumnKey ?? "",
      dureeDebutFinRightIso: row.dureeDebutFinRightIso ?? "",
      dureeDebutFinEditable: Boolean(row.dureeDebutFinEditable),
      finLabel: row.fin ?? "",
      finIso: row.finIso ?? "",
      dureeFinDemarrageLabel: row.dureeFinDemarrage ?? "",
      dureeFinDemarrageColumnKey: row.dureeFinDemarrageColumnKey ?? "",
      dureeFinDemarrageLeftDateColumnKey: row.dureeFinDemarrageLeftDateColumnKey ?? "",
      dureeFinDemarrageRightIso: row.dureeFinDemarrageRightIso ?? "",
      dureeFinDemarrageEditable: Boolean(row.dureeFinDemarrageEditable),
      demarrageLabel: row.demarrage ?? "",
      demarrageIso: row.demarrageIso ?? "",
      lignePlanningLabel: row.lignePlanning ?? "",
      indiceLabel: row.indice ?? "",
      realiseLabel: row.realise ?? "",
      retardsLabel: row.retards ?? "",
      remarqueLabel: row.remarque ?? "",

      // Champs de tri explicites (plus fiable que meta uniquement)
      sortIndex: groupSortIndex++,
      sortLignePlanning: row.lignePlanningNum ?? Number.MAX_SAFE_INTEGER,
      sortID2: row.id2Num ?? Number.MAX_SAFE_INTEGER,

      // On garde meta pour debug / usages futurs
      meta: row,
    });

    if (isCoffrageTypeDoc(row.typeDoc)) {
      // COFFRAGE : Date_limite -> Diff_coffrage
      const pCoffrage = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
      if (pCoffrage) {
        const coffrageClassName = buildPhaseClassName("phase-coffrage", realiseValue);
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-coffrage`,
            groupId,
            start: pCoffrage.start,
            end: pCoffrage.end,
            label: "Coffrage",
            className: coffrageClassName,
            style: buildRetardPhaseStyle(coffrageClassName, realiseValue, row.retards),
            pastStyle: buildRetardPhaseStyle(
              `${coffrageClassName} phase-past`,
              realiseValue,
              row.retards
            ),
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              Coffrage<br>
              Date limite : ${fmtDate(pCoffrage.start)} (${fmtDateIso(pCoffrage.start)})<br>
              Diff coffrage : ${fmtDate(pCoffrage.end)} (${fmtDateIso(pCoffrage.end)})
            `,
          })
        );
      }
    } else if (isArmaturesTypeDoc(row.typeDoc)) {
      // ARMATURES : Diff_coffrage -> Diff_armature
      const pArmature = createRangeBetweenDates(row.diffCoffrage, row.diffArmature);
      if (pArmature) {
        const armatureClassName = buildPhaseClassName("phase-armature", realiseValue);
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-armature`,
            groupId,
            start: pArmature.start,
            end: pArmature.end,
            label: "Armature",
            className: armatureClassName,
            style: buildRetardPhaseStyle(armatureClassName, realiseValue, row.retards),
            pastStyle: buildRetardPhaseStyle(
              `${armatureClassName} phase-past`,
              realiseValue,
              row.retards
            ),
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              Armature<br>
              Diff coffrage : ${fmtDate(pArmature.start)} (${fmtDateIso(pArmature.start)})<br>
              Diff armature : ${fmtDate(pArmature.end)} (${fmtDateIso(pArmature.end)})
            `,
          })
        );
      }
    } else if (isNdcTypeDoc(row.typeDoc)) {
      // NDC : Date_limite -> Diff_coffrage, sans logique de groupe.
      const pNdc = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
      if (pNdc) {
        const ndcClassName = buildPhaseClassName("phase-ndc", realiseValue);
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-ndc`,
            groupId,
            start: pNdc.start,
            end: pNdc.end,
            label: "NDC",
            className: ndcClassName,
            style: buildRetardPhaseStyle(ndcClassName, realiseValue, row.retards),
            pastStyle: buildRetardPhaseStyle(
              `${ndcClassName} phase-past`,
              realiseValue,
              row.retards
            ),
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              NDC<br>
              Date limite : ${fmtDate(pNdc.start)} (${fmtDateIso(pNdc.start)})<br>
              Diff coffrage : ${fmtDate(pNdc.end)} (${fmtDateIso(pNdc.end)})
            `,
          })
        );
      }
    } else if (isCoupesTypeDoc(row.typeDoc)) {
      // COUPES : Date_limite -> Diff_coffrage, sans logique de groupe.
      const pCoupes = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
      if (pCoupes) {
        const coupesClassName = buildPhaseClassName("phase-coupes", realiseValue);
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-coupes`,
            groupId,
            start: pCoupes.start,
            end: pCoupes.end,
            label: "COUPES",
            className: coupesClassName,
            style: buildRetardPhaseStyle(coupesClassName, realiseValue, row.retards),
            pastStyle: buildRetardPhaseStyle(
              `${coupesClassName} phase-past`,
              realiseValue,
              row.retards
            ),
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              COUPES<br>
              Date limite : ${fmtDate(pCoupes.start)} (${fmtDateIso(pCoupes.start)})<br>
              Diff coffrage : ${fmtDate(pCoupes.end)} (${fmtDateIso(pCoupes.end)})
            `,
          })
        );
      }
    } else if (isDemolitionTypeDoc(row.typeDoc)) {
      // DÉMOLITION : Date_limite -> Diff_coffrage, sans logique de groupe.
      const pDemolition = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
      if (pDemolition) {
        const demolitionClassName = buildPhaseClassName("phase-demolition", realiseValue);
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-demolition`,
            groupId,
            start: pDemolition.start,
            end: pDemolition.end,
            label: "DÉMOLITION",
            className: demolitionClassName,
            style: buildRetardPhaseStyle(demolitionClassName, realiseValue, row.retards),
            pastStyle: buildRetardPhaseStyle(
              `${demolitionClassName} phase-past`,
              realiseValue,
              row.retards
            ),
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              DÉMOLITION<br>
              Date limite : ${fmtDate(pDemolition.start)} (${fmtDateIso(pDemolition.start)})<br>
              Diff coffrage : ${fmtDate(pDemolition.end)} (${fmtDateIso(pDemolition.end)})
            `,
          })
        );
      }
    } else if (isCustomTypeDoc(row.typeDoc)) {
      const genericPhase = createRangeBetweenDates(row.dateLimite, row.diffCoffrage);
      if (genericPhase) {
        const genericLabel = toText(row.typeDoc) || "Type personnalisé";
        const genericClassName = buildPhaseClassName("phase-generic", realiseValue);
        items.push(
          ...createSplitPhaseItems({
            itemIdBase: `${groupId}-p-generic`,
            groupId,
            start: genericPhase.start,
            end: genericPhase.end,
            label: genericLabel,
            className: genericClassName,
            style: buildRetardPhaseStyle(genericClassName, realiseValue, row.retards),
            pastStyle: buildRetardPhaseStyle(
              `${genericClassName} phase-past`,
              realiseValue,
              row.retards
            ),
            title: `
              <b>${escapeHtml(row.taches || "Tache")}</b><br>
              ${escapeHtml(genericLabel)}<br>
              Date limite : ${fmtDate(genericPhase.start)} (${fmtDateIso(genericPhase.start)})<br>
              Diff coffrage : ${fmtDate(genericPhase.end)} (${fmtDateIso(genericPhase.end)})
            `,
          })
        );
      }
    }

    // Debut des travaux :
    // - ARMATURES : toujours visible
    // - COFFRAGE : visible seulement pour les coffrages individuels
    //   qui conservent encore leur lien direct avec MS Project
    const demarrageTravauxDate = parseDate(row.demarragesTravaux);
    const shouldShowDemarragePhase =
      demarrageTravauxDate &&
      (
        !isCoffrageTypeDoc(row.typeDoc) ||
        Boolean(row.hasPlanningLink)
      );
    if (shouldShowDemarragePhase) {
      const demarrageTravauxEnd = addDays(demarrageTravauxDate, 1);
      items.push(
        createPhaseItem({
          itemId: `${groupId}-demarrage`,
          groupId,
          start: demarrageTravauxDate,
          end: demarrageTravauxEnd,
          label: "",
          className: "phase-demarrage",
          title: `
            <b>${escapeHtml(row.taches || "Tache")}</b><br>
            Debut des travaux<br>
            ${fmtDate(demarrageTravauxDate)} (${fmtDateIso(demarrageTravauxDate)})
          `,
        })
      );
    }

    // Pas de barre "Retard" dans la timeline: affichage en colonne dédiée.
  };

  orderedZoneKeys.forEach((zoneKey) => {
    const zoneRows = rowsByZone.get(zoneKey) || [];
    const zoneLabel = String(zoneCatalog.get(zoneKey) ?? zoneRows?.[0]?.zone ?? "");
    const zoneHeaderId = `zone-${zoneHeaderIndex}-${zoneKey || "sans-zone"}`;
    zoneHeaderIndex += 1;

    groups.push({
      id: zoneHeaderId,
      rowId: null,
      isZoneHeader: true,
      zoneLabel,
      zoneHeaderLabel: formatZoneHeaderLabel(zoneLabel),
      className: "zone-header-group",
      sortIndex: groupSortIndex++,
      sortLignePlanning: Number.MIN_SAFE_INTEGER,
      sortID2: Number.MIN_SAFE_INTEGER,
      meta: {
        isZoneHeader: true,
        zoneKey,
        zoneLabel,
      },
    });

    items.push({
      id: `${zoneHeaderId}-bg`,
      group: zoneHeaderId,
      start: new Date(new Date().getFullYear() - 5, 0, 1),
      end: new Date(new Date().getFullYear() + 15, 11, 31),
      type: "background",
      className: "zone-header-fill",
      content: "",
    });

    zoneRows.forEach((row) => {
      appendPlanningRow(row);
    });
  });

  return {
    groups,
    items,
    rowCount: rows.length || orderedZoneKeys.length,
    dateBounds: getTimelineItemsDateBounds(items) || getTimelineRowsDateBounds(rows),
  };
}
