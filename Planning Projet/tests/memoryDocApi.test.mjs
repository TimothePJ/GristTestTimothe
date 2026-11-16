import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryDocApi } from "../assets/js/services/memoryDocApi.js";

const T = "Planning_Projet";
const base = () => [
  { id: 1, Nom: "a", Duree: 1 },
  { id: 2, Nom: "b", Duree: 2 },
  { id: 3, Nom: "c", Duree: 3 },
];

test("AddRecord / BulkAddRecord : ids croissants après le plus grand id, jamais réutilisés", async () => {
  const api = createMemoryDocApi({ rows: base() });
  const r1 = await api.applyUserActions([["AddRecord", T, null, { Nom: "d" }]]);
  assert.equal(r1.retValues[0], 4);
  await api.applyUserActions([["RemoveRecord", T, 4]]);
  const r2 = await api.applyUserActions([
    ["BulkAddRecord", T, [null, null], { Nom: ["e", "f"], Duree: [5, 6] }],
  ]);
  assert.deepEqual(r2.retValues[0], [5, 6]);
  const rows = api.getRows();
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 5, 6]);
  assert.equal(rows[4].Nom, "f");
  assert.equal(rows[4].Duree, 6);
});

test("Update / BulkUpdate / Remove / BulkRemove", async () => {
  const api = createMemoryDocApi({ rows: base() });
  await api.applyUserActions([["UpdateRecord", T, 1, { Nom: "x" }]]);
  assert.equal(api.getRows()[0].Nom, "x");
  assert.equal(api.getRows()[0].Duree, 1);
  await api.applyUserActions([["BulkUpdateRecord", T, [2, 3], { Duree: [20, 30] }]]);
  assert.deepEqual(api.getRows().map((r) => r.Duree), [1, 20, 30]);
  await api.applyUserActions([["RemoveRecord", T, 1]]);
  assert.deepEqual(api.getRows().map((r) => r.id), [2, 3]);
  await api.applyUserActions([["BulkRemoveRecord", T, [2, 3]]]);
  assert.deepEqual(api.getRows(), []);
});

test("defaults posés sur les lignes ajoutées", async () => {
  const api = createMemoryDocApi({
    rows: [],
    defaults: { Service: "Synthese", NomProjet: "Modèle d'étage" },
  });
  await api.applyUserActions([
    ["AddRecord", T, null, { Nom: "a" }],
    ["BulkAddRecord", T, [null, null], { Nom: ["b", "c"], NomProjet: ["P1", "P2"] }],
  ]);
  const rows = api.getRows();
  assert.equal(rows[0].Service, "Synthese");
  assert.equal(rows[0].NomProjet, "Modèle d'étage");
  assert.equal(rows[1].Service, "Synthese");
  assert.equal(rows[1].NomProjet, "P1");
  assert.equal(rows[2].NomProjet, "P2");
});

test("lot refusé en entier", async () => {
  const cases = [
    [["UpdateRecord", T, 1, { Nom: "z" }], ["UpdateRecord", "Autre", 1, { Nom: "q" }]],
    [["UpdateRecord", T, 1, { Nom: "z" }], ["UpdateRecord", T, 99, { Nom: "q" }]],
    [["AddRecord", T, null, { Nom: "z" }], ["RemoveRecord", T, 99]],
    [["UpdateRecord", T, 1, { Nom: "z" }], ["BulkUpdateRecord", T, [1, 99], { Nom: ["a", "b"] }]],
    [["UpdateRecord", T, 1, { Nom: "z" }], ["BulkRemoveRecord", T, [1, 99]]],
    [["UpdateRecord", T, 1, { Nom: "z" }], ["Inconnue", T, 1]],
  ];
  for (const actions of cases) {
    let calls = 0;
    const api = createMemoryDocApi({ rows: base(), onChange: () => { calls++; } });
    await assert.rejects(api.applyUserActions(actions), (e) => e instanceof Error && e.message.length > 0);
    assert.deepEqual(api.getRows(), base());
    assert.equal(calls, 0);
  }
});

test("retValues comme Grist, dans l'ordre des actions", async () => {
  let calls = 0;
  const api = createMemoryDocApi({ rows: base(), onChange: () => { calls++; } });
  const r = await api.applyUserActions([
    ["AddRecord", T, null, { Nom: "d" }],
    ["BulkAddRecord", T, [null, null], { Nom: ["e", "f"] }],
    ["UpdateRecord", T, 1, { Nom: "x" }],
    ["RemoveRecord", T, 2],
  ]);
  assert.deepEqual(r.retValues, [4, [5, 6], null, null]);
  assert.equal(calls, 1);
});

test("getRows rend des copies", async () => {
  const api = createMemoryDocApi({ rows: base() });
  api.getRows()[0].Nom = "muté";
  assert.equal(api.getRows()[0].Nom, "a");
});
