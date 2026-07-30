const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../service-context-core.js");

const PROJECTS = [
  { id: 1, number: "252035", name: "ERA QUAI D'ORSAY" },
  { id: 2, number: "2520", name: "Projet court" },
  { id: 3, number: "9999", name: "Projet topo" },
  { id: 4, number: "252035", name: "Alias ERA" },
];

test("parseGrants compare les numéros exactement et conserve les alias de nom", () => {
  const grants = core.parseGrants("252035|ERA\n25203|Autre\r\n252035|Doublon\n252035|ERA");
  assert.deepEqual(grants, [
    { projectNumber: "252035", projectName: "ERA" },
    { projectNumber: "25203", projectName: "Autre" },
    { projectNumber: "252035", projectName: "Doublon" },
  ]);
  assert.equal(core.hasProjectGrant("252035|ERA", "252035"), true);
  assert.equal(core.hasProjectGrant("252035|ERA", "2520"), false);
});

test("Structure voit tous les projets et modifie toujours Structure", () => {
  const member = { Service: "Structure" };
  assert.deepEqual(
    core.getAllowedProjects(member, PROJECTS).map((project) => project.number),
    ["252035", "2520", "9999"]
  );
  assert.deepEqual(core.getAllowedServices(member, "252035"), ["Structure"]);
  assert.equal(core.canEditCurrentContext(member, "252035", "Structure"), true);
  assert.equal(core.getProjectAccessMode(member, "252035", "Structure"), "editable");
});

test("Structure ne voit un service externe que pour un projet explicitement attribué", () => {
  const member = {
    Service: "Structure",
    Projets_Lecture_Synthese: "252035|ERA QUAI D'ORSAY",
  };
  assert.deepEqual(core.getAllowedServices(member, "252035"), ["Structure", "Synthese"]);
  assert.deepEqual(core.getAllowedServices(member, "2520"), ["Structure"]);
  assert.equal(core.getProjectAccessMode(member, "252035", "Synthese"), "readonly");
  assert.equal(core.canEditCurrentContext(member, "252035", "Synthese"), false);
});

test("Synthese ne voit et ne modifie que ses projets attribués dans Synthese", () => {
  const member = {
    Service: "Synthese",
    Projets_Lecture_Synthese: "252035|ERA QUAI D'ORSAY",
  };
  assert.deepEqual(
    core.getAllowedProjects(member, PROJECTS).map((project) => project.number),
    ["252035"]
  );
  assert.deepEqual(core.getAllowedServices(member, "252035"), ["Synthese"]);
  assert.equal(core.getProjectAccessMode(member, "252035", "Synthese"), "editable");
  assert.equal(core.getProjectAccessMode(member, "2520", "Synthese"), "hidden");
});

test("Synthese peut recevoir uniquement Structure, en lecture seule", () => {
  const member = {
    Service: "Synthese",
    Projets_Lecture_Structure: "252035|ERA QUAI D'ORSAY",
  };
  assert.deepEqual(
    core.getAllowedProjects(member, PROJECTS).map((project) => project.number),
    ["252035"]
  );
  assert.deepEqual(core.getAllowedServices(member, "252035"), ["Structure"]);
  assert.equal(core.getProjectAccessMode(member, "252035", "Structure"), "readonly");
  assert.equal(core.canEditCurrentContext(member, "252035", "Structure"), false);
});

test("Synthese peut cumuler son service modifiable et Structure en lecture seule", () => {
  const member = {
    Service: "Synthese",
    Projets_Lecture_Structure: "252035|ERA QUAI D'ORSAY",
    Projets_Lecture_Synthese: "252035|ERA QUAI D'ORSAY",
  };
  assert.deepEqual(core.getAllowedServices(member, "252035"), ["Structure", "Synthese"]);
  assert.equal(core.getProjectAccessMode(member, "252035", "Structure"), "readonly");
  assert.equal(core.getProjectAccessMode(member, "252035", "Synthese"), "editable");
});

test("un utilisateur non-Structure sans attribution ne voit aucun projet", () => {
  const member = { Service: "Synthese", Admin: true };
  assert.deepEqual(core.getAllowedProjects(member, PROJECTS), []);
  assert.deepEqual(core.getAllowedServices(member, "252035"), []);
  assert.equal(core.getProjectAccessMode(member, "252035", "Synthese"), "hidden");
});

test("la sélection retombe sur le premier projet autorisé après révocation", () => {
  assert.equal(core.selectAllowedProject(PROJECTS.slice(0, 2), { projectId: 1 }).id, 1);
  assert.equal(core.selectAllowedProject(PROJECTS.slice(1, 2), { projectId: 1 }).id, 2);
  assert.equal(core.selectAllowedProject([], { projectId: 1 }), null);
});

test("le contexte multiprojet ne propose que les services contenant des projets autorisés", () => {
  const synthese = {
    Service: "Synthese",
    Projets_Lecture_Structure: "252035|ERA QUAI D'ORSAY",
    Projets_Lecture_Topographie: "9999|Projet topo",
  };
  assert.deepEqual(
    core.getAllowedServicesForProjects(synthese, PROJECTS),
    ["Structure", "Topographie"]
  );
  const structure = { Service: "Structure", Projets_Lecture_Synthese: "252035|ERA" };
  assert.deepEqual(
    core.getAllowedServicesForProjects(structure, PROJECTS),
    ["Structure", "Synthese"]
  );
});

test("les filtres combinent exactement service et projet courant", () => {
  const raw = {
    id: [1, 2, 3, 4],
    Service: ["Structure", "Structure", "Synthese", "Structure"],
    NomProjet: ["ERA", "Autre", "ERA", "ERA 2"],
  };
  const serviceRows = core.filterRawTableByService(raw, "Structure");
  assert.deepEqual(
    core.filterRawTableByProject(serviceRows, "References2", { number: "252035", name: "ERA" }),
    {
      id: [1],
      Service: ["Structure"],
      NomProjet: ["ERA"],
    }
  );
});

test("le filtre multiprojet utilise le numéro ou le nom exact du service choisi", () => {
  const scope = core.getProjectGrantScope({
    Service: "Synthese",
    Projets_Lecture_Structure: "252035|ERA",
  }, "Structure");
  const raw = {
    id: [1, 2, 3],
    Service: ["Structure", "Structure", "Structure"],
    NomProjet: ["ERA", "ERA 2", "Autre"],
  };
  assert.deepEqual(core.filterRawTableByProjectScope(raw, "References2", scope), {
    id: [1],
    Service: ["Structure"],
    NomProjet: ["ERA"],
  });
});

test("filterProjectsRaw retire les projets non autorisés du catalogue", () => {
  const raw = {
    id: [1, 2, 3],
    Numero_de_projet: ["252035", "2520", "9999"],
    Nom_de_projet: ["ERA", "Court", "Topo"],
  };
  assert.deepEqual(core.filterProjectsRaw(raw, [PROJECTS[0], PROJECTS[2]]), {
    id: [1, 3],
    Numero_de_projet: ["252035", "9999"],
    Nom_de_projet: ["ERA", "Topo"],
  });
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

test("transformActions injecte Service et l'identité exacte du projet", () => {
  const actions = core.transformActions([
    ["AddRecord", "References2", null, { Indice: "A" }],
    ["AddRecord", "Budget", null, { Chapter: "01" }],
    ["UpdateRecord", "Planning_Projet", 1, { NomProjet: "ERA", Realise: 1 }],
  ], {
    selectedService: "Synthese",
    projectNumber: "252035",
    projectName: "ERA",
  });
  assert.deepEqual(actions[0][3], {
    Indice: "A",
    Service: "Synthese",
    NomProjet: "ERA",
  });
  assert.deepEqual(actions[1][3], {
    NumeroProjet: "252035",
    Chapter: "01",
    Service: "Synthese",
  });
  assert.deepEqual(actions[2][3], {
    NomProjet: "ERA",
    Realise: 1,
    Service: "Synthese",
  });
});

test("transformActions refuse une identité projet contradictoire", () => {
  assert.throws(() => core.transformActions([
    ["AddRecord", "References2", null, { NomProjet: "Autre" }],
  ], {
    selectedService: "Structure",
    projectNumber: "252035",
    projectName: "ERA",
  }), /contexte/);
});

test("transformActions couvre aussi les écritures en masse", () => {
  const [action] = core.transformActions([
    ["BulkAddRecord", "TimeSegment", [null, null], { Name: ["A", "B"] }],
  ], {
    selectedService: "Structure",
    projectNumber: "252035",
    projectName: "ERA",
  });
  assert.deepEqual(action[3], {
    Name: ["A", "B"],
    Service: ["Structure", "Structure"],
    NumeroProjet: ["252035", "252035"],
  });
});

test("seules les mutations des tables du contexte Projet/Service sont protégées", () => {
  assert.equal(core.isProtectedMutationAction(["UpdateRecord", "References2", 1, {}]), true);
  assert.equal(core.isProtectedMutationAction(["UpdateRecord", "Projets2", 1, {}]), true);
  assert.equal(core.isProtectedMutationAction(["UpdateRecord", "Time_Out", 1, {}]), false);
  assert.equal(core.isProtectedMutationAction(["UpdateRecord", "CalendarTimesheet", 1, {}]), false);
});
