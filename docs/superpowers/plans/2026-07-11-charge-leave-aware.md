# Charge « Leave-Aware » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the charge boards of `planning-synchro` and `gestion-depenses2` leave-aware — shade Time-Out absence half-days dark grey, subtract them from a segment's "jours disponibles", and turn a charge segment red when its stored Effectif exceeds the leave-adjusted availability.

**Architecture:** A self-contained pure module `leaveAbsences.js` (identical copy in each widget, `node --test`-tested) builds `Map<normalizedName, Set<"YYYY-MM-DD:am|pm">>` from Time-Out + Team rows and computes `availableDaysAfterLeave`. Each widget fetches Time-Out + Team, threads a per-worker absence set into its board renderer (half-day grey spans + red `is-incoherent` bars) and edit modal (leave-adjusted readout + non-blocking red). No Grist writes; Time-Out is unchanged.

**Tech Stack:** Vanilla ES modules, Grist Plugin API, Node built-in test runner (`node --test`). No npm/bundler.

## Global Constraints

- **4 absence types, verbatim:** `Congé Payé`, `Congé Non Payé`, `RTT`, `Congé Parental` — all count as absence.
- **Half-day granularity:** AM = 08:00–12:00, PM = 13:00–17:00. A half-day leave removes 0.5 day and shades half the day column. Slot key format is exactly `"YYYY-MM-DD:am"` / `"YYYY-MM-DD:pm"` (lowercase part), matching each widget's `createHalfDaySlotKey`.
- **Red is non-blocking:** the edit modal shows the leave-adjusted "jours disponibles", turns the Effectif field red when it exceeds it, but the save is NOT blocked on that condition. Keep the "negative" and "0.5-increment" checks.
- **Availability base = geometry of the range** (business days in the segment's date range), NOT the possibly-stale stored `Allocation_Days`. `available = (business half-day slots in range not in absence set) / 2`.
- **Incoherence uses the RAW stored Effectif** (`segment.effectifDays`), not the clamped `getSegmentEffectiveDays` value.
- **No Grist writes** for this feature. `Time-Out` and its widget are unchanged.
- **Unmapped owner** (email not in Team, or person not on the project's ProjectTeam) → the leave row is silently ignored (optional `console.debug`). No crash.
- **`leaveAbsences.js` is byte-identical in both widgets** and self-contained (no host imports) so it stays in sync and is independently testable.
- **Commits are performed by the USER, not the agent.** Where a step says "Commit", STAGE the files (`git add`) and stop; never run `git commit`/`git push`.
- **Node** ≥ 22 (ESM auto-detection), same as existing `planning-synchro` tests. Run tests from inside the widget folder.

## Source references (read while implementing)

- Spec: `docs/superpowers/specs/2026-07-11-charge-leave-aware-design.md`
- planning-synchro board: `planning-synchro/assets/js/bottom/chargeBoard.js` (`renderTrackGrid` 270-285, `renderWorkerRow` 406-433, `buildVisibleSegmentBars` 304-347, `renderSegmentBars` 364-393, `render` 639, `normalizeNameKey` 91-98, `buildVisibleSlots` 241-266)
- planning-synchro modal: `planning-synchro/assets/js/bottom/editSegmentModal.js` (`buildEditSegmentSelection` 74-90, `validateEditSegmentEffectif` 120-138, `syncDerived` 204-218)
- planning-synchro service/config: `planning-synchro/assets/js/services/gristService.js` (`fetchProjectData` 238-251), `planning-synchro/assets/js/config.js` (22-45)
- gestion-depenses2 board: `gestion-depenses2/assets/js/ui/chargeTimeline.js` (`renderTrackGrid` 578-623, `buildVisibleSegmentBars` 648-698, `renderSegmentBars` 718-752, `renderWorkerRow` 754-798, `buildVisibleSlots` 407-423)
- gestion-depenses2 service/model/config: `gestion-depenses2/assets/js/services/gristService.js` (`fetchProjectDataTables` 270-302), `gestion-depenses2/assets/js/services/projectService.js` (worker build 500-600, `normalizePersonName` 100-107, `buildWorkerLookupKey` 109-117), `gestion-depenses2/assets/js/config.js` (tables 67-78, team cols 161-166, timeSegment cols)
- gestion-depenses2 modal (inline): `gestion-depenses2/assets/js/main.js` (`syncEditChargePlanDerivedValues` 1472-1499, `saveEditedChargePlanSegment` 1670-1675), `gestion-depenses2/index.html` (edit-segment modal 170-234), `gestion-depenses2/assets/js/ui/dom.js` (30-35)
- Existing red style to reuse: `.is-invalid` (`#b42318`) — planning-synchro `styles.css:1136-1143`, gestion-depenses2 `styles.css:1775-1780`.

## File structure (created / modified)

```
planning-synchro/
  assets/js/utils/leaveAbsences.js          Task 1 (NEW, pure)
  tests/leaveAbsences.test.mjs              Task 1 (NEW)
  assets/js/config.js                       Task 3 (add team + timeOut)
  assets/js/services/gristService.js        Task 4 (fetch Team + Time-Out)
  assets/js/main.js                         Task 5 (build absencesByWorker)
  assets/js/bottom/chargeBoard.js           Task 6 (grid grey + red bar)
  assets/css/styles.css                     Task 6 (.is-absence, .is-incoherent)
  assets/js/bottom/chargeEditing.js         Task 7 (pass absenceSet to modal)
  assets/js/bottom/editSegmentModal.js      Task 7 (leave-adjusted readout + red)
gestion-depenses2/
  assets/js/utils/leaveAbsences.js          Task 2 (NEW, identical copy)
  tests/leaveAbsences.test.mjs              Task 2 (NEW)
  assets/js/config.js                       Task 8 (team email/prenomNom + timeOut)
  assets/js/services/gristService.js        Task 9 (fetch Time-Out)
  assets/js/services/projectService.js      Task 10 (absence index + attach)
  assets/js/ui/chargeTimeline.js            Task 11 (grid grey + red bar)
  assets/css/styles.css                     Task 11
  assets/js/main.js                         Task 12 (modal readout + validation)
```

---

## Phase 1 — Pure module `leaveAbsences.js` (both widgets)

### Task 1: `leaveAbsences.js` + tests in planning-synchro

**Files:**
- Create: `planning-synchro/assets/js/utils/leaveAbsences.js`
- Test: `planning-synchro/tests/leaveAbsences.test.mjs`

**Interfaces:**
- Produces: `normalizeName(v)->string`, `normalizeEmail(v)->string`, `toDateKey(date)->"YYYY-MM-DD"`, `buildAbsenceIndex(timeOutRows, teamRows, timeOutCols, teamCols, absenceTypes)->Map<string,Set<string>>`, `availableDaysAfterLeave(startAt:Date, endAt:Date, absenceSet:Set)->number`, `isAbsenceSlot(absenceSet, dateKey, part)->bool`.

- [ ] **Step 1: Write the failing test**

```js
// planning-synchro/tests/leaveAbsences.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAbsenceIndex, availableDaysAfterLeave, normalizeName, isAbsenceSlot } from "../assets/js/utils/leaveAbsences.js";

const TO = { owner:"Owner", startDate:"Start_Date", startPeriod:"Start_Period", endDate:"End_Date", endPeriod:"End_Period", type:"Type" };
const TEAM = { email:"Email", prenomNom:"PrenomNom", prenom:"Prenom", nom:"Nom" };
const TYPES = ["Congé Payé","Congé Non Payé","RTT","Congé Parental"];

test("reference: charge 29 Jun→10 Jul (10 j) with RTT 30 Jun→3 Jul → 6 available", () => {
  const team = [{ Email:"a@x", PrenomNom:"Jean Dupont" }];
  const timeout = [{ Owner:"A@X", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-07-03", End_Period:"PM", Type:"RTT" }];
  const idx = buildAbsenceIndex(timeout, team, TO, TEAM, TYPES);
  const set = idx.get(normalizeName("Jean Dupont"));
  assert.ok(set && set.size === 8, "4 weekdays × 2 half-days = 8 absent slots");
  const startAt = new Date(2026,5,29,8);   // 29 June 08:00 (Monday)
  const endAt   = new Date(2026,6,10,17);  // 10 July 17:00 (Friday)
  assert.equal(availableDaysAfterLeave(startAt, endAt, set), 6);
});

test("half-day RTT (AM only) removes 0.5 day", () => {
  const team = [{ Email:"a@x", PrenomNom:"Jean Dupont" }];
  const timeout = [{ Owner:"a@x", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-06-30", End_Period:"AM", Type:"RTT" }];
  const set = buildAbsenceIndex(timeout, team, TO, TEAM, TYPES).get(normalizeName("Jean Dupont"));
  assert.equal(set.size, 1);
  assert.ok(isAbsenceSlot(set, "2026-06-30", "am"));
  assert.equal(isAbsenceSlot(set, "2026-06-30", "pm"), false);
  // segment = that single day 08:00→17:00 = 1 day; minus AM = 0.5
  assert.equal(availableDaysAfterLeave(new Date(2026,5,30,8), new Date(2026,5,30,17), set), 0.5);
});

test("unmapped owner (email not in Team) is ignored", () => {
  const idx = buildAbsenceIndex(
    [{ Owner:"ghost@x", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-06-30", End_Period:"PM", Type:"RTT" }],
    [{ Email:"a@x", PrenomNom:"Jean Dupont" }], TO, TEAM, TYPES);
  assert.equal(idx.size, 0);
});

test("non-absence type is skipped", () => {
  const idx = buildAbsenceIndex(
    [{ Owner:"a@x", Start_Date:"2026-06-30", Start_Period:"AM", End_Date:"2026-06-30", End_Period:"PM", Type:"Réunion" }],
    [{ Email:"a@x", PrenomNom:"Jean Dupont" }], TO, TEAM, TYPES);
  assert.equal(idx.size, 0);
});

test("weekends never count as available or absent", () => {
  // 4-5 July 2026 = Sat/Sun. A segment over just the weekend has 0 available days.
  assert.equal(availableDaysAfterLeave(new Date(2026,6,4,8), new Date(2026,6,5,17), new Set()), 0);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd planning-synchro && node --test "tests/leaveAbsences.test.mjs"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `leaveAbsences.js`**

```js
// planning-synchro/assets/js/utils/leaveAbsences.js
// Self-contained, pure. Coordinates Time-Out leave with the charge board.
// No DOM, no Grist. BYTE-IDENTICAL copy in gestion-depenses2. Node-testable.
// Slot key format "YYYY-MM-DD:am|pm" must match each widget's createHalfDaySlotKey.

const PERIOD_HOURS = { am: { startHour: 8, endHour: 12 }, pm: { startHour: 13, endHour: 17 } };
const HALF_DAY_PARTS = ["am", "pm"];

export function toText(value) {
  return value == null ? "" : String(value).trim();
}
export function normalizeEmail(value) {
  return toText(value).toLowerCase();
}
// Must match the widgets' normalizeNameKey / normalizePersonName exactly.
// The regex strips combining diacritics U+0300–U+036F. Write it with the ASCII
// escape to avoid copy issues: .replace(/[̀-ͯ]/g, "")
export function normalizeName(value) {
  return toText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
export function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseIsoDate(value) {
  const m = toText(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}
function normalizePart(period) {
  const t = toText(period).toLowerCase();
  return t === "pm" ? "pm" : t === "am" ? "am" : "";
}
function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}
// Business half-day slots overlapping [startAt, endAt]; each carries key "YYYY-MM-DD:part".
function businessHalfDaySlotsBetween(startAt, endAt) {
  if (!(startAt instanceof Date) || !(endAt instanceof Date)) return [];
  const rangeStart = startAt <= endAt ? startAt : endAt;
  const rangeEnd = startAt <= endAt ? endAt : startAt;
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const lastDay = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  const slots = [];
  while (cursor <= lastDay) {
    if (isBusinessDay(cursor)) {
      for (const part of HALF_DAY_PARTS) {
        const cfg = PERIOD_HOURS[part];
        const slotStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cfg.startHour);
        const slotEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cfg.endHour);
        if (rangeStart < slotEnd && rangeEnd > slotStart) {
          slots.push({ key: `${toDateKey(cursor)}:${part}` });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}
// Time-Out leave row (Text startDate/startPeriod/endDate/endPeriod) -> Date range.
function leaveRange(startDate, startPeriod, endDate, endPeriod) {
  const s = parseIsoDate(startDate);
  const e = parseIsoDate(endDate);
  const sp = normalizePart(startPeriod);
  const ep = normalizePart(endPeriod);
  if (!s || !e || !sp || !ep) return null;
  return {
    startAt: new Date(s.getFullYear(), s.getMonth(), s.getDate(), PERIOD_HOURS[sp].startHour),
    endAt: new Date(e.getFullYear(), e.getMonth(), e.getDate(), PERIOD_HOURS[ep].endHour),
  };
}
// Map<normalizedPersonName, Set<slotKey>>. absenceTypes = exact Type labels counting as absence.
export function buildAbsenceIndex(timeOutRows, teamRows, timeOutCols, teamCols, absenceTypes) {
  const typeSet = new Set((absenceTypes || []).map((t) => toText(t).toLowerCase()));
  const teamByEmail = new Map();
  for (const row of teamRows || []) {
    const email = normalizeEmail(row?.[teamCols.email]);
    if (email) teamByEmail.set(email, row);
  }
  const index = new Map();
  for (const row of timeOutRows || []) {
    const type = toText(row?.[timeOutCols.type]);
    if (typeSet.size && !typeSet.has(type.toLowerCase())) continue;
    const team = teamByEmail.get(normalizeEmail(row?.[timeOutCols.owner]));
    if (!team) continue; // unmapped owner → ignored
    const fullName = toText(team?.[teamCols.prenomNom]) ||
      `${toText(team?.[teamCols.prenom])} ${toText(team?.[teamCols.nom])}`.trim();
    const personKey = normalizeName(fullName);
    if (!personKey) continue;
    const range = leaveRange(row?.[timeOutCols.startDate], row?.[timeOutCols.startPeriod], row?.[timeOutCols.endDate], row?.[timeOutCols.endPeriod]);
    if (!range) continue;
    let set = index.get(personKey);
    if (!set) index.set(personKey, (set = new Set()));
    for (const slot of businessHalfDaySlotsBetween(range.startAt, range.endAt)) set.add(slot.key);
  }
  return index;
}
// Available working DAYS in [startAt,endAt] after removing absence half-days.
export function availableDaysAfterLeave(startAt, endAt, absenceSet) {
  const slots = businessHalfDaySlotsBetween(startAt, endAt);
  if (!absenceSet || absenceSet.size === 0) return slots.length / 2;
  let free = 0;
  for (const slot of slots) if (!absenceSet.has(slot.key)) free += 1;
  return free / 2;
}
// Whether a half-day (dateKey + part) is an absence, for grid shading.
export function isAbsenceSlot(absenceSet, dateKey, part) {
  return !!absenceSet && absenceSet.has(`${dateKey}:${part}`);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd planning-synchro && node --test "tests/leaveAbsences.test.mjs"`
Expected: PASS (5 tests). Also run the full suite `node --test "tests/**/*.test.mjs"` — no regression.

- [ ] **Step 5: Stage for the user to commit**

```bash
git add planning-synchro/assets/js/utils/leaveAbsences.js planning-synchro/tests/leaveAbsences.test.mjs
```

### Task 2: identical `leaveAbsences.js` + tests in gestion-depenses2

**Files:**
- Create: `gestion-depenses2/assets/js/utils/leaveAbsences.js` (byte-identical to Task 1)
- Test: `gestion-depenses2/tests/leaveAbsences.test.mjs` (identical to Task 1)

- [ ] **Step 1: Copy the files**

Run:
```bash
mkdir -p "gestion-depenses2/tests"
cp "planning-synchro/assets/js/utils/leaveAbsences.js" "gestion-depenses2/assets/js/utils/leaveAbsences.js"
cp "planning-synchro/tests/leaveAbsences.test.mjs" "gestion-depenses2/tests/leaveAbsences.test.mjs"
```

- [ ] **Step 2: Run to confirm pass**

Run: `cd gestion-depenses2 && node --test "tests/leaveAbsences.test.mjs"`
Expected: PASS (5 tests).

- [ ] **Step 3: Verify byte-identical**

Run: `diff "planning-synchro/assets/js/utils/leaveAbsences.js" "gestion-depenses2/assets/js/utils/leaveAbsences.js" && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 4: Stage for the user to commit**

```bash
git add gestion-depenses2/assets/js/utils/leaveAbsences.js gestion-depenses2/tests/leaveAbsences.test.mjs
```

---

## Phase 2 — planning-synchro integration (flat dayWidth, modal externalised)

### Task 3: config — add Team + Time-Out tables/columns

**Files:**
- Modify: `planning-synchro/assets/js/config.js` (`grist.tables` 22-27, `grist.columns` 40-45)

**Interfaces:**
- Produces: `APP_CONFIG.grist.tables.team`, `.timeOut`; `APP_CONFIG.grist.columns.team`, `.timeOut`; `APP_CONFIG.absenceTypes`.

- [ ] **Step 1: Add to `APP_CONFIG.grist.tables`**

```js
      team: "Team",
      timeOut: "Time-Out",
```

- [ ] **Step 2: Add to `APP_CONFIG.grist.columns`**

```js
      team: { email: "Email", prenomNom: "PrenomNom", prenom: "Prenom", nom: "Nom" },
      timeOut: { owner: "Owner", startDate: "Start_Date", startPeriod: "Start_Period", endDate: "End_Date", endPeriod: "End_Period", type: "Type" },
```

- [ ] **Step 3: Add the absence types at the top level of `APP_CONFIG`**

```js
  absenceTypes: ["Congé Payé", "Congé Non Payé", "RTT", "Congé Parental"],
```

- [ ] **Step 4: Verify** — `cd planning-synchro && node --check assets/js/config.js && node --test "tests/**/*.test.mjs"` → SYNTAX_OK, suite still green.

- [ ] **Step 5: Stage** — `git add planning-synchro/assets/js/config.js`

### Task 4: service — fetch Team + Time-Out (global, table-id fallback)

**Files:**
- Modify: `planning-synchro/assets/js/services/gristService.js` (`fetchProjectData` 238-251)

**Interfaces:**
- Consumes: `fetchTableRows` (existing).
- Produces: `fetchProjectData(...)` result gains `teamRows` and `timeOutRows` (both global, unfiltered).

- [ ] **Step 1:** Add a table-id resolver near the top of the module (Grist maps `Time-Out` → `Time_Out`):

```js
async function resolveTimeOutTableId() {
  for (const id of ["Time-Out", "Time_Out", "TimeOut"]) {
    try { await fetchTableRows(id); return id; } catch (_e) { /* next */ }
  }
  return "Time-Out";
}
```

- [ ] **Step 2:** In `fetchProjectData`, extend the parallel fetch and return. Replace the existing `Promise.all([...])` trio with:

```js
  const timeOutTableId = await resolveTimeOutTableId();
  const [planningRows, timeSegmentRows, projectTeamRows, teamRows, timeOutRows] = await Promise.all([
    fetchTableRows(t.planningProject).catch(() => []),
    fetchTableRows(t.timeSegment).catch(() => []),
    fetchTableRows(t.projectTeam).catch(() => []),
    fetchTableRows(t.team).catch(() => []),
    fetchTableRows(timeOutTableId).catch(() => []),
  ]);
```

Then add `teamRows` and `timeOutRows` (unfiltered — they are global) to the returned object alongside the existing filtered `planningRows`/`timeSegmentRows`/`projectTeamRows`.

- [ ] **Step 3: Verify** — `node --check assets/js/services/gristService.js`; the change is Grist-side (verified in Grist later). Full suite still green.

- [ ] **Step 4: Stage** — `git add planning-synchro/assets/js/services/gristService.js`

### Task 5: main — build `absencesByWorker`, pass to the board

**Files:**
- Modify: `planning-synchro/assets/js/main.js` (the `loadProject`/render wiring that calls `chargeBoard.render(...)` and `attachChargeEditing(...)`)

**Interfaces:**
- Consumes: `buildAbsenceIndex`, `normalizeName` from `./utils/leaveAbsences.js`; `fetchProjectData`'s new `teamRows`/`timeOutRows`.
- Produces: `absencesByWorker: Map<normalizeNameKey, Set<slotKey>>` passed as `chargeBoard.render({ ..., absencesByWorker })` and available to the editing/modal wiring.

- [ ] **Step 1:** Import at top: `import { buildAbsenceIndex } from "./utils/leaveAbsences.js";` and `import { APP_CONFIG } from "./config.js";` (already imported — reuse).

- [ ] **Step 2:** After `fetchProjectData(...)` returns `data`, build the index (personKey uses `normalizeName`, which is identical to the board's `normalizeNameKey`):

```js
  const absencesByWorker = buildAbsenceIndex(
    data.timeOutRows, data.teamRows,
    APP_CONFIG.grist.columns.timeOut, APP_CONFIG.grist.columns.team,
    APP_CONFIG.absenceTypes
  );
```

- [ ] **Step 3:** Pass it to the board on every `chargeBoard.render(...)` call (initial render AND the `onChanged` re-render): add `absencesByWorker` to the render argument object. Also pass a per-worker lookup into the editing layer so the modal can use it (Task 7): add `getAbsenceSet: (workerName) => absencesByWorker.get(/* normalize */) || new Set()` to the `attachChargeEditing` options — import `normalizeName` and use it for the lookup.

- [ ] **Step 4: Verify** — `node --check assets/js/main.js`; full suite green. (Board rendering verified in Grist in Task 13.)

- [ ] **Step 5: Stage** — `git add planning-synchro/assets/js/main.js`

### Task 6: board — half-day grey shading + red incoherent bars

**Files:**
- Modify: `planning-synchro/assets/js/bottom/chargeBoard.js` (`render` 639, `renderWorkerRow` 406-433, `renderTrackGrid` 270-285, `buildVisibleSegmentBars` 304-347, `renderSegmentBars` 364-393)
- Modify: `planning-synchro/assets/css/styles.css`

**Interfaces:**
- Consumes: `availableDaysAfterLeave`, `isAbsenceSlot`, `normalizeName` from `../utils/leaveAbsences.js`; `formatIsoDate` (existing) for date keys; the segment's raw `effectif`.
- Produces: `render({ ..., absencesByWorker })`; bars carry `bar.incoherent`.

- [ ] **Step 1:** Import at top of chargeBoard.js: `import { availableDaysAfterLeave, isAbsenceSlot, normalizeName } from "../utils/leaveAbsences.js";`

- [ ] **Step 2:** Thread the absence set. In `render(...)` destructure `absencesByWorker` from the argument object (default `new Map()`). In the worker loop, compute each worker's set `const absenceSet = absencesByWorker.get(normalizeName(worker.name)) || new Set();` and pass it into `renderWorkerRow(worker, ..., absenceSet)`; have `renderWorkerRow` forward it to both `renderTrackGrid` and `buildVisibleSegmentBars`.

- [ ] **Step 3:** In `renderTrackGrid(windowDays, dayWidth, absenceSet)` add half-day absence spans in the same `.map`. After the weekend span, append:

```js
      const dateKey = formatIsoDate(date);
      const halfDayWidth = dayWidth / 2;
      const absenceSpans = ["am", "pm"]
        .map((part, partIndex) =>
          isAbsenceSlot(absenceSet, dateKey, part)
            ? `<span class="charge-plan-grid-day is-absence" style="left:${dayIndex * dayWidth + partIndex * halfDayWidth}px; width:${halfDayWidth}px" data-date-key="${dateKey}" data-part="${part}"></span>`
            : "")
        .join("");
```

and include `absenceSpans` in the returned markup (each day contributes its weekend span + its absence spans).

- [ ] **Step 4:** In `buildVisibleSegmentBars(worker, visibleSlots, planningTasks, absenceSet)` compute the incoherence flag where `effectiveDays`/`effectif` is in scope (~316-336):

```js
      const rawEffectif = segment?.effectif ?? segment?.effectifDays ?? null;
      const available = availableDaysAfterLeave(segment.startAt, segment.endAt, absenceSet);
      const incoherent = rawEffectif != null && Number(rawEffectif) > available;
```

Carry `incoherent` and `available` onto the returned bar object (alongside `effectif`), and preserve them through `assignSegmentLanes` (spread `...bar`).

- [ ] **Step 5:** In `renderSegmentBars`, add the class + explanatory title:

```js
        class="charge-plan-segment-bar ${compact ? "is-compact" : ""} ${bar.incoherent ? "is-incoherent" : ""}"
```
and when `bar.incoherent`, set `title` to `` `Effectif ${bar.effectif} j > disponible après absences ${bar.available} j` `` (else keep the planning tooltip).

- [ ] **Step 6:** Add CSS to `planning-synchro/assets/css/styles.css`:

```css
.charge-plan-grid-day.is-absence { background: rgba(8, 21, 38, 0.28); }
.charge-plan-segment-bar.is-incoherent { background: linear-gradient(135deg, #e5534b, #b42318); }
```

- [ ] **Step 7: Verify** — `node --check assets/js/bottom/chargeBoard.js`; full suite green. Visual behaviour verified in Grist (Task 13).

- [ ] **Step 8: Stage** — `git add planning-synchro/assets/js/bottom/chargeBoard.js planning-synchro/assets/css/styles.css`

### Task 7: modal — leave-adjusted readout + non-blocking red

**Files:**
- Modify: `planning-synchro/assets/js/bottom/editSegmentModal.js` (`buildEditSegmentSelection` 74-90, `validateEditSegmentEffectif` 120-138, `syncDerived` 204-218)
- Modify: `planning-synchro/assets/js/bottom/chargeEditing.js` (where the modal is opened — pass the worker's absence set in)

**Interfaces:**
- Consumes: `availableDaysAfterLeave` from `../utils/leaveAbsences.js`; the `getAbsenceSet(workerName)` provided by main.js (Task 5).

- [ ] **Step 1:** In chargeEditing.js, when opening the edit modal (`handleModifySegment` / the modal `.open({...})` call), include the segment's owner absence set: `absenceSet: getAbsenceSet(finished.trackEl.dataset.workerName)` (thread `getAbsenceSet` from `attachChargeEditing` options).

- [ ] **Step 2:** In editSegmentModal.js `open({ ..., absenceSet })`, store `currentAbsenceSet = absenceSet || new Set();`. Import `import { availableDaysAfterLeave } from "../utils/leaveAbsences.js";`.

- [ ] **Step 3:** In the readout computation (`syncDerived`, where `selection.totalDays` is displayed), compute and display the leave-adjusted available instead:

```js
      const available = availableDaysAfterLeave(selection.startAt, selection.endAt, currentAbsenceSet);
      calculatedEl.textContent = formatEditSegmentDayValue(available);
      const effectifVal = Number(effectifInput.value);
      const over = effectifInput.value !== "" && Number.isFinite(effectifVal) && effectifVal > available;
      effectifInput.classList.toggle("is-over-available", over);
```

- [ ] **Step 4:** In `validateEditSegmentEffectif`, REMOVE the hard-block on `rawEffectifInput > totalDays` (keep the negative and 0.5-increment checks). The over-availability condition is now a non-blocking visual state only (Step 3). So `handleSave` no longer returns an error for effectif > available.

- [ ] **Step 5:** Add CSS `.ps-segment-edit-field input.is-over-available, #ps-edit-segment-effectif.is-over-available { border-color: #b42318; color: #b42318; }` to styles.css.

- [ ] **Step 6: Verify** — `node --check assets/js/bottom/editSegmentModal.js assets/js/bottom/chargeEditing.js`; full suite green (adjust any editSegmentModal unit test that asserted the old hard-block — update it to expect no error on effectif > available). Behaviour verified in Grist (Task 13).

- [ ] **Step 7: Stage** — `git add planning-synchro/assets/js/bottom/editSegmentModal.js planning-synchro/assets/js/bottom/chargeEditing.js planning-synchro/assets/css/styles.css`

---

## Phase 3 — gestion-depenses2 integration (per-month dayWidth, inline modal)

### Task 8: config — Team email/prenomNom + Time-Out

**Files:**
- Modify: `gestion-depenses2/assets/js/config.js` (tables 67-78, team cols 161-166)

- [ ] **Step 1:** Extend `grist.columns.team` (currently `{ id, firstName:"Prenom", lastName:"Nom", role:"Role" }`) with:

```js
    email: "Email",
    prenomNom: "PrenomNom",
```

- [ ] **Step 2:** Add to `grist.tables`: `timeOut: "Time-Out",` and add `grist.columns.timeOut`:

```js
    timeOut: { owner: "Owner", startDate: "Start_Date", startPeriod: "Start_Period", endDate: "End_Date", endPeriod: "End_Period", type: "Type" },
```

- [ ] **Step 3:** Add absence types at the top level of `APP_CONFIG`:

```js
  absenceTypes: ["Congé Payé", "Congé Non Payé", "RTT", "Congé Parental"],
```

- [ ] **Step 4: Verify** — `cd gestion-depenses2 && node --check assets/js/config.js`; `node --test "tests/leaveAbsences.test.mjs"` still green.

- [ ] **Step 5: Stage** — `git add gestion-depenses2/assets/js/config.js`

### Task 9: service — fetch Time-Out

**Files:**
- Modify: `gestion-depenses2/assets/js/services/gristService.js` (`fetchProjectDataTables` 270-302)

- [ ] **Step 1:** Add a `resolveTimeOutTableId()` helper (same as Task 4 Step 1) to the module.

- [ ] **Step 2:** In `fetchProjectDataTables`, add `Time-Out` (via the resolver) to the parallel fetch and return it as `timeOutRows` (global, unfiltered) alongside the existing tables. `Team` is already fetched (`teamRows`).

- [ ] **Step 3: Verify** — `node --check assets/js/services/gristService.js`.

- [ ] **Step 4: Stage** — `git add gestion-depenses2/assets/js/services/gristService.js`

### Task 10: model — build absence index and attach to workers

**Files:**
- Modify: `gestion-depenses2/assets/js/services/projectService.js` (worker build ~500-600; uses `normalizePersonName` 100-107)

**Interfaces:**
- Consumes: `buildAbsenceIndex`, `normalizeName` from `../utils/leaveAbsences.js`; `teamRows`, `timeOutRows` from the fetch; `APP_CONFIG.grist.columns.{team,timeOut}`, `APP_CONFIG.absenceTypes`.
- Produces: each worker object gains `worker.absenceSet: Set<slotKey>`.

- [ ] **Step 1:** Import `import { buildAbsenceIndex, normalizeName } from "../utils/leaveAbsences.js";`.

- [ ] **Step 2:** Where the worker list is assembled from `projectTeamRows`/`timeSegmentRows`, build the index once from the fetched `timeOutRows` + `teamRows`, then attach per worker:

```js
  const absenceByPerson = buildAbsenceIndex(
    timeOutRows, teamRows,
    APP_CONFIG.grist.columns.timeOut, APP_CONFIG.grist.columns.team,
    APP_CONFIG.absenceTypes
  );
  // for each built worker:
  worker.absenceSet = absenceByPerson.get(normalizeName(worker.name)) || new Set();
```

`normalizeName` (leaveAbsences) is byte-identical to `normalizePersonName` (NFD/strip/collapse/lower), so keys line up.

- [ ] **Step 3: Verify** — `node --check assets/js/services/projectService.js`.

- [ ] **Step 4: Stage** — `git add gestion-depenses2/assets/js/services/projectService.js`

### Task 11: board — per-month grey shading + red incoherent bars

**Files:**
- Modify: `gestion-depenses2/assets/js/ui/chargeTimeline.js` (`renderTrackGrid` 578-623, `renderWorkerRow` 754-798, `buildVisibleSegmentBars` 648-698, `renderSegmentBars` 718-752)
- Modify: `gestion-depenses2/assets/css/styles.css`

**Interfaces:**
- Consumes: `availableDaysAfterLeave`, `isAbsenceSlot` from `../utils/leaveAbsences.js`; `toDateInputValue` (existing) for date keys; the worker's `absenceSet`; `getSegmentEffectiveDays` inputs (raw `segment.effectifDays`).

- [ ] **Step 1:** Import `import { availableDaysAfterLeave, isAbsenceSlot } from "../utils/leaveAbsences.js";`.

- [ ] **Step 2:** Thread `worker.absenceSet` from `renderWorkerRow` into `renderTrackGrid(months, zoomMode, zoomScale, sizingContext, absenceSet)` and `buildVisibleSegmentBars(..., absenceSet)`.

- [ ] **Step 3:** In `renderTrackGrid`, inside the per-month `calendarDayDates.map((date, dayIndex) => ...)`, in addition to the weekend span, emit half-day absence spans using the SAME per-month `dayWidth` and a half-day offset:

```js
            const dateKey = toDateInputValue(date);
            const halfDayWidth = dayWidth / 2;
            const absenceHtml = ["am", "pm"].map((part, partIndex) =>
              isAbsenceSlot(absenceSet, dateKey, part)
                ? `<span class="charge-plan-grid-day is-absence" style="left:${dayIndex * dayWidth + partIndex * halfDayWidth}px; width:${halfDayWidth}px" data-date-key="${dateKey}" data-part="${part}"></span>`
                : "").join("");
```

Append `absenceHtml` to that day's output (weekend span + absence spans), keeping the per-month `<span class="charge-plan-grid-month">` wrapper unchanged.

- [ ] **Step 4:** In `buildVisibleSegmentBars`, compute the flag (raw effectif is `segment.effectifDays`):

```js
      const rawEffectif = segment?.effectifDays ?? null;
      const available = availableDaysAfterLeave(segment.startAt, segment.endAt, absenceSet);
      const incoherent = rawEffectif != null && Number(rawEffectif) > available;
```

Carry `incoherent`/`available` onto the bar object; preserve through `assignSegmentLanes`.

- [ ] **Step 5:** In `renderSegmentBars`, add `${bar.incoherent ? "is-incoherent" : ""}` to the class list and set an explanatory `title` when incoherent.

- [ ] **Step 6:** CSS in `gestion-depenses2/assets/css/styles.css`:

```css
.charge-plan-grid-day.is-absence { background: rgba(8, 21, 38, 0.28); }
.charge-plan-segment-bar.is-incoherent { background: linear-gradient(135deg, #e5534b, #b42318); }
```

- [ ] **Step 7: Verify** — `node --check assets/js/ui/chargeTimeline.js`.

- [ ] **Step 8: Stage** — `git add gestion-depenses2/assets/js/ui/chargeTimeline.js gestion-depenses2/assets/css/styles.css`

### Task 12: inline modal — leave-adjusted readout + non-blocking red

**Files:**
- Modify: `gestion-depenses2/assets/js/main.js` (`syncEditChargePlanDerivedValues` 1472-1499, `saveEditedChargePlanSegment` 1670-1675, and the segment-context lookup that already resolves the worker)

**Interfaces:**
- Consumes: `availableDaysAfterLeave` from `./utils/leaveAbsences.js`; the edited segment's worker `absenceSet` (via `findChargePlanSegmentContext` → worker).

- [ ] **Step 1:** Import `import { availableDaysAfterLeave } from "./utils/leaveAbsences.js";`.

- [ ] **Step 2:** In `syncEditChargePlanDerivedValues`, resolve the edited segment's worker absence set (the segment context already carries the worker; use `worker.absenceSet || new Set()`), compute `const available = availableDaysAfterLeave(selection.startAt, selection.endAt, absenceSet);`, and write `available` into `dom.editSegmentCalculatedDays` instead of `selection.totalDays`. Toggle a red class `is-over-available` on `dom.editSegmentEffectifInput` when its value `> available`.

- [ ] **Step 3:** In `saveEditedChargePlanSegment`, REMOVE the hard-block `if (rawEffectifInput != null && rawEffectifInput > selection.totalDays) { setEditChargePlanFeedback("…ne peut pas depasser…"); return; }` (keep the negative + 0.5-increment checks). Over-availability is now visual-only.

- [ ] **Step 4:** CSS `#edit-segment-effectif.is-over-available { border-color:#b42318; color:#b42318; }` in styles.css.

- [ ] **Step 5: Verify** — `node --check assets/js/main.js`.

- [ ] **Step 6: Stage** — `git add gestion-depenses2/assets/js/main.js gestion-depenses2/assets/css/styles.css`

---

## Phase 4 — Verification

### Task 13: full test run + manual Grist checklist

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests.**
  - `cd planning-synchro && node --test "tests/**/*.test.mjs"` → all green (existing + leaveAbsences 5).
  - `cd gestion-depenses2 && node --test "tests/**/*.test.mjs"` → leaveAbsences 5 green.

- [ ] **Step 2: Manual verification in Grist (user, both widgets).** Document results; do not block on Claude (headless). Checklist:
  - A collaborator with an RTT posted in Time-Out shows those half-days shaded **dark grey** (darker than weekends) on their charge row, at the correct AM/PM half.
  - Editing a charge segment shows "Jours disponibles dans la plage" **reduced** by the overlapping absence half-days (reference: 29 Jun→10 Jul with RTT 30 Jun→3 Jul → **6**).
  - A charge segment whose Effectif exceeds the leave-adjusted available renders **red**; its tooltip explains the mismatch.
  - The edit modal turns the Effectif field red when over available but **still saves**.
  - A leave whose Owner email is not on the project's ProjectTeam is silently ignored (no crash, no wrong-person shading).
  - Cross-check that gestion-depenses2 (per-month) and planning-synchro (flat) shade the SAME days for the same person/range.

- [ ] **Step 3: Stage any doc updates** (none expected).

---

## Self-review (checklist vs spec)

- **Spec §4 mapping (email→Team→name)** → Task 1 `buildAbsenceIndex`. ✓
- **Spec §5 availableDaysAfterLeave (geometry − absence, ÷2)** → Task 1 + reference test. ✓
- **Spec §6a half-day grey shading** → Task 6 (flat) + Task 11 (per-month). ✓
- **Spec §6b red bar (raw effectif > available)** → Task 6/11 `buildVisibleSegmentBars` + `is-incoherent`. ✓
- **Spec §6c modal readout + non-blocking red** → Task 7 (ps) + Task 12 (gd2). ✓
- **Spec §7 per-widget integration points** → Tasks 3-7 (ps), 8-12 (gd2). ✓
- **Spec §8 shared identical module** → Tasks 1-2 + `diff … && echo IDENTICAL`. ✓
- **Spec §9 edge cases** (unmapped owner, half-day, weekends, effectif null) → Task 1 tests. ✓
- **Spec §10 no Grist writes / Time-Out unchanged** → no widget writes in any task. ✓
- **Type consistency:** `buildAbsenceIndex(timeOutRows, teamRows, timeOutCols, teamCols, absenceTypes)` and `availableDaysAfterLeave(startAt, endAt, absenceSet)` used identically in Tasks 1/5/6/7/10/11/12; `worker.absenceSet` produced in Tasks 5/10 and consumed in 6/7/11/12; slot key `"YYYY-MM-DD:am|pm"` consistent between module and both `renderTrackGrid`. ✓
- **Commits by user** → every task ends at `git add`. ✓
- **Note:** Tasks 6/7/11/12 modify large existing DOM files; they carry precise deltas + insertion points and are verified by `node --check` + the manual Grist checklist (Task 13), since the DOM/drag layers are not unit-tested in these widgets (consistent with their existing test coverage).
```
