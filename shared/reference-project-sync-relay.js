(function initReferenceProjectSyncRelay(window) {
  "use strict";

  if (!window || window.ReferenceProjectSyncRelay) return;

  const PROJECTS_TABLE = "Projets2";
  const SIGNAL_COLUMN = "References2_Sync";
  const REFERENCE_TABLES = new Set(["References", "References2"]);
  const MUTATION_ACTIONS = new Set([
    "AddRecord",
    "BulkAddRecord",
    "UpdateRecord",
    "BulkUpdateRecord",
    "RemoveRecord",
    "BulkRemoveRecord",
  ]);
  const lastSignalByProjectId = new Map();
  let signalSequence = 0;
  let signalColumnReady = false;
  let signalColumnPromise = null;
  let warningShown = false;

  function toText(value) {
    return value == null ? "" : String(value).trim();
  }

  function hasReferenceMutation(actions) {
    return (Array.isArray(actions) ? actions : []).some((action) => (
      MUTATION_ACTIONS.has(toText(action?.[0])) &&
      REFERENCE_TABLES.has(toText(action?.[1]))
    ));
  }

  function getCurrentProjectId() {
    const dropdown = window.document?.getElementById?.("firstColumnDropdown");
    const selectedOption = dropdown?.selectedOptions?.[0] ||
      (dropdown?.selectedIndex >= 0 ? dropdown.options?.[dropdown.selectedIndex] : null);
    const selectedId = Number(selectedOption?.dataset?.projectId);
    if (Number.isInteger(selectedId) && selectedId > 0) return selectedId;

    try {
      const storedId = Number(window.localStorage?.getItem?.("grist.selected-project-id"));
      if (Number.isInteger(storedId) && storedId > 0) return storedId;
    } catch (_error) {
      // Le stockage peut être indisponible dans une iframe très restrictive.
    }

    const contextId = Number(window.GristServiceContext?.getCurrentProject?.()?.id);
    return Number.isInteger(contextId) && contextId > 0 ? contextId : null;
  }

  function getCurrentProjectScope() {
    const dropdown = window.document?.getElementById?.("firstColumnDropdown");
    const selectedOption = dropdown?.selectedOptions?.[0] ||
      (dropdown?.selectedIndex >= 0 ? dropdown.options?.[dropdown.selectedIndex] : null);
    const contextProject = window.GristServiceContext?.getCurrentProject?.();
    return {
      projectId: getCurrentProjectId(),
      projectNumber: toText(selectedOption?.dataset?.projectNumber) ||
        toText(contextProject?.number),
    };
  }

  function hasSignalColumn(table) {
    if (Array.isArray(table)) {
      return table.some((row) => Object.prototype.hasOwnProperty.call(row || {}, SIGNAL_COLUMN));
    }
    return Boolean(
      table &&
      typeof table === "object" &&
      Object.prototype.hasOwnProperty.call(table, SIGNAL_COLUMN)
    );
  }

  function isExistingColumnError(error) {
    return /already|duplicate|existe|existante|column.*exist/i.test(toText(error?.message));
  }

  function warnRelayUnavailable(error) {
    if (warningShown) return;
    warningShown = true;
    console.warn(
      "Synchronisation distante de References2 indisponible : " +
      `la colonne technique ${PROJECTS_TABLE}.${SIGNAL_COLUMN} n'a pas pu etre preparee.`,
      error
    );
  }

  async function ensureSignalColumn(docApi, applyUserActions) {
    if (signalColumnReady) return true;
    if (signalColumnPromise) return signalColumnPromise;

    signalColumnPromise = (async () => {
      const projects = await docApi.fetchTable(PROJECTS_TABLE);
      if (!hasSignalColumn(projects)) {
        try {
          await applyUserActions([
            ["AddColumn", PROJECTS_TABLE, SIGNAL_COLUMN, {
              type: "Text",
              label: "Synchronisation références",
            }],
          ]);
        } catch (error) {
          if (!isExistingColumnError(error)) throw error;
        }
      }
      signalColumnReady = true;
      return true;
    })().catch((error) => {
      warnRelayUnavailable(error);
      return false;
    }).finally(() => {
      signalColumnPromise = null;
    });

    return signalColumnPromise;
  }

  function createSignalValue() {
    signalSequence += 1;
    return `${Date.now()}:${signalSequence}`;
  }

  function acceptNativeSignalForCurrentProject({
    records,
    delivery,
    sectionTableId,
  } = {}) {
    if (REFERENCE_TABLES.has(toText(sectionTableId))) return true;
    if (sectionTableId && toText(sectionTableId) !== PROJECTS_TABLE) return false;

    const projectId = getCurrentProjectId();
    if (!projectId) return false;
    const projectRow = (Array.isArray(records) ? records : []).find(
      (row) => Number(row?.id) === projectId
    );
    if (!projectRow) return false;

    const signal = toText(projectRow[SIGNAL_COLUMN]);
    if (delivery?.reason !== "records") {
      lastSignalByProjectId.set(projectId, signal);
      return false;
    }
    if (!lastSignalByProjectId.has(projectId)) {
      // Une iframe en arrière-plan peut ne livrer son premier onRecords qu'au
      // moment de la première mutation. Si le signal est déjà renseigné, c'est
      // précisément cette mutation : ne pas l'avaler comme simple amorçage.
      lastSignalByProjectId.set(projectId, signal);
      return Boolean(signal);
    }
    const previousSignal = lastSignalByProjectId.get(projectId);
    lastSignalByProjectId.set(projectId, signal);
    return Boolean(signal && signal !== previousSignal);
  }

  function install() {
    const docApi = window.grist?.docApi;
    if (!docApi || typeof docApi.applyUserActions !== "function") return false;
    if (docApi.__referenceProjectSyncRelayPatched) return true;

    const previousApplyUserActions = docApi.applyUserActions.bind(docApi);
    docApi.applyUserActions = async function applyUserActionsWithReferenceSignal(actions, ...args) {
      if (!hasReferenceMutation(actions)) {
        return previousApplyUserActions(actions, ...args);
      }
      const projectId = getCurrentProjectId();
      if (!projectId || !await ensureSignalColumn(docApi, previousApplyUserActions)) {
        return previousApplyUserActions(actions, ...args);
      }
      return previousApplyUserActions([
        ...actions,
        ["UpdateRecord", PROJECTS_TABLE, projectId, {
          [SIGNAL_COLUMN]: createSignalValue(),
        }],
      ], ...args);
    };
    Object.defineProperty(docApi, "__referenceProjectSyncRelayPatched", { value: true });
    return true;
  }

  window.ReferenceProjectSyncRelay = Object.freeze({
    install,
    hasReferenceMutation,
    getCurrentProjectId,
    getCurrentProjectScope,
    acceptNativeSignalForCurrentProject,
    signalColumn: SIGNAL_COLUMN,
  });

  if (!install()) {
    window.addEventListener("DOMContentLoaded", install, { once: true });
  }
})(typeof window !== "undefined" ? window : null);
