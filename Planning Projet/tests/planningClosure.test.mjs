import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlanningDocumentIdentity,
  computePlanningRealisationValue,
  findBestPlanningDocumentMatches,
  formatPlanningCalendarDateIso,
  hasValidPlanningClosureDate,
  isPlanningDocumentAdvanced,
  isPlanningIndiceAtLeast,
} from "../../gestion-depenses2/assets/js/utils/planningRealisation.js";
import {
  buildPlanningListePlanSyncUpdates,
  buildPlanningRealiseUpdates,
  buildProjectRealisationTargetLookup,
  buildTimelineDataFromPlanningRows,
  computePlanningRetardValue,
} from "../assets/js/services/planningService.js";

const PROJECT = "PROJET TEST";
const TARGET_C = buildProjectRealisationTargetLookup([
  {
    projectName: PROJECT,
    avancementConfigRaw: JSON.stringify([
      { typeDocument: "COFFRAGE", indice: "C" },
    ]),
  },
]);

function planningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: "P-001",
    Taches: "Fondations",
    Type_doc: "COFFRAGE",
    Zone: "Zone A",
    Indice: "B",
    Realise: 75,
    Date_Realise: null,
    Date_Cloture: null,
    Retards: 0,
    Date_limite: "2026-07-01",
    Diff_coffrage: "2026-07-10",
    ...overrides,
  };
}

function listePlanRow(overrides = {}) {
  return {
    id: 10,
    Nom_projet: PROJECT,
    Service: "Structure",
    NumeroDocument: "P-001",
    Designation: "Fondations",
    Type_document: "COFFRAGE",
    Zone: "Zone A",
    Indice: "B",
    DateDiffusion: "2026-07-08",
    ...overrides,
  };
}

test("reconnaît les dates calendaires supportées sans décalage UTC", () => {
  const values = [
    "2026-07-15",
    "2026-07-15T23:30:00-10:00",
    "15/07/2026",
    new Date(2026, 6, 15, 18, 30),
    Date.UTC(2026, 6, 15),
    Date.UTC(2026, 6, 15) / 1000,
  ];

  values.forEach((value) => {
    assert.equal(hasValidPlanningClosureDate(value), true);
    assert.equal(formatPlanningCalendarDateIso(value), "2026-07-15");
  });
  [null, "", "demain", "2026-02-30", Number.NaN].forEach((value) => {
    assert.equal(hasValidPlanningClosureDate(value), false);
  });
});

test("Date_Cloture a priorité sur les indices et la suppression restaure le calcul >=", () => {
  assert.equal(computePlanningRealisationValue("COFFRAGE", "B", "C"), 75);
  assert.equal(computePlanningRealisationValue("COFFRAGE", "B", "C", "2026-07-15"), 100);
  assert.equal(computePlanningRealisationValue("COFFRAGE", "B", "C", null), 75);
  assert.equal(isPlanningDocumentAdvanced({
    dateCloture: "2026-07-15",
    indice: "B",
    targetIndice: "C",
  }), true);
  assert.equal(isPlanningDocumentAdvanced({
    dateCloture: null,
    indice: "B",
    targetIndice: "C",
  }), false);
  assert.equal(isPlanningDocumentAdvanced({
    dateCloture: null,
    indice: "D",
    targetIndice: "C",
  }), true);
  assert.equal(isPlanningIndiceAtLeast("B", "B"), true);
  assert.equal(isPlanningIndiceAtLeast("C", "B"), true);
  assert.equal(isPlanningIndiceAtLeast("A", "B"), false);
});

test("le recalcul direct force Realise et Date_Realise, puis vide la date si incomplet", () => {
  const forced = buildPlanningRealiseUpdates([
    planningRow({ Date_Cloture: "2026-07-15" }),
  ], TARGET_C);
  assert.deepEqual(forced, [{ id: 1, realise: 100, dateRealise: "2026-07-15" }]);

  const reopened = buildPlanningRealiseUpdates([
    planningRow({ Realise: 100, Date_Realise: "2026-07-15", Date_Cloture: null }),
  ], TARGET_C);
  assert.deepEqual(reopened, [{ id: 1, realise: 75, dateRealise: null }]);
});

test("la synchro ListePlan respecte la clôture et restaure la date naturelle après suppression", () => {
  const forced = buildPlanningListePlanSyncUpdates(
    [planningRow({ Date_Cloture: "2026-07-15" })],
    [listePlanRow()],
    [],
    TARGET_C,
    new Date(2026, 6, 20)
  );
  assert.equal(forced[0].realise, 100);
  assert.equal(forced[0].dateRealise, "2026-07-15");

  const reopened = buildPlanningListePlanSyncUpdates(
    [planningRow({ Realise: 100, Date_Realise: "2026-07-15", Date_Cloture: null })],
    [listePlanRow()],
    [],
    TARGET_C,
    new Date(2026, 6, 20)
  );
  assert.equal(reopened[0].realise, 75);
  assert.equal(reopened[0].dateRealise, null);

  const naturallyComplete = buildPlanningListePlanSyncUpdates(
    [planningRow({ Realise: 100, Date_Realise: "2026-07-15", Date_Cloture: null })],
    [listePlanRow({ Indice: "D", DateDiffusion: "2026-07-12" })],
    [],
    TARGET_C,
    new Date(2026, 6, 20)
  );
  assert.equal(naturallyComplete[0].realise ?? 100, 100);
  assert.equal(naturallyComplete[0].dateRealise, "2026-07-12");
});

test("le retard d'une clôture est calculé à Date_Cloture puis reste figé", () => {
  const base = {
    typeDoc: "COFFRAGE",
    indice: "B",
    targetIndice: "C",
    currentRetard: 99,
    lignePlanningRaw: "",
    diffCoffrageRaw: "2026-07-10",
    diffArmatureRaw: null,
    demarrageRaw: null,
    duree3Raw: null,
    dateRealiseRaw: null,
  };
  assert.equal(
    computePlanningRetardValue({ ...base, dateClotureRaw: "2026-07-15" }, new Date(2030, 0, 1)),
    5
  );
  assert.equal(
    computePlanningRetardValue({ ...base, dateClotureRaw: "2026-07-05" }, new Date(2030, 0, 1)),
    0
  );
});

test("l'identité stricte et le fallback empêchent les collisions projet/zone/service", () => {
  const candidates = [
    { id: 1, identity: buildPlanningDocumentIdentity({ project: "P1", service: "S1", documentNumber: "42", typeDocument: "COFFRAGE", zone: "A", designation: "Mur" }) },
    { id: 2, identity: buildPlanningDocumentIdentity({ project: "P1", service: "S2", documentNumber: "42", typeDocument: "COFFRAGE", zone: "B", designation: "Mur" }) },
    { id: 3, identity: buildPlanningDocumentIdentity({ project: "P2", service: "S1", documentNumber: "42", typeDocument: "COFFRAGE", zone: "A", designation: "Mur" }) },
  ];
  const exact = findBestPlanningDocumentMatches(
    { project: "P1", service: "S2", documentNumber: "42", typeDocument: "COFFRAGE", zone: "B", designation: "Mur" },
    candidates,
    (candidate) => candidate.identity
  );
  assert.deepEqual(exact.map(({ id }) => id), [2]);

  const ambiguous = findBestPlanningDocumentMatches(
    { project: "P1", documentNumber: "42", typeDocument: "COFFRAGE", designation: "Mur" },
    candidates,
    (candidate) => candidate.identity
  );
  assert.deepEqual(ambiguous, []);
});

test("la timeline expose la clôture et fonctionne si la colonne est absente", () => {
  const forcedData = buildTimelineDataFromPlanningRows([
    planningRow({ Date_Cloture: "2026-07-15" }),
  ], PROJECT, "", TARGET_C, null);
  const forcedGroup = forcedData.groups.find((group) => !group.isZoneHeader);
  assert.equal(forcedGroup.realiseLabel, "100");
  assert.equal(forcedGroup.dateClotureIso, "2026-07-15");
  assert.equal(forcedGroup.dateClotureColumnAvailable, true);

  const rowWithoutColumn = planningRow();
  delete rowWithoutColumn.Date_Cloture;
  const normalData = buildTimelineDataFromPlanningRows(
    [rowWithoutColumn], PROJECT, "", TARGET_C, null
  );
  const normalGroup = normalData.groups.find((group) => !group.isZoneHeader);
  assert.equal(normalGroup.realiseLabel, "75");
  assert.equal(normalGroup.dateClotureColumnAvailable, false);
});
