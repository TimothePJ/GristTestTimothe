const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../service-context-core.js");

test("les zones se lisent dans les trois tables documentaires", () => {
  assert.deepEqual([...core.ZONE_SOURCE_TABLES], [
    "Planning_Projet",
    "References2",
    "ListePlan_NDC_COF",
  ]);
});

test("normalizeZoneKey ignore casse, accents, ponctuation et « Sans zone »", () => {
  assert.equal(core.normalizeZoneKey("ZONE 1A (BAT A3, A4)"), "zone1abata3a4");
  assert.equal(core.normalizeZoneKey("  zone-1a bat a3 a4 "), "zone1abata3a4");
  assert.equal(core.normalizeZoneKey("Élévations"), "elevations");
  assert.equal(core.normalizeZoneKey("Sans zone"), "");
  assert.equal(core.normalizeZoneKey(""), "");
  assert.equal(core.normalizeZoneKey(null), "");
});

test("collectZoneNames garde la première graphie, retire les vides et trie", () => {
  const rows = [
    { Zone: "ZONE 3B (BAT B2-B3)" },
    { Zone: "" },
    { Zone: "ELEVATIONS OUVERTURES" },
    { Zone: "zone 3b (bat b2-b3)" },
    { Zone: "Sans zone" },
    { Zone: "ZONE 1A (BAT A3, A4)" },
    { Zone: "Zone 10" },
    { Zone: "Zone 2" },
    {},
  ];
  assert.deepEqual(core.collectZoneNames(rows), [
    "ELEVATIONS OUVERTURES",
    "ZONE 1A (BAT A3, A4)",
    "Zone 2",
    "ZONE 3B (BAT B2-B3)",
    "Zone 10",
  ]);
});

test("mergeZoneNames unit deux listes en privilégiant la graphie locale", () => {
  assert.deepEqual(
    core.mergeZoneNames(["Zone A", "Zone C"], ["zone a", "Zone B", "", "Sans zone"]),
    ["Zone A", "Zone B", "Zone C"]
  );
  assert.deepEqual(core.mergeZoneNames([], null), []);
});
