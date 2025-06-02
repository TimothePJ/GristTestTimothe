window.__skipChangeEvent = false;

let records = [];

grist.ready();

grist.onRecords((rec) => {
  records = rec;
  // Liste unique de projets
  const projets = [...new Set(records.map(r => r.Nom_projet))].filter(Boolean).sort();
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

  // Liste unique de Type_document pour ce projet
  const types = [...new Set(
    records.filter(r => r.Nom_projet === selectedProject).map(r => r.Type_document)
  )].filter(Boolean).sort();

  populateDropdown("designationDropdown", types);

  if (!window.__skipTableClear__) {
    document.getElementById("plans-output").innerHTML = "";
  }
});

document.getElementById("designationDropdown").addEventListener("change", () => {
  if (window.__skipChangeEvent) return;

  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedType = document.getElementById("designationDropdown").value;

  if (selectedProject && selectedType) {
    afficherPlansFiltres(selectedProject, selectedType, records);
  }
});

window.updateRecordsFromAffichage = function (updatedRecords, selectedProject, selectedType) {
  records = updatedRecords;

  if (selectedProject) {
    window.currentProjet = selectedProject;
    const dropdown = document.getElementById("projectDropdown");
    if (dropdown.value !== selectedProject) {
      dropdown.value = selectedProject;
    }
  }

  if (selectedType) {
    window.currentType = selectedType;

    const dropdown = document.getElementById("designationDropdown");
    const currentOptions = Array.from(dropdown.options).map(o => o.value);
    const newOptions = [...new Set(records
      .filter(r => r.Nom_projet === selectedProject)
      .map(r => r.Type_document))].filter(Boolean).sort();

    const isDifferent =
      newOptions.length !== currentOptions.length ||
      newOptions.some((val, i) => val !== currentOptions[i]);

    if (isDifferent) {
      populateDropdown("designationDropdown", newOptions);
    }

    if (dropdown.value !== selectedType) {
      window.__skipChangeEvent = true;
      dropdown.value = selectedType;
      setTimeout(() => { window.__skipChangeEvent = false }, 0);
    }
  }
};
