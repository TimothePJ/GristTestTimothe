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
    if (!homeService) return [];
    if (isAdminTeamRow(teamRow)) return [...SERVICES];

    const allowed = new Set([homeService]);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (normalizedNumber) {
      SERVICES.forEach((service) => {
        if (hasProjectGrant(teamRow?.[GRANT_COLUMNS[service]], normalizedNumber)) {
          allowed.add(service);
        }
      });
    }
    return SERVICES.filter((service) => allowed.has(service));
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

  function transformActions(actions, {
    selectedService,
    projectNumber,
  } = {}) {
    const normalizedService = normalizeService(selectedService);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    return (Array.isArray(actions) ? actions : []).map((action) => {
      if (!Array.isArray(action) || !["AddRecord", "UpdateRecord"].includes(action[0])) {
        return action;
      }
      const tableName = toText(action[1]);
      if (!SERVICE_AWARE_TABLES.has(tableName)) return action;
      const fields = { ...(action[3] || {}) };
      if (normalizedService) fields.Service = normalizedService;
      if (PROJECT_NUMBER_TABLES.has(tableName) && normalizedNumber && !toText(fields.NumeroProjet)) {
        fields.NumeroProjet = normalizedNumber;
      }
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
    SERVICE_AWARE_TABLES,
    PROJECT_NUMBER_TABLES,
    toText,
    normalizeProjectNumber,
    normalizeService,
    isTruthy,
    parseGrants,
    serializeGrants,
    hasProjectGrant,
    isAdminTeamRow,
    findCurrentTeamRow,
    getAllowedServices,
    tableToRows,
    filterRawTable,
    filterRawTableByService,
    parseAvancementEnvelope,
    getServiceAvancementItems,
    updateServiceAvancement,
    isMutationAction,
    transformActions,
  });
});
