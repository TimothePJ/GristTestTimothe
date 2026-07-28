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
    const projectSelect = document.querySelector(
      "#firstColumnDropdown, #projectDropdown, #ps-project-select, #project-select"
    );
    if (projectSelect) {
      return projectSelect.closest(
        ".dropdown-container, .filters, .ps-project, .project-selection"
      )?.parentElement || projectSelect.parentElement;
    }
    return document.querySelector(".global-header, .app-header, header, body");
  }

  function injectStyles() {
    if (document.getElementById("grist-service-context-styles")) return;
    const style = document.createElement("style");
    style.id = "grist-service-context-styles";
    style.textContent = `
      .grist-service-context-control{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;border:1px solid #d7e1eb;border-radius:8px;background:#fff;color:#17324d;font:600 13px/1.25 Arial,sans-serif;box-sizing:border-box}
      .grist-service-context-control label{font-weight:700}
      .grist-service-context-control select{min-width:130px;padding:5px 8px;border:1px solid #aebdca;border-radius:5px;background:#fff;color:#17324d}
      .grist-service-context-badge{padding:4px 8px;border-radius:999px;background:#e8f5ec;color:#1e6b37;font-size:11px;white-space:nowrap}
      .grist-service-context-badge.is-readonly{background:#fff0d8;color:#8b4e00}
      .grist-service-context-badge.is-error{background:#fde7e7;color:#a51d1d}
      body[data-grist-service-readonly="true"] [data-service-write-control]{opacity:.55;cursor:not-allowed}
    `;
    document.head.appendChild(style);
  }

  function getOrCreateSelector() {
    const adopted = document.querySelector("[data-grist-service-selector]");
    if (adopted instanceof HTMLSelectElement) {
      adopted.dataset.gristServiceManaged = "true";
      let badge = document.getElementById("grist-service-context-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.id = "grist-service-context-badge";
        badge.className = "grist-service-context-badge";
        adopted.parentElement?.appendChild(badge);
      }
      return { select: adopted, badge, wrapper: adopted.closest("label") || adopted.parentElement };
    }

    let wrapper = document.getElementById("grist-service-context-control");
    if (!wrapper) {
      const host = selectorHost();
      if (!host) return {};
      wrapper = document.createElement("div");
      wrapper.id = "grist-service-context-control";
      wrapper.className = "grist-service-context-control";
      wrapper.innerHTML = `
        <label for="grist-service-select">Service :</label>
        <select id="grist-service-select" data-grist-service-selector data-grist-service-managed="true"></select>
        <span id="grist-service-context-badge" class="grist-service-context-badge"></span>
      `;
      host.appendChild(wrapper);
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
