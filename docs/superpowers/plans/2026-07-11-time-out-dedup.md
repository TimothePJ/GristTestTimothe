# Time-Out Person Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Time-Out widget, show ONE row per person (not one per Team row), grouping a person's multiple Team email rows into a single line and attaching all their leave (posted under any of their emails) to it.

**Architecture:** A new pure module `teamPeople.js` dedupes Team rows into people keyed by `normalize(Prenom + " " + Nom)`, each carrying a set of emails + a primary email. `main.js` uses it, resolves the current user's `personKey`, and gates editing by person. `board.js` attaches leave by email-set membership and renders one line per person (`data-person-key` + a write-email `data-owner-email`). `editing.js` gates by `data-person-key`.

**Tech Stack:** Vanilla ES modules, Grist Plugin API, Node built-in test runner (`node --test`). No npm/bundler.

## Global Constraints

- **Dedup key = `normalize(Prenom + " " + Nom)`** (NFD, strip `̀-ͯ`, collapse whitespace, trim, lowercase). Fallback to normalized email when the composed name is empty.
- **Display name = `Prenom + " " + Nom`** (never `PrenomNom` — it is wrong for Omid, empty for a Maria row).
- **Leave attaches by email-set membership**, not single email.
- **Editability is per person** (`personKey`), not per email. `canEditTrack(personKey) = isAdmin || personKey === currentUser.personKey`.
- **Owner written on create** = the track's `data-owner-email`: the current user's own login email on their line (ACL `user.Email == newRec.Owner`); a person's `primaryEmail` for an admin acting on someone else's line.
- **`primaryEmail`** = first email matching `@vinci-construction.` and NOT containing `-ext`, else the first email.
- **The charge leave-aware widgets are NOT touched** (they already dedupe absences by normalized name).
- **No Grist writes / no Team-table changes / no ACL changes.** Dedup is display-side only.
- **Commits by the USER** — steps end at `git add`; never run `git commit`/`git push`.
- **Node ≥ 22.** Run tests from inside `Time-Out/`. Existing suite must stay green (25 tests).

## Source references

- `Time-Out/assets/js/main.js`: `buildTeamMembers` (16-25), current-user + `canEditTrack` wiring (105-141).
- `Time-Out/assets/js/ui/board.js`: `buildMembersFromLeaves` (157-173), `renderWorkerRow` (454-490).
- `Time-Out/assets/js/ui/editing.js`: `handlePointerDown` gate (292-293), `openReasonModal` call (349-350), `handleContextMenuEvent` gate (382-383), `handleModifySegment` gate (456-457).
- `Time-Out/assets/js/config.js`: `grist.columns.team` has `email, prenomNom, prenom, nom, service, role, admin, moi`.
- `Time-Out/assets/js/utils/dates.js`: `toText`.

## File structure

```
Time-Out/assets/js/utils/teamPeople.js   Task 1 (NEW, pure)
Time-Out/tests/teamPeople.test.mjs        Task 1 (NEW)
Time-Out/assets/js/main.js                Task 2
Time-Out/assets/js/ui/board.js            Task 3
Time-Out/assets/js/ui/editing.js          Task 4
```

---

### Task 1: `teamPeople.js` + tests

**Files:**
- Create: `Time-Out/assets/js/utils/teamPeople.js`
- Test: `Time-Out/tests/teamPeople.test.mjs`

**Interfaces:**
- Consumes: `toText` from `./dates.js`.
- Produces: `normalizeName(v)->string`, `normalizeEmail(v)->string`, `dedupeTeamMembers(teamRows, cols)->[{personKey,name,service,emails:string[],primaryEmail}]`, `findPersonKeyForEmail(members, email)->string`.

- [ ] **Step 1: Write the failing test**

```js
// Time-Out/tests/teamPeople.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeTeamMembers, findPersonKeyForEmail, normalizeName } from "../assets/js/utils/teamPeople.js";

const COLS = { email: "Email", prenom: "Prenom", nom: "Nom", prenomNom: "PrenomNom", service: "Service" };

test("two rows, same Prenom/Nom, different emails → one member with two emails", () => {
  const rows = [
    { Prenom: "Maria", Nom: "Fernandes", Email: "maria.fernandes@vinci-construction.com", PrenomNom: "Maria Fernandes", Service: "Structure" },
    { Prenom: "Maria", Nom: "Fernandes", Email: "Maria.FERNANDESDASILVA@vinci-construction.com", PrenomNom: "", Service: "Structure" },
  ];
  const members = dedupeTeamMembers(rows, COLS);
  assert.equal(members.length, 1);
  const m = members[0];
  assert.equal(m.personKey, normalizeName("Maria Fernandes"));
  assert.equal(m.name, "Maria Fernandes");
  assert.deepEqual(m.emails, ["maria.fernandes@vinci-construction.com", "maria.fernandesdasilva@vinci-construction.com"]);
  assert.equal(m.primaryEmail, "maria.fernandes@vinci-construction.com"); // non-ext vinci
});

test("wrong/blank PrenomNom is ignored — name comes from Prenom+Nom", () => {
  const rows = [{ Prenom: "Omid", Nom: "Mokhtarivafer", Email: "omid.mokhtarivafer@vinci-construction.com", PrenomNom: "Laurent Orven", Service: "Structure" }];
  const m = dedupeTeamMembers(rows, COLS)[0];
  assert.equal(m.name, "Omid Mokhtarivafer");
  assert.equal(m.personKey, normalizeName("Omid Mokhtarivafer"));
});

test("primaryEmail falls back to first when all are -ext / partner", () => {
  const rows = [
    { Prenom: "Thadone", Nom: "Viraphan", Email: "thadone.viraphan-ext@vinci-construction.com", Service: "Structure" },
    { Prenom: "Thadone", Nom: "Viraphan", Email: "thadone.viraphan-ext@vc-partner.net", Service: "Structure" },
  ];
  const m = dedupeTeamMembers(rows, COLS)[0];
  assert.equal(m.emails.length, 2);
  assert.equal(m.primaryEmail, "thadone.viraphan-ext@vinci-construction.com"); // first
});

test("findPersonKeyForEmail matches any of a person's emails, case-insensitively", () => {
  const members = dedupeTeamMembers([
    { Prenom: "Maria", Nom: "Fernandes", Email: "maria.fernandes@vinci-construction.com", Service: "S" },
    { Prenom: "Maria", Nom: "Fernandes", Email: "Maria.FERNANDESDASILVA@vinci-construction.com", Service: "S" },
  ], COLS);
  const key = normalizeName("Maria Fernandes");
  assert.equal(findPersonKeyForEmail(members, "MARIA.fernandesdasilva@vinci-construction.com"), key);
  assert.equal(findPersonKeyForEmail(members, "unknown@x.com"), "");
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd Time-Out && node --test "tests/teamPeople.test.mjs"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `teamPeople.js`**

```js
// Time-Out/assets/js/utils/teamPeople.js
// Pure. Dedupes Team rows into one entry per person (key = normalize(Prenom+Nom)),
// aggregating that person's multiple email rows. No DOM, no Grist.
import { toText } from "./dates.js";

export function normalizeEmail(value) {
  return toText(value).toLowerCase();
}
export function normalizeName(value) {
  return toText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function pickPrimaryEmail(emails) {
  if (!emails.length) return "";
  const preferred = emails.find((e) => e.includes("@vinci-construction.") && !e.includes("-ext"));
  return preferred || emails[0];
}

// cols = { email, prenom, nom, service }
export function dedupeTeamMembers(teamRows, cols) {
  const byKey = new Map();
  for (const r of teamRows || []) {
    const prenom = toText(r?.[cols.prenom]);
    const nom = toText(r?.[cols.nom]);
    const fullName = `${prenom} ${nom}`.trim();
    const email = normalizeEmail(r?.[cols.email]);
    const personKey = normalizeName(fullName) || email;
    if (!personKey) continue;
    let m = byKey.get(personKey);
    if (!m) {
      m = { personKey, name: fullName || email, service: toText(r?.[cols.service]), emails: [], primaryEmail: "" };
      byKey.set(personKey, m);
    }
    if (email && !m.emails.includes(email)) m.emails.push(email);
    if (!m.service) m.service = toText(r?.[cols.service]);
    if (!m.name) m.name = fullName || email;
  }
  for (const m of byKey.values()) m.primaryEmail = pickPrimaryEmail(m.emails);
  return [...byKey.values()];
}

export function findPersonKeyForEmail(members, email) {
  const e = normalizeEmail(email);
  if (!e) return "";
  const m = (members || []).find((mm) => (mm.emails || []).includes(e));
  return m ? m.personKey : "";
}
```

Note: the `normalizeName` regex `.replace(/[̀-ͯ]/g, "")` strips combining diacritics U+0300–U+036F. Write it with the ASCII escape `.replace(/[̀-ͯ]/g, "")` to keep the file byte-stable — do not paste literal combining characters.

- [ ] **Step 4: Run to confirm pass**

Run: `cd Time-Out && node --test "tests/teamPeople.test.mjs"`
Expected: PASS (4 tests). Then `node --test "tests/**/*.test.mjs"` → suite still green (25 + 4 = 29).

- [ ] **Step 5: Stage** — `git add Time-Out/assets/js/utils/teamPeople.js Time-Out/tests/teamPeople.test.mjs`

---

### Task 2: `main.js` — dedupe members, current-user personKey, gate by person

**Files:**
- Modify: `Time-Out/assets/js/main.js`

**Interfaces:**
- Consumes: `dedupeTeamMembers`, `findPersonKeyForEmail` from `./utils/teamPeople.js`.
- Produces: `state.teamMembers` = deduped people; `state.currentUser = { email, isAdmin, personKey }`; `canEditTrack(personKey)`.

- [ ] **Step 1:** Add import at top of main.js:

```js
import { dedupeTeamMembers, findPersonKeyForEmail } from "./utils/teamPeople.js";
```

- [ ] **Step 2:** Replace the `buildTeamMembers(...)` call and current-user resolution in `fetchAll()` (currently lines ~105-107). New body:

```js
    state.teamMembers = dedupeTeamMembers(teamRows, teamCols);
    const cu = findCurrentUser(teamRows, teamCols) || { email: "", isAdmin: false };
    cu.personKey = findPersonKeyForEmail(state.teamMembers, cu.email);
    state.currentUser = cu;
    state.segments = buildSegments(segRows, outCols);
```

Delete the now-unused `buildTeamMembers` function (lines 16-25). Keep `buildSegments`.

- [ ] **Step 3:** In `render()`, change the "unrecognized" check from email to personKey (a user whose login email maps to no person is read-only):

```js
    const unrecognized = !state.currentUser.personKey;
```

- [ ] **Step 4:** Change `canEditTrack` (currently `(ownerEmail) => ... ownerEmail.toLowerCase() === currentUser.email...`) to gate by personKey:

```js
      canEditTrack: (personKey) =>
        state.currentUser.isAdmin ||
        Boolean(personKey && personKey === state.currentUser.personKey),
```

- [ ] **Step 5: Verify** — `cd Time-Out && node --check assets/js/main.js` → OK; `node --test "tests/**/*.test.mjs"` → 29/29 (no regression; DOM verified in Grist).

- [ ] **Step 6: Stage** — `git add Time-Out/assets/js/main.js`

---

### Task 3: `board.js` — attach by email set, render one line per person

**Files:**
- Modify: `Time-Out/assets/js/ui/board.js`

**Interfaces:**
- Consumes: deduped members `{personKey, name, service, emails, primaryEmail}`; `currentUser.{personKey, email, isAdmin}`.
- Produces: tracks carry `data-person-key` + `data-owner-email` (write email); greying by personKey.

- [ ] **Step 1:** Replace `buildMembersFromLeaves` (157-173) with an email-set attach:

```js
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
```

- [ ] **Step 2:** In `renderWorkerRow(worker, ..., currentUser)` (454-490), replace the editability + track attributes. Compute:

```js
  const viewer = currentUser || { email: "", isAdmin: false, personKey: "" };
  const isNotEditable = !viewer.isAdmin && worker.personKey !== viewer.personKey;
  const trackClass = isNotEditable ? "charge-plan-track is-not-editable" : "charge-plan-track";
  // Email to WRITE as Owner on create: the current user's login email on their own
  // line (ACL requires user.Email == newRec.Owner); a person's primaryEmail for an
  // admin acting on someone else's line.
  const writeEmail = worker.personKey === viewer.personKey ? viewer.email : worker.primaryEmail;
```

and in the `.charge-plan-track` element replace the `data-worker-name`/`data-owner-email` attributes with:

```js
          data-worker-name="${escapeHtml(worker.name)}"
          data-person-key="${escapeHtml(worker.personKey)}"
          data-owner-email="${escapeHtml(writeEmail || "")}"
```

- [ ] **Step 3: Verify** — `node --check assets/js/ui/board.js`; `node --test "tests/**/*.test.mjs"` → 29/29 (board.test.mjs uses buildMembersFromLeaves? check — if the existing board test constructs members with `.email` only, update it to use `.emails`/`.personKey`; do NOT weaken assertions, adapt the fixture to the new shape).

- [ ] **Step 4: Stage** — `git add Time-Out/assets/js/ui/board.js` (and tests/board.test.mjs if adapted).

---

### Task 4: `editing.js` — gate by personKey; verification

**Files:**
- Modify: `Time-Out/assets/js/ui/editing.js`

**Interfaces:**
- Consumes: `data-person-key` (for `canEditTrack`) and `data-owner-email` (for `openReasonModal`) on tracks.

- [ ] **Step 1:** In `handlePointerDown` (~292-293), gate by personKey (keep reading `data-owner-email` only where the reason modal needs it):

```js
    if (typeof canEditTrack === "function" && !canEditTrack(trackEl.dataset.personKey || "")) return;
```

- [ ] **Step 2:** In `handleContextMenuEvent` (~382-383), gate by personKey:

```js
    const personKey = trackEl instanceof HTMLElement ? trackEl.dataset.personKey || "" : "";
    if (typeof canEditTrack === "function" && !canEditTrack(personKey)) {
```

(keep the surrounding hideContextMenu/return logic).

- [ ] **Step 3:** In `handleModifySegment` (~456-457), gate by personKey:

```js
    const personKey = trackEl instanceof HTMLElement ? trackEl.dataset.personKey || "" : "";
    if (typeof canEditTrack === "function" && !canEditTrack(personKey)) return;
```

- [ ] **Step 4:** Leave the `openReasonModal({ ownerEmail: finished.trackEl.dataset.ownerEmail || "" })` call (~349-350) UNCHANGED — `data-owner-email` is now the correct write email. Confirm no other code path still calls `canEditTrack` with an email.

- [ ] **Step 5: Verify** — `node --check assets/js/ui/editing.js`; `node --test "tests/**/*.test.mjs"` → 29/29.

- [ ] **Step 6: Manual verification in Grist (user, cannot run headless).** Checklist:
  - Each person appears exactly ONCE (Maria Fernandes / Thadone Viraphan / Boussad Hamadache no longer doubled).
  - A leave posted under one of a person's emails and another under a different email both appear on that person's single line.
  - Your own line is editable, others greyed; an admin can edit any; a created leave's Owner is your login email (yours) or the person's primaryEmail (admin).
  - A user whose login email is in no Team person → board read-only banner.

- [ ] **Step 7: Stage** — `git add Time-Out/assets/js/ui/editing.js`

---

## Self-review (vs spec)

- **Spec §2 dedup key normalize(Prenom+Nom)** → Task 1 `dedupeTeamMembers`/`normalizeName`. ✓
- **Spec §2 display name Prenom+Nom** → Task 1 `name = fullName`. ✓
- **Spec §3 member model (emails, primaryEmail)** → Task 1. ✓
- **Spec §4 attach by email set** → Task 3 `buildMembersFromLeaves`. ✓
- **Spec §5 identity/editability by personKey; Owner-to-write** → Task 2 (`currentUser.personKey`, `canEditTrack`) + Task 3 (`writeEmail`, `data-person-key`) + Task 4 (gate by personKey). ✓
- **Spec §7 edge cases** (blank name→email, wrong PrenomNom ignored, unmatched owner ignored, unrecognized read-only, admin primaryEmail) → Task 1 tests + Task 2 Step 3 + Task 3 attach. ✓
- **Spec §8 charge widgets untouched / no Grist writes** → no task touches them. ✓
- **Type consistency:** `dedupeTeamMembers`→members `{personKey,name,service,emails,primaryEmail}` used in Tasks 2/3; `findPersonKeyForEmail(members,email)` in Task 2; `canEditTrack(personKey)` defined Task 2, called Task 4; `data-person-key`/`data-owner-email` emitted Task 3, read Task 4. ✓
- **Commits by user** → every task ends at `git add`. ✓
```
