import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computePlanningRealisationValue,
  isSynthesePlanningTask,
} from "../assets/js/utils/planningRealisation.js";

const projectService = await readFile(new URL("../assets/js/services/projectService.js", import.meta.url), "utf8");

// Review Focus 5 : l'Indice d'une tâche Synthese, saisi à la main, ne fait pas « 100 % réalisé ».
test("tâche Synthese : service Synthese, nom de tâche rempli, sans type de document", () => {
  assert.equal(isSynthesePlanningTask({ service: "Synthese", typeDoc: "", taskName: "PLAN" }), true);
  assert.equal(isSynthesePlanningTask({ service: " Synthèse ", typeDoc: null, taskName: "PLAN" }), true);
  assert.equal(isSynthesePlanningTask({ service: "Synthese", typeDoc: "COFFRAGE" }), false);
  assert.equal(isSynthesePlanningTask({ service: "Structure", typeDoc: "" }), false);
  // Taches vide : ce n'est pas une Tâche Synthese (spec § 9 exige Taches rempli).
  assert.equal(isSynthesePlanningTask({ service: "Synthese", typeDoc: "", taskName: "" }), false);
  assert.equal(isSynthesePlanningTask(), false);
  assert.equal(computePlanningRealisationValue("", ""), 0, "Indice ignoré : 0 %, pas 100 %");
});

test("l'avancement des tâches de planning ignore l'Indice d'une tâche Synthese", () => {
  assert.match(
    projectService,
    /isSynthesePlanningTask\(\{\s*service: row\?\.\[planningColumns\.service\],\s*typeDoc,\s*taskName: row\?\.\[planningColumns\.taskName\] \?\? row\?\.\[planningColumns\.taskNameAlt\],\s*\}\)\s*\?\s*""\s*:\s*toText\(row\?\.\[planningColumns\.indice\]\)/
  );
});
