import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAbsencesByEmployee,
  buildEmployees,
  buildSegments,
  buildSegmentsByEmployee,
  fetchTimeOutRows,
} from "../assets/js/dataService.js";
import { ABSENCE_TYPES, COLUMN_CANDIDATES } from "../assets/js/config.js";
import { buildAbsenceIndex, normalizeName } from "../assets/js/leaveAbsences.js";
import { tableToRows } from "../assets/js/utils.js";

const TABLE = { id: [], Name: [], Mois: [], Effectif: [], NumeroProjet: [] };

test("buildSegments produit des segments mensuels", () => {
  const [segment] = buildSegments(TABLE, [
    { id: 1, Name: "Marie DUPONT", Mois: "2026-09-01", Effectif: 8, NumeroProjet: "25-0142" },
  ]);
  assert.equal(segment.monthKey, "2026-09");
  assert.equal(segment.effectif, 8);
  assert.equal(segment.projectNumber, "25-0142");
});

test("buildSegments ignore les lignes sans mois ou sans effectif", () => {
  assert.equal(buildSegments(TABLE, [{ Name: "X", Effectif: 8 }]).length, 0);
  assert.equal(buildSegments(TABLE, [{ Name: "X", Mois: "2026-09-01" }]).length, 0);
  assert.equal(buildSegments(TABLE, [{ Name: "X", Mois: "2026-09-01", Effectif: 0 }]).length, 0);
});

test("buildSegments porte une absenceKey qui preserve les traits d'union", () => {
  const [segment] = buildSegments(TABLE, [
    { Name: "Jean-Pierre DUPONT", Mois: "2026-09-01", Effectif: 4 },
  ]);
  // La cle interne ecrase la ponctuation, celle d'absence non : les deux doivent
  // coexister, sinon les conges des prenoms composes seraient ignores.
  assert.equal(segment.employeeKey, "jean pierre dupont");
  assert.equal(segment.absenceKey, "jean-pierre dupont");
});

// --- Regression : la valeur de `Mois` doit traverser le chemin de lecture Grist ---
// Le widget jumeau gestion-depenses2 reconstruisait chaque ligne a partir d'une
// liste blanche de colonnes codee en dur, si bien que `Mois` n'atteignait jamais
// le code metier. Ici tableToRows est generique : ce test verrouille ce contrat.
test("Mois traverse tableToRows puis buildSegments sans etre filtre", () => {
  const gristTable = {
    id: [1],
    Name: ["Marie DUPONT"],
    Mois: ["2026-09-01"],
    Effectif: [8],
    NumeroProjet: ["25-0142"],
    Start_At: [null],
  };

  const rows = tableToRows(gristTable);
  assert.equal(rows[0].Mois, "2026-09-01", "tableToRows a perdu la colonne Mois");

  const [segment] = buildSegments(gristTable, rows);
  assert.equal(segment.monthKey, "2026-09");
});

// --- Fixtures Time-Out / Team pour l'index d'absences ---
// 2026-09-07 est un lundi et 2026-09-08 un mardi : 4 demi-journees ouvrees.
const TEAM_TABLE = { id: [], Email: [], PrenomNom: [], Prenom: [], Nom: [], Service: [] };
const TEAM_ROWS = [
  {
    id: 1,
    Email: "jp.dupont@example.com",
    PrenomNom: "Jean-Pierre DUPONT",
    Prenom: "Jean-Pierre",
    Nom: "DUPONT",
    Service: "Etudes",
  },
];
const TIME_OUT_TABLE = {
  id: [],
  Owner: [],
  Start_Date: [],
  Start_Period: [],
  End_Date: [],
  End_Period: [],
  Type: [],
};
const TIME_OUT_ROWS = [
  {
    id: 1,
    Owner: "JP.Dupont@example.com",
    Start_Date: "2026-09-07",
    Start_Period: "am",
    End_Date: "2026-09-08",
    End_Period: "pm",
    Type: ABSENCE_TYPES[0],
  },
];

test("buildAbsencesByEmployee indexe les conges sous l'absenceKey des segments", () => {
  const absences = buildAbsencesByEmployee(
    TIME_OUT_TABLE,
    TIME_OUT_ROWS,
    TEAM_TABLE,
    TEAM_ROWS
  );

  const [segment] = buildSegments(TABLE, [
    { Name: "Jean-Pierre DUPONT", Mois: "2026-09-01", Effectif: 4 },
  ]);

  // Le pont entre les deux normalisations : la cle de l'index est celle du segment.
  const slots = absences.get(segment.absenceKey);
  assert.ok(slots, "aucune absence indexee pour l'absenceKey du segment");
  assert.equal(slots.size, 4);
  assert.ok(slots.has("2026-09-07:am"));
  assert.ok(slots.has("2026-09-08:pm"));
});

// --- Preuve que l'adaptateur de colonnes Team est indispensable ---
// buildAbsenceIndex lit teamCols.prenomNom / prenom / nom / email ; les
// candidats de ce widget se nomment fullName / firstName / lastName / email.
// Passer resolveColumns(teamTable, COLUMN_CANDIDATES.team) tel quel ne resout
// aucun owner : l'index sort vide, sans la moindre erreur.
test("sans adaptateur, buildAbsenceIndex ignore silencieusement toutes les absences", () => {
  // Cause racine : les candidats Team de ce widget n'exposent aucun des noms
  // que buildAbsenceIndex va chercher.
  for (const attendu of ["prenomNom", "prenom", "nom"]) {
    assert.ok(
      !(attendu in COLUMN_CANDIDATES.team),
      `COLUMN_CANDIDATES.team expose maintenant ${attendu} : l'adaptateur est peut-etre devenu inutile, revoir ce test`
    );
  }

  // Exactement ce que renverrait resolveColumns(TEAM_TABLE, COLUMN_CANDIDATES.team).
  const naiveTeamCols = {
    email: "Email",
    fullName: "PrenomNom",
    firstName: "Prenom",
    lastName: "Nom",
  };
  const naiveTimeOutCols = {
    owner: "Owner",
    startDate: "Start_Date",
    startPeriod: "Start_Period",
    endDate: "End_Date",
    endPeriod: "End_Period",
    type: "Type",
  };

  const naiveIndex = buildAbsenceIndex(
    TIME_OUT_ROWS,
    TEAM_ROWS,
    naiveTimeOutCols,
    naiveTeamCols,
    ABSENCE_TYPES
  );
  // Echec silencieux : owner resolu, mais aucun nom lisible => index vide.
  assert.equal(naiveIndex.size, 0, "l'index naif devrait etre vide : le test ne prouve plus rien");

  const adapted = buildAbsencesByEmployee(
    TIME_OUT_TABLE,
    TIME_OUT_ROWS,
    TEAM_TABLE,
    TEAM_ROWS
  );
  assert.equal(adapted.size, 1);
  assert.ok(adapted.has(normalizeName("Jean-Pierre DUPONT")));
});

// =====================================================================
// C2 — buildEmployees est le SITE D'ORIGINE de l'absenceKey.
// L'index d'absences est bati sur les lignes Team ; c'est donc la fiche
// employe qui doit porter la cle sensible a la ponctuation. Sans ce test,
// remplacer normalizeName par normalizePersonName ici passait inapercu.
// =====================================================================
test("buildEmployees derive l'absenceKey avec normalizeName, pas normalizePersonName", () => {
  const [employee] = buildEmployees(TEAM_TABLE, TEAM_ROWS);

  assert.equal(employee.key, "jean pierre dupont");
  assert.equal(employee.absenceKey, "jean-pierre dupont");

  // La cle de l'employe doit ouvrir l'index d'absences : c'est tout l'objet
  // de cette seconde cle.
  const absences = buildAbsencesByEmployee(TIME_OUT_TABLE, TIME_OUT_ROWS, TEAM_TABLE, TEAM_ROWS);
  assert.equal(absences.get(employee.absenceKey)?.size, 4);
});

// =====================================================================
// C1 — l'absenceKey d'un segment est HERITEE de Team, jamais recalculee
// sur TimeSegment.Name.
// La jointure segment->employe (normalizePersonName) ignore la ponctuation,
// la jointure segment->absences (normalizeName) y est sensible. Un segment
// mal orthographie est donc retenu, mais perdrait ses conges en silence si
// sa cle etait derivee de son propre texte.
// =====================================================================
test("absenceKey heritee de Team malgre une orthographe divergente du segment", () => {
  const employees = buildEmployees(TEAM_TABLE, TEAM_ROWS);
  const employeesByKey = new Map(employees.map((employee) => [employee.key, employee]));

  // Team fait autorite : "Jean-Pierre DUPONT". Le segment est saisi sans tiret.
  const [segment] = buildSegments(
    TABLE,
    [{ Name: "Jean Pierre DUPONT", Mois: "2026-09-01", Effectif: 4 }],
    employeesByKey
  );

  assert.equal(segment.employeeKey, "jean pierre dupont", "le segment doit rester apparie");
  assert.equal(
    segment.absenceKey,
    "jean-pierre dupont",
    "absenceKey recalculee sur le nom du segment : les conges seraient perdus"
  );

  // La preuve qui compte : les conges sont bien retrouves.
  const absences = buildAbsencesByEmployee(TIME_OUT_TABLE, TIME_OUT_ROWS, TEAM_TABLE, TEAM_ROWS);
  assert.equal(absences.get(segment.absenceKey)?.size, 4);
});

test("absenceKey vide quand le segment n'est apparie a aucun employe", () => {
  const [segment] = buildSegments(
    TABLE,
    [{ Name: "Inconnu SANSFICHE", Mois: "2026-09-01", Effectif: 4 }],
    new Map()
  );

  // Mieux vaut aucune absence qu'une cle devinee.
  assert.equal(segment.absenceKey, "");
});

// =====================================================================
// I1 — repli legacy sur Start_At.
// =====================================================================
const TABLE_LEGACY = { id: [], Name: [], Mois: [], Start_At: [], Effectif: [] };

test("repli legacy : Start_At fait foi quand Mois est vide", () => {
  const [texte] = buildSegments(TABLE_LEGACY, [
    { Name: "Marie DUPONT", Mois: "", Start_At: "2026-03-15", Effectif: 2 },
  ]);
  assert.equal(texte.monthKey, "2026-03");

  // Grist stocke une colonne Date en epoch SECONDES.
  const [epoch] = buildSegments(TABLE_LEGACY, [
    { Name: "Marie DUPONT", Mois: "", Start_At: 1772409600, Effectif: 2 },
  ]);
  assert.equal(epoch.monthKey, "2026-03");
});

test("Mois l'emporte sur Start_At quand les deux sont presents", () => {
  const [segment] = buildSegments(TABLE_LEGACY, [
    { Name: "Marie DUPONT", Mois: "2026-09-01", Start_At: "2026-03-15", Effectif: 2 },
  ]);
  assert.equal(segment.monthKey, "2026-09");
});

test("repli legacy inerte, sans erreur, quand la colonne Start_At a disparu", () => {
  // TABLE ne declare pas Start_At : la cellule vaut "" et le repli ne leve rien.
  assert.doesNotThrow(() => buildSegments(TABLE, [{ Name: "X", Effectif: 8 }]));
  assert.equal(buildSegments(TABLE, [{ Name: "X", Effectif: 8 }]).length, 0);
});

// =====================================================================
// I2 — tri de buildSegmentsByEmployee.
// Les segments n'ont plus de bornes de dates ; l'ancien comparateur sur
// startTime renvoyait NaN et laissait l'ordre indefini.
// =====================================================================
test("buildSegmentsByEmployee ordonne par mois puis par projet", () => {
  const grouped = buildSegmentsByEmployee([
    { employeeKey: "a", monthKey: "2026-11", projectNumber: "25-0001" },
    { employeeKey: "a", monthKey: "2026-02", projectNumber: "25-0009" },
    { employeeKey: "a", monthKey: "2026-02", projectNumber: "25-0003" },
    { employeeKey: "b", monthKey: "2026-05", projectNumber: "25-0007" },
  ]);

  assert.deepEqual(
    grouped.get("a").map((segment) => `${segment.monthKey}/${segment.projectNumber}`),
    ["2026-02/25-0003", "2026-02/25-0009", "2026-11/25-0001"]
  );
  assert.equal(grouped.get("b").length, 1);
});

// =====================================================================
// I3 — cas degrades non couverts jusqu'ici.
// =====================================================================
test("buildAbsencesByEmployee rend un index vide quand Time-Out est absente", () => {
  const absences = buildAbsencesByEmployee({}, [], TEAM_TABLE, TEAM_ROWS);
  assert.equal(absences.size, 0);
});

test("fetchTimeOutRows retient le premier identifiant de table qui repond", async () => {
  const tentatives = [];
  const table = { id: [1], Owner: ["a@b.c"] };

  globalThis.grist = {
    docApi: {
      fetchTable: async (tableId) => {
        tentatives.push(tableId);
        if (tableId !== "Time_Out") throw new Error(`table ${tableId} introuvable`);
        return table;
      },
    },
  };

  try {
    const resultat = await fetchTimeOutRows();
    assert.deepEqual(tentatives, ["Time-Out", "Time_Out"], "ordre d'essai des identifiants");
    assert.equal(resultat.table, table);
    assert.deepEqual(resultat.rows, [{ id: 1, Owner: "a@b.c" }]);
  } finally {
    delete globalThis.grist;
  }
});

test("fetchTimeOutRows retombe sur un resultat vide si aucun identifiant ne repond", async () => {
  const tentatives = [];

  globalThis.grist = {
    docApi: {
      fetchTable: async (tableId) => {
        tentatives.push(tableId);
        throw new Error("introuvable");
      },
    },
  };

  try {
    const resultat = await fetchTimeOutRows();
    assert.deepEqual(tentatives, ["Time-Out", "Time_Out", "TimeOut"]);
    assert.deepEqual(resultat.table, {});
    assert.deepEqual(resultat.rows, []);
  } finally {
    delete globalThis.grist;
  }
});
