// Mode d'un cycle, escalier ou parallèle (module pur syntheseCycleModes.js) : lu dans les liens de
// son contenu direct, puis appliqué. Étage SS1 de la zone « Zone 1 / BAT BC » (ids 983 à 1008 et
// 1061) : CYCLE 1 (985) mélange les deux ; CYCLE 2 (992 : RECEPTION 993, PLAN SYT CYCLE 2 994,
// REUNION 998 en « 995 FD ») est en escalier ; PLAN SYT CYCLE 2 (994 : RESEAUX 995, RESERVATIONS
// 996 et TERMINAUX 997 en « 995 FF ») est en parallèle ; CYCLE 3 (999) mélange ; PLAN SYT CYCLE 3
// (1002) est en parallèle.
import test from "node:test";
import assert from "node:assert/strict";

import * as model from "../assets/js/services/syntheseTaskModel.js";

const { buildRowModel, buildSections } = model;
import { applyCycleModes, cycleModes, parallelPilot, planCycleMode, planParallelRealign } from "../assets/js/services/syntheseCycleModes.js";
import { planCycleMove, planCycleRemoval } from "../assets/js/services/syntheseCycles.js";
import { planTaskInsert, planTaskMove, planTaskRemoval } from "../assets/js/services/syntheseTaskOrder.js";
import { ERA_ZONE, ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

const plan = (groupRowId, mode, { rows = eraSs1Rows(), canLink = true } = {}) => planCycleMode({
  sections: buildSections({ rows }), groupRowId, mode, canLink,
});
// Valeurs d'une colonne dans les changements, par ligne (seulement les lignes qui l'écrivent).
const column = (changes, name) => Object.fromEntries(
  [...changes].filter(([, fields]) => name in fields).map(([rowId, fields]) => [rowId, fields[name]]),
);
const withRows = (rows, fieldsById) => rows.map((row) => (fieldsById[row.id] ? { ...row, ...fieldsById[row.id] } : row));
const applied = (rows, changes) => rows.map((row) => (changes.has(row.id) ? { ...row, ...changes.get(row.id) } : row));
// Une ligne de cycle de l'étage SS1, à ajouter aux lignes de l'export.
const cycleRow = (id, name, parent = "", nature = parent ? "Sous-groupe" : "Cycle") => ({
  id, NomProjet: "ERA QUAI D'ORSAY", Zone: ERA_ZONE, Groupe: "SS1", Taches: name, Type_doc: "", ID2: "",
  Etage: false, Nature: nature, Parent: parent, Lien: "", Ordre: "", Duree_1: 0, Diff_coffrage: null,
  Diff_armature: null, Service: "Synthese",
});
// Une boucle dans les liens (lien sur soi-même compris) ?
function hasLoop(rows) {
  const preds = new Map(rows.map((row) => [row.id, Number.parseInt(row.Lien, 10) || null]));
  return [...preds.keys()].some((start) => {
    const seen = new Set();
    for (let current = start; current != null; current = preds.get(current) ?? null) {
      if (seen.has(current)) return true;
      seen.add(current);
    }
    return false;
  });
}

test("mode lu dans les liens : escalier, parallèle, ou mélange", () => {
  const modes = cycleModes(buildSections({ rows: eraSs1Rows() }));
  assert.deepEqual(Object.fromEntries([...modes].sort(([a], [b]) => a - b)), {
    985: "mixed", 992: "series", 994: "parallel", 999: "mixed", 1002: "parallel",
  });
});

test("moins de deux éléments : pas de mode ; un sous-cycle vide est ignoré", () => {
  const rows = [...eraSs1Rows(), cycleRow(2000, "VIDE"), cycleRow(2001, "SOUS-CYCLE VIDE", "994")];
  const modes = cycleModes(buildSections({ rows }));
  assert.equal(modes.has(2000), false);
  assert.equal(modes.has(2001), false);
  assert.equal(modes.get(994), "parallel");
  assert.equal(plan(2000, "series", { rows }).size, 0);
});

test("PLAN SYT CYCLE 2 en escalier : chaque tâche suit la précédente, la REUNION suit la dernière", () => {
  const changes = plan(994, "series");
  assert.deepEqual(column(changes, "Lien"), { 996: "995 FD", 997: "996 FD", 998: "997 FD" });
  assert.deepEqual(
    [996, 997, 998].map((rowId) => [changes.get(rowId).Diff_coffrage, changes.get(rowId).Diff_armature]),
    [["2025-12-23", "2025-12-24"], ["2025-12-26", "2025-12-29"], ["2025-12-29", "2025-12-29"]],
  );
  assert.equal(changes.get(1000).Diff_coffrage, "2025-12-30", "CYCLE 3 suit, en cascade");
});

test("retour en parallèle : les liens et les dates d'origine reviennent", () => {
  const rows = eraSs1Rows();
  const serial = applied(rows, plan(994, "series"));
  const changes = plan(994, "parallel", { rows: serial });
  assert.deepEqual(column(changes, "Lien"), { 996: "995 FF", 997: "995 FF", 998: "995 FD" });
  const back = applied(serial, changes);
  [995, 996, 997, 998, 1000, 1008].forEach((rowId) => {
    const [before, after] = [rows, back].map((list) => list.find((row) => row.id === rowId));
    assert.deepEqual(
      [after.Lien, after.Diff_coffrage, after.Diff_armature],
      [before.Lien, before.Diff_coffrage, before.Diff_armature],
      `ligne ${rowId}`,
    );
  });
});

test("aller-retour CYCLE 2 : escalier → parallèle → escalier rend les liens et les dates d'origine", () => {
  const rows = eraSs1Rows();
  const parallel = applied(rows, plan(992, "parallel"));
  const back = applied(parallel, plan(992, "series", { rows: parallel }));
  [993, 995, 996, 997, 998, 1000, 1008].forEach((rowId) => {
    const [before, after] = [rows, back].map((list) => list.find((row) => row.id === rowId));
    assert.deepEqual(
      [after.Lien, after.Diff_coffrage, after.Diff_armature],
      [before.Lien, before.Diff_coffrage, before.Diff_armature],
      `ligne ${rowId}`,
    );
  });
});

// Fins de toutes les tâches d'un cycle, à toute profondeur, une fois les changements appliqués.
const cycleEnds = (rows, groupRowId) => new Set(
  model.findGroup(buildSections({ rows }), groupRowId).tasks.map((task) => task.end.getTime()),
);

test("parallèle : toutes les tâches du cycle finissent le même jour, un sous-cycle en escalier compris", () => {
  const serialSub = applied(eraSs1Rows(), plan(994, "series"));
  const changes = plan(992, "parallel", { rows: serialSub });
  const after = applied(serialSub, changes);
  assert.equal(cycleEnds(after, 992).size, 1);
  assert.equal(after.find((row) => row.id === 998).Diff_armature, "2025-12-15");
  assert.deepEqual(column(changes, "Lien"), { 995: "993 FF", 996: "995 FF", 997: "995 FF", 998: "993 FF", 1000: "993 FD" });
  const modes = cycleModes(buildSections({ rows: after }));
  assert.equal(modes.get(992), "parallel");
  assert.equal(modes.get(994), "parallel", "le sous-cycle est passé en parallèle lui aussi");
});

test("parallèle : un sous-sous-cycle en escalier est aligné aussi, autour de sa propre tâche pilote", () => {
  // RESERVATIONS puis TERMINAUX, en escalier, dans un sous-sous-cycle de PLAN SYT CYCLE 2.
  const rows = withRows([...eraSs1Rows(), cycleRow(2010, "SOUS-SOUS", "994")], {
    996: { Parent: "2010" },
    997: { Parent: "2010", Lien: "996 FD", Diff_coffrage: "2025-12-23", Diff_armature: "2025-12-24" },
  });
  const changes = plan(992, "parallel", { rows });
  const after = applied(rows, changes);
  assert.equal(cycleEnds(after, 992).size, 1);
  assert.equal(changes.get(997).Lien, "996 FF");
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(992), modes.get(994)], ["parallel", "parallel"]);
});

test("premier élément sous-cycle : la tâche pilote est sa première tâche, tout finit avec elle", () => {
  // PLAN SYT CYCLE 2, passé en escalier, devient le premier élément de CYCLE 2, en escalier :
  // RESEAUX suit la fin de CYCLE 1, la RECEPTION suit TERMINAUX, la REUNION suit la RECEPTION.
  const serialSub = applied(eraSs1Rows(), plan(994, "series"));
  const rows = withRows(serialSub, {
    994: { Ordre: "1" },
    993: { Ordre: "2", Lien: "997 FD" },
    998: { Ordre: "3", Lien: "993 FD" },
    995: { Lien: "991 FD" },
  });
  const changes = plan(992, "parallel", { rows });
  assert.deepEqual(column(changes, "Lien"), {
    993: "995 FF", 996: "995 FF", 997: "995 FF", 998: "995 FF", 1000: "995 FD",
  });
  assert.equal(cycleEnds(applied(rows, changes), 992).size, 1);
});

test("un FF décalé ne fait pas un parallèle ; passer en parallèle remet le décalage à zéro", () => {
  const rows = withRows(eraSs1Rows(), { 996: { Lien: "995 FF+2", Diff_coffrage: "2025-12-23", Diff_armature: "2025-12-24" } });
  assert.equal(cycleModes(buildSections({ rows })).get(994), "mixed");
  const changes = plan(994, "parallel", { rows });
  assert.equal(changes.get(996).Lien, "995 FF");
  assert.equal(changes.get(996).Diff_armature, "2025-12-22");
});

test("une Fin qui ne suit plus la tâche pilote : lu mélangé, et repasser en parallèle la réaligne", () => {
  const rows = withRows(eraSs1Rows(), { 997: { Diff_coffrage: "2025-12-22", Diff_armature: "2025-12-23" } });
  assert.equal(cycleModes(buildSections({ rows })).get(994), "mixed");
  const changes = plan(994, "parallel", { rows });
  assert.equal("Lien" in (changes.get(997) || {}), false);
  assert.deepEqual([changes.get(997).Diff_coffrage, changes.get(997).Diff_armature], ["2025-12-19", "2025-12-22"]);
});

test("CYCLE 2 en parallèle : tout finit avec la RECEPTION, CYCLE 3 la suit", () => {
  const changes = plan(992, "parallel");
  assert.deepEqual(column(changes, "Lien"), { 995: "993 FF", 998: "993 FF", 1000: "993 FD" });
  assert.equal(changes.get(995).Diff_coffrage, "2025-12-09");
  assert.equal(changes.get(995).Diff_armature, "2025-12-15");
  assert.equal(changes.get(996).Diff_armature, "2025-12-15", "RESERVATIONS garde son FF sur RESEAUX");
  assert.equal(changes.get(998).Diff_coffrage, "2025-12-15");
  assert.equal(changes.get(1000).Diff_coffrage, "2025-12-16");
});

test("cycle mélangé en escalier : seuls les liens qui ne suivent pas déjà le précédent changent", () => {
  const changes = plan(999, "series");
  assert.deepEqual(column(changes, "Lien"), { 1003: "1001 FD", 1007: "1006 FD" });
});

test("un décalage est gardé quand la tâche suit déjà le bon prédécesseur avec le même type", () => {
  const rows = withRows(eraSs1Rows(), { 1001: { Lien: "1000 FD+2" } });
  const changes = plan(999, "series", { rows });
  assert.equal("Lien" in (changes.get(1001) || {}), false);
});

test("jamais de boucle : un lien qui en fermerait une n'est pas posé", () => {
  // La RECEPTION de CYCLE 2 dépend de sa REUNION, qui n'a plus de lien.
  const rows = withRows(eraSs1Rows(), { 993: { Lien: "998 FD" }, 998: { Lien: "" } });
  const changes = plan(992, "parallel", { rows });
  assert.equal("Lien" in (changes.get(998) || {}), false, "998 suivrait 993, qui la suit déjà");
  assert.equal(changes.get(995).Lien, "993 FF");
  assert.equal(hasLoop(applied(rows, changes)), false);
});

test("sans la colonne Lien, ou mode inconnu : rien", () => {
  assert.equal(plan(994, "series", { canLink: false }).size, 0);
  assert.equal(plan(994, "diagonale").size, 0);
  assert.equal(plan(9999, "series").size, 0);
});

test("lignes du tableau : chaque ligne de cycle porte son mode, les autres aucun", () => {
  const sections = buildSections({ rows: eraSs1Rows() });
  const lines = applyCycleModes(buildRowModel(sections), cycleModes(sections));
  const modeOf = (key) => lines.find((line) => line.key === key).cycleMode;
  assert.equal(modeOf("group:994"), "parallel");
  assert.equal(modeOf("group:992"), "series");
  assert.equal(modeOf("group:985"), "mixed");
  assert.equal(modeOf("task:995"), null);
  assert.equal(modeOf("floor:zone1batbc/ss1"), null);
});

test("tâche pilote d'un cycle en parallèle : celle avec qui une tâche ajoutée finira", () => {
  const sections = buildSections({ rows: eraSs1Rows() });
  assert.equal(parallelPilot(sections, 994), 995);
  assert.equal(parallelPilot(sections, 992), null, "CYCLE 2 est en escalier");
  assert.equal(parallelPilot(sections, 9999), null);
});

test("ajout dans un sous-cycle pris dans un cycle en parallèle : la première tâche du plus proche qui en a une", () => {
  const taskIn = (id, parent) => ({ ...eraSs1Rows().find((row) => row.id === 997), id, Parent: parent, Ordre: "1" });
  const rows = [
    ...eraSs1Rows(),
    cycleRow(2040, "VIDE", "994"), cycleRow(2041, "UNE TÂCHE", "994"), taskIn(2042, "2041"),
    cycleRow(2043, "VIDE SOUS CYCLE 2", "992"),
  ].map((row) => ({ ...row, Ordre: { 995: "1", 996: "2", 997: "3", 2040: "4", 2041: "5" }[row.id] ?? row.Ordre }));
  const sections = buildSections({ rows });
  assert.equal(parallelPilot(sections, 2040), 995, "sous-cycle vide après les tâches : la tâche pilote du cycle");
  assert.equal(parallelPilot(sections, 2041), 2042, "sous-cycle d'une tâche : celle-ci");
  assert.equal(parallelPilot(sections, 2043), null, "CYCLE 2 est en escalier");
  const atTop = buildSections({ rows: withRows(rows, { 2040: { Ordre: "0" } }) });
  assert.equal(parallelPilot(atTop, 2040), 995, "en tête aussi : la tâche pilote du cycle, la plus longue");
});

test("ajouter une tâche dans un cycle en parallèle : elle finit avec la tâche pilote", () => {
  const sections = buildSections({ rows: eraSs1Rows() });
  const insert = planTaskInsert({
    sections, container: { zoneKey: ERA_ZONE_KEY, floorKey: "ss1", groupRowId: 994 },
    canOrder: true, canLink: true, finishWith: 995, today: new Date(2026, 9, 21),
  });
  assert.equal(insert.fields.Lien, "995 FF");
  assert.deepEqual([insert.fields.Diff_coffrage, insert.fields.Diff_armature, insert.fields.Duree_1], ["2025-12-22", "2025-12-22", 1]);
  assert.equal(insert.follow, null, "la tâche du dessous ne se raccroche pas à elle");
});

test("après un glisser dans un cycle en parallèle : la tâche glissée finit avec la tâche pilote", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994 };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 1061, target, canOrder: true, canLink: true }));
  const changes = planParallelRealign({ before, rows: moved, canLink: true });
  assert.equal(changes.get(1061).Lien, "995 FF");
  const after = applied(moved, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
});

test("après la suppression de la tâche pilote : la suivante prend sa place et son lien d'entrée", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const removal = planTaskRemoval({ sections: before, taskId: 995, canLink: true });
  const remaining = applied(rows.filter((row) => row.id !== 995), removal);
  const changes = planParallelRealign({ before, rows: remaining, canLink: true });
  // RESERVATIONS, nouvelle tâche pilote, suit la RECEPTION (16/12 → 17/12) ; la REUNION la suit.
  assert.deepEqual(column(changes, "Lien"), { 996: "993 FD", 997: "996 FF", 998: "996 FD" });
  const after = applied(remaining, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
  assert.deepEqual(["Diff_coffrage", "Diff_armature"].map((name) => changes.get(996)[name]), ["2025-12-16", "2025-12-17"]);
  assert.equal(changes.get(998).Diff_coffrage, "2025-12-17");
});

test("la tâche pilote glissée hors du cycle : la suivante prend sa place, la REUNION la suit", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 985 };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 995, target, canOrder: true, canLink: true }));
  const changes = planParallelRealign({ before, rows: moved, canLink: true });
  assert.deepEqual(column(changes, "Lien"), { 996: "993 FD", 997: "996 FF", 998: "996 FD" });
  const after = applied(moved, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
  assert.equal(hasLoop(after), false);
});

test("la tâche pilote glissée en bas de son propre cycle : toujours la plus longue, elle reste la tâche pilote", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994, position: { taskId: 997, side: "after" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 995, target, canOrder: true, canLink: true }));
  const changes = planParallelRealign({ before, rows: moved, canLink: true });
  const after = applied(moved, changes);
  assert.deepEqual(Object.fromEntries([995, 996, 997, 998].map((rowId) => [rowId, after.find((row) => row.id === rowId).Lien])), {
    995: "993 FD", 996: "995 FF", 997: "995 FF", 998: "995 FD",
  });
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
});

test("le sous-cycle de la tâche pilote glissé en fin de cycle : le cycle reste en parallèle", () => {
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    995: { Parent: "2030" }, 996: { Parent: "2030" }, 2030: { Ordre: "1" }, 997: { Ordre: "2" },
  });
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994 };
  const moved = applied(rows, planCycleMove({ sections: before, groupRowId: 2030, target, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(994), modes.get(2030)], ["parallel", "parallel"]);
  assert.equal(cycleEnds(after, 994).size, 1);
  assert.equal(hasLoop(after), false);
});

test("une tâche glissée en tête d'un cycle en parallèle finit avec la tâche pilote, qui garde son lien d'entrée", () => {
  const rows = withRows(eraSs1Rows(), { 995: { Lien: "993 FD+2" } });
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994, position: { taskId: 995, side: "before" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 1061, target, canOrder: true, canLink: true }));
  const changes = planParallelRealign({ before, rows: moved, canLink: true });
  const after = applied(moved, changes);
  // « test » (1 jour) est plus courte que RESEAUX (5 jours), qui reste la tâche pilote.
  assert.deepEqual([1061, 995, 996, 997].map((rowId) => after.find((row) => row.id === rowId).Lien), [
    "995 FF", "993 FD+2", "995 FF", "995 FF",
  ]);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
});

test("un sous-cycle en escalier glissé dans un cycle en parallèle : il y est bâti en parallèle", () => {
  // SIGNATURE puis DEMARRAGE, en escalier, dans un sous-cycle de CYCLE 3, glissé à la fin de PLAN SYT CYCLE 2.
  const rows = withRows([...eraSs1Rows(), cycleRow(2020, "SOUS-CYCLE", "999")], {
    1007: { Parent: "2020" }, 1008: { Parent: "2020" },
  });
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994 };
  const moved = applied(rows, planCycleMove({ sections: before, groupRowId: 2020, target, canLink: true }));
  const changes = planParallelRealign({ before, rows: moved, canLink: true });
  assert.deepEqual([changes.get(1007).Lien, changes.get(1008).Lien], ["995 FF", "1007 FF"]);
  const after = applied(moved, changes);
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(994), modes.get(2020)], ["parallel", "parallel"]);
  assert.equal(cycleEnds(after, 994).size, 1);
});

test("la tâche pilote d'un sous-cycle supprimée : le cycle et le sous-cycle restent en parallèle", () => {
  // RESEAUX et RESERVATIONS dans un sous-sous-cycle en tête de PLAN SYT CYCLE 2, bâti en parallèle.
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    995: { Parent: "2030" }, 996: { Parent: "2030" }, 2030: { Ordre: "1" }, 997: { Ordre: "2" },
  });
  const before = buildSections({ rows });
  assert.deepEqual([cycleModes(before).get(994), cycleModes(before).get(2030)], ["parallel", "parallel"]);
  const removal = planTaskRemoval({ sections: before, taskId: 995, canLink: true });
  const remaining = applied(rows.filter((row) => row.id !== 995), removal);
  const changes = planParallelRealign({ before, rows: remaining, canLink: true });
  assert.deepEqual(column(changes, "Lien"), { 996: "993 FD", 997: "996 FF", 998: "996 FD" });
  const after = applied(remaining, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
});

test("un cycle qui reste en parallèle, ou qui ne l'était pas : rien", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  assert.equal(planParallelRealign({ before, rows, canLink: true }).size, 0);
  const removal = planTaskRemoval({ sections: before, taskId: 996, canLink: true });
  assert.equal(planParallelRealign({ before, rows: applied(rows.filter((row) => row.id !== 996), removal), canLink: true }).size, 0);
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 994 };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 1061, target, canOrder: true, canLink: true }));
  assert.equal(planParallelRealign({ before, rows: moved }).size, 0, "sans Lien");
});

// Règle de la tâche pilote : dans un cycle en parallèle, c'est la tâche la plus longue (à toute
// profondeur ; à égalité, l'ancienne tâche pilote, sinon la première). Elle suit la tâche d'avant le
// cycle ; toutes les autres finissent avec elle : aucune ne commence avant la Fin de la tâche d'avant.
// PLAN SYT CYCLE 2 après RECEPTIONS passée à 8 jours (16/12 → 26/12, Noël compris) : RESEAUX,
// RESERVATIONS et la REUNION la suivent.
const RESA_PILOT = {
  996: { Lien: "993 FD", Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-26", Duree_1: 8 },
  995: { Lien: "996 FF", Diff_coffrage: "2025-12-19", Diff_armature: "2025-12-26" },
  997: { Lien: "996 FF", Diff_coffrage: "2025-12-24", Diff_armature: "2025-12-26" },
  998: { Lien: "996 FD", Diff_coffrage: "2025-12-26", Diff_armature: "2025-12-26" },
};
const linksOf = (rows, ids) => Object.fromEntries(ids.map((rowId) => [rowId, rows.find((row) => row.id === rowId).Lien]));
const datesOf = (changes, rowId) => [changes.get(rowId).Diff_coffrage, changes.get(rowId).Diff_armature];

test("une tâche d'un cycle en parallèle allongée au-delà de la tâche pilote en devient la tâche pilote", () => {
  // RESERVATIONS (996) passe de 2 à 8 jours : en fin → fin, elle commençait le 11/12, en pleine RECEPTION.
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const edited = withRows(rows, { 996: { Diff_coffrage: "2025-12-11", Diff_armature: "2025-12-22", Duree_1: 8 } });
  const changes = planParallelRealign({ before, rows: edited, canLink: true });
  assert.deepEqual(column(changes, "Lien"), { 995: "996 FF", 996: "993 FD", 997: "996 FF", 998: "996 FD" });
  // Le lendemain de la Fin de RECEPTION (15/12) : 16/12 → 26/12 ; les autres finissent avec elle.
  assert.deepEqual(datesOf(changes, 996), ["2025-12-16", "2025-12-26"]);
  assert.deepEqual(datesOf(changes, 995), ["2025-12-19", "2025-12-26"]);
  assert.deepEqual(datesOf(changes, 997), ["2025-12-24", "2025-12-26"]);
  assert.deepEqual(datesOf(changes, 998), ["2025-12-26", "2025-12-26"]);
  // CYCLE 3 suit : RECEPTION du 29/12 au 05/01 (1er janvier férié).
  assert.deepEqual(datesOf(changes, 1000), ["2025-12-29", "2026-01-05"]);
  const after = applied(edited, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
});

test("la tâche pilote raccourcie : la plus longue (la première à égalité) prend sa place", () => {
  // RESEAUX (995) passe à 1 jour (16/12) ; RESERVATIONS et TERMINAUX, 2 jours, finissaient avec elle.
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const edited = withRows(rows, {
    995: { Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-16", Duree_1: 1 },
    996: { Diff_coffrage: "2025-12-15", Diff_armature: "2025-12-16" },
    997: { Diff_coffrage: "2025-12-15", Diff_armature: "2025-12-16" },
    998: { Diff_coffrage: "2025-12-16", Diff_armature: "2025-12-16" },
  });
  const changes = planParallelRealign({ before, rows: edited, canLink: true });
  assert.deepEqual(column(changes, "Lien"), { 995: "996 FF", 996: "993 FD", 997: "996 FF", 998: "996 FD" });
  assert.deepEqual(datesOf(changes, 996), ["2025-12-16", "2025-12-17"]);
});

test("une durée changée sans changer la plus longue, ou dans un autre cycle : rien", () => {
  // PLAN SYT CYCLE 3 (1002) a une RESERVATIONS de 8 jours, plus longue que sa tâche pilote : il n'est
  // pas touché quand TERMINAUX de PLAN SYT CYCLE 2 passe à 3 jours.
  const rows = withRows(eraSs1Rows(), { 1004: { Diff_coffrage: "2025-12-26", Diff_armature: "2026-01-07", Duree_1: 8 } });
  const before = buildSections({ rows });
  const edited = withRows(rows, { 997: { Diff_coffrage: "2025-12-18", Diff_armature: "2025-12-22", Duree_1: 3 } });
  assert.equal(planParallelRealign({ before, rows: edited, canLink: true }).size, 0);
});

test("une tâche pilote qui n'est pas la première : cycle lu en parallèle, CYCLE 2 toujours en escalier", () => {
  const rows = withRows(eraSs1Rows(), RESA_PILOT);
  const sections = buildSections({ rows });
  const modes = cycleModes(sections);
  assert.deepEqual([modes.get(994), modes.get(992)], ["parallel", "series"]);
  assert.equal(parallelPilot(sections, 994), 996, "une tâche ajoutée finit avec RESERVATIONS");
  // L'affichage garde l'ordre RESEAUX, RESERVATIONS, TERMINAUX.
  const keys = buildRowModel(sections).map((line) => line.key);
  assert.deepEqual(keys.slice(keys.indexOf("group:994") + 1, keys.indexOf("group:994") + 4), ["task:995", "task:996", "task:997"]);
});

test("passer en parallèle : la tâche la plus longue est la tâche pilote, elle prend le lien d'entrée", () => {
  // TERMINAUX (997), 7 jours, suit RESERVATIONS en fin → début : PLAN SYT CYCLE 2 est mélangé.
  const rows = withRows(eraSs1Rows(), { 997: { Lien: "996 FD", Diff_coffrage: "2025-12-23", Diff_armature: "2026-01-02", Duree_1: 7 } });
  assert.equal(cycleModes(buildSections({ rows })).get(994), "mixed");
  const changes = plan(994, "parallel", { rows });
  assert.deepEqual(column(changes, "Lien"), { 995: "997 FF", 996: "997 FF", 997: "993 FD", 998: "997 FD" });
  assert.deepEqual(datesOf(changes, 997), ["2025-12-16", "2025-12-24"]);
  assert.deepEqual(datesOf(changes, 995), ["2025-12-18", "2025-12-24"]);
  assert.deepEqual(datesOf(changes, 998), ["2025-12-24", "2025-12-24"]);
  const modes = cycleModes(buildSections({ rows: applied(rows, changes) }));
  assert.deepEqual([modes.get(994), modes.get(992)], ["parallel", "series"]);
});

test("passer en escalier depuis une tâche pilote qui n'est pas la première : l'ordre affiché, du haut vers le bas", () => {
  const rows = withRows(eraSs1Rows(), RESA_PILOT);
  const changes = plan(994, "series", { rows });
  const after = applied(rows, changes);
  assert.deepEqual(linksOf(after, [995, 996, 997, 998]), { 995: "993 FD", 996: "995 FD", 997: "996 FD", 998: "997 FD" });
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "series");
  assert.equal(hasLoop(after), false);
});

test("une tâche glissée juste au-dessus d'un cycle en parallèle : sa tâche pilote la suit", () => {
  // « test » (1061) glissée dans CYCLE 2 sous la RECEPTION, donc juste au-dessus de PLAN SYT CYCLE 2.
  const rows = withRows(eraSs1Rows(), RESA_PILOT);
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 992, position: { taskId: 993, side: "after" } };
  const changes = planTaskMove({ sections: before, taskId: 1061, target, canOrder: true, canLink: true });
  assert.equal(changes.get(1061).Lien, "993 FD");
  assert.equal(changes.get(996).Lien, "1061 FD", "la tâche pilote suit la tâche glissée");
  // 1061 le 16/12 (1 jour) ; RESERVATIONS 8 jours du 17/12 au 29/12.
  assert.deepEqual(datesOf(changes, 996), ["2025-12-17", "2025-12-29"]);
  assert.equal("Lien" in (changes.get(995) || {}), false);
  const after = applied(rows, changes);
  assert.equal(planParallelRealign({ before, rows: after, canLink: true }).size, 0);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
});

test("un cycle en parallèle glissé ailleurs : sa tâche pilote suit la nouvelle place, la chaîne se referme", () => {
  const rows = withRows(eraSs1Rows(), RESA_PILOT);
  const before = buildSections({ rows });
  const target = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 999 };
  const changes = planCycleMove({ sections: before, groupRowId: 994, target, canLink: true });
  assert.deepEqual(column(changes, "Lien"), { 996: "1008 FD", 998: "993 FD" });
  const after = applied(rows, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(hasLoop(after), false);
});

// Constats de la relecture : chaîne autour d'un cycle en parallèle, sous-cycles, données anciennes.
const SS1 = { zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1" };

test("la tâche pilote partagée par un cycle et son sous-cycle supprimée : chacun garde la sienne, la plus longue", () => {
  // PLAN SYT CYCLE 2 (994) : sous-cycle 2030 = [RESEAUX 995 (5 j, tâche pilote des deux), RESERVATIONS
  // 996 (2 j)], puis TERMINAUX 997 à 4 jours (17/12 → 22/12).
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    995: { Parent: "2030" }, 996: { Parent: "2030" }, 2030: { Ordre: "1" },
    997: { Ordre: "2", Diff_coffrage: "2025-12-17", Diff_armature: "2025-12-22", Duree_1: 4 },
  });
  const before = buildSections({ rows });
  assert.deepEqual([cycleModes(before).get(994), cycleModes(before).get(2030)], ["parallel", "parallel"]);
  const removal = planTaskRemoval({ sections: before, taskId: 995, canLink: true });
  const remaining = applied(rows.filter((row) => row.id !== 995), removal);
  const changes = planParallelRealign({ before, rows: remaining, canLink: true });
  // TERMINAUX, la plus longue (4 jours), suit la RECEPTION : 16/12 → 19/12 ; RESERVATIONS finit avec elle.
  assert.deepEqual(column(changes, "Lien"), { 996: "997 FF", 997: "993 FD", 998: "997 FD" });
  assert.deepEqual(datesOf(changes, 997), ["2025-12-16", "2025-12-19"]);
  const after = applied(remaining, changes);
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "parallel");
  assert.equal(cycleEnds(after, 994).size, 1);
});

test("la dernière tâche d'un cycle en parallèle glissée juste sous lui : elle le suit, la REUNION la suit", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const target = { ...SS1, groupRowId: 992, position: { taskId: 998, side: "before" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 997, target, canOrder: true, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  assert.deepEqual(linksOf(after, [995, 996, 997, 998]), { 995: "993 FD", 996: "995 FF", 997: "995 FD", 998: "997 FD" });
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(994), modes.get(992)], ["parallel", "series"]);
});

test("la tâche pilote glissée juste au-dessus de son cycle : le cycle la suit, autour de sa nouvelle tâche pilote", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const target = { ...SS1, groupRowId: 992, position: { taskId: 993, side: "after" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 995, target, canOrder: true, canLink: true }));
  const changes = planParallelRealign({ before, rows: moved, canLink: true });
  const after = applied(moved, changes);
  assert.deepEqual(linksOf(after, [995, 996, 997, 998]), { 995: "993 FD", 996: "995 FD", 997: "996 FF", 998: "996 FD" });
  // RESEAUX 16/12 → 22/12, puis RESERVATIONS et TERMINAUX 23/12 → 24/12, la REUNION le 24/12.
  assert.deepEqual(datesOf(changes, 996), ["2025-12-23", "2025-12-24"]);
  assert.deepEqual(datesOf(changes, 998), ["2025-12-24", "2025-12-24"]);
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(994), modes.get(992)], ["parallel", "series"]);
});

test("cycle mélangé dont le lien d'entrée n'est pas sur la première tâche : passer en escalier, ou le supprimer", () => {
  const rows = withRows(eraSs1Rows(), { ...RESA_PILOT, 997: { ...RESA_PILOT[997], Lien: "996 FD" } });
  assert.equal(cycleModes(buildSections({ rows })).get(994), "mixed");
  const after = applied(rows, plan(994, "series", { rows }));
  assert.deepEqual(linksOf(after, [995, 996, 997, 998]), { 995: "993 FD", 996: "995 FD", 997: "996 FD", 998: "997 FD" });
  assert.equal(cycleModes(buildSections({ rows: after })).get(994), "series");
  // Supprimé, la chaîne se referme : la REUNION reprend le lien d'entrée du cycle.
  const removal = planCycleRemoval({ sections: buildSections({ rows }), groupRowId: 994, canLink: true });
  assert.equal(removal.get(998).Lien, "993 FD");
});

test("la tâche juste sous un cycle en parallèle supprimée, glissée ailleurs ou précédée d'une autre : la chaîne suit le cycle", () => {
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  // La REUNION (998, « 995 FD ») supprimée : la RECEPTION de CYCLE 3 (1000) suit RESEAUX, la tâche pilote.
  assert.equal(planTaskRemoval({ sections: before, taskId: 998, canLink: true }).get(1000).Lien, "995 FD");
  // Glissée à la fin de CYCLE 1 : de même.
  const away = planTaskMove({ sections: before, taskId: 998, target: { ...SS1, groupRowId: 985 }, canOrder: true, canLink: true });
  assert.equal(away.get(1000).Lien, "995 FD");
  // « test » (1061) glissée entre PLAN SYT CYCLE 2 et la REUNION : elle suit RESEAUX, la REUNION la suit.
  const between = { ...SS1, groupRowId: 992, position: { taskId: 998, side: "before" } };
  const inserted = planTaskMove({ sections: before, taskId: 1061, target: between, canOrder: true, canLink: true });
  assert.deepEqual([inserted.get(1061).Lien, inserted.get(998).Lien], ["995 FD", "1061 FD"]);
  // Puis TERMINAUX supprimée : « test » garde son lien.
  const placed = applied(rows, inserted);
  const removal = planTaskRemoval({ sections: buildSections({ rows: placed }), taskId: 997, canLink: true });
  assert.equal("Lien" in (removal.get(1061) || {}), false);
  // « Ajouter une tâche » à la fin de CYCLE 2, quand PLAN SYT CYCLE 2 en est le dernier élément : elle
  // suit RESEAUX, et la REUNION (passée en tête de CYCLE 3) la suivra.
  const lastIsCycle = withRows(rows, { 998: { Parent: "999", Ordre: "0" } });
  const insert = planTaskInsert({
    sections: buildSections({ rows: lastIsCycle }), container: { zoneKey: ERA_ZONE_KEY, floorKey: "ss1", groupRowId: 992 },
    canOrder: true, canLink: true, today: new Date(2026, 9, 21),
  });
  assert.equal(insert.fields.Lien, "995 FD");
  assert.equal(insert.follow?.successorId, 998);
});

test("cycle ancien dont la tâche pilote n'est pas la plus longue : un glisser dedans la remet à la plus longue", () => {
  // RESERVATIONS (996) à 8 jours finit avec RESEAUX (5 jours), encore tâche pilote.
  const legacy = withRows(eraSs1Rows(), { 996: { Diff_coffrage: "2025-12-11", Diff_armature: "2025-12-22", Duree_1: 8 } });
  const before = buildSections({ rows: legacy });
  const pilotAfter = (taskId, position) => {
    const target = { ...SS1, groupRowId: 994, position };
    const moved = applied(legacy, planTaskMove({ sections: before, taskId, target, canOrder: true, canLink: true }));
    const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
    return parallelPilot(buildSections({ rows: after }), 994);
  };
  assert.equal(pilotAfter(996, { taskId: 997, side: "after" }), 996);
  assert.equal(pilotAfter(997, { taskId: 996, side: "before" }), 996);
  assert.equal(pilotAfter(995, { taskId: 997, side: "after" }), 996);
});

test("jamais de boucle : la tâche sous un cycle ne suit pas une tâche glissée au-dessus d'elle qui dépend d'elle", () => {
  // TERMINAUX (997) dépend de la RECEPTION de CYCLE 3 (1000), qui suit la REUNION (998) : « test »
  // (1061), glissée entre PLAN SYT CYCLE 2 et la REUNION, suit TERMINAUX ; la REUNION garde son lien.
  const rows = withRows(eraSs1Rows(), { 997: { Lien: "1000 FD" } });
  const before = buildSections({ rows });
  const target = { ...SS1, groupRowId: 992, position: { taskId: 998, side: "before" } };
  const changes = planTaskMove({ sections: before, taskId: 1061, target, canOrder: true, canLink: true });
  assert.equal(changes.get(1061).Lien, "997 FD");
  assert.equal("Lien" in (changes.get(998) || {}), false);
  assert.equal(hasLoop(applied(rows, changes)), false);
});

test("tâche glissée dans un sous-cycle d'un cycle en parallèle, plus longue que les siennes : le sous-cycle se rebâtit autour d'elle", () => {
  // PLAN SYT CYCLE 2 : sous-cycle 2030 [RESERVATIONS 996, 2 j], RESEAUX 995 (tâche pilote, 5 j),
  // TERMINAUX 997. « test » (1061, 3 j) glissée dans 2030 sous RESERVATIONS la suit d'abord en fin → début.
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    996: { Parent: "2030" }, 2030: { Ordre: "1" }, 995: { Ordre: "2" }, 997: { Ordre: "3" },
    1061: { Duree_1: 3, Diff_coffrage: "2025-12-02", Diff_armature: "2025-12-04" },
  });
  const before = buildSections({ rows });
  assert.equal(cycleModes(before).get(994), "parallel");
  const target = { ...SS1, groupRowId: 2030, position: { taskId: 996, side: "after" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 1061, target, canOrder: true, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  assert.deepEqual(linksOf(after, [995, 996, 997, 1061]), { 995: "993 FD", 996: "1061 FF", 997: "995 FF", 1061: "995 FF" });
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(994), modes.get(2030)], ["parallel", "parallel"]);
  assert.equal(cycleEnds(after, 994).size, 1);
  assert.equal(hasLoop(after), false);
});

// Seconde relecture : cycle en parallèle de deux tâches dont la tâche pilote part (la restante finit
// encore avec elle, en FF vers une tâche hors du cycle).
const twoTasks = () => eraSs1Rows().filter((row) => row.id !== 997);

test("cycle en parallèle de deux tâches, sa tâche pilote glissée ailleurs : la restante reprend le lien d'entrée", () => {
  const rows = twoTasks();
  const before = buildSections({ rows });
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 995, target: { ...SS1, groupRowId: 999 }, canOrder: true, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  assert.deepEqual(linksOf(after, [996, 998]), { 996: "993 FD", 998: "996 FD" });
});

test("cycle en parallèle de deux tâches, sa tâche pilote glissée juste au-dessus : le cycle la suit", () => {
  const rows = twoTasks();
  const before = buildSections({ rows });
  const target = { ...SS1, groupRowId: 992, position: { taskId: 993, side: "after" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 995, target, canOrder: true, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  assert.deepEqual(linksOf(after, [995, 996, 998]), { 995: "993 FD", 996: "995 FD", 998: "996 FD" });
});

test("le sous-cycle de la tâche pilote glissé hors du cycle : la tâche restante reprend le lien d'entrée", () => {
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    995: { Parent: "2030" }, 996: { Parent: "2030" }, 2030: { Ordre: "1" }, 997: { Ordre: "2" },
  });
  const before = buildSections({ rows });
  const moved = applied(rows, planCycleMove({ sections: before, groupRowId: 2030, target: { ...SS1, groupRowId: 999 }, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  assert.deepEqual(linksOf(after, [995, 997, 998]), { 995: "1008 FD", 997: "993 FD", 998: "997 FD" });
  assert.equal(cycleModes(buildSections({ rows: after })).get(2030), "parallel");
});

test("un cycle glissé entre un cycle en parallèle et la tâche qui le suit : il suit la tâche pilote, la tâche le suit", () => {
  // CYCLE 1 (985, sortie VISA... la tâche que suit la RECEPTION de CYCLE 2 : 991) glissé dans CYCLE 2, avant la REUNION.
  const rows = eraSs1Rows();
  const before = buildSections({ rows });
  const target = { ...SS1, groupRowId: 992, position: { taskId: 998, side: "before" } };
  const changes = planCycleMove({ sections: before, groupRowId: 985, target, canLink: true });
  assert.deepEqual([changes.get(986).Lien, changes.get(998).Lien], ["995 FD", "991 FD"]);
  assert.equal(hasLoop(applied(rows, changes)), false);
});

test("cycle mélangé dont le lien d'entrée n'est pas sur la première tâche, glissé ailleurs : il n'est pas coupé", () => {
  const rows = withRows(eraSs1Rows(), { ...RESA_PILOT, 997: { ...RESA_PILOT[997], Lien: "996 FD" } });
  const changes = planCycleMove({ sections: buildSections({ rows }), groupRowId: 994, target: { ...SS1, groupRowId: 999 }, canLink: true });
  assert.deepEqual(column(changes, "Lien"), { 996: "1008 FD", 998: "993 FD" });
});

test("la tâche pilote d'un sous-cycle glissée dans le cycle parent, dont elle reste la tâche pilote : le sous-cycle finit avec elle", () => {
  // PLAN SYT CYCLE 2 : sous-cycle 2030 [RESEAUX 995 (pilote des deux), RESERVATIONS 996, TERMINAUX 997],
  // puis « test » (1061) qui finit avec RESEAUX. RESEAUX glissée hors de 2030, avant « test ».
  const rows = withRows([...eraSs1Rows(), cycleRow(2030, "SOUS-SOUS", "994")], {
    995: { Parent: "2030" }, 996: { Parent: "2030" }, 997: { Parent: "2030" }, 2030: { Ordre: "1" },
    1061: { Parent: "994", Ordre: "2", Lien: "995 FF", Diff_coffrage: "2025-12-22", Diff_armature: "2025-12-22", Duree_1: 1 },
  });
  const before = buildSections({ rows });
  assert.deepEqual([cycleModes(before).get(994), cycleModes(before).get(2030)], ["parallel", "parallel"]);
  const target = { ...SS1, groupRowId: 994, position: { taskId: 1061, side: "before" } };
  const moved = applied(rows, planTaskMove({ sections: before, taskId: 995, target, canOrder: true, canLink: true }));
  const after = applied(moved, planParallelRealign({ before, rows: moved, canLink: true }));
  assert.deepEqual(linksOf(after, [995, 996, 997, 1061]), { 995: "993 FD", 996: "995 FF", 997: "996 FF", 1061: "995 FF" });
  const modes = cycleModes(buildSections({ rows: after }));
  assert.deepEqual([modes.get(994), modes.get(2030)], ["parallel", "parallel"]);
});
