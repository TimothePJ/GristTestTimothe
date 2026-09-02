import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthKeyFromDate,
  getMonthKeyFromRawMonth,
  resolveSegmentMonthKey,
  getMonthBounds,
  toGristMonthValue,
  getMonthBusinessDays,
  getMonthAvailableDays,
  getMonthShareForRange,
} from "../assets/js/utils/monthSegments.js";

const COLS = { mois: "Mois", startDate: "Start_At" };

test("resolveSegmentMonthKey lit Mois en priorite", () => {
  assert.equal(resolveSegmentMonthKey({ Mois: "2026-09-01" }, COLS), "2026-09");
  assert.equal(resolveSegmentMonthKey({ Mois: new Date(2026, 8, 1) }, COLS), "2026-09");
  // epoch secondes du 1er septembre 2026, comme ecrit par toGristMonthValue
  const epochSeconds = Math.floor(new Date(2026, 8, 1).getTime() / 1000);
  assert.equal(resolveSegmentMonthKey({ Mois: epochSeconds }, COLS), "2026-09");
});

test("resolveSegmentMonthKey retombe sur Start_At quand Mois est vide", () => {
  assert.equal(resolveSegmentMonthKey({ Mois: "", Start_At: "2026-09-17" }, COLS), "2026-09");
  assert.equal(resolveSegmentMonthKey({ Start_At: "2026-09-17" }, COLS), "2026-09");
});

test("resolveSegmentMonthKey est inerte quand les deux colonnes ont disparu", () => {
  assert.equal(resolveSegmentMonthKey({}, COLS), "");
  assert.equal(resolveSegmentMonthKey(null, COLS), "");
});

test("getMonthKeyFromRawMonth couvre tous les formats toleres", () => {
  // ISO, avec et sans jour
  assert.equal(getMonthKeyFromRawMonth("2026-09"), "2026-09");
  assert.equal(getMonthKeyFromRawMonth("2026-09-17"), "2026-09");
  // Date
  assert.equal(getMonthKeyFromRawMonth(new Date(2026, 8, 1)), "2026-09");
  // epoch secondes (<= 1e11) ET epoch millisecondes (> 1e11) du meme instant
  const epochMillis = new Date(2026, 8, 1).getTime();
  assert.equal(getMonthKeyFromRawMonth(Math.floor(epochMillis / 1000)), "2026-09");
  assert.equal(getMonthKeyFromRawMonth(epochMillis), "2026-09");
  // "MM/YYYY", mois a un ou deux chiffres
  assert.equal(getMonthKeyFromRawMonth("09/2026"), "2026-09");
  assert.equal(getMonthKeyFromRawMonth("9/2026"), "2026-09");
  // repli generique new Date(text) : ni l'ISO ni le MM/YYYY ne reconnaissent
  // les dates a slashs complets ("YYYY/MM/DD"), donc ce format retombe sur
  // le parseur Date natif.
  assert.equal(getMonthKeyFromRawMonth("2026/09/17"), "2026-09");
});

test("getMonthKeyFromRawMonth renvoie '' pour les entrees invalides", () => {
  assert.equal(getMonthKeyFromRawMonth(null), "");
  assert.equal(getMonthKeyFromRawMonth(""), "");
  assert.equal(getMonthKeyFromRawMonth("bidon"), "");
  assert.equal(getMonthKeyFromRawMonth(NaN), "");
});

test("monthKeyFromDate exige une Date valide", () => {
  assert.equal(monthKeyFromDate(new Date(2026, 8, 17)), "2026-09");
  assert.equal(monthKeyFromDate(new Date(NaN)), "");
  assert.equal(monthKeyFromDate("2026-09-17"), "");
});

test("getMonthBounds couvre le mois entier", () => {
  const bounds = getMonthBounds("2026-09");
  assert.equal(bounds.startAt.getDate(), 1);
  assert.equal(bounds.startAt.getMonth(), 8);
  assert.equal(bounds.endAt.getDate(), 30);
  assert.equal(bounds.endAt.getHours(), 23);
  assert.equal(getMonthBounds("2026-13"), null);
  assert.equal(getMonthBounds("bidon"), null);
});

test("toGristMonthValue renvoie l'epoch du 1er du mois, en secondes", () => {
  assert.equal(toGristMonthValue("2026-09"), Math.floor(new Date(2026, 8, 1).getTime() / 1000));
  assert.equal(toGristMonthValue("bidon"), null);
});

test("getMonthBusinessDays exclut week-ends ET jours feries", () => {
  // Mai 2026 : 31 jours, 10 de week-end => 21 jours de semaine, moins QUATRE
  // feries — 1er mai (ven), 8 mai (ven), Ascension le 14 (jeu), lundi de
  // Pentecote le 25. Valeur verifiee contre frenchHolidays.js, pas estimee.
  assert.equal(getMonthBusinessDays("2026-05"), 17);
  // Septembre 2026 : aucun ferie, 30 jours, 8 de week-end.
  assert.equal(getMonthBusinessDays("2026-09"), 22);
});

test("getMonthAvailableDays soustrait les demi-journees d'absence", () => {
  const absences = new Set(["2026-09-01:am", "2026-09-01:pm", "2026-09-02:am"]);
  assert.equal(getMonthBusinessDays("2026-09"), 22);
  assert.equal(getMonthAvailableDays("2026-09", absences), 20.5);
});

test("getMonthShareForRange : la somme sur les semaines du mois vaut 1", () => {
  // Semaines ISO couvrant septembre 2026, bornes [lundi 00:00, lundi suivant 00:00[
  let total = 0;
  for (let monday = new Date(2026, 7, 31); monday < new Date(2026, 9, 5); monday.setDate(monday.getDate() + 7)) {
    const start = new Date(monday);
    const end = new Date(monday);
    end.setDate(end.getDate() + 7);
    total += getMonthShareForRange("2026-09", start, end, null);
  }
  assert.ok(Math.abs(total - 1) < 1e-9, `somme des parts = ${total}`);
});

test("getMonthShareForRange retombe sur les jours ouvres si absent tout le mois", () => {
  const allSeptember = new Set();
  for (let day = 1; day <= 30; day += 1) {
    const key = `2026-09-${String(day).padStart(2, "0")}`;
    allSeptember.add(`${key}:am`);
    allSeptember.add(`${key}:pm`);
  }
  const share = getMonthShareForRange(
    "2026-09",
    new Date(2026, 8, 1),
    new Date(2026, 8, 8),
    allSeptember
  );
  // Repli en jours ouvres : [1er, 8] septembre 2026 contient 5 jours ouvres
  // (mar,mer,jeu,ven 1-4, puis lundi 7 ; 5-6 = week-end, le 8 est la borne
  // exclusive) sur 22 jours ouvres dans le mois => 5/22.
  assert.ok(Math.abs(share - 5 / 22) < 1e-9, `part attendue 5/22 = ${5 / 22}, obtenu ${share}`);
});

test("getMonthShareForRange vaut 0 hors du mois", () => {
  assert.equal(getMonthShareForRange("2026-09", new Date(2026, 9, 1), new Date(2026, 9, 8), null), 0);
});
