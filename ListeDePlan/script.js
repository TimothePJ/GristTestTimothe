
  // --- shim: ensure normLabel exists before helpers use it ---
  (function(){
    try {
      if (typeof window !== 'undefined' && typeof window.normLabel !== 'function') {
        window.normLabel = function(s){ return String(s || '').trim().replace(/\s+/g, ' '); };
      }
      if (typeof normLabel !== 'function') {
        // local fallback (non-browser or no global)
        // eslint-disable-next-line no-func-assign
        normLabel = function(s){ return String(s || '').trim().replace(/\s+/g, ' '); };
      }
    } catch (_) {
      // last resort
      // eslint-disable-next-line no-inner-declarations
      function normLabel(s){ return String(s || '').trim().replace(/\s+/g, ' '); }
    }
  })();

  // ---- Mémoire locale de la sélection projet/type ----
  const LS_KEYS = {
    SHARED_PROJECT_LABEL: 'grist.selected-project',
    SHARED_PROJECT_ID: 'grist.selected-project-id',
    PROJECT_LABEL: 'LP_LAST_PROJECT_LABEL',
    PROJECT_ID: 'LP_LAST_PROJECT_ID',
    TYPE_LABEL: 'LP_LAST_TYPE_LABEL',
  };
  let _projectsData = []; // [{id, number, name}]

  function saveLastSelection({ projectLabel, projectId, typeLabel }) {
    try {
      if (projectLabel) localStorage.setItem(LS_KEYS.SHARED_PROJECT_LABEL, projectLabel);
      if (projectLabel === "") localStorage.removeItem(LS_KEYS.SHARED_PROJECT_LABEL);
      if (projectLabel) localStorage.setItem(LS_KEYS.PROJECT_LABEL, projectLabel);
      if (projectLabel === "") {
        localStorage.removeItem(LS_KEYS.PROJECT_LABEL);
        localStorage.removeItem(LS_KEYS.PROJECT_ID);
        localStorage.removeItem(LS_KEYS.SHARED_PROJECT_ID);
      }
      if (projectId != null) {
        localStorage.setItem(LS_KEYS.PROJECT_ID, String(projectId));
        localStorage.setItem(LS_KEYS.SHARED_PROJECT_ID, String(projectId));
      }
      if (typeLabel) localStorage.setItem(LS_KEYS.TYPE_LABEL, typeLabel);
    } catch {}
  }

  function loadLastSelection() {
    try {
      const lbl =
        localStorage.getItem(LS_KEYS.SHARED_PROJECT_LABEL) ||
        localStorage.getItem(LS_KEYS.PROJECT_LABEL) ||
        '';
      // Lire l'ID canonique en priorité depuis la clé partagée
      const sharedIdStr = localStorage.getItem(LS_KEYS.SHARED_PROJECT_ID);
      const localIdStr = localStorage.getItem(LS_KEYS.PROJECT_ID);
      const idStr = sharedIdStr || localIdStr;
      const t = localStorage.getItem(LS_KEYS.TYPE_LABEL) || '';
      const id = idStr && /^\d+$/.test(idStr) ? Number(idStr) : null;
      return { projectLabel: lbl, projectId: id, typeLabel: t };
    } catch { return { projectLabel: '', projectId: null, typeLabel: '' }; }
  }

function normalizeProjectName(v) {
  return (v ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeProjectSelectionKey(value = "") {
  return normalizeProjectName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getNomProjet(record) {
  const raw = (typeof record.Nom_projet === "object")
    ? record.Nom_projet.details
    : record.Nom_projet;

  return normalizeProjectName(raw);
}


  // ---- Sélection robuste des dropdowns ----
  function getSelectedLabelAndValue(selectEl) {
    if (!selectEl) return { label: "", value: "" };
    const idx = selectEl.selectedIndex;
    let opt = idx >= 0 ? selectEl.options[idx] : null;
    if (!opt && selectEl.options && selectEl.options.length === 1) opt = selectEl.options[0];
    const rawVal = (opt && typeof opt.value !== "undefined") ? opt.value : selectEl.value;
    const rawTxt = opt ? opt.textContent : "";
    const value = normLabel(rawVal);
    const text  = normLabel(rawTxt);
    const label = text || value;
    return { label, value };
  }

  function detectProjectSelect() {
    // 1) id standard
    let el = document.getElementById('projectDropdown');
    if (el && el.tagName === 'SELECT') return el;

    // 2) meilleur match par heuristique
    const selects = Array.from(document.querySelectorAll('select'));
    if (!selects.length) return null;

    // Construire une set de labels connus si possible
    const known = new Set(Array.from(PROJECT_MAP.keys()).map(normLabel));
    let best = null, bestScore = -1;

    for (const s of selects) {
      const idn = (s.id || "").toLowerCase();
      const nm  = (s.name || "").toLowerCase();
      let score = 0;

      if (idn.includes('project') || nm.includes('project') || idn.includes('projet') || nm.includes('projet')) score += 3;

      const opts = Array.from(s.options || []);
      for (const o of opts) {
        const v = normLabel(o.value);
        const t = normLabel(o.textContent);
        if (known.has(v)) score += 2;
        if (known.has(t)) score += 2;
        if (v && v === t) score += 0.5;
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function detectTypeSelect() {
    // 1) id standard
    let el = document.getElementById('typeDropdown');
    if (el && el.tagName === 'SELECT') return el;

    // 2) heuristique: chercher un select qui contient des libellés de type courants
    const candidates = Array.from(document.querySelectorAll('select'));
    const typeHints = new Set(['ndc','cof','coffrage','armatures','plans','plan']);
    let best = null, bestScore = -1;
    for (const s of candidates) {
      const idn = (s.id || "").toLowerCase();
      const nm  = (s.name || "").toLowerCase();
      let score = 0;
      if (idn.includes('type') || nm.includes('type')) score += 2;
      for (const o of Array.from(s.options || [])) {
        const t = normLabel(o.textContent).toLowerCase();
        for (const h of typeHints) {
          if (t.includes(h)) { score += 1.2; break; }

  // ==== Hooks surchargables par l'app (pour widgets custom non-<select>) ====
  // L'appli peut définir window.__LP_GET_CURRENT_PROJECT = () => ({ label, id })
  // et window.__LP_GET_CURRENT_TYPE = () => ({ label })
  // Ces hooks seront utilisés en priorité.
  function callHook(fn, fallback) {
    try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; }
  }

  function detectCustomProject() {
    // 1) Hook utilisateur
    const hook = callHook(window.__LP_GET_CURRENT_PROJECT, null);
    if (hook && (hook.label || hook.id)) return hook;

    // 2) Heuristiques pour widgets custom (div/span)
    const candidates = Array.from(document.querySelectorAll('[data-role*=\"project\" i], [role=\"listbox\" i], [aria-label*=\"projet\" i], [aria-labelledby*=\"projet\" i]'));
    for (const el of candidates) {
      // Rechercher un enfant marqué sélectionné
      const sel = el.querySelector('[aria-selected=\"true\"], .selected, [data-selected=\"true\"]');
      const text = (sel ? sel.textContent : el.textContent) || '';
      const label = normLabel(text);
      if (label) {
        // Essayer d'inférer un id via attributes
        let id = null;
        const valAttr = sel?.getAttribute?.('data-id') || sel?.getAttribute?.('data-value') || el.getAttribute?.('data-id');
        if (valAttr && /^\d+$/.test(valAttr)) id = Number(valAttr);
        return { label, id };
      }
    }
    return null;
  }

  function detectCustomType() {
    const hook = callHook(window.__LP_GET_CURRENT_TYPE, null);
    if (hook && hook.label) return hook;
    const el = document.querySelector('[data-role*=\"type\" i], [aria-label*=\"type\" i]');
    if (el) {
      const sel = el.querySelector('[aria-selected=\"true\"], .selected, [data-selected=\"true\"]');
      const text = (sel ? sel.textContent : el.textContent) || '';
      const label = normLabel(text);
      if (label) return { label };
    }
    return null;
  }
        }
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }
window.__skipChangeEvent = false;
window.records = [];
window.LISTE_DE_PLAN_ALL_TYPES_VALUE = "__ALL_TYPES__";
window.LISTE_DE_PLAN_ALL_TYPES_LABEL = "Tous les types";
window.LISTE_DE_PLAN_ALL_ZONES_VALUE = "__ALL_ZONES__";
window.LISTE_DE_PLAN_ALL_ZONES_LABEL = "Toutes les zones";
window.LISTE_DE_PLAN_NO_ZONE_VALUE = "__NO_ZONE__";
window.LISTE_DE_PLAN_NO_ZONE_LABEL = "Sans zone";

const MANAGE_ZONE_REFERENCES_TABLE = "References2";
const MANAGE_ZONE_LISTEPLAN_TABLE_CANDIDATES = [
  "ListePlan_NDC_COF",
  "ListePlan NDC+COF",
  "ListePlan_NDC+COF",
];
const MANAGE_ZONE_PLANNING_TABLE_CANDIDATES = [
  "Planning_Projet",
  "Planning_Project",
];
const MANAGE_ZONE_OPTION_VALUE = "__MANAGE_ZONE__";
let lastRegularZoneSelection = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";

function normalizeDocumentNumberForUniqueness(value) {
  return String(value ?? "").trim();
}

function normalizeDocumentProjectKey(value) {
  const raw = Array.isArray(value)
    ? value[value.length - 1]
    : value && typeof value === "object"
      ? (value.details ?? value.display ?? value.label ?? value.name ?? value.id ?? value)
      : value;
  return String(raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
}

async function buildDocumentProjectAliasKeys(projectName) {
  const aliases = new Set([normalizeDocumentProjectKey(projectName)].filter(Boolean));
  const projects = await grist.docApi.fetchTable("Projets2");
  const names = projects.Nom_de_projet || [];
  const ids = projects.id || [];
  const requestedKey = normalizeDocumentProjectKey(projectName);

  for (let index = 0; index < Math.max(names.length, ids.length); index += 1) {
    const rowKeys = [names[index], ids[index]]
      .map(normalizeDocumentProjectKey)
      .filter(Boolean);
    if (!rowKeys.includes(requestedKey)) continue;
    rowKeys.forEach((key) => aliases.add(key));
  }

  return aliases;
}

async function fetchDocumentUniquenessListePlan() {
  let lastError = null;
  for (const tableName of MANAGE_ZONE_LISTEPLAN_TABLE_CANDIDATES) {
    try {
      const raw = await grist.docApi.fetchTable(tableName);
      return { tableName, rows: normalizeManageRows(raw) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Table ListePlan introuvable.");
}

async function assertDocumentNumbersAvailable(projectName, documentNumbers, {
  excludeDocument = null,
} = {}) {
  const numbers = (documentNumbers || [])
    .map(normalizeDocumentNumberForUniqueness)
    .filter(Boolean);
  const seenNumbers = new Set();
  for (const number of numbers) {
    if (seenNumbers.has(number)) {
      throw new Error(`Le numero de document "${number}" est saisi plusieurs fois.`);
    }
    seenNumbers.add(number);
  }

  const [projectAliases, listePlan] = await Promise.all([
    buildDocumentProjectAliasKeys(projectName),
    fetchDocumentUniquenessListePlan(),
  ]);
  const excludedNumber = normalizeDocumentNumberForUniqueness(excludeDocument?.number);
  const excludedName = String(excludeDocument?.name ?? "").trim();
  const excludedType = String(excludeDocument?.type ?? "").trim();
  const excludedZone = String(excludeDocument?.zone ?? "").trim();

  for (const row of listePlan.rows) {
    const rowProject = row.Nom_projet ?? row.NomProjet ?? row.NomProjetString;
    if (!projectAliases.has(normalizeDocumentProjectKey(rowProject))) continue;

    const rowNumber = normalizeDocumentNumberForUniqueness(row.NumeroDocument);
    if (!seenNumbers.has(rowNumber)) continue;

    const isExcludedSource = excludeDocument &&
      rowNumber === excludedNumber &&
      String(row.Designation ?? row.NomDocument ?? "").trim() === excludedName &&
      String(row.Type_document ?? row.Type_doc ?? "").trim() === excludedType &&
      String(row.Zone ?? "").trim() === excludedZone;
    if (isExcludedSource) continue;

    throw new Error(
      `Le numero de document "${rowNumber}" est deja utilise dans ce projet.`
    );
  }

  return listePlan;
}

window.assertDocumentNumbersAvailable = assertDocumentNumbersAvailable;
window.getActiveListePlanTableName = async () => (await fetchDocumentUniquenessListePlan()).tableName;

function getAllTypesValue() {
  return window.LISTE_DE_PLAN_ALL_TYPES_VALUE || "__ALL_TYPES__";
}

function getAllTypesLabel() {
  return window.LISTE_DE_PLAN_ALL_TYPES_LABEL || "Tous les types";
}

function normalizeTypeDocumentValue(value) {
  return String(value ?? "").trim();
}

function getTypeDocumentDropdown() {
  return document.getElementById("typeDocumentDropdown");
}

function getTypeDocumentCheckboxList() {
  return document.getElementById("typeDocumentCheckboxList");
}

function getTypeDocumentCheckboxDropdown() {
  return document.getElementById("typeDocumentCheckboxDropdown");
}

function getTypeDocumentMenuButton() {
  return document.getElementById("typeDocumentMenuButton");
}

function getTypeDocumentCheckboxes() {
  const list = getTypeDocumentCheckboxList();
  return list ? Array.from(list.querySelectorAll('input[type="checkbox"]')) : [];
}

function getTypeDocumentValueCheckboxes() {
  const allTypesValue = getAllTypesValue();
  return getTypeDocumentCheckboxes().filter((checkbox) => checkbox.value !== allTypesValue);
}

function getAvailableTypeDocumentValues() {
  return getTypeDocumentValueCheckboxes()
    .map((checkbox) => normalizeTypeDocumentValue(checkbox.value))
    .filter(Boolean);
}

function getSelectedTypeDocumentValues() {
  const allTypesValue = getAllTypesValue();
  const checkboxes = getTypeDocumentCheckboxes();

  if (checkboxes.length > 0) {
    const allChecked = checkboxes.some((checkbox) => checkbox.value === allTypesValue && checkbox.checked);
    if (allChecked) return [allTypesValue];

    return [...new Set(
      checkboxes
        .filter((checkbox) => checkbox.checked && checkbox.value !== allTypesValue)
        .map((checkbox) => normalizeTypeDocumentValue(checkbox.value))
        .filter(Boolean)
    )];
  }

  const dropdown = getTypeDocumentDropdown();
  const value = normalizeTypeDocumentValue(dropdown?.value);
  return value ? [value] : [];
}

function getSelectedTypeDocumentSelection() {
  const allTypesValue = getAllTypesValue();
  const rawValues = getSelectedTypeDocumentValues();
  const isAll = rawValues.includes(allTypesValue);
  const values = isAll
    ? getAvailableTypeDocumentValues()
    : rawValues.filter((value) => value && value !== allTypesValue);

  return {
    allValue: allTypesValue,
    allLabel: getAllTypesLabel(),
    rawValues,
    values,
    isAll,
    isMultiple: values.length > 1,
    singleValue: values.length === 1 ? values[0] : "",
    hasSelection: isAll || values.length > 0
  };
}

function syncTypeDocumentDropdownForCompatibility() {
  const dropdown = getTypeDocumentDropdown();
  if (!dropdown) {
    updateTypeDocumentMenuLabel();
    return;
  }

  const selection = getSelectedTypeDocumentSelection();
  dropdown.value = selection.singleValue || getAllTypesValue();
  updateTypeDocumentMenuLabel(selection);
}

function getTypeDocumentMenuText(selection = getSelectedTypeDocumentSelection()) {
  if (selection.isAll) return selection.allLabel;
  if (selection.values.length === 0) return "Aucun type";
  if (selection.values.length === 1) return selection.values[0];
  return `${selection.values.length} types selectionnes`;
}

function updateTypeDocumentMenuLabel(selection = getSelectedTypeDocumentSelection()) {
  const label = document.getElementById("typeDocumentMenuLabel");
  if (!label) return;

  label.textContent = getTypeDocumentMenuText(selection);
  label.title = selection.isAll
    ? selection.allLabel
    : selection.values.join(", ");
}

function setTypeDocumentMenuOpen(open) {
  const menu = getTypeDocumentCheckboxDropdown();
  const list = getTypeDocumentCheckboxList();
  const button = getTypeDocumentMenuButton();
  if (!menu || !list || !button) return;

  menu.classList.toggle("is-open", Boolean(open));
  list.hidden = !open;
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleTypeDocumentMenu() {
  const list = getTypeDocumentCheckboxList();
  setTypeDocumentMenuOpen(Boolean(list?.hidden));
}

function appendTypeDocumentCheckbox(container, value, label, checked) {
  const item = document.createElement("label");
  item.className = "checkbox-list-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = value;
  checkbox.checked = Boolean(checked);

  const text = document.createElement("span");
  text.textContent = label;

  item.appendChild(checkbox);
  item.appendChild(text);
  container.appendChild(item);
}

function setSelectedTypeDocumentValues(values) {
  const allTypesValue = getAllTypesValue();
  const wanted = new Set((values || []).map(normalizeTypeDocumentValue).filter(Boolean));
  const checkboxes = getTypeDocumentCheckboxes();
  const valueCheckboxes = checkboxes.filter((checkbox) => checkbox.value !== allTypesValue);
  const allCheckbox = checkboxes.find((checkbox) => checkbox.value === allTypesValue);
  const shouldSelectAll = wanted.has(allTypesValue);

  if (shouldSelectAll) {
    valueCheckboxes.forEach((checkbox) => {
      checkbox.checked = true;
    });
    if (allCheckbox) allCheckbox.checked = true;
  } else {
    valueCheckboxes.forEach((checkbox) => {
      checkbox.checked = wanted.has(normalizeTypeDocumentValue(checkbox.value));
    });

    if (allCheckbox) {
      const checkedCount = valueCheckboxes.filter((checkbox) => checkbox.checked).length;
      allCheckbox.checked = valueCheckboxes.length > 0 && checkedCount === valueCheckboxes.length;
    }
  }

  syncTypeDocumentDropdownForCompatibility();
}

function selectAllTypeDocuments() {
  setSelectedTypeDocumentValues([getAllTypesValue()]);
}

function refreshCurrentPlanDisplay({ refreshZones = true } = {}) {
  const selectedProject = document.getElementById("projectDropdown")?.value || "";
  const selectedTypeDocuments = getSelectedTypeDocumentValues();
  const zoneDropdown = document.getElementById("zoneDropdown");
  const selectedZoneDocument = zoneDropdown?.value ||
    (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");
  const output = document.getElementById("plans-output");

  if (!selectedProject) {
    resetZoneDropdown(true);
    if (output) output.innerHTML = "";
    return;
  }

  if (refreshZones) {
    populateZoneDropdown(
      collectZoneValues(selectedProject, selectedTypeDocuments, window.records),
      selectedZoneDocument
    );
  }

  afficherPlansFiltres(
    selectedProject,
    selectedTypeDocuments,
    window.records,
    document.getElementById("zoneDropdown")?.value ||
      (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__")
  );
}

function handleTypeDocumentCheckboxChange(event) {
  const checkbox = event.target;
  if (!checkbox || checkbox.type !== "checkbox") return;

  const allTypesValue = getAllTypesValue();
  const checkboxes = getTypeDocumentCheckboxes();
  const valueCheckboxes = checkboxes.filter((item) => item.value !== allTypesValue);
  const allCheckbox = checkboxes.find((item) => item.value === allTypesValue);

  if (checkbox.value === allTypesValue) {
    valueCheckboxes.forEach((item) => {
      item.checked = checkbox.checked;
    });
  } else if (allCheckbox) {
    const checkedCount = valueCheckboxes.filter((item) => item.checked).length;
    allCheckbox.checked = valueCheckboxes.length > 0 && checkedCount === valueCheckboxes.length;
  }

  syncTypeDocumentDropdownForCompatibility();
  refreshCurrentPlanDisplay();
}

window.getSelectedTypeDocumentValues = getSelectedTypeDocumentValues;
window.getSelectedTypeDocumentSelection = getSelectedTypeDocumentSelection;
window.__LP_GET_CURRENT_TYPE = function () {
  const selection = getSelectedTypeDocumentSelection();
  if (selection.singleValue) {
    return { label: selection.singleValue, value: selection.singleValue };
  }
  if (selection.isAll) {
    return { label: selection.allLabel, value: selection.allValue };
  }
  if (selection.values.length > 1) {
    return { label: selection.values.join(", "), value: "__MULTIPLE_TYPES__" };
  }
  return { label: "", value: "" };
};

grist.ready({ requiredAccess: "full" });
void initializeListeDePlanShell();
window.addEventListener("pageshow", () => {
  void refreshProjectDropdownFromProjectsTable();
});
window.addEventListener("focus", () => {
  const dropdown = document.getElementById("projectDropdown");
  const savedSelection = loadLastSelection().projectLabel;
  if (!dropdown || dropdown.options.length <= 1 || (savedSelection && !dropdown.value)) {
    void refreshProjectDropdownFromProjectsTable();
  }
});

async function initializeListeDePlanShell() {
  await loadExternalComponents();
  await refreshProjectDropdownFromProjectsTable();
}

grist.onRecords(async (rec) => {
  window.records = rec.sort((a, b) => {
    const aDoc = a.NumeroDocument || "";
    const bDoc = b.NumeroDocument || "";

    const isANumber = !isNaN(aDoc) && !isNaN(parseFloat(aDoc));
    const isBNumber = !isNaN(bDoc) && !isNaN(parseFloat(bDoc));

    if (isANumber && isBNumber) {
      return parseFloat(aDoc) - parseFloat(bDoc);
    }

    return aDoc.localeCompare(bDoc);
  });

  const projetsDict = await chargerProjetsMap();
  const projets = Object.keys(projetsDict).sort();

  // Create a project-specific map to validate document number uniqueness.
  window.projectDocNumberToTypeMap = new Map();
  for (const r of window.records) {
    const projectNameRaw = (typeof r.Nom_projet === 'object' ? r.Nom_projet.details : r.Nom_projet);
    const projectName = (typeof projectNameRaw === 'string') ? projectNameRaw.trim() : projectNameRaw;

    if (!projectName || !r.NumeroDocument || !r.Type_document) continue;

    if (!window.projectDocNumberToTypeMap.has(projectName)) {
      window.projectDocNumberToTypeMap.set(projectName, new Map());
    }
    const projectMap = window.projectDocNumberToTypeMap.get(projectName);

    if (!projectMap.has(r.NumeroDocument)) {
      projectMap.set(r.NumeroDocument, new Set());
    }
    projectMap.get(r.NumeroDocument).add(r.Type_document);
  }

  populateDropdown("projectDropdown", projets);

  const selectedProject = document.getElementById("projectDropdown").value;
  if (selectedProject) {
    const projetsDict = await chargerProjetsMap();
    for (const r of window.records) {
      if (typeof r.Nom_projet === "number") {
        const projId = r.Nom_projet;
        const projLabel = Object.entries(projetsDict).find(([label, id]) => id === projId)?.[0] || null;
        if (projLabel) {
          r.Nom_projet = { id: projId, details: projLabel };
        }
      }
    }  

    const typesDocument = [...new Set(
      window.records
        .filter(r => {
          const nomRaw = (typeof r.Nom_projet === "object" ? r.Nom_projet.details : r.Nom_projet);
          const nom = (typeof nomRaw === "string") ? nomRaw.trim() : nomRaw;
          return nom === selectedProject.trim();
        })
        .map(r => r.Type_document)
        .filter(val => typeof val === "string" && val.trim())
    )].sort();

    populateTypeDocumentDropdown(typesDocument);
    const selectedTypeValue = getSelectedTypeDocumentValues();
    populateZoneDropdown(collectZoneValues(selectedProject, selectedTypeValue, window.records));
  } else {
    resetZoneDropdown(true);
  }

  const selectedTypeDocument = getSelectedTypeDocumentValues();
  const selectedZoneDocument = document.getElementById("zoneDropdown")?.value ||
    (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");
  if (selectedProject && selectedTypeDocument.length > 0) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records, selectedZoneDocument);
  }
});

function populateDropdown(id, values) {
  const dropdown = document.getElementById(id);
  if (!dropdown) return;
  const savedSelection = id === "projectDropdown" ? loadLastSelection().projectLabel : "";
  const currentValue = dropdown.value || savedSelection;
  const defaultOption = dropdown.options[0]?.textContent || "Choisir";

  dropdown.innerHTML = `<option value="">${defaultOption}</option>`;
  values.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    dropdown.appendChild(opt);
  });

  const matchingValue = values.find((value) =>
    normalizeProjectSelectionKey(value) === normalizeProjectSelectionKey(currentValue)
  );
  if (matchingValue) {
    dropdown.value = matchingValue;
  }
}

async function refreshProjectDropdownFromProjectsTable() {
  try {
    if (!grist?.docApi || typeof grist.docApi.fetchTable !== "function") return;

    const rawProjects = await grist.docApi.fetchTable("Projets2");
    const ids = Array.isArray(rawProjects?.id) ? rawProjects.id : [];
    const numbers = Array.isArray(rawProjects?.Numero_de_projet) ? rawProjects.Numero_de_projet : [];
    const names = Array.isArray(rawProjects?.Nom_de_projet) ? rawProjects.Nom_de_projet : [];
    _projectsData = ids
      .map((id, i) => ({
        id: Number(id),
        number: String(numbers[i] || '').trim(),
        name: String(names[i] || '').trim(),
      }))
      .filter((p) => p.id > 0 && p.name)
      .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true }));

    if (!_projectsData.length) return;

    const dropdown = document.getElementById("projectDropdown");
    if (!dropdown) return;

    const { projectLabel, projectId } = loadLastSelection();
    const defaultOption = dropdown.options[0]?.textContent || "Choisir";
    dropdown.innerHTML = `<option value="">${defaultOption}</option>`;

    _projectsData.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = `${p.number} - ${p.name}`;
      opt.dataset.projectId = String(p.id);
      dropdown.appendChild(opt);
    });

    // Restaurer par ID d'abord, puis par nom
    let restored = '';
    if (projectId) {
      const found = _projectsData.find((p) => p.id === projectId);
      if (found) restored = found.name;
    }
    if (!restored && projectLabel) {
      const found = _projectsData.find(
        (p) => normalizeProjectSelectionKey(p.name) === normalizeProjectSelectionKey(projectLabel)
      );
      if (found) restored = found.name;
    }
    dropdown.value = restored;
  } catch (error) {
    console.warn("Impossible de precharger la liste des projets :", error);
  }
}

function populateTypeDocumentDropdown(values) {
  const dropdown = document.getElementById("typeDocumentDropdown");
  const checkboxList = getTypeDocumentCheckboxList();
  if (!dropdown && !checkboxList) return;

  const allTypesValue = getAllTypesValue();
  const allTypesLabel = getAllTypesLabel();
  const previousSelection = getSelectedTypeDocumentValues();
  const uniqueValues = [...new Set(
    (values || [])
      .map(normalizeTypeDocumentValue)
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "fr", {
    sensitivity: "base",
    numeric: true
  }));
  const availableValues = new Set(uniqueValues);
  const previousExplicitValues = previousSelection
    .filter((value) => value !== allTypesValue && availableValues.has(value));
  const shouldSelectAll =
    previousSelection.length === 0 ||
    previousSelection.includes(allTypesValue) ||
    previousExplicitValues.length === 0;

  if (dropdown) {
    dropdown.innerHTML = `<option value="${allTypesValue}">${allTypesLabel}</option>`;
    uniqueValues.forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      dropdown.appendChild(opt);
    });
  }

  if (checkboxList) {
    checkboxList.innerHTML = "";
    appendTypeDocumentCheckbox(checkboxList, allTypesValue, allTypesLabel, shouldSelectAll);
    uniqueValues.forEach((val) => {
      appendTypeDocumentCheckbox(
        checkboxList,
        val,
        val,
        shouldSelectAll || previousExplicitValues.includes(val)
      );
    });
  }

  syncTypeDocumentDropdownForCompatibility();
}

function normalizeZoneDropdownValue(value) {
  return String(value ?? "").trim();
}

function getZoneDropdownOptionValue(zoneValue) {
  const normalizedZone = normalizeZoneDropdownValue(zoneValue);
  return normalizedZone || (window.LISTE_DE_PLAN_NO_ZONE_VALUE || "__NO_ZONE__");
}

function getZoneDropdownOptionLabel(zoneValue) {
  const normalizedZone = normalizeZoneDropdownValue(zoneValue);
  return normalizedZone || (window.LISTE_DE_PLAN_NO_ZONE_LABEL || "Sans zone");
}

function collectZoneValues(selectedProject, selectedTypeDocument, records = window.records) {
  const normalizedProject = normalizeProjectName(selectedProject);
  const allTypesValue = getAllTypesValue();
  const selectedTypes = Array.isArray(selectedTypeDocument)
    ? selectedTypeDocument.map(normalizeTypeDocumentValue).filter(Boolean)
    : [normalizeTypeDocumentValue(selectedTypeDocument)].filter(Boolean);
  const includeAllTypes = selectedTypes.includes(allTypesValue);
  const selectedTypeSet = new Set(selectedTypes.filter((value) => value !== allTypesValue));

  if (!includeAllTypes && selectedTypeSet.size === 0) {
    return [];
  }

  const zoneSet = new Set();
  for (const record of records || []) {
    if (getNomProjet(record) !== normalizedProject) continue;

    const recordType = String(record?.Type_document ?? "").trim();
    if (!recordType) continue;
    if (!includeAllTypes && !selectedTypeSet.has(recordType)) continue;

    zoneSet.add(normalizeZoneDropdownValue(record?.Zone));
  }

  return [...zoneSet].sort((left, right) => {
    const leftZone = normalizeZoneDropdownValue(left);
    const rightZone = normalizeZoneDropdownValue(right);
    if (!leftZone && rightZone) return 1;
    if (leftZone && !rightZone) return -1;
    return leftZone.localeCompare(rightZone, "fr", {
      sensitivity: "base",
      numeric: true
    });
  });
}

function normalizeZoneManageStorageValue(value) {
  const text = normalizeZoneDropdownValue(value);
  const noZoneValue = window.LISTE_DE_PLAN_NO_ZONE_VALUE || "__NO_ZONE__";
  if (!text) return "";
  if (text === noZoneValue) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
}

function normalizeZoneManageKey(value) {
  return normalizeZoneManageStorageValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeManageLookupText(value) {
  if (value == null) return "";
  if (typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.details === "string") return value.details.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
    if (typeof value.Name === "string") return value.Name.trim();
  }
  return String(value).trim();
}

function normalizeManageProjectKey(value) {
  return normalizeManageLookupText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function getManageLookupKeys(value) {
  const values = [];

  if (value && typeof value === "object" && !Array.isArray(value)) {
    [
      value.details,
      value.display,
      value.label,
      value.name,
      value.Name,
      value.id,
      value.value,
    ].forEach((candidate) => {
      const key = normalizeManageProjectKey(candidate);
      if (key) values.push(key);
    });
  } else {
    const key = normalizeManageProjectKey(value);
    if (key) values.push(key);
  }

  return [...new Set(values)];
}

function normalizeManageRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.records)) return raw.records;

  if (
    raw.records &&
    typeof raw.records === "object" &&
    !Array.isArray(raw.records)
  ) {
    return Object.entries(raw.records).map(([id, row]) => ({
      id: Number(id),
      ...(row || {}),
    }));
  }

  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    if (!keys.length) return [];

    const maxLen = Math.max(
      ...keys.map((key) => (Array.isArray(raw[key]) ? raw[key].length : 0))
    );
    if (maxLen <= 0) return [];

    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const row = {};
      for (const key of keys) {
        row[key] = Array.isArray(raw[key]) ? raw[key][i] : undefined;
      }
      rows.push(row);
    }
    return rows;
  }

  return [];
}

function collectManageColumnNames(rows) {
  const names = new Set();
  for (const row of rows || []) {
    Object.keys(row || {}).forEach((key) => names.add(key));
  }
  return names;
}

function findManageColumn(columnNames, candidates = []) {
  for (const candidate of candidates || []) {
    const name = String(candidate || "").trim();
    if (name && columnNames.has(name)) return name;
  }
  return "";
}

async function fetchFirstManageZoneTable(candidates = []) {
  let lastError = null;
  for (const candidate of candidates) {
    const tableName = String(candidate || "").trim();
    if (!tableName) continue;

    try {
      const raw = await grist.docApi.fetchTable(tableName);
      return {
        tableName,
        rows: normalizeManageRows(raw),
      };
    } catch (error) {
      lastError = error;
    }
  }

  return { tableName: "", rows: [], error: lastError };
}

async function buildZoneManageProjectAliasKeys(projectName) {
  const aliases = new Set(getManageLookupKeys(projectName));
  const projectKey = normalizeManageProjectKey(projectName);

  try {
    const raw = await grist.docApi.fetchTable("Projets2");
    const rows = normalizeManageRows(raw);
    const columnNames = collectManageColumnNames(rows);
    const projectCol = findManageColumn(columnNames, [
      "Nom_de_projet",
      "NomProjet",
      "NomProjetString",
    ]);
    const projectNumberCol = findManageColumn(columnNames, [
      "Numero_de_projet",
      "NumeroProjet",
    ]);

    for (const row of rows || []) {
      if (!getManageLookupKeys(row?.[projectCol]).includes(projectKey)) continue;

      [
        row?.id,
        row?.[projectCol],
        row?.[projectNumberCol],
        row?.Nom_de_projet,
        row?.NomProjet,
        row?.Numero_de_projet,
        row?.NumeroProjet,
      ].forEach((value) => {
        getManageLookupKeys(value).forEach((key) => aliases.add(key));
      });
    }
  } catch (error) {
    console.warn("Impossible de charger les alias projet pour Modifier Zone :", error);
  }

  return aliases;
}

function buildManageZoneContext(tableName, rows, {
  projectCandidates = [],
  zoneCandidates = [],
  id2Candidates = [],
  taskCandidates = [],
  typeCandidates = [],
  planning = false,
} = {}) {
  if (!tableName) return null;
  const columnNames = collectManageColumnNames(rows);

  return {
    tableName,
    rows: Array.isArray(rows) ? rows : [],
    projectCol: findManageColumn(columnNames, projectCandidates),
    zoneCol: findManageColumn(columnNames, zoneCandidates),
    id2Col: findManageColumn(columnNames, id2Candidates),
    taskCols: (taskCandidates || []).filter((candidate) => columnNames.has(candidate)),
    typeCol: findManageColumn(columnNames, typeCandidates),
    planning,
  };
}

async function fetchManageZoneContexts() {
  const [referencesResult, listePlanResult, planningResult] = await Promise.all([
    fetchFirstManageZoneTable([MANAGE_ZONE_REFERENCES_TABLE]),
    fetchFirstManageZoneTable(MANAGE_ZONE_LISTEPLAN_TABLE_CANDIDATES),
    fetchFirstManageZoneTable(MANAGE_ZONE_PLANNING_TABLE_CANDIDATES),
  ]);

  return [
    buildManageZoneContext(referencesResult.tableName, referencesResult.rows, {
      projectCandidates: ["NomProjetString", "NomProjet", "Nom_projet"],
      zoneCandidates: ["Zone"],
    }),
    buildManageZoneContext(listePlanResult.tableName, listePlanResult.rows, {
      projectCandidates: ["Nom_projet", "NomProjet", "NomProjetString"],
      zoneCandidates: ["Zone"],
    }),
    buildManageZoneContext(planningResult.tableName, planningResult.rows, {
      projectCandidates: ["NomProjet", "Nom_projet", "NomProjetString"],
      zoneCandidates: ["Zone"],
      id2Candidates: ["ID2", "NumeroDocument"],
      taskCandidates: ["Taches", "Tache"],
      typeCandidates: ["Type_doc", "Type_document", "TypeDoc"],
      planning: true,
    }),
  ].filter(Boolean);
}

function rowMatchesManageProject(row, projectCol, projectAliasKeys) {
  if (!projectCol) return false;
  return getManageLookupKeys(row?.[projectCol]).some((key) => projectAliasKeys.has(key));
}

function isManageZoneAnchorRow(row, context) {
  if (!context?.planning) return false;
  if (context.id2Col && normalizeManageLookupText(row?.[context.id2Col])) return false;
  if (context.typeCol && normalizeManageLookupText(row?.[context.typeCol])) return false;

  const taskCols = Array.isArray(context.taskCols) ? context.taskCols : [];
  if (!taskCols.length) return false;

  return taskCols.every((columnName) => !normalizeManageLookupText(row?.[columnName]));
}

function ensureNoManageZoneDuplicate({
  contexts,
  projectAliasKeys,
  sourceZoneKey,
  targetZoneKey,
}) {
  if (!targetZoneKey || targetZoneKey === sourceZoneKey) return;

  for (const context of contexts || []) {
    if (!context.projectCol || !context.zoneCol) continue;

    for (const row of context.rows || []) {
      if (!rowMatchesManageProject(row, context.projectCol, projectAliasKeys)) continue;

      const zoneKey = normalizeZoneManageKey(row?.[context.zoneCol]);
      if (zoneKey && zoneKey === targetZoneKey) {
        throw new Error("Une zone avec ce nom existe deja pour ce projet.");
      }
    }
  }
}

function buildManageZoneActions({
  contexts,
  projectAliasKeys,
  sourceZoneKey,
  targetZone,
  removeAnchors = false,
}) {
  const actions = [];
  const seenRows = new Set();
  const normalizedTargetZone = normalizeZoneManageStorageValue(targetZone);

  for (const context of contexts || []) {
    if (!context.tableName || !context.projectCol || !context.zoneCol) continue;

    for (const row of context.rows || []) {
      const rowId = Number(row?.id);
      if (!Number.isInteger(rowId) || rowId <= 0) continue;
      if (!rowMatchesManageProject(row, context.projectCol, projectAliasKeys)) continue;
      if (normalizeZoneManageKey(row?.[context.zoneCol]) !== sourceZoneKey) continue;

      const rowKey = `${context.tableName}:${rowId}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);

      if (removeAnchors && isManageZoneAnchorRow(row, context)) {
        actions.push(["RemoveRecord", context.tableName, rowId]);
        continue;
      }

      if (normalizeZoneDropdownValue(row?.[context.zoneCol]) === normalizedTargetZone) {
        continue;
      }

      actions.push([
        "UpdateRecord",
        context.tableName,
        rowId,
        {
          [context.zoneCol]: normalizedTargetZone,
        },
      ]);
    }
  }

  return actions;
}

function countManageZoneActions(actions = []) {
  return actions.reduce(
    (counts, action) => {
      const actionType = action?.[0];
      if (actionType === "RemoveRecord") {
        counts.deletedCount += 1;
      } else if (actionType === "UpdateRecord") {
        counts.updatedCount += 1;
      }
      return counts;
    },
    { updatedCount: 0, deletedCount: 0 }
  );
}

async function applyManageZoneActions(actions) {
  if (!actions.length) return;
  if (!grist.docApi || typeof grist.docApi.applyUserActions !== "function") {
    throw new Error("grist.docApi.applyUserActions indisponible.");
  }
  await grist.docApi.applyUserActions(actions);
}

async function renameManageProjectZone({ projectName, sourceZone, targetZone }) {
  const normalizedProject = normalizeProjectName(projectName);
  const normalizedSourceZone = normalizeZoneManageStorageValue(sourceZone);
  const normalizedTargetZone = normalizeZoneManageStorageValue(targetZone);
  const sourceZoneKey = normalizeZoneManageKey(normalizedSourceZone);
  const targetZoneKey = normalizeZoneManageKey(normalizedTargetZone);

  if (!normalizedProject) throw new Error("Projet obligatoire.");
  if (!sourceZoneKey) throw new Error("Zone source obligatoire.");
  if (!targetZoneKey) throw new Error("Nouveau nom de zone obligatoire.");

  const [projectAliasKeys, contexts] = await Promise.all([
    buildZoneManageProjectAliasKeys(normalizedProject),
    fetchManageZoneContexts(),
  ]);

  ensureNoManageZoneDuplicate({
    contexts,
    projectAliasKeys,
    sourceZoneKey,
    targetZoneKey,
  });

  const actions = buildManageZoneActions({
    contexts,
    projectAliasKeys,
    sourceZoneKey,
    targetZone: normalizedTargetZone,
  });

  await applyManageZoneActions(actions);

  return {
    sourceZone: normalizedSourceZone,
    targetZone: normalizedTargetZone,
    ...countManageZoneActions(actions),
  };
}

async function clearManageProjectZone({ projectName, sourceZone }) {
  const normalizedProject = normalizeProjectName(projectName);
  const normalizedSourceZone = normalizeZoneManageStorageValue(sourceZone);
  const sourceZoneKey = normalizeZoneManageKey(normalizedSourceZone);

  if (!normalizedProject) throw new Error("Projet obligatoire.");
  if (!sourceZoneKey) throw new Error("Zone source obligatoire.");

  const [projectAliasKeys, contexts] = await Promise.all([
    buildZoneManageProjectAliasKeys(normalizedProject),
    fetchManageZoneContexts(),
  ]);

  const actions = buildManageZoneActions({
    contexts,
    projectAliasKeys,
    sourceZoneKey,
    targetZone: "",
    removeAnchors: true,
  });

  await applyManageZoneActions(actions);

  return {
    sourceZone: normalizedSourceZone,
    ...countManageZoneActions(actions),
  };
}

function collectProjectZoneValues(selectedProject, records = window.records) {
  const normalizedProject = normalizeProjectName(selectedProject);
  if (!normalizedProject) return [];

  const zonesByKey = new Map();
  for (const record of records || []) {
    if (getNomProjet(record) !== normalizedProject) continue;

    const zone = normalizeZoneManageStorageValue(record?.Zone);
    const zoneKey = normalizeZoneManageKey(zone);
    if (!zoneKey || zonesByKey.has(zoneKey)) continue;
    zonesByKey.set(zoneKey, zone);
  }

  return [...zonesByKey.values()].sort((left, right) =>
    left.localeCompare(right, "fr", {
      sensitivity: "base",
      numeric: true,
    })
  );
}

function restoreZoneDropdownSelection(zoneValue = lastRegularZoneSelection) {
  const dropdown = document.getElementById("zoneDropdown");
  if (!(dropdown instanceof HTMLSelectElement)) return;

  const allZonesValue = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";
  const normalizedValue = String(zoneValue || allZonesValue);
  dropdown.value = normalizedValue;
  if (dropdown.value !== normalizedValue) {
    dropdown.value = allZonesValue;
  }

  lastRegularZoneSelection = dropdown.value || allZonesValue;
}

function setManageZoneStatus(message = "") {
  const status = document.getElementById("manageZoneStatus");
  if (status) status.textContent = String(message || "");
}

function updateLocalRecordsProjectZone({ projectName, sourceZone, targetZone }) {
  const normalizedProject = normalizeProjectName(projectName);
  const sourceZoneKey = normalizeZoneManageKey(sourceZone);

  for (const record of window.records || []) {
    if (getNomProjet(record) !== normalizedProject) continue;
    if (normalizeZoneManageKey(record?.Zone) !== sourceZoneKey) continue;
    record.Zone = normalizeZoneManageStorageValue(targetZone);
  }
}

function getManageZoneElements() {
  return {
    dialog: document.getElementById("dlg-manage-zone"),
    closeBtn: document.getElementById("manage-zone-close"),
    projectInput: document.getElementById("manage-zone-project"),
    zoneSelect: document.getElementById("manage-zone-select"),
    newNameInput: document.getElementById("manage-zone-new-name"),
    hint: document.getElementById("manage-zone-hint"),
    renameBtn: document.getElementById("manage-zone-rename"),
    deleteBtn: document.getElementById("manage-zone-delete"),
  };
}

function setManageZoneHint(message = "") {
  const { hint } = getManageZoneElements();
  if (hint) hint.textContent = String(message || "");
}

function setManageZoneBusy(isBusy) {
  const { zoneSelect, newNameInput, renameBtn, deleteBtn } = getManageZoneElements();
  [zoneSelect, newNameInput, renameBtn, deleteBtn].forEach((element) => {
    if (element instanceof HTMLElement) {
      element.toggleAttribute("disabled", Boolean(isBusy));
    }
  });
}

function populateManageZoneDialogZones(zones, preferredZone = "") {
  const { zoneSelect, newNameInput } = getManageZoneElements();
  if (!(zoneSelect instanceof HTMLSelectElement)) return "";

  zoneSelect.innerHTML = "";
  const preferredKey = normalizeZoneManageKey(preferredZone);
  let selectedZone = "";

  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone;
    zoneSelect.appendChild(option);

    if (!selectedZone || normalizeZoneManageKey(zone) === preferredKey) {
      selectedZone = zone;
    }
  });

  if (selectedZone) zoneSelect.value = selectedZone;
  if (newNameInput instanceof HTMLInputElement) {
    newNameInput.value = selectedZone;
  }

  return selectedZone;
}

function openManageZoneDialog() {
  const {
    dialog,
    projectInput,
    newNameInput,
  } = getManageZoneElements();
  if (!(dialog instanceof HTMLDialogElement)) return;

  const selectedProject = document.getElementById("projectDropdown")?.value || "";
  const zones = collectProjectZoneValues(selectedProject, window.records);

  if (!selectedProject) {
    setManageZoneStatus("Selectionne d'abord un projet.");
    return;
  }
  if (!zones.length) {
    setManageZoneStatus("Aucune zone nommee a modifier pour ce projet.");
    return;
  }

  const currentZone = document.getElementById("zoneDropdown")?.value || "";
  const allZonesValue = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";
  const preferredZone = currentZone === allZonesValue ? "" : currentZone;

  if (projectInput instanceof HTMLInputElement) {
    projectInput.value = selectedProject;
  }

  populateManageZoneDialogZones(zones, preferredZone);
  setManageZoneHint("");
  setManageZoneStatus("");
  setManageZoneBusy(false);
  dialog.showModal();

  if (newNameInput instanceof HTMLInputElement) {
    newNameInput.focus();
    newNameInput.select();
  }
}

function closeManageZoneDialog() {
  const { dialog } = getManageZoneElements();
  if (dialog instanceof HTMLDialogElement && dialog.open) {
    dialog.close();
  }
  setManageZoneHint("");
  setManageZoneBusy(false);
  restoreZoneDropdownSelection();
}

function bindManageZoneDialog() {
  const {
    dialog,
    closeBtn,
    zoneSelect,
    newNameInput,
    renameBtn,
    deleteBtn,
  } = getManageZoneElements();

  if (closeBtn instanceof HTMLElement) {
    closeBtn.addEventListener("click", closeManageZoneDialog);
  }

  if (dialog instanceof HTMLDialogElement) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
    });
  }

  if (zoneSelect instanceof HTMLSelectElement) {
    zoneSelect.addEventListener("change", () => {
      if (newNameInput instanceof HTMLInputElement) {
        newNameInput.value = zoneSelect.value;
        newNameInput.focus();
        newNameInput.select();
      }
      setManageZoneHint("");
    });
  }

  if (renameBtn instanceof HTMLElement) {
    renameBtn.addEventListener("click", async () => {
      const projectName = document.getElementById("projectDropdown")?.value || "";
      const sourceZone = zoneSelect instanceof HTMLSelectElement ? zoneSelect.value : "";
      const targetZone = newNameInput instanceof HTMLInputElement ? newNameInput.value : "";
      const sourceKey = normalizeZoneManageKey(sourceZone);
      const targetKey = normalizeZoneManageKey(targetZone);

      if (!sourceKey) {
        setManageZoneHint("Selectionne une zone a renommer.");
        return;
      }
      if (!targetKey) {
        setManageZoneHint("Renseigne le nouveau nom de zone.");
        return;
      }

      const duplicate = collectProjectZoneValues(projectName, window.records).some((zone) => {
        const key = normalizeZoneManageKey(zone);
        return key === targetKey && key !== sourceKey;
      });
      if (duplicate) {
        setManageZoneHint("Une zone avec ce nom existe deja pour ce projet.");
        return;
      }

      try {
        setManageZoneBusy(true);
        setManageZoneHint("Renommage en cours...");
        const result = await renameManageProjectZone({
          projectName,
          sourceZone,
          targetZone,
        });
        const updatedCount = Number(result.updatedCount) || 0;

        if (updatedCount > 0) {
          updateLocalRecordsProjectZone({ projectName, sourceZone, targetZone });
        }
        closeManageZoneDialog();
        populateZoneDropdown(
          collectZoneValues(projectName, getSelectedTypeDocumentValues(), window.records),
          normalizeZoneDropdownValue(targetZone)
        );
        refreshCurrentPlanDisplay({ refreshZones: false });
        setManageZoneStatus(
          `Zone renommee: ${sourceZone} -> ${normalizeZoneDropdownValue(targetZone)}.`
        );
      } catch (error) {
        setManageZoneBusy(false);
        setManageZoneHint(`Erreur: ${error.message}`);
      }
    });
  }

  if (deleteBtn instanceof HTMLElement) {
    deleteBtn.addEventListener("click", async () => {
      const projectName = document.getElementById("projectDropdown")?.value || "";
      const sourceZone = zoneSelect instanceof HTMLSelectElement ? zoneSelect.value : "";
      const sourceKey = normalizeZoneManageKey(sourceZone);

      if (!sourceKey) {
        setManageZoneHint("Selectionne une zone a supprimer.");
        return;
      }

      const confirmed = window.confirm(
        `Supprimer la zone "${sourceZone}" ? Les documents seront conserves et passeront en Sans zone.`
      );
      if (!confirmed) return;

      try {
        setManageZoneBusy(true);
        setManageZoneHint("Suppression de la zone en cours...");
        const result = await clearManageProjectZone({
          projectName,
          sourceZone,
        });
        const updatedCount = Number(result.updatedCount) || 0;
        const deletedCount = Number(result.deletedCount) || 0;

        if (updatedCount + deletedCount > 0) {
          updateLocalRecordsProjectZone({ projectName, sourceZone, targetZone: "" });
        }
        closeManageZoneDialog();
        populateZoneDropdown(
          collectZoneValues(projectName, getSelectedTypeDocumentValues(), window.records),
          window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__"
        );
        refreshCurrentPlanDisplay({ refreshZones: false });
        setManageZoneStatus(`Zone supprimee: ${sourceZone}.`);
      } catch (error) {
        setManageZoneBusy(false);
        setManageZoneHint(`Erreur: ${error.message}`);
      }
    });
  }
}

function populateZoneDropdown(values, preferredValue = null) {
  const dropdown = document.getElementById("zoneDropdown");
  if (!dropdown) return;

  const zoneValues = Array.isArray(values) ? values : [];
  const requestedValue = preferredValue != null ? String(preferredValue) : String(dropdown.value || "");
  const allZonesValue = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";
  const allZonesLabel = window.LISTE_DE_PLAN_ALL_ZONES_LABEL || "Toutes les zones";
  const currentValue =
    requestedValue === MANAGE_ZONE_OPTION_VALUE
      ? lastRegularZoneSelection || allZonesValue
      : requestedValue;
  const hasManageableZones = zoneValues.some((zoneValue) => normalizeZoneManageKey(zoneValue));

  dropdown.innerHTML = `<option value="${allZonesValue}">${allZonesLabel}</option>`;
  zoneValues.forEach((zoneValue) => {
    const option = document.createElement("option");
    option.value = getZoneDropdownOptionValue(zoneValue);
    option.textContent = getZoneDropdownOptionLabel(zoneValue);
    dropdown.appendChild(option);
  });

  if (hasManageableZones) {
    const separator = document.createElement("option");
    separator.value = "";
    separator.textContent = "--------------------";
    separator.disabled = true;
    dropdown.appendChild(separator);

    const manageOption = document.createElement("option");
    manageOption.value = MANAGE_ZONE_OPTION_VALUE;
    manageOption.textContent = "Modifier Zone";
    dropdown.appendChild(manageOption);
  }

  const availableValues = new Set(zoneValues.map((zoneValue) => getZoneDropdownOptionValue(zoneValue)));
  if (currentValue === allZonesValue || availableValues.has(currentValue)) {
    dropdown.value = currentValue || allZonesValue;
  } else {
    dropdown.value = allZonesValue;
  }

  lastRegularZoneSelection = dropdown.value || allZonesValue;
  dropdown.disabled = false;
}

function resetZoneDropdown(disabled = false) {
  const dropdown = document.getElementById("zoneDropdown");
  if (!dropdown) return;

  const allZonesValue = window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__";
  const allZonesLabel = window.LISTE_DE_PLAN_ALL_ZONES_LABEL || "Toutes les zones";
  dropdown.innerHTML = `<option value="${allZonesValue}">${allZonesLabel}</option>`;
  dropdown.value = allZonesValue;
  dropdown.disabled = disabled;
  lastRegularZoneSelection = allZonesValue;
}

document.getElementById("projectDropdown").addEventListener("change", () => {
  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedOpt = document.getElementById("projectDropdown").selectedOptions?.[0];
  const selectedProjectId = selectedOpt?.dataset?.projectId ? Number(selectedOpt.dataset.projectId) : null;
  saveLastSelection({ projectLabel: selectedProject, projectId: selectedProjectId, typeLabel: null });
  if (!selectedProject) {
    populateTypeDocumentDropdown([]);
    resetZoneDropdown(true);
    document.getElementById("plans-output").innerHTML = "";
    return;
  }

  const typesDocumentSet = new Set();

  if(!window.records)
    console.log("no window records");

  for (const r of window.records) {
    let label = null;

    if (typeof r.Nom_projet === "object" && r.Nom_projet !== null) {
      if ("details" in r.Nom_projet) label = r.Nom_projet.details;
      else if ("display" in r.Nom_projet) label = r.Nom_projet.display;
    } else if (typeof r.Nom_projet === "string") {
      label = r.Nom_projet;
    } else if (typeof r.Nom_projet === "number") {
      label = Object.entries(window.projetsDictGlobal || {}).find(([k, v]) => v === r.Nom_projet)?.[0] || null;
    }

    if (label === selectedProject && typeof r.Type_document === "string" && r.Type_document.trim()) {
      typesDocumentSet.add(r.Type_document.trim());
    }
  }

  const typesDocument = [...typesDocumentSet].sort();
  populateTypeDocumentDropdown(typesDocument);
  console.log("Types affichés dans la deuxième liste :", typesDocument);
  selectAllTypeDocuments();
  populateZoneDropdown(
    collectZoneValues(
      selectedProject,
      getSelectedTypeDocumentValues(),
      window.records
    ),
    window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__"
  );
  afficherPlansFiltres(
    selectedProject,
    getSelectedTypeDocumentValues(),
    window.records,
    document.getElementById("zoneDropdown").value
  );
});

document.getElementById("typeDocumentCheckboxList")?.addEventListener("change", handleTypeDocumentCheckboxChange);

document.getElementById("typeDocumentMenuButton")?.addEventListener("click", () => {
  toggleTypeDocumentMenu();
});

document.addEventListener("click", (event) => {
  const menu = getTypeDocumentCheckboxDropdown();
  if (!menu || menu.contains(event.target)) return;

  setTypeDocumentMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  setTypeDocumentMenuOpen(false);
});

document.getElementById("typeDocumentDropdown")?.addEventListener("change", () => {
  if (window.__skipChangeEvent) return;

  const selectedTypeDocument = document.getElementById("typeDocumentDropdown").value ||
    getAllTypesValue();
  setSelectedTypeDocumentValues([selectedTypeDocument]);
  refreshCurrentPlanDisplay();
});

document.getElementById("zoneDropdown").addEventListener("change", () => {
  const zoneDropdown = document.getElementById("zoneDropdown");
  const selectedProject = document.getElementById("projectDropdown").value;
  const selectedTypeDocument = getSelectedTypeDocumentValues();
  const selectedZoneDocument = zoneDropdown?.value || "";

  if (selectedZoneDocument === MANAGE_ZONE_OPTION_VALUE) {
    restoreZoneDropdownSelection();
    openManageZoneDialog();
    return;
  }

  lastRegularZoneSelection = selectedZoneDocument ||
    (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");

  if (selectedProject && selectedTypeDocument.length > 0) {
    afficherPlansFiltres(selectedProject, selectedTypeDocument, window.records, selectedZoneDocument);
  }
});

bindManageZoneDialog();

async function supprimerLignesSansDate() {
  console.log("== SUPPRESSION : routine appelée ==");

  const tableName = "ListePlan_NDC_COF";
  const data = await grist.docApi.fetchTable(tableName);
  console.log("=== Données brutes ===", data);

  const rows = Object.entries(data.records || {}).map(([id, row]) => {
    const r = { id: parseInt(id), ...row };
    console.log(`Ligne ${r.id} :`, r);
    return r;
  });

  const lignesASupprimer = rows.filter(r =>
    r.DateDiffusion === null || r.DateDiffusion === undefined
  );

  console.log("=== Lignes ciblées ===", lignesASupprimer.map(r => r.id));

  if (lignesASupprimer.length === 0) {
    console.log("Aucune ligne à supprimer.");
    return;
  }

  const actions = lignesASupprimer.map(r => [
    "DeleteRecord",
    tableName,
    r.id
  ]);

  console.log("=== Actions envoyées ===", actions);

  await grist.docApi.applyUserActions(actions);
  console.log("=== Suppression exécutée ===");

  const table = document.querySelector(".plan-table");
  if (!table) {
    console.warn("Table HTML non trouvée");
    return;
  }

  const lignesDOM = table.querySelectorAll("tbody tr");
  lignesDOM.forEach(tr => {
    const cellules = tr.querySelectorAll("td");
    const contientDates = Array.from(cellules).some(td => {
      const text = td.textContent.trim();
      return /^\d{2}\/\d{2}\/\d{4}$/.test(text);
    });

    if (!contientDates) {
      console.log("→ Suppression visuelle ligne :", tr);
      tr.remove();
    }
  });
}

async function loadExternalComponents() {
  try {
    const placeholder = document.getElementById('dialog-placeholder');
    if (!placeholder) {
      console.error("L'élément #dialog-placeholder est introuvable dans index.html.");
      return;
    }

    // 1) Injecter la boîte de dialogue "Ajouter Projet"
    {
      const respProj = await fetch('AjouterProjet.html');
      if (!respProj.ok) throw new Error(`Erreur HTTP AjouterProjet.html: ${respProj.status}`);
      const htmlProj = await respProj.text();

      // on remplace le contenu au premier chargement (comportement actuel)
      placeholder.innerHTML = htmlProj;

      if (typeof initAjouterProjet === 'function') {
        initAjouterProjet();
      } else {
        console.error("initAjouterProjet() introuvable. Vérifie que AjouterProjet.js est bien chargé.");
      }
    }

    // 2) Injecter la boîte de dialogue "Ajouter document (Référence)"
    {
      const respRef = await fetch('AjouterReferenceDocument.html');
      if (!respRef.ok) throw new Error(`Erreur HTTP AjouterReferenceDocument.html: ${respRef.status}`);
      const htmlRef = await respRef.text();

      // on ajoute APRES le contenu existant, sans l’écraser
      placeholder.insertAdjacentHTML('beforeend', htmlRef);

      if (typeof initAjouterReferenceDocument === 'function') {
        initAjouterReferenceDocument();
      } else {
        console.error("initAjouterReferenceDocument() introuvable. Vérifie que AjouterReferenceDocument.js est bien chargé (index.html).");
      }
    }

  } catch (error) {
    console.error("Erreur lors du chargement des composants externes :", error);
  }
}



    // Mémorise la sélection si on a des selects standards
    const projSel = detectProjectSelect();
    const typeSel = detectTypeSelect();
    if (projSel && !projSel.__lpSaveBound) {
      projSel.addEventListener('change', () => {
        const v = getSelectedLabelAndValue(projSel);
        const id = (window.__LP_PROJECT_MAP ? window.__LP_PROJECT_MAP.get(v.label) : null) ?? null;
        saveLastSelection({ projectLabel: v.label, projectId: id, typeLabel: null });
      });
      projSel.__lpSaveBound = true;
    }
    if (typeSel && !typeSel.__lpSaveBound) {
      typeSel.addEventListener('change', () => {
        const v = getSelectedLabelAndValue(typeSel);
        saveLastSelection({ projectLabel: null, projectId: null, typeLabel: v.label });
      });
      typeSel.__lpSaveBound = true;
    }

// --- PDF Generation logic ---
document.addEventListener("DOMContentLoaded", () => {
  const btnPrint = document.getElementById("btn-print");
  if (btnPrint) {
    btnPrint.addEventListener("click", async () => {
      const selectedProject = document.getElementById("projectDropdown").value;
      if (!selectedProject) {
        alert("Veuillez sélectionner un projet avant d'imprimer.");
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("p", "mm", "a4");
      
      const logo1Url = await fetch("../img/VC_Logotype_Digital_RVB.jpg").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
      const logo2Url = await fetch("../img/bloc délégation bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
      const logo3Url = await fetch("../img/Logo DRTO fr - Bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));

      let startY = 40;
      doc.setFontSize(18);
      doc.text(`Projet : ${selectedProject}`, 16, 30);

      const output = document.getElementById("plans-output");
      const children = Array.from(output.querySelectorAll("h2, h3, table"));

      if (children.length === 0) {
        alert("Aucun plan à imprimer.");
        return;
      }

      for (const child of children) {
        if (child.tagName === "H2" || child.tagName === "H3") {
          if (startY > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            startY = 40;
          }
          doc.setFontSize(child.tagName === "H2" ? 16 : 14);
          doc.text(child.textContent, 14, startY);
          startY += 8;
        } else if (child.tagName === "TABLE") {
          doc.autoTable({
            html: child,
            startY: startY,
            margin: { top: 40 },
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 73, 144] },
            didDrawPage: function() {
              // startY is reset automatically by autoTable on new pages
            }
          });
          startY = doc.lastAutoTable.finalY + 10;
        }
      }

      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.addImage(logo1Url, "JPEG", 10, 10, 40, 15);
        doc.addImage(logo2Url, "PNG", doc.internal.pageSize.getWidth() - 72, 10, 40, 15);
        doc.addImage(logo3Url, "PNG", doc.internal.pageSize.getWidth() - 30, 10, 15, 15);
        doc.setFontSize(10);
        doc.text(`Page ${i} / ${totalPages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 10);
      }

      doc.save(`${selectedProject} - Plans.pdf`);
    });
  }
});

function getPrintAvailableTypeValues(selectedProject) {
  const projectName = normalizeProjectName(selectedProject);
  const typeSet = new Set();

  for (const record of window.records || []) {
    const recordProject = typeof getRecordProjectName === "function"
      ? getRecordProjectName(record)
      : getNomProjet(record);
    if (normalizeProjectName(recordProject) !== projectName) continue;

    const type = normalizeTypeDocumentValue(record?.Type_document);
    if (type) typeSet.add(type);
  }

  return [...typeSet].sort((left, right) => left.localeCompare(right, "fr", {
    sensitivity: "base",
    numeric: true
  }));
}

function getDefaultPrintSelectedTypes(availableTypes) {
  const selection = getSelectedTypeDocumentSelection();
  if (selection.isAll) return new Set(availableTypes);

  return new Set(selection.values.filter((type) => availableTypes.includes(type)));
}

function syncMainTypeSelectionFromPrintOrder(orderedTypes, availableTypes) {
  if (!Array.isArray(orderedTypes) || orderedTypes.length === 0) return;

  const allTypesAreSelected = Array.isArray(availableTypes) &&
    availableTypes.length > 0 &&
    orderedTypes.length === availableTypes.length &&
    availableTypes.every((type) => orderedTypes.includes(type));

  if (allTypesAreSelected) {
    selectAllTypeDocuments();
  } else {
    setSelectedTypeDocumentValues(orderedTypes);
  }
  refreshCurrentPlanDisplay();
}

function createPrintTypeOrderItem(type, checked) {
  const item = document.createElement("label");
  item.className = "print-type-order-item";
  item.draggable = true;
  item.dataset.typeDocument = type;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;

  const text = document.createElement("span");
  text.className = "print-type-order-label";
  text.textContent = type;

  const handle = document.createElement("span");
  handle.className = "print-type-order-handle";
  handle.textContent = "::";
  handle.setAttribute("aria-hidden", "true");

  item.appendChild(checkbox);
  item.appendChild(text);
  item.appendChild(handle);
  return item;
}

function getPrintDragAfterElement(container, y) {
  const items = [...container.querySelectorAll(".print-type-order-item:not(.is-dragging)")];

  return items.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function setupPrintTypeOrderDrag(list) {
  list.addEventListener("dragstart", (event) => {
    const item = event.target.closest(".print-type-order-item");
    if (!item) return;

    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.dataset.typeDocument || "");
  });

  list.addEventListener("dragend", (event) => {
    event.target.closest(".print-type-order-item")?.classList.remove("is-dragging");
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    const dragging = list.querySelector(".is-dragging");
    if (!dragging) return;

    const afterElement = getPrintDragAfterElement(list, event.clientY);
    if (afterElement == null) {
      list.appendChild(dragging);
    } else {
      list.insertBefore(dragging, afterElement);
    }
  });
}

function openPrintOptionsDialog(availableTypes) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("dlg-print-options");
    const list = document.getElementById("printTypeOrderList");
    const cancelBtn = document.getElementById("print-options-cancel");
    const confirmBtn = document.getElementById("print-options-confirm");

    if (!dialog || !list || !cancelBtn || !confirmBtn || typeof dialog.showModal !== "function") {
      resolve(availableTypes);
      return;
    }

    const selectedTypes = getDefaultPrintSelectedTypes(availableTypes);
    list.innerHTML = "";
    availableTypes.forEach((type) => {
      list.appendChild(createPrintTypeOrderItem(type, selectedTypes.has(type)));
    });

    if (!list.__printDragBound) {
      setupPrintTypeOrderDrag(list);
      list.__printDragBound = true;
    }

    const getDialogSelection = () => Array.from(list.querySelectorAll(".print-type-order-item"))
      .filter((item) => item.querySelector('input[type="checkbox"]')?.checked)
      .map((item) => normalizeTypeDocumentValue(item.dataset.typeDocument))
      .filter(Boolean);

    const cleanup = () => {
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
    };

    const closeWith = (value) => {
      dialog.__printResult = value;
      dialog.close();
    };

    const onCancel = (event) => {
      event?.preventDefault?.();
      closeWith(null);
    };
    const onConfirm = () => {
      const selected = getDialogSelection();
      if (selected.length === 0) {
        alert("Selectionnez au moins un type de document a imprimer.");
        return;
      }
      closeWith(selected);
    };
    const onClose = () => {
      const value = Object.prototype.hasOwnProperty.call(dialog, "__printResult")
        ? dialog.__printResult
        : null;
      delete dialog.__printResult;
      cleanup();
      resolve(value);
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

function matchesCurrentPrintZone(record, selectedZoneDocument) {
  if (typeof matchesZoneSelection === "function") {
    return matchesZoneSelection(record, selectedZoneDocument);
  }
  return true;
}

function buildPrintContainer(selectedProject, orderedTypes, selectedZoneDocument) {
  const container = document.createElement("div");
  container.id = "plans-print-output";
  container.style.position = "absolute";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.width = "1200px";
  container.style.background = "#ffffff";

  const normalizedProject = normalizeProjectName(selectedProject);
  const projectRows = (window.records || []).filter((record) => {
    const recordProject = typeof getRecordProjectName === "function"
      ? getRecordProjectName(record)
      : getNomProjet(record);
    return normalizeProjectName(recordProject) === normalizedProject &&
      normalizeTypeDocumentValue(record?.Type_document) &&
      matchesCurrentPrintZone(record, selectedZoneDocument);
  });

  if (typeof renderVisibleTypeConsistencyWarnings === "function") {
    const selectedRows = projectRows.filter((record) => orderedTypes.includes(normalizeTypeDocumentValue(record.Type_document)));
    renderVisibleTypeConsistencyWarnings(container, selectedRows, normalizedProject);
  }

  for (const type of orderedTypes) {
    const rowsForType = projectRows.filter((record) => normalizeTypeDocumentValue(record.Type_document) === type);
    if (rowsForType.length === 0) continue;

    const typeSection = document.createElement("section");
    typeSection.className = "plan-type-section";

    const title = document.createElement("h2");
    title.className = "plan-type-title";
    title.textContent = type;
    typeSection.appendChild(title);

    if (typeof renderRowsForSelectedType === "function") {
      renderRowsForSelectedType(typeSection, rowsForType, normalizedProject);
    }

    container.appendChild(typeSection);
  }

  document.body.appendChild(container);
  return container;
}

async function savePlansPdfFromChildren(selectedProject, children) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "mm", "a4");

  const logo1Url = await fetch("../img/VC_Logotype_Digital_RVB.jpg").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
  const logo2Url = await fetch("../img/bloc d\u00e9l\u00e9gation bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
  const logo3Url = await fetch("../img/Logo DRTO fr - Bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));

  let startY = 40;
  doc.setFontSize(18);
  doc.text(`Projet : ${selectedProject}`, 16, 30);

  for (const child of children) {
    if (child.tagName === "H2" || child.tagName === "H3") {
      if (startY > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        startY = 40;
      }
      doc.setFontSize(child.tagName === "H2" ? 16 : 14);
      doc.text(child.textContent, 14, startY);
      startY += 8;
    } else if (child.tagName === "TABLE") {
      doc.autoTable({
        html: child,
        startY: startY,
        margin: { top: 40 },
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 73, 144] },
        didDrawPage: function() {
          // startY is reset automatically by autoTable on new pages
        }
      });
      startY = doc.lastAutoTable.finalY + 10;
    }
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.addImage(logo1Url, "JPEG", 10, 10, 40, 15);
    doc.addImage(logo2Url, "PNG", doc.internal.pageSize.getWidth() - 72, 10, 40, 15);
    doc.addImage(logo3Url, "PNG", doc.internal.pageSize.getWidth() - 30, 10, 15, 15);
    doc.setFontSize(10);
    doc.text(`Page ${i} / ${totalPages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 10);
  }

  doc.save(`${selectedProject} - Plans.pdf`);
}

async function generatePlansPdfFromOrderedTypes(selectedProject, orderedTypes) {
  const selectedZoneDocument = document.getElementById("zoneDropdown")?.value ||
    (window.LISTE_DE_PLAN_ALL_ZONES_VALUE || "__ALL_ZONES__");
  const printContainer = buildPrintContainer(selectedProject, orderedTypes, selectedZoneDocument);

  try {
    const children = Array.from(printContainer.querySelectorAll("h2, h3, table"));
    if (children.length === 0) {
      alert("Aucun plan a imprimer.");
      return;
    }

    await savePlansPdfFromChildren(selectedProject, children);
    return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");

    const logo1Url = await fetch("../img/VC_Logotype_Digital_RVB.jpg").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
    const logo2Url = await fetch("../img/bloc dÃ©lÃ©gation bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));
    const logo3Url = await fetch("../img/Logo DRTO fr - Bleu.png").then((res) => res.blob()).then(blob => URL.createObjectURL(blob));

    let startY = 40;
    doc.setFontSize(18);
    doc.text(`Projet : ${selectedProject}`, 16, 30);

    for (const child of children) {
      if (child.tagName === "H2" || child.tagName === "H3") {
        if (startY > doc.internal.pageSize.getHeight() - 20) {
          doc.addPage();
          startY = 40;
        }
        doc.setFontSize(child.tagName === "H2" ? 16 : 14);
        doc.text(child.textContent, 14, startY);
        startY += 8;
      } else if (child.tagName === "TABLE") {
        doc.autoTable({
          html: child,
          startY: startY,
          margin: { top: 40 },
          styles: { fontSize: 8 },
          headStyles: { fillColor: [0, 73, 144] },
          didDrawPage: function() {
            // startY is reset automatically by autoTable on new pages
          }
        });
        startY = doc.lastAutoTable.finalY + 10;
      }
    }

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.addImage(logo1Url, "JPEG", 10, 10, 40, 15);
      doc.addImage(logo2Url, "PNG", doc.internal.pageSize.getWidth() - 72, 10, 40, 15);
      doc.addImage(logo3Url, "PNG", doc.internal.pageSize.getWidth() - 30, 10, 15, 15);
      doc.setFontSize(10);
      doc.text(`Page ${i} / ${totalPages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 10);
    }

    doc.save(`${selectedProject} - Plans.pdf`);
  } finally {
    printContainer.remove();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btnPrint = document.getElementById("btn-print");
  if (!btnPrint) return;

  btnPrint.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const selectedProject = document.getElementById("projectDropdown").value;
    if (!selectedProject) {
      alert("Veuillez selectionner un projet avant d'imprimer.");
      return;
    }

    const availableTypes = getPrintAvailableTypeValues(selectedProject);
    if (availableTypes.length === 0) {
      alert("Aucun plan a imprimer.");
      return;
    }

    const orderedTypes = await openPrintOptionsDialog(availableTypes);
    if (!orderedTypes) return;

    syncMainTypeSelectionFromPrintOrder(orderedTypes, availableTypes);
    await generatePlansPdfFromOrderedTypes(selectedProject, orderedTypes);
  }, true);
});

// Synchronisation inter-widgets : réagit quand un autre widget change le projet sélectionné
(function () {
  if (window.__lpStorageSyncAdded_listeDePlan) return;
  window.__lpStorageSyncAdded_listeDePlan = true;
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

