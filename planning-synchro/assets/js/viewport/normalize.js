// Canonical shared viewport model — pure helpers ported verbatim (by
// behavior) from Synchro's assets/js/viewport/normalize.js: clamp,
// normalizeIsoDate, getIsoDateFromExactTimestamp, shiftIsoDateValue,
// getInclusiveDaySpan, parseSharedExactNumber.
//
// Synchro's originals delegate date parsing to `../utils/date.js`
// (toIsoDate/normalizeIsoDate/addDays) and read `DAY_IN_MS` from
// `../app/constants.js`. planning-synchro's viewport modules may only
// import from ./normalize.js, ./bounds.js, and ../config.js (see task
// brief's purity constraint), so those helpers are inlined here rather
// than imported, preserving identical logic/output.
//
// No top-level access to window/document/localStorage/state: safe to
// import under Node.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 86400000;

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    return null;
  }

  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(rawValue, amount) {
  const date = parseIsoDate(rawValue);
  if (!date || !Number.isFinite(amount)) {
    return "";
  }

  date.setDate(date.getDate() + Number(amount));
  return toIsoDate(date);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function parseSharedExactNumber(value) {
  if (value == null || value === "") {
    return Number.NaN;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

export function getIsoDateFromExactTimestamp(timestampMs) {
  const numericTimestamp = parseSharedExactNumber(timestampMs);
  if (!Number.isFinite(numericTimestamp)) {
    return "";
  }

  const date = new Date(numericTimestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return toIsoDate(date);
}

export function normalizeIsoDate(value) {
  const trimmed = String(value || "").trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    return "";
  }

  const date = parseIsoDate(trimmed);
  return date ? toIsoDate(date) : "";
}

export function shiftIsoDateValue(dateValue, dayDelta = 0) {
  return addDays(dateValue, Number(dayDelta || 0));
}

export function getInclusiveDaySpan(startDateValue, endDateValue) {
  const normalizedStartDate = normalizeIsoDate(startDateValue);
  const normalizedEndDate = normalizeIsoDate(endDateValue);
  if (!normalizedStartDate || !normalizedEndDate) {
    return 0;
  }

  const startDate = new Date(`${normalizedStartDate}T12:00:00`);
  const endDate = new Date(`${normalizedEndDate}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }

  return Math.round((endDate.getTime() - startDate.getTime()) / DAY_IN_MS) + 1;
}
