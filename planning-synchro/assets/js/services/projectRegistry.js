import { APP_CONFIG } from "../config.js";

// Combining diacritical marks occupy code points U+0300-U+036F. Filtering by
// code point (rather than embedding a raw combining-mark regex literal in
// the source) keeps this file free of characters that could be silently
// re-normalized by editors/tools.
const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

function stripCombiningMarks(value) {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code < COMBINING_MARK_START || code > COMBINING_MARK_END;
    })
    .join("");
}

function normalizeProjectKey(value = "") {
  return stripCombiningMarks(String(value || "").normalize("NFD"))
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function normalizeProjectNumber(value = "") {
  const normalized = String(value || "").trim();
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : normalizeProjectKey(normalized);
}

function normalizeProjectObjects(projectOptions = []) {
  const projectsById = new Map();
  (projectOptions || []).forEach((project) => {
    const normalized =
      project && typeof project === "object"
        ? {
            id: Number(project.id),
            number: String(project.number || "").trim(),
            name: String(project.name || "").trim(),
          }
        : {
            id: null,
            number: "",
            name: String(project || "").trim(),
          };
    if (!normalized.name) return;
    const key = Number.isInteger(normalized.id) && normalized.id > 0
      ? `id:${normalized.id}`
      : `name:${normalizeProjectKey(normalized.name)}`;
    if (!projectsById.has(key)) {
      projectsById.set(key, normalized);
    }
  });
  return [...projectsById.values()];
}

export function buildRegistry(projectRows = [], columns = {}) {
  const idKey = columns.id || "id";
  const nameKey = columns.name || "Nom_de_projet";
  const numberKey = columns.number || "Numero_de_projet";
  const mapped = (projectRows || []).map((row) => ({
    id: Number(row?.[idKey]),
    name: String(row?.[nameKey] || "").trim(),
    number: String(row?.[numberKey] || "").trim(),
  }));
  return normalizeProjectObjects(mapped);
}

export function resolveProject(registry = [], { name = "", id = null, number = "" } = {}) {
  const numericId = Number(id);
  if (Number.isInteger(numericId) && numericId > 0) {
    const byId = registry.find((project) => project.id === numericId);
    if (byId) return byId;
  }

  const requestedKey = normalizeProjectKey(name);
  if (requestedKey) {
    const byName = registry.find((project) => normalizeProjectKey(project.name) === requestedKey);
    if (byName) return byName;
  }

  const requestedNumber = normalizeProjectNumber(number);
  if (requestedNumber) {
    const byNumber = registry.find((project) => normalizeProjectNumber(project.number) === requestedNumber);
    if (byNumber) return byNumber;
  }

  if (requestedKey) {
    const byCombined = registry.find((project) =>
      normalizeProjectKey(`${project.number} - ${project.name}`) === requestedKey
    );
    if (byCombined) return byCombined;
  }

  return null;
}

export function readSharedSelection() {
  if (typeof localStorage === "undefined") return { name: "", id: null };
  const name = (localStorage.getItem(APP_CONFIG.sharedProjectStorageKey) || "").trim();
  const idRaw = Number(localStorage.getItem(APP_CONFIG.sharedProjectIdStorageKey));
  return { name, id: Number.isInteger(idRaw) && idRaw > 0 ? idRaw : null };
}

export function writeSharedSelection({ name, id }) {
  if (typeof localStorage === "undefined") return;
  if (name) localStorage.setItem(APP_CONFIG.sharedProjectStorageKey, name);
  else localStorage.removeItem(APP_CONFIG.sharedProjectStorageKey);
  if (Number.isInteger(id) && id > 0) localStorage.setItem(APP_CONFIG.sharedProjectIdStorageKey, String(id));
  else localStorage.removeItem(APP_CONFIG.sharedProjectIdStorageKey);
}
