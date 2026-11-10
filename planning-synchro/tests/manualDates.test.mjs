import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readManualDates,
  isoToGristDate,
  diffManualDates,
  sameManualDates,
  firstAllowedManualIso,
  isIsoDate,
} from "../assets/js/top/manualDates.js";

const cols = { id: "id", manualSmoothingDate: "Date_Manuel_Lissage" };

test("readManualDates : lit des secondes Grist", () => {
  const rows = [{ id: 3, Date_Manuel_Lissage: Date.UTC(2027, 0, 16) / 1000 }];
  assert.deepEqual(readManualDates(rows, cols), { hasColumn: true, dates: { "3": "2027-01-16" } });
});

test("readManualDates : lit les textes ISO et FR", () => {
  const rows = [
    { id: 1, Date_Manuel_Lissage: "2027-02-03" },
    { id: 2, Date_Manuel_Lissage: "03/02/2027" },
  ];
  assert.deepEqual(readManualDates(rows, cols).dates, { "1": "2027-02-03", "2": "2027-02-03" });
});

test("readManualDates : ignore les valeurs vides ou illisibles", () => {
  const rows = [
    { id: 1, Date_Manuel_Lissage: "" },
    { id: 2, Date_Manuel_Lissage: null },
    { id: 3, Date_Manuel_Lissage: "abc" },
  ];
  assert.deepEqual(readManualDates(rows, cols), { hasColumn: true, dates: {} });
});

test("readManualDates : colonne absente", () => {
  assert.deepEqual(readManualDates([{ id: 1 }, { id: 2 }], cols), { hasColumn: false, dates: {} });
  assert.deepEqual(readManualDates([], cols), { hasColumn: false, dates: {} });
});

test("isoToGristDate : minuit UTC en secondes, null si invalide", () => {
  assert.equal(isoToGristDate("2027-01-16"), Date.UTC(2027, 0, 16) / 1000);
  assert.equal(isoToGristDate("2027-02-30"), null);
  assert.equal(isoToGristDate(""), null);
  assert.equal(isoToGristDate(null), null);
});

test("diffManualDates : une entrée par différence, triée par rowId", () => {
  assert.deepEqual(
    diffManualDates({ "2": "2027-01-01", "5": "2027-03-01" }, { "5": "2027-03-02", "7": "2027-04-01" }),
    [
      { rowId: 2, iso: null },
      { rowId: 5, iso: "2027-03-02" },
      { rowId: 7, iso: "2027-04-01" },
    ],
  );
  assert.deepEqual(diffManualDates({ "1": "2027-01-01" }, { "1": "2027-01-01" }), []);
});

test("sameManualDates : égalité des dictionnaires", () => {
  assert.equal(sameManualDates({ "1": "2027-01-01" }, { "1": "2027-01-01" }), true);
  assert.equal(sameManualDates({ "1": "2027-01-01" }, { "1": "2027-01-02" }), false);
  assert.equal(sameManualDates({ "1": "2027-01-01" }, {}), false);
  assert.equal(sameManualDates({}, {}), true);
});

test("firstAllowedManualIso : aujourd'hui ou le 1er du mois de départ", () => {
  assert.equal(firstAllowedManualIso("2027-01", "2027-01-10"), "2027-01-10");
  assert.equal(firstAllowedManualIso("2026-10", "2027-01-10"), "2026-10-01");
});

test("isIsoDate : date AAAA-MM-JJ réelle seulement", () => {
  assert.equal(isIsoDate("2027-01-16"), true);
  assert.equal(isIsoDate("2027-02-30"), false);
  assert.equal(isIsoDate("16/01/2027"), false);
  assert.equal(isIsoDate(""), false);
  assert.equal(isIsoDate(null), false);
});
