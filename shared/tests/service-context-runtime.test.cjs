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
  integrationMode = "automatic",
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
    GristServiceContextConfig: { mode: integrationMode },
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

function restResponse(records, { status = 200, jsonError = null, etag = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === "etag" ? etag || null : null) },
    async json() {
      if (jsonError) throw jsonError;
      return { records };
    },
  };
}

function restNotModified(etag) {
  return {
    ok: false,
    status: 304,
    headers: { get: (name) => (String(name).toLowerCase() === "etag" ? etag : null) },
    async json() {
      throw new Error("un 304 n'a pas de corps");
    },
  };
}

function conditionalTag(request) {
  return request?.options?.headers?.["If-None-Match"] || "";
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
    scheduleReferenceLimitReconciliation() {},
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

test("les quatre widgets audités respectent leur mode d'intégration", () => {
  const read = (relativePath) => fs.readFileSync(
    path.join(__dirname, "..", "..", relativePath),
    "utf8"
  );
  const assertScriptOrder = (html, scripts) => {
    let previous = -1;
    scripts.forEach((script) => {
      const index = html.indexOf(script);
      assert.ok(index > previous, `${script} doit être chargé dans l'ordre attendu`);
      previous = index;
    });
  };

  const creationHtml = read("creation-projet/index.html");
  const creationSource = read("creation-projet/app.js");
  assertScriptOrder(creationHtml, [
    "grist-plugin-api.js",
    "service-context-core.js",
    "grist-service-context.js",
    "app.js",
  ]);
  assert.match(creationHtml, /mode:\s*['"]rest-first['"]/);
  assert.match(creationSource, /fetchContextTable\(tableName\)/);
  assert.match(creationSource, /grist\.ready\(\{\s*requiredAccess:\s*["']full["']\s*\}\)/);
  assert.match(creationSource, /assertProjectCreationDocumentIdentitiesAvailable/);
  assert.match(creationSource, /applyUserActions\(projectActions\)/);

  const msHtml = read("MS Project/Index.html");
  const msMain = read("MS Project/assets/js/main.js");
  const msService = read("MS Project/assets/js/services/gristService.js");
  const msConfig = read("MS Project/assets/js/config.js");
  assertScriptOrder(msHtml, [
    "grist-plugin-api.js",
    "assets/js/main.js",
  ]);
  assert.doesNotMatch(msHtml, /service-context|data-grist-project-controller/);
  assert.match(msHtml, /id="projectDropdown"/);
  assert.match(msMain, /fetchMsProjectRows\(requestedProject\)/);
  assert.match(msService, /grist\.ready\(\{\s*requiredAccess:\s*["']full["']\s*\}\)/);
  assert.match(msService, /fetchRestRows\(table\.sourceTable,\s*\{\s*\[sourceNameColumn\]:\s*\[normalizedProject\]\s*,?\s*\}\)/);
  assert.doesNotMatch(msService, /GristServiceContext|restFilter/);
  const projectOptionsSource = msService.slice(
    msService.indexOf("export async function buildProjectOptions"),
    msService.indexOf("export async function fetchMsProjectRows")
  );
  assert.match(msConfig, /msProjectNamesTable:\s*\{[\s\S]*sourceTable:\s*["']MsProjectNom["'][\s\S]*name:\s*["']Nom["']/);
  assert.match(projectOptionsSource, /APP_CONFIG\.grist\.msProjectNamesTable/);
  assert.match(projectOptionsSource, /fetchTableRows\(tableName\)/);
  assert.doesNotMatch(projectOptionsSource, /fetchDistinctValues|msProjectTable|planningSyncTable|Nom_XML/);
  assert.doesNotMatch(msService, /SELECT\s+DISTINCT|\/sql/);
  assert.match(msService, /ensureProjectNameInCatalog\(sourceFileName\)/);
  assert.match(msService, /applyUserActionsInBatches\(actions\)/);
  assert.match(msService, /planningTable\.sourceTable/);

  const timeOutHtml = read("Time-Out/index.html");
  const timeOutMain = read("Time-Out/assets/js/main.js");
  const timeOutService = read("Time-Out/assets/js/services/gristService.js");
  assertScriptOrder(timeOutHtml, [
    "grist-plugin-api.js",
    "service-context-core.js",
    "grist-service-context.js",
    "assets/js/main.js",
  ]);
  assert.match(timeOutHtml, /mode:\s*["']rest-first["']/);
  assert.match(timeOutMain, /GristServiceContext\?\.whenReady/);
  assert.match(timeOutMain, /grist\.onRecords/);
  assert.match(timeOutService, /fetchTeamRows\(\).*fetchTableRows/);
  assert.match(timeOutService, /fetchSegments\(\).*fetchTableRows/);
  assert.match(timeOutService, /applyActions\(\[\["AddRecord"/);

  const adminHtml = read("gestion-equipe/index.html");
  const adminSource = read("gestion-equipe/app.js");
  assertScriptOrder(adminHtml, [
    "grist-plugin-api.js",
    "service-context-core.js",
    "grist-service-context.js",
    "app.js",
  ]);
  assert.match(adminHtml, /mode:\s*["']rest-first["']/);
  assert.match(adminHtml, /REST complet en lecture/);
  assert.match(adminSource, /fetchTableSnapshot\(tableName\)/);
  assert.match(adminSource, /applyUserActions\(freshPreview\.actions\)/);
});

test("le mode contexte uniquement ne contamine ni snapshots ni mutations administratives", async () => {
  const applied = [];
  const harness = createRuntimeHarness({
    integrationMode: "context-only",
    rest: true,
    applyUserActions: async (actions) => { applied.push(actions); },
  });
  await harness.api.whenReady();
  assert.equal(harness.api.getIntegrationMode(), "context-only");
  assert.equal(harness.grist.docApi.__serviceContextPatched, undefined);

  const emitters = await harness.grist.docApi.fetchTable("Emetteurs");
  assert.deepEqual(Array.from(emitters.id), [1]);
  assert.equal(harness.fetchCount("Emetteurs"), 1);
  assert.equal(harness.restRequests.length, 0);

  const actions = [["AddRecord", "References2", null, {
    Service: "Topographie",
    NomProjet: "Projet administratif",
  }]];
  await harness.grist.docApi.applyUserActions(actions);
  assert.deepEqual(applied, [actions]);
});

test("le mode REST-first charge les snapshots complets en REST et conserve les mutations", async () => {
  const applied = [];
  const harness = createRuntimeHarness({
    integrationMode: "rest-first",
    rest: true,
    restFetch: async (url) => {
      const tableName = new URL(url).pathname.split("/").at(-2);
      if (tableName === "MsProject") {
        return restResponse([
          { id: 41, fields: { Nom: "XML A", NomProjet: "" } },
          { id: 42, fields: { Nom: "XML B", NomProjet: "" } },
        ]);
      }
      return restResponse([]);
    },
    applyUserActions: async (actions) => { applied.push(actions); },
  });
  harness.tables.MsProject = {
    id: [1], Nom: ["RPC ne doit pas être lu"], NomProjet: [""],
  };
  await harness.api.whenReady();
  assert.equal(harness.api.getIntegrationMode(), "rest-first");

  const table = await harness.grist.docApi.fetchTable("MsProject");
  assert.deepEqual(Array.from(table.id), [41, 42]);
  assert.equal(harness.fetchCount("MsProject"), 0);
  assert.equal(harness.restRequests.length, 1);
  assert.equal(new URL(harness.restRequests[0].url).searchParams.has("filter"), false);
  assert.match(JSON.stringify(harness.consoleEntries), /REST COMPLET.*MsProject/);

  const actions = [["AddRecord", "References2", null, {
    Service: "Topographie",
    NomProjet: "Projet administratif",
  }]];
  await harness.grist.docApi.applyUserActions(actions);
  assert.deepEqual(applied, [actions]);
});

test("en mode rest-first une table service-aware est lue entiere, sans filtre", async () => {
  // gestion-equipe propage un renommage de projet dans Budget, ProjectTeam,
  // TimeSegment et TimeReal : ces tables portent la politique REST_PROJECT_SERVICE,
  // mais la propagation doit voir TOUTES les lignes. Filtrer ici laisserait les
  // lignes des autres services pointer sur l'ancien nom de projet.
  const harness = createRuntimeHarness({
    integrationMode: "rest-first",
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { NumeroProjet: "100", Service: "Structure" } },
      { id: 2, fields: { NumeroProjet: "100", Service: "Synthese" } },
      { id: 3, fields: { NumeroProjet: "200", Service: "Topographie" } },
    ]),
  });
  await harness.api.whenReady();

  const table = await harness.grist.docApi.fetchTable("ProjectTeam");
  assert.deepEqual(Array.from(table.id), [1, 2, 3]);
  assert.equal(
    new URL(harness.restRequests.at(-1).url).searchParams.has("filter"),
    false,
    "une lecture administrative ne doit porter aucun filtre projet ou service"
  );
});

test("le repli fetchTable conserve lui aussi la table entiere en mode rest-first", async () => {
  // Cas de la production tant que le serveur n'est pas à jour : REST indisponible,
  // tout passe par fetchTable(). Le filtre client ne doit pas plus s'appliquer.
  const harness = createRuntimeHarness({ integrationMode: "rest-first" });
  harness.tables.ProjectTeam = {
    id: [1, 2, 3],
    NumeroProjet: ["100", "100", "200"],
    Service: ["Structure", "Synthese", "Topographie"],
  };
  await harness.api.whenReady();

  const table = await harness.grist.docApi.fetchTable("ProjectTeam");
  assert.deepEqual(Array.from(table.id), [1, 2, 3]);
});

test("MS Project filtre REST sur la valeur exacte de Nom et conserve ce filtre au fallback", async () => {
  const restHarness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 41, fields: { Nom: "XML A", Nom_Tache: "Tâche A" } },
      { id: 42, fields: { Nom: "XML B", Nom_Tache: "Tâche B" } },
    ]),
  });
  restHarness.tables.MsProject = {
    id: [51, 52],
    Nom: ["XML A", "XML B"],
    Nom_Tache: ["RPC A", "RPC B"],
  };
  await restHarness.api.whenReady();

  const xmlA = await restHarness.grist.docApi.fetchTable("MsProject", {
    restFilter: { Nom: ["XML A"] },
  });
  const xmlB = await restHarness.grist.docApi.fetchTable("MsProject", {
    restFilter: { Nom: ["XML B"] },
  });

  assert.deepEqual(Array.from(xmlA.id), [41]);
  assert.deepEqual(Array.from(xmlB.id), [42]);
  assert.deepEqual(requestFilter(restHarness.restRequests[0]), { Nom: ["XML A"] });
  assert.deepEqual(requestFilter(restHarness.restRequests[1]), { Nom: ["XML B"] });
  assert.equal(restHarness.fetchCount("MsProject"), 0);
  assert.match(JSON.stringify(restHarness.consoleEntries), /REST FILTRE.*MsProject/);

  const fallbackHarness = createRuntimeHarness();
  fallbackHarness.tables.MsProject = {
    id: [61, 62],
    Nom: ["XML A", "XML B"],
    Nom_Tache: ["RPC A", "RPC B"],
  };
  await fallbackHarness.api.whenReady();
  const fallback = await fallbackHarness.grist.docApi.fetchTable("MsProject", {
    restFilter: { Nom: ["XML B"] },
  });
  const fallbackOtherProject = await fallbackHarness.grist.docApi.fetchTable("MsProject", {
    restFilter: { Nom: ["XML A"] },
  });
  assert.deepEqual(Array.from(fallback.id), [62]);
  assert.deepEqual(Array.from(fallback.Nom), ["XML B"]);
  assert.deepEqual(Array.from(fallbackOtherProject.id), [61]);
  assert.equal(fallbackHarness.fetchCount("MsProject"), 1);
  assert.match(JSON.stringify(fallbackHarness.consoleEntries), /CACHE FETCHTABLE.*MsProject/);
});

test("MS Project ne retente pas un endpoint REST indisponible à chaque sélection", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([], { status: 404 }),
  });
  harness.tables.MsProject = {
    id: [61, 62],
    Nom: ["XML A", "XML B"],
  };
  await harness.api.whenReady();

  const xmlA = await harness.grist.docApi.fetchTable("MsProject", {
    restFilter: { Nom: ["XML A"] },
  });
  const xmlB = await harness.grist.docApi.fetchTable("MsProject", {
    restFilter: { Nom: ["XML B"] },
  });

  assert.deepEqual(Array.from(xmlA.id), [61]);
  assert.deepEqual(Array.from(xmlB.id), [62]);
  assert.equal(harness.restRequests.length, 1);
  assert.equal(harness.fetchCount("MsProject"), 1);
  assert.match(JSON.stringify(harness.consoleEntries), /CACHE FETCHTABLE.*MsProject/);
});

test("MS Project charge le catalogue MsProjectNom en REST sans lire MsProject", async () => {
  const restHarness = createRuntimeHarness({
    rest: true,
    restFetch: async () => {
      return restResponse([
        { id: 1, fields: { Nom: "XML C" } },
        { id: 2, fields: { Nom: "XML A" } },
        { id: 3, fields: { Nom: "XML B" } },
      ]);
    },
  });
  restHarness.tables.MsProjectNom = {
    id: [10, 11, 12],
    Nom: ["RPC A", "RPC B", "RPC C"],
  };
  await restHarness.api.whenReady();
  const table = await restHarness.grist.docApi.fetchTable("MsProjectNom", {
    fullTable: true,
    requiredColumns: ["Nom"],
  });

  assert.deepEqual(Array.from(table.Nom), ["XML C", "XML A", "XML B"]);
  assert.equal(restHarness.fetchCount("MsProjectNom"), 0);
  assert.equal(restHarness.fetchCount("MsProject"), 0);
  assert.equal(restHarness.restRequests.length, 1);
  assert.match(new URL(restHarness.restRequests[0].url).pathname, /\/tables\/MsProjectNom\/records$/);
  assert.match(JSON.stringify(restHarness.consoleEntries), /REST COMPLET.*MsProjectNom/);

  const fallbackHarness = createRuntimeHarness();
  fallbackHarness.tables.MsProjectNom = {
    id: [1, 2, 3, 4],
    Nom: [" XML B ", "XML A", "XML B", ""],
  };
  await fallbackHarness.api.whenReady();
  const fallbackTable = await fallbackHarness.grist.docApi.fetchTable("MsProjectNom", {
    fullTable: true,
    requiredColumns: ["Nom"],
  });
  assert.deepEqual(Array.from(fallbackTable.Nom), [" XML B ", "XML A", "XML B", ""]);
  assert.equal(fallbackHarness.fetchCount("MsProjectNom"), 1);
  assert.equal(fallbackHarness.fetchCount("MsProject"), 0);
  assert.match(JSON.stringify(fallbackHarness.consoleEntries), /FALLBACK FETCHTABLE.*MsProjectNom/);
});

test("une réponse REST sans colonne requise bascule automatiquement sur fetchTable", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { MauvaiseColonne: "inexploitable" } },
    ]),
  });
  harness.tables.MsProjectNom = {
    id: [10, 11],
    Nom: ["XML A", "XML B"],
  };
  await harness.api.whenReady();
  const table = await harness.grist.docApi.fetchTable("MsProjectNom", {
    fullTable: true,
    requiredColumns: ["Nom"],
  });

  assert.deepEqual(Array.from(table.Nom), ["XML A", "XML B"]);
  assert.equal(harness.fetchCount("MsProjectNom"), 1);
  assert.match(JSON.stringify(harness.consoleEntries), /FALLBACK FETCHTABLE.*colonne requise absente/);
});

test("REST complet vide ou indisponible revient au fetchTable complet", async () => {
  const emptyRest = createRuntimeHarness({
    integrationMode: "rest-first",
    rest: true,
    restFetch: async () => restResponse([]),
    restTableProbeRecords: [],
  });
  emptyRest.tables.MsProject = {
    id: [51, 52], Nom: ["RPC A", "RPC B"], NomProjet: ["", ""],
  };
  await emptyRest.api.whenReady();
  const emptyFallback = await emptyRest.grist.docApi.fetchTable("MsProject");
  assert.deepEqual(Array.from(emptyFallback.id), [51, 52]);
  assert.equal(emptyRest.fetchCount("MsProject"), 1);
  assert.equal(emptyRest.restTableProbeRequests.length, 1);

  const noRest = createRuntimeHarness({ integrationMode: "rest-first" });
  noRest.tables.MsProject = {
    id: [61], Nom: ["RPC sans API REST"], NomProjet: [""],
  };
  await noRest.api.whenReady();
  const unavailableFallback = await noRest.grist.docApi.fetchTable("MsProject");
  assert.deepEqual(Array.from(unavailableFallback.id), [61]);
  assert.equal(noRest.fetchCount("MsProject"), 1);
});

test("une table REST vide revient au fetchTable pour conserver son schéma", async () => {
  const harness = createRuntimeHarness({
    integrationMode: "rest-first",
    rest: true,
    restFetch: async (url) => {
      const tableName = new URL(url).pathname.split("/").at(-2);
      return tableName === "TableVide"
        ? restResponse([])
        : restResponse([{ id: 71, fields: { Valeur: "REST toujours actif" } }]);
    },
    restTableProbeRecords: [],
  });
  harness.tables.TableVide = {
    id: [], Service: [], NomProjet: [], ColonneMetier: [],
  };
  await harness.api.whenReady();
  const table = await harness.grist.docApi.fetchTable("TableVide");
  assert.deepEqual(Object.keys(table), ["id", "Service", "NomProjet", "ColonneMetier"]);
  assert.equal(harness.fetchCount("TableVide"), 1);
  const nextTable = await harness.grist.docApi.fetchTable("AutreTable");
  assert.deepEqual(Array.from(nextTable.id), [71]);
  assert.equal(harness.fetchCount("AutreTable"), 0);
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

test("une table métier REST vide bascule seule sur fetchTable et les suivantes retentent REST", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url) => {
      const tableName = new URL(url).pathname.split("/").at(-2);
      return tableName === "References2"
        ? restResponse([])
        : restResponse([{ id: 7, fields: { Service: "Structure", NumeroProjet: "100", Amount: 10 } }]);
    },
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
  assert.equal(harness.restRequests.length, 2);
  assert.equal(harness.restTableProbeRequests.length, 1);
  const tableProbeUrl = new URL(harness.restTableProbeRequests[0].url);
  assert.match(tableProbeUrl.pathname, /\/tables\/References2\/records$/);
  assert.equal(tableProbeUrl.searchParams.get("limit"), "1");
  assert.equal(harness.restTableProbeRequests[0].options.cache, "no-store");
  assert.equal(harness.fetchCount("References2"), 1);
  assert.equal(harness.fetchCount("Budget"), 0);
  assert.ok(harness.consoleEntries.some(([level, label]) => (
    level === "info" && String(label).includes("[GristData][REST FILTRE] Budget")
  )));
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
  const logs = JSON.stringify(harness.consoleEntries);
  assert.match(logs, /JETON REST OK/);
  assert.match(logs, /lectureSeule/);
  assert.doesNotMatch(logs, /memory-only-token/);
});

test("les messages de repli restent neutres sur la cause d'une visibilité REST vide", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restProbeRecords: [],
  });
  harness.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"],
  };
  await harness.api.whenReady();
  await harness.api.fetchContextTable("References2");
  const logs = JSON.stringify(harness.consoleEntries);
  assert.match(logs, /visibilite est limitee|visibilité est limitée/);
  assert.match(logs, /repli RPC/);
  assert.doesNotMatch(logs, /mise a jour du serveur Grist est necessaire/i);
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

test("le watcher REST lit ses lignes en REST et n'utilise onRecords que comme signal", async () => {
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
  // Un seul abonnement natif, et il ne sert qu'à être prévenu : les lignes
  // livrées viennent des réponses REST, pas du flux de la section.
  assert.equal(harness.nativeOnRecordsCount(), 1);
  assert.equal(deliveries.length, 1);
  await harness.api.selectProject("Beta");
  assert.deepEqual(deliveries.at(-1), { project: "Beta", reason: "selection" });
  assert.equal(harness.nativeOnRecordsCount(), 1);
  unsubscribe();
});

test("le signal natif ne reveille que le watcher de la table de la section", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url) => {
      const table = new URL(url).pathname.split("/tables/")[1].split("/")[0];
      return restResponse([{ id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Table: table } }]);
    },
  });
  // La section est posée sur Projets2 : une écriture dans Projets2 ne doit pas
  // faire relire References2, qui n'apprend rien de ce signal.
  harness.grist.selectedTable = { async getTableId() { return "Projets2"; } };
  await harness.api.whenReady();
  const unsubscribe = harness.api.watchContextTable("References2", () => {});
  await flushAsyncWork();

  const requestCount = harness.restRequests.length;
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.equal(harness.restRequests.length, requestCount);
  unsubscribe();
});

test("le signal natif rafraichit un watcher REST sans requete supplementaire cote signal", async () => {
  let currentReference = "A";
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Reference: currentReference } },
    ]),
  });
  await harness.api.whenReady();
  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows) => {
    deliveries.push(rows[0]?.Reference);
  });
  await flushAsyncWork();
  assert.deepEqual(deliveries, ["A"]);

  // Le flux natif ne porte pas la donnée : il déclenche une relecture REST.
  currentReference = "B";
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.deepEqual(deliveries, ["A", "B"]);
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

test("le flux natif declenche un rechargement, il ne fournit pas les lignes", async () => {
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
  assert.deepEqual(deliveries.at(-1), ["A"]);

  // La section hôte peut être une autre table (Projets2) : ses lignes ne doivent
  // jamais être livrées à la place de celles de la table surveillée.
  harness.tables.References2 = {
    id: [1, 2],
    Service: ["Structure", "Structure"],
    NomProjet: ["Alpha", "Alpha"],
    Reference: ["A", "B"],
  };
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.deepEqual(deliveries.at(-1), ["A", "B"]);
  unsubscribe();
});

test("aucune interrogation periodique n'est armee par defaut", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "grist-service-context.js"),
    "utf8"
  );
  assert.match(source, /const DEFAULT_WATCH_POLL_INTERVAL_MS = 0;/);
});

test("le signal Grist est ecoute avant la fin de la lecture initiale", async () => {
  let releaseInitialRead;
  const initialRead = new Promise((resolve) => { releaseInitialRead = resolve; });
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url) => {
      const table = decodeURIComponent(new URL(url).pathname.split("/tables/")[1].split("/")[0]);
      if (table === "References2") await initialRead;
      return restResponse([]);
    },
  });
  await harness.api.whenReady();

  const unsubscribe = harness.api.watchContextTable("References2", () => {});
  assert.equal(
    harness.nativeOnRecordsCount(),
    1,
    "onRecords doit etre branche sans attendre REST ni un clic dans la fenetre"
  );

  releaseInitialRead();
  await flushAsyncWork();
  unsubscribe();
});

test("des lignes inchangees ne sont pas relivrees au widget", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Reference: "A" } },
    ]),
  });
  await harness.api.whenReady();
  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows) => {
    deliveries.push(rows.length);
  });
  await flushAsyncWork();
  assert.equal(deliveries.length, 1);

  // Une écriture force la relecture : la requête part, mais le contenu est
  // identique donc le widget ne doit pas être re-rendu.
  const requestCount = harness.restRequests.length;
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "B" }],
  ]);
  await flushAsyncWork();
  assert.ok(harness.restRequests.length > requestCount);
  assert.equal(deliveries.length, 1);
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

test("un watcher peut accepter le signal natif d'une section historique", async () => {
  let currentReference = "A";
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Reference: currentReference } },
    ]),
  });
  harness.grist.selectedTable = { async getTableId() { return "Fusion"; } };
  await harness.api.whenReady();
  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable(
    "References2",
    (rows) => deliveries.push(rows[0]?.Reference),
    { acceptAnyNativeTableSignal: true }
  );
  await flushAsyncWork();
  assert.deepEqual(deliveries, ["A"]);

  currentReference = "B";
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.deepEqual(deliveries, ["A", "B"]);
  unsubscribe();
});

test("un filtre natif évite toute relecture pour un signal non pertinent", async () => {
  let currentReference = "A";
  let acceptSignal = false;
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async () => restResponse([
      { id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Reference: currentReference } },
    ]),
  });
  harness.grist.selectedTable = { async getTableId() { return "Projets2"; } };
  await harness.api.whenReady();

  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable(
    "References2",
    (rows) => deliveries.push(rows[0]?.Reference),
    {
      acceptAnyNativeTableSignal: true,
      nativeSignalFilter: () => acceptSignal,
    }
  );
  await flushAsyncWork();
  assert.deepEqual(deliveries, ["A"]);

  const requestCount = harness.restRequests.length;
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.equal(
    harness.restRequests.length,
    requestCount,
    "un autre projet ne doit provoquer aucune relecture REST"
  );

  acceptSignal = true;
  currentReference = "B";
  harness.emitRecords(RAW_REFERENCE_RECORDS);
  await flushAsyncWork();
  assert.equal(harness.restRequests.length, requestCount + 1);
  assert.deepEqual(deliveries, ["A", "B"]);
  unsubscribe();
});

test("watchContextTables detecte par REST une modification d'un autre utilisateur", async () => {
  let teamVersion = 1;
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url) => {
      const table = decodeURIComponent(new URL(url).pathname.split("/tables/")[1].split("/")[0]);
      if (table === "ProjectTeam") {
        return restResponse(Array.from({ length: teamVersion }, (_unused, index) => ({
          id: index + 1,
          fields: {
            Service: "Structure",
            NumeroProjet: "100",
            Name: index === 0 ? "Alice" : "Bob",
            Role: "Projeteur",
          },
        })));
      }
      return restResponse([{
        id: 1,
        fields: { Service: "Structure", NumeroProjet: "100", Amount: 10 },
      }]);
    },
  });
  await harness.api.whenReady();

  const changes = [];
  const unsubscribe = harness.api.watchContextTables(
    ["ProjectTeam", "Budget"],
    ({ tables }) => changes.push([...tables]),
    {
      debounceMs: 1,
      pollIntervalMs: 5,
      pollTableNames: ["ProjectTeam"],
    }
  );
  await flushAsyncWork();
  await settleTimers();
  changes.length = 0;

  // Aucun applyUserActions local et aucun onRecords : le changement simule un
  // autre navigateur et doit etre decouvert par la revalidation REST.
  teamVersion = 2;
  await new Promise((resolve) => setTimeout(resolve, 30));
  await flushAsyncWork();
  assert.ok(changes.some((tables) => tables.includes("ProjectTeam")));
  assert.equal(changes.some((tables) => tables.includes("Budget")), false);
  unsubscribe();
});

test("le polling garde la synchronisation quand REST replie sur fetchTable", async () => {
  const harness = createRuntimeHarness();
  harness.tables.ProjectTeam = {
    id: [1],
    NumeroProjet: ["100"],
    Name: ["Alice"],
    Role: ["Projeteur"],
    Service: ["Structure"],
  };
  await harness.api.whenReady();

  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable(
    "ProjectTeam",
    (rows) => deliveries.push(rows.length),
    { pollIntervalMs: 5 }
  );
  await flushAsyncWork();
  assert.equal(deliveries.at(-1), 1);

  harness.tables.ProjectTeam = {
    id: [1, 2],
    NumeroProjet: ["100", "100"],
    Name: ["Alice", "Bob"],
    Role: ["Projeteur", "Projeteur"],
    Service: ["Structure", "Structure"],
  };
  await new Promise((resolve) => setTimeout(resolve, 30));
  await flushAsyncWork();
  assert.equal(deliveries.at(-1), 2);
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

test("une revalidation 304 evite le retelechargement et le re-rendu du widget", async () => {
  const harness = createRuntimeHarness({
    rest: true,
    restFetch: async (url, options, count) => {
      const request = { url, options };
      if (count === 1) {
        return restResponse(
          [{ id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Reference: "A" } }],
          { etag: 'W/"v1"' }
        );
      }
      assert.equal(conditionalTag(request), 'W/"v1"', "la revalidation doit porter l'ETag memorise");
      assert.equal(options?.cache, "no-store", "la revalidation ne doit pas passer par le cache navigateur");
      return restNotModified('W/"v1"');
    },
  });
  await harness.api.whenReady();
  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows, _mappings, delivery) => {
    deliveries.push({ lignes: rows.length, reason: delivery.reason });
  });
  await flushAsyncWork();
  assert.deepEqual(deliveries, [{ lignes: 1, reason: "initial" }]);

  const table = await harness.api.fetchContextTable("References2", { forceRefresh: true });
  assert.equal(harness.restRequests.length, 2, "la revalidation emet bien une requete");
  assert.deepEqual(Array.from(table.id), [1], "les lignes memorisees sont conservees");
  assert.deepEqual(deliveries, [{ lignes: 1, reason: "initial" }], "aucun re-rendu inutile");
  unsubscribe();
});

test("un lot partiellement modifie fusionne le neuf et les lignes revalidees", async () => {
  const harness = createRuntimeHarness({
    multiProject: true,
    rest: true,
    restFetch: async (url, options, count) => {
      const filter = JSON.parse(new URL(url).searchParams.get("filter"));
      const batch = filter.NumeroProjet[0];
      if (count <= 2) {
        return restResponse(
          [{ id: count, fields: { Service: "Structure", NumeroProjet: batch, Etat: "initial" } }],
          { etag: `W/"${batch}"` }
        );
      }
      // Second passage : le premier lot est inchange, le second a bouge.
      if (conditionalTag({ options }) === 'W/"1000"') return restNotModified('W/"1000"');
      return restResponse(
        [{ id: 2, fields: { Service: "Structure", NumeroProjet: batch, Etat: "modifie" } }],
        { etag: `W/"${batch}-bis"` }
      );
    },
  });
  const numbers = Array.from({ length: 45 }, (_unused, index) => String(1000 + index));
  harness.tables.Team.Projets_Access = [numbers.map((number) => `${number}|Projet ${number}`).join("\n")];
  harness.tables.Projets2 = {
    id: numbers.map((_number, index) => index + 1),
    Numero_de_projet: numbers,
    Nom_de_projet: numbers.map((number) => `Projet ${number}`),
  };
  await harness.api.whenReady();
  const first = await harness.api.fetchContextTable("TimeSegment");
  assert.equal(harness.restRequests.length, 2, "le filtre est decoupe en deux lots");
  assert.deepEqual(Array.from(first.id), [1, 2]);

  const second = await harness.api.fetchContextTable("TimeSegment", { forceRefresh: true });
  assert.equal(harness.restRequests.length, 4);
  const rows = core.tableToRows(second);
  assert.deepEqual(rows.map((row) => row.id).sort((a, b) => a - b), [1, 2]);
  assert.equal(
    rows.find((row) => row.id === 1).Etat,
    "initial",
    "le lot revalide conserve ses lignes"
  );
  assert.equal(
    rows.find((row) => row.id === 2).Etat,
    "modifie",
    "le lot modifie apporte ses nouvelles lignes"
  );
});

test("le garde-fou d'ecriture s'appuie sur le contexte sans recharger la table entiere", async () => {
  let applied = null;
  const harness = createRuntimeHarness({
    rest: true,
    applyUserActions: async (actions) => { applied = actions; },
    restFetch: async () => restResponse(
      [{ id: 7, fields: { Service: "Structure", NomProjet: "Alpha", Reference: "A" } }],
      { etag: 'W/"v1"' }
    ),
  });
  // Table complete disponible uniquement pour le chemin de repli du garde-fou.
  harness.tables.References2 = {
    id: [7],
    Service: ["Structure"],
    NomProjet: ["Alpha"],
    Reference: ["A"],
  };
  await harness.api.whenReady();
  await harness.api.fetchContextTable("References2");
  const fetchesAvantEcriture = harness.fetchCount("References2");

  await harness.grist.docApi.applyUserActions([
    ["UpdateRecord", "References2", 7, { Reference: "B" }],
  ]);
  assert.ok(applied, "l'ecriture doit atteindre Grist");
  assert.equal(
    harness.fetchCount("References2"),
    fetchesAvantEcriture,
    "aucun fetchTable complet ne doit etre declenche pour valider une ligne visible"
  );

  await assert.rejects(
    harness.grist.docApi.applyUserActions([
      ["UpdateRecord", "References2", 4242, { Reference: "C" }],
    ]),
    /n'appartient pas au projet et au service/,
    "une ligne absente du contexte reste refusee"
  );
});

// --- Rafraîchissement sans rechargement de page --------------------------------
// Le widget doit montrer une modification dès qu'elle est faite : par lui, par un
// widget voisin, ou par un autre utilisateur. Ces trois tests couvrent les trois
// maillons, chacun étant une cause distincte de « il faut recharger la page ».

const settleTimers = () => new Promise((resolve) => setTimeout(resolve, 20));

test("watchContextTables ignore le chargement initial et regroupe les livraisons", async () => {
  const harness = createRuntimeHarness({ applyUserActions: async () => "ok" });
  harness.tables.References2 = { id: [1], Service: ["Structure"], NomProjet: ["Alpha"], Reference: ["A"] };
  harness.tables.Budget = { id: [1], Service: ["Structure"], NumeroProjet: ["100"], Montant: [10] };
  await harness.api.whenReady();

  const calls = [];
  const unsubscribe = harness.api.watchContextTables(["References2", "Budget"], (detail) => {
    calls.push([...detail.tables].sort());
  }, { debounceMs: 5 });
  await flushAsyncWork();
  await settleTimers();
  assert.equal(calls.length, 0, "le widget vient de dessiner ces données : aucun re-rendu");

  harness.tables.References2 = {
    id: [1, 2], Service: ["Structure", "Structure"],
    NomProjet: ["Alpha", "Alpha"], Reference: ["A", "B"],
  };
  harness.tables.Budget = { id: [1], Service: ["Structure"], NumeroProjet: ["100"], Montant: [20] };
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "B" }],
    ["AddRecord", "Budget", null, { Montant: 20 }],
  ]);
  await flushAsyncWork();
  await settleTimers();
  assert.equal(calls.length, 1, "deux tables changées ne doivent produire qu'un seul rendu");
  assert.deepEqual(calls[0], ["Budget", "References2"]);
  unsubscribe();
});

test("en rest-first une ecriture rafraichit le widget sans rechargement", async () => {
  const applied = [];
  const harness = createRuntimeHarness({
    integrationMode: "rest-first",
    applyUserActions: async (actions) => { applied.push(actions); return "ok"; },
  });
  harness.tables.ProjectTeam = { id: [1], NumeroProjet: ["100"], Name: ["Alice"], Role: ["Chef"] };
  await harness.api.whenReady();

  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("ProjectTeam", (rows) => deliveries.push(rows.length));
  await flushAsyncWork();
  assert.equal(deliveries.length, 1);

  harness.tables.ProjectTeam = {
    id: [1, 2], NumeroProjet: ["100", "100"],
    Name: ["Alice", "Bob"], Role: ["Chef", "Dessinateur"],
  };
  await harness.grist.docApi.applyUserActions([["AddRecord", "ProjectTeam", null, { Name: "Bob" }]]);
  await flushAsyncWork();
  assert.equal(deliveries.length, 2, "l'écriture doit redessiner le widget");
  assert.deepEqual(
    applied[0],
    [["AddRecord", "ProjectTeam", null, { Name: "Bob" }]],
    "le mode rest-first ne réécrit pas les actions : seule la relecture est ajoutée"
  );
  unsubscribe();
});

test("une ecriture est annoncee aux widgets voisins", async () => {
  const harness = createRuntimeHarness({ applyUserActions: async () => "ok" });
  await harness.api.whenReady();
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "A" }],
  ]);
  const signal = harness.storageWrites
    .filter(([kind, key]) => kind === "set" && key === core.DATA_CHANGED_STORAGE_KEY)
    .at(-1);
  assert.ok(signal, "l'écriture doit être annoncée aux autres iframes");
  const payload = JSON.parse(signal[2]);
  assert.deepEqual(payload.tables, ["References2"]);
  assert.equal(payload.projectId, 10);
  assert.equal(payload.projectNumber, "100");
});

test("le signal d'un widget voisin rafraichit la table concernee", async () => {
  const harness = createRuntimeHarness();
  harness.tables.References2 = { id: [1], Service: ["Structure"], NomProjet: ["Alpha"], Reference: ["A"] };
  await harness.api.whenReady();

  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable("References2", (rows) => deliveries.push(rows.length));
  await flushAsyncWork();
  assert.equal(deliveries.length, 1);

  harness.tables.References2 = {
    id: [1, 2], Service: ["Structure", "Structure"],
    NomProjet: ["Alpha", "Alpha"], Reference: ["A", "B"],
  };
  harness.dispatch("storage", {
    key: core.DATA_CHANGED_STORAGE_KEY,
    newValue: JSON.stringify({
      version: core.DATA_SIGNAL_VERSION,
      at: 1,
      sequence: 1,
      tables: ["References2"],
    }),
  });
  await flushAsyncWork();
  assert.equal(deliveries.length, 2, "le voisin doit relire la table annoncée");

  // Un message d'une autre version est ignoré plutôt que mal interprété.
  harness.dispatch("storage", {
    key: core.DATA_CHANGED_STORAGE_KEY,
    newValue: JSON.stringify({ version: 99, tables: ["References2"] }),
  });
  await flushAsyncWork();
  assert.equal(deliveries.length, 2);
  unsubscribe();
});

test("un signal borne a un autre projet ne provoque aucune relecture", async () => {
  const harness = createRuntimeHarness();
  harness.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"], Reference: ["A"],
  };
  await harness.api.whenReady();

  const deliveries = [];
  const unsubscribe = harness.api.watchContextTable(
    "References2",
    (rows) => deliveries.push(rows.map((row) => row.Reference)),
    { projectScopedSignals: true }
  );
  await flushAsyncWork();
  const fetchesBeforeSignals = harness.fetchCount("References2");

  harness.dispatch("storage", {
    key: core.DATA_CHANGED_STORAGE_KEY,
    newValue: JSON.stringify({
      version: core.DATA_SIGNAL_VERSION,
      tables: ["References2"],
      projectId: 20,
      projectNumber: "200",
    }),
  });
  await flushAsyncWork();
  assert.equal(harness.fetchCount("References2"), fetchesBeforeSignals);
  assert.equal(deliveries.length, 1);

  harness.tables.References2 = {
    id: [1, 2], Service: ["Structure", "Structure"],
    NomProjet: ["Alpha", "Alpha"], Reference: ["A", "B"],
  };
  harness.dispatch("storage", {
    key: core.DATA_CHANGED_STORAGE_KEY,
    newValue: JSON.stringify({
      version: core.DATA_SIGNAL_VERSION,
      tables: ["References2"],
      projectId: 11,
      projectNumber: "100",
    }),
  });
  await flushAsyncWork();
  assert.equal(harness.fetchCount("References2"), fetchesBeforeSignals + 1);
  assert.deepEqual(deliveries.at(-1), ["A", "B"]);
  unsubscribe();
});

test("refreshContextTables reveille seulement les tables annoncees", async () => {
  const harness = createRuntimeHarness();
  harness.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"], Reference: ["A"],
  };
  harness.tables.Budget = { id: [1], NumeroProjet: ["100"], Amount: [10] };
  await harness.api.whenReady();

  const referenceDeliveries = [];
  const budgetDeliveries = [];
  const unsubscribeReference = harness.api.watchContextTable(
    "References2",
    (rows) => referenceDeliveries.push(rows.map((row) => row.Reference))
  );
  const unsubscribeBudget = harness.api.watchContextTable(
    "Budget",
    (rows) => budgetDeliveries.push(rows.length)
  );
  await flushAsyncWork();

  harness.tables.References2 = {
    id: [1, 2], Service: ["Structure", "Structure"],
    NomProjet: ["Alpha", "Alpha"], Reference: ["A", "B"],
  };
  await harness.api.refreshContextTables(
    ["References2"],
    { reason: "reference2-window-signal" }
  );
  await flushAsyncWork();

  assert.deepEqual(referenceDeliveries.at(-1), ["A", "B"]);
  assert.equal(budgetDeliveries.length, 1, "Budget ne doit pas etre relu");
  unsubscribeReference();
  unsubscribeBudget();
});

// --- Le defaut qui obligeait a recharger la page ------------------------------
// watchContextTables ignorait « la premiere livraison ». Or une lecture initiale
// peut n'en produire aucune : le widget avait deja lu la table, l'ETag etait
// memorise, la revalidation repondait 304. Le compteur restait arme et jetait la
// PREMIERE VRAIE MODIFICATION. Recharger la page le rearmait, d'ou le symptome
// « a chaque modification je dois actualiser ». On se fie desormais au motif.

test("une lecture prealable ne doit pas faire avaler la premiere modification", async () => {
  let version = 1;
  const lignes = () => Array.from({ length: version }, (_unused, index) => ({
    id: index + 1,
    fields: { Service: "Structure", NomProjet: "Alpha", Reference: `R${index + 1}` },
  }));
  const harness = createRuntimeHarness({
    rest: true,
    applyUserActions: async () => "ok",
    restFetch: async (url, options) => {
      const etag = `W/"v${version}"`;
      // Le serveur revalide : tant que rien n'a change, il repond 304.
      if (conditionalTag({ url, options }) === etag) return restNotModified(etag);
      return restResponse(lignes(), { etag });
    },
  });
  await harness.api.whenReady();

  // Le widget lit la table pour son premier rendu — c'est ce que font
  // planning-synchro et Planning Projet avant d'enregistrer leur surveillance.
  await harness.grist.docApi.fetchTable("References2");

  const calls = [];
  const unsubscribe = harness.api.watchContextTables(["References2"], ({ tables }) => {
    calls.push([...tables]);
  }, { debounceMs: 5 });
  await flushAsyncWork();
  await settleTimers();
  assert.deepEqual(calls, [], "le chargement initial ne redessine pas");

  // Premiere modification de l'utilisateur : elle doit se voir immediatement.
  version = 2;
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "R2" }],
  ]);
  await flushAsyncWork();
  await settleTimers();
  assert.deepEqual(
    calls,
    [["References2"]],
    "la premiere modification doit redessiner le widget, sans rechargement de page"
  );

  unsubscribe();
});

test("un chargement initial en echec ne fait pas avaler la modification suivante", async () => {
  let premiereLecture = true;
  const harness = createRuntimeHarness({
    rest: true,
    applyUserActions: async () => "ok",
    restFetch: async () => {
      if (premiereLecture) {
        premiereLecture = false;
        throw new TypeError("reseau indisponible");
      }
      return restResponse([
        { id: 1, fields: { Service: "Structure", NomProjet: "Alpha", Reference: "A" } },
      ]);
    },
  });
  harness.tables.References2 = { id: [], Service: [], NomProjet: [], Reference: [] };
  await harness.api.whenReady();

  const calls = [];
  const unsubscribe = harness.api.watchContextTables(["References2"], ({ tables }) => {
    calls.push([...tables]);
  }, { debounceMs: 5 });
  await flushAsyncWork();
  await settleTimers();

  harness.tables.References2 = {
    id: [1], Service: ["Structure"], NomProjet: ["Alpha"], Reference: ["A"],
  };
  await harness.grist.docApi.applyUserActions([
    ["AddRecord", "References2", null, { Reference: "A" }],
  ]);
  await flushAsyncWork();
  await settleTimers();
  assert.deepEqual(calls, [["References2"]], "la modification doit passer malgre l'echec initial");

  unsubscribe();
});
