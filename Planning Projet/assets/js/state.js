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

export function setState(patch) {
  Object.assign(state, patch);

  try {
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(state));
    if (
      Object.prototype.hasOwnProperty.call(patch || {}, "selectedProject") &&
      typeof state.selectedProject === "string" &&
      state.selectedProject.trim()
    ) {
      const projectSelect = document.getElementById("projectDropdown");
      const currentOption = projectSelect instanceof HTMLSelectElement
        ? projectSelect.selectedOptions?.[0]
        : null;
      void window.GristServiceContext.selectProject({
        projectId: currentOption?.dataset?.projectId,
        projectName: state.selectedProject.trim(),
      }).catch(() => {});
    }
  } catch (error) {
    console.warn("Erreur sauvegarde localStorage :", error);
  }
}
