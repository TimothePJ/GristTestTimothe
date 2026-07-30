(function initServiceContextCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GristServiceContextCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createServiceContextCore() {
  "use strict";

  const SERVICES = Object.freeze(["Structure", "Synthese", "Topographie"]);
  const SERVICE_STORAGE_KEY = "grist.selected-service";
  const PROJECT_STORAGE_KEY = "grist.selected-project";
  const PROJECT_ID_STORAGE_KEY = "grist.selected-project-id";
  const LEGACY_DEFAULT_SERVICE = "Structure";
  const GRANT_COLUMNS = Object.freeze({
    Structure: "Projets_Lecture_Structure",
    Synthese: "Projets_Lecture_Synthese",
    Topographie: "Projets_Lecture_Topographie",
  });
  const PROJECTS_TABLE = "Projets2";
  const PROJECT_NAME_COLUMNS = Object.freeze({
    References2: "NomProjet",
    ListePlan_NDC_COF: "Nom_projet",
    Planning_Projet: "NomProjet",
    Envois: "Projet",
  });
  const SERVICE_AWARE_TABLES = Object.freeze(new Set([
    "References2",
    "ListePlan_NDC_COF",
    "Planning_Projet",
    "Envois",
    "Budget",
    "ProjectTeam",
    "TimeSegment",
    "TimeReal",
    "Emetteurs",
  ]));
  const PROJECT_NUMBER_TABLES = Object.freeze(new Set([
    "Budget",
    "ProjectTeam",
    "TimeSegment",
    "TimeReal",
  ]));
  const PROJECT_AWARE_TABLES = Object.freeze(new Set([
    ...Object.keys(PROJECT_NAME_COLUMNS),
    ...PROJECT_NUMBER_TABLES,
  ]));

  function toText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
    if (Array.isArray(value)) {
      if (value[0] === "L") return value.slice(1).map(toText).filter(Boolean).join("\n");
      return value.map(toText).filter(Boolean).join("\n");
    }
    if (typeof value === "object") {
      for (const key of ["text", "value", "label", "name", "display", "details"]) {
        if (value[key] != null) return toText(value[key]);
      }
    }
    return String(value).trim();
  }

  function normalizeProjectNumber(value) {
    return toText(value).replace(/\s+/g, "");
  }

  function normalizeService(value) {
    const normalized = toText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr");
    return SERVICES.find((service) => service.toLocaleLowerCase("fr") === normalized) || "";
  }

  function isTruthy(value) {
    if (value === true || value === 1) return true;
    return ["true", "1", "oui", "yes", "x"].includes(toText(value).toLocaleLowerCase("fr"));
  }

  function parseGrants(rawValue) {
    const grantsByIdentity = new Map();
    toText(rawValue)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .forEach((line) => {
        const separatorIndex = line.indexOf("|");
        if (separatorIndex < 1) return;
        const projectNumber = normalizeProjectNumber(line.slice(0, separatorIndex));
        const projectName = toText(line.slice(separatorIndex + 1));
        if (!projectNumber) return;
        const identity = `${projectNumber}\u0000${projectName}`;
        if (!grantsByIdentity.has(identity)) {
          grantsByIdentity.set(identity, { projectNumber, projectName });
        }
      });
    return [...grantsByIdentity.values()];
  }

  function serializeGrants(grants) {
    const byIdentity = new Map();
    (Array.isArray(grants) ? grants : []).forEach((grant) => {
      const projectNumber = normalizeProjectNumber(grant?.projectNumber);
      if (!projectNumber) return;
      const projectName = toText(grant?.projectName);
      const identity = `${projectNumber}\u0000${projectName}`;
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, { projectNumber, projectName });
      }
    });
    return [...byIdentity.values()]
      .sort((left, right) => left.projectNumber.localeCompare(right.projectNumber, "fr", {
        numeric: true,
        sensitivity: "base",
      }) || left.projectName.localeCompare(right.projectName, "fr", {
        numeric: true,
        sensitivity: "base",
      }))
      .map(({ projectNumber, projectName }) => `${projectNumber}|${projectName}`)
      .join("\n");
  }

  function hasProjectGrant(rawValue, projectNumber) {
    const expected = normalizeProjectNumber(projectNumber);
    return Boolean(expected) && parseGrants(rawValue).some((grant) => grant.projectNumber === expected);
  }

  function getProjectNumber(project) {
    return normalizeProjectNumber(
      project?.number ??
      project?.projectNumber ??
      project?.Numero_de_projet ??
      project?.NumeroProjet ??
      project?.Numero
    );
  }

  function getProjectName(project) {
    return toText(
      project?.name ??
      project?.projectName ??
      project?.Nom_de_projet ??
      project?.NomProjet ??
      project?.Nom_projet ??
      project?.Projet
    );
  }

  function dedupeProjectsByNumber(projects) {
    const seen = new Set();
    return (Array.isArray(projects) ? projects : []).filter((project) => {
      const number = getProjectNumber(project);
      if (!number || seen.has(number)) return false;
      seen.add(number);
      return true;
    });
  }

  function getGrantedProjectNumbers(teamRow) {
    const numbers = new Set();
    SERVICES.forEach((service) => {
      parseGrants(teamRow?.[GRANT_COLUMNS[service]]).forEach((grant) => {
        numbers.add(grant.projectNumber);
      });
    });
    return numbers;
  }

  function getAllowedProjects(teamRow, projects) {
    const homeService = normalizeService(teamRow?.Service);
    if (!homeService) return [];
    const uniqueProjects = dedupeProjectsByNumber(projects);
    if (homeService === "Structure") return uniqueProjects;
    const grantedNumbers = getGrantedProjectNumbers(teamRow);
    return uniqueProjects.filter((project) => grantedNumbers.has(getProjectNumber(project)));
  }

  function selectAllowedProject(projects, {
    projectId,
    projectName,
    projectNumber,
  } = {}) {
    const allowedProjects = Array.isArray(projects) ? projects : [];
    const expectedId = Number(projectId);
    if (Number.isInteger(expectedId) && expectedId > 0) {
      const byId = allowedProjects.find((project) => Number(project?.id) === expectedId);
      if (byId) return byId;
    }
    const expectedNumber = normalizeProjectNumber(projectNumber);
    if (expectedNumber) {
      const byNumber = allowedProjects.find((project) => getProjectNumber(project) === expectedNumber);
      if (byNumber) return byNumber;
    }
    const expectedName = toText(projectName).toLocaleLowerCase("fr");
    if (expectedName) {
      const byName = allowedProjects.find(
        (project) => getProjectName(project).toLocaleLowerCase("fr") === expectedName
      );
      if (byName) return byName;
    }
    return allowedProjects[0] || null;
  }

  function isAdminTeamRow(teamRow) {
    if (!teamRow) return false;
    if (isTruthy(teamRow.Admin) || isTruthy(teamRow.IsAdmin) || isTruthy(teamRow.Administrateur)) {
      return true;
    }
    return toText(teamRow.Role).toLocaleLowerCase("fr") === "admin";
  }

  function findCurrentTeamRow(rows) {
    const candidates = (Array.isArray(rows) ? rows : []).filter((row) => isTruthy(row?.Moi));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      return candidates.find((row) => normalizeService(row?.Service)) || candidates[0];
    }
    return null;
  }

  function getAllowedServices(teamRow, projectNumber) {
    const homeService = normalizeService(teamRow?.Service);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (!homeService || !normalizedNumber) return [];

    const allowed = new Set();
    if (homeService === "Structure") allowed.add("Structure");
    SERVICES.forEach((service) => {
      if (hasProjectGrant(teamRow?.[GRANT_COLUMNS[service]], normalizedNumber)) {
        allowed.add(service);
      }
    });
    return SERVICES.filter((service) => allowed.has(service));
  }

  function getAllowedServicesForProjects(teamRow, projects) {
    const homeService = normalizeService(teamRow?.Service);
    const allowedProjects = getAllowedProjects(teamRow, projects);
    if (!homeService || !allowedProjects.length) return [];
    const allowedNumbers = new Set(allowedProjects.map(getProjectNumber));
    const allowed = new Set();
    if (homeService === "Structure") allowed.add("Structure");
    SERVICES.forEach((service) => {
      const hasAllowedGrant = parseGrants(teamRow?.[GRANT_COLUMNS[service]])
        .some((grant) => allowedNumbers.has(grant.projectNumber));
      if (hasAllowedGrant) allowed.add(service);
    });
    return SERVICES.filter((service) => allowed.has(service));
  }

  function canEditCurrentContext(teamRow, projectNumber, selectedService) {
    const homeService = normalizeService(teamRow?.Service);
    const service = normalizeService(selectedService);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (!homeService || !service || !normalizedNumber || service !== homeService) return false;
    if (homeService === "Structure") return true;
    return hasProjectGrant(teamRow?.[GRANT_COLUMNS[service]], normalizedNumber);
  }

  function getProjectAccessMode(teamRow, projectNumber, selectedService) {
    const service = normalizeService(selectedService);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (!service || !normalizedNumber) return "hidden";
    if (!getAllowedServices(teamRow, normalizedNumber).includes(service)) return "hidden";
    return canEditCurrentContext(teamRow, normalizedNumber, service) ? "editable" : "readonly";
  }

  function getProjectGrantScope(teamRow, selectedService, homeService) {
    const selected = normalizeService(selectedService);
    const home = normalizeService(homeService || teamRow?.Service);
    if (!teamRow || !selected || !home) return { numbers: new Set(), names: new Set() };
    if (home === "Structure" && selected === "Structure") return null;

    const grantColumn = GRANT_COLUMNS[selected];
    const grants = parseGrants(teamRow?.[grantColumn]);
    return {
      numbers: new Set(grants.map((grant) => grant.projectNumber)),
      names: new Set(grants.map((grant) => grant.projectName).filter(Boolean)),
    };
  }

  function getExternalProjectGrantScope(teamRow, selectedService, homeService) {
    const selected = normalizeService(selectedService);
    const home = normalizeService(homeService || teamRow?.Service);
    if (!teamRow || !selected || selected === home) return null;
    return getProjectGrantScope(teamRow, selected, home);
  }

  function tableToRows(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.records)) {
      return raw.records.map((record) => (
        record?.fields ? { id: record.id, ...record.fields } : record
      ));
    }
    if (typeof raw !== "object") return [];
    const keys = Object.keys(raw);
    const maxLength = Math.max(0, ...keys.map((key) => (
      Array.isArray(raw[key]) ? raw[key].length : 0
    )));
    return Array.from({ length: maxLength }, (_unused, index) => {
      const row = {};
      keys.forEach((key) => {
        if (Array.isArray(raw[key])) row[key] = raw[key][index];
      });
      return row;
    });
  }

  function filterRawTable(raw, predicate) {
    if (typeof predicate !== "function") return raw;
    if (Array.isArray(raw)) return raw.filter(predicate);
    if (Array.isArray(raw?.records)) {
      return {
        ...raw,
        records: raw.records.filter((record) => predicate(
          record?.fields ? { id: record.id, ...record.fields } : record
        )),
      };
    }
    if (!raw || typeof raw !== "object") return raw;
    const keys = Object.keys(raw);
    const rows = tableToRows(raw);
    const keepIndexes = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => predicate(row))
      .map(({ index }) => index);
    return Object.fromEntries(keys.map((key) => [
      key,
      Array.isArray(raw[key]) ? keepIndexes.map((index) => raw[key][index]) : raw[key],
    ]));
  }

  function filterRawTableByService(raw, selectedService, {
    legacyDefaultService = LEGACY_DEFAULT_SERVICE,
  } = {}) {
    const expectedService = normalizeService(selectedService);
    if (!expectedService) {
      if (Array.isArray(raw)) return [];
      if (Array.isArray(raw?.records)) return { ...raw, records: [] };
      if (raw && typeof raw === "object") {
        return Object.fromEntries(Object.entries(raw).map(([key, value]) => [
          key,
          Array.isArray(value) ? [] : value,
        ]));
      }
      return raw;
    }

    const matches = (row) => {
      if (!row || !Object.prototype.hasOwnProperty.call(row, "Service")) return true;
      const rowService = normalizeService(row.Service) || normalizeService(legacyDefaultService);
      return rowService === expectedService;
    };

    if (Array.isArray(raw)) {
      const hasServiceColumn = raw.some((row) => row && Object.prototype.hasOwnProperty.call(row, "Service"));
      return hasServiceColumn ? raw.filter(matches) : raw;
    }

    if (Array.isArray(raw?.records)) {
      const hasServiceColumn = raw.records.some((record) => (
        record?.fields
          ? Object.prototype.hasOwnProperty.call(record.fields, "Service")
          : Object.prototype.hasOwnProperty.call(record || {}, "Service")
      ));
      if (!hasServiceColumn) return raw;
      return {
        ...raw,
        records: raw.records.filter((record) => matches(record?.fields || record)),
      };
    }

    if (!raw || typeof raw !== "object" || !Array.isArray(raw.Service)) return raw;
    const keepIndexes = raw.Service
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => (
        (normalizeService(value) || normalizeService(legacyDefaultService)) === expectedService
      ))
      .map(({ index }) => index);
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? keepIndexes.map((index) => value[index]) : value,
    ]));
  }

  function getRowProjectIdentity(row, tableName = "") {
    const normalizedTableName = toText(tableName);
    if (PROJECT_NUMBER_TABLES.has(normalizedTableName)) {
      return {
        kind: "number",
        value: normalizeProjectNumber(row?.NumeroProjet),
      };
    }
    const configuredNameColumn = PROJECT_NAME_COLUMNS[normalizedTableName];
    if (configuredNameColumn) {
      return {
        kind: "name",
        value: toText(row?.[configuredNameColumn]),
      };
    }

    const number = getProjectNumber(row);
    if (number) return { kind: "number", value: number };
    const name = getProjectName(row);
    if (name) return { kind: "name", value: name };
    return { kind: "", value: "" };
  }

  function filterRawTableByProject(raw, tableName, project) {
    const normalizedTableName = toText(tableName);
    if (normalizedTableName === "Emetteurs") return raw;
    const projectNumber = getProjectNumber(project);
    const projectName = getProjectName(project);
    if (!projectNumber && !projectName) {
      return filterRawTable(raw, () => false);
    }
    return filterRawTable(raw, (row) => {
      const identity = getRowProjectIdentity(row, normalizedTableName);
      if (identity.kind === "number") return Boolean(projectNumber) && identity.value === projectNumber;
      if (identity.kind === "name") return Boolean(projectName) && identity.value === projectName;
      return !PROJECT_AWARE_TABLES.has(normalizedTableName);
    });
  }

  function filterRawTableByProjectScope(raw, tableName, scope) {
    const normalizedTableName = toText(tableName);
    if (normalizedTableName === "Emetteurs" || scope === null) return raw;
    const safeScope = scope || { numbers: new Set(), names: new Set() };
    return filterRawTable(raw, (row) => {
      const identity = getRowProjectIdentity(row, normalizedTableName);
      if (identity.kind === "number") return safeScope.numbers.has(identity.value);
      if (identity.kind === "name") return safeScope.names.has(identity.value);
      return !PROJECT_AWARE_TABLES.has(normalizedTableName);
    });
  }

  function filterProjectsRaw(raw, allowedProjects) {
    const allowedNumbers = new Set((Array.isArray(allowedProjects) ? allowedProjects : []).map(getProjectNumber));
    return filterRawTable(raw, (row) => allowedNumbers.has(getProjectNumber(row)));
  }

  function parseAvancementEnvelope(rawValue) {
    const emptyServices = Object.fromEntries(SERVICES.map((service) => [service, []]));
    if (rawValue == null || rawValue === "") {
      return {
        envelope: { version: 2, services: emptyServices },
        legacy: false,
        error: null,
      };
    }
    try {
      const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
      if (Array.isArray(parsed)) {
        return {
          envelope: {
            version: 2,
            services: { ...emptyServices, [LEGACY_DEFAULT_SERVICE]: parsed },
          },
          legacy: true,
          error: null,
        };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed.services)) {
        throw new Error("Format Avancement invalide");
      }
      const servicesSource = parsed.services && typeof parsed.services === "object"
        ? parsed.services
        : {};
      const services = { ...servicesSource };
      SERVICES.forEach((service) => {
        services[service] = Array.isArray(servicesSource[service]) ? servicesSource[service] : [];
      });
      return {
        envelope: { ...parsed, version: 2, services },
        legacy: false,
        error: null,
      };
    } catch (error) {
      return {
        envelope: { version: 2, services: emptyServices },
        legacy: false,
        error,
      };
    }
  }

  function getServiceAvancementItems(rawValue, service) {
    const parsed = parseAvancementEnvelope(rawValue);
    const normalizedService = normalizeService(service) || LEGACY_DEFAULT_SERVICE;
    return {
      items: [...(parsed.envelope.services[normalizedService] || [])],
      error: parsed.error,
      legacy: parsed.legacy,
      envelope: parsed.envelope,
    };
  }

  function updateServiceAvancement(rawValue, service, items) {
    const parsed = parseAvancementEnvelope(rawValue);
    if (parsed.error) throw parsed.error;
    const normalizedService = normalizeService(service);
    if (!normalizedService) throw new Error("Service invalide pour Avancement.");
    const nextEnvelope = {
      ...parsed.envelope,
      version: 2,
      services: {
        ...parsed.envelope.services,
        [normalizedService]: Array.isArray(items) ? items : [],
      },
    };
    SERVICES.forEach((knownService) => {
      if (!Array.isArray(nextEnvelope.services[knownService])) {
        nextEnvelope.services[knownService] = [];
      }
    });
    return JSON.stringify(nextEnvelope);
  }

  function isMutationAction(action) {
    const verb = toText(action?.[0]);
    return ["AddRecord", "BulkAddRecord", "UpdateRecord", "BulkUpdateRecord", "RemoveRecord", "BulkRemoveRecord"].includes(verb);
  }

  function isProtectedMutationAction(action) {
    if (!isMutationAction(action)) return false;
    const tableName = toText(action?.[1]);
    return tableName === PROJECTS_TABLE || SERVICE_AWARE_TABLES.has(tableName);
  }

  function assertContextValue(actualValue, expectedValue, normalize, label) {
    const actual = normalize(actualValue);
    if (actual && actual !== expectedValue) {
      throw new Error(`${label} ne correspond pas au contexte sélectionné.`);
    }
  }

  function transformRecordFields(tableName, sourceFields, {
    selectedService,
    projectNumber,
    projectName,
  }) {
    const fields = { ...(sourceFields || {}) };
    if (!SERVICE_AWARE_TABLES.has(tableName)) return fields;
    if (selectedService) fields.Service = selectedService;

    if (PROJECT_NUMBER_TABLES.has(tableName) && projectNumber) {
      assertContextValue(fields.NumeroProjet, projectNumber, normalizeProjectNumber, "NumeroProjet");
      fields.NumeroProjet = projectNumber;
    }
    const projectNameColumn = PROJECT_NAME_COLUMNS[tableName];
    if (projectNameColumn && projectName) {
      assertContextValue(fields[projectNameColumn], projectName, toText, projectNameColumn);
      fields[projectNameColumn] = projectName;
    }
    return fields;
  }

  function getBulkActionLength(action, fields) {
    if (Array.isArray(action?.[2])) return action[2].length;
    return Math.max(0, ...Object.values(fields || {}).map((value) => (
      Array.isArray(value) ? value.length : 0
    )));
  }

  function transformBulkFields(tableName, sourceFields, context, rowCount) {
    const fields = { ...(sourceFields || {}) };
    const selectedService = normalizeService(context.selectedService);
    const projectNumber = normalizeProjectNumber(context.projectNumber);
    const projectName = toText(context.projectName);
    if (!SERVICE_AWARE_TABLES.has(tableName)) return fields;

    const transformColumn = (column, expected, normalize, label) => {
      if (!expected) return;
      const currentValues = Array.isArray(fields[column]) ? fields[column] : [];
      currentValues.forEach((value) => assertContextValue(value, expected, normalize, label));
      fields[column] = Array.from({ length: rowCount }, () => expected);
    };
    transformColumn("Service", selectedService, normalizeService, "Service");
    if (PROJECT_NUMBER_TABLES.has(tableName)) {
      transformColumn("NumeroProjet", projectNumber, normalizeProjectNumber, "NumeroProjet");
    }
    const projectNameColumn = PROJECT_NAME_COLUMNS[tableName];
    if (projectNameColumn) transformColumn(projectNameColumn, projectName, toText, projectNameColumn);
    return fields;
  }

  function transformActions(actions, {
    selectedService,
    projectNumber,
    projectName,
  } = {}) {
    const normalizedService = normalizeService(selectedService);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    const normalizedName = toText(projectName);
    return (Array.isArray(actions) ? actions : []).map((action) => {
      if (!Array.isArray(action) || !["AddRecord", "UpdateRecord", "BulkAddRecord", "BulkUpdateRecord"].includes(action[0])) {
        return action;
      }
      const tableName = toText(action[1]);
      if (!SERVICE_AWARE_TABLES.has(tableName)) return action;
      const context = {
        selectedService: normalizedService,
        projectNumber: normalizedNumber,
        projectName: normalizedName,
      };
      const sourceFields = action[3] || {};
      const fields = ["BulkAddRecord", "BulkUpdateRecord"].includes(action[0])
        ? transformBulkFields(tableName, sourceFields, context, getBulkActionLength(action, sourceFields))
        : transformRecordFields(tableName, sourceFields, context);
      return [action[0], action[1], action[2], fields, ...action.slice(4)];
    });
  }

  return Object.freeze({
    SERVICES,
    SERVICE_STORAGE_KEY,
    PROJECT_STORAGE_KEY,
    PROJECT_ID_STORAGE_KEY,
    LEGACY_DEFAULT_SERVICE,
    GRANT_COLUMNS,
    PROJECTS_TABLE,
    PROJECT_NAME_COLUMNS,
    SERVICE_AWARE_TABLES,
    PROJECT_NUMBER_TABLES,
    PROJECT_AWARE_TABLES,
    toText,
    normalizeProjectNumber,
    normalizeService,
    isTruthy,
    parseGrants,
    serializeGrants,
    hasProjectGrant,
    getProjectNumber,
    getProjectName,
    getGrantedProjectNumbers,
    getAllowedProjects,
    selectAllowedProject,
    isAdminTeamRow,
    findCurrentTeamRow,
    getAllowedServices,
    getAllowedServicesForProjects,
    canEditCurrentContext,
    getProjectAccessMode,
    getProjectGrantScope,
    getExternalProjectGrantScope,
    tableToRows,
    filterRawTable,
    filterRawTableByService,
    getRowProjectIdentity,
    filterRawTableByProject,
    filterRawTableByProjectScope,
    filterProjectsRaw,
    parseAvancementEnvelope,
    getServiceAvancementItems,
    updateServiceAvancement,
    isMutationAction,
    isProtectedMutationAction,
    transformActions,
  });
});
