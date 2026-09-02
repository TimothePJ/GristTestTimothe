import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTimeSegmentBounds } from "../assets/js/top/bounds.js";

const cols = { mois: "Mois", startDate: "Start_At" };

// Un segment = un mois : les bornes couvrent desormais le MOIS ENTIER du plus
// petit au plus grand monthKey resolu (pas les timestamps exacts). Dates ISO
// (non ambigues) pour le repli Start_At : monthSegments.js ne sait pas lire
// un datetime FR "JJ/MM/AAAA".
test("bounds couvrent le mois complet du premier au dernier Start_At (repli legacy)", () => {
  const rows = [
    { Start_At: "2026-04-06" },
    { Start_At: "2026-06-01" },
  ];
  const b = computeTimeSegmentBounds(rows, cols);
  assert.equal(b.startDate, "2026-04-01");
  assert.equal(b.endDate, "2026-06-30");
});

test("no rows => null", () => {
  assert.equal(computeTimeSegmentBounds([], cols), null);
});

test("computeTimeSegmentBounds couvre les mois presents", () => {
  const bounds = computeTimeSegmentBounds(
    [{ Mois: "2026-09-01" }, { Mois: "2026-11-01" }],
    { mois: "Mois", startDate: "Start_At" }
  );
  assert.equal(bounds.startDate, "2026-09-01");
  assert.equal(bounds.endDate, "2026-11-30");
});

// La branche ISO de getMonthKeyFromRawMonth (/^(\d{4})-(\d{2})/) ne valide PAS
// l'intervalle du mois (contrairement a la branche "MM/YYYY", qui teste 1..12) :
// un monthKey syntaxiquement valide mais semantiquement faux ("2026-13") est
// donc possible en sortie de resolveSegmentMonthKey. getMonthBounds renvoie
// null pour un tel monthKey : computeTimeSegmentBounds doit degrader vers
// null, pas planter en dereferencant .startAt/.endAt sur null.
test("computeTimeSegmentBounds renvoie null pour un monthKey syntaxiquement valide mais semantiquement faux", () => {
  assert.equal(computeTimeSegmentBounds([{ Mois: "2026-13-01" }], cols), null);
});
