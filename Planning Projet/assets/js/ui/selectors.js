import { state, setState } from "../state.js";

const ADD_ZONE_OPTION_VALUE = "__add_zone__";
const MANAGE_ZONE_OPTION_VALUE = "__manage_zone__";

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

const SHARED_PROJECT_ID_KEY = 'grist.selected-project-id';

function readSharedProjectId() {
  try {
    const raw = localStorage.getItem(SHARED_PROJECT_ID_KEY);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_e) { return null; }
}

export function initProjectSelector(projectOptions, { onChange } = {}) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  projectSelect.disabled = false;
  projectSelect.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Choisir un projet";
  projectSelect.appendChild(first);

  // projectOptions peut être [{id, number, name}] ou string[]
  const projectObjects = (projectOptions || []).map((p) =>
    typeof p === "object" ? p : { id: null, number: "", name: String(p) }
  );

  projectObjects.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.name;
    option.textContent = `${p.number} - ${p.name}`;
    if (p.id) option.dataset.projectId = String(p.id);
    projectSelect.appendChild(option);
  });

  // Restaurer par ID d'abord, puis par nom
  const savedId = readSharedProjectId();
  let selectedProject = "";
  if (savedId) {
    const byId = projectObjects.find((p) => p.id === savedId);
    if (byId) selectedProject = byId.name;
  }
  if (!selectedProject) {
    selectedProject = projectObjects.some((p) => p.name === state.selectedProject)
      ? state.selectedProject
      : "";
  }
  if (!selectedProject && state.selectedProject) {
    setState({ selectedProject: "", selectedZone: "" });
  }
  projectSelect.value = selectedProject;

  projectSelect.addEventListener("change", () => {
    setState({
      selectedProject: projectSelect.value,
      selectedZone: "",
    });
    onChange?.({ ...state });
  });

  // Synchronisation inter-widgets : réagit quand un autre widget change le projet sélectionné
  if (!window.__lpStorageSyncAdded_planningProjet) {
    window.__lpStorageSyncAdded_planningProjet = true;
    const _nk = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
    window.addEventListener('storage', (event) => {
      // Priorité : synchronisation par ID canonique
      if (event.key === SHARED_PROJECT_ID_KEY && event.newValue) {
        const idStr = String(event.newValue).trim();
        const match = Array.from(projectSelect.options).find((o) => o.dataset.projectId === idStr);
        if (match && projectSelect.value !== match.value) {
          projectSelect.value = match.value;
          setState({ selectedProject: match.value, selectedZone: '' });
          onChange?.({ ...state });
        }
        return;
      }
      // Compatibilité : synchronisation par nom
      if (event.key !== 'grist.selected-project' || !event.newValue) return;
      const newProject = String(event.newValue).trim();
      const match = Array.from(projectSelect.options).find((o) => _nk(o.value) === _nk(newProject));
      if (match && projectSelect.value !== match.value) {
        projectSelect.value = match.value;
        setState({ selectedProject: match.value, selectedZone: '' });
        onChange?.({ ...state });
      }
    });
  }

  onChange?.({ ...state });
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
