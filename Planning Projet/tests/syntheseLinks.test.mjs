import test from "node:test";
import assert from "node:assert/strict";

import {
  addWorkingDays,
  cascadeFrom,
  computeLinkedDates,
  formatLink,
  nextWorkingDay,
  parseLink,
  previousWorkingDay,
  startBeforeWorkingDays,
} from "../assets/js/services/syntheseLinks.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

test("texte du lien : lecture tolérante, null si illisible", () => {
  assert.deepEqual(parseLink("131 FD+5"), { predId: 131, type: "FD", lag: 5 });
  assert.deepEqual(parseLink("12 dd"), { predId: 12, type: "DD", lag: 0 });
  assert.deepEqual(parseLink("7 FF-2"), { predId: 7, type: "FF", lag: -2 });
  assert.deepEqual(parseLink(" 7FF + 3 j "), { predId: 7, type: "FF", lag: 3 });
  assert.deepEqual(parseLink("8 FD+1 jours"), { predId: 8, type: "FD", lag: 1 });
  for (const bad of ["", null, undefined, "abc", "0 FD", "12 XX", "12 FD+", "FD 12", "12.5 FD"]) {
    assert.equal(parseLink(bad), null, String(bad));
  }
});

test("écriture du lien : relue à l'identique", () => {
  assert.equal(formatLink({ predId: 131, type: "FD", lag: 5 }), "131 FD+5");
  assert.equal(formatLink({ predId: 12, type: "DD", lag: 0 }), "12 DD");
  assert.equal(formatLink({ predId: 7, type: "FF", lag: -2 }), "7 FF-2");
  assert.deepEqual(parseLink(formatLink({ predId: 7, type: "FF", lag: -2 })), { predId: 7, type: "FF", lag: -2 });
});

test("jours ouvrés : ± n jours, week-end et férié sautés", () => {
  assert.equal(iso(addWorkingDays(day(2026, 1, 2), 1)), "2026-01-05", "vendredi + 1 → lundi");
  assert.equal(iso(addWorkingDays(day(2026, 1, 2), 0)), "2026-01-02");
  assert.equal(iso(addWorkingDays(day(2026, 1, 5), -1)), "2026-01-02", "lundi - 1 → vendredi");
  assert.equal(iso(addWorkingDays(day(2026, 11, 10), 1)), "2026-11-12", "le 11 novembre est férié");
  assert.equal(iso(addWorkingDays(day(2026, 3, 2), 5)), "2026-03-09");
  assert.equal(iso(nextWorkingDay(day(2026, 1, 3))), "2026-01-05");
  assert.equal(iso(previousWorkingDay(day(2026, 1, 3))), "2026-01-02");
  assert.equal(iso(startBeforeWorkingDays(day(2026, 2, 9), 2)), "2026-02-06");
});

test("date liée : FD, DD, FF, décalage, vers une tâche ou un jalon", () => {
  const pred = { start: day(2026, 1, 2), end: day(2026, 1, 5) };
  const fdTask = computeLinkedDates(pred, { type: "FD", lag: 0 }, 10);
  assert.deepEqual([iso(fdTask.start), iso(fdTask.end), fdTask.durationDays, fdTask.isMilestone], ["2026-01-06", "2026-01-19", 10, false]);
  const fdMilestone = computeLinkedDates(pred, { type: "FD", lag: 0 }, 0);
  assert.deepEqual([iso(fdMilestone.start), iso(fdMilestone.end), fdMilestone.isMilestone], ["2026-01-05", "2026-01-05", true]);
  const fdLag = computeLinkedDates({ start: day(2026, 2, 17), end: day(2026, 3, 2) }, { type: "FD", lag: 5 }, 0);
  assert.equal(iso(fdLag.start), "2026-03-09");
  const overlap = computeLinkedDates(pred, { type: "FD", lag: -1 }, 2);
  assert.deepEqual([iso(overlap.start), iso(overlap.end)], ["2026-01-05", "2026-01-06"], "FD-1 : commence le jour de la fin");
  const dd = computeLinkedDates({ start: day(2026, 1, 2), end: day(2026, 1, 2) }, { type: "DD", lag: 0 }, 2);
  assert.deepEqual([iso(dd.start), iso(dd.end)], ["2026-01-02", "2026-01-05"]);
  const ff = computeLinkedDates({ start: day(2026, 2, 3), end: day(2026, 2, 9) }, { type: "FF", lag: 0 }, 2);
  assert.deepEqual([iso(ff.start), iso(ff.end)], ["2026-02-06", "2026-02-09"]);
  const ffMilestone = computeLinkedDates({ start: day(2026, 2, 3), end: day(2026, 2, 9) }, { type: "FF", lag: 1 }, 0);
  assert.deepEqual([iso(ffMilestone.start), ffMilestone.isMilestone], ["2026-02-10", true]);
  const unknownDuration = computeLinkedDates(pred, { type: "FD", lag: 0 }, null);
  assert.deepEqual([iso(unknownDuration.start), iso(unknownDuration.end), unknownDuration.durationDays], ["2026-01-06", "2026-01-06", 1]);
  assert.equal(computeLinkedDates({ start: null, end: null }, { type: "FD", lag: 0 }, 2), null);
  assert.equal(computeLinkedDates(pred, null, 2), null);
});

// Modèle de la capture MS Project : [id, durée, lien].
const CHAIN = [
  [100, 0, null], // RECEPTION ARCH/TOPO/STR
  [101, 2, "100 DD"], // FOND DE PLAN DE SYNTHESE NIV
  [102, 0, "101 FD"], // DIFFUSION FDS Indice 0
  [103, 10, "102 FD"], // RECEPTION RENDU CET RESEAUX (GED)
  [104, 10, "103 FD"], // VISA Indice 0
  [105, 5, "103 FD"], // PLAN DE SYNTHESE RESEAUX (cycle 1)
  [106, 0, "105 FD"], // REUNION + DIFFUSION SYT RSX Indice 0
  [107, 5, "106 FD"], // RECEPTION RENDU CET RSX RESA TER (cycle 2)
  [108, 5, "107 FD"], // PLAN DE SYNTHESE RESEAUX (cycle 2)
  [109, 2, "108 FF"], // RESERVATIONS
  [110, 2, "108 FF"], // TERMINAUX
  [111, 0, "108 FD"], // REUNION + DIFFUSION SYT
  [112, 5, "111 FD"], // RECEPTION RENDU CET RSX RESA TER (cycle 3)
  [113, 10, "112 FD"], // VISA Indice A
  [114, 5, "112 FD"], // PLAN DE SYNTHESE RESEAUX (cycle 3)
  [115, 2, "114 FF"], // RESERVATIONS
  [116, 2, "114 FF"], // TERMINAUX
  [117, 0, "114 FD"], // REUNION + DIFFUSION SYT
  [118, 0, "113 FD+5"], // SIGNATURE PLANS SYNTHESE
  [119, 0, "118 FD"], // DEMARRAGE GO (date prévisionnelle)
];

function chain() {
  return CHAIN.map(([id, days, link]) => ({
    id,
    start: null,
    end: null,
    durationDays: days,
    isMilestone: false,
    link: parseLink(link),
  }));
}

function datesOf(updates) {
  return Object.fromEntries(updates.map((task) => [task.id, [iso(task.start), iso(task.end)]]));
}

test("cascade : la capture MS Project est retrouvée en datant la première tâche au 02/01/26", () => {
  const tasks = chain();
  const first = { ...tasks[0], start: day(2026, 1, 2), end: day(2026, 1, 2), durationDays: 0, isMilestone: true };
  const updates = cascadeFrom(first, tasks);
  assert.deepEqual(datesOf(updates), {
    101: ["2026-01-02", "2026-01-05"],
    102: ["2026-01-05", "2026-01-05"],
    103: ["2026-01-06", "2026-01-19"],
    104: ["2026-01-20", "2026-02-02"],
    105: ["2026-01-20", "2026-01-26"],
    106: ["2026-01-26", "2026-01-26"],
    107: ["2026-01-27", "2026-02-02"],
    108: ["2026-02-03", "2026-02-09"],
    109: ["2026-02-06", "2026-02-09"],
    110: ["2026-02-06", "2026-02-09"],
    111: ["2026-02-09", "2026-02-09"],
    112: ["2026-02-10", "2026-02-16"],
    113: ["2026-02-17", "2026-03-02"],
    114: ["2026-02-17", "2026-02-23"],
    115: ["2026-02-20", "2026-02-23"],
    116: ["2026-02-20", "2026-02-23"],
    117: ["2026-02-23", "2026-02-23"],
    118: ["2026-03-09", "2026-03-09"],
    119: ["2026-03-09", "2026-03-09"],
  });
  const milestones = updates.filter((task) => task.isMilestone).map((task) => task.id);
  assert.deepEqual(milestones, [102, 106, 111, 117, 118, 119]);
});

// Review Focus 2 : une date saisie au milieu de la chaîne ne remonte jamais vers l'amont.
test("cascade depuis le milieu : seules les tâches en aval bougent", () => {
  const tasks = chain();
  const first = { ...tasks[0], start: day(2026, 1, 2), end: day(2026, 1, 2), durationDays: 0, isMilestone: true };
  const dated = new Map(cascadeFrom(first, tasks).map((task) => [task.id, task]));
  const current = tasks.map((task) => dated.get(task.id) || (task.id === 100 ? first : task));
  const visa = current.find((task) => task.id === 113);
  const later = { ...visa, end: day(2026, 3, 9), durationDays: 15 };
  assert.deepEqual(datesOf(cascadeFrom(later, current)), {
    118: ["2026-03-16", "2026-03-16"],
    119: ["2026-03-16", "2026-03-16"],
  });
});

test("cascade : prédécesseur non daté, rien ne bouge ; tâches déjà à jour, rien n'est rendu", () => {
  const tasks = chain();
  assert.deepEqual(cascadeFrom(tasks[0], tasks), []);
  const first = { ...tasks[0], start: day(2026, 1, 2), end: day(2026, 1, 2), durationDays: 0, isMilestone: true };
  const once = new Map(cascadeFrom(first, tasks).map((task) => [task.id, task]));
  const upToDate = tasks.map((task) => once.get(task.id) || task);
  assert.deepEqual(cascadeFrom(first, upToDate), []);
});

// Review Focus 1 : un lien abîmé à la main (boucle, lien vers une ligne absente) ne bloque rien.
test("cascade : une boucle s'arrête, un lien vers une ligne absente est ignoré", () => {
  const a = { id: 1, start: day(2026, 1, 5), end: day(2026, 1, 6), durationDays: 2, isMilestone: false, link: parseLink("2 FD") };
  const b = { id: 2, start: null, end: null, durationDays: 1, isMilestone: false, link: parseLink("1 FD") };
  const orphan = { id: 3, start: null, end: null, durationDays: 1, isMilestone: false, link: parseLink("99 FD") };
  const updates = cascadeFrom(a, [a, b, orphan]);
  assert.deepEqual(datesOf(updates), { 2: ["2026-01-07", "2026-01-07"] });
});
