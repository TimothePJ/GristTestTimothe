import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_DURATION_DAYS,
  MAX_TASK_NAME_LENGTH,
  NEW_TASK_NAME,
  applyTaskEdit,
  buildNewTask,
  buildTaskFields,
  readTask,
  stepDurationText,
} from "../assets/js/services/syntheseTaskModel.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);
const TODAY = day(2026, 9, 23); // mercredi

function task(fields) {
  return readTask({ Type_doc: "", ID2: "", Zone: "Zone Z2A", ...fields });
}
// Visa MOE : Ven 09/10/26 → Ven 23/10/26, 11 jours.
const visa = () => task({ id: 5, Taches: "Visa MOE", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
const milestone = () => task({ id: 6, Taches: "Réunion de synthèse", Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 0 });
const undated = () => task({ id: 7, Taches: "À planifier", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 });
const edit = (target, field, value) => applyTaskEdit(target, field, value, { today: TODAY });

test("Durée : la Fin suit, Duree_1 est écrite", () => {
  const result = edit(visa(), "duration", "5");
  assert.equal(result.ok, true);
  assert.equal(iso(result.task.end), "2026-10-15");
  assert.equal(result.task.durationDays, 5);
  assert.deepEqual(result.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-15", Duree_1: 5 });
});

test("Durée 0 : la tâche devient un jalon", () => {
  const result = edit(visa(), "duration", "0");
  assert.equal(result.task.isMilestone, true);
  assert.equal(iso(result.task.end), "2026-10-09");
  assert.deepEqual(result.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-09", Duree_1: 0 });
});

test("Durée refusée : vide, négative, décimale, texte, trop grande", () => {
  ["", "-1", "2,5", "2.5", "abc", "10000"].forEach((value) => {
    const result = edit(visa(), "duration", value);
    assert.equal(result.ok, false, `« ${value} » aurait dû être refusé`);
    assert.match(result.error, /nombre entier/);
  });
});

test("flèches ↑ / ↓ sur la Durée : ±1 jour à partir du nombre saisi, de 0 (jalon) à 9999", () => {
  assert.equal(stepDurationText("5", 1), "6");
  assert.equal(stepDurationText("5", -1), "4");
  assert.equal(stepDurationText("5 j", 1), "6", "suffixe « j » accepté puis retiré");
  assert.equal(stepDurationText(" 12 jours", -1), "11");
  assert.equal(stepDurationText("1", -1), "0", "une durée de 0 : jalon");
  assert.equal(stepDurationText("0", -1), "0", "pas de durée négative");
  assert.equal(stepDurationText("", 1), "1", "champ vide : à partir de 0");
  assert.equal(stepDurationText("abc", -1), "0");
  assert.equal(stepDurationText(String(MAX_DURATION_DAYS), 1), String(MAX_DURATION_DAYS));
  assert.equal(stepDurationText("10000", -1), String(MAX_DURATION_DAYS));
  const stepped = edit(visa(), "duration", stepDurationText("11", 1));
  assert.equal(stepped.ok, true, "la valeur obtenue est une durée acceptée");
  assert.equal(stepped.task.durationDays, 12);
});

test("Début : la Fin reste, la Durée suit ; un samedi avance au lundi", () => {
  const monday = edit(visa(), "start", "2026-10-12");
  assert.equal(monday.task.durationDays, 10);
  assert.deepEqual(monday.fields, { Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-23", Duree_1: 10 });
  const saturday = edit(visa(), "start", "2026-10-10");
  assert.equal(iso(saturday.task.start), "2026-10-12");
});

test("Début après la Fin : la tâche se décale, même Durée", () => {
  const shifted = edit(visa(), "start", "2026-10-26"); // lundi
  assert.equal(shifted.ok, true);
  assert.equal(shifted.task.durationDays, 11);
  assert.deepEqual(shifted.fields, { Diff_coffrage: "2026-10-26", Diff_armature: "2026-11-09", Duree_1: 11 });
  const saturday = edit(visa(), "start", "2026-10-24"); // samedi → lundi 26
  assert.deepEqual(saturday.fields, shifted.fields);
  const sameDay = edit(visa(), "start", "2026-10-23"); // le jour de la Fin : pas de décalage
  assert.deepEqual(sameDay.fields, { Diff_coffrage: "2026-10-23", Diff_armature: "2026-10-23", Duree_1: 1 });
});

test("Fin : le Début reste, la Durée suit ; un dimanche recule au vendredi", () => {
  assert.equal(edit(visa(), "end", "2026-10-30").task.durationDays, 16);
  const sunday = edit(visa(), "end", "2026-10-25");
  assert.equal(sunday.ok, true);
  assert.deepEqual(sunday.fields, {}, "Fin recalée sur le 23/10 : rien ne change");
});

test("Fin avant le Début : la tâche se décale, même Durée", () => {
  const shifted = edit(visa(), "end", "2026-10-08"); // jeudi
  assert.equal(shifted.ok, true);
  assert.equal(shifted.task.durationDays, 11);
  assert.deepEqual(shifted.fields, { Diff_coffrage: "2026-09-24", Diff_armature: "2026-10-08", Duree_1: 11 });
  const sunday = edit(visa(), "end", "2026-10-04"); // dimanche → vendredi 02/10
  assert.deepEqual(sunday.fields, { Diff_coffrage: "2026-09-18", Diff_armature: "2026-10-02", Duree_1: 11 });
  const sameDay = edit(visa(), "end", "2026-10-09"); // le jour du Début : pas de décalage
  assert.deepEqual(sameDay.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-09", Duree_1: 1 });
});

test("décalage en jours ouvrés : le 11 novembre (férié) n'est pas compté", () => {
  const before = task({ id: 10, Taches: "Avant", Diff_coffrage: "2026-10-26", Diff_armature: "2026-10-30", Duree_1: 5 });
  assert.deepEqual(
    edit(before, "start", "2026-11-09").fields,
    { Diff_coffrage: "2026-11-09", Diff_armature: "2026-11-16", Duree_1: 5 }
  );
  const after = task({ id: 11, Taches: "Après", Diff_coffrage: "2026-11-23", Diff_armature: "2026-11-27", Duree_1: 5 });
  assert.deepEqual(
    edit(after, "end", "2026-11-13").fields,
    { Diff_coffrage: "2026-11-06", Diff_armature: "2026-11-13", Duree_1: 5 }
  );
});

test("un jalon se déplace et reste un jalon", () => {
  const moved = edit(milestone(), "start", "2026-11-16");
  assert.equal(moved.task.isMilestone, true);
  assert.deepEqual(moved.fields, { Diff_coffrage: "2026-11-16", Diff_armature: "2026-11-16", Duree_1: 0 });
  const byEnd = edit(milestone(), "end", "2026-11-14"); // samedi → lundi 16
  assert.equal(iso(byEnd.task.start), "2026-11-16");
  assert.equal(byEnd.task.isMilestone, true);
});

test("tâche sans dates : une date saisie en fait une tâche d'un jour", () => {
  const start = edit(undated(), "start", "2026-09-19"); // samedi → lundi 21
  assert.equal(iso(start.task.start), "2026-09-21");
  assert.equal(iso(start.task.end), "2026-09-21");
  assert.equal(start.task.durationDays, 1);
  const end = edit(undated(), "end", "2026-09-19"); // samedi → vendredi 18
  assert.equal(iso(end.task.end), "2026-09-18");
  assert.equal(end.task.durationDays, 1);
});

test("tâche sans dates : une Durée part du prochain jour ouvré", () => {
  const result = applyTaskEdit(undated(), "duration", "3", { today: day(2026, 9, 26) }); // samedi
  assert.equal(iso(result.task.start), "2026-09-28");
  assert.equal(iso(result.task.end), "2026-09-30");
});

test("dates invalides refusées", () => {
  assert.equal(edit(visa(), "start", "").ok, false);
  assert.equal(edit(visa(), "end", "pas une date").ok, false);
});

test("nom : obligatoire, limité, espaces retirés", () => {
  assert.equal(edit(visa(), "name", "   ").ok, false);
  assert.equal(edit(visa(), "name", "x".repeat(MAX_TASK_NAME_LENGTH + 1)).ok, false);
  assert.deepEqual(edit(visa(), "name", "  Visa MOE  ").fields, {});
  assert.deepEqual(edit(visa(), "name", "Visa MOE (2e)").fields, { Taches: "Visa MOE (2e)" });
});

test("une colonne inconnue est refusée", () => {
  assert.equal(edit(visa(), "zone", "Z1").ok, false);
});

test("nouvelle tâche : après la dernière Fin de la zone, un jour", () => {
  const afterVisa = buildNewTask({ zoneName: "Zone Z2A", groupTasks: [visa()], today: TODAY });
  assert.equal(afterVisa.id, null);
  assert.equal(afterVisa.name, NEW_TASK_NAME);
  assert.equal(iso(afterVisa.start), "2026-10-26");
  assert.equal(iso(afterVisa.end), "2026-10-26");
  assert.equal(afterVisa.durationDays, 1);
  assert.equal(afterVisa.zoneName, "Zone Z2A");
  const afterMilestone = buildNewTask({ zoneName: "Zone Z2A", groupTasks: [visa(), milestone()], today: TODAY });
  assert.equal(iso(afterMilestone.start), "2026-11-13");
});

test("nouvelle tâche dans une zone sans date : aujourd'hui ou le jour ouvré suivant", () => {
  assert.equal(iso(buildNewTask({ groupTasks: [undated()], today: TODAY }).start), "2026-09-23");
  assert.equal(iso(buildNewTask({ groupTasks: [], today: day(2026, 9, 26) }).start), "2026-09-28");
});

test("colonnes écrites pour une nouvelle tâche", () => {
  const created = buildNewTask({ zoneName: "Zone Z2A", groupTasks: [visa()], today: TODAY });
  assert.deepEqual(buildTaskFields(created, { projectName: "HOTEL DIEU" }), {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z2A",
  });
});

test("Durée : « 5j », « 5 j » et « 5 jours » acceptés, comme dans MS Project", () => {
  ["5j", "5 j", "5 J", "5 jours", "5 jour"].forEach((value) => {
    const result = edit(visa(), "duration", value);
    assert.equal(result.ok, true, `« ${value} » aurait dû être accepté`);
    assert.equal(result.task.durationDays, 5);
  });
  assert.equal(edit(visa(), "duration", "5 js").ok, false);
});

test("tâche à une seule date : l'autre date saisie la complète", () => {
  const startOnly = () => task({ id: 8, Taches: "Début seul", Diff_coffrage: "2026-10-09", Diff_armature: null, Duree_1: 0 });
  const endOnly = () => task({ id: 9, Taches: "Fin seule", Diff_coffrage: null, Diff_armature: "2026-10-23", Duree_1: 0 });
  const withEnd = edit(startOnly(), "end", "2026-10-23");
  assert.equal(withEnd.ok, true);
  assert.deepEqual(withEnd.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
  const withStart = edit(endOnly(), "start", "2026-10-09");
  assert.deepEqual(withStart.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
  assert.match(edit(startOnly(), "end", "2026-10-08").error, /fin ne peut pas être avant le début/i);
  assert.match(edit(endOnly(), "start", "2026-10-26").error, /début ne peut pas être après la fin/i);
});

test("dates hors de 2000-2100 refusées (faute de frappe)", () => {
  const far = edit(visa(), "end", "9999-10-23");
  assert.equal(far.ok, false);
  assert.match(far.error, /entre 2000 et 2100/);
  assert.equal(edit(visa(), "start", "1999-12-31").ok, false);
  assert.equal(edit(visa(), "end", "2100-12-31").ok, true);
});
