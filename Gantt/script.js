let records = [];

grist.ready();

grist.onRecords((receivedRecords) => {
  records = receivedRecords;
  const projets = [...new Set(records.map(r => r.NomProjet))].filter(Boolean).sort();
  populateDropdown("projectDropdown", projets);
});

function populateDropdown(id, values) {
  const dropdown = document.getElementById(id);
  const defaultText = dropdown.options[0].textContent;
  dropdown.innerHTML = `<option value="">${defaultText}</option>`;
  values.forEach(val => {
    const option = document.createElement('option');
    option.value = val;
    option.textContent = val;
    dropdown.appendChild(option);
  });
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  const docs = [...new Set(records
    .filter(r => r.NomProjet === selectedProject)
    .map(r => r.NomDocument))].filter(Boolean).sort();
  populateDropdown("documentDropdown", docs);
});

document.getElementById("documentDropdown").addEventListener("change", () => {
    const selectedProject = document.getElementById("projectDropdown").value;
    const selectedDocument = document.getElementById("documentDropdown").value;
    updateGanttChart(selectedProject, selectedDocument, records);
});
  
