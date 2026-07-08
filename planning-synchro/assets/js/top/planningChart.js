// Task-load line chart for the top pane — an alternative "Graphique" view that
// REPLACES the read-only planning timeline when the aggregate ("Rassembler
// visuellement le planning") mode is on. It plots, over the SAME visible
// chronology as the frise / bottom pane, the number of tasks to realize per
// month OR per week (user's choice, via the Mois/Semaine control), one line per
// document type (Coffrage / Armature / NDC / Coupes / Démolition / Autres) plus a
// Total line.
//
// Charting technology: Chart.js (globalThis.Chart, loaded from the CDN in
// index.html / dev/harness.html) — the SAME library gestion-depenses2 uses for
// its "Graphique des dépenses" (assets/js/ui/chart.js). This is a DOM module
// (touches window.Chart only inside createPlanningChart); buildTaskLoadSeries is
// pure and unit-tested.
//
// Time coordination: the x-axis is a linear timestamp axis whose min/max are the
// viewport's firstVisibleDate .. rangeEndDate, and each month's point is plotted
// at its mid-month timestamp — so the chart spans exactly the frise's visible
// window and pans/zooms with it (main.js feeds every applied viewport to
// setViewport()).

import { APP_CONFIG } from "../config.js";
import { buildDisplayedMonths, toFiniteNumber } from "../utils/format.js";
import { parseCalendarDate, toText } from "../utils/dates.js";
import { buildRowPhases, normalizePlanningDocumentType } from "./phases.js";

const KNOWN_TYPES = ["COFFRAGE", "ARMATURES", "NDC", "COUPES", "DEMOLITION"];

// Display order + colours per document-type line (solid line colours chosen to
// echo the phase palette while staying distinguishable as thin lines).
const TYPE_META = {
  COFFRAGE: { label: "Coffrage", color: "#d97706" },
  ARMATURES: { label: "Armature", color: "#475569" },
  NDC: { label: "NDC", color: "#7c3aed" },
  COUPES: { label: "Coupes", color: "#16a34a" },
  DEMOLITION: { label: "Démolition", color: "#dc2626" },
  AUTRES: { label: "Autres", color: "#8470ff" },
};
const TYPE_ORDER = ["COFFRAGE", "ARMATURES", "NDC", "COUPES", "DEMOLITION", "AUTRES"];
const TOTAL_META = { label: "Total", color: "#004990" };

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function taskTypeKey(row, columns) {
  const key = normalizePlanningDocumentType(toText(row?.[columns.typeDoc]));
  return KNOWN_TYPES.includes(key) ? key : "AUTRES";
}

// A row's "à réaliser" date = the end (diffusion) date of its main phase
// (démarrage markers excluded); that's when the document is due.
function taskDueDate(row, columns) {
  const phases = buildRowPhases(row, columns).filter((phase) => phase.type !== "demarrage");
  if (!phases.length) return null;
  const main = phases[0];
  const due = main.end instanceof Date ? main.end : main.start;
  return due instanceof Date && !Number.isNaN(due.getTime()) ? due : null;
}

// A task is "réalisé à 100%" when its Realise column reaches 100.
function isTaskRealized(row, columns) {
  return toFiniteNumber(row?.[columns.realise], 0) >= 100;
}

// Monday 00:00 of the ISO week containing `date`.
export function startOfWeekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// Month buckets spanning [first..last]. `points` carry monthKey/year/monthNumber;
// indexOf(date) -> the bucket index for a due date (null if outside).
function buildMonthBuckets(first, last, monthsNames) {
  const span =
    last.getFullYear() * 12 + last.getMonth() - (first.getFullYear() * 12 + first.getMonth()) + 1;
  const months = buildDisplayedMonths(first.getFullYear(), first.getMonth(), span, monthsNames);
  const indexByMonthKey = new Map(months.map((month, index) => [month.monthKey, index]));
  const points = months.map((month) => ({
    monthKey: month.monthKey,
    year: month.year,
    monthNumber: month.monthNumber,
    label: `${String(month.monthLabel || "").slice(0, 3)} ${month.year}`,
    midTs: new Date(month.year, month.monthNumber - 1, 15).getTime(),
  }));
  return {
    points,
    indexOf: (date) => {
      const index = indexByMonthKey.get(monthKeyOf(date));
      return index == null ? null : index;
    },
  };
}

// Weekly (Monday-based) buckets spanning [first..last]. `points` carry weekKey
// (the Monday ISO date) + midTs (Thursday, so the point sits mid-week).
function buildWeekBuckets(first, last) {
  const points = [];
  const indexByWeekStartMs = new Map();
  const end = startOfWeekMonday(last).getTime();
  let cursor = startOfWeekMonday(first);
  let index = 0;
  while (cursor.getTime() <= end) {
    const startMs = cursor.getTime();
    indexByWeekStartMs.set(startMs, index);
    points.push({
      weekKey: `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`,
      weekStartTs: startMs,
      label: `${pad2(cursor.getDate())}/${pad2(cursor.getMonth() + 1)}`,
      midTs: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 3, 12, 0, 0).getTime(),
    });
    index += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }
  return {
    points,
    indexOf: (date) => {
      const idx = indexByWeekStartMs.get(startOfWeekMonday(date).getTime());
      return idx == null ? null : idx;
    },
  };
}

// PURE: rows + columns + viewport (+ options.granularity "month"|"week") ->
// { points, byType, total, byTypeRealized, totalRealized, typesPresent }.
// `points` are the month OR week buckets spanning [firstVisibleDate ..
// rangeEndDate]; byType/total are per-bucket task counts aligned to `points`, and
// byTypeRealized/totalRealized are the SAME counts restricted to tasks already
// realized at 100% (the dotted companion lines). Tasks whose due date falls
// outside the visible buckets are not counted (the chart follows the frise).
export function buildTaskLoadSeries(rows, columns, viewport, options = {}) {
  const granularity = options.granularity === "week" ? "week" : "month";
  const monthsNames = options.monthsNames || APP_CONFIG.months;
  const first = parseCalendarDate(viewport?.firstVisibleDate);
  const last = parseCalendarDate(viewport?.rangeEndDate);
  if (!first || !last || last < first) {
    return { points: [], byType: {}, total: [], byTypeRealized: {}, totalRealized: [], typesPresent: [] };
  }

  const buckets =
    granularity === "week" ? buildWeekBuckets(first, last) : buildMonthBuckets(first, last, monthsNames);
  const points = buckets.points;

  const byType = {};
  const byTypeRealized = {};
  const total = new Array(points.length).fill(0);
  const totalRealized = new Array(points.length).fill(0);
  const typesPresent = new Set();

  (rows || []).forEach((row) => {
    const due = taskDueDate(row, columns);
    if (!due) return;
    const index = buckets.indexOf(due);
    if (index == null) return; // outside the visible range

    const typeKey = taskTypeKey(row, columns);
    if (!byType[typeKey]) byType[typeKey] = new Array(points.length).fill(0);
    if (!byTypeRealized[typeKey]) byTypeRealized[typeKey] = new Array(points.length).fill(0);
    byType[typeKey][index] += 1;
    total[index] += 1;
    typesPresent.add(typeKey);

    if (isTaskRealized(row, columns)) {
      byTypeRealized[typeKey][index] += 1;
      totalRealized[index] += 1;
    }
  });

  return {
    points,
    byType,
    total,
    byTypeRealized,
    totalRealized,
    typesPresent: TYPE_ORDER.filter((type) => typesPresent.has(type)),
  };
}

function shortMonthLabel(ts) {
  const date = new Date(ts);
  const name = APP_CONFIG.months[date.getMonth()] || "";
  return `${name.slice(0, 3)} ${String(date.getFullYear()).slice(2)}`;
}

// A type's base label groups its solid line and its dotted "(réalisé)" companion
// under one name (e.g. "Coffrage" + "Coffrage (réalisé)" -> "Coffrage"), so the
// checkbox filter toggles the whole type at once.
function baseLabel(label) {
  return String(label || "").replace(/\s*\(réalisé\)\s*$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// createPlanningChart(canvasEl, filterEl, granularityEl) ->
// { render, setViewport, setHeight, destroy }.
export function createPlanningChart(canvasEl, filterEl, granularityEl) {
  let chart = null;
  let lastRows = [];
  let lastColumns = null;
  // Bucket granularity for the task-load lines: "month" (default) or "week". The
  // user picks it via the Mois/Semaine control (granularityEl).
  let granularity = "month";
  // Last applied viewport, so a granularity change can re-render in place.
  let lastViewport = null;
  // Type filter: Set of base labels (e.g. "Coffrage", "Total") currently CHECKED.
  // A dataset is shown iff its base label is in the set. Rebuilt per project and
  // re-applied on every viewport re-render (buildDatasets reads it).
  let visibleTypes = null;

  // Axis / tooltip labels adapt to the granularity: months read "jui 26", weeks
  // read the week's Monday "dd/MM" (axis) / "Semaine du dd/MM/YYYY" (tooltip).
  function axisLabel(ts) {
    if (granularity !== "week") return shortMonthLabel(ts);
    const monday = startOfWeekMonday(new Date(ts));
    return `${pad2(monday.getDate())}/${pad2(monday.getMonth() + 1)}`;
  }
  function tooltipTitle(ts) {
    if (granularity !== "week") return shortMonthLabel(ts);
    const monday = startOfWeekMonday(new Date(ts));
    return `Semaine du ${pad2(monday.getDate())}/${pad2(monday.getMonth() + 1)}/${monday.getFullYear()}`;
  }

  // Which document types actually occur in the project (all rows, not just the
  // visible window) — the checkbox filter only lists these + Total.
  function computeAvailableLabels() {
    const present = new Set();
    (lastRows || []).forEach((row) => {
      if (!taskDueDate(row, lastColumns)) return;
      present.add(taskTypeKey(row, lastColumns));
    });
    const items = TYPE_ORDER.filter((type) => present.has(type)).map((type) => ({
      label: TYPE_META[type].label,
      color: TYPE_META[type].color,
    }));
    items.push({ label: TOTAL_META.label, color: TOTAL_META.color });
    return items;
  }

  function applyVisibility() {
    if (!chart || !visibleTypes) return;
    chart.data.datasets.forEach((ds) => {
      ds.hidden = !visibleTypes.has(baseLabel(ds.label));
    });
    chart.update();
  }

  function handleFilterChange() {
    if (!(filterEl instanceof HTMLElement)) return;
    const checked = [...filterEl.querySelectorAll('input[type="checkbox"]')]
      .filter((input) => input.checked)
      .map((input) => input.dataset.typeLabel);
    visibleTypes = new Set(checked);
    applyVisibility();
  }

  // (Re)build the checkbox filter for the current project; everything checked.
  function buildFilter() {
    if (!(filterEl instanceof HTMLElement)) return;
    const items = computeAvailableLabels();
    visibleTypes = new Set(items.map((item) => item.label));
    filterEl.innerHTML = items
      .map(
        (item) => `
        <label class="ps-chart-filter-item">
          <input type="checkbox" data-type-label="${escapeHtml(item.label)}" checked>
          <span class="ps-chart-filter-swatch" style="background:${escapeHtml(item.color)}"></span>
          <span>${escapeHtml(item.label)}</span>
        </label>`
      )
      .join("");
  }

  // Each series is drawn as TWO lines of the same colour: a solid line (all tasks
  // to realize) and a dotted companion line (the subset already réalisé à 100%).
  function solidLine(label, color, points, values, width) {
    return {
      label,
      data: points.map((point, index) => ({ x: point.midTs, y: values[index] })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: width,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      fill: false,
      spanGaps: true,
    };
  }

  function dottedLine(label, color, points, values, width) {
    return {
      label,
      data: points.map((point, index) => ({ x: point.midTs, y: values[index] })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: width,
      borderDash: [3, 3],
      pointRadius: 2,
      pointStyle: "circle",
      pointHoverRadius: 4,
      tension: 0.25,
      fill: false,
      spanGaps: true,
    };
  }

  function buildDatasets(series) {
    const datasets = [];
    series.typesPresent.forEach((type) => {
      const meta = TYPE_META[type];
      datasets.push(solidLine(meta.label, meta.color, series.points, series.byType[type], 2));
      datasets.push(
        dottedLine(`${meta.label} (réalisé)`, meta.color, series.points, series.byTypeRealized[type] || [], 2)
      );
    });
    datasets.push(solidLine(TOTAL_META.label, TOTAL_META.color, series.points, series.total, 3));
    datasets.push(
      dottedLine(`${TOTAL_META.label} (réalisé)`, TOTAL_META.color, series.points, series.totalRealized, 3)
    );
    // Re-apply the active type filter so it survives viewport re-renders.
    datasets.forEach((ds) => {
      ds.hidden = visibleTypes != null && !visibleTypes.has(baseLabel(ds.label));
    });
    return datasets;
  }

  function ensureChart() {
    if (chart) return true;
    const ChartCtor = globalThis.Chart;
    if (!canvasEl || typeof ChartCtor !== "function") return false;

    chart = new ChartCtor(canvasEl, {
      type: "line",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear",
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              callback: (value) => axisLabel(value),
            },
            grid: { color: "rgba(0, 73, 144, 0.06)" },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, stepSize: 1 },
            title: { display: true, text: "Tâches à réaliser" },
            grid: { color: "rgba(0, 73, 144, 0.08)" },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, pointStyle: "line", boxWidth: 26, padding: 12, font: { size: 11 } },
            // Type visibility is driven by the checkbox filter (buildFilter), so
            // the legend is display-only here (no click toggle to fight it).
            onClick: () => {},
          },
          tooltip: {
            callbacks: {
              title: (items) => (items.length ? tooltipTitle(items[0].parsed.x) : ""),
              label: (context) => `${context.dataset.label}: ${context.parsed.y}`,
            },
          },
        },
      },
    });
    return true;
  }

  function applyViewport(viewport) {
    if (!chart) return;
    if (viewport) lastViewport = viewport;
    const vp = lastViewport;
    const series = buildTaskLoadSeries(lastRows, lastColumns, vp, { granularity });
    const first = parseCalendarDate(vp?.firstVisibleDate);
    const last = parseCalendarDate(vp?.rangeEndDate);
    if (first) chart.options.scales.x.min = first.getTime();
    if (last) chart.options.scales.x.max = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59).getTime();
    chart.data.datasets = buildDatasets(series);
    chart.update("none");
  }

  // Mois / Semaine control (granularityEl). Built once (static); a click switches
  // the bucketing and re-renders the chart in place for the current viewport.
  function buildGranularityControl() {
    if (!(granularityEl instanceof HTMLElement)) return;
    const options = [
      { value: "month", label: "Mois" },
      { value: "week", label: "Semaine" },
    ];
    granularityEl.innerHTML = `
      <span class="ps-chart-gran-label">Regrouper par :</span>
      ${options
        .map(
          (option) => `
        <button
          type="button"
          class="ps-chart-gran-btn${option.value === granularity ? " is-active" : ""}"
          data-granularity="${option.value}"
          aria-pressed="${option.value === granularity ? "true" : "false"}"
        >${option.label}</button>`
        )
        .join("")}
    `;
  }

  function updateGranularityActive() {
    if (!(granularityEl instanceof HTMLElement)) return;
    granularityEl.querySelectorAll("[data-granularity]").forEach((button) => {
      const active = button.dataset.granularity === granularity;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function handleGranularityClick(event) {
    const button = event.target instanceof Element ? event.target.closest("[data-granularity]") : null;
    if (!button) return;
    const next = button.dataset.granularity === "week" ? "week" : "month";
    if (next === granularity) return;
    granularity = next;
    updateGranularityActive();
    applyViewport(lastViewport);
  }

  function render({ rows, columns, viewport } = {}) {
    lastRows = rows || [];
    lastColumns = columns || null;
    buildFilter(); // rebuild checkboxes for this project (all checked)
    if (!ensureChart()) return;
    applyViewport(viewport);
  }

  function setViewport(viewport) {
    applyViewport(viewport);
  }

  // Match the top pane's current height (driven by the splitter/resizer) so the
  // chart occupies the same vertical space as the timeline it replaces.
  function setHeight(px) {
    const host = canvasEl?.parentElement;
    if (host instanceof HTMLElement && Number.isFinite(px) && px > 0) {
      host.style.height = `${Math.round(px)}px`;
      if (chart && typeof chart.resize === "function") chart.resize();
    }
  }

  function destroy() {
    if (chart && typeof chart.destroy === "function") chart.destroy();
    chart = null;
    lastRows = [];
    lastColumns = null;
    lastViewport = null;
    visibleTypes = null;
    if (filterEl instanceof HTMLElement) {
      filterEl.removeEventListener("change", handleFilterChange);
      filterEl.innerHTML = "";
    }
    if (granularityEl instanceof HTMLElement) {
      granularityEl.removeEventListener("click", handleGranularityClick);
      granularityEl.innerHTML = "";
    }
  }

  if (filterEl instanceof HTMLElement) {
    filterEl.addEventListener("change", handleFilterChange);
  }
  if (granularityEl instanceof HTMLElement) {
    granularityEl.addEventListener("click", handleGranularityClick);
    buildGranularityControl();
  }

  return { render, setViewport, setHeight, destroy };
}
