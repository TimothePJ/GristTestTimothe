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

// Charge par metier : chaque niveau porte une paire (ingenieurs, projeteurs),
// et chaque metier herite separement du niveau au-dessus.
const pair = (ingenieurs, projeteurs) => ({ ingenieurs, projeteurs });
const ing = (value) => pair(value, null);
const both = (value) => ({ ingenieurs: value, projeteurs: value });

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

  assert.deepEqual(tree[0].value, ing(2));
  const zone = tree[0].zones[0];
  assert.deepEqual(zone.value, ing(2));
  assert.deepEqual(zone.inherited, both(true));
  const doc = zone.documents[0];
  assert.deepEqual(doc.value, ing(2));
  assert.deepEqual(doc.inherited, both(true));
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

  assert.deepEqual(zone1.inherited, pair(false, true), "Zone 1 a sa propre valeur ingenieurs");
  assert.deepEqual(zone1.value, ing(2), "Zone 1 affiche SA valeur, pas celle du type");
  assert.deepEqual(zone2.inherited, both(true), "Zone 2 n'a pas de Duree_Zone : heritee");
  assert.deepEqual(zone2.value, ing(5), "Zone 2 affiche la valeur du type");
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

  assert.deepEqual(zone.value, ing(2), "majorite");
  assert.deepEqual(zone.inherited, pair(false, true));
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

  assert.deepEqual(zone.inherited, both(true), "0 explicite ne compte pas comme une valeur");
  assert.deepEqual(zone.value, ing(4), "herite du type");
});

test("buildChargeTree traite Duree_Force negatif comme non defini (document herite)", () => {
  const rows = [
    { id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 4, Duree_Force: -1 },
  ];

  const tree = buildChargeTree(rows, COLS);
  const doc = tree[0].zones[0].documents[0];

  assert.deepEqual(doc.inherited, both(true), "une valeur negative n'est pas une valeur");
  assert.deepEqual(doc.value, ing(4), "cascade jusqu'au type");
});

test("buildChargeTree lit Duree_Projet ecrit en virgule francaise", () => {
  const rows = [{ id: 1, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: "2,5" }];

  const tree = buildChargeTree(rows, COLS);

  assert.deepEqual(tree[0].value, ing(2.5));
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

  assert.deepEqual(tree[0].value, ing(2));
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
  const tree = [{ typeDoc: "COFFRAGE", value: { ingenieurs: 5 }, zones: [] }];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map((w) => w.recordId).sort((a, b) => a - b),
    [10, 11, 12]
  );
  writes.forEach((w) => assert.deepEqual(w.fields, { Duree_Projet: "5" }));
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
            { id: 20, value: { projeteurs: 4 } },
            { id: 21, value: null }, // non vise : aucune ecriture
          ],
        },
      ],
    },
  ];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { recordId: 20, fields: { Duree_Force: ";4" } });
});

test("collectChargeWrites ecrit Duree_Zone sur cette zone seulement, pas les autres zones du meme type", () => {
  // Auto-controle du self-review de la brief : la portee de Duree_Zone doit
  // etre verifiee contre un fixture a PLUS D'UNE zone du meme type.
  const rows = [
    { id: 40, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 41, ID2: "2", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 42, ID2: "3", Type_doc: "COFFRAGE", Zone: "Zone 2" }, // autre zone, meme type : jamais touchee
  ];
  const tree = [{ typeDoc: "COFFRAGE", value: null, zones: [{ zone: "Zone 1", value: { ingenieurs: 7, projeteurs: 2.5 }, documents: [] }] }];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map((w) => w.recordId).sort((a, b) => a - b),
    [40, 41]
  );
  writes.forEach((w) => assert.deepEqual(w.fields, { Duree_Zone: "7;2,5" }));
});

test("vider un champ efface la colonne", () => {
  // fields.Duree_Zone === "" pour rendre la main au niveau du dessus — jamais
  // 0, que la cascade lirait comme une valeur legitime a un autre niveau.
  const rows = [
    { id: 30, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1" },
    { id: 31, ID2: "2", Type_doc: "COFFRAGE", Zone: "Zone 1" },
  ];
  const tree = [{ typeDoc: "COFFRAGE", value: null, zones: [{ zone: "Zone 1", value: { ingenieurs: "", projeteurs: "" }, documents: [] }] }];

  const writes = collectChargeWrites(tree, rows, COLS);

  assert.equal(writes.length, 2);
  writes.forEach((w) => assert.deepEqual(w.fields, { Duree_Zone: "" }));
});

test("buildChargeTree lit les paires « ingenieurs;projeteurs » et l'heritage metier par metier", () => {
  const rows = [
    { id: 1, ID2: "1", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: "2,5;3", Duree_Zone: ";4", Duree_Force: "6" },
  ];
  const [type] = buildChargeTree(rows, COLS);
  assert.deepEqual(type.value, pair(2.5, 3));
  const [zone] = type.zones;
  // Zone : projeteurs a 4 (propre), ingenieurs herites du type (2,5).
  assert.deepEqual(zone.value, pair(2.5, 4));
  assert.deepEqual(zone.inherited, pair(true, false));
  const [doc] = zone.documents;
  // Document : ingenieurs forces a 6, projeteurs herites de la zone (4).
  assert.deepEqual(doc.value, pair(6, 4));
  assert.deepEqual(doc.inherited, pair(false, true));
});

test("collectChargeWrites ne change que le metier edite et garde l'autre part de chaque ligne", () => {
  const rows = [
    { id: 50, ID2: "1", Type_doc: "NDC", Duree_Projet: "2;3" },
    { id: 51, ID2: "2", Type_doc: "NDC", Duree_Projet: "2;6" },
    { id: 52, ID2: "3", Type_doc: "NDC" },
  ];
  const writes = collectChargeWrites([{ typeDoc: "NDC", value: { ingenieurs: 4 }, zones: [] }], rows, COLS);
  // Une part deja remplie est gardee (51 garde 6) ; une part VIDE (52) prend la
  // valeur affichee du niveau type (projeteurs 3, majoritaire a egalite : la
  // plus petite) : la fenetre ne cree pas elle-meme de divergence.
  assert.deepEqual(
    writes.map((w) => [w.recordId, w.fields.Duree_Projet]),
    [[50, "4;3"], [51, "4;6"], [52, "4;3"]]
  );
  // Vider les seuls projeteurs : l'ancien format reste pour les ingenieurs.
  const cleared = collectChargeWrites([{ typeDoc: "NDC", value: { projeteurs: "" }, zones: [] }], rows, COLS);
  assert.deepEqual(
    cleared.map((w) => [w.recordId, w.fields.Duree_Projet]),
    [[50, "2"], [51, "2"], [52, "2"]]
  );
});

test("collectChargeWrites : une zone ne remplit l'autre metier qu'avec SA propre valeur, jamais l'heritee", () => {
  const rows = [
    { id: 60, ID2: "1", Type_doc: "NDC", Zone: "Z1", Duree_Projet: "2;3", Duree_Zone: ";5" },
    { id: 61, ID2: "2", Type_doc: "NDC", Zone: "Z1", Duree_Projet: "2;3" },
    { id: 62, ID2: "3", Type_doc: "NDC", Zone: "Z2", Duree_Projet: "2;3" },
  ];
  const tree = (zone) => [{ typeDoc: "NDC", value: null, zones: [{ zone, value: { ingenieurs: 1 }, documents: [] }] }];
  // Z1 : projeteurs 5 en propre -> la ligne 61, vide, le recoit aussi.
  assert.deepEqual(
    collectChargeWrites(tree("Z1"), rows, COLS).map((w) => [w.recordId, w.fields.Duree_Zone]),
    [[60, "1;5"], [61, "1;5"]]
  );
  // Z2 : projeteurs herites du type (3) -> rien d'ecrit pour eux, ils continuent d'heriter.
  assert.deepEqual(
    collectChargeWrites(tree("Z2"), rows, COLS).map((w) => [w.recordId, w.fields.Duree_Zone]),
    [[62, "1"]]
  );
});
