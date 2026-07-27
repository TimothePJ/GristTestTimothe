const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimePath = path.join(__dirname, "..", "grist-service-context.js");
const runtimeSource = fs.readFileSync(runtimePath, "utf8");

test("le runtime ne remplace pas les accesseurs Grist en lecture seule", () => {
  assert.doesNotMatch(runtimeSource, /\bgrist\.onRecords\s*=/);
  assert.doesNotMatch(runtimeSource, /\bgrist\.onRecord\s*=/);
  assert.match(runtimeSource, /onRecords:\s*subscribeToRecords/);
  assert.match(runtimeSource, /onRecord:\s*subscribeToRecord/);
});
