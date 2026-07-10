// Time-Out/assets/js/utils/textSegments.js
// TEXT half-day math. Time stored as "YYYY-MM-DD" + "AM"/"PM".
// Boundary hours mirror planning-synchro HALF_DAY_TIMES (AM 08-12, PM 13-17).
import { parseCalendarDate, createLocalDate, isValidDate, toDateKey } from "./dates.js";

export const PERIOD_HOURS = { AM: { startHour: 8, endHour: 12 }, PM: { startHour: 13, endHour: 17 } };

export function normalizePeriod(period) {
  const t = String(period || "").trim().toUpperCase();
  return t === "PM" ? "PM" : t === "AM" ? "AM" : "";
}
export function periodStartHour(period) {
  const c = PERIOD_HOURS[normalizePeriod(period)];
  return c ? c.startHour : null;
}
export function periodEndHour(period) {
  const c = PERIOD_HOURS[normalizePeriod(period)];
  return c ? c.endHour : null;
}
export function segmentToDates({ startDate, startPeriod, endDate, endPeriod }) {
  const startBase = parseCalendarDate(startDate);
  const endBase = parseCalendarDate(endDate);
  const startHour = periodStartHour(startPeriod);
  const endHour = periodEndHour(endPeriod);
  if (!startBase || !endBase || startHour == null || endHour == null) return null;
  return { startAt: createLocalDate(startBase, startHour), endAt: createLocalDate(endBase, endHour) };
}
function periodForHour(hours, edge) {
  if (edge === "end") return hours <= 12 ? "AM" : "PM";
  return hours < 12 ? "AM" : "PM";
}
export function datesToSegmentText(startAt, endAt) {
  if (!isValidDate(startAt) || !isValidDate(endAt)) return null;
  return {
    startDate: toDateKey(startAt), startPeriod: periodForHour(startAt.getHours(), "start"),
    endDate: toDateKey(endAt), endPeriod: periodForHour(endAt.getHours(), "end"),
  };
}
export function segmentsOverlap(a, b) {
  if (!a || !b) return false;
  return a.startAt < b.endAt && a.endAt > b.startAt;
}
export function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}
