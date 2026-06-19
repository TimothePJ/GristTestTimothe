let selectedProject = "";
let selectedDocName = "";
let selectedDocNumber = null;
const SHARED_PROJECT_STORAGE_KEY = "grist.selected-project";
const SHARED_PROJECT_ID_STORAGE_KEY = "grist.selected-project-id";
let _projectsData = [];

function readSharedProjectId() {
  try {
    const raw = localStorage.getItem(SHARED_PROJECT_ID_STORAGE_KEY);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_e) {
    return null;
  }
}

let sliceFilter = "ALL";

const firstDropdown = document.getElementById("firstColumnDropdown");
const secondDropdown = document.getElementById("secondColumnListbox");
const pieCanvas = document.getElementById("pieCanvas");
const legend = document.getElementById("legend");

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
    // localStorage can be unavailable inside some embedded contexts.
  }
}

function setSecondDropdownDisabled(disabled) {
  secondDropdown.disabled = disabled;
  secondDropdown.innerHTML = `<option value="ALL">Tous</option>`;
  secondDropdown.value = "ALL";
}

function populateFirstColumnDropdown(projects) {
  const current = firstDropdown.value || selectedProject || readSharedProjectSelection();
  const currentId = readSharedProjectId();

  firstDropdown.innerHTML = `<option value="">Choisir un projet</option>`;
  (projects || []).forEach((p) => {
    const v = typeof p === "object" ? p.name : String(p || "").trim();
    if (!v) return;
    const opt = document.createElement("option");
    opt.value = v;
    if (typeof p === "object" && p.id) {
      opt.textContent = `${p.number} - ${p.name}`;
      opt.dataset.projectId = String(p.id);
    } else {
      opt.textContent = v;
    }
    firstDropdown.appendChild(opt);
  });

  let restored = "";
  if (currentId) {
    const match = Array.from(firstDropdown.options).find((o) => Number(o.dataset.projectId) === currentId);
    if (match) restored = match.value;
  }
  if (!restored && current) {
    if ([...firstDropdown.options].some((o) => o.value === current)) restored = current;
  }
  firstDropdown.value = restored;
  selectedProject = firstDropdown.value || selectedProject || "";
}

function buildDocumentOptionsForProject(project) {
  const map = new Map();

  (App.records || []).forEach((rec) => {
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

    nums.forEach((n) => {
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

function makeGroupLabel(name, num) {
  const n = normalizeNumero(num);
  const base = String(name || "").trim() || "Sans document";
  return (n == null) ? base : `${n} ${base}`;
}

function getDocParts(rec) {
  const nameRaw = String(rec.NomDocument || "").trim();
  const name = nameRaw ? nameRaw : "Sans document";
  const n = normalizeNumero(rec.NumeroDocument);

  return {
    name,
    n,
    label: makeGroupLabel(name, rec.NumeroDocument),
    sortN: (n == null ? Infinity : n)
  };
}

function rowToRenderObj(rec) {
  return {
    type: "row",
    rowId: getRowId(rec),
    emetteur: String(rec.Emetteur || "-"),
    reference: String(rec.Reference || "-"),
    indice: String(rec.Indice || "-"),
    recu: getRecuText(rec),
    observation: String((rec.DescriptionObservations ?? rec.DescriptionObservationss ?? "-")),
    bloquant: !!getBloquant(rec)
  };
}

function getBaseRows() {
  if (!selectedProject) return [];

  return (App.records || []).filter((rec) => {
    if (!rec) return false;
    if (String(rec.NomProjet || "").trim() !== selectedProject) return false;
    if (!matchesSelectedDocument(rec)) return false;
    return true;
  });
}

function applySliceFilter(rows) {
  if (sliceFilter === "ALL") return rows;

  if (sliceFilter === "WITH_INDICE") {
    return rows.filter((r) => hasIndice(r));
  }

  if (sliceFilter === "NO_INDICE_BLOCKING") {
    return rows.filter((r) => !hasIndice(r) && getBloquant(r));
  }

  return rows.filter((r) => !hasIndice(r) && !getBloquant(r));
}

function computeCounts(rows) {
  let countNoIndiceBlocking = 0;
  let countNoIndiceNotBlocking = 0;
  let countWithIndice = 0;

  rows.forEach((r) => {
    if (hasIndice(r)) {
      countWithIndice++;
    } else if (getBloquant(r)) {
      countNoIndiceBlocking++;
    } else {
      countNoIndiceNotBlocking++;
    }
  });

  return { countNoIndiceBlocking, countNoIndiceNotBlocking, countWithIndice };
}

function chartLabel() {
  if (!selectedProject) return "";
  if (!selectedDocName) return `${selectedProject} - Tous`;
  const docLabel = makeDocLabel(selectedDocName, selectedDocNumber);
  return `${selectedProject} - ${docLabel}`;
}

function tableTitle() {
  const base = chartLabel();
  if (!base) return "Lignes";

  if (sliceFilter === "WITH_INDICE") return `Avec indice - ${base}`;
  if (sliceFilter === "NO_INDICE_BLOCKING") return `Sans indice (bloquant) - ${base}`;
  if (sliceFilter === "NO_INDICE_NOT_BLOCKING") return `Sans indice (non bloquant) - ${base}`;
  return `Toutes lignes - ${base}`;
}

function refreshUI() {
  const projects = [...firstDropdown.options].map((o) => o.value).filter(Boolean);

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

  if ([...secondDropdown.options].some((o) => o.value === desiredValue)) {
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

  const listRows = applySliceFilter(baseRows);
  const rowsForRender = buildRowsForTable(listRows, baseRows);

  renderDetailsTable({
    rows: rowsForRender,
    title: tableTitle(),
    footer: `${listRows.length} ligne(s).`
  });
}

firstDropdown.addEventListener("change", () => {
  selectedProject = firstDropdown.value.trim();
  saveSharedProjectSelection(selectedProject);
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

pieCanvas.addEventListener("click", (e) => {
  const slice = hitTestPie(e.clientX, e.clientY);
  if (!slice) return;
  sliceFilter = (sliceFilter === slice) ? "ALL" : slice;
  refreshUI();
});

legend.addEventListener("click", (e) => {
  const item = e.target.closest("[data-slice]");
  if (!item) return;
  const slice = item.getAttribute("data-slice");
  sliceFilter = (sliceFilter === slice) ? "ALL" : slice;
  refreshUI();
});

document.getElementById("detailsTbody").addEventListener("click", async (e) => {
  const tr = e.target.closest("tr[data-rowid]");
  if (!tr) return;
  const rowId = tr.getAttribute("data-rowid");
  if (!rowId) return;

  try {
    await grist.viewApi.setSelectedRows([Number(rowId)]);
  } catch {}
});

setSecondDropdownDisabled(true);

async function refreshProjectDropdownFromProjectsTable() {
  try {
    if (!grist?.docApi || typeof grist.docApi.fetchTable !== "function") return;
    const table = await grist.docApi.fetchTable("Projets2");
    const ids = Array.isArray(table?.id) ? table.id : [];
    const numbers = Array.isArray(table?.Numero_de_projet) ? table.Numero_de_projet : [];
    const names = Array.isArray(table?.Nom_de_projet) ? table.Nom_de_projet : [];
    _projectsData = ids
      .map((id, i) => ({
        id: Number(id),
        number: String(numbers[i] || "").trim(),
        name: String(names[i] || "").trim()
      }))
      .filter((p) => p.id > 0 && p.name)
      .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true }));
    if (!_projectsData.length) return;
    populateFirstColumnDropdown(_projectsData);
    selectedProject = firstDropdown.value || selectedProject || "";
  } catch (err) {
    console.warn("EnAttente: impossible de charger la liste Projets2 :", err);
  }
}

void refreshProjectDropdownFromProjectsTable();
window.addEventListener("pageshow", () => { void refreshProjectDropdownFromProjectsTable(); });
window.addEventListener("focus", () => {
  if (firstDropdown.options.length <= 1) void refreshProjectDropdownFromProjectsTable();
});

initGrist(() => {
  if (!selectedProject) selectedProject = firstDropdown.value.trim();
  if (firstDropdown.options.length <= 1) {
    void refreshProjectDropdownFromProjectsTable().then(() => refreshUI());
  } else {
    refreshUI();
  }
});

function buildRowsForTable(listRows, allRows = listRows) {
  if (selectedDocName) {
    const sorted = listRows.slice().sort((a, b) => getRecuMs(b) - getRecuMs(a));
    return sorted.map(rowToRenderObj);
  }

  const groups = new Map();
  const totalCountsByGroup = new Map();

  for (const rec of allRows) {
    const p = getDocParts(rec);
    const key = JSON.stringify({ name: p.name, n: p.n });
    totalCountsByGroup.set(key, (totalCountsByGroup.get(key) || 0) + 1);
  }

  for (const rec of listRows) {
    const p = getDocParts(rec);
    const key = JSON.stringify({ name: p.name, n: p.n });
    if (!groups.has(key)) {
      groups.set(key, { ...p, rows: [], totalCount: totalCountsByGroup.get(key) || 0 });
    }
    groups.get(key).rows.push(rec);
  }

  const groupArr = Array.from(groups.values());
  groupArr.sort((a, b) => {
    if (a.sortN !== b.sortN) return a.sortN - b.sortN;
    return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  });

  const out = [];
  for (const g of groupArr) {
    g.rows.sort((a, b) => getRecuMs(b) - getRecuMs(a));

    out.push({
      type: "group",
      label: g.label,
      count: g.rows.length,
      totalCount: g.totalCount || g.rows.length
    });
    for (const rec of g.rows) {
      out.push(rowToRenderObj(rec));
    }
  }

  return out;
}

(function () {
  if (window.__lpStorageSyncAdded_enAttente) return;
  window.__lpStorageSyncAdded_enAttente = true;
  const normalizeKey = function (s) {
    return String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  };

  window.addEventListener("storage", function (event) {
    const dropdown = document.getElementById("firstColumnDropdown");
    if (!dropdown) return;
    if (event.key === "grist.selected-project-id" && event.newValue) {
      const idStr = String(event.newValue).trim();
      const match = Array.from(dropdown.options).find((o) => o.dataset.projectId === idStr);
      if (match && dropdown.value !== match.value) {
        dropdown.value = match.value;
        dropdown.dispatchEvent(new Event("change"));
      }
      return;
    }
    if (event.key !== "grist.selected-project" || !event.newValue) return;
    const newProject = String(event.newValue).trim();
    const match = Array.from(dropdown.options).find((o) => normalizeKey(o.value) === normalizeKey(newProject));
    if (match && dropdown.value !== match.value) {
      dropdown.value = match.value;
      dropdown.dispatchEvent(new Event("change"));
    }
  });
})();
