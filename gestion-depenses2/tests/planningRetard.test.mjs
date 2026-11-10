// Retard des documents du planning Structure, en jours ouvrés (week-ends et jours fériés
// exclus). Module partagé par Planning Projet (frise, synchro, vue Global) et ListeDePlan.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isFrenchHoliday } from "../assets/js/utils/frenchHolidays.js";
import {
  computePlanningRetardDays,
  countPlanningLateWorkingDays,
  isPlanningWorkingDay,
  parsePlanningDay,
  resolvePlanningDueDate,
} from "../assets/js/utils/planningRetard.js";

const day = (year, month, date) => new Date(year, month - 1, date);
// Une colonne Date Grist : secondes depuis 1970, à minuit UTC.
const gristSeconds = (year, month, date) => Date.UTC(year, month - 1, date) / 1000;

test("lecture d'une date : toutes les écritures Grist donnent le même jour, à minuit local", () => {
  const expected = day(2026, 11, 1);
  assert.deepEqual(parsePlanningDay("2026-11-01"), expected, "ISO");
  assert.deepEqual(parsePlanningDay("01/11/2026"), expected, "JJ/MM/AAAA");
  assert.deepEqual(parsePlanningDay(gristSeconds(2026, 11, 1)), expected, "secondes Grist");
  assert.deepEqual(parsePlanningDay(String(gristSeconds(2026, 11, 1))), expected, "secondes Grist en texte");
  assert.deepEqual(parsePlanningDay(gristSeconds(2026, 11, 1) * 1000), expected, "millisecondes");
  assert.deepEqual(parsePlanningDay(new Date(2026, 10, 1, 17, 45)), expected, "Date avec une heure");
  assert.deepEqual(parsePlanningDay("2026-11-01T00:00:00.000Z"), expected, "minuit UTC sérialisé");
});

test("lecture d'une date : un instant qui n'est pas minuit UTC se lit à l'heure locale", () => {
  const instant = "2026-10-31T23:00:00.000Z";
  const local = new Date(instant);
  assert.deepEqual(
    parsePlanningDay(instant),
    day(local.getFullYear(), local.getMonth() + 1, local.getDate())
  );
});

test("lecture d'une date : valeur vide, illisible ou hors de toute réalité → null", () => {
  [null, undefined, "", "  ", "abc", "31/02/2026", "2026-13-01", Number.NaN, 1e15, "0001-01-01"].forEach(
    (value) => assert.equal(parsePlanningDay(value), null, `valeur ${String(value)}`)
  );
});

test("jour ouvré : du lundi au vendredi, hors jours fériés", () => {
  assert.equal(isPlanningWorkingDay(day(2026, 11, 9)), true, "lundi");
  assert.equal(isPlanningWorkingDay(day(2026, 11, 7)), false, "samedi");
  assert.equal(isPlanningWorkingDay(day(2026, 11, 8)), false, "dimanche");
  assert.equal(isPlanningWorkingDay(day(2026, 11, 11)), false, "mercredi 11 novembre");
  assert.equal(isPlanningWorkingDay(day(2026, 5, 25)), false, "lundi de Pentecôte");
});

test("jours de retard : jours ouvrés après l'échéance, jusqu'à la date de référence comprise", () => {
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 6), day(2026, 11, 9)), 1, "vendredi → lundi");
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 6), day(2026, 11, 7)), 0, "vendredi → samedi");
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 10), day(2026, 11, 12)), 1, "le 11 novembre ne compte pas");
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 1), day(2026, 11, 10)), 7, "échéance un dimanche férié");
  assert.equal(countPlanningLateWorkingDays(day(2026, 12, 30), day(2027, 1, 4)), 2, "changement d'année, 1er janvier férié");
});

test("jours de retard : aucun quand la référence est le jour même ou avant", () => {
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 9), day(2026, 11, 9)), 0);
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 9), day(2026, 11, 2)), 0);
  assert.equal(countPlanningLateWorkingDays(null, day(2026, 11, 9)), 0);
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 9), null), 0);
});

test("jours de retard : le passage à l'heure d'été ne fait pas perdre de jour", () => {
  // Du vendredi 20/03/26 au mercredi 01/04/26, nuit du 28 au 29 mars comprise.
  assert.equal(countPlanningLateWorkingDays(day(2026, 3, 20), day(2026, 4, 1)), 8);
  assert.equal(countPlanningLateWorkingDays(day(2026, 10, 23), day(2026, 10, 27)), 2, "heure d'hiver");
});

test("jours de retard : l'heure de la référence ne change rien", () => {
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 6), new Date(2026, 10, 9, 0, 1)), 1);
  assert.equal(countPlanningLateWorkingDays(day(2026, 11, 6), new Date(2026, 10, 9, 23, 59)), 1);
  assert.equal(countPlanningLateWorkingDays(gristSeconds(2026, 11, 6), "2026-11-09"), 1, "valeurs Grist brutes");
});

test("jours de retard : identique au décompte jour par jour, sur cinq ans de paires", () => {
  const naive = (from, to) => {
    let count = 0;
    for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1); d <= to; d.setDate(d.getDate() + 1)) {
      const weekday = d.getDay();
      if (weekday !== 0 && weekday !== 6 && !isFrenchHoliday(d)) count += 1;
    }
    return count;
  };
  let seed = 7;
  const random = (max) => {
    seed = (seed * 48271) % 2147483647;
    return seed % max;
  };
  for (let index = 0; index < 400; index += 1) {
    const from = day(2024, 1, 1 + random(1500));
    const to = day(from.getFullYear(), from.getMonth() + 1, from.getDate() + random(500));
    assert.equal(countPlanningLateWorkingDays(from, to), naive(from, to), `${from.toDateString()} → ${to.toDateString()}`);
  }
});

test("échéance : fin de la barre selon le type de document", () => {
  const dates = { diffCoffrage: "2026-11-02", diffArmature: "2026-11-20" };
  assert.deepEqual(resolvePlanningDueDate({ typeDoc: "ARMATURES", ...dates }), day(2026, 11, 20));
  assert.deepEqual(resolvePlanningDueDate({ typeDoc: "COFFRAGE", ...dates }), day(2026, 11, 2));
  assert.deepEqual(resolvePlanningDueDate({ typeDoc: "NDC", ...dates }), day(2026, 11, 2));
  assert.deepEqual(resolvePlanningDueDate({ typeDoc: "Plan de réservation", ...dates }), day(2026, 11, 2));
  assert.equal(resolvePlanningDueDate({ typeDoc: "", ...dates }), null);
  assert.equal(resolvePlanningDueDate({ typeDoc: "ARMATURES", diffCoffrage: "2026-11-02" }), null);
});

test("échéance d'un coffrage lié à une ligne de planning : démarrage des travaux moins Durée 3 semaines", () => {
  const linked = { typeDoc: "COFFRAGE", lignePlanning: "12", diffCoffrage: "2026-12-31", demarrage: "2026-11-30" };
  assert.deepEqual(resolvePlanningDueDate({ ...linked, duree3: 4 }), day(2026, 11, 2));
  assert.deepEqual(resolvePlanningDueDate({ ...linked, duree3: "0" }), day(2026, 11, 30));
  assert.deepEqual(resolvePlanningDueDate({ ...linked, duree3: "" }), day(2026, 12, 31), "sans durée : Diff_coffrage");
  assert.deepEqual(resolvePlanningDueDate({ ...linked, demarrage: null, duree3: 4 }), day(2026, 12, 31), "sans démarrage");
  assert.deepEqual(resolvePlanningDueDate({ ...linked, lignePlanning: "0", duree3: 4 }), day(2026, 12, 31), "ligne 0 = non lié");
});

const NOW = new Date(2026, 10, 10, 15, 0); // mardi 10/11/26

test("retard d'un document non réalisé : jours ouvrés de l'échéance à aujourd'hui", () => {
  assert.equal(computePlanningRetardDays({ typeDoc: "COFFRAGE", realise: 0, diffCoffrage: "2026-11-01" }, NOW), 7);
  assert.equal(computePlanningRetardDays({ typeDoc: "COFFRAGE", realise: 50, diffCoffrage: "2026-11-01" }, NOW), 7, "réalisé en partie");
  assert.equal(computePlanningRetardDays({ typeDoc: "ARMATURES", realise: 0, diffArmature: "2026-11-30" }, NOW), 0, "pas encore échu");
  assert.equal(computePlanningRetardDays({ typeDoc: "NDC", realise: 0 }, NOW), 0, "sans échéance");
  assert.equal(computePlanningRetardDays({ typeDoc: "", realise: 0, diffCoffrage: "2026-11-01" }, NOW), 0, "sans type");
});

test("retard d'un document réalisé : figé à sa date de réalisation", () => {
  const done = { typeDoc: "COFFRAGE", realise: 100, diffCoffrage: "2026-10-30" };
  assert.equal(computePlanningRetardDays({ ...done, dateRealise: "2026-11-05" }, NOW), 4);
  assert.equal(computePlanningRetardDays({ ...done, dateRealise: "2026-10-28" }, NOW), 0, "en avance");
  assert.equal(computePlanningRetardDays({ ...done, dateRealise: "2026-11-05" }, new Date(2030, 0, 1)), 4, "ne bouge plus");
});

test("retard d'un document clôturé à la main : compté à Date_Cloture, quel que soit le réalisé", () => {
  const base = { typeDoc: "COFFRAGE", realise: 0, diffCoffrage: "2026-10-30", dateRealise: "2026-11-20" };
  assert.equal(computePlanningRetardDays({ ...base, dateCloture: "2026-11-03" }, NOW), 2);
});

test("Date_Cloture lue comme pour le réalisé : une valeur que le noyau de clôture refuse ne clôture pas", () => {
  // Le réalisé (0 %) et Date_Realise ne voient pas de clôture : le retard non plus.
  const seconds = String(Date.UTC(2026, 9, 15) / 1000);
  const base = { typeDoc: "NDC", realise: 0, diffCoffrage: "2026-10-01", currentRetard: 0 };
  assert.equal(
    computePlanningRetardDays({ ...base, dateCloture: seconds }, NOW),
    countPlanningLateWorkingDays(day(2026, 10, 1), NOW)
  );
});

test("Date_Cloture lue comme pour le réalisé : un instant ISO garde sa date écrite", () => {
  // Date_Realise forcée = 15/10 (partie date) : le retard s'arrête aussi au 15/10.
  const base = { typeDoc: "NDC", realise: 100, diffCoffrage: "2026-10-01" };
  assert.equal(computePlanningRetardDays({ ...base, dateCloture: "2026-10-15T23:30:00Z" }, NOW), 10);
});

test("retard d'un document réalisé sans date connue : la valeur enregistrée est gardée", () => {
  const done = { typeDoc: "COFFRAGE", realise: 100, diffCoffrage: "2026-10-30" };
  assert.equal(computePlanningRetardDays({ ...done, currentRetard: 7 }, NOW), 7);
  assert.equal(computePlanningRetardDays({ ...done, currentRetard: "7" }, NOW), 7);
  assert.equal(computePlanningRetardDays({ ...done, currentRetard: -3 }, NOW), 0);
  assert.equal(computePlanningRetardDays({ ...done, currentRetard: null }, NOW), 0);
});
