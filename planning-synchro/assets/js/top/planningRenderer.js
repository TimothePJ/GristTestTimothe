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
  return (groups || []).map((group) => ({
    id: group.id,
    // Left label = task name (non-aggregated) or Type doc label (aggregated) only:
    // no zone/index/extra columns, unlike Planning Projet's multi-column left panel.
    content: escapeHtml(group.label || ""),
  }));
}

function toVisItems(items) {
  return (items || []).map((item) => ({
    id: item.id,
    group: item.group,
    start: item.start,
    end: item.end,
    className: item.className || "",
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

  function render({ rows, columns, aggregate } = {}) {
    lastRows = rows || [];
    lastColumns = columns || null;

    ensureTimeline();

    const builder = aggregate ? aggregatePlanningItems : buildPlanningItems;
    const { groups, items } = builder(lastRows, lastColumns);

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

  function setAggregate(aggregate) {
    render({ rows: lastRows, columns: lastColumns, aggregate: Boolean(aggregate) });
  }

  function getFirstPhaseDateForCurrentData() {
    return getFirstPhaseDate(lastRows, lastColumns);
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
  }

  return {
    render,
    setWindow,
    setAggregate,
    getFirstPhaseDate: getFirstPhaseDateForCurrentData,
    destroy,
  };
}
