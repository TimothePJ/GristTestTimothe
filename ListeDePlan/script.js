window.__skipChangeEvent = false;

let records = [];

grist.ready();

grist.onRecords((rec) => {
  records = rec;
  // Liste unique de projets
  const projets = [...new Set(records.map(r =>
    typeof r.Nom_projet === "object" ? r.Nom_projet.display || r.Nom_projet.details : r.Nom_projet
  ))].filter(Boolean).sort();   
  populateDropdown("projectDropdown", projets);
});

function populateDropdown(id, values) {
  const dropdown = document.getElementById(id);
  const currentValue = dropdown.value;
  const defaultOption = dropdown.options[0]?.textContent || "Choisir";

  dropdown.innerHTML = `<option value="">${defaultOption}</option>`;
  values.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    dropdown.appendChild(opt);
  });

  // Réappliquer la sélection précédente si toujours valide
  if (values.includes(currentValue)) {
    dropdown.value = currentValue;
  }
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;

  // Liste unique de Type_document pour ce projet
  const types = [...new Set(
    records
      .filter(r => {
        const nom = typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet;
        return nom === selectedProject;
      })
      .map(r => r.Type_document)
      .filter(val => typeof val === "string" && val.trim())
  )].sort();
  
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
      window.__skipChangeEvent = true;
      dropdown.value = selectedProject;
      setTimeout(() => { window.__skipChangeEvent = false }, 0);
    }    
  }

  if (selectedType) {
    window.currentType = selectedType;

    const dropdown = document.getElementById("designationDropdown");
    const currentOptions = Array.from(dropdown.options).map(o => o.value);
    const newOptions = [...new Set(
      records
        .filter(r => {
          const nom = typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet;
          return nom === selectedProject &&
                 typeof r.Type_document === "string" &&
                 r.Type_document.trim() !== "";
        })
        .map(r => r.Type_document)
    )].sort();
    
    const isDifferent =
      newOptions.length !== currentOptions.length ||
      newOptions.some((val, i) => val !== currentOptions[i]);

    if (newOptions.length > 0 && (isDifferent || dropdown.value === "")) {
      populateDropdown("designationDropdown", newOptions);
      if (!newOptions.includes(selectedType)) {
        dropdown.value = newOptions[0] || "";
      } else {
        dropdown.value = selectedType;
      }      
    }
    
    if (dropdown.value !== selectedType) {
      window.__skipChangeEvent = true;
      dropdown.value = selectedType;
      setTimeout(() => { window.__skipChangeEvent = false }, 0);
    }
  }
};
