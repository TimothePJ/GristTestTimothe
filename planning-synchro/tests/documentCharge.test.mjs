import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isDocumentRow,
  resolveDocumentCharge,
  getDocumentWorkSpan,
  spreadChargeOverMonths,
  computeProjectCharge,
} from "../assets/js/bottom/documentCharge.js";

const COLS = {
  id: "id",
  id2: "ID2",
  typeDoc: "Type_doc",
  zone: "Zone",
  taskName: "Taches",
  dateLimite: "Date_limite",
  diffCoffrage: "Diff_coffrage",
  diffArmature: "Diff_armature",
  demarragesTravaux: "Demarrages_travaux",
  dureeProjet: "Duree_Projet",
  dureeZone: "Duree_Zone",
  dureeForce: "Duree_Force",
};

test("isDocumentRow ecarte les en-tetes de zone", () => {
  // En-tete de zone reel de l'export : ni ID2 ni Type_doc, seulement Zone.
  assert.equal(isDocumentRow({ Zone: "Zone 1 / BAT BC" }, COLS), false);
  assert.equal(isDocumentRow({ ID2: "3001", Type_doc: "COFFRAGE" }, COLS), true);
  // Un ID2 sans type reste un document (type a renseigner).
  assert.equal(isDocumentRow({ ID2: "3001" }, COLS), true);
});

test("resolveDocumentCharge applique la cascade Force > Zone > Projet", () => {
  const base = { ID2: "1", Type_doc: "COFFRAGE" };
  assert.equal(resolveDocumentCharge({ ...base, Duree_Projet: 2 }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Projet: 2, Duree_Zone: 3 }, COLS), 3);
  assert.equal(
    resolveDocumentCharge({ ...base, Duree_Projet: 2, Duree_Zone: 3, Duree_Force: 4 }, COLS),
    4
  );
  assert.equal(resolveDocumentCharge(base, COLS), null);
});

test("une valeur vide, nulle ou negative ne coupe pas la cascade", () => {
  const base = { ID2: "1", Type_doc: "COFFRAGE", Duree_Projet: 2 };
  // Un 0 explicite ne veut PAS dire « zero jour » : il laisse la main au niveau
  // du dessous. Pour dire « ce document ne coute rien », on laisse tout vide.
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: 0 }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: "" }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: null }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: -1 }, COLS), 2);
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: "bidon" }, COLS), 2);
  // Virgule decimale francaise, comme ailleurs dans le depot.
  assert.equal(resolveDocumentCharge({ ...base, Duree_Zone: "1,5" }, COLS), 1.5);
});

test("getDocumentWorkSpan suit le type de document", () => {
  // COFFRAGE : Date_limite -> Diff_coffrage
  const cof = getDocumentWorkSpan(
    { ID2: "3001", Type_doc: "COFFRAGE", Date_limite: "2026-12-29", Diff_coffrage: "2027-01-12" },
    COLS
  );
  assert.equal(cof.start.getMonth(), 11);
  assert.equal(cof.end.getMonth(), 0);

  // ARMATURES : Diff_coffrage -> Diff_armature
  const arm = getDocumentWorkSpan(
    { ID2: "3201", Type_doc: "ARMATURES", Diff_coffrage: "2027-02-02", Diff_armature: "2027-02-16" },
    COLS
  );
  assert.equal(arm.start.getDate(), 2);
  assert.equal(arm.end.getDate(), 16);

  // Aucune date -> aucune plage. C'est le cas de TOUTES les lignes COFFRAGE de
  // PRD et HOTEL DIEU dans l'export reel.
  assert.equal(getDocumentWorkSpan({ ID2: "1011", Type_doc: "COFFRAGE" }, COLS), null);
});

test("spreadChargeOverMonths repartit au prorata des jours ouvres", () => {
  // 24/08/2026 (lundi) -> 04/09/2026 (vendredi) : 6 jours ouvres en aout
  // (24-28 plus le lundi 31), 4 en septembre.
  const start = new Date(2026, 7, 24);
  const end = new Date(2026, 8, 4);

  // 5 j sur un partage 6/4 -> 3 j / 2 j. C'EST l'assertion qui prouve le
  // prorata : une implementation qui repartirait a parts EGALES rendrait
  // 2,5 / 2,5 et echouerait ici.
  assert.deepEqual([...spreadChargeOverMonths(5, start, end).entries()], [["2026-08", 3], ["2026-09", 2]]);

  // 2 j sur le meme partage -> 1 j / 1 j : le report au plus grand reliquat
  // (0,4 contre 0,6) donne le demi-jour restant a septembre.
  assert.deepEqual([...spreadChargeOverMonths(2, start, end).entries()], [["2026-08", 1], ["2026-09", 1]]);
});

test("la somme des parts vaut exactement la charge", () => {
  // 3 j sur une plage a repartition inegale : le report au plus grand reliquat
  // doit conserver le total au demi-jour pres.
  const spread = spreadChargeOverMonths(3, new Date(2026, 7, 26), new Date(2026, 8, 10));
  const sum = [...spread.values()].reduce((total, value) => total + value, 0);
  assert.equal(sum, 3);
  // Toutes les parts sont des multiples de 0,5.
  [...spread.values()].forEach((value) => {
    assert.equal(Math.abs(value * 2 - Math.round(value * 2)) < 1e-9, true);
  });
});

test("spreadChargeOverMonths ne plafonne PAS a la capacite du mois", () => {
  // La charge est une exigence, pas une allocation : 40 j demandes sur un mois
  // de 22 jours ouvres restent 40 j. C'est justement ce que la couleur signale.
  const spread = spreadChargeOverMonths(40, new Date(2026, 8, 1), new Date(2026, 8, 30));
  assert.equal(spread.get("2026-09"), 40);
});

test("un document realise compte toujours dans la charge", () => {
  // La ligne Charge repond a « combien de travail ce planning represente-t-il »,
  // pas « combien reste-t-il a faire » : un document reput realise garde sa
  // charge, sinon le total du mois s'effondrerait au fil de l'avancement et la
  // couleur virerait au vert sans qu'aucun jour n'ait ete libere.
  const cols = { ...COLS, realise: "Realise" };
  const row = {
    ID2: "3001", Type_doc: "COFFRAGE",
    Date_limite: "2026-09-01", Diff_coffrage: "2026-09-30",
    Duree_Projet: 2, Realise: true,
  };
  assert.equal(computeProjectCharge([row], cols).byMonth.get("2026-09"), 2);
});

test("un document deplace reprend la duree de sa nouvelle zone", () => {
  // Rien n'est « reassigne » : la cascade est resolue A LA LECTURE, donc changer
  // Zone ou Type_doc suffit a changer la charge. C'est tout le benefice de ne
  // jamais stocker la valeur resolue — il n'y a aucun code de migration a tenir.
  const doc = { ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Zone: 2 };
  assert.equal(resolveDocumentCharge(doc, COLS), 2);

  // Deplace en Zone 2, dont le COFFRAGE vaut 5 j. La fenetre ayant ecrit
  // Duree_Zone sur chaque ligne de la zone, le deplacement se traduit par la
  // reecriture de cette colonne — et rien d'autre a synchroniser.
  const moved = { ...doc, Zone: "Zone 2", Duree_Zone: 5 };
  assert.equal(resolveDocumentCharge(moved, COLS), 5);

  // Un document NEUF, sans Duree_Zone encore ecrite, retombe sur le defaut projet.
  const fresh = { ID2: "3002", Type_doc: "COFFRAGE", Zone: "Zone 2", Duree_Projet: 1 };
  assert.equal(resolveDocumentCharge(fresh, COLS), 1);
});

test("computeProjectCharge agrege, compte le non place et detecte la divergence", () => {
  const rows = [
    // En-tete de zone : ignoree.
    { id: 1, Zone: "Zone 1" },
    // Date : reparti sur un mois.
    { id: 2, ID2: "3001", Type_doc: "COFFRAGE", Zone: "Zone 1",
      Date_limite: "2026-09-01", Diff_coffrage: "2026-09-30", Duree_Projet: 2 },
    // Sans date : non place.
    { id: 3, ID2: "1011", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 2 },
    // Divergence sur (COFFRAGE) : 3 vs 2.
    { id: 4, ID2: "1021", Type_doc: "COFFRAGE", Zone: "Zone 1", Duree_Projet: 3 },
    // Sans aucune duree : ne compte pas.
    { id: 5, ID2: "3997", Type_doc: "NDC" },
  ];

  const result = computeProjectCharge(rows, COLS);

  assert.equal(result.byMonth.get("2026-09"), 2);
  assert.equal(result.unplacedDays, 5); // 2 (id 3) + 3 (id 4)
  assert.equal(result.totalDays, 7);

  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].scope, "project");
  assert.equal(result.divergences[0].typeDoc, "COFFRAGE");
  assert.equal(result.divergences[0].kept, 2); // 2 apparait 2 fois, 3 une fois
  assert.deepEqual(result.divergences[0].others.map((entry) => entry.id2), ["1021"]);
});

// Dette heritee de la Tache 1 (cf. task-4-brief.md « Debt you inherit ») : la
// branche `scope: "zone"` de collectDivergences n'etait exercee par aucun
// test — seule `scope: "project"` l'etait ci-dessus. La Tache 4 (fenetre
// d'assignation) est la consommatrice de cette donnee : c'est donc a elle de
// fermer le trou, pas a la Tache 1 qu'on ne rouvre pas.
test("computeProjectCharge signale une divergence de portee zone", () => {
  const rows = [
    // Meme type ET meme zone, Duree_Zone divergente : 2 lignes a 2, 1 a 5.
    { id: 1, ID2: "2001", Type_doc: "ARMATURES", Zone: "Zone 1", Duree_Zone: 2 },
    { id: 2, ID2: "2002", Type_doc: "ARMATURES", Zone: "Zone 1", Duree_Zone: 2 },
    { id: 3, ID2: "2003", Type_doc: "ARMATURES", Zone: "Zone 1", Duree_Zone: 5 },
    // Meme type, AUTRE zone : ne doit jamais se meler a la divergence ci-dessus.
    { id: 4, ID2: "2004", Type_doc: "ARMATURES", Zone: "Zone 2", Duree_Zone: 2 },
  ];

  const result = computeProjectCharge(rows, COLS);

  const zoneDivergence = result.divergences.find((entry) => entry.scope === "zone");
  assert.ok(zoneDivergence, "une divergence de portee zone doit etre remontee");
  assert.equal(zoneDivergence.typeDoc, "ARMATURES");
  assert.equal(zoneDivergence.zone, "Zone 1");
  assert.equal(zoneDivergence.kept, 2); // 2 apparait 2 fois, 5 une fois
  assert.deepEqual(zoneDivergence.others.map((entry) => entry.id2), ["2003"]);

  // Aucune divergence de portee project ici (Duree_Projet n'est jamais renseignee).
  assert.equal(result.divergences.some((entry) => entry.scope === "project"), false);
});
