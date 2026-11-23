import test from "node:test";
import assert from "node:assert/strict";
import {
  ZONE_DATA_TABLES,
  ZONE_DATA_READ_FAILED,
  buildZoneDeletionRefusal,
  findZoneDataInOtherServices,
} from "../assets/js/services/zoneDeletionGuard.js";

const tache = (service, zone, extra = {}) => ({ Service: service, Zone: zone, Taches: "T", ...extra });

test("les trois tables de zones sont listées", () => {
  assert.deepEqual([...ZONE_DATA_TABLES], ["Planning_Projet", "References2", "ListePlan_NDC_COF"]);
});

test("Synthese supprime Zone 2 alors que Structure y a des données", () => {
  const rows = {
    Planning_Projet: [tache("Structure", "Zone 2"), tache("Structure", "Zone 2")],
    ListePlan_NDC_COF: [{ Service: "Structure", Zone: "Zone 2" }],
  };
  const found = findZoneDataInOtherServices(rows, { zone: "Zone 2", service: "Synthese" });
  assert.deepEqual(found, [{ service: "Structure", count: 3 }]);
  assert.equal(
    buildZoneDeletionRefusal("Zone 2", found),
    "Impossible de supprimer la zone « Zone 2 » : le service Structure y a des données (3 lignes)."
  );
});

test("symétrie : Structure supprime, Synthese a des données", () => {
  const rows = { Planning_Projet: [tache("Synthese", "Zone 2")] };
  assert.deepEqual(findZoneDataInOtherServices(rows, { zone: "Zone 2", service: "Structure" }), [
    { service: "Synthese", count: 1 },
  ]);
});

test("ligne d'ancrage vide de Planning_Projet ne compte pas, mais dans References2 oui", () => {
  const anchor = { Service: "Structure", Zone: "Zone 2", Taches: "", Tache: "", ID2: "", Type_doc: "" };
  assert.deepEqual(
    findZoneDataInOtherServices({ Planning_Projet: [anchor] }, { zone: "Zone 2", service: "Synthese" }),
    []
  );
  assert.deepEqual(
    findZoneDataInOtherServices({ Planning_Projet: [{ Service: "Structure", Zone: "Zone 2" }] }, { zone: "Zone 2", service: "Synthese" }),
    []
  );
  assert.deepEqual(
    findZoneDataInOtherServices({ References2: [anchor] }, { zone: "Zone 2", service: "Synthese" }),
    [{ service: "Structure", count: 1 }]
  );
});

test("service courant seul, Service vide ou inconnu : rien", () => {
  const rows = {
    Planning_Projet: [tache("Synthese", "Zone 2"), tache("", "Zone 2"), tache("Autre", "Zone 2"), tache(undefined, "Zone 2")],
  };
  assert.deepEqual(findZoneDataInOtherServices(rows, { zone: "Zone 2", service: "Synthese" }), []);
});

test("comparaison souple de la zone", () => {
  for (const z of ["ZONE 2", "Zône 2", "zone-2"]) {
    assert.deepEqual(
      findZoneDataInOtherServices({ Planning_Projet: [tache("Structure", z)] }, { zone: "Zone 2", service: "Synthese" }),
      [{ service: "Structure", count: 1 }],
      z
    );
  }
  assert.deepEqual(
    findZoneDataInOtherServices({ Planning_Projet: [tache("Structure", "Zone 20")] }, { zone: "Zone 2", service: "Synthese" }),
    []
  );
  const rows = { Planning_Projet: [tache("Structure", "Sans zone"), tache("Structure", "")] };
  assert.deepEqual(findZoneDataInOtherServices(rows, { zone: "Sans zone", service: "Synthese" }), []);
  assert.deepEqual(findZoneDataInOtherServices(rows, { zone: "", service: "Synthese" }), []);
});

test("normalisation des services", () => {
  assert.deepEqual(
    findZoneDataInOtherServices({ Planning_Projet: [tache("synthèse", "Z")] }, { zone: "Z", service: "Structure" }),
    [{ service: "Synthese", count: 1 }]
  );
  assert.deepEqual(
    findZoneDataInOtherServices({ Planning_Projet: [tache("Structure", "Z")] }, { zone: "Z", service: "structure" }),
    []
  );
});

test("deux autres services : triés, singulier et liste", () => {
  const rows = { Planning_Projet: [tache("Topographie", "Z"), tache("Structure", "Z")] };
  const found = findZoneDataInOtherServices(rows, { zone: "Z", service: "Synthese" });
  assert.deepEqual(found, [
    { service: "Structure", count: 1 },
    { service: "Topographie", count: 1 },
  ]);
  assert.equal(
    buildZoneDeletionRefusal("Z", found),
    "Impossible de supprimer la zone « Z » : d'autres services y ont des données — Structure (1 ligne), Topographie (1 ligne)."
  );
});

test("table absente = aucune ligne ; message de lecture", () => {
  assert.deepEqual(findZoneDataInOtherServices({}, { zone: "Z", service: "Synthese" }), []);
  assert.match(ZONE_DATA_READ_FAILED, /^La zone n'a pas été supprimée/);
});
