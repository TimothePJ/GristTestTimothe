import { state, setState } from "../state.js";

const ADD_ZONE_OPTION_VALUE = "__add_zone__";

function fillSelect(
  selectEl,
  options,
  placeholder,
  selectedValue = "",
  { addZoneOption = false } = {}
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
  }

  selectEl.value = selectedValue;
  if (selectEl.value !== selectedValue) {
    selectEl.value = "";
  }
}

export function initProjectSelector(projectOptions, { onChange } = {}) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  projectSelect.disabled = false;

  // Toujours démarrer sur "Choisir un projet"
  state.selectedProject = "";
  state.selectedZone = "";

  fillSelect(projectSelect, projectOptions, "Choisir un projet", "");

  projectSelect.addEventListener("change", () => {
    setState({
      selectedProject: projectSelect.value,
      selectedZone: "",
    });
    onChange?.({ ...state });
  });

  onChange?.({ ...state });
}

export function initZoneSelector({ onChange, onAddZone } = {}) {
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
  });
  zoneSelect.disabled = !enabled;
}
