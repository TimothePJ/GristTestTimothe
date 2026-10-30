# Tableau de tâches Synthese — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans Planning Projet, service Synthese, remplacer l'espace vide par un tableau de tâches façon MS Project (Nom, Durée, Début, Fin, zones récapitulatives, édition dans les cellules, clic droit), avec un panneau droit vide réservé au futur Gantt.

**Architecture:** Trois modules : un modèle pur (`syntheseTaskModel.js` : règles de dates en jours ouvrés, récapitulatif des zones, « modèle de lignes » partagé avec le futur Gantt), un tableau DOM (`syntheseTaskTable.js` : rendu, édition, menu, séparateur, sans Grist) et un contrôleur à dépendances injectées (`syntheseTasksController.js` : lecture via le contexte partagé, écritures Grist, mise à jour optimiste). `main.js` ne fait que brancher.

**Tech Stack:** JavaScript ES modules sans build (widget Grist), `node:test` pour les tests, contexte partagé `window.GristServiceContext`, API `grist.docApi.applyUserActions`.

**Spec:** `docs/superpowers/specs/2026-09-23-synthese-taches-design.md`

## Global Constraints

- **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même. Les étapes « Checkpoint » ne font que vérifier le diff.
- **Fins de ligne :** après chaque tâche, `git diff --numstat` doit être identique à `git diff -w --numstat` (certains fichiers du dépôt mélangent CRLF et LF ; ne jamais les convertir). Les fichiers de `Planning Projet/` sont en LF.
- **Pas de séquence `\u` + 4 chiffres hexadécimaux dans les fichiers écrits avec les outils Write/Edit** : l'outil la remplace par le caractère lui-même. Pour retirer les accents, utiliser `.normalize("NFD").replace(/\p{M}/gu, "")`.
- Colonnes écrites : `Taches`, `Diff_coffrage`, `Diff_armature`, `Duree_1`, `NomProjet`, `Zone`. Jamais `Type_doc`, `ID2` ni `Service` (le contexte partagé impose `Service`).
- Jours ouvrés = lundi → vendredi hors fériés français (`utils/frenchHolidays.js` via `services/syntheseTasks.js`). Durée bornes incluses ; 0 = jalon.
- Toute écriture exige « Editer » activé **et** `GristServiceContext.getState().accessMode === "editable"`.
- Textes d'interface en français. Dates affichées « Lun 14/09/26 » ; durées « 0 jour », « 1 jour », « 18 jours ».
- Commandes de test, depuis la racine du dépôt : `node --test "Planning Projet/tests/"*.test.mjs` et `node --test shared/tests/*.cjs`.

## Review Focus

1. Relecture ou signal d'un autre widget **pendant qu'une cellule est en saisie** : le texte tapé doit survivre ; le rafraîchissement s'applique à la fermeture de la saisie. → test `createDeferredRenderer` (Task 6).
2. Service passé **en lecture seule entre l'ouverture d'une cellule et sa validation** : rien n'est écrit, message « lecture seule ». → test contrôleur (Task 5).
3. **Ajout dans une zone repliée** : la zone se déplie et le nom de la nouvelle tâche est en saisie. → test contrôleur (Task 5).
4. Dates Grist livrées en **secondes à minuit UTC** : même jour calendaire affiché quel que soit le fuseau. → test modèle (Task 1).
5. **Même zone écrite différemment** selon les services (« Zone Z2A » / « zone z2a ») : une seule ligne de zone. → test sections (Task 3).

---

## Fichiers

| Fichier | Action | Rôle |
|---|---|---|
| `Planning Projet/assets/js/services/syntheseTaskModel.js` | Créer | Modèle pur : lignes-tâches, dates, règles, récapitulatif, sections, modèle de lignes |
| `Planning Projet/assets/js/ui/syntheseTasksController.js` | Créer | Contrôleur à dépendances injectées |
| `Planning Projet/assets/js/ui/syntheseTaskTable.js` | Créer | Tableau DOM (+ `createDeferredRenderer` exporté pour test) |
| `Planning Projet/assets/js/services/planningSyncCoordinator.js` | Modifier | Exclure les lignes-tâches du recalcul automatique |
| `Planning Projet/assets/js/main.js` | Modifier | Brancher le contrôleur |
| `Planning Projet/assets/css/styles.css` | Modifier | Styles du tableau, masquage de « Durées » |
| `Planning Projet/index.html` | Modifier | Version des scripts |
| `Planning Projet/tests/syntheseTaskModel.test.mjs` | Créer | Tests Task 1 |
| `Planning Projet/tests/syntheseTaskEdits.test.mjs` | Créer | Tests Task 2 |
| `Planning Projet/tests/syntheseTaskSections.test.mjs` | Créer | Tests Task 3 |
| `Planning Projet/tests/planningSyncTaskRows.test.mjs` | Créer | Tests Task 4 |
| `Planning Projet/tests/syntheseTasksController.test.mjs` | Créer | Tests Task 5 |
| `Planning Projet/tests/syntheseTaskTable.test.mjs` | Créer | Tests Task 6 |
| `Planning Projet/tests/syntheseTasksWiring.test.mjs` | Créer | Tests Task 7 |

Emplacement réservé, **non créé** : `Planning Projet/assets/js/ui/syntheseGantt.js` (futur Gantt, consommera le modèle de lignes).

---

### Task 1: Modèle — lecture des tâches, jours ouvrés, zones, affichage

**Files:**
- Create: `Planning Projet/assets/js/services/syntheseTaskModel.js`
- Test: `Planning Projet/tests/syntheseTaskModel.test.mjs`

**Interfaces:**
- Consumes (existant, `services/syntheseTasks.js`) : `countWorkingDays(start, end)`, `endAfterWorkingDays(start, days)`, `formatDays(n)`, `formatTaskDate(date)`, `isWorkingDay(date)`, `parseGristDate(value)`, `toIsoDate(date)`.
- Produces : `TASK_COLUMNS`, `NEW_TASK_NAME`, `NO_ZONE_KEY`, `NO_ZONE_LABEL`, `MAX_TASK_NAME_LENGTH`, `MAX_DURATION_DAYS`, `nextWorkingDay(date) → Date`, `previousWorkingDay(date) → Date`, `zoneKeyOf(value) → string`, `isTaskRow(row) → boolean`, `readTask(row) → Task`, `formatDuration(days) → string`, `formatDate(date) → string`.
  `Task = { id: number, name: string, zoneName: string, zoneKey: string, start: Date|null, end: Date|null, durationDays: number|null, isMilestone: boolean }`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTaskModel.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_ZONE_KEY,
  TASK_COLUMNS,
  formatDate,
  formatDuration,
  isTaskRow,
  nextWorkingDay,
  previousWorkingDay,
  readTask,
  zoneKeyOf,
} from "../assets/js/services/syntheseTaskModel.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function taskRow(fields = {}) {
  return {
    id: 5,
    NomProjet: "HOTEL DIEU",
    Taches: "Visa MOE",
    Type_doc: "",
    ID2: "",
    Zone: "Zone Z2A",
    Diff_coffrage: "2026-10-09",
    Diff_armature: "2026-10-23",
    Duree_1: 11,
    ...fields,
  };
}

test("une tâche est une ligne nommée sans type de document ni ID", () => {
  assert.equal(isTaskRow(taskRow()), true);
  assert.equal(isTaskRow(taskRow({ Taches: "  " })), false, "ligne de zone");
  assert.equal(isTaskRow(taskRow({ Type_doc: "COFFRAGE" })), false, "document");
  assert.equal(isTaskRow(taskRow({ ID2: "001" })), false, "document numéroté");
  assert.equal(isTaskRow(taskRow({ id: 0 })), false, "id invalide");
  assert.equal(isTaskRow(null), false);
});

// Review Focus 4 : Grist livre les dates en secondes à minuit UTC.
test("readTask lit les dates Grist et compte les jours ouvrés bornes incluses", () => {
  const task = readTask(taskRow({
    Diff_coffrage: Date.UTC(2026, 8, 15) / 1000,
    Diff_armature: "08/10/2026",
  }));
  assert.equal(iso(task.start), "2026-09-15");
  assert.equal(iso(task.end), "2026-10-08");
  assert.equal(task.durationDays, 18, "comme MS Project : Mar 15/09 → Jeu 08/10");
  assert.equal(task.isMilestone, false);
  assert.equal(task.zoneKey, "zonez2a");
});

test("les jours fériés ne comptent pas (11 novembre)", () => {
  const task = readTask(taskRow({ Diff_coffrage: "2026-11-06", Diff_armature: "2026-11-12" }));
  assert.equal(task.durationDays, 4);
});

test("Duree_1 = 0 avec Début = Fin fait un jalon", () => {
  const milestone = readTask(taskRow({ Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 0 }));
  assert.equal(milestone.isMilestone, true);
  assert.equal(milestone.durationDays, 0);
  const oneDay = readTask(taskRow({ Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 1 }));
  assert.equal(oneDay.isMilestone, false);
  assert.equal(oneDay.durationDays, 1);
});

test("dates manquantes ou inversées", () => {
  const undated = readTask(taskRow({ Diff_coffrage: null, Diff_armature: "" }));
  assert.equal(undated.start, null);
  assert.equal(undated.end, null);
  assert.equal(undated.durationDays, null);
  const reversed = readTask(taskRow({ Diff_coffrage: "2026-10-23", Diff_armature: "2026-10-09" }));
  assert.equal(iso(reversed.start), "2026-10-09");
  assert.equal(iso(reversed.end), "2026-10-23");
});

test("recalage sur les jours ouvrés", () => {
  assert.equal(iso(nextWorkingDay(day(2026, 9, 19))), "2026-09-21", "samedi → lundi");
  assert.equal(iso(nextWorkingDay(day(2026, 11, 11))), "2026-11-12", "férié → lendemain");
  assert.equal(iso(nextWorkingDay(day(2026, 9, 23))), "2026-09-23", "déjà ouvré");
  assert.equal(iso(previousWorkingDay(day(2026, 9, 20))), "2026-09-18", "dimanche → vendredi");
  assert.equal(iso(previousWorkingDay(day(2027, 1, 1))), "2026-12-31", "férié → veille");
});

test("zoneKeyOf ignore casse, accents et ponctuation", () => {
  assert.equal(zoneKeyOf("ZONE 1A (BAT A3, A4)"), zoneKeyOf("zone-1a bat a3 a4"));
  assert.equal(zoneKeyOf("Élévations"), "elevations");
  assert.equal(zoneKeyOf("Sans zone"), NO_ZONE_KEY);
  assert.equal(zoneKeyOf(""), NO_ZONE_KEY);
  assert.equal(zoneKeyOf(null), NO_ZONE_KEY);
});

test("affichage des durées et des dates", () => {
  assert.equal(formatDuration(0), "0 jour");
  assert.equal(formatDuration(1), "1 jour");
  assert.equal(formatDuration(18), "18 jours");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDate(day(2026, 9, 14)), "Lun 14/09/26");
  assert.equal(formatDate(null), "—");
});

test("les colonnes Grist utilisées", () => {
  assert.deepEqual({ ...TASK_COLUMNS }, {
    id: "id",
    project: "NomProjet",
    name: "Taches",
    typeDoc: "Type_doc",
    id2: "ID2",
    zone: "Zone",
    start: "Diff_coffrage",
    end: "Diff_armature",
    duration: "Duree_1",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTaskModel.test.mjs"`
Expected: FAIL — `Cannot find module .../syntheseTaskModel.js`.

- [ ] **Step 3: Write minimal implementation**

Créer `Planning Projet/assets/js/services/syntheseTaskModel.js` :

```js
// Modèle du tableau de tâches de la vue Synthese (Planning Projet).
// Module pur, sans DOM ni Grist : reconnaissance des lignes-tâches, dates en jours
// ouvrés, règles de saisie, récapitulatif des zones et modèle de lignes — la liste
// ordonnée des lignes visibles, partagée entre le tableau et le futur Gantt.
import {
  countWorkingDays,
  endAfterWorkingDays,
  formatDays,
  formatTaskDate,
  isWorkingDay,
  parseGristDate,
  toIsoDate,
} from "./syntheseTasks.js";

export const TASK_COLUMNS = Object.freeze({
  id: "id",
  project: "NomProjet",
  name: "Taches",
  typeDoc: "Type_doc",
  id2: "ID2",
  zone: "Zone",
  start: "Diff_coffrage",
  end: "Diff_armature",
  duration: "Duree_1",
});

export const NEW_TASK_NAME = "Nouvelle tâche";
export const NO_ZONE_KEY = "";
export const NO_ZONE_LABEL = "Sans zone";
export const MAX_TASK_NAME_LENGTH = 200;
export const MAX_DURATION_DAYS = 9999;

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isSameDay(left, right) {
  if (!(left instanceof Date) || !(right instanceof Date)) return left == null && right == null;
  return left.getTime() === right.getTime();
}

// Un Début tombant un week-end ou un férié avance au jour ouvré suivant ; une Fin
// recule au jour ouvré précédent. Une date déjà ouvrée est gardée telle quelle.
export function nextWorkingDay(date) {
  let cursor = toDay(date);
  while (!isWorkingDay(cursor)) cursor = shiftDays(cursor, 1);
  return cursor;
}

export function previousWorkingDay(date) {
  let cursor = toDay(date);
  while (!isWorkingDay(cursor)) cursor = shiftDays(cursor, -1);
  return cursor;
}

// Clé de comparaison d'une zone : « ZONE 1A (BAT A3, A4) » = « zone-1a bat a3 a4 ».
// Même règle que le contexte partagé ; "" pour une zone vide ou « Sans zone ».
export function zoneKeyOf(value) {
  const text = toText(value);
  if (!text || text.toLocaleLowerCase("fr") === "sans zone") return NO_ZONE_KEY;
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}

// Une tâche est une ligne nommée sans type de document ni ID : les lignes de zone
// n'ont pas de nom, les documents ont un type et un numéro.
export function isTaskRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    Boolean(toText(row?.[TASK_COLUMNS.name])) &&
    !toText(row?.[TASK_COLUMNS.typeDoc]) &&
    !toText(row?.[TASK_COLUMNS.id2]);
}

function isStoredMilestone(value) {
  return value !== "" && value != null && Number(value) === 0;
}

// Les dates font foi pour la Durée ; Duree_1 ne sert qu'à reconnaître un jalon
// (0 jour) d'une tâche d'un jour, qui ont toutes deux Début = Fin.
export function readTask(row) {
  const zoneName = toText(row?.[TASK_COLUMNS.zone]);
  let start = parseGristDate(row?.[TASK_COLUMNS.start]);
  let end = parseGristDate(row?.[TASK_COLUMNS.end]);
  if (start && end && end < start) [start, end] = [end, start];
  const hasDates = Boolean(start && end);
  const isMilestone = hasDates && isSameDay(start, end) &&
    isStoredMilestone(row?.[TASK_COLUMNS.duration]);
  return {
    id: Number(row?.[TASK_COLUMNS.id]),
    name: toText(row?.[TASK_COLUMNS.name]),
    zoneName,
    zoneKey: zoneKeyOf(zoneName),
    start,
    end,
    durationDays: hasDates ? (isMilestone ? 0 : countWorkingDays(start, end)) : null,
    isMilestone,
  };
}

export function formatDuration(days) {
  return days == null ? "—" : formatDays(days);
}

export function formatDate(date) {
  return date instanceof Date ? formatTaskDate(date) : "—";
}
```

(Les imports `endAfterWorkingDays` et `toIsoDate` servent dès la Task 2.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTaskModel.test.mjs"`
Expected: PASS (9 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: toutes les suites PASS, puis « fins de ligne intactes ».

---

### Task 2: Modèle — règles de saisie, nouvelle tâche, colonnes écrites

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (ajouts en fin de fichier)
- Test: `Planning Projet/tests/syntheseTaskEdits.test.mjs`

**Interfaces:**
- Consumes (Task 1) : `readTask`, `nextWorkingDay`, `previousWorkingDay`, `zoneKeyOf`, `TASK_COLUMNS`, `NEW_TASK_NAME`, `MAX_TASK_NAME_LENGTH`, `MAX_DURATION_DAYS`.
- Produces :
  - `applyTaskEdit(task, field, rawValue, { today }) → { ok: true, task: Task, fields: object } | { ok: false, error: string }` — `field` ∈ `"name" | "duration" | "start" | "end"` ; `fields` = colonnes Grist à écrire, `{}` si rien ne change.
  - `buildNewTask({ zoneName, zoneTasks, today }) → Task` (avec `id: null`).
  - `buildTaskFields(task, { projectName }) → { Taches, Diff_coffrage, Diff_armature, Duree_1, NomProjet, Zone }`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTaskEdits.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TASK_NAME_LENGTH,
  NEW_TASK_NAME,
  applyTaskEdit,
  buildNewTask,
  buildTaskFields,
  readTask,
} from "../assets/js/services/syntheseTaskModel.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);
const TODAY = day(2026, 9, 23); // mercredi

function task(fields) {
  return readTask({ Type_doc: "", ID2: "", Zone: "Zone Z2A", ...fields });
}
// Visa MOE : Ven 09/10/26 → Ven 23/10/26, 11 jours.
const visa = () => task({ id: 5, Taches: "Visa MOE", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
const milestone = () => task({ id: 6, Taches: "Réunion de synthèse", Diff_coffrage: "2026-11-12", Diff_armature: "2026-11-12", Duree_1: 0 });
const undated = () => task({ id: 7, Taches: "À planifier", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 });
const edit = (target, field, value) => applyTaskEdit(target, field, value, { today: TODAY });

test("Durée : la Fin suit, Duree_1 est écrite", () => {
  const result = edit(visa(), "duration", "5");
  assert.equal(result.ok, true);
  assert.equal(iso(result.task.end), "2026-10-15");
  assert.equal(result.task.durationDays, 5);
  assert.deepEqual(result.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-15", Duree_1: 5 });
});

test("Durée 0 : la tâche devient un jalon", () => {
  const result = edit(visa(), "duration", "0");
  assert.equal(result.task.isMilestone, true);
  assert.equal(iso(result.task.end), "2026-10-09");
  assert.deepEqual(result.fields, { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-09", Duree_1: 0 });
});

test("Durée refusée : vide, négative, décimale, texte, trop grande", () => {
  ["", "-1", "2,5", "2.5", "abc", "10000"].forEach((value) => {
    const result = edit(visa(), "duration", value);
    assert.equal(result.ok, false, `« ${value} » aurait dû être refusé`);
    assert.match(result.error, /nombre entier/);
  });
});

test("Début : la Fin reste, la Durée suit ; un samedi avance au lundi", () => {
  const monday = edit(visa(), "start", "2026-10-12");
  assert.equal(monday.task.durationDays, 10);
  assert.deepEqual(monday.fields, { Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-23", Duree_1: 10 });
  const saturday = edit(visa(), "start", "2026-10-10");
  assert.equal(iso(saturday.task.start), "2026-10-12");
});

test("Début après la Fin : refusé", () => {
  const result = edit(visa(), "start", "2026-10-26");
  assert.equal(result.ok, false);
  assert.match(result.error, /début ne peut pas être après la fin/i);
});

test("Fin : le Début reste, la Durée suit ; un dimanche recule au vendredi", () => {
  assert.equal(edit(visa(), "end", "2026-10-30").task.durationDays, 16);
  const sunday = edit(visa(), "end", "2026-10-25");
  assert.equal(sunday.ok, true);
  assert.deepEqual(sunday.fields, {}, "Fin recalée sur le 23/10 : rien ne change");
  const before = edit(visa(), "end", "2026-10-08");
  assert.equal(before.ok, false);
  assert.match(before.error, /fin ne peut pas être avant le début/i);
});

test("un jalon se déplace et reste un jalon", () => {
  const moved = edit(milestone(), "start", "2026-11-16");
  assert.equal(moved.task.isMilestone, true);
  assert.deepEqual(moved.fields, { Diff_coffrage: "2026-11-16", Diff_armature: "2026-11-16", Duree_1: 0 });
  const byEnd = edit(milestone(), "end", "2026-11-14"); // samedi → lundi 16
  assert.equal(iso(byEnd.task.start), "2026-11-16");
  assert.equal(byEnd.task.isMilestone, true);
});

test("tâche sans dates : une date saisie en fait une tâche d'un jour", () => {
  const start = edit(undated(), "start", "2026-09-19"); // samedi → lundi 21
  assert.equal(iso(start.task.start), "2026-09-21");
  assert.equal(iso(start.task.end), "2026-09-21");
  assert.equal(start.task.durationDays, 1);
  const end = edit(undated(), "end", "2026-09-19"); // samedi → vendredi 18
  assert.equal(iso(end.task.end), "2026-09-18");
  assert.equal(end.task.durationDays, 1);
});

test("tâche sans dates : une Durée part du prochain jour ouvré", () => {
  const result = applyTaskEdit(undated(), "duration", "3", { today: day(2026, 9, 26) }); // samedi
  assert.equal(iso(result.task.start), "2026-09-28");
  assert.equal(iso(result.task.end), "2026-09-30");
});

test("dates invalides refusées", () => {
  assert.equal(edit(visa(), "start", "").ok, false);
  assert.equal(edit(visa(), "end", "pas une date").ok, false);
});

test("nom : obligatoire, limité, espaces retirés", () => {
  assert.equal(edit(visa(), "name", "   ").ok, false);
  assert.equal(edit(visa(), "name", "x".repeat(MAX_TASK_NAME_LENGTH + 1)).ok, false);
  assert.deepEqual(edit(visa(), "name", "  Visa MOE  ").fields, {});
  assert.deepEqual(edit(visa(), "name", "Visa MOE (2e)").fields, { Taches: "Visa MOE (2e)" });
});

test("une colonne inconnue est refusée", () => {
  assert.equal(edit(visa(), "zone", "Z1").ok, false);
});

test("nouvelle tâche : après la dernière Fin de la zone, un jour", () => {
  const afterVisa = buildNewTask({ zoneName: "Zone Z2A", zoneTasks: [visa()], today: TODAY });
  assert.equal(afterVisa.id, null);
  assert.equal(afterVisa.name, NEW_TASK_NAME);
  assert.equal(iso(afterVisa.start), "2026-10-26");
  assert.equal(iso(afterVisa.end), "2026-10-26");
  assert.equal(afterVisa.durationDays, 1);
  assert.equal(afterVisa.zoneName, "Zone Z2A");
  const afterMilestone = buildNewTask({ zoneName: "Zone Z2A", zoneTasks: [visa(), milestone()], today: TODAY });
  assert.equal(iso(afterMilestone.start), "2026-11-13");
});

test("nouvelle tâche dans une zone sans date : aujourd'hui ou le jour ouvré suivant", () => {
  assert.equal(iso(buildNewTask({ zoneTasks: [undated()], today: TODAY }).start), "2026-09-23");
  assert.equal(iso(buildNewTask({ zoneTasks: [], today: day(2026, 9, 26) }).start), "2026-09-28");
});

test("colonnes écrites pour une nouvelle tâche", () => {
  const created = buildNewTask({ zoneName: "Zone Z2A", zoneTasks: [visa()], today: TODAY });
  assert.deepEqual(buildTaskFields(created, { projectName: "HOTEL DIEU" }), {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z2A",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTaskEdits.test.mjs"`
Expected: FAIL — `does not provide an export named 'applyTaskEdit'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter à la fin de `Planning Projet/assets/js/services/syntheseTaskModel.js` :

```js
function refuse(error) {
  return { ok: false, error };
}

function accept(task, fields) {
  return { ok: true, task, fields };
}

function withDates(task, start, end, isMilestone) {
  const durationDays = isMilestone ? 0 : countWorkingDays(start, end);
  const next = { ...task, start, end, durationDays, isMilestone };
  const unchanged = isSameDay(task.start, start) && isSameDay(task.end, end) &&
    task.isMilestone === isMilestone;
  return accept(next, unchanged ? {} : {
    [TASK_COLUMNS.start]: toIsoDate(start),
    [TASK_COLUMNS.end]: toIsoDate(end),
    [TASK_COLUMNS.duration]: durationDays,
  });
}

// Applique une saisie du tableau à une tâche. Renvoie la tâche recalculée et les
// seules colonnes Grist à écrire ({} si rien ne change), ou le motif du refus.
// Durée → la Fin suit ; Début ou Fin → la Durée suit ; un jalon se déplace.
export function applyTaskEdit(task, field, rawValue, { today = new Date() } = {}) {
  if (field === "name") {
    const name = toText(rawValue);
    if (!name) return refuse("Le nom de la tâche ne peut pas être vide.");
    if (name.length > MAX_TASK_NAME_LENGTH) {
      return refuse(`Le nom de la tâche est limité à ${MAX_TASK_NAME_LENGTH} caractères.`);
    }
    return accept({ ...task, name }, name === task.name ? {} : { [TASK_COLUMNS.name]: name });
  }

  if (field === "duration") {
    const text = toText(rawValue);
    if (!/^\d+$/.test(text) || Number(text) > MAX_DURATION_DAYS) {
      return refuse(`La durée doit être un nombre entier de jours, de 0 (jalon) à ${MAX_DURATION_DAYS}.`);
    }
    const days = Number(text);
    const start = task.start || nextWorkingDay(today);
    if (days === 0) return withDates(task, start, start, true);
    return withDates(task, start, endAfterWorkingDays(start, days), false);
  }

  if (field === "start" || field === "end") {
    const date = parseGristDate(rawValue);
    if (!date) return refuse("Date invalide.");
    if (task.isMilestone) {
      const moved = nextWorkingDay(date);
      return withDates(task, moved, moved, true);
    }
    if (!task.start || !task.end) {
      const only = field === "start" ? nextWorkingDay(date) : previousWorkingDay(date);
      return withDates(task, only, only, false);
    }
    if (field === "start") {
      const start = nextWorkingDay(date);
      if (start > task.end) return refuse("Le début ne peut pas être après la fin.");
      return withDates(task, start, task.end, false);
    }
    const end = previousWorkingDay(date);
    if (end < task.start) return refuse("La fin ne peut pas être avant le début.");
    return withDates(task, task.start, end, false);
  }

  return refuse("Cette colonne ne se modifie pas.");
}

// Une nouvelle tâche démarre le jour ouvré qui suit la plus tardive des Fins de sa
// zone (aujourd'hui, ou le jour ouvré suivant, si la zone n'a rien de daté) et dure
// un jour.
export function buildNewTask({ zoneName = "", zoneTasks = [], today = new Date() } = {}) {
  const ends = (zoneTasks || [])
    .map((zoneTask) => zoneTask?.end)
    .filter((end) => end instanceof Date);
  const latestEnd = ends.length ? new Date(Math.max(...ends.map((end) => end.getTime()))) : null;
  const start = latestEnd ? nextWorkingDay(shiftDays(latestEnd, 1)) : nextWorkingDay(today);
  const name = toText(zoneName);
  return {
    id: null,
    name: NEW_TASK_NAME,
    zoneName: name,
    zoneKey: zoneKeyOf(name),
    start,
    end: start,
    durationDays: 1,
    isMilestone: false,
  };
}

export function buildTaskFields(task, { projectName = "" } = {}) {
  return {
    [TASK_COLUMNS.name]: toText(task?.name),
    [TASK_COLUMNS.start]: task?.start instanceof Date ? toIsoDate(task.start) : null,
    [TASK_COLUMNS.end]: task?.end instanceof Date ? toIsoDate(task.end) : null,
    [TASK_COLUMNS.duration]: Number.isFinite(task?.durationDays) ? task.durationDays : 0,
    [TASK_COLUMNS.project]: toText(projectName),
    [TASK_COLUMNS.zone]: toText(task?.zoneName),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTaskEdits.test.mjs" "Planning Projet/tests/syntheseTaskModel.test.mjs"`
Expected: PASS (15 + 9 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: PASS, « fins de ligne intactes ».

---

### Task 3: Modèle — récapitulatif de zone, sections, modèle de lignes

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (ajouts en fin de fichier)
- Test: `Planning Projet/tests/syntheseTaskSections.test.mjs`

**Interfaces:**
- Consumes (Tasks 1-2) : `isTaskRow`, `readTask`, `zoneKeyOf`, `NO_ZONE_KEY`, `NO_ZONE_LABEL`, `TASK_COLUMNS`.
- Produces :
  - `summarizeTasks(tasks) → { start: Date, end: Date, durationDays: number } | null`.
  - `buildSections({ rows, sharedZones, zoneFilter }) → Section[]`, `Section = { zoneKey, zoneName, label, tasks: Task[], summary }`.
  - `buildRowModel(sections, { collapsedZoneKeys }) → Row[]`, `Row = { key, kind: "zone"|"task", level: 0|1, zoneKey, zoneName, taskId: number|null, name, start, end, durationDays, isMilestone, collapsed, childCount }`. Clés : `"zone:<zoneKey>"`, `"task:<id>"`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTaskSections.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  buildRowModel,
  buildSections,
  readTask,
  summarizeTasks,
  zoneKeyOf,
} from "../assets/js/services/syntheseTaskModel.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function row(id, fields = {}) {
  return {
    id,
    NomProjet: "HOTEL DIEU",
    Taches: "",
    Type_doc: "",
    ID2: "",
    Zone: "",
    Diff_coffrage: null,
    Diff_armature: null,
    Duree_1: 0,
    ...fields,
  };
}

function task(id, name, zone, start, end, duration) {
  return row(id, { Taches: name, Zone: zone, Diff_coffrage: start, Diff_armature: end, Duree_1: duration });
}

test("récapitulatif : premier Début, dernière Fin, jours ouvrés entre les deux", () => {
  const summary = summarizeTasks([
    readTask(task(1, "Plans avant synthèse", "Z", "2026-09-15", "2026-10-08", 18)),
    readTask(task(2, "Visa MOE", "Z", "2026-10-09", "2026-10-23", 11)),
  ]);
  assert.equal(iso(summary.start), "2026-09-15");
  assert.equal(iso(summary.end), "2026-10-23");
  assert.equal(summary.durationDays, 29);
});

test("récapitulatif façon MS Project : un jalon final ne compte pas son jour (cas « PH RDB »)", () => {
  const summary = summarizeTasks([
    readTask(task(1, "FOND DE PLAN NIV PH RDB ind 0", "Z", "2026-09-14", "2026-09-14", 0)),
    readTask(task(2, "Plans avant synthèse des CET", "Z", "2026-09-15", "2026-10-08", 18)),
    readTask(task(3, "Démarrage PH RDB", "Z", "2027-02-22", "2027-02-22", 0)),
  ]);
  assert.equal(iso(summary.start), "2026-09-14");
  assert.equal(iso(summary.end), "2027-02-22");
  // 113 jours ouvrés du 14/09/26 au 22/02/27 (11/11, 25/12, 01/01 fériés), moins le jour du jalon final.
  assert.equal(summary.durationDays, 112);
});

test("récapitulatif : jalon seul = 0 jour ; tâche finissant le jour du jalon = jour compté ; rien de daté = null", () => {
  assert.equal(summarizeTasks([readTask(task(1, "Jalon", "Z", "2026-10-19", "2026-10-19", 0))]).durationDays, 0);
  const sameDay = summarizeTasks([
    readTask(task(1, "Tâche", "Z", "2026-09-21", "2026-09-25", 5)),
    readTask(task(2, "Jalon", "Z", "2026-09-25", "2026-09-25", 0)),
  ]);
  assert.equal(sameDay.durationDays, 5);
  assert.equal(summarizeTasks([readTask(task(1, "Sans date", "Z", null, null, 0))]), null);
  assert.equal(summarizeTasks([]), null);
});

// Review Focus 5 : une même zone écrite différemment selon les services.
test("sections : zones de toutes les sources, une seule par graphie, triées", () => {
  const rows = [
    row(10, { Zone: "Zone Z2A" }),
    task(1, "Visa MOE", "zone z2a", "2026-10-09", "2026-10-23", 11),
    row(11, { Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001", Zone: "PH SS1" }),
  ];
  const sections = buildSections({ rows, sharedZones: ["ZONE Z1A", "Zone Z2A", "PH SS1"] });
  assert.deepEqual(sections.map((section) => section.label), ["PH SS1", "ZONE Z1A", "Zone Z2A"]);
  const z2a = sections.find((section) => section.zoneKey === zoneKeyOf("Zone Z2A"));
  assert.deepEqual(z2a.tasks.map((item) => item.name), ["Visa MOE"]);
  assert.equal(z2a.summary.durationDays, 11);
  assert.equal(sections[0].tasks.length, 0, "un document n'est pas une tâche");
});

test("sections : tâches triées par date, sans date en dernier, « Sans zone » à la fin", () => {
  const rows = [
    task(1, "B", "Z1", "2026-10-12", "2026-10-13", 2),
    task(2, "Sans date", "Z1", null, null, 0),
    task(3, "A", "Z1", "2026-10-05", "2026-10-06", 2),
    task(4, "Orpheline", "", "2026-10-05", "2026-10-05", 1),
  ];
  const sections = buildSections({ rows });
  assert.deepEqual(sections.map((section) => [section.label, section.zoneKey]), [
    ["Z1", "z1"],
    [NO_ZONE_LABEL, NO_ZONE_KEY],
  ]);
  assert.deepEqual(sections[0].tasks.map((item) => item.name), ["A", "B", "Sans date"]);
});

test("filtre de zone : une seule section, même vide", () => {
  const rows = [task(1, "Visa MOE", "Zone Z2A", "2026-10-09", "2026-10-23", 11), row(2, { Zone: "PH SS1" })];
  assert.deepEqual(buildSections({ rows, zoneFilter: "zone-z2a" }).map((section) => section.label), ["Zone Z2A"]);
  assert.deepEqual(buildSections({ rows, zoneFilter: "PH SS1" })[0].tasks, []);
  assert.deepEqual(buildSections({ rows, zoneFilter: "Zone X" }).map((section) => section.label), ["Zone X"]);
});

test("modèle de lignes : zone puis ses tâches, repli, clés stables", () => {
  const rows = [
    task(1, "Visa MOE", "Zone Z2A", "2026-10-09", "2026-10-23", 11),
    task(2, "Réunion", "Zone Z2A", "2026-11-12", "2026-11-12", 0),
    row(3, { Zone: "PH SS1" }),
  ];
  const sections = buildSections({ rows });
  const open = buildRowModel(sections);
  assert.deepEqual(open.map((line) => [line.key, line.kind, line.level]), [
    ["zone:phss1", "zone", 0],
    ["zone:zonez2a", "zone", 0],
    ["task:1", "task", 1],
    ["task:2", "task", 1],
  ]);
  assert.equal(open[1].childCount, 2);
  assert.equal(open[3].isMilestone, true);
  assert.equal(open[0].durationDays, null, "zone vide : pas de récapitulatif");
  const collapsed = buildRowModel(sections, { collapsedZoneKeys: new Set(["zonez2a"]) });
  assert.deepEqual(collapsed.map((line) => line.key), ["zone:phss1", "zone:zonez2a"]);
  assert.equal(collapsed[1].collapsed, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTaskSections.test.mjs"`
Expected: FAIL — `does not provide an export named 'buildRowModel'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter à la fin de `Planning Projet/assets/js/services/syntheseTaskModel.js` :

```js
function hasDates(task) {
  return task?.start instanceof Date && task?.end instanceof Date;
}

// Récapitulatif d'une zone, règle MS Project : une tâche occupe ses jours du Début
// à la Fin ; un jalon n'occupe que l'instant du début de son jour. La Durée compte
// les jours ouvrés entre le premier début et la dernière fin : un jalon placé en
// dernier ne compte donc pas son propre jour.
export function summarizeTasks(tasks) {
  const dated = (tasks || []).filter(hasDates);
  if (!dated.length) return null;
  const start = new Date(Math.min(...dated.map((task) => task.start.getTime())));
  let last = null;
  dated.forEach((task) => {
    const endsAtDayStart = Boolean(task.isMilestone);
    if (
      !last ||
      task.end > last.end ||
      (isSameDay(task.end, last.end) && last.endsAtDayStart && !endsAtDayStart)
    ) {
      last = { end: task.end, endsAtDayStart };
    }
  });
  const counted = countWorkingDays(start, last.end) -
    (last.endsAtDayStart && isWorkingDay(last.end) ? 1 : 0);
  return { start, end: last.end, durationDays: Math.max(0, counted) };
}

function compareNames(left, right) {
  return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
}

function compareTasks(left, right) {
  const leftDated = hasDates(left);
  const rightDated = hasDates(right);
  if (leftDated !== rightDated) return leftDated ? -1 : 1;
  if (leftDated) {
    const byStart = left.start - right.start;
    if (byStart) return byStart;
    const byEnd = left.end - right.end;
    if (byEnd) return byEnd;
  }
  return compareNames(left.name, right.name) || left.id - right.id;
}

// Sections du tableau : une par zone du projet (celles des lignes lues et celles des
// autres services), triées par nom, chacune avec ses tâches triées par date, puis
// « Sans zone » si des tâches n'ont pas de zone. Un filtre de zone n'en garde qu'une.
export function buildSections({ rows = [], sharedZones = [], zoneFilter = "" } = {}) {
  const zoneNames = new Map();
  const rememberZone = (value) => {
    const name = toText(value);
    const key = zoneKeyOf(name);
    if (key && !zoneNames.has(key)) zoneNames.set(key, name);
  };
  rows.forEach((row) => rememberZone(row?.[TASK_COLUMNS.zone]));
  (sharedZones || []).forEach(rememberZone);

  const tasksByZone = new Map();
  rows.filter(isTaskRow).map(readTask).forEach((task) => {
    if (!tasksByZone.has(task.zoneKey)) tasksByZone.set(task.zoneKey, []);
    tasksByZone.get(task.zoneKey).push(task);
  });

  const toSection = (zoneKey, zoneName) => {
    const tasks = (tasksByZone.get(zoneKey) || []).sort(compareTasks);
    return {
      zoneKey,
      zoneName,
      label: zoneName || NO_ZONE_LABEL,
      tasks,
      summary: summarizeTasks(tasks),
    };
  };

  const sections = [...zoneNames.entries()]
    .sort((left, right) => compareNames(left[1], right[1]))
    .map(([zoneKey, zoneName]) => toSection(zoneKey, zoneName));
  if (tasksByZone.has(NO_ZONE_KEY)) sections.push(toSection(NO_ZONE_KEY, ""));

  const filterKey = zoneKeyOf(zoneFilter);
  if (!filterKey) return sections;
  const filtered = sections.filter((section) => section.zoneKey === filterKey);
  return filtered.length ? filtered : [toSection(filterKey, toText(zoneFilter))];
}

// Le modèle de lignes : exactement ce qui est affiché, dans l'ordre, une entrée par
// ligne. Le tableau le dessine ; le futur Gantt dessinera la même liste, à la même
// hauteur de ligne.
export function buildRowModel(sections = [], { collapsedZoneKeys = new Set() } = {}) {
  const lines = [];
  sections.forEach((section) => {
    const collapsed = collapsedZoneKeys.has(section.zoneKey);
    lines.push({
      key: `zone:${section.zoneKey}`,
      kind: "zone",
      level: 0,
      zoneKey: section.zoneKey,
      zoneName: section.zoneName,
      taskId: null,
      name: section.label,
      start: section.summary?.start ?? null,
      end: section.summary?.end ?? null,
      durationDays: section.summary?.durationDays ?? null,
      isMilestone: false,
      collapsed,
      childCount: section.tasks.length,
    });
    if (collapsed) return;
    section.tasks.forEach((task) => {
      lines.push({
        key: `task:${task.id}`,
        kind: "task",
        level: 1,
        zoneKey: section.zoneKey,
        zoneName: section.zoneName,
        taskId: task.id,
        name: task.name,
        start: task.start,
        end: task.end,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
        collapsed: false,
        childCount: 0,
      });
    });
  });
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTaskSections.test.mjs"`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: PASS, « fins de ligne intactes ».

---

### Task 4: Le recalcul automatique ignore les lignes-tâches

**Files:**
- Modify: `Planning Projet/assets/js/services/planningSyncCoordinator.js` (imports en tête ; fonction `getProjectPlanningRows`)
- Test: `Planning Projet/tests/planningSyncTaskRows.test.mjs`

**Interfaces:**
- Consumes (Task 1) : `isTaskRow(row)`.
- Produces : `export function getProjectPlanningRows(planningRows, selectedProject) → row[]` (fonction existante, désormais exportée pour test).

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/planningSyncTaskRows.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import { getProjectPlanningRows } from "../assets/js/services/planningSyncCoordinator.js";

// Le recalcul (Realise, Retards, dates) ne concerne que les documents : il écraserait
// l'avancement saisi à la main sur une tâche Synthese.
test("le recalcul automatique ignore les tâches Synthese et les segments v1", () => {
  const rows = [
    { id: 1, NomProjet: "P", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001" },
    { id: 2, NomProjet: "P", Taches: "", Type_doc: "", ID2: "", Zone: "Z1" },
    { id: 3, NomProjet: "P", Taches: "Visa MOE", Type_doc: "", ID2: "" },
    { id: 4, NomProjet: "P", Taches: "Segment v1", Type_doc: "SYNTHESE", ID2: "" },
    { id: 5, NomProjet: "Autre", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "002" },
  ];
  assert.deepEqual(getProjectPlanningRows(rows, "P").map((row) => row.id), [1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/planningSyncTaskRows.test.mjs"`
Expected: FAIL — `does not provide an export named 'getProjectPlanningRows'`.

- [ ] **Step 3: Write minimal implementation**

Dans `Planning Projet/assets/js/services/planningSyncCoordinator.js`, sous la ligne `import { isSyntheseTypeDoc } from "./syntheseTasks.js";`, ajouter :

```js
import { isTaskRow } from "./syntheseTaskModel.js";
```

Puis remplacer la fonction `getProjectPlanningRows` entière par :

```js
export function getProjectPlanningRows(planningRows, selectedProject) {
  const columns = APP_CONFIG.grist.planningTable?.columns || {};
  const projectCol = columns.projectLink || columns.nomProjet || "NomProjet";
  const typeDocCol = columns.typeDoc || "Type_doc";
  const projectName = toText(selectedProject);
  if (!projectName) return [];
  // Les segments de la vue Synthese v1 et les tâches du tableau Synthese vivent dans
  // la même table mais leur avancement est saisi à la main : le recalcul automatique
  // (Realise, Retards, dates) les remettrait à zéro.
  return (planningRows || []).filter((row) => (
    toText(row?.[projectCol]) === projectName &&
    !isSyntheseTypeDoc(row?.[typeDocCol]) &&
    !isTaskRow(row)
  ));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/planningSyncTaskRows.test.mjs"`
Expected: PASS (1 test).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: PASS, « fins de ligne intactes ».

---

### Task 5: Contrôleur — lecture, mise à jour, écritures

**Files:**
- Create: `Planning Projet/assets/js/ui/syntheseTasksController.js`
- Test: `Planning Projet/tests/syntheseTasksController.test.mjs`

**Interfaces:**
- Consumes (Tasks 1-3) : `TASK_COLUMNS`, `applyTaskEdit`, `buildNewTask`, `buildRowModel`, `buildSections`, `buildTaskFields`.
- Consumes (contexte partagé, injecté) : `context.fetchContextRows(tableName, options) → Promise<row[]>`, `context.getState() → { currentProject: { name, names } | null, accessMode }`, `context.watchContextTables(tableNames, callback) → unsubscribe`, `context.subscribe(listener) → unsubscribe`, `context.watchProjectZones(listener(zones, { projectNames })) → unsubscribe` ; `docApi.applyUserActions(actions) → Promise<{ retValues }>`.
- Consumes (Task 6, injecté par fabrique) : `createTable(callbacks) → { render(rows, { editable, emptyMessage }), startEditing(taskId, field), setStatus(text, tone) }` avec `callbacks = { onEdit(taskId, field, rawValue) → Promise, onAddTask(zoneKey) → Promise, onDeleteTask(taskId) → Promise, onToggleZone(zoneKey), onLockedAttempt() }`.
- Produces : `createSyntheseTasksController({ context, docApi, createTable, confirm, now }) → { setActive(boolean), setEditingEnabled(boolean), setZoneFilter(string), refresh() → Promise }`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTasksController.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";

const TODAY = new Date(2026, 8, 23);
const Z2A = zoneKeyOf("Zone Z2A");

function planningRows() {
  return [
    { id: 10, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "Zone Z2A", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { id: 5, NomProjet: "HOTEL DIEU", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Zone Z2A", Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 },
  ];
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup({ rows = planningRows(), accessMode = "editable", applyUserActions = null, confirm = () => true } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode };
  const listeners = { tables: [], context: [], zones: [] };
  const context = {
    rows,
    nextFetch: null,
    fetches: [],
    async fetchContextRows(tableName, options) {
      context.fetches.push({ tableName, options });
      if (typeof context.nextFetch === "function") return context.nextFetch();
      return context.rows.map((row) => ({ ...row }));
    },
    getState: () => ({ ...state, currentProject: state.currentProject ? { ...state.currentProject } : null }),
    watchContextTables(tableNames, callback) { listeners.tables.push(callback); return () => {}; },
    subscribe(listener) { listeners.context.push(listener); return () => {}; },
    watchProjectZones(listener) { listeners.zones.push(listener); return () => {}; },
  };
  const writes = [];
  const docApi = {
    async applyUserActions(actions) {
      writes.push(actions);
      return applyUserActions ? applyUserActions(actions) : { retValues: [] };
    },
  };
  const table = { renders: [], statuses: [], editing: [], callbacks: null };
  const controller = createSyntheseTasksController({
    context,
    docApi,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return {
        render: (lines, options) => table.renders.push({ lines, options }),
        setStatus: (text, tone) => table.statuses.push({ text, tone }),
        startEditing: (taskId, field) => table.editing.push({ taskId, field }),
      };
    },
    confirm,
    now: () => TODAY,
  });
  const lastRender = () => table.renders.at(-1);
  const taskLine = (taskId) => lastRender().lines.find((line) => line.taskId === taskId);
  return { state, listeners, context, writes, table, controller, lastRender, taskLine };
}

async function activate(env, { editing = true } = {}) {
  env.controller.setEditingEnabled(editing);
  env.controller.setActive(true);
  await flush();
}

test("charge les lignes du projet et dessine zones et tâches", async () => {
  const env = setup();
  await activate(env, { editing: false });
  assert.equal(env.context.fetches[0].tableName, "Planning_Projet");
  const { lines, options } = env.lastRender();
  assert.deepEqual(lines.map((line) => line.key), [`zone:${Z2A}`, "task:5"]);
  assert.equal(options.editable, false);
  assert.equal(options.emptyMessage, "");
});

test("inactif : aucune lecture", async () => {
  const env = setup();
  env.controller.setEditingEnabled(true);
  env.controller.setZoneFilter("Zone Z2A");
  await flush();
  assert.equal(env.context.fetches.length, 0);
  assert.equal(env.table.renders.length, 0);
});

test("aucun projet : message d'invite", async () => {
  const env = setup();
  env.state.currentProject = null;
  await activate(env);
  assert.match(env.lastRender().options.emptyMessage, /Choisissez un projet/);
});

test("sans « Editer », aucune écriture et un message", async () => {
  const env = setup();
  await activate(env, { editing: false });
  await env.table.callbacks.onEdit(5, "duration", "5");
  await env.table.callbacks.onAddTask(Z2A);
  await env.table.callbacks.onDeleteTask(5);
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /Activez « Editer »/);
});

// Review Focus 2.
test("service passé en lecture seule avant la validation : rien n'est écrit", async () => {
  const env = setup();
  await activate(env);
  env.state.accessMode = "readonly";
  await env.table.callbacks.onEdit(5, "duration", "5");
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /lecture seule/);
});

test("modification : affichage immédiat puis UpdateRecord", async () => {
  let release;
  const env = setup({ applyUserActions: () => new Promise((resolve) => { release = resolve; }) });
  await activate(env);
  const pending = env.table.callbacks.onEdit(5, "duration", "5");
  assert.equal(env.taskLine(5).durationDays, 5, "affiché avant la réponse de Grist");
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 5, {
    Diff_coffrage: "2026-10-09",
    Diff_armature: "2026-10-15",
    Duree_1: 5,
  }]]);
  release({ retValues: [null] });
  await pending;
  assert.equal(env.taskLine(5).durationDays, 5);
});

test("écriture refusée par Grist : l'ancienne valeur revient avec un message", async () => {
  const env = setup({
    applyUserActions: () => Promise.reject(new Error("Le service Structure est accessible en lecture seule.")),
  });
  await activate(env);
  await env.table.callbacks.onEdit(5, "duration", "5");
  assert.equal(env.taskLine(5).durationDays, 11);
  assert.match(env.table.statuses.at(-1).text, /lecture seule/);
});

test("saisie refusée par les règles : rien n'est écrit", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onEdit(5, "start", "2026-10-26");
  assert.equal(env.writes.length, 0);
  assert.match(env.table.statuses.at(-1).text, /après la fin/);
});

// Review Focus 3.
test("ajout dans une zone repliée : AddRecord, zone dépliée, nom en saisie", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [42] }) });
  await activate(env);
  env.table.callbacks.onToggleZone(Z2A);
  assert.equal(env.lastRender().lines.length, 1, "zone repliée");
  await env.table.callbacks.onAddTask(Z2A);
  assert.deepEqual(env.writes[0], [["AddRecord", "Planning_Projet", null, {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z2A",
  }]]);
  assert.ok(env.taskLine(42), "la nouvelle ligne est affichée");
  assert.deepEqual(env.table.editing.at(-1), { taskId: 42, field: "name" });
});

test("suppression : rien sans confirmation, RemoveRecord sinon", async () => {
  let answer = false;
  const env = setup({ confirm: () => answer });
  await activate(env);
  await env.table.callbacks.onDeleteTask(5);
  assert.equal(env.writes.length, 0);
  answer = true;
  await env.table.callbacks.onDeleteTask(5);
  assert.deepEqual(env.writes[0], [["RemoveRecord", "Planning_Projet", 5]]);
  assert.equal(env.taskLine(5), undefined);
});

test("zones des autres services : ajoutées pour le projet courant seulement", async () => {
  const env = setup();
  await activate(env);
  env.listeners.zones.forEach((listener) => listener(["PH SS1"], { projectNames: ["HOTEL DIEU"] }));
  assert.ok(env.lastRender().lines.some((line) => line.name === "PH SS1"));
  env.listeners.zones.forEach((listener) => listener(["Autre projet"], { projectNames: ["VENTADOUR"] }));
  assert.equal(env.lastRender().lines.some((line) => line.name === "Autre projet"), false);
});

test("filtre de zone du bandeau", async () => {
  const env = setup({
    rows: [...planningRows(), { id: 11, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "PH SS1" }],
  });
  await activate(env);
  env.controller.setZoneFilter("ph ss1");
  assert.deepEqual(env.lastRender().lines.map((line) => line.name), ["PH SS1"]);
  env.controller.setZoneFilter("");
  assert.equal(env.lastRender().lines.length, 3);
});

test("changement de projet : une réponse arrivée trop tard est ignorée", async () => {
  const env = setup();
  let releaseFirst;
  env.context.nextFetch = () => new Promise((resolve) => { releaseFirst = resolve; });
  env.controller.setActive(true);
  env.state.currentProject = { name: "VENTADOUR", names: ["VENTADOUR"] };
  env.context.nextFetch = () => [{ id: 20, NomProjet: "VENTADOUR", Taches: "", Type_doc: "", ID2: "", Zone: "ZONE 01" }];
  env.listeners.context.forEach((listener) => listener(env.context.getState()));
  await flush();
  releaseFirst(planningRows());
  await flush();
  assert.deepEqual(env.lastRender().lines.map((line) => line.name), ["ZONE 01"]);
});

test("un signal de table relit en forçant le rafraîchissement", async () => {
  const env = setup();
  await activate(env);
  env.listeners.tables.forEach((callback) => callback({ tables: ["Planning_Projet"] }));
  await flush();
  assert.deepEqual(env.context.fetches.at(-1).options, { forceRefresh: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTasksController.test.mjs"`
Expected: FAIL — `Cannot find module .../syntheseTasksController.js`.

- [ ] **Step 3: Write minimal implementation**

Créer `Planning Projet/assets/js/ui/syntheseTasksController.js` :

```js
// Chef d'orchestre du tableau de tâches de la vue Synthese : charge les lignes
// Planning_Projet du projet et du service courants, se tient à jour, applique les
// saisies dans Grist et redessine le tableau. Ses dépendances sont injectées (le
// contexte partagé, l'API Grist, la fabrique du tableau) : doublures en test.
import {
  TASK_COLUMNS,
  applyTaskEdit,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
} from "../services/syntheseTaskModel.js";

const PLANNING_TABLE = "Planning_Projet";

const MESSAGES = Object.freeze({
  noProject: "Choisissez un projet pour afficher ses tâches.",
  loading: "Chargement des tâches…",
  noZone: "Aucune zone pour ce projet. Ajoutez-en une avec la liste « Zone » du bandeau (« Ajouter une zone »).",
  readFailed: "Les tâches du projet n'ont pas pu être lues. Elles seront relues au prochain changement.",
  locked: "Activez « Editer » dans le bandeau pour modifier les tâches.",
  readOnly: "Ce service est en lecture seule pour vous : les tâches ne sont pas modifiables.",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toProjectKey(name) {
  return toText(name).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function describeWriteError(error) {
  if (error?.userMessage) return error.userMessage;
  const message = String(error?.message || "");
  if (/lecture seule|read.?only/i.test(message)) {
    return "Ce service est en lecture seule pour vous : rien n'a été enregistré.";
  }
  if (/a changé pendant/i.test(message)) {
    return "Le projet ou le service a changé pendant l'enregistrement : recommencez.";
  }
  return "L'enregistrement dans Grist a échoué. Réessayez.";
}

export function createSyntheseTasksController({
  context,
  docApi,
  createTable,
  confirm = (message) => window.confirm(message),
  now = () => new Date(),
} = {}) {
  let active = false;
  let bound = false;
  let editingEnabled = false;
  let zoneFilter = "";
  let rows = [];
  let loaded = false;
  let readError = false;
  let projectKey = "";
  let sharedZones = [];
  let sharedZonesProjectKeys = new Set();
  let sections = [];
  let loadToken = 0;
  const collapsedZoneKeys = new Set();

  const table = createTable({
    onEdit: (taskId, field, rawValue) => handleEdit(taskId, field, rawValue),
    onAddTask: (zoneKey) => handleAddTask(zoneKey),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onToggleZone: (zoneKey) => toggleZone(zoneKey),
    onLockedAttempt: () => table.setStatus(lockedMessage(), "error"),
  });

  function getState() {
    return context?.getState?.() || {};
  }

  function getProject() {
    return getState().currentProject || null;
  }

  function projectKeysOf(project) {
    return [project?.name, ...(Array.isArray(project?.names) ? project.names : [])]
      .map(toProjectKey)
      .filter(Boolean);
  }

  function hasWriteAccess() {
    return getState().accessMode === "editable";
  }

  function isEditable() {
    return editingEnabled && hasWriteAccess();
  }

  function lockedMessage() {
    return hasWriteAccess() ? MESSAGES.locked : MESSAGES.readOnly;
  }

  function getSharedZones(project) {
    return projectKeysOf(project).some((key) => sharedZonesProjectKeys.has(key)) ? sharedZones : [];
  }

  function render() {
    if (!active) return;
    const project = getProject();
    sections = project
      ? buildSections({ rows, sharedZones: getSharedZones(project), zoneFilter })
      : [];
    const lines = buildRowModel(sections, { collapsedZoneKeys });
    let emptyMessage = "";
    if (!project) emptyMessage = MESSAGES.noProject;
    else if (!loaded) emptyMessage = MESSAGES.loading;
    else if (readError) emptyMessage = MESSAGES.readFailed;
    else if (!lines.length) emptyMessage = MESSAGES.noZone;
    table.render(lines, { editable: isEditable(), emptyMessage });
  }

  async function load({ forceRefresh = false } = {}) {
    if (!active) return;
    const token = ++loadToken;
    const project = getProject();
    const nextProjectKey = project ? toProjectKey(project.name) : "";
    if (nextProjectKey !== projectKey) {
      projectKey = nextProjectKey;
      collapsedZoneKeys.clear();
      rows = [];
      loaded = false;
      readError = false;
      render();
    }
    if (!project) {
      render();
      return;
    }
    let nextRows;
    try {
      nextRows = await context.fetchContextRows(
        PLANNING_TABLE,
        forceRefresh ? { forceRefresh: true } : {}
      );
    } catch (error) {
      if (token !== loadToken || !active) return;
      console.error("Lecture des tâches Synthese impossible :", error);
      if (loaded) {
        table.setStatus(MESSAGES.readFailed, "error");
        return;
      }
      readError = true;
      loaded = true;
      render();
      return;
    }
    if (token !== loadToken || !active) return;
    rows = Array.isArray(nextRows) ? nextRows : [];
    readError = false;
    loaded = true;
    render();
  }

  function findTask(taskId) {
    for (const section of sections) {
      const task = section.tasks.find((candidate) => candidate.id === taskId);
      if (task) return task;
    }
    return null;
  }

  function findRow(taskId) {
    return rows.find((row) => Number(row?.[TASK_COLUMNS.id]) === taskId) || null;
  }

  // Revérifié au moment d'écrire : « Editer » ou le service ont pu changer pendant
  // la saisie.
  async function write(actions) {
    if (!isEditable()) {
      const error = new Error(lockedMessage());
      error.userMessage = lockedMessage();
      throw error;
    }
    return docApi.applyUserActions(actions);
  }

  function refuseLocked() {
    table.setStatus(lockedMessage(), "error");
    render();
  }

  async function handleEdit(taskId, field, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    const row = findRow(taskId);
    if (!task || !row) return;
    const result = applyTaskEdit(task, field, rawValue, { today: now() });
    if (!result.ok) {
      table.setStatus(result.error, "error");
      render();
      return;
    }
    const columns = Object.keys(result.fields);
    if (!columns.length) {
      render();
      return;
    }
    const previous = Object.fromEntries(columns.map((column) => [column, row[column]]));
    Object.assign(row, result.fields);
    render();
    try {
      await write([["UpdateRecord", PLANNING_TABLE, taskId, result.fields]]);
      table.setStatus("", "info");
    } catch (error) {
      console.error("Modification de la tâche impossible :", error);
      Object.assign(row, previous);
      render();
      table.setStatus(describeWriteError(error), "error");
    }
  }

  async function handleAddTask(zoneKey) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const project = getProject();
    const section = sections.find((candidate) => candidate.zoneKey === zoneKey);
    if (!project || !section) return;
    const task = buildNewTask({ zoneName: section.zoneName, zoneTasks: section.tasks, today: now() });
    const fields = buildTaskFields(task, { projectName: project.name });
    try {
      const result = await write([["AddRecord", PLANNING_TABLE, null, fields]]);
      const newId = Number(result?.retValues?.[0]);
      const hasId = Number.isInteger(newId) && newId > 0;
      if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
      collapsedZoneKeys.delete(zoneKey);
      render();
      if (hasId) table.startEditing(newId, "name");
      table.setStatus(`Tâche ajoutée dans « ${section.label} ».`, "info");
    } catch (error) {
      console.error("Ajout de la tâche impossible :", error);
      table.setStatus(describeWriteError(error), "error");
    }
  }

  async function handleDeleteTask(taskId) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    const row = findRow(taskId);
    if (!task || !row) return;
    if (!confirm(`Supprimer la tâche « ${task.name} » ?`)) return;
    const previousRows = rows;
    rows = rows.filter((candidate) => candidate !== row);
    render();
    try {
      await write([["RemoveRecord", PLANNING_TABLE, taskId]]);
      table.setStatus(`Tâche « ${task.name} » supprimée.`, "info");
    } catch (error) {
      console.error("Suppression de la tâche impossible :", error);
      rows = previousRows;
      render();
      table.setStatus(describeWriteError(error), "error");
    }
  }

  function toggleZone(zoneKey) {
    if (collapsedZoneKeys.has(zoneKey)) collapsedZoneKeys.delete(zoneKey);
    else collapsedZoneKeys.add(zoneKey);
    render();
  }

  function bind() {
    if (bound) return;
    bound = true;
    context?.watchContextTables?.([PLANNING_TABLE], () => {
      void load({ forceRefresh: true });
    });
    context?.subscribe?.(() => {
      void load();
    });
    context?.watchProjectZones?.((zones, meta = {}) => {
      sharedZones = Array.isArray(zones) ? zones : [];
      sharedZonesProjectKeys = new Set(
        (Array.isArray(meta.projectNames) ? meta.projectNames : []).map(toProjectKey).filter(Boolean)
      );
      render();
    });
  }

  return {
    setActive(nextActive) {
      const wasActive = active;
      active = Boolean(nextActive);
      if (!active) {
        loadToken += 1;
        return;
      }
      bind();
      if (!wasActive) void load();
    },
    setEditingEnabled(enabled) {
      editingEnabled = Boolean(enabled);
      render();
    },
    setZoneFilter(zoneName) {
      const next = toText(zoneName);
      if (next === zoneFilter) return;
      zoneFilter = next;
      render();
    },
    refresh() {
      return load({ forceRefresh: true });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTasksController.test.mjs"`
Expected: PASS (14 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: PASS, « fins de ligne intactes ».

---

### Task 6: Tableau — rendu, édition, menu, séparateur, styles

**Files:**
- Create: `Planning Projet/assets/js/ui/syntheseTaskTable.js`
- Modify: `Planning Projet/assets/css/styles.css` (section « Service Synthese : espace réservé… », avant le commentaire `/* ARCHIVE vue Synthese v1`)
- Test: `Planning Projet/tests/syntheseTaskTable.test.mjs`

**Interfaces:**
- Consumes (Task 1) : `formatDate(date)`, `formatDuration(days)`.
- Consumes (Task 3) : `Row` (voir Task 3).
- Produces :
  - `createDeferredRenderer(draw) → { render(payload), beginEditing(), endEditing(), isEditing }`.
  - `createSyntheseTaskTable(host, { onEdit, onAddTask, onDeleteTask, onToggleZone, onLockedAttempt }) → { render(rows, { editable, emptyMessage }), startEditing(taskId, field), setStatus(text, tone) }` — le contrat attendu par la Task 5.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTaskTable.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createDeferredRenderer } from "../assets/js/ui/syntheseTaskTable.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

// Review Focus 1 : une relecture pendant une saisie ne doit pas détruire la cellule.
test("un rafraîchissement pendant une saisie attend la fin de la saisie", () => {
  const drawn = [];
  const renderer = createDeferredRenderer((payload) => drawn.push(payload));
  renderer.render("v1");
  renderer.beginEditing();
  assert.equal(renderer.isEditing, true);
  renderer.render("v2");
  renderer.render("v3");
  assert.deepEqual(drawn, ["v1"]);
  renderer.endEditing();
  assert.deepEqual(drawn, ["v1", "v3"]);
  assert.equal(renderer.isEditing, false);
});

test("fin de saisie sans rafraîchissement : le dernier état est redessiné (annulation)", () => {
  const drawn = [];
  const renderer = createDeferredRenderer((payload) => drawn.push(payload));
  renderer.render("v1");
  renderer.beginEditing();
  renderer.endEditing();
  assert.deepEqual(drawn, ["v1", "v1"]);
});

test("styles : vue masquable, hauteur de ligne fixe, en-tête collant", () => {
  assert.match(css, /\.synthese-space\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /--stt-row-height:\s*26px;/);
  assert.match(css, /\.stt-line--head\s*\{[^}]*position:\s*sticky;/);
  assert.match(css, /\.stt-menu\[hidden\]\s*\{\s*display:\s*none;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTaskTable.test.mjs"`
Expected: FAIL — `Cannot find module .../syntheseTaskTable.js`.

- [ ] **Step 3: Write minimal implementation**

Créer `Planning Projet/assets/js/ui/syntheseTaskTable.js` :

```js
// Tableau de tâches de la vue Synthese, façon MS Project : en-tête collant, une ligne
// par entrée du modèle de lignes (zone ou tâche), hauteur de ligne fixe, panneau droit
// réservé au futur Gantt et séparateur déplaçable. Il gère l'édition dans les cellules
// et le menu contextuel, mais ne lit ni n'écrit jamais Grist : il signale les
// intentions au contrôleur.
import { formatDate, formatDuration } from "../services/syntheseTaskModel.js";

const LEFT_WIDTH_STORAGE_KEY = "planning-projet.synthese-tasks.left-width";
const DEFAULT_LEFT_WIDTH = 620;
const MIN_LEFT_WIDTH = 360;
const MIN_RIGHT_WIDTH = 160;
const KEYBOARD_STEP_PX = 24;
const INFO_STATUS_DELAY_MS = 6000;
const COLUMNS = Object.freeze([
  { field: "name", label: "Nom de la tâche" },
  { field: "duration", label: "Durée" },
  { field: "start", label: "Début" },
  { field: "end", label: "Fin" },
]);
const EDITABLE_FIELDS = COLUMNS.map((column) => column.field);

// Un rafraîchissement arrivant pendant une saisie (écriture, relecture, signal d'un
// autre widget) détruirait la cellule en cours : on garde le dernier état demandé et
// on le dessine à la fermeture de la saisie.
export function createDeferredRenderer(draw) {
  let latest = null;
  let hasLatest = false;
  let editing = false;
  return {
    render(payload) {
      latest = payload;
      hasLatest = true;
      if (!editing) draw(payload);
    },
    beginEditing() {
      editing = true;
    },
    endEditing() {
      editing = false;
      if (hasLatest) draw(latest);
    },
    get isEditing() {
      return editing;
    },
  };
}

function readStoredWidth() {
  try {
    const value = Number(window.localStorage.getItem(LEFT_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_LEFT_WIDTH;
  } catch (_error) {
    return DEFAULT_LEFT_WIDTH;
  }
}

function storeWidth(width) {
  try {
    window.localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch (_error) {
    // Stockage indisponible : la largeur reste celle de la session.
  }
}

function toInputDate(date) {
  if (!(date instanceof Date)) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// Une zone sans tâche datée n'a pas de récapitulatif : cellules vides. Une tâche sans
// dates affiche « — ».
function formatCellValue(line, field) {
  if (line.kind === "zone" && line.durationDays == null) return "";
  if (field === "duration") return formatDuration(line.durationDays);
  if (field === "start") return formatDate(line.start);
  return formatDate(line.end);
}

export function createSyntheseTaskTable(host, {
  onEdit,
  onAddTask,
  onDeleteTask,
  onToggleZone,
  onLockedAttempt,
} = {}) {
  const root = createElement("div", "stt");
  const scroller = createElement("div", "stt-scroll");
  scroller.setAttribute("role", "treegrid");
  scroller.setAttribute("aria-label", "Tâches du projet");

  const head = createElement("div", "stt-line stt-line--head");
  head.setAttribute("role", "row");
  const headLeft = createElement("div", "stt-left");
  COLUMNS.forEach(({ field, label }) => {
    const cell = createElement("div", `stt-cell stt-cell--${field}`, label);
    cell.setAttribute("role", "columnheader");
    headLeft.appendChild(cell);
  });
  // Bande réservée à l'échelle des dates du futur Gantt.
  const headRight = createElement("div", "stt-right stt-right--head");
  head.append(headLeft, headRight);

  const body = createElement("div", "stt-body");
  body.setAttribute("role", "rowgroup");
  const empty = createElement("p", "stt-empty");
  empty.hidden = true;
  scroller.append(head, body, empty);

  const splitter = createElement("div", "stt-splitter");
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Largeur du tableau des tâches");
  splitter.tabIndex = 0;

  const status = createElement("p", "stt-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  const menu = createElement("div", "stt-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  root.append(scroller, splitter, status, menu);
  host.replaceChildren(root);

  let lines = [];
  let editable = false;
  let editor = null;
  let queuedEdit = null;
  let statusTimer = 0;
  let leftWidth = readStoredWidth();

  /* ---------- Largeur du panneau gauche ---------- */

  function clampWidth(width) {
    const available = root.clientWidth;
    const max = available ? Math.max(MIN_LEFT_WIDTH, available - MIN_RIGHT_WIDTH) : Infinity;
    return Math.min(max, Math.max(MIN_LEFT_WIDTH, width));
  }

  function applyWidth(width, { persist = false } = {}) {
    leftWidth = clampWidth(width);
    root.style.setProperty("--stt-left-width", `${Math.round(leftWidth)}px`);
    splitter.setAttribute("aria-valuenow", String(Math.round(leftWidth)));
    if (persist) storeWidth(leftWidth);
  }

  /* ---------- Rendu ---------- */

  function buildNameCell(line) {
    const cell = createElement("div", "stt-cell stt-cell--name");
    cell.setAttribute("role", "gridcell");
    cell.dataset.field = "name";
    cell.title = line.name;
    if (line.kind === "zone") {
      const toggle = createElement("button", "stt-toggle", line.collapsed ? "▸" : "▾");
      toggle.type = "button";
      toggle.dataset.action = "toggle";
      toggle.setAttribute("aria-label", `${line.collapsed ? "Déplier" : "Replier"} ${line.name}`);
      cell.appendChild(toggle);
    }
    cell.appendChild(createElement("span", "stt-text", line.name));
    return cell;
  }

  function buildLine(line) {
    const element = createElement("div", `stt-line stt-line--${line.kind}`);
    element.setAttribute("role", "row");
    element.setAttribute("aria-level", String(line.level + 1));
    element.dataset.kind = line.kind;
    element.dataset.zoneKey = line.zoneKey;
    if (line.kind === "zone") element.setAttribute("aria-expanded", String(!line.collapsed));
    if (line.kind === "task") element.dataset.taskId = String(line.taskId);
    if (line.isMilestone) element.classList.add("is-milestone");

    const left = createElement("div", "stt-left");
    COLUMNS.forEach(({ field }) => {
      const cell = field === "name"
        ? buildNameCell(line)
        : createElement("div", `stt-cell stt-cell--${field}`, formatCellValue(line, field));
      if (field !== "name") {
        cell.setAttribute("role", "gridcell");
        cell.dataset.field = field;
      }
      if (line.kind === "task" && editable) {
        cell.classList.add("is-editable");
        cell.tabIndex = 0;
      }
      left.appendChild(cell);
    });
    // Emplacement de la ligne dans le futur Gantt : même hauteur, même ordre.
    element.append(left, createElement("div", "stt-right"));
    return element;
  }

  function draw({ lines: nextLines, options }) {
    lines = Array.isArray(nextLines) ? nextLines : [];
    editable = Boolean(options?.editable);
    applyWidth(leftWidth);
    root.classList.toggle("is-readonly", !editable);
    const message = options?.emptyMessage || "";
    empty.textContent = message;
    empty.hidden = !message;
    body.hidden = Boolean(message);
    body.replaceChildren(...(message ? [] : lines.map(buildLine)));
  }

  const renderer = createDeferredRenderer(draw);

  /* ---------- Édition dans les cellules ---------- */

  function findCell(taskId, field) {
    return body.querySelector(`.stt-line--task[data-task-id="${taskId}"] .stt-cell--${field}`);
  }

  function startEditing(taskId, field) {
    if (!editable || !EDITABLE_FIELDS.includes(field)) return;
    if (editor) {
      queuedEdit = { taskId, field };
      return;
    }
    const line = lines.find((candidate) => candidate.kind === "task" && candidate.taskId === taskId);
    const cell = findCell(taskId, field);
    if (!line || !cell) return;

    const input = document.createElement("input");
    input.className = "stt-input";
    if (field === "name") {
      input.type = "text";
      input.maxLength = 200;
      input.value = line.name;
    } else if (field === "duration") {
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = line.durationDays == null ? "" : String(line.durationDays);
    } else {
      input.type = "date";
      input.value = toInputDate(line[field]);
    }
    input.setAttribute("aria-label", COLUMNS.find((column) => column.field === field).label);

    editor = { taskId, field, input, cell, initialValue: input.value, finalized: false };
    renderer.beginEditing();
    cell.replaceChildren(input);
    cell.classList.add("is-editing");

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finishEditing({ commit: true, refocus: true });
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finishEditing({ commit: false, refocus: true });
      } else if (event.key === "Tab") {
        event.preventDefault();
        void finishEditing({ commit: true, move: event.shiftKey ? -1 : 1 });
      }
    });
    input.addEventListener("blur", () => {
      void finishEditing({ commit: true });
    });

    cell.scrollIntoView?.({ block: "nearest" });
    input.focus();
    if (field === "name" || field === "duration") {
      try {
        input.select();
      } catch (_error) {
        // Certains types de champ ne permettent pas la sélection.
      }
    }
  }

  async function finishEditing({ commit, move = 0, refocus = false }) {
    const current = editor;
    if (!current || current.finalized) return;
    current.finalized = true;
    const value = current.input.value;
    if (commit && value !== current.initialValue) {
      current.cell.classList.add("is-saving");
      current.input.disabled = true;
      try {
        await onEdit?.(current.taskId, current.field, value);
      } catch (error) {
        console.error("Saisie de tâche non enregistrée :", error);
      }
    }
    editor = null;
    renderer.endEditing();

    const queued = queuedEdit;
    queuedEdit = null;
    const nextIndex = EDITABLE_FIELDS.indexOf(current.field) + move;
    if (move && nextIndex >= 0 && nextIndex < EDITABLE_FIELDS.length) {
      startEditing(current.taskId, EDITABLE_FIELDS[nextIndex]);
    } else if (queued) {
      startEditing(queued.taskId, queued.field);
    } else if (refocus) {
      findCell(current.taskId, current.field)?.focus();
    }
  }

  /* ---------- Menu contextuel ---------- */

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
  }

  function openMenu(lineElement, clientX, clientY) {
    if (!editable) {
      onLockedAttempt?.();
      return;
    }
    const zoneKey = lineElement.dataset.zoneKey || "";
    const taskId = lineElement.dataset.kind === "task" ? Number(lineElement.dataset.taskId) : null;
    const items = [{ label: "Ajouter une tâche", run: () => onAddTask?.(zoneKey) }];
    if (taskId) items.push({ label: "Supprimer la tâche", danger: true, run: () => onDeleteTask?.(taskId) });
    menu.replaceChildren(...items.map((item) => {
      const button = createElement("button", `stt-menu__item${item.danger ? " is-danger" : ""}`, item.label);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => {
        closeMenu();
        void item.run();
      });
      return button;
    }));
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY, window.innerHeight - rect.height - 4))}px`;
    menu.querySelector("button")?.focus();
  }

  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) closeMenu();
  }, true);
  scroller.addEventListener("scroll", closeMenu, { passive: true });
  window.addEventListener("blur", closeMenu);

  /* ---------- Souris et clavier sur les lignes ---------- */

  body.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement) return;
    if (target.closest('[data-action="toggle"]')) {
      onToggleZone?.(lineElement.dataset.zoneKey || "");
      return;
    }
    const cell = target.closest(".stt-cell[data-field]");
    if (lineElement.dataset.kind !== "task" || !cell || cell.classList.contains("is-editing")) return;
    if (!editable) {
      onLockedAttempt?.();
      return;
    }
    startEditing(Number(lineElement.dataset.taskId), cell.dataset.field);
  });

  body.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement) return;
    event.preventDefault();
    openMenu(lineElement, event.clientX, event.clientY);
  });

  body.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest(".stt-cell[data-field]");
    const lineElement = target?.closest(".stt-line");
    if (!cell || !lineElement || cell.classList.contains("is-editing")) return;
    if ((event.key === "Enter" || event.key === "F2") && lineElement.dataset.kind === "task") {
      event.preventDefault();
      if (!editable) {
        onLockedAttempt?.();
        return;
      }
      startEditing(Number(lineElement.dataset.taskId), cell.dataset.field);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      openMenu(lineElement, rect.left + 8, rect.bottom);
    }
  });

  /* ---------- Séparateur ---------- */

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    try {
      splitter.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché.
    }
    root.classList.add("is-resizing");
    const onMove = (moveEvent) => applyWidth(startWidth + moveEvent.clientX - startX);
    const onEnd = () => {
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onEnd);
      splitter.removeEventListener("pointercancel", onEnd);
      root.classList.remove("is-resizing");
      applyWidth(leftWidth, { persist: true });
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onEnd);
    splitter.addEventListener("pointercancel", onEnd);
  });

  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX;
    applyWidth(leftWidth + step, { persist: true });
  });

  window.addEventListener("resize", () => {
    closeMenu();
    applyWidth(leftWidth);
  });

  /* ---------- Barre d'état ---------- */

  function setStatus(text, tone = "info") {
    window.clearTimeout(statusTimer);
    status.textContent = text || "";
    status.dataset.tone = tone;
    status.hidden = !text;
    if (text && tone === "info") {
      statusTimer = window.setTimeout(() => {
        status.hidden = true;
        status.textContent = "";
      }, INFO_STATUS_DELAY_MS);
    }
  }

  applyWidth(leftWidth);

  return {
    render(nextLines, options = {}) {
      renderer.render({ lines: nextLines, options });
    },
    startEditing,
    setStatus,
  };
}
```

Dans `Planning Projet/assets/css/styles.css`, remplacer la règle existante :

```css
.synthese-space {
  flex: 1 1 auto;
  min-height: 0;
  background: #fff;
}
```

par :

```css
.synthese-space {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.synthese-space[hidden] {
  display: none;
}

/* Tableau de tâches (façon MS Project) : une ligne = partie gauche (4 colonnes) +
   partie droite (futur Gantt), hauteur fixe pour garder les deux alignés. */
.stt {
  --stt-left-width: 620px;
  --stt-row-height: 26px;
  --stt-head-height: 32px;
  --stt-col-duration: 84px;
  --stt-col-date: 116px;
  --stt-zone-bg: #5a8a3c;
  --stt-head-bg: #333333;
  --stt-grid: #e2e2e2;
  --stt-accent: var(--vinci-blue, #004990);
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #1f1f1f;
}

.stt-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.stt-line {
  display: grid;
  grid-template-columns: var(--stt-left-width) minmax(0, 1fr);
  height: var(--stt-row-height);
}

.stt-left {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--stt-col-duration) var(--stt-col-date) var(--stt-col-date);
  min-width: 0;
  background: #fff;
  border-right: 1px solid #bdbdbd;
}

.stt-right {
  min-width: 0;
}

.stt-line--head {
  position: sticky;
  top: 0;
  z-index: 2;
  height: var(--stt-head-height);
}

.stt-line--head .stt-left,
.stt-right--head {
  background: var(--stt-head-bg);
  color: #fff;
  font-weight: 600;
}

.stt-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 8px;
  border-right: 1px solid var(--stt-grid);
  border-bottom: 1px solid var(--stt-grid);
  white-space: nowrap;
  overflow: hidden;
}

.stt-line--head .stt-cell {
  border-color: #555555;
}

.stt-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stt-line--zone .stt-cell {
  font-weight: 700;
}

.stt-line--zone .stt-cell--name {
  gap: 4px;
  padding-left: 4px;
  background: var(--stt-zone-bg);
  color: #000;
  font-size: 14px;
  text-decoration: underline;
}

.stt-toggle {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #000;
  font-size: 12px;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}

.stt-toggle:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 1px;
}

.stt-line--task .stt-cell--name {
  padding-left: 30px;
}

.stt-cell.is-editable {
  cursor: text;
}

.stt-cell.is-editable:hover {
  background: #eef4fb;
}

.stt-cell:focus-visible {
  outline: 2px solid var(--stt-accent);
  outline-offset: -2px;
}

.stt-cell.is-editing {
  padding: 0;
  overflow: visible;
}

.stt-cell.is-saving {
  opacity: 0.55;
}

.stt-input {
  width: 100%;
  height: 100%;
  padding: 0 6px;
  border: 2px solid var(--stt-accent);
  background: #fff;
  font: inherit;
}

.stt-empty {
  margin: 24px 16px;
  color: #555555;
  font-size: 13px;
}

.stt-splitter {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--stt-left-width);
  z-index: 3;
  width: 7px;
  transform: translateX(-4px);
  cursor: col-resize;
  touch-action: none;
}

.stt-splitter:hover,
.stt-splitter:focus-visible,
.stt.is-resizing .stt-splitter {
  background: rgba(0, 73, 144, 0.25);
  outline: none;
}

.stt.is-resizing,
.stt.is-resizing * {
  cursor: col-resize !important;
  user-select: none;
}

.stt-status {
  flex: 0 0 auto;
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--stt-grid);
  background: #f7f7f7;
  font-size: 12px;
}

.stt-status[data-tone="error"] {
  color: #b42318;
  background: #fef3f2;
}

.stt-menu {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 4px;
  border: 1px solid #c8c8c8;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.stt-menu[hidden] {
  display: none;
}

.stt-menu__item {
  padding: 7px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.stt-menu__item:hover,
.stt-menu__item:focus-visible {
  background: #eef4fb;
  outline: none;
}

.stt-menu__item.is-danger {
  color: #b42318;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTaskTable.test.mjs"`
Expected: PASS (3 tests). Puis `node --check "Planning Projet/assets/js/ui/syntheseTaskTable.js"` : aucune sortie.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: PASS, « fins de ligne intactes ».

---

### Task 7: Intégration — main.js, bandeau, version des scripts

**Files:**
- Modify: `Planning Projet/assets/js/main.js` (imports ; état du module ; `setPlanningEditingEnabled` ; `applySyntheseSpace` ; `handleZoneChange` ; normalisation de zone dans `performPlanningRefresh` et `bindSharedProjectZones`)
- Modify: `Planning Projet/assets/css/styles.css` (liste des éléments masqués sous `body.is-synthese-space`)
- Modify: `Planning Projet/index.html` (version `?v=` des scripts ; commentaire de `#syntheseSpace`)
- Test: `Planning Projet/tests/syntheseTasksWiring.test.mjs`

**Interfaces:**
- Consumes (Task 5) : `createSyntheseTasksController({ context, docApi, createTable })` et ses méthodes `setActive`, `setEditingEnabled`, `setZoneFilter`.
- Consumes (Task 6) : `createSyntheseTaskTable(host, callbacks)`.
- Consumes (existant, main.js) : `isPlanningEditingUnlocked()`, `state.selectedZone`, `window.GristServiceContext`, `window.grist.docApi`.
- Produces : fonctions internes `getSyntheseTasks()`, `syncSyntheseTasksZoneFilter()`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTasksWiring.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

test("la vue Synthese héberge le tableau de tâches", () => {
  assert.match(html, /<section id="syntheseSpace"[^>]*hidden/);
  assert.match(mainJs, /import \{ createSyntheseTaskTable \} from "\.\/ui\/syntheseTaskTable\.js";/);
  assert.match(mainJs, /import \{ createSyntheseTasksController \} from "\.\/ui\/syntheseTasksController\.js";/);
  assert.match(mainJs, /createTable: \(callbacks\) => createSyntheseTaskTable\(host, callbacks\)/);
});

test("le tableau suit le service, le bouton Editer et le filtre Zone", () => {
  const apply = sliceBetween(mainJs, "function applySyntheseSpace(", "function bindSyntheseSpace(");
  assert.match(apply, /getSyntheseTasks\(\)\?\.setActive\(true\)/);
  assert.match(apply, /syntheseTasks\?\.setActive\(false\)/);
  const editing = sliceBetween(mainJs, "function setPlanningEditingEnabled(", "function requirePlanningEditing(");
  assert.match(editing, /syntheseTasks\?\.setEditingEnabled\(isPlanningEditingUnlocked\(\)\)/);
  const zoneChange = sliceBetween(mainJs, "async function handleZoneChange(", "async function bootstrap(");
  assert.match(zoneChange, /syncSyntheseTasksZoneFilter\(\);/);
  const calls = mainJs.split("syncSyntheseTasksZoneFilter();").length - 1;
  assert.ok(calls >= 3, `le filtre doit suivre aussi les normalisations de zone (${calls} appels)`);
});

test("le contrôleur est déclaré avec l'état du module, avant tout usage", () => {
  const declaration = mainJs.indexOf("let syntheseTasks = null;");
  assert.ok(declaration > 0, "déclaration absente");
  assert.ok(declaration < mainJs.indexOf("function setPlanningEditingEnabled("));
});

test("le bouton Durées est masqué dans la vue Synthese", () => {
  assert.match(css, /body\.is-synthese-space #durationDefaultsToggle/);
});

test("les scripts sont servis dans leur nouvelle version", () => {
  assert.equal(html.includes("20260923-zones1"), false);
  assert.ok(html.includes("main.js?v=20260923-taches1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTasksWiring.test.mjs"`
Expected: FAIL (imports absents de main.js).

- [ ] **Step 3: Write minimal implementation**

1. `Planning Projet/assets/js/main.js`, juste après le bloc commenté `// } from "./ui/syntheseView.js";` (fin des imports), ajouter :

```js
import { createSyntheseTaskTable } from "./ui/syntheseTaskTable.js";
import { createSyntheseTasksController } from "./ui/syntheseTasksController.js";
```

2. Même fichier, remplacer la ligne `let toolbarBound = false;` par :

```js
let toolbarBound = false;
// Tableau de tâches de la vue Synthese : créé à la première activation du service.
let syntheseTasks = null;
```

3. Dans `setPlanningEditingEnabled`, sous la ligne `  // ARCHIVE vue Synthese v1 : setSyntheseEditingEnabled(isPlanningEditingUnlocked());`, ajouter :

```js
  syntheseTasks?.setEditingEnabled(isPlanningEditingUnlocked());
```

4. Juste avant `function applySyntheseSpace(selectedService) {`, ajouter :

```js
function getSyntheseTasks() {
  if (syntheseTasks) return syntheseTasks;
  const host = document.getElementById("syntheseSpace");
  const context = window.GristServiceContext;
  const docApi = window.grist?.docApi;
  if (!host || !context || !docApi) return null;
  syntheseTasks = createSyntheseTasksController({
    context,
    docApi,
    createTable: (callbacks) => createSyntheseTaskTable(host, callbacks),
  });
  syntheseTasks.setEditingEnabled(isPlanningEditingUnlocked());
  syntheseTasks.setZoneFilter(state.selectedZone || "");
  return syntheseTasks;
}

function syncSyntheseTasksZoneFilter() {
  syntheseTasks?.setZoneFilter(state.selectedZone || "");
}
```

5. Dans `applySyntheseSpace`, remplacer :

```js
  const space = document.getElementById("syntheseSpace");
  if (space) space.hidden = !isSynthese;
  if (!isSynthese) {
```

par :

```js
  const space = document.getElementById("syntheseSpace");
  if (space) space.hidden = !isSynthese;
  if (isSynthese) {
    getSyntheseTasks()?.setActive(true);
  } else {
    syntheseTasks?.setActive(false);
  }
  if (!isSynthese) {
```

6. Remplacer :

```js
async function handleZoneChange(currentState) {
  console.log("Zone sélectionnée :", currentState.selectedZone || "(toutes)");
```

par :

```js
async function handleZoneChange(currentState) {
  console.log("Zone sélectionnée :", currentState.selectedZone || "(toutes)");
  syncSyntheseTasksZoneFilter();
```

7. Dans `performPlanningRefresh`, remplacer le bloc :

```js
    if (
      normalizedZone !== (state.selectedZone || "") &&
      hasSharedZonesForSelectedProject()
    ) {
      setState({ selectedZone: normalizedZone });
    }
```

par :

```js
    if (
      normalizedZone !== (state.selectedZone || "") &&
      hasSharedZonesForSelectedProject()
    ) {
      setState({ selectedZone: normalizedZone });
    }
    syncSyntheseTasksZoneFilter();
```

8. Dans `bindSharedProjectZones`, remplacer :

```js
    if (hasSharedZonesForSelectedProject() && normalizedZone !== (state.selectedZone || "")) {
      setState({ selectedZone: normalizedZone });
    }
```

par :

```js
    if (hasSharedZonesForSelectedProject() && normalizedZone !== (state.selectedZone || "")) {
      setState({ selectedZone: normalizedZone });
    }
    syncSyntheseTasksZoneFilter();
```

9. `Planning Projet/assets/css/styles.css`, remplacer :

```css
body.is-synthese-space .planning-header-row,
body.is-synthese-space #timelineWrapper,
body.is-synthese-space #planningPaneResizer,
body.is-synthese-space #planningStatus {
```

par :

```css
body.is-synthese-space .planning-header-row,
body.is-synthese-space #timelineWrapper,
body.is-synthese-space #planningPaneResizer,
body.is-synthese-space #planningStatus,
body.is-synthese-space #durationDefaultsToggle {
```

et le titre de section `Service Synthese : espace réservé sous le bandeau (vue à définir)` par `Service Synthese : tableau de tâches (panneau droit réservé au Gantt)`.

10. `Planning Projet/index.html` : remplacer toutes les occurrences de `20260923-zones1` par `20260923-taches1` (4 occurrences), et le commentaire `<!-- Vue Synthese : espace réservé sous le bandeau, contenu à définir -->` par `<!-- Vue Synthese : tableau de tâches, construit par assets/js/ui/syntheseTaskTable.js -->`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTasksWiring.test.mjs" && node --check "Planning Projet/assets/js/main.js"`
Expected: PASS (5 tests), aucune erreur de syntaxe.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node --test shared/tests/*.cjs && diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: toutes les suites PASS, « fins de ligne intactes ».

---

### Task 8: Vérification finale

**Files:** aucun nouveau.

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces : rapport de vérification pour l'utilisateur.

- [ ] **Step 1: Suites complètes et syntaxe**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node --test shared/tests/*.cjs && for f in "Planning Projet/assets/js/services/syntheseTaskModel.js" "Planning Projet/assets/js/ui/syntheseTasksController.js" "Planning Projet/assets/js/ui/syntheseTaskTable.js" "Planning Projet/assets/js/main.js" "Planning Projet/assets/js/services/planningSyncCoordinator.js"; do node --check "$f" || echo "ERREUR $f"; done`
Expected: toutes les suites PASS, aucune ligne « ERREUR ».

- [ ] **Step 2: Aucune séquence d'échappement unicode décodée par erreur**

Run: `grep -nP "[\x{0300}-\x{036F}]" "Planning Projet/assets/js/services/syntheseTaskModel.js" "Planning Projet/assets/js/ui/"synthese*.js || echo "aucun caractère combinant"`
Expected: « aucun caractère combinant ».

- [ ] **Step 3: Fins de ligne**

Run: `diff <(git diff --numstat) <(git diff -w --numstat) && echo "fins de ligne intactes"`
Expected: « fins de ligne intactes ».

- [ ] **Step 4: Vérification à l'écran**

Si Playwright ou Chrome DevTools est connecté : ouvrir le widget en local, service Synthese, projet « Test Synthese », et vérifier :
1. l'en-tête « Nom de la tâche / Durée / Début / Fin », les zones (dont celles des autres services), le panneau droit vide ;
2. sans « Editer » : un clic sur une tâche affiche « Activez « Editer »… » ;
3. avec « Editer » : clic droit sur une zone → « Ajouter une tâche » → ligne « Nouvelle tâche » avec le nom en saisie ;
4. Durée 5 → la Fin suit ; Début déplacé → la Durée suit ; Durée 0 → « 0 jour » ;
5. la ligne de zone reprend le premier Début et la dernière Fin ;
6. clic droit sur la tâche → « Supprimer la tâche » → confirmation → ligne retirée ;
7. le séparateur se déplace et la largeur est gardée après rechargement.

Sinon : transmettre cette liste à l'utilisateur pour son test sur localhost.

- [ ] **Step 5: Revue indépendante**

Lancer une revue de code (agent `pr-review-toolkit:code-reviewer`) sur le diff de la branche, avec la spec et ce plan en référence ; corriger les problèmes confirmés, relancer les suites et le contrôle des fins de ligne.
