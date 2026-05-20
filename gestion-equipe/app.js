const TEAM_TABLE = 'Team';

let records = [];
let selectedRecordId = null;

function asText(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return asText(value).toLowerCase();
}

function normalizeIdTrefle(value) {
  return asText(value);
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
    alert(`Impossible d'enregistrer ce membre : l'email et l'IdTrefle existent déjà pour ${duplicateName}.`);
    return;
  }

  if (duplicateEmail) {
    alert(`Impossible d'enregistrer ce membre : l'email existe déjà pour ${duplicateName}.`);
    return;
  }

  alert(`Impossible d'enregistrer ce membre : l'IdTrefle existe déjà pour ${duplicateName}.`);
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
      alert("Une erreur est survenue pendant la suppression du membre.");
    }
  });

  addRowOption.addEventListener('click', openAddDialog);
  editOption.addEventListener('click', openEditDialog);
  deleteOption.addEventListener('click', async () => {
    try {
      await deleteSelectedRecord();
    } catch (error) {
      console.error('Error deleting record:', error);
      alert("Une erreur est survenue pendant la suppression du membre.");
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
      alert("Une erreur est survenue pendant la modification du membre.");
    }
  });

  updateActionButtons();
});

grist.ready();
grist.onRecords(function(initialRecords) {
  records = initialRecords;
  populateTable();
});
