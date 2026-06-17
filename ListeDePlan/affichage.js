const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const DOCUMENT_PLANNING_TABLE_CANDIDATES = ["Planning_Projet", "Planning_Project"];
let projetsDictGlobal = null;
let planningRealisationHelpersPromise = null;
const collapsedPlanTypeGroups = new Set();
const collapsedPlanZoneGroups = new Set();

(async () => {
  await chargerProjetsMap();
})();

async function chargerProjetsMap() {
  if (projetsDictGlobal) return projetsDictGlobal;

  const data = await grist.docApi.fetchTable("Projets2");
  projetsDictGlobal = {};

  if (data && data.id && data.Nom_de_projet) {
    for (let i = 0; i < data.id.length; i++) {
      const nom = data.Nom_de_projet[i];
      const id = data.id[i];
      if (typeof nom === "string" && nom.trim()) {
        projetsDictGlobal[nom.trim()] = id;
      }
    }
  } else {
    console.error("Structure inattendue de la table Projet :", data);
  }
  return projetsDictGlobal;
}

function normalizeText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (typeof value.details === "string") return value.details.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
  }
  return String(value).trim();
}

function normalizeDocumentIdentityText(value) {
  return normalizeText(value)
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr");
}

function normalizeZoneText(value) {
  return normalizeText(value);
}

function compareNormalizedText(left, right, { blankLast = false } = {}) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (blankLast && !normalizedLeft && normalizedRight) return 1;
  if (blankLast && normalizedLeft && !normalizedRight) return -1;

  return normalizedLeft.localeCompare(normalizedRight, "fr", {
    sensitivity: "base",
    numeric: true
  });
}

function getRecordProjectName(record) {
  const rawValue = typeof record?.Nom_projet === "object" ? record?.Nom_projet?.details : record?.Nom_projet;
  const normalizedValue = normalizeText(rawValue);
  if (!normalizedValue || !projetsDictGlobal) return normalizedValue;

  const matchedProject = Object.entries(projetsDictGlobal).find(
    ([, projectId]) => normalizeText(projectId) === normalizedValue
  );
  return matchedProject ? matchedProject[0] : normalizedValue;
}

function getRecordTypeDocument(record) {
  return normalizeText(record?.Type_document);
}

function getRecordZone(record) {
  return normalizeZoneText(record?.Zone);
}

function formatZoneSectionTitle(zoneValue) {
  return normalizeZoneText(zoneValue) || "Sans zone";
}

function getPlanGroupKey(...values) {
  return JSON.stringify(values.map((value) => normalizeText(value)));
}

function findPlanGroupToggleButton(groupType, groupKey) {
  return Array.from(document.querySelectorAll("#plans-output .plan-group-toggle"))
    .find((button) =>
      button.dataset.groupType === groupType &&
      button.dataset.groupKey === groupKey
    ) || null;
}

function restorePlanGroupTogglePosition(groupType, groupKey, anchorTop, scrollContainer) {
  const nextButton = findPlanGroupToggleButton(groupType, groupKey);
  if (!nextButton) return;

  let topDelta = nextButton.getBoundingClientRect().top - anchorTop;
  if (scrollContainer) {
    scrollContainer.scrollTop += topDelta;
    topDelta = nextButton.getBoundingClientRect().top - anchorTop;
  }

  if (topDelta) {
    window.scrollBy(0, topDelta);
  }

  nextButton.focus({ preventScroll: true });
}

function togglePlanCollapsedGroup(groupType, groupKey, anchorButton = null) {
  const groups = groupType === "type" ? collapsedPlanTypeGroups : collapsedPlanZoneGroups;
  const anchorTop = anchorButton?.getBoundingClientRect().top ?? null;
  const scrollContainer = anchorButton?.closest("#plans-output") || null;

  if (groups.has(groupKey)) {
    groups.delete(groupKey);
  } else {
    groups.add(groupKey);
  }

  if (typeof refreshCurrentPlanDisplay === "function") {
    refreshCurrentPlanDisplay({ refreshZones: false });
  }

  if (anchorTop !== null) {
    restorePlanGroupTogglePosition(groupType, groupKey, anchorTop, scrollContainer);
    requestAnimationFrame(() => {
      restorePlanGroupTogglePosition(groupType, groupKey, anchorTop, scrollContainer);
    });
  }
}

function buildPlanGroupTitle({ level, className, label, groupType, groupKey, collapsed, interactive = true }) {
  const title = document.createElement(level);
  title.className = className;

  if (!interactive) {
    title.textContent = label;
    return title;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "plan-group-toggle";
  button.dataset.groupType = groupType;
  button.dataset.groupKey = groupKey;
  button.setAttribute("aria-expanded", String(!collapsed));

  const arrow = document.createElement("span");
  arrow.className = "plan-group-toggle-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = collapsed ? "▶" : "▼";

  const text = document.createElement("span");
  text.textContent = label;

  button.appendChild(arrow);
  button.appendChild(text);
  title.appendChild(button);
  return title;
}

function normalizeTypeDocumentSelection(typeDocument) {
  const allTypesValue = normalizeText(window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__");
  const rawValues = Array.isArray(typeDocument)
    ? typeDocument
    : [typeDocument];
  const values = rawValues
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const isAll = values.includes(allTypesValue);

  return {
    isAll,
    values: new Set(values.filter((value) => value !== allTypesValue))
  };
}

function isAllTypesSelection(typeDocument) {
  return normalizeTypeDocumentSelection(typeDocument).isAll;
}

function isAllZonesSelection(zoneValue) {
  return normalizeText(zoneValue) === normalizeText(window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");
}

function matchesZoneSelection(record, zoneValue) {
  if (isAllZonesSelection(zoneValue)) return true;

  const selectedZone = normalizeText(zoneValue);
  const noZoneValue = normalizeText(window.LISTE_DE_PLAN_NO_ZONE_VALUE || "__NO_ZONE__");
  const recordZone = normalizeZoneText(getRecordZone(record));

  if (selectedZone === noZoneValue) {
    return !recordZone;
  }

  return recordZone === selectedZone;
}

function normalizeRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;
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

function normalizeIndice(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePlanningLookupText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeCompactPlanningLookupText(value) {
  return normalizePlanningLookupText(value).replace(/\s+/g, "");
}

function normalizePlanningDocumentTypeLocal(value) {
  const normalized = normalizePlanningLookupText(value);
  const compact = normalizeCompactPlanningLookupText(value);

  if (
    compact === "NDC" ||
    normalized.includes("NOTE DE CALCUL") ||
    normalized.includes("NOTES DE CALCUL") ||
    normalized.includes("NOTE CALCUL") ||
    normalized.includes("NOTES CALCUL")
  ) {
    return "NDC";
  }

  if (normalized.includes("COFFRAGE")) return "COFFRAGE";
  if (normalized.includes("ARMATURE")) return "ARMATURES";
  if (
    normalized.includes("DEMOLITION") ||
    compact.includes("DEMOLITION") ||
    (normalized.startsWith("D") && normalized.includes("MOLITION"))
  ) {
    return "DEMOLITION";
  }
  if (normalized.includes("COUPE")) return "COUPES";

  return normalized || "NON SPECIFIE";
}

function getDefaultTargetIndiceForDocumentTypeLocal(typeDoc) {
  return normalizePlanningDocumentTypeLocal(typeDoc) === "COFFRAGE" ? "A" : "0";
}

function getPlanningIndiceRankLocal(indice) {
  const normalizedIndice = normalizeIndice(indice);
  if (!normalizedIndice) return 0;
  if (normalizedIndice === "0") return 1;
  if (/^[A-Z]$/.test(normalizedIndice)) {
    return normalizedIndice.charCodeAt(0) - 63;
  }
  return null;
}

function computeIndexedRealisationLocal(indice, targetIndice) {
  const normalizedIndice = normalizeIndice(indice);
  const normalizedTargetIndice = normalizeIndice(targetIndice);

  if (!normalizedIndice) return 0;
  if (!normalizedTargetIndice) return normalizedIndice ? 100 : 0;
  if (normalizedIndice === normalizedTargetIndice) return 100;

  const indiceRank = getPlanningIndiceRankLocal(normalizedIndice);
  const targetRank = getPlanningIndiceRankLocal(normalizedTargetIndice);
  if (indiceRank == null || targetRank == null || targetRank <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((indiceRank / targetRank) * 100)));
}

function isPlanningIndiceAtLeastLocal(indice, targetIndice) {
  const normalizedIndice = normalizeIndice(indice);
  const normalizedTargetIndice = normalizeIndice(targetIndice);
  if (!normalizedIndice) return false;
  if (!normalizedTargetIndice) return true;
  if (normalizedIndice === normalizedTargetIndice) return true;

  const indiceRank = getPlanningIndiceRankLocal(normalizedIndice);
  const targetRank = getPlanningIndiceRankLocal(normalizedTargetIndice);
  if (indiceRank == null || targetRank == null) return false;

  return indiceRank >= targetRank;
}

function buildPlanningIndiceProgressLocal(records = [], targetIndice = "") {
  let latestRecord = null;

  (records || []).forEach((record) => {
    const indice = normalizeIndice(record?.indice);
    const indiceRank = getPlanningIndiceRankLocal(indice);
    const dateSortValue = Number(record?.dateSortValue);
    if (!indice || indiceRank == null || !Number.isFinite(dateSortValue)) {
      return;
    }

    if (
      !latestRecord ||
      indiceRank > latestRecord.indiceRank ||
      (indiceRank === latestRecord.indiceRank && dateSortValue > latestRecord.dateSortValue)
    ) {
      latestRecord = {
        ...record,
        indice,
        indiceRank,
        dateSortValue,
      };
    }
  });

  const latestIndice = latestRecord?.indice || "";
  const effectiveTargetIndice = normalizeIndice(targetIndice);

  return {
    latestRecord,
    latestIndice,
    targetIndice: effectiveTargetIndice,
    targetReached: isPlanningIndiceAtLeastLocal(latestIndice, effectiveTargetIndice),
    realisation: computeIndexedRealisationLocal(latestIndice, effectiveTargetIndice),
  };
}

function buildTargetIndiceByTypeFromAvancementLocal(rawValue) {
  const targetIndiceByType = new Map();
  if (rawValue == null || rawValue === "") return targetIndiceByType;

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (!Array.isArray(parsed)) return targetIndiceByType;

    parsed.forEach((item) => {
      const typeKey = normalizePlanningDocumentTypeLocal(item?.typeDocument);
      const indice = normalizeIndice(item?.indice);
      if (!typeKey || !indice || item?.budgetKey || targetIndiceByType.has(typeKey)) {
        return;
      }

      targetIndiceByType.set(typeKey, indice);
    });
  } catch (_error) {
    return targetIndiceByType;
  }

  return targetIndiceByType;
}

function getTargetIndiceForDocumentTypeLocal(typeDoc, targetIndiceByType = null) {
  const typeKey = normalizePlanningDocumentTypeLocal(typeDoc);
  if (targetIndiceByType instanceof Map && targetIndiceByType.has(typeKey)) {
    return targetIndiceByType.get(typeKey);
  }

  return getDefaultTargetIndiceForDocumentTypeLocal(typeDoc);
}

function getLocalPlanningRealisationHelpers() {
  return {
    buildPlanningIndiceProgress: buildPlanningIndiceProgressLocal,
    buildTargetIndiceByTypeFromAvancement: buildTargetIndiceByTypeFromAvancementLocal,
    computePlanningRealisationValue: computePlanningRealiseValue,
    getPlanningIndiceRank: getPlanningIndiceRankLocal,
    getTargetIndiceForDocumentType: getTargetIndiceForDocumentTypeLocal,
  };
}

async function loadPlanningRealisationHelpers() {
  if (!planningRealisationHelpersPromise) {
    planningRealisationHelpersPromise = import("../gestion-depenses2/assets/js/utils/planningRealisation.js")
      .catch((error) => {
        console.warn("Fallback logique indices planning locale :", error);
        return getLocalPlanningRealisationHelpers();
      });
  }

  return planningRealisationHelpersPromise;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  const number = toNumber(value);
  if (number == null || !Number.isInteger(number)) return null;
  return number;
}

function parsePlanningSyncDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }

  if (typeof value === "number") {
    const normalized = value > 1e9 && value < 1e11 ? value * 1000 : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
    return null;
  }

  const frMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
    return null;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function hasValidDate(value) {
  return Boolean(parsePlanningSyncDate(value));
}

function toGristDateValue(value) {
  const date = parsePlanningSyncDate(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isFrenchDateText(value) {
  return /^\d{2}\/\d{2}\/\d{4}(?:\s+.*)?$/.test(normalizeText(value));
}

function addDaysToPlanningDate(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function subtractWeeksFromPlanningDate(date, weeks) {
  const normalizedWeeks = toInteger(weeks);
  if (normalizedWeeks == null || normalizedWeeks < 0) return null;
  return addDaysToPlanningDate(date, -(normalizedWeeks * 7));
}

function startOfPlanningDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function getPlanningDelayDays(segmentEndDate, referenceDate) {
  const segmentEndDay = startOfPlanningDay(segmentEndDate);
  const referenceDay = startOfPlanningDay(referenceDate);
  if (!segmentEndDay || !referenceDay || referenceDay <= segmentEndDay) return 0;

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((referenceDay.getTime() - segmentEndDay.getTime()) / msPerDay));
}

function isCoffrageTypeDoc(value) {
  return normalizeText(value).toUpperCase().includes("COFFRAGE");
}

function isArmaturesTypeDoc(value) {
  return normalizeText(value).toUpperCase().includes("ARMATURES");
}

function isAllowedPlanningTypeDoc(value) {
  return Boolean(normalizeText(value));
}

function hasPlanningLinkValue(value) {
  const text = normalizeText(value);
  if (!text) return false;

  const numericValue = Number(text);
  if (Number.isFinite(numericValue)) {
    return numericValue !== 0;
  }

  return true;
}

function computePlanningRealiseValue(typeDoc, indice, targetIndice = "") {
  const effectiveTargetIndice =
    normalizeIndice(targetIndice) || getDefaultTargetIndiceForDocumentTypeLocal(typeDoc);

  return computeIndexedRealisationLocal(indice, effectiveTargetIndice);
}

function resolveCoffrageDiffCoffrageDate({
  typeDoc,
  lignePlanningRaw,
  diffCoffrageRaw,
  demarrageRaw,
  duree3Raw,
}) {
  if (!isCoffrageTypeDoc(typeDoc)) {
    return parsePlanningSyncDate(diffCoffrageRaw);
  }

  if (!hasPlanningLinkValue(lignePlanningRaw)) {
    return parsePlanningSyncDate(diffCoffrageRaw);
  }

  const demarrageDate = parsePlanningSyncDate(demarrageRaw);
  const computedDate = subtractWeeksFromPlanningDate(demarrageDate, duree3Raw);
  return computedDate || parsePlanningSyncDate(diffCoffrageRaw);
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
    return parsePlanningSyncDate(diffArmatureRaw);
  }

  if (isAllowedPlanningTypeDoc(typeDoc)) {
    return parsePlanningSyncDate(diffCoffrageRaw);
  }

  return null;
}

function computePlanningRetardValue({
  typeDoc,
  indice,
  targetIndice,
  realiseValue,
  currentRetard,
  lignePlanningRaw,
  diffCoffrageRaw,
  diffArmatureRaw,
  demarrageRaw,
  duree3Raw,
  dateRealiseRaw,
}, currentInstant = new Date()) {
  if (!isAllowedPlanningTypeDoc(typeDoc)) {
    return 0;
  }

  const effectiveRealiseValue =
    toNumber(realiseValue) ?? computePlanningRealiseValue(typeDoc, indice, targetIndice);
  const segmentEndDate = resolvePlanningSegmentEndDate({
    typeDoc,
    lignePlanningRaw,
    diffCoffrageRaw,
    diffArmatureRaw,
    demarrageRaw,
    duree3Raw,
  });

  if (effectiveRealiseValue >= 100) {
    const dateRealise = parsePlanningSyncDate(dateRealiseRaw);
    if (dateRealise && segmentEndDate) {
      return getPlanningDelayDays(segmentEndDate, dateRealise);
    }

    const frozenRetard = toNumber(currentRetard);
    return frozenRetard != null && frozenRetard >= 0 ? frozenRetard : 0;
  }

  if (!segmentEndDate) {
    return 0;
  }

  return getPlanningDelayDays(segmentEndDate, currentInstant);
}

function getPlanningDateSortValue(value) {
  const date = parsePlanningSyncDate(value);
  return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

function shouldReplaceLatestPlanRecord(current, candidate) {
  if (!current) return true;
  if (candidate.order !== current.order) {
    return candidate.order > current.order;
  }

  return getPlanningDateSortValue(candidate.dateDiffusion) >
    getPlanningDateSortValue(current.dateDiffusion);
}

function rememberLatestPlanRecord(map, key, candidate) {
  if (shouldReplaceLatestPlanRecord(map.get(key), candidate)) {
    map.set(key, candidate);
  }
}

function buildPlanningLinkKey(project, numeroDocument, typeDocument, designation, zone = "") {
  return [
    normalizeDocumentIdentityText(project),
    normalizeDocumentIdentityText(numeroDocument),
    normalizeDocumentIdentityText(typeDocument),
    normalizeDocumentIdentityText(designation),
    normalizeDocumentIdentityText(normalizeZoneText(zone)),
  ].join("||");
}

function normalizeProjectLookupKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildProjectTargetIndiceLookup(projectRows, helpers) {
  const lookup = new Map();

  (projectRows || []).forEach((row) => {
    const targetIndiceByType = helpers.buildTargetIndiceByTypeFromAvancement(
      row?.Avancement
    );

    [
      row?.id,
      row?.Nom_de_projet,
      row?.NomProjet,
      row?.Numero_de_projet,
      row?.NumeroProjet,
    ].forEach((projectKey) => {
      const normalizedKey = normalizeProjectLookupKey(projectKey);
      if (normalizedKey && !lookup.has(normalizedKey)) {
        lookup.set(normalizedKey, targetIndiceByType);
      }
    });
  });

  return lookup;
}

function getProjectTargetIndiceForType(projectValue, typeDoc, targetLookup, helpers) {
  const targetIndiceByType =
    targetLookup.get(normalizeProjectLookupKey(projectValue)) || null;

  return helpers.getTargetIndiceForDocumentType(typeDoc, targetIndiceByType);
}

function getColumnNames(raw, rows = []) {
  const names = new Set(Object.keys(raw || {}));
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => names.add(key));
  }
  return names;
}

function findFirstExistingColumn(columnNames, candidates) {
  return candidates.find((name) => columnNames.has(name)) || null;
}

function matchesProjectValue(value, projectName, projectId = null) {
  const normalizedValue = normalizeDocumentIdentityText(value);
  const normalizedProjectName = normalizeDocumentIdentityText(projectName);
  const normalizedProjectId = projectId == null ? "" : normalizeDocumentIdentityText(projectId);

  return (
    normalizedValue === normalizedProjectName ||
    (normalizedProjectId !== "" && normalizedValue === normalizedProjectId)
  );
}

function findProjectIdInMap(projectsMap, projectName) {
  const requestedProject = normalizeDocumentIdentityText(projectName);
  const matchingEntry = Object.entries(projectsMap || {}).find(
    ([candidateName]) => normalizeDocumentIdentityText(candidateName) === requestedProject
  );
  return matchingEntry?.[1] ?? null;
}

function updateRowCellDatasets(tr, updates = {}) {
  if (!tr) return;

  for (const cell of Array.from(tr.cells || [])) {
    if (!cell?.dataset) continue;
    if (Object.prototype.hasOwnProperty.call(updates, "numDocument")) {
      cell.dataset.numDocument = updates.numDocument;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "designation")) {
      cell.dataset.designation = updates.designation;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "zone")) {
      cell.dataset.zone = updates.zone;
    }
  }
}

function buildDedupedUpdateActions(tableName, rows, updateFields) {
  const actionsById = new Map();
  rows.forEach((row) => {
    if (row?.id == null || actionsById.has(row.id)) return;
    actionsById.set(row.id, ["UpdateRecord", tableName, row.id, { ...updateFields }]);
  });
  return [...actionsById.values()];
}

function buildDocumentTextSyncActions({
  tableName,
  rows,
  updateFields,
  cellIndex,
  numeroColumn,
  projectColumn,
  typeColumn,
  zoneColumn,
  designationColumns,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  zone,
  projectId,
  warningLabel
}) {
  const normalizedType = normalizeText(typeDocument);

  if (!projectColumn || !numeroColumn || !typeColumn || !designationColumns.length) {
    throw new Error(`La structure de ${warningLabel} ne permet pas d'identifier le document.`);
  }

  const matchesBaseContext = (row) => {
    if (row?.id == null) return false;
    if (projectColumn && !matchesProjectValue(row[projectColumn], nomProjet, projectId)) {
      return false;
    }
    if (
      normalizedType &&
      normalizeDocumentIdentityText(row[typeColumn]) !==
        normalizeDocumentIdentityText(normalizedType)
    ) {
      return false;
    }
    return true;
  };

  const matchesNumero = (row) =>
    normalizeDocumentIdentityText(row[numeroColumn]) ===
      normalizeDocumentIdentityText(numDocument);

  const matchesDesignation = (row) => {
    return designationColumns.some(
      (columnName) =>
        normalizeDocumentIdentityText(row[columnName]) ===
        normalizeDocumentIdentityText(designation)
    );
  };

  const candidates = rows.filter(
    (row) => matchesBaseContext(row) && matchesNumero(row) && matchesDesignation(row)
  );
  return buildDedupedUpdateActions(tableName, candidates, updateFields);
}

async function buildReferencesTextUpdateActions({
  cellIndex,
  texte,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  zone
}) {
  try {
    const referencesRaw = await grist.docApi.fetchTable("References2");
    const referenceRows = normalizeRows(referencesRaw);
    const referenceColumns = getColumnNames(referencesRaw, referenceRows);

    const projectColumn = findFirstExistingColumn(referenceColumns, ["NomProjetString", "NomProjet", "Nom_projet"]);
    const typeColumn = findFirstExistingColumn(referenceColumns, ["Type_document", "TypeDocument"]);
    const zoneColumn = findFirstExistingColumn(referenceColumns, ["Zone"]);
    const numeroColumn = referenceColumns.has("NumeroDocument") ? "NumeroDocument" : null;
    const designationColumns = ["NomDocument", "Designation"].filter((name) => referenceColumns.has(name));

    const updateFields = {};
    if (cellIndex === 0 && referenceColumns.has("NumeroDocument")) {
      updateFields.NumeroDocument = texte;
    }
    if (cellIndex === 1) {
      if (referenceColumns.has("NomDocument")) {
        updateFields.NomDocument = texte;
      }
      if (referenceColumns.has("Designation")) {
        updateFields.Designation = texte;
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return [];
    }

    const projetsMap = await chargerProjetsMap();
    const projectId = findProjectIdInMap(projetsMap, nomProjet);

    return buildDocumentTextSyncActions({
      tableName: "References2",
      rows: referenceRows,
      updateFields,
      cellIndex,
      numeroColumn,
      projectColumn,
      typeColumn,
      zoneColumn,
      designationColumns,
      numDocument,
      designation,
      typeDocument,
      nomProjet,
      zone,
      projectId,
      warningLabel: "References2"
    });
  } catch (err) {
    console.error("Erreur lors de la préparation de la synchro vers References2 :", err);
    throw err;
  }
}

async function fetchFirstDocumentTable(tableNames) {
  let lastError = null;
  for (const tableName of tableNames) {
    try {
      return {
        tableName,
        raw: await grist.docApi.fetchTable(tableName)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Table liee introuvable.");
}

async function buildPlanningProjetTextUpdateActions({
  cellIndex,
  texte,
  numDocument,
  designation,
  typeDocument,
  nomProjet,
  zone
}) {
  try {
    const { tableName: planningTableName, raw: planningRaw } =
      await fetchFirstDocumentTable(DOCUMENT_PLANNING_TABLE_CANDIDATES);
    const planningRows = normalizeRows(planningRaw);
    const planningColumns = getColumnNames(planningRaw, planningRows);

    const projectColumn = findFirstExistingColumn(planningColumns, ["NomProjetString", "NomProjet", "Nom_projet"]);
    const typeColumn = findFirstExistingColumn(planningColumns, ["Type_doc", "Type_document", "TypeDoc"]);
    const zoneColumn = findFirstExistingColumn(planningColumns, ["Zone"]);
    const numeroColumn = findFirstExistingColumn(planningColumns, ["ID2", "NumeroDocument"]);
    const designationColumns = ["Taches", "Tache", "Designation"].filter((name) => planningColumns.has(name));

    if (!numeroColumn) {
      return [];
    }

    const updateFields = {};
    if (cellIndex === 0) {
      updateFields[numeroColumn] = texte;
    }
    if (cellIndex === 1) {
      if (planningColumns.has("Taches")) {
        updateFields.Taches = texte;
      }
      if (planningColumns.has("Tache")) {
        updateFields.Tache = texte;
      }
      if (planningColumns.has("Designation")) {
        updateFields.Designation = texte;
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return [];
    }

    const projetsMap = await chargerProjetsMap();
    const projectId = findProjectIdInMap(projetsMap, nomProjet);

    return buildDocumentTextSyncActions({
      tableName: planningTableName,
      rows: planningRows,
      updateFields,
      cellIndex,
      numeroColumn,
      projectColumn,
      typeColumn,
      zoneColumn,
      designationColumns,
      numDocument,
      designation,
      typeDocument,
      nomProjet,
      zone,
      projectId,
      warningLabel: planningTableName
    });
  } catch (err) {
    console.error("Erreur lors de la préparation de la synchro vers Planning_Projet :", err);
    throw err;
  }
}

async function syncPlanningProjetIndicesFromListeDePlan() {
  try {
    const planningHelpers = await loadPlanningRealisationHelpers();
    const projetsMap = await chargerProjetsMap();
    const projectIdToName = new Map(
      Object.entries(projetsMap || {}).map(([name, id]) => [String(id), name])
    );

    const normalizeProject = (value) => {
      if (value != null && typeof value === "object") {
        if (typeof value.details === "string") return value.details.trim();
        if (typeof value.display === "string") return value.display.trim();
      }
      const raw = normalizeText(value);
      return projectIdToName.get(raw) || raw;
    };

    const listeRaw = await grist.docApi.fetchTable("ListePlan_NDC_COF");
    const planningRaw = await grist.docApi.fetchTable("Planning_Projet");
    const projetsRaw = await grist.docApi.fetchTable("Projets2");

    const listeRows = normalizeRows(listeRaw);
    const planningRows = normalizeRows(planningRaw);
    const projectRows = normalizeRows(projetsRaw);
    const projectTargetLookup = buildProjectTargetIndiceLookup(projectRows, planningHelpers);
    const planningColumns = getColumnNames(planningRaw, planningRows);
    const hasRealiseColumn = planningColumns.has("Realise");
    const hasRetardsColumn = planningColumns.has("Retards");
    const hasDateRealiseColumn = planningColumns.has("Date_Realise");

    const latestByKeyStrict = new Map();
    const latestByKeyStrictLegacy = new Map();

    for (const r of listeRows) {
      const indice = normalizeIndice(r.Indice);
      const order = Number(planningHelpers.getPlanningIndiceRank(indice));
      if (!indice || !Number.isFinite(order) || order <= 0) continue;
      if (!hasValidDate(r.DateDiffusion)) continue;
      const latestRecord = {
        indice,
        order,
        indiceRank: order,
        dateDiffusion: r.DateDiffusion,
        dateSortValue: getPlanningDateSortValue(r.DateDiffusion),
      };

      const strictKey = buildPlanningLinkKey(
        normalizeProject(r.Nom_projet),
        r.NumeroDocument,
        r.Type_document,
        r.Designation,
        r.Zone
      );
      const strictLegacyKey = buildPlanningLinkKey(
        normalizeProject(r.Nom_projet),
        r.NumeroDocument,
        r.Type_document,
        r.Designation
      );

      rememberLatestPlanRecord(latestByKeyStrict, strictKey, latestRecord);
      rememberLatestPlanRecord(latestByKeyStrictLegacy, strictLegacyKey, latestRecord);
    }

    const actions = [];
    for (const p of planningRows) {
      const planningId = p.id;
      if (planningId == null) continue;

      const strictKey = buildPlanningLinkKey(
        normalizeProject(p.NomProjet),
        p.ID2,
        p.Type_doc,
        p.Taches ?? p.Tache,
        p.Zone
      );
      const strictLegacyKey = buildPlanningLinkKey(
        normalizeProject(p.NomProjet),
        p.ID2,
        p.Type_doc,
        p.Taches ?? p.Tache
      );

      const latestRecord =
        latestByKeyStrict.get(strictKey) ??
        latestByKeyStrictLegacy.get(strictLegacyKey) ??
        null;
      const latestIndice = latestRecord?.indice ?? "";
      const planningProject = normalizeProject(p.NomProjet);
      const effectiveTargetIndice = getProjectTargetIndiceForType(
        planningProject,
        p.Type_doc,
        projectTargetLookup,
        planningHelpers
      );
      const progress = planningHelpers.buildPlanningIndiceProgress(
        latestRecord ? [latestRecord] : [],
        effectiveTargetIndice
      );
      const currentIndice = normalizeText(p.Indice);
      const currentRealiseStored = toNumber(p.Realise);
      const targetRealise = progress.realisation;
      const currentDateRealise = toGristDateValue(p.Date_Realise) || normalizeText(p.Date_Realise);
      const targetDateRealiseFromListe = progress.targetReached && progress.latestRecord
        ? toGristDateValue(progress.latestRecord.dateDiffusion)
        : null;

      const nextDateRealise = targetDateRealiseFromListe || null;
      const shouldUpdateDateRealise =
        (currentDateRealise || "") !== (nextDateRealise || "");

      const dateRealiseForRetard = targetRealise >= 100 ? nextDateRealise : "";
      const targetRetard = computePlanningRetardValue({
        typeDoc: p.Type_doc,
        indice: latestIndice,
        targetIndice: effectiveTargetIndice,
        realiseValue: targetRealise,
        currentRetard: p.Retards,
        lignePlanningRaw: p.Ligne_planning,
        diffCoffrageRaw: p.Diff_coffrage,
        diffArmatureRaw: p.Diff_armature,
        demarrageRaw: p.Demarrages_travaux,
        duree3Raw: p.Duree_3,
        dateRealiseRaw: dateRealiseForRetard,
      });
      const currentRetard = toNumber(p.Retards);

      const updates = {};
      if (currentIndice !== latestIndice) {
        updates.Indice = latestIndice;
      }
      if (hasRealiseColumn && currentRealiseStored !== targetRealise) {
        updates.Realise = targetRealise;
      }
      if (hasDateRealiseColumn && shouldUpdateDateRealise) {
        updates.Date_Realise = nextDateRealise;
      }
      if (hasRetardsColumn && currentRetard !== targetRetard) {
        updates.Retards = targetRetard;
      }

      if (Object.keys(updates).length > 0) {
        actions.push(["UpdateRecord", "Planning_Projet", planningId, updates]);
      }
    }

    for (let i = 0; i < actions.length; i += 200) {
      await grist.docApi.applyUserActions(actions.slice(i, i + 200));
    }
  } catch (err) {
    console.error("Erreur sync ListeDePlan -> Planning_Projet (Indice) :", err);
  }
}

function renderPlanTableSection(container, filtres, projet, selectedIndices = null) {
  if (!container || filtres.length === 0) return;
  /*
    zone.innerHTML = "<p>Aucun plan trouvé pour cette sélection.</p>";
    return;
  }

  */
  const plansMap = new Map();
  for (const r of filtres) {
    const zoneValue = getRecordZone(r);
    const key = [
      normalizeDocumentIdentityText(r.NumeroDocument),
      normalizeDocumentIdentityText(r.Designation),
      normalizeDocumentIdentityText(r.Type_document),
      normalizeDocumentIdentityText(zoneValue)
    ].join("___");
    if (!plansMap.has(key)) {
      plansMap.set(key, {
        Num_Document: r.NumeroDocument,
        Designation: r.Designation,
        Type_document: r.Type_document,
        Nom_projet: getRecordProjectName(r),
        Zone: zoneValue,
        lignes: {}
      });
    }
    if (!plansMap.get(key).lignes[r.Indice]) {
      plansMap.get(key).lignes[r.Indice] = [];
    }
    plansMap.get(key).lignes[r.Indice].push(r);
  }

  const warningDiv = document.createElement('div');
  warningDiv.className = 'warnings';
  const selectedIndexSet = Array.isArray(selectedIndices)
    ? new Set(selectedIndices.map(normalizeIndice).filter(Boolean))
    : null;

  // Multi-date conflict warning
  let hasMultiDateError = false;
  for (const plan of plansMap.values()) {
    for (const indice in plan.lignes) {
      if (selectedIndexSet && !selectedIndexSet.has(normalizeIndice(indice))) continue;
      if (plan.lignes[indice].length > 1) {
        hasMultiDateError = true;
        break;
      }
    }
    if (hasMultiDateError) break;
  }

  if (hasMultiDateError) {
    const p = document.createElement('p');
    p.className = 'warning-message';
    p.textContent = "Des dates multiples sont trouvées pour certains documents pour la même indice, veuillez corriger en cliquant dessus.";
    warningDiv.appendChild(p);
  }

  // Missing date warnings
  let hasMissingDateError = false;
  for (const plan of plansMap.values()) {
    const datedIndices = Object.keys(plan.lignes)
      .filter(indice => plan.lignes[indice] && plan.lignes[indice].length > 0 && !plan.lignes[indice].isMissing)
      .map(indice => INDICES.indexOf(indice))
      .filter(index => index !== -1)
      .sort((a, b) => a - b);

    if (datedIndices.length > 0) {
      const last = datedIndices[datedIndices.length - 1];
      // Check all cells from the beginning up to the last valid date
      for (let i = 0; i < last; i++) {
        const currentIndice = INDICES[i];
        if (selectedIndexSet && !selectedIndexSet.has(currentIndice)) continue;
        if (!plan.lignes[currentIndice] || plan.lignes[currentIndice].length === 0) {
          hasMissingDateError = true;
          // Mark this cell for highlighting
          if (!plan.lignes[currentIndice]) {
            plan.lignes[currentIndice] = { isMissing: true };
          } else {
            plan.lignes[currentIndice].isMissing = true;
          }
        }
      }
    }
  }

  if (hasMissingDateError) {
    const p = document.createElement('p');
    p.className = 'warning-message';
    p.textContent = "Des dates sont manquantes, veuillez les remplir.";
    warningDiv.appendChild(p);
  }

  const indicesToShow = getPlanTableIndicesToShow(plansMap, selectedIndices);

  const table = document.createElement("table");
  table.className = "plan-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["N° Document", "Désignation", ...indicesToShow].forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    if (title === "Désignation") th.classList.add("nomplan");
    if (!["N° Document", "Désignation"].includes(title)) {
      th.classList.add("indice");
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const sortedPlans = [...plansMap.values()].sort((left, right) =>
    compareNormalizedText(left.Num_Document, right.Num_Document) ||
    compareNormalizedText(left.Designation, right.Designation) ||
    compareNormalizedText(left.Zone, right.Zone, { blankLast: true })
  );
  for (const plan of sortedPlans) {
    const tr = document.createElement("tr");
    const tdNum = document.createElement("td");
    tdNum.textContent = plan.Num_Document;
    tdNum.dataset.numDocument = plan.Num_Document;
    tdNum.dataset.designation = plan.Designation;
    tdNum.dataset.zone = plan.Zone;
    tdNum.contentEditable = true;
    tdNum.classList.add("editable");
    tdNum.dataset.typeDocument = plan.Type_document;
    tdNum.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNum);

    const tdNom = document.createElement("td");
    tdNom.textContent = plan.Designation;
    tdNom.dataset.numDocument = plan.Num_Document;
    tdNom.dataset.designation = plan.Designation;
    tdNom.dataset.zone = plan.Zone;
    tdNom.contentEditable = true;
    tdNom.classList.add("editable", "nomplan");
    tdNom.dataset.typeDocument = plan.Type_document;
    tdNom.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNom);

    for (const indice of indicesToShow) {
      const td = document.createElement("td");
      td.classList.add("editable", "indice");
      td.dataset.typeDocument = plan.Type_document;
      td.dataset.nomProjet = plan.Nom_projet;
      td.dataset.numDocument = plan.Num_Document;
      td.dataset.designation = plan.Designation;
      td.dataset.zone = plan.Zone;
      td.dataset.indice = indice;

      const recs = plan.lignes[indice];
      if (recs) {
        if (recs.isMissing) {
          td.classList.add('missing-date-error');
        } else if (recs.length > 1) {
          td.classList.add('multi-date-error');
          td.innerHTML = recs.map(r => formatDate(r.DateDiffusion)).join('<br>');
          td.dataset.conflicts = JSON.stringify(recs.map(r => ({ id: r.id, date: r.DateDiffusion })));
        } else if (recs.length === 1) {
          const rec = recs[0];
          if (rec.DateDiffusion) td.textContent = formatDate(rec.DateDiffusion);
          td.dataset.recordId = rec.id;
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  if (warningDiv.childElementCount > 0) {
    container.appendChild(warningDiv);
  }
  container.appendChild(table);
}

function getPlanTableIndicesToShow(plansMap, selectedIndices = null) {
  if (Array.isArray(selectedIndices)) {
    return selectedIndices
      .map(normalizeIndice)
      .filter((indice, index, values) => indice && values.indexOf(indice) === index);
  }

  const allIndicesUsed = new Set();
  for (const plan of plansMap.values()) {
    for (const indice in plan.lignes) {
      allIndicesUsed.add(indice);
    }
  }

  const lastUsedIndex = Math.max(
    -1,
    ...[...allIndicesUsed].map((indice) => INDICES.indexOf(indice)).filter((index) => index >= 0)
  );
  return INDICES.slice(0, lastUsedIndex + 2);
}

function getOrderedZoneKeys(zoneKeys, zoneOrder = null) {
  const defaultSort = (left, right) => compareNormalizedText(left, right, { blankLast: true });
  if (!Array.isArray(zoneOrder) || zoneOrder.length === 0) {
    return [...zoneKeys].sort(defaultSort);
  }

  const noZoneValue = normalizeText(window.LISTE_DE_PLAN_NO_ZONE_VALUE || "__NO_ZONE__");
  const orderByZone = new Map();
  zoneOrder.forEach((zoneValue, index) => {
    const normalizedZone = normalizeText(zoneValue) === noZoneValue
      ? ""
      : normalizeZoneText(zoneValue);
    if (!orderByZone.has(normalizedZone)) {
      orderByZone.set(normalizedZone, index);
    }
  });

  return [...zoneKeys].sort((left, right) => {
    const leftIndex = orderByZone.get(left);
    const rightIndex = orderByZone.get(right);
    if (leftIndex != null && rightIndex != null) return leftIndex - rightIndex;
    if (leftIndex != null) return -1;
    if (rightIndex != null) return 1;
    return defaultSort(left, right);
  });
}

function renderZoneSections(container, rows, projet, typeKey, zoneOrder = null, selectedIndices = null, { interactive = true } = {}) {
  const rowsByZone = new Map();
  for (const record of rows) {
    const zoneKey = getRecordZone(record);
    if (!rowsByZone.has(zoneKey)) {
      rowsByZone.set(zoneKey, []);
    }
    rowsByZone.get(zoneKey).push(record);
  }

  const zoneKeys = getOrderedZoneKeys([...rowsByZone.keys()], zoneOrder);
  for (const zoneKey of zoneKeys) {
    const zoneSection = document.createElement("section");
    zoneSection.className = "plan-zone-section";
    const zoneGroupKey = getPlanGroupKey(projet, typeKey, zoneKey);
    const isCollapsed = interactive && collapsedPlanZoneGroups.has(zoneGroupKey);

    const title = buildPlanGroupTitle({
      className: "plan-zone-title",
      collapsed: isCollapsed,
      groupKey: zoneGroupKey,
      groupType: "zone",
      interactive,
      label: formatZoneSectionTitle(zoneKey),
      level: "h3",
    });
    zoneSection.appendChild(title);

    if (!isCollapsed) {
      renderPlanTableSection(zoneSection, rowsByZone.get(zoneKey), projet, selectedIndices);
    }
    container.appendChild(zoneSection);
  }
}

function hasNamedZone(rows) {
  return rows.some((record) => normalizeZoneText(getRecordZone(record)));
}

function renderRowsForSelectedType(container, rows, projet, typeKey = "", zoneOrder = null, selectedIndices = null, options = {}) {
  if (hasNamedZone(rows)) {
    renderZoneSections(container, rows, projet, typeKey, zoneOrder, selectedIndices, options);
    return;
  }

  renderPlanTableSection(container, rows, projet, selectedIndices);
}

function renderTypeSection(container, typeKey, rows, projet, zoneOrder = null, selectedIndices = null, { interactive = true } = {}) {
  const typeSection = document.createElement("section");
  typeSection.className = "plan-type-section";

  const typeGroupKey = getPlanGroupKey(projet, typeKey);
  const isCollapsed = interactive && collapsedPlanTypeGroups.has(typeGroupKey);
  const title = buildPlanGroupTitle({
    className: "plan-type-title",
    collapsed: isCollapsed,
    groupKey: typeGroupKey,
    groupType: "type",
    interactive,
    label: typeKey,
    level: "h2",
  });
  typeSection.appendChild(title);

  if (!isCollapsed) {
    renderRowsForSelectedType(typeSection, rows, projet, typeKey, zoneOrder, selectedIndices, { interactive });
  }

  container.appendChild(typeSection);
}

function afficherPlansFiltres(projet, typeDocument, records, zoneSelection = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__") {
  const output = document.getElementById("plans-output");
  output.innerHTML = "";

  const normalizedProject = normalizeText(projet);
  const typeSelection = normalizeTypeDocumentSelection(typeDocument);
  const projectRows = records.filter((record) =>
    getRecordProjectName(record) === normalizedProject &&
    getRecordTypeDocument(record) &&
    matchesZoneSelection(record, zoneSelection)
  );

  if (projectRows.length === 0) {
    output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
    return;
  }

  let rowsToRender = projectRows;

  if (!typeSelection.isAll) {
    if (typeSelection.values.size === 0) {
      output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
      return;
    }

    const filteredRows = projectRows.filter((record) => typeSelection.values.has(getRecordTypeDocument(record)));
    if (filteredRows.length === 0) {
      output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
      return;
    }

    if (typeSelection.values.size === 1) {
      const [typeKey] = typeSelection.values;
      renderTypeSection(output, typeKey, filteredRows, normalizedProject);
      return;
    }

    rowsToRender = filteredRows;
  }

  const rowsByType = new Map();
  for (const record of rowsToRender) {
    const typeKey = getRecordTypeDocument(record);
    if (!rowsByType.has(typeKey)) {
      rowsByType.set(typeKey, []);
    }
    rowsByType.get(typeKey).push(record);
  }

  const typeKeys = [...rowsByType.keys()].sort((left, right) => compareNormalizedText(left, right));
  if (typeKeys.length === 0) {
    output.innerHTML = "<p>Aucun plan trouve pour cette selection.</p>";
    return;
  }

  for (const typeKey of typeKeys) {
    renderTypeSection(output, typeKey, rowsByType.get(typeKey), normalizedProject);
  }
}

document.addEventListener("click", async (e) => {
  const target = e.target;
  const groupToggle = target.closest?.(".plan-group-toggle");
  if (groupToggle && groupToggle.closest("#plans-output")) {
    togglePlanCollapsedGroup(
      groupToggle.dataset.groupType,
      groupToggle.dataset.groupKey,
      groupToggle
    );
    return;
  }

  if (target.matches('th.indice')) {
    ouvrirPickerRemplirColonne(target);
    return;
  }

  if (target.matches('td.multi-date-error')) {
    const td = target;
    const conflicts = JSON.parse(td.dataset.conflicts);
    const existingPopup = document.getElementById('date-fix-popup');
    if (existingPopup) existingPopup.remove();
    const popup = document.createElement('div');
    popup.id = 'date-fix-popup';
    popup.style.position = 'absolute';
    popup.style.left = `${td.offsetLeft + td.offsetWidth}px`;
    popup.style.top = `${td.offsetTop}px`;
    popup.innerHTML = `<p>Choisir la date correcte:</p>`;
    const fieldset = document.createElement('fieldset');
    conflicts.forEach((conflict, index) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'date-fix';
      radio.value = conflict.id;
      if (index === 0) radio.checked = true;
      label.appendChild(radio);
      label.append(` ${formatDate(conflict.date)}`);
      fieldset.appendChild(label);
    });
    popup.appendChild(fieldset);
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirmer';
    confirmBtn.onclick = async () => {
      const selectedRadio = popup.querySelector('input[name="date-fix"]:checked');
      if (selectedRadio) {
        const correctRecordId = parseInt(selectedRadio.value, 10);
        const recordsToDelete = conflicts.filter(c => c.id !== correctRecordId);
        try {
          const table = await grist.getTable();
          for (const record of recordsToDelete) {
            await table.destroy(record.id);
          }
          await syncPlanningProjetIndicesFromListeDePlan();
          popup.remove();
        } catch (err) {
          console.error("Erreur lors de la suppression des dates en double :", err);
          alert("Une erreur est survenue lors de la suppression.");
        }
      }
    };
    popup.appendChild(confirmBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Annuler';
    cancelBtn.onclick = () => popup.remove();
    popup.appendChild(cancelBtn);
    td.closest('#plans-output').appendChild(popup);
    return;
  }

  if (target.matches('td.indice.editable')) {
    const td = target;
    if (document.getElementById('date-fix-popup')) return;
    const { recordId, indice, typeDocument, nomProjet, zone } = td.dataset;
    const tr = td.parentElement;
    const Num_Document = tr.cells[0]?.textContent.trim();
    const Designation = tr.cells[1]?.textContent.trim();
    const fp = flatpickr(td, {
      "locale": "fr",
      defaultDate: td.textContent ? convertFrToDate(td.textContent) : undefined,
      dateFormat: "d/m/Y",
        onClose: async (selectedDates, dateStr, instance) => {
        const isoDate = selectedDates.length > 0 ? convertToISO(dateStr) : null;
        const recordIdInt = recordId ? parseInt(recordId, 10) : null;

        // === CAS: cellule déjà existante (recordId) -> UPDATE, jamais AddRecord ===
        if (recordIdInt) {
          try {
            if (!isoDate) {
              // Suppression de date (ta logique existante)
              const otherDates = tr.querySelectorAll('td.indice');
              const datedCells = Array.from(otherDates).filter(cell => cell.textContent.trim() !== '' && cell !== td);

              const fieldsToUpdate = { DateDiffusion: null };
              if (datedCells.length === 0) {
                fieldsToUpdate.Indice = null;
              }

              await grist.docApi.applyUserActions([
                ["UpdateRecord", "ListePlan_NDC_COF", recordIdInt, fieldsToUpdate],

                // (je conserve ton AddRecord dans References, mais sans rowData)
                // ["AddRecord", "References2", null, {
                //   NomProjet: nomProjet,
                //   NomDocument: Designation,
                //   NumeroDocument: (() => {
                //     const s = String(Num_Document ?? '').trim();
                //     return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
                //   })()
                // }]
              ]);
              await syncPlanningProjetIndicesFromListeDePlan();

              td.textContent = "";
            } else {
              // Modification de date
              await grist.docApi.applyUserActions([
                ["UpdateRecord", "ListePlan_NDC_COF", recordIdInt, { DateDiffusion: isoDate }],

                // (je conserve ton AddRecord dans References, mais sans rowData)
                // ["AddRecord", "References2", null, {
                //   NomProjet: nomProjet,
                //   NomDocument: Designation,
                //   NumeroDocument: (() => {
                //     const s = String(Num_Document ?? '').trim();
                //     return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
                //   })()
                // }]
              ]);
              await syncPlanningProjetIndicesFromListeDePlan();

              td.textContent = dateStr;
            }
          } catch (err) {
            console.error("Erreur lors de la mise à jour de la date :", err);
          }
          return;
        }

        // === CAS: cellule vide (pas de recordId) -> ADD ===
        if (!isoDate) return;

        if (!Num_Document || !Designation || !nomProjet || !typeDocument) {
          console.warn("Champs obligatoires manquants pour l'ajout :", { Num_Document, Designation, nomProjet, typeDocument, zone });
          return;
        }

        const projetsDict = await chargerProjetsMap();
        if (!projetsDict[nomProjet.trim()]) {
          console.error("Projet non trouvé :", nomProjet);
          return;
        }

        const rowData = {
          NumeroDocument: Num_Document,
          Type_document: typeDocument,
          Designation: Designation,
          Nom_projet: nomProjet,
          Zone: zone || "",
          Indice: indice,
          DateDiffusion: isoDate
        };

        try {
          await grist.docApi.applyUserActions([
            ["AddRecord", "ListePlan_NDC_COF", null, rowData],
            // ["AddRecord", "References2", null, {
            //   NomProjet: rowData.Nom_projet,
            //   NomDocument: rowData.Designation,
            //   NumeroDocument: (() => {
            //     const s = String(rowData.NumeroDocument ?? '').trim();
            //     return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
            //   })()
            // }]
          ]);
          await syncPlanningProjetIndicesFromListeDePlan();
          td.textContent = dateStr;
        } catch (err) {
          console.error("Erreur lors de l'ajout du record :", err);
        }
      }
    });
    fp.open();
  }
});

document.addEventListener("focusout", async (e) => {
  const td = e.target;
  if (!td.matches("td.editable:not(.indice)")) return;

  td.style.backgroundColor = "";
  td.style.color = "";
  const texte = td.textContent.trim();
  const { numDocument, designation, typeDocument, nomProjet, zone } = td.dataset;
  const currentValue = td.cellIndex === 0 ? normalizeText(numDocument) : normalizeText(designation);
  if (normalizeText(texte) === currentValue) return;
  if (!texte) {
    td.textContent = currentValue;
    alert("Le numero et le nom du document ne peuvent pas etre vides.");
    return;
  }

  try {
    if (typeof window.assertDocumentIdentitiesAvailable !== "function") {
      throw new Error("Le controle d'identite des documents est indisponible.");
    }
    const sourceDocument = {
      number: numDocument,
      name: designation,
      type: typeDocument
    };
    const targetDocument = {
      number: td.cellIndex === 0 ? texte : numDocument,
      name: td.cellIndex === 1 ? texte : designation,
      type: typeDocument
    };
    await window.assertDocumentIdentitiesAvailable(nomProjet, [targetDocument], {
      excludeDocument: sourceDocument
    });
  } catch (error) {
    td.textContent = currentValue;
    alert(error.message);
    return;
  }

  const projetsMap = await chargerProjetsMap();
  const projectId = findProjectIdInMap(projetsMap, nomProjet);
  const recordsToUpdate = window.records.filter((r) =>
    normalizeDocumentIdentityText(r.NumeroDocument) === normalizeDocumentIdentityText(numDocument) &&
    normalizeDocumentIdentityText(r.Designation) === normalizeDocumentIdentityText(designation) &&
    normalizeDocumentIdentityText(r.Type_document) === normalizeDocumentIdentityText(typeDocument) &&
    matchesProjectValue(r.Nom_projet, nomProjet, projectId)
  );
  if (recordsToUpdate.length === 0) return;
  const champs = {};
  if (td.cellIndex === 0) {
    champs.NumeroDocument = texte;
  } else if (td.cellIndex === 1) {
    champs.Designation = texte;
  }
  if (Object.keys(champs).length > 0) {
    try {
      const listePlanTableName = typeof window.getActiveListePlanTableName === "function"
        ? await window.getActiveListePlanTableName()
        : "ListePlan_NDC_COF";
      const actions = recordsToUpdate.map(
        (record) => ["UpdateRecord", listePlanTableName, record.id, champs]
      );
      const referenceActions = await buildReferencesTextUpdateActions({
        cellIndex: td.cellIndex,
        texte,
        numDocument,
        designation,
        typeDocument,
        nomProjet,
        zone
      });
      const planningActions = await buildPlanningProjetTextUpdateActions({
        cellIndex: td.cellIndex,
        texte,
        numDocument,
        designation,
        typeDocument,
        nomProjet,
        zone
      });
      await grist.docApi.applyUserActions(
        actions.concat(referenceActions, planningActions)
      );
      recordsToUpdate.forEach((record) => {
        if (td.cellIndex === 0) {
          record.NumeroDocument = texte;
        } else if (td.cellIndex === 1) {
          record.Designation = texte;
        }
      });
      updateRowCellDatasets(td.parentElement, {
        numDocument: td.cellIndex === 0 ? texte : numDocument,
        designation: td.cellIndex === 1 ? texte : designation
      });
      await syncPlanningProjetIndicesFromListeDePlan();
    } catch (err) {
      td.textContent = currentValue;
      console.error("Erreur lors de la mise à jour du texte :", err);
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
      alert(err.message || "La modification du document a echoue.");
    }
  }
});

function convertFrToDate(dateStr) {
  const [day, month, year] = dateStr.split("/");
  return new Date(year, month - 1, day);
}

function convertToISO(dateStr) {
  const [day, month, year] = dateStr.split("/");
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function dateObjToISO(d) {
  // on garde la date "locale" choisie par l'utilisateur
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function ouvrirPickerRemplirColonne(th) {
  const indice = th.textContent.trim();

  // Popup léger
  const old = document.getElementById("column-fill-popup");
  if (old) old.remove();

  const popup = document.createElement("div");
  popup.id = "column-fill-popup";
  popup.style.position = "absolute";
  popup.style.zIndex = "9999";
  popup.style.background = "#fff";
  popup.style.border = "1px solid #ed1b2d";
  popup.style.borderRadius = "8px";
  popup.style.padding = "10px";
  popup.style.boxShadow = "0 8px 20px rgba(0,0,0,0.15)";
  popup.innerHTML = `
    <div style="margin-bottom:8px; color:#004990;">
      Remplir toute la colonne <strong>${indice}</strong>
    </div>
    <input id="column-fill-date" type="text" placeholder="Choisir une date" style="width:100%; padding:6px;" />
    <div style="display:flex; justify-content:flex-end; margin-top:10px;">
      <button id="column-fill-cancel" type="button">Annuler</button>
    </div>
  `;

  const rect = th.getBoundingClientRect();
  popup.style.left = `${rect.left + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
  document.body.appendChild(popup);

  const input = popup.querySelector("#column-fill-date");
  const cancelBtn = popup.querySelector("#column-fill-cancel");

  const fp = flatpickr(input, {
    locale: "fr",
    dateFormat: "d/m/Y",
    closeOnSelect: true,   // important
    onChange: async (selectedDates, dateStr, instance) => {
      if (!selectedDates || selectedDates.length === 0) return;

      // on ferme tout de suite le calendrier (UX)
      instance.close();

      try {
        const iso = convertToISO(dateStr);

        const indice = th.textContent.trim();
        const ok = confirm(`Appliquer ${formatDate(iso)} à toute la colonne ${indice} ?`);
        if (!ok) return;

        await appliquerDateSurTouteLaColonne(th, iso);
      } finally {
        instance.destroy();
        popup.remove();
      }
    }
  });

  fp.open();

  cancelBtn.onclick = () => { fp.destroy(); popup.remove(); };
}

async function appliquerDateSurTouteLaColonne(th, isoDate) {
  const table = th.closest("table");
  if (!table) return;

  const colIndex = th.cellIndex;
  const indice = th.textContent.trim();
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"))
    .filter(tr => !tr.querySelector("td.ajout")); // ignore la ligne d'ajout

  const actionsUpsert = []; // Update + Add
  const actionsDelete = []; // Remove (multi-date)

  for (const tr of rows) {
    const td = tr.cells[colIndex];
    if (!td) continue;

    const typeDocument = td.dataset.typeDocument;
    const nomProjet = td.dataset.nomProjet;
    const numDocument = td.dataset.numDocument;
    const designation = td.dataset.designation;
    const zone = td.dataset.zone;

    if (!typeDocument || !nomProjet || !numDocument || !designation) continue;

    // 1) Multi-date (conflits) : on garde le 1er, on supprime les autres
    if (td.dataset.conflicts) {
      const conflicts = JSON.parse(td.dataset.conflicts); // [{id,date},...]
      const keepId = conflicts[0]?.id;
      if (keepId) actionsUpsert.push(["UpdateRecord", "ListePlan_NDC_COF", keepId, { DateDiffusion: isoDate }]);
      for (const c of conflicts.slice(1)) {
        actionsDelete.push(["RemoveRecord", "ListePlan_NDC_COF", c.id]);
      }
      continue;
    }

    // 2) Record existe déjà pour cette cellule
    if (td.dataset.recordId) {
      const rid = parseInt(td.dataset.recordId, 10);
      actionsUpsert.push(["UpdateRecord", "ListePlan_NDC_COF", rid, { DateDiffusion: isoDate }]);
      continue;
    }

    // 3) Cellule vide : meme comportement qu'une saisie cellule -> AddRecord.
    actionsUpsert.push(["AddRecord", "ListePlan_NDC_COF", null, {
      NumeroDocument: numDocument,
      Type_document: typeDocument,
      Designation: designation,
      Nom_projet: nomProjet,
      Zone: zone || "",
      Indice: indice,
      DateDiffusion: isoDate
    }]);

    // ✅ Mise à jour visuelle immédiate (même si Grist met 0.5s à refresh)
    td.classList.remove("missing-date-error", "multi-date-error");
    td.textContent = formatDate(isoDate);
  }

  // Appliquer en batches (évite les gros payloads si beaucoup de lignes)
  const applyBatches = async (actions, batchSize = 200) => {
    for (let i = 0; i < actions.length; i += batchSize) {
      await grist.docApi.applyUserActions(actions.slice(i, i + batchSize));
    }
  };

  try {
    if (actionsUpsert.length) await applyBatches(actionsUpsert, 200);
    if (actionsDelete.length) await applyBatches(actionsDelete, 200);
    await syncPlanningProjetIndicesFromListeDePlan();
  } catch (err) {
    console.error("Erreur remplissage colonne :", err);
    alert("Erreur lors du remplissage de la colonne (regarde la console).");
  }
}
