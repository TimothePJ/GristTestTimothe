import { fetchExpenseAppTables, initGrist } from "../../../gestion-depenses2/assets/js/services/gristService.js";
import {
  getProjectBudgetTotal,
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
  buildProjectBudgetRows,
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
  spendingChart: null,
};

const dom = {};

function getDomRefs() {
  Object.assign(dom, {
    status: document.getElementById("global-status"),
    dopButtons: [...document.querySelectorAll(".dop-filter-btn")],
    projectList: document.getElementById("project-list"),
    projectListSummary: document.getElementById("project-list-summary"),
    selectVisibleProjectsBtn: document.getElementById("select-visible-projects-btn"),
    clearVisibleProjectsBtn: document.getElementById("clear-visible-projects-btn"),
    totalBudget: document.getElementById("global-total-budget"),
    provisionalSpending: document.getElementById("global-provisional-spending"),
    realSpending: document.getElementById("global-real-spending"),
    remainingBudget: document.getElementById("global-remaining-budget"),
    budgetRecapSummary: document.getElementById("budget-recap-summary"),
    budgetRecapBody: document.getElementById("budget-recap-body"),
    budgetRecapFoot: document.getElementById("budget-recap-foot"),
    chartsEmptyState: document.getElementById("charts-empty-state"),
    avancementDashboardSection: document.getElementById("avancement-dashboard-section"),
    expenseBoard: document.getElementById("expense-board"),
    realExpenseBoard: document.getElementById("real-expense-board"),
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

function getSignedAmountClass(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return "amount-neutral";
  }

  return numericValue < 0 ? "amount-negative" : "amount-positive";
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

function getFilteredProjects() {
  return filterProjectsByDop(state.projects, state.selectedDop).sort(compareProjects);
}

function getVisibleSelectedProjects() {
  return getFilteredProjects().filter((project) => (
    state.selectedProjectIds.has(getProjectId(project))
  ));
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

function renderProjectList(filteredProjects) {
  const selectedCount = filteredProjects.filter((project) => (
    state.selectedProjectIds.has(getProjectId(project))
  )).length;

  dom.projectListSummary.textContent =
    `${selectedCount} projet(s) coche(s) sur ${filteredProjects.length}`;

  if (!filteredProjects.length) {
    dom.projectList.innerHTML = `
      <p class="global-empty-state">Aucun projet pour ce filtre.</p>
    `;
    return;
  }

  dom.projectList.innerHTML = filteredProjects
    .map((project) => {
      const projectId = getProjectId(project);
      const checked = state.selectedProjectIds.has(projectId) ? "checked" : "";
      const projectName = toText(project.name) || "Projet sans nom";
      const projectNumber = toText(project.projectNumber);
      const meta = [projectNumber, getDopLabel(project.dop)].filter(Boolean).join(" - ");

      return `
        <label class="project-list-item">
          <input type="checkbox" data-project-id="${escapeHtml(projectId)}" ${checked}>
          <span class="project-list-main">
            <span class="project-list-name">${escapeHtml(projectName)}</span>
            <span class="project-list-meta">${escapeHtml(meta)}</span>
          </span>
          <span class="project-list-budget">${escapeHtml(formatCurrency(getProjectBudgetTotal(project)))}</span>
        </label>
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

function renderBudgetRecap(selectedProjects) {
  const rows = buildProjectBudgetRows(selectedProjects);
  const totals = rows.reduce(
    (result, row) => {
      result.budget += row.budget;
      result.provisionalSpending += row.provisionalSpending;
      result.realSpending += row.realSpending;
      result.remainingBudget += row.remainingBudget;
      return result;
    },
    {
      budget: 0,
      provisionalSpending: 0,
      realSpending: 0,
      remainingBudget: 0,
    }
  );

  dom.budgetRecapSummary.textContent = `${rows.length} projet(s) dans le recap`;

  if (!rows.length) {
    dom.budgetRecapBody.innerHTML = `
      <tr>
        <td colspan="6">Aucun projet coche.</td>
      </tr>
    `;
    dom.budgetRecapFoot.innerHTML = "";
    return;
  }

  dom.budgetRecapBody.innerHTML = rows
    .map((row) => `
      <tr>
        <td>
          <strong>${escapeHtml(row.name)}</strong>
          <br>
          <span class="project-list-meta">${escapeHtml(row.projectNumber)}</span>
        </td>
        <td>${escapeHtml(getDopLabel(row.dop))}</td>
        <td>${escapeHtml(formatCurrency(row.budget))}</td>
        <td>${escapeHtml(formatCurrency(row.provisionalSpending))}</td>
        <td>${escapeHtml(formatCurrency(row.realSpending))}</td>
        <td class="${getSignedAmountClass(row.remainingBudget)}">${escapeHtml(formatCurrency(row.remainingBudget))}</td>
      </tr>
    `)
    .join("");

  dom.budgetRecapFoot.innerHTML = `
    <tr>
      <td colspan="2">Total</td>
      <td>${escapeHtml(formatCurrency(totals.budget))}</td>
      <td>${escapeHtml(formatCurrency(totals.provisionalSpending))}</td>
      <td>${escapeHtml(formatCurrency(totals.realSpending))}</td>
      <td class="${getSignedAmountClass(totals.remainingBudget)}">${escapeHtml(formatCurrency(totals.remainingBudget))}</td>
    </tr>
  `;
}

function clearAggregateViews() {
  clearAvancementDashboard(dom.avancementDashboardSection);
  clearExpenseTimeline(dom.expenseBoard);
  clearExpenseTimeline(dom.realExpenseBoard);
  clearSpendingChartControls(dom.spendingChartControls);
  state.spendingChart = destroyChart(state.spendingChart);
}

function renderAggregateViews(aggregatedProject) {
  const hasSelection = Boolean(aggregatedProject);
  dom.chartsEmptyState.hidden = hasSelection;

  if (!hasSelection) {
    clearAggregateViews();
    return;
  }

  renderAvancementDashboard(dom.avancementDashboardSection, aggregatedProject, {});
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
  const filteredProjects = getFilteredProjects();
  const selectedProjects = getVisibleSelectedProjects();
  const aggregatedProject = buildAggregatedProject(selectedProjects);

  renderDopButtons();
  renderProjectList(filteredProjects);
  renderBudgetRecap(selectedProjects);
  renderKpis(aggregatedProject);
  renderAggregateViews(aggregatedProject);
}

function bindEvents() {
  dom.dopButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDop = button.dataset.dop || "all";
      renderApp();
    });
  });

  dom.projectList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;

    const projectId = target.dataset.projectId;
    if (!projectId) return;

    if (target.checked) {
      state.selectedProjectIds.add(projectId);
    } else {
      state.selectedProjectIds.delete(projectId);
    }

    renderApp();
  });

  dom.selectVisibleProjectsBtn.addEventListener("click", () => {
    getFilteredProjects().forEach((project) => {
      state.selectedProjectIds.add(getProjectId(project));
    });
    renderApp();
  });

  dom.clearVisibleProjectsBtn.addEventListener("click", () => {
    getFilteredProjects().forEach((project) => {
      state.selectedProjectIds.delete(getProjectId(project));
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
      renderAggregateViews(buildAggregatedProject(getVisibleSelectedProjects()));
    });
  });

  dom.spendingChartControls.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("spending-chart-bars-toggle-input")) return;

    setSpendingChartBarsFromTop(target.checked);
    renderAggregateViews(buildAggregatedProject(getVisibleSelectedProjects()));
  });
}

async function loadData() {
  setStatus("Chargement des projets...");
  const tables = await fetchExpenseAppTables();
  const { projects } = buildGlobalExpenseData(tables);

  state.projects = projects;
  state.selectedProjectIds = new Set(projects.map(getProjectId).filter(Boolean));

  setStatus(`${projects.length} projet(s) charge(s)`);
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
