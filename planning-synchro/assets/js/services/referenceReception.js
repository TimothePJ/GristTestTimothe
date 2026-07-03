// Reception band ("Données d'entrées") data for the top pane.
//
// Adapted from Planning Projet's gristService.js
// (fetchPlanningReferenceReceptionSummaries + its reference-linking helpers).
// Self-contained: it reimplements the SAME matching (project + ID2 + Type_doc +
// Taches + Zone, normalised) and the SAME summary computation directly, so
// planning-synchro never imports the sibling widget's 112 KB module graph or its
// generic zone-sync engine.
//
// buildReceptionSummaries() is PURE (rows in, Map out) and unit-tested;
// fetchPlanningReferenceReceptionSummaries() adds the References2 Grist read.
// The returned Map<planningRowId, summary> is consumed as-is by the vendored
// builder (top/vendor/planningProjetBuilder.js -> getReferenceReceptionSummary),
// which draws the band with a complete / missing / mixed status.

import { toText, parseCalendarDate, formatIsoDate } from "../utils/dates.js";
import { fetchTableRows } from "./gristService.js";

export const REFERENCES_TABLE_NAME = "References2";

// References2 column-label candidates (a real doc may use any of these).
const REF_COLS = {
  project: ["NomProjetString", "NomProjet", "Nom_projet"],
  number: ["NumeroDocument"],
  type: ["Type_document", "TypeDocument"],
  zone: ["Zone"],
  designation: ["NomDocument", "Designation"],
};

// --- normalisers (verbatim semantics from gristService.js) ---
function normalizeLookupText(value) {
  return toText(value).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}
const normalizeDocumentNumberForMatch = normalizeLookupText;
function normalizeZoneValueForStorage(value) {
  const text = toText(value);
  if (!text) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
}
function getFirstNonEmptyRowValue(row, columnNames = []) {
  for (const name of columnNames) {
    const v = toText(row?.[name]);
    if (v) return v;
  }
  return "";
}
function isArmaturesTypeDoc(value) {
  return String(value ?? "").toUpperCase().includes("ARMATURES");
}

// --- dates (verbatim semantics) ---
function isEmptyReferenceDate(date) {
  return (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime()) ||
    (date.getFullYear() === 1900 && date.getMonth() === 0 && date.getDate() === 1)
  );
}
function formatReferenceDateIso(value) {
  const date = parseCalendarDate(value);
  return isEmptyReferenceDate(date) ? "" : formatIsoDate(date);
}
function parseReferenceDurationLimit(value) {
  const text = toText(value);
  if (!text) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
}
function subtractWeeksFromDate(date, weeks) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const w = Number(weeks);
  if (!Number.isInteger(w) || w < 0) return null;
  const d = new Date(date);
  d.setDate(d.getDate() - w * 7);
  return d;
}
function shiftIsoDate(dateValue, dayDelta = 0) {
  const date = parseCalendarDate(dateValue);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(dayDelta || 0));
  return formatIsoDate(date);
}
function getPlanningSegmentStartDate(row, columns = {}) {
  const typeDoc = row?.[columns.typeDoc || "Type_doc"];
  if (isArmaturesTypeDoc(typeDoc)) {
    return parseCalendarDate(row?.[columns.diffCoffrage || "Diff_coffrage"]);
  }
  return (
    parseCalendarDate(row?.[columns.dateLimite || "Date_limite"]) ||
    parseCalendarDate(row?.[columns.diffCoffrage || "Diff_coffrage"]) ||
    parseCalendarDate(row?.[columns.demarragesTravaux || "Demarrages_travaux"])
  );
}

// A planning row's reference join key (Planning Projet's buildPlanningReferenceChange).
function buildPlanningReferenceChange(row, columns = {}) {
  return {
    projectName: row?.[columns.projectLink || columns.projectName || columns.nomProjet || "NomProjet"],
    numeroDocument: row?.[columns.id2 || "ID2"],
    typeDocument: row?.[columns.typeDoc || "Type_doc"],
    designation: row?.[columns.taskName || columns.taches || columns.tacheAlt || "Taches"],
    sourceZone: row?.[columns.zone || "Zone"],
  };
}

// Strict lookup keyed [project||number||type||designation||zone].
function buildReferenceLookup(referenceRows) {
  const strict = new Map();
  (referenceRows || []).forEach((row) => {
    const rowId = Number(row?.id);
    if (!Number.isInteger(rowId) || rowId <= 0) return;
    const project = normalizeLookupText(getFirstNonEmptyRowValue(row, REF_COLS.project));
    const number = normalizeDocumentNumberForMatch(getFirstNonEmptyRowValue(row, REF_COLS.number));
    const type = normalizeLookupText(getFirstNonEmptyRowValue(row, REF_COLS.type));
    const designation = normalizeLookupText(getFirstNonEmptyRowValue(row, REF_COLS.designation));
    const zone = normalizeZoneValueForStorage(getFirstNonEmptyRowValue(row, REF_COLS.zone));
    if (project && number && type && designation) {
      const key = [project, number, type, designation, zone].join("||");
      if (!strict.has(key)) strict.set(key, []);
      strict.get(key).push(row);
    }
  });
  return strict;
}

function findLinkedReferenceRows(planningRow, strict, columns) {
  const change = buildPlanningReferenceChange(planningRow, columns);
  const project = normalizeLookupText(change.projectName);
  const number = normalizeDocumentNumberForMatch(change.numeroDocument);
  const type = normalizeLookupText(change.typeDocument);
  const designation = normalizeLookupText(change.designation);
  if (!project || !number || !type || !designation) return [];
  const sourceZone = normalizeZoneValueForStorage(change.sourceZone);
  const zones = sourceZone ? [sourceZone, ""] : [""]; // exact zone, then blank fallback
  for (const zone of zones) {
    const rows = strict.get([project, number, type, designation, zone].join("||"));
    if (rows && rows.length) {
      const byId = new Map();
      rows.forEach((r) => byId.set(Number(r.id), r));
      return [...byId.values()];
    }
  }
  return [];
}

// PURE: planning rows + References2 rows -> Map<planningRowId, summary>.
export function buildReceptionSummaries(planningRows = [], referenceRows = [], columns = {}) {
  const summariesByRowId = new Map();
  const rows = Array.isArray(planningRows) ? planningRows : [];
  if (!rows.length || !Array.isArray(referenceRows) || !referenceRows.length) {
    return summariesByRowId;
  }

  const idCol = columns.id || "id";
  const strict = buildReferenceLookup(referenceRows);

  rows.forEach((planningRow) => {
    const rowId = Number(planningRow?.[idCol]);
    if (!Number.isInteger(rowId) || rowId <= 0) return;

    const startDate = getPlanningSegmentStartDate(planningRow, columns);
    const hasStartDate = startDate instanceof Date && !Number.isNaN(startDate.getTime());
    const linkedRows = findLinkedReferenceRows(planningRow, strict, columns);

    const references = linkedRows
      .filter((r) => Boolean(r?.Bloquant))
      .map((r) => {
        const durationText = toText(r?.DureeLimite);
        const hasDuration = Boolean(durationText);
        const durationWeeks = parseReferenceDurationLimit(r?.DureeLimite);
        const storedDateLimiteIso = formatReferenceDateIso(r?.DateLimite);
        const computedDateLimiteIso =
          storedDateLimiteIso ||
          (hasStartDate ? formatIsoDate(subtractWeeksFromDate(startDate, durationWeeks ?? 0)) : "");
        const timelineDateLimiteIso =
          !hasDuration && computedDateLimiteIso ? shiftIsoDate(computedDateLimiteIso, -1) : computedDateLimiteIso;
        const recuIso = formatReferenceDateIso(r?.Recu);
        return {
          id: Number(r?.id) || null,
          emetteur: toText(r?.Emetteur),
          reference: toText(r?.Reference),
          dateLimiteIso: computedDateLimiteIso,
          timelineDateLimiteIso,
          durationWeeks,
          durationIsBlank: !hasDuration,
          recuIso,
          received: Boolean(recuIso),
        };
      })
      .filter((ref) => ref.dateLimiteIso)
      .sort((left, right) => {
        const dateCmp = String(left.dateLimiteIso).localeCompare(String(right.dateLimiteIso));
        if (dateCmp !== 0) return dateCmp;
        if (left.durationIsBlank !== right.durationIsBlank) return left.durationIsBlank ? -1 : 1;
        return [left.emetteur, left.reference]
          .join(" ")
          .localeCompare([right.emetteur, right.reference].join(" "), "fr", { sensitivity: "base", numeric: true });
      });

    if (!references.length) return;
    const receivedCount = references.filter((ref) => ref.received).length;
    const missingCount = references.length - receivedCount;
    const status = missingCount === 0 ? "complete" : receivedCount === 0 ? "missing" : "mixed";
    summariesByRowId.set(rowId, {
      rowId,
      firstDateLimiteIso: references[0].dateLimiteIso,
      firstTimelineDateLimiteIso: references[0].timelineDateLimiteIso || references[0].dateLimiteIso,
      status,
      receivedCount,
      missingCount,
      totalCount: references.length,
      references,
    });
  });

  return summariesByRowId;
}

// Fetches References2 then delegates to the pure summariser. Returns an empty
// Map on any read error so the top pane still renders (band simply absent).
export async function fetchPlanningReferenceReceptionSummaries(planningRows = [], columns = {}) {
  const rows = Array.isArray(planningRows) ? planningRows : [];
  if (!rows.length) return new Map();
  const referenceRows = await fetchTableRows(REFERENCES_TABLE_NAME).catch(() => []);
  return buildReceptionSummaries(rows, referenceRows, columns);
}
