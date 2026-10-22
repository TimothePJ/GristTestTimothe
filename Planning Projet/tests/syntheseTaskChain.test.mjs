// Chaînage automatique de la vue Synthese, façon MS Project : nouvelle tâche à sa place, tâche
// glissée, chaîne refermée, dates qui suivent, suppressions (module pur syntheseTaskOrder.js).
// Étage SS1 du modèle daté (Zone Z3A, ids 201 à 226) : dans le cycle 1 (203), FOND DE PLAN 204,
// DIFFUSION FDS 205 (« 204 FD », jalon), RECEPTION RENDU 206 (« 205 FD »), VISA 0 207
// (« 206 FD ») ; dans le cycle 3 (217), RECEPTION RENDU 218, VISA A 219 (« 218 FD »), PLAN SYT
// CYCLE 3 220 : RÉSEAUX 221 (« 218 FD »), RÉSERVATIONS 222 et TERMINAUX 223 (« 221 FF »), puis
// REUNION 224 (« 221 FD »), SIGNATURE 225 (« 219 FD+5 »), DÉMARRAGE GO 226 (« 225 FD »).
import test from "node:test";
import assert from "node:assert/strict";

import { buildSections } from "../assets/js/services/syntheseTaskModel.js";
import {
  planInsertFollowUp,
  planOrphanLinks,
  planTaskInsert,
  planTaskMove,
  planTaskRemoval,
} from "../assets/js/services/syntheseTaskOrder.js";
import { datedRows, templateRows } from "./helpers/templateRows.mjs";

const ZONE = "zonez3a";
const TODAY = new Date(2026, 8, 23);
const sectionsOf = (rows) => buildSections({ rows });
const entries = (changes) => [...changes.entries()];
const target = (fields) => ({ zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", ...fields });
const insertInto = (rows, container, afterTaskId, options = {}) => planTaskInsert({
  sections: sectionsOf(rows), container: { zoneKey: ZONE, floorKey: "ss1", ...container }, afterTaskId,
  canOrder: true, canLink: true, today: TODAY, projectName: "HOTEL DIEU", ...options,
});
const move = (rows, taskId, fields, options = {}) => planTaskMove({
  sections: sectionsOf(rows), taskId, target: target(fields), canOrder: true, canLink: true, ...options,
});

test("exemple 1 : « Ajouter une tâche » sur TERMINAUX → à la fin de PLAN SYT CYCLE 3, après TERMINAUX", () => {
  const plan = insertInto(datedRows(), { groupRowId: 220 }, 223);
  assert.deepEqual(plan.fields, {
    Taches: "Nouvelle tâche", Diff_coffrage: "2026-02-24", Diff_armature: "2026-02-24", Duree_1: 1,
    NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "220", Ordre: "4", Lien: "223 FD",
  }, "le jour ouvré après la Fin de TERMINAUX (lun. 23/02), 1 jour");
  assert.deepEqual(entries(plan.changes), [[221, { Ordre: "1" }], [222, { Ordre: "2" }], [223, { Ordre: "3" }]]);
  assert.equal(plan.follow, null, "REUNION suit RÉSEAUX, pas TERMINAUX : inchangée");
  assert.equal(plan.atEnd, false);
});

// « Test » créé à l'exemple 1 (id 400), rangs 1 à 3 déjà écrits dans PLAN SYT CYCLE 3.
function rowsWithTest() {
  const rows = datedRows().map((row) => ([221, 222, 223].includes(row.id) ? { ...row, Ordre: String(row.id - 220) } : row));
  const fields = insertInto(datedRows(), { groupRowId: 220 }, 223).fields;
  return [...rows, { id: 400, Type_doc: "", ID2: "", Etage: false, Nature: "", ...fields }];
}

test("exemple 2 : « Test » glissé avant VISA A → suit RECEPTION RENDU, VISA le suit ; SIGNATURE et DÉMARRAGE (après la REUNION) ne bougent pas", () => {
  const changes = move(rowsWithTest(), 400, { groupRowId: 217, position: { taskId: 219, side: "before" } });
  assert.deepEqual(entries(changes), [
    [400, { Parent: "217", Ordre: "2", Lien: "218 FD", Diff_coffrage: "2026-02-17", Diff_armature: "2026-02-17", Duree_1: 1 }],
    [218, { Ordre: "1" }],
    [219, { Ordre: "3", Lien: "400 FD", Diff_coffrage: "2026-02-18", Diff_armature: "2026-03-03", Duree_1: 10 }],
    [220, { Ordre: "4" }],
    [224, { Ordre: "5" }],
    [225, { Ordre: "6" }],
    [226, { Ordre: "7" }],
  ]);
  assert.equal(changes.has(221), false, "RÉSEAUX suit RECEPTION RENDU mais n'est pas juste en dessous : inchangé");
});

test("exemple 3 : TERMINAUX avant RÉSERVATIONS → déjà liée à RÉSEAUX, seul l'ordre change", () => {
  const changes = move(datedRows(), 223, { groupRowId: 220, position: { taskId: 222, side: "before" } });
  assert.deepEqual(entries(changes), [[221, { Ordre: "1" }], [223, { Ordre: "2" }], [222, { Ordre: "3" }]]);
});

test("exemple 4 : suppression de VISA A → pas de chaîne à refermer, SIGNATURE perd son lien et garde ses dates", () => {
  // SIGNATURE liée à VISA A à la main (le modèle la lie à la REUNION).
  const rows = datedRows().map((row) => (row.id === 225 ? { ...row, Lien: "219 FD+5" } : row));
  assert.deepEqual(entries(planTaskRemoval({ sections: sectionsOf(rows), taskId: 219, canLink: true })), [
    [225, { Lien: "" }],
  ]);
});

test("intervertir deux tâches d'une chaîne fin → début : la chaîne se referme puis se renoue", () => {
  // DIFFUSION FDS (205, jalon) glissé après RECEPTION RENDU (206) : 204 → 206 → 205 → 207.
  const changes = move(datedRows(), 205, { groupRowId: 203, position: { taskId: 206, side: "after" } });
  assert.deepEqual(entries(changes), [
    [204, { Ordre: "1" }],
    [206, { Ordre: "2", Lien: "204 FD" }],
    [205, { Ordre: "3", Lien: "206 FD", Diff_coffrage: "2026-01-19", Diff_armature: "2026-01-19", Duree_1: 0 }],
    [207, { Ordre: "4", Lien: "205 FD" }],
    [208, { Ordre: "5" }],
    [209, { Ordre: "6" }],
  ]);
});

test("nouvelle tâche dans une chaîne : la tâche du dessous la suivra, avec son décalage", () => {
  const rows = datedRows().map((row) => (row.id === 207 ? { ...row, Lien: "206 FD+2" } : row));
  const plan = insertInto(rows, { groupRowId: 203 }, 206);
  assert.deepEqual(plan.follow, { successorId: 207, lag: 2 });
  assert.deepEqual([plan.fields.Lien, plan.fields.Diff_coffrage, plan.fields.Diff_armature], ["206 FD", "2026-01-20", "2026-01-20"]);
});

test("second temps de l'ajout : avec son id, la tâche du dessous suit la nouvelle et ses dates suivent", () => {
  const plan = insertInto(datedRows(), { groupRowId: 203 }, 206);
  assert.deepEqual(plan.follow, { successorId: 207, lag: 0 });
  const changes = planInsertFollowUp({
    sections: sectionsOf(datedRows()), newTask: { ...plan.task, id: 500 }, successorId: 207, lag: 0,
  });
  assert.deepEqual(entries(changes), [
    [207, { Lien: "500 FD", Diff_coffrage: "2026-01-21", Diff_armature: "2026-02-03", Duree_1: 10 }],
  ]);
});

test("en tête de l'étage : plus de lien ; la chaîne se referme à l'ancienne place", () => {
  const changes = move(datedRows(), 205, { position: { taskId: 202, side: "before" } });
  assert.deepEqual(entries(changes), [
    [205, { Parent: "", Ordre: "1", Lien: "" }],
    [202, { Ordre: "2" }],
    [203, { Ordre: "3" }],
    [210, { Ordre: "4" }],
    [217, { Ordre: "5" }],
    [206, { Lien: "204 FD" }],
  ]);
});

test("jamais de boucle : la tâche qui suivait la tâche glissée reprend son ancien lien", () => {
  const plain = { NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: false, Nature: "", Parent: "", Duree_1: 5 };
  const rows = [
    ...datedRows(),
    { ...plain, id: 301, Taches: "X", Lien: "", Diff_coffrage: "2025-12-01", Diff_armature: "2025-12-05" },
    { ...plain, id: 302, Taches: "Y", Lien: "301 FD", Diff_coffrage: "2025-12-08", Diff_armature: "2025-12-12" },
  ];
  const changes = move(rows, 301, { floorKey: "", floorName: "", position: { taskId: 302, side: "after" } });
  assert.deepEqual(entries(changes), [
    [302, { Ordre: "1", Lien: "" }],
    [301, { Ordre: "2", Lien: "302 FD", Diff_coffrage: "2025-12-15", Diff_armature: "2025-12-19", Duree_1: 5 }],
  ]);
});

test("jamais de boucle, avec un ancien lien : la tâche rattachée prend les dates de ce lien et sa chaîne suit", () => {
  // RECEPTION RENDU (206, « 205 FD ») glissé après VISA A (219) : la boucle passe par PLAN DE
  // SYNTHESE RESEAUX (208, « 206 FD »), qui reprend « 205 FD » : 6 → 12/01 ; REUNION (jalon) le
  // 12/01, le cycle 2 (13/01 → 26/01) et le cycle 3 (RECEPTION RENDU 27/01 → 02/02, VISA A
  // 03/02 → 16/02) remontent ; 206 suit 219 (« 219 FD ») : 17/02 → 02/03, 10 jours ouvrés.
  const changes = move(datedRows(), 206, { groupRowId: 217, position: { taskId: 219, side: "after" } });
  assert.deepEqual(changes.get(208), { Lien: "205 FD", Diff_coffrage: "2026-01-06", Diff_armature: "2026-01-12", Duree_1: 5 });
  assert.deepEqual(changes.get(206), {
    Parent: "217", Ordre: "3", Lien: "219 FD", Diff_coffrage: "2026-02-17", Diff_armature: "2026-03-02", Duree_1: 10,
  });
  assert.deepEqual(changes.get(209), { Diff_coffrage: "2026-01-12", Diff_armature: "2026-01-12", Duree_1: 0 });
  assert.deepEqual(changes.get(211), { Diff_coffrage: "2026-01-13", Diff_armature: "2026-01-19", Duree_1: 5 });
  assert.deepEqual(changes.get(218), { Ordre: "1", Diff_coffrage: "2026-01-27", Diff_armature: "2026-02-02", Duree_1: 5 });
  assert.deepEqual(changes.get(219), { Ordre: "2", Diff_coffrage: "2026-02-03", Diff_armature: "2026-02-16", Duree_1: 10 });
});

test("RÉSEAUX, tâche pilote de PLAN SYT CYCLE 3 en parallèle, glissée après TERMINAUX : seuls les rangs changent", () => {
  // Dans un cycle en parallèle, la tâche pilote (la plus longue) mène la chaîne où qu'elle soit
  // affichée : ni lien ni date ne bouge.
  const changes = move(datedRows(), 221, { groupRowId: 220, position: { taskId: 223, side: "after" } });
  assert.deepEqual(entries(changes), [[222, { Ordre: "1" }], [223, { Ordre: "2" }], [221, { Ordre: "3" }]]);
});

test("tâche du dessus sans dates (modèle pas encore planifié) : nouvelle tâche sans dates, durée prévue 1 jour", () => {
  const plan = insertInto(templateRows(), { groupRowId: 220 }, 221);
  assert.deepEqual(plan.fields, {
    Taches: "Nouvelle tâche", Diff_coffrage: null, Diff_armature: null, Duree_1: 1,
    NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "220", Ordre: "2", Lien: "221 FD",
  });
  assert.equal(plan.follow, null, "RÉSERVATIONS suit RÉSEAUX en fin → fin : inchangée");
});

test("sans tâche du dessus (niveau zone vide) : règle d'avant, sans lien", () => {
  const rows = [...datedRows(), { id: 11, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", Zone: "Zone Z9", Groupe: "" }];
  const plan = planTaskInsert({
    sections: sectionsOf(rows), container: { zoneKey: "zonez9" }, canOrder: true, canLink: true, today: TODAY, projectName: "HOTEL DIEU",
  });
  assert.deepEqual(plan.fields, {
    Taches: "Nouvelle tâche", Diff_coffrage: "2026-09-23", Diff_armature: "2026-09-23", Duree_1: 1,
    NomProjet: "HOTEL DIEU", Zone: "Zone Z9", Ordre: "1",
  });
});

test("vers un autre étage : elle suit la tâche du dessus de l'étage d'arrivée", () => {
  const rows = [...datedRows(), ...datedRows({ floorName: "RDC", firstId: 401 }).filter((row) => row.id !== 10)];
  const changes = move(rows, 223, { floorKey: "rdc", floorName: "RDC", groupRowId: 420, position: { taskId: 421, side: "after" } });
  assert.deepEqual(entries(changes), [
    [223, { Groupe: "RDC", Parent: "420", Ordre: "2", Lien: "421 FD", Diff_coffrage: "2026-02-24", Diff_armature: "2026-02-25", Duree_1: 2 }],
    [421, { Ordre: "1" }],
    [422, { Ordre: "3" }],
    [423, { Ordre: "4" }],
  ]);
});

test("à la même place, ou vers une tâche inconnue de son conteneur : rien, ou la fin", () => {
  assert.equal(move(datedRows(), 222, { groupRowId: 220, position: { taskId: 221, side: "after" } }).size, 0);
  assert.equal(move(datedRows(), 222, { groupRowId: 220, position: { taskId: 223, side: "before" } }).size, 0);
  assert.equal(planTaskMove({ sections: sectionsOf(datedRows()), taskId: 999, target: target({ groupRowId: 220 }) }).size, 0);
  // Sur la ligne du sous-groupe : à la fin (ordre seul, sans la colonne Lien).
  const end = move(datedRows(), 221, { groupRowId: 220 }, { canLink: false });
  assert.deepEqual(entries(end).map(([rowId, fields]) => [rowId, fields.Ordre]), [[222, "1"], [223, "2"], [221, "3"]]);
});

test("sans la colonne Lien : seul l'ordre change ; sans Ordre : le déplacement d'avant", () => {
  const ordered = move(datedRows(), 400, {}, {});
  assert.equal(ordered.size, 0, "tâche introuvable");
  const noLink = move(rowsWithTest(), 400, { groupRowId: 217, position: { taskId: 219, side: "before" } }, { canLink: false });
  assert.deepEqual(noLink.get(400), { Parent: "217", Ordre: "2" });
  assert.deepEqual(noLink.get(219), { Ordre: "3" });
  const noOrder = move(rowsWithTest(), 400, { groupRowId: 217, position: { taskId: 219, side: "before" } }, { canOrder: false });
  assert.deepEqual(entries(noOrder), [[400, { Parent: "217" }]]);
  const plan = insertInto(datedRows(), { groupRowId: 220 }, 221, { canOrder: false });
  assert.deepEqual([plan.fields.Ordre, plan.fields.Lien, plan.changes.size, plan.atEnd], [undefined, undefined, 0, true]);
  assert.equal(insertInto(datedRows(), { groupRowId: 220 }, 221, { canLink: false }).fields.Lien, undefined);
});

test("suppression d'une tâche : la chaîne se referme ; sans Lien, rien", () => {
  // DIFFUSION FDS (205) entre FOND DE PLAN (204) et RECEPTION RENDU (206), en fin → début.
  assert.deepEqual(entries(planTaskRemoval({ sections: sectionsOf(datedRows()), taskId: 205, canLink: true })), [
    [206, { Lien: "204 FD" }],
  ]);
  assert.equal(planTaskRemoval({ sections: sectionsOf(datedRows()), taskId: 205 }).size, 0);
});

test("suppression d'un cycle : les liens vers ses lignes sont effacés", () => {
  const removedIds = [210, 211, 212, 213, 214, 215, 216];
  assert.deepEqual(entries(planOrphanLinks({ sections: sectionsOf(datedRows()), removedIds, canLink: true })), [
    [218, { Lien: "" }],
  ]);
  assert.equal(planOrphanLinks({ sections: sectionsOf(datedRows()), removedIds }).size, 0);
});

// Deux zones : l'étage SS1 de Zone Z3A (ids 201 à 226) et l'étage RDC de Zone Z4B (ids 401 à 426,
// mêmes dates), sans la ligne de zone d'id 10 en double.
const twoZones = () => [...datedRows(), ...datedRows({ zoneName: "Zone Z4B", floorName: "RDC", firstId: 401 }).filter((row) => row.id !== 10)];
const toZ4B = (fields) => ({ zoneKey: "zonez4b", zoneName: "Zone Z4B", floorKey: "", floorName: "", ...fields });

test("changement de zone, vers le niveau zone : Zone, Groupe, Parent, rang changent ; plus de lien sans tâche au-dessus", () => {
  // TERMINAUX (223, « 221 FF ») au niveau de Zone Z4B, qui n'a aucune tâche hors étage : première.
  const changes = planTaskMove({ sections: sectionsOf(twoZones()), taskId: 223, target: toZ4B(), canOrder: true, canLink: true });
  assert.deepEqual(entries(changes), [[223, { Zone: "Zone Z4B", Groupe: "", Parent: "", Ordre: "1", Lien: "" }]]);
});

test("changement de zone, vers un étage : suit la tâche du dessus d'arrivée, la chaîne se referme au départ", () => {
  // RECEPTION RENDU (206, « 205 FD ») de Zone Z3A après RÉSEAUX (421) de l'étage RDC de Zone Z4B.
  const changes = planTaskMove({
    sections: sectionsOf(twoZones()), taskId: 206, canOrder: true, canLink: true,
    target: toZ4B({ floorKey: "rdc", floorName: "RDC", groupRowId: 420, position: { taskId: 421, side: "after" } }),
  });
  // 421 se termine le 23/02 : 206 va du 24/02 au 09/03 (10 jours ouvrés).
  assert.deepEqual(changes.get(206), {
    Zone: "Zone Z4B", Groupe: "RDC", Parent: "420", Ordre: "2", Lien: "421 FD",
    Diff_coffrage: "2026-02-24", Diff_armature: "2026-03-09", Duree_1: 10,
  });
  assert.deepEqual([changes.get(421), changes.get(422), changes.get(423)], [{ Ordre: "1" }, { Ordre: "3" }, { Ordre: "4" }]);
  // Au départ : VISA 0 (207) suivait 206 en fin → début, elle suit DIFFUSION FDS (205, fin 05/01).
  assert.deepEqual(changes.get(207), { Lien: "205 FD", Diff_coffrage: "2026-01-06", Diff_armature: "2026-01-19", Duree_1: 10 });
  // PLAN DE SYNTHESE RESEAUX (208, « 206 FD ») emmenée par 206 : 10/03 → 16/03.
  assert.deepEqual(changes.get(208), { Diff_coffrage: "2026-03-10", Diff_armature: "2026-03-16", Duree_1: 5 });
});

test("suppression d'un étage : le lien d'une tâche d'un autre étage vers l'une de ses tâches est effacé", () => {
  const rows = twoZones().map((row) => (row.id === 404 ? { ...row, Lien: "205 FD" } : row));
  const floorRemovalIds = rows.filter((row) => row.id >= 201 && row.id <= 226).map((row) => row.id);
  assert.deepEqual(entries(planOrphanLinks({ sections: sectionsOf(rows), removedIds: floorRemovalIds, canLink: true })), [
    [404, { Lien: "" }],
  ]);
});
