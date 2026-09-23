import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSyntheseTaskFields,
  buildSyntheseTasks,
  computeRemainingHours,
  computeWorkHours,
  countWorkingDays,
  endAfterWorkingDays,
  formatHours,
  formatTaskDate,
  getProgressState,
  isTaskLate,
  isSyntheseTypeDoc,
  parseGristDate,
  snapToWorkingRange,
  toIsoDate,
} from "../assets/js/services/syntheseTasks.js";

const day = (iso) => parseGristDate(iso);

test("un segment dessiné du dimanche au samedi est recalé du lundi au vendredi", () => {
  const range = snapToWorkingRange(day("2026-09-20"), day("2026-09-26"));
  assert.equal(toIsoDate(range.start), "2026-09-21");
  assert.equal(toIsoDate(range.end), "2026-09-25");
  assert.equal(countWorkingDays(range.start, range.end), 5);
});

test("le week-end reste dans le segment mais ne compte pas dans la durée", () => {
  const range = snapToWorkingRange(day("2026-09-21"), day("2026-09-28"));
  assert.equal(toIsoDate(range.end), "2026-09-28");
  assert.equal(countWorkingDays(range.start, range.end), 6);
});

test("un jour férié ne compte pas et une plage sans jour ouvré est refusée", () => {
  // 11 novembre 2026 : mercredi férié.
  assert.equal(countWorkingDays(day("2026-11-09"), day("2026-11-13")), 4);
  assert.equal(snapToWorkingRange(day("2026-09-26"), day("2026-09-27")), null);
});

test("la fin se déduit d'une durée en jours ouvrés", () => {
  assert.equal(toIsoDate(endAfterWorkingDays(day("2026-09-21"), 5)), "2026-09-25");
  assert.equal(toIsoDate(endAfterWorkingDays(day("2026-09-24"), 3)), "2026-09-28");
});

test("travail = jours x 7 h et travail restant selon Realise", () => {
  assert.equal(computeWorkHours(5), 35);
  assert.equal(computeRemainingHours(35, 40), 21);
  assert.equal(computeRemainingHours(35, 32), 23.8);
  assert.equal(formatHours(23.8), "23H48min");
  assert.equal(formatHours(35), "35H00min");
  assert.equal(formatHours(computeRemainingHours(35, 45)), "19H15min");
  assert.equal(formatHours(5.5), "05H30min");
  assert.equal(getProgressState(0), "todo");
  assert.equal(getProgressState(32), "progress");
  assert.equal(getProgressState(100), "done");
});

test("les dates Grist en secondes, ISO ou jj/mm/aaaa donnent le même jour", () => {
  const seconds = Date.UTC(2026, 8, 21) / 1000;
  assert.equal(toIsoDate(parseGristDate(seconds)), "2026-09-21");
  assert.equal(toIsoDate(parseGristDate("21/09/2026")), "2026-09-21");
  assert.equal(formatTaskDate(day("2026-09-21")), "Lun 21/09/26");
});

test("seules les lignes SYNTHESE datées deviennent des segments", () => {
  const tasks = buildSyntheseTasks([
    {
      id: 7, Type_doc: "Synthèse", Taches: "Démarrage analyse synthèse",
      Diff_coffrage: "2026-09-21", Diff_armature: "2026-09-25",
      Realise: 32, Ressource: "Salwa Aoun",
    },
    { id: 8, Type_doc: "COFFRAGE", Diff_coffrage: "2026-09-21", Diff_armature: "2026-09-25" },
    { id: 9, Type_doc: "SYNTHESE", Taches: "Sans dates" },
  ]);
  assert.equal(tasks.length, 1);
  assert.deepEqual(
    {
      id: tasks[0].id,
      durationDays: tasks[0].durationDays,
      workHours: tasks[0].workHours,
      remainingHours: tasks[0].remainingHours,
      resourceKey: tasks[0].resourceKey,
    },
    { id: 7, durationDays: 5, workHours: 35, remainingHours: 23.8, resourceKey: "salwa aoun" }
  );
  assert.ok(isSyntheseTypeDoc("synthese"));
});

test("les champs écrits portent les dates recalées et la durée en jours ouvrés", () => {
  const fields = buildSyntheseTaskFields({
    name: " Analyse de synthèse ",
    start: day("2026-09-20"),
    end: day("2026-09-26"),
    realise: 40,
    resourceName: "",
    projectName: "VENTADOUR",
    service: "Synthese",
  });
  assert.deepEqual(fields, {
    Taches: "Analyse de synthèse",
    Type_doc: "SYNTHESE",
    Diff_coffrage: "2026-09-21",
    Diff_armature: "2026-09-25",
    Duree_1: 5,
    Realise: 40,
    Ressource: "",
    NomProjet: "VENTADOUR",
    Service: "Synthese",
  });
  assert.throws(() => buildSyntheseTaskFields({ start: day("2026-09-26"), end: day("2026-09-27") }));
});

test("une tâche non finie dont la fin est passée est en retard", () => {
  const today = day("2026-09-21");
  assert.equal(isTaskLate({ end: day("2026-09-18"), realise: 40 }, today), true);
  assert.equal(isTaskLate({ end: day("2026-09-18"), realise: 100 }, today), false);
  assert.equal(isTaskLate({ end: day("2026-09-21"), realise: 0 }, today), false);
});
