const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

function afficherPlansFiltres(projet, designation, records) {
  const zone = document.getElementById("plans-output");
  zone.innerHTML = "";

  const filtres = records.filter(r =>
    r.NomProjet === projet && r.Designation === designation
  );

  if (filtres.length === 0) {
    zone.innerHTML = "<p>Aucun plan trouvé pour cette sélection.</p>";
    return;
  }

  const plansMap = new Map();
  for (const r of filtres) {
    const key = `${r.NumeroPlan}___${r.NomPlan}`;
    if (!plansMap.has(key)) {
      plansMap.set(key, {
        NumeroPlan: r.NumeroPlan,
        NomPlan: r.NomPlan,
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
  if (isNaN(lastUsedIndex)) lastUsedIndex = 0;
  const indicesToShow = INDICES.slice(0, lastUsedIndex + 2); // +1 colonne vide

  const table = document.createElement("table");
  table.className = "plan-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["NumeroPlan", "NomPlan", ...indicesToShow].forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    if (title === "NomPlan") th.classList.add("nomplan");
    if (!["NumeroPlan", "NomPlan"].includes(title)) {
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
    tdNum.textContent = plan.NumeroPlan;
    tr.appendChild(tdNum);

    const tdNom = document.createElement("td");
    tdNom.textContent = plan.NomPlan;
    tdNom.classList.add("nomplan");
    tr.appendChild(tdNom);

    for (const indice of indicesToShow) {
      const td = document.createElement("td");
      td.contentEditable = true;
      td.classList.add("editable");
      if (!["NumeroPlan", "NomPlan"].includes(indice)) {
        td.classList.add("indice");
      }

      const rec = plan.lignes[indice];
      if (rec && rec.DateDiffusion) {
        td.textContent = formatDate(rec.DateDiffusion);
        td.dataset.recordId = rec.id;
      }

      td.dataset.numeroPlan = plan.NumeroPlan;
      td.dataset.nomPlan = plan.NomPlan;
      td.dataset.indice = indice;
      td.dataset.nomProjet = projet;
      td.dataset.designation = designation;

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  zone.appendChild(table);

  table.addEventListener("blur", async (e) => {
    const td = e.target;
    if (
      td.tagName !== "TD" ||
      !td.dataset.indice ||
      !td.isContentEditable
    ) return;

    const texte = td.textContent.trim();
    const recordId = td.dataset.recordId;

    // Suppression
    if (!texte && recordId) {
      try {
        await grist.docApi.applyUserActions([
          ["RemoveRecord", "ListePlan_NDC_COF", parseInt(recordId)]
        ]);
        grist.docApi.fetchTable("ListePlan_NDC_COF").then(table => {
          const converted = [];
          const keys = Object.keys(table);
          const nbRows = table[keys[0]].length;
          for (let i = 0; i < nbRows; i++) {
            const row = {};
            for (const key of keys) {
              row[key] = table[key][i];
            }
            converted.push(row);
          }
        
          // Met à jour la variable globale "records" dans script.js
          if (typeof window.updateRecordsFromAffichage === "function") {
            window.updateRecordsFromAffichage(converted);
          }
        
          const selectedProject = window.currentProjet || document.getElementById("projectDropdown").value;
          const selectedDesignation = window.currentDesignation || document.getElementById("designationDropdown").value;

          if (typeof window.updateRecordsFromAffichage === "function") {
            window.updateRecordsFromAffichage(converted, selectedProject, selectedDesignation);
          }
          afficherPlansFiltres(selectedProject, selectedDesignation, converted);
        });      
      } catch (err) {
        console.error("Erreur suppression :", err);
        td.style.backgroundColor = "#842029";
        td.style.color = "#fff";
      }
      return;
    }

    if (!isValidDate(texte)) {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
      return;
    }

    const isoDate = convertToISO(texte);
    const rowData = {
      NomProjet: td.dataset.nomProjet,
      Designation: td.dataset.designation,
      NumeroPlan: td.dataset.numeroPlan,
      NomPlan: td.dataset.nomPlan,
      Indice: td.dataset.indice,
      DateDiffusion: isoDate
    };

    try {
      const projets = await grist.docApi.fetchTable('Projet');
      const projectIndex = projets.Projet.indexOf(td.dataset.nomProjet);
      if (projectIndex === -1) throw new Error("Projet introuvable");
      const projectId = projets.id[projectIndex];
      rowData.NomProjet = projectId;

      if (recordId) {
        await grist.docApi.applyUserActions([
          ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId), { DateDiffusion: isoDate }]
        ]);
      } else {
        const res = await grist.docApi.applyUserActions([
          ["AddRecord", "ListePlan_NDC_COF", null, rowData]
        ]);
        td.dataset.recordId = res.retValues[0];
      }

      grist.docApi.fetchTable("ListePlan_NDC_COF").then(table => {
        const converted = [];
        const keys = Object.keys(table);
        const nbRows = table[keys[0]].length;
        for (let i = 0; i < nbRows; i++) {
          const row = {};
          for (const key of keys) {
            row[key] = table[key][i];
          }
          converted.push(row);
        }
      
        if (typeof window.updateRecordsFromAffichage === "function") {
          window.updateRecordsFromAffichage(converted);
        }
      
        const selectedProject = window.currentProjet || document.getElementById("projectDropdown").value;
        const selectedDesignation = window.currentDesignation || document.getElementById("designationDropdown").value;

        if (typeof window.updateRecordsFromAffichage === "function") {
          window.updateRecordsFromAffichage(converted, selectedProject, selectedDesignation);
        }
        afficherPlansFiltres(selectedProject, selectedDesignation, converted);
      });      
    } catch (err) {
      console.error("Erreur Grist :", err);
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
  }, true);
}

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
