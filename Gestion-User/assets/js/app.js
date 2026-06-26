import { loadGestionUserData } from "./dataService.js";
import {
  getRangeCapacityDays,
  getWeekRange,
  getWeeksGroupedByMonth,
} from "./dateRange.js";
import { computeWeeklyUtilizationMatrix } from "./utilizationService.js";
import {
  compareText,
  normalizeKey,
  toText,
} from "./utils.js";

const state = {
  data: null,
  year: new Date().getFullYear(),
  weekGroups: [],
  weeks: [],
  weekCache: new Map(),
  renderedCalendarYear: null,
  viewRows: [],
  projectOptions: [],
  filters: {
    service: "",
    role: "",
    dop: "",
    includeEmptyEmployees: false,
    visibleProjectNumbers: new Set(),
  },
};

const dom = {
  status: document.getElementById("data-status"),
  yearSelect: document.getElementById("year-select"),
  yearPrev: document.getElementById("year-prev"),
  yearNext: document.getElementById("year-next"),
  serviceFilter: document.getElementById("service-filter"),
  roleFilter: document.getElementById("role-filter"),
  dopFilter: document.getElementById("dop-filter"),
  includeEmptyEmployees: document.getElementById("include-empty-employees"),
  projectFilter: document.getElementById("project-filter"),
  projectFilterToggle: document.getElementById("project-filter-toggle"),
  projectFilterLabel: document.getElementById("project-filter-label"),
  projectFilterPanel: document.getElementById("project-filter-panel"),
  projectOptionList: document.getElementById("project-option-list"),
  projectSelectAll: document.getElementById("project-select-all"),
  projectClearAll: document.getElementById("project-clear-all"),
  allocationTableWrap: document.getElementById("allocation-table-wrap"),
  frozenHeadCols: document.getElementById("frozen-head-cols"),
  timelineHeadCols: document.getElementById("timeline-head-cols"),
  frozenBodyCols: document.getElementById("frozen-body-cols"),
  timelineBodyCols: document.getElementById("timeline-body-cols"),
  frozenHead: document.getElementById("frozen-head"),
  timelineHead: document.getElementById("timeline-head"),
  frozenBody: document.getElementById("frozen-body"),
  timelineBody: document.getElementById("timeline-body"),
  frozenBodyScroll: document.getElementById("frozen-body-scroll"),
  timelineHeadScroll: document.getElementById("timeline-head-scroll"),
  timelineBodyScroll: document.getElementById("timeline-body-scroll"),
  tableCaption: document.getElementById("table-caption"),
  emptyState: document.getElementById("empty-state"),
};

dom.timelineHeadTable = dom.timelineHead.closest("table");
dom.timelineBodyTable = dom.timelineBody.closest("table");

const MONTH_LABELS = {
  short: ["JAN", "FEV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOUT", "SEP", "OCT", "NOV", "DEC"],
  long: ["JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE"],
};

const VISIBLE_ROW_BUFFER = 10;

let renderFrame = null;
let visibleRowsFrame = null;
let timelineLayoutFrame = null;
let isRenderingVisibleRows = false;

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function setStatus(message, type = "") {
  if (!dom.status) {
    if (type === "error") console.error(message);
    return;
  }
  dom.status.hidden = !message;
  dom.status.textContent = message;
  dom.status.dataset.type = type;
}

function getMonthLabel(date, useShortLabel = false) {
  const monthIndex = date.getMonth();
  return useShortLabel
    ? MONTH_LABELS.short[monthIndex]
    : MONTH_LABELS.long[monthIndex];
}

function formatShortDate(date) {
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function buildWeekGroups(year) {
  const groups = getWeeksGroupedByMonth(year);
  return groups.map((group) => {
    const monthDate = new Date(`${group.key}-01T00:00:00`);
    const weeks = group.weeks
      .map((week) => {
        const range = getWeekRange(week.value);
        if (!range) return null;
        const friday = addDays(range.start, 4);

        return {
          ...week,
          range,
          startTime: range.start.getTime(),
          endTime: range.end.getTime(),
          capacityDays: getRangeCapacityDays(range),
          detail: `${formatShortDate(range.start)} au ${formatShortDate(friday)}`,
        };
      })
      .filter(Boolean);

    const groupYear = Number(String(group.key).slice(0, 4));
    const useShortLabel = weeks.length <= 1 || groupYear !== Number(year);

    return {
      ...group,
      label: getMonthLabel(monthDate, useShortLabel),
      weeks,
    };
  }).filter((group) => group.weeks.length > 0);
}

function flattenWeeks(groups) {
  return groups.flatMap((group) => group.weeks);
}

function getWeeksForYear(year) {
  const normalizedYear = Number(year) || new Date().getFullYear();
  if (!state.weekCache.has(normalizedYear)) {
    const groups = buildWeekGroups(normalizedYear);
    state.weekCache.set(normalizedYear, {
      groups,
      weeks: flattenWeeks(groups),
    });
  }

  return state.weekCache.get(normalizedYear);
}

function getSegmentYearBounds(segments) {
  const years = new Set([new Date().getFullYear()]);

  segments.forEach((segment) => {
    if (segment.startDate) years.add(segment.startDate.getFullYear());
    if (segment.endDate) years.add(segment.endDate.getFullYear());
  });

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  return { minYear: minYear - 1, maxYear: maxYear + 1 };
}

function ensureYearOption(year) {
  const exists = Array.from(dom.yearSelect.options).some((option) =>
    Number(option.value) === year
  );
  if (exists) return;

  const option = document.createElement("option");
  option.value = String(year);
  option.textContent = String(year);
  dom.yearSelect.appendChild(option);

  Array.from(dom.yearSelect.options)
    .sort((left, right) => Number(left.value) - Number(right.value))
    .forEach((sortedOption) => dom.yearSelect.appendChild(sortedOption));
}

function populateYearSelect(minYear, maxYear) {
  dom.yearSelect.replaceChildren();
  for (let year = minYear; year <= maxYear; year += 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    dom.yearSelect.appendChild(option);
  }
  ensureYearOption(state.year);
  dom.yearSelect.value = String(state.year);
}

function getServiceLabel(employee) {
  return toText(employee.service) || "Service non renseign\u00e9";
}

function getRoleLabel(employee) {
  return toText(employee.role) || "R\u00f4le non renseign\u00e9";
}

function getProjectDopLabel(project) {
  return toText(project?.dop) || "DOP non renseign\u00e9e";
}

function getFilterKey(label) {
  return normalizeKey(label);
}

function setSelectOptions(select, options, defaultLabel) {
  select.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = defaultLabel;
  select.appendChild(defaultOption);

  options.forEach(({ key, label }) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    select.appendChild(option);
  });
}

function getUniqueFilterOptions(employees, getLabel) {
  const byKey = new Map();

  employees.forEach((employee) => {
    const label = getLabel(employee);
    const key = getFilterKey(label);
    if (!key || byKey.has(key)) return;
    byKey.set(key, { key, label });
  });

  return Array.from(byKey.values()).sort((left, right) =>
    compareText(left.label, right.label)
  );
}

function populateFilters(employees, projects) {
  setSelectOptions(
    dom.serviceFilter,
    getUniqueFilterOptions(employees, getServiceLabel),
    "Tous les services"
  );
  setSelectOptions(
    dom.roleFilter,
    getUniqueFilterOptions(employees, getRoleLabel),
    "Tous les r\u00f4les"
  );
  setSelectOptions(
    dom.dopFilter,
    getUniqueFilterOptions(Array.from(projects.values()), getProjectDopLabel),
    "Toutes les DOP"
  );
  dom.serviceFilter.value = state.filters.service;
  dom.roleFilter.value = state.filters.role;
  dom.dopFilter.value = state.filters.dop;
}

function getProjectLabel(projectNumber) {
  const number = toText(projectNumber) || "Sans projet";
  const project = state.data?.projects.get(number);
  if (!project) return `${number} - Projet introuvable`;
  return project.name ? `${number} - ${project.name}` : number;
}

function buildProjectOptions(data) {
  const projectNumbers = new Set(
    data.segments.map((segment) => segment.projectNumber).filter(Boolean)
  );

  return Array.from(projectNumbers)
    .map((number) => ({
      number,
      label: getProjectLabel(number),
    }))
    .sort((left, right) => compareText(left.label, right.label));
}

function updateProjectFilterLabel() {
  const selectedCount = state.filters.visibleProjectNumbers.size;
  const totalCount = state.projectOptions.length;

  if (totalCount === 0 || selectedCount === 0) {
    dom.projectFilterLabel.textContent = "Aucun projet";
  } else if (selectedCount === totalCount) {
    dom.projectFilterLabel.textContent = "Tous les projets";
  } else {
    dom.projectFilterLabel.textContent = `${selectedCount} projets s\u00e9lectionn\u00e9s`;
  }

  dom.projectOptionList.querySelectorAll("[data-project-number]").forEach((input) => {
    input.checked = state.filters.visibleProjectNumbers.has(input.value);
  });
}

function renderProjectFilterOptions() {
  dom.projectOptionList.replaceChildren();

  state.projectOptions.forEach((project) => {
    const label = document.createElement("label");
    label.className = "project-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = project.number;
    checkbox.dataset.projectNumber = project.number;
    checkbox.checked = state.filters.visibleProjectNumbers.has(project.number);

    const text = document.createElement("span");
    text.textContent = project.label;

    label.append(checkbox, text);
    dom.projectOptionList.appendChild(label);
  });
}

function populateProjectFilter(data) {
  state.projectOptions = buildProjectOptions(data);
  state.filters.visibleProjectNumbers = new Set(
    state.projectOptions.map((project) => project.number)
  );
  renderProjectFilterOptions();
  updateProjectFilterLabel();
}

function setProjectFilterOpen(forceOpen = null) {
  const shouldOpen = forceOpen == null ? dom.projectFilterPanel.hidden : forceOpen;
  dom.projectFilterPanel.hidden = !shouldOpen;
  dom.projectFilterToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function setAllProjectsSelected(selected) {
  state.filters.visibleProjectNumbers = selected
    ? new Set(state.projectOptions.map((project) => project.number))
    : new Set();
  updateProjectFilterLabel();
  scheduleRender();
}

function createHeaderCell(text, className = "") {
  const cell = document.createElement("th");
  cell.scope = "col";
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function createColumn(className) {
  const column = document.createElement("col");
  column.className = className;
  return column;
}

function renderColGroups() {
  dom.frozenHeadCols.replaceChildren(
    createColumn("project-col-width"),
    createColumn("employee-col-width")
  );
  dom.frozenBodyCols.replaceChildren(
    createColumn("project-col-width"),
    createColumn("employee-col-width")
  );

  const headColumns = state.weeks.map(() => createColumn("week-col-width"));
  const bodyColumns = state.weeks.map(() => createColumn("week-col-width"));
  dom.timelineHeadCols.replaceChildren(...headColumns);
  dom.timelineBodyCols.replaceChildren(...bodyColumns);
}

function getCssPixelValue(variableName) {
  const rawValue = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  const value = Number.parseFloat(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function syncTimelineTableWidths() {
  const weekWidth = getCssPixelValue("--week-col-width");
  const timelineWidth = Math.max(0, state.weeks.length * weekWidth);
  [dom.timelineHeadTable, dom.timelineBodyTable].forEach((table) => {
    if (!table) return;
    table.style.width = `${timelineWidth}px`;
    table.style.minWidth = `${timelineWidth}px`;
  });
}

function syncTimelineLayout() {
  syncTimelineTableWidths();
  if (timelineLayoutFrame != null) return;

  timelineLayoutFrame = requestAnimationFrame(() => {
    timelineLayoutFrame = null;
    const scrollbarWidth = Math.max(
      0,
      dom.timelineBodyScroll.offsetWidth - dom.timelineBodyScroll.clientWidth
    );
    document.documentElement.style.setProperty(
      "--timeline-scrollbar-width",
      `${scrollbarWidth}px`
    );
    dom.timelineHeadScroll.scrollLeft = dom.timelineBodyScroll.scrollLeft;
  });
}

function renderTableHeader() {
  dom.frozenHead.replaceChildren();
  dom.timelineHead.replaceChildren();

  const frozenRow = document.createElement("tr");
  frozenRow.append(
    createHeaderCell("Num\u00e9ro projet - Nom projet", "project-col"),
    createHeaderCell("Employ\u00e9", "employee-col")
  );
  dom.frozenHead.appendChild(frozenRow);

  const monthRow = document.createElement("tr");
  monthRow.className = "month-row";

  state.weekGroups.forEach((group) => {
    const monthCell = createHeaderCell(group.label, "month-header");
    monthCell.colSpan = group.weeks.length;
    monthRow.appendChild(monthCell);
  });

  const weekRow = document.createElement("tr");
  weekRow.className = "week-row";

  state.weeks.forEach((week) => {
    const cell = createHeaderCell("", "week-header");
    const title = document.createElement("span");
    title.textContent = "Semaine";
    const detail = document.createElement("strong");
    detail.textContent = week.detail.replace(" au ", " - ");
    cell.append(title, detail);
    weekRow.appendChild(cell);
  });

  dom.timelineHead.append(monthRow, weekRow);
}

function getRoundedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number);
}

function applyTotalCellClass(cell, percent) {
  const rounded = getRoundedPercent(percent);
  if (percent > 100.5) {
    cell.classList.add("is-overload");
  } else if (rounded === 100) {
    cell.classList.add("is-balanced");
  } else if (rounded > 0) {
    cell.classList.add("is-partial");
  }
}

function createPercentCell(row, week) {
  const cell = document.createElement("td");
  cell.className = "week-cell";
  const percent = row.weekPercents[week.value] || 0;

  if (row.type === "total") {
    const rounded = getRoundedPercent(percent);
    if (rounded > 0) cell.textContent = String(rounded);
    applyTotalCellClass(cell, percent);
    return cell;
  }

  if (percent > 0) {
    cell.textContent = String(getRoundedPercent(percent));
    cell.classList.add("has-value");
    if (percent > 100.5) cell.classList.add("is-overload");
  }

  return cell;
}

function createRowHeader(text, className) {
  const cell = document.createElement("th");
  cell.scope = "row";
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function getRowClassName(row, extraClass = "") {
  return [row.type === "total" ? "total-row" : "", extraClass]
    .filter(Boolean)
    .join(" ");
}

function renderFrozenMatrixRow(row, extraClass = "") {
  const tableRow = document.createElement("tr");
  tableRow.className = getRowClassName(row, extraClass);

  tableRow.append(
    createRowHeader(row.projectLabel, "project-col"),
    createRowHeader(row.employeeLabel, "employee-col")
  );

  return tableRow;
}

function renderTimelineMatrixRow(row, extraClass = "") {
  const tableRow = document.createElement("tr");
  tableRow.className = getRowClassName(row, extraClass);

  state.weeks.forEach((week) => {
    tableRow.appendChild(createPercentCell(row, week));
  });

  return tableRow;
}

function flattenMatrixRows(matrix) {
  const rows = [];

  matrix.forEach((employeeBlock) => {
    employeeBlock.projectRows.forEach((row, index) => {
      rows.push({
        row,
        extraClass: index === 0 ? "employee-group-start" : "",
      });
    });
    rows.push({
      row: employeeBlock.totalRow,
      extraClass: "employee-group-end",
    });
  });

  return rows;
}

function createSpacerRow(height, colSpan) {
  if (height <= 0) return null;

  const tableRow = document.createElement("tr");
  tableRow.className = "virtual-spacer";
  const cell = document.createElement("td");
  cell.colSpan = colSpan;
  cell.style.height = `${height}px`;
  tableRow.appendChild(cell);
  return tableRow;
}

function getMatrixRowHeight() {
  return getCssPixelValue("--matrix-row-height") || 28;
}

function updateTableHeight(rowCount = state.viewRows.length) {
  if (!dom.allocationTableWrap) return;

  const rowHeight = getMatrixRowHeight();
  const headerHeight = getCssPixelValue("--planner-header-height") || 98;
  const scrollbarHeight = 18;
  const viewportGap = window.innerWidth <= 900 ? 10 : 18;
  const wrapTop = dom.allocationTableWrap.getBoundingClientRect().top;
  const availableHeight = Math.max(160, window.innerHeight - wrapTop - viewportGap);
  const compactHeight = rowCount > 0
    ? headerHeight + (rowCount * rowHeight) + scrollbarHeight + 2
    : 180;

  dom.allocationTableWrap.style.height = `${Math.ceil(Math.min(compactHeight, availableHeight))}px`;
}

function renderVisibleRows() {
  const rowHeight = getMatrixRowHeight();
  const viewportHeight = dom.timelineBodyScroll.clientHeight || rowHeight * 20;
  const scrollTop = dom.timelineBodyScroll.scrollTop;
  const scrollLeft = dom.timelineBodyScroll.scrollLeft;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - VISIBLE_ROW_BUFFER);
  const endIndex = Math.min(
    state.viewRows.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + VISIBLE_ROW_BUFFER
  );
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (state.viewRows.length - endIndex) * rowHeight);

  isRenderingVisibleRows = true;
  dom.frozenBody.replaceChildren();
  dom.timelineBody.replaceChildren();

  const frozenFragment = document.createDocumentFragment();
  const timelineFragment = document.createDocumentFragment();

  const frozenTopSpacer = createSpacerRow(topSpacerHeight, 2);
  const timelineTopSpacer = createSpacerRow(topSpacerHeight, Math.max(1, state.weeks.length));
  if (frozenTopSpacer) frozenFragment.appendChild(frozenTopSpacer);
  if (timelineTopSpacer) timelineFragment.appendChild(timelineTopSpacer);

  state.viewRows.slice(startIndex, endIndex).forEach(({ row, extraClass }) => {
    frozenFragment.appendChild(renderFrozenMatrixRow(row, extraClass));
    timelineFragment.appendChild(renderTimelineMatrixRow(row, extraClass));
  });

  const frozenBottomSpacer = createSpacerRow(bottomSpacerHeight, 2);
  const timelineBottomSpacer = createSpacerRow(bottomSpacerHeight, Math.max(1, state.weeks.length));
  if (frozenBottomSpacer) frozenFragment.appendChild(frozenBottomSpacer);
  if (timelineBottomSpacer) timelineFragment.appendChild(timelineBottomSpacer);

  dom.frozenBody.appendChild(frozenFragment);
  dom.timelineBody.appendChild(timelineFragment);
  dom.timelineBodyScroll.scrollTop = scrollTop;
  dom.timelineBodyScroll.scrollLeft = scrollLeft;
  dom.frozenBodyScroll.scrollTop = scrollTop;
  isRenderingVisibleRows = false;
}

function scheduleVisibleRowsRender() {
  if (visibleRowsFrame != null) return;

  visibleRowsFrame = requestAnimationFrame(() => {
    visibleRowsFrame = null;
    renderVisibleRows();
  });
}

function renderMatrix(matrix) {
  state.viewRows = flattenMatrixRows(matrix);
  updateTableHeight(state.viewRows.length);
  dom.timelineBodyScroll.scrollTop = 0;
  dom.frozenBodyScroll.scrollTop = 0;
  renderVisibleRows();
}

function renderCaption(matrix) {
  const projectRowsCount = matrix.reduce(
    (count, employeeBlock) =>
      count + employeeBlock.projectRows.filter((row) => row.type === "project").length,
    0
  );
  const employeeCount = matrix.length;
  dom.tableCaption.textContent =
    `Ann\u00e9e ${state.year} - ${employeeCount} employ\u00e9s - ${projectRowsCount} lignes projet`;
}

function getVisibleTimelineRange() {
  if (!state.weeks.length) return null;
  return {
    start: state.weeks[0].range.start,
    end: state.weeks[state.weeks.length - 1].range.end,
  };
}

function segmentOverlapsRange(segment, range) {
  if (!range || segment.endTime <= segment.startTime) return false;
  return segment.startTime < range.end.getTime() && segment.endTime > range.start.getTime();
}

function projectMatchesDop(projectNumber) {
  if (!state.filters.dop) return true;
  const project = state.data.projects.get(projectNumber);
  return getFilterKey(getProjectDopLabel(project)) === state.filters.dop;
}

function getVisibleProjectNumbersForFilters() {
  if (!state.filters.dop) {
    return state.filters.visibleProjectNumbers;
  }

  return new Set(
    Array.from(state.filters.visibleProjectNumbers).filter(projectMatchesDop)
  );
}

function employeeMatchesFilters(employee) {
  const serviceKey = getFilterKey(getServiceLabel(employee));
  const roleKey = getFilterKey(getRoleLabel(employee));

  return (!state.filters.service || serviceKey === state.filters.service) &&
    (!state.filters.role || roleKey === state.filters.role);
}

function sortEmployeesForView(employees) {
  return [...employees].sort((left, right) =>
    compareText(getServiceLabel(left), getServiceLabel(right)) ||
    compareText(getRoleLabel(left), getRoleLabel(right)) ||
    compareText(left.name, right.name)
  );
}

function getFilteredEmployeesAndSegments(visibleProjectNumbers) {
  const visibleRange = getVisibleTimelineRange();
  const employees = sortEmployeesForView(
    state.data.employees.filter(employeeMatchesFilters)
  );
  const segmentsByEmployee = new Map();

  employees.forEach((employee) => {
    const sourceSegments = state.data.segmentsByEmployee.get(employee.key) || [];
    const visibleSegments = sourceSegments.filter((segment) =>
      visibleProjectNumbers.has(segment.projectNumber) &&
      segmentOverlapsRange(segment, visibleRange)
    );
    if (visibleSegments.length) {
      segmentsByEmployee.set(employee.key, visibleSegments);
    }
  });

  return { employees, segmentsByEmployee };
}

function render() {
  if (!state.data) return;

  const calendar = getWeeksForYear(state.year);
  const calendarChanged = state.renderedCalendarYear !== state.year;
  state.weekGroups = calendar.groups;
  state.weeks = calendar.weeks;

  if (calendarChanged) {
    renderColGroups();
    renderTableHeader();
    syncTimelineTableWidths();
    state.renderedCalendarYear = state.year;
  }

  const visibleProjectNumbers = getVisibleProjectNumbersForFilters();
  const filteredData = getFilteredEmployeesAndSegments(visibleProjectNumbers);

  const matrix = computeWeeklyUtilizationMatrix({
    employees: filteredData.employees,
    segmentsByEmployee: filteredData.segmentsByEmployee,
    projects: state.data.projects,
    weeks: state.weeks,
    visibleProjectNumbers,
    includeEmployeesWithoutProjects: state.filters.includeEmptyEmployees,
  });

  renderMatrix(matrix);
  renderCaption(matrix);
  syncTimelineLayout();

  dom.emptyState.hidden = matrix.length > 0;
  setStatus("", "ready");
}

function scheduleRender() {
  if (renderFrame != null) return;

  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    render();
  });
}

function shiftYear(delta) {
  state.year += delta;
  ensureYearOption(state.year);
  dom.yearSelect.value = String(state.year);
  scheduleRender();
}

function bindEvents() {
  dom.yearSelect.addEventListener("change", () => {
    state.year = Number(dom.yearSelect.value) || new Date().getFullYear();
    scheduleRender();
  });
  dom.serviceFilter.addEventListener("change", () => {
    state.filters.service = dom.serviceFilter.value;
    scheduleRender();
  });
  dom.roleFilter.addEventListener("change", () => {
    state.filters.role = dom.roleFilter.value;
    scheduleRender();
  });
  dom.dopFilter.addEventListener("change", () => {
    state.filters.dop = dom.dopFilter.value;
    scheduleRender();
  });
  dom.includeEmptyEmployees.addEventListener("change", () => {
    state.filters.includeEmptyEmployees = dom.includeEmptyEmployees.checked;
    scheduleRender();
  });
  dom.projectFilterToggle.addEventListener("click", () => {
    setProjectFilterOpen();
  });
  dom.projectSelectAll.addEventListener("click", () => {
    setAllProjectsSelected(true);
  });
  dom.projectClearAll.addEventListener("click", () => {
    setAllProjectsSelected(false);
  });
  dom.projectOptionList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.dataset.projectNumber) return;

    if (target.checked) {
      state.filters.visibleProjectNumbers.add(target.value);
    } else {
      state.filters.visibleProjectNumbers.delete(target.value);
    }
    updateProjectFilterLabel();
    scheduleRender();
  });
  dom.yearPrev.addEventListener("click", () => shiftYear(-1));
  dom.yearNext.addEventListener("click", () => shiftYear(1));
  window.addEventListener("resize", () => {
    updateTableHeight();
    syncTimelineTableWidths();
    syncTimelineLayout();
    scheduleVisibleRowsRender();
  });
  dom.timelineBodyScroll.addEventListener("scroll", () => {
    if (isRenderingVisibleRows) return;
    dom.timelineHeadScroll.scrollLeft = dom.timelineBodyScroll.scrollLeft;
    dom.frozenBodyScroll.scrollTop = dom.timelineBodyScroll.scrollTop;
    scheduleVisibleRowsRender();
  });
  dom.frozenBodyScroll.addEventListener("wheel", (event) => {
    if (!event.deltaX && !event.deltaY) return;
    event.preventDefault();
    dom.timelineBodyScroll.scrollLeft += event.deltaX;
    dom.timelineBodyScroll.scrollTop += event.deltaY;
  }, { passive: false });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!dom.projectFilter.contains(target)) {
      setProjectFilterOpen(false);
    }
  });
}

async function init() {
  try {
    window.grist?.ready?.({ requiredAccess: "full" });
    bindEvents();
    populateYearSelect(state.year - 1, state.year + 1);

    const data = await loadGestionUserData();
    state.data = data;

    const bounds = getSegmentYearBounds(data.segments);
    populateYearSelect(bounds.minYear, bounds.maxYear);
    populateFilters(data.employees, data.projects);
    populateProjectFilter(data);
    render();
  } catch (error) {
    console.error("Erreur initialisation Gestion-User :", error);
    setStatus(error?.message || "Erreur de chargement.", "error");
    dom.emptyState.hidden = false;
    dom.emptyState.textContent = error?.message || "Erreur de chargement.";
  }
}

init();
