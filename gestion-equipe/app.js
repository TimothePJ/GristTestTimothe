const TEAM_TABLE = 'Team';
const PROJECTS_TABLE = 'Projets2';
const EMETTEURS_TABLE = 'Emetteurs';
const DOP_REGISTRY_ROW_ID = 1;
const DEFAULT_DOP_VALUES = ['1', '2', '3', '4', '5'];
const DOP_DATA_CHANGE_STORAGE_KEY = 'grist.dop-data-changed';
const DOP_COLUMN = 'DOP';
const PROJECT_NAME_COLUMN = 'Nom_de_projet';
const PROJECT_NUMBER_COLUMN = 'Numero_de_projet';

let records = [];
let selectedRecordId = null;
let projectRecords = [];
let dopRegistryValues = [];
let dopApplyInProgress = false;
let dopRegistryInProgress = false;

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
  return asText(value).replace(/^dop\s*/i, '').trim();
}

function normalizeDopKey(value) {
  return normalizeDopValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr');
}

function parseDopRegistryValue(value) {
  let values = [];
  if (Array.isArray(value)) {
    values = value[0] === 'L' ? value.slice(1) : value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : [trimmed];
      } catch (_error) {
        values = trimmed.split(/[,;\n]+/);
      }
    } else {
      values = trimmed.split(/[,;\n]+/);
    }
  } else if (value != null) {
    values = [value];
  }

  const byKey = new Map();
  values.forEach((item) => {
    const dop = normalizeDopValue(item);
    const key = normalizeDopKey(dop);
    if (key && !byKey.has(key)) byKey.set(key, dop);
  });
  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right, 'fr', { numeric: true, sensitivity: 'base' })
  );
}

function serializeDopRegistryValue(values) {
  return parseDopRegistryValue(values).join(', ');
}

function formatDopLabel(value) {
  const dop = normalizeDopValue(value);
  return dop ? `DOP ${dop}` : 'Commun';
}

function emitDopDataChange(reason) {
  try {
    localStorage.setItem(DOP_DATA_CHANGE_STORAGE_KEY, JSON.stringify({
      reason,
      timestamp: Date.now(),
    }));
  } catch (_error) {}
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

function toRecordId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
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
    cell.colSpan = 7;
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

function renderDopRegistry() {
  const valuesEl = document.getElementById('dopRegistryValues');
  const dopValueSelect = document.getElementById('dopValueSelect');
  const addButton = document.getElementById('addDopButton');
  const input = document.getElementById('newDopValue');

  if (valuesEl) {
    valuesEl.textContent = dopRegistryValues.length
      ? dopRegistryValues.map(formatDopLabel).join(', ')
      : 'Aucune DOP';
  }

  if (dopValueSelect) {
    const selectedValue = normalizeDopValue(dopValueSelect.value);
    dopValueSelect.innerHTML = '';
    const commonOption = document.createElement('option');
    commonOption.value = '';
    commonOption.textContent = 'Commun';
    dopValueSelect.appendChild(commonOption);
    dopRegistryValues.forEach((dop) => {
      const option = document.createElement('option');
      option.value = dop;
      option.textContent = formatDopLabel(dop);
      dopValueSelect.appendChild(option);
    });
    dopValueSelect.value = selectedValue;
    if (dopValueSelect.value !== selectedValue) dopValueSelect.value = '';
    dopValueSelect.disabled = dopApplyInProgress || dopRegistryInProgress;
  }

  if (addButton) addButton.disabled = dopRegistryInProgress;
  if (input) input.disabled = dopRegistryInProgress;
}

async function loadDopRegistry({ initializeDefaults = true } = {}) {
  dopRegistryInProgress = true;
  renderDopRegistry();
  try {
    const snapshot = await fetchTableSnapshot(EMETTEURS_TABLE);
    if (!hasColumn(snapshot.columnNames, DOP_COLUMN)) {
      throw new Error('Colonne DOP introuvable dans Emetteurs.');
    }
    const registryRow = snapshot.rows.find((row) => toRecordId(row.id) === DOP_REGISTRY_ROW_ID);
    if (!registryRow) {
      throw new Error(`Ligne id ${DOP_REGISTRY_ROW_ID} introuvable dans Emetteurs.`);
    }

    dopRegistryValues = parseDopRegistryValue(registryRow[DOP_COLUMN]);
    if (!dopRegistryValues.length && initializeDefaults) {
      dopRegistryValues = [...DEFAULT_DOP_VALUES];
      await grist.docApi.applyUserActions([
        ['UpdateRecord', EMETTEURS_TABLE, DOP_REGISTRY_ROW_ID, {
          [DOP_COLUMN]: serializeDopRegistryValue(dopRegistryValues),
        }],
      ]);
      emitDopDataChange('registry-initialized');
      setDopStatus('Referentiel DOP initialise avec DOP 1 a DOP 5.', 'success');
    }
  } finally {
    dopRegistryInProgress = false;
    renderDopRegistry();
  }
}

async function handleAddDop() {
  const input = document.getElementById('newDopValue');
  const newDop = normalizeDopValue(input?.value);
  if (!newDop) {
    setDopStatus('Saisis une DOP a ajouter.', 'warning');
    return;
  }
  if (dopRegistryValues.some((dop) => normalizeDopKey(dop) === normalizeDopKey(newDop))) {
    setDopStatus(`${formatDopLabel(newDop)} existe deja.`, 'warning');
    return;
  }

  dopRegistryInProgress = true;
  renderDopRegistry();
  try {
    const nextValues = parseDopRegistryValue([...dopRegistryValues, newDop]);
    await grist.docApi.applyUserActions([
      ['UpdateRecord', EMETTEURS_TABLE, DOP_REGISTRY_ROW_ID, {
        [DOP_COLUMN]: serializeDopRegistryValue(nextValues),
      }],
    ]);
    dopRegistryValues = nextValues;
    emitDopDataChange('registry-updated');
    if (input) input.value = '';
    setDopStatus(`${formatDopLabel(newDop)} ajoutee au referentiel.`, 'success');
  } finally {
    dopRegistryInProgress = false;
    renderDopRegistry();
    syncDopValueFromSelectedProject();
  }
}

function syncDopValueFromSelectedProject() {
  const dopValueSelect = document.getElementById('dopValueSelect');
  const selectedProject = getSelectedProject();

  if (dopValueSelect && selectedProject) {
    const selectedDop = normalizeDopValue(selectedProject.dop);
    const registryKeys = new Set(dopRegistryValues.map(normalizeDopKey));
    Array.from(dopValueSelect.options)
      .filter(option => option.value && !registryKeys.has(normalizeDopKey(option.value)))
      .forEach(option => option.remove());

    if (
      selectedDop &&
      !Array.from(dopValueSelect.options).some(option => option.value === selectedDop)
    ) {
      const option = document.createElement('option');
      option.value = selectedDop;
      option.textContent = formatDopLabel(selectedDop);
      dopValueSelect.appendChild(option);
    }

    dopValueSelect.value = selectedDop;
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
      setDopStatus('Colonne Nom_de_projet introuvable dans Projets2.', 'error');
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

async function handleApplyDop() {
  const selectedProject = getSelectedProject();
  if (!selectedProject) {
    setDopStatus('Selectionne un projet avant appliquer.', 'warning');
    return;
  }

  const dopValue = normalizeDopValue(document.getElementById('dopValueSelect')?.value);
  if (selectedProject.id == null) {
    setDopStatus('Impossible de modifier ce projet : identifiant Grist introuvable.', 'error');
    return;
  }

  setDopBusy(true);
  setDopStatus(`Mise a jour de ${formatDopLabel(dopValue)} pour "${selectedProject.name}"...`);

  try {
    await grist.docApi.applyUserActions([
      ['UpdateRecord', PROJECTS_TABLE, selectedProject.id, { [DOP_COLUMN]: dopValue }],
    ]);
    emitDopDataChange('project-dop-updated');
    await loadProjectsForDop(selectedProject.key);
    setDopStatus(
      `${formatDopLabel(dopValue)} enregistree uniquement dans Projets2.DOP pour "${selectedProject.name}".`,
      'success'
    );
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
  const addDopButton = document.getElementById('addDopButton');
  const newDopValue = document.getElementById('newDopValue');

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
  addDopButton.addEventListener('click', () => {
    handleAddDop().catch(error => {
      console.error('Erreur ajout DOP:', error);
      setDopStatus(`Erreur ajout DOP : ${error.message}`, 'error');
      dopRegistryInProgress = false;
      renderDopRegistry();
    });
  });
  newDopValue.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addDopButton.click();
  });

  updateActionButtons();
  Promise.all([loadDopRegistry(), loadProjectsForDop()]).catch(error => {
    console.error('Erreur initialisation DOP:', error);
    setDopStatus(`Erreur initialisation DOP : ${error.message}`, 'error');
  });
});

grist.ready({ requiredAccess: 'full' });
grist.onRecords(function(initialRecords) {
  records = normalizeFetchTableResult(initialRecords);
  populateTable();
});
