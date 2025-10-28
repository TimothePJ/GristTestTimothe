let records = [];
let selectedRecordId = null;

function populateTable() {
  const tableBody = document.getElementById('tableBody');
  tableBody.innerHTML = '';
  records.forEach(record => {
    const row = document.createElement('tr');
    row.dataset.recordId = record.id;
    row.innerHTML = `
      <td>${record.Prenom || ''}</td>
      <td>${record.Nom || ''}</td>
      <td>${record.Email || ''}</td>
      <td>${record.Service || ''}</td>
      <td>${record.IdTrefle || ''}</td>
    `;
    tableBody.appendChild(row);
  });
}

function showContextMenu(event) {
  event.preventDefault();
  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;

  const row = event.target.closest('tr');
  if (row) {
    selectedRecordId = row.dataset.recordId;
    document.getElementById('editOption').style.display = 'block';
    document.getElementById('deleteOption').style.display = 'block';
  } else {
    selectedRecordId = null;
    document.getElementById('editOption').style.display = 'none';
    document.getElementById('deleteOption').style.display = 'none';
  }
}

function hideContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('tableBody');
  const addRowDialog = document.getElementById('addRowDialog');
  const editRowDialog = document.getElementById('editRowDialog');
  const addRowOption = document.getElementById('addRowOption');
  const editOption = document.getElementById('editOption');
  const deleteOption = document.getElementById('deleteOption');
  const cancelAddRowButton = document.getElementById('cancelAddRowButton');

  tableBody.addEventListener('contextmenu', showContextMenu);
  document.addEventListener('click', hideContextMenu);

  addRowOption.addEventListener('click', () => {
    addRowDialog.showModal();
    hideContextMenu();
  });

  cancelAddRowButton.addEventListener('click', () => {
    addRowDialog.close();
  });

  addRowDialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const newRecord = {
      Prenom: formData.get('prenom'),
      Nom: formData.get('nom'),
      Email: formData.get('email'),
      Service: formData.get('service'),
      IdTrefle: formData.get('idTrefle'),
    };
    try {
      await grist.docApi.applyUserActions([['AddRecord', 'Team', null, newRecord]]);
      addRowDialog.close();
    } catch (error) {
      console.error('Error adding record:', error);
    }
  });

  editOption.addEventListener('click', () => {
    if (!selectedRecordId) return;
    const record = records.find(r => r.id == selectedRecordId);
    if (record) {
      document.getElementById('editPrenom').value = record.Prenom || '';
      document.getElementById('editNom').value = record.Nom || '';
      document.getElementById('editEmail').value = record.Email || '';
      document.getElementById('editService').value = record.Service || '';
      document.getElementById('editIdTrefle').value = record.IdTrefle || '';
      editRowDialog.showModal();
    }
    hideContextMenu();
  });

  editRowDialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedRecordId) return;
    const formData = new FormData(event.target);
    const updatedFields = {
      Prenom: formData.get('editPrenom'),
      Nom: formData.get('editNom'),
      Email: formData.get('editEmail'),
      Service: formData.get('editService'),
      IdTrefle: formData.get('editIdTrefle'),
    };
    try {
      await grist.docApi.applyUserActions([['UpdateRecord', 'Team', parseInt(selectedRecordId, 10), updatedFields]]);
      editRowDialog.close();
    } catch (error) {
      console.error('Error updating record:', error);
    }
  });

  deleteOption.addEventListener('click', async () => {
    if (!selectedRecordId) return;
    if (confirm('Are you sure you want to delete this record?')) {
      try {
        await grist.docApi.applyUserActions([['RemoveRecord', 'Team', parseInt(selectedRecordId, 10)]]);
      } catch (error) {
        console.error('Error deleting record:', error);
      }
    }
    hideContextMenu();
  });
});

grist.ready();
grist.onRecords(function(initialRecords) {
  records = initialRecords;
  populateTable();
});
