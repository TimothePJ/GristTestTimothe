// Graphique de charge des tâches du pane haut : la vue « Graphique », qui
// REMPLACE la frise du planning (lecture seule) quand on la choisit dans le
// sélecteur Planning / Graphique. Il est disponible à tout moment et ne dépend
// pas du mode « Rassembler visuellement le planning » : ses tâches viennent des
// lignes du planning, pas du regroupement de la frise. Il trace, sur la MÊME
// chronologie visible que la frise et le pane bas, le nombre de tâches à
// réaliser par mois OU par semaine (contrôle Mois / Semaine), une courbe par type
// de document (Coffrage / Armature / NDC / Coupes / Démolition / Autres) et une
// courbe Total ; en pointillé, les tâches déjà réalisées.
//
// Lissage des tâches (spec 2026-10-23, §6.3) : tâches et mode arrivent du
// contrôleur du lissage (top/smoothingController.js) par setChartInput. Trois
// modes : « Non lissé » (échéances d'origine), « Lissé » (dates lissées,
// smoothedIso) et « Les deux » (courbe lissée pleine, courbe d'avant lissage
// pâle et fine). Sans lissage défini (active:false), le mode retombe sur « Non
// lissé ». Un clic sans glisser sur un mois ou une semaine appelle
// onBucketClick (fenêtre « Tâches du mois »).
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
import { buildDisplayedMonths } from "../utils/format.js";
import { parseCalendarDate } from "../utils/dates.js";
import { TOTAL_META, TYPE_META, TYPE_ORDER, formatMonthLabel } from "./taskLabels.js";

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
//
// CALIBRATION: midTs is the bucket's TRUE midpoint — (month start + next month
// start) / 2 — not the 15th at midnight. On the shared frise the x axis is a
// plain linear timestamp scale, so the 15th at 00:00 sits up to 1.5 days left of
// a 31-day month's visual centre; startTs is the month's left boundary, used to
// place the chart's vertical gridlines exactly where the planning below splits
// its months.
function buildMonthBuckets(first, last, monthsNames) {
  const span =
    last.getFullYear() * 12 + last.getMonth() - (first.getFullYear() * 12 + first.getMonth()) + 1;
  const months = buildDisplayedMonths(first.getFullYear(), first.getMonth(), span, monthsNames);
  const indexByMonthKey = new Map(months.map((month, index) => [month.monthKey, index]));
  const points = months.map((month) => {
    const startTs = new Date(month.year, month.monthNumber - 1, 1).getTime();
    const endTs = new Date(month.year, month.monthNumber, 1).getTime();
    return {
      monthKey: month.monthKey,
      year: month.year,
      monthNumber: month.monthNumber,
      label: `${String(month.monthLabel || "").slice(0, 3)} ${month.year}`,
      startTs,
      endTs,
      midTs: startTs + (endTs - startTs) / 2,
    };
  });
  return {
    points,
    indexOf: (date) => {
      const index = indexByMonthKey.get(monthKeyOf(date));
      return index == null ? null : index;
    },
  };
}

// Weekly (Monday-based) buckets spanning [first..last]. `points` carry weekKey
// (the Monday ISO date) + midTs.
//
// CALIBRATION: a week bucket runs Monday 00:00 -> next Monday 00:00, so its
// midpoint is Thursday 12:00 — which is what the previous literal
// `date + 3, 12:00` already produced on a normal week. Deriving it from the two
// boundaries instead keeps it exact across a DST transition (a 167h or 169h
// week, where the timestamp midpoint shifts by an hour), and gives every point
// a `startTs` sibling for the boundary gridlines.
function buildWeekBuckets(first, last) {
  const points = [];
  const indexByWeekStartMs = new Map();
  const end = startOfWeekMonday(last).getTime();
  let cursor = startOfWeekMonday(first);
  let index = 0;
  while (cursor.getTime() <= end) {
    const startMs = cursor.getTime();
    const nextMondayMs = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 7
    ).getTime();
    indexByWeekStartMs.set(startMs, index);
    points.push({
      weekKey: `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`,
      weekStartTs: startMs,
      startTs: startMs,
      endTs: nextMondayMs,
      label: `${pad2(cursor.getDate())}/${pad2(cursor.getMonth() + 1)}`,
      midTs: startMs + (nextMondayMs - startMs) / 2,
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

// Jour calendaire "AAAA-MM-JJ" d'un timestamp (horloge locale).
function isoOfTs(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// PURE: tasks (ChartTask / SmoothedTask) + viewport (+ options.granularity
// "month"|"week", options.dateKey "dueIso"|"smoothedIso") ->
// { points, byType, total, byTypeRealized, totalRealized, typesPresent }.
// `points` are the month OR week buckets spanning [firstVisibleDate ..
// rangeEndDate], each with startTs (inclusive) and endTs (exclusive, start of the
// next bucket); byType/total are per-bucket task counts aligned to `points`, and
// byTypeRealized/totalRealized are the SAME counts restricted to tasks already
// realized (the dotted companion lines). A task is dated by task[dateKey]
// (smoothedIso when the smoothed view is asked, falling back to dueIso if absent).
// Tasks whose date falls outside the visible buckets are not counted (the chart
// follows the frise).
export function buildTaskLoadSeries(tasks, viewport, options = {}) {
  const granularity = options.granularity === "week" ? "week" : "month";
  const dateKey = options.dateKey === "smoothedIso" ? "smoothedIso" : "dueIso";
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

  (tasks || []).forEach((task) => {
    const due = parseCalendarDate(task?.[dateKey] || task?.dueIso);
    if (!due) return;
    const index = buckets.indexOf(due);
    if (index == null) return; // outside the visible range

    const typeKey = TYPE_META[task.type] ? task.type : "AUTRES";
    if (!byType[typeKey]) byType[typeKey] = new Array(points.length).fill(0);
    if (!byTypeRealized[typeKey]) byTypeRealized[typeKey] = new Array(points.length).fill(0);
    byType[typeKey][index] += 1;
    total[index] += 1;
    typesPresent.add(typeKey);

    if (task.realized) {
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

// PURE: points + timestamp -> index du seau [startTs, endTs) qui le contient, ou
// null (hors fenetre). Sert au clic sur le graphique.
export function findBucketIndexAt(points, ts) {
  if (!Array.isArray(points) || !Number.isFinite(ts)) return null;
  const index = points.findIndex((point) => ts >= point.startTs && ts < point.endTs);
  return index < 0 ? null : index;
}

// PURE: series brute + lissee + mode -> specifications des courbes, avant tout
// style Chart.js. Pour chaque type present puis pour Total :
//   - "before"   (mode both seulement) : la courbe NON lissee, tracee en pale ;
//   - "main"     : la courbe principale (non lissee en raw, lissee sinon) ;
//   - "realized" : le pointille des taches realisees, UNE SEULE fois par serie
//     (une tache realisee ne bouge jamais : meme courbe lissee ou non).
export function buildDatasetSpecs({ rawSeries, smoothedSeries, mode } = {}) {
  const useSmoothed = (mode === "smoothed" || mode === "both") && smoothedSeries;
  const main = useSmoothed ? smoothedSeries : rawSeries;
  const showBefore = mode === "both" && Boolean(smoothedSeries) && Boolean(rawSeries);
  if (!main) return [];
  const length = main.points.length;
  const zeros = () => new Array(length).fill(0);

  // Types presents dans l'une ou l'autre serie, dans l'ordre du graphique.
  const present = new Set([...(main.typesPresent || []), ...(showBefore ? rawSeries.typesPresent || [] : [])]);
  const groups = TYPE_ORDER.filter((type) => present.has(type)).map((type) => ({
    meta: TYPE_META[type],
    values: main.byType[type] || zeros(),
    before: showBefore ? rawSeries.byType[type] || zeros() : null,
    realized: main.byTypeRealized[type] || zeros(),
  }));
  groups.push({
    meta: TOTAL_META,
    values: main.total,
    before: showBefore ? rawSeries.total : null,
    realized: main.totalRealized,
  });

  const specs = [];
  groups.forEach(({ meta, values, before, realized }) => {
    const base = { baseLabel: meta.label, color: meta.color };
    if (before) {
      specs.push({ ...base, label: `${meta.label} (avant lissage)`, kind: "before", values: before });
    }
    specs.push({ ...base, label: meta.label, kind: "main", values });
    specs.push({ ...base, label: `${meta.label} (réalisé)`, kind: "realized", values: realized });
  });
  return specs;
}

// PURE: viewport -> { minTs, maxTs }, the x-axis window in timestamps (null for
// an invalid viewport).
//
// CALIBRATION: the frise below covers `visibleDays` WHOLE days — day 0 starts at
// firstVisibleDate 00:00 and the last day ends at rangeEndDate 24:00, i.e. the
// start of the NEXT day (see sync/viewportMath.getDayBoundaryLeftPx, where a
// day's width is contentWidthPx / visibleDays). Ending the axis at rangeEndDate
// 23:59:59 (the previous behaviour) dropped the last day's width, stretching
// every earlier date slightly right of its position in the planning below.
export function getChartWindowBounds(viewport) {
  const first = parseCalendarDate(viewport?.firstVisibleDate);
  const last = parseCalendarDate(viewport?.rangeEndDate);
  if (!first || !last || last < first) return null;
  // Fraction de jour du glisser au pixel pres (sync/controller.js) : le graphique
  // se decale avec la frise, au lieu de suivre par jours entiers.
  const offsetDays = Number(viewport?.offsetDays);
  const offsetMs = offsetDays > 0 && offsetDays < 1 ? offsetDays * 24 * 3600 * 1000 : 0;
  return {
    minTs: new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime() + offsetMs,
    maxTs: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime() + offsetMs,
  };
}

function shortMonthLabel(ts) {
  const date = new Date(ts);
  const name = APP_CONFIG.months[date.getMonth()] || "";
  return `${name.slice(0, 3)} ${String(date.getFullYear()).slice(2)}`;
}

// A type's base label groups its solid line, its pale "(avant lissage)" line and
// its dotted "(réalisé)" companion under one name (e.g. "Coffrage" + "Coffrage
// (réalisé)" -> "Coffrage"), so the checkbox filter toggles the whole type at once.
function baseLabel(label) {
  return String(label || "").replace(/\s*\((?:réalisé|avant lissage)\)\s*$/, "");
}

// "#d97706" + 0.35 -> "rgba(217, 119, 6, 0.35)" (courbe « avant lissage », pâle).
function withAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!match) return hex;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Note de la légende de gauche : rappelle la convention du mode affiché.
function legendNoteFor(mode) {
  if (mode === "both") return "plein = lissé · pâle = avant lissage · pointillé = réalisé";
  if (mode === "smoothed") return "lissé · pointillé = réalisé";
  return "pointillé = réalisé";
}

// Le pointeur a parcouru plus de ce nombre de pixels entre pointerdown et
// pointerup : c'est un glisser (le graphique se déplace avec la frise), pas un clic.
const CLICK_DRAG_THRESHOLD_PX = 4;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Fallback when the --ps-chart-axis-width token can't be read (Node, or a
// stylesheet that failed to load). Must stay in sync with variables.css.
const DEFAULT_AXIS_WIDTH_PX = 44;

// createPlanningChart(canvasEl, filterEl, granularityEl, legendEl, options) ->
// { render, setChartInput, setViewport, setHeight, getUiState, destroy }.
//   - chartInput = { tasks, mode: "raw"|"smoothed"|"both", active } : active:false
//     force le mode "raw" (aucun lissage défini) ;
//   - options.initialUiState = { visibleLabels, granularity } : filtre et
//     regroupement à restaurer (mémorisés par main.js) ;
//   - options.onBucketClick({ startIso, endIso, label, granularity, visibleTypeKeys })
//     est appelé au clic (sans glisser) sur un seau du graphique ;
//   - getUiState() -> { visibleLabels, knownLabels, granularity } : à repasser tel
//     quel en initialUiState pour qu'un type nouveau arrive coché.
export function createPlanningChart(
  canvasEl,
  filterEl,
  granularityEl,
  legendEl,
  { initialUiState = null, onBucketClick = null } = {}
) {
  let chart = null;
  let lastTasks = [];
  // Mode de tracé demandé ("raw" | "smoothed" | "both"), déjà ramené à "raw" quand
  // le lissage n'est pas actif.
  let lastMode = "raw";
  // Seaux du dernier tracé (clic -> seau).
  let lastPoints = [];
  // Bucket granularity for the task-load lines: "month" (default) or "week". The
  // user picks it via the Mois/Semaine control (granularityEl).
  let granularity = initialUiState?.granularity === "week" ? "week" : "month";
  // Geste en cours sur le canevas : { pointerId, x, y, dragged }, ou null.
  let gesture = null;
  // Libellés de cases connus au dernier rendu : un libellé absent de cette liste
  // arrive coché. Restauré depuis initialUiState (le graphique est recréé à chaque
  // rechargement), sinon null tant qu'aucun rendu n'a eu lieu.
  let knownLabels = Array.isArray(initialUiState?.knownLabels)
    ? new Set(initialUiState.knownLabels.map(String))
    : null;
  // Last applied viewport, so a granularity change can re-render in place.
  let lastViewport = null;
  // Bucket start timestamps of the last rendered series, read back by the x
  // scale's afterBuildTicks to place gridlines on bucket boundaries.
  let lastBoundaryTicks = [];
  // Type filter: Set of base labels (e.g. "Coffrage", "Total") currently CHECKED.
  // A dataset is shown iff its base label is in the set. Rebuilt per project and
  // re-applied on every viewport re-render (buildDatasets reads it).
  let visibleTypes = Array.isArray(initialUiState?.visibleLabels)
    ? new Set(initialUiState.visibleLabels.map(String))
    : null;

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
    (lastTasks || []).forEach((task) => {
      if (!parseCalendarDate(task?.dueIso)) return;
      present.add(TYPE_META[task.type] ? task.type : "AUTRES");
    });
    const items = TYPE_ORDER.filter((type) => present.has(type)).map((type) => ({
      label: TYPE_META[type].label,
      color: TYPE_META[type].color,
    }));
    items.push({ label: TOTAL_META.label, color: TOTAL_META.color });
    return items;
  }

  function applyVisibility() {
    if (!visibleTypes) return;
    syncLegend();
    if (!chart) return;
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

  // --- left legend column ----------------------------------------------------
  // Chart.js's own legend is disabled (it sat at the bottom and, more to the
  // point, its height ate into the plot area). This HTML legend lives in the
  // chart's left column, whose width plus the pinned Y-axis band equals
  // --ps-left-col-width — the same left column as the planning below. It is
  // display-only: the header checkbox filter still drives visibility, and
  // syncLegend() greys out the types it turned off.

  function buildLegend() {
    if (!(legendEl instanceof HTMLElement)) return;
    const items = computeAvailableLabels();
    legendEl.innerHTML = `
      <div class="ps-chart-legend-title">Tâches à réaliser</div>
      ${items
        .map(
          (item) => `
        <div class="ps-chart-legend-item" data-type-label="${escapeHtml(item.label)}">
          <span class="ps-chart-legend-swatch" style="background:${escapeHtml(item.color)}"></span>
          <span>${escapeHtml(item.label)}</span>
        </div>`
        )
        .join("")}
      <div class="ps-chart-legend-note">
        <span class="ps-chart-legend-swatch ps-chart-legend-swatch--dashed"></span>
        <span>${escapeHtml(legendNoteFor(lastMode))}</span>
      </div>
    `;
    syncLegend();
  }

  function syncLegend() {
    if (!(legendEl instanceof HTMLElement) || !visibleTypes) return;
    legendEl.querySelectorAll("[data-type-label]").forEach((item) => {
      item.classList.toggle("is-off", !visibleTypes.has(item.dataset.typeLabel));
    });
  }

  // The Y axis is pinned to exactly --ps-chart-axis-width so that
  // legend column + axis == --ps-left-col-width, putting the plot's left edge on
  // the same x as both timelines' content areas.
  function readAxisWidthPx() {
    if (typeof window === "undefined" || !(canvasEl instanceof HTMLElement)) {
      return DEFAULT_AXIS_WIDTH_PX;
    }
    const scope = canvasEl.closest(".ps-chart") || canvasEl.ownerDocument?.documentElement;
    if (!scope) return DEFAULT_AXIS_WIDTH_PX;
    const raw = window.getComputedStyle(scope).getPropertyValue("--ps-chart-axis-width");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_AXIS_WIDTH_PX;
  }

  // (Re)build the checkbox filter for the current tasks. The user's choice is
  // kept (visibleTypes): a label already known stays as it was, a NEW type
  // arrives checked. Without any previous choice everything is checked.
  function buildFilter() {
    const items = computeAvailableLabels();
    const previous = visibleTypes;
    const known = knownLabels;
    visibleTypes = new Set(
      items
        .filter((item) => !previous || previous.has(item.label) || (known != null && !known.has(item.label)))
        .map((item) => item.label)
    );
    knownLabels = new Set(items.map((item) => item.label));
    if (!(filterEl instanceof HTMLElement)) return;
    filterEl.innerHTML = items
      .map(
        (item) => `
        <label class="ps-chart-filter-item">
          <input type="checkbox" data-type-label="${escapeHtml(item.label)}"${visibleTypes.has(item.label) ? " checked" : ""}>
          <span class="ps-chart-filter-swatch" style="background:${escapeHtml(item.color)}"></span>
          <span>${escapeHtml(item.label)}</span>
        </label>`
      )
      .join("");
  }

  // Style des trois sortes de courbes (voir buildDatasetSpecs) : "main" = trait
  // plein (Total plus épais) ; "before" = même couleur à 35 % d'opacité, fine, sans
  // pointillé ; "realized" = pointillé [3, 3].
  function styleSpec(spec, points) {
    const isTotal = spec.baseLabel === TOTAL_META.label;
    const data = points.map((point, index) => ({ x: point.midTs, y: spec.values[index] }));
    const common = { label: spec.label, data, tension: 0.25, fill: false, spanGaps: true };
    if (spec.kind === "before") {
      const pale = withAlpha(spec.color, 0.35);
      return {
        ...common,
        borderColor: pale,
        backgroundColor: pale,
        borderWidth: 1.5,
        pointRadius: 2,
        pointHoverRadius: 4,
      };
    }
    if (spec.kind === "realized") {
      return {
        ...common,
        borderColor: spec.color,
        backgroundColor: spec.color,
        borderWidth: isTotal ? 3 : 2,
        borderDash: [3, 3],
        pointRadius: 2,
        pointStyle: "circle",
        pointHoverRadius: 4,
      };
    }
    return {
      ...common,
      borderColor: spec.color,
      backgroundColor: spec.color,
      borderWidth: isTotal ? 3 : 2,
      pointRadius: 3,
      pointHoverRadius: 5,
    };
  }

  function buildDatasets(rawSeries, smoothedSeries) {
    const specs = buildDatasetSpecs({ rawSeries, smoothedSeries, mode: lastMode });
    const datasets = specs.map((spec) => styleSpec(spec, rawSeries.points));
    // Re-apply the active type filter so it survives viewport re-renders.
    datasets.forEach((ds) => {
      ds.hidden = visibleTypes != null && !visibleTypes.has(baseLabel(ds.label));
    });
    return datasets;
  }

  // Types (clés TYPE_ORDER) des cases cochées ; « Total » n'en désigne aucun.
  function visibleTypeKeys() {
    if (!visibleTypes) return [];
    return TYPE_ORDER.filter((type) => visibleTypes.has(TYPE_META[type].label));
  }

  // Libellé et bornes (AAAA-MM-JJ, fin exclue) d'un seau.
  function describeBucket(point) {
    const start = new Date(point.startTs);
    const label =
      granularity === "week"
        ? `semaine du ${pad2(start.getDate())}/${pad2(start.getMonth() + 1)}/${start.getFullYear()}`
        : formatMonthLabel(point.monthKey);
    return {
      startIso: isoOfTs(point.startTs),
      endIso: isoOfTs(point.endTs),
      label,
      granularity,
      visibleTypeKeys: visibleTypeKeys(),
    };
  }

  // Le clic est reconnu ICI, pas par le « click » de Chart.js : dans le widget, le
  // panoramique de la frise (bindPan sur #ps-chart) écoute en capture, appelle
  // stopPropagation et capture le pointeur, si bien que ni le canevas ni son
  // « click » ne reçoivent rien. On écoute donc le document, premier nœud du
  // chemin, avant tout stopPropagation d'un ancêtre.
  //   pointerdown (bouton gauche, sur le canevas) : début de geste ;
  //   pointermove : dès que le trajet dépasse 4 px, c'est un glisser ;
  //   pointerup : sans glisser, le seau sous le pointeur est ouvert.
  function handleDocPointerDown(event) {
    const onCanvas = event.button === 0 && canvasEl.contains(event.target);
    gesture = onCanvas
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragged: false }
      : null;
  }

  function handleDocPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId || gesture.dragged) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > CLICK_DRAG_THRESHOLD_PX) {
      gesture.dragged = true;
    }
  }

  function handleDocPointerCancel() {
    gesture = null;
  }

  function handleDocPointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = null;
    // Trajet > 4 px (mesuré au fil des pointermove) ou relâché loin de l'appui.
    if (current.dragged) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > CLICK_DRAG_THRESHOLD_PX) return;
    if (typeof onBucketClick !== "function" || !chart?.scales?.x) return;
    // Aucune case cochée : le graphique est vide, rien à lister.
    if (visibleTypes && visibleTypes.size === 0) return;
    const rect = canvasEl.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const area = chart.chartArea;
    if (area && (px < area.left || px > area.right || py < area.top || py > area.bottom)) return;
    const index = findBucketIndexAt(lastPoints, chart.scales.x.getValueForPixel(px));
    if (index == null) return;
    onBucketClick(describeBucket(lastPoints[index]));
  }

  const DOC_POINTER_HANDLERS = [
    ["pointerdown", handleDocPointerDown],
    ["pointermove", handleDocPointerMove],
    ["pointerup", handleDocPointerUp],
    ["pointercancel", handleDocPointerCancel],
  ];
  const ownerDoc = canvasEl instanceof HTMLElement ? canvasEl.ownerDocument : null;

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
        // No horizontal padding: the plot must span the canvas edge to edge, so
        // that its right edge lands on the frise's right edge. The left edge is
        // set solely by the pinned Y-axis width (see scales.y.afterFit).
        // autoPadding:false is required — left on (the default), Chart.js adds
        // its own inset so the outermost tick labels can't be clipped, which
        // measured 8px on the right here and pulled the plot off the frise.
        layout: { autoPadding: false, padding: { left: 0, right: 0, top: 8, bottom: 0 } },
        scales: {
          x: {
            type: "linear",
            // Zero the label-overflow padding Chart.js would otherwise reserve
            // on both sides: that padding widens chartArea's insets and would
            // shift the plot off the shared frise. Edge labels may be clipped by
            // a few pixels — the alignment matters more.
            afterFit: (scale) => {
              scale.paddingLeft = 0;
              scale.paddingRight = 0;
            },
            // One tick per bucket BOUNDARY (1st of the month / Monday) rather
            // than at Chart.js's own round numbers, so the vertical gridlines
            // fall exactly on the month separations of the planning below.
            afterBuildTicks: (scale) => {
              const boundaries = lastBoundaryTicks.filter(
                (ts) => ts >= scale.min && ts <= scale.max
              );
              if (boundaries.length) scale.ticks = boundaries.map((value) => ({ value }));
            },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              // Labels name the bucket that STARTS at the tick, so they read to
              // the right of their gridline like vis-timeline's month band.
              align: "start",
              callback: (value) => axisLabel(value),
            },
            grid: { color: "rgba(0, 73, 144, 0.06)" },
          },
          y: {
            beginAtZero: true,
            // Pin the axis band so chartArea.left is deterministic (see
            // readAxisWidthPx): legend column + this width == --ps-left-col-width.
            afterFit: (scale) => {
              scale.width = readAxisWidthPx();
            },
            ticks: { precision: 0, stepSize: 1 },
            // The title moved to the legend column's heading (HTML): inside the
            // canvas it consumed part of the axis band and pushed the plot right.
            title: { display: false },
            grid: { color: "rgba(0, 73, 144, 0.08)" },
          },
        },
        plugins: {
          // Replaced by the HTML legend in the left column (buildLegend): the
          // built-in bottom legend stole vertical space from the plot.
          legend: { display: false },
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
    const rawSeries = buildTaskLoadSeries(lastTasks, vp, { granularity, dateKey: "dueIso" });
    const smoothedSeries =
      lastMode === "raw"
        ? null
        : buildTaskLoadSeries(lastTasks, vp, { granularity, dateKey: "smoothedIso" });
    const bounds = getChartWindowBounds(vp);
    if (bounds) {
      chart.options.scales.x.min = bounds.minTs;
      chart.options.scales.x.max = bounds.maxTs;
    }
    lastPoints = rawSeries.points;
    lastBoundaryTicks = rawSeries.points.map((point) => point.startTs).filter(Number.isFinite);
    chart.data.datasets = buildDatasets(rawSeries, smoothedSeries);
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

  function render({ chartInput, viewport } = {}) {
    lastTasks = chartInput?.tasks || [];
    const requested = chartInput?.mode;
    lastMode = chartInput?.active && (requested === "smoothed" || requested === "both") ? requested : "raw";
    buildFilter(); // rebuild checkboxes for these tasks (user's choice kept)
    buildLegend(); // the left column mirrors those same types, in the same order
    if (!ensureChart()) return;
    applyViewport(viewport);
  }

  // Nouvelles tâches ou nouveau mode, même fenêtre.
  function setChartInput(chartInput) {
    render({ chartInput, viewport: lastViewport });
  }

  function setViewport(viewport) {
    applyViewport(viewport);
  }

  // État d'interface à mémoriser : cases cochées (null = tout) et regroupement.
  function getUiState() {
    return {
      visibleLabels: visibleTypes ? [...visibleTypes] : null,
      knownLabels: knownLabels ? [...knownLabels] : null,
      granularity,
    };
  }

  // Match the top pane's current height (driven by the splitter/resizer) so the
  // chart occupies the same vertical space as the timeline it replaces.
  function setHeight(px) {
    // The canvas' direct parent is now .ps-chart-canvas-wrap, so size the
    // .ps-chart flex container itself (as before the legend column existed) and
    // let the wrap + legend stretch into it — otherwise the pane would end up
    // taller than the timeline it replaces by .ps-chart's vertical padding.
    const host = canvasEl?.closest?.(".ps-chart") || canvasEl?.parentElement;
    if (host instanceof HTMLElement && Number.isFinite(px) && px > 0) {
      host.style.height = `${Math.round(px)}px`;
      if (chart && typeof chart.resize === "function") chart.resize();
    }
  }

  function destroy() {
    if (chart && typeof chart.destroy === "function") chart.destroy();
    chart = null;
    lastTasks = [];
    lastMode = "raw";
    lastPoints = [];
    lastViewport = null;
    lastBoundaryTicks = [];
    visibleTypes = null;
    knownLabels = null;
    gesture = null;
    if (ownerDoc) {
      DOC_POINTER_HANDLERS.forEach(([type, fn]) => ownerDoc.removeEventListener(type, fn, true));
    }
    if (legendEl instanceof HTMLElement) {
      legendEl.innerHTML = "";
    }
    if (filterEl instanceof HTMLElement) {
      filterEl.removeEventListener("change", handleFilterChange);
      filterEl.innerHTML = "";
    }
    if (granularityEl instanceof HTMLElement) {
      granularityEl.removeEventListener("click", handleGranularityClick);
      granularityEl.innerHTML = "";
    }
  }

  if (ownerDoc) {
    DOC_POINTER_HANDLERS.forEach(([type, fn]) => ownerDoc.addEventListener(type, fn, true));
  }
  if (filterEl instanceof HTMLElement) {
    filterEl.addEventListener("change", handleFilterChange);
  }
  if (granularityEl instanceof HTMLElement) {
    granularityEl.addEventListener("click", handleGranularityClick);
    buildGranularityControl();
  }

  return { render, setChartInput, setViewport, setHeight, getUiState, destroy };
}
