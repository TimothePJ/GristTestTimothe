import { APP_CONFIG } from "../config.js";
// Règles partagées avec Planning Projet : les deux widgets écrivent les mêmes colonnes de
// Planning_Projet et de References2, ils doivent y trouver les mêmes valeurs.
import {
  buildMsLinkedPlanningDateFields,
  keepChangedPlanningDateFields,
} from "../../../../gestion-depenses2/assets/js/utils/msProjectPlanningDates.js";
import {
  buildReferenceDocumentRestFilter,
  dedupeReferenceActions,
  getPlanningSegmentStartDate,
  planReferenceDeadlineActions,
} from "../../../../gestion-depenses2/assets/js/utils/planningReferenceDeadlines.js";

const REFERENCES_TABLE_NAME = "References2";
const REFERENCE_DATA_CHANGE_STORAGE_KEY = "grist.references-data-change";
const REFERENCE_READ_CHUNK_SIZE = 20;
const REFERENCE_FULL_READ_CACHE_MS = 30000;
// Colonne « service » de Planning_Projet et de References2, celle du runtime partagé.
const SERVICE_COLUMN = "Service";

const _msProjectServiceDiagnostics = {
  fetchTableCount: 0,
  fetchTableDurationMs: 0,
  restFetchCount: 0,
  restFetchDurationMs: 0,
  actionBatchCount: 0,
  actionCount: 0,
  actionDurationMs: 0,
};

let _cachedProjectNames = null;
let _readOnlyAccessTokenEntry = null;
let _readOnlyAccessTokenPromise = null;
let _restUnavailable = false;
// Tables dont la lecture REST filtrée n'est pas fiable ici : jeton sans visibilité (réponse
// vide alors que le widget, lui, voit des lignes), filtre refusé, panne.
const _restBlindTables = new Set();
// Tables où le jeton REST a montré au moins une ligne : une réponse vide y est vraie.
const _restVisibleTables = new Set();
// Dernière lecture complète de References2 au repli : { rows, loadedAt }.
let _referenceFullRead = null;

export function getMsProjectServiceDiagnostics() {
  return { ..._msProjectServiceDiagnostics };
}

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

async function fetchTableRows(tableName, options = {}) {
  const grist = getGrist();

  if (!grist.docApi || typeof grist.docApi.fetchTable !== "function") {
    throw new Error("grist.docApi.fetchTable(...) indisponible.");
  }

  _msProjectServiceDiagnostics.fetchTableCount += 1;
  const fetchStartedAt = performance.now();
  const raw = await grist.docApi.fetchTable(tableName, options);
  _msProjectServiceDiagnostics.fetchTableDurationMs += performance.now() - fetchStartedAt;
  return normalizeFetchTableResult(raw);
}

function restRecordsToRows(raw) {
  if (!raw || !Array.isArray(raw.records)) return [];
  return raw.records.map((record) => ({
    id: record?.id,
    ...(record?.fields && typeof record.fields === "object" ? record.fields : {}),
  }));
}

async function getReadOnlyAccessToken({ forceRefresh = false } = {}) {
  const grist = getGrist();
  if (typeof grist.docApi?.getAccessToken !== "function") {
    throw new Error("Jeton REST Grist indisponible.");
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    _readOnlyAccessTokenEntry &&
    _readOnlyAccessTokenEntry.expiresAt > now
  ) {
    return _readOnlyAccessTokenEntry.access;
  }
  if (_readOnlyAccessTokenPromise) return _readOnlyAccessTokenPromise;

  _readOnlyAccessTokenPromise = Promise.resolve(
    grist.docApi.getAccessToken({ readOnly: true })
  ).then((access) => {
    const baseUrl = toText(access?.baseUrl);
    const token = typeof access?.token === "string" ? access.token : "";
    const ttlMsecs = Math.max(0, Number(access?.ttlMsecs) || 0);
    if (!baseUrl || !token || !ttlMsecs) {
      throw new Error("Jeton REST Grist invalide.");
    }
    const renewBeforeMs = Math.min(30000, Math.max(100, Math.floor(ttlMsecs * 0.1)));
    _readOnlyAccessTokenEntry = {
      access: { baseUrl, token },
      expiresAt: Date.now() + Math.max(0, ttlMsecs - renewBeforeMs),
    };
    return _readOnlyAccessTokenEntry.access;
  }).finally(() => {
    _readOnlyAccessTokenPromise = null;
  });
  return _readOnlyAccessTokenPromise;
}

async function fetchRestRows(tableName, filter = null, { authRetry = false, limit = 0 } = {}) {
  if (typeof window.fetch !== "function") {
    throw new Error("API fetch indisponible pour la lecture REST Grist.");
  }

  const access = await getReadOnlyAccessToken();
  const query = [];
  if (filter && typeof filter === "object") {
    query.push(`filter=${encodeURIComponent(JSON.stringify(filter))}`);
  }
  if (limit > 0) {
    query.push(`limit=${limit}`);
  }
  query.push(`auth=${encodeURIComponent(access.token)}`);
  const baseUrl = access.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/tables/${encodeURIComponent(tableName)}/records?${query.join("&")}`;
  _msProjectServiceDiagnostics.restFetchCount += 1;
  const fetchStartedAt = performance.now();
  const response = await window.fetch(url);
  _msProjectServiceDiagnostics.restFetchDurationMs += performance.now() - fetchStartedAt;

  if ([401, 403].includes(Number(response?.status)) && !authRetry) {
    _readOnlyAccessTokenEntry = null;
    await getReadOnlyAccessToken({ forceRefresh: true });
    return fetchRestRows(tableName, filter, { authRetry: true, limit });
  }
  if (!response?.ok) {
    throw new Error(`Lecture REST Grist impossible (${Number(response?.status) || "reseau"}).`);
  }

  const raw = await response.json();
  if (!raw || !Array.isArray(raw.records)) {
    throw new Error("Reponse REST Grist invalide.");
  }
  return restRecordsToRows(raw);
}

function rowMatchesRestFilter(row, filter) {
  if (!filter || typeof filter !== "object") return true;
  return Object.entries(filter).every(([column, values]) =>
    (Array.isArray(values) ? values : [values]).some((value) => Object.is(row?.[column], value))
  );
}

// Même règle que le runtime partagé (shared/grist-service-context.js) : si REST
// est injoignable (jeton refusé, adresse API du serveur fausse, réponse en
// erreur), on relit la table par le canal Grist du widget et on applique le
// filtre ici. Cette lecture est complète ; après une panne, REST n'est plus
// retenté jusqu'au rechargement du widget.
async function fetchRowsRestFirst(tableName, filter = null) {
  if (!_restUnavailable) {
    try {
      return await fetchRestRows(tableName, filter);
    } catch (error) {
      _restUnavailable = true;
      console.warn("Lecture REST Grist indisponible ; repli sur fetchTable.", error);
    }
  }
  const rows = await fetchTableRows(tableName);
  return rows.filter((row) => rowMatchesRestFilter(row, filter));
}

// Lecture filtrée d'une table soumise aux droits d'accès (Planning_Projet, References2) :
// REST d'abord, pour que seules les lignes utiles voyagent. Le résultat contient AU MOINS
// les lignes qui passent le filtre — au repli c'est la table entière, non filtrée :
// l'appelant refait de toute façon sa propre correspondance, plus tolérante que le filtre.
//
// Le jeton REST est en lecture seule et plafonné au rôle lecteur : un propriétaire absent
// de la table Team n'y voit aucune ligne, alors que le canal Grist du widget les lui
// montre. Une réponse vide n'est donc crue qu'une fois la table vue par REST ; sinon la
// table est relue en entier, comme avant, et REST n'est plus tenté pour elle.
async function fetchRowsFilteredOrFull(
  tableName,
  filter = null,
  { readFullTable = fetchTableRows } = {}
) {
  if (filter && !_restUnavailable && !_restBlindTables.has(tableName)) {
    try {
      const rows = await fetchRestRows(tableName, filter);
      if (rows.length || _restVisibleTables.has(tableName)) {
        _restVisibleTables.add(tableName);
        return rows;
      }
      if ((await fetchRestRows(tableName, null, { limit: 1 })).length) {
        _restVisibleTables.add(tableName);
        return rows;
      }
      _restBlindTables.add(tableName);
    } catch (error) {
      _restBlindTables.add(tableName);
      console.warn(`Lecture REST filtrée de ${tableName} impossible ; lecture complète.`, error);
    }
  }
  return readFullTable(tableName);
}

// Repli de References2 (REST injoignable ou sans visibilité) : la table entière est gardée
// 30 s, comme le fait le runtime partagé pour Planning Projet. Sans cela, chaque date
// modifiée la ferait relire en entier. Elle est oubliée dès que ce widget y écrit.
async function fetchAllReferenceRows() {
  const cached = _referenceFullRead;
  if (cached && Date.now() - cached.loadedAt < REFERENCE_FULL_READ_CACHE_MS) {
    return cached.rows;
  }
  const rows = await fetchTableRows(REFERENCES_TABLE_NAME);
  _referenceFullRead = { rows, loadedAt: Date.now() };
  return rows;
}

function invalidateMsProjectCaches({ catalog = false } = {}) {
  if (!catalog) return;

  _cachedProjectNames = null;
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

// Niveau hiérarchique MS Project d'une tâche : 1 pour une section de premier rang, 2 pour ce
// qu'elle contient, etc. C'est lui qui permet de replier une section dans le widget. Vide
// quand il est illisible.
function readOutlineLevel(taskNode) {
  const text = getDirectChildTextByLocalName(taskNode, "OutlineLevel");
  if (!/^\d+$/.test(text)) return "";
  const level = Number(text);
  return level >= 1 ? String(level) : "";
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

function findOutlineCodeValueId(taskNode, expectedFieldId) {
  if (!taskNode || !expectedFieldId) return "";
  const expected = toText(expectedFieldId);
  if (!expected) return "";

  const outlineCodes = Array.from(taskNode.children || []).filter(
    (node) => node?.localName === "OutlineCode"
  );

  for (const outlineCodeNode of outlineCodes) {
    const fieldId = getDirectChildTextByLocalName(outlineCodeNode, "FieldID");
    if (fieldId !== expected) continue;
    return getDirectChildTextByLocalName(outlineCodeNode, "ValueID");
  }

  return "";
}

function normalizeBarStyleLabel(rawValue) {
  const text = toText(rawValue);
  if (!text) return "";
  return text
    .replace(/^\s*\d+\s*-\s*/, "")
    .replace(/\s*\|\s*\d+\s*$/, "")
    .trim();
}

function normalizeLookupText(value) {
  return toText(value).toLocaleLowerCase("fr");
}

function getDirectChildrenByLocalName(parentNode, localName) {
  if (!parentNode || typeof localName !== "string") return [];
  return Array.from(parentNode.children || []).filter((node) => node?.localName === localName);
}

function findProjectExtendedAttribute(xmlDocument, { fieldIds = [], aliases = [] } = {}) {
  const projectNode = xmlDocument?.documentElement;
  const extendedAttributesNode = getDirectChildrenByLocalName(
    projectNode,
    "ExtendedAttributes"
  )[0];
  const extendedAttributes = getDirectChildrenByLocalName(
    extendedAttributesNode,
    "ExtendedAttribute"
  );
  if (!extendedAttributes.length) return null;

  const normalizedAliases = new Set(aliases.map(normalizeLookupText).filter(Boolean));
  const normalizedFieldIds = new Set(fieldIds.map(toText).filter(Boolean));

  const byAlias = extendedAttributes.find((attributeNode) =>
    normalizedAliases.has(getDirectChildTextByLocalName(attributeNode, "Alias").toLocaleLowerCase("fr"))
  );
  if (byAlias) return byAlias;

  return (
    extendedAttributes.find((attributeNode) =>
      normalizedFieldIds.has(getDirectChildTextByLocalName(attributeNode, "FieldID"))
    ) || null
  );
}

function findProjectOutlineCode(xmlDocument, fieldDefinition, expectedFieldId) {
  const projectNode = xmlDocument?.documentElement;
  const outlineCodesNode = getDirectChildrenByLocalName(projectNode, "OutlineCodes")[0];
  const outlineCodes = getDirectChildrenByLocalName(outlineCodesNode, "OutlineCode");
  if (!outlineCodes.length) return null;

  const expected = toText(expectedFieldId);
  const definitionLtuid = getDirectChildTextByLocalName(fieldDefinition, "Ltuid");
  const definitionGuid = getDirectChildTextByLocalName(fieldDefinition, "Guid");

  return (
    outlineCodes.find(
      (outlineCodeNode) => getDirectChildTextByLocalName(outlineCodeNode, "FieldID") === expected
    ) ||
    outlineCodes.find(
      (outlineCodeNode) =>
        definitionLtuid &&
        getDirectChildTextByLocalName(outlineCodeNode, "Guid").toLocaleLowerCase("fr") ===
          definitionLtuid.toLocaleLowerCase("fr")
    ) ||
    outlineCodes.find(
      (outlineCodeNode) =>
        definitionGuid &&
        getDirectChildTextByLocalName(outlineCodeNode, "Guid").toLocaleLowerCase("fr") ===
          definitionGuid.toLocaleLowerCase("fr")
    ) ||
    null
  );
}

function buildOutlineCodeValueMap(outlineCodeNode) {
  const valuesNode = getDirectChildrenByLocalName(outlineCodeNode, "Values")[0];
  const valueNodes = getDirectChildrenByLocalName(valuesNode, "Value");
  const valueById = new Map();

  for (const valueNode of valueNodes) {
    const valueId = getDirectChildTextByLocalName(valueNode, "ValueID");
    if (!valueId) continue;
    valueById.set(valueId, {
      id: valueId,
      parentId: getDirectChildTextByLocalName(valueNode, "ParentValueID"),
      label: getDirectChildTextByLocalName(valueNode, "Value"),
    });
  }

  const resolvedById = new Map();
  const resolveValue = (valueId, visited = new Set()) => {
    const id = toText(valueId);
    if (!id || resolvedById.has(id)) return resolvedById.get(id) || "";
    if (visited.has(id)) return valueById.get(id)?.label || "";

    const value = valueById.get(id);
    if (!value) return "";

    visited.add(id);
    const ownLabel = value.label;
    const parentLabel =
      value.parentId && value.parentId !== "0" ? resolveValue(value.parentId, visited) : "";
    const resolved = parentLabel && ownLabel ? `${parentLabel}_${ownLabel}` : ownLabel;
    resolvedById.set(id, resolved);
    return resolved;
  };

  return {
    resolve(valueId) {
      return resolveValue(valueId);
    },
  };
}

function createBarStyleResolver(xmlDocument) {
  const newStyleFieldId = "188744108";
  const oldStyleFieldId = "188744016";
  const newStyleDefinition = findProjectExtendedAttribute(xmlDocument, {
    fieldIds: [newStyleFieldId],
    aliases: ["Style Gantt"],
  });
  const oldStyleDefinition = findProjectExtendedAttribute(xmlDocument, {
    fieldIds: [oldStyleFieldId],
    aliases: ["Style Barre"],
  });

  const newStyleOutlineCode = newStyleDefinition
    ? findProjectOutlineCode(xmlDocument, newStyleDefinition, newStyleFieldId)
    : null;
  const newStyleValueMap = newStyleOutlineCode
    ? buildOutlineCodeValueMap(newStyleOutlineCode)
    : null;

  return {
    resolve(taskNode) {
      if (newStyleValueMap) {
        const newStyleValueId = findOutlineCodeValueId(taskNode, newStyleFieldId);
        const newStyleValue = normalizeBarStyleLabel(newStyleValueMap.resolve(newStyleValueId));
        if (newStyleValue) return newStyleValue;
      }

      if (oldStyleDefinition) {
        return normalizeBarStyleLabel(findExtendedAttributeValue(taskNode, oldStyleFieldId));
      }

      return "";
    },
  };
}

// Style de ligne du tableau MS Project, rangé par le modèle de planning dans son champ
// « StyleTab » : « Auto », « Niv_3 », « Titre_1 », « HL_Rouge »… Le fichier XML ne porte que
// ce nom, jamais la couleur : c'est le widget qui la retrouve à l'affichage.
// Le champ n'est reconnu qu'à son nom : son numéro est un emplacement libre de MS Project,
// qu'un autre modèle de planning peut employer à tout autre chose.
function createRowStyleResolver(xmlDocument) {
  const definition = findProjectExtendedAttribute(xmlDocument, { aliases: ["StyleTab"] });
  const fieldId = getDirectChildTextByLocalName(definition, "FieldID");
  const outlineCode = definition
    ? findProjectOutlineCode(xmlDocument, definition, fieldId)
    : null;
  const valueMap = outlineCode ? buildOutlineCodeValueMap(outlineCode) : null;

  return {
    resolve(taskNode) {
      return valueMap ? valueMap.resolve(findOutlineCodeValueId(taskNode, fieldId)) : "";
    },
  };
}

async function applyUserActionsInBatches(actions, batchSize = 200) {
  if (!Array.isArray(actions) || !actions.length) return;
  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  for (let index = 0; index < actions.length; index += batchSize) {
    const batch = actions.slice(index, index + batchSize);
    _msProjectServiceDiagnostics.actionBatchCount += 1;
    _msProjectServiceDiagnostics.actionCount += batch.length;
    const actionsStartedAt = performance.now();
    await grist.docApi.applyUserActions(batch);
    _msProjectServiceDiagnostics.actionDurationMs += performance.now() - actionsStartedAt;
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

function buildComparableKeys(value) {
  const text = toText(value);
  if (!text) return [];

  const keys = [`text:${text}`];
  const number = parseComparableNumber(text);
  if (number != null) {
    keys.push(`number:${number}`);
  }
  return keys;
}

function buildMsProjectRowsByUniqueNumber(rows, uniqueNumberCol) {
  const lookup = new Map();
  for (const row of rows || []) {
    for (const key of buildComparableKeys(row?.[uniqueNumberCol])) {
      if (!lookup.has(key)) {
        lookup.set(key, row);
      }
    }
  }
  return lookup;
}

function findMsProjectRowForPlanningLine(lookup, planningLineValue) {
  for (const key of buildComparableKeys(planningLineValue)) {
    if (lookup.has(key)) {
      return lookup.get(key);
    }
  }
  return null;
}

function resolvePlanningDemarrageSyncColumns(planningRows, planningTable) {
  const columns = planningTable.columns || {};
  return {
    idCol: columns.id || "id",
    projectCol: resolveColumn(
      planningRows,
      columns.projectLink,
      planningTable.projectLinkCandidates || []
    ),
    lineCol: resolveColumn(
      planningRows,
      columns.linePlanning,
      planningTable.linePlanningCandidates || []
    ),
    nomXmlCol: resolveColumn(
      planningRows,
      columns.nomXml,
      planningTable.nomXmlCandidates || []
    ),
    demarrageCol: resolveColumn(
      planningRows,
      columns.demarragesTravaux,
      planningTable.demarrageCandidates || []
    ),
    typeDocCol: resolveColumn(
      planningRows,
      columns.typeDoc || "Type_doc",
      ["Type_doc", "TypeDoc"]
    ),
    dateLimiteCol: resolveColumn(
      planningRows,
      columns.dateLimite || "Date_limite",
      ["Date_limite", "DateLimite"]
    ),
    duree1Col: resolveColumn(
      planningRows,
      columns.duree1 || "Duree_1",
      ["Duree_1", "Duree1"]
    ),
    diffCoffrageCol: resolveColumn(
      planningRows,
      columns.diffCoffrage || "Diff_coffrage",
      ["Diff_coffrage", "DiffCoffrage"]
    ),
    duree2Col: resolveColumn(
      planningRows,
      columns.duree2 || "Duree_2",
      ["Duree_2", "Duree2"]
    ),
    diffArmatureCol: resolveColumn(
      planningRows,
      columns.diffArmature || "Diff_armature",
      ["Diff_armature", "DiffArmature"]
    ),
    duree3Col: resolveColumn(
      planningRows,
      columns.duree3 || "Duree_3",
      ["Duree_3", "Duree3"]
    ),
  };
}

// Noms des colonnes de Planning_Projet, tels que les attendent les modules partagés avec
// Planning Projet (règle des dates, suivi des données d'entrée).
function toSharedPlanningColumns(syncColumns) {
  return {
    id: syncColumns.idCol,
    projectLink: syncColumns.projectCol,
    typeDoc: syncColumns.typeDocCol,
    dateLimite: syncColumns.dateLimiteCol,
    duree1: syncColumns.duree1Col,
    diffCoffrage: syncColumns.diffCoffrageCol,
    duree2: syncColumns.duree2Col,
    diffArmature: syncColumns.diffArmatureCol,
    duree3: syncColumns.duree3Col,
    demarragesTravaux: syncColumns.demarrageCol,
  };
}

// Valeurs d'un filtre REST sur un numéro unique : Grist le rend en texte ou en nombre
// selon le type de la colonne, le filtre compare à l'identique.
function buildLinkFilterValues(value) {
  const text = toText(value);
  const values = [text];
  const number = parseComparableNumber(text);
  if (number != null) values.push(number);
  return values;
}

// Les widgets voisins qui affichent References2 (même navigateur) se rafraîchissent sur ce
// signal local : il ne coûte aucune requête.
function emitReferenceDataChangeSignal() {
  try {
    window.localStorage?.setItem(
      REFERENCE_DATA_CHANGE_STORAGE_KEY,
      JSON.stringify({ at: Date.now(), source: "ms-project", nonce: Math.random() })
    );
  } catch (_error) {
    // Stockage indisponible dans une iframe restrictive : les voisins se rafraîchiront plus tard.
  }
}

// Données d'entrée des lignes données. Le filtre voyage dans l'adresse de la requête : il
// est posé par lots de lignes pour qu'elle reste courte.
async function fetchReferenceRowsForPlanningRows(planningRows, columns) {
  const rows = [];
  for (let index = 0; index < planningRows.length; index += REFERENCE_READ_CHUNK_SIZE) {
    const filter = buildReferenceDocumentRestFilter(
      planningRows.slice(index, index + REFERENCE_READ_CHUNK_SIZE),
      columns
    );
    // Sans nom ni numéro de document, une ligne n'a aucune donnée d'entrée à retrouver.
    if (!filter) continue;
    rows.push(...await fetchRowsFilteredOrFull(REFERENCES_TABLE_NAME, filter, {
      readFullTable: fetchAllReferenceRows,
    }));
    // Au repli, la table entière vient d'être lue : inutile de la relire pour le lot suivant.
    if (_restUnavailable || _restBlindTables.has(REFERENCES_TABLE_NAME)) break;
  }
  return rows;
}

// Écritures References2 des lignes dont le DÉBUT de barre bouge : leur date limite garde
// son écart en semaines, leur retard est recompté. Même règle que Planning Projet, qui la
// joue à chacune de ses propres écritures de dates.
async function planReferenceFollowUp(writtenRows, fieldsByRowId, columns) {
  const idCol = columns.id || "id";
  const movedRows = writtenRows.filter((row) => {
    const before = getPlanningSegmentStartDate(row, columns);
    const after = getPlanningSegmentStartDate(
      { ...row, ...fieldsByRowId.get(Number(row?.[idCol])) },
      columns
    );
    return (before?.getTime() ?? null) !== (after?.getTime() ?? null);
  });
  if (!movedRows.length) return [];

  let referenceRows = [];
  try {
    referenceRows = await fetchReferenceRowsForPlanningRows(movedRows, columns);
  } catch (error) {
    // Les dates du planning sont écrites quand même : les données d'entrée seront recalées
    // à la prochaine modification de la ligne dans Planning Projet.
    console.warn("Données d'entrée illisibles : leurs dates limites ne suivent pas.", error);
    return [];
  }

  // Planning Projet ne lit que les données d'entrée du service affiché. MS Project n'a pas
  // de service : il se cale sur celui de la ligne qu'il déplace, pour ne jamais écrire les
  // données d'entrée d'un autre service. Une ligne ou une référence sans service (anciennes
  // données) n'est pas restreinte.
  const rowsByService = new Map();
  movedRows.forEach((row) => {
    const serviceKey = toServiceKey(row?.[SERVICE_COLUMN]);
    if (!rowsByService.has(serviceKey)) rowsByService.set(serviceKey, []);
    rowsByService.get(serviceKey).push(row);
  });

  const actions = [];
  rowsByService.forEach((planningRows, serviceKey) => {
    const serviceReferences = serviceKey
      ? referenceRows.filter((reference) => {
          const referenceService = toServiceKey(reference?.[SERVICE_COLUMN]);
          return !referenceService || referenceService === serviceKey;
        })
      : referenceRows;
    actions.push(...planReferenceDeadlineActions({
      planningRows,
      fieldsByRowId,
      referenceRows: serviceReferences,
      columns,
    }));
  });
  return dedupeReferenceActions(actions);
}

function toServiceKey(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
}

// Pour des lignes liées à une tâche MS Project (`linkedRows` : { row, msStart, msEnd }),
// écrit les dates que donne la tâche — la règle est celle du dépôt dans Planning Projet —
// puis fait suivre leurs données d'entrée. Une ligne dont aucune date ne change n'est pas
// réécrite : l'écriture coûte au serveur et réveille les autres widgets.
async function applyPlanningDateSync(planningTable, syncColumns, linkedRows) {
  const columns = toSharedPlanningColumns(syncColumns);
  const fieldsByRowId = new Map();
  const writtenRows = [];

  for (const { row, msStart, msEnd } of linkedRows) {
    const rowId = Number(row?.[syncColumns.idCol]);
    if (!Number.isInteger(rowId) || rowId <= 0 || fieldsByRowId.has(rowId)) continue;

    const fields = keepChangedPlanningDateFields(
      row,
      buildMsLinkedPlanningDateFields(row, columns, { msStart, msEnd })
    );
    if (!Object.keys(fields).length) continue;

    fieldsByRowId.set(rowId, fields);
    writtenRows.push(row);
  }

  if (!writtenRows.length) {
    return { updatedCount: 0, referenceUpdatedCount: 0, referenceFailed: false };
  }

  const planningActions = [...fieldsByRowId].map(([rowId, fields]) => [
    "UpdateRecord",
    planningTable.sourceTable,
    rowId,
    fields,
  ]);
  // Calculé avant toute écriture : l'écart de chaque donnée d'entrée se mesure sur les
  // lignes telles qu'elles sont encore.
  const referenceActions = await planReferenceFollowUp(writtenRows, fieldsByRowId, columns);

  await applyUserActionsInBatches(planningActions);

  // Les données d'entrée partent ensuite, à part, comme dans Planning Projet : un refus sur
  // References2 (droits, ligne supprimée entre la lecture et l'écriture) ne doit pas
  // bloquer les dates du planning, que ce widget écrivait déjà seules.
  let referenceUpdatedCount = 0;
  let referenceFailed = false;
  if (referenceActions.length) {
    try {
      await applyUserActionsInBatches(referenceActions);
      referenceUpdatedCount = referenceActions.length;
      emitReferenceDataChangeSignal();
    } catch (error) {
      referenceFailed = true;
      console.warn("Dates du planning écrites, mais pas celles de leurs données d'entrée.", error);
    } finally {
      _referenceFullRead = null;
    }
  }

  return {
    updatedCount: planningActions.length,
    referenceUpdatedCount,
    referenceFailed,
  };
}

async function syncPlanningDemarragesFromImportedMsProjectRows(
  importedRecords,
  sourceFileName
) {
  const msTable = APP_CONFIG.grist.msProjectTable;
  const planningTable = APP_CONFIG.grist.planningSyncTable;

  if (!planningTable?.enabled) {
    return {
      updatedCount: 0,
      matchedCount: 0,
      skipped: true,
      invalidStartCount: 0,
      referenceUpdatedCount: 0,
      referenceFailed: false,
    };
  }
  if (!planningTable?.sourceTable) {
    throw new Error("Configuration table Planning_Projet manquante.");
  }

  const uniqueNumberCol = msTable.columns?.uniqueNumber;
  const startCol = msTable.columns?.start;
  const endCol = msTable.columns?.end;
  if (!uniqueNumberCol || !startCol || !endCol) {
    throw new Error("Mapping MS Project incomplet pour la synchronisation Planning_Projet.");
  }

  // Seules les lignes liées à ce fichier XML sont concernées : inutile de lire la table
  // entière, tous projets confondus.
  const xmlName = toText(sourceFileName);
  const nomXmlColumn = toText(planningTable.columns?.nomXml);
  const planningRows = await fetchRowsFilteredOrFull(
    planningTable.sourceTable,
    nomXmlColumn && xmlName ? { [nomXmlColumn]: [xmlName] } : null
  );
  const syncColumns = resolvePlanningDemarrageSyncColumns(planningRows, planningTable);
  if (!syncColumns.lineCol || !syncColumns.demarrageCol) {
    throw new Error("Colonnes Planning_Projet introuvables pour la synchronisation.");
  }

  const msRowsByUniqueNumber = buildMsProjectRowsByUniqueNumber(
    importedRecords,
    uniqueNumberCol
  );
  const linkedRows = [];
  let matchedCount = 0;
  let invalidStartCount = 0;

  for (const row of planningRows) {
    const msRow = findMsProjectRowForPlanningLine(
      msRowsByUniqueNumber,
      row?.[syncColumns.lineCol]
    );
    if (!msRow) continue;
    if (syncColumns.nomXmlCol && xmlName && toText(row?.[syncColumns.nomXmlCol]) !== xmlName) {
      continue;
    }

    matchedCount += 1;
    const startIso = toText(msRow?.[startCol]);
    if (!isIsoDate(startIso)) {
      invalidStartCount += 1;
      continue;
    }

    linkedRows.push({ row, msStart: startIso, msEnd: toText(msRow?.[endCol]) });
  }

  const { updatedCount, referenceUpdatedCount, referenceFailed } = await applyPlanningDateSync(
    planningTable,
    syncColumns,
    linkedRows
  );
  return {
    updatedCount,
    matchedCount,
    skipped: false,
    invalidStartCount,
    referenceUpdatedCount,
    referenceFailed,
  };
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
  const rowStyleCol = columns.rowStyle;
  const indicatorCol = columns.indicator;
  const teamCol = columns.team;
  const subTeamCol = columns.subTeam;
  const levelCol = columns.level;
  const effortCol = columns.effort;
  const projectLinkCol = columns.projectLink;
  const titleCol = columns.title;
  const boldCol = columns.bold;
  const sourceNameCol = columns.sourceName || "Nom";

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
  const barStyleResolver = createBarStyleResolver(xmlDocument);
  const rowStyleResolver = createRowStyleResolver(xmlDocument);
  const importedRecords = [];

  for (const [taskIndex, taskNode] of taskNodes.entries()) {
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
    if (levelCol) record[levelCol] = readOutlineLevel(taskNode);
    if (rowStyleCol) record[rowStyleCol] = rowStyleResolver.resolve(taskNode);
    if (indicatorCol) record[indicatorCol] = taskIndex + 1;
    if (effortCol) record[effortCol] = "";
    if (projectLinkCol) record[projectLinkCol] = "";
    if (titleCol) record[titleCol] = "";
    if (boldCol) {
      record[boldCol] = getDirectChildTextByLocalName(taskNode, "Summary") === "1" ? "Oui" : "";
    }

    const normalizedStyle = barStyleResolver.resolve(taskNode);
    if (barStyleCol) record[barStyleCol] = normalizedStyle;
    // Some tables use "Style" instead of the configured "Style_Barre".
    record.Style = normalizedStyle;

    record[sourceNameCol] = sourceFileName;

    importedRecords.push(record);
  }

  if (!importedRecords.length) {
    throw new Error("Aucune tache exploitable trouvee (UID/Name manquants).");
  }

  const existingRows = await fetchRowsRestFirst(table.sourceTable, {
    [sourceNameCol]: [sourceFileName],
  });
  const columnNames = existingRows.length
    ? Object.keys(existingRows[0])
    : [...new Set(Object.values(columns).map(toText).filter(Boolean))];
  const hasKnownColumns = columnNames.length > 0;
  const canUseColumn = (columnName) => {
    if (!columnName) return false;
    return !hasKnownColumns || columnNames.includes(columnName);
  };

  const resolvedSourceNameCol = resolveColumn(
    existingRows,
    sourceNameCol,
    table.sourceNameCandidates || ["Nom"]
  );
  const idCol = columns.id || "id";
  const rowIdsToDelete = existingRows
    .filter((row) => resolvedSourceNameCol && row?.[resolvedSourceNameCol] === sourceFileName)
    .map((row) => Number(row?.[idCol]))
    .filter((rowId) => Number.isInteger(rowId) && rowId > 0);

  const actions = [];
  let addedCount = 0;
  for (const rowId of rowIdsToDelete) {
    actions.push(["RemoveRecord", table.sourceTable, rowId]);
  }

  for (const rawRecord of importedRecords) {
    const record = {};
    for (const [column, value] of Object.entries(rawRecord)) {
      if (canUseColumn(column)) {
        record[column] = value;
      }
    }

    if (!Object.keys(record).length) continue;

    actions.push(["AddRecord", table.sourceTable, null, record]);
    addedCount += 1;
  }

  if (addedCount !== importedRecords.length) {
    throw new Error(
      "Le schema MsProject ne permet pas d'importer toutes les taches ; aucune ecriture n'a ete lancee."
    );
  }

  await applyUserActionsInBatches(actions);
  invalidateMsProjectCaches();

  let catalogNameAdded = false;
  try {
    catalogNameAdded = await ensureProjectNameInCatalog(sourceFileName);
  } catch (error) {
    const catalogTableName = APP_CONFIG.grist.msProjectNamesTable?.sourceTable || "catalogue MS Project";
    throw new Error(
      `Les donnees MS Project ont ete importees, mais la synchronisation de ${catalogTableName} a echoue : ${error.message}`,
      { cause: error }
    );
  }

  const planningSyncResult = await syncPlanningDemarragesFromImportedMsProjectRows(
    importedRecords,
    sourceFileName
  );

  return {
    extractedTaskCount: taskNodes.length,
    processedCount: importedRecords.length,
    importedCount: addedCount,
    addedCount,
    deletedCount: rowIdsToDelete.length,
    updatedCount: 0,
    planningSyncUpdatedCount: planningSyncResult.updatedCount,
    planningSyncMatchedCount: planningSyncResult.matchedCount,
    planningSyncSkipped: planningSyncResult.skipped,
    planningSyncInvalidStartCount: planningSyncResult.invalidStartCount,
    planningSyncReferenceUpdatedCount: planningSyncResult.referenceUpdatedCount,
    planningSyncReferenceFailed: planningSyncResult.referenceFailed,
    catalogNameAdded,
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

  _msProjectServiceDiagnostics.actionBatchCount += 1;
  _msProjectServiceDiagnostics.actionCount += 1;
  const actionsStartedAt = performance.now();
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
  _msProjectServiceDiagnostics.actionDurationMs += performance.now() - actionsStartedAt;
}

// `msRow` : la tâche telle que le widget l'affiche déjà. Fournie, elle évite de la relire.
export async function syncPlanningDemarrageFromMsProjectStart(
  rowId,
  isoDate,
  selectedProject = "",
  { msRow: knownMsRow = null } = {}
) {
  const msTable = APP_CONFIG.grist.msProjectTable;
  const planningTable = APP_CONFIG.grist.planningSyncTable;
  const skippedResult = {
    updatedCount: 0,
    matchedCount: 0,
    skipped: true,
    referenceUpdatedCount: 0,
    referenceFailed: false,
  };

  if (!planningTable?.enabled) {
    return skippedResult;
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

  const sourceNameColumn = msTable.columns?.sourceName || "Nom";
  const msIdCol = msTable.columns?.id || "id";
  const msUniqueCol = msTable.columns?.uniqueNumber;
  const msEndCol = msTable.columns?.end;

  let msRow = knownMsRow && Number(knownMsRow?.[msIdCol]) === recordId ? knownMsRow : null;
  let msRows = msRow ? [msRow] : [];
  if (!msRow) {
    const normalizedProject = toText(selectedProject);
    if (!normalizedProject) {
      return skippedResult;
    }
    msRows = await fetchRowsRestFirst(msTable.sourceTable, {
      [sourceNameColumn]: [normalizedProject],
    });
    msRow = msRows.find((row) => Number(row?.[msIdCol]) === recordId) || null;
  }
  const msSourceNameCol = resolveColumn(
    msRows,
    msTable.columns?.sourceName || "Nom",
    msTable.sourceNameCandidates || ["Nom"]
  );

  if (!msUniqueCol) {
    throw new Error("Colonne Numero_Unique non configuree dans MsProject.");
  }

  if (!msRow) {
    return skippedResult;
  }

  const msUniqueValue = msRow[msUniqueCol];
  const msXmlName = msSourceNameCol ? toText(msRow[msSourceNameCol]) : "";
  if (msUniqueValue == null || msUniqueValue === "") {
    return skippedResult;
  }

  // Seules les lignes liées à cette tâche sont concernées : inutile de lire la table
  // entière, tous projets confondus.
  const lineColumn = toText(planningTable.columns?.linePlanning);
  const planningRows = await fetchRowsFilteredOrFull(
    planningTable.sourceTable,
    lineColumn ? { [lineColumn]: buildLinkFilterValues(msUniqueValue) } : null
  );
  const syncColumns = resolvePlanningDemarrageSyncColumns(planningRows, planningTable);
  if (!syncColumns.lineCol || !syncColumns.demarrageCol) {
    throw new Error("Colonnes Planning_Projet introuvables pour la synchronisation.");
  }

  const matchingRows = planningRows.filter((row) => {
    if (!equalsByTextOrNumber(row[syncColumns.lineCol], msUniqueValue)) return false;
    if (!syncColumns.nomXmlCol || !msXmlName) return true;
    return toText(row[syncColumns.nomXmlCol]) === msXmlName;
  });

  if (!matchingRows.length) {
    return { ...skippedResult, skipped: false };
  }

  const msEndIso = msEndCol ? toText(msRow[msEndCol]) : "";
  const { updatedCount, referenceUpdatedCount, referenceFailed } = await applyPlanningDateSync(
    planningTable,
    syncColumns,
    matchingRows.map((row) => ({ row, msStart: normalizedIsoDate, msEnd: msEndIso }))
  );
  return {
    updatedCount,
    matchedCount: matchingRows.length,
    skipped: false,
    referenceUpdatedCount,
    referenceFailed,
  };
}

export function isMsProjectEnabled() {
  return Boolean(APP_CONFIG.grist.msProjectTable?.enabled);
}

export function getMsProjectSetupMessage() {
  const sourceTable = APP_CONFIG.grist.msProjectTable?.sourceTable || "(table non definie)";
  return `Base MS Project creee. Active APP_CONFIG.grist.msProjectTable.enabled puis ajuste le mapping de la table ${sourceTable}.`;
}

function normalizeProjectNames(rows, nameColumn) {
  return [...new Set(
    rows
      .map((row) => toText(row?.[nameColumn]))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "fr"));
}

export async function buildProjectOptions({ forceRefresh = false } = {}) {
  const table = APP_CONFIG.grist.msProjectNamesTable;
  const tableName = table?.sourceTable;
  const nameColumn = table?.columns?.name;
  if (!tableName || !nameColumn) {
    throw new Error("Configuration de la table des noms MS Project incomplete.");
  }

  if (!forceRefresh && Array.isArray(_cachedProjectNames)) {
    console.info(`[GristData][CACHE] ${tableName}`, {
      valeurs: _cachedProjectNames.length,
    });
    return [..._cachedProjectNames];
  }

  const rows = await fetchTableRows(tableName);
  _cachedProjectNames = normalizeProjectNames(rows, nameColumn);
  return [..._cachedProjectNames];
}

async function ensureProjectNameInCatalog(projectName) {
  const normalizedProjectName = toText(projectName);
  if (!normalizedProjectName) {
    throw new Error("Le nom du projet importe est vide.");
  }

  const table = APP_CONFIG.grist.msProjectNamesTable;
  const tableName = table?.sourceTable;
  const nameColumn = table?.columns?.name;
  if (!tableName || !nameColumn) {
    throw new Error("Configuration de la table des noms MS Project incomplete.");
  }

  _cachedProjectNames = null;
  const existingNames = await buildProjectOptions({ forceRefresh: true });
  if (existingNames.includes(normalizedProjectName)) return false;

  await applyUserActionsInBatches([
    ["AddRecord", tableName, null, { [nameColumn]: normalizedProjectName }],
  ]);
  invalidateMsProjectCaches({ catalog: true });
  return true;
}

export async function fetchMsProjectRows(selectedProject = "") {
  const table = APP_CONFIG.grist.msProjectTable;
  if (!table?.sourceTable) {
    throw new Error("Nom de table MS Project manquant dans la configuration.");
  }
  const normalizedProject = toText(selectedProject);
  if (!normalizedProject) return [];
  const sourceNameColumn = table.columns?.sourceName || "Nom";
  const rows = await fetchRowsRestFirst(table.sourceTable, {
    [sourceNameColumn]: [normalizedProject],
  });
  const filteredRows = rows.filter((row) => Object.is(row?.[sourceNameColumn], normalizedProject));
  console.info(`[GristData][FILTRE_LOCAL] ${table.sourceTable}`, {
    projet: normalizedProject,
    lignesRecues: rows.length,
    lignesUtiles: filteredRows.length,
  });
  return filteredRows;
}

export { toText };
