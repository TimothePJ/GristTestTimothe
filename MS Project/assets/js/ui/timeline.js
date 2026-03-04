let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;
let toolbarListenersBound = false;
let dataAnchorDate = null;
let hoverTooltipEl = null;
let hoverTooltipBound = false;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function updateCurrentTimeLineBounds() {
  const container = document.getElementById("msProjectTimeline");
  if (!container) return;

  const topPanel = container.querySelector(".vis-panel.vis-top");
  const currentLines = container.querySelectorAll(".vis-current-time");
  if (!currentLines.length) return;

  const topHeight = topPanel ? topPanel.getBoundingClientRect().height : 0;
  const totalHeight = container.getBoundingClientRect().height;
  const visibleHeight = Math.max(0, totalHeight - topHeight);

  currentLines.forEach((line) => {
    line.style.top = `${topHeight}px`;
    line.style.height = `${visibleHeight}px`;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureHoverTooltip() {
  if (hoverTooltipEl) return hoverTooltipEl;

  const el = document.createElement("div");
  el.id = "ms-project-hover-tooltip";
  el.style.position = "fixed";
  el.style.zIndex = "99999";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.background = "rgba(15, 23, 42, 0.96)";
  el.style.color = "#fff";
  el.style.border = "1px solid rgba(255, 255, 255, 0.14)";
  el.style.borderRadius = "8px";
  el.style.padding = "8px 10px";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.4";
  el.style.boxShadow = "0 10px 24px rgba(2, 6, 23, 0.35)";
  document.body.appendChild(el);

  hoverTooltipEl = el;
  return hoverTooltipEl;
}

function getPointerClientPos(eventLike) {
  const source = eventLike?.srcEvent || eventLike;
  if (!source) return null;

  if (typeof source.clientX === "number" && typeof source.clientY === "number") {
    return { x: source.clientX, y: source.clientY };
  }

  if (source.center && typeof source.center.x === "number" && typeof source.center.y === "number") {
    return { x: source.center.x, y: source.center.y };
  }

  return null;
}

function placeHoverTooltip(eventLike) {
  if (!hoverTooltipEl || hoverTooltipEl.style.display === "none") return;

  const pos = getPointerClientPos(eventLike);
  if (!pos) return;

  hoverTooltipEl.style.left = `${pos.x + 12}px`;
  hoverTooltipEl.style.top = `${pos.y + 12}px`;
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

function getTimelineItemFromElement(itemEl) {
  if (!itemEl || !itemsDataSet) return null;

  const rawId =
    itemEl.getAttribute("data-id") ||
    itemEl.getAttribute("data-item-id") ||
    itemEl.dataset?.id ||
    "";

  if (!rawId) return null;
  return itemsDataSet.get(rawId) || itemsDataSet.get(Number(rawId)) || null;
}

function buildTaskTooltipHtml(item, group) {
  const start = toDate(item?.start);
  const end = toDate(item?.end);

  return `
    <div><strong>${escapeHtml(group?.taskLabel || "Tache")}</strong></div>
    <div>Numero : <strong>${escapeHtml(group?.idLabel || "Non renseigne")}</strong></div>
    <div>Debut : <strong>${escapeHtml(start ? start.toISOString().slice(0, 10) : "Non renseigne")}</strong></div>
    <div>Fin : <strong>${escapeHtml(end ? end.toISOString().slice(0, 10) : "Non renseigne")}</strong></div>
    <div>Duree : <strong>${escapeHtml(group?.durationLabel || "Non renseignee")}</strong></div>
    <div>Equipe : <strong>${escapeHtml(group?.teamLabel || "Non renseignee")}</strong></div>
    <div>Style : <strong>${escapeHtml(group?.styleLabel || "Non renseigne")}</strong></div>
  `;
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
    showHoverTooltip(buildTaskTooltipHtml(item, group), event);
  });

  containerEl.addEventListener("mouseleave", () => {
    hideHoverTooltip();
  });
}

function buildGroupLabelElement(group) {
  const row = document.createElement("div");
  row.className = "group-row-grid";

  const id = document.createElement("div");
  id.className = "cell-id";
  id.textContent = String(group?.idLabel ?? "");

  const task = document.createElement("div");
  task.className = "cell-task";
  task.textContent = String(group?.taskLabel ?? "");

  const start = document.createElement("div");
  start.className = "cell-start";
  start.textContent = String(group?.startLabel ?? "");

  const end = document.createElement("div");
  end.className = "cell-end";
  end.textContent = String(group?.endLabel ?? "");

  const progress = document.createElement("div");
  progress.className = "cell-duration";
  progress.textContent = String(group?.durationLabel ?? "");

  const status = document.createElement("div");
  status.className = "cell-team";
  status.textContent = String(group?.teamLabel ?? "");

  row.append(id, task, start, end, progress, status);
  return row;
}

function getTimelineContainer() {
  const el = document.getElementById("msProjectTimeline");
  if (!el) throw new Error("Conteneur #msProjectTimeline introuvable.");
  return el;
}

function computeRange(items) {
  if (!items || !items.length) return null;

  let min = null;
  let max = null;

  for (const item of items) {
    const start = toDate(item.start);
    if (!start) continue;
    const end = toDate(item.end) || start;

    if (!min || start < min) min = start;
    if (!max || end > max) max = end;
  }

  if (!min || !max) return null;

  const start = new Date(min);
  start.setDate(start.getDate() - 7);

  const end = new Date(max);
  end.setDate(end.getDate() + 7);

  return { start, end };
}

function computeRangeCenter(range) {
  if (!range?.start || !range?.end) return null;
  return new Date((range.start.valueOf() + range.end.valueOf()) / 2);
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
  const windowRange = timelineInstance.getWindow();
  return new Date((windowRange.start.valueOf() + windowRange.end.valueOf()) / 2);
}

function getDynamicNavLabel(mode, anchorDate = new Date()) {
  if (mode === "week") {
    const day = anchorDate.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(anchorDate);
    monday.setDate(anchorDate.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return `Semaine du ${monday.toLocaleDateString("fr-FR")}`;
  }

  if (mode === "month") {
    const label = anchorDate.toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  if (mode === "year") return String(anchorDate.getFullYear());
  return "Periode";
}

function updateNavCenterButtonLabel() {
  const todayBtn = document.getElementById("btn-today");
  if (!todayBtn) return;
  todayBtn.textContent = getDynamicNavLabel(getCurrentZoomMode(), getWindowCenterDate());
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

  let start;
  let end;

  if (mode === "week") {
    const day = anchorDate.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start = new Date(anchorDate);
    start.setDate(anchorDate.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (mode === "month") {
    start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (mode === "year") {
    start = new Date(anchorDate.getFullYear(), 0, 1);
    end = new Date(anchorDate.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else {
    return;
  }

  timelineInstance.setWindow(start, end, { animation: false });
  updateDateRangeDisplay();
}

function moveWindowByMode(direction) {
  if (!timelineInstance) return;

  const mode = getCurrentZoomMode();
  const anchor = getWindowCenterDate();

  if (mode === "week") {
    anchor.setDate(anchor.getDate() + direction * 7);
  } else if (mode === "month") {
    anchor.setMonth(anchor.getMonth() + direction);
  } else if (mode === "year") {
    anchor.setFullYear(anchor.getFullYear() + direction);
  }

  setWindowForMode(mode, anchor);
}

export function renderMsProjectTimeline({ groups, items }) {
  const container = getTimelineContainer();

  if (!window.vis || !window.vis.DataSet || !window.vis.Timeline) {
    throw new Error("vis-timeline non charge.");
  }

  if (!timelineInstance) {
    groupsDataSet = new window.vis.DataSet([]);
    itemsDataSet = new window.vis.DataSet([]);

    timelineInstance = new window.vis.Timeline(container, itemsDataSet, groupsDataSet, {
      locale: "fr",
      orientation: {
        axis: "top",
        item: "top",
      },
      stack: false,
      multiselect: false,
      selectable: true,
      editable: {
        add: false,
        remove: false,
        updateGroup: false,
        updateTime: false,
      },
      groupHeightMode: "fixed",
      margin: {
        item: { horizontal: 2, vertical: 4 },
        axis: 8,
      },
      showCurrentTime: true,
      zoomable: true,
      moveable: true,
      verticalScroll: true,
      showTooltips: false,
      groupTemplate: (group) => buildGroupLabelElement(group),
      groupOrder: (a, b) => a.sortIndex - b.sortIndex,
    });

    bindHoverTooltip(container);
  }

  groupsDataSet.clear();
  itemsDataSet.clear();

  groupsDataSet.add(groups || []);
  itemsDataSet.add(items || []);

  requestAnimationFrame(() => {
    timelineInstance.redraw();

    const range = computeRange(items || []);
    if (range) {
      dataAnchorDate = computeRangeCenter(range);
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if ((groups || []).length) {
      dataAnchorDate = new Date();
      setWindowForMode(getCurrentZoomMode(), dataAnchorDate);
    } else {
      dataAnchorDate = null;
    }

    updateDateRangeDisplay();
    updateNavCenterButtonLabel();
    updateCurrentTimeLineBounds();
  });
}

export function bindTimelineToolbar() {
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
    setWindowForMode(getCurrentZoomMode(), dataAnchorDate || getWindowCenterDate());
  });

  zoomButtons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const mode = event.currentTarget?.dataset?.zoom;
      if (!mode) return;
      setActiveZoomButton(mode);
      setWindowForMode(mode, dataAnchorDate || new Date());
    });
  });

  if (timelineInstance) {
    timelineInstance.on("rangechange", () => {
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      updateCurrentTimeLineBounds();
    });

    timelineInstance.on("rangechanged", () => {
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      updateCurrentTimeLineBounds();
    });
  }

  updateNavCenterButtonLabel();
  updateDateRangeDisplay();
}

export function clearMsProjectTimeline() {
  if (groupsDataSet) groupsDataSet.clear();
  if (itemsDataSet) itemsDataSet.clear();

  const rangeEl = document.getElementById("current-date-range");
  if (rangeEl) rangeEl.textContent = "";

  hideHoverTooltip();
}
