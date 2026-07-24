import {
  addGrant,
  asText,
  buildGrantKey,
  decodeGristList,
  encodeGristList,
  extractColumnNames,
  flattenAssignments,
  formatPersonName,
  isCensoredCell,
  normalizeFetchTableResult,
  removeGrant,
  toBooleanFlag,
} from "./accessModel.js";

const CONFIG = {
  tables: {
    team: "Team",
    projects: "Projets2",
  },
  columns: {
    team: {
      id: "id",
      firstName: "Prenom",
      lastName: "Nom",
      fullName: "PrenomNom",
      email: "Email",
      service: "Service",
      admin: "Admin",
      me: "Moi",
      grants: "Acces_Lecture_Projets",
    },
    projects: {
      id: "id",
      number: "Numero_de_projet",
      name: "Nom_de_projet",
    },
  },
  fallbackServices: ["Structure", "Synthese", "Topographie"],
};

const state = {
  teamRows: [],
  projectRows: [],
  assignments: [],
  currentUser: null,
  canManage: false,
  schemaReady: false,
  busy: false,
};

const elements = {
  refreshButton: document.getElementById("refreshButton"),
  schemaAlert: document.getElementById("schemaAlert"),
  schemaAlertText: document.getElementById("schemaAlertText"),
  identityAlert: document.getElementById("identityAlert"),
  identityAlertText: document.getElementById("identityAlertText"),
  assignmentCount: document.getElementById("assignmentCount"),
  beneficiaryCount: document.getElementById("beneficiaryCount"),
  projectCount: document.getElementById("projectCount"),
  assignmentForm: document.getElementById("assignmentForm"),
  personSelect: document.getElementById("personSelect"),
  personHint: document.getElementById("personHint"),
  projectSelect: document.getElementById("projectSelect"),
  serviceSelect: document.getElementById("serviceSelect"),
  serviceHint: document.getElementById("serviceHint"),
  assignmentSummary: document.getElementById("assignmentSummary"),
  assignButton: document.getElementById("assignButton"),
  searchInput: document.getElementById("searchInput"),
  assignmentsBody: document.getElementById("assignmentsBody"),
  emptyState: document.getElementById("emptyState"),
  statusMessage: document.getElementById("statusMessage"),
};

let toastTimer = 0;

function setToast(message, type = "info") {
  if (toastTimer) window.clearTimeout(toastTimer);
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `toast${type === "error" ? " is-error" : ""}${type === "success" ? " is-success" : ""}`;
  elements.statusMessage.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.statusMessage.hidden = true;
    toastTimer = 0;
  }, 5000);
}

function errorMessage(error) {
  return asText(error?.message) || asText(error) || "Erreur Grist inconnue.";
}

function setBusy(busy) {
  state.busy = busy;
  elements.refreshButton.disabled = busy;
  renderFormState();
  renderAssignments();
}

async function fetchTableSnapshot(tableName) {
  const raw = await grist.docApi.fetchTable(tableName);
  return {
    raw,
    rows: normalizeFetchTableResult(raw),
    columns: extractColumnNames(raw),
  };
}

function findCurrentUser(teamRows) {
  const meColumn = CONFIG.columns.team.me;
  const candidates = teamRows.filter((row) => !isCensoredCell(row?.[meColumn]));
  return candidates.length === 1 ? candidates[0] : null;
}

function getTeamRow(teamId) {
  const idColumn = CONFIG.columns.team.id;
  return state.teamRows.find((row) => Number(row?.[idColumn]) === Number(teamId)) || null;
}

function getProjectRow(projectId) {
  const idColumn = CONFIG.columns.projects.id;
  return state.projectRows.find((row) => Number(row?.[idColumn]) === Number(projectId)) || null;
}

function getServices() {
  const services = new Map();
  [...CONFIG.fallbackServices, ...state.teamRows.map((row) => row?.[CONFIG.columns.team.service])]
    .map(asText)
    .filter(Boolean)
    .forEach((service) => {
      const identity = service.toLocaleLowerCase("fr");
      if (!services.has(identity)) services.set(identity, service);
    });

  return [...services.values()].sort((left, right) =>
    left.localeCompare(right, "fr", { sensitivity: "base" }),
  );
}

function replaceSelectOptions(select, placeholder, options, valueGetter, labelGetter) {
  const previousValue = select.value;
  select.replaceChildren();

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(valueGetter(item));
    option.textContent = labelGetter(item);
    select.appendChild(option);
  });

  if ([...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

function populateSelectors() {
  const teamColumns = CONFIG.columns.team;
  const projectColumns = CONFIG.columns.projects;

  const sortedTeam = [...state.teamRows]
    .filter((row) => asText(row?.[teamColumns.email]))
    .sort((left, right) =>
      formatPersonName(left, teamColumns).localeCompare(
        formatPersonName(right, teamColumns),
        "fr",
        { sensitivity: "base" },
      ),
    );

  replaceSelectOptions(
    elements.personSelect,
    "Choisir une personne",
    sortedTeam,
    (row) => row?.[teamColumns.id],
    (row) => {
      const name = formatPersonName(row, teamColumns);
      const service = asText(row?.[teamColumns.service]) || "sans service";
      return `${name} — ${service}`;
    },
  );

  const sortedProjects = [...state.projectRows]
    .filter((row) => asText(row?.[projectColumns.number]) && asText(row?.[projectColumns.name]))
    .sort((left, right) =>
      asText(left?.[projectColumns.number]).localeCompare(
        asText(right?.[projectColumns.number]),
        "fr",
        { numeric: true, sensitivity: "base" },
      ),
    );

  replaceSelectOptions(
    elements.projectSelect,
    "Choisir un projet",
    sortedProjects,
    (row) => row?.[projectColumns.id],
    (row) => `${asText(row?.[projectColumns.number])} — ${asText(row?.[projectColumns.name])}`,
  );

  replaceSelectOptions(
    elements.serviceSelect,
    "Choisir le service à ouvrir",
    getServices(),
    (service) => service,
    (service) => service,
  );
}

function getSelection() {
  const person = getTeamRow(elements.personSelect.value);
  const project = getProjectRow(elements.projectSelect.value);
  const service = asText(elements.serviceSelect.value);
  const projectId = Number(project?.[CONFIG.columns.projects.id]);
  const grantKey = buildGrantKey(projectId, service);
  const personService = asText(person?.[CONFIG.columns.team.service]);
  const existingGrants = decodeGristList(person?.[CONFIG.columns.team.grants]);
  const alreadyGranted = existingGrants.some(
    (value) => value.toLocaleLowerCase("fr") === grantKey.toLocaleLowerCase("fr"),
  );

  return {
    person,
    project,
    service,
    grantKey,
    personService,
    alreadyGranted,
    redundant: Boolean(
      personService
      && service
      && personService.localeCompare(service, "fr", { sensitivity: "base" }) === 0
    ),
  };
}

function renderFormState() {
  const enabled = state.schemaReady && state.canManage && !state.busy;
  elements.personSelect.disabled = !enabled;
  elements.projectSelect.disabled = !enabled;
  elements.serviceSelect.disabled = !enabled;

  const selection = getSelection();
  const complete = Boolean(selection.person && selection.project && selection.service && selection.grantKey);
  elements.assignButton.disabled = !enabled || !complete || selection.redundant || selection.alreadyGranted;

  if (selection.person) {
    const email = asText(selection.person?.[CONFIG.columns.team.email]);
    elements.personHint.textContent = `${email} · service actuel : ${selection.personService || "non renseigné"}`;
  } else {
    elements.personHint.textContent = "Sélectionnez une personne.";
  }

  elements.assignmentSummary.classList.remove("is-warning");

  if (!complete) {
    elements.assignmentSummary.textContent = "Choisissez une personne, un projet et un service.";
    return;
  }

  const personName = formatPersonName(selection.person, CONFIG.columns.team);
  const projectName = asText(selection.project?.[CONFIG.columns.projects.name]);
  const projectNumber = asText(selection.project?.[CONFIG.columns.projects.number]);

  if (selection.redundant) {
    elements.assignmentSummary.textContent =
      `${personName} appartient déjà au service ${selection.service}. Aucun accès exceptionnel n’est nécessaire.`;
    elements.assignmentSummary.classList.add("is-warning");
    return;
  }

  if (selection.alreadyGranted) {
    elements.assignmentSummary.textContent =
      `Cet accès existe déjà pour ${personName} sur ${projectNumber} — ${projectName}, périmètre ${selection.service}.`;
    elements.assignmentSummary.classList.add("is-warning");
    return;
  }

  elements.assignmentSummary.textContent =
    `${personName} pourra lire les données ${selection.service} du projet ${projectNumber} — ${projectName}.`;
}

function appendTextCell(row, primaryText, secondaryText = "", className = "") {
  const cell = document.createElement("td");
  const wrapper = document.createElement("div");
  wrapper.className = className;

  const primary = document.createElement("strong");
  primary.textContent = primaryText;
  wrapper.appendChild(primary);

  if (secondaryText) {
    const secondary = document.createElement("span");
    secondary.className = "cell-secondary";
    secondary.textContent = secondaryText;
    wrapper.appendChild(secondary);
  }

  cell.appendChild(wrapper);
  row.appendChild(cell);
  return cell;
}

function renderAssignments() {
  const query = asText(elements.searchInput.value).toLocaleLowerCase("fr");
  const filtered = state.assignments.filter((assignment) => {
    if (!query) return true;
    return [
      assignment.personName,
      assignment.email,
      assignment.personService,
      assignment.projectNumber,
      assignment.projectName,
      assignment.grantedService,
    ].some((value) => asText(value).toLocaleLowerCase("fr").includes(query));
  });

  elements.assignmentsBody.replaceChildren();

  filtered.forEach((assignment) => {
    const row = document.createElement("tr");
    appendTextCell(row, assignment.personName, assignment.email, "person-cell");

    const sourceServiceCell = document.createElement("td");
    const sourceService = document.createElement("span");
    sourceService.className = "service-pill";
    sourceService.textContent = assignment.personService || "Non renseigné";
    sourceServiceCell.appendChild(sourceService);
    row.appendChild(sourceServiceCell);

    const projectLabel = assignment.projectName || "Projet introuvable";
    const projectCell = appendTextCell(
      row,
      projectLabel,
      assignment.projectNumber ? `N° ${assignment.projectNumber}` : assignment.grantKey,
      "project-cell",
    );
    if (assignment.obsolete) {
      const obsoleteBadge = document.createElement("span");
      obsoleteBadge.className = "status-pill";
      obsoleteBadge.textContent = "À nettoyer";
      projectCell.querySelector(".project-cell")?.appendChild(obsoleteBadge);
    }

    const grantedServiceCell = document.createElement("td");
    const grantedService = document.createElement("span");
    grantedService.className = "service-pill";
    grantedService.textContent = assignment.grantedService || "Clé invalide";
    grantedServiceCell.appendChild(grantedService);
    row.appendChild(grantedServiceCell);

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button button--danger";
    removeButton.textContent = "Retirer";
    removeButton.dataset.teamId = String(assignment.teamId);
    removeButton.dataset.grantKey = assignment.grantKey;
    removeButton.disabled = state.busy || !state.canManage || !state.schemaReady;
    removeButton.addEventListener("click", handleRemoveGrant);
    actionCell.appendChild(removeButton);
    row.appendChild(actionCell);

    elements.assignmentsBody.appendChild(row);
  });

  elements.emptyState.hidden = filtered.length > 0;
}

function renderMetrics() {
  elements.assignmentCount.textContent = String(state.assignments.length);
  elements.beneficiaryCount.textContent = String(
    new Set(state.assignments.map((assignment) => assignment.teamId)).size,
  );
  elements.projectCount.textContent = String(state.projectRows.length);
}

function renderIdentityAlert() {
  elements.identityAlert.hidden = state.canManage;
  if (state.canManage) return;

  if (!state.currentUser) {
    elements.identityAlertText.textContent =
      "Votre ligne Team n’a pas pu être identifiée via la colonne Moi. Le widget reste en consultation.";
    return;
  }

  elements.identityAlertText.textContent =
    "Votre ligne Team n’est pas marquée Admin. Un propriétaire doit activer Team.Admin pour vous autoriser à gérer ces droits.";
}

function validateSchema(teamSnapshot, projectSnapshot) {
  const missing = [];
  const teamRequiredColumns = [
    CONFIG.columns.team.id,
    CONFIG.columns.team.email,
    CONFIG.columns.team.service,
    CONFIG.columns.team.admin,
    CONFIG.columns.team.me,
    CONFIG.columns.team.grants,
  ];
  const projectRequiredColumns = [
    CONFIG.columns.projects.id,
    CONFIG.columns.projects.number,
    CONFIG.columns.projects.name,
  ];

  teamRequiredColumns.forEach((column) => {
    if (!teamSnapshot.columns.includes(column)) missing.push(`${CONFIG.tables.team}.${column}`);
  });
  projectRequiredColumns.forEach((column) => {
    if (!projectSnapshot.columns.includes(column)) missing.push(`${CONFIG.tables.projects}.${column}`);
  });

  state.schemaReady = missing.length === 0;
  elements.schemaAlert.hidden = state.schemaReady;
  elements.schemaAlertText.textContent = state.schemaReady
    ? ""
    : `Colonnes absentes ou inaccessibles : ${missing.join(", ")}.`;
}

async function loadData({ announce = false } = {}) {
  setBusy(true);
  try {
    const [teamSnapshot, projectSnapshot] = await Promise.all([
      fetchTableSnapshot(CONFIG.tables.team),
      fetchTableSnapshot(CONFIG.tables.projects),
    ]);

    state.teamRows = teamSnapshot.rows;
    state.projectRows = projectSnapshot.rows;
    validateSchema(teamSnapshot, projectSnapshot);

    state.currentUser = findCurrentUser(state.teamRows);
    state.canManage = Boolean(
      state.currentUser
      && toBooleanFlag(state.currentUser?.[CONFIG.columns.team.admin]),
    );
    state.assignments = state.schemaReady
      ? flattenAssignments(state.teamRows, state.projectRows)
      : [];

    populateSelectors();
    renderMetrics();
    renderIdentityAlert();
    renderFormState();
    renderAssignments();
    if (announce) setToast("Données Grist actualisées.", "success");
  } catch (error) {
    state.schemaReady = false;
    state.canManage = false;
    elements.schemaAlert.hidden = false;
    elements.schemaAlertText.textContent =
      `Impossible de charger les tables : ${errorMessage(error)}`;
    renderIdentityAlert();
    setToast(errorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleAssign(event) {
  event.preventDefault();
  const selection = getSelection();
  if (
    !state.schemaReady
    || !state.canManage
    || !selection.person
    || !selection.project
    || !selection.grantKey
    || selection.redundant
    || selection.alreadyGranted
  ) {
    renderFormState();
    return;
  }

  const teamId = Number(selection.person?.[CONFIG.columns.team.id]);
  const currentValues = selection.person?.[CONFIG.columns.team.grants];
  const nextValues = encodeGristList(addGrant(currentValues, selection.grantKey));

  setBusy(true);
  try {
    await grist.docApi.applyUserActions([
      [
        "UpdateRecord",
        CONFIG.tables.team,
        teamId,
        { [CONFIG.columns.team.grants]: nextValues },
      ],
    ]);
    await loadData();
    setToast("Accès de lecture accordé.", "success");
  } catch (error) {
    setToast(`Accès non enregistré : ${errorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleRemoveGrant(event) {
  const button = event.currentTarget;
  const teamId = Number(button.dataset.teamId);
  const grantKey = asText(button.dataset.grantKey);
  const teamRow = getTeamRow(teamId);
  if (!teamRow || !grantKey || !state.canManage || !state.schemaReady) return;

  const personName = formatPersonName(teamRow, CONFIG.columns.team);
  if (!window.confirm(`Retirer l’accès ${grantKey} à ${personName} ?`)) return;

  const currentValues = teamRow?.[CONFIG.columns.team.grants];
  const nextValues = encodeGristList(removeGrant(currentValues, grantKey));

  setBusy(true);
  try {
    await grist.docApi.applyUserActions([
      [
        "UpdateRecord",
        CONFIG.tables.team,
        teamId,
        { [CONFIG.columns.team.grants]: nextValues },
      ],
    ]);
    await loadData();
    setToast("Accès retiré.", "success");
  } catch (error) {
    setToast(`Accès non retiré : ${errorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

elements.assignmentForm.addEventListener("submit", handleAssign);
elements.refreshButton.addEventListener("click", () => loadData({ announce: true }));
elements.searchInput.addEventListener("input", renderAssignments);
elements.personSelect.addEventListener("change", renderFormState);
elements.projectSelect.addEventListener("change", renderFormState);
elements.serviceSelect.addEventListener("change", renderFormState);

async function init() {
  if (!window.grist?.docApi) {
    elements.schemaAlert.hidden = false;
    elements.schemaAlertText.textContent =
      "API Grist indisponible. Ouvrez ce widget depuis un document Grist.";
    return;
  }

  grist.ready({ requiredAccess: "full" });
  await loadData();
}

init();
