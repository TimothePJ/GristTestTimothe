// Règle du bloc : un cycle déplacé ou supprimé, avec son ordre, ses liens et ses dates (module pur
// syntheseCycles.js). Étage SS1 de la zone « Zone 1 / BAT BC » (ids 983 à 1008 et 1061) :
// RECEPTION ARCH/TOPO/STR 984, puis CYCLE 1 (985 : FOND DE PLAN 986 en « 984 DD » … REUNION 991),
// CYCLE 2 (992 : RECEPTION 993 en « 991 FD », PLAN SYT CYCLE 2 994 avec RESEAUX 995, RESERVATIONS
// 996 et TERMINAUX 997, REUNION 998 en « 995 FD ») et CYCLE 3 (999 : RECEPTION 1000 en « 998 FD »,
// VISA A 1001, PLAN SYT CYCLE 3 1002 avec 1003 à 1005, REUNION 1006 en « 1003 FD », SIGNATURE
// 1007, DEMARRAGE GO 1008).
import test from "node:test";
import assert from "node:assert/strict";

import { buildSections } from "../assets/js/services/syntheseTaskModel.js";
import { findContainer } from "../assets/js/services/syntheseTaskOrder.js";
import { planCycleMove, planCycleRemoval } from "../assets/js/services/syntheseCycles.js";
import { ERA_ZONE, ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";
import { templateRows } from "./helpers/templateRows.mjs";

const target = (groupRowId, position, fields = {}) => ({
  zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId,
  ...(position ? { position } : {}), ...fields,
});
const move = (groupRowId, cible, { rows = eraSs1Rows(), canLink = true } = {}) => planCycleMove({
  sections: buildSections({ rows }), groupRowId, target: cible, canLink,
});
const remove = (groupRowId, { canLink = true } = {}) => planCycleRemoval({
  sections: buildSections({ rows: eraSs1Rows() }), groupRowId, canLink,
});
// Valeurs d'une colonne dans les changements, par ligne (seulement les lignes qui l'écrivent).
const column = (changes, name) => Object.fromEntries(
  [...changes].filter(([, fields]) => name in fields).map(([rowId, fields]) => [rowId, fields[name]]),
);
const withRow = (rows, id, fields) => rows.map((row) => (row.id === id ? { ...row, ...fields } : row));
const withRows = (rows, fieldsById) => rows.map((row) => (fieldsById[row.id] ? { ...row, ...fieldsById[row.id] } : row));
// Une boucle dans les liens (lien sur soi-même compris), une fois les changements appliqués ?
function hasLoop(rows, changes) {
  const preds = new Map(rows.map((row) => [row.id, Number.parseInt(changes.get(row.id)?.Lien ?? row.Lien, 10) || null]));
  return [...preds.keys()].some((start) => {
    const seen = new Set();
    for (let current = start; current != null; current = preds.get(current) ?? null) {
      if (seen.has(current)) return true;
      seen.add(current);
    }
    return false;
  });
}

test("exemple 1 de la spec : CYCLE 3 au-dessus de CYCLE 2", () => {
  const changes = move(999, target(null, { groupRowId: 992, side: "before" }));
  assert.deepEqual(column(changes, "Ordre"), { 984: "1", 985: "2", 999: "3", 992: "4" });
  assert.deepEqual(changes.get(999), { Ordre: "3" }, "déjà un cycle de l'étage : ni Parent ni Nature");
  // La RECEPTION de CYCLE 3 suit la REUNION de CYCLE 1 ; celle de CYCLE 2 suit DEMARRAGE GO, la
  // dernière à finir de CYCLE 3 (à égalité avec SIGNATURE : la dernière dans l'ordre).
  assert.deepEqual(column(changes, "Lien"), { 1000: "991 FD", 993: "1008 FD" });
  assert.equal(changes.get(1000).Diff_coffrage, "2025-12-09");
  assert.equal(changes.get(1000).Diff_armature, "2025-12-15");
  assert.ok(changes.get(993).Diff_coffrage > changes.get(1008).Diff_armature, "CYCLE 2 recalé après CYCLE 3");
});

test("exemple 2 : CYCLE 2 au-dessus de CYCLE 1, reprise du lien d'entrée", () => {
  const changes = move(992, target(null, { groupRowId: 985, side: "before" }));
  assert.deepEqual(column(changes, "Ordre"), { 984: "1", 992: "2", 985: "3", 999: "4" });
  // CYCLE 2 reprend le « DD » du FOND DE PLAN sur la RECEPTION ; le FOND DE PLAN suit la REUNION
  // de CYCLE 2 ; à l'ancienne place, CYCLE 3 suit la REUNION de CYCLE 1.
  assert.deepEqual(column(changes, "Lien"), { 993: "984 DD", 986: "998 FD", 1000: "991 FD" });
  assert.equal(changes.get(993).Diff_coffrage, "2025-11-14");
});

test("exemple 3 : PLAN SYT CYCLE 2 en tête de CYCLE 3", () => {
  const changes = move(994, target(999, { taskId: 1000, side: "before" }));
  assert.deepEqual(changes.get(994), { Parent: "999", Ordre: "1" }, "toujours un sous-cycle : pas de Nature");
  assert.deepEqual(column(changes, "Ordre"), { 994: "1", 1000: "2", 1001: "3", 1002: "4", 1006: "5", 1007: "6", 1008: "7" });
  // La REUNION de CYCLE 2 reprend le lien d'entrée ; RESEAUX la suit et la RECEPTION de CYCLE 3
  // suit RESEAUX ; RESERVATIONS et TERMINAUX restent en FF sur RESEAUX.
  assert.deepEqual(column(changes, "Lien"), { 998: "993 FD", 995: "998 FD", 1000: "995 FD" });
});

test("CYCLE 2 à la fin de CYCLE 1 : il devient sous-cycle, la chaîne est déjà bonne", () => {
  assert.deepEqual([...move(992, target(985))], [[992, { Parent: "985", Nature: "Sous-groupe", Ordre: "8" }]]);
});

test("ordre de chaîne inchangé : ni lien ni date, même avec une entrée DD", () => {
  const rows = withRow(eraSs1Rows(), 993, { Lien: "984 DD" });
  assert.deepEqual([...move(992, target(985), { rows })], [[992, { Parent: "985", Nature: "Sous-groupe", Ordre: "8" }]]);
});

test("B suivait le bloc autrement qu'en fin → début : rien ne change à l'ancienne place", () => {
  const rows = withRow(eraSs1Rows(), 1000, { Lien: "998 FF" });
  const changes = move(992, target(null, { groupRowId: 985, side: "before" }), { rows });
  assert.equal("Lien" in (changes.get(1000) || {}), false);
});

test("PLAN SYT CYCLE 3 sorti à la fin de l'étage : il redevient cycle", () => {
  const changes = move(1002, target(null));
  assert.deepEqual(changes.get(1002), { Parent: "", Nature: "Cycle", Ordre: "5" });
  // La REUNION de CYCLE 3 reprend « 1000 FD » ; RESEAUX suit DEMARRAGE GO, la dernière de l'étage.
  assert.deepEqual(column(changes, "Lien"), { 1006: "1000 FD", 1003: "1008 FD" });
});

test("refus : dans lui-même, dans un de ses sous-cycles, dans un autre étage", () => {
  assert.equal(move(992, target(992)).size, 0);
  assert.equal(move(992, target(994)).size, 0);
  const rows = [...eraSs1Rows(), { ...eraSs1Rows()[0], id: 1100, Taches: "R+1", Lien_Structure: "" }];
  const otherFloor = target(null, undefined, { floorKey: "rp1", floorName: "R+1" });
  assert.ok(findContainer(buildSections({ rows }), otherFloor), "l'étage R+1 existe");
  assert.equal(move(992, otherFloor, { rows }).size, 0);
});

test("lâché sur lui-même ou sur une ligne qu'il contient : rien", () => {
  assert.equal(move(992, target(null, { groupRowId: 992, side: "before" })).size, 0);
  assert.equal(move(992, target(null, { groupRowId: 994, side: "before" })).size, 0);
  assert.equal(move(992, target(null, { taskId: 993, side: "after" })).size, 0);
  assert.equal(move(992, target(null, { taskId: 996, side: "before" })).size, 0);
});

test("à la même place : rien", () => {
  assert.equal(move(992, target(null, { groupRowId: 999, side: "before" })).size, 0);
  assert.equal(move(999, target(null)).size, 0);
});

test("cycle vide : seul l'ordre bouge", () => {
  const rows = eraSs1Rows();
  const empty = { ...rows.find((row) => row.id === 999), id: 2000, Taches: "CYCLE VIDE", Nature: "Cycle", Groupe: "SS1" };
  const changes = move(2000, target(null, { groupRowId: 985, side: "before" }), { rows: [...rows, empty] });
  assert.deepEqual([...changes], [
    [984, { Ordre: "1" }], [2000, { Ordre: "2" }], [985, { Ordre: "3" }], [992, { Ordre: "4" }], [999, { Ordre: "5" }],
  ]);
});

test("bloc arrivé tout en haut : plus de lien d'entrée, dates gardées", () => {
  const changes = move(992, target(null, { taskId: 984, side: "before" }));
  assert.deepEqual(changes.get(993), { Lien: "" });
  assert.equal(changes.get(1000).Lien, "991 FD");
  assert.deepEqual(changes.get(984), { Ordre: "2" }, "la RECEPTION ne change pas de lien");
});

test("jamais de boucle", () => {
  // La REUNION de CYCLE 1 dépend de RESERVATIONS (CYCLE 2) : CYCLE 2 en fin d'étage la ferait
  // dépendre de sa propre suite. Elle reprendrait le lien d'entrée, qui la désigne : plus de lien.
  const changes = move(992, target(null), { rows: withRow(eraSs1Rows(), 991, { Lien: "996 FF" }) });
  assert.equal(changes.get(991).Lien, "");
  // VISA A (CYCLE 3) dépend de TERMINAUX : elle reprend le lien d'entrée de CYCLE 2.
  const visa = move(992, target(null), { rows: withRow(eraSs1Rows(), 1001, { Lien: "997 FD" }) });
  assert.equal(visa.get(1001).Lien, "991 FD");
  // Boucle déjà saisie (REUNION de CYCLE 1 en « 993 FF ») : la RECEPTION de CYCLE 2 suivrait
  // DEMARRAGE GO, qui dépend d'elle ; ce lien n'est pas posé, elle garde le sien.
  const kept = move(999, target(null, { groupRowId: 992, side: "before" }), { rows: withRow(eraSs1Rows(), 991, { Lien: "993 FF" }) });
  assert.equal(kept.get(1000).Lien, "991 FD");
  assert.equal("Lien" in (kept.get(993) || {}), false);
});

test("jamais de boucle, sur des données sans boucle : aucun lien posé ne se referme sur lui-même", () => {
  // RESEAUX (995, D de PLAN SYT CYCLE 2) en « 998 DD » sur la REUNION, qui suit TERMINAUX (997,
  // sans lien) : la REUNION ne reprend pas le lien d'entrée, qui la désigne ; à la nouvelle
  // place, elle dépend du bloc et perd son lien.
  const self = withRows(eraSs1Rows(), { 995: { Lien: "998 DD" }, 997: { Lien: "" }, 998: { Lien: "997 FD" } });
  const selfChanges = move(994, target(999), { rows: self });
  assert.deepEqual(column(selfChanges, "Lien"), { 995: "1008 FD", 998: "" });
  assert.equal(hasLoop(self, selfChanges), false);
  // Entrée « 1000 DD » sur la RECEPTION de CYCLE 3, qui suit la REUNION : ni la REUNION à
  // l'ancienne place, ni à l'étape 3, ne la reprennent (elle dépend d'elles).
  const chained = withRows(eraSs1Rows(), { 995: { Lien: "1000 DD" }, 997: { Lien: "" }, 998: { Lien: "997 FD" } });
  const chainedChanges = move(994, target(999), { rows: chained });
  assert.deepEqual(column(chainedChanges, "Lien"), { 995: "1008 FD", 998: "" });
  assert.equal(hasLoop(chained, chainedChanges), false);
});

test("bloc non daté : liens refaits, aucune date", () => {
  const rows = templateRows().map((row) => ({ ...row, Ordre: "" }));
  const changes = planCycleMove({
    sections: buildSections({ rows }), groupRowId: 210, canLink: true,
    target: { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: null, position: { groupRowId: 203, side: "before" } },
  });
  assert.deepEqual(column(changes, "Lien"), { 211: "202 DD", 204: "216 FD", 218: "209 FD" });
  assert.equal([...changes.values()].some((fields) => "Diff_coffrage" in fields), false);
});

test("bloc non daté sans tâche en dessous : la tâche de sortie est la dernière du bloc", () => {
  // CYCLE 3 (217, dernier de l'étage) avant CYCLE 2 : rien n'est daté, CYCLE 2 suit DEMARRAGE GO.
  const rows = templateRows().map((row) => ({ ...row, Ordre: "" }));
  const changes = planCycleMove({
    sections: buildSections({ rows }), groupRowId: 217, canLink: true,
    target: { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: null, position: { groupRowId: 210, side: "before" } },
  });
  assert.deepEqual(column(changes, "Lien"), { 218: "209 FD", 211: "226 FD" });
});

test("sans la colonne Lien : seulement Parent, Nature, Ordre", () => {
  const changes = move(992, target(null, { groupRowId: 985, side: "before" }), { canLink: false });
  assert.deepEqual([...changes], [[984, { Ordre: "1" }], [992, { Ordre: "2" }], [985, { Ordre: "3" }], [999, { Ordre: "4" }]]);
});

test("supprimer un cycle referme la chaîne", () => {
  const cycle = remove(992);
  assert.equal(cycle.get(1000).Lien, "991 FD");
  assert.equal(cycle.get(1000).Diff_coffrage, "2025-12-09");
  assert.equal(cycle.has(993), false, "rien n'est écrit sur une ligne supprimée");
  const subCycle = remove(994);
  assert.equal(subCycle.get(998).Lien, "993 FD");
  assert.equal(subCycle.get(998).Diff_coffrage, "2025-12-15");
  assert.equal(remove(992, { canLink: false }).size, 0);
  // Lien d'entrée en fin → début : la tâche du dessous garde son propre décalage.
  const lagged = planCycleRemoval({
    sections: buildSections({ rows: withRow(eraSs1Rows(), 1000, { Lien: "998 FD+2" }) }), groupRowId: 992, canLink: true,
  });
  assert.equal(lagged.get(1000).Lien, "991 FD+2");
  // Lien d'entrée d'un autre type : repris tel quel.
  const startToStart = planCycleRemoval({
    sections: buildSections({ rows: withRow(eraSs1Rows(), 993, { Lien: "984 DD" }) }), groupRowId: 992, canLink: true,
  });
  assert.equal(startToStart.get(1000).Lien, "984 DD");
  // Entrée sur la ligne du dessous (995 en « 998 DD ») : la REUNION ne se lie pas à elle-même,
  // elle perd son lien avec TERMINAUX supprimé.
  const self = withRows(eraSs1Rows(), { 995: { Lien: "998 DD" }, 997: { Lien: "" }, 998: { Lien: "997 FD" } });
  assert.deepEqual(planCycleRemoval({ sections: buildSections({ rows: self }), groupRowId: 994, canLink: true }).get(998), { Lien: "" });
});
