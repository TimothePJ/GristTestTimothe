// Tests du modele des taches du graphique (top/taskLoadModel.js) et des
// libelles partages (top/taskLabels.js).
//
// buildChartTasks ne relit PAS les colonnes brutes de Planning_Projet : il
// prend ses taches dans la sortie du constructeur vendorise (la meme que celle
// qui dessine les barres du planning). Chaque test part donc d'une ligne
// Planning_Projet brute et verifie la date de FIN de la barre dessinee (les
// dates sont recalculees : MS Project, plus petite Diff_coffrage du groupe,
// debut = fin - Duree_1 semaines...), pas la valeur stockee.
//
// Toutes les dates sont en 2027 (apres la date du jour), donc les barres sont
// entieres ; le suffixe -past / -current des barres coupees au jour est couvert
// par le test « barre coupee au jour ».

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChartTasks } from "../assets/js/top/taskLoadModel.js";
import {
  TYPE_ORDER,
  TYPE_META,
  TOTAL_META,
  formatMonthLabel,
  formatDateFr,
} from "../assets/js/top/taskLabels.js";

const PROJECT = "P1";

// Ligne brute du projet P1 : on ne saisit que les colonnes utiles au test.
function row(fields) {
  return { NomProjet: PROJECT, ...fields };
}

function tasksOf(rows, options = {}) {
  return buildChartTasks(rows, { project: PROJECT, ...options });
}

test("coffrage lié à MS Project : échéance = démarrage − Duree_3", () => {
  const tasks = tasksOf([
    row({
      id: 1,
      ID2: "10",
      Taches: "COF LIE",
      Type_doc: "COFFRAGE",
      Zone: "A",
      Ligne_planning: "12",
      Demarrages_travaux: "2027-06-01",
      Duree_3: 4,
      Duree_1: 3,
      Date_limite: "2027-01-01",
      Diff_coffrage: "2027-02-01",
    }),
  ]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].rowId, 1);
  assert.equal(tasks[0].type, "COFFRAGE");
  assert.equal(tasks[0].dueIso, "2027-05-04");
  // Les autres champs viennent du groupe du constructeur.
  assert.equal(tasks[0].id2, "10");
  assert.equal(tasks[0].name, "COF LIE");
  assert.equal(tasks[0].zone, "A");
});

test("coffrage de groupe : échéance = plus petite Diff_coffrage des armatures", () => {
  const tasks = tasksOf([
    row({
      id: 2,
      ID2: "20",
      Type_doc: "COFFRAGE",
      Zone: "B",
      Groupe: "1",
      Date_limite: "2027-01-01",
      Diff_coffrage: "2027-03-15",
      Duree_1: 2,
    }),
    row({
      id: 3,
      ID2: "21",
      Type_doc: "ARMATURES",
      Zone: "B",
      Groupe: "1",
      Diff_coffrage: "2027-02-10",
      Diff_armature: "2027-02-24",
    }),
    row({
      id: 4,
      ID2: "22",
      Type_doc: "ARMATURES",
      Zone: "B",
      Groupe: "1",
      Diff_coffrage: "2027-02-17",
      Diff_armature: "2027-03-03",
    }),
  ]);

  assert.deepEqual(
    tasks.map((t) => [t.rowId, t.type, t.dueIso]),
    [
      [2, "COFFRAGE", "2027-02-10"],
      [3, "ARMATURES", "2027-02-24"],
      [4, "ARMATURES", "2027-03-03"],
    ]
  );
  // Les trois lignes sont du meme groupe (zone + groupe).
  const keys = new Set(tasks.map((t) => t.groupKey));
  assert.equal(keys.size, 1);
  assert.notEqual(tasks[0].groupKey, "");
  assert.equal(tasks[0].groupe, "1");
});

test("NDC sans Date_limite mais avec Duree_1 : comptée", () => {
  const tasks = tasksOf([
    row({ id: 5, ID2: "30", Type_doc: "NDC", Duree_1: 1, Diff_coffrage: "2027-03-01" }),
  ]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].type, "NDC");
  assert.equal(tasks[0].dueIso, "2027-03-01");
  // Un NDC n'appartient a aucun groupe coffrage / armatures.
  assert.equal(tasks[0].groupKey, "");
});

test("ligne sans type et type « Armature » au singulier : exclues", () => {
  const tasks = tasksOf([
    row({ id: 6, Taches: "X", Demarrages_travaux: "2027-01-01" }),
    row({
      id: 10,
      Type_doc: "Armature",
      Diff_coffrage: "2027-02-01",
      Diff_armature: "2027-02-15",
    }),
  ]);

  assert.deepEqual(tasks, []);
});

test("type personnalisé → AUTRES", () => {
  const tasks = tasksOf([
    row({
      id: 7,
      ID2: "40",
      Type_doc: "PLAN SPECIAL",
      Date_limite: "2027-05-01",
      Diff_coffrage: "2027-05-15",
    }),
  ]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].type, "AUTRES");
  assert.equal(tasks[0].dueIso, "2027-05-15");
});

test("types COUPES et DEMOLITION reconnus", () => {
  const tasks = tasksOf([
    row({ id: 11, ID2: "70", Type_doc: "COUPES", Date_limite: "2027-05-01", Diff_coffrage: "2027-05-10" }),
    row({ id: 12, ID2: "71", Type_doc: "DEMOLITION", Date_limite: "2027-05-01", Diff_coffrage: "2027-05-12" }),
  ]);

  assert.deepEqual(
    tasks.map((t) => [t.rowId, t.type]),
    [
      [11, "COUPES"],
      [12, "DEMOLITION"],
    ]
  );
});

test("réalisé = état de la barre, pas la colonne Realise", () => {
  const tasks = tasksOf([
    // Indice A atteint la cible par defaut (A pour un coffrage) : barre realisee,
    // alors que la colonne stockee dit 0.
    row({
      id: 8,
      ID2: "50",
      Type_doc: "COFFRAGE",
      Zone: "C",
      Date_limite: "2027-04-01",
      Diff_coffrage: "2027-04-20",
      Indice: "A",
      Realise: "0",
    }),
    // La colonne stockee dit 100, mais aucun indice : la barre n'est pas realisee.
    row({
      id: 9,
      ID2: "60",
      Type_doc: "NDC",
      Date_limite: "2027-04-01",
      Diff_coffrage: "2027-04-10",
      Realise: "100",
    }),
  ]);

  const byRow = new Map(tasks.map((t) => [t.rowId, t]));
  assert.equal(byRow.get(8).realized, true);
  assert.equal(byRow.get(9).realized, false);
});

test("barre coupée au jour : une seule tâche, échéance = fin de la barre", () => {
  const today = new Date();
  const iso = (offsetDays) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Debut dans le passe, fin dans le futur : le constructeur coupe la barre en
  // deux items (-past / -current) qui portent la meme fin metier.
  const tasks = tasksOf([
    row({
      id: 13,
      ID2: "80",
      Type_doc: "COFFRAGE",
      Date_limite: iso(-10),
      Diff_coffrage: iso(20),
    }),
  ]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].dueIso, iso(20));
});

test("autre projet ignoré", () => {
  const tasks = tasksOf([
    row({ id: 1, ID2: "10", Type_doc: "NDC", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-10" }),
    {
      id: 2,
      NomProjet: "P2",
      ID2: "11",
      Type_doc: "NDC",
      Date_limite: "2027-04-01",
      Diff_coffrage: "2027-04-10",
    },
  ]);

  assert.deepEqual(
    tasks.map((t) => t.rowId),
    [1]
  );
});

test("ordre : par échéance, puis ID2 numérique, puis rowId", () => {
  const ndc = (id, id2, due) =>
    row({ id, ID2: id2, Type_doc: "NDC", Date_limite: "2027-01-01", Diff_coffrage: due });
  const tasks = tasksOf([
    ndc(1, "10", "2027-04-10"),
    ndc(2, "9", "2027-04-10"),
    ndc(3, "5", "2027-04-20"),
    ndc(4, "100", "2027-03-01"),
    // Meme echeance, meme ID2 : le rowId departage.
    ndc(6, "7", "2027-05-01"),
    ndc(5, "7", "2027-05-01"),
  ]);

  assert.deepEqual(
    tasks.map((t) => [t.dueIso, t.id2, t.rowId]),
    [
      ["2027-03-01", "100", 4],
      ["2027-04-10", "9", 2],
      ["2027-04-10", "10", 1],
      ["2027-04-20", "5", 3],
      ["2027-05-01", "7", 5],
      ["2027-05-01", "7", 6],
    ]
  );
});

test("targetLookup transmis au constructeur (indice cible du projet)", () => {
  const lines = [
    row({
      id: 14,
      ID2: "90",
      Type_doc: "COFFRAGE",
      Date_limite: "2027-04-01",
      Diff_coffrage: "2027-04-20",
      Indice: "A",
    }),
  ];
  // Cible A par defaut : realisee.
  assert.equal(tasksOf(lines)[0].realized, true);
  // Cible B pour les coffrages du projet P1 (table projet -> type -> indice, cle
  // de projet en minuscules, comme buildProjectRealisationTargetLookup) : A ne suffit plus.
  const lookup = new Map([["p1", new Map([["COFFRAGE", "B"]])]]);
  assert.equal(tasksOf(lines, { targetLookup: lookup })[0].realized, false);
});

// Pourcentage d'avancement : celui de la colonne « Réalisé » de Planning Projet
// (indice du document face a l'indice cible du projet, 100 en cloture forcee).
test("avancement : pourcentage et clôture forcée, comme Planning Projet", () => {
  const lines = [
    row({ id: 20, ID2: "90", Type_doc: "COFFRAGE", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20", Indice: "A" }),
    row({ id: 21, ID2: "91", Type_doc: "COFFRAGE", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20", Indice: "0" }),
    row({ id: 22, ID2: "92", Type_doc: "NDC", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20" }),
    row({ id: 23, ID2: "93", Type_doc: "NDC", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20", Date_Cloture: "2026-05-12" }),
  ];
  const lookup = new Map([["p1", new Map([["COFFRAGE", "B"]])]]);
  const byRow = new Map(tasksOf(lines, { targetLookup: lookup }).map((t) => [t.rowId, t]));
  assert.deepEqual(
    [20, 21, 22, 23].map((id) => [byRow.get(id).progress, byRow.get(id).closureLabel, byRow.get(id).realized]),
    [
      [67, "", false],
      [33, "", false],
      [0, "", false],
      [100, "12/05/2026", true],
    ]
  );
});

test("liste vide : sans ligne, sans projet", () => {
  assert.deepEqual(buildChartTasks([], { project: PROJECT }), []);
  assert.deepEqual(buildChartTasks(null, { project: PROJECT }), []);
  assert.deepEqual(
    buildChartTasks([row({ id: 1, Type_doc: "NDC", Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" })], {
      project: "",
    }),
    []
  );
});

test("libellés : TYPE_ORDER, TYPE_META, TOTAL_META", () => {
  assert.deepEqual(TYPE_ORDER, ["COFFRAGE", "ARMATURES", "NDC", "COUPES", "DEMOLITION", "AUTRES"]);
  assert.deepEqual(Object.keys(TYPE_META), TYPE_ORDER);
  assert.deepEqual(TYPE_META.COFFRAGE, { label: "Coffrage", color: "#d97706" });
  assert.deepEqual(TYPE_META.AUTRES, { label: "Autres", color: "#8470ff" });
  assert.deepEqual(TOTAL_META, { label: "Total", color: "#004990" });
});

test("formatMonthLabel : mois en toutes lettres, accentués", () => {
  assert.equal(formatMonthLabel("2027-08"), "août 2027");
  assert.equal(formatMonthLabel("2027-02"), "février 2027");
  assert.equal(formatMonthLabel("2027-12"), "décembre 2027");
  assert.equal(formatMonthLabel("2027-01"), "janvier 2027");
  assert.equal(formatMonthLabel("2027-04"), "avril 2027");
  assert.equal(formatMonthLabel("n'importe quoi"), "");
  assert.equal(formatMonthLabel("2027-13"), "");
});

test("formatDateFr : AAAA-MM-JJ → JJ/MM/AAAA", () => {
  assert.equal(formatDateFr("2027-03-05"), "05/03/2027");
  assert.equal(formatDateFr(""), "");
  assert.equal(formatDateFr("pas une date"), "");
});
