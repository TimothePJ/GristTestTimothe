import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWeeklyUtilizationMatrix,
  getSegmentDaysInRange,
} from "../assets/js/utilizationService.js";
import { getWeekRange } from "../assets/js/dateRange.js";
import { availableDaysAfterLeave } from "../assets/js/leaveAbsences.js";

const EMPLOYEE = { key: "marie dupont", absenceKey: "marie dupont", name: "Marie DUPONT", firstName: "Marie", lastName: "DUPONT", service: "Structure", role: "Projeteur" };
const PROJECTS = new Map([["25-0142", { number: "25-0142", name: "Tour A" }]]);

// Septembre 2026 : 22 jours ouvres, aucun jour ferie, 1er = mardi.
// Semaines ISO qui touchent le mois : W36 (4 j) a W40 (3 j).
const SEPTEMBER_WEEKS = ["2026-W36", "2026-W37", "2026-W38", "2026-W39", "2026-W40"];

function weeksOf(...values) {
  return values.map((value) => ({ value, label: value, range: getWeekRange(value) }));
}

function halfDays(dayNumbers, parts = ["am", "pm"]) {
  const slots = new Set();
  dayNumbers.forEach((day) => {
    parts.forEach((part) => slots.add(`2026-09-${String(day).padStart(2, "0")}:${part}`));
  });
  return slots;
}

// Toutes les demi-journees ouvrees d'un mois : la personne est absente du 1er
// au dernier jour, donc dispo(E, mois) == 0.
function absencesForWholeMonth(monthKey, dayCount) {
  const slots = new Set();
  for (let day = 1; day <= dayCount; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    slots.add(`${dateKey}:am`);
    slots.add(`${dateKey}:pm`);
  }
  return slots;
}

function segmentOf(effectif, overrides = {}) {
  return {
    employeeKey: EMPLOYEE.key,
    absenceKey: EMPLOYEE.absenceKey,
    monthKey: "2026-09",
    effectif,
    projectNumber: "25-0142",
    ...overrides,
  };
}

test("l'effectif mensuel se repartit sur les semaines du mois", () => {
  const segments = [{ employeeKey: EMPLOYEE.key, absenceKey: EMPLOYEE.absenceKey, monthKey: "2026-09", effectif: 22, projectNumber: "25-0142" }];
  const weeks = weeksOf("2026-W37", "2026-W38");
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE], segments, projects: PROJECTS, weeks,
    absencesByEmployee: new Map(),
  });

  // 22 jours planifies sur les 22 jours ouvres de septembre = 100 % par semaine.
  weeks.forEach((week) => {
    assert.ok(Math.abs(row.projectRows[0].weekPercents[week.value] - 100) < 0.5);
  });
});

test("une semaine entierement en conge est marquee, pas affichee a 0 %", () => {
  const absences = new Set();
  for (const day of ["07", "08", "09", "10", "11"]) {
    absences.add(`2026-09-${day}:am`);
    absences.add(`2026-09-${day}:pm`);
  }
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [{ employeeKey: EMPLOYEE.key, absenceKey: EMPLOYEE.absenceKey, monthKey: "2026-09", effectif: 8, projectNumber: "25-0142" }],
    projects: PROJECTS,
    weeks: weeksOf("2026-W37"),
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, absences]]),
  });

  assert.equal(row.totalRow.weekStates["2026-W37"], "leave");
});

// =====================================================================
// PROPRIETE DE CONTROLE — la charge mensuelle est conservee.
// La somme de charge(S, W) sur toutes les semaines touchant le mois de S
// doit valoir exactement Effectif(S). C'est ce qui garantit qu'un segment
// ne perd ni ne gagne de jours en passant de la maille mois a la maille
// semaine, quels que soient les conges de la personne.
// =====================================================================
test("la somme des charges hebdomadaires vaut l'effectif du segment", () => {
  const segment = segmentOf(17.5);

  for (const [libelle, absenceSet] of [
    ["sans conge", new Set()],
    ["une demi-journee", halfDays([7], ["am"])],
    ["une semaine entiere", halfDays([7, 8, 9, 10, 11])],
    ["deux semaines et demie", halfDays([7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22])],
  ]) {
    const total = weeksOf(...SEPTEMBER_WEEKS).reduce(
      (sum, week) => sum + getSegmentDaysInRange(segment, week.range, absenceSet),
      0
    );
    assert.ok(
      Math.abs(total - segment.effectif) < 1e-9,
      `${libelle} : somme des charges ${total} != effectif ${segment.effectif}`
    );
  }
});

// =====================================================================
// DEFAUT 2 — la CLE du cache de memoisation de getMonthShareForRange.
//
// La memoisation est annoncee « pure a absences constantes » : omettre le cache
// ne doit changer que le temps de calcul. Or sa cle porte le mois ET le debut de
// semaine. Sans le mois, deux segments de mois DIFFERENTS evalues sur la MEME
// semaine se partagent la meme entree : le second herite de la part du premier.
//
// 2026-W36 = 31/08 + 01→04/09 : la seule semaine de l'annee ou un segment d'aout
// et un segment de septembre sont calcules sur la meme semaine. C'est le seul
// endroit ou la cle se prouve.
// =====================================================================
test("une semaine a cheval sur deux mois n'intervertit pas leurs parts", () => {
  const projets = new Map([
    ["25-0001", { number: "25-0001", name: "Aout" }],
    ["25-0002", { number: "25-0002", name: "Septembre" }],
  ]);
  const weeks = weeksOf("2026-W36");
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    // Aout 2026 : 21 jours ouvres (le 15 tombe un samedi). Septembre : 22.
    segments: [
      segmentOf(21, { monthKey: "2026-08", projectNumber: "25-0001" }),
      segmentOf(22, { monthKey: "2026-09", projectNumber: "25-0002" }),
    ],
    projects: projets,
    weeks,
    absencesByEmployee: new Map(),
  });

  const parProjet = new Map(row.projectRows.map((ligne) => [ligne.projectNumber, ligne]));
  const aout = parProjet.get("25-0001").weekPercents["2026-W36"];
  const septembre = parProjet.get("25-0002").weekPercents["2026-W36"];

  // Aout ne pese qu'un jour dans W36 (le 31) : 21 x 1/21 = 1 j sur 5 = 20 %.
  assert.ok(Math.abs(aout - 20) < 1e-9, `aout affiche ${aout} % au lieu de 20 %`);
  // Septembre en pese quatre (01 au 04) : 22 x 4/22 = 4 j sur 5 = 80 %. Une cle
  // de cache amputee du mois lui rendrait la part d'aout, soit 20,95 %.
  assert.ok(
    Math.abs(septembre - 80) < 1e-9,
    `septembre affiche ${septembre} % au lieu de 80 % : part d'aout reutilisee ?`
  );
  assert.ok(
    Math.abs(row.totalRow.weekPercents["2026-W36"] - 100) < 1e-9,
    `total ${row.totalRow.weekPercents["2026-W36"]} % au lieu de 100 %`
  );
});

test("aucune charge hors du mois du segment", () => {
  const segment = segmentOf(10);
  const [avant, apres] = weeksOf("2026-W31", "2026-W45");
  assert.equal(getSegmentDaysInRange(segment, avant.range, new Set()), 0);
  assert.equal(getSegmentDaysInRange(segment, apres.range, new Set()), 0);
});

test("la conservation de l'effectif survit au passage par la matrice", () => {
  // Conge d'une demi-journee : aucune semaine ne tombe a capacite nulle, donc
  // chaque semaine reste convertible en jours (pourcentage x capacite).
  const absences = halfDays([7], ["am"]);
  const weeks = weeksOf(...SEPTEMBER_WEEKS);
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [segmentOf(10)],
    projects: PROJECTS,
    weeks,
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, absences]]),
  });

  const reconstitue = weeks.reduce((sum, week) => {
    const capacity = availableDaysAfterLeave(week.range.start, week.range.end, absences);
    assert.ok(capacity > 0, `capacite nulle inattendue sur ${week.value}`);
    return sum + (row.projectRows[0].weekPercents[week.value] / 100) * capacity;
  }, 0);

  assert.ok(
    Math.abs(reconstitue - 10) < 1e-9,
    `jours reconstitues ${reconstitue} != effectif 10`
  );
});

// =====================================================================
// DEFAUT 1 — une charge planifiee sur une periode ou la personne est
// indisponible ne doit JAMAIS disparaitre sans trace.
//
// Quand dispo(E, mois) == 0, toutes les semaines du mois tombent a capacite
// nulle : la branche « si capacite > 0 » n'appelle alors jamais le calcul de
// charge et les jours planifies s'evaporent de la matrice. Le repli en jours
// ouvres de getMonthShareForRange existe precisement pour ce cas — encore
// faut-il l'appeler.
// =====================================================================
// Fevrier 2026 : 20 jours ouvres, le 1er est un dimanche. Semaines ISO qui
// portent des jours ouvres du mois : W06 a W09 (5 j chacune).
const FEVRIER_WEEKS = ["2026-W06", "2026-W07", "2026-W08", "2026-W09"];

test("une charge planifiee sur un mois entierement en conge reste visible", () => {
  const absences = absencesForWholeMonth("2026-02", 28);
  const weeks = weeksOf(...FEVRIER_WEEKS);
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [segmentOf(20, { monthKey: "2026-02" })],
    projects: PROJECTS,
    weeks,
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, absences]]),
  });

  const projet = row.projectRows[0];
  weeks.forEach((week) => {
    assert.equal(
      projet.weekStates[week.value],
      "leave-overloaded",
      `${week.value} : la charge planifiee a disparu sans trace`
    );
  });

  const traces = weeks.reduce(
    (somme, week) => somme + (projet.weekLeaveDays?.[week.value] || 0),
    0
  );
  assert.ok(
    Math.abs(traces - 20) < 1e-9,
    `${traces} jours traces sur la ligne projet au lieu des 20 planifies`
  );

  // La ligne « Total employe » porte la meme alerte, avec les memes jours.
  weeks.forEach((week) => {
    assert.equal(row.totalRow.weekStates[week.value], "leave-overloaded", week.value);
  });
  const tracesTotal = weeks.reduce(
    (somme, week) => somme + (row.totalRow.weekLeaveDays?.[week.value] || 0),
    0
  );
  assert.ok(
    Math.abs(tracesTotal - 20) < 1e-9,
    `${tracesTotal} jours traces sur la ligne total au lieu des 20 planifies`
  );
});

// Un mois non aligne sur les semaines ISO garde une capacite MINUSCULE sur ses
// semaines de bord. Ecretee a 100 %, la charge s'y affichait en bleu neutre —
// soit exactement comme un plan parfaitement equilibre.
test("une surcharge reelle n'est plus ecretee a 100 %", () => {
  const absences = absencesForWholeMonth("2026-09", 30);
  const weeks = weeksOf(...SEPTEMBER_WEEKS);
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [segmentOf(20)],
    projects: PROJECTS,
    weeks,
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, absences]]),
  });

  const projet = row.projectRows[0];
  // W36 = 31/08 + 01→04/09 : seul le 31 aout reste disponible (1 j), pour
  // 20 x 4/22 = 3,636 j de charge, soit 363,6 %.
  assert.ok(
    Math.abs(projet.weekPercents["2026-W36"] - (2000 * 4) / 22) < 1e-9,
    `W36 affiche ${projet.weekPercents["2026-W36"]} % au lieu de 363,64 %`
  );
  assert.ok(
    projet.weekPercents["2026-W36"] > 100.5,
    "surcharge ecretee a 100 % : elle se lit comme une charge equilibree"
  );
  // W40 = 28→30/09 + 01,02/10 : 2 j disponibles pour 20 x 3/22 = 2,727 j.
  assert.ok(
    Math.abs(projet.weekPercents["2026-W40"] - (2000 * 3) / 22 / 2) < 1e-9,
    `W40 affiche ${projet.weekPercents["2026-W40"]} % au lieu de 136,36 %`
  );
  assert.ok(
    row.totalRow.weekPercents["2026-W36"] > 100.5,
    "la ligne total ecrete la surcharge"
  );

  // Controle : aucun jour perdu. Les semaines a capacite nulle rendent leurs
  // jours par weekLeaveDays, les autres par le pourcentage.
  const reconstitue = weeks.reduce((somme, week) => {
    const capacite = availableDaysAfterLeave(week.range.start, week.range.end, absences);
    return somme + (capacite > 0
      ? (projet.weekPercents[week.value] / 100) * capacite
      : projet.weekLeaveDays?.[week.value] || 0);
  }, 0);
  assert.ok(
    Math.abs(reconstitue - 20) < 1e-9,
    `${reconstitue} jours reconstitues au lieu des 20 planifies`
  );
});

// =====================================================================
// La capacite est une propriete du COUPLE (collaborateur, semaine).
// Deux personnes tenant le meme segment sur la meme semaine n'affichent
// pas le meme pourcentage des lors que leurs conges different : celle qui
// est partiellement absente est plus chargee sur le temps qui lui reste.
// =====================================================================
const DISPONIBLE = { key: "alice martin", absenceKey: "alice martin", name: "Alice MARTIN", firstName: "Alice", lastName: "MARTIN", service: "Structure", role: "Projeteur" };
const ABSENT = { key: "bruno leroy", absenceKey: "bruno leroy", name: "Bruno LEROY", firstName: "Bruno", lastName: "LEROY", service: "Structure", role: "Projeteur" };

test("deux collaborateurs aux conges differents n'ont pas le meme pourcentage", () => {
  const weeks = weeksOf("2026-W37");
  const matrix = computeWeeklyUtilizationMatrix({
    employees: [DISPONIBLE, ABSENT],
    segments: [
      segmentOf(5, { employeeKey: DISPONIBLE.key, absenceKey: DISPONIBLE.absenceKey }),
      segmentOf(5, { employeeKey: ABSENT.key, absenceKey: ABSENT.absenceKey }),
    ],
    projects: PROJECTS,
    weeks,
    // Bruno pose lundi et mardi : capacite 3 j au lieu de 5 sur W37.
    absencesByEmployee: new Map([[ABSENT.absenceKey, halfDays([7, 8])]]),
  });

  const parCle = new Map(matrix.map((bloc) => [bloc.employee.key, bloc]));
  const dispo = parCle.get(DISPONIBLE.key).projectRows[0].weekPercents["2026-W37"];
  const absent = parCle.get(ABSENT.key).projectRows[0].weekPercents["2026-W37"];

  // Alice : 5 x (5/22) = 1,136 j sur 5 j disponibles.
  assert.ok(Math.abs(dispo - (500 * 5 / 22) / 5) < 1e-9, `Alice a ${dispo} %`);
  // Bruno : 5 x (3/20) = 0,75 j sur 3 j disponibles.
  assert.ok(Math.abs(absent - 25) < 1e-9, `Bruno a ${absent} %`);
  assert.ok(
    absent > dispo,
    "la capacite est restee commune aux deux collaborateurs"
  );
});

test("les semaines a capacite nulle sont marquees pour la personne concernee seulement", () => {
  const weeks = weeksOf("2026-W37");
  const matrix = computeWeeklyUtilizationMatrix({
    employees: [DISPONIBLE, ABSENT],
    segments: [
      segmentOf(5, { employeeKey: DISPONIBLE.key, absenceKey: DISPONIBLE.absenceKey }),
      segmentOf(5, { employeeKey: ABSENT.key, absenceKey: ABSENT.absenceKey }),
    ],
    projects: PROJECTS,
    weeks,
    absencesByEmployee: new Map([[ABSENT.absenceKey, halfDays([7, 8, 9, 10, 11])]]),
  });

  const parCle = new Map(matrix.map((bloc) => [bloc.employee.key, bloc]));
  assert.equal(parCle.get(ABSENT.key).totalRow.weekStates["2026-W37"], "leave");
  assert.equal(parCle.get(ABSENT.key).projectRows[0].weekStates["2026-W37"], "leave");
  assert.equal(parCle.get(DISPONIBLE.key).totalRow.weekStates["2026-W37"], "");
  assert.equal(parCle.get(DISPONIBLE.key).projectRows[0].weekStates["2026-W37"], "");
});

// Une capacite nulle ne doit pas faire disparaitre la ligne : sans cela le
// collaborateur sort de la matrice et l'etat « Congé » n'a rien a peindre.
test("une ligne projet entierement en conge reste visible", () => {
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [segmentOf(8)],
    projects: PROJECTS,
    weeks: weeksOf("2026-W37"),
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, halfDays([7, 8, 9, 10, 11])]]),
  });

  assert.equal(row.projectRows.length, 1);
  assert.equal(row.projectRows[0].type, "project");
  assert.equal(row.projectRows[0].projectNumber, "25-0142");
  assert.equal(row.projectRows[0].weekPercents["2026-W37"], 0);
});

// Un segment dont le mois est hors calendrier affiche ne doit toujours pas
// creer de ligne : c'est ce que faisait l'ancien filtre sur les pourcentages.
test("un segment hors du calendrier affiche ne cree aucune ligne", () => {
  const matrix = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [segmentOf(8, { monthKey: "2025-03" })],
    projects: PROJECTS,
    weeks: weeksOf(...SEPTEMBER_WEEKS),
    absencesByEmployee: new Map(),
  });

  assert.deepEqual(matrix, []);
});

test("la ligne de repli « aucun projet » porte aussi les etats de semaine", () => {
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [EMPLOYEE],
    segments: [],
    projects: PROJECTS,
    weeks: weeksOf("2026-W37"),
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, halfDays([7, 8, 9, 10, 11])]]),
    includeEmployeesWithoutProjects: true,
  });

  assert.equal(row.projectRows[0].type, "empty");
  assert.equal(row.projectRows[0].weekStates["2026-W37"], "leave");
  assert.equal(row.totalRow.weekStates["2026-W37"], "leave");
});

// =====================================================================
// absenceKey vide = « inconnu de Team ». C'est un cas nominal, pas une
// erreur : on calcule alors sur la geometrie brute (week-ends + feries),
// sans jamais aller chercher une entree sous la cle vide.
// =====================================================================
const SANS_FICHE = { key: "inconnu sansfiche", absenceKey: "", name: "Inconnu SANSFICHE", firstName: "Inconnu", lastName: "SANSFICHE", service: "", role: "" };

test("une absenceKey vide vaut « aucune absence connue »", () => {
  const weeks = weeksOf("2026-W37");
  const commun = {
    projects: PROJECTS,
    weeks,
    segments: [segmentOf(5, { employeeKey: SANS_FICHE.key, absenceKey: "" })],
  };

  let matrix;
  assert.doesNotThrow(() => {
    matrix = computeWeeklyUtilizationMatrix({
      ...commun,
      employees: [SANS_FICHE],
      // Un index non vide, dont aucune entree ne concerne cette personne.
      absencesByEmployee: new Map([["marie dupont", halfDays([7, 8, 9, 10, 11])]]),
    });
  });

  const reference = computeWeeklyUtilizationMatrix({
    ...commun,
    employees: [SANS_FICHE],
    absencesByEmployee: new Map(),
  });

  assert.equal(matrix[0].totalRow.weekStates["2026-W37"], "");
  assert.deepEqual(
    matrix[0].projectRows[0].weekPercents,
    reference[0].projectRows[0].weekPercents
  );
  assert.ok(Math.abs(matrix[0].projectRows[0].weekPercents["2026-W37"] - (500 * 5 / 22) / 5) < 1e-9);
});

// Le test ci-dessus interroge l'index avec une cle ABSENTE ("marie dupont"),
// jamais avec la cle vide elle-meme : il ne dit donc rien du `.get("")`. Que
// celui-ci soit inoffensif ne tient qu'a buildAbsenceIndex, qui ecarte les cles
// vides — un couplage tacite a un module voisin, que rien n'oblige a durer.
test("une absenceKey vide n'interroge jamais l'index", () => {
  const commun = {
    projects: PROJECTS,
    weeks: weeksOf("2026-W37"),
    employees: [SANS_FICHE],
    segments: [segmentOf(5, { employeeKey: SANS_FICHE.key, absenceKey: "" })],
  };

  const pollue = computeWeeklyUtilizationMatrix({
    ...commun,
    // Une entree rangee SOUS LA CLE VIDE. Elle ne concerne personne.
    absencesByEmployee: new Map([["", halfDays([7, 8, 9, 10, 11])]]),
  });
  const reference = computeWeeklyUtilizationMatrix({
    ...commun,
    absencesByEmployee: new Map(),
  });

  assert.equal(
    pollue[0].totalRow.weekStates["2026-W37"],
    "",
    "l'employe inconnu de Team a herite des conges ranges sous la cle vide"
  );
  assert.deepEqual(
    pollue[0].projectRows[0].weekPercents,
    reference[0].projectRows[0].weekPercents,
    "la capacite de l'employe inconnu de Team a ete amputee par des conges d'autrui"
  );
});

test("absencesByEmployee absent ne fait pas echouer le calcul", () => {
  assert.doesNotThrow(() => {
    computeWeeklyUtilizationMatrix({
      employees: [EMPLOYEE],
      segments: [segmentOf(5)],
      projects: PROJECTS,
      weeks: weeksOf("2026-W37"),
    });
  });
});

// Un employe connu des seuls segments doit heriter de leur absenceKey, sinon
// ses conges sont perdus alors meme que l'index les contient.
test("un employe issu des seuls segments herite de l'absenceKey de ceux-ci", () => {
  const [row] = computeWeeklyUtilizationMatrix({
    employees: [],
    segments: [{
      employeeName: "Marie DUPONT",
      employeeKey: EMPLOYEE.key,
      absenceKey: EMPLOYEE.absenceKey,
      monthKey: "2026-09",
      effectif: 8,
      projectNumber: "25-0142",
    }],
    projects: PROJECTS,
    weeks: weeksOf("2026-W37"),
    absencesByEmployee: new Map([[EMPLOYEE.absenceKey, halfDays([7, 8, 9, 10, 11])]]),
  });

  assert.equal(row.employee.absenceKey, EMPLOYEE.absenceKey);
  assert.equal(row.totalRow.weekStates["2026-W37"], "leave");
});
