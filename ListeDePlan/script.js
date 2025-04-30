let records = [];

grist.ready();

grist.onRecords((rec) => {
  records = rec;
  const projets = [...new Set(records.map(r => r.NomProjet))].filter(Boolean).sort();
  populateDropdown("projectDropdown", projets);
});

function populateDropdown(id, values) {
  const dropdown = document.getElementById(id);
  const defaultOption = dropdown.options[0].textContent;
  dropdown.innerHTML = `<option value="">${defaultOption}</option>`;
  values.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    dropdown.appendChild(opt);
  });
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  const designations = [...new Set(records
    .filter(r => r.NomProjet === selectedProject)
    .map(r => r.Designation))].filter(Boolean).sort();

  populateDropdown("designationDropdown", designations);
});

document.getElementById("designationDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedDesignation = document.getElementById("designationDropdown").value;
  updateGanttChart(selectedProject, selectedDesignation, records);
});
