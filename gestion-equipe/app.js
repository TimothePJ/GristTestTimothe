const TEAM_TABLE = 'Team';
const PROJECTS_TABLE = 'Projets';
const DOP_COLUMN = 'DOP';
const PROJECT_NAME_COLUMN = 'Nom_de_projet';
const PROJECT_NUMBER_COLUMN = 'Numero_de_projet';

const DOP_TARGETS = [
  {
    tableName: PROJECTS_TABLE,
    label: 'Projets',
    relation: 'projectName',
    matchColumns: [PROJECT_NAME_COLUMN],
  },
  {
    tableName: 'Planning_Projet',
    label: 'Planning_Projet',
    relation: 'projectName',
    matchColumns: ['NomProjet', 'Nom_projet'],
  },
  {
    tableName: 'MsProject',
    label: 'MsProject',
    relation: 'projectName',
    matchColumns: ['NomProjet', 'Nom'],
  },
  {
    tableName: 'References',
    label: 'References',
    relation: 'projectName',
    matchColumns: ['NomProjet', 'NomProjetString'],
  },
  {
    tableName: 'ListePlan_NDC_COF',
    label: 'ListePlan_NDC_COF',
    relation: 'projectName',
    matchColumns: ['Nom_projet', 'NomProjet'],
  },
  {
    tableName: 'Budget',
    label: 'Budget',
    relation: 'projectNumber',
    matchColumns: ['NumeroProjet'],
  },
  {
    tableName: 'ProjectTeam',
    label: 'ProjectTeam',
    relation: 'projectNumber',
    matchColumns: ['NumeroProjet'],
  },
  {
    tableName: 'TimeSegment',
    label: 'TimeSegment',
    relation: 'timeSegment',
    matchColumns: ['NumeroProjet'],
    linkColumns: ['ProjectTeam_Link', 'ProjectTeamLink', 'ProjectTeam'],
  },
  {
    tableName: 'TimeReal',
    label: 'TimeReal',
    relation: 'projectNumber',
    matchColumns: ['NumeroProjet'],
  },
];

let records = [];
let selectedRecordId = null;
let projectRecords = [];
let dopApplyInProgress = false;

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map(asText).filter(Boolean).join(' ').trim();
  }

  if (typeof value === 'object') {
    const textKeys = ['label', 'name', 'display', 'Name', 'details', 'value'];
    for (const key of textKeys) {
      if (value[key] != null) {
        const text = asText(value[key]);
        if (text) return text;
      }
    }
  }

  return String(value).trim();
}

function normalizeEmail(value) {
  return asText(value).toLowerCase();
}

function normalizeIdTrefle(value) {
  return asText(value);
}

function normalizeDopValue(value) {
  const text = asText(value);
  return text === '1' || text === '2' ? text : '';
}

function formatDopLabel(value) {
  const dop = normalizeDopValue(value);
  if (dop === '1') return 'DOP 1';
  if (dop === '2') return 'DOP 2';
  return 'Commun';
}

function toBooleanFlag(value) {
  if (value === true || value === 1) {
    return true;
  }

  const normalizedValue = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'oui', 'yes', 'vrai'].includes(normalizedValue);
}

function buildFullName(prenom, nom) {
  return [asText(prenom), asText(nom)].filter(Boolean).join(' ');
}

function normalizeFetchTableResult(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;

  if (typeof raw === 'object') {
    const keys = Object.keys(raw);
    const maxLen = Math.max(
      0,
      ...keys.map(key => (Array.isArray(raw[key]) ? raw[key].length : 0))
    );

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

function extractColumnNames(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.records) && raw.records.length) {
    return Object.keys(raw.records[0] || {});
  }
  if (Array.isArray(raw) && raw.length) {
    return Object.keys(raw[0] || {});
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.keys(raw);
  }
  return [];
}

async function fetchTableSnapshot(tableName) {
  const raw = await grist.docApi.fetchTable(tableName);
  return {
    rows: normalizeFetchTableResult(raw),
    columnNames: extractColumnNames(raw),
  };
}

function hasColumn(columnNames, columnName) {
  return columnNames.includes(columnName);
}

function findExistingColumn(columnNames, candidates) {
  return candidates.find(column => hasColumn(columnNames, column)) || '';
}

function findExistingColumns(columnNames, candidates) {
  return candidates.filter(column => hasColumn(columnNames, column));
}

function toRecordId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toReferenceId(value) {
  if (typeof value === 'number') return toRecordId(value);

  if (typeof value === 'string') {
    return toRecordId(value.trim());
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const id = toReferenceId(item);
      if (id != null) return id;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    for (const key of ['id', 'rowId', 'recordId']) {
      const id = toReferenceId(value[key]);
      if (id != null) return id;
    }
  }

  return null;
}

function valuesMatch(left, right) {
  const leftText = asText(left);
  const rightText = asText(right);
  if (!leftText || !rightText) return false;
  if (leftText === rightText) return true;

  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

function rowMatchesAnyColumn(row, columns, expectedValue) {
  return columns.some(column => valuesMatch(row[column], expectedValue));
}

function rowMatchesAnyValue(row, columns, expectedValues) {
  return expectedValues
    .filter(value => asText(value))
    .some(value => rowMatchesAnyColumn(row, columns, value));
}

function applyUserActionsInBatches(actions, batchSize = 200) {
  if (!actions.length) return Promise.resolve();

  const batches = [];
  for (let index = 0; index < actions.length; index += batchSize) {
    batches.push(actions.slice(index, index + batchSize));
  }

  return batches.reduce(
    (promise, batch) => promise.then(() => grist.docApi.applyUserActions(batch)),
    Promise.resolve()
  );
}

function getSelectedRecord() {
  return records.find(record => String(record.id) === String(selectedRecordId)) || null;
}

function updateActionButtons() {
  const hasSelection = Boolean(getSelectedRecord());
  const editMemberButton = document.getElementById('editMemberButton');
  const deleteMemberButton = document.getElementById('deleteMemberButton');

  if (editMemberButton) {
    editMemberButton.disabled = !hasSelection;
  }

  if (deleteMemberButton) {
    deleteMemberButton.disabled = !hasSelection;
  }
}

function setSelectedRecordId(recordId) {
  selectedRecordId = recordId;

  document.querySelectorAll('#tableBody tr[data-record-id]').forEach(row => {
    row.classList.toggle('selected', row.dataset.recordId === String(recordId));
  });

  updateActionButtons();
}

function appendCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.appendChild(cell);
}

function populateTable() {
  const tableBody = document.getElementById('tableBody');
  tableBody.innerHTML = '';

  if (selectedRecordId !== null && !getSelectedRecord()) {
    selectedRecordId = null;
  }

  if (!records.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';

    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = 'Aucun membre dans la table Team.';

    row.appendChild(cell);
    tableBody.appendChild(row);
    updateActionButtons();
    return;
  }

  records.forEach(record => {
    const row = document.createElement('tr');
    row.dataset.recordId = record.id;

    appendCell(row, record.Prenom || '');
    appendCell(row, record.Nom || '');
    appendCell(row, record.Email || '');
    appendCell(row, record.Service || '');
    appendCell(row, record.Role || '');
    appendCell(row, record.IdTrefle || '');
    appendCell(row, toBooleanFlag(record.Externe) ? 'Oui' : 'Non');
    appendCell(row, formatDopLabel(record.DOP));

    if (String(record.id) === String(selectedRecordId)) {
      row.classList.add('selected');
    }

    tableBody.appendChild(row);
  });

  updateActionButtons();
}

function showContextMenu(event) {
  event.preventDefault();

  const contextMenu = document.getElementById('contextMenu');
  const row = event.target.closest('tr[data-record-id]');

  if (row) {
    setSelectedRecordId(row.dataset.recordId);
    document.getElementById('editOption').style.display = 'block';
    document.getElementById('deleteOption').style.display = 'block';
  } else {
    setSelectedRecordId(null);
    document.getElementById('editOption').style.display = 'none';
    document.getElementById('deleteOption').style.display = 'none';
  }

  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
}

function hideContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
}

function buildRecordFromForm(form, fieldNames) {
  const formData = new FormData(form);
  const prenom = asText(formData.get(fieldNames.prenom));
  const nom = asText(formData.get(fieldNames.nom));

  return {
    Prenom: prenom,
    Nom: nom,
    Email: asText(formData.get(fieldNames.email)),
    Service: asText(formData.get(fieldNames.service)),
    Role: asText(formData.get(fieldNames.role)),
    IdTrefle: normalizeIdTrefle(formData.get(fieldNames.idTrefle)),
    Externe: formData.has(fieldNames.externe),
    DOP: normalizeDopValue(formData.get(fieldNames.dop)),
    PrenonNom: buildFullName(prenom, nom),
  };
}

function findDuplicate(recordData, ignoredRecordId = null) {
  const email = normalizeEmail(recordData.Email);
  const idTrefle = normalizeIdTrefle(recordData.IdTrefle);

  return records.find(record => {
    if (ignoredRecordId !== null && String(record.id) === String(ignoredRecordId)) {
      return false;
    }

    const hasSameEmail = email && normalizeEmail(record.Email) === email;
    const hasSameIdTrefle = idTrefle && normalizeIdTrefle(record.IdTrefle) === idTrefle;

    return hasSameEmail || hasSameIdTrefle;
  }) || null;
}

function showDuplicateWarning(recordData, duplicateRecord) {
  const duplicateEmail = normalizeEmail(recordData.Email) &&
    normalizeEmail(recordData.Email) === normalizeEmail(duplicateRecord.Email);
  const duplicateIdTrefle = normalizeIdTrefle(recordData.IdTrefle) &&
    normalizeIdTrefle(recordData.IdTrefle) === normalizeIdTrefle(duplicateRecord.IdTrefle);
  const duplicateName = buildFullName(duplicateRecord.Prenom, duplicateRecord.Nom) || 'un autre membre';

  if (duplicateEmail && duplicateIdTrefle) {
    alert(`Impossible d'enregistrer ce membre : l'email et l'IdTrefle existent deja pour ${duplicateName}.`);
    return;
  }

  if (duplicateEmail) {
    alert(`Impossible d'enregistrer ce membre : l'email existe deja pour ${duplicateName}.`);
    return;
  }

  alert(`Impossible d'enregistrer ce membre : l'IdTrefle existe deja pour ${duplicateName}.`);
}

async function saveNewRecord(form) {
  const newRecord = buildRecordFromForm(form, {
    prenom: 'prenom',
    nom: 'nom',
    email: 'email',
    service: 'service',
    role: 'role',
    idTrefle: 'idTrefle',
    externe: 'externe',
    dop: 'dop',
  });
  const duplicateRecord = findDuplicate(newRecord);

  if (duplicateRecord) {
    showDuplicateWarning(newRecord, duplicateRecord);
    return false;
  }

  await grist.docApi.applyUserActions([['AddRecord', TEAM_TABLE, null, newRecord]]);
  return true;
}

async function saveUpdatedRecord(form) {
  if (selectedRecordId === null) return false;

  const updatedFields = buildRecordFromForm(form, {
    prenom: 'editPrenom',
    nom: 'editNom',
    email: 'editEmail',
    service: 'editService',
    role: 'editRole',
    idTrefle: 'editIdTrefle',
    externe: 'editExterne',
    dop: 'editDop',
  });
  const duplicateRecord = findDuplicate(updatedFields, selectedRecordId);

  if (duplicateRecord) {
    showDuplicateWarning(updatedFields, duplicateRecord);
    return false;
  }

  await grist.docApi.applyUserActions([
    ['UpdateRecord', TEAM_TABLE, parseInt(selectedRecordId, 10), updatedFields],
  ]);
  return true;
}

function openAddDialog() {
  const addRowDialog = document.getElementById('addRowDialog');
  const form = addRowDialog.querySelector('form');

  form.reset();
  document.getElementById('dop').value = '';
  addRowDialog.showModal();
  hideContextMenu();
}

function openEditDialog() {
  const record = getSelectedRecord();
  if (!record) return;

  document.getElementById('editPrenom').value = record.Prenom || '';
  document.getElementById('editNom').value = record.Nom || '';
  document.getElementById('editEmail').value = record.Email || '';
  document.getElementById('editService').value = record.Service || '';
  document.getElementById('editRole').value = record.Role || '';
  document.getElementById('editIdTrefle').value = record.IdTrefle || '';
  document.getElementById('editDop').value = normalizeDopValue(record.DOP);
  document.getElementById('editExterne').checked = toBooleanFlag(record.Externe);
  document.getElementById('editRowDialog').showModal();
  hideContextMenu();
}

async function deleteSelectedRecord() {
  const record = getSelectedRecord();
  if (!record) return;

  const memberName = buildFullName(record.Prenom, record.Nom) || 'ce membre';
  if (!confirm(`Supprimer ${memberName} ?`)) {
    hideContextMenu();
    return;
  }

  await grist.docApi.applyUserActions([
    ['RemoveRecord', TEAM_TABLE, parseInt(selectedRecordId, 10)],
  ]);
  setSelectedRecordId(null);
  hideContextMenu();
}

function setDopStatus(message = '', type = '') {
  const statusEl = document.getElementById('dopStatus');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.classList.remove('success', 'warning', 'error');
  if (type) {
    statusEl.classList.add(type);
  }
}

function buildProjectOptionLabel(project) {
  const numberLabel = project.projectNumber ? ` (${project.projectNumber})` : '';
  return `${project.name}${numberLabel} - ${formatDopLabel(project.dop)}`;
}

function getSelectedProject() {
  const projectSelect = document.getElementById('dopProjectSelect');
  if (!projectSelect) return null;
  return projectRecords.find(project => project.key === projectSelect.value) || null;
}

function updateDopApplyButton() {
  const applyButton = document.getElementById('applyDopButton');
  if (!applyButton) return;
  applyButton.disabled = dopApplyInProgress || !getSelectedProject();
}

function syncDopValueFromSelectedProject() {
  const dopValueSelect = document.getElementById('dopValueSelect');
  const selectedProject = getSelectedProject();

  if (dopValueSelect && selectedProject) {
    dopValueSelect.value = normalizeDopValue(selectedProject.dop);
  }

  updateDopApplyButton();
}

function populateProjectSelect(selectedProjectKey = '') {
  const projectSelect = document.getElementById('dopProjectSelect');
  if (!projectSelect) return;

  const previousValue = selectedProjectKey || projectSelect.value;
  projectSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = projectRecords.length ? 'Choisir un projet' : 'Aucun projet disponible';
  projectSelect.appendChild(placeholder);

  projectRecords.forEach(project => {
    const option = document.createElement('option');
    option.value = project.key;
    option.textContent = buildProjectOptionLabel(project);
    projectSelect.appendChild(option);
  });

  projectSelect.disabled = projectRecords.length === 0;
  projectSelect.value = previousValue;
  if (projectSelect.value !== previousValue) {
    projectSelect.value = '';
  }

  syncDopValueFromSelectedProject();
}

async function loadProjectsForDop(selectedProjectKey = '') {
  try {
    const snapshot = await fetchTableSnapshot(PROJECTS_TABLE);
    if (!hasColumn(snapshot.columnNames, PROJECT_NAME_COLUMN)) {
      projectRecords = [];
      populateProjectSelect('');
      setDopStatus('Colonne Nom_de_projet introuvable dans Projets.', 'error');
      return;
    }

    projectRecords = snapshot.rows
      .map((row, index) => {
        const name = asText(row[PROJECT_NAME_COLUMN]);
        const rowId = toRecordId(row.id);
        return {
          key: rowId != null ? String(rowId) : `${name}-${index}`,
          id: rowId,
          name,
          projectNumber: asText(row[PROJECT_NUMBER_COLUMN]),
          dop: normalizeDopValue(row[DOP_COLUMN]),
        };
      })
      .filter(project => project.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' }));

    populateProjectSelect(selectedProjectKey);
  } catch (error) {
    console.error('Erreur chargement projets DOP:', error);
    projectRecords = [];
    populateProjectSelect('');
    setDopStatus(`Erreur chargement projets : ${error.message}`, 'error');
  }
}

function setDopBusy(isBusy) {
  dopApplyInProgress = isBusy;
  const applyButton = document.getElementById('applyDopButton');
  const projectSelect = document.getElementById('dopProjectSelect');
  const dopValueSelect = document.getElementById('dopValueSelect');

  if (applyButton) {
    applyButton.textContent = isBusy ? 'Application...' : 'Appliquer';
  }
  if (projectSelect) {
    projectSelect.disabled = isBusy || projectRecords.length === 0;
  }
  if (dopValueSelect) {
    dopValueSelect.disabled = isBusy;
  }

  updateDopApplyButton();
}

function createTargetResult(target, status, data = {}) {
  return {
    label: target.label,
    status,
    updatedCount: 0,
    ...data,
  };
}

function findTargetRows(target, snapshot, context) {
  if (target.relation === 'projectName') {
    if (!context.projectName) {
      return { rows: [], skipReason: 'nom projet vide' };
    }

    const matchColumns = findExistingColumns(snapshot.columnNames, target.matchColumns);
    if (!matchColumns.length) {
      return { rows: [], skipReason: `colonnes liaison absentes (${target.matchColumns.join(', ')})` };
    }

    return {
      rows: snapshot.rows.filter(row =>
        rowMatchesAnyValue(row, matchColumns, [context.projectName, context.projectId])
      ),
      skipReason: '',
    };
  }

  if (target.relation === 'projectNumber') {
    if (!context.projectNumber) {
      return { rows: [], skipReason: 'numero projet vide' };
    }

    const matchColumns = findExistingColumns(snapshot.columnNames, target.matchColumns);
    if (!matchColumns.length) {
      return { rows: [], skipReason: `colonnes liaison absentes (${target.matchColumns.join(', ')})` };
    }

    return {
      rows: snapshot.rows.filter(row => rowMatchesAnyColumn(row, matchColumns, context.projectNumber)),
      skipReason: '',
    };
  }

  if (target.relation === 'timeSegment') {
    const directColumns = findExistingColumns(snapshot.columnNames, target.matchColumns);
    if (context.projectNumber && directColumns.length) {
      return {
        rows: snapshot.rows.filter(row => rowMatchesAnyColumn(row, directColumns, context.projectNumber)),
        skipReason: '',
      };
    }

    const linkColumn = findExistingColumn(snapshot.columnNames, target.linkColumns || []);
    if (!linkColumn) {
      return { rows: [], skipReason: 'colonnes NumeroProjet et ProjectTeam_Link absentes' };
    }
    if (!context.projectTeamIds.size) {
      return { rows: [], skipReason: '' };
    }

    return {
      rows: snapshot.rows.filter(row => context.projectTeamIds.has(toReferenceId(row[linkColumn]))),
      skipReason: '',
    };
  }

  return { rows: [], skipReason: 'relation non configuree' };
}

async function updateTargetDop(target, context) {
  let snapshot;
  try {
    snapshot = await fetchTableSnapshot(target.tableName);
  } catch (error) {
    return createTargetResult(target, 'skipped', {
      reason: `table inaccessible (${error.message})`,
    });
  }

  const { rows: matchingRows, skipReason } = findTargetRows(target, snapshot, context);

  if (target.tableName === 'ProjectTeam') {
    matchingRows.forEach(row => {
      const rowId = toRecordId(row.id);
      if (rowId != null) {
        context.projectTeamIds.add(rowId);
      }
    });
  }

  if (skipReason) {
    return createTargetResult(target, 'skipped', { reason: skipReason });
  }

  if (!hasColumn(snapshot.columnNames, DOP_COLUMN)) {
    return createTargetResult(target, 'skipped', { reason: 'colonne DOP absente' });
  }

  if (!hasColumn(snapshot.columnNames, 'id')) {
    return createTargetResult(target, 'skipped', { reason: 'colonne id absente' });
  }

  const actions = matchingRows
    .map(row => {
      const rowId = toRecordId(row.id);
      if (rowId == null) return null;
      return ['UpdateRecord', target.tableName, rowId, { [DOP_COLUMN]: context.dopValue }];
    })
    .filter(Boolean);

  if (!actions.length) {
    return createTargetResult(target, 'updated', { updatedCount: 0 });
  }

  try {
    await applyUserActionsInBatches(actions);
    return createTargetResult(target, 'updated', { updatedCount: actions.length });
  } catch (error) {
    return createTargetResult(target, 'error', {
      reason: error.message,
    });
  }
}

function buildDopSummary(project, dopValue, results) {
  const lines = [
    `${formatDopLabel(dopValue)} applique au projet "${project.name}".`,
  ];

  results.forEach(result => {
    if (result.status === 'updated') {
      lines.push(`${result.label}: ${result.updatedCount} ligne(s) mise(s) a jour`);
      return;
    }
    if (result.status === 'error') {
      lines.push(`${result.label}: erreur (${result.reason})`);
      return;
    }
    lines.push(`${result.label}: ignore (${result.reason})`);
  });

  return lines.join('\n');
}

function getDopSummaryType(results) {
  if (results.some(result => result.status === 'error')) return 'error';
  if (results.some(result => result.status === 'skipped')) return 'warning';
  return 'success';
}

async function handleApplyDop() {
  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    setDopStatus('Selectionne un projet avant appliquer.', 'warning');
    return;
  }

  const dopValue = normalizeDopValue(document.getElementById('dopValueSelect')?.value);
  const context = {
    projectId: selectedProject.id,
    projectName: selectedProject.name,
    projectNumber: selectedProject.projectNumber,
    dopValue,
    projectTeamIds: new Set(),
  };

  setDopBusy(true);
  setDopStatus(`Application de ${formatDopLabel(dopValue)} au projet "${selectedProject.name}"...`);

  try {
    const results = [];
    for (const target of DOP_TARGETS) {
      results.push(await updateTargetDop(target, context));
    }

    await loadProjectsForDop(selectedProject.key);
    setDopStatus(buildDopSummary(selectedProject, dopValue, results), getDopSummaryType(results));
  } finally {
    setDopBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('tableBody');
  const addRowDialog = document.getElementById('addRowDialog');
  const editRowDialog = document.getElementById('editRowDialog');
  const addMemberButton = document.getElementById('addMemberButton');
  const editMemberButton = document.getElementById('editMemberButton');
  const deleteMemberButton = document.getElementById('deleteMemberButton');
  const addRowOption = document.getElementById('addRowOption');
  const editOption = document.getElementById('editOption');
  const deleteOption = document.getElementById('deleteOption');
  const cancelAddRowButton = document.getElementById('cancelAddRowButton');
  const cancelEditRowButton = document.getElementById('cancelEditRowButton');
  const dopProjectSelect = document.getElementById('dopProjectSelect');
  const applyDopButton = document.getElementById('applyDopButton');

  tableBody.addEventListener('click', event => {
    const row = event.target.closest('tr[data-record-id]');
    if (!row) return;
    setSelectedRecordId(row.dataset.recordId);
  });
  tableBody.addEventListener('contextmenu', showContextMenu);
  document.addEventListener('click', event => {
    if (!event.target.closest('#contextMenu')) {
      hideContextMenu();
    }
  });

  addMemberButton.addEventListener('click', openAddDialog);
  editMemberButton.addEventListener('click', openEditDialog);
  deleteMemberButton.addEventListener('click', async () => {
    try {
      await deleteSelectedRecord();
    } catch (error) {
      console.error('Error deleting record:', error);
      alert('Une erreur est survenue pendant la suppression du membre.');
    }
  });

  addRowOption.addEventListener('click', openAddDialog);
  editOption.addEventListener('click', openEditDialog);
  deleteOption.addEventListener('click', async () => {
    try {
      await deleteSelectedRecord();
    } catch (error) {
      console.error('Error deleting record:', error);
      alert('Une erreur est survenue pendant la suppression du membre.');
    }
  });

  cancelAddRowButton.addEventListener('click', () => {
    addRowDialog.close();
  });

  cancelEditRowButton.addEventListener('click', () => {
    editRowDialog.close();
  });

  addRowDialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (await saveNewRecord(event.target)) {
        addRowDialog.close();
      }
    } catch (error) {
      console.error('Error adding record:', error);
      alert("Une erreur est survenue pendant l'ajout du membre.");
    }
  });

  editRowDialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (await saveUpdatedRecord(event.target)) {
        editRowDialog.close();
      }
    } catch (error) {
      console.error('Error updating record:', error);
      alert('Une erreur est survenue pendant la modification du membre.');
    }
  });

  dopProjectSelect.addEventListener('change', syncDopValueFromSelectedProject);
  applyDopButton.addEventListener('click', () => {
    handleApplyDop().catch(error => {
      console.error('Erreur application DOP:', error);
      setDopStatus(`Erreur application DOP : ${error.message}`, 'error');
      setDopBusy(false);
    });
  });

  updateActionButtons();
  loadProjectsForDop();
});

grist.ready({ requiredAccess: 'full' });
grist.onRecords(function(initialRecords) {
  records = normalizeFetchTableResult(initialRecords);
  populateTable();
});
