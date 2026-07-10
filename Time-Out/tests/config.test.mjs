// Time-Out/tests/config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_CONFIG, LEAVE_TYPES, leaveTypeColor } from "../assets/js/config.js";

test("config exposes Time-Out + Team tables", () => {
  assert.equal(APP_CONFIG.grist.tables.timeOut, "Time-Out");
  assert.equal(APP_CONFIG.grist.tables.team, "Team");
  assert.equal(APP_CONFIG.grist.columns.timeOut.startPeriod, "Start_Period");
  assert.equal(APP_CONFIG.grist.columns.team.moi, "Moi");
});

test("the 4 leave types are exact + colored", () => {
  assert.deepEqual(LEAVE_TYPES.map((t) => t.label), [
    "Congé Payé", "Congé Non Payé", "RTT", "Congé Parental",
  ]);
  assert.equal(leaveTypeColor("RTT"), "#16a34a");
  assert.equal(leaveTypeColor("Inconnu"), "#6b7280"); // fallback grey
});
