const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getTodayIsoDate() {
  return toIsoDate(new Date());
}

export function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeIsoDate(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    return "";
  }

  const date = parseIsoDate(trimmed);
  return date ? toIsoDate(date) : "";
}

export function parseIsoDate(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    return null;
  }

  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(rawValue, amount) {
  const date = parseIsoDate(rawValue);
  if (!date || !Number.isFinite(amount)) {
    return "";
  }

  date.setDate(date.getDate() + Number(amount));
  return toIsoDate(date);
}

export function addMonths(rawValue, amount) {
  const date = parseIsoDate(rawValue);
  if (!date || !Number.isFinite(amount)) {
    return "";
  }

  date.setMonth(date.getMonth() + Number(amount));
  return toIsoDate(date);
}

export function addYears(rawValue, amount) {
  const date = parseIsoDate(rawValue);
  if (!date || !Number.isFinite(amount)) {
    return "";
  }

  date.setFullYear(date.getFullYear() + Number(amount));
  return toIsoDate(date);
}

export function startOfWeek(rawValue) {
  const date = parseIsoDate(rawValue);
  if (!date) {
    return "";
  }

  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return toIsoDate(date);
}

export function startOfMonth(rawValue) {
  const date = parseIsoDate(rawValue);
  if (!date) {
    return "";
  }

  date.setDate(1);
  return toIsoDate(date);
}

export function startOfYear(rawValue) {
  const date = parseIsoDate(rawValue);
  if (!date) {
    return "";
  }

  date.setMonth(0, 1);
  return toIsoDate(date);
}

export function formatDateLabel(rawValue, locale = "fr-FR") {
  const date = parseIsoDate(rawValue);
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
