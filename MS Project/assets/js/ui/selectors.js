import { state, setState } from "../state.js";

function fillSelect(selectEl, options, placeholder, selectedValue = "") {
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

  selectEl.value = selectedValue;
  if (selectEl.value !== selectedValue) {
    selectEl.value = "";
  }
}

function getProjectSelect() {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }
  return projectSelect;
}

export function updateProjectSelector(projectOptions, selectedValue = "") {
  const projectSelect = getProjectSelect();
  projectSelect.disabled = false;

  fillSelect(projectSelect, projectOptions, "Choisir un projet", selectedValue);
  return projectSelect.value;
}

export function initProjectSelector(projectOptions, { onChange } = {}) {
  const projectSelect = getProjectSelect();
  state.selectedProject = "";

  updateProjectSelector(projectOptions, "");

  projectSelect.addEventListener("change", () => {
    setState({ selectedProject: projectSelect.value });
    onChange?.({ ...state });
  });

  onChange?.({ ...state });
}
