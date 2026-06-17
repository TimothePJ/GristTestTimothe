const TEAM_TABLE = 'Team';
const PROJECTS_TABLE = 'Projets2';
const EMETTEURS_TABLE = 'Emetteurs';
const DOP_REGISTRY_ROW_ID = 1;
const DEFAULT_DOP_VALUES = ['1', '2', '3', '4', '5'];
const DOP_DATA_CHANGE_STORAGE_KEY = 'grist.dop-data-changed';
const PROJECT_DATA_CHANGE_STORAGE_KEY = 'grist.project-data-changed';
const SHARED_PROJECT_STORAGE_KEY = 'grist.selected-project';
const SHARED_PROJECT_ID_STORAGE_KEY = 'grist.selected-project-id';
const DOP_COLUMN = 'DOP';
const PROJECT_NAME_COLUMN = 'Nom_de_projet';
const PROJECT_NUMBER_COLUMN = 'Numero_de_projet';
const PROJECT_RELATION_GROUPS = [
  {
    relation: 'name',
    tableNames: ['Planning_Projet', 'Planning_Project'],
    columns: [
      'NomProjetString',
      'NomProjet',
      'Nom_projet',
      'Nom_Projet',
      'Projet',
      'Project',
      'Nom_de_projet',
    ],
  },
  {
    relation: 'name',
    tableNames: ['References2'],
    columns: ['NomProjetString', 'NomProjet', 'Nom_projet', 'Nom_Projet', 'Nom_de_projet'],
  },
  {
    relation: 'name',
    tableNames: ['ListePlan_NDC_COF', 'ListePlan NDC+COF', 'ListePlan_NDC+COF'],
    columns: ['NomProjetString', 'NomProjet', 'Nom_projet', 'Nom_Projet', 'Nom_de_projet'],
  },
  {
    relation: 'name',
    tableNames: ['MsProject'],
    columns: [
      'NomProjetString',
      'NomProjet',
      'Nom_projet',
      'Nom_Projet',
      'Projet',
      'Project',
      'Nom_de_projet',
    ],
  },
  {
    relation: 'name',
    tableNames: ['Envois'],
    columns: ['NomProjetString', 'Projet', 'NomProjet', 'Nom_projet', 'Nom_Projet', 'Nom_de_projet'],
  },
  {
    relation: 'number',
    tableNames: ['Budget', 'ProjectTeam', 'TimeSegment', 'TimeReal'],
    columns: [
      'NumeroProjetString',
      'NumeroProjet',
      'Numero_Projet',
      'Numero_de_projet',
      'Project_Number',
      'ProjectNumber',
    ],
  },
];

let records = [];
let selectedRecordId = null;
let projectRecords = [];
let dopRegistryValues = [];
let dopApplyInProgress = false;
let dopRegistryInProgress = false;
let projectEditInProgress = false;
let pendingProjectUpdatePreview = null;
let gristSchemaPromise = null;
const MEMBER_TABLE_COLUMN_COUNT = 5;
const MEMBER_TABLE_HEADERS = ['Prénom', 'Nom', 'Email', 'IdTrefle', ''];
const collapsedServiceGroups = new Set();
const collapsedRoleGroups = new Set();

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

function normalizeProjectRelationKey(value) {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

function emitProjectDataChange(reason, projectId) {
  try {
    localStorage.setItem(PROJECT_DATA_CHANGE_STORAGE_KEY, JSON.stringify({
      reason,
      projectId,
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

async function loadGristSchema() {
  if (!gristSchemaPromise) {
    gristSchemaPromise = Promise.all([
      fetchTableSnapshot('_grist_Tables'),
      fetchTableSnapshot('_grist_Tables_column'),
    ]).then(([tablesSnapshot, columnsSnapshot]) => {
      const tablesByName = new Map();

      tablesSnapshot.rows.forEach((tableRow) => {
        const tableName = asText(tableRow.tableId);
        const tableRef = toRecordId(tableRow.id);
        if (!tableName || tableRef == null) return;
        tablesByName.set(tableName, {
          id: tableRef,
          name: tableName,
          columns: new Map(),
        });
      });

      columnsSnapshot.rows.forEach((columnRow) => {
        const parentId = toRecordId(columnRow.parentId);
        const columnId = asText(columnRow.colId);
        if (parentId == null || !columnId) return;

        const table = [...tablesByName.values()].find(candidate => candidate.id === parentId);
        if (!table) return;
        table.columns.set(columnId, columnRow);
      });

      return { tablesByName };
    }).catch((error) => {
      gristSchemaPromise = null;
      throw error;
    });
  }

  return gristSchemaPromise;
}

function isFormulaColumn(columnMetadata) {
  return toBooleanFlag(columnMetadata?.isFormula) || Boolean(asText(columnMetadata?.formula));
}

function getColumnType(columnMetadata) {
  return asText(columnMetadata?.type);
}

function isProjectReferenceColumn(columnMetadata) {
  const type = getColumnType(columnMetadata).toLocaleLowerCase('fr');
  return type === 'ref:projets2' || type === 'reflist:projets2';
}

function isWritableProjectRelationColumn(columnMetadata) {
  const baseType = getColumnType(columnMetadata).split(':')[0];
  return ['Text', 'Choice', 'Any'].includes(baseType);
}

function getWritableProjectRelationColumns(tableSchema, candidateColumns) {
  const writableColumns = [];

  candidateColumns.forEach((columnId) => {
    const columnMetadata = tableSchema.columns.get(columnId);
    if (!columnMetadata || isFormulaColumn(columnMetadata)) return;
    if (isProjectReferenceColumn(columnMetadata)) return;

    if (!isWritableProjectRelationColumn(columnMetadata)) {
      const type = getColumnType(columnMetadata) || 'inconnu';
      throw new Error(
        `Impossible de propager la modification dans ${tableSchema.name}.${columnId} : ` +
        `le type ${type} n'est ni un texte, ni une référence vers Projets2, ni une formule.`
      );
    }

    writableColumns.push(columnId);
  });

  return writableColumns;
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

function compareFrenchText(left, right) {
  return asText(left).localeCompare(asText(right), 'fr', {
    numeric: true,
    sensitivity: 'base',
  });
}

function getGroupLabel(value) {
  return asText(value) || 'Non renseigné';
}

function getGroupKey(...values) {
  return JSON.stringify(values.map(getGroupLabel));
}

function findGroupToggleButton(groupType, groupKey) {
  return Array.from(document.querySelectorAll('.group-toggle'))
    .find(button =>
      button.dataset.groupType === groupType &&
      button.dataset.groupKey === groupKey
    ) || null;
}

function restoreGroupTogglePosition(groupType, groupKey, anchorTop, scrollContainer) {
  const nextButton = findGroupToggleButton(groupType, groupKey);
  if (!nextButton) return;

  let topDelta = nextButton.getBoundingClientRect().top - anchorTop;
  if (scrollContainer) {
    scrollContainer.scrollTop += topDelta;
    topDelta = nextButton.getBoundingClientRect().top - anchorTop;
  }

  if (topDelta) {
    window.scrollBy(0, topDelta);
  }

  nextButton.focus({ preventScroll: true });
}

function toggleCollapsedGroup(groupType, groupKey, anchorButton = null) {
  const anchorTop = anchorButton?.getBoundingClientRect().top ?? null;
  const scrollContainer = anchorButton?.closest('.table-container') || null;
  const groups = groupType === 'service' ? collapsedServiceGroups : collapsedRoleGroups;

  if (groups.has(groupKey)) {
    groups.delete(groupKey);
  } else {
    groups.add(groupKey);
  }

  populateTable();

  if (anchorTop !== null) {
    restoreGroupTogglePosition(groupType, groupKey, anchorTop, scrollContainer);
    requestAnimationFrame(() => {
      restoreGroupTogglePosition(groupType, groupKey, anchorTop, scrollContainer);
    });
  }
}

function appendGroupRow(tableBody, className, label, options = {}) {
  const row = document.createElement('tr');
  row.className = className;

  const cell = document.createElement('td');
  cell.colSpan = MEMBER_TABLE_COLUMN_COUNT;

  if (options.groupType && options.groupKey) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group-toggle';
    button.dataset.groupType = options.groupType;
    button.dataset.groupKey = options.groupKey;
    button.setAttribute('aria-expanded', String(!options.collapsed));

    const arrow = document.createElement('span');
    arrow.className = 'group-toggle-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = options.collapsed ? '▶' : '▼';

    const text = document.createElement('span');
    text.textContent = label;

    button.appendChild(arrow);
    button.appendChild(text);
    cell.appendChild(button);
  } else {
    cell.textContent = label;
  }

  row.appendChild(cell);
  tableBody.appendChild(row);
}

function appendServiceSpacerRow(tableBody) {
  const row = document.createElement('tr');
  row.className = 'service-spacer';

  const cell = document.createElement('td');
  cell.colSpan = MEMBER_TABLE_COLUMN_COUNT;

  row.appendChild(cell);
  tableBody.appendChild(row);
}

function appendMemberHeaderRow(tableBody) {
  const row = document.createElement('tr');
  row.className = 'member-header';

  MEMBER_TABLE_HEADERS.forEach((label) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    row.appendChild(cell);
  });

  tableBody.appendChild(row);
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
    cell.colSpan = MEMBER_TABLE_COLUMN_COUNT;
    cell.textContent = 'Aucun membre dans la table Team.';

    row.appendChild(cell);
    tableBody.appendChild(row);
    updateActionButtons();
    return;
  }

  const sortedRecords = [...records].sort((left, right) =>
    compareFrenchText(getGroupLabel(left.Service), getGroupLabel(right.Service)) ||
    compareFrenchText(getGroupLabel(left.Role), getGroupLabel(right.Role)) ||
    compareFrenchText(left.Nom, right.Nom) ||
    compareFrenchText(left.Prenom, right.Prenom) ||
    compareFrenchText(left.Email, right.Email) ||
    compareFrenchText(left.id, right.id)
  );

  let currentService = null;
  let currentRole = null;

  sortedRecords.forEach(record => {
    const serviceLabel = getGroupLabel(record.Service);
    const roleLabel = getGroupLabel(record.Role);
    const serviceKey = getGroupKey(serviceLabel);
    const roleKey = getGroupKey(serviceLabel, roleLabel);
    const isServiceCollapsed = collapsedServiceGroups.has(serviceKey);
    const isRoleCollapsed = collapsedRoleGroups.has(roleKey);

    if (serviceLabel !== currentService) {
      if (currentService !== null) {
        appendServiceSpacerRow(tableBody);
      }

      currentService = serviceLabel;
      currentRole = null;
      appendGroupRow(tableBody, 'service-group', `Service : ${serviceLabel}`, {
        collapsed: isServiceCollapsed,
        groupKey: serviceKey,
        groupType: 'service',
      });
    }

    if (isServiceCollapsed) {
      return;
    }

    if (roleLabel !== currentRole) {
      currentRole = roleLabel;
      appendGroupRow(tableBody, 'role-group', `Rôle : ${roleLabel}`, {
        collapsed: isRoleCollapsed,
        groupKey: roleKey,
        groupType: 'role',
      });

      if (!isRoleCollapsed) {
        appendMemberHeaderRow(tableBody);
      }
    }

    if (isRoleCollapsed) {
      return;
    }

    const row = document.createElement('tr');
    row.dataset.recordId = record.id;

    appendCell(row, record.Prenom || '');
    appendCell(row, record.Nom || '');
    appendCell(row, record.Email || '');
    appendCell(row, record.IdTrefle || '');
    appendCell(row, toBooleanFlag(record.Externe) ? 'Externe' : '');

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

function setProjectEditStatus(message = '', type = '') {
  const statusEl = document.getElementById('projectEditStatus');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.classList.remove('success', 'warning', 'error');
  if (type) statusEl.classList.add(type);
}

function buildProjectEditOptionLabel(project) {
  return project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name;
}

function getSelectedProjectForEdit() {
  const projectSelect = document.getElementById('projectEditSelect');
  if (!projectSelect) return null;
  return projectRecords.find(project => project.key === projectSelect.value) || null;
}

function updateProjectEditControls() {
  const selectedProject = getSelectedProjectForEdit();
  const projectSelect = document.getElementById('projectEditSelect');
  const nameInput = document.getElementById('projectNameInput');
  const numberInput = document.getElementById('projectNumberInput');
  const previewButton = document.getElementById('previewProjectUpdateButton');
  const confirmButton = document.getElementById('confirmProjectUpdateButton');

  if (projectSelect) {
    projectSelect.disabled =
      projectEditInProgress || !projectRecords.some(project => project.id != null);
  }
  if (nameInput) nameInput.disabled = projectEditInProgress || !selectedProject;
  if (numberInput) numberInput.disabled = projectEditInProgress || !selectedProject;
  if (previewButton) previewButton.disabled = projectEditInProgress || !selectedProject;
  if (confirmButton) confirmButton.disabled = projectEditInProgress || !pendingProjectUpdatePreview;
}

function syncProjectEditFieldsFromSelection() {
  const selectedProject = getSelectedProjectForEdit();
  const nameInput = document.getElementById('projectNameInput');
  const numberInput = document.getElementById('projectNumberInput');

  if (nameInput) nameInput.value = selectedProject?.name || '';
  if (numberInput) numberInput.value = selectedProject?.projectNumber || '';
  pendingProjectUpdatePreview = null;
  updateProjectEditControls();
}

function populateProjectEditSelect(selectedProjectKey = '') {
  const projectSelect = document.getElementById('projectEditSelect');
  if (!projectSelect) return;

  const previousValue = selectedProjectKey || projectSelect.value;
  const editableProjects = projectRecords.filter(project => project.id != null);
  projectSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = editableProjects.length ? 'Choisir un projet' : 'Aucun projet disponible';
  projectSelect.appendChild(placeholder);

  editableProjects.forEach((project) => {
    const option = document.createElement('option');
    option.value = project.key;
    option.textContent = buildProjectEditOptionLabel(project);
    projectSelect.appendChild(option);
  });

  projectSelect.value = previousValue;
  if (projectSelect.value !== previousValue) projectSelect.value = '';
  syncProjectEditFieldsFromSelection();
}

function setProjectEditBusy(isBusy) {
  projectEditInProgress = isBusy;
  const previewButton = document.getElementById('previewProjectUpdateButton');
  const confirmButton = document.getElementById('confirmProjectUpdateButton');
  const cancelButton = document.getElementById('cancelProjectUpdateButton');

  if (previewButton) {
    previewButton.textContent = isBusy ? 'Analyse en cours...' : 'Prévisualiser les modifications';
  }
  if (confirmButton) {
    confirmButton.textContent = isBusy ? 'Application...' : 'Appliquer';
  }
  if (cancelButton) cancelButton.disabled = isBusy;

  updateProjectEditControls();
}

function mergeProjectUpdateAction(actionMap, tableName, rowId, fields) {
  const recordId = toRecordId(rowId);
  if (!Object.keys(fields).length) return;
  if (recordId == null) {
    throw new Error(`Identifiant de ligne introuvable dans ${tableName}.`);
  }

  const key = `${tableName}:${recordId}`;
  const existingAction = actionMap.get(key);
  if (existingAction) {
    Object.assign(existingAction[3], fields);
    return;
  }

  actionMap.set(key, ['UpdateRecord', tableName, recordId, { ...fields }]);
}

function assertProjectColumnWritable(tableSchema, columnId) {
  const columnMetadata = tableSchema?.columns.get(columnId);
  if (!columnMetadata) {
    throw new Error(`Colonne ${tableSchema?.name || PROJECTS_TABLE}.${columnId} introuvable.`);
  }
  if (isFormulaColumn(columnMetadata) || !isWritableProjectRelationColumn(columnMetadata)) {
    throw new Error(`La colonne ${tableSchema.name}.${columnId} n'est pas modifiable comme texte.`);
  }
}

function findProjectValueDuplicate(rows, columnId, value, ignoredProjectId) {
  const targetKey = normalizeProjectRelationKey(value);
  return rows.find((row) => {
    const rowId = toRecordId(row.id);
    return rowId !== ignoredProjectId &&
      normalizeProjectRelationKey(row[columnId]) === targetKey;
  }) || null;
}

function assertProjectUpdateIsUnambiguous(projectRows, selectedProject, changes) {
  if (changes.nameChanged) {
    const duplicateTarget = findProjectValueDuplicate(
      projectRows,
      PROJECT_NAME_COLUMN,
      changes.nextName,
      selectedProject.id
    );
    if (duplicateTarget) {
      throw new Error(`Le nom "${changes.nextName}" est déjà utilisé par un autre projet.`);
    }

    const duplicateSource = findProjectValueDuplicate(
      projectRows,
      PROJECT_NAME_COLUMN,
      changes.oldName,
      selectedProject.id
    );
    if (duplicateSource) {
      throw new Error(
        `Le nom actuel "${changes.oldName}" est partagé par plusieurs projets. ` +
        `La propagation automatique est bloquée.`
      );
    }
  }

  if (changes.numberChanged) {
    const duplicateTarget = findProjectValueDuplicate(
      projectRows,
      PROJECT_NUMBER_COLUMN,
      changes.nextNumber,
      selectedProject.id
    );
    if (duplicateTarget) {
      throw new Error(`Le numéro "${changes.nextNumber}" est déjà utilisé par un autre projet.`);
    }

    const duplicateSource = findProjectValueDuplicate(
      projectRows,
      PROJECT_NUMBER_COLUMN,
      changes.oldNumber,
      selectedProject.id
    );
    if (duplicateSource) {
      throw new Error(
        `Le numéro actuel "${changes.oldNumber}" est partagé par plusieurs projets. ` +
        `La propagation automatique est bloquée.`
      );
    }
  }
}

function buildProjectUpdatePreviewSignature(preview) {
  return JSON.stringify({
    projectId: preview.projectId,
    oldName: preview.oldName,
    oldNumber: preview.oldNumber,
    nextName: preview.nextName,
    nextNumber: preview.nextNumber,
    actions: preview.actions,
  });
}

async function buildProjectUpdatePreview({ projectId, nextName, nextNumber }) {
  const normalizedProjectId = toRecordId(projectId);
  const normalizedNextName = asText(nextName);
  const normalizedNextNumber = asText(nextNumber);

  if (normalizedProjectId == null) {
    throw new Error('Identifiant Grist du projet introuvable.');
  }
  if (!normalizedNextName) {
    throw new Error('Le nom du projet est obligatoire.');
  }
  if (!normalizedNextNumber) {
    throw new Error('Le numéro du projet est obligatoire.');
  }

  const [schema, projectsSnapshot] = await Promise.all([
    loadGristSchema(),
    fetchTableSnapshot(PROJECTS_TABLE),
  ]);
  const projectsSchema = schema.tablesByName.get(PROJECTS_TABLE);
  if (!projectsSchema) {
    throw new Error(`Table ${PROJECTS_TABLE} introuvable.`);
  }

  assertProjectColumnWritable(projectsSchema, PROJECT_NAME_COLUMN);
  assertProjectColumnWritable(projectsSchema, PROJECT_NUMBER_COLUMN);

  const selectedProject = projectsSnapshot.rows.find(
    row => toRecordId(row.id) === normalizedProjectId
  );
  if (!selectedProject) {
    throw new Error('Le projet sélectionné n’existe plus dans Projets2.');
  }

  const oldName = asText(selectedProject[PROJECT_NAME_COLUMN]);
  const oldNumber = asText(selectedProject[PROJECT_NUMBER_COLUMN]);
  const nameChanged = oldName !== normalizedNextName;
  const numberChanged = oldNumber !== normalizedNextNumber;
  if (!nameChanged && !numberChanged) {
    throw new Error('Aucune modification à prévisualiser.');
  }
  if (nameChanged && !oldName) {
    throw new Error('Le nom actuel est vide : la propagation automatique est impossible.');
  }
  if (numberChanged && !oldNumber) {
    throw new Error('Le numéro actuel est vide : la propagation automatique est impossible.');
  }

  const changes = {
    oldName,
    oldNumber,
    nextName: normalizedNextName,
    nextNumber: normalizedNextNumber,
    nameChanged,
    numberChanged,
  };
  assertProjectUpdateIsUnambiguous(projectsSnapshot.rows, {
    id: normalizedProjectId,
  }, changes);

  const actionMap = new Map();
  const tableOrder = [PROJECTS_TABLE];
  const projectFields = {};
  if (nameChanged) projectFields[PROJECT_NAME_COLUMN] = normalizedNextName;
  if (numberChanged) projectFields[PROJECT_NUMBER_COLUMN] = normalizedNextNumber;
  mergeProjectUpdateAction(actionMap, PROJECTS_TABLE, normalizedProjectId, projectFields);

  for (const relationGroup of PROJECT_RELATION_GROUPS) {
    const relationChanged = relationGroup.relation === 'name' ? nameChanged : numberChanged;
    if (!relationChanged) continue;

    const sourceValue = relationGroup.relation === 'name' ? oldName : oldNumber;
    const targetValue = relationGroup.relation === 'name' ? normalizedNextName : normalizedNextNumber;
    const sourceKey = normalizeProjectRelationKey(sourceValue);

    for (const tableName of relationGroup.tableNames) {
      const tableSchema = schema.tablesByName.get(tableName);
      if (!tableSchema) continue;

      tableOrder.push(tableName);
      const writableColumns = getWritableProjectRelationColumns(
        tableSchema,
        relationGroup.columns
      );
      const snapshot = await fetchTableSnapshot(tableName);
      if (!writableColumns.length) continue;

      snapshot.rows.forEach((row) => {
        const updates = {};
        writableColumns.forEach((columnId) => {
          if (normalizeProjectRelationKey(row[columnId]) === sourceKey) {
            updates[columnId] = targetValue;
          }
        });
        mergeProjectUpdateAction(actionMap, tableName, row.id, updates);
      });
    }
  }

  const actions = [...actionMap.values()];
  const countsByTable = new Map(tableOrder.map(tableName => [tableName, 0]));
  actions.forEach((action) => {
    countsByTable.set(action[1], (countsByTable.get(action[1]) || 0) + 1);
  });

  const preview = {
    projectId: normalizedProjectId,
    oldName,
    oldNumber,
    nextName: normalizedNextName,
    nextNumber: normalizedNextNumber,
    actions,
    tableCounts: [...countsByTable.entries()].map(([tableName, count]) => ({
      tableName,
      count,
    })),
  };
  preview.signature = buildProjectUpdatePreviewSignature(preview);
  return preview;
}

function renderProjectUpdatePreview(preview) {
  document.getElementById('projectUpdateOldName').textContent = preview.oldName;
  document.getElementById('projectUpdateNewName').textContent = preview.nextName;
  document.getElementById('projectUpdateOldNumber').textContent = preview.oldNumber;
  document.getElementById('projectUpdateNewNumber').textContent = preview.nextNumber;
  document.getElementById('projectUpdateTotal').textContent =
    `${preview.actions.length} ligne(s) seront modifiées.`;

  const previewBody = document.getElementById('projectUpdatePreviewBody');
  previewBody.innerHTML = '';
  preview.tableCounts.forEach(({ tableName, count }) => {
    const row = document.createElement('tr');
    appendCell(row, tableName);
    appendCell(row, String(count));
    previewBody.appendChild(row);
  });
}

async function handlePreviewProjectUpdate() {
  const selectedProject = getSelectedProjectForEdit();
  if (!selectedProject?.id) {
    setProjectEditStatus('Sélectionne un projet à modifier.', 'warning');
    return;
  }

  setProjectEditBusy(true);
  setProjectEditStatus('Analyse des liaisons du projet...');
  try {
    const preview = await buildProjectUpdatePreview({
      projectId: selectedProject.id,
      nextName: document.getElementById('projectNameInput')?.value,
      nextNumber: document.getElementById('projectNumberInput')?.value,
    });
    pendingProjectUpdatePreview = preview;
    renderProjectUpdatePreview(preview);
    setProjectEditStatus(
      `Aperçu prêt : ${preview.actions.length} ligne(s) à modifier.`,
      'success'
    );
    document.getElementById('projectUpdateDialog').showModal();
  } finally {
    setProjectEditBusy(false);
  }
}

function updateSharedProjectSelectionAfterRename(preview) {
  try {
    const sharedProjectId = toRecordId(localStorage.getItem(SHARED_PROJECT_ID_STORAGE_KEY));
    const sharedProjectName = asText(localStorage.getItem(SHARED_PROJECT_STORAGE_KEY));
    const selectedById = sharedProjectId === preview.projectId;
    const selectedByName =
      normalizeProjectRelationKey(sharedProjectName) === normalizeProjectRelationKey(preview.oldName);

    if (selectedById || selectedByName) {
      localStorage.setItem(SHARED_PROJECT_STORAGE_KEY, preview.nextName);
      localStorage.setItem(SHARED_PROJECT_ID_STORAGE_KEY, String(preview.projectId));
    }
  } catch (_error) {}
}

async function handleConfirmProjectUpdate() {
  const preview = pendingProjectUpdatePreview;
  if (!preview) {
    setProjectEditStatus('Aucun aperçu à appliquer.', 'warning');
    return;
  }

  setProjectEditBusy(true);
  setProjectEditStatus('Revalidation des données avant application...');
  try {
    const freshPreview = await buildProjectUpdatePreview({
      projectId: preview.projectId,
      nextName: preview.nextName,
      nextNumber: preview.nextNumber,
    });

    if (freshPreview.signature !== preview.signature) {
      pendingProjectUpdatePreview = null;
      document.getElementById('projectUpdateDialog').close();
      setProjectEditStatus(
        'Les données liées ont changé depuis l’aperçu. Relance la prévisualisation.',
        'warning'
      );
      return;
    }

    setProjectEditStatus(`Application de ${freshPreview.actions.length} modification(s)...`);
    await grist.docApi.applyUserActions(freshPreview.actions);

    updateSharedProjectSelectionAfterRename(freshPreview);
    emitProjectDataChange('project-renamed', freshPreview.projectId);
    pendingProjectUpdatePreview = null;
    document.getElementById('projectUpdateDialog').close();

    const selectedDopProjectKey = document.getElementById('dopProjectSelect')?.value || '';
    const projectsReloaded = await loadProjectsForDop(
      selectedDopProjectKey,
      String(freshPreview.projectId)
    );
    if (projectsReloaded) {
      setProjectEditStatus(
        `Projet mis à jour : ${freshPreview.actions.length} ligne(s) modifiée(s).`,
        'success'
      );
    } else {
      setProjectEditStatus(
        `Projet mis à jour (${freshPreview.actions.length} ligne(s)), ` +
        `mais la liste des projets n'a pas pu être rechargée.`,
        'warning'
      );
    }
  } finally {
    setProjectEditBusy(false);
  }
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

async function loadProjectsForDop(selectedProjectKey = '', selectedEditProjectKey = '') {
  try {
    const snapshot = await fetchTableSnapshot(PROJECTS_TABLE);
    if (!hasColumn(snapshot.columnNames, PROJECT_NAME_COLUMN)) {
      projectRecords = [];
      populateProjectSelect('');
      populateProjectEditSelect('');
      setDopStatus('Colonne Nom_de_projet introuvable dans Projets2.', 'error');
      setProjectEditStatus('Colonne Nom_de_projet introuvable dans Projets2.', 'error');
      return false;
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
    populateProjectEditSelect(selectedEditProjectKey);
    return true;
  } catch (error) {
    console.error('Erreur chargement projets DOP:', error);
    projectRecords = [];
    populateProjectSelect('');
    populateProjectEditSelect('');
    setDopStatus(`Erreur chargement projets : ${error.message}`, 'error');
    setProjectEditStatus(`Erreur chargement projets : ${error.message}`, 'error');
    return false;
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
  const projectEditSelect = document.getElementById('projectEditSelect');
  const projectNameInput = document.getElementById('projectNameInput');
  const projectNumberInput = document.getElementById('projectNumberInput');
  const previewProjectUpdateButton = document.getElementById('previewProjectUpdateButton');
  const projectUpdateDialog = document.getElementById('projectUpdateDialog');
  const confirmProjectUpdateButton = document.getElementById('confirmProjectUpdateButton');
  const cancelProjectUpdateButton = document.getElementById('cancelProjectUpdateButton');

  tableBody.addEventListener('click', event => {
    const toggleButton = event.target.closest('.group-toggle');
    if (toggleButton) {
      toggleCollapsedGroup(
        toggleButton.dataset.groupType,
        toggleButton.dataset.groupKey,
        toggleButton
      );
      return;
    }

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
  if (editMemberButton) {
    editMemberButton.addEventListener('click', openEditDialog);
  }
  if (deleteMemberButton) {
    deleteMemberButton.addEventListener('click', async () => {
      try {
        await deleteSelectedRecord();
      } catch (error) {
        console.error('Error deleting record:', error);
        alert('Une erreur est survenue pendant la suppression du membre.');
      }
    });
  }

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

  projectEditSelect.addEventListener('change', () => {
    syncProjectEditFieldsFromSelection();
    setProjectEditStatus('');
  });
  [projectNameInput, projectNumberInput].forEach((input) => {
    input.addEventListener('input', () => {
      pendingProjectUpdatePreview = null;
      updateProjectEditControls();
    });
  });
  previewProjectUpdateButton.addEventListener('click', () => {
    handlePreviewProjectUpdate().catch((error) => {
      console.error('Erreur prévisualisation modification projet:', error);
      pendingProjectUpdatePreview = null;
      setProjectEditStatus(`Modification impossible : ${error.message}`, 'error');
      setProjectEditBusy(false);
    });
  });
  confirmProjectUpdateButton.addEventListener('click', () => {
    handleConfirmProjectUpdate().catch((error) => {
      console.error('Erreur modification projet:', error);
      setProjectEditStatus(`Erreur pendant la modification : ${error.message}`, 'error');
      setProjectEditBusy(false);
    });
  });
  cancelProjectUpdateButton.addEventListener('click', () => {
    pendingProjectUpdatePreview = null;
    projectUpdateDialog.close();
    updateProjectEditControls();
  });
  projectUpdateDialog.addEventListener('cancel', (event) => {
    if (projectEditInProgress) {
      event.preventDefault();
      return;
    }
    pendingProjectUpdatePreview = null;
    updateProjectEditControls();
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
  updateProjectEditControls();
  Promise.all([loadDopRegistry(), loadProjectsForDop()]).catch(error => {
    console.error('Erreur initialisation DOP:', error);
    setDopStatus(`Erreur initialisation DOP : ${error.message}`, 'error');
    setProjectEditStatus(`Erreur initialisation projets : ${error.message}`, 'error');
  });
});

grist.ready({ requiredAccess: 'full' });
grist.onRecords(function(initialRecords) {
  records = normalizeFetchTableResult(initialRecords);
  populateTable();
});
