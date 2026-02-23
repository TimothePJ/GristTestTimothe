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

export function initProjectSelector(projectOptions) {
  const projectSelect = document.getElementById("projectDropdown");
  if (!projectSelect) {
    throw new Error("Dropdown projet introuvable (#projectDropdown).");
  }

  projectSelect.disabled = false;

  fillSelect(
    projectSelect,
    projectOptions,
    "Choisir un projet",
    state.selectedProject
  );

  projectSelect.addEventListener("change", () => {
    setState({ selectedProject: projectSelect.value });
    console.log("Projet sélectionné :", state.selectedProject);
  });
}