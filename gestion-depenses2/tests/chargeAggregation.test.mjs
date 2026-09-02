import { test } from "node:test";
import assert from "node:assert/strict";
import { getSegmentEffectiveDays } from "../assets/js/utils/timeSegments.js";

test("getSegmentEffectiveDays plafonne l'effectif aux jours ouvres du mois", () => {
  // Septembre 2026 : 22 jours ouvres.
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: 8 }), 8);
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: 30 }), 22);
});

test("getSegmentEffectiveDays vaut 0 sans effectif", () => {
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: null }), 0);
  assert.equal(getSegmentEffectiveDays({ monthKey: "2026-09", effectifDays: "" }), 0);
});

test("getSegmentEffectiveDays vaut 0 sans mois resoluble", () => {
  assert.equal(getSegmentEffectiveDays({ monthKey: "", effectifDays: 8 }), 0);
});
