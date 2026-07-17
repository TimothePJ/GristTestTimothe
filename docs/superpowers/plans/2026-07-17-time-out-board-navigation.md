# Time-Out Board Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three Time-Out changes: everyone sees everyone with the current user's Service listed first, a sticky "Moi" row pinned under the date axis, and calendar-aligned zoom (week Mon→Sun, month 1st→last, quarter).

**Architecture:** A new pure `viewportModes.js` (Node-tested) computes calendar-aligned viewports; `main.js` wires it to the toolbar and drops the service filter; `board.js` reorders service groups (current user first) and renders a sticky pinned copy of the current user's row after the axis.

**Tech Stack:** Vanilla ES modules, Grist Plugin API, Node built-in test runner. No npm/bundler.

## Global Constraints

- **Everyone visible; current user's Service first**, other services alphabetical (roles mixed, no duplicates — already the case via `dedupeTeamMembers`/`groupMembersByService`). The `filterMembersByService` restriction is REMOVED.
- **Pinned "Moi" row**: a sticky copy of the current user's row rendered right after the axis; same `data-person-key`/`data-owner-email`/segments as their in-group row → editable, and synced via the existing write→re-fetch→re-render.
- **Zoom modes:** `week` = Monday→Sunday; `month` = 1st→last day; `quarter` = calendar quarter (Jan-Mar / Apr-Jun / Jul-Sep / Oct-Dec, only its 3 months). Zoom anchors to the period containing `firstVisibleDate`; ‹/› move one period; "Aujourd'hui" = today's period. Initial mode = `quarter`.
- **viewport shape:** `{ mode, firstVisibleDate, rangeStartDate, rangeEndDate, visibleDays }` — the board consumes it unchanged.
- **Charge widgets untouched. No Grist writes.**
- **Commits by the USER** — steps end at `git add`; never `git commit`/`git push`.
- **Node ≥ 22.** Time-Out suite stays green (the `filterMembersByService` test is removed; `viewportModes` tests are added).

## Source references

- `Time-Out/assets/js/main.js`: `formatViewportRange` (~40), `updateZoomButtons` (~50), `buildInitialViewport` (~55), `render()` board call (~133), `updateZoomButtons` call (~149), `wireViewportControls` (163-199), helper `addDaysIso` (~27).
- `Time-Out/assets/js/ui/board.js`: `renderWorkerRow` (455-490, row markup 476-484), `render()` grouping+innerHTML (592-626), imports (28-37).
- `Time-Out/index.html`: zoom buttons (21-23) `data-to-zoom="7|31|90"`.
- `Time-Out/assets/js/utils/teamPeople.js` + `tests/teamPeople.test.mjs`: `filterMembersByService` (to remove); `normalizeName` (kept, reused by board).

## File structure

```
Time-Out/assets/js/utils/viewportModes.js   Task 1 (NEW)
Time-Out/tests/viewportModes.test.mjs        Task 1 (NEW)
Time-Out/assets/js/main.js                   Task 2
Time-Out/index.html                          Task 2
Time-Out/assets/js/utils/teamPeople.js       Task 2 (remove filterMembersByService)
Time-Out/tests/teamPeople.test.mjs           Task 2 (remove its test + import)
Time-Out/assets/js/ui/board.js               Task 3
Time-Out/assets/css/styles.css               Task 3
```

---

### Task 1: `viewportModes.js` + tests

**Files:**
- Create: `Time-Out/assets/js/utils/viewportModes.js`
- Test: `Time-Out/tests/viewportModes.test.mjs`

**Interfaces:**
- Produces: `startOfWeek(date)->Date`, `computeViewport(mode, anchor)->{mode,firstVisibleDate,rangeStartDate,rangeEndDate,visibleDays}`, `shiftAnchor(mode, firstVisibleDate, direction)->Date`.

- [ ] **Step 1: Write the failing test**

```js
// Time-Out/tests/viewportModes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { startOfWeek, computeViewport, shiftAnchor } from "../assets/js/utils/viewportModes.js";

test("startOfWeek returns the Monday of the week", () => {
  assert.deepEqual(startOfWeek("2026-07-17"), new Date(2026, 6, 13)); // Fri → Mon 13
  assert.deepEqual(startOfWeek("2026-07-19"), new Date(2026, 6, 13)); // Sun → Mon 13
  assert.deepEqual(startOfWeek("2026-07-13"), new Date(2026, 6, 13)); // Mon → itself
});

test("computeViewport week / month / quarter", () => {
  assert.deepEqual(computeViewport("week", "2026-07-17"), {
    mode: "week", firstVisibleDate: "2026-07-13", rangeStartDate: "2026-07-13", rangeEndDate: "2026-07-19", visibleDays: 7,
  });
  const mo = computeViewport("month", "2026-07-17");
  assert.equal(mo.firstVisibleDate, "2026-07-01");
  assert.equal(mo.rangeEndDate, "2026-07-31");
  assert.equal(mo.visibleDays, 31);
  assert.equal(computeViewport("month", "2028-02-10").visibleDays, 29); // leap February
  const q = computeViewport("quarter", "2026-07-17");
  assert.equal(q.firstVisibleDate, "2026-07-01");
  assert.equal(q.rangeEndDate, "2026-09-30");
  assert.equal(q.visibleDays, 92);
  assert.equal(computeViewport("quarter", "2026-11-05").firstVisibleDate, "2026-10-01");
  assert.equal(computeViewport("quarter", "2026-02-20").rangeEndDate, "2026-03-31");
});

test("shiftAnchor moves one period per mode", () => {
  assert.deepEqual(shiftAnchor("week", "2026-07-13", 1), new Date(2026, 6, 20));
  assert.deepEqual(shiftAnchor("week", "2026-07-13", -1), new Date(2026, 6, 6));
  assert.deepEqual(shiftAnchor("month", "2026-07-01", 1), new Date(2026, 7, 1));
  assert.deepEqual(shiftAnchor("month", "2026-01-01", -1), new Date(2025, 11, 1));
  assert.deepEqual(shiftAnchor("quarter", "2026-07-01", 1), new Date(2026, 9, 1));
  assert.deepEqual(shiftAnchor("quarter", "2026-07-01", -1), new Date(2026, 3, 1));
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd Time-Out && node --test "tests/viewportModes.test.mjs"` → FAIL (module not found).

- [ ] **Step 3: Create `viewportModes.js`**

```js
// viewportModes.js — pure calendar-aligned viewport ranges for Time-Out.
// mode ∈ "week" (Mon→Sun) | "month" (1st→last) | "quarter" (calendar quarter).
// No DOM, no Grist. Node-testable.

const DAY_MS = 86400000;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function iso(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function normalizeMode(mode) {
  return mode === "week" || mode === "quarter" ? mode : "month";
}

// Monday of the week containing `date`.
export function startOfWeek(date) {
  const d = toDate(date);
  if (!d) return null;
  const offset = (d.getDay() + 6) % 7; // Mon→0 ... Sun→6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

export function computeViewport(mode, anchorDate) {
  const anchor = toDate(anchorDate);
  if (!anchor) return null;
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const resolved = normalizeMode(mode);
  let first;
  let end;
  if (resolved === "week") {
    first = startOfWeek(anchor);
    end = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
  } else if (resolved === "quarter") {
    const qFirstMonth = Math.floor(m / 3) * 3;
    first = new Date(y, qFirstMonth, 1);
    end = new Date(y, qFirstMonth + 3, 0);
  } else {
    first = new Date(y, m, 1);
    end = new Date(y, m + 1, 0);
  }
  const firstVisibleDate = iso(first);
  return {
    mode: resolved,
    firstVisibleDate,
    rangeStartDate: firstVisibleDate,
    rangeEndDate: iso(end),
    visibleDays: Math.round((end - first) / DAY_MS) + 1,
  };
}

// New anchor Date one period earlier/later (direction < 0 = previous).
export function shiftAnchor(mode, firstVisibleDate, direction) {
  const d = toDate(firstVisibleDate);
  if (!d) return null;
  const dir = direction < 0 ? -1 : 1;
  const resolved = normalizeMode(mode);
  if (resolved === "week") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * dir);
  }
  if (resolved === "quarter") {
    const qFirstMonth = Math.floor(d.getMonth() / 3) * 3;
    return new Date(d.getFullYear(), qFirstMonth + 3 * dir, 1);
  }
  return new Date(d.getFullYear(), d.getMonth() + dir, 1);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd Time-Out && node --test "tests/viewportModes.test.mjs"` → 3 pass. Then `node --test "tests/**/*.test.mjs"` → suite green.

- [ ] **Step 5: Stage** — `git add Time-Out/assets/js/utils/viewportModes.js Time-Out/tests/viewportModes.test.mjs`

---

### Task 2: `main.js` viewport modes + drop service filter + index.html

**Files:**
- Modify: `Time-Out/assets/js/main.js`, `Time-Out/index.html`, `Time-Out/assets/js/utils/teamPeople.js`, `Time-Out/tests/teamPeople.test.mjs`

- [ ] **Step 1:** In `main.js`, change the teamPeople import (drop `filterMembersByService`) and add the viewport import:

```js
import { dedupeTeamMembers, findPersonKeyForEmail } from "./utils/teamPeople.js";
import { computeViewport, shiftAnchor } from "./utils/viewportModes.js";
```

- [ ] **Step 2:** Replace `buildInitialViewport()` with the mode-aware version:

```js
function buildInitialViewport() {
  const persisted = loadPersistedViewport();
  if (persisted && persisted.mode && persisted.firstVisibleDate && persisted.rangeEndDate) return persisted;
  return computeViewport("quarter", new Date());
}
```

- [ ] **Step 3:** Replace `updateZoomButtons` to match by mode:

```js
function updateZoomButtons(mode) {
  document.querySelectorAll("[data-to-zoom]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.toZoom === mode);
  });
}
```

- [ ] **Step 4:** In `render()`, pass ALL members (no filter) and update the zoom-button call:
  - Change the board call to: `board.render({ members: state.teamMembers, segments: state.segments, viewport: state.viewport, currentUser: state.currentUser });` (remove the `visibleMembers`/`filterMembersByService` line).
  - Change `updateZoomButtons(state.viewport.visibleDays);` → `updateZoomButtons(state.viewport.mode);`.

- [ ] **Step 5:** Replace `wireViewportControls()` body (lines 166-199) with the mode-driven handlers (removes `recalcRange`):

```js
  function wireViewportControls() {
    const ensureVp = () => (state.viewport = state.viewport || buildInitialViewport());
    const apply = (vp) => {
      if (!vp) return;
      state.viewport = vp;
      render();
      persistViewport(state.viewport);
    };
    const prev = document.getElementById("to-prev");
    const next = document.getElementById("to-next");
    const today = document.getElementById("to-today");
    if (prev) prev.addEventListener("click", () => {
      ensureVp();
      apply(computeViewport(state.viewport.mode, shiftAnchor(state.viewport.mode, state.viewport.firstVisibleDate, -1)));
    });
    if (next) next.addEventListener("click", () => {
      ensureVp();
      apply(computeViewport(state.viewport.mode, shiftAnchor(state.viewport.mode, state.viewport.firstVisibleDate, 1)));
    });
    if (today) today.addEventListener("click", () => {
      ensureVp();
      apply(computeViewport(state.viewport.mode, new Date()));
    });
    document.querySelectorAll("[data-to-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.toZoom;
        if (mode !== "week" && mode !== "month" && mode !== "quarter") return;
        ensureVp();
        const anchor = parseCalendarDate(state.viewport.firstVisibleDate) || new Date();
        apply(computeViewport(mode, anchor));
      });
    });
  }
```

- [ ] **Step 6:** Remove the now-unused `addDaysIso` helper (search `function addDaysIso`) — it was only used by the old `buildInitialViewport`/`recalcRange`. If `node --check` or a grep shows any remaining use, keep it; otherwise delete it.

- [ ] **Step 7:** In `Time-Out/index.html`, change the zoom buttons to mode strings:

```html
      <button type="button" data-to-zoom="week">Semaine</button>
      <button type="button" data-to-zoom="month">Mois</button>
      <button type="button" data-to-zoom="quarter">Trimestre</button>
```

- [ ] **Step 8:** In `Time-Out/assets/js/utils/teamPeople.js`, DELETE the `filterMembersByService` export (the whole function). In `Time-Out/tests/teamPeople.test.mjs`, remove `filterMembersByService` from the import line and delete its `test(...)` block. (Keep `normalizeName`, `dedupeTeamMembers`, `findPersonKeyForEmail` and their tests.)

- [ ] **Step 9: Verify** — `cd Time-Out && node --check assets/js/main.js`; `node --test "tests/**/*.test.mjs"` → all green (teamPeople loses 1 test, viewportModes adds 3). Grep confirms no `filterMembersByService` remains anywhere: `grep -rn filterMembersByService Time-Out/` → no matches.

- [ ] **Step 10: Stage** — `git add Time-Out/assets/js/main.js Time-Out/index.html Time-Out/assets/js/utils/teamPeople.js Time-Out/tests/teamPeople.test.mjs`

---

### Task 3: `board.js` — current-service-first order + pinned "Moi" row

**Files:**
- Modify: `Time-Out/assets/js/ui/board.js`, `Time-Out/assets/css/styles.css`

- [ ] **Step 1:** Add the `normalizeName` import to board.js (near the other `../utils/...` imports):

```js
import { normalizeName } from "../utils/teamPeople.js";
```

- [ ] **Step 2:** Give `renderWorkerRow` an `options` param for the pinned copy. Change its signature and the two lines that render the row class + name cell:

```js
function renderWorkerRow(worker, visibleSlots, timelineWidth, windowDays, dayWidth, currentUser, options = {}) {
```
then compute (near the other consts):
```js
  const rowClass = options.pinned ? "charge-plan-row charge-plan-pinned-row" : "charge-plan-row";
  const displayName = options.pinned ? `Moi — ${worker.name}` : worker.name;
```
and in the returned markup use them:
```js
    <div class="${rowClass}" style="--timeline-width:${timelineWidth}px; --row-height:${rowHeight}px">
      <div class="charge-plan-cell charge-plan-cell--name">${escapeHtml(displayName)}</div>
```
(the `data-worker-name` attribute stays `worker.name` — do not prefix it.)

- [ ] **Step 3:** In `render()`, reorder the service groups (current user first) and build the pinned row. Replace the `rowsHtml` computation (lines 602-611) with:

```js
    const currentServiceKey = normalizeName((lastCurrentUser && lastCurrentUser.service) || "");
    const orderedEntries = Object.entries(groupedWorkers).sort((a, b) => {
      if (!currentServiceKey) return 0;
      const aMine = normalizeName(a[0]) === currentServiceKey ? 0 : 1;
      const bMine = normalizeName(b[0]) === currentServiceKey ? 0 : 1;
      return aMine - bMine; // stable sort keeps the rest in alphabetical order
    });
    const rowsHtml = orderedEntries
      .map(([serviceLabel, serviceWorkers]) =>
        [
          renderServiceRow(serviceLabel, timelineWidth),
          ...serviceWorkers.map((worker) =>
            renderWorkerRow(worker, activeVisibleSlots, timelineWidth, windowDays, dayWidth, lastCurrentUser)
          ),
        ].join("")
      )
      .join("");

    const pinnedWorker =
      lastCurrentUser && lastCurrentUser.personKey
        ? workers.find((w) => w.personKey === lastCurrentUser.personKey)
        : null;
    const pinnedHtml = pinnedWorker
      ? renderWorkerRow(pinnedWorker, activeVisibleSlots, timelineWidth, windowDays, dayWidth, lastCurrentUser, { pinned: true })
      : "";
```

- [ ] **Step 4:** Insert the pinned row into the `innerHTML` (after the axis header, before `rowsHtml`):

```js
    containerEl.innerHTML = `
      <div class="charge-plan-scroll">
        <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px">
          ${renderTimelineHeader(windowDays, dayWidth, timelineWidth, APP_CONFIG.months)}
          ${pinnedHtml}
          ${rowsHtml}
        </div>
      </div>
      ${renderContextMenu()}
    `;
```

- [ ] **Step 5:** Add CSS to `Time-Out/assets/css/styles.css`:

```css
/* Pinned "Moi" row — a sticky copy of the current user's row under the axis. */
.charge-plan-row.charge-plan-pinned-row {
  position: sticky;
  top: 48px; /* = axis (.charge-plan-axis-row) height */
  z-index: 18; /* below the axis (20), above normal rows */
}
.charge-plan-pinned-row .charge-plan-cell {
  background: var(--color-primary-soft, rgba(0, 73, 144, 0.08));
  box-shadow: inset 0 -2px 0 rgba(0, 73, 144, 0.22);
}
.charge-plan-pinned-row .charge-plan-cell--name {
  color: var(--color-primary, #004990);
  font-weight: 800;
}
```

- [ ] **Step 6: Verify** — `cd Time-Out && node --check assets/js/ui/board.js`; `node --test "tests/**/*.test.mjs"` → all green (board pure-helper tests `buildMembersFromLeaves`/`groupMembersByService` unchanged; `renderWorkerRow` is DOM-only, not unit-tested).

- [ ] **Step 7: Stage** — `git add Time-Out/assets/js/ui/board.js Time-Out/assets/css/styles.css`

---

### Task 4: Full verification

**Files:** none.

- [ ] **Step 1:** `cd Time-Out && node --test "tests/**/*.test.mjs"` → all green.

- [ ] **Step 2: Manual verification in Grist (user, cannot run headless):**
  - Everyone is visible; your Service group is FIRST, other services below (alphabetical), roles mixed, no duplicates.
  - A "Moi — <your name>" row is pinned just under the date axis and STAYS visible when you scroll the list; editing it (drag/create/edit/delete) updates your row in your Service group too (and vice-versa) after the refresh.
  - Semaine shows Mon→Sun; Mois shows the 1st→last of the month; Trimestre shows exactly Jan-Mar / Apr-Jun / Jul-Sep / Oct-Dec; ‹/› move one period; "Aujourd'hui" jumps to today's period; the active zoom button is highlighted.

- [ ] **Step 3:** No staging (verification only).

---

## Self-review (vs spec)

- **Spec §3 A (drop filter + current-service-first)** → Task 2 Step 4 (all members) + Task 3 Steps 1/3 (reorder). ✓
- **Spec §4 B (pinned sticky editable synced row)** → Task 3 Steps 2/3/4/5. ✓
- **Spec §5 C (week/month/quarter, ‹/›, today, anchor)** → Task 1 (helpers) + Task 2 Steps 2/5/7. ✓
- **Spec §2 remove filterMembersByService + test** → Task 2 Step 8. ✓
- **Spec §7 edge cases** (unrecognized → no board/pinned handled by existing render guard; empty service → no reorder via `if (!currentServiceKey) return 0`; leap/quarter days via computeViewport tests; two tracks same segment-id → existing editing keyed by person/segment id) → Task 1 tests + Task 3 logic. ✓
- **Spec §9 charge widgets untouched / no Grist writes** → no task touches them. ✓
- **Type consistency:** `computeViewport(mode, anchor)`/`shiftAnchor(mode, firstVisibleDate, dir)`/`startOfWeek(date)` defined Task 1, used Task 2; viewport `{mode,firstVisibleDate,rangeStartDate,rangeEndDate,visibleDays}` produced Task 1, consumed by board unchanged; `renderWorkerRow(..., options)` extended Task 3 Step 2, called with `{pinned:true}` Task 3 Step 3; `normalizeName` imported Task 3 Step 1. ✓
- **Commits by user** → tasks end at `git add`. ✓
```
