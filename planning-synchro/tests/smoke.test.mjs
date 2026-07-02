import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_CONFIG } from "../assets/js/config.js";

test("config exposes required tables", () => {
  assert.equal(APP_CONFIG.grist.tables.timeSegment, "TimeSegment");
  assert.equal(APP_CONFIG.grist.tables.planningProject, "Planning_Projet");
  assert.equal(APP_CONFIG.initialWindowDays, 365);
});
