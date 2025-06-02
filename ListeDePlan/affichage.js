const INDICES = ["0", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

// --- Fonction pour retrouver l'id d'un projet à partir de son nom ---
async function getProjetIdByName(nomProjet) {
  // Récupère tous les projets (si beaucoup de projets, filtre via fetchRecordsByField si dispo)
  const projetsTable = await grist.docApi.fetchTable("Projet");
  const projet = projetsTable.records.find(p => p.Nom === nomProjet);
  return projet ? projet.id : null;
}

function afficherPlansFiltres(projet, typeDoc, records) {
  const zone = document.getElementById("plans-output");
  zone.innerHTML = "";

  // Filtrage des lignes par projet ET typeDoc
  const filtres = records.filter(r =>
    // Pour la référence, r.Nom_projet est soit l'ID (number), soit le nom (string), selon comment tu charges
    (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet) === projet &&
    r.Type_document === typeDoc
  );

  if (filtres.length === 0) {
    zone.innerHTML = "<p>Aucun plan trouvé pour cette sélection.</p>";
    return;
  }

  // Regrouper les plans par N_Document + Designation2
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

  // Récupérer tous les indices utilisés (pour afficher les colonnes nécessaires)
  const allIndicesUsed = new Set();
  for (const plan of plansMap.values()) {
    for (const ind in plan.lignes) {
      allIndicesUsed.add(ind);
    }
  }
  let lastUsedIndex = Math.max(...[...allIndicesUsed].map(i => INDICES.indexOf(i)).filter(i => i >= 0));
  if (isNaN(lastUsedIndex)) lastUsedIndex = 0;
  const indicesToShow = INDICES.slice(0, lastUsedIndex + 2); // +1 colonne vide

  // Création du tableau
  const table = document.createElement("table");
  table.className = "plan-table";

  // En-tête
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

  // Corps du tableau
  const tbody = document.createElement("tbody");

  // ---- Lignes existantes ----
  for (const plan of plansMap.values()) {
    const tr = document.createElement("tr");

    // N_Document
    const tdNum = document.createElement("td");
    tdNum.textContent = plan.N_Document;
    tdNum.dataset.typeDocument = plan.Type_document;
    tdNum.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNum);

    // Designation2
    const tdNom = document.createElement("td");
    tdNom.textContent = plan.Designation2;
    tdNom.classList.add("nomplan");
    tdNom.dataset.typeDocument = plan.Type_document;
    tdNom.dataset.nomProjet = plan.Nom_projet;
    tr.appendChild(tdNom);

    // Colonnes indices (A, B, C, ...)
    for (const indice of indicesToShow) {
      const td = document.createElement("td");
      td.contentEditable = true;
      td.classList.add("editable");
      if (!["N_Document", "Designation2"].includes(indice)) {
        td.classList.add("indice");
      }
      td.dataset.typeDocument = plan.Type_document;
      td.dataset.nomProjet = plan.Nom_projet;
      td.dataset.nDocument = plan.N_Document;
      td.dataset.designation2 = plan.Designation2;
      td.dataset.indice = indice;

      const rec = plan.lignes[indice];
      if (rec && rec.DateDiffusion) {
        td.textContent = formatDate(rec.DateDiffusion);
        td.dataset.recordId = rec.id;
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // ---- Ligne AJOUT (tout en bas, vide) ----
  const trAjout = document.createElement("tr");
  // Cellule N_Document
  const tdAjoutNum = document.createElement("td");
  tdAjoutNum.contentEditable = true;
  tdAjoutNum.classList.add("editable", "ajout");
  tdAjoutNum.dataset.typeDocument = typeDoc;
  tdAjoutNum.dataset.nomProjet = projet;
  trAjout.appendChild(tdAjoutNum);

  // Cellule Designation2
  const tdAjoutNom = document.createElement("td");
  tdAjoutNom.contentEditable = true;
  tdAjoutNom.classList.add("editable", "ajout");
  tdAjoutNom.dataset.typeDocument = typeDoc;
  tdAjoutNom.dataset.nomProjet = projet;
  trAjout.appendChild(tdAjoutNom);

  // Cellules indices
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

  // Finalisation
  table.appendChild(tbody);
  zone.appendChild(table);

  // ---------- Event de BLUR pour UPDATE, AJOUT, SUPPR ----------
  table.addEventListener("blur", async (e) => {
    const td = e.target;
    if (
      td.tagName !== "TD" ||
      !td.dataset.indice ||
      !td.isContentEditable
    ) return;

    const texte = td.textContent.trim();
    const recordId = td.dataset.recordId;
    const isAjout = td.classList.contains("ajout");

    // Suppression
    if (!texte && recordId) {
      try {
        await grist.docApi.applyUserActions([
          ["RemoveRecord", "ListePlan_NDC_COF", parseInt(recordId)]
        ]);
        // (rafraîchis tes records/table ici si besoin)
      } catch (err) {
        console.error("Erreur suppression :", err);
        td.style.backgroundColor = "#842029";
        td.style.color = "#fff";
      }
      return;
    }

    // Vérification format date
    if (!isValidDate(texte)) {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
      return;
    }

    const isoDate = convertToISO(texte);

    // Récupérer toute la ligne (<tr>)
    const tr = td.parentElement;
    const tds = Array.from(tr.children);

    // Récupérer infos
    const nDocument = tds[0]?.textContent.trim();
    const designation2 = tds[1]?.textContent.trim();
    const typeDocument = td.dataset.typeDocument || tds[0]?.dataset.typeDocument || "";
    const nomProjet = td.dataset.nomProjet || tds[0]?.dataset.nomProjet || "";
    const indice = td.dataset.indice;

    // --- Correction : obtenir l'ID du projet avant tout ajout/update ---
    const projetId = await getProjetIdByName(nomProjet);

    if (!projetId) {
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
      console.error("Projet inconnu:", nomProjet);
      return;
    }

    const rowData = {
      Nom_projet: projetId, // <--- Envoie l'ID ici !!!
      Type_document: typeDocument,
      N_Document: nDocument,
      Designation2: designation2,
      Indice: indice,
      DateDiffusion: isoDate
    };

    try {
      if (recordId) {
        // Update
        await grist.docApi.applyUserActions([
          ["UpdateRecord", "ListePlan_NDC_COF", parseInt(recordId), { DateDiffusion: isoDate }]
        ]);
      } else if (isAjout) {
        // AJOUT (ligne du bas) : ajoute seulement si toutes les infos sont bien renseignées
        if (!nDocument || !designation2 || !isoDate) return;
        const res = await grist.docApi.applyUserActions([
          ["AddRecord", "ListePlan_NDC_COF", null, rowData]
        ]);
        td.dataset.recordId = res.retValues[0];
      } else {
        // Ajout normal (par ex si pas déjà ajouté)
        const res = await grist.docApi.applyUserActions([
          ["AddRecord", "ListePlan_NDC_COF", null, rowData]
        ]);
        td.dataset.recordId = res.retValues[0];
      }

      td.style.backgroundColor = "";
      td.style.color = "";

      // Ici, tu peux rafraîchir l'affichage si tu veux, par exemple en rappelant la fonction principale
      // afficherPlansFiltres(projet, typeDoc, ...);
    } catch (err) {
      console.error("Erreur Grist :", err);
      td.style.backgroundColor = "#842029";
      td.style.color = "#fff";
    }
  }, true);
}

// Fonctions utilitaires
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
