grist.ready();

let records = [];
let allPlans = [];
let allProjects = [];
let BORDEREAU_TABLE = 'Envois';
const PLANS_TABLE = 'ListePlan_NDC_COF';
const PROJET_TABLE = 'Projets';

grist.onRecords(async (newRecords, mappings) => {
  records = newRecords;
  allPlans = await grist.docApi.fetchTable(PLANS_TABLE);
  allProjects = await grist.docApi.fetchTable(PROJET_TABLE);
  populateProjectDropdown();
  displayInvoiceTable();
});

function populateProjectDropdown() {
  const projectDropdown = document.getElementById('projectDropdown');
  const projects = [...new Set(allProjects.Nom_de_projet)].filter(Boolean).sort();
  
  const currentValue = projectDropdown.value;
  while (projectDropdown.options.length > 1) projectDropdown.remove(1);

  projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project;
    option.textContent = project;
    projectDropdown.appendChild(option);
  });
  projectDropdown.value = currentValue;
}

document.getElementById('projectDropdown').addEventListener('change', () => {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  const refInput = document.getElementById('refInput');
  
  if (selectedProjectName) {
    const projectRefs = [...new Set(records.filter(r => r.Projet === selectedProjectName).map(r => r.Ref))].sort();
    refInput.value = projectRefs.length > 0 ? projectRefs[0] : '';
  } else {
    refInput.value = '';
  }

  loadBordereauData();
  displayInvoiceTable();
});

document.getElementById('refInput').addEventListener('change', () => {
  loadBordereauData();
  displayInvoiceTable();
});

document.getElementById('refInput').addEventListener('input', (e) => {
  const refInput = e.target;
  refInput.value = refInput.value.replace(/[^0-9]/g, '');
  const numericValue = parseInt(refInput.value, 10);
  if (numericValue < 1) {
    refInput.value = '1';
  }
  updateArrowButtons();
});
document.getElementById('dateInput').addEventListener('change', () => updateBordereauData());

document.getElementById('refUp').addEventListener('click', () => updateRefValue(1));
document.getElementById('refDown').addEventListener('click', () => updateRefValue(-1));

function updateRefValue(change) {
  const refInput = document.getElementById('refInput');
  const currentValue = refInput.value;
  const numericPart = parseInt(currentValue.replace(/[^0-9]/g, ''), 10) || 1;
  const newNumericPart = numericPart + change;

  if (newNumericPart < 1) {
    return;
  }

  const prefix = currentValue.replace(/[0-9]/g, '');
  refInput.value = prefix + newNumericPart;
  refInput.dispatchEvent(new Event('change'));
  updateArrowButtons();
}

function updateArrowButtons() {
  const refInput = document.getElementById('refInput');
  const refDownButton = document.getElementById('refDown');
  const numericValue = parseInt(refInput.value, 10);
  refDownButton.disabled = numericValue <= 1;
}

async function updateBordereauData() {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  if (!selectedProjectName) return;

  const ref = document.getElementById('refInput').value;
  const date = document.getElementById('dateInput').value;

  const projectRecords = records.filter(r => r.Projet === selectedProjectName && r.Ref == ref);

  if (projectRecords.length > 0) {
    // Ref exists, update the date for all matching records
    const updates = projectRecords.map(r => ['UpdateRecord', BORDEREAU_TABLE, r.id, { Date_Bordereau: date }]);
    if (updates.length > 0) {
      await grist.docApi.applyUserActions(updates);
    }
  } else {
    // Ref does not exist, this is handled by addItem, but we can pre-fill the date
    // No need to create a record here, as it would be empty.
    // The user will add items using the "Add Item" button.
  }
}

async function loadBordereauData() {
  updateArrowButtons();
  const selectedProjectName = document.getElementById('projectDropdown').value;
  const refInput = document.getElementById('refInput');
  const dateInput = document.getElementById('dateInput');
  const refValue = refInput.value;

  if (!selectedProjectName) {
    refInput.value = '';
    dateInput.value = '';
    return;
  }

  const projectRecords = records.filter(r => r.Projet === selectedProjectName && r.Ref == refValue);
  if (projectRecords.length > 0) {
    const firstRecord = projectRecords[0];
    refInput.value = firstRecord.Ref || '';
    const timestamp = firstRecord.Date_Bordereau;

    try {
      let date;
      if (timestamp) {
        if (typeof timestamp === 'number') {
          // Handle Unix timestamps (assuming seconds, so multiply by 1000)
          date = new Date(timestamp * 1000);
        } else {
          // Handle date strings or Date objects
          date = new Date(timestamp);
        }

        // Check if the created date is valid
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 3000) {
          dateInput.value = date.toISOString().split('T')[0];
        } else {
          dateInput.value = '';
        }
      } else {
        dateInput.value = '';
      }
    } catch (e) {
      console.error("Failed to parse date, falling back to blank.", e);
      dateInput.value = '';
    }
  } else {
    // No records found for this ref, so clear the date field for a new entry
    dateInput.value = '';
  }
}

function displayInvoiceTable() {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  const refValue = document.getElementById('refInput').value;
  const tbody = document.querySelector('#invoiceTable tbody');
  tbody.innerHTML = '';

  if (!selectedProjectName) {
    return;
  }

  const refRecords = records.filter(r => r.Projet === selectedProjectName && r.Ref == refValue);
  if (refRecords.length === 0) {
    return;
  }
  const selectedProject = selectedProjectName;
  const allProjectRecords = records.filter(r => r.Projet === selectedProjectName);

  refRecords.forEach(record => {
    const row = tbody.insertRow();
    row.dataset.recordId = record.id;

    const nPlanCell = row.insertCell();
    const nPlanSelect = document.createElement('select');
    nPlanSelect.innerHTML = '<option value="">Choisir un plan</option>';
    
    const planIndices = allPlans.Nom_projet.reduce((indices, projId, index) => {
        if (projId === selectedProject && allPlans.Indice[index] && String(allPlans.Indice[index]).trim()) {
            indices.push(index);
        }
        return indices;
    }, []);

    const planNumbers = [...new Set(planIndices.map(i => allPlans.NumeroDocument[i]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    planNumbers.forEach(planNumber => {
      const option = document.createElement('option');
      option.value = planNumber;
      option.textContent = planNumber;
      nPlanSelect.appendChild(option);
    });
    nPlanSelect.value = record.N_Plan || '';
    nPlanCell.appendChild(nPlanSelect);

    const indiceCell = row.insertCell();
    indiceCell.textContent = record.Indice || '';

    const designationCell = row.insertCell();
    designationCell.textContent = record.Designation || '';

    const nbrExemplairesCell = row.insertCell();
    const nbrExemplairesSelect = document.createElement('select');
    
    // Use existing values from the NbrExemplaires column for the selected project
    const allOptions = [...new Set(allProjectRecords.map(r => r.NbrExemplaires).filter(Boolean))].sort();

    allOptions.forEach(optionValue => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        nbrExemplairesSelect.appendChild(option);
    });

    // Add a blank option if it's not there
    if (!allOptions.includes('')) {
      const blankOption = document.createElement('option');
      blankOption.value = '';
      blankOption.textContent = '---';
      nbrExemplairesSelect.prepend(blankOption);
    }

    nbrExemplairesSelect.value = record.NbrExemplaires || '';
    nbrExemplairesCell.appendChild(nbrExemplairesSelect);

    const deleteCell = row.insertCell();
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Supprimer';
    deleteBtn.className = 'delete-btn';
    deleteCell.appendChild(deleteBtn);
  });
}

document.getElementById('addItem').addEventListener('click', async () => {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  if (!selectedProjectName) {
    alert('Veuillez d\'abord sélectionner un projet.');
    return;
  }
  const date = document.getElementById('dateInput').value;
  if (!date) {
    alert('Veuillez entrer une date valide avant d\'ajouter un élément.');
    return;
  }
  const ref = document.getElementById('refInput').value;

  // Check if a record with this ref already exists for the project
  const existingRecords = records.filter(r => r.Projet === selectedProjectName && r.Ref == ref);
  if (existingRecords.length === 0) {
    // If no records exist for this ref, create the first one.
    await grist.docApi.applyUserActions([['AddRecord', BORDEREAU_TABLE, null, { Projet: selectedProjectName, Ref: ref, Date_Bordereau: date }]]);
  } else {
    // If records already exist, just add a new one to the existing bordereau
    await grist.docApi.applyUserActions([['AddRecord', BORDEREAU_TABLE, null, { Projet: selectedProjectName, Ref: ref, Date_Bordereau: date }]]);
  }
});

document.querySelector('#invoiceTable').addEventListener('change', async (e) => {
  const target = e.target;
  const row = target.closest('tr');
  const recordId = parseInt(row.dataset.recordId, 10);

  if (target.tagName === 'SELECT' && target.parentElement.cellIndex === 0) { // N_Plan
    const nPlan = target.value;
    const selectedProjectName = document.getElementById('projectDropdown').value;
    const selectedProject = selectedProjectName;
    
    const matchingPlans = allPlans.id.map((id, i) => ({
        id: id,
        NumeroDocument: allPlans.NumeroDocument[i],
        Indice: allPlans.Indice[i],
        Designation: allPlans.Designation[i],
        Nom_projet: allPlans.Nom_projet[i]
    })).filter(p => p.NumeroDocument === nPlan && p.Nom_projet === selectedProject);

    if (matchingPlans.length > 0) {
      const latestPlan = matchingPlans.reduce((latest, current) => (latest.Indice > current.Indice) ? latest : current);
      const { Indice: indice, Designation: designation } = latestPlan;
      await grist.docApi.applyUserActions([['UpdateRecord', BORDEREAU_TABLE, recordId, { N_Plan: nPlan, Indice: indice, Designation: designation }]]);
    }
  } else if (target.tagName === 'SELECT' && target.parentElement.cellIndex === 3) { // NbrExemplaires
    const nbrExemplaires = target.value;
    await grist.docApi.applyUserActions([['UpdateRecord', BORDEREAU_TABLE, recordId, { NbrExemplaires: nbrExemplaires }]]);
  }
});

document.querySelector('#invoiceTable').addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-btn')) {
        const row = e.target.closest('tr');
        const recordId = parseInt(row.dataset.recordId, 10);
        await grist.docApi.applyUserActions([['RemoveRecord', BORDEREAU_TABLE, recordId]]);
    }
});

document.querySelector('#invoiceTable').addEventListener('dblclick', (e) => {
  const target = e.target;
  if (target.tagName === 'SELECT' && target.parentElement.cellIndex === 3) { // NbrExemplaires
    const cell = target.parentElement;
    const originalValue = target.value;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalValue;
    
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();

    const saveAndRevert = async () => {
      const newValue = input.value;
      const row = cell.closest('tr');
      const recordId = parseInt(row.dataset.recordId, 10);

      // Update the current record
      await grist.docApi.applyUserActions([['UpdateRecord', BORDEREAU_TABLE, recordId, { NbrExemplaires: newValue }]]);

      // If it's a new, non-empty value, we don't need to do anything special here.
      // The displayInvoiceTable() call below will pick it up from the 'records' data.
      
      // Re-render the table to show the updated dropdowns everywhere
      displayInvoiceTable();
    };

    input.addEventListener('blur', saveAndRevert);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur(); // Trigger the blur event to save
      } else if (e.key === 'Escape') {
        input.removeEventListener('blur', saveAndRevert);
        displayInvoiceTable(); // Revert without saving
      }
    });
  }
});

document.getElementById('generatePdf').addEventListener('click', async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const ITEMS_PER_PAGE = 15;

    const selectedProject = document.getElementById('projectDropdown').value;
    const refValue = document.getElementById('refInput').value;
    if (!selectedProject) {
        alert('Veuillez sélectionner un projet pour générer le bordereau.');
        return;
    }

    const projectRecords = records.filter(r => r.Projet === selectedProject && r.Ref == refValue);
    const totalPages = Math.ceil(projectRecords.length / ITEMS_PER_PAGE);

    const dateStr = new Date(document.getElementById('dateInput').value).toLocaleDateString('fr-FR');
    const logo1 = await fetch('img/Petit_Logotype_Digital_Couleurs.png').then(res => res.blob());
    const logo2 = await fetch('img/Dumez_Ile_de_France_Logotype_Digital_Couleurs.png').then(res => res.blob());
    const logo3 = await fetch('img/Neom_Logotype_Digital_Couleurs.png').then(res => res.blob());

    const addHeader = () => {
        doc.addImage(URL.createObjectURL(logo1), 'PNG', 10, 10, 30, 15);
        doc.addImage(URL.createObjectURL(logo2), 'PNG', 50, 10, 30, 15);
        doc.addImage(URL.createObjectURL(logo3), 'PNG', 90, 10, 30, 15);
        doc.setFontSize(18);
        doc.text('BORDEREAU DE TRANSMISSION', 14, 40);
        doc.setFontSize(12);
        doc.text(`Date: ${dateStr}`, 14, 50);
        doc.text(`Projet: ${selectedProject}`, 14, 60);
        doc.text(`Ref: ${refValue || ''}`, 14, 65);
    };

    const addFooter = (pageNumber, totalPages, isLastPage) => {
        const finalY = doc.lastAutoTable.finalY || 70;
        if (isLastPage) {
            doc.text('Nous vous en souhaitons bonne réception et restons à votre disposition.', 14, finalY + 10);
            doc.text('M. GHANEM', 170, finalY + 20);
        }
        doc.text(`Page ${pageNumber}/${totalPages}`, 175, 280);
    };

    for (let i = 0; i < totalPages; i++) {
        if (i > 0) {
            doc.addPage();
        }
        addHeader();
        const start = i * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageRecords = projectRecords.slice(start, end);
        const body = pageRecords.map(r => [r.N_Plan, r.Indice, r.Designation, r.NbrExemplaires]);

        doc.autoTable({
            startY: 75,
            head: [['N° Plan', 'Indice', 'Désignation', 'Nbr Exemplaires']],
            body: body,
        });

        addFooter(i + 1, totalPages, i === totalPages - 1);
    }

    doc.save(`${selectedProject} - Bordereau n°${refValue}.pdf`);
});
