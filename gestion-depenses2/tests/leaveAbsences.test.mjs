// planning-synchro/tests/leaveAbsences.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAbsenceIndex, availableDaysAfterLeave, normalizeName, isAbsenceSlot } from "../assets/js/utils/leaveAbsences.js";

const TO = { owner:"Owner", startDate:"Start_Date", startPeriod:"Start_Period", endDate:"End_Date", endPeriod:"End_Period", type:"Type" };
const TEAM = { email:"Email", prenomNom:"PrenomNom", prenom:"Prenom", nom:"Nom" };
const TYPES = ["Congé Payé","Congé Non Payé","RTT","Congé Parental"];

test("reference: charge 29 Jun→10 Jul (10 j) with RTT 30 Jun→3 Jul → 6 available", () => {
  const team = [{ Email:"a@x", PrenomNom:"Jean Dupont" }];
  const timeout = [{ Owner:"A@X", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-07-03", End_Period:"PM", Type:"RTT" }];
  const idx = buildAbsenceIndex(timeout, team, TO, TEAM, TYPES);
  const set = idx.get(normalizeName("Jean Dupont"));
  assert.ok(set && set.size === 8, "4 weekdays × 2 half-days = 8 absent slots");
  const startAt = new Date(2026,5,29,8);   // 29 June 08:00 (Monday)
  const endAt   = new Date(2026,6,10,17);  // 10 July 17:00 (Friday)
  assert.equal(availableDaysAfterLeave(startAt, endAt, set), 6);
});

test("half-day RTT (AM only) removes 0.5 day", () => {
  const team = [{ Email:"a@x", PrenomNom:"Jean Dupont" }];
  const timeout = [{ Owner:"a@x", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-06-30", End_Period:"AM", Type:"RTT" }];
  const set = buildAbsenceIndex(timeout, team, TO, TEAM, TYPES).get(normalizeName("Jean Dupont"));
  assert.equal(set.size, 1);
  assert.ok(isAbsenceSlot(set, "2026-06-30", "am"));
  assert.equal(isAbsenceSlot(set, "2026-06-30", "pm"), false);
  // segment = that single day 08:00→17:00 = 1 day; minus AM = 0.5
  assert.equal(availableDaysAfterLeave(new Date(2026,5,30,8), new Date(2026,5,30,17), set), 0.5);
});

test("unmapped owner (email not in Team) is ignored", () => {
  const idx = buildAbsenceIndex(
    [{ Owner:"ghost@x", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-06-30", End_Period:"PM", Type:"RTT" }],
    [{ Email:"a@x", PrenomNom:"Jean Dupont" }], TO, TEAM, TYPES);
  assert.equal(idx.size, 0);
});

test("non-absence type is skipped", () => {
  const idx = buildAbsenceIndex(
    [{ Owner:"a@x", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-06-30", End_Period:"PM", Type:"Réunion" }],
    [{ Email:"a@x", PrenomNom:"Jean Dupont" }], TO, TEAM, TYPES);
  assert.equal(idx.size, 0);
});

test("weekends never count as available or absent", () => {
  // 4-5 July 2026 = Sat/Sun. A segment over just the weekend has 0 available days.
  assert.equal(availableDaysAfterLeave(new Date(2026,6,4,8), new Date(2026,6,5,17), new Set()), 0);
});
