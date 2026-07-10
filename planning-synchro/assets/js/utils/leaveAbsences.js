// planning-synchro/assets/js/utils/leaveAbsences.js
// Self-contained, pure. Coordinates Time-Out leave with the charge board.
// No DOM, no Grist. BYTE-IDENTICAL copy in gestion-depenses2. Node-testable.
// Slot key format "YYYY-MM-DD:am|pm" must match each widget's createHalfDaySlotKey.

const PERIOD_HOURS = { am: { startHour: 8, endHour: 12 }, pm: { startHour: 13, endHour: 17 } };
const HALF_DAY_PARTS = ["am", "pm"];

export function toText(value) {
  return value == null ? "" : String(value).trim();
}
export function normalizeEmail(value) {
  return toText(value).toLowerCase();
}
// Must match the widgets' normalizeNameKey / normalizePersonName exactly.
// The regex strips combining diacritics U+0300–U+036F. Written with the ASCII
// escape to avoid copy issues: .replace(/[\u0300-\u036f]/g, "")
export function normalizeName(value) {
  return toText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
export function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseIsoDate(value) {
  const m = toText(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}
function normalizePart(period) {
  const t = toText(period).toLowerCase();
  return t === "pm" ? "pm" : t === "am" ? "am" : "";
}
function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}
// Business half-day slots overlapping [startAt, endAt]; each carries key "YYYY-MM-DD:part".
function businessHalfDaySlotsBetween(startAt, endAt) {
  if (!(startAt instanceof Date) || !(endAt instanceof Date)) return [];
  const rangeStart = startAt <= endAt ? startAt : endAt;
  const rangeEnd = startAt <= endAt ? endAt : startAt;
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const lastDay = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  const slots = [];
  while (cursor <= lastDay) {
    if (isBusinessDay(cursor)) {
      for (const part of HALF_DAY_PARTS) {
        const cfg = PERIOD_HOURS[part];
        const slotStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cfg.startHour);
        const slotEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cfg.endHour);
        if (rangeStart < slotEnd && rangeEnd > slotStart) {
          slots.push({ key: `${toDateKey(cursor)}:${part}` });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}
// Time-Out leave row (Text startDate/startPeriod/endDate/endPeriod) -> Date range.
function leaveRange(startDate, startPeriod, endDate, endPeriod) {
  const s = parseIsoDate(startDate);
  const e = parseIsoDate(endDate);
  const sp = normalizePart(startPeriod);
  const ep = normalizePart(endPeriod);
  if (!s || !e || !sp || !ep) return null;
  return {
    startAt: new Date(s.getFullYear(), s.getMonth(), s.getDate(), PERIOD_HOURS[sp].startHour),
    endAt: new Date(e.getFullYear(), e.getMonth(), e.getDate(), PERIOD_HOURS[ep].endHour),
  };
}
// Map<normalizedPersonName, Set<slotKey>>. absenceTypes = exact Type labels counting as absence.
export function buildAbsenceIndex(timeOutRows, teamRows, timeOutCols, teamCols, absenceTypes) {
  const typeSet = new Set((absenceTypes || []).map((t) => toText(t).toLowerCase()));
  const teamByEmail = new Map();
  for (const row of teamRows || []) {
    const email = normalizeEmail(row?.[teamCols.email]);
    if (email) teamByEmail.set(email, row);
  }
  const index = new Map();
  for (const row of timeOutRows || []) {
    const type = toText(row?.[timeOutCols.type]);
    if (typeSet.size && !typeSet.has(type.toLowerCase())) continue;
    const team = teamByEmail.get(normalizeEmail(row?.[timeOutCols.owner]));
    if (!team) continue; // unmapped owner → ignored
    const fullName = toText(team?.[teamCols.prenomNom]) ||
      `${toText(team?.[teamCols.prenom])} ${toText(team?.[teamCols.nom])}`.trim();
    const personKey = normalizeName(fullName);
    if (!personKey) continue;
    const range = leaveRange(row?.[timeOutCols.startDate], row?.[timeOutCols.startPeriod], row?.[timeOutCols.endDate], row?.[timeOutCols.endPeriod]);
    if (!range) continue;
    let set = index.get(personKey);
    if (!set) index.set(personKey, (set = new Set()));
    for (const slot of businessHalfDaySlotsBetween(range.startAt, range.endAt)) set.add(slot.key);
  }
  return index;
}
// Available working DAYS in [startAt,endAt] after removing absence half-days.
export function availableDaysAfterLeave(startAt, endAt, absenceSet) {
  const slots = businessHalfDaySlotsBetween(startAt, endAt);
  if (!absenceSet || absenceSet.size === 0) return slots.length / 2;
  let free = 0;
  for (const slot of slots) if (!absenceSet.has(slot.key)) free += 1;
  return free / 2;
}
// Whether a half-day (dateKey + part) is an absence, for grid shading.
export function isAbsenceSlot(absenceSet, dateKey, part) {
  return !!absenceSet && absenceSet.has(`${dateKey}:${part}`);
}
