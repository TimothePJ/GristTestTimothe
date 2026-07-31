const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../service-context-core.js");

const runtimePath = path.join(__dirname, "..", "grist-service-context.js");
const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const referenceSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "Reference2", "js", "legacy.js"),
  "utf8"
);
const referenceCssSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "Reference2", "css", "style.css"),
  "utf8"
);

function createRuntimeHarness({ admin = false } = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const storage = new Map();
  const fetchCounts = new Map();
  let nativeRecordsCallback = null;
  let nativeOnRecordsCount = 0;
  let reloadCount = 0;

  const tables = {
    Team: {
      id: [1],
      Prenom: ["Alice"],
      Nom: ["Martin"],
      PrenomNom: ["Alice Martin"],
      Moi: [true],
      Service: ["Structure"],
      Admin: [admin],
      Projets_Access: ["100|Alpha\n200|Beta"],
    },
    Projets2: {
      id: [10, 11, 20, 30],
      Numero_de_projet: ["100", "100", "200", "300"],
      Nom_de_projet: ["Alpha", "Alpha Alias", "Beta", "Gamma"],
    },
    ProjectTeam: { id: [], NumeroProjet: [], Name: [], Role: [] },
    Emetteurs: { id: [1], Emetteurs: ["BET"] },
  };

  class HTMLElement {}
  class HTMLSelectElement extends HTMLElement {}
  class HTMLButtonElement extends HTMLElement {}
  class HTMLDataListElement extends HTMLElement {}
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const document = {
    body: null,
    head: { appendChild() {} },
    readyState: "complete",
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() { return new HTMLElement(); },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
  };

  const nativeFetchTable = async (tableName) => {
    fetchCounts.set(tableName, (fetchCounts.get(tableName) || 0) + 1);
    if (!Object.prototype.hasOwnProperty.call(tables, tableName)) {
      throw new Error(`Table inconnue: ${tableName}`);
    }
    return tables[tableName];
  };
  const grist = {
    docApi: {
      fetchTable: nativeFetchTable,
      async applyUserActions() { return null; },
    },
    onRecords(callback) {
      nativeOnRecordsCount += 1;
      nativeRecordsCallback = callback;
      return undefined;
    },
    onRecord() { return () => {}; },
  };
  const window = {
    GristServiceContextCore: core,
    grist,
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    location: { reload() { reloadCount += 1; } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      (windowListeners.get(event.type) || []).forEach((listener) => listener(event));
      return true;
    },
  };

  vm.runInNewContext(runtimeSource, {
    window,
    document,
    CustomEvent,
    HTMLElement,
    HTMLSelectElement,
    HTMLButtonElement,
    HTMLDataListElement,
    MutationObserver: class { observe() {} },
    console,
    Date,
    Map,
    Set,
    Promise,
  }, { filename: runtimePath });

  return {
    api: window.GristServiceContext,
    grist,
    tables,
    fetchCount: (tableName) => fetchCounts.get(tableName) || 0,
    nativeOnRecordsCount: () => nativeOnRecordsCount,
    reloadCount: () => reloadCount,
    emitRecords(records, mappings = null) {
      assert.ok(nativeRecordsCallback, "un abonnement Grist natif doit être installé");
      nativeRecordsCallback(records, mappings);
    },
    dispatch(type, detail = {}) {
      (windowListeners.get(type) || []).forEach((listener) => listener({ type, ...detail }));
    },
  };
}

async function flushAsyncWork(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createReferenceUiHarness() {
  class FakeClassList {
    constructor() { this.values = new Set(); }
    toggle(name, force) {
      if (force) this.values.add(name);
      else this.values.delete(name);
      return Boolean(force);
    }
    contains(name) { return this.values.has(name); }
  }
  class HTMLElement {
    constructor(tagName = "DIV", type = "") {
      this.tagName = tagName;
      this.type = type;
      this.dataset = {};
      this.classList = new FakeClassList();
      this.attributes = new Map();
      this.disabled = false;
      this.readOnly = false;
      this.textContent = "";
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
  }

  const controls = new Map([
    ["firstColumnDropdown", new HTMLElement("SELECT")],
    ["thirdColumnDropdown", new HTMLElement("SELECT")],
    ["zoneDropdown", new HTMLElement("SELECT")],
    ["secondColumnListbox", new HTMLElement("SELECT")],
  ]);
  const textField = new HTMLElement("INPUT", "text");
  const writeButton = new HTMLElement("BUTTON", "button");
  writeButton.id = "confirmAddRowButton";
  writeButton.textContent = "Ajouter";
  const locallyDisabledButton = new HTMLElement("BUTTON", "button");
  locallyDisabledButton.id = "confirmEditRowButton";
  locallyDisabledButton.textContent = "Enregistrer";
  locallyDisabledButton.disabled = true;
  const cancelButton = new HTMLElement("BUTTON", "button");
  cancelButton.id = "cancelAddRowButton";
  cancelButton.textContent = "Annuler";
  const addOption = new HTMLElement("OPTION");
  const body = new HTMLElement("BODY");
  let currentState = {
    currentProject: { number: "100", name: "Alpha", names: ["Alpha", "Alpha Alias"] },
    projectAliases: ["Alpha", "Alpha Alias"],
    selectedService: "Structure",
    homeService: "Structure",
    accessMode: "editable",
    generation: 1,
  };
  const document = {
    body,
    getElementById: (id) => controls.get(id) || null,
    querySelector(selector) {
      return selector.includes('option[value="addDocuments"]') ? addOption : null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith("dialog input")) return [textField];
      if (selector === "dialog button") {
        return [writeButton, locallyDisabledButton, cancelButton];
      }
      return [];
    },
  };
  const context = {
    window: {
      GristServiceContextCore: core,
      GristServiceContext: { getState: () => currentState },
    },
    document,
    HTMLElement,
    MutationObserver: class { observe() {} },
    Promise,
    _norm: (value) => String(value ?? "").trim(),
  };
  const uiSnippet = referenceSource.slice(
    referenceSource.indexOf("let activeReferenceContextSnapshot"),
    referenceSource.indexOf("function normalizeReferenceDocumentIdentityInput")
  );
  vm.runInNewContext(
    `${uiSnippet}\n` +
      `globalThis.__referenceUi = {` +
      `createReferenceContextSnapshot, applyReferenceAccessUi, ` +
      `setReferenceControlDisabledReason, isReferenceContextSnapshotCurrent };`,
    context
  );
  return {
    api: context.__referenceUi,
    body,
    controls,
    textField,
    writeButton,
    locallyDisabledButton,
    cancelButton,
    addOption,
    setState(nextState) { currentState = { ...currentState, ...nextState }; },
    snapshot() { return context.__referenceUi.createReferenceContextSnapshot(currentState); },
  };
}

const RAW_REFERENCE_RECORDS = [
  { id: 1, NomProjet: "Alpha", Service: "Structure", Reference: "A" },
  { id: 2, NomProjet: "Alpha Alias", Service: "Structure", Reference: "AA" },
  { id: 3, NomProjet: " Alpha Alias ", Service: " Synthèse\u00a0", Reference: "A-S" },
  { id: 4, NomProjet: "Alpha", Service: "Topographie", Reference: "A-T" },
  { id: 5, NomProjet: "Beta", Service: "Structure", Reference: "B" },
  { id: 6, NomProjet: "Beta", Service: "Synthese", Reference: "B-S" },
  { id: 7, NomProjet: "Beta", Service: "Topographie", Reference: "B-T" },
  { id: 8, NomProjet: "Gamma", Service: "Structure", Reference: "G" },
];

test("le runtime conserve les accesseurs Grist et multiplexe onRecords", async () => {
  assert.doesNotMatch(runtimeSource, /\bgrist\.onRecords\s*=/);
  assert.doesNotMatch(runtimeSource, /\bgrist\.onRecord\s*=/);
  const harness = createRuntimeHarness();
  harness.api.onRecords(() => {});
  harness.api.onRecords(() => {});
  assert.equal(harness.nativeOnRecordsCount(), 1);
  await harness.api.whenReady();
});

test("la sélection centrale est immédiate, sans reload, et re-filtre les records bruts", async () => {
  const harness = createRuntimeHarness();
  const deliveries = [];
  harness.api.onRecords((records) => deliveries.push(records.map((record) => record.Reference)));
  await harness.api.whenReady();
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.deepEqual(deliveries.at(-1), ["A", "AA"]);

  const selection = harness.api.selectProject("Beta");
  assert.equal(harness.api.getCurrentProject().number, "200");
  await selection;
  assert.deepEqual(deliveries.at(-1), ["B"]);
  assert.equal(harness.reloadCount(), 0);
  assert.doesNotMatch(runtimeSource, /location\.reload\s*\(/);
});

test("un projet non autorisé est rejeté, tandis qu'un admin peut tout sélectionner", async () => {
  const member = createRuntimeHarness();
  await member.api.whenReady();
  await assert.rejects(member.api.selectProject("Gamma"), /pas autorisé/);
  assert.equal(member.api.getCurrentProject().number, "100");

  const admin = createRuntimeHarness({ admin: true });
  await admin.api.whenReady();
  await admin.api.selectProject("Gamma");
  assert.equal(admin.api.getCurrentProject().number, "300");
});

test("les alias d'un NumeroProjet convergent vers le même groupe canonique", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  const byAlias = await harness.api.selectProject("Alpha Alias");
  const byId = await harness.api.selectProject({ projectId: 11 });
  assert.equal(byAlias.currentProject.number, "100");
  assert.equal(byId.currentProject.number, "100");
  assert.equal(byAlias.currentProject.id, byId.currentProject.id);
  assert.deepEqual(Array.from(byId.currentProject.names), ["Alpha", "Alpha Alias"]);
});

test("le service personnel reste editable et les autres services readonly", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  assert.equal(harness.api.getAccessMode(), "editable");
  await harness.api.selectService("Synthese");
  assert.equal(harness.api.getAccessMode(), "readonly");
  await harness.api.selectService("Structure");
  assert.equal(harness.api.getAccessMode(), "editable");
});

test("onServiceChange ne signale que les changements de service", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  const transitions = [];
  const unsubscribe = harness.api.onServiceChange((contextState, transition) => {
    transitions.push({
      previousService: transition.previousService,
      selectedService: contextState.selectedService,
      projectNumber: contextState.currentProject?.number || "",
    });
  });

  await harness.api.selectProject("Beta");
  assert.deepEqual(transitions, []);
  await harness.api.selectService("Synthese");
  assert.deepEqual(transitions, [{
    previousService: "Structure",
    selectedService: "Synthese",
    projectNumber: "200",
  }]);

  unsubscribe();
  await harness.api.selectService("Structure");
  assert.equal(transitions.length, 1);
});

test("onServiceChange peut fournir immediatement le service courant", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  const services = [];
  harness.api.onServiceChange((contextState) => {
    services.push(contextState.selectedService);
  }, { immediate: true });
  assert.deepEqual(services, ["Structure"]);
});

test("les trois services re-filtrent immédiatement les mêmes records bruts", async () => {
  const harness = createRuntimeHarness();
  const deliveries = [];
  harness.api.onRecords((records, _mappings, delivery) => {
    deliveries.push({
      service: delivery.context.selectedService,
      mode: delivery.context.accessMode,
      references: records.map((record) => record.Reference),
      snapshotRecords: delivery.context.records.map((record) => record.Reference),
    });
  });
  await harness.api.whenReady();
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.deepEqual(deliveries.at(-1), {
    service: "Structure",
    mode: "editable",
    references: ["A", "AA"],
    snapshotRecords: ["A", "AA"],
  });

  await harness.api.selectService("Synthèse");
  assert.deepEqual(deliveries.at(-1), {
    service: "Synthese",
    mode: "readonly",
    references: ["A-S"],
    snapshotRecords: ["A-S"],
  });

  await harness.api.selectService("Topographie");
  assert.deepEqual(deliveries.at(-1), {
    service: "Topographie",
    mode: "readonly",
    references: ["A-T"],
    snapshotRecords: ["A-T"],
  });
});

test("chaque livraison porte un snapshot projet, alias, service, mode et génération cohérents", async () => {
  const harness = createRuntimeHarness();
  let lastDelivery = null;
  harness.api.onRecords((_records, _mappings, delivery) => { lastDelivery = delivery; });
  await harness.api.whenReady();
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  await harness.api.selectService("Synthese");
  assert.equal(lastDelivery.generation, harness.api.getState().generation);
  assert.equal(lastDelivery.context.currentProject.number, "100");
  assert.deepEqual(Array.from(lastDelivery.context.projectAliases), ["Alpha", "Alpha Alias"]);
  assert.equal(lastDelivery.context.selectedService, "Synthese");
  assert.equal(lastDelivery.context.homeService, "Structure");
  assert.equal(lastDelivery.context.accessMode, "readonly");
  assert.deepEqual(lastDelivery.context.records.map((record) => record.Reference), ["A-S"]);
});

test("une réponse tardive de A ne remplace pas B", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  harness.api.onRecords(() => {});
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  await harness.api.selectProject("Beta");

  let releaseAlpha;
  const alphaGate = new Promise((resolve) => { releaseAlpha = resolve; });
  let latestGeneration = 0;
  let renderedProject = "";
  harness.api.onRecords(async (records, _mappings, delivery) => {
    latestGeneration = Math.max(latestGeneration, delivery.generation);
    const deliveredProject = records[0]?.NomProjet || "";
    if (deliveredProject === "Alpha") await alphaGate;
    if (delivery.generation === latestGeneration) renderedProject = deliveredProject;
  });

  const selectAlpha = harness.api.selectProject("Alpha");
  await Promise.resolve();
  const selectBeta = harness.api.selectProject("Beta");
  await selectBeta;
  releaseAlpha();
  await selectAlpha;
  assert.equal(harness.api.getCurrentProject().number, "200");
  assert.equal(renderedProject, "Beta");
});

test("A/Synthese puis B/Structure conserve uniquement le contexte final", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  harness.api.onRecords(() => {});
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();

  let releaseOldContext;
  const oldContextGate = new Promise((resolve) => { releaseOldContext = resolve; });
  let lastAccepted = null;
  harness.api.onRecords(async (records, _mappings, delivery) => {
    if (
      delivery.context.currentProject.number === "100" &&
      delivery.context.selectedService === "Synthese"
    ) await oldContextGate;
    const current = harness.api.getState();
    if (
      delivery.generation === current.generation &&
      delivery.context.currentProject.number === current.currentProject.number &&
      delivery.context.selectedService === current.selectedService
    ) {
      lastAccepted = {
        project: delivery.context.currentProject.number,
        service: delivery.context.selectedService,
        references: records.map((record) => record.Reference),
      };
    }
  });

  const oldSelection = harness.api.selectService("Synthese");
  await Promise.resolve();
  await harness.api.selectProject("Beta");
  await harness.api.selectService("Structure");
  releaseOldContext();
  await oldSelection;

  assert.deepEqual(lastAccepted, {
    project: "200",
    service: "Structure",
    references: ["B"],
  });
});

test("Projets2 partage sa requête et les focus répétés respectent le TTL", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  assert.equal(harness.fetchCount("Projets2"), 1);
  harness.api.invalidateCache("Projets2");
  await Promise.all([
    harness.grist.docApi.fetchTable("Projets2"),
    harness.grist.docApi.fetchTable("Projets2"),
    harness.grist.docApi.fetchTable("Projets2"),
  ]);
  assert.equal(harness.fetchCount("Projets2"), 2);

  const countsBeforeFocus = ["Team", "Projets2", "ProjectTeam"].map(harness.fetchCount);
  harness.dispatch("focus");
  harness.dispatch("focus");
  harness.dispatch("focus");
  await flushAsyncWork();
  assert.deepEqual(["Team", "Projets2", "ProjectTeam"].map(harness.fetchCount), countsBeforeFocus);
});

test("le signal d'affectation invalide le cache et reconstruit l'index d'accès", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  assert.deepEqual(harness.api.getAllowedProjects().map((project) => project.number), ["100", "200"]);
  harness.tables.ProjectTeam = {
    id: [1],
    NumeroProjet: ["300"],
    Name: ["Alice Martin"],
    Role: ["Ingénieur"],
  };
  harness.dispatch("storage", { key: core.ACCESS_CHANGED_STORAGE_KEY, newValue: "changed" });
  await flushAsyncWork();
  assert.deepEqual(harness.api.getAllowedProjects().map((project) => project.number), ["100", "200", "300"]);
  assert.equal(harness.fetchCount("Team"), 2);
  assert.equal(harness.fetchCount("ProjectTeam"), 2);
});

test("Reference2 centralise sélection, abonnement et caches réseau", () => {
  assert.equal((referenceSource.match(/GristServiceContext\.onRecords\s*\(/g) || []).length, 1);
  assert.equal(
    (referenceSource.match(/referenceProjectDropdown\.addEventListener\('change'/g) || []).length,
    1
  );
  assert.doesNotMatch(referenceSource, /localStorage\.(?:setItem|removeItem)\(SHARED_PROJECT/);
  assert.match(referenceSource, /referenceProjectChangeGeneration/);
  assert.match(referenceSource, /projetsTableCachePromise/);
  assert.match(referenceSource, /defaultEmetteursCache/);
  assert.match(referenceSource, /cached\?\.promise/);
  assert.match(referenceSource, /function applyReferenceAccessUi\(/);
  assert.match(referenceSource, /function isReferenceContextSnapshotCurrent\(/);
  assert.match(referenceSource, /contextSnapshot\.selectedService/);
  assert.doesNotMatch(referenceSource, /if \(referenceProjectChangeInFlight\) return/);
});

test("Reference2 applique les couleurs depuis accessMode et non depuis disabled", () => {
  const harness = createReferenceUiHarness();
  assert.equal(harness.api.applyReferenceAccessUi(harness.snapshot()), true);
  assert.equal(harness.body.dataset.referenceAccessMode, "editable");
  assert.equal(
    harness.controls.get("secondColumnListbox").classList.contains("reference-control-editable"),
    true
  );

  harness.setState({ selectedService: "Synthese", accessMode: "readonly", generation: 2 });
  assert.equal(harness.api.applyReferenceAccessUi(harness.snapshot()), true);
  assert.equal(harness.body.dataset.referenceAccessMode, "readonly");
  assert.equal(
    harness.controls.get("secondColumnListbox").classList.contains("reference-control-readonly"),
    true
  );
  assert.equal(harness.controls.get("secondColumnListbox").disabled, false);
  assert.match(referenceCssSource, /data-reference-access-mode="editable"/);
  assert.match(referenceCssSource, /data-reference-access-mode="readonly"/);
  assert.match(referenceCssSource, /option:checked/);
});

test("les listes fermées readonly restent contrastées et seules leurs options sont pâles", () => {
  assert.match(
    runtimeSource,
    /data-grist-service-readonly="true"[^\n]+select:not\(\[data-grist-service-selector\]\)/
  );
  assert.match(runtimeSource, /opacity:1!important;background-color:#fff7e8!important/);
  assert.match(runtimeSource, /option,[\s\S]*background-color:#fffaf3!important/);
  assert.match(runtimeSource, /option:checked[^\n]+#ffedcc/);
  assert.match(runtimeSource, /\.checkbox-dropdown-button/);
  assert.match(runtimeSource, /\.checkbox-dropdown \.checkbox-list:not\(\[hidden\]\)/);
  assert.match(
    referenceCssSource,
    /data-reference-access-mode="readonly"[^}]+data-reference-disabled-loading[^}]+opacity: 1 !important;/s
  );
});

test("Reference2 sépare chargement, absence de sélection et lecture seule", () => {
  const harness = createReferenceUiHarness();
  const listbox = harness.controls.get("secondColumnListbox");
  harness.api.setReferenceControlDisabledReason(listbox, "loading", true);
  harness.api.applyReferenceAccessUi(harness.snapshot());
  assert.equal(listbox.disabled, true);
  assert.equal(listbox.dataset.referenceDisabledLoading, "true");
  assert.equal(harness.body.dataset.referenceAccessMode, "editable");

  harness.api.setReferenceControlDisabledReason(listbox, "loading", false);
  harness.api.setReferenceControlDisabledReason(listbox, "empty", true);
  assert.equal(listbox.disabled, true);
  assert.equal(listbox.dataset.referenceDisabledEmpty, "true");

  harness.api.setReferenceControlDisabledReason(listbox, "empty", false);
  harness.setState({ selectedService: "Synthese", accessMode: "readonly", generation: 2 });
  harness.api.applyReferenceAccessUi(harness.snapshot());
  assert.equal(listbox.disabled, false, "la navigation reste disponible en lecture seule");
  assert.equal(listbox.dataset.referenceAccessMode, "readonly");
});

test("Reference2 désactive l'écriture hors service personnel puis restaure l'état local", () => {
  const harness = createReferenceUiHarness();
  harness.api.applyReferenceAccessUi(harness.snapshot());
  assert.equal(harness.writeButton.disabled, false);

  harness.setState({ selectedService: "Topographie", accessMode: "readonly", generation: 2 });
  harness.api.applyReferenceAccessUi(harness.snapshot());
  assert.equal(harness.writeButton.disabled, true);
  assert.equal(harness.textField.readOnly, true);
  assert.equal(harness.addOption.disabled, true);
  assert.equal(harness.cancelButton.disabled, false);

  harness.setState({ selectedService: "Structure", accessMode: "editable", generation: 3 });
  harness.api.applyReferenceAccessUi(harness.snapshot());
  assert.equal(harness.writeButton.disabled, false);
  assert.equal(harness.textField.readOnly, false);
  assert.equal(harness.addOption.disabled, false);
  assert.equal(
    harness.locallyDisabledButton.disabled,
    true,
    "une désactivation métier ne doit pas être effacée par le changement de mode"
  );
});

test("Reference2 refuse un snapshot visuel obsolète", () => {
  const harness = createReferenceUiHarness();
  const stale = harness.snapshot();
  harness.setState({ selectedService: "Synthese", accessMode: "readonly", generation: 2 });
  assert.equal(harness.api.applyReferenceAccessUi(stale), false);
  assert.notEqual(harness.body.dataset.referenceAccessMode, "editable");
  assert.equal(harness.api.applyReferenceAccessUi(harness.snapshot()), true);
  assert.equal(harness.body.dataset.referenceAccessMode, "readonly");
});

test("Reference2 partage les lectures Emetteurs et Projets2 déjà en cours", async () => {
  let emitterFetchCount = 0;
  let resolveEmitterFetch;
  const emitterFetch = new Promise((resolve) => { resolveEmitterFetch = resolve; });
  const emitterContext = {
    window: {
      GristServiceContext: {
        getState: () => ({ currentProject: { number: "100" }, selectedService: "Structure" }),
      },
    },
    grist: {
      docApi: {
        fetchTable: async (tableName) => {
          assert.equal(tableName, "Emetteurs");
          emitterFetchCount += 1;
          return emitterFetch;
        },
      },
    },
    getUniqueEmetteurs: (values) => [...new Set(values)],
    isReferenceLookupCacheFresh: () => true,
    console,
  };
  const emitterSnippet = referenceSource.slice(
    referenceSource.indexOf("async function fetchDefaultEmetteurs("),
    referenceSource.indexOf("async function getTeamService(")
  );
  vm.runInNewContext(
    `${emitterSnippet}\nglobalThis.__emitterCacheApi = { getDefaultEmetteurs };`,
    emitterContext
  );
  const emitterRequests = [
    emitterContext.__emitterCacheApi.getDefaultEmetteurs(),
    emitterContext.__emitterCacheApi.getDefaultEmetteurs(),
    emitterContext.__emitterCacheApi.getDefaultEmetteurs(),
  ];
  assert.equal(emitterFetchCount, 1);
  resolveEmitterFetch({ Emetteurs: ["BET", "BET"] });
  assert.deepEqual(Array.from(await Promise.all(emitterRequests))[0], ["BET"]);

  let projectsFetchCount = 0;
  let resolveProjectsFetch;
  const projectsFetch = new Promise((resolve) => { resolveProjectsFetch = resolve; });
  const projectsContext = {
    window: { GristServiceContext: { invalidateCache() {} } },
    grist: {
      docApi: {
        fetchTable: async (tableName) => {
          assert.equal(tableName, "Projets2");
          projectsFetchCount += 1;
          return projectsFetch;
        },
      },
    },
    Date,
  };
  const projectsSnippet = referenceSource.slice(
    referenceSource.indexOf("function isReferenceLookupCacheFresh("),
    referenceSource.indexOf("function populateDocumentTypeDatalist(")
  );
  vm.runInNewContext(
    `const REFERENCE_LOOKUP_CACHE_TTL_MS = 45000;\n` +
      `let projetsTableCache = null;\nlet projetsTableCachePromise = null;\n` +
      `let projetsTableCacheLoadedAt = 0;\n${projectsSnippet}\n` +
      `globalThis.__projectsCacheApi = { refreshProjectsTableCache };`,
    projectsContext
  );
  const projectRequests = [
    projectsContext.__projectsCacheApi.refreshProjectsTableCache(),
    projectsContext.__projectsCacheApi.refreshProjectsTableCache(),
    projectsContext.__projectsCacheApi.refreshProjectsTableCache(),
  ];
  assert.equal(projectsFetchCount, 1);
  resolveProjectsFetch({ id: [10] });
  await Promise.all(projectRequests);
});

test("le contrôleur Reference2 conserve B quand la sélection A se termine après", async () => {
  const pendingSelections = new Map();
  let currentState = {
    currentProject: { number: "000", name: "Initial", names: ["Initial"] },
    selectedService: "Structure",
    homeService: "Structure",
    accessMode: "editable",
    generation: 0,
  };
  const elements = new Map();
  const makeControl = () => ({
    value: "",
    disabled: false,
    setAttribute() {},
    replaceChildren() {},
  });
  [
    "firstColumnDropdown",
    "secondColumnListbox",
    "thirdColumnDropdown",
    "zoneDropdown",
    "tableBody",
    "tableHeader",
  ].forEach((id) => elements.set(id, makeControl()));
  elements.get("firstColumnDropdown").value = "Initial";

  const controllerContext = {
    window: {
      GristServiceContext: {
        selectProject(projectName) {
          currentState = {
            ...currentState,
            currentProject: {
              number: projectName === "Alpha" ? "100" : "200",
              name: projectName,
              names: [projectName],
            },
            generation: currentState.generation + 1,
          };
          const requestedState = currentState;
          return new Promise((resolve) => pendingSelections.set(projectName, () => resolve(requestedState)));
        },
        getState: () => currentState,
      },
      GristServiceContextCore: core,
    },
    document: {
      getElementById: (id) => elements.get(id) || null,
      createElement: () => makeControl(),
    },
    _norm: (value) => String(value || "").trim(),
    activeReferenceContextSnapshot: null,
    createReferenceContextSnapshot: (state = currentState) => ({
      currentProject: state.currentProject,
      projectNumber: state.currentProject.number,
      projectAliases: state.currentProject.names,
      selectedService: state.selectedService,
      homeService: state.homeService,
      accessMode: state.accessMode,
      generation: state.generation,
      records: [],
    }),
    isReferenceContextSnapshotCurrent: (snapshot) => (
      snapshot.projectNumber === currentState.currentProject.number &&
      snapshot.selectedService === currentState.selectedService &&
      snapshot.generation === currentState.generation
    ),
    setReferenceControlDisabledReason(control, reason, active) {
      control[`disabledBy${reason}`] = active;
      control.disabled = active;
    },
    applyReferenceAccessUi() {},
    updateReferenceList() {},
    updateEditReferenceList() {},
    populateTypeDocumentDropdown() {},
    populateZoneDropdown() {},
    populateSecondColumnListbox() {},
    async updateEmetteurList() {},
    scheduleReferenceRetardReconciliation() {},
    showReferenceToast() {},
    REFERENCE_ALL_ZONES_VALUE: "__ALL_ZONES__",
    DOC_SELECT_PLACEHOLDER_HTML: '<option value="">Document</option>',
  };
  const controllerSnippet = referenceSource.slice(
    referenceSource.indexOf("let referenceProjectChangeGeneration"),
    referenceSource.indexOf("const referenceProjectDropdown")
  );
  vm.runInNewContext(
    `let selectedFirstValue = 'Initial';\n` +
      `let selectedTypeValue = '';\nlet selectedSecondValue = '';\n` +
      `let lastValidDocument = '';\nlet selectedZoneValue = REFERENCE_ALL_ZONES_VALUE;\n` +
      `let selectedDocName = '';\nlet selectedDocNumber = null;\nlet selectedDocZone = '';\n` +
      `${controllerSnippet}\n` +
      `globalThis.__controllerApi = { handleReferenceProjectChange, selected: () => selectedFirstValue };`,
    controllerContext
  );

  const selectA = controllerContext.__controllerApi.handleReferenceProjectChange("Alpha");
  const selectB = controllerContext.__controllerApi.handleReferenceProjectChange("Beta");
  pendingSelections.get("Beta")();
  await selectB;
  pendingSelections.get("Alpha")();
  await selectA;
  assert.equal(controllerContext.__controllerApi.selected(), "Beta");
  assert.equal(elements.get("firstColumnDropdown").value, "Beta");
});

test("le runtime protège les écritures métier et cible les invalidations", () => {
  assert.match(runtimeSource, /core\.filterProjectsRaw\(raw, contextSnapshot\.allowedProjects\)/);
  assert.match(runtimeSource, /some\(core\.isProtectedMutationAction\)/);
  assert.match(runtimeSource, /validateProtectedMutationTargets/);
  assert.match(runtimeSource, /core\.rowMatchesContext/);
  assert.match(runtimeSource, /core\.ACCESS_CHANGED_STORAGE_KEY/);
  assert.match(runtimeSource, /function buildAccessIndex\(\)/);
  assert.match(runtimeSource, /state\.unresolvedProjectTeamCount/);
  assert.match(runtimeSource, /snapshot\.generation !== selectionGeneration/);
});

test("les widgets partagés conservent des sélecteurs reconnus par le runtime", () => {
  const widgetSelectors = [
    ["Reference2/index.html", "firstColumnDropdown"],
    ["EnAttente/index.html", "firstColumnDropdown"],
    ["ListeDePlan/index.html", "projectDropdown"],
    ["Bordereau/bordereau.html", "projectDropdown"],
    ["Planning Projet/index.html", "projectDropdown"],
    ["Avancement/index.html", "projectDropdown"],
    ["planning-synchro/index.html", "ps-project-select"],
    ["gestion-depenses2/index.html", "project-select"],
  ];
  widgetSelectors.forEach(([relativePath, selectorId]) => {
    const html = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(html, /shared\/grist-service-context\.js/);
    assert.match(html, new RegExp(`id=["']${selectorId}["']`));
    assert.match(runtimeSource, new RegExp(`#${selectorId.replace(/-/g, "\\-")}`));
  });

  ["Gestion-globale/index.html", "Gestion-User/index.html"].forEach((relativePath) => {
    const html = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(html, /shared\/grist-service-context\.js/);
    assert.match(html, /data-service-context-multiproject/);
  });
});

test("les widgets de production délèguent la sélection projet au runtime", () => {
  const centralizedWidgets = [
    "Reference2/js/legacy.js",
    "EnAttente/js/script.js",
    "Bordereau/bordereau.js",
    "Avancement/js/avancement.js",
    "ListeDePlan/script.js",
    "ListeDePlan/avancement.js",
    "Planning Projet/assets/js/state.js",
    "gestion-depenses2/assets/js/main.js",
  ];
  centralizedWidgets.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(source, /GristServiceContext\.selectProject/);
    assert.doesNotMatch(
      source,
      /localStorage\.(?:setItem|removeItem)\((?:SHARED_PROJECT_(?:STORAGE|ID_STORAGE)_KEY|LS_KEYS\.SHARED_PROJECT|APP_CONFIG\.sharedProjectStorageKey|'grist\.selected-project(?:-id)?')/
    );
  });

  const registrySource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "planning-synchro/assets/js/services/projectRegistry.js"
    ),
    "utf8"
  );
  assert.match(registrySource, /runtime\?\.selectProject/);
  assert.match(registrySource, /runtime\.selectProject/);
});

test("les widgets multi-tables rechargent leurs donnees au changement de service", () => {
  const widgets = [
    "planning-synchro/assets/js/main.js",
    "Planning Projet/assets/js/main.js",
    "gestion-depenses2/assets/js/main.js",
    "Gestion-globale/assets/js/main.js",
    "Gestion-User/assets/js/app.js",
  ];
  widgets.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(source, /onServiceChange/, `${relativePath} doit ecouter le service partage`);
  });

  const guardedWidgets = [
    "planning-synchro/assets/js/main.js",
    "gestion-depenses2/assets/js/main.js",
    "Gestion-globale/assets/js/main.js",
    "Gestion-User/assets/js/app.js",
  ];
  guardedWidgets.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(
      source,
      /(?:loadSeq|LoadGeneration)/,
      `${relativePath} doit ignorer les chargements devenus obsoletes`
    );
  });
});
