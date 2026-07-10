// Time-Out/tests/textSegments.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodStartHour, periodEndHour, segmentToDates, datesToSegmentText, segmentsOverlap } from "../assets/js/utils/textSegments.js";

test("AM 08-12 / PM 13-17 (case-insensitive)", () => {
  assert.equal(periodStartHour("AM"), 8);
  assert.equal(periodEndHour("AM"), 12);
  assert.equal(periodStartHour("pm"), 13);
  assert.equal(periodEndHour("PM"), 17);
  assert.equal(periodStartHour("xx"), null);
});
test("segmentToDates single AM day -> 08:00..12:00", () => {
  const { startAt, endAt } = segmentToDates({ startDate: "2027-02-01", startPeriod: "AM", endDate: "2027-02-01", endPeriod: "AM" });
  assert.deepEqual(startAt, new Date(2027, 1, 1, 8, 0, 0, 0));
  assert.deepEqual(endAt, new Date(2027, 1, 1, 12, 0, 0, 0));
});
test("segmentToDates multi-day AM->PM", () => {
  const { startAt, endAt } = segmentToDates({ startDate: "2027-02-01", startPeriod: "AM", endDate: "2027-02-03", endPeriod: "PM" });
  assert.deepEqual(startAt, new Date(2027, 1, 1, 8, 0, 0, 0));
  assert.deepEqual(endAt, new Date(2027, 1, 3, 17, 0, 0, 0));
});
test("datesToSegmentText round-trips", () => {
  const seg = { startDate: "2027-02-01", startPeriod: "AM", endDate: "2027-02-03", endPeriod: "PM" };
  const { startAt, endAt } = segmentToDates(seg);
  assert.deepEqual(datesToSegmentText(startAt, endAt), seg);
});
test("end edge at 12:00 snaps AM", () => {
  const text = datesToSegmentText(new Date(2027, 1, 1, 8), new Date(2027, 1, 1, 12));
  assert.equal(text.startPeriod, "AM");
  assert.equal(text.endPeriod, "AM");
});
test("same-day AM vs PM do NOT overlap; full day covers PM", () => {
  const am = segmentToDates({ startDate: "2027-02-01", startPeriod: "AM", endDate: "2027-02-01", endPeriod: "AM" });
  const pm = segmentToDates({ startDate: "2027-02-01", startPeriod: "PM", endDate: "2027-02-01", endPeriod: "PM" });
  assert.equal(segmentsOverlap(am, pm), false);
  assert.equal(segmentsOverlap(am, am), true);
  const full = segmentToDates({ startDate: "2027-02-01", startPeriod: "AM", endDate: "2027-02-01", endPeriod: "PM" });
  assert.equal(segmentsOverlap(full, pm), true);
});
