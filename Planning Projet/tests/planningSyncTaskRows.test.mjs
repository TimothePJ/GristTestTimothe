import test from "node:test";
import assert from "node:assert/strict";

import { getProjectPlanningRows } from "../assets/js/services/planningSyncCoordinator.js";

// Le recalcul (Realise, Retards, dates) ne concerne que les documents : il écraserait
// l'avancement saisi à la main sur une tâche Synthese.
test("le recalcul automatique ignore les tâches Synthese et les segments v1", () => {
  const rows = [
    { id: 1, NomProjet: "P", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001" },
    { id: 2, NomProjet: "P", Taches: "", Type_doc: "", ID2: "", Zone: "Z1" },
    { id: 3, NomProjet: "P", Taches: "Visa MOE", Type_doc: "", ID2: "" },
    { id: 4, NomProjet: "P", Taches: "Segment v1", Type_doc: "SYNTHESE", ID2: "" },
    { id: 5, NomProjet: "Autre", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "002" },
  ];
  assert.deepEqual(getProjectPlanningRows(rows, "P").map((row) => row.id), [1, 2]);
});

test("le recalcul automatique ignore aussi les étages Synthese", () => {
  const rows = [
    { id: 1, NomProjet: "P", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001" },
    { id: 6, NomProjet: "P", Taches: "PH RDB", Type_doc: "", ID2: "", Zone: "Z1", Etage: true },
    { id: 7, NomProjet: "P", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Z1", Groupe: "PH RDB", Etage: false },
  ];
  assert.deepEqual(getProjectPlanningRows(rows, "P").map((row) => row.id), [1]);
});
