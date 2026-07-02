import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry, resolveProject } from "../assets/js/services/projectRegistry.js";

const cols = { id: "id", name: "Nom_de_projet", number: "Numero_de_projet" };
const rows = [{ id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035" }];

test("resolve by name is case/accent tolerant", () => {
  const reg = buildRegistry(rows, cols);
  assert.equal(resolveProject(reg, { name: "era quai d'orsay" })?.number, "252035");
});

test("resolve by number", () => {
  const reg = buildRegistry(rows, cols);
  assert.equal(resolveProject(reg, { number: "252035" })?.name, "ERA QUAI D'ORSAY");
});

test("unknown => null", () => {
  assert.equal(resolveProject(buildRegistry(rows, cols), { name: "zzz" }), null);
});
