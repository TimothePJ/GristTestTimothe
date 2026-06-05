import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
import {
  scheduleExpensesFramePresentation,
  schedulePlanningFramePresentation,
} from "../layout/framePresentation.js";
import {
  appendLog,
  getViewportSourceLabel,
  isSharedPlanningControlsLocked,
  setHubStatus,
  setLastRange,
  setLastSource,
  syncSharedPlanningControlsAvailability,
  syncExpensesPlanningShell,
} from "../layout/shell.js";
import {
  buildCanonicalSharedViewport,
  buildPlanningExactSharedViewport,
  getCurrentSharedViewport,
} from "../viewport/build.js";
import { getTargetVisibleDaysForMode, syncPlanningViewportBounds } from "../viewport/bounds.js";
import {
  getViewportLogicalSignature,
  normalizeIsoDate,
  normalizeProjectKey,
} from "../viewport/normalize.js";

let viewportSyncTraceSequence = 0;

function traceViewportSync(event, details = {}) {
  viewportSyncTraceSequence += 1;
  console.info(`[sync-trace][hub][${viewportSyncTraceSequence}] ${event}`, details);
}

// ---------------------------------------------------------------------------
// File d'attente dédiée pour gestion-depenses2
//
// Problèmes résolus :
//   1. viewport perdu si expensesApi null → stocké dans _pendingExpensesViewport
//   2. pas de retry depuis flushViewportSyncQueue → requestExpensesViewport appelé là aussi
//   3. races entre applyViewport concurrents → sérialisés par _expensesApplyInProgress
//   4. sharedViewportState pas mis à jour sur chemin direct → mis à jour dans requestExpensesViewport
//   5. viewport en attente non appliqué à l'attachement → drainExpensesViewportQueue exporté
// ---------------------------------------------------------------------------

let _pendingExpensesViewport = null; // dernier viewport demandé, appliqué dès que l'API est prête
let _expensesApplyInProgress = false;

function scheduleExpensesViewportPresentationBurst() {
  scheduleExpensesFramePresentation();
  window.requestAnimationFrame(() => {
    scheduleExpensesFramePresentation(1);
  });
  window.setTimeout(() => {
    scheduleExpensesFramePresentation(1);
  }, 120);
}

/**
 * Enregistre un viewport à appliquer à gestion-depenses2 et lance le drain.
 * Met à jour sharedViewportState immédiatement pour éviter que framePresentation
 * ne réapplique un viewport périmé.
 */
function requestExpensesViewport(viewport) {
  if (!viewport) return;

  const exact = buildPlanningExactSharedViewport(viewport);
  if (!normalizeIsoDate(exact.firstVisibleDate)) return;

  // Mise à jour de sharedViewportState AVANT tout scheduleExpensesFramePresentation
  // pour que framePresentation.js ne réapplique pas un viewport ancien.
  const canonical = buildCanonicalSharedViewport(exact);
  if (canonical.firstVisibleDate) {
    state.sharedViewportState = canonical;
    syncExpensesPlanningShell(canonical);
  }

  _pendingExpensesViewport = exact;
  void drainExpensesViewportQueue();
}

/**
 * Applique le viewport en attente à gestion-depenses2 (fire-and-forget).
 *
 * Pourquoi fire-and-forget (pas d'await) ?
 * applyViewport() retourne une "settled promise" que gestion-depenses2 résout
 * via finishChargePlanSyncSuppression(token). Si setSelectedProject() est
 * appelé entre-temps (ex. dans attachExpensesFrameApi), il incrémente le
 * suppressionToken et invalide le token de l'apply en cours → la settled
 * promise ne se résout jamais → _expensesApplyInProgress reste true indéfiniment
 * → plus aucun scroll ne passe. Le fire-and-forget élimine ce deadlock.
 * Gestion-depenses2 gère déjà les appels concurrents via beginChargePlanSyncSuppression.
 */
export function drainExpensesViewportQueue() {
  if (_expensesApplyInProgress) return;

  if (!state.expensesApi?.applyViewport) {
    if (_pendingExpensesViewport) {
      traceViewportSync("expenses-wait-api", {
        firstVisibleDate: _pendingExpensesViewport.firstVisibleDate,
      });
    }
    return;
  }

  let viewport = _pendingExpensesViewport;
  while (viewport) {
    _pendingExpensesViewport = null;
    _expensesApplyInProgress = true;
    try {
      void Promise.resolve(state.expensesApi.applyViewport(viewport))
        .catch((err) => console.error("drainExpensesViewportQueue error:", err));
      scheduleExpensesViewportPresentationBurst();
      traceViewportSync("expenses-applied", { firstVisibleDate: viewport.firstVisibleDate });
    } finally {
      _expensesApplyInProgress = false;
    }
    // last-wins : si un nouveau viewport est arrivé, l'appliquer aussi
    viewport = _pendingExpensesViewport;
  }
}

// ---------------------------------------------------------------------------
// Toolbar partagé (< > Semaine Mois Année)
// ---------------------------------------------------------------------------

async function runSharedToolbarViewportAction({
  actionLabel = "Pilotage commun",
  execute = null,
  fallbackViewportFactory = null,
} = {}) {
  if (isSharedPlanningControlsLocked()) {
    syncSharedPlanningControlsAvailability();
    return false;
  }

  state.sharedToolbarActionInProgress = true;
  syncSharedPlanningControlsAvailability();

  try {
    const rawViewport = typeof execute === "function" ? await Promise.resolve(execute()) : null;
    const fallbackViewport =
      typeof fallbackViewportFactory === "function"
        ? fallbackViewportFactory()
        : fallbackViewportFactory;
    const nextViewport = rawViewport ?? fallbackViewport;
    const canonical = buildCanonicalSharedViewport(nextViewport || {});
    if (!normalizeIsoDate(canonical.firstVisibleDate)) {
      return false;
    }

    await applyViewportFromParentControls(canonical, { sourceLabel: actionLabel });
    return true;
  } catch (error) {
    console.error("Erreur action toolbar partagé :", error);
    return false;
  } finally {
    state.sharedToolbarActionInProgress = false;
    syncSharedPlanningControlsAvailability();
  }
}

export async function applyViewportFromParentControls(
  viewport = {},
  { sourceLabel = "Pilotage commun" } = {}
) {
  if (
    !state.planningApi ||
    !state.planningAxisApi ||
    state.projectSyncInProgress ||
    state.viewportSyncInProgress
  ) {
    syncSharedPlanningControlsAvailability();
    return;
  }

  const canonical = buildCanonicalSharedViewport(viewport);
  syncPlanningViewportBounds(canonical);
  const sig = getViewportLogicalSignature(state.activeProjectKey, canonical);

  state.viewportSyncInProgress = true;
  syncSharedPlanningControlsAvailability();

  try {
    // 1. Appliquer aux 2 planning iframes
    await Promise.all([
      Promise.resolve(state.planningApi.applyViewport(canonical)),
      Promise.resolve(state.planningAxisApi.applyViewport(canonical)),
    ]);

    // 2. Demander l'application à gestion-depenses2 via la file dédiée (sérialisé, avec retry)
    requestExpensesViewport(viewport);

    state.lastAppliedViewportLogicalSignature = sig;
    state.sharedViewportState = canonical;
    syncExpensesPlanningShell(canonical);
    schedulePlanningFramePresentation();
    setLastSource(getViewportSourceLabel(sourceLabel));
    setLastRange(canonical);
    setHubStatus(`Synchro : ${getViewportSourceLabel(sourceLabel)}`);
    appendLog(`${getViewportSourceLabel(sourceLabel)} → ${canonical.firstVisibleDate || "?"} / ${canonical.mode || "?"}`);
  } catch (error) {
    console.error("Erreur contrôle toolbar :", error);
  } finally {
    state.viewportSyncInProgress = false;
    syncSharedPlanningControlsAvailability();
    if (state.pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

export function shiftViewportByMode(viewport = {}, direction = 1) {
  const canonical = buildCanonicalSharedViewport(viewport);
  const baseDateValue =
    normalizeIsoDate(canonical.firstVisibleDate) || normalizeIsoDate(canonical.rangeStartDate);
  if (!baseDateValue) return canonical;

  const baseDate = new Date(`${baseDateValue}T12:00:00`);
  if (Number.isNaN(baseDate.getTime())) return canonical;

  const d = direction >= 0 ? 1 : -1;
  const next = new Date(baseDate);
  const mode = String(canonical.mode || "").trim();

  if (mode === "week") next.setDate(next.getDate() + d * 7);
  else if (mode === "month") next.setMonth(next.getMonth() + d);
  else if (mode === "year") next.setFullYear(next.getFullYear() + d);
  else next.setDate(next.getDate() + d * (canonical.visibleDays || 7));

  const nextDate = normalizeIsoDate(
    `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`
  );

  return buildCanonicalSharedViewport({
    ...canonical,
    anchorDate: nextDate,
    firstVisibleDate: nextDate,
    rangeStartDate: nextDate,
    rangeEndDate: "",
  });
}

export function bindExpensesPlanningShellControls() {
  dom.expensesModeButtons.forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const nextMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
      if (!nextMode) return;
      void runSharedToolbarViewportAction({
        actionLabel: "Pilotage commun",
        execute: () => state.planningAxisApi?.setZoomMode?.(nextMode),
        fallbackViewportFactory: () => {
          const cur = getCurrentSharedViewport();
          return cur
            ? { ...cur, mode: nextMode, visibleDays: getTargetVisibleDaysForMode(nextMode, cur), rangeEndDate: "" }
            : null;
        },
      });
    });
  });

  dom.sharedPrevBtnEl?.addEventListener("click", () => {
    void runSharedToolbarViewportAction({
      actionLabel: "Pilotage commun",
      execute: () => state.planningAxisApi?.moveViewportByMode?.(-1),
      fallbackViewportFactory: () => {
        const cur = getCurrentSharedViewport();
        return cur ? shiftViewportByMode(cur, -1) : null;
      },
    });
  });

  dom.sharedCenterBtnEl?.addEventListener("click", () => {
    void runSharedToolbarViewportAction({
      actionLabel: "Pilotage commun",
      execute: () => state.planningAxisApi?.focusDataAnchor?.(),
      fallbackViewportFactory: () => getCurrentSharedViewport(),
    });
  });

  dom.sharedNextBtnEl?.addEventListener("click", () => {
    void runSharedToolbarViewportAction({
      actionLabel: "Pilotage commun",
      execute: () => state.planningAxisApi?.moveViewportByMode?.(1),
      fallbackViewportFactory: () => {
        const cur = getCurrentSharedViewport();
        return cur ? shiftViewportByMode(cur, 1) : null;
      },
    });
  });

  window.addEventListener("resize", () => {
    syncExpensesPlanningShell();
    schedulePlanningFramePresentation();
    scheduleExpensesFramePresentation();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncExpensesPlanningShell();
      schedulePlanningFramePresentation();
      scheduleExpensesFramePresentation();
    });
  }
}

// ---------------------------------------------------------------------------
// Synchro viewport entre les 3 iframes (planning-main, planning-axis, expenses)
// ---------------------------------------------------------------------------

export async function flushViewportSyncQueue() {
  if (
    state.projectSyncInProgress ||
    state.viewportSyncInProgress ||
    state.sharedToolbarActionInProgress ||
    !state.pendingViewportPayload
  ) {
    return;
  }

  const payload = state.pendingViewportPayload;
  state.pendingViewportPayload = null;

  const source = String(payload.app || "").trim();
  const payloadProjectKey = String(payload.projectKey || "").trim();

  traceViewportSync("flush-start", { source, payloadProjectKey, activeProjectKey: state.activeProjectKey });

  // Ignorer si le projet ne correspond pas
  if (
    state.activeProjectKey &&
    payloadProjectKey &&
    normalizeProjectKey(payloadProjectKey) !== normalizeProjectKey(state.activeProjectKey)
  ) {
    traceViewportSync("flush-skip-project-mismatch", { source, payloadProjectKey, activeProjectKey: state.activeProjectKey });
    void flushViewportSyncQueue();
    return;
  }

  const canonical = buildCanonicalSharedViewport(payload.viewport || {});
  if (!normalizeIsoDate(canonical.firstVisibleDate)) {
    traceViewportSync("flush-skip-no-date", { source });
    void flushViewportSyncQueue();
    return;
  }

  syncPlanningViewportBounds(canonical);

  const sig = getViewportLogicalSignature(
    payloadProjectKey || state.activeProjectKey,
    canonical
  );

  // Déduplication : évite les boucles infinies
  if (sig && sig === state.lastAppliedViewportLogicalSignature) {
    traceViewportSync("flush-skip-duplicate", { source, sig });
    if (source !== "gestion-depenses2") {
      requestExpensesViewport(payload.viewport);
    }
    state.sharedViewportState = canonical;
    syncExpensesPlanningShell(canonical);
    schedulePlanningFramePresentation();
    void flushViewportSyncQueue();
    return;
  }

  state.viewportSyncInProgress = true;
  syncSharedPlanningControlsAvailability();

  try {
    const exact = buildPlanningExactSharedViewport(payload.viewport || {});

    // Appliquer aux planning iframes (sauf la source)
    const planningCalls = [];
    if (source !== "planning-projet-main" && state.planningApi?.applyViewport) {
      planningCalls.push(Promise.resolve(state.planningApi.applyViewport(exact)));
    }
    if (source !== "planning-projet-axis" && state.planningAxisApi?.applyViewport) {
      planningCalls.push(Promise.resolve(state.planningAxisApi.applyViewport(exact)));
    }
    if (planningCalls.length > 0) {
      await Promise.all(planningCalls);
    }

    // Appliquer à gestion-depenses2 si la source est Planning Projet
    // (pas si c'est gestion-depenses2 lui-même pour éviter la boucle)
    if (source !== "gestion-depenses2") {
      requestExpensesViewport(payload.viewport);
    }

    traceViewportSync("flush-applied", { source, sig });

    state.lastAppliedViewportLogicalSignature = sig;
    state.sharedViewportState = canonical;
    syncExpensesPlanningShell(canonical);
    schedulePlanningFramePresentation();
    setLastSource(getViewportSourceLabel(source));
    setLastRange(canonical);
    setHubStatus(`Synchro : ${getViewportSourceLabel(source)}`);
    appendLog(`${getViewportSourceLabel(source)} → ${canonical.firstVisibleDate || "?"} / ${canonical.mode || "?"}`);
  } catch (error) {
    console.error("Erreur synchro viewport :", error);
  } finally {
    state.viewportSyncInProgress = false;
    syncSharedPlanningControlsAvailability();
    if (state.pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

/**
 * Appelé directement depuis les subscriptions Planning Projet (bootstrap.js).
 * Achemine le viewport vers la file gestion-depenses2 de façon fiable.
 */
export function syncViewportToExpensesNow(viewport) {
  if (!viewport) return;
  requestExpensesViewport(viewport);
}

export function handleViewportChange(payload) {
  if (!payload || state.projectSyncInProgress) {
    return;
  }
  if (state.sharedToolbarActionInProgress) {
    return;
  }
  state.pendingViewportPayload = payload;
  void flushViewportSyncQueue();
}
