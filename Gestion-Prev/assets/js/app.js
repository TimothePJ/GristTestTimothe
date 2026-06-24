import { loadGestionPrevData } from "./dataService.js";
import {
  getCurrentMonthValue,
  getCurrentWeekValue,
  getCustomRange,
  getMonthsForYear,
  getMonthRange,
  getWeeksGroupedByMonth,
  getWeekRange,
  getYearFromMonthValue,
  getYearFromWeekValue,
  shiftCustomRangeValues,
  shiftMonthValue,
  shiftWeekValue,
  toInputDate,
} from "./dateRange.js";
import { computeOccupationByProject } from "./occupationService.js";
import { renderOccupationChart } from "./chartView.js";
import { compareText, formatDays, formatPercent, normalizeKey } from "./utils.js";

function getDefaultCustomPeriod() {
  const today = new Date();
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  return {
    startValue: toInputDate(today),
    endValue: toInputDate(nextWeek),
  };
}

const defaultCustomPeriod = getDefaultCustomPeriod();

const state = {
  data: null,
  currentMode: "week",
  period: {
    week: getCurrentWeekValue(),
    month: getCurrentMonthValue(),
    customStart: defaultCustomPeriod.startValue,
    customEnd: defaultCustomPeriod.endValue,
  },
  pickerYear: {
    week: getYearFromWeekValue(getCurrentWeekValue()),
    month: getYearFromMonthValue(getCurrentMonthValue()),
  },
};

const dom = {
  status: document.getElementById("data-status"),
  employeeSelect: document.getElementById("employee-select"),
  employeePicker: document.getElementById("employee-picker"),
  employeePickerToggle: document.getElementById("employee-picker-toggle"),
  employeePickerLabel: document.getElementById("employee-picker-label"),
  employeePickerPanel: document.getElementById("employee-picker-panel"),
  periodFields: document.getElementById("period-fields"),
  periodCurrentLabel: document.getElementById("period-current-label"),
  periodPickerToggle: document.getElementById("period-picker-toggle"),
  periodPrev: document.getElementById("period-prev"),
  periodNext: document.getElementById("period-next"),
  chartCanvas: document.getElementById("occupation-chart"),
  emptyState: document.getElementById("empty-state"),
  summaryList: document.getElementById("summary-list"),
  capacitySummary: document.getElementById("capacity-summary"),
  rangeLabel: document.getElementById("range-label"),
  employeeMeta: document.getElementById("employee-meta"),
};

const ROLE_ORDER = ["Ingenieur", "Projeteur", "Autres"];

function setStatus(message, type = "") {
  if (!dom.status) {
    if (type === "error") console.error(message);
    return;
  }
  dom.status.textContent = message;
  dom.status.dataset.type = type;
}

function getSelectedMode() {
  return document.querySelector('input[name="period-mode"]:checked')?.value || "week";
}

function syncPeriodStateFromInputs() {
  const startValue = document.getElementById("start-date-input")?.value;
  const endValue = document.getElementById("end-date-input")?.value;

  if (startValue) state.period.customStart = startValue;
  if (endValue) state.period.customEnd = endValue;
}

function createButton({ className, text, dataset = {}, ariaPressed = null }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  Object.entries(dataset).forEach(([key, value]) => {
    button.dataset[key] = value;
  });
  if (ariaPressed != null) {
    button.setAttribute("aria-pressed", ariaPressed ? "true" : "false");
  }
  return button;
}

function renderPickerYearHeader(title, year, mode) {
  const header = document.createElement("div");
  header.className = "picker-year-header";

  const prev = createButton({
    className: "picker-year-btn",
    text: "<",
    dataset: { action: "year-prev", mode },
  });
  prev.setAttribute("aria-label", "Annee precedente");

  const label = document.createElement("strong");
  label.textContent = `${title} ${year}`;

  const next = createButton({
    className: "picker-year-btn",
    text: ">",
    dataset: { action: "year-next", mode },
  });
  next.setAttribute("aria-label", "Annee suivante");

  header.append(prev, label, next);
  return header;
}

function renderWeekPicker() {
  const fragment = document.createDocumentFragment();
  const year = state.pickerYear.week;
  fragment.appendChild(renderPickerYearHeader("Semaines", year, "week"));

  const groups = getWeeksGroupedByMonth(year);
  const list = document.createElement("div");
  list.className = "week-picker-list";

  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "week-month-group";
    const title = document.createElement("h3");
    title.textContent = group.label;
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "week-button-grid";
    group.weeks.forEach((week) => {
      const button = createButton({
        className: "picker-option week-option",
        text: week.label,
        dataset: { weekValue: week.value },
        ariaPressed: week.value === state.period.week,
      });
      const detail = document.createElement("span");
      detail.textContent = week.detail;
      button.appendChild(detail);
      grid.appendChild(button);
    });

    section.appendChild(grid);
    list.appendChild(section);
  });

  fragment.appendChild(list);
  return fragment;
}

function renderMonthPicker() {
  const fragment = document.createDocumentFragment();
  const year = state.pickerYear.month;
  fragment.appendChild(renderPickerYearHeader("Mois", year, "month"));

  const grid = document.createElement("div");
  grid.className = "month-button-grid";

  getMonthsForYear(year).forEach((month) => {
    const button = createButton({
      className: "picker-option month-option",
      text: month.label,
      dataset: { monthValue: month.value },
      ariaPressed: month.value === state.period.month,
    });
    grid.appendChild(button);
  });

  fragment.appendChild(grid);
  return fragment;
}

function renderCustomPicker() {
  const wrapper = document.createElement("div");
  wrapper.className = "custom-picker-fields";
  wrapper.innerHTML = `
    <label class="field">
      <span>Debut</span>
      <input id="start-date-input" type="date" value="${state.period.customStart}">
    </label>
    <label class="field">
      <span>Fin</span>
      <input id="end-date-input" type="date" value="${state.period.customEnd}">
    </label>
  `;
  return wrapper;
}

function renderPeriodFields() {
  const mode = getSelectedMode();
  state.currentMode = mode;
  dom.periodFields.dataset.mode = mode;
  dom.periodFields.replaceChildren();

  if (mode === "week") {
    dom.periodFields.appendChild(renderWeekPicker());
    updatePeriodCurrentLabel();
    return;
  }

  if (mode === "month") {
    dom.periodFields.appendChild(renderMonthPicker());
    updatePeriodCurrentLabel();
    return;
  }

  dom.periodFields.appendChild(renderCustomPicker());
  updatePeriodCurrentLabel();
}

function getSelectedRange() {
  syncPeriodStateFromInputs();
  const mode = getSelectedMode();
  if (mode === "week") {
    return getWeekRange(state.period.week);
  }
  if (mode === "month") {
    return getMonthRange(state.period.month);
  }
  return getCustomRange(
    state.period.customStart,
    state.period.customEnd
  );
}

function updatePeriodCurrentLabel() {
  const range = getSelectedRange();
  dom.periodCurrentLabel.textContent = range?.label || "Periode invalide";
}

function togglePeriodPicker(forceOpen = null) {
  const shouldOpen = forceOpen == null ? dom.periodFields.hidden : forceOpen;
  dom.periodFields.hidden = !shouldOpen;
  dom.periodPickerToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function shiftCurrentPeriod(delta) {
  syncPeriodStateFromInputs();
  const mode = getSelectedMode();

  if (mode === "week") {
    state.period.week = shiftWeekValue(state.period.week, delta);
    state.pickerYear.week = getYearFromWeekValue(state.period.week);
  } else if (mode === "month") {
    state.period.month = shiftMonthValue(state.period.month, delta);
    state.pickerYear.month = getYearFromMonthValue(state.period.month);
  } else {
    const shifted = shiftCustomRangeValues(state.period.customStart, state.period.customEnd, delta);
    state.period.customStart = shifted.startValue;
    state.period.customEnd = shifted.endValue;
  }

  renderPeriodFields();
  generateChart();
}

function handlePeriodPickerClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const yearButton = target.closest("[data-action]");
  if (yearButton) {
    const mode = yearButton.dataset.mode;
    const direction = yearButton.dataset.action === "year-prev" ? -1 : 1;
    if (mode === "week") {
      state.pickerYear.week += direction;
    } else if (mode === "month") {
      state.pickerYear.month += direction;
    }
    renderPeriodFields();
    return;
  }

  const weekButton = target.closest("[data-week-value]");
  if (weekButton) {
    state.period.week = weekButton.dataset.weekValue;
    state.pickerYear.week = getYearFromWeekValue(state.period.week);
    renderPeriodFields();
    togglePeriodPicker(false);
    generateChart();
    return;
  }

  const monthButton = target.closest("[data-month-value]");
  if (monthButton) {
    state.period.month = monthButton.dataset.monthValue;
    state.pickerYear.month = getYearFromMonthValue(state.period.month);
    renderPeriodFields();
    togglePeriodPicker(false);
    generateChart();
  }
}

function getServiceLabel(employee) {
  return employee.service || "Service non renseigne";
}

function getRoleLabel(role) {
  const roleKey = normalizeKey(role);
  if (roleKey.includes("ingenieur")) return "Ingenieur";
  if (roleKey.includes("projeteur")) return "Projeteur";
  return "Autres";
}

function getRoleRank(roleLabel) {
  const rank = ROLE_ORDER.indexOf(roleLabel);
  return rank === -1 ? ROLE_ORDER.length : rank;
}

function getGroupedEmployees(employees) {
  const serviceGroups = new Map();

  employees.forEach((employee) => {
    const serviceLabel = getServiceLabel(employee);
    const serviceKey = normalizeKey(serviceLabel) || "service-non-renseigne";
    const roleLabel = getRoleLabel(employee.role);
    const roleKey = normalizeKey(roleLabel);

    if (!serviceGroups.has(serviceKey)) {
      serviceGroups.set(serviceKey, {
        label: serviceLabel,
        roles: new Map(),
      });
    }

    const serviceGroup = serviceGroups.get(serviceKey);
    if (!serviceGroup.roles.has(roleKey)) {
      serviceGroup.roles.set(roleKey, {
        label: roleLabel,
        employees: [],
      });
    }

    serviceGroup.roles.get(roleKey).employees.push({
      ...employee,
      roleLabel,
    });
  });

  return Array.from(serviceGroups.values())
    .sort((left, right) => {
      if (left.label === "Service non renseigne") return 1;
      if (right.label === "Service non renseigne") return -1;
      return compareText(left.label, right.label);
    })
    .map((group) => ({
      ...group,
      roles: Array.from(group.roles.values())
        .sort((left, right) =>
          getRoleRank(left.label) - getRoleRank(right.label) ||
          compareText(left.label, right.label)
        )
        .map((roleGroup) => ({
          ...roleGroup,
          employees: roleGroup.employees.sort((left, right) =>
            compareText(left.name, right.name)
          ),
        })),
    }));
}

function setEmployeePickerOpen(forceOpen = null) {
  const shouldOpen = forceOpen == null ? dom.employeePickerPanel.hidden : forceOpen;
  dom.employeePickerPanel.hidden = !shouldOpen;
  dom.employeePickerToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function updateEmployeeSelectionState() {
  const selectedKey = dom.employeeSelect.value;
  const employee = state.data?.employees.find((item) => item.key === selectedKey) || null;
  dom.employeePickerLabel.textContent = employee?.name || "Choisir un employe";

  dom.employeePickerPanel.querySelectorAll("[data-employee-key]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      button.dataset.employeeKey === selectedKey ? "true" : "false"
    );
  });
}

function renderEmployeePickerPanel(employeeGroups) {
  dom.employeePickerPanel.replaceChildren();

  employeeGroups.forEach((serviceGroup) => {
    const serviceSection = document.createElement("section");
    serviceSection.className = "employee-service-group";

    const serviceTitle = document.createElement("h3");
    serviceTitle.className = "employee-service-title";
    serviceTitle.textContent = serviceGroup.label;
    serviceSection.appendChild(serviceTitle);

    serviceGroup.roles.forEach((roleGroup) => {
      const roleSection = document.createElement("div");
      roleSection.className = "employee-role-group";

      const roleTitle = document.createElement("h4");
      roleTitle.className = "employee-role-title";
      roleTitle.textContent = roleGroup.label;
      roleSection.appendChild(roleTitle);

      const list = document.createElement("div");
      list.className = "employee-option-list";

      roleGroup.employees.forEach((employee) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "employee-option";
        option.dataset.employeeKey = employee.key;
        option.textContent = employee.name;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        list.appendChild(option);
      });

      roleSection.appendChild(list);
      serviceSection.appendChild(roleSection);
    });

    dom.employeePickerPanel.appendChild(serviceSection);
  });
}

function handleEmployeePickerClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const employeeButton = target.closest("[data-employee-key]");
  if (!employeeButton) return;

  dom.employeeSelect.value = employeeButton.dataset.employeeKey;
  updateEmployeeSelectionState();
  setEmployeePickerOpen(false);
  generateChart();
}

function populateEmployees(employees) {
  dom.employeeSelect.replaceChildren();
  dom.employeePickerPanel.replaceChildren();
  if (!employees.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun employe";
    dom.employeeSelect.appendChild(option);
    dom.employeeSelect.disabled = true;
    dom.employeePickerToggle.disabled = true;
    dom.employeePickerLabel.textContent = "Aucun employe";
    return;
  }

  const employeeGroups = getGroupedEmployees(employees);
  employeeGroups.forEach((serviceGroup) => {
    const group = document.createElement("optgroup");
    group.label = serviceGroup.label;

    serviceGroup.roles.forEach((roleGroup) => {
      roleGroup.employees.forEach((employee) => {
        const option = document.createElement("option");
        option.value = employee.key;
        option.textContent = `${serviceGroup.label} / ${roleGroup.label} / ${employee.name}`;
        group.appendChild(option);
      });
    });

    dom.employeeSelect.appendChild(group);
  });

  renderEmployeePickerPanel(employeeGroups);
  dom.employeeSelect.disabled = false;
  dom.employeeSelect.value = dom.employeeSelect.value || employees[0].key;
  dom.employeePickerToggle.disabled = false;
  updateEmployeeSelectionState();
}

function renderCapacitySummary(result) {
  dom.capacitySummary.replaceChildren();

  const items = [
    { label: "Occupe", value: formatDays(result.occupiedDays) },
    { label: "Libre", value: formatDays(result.freeDays) },
    { label: "Capacite", value: formatDays(result.capacityDays) },
    { label: "Taux", value: formatPercent(result.occupationRate) },
  ];

  if (result.isOverloaded) {
    items.push({ label: "Surcharge", value: formatDays(result.overloadDays), danger: true });
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = `capacity-card${item.danger ? " is-danger" : ""}`;
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = item.value;
    card.append(label, value);
    dom.capacitySummary.appendChild(card);
  });
}

function renderSummary(rows, result) {
  dom.summaryList.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "summary-empty";
    empty.textContent = result?.freeDays > 0
      ? "Aucun projet occupe sur cette periode."
      : "Aucune donnee a afficher.";
    dom.summaryList.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "summary-item";

    const title = document.createElement("strong");
    title.textContent = row.label;

    const metrics = document.createElement("span");
    metrics.textContent = `${formatDays(row.days)} - ${formatPercent(row.percent)}`;

    const bar = document.createElement("div");
    bar.className = "summary-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(2, Math.min(100, row.percent))}%`;
    bar.appendChild(fill);

    item.append(title, metrics, bar);
    dom.summaryList.appendChild(item);
  });
}

function updateEmployeeMeta(employee) {
  if (!employee) {
    dom.employeeMeta.textContent = "";
    return;
  }
  const details = [employee.role, employee.service].filter(Boolean).join(" - ");
  dom.employeeMeta.textContent = details;
}

function generateChart() {
  if (!state.data) return;

  const employeeKey = dom.employeeSelect.value;
  const employee = state.data.employees.find((item) => item.key === employeeKey) || null;
  const range = getSelectedRange();

  if (!employee || !range) {
    setStatus("Selection incomplete.", "error");
    return;
  }

  const result = computeOccupationByProject({
    employeeKey,
    segments: state.data.segments,
    projects: state.data.projects,
    range,
  });

  dom.rangeLabel.textContent = range.label;
  updatePeriodCurrentLabel();
  updateEmployeeMeta(employee);
  renderCapacitySummary(result);
  renderSummary(result.rows, result);
  renderOccupationChart(dom.chartCanvas, result.chartRows);
  dom.emptyState.hidden = result.chartRows.length > 0;
  setStatus("Pret", "ready");
}

function bindEvents() {
  document.querySelectorAll('input[name="period-mode"]').forEach((input) => {
    input.addEventListener("change", () => {
      renderPeriodFields();
      togglePeriodPicker(false);
      generateChart();
    });
  });
  dom.employeeSelect.addEventListener("change", () => {
    updateEmployeeSelectionState();
    generateChart();
  });
  dom.employeePickerToggle.addEventListener("click", () => {
    setEmployeePickerOpen();
    togglePeriodPicker(false);
  });
  dom.employeePickerPanel.addEventListener("click", handleEmployeePickerClick);
  dom.periodFields.addEventListener("change", (event) => {
    syncPeriodStateFromInputs();
    updatePeriodCurrentLabel();
    generateChart();
  });
  dom.periodFields.addEventListener("click", handlePeriodPickerClick);
  dom.periodPickerToggle.addEventListener("click", () => {
    togglePeriodPicker();
    setEmployeePickerOpen(false);
  });
  dom.periodPrev.addEventListener("click", () => {
    shiftCurrentPeriod(-1);
  });
  dom.periodNext.addEventListener("click", () => {
    shiftCurrentPeriod(1);
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    const isPeriodClick =
      target === dom.periodPickerToggle ||
      dom.periodPickerToggle.contains(target) ||
      dom.periodFields.contains(target);
    const isEmployeeClick = dom.employeePicker.contains(target);

    if (!isPeriodClick) togglePeriodPicker(false);
    if (!isEmployeeClick) setEmployeePickerOpen(false);
  });
}

async function init() {
  try {
    window.grist?.ready?.({ requiredAccess: "full" });
    renderPeriodFields();
    bindEvents();
    const data = await loadGestionPrevData();
    state.data = data;
    populateEmployees(data.employees);
    setStatus("Pret", "ready");
    generateChart();
  } catch (error) {
    console.error("Erreur initialisation Gestion-Prev :", error);
    setStatus(error?.message || "Erreur de chargement.", "error");
    dom.employeeSelect.disabled = true;
    dom.employeePickerToggle.disabled = true;
    dom.employeePickerLabel.textContent = "Chargement impossible";
  }
}

init();
