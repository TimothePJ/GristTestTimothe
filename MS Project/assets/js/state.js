import { APP_CONFIG } from "./config.js";

export const state = {
  selectedProject: "",
};

export function setState(patch) {
  Object.assign(state, patch);

  try {
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn("Erreur sauvegarde localStorage :", error);
  }
}
