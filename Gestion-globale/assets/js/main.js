import { fetchExpenseAppTables, initGrist } from "../../../gestion-depenses2/assets/js/services/gristService.js";
import {
  getProjectKpis,
} from "../../../gestion-depenses2/assets/js/services/projectService.js";
import { formatNumber, toText } from "../../../gestion-depenses2/assets/js/utils/format.js";
import {
  clearAvancementDashboard,
  renderAvancementDashboard,
} from "../../../gestion-depenses2/assets/js/ui/avancementDashboard.js";
import {
  clearExpenseTimeline,
  renderExpenseTimeline,
  renderRealExpenseTimeline,
  setExpenseGraphDisplayMode,
} from "../../../gestion-depenses2/assets/js/ui/expenseTimeline.js";
import {
  clearSpendingChartControls,
  destroyChart,
  renderSpendingChart,
  renderSpendingChartControls,
  setSpendingChartBarsFromTop,
} from "../../../gestion-depenses2/assets/js/ui/chart.js";
import {
  buildAggregatedProject,
  buildGlobalExpenseData,
  filterProjectsByDop,
  getDopLabel,
} from "./services/globalProjectService.js";

const VIEW_STATE = (() => {
  const now = new Date();
  return {
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    monthSpan: 6,
  };
})();

const state = {
  projects: [],
  selectedDop: "all",
  selectedProjectIds: new Set(),
  selectionMode: "single",
  expenseNavigationMode: "month",
  avancementConfigBySelection: new Map(),
  spendingChart: null,
};

const dom = {};

function getDomRefs() {
  Object.assign(dom, {
    status: document.getElementById("global-status"),
    dopButtons: [...document.querySelectorAll(".dop-filter-btn")],
    projectList: document.getElementById("project-list"),
    projectListSummary: document.getElementById("project-list-summary"),
    selectionModeButtons: [...document.querySelectorAll(".project-selection-mode-btn")],
    toggleVisibleProjectsBtn: document.getElementById("toggle-visible-projects-btn"),
    totalBudget: document.getElementById("global-total-budget"),
    provisionalSpending: document.getElementById("global-provisional-spending"),
    realSpending: document.getElementById("global-real-spending"),
    remainingBudget: document.getElementById("global-remaining-budget"),
    chartsEmptyState: document.getElementById("charts-empty-state"),
    avancementDashboardSection: document.getElementById("avancement-dashboard-section"),
    expenseBoard: document.getElementById("expense-board"),
    realExpenseBoard: document.getElementById("real-expense-board"),
    expenseNavigationModeButtons: [...document.querySelectorAll(".expense-navigation-mode-btn")],
    expenseNavigationRange: document.getElementById("expense-navigation-range"),
    spendingChartControls: document.getElementById("spending-chart-controls"),
    spendingChartCanvas: document.getElementById("spending-chart"),
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(value) {
  return `${formatNumber(value)} EUR`;
}

function parseDateValue(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function formatShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getExpenseNavigationPeriodCount(mode, rangeStart, rangeEnd) {
  if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date) || rangeStart > rangeEnd) {
    return 1;
  }

  if (mode === "year") {
    return Math.max(1, rangeEnd.getFullYear() - rangeStart.getFullYear() + 1);
  }

  return Math.max(
    1,
    (rangeEnd.getFullYear() - rangeStart.getFullYear()) * 12 +
      (rangeEnd.getMonth() - rangeStart.getMonth()) +
      1
  );
}

function getProjectId(project) {
  return String(project?.id ?? project?.projectNumber ?? "");
}

function compareProjects(left, right) {
  return toText(left?.name || left?.projectNumber).localeCompare(
    toText(right?.name || right?.projectNumber),
    "fr",
    {
      numeric: true,
      sensitivity: "base",
    }
  );
}

function isSelectableProject(project) {
  return !project?.isTimeRealSynthetic;
}

function getSelectableProjects() {
  return filterProjectsByDop(state.projects, state.selectedDop)
    .filter(isSelectableProject)
    .sort(compareProjects);
}

function getVisibleSelectedProjects() {
  return getSelectableProjects().filter((project) => (
    state.selectedProjectIds.has(getProjectId(project))
  ));
}

function areAllVisibleProjectsSelected(projects = getSelectableProjects()) {
  return projects.length > 0 && projects.every((project) => (
    state.selectedProjectIds.has(getProjectId(project))
  ));
}

function selectFirstVisibleProject(projects = getSelectableProjects()) {
  const firstProjectId = getProjectId(projects[0]);
  state.selectedProjectIds = firstProjectId ? new Set([firstProjectId]) : new Set();
}

function selectFirstVisibleSelectedProject(projects = getSelectableProjects()) {
  const firstSelectedProject = (projects || []).find((project) => (
    state.selectedProjectIds.has(getProjectId(project))
  ));

  const projectId = getProjectId(firstSelectedProject || projects?.[0]);
  state.selectedProjectIds = projectId ? new Set([projectId]) : new Set();
}

function ensureSelectionForMode(projects = getSelectableProjects(), { forceFirst = false } = {}) {
  if (state.selectionMode !== "single") {
    return;
  }

  if (forceFirst) {
    selectFirstVisibleProject(projects);
    return;
  }

  const visibleProjectIds = new Set(projects.map(getProjectId).filter(Boolean));
  const selectedVisibleIds = [...state.selectedProjectIds].filter((projectId) =>
    visibleProjectIds.has(projectId)
  );

  if (selectedVisibleIds.length === 1) {
    state.selectedProjectIds = new Set(selectedVisibleIds);
    return;
  }

  selectFirstVisibleProject(projects);
}

function getSelectionConfigKey(projects) {
  return (projects || [])
    .map(getProjectId)
    .filter(Boolean)
    .sort()
    .join("|");
}

function applyAvancementConfigOverride(aggregatedProject, selectedProjects) {
  if (!aggregatedProject) {
    return null;
  }

  const configKey = getSelectionConfigKey(selectedProjects);
  const localConfig = state.avancementConfigBySelection.get(configKey);
  if (localConfig) {
    aggregatedProject.avancementConfigRaw = localConfig;
  }

  return aggregatedProject;
}

function getExpenseNavigationBounds(aggregatedProject) {
  const bounds = aggregatedProject?.globalExpenseMonthBounds;
  if (!bounds) {
    return null;
  }

  const rangeStart = parseDateValue(bounds.startDate);
  const rangeEnd = parseDateValue(bounds.endDate);
  if (!rangeStart || !rangeEnd) {
    return null;
  }

  return { rangeStart, rangeEnd };
}

function getExpenseNavigationView(aggregatedProject) {
  const bounds = getExpenseNavigationBounds(aggregatedProject);
  if (!bounds) {
    return null;
  }

  const { rangeStart, rangeEnd } = bounds;
  const mode = state.expenseNavigationMode === "year" ? "year" : "month";
  const startDate = toDateInputValue(rangeStart);

  return {
    mode,
    startDate,
    rangeStartDate: toDateInputValue(rangeStart),
    rangeEndDate: toDateInputValue(rangeEnd),
    periodCount: getExpenseNavigationPeriodCount(
      mode,
      rangeStart,
      rangeEnd
    ),
    fullRange: true,
  };
}

function getExpenseNavigationEndDate(view) {
  if (!view) {
    return null;
  }

  const startDate = parseDateValue(view.startDate);
  const rangeEndDate = parseDateValue(view.rangeEndDate);
  if (!startDate || !rangeEndDate) {
    return null;
  }

  return rangeEndDate;
}

function applyExpenseNavigationView(aggregatedProject) {
  const view = getExpenseNavigationView(aggregatedProject);
  if (view) {
    aggregatedProject.globalExpenseTimelineView = view;
  }

  return view;
}

async function saveLocalAvancementConfig(selectedProjects, project, serializedConfig) {
  const configKey = getSelectionConfigKey(selectedProjects);
  if (configKey) {
    state.avancementConfigBySelection.set(configKey, serializedConfig);
  }

  project.avancementConfigRaw = serializedConfig;
}

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle("is-error", Boolean(isError));
}

function renderDopButtons() {
  dom.dopButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.dop === state.selectedDop);
  });
}

function renderSelectionModeControls(projects) {
  dom.selectionModeButtons.forEach((button) => {
    const isActive = button.dataset.selectionMode === state.selectionMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
    button.disabled = !projects.length;
  });

  const isMultipleMode = state.selectionMode === "multiple";
  const allVisibleProjectsSelected = areAllVisibleProjectsSelected(projects);
  dom.toggleVisibleProjectsBtn.hidden = !isMultipleMode;
  dom.toggleVisibleProjectsBtn.disabled = !projects.length;
  dom.toggleVisibleProjectsBtn.textContent = allVisibleProjectsSelected
    ? "Tout deselectionner"
    : "Tout selectionner";
  dom.toggleVisibleProjectsBtn.classList.toggle("secondary-btn", allVisibleProjectsSelected);
}

function renderExpenseNavigationControls(aggregatedProject) {
  const view = aggregatedProject?.globalExpenseTimelineView || null;
  const hasView = Boolean(view);
  const startDate = parseDateValue(view?.startDate);
  const endDate = getExpenseNavigationEndDate(view);

  dom.expenseNavigationModeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.expenseMode === state.expenseNavigationMode);
    button.disabled = !hasView;
  });

  dom.expenseNavigationRange.textContent =
    hasView && startDate && endDate
      ? `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`
      : "Aucune periode";
}

function renderProjectList(filteredProjects) {
  const selectedCount = filteredProjects.filter((project) => (
    state.selectedProjectIds.has(getProjectId(project))
  )).length;

  dom.projectListSummary.textContent =
    state.selectionMode === "single"
      ? `${selectedCount} projet selectionne sur ${filteredProjects.length}`
      : `${selectedCount} projet(s) selectionne(s) sur ${filteredProjects.length}`;

  if (!filteredProjects.length) {
    dom.projectList.innerHTML = `
      <p class="global-empty-state">Aucun projet pour ce filtre.</p>
    `;
    return;
  }

  dom.projectList.innerHTML = filteredProjects
    .map((project) => {
      const projectId = getProjectId(project);
      const isSelected = state.selectedProjectIds.has(projectId);
      const projectName = toText(project.name) || "Projet sans nom";
      const projectNumber = toText(project.projectNumber);
      const meta = [projectNumber, getDopLabel(project.dop)].filter(Boolean).join(" - ");
      const projectKpis = getProjectKpis(project);
      const remainingClass = projectKpis.remainingBudget < 0 ? "is-negative" : "is-positive";

      return `
        <button
          type="button"
          class="project-tile${isSelected ? " is-selected" : ""}"
          data-project-id="${escapeHtml(projectId)}"
          aria-pressed="${isSelected ? "true" : "false"}"
        >
          <span class="project-tile-main">
            <span class="project-tile-name">${escapeHtml(projectName)}</span>
            <span class="project-tile-meta">${escapeHtml(meta)}</span>
          </span>
          <span class="project-tile-values">
            <span>
              <span class="project-tile-value-label">Budget</span>
              <strong>${escapeHtml(formatCurrency(projectKpis.totalBudget))}</strong>
            </span>
            <span>
              <span class="project-tile-value-label">Reste</span>
              <strong class="project-tile-remaining ${remainingClass}">${escapeHtml(formatCurrency(projectKpis.remainingBudget))}</strong>
            </span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderKpis(aggregatedProject) {
  const kpis = aggregatedProject
    ? getProjectKpis(aggregatedProject)
    : {
        totalBudget: 0,
        totalProvisionalSpending: 0,
        totalRealSpending: 0,
        remainingBudget: 0,
      };

  dom.totalBudget.textContent = formatCurrency(kpis.totalBudget);
  dom.provisionalSpending.textContent = formatCurrency(kpis.totalProvisionalSpending);
  dom.realSpending.textContent = formatCurrency(kpis.totalRealSpending);
  dom.remainingBudget.textContent = formatCurrency(kpis.remainingBudget);
}

function clearAggregateViews() {
  clearAvancementDashboard(dom.avancementDashboardSection);
  clearExpenseTimeline(dom.expenseBoard);
  clearExpenseTimeline(dom.realExpenseBoard);
  clearSpendingChartControls(dom.spendingChartControls);
  state.spendingChart = destroyChart(state.spendingChart);
}

function renderAggregateViews(aggregatedProject, selectedProjects = getVisibleSelectedProjects()) {
  const hasSelection = Boolean(aggregatedProject);
  dom.chartsEmptyState.hidden = hasSelection;

  if (aggregatedProject) {
    applyExpenseNavigationView(aggregatedProject);
  }
  renderExpenseNavigationControls(aggregatedProject);

  if (!hasSelection) {
    clearAggregateViews();
    return;
  }

  renderAvancementDashboard(dom.avancementDashboardSection, aggregatedProject, {
    onSave: (project, serializedConfig) => (
      saveLocalAvancementConfig(selectedProjects, project, serializedConfig)
    ),
  });
  renderExpenseTimeline(dom.expenseBoard, aggregatedProject);
  renderRealExpenseTimeline(dom.realExpenseBoard, aggregatedProject);
  renderSpendingChartControls(dom.spendingChartControls);
  state.spendingChart = renderSpendingChart(
    dom.spendingChartCanvas,
    state.spendingChart,
    aggregatedProject,
    VIEW_STATE
  );
}

function renderApp() {
  const filteredProjects = getSelectableProjects();
  ensureSelectionForMode(filteredProjects);
  const selectedProjects = getVisibleSelectedProjects();
  const aggregatedProject = applyAvancementConfigOverride(
    buildAggregatedProject(selectedProjects),
    selectedProjects
  );

  renderDopButtons();
  renderSelectionModeControls(filteredProjects);
  renderProjectList(filteredProjects);
  renderKpis(aggregatedProject);
  renderAggregateViews(aggregatedProject, selectedProjects);
}

function bindEvents() {
  dom.dopButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDop = button.dataset.dop || "all";
      renderApp();
    });
  });

  dom.selectionModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.selectionMode === "multiple" ? "multiple" : "single";
      if (nextMode === state.selectionMode) {
        return;
      }

      state.selectionMode = nextMode;
      if (state.selectionMode === "single") {
        selectFirstVisibleSelectedProject(getSelectableProjects());
      }
      renderApp();
    });
  });

  dom.projectList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const projectTile = target.closest(".project-tile");
    if (!(projectTile instanceof HTMLButtonElement)) return;

    const projectId = projectTile.dataset.projectId;
    if (!projectId) return;

    if (state.selectionMode === "single") {
      state.selectedProjectIds = new Set([projectId]);
      renderApp();
      return;
    }

    if (state.selectedProjectIds.has(projectId)) {
      state.selectedProjectIds.delete(projectId);
    } else {
      state.selectedProjectIds.add(projectId);
    }

    renderApp();
  });

  dom.toggleVisibleProjectsBtn.addEventListener("click", () => {
    if (state.selectionMode !== "multiple") {
      return;
    }

    const visibleProjects = getSelectableProjects();
    const allVisibleProjectsSelected = areAllVisibleProjectsSelected(visibleProjects);
    visibleProjects.forEach((project) => {
      const projectId = getProjectId(project);
      if (!projectId) return;

      if (allVisibleProjectsSelected) {
        state.selectedProjectIds.delete(projectId);
      } else {
        state.selectedProjectIds.add(projectId);
      }
    });
    renderApp();
  });

  [dom.expenseBoard, dom.realExpenseBoard].forEach((boardEl) => {
    boardEl.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("expense-graph-unit-toggle-input")) return;

      setExpenseGraphDisplayMode(
        target.dataset.graphKind || "provisional",
        target.checked ? "days" : "currency"
      );
      const selectedProjects = getVisibleSelectedProjects();
      renderAggregateViews(
        applyAvancementConfigOverride(buildAggregatedProject(selectedProjects), selectedProjects),
        selectedProjects
      );
    });
  });

  dom.spendingChartControls.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("spending-chart-bars-toggle-input")) return;

    setSpendingChartBarsFromTop(target.checked);
    const selectedProjects = getVisibleSelectedProjects();
    renderAggregateViews(
      applyAvancementConfigOverride(buildAggregatedProject(selectedProjects), selectedProjects),
      selectedProjects
    );
  });

  dom.expenseNavigationModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.expenseMode;
      if (!["month", "year"].includes(nextMode)) {
        return;
      }

      state.expenseNavigationMode = nextMode;
      renderApp();
    });
  });
}

async function loadData() {
  setStatus("Chargement des projets...");
  const tables = await fetchExpenseAppTables();
  const { projects } = buildGlobalExpenseData(tables);

  state.projects = projects;
  state.selectedProjectIds = new Set();

  const selectableProjectCount = projects.filter(isSelectableProject).length;
  setStatus(`${selectableProjectCount} projet(s) charge(s)`);
  renderApp();
}

async function bootstrap() {
  getDomRefs();
  bindEvents();

  try {
    initGrist();
    await loadData();
  } catch (error) {
    console.error("Erreur initialisation Gestion-globale :", error);
    setStatus("Impossible de charger les donnees Grist.", true);
    renderApp();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap();
  });
}
