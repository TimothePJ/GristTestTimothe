import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTargetIndiceByTypeFromAvancement,
} from "../assets/js/top/vendor/planningRealisation.js";

test("Avancement version 2 utilise uniquement le service demandé", () => {
  const raw = JSON.stringify({
    version: 2,
    services: {
      Structure: [{ typeDocument: "COFFRAGE", indice: "A" }],
      Synthese: [{ typeDocument: "COFFRAGE", indice: "B" }],
      Topographie: [],
    },
  });

  const structure = buildTargetIndiceByTypeFromAvancement(raw, "Structure");
  const synthese = buildTargetIndiceByTypeFromAvancement(raw, "Synthese");

  assert.equal(structure.get("COFFRAGE"), "A");
  assert.equal(synthese.get("COFFRAGE"), "B");
});

test("Avancement historique reste rattaché à Structure", () => {
  const raw = JSON.stringify([{ typeDocument: "NDC", indice: "0" }]);
  assert.equal(
    buildTargetIndiceByTypeFromAvancement(raw, "Structure").get("NDC"),
    "0"
  );
  assert.equal(
    buildTargetIndiceByTypeFromAvancement(raw, "Synthese").has("NDC"),
    false
  );
});
