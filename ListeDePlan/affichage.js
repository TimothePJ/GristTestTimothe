const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
let projetsDictGlobal = null;

(async () => {
  await chargerProjetsMap();
})();

async function chargerProjetsMap() {
  if (projetsDictGlobal) return projetsDictGlobal;

  const data = await grist.docApi.fetchTable("Projet");
  console.log("=== DEBUG Projet table ===");
  console.log("Structure complète :", data);

  projetsDictGlobal = {};

  if (data && data.id && data.Projet) {
    for (let i = 0; i < data.id.length; i++) {
      const nom = data.Projet[i];
      const id = data.id[i];
      if (typeof nom === "string" && nom.trim()) {
        projetsDictGlobal[nom.trim()] = id;
      }
    }
  } else {
    console.error("Structure inattendue de la table Projet :", data);
  }

  console.log("Projets connus dans Grist :", projetsDictGlobal);
  return projetsDictGlobal;
}

function afficherPlansFiltres(projet, typeDoc, records) {
  const zone = document.getElementById("plans-output");
  zone.innerHTML = "";

  const filtres = records.filter(r =>
    (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet) === projet &&
    r.Type_document === typeDoc
  );

  if (filtres.length === 0) {
    zone.innerHTML = "<p>Aucun plan trouvé pour cette sélection.</p>";
    return;
  }

  const plansMap = new Map();
  for (const r of filtres) {
    const key = `${r.N_Document}___${r.Designation2}`;
    if (!plansMap.has(key)) {
      plansMap.set(key, {
        N_Document: r.N_Document,
        Designation2: r.Designation2,
        Type_document: r.Type_document,
        Nom_projet: (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet),
        lignes: {}
      });
    }
    if (!plansMap.get(key).lignes[r.Indice]) {
      plansMap.get(key).lignes[r.Indice] = [];
    }
    plansMap.get(key).lignes[r.Indice].push(r);
  }

  let hasMultiDateError = false;

  // Identify documents that appear in multiple rows due to different designations.
  const docToDesignations = new Map();
  for (const r of filtres) {
    if (!r.N_Document) continue;
    if (!docToDesignations.has(r.N_Document)) {
      docToDesignations.set(r.N_Document, new Set());
    }
    if (r.Designation2) {
      docToDesignations.get(r.N_Document).add(r.Designation2);
    }
  }

  const warningDiv = document.createElement('div');
  warningDiv.id = 'warnings';
  zone.appendChild(warningDiv);

  for (const [doc, designations] of docToDesignations.entries()) {
    if (designations.size > 1) {
      const form = document.createElement('div');
      form.className = 'warning-form';
      form.innerHTML = `
        <p><strong>Attention :</strong> Le document <strong>${doc}</strong> a plusieurs désignations :</p>
      `;
      const fieldset = document.createElement('fieldset');
      fieldset.dataset.nDocument = doc;

      let isFirst = true;
      for (const designation of designations) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `designation-fix-${doc}`;
        radio.value = designation;
        if (isFirst) {
          radio.checked = true;
          isFirst = false;
        }
        label.appendChild(radio);
        label.append(` ${designation}`);
        fieldset.appendChild(label);
      }
      form.appendChild(fieldset);

      const button = document.createElement('button');
      button.textContent = 'Unifier les désignations';
      button.className = 'fix-designation-btn';
      button.dataset.nDocument = doc;
      form.appendChild(button);

      warningDiv.appendChild(form);
    }
  }

  for (const plan of plansMap.values()) {
    for (const indice in plan.lignes) {
      if (plan.lignes[indice].length > 1) {
        hasMultiDateError = true;
        break;
      }
    }
    if (hasMultiDateError) break;
  }

  if (hasMultiDateError) {
    const p = document.createElement('p');
    p.className = 'warning-message';
    p.textContent = "Des dates multiples sont trouvées pour certains documents pour la même indice, veuillez corriger en cliquant dessus.";
    warningDiv.appendChild(p);
  }

  const allIndicesUsed = new Set();
  for (const plan of plansMap.values()) {
    for (const ind in plan.lignes) {
      allIndicesUsed.add(ind);
    }
  }
  let lastUsedIndex = Math.max(...[...allIndicesUsed].map(i => INDICES.indexOf(i)).filter(i => i >= 0));
  if (isNaN(lastUsedIndex)) lastUsedIndex = -1;
  const indicesToShow = INDICES.slice(0, lastUsedIndex + 2);

  const table = document.createElement("table");
  table.className = "plan-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["N_Document", "Designation2", ...indicesToShow].forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    if (title === "Designation2") th.classList.add("nomplan");
    if (!["N_Document", "Designation2"].includes(title)) {
      th.classList.add("indice");
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const plan of plansMap.values()) {
    const tr = document.createElement("tr");

    if (docToDesignations.get(plan.N_Document)?.size > 1) {
      tr.classList.add("duplicate-doc");
    }

    const tdNum = document.createElement("td");
    tdNum.textContent = plan.N_Document;
    tdNum.dataset.nDocument = plan.N_Document;
    tdNum.dataset.designation2 = plan.Designation2;
    tdNum.contentEditable = true;
    tdNum.classList.add("editable");
    tdNum.dataset.typeDocument = plan.Type_document;
    tdNum.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNum);

    const tdNom = document.createElement("td");
    tdNom.textContent = plan.Designation2;
    tdNom.dataset.nDocument = plan.N_Document;
    tdNom.dataset.designation2 = plan.Designation2;
    tdNom.contentEditable = true;
    tdNom.classList.add("editable", "nomplan");
    tdNom.dataset.typeDocument = plan.Type_document;
    tdNom.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNom);

    for (const indice of indicesToShow) {
      const td = document.createElement("td");
      td.contentEditable = true;
      td.classList.add("editable", "indice");
      td.dataset.typeDocument = plan.Type_document;
      td.dataset.nomProjet = plan.Nom_projet;
      td.dataset.nDocument = plan.N_Document;
      td.dataset.designation2 = plan.Designation2;
      td.dataset.indice = indice;

      const recs = plan.lignes[indice];
      if (recs && recs.length > 0) {
        if (recs.length > 1) {
          td.classList.add('multi-date-error');
          td.contentEditable = false; // Prevent editing
          td.innerHTML = recs.map(r => formatDate(r.DateDiffusion)).join('<br>');
          td.dataset.conflicts = JSON.stringify(recs.map(r => ({ id: r.id, date: r.DateDiffusion })));
        } else {
          const rec = recs[0];
          if (rec.DateDiffusion) td.textContent = formatDate(rec.DateDiffusion);
          td.dataset.recordId = rec.id;
        }
      }
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  const trAjout = document.createElement("tr");

  const tdAjoutNum = document.createElement("td");
  tdAjoutNum.contentEditable = true;
  tdAjoutNum.classList.add("editable", "ajout");
  tdAjoutNum.dataset.typeDocument = typeDoc;
  tdAjoutNum.dataset.nomProjet = projet;
  trAjout.appendChild(tdAjoutNum);

  const tdAjoutNom = document.createElement("td");
  tdAjoutNom.contentEditable = true;
  tdAjoutNom.classList.add("editable", "ajout");
  tdAjoutNom.dataset.typeDocument = typeDoc;
  tdAjoutNom.dataset.nomProjet = projet;
  trAjout.appendChild(tdAjoutNom);

  for (const indice of indicesToShow) {
    const td = document.createElement("td");
    td.contentEditable = true;
    td.classList.add("editable", "ajout");
    td.dataset.typeDocument = typeDoc;
    td.dataset.nomProjet = projet;
    td.dataset.indice = indice;
    trAjout.appendChild(td);
  }

  tbody.appendChild(trAjout);
  table.appendChild(tbody);
  zone.appendChild(table);
}

function regenererDesignationDropdown(records, projetLabel) {
  const designationDropdown = document.getElementById("designationDropdown");
  designationDropdown.innerHTML = "";
  const types = [
    ...new Set(
      records
        .filter(r => {
          const label =
            typeof r.Nom_projet === "object"
              ? r.Nom_projet.details
              : r.Nom_projet;
          return label === projetLabel;
        })
        .map(r => r.Type_document)
        .filter(t => typeof t === "string" && t.trim() !== "")
    ),
  ].sort();
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    designationDropdown.appendChild(opt);
  }
}

document.addEventListener("click", async (e) => {
  if (e.target.matches('td.multi-date-error')) {
    const td = e.target;
    const conflicts = JSON.parse(td.dataset.conflicts);
    
    // Remove any existing popup
    const existingPopup = document.getElementById('date-fix-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.id = 'date-fix-popup';
    popup.style.position = 'absolute';
    popup.style.left = `${td.offsetLeft + td.offsetWidth}px`;
    popup.style.top = `${td.offsetTop}px`;
    
    popup.innerHTML = `<p>Choisir la date correcte:</p>`;
    const fieldset = document.createElement('fieldset');
    
    conflicts.forEach((conflict, index) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'date-fix';
      radio.value = conflict.id;
      if (index === 0) radio.checked = true;
      label.appendChild(radio);
      label.append(` ${formatDate(conflict.date)}`);
      fieldset.appendChild(label);
    });
    popup.appendChild(fieldset);

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirmer';
    confirmBtn.onclick = async () => {
      const selectedRadio = popup.querySelector('input[name="date-fix"]:checked');
      if (selectedRadio) {
        const correctRecordId = parseInt(selectedRadio.value, 10);
        const recordsToDelete = conflicts.filter(c => c.id !== correctRecordId);

        try {
          const table = await grist.getTable();
          for (const record of recordsToDelete) {
            await table.destroy(record.id);
          }
          popup.remove();
          // The onRecords event will be triggered automatically by the deletions.
        } catch (err) {
          console.error("Erreur lors de la suppression des dates en double :", err);
          alert("Une erreur est survenue lors de la suppression.");
        }
      }
    };
    popup.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Annuler';
    cancelBtn.onclick = () => popup.remove();
    popup.appendChild(cancelBtn);

    td.closest('#plans-output').appendChild(popup);
  }

  if (!e.target.matches('button.fix-designation-btn')) return;

  const button = e.target;
  const nDocument = button.dataset.nDocument;
  const form = button.closest('.warning-form');
  const selectedRadio = form.querySelector(`input[name="designation-fix-${nDocument}"]:checked`);

  if (!selectedRadio) {
    alert("Veuillez sélectionner une désignation correcte.");
    return;
  }

  const correctDesignation = selectedRadio.value;

  const recordsToUpdate = window.records.filter(r =>
    r.N_Document === nDocument && r.Designation2 !== correctDesignation
  );

  if (recordsToUpdate.length === 0) {
    alert("Aucune mise à jour nécessaire.");
    return;
  }

  const actions = recordsToUpdate.map(r =>
    ["UpdateRecord", "ListePlan_NDC_COF", r.id, { Designation2: correctDesignation }]
  );

  try {
    await grist.docApi.applyUserActions(actions);
    // Grist will trigger onRecords, which will re-render the table and remove the warning.
    alert(`Les désignations pour le document ${nDocument} ont été unifiées.`);
  } catch (err) {
    console.error("Erreur lors de l'unification des désignations :", err);
    alert("Une erreur est survenue. Consultez la console pour plus de détails.");
  }
});

document.addEventListener("focusout", async (e) => {
  const td = e.target;
  if (!td.matches("td.editable")) return;

  td.style.backgroundColor = "";
  td.style.color = "";

  const texte = td.textContent.trim();
  const { recordId, indice, typeDocument, nomProjet } = td.dataset;
  const tr = td.parentElement;
  const N_Document = tr.cells[0]?.textContent.trim();
  const Designation2 = tr.cells[1]?.textContent.trim();

  // On ne gère que les cellules avec un indice (les dates)
  if (!indice) return;

  // Cas 1: La cellule de date est vidée
  if (texte === "") {
    if (recordId) {
      // La date existait, on la supprime
      try {
        await grist.docApi.applyUserActions([
          ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId, 10), { DateDiffusion: null }]
        ]);
      } catch (err) {
        console.error("Erreur lors de la suppression de la date :", err);
        td.style.backgroundColor = "#842029";
        td.style.color = "#fff";
      }
    }
    // Si pas de recordId, la cellule était déjà vide, on ne fait rien.
    return;
  }

  // Cas 2: Une date est entrée ou modifiée
  if (!isValidDate(texte)) {
    td.style.backgroundColor = "#842029";
    td.style.color = "#fff";
    return;
  }

  const isoDate = convertToISO(texte);

  // Si on a un recordId, c'est une simple mise à jour de la date
  if (recordId) {
    try {
      await grist.docApi.applyUserActions([
        ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId, 10), { DateDiffusion: isoDate }]
      ]);
    } catch (err) {
      console.error("Erreur lors de la mise à jour de la date :", err);
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
    return;
  }

  // Si pas de recordId, c'est un ajout. Il faut toutes les infos.
  if (!N_Document || !Designation2 || !nomProjet || !typeDocument) {
    td.style.backgroundColor = "#842029";
    td.style.color = "#fff";
    console.warn("Champs obligatoires manquants pour l'ajout :", { N_Document, Designation2, nomProjet, typeDocument });
    return;
  }

  const projetsDict = await chargerProjetsMap();
  const Nom_projet_id = projetsDict[nomProjet.trim()];
  if (!Nom_projet_id) {
    td.style.backgroundColor = "#842029";
    td.style.color = "#fff";
    console.error("ID de projet non trouvé pour :", nomProjet);
    return;
  }

  const rowData = {
    N_Document,
    Type_document: typeDocument,
    Designation2,
    Nom_projet: Nom_projet_id,
    Indice: indice,
    DateDiffusion: isoDate
  };

  try {
    await grist.docApi.applyUserActions([
      ["AddRecord", "ListePlan_NDC_COF", null, rowData]
    ]);
    // Grist se charge de rafraîchir la vue via onRecords
  } catch (err) {
    console.error("Erreur lors de l'ajout du record :", err);
    td.style.backgroundColor = "#842029";
    td.style.color = "#fff";
  }
}, true);

function isValidDate(dateStr) {
  const regex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!regex.test(dateStr)) return false;
  const [day, month, year] = dateStr.split("/").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function convertToISO(dateStr) {
  const [day, month, year] = dateStr.split("/");
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
