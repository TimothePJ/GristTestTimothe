// Read-only vis-timeline pane for Planning Projet phases (top pane of planning-synchro).
// This is a DOM module: it uses the global `vis` (vis-timeline UMD, loaded via a
// plain <script> tag in index.html / dev/harness.html) and cannot be unit-tested
// under `node --test` (verified instead via node --check + browser harness).
//
// The vis.Timeline construction pattern (new vis.Timeline(container, itemsDataSet,
// groupsDataSet, options)) is adapted from `Planning Projet/assets/js/ui/timeline.js`
// (~lines 5677-5731). The item shape (content = short phase label, title = fallback
// plain-text tooltip) is adapted from the same file's createAggregatePhaseItem
// (~lines 4157-4182). Unlike the source app, this pane is entirely read-only and
// externally controlled: native zoom/pan/edit/select are disabled and the window is
// only ever moved via setWindow(), driven by the shared sync controller (later task).

import {
  buildPlanningItems,
  aggregatePlanningItems,
  getFirstPhaseDate,
} from "./phases.js";

const DAY_MS = 24 * 3600 * 1000;
// Pixel buffer around the visible window for the item-windowing filter
// (applyWindowedItems). Large enough to keep near-off-screen items (which vis
// positions and the panes expect just outside the view), small enough to stay
// within vis-timeline's pixel threshold for positioning an out-of-window item —
// beyond it vis leaves the node unpositioned at left:0 (the stray "far-left"
// segment, most visible when zoomed out).
const WINDOW_ITEM_BUFFER_PX = 200;

const TIMELINE_OPTIONS = {
  editable: false,
  selectable: false,
  zoomable: false,
  moveable: false,
  stack: true,
  orientation: { axis: "top" },
  margin: { item: 4, axis: 4 },
  // Anchor each item's content to its own box (NOT the viewport). vis-timeline's
  // default `align:'auto'` keeps a partially/fully off-screen item's label pinned
  // at the visible edge, so a segment whose date is left of the current window
  // showed its content stuck at the far-left of the frise ("un segment au bout à
  // gauche alors qu'il devrait pas s'afficher"). 'center' makes the content
  // scroll off with its box, so out-of-window segments are simply not seen.
  align: "center",
  // vis's own current-time line is NOT used: it spans the date axis too (the user
  // wants the marker only on the rows) and it advances in real time, drifting away
  // from the past/current split (which is frozen at build time). A custom line is
  // drawn instead (updateTodayLine), inside the rows panel only and at the SAME
  // instant as the split -> always aligned, never on the frise/axis.
  showCurrentTime: false,
  // Row height +50% is driven from CSS on the LABEL (styles.css
  // `#ps-planning .vis-label .vis-inner` vertical padding): vis sizes each row
  // from the label's natural height, not the item's, so growing the label grows
  // the row (~20px -> ~30px); paneMath then measures the taller row.
  // Sticky time axis + bounded height: with `maxHeight` set and
  // `verticalScroll:true`, vis keeps the `orientation.axis:'top'` band fixed and
  // scrolls only the group/label area when content exceeds the cap; below the
  // cap it renders at content height (no blank rows). The cap in px is driven by
  // the splitter (ui/topPaneResizer.js -> setMaxHeight). horizontalScroll stays
  // off — horizontal navigation is entirely controller-driven (setWindow). The
  // initial maxHeight is a sane fallback until the resizer measures and refines.
  maxHeight: 460,
  verticalScroll: true,
  horizontalScroll: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// vis-timeline (standalone build) renders an item's `title` as HTML inside its
// own `.vis-tooltip` popup (NOT as a plain `title` attribute — the item elements
// carry none). So the rich HTML built by buildPhaseTooltipHtml() /the vendored
// builder (`<div><strong>…</strong>…</div>` rows, `<b>…</b><br>…`) renders as a
// readable multi-line tooltip — exactly like Planning Projet. In the aggregate
// ("Rassembler") view this is what surfaces the FULL list of tasks composing a
// merged segment. It is passed through verbatim (no plain-text flattening).

function toVisGroups(groups) {
  return (groups || []).map((group) => {
    const label = group.label || "";
    if (group.isZoneHeader) {
      // Read-only full-width Zone header row (Planning Projet's zone-header-group);
      // left cell shows the zone name (styled via CSS on .zone-header-group).
      return {
        id: group.id,
        className: group.className || "zone-header-group",
        content: escapeHtml(label),
        title: label,
      };
    }
    // Task rows: left label = task name ONLY (single line, ellipsis via CSS) so
    // the shared-frise left column stays aligned; the record's ID2/Zone/Groupe
    // linkage rides on the group `title` (vis sanitizes injected HTML attributes,
    // so a titled <span> in content does not work). Aggregate-mode groups have no
    // titleText -> fall back to the label. `typeClass` (row-type-*) tints the left
    // label cell with the document-type colour from Planning Projet (styles.css).
    return {
      id: group.id,
      className: group.typeClass || "",
      content: escapeHtml(label),
      title: group.titleText || label,
    };
  });
}

function toVisItems(items) {
  return (items || []).map((item) => ({
    id: item.id,
    group: item.group,
    start: item.start,
    end: item.end,
    // Preserve the builder's item type (phase bands = "range", zone bands =
    // "background") and its exact className + inline style (realisation/retard
    // colours) so the bars render identically to Planning Projet.
    type: item.type || "range",
    className: item.className || "",
    style: item.style || "",
    content: escapeHtml(item.phaseLabel || ""),
    title: item.tooltip || "",
  }));
}

function startOfMinuteMs(ms) {
  return Math.floor(ms / 60000) * 60000;
}

export function createPlanningRenderer(containerEl) {
  let timeline = null;
  let groupsDataSet = null;
  let itemsDataSet = null;
  let lastRows = [];
  let lastColumns = null;
  let lastGroupCount = 0;
  let lastAggregate = false;
  let lastOptions = {};
  // Full item set (every phase/reception/démarrage/background) plus the current
  // window, so we can feed vis ONLY the items near the visible window (see
  // applyWindowedItems).
  let allItems = [];
  let lastWindowStartMs = null;
  let lastWindowEndMs = null;
  // Ids actuellement dans le DataSet vis (fenêtrage). On diffe contre cet
  // ensemble pour ne créer/détruire que les nœuds entrant/sortant de la fenêtre,
  // au lieu de tout recréer (clear()+add()) — vis re-rendait alors TOUS les
  // segments à chaque dézoom.
  let appliedItemIds = new Set();
  // Instant of the "today" marker, captured at render time and floored to the
  // MINUTE so it stays in lock-step with the past/current split (which the builder
  // computes at build time) — same minute, no real-time drift. See updateTodayLine.
  let todayInstantMs = startOfMinuteMs(Date.now());

  // Draw the red "today" line ourselves, as a child of the ROWS panel
  // (.vis-panel.vis-center) only — never over the date axis. It is positioned with
  // vis's OWN scale (`body.util.toScreen`), so it lands on the exact same pixel as
  // the items vis draws (accounting for the scroll-gutter width vis reserves) —
  // this is what fixes the "sometimes misaligned until I zoom" drift, since a DOM
  // width measurement could be stale or ignore that gutter. Re-run on every vis
  // redraw ('changed') and setWindow; hidden when today is outside the window.
  function drawTodayLine() {
    if (!timeline || !(containerEl instanceof HTMLElement)) return;
    const centerEl = containerEl.querySelector(".vis-panel.vis-center");
    if (!(centerEl instanceof HTMLElement)) return;
    let line = centerEl.querySelector(":scope > .ps-today-line");
    if (!line) {
      line = document.createElement("div");
      line.className = "ps-today-line";
      centerEl.appendChild(line);
    }

    const width = centerEl.getBoundingClientRect().width;
    let x = null;
    const util = timeline.body && timeline.body.util;
    if (util && typeof util.toScreen === "function") {
      // vis coordinate — same reference the items are drawn with.
      x = util.toScreen(new Date(todayInstantMs));
    } else {
      const spanMs = lastWindowEndMs - lastWindowStartMs;
      if (Number.isFinite(spanMs) && spanMs > 0) {
        x = ((todayInstantMs - lastWindowStartMs) / spanMs) * width;
      }
    }

    if (x == null || x < 0 || x > width) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.left = `${x}px`;
  }

  // Coalesce à un seul passage par frame : vis émet 'changed' plusieurs fois par
  // zoom et setWindow appelle aussi ; sans coalescing on force plusieurs reflows
  // (getBoundingClientRect) par frame. Un rAF gardé regroupe tout en un seul draw.
  let todayLineFrameId = null;
  function updateTodayLine() {
    if (typeof requestAnimationFrame !== "function") {
      drawTodayLine();
      return;
    }
    if (todayLineFrameId != null) return;
    todayLineFrameId = requestAnimationFrame(() => {
      todayLineFrameId = null;
      drawTodayLine();
    });
  }

  // Push into the vis DataSet only the items within a small PIXEL buffer of the
  // current visible window; background bands (zone fills) always pass.
  // WHY: vis-timeline keeps a DOM node for an item that is far outside the window
  // but leaves it UNPOSITIONED (no transform) — it then renders at left:0, i.e. a
  // stray segment pinned at the far-left edge of the frise (a reception band
  // before its phase, or — when zoomed out — a segment whose real date is far to
  // the right). vis's "too far to position" threshold is PIXEL-based, so the
  // margin must be too: a time-proportional margin (e.g. ±1 span) grows at wide
  // zoom and, in pixels, overshoots that threshold — which is why the phantom
  // came back at max zoom. Convert a fixed pixel buffer (WINDOW_ITEM_BUFFER_PX)
  // to a time margin via the current day width, so we keep near-off-screen items
  // (which vis positions, and which the panes/tests expect just outside the view)
  // but drop anything far enough that vis would leave it unpositioned. Called on
  // render and on every setWindow (cheap: few items + one getBoundingClientRect).
  function applyWindowedItems() {
    if (!itemsDataSet) return;
    let visible = allItems;
    if (Number.isFinite(lastWindowStartMs) && Number.isFinite(lastWindowEndMs)) {
      const spanMs = Math.max(lastWindowEndMs - lastWindowStartMs, DAY_MS);
      const centerEl =
        containerEl && typeof containerEl.querySelector === "function"
          ? containerEl.querySelector(".vis-panel.vis-center")
          : null;
      const contentWidthPx = centerEl ? centerEl.getBoundingClientRect().width : 0;
      const dayWidthPx = contentWidthPx > 0 ? contentWidthPx / (spanMs / DAY_MS) : 0;
      // Fall back to a strict-intersect margin (0) before the panel is measurable.
      const marginMs = dayWidthPx > 0 ? (WINDOW_ITEM_BUFFER_PX / dayWidthPx) * DAY_MS : 0;
      const lo = lastWindowStartMs - marginMs;
      const hi = lastWindowEndMs + marginMs;
      visible = allItems.filter((item) => {
        if ((item.type || "range") === "background") return true;
        const startMs = new Date(item.start).getTime();
        const endMs = new Date(item.end != null ? item.end : item.start).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
        return startMs <= hi && endMs >= lo;
      });
    }
    // Diff contre l'ensemble appliqué : ne toucher que le delta (vis ne recrée
    // alors que les nœuds entrants/sortants, pas tout le jeu d'items). Les items
    // déjà présents ne changent pas selon la fenêtre (leurs start/end/className/
    // style ne dépendent que des données), donc aucun update n'est nécessaire.
    const nextIds = new Set(visible.map((item) => item.id));
    const toRemove = [];
    appliedItemIds.forEach((existingId) => {
      if (!nextIds.has(existingId)) toRemove.push(existingId);
    });
    const toAdd = visible.filter((item) => !appliedItemIds.has(item.id));
    if (toRemove.length === 0 && toAdd.length === 0) return;
    if (toRemove.length) itemsDataSet.remove(toRemove);
    if (toAdd.length) itemsDataSet.add(toVisItems(toAdd));
    appliedItemIds = nextIds;
  }

  function ensureTimeline() {
    if (timeline) return;

    if (
      typeof window === "undefined" ||
      !window.vis ||
      !window.vis.DataSet ||
      !window.vis.Timeline
    ) {
      throw new Error("vis-timeline non chargé.");
    }

    groupsDataSet = new window.vis.DataSet([]);
    itemsDataSet = new window.vis.DataSet([]);
    timeline = new window.vis.Timeline(
      containerEl,
      itemsDataSet,
      groupsDataSet,
      TIMELINE_OPTIONS
    );
    // Re-place the today line whenever vis re-lays-out (initial settle, zoom,
    // resize, scroll-gutter appearing/disappearing) — this is what keeps it glued
    // to the split instead of drifting until the next manual zoom.
    if (typeof timeline.on === "function") {
      timeline.on("changed", updateTodayLine);
    }
  }

  function render({
    rows,
    columns,
    aggregate,
    project = "",
    zone = "",
    targetLookup = null,
    referenceReceptionLookup = null,
  } = {}) {
    lastRows = rows || [];
    lastColumns = columns || null;
    lastAggregate = Boolean(aggregate);
    lastOptions = { project, zone, targetLookup, referenceReceptionLookup };
    // Freeze the today marker to build time (floored to the minute), so it matches
    // the past/current split the vendored builder just computed (same minute).
    todayInstantMs = startOfMinuteMs(Date.now());

    ensureTimeline();

    // Non-aggregated = exact Planning Projet rendering (vendored builder); the
    // aggregate toggle keeps the lighter type-doc grouping.
    const { groups, items } = lastAggregate
      ? aggregatePlanningItems(lastRows, lastColumns)
      : buildPlanningItems(lastRows, lastColumns, lastOptions);

    // Stacking OFF in both views: everything a group holds must stay on ONE line.
    //  - Aggregate: two same-type segments in nearby periods would otherwise be
    //    pushed onto a 2nd lane (aggregatePlanningItems already unions truly
    //    overlapping same-type phases into one bar).
    //  - Non-aggregate: a phase straddling "today" is split into a past + a
    //    current item (adjacent at the red today-line); with stacking they landed
    //    on two lanes, but they must render as ONE continuous bar whose colour
    //    changes at the red line — exactly like Planning Projet. A record's items
    //    (split phase + démarrage) never overlap in time, so one lane is enough
    //    (reception bands, the only other same-row item, were removed).
    if (timeline && typeof timeline.setOptions === "function") {
      timeline.setOptions({ stack: false });
    }

    lastGroupCount = groups.length;

    groupsDataSet.clear();
    groupsDataSet.add(toVisGroups(groups));
    allItems = items;
    // Nouveau projet/données : vider le DataSet et l'ensemble suivi, puis laisser
    // applyWindowedItems ajouter la fenêtre courante par diff (depuis vide).
    itemsDataSet.clear();
    appliedItemIds = new Set();
    applyWindowedItems();
  }

  function setWindow(startDate, endDate) {
    if (!timeline) return;
    const startAt = new Date(startDate + "T00:00:00");
    const endAt = new Date(endDate + "T23:59:59");
    lastWindowStartMs = startAt.getTime();
    lastWindowEndMs = endAt.getTime();
    // Re-window the item set BEFORE moving the view so vis never briefly holds an
    // out-of-window item unpositioned at the left edge.
    applyWindowedItems();
    timeline.setWindow(startAt, endAt, { animation: false });
    updateTodayLine();
  }

  // Reset the internal vertical scroll to the FIRST rows. vis-timeline keeps its
  // own vertical scroll offset when content exceeds maxHeight (verticalScroll);
  // on a project switch we want the top of the list, not wherever the previous
  // project was scrolled. Reset the scrollable panels' scrollTop and let vis
  // reconcile via redraw().
  function scrollToTop() {
    if (!timeline || !(containerEl instanceof HTMLElement)) return;
    const reset = () => {
      containerEl
        .querySelectorAll(".vis-panel.vis-center, .vis-panel.vis-left, .vis-panel.vis-right, .vis-vertical-scroll")
        .forEach((el) => {
          if (el instanceof HTMLElement) el.scrollTop = 0;
        });
    };
    reset();
    if (typeof timeline.redraw === "function") timeline.redraw();
    // vis can re-adjust the vertical scroll during its own post-render redraw
    // (maxHeight change, window apply), so re-assert the top on the next frames.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        reset();
        requestAnimationFrame(reset);
      });
    }
  }

  // Cap the pane at `px` and let vis scroll internally past it (sticky axis).
  // Driven by the splitter (ui/topPaneResizer.js); setOptions triggers vis's own
  // redraw, so the drag stays visually crisp with no extra reflow call.
  function setMaxHeight(px) {
    if (timeline && Number.isFinite(px) && px > 0) {
      timeline.setOptions({ maxHeight: Math.round(px) });
    }
  }

  function setAggregate(aggregate) {
    render({ rows: lastRows, columns: lastColumns, aggregate: Boolean(aggregate), ...lastOptions });
  }

  function getFirstPhaseDateForCurrentData() {
    return getFirstPhaseDate(lastRows, lastColumns);
  }

  // Number of task rows (vis groups) currently rendered — drives the top pane's
  // visible-rows math (top/paneMath.js, ui/topPaneResizer.js).
  function getGroupCount() {
    return lastGroupCount;
  }

  function destroy() {
    if (todayLineFrameId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(todayLineFrameId);
      todayLineFrameId = null;
    }
    if (timeline) {
      timeline.destroy();
    }
    timeline = null;
    groupsDataSet = null;
    itemsDataSet = null;
    lastRows = [];
    lastColumns = null;
    lastGroupCount = 0;
    allItems = [];
    lastWindowStartMs = null;
    lastWindowEndMs = null;
    appliedItemIds = new Set();
  }

  return {
    render,
    setWindow,
    setMaxHeight,
    setAggregate,
    scrollToTop,
    getFirstPhaseDate: getFirstPhaseDateForCurrentData,
    getGroupCount,
    destroy,
  };
}
