import { APP_CONFIG } from "./config.js";

export const state = {
  selectedProject: "",
  selectedZone: "",
};

function readStoredProjectName() {
  try {
    const sharedValue = localStorage.getItem(APP_CONFIG.sharedProjectStorageKey);
    if (typeof sharedValue === "string" && sharedValue.trim()) {
      return sharedValue.trim();
    }
  } catch (error) {
    console.warn("Erreur lecture projet commun localStorage :", error);
  }

  return "";
}

export function loadState() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.storageKey);
    const sharedProject = readStoredProjectName();
    if (!raw) {
      state.selectedProject = sharedProject;
      return;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      state.selectedProject = sharedProject;
      return;
    }

    state.selectedProject =
      sharedProject ||
      (typeof parsed.selectedProject === "string" ? parsed.selectedProject : "");
    state.selectedZone =
      typeof parsed.selectedZone === "string" ? parsed.selectedZone : "";
  } catch (error) {
    console.warn("Erreur chargement localStorage :", error);
  }
}

const SHARED_PROJECT_ID_KEY = "grist.selected-project-id";

export function setState(patch) {
  Object.assign(state, patch);

  try {
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(state));
    if (typeof state.selectedProject === "string") {
      if (state.selectedProject.trim()) {
        localStorage.setItem(APP_CONFIG.sharedProjectStorageKey, state.selectedProject.trim());
        // Écrire aussi l'ID canonique si on peut le retrouver via l'option sélectionnée
        const projectSelect = document.getElementById("projectDropdown");
        if (projectSelect instanceof HTMLSelectElement) {
          const currentOption = projectSelect.selectedOptions?.[0];
          const selectedOpt =
            currentOption?.value === state.selectedProject
              ? currentOption
              : Array.from(projectSelect.options).find(
                  (option) => option.value === state.selectedProject
                );
          if (selectedOpt?.dataset?.projectId) {
            localStorage.setItem(SHARED_PROJECT_ID_KEY, selectedOpt.dataset.projectId);
          } else if (selectedOpt) {
            localStorage.removeItem(SHARED_PROJECT_ID_KEY);
          }
        }
      } else {
        localStorage.removeItem(APP_CONFIG.sharedProjectStorageKey);
        localStorage.removeItem(SHARED_PROJECT_ID_KEY);
      }
    }
  } catch (error) {
    console.warn("Erreur sauvegarde localStorage :", error);
  }
}
