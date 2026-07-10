// Time-Out/tests/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMembersFromLeaves, groupMembersByService, buildMonthGroups } from "../assets/js/ui/board.js";

test("buildMembersFromLeaves seeds every member and attaches leaves by email", () => {
  const members = [{ name: "A", email: "a@x", service: "Structure" }, { name: "B", email: "b@x", service: "Structure" }];
  const segs = [{ id: 1, owner: "A@X", type: "RTT" }];
  const built = buildMembersFromLeaves(members, segs);
  assert.equal(built.length, 2);
  assert.equal(built.find((m) => m.email === "a@x").segments.length, 1); // case-insensitive owner match
  assert.equal(built.find((m) => m.email === "b@x").segments.length, 0);
});
test("groupMembersByService buckets + sorts", () => {
  const grouped = groupMembersByService([
    { name: "Zoe", service: "Topo" }, { name: "Ana", service: "Topo" }, { name: "X", service: "" },
  ]);
  assert.deepEqual(Object.keys(grouped), ["Sans service", "Topo"]);
  assert.deepEqual(grouped.Topo.map((m) => m.name), ["Ana", "Zoe"]);
});
test("buildMonthGroups groups consecutive days into calendar-month runs", () => {
  const days = [
    new Date(2026, 6, 30), new Date(2026, 6, 31), // juillet
    new Date(2026, 7, 1), new Date(2026, 7, 2),   // août
  ];
  const groups = buildMonthGroups(days);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { startIndex: 0, count: 2, year: 2026, monthIndex: 6 });
  assert.deepEqual(groups[1], { startIndex: 2, count: 2, year: 2026, monthIndex: 7 });
  assert.deepEqual(buildMonthGroups([]), []);
});
