export const GRIST_LIST_CODE = "L";
export const GRIST_CENSORED_CODE = "C";

export function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();

  if (Array.isArray(value)) {
    if (value[0] === GRIST_CENSORED_CODE) return "";
    if (value[0] === GRIST_LIST_CODE) return value.slice(1).map(asText).filter(Boolean).join(", ");
    return value.map(asText).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    for (const key of ["label", "name", "display", "value", "details"]) {
      const text = asText(value[key]);
      if (text) return text;
    }
  }

  return String(value).trim();
}

export function isCensoredCell(value) {
  if (Array.isArray(value) && value[0] === GRIST_CENSORED_CODE) return true;
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "C" || normalized === "CENSORED";
}

export function toBooleanFlag(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLocaleLowerCase("fr");
  return ["1", "true", "vrai", "oui", "yes"].includes(normalized);
}

export function normalizeFetchTableResult(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;

  if (typeof raw !== "object") return [];

  const keys = Object.keys(raw);
  const rowCount = Math.max(
    0,
    ...keys.map((key) => (Array.isArray(raw[key]) ? raw[key].length : 0)),
  );

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = {};
    keys.forEach((key) => {
      row[key] = Array.isArray(raw[key]) ? raw[key][rowIndex] : undefined;
    });
    return row;
  });
}

export function extractColumnNames(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.records) && raw.records.length) {
    return Object.keys(raw.records[0] || {});
  }
  if (Array.isArray(raw) && raw.length) return Object.keys(raw[0] || {});
  if (typeof raw === "object" && !Array.isArray(raw)) return Object.keys(raw);
  return [];
}

export function decodeGristList(value) {
  if (isCensoredCell(value)) return [];

  let values = [];

  if (Array.isArray(value)) {
    values = value[0] === GRIST_LIST_CODE ? value.slice(1) : value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[")) {
      try {
        return decodeGristList(JSON.parse(trimmed));
      } catch (_error) {
        // Continue with the tolerant text parser below.
      }
    }

    values = trimmed.split(/[;\n]+/);
  } else if (value != null) {
    values = [value];
  }

  const uniqueValues = new Map();
  values.forEach((item) => {
    const text = asText(item);
    if (!text) return;
    const identity = text.toLocaleLowerCase("fr");
    if (!uniqueValues.has(identity)) uniqueValues.set(identity, text);
  });

  return [...uniqueValues.values()];
}

export function encodeGristList(values) {
  const sortedValues = decodeGristList(values).sort((left, right) =>
    left.localeCompare(right, "fr", { numeric: true, sensitivity: "base" }),
  );
  return [GRIST_LIST_CODE, ...sortedValues];
}

export function buildGrantKey(projectId, service) {
  const numericProjectId = Number(projectId);
  const targetService = asText(service);
  if (!Number.isInteger(numericProjectId) || numericProjectId <= 0 || !targetService || targetService.includes("|")) {
    return "";
  }
  return `P${numericProjectId}|${targetService}`;
}

export function parseGrantKey(value) {
  const key = asText(value);
  const separatorIndex = key.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return { key, projectId: null, service: "", valid: false };
  }

  const projectPart = key.slice(0, separatorIndex).trim();
  const projectId = /^P[1-9]\d*$/.test(projectPart)
    ? Number(projectPart.slice(1))
    : null;
  const service = key.slice(separatorIndex + 1).trim();
  return {
    key,
    projectId,
    service,
    valid: Boolean(projectId && service),
  };
}

export function addGrant(values, grantKey) {
  const key = asText(grantKey);
  return decodeGristList([...decodeGristList(values), key]);
}

export function removeGrant(values, grantKey) {
  const key = asText(grantKey).toLocaleLowerCase("fr");
  return decodeGristList(values).filter(
    (value) => value.toLocaleLowerCase("fr") !== key,
  );
}

export function formatPersonName(teamRow, columns = {}) {
  const firstName = asText(teamRow?.[columns.firstName || "Prenom"]);
  const lastName = asText(teamRow?.[columns.lastName || "Nom"]);
  const fullName = asText(teamRow?.[columns.fullName || "PrenomNom"]);
  return [firstName, lastName].filter(Boolean).join(" ") || fullName || asText(teamRow?.Email) || "Utilisateur";
}

export function flattenAssignments(teamRows, projectRows, columns = {}) {
  const team = {
    id: columns.teamId || "id",
    email: columns.teamEmail || "Email",
    service: columns.teamService || "Service",
    grants: columns.teamGrants || "Acces_Lecture_Projets",
  };
  const project = {
    id: columns.projectId || "id",
    number: columns.projectNumber || "Numero_de_projet",
    name: columns.projectName || "Nom_de_projet",
  };

  const projectsById = new Map();
  (projectRows || []).forEach((row) => {
    const id = Number(row?.[project.id]);
    if (Number.isInteger(id) && id > 0 && !projectsById.has(id)) projectsById.set(id, row);
  });

  const assignments = [];
  (teamRows || []).forEach((teamRow) => {
    const teamId = Number(teamRow?.[team.id]);
    decodeGristList(teamRow?.[team.grants]).forEach((grantKey) => {
      const parsed = parseGrantKey(grantKey);
      const projectRow = projectsById.get(parsed.projectId);
      assignments.push({
        id: `${teamId}:${grantKey}`,
        teamId,
        grantKey,
        email: asText(teamRow?.[team.email]),
        personName: formatPersonName(teamRow),
        personService: asText(teamRow?.[team.service]),
        projectId: parsed.projectId,
        projectNumber: asText(projectRow?.[project.number]),
        projectName: asText(projectRow?.[project.name]),
        grantedService: parsed.service,
        obsolete: !parsed.valid || !projectRow,
      });
    });
  });

  return assignments.sort((left, right) =>
    left.personName.localeCompare(right.personName, "fr", { sensitivity: "base" })
    || Number(left.obsolete) - Number(right.obsolete)
    || left.projectNumber.localeCompare(right.projectNumber, "fr", { numeric: true })
    || left.grantedService.localeCompare(right.grantedService, "fr", { sensitivity: "base" }),
  );
}
