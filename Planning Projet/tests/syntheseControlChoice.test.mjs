// Tâche contrôlée par rapport au coffrage, changée d'un coup dans les étages déjà créés (fenêtre
// « Paramètre », onglet « Tâche contrôlée ») : les tâches proposées, les étages où chacune existe,
// ceux qui changent, ceux qui l'ont déjà, ceux qui ne l'ont pas — et ce qui s'écrit.
import test from "node:test";
import assert from "node:assert/strict";

import { controlTaskChoices, planControlTask } from "../assets/js/services/syntheseControlChoice.js";
import { buildSections } from "../assets/js/services/syntheseTaskModel.js";

const Z1 = "Zone 1";
const Z2 = "Zone 2";
const RESA = "PLAN DE SYNTHESE RESERVATIONS NIV";
const TERM = "PLAN DE SYNTHESE TERMINAUX NIV";

// Lignes Synthese de Planning_Projet.
function row(id, fields = {}) {
  return {
    id,
    NomProjet: "HOTEL DIEU",
    Service: "Synthese",
    Taches: "",
    Type_doc: "",
    ID2: "",
    Zone: Z1,
    Groupe: "",
    Etage: false,
    Nature: "",
    Parent: "",
    Lien: "",
    Lien_Structure: "",
    Controle_Coffrage: false,
    Diff_coffrage: null,
    Diff_armature: null,
    Duree_1: 0,
    ...fields,
  };
}

const floor = (id, name, zone = Z1) => row(id, { Taches: name, Etage: true, Zone: zone });
const cycle = (id, floorName, name, { zone = Z1, parent = null } = {}) => row(id, {
  Groupe: floorName,
  Taches: name,
  Nature: parent ? "Sous-groupe" : "Cycle",
  Parent: parent ? String(parent) : "",
  Zone: zone,
});
const task = (id, floorName, name, parent, fields = {}) => row(id, {
  Groupe: floorName,
  Taches: name,
  Parent: parent ? String(parent) : "",
  ...fields,
});

// Zone 1 : R+1 (trois cycles) et R+2 (un cycle 4 en plus). Zone 2 : R+1, noms écrits autrement
// (casse, accents, espaces), et une autre tâche cochée à la main.
function projectRows() {
  return [
    floor(100, "R+1"),
    cycle(110, "R+1", "CYCLE 3"),
    task(111, "R+1", `${RESA} R+1`, 110),
    task(112, "R+1", `${TERM} R+1`, 110),
    task(119, "R+1", "DEMARRAGE GO R+1 (date prévisionnelle)", null, { Nature: "Demarrage" }),

    floor(200, "R+2"),
    cycle(210, "R+2", "CYCLE 3"),
    task(211, "R+2", `${RESA} R+2`, 210),
    task(212, "R+2", `${TERM} R+2`, 210),
    cycle(220, "R+2", "CYCLE 4"),
    task(221, "R+2", `${RESA} R+2`, 220),
    task(222, "R+2", "VISA Indice B", 220),
    task(229, "R+2", "DEMARRAGE GO R+2 (date prévisionnelle)", null, { Nature: "Demarrage" }),

    floor(300, "R+1", Z2),
    cycle(310, "R+1", "Cycle  3", { zone: Z2 }),
    task(311, "R+1", "Plan de synthèse réservations NIV R+1", 310, { Zone: Z2 }),
    task(312, "R+1", `${TERM} R+1`, 310, { Zone: Z2, Controle_Coffrage: true }),
    task(319, "R+1", "DEMARRAGE GO R+1 (date prévisionnelle)", null, { Zone: Z2, Nature: "Demarrage" }),
  ];
}

const read = (rows) => controlTaskChoices({ sections: buildSections({ rows }), rows });
const plan = (rows, key) => planControlTask({ sections: buildSections({ rows }), rows, key });
const choiceOf = (result, name, path = []) => result.choices.find((choice) => (
  choice.name === name && choice.path.join(" > ") === path.join(" > ")
));
const fieldsOf = (changes) => [...changes.entries()].map(([rowId, fields]) => [rowId, fields.Controle_Coffrage]);

test("tâches proposées : celles des étages, dans l'ordre du tableau, {E} à la place du nom de l'étage", () => {
  const result = read(projectRows());
  assert.equal(result.floorCount, 3);
  assert.deepEqual(result.choices.map((choice) => [choice.path.join(" > "), choice.name]), [
    ["CYCLE 3", `${RESA} {E}`],
    ["CYCLE 3", `${TERM} {E}`],
    // Le cycle 4 n'existe que dans R+2 : il vient après le cycle 3, avant la fin d'étage.
    ["CYCLE 4", `${RESA} {E}`],
    ["CYCLE 4", "VISA Indice B"],
    ["", "DEMARRAGE GO {E} (date prévisionnelle)"],
  ]);
  assert.equal(new Set(result.choices.map((choice) => choice.key)).size, 5, "une clé par tâche");
});

test("même nom, même cycle : la casse, les accents et les espaces ne comptent pas", () => {
  const resa = choiceOf(read(projectRows()), `${RESA} {E}`, ["CYCLE 3"]);
  assert.deepEqual(resa.missing, [], "« Cycle  3 » et « Plan de synthèse réservations » de la zone 2 sont reconnus");
  assert.equal(resa.change.length + resa.current.length, 3);
});

test("par tâche : les étages qui changent, ceux qui l'ont déjà, ceux qui ne l'ont pas", () => {
  const result = read(projectRows());
  // Plan de réservations du cycle 3 : déjà la tâche contrôlée (par défaut) en zone 1 ; en zone 2,
  // une autre tâche est cochée.
  const resa = choiceOf(result, `${RESA} {E}`, ["CYCLE 3"]);
  assert.deepEqual(resa.current, ["R+1 (Zone 1)", "R+2 (Zone 1)"]);
  assert.deepEqual(resa.change, ["R+1 (Zone 2)"]);
  assert.deepEqual(resa.missing, []);
  assert.equal(resa.controlled, 2);

  const term = choiceOf(result, `${TERM} {E}`, ["CYCLE 3"]);
  assert.deepEqual(term.current, ["R+1 (Zone 2)"]);
  assert.deepEqual(term.change, ["R+1 (Zone 1)", "R+2 (Zone 1)"]);
  assert.equal(term.controlled, 1);

  // Une tâche du cycle 4 : seul R+2 a un cycle 4.
  const cycle4 = choiceOf(result, `${RESA} {E}`, ["CYCLE 4"]);
  assert.deepEqual(cycle4.change, ["R+2 (Zone 1)"]);
  assert.deepEqual(cycle4.current, []);
  assert.deepEqual(cycle4.missing, ["R+1 (Zone 1)", "R+1 (Zone 2)"]);
  assert.equal(cycle4.controlled, 0);
});

test("écriture : la tâche cochée dans chaque étage qui l'a, les autres cochées décochées", () => {
  const rows = projectRows();
  const result = read(rows);

  // Cycle 4 : une seule ligne, dans R+2 ; les étages à trois cycles ne sont pas touchés.
  const cycle4 = plan(rows, choiceOf(result, `${RESA} {E}`, ["CYCLE 4"]).key);
  assert.equal(cycle4.found, true);
  assert.deepEqual(fieldsOf(cycle4.changes), [[221, true]]);
  assert.deepEqual(cycle4.change, ["R+2 (Zone 1)"]);
  assert.deepEqual(cycle4.missing, ["R+1 (Zone 1)", "R+1 (Zone 2)"]);

  // Plan de réservations du cycle 3 : rien en zone 1 (déjà contrôlé par défaut) ; en zone 2, il est
  // coché et la tâche cochée à la main est décochée.
  const resa = plan(rows, choiceOf(result, `${RESA} {E}`, ["CYCLE 3"]).key);
  assert.deepEqual(fieldsOf(resa.changes), [[311, true], [312, false]]);
  assert.deepEqual(resa.current, ["R+1 (Zone 1)", "R+2 (Zone 1)"]);

  // Terminaux : cochés en zone 1 ; déjà la seule tâche cochée en zone 2.
  const term = plan(rows, choiceOf(result, `${TERM} {E}`, ["CYCLE 3"]).key);
  assert.deepEqual(fieldsOf(term.changes), [[112, true], [212, true]]);
});

test("tâche déjà cochée avec une autre : seule l'autre est décochée (colonne en texte comprise)", () => {
  const rows = [
    floor(100, "R+1"),
    cycle(110, "R+1", "CYCLE 3"),
    task(111, "R+1", `${RESA} R+1`, 110, { Controle_Coffrage: true }),
    task(112, "R+1", `${TERM} R+1`, 110, { Controle_Coffrage: "true" }),
  ];
  const result = read(rows);
  const resa = choiceOf(result, `${RESA} {E}`, ["CYCLE 3"]);
  assert.deepEqual(resa.change, ["R+1 (Zone 1)"]);
  assert.equal(resa.controlled, 1);
  assert.deepEqual(fieldsOf(plan(rows, resa.key).changes), [[112, false]]);
});

test("deux tâches de même nom dans un même cycle : distinguées par leur rang", () => {
  const rows = [
    floor(100, "R+1"),
    cycle(110, "R+1", "CYCLE 3"),
    task(111, "R+1", "REUNION + DIFFUSION SYT", 110),
    task(112, "R+1", "REUNION + DIFFUSION SYT", 110),
    floor(200, "R+2"),
    cycle(210, "R+2", "CYCLE 3"),
    task(211, "R+2", "REUNION + DIFFUSION SYT", 210),
  ];
  const result = read(rows);
  assert.deepEqual(result.choices.map((choice) => [choice.name, choice.rank]), [
    ["REUNION + DIFFUSION SYT", 1],
    ["REUNION + DIFFUSION SYT", 2],
  ]);
  const second = plan(rows, result.choices[1].key);
  assert.deepEqual(fieldsOf(second.changes), [[112, true]]);
  assert.deepEqual(second.missing, ["R+2 (Zone 1)"], "R+2 n'a qu'une réunion dans son cycle 3");
});

test("sous-cycles : le chemin entier compte ; un étage au nom par défaut est reconnu", () => {
  const rows = [
    floor(100, "R+1"),
    cycle(110, "R+1", "CYCLE 3"),
    cycle(120, "R+1", "PLAN SYT CYCLE 3", { parent: 110 }),
    task(121, "R+1", `${RESA} R+1`, 120),
    floor(200, "Nouvel étage"),
    cycle(210, "Nouvel étage", "CYCLE 3"),
    cycle(220, "Nouvel étage", "PLAN SYT CYCLE 3", { parent: 210 }),
    task(221, "Nouvel étage", `${RESA} Nouvel étage`, 220),
    // Même nom, mais directement dans le cycle 3 : une autre tâche.
    floor(300, "R+3"),
    cycle(310, "R+3", "CYCLE 3"),
    task(311, "R+3", `${RESA} R+3`, 310),
  ];
  const result = read(rows);
  const nested = choiceOf(result, `${RESA} {E}`, ["CYCLE 3", "PLAN SYT CYCLE 3"]);
  assert.deepEqual(nested.missing, ["R+3 (Zone 1)"]);
  assert.equal(nested.change.length + nested.current.length, 2);
  assert.ok(choiceOf(result, `${RESA} {E}`, ["CYCLE 3"]), "la tâche de R+3 est proposée à part");
});

// Un modèle d'étage du projet peut mettre {E} n'importe où, dans une tâche comme dans un cycle.
test("nom de l'étage ailleurs qu'après NIV ou GO : reconnu dans les tâches et les cycles", () => {
  const rows = [];
  ["SS1", "R+1", "Nouvel étage"].forEach((name, index) => {
    const id = 100 * (index + 1);
    rows.push(
      floor(id, name),
      cycle(id + 10, name, `CYCLE 3 ${name}`),
      task(id + 11, name, `PLAN RESA NIVEAU ${name}`, id + 10),
      task(id + 12, name, `${name} : coffrage`, id + 10),
      task(id + 13, name, `Visa (${name})`, id + 10),
    );
  });
  // Écrit à la main, sans la casse de l'étage : la même tâche quand même.
  rows.push(floor(400, "Rdc"), cycle(410, "Rdc", "CYCLE 3 RDC"), task(411, "Rdc", "PLAN RESA NIVEAU rdc", 410));
  const result = read(rows);
  assert.equal(result.floorCount, 4);
  assert.deepEqual(result.choices.map((choice) => [choice.path.join(" > "), choice.name, choice.missing]), [
    ["CYCLE 3 {E}", "PLAN RESA NIVEAU {E}", []],
    ["CYCLE 3 {E}", "{E} : coffrage", ["Rdc (Zone 1)"]],
    ["CYCLE 3 {E}", "Visa ({E})", ["Rdc (Zone 1)"]],
  ]);
});

test("étage au nom d'un chiffre : seul « NIV 1 » ou « GO 1 » vaut pour son nom, pas « CYCLE 1 »", () => {
  const rows = [
    floor(100, "1"),
    cycle(110, "1", "CYCLE 1"),
    task(111, "1", "PLAN NIV 1", 110),
    task(112, "1", "VISA Indice 1", 110),
    floor(200, "2"),
    cycle(210, "2", "CYCLE 1"),
    task(211, "2", "PLAN NIV 2", 210),
    task(212, "2", "VISA Indice 1", 210),
  ];
  assert.deepEqual(read(rows).choices.map((choice) => [choice.path.join(" > "), choice.name, choice.missing]), [
    ["CYCLE 1", "PLAN NIV {E}", []],
    ["CYCLE 1", "VISA Indice 1", []],
  ]);
});

test("clé inconnue, projet sans étage : rien à écrire", () => {
  const rows = projectRows();
  const unknown = plan(rows, "pas une clé");
  assert.equal(unknown.found, false);
  assert.equal(unknown.changes.size, 0);
  assert.deepEqual(unknown.missing, ["R+1 (Zone 1)", "R+2 (Zone 1)", "R+1 (Zone 2)"]);

  const empty = read([row(1, { Taches: "Tâche hors étage" })]);
  assert.deepEqual(empty, { floorCount: 0, choices: [] });
  assert.deepEqual(controlTaskChoices(), { floorCount: 0, choices: [] });
});
