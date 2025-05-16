window.__skipChangeEvent = false;

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

  // Ne vide le tableau que si l'utilisateur change manuellement
  if (!window.__skipTableClear__) {
    document.getElementById("plans-output").innerHTML = "";
  }
});

document.getElementById("designationDropdown").addEventListener("change", () => {
  if (window.__skipChangeEvent) return;

  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedDesignation = document.getElementById("designationDropdown").value;

  if (selectedProject && selectedDesignation) {
    afficherPlansFiltres(selectedProject, selectedDesignation, records);
  }
});

window.updateRecordsFromAffichage = function (updatedRecords, selectedProject, selectedDesignation) {
  records = updatedRecords;

  if (selectedProject) {
    window.currentProjet = selectedProject;
    const dropdown = document.getElementById("projectDropdown");
    if (dropdown.value !== selectedProject) {
      dropdown.value = selectedProject;
    }
  }

  if (selectedDesignation) {
    window.currentDesignation = selectedDesignation;

    const dropdown = document.getElementById("designationDropdown");
    const currentOptions = Array.from(dropdown.options).map(o => o.value);
    const newOptions = [...new Set(records
      .filter(r => r.NomProjet === selectedProject)
      .map(r => r.Designation))].filter(Boolean).sort();

    // Comparer si les options ont vraiment changé
    const isDifferent =
      newOptions.length !== currentOptions.length ||
      newOptions.some((val, i) => val !== currentOptions[i]);

    if (isDifferent) {
      populateDropdown("designationDropdown", newOptions);
    }

    // Et ne change la valeur que si différente
    if (dropdown.value !== selectedDesignation) {
      window.__skipChangeEvent = true;
      dropdown.value = selectedDesignation;
      setTimeout(() => { window.__skipChangeEvent = false }, 0);
    }
    
  }
};
