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

function buildGroupLabelElement(group) {
  if (group?.isZoneHeader) {
    const zoneBand = document.createElement("div");
    zoneBand.className = "zone-header-band";
    zoneBand.textContent = String(group?.zoneHeaderLabel ?? "");
    return zoneBand;
  }

  const row = document.createElement("div");
  row.className = "group-row-grid";
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

  const retards = document.createElement("div");
  retards.className = "cell-retards";
  retards.textContent = String(group?.retardsLabel ?? "");

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

export function setPlanningDurationEditHandler(handler) {
  durationCellEditHandler = typeof handler === "function" ? handler : null;
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
    bindDurationCellEditing(container);
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
    if (range) {
      dataAnchorDate = computeRangeCenter(range);
      timelineInstance.setWindow(range.start, range.end, { animation: false });
    } else if ((items || []).length) {
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
      updateCurrentTimeLineBounds();
    });
    timelineInstance.on("rangechanged", () => {
      updateDateRangeDisplay();
      updateNavCenterButtonLabel();
      updateCurrentTimeLineBounds();
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
