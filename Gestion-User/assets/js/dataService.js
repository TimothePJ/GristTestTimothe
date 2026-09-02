import { ABSENCE_TYPES, COLUMN_CANDIDATES, TABLES } from "./config.js";
import { buildAbsenceIndex, normalizeName } from "./leaveAbsences.js";
import { resolveSegmentMonthKey } from "./monthSegments.js";
import {
  compareText,
  findColumn,
  normalizePersonName,
  parseFrenchNumber,
  tableToRows,
  toText,
} from "./utils.js";

function getCell(row, columnName) {
  return columnName ? row?.[columnName] : "";
}

function normalizeContextService(value) {
  return window.GristServiceContextCore?.normalizeService?.(value) || toText(value);
}

function resolveColumns(tableData, columnConfig) {
  return Object.fromEntries(
    Object.entries(columnConfig).map(([key, candidates]) => [key, findColumn(tableData, candidates)])
  );
}

export function buildEmployees(teamTable, teamRows) {
  const columns = resolveColumns(teamTable, COLUMN_CANDIDATES.team);
  const employees = new Map();

  teamRows.forEach((row) => {
    const fullName =
      toText(getCell(row, columns.fullName)) ||
      [getCell(row, columns.firstName), getCell(row, columns.lastName)]
        .map(toText)
        .filter(Boolean)
        .join(" ");
    const key = normalizePersonName(fullName);
    if (!key || employees.has(key)) return;

    employees.set(key, {
      key,
      // Seconde cle, conservant la ponctuation : c'est celle sous laquelle
      // buildAbsenceIndex range les conges. `Team` fait autorite — l'index est
      // bati sur ces memes lignes — donc c'est ICI que la cle d'absence nait,
      // et les segments en heritent (cf. buildSegments). Passer par
      // normalizePersonName ici casserait tous les prenoms composes.
      absenceKey: normalizeName(fullName),
      name: fullName,
      firstName: toText(getCell(row, columns.firstName)),
      lastName: toText(getCell(row, columns.lastName)),
      email: toText(getCell(row, columns.email)),
      service: toText(getCell(row, columns.service)),
      role: toText(getCell(row, columns.role)),
      external: getCell(row, columns.external),
      idTrefle: toText(getCell(row, columns.idTrefle)),
    });
  });

  return Array.from(employees.values()).sort((left, right) =>
    compareText(left.name, right.name)
  );
}

function buildProjects(projectTable, projectRows) {
  const columns = resolveColumns(projectTable, COLUMN_CANDIDATES.projects);
  const projects = new Map();

  projectRows.forEach((row) => {
    const number = toText(getCell(row, columns.number));
    if (!number) return;
    projects.set(number, {
      number,
      name: toText(getCell(row, columns.name)),
      dop: toText(getCell(row, columns.dop)),
    });
  });

  return projects;
}

// `employeesByKey` : Map<employeeKey, employe> issue de buildEmployees. Quand
// elle est fournie, chaque segment HERITE de l'absenceKey de sa fiche employe.
// C'est indispensable : la jointure segment->employe passe par
// normalizePersonName, insensible a la ponctuation, alors que l'index
// d'absences est cle sur normalizeName, qui y est sensible. Recalculer
// l'absenceKey sur le texte libre de TimeSegment.Name laisserait passer un
// segment orthographie « Jean Pierre DUPONT » face a un Team « Jean-Pierre
// DUPONT » — segment conserve, conges silencieusement perdus.
// Sans Map (appel unitaire), on retombe sur le nom du segment.
export function buildSegments(timeSegmentTable, segmentRows, employeesByKey = null) {
  const columns = resolveColumns(timeSegmentTable, COLUMN_CANDIDATES.timeSegment);

  return segmentRows
    .map((row) => {
      const employeeName = toText(getCell(row, columns.employeeName));
      if (!employeeName) return null;

      // `Mois` fait foi, repli legacy sur Start_At (cf. spec section 3).
      const monthKey = resolveSegmentMonthKey(
        { mois: getCell(row, columns.mois), startDate: getCell(row, columns.startAt) },
        { mois: "mois", startDate: "startDate" }
      );
      if (!monthKey) return null;

      // `Effectif` est desormais LA charge (et non plus Allocation_Days) :
      // c'est ce que gestion-depenses2 comptait deja de son cote.
      const effectif = parseFrenchNumber(getCell(row, columns.effectif));
      if (!(effectif > 0)) return null;

      const employeeKey = normalizePersonName(employeeName);

      return {
        employeeName,
        employeeKey,
        // Heritee de Team quand l'annuaire est connu ; vide si l'employe n'y est
        // pas apparie — mieux vaut aucune absence qu'une cle devinee.
        absenceKey: employeesByKey
          ? employeesByKey.get(employeeKey)?.absenceKey || ""
          : normalizeName(employeeName),
        monthKey,
        effectif,
        projectNumber: toText(getCell(row, columns.projectNumber)) || "Sans projet",
      };
    })
    .filter(Boolean);
}

function addSegmentOnlyEmployees(employees, segments) {
  const byKey = new Map(employees.map((employee) => [employee.key, employee]));

  segments.forEach((segment) => {
    const name = segment.employeeName;
    const key = segment.employeeKey;
    if (!key || byKey.has(key)) return;

    byKey.set(key, {
      key,
      absenceKey: segment.absenceKey,
      name,
      firstName: "",
      lastName: "",
      email: "",
      service: "",
      role: "",
      external: "",
      idTrefle: "",
      fromSegmentsOnly: true,
    });
  });

  return Array.from(byKey.values()).sort((left, right) =>
    compareText(left.service, right.service) ||
    compareText(left.role, right.role) ||
    compareText(left.name, right.name)
  );
}

export function buildSegmentsByEmployee(segments) {
  const grouped = new Map();

  segments.forEach((segment) => {
    const list = grouped.get(segment.employeeKey) || [];
    list.push(segment);
    grouped.set(segment.employeeKey, list);
  });

  // Les segments n'ont plus de bornes de dates : on ordonne par mois, puis par
  // projet pour rendre le tri stable d'un chargement a l'autre.
  grouped.forEach((list) => {
    list.sort((left, right) =>
      compareText(left.monthKey, right.monthKey) ||
      compareText(left.projectNumber, right.projectNumber)
    );
  });

  return grouped;
}

// Grist mappe `Time-Out` (avec tiret) sur un id de table `Time_Out` selon les
// documents ; certains utilisent `TimeOut`. On essaie les trois et on garde le
// premier qui repond — meme approche que planning-synchro/services/gristService.js.
export async function fetchTimeOutRows() {
  for (const tableId of [TABLES.timeOut, "Time_Out", "TimeOut"]) {
    try {
      const table = await grist.docApi.fetchTable(tableId);
      return { table, rows: tableToRows(table) };
    } catch (_error) {
      // table absente sous cet id : on tente le suivant
    }
  }
  return { table: {}, rows: [] };
}

// Index des absences, cle par leaveAbsences.normalizeName (qui conserve la
// ponctuation) — d'ou l'absenceKey portee separement par employes et segments.
//
// buildAbsenceIndex attend un objet colonnes exposant `prenomNom`, `prenom`,
// `nom` et `email` ; COLUMN_CANDIDATES.team les nomme `fullName`, `firstName`,
// `lastName`, `email`. L'adaptateur ci-dessous est donc obligatoire : sans lui
// aucun nom ne serait reconstruit et TOUTES les absences seraient ignorees,
// sans la moindre erreur.
export function buildAbsencesByEmployee(timeOutTable, timeOutRows, teamTable, teamRows) {
  const teamCols = resolveColumns(teamTable, COLUMN_CANDIDATES.team);
  const absenceTeamCols = {
    email: teamCols.email,
    prenomNom: teamCols.fullName,
    prenom: teamCols.firstName,
    nom: teamCols.lastName,
  };

  return buildAbsenceIndex(
    timeOutRows,
    teamRows,
    resolveColumns(timeOutTable, COLUMN_CANDIDATES.timeOut),
    absenceTeamCols,
    ABSENCE_TYPES
  );
}

export async function loadGestionUserData() {
  if (!window.grist?.docApi) {
    throw new Error("API Grist indisponible.");
  }

  const [timeSegmentTable, teamTable, projectTable] = await Promise.all([
    grist.docApi.fetchTable(TABLES.timeSegment),
    grist.docApi.fetchTable(TABLES.team),
    grist.docApi.fetchTable(TABLES.projects),
  ]);

  const { table: timeOutTable, rows: timeOutRows } = await fetchTimeOutRows();

  const teamRows = tableToRows(teamTable);
  const projectRows = tableToRows(projectTable);
  const segmentRows = tableToRows(timeSegmentTable);

  const absencesByEmployee = buildAbsencesByEmployee(
    timeOutTable,
    timeOutRows,
    teamTable,
    teamRows
  );

  const selectedService = normalizeContextService(
    window.GristServiceContext?.getService?.()
      || window.localStorage?.getItem("grist.selected-service")
  );
  const employees = buildEmployees(teamTable, teamRows).filter(
    (employee) => selectedService && normalizeContextService(employee.service) === selectedService
  );
  // L'annuaire sert deux fois : a filtrer les segments, et a leur transmettre
  // l'absenceKey issue de Team (cf. buildSegments).
  const employeesByKey = new Map(employees.map((employee) => [employee.key, employee]));
  const segments = buildSegments(timeSegmentTable, segmentRows, employeesByKey).filter(
    (segment) => employeesByKey.has(segment.employeeKey)
  );

  return {
    employees,
    projects: buildProjects(projectTable, projectRows),
    segments,
    segmentsByEmployee: buildSegmentsByEmployee(segments),
    absencesByEmployee,
  };
}
