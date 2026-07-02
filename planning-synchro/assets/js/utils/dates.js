// Pure date/decimal parsing utilities for planning-synchro.
// No top-level access to window/document/localStorage: safe to import under Node.
//
// parseCalendarDate/formatIsoDate are ported from
// `Planning Projet/assets/js/services/gristService.js`
// (functions parseCalendarDate, formatIsoDate, normalizeUtcDateToLocalCalendar, ~lines 170-233).
//
// parseDateTime is ported from `gestion-depenses2/assets/js/utils/timeSegments.js`
// (function parseRawDateTime, ~lines 34-75), renamed to parseDateTime. The FR
// datetime regex check is applied BEFORE the generic `new Date(text)` fallback
// (the original tried ISO/loose parsing first): Node/V8's non-standard string
// parser reads "06/04/2026 08:00" as MM/DD/YYYY (June 4th) rather than the
// intended FR DD/MM/YYYY (April 6th), so the unambiguous FR pattern must win
// whenever it matches.

function normalizeUtcDateToLocalCalendar(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function parseCalendarDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return normalizeUtcDateToLocalCalendar(value);
  }

  if (typeof value === "number") {
    const absValue = Math.abs(value);
    const n = absValue >= 86400 && absValue < 1e11 ? value * 1000 : value;
    return normalizeUtcDateToLocalCalendar(new Date(n));
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
    return null;
  }

  const frMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+.*)?$/);
  if (frMatch) {
    const d = Number(frMatch[1]);
    const m = Number(frMatch[2]);
    const y = Number(frMatch[3]);
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
    return null;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function parseDateTime(value) {
  if (value == null || value === "") return null;

  if (isValidDate(value)) {
    return new Date(value.getTime());
  }
  if (value instanceof Date) {
    return null;
  }

  if (typeof value === "number") {
    const timestamp = value > 1e11 ? value : value * 1000;
    const date = new Date(timestamp);
    return isValidDate(date) ? date : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  const match = text.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i
  );
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    let hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const meridiem = String(match[6] || "").toLowerCase();

    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    } else if (meridiem === "am" && hour === 12) {
      hour = 0;
    }

    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    return isValidDate(date) ? date : null;
  }

  const isoDate = new Date(text);
  return isValidDate(isoDate) ? isoDate : null;
}

export function toText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    for (const k of ["details", "label", "name", "display", "Name", "value"]) {
      if (typeof value[k] === "string") return value[k].trim();
    }
  }
  return String(value).trim();
}

export function normalizeDecimal(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
