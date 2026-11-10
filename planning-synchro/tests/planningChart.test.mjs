import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDatasetSpecs,
  buildTaskLoadSeries,
  createPlanningChart,
  findBucketIndexAt,
  getChartWindowBounds,
} from "../assets/js/top/planningChart.js";

// Window covering all of 2027 (month buckets Jan..Dec 2027).
const viewport = { firstVisibleDate: "2027-01-01", rangeEndDate: "2027-12-31" };

// Les memes echeances qu'avant, maintenant sous forme de ChartTask construits a la main.
function task(rowId, type, dueIso, realized, extra = {}) {
  return {
    rowId,
    id2: String(rowId),
    name: "T" + rowId,
    zone: "",
    groupe: "",
    groupKey: "",
    type,
    dueIso,
    realized,
    ...extra,
  };
}

const tasks = [
  // Coffrage due in Feb 2027 — REALISED.
  task(1, "COFFRAGE", "2027-02-20", true),
  // Another coffrage due in Feb 2027 — not realised.
  task(2, "COFFRAGE", "2027-02-25", false),
  // Armature due in Mar 2027 — REALISED.
  task(3, "ARMATURES", "2027-03-20", true),
  // NDC due in Feb 2027.
  task(4, "NDC", "2027-02-28", false),
  // Custom type -> "AUTRES", due May 2027 — REALISED.
  task(5, "AUTRES", "2027-05-15", true),
  // Outside the window (2029) -> not counted.
  task(6, "COFFRAGE", "2029-01-20", true),
];

// Versions lissees : la tache 2 est avancee de fevrier a janvier.
const smoothedTasks = tasks.map((t) => ({
  ...t,
  smoothedIso: t.rowId === 2 ? "2027-01-25" : t.dueIso,
  moved: t.rowId === 2,
}));

test("buildTaskLoadSeries: buckets tasks per month by type + total", () => {
  const series = buildTaskLoadSeries(tasks, viewport);

  assert.equal(series.points.length, 12, "12 month buckets for the 2027 window");
  const febIndex = series.points.findIndex((p) => p.monthKey === "2027-02");
  const marIndex = series.points.findIndex((p) => p.monthKey === "2027-03");
  const mayIndex = series.points.findIndex((p) => p.monthKey === "2027-05");

  // Feb: 2 coffrage + 1 ndc = 3 total.
  assert.equal(series.byType.COFFRAGE[febIndex], 2);
  assert.equal(series.byType.NDC[febIndex], 1);
  assert.equal(series.total[febIndex], 3);

  // Mar: 1 armature.
  assert.equal(series.byType.ARMATURES[marIndex], 1);
  assert.equal(series.total[marIndex], 1);

  // May: 1 "AUTRES" (custom type).
  assert.equal(series.byType.AUTRES[mayIndex], 1);
  assert.equal(series.total[mayIndex], 1);
});

test("buildTaskLoadSeries: total equals the sum of typed lines per month", () => {
  const series = buildTaskLoadSeries(tasks, viewport);
  series.points.forEach((_, index) => {
    const typedSum = series.typesPresent.reduce((sum, type) => sum + (series.byType[type][index] || 0), 0);
    assert.equal(series.total[index], typedSum, `month ${index} total == sum of typed lines`);
  });
});

test("buildTaskLoadSeries: tasks outside the visible window are excluded", () => {
  const series = buildTaskLoadSeries(tasks, viewport);
  const grandTotal = series.total.reduce((a, b) => a + b, 0);
  // 5 in-window tasks (the 2029 one is dropped).
  assert.equal(grandTotal, 5);
});

test("buildTaskLoadSeries: typesPresent is ordered and only includes present types", () => {
  const series = buildTaskLoadSeries(tasks, viewport);
  assert.deepEqual(series.typesPresent, ["COFFRAGE", "ARMATURES", "NDC", "AUTRES"]);
});

test("buildTaskLoadSeries: realized (100%) counts feed the dotted companion lines", () => {
  const series = buildTaskLoadSeries(tasks, viewport);
  const febIndex = series.points.findIndex((p) => p.monthKey === "2027-02");
  const marIndex = series.points.findIndex((p) => p.monthKey === "2027-03");
  const mayIndex = series.points.findIndex((p) => p.monthKey === "2027-05");

  // Feb coffrage: 2 due, only FOND realized -> 1 realized.
  assert.equal(series.byType.COFFRAGE[febIndex], 2);
  assert.equal(series.byTypeRealized.COFFRAGE[febIndex], 1);
  // Feb NDC: 1 due, 0 realized.
  assert.equal(series.byTypeRealized.NDC[febIndex], 0);
  // Feb total realized = 1 (FOND only).
  assert.equal(series.totalRealized[febIndex], 1);

  // Mar armature realized, May "autres" realized.
  assert.equal(series.byTypeRealized.ARMATURES[marIndex], 1);
  assert.equal(series.byTypeRealized.AUTRES[mayIndex], 1);
});

test("buildTaskLoadSeries: realized never exceeds total per month/type", () => {
  const series = buildTaskLoadSeries(tasks, viewport);
  series.typesPresent.forEach((type) => {
    series.points.forEach((_, index) => {
      assert.ok(series.byTypeRealized[type][index] <= series.byType[type][index]);
    });
  });
  series.points.forEach((_, index) => {
    assert.ok(series.totalRealized[index] <= series.total[index]);
  });
});

test("buildTaskLoadSeries: week granularity buckets tasks per ISO week", () => {
  // Feb 2027 Mondays are the 1st, 8th, 15th, 22nd. FOND due 2027-02-20 (Sat) is in
  // the week of Mon 2027-02-15; PH RDC due 2027-02-25 (Thu) and RSO due 2027-02-28
  // (Sun) are both in the week of Mon 2027-02-22.
  const series = buildTaskLoadSeries(tasks, viewport, { granularity: "week" });

  // Weekly buckets across the whole 2027 window (~53 weeks) — far more than 12.
  assert.ok(series.points.length > 40, "weekly buckets span the year");
  assert.ok(series.points.every((p) => typeof p.weekKey === "string"), "week points carry weekKey");

  const wk15 = series.points.findIndex((p) => p.weekKey === "2027-02-15");
  const wk22 = series.points.findIndex((p) => p.weekKey === "2027-02-22");
  assert.ok(wk15 >= 0 && wk22 >= 0, "both February weeks exist");

  // FOND alone in the week of the 15th; PH RDC + RSO in the week of the 22nd.
  assert.equal(series.byType.COFFRAGE[wk15], 1);
  assert.equal(series.total[wk15], 1);
  assert.equal(series.byType.COFFRAGE[wk22], 1);
  assert.equal(series.byType.NDC[wk22], 1);
  assert.equal(series.total[wk22], 2);

  // Same grand total as the month view (5 in-window tasks), just spread by week.
  assert.equal(series.total.reduce((a, b) => a + b, 0), 5);
});

// --- calibration against the frise below -------------------------------------
// The chart must span exactly the same window, with the same date -> x mapping,
// as the planning in the bottom pane (sync/viewportMath.getDayBoundaryLeftPx:
// a day is contentWidthPx / visibleDays wide, day 0 starting at
// firstVisibleDate 00:00).

const DAY_MS = 24 * 60 * 60 * 1000;

test("getChartWindowBounds: covers whole days, ending at rangeEndDate + 1 day 00:00", () => {
  const bounds = getChartWindowBounds({ firstVisibleDate: "2027-01-01", rangeEndDate: "2027-12-31" });

  assert.equal(bounds.minTs, new Date(2027, 0, 1).getTime(), "starts at the first visible day 00:00");
  assert.equal(bounds.maxTs, new Date(2028, 0, 1).getTime(), "ends at the day AFTER rangeEndDate");
  // 2027 is not a leap year: 365 whole days, matching visibleDays for this window.
  assert.equal((bounds.maxTs - bounds.minTs) / DAY_MS, 365);
});

test("getChartWindowBounds: window width equals visibleDays whole days", () => {
  // A 30-day window (mode "mois"): Jun 1 .. Jun 30 inclusive.
  const bounds = getChartWindowBounds({ firstVisibleDate: "2027-06-01", rangeEndDate: "2027-06-30" });
  assert.equal((bounds.maxTs - bounds.minTs) / DAY_MS, 30);
});

test("getChartWindowBounds: invalid viewport -> null", () => {
  assert.equal(getChartWindowBounds({}), null);
  assert.equal(getChartWindowBounds({ firstVisibleDate: "2027-06-10", rangeEndDate: "2027-06-01" }), null);
});

test("month points sit at the true midpoint of their month, not the 15th", () => {
  const series = buildTaskLoadSeries(tasks, viewport);

  series.points.forEach((point) => {
    const startTs = new Date(point.year, point.monthNumber - 1, 1).getTime();
    const endTs = new Date(point.year, point.monthNumber, 1).getTime();
    assert.equal(point.startTs, startTs, `${point.monthKey} starts on the 1st at 00:00`);
    assert.equal(point.midTs, startTs + (endTs - startTs) / 2, `${point.monthKey} midpoint`);
  });

  // A 31-day month's centre is the 16th at 12:00 — the old 15th-at-00:00 point
  // was 1.5 days (~4% of the month's width) to its left.
  const january = series.points.find((point) => point.monthKey === "2027-01");
  assert.equal(january.midTs, new Date(2027, 0, 16, 12, 0, 0).getTime());
});

test("week points sit at the bucket midpoint, Thursday 12:00 (Monday + 3.5 days)", () => {
  const series = buildTaskLoadSeries(tasks, viewport, { granularity: "week" });

  const week = series.points.find((point) => point.weekKey === "2027-02-15");
  assert.equal(week.startTs, new Date(2027, 1, 15).getTime(), "bucket starts Monday 00:00");
  assert.equal(week.midTs, new Date(2027, 1, 18, 12, 0, 0).getTime(), "midpoint is Thursday 12:00");

  // Every bucket's midpoint is halfway between its two Monday boundaries. The
  // next Monday is derived by CALENDAR arithmetic, not startTs + 7 * DAY_MS:
  // across a DST transition the week is 167h or 169h long, and the midpoint
  // moves with it (this is exactly what the boundary-derived midTs gets right).
  series.points.forEach((point) => {
    const monday = new Date(point.startTs);
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    const expected = point.startTs + (nextMonday.getTime() - point.startTs) / 2;
    assert.equal(point.midTs, expected, `week ${point.weekKey} midpoint`);
  });

  // The DST weeks prove the point: in Europe/Paris, the spring-forward week is
  // 167h so its midpoint is Thursday 11:00, and the autumn week is 169h so its
  // midpoint is Thursday 13:00 — the old fixed "Thursday 12:00" was an hour off
  // on both, which the linear timestamp axis would have shown as drift.
  const springWeek = series.points.find((point) => point.weekKey === "2027-03-22");
  const autumnWeek = series.points.find((point) => point.weekKey === "2027-10-25");
  if (springWeek) {
    const offsetHours = (springWeek.midTs - springWeek.startTs) / (60 * 60 * 1000);
    assert.ok(offsetHours === 83.5 || offsetHours === 84, `spring week offset ${offsetHours}h`);
  }
  if (autumnWeek) {
    const offsetHours = (autumnWeek.midTs - autumnWeek.startTs) / (60 * 60 * 1000);
    assert.ok(offsetHours === 84.5 || offsetHours === 84, `autumn week offset ${offsetHours}h`);
  }
});

test("bucket startTs values are the gridline boundaries, inside the window", () => {
  const bounds = getChartWindowBounds(viewport);
  const series = buildTaskLoadSeries(tasks, viewport);

  series.points.forEach((point) => {
    assert.ok(
      point.startTs >= bounds.minTs && point.startTs < bounds.maxTs,
      `${point.monthKey} boundary is inside the visible window`
    );
  });
  // The window starts on a 1st, so the first gridline is the window's left edge.
  assert.equal(series.points[0].startTs, bounds.minTs);
});

test("buildTaskLoadSeries: empty / invalid viewport -> empty series", () => {
  assert.deepEqual(buildTaskLoadSeries(tasks, {}), {
    points: [],
    byType: {},
    total: [],
    byTypeRealized: {},
    totalRealized: [],
    typesPresent: [],
  });
});

test("buildTaskLoadSeries: chaque point porte endTs, le debut du seau suivant", () => {
  const months = buildTaskLoadSeries(tasks, viewport);
  months.points.forEach((point) => {
    assert.equal(point.endTs, new Date(point.year, point.monthNumber, 1).getTime());
  });
  const weeks = buildTaskLoadSeries(tasks, viewport, { granularity: "week" });
  weeks.points.forEach((point, index) => {
    if (index + 1 < weeks.points.length) assert.equal(point.endTs, weeks.points[index + 1].startTs);
    const monday = new Date(point.startTs);
    assert.equal(point.endTs, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7).getTime());
  });
});

test('buildTaskLoadSeries: dateKey "smoothedIso" compte une tache avancee dans son mois lisse', () => {
  const raw = buildTaskLoadSeries(smoothedTasks, viewport);
  const smoothed = buildTaskLoadSeries(smoothedTasks, viewport, { dateKey: "smoothedIso" });
  const jan = raw.points.findIndex((p) => p.monthKey === "2027-01");
  const feb = raw.points.findIndex((p) => p.monthKey === "2027-02");
  assert.equal(raw.byType.COFFRAGE[jan], 0);
  assert.equal(raw.byType.COFFRAGE[feb], 2);
  assert.equal(smoothed.byType.COFFRAGE[jan], 1);
  assert.equal(smoothed.byType.COFFRAGE[feb], 1);
});

test("buildTaskLoadSeries: le realise compte task.realized", () => {
  const series = buildTaskLoadSeries(tasks, viewport);
  const feb = series.points.findIndex((p) => p.monthKey === "2027-02");
  assert.equal(series.byTypeRealized.COFFRAGE[feb], 1);
  assert.equal(series.totalRealized[feb], 1);
});

test("findBucketIndexAt: le 31 mars tombe dans mars, hors fenetre -> null", () => {
  const { points } = buildTaskLoadSeries(tasks, viewport);
  const mar = points.findIndex((p) => p.monthKey === "2027-03");
  assert.equal(findBucketIndexAt(points, new Date(2027, 2, 31, 23, 30).getTime()), mar);
  assert.equal(findBucketIndexAt(points, new Date(2027, 2, 1).getTime()), mar, "borne basse incluse");
  assert.equal(findBucketIndexAt(points, new Date(2027, 3, 1).getTime()), mar + 1, "borne haute exclue");
  assert.equal(findBucketIndexAt(points, new Date(2026, 11, 31).getTime()), null);
  assert.equal(findBucketIndexAt(points, new Date(2028, 0, 1).getTime()), null);
  assert.equal(findBucketIndexAt([], 0), null);
});

function specsFor(mode) {
  return buildDatasetSpecs({
    rawSeries: buildTaskLoadSeries(smoothedTasks, viewport),
    smoothedSeries: buildTaskLoadSeries(smoothedTasks, viewport, { dateKey: "smoothedIso" }),
    mode,
  });
}

test("buildDatasetSpecs: mode raw -> un main non lisse et un realized par serie", () => {
  const specs = specsFor("raw");
  const raw = buildTaskLoadSeries(smoothedTasks, viewport);
  const coffrage = specs.filter((s) => s.baseLabel === "Coffrage");
  assert.deepEqual(coffrage.map((s) => s.kind).sort(), ["main", "realized"]);
  assert.deepEqual(coffrage.find((s) => s.kind === "main").values, raw.byType.COFFRAGE);
  assert.equal(specs.filter((s) => s.kind === "before").length, 0);
  assert.equal(specs.filter((s) => s.baseLabel === "Total" && s.kind === "main").length, 1);
});

test("buildDatasetSpecs: mode smoothed -> main sur le lisse et un realized", () => {
  const specs = specsFor("smoothed");
  const smoothed = buildTaskLoadSeries(smoothedTasks, viewport, { dateKey: "smoothedIso" });
  const coffrage = specs.filter((s) => s.baseLabel === "Coffrage");
  assert.deepEqual(coffrage.map((s) => s.kind).sort(), ["main", "realized"]);
  assert.deepEqual(coffrage.find((s) => s.kind === "main").values, smoothed.byType.COFFRAGE);
  assert.equal(specs.filter((s) => s.kind === "before").length, 0);
});

test("buildDatasetSpecs: mode both -> main lisse, before non lisse, un seul realized", () => {
  const specs = specsFor("both");
  const raw = buildTaskLoadSeries(smoothedTasks, viewport);
  const smoothed = buildTaskLoadSeries(smoothedTasks, viewport, { dateKey: "smoothedIso" });
  ["Coffrage", "Armature", "NDC", "Autres", "Total"].forEach((base) => {
    const group = specs.filter((s) => s.baseLabel === base);
    assert.deepEqual(group.map((s) => s.kind).sort(), ["before", "main", "realized"], base);
  });
  const coffrage = specs.filter((s) => s.baseLabel === "Coffrage");
  assert.deepEqual(coffrage.find((s) => s.kind === "main").values, smoothed.byType.COFFRAGE);
  assert.deepEqual(coffrage.find((s) => s.kind === "before").values, raw.byType.COFFRAGE);
  assert.equal(coffrage.find((s) => s.kind === "main").color, coffrage.find((s) => s.kind === "before").color);
});

// --- DOM minimal bouchonne ---------------------------------------------------

// Cible d'evenements factice : ecouteurs normaux et ecouteurs en capture.
class FakeTarget {
  constructor() {
    this.listeners = {};
    this.captureListeners = {};
  }
  addEventListener(type, fn, capture) {
    const store = capture ? this.captureListeners : this.listeners;
    (store[type] ||= []).push(fn);
  }
  removeEventListener(type, fn, capture) {
    const store = capture ? this.captureListeners : this.listeners;
    store[type] = (store[type] || []).filter((f) => f !== fn);
  }
}

const FAKE_DOC = new FakeTarget();

// Repartiteur qui respecte stopPropagation : phase de capture le long de `path`
// (du document vers la cible), comme le navigateur.
function fire(path, type, event) {
  const ev = { ...event, stopPropagation() { this.stopped = true; } };
  for (const node of path) {
    for (const fn of node.captureListeners[type] || []) fn(ev);
    if (ev.stopped) return;
  }
}

class FakeHTMLElement {
  constructor() {
    this.listeners = {};
    this.captureListeners = {};
    this.style = {};
    this.dataset = {};
    this.classList = { toggle() {} };
    this._html = "";
    this.inputs = [];
  }
  addEventListener(type, fn, capture) {
    FakeTarget.prototype.addEventListener.call(this, type, fn, capture);
  }
  removeEventListener(type, fn, capture) {
    FakeTarget.prototype.removeEventListener.call(this, type, fn, capture);
  }
  dispatch(type, event) {
    (this.listeners[type] || []).forEach((fn) => fn(event));
  }
  closest() {
    return null;
  }
  get ownerDocument() {
    return FAKE_DOC;
  }
  contains(node) {
    return node === this;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  setAttribute() {}
  get innerHTML() {
    return this._html;
  }
  set innerHTML(value) {
    this._html = String(value);
    this.inputs = [...this._html.matchAll(/<input type="checkbox" data-type-label="([^"]*)"( checked)?>/g)].map(
      (m) => ({ checked: Boolean(m[2]), dataset: { typeLabel: m[1] } })
    );
  }
  querySelectorAll(selector) {
    if (selector.includes("input")) return this.inputs;
    const attr = selector.includes("granularity") ? "data-granularity" : "data-type-label";
    return [...this._html.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((m) => ({
      dataset: { granularity: m[1], typeLabel: m[1] },
      classList: { toggle() {} },
      setAttribute() {},
    }));
  }
}

// Installe HTMLElement / Element / Chart factices le temps d'un test.
function withFakeDom(fn) {
  const saved = { HTMLElement: globalThis.HTMLElement, Element: globalThis.Element, Chart: globalThis.Chart };
  const instances = [];
  FAKE_DOC.listeners = {};
  FAKE_DOC.captureListeners = {};
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.Element = FakeHTMLElement;
  globalThis.Chart = class StubChart {
    constructor(canvas, config) {
      this.config = config;
      this.options = config.options;
      this.data = config.data;
      this.chartArea = { left: 0, right: 1000, top: 0, bottom: 200 };
      this.scales = {
        x: {
          // Canevas de 1000 px couvrant toute la fenetre de l'axe.
          getValueForPixel: (px) => {
            const { min, max } = this.options.scales.x;
            return min + (px / 1000) * (max - min);
          },
        },
      };
      instances.push(this);
    }
    update() {}
    resize() {}
    destroy() {}
  };
  try {
    return fn(instances);
  } finally {
    globalThis.HTMLElement = saved.HTMLElement;
    globalThis.Element = saved.Element;
    globalThis.Chart = saved.Chart;
  }
}

test("filtre conserve : l'etat initial restaure les cases cochees et le regroupement", () => {
  withFakeDom((instances) => {
    const canvas = new FakeHTMLElement();
    const filter = new FakeHTMLElement();
    const gran = new FakeHTMLElement();
    const legend = new FakeHTMLElement();
    const chart = createPlanningChart(canvas, filter, gran, legend, {
      initialUiState: { visibleLabels: ["Coffrage"], granularity: "week" },
    });
    chart.render({ chartInput: { tasks, mode: "raw", active: false }, viewport });

    const checked = Object.fromEntries(filter.inputs.map((i) => [i.dataset.typeLabel, i.checked]));
    assert.deepEqual(checked, { Coffrage: true, Armature: false, NDC: false, Autres: false, Total: false });
    assert.deepEqual(chart.getUiState(), {
      visibleLabels: ["Coffrage"],
      knownLabels: ["Coffrage", "Armature", "NDC", "Autres", "Total"],
      granularity: "week",
    });
    const data = instances[0].data.datasets[0].data;
    assert.ok(data.length > 40, "regroupement par semaine applique");
    const shown = instances[0].data.datasets.filter((d) => !d.hidden).map((d) => d.label);
    assert.deepEqual(shown, ["Coffrage", "Coffrage (réalisé)"]);

    // Un nouveau rendu garde le filtre ; un type nouveau arrive coche.
    const more = [...tasks, task(9, "COUPES", "2027-06-10", false)];
    chart.render({ chartInput: { tasks: more, mode: "raw", active: false }, viewport });
    const again = Object.fromEntries(filter.inputs.map((i) => [i.dataset.typeLabel, i.checked]));
    assert.equal(again.Coffrage, true);
    assert.equal(again.Armature, false);
    assert.equal(again.Coupes, true, "type nouveau coche");
  });
});

// Montage du vrai chemin : document > hote (#ps-chart, avec une doublure de bindPan
// qui ecoute en capture et appelle stopPropagation) > canevas.
function mountClickHarness(options = {}) {
  const canvas = new FakeHTMLElement();
  const host = new FakeHTMLElement();
  host.addEventListener("pointerdown", (e) => e.stopPropagation(), true);
  const calls = [];
  const chart = createPlanningChart(canvas, new FakeHTMLElement(), new FakeHTMLElement(), new FakeHTMLElement(), {
    onBucketClick: (info) => calls.push(info),
    ...options,
  });
  chart.render({ chartInput: { tasks, mode: "raw", active: false }, viewport });
  const down = (x) =>
    fire([FAKE_DOC, host, canvas], "pointerdown", { button: 0, pointerId: 1, clientX: x, clientY: 50, target: canvas });
  const move = (x) => fire([FAKE_DOC, host], "pointermove", { pointerId: 1, clientX: x, clientY: 50, target: host });
  // Le pointeur est capture par l'hote : pointerup et click ciblent l'hote.
  const up = (x) => fire([FAKE_DOC, host], "pointerup", { pointerId: 1, clientX: x, clientY: 50, target: host });
  return { chart, calls, down, move, up };
}

test("clic : un appui-relache au meme point ouvre le seau sous le pointeur, malgre bindPan", () => {
  withFakeDom((instances) => {
    const { calls, down, up } = mountClickHarness();
    assert.equal(instances[0].options.onClick, undefined, "plus d'options.onClick (double ouverture)");
    down(100);
    up(100);
    assert.deepEqual(calls, [
      {
        startIso: "2027-02-01",
        endIso: "2027-03-01",
        label: "février 2027",
        granularity: "month",
        visibleTypeKeys: ["COFFRAGE", "ARMATURES", "NDC", "AUTRES"],
      },
    ]);
  });
});

test("glisser : 100 -> 140 relache a 140, ou relache a 101, n'ouvre pas la liste", () => {
  withFakeDom(() => {
    const { calls, down, move, up } = mountClickHarness();
    down(100);
    move(140);
    up(140);
    down(100);
    move(140);
    up(101);
    assert.equal(calls.length, 0);
    // Un geste suivant, sans glisser, fonctionne de nouveau.
    down(100);
    move(102);
    up(100);
    assert.equal(calls.length, 1);
  });
});

test("clic hebdomadaire : libelle semaine du JJ/MM/AAAA, Total seul -> visibleTypeKeys vide", () => {
  withFakeDom(() => {
    const { calls, down, up } = mountClickHarness({
      initialUiState: { visibleLabels: ["Total"], granularity: "week" },
    });
    down(100);
    up(100);
    assert.deepEqual(calls, [
      {
        startIso: "2027-02-01",
        endIso: "2027-02-08",
        label: "semaine du 01/02/2027",
        granularity: "week",
        visibleTypeKeys: [],
      },
    ]);
  });
});

test("aucune case cochee : le clic n'ouvre pas la liste", () => {
  withFakeDom(() => {
    const { calls, down, up } = mountClickHarness({ initialUiState: { visibleLabels: [] } });
    down(100);
    up(100);
    assert.equal(calls.length, 0);
  });
});

test("destroy retire les ecouteurs du document", () => {
  withFakeDom(() => {
    const { chart, calls, down, up } = mountClickHarness();
    chart.destroy();
    down(100);
    up(100);
    assert.equal(calls.length, 0);
    assert.equal((FAKE_DOC.captureListeners.pointerdown || []).length, 0);
  });
});

test("un rechargement garde les types connus : un type nouveau arrive coche", () => {
  withFakeDom(() => {
    const filter = new FakeHTMLElement();
    const chart = createPlanningChart(new FakeHTMLElement(), filter, new FakeHTMLElement(), new FakeHTMLElement(), {
      initialUiState: {
        visibleLabels: ["Coffrage"],
        knownLabels: ["Coffrage", "Armature", "NDC", "Autres", "Total"],
        granularity: "month",
      },
    });
    const more = [...tasks, task(9, "COUPES", "2027-06-10", false)];
    chart.render({ chartInput: { tasks: more, mode: "raw", active: false }, viewport });
    const checked = Object.fromEntries(filter.inputs.map((i) => [i.dataset.typeLabel, i.checked]));
    assert.deepEqual(checked, {
      Coffrage: true,
      Armature: false,
      NDC: false,
      Coupes: true,
      Autres: false,
      Total: false,
    });
  });
});

test("styles des courbes : plein, pale a 35 %, pointille [3, 3] ; notes de legende par mode", () => {
  withFakeDom((instances) => {
    const legend = new FakeHTMLElement();
    const chart = createPlanningChart(new FakeHTMLElement(), new FakeHTMLElement(), new FakeHTMLElement(), legend);
    chart.render({ chartInput: { tasks: smoothedTasks, mode: "both", active: true }, viewport });
    const ds = instances[0].data.datasets;
    const main = ds.find((d) => d.label === "Coffrage");
    const before = ds.find((d) => d.label === "Coffrage (avant lissage)");
    const realized = ds.find((d) => d.label === "Coffrage (réalisé)");
    assert.equal(main.borderWidth, 2);
    assert.equal(ds.find((d) => d.label === "Total").borderWidth, 3);
    assert.equal(before.borderWidth, 1.5);
    assert.equal(before.borderColor, "rgba(217, 119, 6, 0.35)");
    assert.equal(before.borderDash, undefined);
    assert.deepEqual(realized.borderDash, [3, 3]);
    assert.match(legend.innerHTML, /plein = lissé · pâle = avant lissage · pointillé = réalisé/);

    chart.setChartInput({ tasks: smoothedTasks, mode: "smoothed", active: true });
    assert.match(legend.innerHTML, /lissé · pointillé = réalisé/);
    chart.setChartInput({ tasks: smoothedTasks, mode: "raw", active: true });
    assert.match(legend.innerHTML, /pointillé = réalisé/);
    assert.doesNotMatch(legend.innerHTML, /lissé/);
    // active:false force le brut.
    chart.setChartInput({ tasks: smoothedTasks, mode: "both", active: false });
    assert.equal(instances[0].data.datasets.some((d) => /avant lissage/.test(d.label)), false);
  });
});
