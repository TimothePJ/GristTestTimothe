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
  let appliedItemKey = null;

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
    // Skip the DataSet churn when the visible SET is unchanged (panning within
    // the same items): vis repositions the existing nodes on setWindow, so we
    // only clear+add when an item actually enters or leaves the windowed set.
    const key = visible.map((item) => item.id).join("|");
    if (key === appliedItemKey) return;
    appliedItemKey = key;
    itemsDataSet.clear();
    itemsDataSet.add(toVisItems(visible));
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

    ensureTimeline();

    // Non-aggregated = exact Planning Projet rendering (vendored builder); the
    // aggregate toggle keeps the lighter type-doc grouping.
    const { groups, items } = lastAggregate
      ? aggregatePlanningItems(lastRows, lastColumns)
      : buildPlanningItems(lastRows, lastColumns, lastOptions);

    // Aggregate view = ONE line per document type: disable vis stacking so two
    // same-type segments in nearby periods stay on a single line ("fusionner
    // visuellement") instead of being pushed onto a 2nd lane when their boxes
    // fall within the stacking margin at a wide zoom. aggregatePlanningItems
    // already unions genuinely-overlapping same-type phases into one bar, so the
    // items on that single line never overlap. The non-aggregate view keeps
    // stacking (a record's own phases/reception band may legitimately share a row).
    if (timeline && typeof timeline.setOptions === "function") {
      timeline.setOptions({ stack: !lastAggregate });
    }

    lastGroupCount = groups.length;

    groupsDataSet.clear();
    groupsDataSet.add(toVisGroups(groups));
    allItems = items;
    appliedItemKey = null; // force a fresh apply for the new data set
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
    appliedItemKey = null;
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
