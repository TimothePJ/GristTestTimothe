// MonWidget/js/utils.js

// --- sécurité HTML (évite injection + corrige ton erreur) ---
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[m]));
}

// --- documents (comme Reference2) ---
function makeDocLabel(nomDocument, numeroDocument) {
  const nm = String(nomDocument || "").trim();
  let show = null;

  if (numeroDocument != null) {
    const s = String(numeroDocument).trim();
    show = (s === "" || s === "-" || s === "_") ? null : s;
  }
  return (show !== null) ? `${show} ${nm}` : nm;
}

function normalizeNumero(num) {
  if (num === "" || num === "-" || num === "_") return null;
  const n = (num == null ? null : Number(num));
  return (!Number.isFinite(n) || n === 0) ? null : n;
}

function uniqProjects(records) {
  const set = new Set();
  (records || []).forEach((r) => {
    if (r && r.NomProjet) set.add(String(r.NomProjet).trim());
  });
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// --- logique métier EN ATTENTE / Bloquant ---
function getText(rec, key) {
  const v = rec?.[key];
  return (v == null) ? "" : String(v);
}

function isEnAttente(rec) {
  // Supporte DescriptionObservations + le typo éventuel
  const v = (getText(rec, "DescriptionObservations") || getText(rec, "DescriptionObservationss")).trim();
  return v.toUpperCase() === "EN ATTENTE";
}

function getBloquant(rec) {
  // Supporte Bloquant_V2 si tu l’utilises, sinon Bloquant
  const v = (rec?.Bloquant_V2 !== undefined) ? rec.Bloquant_V2 : rec?.Bloquant;
  return v === true || v === 1 || v === "true";
}

// --- pour sélectionner une ligne ---
function getRowId(rec) {
  return rec?.id ?? rec?.ID ?? rec?.Id ?? null;
}

// --- dates (Recu/RecuString) ---
function parseMaybeDate(v) {
  if (!v) return null;

  if (v instanceof Date && !isNaN(v.getTime())) return v;

  // format Grist ["D", seconds]
  if (Array.isArray(v) && (v[0] === "D" || v[0] === "d") && typeof v[1] === "number") {
    const d = new Date(v[1] * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s === "-" || s.startsWith("1900-01-01")) return null;

    // dd/mm/yyyy
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) {
      const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
      const d = new Date(Date.UTC(yyyy, mm - 1, dd));
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatDateFR(d) {
  if (!d) return "-";
  return d.toLocaleDateString("fr-FR");
}

function getRecuText(rec) {
  const rs = (rec?.RecuString != null) ? String(rec.RecuString).trim() : "";
  if (rs && rs !== "-") return rs;

  const d = parseMaybeDate(rec?.Recu);
  return formatDateFR(d);
}

function getRecuMs(rec) {
  const d = parseMaybeDate(rec?.RecuString) || parseMaybeDate(rec?.Recu);
  return d ? d.getTime() : 0;
}

// (optionnel) expose explicitement au global, au cas où
window.escapeHtml = escapeHtml;
window.makeDocLabel = makeDocLabel;
window.normalizeNumero = normalizeNumero;
window.uniqProjects = uniqProjects;
window.isEnAttente = isEnAttente;
window.getBloquant = getBloquant;
window.getRowId = getRowId;
window.getRecuText = getRecuText;
window.getRecuMs = getRecuMs;
