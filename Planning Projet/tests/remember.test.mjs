import test from "node:test";
import assert from "node:assert/strict";

import { remember } from "../assets/js/utils/remember.js";

test("mêmes sources : le calcul n'est fait qu'une fois, le même résultat est rendu", () => {
  let runs = 0;
  const count = remember((rows) => {
    runs += 1;
    return { total: rows.length };
  });
  const rows = [1, 2, 3];
  const first = count(rows);
  assert.deepEqual(first, { total: 3 });
  assert.equal(count(rows), first);
  assert.equal(count(rows), first);
  assert.equal(runs, 1);
});

test("une source remplacée, même de contenu égal : le calcul est refait", () => {
  let runs = 0;
  const count = remember((rows) => {
    runs += 1;
    return rows.length;
  });
  assert.equal(count([1, 2, 3]), 3);
  assert.equal(count([1, 2, 3]), 3);
  assert.equal(runs, 2);
});

test("plusieurs sources : refait dès que l'une change, quelle que soit sa place", () => {
  const calls = [];
  const join = remember((rows, filter, layout) => {
    calls.push([rows, filter, layout]);
    return `${rows.length}/${filter}/${layout}`;
  });
  const rows = [1];
  assert.equal(join(rows, "", "zone"), "1//zone");
  assert.equal(join(rows, "", "zone"), "1//zone");
  assert.equal(join(rows, "Zone 2", "zone"), "1/Zone 2/zone");
  assert.equal(join(rows, "Zone 2", "floor"), "1/Zone 2/floor");
  assert.equal(join(rows, "Zone 2", "floor"), "1/Zone 2/floor");
  assert.equal(calls.length, 3);
});

test("seul le dernier résultat est gardé : revenir aux sources d'avant refait le calcul", () => {
  let runs = 0;
  const identity = remember((value) => {
    runs += 1;
    return value;
  });
  const first = {};
  const second = {};
  identity(first);
  identity(second);
  identity(first);
  assert.equal(runs, 3);
});

test("un résultat vide (undefined, null, 0) est gardé comme un autre", () => {
  let runs = 0;
  const nothing = remember(() => {
    runs += 1;
    return undefined;
  });
  const source = {};
  assert.equal(nothing(source), undefined);
  assert.equal(nothing(source), undefined);
  assert.equal(runs, 1);
});

test("NaN est la même source que NaN", () => {
  let runs = 0;
  const double = remember((value) => {
    runs += 1;
    return value * 2;
  });
  double(NaN);
  double(NaN);
  assert.equal(runs, 1);
});
