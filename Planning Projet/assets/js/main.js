import { loadState } from "./state.js";
import { initGrist, buildProjectOptions } from "./services/gristService.js";
import { initProjectSelector } from "./ui/selectors.js";

async function bootstrap() {
  try {
    initGrist();

    const projectOptions = await buildProjectOptions();
    initProjectSelector(projectOptions);
  } catch (error) {
    console.error("Erreur d'initialisation :", error);

    const project = document.getElementById("projectDropdown");
    if (project) {
      project.disabled = true;
      project.innerHTML = `<option value="">Erreur chargement projet</option>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);