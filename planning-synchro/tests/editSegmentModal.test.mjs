import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSegmentHalfDayPart,
  toDateInputValue,
  buildSegmentHalfDayBoundary,
  buildEditSegmentSelection,
  validateEditSegmentEffectif,
  formatEditSegmentInputValue,
} from "../assets/js/bottom/editSegmentModal.js";

// 2027-02-01 is a Monday (business day); 2027-02-06 is a Saturday.

test("buildEditSegmentSelection: single business day am->pm = 1 day", () => {
  const selection = buildEditSegmentSelection({
    startDateValue: "2027-02-01",
    startPart: "am",
    endDateValue: "2027-02-01",
    endPart: "pm",
  });
  assert.equal(selection.error, undefined);
  assert.equal(selection.totalDays, 1);
  // Local 08:00 start / 17:00 end serialized to ISO (UTC) — assert via re-parse.
  assert.equal(new Date(selection.startDate).getHours(), 8);
  assert.equal(new Date(selection.endDate).getHours(), 17);
});

test("buildEditSegmentSelection: two business days = 2 days", () => {
  const selection = buildEditSegmentSelection({
    startDateValue: "2027-02-01",
    startPart: "am",
    endDateValue: "2027-02-02",
    endPart: "pm",
  });
  assert.equal(selection.totalDays, 2);
});

test("buildEditSegmentSelection: end not after start -> error", () => {
  const selection = buildEditSegmentSelection({
    startDateValue: "2027-02-01",
    startPart: "pm",
    endDateValue: "2027-02-01",
    endPart: "am",
  });
  assert.match(selection.error, /strictement apres/);
});

test("buildEditSegmentSelection: invalid date -> error", () => {
  const selection = buildEditSegmentSelection({
    startDateValue: "",
    startPart: "am",
    endDateValue: "2027-02-01",
    endPart: "pm",
  });
  assert.match(selection.error, /date de debut et une date de fin valides/);
});

test("validateEditSegmentEffectif: valid half-day value within range", () => {
  const result = validateEditSegmentEffectif("1.5", 2);
  assert.equal(result.error, undefined);
  assert.equal(result.effectifDays, 1.5);
  assert.equal(result.effectifValueForSave, 1.5);
});

test("validateEditSegmentEffectif: blank clears effectif (null / empty string)", () => {
  const result = validateEditSegmentEffectif("", 2);
  assert.equal(result.error, undefined);
  assert.equal(result.effectifDays, null);
  assert.equal(result.effectifValueForSave, "");
});

test("validateEditSegmentEffectif: negative / non-half-day are rejected", () => {
  assert.match(validateEditSegmentEffectif("-1").error, /negatif/);
  assert.match(validateEditSegmentEffectif("1.25").error, /entier ou un multiple/);
});

test("validateEditSegmentEffectif: effectif over available is non-blocking (visual only)", () => {
  // The old hard-block ("...ne peut pas depasser...") was removed: an Effectif
  // exceeding the leave-adjusted availability is now surfaced as a red field
  // (is-over-available) in syncDerived, not a save-blocking validation error.
  const result = validateEditSegmentEffectif("3");
  assert.equal(result.error, undefined);
  assert.equal(result.effectifDays, 3);
  assert.equal(result.effectifValueForSave, 3);
});

test("getSegmentHalfDayPart: start snaps am<noon, end snaps am<=noon", () => {
  assert.equal(getSegmentHalfDayPart(new Date(2027, 1, 1, 8, 0), "start"), "am");
  assert.equal(getSegmentHalfDayPart(new Date(2027, 1, 1, 13, 0), "start"), "pm");
  assert.equal(getSegmentHalfDayPart(new Date(2027, 1, 1, 12, 0), "end"), "am");
  assert.equal(getSegmentHalfDayPart(new Date(2027, 1, 1, 17, 0), "end"), "pm");
});

test("toDateInputValue / buildSegmentHalfDayBoundary round-trip a boundary", () => {
  const boundary = buildSegmentHalfDayBoundary("2027-02-01", "am", "start");
  assert.equal(toDateInputValue(boundary), "2027-02-01");
  assert.equal(boundary.getHours(), 8);
});

test("formatEditSegmentInputValue: trims trailing zeros, blanks null/negative", () => {
  assert.equal(formatEditSegmentInputValue(2), "2");
  assert.equal(formatEditSegmentInputValue(1.5), "1.5");
  assert.equal(formatEditSegmentInputValue(null), "");
  assert.equal(formatEditSegmentInputValue(""), "");
  assert.equal(formatEditSegmentInputValue(-3), "");
});
