// Pure numeric/month formatting utilities for planning-synchro.
// No top-level access to window/document/localStorage: safe to import under Node.
//
// toFiniteNumber, formatNumber, clamp, buildDisplayedMonths (and its private
// helpers toMonthKey, parseMonthKey, getMonthStartDate, getMonthEndDate,
// getCalendarDayDates, getBusinessDayDates) are ported verbatim from
// `gestion-depenses2/assets/js/utils/format.js` (~lines 22-27, 60-62, 71-77,
// 91-242).

export function toFiniteNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatNumber(value) {
  const number = toFiniteNumber(value, 0);
  return number
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    .replace(".", ",");
}

// Parses an optional numeric text input (French decimal comma allowed) into a
// finite Number, or null when the field is empty/blank/non-numeric. Ported from
// gestion-depenses2/assets/js/utils/format.js (parseOptionalNumberInput +
// normalizeNumericInput, inlined) — used by the edit-segment modal's Effectif
// field so a blank value stays "unset" (null) rather than becoming 0.
export function parseOptionalNumberInput(value) {
  if (value == null) return null;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function toMonthKey(year, monthNumber) {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function parseMonthKey(monthKey) {
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

function getMonthStartDate(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthNumber - 1, 1);
}

function getMonthEndDate(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthNumber, 0);
}

function getBusinessDayDates(monthKey) {
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

function getCalendarDayDates(monthKey) {
  const startDate = getMonthStartDate(monthKey);
  const endDate = getMonthEndDate(monthKey);
  if (!startDate || !endDate) return [];

  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function buildDisplayedMonths(selectedYear, selectedMonth, monthSpan, months) {
  const items = [];

  for (let offset = 0; offset < monthSpan; offset += 1) {
    const monthIndex = (selectedMonth + offset) % 12;
    const year = selectedYear + Math.floor((selectedMonth + offset) / 12);
    const monthKey = toMonthKey(year, monthIndex + 1);
    const calendarDayDates = getCalendarDayDates(monthKey);
    const businessDayDates = getBusinessDayDates(monthKey);
    items.push({
      monthIndex,
      year,
      monthNumber: monthIndex + 1,
      monthKey,
      monthLabel: months[monthIndex] || "",
      calendarDayCount: calendarDayDates.length,
      calendarDayDates,
      businessDayCount: businessDayDates.length,
      businessDayDates,
    });
  }

  return items;
}
