// Time-Out/assets/js/state.js
import { APP_CONFIG } from "./config.js";
export const state = { viewport: null, currentUser: { email: "", isAdmin: false }, teamMembers: [], segments: [] };
export function loadPersistedViewport() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(APP_CONFIG.storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.viewport ? parsed.viewport : null;
  } catch (_e) { return null; }
}
export function persistViewport(viewport) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify({ viewport: viewport || null })); } catch (_e) {}
}
