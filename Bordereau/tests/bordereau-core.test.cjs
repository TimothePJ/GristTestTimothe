const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../bordereau-core.js");

const plans = [
  {
    Nom_projet: "Projet Alpha",
    NumeroDocument: "0115",
    Type_document: "COFFRAGE",
    Indice: "A",
  },
  {
    Nom_projet: "Projet Alpha",
    NumeroDocument: "0115",
    Type_document: "ARMATURES",
    Indice: "A",
  },
  {
    Nom_projet: "Projet Alpha",
    NumeroDocument: "0200",
    Type_document: "NDC",
    Indice: "0",
  },
  {
    Nom_projet: "Autre projet",
    NumeroDocument: "0115",
    Type_document: "COUPES",
    Indice: "A",
  },
];

test("la cle document distingue deux types portant le meme numero", () => {
  const coffrage = core.getDocumentKey("0115", "COFFRAGE");
  const armatures = core.getDocumentKey("0115", "ARMATURES");

  assert.notEqual(coffrage, armatures);
  assert.equal(coffrage, core.getDocumentKey(" 0115 ", "coffrage"));
  assert.notEqual(
    core.getDocumentKey("0115", "DEMOLITION"),
    core.getDocumentKey("0115", "DÉMOLITION")
  );
});

test("les candidats de type sont limites au projet et au numero", () => {
  assert.deepEqual(
    core.collectTypeCandidates(plans, "Projet Alpha", "0115"),
    ["ARMATURES", "COFFRAGE"]
  );
});

test("un ancien envoi est complete automatiquement si un seul type existe", () => {
  assert.deepEqual(
    core.resolveMissingType(plans, "Projet Alpha", "0200"),
    { status: "unique", typeDocument: "NDC", candidates: ["NDC"] }
  );
});

test("un ancien envoi reste ambigu si plusieurs types existent", () => {
  assert.deepEqual(
    core.resolveMissingType(plans, "Projet Alpha", "0115"),
    {
      status: "ambiguous",
      typeDocument: "",
      candidates: ["ARMATURES", "COFFRAGE"],
    }
  );
});

test("la reprise ne prepare que les affectations de type non ambigues", () => {
  assert.deepEqual(
    core.buildUniqueTypeAssignments(
      [
        { id: 1, Projet: "Projet Alpha", N_Plan: "0200", Type_Document: "" },
        { id: 2, Projet: "Projet Alpha", N_Plan: "0115", Type_Document: "" },
        { id: 3, Projet: "Projet Alpha", N_Plan: "0200", Type_Document: "NDC" },
      ],
      plans
    ),
    [{ recordId: 1, typeDocument: "NDC" }]
  );
});

test("un envoi type ne bloque que le meme type et le meme indice", () => {
  const sentKeys = core.buildSentDocumentIndiceKeys(
    [{
      Projet: "Projet Alpha",
      N_Plan: "0115",
      Type_Document: "COFFRAGE",
      Indice: "A",
      Envoye: true,
    }],
    "Projet Alpha",
    plans
  );

  assert.equal(
    sentKeys.has(core.getDocumentIndiceKey("0115", "COFFRAGE", "A")),
    true
  );
  assert.equal(
    sentKeys.has(core.getDocumentIndiceKey("0115", "ARMATURES", "A")),
    false
  );
});

test("un ancien envoi ambigu bloque prudemment tous les types candidats", () => {
  const sentKeys = core.buildSentDocumentIndiceKeys(
    [{
      Projet: "Projet Alpha",
      N_Plan: "0115",
      Type_Document: "",
      Indice: "A",
      Envoye: true,
    }],
    "Projet Alpha",
    plans
  );

  assert.equal(
    sentKeys.has(core.getDocumentIndiceKey("0115", "COFFRAGE", "A")),
    true
  );
  assert.equal(
    sentKeys.has(core.getDocumentIndiceKey("0115", "ARMATURES", "A")),
    true
  );
});

test("les references projet peuvent etre resolues avant comparaison", () => {
  const referencePlans = [{
    Nom_projet: 12,
    NumeroDocument: "0300",
    Type_document: "COFFRAGE",
  }];
  const resolveProjectName = (value) => value === 12 ? "Projet Alpha" : value;

  assert.deepEqual(
    core.collectTypeCandidates(
      referencePlans,
      "Projet Alpha",
      "0300",
      resolveProjectName
    ),
    ["COFFRAGE"]
  );
});
