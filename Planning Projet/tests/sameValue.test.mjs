import test from "node:test";
import assert from "node:assert/strict";

import { sameValue } from "../assets/js/utils/sameValue.js";

test("valeurs simples : égales si identiques, NaN compris ; jamais d'un type à l'autre", () => {
  assert.equal(sameValue(5, 5), true);
  assert.equal(sameValue("R+1", "R+1"), true);
  assert.equal(sameValue(null, null), true);
  assert.equal(sameValue(undefined, undefined), true);
  assert.equal(sameValue(NaN, NaN), true);
  assert.equal(sameValue(5, 6), false);
  assert.equal(sameValue(5, "5"), false);
  assert.equal(sameValue(null, undefined), false);
  assert.equal(sameValue(0, false), false);
});

test("dates : égales au même instant, sans être le même objet ; une date n'égale pas un nombre", () => {
  assert.equal(sameValue(new Date(2026, 0, 5), new Date(2026, 0, 5)), true);
  assert.equal(sameValue(new Date(2026, 0, 5), new Date(2026, 0, 6)), false);
  assert.equal(sameValue(new Date(2026, 0, 5), new Date(2026, 0, 5).getTime()), false);
  assert.equal(sameValue(new Date(NaN), new Date(NaN)), true);
});

test("listes : même longueur, mêmes éléments dans le même ordre", () => {
  assert.equal(sameValue([1, "a", null], [1, "a", null]), true);
  assert.equal(sameValue([], []), true);
  assert.equal(sameValue([1, 2], [2, 1]), false);
  assert.equal(sameValue([1, 2], [1, 2, 3]), false);
});

test("objets : mêmes champs et mêmes valeurs, en profondeur", () => {
  const line = () => ({
    key: "task:5",
    start: new Date(2026, 9, 9),
    link: { predId: 4, type: "FD", lag: 0 },
    cyclePath: [12, 14],
  });
  assert.equal(sameValue(line(), line()), true);
  assert.equal(sameValue(line(), { ...line(), link: { predId: 4, type: "FF", lag: 0 } }), false);
  assert.equal(sameValue(line(), { ...line(), cyclePath: [12] }), false);
  assert.equal(sameValue(line(), { ...line(), start: new Date(2026, 9, 12) }), false);
});

test("objets : un champ en plus, en moins ou d'un autre nom les distingue", () => {
  assert.equal(sameValue({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameValue({ a: 1, b: 2 }, { a: 1 }), false);
  assert.equal(sameValue({ a: undefined }, { b: undefined }), false);
});

test("une liste n'égale pas un objet, null n'égale ni l'un ni l'autre", () => {
  assert.equal(sameValue([], {}), false);
  assert.equal(sameValue(null, {}), false);
  assert.equal(sameValue({}, null), false);
  assert.equal(sameValue(null, []), false);
});
