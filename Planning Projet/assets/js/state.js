import { APP_CONFIG } from "./config.js";

export const state = {
  selectedProject: "",
};

export function loadState() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.storageKey);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    state.selectedProject =
      typeof parsed.selectedProject === "string" ? parsed.selectedProject : "";
  } catch (error) {
    console.warn("Erreur chargement localStorage :", error);
  }
}

export function setState(patch) {
  Object.assign(state, patch);

  try {
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn("Erreur sauvegarde localStorage :", error);
  }
}