import { state, setState } from "../state.js";

const ADD_ZONE_OPTION_VALUE = "__add_zone__";
const MANAGE_ZONE_OPTION_VALUE = "__manage_zone__";
const SHARED_PROJECT_NAME_KEY = "grist.selected-project";
const SHARED_PROJECT_ID_KEY = "grist.selected-project-id";
const PROJECT_STORAGE_SYNC_DELAY_MS = 30;
let projectRegistry = [];
let projectChangeHandler = null;
let missingProjectHandler = null;
let projectStorageSyncTimer = 0;
let projectSelectorBound = false;
let activeProjectId = null;

function fillSelect(
  selectEl,
  options,
  placeholder,
  selectedValue = "",
  { addZoneOption = false, manageZoneOption = false } = {}
) {
  selectEl.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  selectEl.appendChild(first);

  for (const value of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  }

  if (addZoneOption) {
    const sep = document.createElement("option");
    sep.value = "";
    sep.textContent = "--------------------";
    sep.disabled = true;
    selectEl.appendChild(sep);

    const addZoneOptionEl = document.createElement("option");
    addZoneOptionEl.value = ADD_ZONE_OPTION_VALUE;
    addZoneOptionEl.textContent = "Ajouter Zone";
    selectEl.appendChild(addZoneOptionEl);

    if (manageZoneOption) {
      const manageZoneOptionEl = document.createElement("option");
      manageZoneOptionEl.value = MANAGE_ZONE_OPTION_VALUE;
      manageZoneOptionEl.textContent = "Modifier Zone";
      selectEl.appendChild(manageZoneOptionEl);
    }
  }

  selectEl.value = selectedValue;
  if (selectEl.value !== selectedValue) {
    selectEl.value = "";
  }
}

function readSharedProjectId() {
  try {
    const raw = localStorage.getItem(SHARED_PROJECT_ID_KEY);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_e) { return null; }
}

function readSharedProjectName() {
  try {
    return String(localStorage.getItem(SHARED_PROJECT_NAME_KEY) || "").trim();
  } catch (_error) {
    return "";
  }
}

function normalizeProjectKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function normalizeProjectNumber(value = "") {
  const normalized = String(value || "").trim();
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalizeProjectKey(normalized);
}

function normalizeProjectObjects(projectOptions = []) {
  const projectsById = new Map();
  (projectOptions || []).forEach((project) => {
    const normalized =
      project && typeof project === "object"
        ? {
            id: Number(project.id),
            number: String(project.number || "").trim(),
            name: String(project.name || "").trim(),
          }
        : {
            id: null,
            number: "",
            name: String(project || "").trim(),
          };
    if (!normalized.name) return;
    const key = Number.isInteger(normalized.id) && normalized.id > 0
      ? `id:${normalized.id}`
      : `name:${normalizeProjectKey(normalized.name)}`;
    if (!projectsById.has(key)) {
      projectsById.set(key, normalized);
    }
  });
  return [...projectsById.values()];
}

export function resolveProjectSelection(projectSelection = "", projectId = null) {
  const numericId = Number(projectId);
  if (Number.isInteger(numericId) && numericId > 0) {
    const byId = projectRegistry.find((project) => project.id === numericId);
    if (byId) return byId;
  }

  const requestedKey = normalizeProjectKey(projectSelection);
  if (!requestedKey) return null;

  return projectRegistry.find((project) =>
    normalizeProjectKey(project.name) === requestedKey
  ) || projectRegistry.find((project) =>
    normalizeProjectNumber(project.number) === normalizeProjectNumber(projectSelection)
  ) || projectRegistry.find((project) =>
    normalizeProjectKey(`${project.number} - ${project.name}`) === requestedKey
  ) || null;
}

function renderProjectOptions(projectSelect) {
  projectSelect.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Choisir un projet";
  projectSelect.appendChild(first);

  projectRegistry.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = project.number
      ? `${project.number} - ${project.name}`
      : project.name;
    if (Number.isInteger(project.id) && project.id > 0) {
      option.dataset.projectId = String(project.id);
    }
    projectSelect.appendChild(option);
  });
  projectSelect.disabled = projectRegistry.length === 0;
}

function applyCanonicalProject(project, {
  notify = true,
  persist = true,
} = {}) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  const canonicalName = project?.name || "";
  const canonicalId =
    Number.isInteger(project?.id) && project.id > 0 ? project.id : null;
  const changed =
    state.selectedProject !== canonicalName ||
    activeProjectId !== canonicalId;
  const matchingOptionIndex = Array.from(projectSelect.options).findIndex((option) =>
    canonicalId != null
      ? Number(option.dataset?.projectId) === canonicalId
      : option.value === canonicalName
  );
  projectSelect.selectedIndex = matchingOptionIndex >= 0 ? matchingOptionIndex : 0;
  activeProjectId = canonicalId;

  if (persist) {
    setState({
      selectedProject: canonicalName,
      selectedZone: changed ? "" : state.selectedZone,
    });
  } else {
    state.selectedProject = canonicalName;
    if (changed) state.selectedZone = "";
  }

  if (notify && changed) {
    projectChangeHandler?.({ ...state });
  }
  return { project: project || null, changed, missing: false };
}

export function applyProjectSelection(projectSelection = "", {
  projectId = null,
  notify = true,
  persist = true,
  clearInvalid = false,
} = {}) {
  const project = resolveProjectSelection(projectSelection, projectId);
  if (project) {
    return applyCanonicalProject(project, { notify, persist });
  }

  const requested = String(projectSelection || "").trim() || projectId != null;
  if (!requested || clearInvalid) {
    return applyCanonicalProject(null, { notify, persist });
  }
  return { project: null, changed: false, missing: true };
}

export function reconcileSharedProjectSelection({
  notify = true,
  clearInvalid = false,
  fallbackToState = true,
} = {}) {
  const sharedName = readSharedProjectName();
  const sharedId = readSharedProjectId();
  const fallbackName = sharedName || (fallbackToState ? state.selectedProject : "");
  return applyProjectSelection(fallbackName, {
    projectId: sharedId,
    notify,
    persist: true,
    clearInvalid,
  });
}

function scheduleSharedProjectReconciliation() {
  if (projectStorageSyncTimer) {
    window.clearTimeout(projectStorageSyncTimer);
  }
  projectStorageSyncTimer = window.setTimeout(() => {
    projectStorageSyncTimer = 0;
    const result = reconcileSharedProjectSelection({
      notify: true,
      clearInvalid: false,
      fallbackToState: false,
    });
    if (result.missing) {
      void missingProjectHandler?.();
    }
  }, PROJECT_STORAGE_SYNC_DELAY_MS);
}

function bindProjectSelector(projectSelect) {
  if (projectSelectorBound) return;
  projectSelectorBound = true;

  projectSelect.addEventListener("change", () => {
    const selectedOption = projectSelect.selectedOptions?.[0];
    applyProjectSelection(projectSelect.value, {
      projectId: selectedOption?.dataset?.projectId || null,
      notify: true,
      persist: true,
      clearInvalid: true,
    });
  });

  window.addEventListener("storage", (event) => {
    if (
      event.key !== SHARED_PROJECT_ID_KEY &&
      event.key !== SHARED_PROJECT_NAME_KEY
    ) {
      return;
    }
    scheduleSharedProjectReconciliation();
  });
}

export function updateProjectSelectorOptions(projectOptions, {
  notify = false,
  clearInvalid = true,
  fallbackToState = false,
} = {}) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  projectRegistry = normalizeProjectObjects(projectOptions);
  renderProjectOptions(projectSelect);
  return reconcileSharedProjectSelection({
    notify,
    clearInvalid,
    fallbackToState,
  });
}

export function initProjectSelector(projectOptions, {
  onChange,
  onMissingProject,
  emitInitialChange = true,
} = {}) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  projectChangeHandler = typeof onChange === "function" ? onChange : null;
  missingProjectHandler =
    typeof onMissingProject === "function" ? onMissingProject : null;
  bindProjectSelector(projectSelect);
  const result = updateProjectSelectorOptions(projectOptions, {
    notify: false,
    clearInvalid: true,
    fallbackToState: true,
  });
  if (emitInitialChange) {
    projectChangeHandler?.({ ...state });
  }
  return result;
}

export function initZoneSelector({ onChange, onAddZone, onManageZone } = {}) {
  const zoneSelect = document.getElementById("zoneDropdown");
  if (!zoneSelect) {
    throw new Error("Dropdown zone introuvable (#zoneDropdown).");
  }

  zoneSelect.disabled = true;
  fillSelect(zoneSelect, [], "Toutes les zones", "", { addZoneOption: true });

  zoneSelect.addEventListener("change", () => {
    if (zoneSelect.value === ADD_ZONE_OPTION_VALUE) {
      zoneSelect.value = state.selectedZone || "";
      onAddZone?.({ ...state });
      return;
    }

    if (zoneSelect.value === MANAGE_ZONE_OPTION_VALUE) {
      zoneSelect.value = state.selectedZone || "";
      onManageZone?.({ ...state });
      return;
    }

    setState({ selectedZone: zoneSelect.value });
    onChange?.({ ...state });
  });
}

export function updateZoneSelector(
  zoneOptions,
  { selectedValue = "", enabled = false } = {}
) {
  const zoneSelect = document.getElementById("zoneDropdown");
  if (!zoneSelect) return;

  const options = Array.isArray(zoneOptions) ? zoneOptions : [];
  fillSelect(zoneSelect, options, "Toutes les zones", selectedValue, {
    addZoneOption: true,
    manageZoneOption: enabled && options.length > 0,
  });
  zoneSelect.disabled = !enabled;
}
