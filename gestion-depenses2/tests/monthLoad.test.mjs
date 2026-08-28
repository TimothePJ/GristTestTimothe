import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMonthLoad, parseEffectifDays } from "../assets/js/utils/monthLoad.js";

// Colonnes telles que les deux widgets les declarent dans config.js.
const COLS = { mois: "Mois", startDate: "Start_At", name: "Name", effectif: "Effectif" };

// Septembre 2026 : 30 jours, 8 de week-end, aucun ferie => 22 jours ouvres.
const MONTH = "2026-09";
const AVAILABLE = 22;

function segment(id, name, effectif, extra = {}) {
  return { id, Mois: "2026-09-01", Name: name, Effectif: effectif, ...extra };
}

// Toutes les demi-journees ouvrees de septembre 2026 : la personne est en conge
// tout le mois, sa disponibilite tombe a 0.
function fullMonthAbsence() {
  const set = new Set();
  for (let day = 1; day <= 30; day += 1) {
    const key = `2026-09-${String(day).padStart(2, "0")}`;
    set.add(`${key}:am`);
    set.add(`${key}:pm`);
  }
  return set;
}

function load(overrides = {}) {
  return computeMonthLoad({
    monthKey: MONTH,
    personName: "Marie Dupont",
    allSegmentRows: [],
    columns: COLS,
    absenceSet: null,
    excludeSegmentId: null,
    draftEffectif: null,
    ...overrides,
  });
}

test("la charge additionne TOUS les projets et TOUS les services de la personne", () => {
  const rows = [
    segment(1, "Marie Dupont", 5, { NumeroProjet: "P-001", Service: "Structure" }),
    segment(2, "Marie Dupont", 3, { NumeroProjet: "P-002", Service: "Fluides" }),
  ];
  const result = load({ allSegmentRows: rows, draftEffectif: 5 });

  assert.equal(result.availableDays, AVAILABLE);
  assert.equal(result.otherDays, 8);
  assert.equal(result.draftDays, 5);
  assert.equal(result.totalDays, 13);
  assert.equal(result.state, "partial");
  assert.equal(result.remainingDays, 9);
  assert.equal(result.overloadDays, 0);
  assert.ok(Math.abs(result.ratio - 13 / 22) < 1e-9, `ratio attendu 13/22, obtenu ${result.ratio}`);
});

test("state vaut balanced a la frontiere EXACTE des 100 %", () => {
  const rows = [segment(1, "Marie Dupont", 8, { NumeroProjet: "P-001" })];
  const result = load({ allSegmentRows: rows, draftEffectif: 14 });

  assert.equal(result.totalDays, 22);
  assert.equal(result.state, "balanced");
  assert.equal(result.remainingDays, 0);
  assert.equal(result.overloadDays, 0);
  assert.equal(result.ratio, 1);
});

test("un demi-jour au-dessus des 100 % bascule en overload", () => {
  const rows = [segment(1, "Marie Dupont", 8)];
  const result = load({ allSegmentRows: rows, draftEffectif: 14.5 });

  assert.equal(result.totalDays, 22.5);
  assert.equal(result.state, "overload");
  assert.equal(result.overloadDays, 0.5);
  assert.equal(result.remainingDays, 0);
  assert.ok(result.ratio > 1);
});

test("un demi-jour sous les 100 % reste partial", () => {
  const rows = [segment(1, "Marie Dupont", 8)];
  const result = load({ allSegmentRows: rows, draftEffectif: 13.5 });

  assert.equal(result.totalDays, 21.5);
  assert.equal(result.state, "partial");
  assert.equal(result.remainingDays, 0.5);
  assert.equal(result.overloadDays, 0);
});

test("la frontiere resiste a la derive des flottants", () => {
  // 0.1 + 16.1 + 5.8 ne vaut PAS 22 en binaire : sans tolerance, ce cas
  // basculerait a tort en overload.
  assert.notEqual(0.1 + 16.1 + 5.8, 22);
  const rows = [segment(1, "Marie Dupont", 0.1), segment(2, "Marie Dupont", 16.1)];
  const result = load({ allSegmentRows: rows, draftEffectif: 5.8 });

  assert.equal(result.state, "balanced");
  assert.equal(result.remainingDays, 0);
  assert.equal(result.overloadDays, 0);
});

test("les absences reduisent le denominateur, pas la charge saisie", () => {
  // Trois demi-journees d'absence => 22 - 1.5 = 20.5 jours disponibles.
  const absences = new Set(["2026-09-01:am", "2026-09-01:pm", "2026-09-02:am"]);
  const rows = [segment(1, "Marie Dupont", 20)];
  const result = load({ allSegmentRows: rows, absenceSet: absences, draftEffectif: 0.5 });

  assert.equal(result.availableDays, 20.5);
  assert.equal(result.totalDays, 20.5);
  assert.equal(result.state, "balanced");
});

test("le segment en cours d'edition n'est jamais compte deux fois", () => {
  const rows = [segment(42, "Marie Dupont", 6), segment(7, "Marie Dupont", 4)];
  const result = load({ allSegmentRows: rows, excludeSegmentId: 42, draftEffectif: 9 });

  assert.equal(result.otherDays, 4);
  assert.equal(result.totalDays, 13);
});

test("excludeSegmentId compare nombre et chaine indifferemment", () => {
  const rows = [segment(42, "Marie Dupont", 6), segment("7", "Marie Dupont", 4)];

  // id numerique dans la ligne, chaine dans la fenetre
  assert.equal(load({ allSegmentRows: rows, excludeSegmentId: "42" }).otherDays, 4);
  // id chaine dans la ligne, nombre dans la fenetre
  assert.equal(load({ allSegmentRows: rows, excludeSegmentId: 7 }).otherDays, 6);
  // creation : aucun segment exclu
  assert.equal(load({ allSegmentRows: rows, excludeSegmentId: null }).otherDays, 10);
});

test("un mois sans aucune disponibilite rend toute charge surchargee, sans Infinity ni NaN", () => {
  const result = load({ absenceSet: fullMonthAbsence(), draftEffectif: 1 });

  assert.equal(result.availableDays, 0);
  assert.equal(result.totalDays, 1);
  assert.equal(result.state, "overload");
  assert.equal(result.overloadDays, 1);
  assert.equal(result.remainingDays, 0);
  // Choix documente : la barre est pleine (ratio sature a 1), jamais Infinity.
  assert.equal(result.ratio, 1);
  assert.ok(Number.isFinite(result.ratio));
});

test("un mois sans disponibilite et sans charge reste a l'equilibre, ratio 0", () => {
  const result = load({ absenceSet: fullMonthAbsence(), draftEffectif: "" });

  assert.equal(result.availableDays, 0);
  assert.equal(result.totalDays, 0);
  assert.equal(result.state, "balanced");
  assert.equal(result.ratio, 0);
  assert.ok(Number.isFinite(result.ratio));
});

test("les prenoms composes ne sont pas confondus avec leur variante espacee", () => {
  const rows = [
    segment(1, "Jean-Pierre Martin", 5),
    segment(2, "Jean Pierre Martin", 4),
  ];

  assert.equal(load({ allSegmentRows: rows, personName: "Jean-Pierre Martin" }).otherDays, 5);
  assert.equal(load({ allSegmentRows: rows, personName: "Jean Pierre Martin" }).otherDays, 4);
});

test("l'appariement des noms ignore accents, casse et espaces surnumeraires", () => {
  const rows = [segment(1, "  ELOÏSE   Le Goff ", 3)];
  assert.equal(load({ allSegmentRows: rows, personName: "eloise le goff" }).otherDays, 3);
});

test("une autre personne ou un autre mois ne pese jamais sur le total", () => {
  const rows = [
    segment(1, "Marie Dupont", 5),
    segment(2, "Karim Benali", 8),
    { id: 3, Mois: "2026-10-01", Name: "Marie Dupont", Effectif: 7 },
  ];
  assert.equal(load({ allSegmentRows: rows }).otherDays, 5);
});

test("un Effectif en chaine a virgule francaise est lu comme un nombre", () => {
  const rows = [segment(1, "Marie Dupont", "7,5"), segment(2, "Marie Dupont", " 2,5 ")];
  const result = load({ allSegmentRows: rows, draftEffectif: "3,5" });

  assert.equal(result.otherDays, 10);
  assert.equal(result.draftDays, 3.5);
  assert.equal(result.totalDays, 13.5);
});

test("une ligne dont le mois ne se resout pas est ignoree", () => {
  const rows = [
    segment(1, "Marie Dupont", 5),
    { id: 2, Mois: "", Start_At: "", Name: "Marie Dupont", Effectif: 9 },
    { id: 3, Mois: "bidon", Name: "Marie Dupont", Effectif: 9 },
    { id: 4, Name: "Marie Dupont", Effectif: 9 },
  ];
  assert.equal(load({ allSegmentRows: rows }).otherDays, 5);
});

test("une ligne legacy sans Mois retombe sur Start_At", () => {
  const rows = [
    { id: 1, Start_At: "2026-09-17", Name: "Marie Dupont", Effectif: 4 },
    { id: 2, Mois: "", Start_At: "2026-10-05", Name: "Marie Dupont", Effectif: 9 },
  ];
  assert.equal(load({ allSegmentRows: rows }).otherDays, 4);
});

test("une saisie vide, nulle, nulle-valeur ou illisible vaut 0 jour", () => {
  for (const draft of [null, undefined, "", "   ", 0, "0", "abc", NaN, Infinity, -3]) {
    const result = load({ draftEffectif: draft });
    assert.equal(result.draftDays, 0, `draftEffectif=${String(draft)}`);
    assert.equal(result.totalDays, 0);
    assert.equal(result.state, "partial");
  }
});

test("le module survit a des entrees absentes ou aberrantes", () => {
  const empty = computeMonthLoad();
  assert.equal(empty.availableDays, 0);
  assert.equal(empty.totalDays, 0);
  assert.ok(Number.isFinite(empty.ratio));

  assert.equal(load({ allSegmentRows: null }).otherDays, 0);
  assert.equal(load({ allSegmentRows: [null, undefined] }).otherDays, 0);
  assert.equal(load({ monthKey: "bidon", draftEffectif: 3 }).availableDays, 0);
  assert.equal(load({ personName: "   " }).otherDays, 0);
});

test("l'id de ligne peut venir d'une colonne declaree", () => {
  const rows = [
    { rowId: 42, Mois: "2026-09-01", Name: "Marie Dupont", Effectif: 6 },
    { rowId: 7, Mois: "2026-09-01", Name: "Marie Dupont", Effectif: 4 },
  ];
  const columns = { ...COLS, id: "rowId" };
  assert.equal(load({ allSegmentRows: rows, columns, excludeSegmentId: 42 }).otherDays, 4);
});

test("parseEffectifDays normalise les formes rencontrees dans Grist", () => {
  assert.equal(parseEffectifDays(7.5), 7.5);
  assert.equal(parseEffectifDays("7,5"), 7.5);
  assert.equal(parseEffectifDays("7.5"), 7.5);
  assert.equal(parseEffectifDays(null), 0);
  assert.equal(parseEffectifDays(""), 0);
  assert.equal(parseEffectifDays("bidon"), 0);
  assert.equal(parseEffectifDays(Infinity), 0);
});
