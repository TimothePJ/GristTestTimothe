// Time-Out/tests/dates.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toText, toDateKey, parseCalendarDate, createLocalDate, isValidDate } from "../assets/js/utils/dates.js";

test("toDateKey formats local Y-M-D zero-padded", () => {
  assert.equal(toDateKey(new Date(2026, 6, 1)), "2026-07-01");
});
test("parseCalendarDate parses YYYY-MM-DD to local midnight", () => {
  assert.deepEqual(parseCalendarDate("2026-07-01"), new Date(2026, 6, 1));
  assert.equal(parseCalendarDate(""), null);
});
test("createLocalDate stamps hour", () => {
  assert.deepEqual(createLocalDate(new Date(2026, 6, 1), 8), new Date(2026, 6, 1, 8, 0, 0, 0));
});
test("toText coerces / isValidDate guards", () => {
  assert.equal(toText(null), "");
  assert.equal(toText(42), "42");
  assert.equal(isValidDate(new Date("nope")), false);
});
