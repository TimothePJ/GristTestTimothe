// Fin d'étage fixe de la vue Synthese : SIGNATURE PLANS SYNTHESE puis DEMARRAGE GO restent les deux
// dernières lignes de leur étage, hors de tout cycle. Un cycle ajouté, une tâche ajoutée ou déposée
// « en fin d'étage » se place juste au-dessus de SIGNATURE, qui suit alors la nouvelle dernière tâche
// avec son décalage (5 jours ouvrés).
// Étage du modèle daté (templateRows, Zone Z3A, ids 201 à 226) : RECEPTION 202, CYCLE 1 203, CYCLE 2
// 210, CYCLE 3 217 (… REUNION 224, jalon du lun. 23/02/26), SIGNATURE 225 (« 224 FD+5 », 02/03/26),
// DEMARRAGE GO 226 (« 225 FD »). Étage existant de l'utilisateur (eraSs1Rows) : SIGNATURE 1007 et
// DEMARRAGE GO 1008 rangées dans le CYCLE 3 (999).
import test from "node:test";
import assert from "node:assert/strict";

import { buildRowModel, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import {
  planInsertFollowUp,
  planTaskInsert,
  planTaskMove,
  resolveDropSlot,
} from "../assets/js/services/syntheseTaskOrder.js";
import { planCycleInsert, planCycleMove, resolveCycleDropSlot } from "../assets/js/services/syntheseCycles.js";
import { datedRows } from "./helpers/templateRows.mjs";
import { ERA_ZONE_KEY, eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

const ZONE = "zonez3a";
const TODAY = new Date(2026, 8, 23);
const itemKey = (item) => (item.kind === "task" ? `task:${item.task.id}` : `group:${item.group.rowId}`);
const floorOf = (sections, zoneKey, floorKey = "ss1") =>
  sections.find((section) => section.zoneKey === zoneKey).floors.find((floor) => floor.key === floorKey);
const applied = (rows, changes) => rows.map((row) => (changes.has(row.id) ? { ...row, ...changes.get(row.id) } : row));
const withFields = (rows, fieldsById) => rows.map((row) => (fieldsById[row.id] ? { ...row, ...fieldsById[row.id] } : row));

/* ---------- Affichage : la place fixe ---------- */

test("étage existant : SIGNATURE et DEMARRAGE GO, rangées dans le CYCLE 3, s'affichent à la fin de l'étage", () => {
  const floor = floorOf(buildSections({ rows: eraSs1Rows() }), ERA_ZONE_KEY);
  assert.deepEqual(floor.items.map(itemKey), [
    "task:984", "group:985", "group:992", "group:999", "task:1007", "task:1008",
  ]);
  const cycle3 = floor.groups.find((group) => group.rowId === 999);
  assert.deepEqual(cycle3.items.map(itemKey), ["task:1000", "task:1001", "group:1002", "task:1006"]);
  assert.equal(cycle3.tasks.some((task) => task.id === 1007 || task.id === 1008), false);
  const byId = new Map(floor.tasks.map((task) => [task.id, task]));
  assert.deepEqual([byId.get(1007).groupRowId, byId.get(1007).floorEnd], [null, "signature"]);
  assert.deepEqual([byId.get(1008).groupRowId, byId.get(1008).floorEnd], [null, "kickoff"]);
  assert.equal(byId.get(1006).floorEnd, undefined);
});

test("la place fixe ne dépend pas des rangs : SIGNATURE puis DEMARRAGE GO, toujours en dernier", () => {
  const rows = withFields(eraSs1Rows(), {
    984: { Ordre: "3" },
    1007: { Parent: "", Ordre: "2" },
    1008: { Parent: "", Ordre: "1" },
  });
  const floor = floorOf(buildSections({ rows }), ERA_ZONE_KEY);
  assert.deepEqual(floor.items.map(itemKey), [
    "task:984", "group:985", "group:992", "group:999", "task:1007", "task:1008",
  ]);
});

test("SIGNATURE reconnue par sa Nature « Signature » même renommée ; sans Nature, seulement par son nom", () => {
  const renamed = withFields(eraSs1Rows(), { 1007: { Taches: "SIGNATURE DES PLANS", Nature: "Signature", Parent: "" } });
  assert.deepEqual(floorOf(buildSections({ rows: renamed }), ERA_ZONE_KEY).items.map(itemKey).slice(-2), ["task:1007", "task:1008"]);
  const legacyRenamed = withFields(eraSs1Rows(), { 1007: { Taches: "SIGNATURE DES PLANS" } });
  const floor = floorOf(buildSections({ rows: legacyRenamed }), ERA_ZONE_KEY);
  assert.deepEqual(floor.items.map(itemKey).slice(-2), ["group:999", "task:1008"]);
  assert.ok(floor.groups.find((group) => group.rowId === 999).tasks.some((task) => task.id === 1007));
});

test("nouvel étage du modèle : SIGNATURE et DEMARRAGE GO hors du CYCLE 3, à la fin de l'étage", () => {
  const floor = floorOf(buildSections({ rows: datedRows() }), ZONE);
  assert.deepEqual(floor.items.map(itemKey), [
    "task:202", "group:203", "group:210", "group:217", "task:225", "task:226",
  ]);
  assert.deepEqual(floor.groups.find((group) => group.rowId === 217).items.map(itemKey), [
    "task:218", "task:219", "group:220", "task:224",
  ]);
});

test("modèle de lignes : les deux lignes fixes portent leur rôle et la première d'entre elles", () => {
  const lines = buildRowModel(buildSections({ rows: datedRows() }));
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const lead = { taskId: 225, name: "SIGNATURE PLANS SYNTHESE" };
  assert.deepEqual([line("task:225").floorEnd, line("task:225").floorEndLead], ["signature", lead]);
  assert.deepEqual([line("task:226").floorEnd, line("task:226").floorEndLead], ["kickoff", lead]);
  assert.deepEqual([line("task:225").level, line("task:225").groupRowId, line("task:225").cyclePath], [2, null, []]);
  assert.equal(lines.filter((candidate) => candidate.floorEnd).length, 2);
  assert.deepEqual(lines.slice(-2).map((candidate) => candidate.key), ["task:225", "task:226"]);
  // Même chose en affichage par étage.
  const floorLines = buildRowModel(buildSections({ rows: datedRows() }), { layout: "floor" });
  assert.equal(floorLines.find((candidate) => candidate.key === "task:226").floorEnd, "kickoff");
});

/* ---------- Ajouter un cycle ---------- */

test("Ajouter un cycle : le nouveau cycle va sous le CYCLE 3, au-dessus de SIGNATURE", () => {
  const plan = planCycleInsert({ sections: buildSections({ rows: datedRows() }), zoneKey: ZONE, floorKey: "ss1", canOrder: true });
  assert.equal(plan.fields.Ordre, "5");
  assert.deepEqual([...plan.changes], [
    [202, { Ordre: "1" }], [203, { Ordre: "2" }], [210, { Ordre: "3" }], [217, { Ordre: "4" }],
    [225, { Ordre: "6" }], [226, { Ordre: "7" }],
  ]);
});

// Le scénario demandé : CYCLE 4 ajouté (id 300), puis une tâche dedans (id 301).
test("CYCLE 4 puis une tâche dedans : elle suit la REUNION du CYCLE 3, SIGNATURE la suit avec ses 5 jours, DEMARRAGE GO suit SIGNATURE", () => {
  const cycle = planCycleInsert({ sections: buildSections({ rows: datedRows() }), zoneKey: ZONE, floorKey: "ss1", canOrder: true });
  const rows = [
    ...applied(datedRows(), cycle.changes),
    { id: 300, Type_doc: "", ID2: "", Etage: false, Parent: "", Lien: "", Diff_coffrage: null, Diff_armature: null, ...cycle.fields },
  ];
  const sections = buildSections({ rows });
  assert.deepEqual(floorOf(sections, ZONE).items.map(itemKey).slice(-3), ["group:300", "task:225", "task:226"]);
  const plan = planTaskInsert({
    sections, container: { zoneKey: ZONE, floorKey: "ss1", groupRowId: 300 },
    canOrder: true, canLink: true, today: TODAY, projectName: "HOTEL DIEU",
  });
  assert.equal(plan.fields.Lien, "224 FD");
  assert.deepEqual([plan.fields.Diff_coffrage, plan.fields.Diff_armature], ["2026-02-24", "2026-02-24"]);
  assert.deepEqual(plan.follow, { successorId: 225, lag: 5 });
  const followUp = planInsertFollowUp({ sections, newTask: { ...plan.task, id: 301 }, successorId: 225, lag: 5 });
  assert.deepEqual(followUp.get(225), { Lien: "301 FD+5", Diff_coffrage: "2026-03-03", Diff_armature: "2026-03-03", Duree_1: 0 });
  assert.deepEqual(followUp.get(226), { Diff_coffrage: "2026-03-03", Diff_armature: "2026-03-03", Duree_1: 0 });
});

/* ---------- Ajouter une tâche ---------- */

test("Ajouter une tâche sur l'étage, sur SIGNATURE ou sur DEMARRAGE GO : au-dessus de SIGNATURE", () => {
  [null, 225, 226].forEach((afterTaskId) => {
    const plan = planTaskInsert({
      sections: buildSections({ rows: datedRows() }), container: { zoneKey: ZONE, floorKey: "ss1" }, afterTaskId,
      canOrder: true, canLink: true, today: TODAY, projectName: "HOTEL DIEU",
    });
    assert.equal(plan.fields.Ordre, "5", `après ${afterTaskId}`);
    assert.deepEqual([plan.changes.get(225), plan.changes.get(226)], [{ Ordre: "6" }, { Ordre: "7" }]);
    assert.equal(plan.fields.Lien, "224 FD", "suit la REUNION du CYCLE 3");
    assert.deepEqual(plan.follow, { successorId: 225, lag: 5 }, "SIGNATURE la suivra, 5 jours gardés");
  });
});

test("étage existant : une tâche ajoutée sur l'étage va au-dessus de SIGNATURE, qui la suivra avec ses 5 jours", () => {
  const plan = planTaskInsert({
    sections: buildSections({ rows: eraSs1Rows() }), container: { zoneKey: ERA_ZONE_KEY, floorKey: "ss1" },
    canOrder: true, canLink: true, today: TODAY, projectName: "ERA",
  });
  assert.equal(plan.fields.Ordre, "5");
  assert.equal(plan.fields.Lien, "1006 FD");
  assert.deepEqual(plan.follow, { successorId: 1007, lag: 5 });
});

/* ---------- Glisser ---------- */

test("tâche déposée à la fin de l'étage ou après DEMARRAGE GO : au-dessus de SIGNATURE, qui la suit", () => {
  const target = (fields) => ({ zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", ...fields });
  [{}, { position: { taskId: 226, side: "after" } }, { position: { taskId: 225, side: "after" } }].forEach((fields) => {
    const changes = planTaskMove({
      sections: buildSections({ rows: datedRows() }), taskId: 207, target: target(fields), canOrder: true, canLink: true,
    });
    assert.equal(changes.get(207).Ordre, "5", JSON.stringify(fields));
    assert.equal(changes.get(207).Lien, "224 FD");
    assert.equal(changes.get(225).Ordre, "6");
    assert.equal(changes.get(225).Lien, "207 FD+5");
    assert.equal(changes.get(226).Ordre, "7");
  });
});

test("SIGNATURE et DEMARRAGE GO ne se déplacent pas", () => {
  const sections = buildSections({ rows: datedRows() });
  const target = { zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 203 };
  [225, 226].forEach((taskId) => {
    assert.equal(planTaskMove({ sections, taskId, target, canOrder: true, canLink: true }).size, 0, `tâche ${taskId}`);
  });
});

test("CYCLE 1 glissé après DEMARRAGE GO : au-dessus de SIGNATURE, qui suit sa sortie avec ses 5 jours", () => {
  const changes = planCycleMove({
    sections: buildSections({ rows: datedRows() }),
    groupRowId: 203,
    target: { zoneKey: ZONE, floorKey: "ss1", groupRowId: null, position: { taskId: 226, side: "after" } },
    canLink: true,
  });
  assert.deepEqual([changes.get(203).Ordre, changes.get(225).Ordre, changes.get(226).Ordre], ["4", "5", "6"]);
  assert.equal(changes.get(225).Lien, "209 FD+5", "SIGNATURE suit la REUNION RSX du CYCLE 1");
});

test("viser SIGNATURE ou DEMARRAGE GO pendant un glisser : la place juste avant SIGNATURE", () => {
  const lines = buildRowModel(buildSections({ rows: datedRows() }));
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const before = {
    key: "slot:225:before",
    label: "Placer avant « SIGNATURE PLANS SYNTHESE »",
    position: { taskId: 225, side: "before" },
  };
  ["task:225", "task:226"].forEach((key) => ["before", "after"].forEach((side) => {
    const slot = resolveDropSlot(line(key), side, { canOrder: true, draggedTaskId: 207 });
    assert.deepEqual([slot.key, slot.label, slot.position, slot.groupRowId ?? null], [before.key, before.label, before.position, null], `${key} ${side}`);
    const cycleSlot = resolveCycleDropSlot(line(key), side, { groupRowId: 203, zoneKey: ZONE, floorKey: "ss1" });
    assert.deepEqual([cycleSlot.key, cycleSlot.label, cycleSlot.position, cycleSlot.groupRowId], [before.key, before.label, before.position, null], `cycle ${key} ${side}`);
  }));
});

/* ---------- Étages d'avant : SIGNATURE en « VISA A +5 », contenu sous DEMARRAGE ---------- */

const eraTarget = (fields) => ({ zoneKey: ERA_ZONE_KEY, zoneName: "Zone 1 / BAT BC", floorKey: "ss1", floorName: "SS1", ...fields });
const eraInsert = (rows, container, afterTaskId = null, options = {}) => planTaskInsert({
  sections: buildSections({ rows }), container: { zoneKey: ERA_ZONE_KEY, floorKey: "ss1", ...container }, afterTaskId,
  canOrder: true, canLink: true, today: TODAY, projectName: "ERA", ...options,
});

test("étage existant : une tâche ajoutée à la fin du CYCLE 3 devient la dernière, SIGNATURE la suivra avec ses 5 jours", () => {
  // SIGNATURE suit VISA A (ancien modèle), pas la REUNION : elle suit quand même ce qui arrive juste au-dessus d'elle.
  [null, 1006].forEach((afterTaskId) => {
    const plan = eraInsert(eraSs1Rows(), { groupRowId: 999 }, afterTaskId);
    assert.equal(plan.fields.Lien, "1006 FD", `après ${afterTaskId}`);
    assert.deepEqual(plan.follow, { successorId: 1007, lag: 5 }, `après ${afterTaskId}`);
  });
});

test("étage existant : une tâche glissée à la fin du CYCLE 3, SIGNATURE la suit avec ses 5 jours", () => {
  const changes = planTaskMove({
    sections: buildSections({ rows: eraSs1Rows() }), taskId: 1061, target: eraTarget({ groupRowId: 999 }), canOrder: true, canLink: true,
  });
  assert.equal(changes.get(1061).Lien, "1006 FD");
  assert.equal(changes.get(1007).Lien, "1061 FD+5");
});

test("cycle glissé juste au-dessus de SIGNATURE : elle suit sa sortie avec son décalage, même liée ailleurs", () => {
  const rows = withFields(eraSs1Rows(), { 1007: { Lien: "998 FD+5" } });
  const changes = planCycleMove({
    sections: buildSections({ rows }), groupRowId: 985, target: eraTarget({ groupRowId: null }), canLink: true,
  });
  assert.equal(changes.get(985).Ordre, "4");
  assert.equal(changes.get(1007).Lien, "991 FD+5", "SIGNATURE suit la REUNION RSX du CYCLE 1, désormais le dernier");
});

// Une tâche ajoutée avant ce changement à la fin du CYCLE 3 était sous DEMARRAGE, liée à lui : elle
// s'affiche maintenant au-dessus de SIGNATURE. SIGNATURE ne la suit jamais : ce serait une boucle.
test("jamais de boucle : SIGNATURE ne suit pas une tâche qui dépend d'elle ou de DEMARRAGE", () => {
  const late = {
    id: 2000, NomProjet: "ERA QUAI D'ORSAY", Zone: "Zone 1 / BAT BC", Service: "Synthese", Type_doc: "", ID2: "",
    Etage: false, Groupe: "SS1", Taches: "Ajoutée sous DEMARRAGE", Nature: "", Parent: "999", Lien: "1008 FD",
    Duree_1: 1, Diff_coffrage: "2026-01-22", Diff_armature: "2026-01-22", Ordre: "",
  };
  const rows = [...eraSs1Rows(), late];
  assert.deepEqual(floorOf(buildSections({ rows }), ERA_ZONE_KEY).groups.find((group) => group.rowId === 999).items.map(itemKey).slice(-1), ["task:2000"]);
  [[{}, null], [{ groupRowId: 999 }, 2000]].forEach(([container, afterTaskId]) => {
    const plan = eraInsert(rows, container, afterTaskId);
    assert.equal(plan.fields.Lien, "2000 FD");
    assert.equal(plan.follow, null, "SIGNATURE → nouvelle → 2000 → DEMARRAGE → SIGNATURE serait une boucle");
  });
  // Le second temps refuse aussi de fermer une boucle.
  const sections = buildSections({ rows });
  const newTask = { id: 2001, link: { predId: 2000, type: "FD", lag: 0 }, start: null, end: null, durationDays: 1, isMilestone: false };
  assert.equal(planInsertFollowUp({ sections, newTask, successorId: 1007, lag: 5 }).size, 0);
  const moved = planTaskMove({ sections, taskId: 1061, target: eraTarget({ groupRowId: 999 }), canOrder: true, canLink: true });
  assert.equal("Lien" in (moved.get(1007) || {}), false, "glisser sous 2000 : pas de boucle non plus");
});

test("sans la colonne Ordre, « Ajouter une tâche » sur SIGNATURE ou DEMARRAGE n'annonce pas une place manquée", () => {
  [1007, 1008].forEach((afterTaskId) => {
    assert.equal(eraInsert(eraSs1Rows(), {}, afterTaskId, { canOrder: false }).atEnd, false, `sur ${afterTaskId}`);
  });
  assert.equal(eraInsert(eraSs1Rows(), { groupRowId: 999 }, 1001, { canOrder: false }).atEnd, true, "une autre tâche : inchangé");
});
