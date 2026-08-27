import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveClickedMonthKey,
  resolveSegmentClickIntent,
  toEditableSegmentId,
} from "../assets/js/bottom/chargeEditing.js";

// Fixture a la forme de getVisibleSlots() : deux creneaux demi-journee (am/pm)
// par date, poses de gauche a droite a largeur constante — meme forme que la
// sortie de buildVisibleSlots() de bottom/chargeBoard.js
// ({ slotIndex, leftPx, widthPx, startAt, endAt, isWorkingDay }).
const HALF_DAY_WIDTH_PX = 40;

function makeSlots(days) {
  const slots = [];
  days.forEach(({ year, month, day, isWorkingDay = true }) => {
    ["am", "pm"].forEach((part) => {
      const startHour = part === "am" ? 8 : 13;
      const endHour = part === "am" ? 12 : 17;
      slots.push({
        slotIndex: slots.length,
        leftPx: slots.length * HALF_DAY_WIDTH_PX,
        widthPx: HALF_DAY_WIDTH_PX,
        isWorkingDay,
        startAt: new Date(year, month - 1, day, startHour, 0, 0, 0),
        endAt: new Date(year, month - 1, day, endHour, 0, 0, 0),
      });
    });
  });
  return slots;
}

// --- resolveClickedMonthKey ---------------------------------------------------

test("resolveClickedMonthKey rend le mois du creneau sous le curseur", () => {
  const slots = makeSlots([
    { year: 2026, month: 1, day: 30 },
    { year: 2026, month: 1, day: 31 },
    { year: 2026, month: 2, day: 1 },
  ]);

  assert.equal(resolveClickedMonthKey(slots, 0), "2026-01");
  assert.equal(resolveClickedMonthKey(slots, 3), "2026-01");
  assert.equal(resolveClickedMonthKey(slots, 4), "2026-02");
  assert.equal(resolveClickedMonthKey(slots, 5), "2026-02");
});

test("resolveClickedMonthKey tolere un index texte et refuse un index absent", () => {
  const slots = makeSlots([{ year: 2026, month: 5, day: 4 }]);

  assert.equal(resolveClickedMonthKey(slots, "1"), "2026-05");
  assert.equal(resolveClickedMonthKey(slots, 99), "");
  assert.equal(resolveClickedMonthKey(slots, -1), "");
  assert.equal(resolveClickedMonthKey([], 0), "");
  assert.equal(resolveClickedMonthKey(null, 0), "");
});

// --- resolveSegmentClickIntent ------------------------------------------------

test("clic dans le vide d'un mois libre -> creation", () => {
  assert.deepEqual(resolveSegmentClickIntent({ monthKey: "2026-03" }), {
    action: "create",
    monthKey: "2026-03",
  });
});

test("clic dans le vide d'un mois deja occupe -> edition de sa barre", () => {
  assert.deepEqual(
    resolveSegmentClickIntent({ monthKey: "2026-03", monthSegmentId: "42" }),
    { action: "edit", segmentId: 42 }
  );
});

// Le piege des barres empilees : deux segments legacy sur le meme mois sont mis
// en lanes 0 et 1 par assignSegmentLanes, et querySelector rend le premier noeud
// du DOM. La barre reellement sous le curseur doit primer, sinon cliquer celle
// du dessous editerait celle du dessus.
test("la barre sous le curseur prime sur la premiere barre du mois", () => {
  assert.deepEqual(
    resolveSegmentClickIntent({
      monthKey: "2026-03",
      clickedSegmentId: "7",
      monthSegmentId: "42",
    }),
    { action: "edit", segmentId: 7 }
  );
});

test("mois non resolu -> on ignore le clic", () => {
  assert.deepEqual(resolveSegmentClickIntent({ monthKey: "" }), { action: "ignore" });
  assert.deepEqual(resolveSegmentClickIntent({}), { action: "ignore" });
  assert.deepEqual(resolveSegmentClickIntent(), { action: "ignore" });
});

test("id de synthese (colonne id absente) : ni edition ni doublon", () => {
  // Barre cliquee sans id Grist exploitable : rien, on ne devine pas la ligne.
  assert.deepEqual(
    resolveSegmentClickIntent({ monthKey: "2026-03", clickedSegmentId: "s-0" }),
    { action: "ignore" }
  );
  // Clic dans le vide, mais le mois EST occupe par une telle barre : creer
  // violerait la cle unique (projet, personne, mois).
  assert.deepEqual(
    resolveSegmentClickIntent({ monthKey: "2026-03", monthSegmentId: "s-0" }),
    { action: "ignore" }
  );
});

// Ce filtre garde TOUS les chemins d'ecriture : le clic gauche via
// resolveSegmentClickIntent, mais aussi Modifier ET Supprimer du menu contextuel.
test("toEditableSegmentId ne laisse passer que de vrais ids de ligne Grist", () => {
  assert.equal(toEditableSegmentId("77"), 77);
  assert.equal(toEditableSegmentId(77), 77);

  // Id de synthese de chargeBoard quand la colonne id manque.
  assert.equal(toEditableSegmentId("s-0"), null);
  assert.equal(toEditableSegmentId("s-12"), null);
  // Valeurs que toReferenceId rejetterait de toute facon.
  assert.equal(toEditableSegmentId("0"), null);
  assert.equal(toEditableSegmentId(0), null);
  assert.equal(toEditableSegmentId(-3), null);
  assert.equal(toEditableSegmentId("12.5"), null);
  assert.equal(toEditableSegmentId(""), null);
  assert.equal(toEditableSegmentId(null), null);
  assert.equal(toEditableSegmentId(undefined), null);
});

test("id vide ou nul traite comme absent", () => {
  assert.deepEqual(
    resolveSegmentClickIntent({ monthKey: "2026-03", clickedSegmentId: "", monthSegmentId: "" }),
    { action: "create", monthKey: "2026-03" }
  );
  assert.deepEqual(
    resolveSegmentClickIntent({ monthKey: "2026-03", monthSegmentId: "0" }),
    { action: "ignore" }
  );
});
