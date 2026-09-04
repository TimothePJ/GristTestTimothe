import test from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const {
  DURATION_DEFAULT_MODES,
  DURATION_SLOTS,
  buildDurationDefaultPlan,
  buildRawPlanningRowsById,
  collectDurationDefaultTypes,
  describeDurationDefaultStats,
  isDurationValueEmpty,
  normalizeDurationDefaultInput,
} = await import("../assets/js/services/durationDefaults.js");

const { buildTimelineDataFromPlanningRows } = await import(
  "../assets/js/services/planningService.js"
);
const { APP_CONFIG } = await import("../assets/js/config.js");
const COLUMNS = APP_CONFIG.grist.planningTable.columns;

const PROJECT = "PROJET TEST";

// Une LIGNE GRIST BRUTE, aux vrais noms de colonnes. Tout part de là : les « groups »
// sont dérivés par le vrai buildTimelineDataFromPlanningRows, jamais fabriqués à la
// main — une fixture inventée encoderait nos hypothèses au lieu de les éprouver.
function rawRow({
  id = 1,
  typeDoc = "COFFRAGE",
  zone = "Zone A",
  groupe = "",
  taches = "Voile",
  duree1 = null,
  duree2 = null,
  duree3 = null,
  dateLimite = null,
  diffCoffrage = "2026-07-15",
  diffArmature = null,
  demarrage = null,
  lignePlanning = "",
} = {}) {
  return {
    id,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: String(id).padStart(3, "0"),
    Taches: taches,
    Type_doc: typeDoc,
    Zone: zone,
    Groupe: groupe,
    Ligne_planning: lignePlanning,
    Indice: "",
    Duree_1: duree1,
    Duree_2: duree2,
    Duree_3: duree3,
    Date_limite: dateLimite,
    Diff_coffrage: diffCoffrage,
    Diff_armature: diffArmature,
    Demarrages_travaux: demarrage,
    Retards: 0,
    Realise: 0,
    Date_Realise: null,
    Date_Cloture: null,
    Remarque: "",
  };
}

// Le chemin réel du widget : lignes brutes → groups affichés + index des lignes brutes.
function scopeFor(rows) {
  const timelineData = buildTimelineDataFromPlanningRows(rows, PROJECT, "", null, null);
  return {
    groups: (timelineData.groups || []).filter((group) => group && !group.isZoneHeader),
    rawRowsById: buildRawPlanningRowsById(rows, COLUMNS),
  };
}

function settings({ slot1 = null, slot2 = null, mode = DURATION_DEFAULT_MODES.ALL } = {}) {
  return {
    [DURATION_SLOTS.DEBUT_FIN]: { weeks: slot1, mode },
    [DURATION_SLOTS.FIN_DEMARRAGE]: { weeks: slot2, mode },
  };
}

function plan(rows, settingsByTypeKey) {
  const scope = scopeFor(rows);
  return buildDurationDefaultPlan({
    groups: scope.groups,
    rawRowsById: scope.rawRowsById,
    columns: COLUMNS,
    settingsByTypeKey,
  });
}

function typesFor(rows) {
  const scope = scopeFor(rows);
  return collectDurationDefaultTypes(scope.groups, COLUMNS, scope.rawRowsById);
}

/* --------------------------- Normalisation des saisies -------------------------- */

test("une saisie de durée n'est acceptée qu'entière et positive", () => {
  assert.equal(normalizeDurationDefaultInput("3"), 3);
  assert.equal(normalizeDurationDefaultInput("3,0"), 3);
  assert.equal(normalizeDurationDefaultInput(" 0 "), 0);
  assert.equal(normalizeDurationDefaultInput("3.5"), null);
  assert.equal(normalizeDurationDefaultInput("-1"), null);
  assert.equal(normalizeDurationDefaultInput("abc"), null);
  // Une case laissée vide ne veut pas dire zéro : elle veut dire « ne rien appliquer ».
  assert.equal(normalizeDurationDefaultInput(""), null);
  assert.equal(normalizeDurationDefaultInput(null), null);
});

test("zéro représente une durée non renseignée dans Planning_Projet", () => {
  assert.equal(isDurationValueEmpty(0), true);
  assert.equal(isDurationValueEmpty("0"), true);
  assert.equal(isDurationValueEmpty("0,0"), true);
  assert.equal(isDurationValueEmpty(null), true);
  assert.equal(isDurationValueEmpty(""), true);
  assert.equal(isDurationValueEmpty("   "), true);
  assert.equal(isDurationValueEmpty(4), false);
});

/* ---------------- Le contrat qui avait été présumé au lieu d'être vérifié -------- */

// `group.meta` est la ligne NORMALISÉE (clés camelCase, dates dérivées en objets Date),
// pas la ligne Grist. Lire la vacuité dedans faisait répondre « vide » partout, et le
// mode « Seulement les vides » écrasait tout. Ce test fige la forme réelle.
test("group.meta n'est pas la ligne Grist : les valeurs stockées viennent des lignes brutes", () => {
  const rows = [rawRow({ id: 11, typeDoc: "NDC", duree1: 4, demarrage: "2026-08-12" })];
  const { groups, rawRowsById } = scopeFor(rows);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].meta.Duree_1, undefined, "meta n'est pas indexé en noms Grist");
  assert.equal(groups[0].meta.duree1, 4, "meta est indexé en camelCase");
  assert.equal(rawRowsById.get(11).Duree_1, 4, "la ligne brute porte la valeur stockée");
});

test("le mode « Seulement les vides » remplit les valeurs nulles ou à zéro", () => {
  const rows = [
    rawRow({ id: 1, typeDoc: "NDC", duree1: null, demarrage: "2026-08-12" }),
    rawRow({ id: 2, typeDoc: "NDC", duree1: 0, demarrage: "2026-08-12" }),
    rawRow({ id: 3, typeDoc: "NDC", duree1: 4, demarrage: "2026-08-12" }),
  ];
  const { updates, stats } = plan(rows, {
    NDC: settings({ slot1: 9, mode: DURATION_DEFAULT_MODES.EMPTY_ONLY }),
  });

  assert.deepEqual(updates.map((update) => update.id).sort((a, b) => a - b), [1, 2]);
  assert.equal(stats.skippedAlreadyFilled, 1, "seule la durée 4 est déjà renseignée");
});

test("le formulaire annonce le vrai décompte vides / renseignées", () => {
  const [ndc] = typesFor([
    rawRow({ id: 1, typeDoc: "NDC", duree1: 4, demarrage: "2026-08-12" }),
    rawRow({ id: 2, typeDoc: "NDC", duree1: null, demarrage: "2026-08-12" }),
    rawRow({ id: 3, typeDoc: "NDC", duree1: 0, demarrage: "2026-08-12" }),
  ]);

  assert.equal(ndc.rowCount, 3);
  assert.equal(ndc.slots[DURATION_SLOTS.DEBUT_FIN].filledCount, 1);
  assert.equal(ndc.slots[DURATION_SLOTS.DEBUT_FIN].emptyCount, 2);
});

// Sans Type_doc lisible, buildPlanningDurationUpdateFields ne rentrait dans aucune
// branche : seules la durée et sa date de gauche étaient écrites, jamais les dates
// dérivées, et References2 se resynchronisait sur une date périmée.
test("la cascade des dates dérivées s'exécute bien dans le lot groupé", () => {
  const rows = [rawRow({ id: 6, typeDoc: "NDC", demarrage: "2026-08-12", diffCoffrage: "2026-07-15" })];
  const { updates } = plan(rows, { NDC: settings({ slot1: 2, slot2: 3 }) });

  assert.equal(updates.length, 1);
  const { fields } = updates[0];
  // Duree_3 = 3 → Diff_coffrage = 2026-08-12 − 3 sem. = 2026-07-22
  assert.equal(fields.Duree_3, 3);
  assert.equal(fields.Diff_coffrage, "2026-07-22");
  // Duree_1 = 2 → Date_limite calculée sur la NOUVELLE ancre : 2026-07-22 − 2 sem.
  assert.equal(fields.Duree_1, 2);
  assert.equal(fields.Date_limite, "2026-07-08");
});

/* --------------------------- Colonnes cibles par type --------------------------- */

test("ARMATURES écrit Duree_2 pour le premier créneau, jamais Duree_1", () => {
  const rows = [
    rawRow({
      id: 9,
      typeDoc: "ARMATURES",
      zone: "Zone A",
      groupe: "1",
      diffCoffrage: "2026-07-15",
      diffArmature: "2026-08-05",
      demarrage: "2026-09-02",
    }),
  ];
  const { updates } = plan(rows, { ARMATURES: settings({ slot1: 3 }) });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].fields.Duree_2, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(updates[0].fields, "Duree_1"), false);
  // Ancre Diff_armature 2026-08-05 moins 3 semaines.
  assert.equal(updates[0].fields.Diff_coffrage, "2026-07-15");
});

test("COFFRAGE non lié au planning n'a pas de second créneau", () => {
  const [coffrage] = typesFor([rawRow({ id: 4, typeDoc: "COFFRAGE", demarrage: "2026-08-12" })]);

  assert.equal(coffrage.slots[DURATION_SLOTS.DEBUT_FIN].supported, true);
  assert.equal(coffrage.slots[DURATION_SLOTS.FIN_DEMARRAGE].supported, false);
});

test("COFFRAGE écrit Duree_1 et déplace Date_limite", () => {
  const rows = [rawRow({ id: 4, typeDoc: "COFFRAGE", diffCoffrage: "2026-07-15" })];
  const { updates } = plan(rows, { COFFRAGE: settings({ slot1: 2 }) });

  assert.equal(updates[0].fields.Duree_1, 2);
  assert.equal(updates[0].fields.Date_limite, "2026-07-01");
});

// L'ancre affichée d'un COFFRAGE de groupe est le minimum des Diff_coffrage de ses
// ARMATURES, valeur qui n'existe pas telle quelle en base. Écrire la date limite depuis
// le Diff_coffrage stocké donnerait une date différente de celle prévisualisée.
test("un COFFRAGE de groupe est daté sur l'ancre affichée, pas sur sa valeur stockée", () => {
  const rows = [
    rawRow({
      id: 20,
      typeDoc: "ARMATURES",
      zone: "Zone A",
      groupe: "1",
      diffCoffrage: "2026-06-10",
      diffArmature: "2026-07-01",
      demarrage: "2026-08-01",
    }),
    rawRow({
      id: 21,
      typeDoc: "COFFRAGE",
      zone: "Zone A",
      groupe: "1",
      diffCoffrage: "2026-09-30",
      demarrage: "2026-08-01",
    }),
  ];
  const { updates } = plan(rows, { COFFRAGE: settings({ slot1: 2 }) });

  const coffrageUpdate = updates.find((update) => update.id === 21);
  assert.ok(coffrageUpdate, "la ligne COFFRAGE doit être planifiée");
  // Ancre de groupe 2026-06-10 (et non 2026-09-30) moins 2 semaines.
  assert.equal(coffrageUpdate.fields.Date_limite, "2026-05-27");
  assert.equal(coffrageUpdate.fields.Diff_coffrage, "2026-06-10");
});

test("un COFFRAGE à zéro reçoit la durée par défaut depuis l'ancre de ses ARMATURES", () => {
  const rows = [
    rawRow({
      id: 30,
      typeDoc: "ARMATURES",
      zone: "Zone A",
      groupe: "17",
      diffCoffrage: "2026-10-29",
      diffArmature: "2026-11-26",
    }),
    rawRow({
      id: 31,
      typeDoc: "COFFRAGE",
      zone: "Zone A",
      groupe: "17",
      duree1: 0,
      dateLimite: "2026-10-29",
      diffCoffrage: null,
    }),
  ];

  const { updates } = plan(rows, {
    COFFRAGE: settings({ slot1: 4, mode: DURATION_DEFAULT_MODES.EMPTY_ONLY }),
  });
  const coffrageUpdate = updates.find((update) => update.id === 31);

  assert.ok(coffrageUpdate, "le COFFRAGE à zéro doit être planifié");
  assert.equal(coffrageUpdate.fields.Duree_1, 4);
  assert.equal(coffrageUpdate.fields.Diff_coffrage, "2026-10-29");
  assert.equal(coffrageUpdate.fields.Date_limite, "2026-10-01");
});

/* ------------------------------- Choix des lignes ------------------------------- */

test("une ligne sans date d'ancrage est ignorée et signalée", () => {
  const rows = [rawRow({ id: 1, typeDoc: "NDC", diffCoffrage: null, demarrage: null })];
  const { updates, stats } = plan(rows, { NDC: settings({ slot1: 4 }) });

  assert.deepEqual(updates, []);
  assert.ok(stats.skippedNoAnchor >= 1);
});

test("un type absent du formulaire n'est jamais touché", () => {
  const rows = [rawRow({ id: 1, typeDoc: "COUPES" })];
  const { updates } = plan(rows, { COFFRAGE: settings({ slot1: 4 }) });
  assert.deepEqual(updates, []);
});

test("une valeur non saisie pour un créneau ne l'applique pas, et n'écrit pas zéro", () => {
  const rows = [rawRow({ id: 1, typeDoc: "NDC", duree1: 7, demarrage: "2026-08-12" })];
  const { updates } = plan(rows, { NDC: settings({ slot1: null, slot2: null }) });
  assert.deepEqual(updates, []);
});

test("sans ligne brute correspondante, rien n'est écrit à l'aveugle", () => {
  const rows = [rawRow({ id: 1, typeDoc: "NDC", demarrage: "2026-08-12" })];
  const scope = scopeFor(rows);
  const { updates, stats } = buildDurationDefaultPlan({
    groups: scope.groups,
    rawRowsById: new Map(),
    columns: COLUMNS,
    settingsByTypeKey: { NDC: settings({ slot1: 4 }) },
  });

  assert.deepEqual(updates, []);
  assert.equal(stats.skippedNoRow, 1);
});

/* --------------------------------- Idempotence ---------------------------------- */

test("réappliquer la même valeur ne produit aucune écriture", () => {
  const rows = [
    rawRow({ id: 5, typeDoc: "COFFRAGE", duree1: 2, dateLimite: "2026-07-01", diffCoffrage: "2026-07-15" }),
  ];
  const { updates, stats } = plan(rows, { COFFRAGE: settings({ slot1: 2 }) });

  assert.deepEqual(updates, []);
  assert.equal(stats.skippedNoChange, 1);
});

test("une date stockée en secondes est reconnue comme identique à son ISO", () => {
  const secondsFor20260701 = Math.floor(Date.UTC(2026, 6, 1) / 1000);
  const rows = [
    rawRow({ id: 5, typeDoc: "COFFRAGE", duree1: 2, dateLimite: secondsFor20260701, diffCoffrage: "2026-07-15" }),
  ];
  const { updates } = plan(rows, { COFFRAGE: settings({ slot1: 2 }) });

  assert.deepEqual(updates, []);
});

/* ------------------------- Forme du lot et compte rendu ------------------------- */

test("les deux créneaux d'une même ligne tiennent dans une seule écriture", () => {
  const rows = [rawRow({ id: 7, typeDoc: "NDC", demarrage: "2026-08-12" })];
  const { updates } = plan(rows, { NDC: settings({ slot1: 1, slot2: 1 }) });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 7);
});

test("aucun champ de contexte n'est écrit : le relais partagé s'en charge", () => {
  const rows = [rawRow({ id: 1, typeDoc: "NDC", demarrage: "2026-08-12" })];
  const { updates } = plan(rows, { NDC: settings({ slot1: 4 }) });
  const fieldNames = Object.keys(updates[0].fields);

  assert.equal(fieldNames.includes("Service"), false);
  assert.equal(fieldNames.includes("NomProjet"), false);
});

test("le compte rendu énonce ce qui a été fait et ce qui a été laissé", () => {
  assert.equal(
    describeDurationDefaultStats({ rowsTouched: 3, valuesApplied: 5, skippedAlreadyFilled: 2 }),
    "5 durées sur 3 lignes · 2 déjà renseignées"
  );
  assert.equal(
    describeDurationDefaultStats({ rowsTouched: 0, valuesApplied: 0, skippedNoAnchor: 4 }),
    "aucune ligne à modifier · 4 sans date de référence"
  );
});
