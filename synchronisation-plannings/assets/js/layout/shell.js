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
  if (sourceApp === "planning-projet-axis") {
    return [state.planningApi, state.expensesApi].filter(Boolean);
  }

  if (sourceApp === "planning-projet-main") {
    return [state.planningAxisApi, state.expensesApi].filter(Boolean);
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
}

export function appendLog() {}

export function renderProjectOptions(projectKeys) {
  if (!(dom.projectSelectEl instanceof HTMLSelectElement)) {
    return;
  }

  dom.projectSelectEl.innerHTML = "";

  const placeholderOptionEl = document.createElement("option");
  placeholderOptionEl.value = "";
  placeholderOptionEl.textContent = "Choisir un projet";
  dom.projectSelectEl.appendChild(placeholderOptionEl);

  projectKeys.forEach((projectKey) => {
    const optionEl = document.createElement("option");
    optionEl.value = projectKey;
    optionEl.textContent = projectKey;
    dom.projectSelectEl.appendChild(optionEl);
  });

  dom.projectSelectEl.value = "";
  dom.projectSelectEl.disabled = projectKeys.length === 0;
}

export function setActiveProjectSelection(projectKey = "") {
  if (dom.projectSelectEl instanceof HTMLSelectElement) {
    dom.projectSelectEl.value = String(projectKey || "").trim();
  }
}

export function setProjectContentVisibility(hasProject = false) {
  const shouldShowProjectContent = Boolean(hasProject);

  if (dom.projectEmptyStateEl instanceof HTMLElement) {
    dom.projectEmptyStateEl.hidden = shouldShowProjectContent;
  }

  if (dom.workspaceCardSectionEl instanceof HTMLElement) {
    dom.workspaceCardSectionEl.hidden = !shouldShowProjectContent;
  }

  if (dom.syncPlanningCardSectionEl instanceof HTMLElement) {
    dom.syncPlanningCardSectionEl.hidden = !shouldShowProjectContent;
  }
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

let planningWarningsModalBound = false;
let planningWarningsModalLastFocusedElement = null;

function isPlanningWarningsModalOpen() {
  return (
    dom.planningWarningsModalEl instanceof HTMLElement &&
    dom.planningWarningsModalEl.hidden === false
  );
}

function bindPlanningWarningsModal() {
  if (planningWarningsModalBound) {
    return;
  }

  planningWarningsModalBound = true;

  if (dom.planningWarningsModalCloseBtnEl instanceof HTMLButtonElement) {
    dom.planningWarningsModalCloseBtnEl.addEventListener("click", () => {
      closePlanningWarningsPopup();
    });
  }

  if (dom.planningWarningsModalEl instanceof HTMLElement) {
    dom.planningWarningsModalEl.addEventListener("click", (event) => {
      const closeTrigger = event.target instanceof HTMLElement
        ? event.target.closest("[data-planning-warnings-close]")
        : null;
      if (closeTrigger) {
        closePlanningWarningsPopup();
      }
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isPlanningWarningsModalOpen()) {
        closePlanningWarningsPopup();
      }
    });
  }
}

function buildPlanningWarningsSummary(projectKey = "", overdueWarnings = [], soonWarnings = []) {
  const parts = [];
  if (overdueWarnings.length) {
    parts.push(
      `${overdueWarnings.length} page(s) en retard`
    );
  }
  if (soonWarnings.length) {
    parts.push(
      `${soonWarnings.length} page(s) arrivent a echeance sous 7 jours`
    );
  }

  const summary = parts.join(" et ");
  if (!summary) {
    return String(projectKey || "").trim()
      ? `Projet ${String(projectKey || "").trim()}`
      : "";
  }

  return `${summary}.`;
}

function buildPlanningWarningsSection(title, warnings = [], severity = "warning") {
  const sectionEl = document.createElement("section");
  sectionEl.className = "planning-warnings-modal__section";

  const titleEl = document.createElement("p");
  titleEl.className = "planning-warnings-modal__section-title";
  titleEl.textContent = title;
  sectionEl.appendChild(titleEl);

  warnings.forEach((warning) => {
    const rowEl = document.createElement("article");
    rowEl.className = `planning-warnings-modal__row is-${severity}`;

    const contentEl = document.createElement("div");
    contentEl.className = "planning-warnings-modal__row-content";

    const labelEl = document.createElement("p");
    labelEl.className = "planning-warnings-modal__row-title";
    labelEl.textContent = String(warning?.label || "Page").trim() || "Page";
    contentEl.appendChild(labelEl);

    const messageEl = document.createElement("p");
    messageEl.className = "planning-warnings-modal__row-message";
    messageEl.textContent = String(warning?.message || "").trim();
    contentEl.appendChild(messageEl);

    rowEl.appendChild(contentEl);

    const badgeEl = document.createElement("span");
    badgeEl.className = `planning-warnings-modal__badge is-${severity}`;
    if (severity === "danger") {
      badgeEl.textContent = `${Number(warning?.days) || 0} j`;
    } else {
      const days = Number(warning?.days) || 0;
      badgeEl.textContent = days <= 0 ? "Aujourd'hui" : `J-${days}`;
    }
    rowEl.appendChild(badgeEl);

    sectionEl.appendChild(rowEl);
  });

  return sectionEl;
}

export function closePlanningWarningsPopup() {
  if (!(dom.planningWarningsModalEl instanceof HTMLElement)) {
    return;
  }

  dom.planningWarningsModalEl.hidden = true;
  dom.planningWarningsModalEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-planning-warnings-modal-open");

  if (planningWarningsModalLastFocusedElement instanceof HTMLElement) {
    planningWarningsModalLastFocusedElement.focus();
  }

  planningWarningsModalLastFocusedElement = null;
}

export function showPlanningWarningsPopup(projectKey = "", warnings = []) {
  if (
    !(dom.planningWarningsModalEl instanceof HTMLElement) ||
    !(dom.planningWarningsModalListEl instanceof HTMLElement)
  ) {
    return;
  }

  bindPlanningWarningsModal();

  const normalizedWarnings = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  if (!normalizedWarnings.length) {
    closePlanningWarningsPopup();
    return;
  }

  const overdueWarnings = normalizedWarnings.filter(
    (warning) => String(warning?.severity || "").trim() === "danger"
  );
  const soonWarnings = normalizedWarnings.filter(
    (warning) => String(warning?.severity || "").trim() === "warning"
  );

  if (dom.planningWarningsModalTitleEl instanceof HTMLElement) {
    dom.planningWarningsModalTitleEl.textContent = "Alertes projet";
  }
  if (dom.planningWarningsModalSubtitleEl instanceof HTMLElement) {
    const normalizedProjectKey = String(projectKey || "").trim();
    dom.planningWarningsModalSubtitleEl.textContent = normalizedProjectKey
      ? `Projet ${normalizedProjectKey}`
      : "Projet selectionne";
  }
  if (dom.planningWarningsModalSummaryEl instanceof HTMLElement) {
    dom.planningWarningsModalSummaryEl.textContent = buildPlanningWarningsSummary(
      projectKey,
      overdueWarnings,
      soonWarnings
    );
  }

  dom.planningWarningsModalListEl.replaceChildren();

  if (overdueWarnings.length) {
    dom.planningWarningsModalListEl.appendChild(
      buildPlanningWarningsSection("Retards constates", overdueWarnings, "danger")
    );
  }

  if (soonWarnings.length) {
    dom.planningWarningsModalListEl.appendChild(
      buildPlanningWarningsSection(
        "Echeances a moins de 7 jours",
        soonWarnings,
        "warning"
      )
    );
  }

  planningWarningsModalLastFocusedElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  dom.planningWarningsModalEl.hidden = false;
  dom.planningWarningsModalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-planning-warnings-modal-open");

  if (dom.planningWarningsModalCloseBtnEl instanceof HTMLButtonElement) {
    dom.planningWarningsModalCloseBtnEl.focus();
  }
}
