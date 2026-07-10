# French Public Holidays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically grey out French métropole public holidays (computed, no data entry) exactly like weekends — greyed in the grid AND excluded from working/available/leave-day counts — across Time-Out, gestion-depenses2, and planning-synchro.

**Architecture:** A pure `frenchHolidays.js` module (Easter via Meeus + the 11 métropole holidays, cached per year) is copied byte-identically into each widget's `utils/`. Each of the 5 `isBusinessDay` definitions gains `&& !isFrenchHoliday(date)`, so holidays propagate automatically to grid shading and day-count math everywhere.

**Tech Stack:** Vanilla ES modules, Grist Plugin API, Node built-in test runner. No npm/bundler.

## Global Constraints

- **11 métropole holidays** (no Alsace-Moselle): 01-01, Lundi de Pâques (Easter+1), 05-01, 05-08, Ascension (Easter+39), Lundi de Pentecôte (Easter+50), 07-14, 08-15, 11-01, 11-11, 12-25.
- **Behavior = like weekends:** greyed AND excluded from counts, via extending `isBusinessDay`.
- **`frenchHolidays.js` is byte-identical in all 3 widgets** and self-contained (no imports).
- **`leaveAbsences.js` must stay byte-identical between planning-synchro and gestion-depenses2** — both receive the exact same import + one-line edit.
- **Local date keys** `YYYY-MM-DD` (from `getFullYear/getMonth/getDate`) to match the existing `isBusinessDay` local `getDay()` logic.
- **No Grist writes, no config, no table.** Widgets outside scope (Synchro, gestion-depenses, gestion-depenses3, synchronisation-plannings) untouched.
- **Commits by the USER** — steps end at `git add`; never `git commit`/`git push`.
- **Node ≥ 22.** Existing suites must stay green (Time-Out 30, planning-synchro 80, gestion-depenses2 5) — see the non-regression note in Task 2/3.

## Source references (the 5 `isBusinessDay`)

- `Time-Out/assets/js/utils/textSegments.js:43` (exported; used by board grid + frise)
- `planning-synchro/assets/js/utils/timeSegments.js:54` (exported; used by chargeBoard grid + slot counts)
- `planning-synchro/assets/js/utils/leaveAbsences.js:39` (private; used by absence slot counts)
- `gestion-depenses2/assets/js/utils/timeSegments.js:83` (exported; used by chargeTimeline grid + slot counts)
- `gestion-depenses2/assets/js/utils/leaveAbsences.js:39` (private)

All 5 currently end with `const day = date.getDay(); return day !== 0 && day !== 6;`.

## File structure

```
Time-Out/assets/js/utils/frenchHolidays.js         Task 1 (NEW)
Time-Out/tests/frenchHolidays.test.mjs             Task 1 (NEW)
planning-synchro/assets/js/utils/frenchHolidays.js Task 1 (NEW, identical)
planning-synchro/tests/frenchHolidays.test.mjs     Task 1 (NEW)
gestion-depenses2/assets/js/utils/frenchHolidays.js Task 1 (NEW, identical)
gestion-depenses2/tests/frenchHolidays.test.mjs    Task 1 (NEW)
Time-Out/assets/js/utils/textSegments.js           Task 2
planning-synchro/assets/js/utils/timeSegments.js   Task 2
planning-synchro/assets/js/utils/leaveAbsences.js  Task 2
gestion-depenses2/assets/js/utils/timeSegments.js  Task 2
gestion-depenses2/assets/js/utils/leaveAbsences.js Task 2
```

---

### Task 1: `frenchHolidays.js` + tests (all 3 widgets)

**Files:**
- Create: `Time-Out/assets/js/utils/frenchHolidays.js` + `Time-Out/tests/frenchHolidays.test.mjs`
- Create: `planning-synchro/assets/js/utils/frenchHolidays.js` + `planning-synchro/tests/frenchHolidays.test.mjs`
- Create: `gestion-depenses2/assets/js/utils/frenchHolidays.js` + `gestion-depenses2/tests/frenchHolidays.test.mjs`

**Interfaces:**
- Produces: `computeEaster(year)->Date`, `isFrenchHoliday(date)->boolean`.

- [ ] **Step 1: Write the failing test** at `Time-Out/tests/frenchHolidays.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEaster, isFrenchHoliday } from "../assets/js/utils/frenchHolidays.js";

test("computeEaster: 2026 = 5 April, 2027 = 28 March, 2025 = 20 April", () => {
  assert.deepEqual(computeEaster(2026), new Date(2026, 3, 5));
  assert.deepEqual(computeEaster(2027), new Date(2027, 2, 28));
  assert.deepEqual(computeEaster(2025), new Date(2025, 3, 20));
});

test("isFrenchHoliday: the 11 métropole holidays of 2026 are holidays", () => {
  const days = [
    [2026, 1, 1], [2026, 4, 6], [2026, 5, 1], [2026, 5, 8], [2026, 5, 14],
    [2026, 5, 25], [2026, 7, 14], [2026, 8, 15], [2026, 11, 1], [2026, 11, 11], [2026, 12, 25],
  ];
  for (const [y, m, d] of days) {
    assert.equal(isFrenchHoliday(new Date(y, m - 1, d)), true, `${y}-${m}-${d}`);
  }
});

test("isFrenchHoliday: normal weekday + invalid date are not holidays", () => {
  assert.equal(isFrenchHoliday(new Date(2026, 6, 15)), false); // 15 July 2026
  assert.equal(isFrenchHoliday(new Date("nope")), false);
  assert.equal(isFrenchHoliday(null), false);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd Time-Out && node --test "tests/frenchHolidays.test.mjs"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `Time-Out/assets/js/utils/frenchHolidays.js`**

```js
// frenchHolidays.js — pure, self-contained. French métropole public holidays,
// computed (Easter via the anonymous Gregorian / Meeus algorithm). No imports.
// BYTE-IDENTICAL copy in each widget. Keys are LOCAL "YYYY-MM-DD" to match the
// widgets' local getDay()/getDate() isBusinessDay logic.

const holidayCache = new Map();

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) → Easter Sunday.
export function computeEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function holidaySet(year) {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set([
    `${year}-01-01`, // Jour de l'an
    `${year}-05-01`, // Fête du travail
    `${year}-05-08`, // Victoire 1945
    `${year}-07-14`, // Fête nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ]);
  const easter = computeEaster(year);
  const addEasterOffset = (offset) => {
    const d = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + offset);
    set.add(dateKey(d));
  };
  addEasterOffset(1); // Lundi de Pâques
  addEasterOffset(39); // Ascension
  addEasterOffset(50); // Lundi de Pentecôte
  holidayCache.set(year, set);
  return set;
}

export function isFrenchHoliday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  return holidaySet(date.getFullYear()).has(dateKey(date));
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd Time-Out && node --test "tests/frenchHolidays.test.mjs"` → 3 tests pass. Then `node --test "tests/**/*.test.mjs"` → Time-Out suite green (30 + 3 = 33).

- [ ] **Step 5: Copy the module + test byte-identically into the other two widgets**

Run:
```bash
cp "Time-Out/assets/js/utils/frenchHolidays.js" "planning-synchro/assets/js/utils/frenchHolidays.js"
cp "Time-Out/tests/frenchHolidays.test.mjs" "planning-synchro/tests/frenchHolidays.test.mjs"
cp "Time-Out/assets/js/utils/frenchHolidays.js" "gestion-depenses2/assets/js/utils/frenchHolidays.js"
cp "Time-Out/tests/frenchHolidays.test.mjs" "gestion-depenses2/tests/frenchHolidays.test.mjs"
```
Then verify:
```bash
cd planning-synchro && node --test "tests/frenchHolidays.test.mjs"
cd ../gestion-depenses2 && node --test "tests/frenchHolidays.test.mjs"
```
Both → 3 tests pass. And `diff Time-Out/assets/js/utils/frenchHolidays.js planning-synchro/assets/js/utils/frenchHolidays.js && diff Time-Out/assets/js/utils/frenchHolidays.js gestion-depenses2/assets/js/utils/frenchHolidays.js` → no output (identical).

- [ ] **Step 6: Stage**

```bash
git add Time-Out/assets/js/utils/frenchHolidays.js Time-Out/tests/frenchHolidays.test.mjs planning-synchro/assets/js/utils/frenchHolidays.js planning-synchro/tests/frenchHolidays.test.mjs gestion-depenses2/assets/js/utils/frenchHolidays.js gestion-depenses2/tests/frenchHolidays.test.mjs
```

---

### Task 2: Wire `isFrenchHoliday` into the 5 `isBusinessDay`

**Files (modify):**
- `Time-Out/assets/js/utils/textSegments.js`
- `planning-synchro/assets/js/utils/timeSegments.js`
- `planning-synchro/assets/js/utils/leaveAbsences.js`
- `gestion-depenses2/assets/js/utils/timeSegments.js`
- `gestion-depenses2/assets/js/utils/leaveAbsences.js`

**Interfaces:**
- Consumes: `isFrenchHoliday` from `./frenchHolidays.js` (same `utils/` dir in every file).

- [ ] **Step 1:** In EACH of the 5 files, add the import near the top (after the existing imports if any; `leaveAbsences.js` currently has no imports — add this as its first import):

```js
import { isFrenchHoliday } from "./frenchHolidays.js";
```

- [ ] **Step 2:** In EACH of the 5 files, change the `isBusinessDay` return line from:

```js
  return day !== 0 && day !== 6;
```

to:

```js
  return day !== 0 && day !== 6 && !isFrenchHoliday(date);
```

(The function body is `const day = date.getDay(); return day !== 0 && day !== 6;` in all 5 — only the return changes.)

- [ ] **Step 3: Syntax check all 5**

Run: `node --check` on each of the 5 files → all OK.

- [ ] **Step 4: Run every suite (non-regression)**

Run:
```bash
cd Time-Out && node --test "tests/**/*.test.mjs"
cd ../planning-synchro && node --test "tests/**/*.test.mjs"
cd ../gestion-depenses2 && node --test "tests/**/*.test.mjs"
```
Expected: all green (Time-Out 33, planning-synchro 83, gestion-depenses2 8).

**Non-regression note (important):** a pre-existing test could break ONLY if its fixture dates land on a newly-excluded holiday (e.g. a test counting business days over a range that includes 1 May or 14 July). If a test breaks:
- Confirm the break is due to a date now being a holiday (not a real bug).
- Fix by shifting that test's fixture dates to non-holiday weekdays (do NOT weaken assertions; just move the sample dates off the holiday). Report which test and which date you moved.
- The charge reference test (29 June→10 July) contains no holiday (14 July is outside `[29 Jun, 10 Jul]`), so it must stay green unchanged — if it fails, something else is wrong; investigate.

- [ ] **Step 5: Confirm `leaveAbsences.js` still byte-identical**

Run: `diff planning-synchro/assets/js/utils/leaveAbsences.js gestion-depenses2/assets/js/utils/leaveAbsences.js` → no output. (Both got the exact same import + edit.)

- [ ] **Step 6: Stage**

```bash
git add Time-Out/assets/js/utils/textSegments.js planning-synchro/assets/js/utils/timeSegments.js planning-synchro/assets/js/utils/leaveAbsences.js gestion-depenses2/assets/js/utils/timeSegments.js gestion-depenses2/assets/js/utils/leaveAbsences.js
```

---

### Task 3: Full verification

**Files:** none.

- [ ] **Step 1: Run all three suites once more** (as Task 2 Step 4) → all green.

- [ ] **Step 2: Manual verification in Grist (user, cannot run headless):**
  - In each of the 3 widgets, a French public holiday in the visible range is shaded dark like a weekend (e.g. 14 July, 1 May, or the Easter Monday of the year).
  - A charge segment spanning a holiday shows a reduced "jours disponibles" (holiday excluded); if its Effectif now exceeds it, it goes red — expected.
  - In Time-Out, a leave spanning a holiday no longer counts the holiday half-days (the "X j" ghost during drag), and the holiday column is greyed.

- [ ] **Step 3:** No staging (verification only).

---

## Self-review (vs spec)

- **Spec §3.1 module (computeEaster, isFrenchHoliday, cache, local keys)** → Task 1. ✓
- **Spec §2 11 holidays (8 fixed + 3 Easter-based)** → Task 1 `holidaySet` + tests. ✓
- **Spec §3.2 wire 5 isBusinessDay** → Task 2 (exact files/lines). ✓
- **Spec §2 byte-identical module + leaveAbsences parity** → Task 1 Step 5 diff + Task 2 Step 5 diff. ✓
- **Spec §4 propagation (grey + counts)** → automatic via isBusinessDay; verified in Task 3 manual. ✓
- **Spec §5 edge cases (cache, invalid date, holiday on weekend, mobile years)** → Task 1 tests (2025/2026/2027, invalid/null). ✓
- **Spec §6 non-regression** → Task 2 Step 4 note + Task 3. ✓
- **Type consistency:** `isFrenchHoliday(date)` defined Task 1, imported+called in all 5 files Task 2; `computeEaster(year)` defined + tested Task 1. ✓
- **Commits by user** → tasks end at `git add`. ✓
```
