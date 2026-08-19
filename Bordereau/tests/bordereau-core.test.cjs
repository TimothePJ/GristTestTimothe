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

test("le catalogue projet accepte les lignes livrees par le watcher", () => {
  assert.deepEqual(
    core.buildProjectCatalog([
      { id: 4, Numero_de_projet: "P-002", Nom_de_projet: "Projet Zeta" },
      { id: 2, Numero_de_projet: "P-001", Nom_de_projet: "Projet Alpha" },
      { id: 0, Numero_de_projet: "P-000", Nom_de_projet: "Projet invalide" },
      { id: 5, Numero_de_projet: "P-003", Nom_de_projet: "" },
    ]),
    [
      { id: 2, ids: [2], number: "P-001", name: "Projet Alpha", names: ["Projet Alpha"] },
      { id: 4, ids: [4], number: "P-002", name: "Projet Zeta", names: ["Projet Zeta"] },
    ]
  );
});

test("le catalogue projet reste compatible avec une table Grist en colonnes", () => {
  assert.deepEqual(
    core.buildProjectCatalog({
      id: [8],
      Numero_de_projet: [" P-008 "],
      Nom_de_projet: [" Projet Huit "],
    }),
    [{ id: 8, ids: [8], number: "P-008", name: "Projet Huit", names: ["Projet Huit"] }]
  );
});

test("le catalogue projet conserve les anciens identifiants et noms", () => {
  assert.deepEqual(
    core.buildProjectCatalog([{
      id: 12,
      ids: [12, 34],
      number: "P-012",
      name: "Projet actuel",
      names: ["Projet actuel", "Ancien nom"],
    }]),
    [{
      id: 12,
      ids: [12, 34],
      number: "P-012",
      name: "Projet actuel",
      names: ["Projet actuel", "Ancien nom"],
    }]
  );
});

test("une table Envois vide ne prouve pas que Type_Document manque", () => {
  assert.equal(core.isTableColumnDefinitelyMissing({ id: [] }, "Type_Document"), false);
  assert.equal(
    core.isTableColumnDefinitelyMissing({ id: [1], Projet: ["Projet Alpha"] }, "Type_Document"),
    true
  );
  assert.equal(
    core.isTableColumnDefinitelyMissing({ id: [1], Type_Document: [null] }, "Type_Document"),
    false
  );
});
