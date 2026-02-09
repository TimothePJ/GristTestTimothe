let selectedProject = "";
let selectedDocName = "";
let selectedDocNumber = null;
let lastValidDocumentValue = "ALL";

// filtre par couleur
// "ALL" | "NOT_BLOCKING" | "BLOCKING"
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

  if ([...firstDropdown.options].some(o => o.value === current)) {
    firstDropdown.value = current;
  } else {
    firstDropdown.value = "";
  }
}

function buildDocumentOptionsForProject(project) {
  const map = new Map(); // name -> Set(num|null)

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

  // Tous
  const allOpt = document.createElement("option");
  allOpt.value = "ALL";
  allOpt.textContent = "Tous";
  secondDropdown.appendChild(allOpt);

  // documents
  const opts = buildDocumentOptionsForProject(project);
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    secondDropdown.appendChild(opt);
  }
}

function matchesSelectedDocument(rec) {
  if (!selectedDocName) return true; // Tous

  const recName = String(rec.NomDocument || "").trim();
  if (recName !== selectedDocName) return false;

  const recNum = normalizeNumero(rec.NumeroDocument);
  return (recNum == null && selectedDocNumber == null) || (recNum === selectedDocNumber);
}

// baseRows = ce qui est “concerné” (ce que compte le pie)
function getBaseRows() {
  if (!selectedProject) return [];

  return (App.records || []).filter(rec => {
    if (!rec) return false;
    if (String(rec.NomProjet || "").trim() !== selectedProject) return false;
    if (!matchesSelectedDocument(rec)) return false;
    if (!isEnAttente(rec)) return false;
    return true;
  });
}

function applySliceFilter(rows) {
  if (sliceFilter === "ALL") return rows;
  if (sliceFilter === "BLOCKING") return rows.filter(r => getBloquant(r));
  return rows.filter(r => !getBloquant(r)); // NOT_BLOCKING
}

function computeCounts(rows) {
  let countBlocking = 0;
  let countNotBlocking = 0;

  rows.forEach(r => {
    if (getBloquant(r)) countBlocking++;
    else countNotBlocking++;
  });

  return { countBlocking, countNotBlocking };
}

function chartLabel() {
  if (!selectedProject) return "";
  if (!selectedDocName) return `${selectedProject} — Tous`;

  const docLabel = makeDocLabel(selectedDocName, selectedDocNumber);
  return `${selectedProject} — ${docLabel}`;
}

function tableTitle() {
  const base = chartLabel();
  if (!base) return "Lignes EN ATTENTE";

  if (sliceFilter === "BLOCKING") return `Lignes EN ATTENTE (bloquantes) — ${base}`;
  if (sliceFilter === "NOT_BLOCKING") return `Lignes EN ATTENTE (non bloquantes) — ${base}`;
  return `Lignes EN ATTENTE — ${base}`;
}

function refreshUI() {
  // dropdown projet
  const projects = uniqProjects(App.records);
  populateFirstColumnDropdown(projects);

  // reset si projet invalide
  if (!selectedProject || !projects.includes(selectedProject)) {
    selectedProject = "";
    selectedDocName = "";
    selectedDocNumber = null;
    lastValidDocumentValue = "ALL";
    sliceFilter = "ALL";
    setSecondDropdownDisabled(true);

    renderPieChart({ project: "", countNotBlocking: 0, countBlocking: 0, activeSlice: "ALL" });
    renderDetailsTable({ rows: [], title: "Lignes EN ATTENTE", footer: "" });
    return;
  }

  // dropdown document
  secondDropdown.disabled = false;
  populateSecondColumnListbox(selectedProject);

  const desiredValue = selectedDocName
    ? JSON.stringify({ name: selectedDocName, n: selectedDocNumber })
    : "ALL";

  if ([...secondDropdown.options].some(o => o.value === desiredValue)) {
    secondDropdown.value = desiredValue;
    lastValidDocumentValue = desiredValue;
  } else {
    secondDropdown.value = "ALL";
    selectedDocName = "";
    selectedDocNumber = null;
    lastValidDocumentValue = "ALL";
  }

  // data
  const baseRows = getBaseRows();
  const { countBlocking, countNotBlocking } = computeCounts(baseRows);

  renderPieChart({
    project: chartLabel(),
    countNotBlocking,
    countBlocking,
    activeSlice: sliceFilter
  });

  // table rows (filtrés par couleur)
  const listRows = applySliceFilter(baseRows)
    .slice()
    .sort((a, b) => (getRecuMs(b) - getRecuMs(a))); // tri: plus récent d'abord

  const LIMIT = 250;
  const shown = listRows.slice(0, LIMIT);

  const rowsForRender = shown.map(rec => ({
    rowId: getRowId(rec),
    emetteur: String(rec.Emetteur || "-"),
    reference: String(rec.Reference || "-"),
    indice: String(rec.Indice || "-"),
    recu: getRecuText(rec),
    observation: String((rec.DescriptionObservations ?? rec.DescriptionObservationss ?? "-")),
    bloquant: !!getBloquant(rec)
  }));

  const footer = (listRows.length > LIMIT)
    ? `… ${listRows.length - LIMIT} lignes non affichées (limite ${LIMIT}).`
    : `${listRows.length} ligne(s).`;

  renderDetailsTable({
    rows: rowsForRender,
    title: tableTitle(),
    footer
  });
}

/* EVENTS */

// Projet change
firstDropdown.addEventListener("change", () => {
  selectedProject = firstDropdown.value.trim();

  selectedDocName = "";
  selectedDocNumber = null;
  lastValidDocumentValue = "ALL";
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

// Document change
secondDropdown.addEventListener("change", () => {
  const val = secondDropdown.value;

  if (val === "ALL" || !val) {
    selectedDocName = "";
    selectedDocNumber = null;
    lastValidDocumentValue = "ALL";
    sliceFilter = "ALL";
    refreshUI();
    return;
  }

  try {
    const parsed = JSON.parse(val);
    selectedDocName = parsed.name || "";
    selectedDocNumber = parsed.n == null ? null : Number(parsed.n);
    lastValidDocumentValue = val;
  } catch {
    selectedDocName = "";
    selectedDocNumber = null;
    lastValidDocumentValue = "ALL";
    secondDropdown.value = "ALL";
  }

  sliceFilter = "ALL";
  refreshUI();
});

// Clic sur le pie
pieCanvas.addEventListener("click", (e) => {
  const slice = hitTestPie(e.clientX, e.clientY);
  if (!slice) return;

  // toggle : re-clic sur la même couleur => ALL
  sliceFilter = (sliceFilter === slice) ? "ALL" : slice;
  refreshUI();
});

// Clic sur la légende
legend.addEventListener("click", (e) => {
  const item = e.target.closest("[data-slice]");
  if (!item) return;

  const slice = item.getAttribute("data-slice");
  sliceFilter = (sliceFilter === slice) ? "ALL" : slice;
  refreshUI();
});

// Clic ligne => sélectionner dans Grist
document.getElementById("detailsTbody").addEventListener("click", async (e) => {
  const tr = e.target.closest("tr[data-rowid]");
  if (!tr) return;
  const rowId = tr.getAttribute("data-rowid");
  if (!rowId) return;

  try {
    await grist.viewApi.setSelectedRows([Number(rowId)]);
  } catch {
    // ignore
  }
});

/* INIT */
setSecondDropdownDisabled(true);

initGrist(() => {
  if (!selectedProject) selectedProject = firstDropdown.value.trim();
  refreshUI();
});
