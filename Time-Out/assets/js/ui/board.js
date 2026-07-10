// Leave-board grid render — read-only + drag-target board for the Time-Out widget.
// Ported from `planning-synchro/assets/js/bottom/chargeBoard.js` and stripped of
// all charge/project/cost/role concerns (see docs/superpowers/plans/2026-07-10-time-out.md,
// Task 5). Deltas vs the source:
//   - Total-row block + its helpers removed.
//   - Fixed role-bucket grouping replaced by `groupMembersByService`.
//   - `buildWorkersFromSegments` replaced by `buildMembersFromLeaves` (seeded from
//     deduped people, leaves attached by email-SET membership; segments arrive
//     already as { id, owner, type, startAt, endAt }).
//   - Segment bars carry a leave `type`/`color` (config.leaveTypeColor) and no
//     effectif/planning-task machinery; resize handles + planning tooltip removed.
//   - `renderRoleRow` -> `renderServiceRow`; `createChargeBoard` -> `createLeaveBoard`.
//   - `.charge-plan-track` rows expose `data-person-key` (the ownership gate) and
//     `data-owner-email` (the write email: the viewer's own login on their line, a
//     person's primaryEmail for an admin acting on someone else's).
//
// The half-day slot math (buildVisibleSlots), exact-window day enumeration
// (buildWindowDays), weekend grid (renderTrackGrid), visible-slot range lookup
// (getVisibleSlotRange) and lane assignment (assignSegmentLanes) are kept verbatim
// from the source. Their private helpers (half-day slot ranges, calendar-month
// enumeration, numeric coercion) are ported inline below because Time-Out does not
// ship planning-synchro's `utils/format.js` / `utils/timeSegments.js` module shape.
//
// DOM module: document/window are only touched inside function bodies (no top-level
// access), so buildMembersFromLeaves/groupMembersByService import and run cleanly
// under Node (see tests/board.test.mjs); createLeaveBoard() is browser-only.

import {
  toText,
  formatIsoDate,
  parseCalendarDate,
  isValidDate,
  toDateKey,
  createLocalDate,
} from "../utils/dates.js";
import { isBusinessDay } from "../utils/textSegments.js";
import { APP_CONFIG, leaveTypeColor } from "../config.js";

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

// --- numeric coercion (ported from planning-synchro utils/format.js) ----------

function toFiniteNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

// --- half-day slot helpers (ported from planning-synchro utils/timeSegments.js) --

const HALF_DAY_PARTS = ["am", "pm"];

const HALF_DAY_TIMES = {
  am: { label: "matin", startHour: 8, endHour: 12 },
  pm: { label: "apres-midi", startHour: 13, endHour: 17 },
};

function createHalfDaySlotKey(date, part) {
  return `${toDateKey(date)}:${part}`;
}

function getHalfDaySlotRange(baseDate, part) {
  const config = HALF_DAY_TIMES[part];
  if (!config || !isValidDate(baseDate)) {
    return null;
  }

  return {
    part,
    label: config.label,
    startAt: createLocalDate(baseDate, config.startHour),
    endAt: createLocalDate(baseDate, config.endHour),
  };
}

// --- calendar-month enumeration (ported from planning-synchro utils/format.js) --

function toMonthKey(year, monthNumber) {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function parseMonthKey(monthKey) {
  const match = String(monthKey ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) {
    return null;
  }

  return { year, monthNumber };
}

function getMonthStartDate(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthNumber - 1, 1);
}

function getMonthEndDate(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthNumber, 0);
}

function getCalendarDayDates(monthKey) {
  const startDate = getMonthStartDate(monthKey);
  const endDate = getMonthEndDate(monthKey);
  if (!startDate || !endDate) return [];

  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function buildDisplayedMonths(selectedYear, selectedMonth, monthSpan, months = []) {
  const items = [];

  for (let offset = 0; offset < monthSpan; offset += 1) {
    const monthIndex = (selectedMonth + offset) % 12;
    const year = selectedYear + Math.floor((selectedMonth + offset) / 12);
    const monthKey = toMonthKey(year, monthIndex + 1);
    const calendarDayDates = getCalendarDayDates(monthKey);
    items.push({
      monthIndex,
      year,
      monthNumber: monthIndex + 1,
      monthKey,
      monthLabel: months[monthIndex] || "",
      calendarDayCount: calendarDayDates.length,
      calendarDayDates,
    });
  }

  return items;
}

// --- member building (pure) --------------------------------------------------

// Takes deduped people ({ personKey, name, service, emails, primaryEmail }) and
// attaches each leave segment to the person whose email SET contains the leave's
// owner email (lowercased) — so leave posted under any of a person's emails lands
// on their single line. Segments arrive already shaped as { id, owner, type,
// startAt: Date, endAt: Date } from main.js's ingestion.
export function buildMembersFromLeaves(teamMembers, segments) {
  const emailToPerson = new Map();
  const members = (teamMembers || []).map((m) => {
    const person = { ...m, segments: [] };
    (m.emails || []).forEach((e) => emailToPerson.set(String(e).toLowerCase(), person));
    return person;
  });
  (segments || []).forEach((seg) => {
    const person = emailToPerson.get(String(seg.owner || "").toLowerCase());
    if (person) person.segments.push(seg);
  });
  return members;
}

// --- service grouping (pure) -------------------------------------------------

function compareWorkersByName(left, right) {
  return toText(left?.name).localeCompare(toText(right?.name), "fr", {
    sensitivity: "base",
    numeric: true,
  });
}

// Buckets members by their Service label ("Sans service" fallback), returning an
// object keyed by service in French-alpha order, each bucket sorted by name.
export function groupMembersByService(members) {
  const buckets = new Map();
  (members || []).forEach((m) => {
    const label = (m && m.service ? String(m.service).trim() : "") || "Sans service";
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(m);
  });
  const grouped = {};
  [...buckets.keys()]
    .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }))
    .forEach((label) => {
      grouped[label] = [...buckets.get(label)].sort(compareWorkersByName);
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

// --- date axis / frise chronologique (month band + day ticks) ----------------

// Group the visible window's days into consecutive calendar-month runs so the
// month band can draw one labelled span per month. Pure + exported for tests.
export function buildMonthGroups(windowDays) {
  const groups = [];
  (windowDays || []).forEach((date, index) => {
    const year = date.getFullYear();
    const monthIndex = date.getMonth();
    const last = groups[groups.length - 1];
    if (last && last.year === year && last.monthIndex === monthIndex) {
      last.count += 1;
    } else {
      groups.push({ startIndex: index, count: 1, year, monthIndex });
    }
  });
  return groups;
}

// A sticky header row that mirrors the worker-row grid (name cell + timeline
// cell) so it aligns pixel-for-pixel with the tracks. Top band = month labels,
// bottom band = day numbers (adaptive density: every day when zoomed in, only
// week-starts when medium, none when very dense — the month band always shows).
function renderTimelineHeader(windowDays, dayWidth, timelineWidth, months) {
  const monthBand = buildMonthGroups(windowDays)
    .map((group) => {
      const label = `${(months && months[group.monthIndex]) || ""} ${group.year}`.trim();
      return `<span class="charge-plan-axis-month" style="left:${group.startIndex * dayWidth}px; width:${group.count * dayWidth}px">${escapeHtml(label)}</span>`;
    })
    .join("");

  const showEveryDay = dayWidth >= 14;
  const showWeekStarts = dayWidth >= 6;
  const todayKey = typeof Date === "function" ? formatIsoDate(new Date()) : "";
  const dayBand = windowDays
    .map((date, index) => {
      const dateKey = formatIsoDate(date);
      const weekend = !isBusinessDay(date);
      const weekStart = date.getDay() === 1; // Monday
      const isToday = dateKey === todayKey;
      const showNumber = showEveryDay || (showWeekStarts && weekStart) || isToday;
      const cls =
        "charge-plan-axis-day" +
        (weekend ? " is-weekend" : "") +
        (weekStart ? " is-week-start" : "") +
        (isToday ? " is-today" : "");
      return `<span class="${cls}" style="left:${index * dayWidth}px; width:${dayWidth}px" data-date-key="${dateKey}">${showNumber ? date.getDate() : ""}</span>`;
    })
    .join("");

  return `
    <div class="charge-plan-row charge-plan-axis-row" style="--timeline-width:${timelineWidth}px; --row-height:48px">
      <div class="charge-plan-cell charge-plan-cell--name charge-plan-axis-corner">Équipe</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-axis" style="min-width:${timelineWidth}px">
          <div class="charge-plan-axis-months">${monthBand}</div>
          <div class="charge-plan-axis-days">${dayBand}</div>
        </div>
      </div>
    </div>
  `;
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

      const leftPx = slotRange.firstSlot.leftPx;
      const widthPx =
        slotRange.lastSlot.leftPx + slotRange.lastSlot.widthPx - slotRange.firstSlot.leftPx;

      return {
        segmentId: segment.id,
        workerName: worker?.name,
        type: segment.type,
        color: leaveTypeColor(segment.type),
        startSlotIndex: slotRange.firstSlot.slotIndex,
        endSlotIndex: slotRange.lastSlot.slotIndex,
        startAtMs: startAt.getTime(),
        endAtMs: endAt.getTime(),
        leftPx,
        widthPx,
        label: segment.type,
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
          style="left:${bar.leftPx}px; top:${10 + bar.laneIndex * 32}px; width:${Math.max(12, bar.widthPx)}px; background:${bar.color}"
          data-segment-id="${escapeHtml(String(bar.segmentId))}"
          data-worker-name="${escapeHtml(bar.workerName)}"
          data-leave-type="${escapeHtml(bar.type)}"
          data-start-slot-index="${bar.startSlotIndex}"
          data-end-slot-index="${bar.endSlotIndex}"
          data-start-at-ms="${bar.startAtMs}"
          data-end-at-ms="${bar.endAtMs}"
        >
          <span class="charge-plan-segment-label">${escapeHtml(bar.label)}</span>
        </div>
      `;
    })
    .join("");
}

// --- rows (port of renderRoleRow / renderWorkerRow) ---------------------------

function renderServiceRow(serviceLabel, timelineWidth) {
  return `
    <div class="charge-plan-role-row" style="--timeline-width:${timelineWidth}px; --row-height:36px">
      <div class="charge-plan-role-cell charge-plan-role-cell--label">${escapeHtml(serviceLabel)}</div>
      <div class="charge-plan-role-cell charge-plan-role-cell--filler"></div>
    </div>
  `;
}

function renderWorkerRow(worker, visibleSlots, timelineWidth, windowDays, dayWidth, currentUser) {
  const visibleSegmentBars = buildVisibleSegmentBars(worker, visibleSlots);
  const assignedBars = assignSegmentLanes(visibleSegmentBars);
  const laneCount = Math.max(
    1,
    assignedBars.reduce((maxLane, bar) => Math.max(maxLane, bar.laneIndex + 1), 0)
  );
  const rowHeight = Math.max(72, 20 + laneCount * 32);

  // Role-based greying (Task 15): grey + not-allowed the track when the viewer can
  // neither own nor administer it — i.e. not an admin AND not this person's line
  // (matched by personKey). This is a purely visual cue; the real edit gate is
  // enforced by editing.js's canEditTrack (and server-side by Grist Access Rules).
  const viewer = currentUser || { email: "", isAdmin: false, personKey: "" };
  const isNotEditable = !viewer.isAdmin && worker.personKey !== viewer.personKey;
  const trackClass = isNotEditable ? "charge-plan-track is-not-editable" : "charge-plan-track";
  // Email to WRITE as Owner on create: the current user's login email on their own
  // line (ACL requires user.Email == newRec.Owner); a person's primaryEmail for an
  // admin acting on someone else's line.
  const writeEmail = worker.personKey === viewer.personKey ? viewer.email : worker.primaryEmail;

  return `
    <div class="charge-plan-row" style="--timeline-width:${timelineWidth}px; --row-height:${rowHeight}px">
      <div class="charge-plan-cell charge-plan-cell--name">${escapeHtml(worker.name)}</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div
          class="${trackClass}"
          data-worker-name="${escapeHtml(worker.name)}"
          data-person-key="${escapeHtml(worker.personKey)}"
          data-owner-email="${escapeHtml(writeEmail || "")}"
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

export function createLeaveBoard(containerEl) {
  let activeVisibleSlots = [];
  let contentWidthPx = 0;
  let lastMembers = [];
  let lastSegments = [];
  let lastCurrentUser = { email: "", isAdmin: false, personKey: "" };
  // Rebuild throttling for viewport-only re-renders (setWindow). render() is the
  // single committer: it resets the clock and drops any pending trailing rebuild.
  const REBUILD_THROTTLE_MS = 120;
  let lastRebuildAt = 0;
  let rebuildTimerId = null;
  let renderSeq = 0;

  function cancelPendingRebuild() {
    if (rebuildTimerId != null) {
      clearTimeout(rebuildTimerId);
      rebuildTimerId = null;
    }
  }

  function clear() {
    cancelPendingRebuild();
    if (containerEl instanceof HTMLElement) {
      containerEl.innerHTML = "";
      containerEl.classList.remove("is-segment-editing-enabled", "is-segment-editing-locked");
      delete containerEl.dataset.segmentEditMode;
    }
    activeVisibleSlots = [];
  }

  function render({ members, segments, viewport, currentUser } = {}) {
    if (!(containerEl instanceof HTMLElement) || !viewport) {
      clear();
      return;
    }

    // A real (committed) rebuild: drop any queued throttle-trailing rebuild and
    // reset the throttle clock so the NEXT setWindow throttles from here.
    cancelPendingRebuild();
    lastRebuildAt = Date.now();
    renderSeq += 1;
    containerEl.dataset.psRenderSeq = String(renderSeq);

    lastMembers = members || [];
    lastSegments = segments || [];
    lastCurrentUser = currentUser || { email: "", isAdmin: false, personKey: "" };

    containerEl.classList.add("charge-plan-board");

    const workers = buildMembersFromLeaves(lastMembers, lastSegments);
    const groupedWorkers = groupMembersByService(workers);
    const windowDays = buildWindowDays(viewport);
    const visibleDays = Math.max(1, toFiniteNumber(viewport.visibleDays, windowDays.length || 1));
    contentWidthPx = measureContentWidthPx(containerEl);
    const dayWidth = contentWidthPx / visibleDays;
    const timelineWidth = dayWidth * visibleDays;

    activeVisibleSlots = buildVisibleSlots(windowDays, dayWidth);

    const rowsHtml = Object.entries(groupedWorkers)
      .map(([serviceLabel, serviceWorkers]) =>
        [
          renderServiceRow(serviceLabel, timelineWidth),
          ...serviceWorkers.map((worker) =>
            renderWorkerRow(worker, activeVisibleSlots, timelineWidth, windowDays, dayWidth, lastCurrentUser)
          ),
        ].join("")
      )
      .join("");

    // Editing is always on (no lock toggle); keep the enabled hook class for CSS.
    containerEl.classList.add("is-segment-editing-enabled");
    containerEl.classList.remove("is-segment-editing-locked");
    containerEl.dataset.segmentEditMode = "enabled";

    containerEl.innerHTML = `
      <div class="charge-plan-scroll">
        <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px">
          ${renderTimelineHeader(windowDays, dayWidth, timelineWidth, APP_CONFIG.months)}
          ${rowsHtml}
        </div>
      </div>
      ${renderContextMenu()}
    `;
  }

  // Viewport-only change (zoom/pan): throttle the full rebuild using the cached
  // members/segments/currentUser. `render()` is the single committer.
  function setWindow(viewport) {
    if (typeof setTimeout !== "function") {
      render({ members: lastMembers, segments: lastSegments, viewport, currentUser: lastCurrentUser });
      return;
    }
    cancelPendingRebuild();
    const elapsed = Date.now() - lastRebuildAt;
    if (elapsed >= REBUILD_THROTTLE_MS) {
      render({ members: lastMembers, segments: lastSegments, viewport, currentUser: lastCurrentUser });
      return;
    }
    rebuildTimerId = setTimeout(() => {
      rebuildTimerId = null;
      render({ members: lastMembers, segments: lastSegments, viewport, currentUser: lastCurrentUser });
    }, REBUILD_THROTTLE_MS - elapsed);
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
    lastMembers = [];
    lastSegments = [];
    lastCurrentUser = { email: "", isAdmin: false, personKey: "" };
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
