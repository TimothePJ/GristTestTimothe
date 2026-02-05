
// --- Global helpers guard (ensures availability even if earlier patches moved code) ---
(function () {
  if (typeof window !== 'undefined') {
    if (typeof window.normalizeNumeroRaw === 'undefined') {
      window.normalizeNumeroRaw = function (v) {
        if (v == null) return null;
        const s = String(v).trim();
        return (s === '' || s === '-' || s === '_') ? null : s;
      };
    }
    if (typeof window.numeroSortable === 'undefined') {
      window.numeroSortable = function (v) {
        const s = window.normalizeNumeroRaw(v);
        if (s == null) return Infinity;
        const n = Number(s);
        return Number.isFinite(n) ? n : Infinity;
      };
    }
    if (typeof window.parseNumeroForStorage === 'undefined') {
      window.parseNumeroForStorage = function (v) {
        if (v === 0 || v === '0') return 0;
        if (v == null) return null;
        const s = String(v).trim();
        if (s === '' || s === '-' || s === '_') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
    }
    if (typeof window.numeroOrZero === 'undefined') {
      window.numeroOrZero = function (v) {
        return (v == null ? 0 : v);
      };
    }
  } else {
    if (typeof normalizeNumeroRaw === 'undefined') {
      var normalizeNumeroRaw = function (v) {
        if (v == null) return null;
        const s = String(v).trim();
        return (s === '' || s === '-' || s === '_') ? null : s;
      };
    }
    if (typeof numeroSortable === 'undefined') {
      var numeroSortable = function (v) {
        const s = normalizeNumeroRaw(v);
        if (s == null) return Infinity;
        const n = Number(s);
        return Number.isFinite(n) ? n : Infinity;
      };
    }
    if (typeof parseNumeroForStorage === 'undefined') {
      var parseNumeroForStorage = function (v) {
        if (v === 0 || v === '0') return 0;
        if (v == null) return null;
        const s = String(v).trim();
        if (s === '' || s === '-' || s === '_') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
    }
    if (typeof numeroOrZero === 'undefined') {
      var numeroOrZero = function (v) { return (v == null ? 0 : v); };
    }
  }
})();
// --- End helpers guard ---



// Storage-normalizer: preserves 0, returns number if numeric string, else null

// Coerce null/undefined to 0 for storage, keep 0 as 0
function numeroOrZero(v) {
  return (v == null ? 0 : v);
}
function parseNumeroForStorage(v) {
  if (v === 0 || v === '0') return 0;
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '_') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}


/* === Column normalization shim (DescriptionObservations, typos) === */
(function () {
  function normalizeCols(cols) {
    if (!cols || typeof cols !== 'object') return cols;
    const map = new Map([
      ['descriptionobservationss', 'DescriptionObservations'],
      ['descriptionobservation', 'DescriptionObservations'],
      ['descriptionobservations', 'DescriptionObservations'],
      ['description', 'DescriptionObservations'],
    ]);
    const out = {};
    for (const [k, v] of Object.entries(cols)) {
      const ck = String(k).toLowerCase();
      out[map.get(ck) || k] = v;
    }
    return out;
  }
  function patchGrist() {
    try {
      if (window.grist && grist.docApi && typeof grist.docApi.applyUserActions === 'function') {
        const _apply = grist.docApi.applyUserActions.bind(grist.docApi);
        grist.docApi.applyUserActions = function (actions) {
          const fixed = (actions || []).map(a => {
            if (Array.isArray(a) && a.length >= 4) a[3] = normalizeCols(a[3]);
            return a;
          });
          return _apply(fixed);
        };
      }
    } catch (e) { }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') patchGrist();
  else window.addEventListener('DOMContentLoaded', patchGrist);
})();
/* === end shim === */

// Variable pour stocker l'émetteur capturé depuis le menu contextuel
let currentContextMenuEmitter = '';

// Fonction pour afficher le menu contextuel et capturer l'émetteur de la ligne
function showContextMenu(event, recordId) {
  event.preventDefault();

  const record = records.find(r => r.id === recordId); // Trouver la ligne cliquée
  if (record) {
    currentContextMenuEmitter = record.Emetteur; // Capturer l'émetteur de la ligne cliquée
  }

  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
}

// Cacher le menu contextuel lorsqu'on clique ailleurs
document.addEventListener('click', function (event) {
  const contextMenu = document.getElementById('contextMenu');
  const editDialog = document.getElementById('editRowDialog');
  // Si le clic est en dehors du menu contextuel
  if (!contextMenu.contains(event.target)) {
    contextMenu.style.display = 'none';
    if (!editDialog.open) {
      document.querySelectorAll('#tableBody tr.highlighted, #tableBody td.highlighted').forEach(el => {
        el.classList.remove('highlighted');
      });
    }
  }
});

function updateReferenceList() {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('emetteur').value || currentContextMenuEmitter;
  const referenceList = document.getElementById('referenceList');

  // Vérifier si le projet et l'émetteur sont valides
  if (!selectedProject || !selectedEmitter) {
    referenceList.innerHTML = '';
    return;
  }

  // Vider la liste existante
  referenceList.innerHTML = '';

  // 1) Option par défaut "_"
  const defaultOption = document.createElement('option');
  defaultOption.value = '_';    // La valeur qu'on veut proposer
  referenceList.appendChild(defaultOption);

  // 2) Puis insérer les références filtrées
  const filteredReferences = records
    .filter(record => record.NomProjet === selectedProject && record.Emetteur === selectedEmitter)
    .map(record => record.Reference)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { ignorePunctuation: true }));

  filteredReferences.forEach(reference => {
    const option = document.createElement('option');
    option.value = reference;
    referenceList.appendChild(option);
  });
}

// Fonction pour remplir automatiquement les champs en fonction de la référence sélectionnée
function autoFillFields() {
  const selectedReference = document.getElementById('referenceInput').value;
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('emetteur').value || currentContextMenuEmitter;

  if (!selectedReference || !selectedProject || !selectedEmitter) {
    return;
  }

  // Si c'est "_", on remplit avec les valeurs par défaut
  if (selectedReference === '_') {
    document.getElementById('indice').value = '-';
    document.getElementById('recu').value = '1900-01-01';
    document.getElementById('description').value = 'EN ATTENTE';
    document.getElementById('datelimite').value = '1900-01-01';
    return;
  }

  // Sinon, on cherche un enregistrement dans `records` pour autofill
  const matchingRecord = records.find(record =>
    record.NomProjet === selectedProject &&
    record.Emetteur === selectedEmitter &&
    record.Reference === selectedReference
  );

  function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
  }

  if (matchingRecord) {
    // Remplir avec les infos réelles
    document.getElementById('indice').value = matchingRecord.Indice || '';
    document.getElementById('description').value = matchingRecord.DescriptionObservations || '';
    document.getElementById('recu').value = formatDateForInput(matchingRecord.Recu);
    document.getElementById('datelimite').value = formatDateForInput(matchingRecord.DateLimite);
  } else {
    // Rien trouvé -> vider les champs (ou gérer autrement)
    document.getElementById('indice').value = '';
    document.getElementById('description').value = '';
    document.getElementById('recu').value = '';
    document.getElementById('datelimite').value = '';
  }
}

// Fonction pour réinitialiser le formulaire et actualiser les références à chaque ouverture
function resetAndUpdateDialog() {
  const addRowDialog = document.getElementById('addRowDialog');
  const inputs = addRowDialog.querySelectorAll('input, textarea, select');

  // Réinitialiser tous les champs sauf "emetteur"
  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.checked = false;
    } else if (input.id !== 'emetteur') {
      input.value = '';
    }
  });

  const duplicateOptionsContainer = document.getElementById('duplicateOptionsContainer');
  duplicateOptionsContainer.style.display = 'none';
  duplicateOptionsContainer.innerHTML = '';

  document.getElementById('emetteur').value = currentEmetteur;
  updateReferenceList();
}

// Réinitialiser et actualiser les références à chaque ouverture du dialogue
document.getElementById('addRowDialog').addEventListener('show', resetAndUpdateDialog);

// Mise à jour de la liste des références lorsqu'on change le projet ou l'émetteur
document.getElementById('firstColumnDropdown').addEventListener('change', updateReferenceList);
document.getElementById('emetteur').addEventListener('change', updateReferenceList);

// Auto-remplissage des champs lors de la sélection ou de la saisie d'une référence
document.getElementById('referenceInput').addEventListener('input', autoFillFields);

// Gestion de l'importation de fichiers pour remplir la référence
document.getElementById('referenceFile').addEventListener('change', function () {
  if (this.files.length > 0) {
    const fileName = this.files[0].name;
    document.getElementById('referenceInput').value = removeFileExtension(fileName);
  }
});


// === Separator between original <script> blocks ===


// window.alert = function () {
//   debugger;
// }
let records = [];
let selectedFirstValue = '';
let selectedSecondValue = '';
let selectedDocNumber = null; let selectedDocName = '';


// --- helper: reads the selected pair from the 2nd dropdown at commit time ---
function getSelectedDocPair() {
  const el = document.getElementById('secondColumnListbox');
  if (!el) return { numero: null, name: '' };
  const parsed = parseDocValue(el.value);
  // keep raw for display; use parseNumeroForStorage for DB when needed
  return { numero: parsed.numero, name: parsed.name };
}

function parseDocValue(raw) {
  if (!raw) return { numero: null, name: '' };
  try {
    const obj = JSON.parse(raw);
    if (obj && (obj.n != null || obj.numero != null || obj.name != null || obj.nom != null)) {
      const numero = obj.n != null ? obj.n : (obj.numero != null ? obj.numero : null);
      const name = obj.name != null ? obj.name : (obj.nom != null ? obj.nom : '');
      return { numero: numero != null ? Number(numero) : null, name: String(name).trim() };
    }
  } catch (e) { }
  // No regex fallback here: raw is treated entirely as a name
  return { numero: null, name: String(raw).trim() };
}

function makeDocLabel(name, numero) {
  const nm = (name ?? '').toString().trim();
  // numéro affiché si présent; 0 est une valeur VALIDE
  let show;
  if (numero === 0 || numero === '0') {
    show = '0';
  } else if (numero == null) {
    show = null;
  } else {
    const s = String(numero).trim();
    show = (s === '' || s === '-' || s === '_') ? null : s;
  }
  return (show !== null) ? `${show} ${nm}` : nm;  // numero PUIS nom
}
function docLabelFromRecord(record) {
  const nm = record && record.NomDocument ? record.NomDocument : '';
  const num = (record && record.NumeroDocument != null) ? record.NumeroDocument : null;
  return makeDocLabel(nm, num);
}

let currentEmetteur = '';
let selectedRecordId = null;
let newTable = false; // Variable to track if a new table is being added
let newTableName = ''; // Variable to store the name of the new table
let lastValidDocument = '';

// Ready Grist
grist.ready();

// Variable globale pour stocker les enregistrements de la table "Team"
let teamRecords = [];

// Lorsque les enregistrements de la table sont disponibles, on les stocke
grist.onRecords((records, tableId) => {
  if (tableId === "Team") {
    teamRecords = records;
    console.log("Team records loaded :", teamRecords);
  }
});

async function refreshProjectsDropdownFromProjets() {
  try {
    const projets = await grist.docApi.fetchTable('Projets');

    // ✅ Colonne "Projet" (comme ton JSON)
    const values = (projets.Nom_de_projet || [])
      .map(v => (typeof v === "string" ? v.trim() : v))
      .filter(Boolean);

    const unique = [...new Set(values)];
    populateFirstColumnDropdown(unique);
  } catch (err) {
    console.error("Erreur chargement Projets pour dropdown:", err);
  }
}

// Fonction pour peupler la première liste déroulante avec des valeurs uniques de la première colonne
function populateFirstColumnDropdown(values) {
  const dropdown = document.getElementById('firstColumnDropdown');

  // Conserve la sélection actuelle
  const currentSelection = dropdown.value;

  // Trier les valeurs par ordre alphabétique
  values.sort((a, b) => a.localeCompare(b));

  dropdown.innerHTML = '<option value="">Selectionner un projet</option>'; // Réinitialise la liste déroulante

  values.forEach(value => {
    if (value) {  // Ignore les valeurs nulles ou vides
      const option = document.createElement('option');
      option.value = value;
      option.text = value;
      dropdown.appendChild(option);
    }
  });

  // Restaure la sélection précédente si elle est encore présente dans les options
  dropdown.value = currentSelection || ''; // Conserve l'option sélectionnée ou reste sur "Select an option"
}

// Réinitialise et désactive la seconde liste si aucun projet n'est sélectionné
document.getElementById('firstColumnDropdown').addEventListener('change', function () {
  const secondDropdown = document.getElementById('secondColumnListbox');
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');

  selectedFirstValue = this.value.trim();

  if (!selectedFirstValue) {
    secondDropdown.disabled = true; // Désactiver la seconde liste
    secondDropdown.innerHTML = '<option value="">Sélectionner un étage</option>';
    tableBody.innerHTML = '';
    tableHeader.innerHTML = '';
    return;
  }

  secondDropdown.disabled = false; // Activer la seconde liste si un projet est sélectionné
  populateSecondColumnListbox(selectedFirstValue); // Actualiser la liste
  updateEmetteurList();
  secondDropdown.value = '';
  selectedSecondValue = '';
  tableBody.innerHTML = '';
  tableHeader.innerHTML = '';
});

// Function to populate the second dropdown based on the selected first column value
function populateSecondColumnListbox(selectedValue) {
  const listbox = document.getElementById('secondColumnListbox');
  listbox.innerHTML = '<option value="">Sélectionner un étage</option>'; // Réinitialise la liste

  const secondColumnValues = records
    .filter(record => record.NomProjet === selectedValue) // Filtre selon le projet
    .map(record => record.NomDocument) // Extrait les valeurs
    .filter((value, index, self) => value && self.indexOf(value) === index) // Supprime les doublons
    .sort();

  secondColumnValues.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.text = value;
    listbox.appendChild(option);
  });

  // Ajoute l'option "Ajouter document"
  const addOption = document.createElement('option');
  addOption.value = 'addTable';
  addOption.text = 'Ajouter document';
  listbox.appendChild(addOption);

  // Ajoute l'option "Ajouter Plusieurs document"
  const addMultipleOption = document.createElement('option');
  addMultipleOption.value = 'addMultipleTable';
  addMultipleOption.text = 'Ajouter Plusieurs document';
  listbox.appendChild(addMultipleOption);
}


// Helper function to check if a string is a valid date
function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

// Helper function to format date as DD/MM/YYYY
function formatDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Add event listener for archive toggle checkbox
document.getElementById('hideArchivedToggle').addEventListener('change', () => { populateSecondColumnListbox(selectedFirstValue); populateTable(); });

// Function to populate the table based on the selected first and second column values
function populateTable() {
  const selections = getCurrentSelections();
  if (!selections) return;

  const { selectedProject, selectedTable } = selections;
  const tableBody = document.getElementById('tableBody');
  const tableHeader = document.getElementById('tableHeader');
  const hideArchived = document.getElementById('hideArchivedToggle').checked;

  tableBody.innerHTML = '';
  const filteredRecords = records.filter(
    (record) =>
      record.NomProjet === selectedProject &&
      record.NomDocument === selectedTable &&
      (!hideArchived || !record.Archive)
  );

  if (filteredRecords.length === 0) return;

  const headers = Object.keys(filteredRecords[0]).filter(
    (key) => key !== 'NomProjet' && key !== 'NomDocument' && key !== 'id'
  );

  tableHeader.innerHTML = '<th>ID</th>';
  headers.forEach((header) => {
    const th = document.createElement('th');
    th.textContent = header;
    tableHeader.appendChild(th);
  });
  // Add click handler for Bloquant column
  tableHeader.querySelector('th:nth-child(2)').addEventListener('click', (e) => {
    if (e.target.textContent === 'Bloquant') {
      // Toggle all Bloquant values
      const rows = tableBody.querySelectorAll('tr');
      rows.forEach(row => {
        const cell = row.querySelector('td:nth-child(2)');
        if (cell) {
          cell.click();
        }
      });
    }
  });

  filteredRecords.sort((a, b) => {
    const emetteurA = a.Emetteur || '';
    const emetteurB = b.Emetteur || '';
    return emetteurA.localeCompare(emetteurB);
  });

  filteredRecords.forEach((record) => {
    const tr = document.createElement('tr');
    tr.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      currentEmetteur = record.Emetteur;
      showContextMenu(event, record.id);

      // Retirer la surbrillance de toutes les lignes et de toutes les cellules émetteur
      document.querySelectorAll('#tableBody tr').forEach(row => {
        row.classList.remove('highlighted');
        if (row.cells[1]) {
          row.cells[1].classList.remove('highlighted');
        }
      });

      // Appliquer la surbrillance à la ligne cliquée pour les autres colonnes
      tr.classList.add('highlighted');

      // Pour la colonne "Emetteur" :
      // Si la cellule dans la ligne cliquée est masquée (fusionnée),
      // rechercher la cellule visible (dans la première ligne du groupe).
      let emitterCell = tr.cells[1];
      if (getComputedStyle(emitterCell).display === "none") {
        let currentRow = tr;
        // Parcourir les lignes précédentes jusqu'à trouver la cellule émetteur visible
        while (currentRow && getComputedStyle(currentRow.cells[1]).display === "none") {
          currentRow = currentRow.previousElementSibling;
        }
        if (currentRow && currentRow.cells[1]) {
          currentRow.cells[1].classList.add('highlighted');
        }
      } else {
        // Sinon, surligner directement la cellule de la ligne cliquée
        emitterCell.classList.add('highlighted');
      }
    });

    const idCell = document.createElement('td');
    idCell.textContent = record.id;
    tr.appendChild(idCell);

    headers.forEach((header, index) => {
      const td = document.createElement('td');
      td.contentEditable = false;
      let value = record[header] || '';

      // Format date fields (Recu and DateLimite)
      if ((header === 'Recu' || header === 'DateLimite') && isValidDate(value)) {
        const formattedDate = formatDate(value);
        value = formattedDate === '01/01/1900' ? '-' : formattedDate;
      }

      // Special handling for Bloquant and Archive columns
      if (header === 'Bloquant') {
        td.classList.add('bloquant-cell');
        td.textContent = value ? '✓' : '';
        td.addEventListener('click', async () => {
          const newValue = !value;
          try {
            await grist.docApi.applyUserActions([
              ['UpdateRecord', 'References', record.id, { Bloquant: newValue }]
            ]);
            td.textContent = newValue ? '✓' : '';
          } catch (error) {
            console.error('Error updating Bloquant:', error);
          }
        });
      } else if (header === 'Archive') {
        td.classList.add('archive-cell');
        td.textContent = value ? '✓' : '';
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  });
  formatTable();
}

function formatTable() {
  const tableBody = document.getElementById('tableBody');
  const rows = tableBody.rows;
  let previousText = null;
  let rowspanCount = 1;

  for (let i = 0; i < rows.length; i++) {
    const currentCell = rows[i].cells[1]; // Second column

    if (currentCell.innerText === previousText) {
      // Increase rowspan count and hide current cell
      rows[i - rowspanCount].cells[1].rowSpan = rowspanCount + 1; // Update rowspan
      currentCell.style.display = "none"; // Hide current cell
      rowspanCount++;
    } else {
      // Reset rowspan count
      previousText = currentCell.innerText;
      rowspanCount = 1;
    }
  }
}

// Show edit dialog with row data
function showEditDialog(record) {
  const dialog = document.getElementById('editRowDialog');

  if (!record) {
    console.warn("Aucun enregistrement sélectionné pour modification.");
    return;
  }
  console.log("Enregistrement en cours de modification :", record);

  // --- Convertir la date en format YYYY-MM-DD si besoin ---
  function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
  }

  // Assigne D'ABORD l'émetteur au champ "editEmetteur".
  document.getElementById('editEmetteur').value = record.Emetteur || '';

  // Met à jour la liste des références APRÈS avoir défini l'émetteur.
  updateEditReferenceList();

  // Maintenant on peut remplir la référence et les autres champs.
  document.getElementById('editReference').value = record.Reference || '';
  document.getElementById('editIndice').value = record.Indice || '';
  document.getElementById('editDescription').value = record.DescriptionObservations || '';
  document.getElementById('editRecu').value = formatDateForInput(record.Recu);
  document.getElementById('editDatelimite').value = formatDateForInput(record.DateLimite);

  dialog.showModal();
}

// Gestion du menu contextuel et récupération de l'émetteur
function showContextMenu(event, recordId) {
  event.preventDefault();
  selectedRecordId = recordId; // Stocke l'ID de la ligne sélectionnée

  // Récupère l'émetteur de la ligne cliquée
  const matchingRecord = records.find(record => record.id === recordId);
  if (matchingRecord) {
    currentEmetteur = matchingRecord.Emetteur;
  }

  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
}

// Add event listener for "Ajouter une ligne" option
document.getElementById('addRowOption').addEventListener('click', () => {
  resetAndUpdateDialog();
  document.getElementById('addRowDialog').showModal();
  hideContextMenu();
});

function updateEditReferenceList() {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('editEmetteur').value;
  const referenceList = document.getElementById('editReferenceList');

  if (!selectedProject || !selectedEmitter) {
    referenceList.innerHTML = '';
    return;
  }

  referenceList.innerHTML = '';

  // Ajouter la proposition "_"
  const defaultOption = document.createElement('option');
  defaultOption.value = '_';
  referenceList.appendChild(defaultOption);

  const filteredReferences = records
    .filter(record => record.NomProjet === selectedProject && record.Emetteur === selectedEmitter)
    .map(record => record.Reference)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { ignorePunctuation: true }));

  filteredReferences.forEach(reference => {
    const option = document.createElement('option');
    option.value = reference;
    referenceList.appendChild(option);
  });
}

function autoFillEditFields() {
  const selectedReference = document.getElementById('editReference').value;
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const selectedEmitter = document.getElementById('editEmetteur').value;

  if (!selectedReference || !selectedProject || !selectedEmitter) {
    return;
  }

  // Si "_" => valeurs par défaut
  if (selectedReference === '_') {
    document.getElementById('editIndice').value = '-';
    document.getElementById('editDescription').value = 'EN ATTENTE';
    document.getElementById('editRecu').value = '1900-01-01';
    document.getElementById('editDatelimite').value = '1900-01-01';
    return;
  }

  // Sinon chercher le record correspondant
  const matchingRecord = records.find(record =>
    record.NomProjet === selectedProject &&
    record.Emetteur === selectedEmitter &&
    record.Reference === selectedReference
  );

  function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
  }

  if (matchingRecord) {
    document.getElementById('editIndice').value = matchingRecord.Indice || '';
    document.getElementById('editDescription').value = matchingRecord.DescriptionObservations || '';
    document.getElementById('editRecu').value = formatDateForInput(matchingRecord.Recu);
    document.getElementById('editDatelimite').value = formatDateForInput(matchingRecord.DateLimite);
  } else {
    // Aucun matchingRecord -> vider ou laisser par défaut
    document.getElementById('editIndice').value = '';
    document.getElementById('editDescription').value = '';
    document.getElementById('editRecu').value = '';
    document.getElementById('editDatelimite').value = '';
  }
}

// Mise à jour de la liste des références lorsqu'on change le projet ou l'émetteur
document.getElementById('firstColumnDropdown').addEventListener('change', updateEditReferenceList);
document.getElementById('editEmetteur').addEventListener('change', updateEditReferenceList);

// Auto-remplissage des champs lors de la sélection ou de la saisie d'une référence
document.getElementById('editReference').addEventListener('input', autoFillEditFields);

// Gestion de l’importation de fichiers pour remplir la référence
document.getElementById('editReferenceFile').addEventListener('change', function () {
  if (this.files.length > 0) {
    const fileName = this.files[0].name;
    document.getElementById('editReference').value = removeFileExtension(fileName);
  }
});

// Add event listener for "Modifier" option
document.getElementById('editOption').addEventListener('click', () => {
  // Masquer le menu contextuel
  document.getElementById('contextMenu').style.display = 'none';

  if (selectedRecordId) {
    const record = records.find(rec => rec.id === selectedRecordId);
    if (record) {
      updateEmetteurList(false, "editEmetteurList");
      showEditDialog(record);
    }
  }
});

// Handle dialog form submission
document.getElementById('addRowDialog').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const emetteur = formData.get('emetteur');
  const reference = formData.get('reference');
  const indice = formData.get('indice');
  let recu = formData.get('recu'); // Peut être vide
  const description = formData.get('description');
  let datelimite = formData.get('datelimite'); // Peut être vide
  const isDuplicate = document.getElementById('duplicateCheckbox').checked;
  const cheminFromAddFile = (document.getElementById('referenceFile') && document.getElementById('referenceFile').value) ? document.getElementById('referenceFile').value : null;

  if (!recu) recu = "1900-01-01";
  if (!datelimite) datelimite = "1900-01-01";

  try {
    const projets = await grist.docApi.fetchTable('Projets');
    const projectIndex = projets.Nom_de_projet.indexOf(selectedFirstValue);
    if (projectIndex === -1) throw new Error("Projet introuvable.");
    const projectId = projets.id[projectIndex];

    const serviceValue = await getTeamService();

    const userActions = [];

    if (isDuplicate) {
      const selectedDocuments = Array.from(document.querySelectorAll('input[name="documents"]:checked'))
        .map(input => input.value);

      const secondDropdown = document.getElementById('secondColumnListbox');
      const currentVal = secondDropdown.value;
      if (!selectedDocuments.includes(currentVal)) selectedDocuments.push(currentVal);

      selectedDocuments.forEach(docVal => {
        const parsedDoc = parseDocValue(docVal);
        const newRow = {
          NomProjet: projectId,
          NomDocument: parsedDoc.name,
          NumeroDocument: numeroOrZero(parseNumeroForStorage(parsedDoc.numero)),
          Emetteur: emetteur,
          Reference: reference,
          Indice: indice,
          Recu: recu,
          DescriptionObservations: description,
          DateLimite: datelimite,
          Service: serviceValue,
          Chemin: cheminFromAddFile
        };
        userActions.push(['AddRecord', 'References', null, newRow]);
      });
    } else {
      const newRow = {
        NomProjet: projectId,
        NomDocument: getSelectedDocPair().name,
        NumeroDocument: numeroOrZero(parseNumeroForStorage(getSelectedDocPair().numero)),
        Emetteur: emetteur,
        Reference: reference,
        Indice: indice,
        Recu: recu,
        DescriptionObservations: description,
        DateLimite: datelimite,
        Service: serviceValue
      };
      userActions.push(['AddRecord', 'References', null, newRow]);
    }

    await grist.docApi.applyUserActions(userActions);
    console.log("Ligne(s) ajoutée(s) avec succès.");

    document.getElementById('addRowDialog').close();
    populateTable();
  } catch (error) {
    console.error("Erreur lors de l'ajout des lignes :", error);
    alert("Erreur lors de l'ajout des lignes.");
  }
});

// Gérer l'annulation du formulaire d'ajout de ligne
document.getElementById('cancelAddRowButton').addEventListener('click', () => {
  document.getElementById('addRowDialog').close();
});

// Handle edit dialog form submission
document.getElementById('editRowDialog').addEventListener('submit', (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const updatedRow = {
    Emetteur: formData.get('editEmetteur'),
    Reference: formData.get('reference'),
    Indice: formData.get('indice'),
    Recu: formData.get('recu'),
    DescriptionObservations: formData.get('description'),
    DateLimite: formData.get('datelimite')
  };

  // Handle file upload if a file was selected
  const fileInput = document.getElementById('editReferenceFile');
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    updatedRow.Reference = file.name;
    updatedRow.Chemin = fileInput.value || null;
  }

  if (selectedRecordId) {
    grist.docApi.applyUserActions([
      ['UpdateRecord', 'References', selectedRecordId, updatedRow]
    ])
      .then(() => {
        console.log('Row updated successfully');
        document.getElementById('editRowDialog').close();
        populateTable();
      })
      .catch(error => {
        console.error("Error updating row:", error);
        alert("Error updating row.");
      });
  }
});

// Add event listener for "Archiver" option
document.getElementById('archiveOption').addEventListener('click', () => {
  if (selectedRecordId) {
    if (confirm("Êtes-vous sûr de vouloir archiver cette ligne ?")) {
      grist.docApi.applyUserActions([
        ['UpdateRecord', 'References', selectedRecordId, { Archive: true }]
      ])
        .then(() => {
          console.log('Row archived successfully');
          populateTable();
          hideContextMenu();
        })
        .catch(error => {
          console.error("Error archiving row:", error);
          alert("Error archiving row.");
        });
    }
  }
});

document.getElementById('deleteOption').addEventListener('click', async () => {
  if (!selectedRecordId) {
    console.warn("Aucune ligne sélectionnée pour suppression.");
    return;
  }

  // Demande de confirmation
  const confirmDelete = confirm("Êtes-vous sûr de vouloir supprimer cette ligne ?");
  if (!confirmDelete) {
    console.log("Suppression annulée par l'utilisateur.");
    return;
  }

  // Demander un mot de passe avant de supprimer
  const password = prompt("Veuillez entrer le mot de passe pour supprimer cette ligne :");

  const correctPassword = "admin";

  if (password !== correctPassword) {
    alert("Mot de passe incorrect. Suppression annulée.");
    console.warn("Tentative de suppression avec un mot de passe incorrect.");
    return;
  }

  // Suppression après validation du mot de passe
  try {
    await grist.docApi.applyUserActions([
      ['RemoveRecord', 'References', selectedRecordId]
    ]);

    console.log(`Ligne ${selectedRecordId} supprimée avec succès.`);
    populateTable(); // Rafraîchir la table
    hideContextMenu();
  } catch (error) {
    console.error("Erreur lors de la suppression de la ligne :", error);
    alert("Une erreur s'est produite lors de la suppression.");
  }
});

// Fonction pour cacher le menu contextuel
function hideContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  contextMenu.style.display = 'none';

  // Supprime la surbrillance de toutes les lignes et de toutes les cellules (colonnes)
  document.querySelectorAll('#tableBody tr.highlighted, #tableBody td.highlighted').forEach(el => {
    el.classList.remove('highlighted');
  });
}

// Fetch records from Grist
grist.onRecords(function (receivedRecords) {
  console.log("Records received from Grist:", receivedRecords);

  records = receivedRecords;

  if (newTable) {
    newTable = false; // Reset the flag after handling the new table
    populateSecondColumnListbox(selectedFirstValue);
    updateEmetteurList(); // Met à jour la liste des émetteurs en fonction du projet sélectionné

    // Sélectionne automatiquement le nouveau tableau
    const listbox = document.getElementById('secondColumnListbox');
    listbox.value = newTableName;

    // Déclenche l'affichage du tableau correspondant
    selectedSecondValue = newTableName;
    populateTable();
  } else {
    populateTable()
    // Populate the first dropdown with unique values from 'NomProjet'
    refreshProjectsDropdownFromProjets();
  }
});

document.getElementById('secondColumnListbox').addEventListener('change', function () {
  const selectedValue = this.value;
  console.log("Tableau sélectionné :", selectedValue);
  if (selectedValue === 'addTable') {
    handleAddTable();
    return;
  }
  if (selectedValue === 'addMultipleTable') {
    handleAddMultipleTable();
    return;
  }
  // Enregistrez la sélection valide si elle n'est pas vide
  if (selectedValue.trim() !== "") {
    lastValidDocument = selectedValue;
  }
  selectedSecondValue = selectedValue;
  console.log("selectedFirstValue:", selectedFirstValue, "selectedSecondValue:", selectedSecondValue);
  if (selectedFirstValue && selectedSecondValue) {
    populateTable();
  }
});

// Fonction pour gérer l'ajout d'un tableau
function handleAddTable() {
  resetAddDocumentDialog();
  const dialog = document.getElementById('addDocumentDialog');
  dialog.showModal();
}

// Fermer la liste déroulante si on clique en dehors
document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('emetteurDropdown');
  const button = document.getElementById('emetteurDropdownButton');
  if (dropdown && button && !dropdown.contains(event.target) && !button.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

document.getElementById('addDocumentDialog').addEventListener('submit', async (e) => {
  e.preventDefault();

  trimInputs(e.target); // Nettoie les entrées (évite les espaces superflus)

  const formData = new FormData(e.target);
  const documentNumber = formData.get('documentNumber');
  const documentName = formData.get('documentName');
  let defaultDatelimite = formData.get('defaultDatelimite');

  if (!defaultDatelimite) {
    defaultDatelimite = "1900-01-01";
  }

  const combinedDocumentName = `${documentNumber}-${documentName}`.trim();

  if (!documentNumber || !documentName.trim()) {
    alert("Le numéro et le nom du document sont requis.");
    return;
  }

  const selectedEmitters = Array.from(
    document.querySelectorAll('#emetteurDropdown input[type="checkbox"]:checked')
  ).map(checkbox => {
    // Trouve l'input texte qui est juste après la case à cocher
    const textInput = checkbox.nextElementSibling;

    // Si c'est un champ texte (pour les émetteurs personnalisés)
    if (textInput && textInput.tagName === "INPUT" && textInput.type === "text") {
      const customValue = textInput.value.trim();
      return customValue ? customValue : null; // Retourne la valeur écrite, sinon null
    }

    return checkbox.value; // Pour les émetteurs standards
  }).filter(value => value); // Supprime les valeurs nulles

  if (selectedEmitters.length === 0) {
    alert("Veuillez sélectionner au moins un émetteur.");
    return;
  }

  const selectedProject = selectedFirstValue;
  if (!selectedProject) {
    alert("Veuillez sélectionner un projet avant d'ajouter un document.");
    return;
  }

  try {
    // Récupérer l'ID du projet
    const projets = await grist.docApi.fetchTable('Projets');
    const projectIndex = projets.Nom_de_projet.indexOf(selectedProject);
    if (projectIndex === -1) throw new Error("Projet introuvable.");
    const projectId = projets.id[projectIndex];

    // Récupérer le service depuis la table Team (la première ligne)
    const serviceValue = await getTeamService();

    // Création des nouvelles lignes
    const _n1 = Number(documentNumber);
    const num = (Number.isFinite(_n1) && _n1 !== 0) ? _n1 : null;
    const nm = String(documentName).trim();
    const newRows = selectedEmitters.map((emetteur) => ({
      NomProjet: projectId,
      NomDocument: nm,
      NumeroDocument: numeroOrZero(parseNumeroForStorage(num)),
      Emetteur: emetteur,
      Reference: '_',
      Indice: '-',
      Recu: '1900-01-01',
      DescriptionObservations: 'EN ATTENTE',
      DateLimite: defaultDatelimite,
      Service: serviceValue
    }));

    const actions = newRows.map(row => ['AddRecord', 'References', null, row]);
    await grist.docApi.applyUserActions(actions);

    console.log("Nouveau document ajouté :", combinedDocumentName);

    const secondDropdown = document.getElementById('secondColumnListbox');
    const newOption = document.createElement('option');
    newOption.value = JSON.stringify({ n: (Number.isFinite(Number(documentNumber)) && Number(documentNumber) !== 0 ? Number(documentNumber) : null), name: String(documentName).trim() });
    newOption.textContent = makeDocLabel(String(documentName).trim(), (Number(documentNumber) || null));

    // Ajouter à la fin de la liste avant "Ajouter document"
    const addTableOption = secondDropdown.querySelector('option[value="addTable"]');
    secondDropdown.insertBefore(newOption, addTableOption);

    secondDropdown.value = JSON.stringify({ n: (Number.isFinite(Number(documentNumber)) && Number(documentNumber) !== 0 ? Number(documentNumber) : null), name: String(documentName).trim() });
    selectedSecondValue = makeDocLabel(String(documentName).trim(), (Number(documentNumber) || null));

    // Mise à jour du tableau pour afficher les nouvelles données
    populateTable();

    // Fermeture du dialogue
    document.getElementById('addDocumentDialog').close();

  } catch (error) {
    console.error("Erreur lors de l'ajout du document :", error);
    alert("Une erreur s'est produite lors de l'ajout du document.");
  }
});

// Fonction pour convertir une date en "DD/MM/YYYY"
function formatDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return ''; // Retourne une chaîne vide si la date est invalide
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Les mois sont indexés de 0 à 11
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getCurrentSelections(isAddTableAction = false) {
  const projectDropdown = document.getElementById('firstColumnDropdown');
  const tableDropdown = document.getElementById('secondColumnListbox');

  const selectedProject = projectDropdown.value.trim();
  const selectedTable = tableDropdown.value.trim();

  if (!selectedProject || !selectedTable) {
    return null; // Retourne null si les sélections sont invalides
  }

  return { selectedProject, selectedTable };
}

// Fonction de sauvegarde mise à jour
async function saveChanges() {
  // Obtenez les sélections actuelles
  const selections = getCurrentSelections();
  if (!selections) return; // Interrompt la fonction si les sélections sont invalides

  const { selectedProject, selectedTable } = selections;

  console.log(`Sauvegarde en cours pour le tableau "${selectedTable}" du projet "${selectedProject}".`);

  // Récupère les lignes du tableau HTML
  const tableBody = document.getElementById('tableBody');
  const rows = tableBody.getElementsByTagName('tr');

  const columnMap = ['Emetteur', 'Reference', 'Indice', 'Recu', 'DescriptionObservations'];
  const updates = [];

  for (const row of rows) {
    const cells = row.getElementsByTagName('td');
    const rowId = cells[0].textContent.trim(); // ID_Ligne

    // Recherche la ligne correspondante dans `records`
    const record = records.find(
      (rec) =>
        rec.ID_Ligne === rowId &&
        rec.NomProjet === selectedProject &&
        rec.NomDocument === selectedTable
    );

    if (!record) {
      console.warn(`Ligne introuvable pour ID_Ligne = ${rowId}, Projet = ${selectedProject}, Tableau = ${selectedTable}`);
      continue;
    }

    const updatedFields = {};
    let hasChanges = false;

    // Compare chaque champ
    for (let i = 1; i < cells.length; i++) {
      const fieldName = columnMap[i - 1];
      const cellValue = cells[i].textContent.trim();

      if (record[fieldName] !== cellValue) {
        updatedFields[fieldName] = cellValue;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      updates.push(['UpdateRecord', 'Fusion', Number(rowId), updatedFields]);
    }
  }

  if (updates.length > 0) {
    try {
      await grist.docApi.applyUserActions(updates);
      console.log("Modifications sauvegardées avec succès :", updates);
      alert("Les modifications ont été sauvegardées.");
    } catch (error) {
      console.error("Erreur lors de la sauvegarde :", error);
      alert("Erreur lors de la sauvegarde.");
    }
  } else {
    alert("Aucune modification détectée pour la sauvegarde.");
  }
}

// Fonction pour ajouter une nouvelle ligne dans Grist avec le nom de fichier dans "Reference"
function addRowWithFileName(fileName, chemin) {
  if (!selectedFirstValue || !selectedSecondValue) {
    alert("Veuillez sélectionner un projet et un tableau.");
    return;
  }

  // Enlève l'extension du fichier (partie après le dernier point)
  const fileNameWithoutExtension = fileName.split('.').slice(0, -1).join('.');

  // Trouve la valeur la plus élevée d'ID_Ligne dans records
  const maxIdLigne = records.reduce((max, record) => {
    const idLigne = parseInt(record.ID_Ligne, 10);
    return idLigne > max ? idLigne : max;
  }, 0);

  // Définit une nouvelle valeur pour ID_Ligne en l'incrémentant de 1
  const newIdLigne = maxIdLigne + 1;

  // Création de la nouvelle ligne avec la valeur de ID_Ligne et le nom du fichier sans extension pour "Reference"
  const newRow = {
    NomProjet: selectedFirstValue,
    NomDocument: getSelectedDocPair().name,
    NumeroDocument: numeroOrZero(parseNumeroForStorage(getSelectedDocPair().numero)),
    Emetteur: '',
    Reference: fileNameWithoutExtension, // Nom du fichier sans extension
    Indice: '',
    Recu: '',
    DescriptionObservations: '',
    Chemin: (chemin || null),
    ID_Ligne: newIdLigne.toString() // Convertit en string pour s'aligner avec les autres valeurs
  };

  // Envoie la requête pour ajouter la nouvelle ligne dans Grist
  grist.docApi.applyUserActions([
    ['AddRecord', 'Fusion', null, newRow]
  ])
    .then(() => {
      console.log("Nouvelle ligne ajoutée avec le fichier :", newRow);
      // Actualise les données pour inclure la nouvelle ligne ajoutée
      records.push(newRow); // Mise à jour locale
      populateTable(); // Actualise l'affichage du tableau HTML
    })
    .catch(error => {
      console.error("Erreur lors de l'ajout de la ligne avec le fichier :", error);
      alert("Erreur lors de l'ajout de la ligne.");
    });
}

// Gère l'événement de sélection de fichiers
document.getElementById('fileInput').addEventListener('change', (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    Array.from(files).forEach(file => {
      addRowWithFileName(file.name); // Ajoute une ligne pour chaque fichier sélectionné
    });
  }
});

document.getElementById('addProjectButton').addEventListener('click', () => {
  document.getElementById('addProjectDialog').showModal(); // Affiche la boîte de dialogue
});

// Fonction pour supprimer les espaces en début et fin de chaque champ input
function trimInputs(form) {
  const inputs = form.querySelectorAll("input[type='text'], input[type='number']");
  inputs.forEach(input => input.value = input.value.trim());
}

// Gère l'ajout d'un projet
document.getElementById('addProjectDialog').addEventListener('submit', async (e) => {
  e.preventDefault();

  trimInputs(e.target); // Nettoyage des champs avant soumission

  const formData = new FormData(e.target);
  const projectNumber = formData.get('projectNumber');
  const projectName = formData.get('projectName');

  if (!projectNumber || !projectName.trim()) {
    alert("Le numéro et le nom du projet sont requis.");
    return;
  }

  try {
    const result = await grist.docApi.applyUserActions([
      ['AddRecord', 'Projets', null, { 'Numero_de_projet': projectNumber, 'Nom_de_projet': projectName }]
    ]);

    const newProjectId = result.retValues[0];

    const dropdown = document.getElementById('firstColumnDropdown');
    const option = document.createElement('option');
    option.value = projectName;
    option.text = projectName;
    dropdown.appendChild(option);

    dropdown.value = projectName;
    selectedFirstValue = projectName;

    // === Réinitialisation de la liste des documents et du tableau ===
    const secondDropdown = document.getElementById('secondColumnListbox');
    const tableBody = document.getElementById('tableBody');
    const tableHeader = document.getElementById('tableHeader');

    secondDropdown.innerHTML = '<option value="">Sélectionner un étage</option>';
    selectedSecondValue = ''; // Réinitialiser la sélection du document
    tableBody.innerHTML = ''; // Effacer le contenu du tableau
    tableHeader.innerHTML = ''; // Effacer l'en-tête du tableau

    // Mettre à jour la liste des documents pour le projet sélectionné (sans la désactiver)
    populateSecondColumnListbox(projectName);

    document.getElementById('addProjectDialog').close();

  } catch (error) {
    console.error("Erreur lors de l'ajout du projet :", error);
    alert("Une erreur s'est produite lors de l'ajout du projet.");
  }
});

async function renderDocumentCheckboxList() {
  const container = document.getElementById('duplicateOptionsContainer');
  const secondDropdown = document.getElementById('secondColumnListbox');
  const selectedProject = selectedFirstValue; // Projet sélectionné dans la première liste
  const selectedDocument = secondDropdown.value; // Document actuellement sélectionné dans la deuxième liste

  // Vérifier qu'un projet est sélectionné
  if (!selectedProject) {
    container.innerHTML = '<p style="color: red;">Veuillez sélectionner un projet avant de dupliquer une ligne.</p>';
    return;
  }

  // Obtenir les options disponibles dans la deuxième liste déroulante
  const documentOptions = Array.from(secondDropdown.options)
    .filter(option => option.value && option.value !== 'addTable' && option.value !== selectedDocument) // Exclure le document sélectionné
    .map(option => option.value);

  // Si aucun document n'est disponible
  if (documentOptions.length === 0) {
    container.innerHTML = '<p>Aucun autre document disponible pour ce projet.</p>';
    return;
  }

  // Générer la case "Tout sélectionner"
  const selectAllDiv = `
        <div class="emetteur-item">
          <input type="checkbox" id="selectAllDocuments" class="select-all-documents">
          <span>Tout sélectionner</span>
        </div>
      `;

  // Générer les cases à cocher pour chaque document disponible
  const listHTML = documentOptions.map(({ value, label }, index) => `
        <div class="emetteur-item">
          <input type="checkbox" id="doc-${index}" name="documents" value="${value}">
          <span>${label}</span>
        </div>
      `).join('');

  // Afficher la liste complète avec l'option "Tout sélectionner"
  container.innerHTML = `
        <p>Document :</p>
        <div id="documentList" style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
          ${selectAllDiv}
          ${listHTML}
        </div>
      `;

  // Ajouter un écouteur à la case "Tout sélectionner" pour cocher/décocher tous les documents
  const selectAllCheckbox = document.getElementById('selectAllDocuments');
  selectAllCheckbox.addEventListener('change', function () {
    // Récupérer toutes les cases à cocher des documents (excluant la case "Tout sélectionner")
    const docCheckboxes = container.querySelectorAll("input[name='documents']");
    docCheckboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
  });
}

document.getElementById('duplicateCheckbox').addEventListener('change', async function () {
  const container = document.getElementById('duplicateOptionsContainer');
  if (this.checked) {
    container.style.display = 'block'; // Afficher le conteneur des options de duplication
    await renderDocumentCheckboxList(); // Charger les documents disponibles pour duplication
  } else {
    container.style.display = 'none'; // Cacher le conteneur
    container.innerHTML = ''; // Vider le contenu
  }
});

// Réinitialiser le formulaire d'ajout de ligne
function resetAddRowForm() {
  const addRowDialog = document.getElementById('addRowDialog');
  const inputs = addRowDialog.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.checked = false; // Décoche toutes les cases
    } else if (input.id !== 'emetteur') {
      input.value = ''; // Réinitialise tous les champs sauf "emetteur"
    }
  });

  // Cacher les options liées à la duplication
  const duplicateOptionsContainer = document.getElementById('duplicateOptionsContainer');
  if (duplicateOptionsContainer) {
    duplicateOptionsContainer.style.display = 'none'; // Cacher le conteneur de duplication
    duplicateOptionsContainer.innerHTML = ''; // Vider les options de duplication
  }
}

// Réinitialiser également lorsqu'on change de tableau dans la deuxième liste déroulante
document.getElementById('secondColumnListbox').addEventListener('change', () => {
  resetAddRowForm(); // Réinitialise les champs du formulaire d'ajout
});

// Fonction pour réinitialiser et assurer qu'il y a une seule case personnalisée vide et décochée
function initializeCustomEmitters() {
  const container = document.getElementById('emetteurDropdown');

  // Supprime toutes les anciennes cases personnalisées
  document.querySelectorAll('.custom-emetteur').forEach(row => row.remove());

  // Ajoute une seule case personnalisée vide et décochée
  addCustomEmetteurRow(false);
}

// Fonction pour réinitialiser la boîte de dialogue "Ajouter un document"
async function resetAddDocumentDialog() {
  // Réinitialiser les champs texte et date
  document.getElementById('documentNumber').value = '';
  document.getElementById('documentName').value = '';
  document.getElementById('defaultDatelimite').value = '';

  // Récupérer le projet sélectionné
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  if (!selectedProject) {
    console.error("Aucun projet sélectionné !");
    return;
  }

  // Liste par défaut d'émetteurs
  const defaultEmetteurs = await getDefaultEmetteurs();

  // Extraire les émetteurs du projet à partir de records
  const projectEmetteurs = [...new Set(
    records
      .filter(r => r.NomProjet === selectedProject)
      .map(r => r.Emetteur)
      .filter(Boolean)
  )];

  // Remplir la div avec la fonction dédiée
  populateEmetteurDropdown(projectEmetteurs, defaultEmetteurs);

  if (currentContextMenuEmitter) {
    const checkboxes = document.querySelectorAll('#emetteurDropdown input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = (cb.value === currentContextMenuEmitter);
    });
  }

  // Réinitialiser les éventuels éléments de personnalisation (si présents)
  const customCheckbox = document.getElementById('customEmetteurCheckbox');
  if (customCheckbox) customCheckbox.checked = false;
  const customInput = document.getElementById('customEmetteurInput');
  if (customInput) customInput.value = '';
}

// Fonction pour ajouter un nouvel émetteur personnalisé
function addCustomEmetteurRow() {
  const container = document.getElementById('emetteurDropdown');

  // Vérifier s'il y a déjà une ligne et si la dernière est cochée
  const allCustomRows = container.querySelectorAll('.custom-emetteur');
  if (allCustomRows.length > 0) {
    const lastCheckbox = allCustomRows[allCustomRows.length - 1].querySelector('input[type="checkbox"]');
    if (!lastCheckbox.checked) {
      return; // Ne pas ajouter si la dernière case est décochée
    }
  }

  // Création de la ligne d'émetteur personnalisé
  const newEmetteurRow = document.createElement('div');
  newEmetteurRow.classList.add('emetteur-item', 'custom-emetteur');

  // Case à cocher pour l'émetteur
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('custom-emetteur-checkbox');
  checkbox.checked = false; // Toujours décoché au début

  // Champ texte pour le nom de l'émetteur
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Autre émetteur...';
  textInput.style.flex = '1';
  textInput.style.padding = '5px';

  // Gestion du comportement lors du changement d'état de la case à cocher
  checkbox.addEventListener('change', function () {
    if (this.checked) {
      // Ajouter une nouvelle case seulement si celle-ci est la dernière
      if (!newEmetteurRow.nextElementSibling) {
        addCustomEmetteurRow();
      }
    } else {
      // Si la case est décochée, toutes les suivantes remontent et la dernière est supprimée
      removeCustomEmitter(newEmetteurRow);
    }
  });

  // Ajout des éléments dans la ligne
  newEmetteurRow.appendChild(checkbox);
  newEmetteurRow.appendChild(textInput);

  // Ajout dans le container
  container.appendChild(newEmetteurRow);
}

// Fonction pour gérer la suppression et le décalage des cases personnalisées
function removeCustomEmitter(rowToRemove) {
  const container = document.getElementById('emetteurDropdown');
  const allRows = Array.from(container.querySelectorAll('.custom-emetteur'));
  const indexToRemove = allRows.indexOf(rowToRemove);

  // Si c'est la seule case, elle doit rester décochée et vide
  if (allRows.length === 1) {
    rowToRemove.querySelector('input[type="checkbox"]').checked = false;
    rowToRemove.querySelector('input[type="text"]').value = '';
    return;
  }

  // Décalage des valeurs des cases suivantes vers le haut
  for (let i = indexToRemove; i < allRows.length - 1; i++) {
    const currentCheckbox = allRows[i].querySelector('input[type="checkbox"]');
    const currentTextInput = allRows[i].querySelector('input[type="text"]');
    const nextCheckbox = allRows[i + 1].querySelector('input[type="checkbox"]');
    const nextTextInput = allRows[i + 1].querySelector('input[type="text"]');

    currentCheckbox.checked = nextCheckbox.checked;
    currentTextInput.value = nextTextInput.value;
  }

  // Supprime la dernière case si ce n'est pas la seule restante
  allRows[allRows.length - 1].remove();
}

async function updateEmetteurList(excludeCustom = false, targetDropdownId = "emetteurDropdown") {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  if (!selectedProject) return;

  try {
    // Liste des émetteurs prédéfinis
    const defaultEmetteurs = await getDefaultEmetteurs();

    // Récupérer toutes les lignes de la table "References"
    const referenceTable = await grist.docApi.fetchTable('References');

    if (!referenceTable.NomProjetString || referenceTable.NomProjetString.length === 0) {
      console.error("La colonne NomProjetString est vide ou introuvable !");
      return;
    }

    // Filtrer les émetteurs liés au projet sélectionné
    let emetteursFromProject = referenceTable.Emetteur.filter((_, index) =>
      referenceTable.NomProjetString[index] === selectedProject
    );

    // Supprimer les doublons et trier
    let uniqueEmetteursFromProject = [...new Set(emetteursFromProject)]
      .filter(emetteur => emetteur && !defaultEmetteurs.includes(emetteur))
      .sort();

    console.log(`Émetteurs trouvés pour ${selectedProject} :`, uniqueEmetteursFromProject);

    // Exclure les émetteurs personnalisés si demandé
    if (excludeCustom) {
      uniqueEmetteursFromProject = uniqueEmetteursFromProject.filter(emetteur => defaultEmetteurs.includes(emetteur));
    }

    // Mise à jour de la liste
    populateDatalist(targetDropdownId, [...defaultEmetteurs, ...uniqueEmetteursFromProject]);

  } catch (error) {
    console.error("Erreur lors de la récupération des émetteurs :", error);
  }
}

function populateEmetteurDropdown(projectEmetteurs, defaultEmetteurs) {
  const container = document.getElementById('emetteurDropdown');
  container.innerHTML = ''; // Vider la div avant de la remplir

  // --- Ajout de la case "Tout sélectionner" ---
  const selectAllDiv = document.createElement('div');
  selectAllDiv.classList.add('emetteur-item');

  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.id = 'selectAllEmitters';

  const selectAllLabel = document.createElement('span');
  selectAllLabel.textContent = 'Tout sélectionner';

  selectAllDiv.appendChild(selectAllCheckbox);
  selectAllDiv.appendChild(selectAllLabel);
  container.appendChild(selectAllDiv);

  // Écouteur d'événement pour gérer la sélection/désélection de toutes les cases
  selectAllCheckbox.addEventListener('change', function () {
    // On récupère toutes les cases à cocher sauf celle "Tout sélectionner" et celles de type "Autre émetteur"
    const emitterCheckboxes = container.querySelectorAll("input[type='checkbox']:not(#selectAllEmitters):not(.custom-emetteur-checkbox)");
    emitterCheckboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
  });

  // Création de la liste combinée des émetteurs (sans doublons et triée)
  const allEmetteurs = [...defaultEmetteurs, ...projectEmetteurs]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  allEmetteurs.forEach(emetteur => {
    const emetteurItem = document.createElement('div');
    emetteurItem.classList.add('emetteur-item');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = emetteur;
    // Pré-sélection si applicable (exemple pour action contextuelle)
    checkbox.checked = (emetteur === currentContextMenuEmitter);

    // Si une case individuelle est décochée, on décoche "Tout sélectionner"
    checkbox.addEventListener('change', function () {
      if (!this.checked) {
        const selectAll = document.getElementById('selectAllEmitters');
        if (selectAll) selectAll.checked = false;
      }
    });

    const label = document.createElement('span');
    label.textContent = emetteur;

    emetteurItem.appendChild(checkbox);
    emetteurItem.appendChild(label);
    container.appendChild(emetteurItem);
  });

  // Ajout de la ligne pour un émetteur personnalisé ("Autre émetteur")
  addCustomEmetteurRow();
}

document.getElementById('firstColumnDropdown').addEventListener('change', function () {
  updateEmetteurList();
});

function populateDatalist(datalistId, values) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) {
    console.error(`Erreur : Datalist ${datalistId} introuvable.`);
    return;
  }
  datalist.innerHTML = ''; // Vider la liste existante
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

document.getElementById('addDocumentDialog').addEventListener('show', () => {
  resetAddDocumentDialog();
});

function updateEmetteurListForAddRow() {
  updateEmetteurList(true, "emetteur");
}

async function updateEmetteurListForInputs() {
  const defaultEmetteurs = await getDefaultEmetteurs();
  updateEmetteurList(true, "emetteurList");
  const selectedProject = document.getElementById('firstColumnDropdown')?.value;
  if (!selectedProject) return;

  if (!Array.isArray(records)) {
    console.error("Erreur : records est vide ou introuvable.");
    return;
  }

  const projectEmetteurs = records
    .filter(record => record.NomProjet === selectedProject)
    .map(record => record.Emetteur)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  const allEmetteurs = [...new Set([...defaultEmetteurs, ...projectEmetteurs])]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  updateDatalist('emetteurList', allEmetteurs);
  updateDatalist('editEmetteurList', allEmetteurs);
}

// Fonction pour remplir une liste `datalist`
function updateDatalist(listId, values) {
  const datalist = document.getElementById(listId);
  if (!datalist) {
    console.error(`Erreur : Datalist ${listId} introuvable.`);
    return;
  }
  datalist.innerHTML = ''; // Vider la liste existante
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

document.getElementById('editEmetteur').addEventListener('input', (event) => {
  currentEditEmetteur = event.target.value.trim();
  console.log("Valeur capturée dans l'émetteur :", currentEditEmetteur);
});

async function updateEditEmetteurList() {
  const selectedProject = document.getElementById('firstColumnDropdown').value;
  const emetteurList = document.getElementById('editEmetteurList');

  if (!selectedProject) {
    emetteurList.innerHTML = '';
    return;
  }

  const defaultEmetteurs = await getDefaultEmetteurs();

  const projectEmetteurs = records
    .filter(record => record.NomProjet === selectedProject)
    .map(record => record.Emetteur)
    .filter((value, index, self) => value && self.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  const allEmetteurs = [...new Set([...defaultEmetteurs, ...projectEmetteurs])]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  emetteurList.innerHTML = '';
  allEmetteurs.forEach(emetteur => {
    const option = document.createElement('option');
    option.value = emetteur;
    emetteurList.appendChild(option);
  });

  console.log("Liste des émetteurs mise à jour pour l'édition :", allEmetteurs);
}

document.getElementById('editRowDialog').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  let datelimite = formData.get('datelimite');

  // Vérifier si vide, assigner "1900-01-01"
  if (!datelimite || datelimite.trim() === "") {
    datelimite = "1900-01-01";
  }

  const updatedRow = {
    Emetteur: formData.get('editEmetteur'),
    Reference: formData.get('reference'),
    Indice: formData.get('indice'),
    Recu: formData.get('recu'),
    DescriptionObservationss: formData.get('description'),
    DateLimite: datelimite // Valeur corrigée ici
  };

  if (selectedRecordId) {
    try {
      console.log("Mise à jour envoyée à Grist :", updatedRow);
      await grist.docApi.applyUserActions([
        ['UpdateRecord', 'References', selectedRecordId, updatedRow]
      ]);
      console.log("Mise à jour réussie !");
      await populateTable();
      document.getElementById('editRowDialog').close();
    } catch (error) {
      console.error("Erreur lors de la mise à jour :", error);
      alert("Erreur lors de la modification.");
    }
  }
});

// Met à jour la liste si l'utilisateur change de projet avant d'éditer une ligne
document.getElementById('firstColumnDropdown').addEventListener('change', updateEditEmetteurList);

// Fonction pour forcer la mise à jour des émetteurs après modification
function refreshEmetteurList() {
  updateEmetteurListForInputs(); // Recharge les valeurs dans `datalist`
}

// Écoute l'événement de fermeture du dialogue après modification
document.getElementById('editRowDialog').addEventListener('close', refreshEmetteurList);

// Rafraîchir les émetteurs après modification
document.getElementById('editRowDialog').addEventListener('close', () => {
  const rows = document.querySelectorAll('#tableBody tr');
  rows.forEach(row => row.classList.remove('highlighted'));
});

document.getElementById('addRowDialog').addEventListener('close', () => {
  const rows = document.querySelectorAll('#tableBody tr');
  rows.forEach(row => row.classList.remove('highlighted'));
});

document.getElementById('addRowDialog').addEventListener('show', () => {
  resetAndUpdateDialog(); // Réinitialise le formulaire
  updateEmetteurList(false, "emetteurList"); // Actualise la liste en incluant les émetteurs personnalisés
});

document.getElementById('editRowDialog').addEventListener('show', () => {
  updateEmetteurList(false, "editEmetteurList");
});

document.getElementById('editRowDialog').addEventListener('show', async () => {
  await updateEmetteurList(false, "editEmetteurList");
});

async function updateEmetteurList(excludeCustom = false, targetDropdownIds = ["emetteurList", "editEmetteurList"]) {
  // Si targetDropdownIds est une chaîne, la convertir en tableau
  if (typeof targetDropdownIds === "string") {
    targetDropdownIds = [targetDropdownIds];
  }

  const selectedProject = document.getElementById('firstColumnDropdown').value;
  if (!selectedProject) return;

  try {
    // Liste par défaut
    const defaultEmetteurs = await getDefaultEmetteurs();

    // Récupérer les enregistrements depuis Grist
    const referenceTable = await grist.docApi.fetchTable('References');
    if (!referenceTable.NomProjetString || referenceTable.NomProjetString.length === 0) {
      console.error("Erreur : La colonne NomProjetString est vide ou introuvable !");
      return;
    }

    // Récupérer les émetteurus liés au projet sélectionné
    let emetteursFromProject = referenceTable.Emetteur.filter((_, index) =>
      referenceTable.NomProjetString[index] === selectedProject
    );

    // Supprimer les doublons et conserver uniquement ceux qui ne sont pas dans defaultEmetteurs
    let uniqueEmetteursFromProject = [...new Set(emetteursFromProject)]
      .filter(emetteur => emetteur && !defaultEmetteurs.includes(emetteur))
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    // Si excludeCustom est true, ne garder que ceux de defaultEmetteurs
    if (excludeCustom) {
      uniqueEmetteursFromProject = uniqueEmetteursFromProject.filter(emetteur => defaultEmetteurs.includes(emetteur));
    }

    // Fusionner et trier la liste finale
    let finalEmetteurList = [...defaultEmetteurs, ...uniqueEmetteursFromProject]
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    // Pour la cible "emetteurList" (formulaire Ajouter une ligne),
    // si l'input contient une valeur personnalisée non présente, l'ajouter
    if (targetDropdownIds.includes("emetteurList")) {
      const emitterInput = document.getElementById('emetteur');
      const currentValue = emitterInput.value.trim();
      if (currentValue && !finalEmetteurList.includes(currentValue)) {
        finalEmetteurList.push(currentValue);
        finalEmetteurList.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
      }
    }

    // Mettre à jour chaque datalist ciblée
    targetDropdownIds.forEach(targetId => populateDatalist(targetId, finalEmetteurList));
  } catch (error) {
    console.error("Erreur lors de la récupération des émetteurs :", error);
  }
}

document.getElementById('emetteur').addEventListener('blur', () => {
  updateEmetteurList(false, "emetteurList");
});

document.getElementById('editRowDialog').addEventListener('show', () => updateEmetteurList(false));

document.getElementById('firstColumnDropdown').addEventListener('change', () => {
  updateEmetteurList(true, ["editEmetteurList"]);
});

document.getElementById('editRowDialog').addEventListener('show', updateEditEmetteurList);

async function getDefaultEmetteurs() {
  try {
    const emitterTable = await grist.docApi.fetchTable('Emetteurs');
    if (emitterTable && emitterTable.Emetteurs && emitterTable.Emetteurs.length > 0) {
      return emitterTable.Emetteurs.filter(val => !!val)
        .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    }
    return [];
  } catch (error) {
    console.error("Erreur lors de la récupération des émetteurs par défaut :", error);
    return [];
  }
}

async function getTeamService() {
  try {
    const teamTable = await grist.docApi.fetchTable('Team');
    // Vérifier si la table est au format tableau d'objets
    if (Array.isArray(teamTable) && teamTable.length > 0) {
      console.log("Service récupéré (tableau d'objets) :", teamTable[0].Service);
      return teamTable[0].Service || "";
    }
    // Vérifier si la table est au format colonnes (objet avec des tableaux)
    else if (teamTable.Service && Array.isArray(teamTable.Service)) {
      console.log("Service récupéré (format colonnes) :", teamTable.Service[0]);
      return teamTable.Service[0] || "";
    }
    return "";
  } catch (error) {
    console.error("Erreur lors de la récupération du service depuis la table Team :", error);
    return "";
  }
}

function resetAddRowDialog() {
  const dialog = document.getElementById('addRowDialog');
  const inputs = dialog.querySelectorAll('input, textarea, select');

  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.checked = false; // Décoche toutes les cases
    } else if (input.id !== 'emetteur') {
      input.value = ''; // Réinitialise tous les champs sauf "emetteur"
    }
  });

  // Assurez-vous que la case "Ajouter sur d'autres documents" est décochée
  const duplicateCheckbox = document.getElementById('duplicateCheckbox');
  duplicateCheckbox.checked = false;

  // Masquez et videz le conteneur des options de duplication
  const duplicateOptionsContainer = document.getElementById('duplicateOptionsContainer');
  duplicateOptionsContainer.style.display = 'none';
  duplicateOptionsContainer.innerHTML = '';
}

// Fonction pour retirer l'extension d'un fichier
function removeFileExtension(fileName) {
  return fileName.replace(/\.[^/.]+$/, ""); // Supprime tout après le dernier point
}

function handleAddMultipleTable() {
  resetAddMultipleDocumentDialog();
  document.getElementById('addMultipleDocumentDialog').showModal();
}

function resetAddMultipleDocumentDialog() {
  const dialog = document.getElementById('addMultipleDocumentDialog');
  const inputs = dialog.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.checked = false;
    } else {
      input.value = '';
    }
  });

  // Réinitialiser le tableau dynamique
  const tbody = document.getElementById('documentTableBody');
  // Supprime toutes les lignes existantes
  tbody.innerHTML = '';
  // Crée une nouvelle ligne vide initiale
  const newRow = document.createElement('tr');

  const tdNumber = document.createElement('td');
  tdNumber.style.border = "1px solid #ddd";
  tdNumber.style.padding = "8px";
  tdNumber.contentEditable = "true";
  // Pour forcer la saisie numérique, nous ajouterons l'écouteur dans addInputListenerToRow()
  newRow.appendChild(tdNumber);

  const tdName = document.createElement('td');
  tdName.style.border = "1px solid #ddd";
  tdName.style.padding = "8px";
  tdName.contentEditable = "true";
  newRow.appendChild(tdName);

  tbody.appendChild(newRow);
  // Attache les écouteurs à la nouvelle ligne
  addInputListenerToRow(newRow);

  // Réinitialiser la liste des émetteurs dans le dialog
  getDefaultEmetteurs().then(defaultEmetteurs => {
    const projectEmetteurs = records
      .filter(record => record.NomProjet === selectedFirstValue)
      .map(record => record.Emetteur)
      .filter((value, index, self) => value && self.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    populateEmetteurDropdownForContainer('multipleEmetteurDropdown', projectEmetteurs, defaultEmetteurs);
  });
}

function populateEmetteurDropdownForContainer(containerId, projectEmetteurs, defaultEmetteurs) {
  const container = document.getElementById(containerId);
  container.innerHTML = ''; // Vider le conteneur

  // Ajout de la case "Tout sélectionner"
  const selectAllDiv = document.createElement('div');
  selectAllDiv.classList.add('emetteur-item');

  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.id = containerId + '_selectAll';

  const selectAllLabel = document.createElement('span');
  selectAllLabel.textContent = 'Tout sélectionner';

  selectAllDiv.appendChild(selectAllCheckbox);
  selectAllDiv.appendChild(selectAllLabel);
  container.appendChild(selectAllDiv);

  // Gestion du clic sur "Tout sélectionner"
  selectAllCheckbox.addEventListener('change', function () {
    const emitterCheckboxes = container.querySelectorAll("input[type='checkbox']:not(#" + containerId + "_selectAll):not(.custom-emetteur-checkbox)");
    emitterCheckboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
  });

  // Création de la liste combinée des émetteurs (sans doublons et triée)
  const allEmetteurs = [...defaultEmetteurs, ...projectEmetteurs]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  allEmetteurs.forEach(emetteur => {
    const emetteurItem = document.createElement('div');
    emetteurItem.classList.add('emetteur-item');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = emetteur;
    // (Optionnel) Pré-sélection si besoin
    checkbox.checked = (emetteur === currentContextMenuEmitter);

    checkbox.addEventListener('change', function () {
      if (!this.checked) {
        const selectAll = document.getElementById(containerId + '_selectAll');
        if (selectAll) selectAll.checked = false;
      }
    });

    const label = document.createElement('span');
    label.textContent = emetteur;

    emetteurItem.appendChild(checkbox);
    emetteurItem.appendChild(label);
    container.appendChild(emetteurItem);
  });

  // Ajout de la ligne pour un émetteur personnalisé ("Autre émetteur")
  addCustomEmetteurRowForContainer(containerId);
}

// Fonction similaire à addCustomEmetteurRow, mais qui ajoute dans le conteneur cible
function addCustomEmetteurRowForContainer(containerId) {
  const container = document.getElementById(containerId);
  const allCustomRows = container.querySelectorAll('.custom-emetteur');
  if (allCustomRows.length > 0) {
    const lastCheckbox = allCustomRows[allCustomRows.length - 1].querySelector('input[type="checkbox"]');
    if (lastCheckbox && !lastCheckbox.checked) {
      return; // Ne pas ajouter si la dernière case personnalisée n'est pas cochée
    }
  }
  const newEmetteurRow = document.createElement('div');
  newEmetteurRow.classList.add('emetteur-item', 'custom-emetteur');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('custom-emetteur-checkbox');
  checkbox.checked = false;

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Autre émetteur...';
  textInput.style.flex = '1';
  textInput.style.padding = '5px';

  checkbox.addEventListener('change', function () {
    if (this.checked) {
      if (!newEmetteurRow.nextElementSibling) {
        addCustomEmetteurRowForContainer(containerId);
      }
    } else {
      removeCustomEmitterForContainer(newEmetteurRow, containerId);
    }
  });

  newEmetteurRow.appendChild(checkbox);
  newEmetteurRow.appendChild(textInput);
  container.appendChild(newEmetteurRow);
}

function removeCustomEmitterForContainer(rowToRemove, containerId) {
  const container = document.getElementById(containerId);
  const allRows = Array.from(container.querySelectorAll('.custom-emetteur'));
  const indexToRemove = allRows.indexOf(rowToRemove);

  if (allRows.length === 1) {
    rowToRemove.querySelector('input[type="checkbox"]').checked = false;
    rowToRemove.querySelector('input[type="text"]').value = '';
    return;
  }

  for (let i = indexToRemove; i < allRows.length - 1; i++) {
    const currentCheckbox = allRows[i].querySelector('input[type="checkbox"]');
    const currentTextInput = allRows[i].querySelector('input[type="text"]');
    const nextCheckbox = allRows[i + 1].querySelector('input[type="checkbox"]');
    const nextTextInput = allRows[i + 1].querySelector('input[type="text"]');
    currentCheckbox.checked = nextCheckbox.checked;
    currentTextInput.value = nextTextInput.value;
  }
  allRows[allRows.length - 1].remove();
}

document.getElementById('addMultipleDocumentDialog').addEventListener('submit', async (e) => {
  e.preventDefault();
  trimInputs(e.target); // Nettoie les espaces superflus

  // Récupérer les lignes du tableau dynamique
  const tbody = document.getElementById('documentTableBody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  // Filtrer les lignes non complètement vides (on ignore la dernière ligne vide)
  const documentRows = rows.filter((row, index) => {
    const cells = row.querySelectorAll('td');
    const cell1 = cells[0].innerText.trim();
    const cell2 = cells[1].innerText.trim();
    // Si c'est la dernière ligne et qu'elle est vide, on l'ignore
    if (index === rows.length - 1 && cell1 === '' && cell2 === '') {
      return false;
    }
    // On considère la ligne si au moins une cellule est renseignée
    return (cell1 !== '' || cell2 !== '');
  });

  // Vérifier que pour chaque ligne non vide, les deux cellules sont complétées
  for (const row of documentRows) {
    const cells = row.querySelectorAll('td');
    const cell1 = cells[0].innerText.trim();
    const cell2 = cells[1].innerText.trim();
    if ((cell1 === '' && cell2 !== '') || (cell1 !== '' && cell2 === '')) {
      alert("Chaque ligne doit être complétée dans les deux colonnes.");
      return;
    }
  }

  if (documentRows.length === 0) {
    alert("Veuillez remplir au moins une ligne avec un numéro et un nom de document.");
    return;
  }

  // Construire un tableau de données à partir des lignes (chaque ligne contient un numéro et un nom)
  const documentsData = documentRows.map(row => {
    const cells = row.querySelectorAll('td');
    return {
      documentNumber: cells[0].innerText.trim(),
      documentName: cells[1].innerText.trim()
    };
  });

  // Récupérer les émetteurs sélectionnés dans le conteneur du dialog "Ajouter Plusieurs document"
  const selectedEmitters = Array.from(document.querySelectorAll('#multipleEmetteurDropdown input[type="checkbox"]:checked'))
    .map(checkbox => {
      // Pour une case personnalisée, récupérer la valeur saisie dans le champ adjacent
      const textInput = checkbox.nextElementSibling;
      if (textInput && textInput.tagName === "INPUT" && textInput.type === "text") {
        const customValue = textInput.value.trim();
        return customValue ? customValue : null;
      }
      return checkbox.value;
    })
    .filter(value => value); // Exclut les valeurs nulles

  if (selectedEmitters.length === 0) {
    alert("Veuillez sélectionner au moins un émetteur.");
    return;
  }

  // Récupérer le projet sélectionné (stocké dans la variable globale "selectedFirstValue")
  const selectedProject = selectedFirstValue;
  if (!selectedProject) {
    alert("Veuillez sélectionner un projet avant d'ajouter un document.");
    return;
  }

  try {
    // Récupérer l'ID du projet
    const projets = await grist.docApi.fetchTable('Projets');
    const projectIndex = projets.Nom_de_projet.indexOf(selectedProject);
    if (projectIndex === -1) throw new Error("Projet introuvable.");
    const projectId = projets.id[projectIndex];

    // Récupérer le service depuis la table Team
    const serviceValue = await getTeamService();

    // Récupérer la date limite par défaut
    const defaultDatelimite = document.getElementById('multipleDefaultDatelimite').value || "1900-01-01";

    // Construire la liste des actions à appliquer pour chaque document et chaque émetteur
    const actions = [];
    documentsData.forEach(doc => {
      // Concatène le numéro et le nom avec un tiret
      const combinedDocumentName = `${doc.documentNumber}-${doc.documentName}`.trim();
      selectedEmitters.forEach(emetteur => {
        const _n2 = Number(doc.documentNumber);
        const num = (Number.isFinite(_n2) && _n2 !== 0) ? _n2 : null;
        const nm = String(doc.documentName).trim();
        const newRow = {
          NomProjet: projectId,
          NomDocument: nm,
          NumeroDocument: numeroOrZero(parseNumeroForStorage(num)),
          Emetteur: emetteur,
          Reference: '_',
          Indice: '-',
          Recu: '1900-01-01',
          DescriptionObservationss: 'EN ATTENTE',
          DateLimite: defaultDatelimite,
          Service: serviceValue
        };
        actions.push(['AddRecord', 'References', null, newRow]);
      });
    });

    // Appliquer les actions via l'API Grist
    await grist.docApi.applyUserActions(actions);
    console.log("Documents ajoutés :", documentsData);

    // Mettre à jour le dropdown de documents en ajoutant chaque nouveau document
    const secondDropdown = document.getElementById('secondColumnListbox');
    documentsData.forEach(doc => {
      const nm = String(doc.documentName).trim();
      const num = normalizeNumeroRaw(doc.documentNumber);
      const newOption = document.createElement('option');
      newOption.value = JSON.stringify({ n: num, name: nm });
      newOption.textContent = makeDocLabel(nm, num);
      const addTableOption = secondDropdown.querySelector('option[value="addTable"]');
      if (addTableOption) {
        secondDropdown.insertBefore(newOption, addTableOption);
      } else {
        secondDropdown.appendChild(newOption);
      }
    });
    // Optionnel : définir la sélection sur le dernier document ajouté
    if (documentsData.length) {
      const lastDoc = documentsData[documentsData.length - 1];
      const lastVal = JSON.stringify({ n: normalizeNumeroRaw(lastDoc.documentNumber), name: String(lastDoc.documentName).trim() });
      const secondDropdown = document.getElementById('secondColumnListbox');
      secondDropdown.value = lastVal;
      const parsed = parseDocValue(lastVal);
      selectedDocNumber = parsed.numero;
      selectedDocName = parsed.name;
      selectedSecondValue = parsed.name;
    }
    // Met à jour l'affichage du tableau principal et ferme le dialog
    populateTable();
    document.getElementById('addMultipleDocumentDialog').close();

  } catch (error) {
    console.error("Erreur lors de l'ajout des documents :", error);
    alert("Une erreur s'est produite lors de l'ajout des documents.");
  }
});

function setCaretToEnd(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Ajoute l'écouteur sur une ligne pour surveiller les modifications
function addInputListenerToRow(row) {
  const firstCell = row.querySelectorAll('td')[0];
  firstCell.addEventListener('input', function () {
    // Conserve la valeur, filtre les caractères non numériques
    const oldText = this.innerText;
    const newText = oldText.replace(/\D/g, '');
    if (newText !== oldText) {
      this.innerText = newText;
      // Replace le curseur à la fin
      setCaretToEnd(this);
    }
    updateDocumentTable();
  });

  // Ajoute l'écouteur pour les autres cellules
  row.querySelectorAll('td').forEach(cell => {
    if (cell !== firstCell) {
      cell.addEventListener('input', updateDocumentTable);
    }
  });
}

// Fonction qui met à jour le tableau
function updateDocumentTable() {
  const tbody = document.getElementById('documentTableBody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  // Supprime toutes les lignes vides sauf la dernière
  rows.slice(0, -1).forEach(row => {
    const cells = row.querySelectorAll('td');
    let isEmpty = true;
    cells.forEach(cell => {
      if (cell.innerText.trim() !== '') {
        isEmpty = false;
      }
    });
    if (isEmpty) {
      row.remove();
    }
  });

  // Vérifie la dernière ligne
  const lastRow = tbody.lastElementChild;
  if (lastRow) {
    const cells = lastRow.querySelectorAll('td');
    let hasContent = false;
    cells.forEach(cell => {
      if (cell.innerText.trim() !== '') {
        hasContent = true;
      }
    });
    if (hasContent) {
      // Crée une nouvelle ligne vide
      const newRow = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.style.border = "1px solid #ddd";
      td1.style.padding = "8px";
      td1.contentEditable = "true";

      const td2 = document.createElement('td');
      td2.style.border = "1px solid #ddd";
      td2.style.padding = "8px";
      td2.contentEditable = "true";

      newRow.appendChild(td1);
      newRow.appendChild(td2);
      tbody.appendChild(newRow);
      addInputListenerToRow(newRow);
    }
  }
}

// Initialisation : Ajoute l'écouteur sur la première ligne dès le chargement du dialog
document.addEventListener('DOMContentLoaded', () => {
  const initialRow = document.querySelector('#documentTableBody tr');
  if (initialRow) {
    addInputListenerToRow(initialRow);
  }
});

document.getElementById('addMultipleDocumentDialog').addEventListener('show', () => {
  resetAddMultipleDocumentDialog();
});

document.getElementById('cancelAddDocumentButton').addEventListener('click', function () {
  document.getElementById('addDocumentDialog').close();
  // Si une sélection valide existe, la réaffecter ; sinon, assigner la valeur par défaut
  if (lastValidDocument) {
    document.getElementById('secondColumnListbox').value = lastValidDocument;
    selectedSecondValue = lastValidDocument;
  } else {
    document.getElementById('secondColumnListbox').value = 'Sélectionner un étage';
    selectedSecondValue = '';
  }
});

document.getElementById('cancelAddMultipleDocumentButton').addEventListener('click', function () {
  document.getElementById('addMultipleDocumentDialog').close();
  // Si une sélection valide existe, la réaffecter ; sinon, assigner la valeur par défaut
  if (lastValidDocument) {
    document.getElementById('secondColumnListbox').value = lastValidDocument;
    selectedSecondValue = lastValidDocument;
  } else {
    document.getElementById('secondColumnListbox').value = 'Sélectionner un étage';
    selectedSecondValue = '';
  }
});

// Bouton "Télécharger Tableau"
document.getElementById('copyTableDataButton').addEventListener('click', function () {
  // Vérifie qu'un projet et un document sont sélectionnés
  const firstValue = document.getElementById('firstColumnDropdown').value.trim();
  const secondValue = document.getElementById('secondColumnListbox').value.trim();
  if (!firstValue || !secondValue || secondValue === "Sélectionner un étage") {
    alert("Veuillez sélectionner un projet et un document.");
    return;
  }

  // Récupère l'élément du tableau
  const table = document.getElementById('dataTable');
  if (!table) {
    alert("Tableau introuvable !");
    return;
  }

  // Récupère toutes les lignes (en-tête et corps)
  const rows = table.querySelectorAll('tr');
  let tableText = "";

  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const cellTexts = Array.from(cells)
      .slice(1)           // Supprime la première colonne (ID)
      .slice(0, 5)        // Conserve les 5 premières cellules restantes
      .map(cell => cell.innerText.trim());
    tableText += cellTexts.join('\t') + "\n";
  });

  // Essayer d'utiliser l'API Clipboard pour copier le texte
  navigator.clipboard.writeText(tableText)
    .then(() => {
      alert("Données du tableau copiées dans le presse-papier !");
    })
    .catch(err => {
      console.warn("Clipboard API non disponible, utilisation du fallback.", err);
      // Fallback : créer un textarea temporaire et utiliser document.execCommand('copy')
      const textarea = document.createElement("textarea");
      textarea.value = tableText;
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          alert("Données du tableau copiées dans le presse-papier !");
        } else {
          alert("Échec de la copie via execCommand.");
        }
      } catch (err2) {
        alert("Erreur lors de la copie (fallback) : " + err2);
      }
      document.body.removeChild(textarea);
    });
});

document.getElementById('copyTableDataButtonImage').addEventListener('click', async function () {
  // Vérifie qu'un projet et un document sont sélectionnés
  const firstValue = document.getElementById('firstColumnDropdown').value.trim();
  const secondValue = document.getElementById('secondColumnListbox').value.trim();
  if (!firstValue || !secondValue || secondValue === "Sélectionner un étage") {
    alert("Veuillez sélectionner un projet et un document.");
    return;
  }

  const originalTable = document.getElementById('dataTable');
  if (!originalTable) {
    alert("Tableau introuvable !");
    return;
  }

  // Cloner le tableau original (avec toutes ses parties)
  const clonedTable = originalTable.cloneNode(true);

  // Pour éviter que le header ne se positionne en sticky,
  // on modifie le style du thead en position static
  const thead = clonedTable.querySelector('thead');
  if (thead) {
    thead.style.position = 'static';
    thead.style.top = '0';
  }

  // Indices des colonnes à supprimer (en se basant sur l’ordre dans le tableau original)
  // Ici, on souhaite retirer "DateLimite", "Bloquant" et "Archive".
  // Dans notre tableau, ces colonnes se trouvent respectivement aux indices 6, 7 et 8
  // On supprime en partant de la plus grande pour éviter que l’indexation ne soit décalée.
  const indicesToRemove = [8, 7, 6];
  clonedTable.querySelectorAll('tr').forEach(row => {
    indicesToRemove.forEach(idx => {
      if (row.children[idx]) {
        row.removeChild(row.children[idx]);
      }
    });
  });

  // Créer un conteneur temporaire dans lequel on place le clone pour le rendre capturable.
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.top = '-9999px';
  tempContainer.style.left = '-9999px';
  tempContainer.style.display = 'block';
  tempContainer.appendChild(clonedTable);
  document.body.appendChild(tempContainer);

  try {
    // Utilisation de html2canvas pour capturer le tableau cloné
    const canvas = await html2canvas(clonedTable, { useCORS: true });

    // Si l'API Clipboard est disponible, essayer de copier l'image dans le presse-papier
    if (navigator.clipboard && navigator.clipboard.write) {
      canvas.toBlob(async function (blob) {
        if (!blob) {
          alert("Erreur lors de la conversion en image.");
          return;
        }
        try {
          const clipboardItem = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([clipboardItem]);
          alert("Image du tableau copiée dans le presse-papier !");
        } catch (err) {
          console.warn("Erreur lors de l'utilisation de l'API Clipboard, passage au fallback.", err);
          fallbackCopyImage(canvas);
        }
      }, 'image/png');
    } else {
      fallbackCopyImage(canvas);
    }
  } catch (error) {
    alert("Erreur lors de la capture du tableau : " + error);
  } finally {
    document.body.removeChild(tempContainer);
  }
});

// Fallback copier image
function fallbackCopyImage(canvas) {

  const dataURL = canvas.toDataURL('image/png');

  // Crée un conteneur contentEditable hors écran
  const container = document.createElement('div');
  container.contentEditable = true;
  container.style.position = 'absolute';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  // Insère l'image dans le conteneur via une balise <img>
  container.innerHTML = `<img src="${dataURL}">`;

  // Sélectionne le contenu du conteneur
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    const success = document.execCommand('copy');
    if (success) {
      alert("Image du tableau copiée dans le presse-papier !");
    } else {
      alert("Échec de la copie de l'image via le fallback.");
    }
  } catch (err) {
    alert("Erreur lors de la copie (fallback) : " + err);
  }

  // Nettoyage
  document.body.removeChild(container);
  selection.removeAllRanges();
}

// Bouton "Télécharger Tableau"
document.getElementById('downloadTableButton').addEventListener('click', async function () {
  // Vérifier qu'un projet et un document sont sélectionnés
  const projectName = document.getElementById('firstColumnDropdown').value.trim();
  const docName = document.getElementById('secondColumnListbox').value.trim();
  if (!projectName || !docName || docName === "Sélectionner un étage") {
    alert("Veuillez sélectionner un projet et un document.");
    return;
  }

  // Définition du nom
  const suggestedName = `${projectName}_${docName}.png`;

  // Récupérer le tableau original
  const originalTable = document.getElementById('dataTable');
  if (!originalTable) {
    alert("Tableau introuvable !");
    return;
  }

  // Cloner le tableau
  const clonedTable = originalTable.cloneNode(true);

  const thead = clonedTable.querySelector('thead');
  if (thead) {
    thead.style.position = 'static';
    thead.style.top = '0';
  }

  const indicesToRemove = [8, 7, 6];
  clonedTable.querySelectorAll('tr').forEach(row => {
    indicesToRemove.forEach(idx => {
      if (row.children[idx]) {
        row.removeChild(row.children[idx]);
      }
    });
  });

  // Créer un conteneur temporaire hors écran pour placer le clone
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.top = '-9999px';
  tempContainer.style.left = '-9999px';
  tempContainer.style.display = 'block';
  tempContainer.appendChild(clonedTable);
  document.body.appendChild(tempContainer);

  try {
    // Capture du clone par html2canvas
    const canvas = await html2canvas(clonedTable, { useCORS: true });
    // Convertir le canvas en Blob (format PNG)
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/png');
    });

    // Si l'API File System Access est disponible, tenter de l'utiliser pour ouvrir le navigateur de fichier
    if (window.showSaveFilePicker) {
      try {
        const options = {
          suggestedName: suggestedName,
          types: [{
            description: 'Images PNG',
            accept: { 'image/png': ['.png'] }
          }]
        };
        // Note : showSaveFilePicker doit être exécuté dans un contexte sécurisé (HTTPS) et au niveau top-level
        const handle = await window.showSaveFilePicker(options);
        const writableStream = await handle.createWritable();
        await writableStream.write(blob);
        await writableStream.close();
      } catch (err) {
        console.error("Erreur avec showSaveFilePicker :", err);
        // Fallback classique en cas d'échec
        fallbackDownload(blob, suggestedName);
      }
    } else {
      // Si l'API n'est pas disponible, utiliser le fallback
      fallbackDownload(blob, suggestedName);
    }
  } catch (error) {
    alert("Erreur lors de la capture du tableau : " + error);
  } finally {
    // Supprimer le conteneur temporaire
    document.body.removeChild(tempContainer);
  }
});

// Fonction fallback : réalise un téléchargement classique via un lien
function fallbackDownload(blob, suggestedName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
// --- Force labels in the 2nd dropdown to "<NumeroDocument> <NomDocument>" ---
function refreshSecondDropdownLabels() {
  try {
    const projectDropdown = document.getElementById('firstColumnDropdown');
    const secondDropdown = document.getElementById('secondColumnListbox');
    if (!projectDropdown || !secondDropdown) return;
    const selectedProject = (projectDropdown.value || '').trim();
    const options = Array.from(secondDropdown.options);
    options.forEach(opt => {
      if (!opt || !opt.value || opt.value === 'addTable' || opt.value === 'addMultipleTable') return;
      let numero = null, name = '';
      try {
        const parsed = parseDocValue(opt.value);
        if (parsed) { numero = parsed.numero; name = parsed.name || String(opt.textContent || '').trim(); }
      } catch (e) { }
      if (!name) name = String(opt.value).trim();
      if (numero === null || numero === undefined) {
        try {
          const rec = (records || []).find(r => r.NomProjet === selectedProject && r.NomDocument === name);
          if (rec && 'NumeroDocument' in rec) numero = (rec.NumeroDocument ?? 0);
        } catch (e) { numero = 0; }
      }
      opt.textContent = makeDocLabel(name, numero ?? 0);
      opt.label = opt.textContent;
    });
  } catch (e) { console.warn('refreshSecondDropdownLabels failed:', e); }
}
function installSecondDropdownObserver() {
  try {
    const secondDropdown = document.getElementById('secondColumnListbox');
    if (!secondDropdown) return;
    if (window.__secondDropdownObserver) return;
    const obs = new MutationObserver(() => { try { refreshSecondDropdownLabels(); } catch (e) { } });
    obs.observe(secondDropdown, { childList: true, subtree: false });
    window.__secondDropdownObserver = obs;
    try { refreshSecondDropdownLabels(); } catch (e) { }
  } catch (e) { console.warn('installSecondDropdownObserver failed:', e); }
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  try { installSecondDropdownObserver(); } catch (e) { }
  setTimeout(() => { try { refreshSecondDropdownLabels(); installSecondDropdownObserver(); } catch (e) { } }, 200);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    try { installSecondDropdownObserver(); refreshSecondDropdownLabels(); } catch (e) { }
    setTimeout(() => { try { refreshSecondDropdownLabels(); } catch (e) { } }, 200);
  });
}