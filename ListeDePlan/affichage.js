const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
let projetsDictGlobal = null;

(async () => {
  await chargerProjetsMap();
})();

async function chargerProjetsMap() {
  if (projetsDictGlobal) return projetsDictGlobal;

  const data = await grist.docApi.fetchTable("Projets");
  projetsDictGlobal = {};

  if (data && data.id && data.Nom_de_projet) {
    for (let i = 0; i < data.id.length; i++) {
      const nom = data.Nom_de_projet[i];
      const id = data.id[i];
      if (typeof nom === "string" && nom.trim()) {
        projetsDictGlobal[nom.trim()] = id;
      }
    }
  } else {
    console.error("Structure inattendue de la table Projet :", data);
  }
  return projetsDictGlobal;
}

function afficherPlansFiltres(projet, typeDocument, records) {
  const zone = document.getElementById("plans-output");
  zone.innerHTML = "";

  const filtres = records.filter(r =>
    (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet) === projet &&
    r.Type_document === typeDocument
  );

  if (filtres.length === 0) {
    zone.innerHTML = "<p>Aucun plan trouvé pour cette sélection.</p>";
    return;
  }

  const plansMap = new Map();
  for (const r of filtres) {
    const key = `${r.NumeroDocument}___${r.Designation}`;
    if (!plansMap.has(key)) {
      plansMap.set(key, {
        Num_Document: r.NumeroDocument,
        Designation: r.Designation,
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

  const warningDiv = document.createElement('div');
  warningDiv.id = 'warnings';
  zone.appendChild(warningDiv);

  // Designation conflict warnings
  const docToDesignations = new Map();
  for (const r of filtres) {
    if (!r.NumeroDocument) continue;
    if (!docToDesignations.has(r.NumeroDocument)) {
      docToDesignations.set(r.NumeroDocument, new Set());
    }
    if (r.Designation) {
      docToDesignations.get(r.NumeroDocument).add(r.Designation);
    }
  }

  for (const [doc, designations] of docToDesignations.entries()) {
    if (designations.size > 1) {
      const form = document.createElement('div');
      form.className = 'warning-form';
      form.innerHTML = `<p><strong>Attention :</strong> Le document <strong>${doc}</strong> a plusieurs désignations :</p>`;
      const fieldset = document.createElement('fieldset');
      fieldset.dataset.numDocument = doc;
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
      button.dataset.numDocument = doc;
      form.appendChild(button);
      warningDiv.appendChild(form);
    }
  }

  // Multi-date conflict warning
  let hasMultiDateError = false;
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

  // Missing date warnings
  let hasMissingDateError = false;
  for (const plan of plansMap.values()) {
    const datedIndices = Object.keys(plan.lignes)
      .filter(indice => plan.lignes[indice] && plan.lignes[indice].length > 0 && !plan.lignes[indice].isMissing)
      .map(indice => INDICES.indexOf(indice))
      .filter(index => index !== -1)
      .sort((a, b) => a - b);

    if (datedIndices.length > 0) {
      const last = datedIndices[datedIndices.length - 1];
      // Check all cells from the beginning up to the last valid date
      for (let i = 0; i < last; i++) {
        const currentIndice = INDICES[i];
        if (!plan.lignes[currentIndice] || plan.lignes[currentIndice].length === 0) {
          hasMissingDateError = true;
          // Mark this cell for highlighting
          if (!plan.lignes[currentIndice]) {
            plan.lignes[currentIndice] = { isMissing: true };
          } else {
            plan.lignes[currentIndice].isMissing = true;
          }
        }
      }
    }
  }

  if (hasMissingDateError) {
    const p = document.createElement('p');
    p.className = 'warning-message';
    p.textContent = "Des dates sont manquantes, veuillez les remplir.";
    warningDiv.appendChild(p);
  }

  // Document number/type consistency warnings (for the current project)
  const projectDocMap = window.projectDocNumberToTypeMap.get(projet);
  if (projectDocMap) {
    for (const [doc, types] of projectDocMap.entries()) {
      if (types.size > 1) {
        const p = document.createElement('p');
        p.className = 'warning-message';
        p.innerHTML = `<strong>Attention :</strong> Le N° Document <strong>${doc}</strong> est utilisé avec plusieurs types de documents dans ce projet : ${[...types].join(', ')}.`;
        warningDiv.appendChild(p);
      }
    }
  }

  const allIndicesUsed = new Set();
  for (const plan of plansMap.values()) {
    for (const ind in plan.lignes) {
      allIndicesUsed.add(ind);
    }
  }
  let lastUsedIndex = Math.max(-1, ...[...allIndicesUsed].map(i => INDICES.indexOf(i)).filter(i => i >= 0));
  const indicesToShow = INDICES.slice(0, lastUsedIndex + 2);

  const table = document.createElement("table");
  table.className = "plan-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["N° Document", "Désignation", ...indicesToShow].forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    if (title === "Désignation") th.classList.add("nomplan");
    if (!["N° Document", "Désignation"].includes(title)) {
      th.classList.add("indice");
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const plan of plansMap.values()) {
    const tr = document.createElement("tr");
    if (docToDesignations.get(plan.NumeroDocument)?.size > 1) {
      tr.classList.add("duplicate-doc");
    }

    const tdNum = document.createElement("td");
    tdNum.textContent = plan.Num_Document;
    tdNum.dataset.numDocument = plan.Num_Document;
    tdNum.dataset.designation = plan.Designation;
    tdNum.contentEditable = true;
    tdNum.classList.add("editable");
    tdNum.dataset.typeDocument = plan.Type_document;
    tdNum.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNum);

    const tdNom = document.createElement("td");
    tdNom.textContent = plan.Designation;
    tdNom.dataset.numDocument = plan.Num_Document;
    tdNom.dataset.designation = plan.Designation;
    tdNom.contentEditable = true;
    tdNom.classList.add("editable", "nomplan");
    tdNom.dataset.typeDocument = plan.Type_document;
    tdNom.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNom);

    for (const indice of indicesToShow) {
      const td = document.createElement("td");
      td.classList.add("editable", "indice");
      td.dataset.typeDocument = plan.Type_document;
      td.dataset.nomProjet = plan.Nom_projet;
      td.dataset.numDocument = plan.Num_Document;
      td.dataset.designation = plan.Designation;
      td.dataset.indice = indice;

      const recs = plan.lignes[indice];
      if (recs) {
        if (recs.isMissing) {
          td.classList.add('missing-date-error');
        } else if (recs.length > 1) {
          td.classList.add('multi-date-error');
          td.innerHTML = recs.map(r => formatDate(r.DateDiffusion)).join('<br>');
          td.dataset.conflicts = JSON.stringify(recs.map(r => ({ id: r.id, date: r.DateDiffusion })));
        } else if (recs.length === 1) {
          const rec = recs[0];
          if (rec.DateDiffusion) td.textContent = formatDate(rec.DateDiffusion);
          td.dataset.recordId = rec.id;
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  zone.appendChild(table);
}

document.addEventListener("click", async (e) => {
  const target = e.target;

  if (target.matches('td.multi-date-error')) {
    const td = target;
    const conflicts = JSON.parse(td.dataset.conflicts);
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
    return;
  }

  if (target.matches('button.fix-designation-btn')) {
    const button = target;
    const numDocument = button.dataset.numDocument;
    const form = button.closest('.warning-form');
    const selectedRadio = form.querySelector(`input[name="designation-fix-${numDocument}"]:checked`);
    if (!selectedRadio) {
      alert("Veuillez sélectionner une désignation correcte.");
      return;
    }
    const correctDesignation = selectedRadio.value;
    const recordsToUpdate = window.records.filter(r => r.NumeroDocument === numDocument && r.Designation !== correctDesignation);
    if (recordsToUpdate.length > 0) {
      const actions = recordsToUpdate.map(r => ["UpdateRecord", "ListePlan_NDC_COF", r.id, { Designation: correctDesignation }]);
      try {
        await grist.docApi.applyUserActions(actions);
        alert(`Les désignations pour le document ${numDocument} ont été unifiées.`);
      } catch (err) {
        console.error("Erreur lors de l'unification des désignations :", err);
        alert("Une erreur est survenue.");
      }
    } else {
      alert("Aucune mise à jour nécessaire.");
    }
    return;
  }

  if (target.matches('td.indice.editable')) {
    const td = target;
    if (document.getElementById('date-fix-popup')) return;
    const { recordId, indice, typeDocument, nomProjet } = td.dataset;
    const tr = td.parentElement;
    const Num_Document = tr.cells[0]?.textContent.trim();
    const Designation = tr.cells[1]?.textContent.trim();
    const fp = flatpickr(td, {
      "locale": "fr",
      defaultDate: td.textContent ? convertFrToDate(td.textContent) : undefined,
      dateFormat: "d/m/Y",
        onClose: async (selectedDates, dateStr, instance) => {
        const isoDate = selectedDates.length > 0 ? convertToISO(dateStr) : null;
        const recordIdInt = recordId ? parseInt(recordId, 10) : null;

        // === CAS: cellule déjà existante (recordId) -> UPDATE, jamais AddRecord ===
        if (recordIdInt) {
          try {
            if (!isoDate) {
              // Suppression de date (ta logique existante)
              const otherDates = tr.querySelectorAll('td.indice');
              const datedCells = Array.from(otherDates).filter(cell => cell.textContent.trim() !== '' && cell !== td);

              const fieldsToUpdate = { DateDiffusion: null };
              if (datedCells.length === 0) {
                fieldsToUpdate.Indice = null;
              }

              await grist.docApi.applyUserActions([
                ["UpdateRecord", "ListePlan_NDC_COF", recordIdInt, fieldsToUpdate],

                // (je conserve ton AddRecord dans References, mais sans rowData)
                ["AddRecord", "References", null, {
                  NomProjet: nomProjet,
                  NomDocument: Designation,
                  NumeroDocument: (() => {
                    const s = String(Num_Document ?? '').trim();
                    return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
                  })()
                }]
              ]);

              td.textContent = "";
            } else {
              // Modification de date
              await grist.docApi.applyUserActions([
                ["UpdateRecord", "ListePlan_NDC_COF", recordIdInt, { DateDiffusion: isoDate }],

                // (je conserve ton AddRecord dans References, mais sans rowData)
                ["AddRecord", "References", null, {
                  NomProjet: nomProjet,
                  NomDocument: Designation,
                  NumeroDocument: (() => {
                    const s = String(Num_Document ?? '').trim();
                    return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
                  })()
                }]
              ]);

              td.textContent = dateStr;
            }
          } catch (err) {
            console.error("Erreur lors de la mise à jour de la date :", err);
          }
          return;
        }

        // === CAS: cellule vide (pas de recordId) -> ADD ===
        if (!isoDate) return;

        if (!Num_Document || !Designation || !nomProjet || !typeDocument) {
          console.warn("Champs obligatoires manquants pour l'ajout :", { Num_Document, Designation, nomProjet, typeDocument });
          return;
        }

        // Project-specific validation logic (tu gardes tel quel)
        const projectDocMap = window.projectDocNumberToTypeMap.get(nomProjet);
        if (projectDocMap) {
          const existingTypes = projectDocMap.get(Num_Document);
          if (existingTypes && !existingTypes.has(typeDocument)) {
            alert(`Erreur : Le N° Document ${Num_Document} est déjà utilisé pour un autre type de document dans ce projet (${[...existingTypes].join(', ')}).`);
            td.textContent = '';
            return;
          }
        }

        const projetsDict = await chargerProjetsMap();
        if (!projetsDict[nomProjet.trim()]) {
          console.error("Projet non trouvé :", nomProjet);
          return;
        }

        const rowData = {
          NumeroDocument: Num_Document,
          Type_document: typeDocument,
          Designation: Designation,
          Nom_projet: nomProjet,
          Indice: indice,
          DateDiffusion: isoDate
        };

        try {
          await grist.docApi.applyUserActions([
            ["AddRecord", "ListePlan_NDC_COF", null, rowData],
            ["AddRecord", "References", null, {
              NomProjet: rowData.Nom_projet,
              NomDocument: rowData.Designation,
              NumeroDocument: (() => {
                const s = String(rowData.NumeroDocument ?? '').trim();
                return (/^\d+$/.test(s) ? parseInt(s, 10) : null);
              })()
            }]
          ]);
          td.textContent = dateStr;
        } catch (err) {
          console.error("Erreur lors de l'ajout du record :", err);
        }
      }
    });
    fp.open();
  }
});

document.addEventListener("focusout", async (e) => {
  const td = e.target;
  if (!td.matches("td.editable:not(.indice)")) return;

  td.style.backgroundColor = "";
  td.style.color = "";
  const texte = td.textContent.trim();
  const { numDocument, designation } = td.dataset;
  const recordsToUpdate = window.records.filter(r => r.NumeroDocument === numDocument && r.Designation === designation);
  if (recordsToUpdate.length === 0) return;
  const champs = {};
  if (td.cellIndex === 0) {
    champs.NumeroDocument = texte;
  } else if (td.cellIndex === 1) {
    champs.Designation = texte;
  }
  if (Object.keys(champs).length > 0) {
    const actions = recordsToUpdate.map(r => ["UpdateRecord", "ListePlan_NDC_COF", r.id, champs]);
    try {
      await grist.docApi.applyUserActions(actions);
    } catch (err) {
      console.error("Erreur lors de la mise à jour du texte :", err);
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
  }
});

function convertFrToDate(dateStr) {
  const [day, month, year] = dateStr.split("/");
  return new Date(year, month - 1, day);
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
