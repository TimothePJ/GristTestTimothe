(function initProjectMutationSyncRelay(window) {
  "use strict";

  if (!window || window.ProjectMutationSyncRelay) return;

  const PROJECTS_TABLE = "Projets2";
  const MUTATION_ACTIONS = new Set([
    "AddRecord",
    "BulkAddRecord",
    "UpdateRecord",
    "BulkUpdateRecord",
    "RemoveRecord",
    "BulkRemoveRecord",
  ]);
  const config = window.ProjectMutationSyncConfig || {};
  const mutationSignals = new Map(
    Object.entries(config.mutationSignals || {}).map(([column, tables]) => [
      toText(column),
      new Set((Array.isArray(tables) ? tables : [tables]).map(toText).filter(Boolean)),
    ]).filter(([column, tables]) => column && tables.size)
  );
  const observedSignalColumns = [...new Set([
    ...mutationSignals.keys(),
    ...(Array.isArray(config.observedSignalColumns) ? config.observedSignalColumns : []),
  ].map(toText).filter(Boolean))];
  const observedSignalTables = new Map(
    Object.entries(config.observedSignalTables || {}).map(([column, tables]) => [
      toText(column),
      new Set((Array.isArray(tables) ? tables : [tables]).map(toText).filter(Boolean)),
    ]).filter(([column, tables]) => column && tables.size)
  );
  for (const [column, tables] of mutationSignals) {
    if (!observedSignalTables.has(column)) observedSignalTables.set(column, new Set(tables));
  }
  const directSignalTables = new Set(
    (Array.isArray(config.directSignalTables) ? config.directSignalTables : [])
      .map(toText)
      .filter(Boolean)
  );
  const dropdownIds = [...new Set([
    ...(Array.isArray(config.dropdownIds) ? config.dropdownIds : []),
    "firstColumnDropdown",
    "projectDropdown",
    "ps-project-select",
    "project-select",
  ].map(toText).filter(Boolean))];
  const storageKeys = [...new Set([
    ...(Array.isArray(config.projectIdStorageKeys) ? config.projectIdStorageKeys : []),
    "grist.selected-project-id",
  ].map(toText).filter(Boolean))];
  const lastSignalsByProjectId = new Map();
  const lastProjectCatalogSignatures = new Map();
  const readySignalColumns = new Set();
  let signalSequence = 0;
  let preparePromise = null;
  let warningShown = false;

  function toText(value) {
    return value == null ? "" : String(value).trim();
  }

  function tableHasColumn(table, column) {
    if (Array.isArray(table)) {
      return table.some((row) => Object.prototype.hasOwnProperty.call(row || {}, column));
    }
    return Boolean(
      table &&
      typeof table === "object" &&
      Object.prototype.hasOwnProperty.call(table, column)
    );
  }

  function isExistingColumnError(error) {
    return /already|duplicate|existe|existante|column.*exist/i.test(toText(error?.message));
  }

  function getSelectedOption(dropdown) {
    return dropdown?.selectedOptions?.[0] ||
      (dropdown?.selectedIndex >= 0 ? dropdown.options?.[dropdown.selectedIndex] : null);
  }

  function getCurrentProjectId() {
    for (const dropdownId of dropdownIds) {
      const selectedId = Number(
        getSelectedOption(window.document?.getElementById?.(dropdownId))?.dataset?.projectId
      );
      if (Number.isInteger(selectedId) && selectedId > 0) return selectedId;
    }

    for (const storageKey of storageKeys) {
      try {
        const storedId = Number(window.localStorage?.getItem?.(storageKey));
        if (Number.isInteger(storedId) && storedId > 0) return storedId;
      } catch (_error) {
        // Le stockage peut etre indisponible dans une iframe restrictive.
      }
    }

    const contextId = Number(window.GristServiceContext?.getCurrentProject?.()?.id);
    return Number.isInteger(contextId) && contextId > 0 ? contextId : null;
  }

  function getModifiedTables(actions) {
    return new Set(
      (Array.isArray(actions) ? actions : [])
        .filter((action) => MUTATION_ACTIONS.has(toText(action?.[0])))
        .map((action) => toText(action?.[1]))
        .filter(Boolean)
    );
  }

  function getSignalRoutesForActions(actions) {
    const modifiedTables = getModifiedTables(actions);
    return [...mutationSignals]
      .map(([column, tables]) => ({
        column,
        tables: [...tables].filter((table) => modifiedTables.has(table)),
      }))
      .filter((route) => route.tables.length);
  }

  function getSignalColumnsForActions(actions) {
    return getSignalRoutesForActions(actions).map((route) => route.column);
  }

  function getSignalTables(column, signal) {
    const separatorIndex = signal.indexOf("|");
    if (separatorIndex >= 0) {
      try {
        const encodedTables = signal.slice(separatorIndex + 1);
        const parsedTables = decodeURIComponent(encodedTables)
          .split(",")
          .map(toText)
          .filter(Boolean);
        if (parsedTables.length) return new Set(parsedTables);
      } catch (_error) {
        // Les anciens signaux sans metadonnees utilisent la configuration locale.
      }
    }
    return observedSignalTables.get(column) || new Set();
  }

  function signalTargetsWatcher(column, signal, watchedTableName) {
    const normalizedWatchedTable = toText(watchedTableName);
    if (!normalizedWatchedTable) return true;
    return getSignalTables(column, signal).has(normalizedWatchedTable);
  }

  function getProjectCatalogSignature(records) {
    return (Array.isArray(records) ? records : [])
      .map((row) => Number(row?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((left, right) => left - right)
      .join(",");
  }

  // La creation d'un projet est le seul geste editable qui peut arriver alors
  // qu'aucun projet courant n'existe encore. Elle ne peut donc pas porter son
  // signal sur une ligne deja selectionnee. Le flux natif Projets2 suffit : une
  // variation de la liste d'IDs reveille uniquement le watcher du catalogue.
  function projectCatalogChanged(records, delivery, watchedTableName) {
    if (toText(watchedTableName) !== PROJECTS_TABLE) return false;
    const watcherKey = toText(watchedTableName) || "*";
    const signature = getProjectCatalogSignature(records);
    if (!lastProjectCatalogSignatures.has(watcherKey)) {
      lastProjectCatalogSignatures.set(watcherKey, signature);
      // Sans photo precedente, une section Projets2 peut deja livrer sa premiere
      // mutation. On ne la traite que si aucun projet n'est encore selectionne :
      // avec un projet courant, les colonnes techniques font le filtrage precis.
      return delivery?.reason === "records" && !getCurrentProjectId() && Boolean(signature);
    }
    const previousSignature = lastProjectCatalogSignatures.get(watcherKey);
    lastProjectCatalogSignatures.set(watcherKey, signature);
    return delivery?.reason === "records" && signature !== previousSignature;
  }

  function warnRelayUnavailable(error) {
    if (warningShown) return;
    warningShown = true;
    console.warn(
      "Synchronisation distante du widget indisponible : les colonnes techniques " +
      "de Projets2 n'ont pas pu etre preparees.",
      error
    );
  }

  async function ensureSignalColumns(docApi, applyUserActions, columns) {
    const pendingColumns = columns.filter((column) => !readySignalColumns.has(column));
    if (!pendingColumns.length) return true;
    if (preparePromise) {
      const prepared = await preparePromise;
      if (!prepared) return false;
      return ensureSignalColumns(docApi, applyUserActions, columns);
    }

    preparePromise = (async () => {
      const projects = await docApi.fetchTable(PROJECTS_TABLE);
      for (const column of pendingColumns) {
        if (!tableHasColumn(projects, column)) {
          try {
            await applyUserActions([[
              "AddColumn",
              PROJECTS_TABLE,
              column,
              { type: "Text", label: `Synchronisation ${column}` },
            ]]);
          } catch (error) {
            if (!isExistingColumnError(error)) throw error;
          }
        }
        readySignalColumns.add(column);
      }
      return true;
    })().catch((error) => {
      warnRelayUnavailable(error);
      return false;
    }).finally(() => {
      preparePromise = null;
    });

    await preparePromise;
    return columns.every((column) => readySignalColumns.has(column));
  }

  function createSignalValue(tables) {
    signalSequence += 1;
    const encodedTables = encodeURIComponent(
      [...new Set((Array.isArray(tables) ? tables : []).map(toText).filter(Boolean))].join(",")
    );
    return `${Date.now()}:${signalSequence}|${encodedTables}`;
  }

  function acceptNativeSignalForCurrentProject({
    records,
    delivery,
    sectionTableId,
    watchedTableName,
  } = {}) {
    const normalizedSection = toText(sectionTableId);
    if (directSignalTables.has(normalizedSection)) {
      return !toText(watchedTableName) || toText(watchedTableName) === normalizedSection;
    }
    if (normalizedSection && normalizedSection !== PROJECTS_TABLE) return false;

    const catalogChanged = projectCatalogChanged(records, delivery, watchedTableName);
    const projectId = getCurrentProjectId();
    if (!projectId) return catalogChanged;
    const projectRow = (Array.isArray(records) ? records : []).find(
      (row) => Number(row?.id) === projectId
    );
    if (!projectRow) return catalogChanged;

    let projectWatchers = lastSignalsByProjectId.get(projectId);
    if (!projectWatchers) {
      projectWatchers = new Map();
      lastSignalsByProjectId.set(projectId, projectWatchers);
    }
    const watcherKey = toText(watchedTableName) || "*";
    let watcherSignals = projectWatchers.get(watcherKey);
    if (!watcherSignals) {
      watcherSignals = new Map();
      projectWatchers.set(watcherKey, watcherSignals);
    }
    const isRecordsDelivery = delivery?.reason === "records";
    let changed = false;
    for (const column of observedSignalColumns) {
      const signal = toText(projectRow[column]);
      if (!isRecordsDelivery) {
        watcherSignals.set(column, signal);
        continue;
      }
      if (!watcherSignals.has(column)) {
        // Le premier lot peut deja etre la premiere mutation si l'iframe etait
        // inactive : un signal non vide doit alors reveiller sans clic prealable.
        watcherSignals.set(column, signal);
        if (signal && signalTargetsWatcher(column, signal, watchedTableName)) changed = true;
        continue;
      }
      const previousSignal = watcherSignals.get(column);
      watcherSignals.set(column, signal);
      if (
        signal &&
        signal !== previousSignal &&
        signalTargetsWatcher(column, signal, watchedTableName)
      ) changed = true;
    }
    return catalogChanged || changed;
  }

  function install() {
    const docApi = window.grist?.docApi;
    if (!docApi || typeof docApi.applyUserActions !== "function") return false;
    if (docApi.__projectMutationSyncRelayPatched) return true;

    const previousApplyUserActions = docApi.applyUserActions.bind(docApi);
    docApi.applyUserActions = async function applyUserActionsWithProjectSignals(actions, ...args) {
      const signalRoutes = getSignalRoutesForActions(actions);
      const signalColumns = signalRoutes.map((route) => route.column);
      if (!signalRoutes.length) return previousApplyUserActions(actions, ...args);

      const projectId = getCurrentProjectId();
      if (!projectId || !await ensureSignalColumns(docApi, previousApplyUserActions, signalColumns)) {
        return previousApplyUserActions(actions, ...args);
      }
      const signalFields = Object.fromEntries(signalRoutes.map((route) => [
        route.column,
        createSignalValue(route.tables),
      ]));
      return previousApplyUserActions([
        ...actions,
        ["UpdateRecord", PROJECTS_TABLE, projectId, signalFields],
      ], ...args);
    };
    Object.defineProperty(docApi, "__projectMutationSyncRelayPatched", { value: true });
    return true;
  }

  window.ProjectMutationSyncRelay = Object.freeze({
    install,
    getCurrentProjectId,
    getSignalColumnsForActions,
    acceptNativeSignalForCurrentProject,
    observedSignalColumns: Object.freeze([...observedSignalColumns]),
  });

  if (!install()) {
    window.addEventListener("DOMContentLoaded", install, { once: true });
  }
})(typeof window !== "undefined" ? window : null);
