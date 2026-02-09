let selectedProject = "";
let selectedDocName = "";
let selectedDocNumber = null;

// "ALL" | "NO_INDICE_NOT_BLOCKING" | "NO_INDICE_BLOCKING" | "WITH_INDICE"
let sliceFilter = "ALL";

const firstDropdown = document.getElementById("firstColumnDropdown");
const secondDropdown = document.getElementById("secondColumnListbox");
const pieCanvas = document.getElementById("pieCanvas");
const legend = document.getElementById("legend");

function setSecondDropdownDisabled(disabled) {
  secondDropdown.disabled = disabled;
  secondDropdown.innerHTML = `<option value="ALL">Tous</option>`;
  secondDropdown.value = "ALL";
}

function populateFirstColumnDropdown(projects) {
  const current = firstDropdown.value;

  firstDropdown.innerHTML = `<option value="">Selectionner un projet</option>`;
  (projects || []).forEach(p => {
    const v = String(p || "").trim();
    if (!v) return;
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    firstDropdown.appendChild(opt);
  });

  if ([...firstDropdown.options].some(o => o.value === current)) firstDropdown.value = current;
  else firstDropdown.value = "";
}

function buildDocumentOptionsForProject(project) {
  const map = new Map();

  (App.records || []).forEach(rec => {
    if (!rec) return;
    if (String(rec.NomProjet || "").trim() !== project) return;

    const name = String(rec.NomDocument || "").trim();
    if (!name) return;

    const num = normalizeNumero(rec.NumeroDocument);
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(num);
  });

  const opts = [];
  for (const [name, setNums] of map.entries()) {
    const nums = Array.from(setNums);
    nums.sort((a, b) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    });

    nums.forEach(n => {
      const value = JSON.stringify({ name, n: (n == null ? null : Number(n)) });
      const label = makeDocLabel(name, n);
      opts.push({ value, label, name, n });
    });
  }

  opts.sort((a, b) => {
    const an = a.n == null ? Infinity : a.n;
    const bn = b.n == null ? Infinity : b.n;
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  });

  return opts;
}

function populateSecondColumnListbox(project) {
  secondDropdown.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "ALL";
  allOpt.textContent = "Tous";
  secondDropdown.appendChild(allOpt);

  const opts = buildDocumentOptionsForProject(project);
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    secondDropdown.appendChild(opt);
  }
}

function matchesSelectedDocument(rec) {
  if (!selectedDocName) return true;

  const recName = String(rec.NomDocument || "").trim();
  if (recName !== selectedDocName) return false;

  const recNum = normalizeNumero(rec.NumeroDocument);
  return (recNum == null && selectedDocNumber == null) || (recNum === selectedDocNumber);
}

function getBaseRows() {
  if (!selectedProject) return [];

  return (App.records || []).filter(rec => {
    if (!rec) return false;
    if (String(rec.NomProjet || "").trim() !== selectedProject) return false;
    if (!matchesSelectedDocument(rec)) return false;
    return true; // plus de filtre EN ATTENTE
  });
}

function applySliceFilter(rows) {
  if (sliceFilter === "ALL") return rows;

  if (sliceFilter === "WITH_INDICE") {
    return rows.filter(r => hasIndice(r));
  }

  if (sliceFilter === "NO_INDICE_BLOCKING") {
    return rows.filter(r => !hasIndice(r) && getBloquant(r));
  }

  // NO_INDICE_NOT_BLOCKING
  return rows.filter(r => !hasIndice(r) && !getBloquant(r));
}

function computeCounts(rows) {
  let countNoIndiceBlocking = 0;
  let countNoIndiceNotBlocking = 0;
  let countWithIndice = 0;

  rows.forEach(r => {
    if (hasIndice(r)) {
      countWithIndice++;
    } else {
      if (getBloquant(r)) countNoIndiceBlocking++;
      else countNoIndiceNotBlocking++;
    }
  });

  return { countNoIndiceBlocking, countNoIndiceNotBlocking, countWithIndice };
}

function chartLabel() {
  if (!selectedProject) return "";
  if (!selectedDocName) return `${selectedProject} — Tous`;
  const docLabel = makeDocLabel(selectedDocName, selectedDocNumber);
  return `${selectedProject} — ${docLabel}`;
}

function tableTitle() {
  const base = chartLabel();
  if (!base) return "Lignes";

  if (sliceFilter === "WITH_INDICE") return `Avec Indice — ${base}`;
  if (sliceFilter === "NO_INDICE_BLOCKING") return `Sans Indice (bloquant) — ${base}`;
  if (sliceFilter === "NO_INDICE_NOT_BLOCKING") return `Sans Indice (non bloquant) — ${base}`;
  return `Toutes lignes — ${base}`;
}

function refreshUI() {
  const projects = uniqProjects(App.records);
  populateFirstColumnDropdown(projects);

  if (!selectedProject || !projects.includes(selectedProject)) {
    selectedProject = "";
    selectedDocName = "";
    selectedDocNumber = null;
    sliceFilter = "ALL";
    setSecondDropdownDisabled(true);

    renderPieChart({
      project: "",
      countNoIndiceNotBlocking: 0,
      countNoIndiceBlocking: 0,
      countWithIndice: 0,
      activeSlice: "ALL"
    });

    renderDetailsTable({ rows: [], title: "Lignes", footer: "" });
    return;
  }

  secondDropdown.disabled = false;
  populateSecondColumnListbox(selectedProject);

  const desiredValue = selectedDocName
    ? JSON.stringify({ name: selectedDocName, n: selectedDocNumber })
    : "ALL";

  if ([...secondDropdown.options].some(o => o.value === desiredValue)) {
    secondDropdown.value = desiredValue;
  } else {
    secondDropdown.value = "ALL";
    selectedDocName = "";
    selectedDocNumber = null;
  }

  const baseRows = getBaseRows();
  const { countNoIndiceBlocking, countNoIndiceNotBlocking, countWithIndice } = computeCounts(baseRows);

  renderPieChart({
    project: chartLabel(),
    countNoIndiceNotBlocking,
    countNoIndiceBlocking,
    countWithIndice,
    activeSlice: sliceFilter
  });

  // Table (plus de limite)
  const listRows = applySliceFilter(baseRows)
    .slice()
    .sort((a, b) => (getRecuMs(b) - getRecuMs(a)));

  const rowsForRender = listRows.map(rec => ({
    rowId: getRowId(rec),
    emetteur: String(rec.Emetteur || "-"),
    reference: String(rec.Reference || "-"),
    indice: String(rec.Indice || "-"),
    recu: getRecuText(rec),
    observation: String((rec.DescriptionObservations ?? rec.DescriptionObservationss ?? "-")),
    bloquant: !!getBloquant(rec)
  }));

  renderDetailsTable({
    rows: rowsForRender,
    title: tableTitle(),
    footer: `${listRows.length} ligne(s).`
  });
}

/* EVENTS */

// Projet
firstDropdown.addEventListener("change", () => {
  selectedProject = firstDropdown.value.trim();
  selectedDocName = "";
  selectedDocNumber = null;
  sliceFilter = "ALL";

  if (!selectedProject) {
    setSecondDropdownDisabled(true);
    refreshUI();
    return;
  }

  secondDropdown.disabled = false;
  populateSecondColumnListbox(selectedProject);
  secondDropdown.value = "ALL";
  refreshUI();
});

// Document
secondDropdown.addEventListener("change", () => {
  const val = secondDropdown.value;

  if (val === "ALL" || !val) {
    selectedDocName = "";
    selectedDocNumber = null;
    sliceFilter = "ALL";
    refreshUI();
    return;
  }

  try {
    const parsed = JSON.parse(val);
    selectedDocName = parsed.name || "";
    selectedDocNumber = parsed.n == null ? null : Number(parsed.n);
  } catch {
    selectedDocName = "";
    selectedDocNumber = null;
    secondDropdown.value = "ALL";
  }

  sliceFilter = "ALL";
  refreshUI();
});

// Clic sur pie (toggle)
pieCanvas.addEventListener("click", (e) => {
  const slice = hitTestPie(e.clientX, e.clientY);
  if (!slice) return;
  sliceFilter = (sliceFilter === slice) ? "ALL" : slice;
  refreshUI();
});

// Clic sur légende (toggle)
legend.addEventListener("click", (e) => {
  const item = e.target.closest("[data-slice]");
  if (!item) return;
  const slice = item.getAttribute("data-slice");
  sliceFilter = (sliceFilter === slice) ? "ALL" : slice;
  refreshUI();
});

// Clic ligne => sélection dans Grist
document.getElementById("detailsTbody").addEventListener("click", async (e) => {
  const tr = e.target.closest("tr[data-rowid]");
  if (!tr) return;
  const rowId = tr.getAttribute("data-rowid");
  if (!rowId) return;

  try {
    await grist.viewApi.setSelectedRows([Number(rowId)]);
  } catch {}
});

/* INIT */
setSecondDropdownDisabled(true);

initGrist(() => {
  if (!selectedProject) selectedProject = firstDropdown.value.trim();
  refreshUI();
});
