import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addGrant,
  buildGrantKey,
  decodeGristList,
  encodeGristList,
  flattenAssignments,
  normalizeFetchTableResult,
  parseGrantKey,
  removeGrant,
} from "../accessModel.js";

test("decode and encode a Grist Choice List", () => {
  assert.deepEqual(decodeGristList(["L", "252035|Structure", "262021|Topographie"]), [
    "252035|Structure",
    "262021|Topographie",
  ]);
  assert.deepEqual(encodeGristList(["262021|Topographie", "252035|Structure"]), [
    "L",
    "252035|Structure",
    "262021|Topographie",
  ]);
});

test("censored cells never expose a grant", () => {
  assert.deepEqual(decodeGristList(["C"]), []);
  assert.deepEqual(decodeGristList("CENSORED"), []);
});

test("grant keys use the stable Grist project row id and exact service", () => {
  const key = buildGrantKey(1, "Structure");
  assert.equal(key, "P1|Structure");
  assert.deepEqual(parseGrantKey(key), {
    key,
    projectId: 1,
    service: "Structure",
    valid: true,
  });
  assert.equal(buildGrantKey("", "Structure"), "");
  assert.equal(buildGrantKey(1, "Structure|Synthese"), "");
});

test("addGrant deduplicates and removeGrant is case-insensitive", () => {
  const values = ["L", "P1|Structure"];
  assert.deepEqual(addGrant(values, "P1|Structure"), ["P1|Structure"]);
  assert.deepEqual(removeGrant(values, "p1|structure"), []);
});

test("normalize column-oriented fetchTable payload", () => {
  assert.deepEqual(
    normalizeFetchTableResult({
      id: [1, 2],
      Email: ["a@example.com", "b@example.com"],
    }),
    [
      { id: 1, Email: "a@example.com" },
      { id: 2, Email: "b@example.com" },
    ],
  );
});

test("flattenAssignments resolves project labels and keeps obsolete grants removable", () => {
  const teamRows = [
    {
      id: 7,
      Prenom: "Baptiste",
      Nom: "Chevau",
      Email: "baptiste@example.com",
      Service: "Synthese",
      Acces_Lecture_Projets: ["L", "P1|Structure", "P99|Topographie"],
    },
  ];
  const projectRows = [
    { id: 1, Numero_de_projet: "252035", Nom_de_projet: "ERA QUAI D'ORSAY" },
  ];

  const assignments = flattenAssignments(teamRows, projectRows);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].personName, "Baptiste Chevau");
  assert.equal(assignments[0].projectName, "ERA QUAI D'ORSAY");
  assert.equal(assignments[0].grantedService, "Structure");
  assert.equal(assignments[0].obsolete, false);
  assert.equal(assignments[1].obsolete, true);
});
