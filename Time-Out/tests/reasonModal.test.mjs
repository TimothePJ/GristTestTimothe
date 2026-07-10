import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeaveWritePayload } from "../assets/js/ui/reasonModal.js";

test("buildLeaveWritePayload maps dates+type to text fields", () => {
  const p = buildLeaveWritePayload("a@x", new Date(2027, 1, 1, 8), new Date(2027, 1, 1, 12), "RTT");
  assert.deepEqual(p, { owner: "a@x", startDate: "2027-02-01", startPeriod: "AM", endDate: "2027-02-01", endPeriod: "AM", type: "RTT" });
});
