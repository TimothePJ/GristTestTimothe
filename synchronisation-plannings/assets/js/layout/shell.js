import { dom } from "../app/dom.js";
import { state } from "../app/state.js";
import { buildCanonicalSharedViewport } from "../viewport/build.js";
import { normalizeIsoDate, shiftIsoDateValue } from "../viewport/normalize.js";

export function getViewportSourceLabel(sourceApp = "") {
  if (sourceApp === "planning-projet-axis") {
    return "frise commune";
  }

  if (sourceApp === "planning-projet-main") {
    return "planning-projet";
  }

  if (sourceApp === "gestion-depenses2") {
    return "gestion-depenses2";
  }

  if (sourceApp === "Pilotage commun") {
    return "Pilotage commun";
  }

  return String(sourceApp || "").trim() || "source inconnue";
}

export function getViewportSourceApi(sourceApp = "") {
  if (sourceApp === "planning-projet-axis") {
    return state.planningAxisApi;
  }

  if (sourceApp === "planning-projet-main") {
    return state.planningApi;
  }

  if (sourceApp === "gestion-depenses2") {
    return state.expensesApi;
  }

  return null;
}

export function getViewportTargetApis(sourceApp = "") {
  // Non utilisé par flushViewportSyncQueue (logique directe).
  // Conservé pour compatibilité si d'autres modules l'importent.
  if (sourceApp === "planning-projet-axis") {
    return [state.planningApi].filter(Boolean);
  }
  if (sourceApp === "planning-projet-main") {
    return [state.planningAxisApi].filter(Boolean);
  }
  if (sourceApp === "gestion-depenses2") {
    return [state.planningApi, state.planningAxisApi].filter(Boolean);
  }
  return [];
}

export function setHubStatus(message) {
  if (dom.statusValueEl) {
    dom.statusValueEl.textContent = String(message || "").trim() || "-";
  }
}

export function setLastSource(message) {
  if (dom.lastSourceValueEl) {
    dom.lastSourceValueEl.textContent = String(message || "").trim() || "-";
  }
}

export function setLastRange(viewport = null) {
  if (!dom.lastRangeValueEl) {
    return;
  }

  if (!viewport) {
    dom.lastRangeValueEl.textContent = "-";
    return;
  }

  const visibleDays = Number(viewport.visibleDays);
  const start = String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim();
  const end =
    String(viewport.rangeEndDate || "").trim() ||
    shiftIsoDateValue(start, Math.max(0, visibleDays - 1));
  const mode = String(viewport.mode || "").trim();

  dom.lastRangeValueEl.textContent = [
    start && end ? `${start} -> ${end}` : start || end || "-",
    mode || "mode ?",
    Number.isFinite(visibleDays) ? `${visibleDays} j` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

export function setExpensesPlanningControlsDisabled(disabled = true) {
  dom.expensesModeButtons.forEach((buttonEl) => {
    buttonEl.disabled = Boolean(disabled);
  });

  if (dom.sharedPrevBtnEl instanceof HTMLButtonElement) {
    dom.sharedPrevBtnEl.disabled = Boolean(disabled);
  }

  if (dom.sharedCenterBtnEl instanceof HTMLButtonElement) {
    dom.sharedCenterBtnEl.disabled = Boolean(disabled);
  }

  if (dom.sharedNextBtnEl instanceof HTMLButtonElement) {
    dom.sharedNextBtnEl.disabled = Boolean(disabled);
  }
}

export function isSharedPlanningControlsLocked() {
  const hasActiveProject = Boolean(String(state.activeProjectKey || "").trim());
  const planningReady = Boolean(state.planningApi && state.planningAxisApi);

  return (
    !hasActiveProject ||
    !planningReady ||
    state.projectSyncInProgress ||
    state.viewportSyncInProgress ||
    state.sharedToolbarActionInProgress
  );
}

export function syncSharedPlanningControlsAvailability() {
  const locked = isSharedPlanningControlsLocked();
  setExpensesPlanningControlsDisabled(locked);
  return !locked;
}

export function formatSharedCenterLabel(mode = "", anchorDateValue = "") {
  const normalizedMode = String(mode || "").trim() || "week";
  const normalizedAnchorDate = normalizeIsoDate(anchorDateValue);
  const anchorDate = normalizedAnchorDate
    ? new Date(`${normalizedAnchorDate}T12:00:00`)
    : new Date();

  if (Number.isNaN(anchorDate.getTime())) {
    return "Aujourd'hui";
  }

  if (normalizedMode === "week") {
    const day = anchorDate.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(anchorDate);
    monday.setDate(anchorDate.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return `Semaine du ${monday.toLocaleDateString("fr-FR")}`;
  }

  if (normalizedMode === "month") {
    const monthLabel = anchorDate.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  }

  if (normalizedMode === "year") {
    return String(anchorDate.getFullYear());
  }

  return "Aujourd'hui";
}

export function formatSharedRangeLabel(startDateValue, endDateValue, availableWidth = Infinity) {
  const normalizedStartDate = normalizeIsoDate(startDateValue);
  const normalizedEndDate = normalizeIsoDate(endDateValue);
  if (!normalizedStartDate) {
    return "-";
  }

  const startDate = new Date(`${normalizedStartDate}T12:00:00`);
  if (Number.isNaN(startDate.getTime())) {
    return "-";
  }

  if (!normalizedEndDate) {
    return startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const endDate = new Date(`${normalizedEndDate}T12:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const full = [
    startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    endDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  ].join(" - ");

  const medium = [
    startDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  ].join(" - ");

  const compact = [
    startDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }),
  ].join(" - ");

  const minimal = [
    startDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }),
  ].join(" - ");

  if (availableWidth >= 340) return full;
  if (availableWidth >= 255) return medium;
  if (availableWidth >= 185) return compact;
  return minimal;
}

export function syncExpensesPlanningShell(viewport = null) {
  const canonicalViewport = viewport ? buildCanonicalSharedViewport(viewport) : null;
  if (canonicalViewport) {
    state.sharedViewportState = canonicalViewport;
  }

  const activeViewport = canonicalViewport || state.sharedViewportState;
  const activeMode = String(activeViewport?.mode || "").trim();
  const activeDateValue =
    normalizeIsoDate(activeViewport?.firstVisibleDate) ||
    normalizeIsoDate(activeViewport?.rangeStartDate) ||
    "";

  dom.expensesModeButtons.forEach((buttonEl) => {
    const buttonMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
    const isActive = buttonMode && buttonMode === activeMode;
    buttonEl.classList.toggle("is-active", isActive);
    buttonEl.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (dom.sharedCenterBtnEl instanceof HTMLButtonElement) {
    dom.sharedCenterBtnEl.textContent = formatSharedCenterLabel(
      activeMode,
      activeViewport?.anchorDate || activeDateValue
    );
  }

  if (dom.sharedCurrentDateRangeEl instanceof HTMLElement) {
    const availableWidth = Math.max(
      0,
      Math.round(
        dom.sharedCurrentDateRangeEl.getBoundingClientRect().width ||
          dom.sharedCurrentDateRangeEl.clientWidth ||
          0
      )
    );
    const fullLabel = formatSharedRangeLabel(
      activeViewport?.firstVisibleDate || activeViewport?.rangeStartDate || "",
      activeViewport?.rangeEndDate || "",
      Number.MAX_SAFE_INTEGER
    );
    dom.sharedCurrentDateRangeEl.textContent = formatSharedRangeLabel(
      activeViewport?.firstVisibleDate || activeViewport?.rangeStartDate || "",
      activeViewport?.rangeEndDate || "",
      availableWidth
    );
    dom.sharedCurrentDateRangeEl.title = fullLabel;
  }

  syncSharedPlanningControlsAvailability();
}

export function appendLog() {}

export function renderProjectOptions(projectKeys, selectedProjectKey = "") {
  if (!(dom.projectSelectEl instanceof HTMLSelectElement)) {
    return;
  }

  const normalizedSelectedProjectKey = String(selectedProjectKey || "").trim();
  const normalizedProjectKeys = (projectKeys || [])
    .map((projectKey) => String(projectKey || "").trim())
    .filter(Boolean);
  const hasSelectedProjectOption =
    normalizedSelectedProjectKey &&
    normalizedProjectKeys.some((projectKey) => projectKey === normalizedSelectedProjectKey);
  dom.projectSelectEl.innerHTML = "";

  const placeholderOptionEl = document.createElement("option");
  placeholderOptionEl.value = "";
  placeholderOptionEl.textContent = "Choisir un projet";
  placeholderOptionEl.selected = !normalizedSelectedProjectKey;
  dom.projectSelectEl.appendChild(placeholderOptionEl);

  normalizedProjectKeys.forEach((normalizedProjectKey) => {
    const optionEl = document.createElement("option");
    optionEl.value = normalizedProjectKey;
    optionEl.textContent = normalizedProjectKey;
    optionEl.selected = normalizedProjectKey === normalizedSelectedProjectKey;
    if (optionEl.selected) {
      optionEl.setAttribute("selected", "selected");
    }
    dom.projectSelectEl.appendChild(optionEl);
  });

  if (normalizedSelectedProjectKey && !hasSelectedProjectOption) {
    const selectedOptionEl = document.createElement("option");
    selectedOptionEl.value = normalizedSelectedProjectKey;
    selectedOptionEl.textContent = normalizedSelectedProjectKey;
    selectedOptionEl.selected = true;
    selectedOptionEl.setAttribute("selected", "selected");
    dom.projectSelectEl.appendChild(selectedOptionEl);
  }

  dom.projectSelectEl.value = normalizedSelectedProjectKey;
  if (dom.projectSelectEl.value !== normalizedSelectedProjectKey) {
    dom.projectSelectEl.value = "";
  }
  dom.projectSelectEl.disabled = normalizedProjectKeys.length === 0 && !normalizedSelectedProjectKey;
}

export function setActiveProjectSelection(projectKey = "") {
  if (dom.projectSelectEl instanceof HTMLSelectElement) {
    const normalizedProjectKey = String(projectKey || "").trim();
    if (
      normalizedProjectKey &&
      !Array.from(dom.projectSelectEl.options).some((optionEl) => optionEl.value === normalizedProjectKey)
    ) {
      const optionEl = document.createElement("option");
      optionEl.value = normalizedProjectKey;
      optionEl.textContent = normalizedProjectKey;
      dom.projectSelectEl.appendChild(optionEl);
      dom.projectSelectEl.disabled = false;
    }
    dom.projectSelectEl.value = normalizedProjectKey;
    Array.from(dom.projectSelectEl.options).forEach((optionEl) => {
      optionEl.selected = optionEl.value === normalizedProjectKey;
      if (optionEl.selected) {
        optionEl.setAttribute("selected", "selected");
      } else {
        optionEl.removeAttribute("selected");
      }
    });
  }

  syncSharedPlanningControlsAvailability();
}

export function setProjectContentVisibility(hasProject = false) {
  const shouldShowProjectContent = Boolean(hasProject);

  if (dom.projectEmptyStateEl instanceof HTMLElement) {
    dom.projectEmptyStateEl.hidden = shouldShowProjectContent;
  }

  if (dom.syncPlanningCardSectionEl instanceof HTMLElement) {
    dom.syncPlanningCardSectionEl.hidden = !shouldShowProjectContent;
  }

  syncSharedPlanningControlsAvailability();
}

export function setSelectionWarning(selection = null) {
  if (!(dom.selectionWarningEl instanceof HTMLElement)) {
    return;
  }

  const warning = selection?.warning || null;
  if (!warning?.message) {
    dom.selectionWarningEl.hidden = true;
    dom.selectionWarningEl.classList.add("is-hidden");
    dom.selectionWarningEl.classList.remove("is-warning", "is-danger");
    if (dom.selectionWarningTitleEl instanceof HTMLElement) {
      dom.selectionWarningTitleEl.textContent = "";
    }
    if (dom.selectionWarningMessageEl instanceof HTMLElement) {
      dom.selectionWarningMessageEl.textContent = "";
    }
    return;
  }

  dom.selectionWarningEl.hidden = false;
  dom.selectionWarningEl.classList.remove("is-hidden");
  dom.selectionWarningEl.classList.toggle("is-warning", warning.severity === "warning");
  dom.selectionWarningEl.classList.toggle("is-danger", warning.severity === "danger");

  if (dom.selectionWarningTitleEl instanceof HTMLElement) {
    dom.selectionWarningTitleEl.textContent = String(selection?.label || "Page selectionnee");
  }

  if (dom.selectionWarningMessageEl instanceof HTMLElement) {
    dom.selectionWarningMessageEl.textContent = String(warning.message || "").trim();
  }
}

// Système d'alertes retards supprimé.
export function closePlanningWarningsPopup() {}
export function showPlanningWarningsPopup() {
}
