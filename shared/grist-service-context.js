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
    teamRows: [],
    projectTeamRows: [],
    catalogProjects: [],
    projects: [],
    homeService: "",
    selectedService: "",
    allowedServices: [],
    currentProject: null,
    isAdmin: false,
    effectiveProjectNumbers: new Set(),
    teamProjectNumbersById: new Map(),
    projectByNumber: new Map(),
    projectScope: { numbers: new Set(), names: new Set() },
    unresolvedProjectTeamCount: 0,
    error: null,
  };
  const ACCESS_CACHE_TTL_MS = 45000;
  const CONTEXT_TABLE_CACHE_TTL_MS = 30000;
  const REST_PROJECT_VALUES_PER_REQUEST = 40;
  const REST_FILTER_MAX_ENCODED_LENGTH = 1800;
  const REST_MAX_CONCURRENCY = 3;
  const REST_ADMIN_MAX_CHUNKS = 12;
  const DEFAULT_WATCH_POLL_INTERVAL_MS = 30000;
  const ACCESS_TABLES = new Set(["Team", core.PROJECTS_TABLE, core.PROJECT_TEAM_TABLE]);
  const listeners = new Set();
  const recordSubscribers = new Set();
  let initializePromise = null;
  let refreshPromise = null;
  let rawFetchTable = null;
  let rawApplyUserActions = null;
  let readonlyObserver = null;
  let recordsSubscription = null;
  let recordsSubscriptionStarted = false;
  let latestRawRecords = null;
  let latestRecordMappings = null;
  let rawRecordsVersion = 0;
  let selectionGeneration = 0;
  let accessLoadedAt = 0;
  let accessCacheInvalidated = true;
  let accessSignalSequence = 0;
  let storageSelectionTimer = 0;
  const rawTableCache = new Map();
  const contextTableCache = new Map();
  const contextTableEpochs = new Map();
  const contextWatchers = new Set();
  let accessTokenEntry = null;
  let accessTokenPromise = null;
  let restVisibilityEntry = null;
  let restFallbackWarningShown = false;

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
      const normalizedValue = value == null ? "" : String(value);
      const previousValue = window.localStorage?.getItem(key) || "";
      if (previousValue === normalizedValue) return false;
      if (normalizedValue) window.localStorage?.setItem(key, normalizedValue);
      else window.localStorage?.removeItem(key);
      return true;
    } catch (_error) {
      // localStorage may be unavailable in sandboxed widgets.
      return false;
    }
  }

  function buildProjects(rawProjects) {
    return core.groupProjectsByNumber(rawProjects)
      .filter((project) => Number(project.id) > 0);
  }

  function resolveCurrentProject() {
    return core.selectAllowedProject(state.projects, {
      projectId: readStorage(core.PROJECT_ID_STORAGE_KEY),
      projectName: readStorage(core.PROJECT_STORAGE_KEY),
      projectNumber: readStorage(core.PROJECT_STORAGE_KEY),
    });
  }

  function persistCurrentProject(project) {
    if (!project) {
      writeStorage(core.PROJECT_STORAGE_KEY, "");
      writeStorage(core.PROJECT_ID_STORAGE_KEY, "");
      return;
    }
    writeStorage(core.PROJECT_STORAGE_KEY, project.name);
    writeStorage(core.PROJECT_ID_STORAGE_KEY, String(project.id));
  }

  function isMultiProjectContext() {
    return Boolean(document.body?.hasAttribute("data-service-context-multiproject"));
  }

  function buildAccessIndex() {
    state.homeService = core.normalizeService(state.teamRow?.Service);
    state.isAdmin = core.isAdminTeamRow(state.teamRow);
    const resolvedAssignments = core.resolveProjectTeamRows(
      state.teamRows,
      state.projectTeamRows
    );
    const projectNumbersByTeamId = new Map();

    state.teamRows.forEach((row) => {
      const teamId = Number(row?.id);
      if (teamId > 0) projectNumbersByTeamId.set(teamId, new Set());
    });
    core.groupTeamPeople(state.teamRows).forEach((person) => {
      const numbers = new Set();
      person.teamRows.forEach((row) => {
        core.parseProjectAccess(row?.[core.ACCESS_COLUMN]).forEach((grant) => {
          numbers.add(grant.projectNumber);
        });
      });
      person.teamIds.forEach((teamId) => {
        projectNumbersByTeamId.set(Number(teamId), new Set(numbers));
      });
    });
    resolvedAssignments.matched.forEach((assignment) => {
      const teamId = Number(assignment.teamId);
      if (!projectNumbersByTeamId.has(teamId)) projectNumbersByTeamId.set(teamId, new Set());
      projectNumbersByTeamId.get(teamId).add(assignment.projectNumber);
    });

    const effectiveNumbers = new Set();
    core.getEquivalentTeamRows(state.teamRow, state.teamRows).forEach((row) => {
      const teamId = Number(row?.id);
      projectNumbersByTeamId.get(teamId)?.forEach((number) => effectiveNumbers.add(number));
    });

    state.teamProjectNumbersById = projectNumbersByTeamId;
    state.effectiveProjectNumbers = effectiveNumbers;
    state.unresolvedProjectTeamCount = resolvedAssignments.unresolved.length;
    state.projectByNumber = new Map(
      state.catalogProjects.map((project) => [project.number, project])
    );
    state.projects = state.isAdmin
      ? [...state.catalogProjects]
      : state.catalogProjects.filter((project) => effectiveNumbers.has(project.number));
    state.projectScope = core.getProjectScope(state.projects, state.catalogProjects);
  }

  function reconcileServices() {
    if (isMultiProjectContext()) {
      state.allowedServices = state.homeService && state.projects.length
        ? [...core.SERVICES]
        : [];
    } else {
      const hasProjectAccess = state.isAdmin || state.effectiveProjectNumbers.has(
        state.currentProject?.number || ""
      );
      state.allowedServices = state.homeService && state.currentProject && hasProjectAccess
        ? [...core.SERVICES]
        : [];
    }
    const storedService = core.normalizeService(readStorage(core.SERVICE_STORAGE_KEY));
    const requestedService = state.allowedServices.includes(state.selectedService)
      ? state.selectedService
      : storedService;
    state.selectedService = state.allowedServices.includes(requestedService)
      ? requestedService
      : (state.allowedServices.includes(state.homeService)
        ? state.homeService
        : (state.allowedServices[0] || ""));
  }

  function reconcileSelection({ persist = true, keepCurrentProject = false } = {}) {
    buildAccessIndex();
    if (!keepCurrentProject || !state.projects.some(
      (project) => project.number === state.currentProject?.number
    )) {
      state.currentProject = resolveCurrentProject();
    } else {
      state.currentProject = state.projects.find(
        (project) => project.number === state.currentProject?.number
      ) || null;
    }
    reconcileServices();
    if (persist) {
      persistCurrentProject(state.currentProject);
      writeStorage(core.SERVICE_STORAGE_KEY, state.selectedService);
    }
  }

  function getCurrentAccessMode() {
    if (!state.currentProject || !state.selectedService) return "hidden";
    if (!state.allowedServices.includes(state.selectedService)) return "hidden";
    if (state.selectedService !== state.homeService) return "readonly";
    return "editable";
  }

  function canEditCurrentSelection() {
    return getCurrentAccessMode() === "editable";
  }

  function cloneProject(project) {
    if (!project) return null;
    return {
      ...project,
      ids: Array.isArray(project.ids) ? [...project.ids] : [],
      names: Array.isArray(project.names) ? [...project.names] : [],
    };
  }

  function getPublicState(generation = selectionGeneration) {
    const currentProject = cloneProject(state.currentProject);
    return {
      ready: state.ready,
      teamRow: state.teamRow ? { ...state.teamRow } : null,
      homeService: state.homeService,
      selectedService: state.selectedService,
      allowedServices: [...state.allowedServices],
      allowedProjects: state.projects.map(cloneProject),
      currentProject,
      projectAliases: currentProject?.names?.length
        ? [...currentProject.names]
        : [currentProject?.name].filter(Boolean),
      isAdmin: state.isAdmin,
      unresolvedProjectTeamCount: state.unresolvedProjectTeamCount,
      accessMode: getCurrentAccessMode(),
      isReadOnly: !canEditCurrentSelection(),
      generation,
      error: state.error,
    };
  }

  function notify(detail = getPublicState()) {
    window.dispatchEvent(new CustomEvent("grist-service-context-change", { detail }));
    listeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        console.error("Erreur abonné contexte Service :", error);
      }
    });
  }

  function isFreshTimestamp(timestamp, ttl = ACCESS_CACHE_TTL_MS) {
    return timestamp > 0 && Date.now() - timestamp < ttl;
  }

  function getTableRowCount(table) {
    try {
      return core.tableToRows(table).length;
    } catch (_error) {
      return 0;
    }
  }

  function logDataPath(mode, tableName, details = {}) {
    const label = `[GristData][${mode}] ${core.toText(tableName) || "table inconnue"}`;
    const logger = mode.includes("FALLBACK") ? console.warn : console.info;
    logger.call(console, label, details);
  }

  function invalidateRawTableCache(tableName) {
    const normalizedTableName = core.toText(tableName);
    if (normalizedTableName) rawTableCache.delete(normalizedTableName);
  }

  function invalidateAccessCache() {
    accessCacheInvalidated = true;
    accessLoadedAt = 0;
    ACCESS_TABLES.forEach(invalidateContextTable);
  }

  async function fetchRawTableCached(tableName, { forceRefresh = false, ttl = ACCESS_CACHE_TTL_MS } = {}) {
    const normalizedTableName = core.toText(tableName);
    const effectiveTtl = ACCESS_TABLES.has(normalizedTableName)
      ? ttl
      : Math.min(ttl, CONTEXT_TABLE_CACHE_TTL_MS);

    const cached = rawTableCache.get(normalizedTableName);
    if (!forceRefresh && cached?.value != null && isFreshTimestamp(cached.loadedAt, effectiveTtl)) {
      logDataPath("CACHE FETCHTABLE", normalizedTableName, {
        lignes: getTableRowCount(cached.value),
      });
      return cached.value;
    }
    if (cached?.promise) return cached.promise;

    const entry = cached || { value: null, loadedAt: 0, promise: null };
    entry.promise = Promise.resolve(rawFetchTable(normalizedTableName)).then((value) => {
      entry.value = value;
      entry.loadedAt = Date.now();
      logDataPath("FETCHTABLE COMPLET", normalizedTableName, {
        lignes: getTableRowCount(value),
      });
      return value;
    }).finally(() => {
      entry.promise = null;
    });
    rawTableCache.set(normalizedTableName, entry);
    return entry.promise;
  }

  function emptyTableData() {
    return { id: [] };
  }

  function getContextTableEpoch(tableName) {
    return contextTableEpochs.get(core.toText(tableName)) || 0;
  }

  function invalidateContextTable(tableName) {
    const normalizedTableName = core.toText(tableName);
    if (!normalizedTableName) return;
    contextTableEpochs.set(normalizedTableName, getContextTableEpoch(normalizedTableName) + 1);
    for (const [key, entry] of contextTableCache) {
      if (entry.tableName === normalizedTableName) contextTableCache.delete(key);
    }
    invalidateRawTableCache(normalizedTableName);
  }

  function getContextTableCacheKey(tableName, contextSnapshot) {
    const multiProject = isMultiProjectContext();
    const projects = multiProject
      ? contextSnapshot.allowedProjects
      : [contextSnapshot.currentProject].filter(Boolean);
    const projectScope = projects.map((project) => ({
      number: core.normalizeProjectNumber(project?.number),
      names: core.uniqueExactValues([project?.name, ...(project?.names || [])]).sort(),
    })).sort((left, right) => (
      left.number.localeCompare(right.number) || left.names.join("\u0000").localeCompare(right.names.join("\u0000"))
    ));
    return JSON.stringify({
      tableName: core.toText(tableName),
      service: core.normalizeService(contextSnapshot.selectedService),
      multiProject,
      projectScope,
    });
  }

  function createRestUnavailableError(message, { status = 0, cause = null } = {}) {
    const error = new Error(message);
    error.name = "GristContextRestUnavailableError";
    error.isContextRestUnavailable = true;
    error.status = Number(status) || 0;
    if (cause) error.cause = cause;
    return error;
  }

  function warnRestFallback() {
    if (restFallbackWarningShown) return;
    restFallbackWarningShown = true;
    console.warn("Chargement REST filtré indisponible ; repli local Grist activé.");
  }

  function invalidateAccessToken() {
    accessTokenEntry = null;
    restVisibilityEntry = null;
  }

  function hasRestApiSupport() {
    const grist = getGrist();
    return Boolean(
      typeof window.fetch === "function" &&
      typeof grist?.docApi?.getAccessToken === "function"
    );
  }

  async function getReadOnlyAccessToken({ forceRefresh = false } = {}) {
    const grist = getGrist();
    if (typeof grist?.docApi?.getAccessToken !== "function") {
      throw createRestUnavailableError("Jeton temporaire Grist indisponible.");
    }
    const now = Date.now();
    if (
      !forceRefresh &&
      accessTokenEntry &&
      accessTokenEntry.expiresAt - accessTokenEntry.renewBeforeMs > now
    ) {
      return accessTokenEntry.access;
    }
    if (accessTokenPromise) return accessTokenPromise;

    accessTokenPromise = Promise.resolve(
      grist.docApi.getAccessToken({ readOnly: true })
    ).then((access) => {
      const baseUrl = core.toText(access?.baseUrl);
      const token = typeof access?.token === "string" ? access.token : "";
      const ttlMsecs = Math.max(0, Number(access?.ttlMsecs) || 0);
      if (!baseUrl || !token || !ttlMsecs) {
        throw createRestUnavailableError("Jeton temporaire Grist invalide.");
      }
      const renewBeforeMs = Math.min(
        30000,
        Math.max(100, Math.floor(ttlMsecs * 0.1)),
        Math.max(0, ttlMsecs - 1)
      );
      if (accessTokenEntry?.access?.token !== token) {
        restVisibilityEntry = null;
      }
      accessTokenEntry = {
        access: { baseUrl, token, ttlMsecs },
        expiresAt: Date.now() + ttlMsecs,
        renewBeforeMs,
      };
      return accessTokenEntry.access;
    }).catch((error) => {
      if (error?.isContextRestUnavailable) throw error;
      throw createRestUnavailableError("Obtention du jeton temporaire Grist impossible.", { cause: error });
    }).finally(() => {
      accessTokenPromise = null;
    });
    return accessTokenPromise;
  }

  async function fetchRestRecords(tableName, filter = null, {
    signal = null,
    authRetry = false,
    limit = null,
    cacheMode = "",
    accessOverride = null,
  } = {}) {
    if (typeof window.fetch !== "function") {
      throw createRestUnavailableError("API fetch indisponible.");
    }
    const access = accessOverride || await getReadOnlyAccessToken();
    const baseUrl = access.baseUrl.replace(/\/+$/, "");
    const query = [];
    if (filter && typeof filter === "object") {
      query.push(`filter=${encodeURIComponent(JSON.stringify(filter))}`);
    }
    const normalizedLimit = Math.floor(Number(limit));
    if (normalizedLimit > 0) query.push(`limit=${normalizedLimit}`);
    query.push(`auth=${encodeURIComponent(access.token)}`);
    const url = `${baseUrl}/tables/${encodeURIComponent(tableName)}/records?${query.join("&")}`;
    const fetchOptions = {};
    if (signal) fetchOptions.signal = signal;
    if (cacheMode) fetchOptions.cache = cacheMode;
    let response;
    try {
      response = await window.fetch(
        url,
        Object.keys(fetchOptions).length ? fetchOptions : undefined
      );
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw createRestUnavailableError("Requête REST Grist impossible.", { cause: error });
    }

    if ([401, 403].includes(Number(response?.status))) {
      invalidateAccessToken();
      if (!authRetry) {
        await getReadOnlyAccessToken({ forceRefresh: true });
        return fetchRestRecords(tableName, filter, {
          signal,
          authRetry: true,
          limit,
          cacheMode,
          accessOverride: null,
        });
      }
    }
    if (!response?.ok) {
      throw createRestUnavailableError("Réponse REST Grist en erreur.", {
        status: response?.status,
      });
    }

    let envelope;
    try {
      envelope = await response.json();
    } catch (error) {
      throw createRestUnavailableError("Réponse JSON Grist invalide.", { cause: error });
    }
    if (!envelope || !Array.isArray(envelope.records)) {
      throw createRestUnavailableError("Réponse REST Grist invalide.");
    }
    return envelope;
  }

  async function ensureRestDocumentVisibility() {
    if (!state.catalogProjects.length) return null;

    const access = await getReadOnlyAccessToken();
    if (restVisibilityEntry?.access === access) {
      if (restVisibilityEntry.status === "available") return restVisibilityEntry.access;
      if (restVisibilityEntry.status === "unavailable") {
        throw restVisibilityEntry.error || createRestUnavailableError(
          "Le jeton REST Grist ne voit aucune donnée du document."
        );
      }
      return restVisibilityEntry.promise;
    }

    const entry = {
      access,
      status: "checking",
      error: null,
      promise: null,
    };
    restVisibilityEntry = entry;
    entry.promise = fetchRestRecords(core.PROJECTS_TABLE, null, {
      limit: 1,
      cacheMode: "no-store",
      accessOverride: access,
    }).then((envelope) => {
      if (!envelope.records.length) {
        throw createRestUnavailableError(
          "Le serveur Grist ne transmet pas l'identite du widget au jeton REST. " +
          "Une mise a jour du serveur Grist est necessaire."
        );
      }
      logDataPath("SONDE REST OK", core.PROJECTS_TABLE, {
        lignes: envelope.records.length,
      });
      if (restVisibilityEntry === entry) entry.status = "available";
      return accessTokenEntry?.access || access;
    }).catch((error) => {
      if (error?.name === "AbortError") {
        if (restVisibilityEntry === entry) restVisibilityEntry = null;
        throw error;
      }
      const unavailableError = error?.isContextRestUnavailable
        ? error
        : createRestUnavailableError(
            "Vérification de la visibilité REST Grist impossible.",
            { cause: error }
          );
      if (restVisibilityEntry === entry) {
        entry.status = "unavailable";
        entry.error = unavailableError;
      }
      throw unavailableError;
    });
    return entry.promise;
  }

  async function verifyEmptyRestTable(tableName, access, { signal = null } = {}) {
    const probe = await fetchRestRecords(tableName, null, {
      signal,
      limit: 1,
      cacheMode: "no-store",
      accessOverride: access,
    });
    if (probe.records.length) return null;

    const raw = await fetchRawTableCached(tableName);
    if (!core.tableToRows(raw).length) return null;

    const error = createRestUnavailableError(
      `Le serveur Grist ne transmet pas l'identite du widget au jeton REST pour la table ${tableName}. ` +
      "Une mise a jour du serveur Grist est necessaire."
    );
    if (restVisibilityEntry?.access === access) {
      restVisibilityEntry.status = "unavailable";
      restVisibilityEntry.error = error;
    }
    return raw;
  }

  async function mapWithConcurrency(values, limit, mapper) {
    const source = Array.isArray(values) ? values : [];
    const results = new Array(source.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < source.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(source[index], index);
      }
    };
    const workerCount = Math.min(Math.max(1, Number(limit) || 1), source.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  function buildContextFilterPlan(tableName, contextSnapshot) {
    const spec = core.buildContextTableFilter(tableName, {
      selectedService: contextSnapshot.selectedService,
      currentProject: contextSnapshot.currentProject,
      allowedProjects: contextSnapshot.allowedProjects,
      multiProject: isMultiProjectContext(),
    });
    if (!spec.complete || !spec.filter) return { ...spec, filters: [] };

    let filters = core.splitContextTableFilter(spec.filter, spec.projectColumn, {
      maxValues: REST_PROJECT_VALUES_PER_REQUEST,
      maxEncodedLength: REST_FILTER_MAX_ENCODED_LENGTH,
    });
    if (contextSnapshot.isAdmin && filters.length > REST_ADMIN_MAX_CHUNKS) {
      filters = [{ Service: [...spec.filter.Service] }];
    }
    return { ...spec, filters };
  }

  async function loadRestContextTable(tableName, contextSnapshot, filterPlan, { signal = null } = {}) {
    const access = await ensureRestDocumentVisibility();
    const envelopes = await mapWithConcurrency(
      filterPlan.filters,
      REST_MAX_CONCURRENCY,
      (filter) => fetchRestRecords(tableName, filter, { signal, accessOverride: access })
    );
    const merged = core.mergeRestRecordEnvelopes(envelopes);
    if (!merged.records.length) {
      const rawFallback = await verifyEmptyRestTable(tableName, access, { signal });
      if (rawFallback) {
        warnRestFallback();
        const table = filterTableData(rawFallback, tableName, contextSnapshot);
        logDataPath("FALLBACK FETCHTABLE", tableName, {
          raison: "REST ne voit aucune ligne alors que la table Grist contient des donnees.",
          lignesUtiles: getTableRowCount(table),
        });
        return {
          table,
          source: "fallback",
        };
      }
    }
    const table = core.restRecordsToTableData(merged);
    const filteredTable = filterTableData(table, tableName, contextSnapshot);
    logDataPath("REST FILTRE", tableName, {
      lignesRecues: merged.records.length,
      lignesUtiles: getTableRowCount(filteredTable),
      requetes: envelopes.length,
      service: contextSnapshot.selectedService,
      projet: contextSnapshot.currentProject?.number || contextSnapshot.currentProject?.name || "multi-projets",
    });
    return {
      table: filteredTable,
      source: "rest",
    };
  }

  async function loadFallbackContextTable(tableName, contextSnapshot, reason = "REST indisponible") {
    const raw = await fetchRawTableCached(tableName);
    const table = filterTableData(raw, tableName, contextSnapshot);
    logDataPath("FALLBACK FETCHTABLE", tableName, {
      raison: reason,
      lignesCompletes: getTableRowCount(raw),
      lignesUtiles: getTableRowCount(table),
    });
    return {
      table,
      source: "fallback",
    };
  }

  async function fetchContextTableInternal(tableName, {
    forceRefresh = false,
    ttl = CONTEXT_TABLE_CACHE_TTL_MS,
    signal = null,
  } = {}) {
    await initialize();
    const normalizedTableName = core.toText(tableName);
    const contextSnapshot = getPublicState();
    const filterPlan = buildContextFilterPlan(normalizedTableName, contextSnapshot);

    if (filterPlan.supported && !filterPlan.complete) {
      return { table: emptyTableData(), source: "empty", stale: false };
    }
    if (!filterPlan.supported) {
      return loadFallbackContextTable(
        normalizedTableName,
        contextSnapshot,
        "Cette table n'a pas de filtre REST configure."
      );
    }

    const cacheKey = getContextTableCacheKey(normalizedTableName, contextSnapshot);
    const cached = contextTableCache.get(cacheKey);
    if (!forceRefresh && cached?.value && isFreshTimestamp(cached.loadedAt, ttl)) {
      logDataPath("CACHE", normalizedTableName, {
        source: cached.value.source,
        lignes: getTableRowCount(cached.value.table),
      });
      return cached.value;
    }
    if (cached?.promise) return cached.promise;

    const requestGeneration = contextSnapshot.generation;
    const requestEpoch = getContextTableEpoch(normalizedTableName);
    const entry = cached || {
      tableName: normalizedTableName,
      value: null,
      loadedAt: 0,
      promise: null,
    };
    const promise = (async () => {
      let loaded;
      if (hasRestApiSupport()) {
        try {
          loaded = await loadRestContextTable(
            normalizedTableName,
            contextSnapshot,
            filterPlan,
            { signal }
          );
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          if (!error?.isContextRestUnavailable) throw error;
          warnRestFallback();
          loaded = await loadFallbackContextTable(
            normalizedTableName,
            contextSnapshot,
            error?.message || "REST indisponible"
          );
        }
      } else {
        loaded = await loadFallbackContextTable(
          normalizedTableName,
          contextSnapshot,
          "fetch ou getAccessToken est indisponible."
        );
      }

      const stale = requestGeneration !== selectionGeneration ||
        requestEpoch !== getContextTableEpoch(normalizedTableName);
      const value = stale
        ? { table: emptyTableData(), source: loaded.source, stale: true }
        : { ...loaded, stale: false };
      if (!stale) {
        entry.value = value;
        entry.loadedAt = Date.now();
      }
      return value;
    })().finally(() => {
      if (entry.promise === promise) entry.promise = null;
    });
    entry.promise = promise;
    contextTableCache.set(cacheKey, entry);
    return promise;
  }

  async function fetchContextTable(tableName, options = {}) {
    const result = await fetchContextTableInternal(tableName, options);
    return result.table;
  }

  async function fetchContextRows(tableName, options = {}) {
    return core.tableToRows(await fetchContextTable(tableName, options));
  }

  async function loadIdentityAndProjects({ forceRefresh = false } = {}) {
    const grist = await waitForDocApi();
    if (!rawFetchTable) {
      rawFetchTable = grist.docApi.fetchTable.bind(grist.docApi);
    }
    if (
      !forceRefresh &&
      !accessCacheInvalidated &&
      isFreshTimestamp(accessLoadedAt) &&
      state.teamRows.length
    ) {
      reconcileSelection({ keepCurrentProject: true });
      return;
    }
    const [rawTeam, rawProjects, rawProjectTeam] = await Promise.all([
      fetchRawTableCached("Team", { forceRefresh }),
      fetchRawTableCached(core.PROJECTS_TABLE, { forceRefresh }),
      fetchRawTableCached(core.PROJECT_TEAM_TABLE, { forceRefresh }),
    ]);
    const teamRows = core.tableToRows(rawTeam);
    state.teamRows = teamRows.filter((row) => Number(row?.id) > 0);
    state.projectTeamRows = core.tableToRows(rawProjectTeam)
      .filter((row) => Number(row?.id) > 0);
    state.teamRow = core.findCurrentTeamRow(state.teamRows);
    state.catalogProjects = buildProjects(rawProjects);
    accessLoadedAt = Date.now();
    accessCacheInvalidated = false;
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

  async function refresh({ forceRefresh = true } = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const previous = getPublicState();
      await loadIdentityAndProjects({ forceRefresh });
      state.ready = true;
      const contextChanged =
        previous.currentProject?.number !== state.currentProject?.number ||
        previous.selectedService !== state.selectedService ||
        previous.homeService !== state.homeService ||
        previous.accessMode !== getCurrentAccessMode();
      if (contextChanged) selectionGeneration += 1;
      const snapshot = getPublicState();
      mountSelector();
      applyReadonlyUi(snapshot);
      notify(snapshot);
      await Promise.all([
        emitLatestRecords("refresh", snapshot),
        refreshContextWatchers(null, "refresh"),
      ]);
      return snapshot;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function resolveAllowedProject(selection) {
    const value = selection && typeof selection === "object" ? selection : {};
    const textValue = selection && typeof selection !== "object"
      ? core.toText(selection)
      : "";
    const requestedId = Number(value.projectId ?? value.id);
    const requestedNumber = core.normalizeProjectNumber(
      value.projectNumber ?? value.number ?? textValue
    );
    const requestedName = core.normalizeProjectNameKey(
      value.projectName ?? value.name ?? textValue
    );

    if (Number.isInteger(requestedId) && requestedId > 0) {
      const byId = state.projects.find((project) => (
        Number(project.id) === requestedId ||
        project.ids?.map(Number).includes(requestedId)
      ));
      if (byId) return byId;
    }
    if (requestedNumber) {
      const byNumber = state.projects.find((project) => project.number === requestedNumber);
      if (byNumber) return byNumber;
    }
    if (requestedName) {
      const byName = state.projects.find((project) => (
        core.normalizeProjectNameKey(project.name) === requestedName ||
        project.names?.some(
          (name) => core.normalizeProjectNameKey(name) === requestedName
        )
      ));
      if (byName) return byName;
    }
    return null;
  }

  async function selectProject(selection, { persist = true, reason = "selection" } = {}) {
    if (!state.ready) await initialize();

    const project = resolveAllowedProject(selection);
    if (!project) {
      throw new Error("Ce projet n'est pas autorisé pour l'utilisateur courant.");
    }
    if (state.currentProject?.number === project.number) return getPublicState();

    const previousProjectNumber = state.currentProject?.number || "";
    const previousService = state.selectedService;
    const requestGeneration = ++selectionGeneration;
    state.currentProject = project;
    reconcileServices();
    if (persist) {
      persistCurrentProject(project);
      writeStorage(core.SERVICE_STORAGE_KEY, state.selectedService);
    }
    mountSelector();
    const snapshot = getPublicState(requestGeneration);
    applyReadonlyUi(snapshot);
    if (
      previousProjectNumber !== (snapshot.currentProject?.number || "") ||
      previousService !== snapshot.selectedService
    ) {
      notify(snapshot);
      await Promise.all([
        emitLatestRecords(reason, snapshot),
        refreshContextWatchers(null, reason),
      ]);
    }
    return snapshot;
  }

  async function selectService(service, { persist = true, reason = "service-selection" } = {}) {
    if (!state.ready) await initialize();
    const normalizedService = core.normalizeService(service);
    if (!state.allowedServices.includes(normalizedService)) {
      throw new Error(`Le service ${core.toText(service) || "demandé"} n'est pas autorisé.`);
    }
    if (normalizedService === state.selectedService) return getPublicState();

    const requestGeneration = ++selectionGeneration;
    state.selectedService = normalizedService;
    if (persist) writeStorage(core.SERVICE_STORAGE_KEY, normalizedService);
    mountSelector();
    const snapshot = getPublicState(requestGeneration);
    applyReadonlyUi(snapshot);
    notify(snapshot);
    await Promise.all([
      emitLatestRecords(reason, snapshot),
      refreshContextWatchers(null, reason),
    ]);
    return snapshot;
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
      body[data-grist-service-readonly="true"] select:not([data-grist-service-selector]):not(#grist-service-select){opacity:1!important;background-color:#fff7e8!important;border-color:#d8ad69!important;color:#764500!important;-webkit-text-fill-color:#764500!important}
      body[data-grist-service-readonly="true"] select:not([data-grist-service-selector]):not(#grist-service-select):open{background-color:#fffaf3!important;color:#9a7441!important;-webkit-text-fill-color:#9a7441!important}
      body[data-grist-service-readonly="true"] select:not([data-grist-service-selector]):not(#grist-service-select) option,
      body[data-grist-service-readonly="true"] select:not([data-grist-service-selector]):not(#grist-service-select) optgroup{background-color:#fffaf3!important;color:#9a7441!important;-webkit-text-fill-color:#9a7441!important}
      body[data-grist-service-readonly="true"] select:not([data-grist-service-selector]):not(#grist-service-select) option:checked{background:linear-gradient(#ffedcc,#ffedcc)!important;color:#6a3c00!important;-webkit-text-fill-color:#6a3c00!important}
      body[data-grist-service-readonly="true"] .checkbox-dropdown-button{opacity:1!important;background-color:#fff7e8!important;border-color:#d8ad69!important;color:#764500!important}
      body[data-grist-service-readonly="true"] .checkbox-dropdown .checkbox-list:not([hidden]){background-color:#fffaf3!important;border-color:#e4c28b!important;color:#9a7441!important}
      body[data-grist-service-readonly="true"] .checkbox-dropdown .checkbox-list-item:hover{background-color:#ffedcc!important;color:#6a3c00!important}
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
      const fragment = document.createDocumentFragment();
      state.allowedServices.forEach((service) => {
        const option = document.createElement("option");
        option.value = service;
        option.textContent = service;
        fragment.appendChild(option);
      });
      select.replaceChildren(fragment);
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
        selectService(nextService).catch((error) => {
          select.value = state.selectedService;
          console.warn("Changement de service impossible :", error);
        });
      });
    }

    if (badge) {
      const accessMode = getCurrentAccessMode();
      badge.className = "grist-service-context-badge";
      if (!state.ready) {
        badge.textContent = "Chargement…";
      } else if (state.error) {
        badge.textContent = state.error.message;
        badge.classList.add("is-error");
      } else if (accessMode === "hidden") {
        badge.textContent = "Aucun accès à ce projet";
        badge.classList.add("is-error");
      } else if (accessMode === "readonly") {
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
    if (element.matches("[data-service-context-navigation], [data-grist-service-selector], #firstColumnDropdown, #projectDropdown, #ps-project-select, #project-select")) {
      return false;
    }
    const marker = `${element.id} ${element.className} ${element.getAttribute("aria-label") || ""} ${element.title || ""} ${element instanceof HTMLButtonElement ? element.textContent : ""}`
      .toLocaleLowerCase("fr");
    return /(add|ajout|create|cré|edit|modif|save|enregistr|suppr|delete|remove|retir|manage|gér|bulk|archive|valider|confirmer)/.test(marker);
  }

  function applyReadonlyUi(contextSnapshot = getPublicState()) {
    if (!document.body) return;
    const accessMode = contextSnapshot?.accessMode || getCurrentAccessMode();
    const readOnly = accessMode !== "editable";
    document.body.dataset.gristServiceReadonly = String(readOnly);
    document.body.dataset.gristServiceAccessMode = accessMode;
    document.querySelectorAll("button, input, select, textarea, [contenteditable]").forEach((element) => {
      if (!isWriteControl(element)) return;
      element.dataset.serviceWriteControl = "true";
      element.dataset.serviceContextAccessMode = accessMode;
      if (readOnly) {
        if ("disabled" in element) {
          if (element.dataset.serviceContextDisabled !== "true") {
            element.dataset.serviceContextWasDisabled = String(Boolean(element.disabled));
          }
          element.dataset.serviceContextDisabled = "true";
          element.disabled = true;
        }
        if (element.hasAttribute("contenteditable")) {
          if (element.dataset.serviceContextContenteditable == null) {
            element.dataset.serviceContextContenteditable = element.getAttribute("contenteditable") || "true";
          }
          element.setAttribute("contenteditable", "false");
        }
        element.setAttribute("aria-disabled", "true");
      } else {
        if (element.dataset.serviceContextDisabled === "true") {
          element.disabled = element.dataset.serviceContextWasDisabled === "true";
          delete element.dataset.serviceContextDisabled;
          delete element.dataset.serviceContextWasDisabled;
        }
        if (element.dataset.serviceContextContenteditable != null) {
          element.setAttribute("contenteditable", element.dataset.serviceContextContenteditable);
          delete element.dataset.serviceContextContenteditable;
        }
        element.removeAttribute("aria-disabled");
      }
    });
    if (!readonlyObserver) {
      readonlyObserver = new MutationObserver(() => applyReadonlyUi(getPublicState()));
      readonlyObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function looksLikeProjectsTable(raw) {
    return core.tableToRows(raw).some((row) => (
      Object.prototype.hasOwnProperty.call(row || {}, "Numero_de_projet")
    ));
  }

  function filterTableData(raw, tableName = "", contextSnapshot = getPublicState()) {
    const normalizedTableName = core.toText(tableName);
    if (normalizedTableName === core.PROJECTS_TABLE || (!normalizedTableName && looksLikeProjectsTable(raw))) {
      return core.filterProjectsRaw(raw, contextSnapshot.allowedProjects);
    }

    const serviceFiltered = normalizedTableName
      ? (core.SERVICE_AWARE_TABLES.has(normalizedTableName)
          ? core.filterRawTableByService(raw, contextSnapshot.selectedService)
          : raw)
      : core.filterRawTableByService(raw, contextSnapshot.selectedService);
    if (normalizedTableName && !core.SERVICE_AWARE_TABLES.has(normalizedTableName)) {
      return serviceFiltered;
    }
    if (isMultiProjectContext()) {
      return core.filterRawTableByProjectScope(
        serviceFiltered,
        normalizedTableName,
        core.getProjectScope(contextSnapshot.allowedProjects, contextSnapshot.allowedProjects)
      );
    }
    return core.filterRawTableByProject(
      serviceFiltered,
      normalizedTableName,
      contextSnapshot.currentProject
    );
  }

  function filterRecords(records, contextSnapshot = getPublicState()) {
    return filterTableData(records, "", contextSnapshot);
  }

  function deliverRecordsToSubscriber(subscriber, reason, contextSnapshot = getPublicState()) {
    if (latestRawRecords == null || !recordSubscribers.has(subscriber)) return Promise.resolve();
    try {
      const filteredRecords = filterRecords(latestRawRecords, contextSnapshot);
      const delivery = {
        reason,
        generation: contextSnapshot.generation,
        rawVersion: rawRecordsVersion,
        context: {
          ...contextSnapshot,
          records: filteredRecords,
        },
      };
      return Promise.resolve(subscriber(
        filteredRecords,
        latestRecordMappings,
        delivery
      )).catch((error) => {
        console.error("Erreur abonné aux enregistrements Grist :", error);
      });
    } catch (error) {
      console.error("Erreur abonné aux enregistrements Grist :", error);
      return Promise.resolve();
    }
  }

  function emitLatestRecords(reason = "context-change", contextSnapshot = getPublicState()) {
    if (latestRawRecords == null) return Promise.resolve();
    return Promise.all(
      [...recordSubscribers].map((subscriber) => (
        deliverRecordsToSubscriber(subscriber, reason, contextSnapshot)
      ))
    );
  }

  function ensureRecordsSubscription(args = []) {
    if (recordsSubscriptionStarted) return recordsSubscription;
    const grist = getGrist();
    if (typeof grist?.onRecords !== "function") {
      throw new Error("API Grist onRecords indisponible.");
    }
    recordsSubscriptionStarted = true;
    try {
      recordsSubscription = grist.onRecords((records, mappings) => {
        latestRawRecords = records;
        latestRecordMappings = mappings;
        const version = ++rawRecordsVersion;
        initialize().then(() => {
          if (version !== rawRecordsVersion) return;
          return emitLatestRecords("records", getPublicState());
        });
      }, ...args);
    } catch (error) {
      recordsSubscriptionStarted = false;
      throw error;
    }
    return recordsSubscription;
  }

  function subscribeToRecords(callback, ...args) {
    if (typeof callback !== "function") return () => {};
    recordSubscribers.add(callback);
    // Les arguments supplémentaires sont les mappings Grist, jamais un nom de table.
    ensureRecordsSubscription(args);
    if (state.ready && latestRawRecords != null) {
      deliverRecordsToSubscriber(callback, "subscribe", getPublicState());
    }
    return () => recordSubscribers.delete(callback);
  }

  function deliverContextWatcher(watcher, rows, mappings, reason, source) {
    if (!watcher.active) return Promise.resolve();
    const contextSnapshot = getPublicState();
    const delivery = {
      reason,
      source,
      generation: contextSnapshot.generation,
      rawVersion: ++watcher.version,
      context: {
        ...contextSnapshot,
        records: rows,
      },
    };
    return Promise.resolve(watcher.callback(rows, mappings, delivery)).catch((error) => {
      console.error(`Erreur watcher ${watcher.tableName} :`, error);
    });
  }

  function ensureWatcherPolling(watcher) {
    if (!watcher.active || watcher.pollTimer || watcher.pollIntervalMs <= 0) return;
    watcher.pollTimer = window.setInterval(() => {
      if (!watcher.active || document.hidden) return;
      watcher.reload("poll", { forceRefresh: true }).catch(() => {});
    }, watcher.pollIntervalMs);
  }

  function ensureWatcherFallbackSubscription(watcher) {
    if (!watcher.active || watcher.fallbackUnsubscribe) return;
    watcher.fallbackUnsubscribe = subscribeToRecords((records, mappings, delivery) => {
      if (!watcher.active) return;
      const contextSnapshot = getPublicState();
      const tableRows = core.tableToRows(filterTableData(
        records,
        watcher.tableName,
        contextSnapshot
      ));
      return deliverContextWatcher(
        watcher,
        tableRows,
        mappings,
        delivery?.reason || "records",
        "fallback"
      );
    });
  }

  function watchContextTable(tableName, callback, {
    pollIntervalMs = DEFAULT_WATCH_POLL_INTERVAL_MS,
    forceRefresh = true,
  } = {}) {
    const normalizedTableName = core.toText(tableName);
    if (!normalizedTableName || typeof callback !== "function") return () => {};

    const watcher = {
      tableName: normalizedTableName,
      callback,
      active: true,
      requestSequence: 0,
      version: 0,
      pollTimer: 0,
      fallbackUnsubscribe: null,
      pollIntervalMs: Math.max(0, Number(pollIntervalMs) || 0),
      reload: null,
    };
    watcher.reload = async (reason = "refresh", options = {}) => {
      if (!watcher.active) return;
      const requestSequence = ++watcher.requestSequence;
      const requestGeneration = selectionGeneration;
      const result = await fetchContextTableInternal(watcher.tableName, {
        forceRefresh: options.forceRefresh !== false,
        signal: options.signal || null,
      });
      if (
        !watcher.active ||
        requestSequence !== watcher.requestSequence ||
        requestGeneration !== selectionGeneration ||
        result.stale
      ) return;

      if (result.source === "rest") ensureWatcherPolling(watcher);
      if (result.source === "fallback") ensureWatcherFallbackSubscription(watcher);
      const rows = core.tableToRows(result.table);
      await deliverContextWatcher(watcher, rows, null, reason, result.source);
    };
    contextWatchers.add(watcher);
    watcher.reload("initial", { forceRefresh }).catch((error) => {
      if (error?.name !== "AbortError") {
        console.warn(`Chargement initial de ${normalizedTableName} impossible.`);
      }
    });

    return () => {
      if (!watcher.active) return;
      watcher.active = false;
      watcher.requestSequence += 1;
      contextWatchers.delete(watcher);
      if (watcher.pollTimer) window.clearInterval(watcher.pollTimer);
      watcher.pollTimer = 0;
      watcher.fallbackUnsubscribe?.();
      watcher.fallbackUnsubscribe = null;
    };
  }

  function refreshContextWatchers(tableNames = null, reason = "refresh") {
    const tableList = tableNames == null
      ? []
      : (typeof tableNames === "string" ? [tableNames] : [...tableNames]);
    const selectedTables = tableNames == null
      ? null
      : new Set(tableList.map(core.toText).filter(Boolean));
    return Promise.all([...contextWatchers]
      .filter((watcher) => !selectedTables || selectedTables.has(watcher.tableName))
      .map((watcher) => watcher.reload(reason, { forceRefresh: true }).catch((error) => {
        if (error?.name !== "AbortError") {
          console.warn(`Actualisation de ${watcher.tableName} impossible.`);
        }
      })));
  }

  function subscribeToRecord(callback, ...args) {
    const grist = getGrist();
    if (typeof grist?.onRecord !== "function") {
      throw new Error("API Grist onRecord indisponible.");
    }
    return grist.onRecord((record, mappings) => (
      initialize().then(() => {
        const snapshot = getPublicState();
        const filtered = filterRecords(record ? [record] : [], snapshot);
        return callback(filtered[0] || null, mappings);
      })
    ), ...args);
  }

  function subscribeToServiceChanges(listener, { immediate = false } = {}) {
    if (typeof listener !== "function") return () => {};

    let initialized = state.ready && !immediate;
    let previousService = state.ready ? state.selectedService : "";
    const contextListener = (contextState) => {
      const selectedService = core.normalizeService(contextState?.selectedService);
      if (!initialized) {
        initialized = true;
        previousService = selectedService;
        if (immediate) {
          listener(contextState, { previousService: "", selectedService });
        }
        return;
      }
      if (selectedService === previousService) return;

      const replacedService = previousService;
      previousService = selectedService;
      listener(contextState, {
        previousService: replacedService,
        selectedService,
      });
    };

    listeners.add(contextListener);
    if (state.ready) contextListener(getPublicState());
    return () => listeners.delete(contextListener);
  }

  async function validateProtectedMutationTargets(actions, contextSnapshot) {
    const targetsByTable = new Map();
    (Array.isArray(actions) ? actions : []).forEach((action) => {
      if (!core.isProtectedMutationAction(action)) return;
      const recordIds = core.getMutationRecordIds(action);
      if (!recordIds.length) return;
      const tableName = core.toText(action?.[1]);
      if (!targetsByTable.has(tableName)) targetsByTable.set(tableName, new Set());
      recordIds.forEach((recordId) => targetsByTable.get(tableName).add(recordId));
    });

    const project = contextSnapshot?.currentProject;
    const projectNames = Array.isArray(project?.names) ? project.names : [];
    for (const [tableName, recordIds] of targetsByTable) {
      const raw = await rawFetchTable(tableName);
      const rowsById = new Map(
        core.tableToRows(raw)
          .filter((row) => Number(row?.id) > 0)
          .map((row) => [Number(row.id), row])
      );
      for (const recordId of recordIds) {
        const row = rowsById.get(recordId);
        if (!row || !core.rowMatchesContext(row, tableName, {
          selectedService: contextSnapshot?.selectedService,
          projectNumber: project?.number || "",
          projectName: project?.name || "",
          projectNames,
        })) {
          throw new Error(
            `La ligne ${recordId} de ${tableName} n'appartient pas au projet et au service sélectionnés.`
          );
        }
      }
    }
  }

  function signalAccessAssignmentsChanged(actions) {
    if (!(actions || []).some(core.isAccessAssignmentMutationAction)) return;
    invalidateAccessCache();
    writeStorage(core.ACCESS_CHANGED_STORAGE_KEY, JSON.stringify({
      version: core.ACCESS_SIGNAL_VERSION,
      at: Date.now(),
      sequence: ++accessSignalSequence,
      source: "runtime",
    }));
    window.setTimeout(() => {
      refresh({ forceRefresh: true }).catch((error) => console.warn(
        "Actualisation des affectations projet impossible :",
        error
      ));
    }, 0);
  }

  function projectCatalogIdentityChanged(actions) {
    return (actions || []).some((action) => {
      if (core.toText(action?.[1]) !== core.PROJECTS_TABLE) return false;
      if (["AddRecord", "BulkAddRecord", "RemoveRecord", "BulkRemoveRecord"].includes(action?.[0])) {
        return true;
      }
      const fields = action?.[3] || {};
      return ["Numero_de_projet", "NumeroProjet", "Numero", "Nom_de_projet", "NomProjet"]
        .some((column) => Object.prototype.hasOwnProperty.call(fields, column));
    });
  }

  function getModifiedTables(actions) {
    const tables = new Set();
    (Array.isArray(actions) ? actions : []).forEach((action) => {
      if (!core.isMutationAction(action)) return;
      const tableName = core.toText(action?.[1]);
      if (tableName) tables.add(tableName);
    });
    return tables;
  }

  function patchGristApi() {
    const grist = getGrist();
    if (!grist) return false;

    if (grist.docApi?.fetchTable && !grist.docApi.__serviceContextPatched) {
      const docApi = grist.docApi;
      rawFetchTable = docApi.fetchTable.bind(docApi);
      rawApplyUserActions = docApi.applyUserActions?.bind(docApi) || null;
      docApi.fetchTable = async function serviceAwareFetchTable(tableName, options = {}) {
        return fetchContextTable(tableName, options);
      };
      if (rawApplyUserActions) {
        docApi.applyUserActions = async function serviceAwareApplyUserActions(actions) {
          await initialize();
          const snapshot = getPublicState();
          const hasProtectedMutation = (actions || []).some(core.isProtectedMutationAction);
          if (hasProtectedMutation && snapshot.accessMode !== "editable") {
            const mode = snapshot.accessMode;
            throw new Error(mode === "hidden"
              ? "Aucun projet autorisé n'est sélectionné."
              : `Le service ${snapshot.selectedService || "sélectionné"} est accessible en lecture seule.`);
          }
          const project = snapshot.currentProject;
          await validateProtectedMutationTargets(actions, snapshot);
          if (snapshot.generation !== selectionGeneration) {
            throw new Error("Le projet ou le service a changé pendant l'écriture. Veuillez recommencer.");
          }
          const transformedActions = core.transformActions(actions, {
            selectedService: snapshot.selectedService,
            projectNumber: project?.number || "",
            projectName: project?.name || "",
          });
          const result = await rawApplyUserActions(transformedActions);
          const modifiedTables = getModifiedTables(actions);
          modifiedTables.forEach(invalidateContextTable);
          signalAccessAssignmentsChanged(actions);
          if (projectCatalogIdentityChanged(actions)) {
            invalidateAccessCache();
            window.setTimeout(() => {
              refresh({ forceRefresh: true }).catch((error) => console.warn(
                "Actualisation du catalogue projets impossible :",
                error
              ));
            }, 0);
          }
          await refreshContextWatchers(modifiedTables, snapshot.generation === selectionGeneration
            ? "mutation"
            : "mutation-after-context-change");
          return result;
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
    selectProject,
    selectService,
    fetchContextTable,
    fetchContextRows,
    watchContextTable,
    invalidateContextTable,
    invalidateCache(tableName) {
      const normalizedTableName = core.toText(tableName);
      if (!normalizedTableName) return;
      if (normalizedTableName === "Team" || normalizedTableName === core.PROJECT_TEAM_TABLE) {
        invalidateAccessCache();
      } else {
        invalidateContextTable(normalizedTableName);
      }
    },
    getState: getPublicState,
    getService: () => state.selectedService || core.normalizeService(readStorage(core.SERVICE_STORAGE_KEY)),
    getHomeService: () => state.homeService,
    getCurrentProject: () => state.currentProject ? { ...state.currentProject } : null,
    getAllowedProjects: () => state.projects.map((project) => ({ ...project })),
    getAccessMode: getCurrentAccessMode,
    canEdit: canEditCurrentSelection,
    isReadOnly: () => !canEditCurrentSelection(),
    onRecords: subscribeToRecords,
    onRecord: subscribeToRecord,
    onServiceChange: subscribeToServiceChanges,
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
    if (target.dataset.gristProjectController === "true") return;
    const selectedValue = core.toText(target.value);
    if (!selectedValue) return;
    selectProject(selectedValue, { reason: "widget-selector" }).catch((error) => {
      console.warn("Changement de projet impossible :", error);
    });
  }, true);
  window.addEventListener("storage", (event) => {
    if (event.key === core.ACCESS_CHANGED_STORAGE_KEY) {
      invalidateAccessCache();
      refresh({ forceRefresh: true }).catch((error) => console.warn(
        "Actualisation des autorisations impossible :",
        error
      ));
      return;
    }
    if (event.key === core.SERVICE_STORAGE_KEY) {
      const nextService = core.normalizeService(event.newValue);
      if (nextService && nextService !== state.selectedService) {
        selectService(nextService, { persist: false, reason: "storage" }).catch(() => {});
      }
      return;
    }
    if ([core.PROJECT_STORAGE_KEY, core.PROJECT_ID_STORAGE_KEY].includes(event.key)) {
      window.clearTimeout(storageSelectionTimer);
      storageSelectionTimer = window.setTimeout(() => {
        storageSelectionTimer = 0;
        selectProject({
          projectId: readStorage(core.PROJECT_ID_STORAGE_KEY),
          projectName: readStorage(core.PROJECT_STORAGE_KEY),
          projectNumber: readStorage(core.PROJECT_STORAGE_KEY),
        }, { persist: false, reason: "storage" }).catch(() => {});
      }, 0);
    }
  });
  window.addEventListener("focus", () => {
    if (state.ready && (accessCacheInvalidated || !isFreshTimestamp(accessLoadedAt))) {
      refresh({ forceRefresh: false }).catch((error) => console.warn(
        "Actualisation du contexte Service impossible :",
        error
      ));
    }
    if (state.ready && !document.hidden) {
      refreshContextWatchers(null, "focus").catch(() => {});
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
