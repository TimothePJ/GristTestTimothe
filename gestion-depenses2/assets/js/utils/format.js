export function toText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    if (typeof value.label === "string") return value.label.trim();
    if (typeof value.name === "string") return value.name.trim();
    if (typeof value.display === "string") return value.display.trim();
    if (typeof value.Name === "string") return value.Name.trim();
  }

  return String(value).trim();
}

export function toFiniteNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundToStep(value, step = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return 0;
  }
  return Math.round(value / step) * step;
}

export function formatNumber(value) {
  const number = toFiniteNumber(value, 0);
  return number
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    .replace(".", ",");
}

export function normalizeNumericInput(value) {
  if (value == null) return "";
  return String(value).trim().replace(",", ".");
}

export function parseOptionalNumberInput(value) {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function toMonthKey(year, monthNumber) {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

export function parseMonthKey(monthKey) {
  const match = String(monthKey ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) {
    return null;
  }

  return {
    year,
    monthNumber,
  };
}

export function getMonthStartDate(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthNumber - 1, 1);
}

export function getMonthEndDate(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthNumber, 0);
}

export function getBusinessDayDates(monthKey) {
  const startDate = getMonthStartDate(monthKey);
  const endDate = getMonthEndDate(monthKey);
  if (!startDate || !endDate) return [];

  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function getBusinessDayCount(monthKey) {
  return getBusinessDayDates(monthKey).length;
}

export function getMonthKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return toMonthKey(date.getFullYear(), date.getMonth() + 1);
}

export function getMonthKeyFromRawMonth(value) {
  if (value == null || value === "") return "";

  if (typeof value === "number") {
    const timestamp = value > 1e11 ? value : value * 1000;
    return getMonthKeyFromDate(new Date(timestamp));
  }

  if (value instanceof Date) {
    return getMonthKeyFromDate(value);
  }

  const text = String(value).trim();
  if (!text) return "";

  const directMonthMatch = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (directMonthMatch) {
    return `${directMonthMatch[1]}-${directMonthMatch[2]}`;
  }

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return getMonthKeyFromDate(date);
  }

  return "";
}

export function toGristMonthValue(monthKey) {
  const match = String(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Format mois invalide : ${monthKey}`);
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const date = new Date(year, monthNumber - 1, 1);
  return date.getTime() / 1000;
}

export function buildDisplayedMonths(selectedYear, selectedMonth, monthSpan, months) {
  const items = [];

  for (let offset = 0; offset < monthSpan; offset += 1) {
    const monthIndex = (selectedMonth + offset) % 12;
    const year = selectedYear + Math.floor((selectedMonth + offset) / 12);
    const monthKey = toMonthKey(year, monthIndex + 1);
    items.push({
      monthIndex,
      year,
      monthNumber: monthIndex + 1,
      monthKey,
      monthLabel: months[monthIndex] || "",
      businessDayCount: getBusinessDayCount(monthKey),
      businessDayDates: getBusinessDayDates(monthKey),
    });
  }

  return items;
}

export function shiftMonthCursor(selectedYear, selectedMonth, delta) {
  const cursor = new Date(selectedYear, selectedMonth, 1);
  cursor.setMonth(cursor.getMonth() + delta);
  return {
    selectedYear: cursor.getFullYear(),
    selectedMonth: cursor.getMonth(),
  };
}
