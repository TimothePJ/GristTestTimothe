let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;
let toolbarListenersBound = false;
let dataAnchorDate = null;
let hoverTooltipEl = null;
let hoverTooltipBound = false;
let clickTooltipTimer = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getExactIsoDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function ensureHoverTooltip() {
  if (hoverTooltipEl) return hoverTooltipEl;

  const el = document.createElement("div");
  el.id = "planning-hover-tooltip";
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.background = "rgba(18, 24, 33, 0.95)";
  el.style.color = "#fff";
  el.style.border = "1px solid rgba(255, 255, 255, 0.2)";
  el.style.borderRadius = "8px";
  el.style.padding = "8px 10px";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.35";
  el.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.35)";
  document.body.appendChild(el);

  hoverTooltipEl = el;
  return hoverTooltipEl;
}

function getPointerClientPos(eventLike) {
  const src = eventLike?.srcEvent || eventLike;
  if (!src) return null;

  if (typeof src.clientX === "number" && typeof src.clientY === "number") {
    return { x: src.clientX, y: src.clientY };
  }

  if (src.center && typeof src.center.x === "number" && typeof src.center.y === "number") {
    return { x: src.center.x, y: src.center.y };
  }

  return null;
}

function placeHoverTooltip(eventLike) {
  if (!hoverTooltipEl || hoverTooltipEl.style.display === "none") return;

  const pos = getPointerClientPos(eventLike);
  if (!pos) return;

  const offset = 12;
  hoverTooltipEl.style.left = `${pos.x + offset}px`;
  hoverTooltipEl.style.top = `${pos.y + offset}px`;
}

function hideHoverTooltip() {
  if (!hoverTooltipEl) return;
  hoverTooltipEl.style.display = "none";
  hoverTooltipEl.innerHTML = "";
}

function showHoverTooltip(html, eventLike) {
  ensureHoverTooltip();
  hoverTooltipEl.innerHTML = html;
  hoverTooltipEl.style.display = "block";
  placeHoverTooltip(eventLike);
}

function buildPhaseTooltipHtml(item, group) {
  const cls = String(item?.className || "");
  const tache = String(group?.tachesLabel || "Tache");

  if (cls.includes("phase-coffrage")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Coffrage</div>
      <div>Date limite : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-armature")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Armature</div>
      <div>Diff coffrage : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
      <div>Diff armature : <strong>${escapeHtml(getExactIsoDate(item.end))}</strong></div>
    `;
  }

  if (cls.includes("phase-demarrage")) {
    return `
      <div><strong>${escapeHtml(tache)}</strong></div>
      <div>Debut des travaux</div>
      <div>Date : <strong>${escapeHtml(getExactIsoDate(item.start))}</strong></div>
    `;
  }

  return "";
}

function getTimelineItemFromElement(itemEl) {
  if (!itemEl || !itemsDataSet) return null;

  const rawId =
    itemEl.getAttribute("data-id") ||
    itemEl.getAttribute("data-item-id") ||
    itemEl.dataset?.id ||
    "";

  if (!rawId) return null;

  let item = itemsDataSet.get(rawId);
  if (item) return item;

  if (/^\d+$/.test(rawId)) {
    item = itemsDataSet.get(Number(rawId));
    if (item) return item;
  }

  return null;
}

function getTimelineItemFromEvent(event, containerEl) {
  if (timelineInstance && typeof timelineInstance.getEventProperties === "function" && itemsDataSet) {
    const props = timelineInstance.getEventProperties(event);
    const itemId = props?.item;
    if (itemId != null) {
      let item = itemsDataSet.get(itemId);
      if (item) return item;

      if (typeof itemId === "number") {
        item = itemsDataSet.get(String(itemId));
        if (item) return item;
      } else if (typeof itemId === "string" && /^\d+$/.test(itemId)) {
        item = itemsDataSet.get(Number(itemId));
        if (item) return item;
      }
    }
  }

  const itemEl = event?.target?.closest?.(".vis-item");
  if (!itemEl || (containerEl && !containerEl.contains(itemEl))) return null;
  return getTimelineItemFromElement(itemEl);
}

function bindHoverTooltip(containerEl) {
  if (!timelineInstance || hoverTooltipBound || !containerEl) return;
  hoverTooltipBound = true;

  ensureHoverTooltip();

  containerEl.addEventListener("mousemove", (event) => {
    const itemEl = event.target?.closest?.(".vis-item");
    if (!itemEl || !containerEl.contains(itemEl)) {
      hideHoverTooltip();
      return;
    }

    const item = getTimelineItemFromElement(itemEl);
    if (!item) {
      hideHoverTooltip();
      return;
    }

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const html = buildPhaseTooltipHtml(item, group);
    if (!html) {
      hideHoverTooltip();
      return;
    }

    if (hoverTooltipEl.innerHTML !== html || hoverTooltipEl.style.display === "none") {
      showHoverTooltip(html, event);
    } else {
      placeHoverTooltip(event);
    }
  });

  containerEl.addEventListener("mouseleave", () => {
    hideHoverTooltip();
  });

  containerEl.addEventListener("click", (event) => {
    if (event.button !== 0) return; // clic gauche uniquement

    const item = getTimelineItemFromEvent(event, containerEl);
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const html = buildPhaseTooltipHtml(item, group);
    if (!html) return;

    showHoverTooltip(html, event);

    if (clickTooltipTimer) clearTimeout(clickTooltipTimer);
    clickTooltipTimer = setTimeout(() => {
      hideHoverTooltip();
      clickTooltipTimer = null;
    }, 5000);
  });
}

function buildGroupLabelElement(group) {
  const row = document.createElement("div");
  row.className = "group-row-grid";

  const id2 = document.createElement("div");
  id2.className = "cell-id2";
  id2.textContent = String(group?.id2Label ?? "");

  const tache = document.createElement("div");
  tache.className = "cell-task";
  tache.textContent = String(group?.tachesLabel ?? "");

  const typeDoc = document.createElement("div");
  typeDoc.className = "cell-type";
  typeDoc.textContent = String(group?.typeDocLabel ?? "");

  const ligne = document.createElement("div");
  ligne.className = "cell-line";
  ligne.textContent = String(group?.lignePlanningLabel ?? "");

  const indice = document.createElement("div");
  indice.className = "cell-indice";
  indice.textContent = String(group?.indiceLabel ?? "");

  const retards = document.createElement("div");
  retards.className = "cell-retards";
  retards.textContent = String(group?.retardsLabel ?? "");

  row.append(id2, tache, typeDoc, ligne, indice, retards);
  return row;
}

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
    if (!s) continue;
    const e = toDate(item.end) || s;

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

function computeRangeCenter(range) {
  if (!range?.start || !range?.end) return null;
  const centerMs = (range.start.valueOf() + range.end.valueOf()) / 2;
  return new Date(centerMs);
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

function getWindowCenterDate() {
  if (!timelineInstance) return new Date();
  const w = timelineInstance.getWindow();
  const centerMs = (w.start.valueOf() + w.end.valueOf()) / 2;
  return new Date(centerMs);
}

function updateNavCenterButtonLabel() {
  const todayBtn = document.getElementById("btn-today");
  if (!todayBtn) return;
  const mode = getCurrentZoomMode();
  const anchorDate = getWindowCenterDate();
  todayBtn.textContent = getDynamicNavLabel(mode, anchorDate);
}

function getDynamicNavLabel(mode, anchorDate = new Date()) {
  if (mode === "week") {
    const d = new Date(anchorDate);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return `Semaine du ${monday.toLocaleDateString("fr-FR")}`;
  }
  if (mode === "month") {
    const monthLabel = anchorDate.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  }
  if (mode === "year") return String(anchorDate.getFullYear());
  return "Période";
}

function setActiveZoomButton(mode) {
  const buttons = document.querySelectorAll(".zoom-buttons button");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.zoom === mode);
  });
  updateNavCenterButtonLabel();
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
      showCurrentTime: true,
      zoomable: true,
      moveable: true,
      verticalScroll: true,
      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },
      showTooltips: false,
      groupTemplate: (group) => buildGroupLabelElement(group),

      groupOrder: (a, b) => {
        if (Number.isFinite(a.sortIndex) && Number.isFinite(b.sortIndex)) {
          return a.sortIndex - b.sortIndex;
        }

        if (Number.isFinite(a.sortLignePlanning) && Number.isFinite(b.sortLignePlanning)) {
          if (a.sortLignePlanning !== b.sortLignePlanning) {
            return a.sortLignePlanning - b.sortLignePlanning;
          }
        }

        if (Number.isFinite(a.sortID2) && Number.isFinite(b.sortID2)) {
          if (a.sortID2 !== b.sortID2) {
            return a.sortID2 - b.sortID2;
          }
        }

        return String(a.id || "").localeCompare(String(b.id || ""), "fr");
      },
    });

    bindHoverTooltip(container);
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
      dataAnchorDate = computeRangeCenter(range);
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if ((items || []).length) {
      timelineInstance.fit({ animation: false });
      const fitted = timelineInstance.getWindow();
      dataAnchorDate = computeRangeCenter(fitted);
    } else {
      dataAnchorDate = null;
    }

    updateDateRangeDisplay();
    updateNavCenterButtonLabel();
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
    setWindowForMode(mode, dataAnchorDate || getWindowCenterDate());
  });

  zoomButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const mode = e.currentTarget?.dataset?.zoom;
      if (!mode) return;

      setActiveZoomButton(mode);
      setWindowForMode(mode, dataAnchorDate || new Date());
    });
  });

  // Mettre à jour le texte quand l’utilisateur déplace/zoome à la souris
  if (timelineInstance) {
    timelineInstance.on("rangechange", () => {
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
    });
    timelineInstance.on("rangechanged", () => {
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
    });
  }

  // Initialisation affichage
  updateNavCenterButtonLabel();
  updateDateRangeDisplay();
}

export function clearPlanningTimeline() {
  if (!timelineInstance || !groupsDataSet || !itemsDataSet) return;

  groupsDataSet.clear();
  itemsDataSet.clear();

  const rangeEl = document.getElementById("current-date-range");
  if (rangeEl) rangeEl.textContent = "";

  hideHoverTooltip();
}
