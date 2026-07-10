// Time-Out/assets/js/utils/dates.js
export function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function toText(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function toDateKey(date) {
  if (!isValidDate(date)) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const formatIsoDate = toDateKey;

export function createLocalDate(baseDate, hour, minute = 0) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0, 0);
}

export function parseCalendarDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isValidDate(value) ? new Date(value.getFullYear(), value.getMonth(), value.getDate()) : null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  const fr = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (fr) {
    const [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
