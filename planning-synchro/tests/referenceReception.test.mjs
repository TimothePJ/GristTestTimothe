import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReceptionSummaries } from "../assets/js/services/referenceReception.js";
import { computePlanningPhaseBounds } from "../assets/js/top/phases.js";

const columns = {
  id: "id", projectName: "NomProjet", id2: "ID2", taskName: "Taches", typeDoc: "Type_doc",
  zone: "Zone", dateLimite: "Date_limite", diffCoffrage: "Diff_coffrage", demarragesTravaux: "Demarrages_travaux",
};

const planningRows = [
  { id: 4001, NomProjet: "P", ID2: "3001", Type_doc: "COFFRAGE", Taches: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-15" },
  { id: 4002, NomProjet: "P", ID2: "3031", Type_doc: "COFFRAGE", Taches: "PH RDC - COF", Zone: "Zone 1 / BAT BC", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-15" },
];

test("buildReceptionSummaries: links blocking References2 rows to the planning row", () => {
  const referenceRows = [
    // Two blocking references for row 4001 (matched by NomProjet+ID2+Type+Taches+Zone):
    { id: 1, NomProjet: "P", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "2", Recu: "" },
    { id: 2, NomProjet: "P", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "3", Recu: "15/01/2027" },
    // Non-blocking -> ignored:
    { id: 3, NomProjet: "P", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "Zone 1 / BAT BC", Bloquant: false, DureeLimite: "1", Recu: "" },
    // Different task -> no link:
    { id: 4, NomProjet: "P", NumeroDocument: "3031", Type_document: "COFFRAGE", NomDocument: "PH RDC - COF", Zone: "Zone 1 / BAT BC", Bloquant: true, DureeLimite: "2", Recu: "10/02/2027" },
  ];
  const map = buildReceptionSummaries(planningRows, referenceRows, columns);

  const s = map.get(4001);
  assert.ok(s, "row 4001 has a reception summary");
  assert.equal(s.totalCount, 2, "two blocking references (non-blocking excluded)");
  assert.equal(s.receivedCount, 1);
  assert.equal(s.missingCount, 1);
  assert.equal(s.status, "mixed", "one received + one missing -> mixed");
  // Sorted by date-limite asc: DureeLimite 3 (2027-02-01 - 3 wks = 2027-01-11) first.
  assert.equal(s.firstDateLimiteIso, "2027-01-11");

  // Row 4002 -> its single blocking reference is received -> complete.
  const s2 = map.get(4002);
  assert.ok(s2);
  assert.equal(s2.status, "complete");
});

test("frise bounds EXCLUDE reception bands (band precedes phase -> stays out of range)", () => {
  // Earliest phase = 2027-02-01; a blocking reference with 8-week DureeLimite
  // sits ~2026-12 (BEFORE the phase). computePlanningPhaseBounds counts PHASES
  // only: the band deliberately falls before bounds.startDate, so it is never
  // parked at the far-left edge of the frise (it stays out of range; vis
  // align:'center' also prevents any content pinning).
  const P = "X";
  const cols2 = { id: "id", projectName: "NomProjet", id2: "ID2", taskName: "Taches", typeDoc: "Type_doc", zone: "Zone", dateLimite: "Date_limite", diffCoffrage: "Diff_coffrage", demarragesTravaux: "Demarrages_travaux" };
  const rows = [{ id: 1, NomProjet: P, ID2: "1", Zone: "Z1", Taches: "T", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-15" }];
  const refs = [{ id: 1, NomProjet: P, NumeroDocument: "1", Type_document: "COFFRAGE", NomDocument: "T", Zone: "Z1", Bloquant: true, DureeLimite: "8", Recu: "" }];
  const lookup = buildReceptionSummaries(rows, refs, cols2);
  const bandDate = lookup.get(1).firstTimelineDateLimiteIso;

  const bounds = computePlanningPhaseBounds(rows, P);

  // Bounds start at the earliest PHASE (2027-02-01), not the earlier band.
  assert.equal(bounds.startDate, "2027-02-01");
  assert.ok(bandDate < bounds.startDate, "the reception band precedes bounds.start (stays out of range)");
});

test("buildReceptionSummaries: no reference rows -> empty map", () => {
  assert.equal(buildReceptionSummaries(planningRows, [], columns).size, 0);
});

test("buildReceptionSummaries: zone falls back to blank-zone references", () => {
  const referenceRows = [
    { id: 5, NomProjet: "P", NumeroDocument: "3001", Type_document: "COFFRAGE", NomDocument: "FONDATIONS - COF", Zone: "", Bloquant: true, DureeLimite: "2", Recu: "" },
  ];
  const map = buildReceptionSummaries(planningRows, referenceRows, columns);
  assert.ok(map.get(4001), "planning zone with no exact match falls back to blank-zone reference");
  assert.equal(map.get(4001).status, "missing");
});
