grist.ready();

let records = [];
let allPlans = [];
let allProjects = [];
let BORDEREAU_TABLE = 'Envois';
const PLANS_TABLE = 'ListePlan_NDC_COF';
const PROJET_TABLE = 'Projet';

grist.onRecords(async (newRecords, mappings) => {
  records = newRecords;
  allPlans = await grist.docApi.fetchTable(PLANS_TABLE);
  allProjects = await grist.docApi.fetchTable(PROJET_TABLE);
  populateProjectDropdown();
  displayInvoiceTable();
});

function populateProjectDropdown() {
  const projectDropdown = document.getElementById('projectDropdown');
  const projects = [...new Set(allProjects.Projet)].filter(Boolean).sort();
  
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
  displayInvoiceTable();
  loadBordereauData();
});

document.getElementById('refInput').addEventListener('change', () => updateBordereauData());
document.getElementById('dateInput').addEventListener('change', () => updateBordereauData());

async function updateBordereauData() {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  if (!selectedProjectName) return;

  const ref = document.getElementById('refInput').value;
  const date = document.getElementById('dateInput').value;

  const projectRecords = records.filter(r => r.Projet === selectedProjectName);
  const updates = projectRecords.map(r => ['UpdateRecord', BORDEREAU_TABLE, r.id, { Ref: ref, Date_Bordereau: date }]);
  
  if (updates.length > 0) {
    await grist.docApi.applyUserActions(updates);
  }
}

async function loadBordereauData() {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  const refInput = document.getElementById('refInput');
  const dateInput = document.getElementById('dateInput');

  if (!selectedProjectName) {
    refInput.value = '';
    dateInput.value = '';
    return;
  }

  const projectRecords = records.filter(r => r.Projet === selectedProjectName);
  if (projectRecords.length > 0) {
    const firstRecord = projectRecords[0];
    refInput.value = firstRecord.Ref || '';
    const timestamp = firstRecord.Date_Bordereau;

    try {
      if (timestamp && typeof timestamp === 'number') {
        const date = new Date(timestamp * 1000);
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 3000) {
          dateInput.value = date.toISOString().split('T')[0];
        } else {
          dateInput.value = new Date().toISOString().split('T')[0];
        }
      } else {
        dateInput.value = new Date().toISOString().split('T')[0];
      }
    } catch (e) {
      console.error("Failed to parse date, falling back to today.", e);
      dateInput.value = new Date().toISOString().split('T')[0];
    }
  } else {
    refInput.value = '';
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

function displayInvoiceTable() {
  const selectedProjectName = document.getElementById('projectDropdown').value;
  const tbody = document.querySelector('#invoiceTable tbody');
  tbody.innerHTML = '';

  if (!selectedProjectName) {
    return;
  }

  const projectRecords = records.filter(r => r.Projet === selectedProjectName);
  const selectedProject = allProjects.id[allProjects.Projet.indexOf(selectedProjectName)];

  projectRecords.forEach(record => {
    const row = tbody.insertRow();
    row.dataset.recordId = record.id;

    const nPlanCell = row.insertCell();
    const nPlanSelect = document.createElement('select');
    nPlanSelect.innerHTML = '<option value="">Choisir un plan</option>';
    
    const planIndices = allPlans.Nom_projet.reduce((indices, projId, index) => {
        if (projId === selectedProject && allPlans.Indice[index]) {
            indices.push(index);
        }
        return indices;
    }, []);

    const planNumbers = [...new Set(planIndices.map(i => allPlans.N_Document[i]))].sort();

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
    const allOptions = [...new Set(projectRecords.map(r => r.NbrExemplaires).filter(Boolean))].sort();

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
  const projectIndex = allProjects.Projet.indexOf(selectedProjectName);
  const selectedProjectId = allProjects.id[projectIndex];
  const ref = document.getElementById('refInput').value;
  const date = document.getElementById('dateInput').value;
  await grist.docApi.applyUserActions([['AddRecord', BORDEREAU_TABLE, null, { Projet: selectedProjectId, Ref: ref, Date_Bordereau: date }]]);
});

document.querySelector('#invoiceTable').addEventListener('change', async (e) => {
  const target = e.target;
  const row = target.closest('tr');
  const recordId = parseInt(row.dataset.recordId, 10);

  if (target.tagName === 'SELECT' && target.parentElement.cellIndex === 0) { // N_Plan
    const nPlan = target.value;
    const selectedProjectName = document.getElementById('projectDropdown').value;
    const selectedProject = allProjects.id[allProjects.Projet.indexOf(selectedProjectName)];
    
    const matchingPlans = allPlans.id.map((id, i) => ({
        id: id,
        N_Document: allPlans.N_Document[i],
        Indice: allPlans.Indice[i],
        Designation: allPlans.Designation[i],
        Nom_projet: allPlans.Nom_projet[i]
    })).filter(p => p.N_Document === nPlan && p.Nom_projet === selectedProject);

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

    if (typeof doc.autoTable !== 'function') {
        console.error("jsPDF.autoTable is not a function. Make sure the autotable plugin is loaded.");
        alert("Erreur: La fonctionnalité de génération de PDF n'est pas correctement chargée.");
        return;
    }

    const selectedProject = document.getElementById('projectDropdown').value;
    if (!selectedProject) {
        alert('Veuillez sélectionner un projet pour générer le bordereau.');
        return;
    }

    const projectRecords = records.filter(r => r.Projet === selectedProject);

    let body = [];
    projectRecords.forEach(r => {
        body.push([r.N_Plan, r.Indice, r.Designation, r.NbrExemplaires]);
    });

    const dateStr = new Date(document.getElementById('dateInput').value).toLocaleDateString('fr-FR');

    // Add logos
    const logo1 = await fetch('https://i.imgur.com/your-logo1.png').then(res => res.blob());
    const logo2 = await fetch('https://i.imgur.com/your-logo2.png').then(res => res.blob());
    const logo3 = await fetch('https://i.imgur.com/your-logo3.png').then(res => res.blob());

    doc.addImage(URL.createObjectURL(logo1), 'PNG', 10, 10, 30, 15);
    doc.addImage(URL.createObjectURL(logo2), 'PNG', 50, 10, 30, 15);
    doc.addImage(URL.createObjectURL(logo3), 'PNG', 90, 10, 30, 15);

    doc.setFontSize(12);
    doc.text(dateStr, 170, 20);

    doc.setFontSize(18);
    doc.text('BORDEREAU DE TRANSMISSION', 14, 40);

    doc.setFontSize(12);
    doc.text(`Projet: ${selectedProject}`, 14, 50);
    doc.text(`Ref: ${document.getElementById('refInput').value || ''}`, 14, 55);

    doc.autoTable({
        startY: 65,
        head: [['N° Plan', 'Indice', 'Désignation', 'Nbr Exemplaires']],
        body: body,
    });

    const finalY = doc.lastAutoTable.finalY || 70;
    doc.text('Nous vous en souhaitons bonne réception et restons à votre disposition.', 14, finalY + 10);
    doc.text('M. GHANEM', 170, finalY + 20);
    doc.text('Page 1/1', 175, 280);


    doc.save(`Bordereau_${selectedProject}.pdf`);
});
