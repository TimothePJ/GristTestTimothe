window.__skipChangeEvent = false;
window.records = [];

grist.ready();

grist.onRecords( (rec) => {
  window.records = rec.sort((a, b) => {
    const aDoc = a.N_Document || "";
    const bDoc = b.N_Document || "";
    return aDoc.localeCompare(bDoc);
  });

  const projets = [...new Set(window.records.map(r =>
    typeof r.Nom_projet === "object" ? r.Nom_projet.display || r.Nom_projet.details : r.Nom_projet
  ))].filter(Boolean).sort();

  populateDropdown("projectDropdown", projets);

  const selectedProject = document.getElementById("projectDropdown").value;
  if (selectedProject) {
    const projetsDict = chargerProjetsMap();
    for (const r of window.records) {
      if (typeof r.Nom_projet === "number") {
        const projId = r.Nom_projet;
        const projLabel = Object.entries(projetsDict).find(([label, id]) => id === projId)?.[0] || null;
        if (projLabel) {
          r.Nom_projet = { id: projId, details: projLabel };
        }
      }
    }

    const typesDocument = [...new Set(
      window.records
        .filter(r => {
          const nom = typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet;
          return nom === selectedProject;
        })
        .map(r => r.Type_document)
        .filter(val => typeof val === "string" && val.trim())
    )].sort();

    populateDropdown("typeDocumentDropdown", typesDocument);
  }

  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;
  if (selectedProject && selectedTypeDocument) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records);
  }
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

  if (values.includes(currentValue)) {
    dropdown.value = currentValue;
  }
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  if (!selectedProject) {
    populateDropdown("typeDocumentDropdown", []);
    document.getElementById("plans-output").innerHTML = "";
    return;
  }

  const typesDocumentSet = new Set();

  if(!window.records)
    console.log("no window records");

  for (const r of window.records) {
    let label = null;

    if (typeof r.Nom_projet === "object" && r.Nom_projet !== null) {
      if ("details" in r.Nom_projet) label = r.Nom_projet.details;
      else if ("display" in r.Nom_projet) label = r.Nom_projet.display;
    } else if (typeof r.Nom_projet === "string") {
      label = r.Nom_projet;
    } else if (typeof r.Nom_projet === "number") {
      label = Object.entries(window.projetsDictGlobal || {}).find(([k, v]) => v === r.Nom_projet)?.[0] || null;
    }

    if (label === selectedProject && typeof r.Type_document === "string" && r.Type_document.trim()) {
      typesDocumentSet.add(r.Type_document.trim());
    }
  }

  const typesDocument = [...typesDocumentSet].sort();
  populateDropdown("typeDocumentDropdown", typesDocument);
  console.log("Types affichés dans la deuxième liste :", typesDocument);
  document.getElementById("typeDocumentDropdown").value = "";
  document.getElementById("plans-output").innerHTML = "";
});

document.getElementById("typeDocumentDropdown").addEventListener("change", () => {
  if (window.__skipChangeEvent) return;

  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value;

  if (selectedProject && selectedTypeDocument) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records);
  }
});

async function supprimerLignesSansDate() {
  console.log("== SUPPRESSION : routine appelée ==");

  const tableName = "ListePlan_NDC_COF";
  const data = await grist.docApi.fetchTable(tableName);
  console.log("=== Données brutes ===", data);

  const rows = Object.entries(data.records || {}).map(([id, row]) => {
    const r = { id: parseInt(id), ...row };
    console.log(`Ligne ${r.id} :`, r);
    return r;
  });

  const lignesASupprimer = rows.filter(r =>
    r.DateDiffusion === null || r.DateDiffusion === undefined
  );

  console.log("=== Lignes ciblées ===", lignesASupprimer.map(r => r.id));

  if (lignesASupprimer.length === 0) {
    console.log("Aucune ligne à supprimer.");
    return;
  }

  const actions = lignesASupprimer.map(r => [
    "DeleteRecord",
    tableName,
    r.id
  ]);

  console.log("=== Actions envoyées ===", actions);

  await grist.docApi.applyUserActions(actions);
  console.log("=== Suppression exécutée ===");

  const table = document.querySelector(".plan-table");
  if (!table) {
    console.warn("Table HTML non trouvée");
    return;
  }

  const lignesDOM = table.querySelectorAll("tbody tr");
  lignesDOM.forEach(tr => {
    const cellules = tr.querySelectorAll("td");
    const contientDates = Array.from(cellules).some(td => {
      const text = td.textContent.trim();
      return /^\d{2}\/\d{2}\/\d{4}$/.test(text);
    });

    if (!contientDates) {
      console.log("→ Suppression visuelle ligne :", tr);
      tr.remove();
    }
  });
}
