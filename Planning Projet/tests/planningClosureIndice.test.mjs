// Réalisation forcée d'un plan : on choisit l'indice auquel il a été réalisé parmi ceux
// diffusés dans la liste de plans (ListePlan_NDC_COF) ; la date de diffusion de cet indice
// devient sa date de réalisation (Date_Cloture). Sans indice diffusé, on ne peut pas forcer.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlanningClosureIndiceOptions,
  buildPlanningListePlanSyncUpdates,
  buildProjectRealisationTargetLookup,
  describePlanningClosureChoice,
  resolvePlanningClosureIndiceDate,
} from "../assets/js/services/planningService.js";

const PROJECT = "PROJET CLOTURE";

const planningRow = (overrides = {}) => ({
  id: 1,
  NomProjet: PROJECT,
  Service: "Structure",
  ID2: "C101",
  Taches: "Voile R+1",
  Type_doc: "COFFRAGE",
  Zone: "Z1",
  Indice: "B",
  Realise: 0,
  Date_Realise: null,
  Date_Cloture: null,
  Retards: 0,
  Diff_coffrage: "2026-11-01",
  ...overrides,
});

const diffusion = (indice, dateDiffusion, overrides = {}) => ({
  Nom_projet: PROJECT,
  Service: "Structure",
  NumeroDocument: "C101",
  Designation: "Voile R+1",
  Type_document: "COFFRAGE",
  Zone: "Z1",
  Indice: indice,
  DateDiffusion: dateDiffusion,
  ...overrides,
});

const TODAY = new Date(2026, 11, 1, 10); // mardi 01/12/26

test("indices proposés : ceux du plan diffusés, du plus bas au plus haut, avec leur date", () => {
  const options = buildPlanningClosureIndiceOptions(planningRow(), [
    diffusion("B", "2026-11-20"),
    diffusion("0", "2026-10-20"),
    diffusion("A", "2026-11-05"),
    diffusion("A", "2026-11-12", { NumeroDocument: "C999", Designation: "Autre plan" }),
  ], [], TODAY);
  assert.deepEqual(options, [
    { indice: "0", dateIso: "2026-10-20" },
    { indice: "A", dateIso: "2026-11-05" },
    { indice: "B", dateIso: "2026-11-20" },
  ]);
});

test("indices proposés : un indice diffusé deux fois garde sa première date", () => {
  const options = buildPlanningClosureIndiceOptions(planningRow(), [
    diffusion("A", "2026-11-12"),
    diffusion("A", "2026-11-05"),
  ], [], TODAY);
  assert.deepEqual(options, [{ indice: "A", dateIso: "2026-11-05" }]);
});

test("indices proposés : une ligne sans date de diffusion ou sans indice ne compte pas", () => {
  const options = buildPlanningClosureIndiceOptions(planningRow(), [
    diffusion("A", null),
    diffusion("", "2026-11-05"),
  ], [], TODAY);
  assert.deepEqual(options, []);
});

test("indices proposés : dates Grist en secondes lues au bon jour", () => {
  const seconds = Date.UTC(2026, 10, 5) / 1000;
  assert.deepEqual(
    buildPlanningClosureIndiceOptions(planningRow(), [diffusion("A", seconds)], [], TODAY),
    [{ indice: "A", dateIso: "2026-11-05" }]
  );
});

test("indices proposés : une diffusion datée dans le futur n'est pas proposée", () => {
  const rows = [diffusion("A", "2026-10-01"), diffusion("B", "2026-12-15")];
  assert.deepEqual(
    buildPlanningClosureIndiceOptions(planningRow(), rows, [], TODAY),
    [{ indice: "A", dateIso: "2026-10-01" }],
    "B saisi à l'avance : ni proposé ni présélectionné"
  );
  assert.deepEqual(
    buildPlanningClosureIndiceOptions(planningRow(), [diffusion("B", "2026-12-15")], [], TODAY),
    [],
    "seulement des diffusions futures : rien à proposer, la réalisation ne peut pas être forcée"
  );
  assert.deepEqual(
    buildPlanningClosureIndiceOptions(planningRow(), [diffusion("A", "2026-12-01")], [], TODAY),
    [{ indice: "A", dateIso: "2026-12-01" }],
    "diffusé aujourd'hui : proposé"
  );
});

const OPTIONS = [
  { indice: "0", dateIso: "2026-10-20" },
  { indice: "A", dateIso: "2026-11-05" },
  { indice: "B", dateIso: "2026-11-20" },
];

test("fenêtre : sans indice diffusé, on ne peut pas forcer", () => {
  const choice = describePlanningClosureChoice([], null);
  assert.equal(choice.canSave, false);
  assert.match(choice.emptyMessage, /Aucun indice/);
});

test("fenêtre : nouvelle réalisation forcée, l'indice le plus haut est proposé", () => {
  const choice = describePlanningClosureChoice(OPTIONS, null);
  assert.equal(choice.canSave, true);
  assert.equal(choice.selectedIndice, "B");
  assert.equal(choice.manualNote, "");
});

test("fenêtre : réalisation forcée existante, son indice est retrouvé par sa date", () => {
  const choice = describePlanningClosureChoice(OPTIONS, "2026-11-05");
  assert.equal(choice.selectedIndice, "A");
  assert.equal(choice.manualNote, "");
});

test("fenêtre : ancienne réalisation forcée saisie à la main, sa date est signalée", () => {
  const choice = describePlanningClosureChoice(OPTIONS, "2026-11-08");
  assert.equal(choice.selectedIndice, "B");
  assert.match(choice.manualNote, /08\/11\/2026/);
});

test("enregistrement : la date est celle de l'indice choisi", () => {
  assert.deepEqual(
    resolvePlanningClosureIndiceDate(OPTIONS, "a", new Date(2026, 11, 1)),
    { ok: true, indice: "A", dateIso: "2026-11-05" }
  );
});

test("enregistrement : un indice non diffusé ou daté dans le futur est refusé", () => {
  const unknown = resolvePlanningClosureIndiceDate(OPTIONS, "C", new Date(2026, 11, 1));
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /C/);
  const future = resolvePlanningClosureIndiceDate(OPTIONS, "B", new Date(2026, 10, 10));
  assert.equal(future.ok, false);
  assert.match(future.error, /20\/11\/2026/);
});

test("indice cible B dans Avancement : le retard s'arrête à la diffusion de B, pas d'un indice suivant", () => {
  const targetB = buildProjectRealisationTargetLookup([
    { projectName: PROJECT, avancementConfigRaw: JSON.stringify([{ typeDocument: "COFFRAGE", indice: "B" }]) },
  ]);
  const [update] = buildPlanningListePlanSyncUpdates(
    [planningRow({ Indice: "" })],
    [diffusion("A", "2026-11-03"), diffusion("B", "2026-11-05"), diffusion("C", "2026-11-25")],
    [],
    targetB,
    new Date(2026, 11, 1)
  );
  assert.equal(update.indice, "C");
  assert.equal(update.realise, 100);
  assert.equal(update.dateRealise, "2026-11-05");
  assert.equal(update.retards, 4, "lundi 2 au jeudi 5 novembre");
});
