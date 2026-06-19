let selectedProject = "";
let selectedDocName = "";
let selectedDocNumber = null;
let selectedDocType = null;
let selectedDocZone = null;
let selectedTypeValue = "";
let selectedZoneValue = "__ALL_ZONES__";

const SHARED_PROJECT_STORAGE_KEY = "grist.selected-project";
const SHARED_PROJECT_ID_STORAGE_KEY = "grist.selected-project-id";
const ALL_ZONES_VALUE = "__ALL_ZONES__";
const NO_ZONE_VALUE = "__NO_ZONE__";

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
const typeDropdown = document.getElementById("thirdColumnDropdown");
const zoneDropdown = document.getElementById("zoneDropdown");
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

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeFilterKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isTruthyGristValue(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["true", "1", "oui", "yes"].includes(value.trim().toLowerCase());
  }
  return false;
}

function isArchivedReferenceRow(record) {
  return isTruthyGristValue(record?.Archive);
}

function normalizeTypeDocument(value) {
  return normalizeText(value);
}

function normalizeZoneValue(value) {
  return normalizeText(value);
}

function formatZoneLabel(value) {
  return normalizeZoneValue(value) || "Sans zone";
}

function getZoneOptionValue(zoneValue) {
  return normalizeZoneValue(zoneValue) || NO_ZONE_VALUE;
}

function normalizeZoneSelection(value) {
  const raw = normalizeText(value);
  if (!raw || raw === ALL_ZONES_VALUE) return ALL_ZONES_VALUE;
  if (raw === NO_ZONE_VALUE) return NO_ZONE_VALUE;
  return normalizeZoneValue(raw);
}

function isAllZoneSelection(value) {
  return normalizeZoneSelection(value) === ALL_ZONES_VALUE;
}

function formatZoneSelectionLabel(value) {
  const selection = normalizeZoneSelection(value);
  return selection === NO_ZONE_VALUE ? "Sans zone" : formatZoneLabel(selection);
}

function compareTextFr(left, right) {
  return normalizeText(left).localeCompare(normalizeText(right), "fr", {
    sensitivity: "base",
    numeric: true
  });
}

function compareZoneValues(left, right) {
  const leftZone = normalizeZoneValue(left);
  const rightZone = normalizeZoneValue(right);
  const leftEmpty = leftZone ? 0 : 1;
  const rightEmpty = rightZone ? 0 : 1;
  if (leftEmpty !== rightEmpty) return leftEmpty - rightEmpty;
  return compareTextFr(formatZoneLabel(leftZone), formatZoneLabel(rightZone));
}

function resetSelectedDocument() {
  selectedDocName = "";
  selectedDocNumber = null;
  selectedDocType = null;
  selectedDocZone = null;
}

function setSecondDropdownDisabled(disabled) {
  secondDropdown.disabled = disabled;
  secondDropdown.innerHTML = `<option value="ALL">Tous</option>`;
  secondDropdown.value = "ALL";
}

function resetTypeDropdown(disabled = true) {
  if (!typeDropdown) return;
  typeDropdown.innerHTML = `<option value="">Tous les types</option>`;
  typeDropdown.value = "";
  typeDropdown.disabled = disabled;
  selectedTypeValue = "";
}

function resetZoneDropdown(disabled = true) {
  if (!zoneDropdown) return;
  zoneDropdown.innerHTML = `<option value="${ALL_ZONES_VALUE}">Toutes les zones</option>`;
  zoneDropdown.value = ALL_ZONES_VALUE;
  zoneDropdown.disabled = disabled;
  selectedZoneValue = ALL_ZONES_VALUE;
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

function getProjectRows(project) {
  const projectKey = normalizeFilterKey(project);
  if (!projectKey) return [];

  return (App.records || []).filter((rec) =>
    normalizeFilterKey(rec?.NomProjet) === projectKey &&
    !isArchivedReferenceRow(rec)
  );
}

function collectTypesForProject(project) {
  const typesByKey = new Map();
  getProjectRows(project).forEach((rec) => {
    const type = normalizeTypeDocument(rec?.Type_document);
    const key = normalizeFilterKey(type);
    if (!key || typesByKey.has(key)) return;
    typesByKey.set(key, type);
  });

  return Array.from(typesByKey.values()).sort(compareTextFr);
}

function populateTypeDropdown(project, preferredValue = selectedTypeValue) {
  if (!typeDropdown) return;

  typeDropdown.innerHTML = `<option value="">Tous les types</option>`;
  const projectKey = normalizeFilterKey(project);
  if (!projectKey) {
    typeDropdown.value = "";
    typeDropdown.disabled = true;
    selectedTypeValue = "";
    return;
  }

  const types = collectTypesForProject(project);
  const typesByKey = new Map();
  types.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeDropdown.appendChild(option);
    typesByKey.set(normalizeFilterKey(type), type);
  });

  const preferredKey = normalizeFilterKey(preferredValue);
  typeDropdown.value = preferredKey ? (typesByKey.get(preferredKey) || "") : "";
  selectedTypeValue = typeDropdown.value;
  typeDropdown.disabled = false;
}

function matchesTypeFilter(rec, typeValue = selectedTypeValue) {
  const type = normalizeTypeDocument(typeValue);
  if (!type) return true;
  return normalizeFilterKey(rec?.Type_document) === normalizeFilterKey(type);
}

function collectZonesForProject(project, typeValue = selectedTypeValue) {
  const zonesByKey = new Map();
  getProjectRows(project).forEach((rec) => {
    if (!matchesTypeFilter(rec, typeValue)) return;
    const zone = normalizeZoneValue(rec?.Zone);
    const key = zone ? normalizeFilterKey(zone) : NO_ZONE_VALUE;
    if (zonesByKey.has(key)) return;
    zonesByKey.set(key, zone);
  });

  return Array.from(zonesByKey.values()).sort(compareZoneValues);
}

function populateZoneDropdown(project, preferredValue = selectedZoneValue) {
  if (!zoneDropdown) return;

  zoneDropdown.innerHTML = `<option value="${ALL_ZONES_VALUE}">Toutes les zones</option>`;
  const projectKey = normalizeFilterKey(project);
  if (!projectKey) {
    zoneDropdown.value = ALL_ZONES_VALUE;
    zoneDropdown.disabled = true;
    selectedZoneValue = ALL_ZONES_VALUE;
    return;
  }

  const zones = collectZonesForProject(project, selectedTypeValue);
  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = getZoneOptionValue(zone);
    option.textContent = formatZoneLabel(zone);
    zoneDropdown.appendChild(option);
  });

  const desiredValue = normalizeZoneSelection(preferredValue);
  const availableValues = new Set(zones.map((zone) => getZoneOptionValue(zone)));
  zoneDropdown.value =
    desiredValue === ALL_ZONES_VALUE || availableValues.has(desiredValue)
      ? desiredValue
      : ALL_ZONES_VALUE;
  selectedZoneValue = zoneDropdown.value || ALL_ZONES_VALUE;
  zoneDropdown.disabled = false;
}

function matchesZoneFilter(rec, zoneValue = selectedZoneValue) {
  const selection = normalizeZoneSelection(zoneValue);
  if (selection === ALL_ZONES_VALUE) return true;

  const recordZone = normalizeZoneValue(rec?.Zone);
  if (selection === NO_ZONE_VALUE) return !recordZone;
  return normalizeFilterKey(recordZone) === normalizeFilterKey(selection);
}

function buildDocumentOptionValue({ name = "", n = null, type = "", zone = "" } = {}) {
  return JSON.stringify({
    name: normalizeText(name),
    n: n == null ? null : Number(n),
    type: normalizeTypeDocument(type),
    zone: normalizeZoneValue(zone)
  });
}

function buildDocumentOptionsForProject(project) {
  const docsByKey = new Map();

  getProjectRows(project).forEach((rec) => {
    if (!matchesTypeFilter(rec)) return;
    if (!matchesZoneFilter(rec)) return;

    const name = normalizeText(rec?.NomDocument);
    if (!name) return;

    const n = normalizeNumero(rec?.NumeroDocument);
    const type = normalizeTypeDocument(rec?.Type_document);
    const zone = normalizeZoneValue(rec?.Zone);
    const key = [
      normalizeFilterKey(type),
      normalizeFilterKey(zone),
      n == null ? "" : String(n),
      normalizeFilterKey(name)
    ].join("||");

    if (docsByKey.has(key)) return;
    docsByKey.set(key, {
      value: buildDocumentOptionValue({ name, n, type, zone }),
      label: makeDocLabel(name, n),
      identityKey: `${n == null ? "" : String(n)}||${normalizeFilterKey(name)}`,
      name,
      n,
      type,
      zone
    });
  });

  const opts = Array.from(docsByKey.values());
  const identityCounts = new Map();
  opts.forEach((entry) => {
    identityCounts.set(entry.identityKey, (identityCounts.get(entry.identityKey) || 0) + 1);
  });

  opts.forEach((entry) => {
    if ((identityCounts.get(entry.identityKey) || 0) <= 1) return;
    const context = [entry.type || "Sans type", formatZoneLabel(entry.zone)].filter(Boolean).join(" / ");
    entry.label = `${entry.label} - ${context}`;
  });

  opts.sort((a, b) => {
    if (!selectedTypeValue) {
      const typeCompare = compareTextFr(a.type, b.type);
      if (typeCompare !== 0) return typeCompare;
    }

    if (isAllZoneSelection(selectedZoneValue)) {
      const zoneCompare = compareZoneValues(a.zone, b.zone);
      if (zoneCompare !== 0) return zoneCompare;
    }

    const an = a.n == null ? Infinity : a.n;
    const bn = b.n == null ? Infinity : b.n;
    if (an !== bn) return an - bn;
    return compareTextFr(a.name, b.name);
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

  const recName = normalizeText(rec?.NomDocument);
  if (normalizeFilterKey(recName) !== normalizeFilterKey(selectedDocName)) return false;

  const recNum = normalizeNumero(rec?.NumeroDocument);
  if (!((recNum == null && selectedDocNumber == null) || (recNum === selectedDocNumber))) return false;

  if (selectedDocType !== null && normalizeFilterKey(rec?.Type_document) !== normalizeFilterKey(selectedDocType)) {
    return false;
  }

  if (selectedDocZone !== null && normalizeFilterKey(rec?.Zone) !== normalizeFilterKey(selectedDocZone)) {
    return false;
  }

  return true;
}

function makeGroupLabel(name, num, type = "", zone = "") {
  const n = normalizeNumero(num);
  const baseName = normalizeText(name) || "Sans document";
  const base = (n == null) ? baseName : `${n} ${baseName}`;
  const suffix = [];

  if (!selectedTypeValue && normalizeTypeDocument(type)) {
    suffix.push(normalizeTypeDocument(type));
  }

  if (isAllZoneSelection(selectedZoneValue)) {
    suffix.push(formatZoneLabel(zone));
  }

  return suffix.length ? `${base} - ${suffix.join(" / ")}` : base;
}

function getDocParts(rec) {
  const nameRaw = normalizeText(rec?.NomDocument);
  const name = nameRaw ? nameRaw : "Sans document";
  const n = normalizeNumero(rec?.NumeroDocument);
  const type = normalizeTypeDocument(rec?.Type_document);
  const zone = normalizeZoneValue(rec?.Zone);

  return {
    name,
    n,
    type,
    zone,
    label: makeGroupLabel(name, rec?.NumeroDocument, type, zone),
    sortN: (n == null ? Infinity : n)
  };
}

function getDocGroupKey(parts) {
  return [
    normalizeFilterKey(parts.type),
    normalizeFilterKey(parts.zone),
    parts.n == null ? "" : String(parts.n),
    normalizeFilterKey(parts.name)
  ].join("||");
}

function rowToRenderObj(rec) {
  return {
    type: "row",
    rowId: getRowId(rec),
    emetteur: String(rec?.Emetteur || "-"),
    reference: String(rec?.Reference || "-"),
    indice: String(rec?.Indice || "-"),
    recu: getRecuText(rec),
    observation: String((rec?.DescriptionObservations ?? rec?.DescriptionObservationss ?? "-")),
    bloquant: !!getBloquant(rec)
  };
}

function compareReference2RowOrder(a, b) {
  return String(a?.Emetteur || "").localeCompare(String(b?.Emetteur || ""));
}

function getBaseRows() {
  if (!selectedProject) return [];

  return getProjectRows(selectedProject).filter((rec) => {
    if (!rec) return false;
    if (!matchesTypeFilter(rec)) return false;
    if (!matchesZoneFilter(rec)) return false;
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

  const parts = [
    selectedProject,
    selectedDocName ? makeDocLabel(selectedDocName, selectedDocNumber) : "Tous documents"
  ];

  const typeForLabel = selectedTypeValue || (selectedDocName && selectedDocType !== null ? selectedDocType : "");
  if (typeForLabel) parts.push(typeForLabel);

  const zoneForLabel = !isAllZoneSelection(selectedZoneValue)
    ? selectedZoneValue
    : (selectedDocName && selectedDocZone !== null ? getZoneOptionValue(selectedDocZone) : ALL_ZONES_VALUE);
  if (!isAllZoneSelection(zoneForLabel)) parts.push(formatZoneSelectionLabel(zoneForLabel));

  return parts.join(" - ");
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
    resetSelectedDocument();
    selectedTypeValue = "";
    selectedZoneValue = ALL_ZONES_VALUE;
    resetTypeDropdown(true);
    resetZoneDropdown(true);
    setSecondDropdownDisabled(true);
    sliceFilter = "ALL";

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

  populateTypeDropdown(selectedProject, selectedTypeValue);
  populateZoneDropdown(selectedProject, selectedZoneValue);

  secondDropdown.disabled = false;
  populateSecondColumnListbox(selectedProject);

  const desiredValue = selectedDocName
    ? buildDocumentOptionValue({
        name: selectedDocName,
        n: selectedDocNumber,
        type: selectedDocType ?? "",
        zone: selectedDocZone ?? ""
      })
    : "ALL";

  if ([...secondDropdown.options].some((o) => o.value === desiredValue)) {
    secondDropdown.value = desiredValue;
  } else {
    secondDropdown.value = "ALL";
    resetSelectedDocument();
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
  resetSelectedDocument();
  selectedTypeValue = "";
  selectedZoneValue = ALL_ZONES_VALUE;
  sliceFilter = "ALL";
  refreshUI();
});

typeDropdown?.addEventListener("change", () => {
  selectedTypeValue = normalizeTypeDocument(typeDropdown.value);
  selectedZoneValue = ALL_ZONES_VALUE;
  resetSelectedDocument();
  sliceFilter = "ALL";
  refreshUI();
});

zoneDropdown?.addEventListener("change", () => {
  selectedZoneValue = normalizeZoneSelection(zoneDropdown.value);
  resetSelectedDocument();
  sliceFilter = "ALL";
  refreshUI();
});

secondDropdown.addEventListener("change", () => {
  const val = secondDropdown.value;

  if (val === "ALL" || !val) {
    resetSelectedDocument();
    sliceFilter = "ALL";
    refreshUI();
    return;
  }

  try {
    const parsed = JSON.parse(val);
    selectedDocName = normalizeText(parsed.name);
    selectedDocNumber = parsed.n == null ? null : Number(parsed.n);
    selectedDocType = parsed.type == null ? null : normalizeTypeDocument(parsed.type);
    selectedDocZone = parsed.zone == null ? null : normalizeZoneValue(parsed.zone);
  } catch {
    resetSelectedDocument();
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
resetTypeDropdown(true);
resetZoneDropdown(true);

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
    const sorted = listRows.slice().sort(compareReference2RowOrder);
    return sorted.map(rowToRenderObj);
  }

  const groups = new Map();
  const totalCountsByGroup = new Map();

  for (const rec of allRows) {
    const p = getDocParts(rec);
    const key = getDocGroupKey(p);
    totalCountsByGroup.set(key, (totalCountsByGroup.get(key) || 0) + 1);
  }

  for (const rec of listRows) {
    const p = getDocParts(rec);
    const key = getDocGroupKey(p);
    if (!groups.has(key)) {
      groups.set(key, { ...p, rows: [], totalCount: totalCountsByGroup.get(key) || 0 });
    }
    groups.get(key).rows.push(rec);
  }

  const groupArr = Array.from(groups.values());
  groupArr.sort((a, b) => {
    if (!selectedTypeValue) {
      const typeCompare = compareTextFr(a.type, b.type);
      if (typeCompare !== 0) return typeCompare;
    }

    if (isAllZoneSelection(selectedZoneValue)) {
      const zoneCompare = compareZoneValues(a.zone, b.zone);
      if (zoneCompare !== 0) return zoneCompare;
    }

    if (a.sortN !== b.sortN) return a.sortN - b.sortN;
    return compareTextFr(a.name, b.name);
  });

  const out = [];
  for (const g of groupArr) {
    g.rows.sort(compareReference2RowOrder);

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
