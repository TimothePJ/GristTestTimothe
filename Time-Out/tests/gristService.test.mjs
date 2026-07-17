// Time-Out/tests/gristService.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFetchTableResult, resolveColumnId, isCensoredCell, isMoiPresent, findCurrentUser } from "../assets/js/services/gristService.js";

test("normalizeFetchTableResult transposes column-arrays to rows", () => {
  const rows = normalizeFetchTableResult({ id: [1, 2], Email: ["a@x", "b@x"] });
  assert.deepEqual(rows, [{ id: 1, Email: "a@x" }, { id: 2, Email: "b@x" }]);
});
test("resolveColumnId prefers exact then normalized then requested", () => {
  assert.equal(resolveColumnId(["Start_Date"], "Start_Date", ["Start"]), "Start_Date");
  assert.equal(resolveColumnId(["startdate"], "Start_Date", []), "startdate");
  assert.equal(resolveColumnId([], "Owner", []), "Owner");
});
test("isCensoredCell: ['C'] and null/'' are censored; true is not", () => {
  assert.equal(isCensoredCell(["C"]), true);
  assert.equal(isCensoredCell(null), true);
  assert.equal(isCensoredCell(true), false);
});
test("findCurrentUser picks the single visible Moi row", () => {
  const cols = { moi: "Moi", email: "Email", admin: "Admin" };
  const rows = [
    { Moi: ["C"], Email: "a@x", Admin: ["C"] },
    { Moi: true,   Email: "b@x", Admin: true },
    { Moi: ["C"], Email: "c@x", Admin: ["C"] },
  ];
  assert.deepEqual(findCurrentUser(rows, cols), { email: "b@x", isAdmin: true });
  assert.equal(findCurrentUser([{ Moi: ["C"] }], cols), null);
});
test("findCurrentUser: a readable-but-false Moi cell still identifies me", () => {
  // La détection repose sur le censurage ACL, pas sur la véracité du toggle :
  // la seule cellule Moi non censurée (ici `false`) est bien « moi ».
  const cols = { moi: "Moi", email: "Email", admin: "Admin" };
  const rows = [
    { Moi: ["C"],  Email: "a@x", Admin: ["C"] },
    { Moi: false,  Email: "me@x", Admin: false },
    { Moi: ["C"],  Email: "c@x", Admin: ["C"] },
  ];
  assert.deepEqual(findCurrentUser(rows, cols), { email: "me@x", isAdmin: false });
});
