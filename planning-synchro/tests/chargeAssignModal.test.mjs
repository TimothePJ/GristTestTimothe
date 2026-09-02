// Tests des helpers PURS de la fenetre d'assignation de la charge
// (bottom/chargeAssignModal.js) : buildChargeTree (lecture, groupement,
// heritage, divergence) et collectChargeWrites (traduction d'un arbre —
// eventuellement edite a la main — en ecritures Planning_Projet). Le
// controleur DOM (createChargeAssignModal) est verifie a part, dans
// tests/chargeAssignModalDom.test.mjs (verrou de soumission).
//
// COLS reprend exactement l'objet de tests/documentCharge.test.mjs : les deux
// fichiers doivent parler des memes noms de colonnes reelles de l'export.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChargeTree, collectChargeWrites } from "../assets/js/bottom/chargeAssignModal.js";

const COLS = {
  id: "id",
  id2: "ID2",
  typeDoc: "Type_doc",
  zone: "Zone",
  taskName: "Taches",
  taskNameAlt: "Tache",
  dureeProjet: "Duree_Projet",
  dureeZone: "Duree_Zone",
  dureeForce: "Duree_Force",
};

test("buildChargeTree groupe par type puis par zone du projet courant", () => {
  const rows = [
    // En-tete de zone : ignoree (ni ID2 ni Type_doc).
    { id: 0, Zone: "Zone 1" },
    { id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 2", Duree_Projet: 2 },
    { id: 2, ID2: "3002", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    { id: 3, ID2: "4001", Type_doc: "ARMATURES", Zone: "Zone 1", Duree_Projet: 3 },
  ];

  const tree = buildChargeTree(rows, COLS);

  // Types dans l'ordre d'apparition : COFFRAGE (ligne 1) avant ARMATURES (ligne 3).
  assert.deepEqual(tree.map((t) => t.typeDoc), ["COFFRAGE", "ARMATURES"]);
  // Zones du seul type COFFRAGE, dans l'ordre d'apparition : Zone 2 avant Zone 1.
  assert.deepEqual(tree[0].zones.map((z) => z.zone), ["Zone 2", "Zone 1"]);
  assert.deepEqual(tree[1].zones.map((z) => z.zone), ["Zone 1"]);
  // Chaque zone porte bien ses documents.
  assert.deepEqual(tree[0].zones[0].documents.map((d) => d.id2), ["3001"]);
  assert.deepEqual(tree[0].zones[1].documents.map((d) => d.id2), ["3002"]);
});

test("un niveau vide herite du niveau au-dessus", () => {
  // Duree_Zone absente -> la zone affiche la valeur du type, marquee heritee.
  // Duree_Force absente -> le document affiche la valeur resolue (ici celle du
  // type, via la cascade de resolveDocumentCharge), marque herite lui aussi.
  const rows = [{ id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 }];

  const tree = buildChargeTree(rows, COLS);

  assert.equal(tree[0].value, 2);
  const zone = tree[0].zones[0];
  assert.equal(zone.value, 2);
  assert.equal(zone.inherited, true);
  const doc = zone.documents[0];
  assert.equal(doc.value, 2);
  assert.equal(doc.inherited, true);
});

test("buildChargeTree lit la propre valeur Duree_Zone d'une zone, distincte du type", () => {
  // Fix round 1, Important 2 : AUCUN fixture existant ne posait Duree_Zone sur
  // une ligne. Une implementation qui hardcoderait zoneInherited=true (et
  // zoneValue=typeValue) passerait le reste de la suite sans etre demasquee.
  const rows = [
    { id: 1, ID2: "1001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 5, Duree_Zone: 2 },
    { id: 2, ID2: "1002", Type_doc: "COFFRAGE", Zone: "Zone 2", Duree_Projet: 5 }, // pas de Duree_Zone : herite du type
  ];

  const tree = buildChargeTree(rows, COLS);
  const zone1 = tree[0].zones.find((z) => z.zone === "Zone 1");
  const zone2 = tree[0].zones.find((z) => z.zone === "Zone 2");

  assert.equal(zone1.inherited, false, "Zone 1 a sa propre valeur");
  assert.equal(zone1.value, 2, "Zone 1 affiche SA valeur, pas celle du type");
  assert.equal(zone2.inherited, true, "Zone 2 n'a pas de Duree_Zone : heritee");
  assert.equal(zone2.value, 5, "Zone 2 affiche la valeur du type");
});

test("buildChargeTree signale une divergence de Duree_Zone dans une zone", () => {
  // Meme lacune que ci-dessus, cote divergence : jamais teste avec une vraie
  // colonne Duree_Zone renseignee (seule computeProjectCharge l'etait deja).
  const rows = [
    { id: 1, ID2: "2001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Zone: 2 },
    { id: 2, ID2: "2002", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Zone: 2 },
    { id: 3, ID2: "2003", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Zone: 3 },
  ];

  const tree = buildChargeTree(rows, COLS);
  const zone = tree[0].zones[0];

  assert.equal(zone.value, 2, "majorite");
  assert.equal(zone.inherited, false);
  assert.equal(zone.divergent, true);
  assert.deepEqual(zone.divergentIds, ["2003"]);
});

test("buildChargeTree traite Duree_Zone a 0 comme non defini (herite du type)", () => {
  // Fix round 1, Important 3 : pin de la regle "0 explicite = pas defini",
  // copiee de documentCharge.js#readDuration, au niveau ZONE.
  const rows = [
    { id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 4, Duree_Zone: 0 },
  ];

  const tree = buildChargeTree(rows, COLS);
  const zone = tree[0].zones[0];

  assert.equal(zone.inherited, true, "0 explicite ne compte pas comme une valeur");
  assert.equal(zone.value, 4, "herite du type");
});

test("buildChargeTree traite Duree_Force negatif comme non defini (document herite)", () => {
  const rows = [
    { id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 4, Duree_Force: -1 },
  ];

  const tree = buildChargeTree(rows, COLS);
  const doc = tree[0].zones[0].documents[0];

  assert.equal(doc.inherited, true, "une valeur negative n'est pas une valeur");
  assert.equal(doc.value, 4, "cascade jusqu'au type");
});

test("buildChargeTree lit Duree_Projet ecrit en virgule francaise", () => {
  const rows = [{ id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: "2,5" }];

  const tree = buildChargeTree(rows, COLS);

  assert.equal(tree[0].value, 2.5);
});

test("buildChargeTree signale un groupe divergent", () => {
  // 2 lignes a 2 j, 1 a 3 j -> value 2 (majorite), divergent true, ID2 de
  // l'ecart liste.
  const rows = [
    { id: 1, ID2: "1001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    { id: 2, ID2: "1002", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    { id: 3, ID2: "1003", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 3 },
  ];

  const tree = buildChargeTree(rows, COLS);

  assert.equal(tree[0].value, 2);
  assert.equal(tree[0].divergent, true);
  assert.deepEqual(tree[0].divergentIds, ["1003"]);
});

test("collectChargeWrites ecrit Duree_Projet sur TOUTES les lignes du type", () => {
  // 3 lignes COFFRAGE -> 3 UpdateRecord portant la meme valeur.
  const rows = [
    { id: 10, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 11, ID2: "2", Type_doc: "COFFRAGE", Zone: "Zone 2" },
    { id: 12, ID2: "3", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 13, ID2: "4", Type_doc: "ARMATURES", Zone: "Zone 1" }, // autre type : jamais touche
  ];
  const tree = [{ typeDoc: "COFFRAGE", value: 5, zones: [] }];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map((w) => w.recordId).sort((a, b) => a - b),
    [10, 11, 12]
  );
  writes.forEach((w) => assert.deepEqual(w.fields, { Duree_Projet: 5 }));
});

test("collectChargeWrites ne touche que la ligne visee au niveau document", () => {
  // Duree_Force -> un seul recordId.
  const rows = [
    { id: 20, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 21, ID2: "2", Type_doc: "COFFRAGE", Zone: "Zone 1" },
  ];
  const tree = [
    {
      typeDoc: "COFFRAGE",
      value: null, // rien a ecrire au niveau type
      zones: [
        {
          zone: "Zone 1",
          value: null, // rien a ecrire au niveau zone
          documents: [
            { id: 20, value: 4 },
            { id: 21, value: null }, // non vise : aucune ecriture
          ],
        },
      ],
    },
  ];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { recordId: 20, fields: { Duree_Force: 4 } });
});

test("collectChargeWrites ecrit Duree_Zone sur cette zone seulement, pas les autres zones du meme type", () => {
  // Auto-controle du self-review de la brief : la portee de Duree_Zone doit
  // etre verifiee contre un fixture a PLUS D'UNE zone du meme type.
  const rows = [
    { id: 40, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 41, ID2: "2", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 42, ID2: "3", Type_doc: "COFFRAGE", Zone: "Zone 2" }, // autre zone, meme type : jamais touchee
  ];
  const tree = [{ typeDoc: "COFFRAGE", value: null, zones: [{ zone: "Zone 1", value: 7, documents: [] }] }];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map((w) => w.recordId).sort((a, b) => a - b),
    [40, 41]
  );
  writes.forEach((w) => assert.deepEqual(w.fields, { Duree_Zone: 7 }));
});

test("vider un champ efface la colonne", () => {
  // fields.Duree_Zone === "" pour rendre la main au niveau du dessus — jamais
  // 0, que la cascade lirait comme une valeur legitime a un autre niveau.
  const rows = [
    { id: 30, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 31, ID2: "2", Type_doc: "COFFRAGE", Zone: "Zone 1" },
  ];
  const tree = [{ typeDoc: "COFFRAGE", value: null, zones: [{ zone: "Zone 1", value: "", documents: [] }] }];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 2);
  writes.forEach((w) => assert.deepEqual(w.fields, { Duree_Zone: "" }));
});
