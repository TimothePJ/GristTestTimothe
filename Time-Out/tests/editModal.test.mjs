import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEditPayload } from "../assets/js/ui/editModal.js";

test("buildEditPayload maps date+period inputs to the update patch fields", () => {
  const res = buildEditPayload({
    segmentId: 7,
    startDate: "2027-02-01",
    startPeriod: "AM",
    endDate: "2027-02-03",
    endPeriod: "PM",
    type: "RTT",
  });
  assert.equal(res.error, undefined);
  assert.equal(res.segmentId, 7);
  assert.deepEqual(res.patch, {
    startDate: "2027-02-01",
    startPeriod: "AM",
    endDate: "2027-02-03",
    endPeriod: "PM",
    type: "RTT",
  });
  // Boundary Dates are rebuilt with the half-day hour rules (AM start 08:00, PM end 17:00).
  assert.deepEqual(res.startAt, new Date(2027, 1, 1, 8, 0, 0, 0));
  assert.deepEqual(res.endAt, new Date(2027, 1, 3, 17, 0, 0, 0));
});

test("buildEditPayload single AM half-day is valid (end 12:00 > start 08:00)", () => {
  const res = buildEditPayload({
    segmentId: 1,
    startDate: "2027-02-01",
    startPeriod: "AM",
    endDate: "2027-02-01",
    endPeriod: "AM",
    type: "Congé Payé",
  });
  assert.equal(res.error, undefined);
  assert.equal(res.patch.startPeriod, "AM");
  assert.equal(res.patch.endPeriod, "AM");
});

test("buildEditPayload rejects an inverted range (end <= start)", () => {
  const res = buildEditPayload({
    segmentId: 1,
    startDate: "2027-02-03",
    startPeriod: "AM",
    endDate: "2027-02-01",
    endPeriod: "PM",
    type: "RTT",
  });
  assert.ok(res.error);
  assert.equal(res.patch, undefined);
});

test("buildEditPayload rejects empty/invalid dates", () => {
  const res = buildEditPayload({
    segmentId: 1,
    startDate: "",
    startPeriod: "AM",
    endDate: "2027-02-01",
    endPeriod: "PM",
    type: "RTT",
  });
  assert.ok(res.error);
  assert.equal(res.patch, undefined);
});
