let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;

function getTimelineContainer() {
  const el = document.getElementById("planningTimeline");
  if (!el) throw new Error("Conteneur #planningTimeline introuvable.");
  return el;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeRange(items) {
  if (!items || !items.length) return null;

  let min = null;
  let max = null;

  for (const item of items) {
    const s = toDate(item.start);
    const e = toDate(item.end);

    if (!s || !e) continue;

    if (!min || s < min) min = s;
    if (!max || e > max) max = e;
  }

  if (!min || !max) return null;

  // marge visuelle autour des données
  const start = new Date(min);
  start.setDate(start.getDate() - 7);

  const end = new Date(max);
  end.setDate(end.getDate() + 7);

  return { start, end };
}

export function renderPlanningTimeline({ groups, items }) {
  const container = getTimelineContainer();

  if (!window.vis || !window.vis.DataSet || !window.vis.Timeline) {
    throw new Error("vis-timeline non chargé.");
  }

  if (!timelineInstance) {
    groupsDataSet = new window.vis.DataSet([]);
    itemsDataSet = new window.vis.DataSet([]);

    timelineInstance = new window.vis.Timeline(container, itemsDataSet, groupsDataSet, {
      stack: false,
      multiselect: false,
      verticalScroll: true,
      zoomable: true,
      moveable: true,
      selectable: true,
      showCurrentTime: false,
      locale: "fr",

      orientation: {
        axis: "top",
        item: "top",
      },

      margin: {
        item: { horizontal: 2, vertical: 6 },
        axis: 8,
      },

      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },

      groupHeightMode: "fixed",
      groupOrder: (a, b) => {
        const al = Number(a.meta?.lignePlanning);
        const bl = Number(b.meta?.lignePlanning);
        if (Number.isFinite(al) && Number.isFinite(bl) && al !== bl) return al - bl;

        const ai = Number(a.meta?.id2);
        const bi = Number(b.meta?.id2);
        if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;

        return String(a.meta?.taches || "").localeCompare(String(b.meta?.taches || ""), "fr");
      },
    });
  }

  groupsDataSet.clear();
  itemsDataSet.clear();

  groupsDataSet.add(groups || []);
  itemsDataSet.add(items || []);

  requestAnimationFrame(() => {
    timelineInstance.redraw();

    const range = computeRange(items || []);
    if (range) {
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if ((items || []).length) {
      timelineInstance.fit({ animation: false });
    }
  });
}

export function clearPlanningTimeline() {
  if (!timelineInstance || !groupsDataSet || !itemsDataSet) return;
  groupsDataSet.clear();
  itemsDataSet.clear();
}