const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../service-context-core.js");

const PROJECTS = [
  { id: 1, ids: [1, 4], number: "252035", name: "ERA QUAI D'ORSAY", names: ["ERA QUAI D'ORSAY", "Alias ERA"] },
  { id: 2, number: "2520", name: "Projet court", names: ["Projet court"] },
  { id: 3, number: "9999", name: "Projet topo", names: ["Projet topo"] },
  { id: 4, number: "252035", name: "Alias ERA", names: ["Alias ERA"] },
];

const TEAM = [
  { id: 1, Prenom: "Alice", Nom: "Martin", PrenomNom: "Alice Martin", Service: "Structure" },
  { id: 2, Prenom: "Bob", Nom: "Durand", PrenomNom: "Bob Durand", Service: "Synthese" },
  { id: 3, Prenom: "Claire", Nom: "Petit", PrenomNom: "Claire Petit", Service: "Topographie" },
  { id: 4, Prenom: "Meghan", Nom: "Stone", PrenomNom: "Meghan Stone", Service: "Structure" },
  { id: 5, Prenom: "Meghan", Nom: "Lee", PrenomNom: "Meghan Lee", Service: "Synthese" },
  { id: 6, Prenom: "Sans", Nom: "Service", PrenomNom: "Sans Service", Service: "" },
];

const PROJECT_TEAM = [
  { id: 10, NumeroProjet: "252035", Name: "Alice Martin", Role: "Ingénieur", Service: "Structure" },
  { id: 11, NumeroProjet: "252035", Name: "Alice Martin", Role: "Projeteur", Service: "Structure" },
  { id: 12, NumeroProjet: "9999", Name: "Bob", Role: "Ingénieur", Service: "Structure" },
  { id: 13, NumeroProjet: "2520", Name: "Meghan", Role: "Ingénieur", Service: "Structure" },
  { id: 14, NumeroProjet: "252035", Name: "Personne externe", Role: "Sous-traitant", Service: "Structure" },
];

const DUPLICATE_PERSON_ROWS = [
  {
    id: 7,
    Prenom: "Laurent",
    Nom: "Orven",
    PrenomNom: "Laurent Orven",
    Email: "laurent@entreprise.fr",
    Service: "Structure",
  },
  {
    id: 8,
    Prenom: "Laurent",
    Nom: "Orven",
    PrenomNom: "Laurent Orven",
    Email: "laurent-ext@partenaire.fr",
    Service: "Structure",
  },
];

function context(projectTeamRows = PROJECT_TEAM) {
  return { teamRows: TEAM, projectTeamRows };
}

test("parseProjectAccess compare les numéros exactement et conserve les alias", () => {
  const grants = core.parseProjectAccess("252035|ERA\n25203|Autre\r\n252035|Doublon\n252035|ERA");
  assert.deepEqual(grants, [
    { projectNumber: "252035", projectName: "ERA" },
    { projectNumber: "25203", projectName: "Autre" },
    { projectNumber: "252035", projectName: "Doublon" },
  ]);
  assert.equal(core.parseProjectAccess("252035|ERA")
    .some((grant) => grant.projectNumber === "252035"), true);
  assert.equal(core.parseProjectAccess("252035|ERA")
    .some((grant) => grant.projectNumber === "2520"), false);
});

test("serializeProjectAccess est stable, trié et sans doublon", () => {
  assert.equal(core.serializeProjectAccess([
    { projectNumber: " 9999 ", projectName: "Topo" },
    { projectNumber: "252035", projectName: "ERA" },
    { projectNumber: "252035", projectName: "ERA" },
    { projectNumber: "252035", projectName: "Alias ERA" },
  ]), "9999|Topo\n252035|Alias ERA\n252035|ERA");
});

test("le résolveur reconnaît un nom complet normalisé", () => {
  const result = core.resolveTeamPerson("  ALICE   MÀRTIN ", TEAM);
  assert.equal(result.status, "matched");
  assert.equal(result.teamRow.id, 1);
  assert.equal(result.matchKind, "full-name");
});

test("un prénom seul est accepté uniquement lorsqu'il est unique", () => {
  assert.equal(core.resolveTeamPerson("Bob", TEAM).teamRow.id, 2);
  const ambiguous = core.resolveTeamPerson("Meghan", TEAM);
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.candidates.map((row) => row.id), [4, 5]);
});

test("deux lignes Team du même nom complet sont une seule personne avec deux comptes", () => {
  const rows = [...TEAM, ...DUPLICATE_PERSON_ROWS];
  const resolution = core.resolveTeamPerson("Laurent Orven", rows);
  assert.equal(resolution.status, "matched");
  assert.equal(resolution.matchKind, "duplicate-full-name");
  assert.deepEqual(resolution.teamRows.map((row) => row.id), [7, 8]);
  const [person] = core.groupTeamPeople(DUPLICATE_PERSON_ROWS);
  assert.deepEqual(person.teamIds, [7, 8]);
  assert.deepEqual(person.emails, ["laurent@entreprise.fr", "laurent-ext@partenaire.fr"]);
});

test("ProjectTeam fusionne les doublons Team et donne l'accès aux deux emails", () => {
  const rows = [...TEAM, ...DUPLICATE_PERSON_ROWS];
  const projectTeamRows = [
    { id: 20, NumeroProjet: "252035", Name: "Laurent Orven", Role: "Ingénieur" },
  ];
  const resolved = core.resolveProjectTeamRows(rows, projectTeamRows);
  assert.equal(resolved.unresolved.length, 0);
  assert.deepEqual(resolved.matched.map((assignment) => assignment.teamId), [7, 8]);
  DUPLICATE_PERSON_ROWS.forEach((teamRow) => {
    assert.deepEqual(
      [...core.getEffectiveProjectNumbers(teamRow, { teamRows: rows, projectTeamRows })],
      ["252035"]
    );
  });
  const result = core.getProjectAssignees(rows, projectTeamRows, "252035");
  const laurent = result.assignees.find((assignee) => assignee.personName === "Laurent Orven");
  assert.deepEqual(laurent.teamIds, [7, 8]);
  assert.deepEqual(laurent.emails, ["laurent@entreprise.fr", "laurent-ext@partenaire.fr"]);
});

test("un accès manuel porté par un doublon bénéficie à l'autre compte", () => {
  const first = { ...DUPLICATE_PERSON_ROWS[0], Projets_Access: "9999|Projet topo" };
  const second = { ...DUPLICATE_PERSON_ROWS[1], Projets_Access: "" };
  const rows = [...TEAM, first, second];
  assert.deepEqual(
    [...core.getEffectiveProjectNumbers(second, { teamRows: rows, projectTeamRows: [] })],
    ["9999"]
  );
});

test("une personne ProjectTeam inconnue n'est pas attribuée arbitrairement", () => {
  const result = core.resolveTeamPerson("Personne externe", TEAM);
  assert.equal(result.status, "unmatched");
  assert.equal(result.teamRow, null);
});

test("une référence Grist ProjectTeam.Name est résolue directement vers Team", () => {
  assert.equal(core.resolveTeamPersonValue(2, TEAM).teamRow.id, 2);
  assert.equal(core.resolveTeamPersonValue(["R", 3], TEAM).teamRow.id, 3);
  assert.equal(core.resolveTeamPersonValue({ id: 1 }, TEAM).teamRow.id, 1);
  assert.equal(core.resolveTeamPersonValue(999, TEAM).status, "unmatched");
});

test("resolveProjectTeamRows sépare les affectations reconnues et non résolues", () => {
  const result = core.resolveProjectTeamRows(TEAM, PROJECT_TEAM);
  assert.equal(result.matched.length, 3);
  assert.equal(result.unresolved.length, 2);
  assert.deepEqual(result.unresolved.map((row) => row.resolutionStatus).sort(), ["ambiguous", "unmatched"]);
});

test("l'accès effectif est l'union de ProjectTeam et Projets_Access", () => {
  const alice = { ...TEAM[0], Projets_Access: "9999|Projet topo" };
  const teamRows = [alice, ...TEAM.slice(1)];
  assert.deepEqual(
    [...core.getEffectiveProjectNumbers(alice, { teamRows, projectTeamRows: PROJECT_TEAM })].sort(),
    ["252035", "9999"]
  );
});

test("Structure sans affectation ne voit plus aucun projet", () => {
  const structure = { id: 20, Prenom: "Nouveau", Service: "Structure" };
  assert.deepEqual(core.getAllowedProjects(structure, PROJECTS, {
    teamRows: [...TEAM, structure],
    projectTeamRows: PROJECT_TEAM,
  }), []);
});

test("Synthese accède à un projet provenant uniquement de ProjectTeam", () => {
  const bob = TEAM[1];
  assert.deepEqual(
    core.getAllowedProjects(bob, PROJECTS, context()).map((project) => project.number),
    ["9999"]
  );
});

test("un accès provenant uniquement de Projets_Access est reconnu", () => {
  const claire = { ...TEAM[2], Projets_Access: "2520|Projet court" };
  assert.deepEqual(core.getAllowedProjects(claire, PROJECTS, {
    teamRows: [TEAM[0], TEAM[1], claire, ...TEAM.slice(3)],
    projectTeamRows: [],
  }).map((project) => project.number), ["2520"]);
});

test("un accès orphelin absent de Projets2 ne crée pas de projet fantôme", () => {
  const claire = { ...TEAM[2], Projets_Access: "404404|Projet supprimé" };
  assert.deepEqual(core.getAllowedProjects(claire, PROJECTS, {
    teamRows: [TEAM[0], TEAM[1], claire, ...TEAM.slice(3)],
    projectTeamRows: [],
  }), []);
});

test("une personne affectée voit les trois services", () => {
  assert.deepEqual(core.getAllowedServices(TEAM[0], "252035", context()), core.SERVICES);
  assert.deepEqual(core.getAllowedServices(TEAM[0], "2520", context()), []);
});

test("seul le service personnel est modifiable", () => {
  assert.equal(core.getProjectAccessMode(TEAM[0], "252035", "Structure", context()), "editable");
  assert.equal(core.getProjectAccessMode(TEAM[0], "252035", "Synthese", context()), "readonly");
  assert.equal(core.getProjectAccessMode(TEAM[0], "252035", "Topographie", context()), "readonly");
  assert.equal(core.getProjectAccessMode(TEAM[0], "2520", "Structure", context()), "hidden");
});

test("Admin voit tous les projets mais ne modifie que son service", () => {
  const admin = { id: 30, Prenom: "Admin", Service: "Synthese", Admin: true };
  const accessContext = { teamRows: [...TEAM, admin], projectTeamRows: PROJECT_TEAM };
  assert.deepEqual(
    core.getAllowedProjects(admin, PROJECTS, accessContext).map((project) => project.number),
    ["252035", "2520", "9999"]
  );
  assert.equal(core.getProjectAccessMode(admin, "252035", "Synthese", accessContext), "editable");
  assert.equal(core.getProjectAccessMode(admin, "252035", "Structure", accessContext), "readonly");
});

test("une ligne Team sans service ne reçoit aucun contexte exploitable", () => {
  const member = { ...TEAM[5], Projets_Access: "252035|ERA" };
  assert.deepEqual(core.getAllowedProjects(member, PROJECTS, {
    teamRows: [...TEAM.slice(0, 5), member], projectTeamRows: [],
  }), []);
});

test("la sélection retombe sur le premier projet encore autorisé après révocation", () => {
  assert.equal(core.selectAllowedProject(PROJECTS.slice(0, 2), { projectId: 1 }).id, 1);
  assert.equal(core.selectAllowedProject(PROJECTS.slice(0, 2), { projectId: 4 }).id, 1);
  assert.equal(core.selectAllowedProject(PROJECTS.slice(0, 2), { projectName: "Alias ERA" }).id, 1);
  assert.equal(core.selectAllowedProject(PROJECTS.slice(1, 2), { projectId: 1 }).id, 2);
  assert.equal(core.selectAllowedProject([], { projectId: 1 }), null);
});

test("getProjectAssignees déduplique les sources et conserve les rôles", () => {
  const alice = { ...TEAM[0], Projets_Access: "252035|ERA" };
  const result = core.getProjectAssignees([alice, ...TEAM.slice(1)], PROJECT_TEAM, "252035");
  const assignee = result.assignees.find((row) => row.teamId === 1);
  assert.deepEqual(assignee.sources, ["manual", "project-team"]);
  assert.deepEqual(assignee.roles, ["Ingénieur", "Projeteur"]);
  assert.equal(result.unresolved[0].personName, "Personne externe");
});

test("le filtre service ne traite plus une valeur vide comme Structure", () => {
  const raw = {
    id: [1, 2, 3],
    Service: ["Structure", "Synthese", ""],
    Name: ["A", "B", "Legacy"],
  };
  assert.deepEqual(core.filterRawTableByService(raw, "Structure"), {
    id: [1], Service: ["Structure"], Name: ["A"],
  });
});

test("le filtre service normalise accents, espaces Unicode et espaces invisibles", () => {
  const raw = [
    { id: 1, Service: " Synthèse\u00a0", Name: "Synthese" },
    { id: 2, Service: "\u200BTopographie ", Name: "Topographie" },
    { id: 3, Service: "Structure", Name: "Structure" },
  ];
  assert.deepEqual(core.filterRawTableByService(raw, "Synthese"), [raw[0]]);
  assert.deepEqual(core.filterRawTableByService(raw, " Topographie "), [raw[1]]);
  assert.equal(core.normalizeService("Synthèse"), "Synthese");
});

test("les filtres projet acceptent tous les alias du même numéro", () => {
  const raw = {
    id: [1, 2, 3],
    Service: ["Structure", "Structure", "Structure"],
    NomProjet: ["ERA QUAI D'ORSAY", "Alias ERA", "Autre"],
  };
  assert.deepEqual(core.filterRawTableByProject(raw, "References2", PROJECTS[0]), {
    id: [1, 2],
    Service: ["Structure", "Structure"],
    NomProjet: ["ERA QUAI D'ORSAY", "Alias ERA"],
  });
});

test("les alias projet sont comparés sans dépendre des accents, espaces ou casse", () => {
  const raw = [
    { id: 1, Service: "Synthese", NomProjet: "  alias   ÉRA " },
    { id: 2, Service: "Synthese", NomProjet: "Autre" },
  ];
  assert.deepEqual(core.filterRawTableByProject(raw, "References2", PROJECTS[0]), [raw[0]]);
});

test("le scope multiprojet conserve numéros et alias exacts", () => {
  const scope = core.getProjectScope([PROJECTS[0]], PROJECTS);
  assert.deepEqual([...scope.numbers], ["252035"]);
  assert.deepEqual([...scope.names].sort(), ["Alias ERA", "ERA QUAI D'ORSAY"]);
});

test("filterProjectsRaw retire le catalogue non autorisé", () => {
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

test("Avancement legacy reste affecté à Structure", () => {
  const legacy = JSON.stringify([{ typeDocument: "NDC", indice: "0" }]);
  const serialized = core.updateServiceAvancement(legacy, "Synthese", [{ percentage: 50 }]);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed.services.Structure, [{ typeDocument: "NDC", indice: "0" }]);
  assert.deepEqual(parsed.services.Synthese, [{ percentage: 50 }]);
});

test("transformActions injecte Service et l'identité exacte du projet", () => {
  const actions = core.transformActions([
    ["AddRecord", "References2", null, { Indice: "A" }],
    ["AddRecord", "Budget", null, { Chapter: "01" }],
    ["UpdateRecord", "Projets2", 1, { Avancement: "{}" }],
  ], { selectedService: "Synthese", projectNumber: "252035", projectName: "ERA" });
  assert.deepEqual(actions[0][3], { Indice: "A", Service: "Synthese", NomProjet: "ERA" });
  assert.deepEqual(actions[1][3], { Chapter: "01", Service: "Synthese", NumeroProjet: "252035" });
  assert.deepEqual(actions[2][3], { Avancement: "{}", Numero_de_projet: "252035" });
});

test("transformActions refuse une identité projet contradictoire", () => {
  assert.throws(() => core.transformActions([
    ["AddRecord", "References2", null, { NomProjet: "Autre" }],
  ], { selectedService: "Structure", projectNumber: "252035", projectName: "ERA" }), /contexte/);
  assert.throws(() => core.transformActions([
    ["UpdateRecord", "Projets2", 1, { Numero_de_projet: "9999" }],
  ], { selectedService: "Structure", projectNumber: "252035", projectName: "ERA" }), /contexte/);
});

test("transformActions couvre les écritures en masse", () => {
  const [action] = core.transformActions([
    ["BulkAddRecord", "TimeSegment", [null, null], { Name: ["A", "B"] }],
  ], { selectedService: "Structure", projectNumber: "252035", projectName: "ERA" });
  assert.deepEqual(action[3], {
    Name: ["A", "B"],
    Service: ["Structure", "Structure"],
    NumeroProjet: ["252035", "252035"],
  });
});

test("rowMatchesContext protège les cibles Update et Remove", () => {
  const contextValue = {
    selectedService: "Synthese",
    projectNumber: "252035",
    projectName: "ERA QUAI D'ORSAY",
    projectNames: ["Alias ERA"],
  };
  assert.equal(core.rowMatchesContext(
    { Service: "Synthese", NumeroProjet: "252035" }, "Budget", contextValue
  ), true);
  assert.equal(core.rowMatchesContext(
    { Service: "Structure", NumeroProjet: "252035" }, "Budget", contextValue
  ), false);
  assert.equal(core.rowMatchesContext(
    { Service: "Synthese", NomProjet: "Alias ERA" }, "References2", contextValue
  ), true);
});

test("les mutations d'affectation sont détectées sans protéger toute la table Team", () => {
  assert.equal(core.isAccessAssignmentMutationAction(
    ["AddRecord", "ProjectTeam", null, { NumeroProjet: "252035" }]
  ), true);
  assert.equal(core.isAccessAssignmentMutationAction(
    ["UpdateRecord", "Team", 1, { Projets_Access: "252035|ERA" }]
  ), true);
  assert.equal(core.isAccessAssignmentMutationAction(
    ["UpdateRecord", "Team", 1, { Service: "Synthese" }]
  ), false);
  assert.deepEqual(core.getMutationRecordIds(["BulkRemoveRecord", "Budget", [1, 2]]), [1, 2]);
});

test("les filtres REST mono-projet combinent Service et identité projet exacte", () => {
  const currentProject = PROJECTS[0];
  const references = core.buildContextTableFilter("References2", {
    selectedService: "Synthèse",
    currentProject,
  });
  assert.deepEqual(references.filter, {
    Service: ["Synthese", "Synthèse"],
    NomProjet: ["ERA QUAI D'ORSAY", "Alias ERA"],
  });
  assert.deepEqual(core.buildContextTableFilter("ListePlan_NDC_COF", {
    selectedService: "Structure",
    currentProject,
  }).filter, {
    Service: ["Structure"],
    Nom_projet: ["ERA QUAI D'ORSAY", "Alias ERA"],
  });
  assert.deepEqual(core.buildContextTableFilter("Budget", {
    selectedService: "Structure",
    currentProject,
  }).filter, {
    Service: ["Structure"],
    NumeroProjet: ["252035"],
  });
  assert.deepEqual(core.buildContextTableFilter("Emetteurs", {
    selectedService: "Structure",
    currentProject,
  }).filter, { Service: ["Structure"] });
});

test("les politiques classent explicitement les tables REST filtrées et REST complètes", () => {
  const expectedModes = {
    References2: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    ListePlan_NDC_COF: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    Planning_Projet: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    Envois: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    Budget: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    ProjectTeam: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    TimeSegment: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    TimeReal: core.TABLE_POLICY_MODES.REST_PROJECT_SERVICE,
    Emetteurs: core.TABLE_POLICY_MODES.REST_SERVICE,
    Team: core.TABLE_POLICY_MODES.REST_FULL,
    Projets2: core.TABLE_POLICY_MODES.REST_FULL,
    "Time-Out": core.TABLE_POLICY_MODES.REST_FULL,
    Time_Out: core.TABLE_POLICY_MODES.REST_FULL,
    TimeOut: core.TABLE_POLICY_MODES.REST_FULL,
    Timesheet: core.TABLE_POLICY_MODES.REST_FULL,
    Ventilation: core.TABLE_POLICY_MODES.REST_FULL,
    MsProject: core.TABLE_POLICY_MODES.REST_FULL,
    Planning_Project: core.TABLE_POLICY_MODES.REST_FULL,
    "ListePlan NDC+COF": core.TABLE_POLICY_MODES.REST_FULL,
    "ListePlan_NDC+COF": core.TABLE_POLICY_MODES.REST_FULL,
    _grist_Tables: core.TABLE_POLICY_MODES.REST_FULL,
    _grist_Tables_column: core.TABLE_POLICY_MODES.REST_FULL,
  };
  Object.entries(expectedModes).forEach(([tableName, mode]) => {
    assert.equal(core.getTablePolicy(tableName).mode, mode, tableName);
  });
  const timeOut = core.buildContextTableFilter("Time-Out", {
    selectedService: "Structure",
    currentProject: PROJECTS[0],
  });
  assert.equal(timeOut.supported, true);
  assert.equal(timeOut.unfiltered, true);
  assert.equal(timeOut.filter, null);
  const msProject = core.buildContextTableFilter("MsProject", {
    selectedService: "Structure",
    currentProject: PROJECTS[0],
  });
  assert.equal(msProject.supported, true);
  assert.equal(msProject.unfiltered, true);
  assert.equal(msProject.filter, null);
  const unknown = core.buildContextTableFilter("TableMetierNonConfiguree", {
    selectedService: "Structure",
    currentProject: PROJECTS[0],
  });
  assert.equal(unknown.mode, core.TABLE_POLICY_MODES.REST_FULL);
  assert.equal(unknown.unfiltered, true);
});

test("une politique future projet uniquement n'invente aucun filtre Service", () => {
  const result = core.buildTableFilterFromPolicy({
    mode: core.TABLE_POLICY_MODES.REST_PROJECT,
    projectColumn: "NomProjet",
    projectIdentity: "name",
  }, {
    selectedService: "Synthese",
    currentProject: PROJECTS[0],
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.filter, {
    NomProjet: ["ERA QUAI D'ORSAY", "Alias ERA"],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result.filter, "Service"), false);
});

test("les filtres REST multiprojets regroupent tous les numéros, noms et alias", () => {
  assert.deepEqual(core.buildContextTableFilter("TimeSegment", {
    selectedService: "Topographie",
    allowedProjects: PROJECTS.slice(0, 3),
    multiProject: true,
  }).filter, {
    Service: ["Topographie"],
    NumeroProjet: ["252035", "2520", "9999"],
  });
  assert.deepEqual(core.buildContextTableFilter("Planning_Projet", {
    selectedService: "Structure",
    allowedProjects: PROJECTS.slice(0, 3),
    multiProject: true,
  }).filter, {
    Service: ["Structure"],
    NomProjet: ["ERA QUAI D'ORSAY", "Alias ERA", "Projet court", "Projet topo"],
  });
});

test("un contexte REST incomplet interdit toute requête métier", () => {
  assert.equal(core.buildContextTableFilter("References2", {
    selectedService: "",
    currentProject: PROJECTS[0],
  }).complete, false);
  assert.equal(core.buildContextTableFilter("Budget", {
    selectedService: "Structure",
    currentProject: null,
  }).complete, false);
});

test("les filtres REST trop longs sont découpés sans perdre leur Service", () => {
  const filter = {
    Service: ["Structure"],
    NumeroProjet: ["1", "2", "3", "4", "5"],
  };
  const chunks = core.splitContextTableFilter(filter, "NumeroProjet", { maxValues: 2 });
  assert.deepEqual(chunks, [
    { Service: ["Structure"], NumeroProjet: ["1", "2"] },
    { Service: ["Structure"], NumeroProjet: ["3", "4"] },
    { Service: ["Structure"], NumeroProjet: ["5"] },
  ]);
  assert.deepEqual(filter.NumeroProjet, ["1", "2", "3", "4", "5"]);
});

test("les enveloppes REST sont converties sans mutation et conservent les types", () => {
  const envelope = {
    records: [
      { id: 1, fields: { Service: "Structure", Nullable: null, Active: false, Amount: 12.5 } },
      { id: 2, fields: { Service: "Structure", Active: true } },
    ],
  };
  const before = structuredClone(envelope);
  assert.deepEqual(core.restRecordsToRows(envelope), [
    { id: 1, Service: "Structure", Nullable: null, Active: false, Amount: 12.5 },
    { id: 2, Service: "Structure", Active: true },
  ]);
  assert.deepEqual(core.restRecordsToTableData(envelope), {
    id: [1, 2],
    Service: ["Structure", "Structure"],
    Nullable: [null, null],
    Active: [false, true],
    Amount: [12.5, null],
  });
  assert.deepEqual(envelope, before);
});

test("la fusion REST déduplique les alias par id et garde un ordre stable", () => {
  const merged = core.mergeRestRecordEnvelopes([
    { records: [{ id: 1, fields: { Name: "A" } }, { id: 2, fields: { Name: "B" } }] },
    { records: [{ id: 2, fields: { Name: "B bis" } }, { id: 3, fields: { Name: "C" } }] },
  ]);
  assert.deepEqual(core.restRecordsToRows(merged), [
    { id: 1, Name: "A" },
    { id: 2, Name: "B" },
    { id: 3, Name: "C" },
  ]);
});
