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
  isWorkingDay,
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

// Le décompte se fait par soustraction dans un cumul des jours ouvrés, plus jour par jour : il doit
// donner exactement ce que donne le parcours des jours, qui sert ici de référence.
function countDayByDay(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end < start) return 0;
  let count = 0;
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    cursor <= end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  ) {
    if (isWorkingDay(cursor)) count += 1;
  }
  return count;
}

test("jours ouvrés d'une plage : même compte que jour par jour, sur des plages tirées au hasard", () => {
  // Tirage reproductible : toujours les mêmes plages.
  let seed = 20261123;
  const random = (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  for (let index = 0; index < 4000; index += 1) {
    // De 1998 à 2103 : la plupart dans le cumul (2000–2100), quelques-unes à cheval ou en dehors.
    const start = new Date(1998 + random(104), random(12), 1 + random(31), random(24), random(60));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + random(900) - 20, random(24), random(60));
    assert.equal(
      countWorkingDays(start, end),
      countDayByDay(start, end),
      `du ${start.toISOString()} au ${end.toISOString()}`
    );
  }
});

test("jours ouvrés d'une plage : bornes du cumul, fériés, même jour, plage inversée, dates illisibles", () => {
  const cases = [
    [new Date(2000, 0, 1), new Date(2000, 0, 31)],
    [new Date(1999, 11, 27), new Date(2000, 0, 7)],
    [new Date(2100, 11, 1), new Date(2100, 11, 31)],
    [new Date(2100, 11, 27), new Date(2101, 0, 8)],
    // Lundi de Pâques, 1er et 8 mai, Ascension 2026.
    [new Date(2026, 3, 3), new Date(2026, 4, 18)],
    // Changements d'heure : derniers dimanches de mars et d'octobre.
    [new Date(2026, 2, 27), new Date(2026, 2, 31)],
    [new Date(2026, 9, 23), new Date(2026, 9, 27)],
    // Même jour, avec et sans heure ; fin plus tôt dans la même journée que le début.
    [new Date(2026, 8, 23), new Date(2026, 8, 23)],
    [new Date(2026, 8, 23, 8), new Date(2026, 8, 23, 17)],
    [new Date(2026, 8, 23, 17), new Date(2026, 8, 23, 8)],
    [new Date(2026, 8, 25), new Date(2026, 8, 21)],
    [new Date(NaN), new Date(2026, 8, 21)],
    [new Date(2026, 8, 21), new Date(NaN)],
  ];
  cases.forEach(([start, end]) => {
    assert.equal(countWorkingDays(start, end), countDayByDay(start, end), `du ${String(start)} au ${String(end)}`);
  });
  assert.equal(countWorkingDays(new Date(2026, 8, 21), new Date(2026, 8, 25)), 5);
  assert.equal(countWorkingDays("2026-09-21", new Date(2026, 8, 25)), 0);
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
