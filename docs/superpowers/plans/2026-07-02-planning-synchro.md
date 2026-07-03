# planning-synchro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `planning-synchro/`, a single-page Grist widget that stacks Planning Projet (read-only, vis-timeline) and the gestion-depenses2 plan de charge (editable, custom grid) on one shared timeline, with no iframes.

**Architecture:** Approach C2 — two rendering engines mounted as ES modules in one document. A single canonical viewport drives both engines synchronously in one `requestAnimationFrame`; alignment is arithmetic (same `visibleDays` over the same content width in the same document), removing the iframe/postMessage/measure-and-nudge machinery that made `Synchro` drift and stutter. Bounds come only from TimeSegment; the initial window is ~1 year anchored on the earliest Planning Projet phase date.

**Tech Stack:** Vanilla ES modules, vis-timeline (CDN), Grist Plugin API (`grist.docApi.fetchTable` / `applyUserActions`), `node --test` for pure-logic unit tests, a local static server + mock-Grist harness for browser verification.

## Global Constraints

- Widget access: `grist.ready({ requiredAccess: "full" })` — verbatim, once, at bootstrap.
- Folder name: `planning-synchro` (sibling of `Planning Projet/`, `gestion-depenses2/`, `Synchro/`).
- Project linking: shared `localStorage` keys `grist.selected-project` (name) + `grist.selected-project-id` (id); pivot table `Projets2` (`Nom_de_projet`, `Numero_de_projet`) bridges name↔numéro. Never use `Nom XML` for linking.
- Planning Projet is **read-only**; only the plan de charge (TimeSegment) is editable.
- Frise bounds = TimeSegment only: `min(Start_At)` → `max(End_At)`. Planning Projet never widens them.
- Initial visible window = ~365 days wide, left-anchored on the earliest Planning Projet phase start, clamped to bounds.
- Dates: accept ISO (`2027-03-16`), FR (`02/02/2027`), FR datetime (`06/04/2026 08:00`), epoch seconds/ms. Write TimeSegment datetimes as **epoch seconds**.
- Decimals: normalize comma to point (`"8,5"` → `8.5`).
- Rows in Planning_Projet with no task (zone-only) are excluded from display.
- No new npm runtime dependencies. `node:test`/`node:assert` (Node ≥18) only, for dev tests.
- All Grist cell values pass through `toText` (handles `{details|label|name|value}` objects).
- Pure-logic modules (`utils/dates.js`, `utils/format.js`, `utils/timeSegments.js`, `viewport/*`, `top/phases.js`, `services/projectRegistry.js` resolution helpers, `sync/viewportMath.js`, `top/bounds.js`) MUST be importable in Node — no top-level access to `window`/`document`/`localStorage`. Guard any browser access behind `typeof window !== "undefined"` or keep it in DOM-only modules.

---

## Reference source files (for ports)

Copy/adapt from these; they are the authority:

- Date parse (Planning): `Planning Projet/assets/js/services/planningService.js` → `parseCalendarDate`, `formatIsoDate`, `getPlanningSegmentStartDate`, `isCoffrageTypeDoc`/`isArmaturesTypeDoc`, `normalizePlanningDocumentType` (from `gestion-depenses2/assets/js/utils/planningRealisation.js`).
- Phase model + tooltip + aggregate: `Planning Projet/assets/js/ui/timeline.js` (functions `getPhaseTooltipMetaFromClassName`, `buildPhaseTooltipHtml`, `getNativePhaseTitle`, and the item/phase construction + `visualAggregateMode` logic — search `aggregateTasks`, `setPlanningVisualAggregateMode` in `Planning Projet/assets/js/main.js`).
- Charge grid + roles + Editer: `gestion-depenses2/assets/js/ui/chargeTimeline.js` (whole file; `renderChargePlanTimeline`, slot math `buildVisibleSlots`, `renderRoleRow`, `renderTimelineEditToolbar`, context menu/preview helpers).
- Charge editing wiring: `gestion-depenses2/assets/js/main.js` (search `data-charge-plan-edit-toggle`, `charge-plan-segment-handle`, `charge-plan-context-action`, `computeChargePlanSelection`, `createTimeSegment`, `updateTimeSegment`, `removeTimeSegment`).
- TimeSegment CRUD + fetch: `gestion-depenses2/assets/js/services/gristService.js`.
- Half-day/format utils: `gestion-depenses2/assets/js/utils/timeSegments.js`, `.../utils/format.js`.
- Viewport model: `Synchro/assets/js/viewport/{normalize,build,bounds}.js`.
- Selector + shared-key pattern: `Planning Projet/assets/js/ui/selectors.js`, `.../state.js`; `resolveProjectSelection` therein.

---

## Task 1: Scaffolding, dev harness, and test runner

**Files:**
- Create: `planning-synchro/index.html`
- Create: `planning-synchro/assets/js/config.js`
- Create: `planning-synchro/assets/css/variables.css`
- Create: `planning-synchro/assets/css/styles.css`
- Create: `planning-synchro/dev/mock-grist.js`
- Create: `planning-synchro/dev/harness.html`
- Create: `planning-synchro/dev/fixtures.js`
- Create: `planning-synchro/tests/smoke.test.mjs`

**Interfaces:**
- Produces: `APP_CONFIG` (default export shape below); a dev harness that injects `window.grist` mock + fixtures and boots `assets/js/main.js`; `node --test` runs `planning-synchro/tests/*.test.mjs`.

- [ ] **Step 1: Create `config.js`** with tables/columns/zoom modes.

```js
export const APP_CONFIG = {
  sharedProjectStorageKey: "grist.selected-project",
  sharedProjectIdStorageKey: "grist.selected-project-id",
  storageKey: "planning-synchro.state",
  initialWindowDays: 365,
  months: ["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"],
  zoomModes: {
    week:  { label: "Semaine", targetVisibleDays: 7 },
    month: { label: "Mois",    targetVisibleDays: 31 },
    year:  { label: "Annee",   targetVisibleDays: 365 },
  },
  viewport: { minVisibleDays: 7, maxVisibleDays: 366, referenceMonthDays: 30.4375 },
  grist: {
    tables: {
      projects: "Projets2",
      planningProject: "Planning_Projet",
      timeSegment: "TimeSegment",
      projectTeam: "ProjectTeam",
    },
    columns: {
      projects:  { id: "id", name: "Nom_de_projet", number: "Numero_de_projet" },
      planningProject: {
        id: "id", projectName: "NomProjet", taskName: "Taches", taskNameAlt: "Tache",
        typeDoc: "Type_doc", lignePlanning: "Ligne_planning", zone: "Zone",
        dateLimite: "Date_limite", duree1: "Duree_1", diffCoffrage: "Diff_coffrage",
        duree2: "Duree_2", diffArmature: "Diff_armature", duree3: "Duree_3",
        demarragesTravaux: "Demarrages_travaux", indice: "Indice", nomXml: "Nom_XML",
      },
      timeSegment: {
        id: "id", projectNumber: "NumeroProjet", name: "Name",
        startDate: "Start_At", endDate: "End_At",
        allocationDays: "Allocation_Days", effectif: "Effectif", label: "Label",
      },
      projectTeam: { id: "id", projectNumber: "NumeroProjet", role: "Role", name: "Name", dailyRate: "Daily_Rate" },
    },
  },
};
```

- [ ] **Step 2: Create `index.html`** loading grist-plugin-api, vis-timeline, and the app.

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Planning + Plan de charge</title>
  <script src="https://docs.getgrist.com/grist-plugin-api.js"></script>
  <script src="https://unpkg.com/vis-timeline/standalone/umd/vis-timeline-graph2d.min.js"></script>
  <link rel="stylesheet" href="https://unpkg.com/vis-timeline/styles/vis-timeline-graph2d.min.css" />
  <link rel="stylesheet" href="./assets/css/variables.css" />
  <link rel="stylesheet" href="./assets/css/styles.css" />
  <script type="module" src="./assets/js/main.js"></script>
</head>
<body>
  <header id="ps-toolbar" class="ps-toolbar">
    <div class="ps-project">
      <label for="ps-project-select">Projet :</label>
      <select id="ps-project-select"><option value="">Choisir un projet</option></select>
    </div>
    <div class="ps-nav">
      <button id="ps-prev" type="button" title="Periode precedente">&lt;</button>
      <button id="ps-today" type="button">Aujourd'hui</button>
      <button id="ps-next" type="button" title="Periode suivante">&gt;</button>
    </div>
    <div class="ps-zoom" role="group" aria-label="Zoom">
      <button type="button" data-ps-zoom="week">Semaine</button>
      <button type="button" data-ps-zoom="month" class="is-active">Mois</button>
      <button type="button" data-ps-zoom="year">Annee</button>
    </div>
    <div id="ps-range" class="ps-range" aria-live="polite">-</div>
  </header>

  <section id="ps-empty" class="ps-empty" hidden>
    <p>Selectionne un projet pour afficher les plannings.</p>
  </section>

  <main id="ps-main" class="ps-main" hidden>
    <div class="ps-pane ps-pane--planning">
      <label class="ps-aggregate">
        <input id="ps-aggregate-toggle" type="checkbox" />
        <span>Rassembler visuellement le planning</span>
      </label>
      <div id="ps-planning" class="ps-planning"></div>
    </div>
    <div class="ps-pane ps-pane--charge">
      <div id="ps-charge" class="ps-charge"></div>
      <div id="ps-charge-empty" class="ps-charge-empty" hidden>Aucun previsionnel pour ce projet.</div>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 3: Create empty CSS files** `variables.css` and `styles.css` with a single placeholder rule each (filled in Task 14).

```css
/* variables.css */ :root { --ps-left-col-width: 220px; }
```
```css
/* styles.css */ body { margin: 0; font-family: system-ui, sans-serif; }
```

- [ ] **Step 4: Create `dev/mock-grist.js`** — a minimal `window.grist` that serves fixtures and records `applyUserActions`.

```js
// Injected before main.js in dev/harness.html. Mirrors the subset of the Grist API this widget uses.
import { FIXTURE_TABLES } from "./fixtures.js";
window.__appliedActions = [];
window.grist = {
  ready() {},
  docApi: {
    async fetchTable(name) {
      const rows = FIXTURE_TABLES[name] || [];
      const cols = rows.length ? Object.keys(rows[0]) : ["id"];
      const out = {};
      cols.forEach((c) => { out[c] = rows.map((r) => r[c]); });
      return out; // column-oriented, like Grist
    },
    async applyUserActions(actions) {
      window.__appliedActions.push(...actions);
      return { retValues: actions.map(() => 999) };
    },
  },
};
```

- [ ] **Step 5: Create `dev/fixtures.js`** with realistic rows for the 5 known projects (at minimum ERA QUAI D'ORSAY with number 252035).

```js
export const FIXTURE_TABLES = {
  Projets2: [
    { id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035" },
    { id: 2, Nom_de_projet: "HOTEL DIEU", Numero_de_projet: "12345" },
  ],
  Planning_Projet: [
    { id: 1, NomProjet: "ERA QUAI D'ORSAY", Taches: "FONDATIONS", Type_doc: "COFFRAGE", Ligne_planning: "1", Zone: "Z01", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16", Diff_armature: "2027-04-01", Demarrages_travaux: "2027-05-01" },
    { id: 2, NomProjet: "ERA QUAI D'ORSAY", Taches: "LONGRINES", Type_doc: "ARMATURES", Ligne_planning: "2", Zone: "Z01", Date_limite: "2027-02-10", Diff_coffrage: "2027-03-20", Diff_armature: "2027-04-05" },
    { id: 3, NomProjet: "ERA QUAI D'ORSAY", Taches: "", Type_doc: "", Zone: "Z02" }, // zone-only, excluded
  ],
  TimeSegment: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Start_At: "06/04/2026 08:00", End_At: "10/04/2026 17:00", Allocation_Days: "4,5", Effectif: "1", Label: "" },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Start_At: "01/06/2026 08:00", End_At: "30/06/2026 17:00", Allocation_Days: "20", Effectif: "1", Label: "" },
  ],
  ProjectTeam: [
    { id: 1, NumeroProjet: "252035", Name: "Fouzia Raggui", Role: "Projeteur", Daily_Rate: 0 },
    { id: 2, NumeroProjet: "252035", Name: "Guillaume Sadot", Role: "Ingenieur", Daily_Rate: 0 },
  ],
};
```

- [ ] **Step 6: Create `dev/harness.html`** — same as `index.html` but injects the mock before `main.js`.

Copy `index.html`, and replace the `grist-plugin-api.js` script tag with:
```html
<script type="module" src="./mock-grist.js"></script>
```
Adjust asset paths to `../assets/...` and `main.js` to `../assets/js/main.js`.

- [ ] **Step 7: Create `tests/smoke.test.mjs`** verifying config import.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_CONFIG } from "../assets/js/config.js";

test("config exposes required tables", () => {
  assert.equal(APP_CONFIG.grist.tables.timeSegment, "TimeSegment");
  assert.equal(APP_CONFIG.grist.tables.planningProject, "Planning_Projet");
  assert.equal(APP_CONFIG.initialWindowDays, 365);
});
```

- [ ] **Step 8: Run tests.**

Run: `cd "planning-synchro" && node --test`
Expected: PASS (1 test).

- [ ] **Step 9: Commit.**

```bash
git add planning-synchro
git commit -m "feat(planning-synchro): scaffold widget, dev harness, test runner"
```

---

## Task 2: `utils/dates.js` — robust multi-format date parsing (pure, TDD)

**Files:**
- Create: `planning-synchro/assets/js/utils/dates.js`
- Test: `planning-synchro/tests/dates.test.mjs`

**Interfaces:**
- Produces:
  - `parseCalendarDate(value): Date|null` — ISO/FR/epoch → local calendar Date (midnight).
  - `parseDateTime(value): Date|null` — like Planning + FR datetime `JJ/MM/AAAA HH:mm` + epoch s/ms (port of `parseRawDateTime`).
  - `formatIsoDate(date): string` (`YYYY-MM-DD`).
  - `toText(value): string`.
  - `normalizeDecimal(value): number|null` — `"8,5"` → `8.5`.

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCalendarDate, parseDateTime, formatIsoDate, normalizeDecimal, toText } from "../assets/js/utils/dates.js";

test("parseCalendarDate handles ISO and FR", () => {
  assert.equal(formatIsoDate(parseCalendarDate("2027-03-16")), "2027-03-16");
  assert.equal(formatIsoDate(parseCalendarDate("02/02/2027")), "2027-02-02");
  assert.equal(parseCalendarDate(""), null);
  assert.equal(parseCalendarDate("not a date"), null);
});

test("parseDateTime handles FR datetime and epoch seconds", () => {
  assert.equal(formatIsoDate(parseDateTime("06/04/2026 08:00")), "2026-04-06");
  const s = Math.floor(Date.UTC(2026, 3, 6, 6, 0, 0) / 1000);
  assert.equal(parseDateTime(s) instanceof Date, true);
});

test("normalizeDecimal converts comma", () => {
  assert.equal(normalizeDecimal("8,5"), 8.5);
  assert.equal(normalizeDecimal("20"), 20);
  assert.equal(normalizeDecimal(""), null);
});

test("toText unwraps grist objects", () => {
  assert.equal(toText({ label: " x " }), "x");
  assert.equal(toText(3), "3");
});
```

- [ ] **Step 2: Run tests, verify they fail.**

Run: `node --test tests/dates.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `utils/dates.js`** by porting `parseCalendarDate`/`formatIsoDate` from `Planning Projet/.../planningService.js` (lines ~63-233) and `parseRawDateTime` from `gestion-depenses2/.../utils/timeSegments.js` (lines ~34-75). Rename `parseRawDateTime` → `parseDateTime`. Add:

```js
export function toText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    for (const k of ["details", "label", "name", "display", "Name", "value"]) {
      if (typeof value[k] === "string") return value[k].trim();
    }
  }
  return String(value).trim();
}
export function normalizeDecimal(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
```
Ensure no top-level `window`/`document` usage.

- [ ] **Step 4: Run tests, verify pass.**

Run: `node --test tests/dates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/utils/dates.js planning-synchro/tests/dates.test.mjs
git commit -m "feat(planning-synchro): robust multi-format date/decimal parsing"
```

---

## Task 3: `utils/format.js` + `utils/timeSegments.js` — shared math (port, TDD on key fns)

**Files:**
- Create: `planning-synchro/assets/js/utils/format.js`
- Create: `planning-synchro/assets/js/utils/timeSegments.js`
- Test: `planning-synchro/tests/timeSegments.test.mjs`

**Interfaces:**
- Produces (`format.js`): `toFiniteNumber(v, fallback=0)`, `formatNumber(v)`, `clamp(v,min,max)`, `buildDisplayedMonths(year, monthIndex, monthSpan, monthLabels)` → `[{ monthKey, monthLabel, year, calendarDayCount, calendarDayDates:Date[], businessDayCount }]`.
- Produces (`timeSegments.js`): `HALF_DAY_PARTS`, `isBusinessDay`, `getHalfDaySlotRange`, `createHalfDaySlotKey`, `getSegmentEffectiveDays(segment)`, `toGristDateTimeValue(value)` (epoch seconds).

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDisplayedMonths, toFiniteNumber } from "../assets/js/utils/format.js";
import { getSegmentEffectiveDays } from "../assets/js/utils/timeSegments.js";

test("buildDisplayedMonths returns contiguous months with day dates", () => {
  const months = buildDisplayedMonths(2027, 0, 2, ["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"]);
  assert.equal(months.length, 2);
  assert.equal(months[0].calendarDayCount, 31);
  assert.equal(months[0].calendarDayDates.length, 31);
});

test("getSegmentEffectiveDays uses allocation when present", () => {
  const seg = { allocationDays: 4.5, effectif: 1, startAt: new Date(2026,3,6,8), endAt: new Date(2026,3,10,17) };
  assert.equal(getSegmentEffectiveDays(seg) > 0, true);
});

test("toFiniteNumber fallback", () => {
  assert.equal(toFiniteNumber("x", 3), 3);
  assert.equal(toFiniteNumber("2,5".replace(",", "."), 0), 2.5);
});
```

- [ ] **Step 2: Run tests, verify fail.** Run: `node --test tests/timeSegments.test.mjs` → FAIL.

- [ ] **Step 3: Implement** by porting from `gestion-depenses2/.../utils/format.js` (copy `toFiniteNumber`, `formatNumber`, `clamp`, `buildDisplayedMonths`) and `.../utils/timeSegments.js` (copy `HALF_DAY_PARTS`, `HALF_DAY_TIMES`, `isBusinessDay`, `getHalfDaySlotRange`, `createHalfDaySlotKey`, `getBusinessHalfDaySlotsBetween`, `getSegmentAllocationDays`, `getSegmentEffectiveDays`, `toGristDateTimeValue`). Replace the `format.js` import in `timeSegments.js` with the local one. Remove any DOM usage. Keep `parseRawDateTime` importing from `./dates.js` (`parseDateTime`).

- [ ] **Step 4: Run tests, verify pass.** Run: `node --test tests/timeSegments.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/utils/format.js planning-synchro/assets/js/utils/timeSegments.js planning-synchro/tests/timeSegments.test.mjs
git commit -m "feat(planning-synchro): port shared format + half-day slot math"
```

---

## Task 4: `viewport/` — canonical shared viewport model (adapt from Synchro, TDD)

**Files:**
- Create: `planning-synchro/assets/js/viewport/normalize.js`
- Create: `planning-synchro/assets/js/viewport/bounds.js`
- Create: `planning-synchro/assets/js/viewport/build.js`
- Test: `planning-synchro/tests/viewport.test.mjs`

**Interfaces:**
- Produces (`normalize.js`): copy pure helpers from `Synchro/.../viewport/normalize.js` — `clamp`, `normalizeIsoDate`, `getIsoDateFromExactTimestamp`, `shiftIsoDateValue`, `getInclusiveDaySpan`, `parseSharedExactNumber`.
- Produces (`bounds.js`): `getSharedVisibleDaysBounds(viewport)` → `{ monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold }` (from `APP_CONFIG.viewport`, **no** dependence on any expenses API), `isSupportedSharedMode`, `deriveSharedModeFromVisibleDays`, `getTargetVisibleDaysForMode`.
- Produces (`build.js`): `buildCanonicalSharedViewport(viewport)` (port), `buildInitialProjectViewport({ firstPlanningDate, bounds })` → canonical viewport ~365 days anchored on `firstPlanningDate`, clamped to `bounds`.

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalSharedViewport, buildInitialProjectViewport } from "../assets/js/viewport/build.js";

test("canonical viewport derives rangeEndDate and mode", () => {
  const v = buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 31 });
  assert.equal(v.rangeStartDate, "2027-01-01");
  assert.equal(v.visibleDays, 31);
  assert.equal(v.mode, "month");
});

test("initial viewport is ~365 days anchored on first planning date, clamped to bounds", () => {
  const v = buildInitialProjectViewport({
    firstPlanningDate: "2027-02-02",
    bounds: { startDate: "2026-04-06", endDate: "2027-06-30" },
  });
  assert.equal(v.firstVisibleDate, "2027-02-02");
  assert.ok(v.visibleDays >= 100 && v.visibleDays <= 366);
  // window must not exceed bounds end
  assert.ok(v.rangeEndDate <= "2027-06-30");
});

test("initial viewport clamps anchor to bounds start when planning precedes bounds", () => {
  const v = buildInitialProjectViewport({
    firstPlanningDate: "2025-01-01",
    bounds: { startDate: "2026-04-06", endDate: "2027-06-30" },
  });
  assert.ok(v.firstVisibleDate >= "2026-04-06");
});
```

- [ ] **Step 2: Run tests, verify fail.** Run: `node --test tests/viewport.test.mjs` → FAIL.

- [ ] **Step 3: Implement.** Copy `normalize.js` from Synchro verbatim. For `bounds.js`, copy Synchro's `bounds.js` but replace the `state.expensesApi.getViewportBounds` block in `getSharedVisibleDaysBounds` with values from `APP_CONFIG.viewport` only:

```js
import { APP_CONFIG } from "../config.js";
import { clamp } from "./normalize.js";
export function getSharedVisibleDaysBounds() {
  const monthVisibleDays = Number(APP_CONFIG.viewport.referenceMonthDays) || 30.4375;
  const minVisibleDays = Number(APP_CONFIG.viewport.minVisibleDays) || 7;
  const maxVisibleDays = Number(APP_CONFIG.viewport.maxVisibleDays) || 366;
  return { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold: monthVisibleDays * 10 };
}
```
Keep `isSupportedSharedMode`, `deriveSharedModeFromVisibleDays`, `getTargetVisibleDaysForMode` (drop the `viewport` param usage of expenses bounds). For `build.js`, copy `buildCanonicalSharedViewport` from Synchro (drop the exact-window variants; they're iframe-specific). Add:

```js
import { APP_CONFIG } from "../config.js";
import { clamp, normalizeIsoDate, shiftIsoDateValue, getInclusiveDaySpan } from "./normalize.js";
import { getSharedVisibleDaysBounds } from "./bounds.js";

export function buildInitialProjectViewport({ firstPlanningDate, bounds }) {
  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds();
  const boundsStart = normalizeIsoDate(bounds?.startDate);
  const boundsEnd = normalizeIsoDate(bounds?.endDate);
  let anchor = normalizeIsoDate(firstPlanningDate) || boundsStart;
  if (boundsStart && anchor && anchor < boundsStart) anchor = boundsStart;
  if (!anchor) anchor = boundsStart || boundsEnd;
  const boundsSpan = boundsStart && boundsEnd ? getInclusiveDaySpan(boundsStart, boundsEnd) : APP_CONFIG.initialWindowDays;
  let visibleDays = clamp(Math.min(APP_CONFIG.initialWindowDays, boundsSpan), minVisibleDays, maxVisibleDays);
  // keep window within bounds end
  if (boundsEnd && anchor) {
    const maxSpanFromAnchor = getInclusiveDaySpan(anchor, boundsEnd);
    visibleDays = clamp(Math.min(visibleDays, maxSpanFromAnchor), minVisibleDays, maxVisibleDays);
  }
  return buildCanonicalSharedViewport({
    firstVisibleDate: anchor, rangeStartDate: anchor, anchorDate: anchor, visibleDays,
  });
}
```

- [ ] **Step 4: Run tests, verify pass.** Run: `node --test tests/viewport.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/viewport planning-synchro/tests/viewport.test.mjs
git commit -m "feat(planning-synchro): canonical shared viewport + initial 1-year window"
```

---

## Task 5: `top/bounds.js` — TimeSegment bounds computation (pure, TDD)

**Files:**
- Create: `planning-synchro/assets/js/top/bounds.js`
- Test: `planning-synchro/tests/segmentBounds.test.mjs`

**Interfaces:**
- Produces: `computeTimeSegmentBounds(segmentRows, columns)` → `{ startDate, endDate, startMs, endMs }` or `null` when no valid segment. Uses `parseDateTime`.

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTimeSegmentBounds } from "../assets/js/top/bounds.js";

const cols = { startDate: "Start_At", endDate: "End_At" };

test("bounds = min(start) .. max(end)", () => {
  const rows = [
    { Start_At: "06/04/2026 08:00", End_At: "10/04/2026 17:00" },
    { Start_At: "01/06/2026 08:00", End_At: "30/06/2026 17:00" },
  ];
  const b = computeTimeSegmentBounds(rows, cols);
  assert.equal(b.startDate, "2026-04-06");
  assert.equal(b.endDate, "2026-06-30");
});

test("no rows => null", () => {
  assert.equal(computeTimeSegmentBounds([], cols), null);
});
```

- [ ] **Step 2: Run, verify fail.** Run: `node --test tests/segmentBounds.test.mjs` → FAIL.

- [ ] **Step 3: Implement.**

```js
import { parseDateTime, formatIsoDate } from "../utils/dates.js";
export function computeTimeSegmentBounds(rows, columns) {
  let minMs = Infinity, maxMs = -Infinity;
  for (const row of rows || []) {
    const s = parseDateTime(row?.[columns.startDate]);
    const e = parseDateTime(row?.[columns.endDate]);
    if (s) minMs = Math.min(minMs, s.getTime());
    if (e) maxMs = Math.max(maxMs, e.getTime());
    if (s) maxMs = Math.max(maxMs, s.getTime());
    if (e) minMs = Math.min(minMs, e.getTime());
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs < minMs) return null;
  return { startMs: minMs, endMs: maxMs, startDate: formatIsoDate(new Date(minMs)), endDate: formatIsoDate(new Date(maxMs)) };
}
```

- [ ] **Step 4: Run, verify pass.** Run: `node --test tests/segmentBounds.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/top/bounds.js planning-synchro/tests/segmentBounds.test.mjs
git commit -m "feat(planning-synchro): TimeSegment-only frise bounds"
```

---

## Task 6: `top/phases.js` — Planning phase model + aggregation (port, TDD)

**Files:**
- Create: `planning-synchro/assets/js/top/phases.js`
- Test: `planning-synchro/tests/phases.test.mjs`

**Interfaces:**
- Produces:
  - `buildRowPhases(row, columns)` → `[{ type, className, start:Date, end:Date, label, taskLabel }]` (coffrage/armature/ndc/coupes/demolition/generic/demarrage). Empty for zone-only rows.
  - `buildPlanningItems(rows, columns)` → `{ groups:[{id,label,typeDoc}], items:[{id,group,start,end,className,taskLabel,tooltip}] }` for the non-aggregated view (1 group per Ligne_planning/task).
  - `aggregatePlanningItems(rows, columns)` → same shape but 1 group per Type_doc, overlapping same-type phases merged into one item with `aggregateTasks:[{label,start,end}]`.
  - `getFirstPhaseDate(rows, columns)` → ISO string or `""`.
  - `buildPhaseTooltipHtml(item)` (port).

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRowPhases, aggregatePlanningItems, getFirstPhaseDate } from "../assets/js/top/phases.js";

const cols = {
  taskName: "Taches", taskNameAlt: "Tache", typeDoc: "Type_doc", lignePlanning: "Ligne_planning",
  zone: "Zone", dateLimite: "Date_limite", diffCoffrage: "Diff_coffrage", diffArmature: "Diff_armature",
  demarragesTravaux: "Demarrages_travaux",
};

test("coffrage phase spans Date_limite -> Diff_coffrage", () => {
  const phases = buildRowPhases({ Taches: "FONDATIONS", Type_doc: "COFFRAGE", Date_limite: "02/02/2027", Diff_coffrage: "2027-03-16" }, cols);
  const coff = phases.find((p) => p.type === "coffrage");
  assert.ok(coff);
  assert.equal(coff.start.getFullYear(), 2027);
});

test("zone-only row yields no phases", () => {
  assert.equal(buildRowPhases({ Taches: "", Type_doc: "", Zone: "Z02" }, cols).length, 0);
});

test("aggregate merges overlapping same-type into one item with aggregateTasks", () => {
  const rows = [
    { id: 1, Taches: "A", Type_doc: "COFFRAGE", Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" },
    { id: 2, Taches: "B", Type_doc: "COFFRAGE", Date_limite: "2027-01-15", Diff_coffrage: "2027-03-01" },
  ];
  const { groups, items } = aggregatePlanningItems(rows, cols);
  assert.equal(groups.length, 1);
  const merged = items.find((i) => Array.isArray(i.aggregateTasks) && i.aggregateTasks.length === 2);
  assert.ok(merged);
});

test("getFirstPhaseDate returns earliest phase start", () => {
  const rows = [
    { id: 1, Taches: "A", Type_doc: "COFFRAGE", Date_limite: "2027-02-02", Diff_coffrage: "2027-03-16" },
    { id: 2, Taches: "B", Type_doc: "ARMATURES", Diff_coffrage: "2027-01-10", Diff_armature: "2027-02-01" },
  ];
  assert.equal(getFirstPhaseDate(rows, cols), "2027-01-10");
});
```

- [ ] **Step 2: Run, verify fail.** Run: `node --test tests/phases.test.mjs` → FAIL.

- [ ] **Step 3: Implement** by porting the phase construction from `Planning Projet/.../ui/timeline.js` and `getPlanningSegmentStartDate` from `planningService.js`. Key rules (copy verbatim from source):
  - Type detection: `normalizePlanningDocumentType` (port from `gestion-depenses2/.../utils/planningRealisation.js`) → NDC/COFFRAGE/ARMATURES/DEMOLITION/COUPES/generic.
  - coffrage: `Date_limite → Diff_coffrage`; armature: `Diff_coffrage → Diff_armature`; ndc/coupes/demolition/generic: `Date_limite → Diff_coffrage`; demarrage: point at `Demarrages_travaux`.
  - Task label from `Taches || Tache`. Exclude rows where task label is empty AND type is empty (zone-only).
  - Non-aggregated groups: key by `Ligne_planning` (fallback task label). Aggregated groups: key by normalized Type_doc; merge phases of the same type whose `[start,end]` intervals overlap (sort by start, extend current if `next.start <= current.end`), collecting `aggregateTasks`.
  - `getFirstPhaseDate`: min of all phase starts (ISO).
  - `buildPhaseTooltipHtml(item)`: port `buildPhaseTooltipHtml` from `timeline.js` (handles `aggregateTasks` list). Use `dates.js` `formatIsoDate` for date display; escape HTML locally.
  Use `parseCalendarDate` for all Planning dates. No DOM/window at module top-level.

- [ ] **Step 4: Run, verify pass.** Run: `node --test tests/phases.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/top/phases.js planning-synchro/assets/js/tests 2>/dev/null; git add planning-synchro/assets/js/top/phases.js planning-synchro/tests/phases.test.mjs
git commit -m "feat(planning-synchro): Planning phase model + Type-doc aggregation"
```

---

## Task 7: `services/projectRegistry.js` — Projets2 registry + name↔numéro + shared keys (TDD on resolution)

**Files:**
- Create: `planning-synchro/assets/js/services/projectRegistry.js`
- Test: `planning-synchro/tests/projectRegistry.test.mjs`

**Interfaces:**
- Produces:
  - `buildRegistry(projectRows, columns)` → `[{ id, name, number }]`.
  - `resolveProject(registry, { name, id, number })` → `{ id, name, number }|null` (by id, then name, then number; port of `resolveProjectSelection`).
  - `readSharedSelection()` / `writeSharedSelection({ name, id })` — DOM-guarded (`typeof localStorage`).

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry, resolveProject } from "../assets/js/services/projectRegistry.js";

const cols = { id: "id", name: "Nom_de_projet", number: "Numero_de_projet" };
const rows = [{ id: 1, Nom_de_projet: "ERA QUAI D'ORSAY", Numero_de_projet: "252035" }];

test("resolve by name is case/accent tolerant", () => {
  const reg = buildRegistry(rows, cols);
  assert.equal(resolveProject(reg, { name: "era quai d'orsay" })?.number, "252035");
});

test("resolve by number", () => {
  const reg = buildRegistry(rows, cols);
  assert.equal(resolveProject(reg, { number: "252035" })?.name, "ERA QUAI D'ORSAY");
});

test("unknown => null", () => {
  assert.equal(resolveProject(buildRegistry(rows, cols), { name: "zzz" }), null);
});
```

- [ ] **Step 2: Run, verify fail.** Run: `node --test tests/projectRegistry.test.mjs` → FAIL.

- [ ] **Step 3: Implement** porting `normalizeProjectKey`, `normalizeProjectNumber`, `normalizeProjectObjects`, `resolveProjectSelection` from `Planning Projet/.../ui/selectors.js`. `buildRegistry` maps rows via `columns`. Shared-key helpers guarded:

```js
import { APP_CONFIG } from "../config.js";
export function readSharedSelection() {
  if (typeof localStorage === "undefined") return { name: "", id: null };
  const name = (localStorage.getItem(APP_CONFIG.sharedProjectStorageKey) || "").trim();
  const idRaw = Number(localStorage.getItem(APP_CONFIG.sharedProjectIdStorageKey));
  return { name, id: Number.isInteger(idRaw) && idRaw > 0 ? idRaw : null };
}
export function writeSharedSelection({ name, id }) {
  if (typeof localStorage === "undefined") return;
  if (name) localStorage.setItem(APP_CONFIG.sharedProjectStorageKey, name);
  else localStorage.removeItem(APP_CONFIG.sharedProjectStorageKey);
  if (Number.isInteger(id) && id > 0) localStorage.setItem(APP_CONFIG.sharedProjectIdStorageKey, String(id));
  else localStorage.removeItem(APP_CONFIG.sharedProjectIdStorageKey);
}
```

- [ ] **Step 4: Run, verify pass.** Run: `node --test tests/projectRegistry.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/services/projectRegistry.js planning-synchro/tests/projectRegistry.test.mjs
git commit -m "feat(planning-synchro): Projets2 registry + name<->number resolution + shared keys"
```

---

## Task 8: `services/gristService.js` — fetch + TimeSegment CRUD (port)

**Files:**
- Create: `planning-synchro/assets/js/services/gristService.js`
- Test: `planning-synchro/tests/gristService.test.mjs`

**Interfaces:**
- Produces: `initGrist()`, `fetchTableRows(name)`, `fetchProjectData({ name, number })` → `{ planningRows, timeSegmentRows, projectTeamRows }`, `createTimeSegment(...)`, `updateTimeSegment(...)`, `removeTimeSegment(id)`, and pure helper `normalizeFetchTableResult(raw)`, `resolveColumnId(available, requested, aliases)`.

- [ ] **Step 1: Write failing test (pure helpers only).**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFetchTableResult, resolveColumnId } from "../assets/js/services/gristService.js";

test("normalizeFetchTableResult converts column-oriented to rows", () => {
  const rows = normalizeFetchTableResult({ id: [1, 2], Name: ["A", "B"] });
  assert.deepEqual(rows, [{ id: 1, Name: "A" }, { id: 2, Name: "B" }]);
});

test("resolveColumnId matches alias Start_At", () => {
  assert.equal(resolveColumnId(["id", "Start_At"], "Start_Date", ["Start_At"]), "Start_At");
});
```

- [ ] **Step 2: Run, verify fail.** Run: `node --test tests/gristService.test.mjs` → FAIL.

- [ ] **Step 3: Implement** by porting from `gestion-depenses2/.../services/gristService.js`: `getGrist`, `normalizeFetchTableResult`, `normalizeColumnName`, `resolveColumnId`, `getAvailableColumnIds`, `fetchTableRaw`, `fetchTableRows`, `initGrist`, `createTimeSegment`, `updateTimeSegment`, `removeTimeSegment`, `applyActions`. Use `APP_CONFIG.grist` and the local `TIME_SEGMENT_COLUMN_ALIASES` (include `Start_At`/`Start_Date`, `End_At`/`End_Date`). Add:

```js
export async function fetchProjectData({ name, number }) {
  const t = APP_CONFIG.grist.tables;
  const [planningRows, timeSegmentRows, projectTeamRows] = await Promise.all([
    fetchTableRows(t.planningProject).catch(() => []),
    fetchTableRows(t.timeSegment).catch(() => []),
    fetchTableRows(t.projectTeam).catch(() => []),
  ]);
  const pc = APP_CONFIG.grist.columns;
  return {
    planningRows: planningRows.filter((r) => String(r?.[pc.planningProject.projectName] ?? "").trim() === name),
    timeSegmentRows: timeSegmentRows.filter((r) => String(r?.[pc.timeSegment.projectNumber] ?? "").trim() === String(number).trim()),
    projectTeamRows: projectTeamRows.filter((r) => String(r?.[pc.projectTeam.projectNumber] ?? "").trim() === String(number).trim()),
  };
}
```
Keep `initGrist` calling `grist.ready({ requiredAccess: "full" })`.

- [ ] **Step 4: Run, verify pass.** Run: `node --test tests/gristService.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/services/gristService.js planning-synchro/tests/gristService.test.mjs
git commit -m "feat(planning-synchro): grist fetch + TimeSegment CRUD (alias-safe)"
```

---

## Task 9: `sync/viewportMath.js` — interaction → next viewport (pure, TDD)

**Files:**
- Create: `planning-synchro/assets/js/sync/viewportMath.js`
- Test: `planning-synchro/tests/viewportMath.test.mjs`

**Interfaces:**
- Produces:
  - `applyMode(viewport, mode)` → canonical viewport with `visibleDays = zoomModes[mode].targetVisibleDays`, same anchor.
  - `panByDays(viewport, deltaDays)` → shifted canonical viewport.
  - `clampToBounds(viewport, bounds)` → viewport whose `[firstVisibleDate, rangeEndDate]` stays within bounds (shrinks/shifts as needed).
  - `getDayBoundaryLeftPx(viewport, isoDate, contentWidthPx)` → x pixel for a date's left edge (used by the alignment assertion).

- [ ] **Step 1: Write failing tests.**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMode, panByDays, clampToBounds, getDayBoundaryLeftPx } from "../assets/js/sync/viewportMath.js";
import { buildCanonicalSharedViewport } from "../assets/js/viewport/build.js";

const base = buildCanonicalSharedViewport({ firstVisibleDate: "2027-01-01", visibleDays: 31 });

test("applyMode(week) sets 7 visible days", () => {
  assert.equal(applyMode(base, "week").visibleDays, 7);
});

test("panByDays shifts start", () => {
  assert.equal(panByDays(base, 7).firstVisibleDate, "2027-01-08");
});

test("clampToBounds keeps window inside bounds", () => {
  const v = clampToBounds(buildCanonicalSharedViewport({ firstVisibleDate: "2027-06-01", visibleDays: 60 }), { startDate: "2026-04-06", endDate: "2027-06-30" });
  assert.ok(v.rangeEndDate <= "2027-06-30");
});

test("getDayBoundaryLeftPx is proportional", () => {
  const w = 620; // content width
  const x0 = getDayBoundaryLeftPx(base, "2027-01-01", w);
  const x1 = getDayBoundaryLeftPx(base, "2027-01-02", w);
  assert.ok(Math.abs((x1 - x0) - w / 31) < 0.001);
});
```

- [ ] **Step 2: Run, verify fail.** Run: `node --test tests/viewportMath.test.mjs` → FAIL.

- [ ] **Step 3: Implement** using `viewport/build.js` + `viewport/normalize.js` (`shiftIsoDateValue`, `getInclusiveDaySpan`). `getDayBoundaryLeftPx = (daysFromStart) * (contentWidthPx / visibleDays)`.

- [ ] **Step 4: Run, verify pass.** Run: `node --test tests/viewportMath.test.mjs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add planning-synchro/assets/js/sync/viewportMath.js planning-synchro/tests/viewportMath.test.mjs
git commit -m "feat(planning-synchro): pure viewport interaction math + day-boundary px"
```

---

## Task 10: `top/planningRenderer.js` — read-only vis-timeline pane (browser-verified)

**Files:**
- Create: `planning-synchro/assets/js/top/planningRenderer.js`

**Interfaces:**
- Consumes: `buildPlanningItems`/`aggregatePlanningItems`/`buildPhaseTooltipHtml` (Task 6); vis-timeline global `vis`.
- Produces: `createPlanningRenderer(containerEl)` → `{ render({ rows, columns, aggregate }), setWindow(startDate, endDate), setAggregate(bool), getFirstPhaseDate(), destroy() }`. vis options: `editable:false`, `selectable:false`, `zoomable:false`, `moveable:false`, `stack:true`, `orientation:{axis:"top"}`, `margin` small. Group `content` = `Taches` label only. Attach `title` tooltip from `buildPhaseTooltipHtml`.

- [ ] **Step 1: Implement** `createPlanningRenderer`. Build `vis.DataSet` for groups/items from Task 6 output; convert phase `start`/`end` Date to vis items; `className` per phase type (reuse `phase-*` names so existing colors can be applied via CSS). `setWindow` calls `timeline.setWindow(new Date(start+'T00:00:00'), new Date(end+'T23:59:59'), { animation:false })`. `setAggregate` re-renders from the appropriate builder. Native interactions disabled so the shared controller owns the window.

- [ ] **Step 2: Add CSS** for `phase-*` item colors in `styles.css` (copy the relevant color rules from `Planning Projet/assets/css/styles.css` — search `.phase-coffrage`, `.phase-armature`, etc.).

- [ ] **Step 3: Browser-verify with harness.** Start a static server and load the harness:

Run: `cd planning-synchro && python -m http.server 8777`
Open `http://localhost:8777/dev/harness.html`, select "ERA QUAI D'ORSAY".
Expected: top pane shows task bars (FONDATIONS coffrage, LONGRINES armature); left column shows only task names; hovering a bar shows a tooltip with the phase dates. Toggling the checkbox collapses to 1 row per Type doc and a merged COFFRAGE bar whose tooltip lists composing tasks.

Use the available browser tooling (chrome-devtools/playwright MCP) to automate: navigate, click option, assert `.vis-item` count > 0, toggle `#ps-aggregate-toggle`, assert group count decreased.

- [ ] **Step 4: Commit.**

```bash
git add planning-synchro/assets/js/top/planningRenderer.js planning-synchro/assets/css/styles.css
git commit -m "feat(planning-synchro): read-only vis-timeline planning pane + aggregate"
```

---

## Task 11: `bottom/chargeBoard.js` — charge grid render, roles-only header (browser-verified)

**Files:**
- Create: `planning-synchro/assets/js/bottom/chargeBoard.js`

**Interfaces:**
- Consumes: half-day slot math (Task 3), `groupWorkersByRole` (port a minimal version), `format.js`.
- Produces: `createChargeBoard(containerEl)` → `{ render({ workers, viewport, editMode, boundsMonths }), setWindow(viewport), getVisibleSlots(), getContentWidthPx(), destroy() }`. Renders role rows + worker rows + segment bars on the SAME `[firstVisibleDate, visibleDays]` window as the top (drive `buildDisplayedMonths` to cover the window and size day-width = contentWidth / visibleDays). Header reduced to role sections only (no "Nom/Total jours/Vue/date-picker" chrome). Left names column width = `--ps-left-col-width` (shared with top).

- [ ] **Step 1: Implement** by porting from `gestion-depenses2/.../ui/chargeTimeline.js`: `buildVisibleSlots`, `getMonthWidth` (force the non-embedded arithmetic path: `dayWidth = timelineViewportWidth / visibleDays`), `renderTrackGrid`, `renderSegmentBars`/`assignSegmentLanes`/`buildVisibleSegmentBars`, `renderRoleRow`, `renderWorkerRow`, `renderTimelineEditToolbar`, and the context-menu/preview DOM. Remove `renderTimelineControls` (date-picker/zoom) and `renderTotalRow` chrome and the standalone header cells beyond role grouping. Add a `groupWorkersByRole(workers)` (port from `gestion-depenses2/.../services/projectService.js`). `workers` = TimeSegment rows grouped by `Name`, each with `segments:[{id,startAt,endAt,allocationDays,effectif,label}]` built via `parseDateTime` + `normalizeDecimal`; role from ProjectTeam by name.

- [ ] **Step 2: Add CSS** for `.charge-plan-*` classes (copy the layout rules from `gestion-depenses2/assets/css/styles.css` — search `.charge-plan-row`, `.charge-plan-segment-bar`, `.charge-plan-role-row`, `.charge-plan-cell--name`). Left-align name cells; set `--charge-plan-name-col-width: var(--ps-left-col-width)`.

- [ ] **Step 3: Browser-verify.** Reload harness, select ERA. Expected: bottom pane shows role sections (Projeteurs/Ingenieurs), Fouzia and Guillaume rows with segment bars in the right calendar positions; an **Editer** button is present; the left names column left-aligns and matches the top's task column width.

- [ ] **Step 4: Commit.**

```bash
git add planning-synchro/assets/js/bottom/chargeBoard.js planning-synchro/assets/css/styles.css
git commit -m "feat(planning-synchro): charge board render with roles-only header"
```

---

## Task 12: `bottom/chargeEditing.js` — Editer mode, create/resize/delete → TimeSegment (browser-verified)

**Files:**
- Create: `planning-synchro/assets/js/bottom/chargeEditing.js`

**Interfaces:**
- Consumes: `createTimeSegment`/`updateTimeSegment`/`removeTimeSegment` (Task 8); charge board DOM + `getVisibleSlots` (Task 11).
- Produces: `attachChargeEditing(boardEl, { getProjectNumber, getVisibleSlots, onChanged })` → binds the Editer toggle, drag-to-create, handle-resize, right-click context menu (Modifier/Supprimer), computing half-day selections and writing TimeSegment. Returns `{ detach() }`.

- [ ] **Step 1: Implement** by porting the charge-board interaction handlers from `gestion-depenses2/assets/js/main.js` (search `data-charge-plan-edit-toggle`, `charge-plan-segment-handle`, `charge-plan-context-menu`, `computeChargePlanSelection`, `showChargePlanContextMenu`). On create: `createTimeSegment({ projectNumber, name, startDate, endDate, allocationDays, effectif })`; on resize: `updateTimeSegment`; on delete: `removeTimeSegment`. After each write, call `onChanged()` (which re-fetches + re-renders). Toggle button flips a `is-segment-editing-enabled` class on the board (gates interactions).

- [ ] **Step 2: Browser-verify with mock capture.** Reload harness (mock records `window.__appliedActions`). Click **Editer**, drag on Fouzia's row to create a segment; in devtools console assert `window.__appliedActions.some(a => a[0]==="AddRecord" && a[1]==="TimeSegment")`. Right-click a bar → Supprimer; assert a `RemoveRecord` action captured. Resize a handle; assert an `UpdateRecord`.

- [ ] **Step 3: Commit.**

```bash
git add planning-synchro/assets/js/bottom/chargeEditing.js
git commit -m "feat(planning-synchro): charge board editing writes to TimeSegment"
```

---

## Task 13: `sync/controller.js` — single-window shared viewport controller (browser-verified alignment)

**Files:**
- Create: `planning-synchro/assets/js/sync/controller.js`

**Interfaces:**
- Consumes: `planningRenderer` (Task 10), `chargeBoard` (Task 11), `viewportMath` (Task 9), `viewport/build` (Task 4).
- Produces: `createSyncController({ planningRenderer, chargeBoard, bounds, onRangeLabel })` → `{ setViewport(v), getViewport(), applyMode(mode), pan(deltaDays), today(), bindToolbar(toolbarEl), bindWheel(...) }`. `setViewport(v)`: clamp to bounds, then in ONE `requestAnimationFrame` call `planningRenderer.setWindow(v.firstVisibleDate, v.rangeEndDate)` and `chargeBoard.setWindow(v)` with the same `visibleDays`/`firstVisibleDate`; update the range label. Includes a single post-layout alignment assertion (no retry loop): compare `getDayBoundaryLeftPx` of the shared start on both panes; if delta > 1px, `console.warn` (dev signal only).

- [ ] **Step 1: Implement** the controller. Toolbar binding wires week/month/year (`applyMode`), prev/next (`pan(±visibleDays)`), today (anchor on today clamped to bounds). Wheel binding: zoom by adjusting `visibleDays` around the cursor date (reuse `viewportMath`). All paths funnel through `setViewport`.

- [ ] **Step 2: Browser-verify alignment.** Reload harness, select ERA. Using browser tooling: read the left px of the day tick for the bounds start in the top pane (`.vis-time-axis .vis-grid.vis-minor` nearest) and in the bottom pane (`.charge-plan-grid-day[data-date-key=...]`); assert |delta| ≤ 1px. Then click **Semaine**, **Mois**, **Année** and prev/next; after each, re-assert both panes' start ticks stay within 1px and the range label updates. Confirm no console warnings.

- [ ] **Step 3: Commit.**

```bash
git add planning-synchro/assets/js/sync/controller.js
git commit -m "feat(planning-synchro): single-window shared viewport controller (arithmetic alignment)"
```

---

## Task 14: `state.js` + `main.js` — bootstrap, wiring, empty states (browser-verified end-to-end)

**Files:**
- Create: `planning-synchro/assets/js/state.js`
- Create: `planning-synchro/assets/js/main.js`

**Interfaces:**
- Consumes: everything above.
- Produces: app boot. `state.js` holds `{ registry, selectedProject, viewport }` with persisted viewport (localStorage `APP_CONFIG.storageKey`). `main.js`: `initGrist()`, fetch `Projets2` → `buildRegistry` → populate `#ps-project-select` (`value=name`, text=`number - name`, `dataset.projectId`), reconcile shared selection, bind `change` + `storage` events (same pattern as Planning Projet). On project change: resolve project, `fetchProjectData`, build workers, `computeTimeSegmentBounds`; if bounds null → show `#ps-charge-empty` and use a default month window for the top only; else `buildInitialProjectViewport({ firstPlanningDate: getFirstPhaseDate(...), bounds })`; render both panes; create controller; show `#ps-main`, hide `#ps-empty`. Bind aggregate toggle → `planningRenderer.setAggregate` + re-fit.

- [ ] **Step 1: Implement** `state.js` and `main.js`.

- [ ] **Step 2: Browser-verify end-to-end (acceptance dry-run).** Reload harness:
  - No selection → `#ps-empty` visible.
  - Select ERA → both panes render; initial window ~1 year wide, left edge on 2027-02-02 clamped into TimeSegment bounds (2026-04-06 .. 2027-06-30) ⇒ anchored at 2027-02-02 window end ≤ 2027-06-30.
  - Bottom bounds come only from TimeSegment (top content outside is clipped, never widens).
  - Select a project with no TimeSegment fixture (add one) → `#ps-charge-empty` shown, no crash.
  - Change project in a second tab via `localStorage` write → this tab follows (storage event).

- [ ] **Step 3: Commit.**

```bash
git add planning-synchro/assets/js/state.js planning-synchro/assets/js/main.js
git commit -m "feat(planning-synchro): bootstrap, project wiring, initial window, empty states"
```

---

## Task 15: `variables.css` + `styles.css` — visual coherence & tokens (frontend-design)

**Files:**
- Modify: `planning-synchro/assets/css/variables.css`
- Modify: `planning-synchro/assets/css/styles.css`

**Interfaces:** none (styling only).

- [ ] **Step 1: Pull tokens** from `Planning Projet/assets/css/variables.css` and `gestion-depenses2/assets/css/variables.css` into `variables.css` (colors, spacing, fonts). Do not invent new colors.

- [ ] **Step 2: Style** the toolbar, two stacked panes, the aggregate checkbox, and — critically — make the left label columns identical width (`--ps-left-col-width`) and left-aligned in both panes; ensure segment tracks start at the same x in both panes. Use the frontend-design skill for polish.

- [ ] **Step 3: Browser-verify visual coherence.** Reload harness; confirm the task-name column (top) and person-name column (bottom) are the same width, both left-aligned, and the timelines start at the same x. Check week/month/year all stay aligned.

- [ ] **Step 4: Commit.**

```bash
git add planning-synchro/assets/css
git commit -m "style(planning-synchro): shared tokens, aligned left columns, toolbar"
```

---

## Task 16: Acceptance pass against the 10 criteria (browser)

**Files:** none (verification), plus `planning-synchro/README.md`.

- [ ] **Step 1: Walk the 10 acceptance criteria** from the spec in the harness AND (if possible) inside a real Grist doc with the actual tables, capturing a screenshot per criterion. Fix any failure by returning to the owning task.

- [ ] **Step 2: Write `planning-synchro/README.md`** documenting: purpose, that it replaces the iframe `Synchro` approach, required tables/columns, `requiredAccess: full`, and the dev harness usage (`python -m http.server`, `node --test`).

- [ ] **Step 3: Commit.**

```bash
git add planning-synchro/README.md
git commit -m "docs(planning-synchro): README + acceptance verification"
```

---

## Self-Review

**1. Spec coverage:**
- Selector + linking → Tasks 7, 14. ✅
- One frise, synced zoom/pan → Tasks 9, 10, 11, 13. ✅
- Bounds only from TimeSegment → Tasks 5, 14. ✅
- Initial ~1-year window anchored on first Planning date → Tasks 4, 6 (`getFirstPhaseDate`), 14. ✅
- Top read-only, Taches column only, left-aligned → Tasks 10, 15. ✅
- "Rassembler" checkbox → 1 row/Type doc + merged segments + tooltip of tasks → Tasks 6, 10, 14. ✅
- Bottom editable, Editer button, TimeSegment writes → Tasks 8, 11, 12. ✅
- Bottom header reduced to roles only → Task 11. ✅
- Left columns aligned/coherent → Task 15. ✅
- Dates/decimals robust + empty state → Tasks 2, 3, 14. ✅

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". Port tasks give exact source files, functions, and adaptations; new logic and all tests have complete code. ✅

**3. Type consistency:** `computeTimeSegmentBounds` → `{startDate,endDate,startMs,endMs}` consumed identically in Tasks 4/14. `createPlanningRenderer` methods (`render/setWindow/setAggregate/getFirstPhaseDate`) and `createChargeBoard` methods (`render/setWindow/getVisibleSlots/getContentWidthPx`) match their consumers in Tasks 12/13/14. Viewport shape (`firstVisibleDate/visibleDays/rangeEndDate/mode`) is consistent across viewport/build, viewportMath, controller. ✅

**Note for implementers:** DOM/rendering/editing/sync tasks (10–15) are verified in the browser via the mock-Grist harness and the available browser tooling, not `node --test`; pure-logic tasks (2–9) are strict TDD with `node --test`.
