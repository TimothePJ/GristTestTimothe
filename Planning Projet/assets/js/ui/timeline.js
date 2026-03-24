let timelineInstance = null;
let groupsDataSet = null;
let itemsDataSet = null;
let toolbarListenersBound = false;
let dataAnchorDate = null;
let hoverTooltipEl = null;
let hoverTooltipBound = false;
let clickTooltipTimer = null;
let itemElementsObserver = null;
let durationCellEditHandler = null;
let durationCellEditBound = false;
let activeDurationEditor = null;
let stickyAxisBound = false;
let stickyAxisRafPending = false;
let axisLeftFillerEl = null;
let msProjectRowDropHandler = null;
let msProjectDropBound = false;
let activeMsDropRowEl = null;
let activeMsDropCellEl = null;
let msProjectGlobalDragCursorActive = false;
let planningRowDragBound = false;
let planningRowDragGlobalListenersBound = false;
let planningRowDragContainerEl = null;
let activePlanningDraggedRowEl = null;
let activePlanningDraggedLinkedRowEls = [];
let activePlanningNativeDragImageEl = null;
let planningRowDropBound = false;
let planningRowDropHandler = null;
let activePlanningDropRowEl = null;
let activePlanningDropZoneEl = null;
let activePlanningDropPosition = "";
let activePlanningDropPreviewRowEl = null;
let activePlanningDropPreviewLabelEl = null;
let planningDropPlacementOverlayEl = null;
let planningDragAutoScrollRafId = 0;
let planningDragAutoScrollVelocityY = 0;
let planningDragAutoScrollTargetEl = null;
let planningDragAutoScrollLastTs = 0;
const planningViewportListeners = new Set();
const EMBEDDED_PLANNING_SYNC_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("embedded") === "planning-sync";
let embeddedPlanningViewportBounds = {
  minVisibleDays: 7,
  maxVisibleDays: 392,
};
let planningViewportBoundsCorrectionPending = false;

const PLANNING_ROW_DRAG_HANDLED_FLAG = "__planningRowDragHandled";

function ensureStickyAxisLeftFiller(container) {
  if (!(container instanceof HTMLElement)) return null;
  if (axisLeftFillerEl instanceof HTMLElement && axisLeftFillerEl.isConnected) {
    return axisLeftFillerEl;
  }

  const filler = document.createElement("div");
  filler.className = "timeline-axis-left-filler";
  filler.setAttribute("aria-hidden", "true");
  container.appendChild(filler);
  axisLeftFillerEl = filler;
  return axisLeftFillerEl;
}

function syncStickyTimelineAxisWithWrapperScroll() {
  const wrapper = document.getElementById("timelineWrapper");
  const container = document.getElementById("planningTimeline");
  if (!(wrapper instanceof HTMLElement) || !(container instanceof HTMLElement)) return;

  const topPanel = container.querySelector(".vis-panel.vis-top");
  if (!(topPanel instanceof HTMLElement)) return;

  const y = wrapper.scrollTop || 0;
  topPanel.style.transform = y ? `translateY(${y}px)` : "translateY(0)";
  topPanel.style.zIndex = "80";

  const leftFiller = ensureStickyAxisLeftFiller(container);
  if (leftFiller instanceof HTMLElement) {
    const axisHeight = Math.max(
      0,
      topPanel.offsetHeight || topPanel.getBoundingClientRect().height || 0
    );
    leftFiller.style.height = `${axisHeight}px`;
    leftFiller.style.transform = y ? `translateY(${y}px)` : "translateY(0)";
  }
}

function requestStickyAxisSync() {
  if (stickyAxisRafPending) return;
  stickyAxisRafPending = true;
  requestAnimationFrame(() => {
    stickyAxisRafPending = false;
    syncStickyTimelineAxisWithWrapperScroll();
  });
}

function bindStickyTimelineAxis() {
  const wrapper = document.getElementById("timelineWrapper");
  if (!(wrapper instanceof HTMLElement) || stickyAxisBound) return;

  stickyAxisBound = true;
  wrapper.addEventListener("scroll", requestStickyAxisSync, { passive: true });
  window.addEventListener("resize", requestStickyAxisSync);
  requestStickyAxisSync();
}

function updateCurrentTimeLineBounds() {
  const container = document.getElementById("planningTimeline");
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

function normalizePlanningViewportBounds(bounds = {}) {
  const nextMinVisibleDays = Math.max(1, Math.round(Number(bounds.minVisibleDays) || 7));
  const nextMaxVisibleDays = Math.max(
    nextMinVisibleDays,
    Math.round(Number(bounds.maxVisibleDays) || 392)
  );

  return {
    minVisibleDays: nextMinVisibleDays,
    maxVisibleDays: nextMaxVisibleDays,
  };
}

function clampPlanningVisibleDaysToBounds(nextVisibleDays, bounds = embeddedPlanningViewportBounds) {
  const normalizedBounds = normalizePlanningViewportBounds(bounds);
  return Math.min(
    Math.max(Math.round(Number(nextVisibleDays) || normalizedBounds.minVisibleDays), normalizedBounds.minVisibleDays),
    normalizedBounds.maxVisibleDays
  );
}

function buildClampedPlanningRange(range, bounds = embeddedPlanningViewportBounds) {
  if (!range?.start || !range?.end) {
    return null;
  }

  const visibleDays = getVisibleDaysFromRange(range);
  const clampedVisibleDays = clampPlanningVisibleDaysToBounds(visibleDays, bounds);
  if (clampedVisibleDays === visibleDays) {
    return null;
  }

  const centerMs = (range.start.valueOf() + range.end.valueOf()) / 2;
  const centerDate = new Date(centerMs);
  if (Number.isNaN(centerDate.getTime())) {
    return null;
  }

  const start = new Date(centerDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.floor((clampedVisibleDays - 1) / 2));

  const end = new Date(start);
  end.setDate(start.getDate() + clampedVisibleDays - 1);
  end.setHours(23, 59, 59, 999);

  return { start, end, visibleDays: clampedVisibleDays };
}

function enforceEmbeddedPlanningViewportBounds(range = null) {
  if (!EMBEDDED_PLANNING_SYNC_MODE || !timelineInstance || planningViewportBoundsCorrectionPending) {
    return false;
  }

  const effectiveRange = range || timelineInstance.getWindow();
  const clampedRange = buildClampedPlanningRange(effectiveRange, embeddedPlanningViewportBounds);
  if (!clampedRange) {
    return false;
  }

  planningViewportBoundsCorrectionPending = true;
  timelineInstance.setWindow(clampedRange.start, clampedRange.end, { animation: false });
  updateDateRangeDisplay();
  updateNavCenterButtonLabel();
  updateCurrentTimeLineBounds();
  requestStickyAxisSync();
  requestAnimationFrame(() => {
    planningViewportBoundsCorrectionPending = false;
  });
  return true;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toIsoDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftIsoDateValue(dateValue, dayDelta = 0) {
  const normalizedDateValue = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateValue)) {
    return "";
  }

  const date = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setDate(date.getDate() + Number(dayDelta || 0));
  return toIsoDateValue(date);
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

function getNativePhaseTitle(item, group) {
  const cls = String(item?.className || "");
  const tache = String(group?.tachesLabel || "Tache");

  if (cls.includes("phase-coffrage")) {
    return [
      tache,
      `Coffrage`,
      `Date limite : ${getExactIsoDate(item.start)}`,
      `Diff coffrage : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-armature")) {
    return [
      tache,
      `Armature`,
      `Diff coffrage : ${getExactIsoDate(item.start)}`,
      `Diff armature : ${getExactIsoDate(item.end)}`,
    ].join("\n");
  }

  if (cls.includes("phase-demarrage")) {
    return [
      tache,
      `Debut des travaux`,
      `Date : ${getExactIsoDate(item.start)}`,
    ].join("\n");
  }

  return "";
}

function getTimelineItemFromElement(itemEl) {
  if (!itemEl || !itemsDataSet) return null;

  const decoratedItemEl = itemEl.closest?.("[data-planning-item-id]");
  const decoratedItemId = decoratedItemEl?.getAttribute("data-planning-item-id");
  if (decoratedItemId) {
    const decoratedItem =
      itemsDataSet.get(decoratedItemId) ||
      itemsDataSet.get(String(decoratedItemId)) ||
      itemsDataSet.get(Number(decoratedItemId)) ||
      null;
    if (decoratedItem) return decoratedItem;
  }

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
    const title = getNativePhaseTitle(item, group);

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
      node.setAttribute("data-planning-item-id", String(itemId));
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

function getHoverElementFromPoint(event, containerEl) {
  const directHoverEl = event.target?.closest?.("[data-planning-item-id], .vis-item");
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
      const candidate = el.closest?.("[data-planning-item-id], .vis-item");
      return candidate && (!containerEl || containerEl.contains(candidate));
    });

    if (hoveredFromStack instanceof HTMLElement) {
      return hoveredFromStack.closest?.("[data-planning-item-id], .vis-item") || hoveredFromStack;
    }
  }

  return null;
}

function showTooltipForItem(item, eventLike) {
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

  if (hoverTooltipEl?.innerHTML !== html || hoverTooltipEl?.style.display === "none") {
    showHoverTooltip(html, eventLike);
  } else {
    placeHoverTooltip(eventLike);
  }
}

function syncNativeItemTitles(containerEl) {
  if (!containerEl || !itemsDataSet) return;

  const itemElements = containerEl.querySelectorAll(".vis-item");
  itemElements.forEach((itemEl) => {
    const item = getTimelineItemFromElement(itemEl);
    if (!item) return;

    const group = groupsDataSet ? groupsDataSet.get(item.group) : null;
    const title = getNativePhaseTitle(item, group);
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
  itemElements.forEach((itemEl) => {
    if (itemEl.dataset.planningTooltipBound === "1") return;
    itemEl.dataset.planningTooltipBound = "1";

    itemEl.addEventListener("mouseenter", (event) => {
      const item = getTimelineItemFromElement(itemEl) || getTimelineItemFromEvent(event, containerEl);
      showTooltipForItem(item, event);
    });

    itemEl.addEventListener("mousemove", (event) => {
      const item = getTimelineItemFromElement(itemEl) || getTimelineItemFromEvent(event, containerEl);
      showTooltipForItem(item, event);
    });

    itemEl.addEventListener("mouseleave", () => {
      hideHoverTooltip();
    });
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
      hideHoverTooltip();
      return;
    }

    showTooltipForItem(item, event);
  });

  containerEl.addEventListener("mouseleave", () => {
    hideHoverTooltip();
  });

  const syncInteractiveElements = () => {
    decorateRenderedTimelineItems(containerEl);
    syncNativeItemTitles(containerEl);
    bindItemHoverInteractions(containerEl);
  };

  syncInteractiveElements();

  if (!itemElementsObserver && typeof MutationObserver !== "undefined") {
    itemElementsObserver = new MutationObserver(() => {
      requestAnimationFrame(syncInteractiveElements);
    });
    itemElementsObserver.observe(containerEl, {
      childList: true,
      subtree: true,
    });
  }

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

function normalizeDurationInput(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

function formatDurationForCell(value) {
  const n = normalizeDurationInput(value);
  if (n == null) return "";
  return String(n);
}

function resetDurationCellView(cellEl, displayText, durationValue = null) {
  if (!(cellEl instanceof HTMLElement)) return;
  cellEl.classList.remove("is-editing-duration", "is-saving-duration");
  cellEl.dataset.planningDurationEditing = "0";
  cellEl.dataset.durationValue =
    durationValue == null ? "" : String(durationValue);
  cellEl.textContent = displayText;
}

function startDurationCellEditing(cellEl) {
  if (!(cellEl instanceof HTMLElement) || !durationCellEditHandler) return;

  if (!cellEl.classList.contains("editable-duration-cell")) return;

  if (activeDurationEditor && activeDurationEditor.cellEl !== cellEl) {
    activeDurationEditor.cancel();
    activeDurationEditor = null;
  } else if (activeDurationEditor?.cellEl === cellEl) {
    return;
  }

  const rowId = Number(cellEl.dataset.rowId);
  if (!Number.isInteger(rowId) || rowId <= 0) return;

  const durationColumnKey = String(cellEl.dataset.durationColumnKey || "");
  const leftDateColumnKey = String(cellEl.dataset.leftDateColumnKey || "");
  const rightIsoDate = String(cellEl.dataset.rightIsoDate || "");
  const durationSlot = String(cellEl.dataset.durationSlot || "1");
  const typeDoc = String(cellEl.dataset.typeDoc || "");

  const initialDisplay = String(cellEl.textContent || "").trim();
  const initialValue = normalizeDurationInput(
    cellEl.dataset.durationValue || initialDisplay
  );

  cellEl.classList.add("is-editing-duration");
  cellEl.dataset.planningDurationEditing = "1";
  cellEl.textContent = "";

  const inputEl = document.createElement("input");
  inputEl.type = "number";
  inputEl.className = "editable-duration-input";
  inputEl.min = "0";
  inputEl.step = "1";
  inputEl.value = initialValue == null ? "" : String(initialValue);
  cellEl.appendChild(inputEl);

  let finalized = false;
  const finalize = () => {
    if (activeDurationEditor?.cellEl === cellEl) {
      activeDurationEditor = null;
    }
  };

  const cancel = () => {
    if (finalized) return;
    finalized = true;
    resetDurationCellView(cellEl, initialDisplay, initialValue);
    finalize();
  };

  const commit = async () => {
    if (finalized) return;

    const nextValue = normalizeDurationInput(inputEl.value);
    if (nextValue == null) {
      cancel();
      return;
    }

    if (nextValue === initialValue) {
      finalized = true;
      resetDurationCellView(cellEl, formatDurationForCell(nextValue), nextValue);
      finalize();
      return;
    }

    finalized = true;
    cellEl.classList.add("is-saving-duration");
    inputEl.disabled = true;

    try {
      await durationCellEditHandler({
        rowId,
        durationWeeks: nextValue,
        durationSlot,
        typeDoc,
        durationColumnKey,
        leftDateColumnKey,
        rightIsoDate,
      });

      if (cellEl.isConnected) {
        resetDurationCellView(cellEl, formatDurationForCell(nextValue), nextValue);
      }
    } catch (error) {
      console.error("Erreur edition duree planning :", error);
      if (cellEl.isConnected) {
        resetDurationCellView(cellEl, initialDisplay, initialValue);
      }
    } finally {
      finalize();
    }
  };

  activeDurationEditor = {
    cellEl,
    cancel,
  };

  inputEl.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });

  inputEl.addEventListener("blur", () => {
    commit();
  });

  inputEl.focus();
  inputEl.select?.();
}

function bindDurationCellEditing(containerEl) {
  if (!containerEl || durationCellEditBound) return;
  durationCellEditBound = true;

  containerEl.addEventListener("click", (event) => {
    const targetEl = event.target;
    if (!(targetEl instanceof Element)) return;

    const cellEl = targetEl.closest(".group-row-grid .editable-duration-cell");
    if (!(cellEl instanceof HTMLElement) || !containerEl.contains(cellEl)) return;

    event.preventDefault();
    event.stopPropagation();
    startDurationCellEditing(cellEl);
  });
}

function getEventTargetElement(event) {
  const directTarget = event?.target;
  if (directTarget instanceof Element) {
    return directTarget;
  }

  if (typeof event?.composedPath === "function") {
    const elementFromPath = event.composedPath().find((node) => node instanceof Element);
    if (elementFromPath instanceof Element) {
      return elementFromPath;
    }
  }

  return null;
}

function setPlanningRowDraggingClass(active) {
  document.body?.classList.toggle("planning-row-dragging", Boolean(active));
  document.documentElement?.classList.toggle("planning-row-dragging", Boolean(active));
}

function normalizePlanningZoneForMatch(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.toLocaleLowerCase("fr") === "sans zone") return "";
  return text;
}

function isPlanningTypeDocMatch(value, keyword) {
  const normalizedValue = String(value ?? "").toUpperCase();
  return normalizedValue.includes(String(keyword ?? "").toUpperCase());
}

function collectLinkedArmatureRowIdsForCoffrage(sourceRowEl) {
  if (!(sourceRowEl instanceof HTMLElement)) return [];

  const sourceTypeDoc = String(sourceRowEl.dataset.planningTypeDoc || "");
  if (!isPlanningTypeDocMatch(sourceTypeDoc, "COFFRAGE")) return [];

  const sourceRowId = Number(sourceRowEl.dataset.planningRowId || "");
  if (!Number.isInteger(sourceRowId) || sourceRowId <= 0) return [];

  const sourceGroup = String(sourceRowEl.dataset.planningGroupe || "").trim();
  if (!sourceGroup) return [];

  const sourceZone = normalizePlanningZoneForMatch(sourceRowEl.dataset.planningZone || "");
  const linkedRowIds = [];

  if (groupsDataSet && typeof groupsDataSet.forEach === "function") {
    groupsDataSet.forEach((group) => {
      if (!group || group.isZoneHeader) return;

      const candidateRowId = Number(group.rowId || "");
      if (!Number.isInteger(candidateRowId) || candidateRowId <= 0 || candidateRowId === sourceRowId) {
        return;
      }

      const candidateTypeDoc = String(group.typeDocLabel || "");
      if (!isPlanningTypeDocMatch(candidateTypeDoc, "ARMATURES")) return;

      const candidateGroup = String(group.groupeLabel || "").trim();
      if (!candidateGroup || candidateGroup !== sourceGroup) return;

      const candidateZone = normalizePlanningZoneForMatch(group.zoneLabel || "");
      if (candidateZone !== sourceZone) return;

      linkedRowIds.push(candidateRowId);
    });
  }

  return [...new Set(linkedRowIds)];
}

function getPlanningRowElementByRowId(rowId) {
  const normalizedRowId = Number(rowId);
  if (!Number.isInteger(normalizedRowId) || normalizedRowId <= 0) return null;

  const container =
    planningRowDragContainerEl instanceof HTMLElement
      ? planningRowDragContainerEl
      : document;
  const rowEl = container.querySelector(
    `.group-row-grid.planning-draggable-row[data-planning-row-id="${normalizedRowId}"]`
  );
  return rowEl instanceof HTMLElement ? rowEl : null;
}

function collectLinkedArmatureRowElements(rowIds = []) {
  if (!Array.isArray(rowIds) || !rowIds.length) return [];
  const linkedRows = [];

  rowIds.forEach((rowId) => {
    const rowEl = getPlanningRowElementByRowId(rowId);
    if (rowEl instanceof HTMLElement) {
      linkedRows.push(rowEl);
    }
  });

  return linkedRows;
}

function buildPlanningRowDragPayload(rowEl, linkedArmatureRowIds = []) {
  if (!(rowEl instanceof HTMLElement)) return null;

  const rowId = Number(rowEl.dataset.planningRowId || "");
  if (!Number.isInteger(rowId) || rowId <= 0) return null;

  const normalizedLinkedArmatureRowIds = (Array.isArray(linkedArmatureRowIds) ? linkedArmatureRowIds : [])
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0 && id !== rowId);

  return {
    type: "planning-row",
    rowId,
    id2: String(rowEl.dataset.planningId2 ?? "").trim(),
    task: String(rowEl.dataset.planningTask ?? "").trim(),
    groupe: String(rowEl.dataset.planningGroupe ?? "").trim(),
    zone: String(rowEl.dataset.planningZone ?? "").trim(),
    lignePlanning: String(rowEl.dataset.planningLignePlanning ?? "").trim(),
    typeDoc: String(rowEl.dataset.planningTypeDoc ?? "").trim(),
    startIso: String(rowEl.dataset.planningStartIso ?? "").trim(),
    endIso: String(rowEl.dataset.planningEndIso ?? "").trim(),
    demarrageIso: String(rowEl.dataset.planningDemarrageIso ?? "").trim(),
    indice: String(rowEl.dataset.planningIndice ?? "").trim(),
    retards: String(rowEl.dataset.planningRetards ?? "").trim(),
    linkedArmatureRowIds: normalizedLinkedArmatureRowIds,
    linkedArmatureCount: normalizedLinkedArmatureRowIds.length,
  };
}

function setPlanningRowDragData(dataTransfer, payload) {
  if (!dataTransfer || !payload) return;
  const jsonPayload = JSON.stringify(payload);

  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData("application/x-planning-row", jsonPayload);
  dataTransfer.setData("text/x-planning-row", jsonPayload);
}

function clearPlanningNativeDragImage() {
  if (activePlanningNativeDragImageEl && activePlanningNativeDragImageEl.isConnected) {
    activePlanningNativeDragImageEl.remove();
  }
  activePlanningNativeDragImageEl = null;
}

function getPlanningScrollWrapper() {
  const wrapper = document.getElementById("timelineWrapper");
  return wrapper instanceof HTMLElement ? wrapper : null;
}

function stopPlanningDragAutoScroll() {
  if (planningDragAutoScrollRafId) {
    cancelAnimationFrame(planningDragAutoScrollRafId);
  }
  planningDragAutoScrollRafId = 0;
  planningDragAutoScrollVelocityY = 0;
  planningDragAutoScrollTargetEl = null;
  planningDragAutoScrollLastTs = 0;
}

function runPlanningDragAutoScroll(ts) {
  const target = planningDragAutoScrollTargetEl;
  const velocity = planningDragAutoScrollVelocityY;
  if (!(target instanceof HTMLElement) || !Number.isFinite(velocity) || Math.abs(velocity) < 0.1) {
    stopPlanningDragAutoScroll();
    return;
  }

  const dtSeconds = planningDragAutoScrollLastTs
    ? Math.min(0.05, Math.max(0.001, (ts - planningDragAutoScrollLastTs) / 1000))
    : (1 / 60);
  planningDragAutoScrollLastTs = ts;

  const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
  const nextTop = Math.max(0, Math.min(maxTop, target.scrollTop + (velocity * dtSeconds)));
  target.scrollTop = nextTop;

  planningDragAutoScrollRafId = requestAnimationFrame(runPlanningDragAutoScroll);
}

function startPlanningDragAutoScrollIfNeeded() {
  if (planningDragAutoScrollRafId) return;
  planningDragAutoScrollLastTs = 0;
  planningDragAutoScrollRafId = requestAnimationFrame(runPlanningDragAutoScroll);
}

function computePlanningAutoScrollVelocity(distanceToEdge, threshold, maxAbsSpeedPxPerSec) {
  if (!Number.isFinite(distanceToEdge) || distanceToEdge >= threshold) return 0;
  const clamped = Math.max(0, Math.min(threshold, distanceToEdge));
  const ratio = 1 - (clamped / threshold);
  const eased = ratio * ratio;
  return eased * maxAbsSpeedPxPerSec;
}

function updatePlanningDragAutoScrollFromPointer(clientX, clientY) {
  if (!(activePlanningDraggedRowEl instanceof HTMLElement)) {
    stopPlanningDragAutoScroll();
    return;
  }

  const wrapper = getPlanningScrollWrapper();
  if (!(wrapper instanceof HTMLElement)) {
    stopPlanningDragAutoScroll();
    return;
  }

  const x = Number(clientX);
  const y = Number(clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    stopPlanningDragAutoScroll();
    return;
  }

  const rect = wrapper.getBoundingClientRect();
  const isInsideX = x >= rect.left && x <= rect.right;
  const nearX =
    isInsideX ||
    (x >= rect.left - 64 && x <= rect.right + 64);
  if (!nearX) {
    stopPlanningDragAutoScroll();
    return;
  }

  const threshold = Math.max(56, Math.min(140, Math.round(rect.height * 0.2)));
  const topDist = y - rect.top;
  const bottomDist = rect.bottom - y;
  const maxSpeed = 1500;

  let velocityY = 0;
  if (topDist < threshold) {
    velocityY = -computePlanningAutoScrollVelocity(topDist, threshold, maxSpeed);
  } else if (bottomDist < threshold) {
    velocityY = computePlanningAutoScrollVelocity(bottomDist, threshold, maxSpeed);
  }

  if (!Number.isFinite(velocityY) || Math.abs(velocityY) < 1) {
    stopPlanningDragAutoScroll();
    return;
  }

  planningDragAutoScrollTargetEl = wrapper;
  planningDragAutoScrollVelocityY = velocityY;
  startPlanningDragAutoScrollIfNeeded();
}

function cloneSinglePlanningRowPreview(rowEl, payload, { isLinked = false } = {}) {
  if (!(rowEl instanceof HTMLElement)) return null;
  const preview = rowEl.cloneNode(true);
  if (!(preview instanceof HTMLElement)) return null;

  const rowRect = rowEl.getBoundingClientRect();
  preview.className = "group-row-grid planning-native-drag-row";
  if (isLinked) {
    preview.classList.add("planning-native-drag-row-linked");
  }
  preview.style.width = `${Math.max(420, Math.round(rowRect.width))}px`;
  preview.style.pointerEvents = "none";
  preview.style.position = "static";
  preview.style.top = "";
  preview.style.left = "";

  preview.querySelectorAll(".editable-duration-cell").forEach((cell) => {
    if (!(cell instanceof HTMLElement)) return;
    cell.classList.remove("editable-duration-cell", "is-editing-duration", "is-saving-duration");
    cell.removeAttribute("title");
  });

  if (!preview.childElementCount) {
    preview.textContent = payload?.task || payload?.id2 || "Ligne planning";
  }

  return preview;
}

function clonePlanningRowForDragPreview(rowEl, payload, linkedArmatureRows = []) {
  if (!(rowEl instanceof HTMLElement)) return null;

  const linkedRows = Array.isArray(linkedArmatureRows)
    ? linkedArmatureRows.filter((candidate) => candidate instanceof HTMLElement)
    : [];

  const sourcePreview = cloneSinglePlanningRowPreview(rowEl, payload);
  if (!(sourcePreview instanceof HTMLElement)) return null;

  if (!linkedRows.length) {
    sourcePreview.style.position = "fixed";
    sourcePreview.style.top = "-10000px";
    sourcePreview.style.left = "-10000px";
    sourcePreview.style.zIndex = "1000002";
    document.body.appendChild(sourcePreview);
    return sourcePreview;
  }

  const stackEl = document.createElement("div");
  stackEl.className = "planning-native-drag-stack";
  stackEl.style.position = "fixed";
  stackEl.style.top = "-10000px";
  stackEl.style.left = "-10000px";
  stackEl.style.pointerEvents = "none";
  stackEl.style.zIndex = "1000002";

  stackEl.appendChild(sourcePreview);

  linkedRows.forEach((linkedRowEl) => {
    const linkedPreview = cloneSinglePlanningRowPreview(linkedRowEl, payload, {
      isLinked: true,
    });
    if (!(linkedPreview instanceof HTMLElement)) return;
    stackEl.appendChild(linkedPreview);
  });

  document.body.appendChild(stackEl);
  return stackEl;
}

function clearPlanningRowDraggingState(containerEl = null) {
  setPlanningRowDraggingClass(false);
  stopPlanningDragAutoScroll();

  if (activePlanningDraggedRowEl && activePlanningDraggedRowEl.isConnected) {
    activePlanningDraggedRowEl.classList.remove("is-dragging-row");
  }
  if (Array.isArray(activePlanningDraggedLinkedRowEls)) {
    activePlanningDraggedLinkedRowEls.forEach((linkedRowEl) => {
      if (!(linkedRowEl instanceof HTMLElement) || !linkedRowEl.isConnected) return;
      linkedRowEl.classList.remove("is-dragging-row");
    });
  }
  activePlanningDraggedLinkedRowEls = [];
  activePlanningDraggedRowEl = null;
  clearPlanningNativeDragImage();

  const effectiveContainer =
    containerEl instanceof HTMLElement
      ? containerEl
      : (planningRowDragContainerEl instanceof HTMLElement ? planningRowDragContainerEl : document);
  const draggingRows = effectiveContainer.querySelectorAll(
    ".group-row-grid.planning-draggable-row.is-dragging-row"
  );
  draggingRows.forEach((rowEl) => rowEl.classList.remove("is-dragging-row"));
}

function resolvePlanningDragRowElement(event, forcedRowEl = null) {
  if (forcedRowEl instanceof HTMLElement) return forcedRowEl;

  const targetEl = getEventTargetElement(event);
  if (!(targetEl instanceof Element)) return null;

  const rowEl = targetEl.closest(".group-row-grid.planning-draggable-row");
  if (!(rowEl instanceof HTMLElement)) return null;
  return rowEl;
}

function handlePlanningNativeDragStart(event, forcedRowEl = null) {
  if (!event) return;
  if (event[PLANNING_ROW_DRAG_HANDLED_FLAG]) return;

  const rowEl = resolvePlanningDragRowElement(event, forcedRowEl);
  if (!(rowEl instanceof HTMLElement)) return;
  if (
    planningRowDragContainerEl instanceof HTMLElement &&
    !planningRowDragContainerEl.contains(rowEl)
  ) {
    return;
  }

  event[PLANNING_ROW_DRAG_HANDLED_FLAG] = true;

  const linkedArmatureRowIds = collectLinkedArmatureRowIdsForCoffrage(rowEl);
  const linkedArmatureRows = collectLinkedArmatureRowElements(linkedArmatureRowIds);
  const payload = buildPlanningRowDragPayload(rowEl, linkedArmatureRowIds);
  if (!payload) {
    event.preventDefault();
    return;
  }

  setPlanningRowDragData(event.dataTransfer, payload);
  clearPlanningNativeDragImage();
  const nativeImage = clonePlanningRowForDragPreview(rowEl, payload, linkedArmatureRows);
  if (nativeImage) {
    activePlanningNativeDragImageEl = nativeImage;
    if (event.dataTransfer?.setDragImage) {
      event.dataTransfer.setDragImage(nativeImage, 20, 16);
    }
  }

  rowEl.classList.add("is-dragging-row");
  linkedArmatureRows.forEach((linkedRowEl) => {
    if (!(linkedRowEl instanceof HTMLElement)) return;
    linkedRowEl.classList.add("is-dragging-row");
  });
  activePlanningDraggedLinkedRowEls = linkedArmatureRows;
  activePlanningDraggedRowEl = rowEl;
  setPlanningRowDraggingClass(true);
}

function bindGlobalPlanningRowDragging() {
  if (planningRowDragGlobalListenersBound) return;
  planningRowDragGlobalListenersBound = true;

  window.addEventListener(
    "dragover",
    (event) => {
      if (!hasPlanningRowPayloadType(event.dataTransfer)) return;
      updatePlanningDragAutoScrollFromPointer(event.clientX, event.clientY);
      updatePlanningDropTargetPreview(event);
    },
    true
  );

  window.addEventListener(
    "dragstart",
    (event) => {
      handlePlanningNativeDragStart(event);
    },
    true
  );

  window.addEventListener(
    "dragend",
    () => {
      stopPlanningDragAutoScroll();
      clearPlanningRowDraggingState(null);
    },
    true
  );

  window.addEventListener(
    "drop",
    () => {
      stopPlanningDragAutoScroll();
      clearPlanningRowDraggingState(null);
    },
    true
  );
}

function bindPlanningRowDragging(containerEl) {
  if (!(containerEl instanceof HTMLElement) || planningRowDragBound) return;
  planningRowDragBound = true;
  planningRowDragContainerEl = containerEl;
  bindGlobalPlanningRowDragging();
}

function hasPlanningRowPayloadType(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes("application/x-planning-row") ||
    types.includes("text/x-planning-row")
  );
}

function extractPlanningRowPayloadFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return null;

  const readData = (mimeType) => {
    try {
      return dataTransfer.getData(mimeType);
    } catch (error) {
      return "";
    }
  };

  const rawPayload =
    readData("application/x-planning-row") || readData("text/x-planning-row");
  if (!rawPayload) return null;

  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || parsed.type !== "planning-row") return null;
    const rowId = Number(parsed.rowId);
    if (!Number.isInteger(rowId) || rowId <= 0) return null;
    const linkedArmatureRowIds = Array.isArray(parsed.linkedArmatureRowIds)
      ? [...new Set(
        parsed.linkedArmatureRowIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0 && value !== rowId)
      )]
      : [];
    return {
      ...parsed,
      rowId,
      linkedArmatureRowIds,
    };
  } catch (error) {
    return null;
  }
}

function normalizePlanningDropPosition(position) {
  return position === "before" ? "before" : "after";
}

function getPlanningDropEventClientY(eventLike) {
  if (!eventLike) return NaN;

  const directClientY = Number(eventLike.clientY);
  if (Number.isFinite(directClientY)) return directClientY;

  const sourceEvent = eventLike?.srcEvent || eventLike?.event || null;
  const sourceClientY = Number(sourceEvent?.clientY);
  if (Number.isFinite(sourceClientY)) return sourceClientY;

  return NaN;
}

function getPlanningDropCandidateElements(containerEl) {
  if (!(containerEl instanceof HTMLElement)) return [];
  return Array.from(
    containerEl.querySelectorAll(".zone-header-band, .group-row-grid.planning-draggable-row")
  ).filter((element) => element instanceof HTMLElement);
}

function findPlanningDropCandidateAtClientY(containerEl, clientY) {
  if (!(containerEl instanceof HTMLElement)) return null;

  const pointerY = Number(clientY);
  if (!Number.isFinite(pointerY)) return null;

  const candidates = getPlanningDropCandidateElements(containerEl);
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (pointerY >= rect.top && pointerY <= rect.bottom) {
      return candidate;
    }
  }

  return null;
}

function resolvePlanningRowDropPosition(rowEl, clientY) {
  if (!(rowEl instanceof HTMLElement)) return "after";

  const pointerY = Number(clientY);
  if (!Number.isFinite(pointerY)) return "after";

  const rect = rowEl.getBoundingClientRect();
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) {
    return "after";
  }

  const midpoint = rect.top + (rect.height / 2);
  return pointerY < midpoint ? "before" : "after";
}

function clearPlanningRowDropTarget(containerEl = null) {
  if (activePlanningDropRowEl && activePlanningDropRowEl.isConnected) {
    activePlanningDropRowEl.classList.remove(
      "is-planning-row-drop-target",
      "is-planning-row-drop-before",
      "is-planning-row-drop-after",
      "is-planning-row-drop-committing"
    );
  }
  if (activePlanningDropZoneEl && activePlanningDropZoneEl.isConnected) {
    activePlanningDropZoneEl.classList.remove(
      "is-planning-zone-drop-target",
      "is-planning-zone-drop-committing"
    );
  }
  if (activePlanningDropPreviewRowEl && activePlanningDropPreviewRowEl.isConnected) {
    activePlanningDropPreviewRowEl.classList.remove("is-planning-drop-placement-row");
  }
  if (activePlanningDropPreviewLabelEl && activePlanningDropPreviewLabelEl.isConnected) {
    activePlanningDropPreviewLabelEl.classList.remove("is-planning-drop-placement-label");
  }

  activePlanningDropRowEl = null;
  activePlanningDropZoneEl = null;
  activePlanningDropPosition = "";
  activePlanningDropPreviewRowEl = null;
  activePlanningDropPreviewLabelEl = null;
  hidePlanningDropPlacementOverlay();

  const effectiveContainer =
    containerEl instanceof HTMLElement
      ? containerEl
      : document.getElementById("planningTimeline");
  if (effectiveContainer instanceof HTMLElement) {
    effectiveContainer.classList.remove("is-planning-row-drop-active");
  }
}

function ensurePlanningDropPlacementOverlay(containerEl) {
  if (
    planningDropPlacementOverlayEl instanceof HTMLElement &&
    planningDropPlacementOverlayEl.isConnected
  ) {
    return planningDropPlacementOverlayEl;
  }

  if (planningDropPlacementOverlayEl instanceof HTMLElement && planningDropPlacementOverlayEl.isConnected) {
    planningDropPlacementOverlayEl.remove();
  }

  const overlayEl = document.createElement("div");
  overlayEl.className = "planning-drop-placement-overlay";
  overlayEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlayEl);
  planningDropPlacementOverlayEl = overlayEl;
  return planningDropPlacementOverlayEl;
}

function hidePlanningDropPlacementOverlay() {
  if (!(planningDropPlacementOverlayEl instanceof HTMLElement)) return;
  planningDropPlacementOverlayEl.classList.remove(
    "is-visible",
    "is-before",
    "is-after",
    "is-coffrage"
  );
  planningDropPlacementOverlayEl.style.removeProperty("left");
  planningDropPlacementOverlayEl.style.removeProperty("top");
  planningDropPlacementOverlayEl.style.removeProperty("width");
  planningDropPlacementOverlayEl.style.removeProperty("height");
}

function setPlanningDropPlacementOverlay(rowEl, containerEl, position = "after") {
  if (!(rowEl instanceof HTMLElement) || !(containerEl instanceof HTMLElement)) {
    hidePlanningDropPlacementOverlay();
    return;
  }

  const overlayEl = ensurePlanningDropPlacementOverlay(containerEl);
  if (!(overlayEl instanceof HTMLElement)) return;

  const anchorRect = rowEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const normalizedPosition = normalizePlanningDropPosition(position);
  const insertionY =
    normalizedPosition === "before"
      ? anchorRect.top
      : anchorRect.bottom;
  const indicatorHeight = 10;
  const top = Math.round(insertionY - (indicatorHeight / 2));
  const left = Math.round(containerRect.left);
  const width = Math.max(1, Math.round(containerRect.width));

  overlayEl.style.left = `${left}px`;
  overlayEl.style.top = `${top}px`;
  overlayEl.style.width = `${width}px`;
  overlayEl.style.height = `${indicatorHeight}px`;
  overlayEl.classList.add("is-visible");
  overlayEl.classList.toggle("is-before", normalizedPosition === "before");
  overlayEl.classList.toggle("is-after", normalizedPosition !== "before");
  overlayEl.classList.toggle("is-coffrage", rowEl.classList.contains("row-type-coffrage"));
}

function updatePlanningDropTargetPreview(eventLike) {
  const containerEl =
    planningRowDragContainerEl instanceof HTMLElement
      ? planningRowDragContainerEl
      : document.getElementById("planningTimeline");
  if (!(containerEl instanceof HTMLElement)) return;

  const clientX = Number(eventLike?.clientX);
  const clientY = getPlanningDropEventClientY(eventLike);
  const containerRect = containerEl.getBoundingClientRect();
  const isInsideContainer =
    Number.isFinite(clientX) &&
    Number.isFinite(clientY) &&
    clientX >= containerRect.left &&
    clientX <= containerRect.right &&
    clientY >= containerRect.top &&
    clientY <= containerRect.bottom;

  if (!isInsideContainer) {
    clearPlanningRowDropTarget(containerEl);
    return;
  }

  const candidateEl = findPlanningDropCandidateAtClientY(containerEl, clientY);
  if (
    candidateEl instanceof HTMLElement &&
    candidateEl.classList.contains("group-row-grid")
  ) {
    const targetRowId = Number(candidateEl.dataset.planningRowId || "");
    const sourceRowId = Number(activePlanningDraggedRowEl?.dataset?.planningRowId || "");
    if (
      Number.isInteger(targetRowId) &&
      targetRowId > 0 &&
      targetRowId !== sourceRowId
    ) {
      setPlanningRowDropTarget(
        candidateEl,
        containerEl,
        resolvePlanningRowDropPosition(candidateEl, clientY)
      );
      return;
    }
  }

  if (
    candidateEl instanceof HTMLElement &&
    candidateEl.classList.contains("zone-header-band")
  ) {
    setPlanningZoneDropTarget(candidateEl, containerEl);
    return;
  }

  clearPlanningRowDropTarget(containerEl);
}

function setPlanningDropPreviewRow(rowEl) {
  if (activePlanningDropPreviewRowEl === rowEl) return;

  if (activePlanningDropPreviewRowEl && activePlanningDropPreviewRowEl.isConnected) {
    activePlanningDropPreviewRowEl.classList.remove("is-planning-drop-placement-row");
  }
  if (activePlanningDropPreviewLabelEl && activePlanningDropPreviewLabelEl.isConnected) {
    activePlanningDropPreviewLabelEl.classList.remove("is-planning-drop-placement-label");
  }

  activePlanningDropPreviewRowEl = rowEl instanceof HTMLElement ? rowEl : null;
  if (activePlanningDropPreviewRowEl) {
    activePlanningDropPreviewRowEl.classList.add("is-planning-drop-placement-row");
    activePlanningDropPreviewLabelEl =
      activePlanningDropPreviewRowEl.closest(".vis-label") instanceof HTMLElement
        ? activePlanningDropPreviewRowEl.closest(".vis-label")
        : null;
    if (activePlanningDropPreviewLabelEl) {
      activePlanningDropPreviewLabelEl.classList.add("is-planning-drop-placement-label");
    }
  } else {
    activePlanningDropPreviewLabelEl = null;
  }
}

function setPlanningRowDropTarget(rowEl, containerEl, position = "after") {
  if (!(containerEl instanceof HTMLElement)) return;
  containerEl.classList.add("is-planning-row-drop-active");

  if (!(rowEl instanceof HTMLElement)) {
    if (activePlanningDropRowEl || activePlanningDropZoneEl) {
      clearPlanningRowDropTarget(containerEl);
      containerEl.classList.add("is-planning-row-drop-active");
    }
    return;
  }

  const normalizedPosition = normalizePlanningDropPosition(position);
  if (
    activePlanningDropRowEl === rowEl &&
    activePlanningDropPosition === normalizedPosition
  ) {
    return;
  }

  clearPlanningRowDropTarget(containerEl);
  containerEl.classList.add("is-planning-row-drop-active");
  rowEl.classList.add("is-planning-row-drop-target");
  rowEl.classList.add(
    normalizedPosition === "before"
      ? "is-planning-row-drop-before"
      : "is-planning-row-drop-after"
  );
  activePlanningDropRowEl = rowEl;
  activePlanningDropPosition = normalizedPosition;
  setPlanningDropPreviewRow(rowEl);
  setPlanningDropPlacementOverlay(rowEl, containerEl, normalizedPosition);
}

function setPlanningZoneDropTarget(zoneEl, containerEl) {
  if (!(containerEl instanceof HTMLElement)) return;
  containerEl.classList.add("is-planning-row-drop-active");

  if (!(zoneEl instanceof HTMLElement)) {
    if (activePlanningDropRowEl || activePlanningDropZoneEl) {
      clearPlanningRowDropTarget(containerEl);
      containerEl.classList.add("is-planning-row-drop-active");
    }
    return;
  }

  if (activePlanningDropZoneEl === zoneEl) return;

  clearPlanningRowDropTarget(containerEl);
  containerEl.classList.add("is-planning-row-drop-active");
  zoneEl.classList.add("is-planning-zone-drop-target");
  activePlanningDropZoneEl = zoneEl;
  const previewRow = findPlanningZonePreviewRow(zoneEl, containerEl);
  setPlanningDropPreviewRow(previewRow);
  setPlanningDropPlacementOverlay(
    previewRow || zoneEl,
    containerEl,
    previewRow ? "before" : "after"
  );
}

function findZoneHeaderBandElement(containerEl, zoneKey = "", zoneLabel = "") {
  if (!(containerEl instanceof HTMLElement)) return null;
  const bands = containerEl.querySelectorAll(".zone-header-band");
  if (!bands.length) return null;

  const normalizedZoneKey = String(zoneKey ?? "").trim();
  const normalizedZoneLabel = String(zoneLabel ?? "").trim().toLocaleLowerCase("fr");

  for (const band of bands) {
    if (!(band instanceof HTMLElement)) continue;
    const bandZoneKey = String(band.dataset.planningZoneKey || "").trim();
    if (normalizedZoneKey && bandZoneKey === normalizedZoneKey) {
      return band;
    }
  }

  for (const band of bands) {
    if (!(band instanceof HTMLElement)) continue;
    const bandZoneLabel = String(
      band.dataset.planningZoneLabel || band.textContent || ""
    )
      .trim()
      .toLocaleLowerCase("fr");
    if (normalizedZoneLabel && bandZoneLabel === normalizedZoneLabel) {
      return band;
    }
  }

  return null;
}

function findPlanningZonePreviewRow(zoneEl, containerEl) {
  if (!(zoneEl instanceof HTMLElement) || !(containerEl instanceof HTMLElement)) return null;

  const orderedTargets = getPlanningDropCandidateElements(containerEl);
  const zoneIndex = orderedTargets.findIndex((el) => el === zoneEl);
  if (zoneIndex < 0) return null;

  for (let i = zoneIndex + 1; i < orderedTargets.length; i += 1) {
    const candidate = orderedTargets[i];
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate.classList.contains("zone-header-band")) {
      return null;
    }
    if (candidate.classList.contains("group-row-grid")) {
      return candidate;
    }
  }

  return null;
}

function resolvePlanningZoneDropTarget(targetEl, containerEl, eventLike = null) {
  const targetFromPointer = findPlanningDropCandidateAtClientY(
    containerEl,
    getPlanningDropEventClientY(eventLike)
  );
  if (
    targetFromPointer instanceof HTMLElement &&
    targetFromPointer.classList.contains("zone-header-band")
  ) {
    return {
      zoneKey: String(targetFromPointer.dataset.planningZoneKey || "").trim(),
      zoneLabel: String(
        targetFromPointer.dataset.planningZoneLabel || targetFromPointer.textContent || ""
      ).trim(),
      zoneEl: targetFromPointer,
    };
  }

  if (targetEl instanceof Element) {
    const zoneBand = targetEl.closest(".zone-header-band");
    if (zoneBand instanceof HTMLElement && containerEl.contains(zoneBand)) {
      return {
        zoneKey: String(zoneBand.dataset.planningZoneKey || "").trim(),
        zoneLabel: String(zoneBand.dataset.planningZoneLabel || zoneBand.textContent || "").trim(),
        zoneEl: zoneBand,
      };
    }
  }

  if (
    timelineInstance &&
    typeof timelineInstance.getEventProperties === "function" &&
    groupsDataSet &&
    eventLike
  ) {
    const props = timelineInstance.getEventProperties(eventLike);
    const groupId = props?.group;
    if (groupId != null) {
      const group =
        groupsDataSet.get(groupId) ||
        groupsDataSet.get(String(groupId)) ||
        groupsDataSet.get(Number(groupId)) ||
        null;

      if (group?.isZoneHeader) {
        const zoneKey = String(group?.meta?.zoneKey || group?.zoneKey || "").trim();
        const zoneLabel = String(group?.zoneLabel || "").trim();
        return {
          zoneKey,
          zoneLabel,
          zoneEl: findZoneHeaderBandElement(containerEl, zoneKey, zoneLabel),
        };
      }
    }
  }

  return null;
}

function bindPlanningRowDrop(containerEl) {
  if (!(containerEl instanceof HTMLElement) || planningRowDropBound) return;
  planningRowDropBound = true;

  containerEl.addEventListener("dragover", (event) => {
    if (!hasPlanningRowPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    updatePlanningDragAutoScrollFromPointer(event.clientX, event.clientY);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const payload = extractPlanningRowPayloadFromDataTransfer(event.dataTransfer);
    if (!payload) {
      clearPlanningRowDropTarget(containerEl);
      return;
    }

    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);
    const targetRowId = Number(rowEl?.dataset?.planningRowId || "");
    const isValidRowTarget =
      rowEl instanceof HTMLElement &&
      Number.isInteger(targetRowId) &&
      targetRowId > 0 &&
      targetRowId !== payload.rowId;

    if (isValidRowTarget) {
      const targetDropPosition = resolvePlanningRowDropPosition(rowEl, event.clientY);
      setPlanningRowDropTarget(rowEl, containerEl, targetDropPosition);
      return;
    }

    const zoneTarget = resolvePlanningZoneDropTarget(targetEl, containerEl, event);
    const zoneLabel = String(zoneTarget?.zoneLabel || "").trim();
    if (zoneLabel) {
      setPlanningZoneDropTarget(zoneTarget?.zoneEl, containerEl);
      return;
    }

    setPlanningRowDropTarget(null, containerEl);
  });

  containerEl.addEventListener("dragleave", (event) => {
    if (!containerEl.classList.contains("is-planning-row-drop-active")) return;
    const rect = containerEl.getBoundingClientRect();
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    const outsideContainer =
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom;

    if (outsideContainer) {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    }
  });

  containerEl.addEventListener("drop", async (event) => {
    if (!hasPlanningRowPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();

    const payload = extractPlanningRowPayloadFromDataTransfer(event.dataTransfer);
    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);
    const targetRowId = Number(rowEl?.dataset?.planningRowId || "");
    const zoneTarget = resolvePlanningZoneDropTarget(targetEl, containerEl, event);
    const targetZoneLabel = String(zoneTarget?.zoneLabel || "").trim();
    const isValidRowTarget =
      rowEl instanceof HTMLElement &&
      Number.isInteger(targetRowId) &&
      targetRowId > 0 &&
      targetRowId !== payload?.rowId;
    const targetDropPosition = isValidRowTarget
      ? resolvePlanningRowDropPosition(rowEl, event.clientY)
      : "";

    if (!payload || (!isValidRowTarget && !targetZoneLabel)) {
      clearPlanningRowDropTarget(containerEl);
      return;
    }

    if (isValidRowTarget) {
      setPlanningRowDropTarget(rowEl, containerEl, targetDropPosition);
      rowEl.classList.add("is-planning-row-drop-committing");
    } else {
      setPlanningZoneDropTarget(zoneTarget?.zoneEl, containerEl);
      if (activePlanningDropZoneEl instanceof HTMLElement) {
        activePlanningDropZoneEl.classList.add("is-planning-zone-drop-committing");
      }
    }

    try {
      if (typeof planningRowDropHandler === "function") {
        await planningRowDropHandler({
          sourcePlanningRowId: payload.rowId,
          targetPlanningRowId: isValidRowTarget ? targetRowId : null,
          payload,
          targetTask: isValidRowTarget
            ? String(rowEl.querySelector(".cell-task")?.textContent || "").trim()
            : "",
          targetGroupe: isValidRowTarget ? String(rowEl.dataset.planningGroupe || "").trim() : "",
          targetDropPosition: targetDropPosition || "",
          targetZone: isValidRowTarget
            ? String(rowEl.dataset.planningZone || "").trim()
            : targetZoneLabel,
          targetZoneKey: String(zoneTarget?.zoneKey || "").trim(),
        });
      }
    } catch (error) {
      console.error("Erreur drop Planning -> Planning :", error);
    } finally {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    }
  });

  window.addEventListener(
    "dragend",
    () => {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    },
    true
  );

  window.addEventListener(
    "drop",
    () => {
      clearPlanningRowDropTarget(containerEl);
      stopPlanningDragAutoScroll();
    },
    true
  );
}

function hasMsProjectPayloadType(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  if (
    types.includes("application/x-planning-row") ||
    types.includes("text/x-planning-row")
  ) {
    return false;
  }
  return (
    types.includes("application/x-ms-project-row") ||
    types.includes("application/json") ||
    types.includes("text/plain")
  );
}

function setMsProjectGlobalDragCursor(active) {
  const nextState = Boolean(active);
  if (msProjectGlobalDragCursorActive === nextState) return;
  msProjectGlobalDragCursorActive = nextState;
  document.body?.classList.toggle("is-ms-project-drag-cursor", nextState);
  document.documentElement?.classList.toggle("is-ms-project-drag-cursor", nextState);
}

function extractMsProjectPayloadFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return null;

  const readData = (mimeType) => {
    try {
      return dataTransfer.getData(mimeType);
    } catch (error) {
      return "";
    }
  };

  const rawPayload =
    readData("application/x-ms-project-row") || readData("application/json");
  if (!rawPayload) return null;

  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || parsed.type !== "ms-project-row") return null;
    const uniqueNumber = String(parsed.uniqueNumber ?? "").trim();
    if (!uniqueNumber) return null;
    return {
      ...parsed,
      uniqueNumber,
    };
  } catch (error) {
    const plainText = String(readData("text/plain") ?? "").trim();
    if (!plainText || !/^\d{1,20}$/.test(plainText)) {
      return null;
    }

    return {
      type: "ms-project-row",
      rowId: null,
      uniqueNumber: plainText,
      task: "",
      startIso: "",
      endIso: "",
    };
  }
}

function clearMsProjectDropTarget(containerEl = null) {
  if (activeMsDropRowEl && activeMsDropRowEl.isConnected) {
    activeMsDropRowEl.classList.remove("is-ms-drop-target", "is-ms-drop-committing");
  }
  if (activeMsDropCellEl && activeMsDropCellEl.isConnected) {
    activeMsDropCellEl.classList.remove(
      "is-ms-drop-target-cell",
      "is-ms-drop-committing-cell"
    );
  }

  activeMsDropRowEl = null;
  activeMsDropCellEl = null;

  const effectiveContainer =
    containerEl instanceof HTMLElement
      ? containerEl
      : document.getElementById("planningTimeline");
  if (effectiveContainer instanceof HTMLElement) {
    effectiveContainer.classList.remove("is-ms-drop-active");
  }
  setMsProjectGlobalDragCursor(false);
}

function setMsProjectDropTarget(rowEl, containerEl) {
  if (!(containerEl instanceof HTMLElement)) return;
  containerEl.classList.add("is-ms-drop-active");
  setMsProjectGlobalDragCursor(true);

  if (!(rowEl instanceof HTMLElement)) {
    if (activeMsDropRowEl || activeMsDropCellEl) {
      clearMsProjectDropTarget(containerEl);
      containerEl.classList.add("is-ms-drop-active");
    }
    return;
  }

  if (activeMsDropRowEl === rowEl) return;
  clearMsProjectDropTarget(containerEl);
  containerEl.classList.add("is-ms-drop-active");

  rowEl.classList.add("is-ms-drop-target");
  activeMsDropRowEl = rowEl;

  const lineCell = rowEl.querySelector(".cell-ligne-planning");
  if (lineCell instanceof HTMLElement) {
    lineCell.classList.add("is-ms-drop-target-cell");
    activeMsDropCellEl = lineCell;
  }
}

function resolvePlanningRowDropTarget(targetEl, containerEl, eventLike = null) {
  const targetFromPointer = findPlanningDropCandidateAtClientY(
    containerEl,
    getPlanningDropEventClientY(eventLike)
  );
  if (
    targetFromPointer instanceof HTMLElement &&
    targetFromPointer.classList.contains("group-row-grid")
  ) {
    const pointerRowId = Number(targetFromPointer.dataset.planningRowId || "");
    if (Number.isInteger(pointerRowId) && pointerRowId > 0) {
      return targetFromPointer;
    }
  }

  if (targetEl instanceof Element) {
    const rowEl = targetEl.closest(".group-row-grid");
    if (rowEl instanceof HTMLElement && containerEl.contains(rowEl)) {
      const rowId = Number(rowEl.dataset.planningRowId || "");
      if (Number.isInteger(rowId) && rowId > 0) {
        return rowEl;
      }
    }
  }

  if (
    timelineInstance &&
    typeof timelineInstance.getEventProperties === "function" &&
    groupsDataSet &&
    eventLike
  ) {
    const props = timelineInstance.getEventProperties(eventLike);
    const groupId = props?.group;
    if (groupId != null) {
      const group =
        groupsDataSet.get(groupId) ||
        groupsDataSet.get(String(groupId)) ||
        groupsDataSet.get(Number(groupId)) ||
        null;
      const rowId = Number(group?.rowId || "");
      if (Number.isInteger(rowId) && rowId > 0) {
        const fallbackRow = containerEl.querySelector(
          `.group-row-grid[data-planning-row-id="${rowId}"]`
        );
        if (fallbackRow instanceof HTMLElement) {
          return fallbackRow;
        }
      }
    }
  }

  return null;
}

function bindMsProjectRowDrop(containerEl) {
  if (!(containerEl instanceof HTMLElement) || msProjectDropBound) return;
  msProjectDropBound = true;

  window.addEventListener(
    "dragenter",
    (event) => {
      if (!hasMsProjectPayloadType(event.dataTransfer)) return;
      setMsProjectGlobalDragCursor(true);
    },
    true
  );

  window.addEventListener(
    "dragover",
    (event) => {
      if (!hasMsProjectPayloadType(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setMsProjectGlobalDragCursor(true);
    },
    true
  );

  containerEl.addEventListener("dragover", (event) => {
    if (!hasMsProjectPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }

    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);
    setMsProjectDropTarget(rowEl, containerEl);
  });

  containerEl.addEventListener("dragleave", (event) => {
    if (!containerEl.classList.contains("is-ms-drop-active")) return;
    const rect = containerEl.getBoundingClientRect();
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    const outsideContainer =
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom;

    if (outsideContainer) {
      clearMsProjectDropTarget(containerEl);
    }
  });

  containerEl.addEventListener("drop", async (event) => {
    if (!hasMsProjectPayloadType(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();

    const payload = extractMsProjectPayloadFromDataTransfer(event.dataTransfer);
    const targetEl = event.target instanceof Element ? event.target : null;
    const rowEl = resolvePlanningRowDropTarget(targetEl, containerEl, event);

    if (!(rowEl instanceof HTMLElement) || !payload) {
      clearMsProjectDropTarget(containerEl);
      return;
    }

    const planningRowId = Number(rowEl.dataset.planningRowId || "");
    if (!Number.isInteger(planningRowId) || planningRowId <= 0) {
      clearMsProjectDropTarget(containerEl);
      return;
    }

    setMsProjectDropTarget(rowEl, containerEl);
    rowEl.classList.add("is-ms-drop-committing");
    const lineCell = rowEl.querySelector(".cell-ligne-planning");
    if (lineCell instanceof HTMLElement) {
      lineCell.classList.add("is-ms-drop-committing-cell");
    }

    try {
      if (typeof msProjectRowDropHandler === "function") {
        await msProjectRowDropHandler({
          planningRowId,
          uniqueNumber: payload.uniqueNumber,
          payload,
          targetTask: String(rowEl.querySelector(".cell-task")?.textContent || "").trim(),
        });
      }
    } catch (error) {
      console.error("Erreur drop MS Project vers Planning :", error);
    } finally {
      clearMsProjectDropTarget(containerEl);
    }
  });

  window.addEventListener(
    "dragend",
    () => {
      clearMsProjectDropTarget(containerEl);
    },
    true
  );

  window.addEventListener(
    "drop",
    () => {
      clearMsProjectDropTarget(containerEl);
    },
    true
  );
}

function buildGroupLabelElement(group) {
  if (group?.isZoneHeader) {
    const zoneBand = document.createElement("div");
    zoneBand.className = "zone-header-band";
    zoneBand.dataset.planningZoneKey = String(group?.meta?.zoneKey || group?.zoneKey || "");
    zoneBand.dataset.planningZoneLabel = String(group?.zoneLabel || "");
    zoneBand.textContent = String(group?.zoneHeaderLabel ?? "");
    return zoneBand;
  }

  const row = document.createElement("div");
  row.className = "group-row-grid";
  row.classList.add("planning-draggable-row");
  row.draggable = true;
  row.setAttribute("draggable", "true");
  row.dataset.planningRowId = String(group?.rowId ?? "");
  row.dataset.planningGroupId = String(group?.id ?? "");
  row.dataset.planningId2 = String(group?.id2Label ?? "");
  row.dataset.planningTask = String(group?.tachesLabel ?? "");
  row.dataset.planningGroupe = String(group?.groupeLabel ?? "");
  row.dataset.planningZone = String(group?.zoneLabel ?? "");
  row.dataset.planningLignePlanning = String(group?.lignePlanningLabel ?? "");
  row.dataset.planningTypeDoc = String(group?.typeDocLabel ?? "");
  row.dataset.planningStartIso = String(group?.debutIso ?? "");
  row.dataset.planningEndIso = String(group?.finIso ?? "");
  row.dataset.planningDemarrageIso = String(group?.demarrageIso ?? "");
  row.dataset.planningIndice = String(group?.indiceLabel ?? "");
  row.dataset.planningRealise = String(group?.realiseLabel ?? "");
  row.dataset.planningRetards = String(group?.retardsLabel ?? "");
  if (String(group?.typeDocLabel ?? "").toUpperCase().includes("COFFRAGE")) {
    row.classList.add("row-type-coffrage");
  }

  const id2 = document.createElement("div");
  id2.className = "cell-id2";
  id2.textContent = String(group?.id2Label ?? "");

  const tache = document.createElement("div");
  tache.className = "cell-task";
  tache.textContent = String(group?.tachesLabel ?? "");

  const lignePlanning = document.createElement("div");
  lignePlanning.className = "cell-ligne-planning";
  lignePlanning.textContent = String(group?.lignePlanningLabel ?? "");
  lignePlanning.dataset.planningRowId = String(group?.rowId ?? "");

  const debut = document.createElement("div");
  debut.className = "cell-start";
  debut.textContent = String(group?.debutLabel ?? "");

  const dureeDebutFin = document.createElement("div");
  dureeDebutFin.className = "cell-duration-1";
  dureeDebutFin.textContent = String(group?.dureeDebutFinLabel ?? "");
  dureeDebutFin.dataset.rowId = String(group?.rowId ?? "");
  dureeDebutFin.dataset.durationSlot = "1";
  dureeDebutFin.dataset.typeDoc = String(group?.typeDocLabel ?? "");
  dureeDebutFin.dataset.durationValue = String(group?.dureeDebutFinLabel ?? "");
  dureeDebutFin.dataset.durationColumnKey = String(
    group?.dureeDebutFinColumnKey ?? ""
  );
  dureeDebutFin.dataset.leftDateColumnKey = String(
    group?.dureeDebutFinLeftDateColumnKey ?? ""
  );
  dureeDebutFin.dataset.rightIsoDate = String(group?.dureeDebutFinRightIso ?? "");
  if (group?.dureeDebutFinEditable) {
    dureeDebutFin.classList.add("editable-duration-cell");
    dureeDebutFin.title = "Cliquer pour modifier la durée";
  }

  const fin = document.createElement("div");
  fin.className = "cell-end";
  fin.textContent = String(group?.finLabel ?? "");

  const dureeFinDemarrage = document.createElement("div");
  dureeFinDemarrage.className = "cell-duration-2";
  dureeFinDemarrage.textContent = String(group?.dureeFinDemarrageLabel ?? "");
  dureeFinDemarrage.dataset.rowId = String(group?.rowId ?? "");
  dureeFinDemarrage.dataset.durationSlot = "2";
  dureeFinDemarrage.dataset.typeDoc = String(group?.typeDocLabel ?? "");
  dureeFinDemarrage.dataset.durationValue = String(
    group?.dureeFinDemarrageLabel ?? ""
  );
  dureeFinDemarrage.dataset.durationColumnKey = String(
    group?.dureeFinDemarrageColumnKey ?? ""
  );
  dureeFinDemarrage.dataset.leftDateColumnKey = String(
    group?.dureeFinDemarrageLeftDateColumnKey ?? ""
  );
  dureeFinDemarrage.dataset.rightIsoDate = String(
    group?.dureeFinDemarrageRightIso ?? ""
  );
  if (group?.dureeFinDemarrageEditable) {
    dureeFinDemarrage.classList.add("editable-duration-cell");
    dureeFinDemarrage.title = "Cliquer pour modifier la durée";
  }

  const demarrage = document.createElement("div");
  demarrage.className = "cell-demarrage";
  demarrage.textContent = String(group?.demarrageLabel ?? "");

  const indice = document.createElement("div");
  indice.className = "cell-indice";
  indice.textContent = String(group?.indiceLabel ?? "");

  const realise = document.createElement("div");
  realise.className = "cell-realise";
  realise.textContent = String(group?.realiseLabel ?? "");

  const retards = document.createElement("div");
  retards.className = "cell-retards";
  retards.textContent = String(group?.retardsLabel ?? "");

  [
    id2,
    tache,
    lignePlanning,
    debut,
    dureeDebutFin,
    fin,
    dureeFinDemarrage,
    demarrage,
    indice,
    realise,
    retards,
  ].forEach((cellEl) => {
    cellEl.setAttribute("draggable", "true");
  });

  row.addEventListener("dragstart", (event) => {
    handlePlanningNativeDragStart(event, row);
  });

  row.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
  });

  row.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
  });

  row.append(
    id2,
    tache,
    lignePlanning,
    debut,
    dureeDebutFin,
    fin,
    dureeFinDemarrage,
    demarrage,
    indice,
    realise,
    retards
  );
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
    if (item?.type === "background") continue;

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

function buildDateRangeDisplayText(startDate, endDate, availableWidth = Infinity) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return "";
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return "";

  const full = [
    startDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    endDate.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  ].join(" - ");

  const medium = [
    startDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  ].join(" - ");

  const compact = [
    startDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }),
  ].join(" - ");

  const minimal = [
    startDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }),
    endDate.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }),
  ].join(" - ");

  if (availableWidth >= 340) return full;
  if (availableWidth >= 255) return medium;
  if (availableWidth >= 185) return compact;
  return minimal;
}

function updateDateRangeDisplay() {
  if (!timelineInstance) return;

  const el = document.getElementById("current-date-range");
  if (!el) return;

  const range = timelineInstance.getWindow();
  const availableWidth = Math.max(
    0,
    Math.round(el.getBoundingClientRect().width || el.clientWidth || 0)
  );
  const fullText = buildDateRangeDisplayText(range.start, range.end, Number.MAX_SAFE_INTEGER);
  const displayText = buildDateRangeDisplayText(range.start, range.end, availableWidth);

  el.textContent = displayText || fullText;
  el.title = fullText;
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

function getVisibleDaysFromRange(range) {
  if (!range?.start || !range?.end) {
    return 0;
  }

  const startMs = range.start.valueOf();
  const endMs = range.end.valueOf();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }

  return Math.max(1, Math.ceil((endMs - startMs) / 86400000));
}

function emitPlanningViewportChange(reason = "") {
  const viewport = getPlanningViewportState();
  if (!viewport) {
    return;
  }

  planningViewportListeners.forEach((listener) => {
    listener(viewport, { reason });
  });
}

export function getPlanningViewportState() {
  if (!timelineInstance) {
    return null;
  }

  const range = timelineInstance.getWindow();
  const anchorDate = getWindowCenterDate();
  const firstVisibleDate = toIsoDateValue(range.start);
  const visibleDays = getVisibleDaysFromRange(range);

  return {
    mode: getCurrentZoomMode(),
    anchorDate: toIsoDateValue(anchorDate),
    firstVisibleDate,
    visibleDays,
    rangeStartDate: firstVisibleDate,
    rangeEndDate: shiftIsoDateValue(firstVisibleDate, visibleDays - 1),
  };
}

export function applyPlanningViewportState(viewport = {}) {
  if (!timelineInstance) {
    return;
  }

  const nextMode = String(viewport.mode || "").trim() || getCurrentZoomMode();
  const nextStartDate = String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim();
  const nextVisibleDays = EMBEDDED_PLANNING_SYNC_MODE
    ? clampPlanningVisibleDaysToBounds(
        Number(viewport.visibleDays),
        normalizePlanningViewportBounds(viewport.viewportBounds || embeddedPlanningViewportBounds)
      )
    : Number(viewport.visibleDays);
  const nextEndDate =
    nextStartDate && Number.isFinite(nextVisibleDays) && nextVisibleDays > 0
      ? shiftIsoDateValue(nextStartDate, Math.round(nextVisibleDays) - 1)
      : String(viewport.rangeEndDate || "").trim();
  const nextAnchorDate = String(viewport.anchorDate || "").trim();

  if (nextMode) {
    setActiveZoomButton(nextMode);
  }

  if (nextStartDate && nextEndDate) {
    const start = new Date(`${nextStartDate}T00:00:00`);
    const end = new Date(`${nextEndDate}T23:59:59.999`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      timelineInstance.setWindow(start, end, { animation: false });
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      updateCurrentTimeLineBounds();
      requestStickyAxisSync();
      return;
    }
  }

  const anchorDate = nextAnchorDate
    ? new Date(`${nextAnchorDate}T12:00:00`)
    : getWindowCenterDate();

  if (!Number.isNaN(anchorDate.getTime())) {
    setWindowForMode(nextMode, anchorDate);
    updateNavCenterButtonLabel();
    updateCurrentTimeLineBounds();
    requestStickyAxisSync();
  }
}

export function setPlanningViewportBounds(bounds = {}) {
  embeddedPlanningViewportBounds = normalizePlanningViewportBounds(bounds);

  if (timelineInstance) {
    const zoomMinMs = embeddedPlanningViewportBounds.minVisibleDays * 86400000;
    const zoomMaxMs = embeddedPlanningViewportBounds.maxVisibleDays * 86400000;
    timelineInstance.setOptions({
      zoomMin: zoomMinMs,
      zoomMax: zoomMaxMs,
    });
    enforceEmbeddedPlanningViewportBounds();
  }
}

export function subscribePlanningViewportChanges(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  planningViewportListeners.add(listener);
  return () => {
    planningViewportListeners.delete(listener);
  };
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

export function setPlanningDurationEditHandler(handler) {
  durationCellEditHandler = typeof handler === "function" ? handler : null;
}

export function setPlanningMsProjectDropHandler(handler) {
  msProjectRowDropHandler = typeof handler === "function" ? handler : null;
}

export function setPlanningRowDropHandler(handler) {
  planningRowDropHandler = typeof handler === "function" ? handler : null;
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
        item: { horizontal: 2, vertical: 0 },
        axis: 0,
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
    bindDurationCellEditing(container);
    bindMsProjectRowDrop(container);
    bindPlanningRowDragging(container);
    bindPlanningRowDrop(container);
    bindStickyTimelineAxis();
  }

  // Mise à jour datasets
  groupsDataSet.clear();
  itemsDataSet.clear();

  groupsDataSet.add(groups || []);
  itemsDataSet.add(items || []);

  // Recalage automatique sur les dates des données
  requestAnimationFrame(() => {
    timelineInstance.redraw();
    decorateRenderedTimelineItems(container);
    syncNativeItemTitles(container);
    bindItemHoverInteractions(container);

    const range = computeRange(items || []);
    const hasNonBackgroundItems = (items || []).some(
      (item) => item?.type !== "background"
    );
    if (EMBEDDED_PLANNING_SYNC_MODE) {
      if (range) {
        dataAnchorDate = computeRangeCenter(range);
      } else if (hasNonBackgroundItems) {
        const fitted = timelineInstance.getWindow();
        dataAnchorDate = computeRangeCenter(fitted);
      } else if ((groups || []).length) {
        dataAnchorDate = new Date();
      } else {
        dataAnchorDate = null;
      }
    } else if (range) {
      dataAnchorDate = computeRangeCenter(range);
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if (hasNonBackgroundItems) {
      timelineInstance.fit({ animation: false });
      const fitted = timelineInstance.getWindow();
      dataAnchorDate = computeRangeCenter(fitted);
    } else if ((groups || []).length) {
      const today = new Date();
      const start = new Date(today);
      const end = new Date(today);
      start.setDate(start.getDate() - 7);
      end.setDate(end.getDate() + 7);
      dataAnchorDate = today;
      timelineInstance.setWindow(start, end, { animation: false });
    } else {
      dataAnchorDate = null;
    }

    updateDateRangeDisplay();
    updateNavCenterButtonLabel();
    updateCurrentTimeLineBounds();
    requestStickyAxisSync();
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
      if (enforceEmbeddedPlanningViewportBounds()) {
        return;
      }
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      updateCurrentTimeLineBounds();
    });
    timelineInstance.on("rangechanged", () => {
      if (enforceEmbeddedPlanningViewportBounds()) {
        return;
      }
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      updateCurrentTimeLineBounds();
      emitPlanningViewportChange("rangechanged");
    });
  }

  // Initialisation affichage
  updateNavCenterButtonLabel();
  updateDateRangeDisplay();
  window.addEventListener("resize", () => {
    updateDateRangeDisplay();
  });
}

export function clearPlanningTimeline() {
  if (!timelineInstance || !groupsDataSet || !itemsDataSet) return;

  groupsDataSet.clear();
  itemsDataSet.clear();

  const rangeEl = document.getElementById("current-date-range");
  if (rangeEl) {
    rangeEl.textContent = "";
    rangeEl.removeAttribute("title");
  }

  hideHoverTooltip();
  clearMsProjectDropTarget();
  clearPlanningRowDropTarget();
  clearPlanningRowDraggingState();
}
