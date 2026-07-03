// Charge-plan grid render — editable bottom pane for planning-synchro.
// Ported/adapted from `gestion-depenses2/assets/js/ui/chargeTimeline.js`
// (buildVisibleSlots, getMonthWidth, getTimelineViewportWidth, renderTrackGrid,
// buildVisibleSegmentBars, assignSegmentLanes, renderSegmentBars, renderRoleRow,
// renderWorkerRow, renderTimelineEditToolbar, and the context-menu/selection-preview
// DOM) and `gestion-depenses2/assets/js/services/projectService.js`
// (groupWorkersByRole role-bucket logic, ~lines 287-323, 822-847).
//
// KEY ADAPTATIONS vs the source (see task-11 brief):
// 1. Arithmetic day width only: dayWidth = timelineViewportWidth / visibleDays,
//    where timelineViewportWidth is the timeline column's measured content
//    width and visibleDays comes from the shared canonical viewport
//    ({ mode, firstVisibleDate, rangeStartDate, rangeEndDate, anchorDate,
//    visibleDays }). The source's "embedded planning-sync" CSS-var branch
//    (--sync-planning-reference-day-width / getEmbeddedPlanningReference*) is
//    dropped entirely: this widget has no iframe host to read those vars from,
//    and Task 13's controller drives both panes off the same arithmetic
//    width/day math (sync/viewportMath.js's getDayBoundaryLeftPx), so only the
//    non-embedded path is kept.
// 2. Roles-only header: no renderTimelineControls (date-picker/zoom buttons),
//    no "Vue/Aujourd'hui" controls, no renderTotalRow / "Total jours" column,
//    no header month band. Only role section rows (renderRoleRow) + worker
//    rows + a left "name" column remain; the shared toolbar (Task 13/14)
//    drives the window.
// 3. Exact-window rendering: the source lays out whole calendar months (sized
//    so their total day count approximates visibleDays) via getMonthWidth,
//    then derives a per-day width back out of each month's pixel width - which
//    is mathematically just `timelineViewportWidth / visibleDays` again, since
//    every month is sized as `dayWidth * month.calendarDayCount` up front. This
//    port skips that redundant month round-trip: buildWindowDays() calls
//    buildDisplayedMonths() for the month span touching the window (as
//    instructed) and then filters its calendarDayDates down to exactly
//    [viewport.firstVisibleDate .. viewport.rangeEndDate] (visibleDays
//    consecutive calendar days), so day index N's left edge is always
//    N * (contentWidth / visibleDays) - matching sync/viewportMath.js's
//    getDayBoundaryLeftPx exactly. A literal getMonthWidth/month-grouped
//    render would either spill days outside the window (if unfiltered) or
//    require the same filtering anyway, so no separate getMonthWidth is kept.
// 4. No worker.id: workers are grouped-by-name TimeSegment rows (no stable
//    numeric id on the worker itself), so segment-bar/track DOM carries
//    data-worker-name instead of the source's data-worker-id; Task 12 keys
//    edits off Name + segment id.
// 5. groupWorkersByRole here buckets into exactly 3 canonical labels
//    (Projeteurs/Ingenieurs/Autres) via a normalized-role substring match
//    (adapted from the source's getRoleDisplayOrder sort helper), instead of
//    the source's literal per-role-string grouping (worker.role as-is, "Sans
//    role" fallback) - the task brief calls for a fixed roles-only header.
// 6. planningTaskCount / cross-referencing segment bars against Planning
//    Projet tasks (source's countPlanningTasksOverlappingRange + tooltip) is
//    dropped: render() has no planningTasks input in this widget's contract.
//
// DOM module: document/window are only touched inside function bodies (no
// top-level access), so buildWorkersFromSegments/groupWorkersByRole import and
// run cleanly under Node (see tests/chargeWorkers.test.mjs); createChargeBoard()
// itself is browser-only and is verified by structural read-through + node
// --check here, browser-verified once Task 14 wires main.js (see task-11-report.md).

import { toFiniteNumber, formatNumber, buildDisplayedMonths } from "../utils/format.js";
import { parseDateTime, normalizeDecimal, toText, formatIsoDate, parseCalendarDate } from "../utils/dates.js";
import {
  HALF_DAY_PARTS,
  isBusinessDay,
  getHalfDaySlotRange,
  createHalfDaySlotKey,
  getSegmentEffectiveDays,
} from "../utils/timeSegments.js";
import { APP_CONFIG } from "../config.js";

const MIN_CONTENT_WIDTH_PX = 280;
const DEFAULT_NAME_COL_WIDTH_PX = 220;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDayValue(value) {
  const formatted = formatNumber(value);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

// --- worker building (pure) --------------------------------------------------

function normalizeNameKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Groups TimeSegment rows by Name into one worker per person, with role looked
// up from ProjectTeam by normalized-name match. `columns` mirrors
// APP_CONFIG.grist.columns' shape: { timeSegment: {...}, projectTeam: {...} }.
export function buildWorkersFromSegments(timeSegmentRows, projectTeamRows, columns) {
  const tsCols = columns?.timeSegment || {};
  const ptCols = columns?.projectTeam || {};

  const workersByNameKey = new Map();
  let segmentSeq = 0;

  // Seed EVERY connected team member first (even those with no TimeSegment), the
  // way gestion-depenses2 does (projectService.buildExpenseData): all people
  // linked to the project appear in the bottom pane; segments are attached below.
  (projectTeamRows || []).forEach((row) => {
    const name = toText(row?.[ptCols.name]);
    const nameKey = normalizeNameKey(name);
    if (!nameKey || workersByNameKey.has(nameKey)) return;
    workersByNameKey.set(nameKey, { name, role: toText(row?.[ptCols.role]) || "", segments: [] });
  });

  (timeSegmentRows || []).forEach((row) => {
    const name = toText(row?.[tsCols.name]);
    if (!name) return;

    const startAt = parseDateTime(row?.[tsCols.startDate]);
    const endAt = parseDateTime(row?.[tsCols.endDate]);
    if (!startAt || !endAt) return;

    const nameKey = normalizeNameKey(name);
    let worker = workersByNameKey.get(nameKey);
    if (!worker) {
      // A TimeSegment name absent from ProjectTeam still gets a row. Unknown role
      // ("") is bucketed into "Autres" by groupWorkersByRole.
      worker = { name, role: "", segments: [] };
      workersByNameKey.set(nameKey, worker);
    }

    worker.segments.push({
      id: row?.[tsCols.id] ?? `s-${segmentSeq++}`,
      startAt,
      endAt,
      allocationDays: normalizeDecimal(row?.[tsCols.allocationDays]) ?? 0,
      effectif: normalizeDecimal(row?.[tsCols.effectif]),
      label: toText(row?.[tsCols.label]),
    });
  });

  return [...workersByNameKey.values()];
}

// --- role grouping (pure, port of groupWorkersByRole) ------------------------

function normalizeRoleForGrouping(role) {
  return toText(role)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const OTHER_ROLE_GROUP_LABEL = "Autres";
const ROLE_GROUP_RULES = [
  { label: "Projeteurs", test: (normalized) => normalized.includes("projet") },
  { label: "Ingenieurs", test: (normalized) => normalized.includes("ingen") },
];
const ROLE_GROUP_ORDER = ["Projeteurs", "Ingenieurs", OTHER_ROLE_GROUP_LABEL];

function getRoleGroupLabel(role) {
  const normalized = normalizeRoleForGrouping(role);
  if (!normalized) return OTHER_ROLE_GROUP_LABEL;
  const rule = ROLE_GROUP_RULES.find((entry) => entry.test(normalized));
  return rule ? rule.label : OTHER_ROLE_GROUP_LABEL;
}

function compareWorkersByName(left, right) {
  return toText(left?.name).localeCompare(toText(right?.name), "fr", {
    sensitivity: "base",
    numeric: true,
  });
}

// Buckets workers into fixed role-group labels (Projeteurs/Ingenieurs/Autres),
// only including groups that actually have members, in that display order.
export function groupWorkersByRole(workers) {
  const buckets = {};
  (workers || []).forEach((worker) => {
    const label = getRoleGroupLabel(worker?.role);
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(worker);
  });

  const grouped = {};
  ROLE_GROUP_ORDER.forEach((label) => {
    if (buckets[label]) {
      grouped[label] = [...buckets[label]].sort(compareWorkersByName);
    }
  });
  return grouped;
}

// --- exact-window day enumeration ---------------------------------------------

// Returns Date[] for every calendar day in [viewport.firstVisibleDate ..
// viewport.rangeEndDate] inclusive, built via buildDisplayedMonths() over the
// month span touching the window then filtered down to the exact range.
function buildWindowDays(viewport) {
  const firstVisibleDate = parseCalendarDate(viewport?.firstVisibleDate);
  const rangeEndDate = parseCalendarDate(viewport?.rangeEndDate);
  if (!firstVisibleDate || !rangeEndDate || rangeEndDate < firstVisibleDate) {
    return [];
  }

  const monthSpan =
    rangeEndDate.getFullYear() * 12 +
    rangeEndDate.getMonth() -
    (firstVisibleDate.getFullYear() * 12 + firstVisibleDate.getMonth()) +
    1;
  const months = buildDisplayedMonths(
    firstVisibleDate.getFullYear(),
    firstVisibleDate.getMonth(),
    monthSpan,
    APP_CONFIG.months
  );

  const firstVisibleIso = formatIsoDate(firstVisibleDate);
  const rangeEndIso = formatIsoDate(rangeEndDate);
  const windowDays = [];
  months.forEach((month) => {
    (month.calendarDayDates || []).forEach((date) => {
      const iso = formatIsoDate(date);
      if (iso >= firstVisibleIso && iso <= rangeEndIso) {
        windowDays.push(date);
      }
    });
  });
  return windowDays;
}

// --- half-day slot math (port of buildVisibleSlots, arithmetic path only) ----

function buildVisibleSlots(windowDays, dayWidth) {
  const halfDayWidth = dayWidth / 2;
  const slots = [];

  windowDays.forEach((date, dayIndex) => {
    const isWorkingDay = isBusinessDay(date);
    HALF_DAY_PARTS.forEach((part, partIndex) => {
      const slotRange = getHalfDaySlotRange(date, part);
      if (!slotRange) return;

      slots.push({
        key: createHalfDaySlotKey(date, part),
        slotIndex: slots.length,
        dateKey: formatIsoDate(date),
        part,
        isWorkingDay,
        leftPx: dayIndex * dayWidth + partIndex * halfDayWidth,
        widthPx: halfDayWidth,
        startAt: slotRange.startAt,
        endAt: slotRange.endAt,
      });
    });
  });

  return slots;
}

// --- track grid (weekend shading), port of renderTrackGrid -------------------

function renderTrackGrid(windowDays, dayWidth) {
  const weekendSpans = windowDays
    .map((date, dayIndex) => {
      if (isBusinessDay(date)) return "";
      return `
        <span
          class="charge-plan-grid-day is-weekend"
          style="left:${dayIndex * dayWidth}px; width:${dayWidth}px"
          data-date-key="${formatIsoDate(date)}"
        ></span>
      `;
    })
    .join("");

  return `<div class="charge-plan-track-grid">${weekendSpans}</div>`;
}

// --- segment bars (port of buildVisibleSegmentBars / assignSegmentLanes / renderSegmentBars) ---

function getVisibleSlotRange(startAt, endAt, visibleSlots) {
  let firstSlot = null;
  let lastSlot = null;

  for (const slot of visibleSlots) {
    if (startAt < slot.endAt && endAt > slot.startAt) {
      if (!firstSlot) firstSlot = slot;
      lastSlot = slot;
    }
  }

  if (!firstSlot || !lastSlot) return null;
  return { firstSlot, lastSlot };
}

function buildVisibleSegmentBars(worker, visibleSlots) {
  return (worker?.segments || [])
    .map((segment) => {
      const startAt = segment?.startAt instanceof Date ? segment.startAt : null;
      const endAt = segment?.endAt instanceof Date ? segment.endAt : null;
      if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return null;
      }

      const slotRange = getVisibleSlotRange(startAt, endAt, visibleSlots);
      if (!slotRange) return null;

      const effectiveDays = getSegmentEffectiveDays(segment);
      const label = segment?.label || `${formatDayValue(effectiveDays)} j`;
      const leftPx = slotRange.firstSlot.leftPx;
      const widthPx =
        slotRange.lastSlot.leftPx + slotRange.lastSlot.widthPx - slotRange.firstSlot.leftPx;

      return {
        segmentId: segment.id,
        workerName: worker?.name,
        startSlotIndex: slotRange.firstSlot.slotIndex,
        endSlotIndex: slotRange.lastSlot.slotIndex,
        startAtMs: startAt.getTime(),
        endAtMs: endAt.getTime(),
        // Raw stored effectif (may be null) so the edit-segment modal can
        // pre-fill "jours effectifs travailles" exactly as stored, blank when
        // unset — this module is DOM-driven, so the value rides on the bar.
        effectif: segment?.effectif == null ? "" : segment.effectif,
        leftPx,
        widthPx,
        label,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.leftPx !== right.leftPx) return left.leftPx - right.leftPx;
      return left.widthPx - right.widthPx;
    });
}

function assignSegmentLanes(bars) {
  const lanes = [];

  return bars.map((bar) => {
    let laneIndex = lanes.findIndex((laneRightEdge) => bar.leftPx >= laneRightEdge + 8);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(0);
    }

    lanes[laneIndex] = bar.leftPx + bar.widthPx;
    return { ...bar, laneIndex };
  });
}

function renderSegmentBars(assignedBars) {
  return assignedBars
    .map((bar) => {
      const compact = bar.widthPx < 64;
      return `
        <div
          class="charge-plan-segment-bar ${compact ? "is-compact" : ""}"
          style="left:${bar.leftPx}px; top:${10 + bar.laneIndex * 32}px; width:${Math.max(12, bar.widthPx)}px"
          data-segment-id="${escapeHtml(String(bar.segmentId))}"
          data-worker-name="${escapeHtml(bar.workerName)}"
          data-start-slot-index="${bar.startSlotIndex}"
          data-end-slot-index="${bar.endSlotIndex}"
          data-start-at-ms="${bar.startAtMs}"
          data-end-at-ms="${bar.endAtMs}"
          data-effectif="${escapeHtml(String(bar.effectif))}"
        >
          <span class="charge-plan-segment-handle is-start" data-resize-edge="start"></span>
          <span class="charge-plan-segment-label">${escapeHtml(bar.label)}</span>
          <span class="charge-plan-segment-handle is-end" data-resize-edge="end"></span>
        </div>
      `;
    })
    .join("");
}

// --- rows (port of renderRoleRow / renderWorkerRow) ---------------------------

function renderRoleRow(roleLabel, timelineWidth) {
  return `
    <div class="charge-plan-role-row" style="--timeline-width:${timelineWidth}px; --row-height:36px">
      <div class="charge-plan-role-cell charge-plan-role-cell--label">${escapeHtml(roleLabel)}</div>
      <div class="charge-plan-role-cell charge-plan-role-cell--filler"></div>
    </div>
  `;
}

function renderWorkerRow(worker, visibleSlots, timelineWidth, windowDays, dayWidth) {
  const visibleSegmentBars = buildVisibleSegmentBars(worker, visibleSlots);
  const assignedBars = assignSegmentLanes(visibleSegmentBars);
  const laneCount = Math.max(
    1,
    assignedBars.reduce((maxLane, bar) => Math.max(maxLane, bar.laneIndex + 1), 0)
  );
  const rowHeight = Math.max(72, 20 + laneCount * 32);

  return `
    <div class="charge-plan-row" style="--timeline-width:${timelineWidth}px; --row-height:${rowHeight}px">
      <div class="charge-plan-cell charge-plan-cell--name">${escapeHtml(worker.name)}</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div
          class="charge-plan-track"
          data-worker-name="${escapeHtml(worker.name)}"
          data-timeline-width="${timelineWidth}"
        >
          ${renderTrackGrid(windowDays, dayWidth)}
          <div class="charge-plan-track-bars">${renderSegmentBars(assignedBars)}</div>
          <div class="charge-plan-selection-preview" hidden>
            <span class="charge-plan-selection-label"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --- Editer toggle (port of renderTimelineEditToolbar) ------------------------

function renderTimelineEditToolbar(editModeEnabled) {
  return `
    <div class="charge-plan-edit-toolbar">
      <button
        type="button"
        class="charge-plan-edit-mode-toggle ${editModeEnabled ? "is-active" : ""}"
        data-charge-plan-edit-toggle="segments"
        aria-pressed="${editModeEnabled ? "true" : "false"}"
      >
        ${editModeEnabled ? "Verrouiller" : "Editer"}
      </button>
    </div>
  `;
}

function renderContextMenu() {
  return `
    <div class="charge-plan-context-menu" hidden>
      <button type="button" class="charge-plan-context-action" data-action="edit-segment">
        Modifier
      </button>
      <button type="button" class="charge-plan-context-action" data-action="delete-segment">
        Supprimer le segment
      </button>
    </div>
  `;
}

// --- content-width measurement (non-embedded arithmetic path only) -----------

function measureNameColWidthPx(containerEl) {
  if (typeof window === "undefined" || !(containerEl instanceof HTMLElement)) {
    return DEFAULT_NAME_COL_WIDTH_PX;
  }

  const styles = window.getComputedStyle(containerEl);
  const width = parseFloat(styles.getPropertyValue("--charge-plan-name-col-width"));
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_NAME_COL_WIDTH_PX;
}

function measureContentWidthPx(containerEl) {
  if (!(containerEl instanceof HTMLElement)) {
    return MIN_CONTENT_WIDTH_PX;
  }

  const nameColWidthPx = measureNameColWidthPx(containerEl);
  const scrollEl = containerEl.querySelector(".charge-plan-scroll");
  const containerWidth = Math.max(
    scrollEl?.clientWidth || 0,
    containerEl.clientWidth || 0,
    containerEl.getBoundingClientRect?.().width || 0,
    typeof window !== "undefined" ? window.innerWidth - 64 : 0,
    960
  );

  return Math.max(MIN_CONTENT_WIDTH_PX, containerWidth - nameColWidthPx);
}

// --- public factory -------------------------------------------------------------

export function createChargeBoard(containerEl) {
  let activeVisibleSlots = [];
  let contentWidthPx = 0;
  let lastWorkers = [];
  let lastEditMode = false;

  function clear() {
    if (containerEl instanceof HTMLElement) {
      containerEl.innerHTML = "";
      containerEl.classList.remove("is-segment-editing-enabled", "is-segment-editing-locked");
      delete containerEl.dataset.segmentEditMode;
    }
    activeVisibleSlots = [];
  }

  function render({ workers, viewport, editMode } = {}) {
    if (!(containerEl instanceof HTMLElement) || !viewport) {
      clear();
      return;
    }

    lastWorkers = workers || [];
    lastEditMode = Boolean(editMode);

    containerEl.classList.add("charge-plan-board");

    const groupedWorkers = groupWorkersByRole(lastWorkers);
    const windowDays = buildWindowDays(viewport);
    const visibleDays = Math.max(1, toFiniteNumber(viewport.visibleDays, windowDays.length || 1));
    contentWidthPx = measureContentWidthPx(containerEl);
    const dayWidth = contentWidthPx / visibleDays;
    const timelineWidth = dayWidth * visibleDays;

    activeVisibleSlots = buildVisibleSlots(windowDays, dayWidth);

    const rowsHtml = Object.entries(groupedWorkers)
      .map(([roleLabel, roleWorkers]) =>
        [
          renderRoleRow(roleLabel, timelineWidth),
          ...roleWorkers.map((worker) =>
            renderWorkerRow(worker, activeVisibleSlots, timelineWidth, windowDays, dayWidth)
          ),
        ].join("")
      )
      .join("");

    containerEl.classList.toggle("is-segment-editing-enabled", lastEditMode);
    containerEl.classList.toggle("is-segment-editing-locked", !lastEditMode);
    containerEl.dataset.segmentEditMode = lastEditMode ? "enabled" : "locked";

    containerEl.innerHTML = `
      <div class="charge-plan-scroll">
        <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px">
          ${rowsHtml}
        </div>
      </div>
      ${renderTimelineEditToolbar(lastEditMode)}
      ${renderContextMenu()}
    `;
  }

  function setWindow(viewport) {
    render({ workers: lastWorkers, viewport, editMode: lastEditMode });
  }

  function getVisibleSlots() {
    return activeVisibleSlots;
  }

  function getContentWidthPx() {
    return contentWidthPx;
  }

  function destroy() {
    clear();
    contentWidthPx = 0;
    lastWorkers = [];
    lastEditMode = false;
    if (containerEl instanceof HTMLElement) {
      containerEl.classList.remove("charge-plan-board");
    }
  }

  return {
    render,
    setWindow,
    getVisibleSlots,
    getContentWidthPx,
    destroy,
  };
}
