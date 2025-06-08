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
    tdNum.dataset.typeDocument = plan.Type_document;
    tdNum.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNum);

    const tdNom = document.createElement("td");
    tdNom.textContent = plan.Designation2;
    tdNom.classList.add("nomplan");
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

document.addEventListener("focusout", async (e) => {
  const td = e.target;
  if (td.tagName !== "TD" || !td.classList.contains("editable")) return;

  const texte = td.textContent.trim();
  const recordId = td.dataset.recordId;
  const indice = td.dataset.indice;

  const tr = td.parentElement;
  const tds = Array.from(tr.children);
  const N_Document = tds[0]?.textContent.trim();
  const Designation2 = tds[1]?.textContent.trim();
  const Type_document = td.dataset.typeDocument || "";
  const Nom_projet_label = td.dataset.nomProjet || "";

  const isoDate = isValidDate(texte) ? convertToISO(texte) : null;
  if (!isoDate) {
    td.style.backgroundColor = "#842029";
    td.style.color = "#fff";
    return;
  }

  if (recordId) {
    try {
      await grist.docApi.applyUserActions([
        ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId), {
          DateDiffusion: isoDate
        }]
      ]);
      td.style.backgroundColor = "";
      td.style.color = "";
    } catch {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
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
      td.dataset.recordId = res.retValues[0];
      td.classList.remove("ajout");

      const selectedProject = document.getElementById("projectDropdown").value;
      const selectedType = document.getElementById("designationDropdown").value;
      const recordsData = await grist.docApi.fetchTable("ListePlan_NDC_COF");
      const rows = Object.entries(recordsData.records || {}).map(([id, row]) => ({ id: parseInt(id), ...row }));

      const validRows = rows.filter(r =>
        r.Type_document &&
        typeof r.Type_document === "string" &&
        r.Type_document.trim() !== "" &&
        (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet) === selectedProject
      );

      const types = [...new Set(validRows.map(r => r.Type_document))].sort();
      const newSelectedType = types.includes(selectedType) ? selectedType : types[0] || "";

      window.updateRecordsFromAffichage(rows, selectedProject, newSelectedType);

    } catch {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
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
