import { addDays, normalizeIsoDate as normalizeIsoDateValue, toIsoDate } from "../utils/date.js";
import { state } from "../app/state.js";
import { DAY_IN_MS } from "../app/constants.js";

export function normalizeProjectKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getDesiredProjectKey() {
  return String(state.requestedProjectKey || state.activeProjectKey || "").trim();
}

export function normalizeViewportSignatureTimestamp(timestampMs) {
  const numericTimestamp = parseSharedExactNumber(timestampMs);
  if (!Number.isFinite(numericTimestamp)) {
    return "";
  }

  return String(Math.round(numericTimestamp / 10) * 10);
}

export function getViewportLogicalSignature(projectKey, viewport = {}) {
  const normalizedProjectKey = normalizeProjectKey(projectKey || state.activeProjectKey || "");
  const rangeStartDate = String(viewport?.firstVisibleDate || viewport?.rangeStartDate || "").trim();
  const mode = String(viewport?.mode || "").trim();
  const visibleDays = Number(viewport?.visibleDays);
  const windowStartMs = normalizeViewportSignatureTimestamp(viewport?.windowStartMs);
  const windowEndMs = normalizeViewportSignatureTimestamp(viewport?.windowEndMs);
  const leftDayOffset = parseSharedExactNumber(viewport?.leftDayOffset);

  return [
    normalizedProjectKey,
    rangeStartDate,
    mode,
    Number.isFinite(visibleDays) ? Math.round(visibleDays) : "",
    windowStartMs,
    windowEndMs,
    Number.isFinite(leftDayOffset) ? leftDayOffset.toFixed(4) : "",
  ].join("|");
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
  return normalizeIsoDateValue(value);
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
