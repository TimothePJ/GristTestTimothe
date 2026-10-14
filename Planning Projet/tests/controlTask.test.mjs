// Tâche contrôlée de chaque étage par rapport au début du plan de coffrage : celle que
// l'utilisateur a cochée (colonne Controle_Coffrage), sinon le plan de réservations du cycle 3.
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyControlTasks,
  controlTaskEndLimits,
  readControlTasks,
} from "../assets/js/services/structureLinkModel.js";
import { detectFormworkCheckColumn, zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";
import { buildMenuItems } from "../assets/js/ui/syntheseTaskTable.js";

const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);

const ZONE = "Zone 1";
const RESA = "PLAN DE SYNTHESE RESERVATIONS NIV";

// Lignes Synthese de Planning_Projet.
function row(id, fields = {}) {
  return {
    id,
    NomProjet: "HOTEL DIEU",
    Service: "Synthese",
    Taches: "",
    Type_doc: "",
    ID2: "",
    Zone: ZONE,
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

const floor = (id, name, link = "") => row(id, { Taches: name, Etage: true, Lien_Structure: link });
const cycle3 = (id, floorName) => row(id, { Groupe: floorName, Taches: "CYCLE 3", Nature: "Cycle" });
const task = (id, floorName, name, parentId, fields = {}) => row(id, {
  Groupe: floorName,
  Taches: name,
  Parent: parentId ? String(parentId) : "",
  ...fields,
});

// SS1 : une tâche cochée à la place du plan de réservations. SS2 : rien de coché. SS3 : deux
// tâches cochées (saisie directe dans Grist). SS4 : rien de coché, pas de plan de réservations.
function syntheseRows() {
  return [
    floor(1, "SS1", "3001"),
    cycle3(10, "SS1"),
    task(11, "SS1", `${RESA} SS1`, 10),
    task(12, "SS1", "PLAN DE SYNTHESE TERMINAUX NIV SS1", 10, { Controle_Coffrage: true }),
    floor(2, "SS2", "3002"),
    cycle3(20, "SS2"),
    task(21, "SS2", `${RESA} SS2`, 20),
    task(22, "SS2", "PLAN DE SYNTHESE TERMINAUX NIV SS2", 20),
    floor(3, "SS3"),
    cycle3(30, "SS3"),
    task(31, "SS3", `${RESA} SS3`, 30),
    task(32, "SS3", "SIGNATURE PLANS SYNTHESE", 30, { Controle_Coffrage: true }),
    task(33, "SS3", "VISA Indice A", 30, { Controle_Coffrage: "true" }), // colonne en texte
    floor(4, "SS4"),
    task(41, "SS4", "Tâche libre", null),
    row(50, { Taches: "Tâche hors étage", Controle_Coffrage: true }), // pas dans un étage : ignorée
  ];
}

test("tâche contrôlée d'un étage : celle qui est cochée, sinon le plan de réservations du cycle 3", () => {
  const controls = readControlTasks(syntheseRows());
  assert.deepEqual(
    [...controls.entries()].map(([taskId, entry]) => [taskId, entry.floorKey, entry.chosen]),
    [[12, "ss1", true], [32, "ss3", true], [33, "ss3", true], [21, "ss2", false]]
  );
  assert.equal(controls.get(12).zoneKey, zoneKeyOf(ZONE));
  assert.equal(readControlTasks(null).size, 0);
});

test("la limite de fin suit la tâche cochée : le plan de réservations de l'étage n'en a plus", () => {
  const limits = controlTaskEndLimits({
    syntheseRows: syntheseRows(),
    formworkStarts: [
      { number: "3001", zoneName: ZONE, start: new Date(2026, 1, 19) },
      { number: "3002", zoneName: ZONE, start: new Date(2026, 2, 5) },
    ],
  });
  assert.deepEqual(
    [...limits.entries()].map(([taskId, entry]) => [taskId, iso(entry.limit), entry.formworkNumber]),
    [[12, "2026-02-19", "3001"], [21, "2026-03-05", "3002"]]
  );
});

test("report sur les lignes : tâche contrôlée, choisie ou par défaut", () => {
  const controls = readControlTasks(syntheseRows());
  const taskLine = (taskId) => ({ key: `task:${taskId}`, kind: "task", taskId, name: "T" });
  const lines = applyControlTasks([
    { key: "floor:zone1/ss1", kind: "floor", taskId: null, name: "SS1" },
    taskLine(11),
    taskLine(12),
    taskLine(21),
  ], controls);
  assert.deepEqual(lines.map((line) => [line.taskId, line.isControlTask ?? null, line.isChosenControlTask ?? null]), [
    [null, null, null],
    [11, null, null],
    [12, true, true],
    [21, true, false],
  ]);
});

test("colonne Controle_Coffrage : présente, absente, inconnue sans ligne", () => {
  assert.equal(detectFormworkCheckColumn([{ id: 1, Controle_Coffrage: false }]), true);
  assert.equal(detectFormworkCheckColumn([{ id: 1, Lien_Structure: "" }]), false);
  assert.equal(detectFormworkCheckColumn([]), null);
  assert.equal(detectFormworkCheckColumn(null), null);
});

test("menu d'une tâche d'étage : la contrôler, ne plus la contrôler, ou contrôlée par défaut", () => {
  const line = { kind: "task", zoneKey: "zonez3a", floorKey: "ss1", taskId: 5 };
  const controlItem = (extra) => buildMenuItems({ ...line, ...extra })[1];
  assert.deepEqual(buildMenuItems(line).map((item) => item.action), ["addTask", "setFormworkCheck", "deleteTask"]);
  assert.deepEqual(controlItem({}), {
    label: "Contrôler par rapport au coffrage",
    action: "setFormworkCheck",
    taskId: 5,
    checked: true,
  });
  assert.deepEqual(controlItem({ isControlTask: true, isChosenControlTask: true }), {
    label: "Ne plus contrôler par rapport au coffrage",
    action: "setFormworkCheck",
    taskId: 5,
    checked: false,
  });
  assert.deepEqual(controlItem({ isControlTask: true, isChosenControlTask: false }), {
    label: "Contrôlée par rapport au coffrage (par défaut)",
    action: "setFormworkCheck",
    taskId: 5,
    checked: true,
    disabled: true,
  });
});

test("menu d'une tâche hors étage : pas de contrôle par rapport au coffrage", () => {
  const actions = buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "", taskId: 5 }).map((item) => item.action);
  assert.deepEqual(actions, ["addTask", "deleteTask"]);
});
