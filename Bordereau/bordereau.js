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
const PROJET_TABLE = "Projets2";
const SHARED_PROJECT_STORAGE_KEY = "grist.selected-project";
const SHARED_PROJECT_ID_STORAGE_KEY = "grist.selected-project-id";
let _projectsData = []; // [{id, number, name}]

function readSharedProjectId() {
  try {
    const raw = localStorage.getItem(SHARED_PROJECT_ID_STORAGE_KEY);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_e) { return null; }
}

/** -------------------------
 *  Helpers DOM
 *  ------------------------- */
const $ = (id) => document.getElementById(id);

function getProject() {
  return $("projectDropdown").value;
}

function readSharedProjectSelection() {
  try {
    return String(localStorage.getItem(SHARED_PROJECT_STORAGE_KEY) || "").trim();
  } catch (_error) {
    return "";
  }
}

function saveSharedProjectSelection(projectName = "") {
  try {
    const normalizedProject = String(projectName || "").trim();
    if (normalizedProject) {
      localStorage.setItem(SHARED_PROJECT_STORAGE_KEY, normalizedProject);
      const project = _projectsData.find(
        (p) => p.name.trim().toLowerCase() === normalizedProject.toLowerCase()
      );
      if (project) localStorage.setItem(SHARED_PROJECT_ID_STORAGE_KEY, String(project.id));
    } else {
      localStorage.removeItem(SHARED_PROJECT_STORAGE_KEY);
      localStorage.removeItem(SHARED_PROJECT_ID_STORAGE_KEY);
    }
  } catch (_error) {
    // localStorage peut etre indisponible dans certains contextes embarques.
  }
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
  document.body.classList.toggle("is-frozen", !!frozen);
  $("dateInput").disabled = frozen;
  $("addItem").disabled = frozen;

  // $("refUp").disabled = frozen;
  // $("refDown").disabled = frozen;
  // $("refInput").disabled = frozen;
  // $("projectDropdown").disabled = frozen;

  // Re-render pour désactiver selects + supprimer dans le tableau
  displayInvoiceTable();
}

function renderEmptyTableRow(message) {
  const tbody = document.querySelector("#invoiceTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const row = tbody.insertRow();
  row.className = "empty-row";
  const cell = row.insertCell();
  cell.colSpan = 5;
  cell.textContent = message;
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

  // Construire _projectsData depuis allProjects (table Projets complète)
  const ids = Array.isArray(allProjects.id) ? allProjects.id : [];
  const numbers = Array.isArray(allProjects.Numero_de_projet) ? allProjects.Numero_de_projet : [];
  const names = Array.isArray(allProjects.Nom_de_projet) ? allProjects.Nom_de_projet : [];
  _projectsData = ids
    .map((id, i) => ({
      id: Number(id),
      number: String(numbers[i] || '').trim(),
      name: String(names[i] || '').trim(),
    }))
    .filter((p) => p.id > 0 && p.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }));

  const currentId = readSharedProjectId();
  const currentValue = projectDropdown.value || readSharedProjectSelection();

  while (projectDropdown.options.length > 1) projectDropdown.remove(1);

  _projectsData.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.name;
    option.textContent = `${p.number} - ${p.name}`;
    option.dataset.projectId = String(p.id);
    projectDropdown.appendChild(option);
  });

  // Restaurer par ID d'abord, puis par nom
  let restored = '';
  if (currentId) {
    const found = _projectsData.find((p) => p.id === currentId);
    if (found) restored = found.name;
  }
  if (!restored) {
    const norm = (s) => String(s || '').trim().toLowerCase();
    const found = _projectsData.find((p) => norm(p.name) === norm(currentValue));
    if (found) restored = found.name;
  }
  projectDropdown.value = restored;
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

  if (!selectedProjectName) {
    renderEmptyTableRow("Choisir un projet");
    return;
  }
  if (!refValue) {
    renderEmptyTableRow("Reference invalide");
    return;
  }

  const frozen = isFrozen();

  const refRecords = records.filter(
    (r) => r.Projet === selectedProjectName && r.Ref == refValue
  );
  if (refRecords.length === 0) {
    renderEmptyTableRow("Aucun element sur ce bordereau");
    return;
  }

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
    deleteCell.appendChild(deleteBtn);
  });
}

/** -------------------------
 *  Events UI : projet / ref / date / envoyé
 *  ------------------------- */
$("projectDropdown").addEventListener("change", async () => {
  const selectedProjectName = getProject();
  saveSharedProjectSelection(selectedProjectName);

  if (selectedProjectName) {
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
    alert("Ajoute au moins un \u00e9l\u00e9ment avant de marquer 'Envoy\u00e9'.");
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
    alert("Bordereau marqu\u00e9 'Envoy\u00e9' : modification impossible.");
    return;
  }

  const selectedProjectName = getProject();
  if (!selectedProjectName) {
    alert("Veuillez d'abord s\u00e9lectionner un projet.");
    return;
  }

  const date = getDateValue();
  if (!date) {
    alert("Veuillez entrer une date valide avant d'ajouter un \u00e9l\u00e9ment.");
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
    alert("Veuillez s\u00e9lectionner un projet pour g\u00e9n\u00e9rer le bordereau.");
    return;
  }

  const projectRecords = records.filter((r) => r.Projet === selectedProject && r.Ref == refValue);
  const totalPages = Math.ceil(projectRecords.length / ITEMS_PER_PAGE);

  const dateStr = new Date(getDateValue()).toLocaleDateString("fr-FR");

const logo1 = await fetch("../img/VC_Logotype_Digital_RVB.jpg").then((res) => res.blob());
  const logo2 = await fetch("../img/bloc délégation bleu.png").then((res) => res.blob());
  const logo3 = await fetch("../img/Logo DRTO fr - Bleu.png").then((res) => res.blob());

  const addHeader = () => {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.addImage(URL.createObjectURL(logo1), "JPEG", 10, 10, 40, 15);
    doc.addImage(URL.createObjectURL(logo2), "PNG", pageWidth - 72, 10, 40, 15);
    doc.addImage(URL.createObjectURL(logo3), "PNG", pageWidth - 30, 10, 15, 15);
    doc.setFontSize(18);
    doc.text("BORDEREAU DE TRANSMISSION", 14, 40);
    doc.setFontSize(12);
    doc.text(`Date: ${dateStr}`, 14, 50);
    doc.text(`Projet: ${selectedProject}`, 14, 60);
    doc.text(`Ref: ${refValue || ""}`, 14, 65);
  };

  const addFooter = (pageNumber, totalPages) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const finalY = doc.lastAutoTable?.finalY || 70;
    if (pageNumber === totalPages) {
      doc.text("Nous vous en souhaitons bonne r\u00e9ception et restons \u00e0 votre disposition.", 14, finalY + 10);
      doc.text("DRTO", 170, finalY + 20);
    }
    doc.text(`Page ${pageNumber} / ${totalPages}`, pageWidth - 30, pageHeight - 10);
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
      head: [["N\u00b0 Plan", "Indice", "D\u00e9signation", "Nbr Exemplaires"]],
      body,
    });

    addFooter(i + 1, totalPages);
  }

  doc.save(`${selectedProject} - Bordereau n\u00b0${refValue}.pdf`);
});

// Synchronisation inter-widgets : réagit quand un autre widget change le projet sélectionné
(function () {
  if (window.__lpStorageSyncAdded_bordereau) return;
  window.__lpStorageSyncAdded_bordereau = true;
  var _nk = function (s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  };
  window.addEventListener('storage', function (event) {
    var dropdown = document.getElementById('projectDropdown');
    if (!dropdown) return;
    if (event.key === 'grist.selected-project-id' && event.newValue) {
      var idStr = String(event.newValue).trim();
      var match = Array.from(dropdown.options).find(function (o) { return o.dataset.projectId === idStr; });
      if (match && dropdown.value !== match.value) {
        dropdown.value = match.value;
        dropdown.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (event.key !== 'grist.selected-project' || !event.newValue) return;
    var newProject = String(event.newValue).trim();
    var match = Array.from(dropdown.options).find(function (o) { return _nk(o.value) === _nk(newProject); });
    if (match && dropdown.value !== match.value) {
      dropdown.value = match.value;
      dropdown.dispatchEvent(new Event('change'));
    }
  });
})();
