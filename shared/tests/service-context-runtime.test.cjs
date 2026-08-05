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

function createRuntimeHarness({
  admin = false,
  multiProject = false,
  rest = false,
  restFetch = null,
  restProbeFetch = null,
  restProbeRecords = [{ id: 10, fields: { Numero_de_projet: "100", Nom_de_projet: "Alpha" } }],
  restTableProbeFetch = null,
  restTableProbeRecords = [{ id: 999, fields: {} }],
  accessTokenFactory = null,
  applyUserActions = null,
} = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const storage = new Map();
  const fetchCounts = new Map();
  let nativeRecordsCallback = null;
  let nativeOnRecordsCount = 0;
  let reloadCount = 0;
  let accessTokenCount = 0;
  const restRequests = [];
  const restProbeRequests = [];
  const restTableProbeRequests = [];
  const storageWrites = [];
  const consoleEntries = [];
  const sandboxConsole = {
    info(...args) { consoleEntries.push(["info", ...args]); },
    warn(...args) { consoleEntries.push(["warn", ...args]); },
    error(...args) { consoleEntries.push(["error", ...args]); },
  };

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
    body: multiProject ? {
      dataset: {},
      hasAttribute(name) { return name === "data-service-context-multiproject"; },
    } : null,
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
      async applyUserActions(actions) {
        return typeof applyUserActions === "function" ? applyUserActions(actions) : null;
      },
    },
    onRecords(callback) {
      nativeOnRecordsCount += 1;
      nativeRecordsCallback = callback;
      return undefined;
    },
    onRecord() { return () => {}; },
  };
  if (rest) {
    grist.docApi.getAccessToken = async (options) => {
      accessTokenCount += 1;
      if (typeof accessTokenFactory === "function") {
        return accessTokenFactory(options, accessTokenCount);
      }
      return {
        baseUrl: "https://grist.invalid/api/docs/test-doc",
        token: `temporary-token-${accessTokenCount}`,
        ttlMsecs: 60000,
      };
    };
  }
  const window = {
    GristServiceContextCore: core,
    grist,
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) {
        storageWrites.push(["set", key, String(value)]);
        storage.set(key, String(value));
      },
      removeItem(key) {
        storageWrites.push(["remove", key]);
        storage.delete(key);
      },
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
  if (rest) {
    window.fetch = async (url, options) => {
      const request = { url: String(url), options };
      const parsed = new URL(request.url);
      const isVisibilityProbe = parsed.pathname.endsWith("/tables/Projets2/records") &&
        parsed.searchParams.get("limit") === "1" &&
        !parsed.searchParams.has("filter");
      if (isVisibilityProbe) {
        restProbeRequests.push(request);
        if (typeof restProbeFetch === "function") {
          return restProbeFetch(request.url, options, restProbeRequests.length);
        }
        return restResponse(restProbeRecords);
      }
      const isTableVisibilityProbe = parsed.searchParams.get("limit") === "1" &&
        !parsed.searchParams.has("filter");
      if (isTableVisibilityProbe) {
        restTableProbeRequests.push(request);
        if (typeof restTableProbeFetch === "function") {
          return restTableProbeFetch(request.url, options, restTableProbeRequests.length);
        }
        return restResponse(restTableProbeRecords);
      }
      restRequests.push(request);
      if (typeof restFetch === "function") {
        return restFetch(request.url, options, restRequests.length);
      }
      return { ok: true, status: 200, async json() { return { records: [] }; } };
    };
  }

  vm.runInNewContext(runtimeSource, {
    window,
    document,
    CustomEvent,
    HTMLElement,
    HTMLSelectElement,
    HTMLButtonElement,
    HTMLDataListElement,
    MutationObserver: class { observe() {} },
    console: sandboxConsole,
    Date,
    Map,
    Set,
    Promise,
  }, { filename: runtimePath });

  return {
    api: window.GristServiceContext,
    window,
    document,
    grist,
    tables,
    fetchCount: (tableName) => fetchCounts.get(tableName) || 0,
    nativeOnRecordsCount: () => nativeOnRecordsCount,
    accessTokenCount: () => accessTokenCount,
    restRequests,
    restProbeRequests,
    restTableProbeRequests,
    storageWrites,
    consoleEntries,
    reloadCount: () => reloadCount,
    emitRecords(records, mappings = null) {
      assert.ok(nativeRecordsCallback, "un abonnement Grist natif doit être installé");
      nativeRecordsCallback(records, mappings);
    },
    dispatch(type, detail = {}) {
      (windowListeners.get(type) || []).forEach((listener) => listener({ type, ...detail }));
    },
    createProjectSelect(id, value, dataset = {}) {
      const select = new HTMLSelectElement();
      select.id = String(id || "");
      select.value = String(value || "");
      select.dataset = { ...dataset };
      select.matches = (selectors) => String(selectors || "")
        .split(",")
        .map((selector) => selector.trim())
        .includes(`#${select.id}`);
      return select;
    },
    dispatchDocument(type, detail = {}) {
      (documentListeners.get(type) || []).forEach((listener) => listener({ type, ...detail }));
    },
  };
}

async function flushAsyncWork(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function restResponse(records, { status = 200, jsonError = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (jsonError) throw jsonError;
      return { records };
    },
  };
}

function requestFilter(request) {
  const parsed = new URL(request.url);
  return JSON.parse(parsed.searchParams.get("filter"));
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

test("diagnostic: le listener generique ne reconnait pas l'ID porte par #project-select", async () => {
  const harness = createRuntimeHarness();
  await harness.api.whenReady();
  assert.equal(harness.api.getCurrentProject().name, "Alpha");

  const select = harness.createProjectSelect("project-select", "20");
  harness.dispatchDocument("change", { target: select });
  await flushAsyncWork();

  assert.equal(
    harness.api.getCurrentProject().name,
    "Alpha",
    "la valeur 20 est l'ID Grist de Beta, mais le listener generique la traite comme un nom ou un numero"
  );
});

test("gestion-depenses2 transmet toutefois l'ID et le nom qui produisent les bons filtres REST", async () => {
  const harness = createRuntimeHarness({ rest: true });
  await harness.api.whenReady();

  // Reproduit saveSharedProjectSelection(name, id) appele par le gestionnaire du widget.
  const selection = harness.api.selectProject({ projectId: 20, projectName: "Beta" });
  assert.equal(harness.api.getCurrentProject().name, "Beta");
  await selection;

  await harness.api.fetchContextTable("References2", { forceRefresh: true });
  await harness.api.fetchContextTable("Budget", { forceRefresh: true });

  assert.deepEqual(requestFilter(harness.restRequests[0]), {
    Service: ["Structure"],
    NomProjet: ["Beta"],
  });
  assert.deepEqual(requestFilter(harness.restRequests[1]), {
    Service: ["Structure"],
    NumeroProjet: ["200"],
  });
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

test("Reference2 centralise sélection, watcher filtré et caches réseau", () => {
  assert.equal((referenceSource.match(/GristServiceContext\.watchContextTable\s*\(/g) || []).length, 1);
  assert.doesNotMatch(referenceSource, /GristServiceContext\.onRecords\s*\(/);
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
  assert.match(runtimeSource, /element\.matches\("\[data-service-context-navigation\],/);
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

test("filtered views request full Grist access before their REST token", () => {
  [
    "Reference2/js/legacy.js",
    "ListeDePlan/avancement.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(source, /grist\.ready\(\{\s*requiredAccess:\s*["']full["']\s*\}\)/);
  });
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

test("fetchTable utilise REST avec le filtre encodé et conserve la défense cliente", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Value: null } },
      { id: 2, fields: { Service: "Structure", NomProjet: "Alpha Alias", Value: false } },
      { id: 3, fields: { Service: "Topographie", NomProjet: "Alpha", Value: 42 } },
    ]),
  });
  await harness.api.whenReady();

  const table = await harness.grist.docApi.fetchTable("References2");
  assert.deepEqual(Array.from(table.id), [1, 2]);
  assert.deepEqual(Array.from(table.Value), [null, false]);
  assert.equal(harness.fetchCount("References2"), 0);
  assert.equal(harness.restRequests.length, 1);
  const parsed = new URL(harness.restRequests[0].url);
  assert.match(parsed.pathname, /\/tables\/References2\/records$/);
  assert.equal(parsed.searchParams.get("auth"), "temporary-token-1");
  assert.deepEqual(requestFilter(harness.restRequests[0]), {
    Service: ["Structure"],
    NomProjet: ["Alpha", "Alpha Alias"],
  });
  assert.deepEqual(await harness.api.fetchContextRows("References2"), [
    { id: 1, Service: "Structure", NomProjet: "Alpha", Value: null },
    { id: 2, Service: "Structure", NomProjet: "Alpha Alias", Value: false },
  ]);
  assert.equal(harness.restProbeRequests.length, 1);
  const probeUrl = new URL(harness.restProbeRequests[0].url);
  assert.match(probeUrl.pathname, /\/tables\/Projets2\/records$/);
  assert.equal(probeUrl.searchParams.get("limit"), "1");
  assert.equal(probeUrl.searchParams.has("filter"), false);
  assert.equal(harness.restProbeRequests[0].options.cache, "no-store");
  assert.ok(harness.consoleEntries.some(([level, label]) => (
    level === "info" && String(label).includes("[GristData][REST FILTRE] References2")
  )));
  assert.ok(harness.consoleEntries.some(([level, label]) => (
    level === "info" && String(label).includes("[GristData][CACHE] References2")
  )));
  assert.equal(JSON.stringify(harness.consoleEntries).includes("temporary-token"), false);
});

test("une sonde REST vide en HTTP 200 active le repli brut pour tous les widgets", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restProbeRecords: [],
  });
  harness.tables.References2 = {
    id: [1, 2, 3],
    Service: ["Structure", "Structure", "Topographie"],
    NomProjet: ["Alpha", "Beta", "Alpha"],
    Reference: ["A", "B", "A-T"],
  };
  harness.tables.Budget = {
    id: [7, 8],
    Service: ["Structure", "Structure"],
    NumeroProjet: ["100", "200"],
    Amount: [10, 20],
  };
  await harness.api.whenReady();

  const references = await harness.api.fetchContextTable("References2");
  const budget = await harness.api.fetchContextTable("Budget");

  assert.deepEqual(Array.from(references.id), [1]);
  assert.deepEqual(Array.from(budget.id), [7]);
  assert.equal(harness.restProbeRequests.length, 1);
  assert.equal(harness.restRequests.length, 0);
  assert.equal(harness.fetchCount("References2"), 1);
  assert.equal(harness.fetchCount("Budget"), 1);
  assert.ok(harness.consoleEntries.some(([level, label]) => (
    level === "warn" && String(label).includes("[GristData][FALLBACK FETCHTABLE] References2")
  )));

  await harness.api.selectProject("Beta");
  const betaReferences = await harness.api.fetchContextTable("References2", { forceRefresh: true });
  assert.deepEqual(Array.from(betaReferences.id), [2]);
  assert.equal(
    harness.fetchCount("References2"),
    1,
    "le changement de projet doit reutiliser la table complete deja recue"
  );
  assert.ok(harness.consoleEntries.some(([level, label]) => (
    level === "info" && String(label).includes("[GristData][CACHE FETCHTABLE] References2")
  )));
});

test("une table métier REST vide mais non vide via fetchTable active aussi le repli", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([]),
    restTableProbeRecords: [],
  });
  harness.tables.References2 = {
    id: [1, 2],
    Service: ["Structure", "Structure"],
    NomProjet: ["Alpha", "Beta"],
    Reference: ["A", "B"],
  };
  harness.tables.Budget = {
    id: [7],
    Service: ["Structure"],
    NumeroProjet: ["100"],
    Amount: [10],
  };
  await harness.api.whenReady();

  const references = await harness.api.fetchContextTable("References2");
  const budget = await harness.api.fetchContextTable("Budget");

  assert.deepEqual(Array.from(references.id), [1]);
  assert.deepEqual(Array.from(budget.id), [7]);
  assert.equal(harness.restProbeRequests.length, 1);
  assert.equal(harness.restRequests.length, 1);
  assert.equal(harness.restTableProbeRequests.length, 1);
  const tableProbeUrl = new URL(harness.restTableProbeRequests[0].url);
  assert.match(tableProbeUrl.pathname, /\/tables\/References2\/records$/);
  assert.equal(tableProbeUrl.searchParams.get("limit"), "1");
  assert.equal(harness.restTableProbeRequests[0].options.cache, "no-store");
  assert.equal(harness.fetchCount("References2"), 1);
  assert.equal(harness.fetchCount("Budget"), 1);
});

test("les requêtes REST simultanées partagent une seule demande de jeton sans stockage", async () => {
  let releaseToken;
  const tokenGate = new Promise((resolve) => { releaseToken = resolve; });
  const harness = createRuntimeHarness({
    rest: true,
    accessTokenFactory: async (options) => {
      assert.equal(options.readOnly, true);
      return tokenGate;
    },
    restFetch: async (url) => {
      const tableName = new URL(url).pathname.split("/").at(-2);
      return tableName === "References2"
        ? restResponse([{ id: 1, fields: { Service: "Structure", NomProjet: "Alpha" } }])
        : restResponse([{ id: 2, fields: { Service: "Structure", NumeroProjet: "100" } }]);
    },
  });
  await harness.api.whenReady();
  const referencesPromise = harness.api.fetchContextTable("References2");
  const budgetPromise = harness.api.fetchContextTable("Budget");
  await flushAsyncWork(2);
  assert.equal(harness.accessTokenCount(), 1);
  releaseToken({
    baseUrl: "https://grist.invalid/api/docs/test-doc",
    token: "memory-only-token",
    ttlMsecs: 60000,
  });
  await Promise.all([referencesPromise, budgetPromise]);
  assert.equal(harness.accessTokenCount(), 1);
  assert.equal(
    harness.storageWrites.some((entry) => entry.some((value) => String(value).includes("memory-only-token"))),
    false
  );
});

test("le jeton est renouvelé avant expiration", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    accessTokenFactory: async (_options, count) => ({
      baseUrl: "https://grist.invalid/api/docs/test-doc",
      token: `short-token-${count}`,
      ttlMsecs: 5,
    }),
    restFetch: async () => restResponse([]),
  });
  await harness.api.whenReady();
  await harness.api.fetchContextTable("References2", { forceRefresh: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await harness.api.fetchContextTable("References2", { forceRefresh: true });
  assert.equal(harness.accessTokenCount(), 2);
});

test("une erreur 401 invalide le jeton et n'est retentée qu'une fois", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (_url, _options, count) => (
      count === 1
        ? restResponse([], { status: 401 })
        : restResponse([{ id: 1, fields: { Service: "Structure", NomProjet: "Alpha" } }])
    ),
  });
  await harness.api.whenReady();
  const table = await harness.api.fetchContextTable("References2");
  assert.deepEqual(Array.from(table.id), [1]);
  assert.equal(harness.accessTokenCount(), 2);
  assert.equal(harness.restRequests.length, 2);
});

test("deux erreurs d'authentification successives basculent vers fetchTable sans boucle", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([], { status: 403 }),
  });
  harness.tables.References2 = {
    id: [1, 2],
    Service: ["Structure", "Topographie"],
    NomProjet: ["Alpha", "Alpha"],
  };
  await harness.api.whenReady();
  const table = await harness.api.fetchContextTable("References2");
  assert.deepEqual(Array.from(table.id), [1]);
  assert.equal(harness.restRequests.length, 2);
  assert.equal(harness.accessTokenCount(), 2);
  assert.equal(harness.fetchCount("References2"), 1);
});

test("le cache contextuel partage les promesses, respecte forceRefresh et le TTL", async () => {
  let releaseFetch;
  const responseGate = new Promise((resolve) => { releaseFetch = resolve; });
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (_url, _options, count) => (
      count === 1 ? responseGate : restResponse([])
    ),
  });
  await harness.api.whenReady();
  const first = harness.api.fetchContextTable("References2");
  const second = harness.api.fetchContextTable("References2");
  await flushAsyncWork(2);
  assert.equal(harness.restRequests.length, 1);
  releaseFetch(restResponse([]));
  await Promise.all([first, second]);
  await harness.api.fetchContextTable("References2");
  assert.equal(harness.restRequests.length, 1);
  await harness.api.fetchContextTable("References2", { forceRefresh: true });
  await harness.api.fetchContextTable("References2", { ttl: 0 });
  assert.equal(harness.restRequests.length, 3);
});

test("le cache ne mélange ni service ni projet et ignore une ancienne génération", async () => {
  let releaseAlpha;
  const alphaGate = new Promise((resolve) => { releaseAlpha = resolve; });
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url, _options, count) => {
      if (count === 1) return alphaGate;
      const filter = JSON.parse(new URL(url).searchParams.get("filter"));
      const project = filter.NomProjet?.includes("Beta") ? "Beta" : "Alpha";
      return restResponse([{
        id: count,
        fields: { Service: filter.Service[0], NomProjet: project },
      }]);
    },
  });
  await harness.api.whenReady();
  const staleAlpha = harness.api.fetchContextTable("References2");
  await flushAsyncWork(2);
  await harness.api.selectProject("Beta");
  releaseAlpha(restResponse([{ id: 1, fields: { Service: "Structure", NomProjet: "Alpha" } }]));
  assert.deepEqual(Array.from((await staleAlpha).id), []);
  assert.deepEqual(Array.from((await harness.api.fetchContextTable("References2")).NomProjet), ["Beta"]);
  await harness.api.selectService("Synthese");
  await harness.api.fetchContextTable("References2");
  assert.equal(harness.restRequests.length, 3);
  assert.deepEqual(requestFilter(harness.restRequests.at(-1)).Service, ["Synthese", "Synthèse"]);
});

test("une mutation invalide uniquement les tables modifiées", async () => {
  const applied = [];
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([]),
    applyUserActions: async (actions) => { applied.push(actions); return "ok"; },
  });
  await harness.api.whenReady();
  await harness.api.fetchContextTable("References2");
  await harness.api.fetchContextTable("Budget");
  assert.equal(harness.restRequests.length, 2);
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "A" }],
  ]);
  await harness.api.fetchContextTable("References2");
  await harness.api.fetchContextTable("Budget");
  assert.equal(harness.restRequests.length, 3);
  assert.equal(applied[0][0][3].Service, "Structure");
  assert.equal(applied[0][0][3].NomProjet, "Alpha");
});

test("les erreurs réseau et JSON reviennent au fetchTable brut avec filtre client", async () => {
  for (const restFetch of [
    async () => { throw new TypeError("offline"); },
    async () => restResponse([], { jsonError: new SyntaxError("bad json") }),
  ]) {
    const harness = createRuntimeHarness({ rest: true, restFetch });
    harness.tables.References2 = {
      id: [1, 2, 3],
      Service: ["Structure", "Structure", "Topographie"],
      NomProjet: ["Alpha", "Beta", "Alpha"],
    };
    await harness.api.whenReady();
    const table = await harness.api.fetchContextTable("References2");
    assert.deepEqual(Array.from(table.id), [1]);
    assert.equal(harness.fetchCount("References2"), 1);
  }
});

test("l'absence de getAccessToken ou de fetch conserve le repli historique", async () => {
  const missingToken = createRuntimeHarness();
  missingToken.window.fetch = async () => restResponse([]);
  missingToken.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"],
  };
  await missingToken.api.whenReady();
  assert.deepEqual(Array.from((await missingToken.api.fetchContextTable("References2")).id), [1]);

  const missingFetch = createRuntimeHarness();
  missingFetch.grist.docApi.getAccessToken = async () => ({
    baseUrl: "https://grist.invalid/api/docs/test-doc",
    token: "temporary",
    ttlMsecs: 60000,
  });
  missingFetch.tables.References2 = {
    id: [2], Service: ["Structure"], NomProjet: ["Alpha"],
  };
  await missingFetch.api.whenReady();
  assert.deepEqual(Array.from((await missingFetch.api.fetchContextTable("References2")).id), [2]);
});

test("un contexte vide renvoie une table vide sans requête métier", async () => {
  const harness = createRuntimeHarness({ rest: true });
  harness.tables.Team.Service = [""];
  harness.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"],
  };
  await harness.api.whenReady();
  const table = await harness.api.fetchContextTable("References2");
  assert.deepEqual(Array.from(table.id), []);
  assert.equal(harness.restRequests.length, 0);
  assert.equal(harness.fetchCount("References2"), 0);
});

test("le mode multiprojets envoie tous les projets autorisés", async () => {
  const harness = createRuntimeHarness({ multiProject: true, rest: true });
  await harness.api.whenReady();
  await harness.api.fetchContextTable("Planning_Projet");
  assert.deepEqual(requestFilter(harness.restRequests[0]), {
    Service: ["Structure"],
    NomProjet: ["Alpha", "Alpha Alias", "Beta"],
  });
  await harness.api.fetchContextTable("TimeSegment");
  assert.deepEqual(requestFilter(harness.restRequests[1]), {
    Service: ["Structure"],
    NumeroProjet: ["100", "200"],
  });
});

test("les lots REST multiprojets sont fusionnés et dédupliqués par id", async () => {
  const harness = createRuntimeHarness({
    multiProject: true,
    rest: true,
    restFetch: async (url, _options, count) => {
      const filter = JSON.parse(new URL(url).searchParams.get("filter"));
      return restResponse([
        { id: 1, fields: { Service: "Structure", NumeroProjet: filter.NumeroProjet[0], Batch: 1 } },
        { id: 100 + count, fields: { Service: "Structure", NumeroProjet: filter.NumeroProjet.at(-1), Batch: count } },
      ]);
    },
  });
  const numbers = Array.from({ length: 85 }, (_unused, index) => String(1000 + index));
  harness.tables.Team.Projets_Access = [numbers.map((number) => `${number}|Projet ${number}`).join("\n")];
  harness.tables.Projets2 = {
    id: numbers.map((_number, index) => index + 1),
    Numero_de_projet: numbers,
    Nom_de_projet: numbers.map((number) => `Projet ${number}`),
  };
  await harness.api.whenReady();
  const table = await harness.api.fetchContextTable("TimeSegment");
  assert.equal(harness.restRequests.length, 3);
  assert.deepEqual(Array.from(table.id), [1, 101, 102, 103]);
  assert.deepEqual(harness.restRequests.map((request) => (
    requestFilter(request).NumeroProjet.length
  )), [40, 40, 5]);
});

test("les tables de droits restent brutes en interne avant les lectures REST", async () => {
  const harness = createRuntimeHarness({ rest: true });
  await harness.api.whenReady();
  assert.equal(harness.fetchCount("Team"), 1);
  assert.equal(harness.fetchCount("Projets2"), 1);
  assert.equal(harness.fetchCount("ProjectTeam"), 1);
  assert.equal(harness.accessTokenCount(), 0);
  await harness.api.fetchContextTable("ProjectTeam");
  assert.equal(harness.accessTokenCount(), 1);
  assert.equal(harness.fetchCount("ProjectTeam"), 1);
});

test("écriture readonly et cible hors contexte sont bloquées avant Grist", async () => {
  let applyCount = 0;
  const readonly = createRuntimeHarness({
    applyUserActions: async () => { applyCount += 1; },
  });
  await readonly.api.whenReady();
  await readonly.api.selectService("Synthese");
  await assert.rejects(
    readonly.grist.docApi.applyUserActions([
      ["AddRecord", "References2", null, { Reference: "X" }],
    ]),
    /lecture seule/
  );
  assert.equal(applyCount, 0);

  const outside = createRuntimeHarness({
    applyUserActions: async () => { applyCount += 1; },
  });
  outside.tables.References2 = {
    id: [9],
    Service: ["Structure"],
    NomProjet: ["Beta"],
    Reference: ["B"],
  };
  await outside.api.whenReady();
  await assert.rejects(
    outside.grist.docApi.applyUserActions([
      ["UpdateRecord", "References2", 9, { Reference: "A" }],
    ]),
    /n'appartient pas au projet et au service/
  );
  await assert.rejects(
    outside.grist.docApi.applyUserActions([
      ["RemoveRecord", "References2", 9],
    ]),
    /n'appartient pas au projet et au service/
  );
  assert.equal(applyCount, 0);
});

test("le watcher REST charge et recharge sans abonnement onRecords natif", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url) => {
      const filter = JSON.parse(new URL(url).searchParams.get("filter"));
      const project = filter.NomProjet.includes("Beta") ? "Beta" : "Alpha";
      return restResponse([{
        id: project === "Alpha" ? 1 : 2,
        fields: { Service: filter.Service[0], NomProjet: project },
      }]);
    },
  });
  await harness.api.whenReady();
  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows, _mappings, delivery) => {
    deliveries.push({ project: rows[0]?.NomProjet, reason: delivery.reason });
  });
  await flushAsyncWork();
  assert.deepEqual(deliveries.at(-1), { project: "Alpha", reason: "initial" });
  assert.equal(harness.nativeOnRecordsCount(), 0);
  await harness.api.selectProject("Beta");
  assert.deepEqual(deliveries.at(-1), { project: "Beta", reason: "selection" });
  assert.equal(harness.nativeOnRecordsCount(), 0);
  unsubscribe();
});

test("le watcher ignore une réponse obsolète et se rafraîchit après mutation", async () => {
  let releaseAlpha;
  const alphaGate = new Promise((resolve) => { releaseAlpha = resolve; });
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url, _options, count) => {
      const filter = JSON.parse(new URL(url).searchParams.get("filter"));
      if (count === 1) return alphaGate;
      const project = filter.NomProjet.includes("Beta") ? "Beta" : "Alpha";
      return restResponse([{ id: count, fields: { Service: "Structure", NomProjet: project } }]);
    },
  });
  await harness.api.whenReady();
  const projects = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows) => {
    projects.push(rows[0]?.NomProjet || "");
  });
  await flushAsyncWork(2);
  await harness.api.selectProject("Beta");
  releaseAlpha(restResponse([{ id: 1, fields: { Service: "Structure", NomProjet: "Alpha" } }]));
  await flushAsyncWork();
  assert.deepEqual(projects, ["Beta"]);
  const requestCount = harness.restRequests.length;
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "B" }],
  ]);
  assert.equal(harness.restRequests.length, requestCount + 1);
  unsubscribe();
});

test("le watcher bascule vers onRecords lorsque REST est indisponible", async () => {
  const harness = createRuntimeHarness();
  harness.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"], Reference: ["A"],
  };
  await harness.api.whenReady();
  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows) => {
    deliveries.push(rows.map((row) => row.Reference));
  });
  await flushAsyncWork();
  assert.equal(harness.nativeOnRecordsCount(), 1);
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.deepEqual(deliveries.at(-1), ["A", "AA"]);
  unsubscribe();
});

test("le polling du watcher est suspendu lorsque la page est cachée", async () => {
  const harness = createRuntimeHarness({ rest: true });
  await harness.api.whenReady();
  harness.document.hidden = true;
  const unsubscribe = harness.api.watchContextTable("References2", () => {}, { pollIntervalMs: 5 });
  await flushAsyncWork();
  const hiddenRequestCount = harness.restRequests.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.restRequests.length, hiddenRequestCount);
  harness.document.hidden = false;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(harness.restRequests.length > hiddenRequestCount);
  unsubscribe();
});

test("les six widgets de source migrent vers leur table filtrée", () => {
  const expected = new Map([
    ["Reference2/js/legacy.js", /watchContextTable\(['"]References2['"]/],
    ["EnAttente/js/grist.js", /watchContextTable\(['"]References2['"]/],
    ["ListeDePlan/script.js", /watchContextTable\(['"]ListePlan_NDC_COF['"]/],
    ["ListeDePlan/avancement.js", /watchContextTable\(['"]ListePlan_NDC_COF['"]/],
    ["Bordereau/bordereau.js", /watchContextTable\(BORDEREAU_TABLE/],
    ["Avancement/js/avancement.js", /watchContextTable\(['"]ListePlan_NDC_COF['"]/],
  ]);
  expected.forEach((pattern, relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
    assert.match(source, pattern);
    assert.doesNotMatch(source, /GristServiceContext\.onRecords\s*\(/);
  });
});
