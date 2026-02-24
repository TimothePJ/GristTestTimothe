let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;
let toolbarListenersBound = false;

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

function updateDateRangeDisplay() {
  if (!timelineInstance) return;

  const el = document.getElementById("current-date-range");
  if (!el) return;

  const range = timelineInstance.getWindow();
  const options = { year: "numeric", month: "long", day: "numeric" };

  el.textContent =
    `${range.start.toLocaleDateString("fr-FR", options)} - ` +
    `${range.end.toLocaleDateString("fr-FR", options)}`;
}

function getCurrentZoomMode() {
  const activeBtn = document.querySelector(".zoom-buttons button.active");
  return activeBtn?.dataset.zoom || "week";
}

function setActiveZoomButton(mode) {
  const buttons = document.querySelectorAll(".zoom-buttons button");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.zoom === mode);
  });
}

function setWindowForMode(mode, anchorDate = new Date()) {
  if (!timelineInstance) return;

  let start = null;
  let end = null;

  if (mode === "week") {
    const d = new Date(anchorDate);
    const day = d.getDay(); // 0 = dimanche
    const diffToMonday = day === 0 ? -6 : 1 - day;

    start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (mode === "month") {
    start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else if (mode === "year") {
    start = new Date(anchorDate.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(anchorDate.getFullYear(), 11, 31);
    end.setHours(23, 59, 59, 999);
  } else {
    // fallback
    return;
  }

  timelineInstance.setWindow(start, end, { animation: false });
  updateDateRangeDisplay();
}

function moveWindowByMode(direction) {
  if (!timelineInstance) return;

  const mode = getCurrentZoomMode();
  const current = timelineInstance.getWindow();

  // ancre = milieu de la fenêtre actuelle
  const centerMs = (current.start.valueOf() + current.end.valueOf()) / 2;
  const anchor = new Date(centerMs);

  if (mode === "week") {
    anchor.setDate(anchor.getDate() + (direction * 7));
  } else if (mode === "month") {
    anchor.setMonth(anchor.getMonth() + direction);
  } else if (mode === "year") {
    anchor.setFullYear(anchor.getFullYear() + direction);
  }

  setWindowForMode(mode, anchor);
}

export function renderPlanningTimeline({ groups, items }) {
  const container = getTimelineContainer();

  if (!window.vis || !window.vis.DataSet || !window.vis.Timeline) {
    throw new Error("vis-timeline non chargé.");
  }

  // Création de l'instance une seule fois
  if (!timelineInstance) {
    groupsDataSet = new window.vis.DataSet([]);
    itemsDataSet = new window.vis.DataSet([]);

    timelineInstance = new window.vis.Timeline(container, itemsDataSet, groupsDataSet, {
      locale: "fr",
      orientation: {
        axis: "top",
        item: "top",
      },
      stack: false, // important pour garder plusieurs segments sur la même ligne
      multiselect: false,
      selectable: true,
      editable: {
        add: false,
        remove: false,
        updateGroup: false,
        updateTime: false,
      },
      groupHeightMode: "fixed", // important pour l'alignement des 4 colonnes
      margin: {
        item: { horizontal: 2, vertical: 4 },
        axis: 8,
      },
      showCurrentTime: false,
      zoomable: true,
      moveable: true,
      verticalScroll: true,
      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },

      groupOrder: (a, b) => {
        const al = Number(a.meta?.lignePlanning);
        const bl = Number(b.meta?.lignePlanning);
        if (Number.isFinite(al) && Number.isFinite(bl) && al !== bl) {
          return al - bl;
        }

        const ai = Number(a.meta?.id2);
        const bi = Number(b.meta?.id2);
        if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) {
          return ai - bi;
        }

        return String(a.meta?.taches || "").localeCompare(
          String(b.meta?.taches || ""),
          "fr"
        );
      },
    });
  }

  // Mise à jour datasets
  groupsDataSet.clear();
  itemsDataSet.clear();

  groupsDataSet.add(groups || []);
  itemsDataSet.add(items || []);

  // Recalage automatique sur les dates des données
  requestAnimationFrame(() => {
    timelineInstance.redraw();

    const range = computeRange(items || []);
    if (range) {
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if ((items || []).length) {
      timelineInstance.fit({ animation: false });
    }

    updateDateRangeDisplay();
  });
}

export function bindTimelineToolbar() {
  // Évite de binder plusieurs fois si refreshPlanning est rappelé
  if (toolbarListenersBound) return;
  toolbarListenersBound = true;

  const prevBtn = document.getElementById("btn-prev");
  const todayBtn = document.getElementById("btn-today");
  const nextBtn = document.getElementById("btn-next");
  const zoomButtons = document.querySelectorAll(".zoom-buttons button");

  prevBtn?.addEventListener("click", () => {
    moveWindowByMode(-1);
  });

  nextBtn?.addEventListener("click", () => {
    moveWindowByMode(1);
  });

  todayBtn?.addEventListener("click", () => {
    const mode = getCurrentZoomMode();
    setWindowForMode(mode, new Date());
  });

  zoomButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const mode = e.currentTarget?.dataset?.zoom;
      if (!mode) return;

      setActiveZoomButton(mode);
      setWindowForMode(mode, new Date());
    });
  });

  // Mettre à jour le texte quand l’utilisateur déplace/zoome à la souris
  if (timelineInstance) {
    timelineInstance.on("rangechange", updateDateRangeDisplay);
    timelineInstance.on("rangechanged", updateDateRangeDisplay);
  }

  // Initialisation affichage
  updateDateRangeDisplay();
}

export function clearPlanningTimeline() {
  if (!timelineInstance || !groupsDataSet || !itemsDataSet) return;

  groupsDataSet.clear();
  itemsDataSet.clear();

  const rangeEl = document.getElementById("current-date-range");
  if (rangeEl) rangeEl.textContent = "";
}