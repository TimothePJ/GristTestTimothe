// Date de réalisation d'un document : la première diffusion qui atteint l'indice cible.
// Une diffusion ultérieure d'un indice supérieur ne la déplace pas (sinon son retard
// grimpait à chaque nouvel indice).
import { test } from "node:test";
import assert from "node:assert/strict";

import * as planningRealisation from "../assets/js/utils/planningRealisation.js";

const { buildPlanningIndiceProgress, selectPlanningRealisationRecord } = planningRealisation;

const record = (indice, iso) => ({ indice, dateDiffusion: iso, dateSortValue: new Date(`${iso}T00:00:00`).getTime() });

test("réalisation : première diffusion atteignant l'indice cible, pas la dernière", () => {
  const records = [record("0", "2026-10-20"), record("A", "2026-11-05"), record("B", "2026-11-25")];
  assert.equal(selectPlanningRealisationRecord(records, "A").dateDiffusion, "2026-11-05");
  const progress = buildPlanningIndiceProgress(records, "A");
  assert.equal(progress.latestIndice, "B", "l'indice affiché reste le plus haut");
  assert.equal(progress.targetReached, true);
  assert.equal(progress.realisationRecord.dateDiffusion, "2026-11-05");
});

test("réalisation : un indice cible rediffusé garde sa première date", () => {
  const records = [record("A", "2026-11-12"), record("A", "2026-11-05")];
  assert.equal(selectPlanningRealisationRecord(records, "A").dateDiffusion, "2026-11-05");
});

test("réalisation : aucune quand l'indice cible n'est pas atteint", () => {
  const records = [record("0", "2026-10-20")];
  assert.equal(selectPlanningRealisationRecord(records, "A"), null);
  assert.equal(buildPlanningIndiceProgress(records, "A").realisationRecord, null);
  assert.equal(buildPlanningIndiceProgress([], "A").realisationRecord, null);
});

test("réalisation : sans indice cible, la première diffusion datée réalise le document", () => {
  const records = [record("B", "2026-11-25"), record("0", "2026-10-20")];
  assert.equal(selectPlanningRealisationRecord(records, "").dateDiffusion, "2026-10-20");
});

test("le module de réalisation expose aussi le calcul du retard (chargé tel quel par ListeDePlan)", () => {
  assert.equal(typeof planningRealisation.computePlanningRetardDays, "function");
  assert.equal(typeof planningRealisation.countPlanningLateWorkingDays, "function");
});
