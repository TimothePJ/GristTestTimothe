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
    plansMap.get(key).lignes[r.Indice] = r;
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

      const rec = plan.lignes[indice];
      if (rec) {
        if (rec.DateDiffusion) td.textContent = formatDate(rec.DateDiffusion);
        td.dataset.recordId = rec.id;
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

document.addEventListener("focusout", async (e) => {
  const td = e.target;
  if (td.tagName !== "TD" || !td.classList.contains("editable")) return;

  // Si cellule vide non modifiée sans recordId ni indice : ignorer
  if (td.textContent.trim() === "" && !td.dataset.recordId && !td.dataset.indice) return;

  // Nettoyage visuel
  td.style.backgroundColor = "";
  td.style.color = "";

  const texte = td.textContent.trim();
  const recordId = td.dataset.recordId;
  const indice = td.dataset.indice;
  const tr = td.parentElement;
  const tds = Array.from(tr.children);
  const N_Document = tds[0]?.textContent.trim();
  const Designation2 = tds[1]?.textContent.trim();
  const Type_document = td.dataset.typeDocument || "";
  const Nom_projet_label = td.dataset.nomProjet || "";

  if (texte === "") {
    if (!indice && tds[0].textContent.trim() === "" && tds[1].textContent.trim() === "") {
      try {
        const refDoc = tds[0]?.dataset.nDocument || "";
        const refDes = tds[1]?.dataset.designation2 || "";
        if (!refDoc || !refDes) return;

        const allRecords = await grist.docApi.fetchTable("ListePlan_NDC_COF");
        const rows = Object.entries(allRecords.records || {}).map(([id, row]) => ({ id: parseInt(id), ...row }));

        if (grist && grist._eventHandlers?.onRecords?.[0]) {
          const handler = grist._eventHandlers.onRecords[0];
          if (typeof handler === "function") {
            handler(rows); // déclenche la même logique que lors du chargement initial
          }
        }
        
        const matching = rows.filter(r =>
          r.N_Document === refDoc && r.Designation2 === refDes
        );

        const actions = matching.map(r => ["UpdateRecord", "ListePlan_NDC_COF", r.id, {
          N_Document: "",
          Designation2: "",
          DateDiffusion: null
        }]);

        if (actions.length > 0) {
          await grist.docApi.applyUserActions(actions);
          setTimeout(() => {
            tr.remove();
          }, 0);
        }
      } catch {
        td.style.backgroundColor = "#842029";
        td.style.color = "#fff";
      }
      return;
    }

    if (recordId && indice) {
      try {
        await grist.docApi.applyUserActions([
          ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId), { DateDiffusion: null }]
        ]);
        td.textContent = "";
      } catch {
        td.style.backgroundColor = "#842029";
        td.style.color = "#fff";
      }
      return;
    }

    return;
  }

  if (!indice && recordId && (tds[0] === td || tds[1] === td)) {
    const champs = {};
    if (tds[0] === td) champs.N_Document = texte;
    if (tds[1] === td) champs.Designation2 = texte;

    try {
      await grist.docApi.applyUserActions([
        ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId), champs]
      ]);
    } catch {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
    return;
  }

  let isoDate = null;
  if (indice) {
    if (!isValidDate(texte)) {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
      return;
    }
    isoDate = convertToISO(texte);
  }

  if (recordId) {
    try {
      await grist.docApi.applyUserActions([
        ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId), {
          DateDiffusion: isoDate
        }]
      ]);
    } catch {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
    return;
  }

  if (!N_Document || !Designation2 || !Nom_projet_label || !Type_document) {
    td.style.backgroundColor = "#842029";
    td.style.color = "#fff";
    console.warn("Tentative d'ajout avec champs obligatoires manquants :", { N_Document, Designation2, Nom_projet_label, Type_document });
    return;
  }
  
  if (!recordId && N_Document && Designation2 && Nom_projet_label && indice && isoDate) {
    projetsDictGlobal = null;
    const projetsDict = await chargerProjetsMap();
    const Nom_projet = projetsDict[Nom_projet_label.trim()];
    if (!Nom_projet) {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
      return;
    }

    const rowData = {
      N_Document,
      Type_document,
      Designation2,
      Nom_projet,
      Indice: indice,
      DateDiffusion: isoDate
    };

    try {
      const res = await grist.docApi.applyUserActions([
        ["AddRecord", "ListePlan_NDC_COF", null, rowData]
      ]);
      const newId = res.retValues[0];
      td.dataset.recordId = newId;
      
      try {
        const allRecords = await grist.docApi.fetchTable("ListePlan_NDC_COF");
        const rows = Object.entries(allRecords.records || {}).map(([id, row]) => ({ id: parseInt(id), ...row }));

        if (grist && grist._eventHandlers?.onRecords?.[0]) {
          const handler = grist._eventHandlers.onRecords[0];
          if (typeof handler === "function") {
            handler(rows); // déclenche la même logique que lors du chargement initial
          }
        }        

        const projetsDict = await chargerProjetsMap();
        for (const r of rows) {
          const projId = r.Nom_projet;
          const projLabel = Object.entries(projetsDict).find(([label, id]) => id === projId)?.[0] || null;
          if (projLabel) {
            r.Nom_projet = { id: projId, details: projLabel };
          }
        }

        window.records = rows;

        const selectedProject = document.getElementById("projectDropdown").value;
        const selectedType = document.getElementById("designationDropdown").value;

        window.updateRecordsFromAffichage(rows, selectedProject, selectedType);
      } catch (err) {
        console.error("Erreur lors du rafraîchissement des records après ajout :", err);
      }

      td.classList.remove("ajout");

      const trModifiee = td.parentElement;
      const table = document.querySelector(".plan-table");
      const tbody = table.querySelector("tbody");
      const estDerniereLigne = trModifiee === tbody.lastElementChild;

      if (estDerniereLigne) {
        const nbColonnes = table.querySelector("thead tr").children.length;
        const newTr = document.createElement("tr");

        for (let i = 0; i < nbColonnes; i++) {
          const header = table.querySelector("thead tr").children[i].textContent;
          const tdNew = document.createElement("td");
          tdNew.contentEditable = true;
          tdNew.classList.add("editable", "ajout");

          if (i === 0 || i === 1) {
            tdNew.dataset.typeDocument = Type_document;
            tdNew.dataset.nomProjet = Nom_projet_label;
          }

          if (i >= 2) {
            tdNew.dataset.indice = header;
            tdNew.dataset.typeDocument = Type_document;
            tdNew.dataset.nomProjet = Nom_projet_label;
          }

          newTr.appendChild(tdNew);
        }

        tbody.appendChild(newTr);
      }

      const indexAjoute = INDICES.indexOf(indice);
      const indiceSuivant = INDICES[indexAjoute + 1] || null;

      if (indiceSuivant) {
        const headRow = table.querySelector("thead tr");
        const headers = Array.from(headRow.children).map(th => th.textContent);

        if (!headers.includes(indiceSuivant)) {
          const th = document.createElement("th");
          th.textContent = indiceSuivant;
          th.classList.add("indice");
          headRow.appendChild(th);

          const lignes = table.querySelectorAll("tbody tr");
          lignes.forEach((tr, i) => {
            const td = document.createElement("td");
            td.contentEditable = true;
            td.classList.add("editable", "indice");
            td.dataset.typeDocument = Type_document;
            td.dataset.nomProjet = Nom_projet_label;
            td.dataset.nDocument = tr.children[0]?.textContent.trim();
            td.dataset.designation2 = tr.children[1]?.textContent.trim();
            td.dataset.indice = indiceSuivant;
            if (i === lignes.length - 1) td.classList.add("ajout");
            tr.appendChild(td);
          });
        }
      }

      try {
        const allRecords = await grist.docApi.fetchTable("ListePlan_NDC_COF");
        const rows = Object.entries(allRecords.records || {}).map(([id, row]) => ({ id: parseInt(id), ...row }));

        if (grist && grist._eventHandlers?.onRecords?.[0]) {
          const handler = grist._eventHandlers.onRecords[0];
          if (typeof handler === "function") {
            handler(rows); // déclenche la même logique que lors du chargement initial
          }
        }        

        const projetsDict = await chargerProjetsMap();
        for (const r of rows) {
          const projId = r.Nom_projet;
          const projLabel = Object.entries(projetsDict).find(([label, id]) => id === projId)?.[0] || null;
          if (projLabel) {
            r.Nom_projet = { id: projId, details: projLabel };
          }
        }

        window.records = rows;

        const selectedProject = document.getElementById("projectDropdown").value;
        const selectedType = document.getElementById("designationDropdown").value;
      
        const validRows = rows.filter(r => {
          let label = null;
          if (typeof r.Nom_projet === "object" && r.Nom_projet !== null && "details" in r.Nom_projet) {
            label = r.Nom_projet.details;
          } else if (typeof r.Nom_projet === "string") {
            label = r.Nom_projet;
          } else if (typeof r.Nom_projet === "number") {
            label = Object.keys(projetsDictGlobal).find(key => projetsDictGlobal[key] === r.Nom_projet);
          }
        
          return (
            typeof r.Type_document === "string" &&
            r.Type_document.trim() !== "" &&
            label === selectedProject
          );
        });
        
        const types = [...new Set(validRows.map(r => r.Type_document))].sort();
        const newSelectedType = types.includes(selectedType) ? selectedType : types[0] || "";
      
        window.updateRecordsFromAffichage(rows, selectedProject, newSelectedType);
        if (window.updateTypeOptions) {
          window.updateTypeOptions(rows);
        }
        
        if (grist && grist._eventHandlers && grist._eventHandlers.onRecords) {
          const handler = grist._eventHandlers.onRecords[0];
          if (typeof handler === "function") {
            handler(rows); 
          }
        }    
      } catch (err) {
        td.style.backgroundColor = "#842029";
        td.style.color = "#fff";
      }   
      
    } catch (err) {
      console.error("Erreur après ajout :", err);
    }
    
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

