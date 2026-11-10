import test from "node:test";
import assert from "node:assert/strict";
import {
  ZONE_DATA_TABLES,
  ZONE_DATA_READ_FAILED,
  ZONE_RENAME_READ_FAILED,
  buildZoneLeftoverNotice,
  buildZoneNotHereMessage,
  buildZoneRefusal,
  findZoneHolders,
} from "../assets/js/services/zoneGuard.js";

const dataOf = (rows, opts) => findZoneHolders(rows, opts).data;
const tache = (service, zone, extra = {}) => ({ Service: service, Zone: zone, Taches: "T", ...extra });

test("les trois tables de zones sont listées", () => {
  assert.deepEqual([...ZONE_DATA_TABLES], ["Planning_Projet", "References2", "ListePlan_NDC_COF"]);
});

test("Synthese supprime Zone 2 alors que Structure y a des données", () => {
  const rows = {
    Planning_Projet: [tache("Structure", "Zone 2"), tache("Structure", "Zone 2")],
    ListePlan_NDC_COF: [{ Service: "Structure", Zone: "Zone 2" }],
  };
  const found = dataOf(rows, { zone: "Zone 2", service: "Synthese" });
  assert.deepEqual(found, [{ service: "Structure", count: 3 }]);
  assert.equal(
    buildZoneRefusal("Zone 2", found),
    "Impossible de supprimer la zone « Zone 2 » : le service Structure y a des données (3 lignes)."
  );
});

test("symétrie : Structure supprime, Synthese a des données", () => {
  const rows = { Planning_Projet: [tache("Synthese", "Zone 2")] };
  assert.deepEqual(dataOf(rows, { zone: "Zone 2", service: "Structure" }), [
    { service: "Synthese", count: 1 },
  ]);
});

test("ligne d'ancrage vide de Planning_Projet ne compte pas, mais dans References2 oui", () => {
  const anchor = { Service: "Structure", Zone: "Zone 2", Taches: "", Tache: "", ID2: "", Type_doc: "" };
  assert.deepEqual(
    dataOf({ Planning_Projet: [anchor] }, { zone: "Zone 2", service: "Synthese" }),
    []
  );
  assert.deepEqual(
    dataOf({ Planning_Projet: [{ Service: "Structure", Zone: "Zone 2" }] }, { zone: "Zone 2", service: "Synthese" }),
    []
  );
  assert.deepEqual(
    dataOf({ References2: [anchor] }, { zone: "Zone 2", service: "Synthese" }),
    [{ service: "Structure", count: 1 }]
  );
});

test("service courant seul, Service vide ou inconnu : rien", () => {
  const rows = {
    Planning_Projet: [tache("Synthese", "Zone 2"), tache("", "Zone 2"), tache("Autre", "Zone 2"), tache(undefined, "Zone 2")],
  };
  assert.deepEqual(dataOf(rows, { zone: "Zone 2", service: "Synthese" }), []);
});

test("comparaison souple de la zone", () => {
  for (const z of ["ZONE 2", "Zône 2", "zone-2"]) {
    assert.deepEqual(
      dataOf({ Planning_Projet: [tache("Structure", z)] }, { zone: "Zone 2", service: "Synthese" }),
      [{ service: "Structure", count: 1 }],
      z
    );
  }
  assert.deepEqual(
    dataOf({ Planning_Projet: [tache("Structure", "Zone 20")] }, { zone: "Zone 2", service: "Synthese" }),
    []
  );
  const rows = { Planning_Projet: [tache("Structure", "Sans zone"), tache("Structure", "")] };
  assert.deepEqual(dataOf(rows, { zone: "Sans zone", service: "Synthese" }), []);
  assert.deepEqual(dataOf(rows, { zone: "", service: "Synthese" }), []);
});

test("normalisation des services", () => {
  assert.deepEqual(
    dataOf({ Planning_Projet: [tache("synthèse", "Z")] }, { zone: "Z", service: "Structure" }),
    [{ service: "Synthese", count: 1 }]
  );
  assert.deepEqual(
    dataOf({ Planning_Projet: [tache("Structure", "Z")] }, { zone: "Z", service: "structure" }),
    []
  );
});

test("deux autres services : triés, singulier et liste", () => {
  const rows = { Planning_Projet: [tache("Topographie", "Z"), tache("Structure", "Z")] };
  const found = dataOf(rows, { zone: "Z", service: "Synthese" });
  assert.deepEqual(found, [
    { service: "Structure", count: 1 },
    { service: "Topographie", count: 1 },
  ]);
  assert.equal(
    buildZoneRefusal("Z", found),
    "Impossible de supprimer la zone « Z » : d'autres services y ont des données — Structure (1 ligne), Topographie (1 ligne)."
  );
});

test("table absente = aucune ligne ; message de lecture", () => {
  assert.deepEqual(dataOf({}, { zone: "Z", service: "Synthese" }), []);
  assert.match(ZONE_DATA_READ_FAILED, /^La zone n'a pas été supprimée/);
});

const anchor = (service, zone) => ({ Service: service, Zone: zone, Taches: "", Tache: "", ID2: "", Type_doc: "" });

test("service qui ne garde que la zone vide : dans empty, pas dans data", () => {
  const holders = findZoneHolders({ Planning_Projet: [anchor("Structure", "Zone 2")] }, { zone: "Zone 2", service: "Synthese" });
  assert.deepEqual(holders, { data: [], empty: ["Structure"] });
});

test("ancrage ET ligne de données : data seulement", () => {
  const rows = { Planning_Projet: [anchor("Structure", "Zone 2"), tache("Structure", "Zone 2")] };
  assert.deepEqual(findZoneHolders(rows, { zone: "Zone 2", service: "Synthese" }), {
    data: [{ service: "Structure", count: 1 }],
    empty: [],
  });
});

test("deux services qui gardent la zone vide : triés ; le service courant est exclu", () => {
  const rows = { Planning_Projet: [anchor("Topographie", "Z"), anchor("Structure", "Z"), anchor("Synthese", "Z")] };
  assert.deepEqual(findZoneHolders(rows, { zone: "Z", service: "Synthese" }).empty, ["Structure", "Topographie"]);
});

test("zone vide ou sans zone : rien", () => {
  assert.deepEqual(findZoneHolders({ Planning_Projet: [anchor("Structure", "")] }, { zone: "", service: "Synthese" }), {
    data: [],
    empty: [],
  });
});

test("refus de renommage", () => {
  assert.equal(
    buildZoneRefusal("Zone 2", [{ service: "Structure", count: 1 }], { action: "renommer" }),
    "Impossible de renommer la zone « Zone 2 » : le service Structure y a des données (1 ligne)."
  );
  assert.equal(
    buildZoneRefusal("Z", [{ service: "Structure", count: 2 }, { service: "Topographie", count: 1 }], { action: "renommer" }),
    "Impossible de renommer la zone « Z » : d'autres services y ont des données — Structure (2 lignes), Topographie (1 ligne)."
  );
});

test("lecture impossible au renommage", () => {
  assert.equal(
    ZONE_RENAME_READ_FAILED,
    "La zone n'a pas été renommée : les données des autres services n'ont pas pu être lues. Réessayez."
  );
});

test("avis quand un autre service garde la zone vide", () => {
  assert.equal(
    buildZoneLeftoverNotice({ action: "renommer", zone: "A", targetZone: "B", empty: ["Structure"] }),
    "Zone renommée : « A » → « B ». Le service Structure garde une zone « A » vide : supprimez-la depuis ce service."
  );
  assert.equal(
    buildZoneLeftoverNotice({ action: "renommer", zone: "A", targetZone: "B", empty: ["Structure", "Topographie"] }),
    "Zone renommée : « A » → « B ». Les services Structure et Topographie gardent une zone « A » vide : supprimez-la depuis ces services."
  );
  assert.equal(
    buildZoneLeftoverNotice({ action: "supprimer", zone: "A", empty: ["Structure"] }),
    "Zone « A » supprimée dans ce service. Le service Structure la garde (vide) : supprimez-la aussi depuis ce service."
  );
  assert.equal(
    buildZoneLeftoverNotice({ action: "supprimer", zone: "A", empty: ["Structure", "Synthese", "Topographie"] }),
    "Zone « A » supprimée dans ce service. Les services Structure, Synthese et Topographie la gardent (vide) : supprimez-la aussi depuis ces services."
  );
});

test("avis : la zone n'a aucune ligne dans ce service", () => {
  assert.equal(
    buildZoneNotHereMessage({ action: "renommer", zone: "A", service: "Synthese", empty: [] }),
    "La zone « A » n'a aucune ligne dans le service Synthese : rien n'a été renommé."
  );
  assert.equal(
    buildZoneNotHereMessage({ action: "supprimer", zone: "A", service: "Synthese", empty: [] }),
    "La zone « A » n'a aucune ligne dans le service Synthese : rien n'a été supprimé."
  );
  assert.equal(
    buildZoneNotHereMessage({ action: "renommer", zone: "A", service: "Synthese", empty: ["Structure"] }),
    "La zone « A » n'a aucune ligne dans le service Synthese : rien n'a été renommé. Elle vient du service Structure : renommez-la depuis ce service."
  );
  assert.equal(
    buildZoneNotHereMessage({ action: "supprimer", zone: "A", service: "Synthese", empty: ["Structure", "Topographie"] }),
    "La zone « A » n'a aucune ligne dans le service Synthese : rien n'a été supprimé. Elle vient des services Structure et Topographie : supprimez-la depuis ces services."
  );
  assert.equal(
    buildZoneNotHereMessage({ action: "supprimer", zone: "A", service: "", empty: [] }),
    "La zone « A » n'a aucune ligne dans ce service : rien n'a été supprimé."
  );
});
