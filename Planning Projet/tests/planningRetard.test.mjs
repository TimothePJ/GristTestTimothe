// Retard des documents Structure dans Planning Projet : jours ouvrés (week-ends et jours
// fériés exclus), date de réalisation = première diffusion atteignant l'indice cible,
// et la frise montre le retard calculé, pas une valeur enregistrée périmée.
import test from "node:test";
import assert from "node:assert/strict";

import { countPlanningLateWorkingDays } from "../../gestion-depenses2/assets/js/utils/planningRetard.js";
import {
  buildPlanningListePlanSyncUpdates,
  buildPlanningRetardUpdates,
  buildProjectRealisationTargetLookup,
  buildTimelineDataFromPlanningRows,
  computePlanningRetardValue,
} from "../assets/js/services/planningService.js";

const PROJECT = "PROJET RETARD";
const TARGET_A = buildProjectRealisationTargetLookup([
  { projectName: PROJECT, avancementConfigRaw: JSON.stringify([{ typeDocument: "COFFRAGE", indice: "A" }]) },
]);

function planningRow(overrides = {}) {
  return {
    id: 1,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: "C101",
    Taches: "Voile R+1",
    Type_doc: "COFFRAGE",
    Zone: "Z1",
    Indice: "",
    Realise: 0,
    Date_Realise: null,
    Date_Cloture: null,
    Retards: 0,
    Date_limite: "2026-10-01",
    Diff_coffrage: "2026-11-01",
    ...overrides,
  };
}

const listePlanRow = (indice, dateDiffusion) => ({
  Nom_projet: PROJECT,
  Service: "Structure",
  NumeroDocument: "C101",
  Designation: "Voile R+1",
  Type_document: "COFFRAGE",
  Zone: "Z1",
  Indice: indice,
  DateDiffusion: dateDiffusion,
});

const notRealised = { typeDoc: "NDC", indice: "", targetIndice: "0", currentRetard: 0 };

test("retard en jours ouvrés : échéance dimanche 01/11 (férié), aujourd'hui mardi 10/11 → 7", () => {
  assert.equal(
    computePlanningRetardValue({ ...notRealised, diffCoffrageRaw: "2026-11-01" }, new Date(2026, 10, 10, 15)),
    7
  );
});

test("retard : le passage à l'heure d'été ne fait plus perdre un jour", () => {
  assert.equal(
    computePlanningRetardValue({ ...notRealised, diffCoffrageRaw: "2026-03-20" }, new Date(2026, 3, 1, 10)),
    8
  );
});

test("retard : une échéance reçue en secondes Grist sous forme de texte est lue", () => {
  const seconds = String(Date.UTC(2026, 10, 1) / 1000);
  assert.equal(
    computePlanningRetardValue({ ...notRealised, diffCoffrageRaw: seconds }, new Date(2026, 10, 10, 15)),
    7
  );
});

test("synchro ListePlan : un indice rediffusé après la réalisation ne déplace ni Date_Realise ni le retard", () => {
  const updates = buildPlanningListePlanSyncUpdates(
    [planningRow()],
    [listePlanRow("0", "2026-10-20"), listePlanRow("A", "2026-11-05"), listePlanRow("B", "2026-11-25")],
    [],
    TARGET_A,
    new Date(2026, 11, 1)
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].indice, "B");
  assert.equal(updates[0].realise, 100);
  assert.equal(updates[0].dateRealise, "2026-11-05");
  assert.equal(updates[0].retards, 4, "lundi 2 au jeudi 5 novembre");
});

test("recalcul des retards : un document réalisé compte les jours ouvrés jusqu'à Date_Realise", () => {
  // Du dimanche 01/11 au lundi 09/11 : 8 jours calendaires, 6 jours ouvrés.
  const updates = buildPlanningRetardUpdates(
    [planningRow({ Indice: "A", Realise: 100, Date_Realise: "2026-11-09", Retards: 8 })],
    new Date(2027, 0, 1),
    TARGET_A
  );
  assert.deepEqual(updates, [{ id: 1, retards: 6 }]);
});

const secondsText = (year, month, date) => String(Date.UTC(year, month - 1, date) / 1000);

test("frise : des dates en secondes Grist sous forme de texte donnent la même Fin que l'échéance du retard", () => {
  const linked = planningRow({
    Ligne_planning: "4",
    Demarrages_travaux: secondsText(2026, 10, 13),
    Duree_3: 3,
    Diff_coffrage: "2026-10-30",
  });
  const plain = planningRow({ id: 2, ID2: "C102", Taches: "Voile R+2", Diff_coffrage: secondsText(2026, 11, 1) });
  const data = buildTimelineDataFromPlanningRows([linked, plain], PROJECT, "", TARGET_A, null);
  const byId = new Map(data.groups.filter((group) => !group.isZoneHeader).map((group) => [Number(group.rowId), group]));

  assert.equal(byId.get(1).finIso, "2026-09-22", "démarrage 13/10 moins 3 semaines");
  assert.equal(byId.get(1).retardsLabel, String(countPlanningLateWorkingDays("2026-09-22", new Date())));
  assert.equal(byId.get(2).finIso, "2026-11-01");
});

test("synchro ListePlan : une diffusion datée en secondes texte compte, comme dans ListeDePlan", () => {
  const updates = buildPlanningListePlanSyncUpdates(
    [planningRow()],
    [listePlanRow("A", secondsText(2026, 11, 5))],
    [],
    TARGET_A,
    new Date(2026, 11, 1)
  );
  assert.equal(updates[0].indice, "A");
  assert.equal(updates[0].dateRealise, "2026-11-05");
  assert.equal(updates[0].retards, 4);
});

test("frise : la colonne Retards montre le retard calculé, pas la valeur enregistrée", () => {
  const realised = planningRow({ Indice: "A", Realise: 100, Date_Realise: "2026-11-05", Retards: 99 });
  const late = planningRow({ id: 2, ID2: "C102", Taches: "Voile R+2", Diff_coffrage: "2020-01-06", Retards: 0 });
  const data = buildTimelineDataFromPlanningRows([realised, late], PROJECT, "", TARGET_A, null);
  const groups = data.groups.filter((group) => !group.isZoneHeader);
  const byId = new Map(groups.map((group) => [Number(group.rowId), group]));

  assert.equal(byId.get(1).retardsLabel, "4");
  assert.equal(byId.get(2).retardsLabel, String(countPlanningLateWorkingDays("2020-01-06", new Date())));
  assert.notEqual(byId.get(2).retardsLabel, "0");
});
