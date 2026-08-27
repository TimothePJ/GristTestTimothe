import { APP_CONFIG } from "../config.js";
import {
  getMonthKeyFromRawMonth,
  toReferenceId,
  toFiniteNumber,
  toText,
  // Alias conserve pour Timesheet uniquement (upsertTimesheetBatch) : cette
  // table est hors perimetre de la bascule TimeSegment au mois, et son
  // contrat d'erreur historique (throw sur mois invalide) ne doit pas
  // changer. Ne pas utiliser ce nom ailleurs dans ce fichier : partout pour
  // TimeSegment, c'est la version de monthSegments.js (renvoie null) qui
  // fait foi.
  toGristMonthValue as toGristMonthValueLegacy,
} from "../utils/format.js";
import { toGristMonthValue, getMonthBusinessDays } from "../utils/monthSegments.js";

const resolvedColumnCache = new Map();

const TIME_SEGMENT_COLUMN_ALIASES = {
  id: ["id"],
  projectNumber: ["NumeroProjet", "Numero_Projet", "Project_Number", "ProjectNumber"],
  name: ["Name", "Nom", "Worker_Name", "Team_Member_Name"],
  segmentType: ["Segment_Type", "SegmentType", "Type"],
  mois: ["Mois", "Month"],
  startDate: ["Start_Date", "Start_At", "StartDate", "Start"],
  endDate: ["End_Date", "End_At", "EndDate", "End"],
  allocationDays: [
    "Allocation_Days",
    "AllocationDays",
    "Allocation",
    "Days",
  ],
  effectif: ["Effectif"],
  label: ["Label", "Title"],
  service: ["Service"],
};

const TIME_REAL_COLUMN_ALIASES = {
  id: ["id"],
  projectNumber: ["NumeroProjet", "Numero_Projet", "Project_Number", "ProjectNumber"],
  name: ["Name", "Nom", "Worker_Name", "Team_Member_Name"],
  collaboratorId: ["ID_Collaborateur", "Collaborateur", "Collaborator_Id", "CollaboratorId"],
  startDate: ["Start_At", "Start_Date", "StartAt", "Start"],
  endDate: ["End_At", "End_Date", "EndAt", "End"],
  allocationDays: [
    "Allocation_Days",
    "AllocationDays",
    "Allocation",
    "Days",
  ],
  month: ["Mois", "Month"],
  service: ["Service"],
};

function getActiveService() {
  if (typeof globalThis === "undefined") return "Structure";
  return globalThis.GristServiceContext?.getService?.()
    || globalThis.GristServiceContextCore?.normalizeService?.(
      globalThis.localStorage?.getItem("grist.selected-service")
    )
    || "Structure";
}

function getGrist() {
  if (window.grist) {
    return window.grist;
  }
  try {
    if (window.parent && window.parent !== window && window.parent.grist) {
      return window.parent.grist;
    }
  } catch (_error) {
    // Ignore cross-context access issues and fallback to local window.
  }

  throw new Error("API Grist introuvable (window.grist).");
}

function normalizeFetchTableResult(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;

  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];

    const maxLen = Math.max(
      ...keys.map((key) => (Array.isArray(raw[key]) ? raw[key].length : 0))
    );

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

function normalizeColumnName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveColumnId(availableColumns, requestedColumnId, aliases = []) {
  const allCandidates = [requestedColumnId, ...aliases].filter(Boolean);
  const directMatch = allCandidates.find((candidate) =>
    availableColumns.includes(candidate)
  );
  if (directMatch) {
    return directMatch;
  }

  const normalizedAvailable = new Map(
    availableColumns.map((columnId) => [normalizeColumnName(columnId), columnId])
  );

  for (const candidate of allCandidates) {
    const normalizedCandidate = normalizeColumnName(candidate);
    if (normalizedAvailable.has(normalizedCandidate)) {
      return normalizedAvailable.get(normalizedCandidate);
    }
  }

  return requestedColumnId;
}

function getAvailableColumnIds(raw) {
  if (Array.isArray(raw)) {
    const availableColumns = new Set();
    raw.forEach((row) => {
      if (!row || typeof row !== "object") return;
      Object.keys(row).forEach((columnId) => availableColumns.add(columnId));
    });
    return [...availableColumns];
  }

  if (raw && typeof raw === "object") {
    return Object.keys(raw);
  }

  return [];
}

async function fetchTableRaw(tableName, options = undefined) {
  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.fetchTable !== "function") {
    throw new Error("grist.docApi.fetchTable(...) indisponible.");
  }

  // Les options sont celles du wrapper de contexte local, pas de l'API RPC
  // Grist native (qui n'accepte que le nom de table).
  return options && grist.docApi.__serviceContextPatched
    ? grist.docApi.fetchTable(tableName, options)
    : grist.docApi.fetchTable(tableName);
}

async function fetchTableRows(tableName) {
  const raw = await fetchTableRaw(tableName);
  return normalizeFetchTableResult(raw);
}

async function fetchOptionalTableRows(tableName) {
  if (!tableName) {
    return [];
  }

  try {
    return await fetchTableRows(tableName);
  } catch (error) {
    console.warn(`Lecture optionnelle impossible pour la table ${tableName} :`, error);
    return [];
  }
}

async function getResolvedColumns(
  tableName,
  configuredColumns,
  aliasesByKey = {},
  { forceRefresh = false } = {}
) {
  const cacheKey = tableName;
  if (!forceRefresh && resolvedColumnCache.has(cacheKey)) {
    return resolvedColumnCache.get(cacheKey);
  }

  const raw = await fetchTableRaw(
    cacheKey,
    forceRefresh ? { forceRefresh: true } : undefined
  );
  const availableColumns = getAvailableColumnIds(raw);

  const resolved = Object.fromEntries(
    Object.entries(configuredColumns).map(([key, requestedColumnId]) => [
      key,
      resolveColumnId(
        availableColumns,
        requestedColumnId,
        aliasesByKey[key] || []
      ),
    ])
  );

  resolvedColumnCache.set(cacheKey, resolved);
  return resolved;
}

async function getResolvedTimeSegmentColumns(options = undefined) {
  return getResolvedColumns(
    APP_CONFIG.grist.tables.timeSegment,
    APP_CONFIG.grist.columns.timeSegment,
    TIME_SEGMENT_COLUMN_ALIASES,
    options
  );
}

async function getResolvedTimeRealColumns() {
  return getResolvedColumns(
    APP_CONFIG.grist.tables.timeReal,
    APP_CONFIG.grist.columns.timeReal,
    TIME_REAL_COLUMN_ALIASES
  );
}

function setTimeSegmentLabelField(fields, columns, label) {
  if (
    !columns.label ||
    columns.label === columns.name ||
    columns.label === columns.projectNumber ||
    Object.prototype.hasOwnProperty.call(fields, columns.label)
  ) {
    return;
  }

  fields[columns.label] = label;
}

async function fetchNormalizedTimeSegmentRows() {
  const tableName = APP_CONFIG.grist.tables.timeSegment;
  const raw = await fetchTableRaw(tableName);
  const rows = normalizeFetchTableResult(raw);
  const resolvedColumns = await getResolvedTimeSegmentColumns();
  const canonicalColumns = APP_CONFIG.grist.columns.timeSegment;

  return rows.map((row) => ({
    [canonicalColumns.id]: row?.[resolvedColumns.id],
    [canonicalColumns.projectNumber]: row?.[resolvedColumns.projectNumber],
    [canonicalColumns.name]: row?.[resolvedColumns.name],
    [canonicalColumns.segmentType]: row?.[resolvedColumns.segmentType],
    [canonicalColumns.mois]: row?.[resolvedColumns.mois],
    [canonicalColumns.startDate]: row?.[resolvedColumns.startDate],
    [canonicalColumns.endDate]: row?.[resolvedColumns.endDate],
    [canonicalColumns.allocationDays]: row?.[resolvedColumns.allocationDays],
    [canonicalColumns.effectif]: row?.[resolvedColumns.effectif],
    [canonicalColumns.label]: row?.[resolvedColumns.label],
    [canonicalColumns.service]: row?.[resolvedColumns.service],
  }));
}

async function fetchNormalizedTimeRealRows() {
  const tableName = APP_CONFIG.grist.tables.timeReal;
  const raw = await fetchTableRaw(tableName);
  const rows = normalizeFetchTableResult(raw);
  const resolvedColumns = await getResolvedTimeRealColumns();
  const canonicalColumns = APP_CONFIG.grist.columns.timeReal;

  return rows.map((row) => ({
    [canonicalColumns.id]: row?.[resolvedColumns.id],
    [canonicalColumns.projectNumber]: row?.[resolvedColumns.projectNumber],
    [canonicalColumns.name]: row?.[resolvedColumns.name],
    [canonicalColumns.collaboratorId]: row?.[resolvedColumns.collaboratorId],
    [canonicalColumns.startDate]: row?.[resolvedColumns.startDate],
    [canonicalColumns.endDate]: row?.[resolvedColumns.endDate],
    [canonicalColumns.allocationDays]: row?.[resolvedColumns.allocationDays],
    [canonicalColumns.month]: row?.[resolvedColumns.month],
    [canonicalColumns.service]: row?.[resolvedColumns.service],
  }));
}

export function initGrist() {
  const grist = getGrist();
  if (typeof grist.ready === "function") {
    grist.ready({ requiredAccess: "full" });
  }
}

// Charge uniquement la table Projets — légère, pour peupler le sélecteur au démarrage.
export async function fetchProjectsForDropdown() {
  return fetchTableRows(APP_CONFIG.grist.tables.projects);
}

export async function fetchDopRegistryRows() {
  return fetchOptionalTableRows("Emetteurs");
}

// Grist mappe les noms de table avec tiret (Time-Out) vers un id à underscore (Time_Out).
// On essaie les variantes connues et on retourne le premier id lisible.
// L'identifiant reel de la table des absences varie selon les documents. La
// resolution coutait jusqu'a trois lectures de table A CHAQUE chargement ; elle est
// desormais faite une fois. Elle est aussi exportee, car la surveillance doit
// s'enregistrer sous l'identifiant EXACT : le reveil compare les noms au caractere
// pres, et un watcher pose sur "Time-Out" resterait sourd a un document en "Time_Out".
let _timeOutTableIdPromise = null;

export function resolveTimeOutTableId() {
  if (_timeOutTableIdPromise) return _timeOutTableIdPromise;
  _timeOutTableIdPromise = (async () => {
    for (const id of ["Time-Out", "Time_Out", "TimeOut"]) {
      try {
        await fetchTableRows(id);
        return id;
      } catch (_error) {
        // Variante suivante.
      }
    }
    return "Time-Out";
  })();
  return _timeOutTableIdPromise;
}

// Charge les 8 tables de données (hors Projets), uniquement quand un projet est sélectionné.
export async function fetchProjectDataTables() {
  const tables = APP_CONFIG.grist.tables;
  const timeOutTableId = await resolveTimeOutTableId();
  const [
    budgetRows,
    listePlanRows,
    planningProjectRows,
    projectTeamRows,
    timeSegmentRows,
    timeRealRows,
    teamRows,
    timeOutRows,
  ] = await Promise.all([
    fetchTableRows(tables.budget),
    fetchOptionalTableRows(tables.listePlan),
    fetchOptionalTableRows(tables.planningProject),
    fetchTableRows(tables.projectTeam),
    fetchNormalizedTimeSegmentRows(),
    fetchNormalizedTimeRealRows(),
    fetchTableRows(tables.team),
    fetchOptionalTableRows(timeOutTableId),
  ]);

  return {
    budgetRows,
    listePlanRows,
    planningProjectRows,
    projectTeamRows,
    timesheetRows: [],
    timeSegmentRows,
    timeRealRows,
    teamRows,
    timeOutRows,
  };
}

// Conservé pour rétrocompatibilité interne.
export async function fetchExpenseAppTables() {
  const projectRows = await fetchProjectsForDropdown();
  const dataTables = await fetchProjectDataTables();
  return { projectRows, ...dataTables };
}

export async function applyActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return;

  const grist = getGrist();
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions(...) indisponible.");
  }

  return grist.docApi.applyUserActions(actions);
}

export async function createProjectWithBudget({ name, projectNumber, dop = "", budgetLines }) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns;

  const actions = [
    [
      "AddRecord",
      tables.projects,
      null,
      {
        [columns.projects.name]: name,
        [columns.projects.projectNumber]: projectNumber,
        [columns.projects.dop]: dop,
      },
    ],
    ...(budgetLines || []).map((line) => [
      "AddRecord",
      tables.budget,
      null,
      {
        [columns.budget.projectNumber]: projectNumber,
        [columns.budget.chapter]: line.chapter,
        [columns.budget.amount]: line.amount,
        [columns.budget.service]: getActiveService(),
      },
    ]),
  ];

  // Projet, budget et signal temps reel partent dans une seule transaction :
  // aucune autre fenetre ne peut observer un projet encore prive de son budget,
  // et une seule ecriture serveur suffit.
  await applyActions(actions);
}

export async function saveBudgetChanges(project, editedLines) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns;

  const originalLines = Array.isArray(project?.budgetLines) ? project.budgetLines : [];
  const nextLines = Array.isArray(editedLines) ? editedLines : [];

  const actions = [];

  // The budget table has no explicit sort column, so we fully rewrite the rows
  // to preserve the exact visual order chosen in the modal.
  originalLines.forEach((line) => {
    actions.push(["RemoveRecord", tables.budget, line.id]);
  });

  nextLines.forEach((line) => {
    actions.push([
      "AddRecord",
      tables.budget,
      null,
      {
        [columns.budget.projectNumber]: project.projectNumber,
        [columns.budget.chapter]: line.chapter,
        [columns.budget.amount]: line.amount,
        [columns.budget.service]: getActiveService(),
      },
    ]);
  });

  await applyActions(actions);
}

export async function addWorkerToProject(project, teamMember) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns;

  await applyActions([
    [
      "AddRecord",
      tables.projectTeam,
      null,
      {
        [columns.projectTeam.projectNumber]: project.projectNumber,
        [columns.projectTeam.role]: teamMember.role,
        [columns.projectTeam.name]: `${teamMember.firstName} ${teamMember.lastName}`.trim(),
        [columns.projectTeam.dailyRate]: 0,
        [columns.projectTeam.service]: getActiveService(),
      },
    ],
  ]);
}

function normalizeSegmentPersonKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesWorkerIdentity(row, columns, workerProjectNumber, workerName) {
  return (
    toText(row?.[columns.projectNumber]) === workerProjectNumber &&
    normalizeSegmentPersonKey(row?.[columns.name]) === workerName
  );
}

export async function removeProjectWorker(workerId) {
  const normalizedWorkerId = toReferenceId(workerId);
  if (!normalizedWorkerId) return;

  const projectTeamRows = await fetchTableRows(APP_CONFIG.grist.tables.projectTeam);
  const projectTeamColumns = APP_CONFIG.grist.columns.projectTeam;
  const workerRow = (projectTeamRows || []).find((row) => {
    return toReferenceId(row?.[projectTeamColumns.id]) === normalizedWorkerId;
  });
  if (!workerRow) return;

  const workerProjectNumber = toText(workerRow?.[projectTeamColumns.projectNumber]);
  const workerName = normalizeSegmentPersonKey(workerRow?.[projectTeamColumns.name]);

  const timeSegmentRows = await fetchNormalizedTimeSegmentRows();
  const timeRealRows = await fetchNormalizedTimeRealRows();
  const timeSegmentColumns = APP_CONFIG.grist.columns.timeSegment;
  const timeRealColumns = APP_CONFIG.grist.columns.timeReal;
  const segmentRemovals = (timeSegmentRows || [])
    .filter((row) =>
      matchesWorkerIdentity(row, timeSegmentColumns, workerProjectNumber, workerName)
    )
    .map((row) => [
      "RemoveRecord",
      APP_CONFIG.grist.tables.timeSegment,
      row?.[timeSegmentColumns.id],
    ]);
  const realRemovals = (timeRealRows || [])
    .filter((row) =>
      matchesWorkerIdentity(row, timeRealColumns, workerProjectNumber, workerName)
    )
    .map((row) => [
      "RemoveRecord",
      APP_CONFIG.grist.tables.timeReal,
      row?.[timeRealColumns.id],
    ]);

  await applyActions([
    ...segmentRemovals,
    ...realRemovals,
    ["RemoveRecord", APP_CONFIG.grist.tables.projectTeam, normalizedWorkerId],
  ]);
}

export async function updateWorkerDailyRate(workerId, dailyRate) {
  await applyActions([
    [
      "UpdateRecord",
      APP_CONFIG.grist.tables.projectTeam,
      workerId,
      {
        [APP_CONFIG.grist.columns.projectTeam.dailyRate]: dailyRate,
      },
    ],
  ]);
}

function findTimesheetRecord(timesheetRows, workerId, monthKey) {
  const columns = APP_CONFIG.grist.columns.timesheet;

  return (
    timesheetRows.find((row) => {
      const rowWorkerId = Number(row?.[columns.workerId]);
      const rowMonthKey = getMonthKeyFromRawMonth(row?.[columns.month]);
      return rowWorkerId === workerId && rowMonthKey === monthKey;
    }) || null
  );
}

function buildTimesheetFields(update) {
  const columns = APP_CONFIG.grist.columns.timesheet;
  const fields = {};

  if (Object.prototype.hasOwnProperty.call(update, "provisionalDays")) {
    fields[columns.provisionalDays] = update.provisionalDays;
  }
  if (Object.prototype.hasOwnProperty.call(update, "workedDays")) {
    fields[columns.workedDays] = update.workedDays;
  }

  return fields;
}

export async function upsertTimesheetValue({ workerId, monthKey, fieldName, value }) {
  const normalizedField =
    fieldName === "workedDays" ? "workedDays" : "provisionalDays";

  return upsertTimesheetBatch({
    workerId,
    updates: [
      {
        monthKey,
        [normalizedField]: value,
      },
    ],
  });
}

export async function upsertTimesheetBatch({ workerId, updates }) {
  const tables = APP_CONFIG.grist.tables;
  const columns = APP_CONFIG.grist.columns.timesheet;
  const timesheetRows = await fetchTableRows(tables.timesheet);
  const actions = [];

  for (const update of updates || []) {
    const monthKey = toText(update?.monthKey);
    if (!monthKey) continue;

    const existingRow = findTimesheetRecord(timesheetRows, workerId, monthKey);
    const fields = buildTimesheetFields(update);
    if (!Object.keys(fields).length) continue;
    const hasNonZeroValue = Object.values(fields).some(
      (fieldValue) => toFiniteNumber(fieldValue, 0) !== 0
    );

    if (existingRow) {
      actions.push([
        "UpdateRecord",
        tables.timesheet,
        existingRow[columns.id],
        fields,
      ]);
      continue;
    }

    if (!hasNonZeroValue) {
      continue;
    }

    actions.push([
      "AddRecord",
      tables.timesheet,
      null,
      {
        [columns.workerId]: workerId,
        // Volontairement la version format.js (throw sur mois invalide) et
        // non celle de monthSegments.js : Timesheet est hors perimetre de ce
        // plan, son comportement historique reste inchange.
        [columns.month]: toGristMonthValueLegacy(monthKey),
        ...fields,
      },
    ]);
  }

  await applyActions(actions);
}

export async function createTimeSegment({
  projectNumber,
  name,
  monthKey,
  effectif,
  label = "",
}) {
  const tableName = APP_CONFIG.grist.tables.timeSegment;
  // Le contexte interservices et ce module mettent les lectures en cache. Une
  // colonne peut avoir ete renommee depuis le chargement (End_Date -> End_At) :
  // une ecriture doit donc repartir du schema courant, pas de cette ancienne photo.
  const columns = await getResolvedTimeSegmentColumns({ forceRefresh: true });
  const normalizedProjectNumber = toText(projectNumber);
  const normalizedName = toText(name);
  const monthValue = toGristMonthValue(monthKey);
  if (!normalizedProjectNumber || !normalizedName || monthValue == null) {
    throw new Error("Segment invalide : numero projet, nom ou mois manquant.");
  }

  const fields = Object.fromEntries(
    Object.entries({
      [columns.projectNumber]: normalizedProjectNumber,
      [columns.name]: normalizedName,
      [columns.mois]: monthValue,
      // Denormalise : ecrit pour la lisibilite de la grille Grist, jamais relu.
      [columns.allocationDays]: getMonthBusinessDays(monthKey),
      [columns.effectif]: toFiniteNumber(effectif, 0),
      [columns.service]: getActiveService(),
    }).filter(([, value]) => value !== undefined)
  );
  if (toText(label)) {
    setTimeSegmentLabelField(fields, columns, label);
  }

  const result = await applyActions([
    [
      "AddRecord",
      tableName,
      null,
      fields,
    ],
  ]);

  return result?.retValues?.[0] ?? null;
}

export async function updateTimeSegment({
  segmentId,
  projectNumber,
  name,
  monthKey,
  effectif,
  label,
}) {
  const normalizedId = toReferenceId(segmentId);
  if (!normalizedId) {
    throw new Error("Segment invalide : id manquant.");
  }

  const columns = await getResolvedTimeSegmentColumns({ forceRefresh: true });
  const fields = {};

  if (projectNumber != null) {
    const normalizedProjectNumber = toText(projectNumber);
    if (!normalizedProjectNumber) {
      throw new Error("Numero projet invalide pour la mise a jour du segment.");
    }
    fields[columns.projectNumber] = normalizedProjectNumber;
  }

  if (name != null) {
    const normalizedName = toText(name);
    if (!normalizedName) {
      throw new Error("Nom invalide pour la mise a jour du segment.");
    }
    fields[columns.name] = normalizedName;
  }

  if (monthKey != null) {
    const monthValue = toGristMonthValue(monthKey);
    if (monthValue == null) {
      throw new Error("Mois invalide pour la mise a jour du segment.");
    }
    fields[columns.mois] = monthValue;
    fields[columns.allocationDays] = getMonthBusinessDays(monthKey);
  }

  if (effectif !== undefined) {
    fields[columns.effectif] =
      effectif === "" ? "" : toFiniteNumber(effectif, 0);
  }

  if (label != null) {
    setTimeSegmentLabelField(fields, columns, label);
  }

  if (!Object.keys(fields).length) {
    return;
  }

  await applyActions([
    ["UpdateRecord", APP_CONFIG.grist.tables.timeSegment, normalizedId, fields],
  ]);
}

export async function removeTimeSegment(segmentId) {
  const normalizedId = toReferenceId(segmentId);
  if (!normalizedId) return;

  await applyActions([
    ["RemoveRecord", APP_CONFIG.grist.tables.timeSegment, normalizedId],
  ]);
}

export async function updateProjectBillingPercentages(projectId, billingPercentageByMonth) {
  await applyActions([
    [
      "UpdateRecord",
      APP_CONFIG.grist.tables.projects,
      projectId,
      {
        [APP_CONFIG.grist.columns.projects.billingPercentageByMonth]: JSON.stringify(
          billingPercentageByMonth || {}
        ),
      },
    ],
  ]);
}

export async function updateProjectAvancementConfig(projectId, avancementConfig) {
  await applyActions([
    [
      "UpdateRecord",
      APP_CONFIG.grist.tables.projects,
      projectId,
      {
        [APP_CONFIG.grist.columns.projects.avancement]: avancementConfig,
      },
    ],
  ]);
}
