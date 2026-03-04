let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;
let toolbarListenersBound = false;
let dataAnchorDate = null;
let hoverTooltipEl = null;
let hoverTooltipBound = false;
let itemElementsObserver = null;
let debugEventsBound = false;

function debugLog(message, payload) {
  // if (payload === undefined) {
  //   console.log(`[MS Project tooltip] ${message}`);
  //   return;
  // }
  // console.log(`[MS Project tooltip] ${message}`, payload);
}

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
  debugLog("Tooltip DOM element created.");
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

  const offset = 14;
  const rect = hoverTooltipEl.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);

  let left = pos.x + offset;
  let top = pos.y + offset;

  if (left > maxLeft) {
    left = Math.max(8, pos.x - rect.width - offset);
  }

  if (top > maxTop) {
    top = Math.max(8, pos.y - rect.height - offset);
  }

  hoverTooltipEl.style.left = `${left}px`;
  hoverTooltipEl.style.top = `${top}px`;
}

function hideHoverTooltip() {
  if (!hoverTooltipEl) return;
  hoverTooltipEl.style.display = "none";
  hoverTooltipEl.innerHTML = "";
  debugLog("Tooltip hidden.");
}

function showHoverTooltip(html, eventLike) {
  ensureHoverTooltip();
  hoverTooltipEl.innerHTML = html;
  hoverTooltipEl.style.display = "block";
  placeHoverTooltip(eventLike);
  debugLog("Tooltip displayed.");
}

function getTimelineItemFromElement(itemEl) {
  if (!itemEl || !itemsDataSet) return null;

  const decoratedItemEl = itemEl.closest?.("[data-ms-item-id]");
  const decoratedItemId = decoratedItemEl?.getAttribute("data-ms-item-id");
  if (decoratedItemId) {
    const decoratedItem =
      itemsDataSet.get(decoratedItemId) ||
      itemsDataSet.get(String(decoratedItemId)) ||
      itemsDataSet.get(Number(decoratedItemId)) ||
      null;
    if (decoratedItem) return decoratedItem;
    debugLog("No dataset item resolved from decorated element.", {
      decoratedItemId,
    });
  }

  const rawId =
    itemEl.getAttribute("data-id") ||
    itemEl.getAttribute("data-item-id") ||
    itemEl.dataset?.id ||
    "";

  if (!rawId) return null;
  const item = itemsDataSet.get(rawId) || itemsDataSet.get(Number(rawId)) || null;
  if (!item) {
    debugLog("No dataset item resolved from DOM element.", { rawId });
  }
  return item;
}

function getRenderedTimelineItemEntries() {
  const renderedItems = timelineInstance?.itemSet?.items;
  if (!renderedItems || typeof renderedItems !== "object") {
    return [];
  }

  return Object.values(renderedItems);
}

function decorateRenderedTimelineItems(containerEl) {
  if (!containerEl || !timelineInstance) return;

  const entries = getRenderedTimelineItemEntries();
  debugLog("Decorate rendered timeline items.", { count: entries.length });

  entries.forEach((entry) => {
    const itemId = entry?.data?.id ?? entry?.id;
    if (itemId == null) return;

    const item =
      itemsDataSet?.get(itemId) ||
      itemsDataSet?.get(String(itemId)) ||
      itemsDataSet?.get(Number(itemId)) ||
      null;
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const title = getNativeItemTitle(item, group);

    const domNodes = [
      entry?.dom?.box,
      entry?.dom?.point,
      entry?.dom?.range,
      entry?.dom?.line,
      entry?.dom?.dot,
      entry?.dom?.content,
    ].filter(Boolean);

    domNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.setAttribute("data-ms-item-id", String(itemId));
      if (title) {
        node.setAttribute("title", title);
        node.setAttribute("aria-label", title);
      }
    });
  });
}

function getTimelineItemFromEvent(event, containerEl) {
  if (timelineInstance && typeof timelineInstance.getEventProperties === "function" && itemsDataSet) {
    const props = timelineInstance.getEventProperties(event);
    debugLog("getEventProperties result", props);
    const itemId = props?.item;
    if (itemId != null) {
      const item = itemsDataSet.get(itemId) || itemsDataSet.get(String(itemId)) || itemsDataSet.get(Number(itemId));
      if (item) return item;
      debugLog("No dataset item resolved from getEventProperties.", { itemId });
    }
  }

  const itemEl = event?.target?.closest?.(".vis-item");
  if (!itemEl || (containerEl && !containerEl.contains(itemEl))) return null;
  return getTimelineItemFromElement(itemEl);
}

function getHoverElementFromPoint(event, containerEl) {
  const directHoverEl = event.target?.closest?.("[data-ms-item-id], .vis-item");
  if (directHoverEl && (!containerEl || containerEl.contains(directHoverEl))) {
    return directHoverEl;
  }

  if (
    typeof document.elementsFromPoint === "function" &&
    typeof event?.clientX === "number" &&
    typeof event?.clientY === "number"
  ) {
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    const hoveredFromStack = stack.find((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const candidate = el.closest?.("[data-ms-item-id], .vis-item");
      return candidate && (!containerEl || containerEl.contains(candidate));
    });

    if (hoveredFromStack instanceof HTMLElement) {
      return hoveredFromStack.closest?.("[data-ms-item-id], .vis-item") || hoveredFromStack;
    }

    debugLog("elementsFromPoint found no timeline item.", {
      stack: stack.slice(0, 6).map((el) => {
        if (!(el instanceof HTMLElement)) return String(el);
        return {
          tag: el.tagName,
          id: el.id || "",
          className: el.className || "",
          dataMsItemId: el.getAttribute("data-ms-item-id") || "",
        };
      }),
    });
  }

  return null;
}

function showTooltipForItem(item, eventLike) {
  if (!item) {
    debugLog("showTooltipForItem called without item.");
    hideHoverTooltip();
    return;
  }

  const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
  const html = buildTaskTooltipHtml(item, group);
  if (!html) {
    debugLog("No tooltip HTML generated for item.", item);
    hideHoverTooltip();
    return;
  }

  debugLog("Tooltip candidate resolved.", {
    itemId: item.id,
    groupId: item.group,
    task: group?.taskLabel || "",
  });

  if (hoverTooltipEl?.innerHTML !== html || hoverTooltipEl?.style.display === "none") {
    showHoverTooltip(html, eventLike);
  } else {
    placeHoverTooltip(eventLike);
  }
}

function buildTaskTooltipHtml(item, group) {
  const start = toDate(item?.start);
  const end = toDate(item?.end);

  return `
    <div class="tooltip-task-name">${escapeHtml(group?.taskLabel || "Tache")}</div>
    <div class="tooltip-meta-row">Numero : <strong>${escapeHtml(group?.idLabel || "Non renseigne")}</strong></div>
    <div class="tooltip-meta-row">Debut : <strong>${escapeHtml(start ? start.toLocaleDateString("fr-FR") : "Non renseigne")}</strong></div>
    <div class="tooltip-meta-row">Fin : <strong>${escapeHtml(end ? end.toLocaleDateString("fr-FR") : "Non renseigne")}</strong></div>
    <div class="tooltip-meta-row">Duree : <strong>${escapeHtml(group?.durationLabel || "Non renseignee")}</strong></div>
    <div class="tooltip-meta-row">Equipe : <strong>${escapeHtml(group?.teamLabel || "Non renseignee")}</strong></div>
    <div class="tooltip-meta-row">Style : <strong>${escapeHtml(group?.styleLabel || "Non renseigne")}</strong></div>
  `;
}

function getNativeItemTitle(item, group) {
  const start = toDate(item?.start);
  const end = toDate(item?.end);
  const lines = [
    String(group?.taskLabel || "Tache"),
    `Debut : ${start ? start.toLocaleDateString("fr-FR") : "Non renseigne"}`,
    `Fin : ${end ? end.toLocaleDateString("fr-FR") : "Non renseigne"}`,
  ];
  return lines.join("\n");
}

function syncNativeItemTitles(containerEl) {
  if (!containerEl || !itemsDataSet) return;

  const itemElements = containerEl.querySelectorAll(".vis-item");
  debugLog("Sync native titles on rendered items.", { count: itemElements.length });
  itemElements.forEach((itemEl) => {
    const item = getTimelineItemFromElement(itemEl);
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const title = getNativeItemTitle(item, group);
    if (!title) return;

    itemEl.setAttribute("title", title);
    itemEl.setAttribute("aria-label", title);

    const contentEl = itemEl.querySelector(".vis-item-content");
    if (contentEl) {
      contentEl.setAttribute("title", title);
      contentEl.setAttribute("aria-label", title);
    }
  });
}

function bindItemHoverInteractions(containerEl) {
  if (!containerEl) return;

  const itemElements = containerEl.querySelectorAll(".vis-item");
  debugLog("Bind hover interactions scan.", { count: itemElements.length });
  itemElements.forEach((itemEl) => {
    if (itemEl.dataset.msTooltipBound === "1") return;
    itemEl.dataset.msTooltipBound = "1";
    debugLog("Hover listeners bound to item element.", {
      rawId:
        itemEl.getAttribute("data-id") ||
        itemEl.getAttribute("data-item-id") ||
        itemEl.dataset?.id ||
        "",
    });

    itemEl.addEventListener("mouseenter", (event) => {
      const item = getTimelineItemFromElement(itemEl) || getTimelineItemFromEvent(event, containerEl);
      debugLog("mouseenter on item.", {
        resolved: Boolean(item),
        title: itemEl.getAttribute("title") || "",
      });
      showTooltipForItem(item, event);
    });

    itemEl.addEventListener("mousemove", (event) => {
      const item = getTimelineItemFromElement(itemEl) || getTimelineItemFromEvent(event, containerEl);
      if (!item) {
        debugLog("mousemove on item but no data item resolved.");
      }
      showTooltipForItem(item, event);
    });

    itemEl.addEventListener("mouseleave", () => {
      debugLog("mouseleave on item.");
      hideHoverTooltip();
    });
  });
}

function bindDebugTimelineEvents() {
  if (!timelineInstance || debugEventsBound) return;
  debugEventsBound = true;

  timelineInstance.on("itemover", (props) => {
    debugLog("vis itemover", props);
  });

  timelineInstance.on("itemout", (props) => {
    debugLog("vis itemout", props);
  });

  timelineInstance.on("click", (props) => {
    if (props?.item != null) {
      debugLog("vis click on item", props);
    }
  });

  timelineInstance.on("mouseMove", (props) => {
    if (props?.item != null) {
      debugLog("vis mouseMove on item", props);
    }
  });
}

function bindHoverTooltip(containerEl) {
  if (!timelineInstance || hoverTooltipBound || !containerEl) return;
  hoverTooltipBound = true;

  ensureHoverTooltip();

  containerEl.addEventListener("pointermove", (event) => {
    const hoverEl = getHoverElementFromPoint(event, containerEl);
    if (!hoverEl || !containerEl.contains(hoverEl)) {
      hideHoverTooltip();
      return;
    }

    const item = getTimelineItemFromElement(hoverEl) || getTimelineItemFromEvent(event, containerEl);
    if (!item) {
      debugLog("pointermove found no item.", {
        targetClass: event.target?.className || "",
      });
      hideHoverTooltip();
      return;
    }

    debugLog("pointermove resolved item.", {
      itemId: item.id,
    });
    showTooltipForItem(item, event);
  });

  containerEl.addEventListener("mouseleave", () => {
    hideHoverTooltip();
  });

  const syncInteractiveElements = () => {
    debugLog("Sync interactive elements triggered.");
    decorateRenderedTimelineItems(containerEl);
    syncNativeItemTitles(containerEl);
    bindItemHoverInteractions(containerEl);
  };

  syncInteractiveElements();

  if (!itemElementsObserver && typeof MutationObserver !== "undefined") {
    itemElementsObserver = new MutationObserver(() => {
      debugLog("MutationObserver detected timeline DOM changes.");
      requestAnimationFrame(syncInteractiveElements);
    });
    itemElementsObserver.observe(containerEl, {
      childList: true,
      subtree: true,
    });
  }
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
  debugLog("Render timeline called.", {
    groups: groups?.length || 0,
    items: items?.length || 0,
  });

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
      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },
      showTooltips: true,
      groupTemplate: (group) => buildGroupLabelElement(group),
      groupOrder: (a, b) => a.sortIndex - b.sortIndex,
    });
    debugLog("vis Timeline instance created.");
    bindDebugTimelineEvents();
    bindHoverTooltip(container);
  }

  groupsDataSet.clear();
  itemsDataSet.clear();

  groupsDataSet.add(groups || []);
  itemsDataSet.add(items || []);
  debugLog("Datasets updated.", {
    groupCount: groupsDataSet.length,
    itemCount: itemsDataSet.length,
  });

  requestAnimationFrame(() => {
    timelineInstance.redraw();
    decorateRenderedTimelineItems(container);
    syncNativeItemTitles(container);
    bindItemHoverInteractions(container);
    debugLog("Timeline redraw completed.");

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
