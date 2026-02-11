/* bordereau.js */

grist.ready({ requiredAccess: "full" });

/** -------------------------
 *  Constantes / état global
 *  ------------------------- */
let records = [];
let allPlans = [];
let allProjects = [];

const BORDEREAU_TABLE = "Envois";
const PLANS_TABLE = "ListePlan_NDC_COF";
const PROJET_TABLE = "Projets";

/** -------------------------
 *  Helpers DOM
 *  ------------------------- */
const $ = (id) => document.getElementById(id);

function getProject() {
  return $("projectDropdown").value;
}

function getRef() {
  return $("refInput").value;
}

function setRef(value) {
  const v = Math.max(1, Number(value) || 1);
  $("refInput").value = String(v);
  updateArrowButtons();
}

function getDateValue() {
  return $("dateInput").value;
}

/** -------------------------
 *  Helpers data (bordereau courant)
 *  ------------------------- */
function getCurrentProjectRef() {
  return { projet: getProject(), ref: getRef() };
}

function getCurrentBordereauRecords() {
  const { projet, ref } = getCurrentProjectRef();
  if (!projet || !ref) return [];
  return records.filter((r) => r.Projet === projet && r.Ref == ref);
}

/** -------------------------
 *  Gestion "Envoyé" (freeze)
 *  ------------------------- */
function isFrozen() {
  return $("sentCheckbox")?.checked === true;
}

function applyFrozenUI(frozen) {
  $("dateInput").disabled = frozen;
  $("addItem").disabled = frozen;

  // $("refUp").disabled = frozen;
  // $("refDown").disabled = frozen;
  // $("refInput").disabled = frozen;
  // $("projectDropdown").disabled = frozen;

  // Re-render pour désactiver selects + supprimer dans le tableau
  displayInvoiceTable();
}

function setSentCheckboxState({ checked, disabled }) {
  const cb = $("sentCheckbox");
  if (!cb) return;
  cb.checked = !!checked;
  cb.disabled = !!disabled;
}

async function updateEnvoyeForCurrentBordereau(sent) {
  const current = getCurrentBordereauRecords();
  if (current.length === 0) return;

  const updates = current.map((r) => [
    "UpdateRecord",
    BORDEREAU_TABLE,
    r.id,
    { Envoye: sent },
  ]);

  await grist.docApi.applyUserActions(updates);
}

/** -------------------------
 *  Grist records (view)
 *  ------------------------- */
grist.onRecords(async (newRecords) => {
  records = newRecords || [];

  // Tables de référence
  allPlans = await grist.docApi.fetchTable(PLANS_TABLE);
  allProjects = await grist.docApi.fetchTable(PROJET_TABLE);

  populateProjectDropdown();

  // sync UI (date + envoyé + table)
  await loadBordereauData();
  displayInvoiceTable();
});

/** -------------------------
 *  Dropdown projet
 *  ------------------------- */
function populateProjectDropdown() {
  const projectDropdown = $("projectDropdown");
  const projects = [...new Set(allProjects.Nom_de_projet)].filter(Boolean).sort();

  const currentValue = projectDropdown.value;

  // On garde l'option 0 "Sélectionner..." puis on reconstruit le reste
  while (projectDropdown.options.length > 1) projectDropdown.remove(1);

  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project;
    option.textContent = project;
    projectDropdown.appendChild(option);
  });

  // restore si possible
  projectDropdown.value = currentValue;
}

/** -------------------------
 *  Ref : input + flèches
 *  ------------------------- */
function updateArrowButtons() {
  const numericValue = parseInt($("refInput").value, 10);
  $("refDown").disabled = !Number.isFinite(numericValue) || numericValue <= 1;
}

function updateRefValue(delta) {
  const current = parseInt($("refInput").value, 10) || 1;
  const next = current + delta;
  if (next < 1) return;
  setRef(next);
  $("refInput").dispatchEvent(new Event("change"));
}

/** -------------------------
 *  Chargement bordereau : date + "envoyé"
 *  ------------------------- */
async function loadBordereauData() {
  updateArrowButtons();

  const selectedProjectName = getProject();
  const refInput = $("refInput");
  const dateInput = $("dateInput");

  // si projet vide
  if (!selectedProjectName) {
    refInput.value = "";
    dateInput.value = "";
    setSentCheckboxState({ checked: false, disabled: true });
    applyFrozenUI(false);
    return;
  }

  // ref minimum = 1
  if (!refInput.value) refInput.value = "1";

  const refValue = refInput.value;
  const projectRecords = records.filter(
    (r) => r.Projet === selectedProjectName && r.Ref == refValue
  );

  // ---- Date ----
  if (projectRecords.length > 0) {
    const firstRecord = projectRecords[0];
    const timestamp = firstRecord.Date_Bordereau;

    try {
      let date = null;

      if (timestamp) {
        if (typeof timestamp === "number") {
          // unix seconds
          date = new Date(timestamp * 1000);
        } else {
          date = new Date(timestamp);
        }

        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 3000) {
          dateInput.value = date.toISOString().split("T")[0];
        } else {
          dateInput.value = "";
        }
      } else {
        dateInput.value = "";
      }
    } catch (e) {
      console.error("Date parsing failed:", e);
      dateInput.value = "";
    }
  } else {
    // nouveau bordereau => date vide (l'utilisateur la mettra avant d'ajouter)
    dateInput.value = "";
  }

  // ---- Envoyé ----
  if (projectRecords.length > 0) {
    // Si tu as des enregistrements, on peut (dé)cocher
    const sent = !!projectRecords[0].Envoye;
    setSentCheckboxState({ checked: sent, disabled: false });
    applyFrozenUI(sent);
  } else {
    setSentCheckboxState({ checked: false, disabled: true });
    applyFrozenUI(false);
  }
}

/** -------------------------
 *  Update date (sur toutes les lignes du bordereau)
 *  ------------------------- */
async function updateBordereauData() {
  if (isFrozen()) return;

  const selectedProjectName = getProject();
  if (!selectedProjectName) return;

  const ref = getRef();
  const date = getDateValue();
  if (!ref) return;

  const projectRecords = records.filter(
    (r) => r.Projet === selectedProjectName && r.Ref == ref
  );

  if (projectRecords.length > 0) {
    const updates = projectRecords.map((r) => [
      "UpdateRecord",
      BORDEREAU_TABLE,
      r.id,
      { Date_Bordereau: date },
    ]);
    await grist.docApi.applyUserActions(updates);
  }
}

/** -------------------------
 *  Rendu du tableau
 *  ------------------------- */
function displayInvoiceTable() {
  const selectedProjectName = getProject();
  const refValue = getRef();
  const tbody = document.querySelector("#invoiceTable tbody");
  tbody.innerHTML = "";

  if (!selectedProjectName) return;
  if (!refValue) return;

  const frozen = isFrozen();

  const refRecords = records.filter(
    (r) => r.Projet === selectedProjectName && r.Ref == refValue
  );
  if (refRecords.length === 0) return;

  const allProjectRecords = records.filter((r) => r.Projet === selectedProjectName);

  // Options NbrExemplaires : valeurs existantes sur le projet
  const exemplairesOptions = [...new Set(allProjectRecords.map((r) => r.NbrExemplaires).filter(Boolean))].sort();

  // Options plans : uniquement ceux qui ont un Indice non vide dans ListePlan_NDC_COF
  const planIndices = allPlans.Nom_projet.reduce((indices, projId, index) => {
    if (
      projId === selectedProjectName &&
      allPlans.Indice[index] &&
      String(allPlans.Indice[index]).trim()
    ) {
      indices.push(index);
    }
    return indices;
  }, []);

  const planNumbers = [...new Set(planIndices.map((i) => allPlans.NumeroDocument[i]))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
  );

  refRecords.forEach((record) => {
    const row = tbody.insertRow();
    row.dataset.recordId = record.id;

    // --- N° Plan ---
    const nPlanCell = row.insertCell();
    const nPlanSelect = document.createElement("select");
    nPlanSelect.innerHTML = `<option value="">Choisir un plan</option>`;

    planNumbers.forEach((planNumber) => {
      const option = document.createElement("option");
      option.value = planNumber;
      option.textContent = planNumber;
      nPlanSelect.appendChild(option);
    });

    nPlanSelect.value = record.N_Plan || "";
    nPlanSelect.disabled = frozen;
    nPlanCell.appendChild(nPlanSelect);

    // --- Indice ---
    const indiceCell = row.insertCell();
    indiceCell.textContent = record.Indice || "";

    // --- Désignation ---
    const designationCell = row.insertCell();
    designationCell.textContent = record.Designation || "";

    // --- Nbr Exemplaires ---
    const nbrExemplairesCell = row.insertCell();
    const nbrExemplairesSelect = document.createElement("select");

    // option vide en premier
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "---";
    nbrExemplairesSelect.appendChild(blankOption);

    exemplairesOptions.forEach((val) => {
      const option = document.createElement("option");
      option.value = val;
      option.textContent = val;
      nbrExemplairesSelect.appendChild(option);
    });

    nbrExemplairesSelect.value = record.NbrExemplaires || "";
    nbrExemplairesSelect.disabled = frozen;
    nbrExemplairesCell.appendChild(nbrExemplairesSelect);

    // --- Supprimer ---
    const deleteCell = row.insertCell();
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Supprimer";
    deleteBtn.className = "delete-btn";
    deleteBtn.disabled = frozen;
    if (frozen) {
      deleteBtn.style.opacity = "0.5";
      deleteBtn.style.cursor = "not-allowed";
    }
    deleteCell.appendChild(deleteBtn);
  });
}

/** -------------------------
 *  Events UI : projet / ref / date / envoyé
 *  ------------------------- */
$("projectDropdown").addEventListener("change", async () => {
  const selectedProjectName = getProject();

  if (selectedProjectName) {
    // ✅ Toujours 1 quand on choisit un projet
    setRef(1);
  } else {
    $("refInput").value = "";
  }

  await loadBordereauData();
  displayInvoiceTable();
});

$("refInput").addEventListener("change", async () => {
  // si vide => 1
  if (!$("refInput").value) setRef(1);
  await loadBordereauData();
  displayInvoiceTable();
});

$("refInput").addEventListener("input", (e) => {
  const refInput = e.target;
  refInput.value = refInput.value.replace(/[^0-9]/g, "");
  const numericValue = parseInt(refInput.value, 10);
  if (!Number.isFinite(numericValue) || numericValue < 1) {
    refInput.value = "1";
  }
  updateArrowButtons();
});

$("dateInput").addEventListener("change", () => updateBordereauData());

$("refUp").addEventListener("click", () => updateRefValue(1));
$("refDown").addEventListener("click", () => updateRefValue(-1));

$("sentCheckbox").addEventListener("change", async (e) => {
  const sent = e.target.checked;
  const { projet, ref } = getCurrentProjectRef();

  if (!projet || !ref) {
    e.target.checked = false;
    return;
  }

  const current = getCurrentBordereauRecords();
  if (current.length === 0) {
    alert("Ajoute au moins un élément avant de marquer 'Envoyé'.");
    e.target.checked = false;
    return;
  }

  await updateEnvoyeForCurrentBordereau(sent);
  applyFrozenUI(sent);
});

/** -------------------------
 *  Add item
 *  ------------------------- */
$("addItem").addEventListener("click", async () => {
  if (isFrozen()) {
    alert("Bordereau marqué 'Envoyé' : modification impossible.");
    return;
  }

  const selectedProjectName = getProject();
  if (!selectedProjectName) {
    alert("Veuillez d'abord sélectionner un projet.");
    return;
  }

  const date = getDateValue();
  if (!date) {
    alert("Veuillez entrer une date valide avant d'ajouter un élément.");
    return;
  }

  const ref = getRef() || "1";

  await grist.docApi.applyUserActions([
    [
      "AddRecord",
      BORDEREAU_TABLE,
      null,
      {
        Projet: selectedProjectName,
        Ref: Number(ref),
        Date_Bordereau: date,
        Envoye: false, // défaut
      },
    ],
  ]);
});

/** -------------------------
 *  Table events (change / delete / dblclick)
 *  ------------------------- */
document.querySelector("#invoiceTable").addEventListener("change", async (e) => {
  if (isFrozen()) return;

  const target = e.target;
  const row = target.closest("tr");
  if (!row) return;

  const recordId = parseInt(row.dataset.recordId, 10);
  if (!Number.isFinite(recordId)) return;

  // N_Plan (col 0)
  if (target.tagName === "SELECT" && target.parentElement.cellIndex === 0) {
    const nPlan = target.value;
    const selectedProjectName = getProject();

    const matchingPlans = allPlans.id
      .map((id, i) => ({
        id,
        NumeroDocument: allPlans.NumeroDocument[i],
        Indice: allPlans.Indice[i],
        Designation: allPlans.Designation[i],
        Nom_projet: allPlans.Nom_projet[i],
      }))
      .filter((p) => p.NumeroDocument === nPlan && p.Nom_projet === selectedProjectName);

    if (matchingPlans.length > 0) {
      // ⚠️ garde ton comportement existant (comparaison string)
      const latestPlan = matchingPlans.reduce((latest, current) =>
        latest.Indice > current.Indice ? latest : current
      );

      const { Indice: indice, Designation: designation } = latestPlan;

      await grist.docApi.applyUserActions([
        ["UpdateRecord", BORDEREAU_TABLE, recordId, { N_Plan: nPlan, Indice: indice, Designation: designation }],
      ]);
    } else {
      // si plan vidé
      await grist.docApi.applyUserActions([
        ["UpdateRecord", BORDEREAU_TABLE, recordId, { N_Plan: "", Indice: "", Designation: "" }],
      ]);
    }
  }

  // NbrExemplaires (col 3)
  if (target.tagName === "SELECT" && target.parentElement.cellIndex === 3) {
    const nbrExemplaires = target.value;
    await grist.docApi.applyUserActions([
      ["UpdateRecord", BORDEREAU_TABLE, recordId, { NbrExemplaires: nbrExemplaires }],
    ]);
  }
});

document.querySelector("#invoiceTable").addEventListener("click", async (e) => {
  if (isFrozen()) return;

  if (e.target.classList.contains("delete-btn")) {
    const row = e.target.closest("tr");
    if (!row) return;
    const recordId = parseInt(row.dataset.recordId, 10);
    if (!Number.isFinite(recordId)) return;

    await grist.docApi.applyUserActions([["RemoveRecord", BORDEREAU_TABLE, recordId]]);
  }
});

document.querySelector("#invoiceTable").addEventListener("dblclick", (e) => {
  if (isFrozen()) return;

  const target = e.target;

  // Double-clic sur NbrExemplaires (col 3) => input libre
  if (target.tagName === "SELECT" && target.parentElement.cellIndex === 3) {
    const cell = target.parentElement;
    const originalValue = target.value;

    const input = document.createElement("input");
    input.type = "text";
    input.value = originalValue;

    cell.innerHTML = "";
    cell.appendChild(input);
    input.focus();

    const saveAndRevert = async () => {
      const newValue = input.value;
      const row = cell.closest("tr");
      const recordId = parseInt(row.dataset.recordId, 10);
      if (!Number.isFinite(recordId)) return;

      await grist.docApi.applyUserActions([
        ["UpdateRecord", BORDEREAU_TABLE, recordId, { NbrExemplaires: newValue }],
      ]);

      displayInvoiceTable();
    };

    input.addEventListener("blur", saveAndRevert);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        input.blur();
      } else if (ev.key === "Escape") {
        input.removeEventListener("blur", saveAndRevert);
        displayInvoiceTable();
      }
    });
  }
});

/** -------------------------
 *  PDF (inchangé, autorisé même si Envoyé)
 *  ------------------------- */
$("generatePdf").addEventListener("click", async () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const ITEMS_PER_PAGE = 15;

  const selectedProject = getProject();
  const refValue = getRef();

  if (!selectedProject) {
    alert("Veuillez sélectionner un projet pour générer le bordereau.");
    return;
  }

  const projectRecords = records.filter((r) => r.Projet === selectedProject && r.Ref == refValue);
  const totalPages = Math.ceil(projectRecords.length / ITEMS_PER_PAGE);

  const dateStr = new Date(getDateValue()).toLocaleDateString("fr-FR");

  const logo1 = await fetch("img/Petit_Logotype_Digital_Couleurs.png").then((res) => res.blob());
  const logo2 = await fetch("img/Dumez_Ile_de_France_Logotype_Digital_Couleurs.png").then((res) => res.blob());
  const logo3 = await fetch("img/Neom_Logotype_Digital_Couleurs.png").then((res) => res.blob());

  const addHeader = () => {
    doc.addImage(URL.createObjectURL(logo1), "PNG", 10, 10, 30, 15);
    doc.addImage(URL.createObjectURL(logo2), "PNG", 50, 10, 30, 15);
    doc.addImage(URL.createObjectURL(logo3), "PNG", 90, 10, 30, 15);
    doc.setFontSize(18);
    doc.text("BORDEREAU DE TRANSMISSION", 14, 40);
    doc.setFontSize(12);
    doc.text(`Date: ${dateStr}`, 14, 50);
    doc.text(`Projet: ${selectedProject}`, 14, 60);
    doc.text(`Ref: ${refValue || ""}`, 14, 65);
  };

  const addFooter = (pageNumber, totalPages, isLastPage) => {
    const finalY = doc.lastAutoTable?.finalY || 70;
    if (isLastPage) {
      doc.text("Nous vous en souhaitons bonne réception et restons à votre disposition.", 14, finalY + 10);
      doc.text("DRTO", 170, finalY + 20);
    }
    doc.text(`Page ${pageNumber}/${totalPages}`, 175, 280);
  };

  for (let i = 0; i < totalPages; i++) {
    if (i > 0) doc.addPage();
    addHeader();

    const start = i * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageRecords = projectRecords.slice(start, end);
    const body = pageRecords.map((r) => [r.N_Plan, r.Indice, r.Designation, r.NbrExemplaires]);

    doc.autoTable({
      startY: 75,
      head: [["N° Plan", "Indice", "Désignation", "Nbr Exemplaires"]],
      body,
    });

    addFooter(i + 1, totalPages, i === totalPages - 1);
  }

  doc.save(`${selectedProject} - Bordereau n°${refValue}.pdf`);
});
