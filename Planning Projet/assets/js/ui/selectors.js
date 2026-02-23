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

export function initProjectSelector(projectOptions, { onChange } = {}) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  projectSelect.disabled = false;

  // Toujours démarrer sur "Choisir un projet"
  state.selectedProject = "";

  fillSelect(projectSelect, projectOptions, "Choisir un projet", "");

  projectSelect.addEventListener("change", () => {
    setState({ selectedProject: projectSelect.value });
    onChange?.({ ...state });
  });

  onChange?.({ ...state });
}