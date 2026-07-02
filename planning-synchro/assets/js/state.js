// Small in-memory app state + localStorage persistence for planning-synchro.
//
// `state` holds the registry of projects (fetched from Projets2), the
// currently selected project object ({id,name,number}) and the last
// canonical shared viewport applied by sync/controller.js.
//
// loadPersistedViewport()/persistViewport() are guarded for Node
// (`typeof localStorage === "undefined"`) so this module imports AND runs
// cleanly outside a browser (harmless if some future test imports it), same
// pattern as services/projectRegistry.js's readSharedSelection/
// writeSharedSelection.

import { APP_CONFIG } from "./config.js";

export const state = {
  registry: [],
  selectedProject: null,
  viewport: null,
};

// Returns the FULL persisted record `{ viewport, projectId, projectName }`
// (or `null`), NOT just the bare viewport: callers must be able to check the
// stored `projectId` so a persisted window is only ever reused for the SAME
// project it was saved from. A window that geometrically fits within a
// DIFFERENT project's bounds must not silently override that project's fresh
// ~1-year initial window (see main.js loadProject).
export function loadPersistedViewport() {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(APP_CONFIG.storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.viewport || typeof parsed.viewport !== "object") {
      return null;
    }

    return {
      viewport: parsed.viewport,
      projectId: Number.isInteger(parsed.projectId) ? parsed.projectId : null,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName : "",
    };
  } catch (error) {
    console.warn("Erreur lecture localStorage planning-synchro :", error);
    return null;
  }
}

// Persists the current viewport and, best-effort, the last selected project
// (id/name) so a future reload could reconstruct a similar state. `project`
// is optional (`{id, name}` shape, e.g. state.selectedProject).
export function persistViewport(viewport, project = null) {
  if (typeof localStorage === "undefined") return;

  try {
    const payload = {
      viewport: viewport || null,
      projectId: project && Number.isInteger(project.id) ? project.id : null,
      projectName: project && typeof project.name === "string" ? project.name : "",
    };
    localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("Erreur sauvegarde localStorage planning-synchro :", error);
  }
}
