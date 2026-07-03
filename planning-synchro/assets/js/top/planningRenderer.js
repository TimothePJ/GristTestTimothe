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

const TIMELINE_OPTIONS = {
  editable: false,
  selectable: false,
  zoomable: false,
  moveable: false,
  stack: true,
  orientation: { axis: "top" },
  margin: { item: 4, axis: 4 },
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

// The rich tooltip built by buildPhaseTooltipHtml() is a small stack of
// `<div>...<strong>...</strong>...</div>` rows. vis-timeline's native `item.title`
// is applied to the DOM element's `title` attribute, which only ever renders as
// plain text (a browser tooltip): passing raw HTML would show literal tag markup.
// Convert the rich HTML tooltip to a readable multi-line plain-text version instead
// of duplicating the phases.js tooltip-building rules here.
function htmlTooltipToPlainText(html) {
  return String(html || "")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

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
    // titleText -> fall back to the label.
    return {
      id: group.id,
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
    title: htmlTooltipToPlainText(item.tooltip),
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

    lastGroupCount = groups.length;

    groupsDataSet.clear();
    groupsDataSet.add(toVisGroups(groups));
    itemsDataSet.clear();
    itemsDataSet.add(toVisItems(items));
  }

  function setWindow(startDate, endDate) {
    if (!timeline) return;
    timeline.setWindow(
      new Date(startDate + "T00:00:00"),
      new Date(endDate + "T23:59:59"),
      { animation: false }
    );
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
  }

  return {
    render,
    setWindow,
    setMaxHeight,
    setAggregate,
    getFirstPhaseDate: getFirstPhaseDateForCurrentData,
    getGroupCount,
    destroy,
  };
}
