// Chaine complete : lignes Grist -> dataService -> filtre de app.js -> matrice.
//
// POURQUOI CE FICHIER EXISTE : chaque maillon a ses tests unitaires, et ils
// etaient TOUS verts pendant que le widget affichait une matrice VIDE. Le
// defaut vivait dans le raccord — segmentOverlapsRange relisait startTime,
// supprime par le modele « un segment = un mois ». Seul un test qui traverse
// les trois modules d'un bout a l'autre epingle cette classe de panne.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildAbsencesByEmployee,
  buildEmployees,
  buildSegments,
  buildSegmentsByEmployee,
} from "../assets/js/dataService.js";
import { computeWeeklyUtilizationMatrix } from "../assets/js/utilizationService.js";
import { getMonthBounds } from "../assets/js/monthSegments.js";
import { getWeekRange, getWeeksGroupedByMonth } from "../assets/js/dateRange.js";
import { ABSENCE_TYPES } from "../assets/js/config.js";

// Le VRAI predicat de app.js, extrait de sa source (le module pilote le DOM et
// s'auto-demarre : il n'est pas importable sous `node --test`).
const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../assets/js/app.js", import.meta.url)),
  "utf8"
);
const extrait = APP_SOURCE.match(/^function segmentOverlapsRange\([\s\S]*?^\}/m);
assert.ok(extrait, "segmentOverlapsRange introuvable dans app.js : test a reparer");
// eslint-disable-next-line no-new-func -- source du depot, jamais une entree utilisateur
const segmentOverlapsRange = new Function(
  "getMonthBounds",
  `${extrait[0]}; return segmentOverlapsRange;`
)(getMonthBounds);

// --- Fixtures en forme Grist (colonnes -> tableaux) ---------------------------
const TEAM_TABLE = { id: [], Email: [], PrenomNom: [], Prenom: [], Nom: [], Service: [] };
const TEAM_ROWS = [
  { id: 1, Email: "jp.dupont@x.fr", PrenomNom: "Jean-Pierre DUPONT", Prenom: "Jean-Pierre", Nom: "DUPONT", Service: "Etudes" },
  { id: 2, Email: "m.martin@x.fr", PrenomNom: "Marie MARTIN", Prenom: "Marie", Nom: "MARTIN", Service: "Etudes" },
];
const SEGMENT_TABLE = { id: [], Name: [], Mois: [], Effectif: [], NumeroProjet: [] };
const SEGMENT_ROWS = [
  // Saisi SANS trait d'union, la ou Team en porte un : la jointure doit tenir
  // ET les conges suivre (c'est le pont absenceKey de la tache 7).
  { id: 1, Name: "Jean Pierre DUPONT", Mois: "2026-09-01", Effectif: 11, NumeroProjet: "25-0142" },
  { id: 2, Name: "Marie MARTIN", Mois: "2026-09-01", Effectif: 11, NumeroProjet: "25-0142" },
];
const TIME_OUT_TABLE = { id: [], Owner: [], Start_Date: [], Start_Period: [], End_Date: [], End_Period: [], Type: [] };
// Jean-Pierre pose la semaine 37 entiere (07 au 11 septembre 2026).
const TIME_OUT_ROWS = [
  { id: 1, Owner: "jp.dupont@x.fr", Start_Date: "2026-09-07", Start_Period: "am", End_Date: "2026-09-11", End_Period: "pm", Type: ABSENCE_TYPES[0] },
];
const PROJECTS = new Map([["25-0142", { number: "25-0142", name: "Tour A" }]]);

function buildMatrix() {
  const absencesByEmployee = buildAbsencesByEmployee(TIME_OUT_TABLE, TIME_OUT_ROWS, TEAM_TABLE, TEAM_ROWS);
  const employees = buildEmployees(TEAM_TABLE, TEAM_ROWS);
  const employeesByKey = new Map(employees.map((employee) => [employee.key, employee]));
  const segments = buildSegments(SEGMENT_TABLE, SEGMENT_ROWS, employeesByKey)
    .filter((segment) => employeesByKey.has(segment.employeeKey));

  const weeks = getWeeksGroupedByMonth(2026).flatMap((group) => group.weeks).map((week) => {
    const range = getWeekRange(week.value);
    return { ...week, range, startTime: range.start.getTime(), endTime: range.end.getTime() };
  });
  const vue = { start: weeks[0].range.start, end: weeks[weeks.length - 1].range.end };

  // Le filtre de app.js : c'est lui qui vidait la matrice.
  const visibles = segments.filter((segment) => segmentOverlapsRange(segment, vue));

  return {
    weeks,
    segments,
    visibles,
    matrix: computeWeeklyUtilizationMatrix({
      employees,
      segmentsByEmployee: buildSegmentsByEmployee(visibles),
      projects: PROJECTS,
      weeks,
      absencesByEmployee,
      visibleProjectNumbers: new Set(["25-0142"]),
    }),
  };
}

test("la matrice n'est pas vide : les segments mensuels traversent tout le chemin", () => {
  const { segments, visibles, matrix } = buildMatrix();

  assert.equal(segments.length, 2, "dataService n'a pas construit les segments");
  assert.equal(visibles.length, 2, "le filtre de app.js a ecarte des segments du mois affiche");
  assert.equal(matrix.length, 2, "matrice vide : la regression de la tache 7 est de retour");
  matrix.forEach((bloc) => {
    assert.equal(bloc.projectRows[0].projectLabel, "25-0142 - Tour A");
  });
});

test("la capacite reelle distingue deux collaborateurs du meme projet", () => {
  const { matrix } = buildMatrix();
  const parNom = new Map(matrix.map((bloc) => [bloc.employeeLabel, bloc.projectRows[0]]));

  const absent = parNom.get("Jean-Pierre DUPONT");
  const present = parNom.get("Marie MARTIN");
  assert.ok(absent && present, "un collaborateur manque a la matrice");

  // Marie : 11 j etales sur les 22 jours ouvres de septembre.
  assert.equal(Math.round(present.weekPercents["2026-W36"]), 40); // 4 j ouvres
  assert.equal(Math.round(present.weekPercents["2026-W37"]), 50); // 5 j ouvres
  assert.equal(present.weekStates["2026-W37"], "");

  // Jean-Pierre : semaine 37 entierement posee, donc capacite nulle...
  assert.equal(absent.weekStates["2026-W37"], "leave");
  // ...et les 11 memes jours a caser sur 17 jours disponibles : il est PLUS
  // charge que Marie sur chaque semaine travaillee, pas moins.
  assert.equal(Math.round(absent.weekPercents["2026-W38"]), 65);
  assert.ok(
    absent.weekPercents["2026-W38"] > present.weekPercents["2026-W38"],
    "le conge n'a pas reduit la capacite : les deux affichent le meme pourcentage"
  );
});

test("l'effectif mensuel est conserve pour les deux collaborateurs", () => {
  const { weeks, matrix } = buildMatrix();
  const septembre = weeks.filter((week) => week.value >= "2026-W36" && week.value <= "2026-W40");

  matrix.forEach((bloc) => {
    const row = bloc.projectRows[0];
    // La capacite se relit depuis le pourcentage : jours = % x capacite / 100.
    // Pour la semaine a capacite nulle la charge vaut 0 par construction.
    const capacites = { "2026-W36": 5, "2026-W37": 5, "2026-W38": 5, "2026-W39": 5, "2026-W40": 5 };
    const capaciteReelle = bloc.employeeLabel === "Jean-Pierre DUPONT"
      ? { ...capacites, "2026-W37": 0 }
      : capacites;

    const jours = septembre.reduce(
      (somme, week) => somme + (row.weekPercents[week.value] / 100) * capaciteReelle[week.value],
      0
    );
    assert.ok(
      Math.abs(jours - 11) < 1e-9,
      `${bloc.employeeLabel} : ${jours} jours reconstitues au lieu de 11`
    );
  });
});
