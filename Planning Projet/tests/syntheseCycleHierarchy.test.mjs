import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGroupDeleteQuestion,
  buildRowModel,
  buildSections,
  descendantGroups,
  findGroup,
  groupRemovalIds,
} from "../assets/js/services/syntheseTaskModel.js";
import { readControlTasks } from "../assets/js/services/structureLinkModel.js";
import { ERA_PROJECT, ERA_ZONE, ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

const byNumber = (left, right) => left - right;

// Ligne ajoutée à l'export : même projet, même zone, étage SS1 par défaut.
function extraRow(fields) {
  return {
    NomProjet: ERA_PROJECT, Zone: ERA_ZONE, Service: "Synthese", Type_doc: "", ID2: "", Indice: "",
    Lien_Structure: "", Controle_Coffrage: false, Etage: false, Groupe: "SS1", Nature: "", Parent: "",
    Lien: "", Duree_1: 0, Diff_coffrage: null, Diff_armature: null, Ordre: "", ...fields,
  };
}

const deeperRows = () => [
  extraRow({ id: 2001, Taches: "SOUS-SOUS", Nature: "Cycle", Parent: "994" }),
  extraRow({ id: 2002, Taches: "NIVEAU 4", Nature: "Cycle", Parent: "2001" }),
  extraRow({
    id: 2003, Taches: "TACHE PROFONDE", Parent: "2002", Duree_1: 2,
    Diff_coffrage: "2026-02-02", Diff_armature: "2026-02-03",
  }),
];

const modelOf = (rows) => {
  const sections = buildSections({ rows });
  return { sections, lines: buildRowModel(sections) };
};
const lineOf = (lines, key) => lines.find((line) => line.key === key);

test("export de l'utilisateur : l'étage SS1 se lit comme avant", () => {
  const { lines } = modelOf(eraSs1Rows());
  assert.deepEqual(lines.map((line) => line.key), [
    `zone:${ERA_ZONE_KEY}`, `floor:${ERA_ZONE_KEY}/ss1`, "task:984",
    "group:985", "task:986", "task:987", "task:988", "task:1061", "task:989", "task:990", "task:991",
    "group:992", "task:993", "group:994", "task:995", "task:996", "task:997", "task:998",
    "group:999", "task:1000", "task:1001", "group:1002", "task:1003", "task:1004", "task:1005", "task:1006",
    "task:1007", "task:1008",
  ]);
  const cycle = lineOf(lines, "group:985");
  assert.equal(cycle.level, 2);
  assert.equal(cycle.depth, 1);
  assert.equal(cycle.nature, "cycle");
  assert.equal(cycle.parentGroupRowId, null);
  assert.deepEqual(cycle.cyclePath, [985]);
  const sub = lineOf(lines, "group:994");
  assert.equal(sub.level, 3);
  assert.equal(sub.depth, 2);
  assert.equal(sub.nature, "sous-groupe");
  assert.equal(sub.parentGroupRowId, 992);
  assert.deepEqual(sub.cyclePath, [992, 994]);
  assert.equal(lineOf(lines, "task:995").level, 4);
  assert.deepEqual(lineOf(lines, "task:995").cyclePath, [992, 994]);
  assert.deepEqual(lineOf(lines, "task:984").cyclePath, []);
  assert.deepEqual(lineOf(lines, `zone:${ERA_ZONE_KEY}`).cyclePath, []);
  assert.deepEqual(lineOf(lines, `floor:${ERA_ZONE_KEY}/ss1`).cyclePath, []);
});

test("sous-cycle dans un sous-cycle : profondeur et niveaux sans plafond", () => {
  const { sections, lines } = modelOf([...eraSs1Rows(), ...deeperRows()]);
  const deep = lineOf(lines, "group:2001");
  assert.equal(deep.level, 4);
  assert.equal(deep.depth, 3);
  assert.equal(deep.nature, "sous-groupe");
  assert.equal(deep.parentGroupRowId, 994);
  const deepest = lineOf(lines, "group:2002");
  assert.equal(deepest.level, 5);
  assert.equal(deepest.depth, 4);
  const task = lineOf(lines, "task:2003");
  assert.equal(task.level, 6);
  assert.deepEqual(task.cyclePath, [992, 994, 2001, 2002]);
  const end = findGroup(sections, 992).summary.end;
  assert.deepEqual([end.getFullYear(), end.getMonth(), end.getDate()], [2026, 1, 3]);
});

test("Parent étranger, illisible ou lui-même : le cycle est directement dans son étage", () => {
  const rows = [
    ...eraSs1Rows(),
    extraRow({ id: 3000, Taches: "R+1", Etage: true, Groupe: "" }),
    extraRow({ id: 3001, Taches: "CYCLE R+1", Nature: "Cycle", Groupe: "R+1" }),
    extraRow({ id: 3002, Taches: "ETRANGER", Nature: "Cycle", Parent: "3001" }),
    extraRow({ id: 3003, Taches: "ILLISIBLE", Nature: "Cycle", Parent: "abc" }),
    extraRow({ id: 3004, Taches: "LUI-MEME", Nature: "Cycle", Parent: "3004" }),
  ];
  const { lines } = modelOf(rows);
  [3002, 3003, 3004].forEach((id) => {
    const line = lineOf(lines, `group:${id}`);
    assert.equal(line.depth, 1, `cycle ${id}`);
    assert.equal(line.parentGroupRowId, null, `cycle ${id}`);
    assert.equal(line.nature, "cycle", `cycle ${id}`);
  });
});

test("boucle de Parent : le cycle de plus petit id passe dans l'étage", () => {
  const rows = [
    ...eraSs1Rows(),
    extraRow({ id: 4001, Taches: "BOUCLE A", Nature: "Cycle", Parent: "4002" }),
    extraRow({ id: 4002, Taches: "BOUCLE B", Nature: "Cycle", Parent: "4001" }),
  ];
  const { lines } = modelOf(rows);
  const first = lineOf(lines, "group:4001");
  const second = lineOf(lines, "group:4002");
  assert.equal(first.depth, 1);
  assert.equal(first.parentGroupRowId, null);
  assert.equal(second.depth, 2);
  assert.equal(second.parentGroupRowId, 4001);
});

test("suppression : toutes les lignes, à toute profondeur", () => {
  const plain = buildSections({ rows: eraSs1Rows() });
  assert.deepEqual([...groupRemovalIds(findGroup(plain, 992))].sort(byNumber), [992, 993, 994, 995, 996, 997, 998]);
  const deep = buildSections({ rows: [...eraSs1Rows(), ...deeperRows()] });
  const cycle = findGroup(deep, 992);
  assert.deepEqual([...groupRemovalIds(cycle)].sort(byNumber), [992, 993, 994, 995, 996, 997, 998, 2001, 2002, 2003]);
  assert.deepEqual(descendantGroups(cycle).map((group) => group.rowId), [994, 2001, 2002]);
});

test("question de suppression", () => {
  const { sections } = modelOf(eraSs1Rows());
  assert.equal(buildGroupDeleteQuestion(findGroup(sections, 992)), "Supprimer « CYCLE 2 », son sous-cycle et ses 5 tâches ?");
  const tasks = (count) => Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
  const subs = (count) => Array.from({ length: count }, (_, index) => ({ rowId: index + 1, groups: [] }));
  assert.equal(buildGroupDeleteQuestion({ name: "VIDE", tasks: [], groups: [] }), "Supprimer « VIDE » ?");
  assert.equal(buildGroupDeleteQuestion({ name: "UN", tasks: tasks(1), groups: [] }), "Supprimer « UN » et sa tâche ?");
  assert.equal(buildGroupDeleteQuestion({ name: "X", tasks: tasks(3), groups: [] }), "Supprimer « X » et ses 3 tâches ?");
  assert.equal(buildGroupDeleteQuestion({ name: "X", tasks: [], groups: subs(1) }), "Supprimer « X » et son sous-cycle ?");
  assert.equal(buildGroupDeleteQuestion({ name: "X", tasks: [], groups: subs(2) }), "Supprimer « X » et ses 2 sous-cycles ?");
  assert.equal(
    buildGroupDeleteQuestion({ name: "X", tasks: tasks(1), groups: subs(2) }),
    "Supprimer « X », ses 2 sous-cycles et sa tâche ?",
  );
});

test("tâche contrôlée par défaut : un plan de réservations sous CYCLE 3, à toute profondeur", () => {
  const controls = readControlTasks(eraSs1Rows());
  assert.equal(controls.get(1004)?.chosen, false);
  assert.equal(controls.has(996), false);
  const nested = eraSs1Rows().concat(extraRow({ id: 2010, Taches: "SOUS-CYCLE", Nature: "Cycle", Parent: "1002" }));
  nested.find((row) => row.id === 1004).Parent = "2010";
  assert.equal(readControlTasks(nested).get(1004)?.chosen, false);
});

test("tâche contrôlée par défaut : un Parent vers un « CYCLE 3 » d'un autre étage ne compte pas", () => {
  // La tâche de réservations de SS1 (996) s'affiche directement dans SS1 quand son Parent vise
  // un cycle d'un autre étage : elle n'est alors pas contrôlée par défaut.
  const rows = eraSs1Rows().concat(extraRow({ id: 2020, Taches: "CYCLE 3", Nature: "Cycle", Groupe: "R+1" }));
  rows.find((row) => row.id === 996).Parent = "2020";
  const controls = readControlTasks(rows);
  assert.equal(controls.has(996), false);
  assert.equal(controls.get(1004)?.chosen, false);
});
