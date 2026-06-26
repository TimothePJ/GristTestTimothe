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

// eslint-disable-next-line no-unused-vars
function traceViewportSync(_event, _details = {}) {
  // Traces désactivées — console.info impacte la fluidité du scroll.
}

// ---------------------------------------------------------------------------
// Synchronisation viewport → gestion-depenses2
//
// Pattern : RAF-coalescing + fire-and-forget
//
//   • Plusieurs rangechanged/frame sur grande plage → un seul applyViewport/frame
//     (requestAnimationFrame coalesce tous les events d'une même frame en un seul apply)
//   • Pas d'await sur la settled promise de gestion-depenses2 (deadlock possible si
//     setSelectedProject() s'intercale et invalide le suppressionToken)
//   • Viewport conservé en mémoire si l'API n'est pas encore prête ; appliqué
//     immédiatement à l'attachement via drainExpensesViewportQueue()
// ---------------------------------------------------------------------------

let _pendingExpensesViewport = null; // dernier viewport demandé
let _expensesApplyRafId = null;      // RAF de coalescing

/**
 * Enregistre un viewport et planifie son application via RAF.
 * Tous les events reçus dans la même frame sont coalesés → un seul applyViewport.
 * Met à jour sharedViewportState immédiatement pour que framePresentation.js
 * ne réapplique pas un viewport périmé.
 */
function requestExpensesViewport(viewport) {
  if (!viewport) return;

  const exact = buildPlanningExactSharedViewport(viewport);
  if (!normalizeIsoDate(exact.firstVisibleDate)) return;

  const canonical = buildCanonicalSharedViewport(exact);
  if (canonical.firstVisibleDate) {
    state.sharedViewportState = canonical;
    syncExpensesPlanningShell(canonical);
  }

  _pendingExpensesViewport = exact;

  // Planifier le drain sur la prochaine frame ; si déjà planifié, on ne crée
  // pas un deuxième RAF — le viewport existant est simplement écrasé ci-dessus.
  if (_expensesApplyRafId === null) {
    _expensesApplyRafId = window.requestAnimationFrame(() => {
      _expensesApplyRafId = null;
      drainExpensesViewportQueue();
    });
  }
}

/**
 * Applique immédiatement le viewport en attente à gestion-depenses2 (fire-and-forget).
 * Annule le RAF de coalescing si présent (drain immédiat = plus besoin du RAF).
 * Exporté pour être appelé depuis childApi.js à l'attachement de l'API.
 */
export function drainExpensesViewportQueue() {
  if (_expensesApplyRafId !== null) {
    window.cancelAnimationFrame(_expensesApplyRafId);
    _expensesApplyRafId = null;
  }

  const viewport = _pendingExpensesViewport;
  if (!viewport) return;

  if (!state.expensesApi?.applyViewport) {
    // API pas encore prête : garder le viewport en attente pour l'attachement.
    traceViewportSync("expenses-wait-api", { firstVisibleDate: viewport.firstVisibleDate });
    return;
  }

  _pendingExpensesViewport = null;

  void Promise.resolve(state.expensesApi.applyViewport(viewport))
    .catch((err) => console.error("drainExpensesViewportQueue error:", err));
  scheduleExpensesFramePresentation();
  traceViewportSync("expenses-applied", { firstVisibleDate: viewport.firstVisibleDate });
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
      flushViewportSyncQueue();
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

/**
 * Applique le viewport en attente aux iframes planning (fire-and-forget).
 * Synchrone — pas d'await pour ne pas bloquer les événements scroll suivants.
 * La déduplication par signature empêche les boucles de rétroaction.
 */
export function flushViewportSyncQueue() {
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

  // Ignorer si le projet ne correspond pas.
  if (
    state.activeProjectKey &&
    payloadProjectKey &&
    normalizeProjectKey(payloadProjectKey) !== normalizeProjectKey(state.activeProjectKey)
  ) {
    flushViewportSyncQueue();
    return;
  }

  const canonical = buildCanonicalSharedViewport(payload.viewport || {});
  if (!normalizeIsoDate(canonical.firstVisibleDate)) {
    flushViewportSyncQueue();
    return;
  }

  syncPlanningViewportBounds(canonical);

  const sig = getViewportLogicalSignature(
    payloadProjectKey || state.activeProjectKey,
    canonical
  );

  // Déduplication : si la signature est identique, on ne renvoie que vers expenses.
  if (sig && sig === state.lastAppliedViewportLogicalSignature) {
    if (source !== "gestion-depenses2") {
      requestExpensesViewport(payload.viewport);
    }
    state.sharedViewportState = canonical;
    syncExpensesPlanningShell(canonical);
    schedulePlanningFramePresentation();
    flushViewportSyncQueue();
    return;
  }

  // Mettre à jour l'état AVANT d'envoyer aux iframes : les événements en retour
  // seront ainsi reconnus comme doublon et ignorés (prévient la boucle ping-pong).
  state.lastAppliedViewportLogicalSignature = sig;
  state.sharedViewportState = canonical;
  syncExpensesPlanningShell(canonical);
  schedulePlanningFramePresentation();
  setLastSource(getViewportSourceLabel(source));
  setLastRange(canonical);

  // Appliquer aux iframes planning (fire-and-forget — aucun await).
  const exact = buildPlanningExactSharedViewport(payload.viewport || {});
  if (source !== "planning-projet-main" && state.planningApi?.applyViewport) {
    void Promise.resolve(state.planningApi.applyViewport(exact))
      .catch((err) => console.error("applyViewport main:", err));
  }
  if (source !== "planning-projet-axis" && state.planningAxisApi?.applyViewport) {
    void Promise.resolve(state.planningAxisApi.applyViewport(exact))
      .catch((err) => console.error("applyViewport axis:", err));
  }

  // Acheminer vers gestion-depenses2 via la file RAF (coalescing).
  if (source !== "gestion-depenses2") {
    requestExpensesViewport(payload.viewport);
  }

  // Traiter le viewport suivant en attente.
  if (state.pendingViewportPayload) {
    flushViewportSyncQueue();
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
  if (!payload || state.projectSyncInProgress || state.sharedToolbarActionInProgress) {
    return;
  }
  state.pendingViewportPayload = payload;
  flushViewportSyncQueue();
}
