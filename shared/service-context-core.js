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
  const ACCESS_CHANGED_STORAGE_KEY = "grist.project-access-changed";
  const ACCESS_SIGNAL_VERSION = 2;
  const ACCESS_COLUMN = "Projets_Access";
  const PROJECT_TEAM_TABLE = "ProjectTeam";
  const LEGACY_DEFAULT_SERVICE = "Structure";
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
  const REST_SERVICE_VALUES = Object.freeze({
    Structure: Object.freeze(["Structure"]),
    Synthese: Object.freeze(["Synthese", "Synthèse"]),
    Topographie: Object.freeze(["Topographie"]),
  });

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
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr");
    return SERVICES.find((service) => (
      service.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("fr") === normalized
    )) || "";
  }

  function normalizeProjectNameKey(value) {
    return toText(value)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr");
  }

  function uniqueExactValues(values) {
    const seen = new Set();
    const result = [];
    (Array.isArray(values) ? values : [values]).forEach((value) => {
      const exact = toText(value);
      if (!exact || seen.has(exact)) return;
      seen.add(exact);
      result.push(exact);
    });
    return result;
  }

  function getServiceFilterValues(service) {
    const normalizedService = normalizeService(service);
    return normalizedService
      ? [...(REST_SERVICE_VALUES[normalizedService] || [normalizedService])]
      : [];
  }

  function getProjectFilterValues(tableName, projects) {
    const normalizedTableName = toText(tableName);
    const sourceProjects = (Array.isArray(projects) ? projects : [projects]).filter(Boolean);
    if (PROJECT_NUMBER_TABLES.has(normalizedTableName)) {
      return uniqueExactValues(sourceProjects.map((project) => normalizeProjectNumber(
        project?.number ?? project?.NumeroProjet ?? project?.Numero_de_projet
      )));
    }
    if (PROJECT_NAME_COLUMNS[normalizedTableName]) {
      return uniqueExactValues(sourceProjects.flatMap((project) => {
        const names = Array.isArray(project?.names) ? project.names : [];
        return [project?.name, ...names];
      }));
    }
    return [];
  }

  function buildContextTableFilter(tableName, {
    selectedService = "",
    currentProject = null,
    allowedProjects = [],
    multiProject = false,
  } = {}) {
    const normalizedTableName = toText(tableName);
    if (!SERVICE_AWARE_TABLES.has(normalizedTableName)) {
      return {
        supported: false,
        complete: true,
        tableName: normalizedTableName,
        projectColumn: "",
        filter: null,
      };
    }

    const serviceValues = getServiceFilterValues(selectedService);
    const projectColumn = PROJECT_NUMBER_TABLES.has(normalizedTableName)
      ? "NumeroProjet"
      : (PROJECT_NAME_COLUMNS[normalizedTableName] || "");
    const projects = multiProject ? allowedProjects : [currentProject].filter(Boolean);
    const projectValues = projectColumn
      ? getProjectFilterValues(normalizedTableName, projects)
      : [];
    const complete = Boolean(serviceValues.length && (!projectColumn || projectValues.length));
    const filter = complete ? { Service: serviceValues } : null;
    if (filter && projectColumn) filter[projectColumn] = projectValues;

    return {
      supported: true,
      complete,
      tableName: normalizedTableName,
      projectColumn,
      filter,
    };
  }

  function splitContextTableFilter(filter, projectColumn, {
    maxValues = 40,
    maxEncodedLength = 1800,
  } = {}) {
    if (!filter || typeof filter !== "object") return [];
    const safeProjectColumn = toText(projectColumn);
    const projectValues = safeProjectColumn && Array.isArray(filter[safeProjectColumn])
      ? filter[safeProjectColumn]
      : [];
    if (!projectValues.length) return [{ ...filter }];

    const safeMaxValues = Math.max(1, Number(maxValues) || 40);
    const safeMaxLength = Math.max(256, Number(maxEncodedLength) || 1800);
    const chunks = [];
    let current = [];
    const pushCurrent = () => {
      if (!current.length) return;
      chunks.push({ ...filter, [safeProjectColumn]: [...current] });
      current = [];
    };

    projectValues.forEach((value) => {
      const candidate = [...current, value];
      const candidateFilter = { ...filter, [safeProjectColumn]: candidate };
      const tooLong = encodeURIComponent(JSON.stringify(candidateFilter)).length > safeMaxLength;
      if (current.length && (candidate.length > safeMaxValues || tooLong)) pushCurrent();
      current.push(value);
      if (current.length >= safeMaxValues) pushCurrent();
    });
    pushCurrent();
    return chunks;
  }

  function restRecordsToRows(envelope) {
    if (!envelope || !Array.isArray(envelope.records)) {
      throw new TypeError("Réponse REST Grist invalide : records doit être un tableau.");
    }
    return envelope.records.map((record) => {
      const fields = record?.fields && typeof record.fields === "object"
        ? { ...record.fields }
        : {};
      return { ...fields, id: record?.id };
    });
  }

  function rowsToTableData(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const columns = ["id"];
    const knownColumns = new Set(columns);
    safeRows.forEach((row) => {
      Object.keys(row || {}).forEach((column) => {
        if (knownColumns.has(column)) return;
        knownColumns.add(column);
        columns.push(column);
      });
    });
    return Object.fromEntries(columns.map((column) => [
      column,
      safeRows.map((row) => (
        Object.prototype.hasOwnProperty.call(row || {}, column) ? row[column] : null
      )),
    ]));
  }

  function restRecordsToTableData(envelope) {
    return rowsToTableData(restRecordsToRows(envelope));
  }

  function mergeRestRecordEnvelopes(envelopes) {
    const records = [];
    const seenIds = new Set();
    (Array.isArray(envelopes) ? envelopes : []).forEach((envelope) => {
      if (!envelope || !Array.isArray(envelope.records)) {
        throw new TypeError("Réponse REST Grist invalide : records doit être un tableau.");
      }
      envelope.records.forEach((record) => {
        const id = record?.id;
        if (id != null && seenIds.has(id)) return;
        if (id != null) seenIds.add(id);
        records.push({
          ...(record || {}),
          fields: record?.fields && typeof record.fields === "object"
            ? { ...record.fields }
            : {},
        });
      });
    });
    return { records };
  }

  function normalizePersonName(value) {
    return toText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTeamDisplayName(row) {
    return toText(row?.PrenomNom) ||
      [toText(row?.Prenom), toText(row?.Nom)].filter(Boolean).join(" ") ||
      toText(row?.Name) ||
      toText(row?.Email) ||
      (Number(row?.id) > 0 ? `Ligne Team ${row.id}` : "Personne inconnue");
  }

  function getTeamFullNameAliases(row) {
    const aliases = new Set();
    const add = (value) => {
      const normalized = normalizePersonName(value);
      if (normalized) aliases.add(normalized);
    };
    add(row?.PrenomNom);
    add([toText(row?.Prenom), toText(row?.Nom)].filter(Boolean).join(" "));
    add(row?.Name);
    return aliases;
  }

  function getTeamPersonIdentity(row) {
    const nameIdentity = normalizePersonName(
      toText(row?.PrenomNom) ||
      [toText(row?.Prenom), toText(row?.Nom)].filter(Boolean).join(" ") ||
      toText(row?.Name)
    );
    if (nameIdentity) return `name:${nameIdentity}`;
    const email = toText(row?.Email).toLocaleLowerCase("en-US");
    if (email) return `email:${email}`;
    const id = Number(row?.id);
    return id > 0 ? `team:${id}` : "";
  }

  function groupTeamPeople(teamRows) {
    const groups = new Map();
    (Array.isArray(teamRows) ? teamRows : [])
      .filter((row) => Number(row?.id) > 0)
      .forEach((row) => {
        const personKey = getTeamPersonIdentity(row);
        if (!personKey) return;
        const group = groups.get(personKey) || {
          personKey,
          personName: getTeamDisplayName(row),
          teamRows: [],
          teamIds: [],
          emails: [],
          services: [],
        };
        group.teamRows.push(row);
        group.teamIds.push(Number(row.id));
        const email = toText(row?.Email).toLocaleLowerCase("en-US");
        const service = normalizeService(row?.Service);
        if (email && !group.emails.includes(email)) group.emails.push(email);
        if (service && !group.services.includes(service)) group.services.push(service);
        groups.set(personKey, group);
      });
    return [...groups.values()].sort((left, right) => left.personName.localeCompare(
      right.personName,
      "fr",
      { sensitivity: "base" }
    ));
  }

  function getEquivalentTeamRows(teamRow, teamRows) {
    const identity = getTeamPersonIdentity(teamRow);
    if (!identity) return teamRow ? [teamRow] : [];
    const matches = (Array.isArray(teamRows) ? teamRows : [])
      .filter((row) => getTeamPersonIdentity(row) === identity);
    return matches.length ? matches : (teamRow ? [teamRow] : []);
  }

  function resolveTeamPerson(personName, teamRows) {
    const normalizedName = normalizePersonName(personName);
    const rows = (Array.isArray(teamRows) ? teamRows : [])
      .filter((row) => Number(row?.id) > 0);
    if (!normalizedName) {
      return {
        status: "unmatched",
        normalizedName,
        teamRow: null,
        teamRows: [],
        candidates: [],
      };
    }

    const fullMatches = rows.filter((row) => getTeamFullNameAliases(row).has(normalizedName));
    if (fullMatches.length) {
      return {
        status: "matched",
        normalizedName,
        teamRow: fullMatches[0],
        teamRows: fullMatches,
        candidates: fullMatches,
        matchKind: fullMatches.length > 1 ? "duplicate-full-name" : "full-name",
      };
    }

    const firstNameMatches = rows.filter(
      (row) => normalizePersonName(row?.Prenom) === normalizedName
    );
    const firstNameGroups = groupTeamPeople(firstNameMatches);
    if (firstNameGroups.length === 1) {
      return {
        status: "matched",
        normalizedName,
        teamRow: firstNameGroups[0].teamRows[0],
        teamRows: firstNameGroups[0].teamRows,
        candidates: firstNameMatches,
        matchKind: "unique-first-name",
      };
    }
    return {
      status: firstNameMatches.length > 1 ? "ambiguous" : "unmatched",
      normalizedName,
      teamRow: null,
      teamRows: [],
      candidates: firstNameMatches,
      matchKind: firstNameMatches.length ? "first-name" : "",
    };
  }

  function getTeamReferenceId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (Array.isArray(value) && ["R", "r"].includes(value[0])) {
      const id = Number(value[1]);
      return Number.isInteger(id) && id > 0 ? id : null;
    }
    if (value && typeof value === "object") {
      const id = Number(value.id ?? value.rowId ?? value.recordId);
      return Number.isInteger(id) && id > 0 ? id : null;
    }
    return null;
  }

  function resolveTeamPersonValue(value, teamRows) {
    const referenceId = getTeamReferenceId(value);
    if (referenceId) {
      const matches = (Array.isArray(teamRows) ? teamRows : [])
        .filter((row) => Number(row?.id) === referenceId);
      const equivalentRows = matches.length === 1
        ? getEquivalentTeamRows(matches[0], teamRows)
        : [];
      return matches.length === 1
        ? {
            status: "matched",
            normalizedName: "",
            teamRow: matches[0],
            teamRows: equivalentRows,
            candidates: equivalentRows,
            matchKind: "team-reference",
          }
        : {
            status: "unmatched",
            normalizedName: "",
            teamRow: null,
            teamRows: [],
            candidates: [],
            matchKind: "team-reference",
          };
    }
    return resolveTeamPerson(value, teamRows);
  }

  function isTruthy(value) {
    if (value === true || value === 1) return true;
    return ["true", "1", "oui", "yes", "x"].includes(toText(value).toLocaleLowerCase("fr"));
  }

  function parseProjectAccess(rawValue) {
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

  function serializeProjectAccess(grants) {
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

  function groupProjectsByNumber(rawProjects) {
    const groups = new Map();
    tableToRows(rawProjects).forEach((row) => {
      const id = Number(row?.id);
      const number = getProjectNumber(row);
      const name = getProjectName(row);
      if (!number) return;
      const group = groups.get(number) || {
        id: id > 0 ? id : null,
        ids: [],
        number,
        name: "",
        names: [],
      };
      if (id > 0 && !group.ids.includes(id)) group.ids.push(id);
      if (name && !group.names.includes(name)) group.names.push(name);
      if (!group.name && name) group.name = name;
      groups.set(number, group);
    });
    return [...groups.values()].sort((left, right) => left.number.localeCompare(
      right.number,
      "fr",
      { numeric: true, sensitivity: "base" }
    ));
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

  function resolveProjectTeamRows(teamRows, projectTeamRows) {
    const matched = [];
    const unresolved = [];
    (Array.isArray(projectTeamRows) ? projectTeamRows : []).forEach((row) => {
      const projectNumber = normalizeProjectNumber(
        row?.NumeroProjet ?? row?.Numero_de_projet ?? row?.Numero
      );
      const personValue = row?.Name ?? row?.PrenomNom ?? row?.Personne;
      const resolution = resolveTeamPersonValue(personValue, teamRows);
      const personName = resolution.status === "matched"
        ? getTeamDisplayName(resolution.teamRow)
        : toText(personValue);
      if (!projectNumber || !personName) return;
      const entry = {
        projectNumber,
        personName,
        role: toText(row?.Role),
        projectTeamRow: row,
        projectTeamRowId: Number(row?.id) > 0 ? Number(row.id) : null,
        resolutionStatus: resolution.status,
        matchKind: resolution.matchKind || "",
      };
      if (resolution.status === "matched") {
        (resolution.teamRows || [resolution.teamRow]).forEach((matchedTeamRow) => {
          matched.push({
            ...entry,
            teamId: Number(matchedTeamRow.id),
            teamRow: matchedTeamRow,
          });
        });
      } else {
        unresolved.push({
          ...entry,
          candidates: resolution.candidates.map((candidate) => ({
            id: Number(candidate.id),
            name: getTeamDisplayName(candidate),
          })),
        });
      }
    });
    return { matched, unresolved };
  }

  function getEffectiveProjectNumbers(teamRow, {
    teamRows = [],
    projectTeamRows = [],
  } = {}) {
    const equivalentRows = getEquivalentTeamRows(teamRow, teamRows);
    const teamIds = new Set(equivalentRows.map((row) => Number(row?.id)).filter((id) => id > 0));
    const numbers = new Set();
    equivalentRows.forEach((row) => {
      parseProjectAccess(row?.[ACCESS_COLUMN]).forEach((grant) => {
        numbers.add(grant.projectNumber);
      });
    });
    if (teamIds.size) {
      resolveProjectTeamRows(teamRows, projectTeamRows).matched.forEach((assignment) => {
        if (teamIds.has(assignment.teamId)) numbers.add(assignment.projectNumber);
      });
    }
    return numbers;
  }

  function getAllowedProjects(teamRow, projects, context = {}) {
    const homeService = normalizeService(teamRow?.Service);
    if (!homeService) return [];
    if (isAdminTeamRow(teamRow)) return dedupeProjectsByNumber(projects);
    const allowedNumbers = getEffectiveProjectNumbers(teamRow, context);
    return dedupeProjectsByNumber(projects)
      .filter((project) => allowedNumbers.has(getProjectNumber(project)));
  }

  function selectAllowedProject(projects, {
    projectId,
    projectName,
    projectNumber,
  } = {}) {
    const allowedProjects = Array.isArray(projects) ? projects : [];
    const expectedId = Number(projectId);
    if (Number.isInteger(expectedId) && expectedId > 0) {
      const byId = allowedProjects.find((project) => (
        Number(project?.id) === expectedId ||
        (Array.isArray(project?.ids) && project.ids.map(Number).includes(expectedId))
      ));
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
        (project) => (
          getProjectName(project).toLocaleLowerCase("fr") === expectedName ||
          (Array.isArray(project?.names) && project.names.some(
            (name) => toText(name).toLocaleLowerCase("fr") === expectedName
          ))
        )
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

  function getAllowedServices(teamRow, projectNumber, context = {}) {
    const homeService = normalizeService(teamRow?.Service);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (!homeService || !normalizedNumber) return [];
    return (isAdminTeamRow(teamRow) || getEffectiveProjectNumbers(teamRow, context).has(normalizedNumber))
      ? [...SERVICES]
      : [];
  }

  function getAllowedServicesForProjects(teamRow, projects, context = {}) {
    const homeService = normalizeService(teamRow?.Service);
    if (!homeService || !getAllowedProjects(teamRow, projects, context).length) return [];
    return [...SERVICES];
  }

  function canEditCurrentContext(teamRow, projectNumber, selectedService, context = {}) {
    const homeService = normalizeService(teamRow?.Service);
    const service = normalizeService(selectedService);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (!homeService || !service || !normalizedNumber || service !== homeService) return false;
    return isAdminTeamRow(teamRow) || getEffectiveProjectNumbers(teamRow, context).has(normalizedNumber);
  }

  function getProjectAccessMode(teamRow, projectNumber, selectedService, context = {}) {
    const service = normalizeService(selectedService);
    const normalizedNumber = normalizeProjectNumber(projectNumber);
    if (!service || !normalizedNumber) return "hidden";
    if (!getAllowedServices(teamRow, normalizedNumber, context).includes(service)) return "hidden";
    return canEditCurrentContext(teamRow, normalizedNumber, service, context)
      ? "editable"
      : "readonly";
  }

  function getProjectScope(projects, catalogProjects = projects) {
    const safeProjects = Array.isArray(projects) ? projects : [];
    const allowedNumbers = new Set(safeProjects.map(getProjectNumber).filter(Boolean));
    const names = new Set();
    (Array.isArray(catalogProjects) ? catalogProjects : []).forEach((project) => {
      if (!allowedNumbers.has(getProjectNumber(project))) return;
      const projectNames = Array.isArray(project?.names)
        ? project.names
        : [getProjectName(project)];
      projectNames.map(toText).filter(Boolean).forEach((name) => names.add(name));
    });
    return {
      numbers: allowedNumbers,
      names,
    };
  }

  function getProjectAssignees(teamRows, projectTeamRows, projectNumber) {
    const expectedNumber = normalizeProjectNumber(projectNumber);
    const rows = (Array.isArray(teamRows) ? teamRows : []).filter((row) => Number(row?.id) > 0);
    const resolved = resolveProjectTeamRows(rows, projectTeamRows);
    const peopleByKey = new Map(groupTeamPeople(rows).map((person) => [person.personKey, person]));
    const byPersonKey = new Map();
    const ensure = (teamRow) => {
      const personKey = getTeamPersonIdentity(teamRow);
      const person = peopleByKey.get(personKey) || {
        personKey,
        personName: getTeamDisplayName(teamRow),
        teamRows: [teamRow],
        teamIds: [Number(teamRow.id)],
        emails: [toText(teamRow?.Email)].filter(Boolean),
        services: [normalizeService(teamRow?.Service)].filter(Boolean),
      };
      if (!byPersonKey.has(personKey)) {
        byPersonKey.set(personKey, {
          personKey,
          teamId: person.teamIds[0],
          teamIds: [...person.teamIds],
          teamRow: person.teamRows[0],
          teamRows: [...person.teamRows],
          emails: [...person.emails],
          personName: person.personName,
          homeService: person.services.length === 1 ? person.services[0] : "",
          homeServices: [...person.services],
          sources: new Set(),
          roles: new Set(),
          projectTeamRows: [],
          projectTeamRowIds: new Set(),
        });
      }
      return byPersonKey.get(personKey);
    };

    rows.forEach((teamRow) => {
      if (parseProjectAccess(teamRow?.[ACCESS_COLUMN])
        .some((grant) => grant.projectNumber === expectedNumber)) {
        ensure(teamRow).sources.add("manual");
      }
    });
    resolved.matched
      .filter((assignment) => assignment.projectNumber === expectedNumber)
      .forEach((assignment) => {
        const assignee = ensure(assignment.teamRow);
        assignee.sources.add("project-team");
        if (assignment.role) assignee.roles.add(assignment.role);
        const rowIdentity = assignment.projectTeamRowId || assignment.projectTeamRow;
        if (!assignee.projectTeamRowIds.has(rowIdentity)) {
          assignee.projectTeamRowIds.add(rowIdentity);
          assignee.projectTeamRows.push(assignment.projectTeamRow);
        }
      });

    const assignees = [...byPersonKey.values()].map((assignee) => {
      const { projectTeamRowIds: _projectTeamRowIds, ...publicAssignee } = assignee;
      return {
        ...publicAssignee,
        sources: [...assignee.sources].sort(),
        roles: [...assignee.roles].sort((left, right) => left.localeCompare(right, "fr")),
      };
    }).sort((left, right) => left.personName.localeCompare(right.personName, "fr", {
      sensitivity: "base",
    }));
    return {
      assignees,
      unresolved: resolved.unresolved.filter(
        (assignment) => assignment.projectNumber === expectedNumber
      ),
    };
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
    legacyDefaultService = "",
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
    const projectNames = new Set(
      (Array.isArray(project?.names) ? project.names : [getProjectName(project)])
        .map(normalizeProjectNameKey)
        .filter(Boolean)
    );
    if (!projectNumber && !projectNames.size) {
      return filterRawTable(raw, () => false);
    }
    return filterRawTable(raw, (row) => {
      const identity = getRowProjectIdentity(row, normalizedTableName);
      if (identity.kind === "number") return Boolean(projectNumber) && identity.value === projectNumber;
      if (identity.kind === "name") return projectNames.has(normalizeProjectNameKey(identity.value));
      return !PROJECT_AWARE_TABLES.has(normalizedTableName);
    });
  }

  function filterRawTableByProjectScope(raw, tableName, scope) {
    const normalizedTableName = toText(tableName);
    if (normalizedTableName === "Emetteurs" || scope === null) return raw;
    const safeScope = scope || { numbers: new Set(), names: new Set() };
    const normalizedNames = new Set(
      [...(safeScope.names || [])].map(normalizeProjectNameKey).filter(Boolean)
    );
    return filterRawTable(raw, (row) => {
      const identity = getRowProjectIdentity(row, normalizedTableName);
      if (identity.kind === "number") return safeScope.numbers.has(identity.value);
      if (identity.kind === "name") return normalizedNames.has(normalizeProjectNameKey(identity.value));
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

  function isAccessAssignmentMutationAction(action) {
    if (!isMutationAction(action)) return false;
    const tableName = toText(action?.[1]);
    if (tableName === PROJECT_TEAM_TABLE) return true;
    if (tableName !== "Team") return false;
    const fields = action?.[3] || {};
    return Object.prototype.hasOwnProperty.call(fields, ACCESS_COLUMN);
  }

  function getMutationRecordIds(action) {
    if (!Array.isArray(action)) return [];
    if (["UpdateRecord", "RemoveRecord"].includes(action[0])) {
      const id = Number(action[2]);
      return id > 0 ? [id] : [];
    }
    if (["BulkUpdateRecord", "BulkRemoveRecord"].includes(action[0])) {
      return (Array.isArray(action[2]) ? action[2] : [])
        .map(Number)
        .filter((id) => id > 0);
    }
    return [];
  }

  function rowMatchesContext(row, tableName, {
    selectedService,
    projectNumber,
    projectName,
    projectNames = [],
  } = {}) {
    const normalizedTableName = toText(tableName);
    const expectedNumber = normalizeProjectNumber(projectNumber);
    if (!row || !expectedNumber) return false;
    if (normalizedTableName === PROJECTS_TABLE) {
      return getProjectNumber(row) === expectedNumber;
    }
    if (!SERVICE_AWARE_TABLES.has(normalizedTableName)) return true;
    if (normalizeService(row?.Service) !== normalizeService(selectedService)) return false;
    if (normalizedTableName === "Emetteurs") return true;

    const identity = getRowProjectIdentity(row, normalizedTableName);
    if (identity.kind === "number") return identity.value === expectedNumber;
    if (identity.kind === "name") {
      const allowedNames = new Set([projectName, ...projectNames].map(toText).filter(Boolean));
      return allowedNames.has(identity.value);
    }
    return !PROJECT_AWARE_TABLES.has(normalizedTableName);
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
    if (tableName === PROJECTS_TABLE) {
      if (projectNumber) {
        ["Numero_de_projet", "NumeroProjet", "Numero"].forEach((column) => {
          if (Object.prototype.hasOwnProperty.call(fields, column)) {
            assertContextValue(fields[column], projectNumber, normalizeProjectNumber, column);
          }
        });
        fields.Numero_de_projet = projectNumber;
      }
      return fields;
    }
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
    const transformColumn = (column, expected, normalize, label) => {
      if (!expected) return;
      const currentValues = Array.isArray(fields[column]) ? fields[column] : [];
      currentValues.forEach((value) => assertContextValue(value, expected, normalize, label));
      fields[column] = Array.from({ length: rowCount }, () => expected);
    };
    if (tableName === PROJECTS_TABLE) {
      ["Numero_de_projet", "NumeroProjet", "Numero"].forEach((column) => {
        if (Object.prototype.hasOwnProperty.call(fields, column)) {
          const currentValues = Array.isArray(fields[column]) ? fields[column] : [];
          currentValues.forEach((value) => assertContextValue(
            value,
            projectNumber,
            normalizeProjectNumber,
            column
          ));
        }
      });
      transformColumn(
        "Numero_de_projet",
        projectNumber,
        normalizeProjectNumber,
        "Numero_de_projet"
      );
      return fields;
    }
    if (!SERVICE_AWARE_TABLES.has(tableName)) return fields;

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
      if (tableName !== PROJECTS_TABLE && !SERVICE_AWARE_TABLES.has(tableName)) return action;
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
    ACCESS_CHANGED_STORAGE_KEY,
    ACCESS_SIGNAL_VERSION,
    ACCESS_COLUMN,
    PROJECT_TEAM_TABLE,
    LEGACY_DEFAULT_SERVICE,
    PROJECTS_TABLE,
    PROJECT_NAME_COLUMNS,
    SERVICE_AWARE_TABLES,
    PROJECT_NUMBER_TABLES,
    PROJECT_AWARE_TABLES,
    REST_SERVICE_VALUES,
    toText,
    normalizeProjectNumber,
    normalizeProjectNameKey,
    normalizeService,
    uniqueExactValues,
    getServiceFilterValues,
    getProjectFilterValues,
    buildContextTableFilter,
    splitContextTableFilter,
    restRecordsToRows,
    rowsToTableData,
    restRecordsToTableData,
    mergeRestRecordEnvelopes,
    normalizePersonName,
    getTeamDisplayName,
    getTeamFullNameAliases,
    getTeamPersonIdentity,
    groupTeamPeople,
    getEquivalentTeamRows,
    resolveTeamPerson,
    getTeamReferenceId,
    resolveTeamPersonValue,
    isTruthy,
    parseProjectAccess,
    serializeProjectAccess,
    getProjectNumber,
    getProjectName,
    groupProjectsByNumber,
    resolveProjectTeamRows,
    getEffectiveProjectNumbers,
    getAllowedProjects,
    selectAllowedProject,
    isAdminTeamRow,
    findCurrentTeamRow,
    getAllowedServices,
    getAllowedServicesForProjects,
    canEditCurrentContext,
    getProjectAccessMode,
    getProjectScope,
    getProjectAssignees,
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
    isAccessAssignmentMutationAction,
    getMutationRecordIds,
    rowMatchesContext,
    transformActions,
  });
});
