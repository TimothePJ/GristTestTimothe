(function initGristServiceContext(window) {
  "use strict";

  if (!window || window.GristServiceContext) return;
  const core = window.GristServiceContextCore;
  if (!core) {
    console.error("GristServiceContextCore est introuvable.");
    return;
  }

  const state = {
    ready: false,
    teamRow: null,
    projects: [],
    homeService: "",
    selectedService: "",
    allowedServices: [],
    currentProject: null,
    isAdmin: false,
    error: null,
  };
  const listeners = new Set();
  let initializePromise = null;
  let refreshPromise = null;
  let reloadTimer = 0;
  let rawFetchTable = null;
  let rawApplyUserActions = null;
  let readonlyObserver = null;

  function getGrist() {
    return window.grist || null;
  }

  function sleep(delay) {
    return new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  async function waitForDocApi() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const grist = getGrist();
      if (grist?.docApi?.fetchTable) return grist;
      await sleep(25);
    }
    throw new Error("API Grist indisponible.");
  }

  function readStorage(key) {
    try {
      return String(window.localStorage?.getItem(key) || "").trim();
    } catch (_error) {
      return "";
    }
  }

  function writeStorage(key, value) {
    try {
      if (value) window.localStorage?.setItem(key, value);
      else window.localStorage?.removeItem(key);
    } catch (_error) {
      // localStorage may be unavailable in sandboxed widgets.
    }
  }

  function buildProjects(rawProjects) {
    return core.tableToRows(rawProjects)
      .map((row) => ({
        id: Number(row?.id),
        number: core.normalizeProjectNumber(
          row?.Numero_de_projet ?? row?.NumeroProjet ?? row?.Numero
        ),
        name: core.toText(row?.Nom_de_projet ?? row?.NomProjet ?? row?.Projet),
      }))
      .filter((project) => Number.isInteger(project.id) && project.id > 0 && project.number);
  }

  function resolveCurrentProject() {
    const storedId = Number(readStorage(core.PROJECT_ID_STORAGE_KEY));
    if (Number.isInteger(storedId) && storedId > 0) {
      const byId = state.projects.find((project) => project.id === storedId);
      if (byId) return byId;
    }
    const storedName = readStorage(core.PROJECT_STORAGE_KEY);
    if (storedName) {
      const normalizedName = storedName.toLocaleLowerCase("fr");
      const byName = state.projects.find(
        (project) => project.name.toLocaleLowerCase("fr") === normalizedName
      );
      if (byName) return byName;
    }
    return null;
  }

  function reconcileSelection({ persist = true } = {}) {
    state.currentProject = resolveCurrentProject();
    state.homeService = core.normalizeService(state.teamRow?.Service);
    state.isAdmin = core.isAdminTeamRow(state.teamRow);
    if (document.body?.hasAttribute("data-service-context-multiproject") && state.homeService) {
      state.allowedServices = state.isAdmin
        ? [...core.SERVICES]
        : core.SERVICES.filter((service) => (
            service === state.homeService ||
            core.parseGrants(state.teamRow?.[core.GRANT_COLUMNS[service]]).length > 0
          ));
    } else {
      state.allowedServices = core.getAllowedServices(
        state.teamRow,
        state.currentProject?.number || ""
      );
    }
    const storedService = core.normalizeService(readStorage(core.SERVICE_STORAGE_KEY));
    state.selectedService = state.allowedServices.includes(storedService)
      ? storedService
      : state.homeService;
    if (persist && state.selectedService) {
      writeStorage(core.SERVICE_STORAGE_KEY, state.selectedService);
    }
  }

  function getPublicState() {
    return {
      ready: state.ready,
      teamRow: state.teamRow ? { ...state.teamRow } : null,
      homeService: state.homeService,
      selectedService: state.selectedService,
      allowedServices: [...state.allowedServices],
      currentProject: state.currentProject ? { ...state.currentProject } : null,
      isAdmin: state.isAdmin,
      isReadOnly: !state.homeService || state.selectedService !== state.homeService,
      error: state.error,
    };
  }

  function notify() {
    const detail = getPublicState();
    window.dispatchEvent(new CustomEvent("grist-service-context-change", { detail }));
    listeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        console.error("Erreur abonné contexte Service :", error);
      }
    });
  }

  async function loadIdentityAndProjects() {
    const grist = await waitForDocApi();
    if (!rawFetchTable) {
      rawFetchTable = grist.docApi.fetchTable.bind(grist.docApi);
    }
    const [rawTeam, rawProjects] = await Promise.all([
      rawFetchTable("Team"),
      rawFetchTable("Projets2"),
    ]);
    const teamRows = core.tableToRows(rawTeam);
    state.teamRow = core.findCurrentTeamRow(teamRows);
    state.projects = buildProjects(rawProjects);
    state.error = state.teamRow
      ? null
      : new Error("Utilisateur courant introuvable dans Team (colonne Moi).");
    reconcileSelection();
  }

  async function initialize() {
    if (state.ready) return getPublicState();
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      await loadIdentityAndProjects();
      state.ready = true;
      mountSelector();
      applyReadonlyUi();
      notify();
      return getPublicState();
    })().catch((error) => {
      state.error = error;
      state.ready = true;
      state.homeService = "";
      state.selectedService = "";
      state.allowedServices = [];
      mountSelector();
      applyReadonlyUi();
      notify();
      console.error("Initialisation du contexte Service impossible :", error);
      return getPublicState();
    });
    return initializePromise;
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const previousService = state.selectedService;
      const previousAllowed = state.allowedServices.join("|");
      await loadIdentityAndProjects();
      state.ready = true;
      mountSelector();
      applyReadonlyUi();
      notify();
      if (
        previousService &&
        (previousService !== state.selectedService || previousAllowed !== state.allowedServices.join("|"))
      ) {
        scheduleReload();
      }
      return getPublicState();
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function scheduleReload() {
    if (reloadTimer) return;
    reloadTimer = window.setTimeout(() => {
      window.location.reload();
    }, 40);
  }

  function selectorHost() {
    const explicitHost = document.querySelector("[data-grist-service-context-host]");
    if (explicitHost instanceof HTMLElement) return explicitHost;

    const projectSelect = document.querySelector(
      "#firstColumnDropdown, #projectDropdown, #ps-project-select, #project-select"
    );
    if (projectSelect) {
      return projectSelect.closest(
        ".dropdown-container, .filters, .ps-project, .project-selection"
      )?.parentElement || projectSelect.parentElement;
    }
    return document.querySelector(".global-header") ||
      document.querySelector(".app-header") ||
      document.querySelector("header") ||
      document.body;
  }

  function prepareSelectorHost(host) {
    if (!(host instanceof HTMLElement)) return null;
    host.classList.add("grist-service-context-host");
    if (host.classList.contains("sticky-container")) {
      host.classList.add("grist-service-context-host--sticky");
    }
    return host;
  }

  function createSelectorWrapper(select) {
    const wrapper = document.createElement("div");
    wrapper.id = "grist-service-context-control";
    wrapper.className = "grist-service-context-control";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", "Service actif");

    const label = document.createElement("label");
    label.htmlFor = select?.id || "grist-service-select";
    label.textContent = "Service :";

    const serviceSelect = select || document.createElement("select");
    if (!serviceSelect.id) serviceSelect.id = "grist-service-select";
    serviceSelect.dataset.gristServiceSelector = "";
    serviceSelect.dataset.gristServiceManaged = "true";

    const badge = document.createElement("span");
    badge.id = "grist-service-context-badge";
    badge.className = "grist-service-context-badge";
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-live", "polite");

    wrapper.append(label, serviceSelect, badge);
    return wrapper;
  }

  function injectStyles() {
    if (document.getElementById("grist-service-context-styles")) return;
    const style = document.createElement("style");
    style.id = "grist-service-context-styles";
    style.textContent = `
      .grist-service-context-host{min-width:0}
      .grist-service-context-host--sticky{display:flex!important;flex-wrap:wrap!important;align-items:flex-end!important;gap:10px 12px!important;overflow-x:visible!important}
      .grist-service-context-host--sticky>.dropdown-container{flex:1 1 190px;max-width:360px;min-width:min(190px,100%)}
      .grist-service-context-host--sticky>.dropdown-container:has(>button){flex:0 1 auto;max-width:none}
      .grist-service-context-host--sticky>.info-container{flex:1 1 280px}
      .grist-service-context-host--sticky>.button-container{flex:0 1 auto}
      .grist-service-context-host#toolbar,.grist-service-context-host.ps-toolbar,.grist-service-context-host.global-header,.grist-service-context-host.header,.grist-service-context-host.app-header{flex-wrap:wrap!important;height:auto!important}
      .grist-service-context-control{order:1000;display:grid!important;grid-template-columns:max-content minmax(118px,160px) max-content;align-items:center;gap:6px;min-width:0;min-height:38px;max-width:100%;margin-left:auto;padding:3px 6px;border:1px solid #d7e1eb;border-radius:7px;background:#fff;color:#17324d;font:600 13px/1.2 Arial,sans-serif;box-sizing:border-box;box-shadow:0 1px 3px rgba(18,50,77,.06)}
      .grist-service-context-control label{display:block!important;margin:0!important;color:#17324d!important;font:700 12px/1.2 Arial,sans-serif!important;white-space:nowrap}
      #grist-service-context-control select{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:160px!important;height:30px!important;min-height:30px!important;margin:0!important;padding:4px 26px 4px 8px!important;border:1px solid #aebdca!important;border-radius:5px!important;background-color:#fff!important;color:#17324d!important;font:600 13px/1.2 Arial,sans-serif!important}
      #grist-service-context-control select:focus{border-color:#004990!important;box-shadow:0 0 0 2px rgba(0,73,144,.12)!important;outline:none!important}
      .grist-service-context-badge{display:inline-flex;align-items:center;min-height:24px;margin:0;padding:3px 7px;border-radius:999px;background:#e8f5ec;color:#1e6b37;font-size:11px;line-height:1.15;white-space:nowrap}
      .grist-service-context-badge.is-readonly{background:#fff0d8;color:#8b4e00}
      .grist-service-context-badge.is-error{max-width:min(260px,40vw);background:#fde7e7;color:#a51d1d;white-space:normal;overflow-wrap:anywhere}
      body[data-grist-service-readonly="true"] [data-service-write-control]{opacity:.55;cursor:not-allowed}
      @media (max-width:720px){
        .grist-service-context-host--sticky>.dropdown-container,.grist-service-context-host--sticky>.info-container{flex:1 1 min(220px,100%);max-width:none}
        .grist-service-context-host--sticky>.button-container{flex:1 1 100%;justify-content:flex-start}
        .grist-service-context-control{grid-template-columns:max-content minmax(110px,160px);width:min(100%,290px);margin-left:auto}
        .grist-service-context-badge{grid-column:1/-1;justify-self:end}
      }
    `;
    document.head.appendChild(style);
  }

  function getOrCreateSelector() {
    const adopted = document.querySelector("[data-grist-service-selector]");
    if (adopted instanceof HTMLSelectElement) {
      adopted.dataset.gristServiceManaged = "true";
      let wrapper = adopted.closest("#grist-service-context-control");
      if (!(wrapper instanceof HTMLElement)) {
        const previousField = adopted.closest("label.field, label, .field");
        const host = prepareSelectorHost(selectorHost());
        if (!host) return {};
        wrapper = createSelectorWrapper(adopted);
        host.appendChild(wrapper);
        if (
          previousField instanceof HTMLElement &&
          previousField !== host &&
          !previousField.querySelector("select, input, button, textarea")
        ) {
          previousField.remove();
        }
      } else {
        prepareSelectorHost(wrapper.parentElement);
      }
      return {
        select: adopted,
        badge: wrapper.querySelector(".grist-service-context-badge"),
        wrapper,
      };
    }

    let wrapper = document.getElementById("grist-service-context-control");
    if (!wrapper) {
      const host = prepareSelectorHost(selectorHost());
      if (!host) return {};
      wrapper = createSelectorWrapper();
      host.appendChild(wrapper);
    } else {
      prepareSelectorHost(wrapper.parentElement);
    }
    return {
      wrapper,
      select: wrapper.querySelector("select"),
      badge: wrapper.querySelector(".grist-service-context-badge"),
    };
  }

  function mountSelector() {
    if (!document.body) return;
    injectStyles();
    const { select, badge } = getOrCreateSelector();
    if (!(select instanceof HTMLSelectElement)) return;

    const currentOptions = [...select.options].map((option) => option.value).join("|");
    const expectedOptions = state.allowedServices.join("|");
    if (currentOptions !== expectedOptions) {
      select.replaceChildren();
      state.allowedServices.forEach((service) => {
        const option = document.createElement("option");
        option.value = service;
        option.textContent = service;
        select.appendChild(option);
      });
    }
    select.value = state.selectedService;
    select.disabled = !state.ready || state.allowedServices.length < 2;
    if (!select.dataset.gristServiceBound) {
      select.dataset.gristServiceBound = "true";
      select.addEventListener("change", () => {
        const nextService = core.normalizeService(select.value);
        if (!state.allowedServices.includes(nextService) || nextService === state.selectedService) {
          select.value = state.selectedService;
          return;
        }
        state.selectedService = nextService;
        writeStorage(core.SERVICE_STORAGE_KEY, nextService);
        applyReadonlyUi();
        notify();
        scheduleReload();
      });
    }

    if (badge) {
      badge.className = "grist-service-context-badge";
      if (!state.ready) {
        badge.textContent = "Chargement…";
      } else if (state.error) {
        badge.textContent = state.error.message;
        badge.classList.add("is-error");
      } else if (!state.homeService || state.selectedService !== state.homeService) {
        badge.textContent = "Lecture seule";
        badge.classList.add("is-readonly");
      } else {
        badge.textContent = "Modification autorisée";
      }
    }
  }

  function isWriteControl(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest("#grist-service-context-control")) return false;
    if (element.matches("[data-grist-service-selector], #firstColumnDropdown, #projectDropdown, #ps-project-select, #project-select")) {
      return false;
    }
    const marker = `${element.id} ${element.className} ${element.getAttribute("aria-label") || ""} ${element.title || ""} ${element instanceof HTMLButtonElement ? element.textContent : ""}`
      .toLocaleLowerCase("fr");
    return /(add|ajout|create|cré|edit|modif|save|enregistr|suppr|delete|remove|retir|manage|gér|bulk|archive|valider|confirmer)/.test(marker);
  }

  function applyReadonlyUi() {
    if (!document.body) return;
    const readOnly = !state.homeService || state.selectedService !== state.homeService;
    document.body.dataset.gristServiceReadonly = String(readOnly);
    document.querySelectorAll("button, input, select, textarea, [contenteditable]").forEach((element) => {
      if (!isWriteControl(element)) return;
      element.dataset.serviceWriteControl = "true";
      if (readOnly) {
        if ("disabled" in element && !element.disabled) {
          element.dataset.serviceContextDisabled = "true";
          element.disabled = true;
        }
        if (element.hasAttribute("contenteditable")) {
          element.dataset.serviceContextContenteditable = element.getAttribute("contenteditable") || "true";
          element.setAttribute("contenteditable", "false");
        }
      } else {
        if (element.dataset.serviceContextDisabled === "true") {
          element.disabled = false;
          delete element.dataset.serviceContextDisabled;
        }
        if (element.dataset.serviceContextContenteditable != null) {
          element.setAttribute("contenteditable", element.dataset.serviceContextContenteditable);
          delete element.dataset.serviceContextContenteditable;
        }
      }
    });
    if (!readonlyObserver) {
      readonlyObserver = new MutationObserver(() => applyReadonlyUi());
      readonlyObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function filterRecords(records) {
    const serviceFiltered = core.filterRawTableByService(records, state.selectedService);
    return filterExternalProjectScope(serviceFiltered, "");
  }

  function subscribeToRecords(callback, ...args) {
    const grist = getGrist();
    if (typeof grist?.onRecords !== "function") {
      throw new Error("API Grist onRecords indisponible.");
    }
    return grist.onRecords((records, mappings) => (
      initialize().then(() => callback(filterRecords(records), mappings))
    ), ...args);
  }

  function subscribeToRecord(callback, ...args) {
    const grist = getGrist();
    if (typeof grist?.onRecord !== "function") {
      throw new Error("API Grist onRecord indisponible.");
    }
    return grist.onRecord((record, mappings) => (
      initialize().then(() => {
        const filtered = filterRecords(record ? [record] : []);
        return callback(filtered[0] || null, mappings);
      })
    ), ...args);
  }

  function getExternalGrantScope() {
    return core.getExternalProjectGrantScope(
      state.teamRow,
      state.selectedService,
      state.homeService
    );
  }

  function getFirstProjectValue(row, candidates) {
    for (const candidate of candidates) {
      const value = core.toText(row?.[candidate]);
      if (value) return value;
    }
    return "";
  }

  function filterExternalProjectScope(raw, tableName) {
    const scope = getExternalGrantScope();
    if (!scope) return raw;
    const normalizedTableName = core.toText(tableName);
    if (normalizedTableName === "Emetteurs" || /^Time[-_]?Out$/i.test(normalizedTableName)) {
      return raw;
    }

    return core.filterRawTable(raw, (row) => {
      const projectNumber = core.normalizeProjectNumber(getFirstProjectValue(row, [
        "NumeroProjet",
        "Numero_de_projet",
        "Numero_Projet",
        "Project_Number",
      ]));
      if (projectNumber) return scope.numbers.has(projectNumber);

      const projectName = getFirstProjectValue(row, [
        "NomProjet",
        "Nom_projet",
        "Nom_de_projet",
        "Projet",
      ]);
      if (projectName) return scope.names.has(projectName);

      // Rows with no project identity are service-level data (for example Emetteurs).
      return true;
    });
  }

  function patchGristApi() {
    const grist = getGrist();
    if (!grist) return false;

    if (grist.docApi?.fetchTable && !grist.docApi.__serviceContextPatched) {
      const docApi = grist.docApi;
      rawFetchTable = docApi.fetchTable.bind(docApi);
      rawApplyUserActions = docApi.applyUserActions?.bind(docApi) || null;
      docApi.fetchTable = async function serviceAwareFetchTable(tableName) {
        await initialize();
        const raw = await rawFetchTable(tableName);
        const serviceFiltered = core.SERVICE_AWARE_TABLES.has(core.toText(tableName))
          ? core.filterRawTableByService(raw, state.selectedService)
          : raw;
        return filterExternalProjectScope(serviceFiltered, tableName);
      };
      if (rawApplyUserActions) {
        docApi.applyUserActions = async function serviceAwareApplyUserActions(actions) {
          await initialize();
          const hasMutation = (actions || []).some(core.isMutationAction);
          if (hasMutation && (!state.homeService || state.selectedService !== state.homeService)) {
            throw new Error(`Le service ${state.selectedService || "sélectionné"} est accessible en lecture seule.`);
          }
          const project = resolveCurrentProject();
          return rawApplyUserActions(core.transformActions(actions, {
            selectedService: state.selectedService,
            projectNumber: project?.number || "",
          }));
        };
      }
      Object.defineProperty(docApi, "__serviceContextPatched", { value: true });
    }

    return true;
  }

  function patchWhenReady() {
    if (patchGristApi()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (patchGristApi() || attempts > 100) window.clearInterval(timer);
    }, 20);
  }

  window.GristServiceContext = Object.freeze({
    whenReady: initialize,
    refresh,
    getState: getPublicState,
    getService: () => state.selectedService || core.normalizeService(readStorage(core.SERVICE_STORAGE_KEY)),
    getHomeService: () => state.homeService,
    getCurrentProject: () => state.currentProject ? { ...state.currentProject } : null,
    isReadOnly: () => !state.homeService || state.selectedService !== state.homeService,
    onRecords: subscribeToRecords,
    onRecord: subscribeToRecord,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      if (state.ready) listener(getPublicState());
      return () => listeners.delete(listener);
    },
  });

  patchWhenReady();
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.matches("#firstColumnDropdown, #projectDropdown, #ps-project-select, #project-select")) return;
    window.setTimeout(() => {
      const previousService = state.selectedService;
      reconcileSelection();
      mountSelector();
      applyReadonlyUi();
      notify();
      if (previousService && previousService !== state.selectedService) scheduleReload();
    }, 0);
  });
  window.addEventListener("storage", (event) => {
    if (event.key === "grist.service-grants-changed") {
      refresh().catch((error) => console.warn("Actualisation des autorisations impossible :", error));
      return;
    }
    if (event.key === core.SERVICE_STORAGE_KEY) {
      const nextService = core.normalizeService(event.newValue);
      if (nextService && nextService !== state.selectedService) scheduleReload();
      return;
    }
    if ([core.PROJECT_STORAGE_KEY, core.PROJECT_ID_STORAGE_KEY].includes(event.key)) {
      window.setTimeout(() => {
        const previousService = state.selectedService;
        reconcileSelection();
        mountSelector();
        applyReadonlyUi();
        notify();
        if (previousService && previousService !== state.selectedService) scheduleReload();
      }, 0);
    }
  });
  window.addEventListener("focus", () => {
    if (state.ready) {
      refresh().catch((error) => console.warn("Actualisation du contexte Service impossible :", error));
    }
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountSelector();
    });
  } else {
    mountSelector();
  }
})(typeof window !== "undefined" ? window : null);
