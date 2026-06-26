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

// --- Registre de projets (source unique : table Grist "Projets2") ---

// Tableau canonique [{id, number, name, label}] chargé depuis Projets uniquement.
let _gristProjectRegistry = [];
// Coalescence : une seule requête active à la fois vers fetchTable("Projets2").
let _fetchProjectsInFlight = null;
// Debounce pour les événements storage rapprochés (écriture nom + ID simultanée).
let _storageReconcileTimer = 0;
// Timer de retry pour les réconciliations bloquées par une synchronisation active.
let _reconcileRetryTimer = 0;
// Timer de retry pour le chemin rapide (_syncFromStorage).
let _syncRetryTimer = 0;
// Debounce pour le rechargement complet (focus / pageshow / visibilitychange).
let _fullRefreshTimer = 0;

// Conservés pour compatibilité avec renderProjectOptions de shell.js (utilisé plus bas).
const _projectIdByNormalizedKey = new Map();
const _projectDisplayByKey = new Map();

/**
 * Charge la table Projets depuis Grist et reconstruit le registre canonique.
 * Les appels simultanés sont coalescés : une seule requête est active à la fois.
 */
async function fetchProjectsFromGrist() {
  if (_fetchProjectsInFlight) return _fetchProjectsInFlight;

  _fetchProjectsInFlight = (async () => {
    try {
      if (!window.grist?.docApi || typeof window.grist.docApi.fetchTable !== "function") {
        return _gristProjectRegistry;
      }
      const projectsTable = await window.grist.docApi.fetchTable("Projets2");
      const rows = tableToRows(projectsTable);

      _gristProjectRegistry = rows
        .map((row) => {
          const id = Number(row?.id);
          const number = String(row?.Numero_de_projet || "").trim();
          const name = String(row?.Nom_de_projet || "").trim();
          if (!name || !Number.isInteger(id) || id <= 0) return null;
          return { id, number, name, label: number ? `${number} - ${name}` : name };
        })
        .filter(Boolean);

      // Reconstruire les maps de compatibilité et les alias de résolution.
      _projectIdByNormalizedKey.clear();
      _projectDisplayByKey.clear();
      projectAliasLookup.clear();
      _gristProjectRegistry.forEach((p) => {
        const nk = normalizeProjectSelectionKey(p.name);
        _projectIdByNormalizedKey.set(nk, p.id);
        _projectDisplayByKey.set(p.name, p.label);
        rememberProjectAliases(p.name, [p.number, p.label]);
      });

      return _gristProjectRegistry;
    } catch (error) {
      console.warn("Impossible de charger la liste Projets2 :", error);
      return _gristProjectRegistry;
    } finally {
      _fetchProjectsInFlight = null;
    }
  })();

  return _fetchProjectsInFlight;
}

/**
 * Résout une sélection vers un projet réel du registre.
 * Priorité : ID Grist → nom exact → libellé "N - Nom" → numéro unique.
 * Retourne null si aucune correspondance fiable n'est trouvée.
 */
function resolveProjectFromRegistry(key, id = null) {
  // 1. Par ID Grist (le plus précis).
  const numId = Number(id);
  if (Number.isInteger(numId) && numId > 0) {
    const byId = _gristProjectRegistry.find((p) => p.id === numId);
    if (byId) return byId;
  }

  const requested = normalizeProjectSelectionKey(String(key || "").trim());
  if (!requested) return null;

  // 2. Par nom exact (insensible à la casse et aux accents).
  const byName = _gristProjectRegistry.find(
    (p) => normalizeProjectSelectionKey(p.name) === requested
  );
  if (byName) return byName;

  // 3. Par libellé complet "Numero - Nom".
  const byLabel = _gristProjectRegistry.find(
    (p) => normalizeProjectSelectionKey(p.label) === requested
  );
  if (byLabel) return byLabel;

  // 4. Par numéro — seulement si ce numéro est unique dans le registre.
  const requestedNum = normalizeNumericProjectSelectionKey(requested);
  if (requestedNum) {
    const byNumber = _gristProjectRegistry.filter(
      (p) => p.number && normalizeNumericProjectSelectionKey(p.number) === requestedNum
    );
    if (byNumber.length === 1) return byNumber[0]; // ambigu si > 1 → pas de sélection
  }

  return null;
}

/** Lit l'ID Grist partagé depuis localStorage. */
function readSharedProjectId() {
  try {
    const raw = localStorage.getItem("grist.selected-project-id");
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Retourne le projet réel qui correspond à la sélection partagée actuelle.
 * Lit d'abord l'ID canonique, puis le nom en fallback.
 */
function getRequestedSharedProject() {
  const id = readSharedProjectId();
  const name = readSharedProjectSelection();
  // Résoudre uniquement depuis localStorage. Pas de fallback vers les iframes :
  // elles peuvent avoir une ancienne valeur qui remplacerait une demande récente.
  return resolveProjectFromRegistry(name, id);
}

/**
 * Reconstruit la liste du sélecteur uniquement depuis le registre Grist.
 * Aucune option fantôme n'est créée.
 */
function renderProjectOptionsFromRegistry(selectedProject = null) {
  if (!(dom.projectSelectEl instanceof HTMLSelectElement)) return;

  dom.projectSelectEl.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choisir un projet";
  placeholder.selected = !selectedProject;
  dom.projectSelectEl.appendChild(placeholder);

  const sorted = [..._gristProjectRegistry].sort((a, b) =>
    a.label.localeCompare(b.label, "fr", { sensitivity: "base", numeric: true })
  );

  sorted.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.label;
    opt.dataset.projectId = String(p.id);
    const isSelected = Boolean(selectedProject && selectedProject.id === p.id);
    opt.selected = isSelected;
    if (isSelected) opt.setAttribute("selected", "selected");
    dom.projectSelectEl.appendChild(opt);
  });

  dom.projectSelectEl.value = selectedProject ? selectedProject.name : "";
  dom.projectSelectEl.disabled = _gristProjectRegistry.length === 0;
}

/**
 * Planifie une réconciliation de la sélection avec un délai de 50 ms.
 * Coalesce les événements storage nom + ID déclenchés simultanément.
 */
/**
 * Chemin RAPIDE — lit le registre en mémoire, pas de réseau sauf si introuvable.
 * Utilisé par les événements storage (un autre widget a changé de projet).
 */
async function _syncFromStorage() {
  if (_syncRetryTimer) { window.clearTimeout(_syncRetryTimer); _syncRetryTimer = 0; }
  if (state.projectSyncInProgress) {
    _syncRetryTimer = window.setTimeout(
      () => { _syncRetryTimer = 0; void _syncFromStorage(); }, 100
    );
    return;
  }
  try {
    const id = readSharedProjectId();
    const name = readSharedProjectSelection();
    let project = resolveProjectFromRegistry(name, id);
    // Projet absent du registre courant → recharger une fois depuis Grist.
    if (!project && (id || name)) {
      await fetchProjectsFromGrist();
      project = resolveProjectFromRegistry(name, id);
    }
    if (!project) return;
    if (project.name === state.activeProjectKey) return; // déjà actif
    renderProjectOptionsFromRegistry(project);
    setProjectContentVisibility(true);
    void applySelectedProjectFromHub(project);
  } catch (err) {
    console.warn("_syncFromStorage :", err);
  }
}

/** Debounce 50 ms — regroupe les écriture nom+ID simultanées d'un même widget. */
function scheduleStorageReconciliation() {
  if (_storageReconcileTimer) window.clearTimeout(_storageReconcileTimer);
  _storageReconcileTimer = window.setTimeout(() => {
    _storageReconcileTimer = 0;
    void _syncFromStorage();
  }, 50);
}

/**
 * Chemin COMPLET — recharge la liste Projets depuis Grist puis synchronise.
 * Utilisé pour pageshow / visibilitychange / focus (retour longue absence).
 */
function scheduleFullRefresh() {
  if (_fullRefreshTimer) window.clearTimeout(_fullRefreshTimer);
  _fullRefreshTimer = window.setTimeout(() => {
    _fullRefreshTimer = 0;
    void refreshProjectsAndApplySharedSelection();
  }, 100);
}

async function applyRestoredSharedProject() {
  const project = getRequestedSharedProject();
  if (!project) return false;

  renderProjectOptionsFromRegistry(project);
  setProjectContentVisibility(true);
  await applySelectedProjectFromHub(project);
  return true;
}

async function applySelectedProjectFromHub(projectOrKey) {
  // Accepte soit un objet projet {id, name, ...} soit une chaîne (compatibilité).
  const project =
    projectOrKey && typeof projectOrKey === "object"
      ? projectOrKey
      : resolveProjectFromRegistry(String(projectOrKey || "").trim(), null);

  const canonicalName = project?.name || String(projectOrKey || "").trim();
  if (!canonicalName) {
    clearSharedProjectSelection();
    return;
  }

  // Toujours écrire ID et nom ensemble, ou supprimer l'ID si inconnu.
  // Ne jamais laisser un ancien ID associé à un nouveau nom.
  try {
    if (project?.id) {
      localStorage.setItem("grist.selected-project-id", String(project.id));
    } else {
      localStorage.removeItem("grist.selected-project-id");
    }
    localStorage.setItem("grist.selected-project", canonicalName);
  } catch (_e) {}

  await applySharedProject(canonicalName);
  await refreshPlanningAggregatePresentation();
}

/**
 * Recharge la table Projets depuis Grist, reconstruit le sélecteur et
 * applique la sélection partagée. Utilisé par les listeners storage / focus /
 * visibilitychange / pageshow pour éviter une liste périmée.
 */
async function refreshProjectsAndApplySharedSelection() {
  if (_reconcileRetryTimer) {
    window.clearTimeout(_reconcileRetryTimer);
    _reconcileRetryTimer = 0;
  }
  if (state.projectSyncInProgress) {
    // Réessayer après la synchronisation active — ne jamais abandonner l'événement.
    _reconcileRetryTimer = window.setTimeout(
      () => { _reconcileRetryTimer = 0; void refreshProjectsAndApplySharedSelection(); },
      100
    );
    return;
  }
  try {
    await fetchProjectsFromGrist();
    const currentProject = resolveProjectFromRegistry(state.activeProjectKey || "", null);
    renderProjectOptionsFromRegistry(currentProject);
    await applyRestoredSharedProject();
  } catch (err) {
    console.warn("refreshProjectsAndApplySharedSelection :", err);
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

    // Enregistrer les listeners IMMÉDIATEMENT — avant tout await — pour ne jamais
    // manquer un événement émis pendant le chargement des iframes.
    window.addEventListener("storage", (event) => {
      if (event.key === "grist.selected-project-id" || event.key === "grist.selected-project") {
        scheduleStorageReconciliation();
      }
    });
    window.addEventListener("pageshow", () => scheduleFullRefresh());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleFullRefresh();
    });
    window.addEventListener("focus", () => scheduleFullRefresh());

    // Charger la liste des projets immédiatement après grist.ready(), sans attendre les
    // iframes de planning — comme tous les autres widgets (Avancement, Reference2, etc.).
    await fetchProjectsFromGrist();
    const initialProject = getRequestedSharedProject();
    renderProjectOptionsFromRegistry(initialProject);
    setProjectContentVisibility(Boolean(initialProject));
    if (initialProject) {
      state.requestedProjectKey = initialProject.name;
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
        const selectedOption = dom.projectSelectEl.selectedOptions?.[0];
        const nextProjectKey = String(dom.projectSelectEl.value || "").trim();
        if (nextProjectKey) {
          // Résoudre depuis le registre via l'ID du dataset (source la plus fiable).
          const optionId = Number(selectedOption?.dataset?.projectId);
          const resolved = Number.isInteger(optionId) && optionId > 0
            ? resolveProjectFromRegistry("", optionId)
            : resolveProjectFromRegistry(nextProjectKey, null);
          void applySelectedProjectFromHub(resolved ?? nextProjectKey);
        } else {
          clearSharedProjectSelection();
        }
      });
    }

    // Accéder au contentWindow de l'iframe gestion-depenses2 pour inciter le browser
    // à la charger même si elle est hors viewport (certains browsers ignorent loading="eager").
    if (dom.expensesFrameEl instanceof HTMLIFrameElement) {
      void dom.expensesFrameEl.contentWindow;
    }

    // Appliquer le projet partagé avant de lancer gestion-depenses2 pour que
    // son API reçoive déjà le bon projet (state.activeProjectKey défini).
    const hasStoredProject = Boolean(readSharedProjectId() || readSharedProjectSelection());
    if (await applyRestoredSharedProject()) {
      // Projet restauré depuis la sélection commune.
    } else if (hasStoredProject) {
      setHubStatus("Projet mémorisé introuvable.");
    } else if (_gristProjectRegistry.length) {
      setHubStatus("Choisis un projet pour afficher les plannings.");
    } else {
      clearSharedProjectSelection();
      setHubStatus("Aucun projet disponible.");
    }

    // Lancer gestion-depenses2 maintenant que le projet est connu.
    void attachExpensesFrameApi();

    schedulePlanningLayoutDebug("bootstrap-ready");
  } catch (error) {
    console.error("Erreur synchronisation plannings :", error);
    setHubStatus(`Erreur : ${error.message}`);
    appendLog(`Erreur initialisation : ${error.message}`);
  }
}
