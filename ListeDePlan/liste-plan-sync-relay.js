(function initListePlanSyncRelay(window) {
  "use strict";

  if (!window || window.ListePlanSyncRelay) return;

  const PROJECTS_TABLE = "Projets2";
  const SIGNAL_COLUMN = "ListePlan_Sync";
  const LISTE_PLAN_TABLES = new Set([
    "ListePlan_NDC_COF",
    "ListePlan NDC+COF",
    "ListePlan_NDC+COF",
  ]);
  const MUTATION_ACTIONS = new Set([
    "AddRecord",
    "BulkAddRecord",
    "UpdateRecord",
    "BulkUpdateRecord",
    "RemoveRecord",
    "BulkRemoveRecord",
  ]);

  let signalSequence = 0;
  let signalColumnReady = false;
  let signalColumnPromise = null;
  let warningShown = false;
  const lastSignalByProjectId = new Map();

  function toText(value) {
    return value == null ? "" : String(value).trim();
  }

  function hasListePlanMutation(actions) {
    return (Array.isArray(actions) ? actions : []).some((action) => (
      MUTATION_ACTIONS.has(toText(action?.[0])) &&
      LISTE_PLAN_TABLES.has(toText(action?.[1]))
    ));
  }

  function getCurrentProjectId() {
    const dropdown = window.document?.getElementById?.("projectDropdown");
    const selectedOption = dropdown?.selectedOptions?.[0] ||
      (dropdown?.selectedIndex >= 0 ? dropdown.options?.[dropdown.selectedIndex] : null);
    const selectedId = Number(selectedOption?.dataset?.projectId);
    if (Number.isInteger(selectedId) && selectedId > 0) return selectedId;

    for (const storageKey of ["LP_LAST_PROJECT_ID", "grist.selected-project-id"]) {
      try {
        const storedId = Number(window.localStorage?.getItem?.(storageKey));
        if (Number.isInteger(storedId) && storedId > 0) return storedId;
      } catch (_error) {
        // Le stockage peut être indisponible dans une iframe très restrictive.
      }
    }

    const contextId = Number(window.GristServiceContext?.getCurrentProject?.()?.id);
    return Number.isInteger(contextId) && contextId > 0 ? contextId : null;
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
      "Synchronisation distante de ListeDePlan indisponible : " +
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
              label: "Synchronisation liste de plan",
            }],
          ]);
        } catch (error) {
          // Deux fenêtres peuvent tenter la migration au même instant. Si l'autre
          // a créé la colonne en premier, le résultat souhaité est déjà atteint.
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
    // Si le widget est un jour rattaché directement à ListePlan, son flux natif
    // est déjà le signal exact et ne doit pas passer par le relais Projets2.
    if (LISTE_PLAN_TABLES.has(toText(sectionTableId))) return true;
    if (sectionTableId && toText(sectionTableId) !== PROJECTS_TABLE) return false;

    const projectId = getCurrentProjectId();
    if (!projectId) return false;
    const projectRow = (Array.isArray(records) ? records : []).find(
      (row) => Number(row?.id) === projectId
    );
    if (!projectRow) return false;

    const signal = toText(projectRow[SIGNAL_COLUMN]);
    if (delivery?.reason !== "records") {
      // selectProject relit déjà ListeDePlan. On profite de cette livraison pour
      // amorcer le nouveau projet, sinon sa première vraie modification serait
      // confondue avec un état initial puis ignorée.
      lastSignalByProjectId.set(projectId, signal);
      return false;
    }
    if (!lastSignalByProjectId.has(projectId)) {
      // Grist peut différer le premier onRecords tant que l'iframe n'a pas encore
      // reçu de focus. Ce premier lot peut donc déjà contenir la PREMIERE vraie
      // modification. Un signal non vide doit être accepté immédiatement ; sinon
      // l'utilisateur devait cliquer dans l'autre fenêtre pour amorcer le relais.
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
    if (docApi.__listePlanSyncRelayPatched) return true;

    const previousApplyUserActions = docApi.applyUserActions.bind(docApi);
    docApi.applyUserActions = async function applyUserActionsWithProjectSignal(actions, ...args) {
      if (!hasListePlanMutation(actions)) {
        return previousApplyUserActions(actions, ...args);
      }

      const projectId = getCurrentProjectId();
      if (!projectId || !await ensureSignalColumn(docApi, previousApplyUserActions)) {
        return previousApplyUserActions(actions, ...args);
      }

      const relayedActions = [
        ...actions,
        ["UpdateRecord", PROJECTS_TABLE, projectId, {
          [SIGNAL_COLUMN]: createSignalValue(),
        }],
      ];
      return previousApplyUserActions(relayedActions, ...args);
    };
    Object.defineProperty(docApi, "__listePlanSyncRelayPatched", { value: true });
    return true;
  }

  window.ListePlanSyncRelay = Object.freeze({
    install,
    hasListePlanMutation,
    getCurrentProjectId,
    acceptNativeSignalForCurrentProject,
    signalColumn: SIGNAL_COLUMN,
  });

  if (!install()) {
    window.addEventListener("DOMContentLoaded", install, { once: true });
  }
})(typeof window !== "undefined" ? window : null);
