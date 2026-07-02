import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCalendarDate, parseDateTime, formatIsoDate, normalizeDecimal, toText } from "../assets/js/utils/dates.js";

test("parseCalendarDate handles ISO and FR", () => {
  assert.equal(formatIsoDate(parseCalendarDate("2027-03-16")), "2027-03-16");
  assert.equal(formatIsoDate(parseCalendarDate("02/02/2027")), "2027-02-02");
  assert.equal(parseCalendarDate(""), null);
  assert.equal(parseCalendarDate("not a date"), null);
});

test("parseDateTime handles FR datetime and epoch seconds", () => {
  assert.equal(formatIsoDate(parseDateTime("06/04/2026 08:00")), "2026-04-06");
  const s = Math.floor(Date.UTC(2026, 3, 6, 6, 0, 0) / 1000);
  assert.equal(parseDateTime(s) instanceof Date, true);
});

test("normalizeDecimal converts comma", () => {
  assert.equal(normalizeDecimal("8,5"), 8.5);
  assert.equal(normalizeDecimal("20"), 20);
  assert.equal(normalizeDecimal(""), null);
});

test("toText unwraps grist objects", () => {
  assert.equal(toText({ label: " x " }), "x");
  assert.equal(toText(3), "3");
});
