# Time-Out UI Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three Time-Out fixes: preserve scroll position across re-renders, hide the board entirely from unrecognized users, and restrict a non-admin to their own Service (admins see all).

**Architecture:** All behavior lives in `Time-Out/assets/js/main.js`'s `fetchAll()`/`render()`. A small pure helper `filterMembersByService` (added to `teamPeople.js`, node-tested) does the service filtering; the scroll save/restore and the unrecognized-hide are DOM logic inside `render()`.

**Tech Stack:** Vanilla ES modules, Grist Plugin API, Node built-in test runner. No npm/bundler.

## Global Constraints

- **Scroll preserved** across the board's `innerHTML` rebuild: capture `.charge-plan-scroll` `scrollTop`/`scrollLeft` before rebuild, restore after `board.render()`.
- **Unrecognized user** (`currentUser.personKey === ""`) sees NO board: hide `els.main`, show the exact message `Vous n'êtes pas reconnu — accès au planning refusé.`, and `return` before building the board.
- **Service visibility:** non-admin sees only members whose service equals the current user's service (accent/case-insensitive); admin (`currentUser.isAdmin`) sees all. Empty service → only the "Sans service" members.
- **Charge widgets and the rest of Time-Out are unchanged.** No Grist writes, no ACL changes.
- **Commits by the USER** — steps end at `git add`; never `git commit`/`git push`.
- **Node ≥ 22.** Run tests from inside `Time-Out/`. Existing suite (29 tests) must stay green.

## Source references

- `Time-Out/assets/js/main.js`: `fetchAll()` (92-101), `render()` (102-139).
- `Time-Out/assets/js/utils/teamPeople.js`: exports `normalizeName`, `dedupeTeamMembers`, `findPersonKeyForEmail`.
- Board scroll container class: `.charge-plan-scroll` (built inside `els.main` by `board.render()`).

## File structure

```
Time-Out/assets/js/utils/teamPeople.js   Task 1 (add filterMembersByService)
Time-Out/tests/teamPeople.test.mjs        Task 1 (add tests)
Time-Out/assets/js/main.js                Task 2
```

---

### Task 1: `filterMembersByService` helper + tests

**Files:**
- Modify: `Time-Out/assets/js/utils/teamPeople.js`
- Modify: `Time-Out/tests/teamPeople.test.mjs`

**Interfaces:**
- Consumes: `normalizeName` (already in the module).
- Produces: `filterMembersByService(members, service, isAdmin) -> members[]`.

- [ ] **Step 1: Add the failing test** to `Time-Out/tests/teamPeople.test.mjs` (append; also add the import)

Update the import line to include `filterMembersByService`:
```js
import { dedupeTeamMembers, findPersonKeyForEmail, normalizeName, filterMembersByService } from "../assets/js/utils/teamPeople.js";
```

Append:
```js
test("filterMembersByService: admin sees all; non-admin only own service (accent/case-insensitive)", () => {
  const members = [
    { name: "A", service: "Structure" },
    { name: "B", service: "Topographie" },
    { name: "C", service: "" },
  ];
  assert.equal(filterMembersByService(members, "Structure", true).length, 3);        // admin → all
  assert.deepEqual(filterMembersByService(members, "Structure", false).map((m) => m.name), ["A"]);
  assert.deepEqual(filterMembersByService(members, "topographie", false).map((m) => m.name), ["B"]); // case-insensitive
  assert.deepEqual(filterMembersByService(members, "", false).map((m) => m.name), ["C"]);            // empty → "Sans service"
  assert.deepEqual(filterMembersByService(members, "Structure", false), [{ name: "A", service: "Structure" }]);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd Time-Out && node --test "tests/teamPeople.test.mjs"`
Expected: FAIL — `filterMembersByService` is not exported.

- [ ] **Step 3: Add the implementation** to `teamPeople.js` (after `findPersonKeyForEmail`)

```js
// Non-admin: only members of the given service (accent/case-insensitive). Admin: all.
export function filterMembersByService(members, service, isAdmin) {
  if (isAdmin) return members || [];
  const target = normalizeName(service);
  return (members || []).filter((m) => normalizeName(m?.service) === target);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd Time-Out && node --test "tests/teamPeople.test.mjs"` → all pass. Then `node --test "tests/**/*.test.mjs"` → suite green (30).

- [ ] **Step 5: Stage** — `git add Time-Out/assets/js/utils/teamPeople.js Time-Out/tests/teamPeople.test.mjs`

---

### Task 2: `main.js` — current-user service, scroll preserve, unrecognized-hide, service filter

**Files:**
- Modify: `Time-Out/assets/js/main.js`

**Interfaces:**
- Consumes: `filterMembersByService` from `./utils/teamPeople.js`.

- [ ] **Step 1:** Add `filterMembersByService` to the existing teamPeople import:

```js
import { dedupeTeamMembers, findPersonKeyForEmail, filterMembersByService } from "./utils/teamPeople.js";
```

- [ ] **Step 2:** In `fetchAll()`, after `cu.personKey = findPersonKeyForEmail(state.teamMembers, cu.email);`, add the current user's service:

```js
    cu.service = (state.teamMembers.find((m) => m.personKey === cu.personKey) || {}).service || "";
```

- [ ] **Step 3:** Replace the whole body of `render()` (lines 102-139) with the version below. It captures scroll first, early-returns for the unrecognized user, filters members by service, and restores scroll after `board.render()`. Everything else (viewport, legend, range, zoom, `attachLeaveEditing` options) is unchanged.

```js
  function render() {
    // Preserve scroll across the board's innerHTML rebuild (onChanged → render
    // after a write) so the user is not thrown back to the top.
    const prevScroll = els.main.querySelector(".charge-plan-scroll");
    const savedTop = prevScroll ? prevScroll.scrollTop : 0;
    const savedLeft = prevScroll ? prevScroll.scrollLeft : 0;

    if (editing) editing.detach();
    if (board) board.destroy();
    state.viewport = state.viewport || buildInitialViewport();

    const hasMembers = state.teamMembers.length > 0;
    const unrecognized = !state.currentUser.personKey;

    // Unrecognized user (login email maps to no Team person) → NO access to the
    // board: hide it and show only the refusal message. Do not build the board.
    if (unrecognized) {
      els.empty.hidden = true;
      els.main.hidden = true;
      if (els.banner) {
        els.banner.hidden = false;
        els.banner.textContent = "Vous n'êtes pas reconnu — accès au planning refusé.";
      }
      return;
    }
    if (els.banner) els.banner.hidden = true;
    els.empty.hidden = hasMembers;
    els.main.hidden = !hasMembers;

    // Service visibility: a non-admin sees only their own service; an admin, all.
    const visibleMembers = filterMembersByService(
      state.teamMembers,
      state.currentUser.service,
      state.currentUser.isAdmin
    );

    board = createLeaveBoard(els.main);
    board.render({ members: visibleMembers, segments: state.segments, viewport: state.viewport, currentUser: state.currentUser });

    // Restore the pre-render scroll on the freshly rebuilt scroll container.
    const newScroll = els.main.querySelector(".charge-plan-scroll");
    if (newScroll) { newScroll.scrollTop = savedTop; newScroll.scrollLeft = savedLeft; }

    persistViewport(state.viewport);
    renderLegend();
    if (els.range) els.range.textContent = formatViewportRange(state.viewport);
    updateZoomButtons(state.viewport.visibleDays);

    editing = attachLeaveEditing(els.main, {
      getVisibleSlots: () => (board ? board.getVisibleSlots() : []),
      canEditTrack: (personKey) =>
        state.currentUser.isAdmin ||
        Boolean(personKey && personKey === state.currentUser.personKey),
      openReasonModal: reasonModal
        ? ({ ownerEmail, startAt, endAt }) => reasonModal.open({ ownerEmail, startAt, endAt })
        : undefined,
      onChanged: async () => { await fetchAll(); render(); },
      openEditModal: editModal ? (opts) => editModal.open(opts) : undefined,
    });
  }
```

- [ ] **Step 4: Verify** — `cd Time-Out && node --check assets/js/main.js` → OK; `node --test "tests/**/*.test.mjs"` → 30/30 (no regression; DOM behavior verified in Grist).

- [ ] **Step 5: Manual verification in Grist (user, cannot run headless):**
  - Scroll down the board, create/edit/delete a leave → the view stays at the same scroll position (no jump to top).
  - Log in as a user whose email is NOT in Team → the board is hidden; only "Vous n'êtes pas reconnu — accès au planning refusé." shows.
  - A non-admin sees only the people of their own Service; an admin (`Team.Admin`) sees every Service.

- [ ] **Step 6: Stage** — `git add Time-Out/assets/js/main.js`

---

## Self-review (vs spec)

- **Spec §3.1 cu.service** → Task 2 Step 2. ✓
- **Spec §3.2 scroll save/restore** → Task 2 Step 3 (prevScroll/savedTop/savedLeft + newScroll restore). ✓
- **Spec §3.2 unrecognized hide + message** → Task 2 Step 3 (early return + exact text). ✓
- **Spec §3.2 service filter** → Task 1 `filterMembersByService` + Task 2 `visibleMembers`. ✓
- **Spec §4 edge cases** (no scroll el → 0; unrecognized priority; empty service; segments follow visibleMembers) → covered by Task 1 tests + Task 2 structure. ✓
- **Spec §5 no Grist writes / charge unchanged** → no task touches them. ✓
- **Type consistency:** `filterMembersByService(members, service, isAdmin)` defined Task 1, called Task 2; `currentUser.service` set Task 2 Step 2, read in the same task's filter call. ✓
- **Commits by user** → tasks end at `git add`. ✓
```
