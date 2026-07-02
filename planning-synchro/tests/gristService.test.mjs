import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFetchTableResult, resolveColumnId } from "../assets/js/services/gristService.js";

test("normalizeFetchTableResult converts column-oriented to rows", () => {
  const rows = normalizeFetchTableResult({ id: [1, 2], Name: ["A", "B"] });
  assert.deepEqual(rows, [{ id: 1, Name: "A" }, { id: 2, Name: "B" }]);
});

test("resolveColumnId matches alias Start_At", () => {
  assert.equal(resolveColumnId(["id", "Start_At"], "Start_Date", ["Start_At"]), "Start_At");
});
