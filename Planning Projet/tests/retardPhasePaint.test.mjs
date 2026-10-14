// Couleur d'une barre en retard du planning Structure : la règle est lue par la vue Global pour
// dessiner les mêmes segments. Le style CSS du planning Structure ne doit pas changer.
import test from "node:test";
import assert from "node:assert/strict";

import { buildRetardPhaseStyle, retardPhasePaint } from "../assets/js/services/planningService.js";

test("style d'une barre : inchangé pour le planning Structure", () => {
  assert.equal(buildRetardPhaseStyle("phase-coffrage", 50, 0), "", "pas de retard");
  assert.equal(buildRetardPhaseStyle("phase-coffrage", 100, 12), "", "réalisée");
  assert.equal(buildRetardPhaseStyle("phase-inconnue", 0, 12), "", "type sans palette");
  assert.equal(
    buildRetardPhaseStyle("phase-armature phase-past", 0, 23),
    "background: #efc2c2 !important; border-color: #dc9f9f !important; color: #334155 !important"
  );
  assert.equal(
    buildRetardPhaseStyle("phase-coffrage", 40, "7"),
    "background: linear-gradient(to right, #fef3c7 0%, #fef3c7 40%, #d99b9b 40%, #d99b9b 100%) !important; " +
      "border-color: #fde68a !important; color: #92400e !important"
  );
  assert.equal(
    buildRetardPhaseStyle("phase-coupes phase-past", 140, 3),
    "",
    "réalisé borné à 100 %"
  );
});

test("peinture d'une barre en retard : réalisé, couleur faite, couleur en retard, bord, texte", () => {
  assert.equal(retardPhasePaint("phase-coffrage", 50, 0), null);
  assert.equal(retardPhasePaint("phase-coffrage", 100, 12), null);
  assert.equal(retardPhasePaint("phase-demarrage", 0, 12), null);
  assert.deepEqual(retardPhasePaint("phase-armature phase-past", 0, 23), {
    realise: 0, done: "#e5e7eb", late: "#efc2c2", border: "#dc9f9f", text: "#334155",
  });
  assert.deepEqual(retardPhasePaint("phase-coffrage", 40, "7"), {
    realise: 40, done: "#fef3c7", late: "#d99b9b", border: "#fde68a", text: "#92400e",
  });
  assert.deepEqual(retardPhasePaint("phase-ndc", -5, 2), {
    realise: 0, done: "#e9e6f2", late: "#efd0d9", border: "#d8a8b8", text: "#4d426a",
  });
});
