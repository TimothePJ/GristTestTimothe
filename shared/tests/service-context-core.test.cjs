const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../service-context-core.js");

test("parseGrants compare les numéros exactement et déduplique", () => {
  const grants = core.parseGrants("252035|ERA\n25203|Autre\r\n252035|Doublon");
  assert.deepEqual(grants, [
    { projectNumber: "252035", projectName: "ERA" },
    { projectNumber: "25203", projectName: "Autre" },
  ]);
  assert.equal(core.hasProjectGrant("252035|ERA", "252035"), true);
  assert.equal(core.hasProjectGrant("252035|ERA", "25203"), false);
});

test("getAllowedServices conserve le service propre et ajoute les droits du projet", () => {
  const row = {
    Service: "Synthese",
    Projets_Lecture_Structure: "252035|ERA QUAI D'ORSAY",
    Projets_Lecture_Topographie: "9999|Test",
  };
  assert.deepEqual(core.getAllowedServices(row, "252035"), ["Structure", "Synthese"]);
  assert.deepEqual(core.getAllowedServices(row, "5"), ["Synthese"]);
});

test("Avancement legacy est lu dans Structure puis converti en version 2", () => {
  const legacy = JSON.stringify([{ typeDocument: "NDC", indice: "0" }]);
  assert.deepEqual(core.getServiceAvancementItems(legacy, "Structure").items, [
    { typeDocument: "NDC", indice: "0" },
  ]);
  const serialized = core.updateServiceAvancement(legacy, "Synthese", [
    { budgetKey: "01-Test", percentage: 50 },
  ]);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.services.Structure, [{ typeDocument: "NDC", indice: "0" }]);
  assert.deepEqual(parsed.services.Synthese, [{ budgetKey: "01-Test", percentage: 50 }]);
  assert.deepEqual(parsed.services.Topographie, []);
});

test("filterRawTableByService filtre les objets colonnaires et traite le vide comme Structure", () => {
  const raw = {
    id: [1, 2, 3],
    Service: ["Structure", "Synthese", ""],
    Name: ["A", "B", "C"],
  };
  assert.deepEqual(core.filterRawTableByService(raw, "Structure"), {
    id: [1, 3],
    Service: ["Structure", ""],
    Name: ["A", "C"],
  });
  assert.deepEqual(core.filterRawTableByService(raw, "Synthese"), {
    id: [2],
    Service: ["Synthese"],
    Name: ["B"],
  });
});

test("transformActions ajoute Service et NumeroProjet aux créations concernées", () => {
  const actions = core.transformActions([
    ["AddRecord", "References2", null, { NomProjet: "ERA" }],
    ["AddRecord", "Budget", null, { NumeroProjet: "252035", Chapter: "01" }],
    ["UpdateRecord", "References2", 1, { Indice: "A" }],
  ], {
    selectedService: "Structure",
    projectNumber: "252035",
  });
  assert.deepEqual(actions[0][3], {
    NomProjet: "ERA",
    Service: "Structure",
    NumeroProjet: "252035",
  });
  assert.deepEqual(actions[1][3], {
    NumeroProjet: "252035",
    Chapter: "01",
    Service: "Structure",
  });
  assert.deepEqual(actions[2], [
    "UpdateRecord",
    "References2",
    1,
    {
      Indice: "A",
      Service: "Structure",
      NumeroProjet: "252035",
    },
  ]);
});
