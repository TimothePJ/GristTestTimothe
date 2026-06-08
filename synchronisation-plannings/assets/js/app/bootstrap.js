import { DEBUG_DISABLE_STICKY_SHELL } from "./constants.js";
import { dom } from "./dom.js";
import { state } from "./state.js";
import { bindPlanningLayoutDebug, schedulePlanningLayoutDebug } from "../layout/debugLayout.js";
import {
  scheduleExpensesFramePresentation,
  schedulePlanningFramePresentation,
} from "../layout/framePresentation.js";
import {
  applyPlanningFrameHeight,
  bindPlanningFrameResizeHandle,
  getStoredPlanningFrameHeight,
} from "../layout/resizeHandle.js";
import {
  appendLog,
  renderProjectOptions,
  setActiveProjectSelection,
  syncSharedPlanningControlsAvailability,
  setProjectContentVisibility,
  setHubStatus,
  setSelectionWarning,
} from "../layout/shell.js";
import { attachExpensesFrameApi, waitForChildApi } from "../services/childApi.js";
import {
  applySharedProject,
  clearSharedProjectSelection,
  readSharedProjectSelection,
} from "../services/projectSync.js";
import { bindExpensesPlanningShellControls, handleViewportChange } from "../services/viewportSync.js";

const COMPACT_PLANNING_FRAME_MIN_HEIGHT = 80;
const COMPACT_PLANNING_FRAME_FALLBACK_HEIGHT = 124;
const PLANNING_TOOLTIP_MESSAGE_TYPE = "planning-projet-hover-tooltip";

const projectAliasLookup = new Map();

let planningIframeTooltipEl = null;
let planningIframeTooltipHideTimer = 0;

function applyDebugBodyClass() {
  if (DEBUG_DISABLE_STICKY_SHELL && typeof document !== "undefined") {
    document.body.classList.add("layout-debug-no-sticky");
  }
}

function waitForAnimationFrames(count = 1) {
  const frameCount = Math.max(1, Number(count) || 1);
  return new Promise((resolve) => {
    const step = (remaining) => {
      window.requestAnimationFrame(() => {
        if (remaining <= 1) {
          resolve();
          return;
        }

        step(remaining - 1);
      });
    };

    step(frameCount);
  });
}

function getPlanningTooltipSourceFrame(sourceWindow) {
  const frames = [dom.planningFrameEl, dom.planningAxisFrameEl].filter(Boolean);
  return frames.find((frameEl) => frameEl?.contentWindow === sourceWindow) || null;
}

function ensurePlanningIframeTooltip() {
  if (planningIframeTooltipEl instanceof HTMLElement) {
    return planningIframeTooltipEl;
  }

  planningIframeTooltipEl = document.createElement("div");
  planningIframeTooltipEl.className = "planning-iframe-tooltip";
  planningIframeTooltipEl.hidden = true;
  planningIframeTooltipEl.addEventListener("mouseenter", () => {
    if (planningIframeTooltipHideTimer) {
      window.clearTimeout(planningIframeTooltipHideTimer);
      planningIframeTooltipHideTimer = 0;
    }
  });
  planningIframeTooltipEl.addEventListener("mouseleave", () => {
    hidePlanningIframeTooltip();
  });
  document.body.appendChild(planningIframeTooltipEl);
  return planningIframeTooltipEl;
}

function hidePlanningIframeTooltip({ delay = 0 } = {}) {
  if (planningIframeTooltipHideTimer) {
    window.clearTimeout(planningIframeTooltipHideTimer);
    planningIframeTooltipHideTimer = 0;
  }

  const hideNow = () => {
    if (!(planningIframeTooltipEl instanceof HTMLElement)) return;
    planningIframeTooltipEl.hidden = true;
    planningIframeTooltipEl.innerHTML = "";
  };

  if (delay > 0) {
    planningIframeTooltipHideTimer = window.setTimeout(() => {
      planningIframeTooltipHideTimer = 0;
      hideNow();
    }, delay);
    return;
  }

  hideNow();
}

function placePlanningIframeTooltip(clientX, clientY) {
  if (!(planningIframeTooltipEl instanceof HTMLElement) || planningIframeTooltipEl.hidden) {
    return;
  }

  const offset = 14;
  const verticalBias = 96;
  const viewportPadding = 8;
  const maxWidth = Math.max(180, Math.min(680, window.innerWidth - viewportPadding * 2));
  const anchorY = Math.max(viewportPadding + offset, clientY - verticalBias);

  planningIframeTooltipEl.style.maxWidth = `${maxWidth}px`;
  planningIframeTooltipEl.style.maxHeight = `${Math.max(48, window.innerHeight - viewportPadding * 2)}px`;

  const initialRect = planningIframeTooltipEl.getBoundingClientRect();
  const naturalHeight = Math.min(
    planningIframeTooltipEl.scrollHeight,
    window.innerHeight - viewportPadding * 2
  );
  const availableBelow = Math.max(0, window.innerHeight - anchorY - offset - viewportPadding);
  const availableAbove = Math.max(0, anchorY - offset - viewportPadding);
  const shouldOpenAbove =
    availableBelow < Math.min(naturalHeight, initialRect.height) &&
    availableAbove > availableBelow;
  const availableHeight = shouldOpenAbove ? availableAbove : availableBelow;
  const preferredTooltipHeight = Math.min(
    naturalHeight,
    Math.max(180, window.innerHeight - viewportPadding * 2)
  );
  const maxHeight = Math.max(
    120,
    Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(Math.floor(availableHeight), preferredTooltipHeight)
    )
  );

  planningIframeTooltipEl.style.maxHeight = `${maxHeight}px`;

  const rect = planningIframeTooltipEl.getBoundingClientRect();
  const maxLeft = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);

  let left = clientX + offset;
  if (left > maxLeft) {
    left = Math.max(viewportPadding, clientX - rect.width - offset);
  }

  const top = shouldOpenAbove
    ? Math.max(viewportPadding, anchorY - rect.height - offset)
    : Math.min(
        anchorY + offset,
        Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding)
      );

  planningIframeTooltipEl.style.left = `${Math.round(left)}px`;
  planningIframeTooltipEl.style.top = `${Math.round(top)}px`;
}

function bindPlanningIframeTooltipBridge() {
  window.addEventListener("message", (event) => {
    const payload = event?.data;
    if (!payload || payload.type !== PLANNING_TOOLTIP_MESSAGE_TYPE) {
      return;
    }

    const frameEl = getPlanningTooltipSourceFrame(event.source);
    if (!(frameEl instanceof HTMLElement)) {
      return;
    }

    if (payload.action === "hide") {
      hidePlanningIframeTooltip({ delay: 120 });
      return;
    }

    const frameRect = frameEl.getBoundingClientRect();
    const localX = Number(payload.clientX);
    const localY = Number(payload.clientY);
    if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
      return;
    }

    const tooltipClientX = frameRect.left + localX;
    const tooltipClientY = frameRect.top + localY;

    if (payload.action === "show") {
      const tooltipEl = ensurePlanningIframeTooltip();
      if (planningIframeTooltipHideTimer) {
        window.clearTimeout(planningIframeTooltipHideTimer);
        planningIframeTooltipHideTimer = 0;
      }
      tooltipEl.innerHTML = String(payload.html || "");
      tooltipEl.hidden = false;
      placePlanningIframeTooltip(tooltipClientX, tooltipClientY);
      return;
    }

    if (payload.action === "move") {
      placePlanningIframeTooltip(tooltipClientX, tooltipClientY);
    }
  });
}

function bindFrameLoadListeners() {
  dom.expensesFrameEl?.addEventListener("load", () => {
    // Vérifier si l'API est encore la même (même objet dans le contentWindow).
    // Si oui : c'est un chargement tardif de l'iframe déjà attachée (scroll vers le bas)
    //           → on ne réinitialise pas, on évite de tout re-synchroniser inutilement.
    // Si non : l'iframe a réellement rechargé → réinitialisation complète.
    const currentApi = dom.expensesFrameEl?.contentWindow?.__gestionDepenses2PlanningSyncApi;
    const isAlreadyAttached = state.expensesApi != null && currentApi === state.expensesApi;

    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug("expenses-frame-load");

    if (!isAlreadyAttached) {
      state.expensesApi = null;
      state.expensesViewportSubscriptionApi = null;
      syncSharedPlanningControlsAvailability();
      void attachExpensesFrameApi();
    }
  });

  dom.planningAxisFrameEl?.addEventListener("load", () => {
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    schedulePlanningLayoutDebug("planning-axis-frame-load");
  });

  dom.planningFrameEl?.addEventListener("load", () => {
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    schedulePlanningLayoutDebug("planning-frame-load");
    void applyPlanningAggregateModeFromToggle();
  });
}

function setPlanningAggregateShellState(enabled) {
  document.body.classList.toggle("is-planning-aggregate-mode", enabled);

  if (dom.planningResizeHandleEl instanceof HTMLElement) {
    dom.planningResizeHandleEl.hidden = enabled;
    dom.planningResizeHandleEl.setAttribute("aria-hidden", enabled ? "true" : "false");
    dom.planningResizeHandleEl.setAttribute("aria-disabled", enabled ? "true" : "false");
  }
}

function getPlanningCompactFrameHeight() {
  const preferredHeight = Number(state.planningApi?.getPreferredEmbeddedHeight?.());
  return Number.isFinite(preferredHeight) && preferredHeight > 0
    ? preferredHeight
    : COMPACT_PLANNING_FRAME_FALLBACK_HEIGHT;
}

function applyPlanningCompactFrameHeight() {
  const compactHeight = getPlanningCompactFrameHeight();
  applyPlanningFrameHeight(compactHeight, {
    persist: false,
    refresh: true,
    minHeight: COMPACT_PLANNING_FRAME_MIN_HEIGHT,
  });
}

function applyPlanningNormalFrameHeight() {
  applyPlanningFrameHeight(getStoredPlanningFrameHeight(), {
    persist: false,
    refresh: true,
  });
}

async function refreshPlanningAggregatePresentation() {
  if (!state.planningVisualAggregateMode) {
    return;
  }

  await waitForAnimationFrames(2);
  if (!state.planningVisualAggregateMode) {
    return;
  }

  state.planningApi?.refreshLayout?.();
  await waitForAnimationFrames(2);
  if (!state.planningVisualAggregateMode) {
    return;
  }

  applyPlanningCompactFrameHeight();
  schedulePlanningFramePresentation();
  scheduleExpensesFramePresentation();
  schedulePlanningLayoutDebug("planning-aggregate-height");
}

async function applyPlanningAggregateModeFromToggle() {
  const enabled =
    dom.planningAggregateToggleEl instanceof HTMLInputElement &&
    dom.planningAggregateToggleEl.checked;

  state.planningVisualAggregateMode = enabled;
  setPlanningAggregateShellState(enabled);
  await Promise.resolve(state.planningApi?.setVisualAggregateMode?.(enabled));

  if (enabled) {
    await refreshPlanningAggregatePresentation();
    return;
  }

  applyPlanningNormalFrameHeight();
  schedulePlanningFramePresentation();
  scheduleExpensesFramePresentation();
  schedulePlanningLayoutDebug("planning-aggregate-disabled");
}

function bindPlanningAggregateToggle() {
  if (!(dom.planningAggregateToggleEl instanceof HTMLInputElement)) {
    return;
  }

  dom.planningAggregateToggleEl.addEventListener("change", () => {
    void applyPlanningAggregateModeFromToggle();
  });
}

function normalizeProjectSelectionKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCompactProjectSelectionKey(value = "") {
  return normalizeProjectSelectionKey(value).replace(/[^a-z0-9]+/g, "");
}

function getProjectNamePart(value = "") {
  return String(value || "").replace(/^\s*\d+\s*[-\u2013\u2014]\s*/, "").trim();
}

function getProjectNumberPart(value = "") {
  const match = String(value || "").trim().match(/^\s*0*(\d+)(?:\s*[-\u2013\u2014]\s*|\s*$)/);
  return match ? String(Number(match[1])) : "";
}

function normalizeNumericProjectSelectionKey(value = "") {
  const numberPart = getProjectNumberPart(value);
  if (numberPart) return numberPart;
  const compactKey = normalizeCompactProjectSelectionKey(value);
  if (!/^\d+$/.test(compactKey)) return "";
  return String(Number(compactKey));
}

function rememberProjectAlias(canonicalProjectKey = "", alias = "") {
  const canonical = String(canonicalProjectKey || "").trim();
  const normalizedAlias = normalizeProjectSelectionKey(alias);
  if (!canonical || !normalizedAlias) return;

  projectAliasLookup.set(normalizedAlias, canonical);

  const compactAlias = normalizeCompactProjectSelectionKey(alias);
  if (compactAlias) {
    projectAliasLookup.set(`compact:${compactAlias}`, canonical);
  }

  const numericAlias = normalizeNumericProjectSelectionKey(alias);
  if (numericAlias) {
    projectAliasLookup.set(`number:${numericAlias}`, canonical);
  }
}

function rememberProjectAliases(canonicalProjectKey = "", aliases = []) {
  [canonicalProjectKey, ...aliases].forEach((alias) => {
    rememberProjectAlias(canonicalProjectKey, alias);
  });
}

function findRegisteredProjectAlias(projectKeys = [], requestedProjectKey = "") {
  const requestedKey = normalizeProjectSelectionKey(requestedProjectKey);
  const requestedCompactKey = normalizeCompactProjectSelectionKey(requestedProjectKey);
  const requestedNumericKey = normalizeNumericProjectSelectionKey(requestedProjectKey);
  const candidates = [
    requestedKey ? projectAliasLookup.get(requestedKey) : "",
    requestedCompactKey ? projectAliasLookup.get(`compact:${requestedCompactKey}`) : "",
    requestedNumericKey ? projectAliasLookup.get(`number:${requestedNumericKey}`) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const matchingProjectKey = (projectKeys || []).find(
      (projectKey) => normalizeProjectSelectionKey(projectKey) === normalizeProjectSelectionKey(candidate)
    );
    if (matchingProjectKey) return matchingProjectKey;
  }

  return (projectKeys || []).length ? "" : candidates[0] || "";
}

function findAvailableProjectKey(projectKeys = [], requestedProjectKey = "") {
  const registeredAlias = findRegisteredProjectAlias(projectKeys, requestedProjectKey);
  if (registeredAlias) return registeredAlias;

  const requestedKey = normalizeProjectSelectionKey(requestedProjectKey);
  const requestedNumericKey = normalizeNumericProjectSelectionKey(requestedProjectKey);
  // Si la valeur stockée est au format "numéro - nom" (ex. "232032 - BONNE-NOUVELLE"),
  // extraire la partie nom pour permettre la correspondance avec "BONNE-NOUVELLE".
  const requestedNamePart = normalizeProjectSelectionKey(
    String(requestedProjectKey || "").replace(/^\s*\d+\s*[-–]\s*/, "").trim()
  );

  if (!requestedKey) return "";

  return (projectKeys || []).find((projectKey) => {
    const normalizedKey = normalizeProjectSelectionKey(projectKey);
    const normalizedNumericKey = normalizeNumericProjectSelectionKey(projectKey);
    // Extraire aussi la partie nom de la clé candidate (si elle contient un préfixe numérique)
    const keyNamePart = normalizeProjectSelectionKey(
      String(projectKey || "").replace(/^\s*\d+\s*[-–]\s*/, "").trim()
    );

    return (
      // Correspondance exacte (insensible à la casse et aux accents)
      normalizedKey === requestedKey ||
      // Correspondance par numéro pur (ex : "001" == "1")
      (requestedNumericKey && normalizedNumericKey && normalizedNumericKey === requestedNumericKey) ||
      // "232032 - BONNE-NOUVELLE" stocké → correspond à "BONNE-NOUVELLE" dans la liste
      (requestedNamePart && requestedNamePart !== requestedKey && normalizedKey === requestedNamePart) ||
      // Cas inverse : la liste contient "232032 - BONNE-NOUVELLE", on cherche "BONNE-NOUVELLE"
      (keyNamePart && keyNamePart !== normalizedKey && keyNamePart === requestedKey)
    );
  }) || "";
}

function tableToRows(table) {
  if (Array.isArray(table)) return table;
  if (!table || typeof table !== "object") return [];

  const keys = Object.keys(table);
  if (!keys.length) return [];

  const rowCount = Math.max(
    ...keys.map((key) => (Array.isArray(table[key]) ? table[key].length : 0))
  );
  if (!rowCount) return [];

  return Array.from({ length: rowCount }, (_unused, index) => {
    const row = {};
    keys.forEach((key) => {
      row[key] = Array.isArray(table[key]) ? table[key][index] : undefined;
    });
    return row;
  });
}

// Cache : normalizedKey → Projets.id (pour écriture de grist.selected-project-id)
const _projectIdByNormalizedKey = new Map();

async function fetchProjectKeysFromGrist() {
  try {
    if (!window.grist?.docApi || typeof window.grist.docApi.fetchTable !== "function") {
      return [];
    }

    const projectsTable = await window.grist.docApi.fetchTable("Projets");
    return tableToRows(projectsTable)
      .map((row) => {
        const projectName = String(row?.Nom_de_projet || "").trim();
        const projectNumber = String(row?.Numero_de_projet || "").trim();
        const canonicalProjectKey = projectName || projectNumber;
        if (canonicalProjectKey) {
          rememberProjectAliases(canonicalProjectKey, [
            projectName,
            projectNumber,
            projectName && projectNumber ? `${projectNumber} - ${projectName}` : "",
          ]);
          // Mémoriser l'ID Grist pour ce projet
          const id = Number(row?.id);
          if (Number.isInteger(id) && id > 0) {
            _projectIdByNormalizedKey.set(normalizeProjectSelectionKey(canonicalProjectKey), id);
          }
        }
        return canonicalProjectKey;
      })
      .filter(Boolean);
  } catch (error) {
    console.warn("Impossible de charger la liste Projets pour la synchronisation :", error);
    return [];
  }
}

function mergeProjectKeys(...projectKeyLists) {
  const projectsByKey = new Map();

  projectKeyLists.flat().forEach((projectKey) => {
    const normalizedProject = String(projectKey || "").trim();
    const lookupKey = normalizeProjectSelectionKey(normalizedProject);
    if (normalizedProject && !projectsByKey.has(lookupKey)) {
      rememberProjectAliases(normalizedProject, [
        getProjectNamePart(normalizedProject),
        getProjectNumberPart(normalizedProject),
      ]);
      projectsByKey.set(lookupKey, normalizedProject);
    }
  });

  return [...projectsByKey.values()].sort((left, right) =>
    left.localeCompare(right, "fr", { sensitivity: "base", numeric: true })
  );
}

function getRequestedSharedProjectKey() {
  return (
    readSharedProjectSelection() ||
    state.planningApi?.getSelectedProject?.() ||
    state.planningAxisApi?.getSelectedProject?.() ||
    ""
  );
}

async function applyRestoredSharedProject(projectKeys = []) {
  const requestedSavedProjectKey = getRequestedSharedProjectKey();
  let savedProjectKey = findAvailableProjectKey(projectKeys, requestedSavedProjectKey);

  // Si le projet n'est pas trouvé dans la liste actuelle (liste vide ou format différent),
  // tenter un re-fetch direct depuis Grist pour avoir la liste à jour.
  if (!savedProjectKey && requestedSavedProjectKey) {
    try {
      const freshKeys = await fetchProjectKeysFromGrist();
      savedProjectKey = findAvailableProjectKey(freshKeys, requestedSavedProjectKey);
      if (savedProjectKey && freshKeys.length) {
        const mergedKeys = mergeProjectKeys(projectKeys, freshKeys);
        renderProjectOptions(mergedKeys, savedProjectKey);
      }
    } catch (_e) {
      // Ignorer silencieusement
    }
  }

  if (!savedProjectKey) {
    return false;
  }

  setActiveProjectSelection(savedProjectKey);
  setProjectContentVisibility(true);
  await applySelectedProjectFromHub(savedProjectKey);
  return true;
}

async function applySelectedProjectFromHub(projectKey = "") {
  const normalizedProjectKey = String(projectKey || "").trim();
  if (!normalizedProjectKey) {
    clearSharedProjectSelection();
    return;
  }

  await applySharedProject(normalizedProjectKey);
  await refreshPlanningAggregatePresentation();
}

/**
 * Recharge la liste des projets depuis Grist + planningApi, puis applique la
 * sélection partagée. À utiliser dans les handlers (storage, pageshow, focus,
 * visibilitychange) pour éviter la liste périmée capturée au bootstrap.
 */
async function refreshProjectKeysAndApplySharedSelection() {
  if (state.projectSyncInProgress) return;
  try {
    const [gristKeys, planningKeys] = await Promise.all([
      fetchProjectKeysFromGrist().catch(() => []),
      Promise.resolve(state.planningApi?.listProjects?.() || []),
    ]);
    const freshKeys = mergeProjectKeys(planningKeys, gristKeys);
    if (freshKeys.length) {
      const selectedFreshProjectKey =
        findAvailableProjectKey(freshKeys, state.activeProjectKey) || state.activeProjectKey;
      renderProjectOptions(freshKeys, selectedFreshProjectKey);
    }
    await applyRestoredSharedProject(freshKeys.length ? freshKeys : []);
  } catch (err) {
    console.warn("refreshProjectKeysAndApplySharedSelection :", err);
  }
}



export async function bootstrapHubApp() {
  applyDebugBodyClass();
  bindPlanningIframeTooltipBridge();
  applyPlanningFrameHeight(getStoredPlanningFrameHeight(), {
    persist: false,
    refresh: false,
  });
  bindPlanningFrameResizeHandle();

  try {
    if (window.grist && typeof window.grist.ready === "function") {
      window.grist.ready({ requiredAccess: "full" });
    }

    setHubStatus("Connexion aux plannings...");

    [state.planningApi, state.planningAxisApi] = await Promise.all([
      waitForChildApi(dom.planningFrameEl, "__planningProjetSyncApi"),
      waitForChildApi(dom.planningAxisFrameEl, "__planningProjetSyncApi"),
    ]);

    bindExpensesPlanningShellControls();
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
    bindPlanningLayoutDebug();
    bindFrameLoadListeners();
    bindPlanningAggregateToggle();
    void applyPlanningAggregateModeFromToggle();

    const planningProjects = mergeProjectKeys(
      state.planningApi.listProjects?.() || [],
      await fetchProjectKeysFromGrist()
    );
    const initiallySelectedProjectKey = findAvailableProjectKey(
      planningProjects,
      getRequestedSharedProjectKey()
    );
    renderProjectOptions(planningProjects, initiallySelectedProjectKey);
    setProjectContentVisibility(Boolean(initiallySelectedProjectKey));
    if (initiallySelectedProjectKey) {
      state.requestedProjectKey = initiallySelectedProjectKey;
    }
    syncSharedPlanningControlsAvailability();

    // Subscription Planning Projet main → synchro planning-axis + gestion-depenses2
    state.planningApi.subscribeViewportChange((payload) => {
      handleViewportChange({ ...payload, app: "planning-projet-main" });
    });

    if (typeof state.planningApi.subscribeSelectionChange === "function") {
      state.planningApi.subscribeSelectionChange((payload) => {
        if (!String(state.activeProjectKey || "").trim()) {
          setSelectionWarning(null);
          return;
        }

        setSelectionWarning(payload?.selection || null);
      });
    }

    // Subscription Planning Projet axis (frise) → synchro planning-main + gestion-depenses2
    state.planningAxisApi.subscribeViewportChange((payload) => {
      handleViewportChange({ ...payload, app: "planning-projet-axis" });
    });

    if (dom.projectSelectEl instanceof HTMLSelectElement) {
      dom.projectSelectEl.addEventListener("change", () => {
        const nextProjectKey = String(dom.projectSelectEl.value || "").trim();
        // Écrire l'ID canonique si connu
        if (nextProjectKey) {
          const id = _projectIdByNormalizedKey.get(normalizeProjectSelectionKey(nextProjectKey));
          if (id) {
            try { localStorage.setItem('grist.selected-project-id', String(id)); } catch (_e) {}
          }
        } else {
          try { localStorage.removeItem('grist.selected-project-id'); } catch (_e) {}
        }
        void applySelectedProjectFromHub(nextProjectKey);
      });
    }

    // Accéder au contentWindow de l'iframe gestion-depenses2 pour inciter le browser
    // à la charger même si elle est hors viewport (certains browsers ignorent loading="eager").
    if (dom.expensesFrameEl instanceof HTMLIFrameElement) {
      void dom.expensesFrameEl.contentWindow;
    }

    // Appliquer le projet partagé avant de lancer gestion-depenses2 pour que
    // getDesiredProjectKey() retourne déjà le bon projet (state.activeProjectKey défini).
    const requestedSavedProjectKey = getRequestedSharedProjectKey();
    if (await applyRestoredSharedProject(planningProjects)) {
      // Projet restauré depuis la sélection commune.
    } else if (requestedSavedProjectKey && planningProjects.length) {
      setHubStatus("Projet mémorisé introuvable dans la synchronisation.");
    } else if (planningProjects.length) {
      setHubStatus("Choisis un projet pour afficher les plannings.");
    } else {
      clearSharedProjectSelection();
      setHubStatus("Aucun projet disponible.");
    }

    // Si applyRestoredSharedProject a échoué mais que les iframes Planning Projet
    // ont déjà leur propre projet (chargé depuis localStorage au démarrage),
    // promouvoir ce projet dans le hub pour que gestion-depenses2 le reçoive.
    if (!state.activeProjectKey) {
      const planningCurrentProject =
        state.planningApi?.getSelectedProject?.() ||
        state.planningAxisApi?.getSelectedProject?.() ||
        "";
      if (planningCurrentProject) {
        const matched = findAvailableProjectKey(planningProjects, planningCurrentProject)
          || planningCurrentProject;
        state.activeProjectKey = matched;
        state.requestedProjectKey = matched;
        setActiveProjectSelection(matched);
        setProjectContentVisibility(true);
      }
    }

    // Lancer gestion-depenses2 maintenant que le projet est connu.
    void attachExpensesFrameApi();

    // --- Listeners de synchronisation cross-widget ---

    // Synchro en temps réel : un autre widget change le projet dans localStorage.
    window.addEventListener("storage", (event) => {
      if (state.projectSyncInProgress) return;
      // Priorité : clé ID canonique
      if (event.key === "grist.selected-project-id" && event.newValue) {
        const id = Number(event.newValue);
        if (Number.isInteger(id) && id > 0) {
          void refreshProjectKeysAndApplySharedSelection();
        }
        return;
      }
      if (event.key !== "grist.selected-project" || !event.newValue) return;
      const requested = normalizeProjectSelectionKey(String(event.newValue).trim());
      const active   = normalizeProjectSelectionKey(state.activeProjectKey || "");
      if (requested && requested !== active) {
        // Relire la liste depuis Grist pour éviter la liste périmée du bootstrap.
        void refreshProjectKeysAndApplySharedSelection();
      }
    });

    // Synchro quand synchronisation-plannings redevient visible (navigation Grist).
    window.addEventListener("pageshow", () => {
      if (!state.projectSyncInProgress) {
        void refreshProjectKeysAndApplySharedSelection();
      }
    });

    // Synchro sur changement de visibilité (passage d'onglet Grist).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !state.projectSyncInProgress) {
        void refreshProjectKeysAndApplySharedSelection();
      }
    });

    // Synchro sur focus fenêtre (comme Avancement, Reference2, etc.).
    window.addEventListener("focus", () => {
      if (!state.projectSyncInProgress) {
        void refreshProjectKeysAndApplySharedSelection();
      }
    });

    schedulePlanningLayoutDebug("bootstrap-ready");
  } catch (error) {
    console.error("Erreur synchronisation plannings :", error);
    setHubStatus(`Erreur : ${error.message}`);
    appendLog(`Erreur initialisation : ${error.message}`);
  }
}
