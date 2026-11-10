# Modèle d'étage Synthese (cycles, liens, cascade) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Ajouter un étage » crée un étage rempli d'après le modèle de synthèse (3 cycles, 2 sous-groupes, 20 tâches, liens FD / DD / FF) ; saisir une date date les tâches liées en cascade ; le tableau gagne N° et Indice ; les autres widgets laissent ces tâches tranquilles.

**Architecture:** Deux modules purs nouveaux (`syntheseLinks.js` : texte des liens, dates liées, cascade ; `syntheseFloorTemplate.js` : données du modèle et lignes à écrire). Le modèle de tâches existant (`syntheseTaskModel.js`) apprend les groupes (cycle / sous-groupe, colonnes `Nature` / `Parent` / `Lien`), l'ordre de création dans un étage et un modèle de lignes à 5 niveaux. Le contrôleur écrit l'étage en deux temps et joint la cascade à chaque saisie de date ; le tableau et le Gantt dessinent les nouveaux genres de lignes.

**Tech Stack:** JavaScript ES modules sans dépendance, widgets Grist, tests `node:test` (Node 25).

**Spec:** `docs/superpowers/specs/2026-10-05-synthese-modele-etage-design.md`

## Global Constraints

- **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même : chaque tâche finit par un point de contrôle (tests verts), jamais par `git commit`.
- Textes de l'interface en français, **mot pour mot** comme dans ce plan (copiés de la spec).
- Colonnes nouvelles de `Planning_Projet`, toutes **Texte** : `Nature`, `Parent`, `Lien`. `Parent` est écrit en texte (`"123"`). Valeurs de `Nature` écrites : `Cycle`, `Sous-groupe`, `Reunion`, `Demarrage`.
- Jours ouvrés : lundi → vendredi hors fériés français, toujours via `isWorkingDay` de `Planning Projet/assets/js/services/syntheseTasks.js`.
- Une tâche Synthese = `Taches` rempli, `Type_doc` vide, et (`ID2` vide **ou** `Service` = Synthese, sans accents ni casse).
- Ordre dans un étage, un cycle, un sous-groupe : **ordre de création** (id croissant). Le niveau zone garde son ordre actuel.
- Couleurs : étage `#fce4d6`, cycle `#bfbfbf`, réunion `#bdd7ee`, démarrage `#e6b8b7`.
- N'écrivez jamais de séquence `\uXXXX` dans un fichier avec Write/Edit : elles deviennent des caractères bruts. Pour retirer les accents : `.normalize("NFD").replace(/\p{M}/gu, "")`.
- `ListeDePlan/affichage.js` a des fins de ligne mélangées (CRLF / LF) : **ne pas l'éditer avec l'outil Edit** (il réécrit toutes les fins de ligne) ; utiliser le script fourni à la tâche 9.
- Tests de Planning Projet : depuis `Planning Projet/`, `node --test tests/*.test.mjs` (255 tests verts au départ).

## Review Focus

1. **Lien ou Parent abîmé à la main dans Grist** (texte illisible, id d'une ligne d'un autre étage, boucle A → B → A) : la vue s'affiche quand même, la ligne se range dans son étage et la cascade s'arrête. Tests : tâche 1 (texte illisible, boucle), tâche 4 (Parent d'un autre étage, sous-groupe hors cycle).
2. **Date saisie au milieu de la chaîne** (ex. Fin de « VISA Indice A ») : seules « SIGNATURE » et « DEMARRAGE GO » bougent, rien en amont. Test : tâche 1.
3. **Renommer l'étage juste après sa création** (« Nouvel étage » → « SS1 ») : « NIV » et « GO » suivent dans les noms des tâches, les cycles suivent (`Groupe`) ; supprimer l'étage retire ses 26 lignes. Tests : tâche 5, tâche 6.
4. **Cascade refusée par Grist** : la tâche modifiée et toutes ses tâches liées reviennent à l'état lu. Test : tâche 6.
5. **Tâche Synthese avec N° et Indice** ouverte dans ListeDePlan, planning-synchro ou gestion-depenses2 : son Indice n'est pas effacé, elle n'est pas un document, elle n'est pas « 100 % réalisée ». Tests : tâche 9.

## Fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `Planning Projet/assets/js/services/syntheseLinks.js` (nouveau) | Jours ouvrés (suivant, précédent, ± n), texte `Lien`, dates d'une tâche liée, cascade. Pur. | 1 |
| `Planning Projet/assets/js/services/syntheseTaskModel.js` | Colonnes, natures, reconnaissance (Service, groupes), lecture d'une tâche, saisies ; hiérarchie et modèle de lignes ; actions d'étage et de groupe, cible de dépôt. | 2, 4, 5 |
| `Planning Projet/assets/js/services/syntheseFloorTemplate.js` (nouveau) | Données du modèle, 26 lignes à ajouter, écriture de `Parent` / `Lien`. Pur. | 3 |
| `Planning Projet/assets/js/ui/syntheseTasksController.js` | Création en deux temps, cascade dans l'écriture, groupes, colonnes absentes. | 6 |
| `Planning Projet/assets/js/ui/syntheseTaskTable.js`, `assets/css/styles.css` | Colonnes N° / Indice, lignes de groupe, couleurs, menus, retraits. | 7 |
| `Planning Projet/assets/js/services/syntheseGanttGeometry.js`, `ui/syntheseGantt.js` | Crochets des groupes, flèches des liens. | 8 |
| `ListeDePlan/affichage.js`, `planning-synchro/assets/js/bottom/documentCharge.js`, `gestion-depenses2/assets/js/utils/planningRealisation.js`, `gestion-depenses2/assets/js/services/projectService.js` | Protections. | 9 |
| `Planning Projet/index.html` | Versions des scripts. | 10 |

`ui/syntheseTaskDrag.js` ne change pas : il s'appuie sur `resolveDropTarget` et `containerKeyOf`, étendus à la tâche 5.

Dépendances entre modules (pas de cycle d'import) : `syntheseLinks.js` → `syntheseTasks.js` ; `syntheseTaskModel.js` → `syntheseLinks.js`, `syntheseTasks.js` ; `syntheseFloorTemplate.js` → `syntheseTaskModel.js`.

---

### Task 1: Liens et cascade (`syntheseLinks.js`)

**Files:**
- Create: `Planning Projet/assets/js/services/syntheseLinks.js`
- Test: `Planning Projet/tests/syntheseLinks.test.mjs`

**Interfaces:**
- Consumes: `isWorkingDay(date)`, `endAfterWorkingDays(start, days)` de `syntheseTasks.js`.
- Produces :
  - `LINK_TYPES` = `["FD", "DD", "FF"]`
  - `nextWorkingDay(date) → Date`, `previousWorkingDay(date) → Date`, `startBeforeWorkingDays(end, days) → Date`, `addWorkingDays(date, count) → Date`
  - `parseLink(value) → { predId: number, type: "FD"|"DD"|"FF", lag: number } | null`
  - `formatLink({ predId, type, lag }) → string`
  - `computeLinkedDates(pred, link, durationDays) → { start, end, durationDays, isMilestone } | null`
  - `cascadeFrom(changed, tasks) → Task[]` (copies des tâches dont les dates changent, avec `start`, `end`, `durationDays`, `isMilestone` à jour)
  - Une « tâche » ici = tout objet `{ id, start: Date|null, end: Date|null, durationDays: number|null, isMilestone, link }` (forme de `readTask`).

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseLinks.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  addWorkingDays,
  cascadeFrom,
  computeLinkedDates,
  formatLink,
  nextWorkingDay,
  parseLink,
  previousWorkingDay,
  startBeforeWorkingDays,
} from "../assets/js/services/syntheseLinks.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

test("texte du lien : lecture tolérante, null si illisible", () => {
  assert.deepEqual(parseLink("131 FD+5"), { predId: 131, type: "FD", lag: 5 });
  assert.deepEqual(parseLink("12 dd"), { predId: 12, type: "DD", lag: 0 });
  assert.deepEqual(parseLink("7 FF-2"), { predId: 7, type: "FF", lag: -2 });
  assert.deepEqual(parseLink(" 7FF + 3 j "), { predId: 7, type: "FF", lag: 3 });
  assert.deepEqual(parseLink("8 FD+1 jours"), { predId: 8, type: "FD", lag: 1 });
  for (const bad of ["", null, undefined, "abc", "0 FD", "12 XX", "12 FD+", "FD 12", "12.5 FD"]) {
    assert.equal(parseLink(bad), null, String(bad));
  }
});

test("écriture du lien : relue à l'identique", () => {
  assert.equal(formatLink({ predId: 131, type: "FD", lag: 5 }), "131 FD+5");
  assert.equal(formatLink({ predId: 12, type: "DD", lag: 0 }), "12 DD");
  assert.equal(formatLink({ predId: 7, type: "FF", lag: -2 }), "7 FF-2");
  assert.deepEqual(parseLink(formatLink({ predId: 7, type: "FF", lag: -2 })), { predId: 7, type: "FF", lag: -2 });
});

test("jours ouvrés : ± n jours, week-end et férié sautés", () => {
  assert.equal(iso(addWorkingDays(day(2026, 1, 2), 1)), "2026-01-05", "vendredi + 1 → lundi");
  assert.equal(iso(addWorkingDays(day(2026, 1, 2), 0)), "2026-01-02");
  assert.equal(iso(addWorkingDays(day(2026, 1, 5), -1)), "2026-01-02", "lundi - 1 → vendredi");
  assert.equal(iso(addWorkingDays(day(2026, 11, 10), 1)), "2026-11-12", "le 11 novembre est férié");
  assert.equal(iso(addWorkingDays(day(2026, 3, 2), 5)), "2026-03-09");
  assert.equal(iso(nextWorkingDay(day(2026, 1, 3))), "2026-01-05");
  assert.equal(iso(previousWorkingDay(day(2026, 1, 3))), "2026-01-02");
  assert.equal(iso(startBeforeWorkingDays(day(2026, 2, 9), 2)), "2026-02-06");
});

test("date liée : FD, DD, FF, décalage, vers une tâche ou un jalon", () => {
  const pred = { start: day(2026, 1, 2), end: day(2026, 1, 5) };
  const fdTask = computeLinkedDates(pred, { type: "FD", lag: 0 }, 10);
  assert.deepEqual([iso(fdTask.start), iso(fdTask.end), fdTask.durationDays, fdTask.isMilestone], ["2026-01-06", "2026-01-19", 10, false]);
  const fdMilestone = computeLinkedDates(pred, { type: "FD", lag: 0 }, 0);
  assert.deepEqual([iso(fdMilestone.start), iso(fdMilestone.end), fdMilestone.isMilestone], ["2026-01-05", "2026-01-05", true]);
  const fdLag = computeLinkedDates({ start: day(2026, 2, 17), end: day(2026, 3, 2) }, { type: "FD", lag: 5 }, 0);
  assert.equal(iso(fdLag.start), "2026-03-09");
  const overlap = computeLinkedDates(pred, { type: "FD", lag: -1 }, 2);
  assert.deepEqual([iso(overlap.start), iso(overlap.end)], ["2026-01-05", "2026-01-06"], "FD-1 : commence le jour de la fin");
  const dd = computeLinkedDates({ start: day(2026, 1, 2), end: day(2026, 1, 2) }, { type: "DD", lag: 0 }, 2);
  assert.deepEqual([iso(dd.start), iso(dd.end)], ["2026-01-02", "2026-01-05"]);
  const ff = computeLinkedDates({ start: day(2026, 2, 3), end: day(2026, 2, 9) }, { type: "FF", lag: 0 }, 2);
  assert.deepEqual([iso(ff.start), iso(ff.end)], ["2026-02-06", "2026-02-09"]);
  const ffMilestone = computeLinkedDates({ start: day(2026, 2, 3), end: day(2026, 2, 9) }, { type: "FF", lag: 1 }, 0);
  assert.deepEqual([iso(ffMilestone.start), ffMilestone.isMilestone], ["2026-02-10", true]);
  const unknownDuration = computeLinkedDates(pred, { type: "FD", lag: 0 }, null);
  assert.deepEqual([iso(unknownDuration.start), iso(unknownDuration.end), unknownDuration.durationDays], ["2026-01-06", "2026-01-06", 1]);
  assert.equal(computeLinkedDates({ start: null, end: null }, { type: "FD", lag: 0 }, 2), null);
  assert.equal(computeLinkedDates(pred, null, 2), null);
});

// Modèle de la capture MS Project : [id, durée, lien].
const CHAIN = [
  [100, 0, null], // RECEPTION ARCH/TOPO/STR
  [101, 2, "100 DD"], // FOND DE PLAN DE SYNTHESE NIV
  [102, 0, "101 FD"], // DIFFUSION FDS Indice 0
  [103, 10, "102 FD"], // RECEPTION RENDU CET RESEAUX (GED)
  [104, 10, "103 FD"], // VISA Indice 0
  [105, 5, "103 FD"], // PLAN DE SYNTHESE RESEAUX (cycle 1)
  [106, 0, "105 FD"], // REUNION + DIFFUSION SYT RSX Indice 0
  [107, 5, "106 FD"], // RECEPTION RENDU CET RSX RESA TER (cycle 2)
  [108, 5, "107 FD"], // PLAN DE SYNTHESE RESEAUX (cycle 2)
  [109, 2, "108 FF"], // RESERVATIONS
  [110, 2, "108 FF"], // TERMINAUX
  [111, 0, "108 FD"], // REUNION + DIFFUSION SYT
  [112, 5, "111 FD"], // RECEPTION RENDU CET RSX RESA TER (cycle 3)
  [113, 10, "112 FD"], // VISA Indice A
  [114, 5, "112 FD"], // PLAN DE SYNTHESE RESEAUX (cycle 3)
  [115, 2, "114 FF"], // RESERVATIONS
  [116, 2, "114 FF"], // TERMINAUX
  [117, 0, "114 FD"], // REUNION + DIFFUSION SYT
  [118, 0, "113 FD+5"], // SIGNATURE PLANS SYNTHESE
  [119, 0, "118 FD"], // DEMARRAGE GO (date prévisionnelle)
];

function chain() {
  return CHAIN.map(([id, days, link]) => ({
    id,
    start: null,
    end: null,
    durationDays: days,
    isMilestone: false,
    link: parseLink(link),
  }));
}

function datesOf(updates) {
  return Object.fromEntries(updates.map((task) => [task.id, [iso(task.start), iso(task.end)]]));
}

test("cascade : la capture MS Project est retrouvée en datant la première tâche au 02/01/26", () => {
  const tasks = chain();
  const first = { ...tasks[0], start: day(2026, 1, 2), end: day(2026, 1, 2), durationDays: 0, isMilestone: true };
  const updates = cascadeFrom(first, tasks);
  assert.deepEqual(datesOf(updates), {
    101: ["2026-01-02", "2026-01-05"],
    102: ["2026-01-05", "2026-01-05"],
    103: ["2026-01-06", "2026-01-19"],
    104: ["2026-01-20", "2026-02-02"],
    105: ["2026-01-20", "2026-01-26"],
    106: ["2026-01-26", "2026-01-26"],
    107: ["2026-01-27", "2026-02-02"],
    108: ["2026-02-03", "2026-02-09"],
    109: ["2026-02-06", "2026-02-09"],
    110: ["2026-02-06", "2026-02-09"],
    111: ["2026-02-09", "2026-02-09"],
    112: ["2026-02-10", "2026-02-16"],
    113: ["2026-02-17", "2026-03-02"],
    114: ["2026-02-17", "2026-02-23"],
    115: ["2026-02-20", "2026-02-23"],
    116: ["2026-02-20", "2026-02-23"],
    117: ["2026-02-23", "2026-02-23"],
    118: ["2026-03-09", "2026-03-09"],
    119: ["2026-03-09", "2026-03-09"],
  });
  const milestones = updates.filter((task) => task.isMilestone).map((task) => task.id);
  assert.deepEqual(milestones, [102, 106, 111, 117, 118, 119]);
});

// Review Focus 2 : une date saisie au milieu de la chaîne ne remonte jamais vers l'amont.
test("cascade depuis le milieu : seules les tâches en aval bougent", () => {
  const tasks = chain();
  const first = { ...tasks[0], start: day(2026, 1, 2), end: day(2026, 1, 2), durationDays: 0, isMilestone: true };
  const dated = new Map(cascadeFrom(first, tasks).map((task) => [task.id, task]));
  const current = tasks.map((task) => dated.get(task.id) || (task.id === 100 ? first : task));
  const visa = current.find((task) => task.id === 113);
  const later = { ...visa, end: day(2026, 3, 9), durationDays: 15 };
  assert.deepEqual(datesOf(cascadeFrom(later, current)), {
    118: ["2026-03-16", "2026-03-16"],
    119: ["2026-03-16", "2026-03-16"],
  });
});

test("cascade : prédécesseur non daté, rien ne bouge ; tâches déjà à jour, rien n'est rendu", () => {
  const tasks = chain();
  assert.deepEqual(cascadeFrom(tasks[0], tasks), []);
  const first = { ...tasks[0], start: day(2026, 1, 2), end: day(2026, 1, 2), durationDays: 0, isMilestone: true };
  const once = new Map(cascadeFrom(first, tasks).map((task) => [task.id, task]));
  const upToDate = tasks.map((task) => once.get(task.id) || task);
  assert.deepEqual(cascadeFrom(first, upToDate), []);
});

// Review Focus 1 : un lien abîmé à la main (boucle, lien vers une ligne absente) ne bloque rien.
test("cascade : une boucle s'arrête, un lien vers une ligne absente est ignoré", () => {
  const a = { id: 1, start: day(2026, 1, 5), end: day(2026, 1, 6), durationDays: 2, isMilestone: false, link: parseLink("2 FD") };
  const b = { id: 2, start: null, end: null, durationDays: 1, isMilestone: false, link: parseLink("1 FD") };
  const orphan = { id: 3, start: null, end: null, durationDays: 1, isMilestone: false, link: parseLink("99 FD") };
  const updates = cascadeFrom(a, [a, b, orphan]);
  assert.deepEqual(datesOf(updates), { 2: ["2026-01-07", "2026-01-07"] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (depuis `Planning Projet/`) : `node --test tests/syntheseLinks.test.mjs`
Expected: FAIL — `Cannot find module '.../syntheseLinks.js'`.

- [ ] **Step 3: Write minimal implementation**

Créer `Planning Projet/assets/js/services/syntheseLinks.js` :

```js
// Liens entre les tâches de la vue Synthese, comme les liens de MS Project : texte de la
// colonne Lien (« 131 FD+5 » : après la tâche 131, fin → début, 5 jours ouvrés plus tard),
// dates d'une tâche liée et cascade des dates vers l'aval. Module pur, sans DOM ni Grist.
import { endAfterWorkingDays, isWorkingDay } from "./syntheseTasks.js";

export const LINK_TYPES = Object.freeze(["FD", "DD", "FF"]);

// « 131 FD », « 131FD+5 », « 7 ff - 2 j » ; le décalage est en jours ouvrés.
const LINK_PATTERN = /^\s*(\d+)\s*(FD|DD|FF)\s*(?:([+-])\s*(\d+)\s*(?:j|jours?)?)?\s*$/i;

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isDated(task) {
  return task?.start instanceof Date && task?.end instanceof Date;
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

// Début d'un segment de `days` jours ouvrés finissant à `end` (déjà ouvré) : l'inverse de
// endAfterWorkingDays.
export function startBeforeWorkingDays(end, days) {
  const wanted = Math.max(1, Math.round(Number(days) || 1));
  let cursor = toDay(end);
  let counted = isWorkingDay(cursor) ? 1 : 0;
  while (counted < wanted) {
    cursor = shiftDays(cursor, -1);
    if (isWorkingDay(cursor)) counted += 1;
  }
  return cursor;
}

// `count` jours ouvrés après (count > 0) ou avant (count < 0) une date ; 0 : la date même.
export function addWorkingDays(date, count) {
  const steps = Math.trunc(Number(count) || 0);
  const direction = steps < 0 ? -1 : 1;
  let remaining = Math.abs(steps);
  let cursor = toDay(date);
  while (remaining > 0) {
    cursor = shiftDays(cursor, direction);
    if (isWorkingDay(cursor)) remaining -= 1;
  }
  return cursor;
}

export function parseLink(value) {
  const match = LINK_PATTERN.exec(value == null ? "" : String(value));
  if (!match) return null;
  const predId = Number(match[1]);
  if (!Number.isInteger(predId) || predId <= 0) return null;
  const lag = match[4] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  return { predId, type: match[2].toUpperCase(), lag };
}

export function formatLink({ predId, type, lag = 0 } = {}) {
  const shift = lag > 0 ? `+${lag}` : lag < 0 ? `${lag}` : "";
  return `${predId} ${type}${shift}`;
}

// Dates d'une tâche liée à un prédécesseur daté, pour sa durée en jours ouvrés (0 = jalon ;
// inconnue = un jour). FD : le jour ouvré qui suit la Fin du prédécesseur (un jalon se pose
// le jour même de cette Fin) ; DD : le Début du prédécesseur ; FF : la Fin du prédécesseur,
// Début à rebours. Le décalage ajoute (ou retire) des jours ouvrés.
export function computeLinkedDates(pred, link, durationDays) {
  if (!isDated(pred) || !link) return null;
  const days = Number.isInteger(durationDays) && durationDays >= 0 ? durationDays : 1;
  const lag = Number(link.lag) || 0;
  if (link.type === "FF") {
    const end = previousWorkingDay(addWorkingDays(pred.end, lag));
    if (days === 0) return { start: end, end, durationDays: 0, isMilestone: true };
    return { start: startBeforeWorkingDays(end, days), end, durationDays: days, isMilestone: false };
  }
  const anchor = link.type === "DD"
    ? addWorkingDays(pred.start, lag)
    : addWorkingDays(pred.end, days === 0 ? lag : lag + 1);
  const start = nextWorkingDay(anchor);
  if (days === 0) return { start, end: start, durationDays: 0, isMilestone: true };
  return { start, end: endAfterWorkingDays(start, days), durationDays: days, isMilestone: false };
}

// Tâches liées en aval d'une tâche qui vient de changer, recalculées de proche en proche
// (une tâche n'a qu'un prédécesseur). Une tâche dont le prédécesseur n'a pas de dates reste
// telle quelle, avec tout ce qui en dépend ; une tâche déjà traitée ne l'est pas deux fois
// (une boucle saisie à la main s'arrête). Renvoie les seules tâches dont les dates changent.
export function cascadeFrom(changed, tasks = []) {
  if (!changed) return [];
  const successors = new Map();
  (tasks || []).forEach((task) => {
    const predId = task?.link?.predId;
    if (!predId || task.id === changed.id) return;
    if (!successors.has(predId)) successors.set(predId, []);
    successors.get(predId).push(task);
  });
  const current = new Map([[changed.id, changed]]);
  const seen = new Set([changed.id]);
  const queue = [changed.id];
  const updates = [];
  while (queue.length) {
    const pred = current.get(queue.shift());
    (successors.get(pred.id) || []).forEach((task) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      const dates = computeLinkedDates(pred, task.link, task.durationDays);
      if (!dates) return;
      const next = { ...task, ...dates };
      current.set(task.id, next);
      if (!isSameDay(task.start, next.start) || !isSameDay(task.end, next.end) || task.isMilestone !== next.isMilestone) {
        updates.push(next);
      }
      queue.push(task.id);
    });
  }
  return updates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/syntheseLinks.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run : `node --test tests/*.test.mjs` → tous verts (262). Ne pas commiter.

---

### Task 2: Lecture des lignes et saisies (`syntheseTaskModel.js`)

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (en-tête d'imports, `TASK_COLUMNS`, reconnaissance l. 111-139, `readTask` l. 147-167, `withDates` / `applyTaskEdit` l. 185-269, fin de fichier)
- Modify: `Planning Projet/tests/syntheseTaskModel.test.mjs`, `Planning Projet/tests/syntheseTaskEdits.test.mjs`, `Planning Projet/tests/planningSyncTaskRows.test.mjs`

**Interfaces:**
- Consumes (tâche 1) : `nextWorkingDay`, `previousWorkingDay`, `startBeforeWorkingDays`, `parseLink` de `syntheseLinks.js`.
- Produces :
  - `TASK_COLUMNS` + `indice: "Indice"`, `service: "Service"`, `nature: "Nature"`, `parent: "Parent"`, `link: "Lien"`
  - `NATURES` = `{ cycle: "Cycle", subgroup: "Sous-groupe", meeting: "Reunion", kickoff: "Demarrage" }` ; `natureKeyOf(value) → "cycle"|"sous-groupe"|"reunion"|"demarrage"|""`
  - `MAX_CODE_LENGTH` = 50
  - `isSyntheseServiceRow(row)`, `isGroupRow(row)` ; `isTaskRow` exclut les groupes ; `isSyntheseRow` accepte une tâche Synthese avec N°
  - `readTask(row)` rend en plus `natureKey`, `parentId: number|null`, `groupRowId: null`, `link`, `id2`, `indice` ; sans dates, `durationDays` = durée prévue (`Duree_1`, 0 = jalon prévu, vide → null)
  - `applyTaskEdit` accepte `field` = `"id2"` / `"indice"` ; Durée sur une tâche sans dates : seule `Duree_1` ; date sur une tâche sans dates : la durée prévue donne l'autre date
  - `dateFieldsOf(task) → { Diff_coffrage, Diff_armature, Duree_1 }`
  - `detectTemplateColumns(rows) → true|false|null`
  - `nextWorkingDay` / `previousWorkingDay` restent exportés par le modèle (réexport).

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTaskModel.test.mjs` :

1. Ajouter aux imports : `MAX_CODE_LENGTH`, `NATURES`, `detectTemplateColumns`, `isGroupRow`, `natureKeyOf`.
2. Dans le test « les colonnes Grist utilisées », compléter l'objet attendu après `duration: "Duree_1",` :

```js
    indice: "Indice",
    service: "Service",
    nature: "Nature",
    parent: "Parent",
    link: "Lien",
```

3. Dans le test « dates manquantes ou inversées », remplacer `assert.equal(undated.durationDays, null);` par :

```js
  assert.equal(undated.durationDays, 11, "sans dates : la durée prévue (Duree_1)");
  assert.equal(readTask(taskRow({ Diff_coffrage: null, Diff_armature: null, Duree_1: "" })).durationDays, null);
  assert.equal(readTask(taskRow({ Diff_coffrage: null, Diff_armature: null, Duree_1: 0 })).durationDays, 0, "jalon prévu");
  assert.equal(readTask(taskRow({ Diff_coffrage: null, Diff_armature: null, Duree_1: 2.5 })).durationDays, null);
```

4. Ajouter à la fin du fichier :

```js
test("une tâche Synthese garde son N° : le Service décide", () => {
  const synthese = { Service: "Synthese" };
  assert.equal(isTaskRow(taskRow({ ID2: "2001", ...synthese })), true);
  assert.equal(isTaskRow(taskRow({ ID2: "2001", Service: "Synthèse " })), true, "accents et espaces ignorés");
  assert.equal(isTaskRow(taskRow({ ID2: "2001", Service: "Structure" })), false, "document d'un autre service");
  assert.equal(isTaskRow(taskRow({ ID2: "2001", Type_doc: "COFFRAGE", ...synthese })), false, "document Synthese typé");
  assert.equal(isSyntheseRow(taskRow({ ID2: "2001", ...synthese })), true);
});

test("natures : lecture sans accents ni casse ; cycles et sous-groupes ne sont pas des tâches", () => {
  assert.deepEqual({ ...NATURES }, { cycle: "Cycle", subgroup: "Sous-groupe", meeting: "Reunion", kickoff: "Demarrage" });
  assert.equal(natureKeyOf("Réunion"), "reunion");
  assert.equal(natureKeyOf(" sous groupe "), "sous-groupe");
  assert.equal(natureKeyOf("DEMARRAGE"), "demarrage");
  assert.equal(natureKeyOf("autre"), "");
  assert.equal(natureKeyOf(null), "");
  const cycle = taskRow({ Taches: "CYCLE 1", Nature: "Cycle", Groupe: "SS1" });
  assert.equal(isGroupRow(cycle), true);
  assert.equal(isTaskRow(cycle), false);
  assert.equal(isSyntheseRow(cycle), true);
  assert.equal(isGroupRow(taskRow({ Nature: "Sous-groupe" })), true);
  assert.equal(isGroupRow(taskRow({ Nature: "Reunion" })), false, "une réunion est une tâche");
  assert.equal(isTaskRow(taskRow({ Nature: "Reunion" })), true);
  assert.equal(isGroupRow(taskRow({ Nature: "Cycle", Etage: true })), false, "un étage reste un étage");
});

test("readTask : nature, Parent, Lien, N° et Indice", () => {
  const task = readTask(taskRow({ Nature: "Reunion", Parent: " 203 ", Lien: "208 FD", ID2: " 2001 ", Indice: "A", Service: "Synthese" }));
  assert.equal(task.natureKey, "reunion");
  assert.equal(task.parentId, 203);
  assert.equal(task.groupRowId, null);
  assert.deepEqual(task.link, { predId: 208, type: "FD", lag: 0 });
  assert.equal(task.id2, "2001");
  assert.equal(task.indice, "A");
  const plain = readTask(taskRow({ Parent: "abc", Lien: "n'importe quoi" }));
  assert.equal(plain.parentId, null);
  assert.equal(plain.link, null);
  assert.equal(plain.natureKey, "");
  assert.equal(readTask(taskRow({ Lien: "5 FD" })).link, null, "une tâche ne dépend pas d'elle-même");
});

test("colonnes Nature, Parent et Lien : présentes, absentes, ou inconnues sans ligne", () => {
  assert.equal(detectTemplateColumns([]), null);
  assert.equal(detectTemplateColumns([{ id: 1, Taches: "" }]), false);
  assert.equal(detectTemplateColumns([{ id: 1, Nature: "", Parent: "" }]), false);
  assert.equal(detectTemplateColumns([{ id: 1, Nature: "", Parent: "", Lien: "" }]), true);
  assert.equal(MAX_CODE_LENGTH, 50);
});
```

Dans `Planning Projet/tests/syntheseTaskEdits.test.mjs` :

1. Ajouter aux imports : `MAX_CODE_LENGTH`, `dateFieldsOf`.
2. Remplacer la fixture `undated` par (durée prévue inconnue) :

```js
const undated = () => task({ id: 7, Taches: "À planifier", Diff_coffrage: null, Diff_armature: null, Duree_1: "" });
```

3. Remplacer entièrement le test « tâche sans dates : une Durée part du prochain jour ouvré » par :

```js
test("tâche sans dates : la Durée est seulement mémorisée, aucune date n'est créée", () => {
  const result = applyTaskEdit(undated(), "duration", "3", { today: day(2026, 9, 26) });
  assert.equal(result.ok, true);
  assert.equal(result.task.start, null);
  assert.equal(result.task.durationDays, 3);
  assert.deepEqual(result.fields, { Duree_1: 3 });
  const planned = task({ id: 8, Taches: "Visa", Diff_coffrage: null, Diff_armature: null, Duree_1: 3 });
  assert.deepEqual(applyTaskEdit(planned, "duration", "3", { today: TODAY }).fields, {});
});
```

4. Ajouter à la fin du fichier :

```js
test("tâche sans dates avec une durée prévue : la date saisie donne l'autre", () => {
  const visa = task({ id: 8, Taches: "VISA Indice 0", Diff_coffrage: null, Diff_armature: null, Duree_1: 10 });
  const byStart = edit(visa, "start", "2026-01-20");
  assert.deepEqual([iso(byStart.task.start), iso(byStart.task.end), byStart.task.durationDays], ["2026-01-20", "2026-02-02", 10]);
  assert.deepEqual(byStart.fields, { Diff_coffrage: "2026-01-20", Diff_armature: "2026-02-02", Duree_1: 10 });
  const byEnd = edit(visa, "end", "2026-02-02");
  assert.equal(iso(byEnd.task.start), "2026-01-20");
  const jalon = task({ id: 9, Taches: "DIFFUSION FDS", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 });
  const placed = edit(jalon, "start", "2026-01-03"); // samedi → lundi
  assert.deepEqual([iso(placed.task.start), iso(placed.task.end), placed.task.isMilestone], ["2026-01-05", "2026-01-05", true]);
  assert.deepEqual(placed.fields, { Diff_coffrage: "2026-01-05", Diff_armature: "2026-01-05", Duree_1: 0 });
});

test("N° et Indice : texte libre, espaces retirés, vide permis, 50 caractères au plus", () => {
  const base = visa();
  assert.deepEqual(edit(base, "id2", " 2001 ").fields, { ID2: "2001" });
  assert.equal(edit(base, "id2", " 2001 ").task.id2, "2001");
  assert.deepEqual(edit(base, "indice", "A").fields, { Indice: "A" });
  assert.deepEqual(edit({ ...base, indice: "A" }, "indice", "A").fields, {});
  assert.deepEqual(edit({ ...base, id2: "2001" }, "id2", "").fields, { ID2: "" });
  const tooLong = "x".repeat(MAX_CODE_LENGTH + 1);
  assert.deepEqual(edit(base, "id2", tooLong), { ok: false, error: "Le N° est limité à 50 caractères." });
  assert.deepEqual(edit(base, "indice", tooLong), { ok: false, error: "L'indice est limité à 50 caractères." });
});

test("colonnes de dates d'une tâche datée", () => {
  const result = edit(visa(), "duration", "0");
  assert.deepEqual(dateFieldsOf(result.task), { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-09", Duree_1: 0 });
  assert.deepEqual(dateFieldsOf(visa()), { Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 });
});
```

Dans `Planning Projet/tests/planningSyncTaskRows.test.mjs`, ajouter à la fin :

```js
// Review Focus 5 : le N° d'une tâche Synthese n'en fait pas un document à recalculer.
test("le recalcul automatique ignore une tâche Synthese qui a un N° et un indice", () => {
  const rows = [
    { id: 1, NomProjet: "P", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001", Service: "Synthese" },
    { id: 8, NomProjet: "P", Taches: "PLAN DE SYNTHESE RESEAUX NIV SS1", Type_doc: "", ID2: "2001", Indice: "A", Service: "Synthese" },
    { id: 9, NomProjet: "P", Taches: "Plan sans type", Type_doc: "", ID2: "3001", Service: "Structure" },
  ];
  assert.deepEqual(getProjectPlanningRows(rows, "P").map((row) => row.id), [1, 9]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run : `node --test tests/syntheseTaskModel.test.mjs tests/syntheseTaskEdits.test.mjs tests/planningSyncTaskRows.test.mjs`
Expected: FAIL — imports manquants (`NATURES`, `isGroupRow`…) et assertions sur `durationDays`.

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js` :

**3a.** Remplacer le bloc d'imports du haut par :

```js
import {
  countWorkingDays,
  endAfterWorkingDays,
  formatDays,
  formatTaskDate,
  isWorkingDay,
  parseGristDate,
  toIsoDate,
} from "./syntheseTasks.js";
import {
  nextWorkingDay,
  parseLink,
  previousWorkingDay,
  startBeforeWorkingDays,
} from "./syntheseLinks.js";

// Recalage sur les jours ouvrés : défini avec les liens, exporté ici comme avant.
export { nextWorkingDay, previousWorkingDay };
```

**3b.** Remplacer `TASK_COLUMNS` par :

```js
export const TASK_COLUMNS = Object.freeze({
  id: "id",
  project: "NomProjet",
  name: "Taches",
  typeDoc: "Type_doc",
  id2: "ID2",
  zone: "Zone",
  group: "Groupe",
  floor: "Etage",
  start: "Diff_coffrage",
  end: "Diff_armature",
  duration: "Duree_1",
  indice: "Indice",
  service: "Service",
  nature: "Nature",
  parent: "Parent",
  link: "Lien",
});
```

**3c.** Juste après `export const MAX_TASK_YEAR = 2100;`, ajouter :

```js
// N° (ID2) et Indice d'une tâche : texte libre, court.
export const MAX_CODE_LENGTH = 50;

// Colonne Nature : ce que la ligne représente dans un étage. Valeurs écrites par le widget ;
// lecture sans accents ni casse (« Réunion » = « reunion »).
export const NATURES = Object.freeze({
  cycle: "Cycle",
  subgroup: "Sous-groupe",
  meeting: "Reunion",
  kickoff: "Demarrage",
});
const NATURE_KEYS = new Set(["cycle", "sous-groupe", "reunion", "demarrage"]);
const GROUP_NATURE_KEYS = new Set(["cycle", "sous-groupe"]);
```

**3d.** Supprimer les définitions locales de `nextWorkingDay`, `previousWorkingDay` et `startBeforeWorkingDays` (avec leurs commentaires) : elles viennent maintenant de `syntheseLinks.js`.

**3e.** Juste après la fonction `toText`, ajouter :

```js
function plainKey(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
}

export function natureKeyOf(value) {
  const key = plainKey(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return NATURE_KEYS.has(key) ? key : "";
}

// Ligne du service Synthese (colonne Service, sans accents, casse ni espaces).
export function isSyntheseServiceRow(row) {
  return plainKey(row?.[TASK_COLUMNS.service]).replace(/[^a-z0-9]+/g, "") === "synthese";
}
```

**3f.** Remplacer `isNamedPlainRow`, `isFloorRow`, `isTaskRow`, `isSyntheseRow` (avec leurs commentaires) par :

```js
// Ligne propre à la vue Synthese : nommée, sans type de document. Un N° (ID2) ne fait un
// document que hors du service Synthese : une tâche Synthese garde son N° et son indice.
function isNamedPlainRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    Boolean(toText(row?.[TASK_COLUMNS.name])) &&
    !toText(row?.[TASK_COLUMNS.typeDoc]) &&
    (!toText(row?.[TASK_COLUMNS.id2]) || isSyntheseServiceRow(row));
}

// Colonne Etage : booléen Grist, ou le texte « true » si la colonne est du texte.
export function isFloorValue(value) {
  return value === true || toText(value).toLocaleLowerCase("fr") === "true";
}

// Un étage est une ligne Synthese marquée Etage ; un groupe (cycle ou sous-groupe), une ligne
// Synthese de Nature Cycle ou Sous-groupe ; une tâche, toute autre ligne Synthese.
export function isFloorRow(row) {
  return isNamedPlainRow(row) && isFloorValue(row?.[TASK_COLUMNS.floor]);
}

export function isGroupRow(row) {
  return isNamedPlainRow(row) && !isFloorValue(row?.[TASK_COLUMNS.floor]) &&
    GROUP_NATURE_KEYS.has(natureKeyOf(row?.[TASK_COLUMNS.nature]));
}

export function isTaskRow(row) {
  return isNamedPlainRow(row) && !isFloorValue(row?.[TASK_COLUMNS.floor]) && !isGroupRow(row);
}

// Tâches, étages et groupes : le planning Structure et son recalcul les ignorent.
export function isSyntheseRow(row) {
  return isNamedPlainRow(row);
}
```

(Conserver `isFloorValue` une seule fois : si elle existe déjà juste au-dessus, ne pas la dupliquer.)

**3g.** Juste avant `readTask`, ajouter :

```js
// Colonne Parent : id (texte) du cycle ou du sous-groupe qui contient la ligne.
function readParentId(row) {
  const id = Number(toText(row?.[TASK_COLUMNS.parent]));
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Durée prévue d'une tâche sans dates : Duree_1 (0 = jalon prévu) ; vide ou illisible → null.
function readPlannedDays(value) {
  if (value == null || toText(value) === "") return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= MAX_DURATION_DAYS ? days : null;
}
```

**3h.** Remplacer `readTask` par :

```js
// Les dates font foi pour la Durée ; Duree_1 sert à reconnaître un jalon (0 jour) d'une
// tâche d'un jour, qui ont toutes deux Début = Fin, et donne la durée prévue d'une tâche
// sans dates (modèle d'étage).
export function readTask(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  const zoneName = toText(row?.[TASK_COLUMNS.zone]);
  let start = parseGristDate(row?.[TASK_COLUMNS.start]);
  let end = parseGristDate(row?.[TASK_COLUMNS.end]);
  if (start && end && end < start) [start, end] = [end, start];
  const hasDates = Boolean(start && end);
  const isMilestone = hasDates && isSameDay(start, end) &&
    isStoredMilestone(row?.[TASK_COLUMNS.duration]);
  const link = parseLink(row?.[TASK_COLUMNS.link]);
  return {
    id,
    name: toText(row?.[TASK_COLUMNS.name]),
    zoneName,
    zoneKey: zoneKeyOf(zoneName),
    groupName: toText(row?.[TASK_COLUMNS.group]),
    floorKey: floorKeyOf(row?.[TASK_COLUMNS.group]),
    start,
    end,
    durationDays: hasDates
      ? (isMilestone ? 0 : countWorkingDays(start, end))
      : readPlannedDays(row?.[TASK_COLUMNS.duration]),
    isMilestone,
    natureKey: natureKeyOf(row?.[TASK_COLUMNS.nature]),
    parentId: readParentId(row),
    // Groupe effectif (cycle ou sous-groupe), posé par buildSections.
    groupRowId: null,
    link: link && link.predId !== id ? link : null,
    id2: toText(row?.[TASK_COLUMNS.id2]),
    indice: toText(row?.[TASK_COLUMNS.indice]),
  };
}
```

**3i.** Remplacer `withDates` par (même comportement, colonnes partagées) :

```js
// Colonnes de dates d'une tâche datée (Début, Fin, Durée), pour une écriture.
export function dateFieldsOf(task) {
  return {
    [TASK_COLUMNS.start]: toIsoDate(task.start),
    [TASK_COLUMNS.end]: toIsoDate(task.end),
    [TASK_COLUMNS.duration]: task.isMilestone ? 0 : task.durationDays,
  };
}

function withDates(task, start, end, isMilestone) {
  const durationDays = isMilestone ? 0 : countWorkingDays(start, end);
  const next = { ...task, start, end, durationDays, isMilestone };
  const unchanged = isSameDay(task.start, start) && isSameDay(task.end, end) &&
    task.isMilestone === isMilestone;
  return accept(next, unchanged ? {} : dateFieldsOf(next));
}
```

**3j.** Dans `applyTaskEdit` :

- tout en haut de la fonction, avant `if (field === "name")`, ajouter :

```js
  if (field === "id2" || field === "indice") {
    const value = toText(rawValue);
    if (value.length > MAX_CODE_LENGTH) {
      return refuse(field === "id2"
        ? `Le N° est limité à ${MAX_CODE_LENGTH} caractères.`
        : `L'indice est limité à ${MAX_CODE_LENGTH} caractères.`);
    }
    const column = field === "id2" ? TASK_COLUMNS.id2 : TASK_COLUMNS.indice;
    return accept({ ...task, [field]: value }, value === toText(task[field]) ? {} : { [column]: value });
  }
```

- dans la branche `duration`, remplacer `const days = Number(match[1]);` par :

```js
    const days = Number(match[1]);
    // Tâche sans aucune date : la durée est seulement mémorisée ; les dates viendront d'une
    // date saisie ou d'un lien.
    if (!task.start && !task.end) {
      return accept({ ...task, durationDays: days }, days === task.durationDays ? {} : { [TASK_COLUMNS.duration]: days });
    }
```

- dans la branche `start` / `end`, juste après le contrôle des années (`MIN_TASK_YEAR` / `MAX_TASK_YEAR`) et **avant** `if (task.isMilestone)`, ajouter :

```js
    // Tâche sans aucune date : sa durée prévue donne l'autre date (0 : jalon ; inconnue :
    // un jour).
    if (!task.start && !task.end) {
      const planned = Number.isInteger(task.durationDays) ? task.durationDays : 1;
      if (planned === 0) {
        const moved = nextWorkingDay(date);
        return withDates(task, moved, moved, true);
      }
      if (field === "start") {
        const start = nextWorkingDay(date);
        return withDates(task, start, endAfterWorkingDays(start, planned), false);
      }
      const end = previousWorkingDay(date);
      return withDates(task, startBeforeWorkingDays(end, planned), end, false);
    }
```

**3k.** Juste après `detectFloorColumn`, ajouter :

```js
// Les colonnes Nature, Parent et Lien existent-elles ? Comme pour Etage : null si aucune
// ligne ne permet de le savoir.
export function detectTemplateColumns(rows = []) {
  if (!rows?.length) return null;
  return [TASK_COLUMNS.nature, TASK_COLUMNS.parent, TASK_COLUMNS.link].every((column) => (
    rows.some((row) => row != null && Object.prototype.hasOwnProperty.call(row, column))
  ));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run : `node --test tests/*.test.mjs`
Expected: tous verts. Si un test existant échoue parce qu'une tâche **sans dates** affiche maintenant sa durée prévue au lieu de « — » (fixture avec `Duree_1: 0` ou `11` et dates vides), mettre la fixture à `Duree_1: ""` quand le test parle d'une durée inconnue ; ne pas changer le code.

- [ ] **Step 5: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 3: Modèle d'étage (`syntheseFloorTemplate.js`)

**Files:**
- Create: `Planning Projet/assets/js/services/syntheseFloorTemplate.js`
- Test: `Planning Projet/tests/syntheseFloorTemplate.test.mjs`

**Interfaces:**
- Consumes (tâche 2) : `NATURES`, `PLANNING_TABLE`, `TASK_COLUMNS`, `buildFloorFields` de `syntheseTaskModel.js`. Tests : `cascadeFrom`, `parseLink` (tâche 1).
- Produces :
  - `FLOOR_TEMPLATE` : 25 entrées `{ code, name, nature?, parent?, days?, link? }` (ordre de la capture ; `days` présent = tâche)
  - `buildFloorFromTemplate({ floorName, zoneName, projectName }) → object[]` : 26 champs de lignes (ligne-étage puis modèle), colonnes `Taches`, `Zone`, `Groupe`, `Etage`, `NomProjet`, `Nature`, `Duree_1`
  - `buildBulkAddAction(rows) → ["BulkAddRecord", "Planning_Projet", null[], { colonne: valeurs[] }]`
  - `buildTemplateLinks(ids) → { action: ["BulkUpdateRecord", …], fieldsById: Map<id, { Parent, Lien }> }` (lève une erreur si `ids` n'a pas 26 ids valides)

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseFloorTemplate.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  FLOOR_TEMPLATE,
  buildBulkAddAction,
  buildFloorFromTemplate,
  buildTemplateLinks,
} from "../assets/js/services/syntheseFloorTemplate.js";
import { cascadeFrom, parseLink } from "../assets/js/services/syntheseLinks.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Ids rendus par Grist pour les 26 lignes : la ligne-étage (201), puis le modèle (202 à 226).
const IDS = Array.from({ length: 26 }, (_, index) => 201 + index);

test("modèle : 3 cycles, 2 sous-groupes, 20 tâches et leurs durées", () => {
  assert.equal(FLOOR_TEMPLATE.length, 25);
  assert.deepEqual(
    FLOOR_TEMPLATE.filter((item) => item.nature === "Cycle").map((item) => item.name),
    ["CYCLE 1", "CYCLE 2", "CYCLE 3"]
  );
  assert.deepEqual(
    FLOOR_TEMPLATE.filter((item) => item.nature === "Sous-groupe").map((item) => item.name),
    ["PLAN SYT CYCLE 2", "PLAN SYT CYCLE 3"]
  );
  const tasks = FLOOR_TEMPLATE.filter((item) => Number.isInteger(item.days));
  assert.equal(tasks.length, 20);
  assert.deepEqual(tasks.map((item) => item.days), [0, 2, 0, 10, 10, 5, 0, 5, 5, 2, 2, 0, 5, 10, 5, 2, 2, 0, 0, 0]);
});

test("lignes d'un nouvel étage : la ligne-étage puis le modèle, sans dates, le nom de l'étage dans les noms", () => {
  const rows = buildFloorFromTemplate({ floorName: " SS1 ", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" });
  assert.equal(rows.length, 26);
  assert.deepEqual(rows[0], {
    Taches: "SS1",
    Zone: "Zone Z3A",
    Groupe: "",
    Etage: true,
    NomProjet: "HOTEL DIEU",
    Nature: "",
    Duree_1: 0,
  });
  assert.deepEqual(rows.slice(1).map((row) => row.Taches), [
    "RECEPTION ARCH/TOPO/STR",
    "CYCLE 1",
    "FOND DE PLAN DE SYNTHESE NIV SS1",
    "DIFFUSION FDS Indice 0",
    "RECEPTION RENDU CET RESEAUX (GED)",
    "VISA Indice 0",
    "PLAN DE SYNTHESE RESEAUX NIV SS1",
    "REUNION + DIFFUSION SYT RSX Indice 0",
    "CYCLE 2",
    "RECEPTION RENDU CET RSX RESA TER",
    "PLAN SYT CYCLE 2",
    "PLAN DE SYNTHESE RESEAUX NIV SS1",
    "PLAN DE SYNTHESE RESERVATIONS NIV SS1",
    "PLAN DE SYNTHESE TERMINAUX NIV SS1",
    "REUNION + DIFFUSION SYT",
    "CYCLE 3",
    "RECEPTION RENDU CET RSX RESA TER",
    "VISA Indice A",
    "PLAN SYT CYCLE 3",
    "PLAN DE SYNTHESE RESEAUX NIV SS1",
    "PLAN DE SYNTHESE RESERVATIONS NIV SS1",
    "PLAN DE SYNTHESE TERMINAUX NIV SS1",
    "REUNION + DIFFUSION SYT",
    "SIGNATURE PLANS SYNTHESE",
    "DEMARRAGE GO SS1 (date prévisionnelle)",
  ]);
  rows.slice(1).forEach((row) => {
    assert.equal(row.Groupe, "SS1");
    assert.equal(row.Zone, "Zone Z3A");
    assert.equal(row.NomProjet, "HOTEL DIEU");
    assert.equal(row.Etage, false);
    assert.equal("Diff_coffrage" in row, false);
    assert.equal("Diff_armature" in row, false);
  });
  assert.deepEqual(rows.map((row) => row.Nature).filter(Boolean), [
    "Cycle", "Reunion", "Cycle", "Sous-groupe", "Reunion", "Cycle", "Sous-groupe", "Reunion", "Demarrage",
  ]);
});

test("une seule écriture BulkAddRecord, mêmes colonnes pour toutes les lignes", () => {
  const rows = buildFloorFromTemplate({ floorName: "SS1", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" });
  const [verb, table, ids, columns] = buildBulkAddAction(rows);
  assert.equal(verb, "BulkAddRecord");
  assert.equal(table, "Planning_Projet");
  assert.deepEqual(ids, new Array(26).fill(null));
  assert.deepEqual(Object.keys(columns).sort(), ["Duree_1", "Etage", "Groupe", "Nature", "NomProjet", "Taches", "Zone"]);
  Object.values(columns).forEach((values) => assert.equal(values.length, 26));
  assert.equal(columns.Taches[3], "FOND DE PLAN DE SYNTHESE NIV SS1");
  assert.equal(columns.Etage[0], true);
});

test("Parent et Lien d'après les ids rendus par Grist", () => {
  const { action, fieldsById } = buildTemplateLinks(IDS);
  assert.deepEqual(
    Object.fromEntries([...fieldsById].map(([id, fields]) => [id, [fields.Parent, fields.Lien]])),
    {
      204: ["203", "202 DD"],
      205: ["203", "204 FD"],
      206: ["203", "205 FD"],
      207: ["203", "206 FD"],
      208: ["203", "206 FD"],
      209: ["203", "208 FD"],
      211: ["210", "209 FD"],
      212: ["210", ""],
      213: ["212", "211 FD"],
      214: ["212", "213 FF"],
      215: ["212", "213 FF"],
      216: ["210", "213 FD"],
      218: ["217", "216 FD"],
      219: ["217", "218 FD"],
      220: ["217", ""],
      221: ["220", "218 FD"],
      222: ["220", "221 FF"],
      223: ["220", "221 FF"],
      224: ["217", "221 FD"],
      225: ["217", "219 FD+5"],
      226: ["217", "225 FD"],
    }
  );
  assert.equal(action[0], "BulkUpdateRecord");
  assert.equal(action[1], "Planning_Projet");
  assert.deepEqual(action[2], [...fieldsById.keys()]);
  assert.equal(action[3].Parent.length, 21);
  assert.equal(action[3].Lien[action[2].indexOf(225)], "219 FD+5");
});

test("ids incomplets ou invalides : erreur", () => {
  assert.throws(() => buildTemplateLinks(IDS.slice(1)));
  assert.throws(() => buildTemplateLinks([...IDS.slice(1), 0]));
  assert.throws(() => buildTemplateLinks(null));
});

test("le modèle redonne la capture : premier jalon au 02/01/26, SIGNATURE et DEMARRAGE GO au 09/03/26", () => {
  const { fieldsById } = buildTemplateLinks(IDS);
  const tasks = FLOOR_TEMPLATE
    .map((item, index) => ({ item, id: IDS[index + 1] }))
    .filter(({ item }) => Number.isInteger(item.days))
    .map(({ item, id }) => ({
      id,
      start: null,
      end: null,
      durationDays: item.days,
      isMilestone: false,
      link: parseLink(fieldsById.get(id)?.Lien),
    }));
  const first = { ...tasks[0], start: new Date(2026, 0, 2), end: new Date(2026, 0, 2), durationDays: 0, isMilestone: true };
  const byId = new Map(cascadeFrom(first, tasks).map((task) => [task.id, task]));
  assert.equal(byId.size, 19);
  assert.deepEqual([iso(byId.get(204).start), iso(byId.get(204).end)], ["2026-01-02", "2026-01-05"]);
  assert.deepEqual([iso(byId.get(219).start), iso(byId.get(219).end)], ["2026-02-17", "2026-03-02"]);
  assert.equal(iso(byId.get(225).start), "2026-03-09");
  assert.equal(iso(byId.get(226).start), "2026-03-09");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/syntheseFloorTemplate.test.mjs`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

Créer `Planning Projet/assets/js/services/syntheseFloorTemplate.js` :

```js
// Modèle d'étage de la vue Synthese, repris du planning MS Project de l'utilisateur
// (« NIVEAU Sous-Sol 1 ») : trois cycles, deux sous-groupes « PLAN SYT CYCLE n » et vingt
// tâches, avec leurs durées (jours ouvrés, 0 = jalon) et leurs liens. {E} = nom de l'étage.
// Module pur : les lignes à ajouter, puis Parent et Lien une fois les ids connus.
import {
  NATURES,
  PLANNING_TABLE,
  TASK_COLUMNS,
  buildFloorFields,
} from "./syntheseTaskModel.js";

export const FLOOR_NAME_TOKEN = "{E}";

// code : repère dans le modèle (Parent et Lien s'y réfèrent) ; days présent = tâche.
export const FLOOR_TEMPLATE = Object.freeze([
  { code: "T0", name: "RECEPTION ARCH/TOPO/STR", days: 0 },
  { code: "C1", name: "CYCLE 1", nature: NATURES.cycle },
  { code: "T1", name: "FOND DE PLAN DE SYNTHESE NIV {E}", parent: "C1", days: 2, link: "T0 DD" },
  { code: "T2", name: "DIFFUSION FDS Indice 0", parent: "C1", days: 0, link: "T1 FD" },
  { code: "T3", name: "RECEPTION RENDU CET RESEAUX (GED)", parent: "C1", days: 10, link: "T2 FD" },
  { code: "T4", name: "VISA Indice 0", parent: "C1", days: 10, link: "T3 FD" },
  { code: "T5", name: "PLAN DE SYNTHESE RESEAUX NIV {E}", parent: "C1", days: 5, link: "T3 FD" },
  { code: "T6", name: "REUNION + DIFFUSION SYT RSX Indice 0", nature: NATURES.meeting, parent: "C1", days: 0, link: "T5 FD" },
  { code: "C2", name: "CYCLE 2", nature: NATURES.cycle },
  { code: "T7", name: "RECEPTION RENDU CET RSX RESA TER", parent: "C2", days: 5, link: "T6 FD" },
  { code: "S2", name: "PLAN SYT CYCLE 2", nature: NATURES.subgroup, parent: "C2" },
  { code: "T8", name: "PLAN DE SYNTHESE RESEAUX NIV {E}", parent: "S2", days: 5, link: "T7 FD" },
  { code: "T9", name: "PLAN DE SYNTHESE RESERVATIONS NIV {E}", parent: "S2", days: 2, link: "T8 FF" },
  { code: "T10", name: "PLAN DE SYNTHESE TERMINAUX NIV {E}", parent: "S2", days: 2, link: "T8 FF" },
  { code: "T11", name: "REUNION + DIFFUSION SYT", nature: NATURES.meeting, parent: "C2", days: 0, link: "T8 FD" },
  { code: "C3", name: "CYCLE 3", nature: NATURES.cycle },
  { code: "T12", name: "RECEPTION RENDU CET RSX RESA TER", parent: "C3", days: 5, link: "T11 FD" },
  { code: "T13", name: "VISA Indice A", parent: "C3", days: 10, link: "T12 FD" },
  { code: "S3", name: "PLAN SYT CYCLE 3", nature: NATURES.subgroup, parent: "C3" },
  { code: "T14", name: "PLAN DE SYNTHESE RESEAUX NIV {E}", parent: "S3", days: 5, link: "T12 FD" },
  { code: "T15", name: "PLAN DE SYNTHESE RESERVATIONS NIV {E}", parent: "S3", days: 2, link: "T14 FF" },
  { code: "T16", name: "PLAN DE SYNTHESE TERMINAUX NIV {E}", parent: "S3", days: 2, link: "T14 FF" },
  { code: "T17", name: "REUNION + DIFFUSION SYT", nature: NATURES.meeting, parent: "C3", days: 0, link: "T14 FD" },
  { code: "T18", name: "SIGNATURE PLANS SYNTHESE", parent: "C3", days: 0, link: "T13 FD+5" },
  { code: "T19", name: "DEMARRAGE GO {E} (date prévisionnelle)", nature: NATURES.kickoff, parent: "C3", days: 0, link: "T18 FD" },
].map((item) => Object.freeze(item)));

function toText(value) {
  return value == null ? "" : String(value).trim();
}

// Les 26 lignes d'un nouvel étage, dans l'ordre du modèle : la ligne-étage, puis tâches,
// cycles et sous-groupes. Mêmes colonnes pour toutes (une seule écriture) ; pas de dates ;
// Parent et Lien viendront avec les ids.
export function buildFloorFromTemplate({ floorName = "", zoneName = "", projectName = "" } = {}) {
  const floor = toText(floorName);
  const zone = toText(zoneName);
  const project = toText(projectName);
  const floorRow = {
    ...buildFloorFields({ name: floor, zoneName: zone, projectName: project }),
    [TASK_COLUMNS.nature]: "",
    [TASK_COLUMNS.duration]: 0,
  };
  const rows = FLOOR_TEMPLATE.map((item) => ({
    [TASK_COLUMNS.name]: item.name.split(FLOOR_NAME_TOKEN).join(floor),
    [TASK_COLUMNS.zone]: zone,
    [TASK_COLUMNS.group]: floor,
    [TASK_COLUMNS.floor]: false,
    [TASK_COLUMNS.project]: project,
    [TASK_COLUMNS.nature]: item.nature || "",
    [TASK_COLUMNS.duration]: Number.isInteger(item.days) ? item.days : 0,
  }));
  return [floorRow, ...rows];
}

// Lignes → une écriture BulkAddRecord (ids choisis par Grist).
export function buildBulkAddAction(rows) {
  const names = [];
  rows.forEach((row) => Object.keys(row).forEach((name) => {
    if (!names.includes(name)) names.push(name);
  }));
  const columns = {};
  names.forEach((name) => {
    columns[name] = rows.map((row) => (name in row ? row[name] : null));
  });
  return ["BulkAddRecord", PLANNING_TABLE, rows.map(() => null), columns];
}

// « T13 FD+5 » → « 219 FD+5 » : le code de la tâche remplacé par son id.
function resolveLink(text, idByCode) {
  const [code, ...rest] = text.split(" ");
  return [String(idByCode.get(code)), ...rest].join(" ");
}

// Parent et Lien des lignes du modèle, d'après les ids rendus par Grist dans l'ordre des
// lignes de buildFloorFromTemplate : l'écriture à faire et les valeurs par ligne.
export function buildTemplateLinks(ids) {
  const rowIds = Array.isArray(ids) ? ids.map(Number) : [];
  if (rowIds.length !== FLOOR_TEMPLATE.length + 1 || !rowIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error("Ids des lignes du modèle d'étage incomplets.");
  }
  const idByCode = new Map(FLOOR_TEMPLATE.map((item, index) => [item.code, rowIds[index + 1]]));
  const fieldsById = new Map();
  FLOOR_TEMPLATE.forEach((item, index) => {
    if (!item.parent && !item.link) return;
    fieldsById.set(rowIds[index + 1], {
      [TASK_COLUMNS.parent]: item.parent ? String(idByCode.get(item.parent)) : "",
      [TASK_COLUMNS.link]: item.link ? resolveLink(item.link, idByCode) : "",
    });
  });
  const targetIds = [...fieldsById.keys()];
  const action = ["BulkUpdateRecord", PLANNING_TABLE, targetIds, {
    [TASK_COLUMNS.parent]: targetIds.map((id) => fieldsById.get(id)[TASK_COLUMNS.parent]),
    [TASK_COLUMNS.link]: targetIds.map((id) => fieldsById.get(id)[TASK_COLUMNS.link]),
  }];
  return { action, fieldsById };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/syntheseFloorTemplate.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 4: Hiérarchie, récapitulatifs et modèle de lignes à 5 niveaux

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (`summarizeTasks`, après `readFloor`, `buildSections`, de `floorCollapseKey` à la fin du fichier)
- Create: `Planning Projet/tests/helpers/templateRows.mjs`
- Test: `Planning Projet/tests/syntheseFloorGroups.test.mjs`

**Interfaces:**
- Consumes : tâches 1 à 3 (`cascadeFrom`, `isTaskRow`, `isGroupRow`, `readTask`, `readParentId`, `natureKeyOf`, `dateFieldsOf`, `buildFloorFromTemplate`, `buildTemplateLinks`).
- Produces :
  - Étage (dans `section.floors`) : `{ key, name, rowIds, tasks /* toutes ses tâches */, groups /* tous ses groupes */, items /* contenu direct, ordre de création */, summary }`
  - Groupe : `{ rowId, name, natureKey: "cycle"|"sous-groupe", parentId, parentGroup: Group|null, zoneKey, zoneName, floorKey, floorName, items, tasks /* descendantes */, groups /* sous-groupes */, summary }`
  - Item : `{ kind: "task", task }` ou `{ kind: "group", group }` (dans un étage ou un groupe) ; `{ kind: "floor", floor }` au niveau zone (inchangé)
  - Chaque tâche rangée dans un étage reçoit `groupRowId` (id du groupe qui la contient, ou null).
  - `findGroup(sections, rowId) → Group|null` ; `groupCollapseKey(rowId) → "group:<id>"`
  - `buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys, collapsedGroupKeys })` ; ligne de groupe : `kind: "group"`, clé `group:<id>` ; **toutes** les lignes portent `groupRowId` (null hors groupe ; l'id du groupe pour une ligne de groupe et pour ses tâches directes), `groupLabel` (nom de ce groupe ou ""), `nature` (`natureKey` ou ""), `link`, `id2`, `indice`.
  - `summarizeTasks` : un jalon lié en `FD` est en fin de journée (il compte son jour).
  - Helpers de test : `templateRows({ zoneName = "Zone Z3A", floorName = "SS1", firstId = 201 })` (ligne de zone id 10 + 26 lignes), `datedRows(options)` (mêmes lignes datées depuis le 02/01/26).

- [ ] **Step 1: Write the test helper and the failing tests**

Créer `Planning Projet/tests/helpers/templateRows.mjs` :

```js
// Lignes Planning_Projet d'une zone (ligne de zone id 10) avec un étage créé d'après le modèle
// (ligne-étage firstId, puis les 25 lignes du modèle), Parent et Lien déjà écrits.
import { buildFloorFromTemplate, buildTemplateLinks } from "../../assets/js/services/syntheseFloorTemplate.js";
import { cascadeFrom } from "../../assets/js/services/syntheseLinks.js";
import { dateFieldsOf, isTaskRow, readTask } from "../../assets/js/services/syntheseTaskModel.js";

export function templateRows({ zoneName = "Zone Z3A", floorName = "SS1", firstId = 201 } = {}) {
  const fields = buildFloorFromTemplate({ floorName, zoneName, projectName: "HOTEL DIEU" });
  const ids = fields.map((_, index) => firstId + index);
  const { fieldsById } = buildTemplateLinks(ids);
  return [
    {
      id: 10, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: zoneName, Groupe: "", Etage: false,
      Nature: "", Parent: "", Lien: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0,
    },
    ...fields.map((row, index) => ({
      id: ids[index],
      Type_doc: "",
      ID2: "",
      Parent: "",
      Lien: "",
      Diff_coffrage: null,
      Diff_armature: null,
      ...row,
      ...(fieldsById.get(ids[index]) || {}),
    })),
  ];
}

// Les mêmes lignes, datées par la cascade depuis RECEPTION ARCH/TOPO/STR (firstId + 1) au 02/01/26.
export function datedRows(options = {}) {
  const firstId = options.firstId ?? 201;
  const rows = templateRows(options).map((row) => ({ ...row }));
  const first = rows.find((row) => row.id === firstId + 1);
  first.Diff_coffrage = "2026-01-02";
  first.Diff_armature = "2026-01-02";
  const tasks = rows.filter(isTaskRow).map(readTask);
  cascadeFrom(tasks.find((task) => task.id === first.id), tasks).forEach((task) => {
    Object.assign(rows.find((row) => row.id === task.id), dateFieldsOf(task));
  });
  return rows;
}
```

Créer `Planning Projet/tests/syntheseFloorGroups.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowModel,
  buildSections,
  findGroup,
  groupCollapseKey,
  readTask,
  summarizeTasks,
} from "../assets/js/services/syntheseTaskModel.js";
import { datedRows, templateRows } from "./helpers/templateRows.mjs";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);
const itemKey = (item) => (item.kind === "task" ? item.task.id : `g${item.group.rowId}`);

test("étage du modèle : tâches, cycles et sous-groupes rangés par ordre de création", () => {
  const [section] = buildSections({ rows: templateRows() });
  const [floor] = section.floors;
  assert.equal(floor.name, "SS1");
  assert.deepEqual(floor.items.map(itemKey), [202, "g203", "g210", "g217"]);
  const c2 = findGroup([section], 210);
  assert.equal(c2.name, "CYCLE 2");
  assert.equal(c2.natureKey, "cycle");
  assert.equal(c2.floorKey, "ss1");
  assert.equal(c2.zoneName, "Zone Z3A");
  assert.deepEqual(c2.items.map(itemKey), [211, "g212", 216]);
  const s2 = findGroup([section], 212);
  assert.equal(s2.parentGroup, c2);
  assert.deepEqual(s2.items.map(itemKey), [213, 214, 215]);
  assert.deepEqual(c2.tasks.map((task) => task.id).sort((a, b) => a - b), [211, 213, 214, 215, 216]);
  assert.deepEqual(c2.groups.map((group) => group.rowId), [212]);
  assert.equal(floor.tasks.length, 20);
  assert.deepEqual(floor.groups.map((group) => group.rowId), [203, 210, 212, 217, 220]);
  assert.equal(findGroup([section], 999), null);
  assert.equal(section.tasks.find((task) => task.id === 213).groupRowId, 212);
  assert.equal(section.tasks.find((task) => task.id === 202).groupRowId, null);
});

test("modèle de lignes : zone, étage, cycle, sous-groupe, tâches, sur 5 niveaux", () => {
  const lines = buildRowModel(buildSections({ rows: templateRows() }));
  assert.equal(lines.length, 27);
  const byKey = new Map(lines.map((line) => [line.key, line]));
  assert.deepEqual(lines.slice(0, 5).map((line) => [line.key, line.level]), [
    ["zone:zonez3a", 0],
    ["floor:zonez3a/ss1", 1],
    ["task:202", 2],
    ["group:203", 2],
    ["task:204", 3],
  ]);
  const s2 = byKey.get("group:212");
  assert.deepEqual(
    [s2.kind, s2.level, s2.nature, s2.groupRowId, s2.groupLabel, s2.childCount, s2.taskId],
    ["group", 3, "sous-groupe", 212, "PLAN SYT CYCLE 2", 3, null]
  );
  const reseaux = byKey.get("task:213");
  assert.deepEqual([reseaux.level, reseaux.groupRowId, reseaux.groupLabel, reseaux.floorKey], [4, 212, "PLAN SYT CYCLE 2", "ss1"]);
  assert.deepEqual(reseaux.link, { predId: 211, type: "FD", lag: 0 });
  assert.equal(byKey.get("task:209").nature, "reunion");
  assert.equal(byKey.get("task:226").nature, "demarrage");
  assert.equal(byKey.get("task:204").durationDays, 2, "durée prévue d'une tâche sans dates");
  const floorLine = byKey.get("floor:zonez3a/ss1");
  assert.deepEqual([floorLine.groupRowId, floorLine.groupLabel, floorLine.nature, floorLine.childCount], [null, "", "", 4]);
  assert.deepEqual([byKey.get("task:202").groupRowId, byKey.get("task:202").id2], [null, ""]);
});

test("repli : un cycle replié masque ses tâches et son sous-groupe", () => {
  const sections = buildSections({ rows: templateRows() });
  const lines = buildRowModel(sections, { collapsedGroupKeys: new Set([groupCollapseKey(210)]) });
  const keys = lines.map((line) => line.key);
  assert.equal(groupCollapseKey(210), "group:210");
  assert.ok(keys.includes("group:210"));
  for (const hidden of ["task:211", "group:212", "task:213", "task:216"]) assert.ok(!keys.includes(hidden), hidden);
  assert.ok(keys.includes("group:217"));
  assert.equal(lines.find((line) => line.key === "group:210").collapsed, true);
});

test("récapitulatifs de la capture : étage 47 j, cycles 22 / 10 / 20 j, PLAN SYT CYCLE 2 5 j", () => {
  const [section] = buildSections({ rows: datedRows() });
  const [floor] = section.floors;
  const summary = (item) => [iso(item.summary.start), iso(item.summary.end), item.summary.durationDays];
  assert.deepEqual(summary(floor), ["2026-01-02", "2026-03-09", 47]);
  assert.deepEqual(summary(findGroup([section], 203)), ["2026-01-02", "2026-02-02", 22]);
  assert.deepEqual(summary(findGroup([section], 210)), ["2026-01-27", "2026-02-09", 10]);
  assert.deepEqual(summary(findGroup([section], 212)), ["2026-02-03", "2026-02-09", 5]);
  assert.deepEqual(summary(findGroup([section], 217)), ["2026-02-10", "2026-03-09", 20]);
  assert.equal(floor.summary.endsWithMilestone, false, "jalons liés en FD : fin de journée");
  assert.equal(floor.summary.startsWithMilestone, false, "FOND DE PLAN commence le jour du premier jalon");
});

test("récapitulatif : un jalon final lié en FD compte son jour, un jalon libre non", () => {
  const task = (id, start, end, duration, link = "") => readTask({
    id, Taches: `T${id}`, Type_doc: "", ID2: "", Zone: "Z", Diff_coffrage: start, Diff_armature: end, Duree_1: duration, Lien: link,
  });
  const work = task(1, "2026-03-02", "2026-03-06", 5);
  assert.equal(summarizeTasks([work, task(2, "2026-03-09", "2026-03-09", 0)]).durationDays, 5);
  const linked = summarizeTasks([work, task(3, "2026-03-09", "2026-03-09", 0, "1 FD+1")]);
  assert.equal(linked.durationDays, 6);
  assert.equal(linked.endsWithMilestone, false);
});

// Review Focus 1 : Parent abîmé à la main dans Grist.
test("Parent cassé : la ligne se range directement dans son étage ; cycle sans étage ignoré", () => {
  const rows = templateRows();
  rows.find((row) => row.id === 204).Parent = "999";
  rows.find((row) => row.id === 205).Parent = "20";
  rows.find((row) => row.id === 212).Parent = "204";
  const extra = (id, fields) => ({
    id, NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z3A", Etage: false, Nature: "", Parent: "", Lien: "",
    Diff_coffrage: null, Diff_armature: null, Duree_1: 1, ...fields,
  });
  rows.push(extra(300, { Taches: "Tâche d'un autre étage", Groupe: "PH RDB", Parent: "203" }));
  rows.push(extra(301, { Taches: "CYCLE ORPHELIN", Groupe: "", Nature: "Cycle" }));
  rows.push(extra(302, { Taches: "Tâche du cycle orphelin", Groupe: "", Parent: "301" }));
  const [section] = buildSections({ rows });
  const ss1 = section.floors.find((floor) => floor.key === "ss1");
  assert.deepEqual(ss1.items.map(itemKey), [202, "g203", 204, 205, "g210", "g212", "g217"]);
  const rdb = section.floors.find((floor) => floor.key === "phrdb");
  assert.deepEqual(rdb.items.map(itemKey), [300], "Parent d'un autre étage : directement dans son étage");
  assert.ok(section.items.some((item) => item.kind === "task" && item.task.id === 302));
  assert.equal(findGroup([section], 301), null);
});

test("étage existant : ses tâches suivent l'ordre de création, plus l'ordre des dates", () => {
  const rows = [
    { id: 20, NomProjet: "HOTEL DIEU", Taches: "PH RDB", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: true },
    { id: 30, NomProjet: "HOTEL DIEU", Taches: "Tardive", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "PH RDB", Diff_coffrage: "2026-10-20", Diff_armature: "2026-10-21", Duree_1: 2 },
    { id: 31, NomProjet: "HOTEL DIEU", Taches: "Précoce", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "PH RDB", Diff_coffrage: "2026-10-01", Diff_armature: "2026-10-02", Duree_1: 2 },
  ];
  const keys = buildRowModel(buildSections({ rows })).map((line) => line.key);
  assert.deepEqual(keys, ["zone:zonez3a", "floor:zonez3a/phrdb", "task:30", "task:31"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run : `node --test tests/syntheseFloorGroups.test.mjs`
Expected: FAIL — `findGroup` / `groupCollapseKey` non exportés.

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js` :

**3a.** Dans `summarizeTasks`, remplacer la ligne `const endsAtDayStart = Boolean(task.isMilestone);` par :

```js
    // Un jalon lié en fin → début suit une tâche : il se place en fin de journée et compte
    // son jour, comme dans MS Project ; un jalon libre reste au début de son jour.
    const endsAtDayStart = Boolean(task.isMilestone) && task.link?.type !== "FD";
```

et mettre à jour le commentaire au-dessus de `summarizeTasks` : « … un jalon libre n'occupe que l'instant du début de son jour (placé en dernier, il ne compte pas son propre jour) ; un jalon lié en FD se place en fin de journée. »

**3b.** Juste après la fonction `readFloor`, ajouter :

```js
// Un cycle ou un sous-groupe, lu depuis sa ligne.
function readGroup(row) {
  const floorName = toText(row?.[TASK_COLUMNS.group]);
  const zoneName = toText(row?.[TASK_COLUMNS.zone]);
  return {
    rowId: Number(row?.[TASK_COLUMNS.id]),
    name: toText(row?.[TASK_COLUMNS.name]),
    natureKey: natureKeyOf(row?.[TASK_COLUMNS.nature]),
    parentId: readParentId(row),
    zoneKey: zoneKeyOf(zoneName),
    floorKey: floorKeyOf(floorName),
    floorName,
  };
}

function itemRowId(item) {
  return item.kind === "task" ? item.task.id : item.group.rowId;
}

// Contenu d'un étage, dans l'ordre de création (ordre du modèle) : ses tâches et ses cycles ;
// dans un cycle, ses tâches et ses sous-groupes ; dans un sous-groupe, ses tâches. Une ligne
// dont le Parent ne désigne pas un groupe de l'étage (ou un sous-groupe dont le Parent n'est
// pas un cycle) se range directement dans l'étage. Récapitulatif d'un groupe : toutes ses
// tâches, sous-groupes compris.
function placeFloorContent(floor) {
  const groupsById = new Map(floor.groups.map((group) => [group.rowId, group]));
  floor.groups.forEach((group) => {
    const parent = group.natureKey === "sous-groupe" ? groupsById.get(group.parentId) : null;
    group.parentGroup = parent?.natureKey === "cycle" ? parent : null;
    (group.parentGroup ? group.parentGroup.items : floor.items).push({ kind: "group", group });
    if (group.parentGroup) group.parentGroup.groups.push(group);
  });
  floor.tasks.forEach((task) => {
    const group = groupsById.get(task.parentId) || null;
    task.groupRowId = group ? group.rowId : null;
    (group ? group.items : floor.items).push({ kind: "task", task });
    for (let container = group; container; container = container.parentGroup) container.tasks.push(task);
  });
  const byRowId = (left, right) => itemRowId(left) - itemRowId(right);
  floor.items.sort(byRowId);
  floor.groups.forEach((group) => {
    group.items.sort(byRowId);
    group.summary = summarizeTasks(group.tasks);
  });
  floor.summary = summarizeTasks(floor.tasks);
}

// Le groupe (cycle ou sous-groupe) d'id rowId dans les sections, ou null.
export function findGroup(sections = [], rowId) {
  for (const section of sections || []) {
    for (const floor of section.floors || []) {
      const group = (floor.groups || []).find((candidate) => candidate.rowId === rowId);
      if (group) return group;
    }
  }
  return null;
}
```

**3c.** Dans `buildSections` :

- après le bloc qui remplit `floorRowsByZone`, ajouter :

```js
  const groupRowsByZone = new Map();
  rows.filter(isGroupRow).map(readGroup).forEach((group) => {
    if (group.zoneKey === NO_ZONE_KEY || !group.floorKey) return;
    if (!groupRowsByZone.has(group.zoneKey)) groupRowsByZone.set(group.zoneKey, []);
    groupRowsByZone.get(group.zoneKey).push(group);
  });
```

- dans `toSection`, remplacer tout ce qui va de `const floorFor = …` jusqu'à `items.sort(compareItems);` (inclus) par :

```js
    const floorFor = (key, name) => {
      if (!floors.has(key)) floors.set(key, { key, name, rowIds: [], tasks: [], groups: [], items: [], summary: null });
      return floors.get(key);
    };
    (floorRowsByZone.get(zoneKey) || []).forEach((floorRow) => {
      floorFor(floorRow.floorKey, floorRow.name).rowIds.push(floorRow.rowId);
    });
    (groupRowsByZone.get(zoneKey) || []).forEach((group) => {
      const floor = floorFor(group.floorKey, group.floorName);
      floor.groups.push({
        ...group,
        zoneName,
        floorName: floor.name,
        parentGroup: null,
        items: [],
        tasks: [],
        groups: [],
        summary: null,
      });
    });
    const items = [];
    tasks.forEach((task) => {
      if (zoneKey !== NO_ZONE_KEY && task.floorKey) floorFor(task.floorKey, task.groupName).tasks.push(task);
      else items.push({ kind: "task", task });
    });
    floors.forEach((floor) => {
      placeFloorContent(floor);
      items.push({ kind: "floor", floor });
    });
    items.sort(compareItems);
```

(Le reste de `toSection` — l'objet rendu avec `zoneKey`, `zoneName`, `label`, `tasks`, `summary`, `floors`, `items` — ne change pas.)

- mettre à jour le commentaire de `buildSections` : « … ses étages (lignes-étages et noms trouvés dans le Groupe des tâches et des groupes), chacun avec son contenu dans l'ordre de création ; son niveau zone : tâches hors étage en haut, puis étages, chacun par date. »

**3d.** Remplacer tout ce qui va de `// Clé de repli d'un étage` jusqu'à la fin du fichier par :

```js
// Clé de repli d'un étage (un même nom d'étage peut exister dans deux zones).
export function floorCollapseKey(zoneKey, floorKey) {
  return `${zoneKey}/${floorKey}`;
}

// Clé de repli d'un cycle ou d'un sous-groupe.
export function groupCollapseKey(rowId) {
  return `group:${rowId}`;
}

function summaryFields(summary) {
  return {
    start: summary?.start ?? null,
    end: summary?.end ?? null,
    durationDays: summary?.durationDays ?? null,
    isMilestone: false,
    startsWithMilestone: Boolean(summary?.startsWithMilestone),
    endsWithMilestone: Boolean(summary?.endsWithMilestone),
  };
}

// Champs propres aux tâches et aux groupes, vides sur les lignes de zone et d'étage.
const NO_GROUP_FIELDS = Object.freeze({ groupRowId: null, groupLabel: "", nature: "", link: null, id2: "", indice: "" });

// Le modèle de lignes : exactement ce qui est affiché, dans l'ordre, une entrée par ligne —
// la zone (niveau 0), puis son niveau zone : tâches hors étage (1) et étages (1) ; dans un
// étage, ses tâches et ses cycles (2) ; dans un cycle, ses tâches et ses sous-groupes (3) ;
// dans un sous-groupe, ses tâches (4). Le tableau le dessine ; le Gantt dessine la même liste,
// à la même hauteur de ligne.
export function buildRowModel(sections = [], {
  collapsedZoneKeys = new Set(),
  collapsedFloorKeys = new Set(),
  collapsedGroupKeys = new Set(),
} = {}) {
  const lines = [];
  const taskLine = (section, task, floor, group, level) => ({
    key: `task:${task.id}`,
    kind: "task",
    level,
    zoneKey: section.zoneKey,
    zoneName: section.zoneName,
    floorKey: floor ? floor.key : "",
    floorName: floor ? floor.name : "",
    floorRowIds: [],
    groupRowId: group ? group.rowId : null,
    groupLabel: group ? group.name : "",
    nature: task.natureKey || "",
    link: task.link || null,
    id2: task.id2 || "",
    indice: task.indice || "",
    taskId: task.id,
    name: task.name,
    start: task.start,
    end: task.end,
    durationDays: task.durationDays,
    isMilestone: task.isMilestone,
    startsWithMilestone: false,
    endsWithMilestone: false,
    collapsed: false,
    childCount: 0,
  });
  const pushItems = (section, floor, group, items, level) => {
    items.forEach((item) => {
      if (item.kind === "task") {
        lines.push(taskLine(section, item.task, floor, group, level));
        return;
      }
      const child = item.group;
      const collapsed = collapsedGroupKeys.has(groupCollapseKey(child.rowId));
      lines.push({
        key: `group:${child.rowId}`,
        kind: "group",
        level,
        zoneKey: section.zoneKey,
        zoneName: section.zoneName,
        floorKey: floor.key,
        floorName: floor.name,
        floorRowIds: [],
        groupRowId: child.rowId,
        groupLabel: child.name,
        nature: child.natureKey,
        link: null,
        id2: "",
        indice: "",
        taskId: null,
        name: child.name,
        ...summaryFields(child.summary),
        collapsed,
        childCount: child.items.length,
      });
      if (!collapsed) pushItems(section, floor, child, child.items, level + 1);
    });
  };
  sections.forEach((section) => {
    const collapsed = collapsedZoneKeys.has(section.zoneKey);
    lines.push({
      key: `zone:${section.zoneKey}`,
      kind: "zone",
      level: 0,
      zoneKey: section.zoneKey,
      zoneName: section.zoneName,
      floorKey: "",
      floorName: "",
      floorRowIds: [],
      ...NO_GROUP_FIELDS,
      taskId: null,
      name: section.label,
      ...summaryFields(section.summary),
      collapsed,
      childCount: section.items.length,
    });
    if (collapsed) return;
    section.items.forEach((item) => {
      if (item.kind === "task") {
        lines.push(taskLine(section, item.task, null, null, 1));
        return;
      }
      const { floor } = item;
      const floorCollapsed = collapsedFloorKeys.has(floorCollapseKey(section.zoneKey, floor.key));
      lines.push({
        key: `floor:${section.zoneKey}/${floor.key}`,
        kind: "floor",
        level: 1,
        zoneKey: section.zoneKey,
        zoneName: section.zoneName,
        floorKey: floor.key,
        floorName: floor.name,
        floorRowIds: [...floor.rowIds],
        ...NO_GROUP_FIELDS,
        taskId: null,
        name: floor.name,
        ...summaryFields(floor.summary),
        collapsed: floorCollapsed,
        childCount: floor.items.length,
      });
      if (floorCollapsed) return;
      pushItems(section, floor, null, floor.items, 2);
    });
  });
  return lines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run : `node --test tests/*.test.mjs`
Expected: tous verts. Si un test existant de `tests/syntheseTaskSections.test.mjs` attend les tâches **d'un étage** dans l'ordre des dates alors que leurs ids sont dans l'autre ordre, mettre l'attente dans l'ordre des ids (spec § 5.1 : ordre de création dans un étage) ; ne rien changer pour le niveau zone.

- [ ] **Step 5: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 5: Actions sur les étages et les groupes, cible de dépôt

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (`buildNewTask`, `buildTaskFields`, `buildFloorRenameActions` / `buildFloorDeleteActions`, après `buildFloorDeleteQuestion`, `containerKeyOf` / `resolveDropTarget` / `buildMoveFields`)
- Test: `Planning Projet/tests/syntheseGroupRules.test.mjs`

**Interfaces:**
- Consumes : tâche 4 (sections, `findGroup`, lignes avec `groupRowId` / `groupLabel`), helper `templateRows`.
- Produces :
  - `renameFloorInTaskName(taskName, oldName, newName) → string`
  - `buildFloorRenameChanges(floor, name) → Map<rowId, fields>` ; `buildFloorRenameActions(floor, name)` renomme aussi les groupes (`Groupe`) et les noms « NIV / GO » (une action `BulkUpdateRecord` de `Taches` en plus, seulement si un nom change)
  - `floorRemovalIds(floor) → number[]` (lignes-étages, groupes, tâches) ; `buildFloorDeleteActions(floor)` s'en sert
  - `validateGroupName(raw) → { ok: true, name } | { ok: false, error }`
  - `buildGroupRenameAction(group, name)`, `groupRemovalIds(group)`, `buildGroupDeleteActions(group)`, `buildGroupDeleteQuestion(group)`
  - `buildNewTask({ …, parentId })` → `task.parentId` ; `buildTaskFields` écrit `Parent` (texte) seulement si `parentId`
  - `containerKeyOf(line)` → `group:<id>` pour une ligne dans un groupe ; `resolveDropTarget(line)` → cible de groupe `{ key: "group:<id>", zoneKey, zoneName, floorKey, floorName, groupRowId, label: "Déplacer dans « <nom> »" }` pour une ligne de groupe ou une tâche d'un groupe (cibles d'étage et de zone inchangées, sans `groupRowId`) ; `buildMoveFields(task, target)` écrit aussi `Parent` (`"<id>"` ou `""`) quand il change

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseGroupRules.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFloorDeleteActions,
  buildFloorRenameActions,
  buildFloorRenameChanges,
  buildGroupDeleteActions,
  buildGroupDeleteQuestion,
  buildGroupRenameAction,
  buildMoveFields,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
  containerKeyOf,
  findGroup,
  floorRemovalIds,
  groupRemovalIds,
  renameFloorInTaskName,
  resolveDropTarget,
  validateGroupName,
} from "../assets/js/services/syntheseTaskModel.js";
import { templateRows } from "./helpers/templateRows.mjs";

const TODAY = new Date(2026, 8, 23); // mercredi
const byNumber = (left, right) => left - right;

function ss1() {
  const sections = buildSections({ rows: templateRows() });
  return { sections, section: sections[0], floor: sections[0].floors[0] };
}

test("nom de l'étage dans les noms des tâches : « NIV » et « GO » suivis du nom exact", () => {
  assert.equal(
    renameFloorInTaskName("FOND DE PLAN DE SYNTHESE NIV Nouvel étage", "Nouvel étage", "SS1"),
    "FOND DE PLAN DE SYNTHESE NIV SS1"
  );
  assert.equal(
    renameFloorInTaskName("DEMARRAGE GO Nouvel étage (date prévisionnelle)", "Nouvel étage", "SS1"),
    "DEMARRAGE GO SS1 (date prévisionnelle)"
  );
  assert.equal(renameFloorInTaskName("VISA Indice 0", "SS1", "SS2"), "VISA Indice 0");
  assert.equal(renameFloorInTaskName("PLAN NIV SS10", "SS1", "SS2"), "PLAN NIV SS10", "nom exact seulement");
  assert.equal(renameFloorInTaskName("PLAN NIV R+1", "R+1", "R+2"), "PLAN NIV R+2", "caractères spéciaux");
  assert.equal(renameFloorInTaskName("PLAN NIV SS1", "", "SS2"), "PLAN NIV SS1");
});

// Review Focus 3 : renommer l'étage juste après sa création.
test("renommer un étage du modèle : Groupe des tâches et des groupes, noms NIV / GO, en une écriture", () => {
  const { floor } = ss1();
  const changes = buildFloorRenameChanges(floor, "SS2");
  assert.equal(changes.size, 26);
  assert.deepEqual(changes.get(201), { Taches: "SS2" });
  assert.deepEqual(changes.get(203), { Groupe: "SS2" });
  assert.deepEqual(changes.get(204), { Groupe: "SS2", Taches: "FOND DE PLAN DE SYNTHESE NIV SS2" });
  assert.deepEqual(changes.get(205), { Groupe: "SS2" });
  assert.deepEqual(changes.get(226), { Groupe: "SS2", Taches: "DEMARRAGE GO SS2 (date prévisionnelle)" });
  const actions = buildFloorRenameActions(floor, "SS2");
  assert.deepEqual(actions[0], ["UpdateRecord", "Planning_Projet", 201, { Taches: "SS2" }]);
  assert.equal(actions[1][0], "BulkUpdateRecord");
  assert.deepEqual([...actions[1][2]].sort(byNumber), Array.from({ length: 25 }, (_, index) => 202 + index));
  assert.ok(actions[1][3].Groupe.every((name) => name === "SS2"));
  assert.equal(actions[2][0], "BulkUpdateRecord");
  assert.deepEqual([...actions[2][2]].sort(byNumber), [204, 208, 213, 214, 215, 221, 222, 223, 226]);
  assert.ok(actions[2][3].Taches.every((name) => name.includes("SS2")));
});

test("supprimer un étage du modèle : ses 26 lignes en une écriture", () => {
  const { floor } = ss1();
  const ids = floorRemovalIds(floor);
  assert.deepEqual([...ids].sort(byNumber), Array.from({ length: 26 }, (_, index) => 201 + index));
  assert.deepEqual(buildFloorDeleteActions(floor), [["BulkRemoveRecord", "Planning_Projet", ids]]);
});

test("groupes : nom obligatoire, renommer, supprimer avec tout leur contenu", () => {
  const { sections } = ss1();
  assert.deepEqual(validateGroupName("  "), { ok: false, error: "Le nom ne peut pas être vide." });
  assert.deepEqual(validateGroupName("x".repeat(201)), { ok: false, error: "Le nom est limité à 200 caractères." });
  assert.deepEqual(validateGroupName(" CYCLE 1 bis "), { ok: true, name: "CYCLE 1 bis" });
  const c2 = findGroup(sections, 210);
  assert.deepEqual(buildGroupRenameAction(c2, "CYCLE 2 bis"), ["UpdateRecord", "Planning_Projet", 210, { Taches: "CYCLE 2 bis" }]);
  assert.equal(buildGroupDeleteQuestion(c2), "Supprimer « CYCLE 2 » et ses 5 tâches ?");
  assert.deepEqual([...groupRemovalIds(c2)].sort(byNumber), [210, 211, 212, 213, 214, 215, 216]);
  assert.deepEqual(buildGroupDeleteActions(c2), [["BulkRemoveRecord", "Planning_Projet", groupRemovalIds(c2)]]);
  assert.deepEqual([...groupRemovalIds(findGroup(sections, 212))].sort(byNumber), [212, 213, 214, 215]);
  assert.equal(buildGroupDeleteQuestion({ name: "VIDE", tasks: [] }), "Supprimer « VIDE » ?");
  assert.equal(buildGroupDeleteQuestion({ name: "UN", tasks: [{ id: 1 }] }), "Supprimer « UN » et sa tâche ?");
});

test("cible d'un dépôt : une ligne de groupe ou une tâche d'un groupe → ce groupe", () => {
  const lines = buildRowModel(ss1().sections);
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const toS2 = {
    key: "group:212",
    zoneKey: "zonez3a",
    zoneName: "Zone Z3A",
    floorKey: "ss1",
    floorName: "SS1",
    groupRowId: 212,
    label: "Déplacer dans « PLAN SYT CYCLE 2 »",
  };
  assert.deepEqual(resolveDropTarget(line("group:212")), toS2);
  assert.deepEqual(resolveDropTarget(line("task:213")), toS2);
  assert.equal(containerKeyOf(line("task:213")), "group:212");
  assert.equal(resolveDropTarget(line("task:202")).key, "floor:zonez3a/ss1");
  assert.equal("groupRowId" in resolveDropTarget(line("task:202")), false);
  assert.equal(containerKeyOf(line("task:202")), "floor:zonez3a/ss1");
});

test("déplacer une tâche : vers un groupe, Parent écrit ; vers l'étage ou la zone, Parent vidé", () => {
  const { section } = ss1();
  const task = (id) => section.tasks.find((candidate) => candidate.id === id);
  const toC1 = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 203 };
  const toFloor = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1" };
  const toZone = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  assert.deepEqual(buildMoveFields(task(202), toC1), { Parent: "203" });
  assert.deepEqual(buildMoveFields(task(213), toFloor), { Parent: "" });
  assert.deepEqual(buildMoveFields(task(204), toC1), {}, "déjà dans ce cycle");
  assert.deepEqual(buildMoveFields(task(213), toZone), { Groupe: "", Parent: "" });
});

test("nouvelle tâche dans un groupe : Parent écrit en texte", () => {
  const created = buildNewTask({ zoneName: "Zone Z3A", groupName: "SS1", groupTasks: [], today: TODAY, parentId: 212 });
  assert.equal(created.parentId, 212);
  assert.deepEqual(buildTaskFields(created, { projectName: "HOTEL DIEU" }), {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-09-23",
    Diff_armature: "2026-09-23",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z3A",
    Groupe: "SS1",
    Parent: "212",
  });
  assert.equal("Parent" in buildTaskFields(buildNewTask({ zoneName: "Z", today: TODAY })), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/syntheseGroupRules.test.mjs`
Expected: FAIL — exports manquants (`renameFloorInTaskName`…).

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js` :

**3a.** `buildNewTask` : ajouter `parentId = null` à la déstructuration :

```js
export function buildNewTask({ zoneName = "", groupName = "", groupTasks = [], today = new Date(), parentId = null } = {}) {
```

puis, dans l'objet rendu, après `isMilestone: false,` :

```js
    parentId: Number.isInteger(parentId) && parentId > 0 ? parentId : null,
```

**3b.** `buildTaskFields` : juste avant `return fields;`, ajouter :

```js
  // Tâche d'un cycle ou d'un sous-groupe : l'id du groupe dans Parent (texte).
  if (task?.parentId) fields[TASK_COLUMNS.parent] = String(task.parentId);
```

**3c.** Remplacer `buildFloorRenameActions` et `buildFloorDeleteActions` (avec leurs commentaires) par :

```js
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Le nom d'un étage dans les noms de ses tâches (« … NIV SS1 », « DEMARRAGE GO SS1 … ») :
// « NIV » ou « GO », puis le nom exact, suivi d'un espace, d'une parenthèse ou de la fin.
export function renameFloorInTaskName(taskName, oldName, newName) {
  const text = toText(taskName);
  const previous = toText(oldName);
  if (!previous) return text;
  const pattern = new RegExp(`\\b(NIV|GO) ${escapeRegExp(previous)}(?=$|[\\s(])`, "g");
  return text.replace(pattern, (_match, prefix) => `${prefix} ${toText(newName)}`);
}

// Renommer un étage, ligne par ligne : ses lignes-étages (nom), ses groupes (Groupe), ses
// tâches (Groupe, et le nom quand il contient « NIV / GO <ancien nom> »).
export function buildFloorRenameChanges(floor, name) {
  const changes = new Map();
  (floor?.rowIds || []).forEach((rowId) => changes.set(rowId, { [TASK_COLUMNS.name]: name }));
  (floor?.groups || []).forEach((group) => changes.set(group.rowId, { [TASK_COLUMNS.group]: name }));
  (floor?.tasks || []).forEach((task) => {
    const fields = { [TASK_COLUMNS.group]: name };
    const current = toText(task.name);
    const renamed = renameFloorInTaskName(current, floor.name, name);
    if (renamed !== current) fields[TASK_COLUMNS.name] = renamed;
    changes.set(task.id, fields);
  });
  return changes;
}

// Les mêmes changements, en une seule écriture Grist.
export function buildFloorRenameActions(floor, name) {
  const actions = [];
  const rowIds = floor?.rowIds || [];
  if (rowIds.length === 1) {
    actions.push(["UpdateRecord", PLANNING_TABLE, rowIds[0], { [TASK_COLUMNS.name]: name }]);
  } else if (rowIds.length > 1) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, [...rowIds], { [TASK_COLUMNS.name]: rowIds.map(() => name) }]);
  }
  const memberIds = [
    ...(floor?.tasks || []).map((task) => task.id),
    ...(floor?.groups || []).map((group) => group.rowId),
  ];
  if (memberIds.length) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, memberIds, { [TASK_COLUMNS.group]: memberIds.map(() => name) }]);
  }
  const renamed = (floor?.tasks || [])
    .map((task) => [task.id, toText(task.name), renameFloorInTaskName(task.name, floor.name, name)])
    .filter(([, current, next]) => next !== current);
  if (renamed.length) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, renamed.map(([id]) => id), {
      [TASK_COLUMNS.name]: renamed.map(([, , next]) => next),
    }]);
  }
  return actions;
}

// Lignes d'un étage à supprimer : ses lignes-étages, ses groupes et toutes ses tâches.
export function floorRemovalIds(floor) {
  return [
    ...(floor?.rowIds || []),
    ...(floor?.groups || []).map((group) => group.rowId),
    ...(floor?.tasks || []).map((task) => task.id),
  ];
}

// Supprimer un étage : toutes ses lignes, en une seule écriture.
export function buildFloorDeleteActions(floor) {
  const ids = floorRemovalIds(floor);
  return ids.length ? [["BulkRemoveRecord", PLANNING_TABLE, ids]] : [];
}
```

**3d.** Juste après `buildFloorDeleteQuestion`, ajouter :

```js
// Nom d'un cycle ou d'un sous-groupe : obligatoire, limité comme un nom de tâche ; les
// doublons sont permis.
export function validateGroupName(rawValue) {
  const name = toText(rawValue);
  if (!name) return refuse("Le nom ne peut pas être vide.");
  if (name.length > MAX_TASK_NAME_LENGTH) return refuse(`Le nom est limité à ${MAX_TASK_NAME_LENGTH} caractères.`);
  return { ok: true, name };
}

export function buildGroupRenameAction(group, name) {
  return ["UpdateRecord", PLANNING_TABLE, group.rowId, { [TASK_COLUMNS.name]: name }];
}

// Lignes d'un groupe à supprimer : la sienne, ses sous-groupes et toutes ses tâches.
export function groupRemovalIds(group) {
  return [
    group.rowId,
    ...(group.groups || []).map((child) => child.rowId),
    ...(group.tasks || []).map((task) => task.id),
  ];
}

export function buildGroupDeleteActions(group) {
  return [["BulkRemoveRecord", PLANNING_TABLE, groupRemovalIds(group)]];
}

export function buildGroupDeleteQuestion(group) {
  const count = (group?.tasks || []).length;
  if (!count) return `Supprimer « ${group.name} » ?`;
  if (count === 1) return `Supprimer « ${group.name} » et sa tâche ?`;
  return `Supprimer « ${group.name} » et ses ${count} tâches ?`;
}
```

**3e.** Remplacer `containerKeyOf`, `resolveDropTarget` et `buildMoveFields` (avec leurs commentaires) par :

```js
// Conteneur d'une ligne de tâche : son groupe, son étage, ou le niveau zone de sa zone (même
// format que la clé de la ligne d'en-tête du conteneur).
export function containerKeyOf(line) {
  if (line?.groupRowId) return `group:${line.groupRowId}`;
  return line?.floorKey ? `floor:${line.zoneKey}/${line.floorKey}` : `zone:${line?.zoneKey ?? ""}`;
}

// Cible d'un dépôt d'après la ligne visée : ligne de groupe ou tâche d'un groupe → ce groupe ;
// ligne d'étage ou tâche directe d'un étage → cet étage ; ligne de zone ou tâche du niveau
// zone → niveau zone de cette zone.
export function resolveDropTarget(line) {
  if (!line || !["zone", "floor", "group", "task"].includes(line.kind)) return null;
  if (line.groupRowId) {
    return {
      key: `group:${line.groupRowId}`,
      zoneKey: line.zoneKey,
      zoneName: line.zoneName,
      floorKey: line.floorKey,
      floorName: line.floorName,
      groupRowId: line.groupRowId,
      label: `Déplacer dans « ${line.groupLabel} »`,
    };
  }
  if (line.kind === "floor" || (line.kind === "task" && line.floorKey)) {
    return {
      key: `floor:${line.zoneKey}/${line.floorKey}`,
      zoneKey: line.zoneKey,
      zoneName: line.zoneName,
      floorKey: line.floorKey,
      floorName: line.floorName,
      label: `Déplacer dans « ${line.floorName} »`,
    };
  }
  return {
    key: `zone:${line.zoneKey}`,
    zoneKey: line.zoneKey,
    zoneName: line.zoneName,
    floorKey: "",
    floorName: "",
    label: `Déplacer au niveau de la zone « ${line.zoneName || NO_ZONE_LABEL} »`,
  };
}

// Colonnes à écrire pour déplacer une tâche vers une cible : seulement ce qui change, rien si
// la cible est son conteneur actuel (dans « Sans zone », la tâche est au niveau zone même si
// son Groupe nomme un étage). Parent suit le groupe visé (vide hors groupe).
export function buildMoveFields(task, target) {
  if (!task || !target) return {};
  const currentFloorKey = task.zoneKey === NO_ZONE_KEY ? "" : task.floorKey;
  const currentGroup = task.groupRowId ?? null;
  const targetGroup = target.groupRowId ?? null;
  if (target.zoneKey === task.zoneKey && target.floorKey === currentFloorKey && targetGroup === currentGroup) return {};
  const fields = {};
  if (target.zoneKey !== task.zoneKey) fields[TASK_COLUMNS.zone] = toText(target.zoneName);
  const group = target.floorKey ? toText(target.floorName) : "";
  if (group !== task.groupName) fields[TASK_COLUMNS.group] = group;
  const parent = targetGroup ? String(targetGroup) : "";
  if (parent !== (task.parentId ? String(task.parentId) : "")) fields[TASK_COLUMNS.parent] = parent;
  return fields;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run : `node --test tests/*.test.mjs`
Expected: tous verts (les tests existants de `syntheseFloorRules.test.mjs` passent sans changement : leurs étages n'ont ni groupes ni noms « NIV / GO »).

- [ ] **Step 5: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 6: Contrôleur — création en deux temps, cascade, groupes

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseTasksController.js`
- Modify: `Planning Projet/tests/syntheseTasksController.test.mjs`

**Interfaces:**
- Consumes : tâches 1 à 5 (`cascadeFrom` ; `buildFloorFromTemplate`, `buildBulkAddAction`, `buildTemplateLinks` ; `detectTemplateColumns`, `dateFieldsOf`, `findGroup`, `groupCollapseKey`, `buildFloorRenameChanges`, `floorRemovalIds`, `validateGroupName`, `buildGroupRenameAction`, `groupRemovalIds`, `buildGroupDeleteActions`, `buildGroupDeleteQuestion`, `buildNewTask({ parentId })`).
- Produces (callbacks passés à `createTable`, utilisés par la tâche 7) :
  - `onAddTask(zoneKey, floorKey = "", groupRowId = null)`
  - `onRenameGroup(groupRowId, rawValue)`, `onDeleteGroup(groupRowId) → Promise`, `onToggleGroup(groupRowId)`
  - `onEdit(taskId, field, rawValue)` accepte aussi `"id2"` et `"indice"`
  - les autres callbacks ne changent pas ; `table.render(lines, { editable, emptyMessage, canAddFloor })` — `canAddFloor` est faux si `Etage` **ou** `Nature` / `Parent` / `Lien` manquent.
- Messages (exacts) :
  - `"Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des étages."`
  - `"L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez."`

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTasksController.test.mjs` :

1. Ajouter en tête, après les imports existants :

```js
import { templateRows } from "./helpers/templateRows.mjs";
```

2. Dans `floorRows()`, ajouter `Nature: "", Parent: "", Lien: ""` à **chacune** des 4 lignes (les colonnes du modèle existent dans ce document).

3. **Supprimer** le test « ajouter un étage : nom par défaut, AddRecord, nom en saisie » (remplacé ci-dessous).

4. Ajouter à la fin du fichier :

```js
// ---------- Modèle d'étage : cycles, liens, cascade ----------

const isoOf = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);
const TEMPLATE_IDS = Array.from({ length: 26 }, (_, index) => 301 + index);

// Zone Z2A avec l'étage SS1 du modèle (ids 201 à 226), sans dates.
function ss1Rows() {
  return templateRows({ zoneName: "Zone Z2A" });
}

// Trois tâches liées de l'étage PH RDB : FOND DE PLAN (daté), DIFFUSION FDS (FD, jalon prévu),
// RECEPTION RENDU (FD, 10 jours prévus).
function linkedRows() {
  const base = { NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "PH RDB", Etage: false, Nature: "", Parent: "" };
  return [
    ...floorRows(),
    { ...base, id: 30, Taches: "FOND DE PLAN", Lien: "", Diff_coffrage: "2026-01-02", Diff_armature: "2026-01-05", Duree_1: 2 },
    { ...base, id: 31, Taches: "DIFFUSION FDS", Lien: "30 FD", Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { ...base, id: 32, Taches: "RECEPTION RENDU", Lien: "31 FD", Diff_coffrage: null, Diff_armature: null, Duree_1: 10 },
  ];
}

test("ajouter un étage : les 26 lignes du modèle, puis Parent et Lien ; nom de l'étage en saisie", async () => {
  const env = setup({
    rows: floorRows(),
    applyUserActions: (actions) => (actions[0][0] === "BulkAddRecord" ? { retValues: [TEMPLATE_IDS] } : { retValues: [] }),
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.equal(env.writes[0].length, 1);
  const [add] = env.writes[0];
  assert.equal(add[0], "BulkAddRecord");
  assert.deepEqual(add[2], new Array(26).fill(null));
  assert.equal(add[3].Taches[0], "Nouvel étage");
  assert.equal(add[3].Etage[0], true);
  assert.equal(add[3].Zone[0], "Zone Z2A");
  assert.equal(add[3].Taches[3], "FOND DE PLAN DE SYNTHESE NIV Nouvel étage");
  assert.equal(add[3].Groupe[3], "Nouvel étage");
  const [links] = env.writes[1];
  assert.equal(links[0], "BulkUpdateRecord");
  assert.equal(links[2].length, 21);
  const line = (key) => env.lastRender().lines.find((candidate) => candidate.key === key);
  assert.ok(line(`floor:${Z2A}/nouveletage`));
  assert.deepEqual([line("group:303").kind, line("group:303").level], ["group", 2]);
  assert.equal(line("task:304").level, 3);
  assert.deepEqual(env.table.editing.at(-1), { zoneKey: Z2A, floorKey: "nouveletage" });
});

test("création d'étage : si Parent et Lien ne s'écrivent pas, les lignes créées sont retirées", async () => {
  const env = setup({
    rows: floorRows(),
    applyUserActions: (actions) => {
      if (actions[0][0] === "BulkAddRecord") return { retValues: [TEMPLATE_IDS] };
      if (actions[0][0] === "BulkUpdateRecord") throw new Error("réseau");
      return { retValues: [] };
    },
  });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.deepEqual(env.writes[2], [["BulkRemoveRecord", "Planning_Projet", TEMPLATE_IDS]]);
  assert.deepEqual(env.table.statuses.at(-1), {
    text: "L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez.",
    tone: "error",
  });
  assert.ok(!env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/nouveletage`));
});

test("colonnes Nature, Parent et Lien absentes : « Ajouter un étage » grisé, message", async () => {
  const rows = floorRows().map(({ Nature, Parent, Lien, ...row }) => row);
  const env = setup({ rows });
  await activate(env);
  assert.equal(env.lastRender().options.canAddFloor, false);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.table.statuses.at(-1).text,
    "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des étages."
  );
});

test("cascade : changer la Fin d'une tâche date ses tâches liées, dans la même écriture", async () => {
  const env = setup({ rows: linkedRows() });
  await activate(env);
  env.table.callbacks.onEdit(30, "end", "2026-01-06");
  assert.deepEqual(env.writes[0], [
    ["UpdateRecord", "Planning_Projet", 30, { Diff_coffrage: "2026-01-02", Diff_armature: "2026-01-06", Duree_1: 3 }],
    ["BulkUpdateRecord", "Planning_Projet", [31, 32], {
      Diff_coffrage: ["2026-01-06", "2026-01-07"],
      Diff_armature: ["2026-01-06", "2026-01-20"],
      Duree_1: [0, 10],
    }],
  ]);
  assert.equal(isoOf(env.taskLine(32).start), "2026-01-07");
  assert.equal(env.taskLine(31).isMilestone, true);
});

// Review Focus 4 : une cascade refusée par Grist ne laisse rien à moitié.
test("cascade refusée par Grist : la tâche et ses tâches liées reviennent à l'état lu", async () => {
  const env = setup({ rows: linkedRows(), applyUserActions: () => { throw new Error("réseau"); } });
  await activate(env);
  env.table.callbacks.onEdit(30, "end", "2026-01-06");
  await flush();
  assert.equal(isoOf(env.taskLine(30).end), "2026-01-05");
  assert.equal(env.taskLine(31).start, null);
  assert.equal(env.taskLine(32).start, null);
  assert.equal(env.table.statuses.at(-1).tone, "error");
});

test("N° et Indice : écrits dans ID2 et Indice ; la tâche reste dans la vue", async () => {
  const env = setup({ rows: linkedRows().map((row) => ({ ...row, Service: "Synthese" })) });
  await activate(env);
  env.table.callbacks.onEdit(30, "id2", "1001");
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 30, { ID2: "1001" }]]);
  assert.equal(env.taskLine(30).id2, "1001");
  await flush();
  env.table.callbacks.onEdit(30, "indice", " A ");
  await flush();
  assert.deepEqual(env.writes[1], [["UpdateRecord", "Planning_Projet", 30, { Indice: "A" }]]);
  assert.equal(env.taskLine(30).indice, "A");
});

test("étage du modèle : cycles repliables et renommables", async () => {
  const env = setup({ rows: ss1Rows() });
  await activate(env);
  const keys = () => env.lastRender().lines.map((line) => line.key);
  assert.deepEqual(keys().slice(0, 5), [`zone:${Z2A}`, `floor:${Z2A}/ss1`, "task:202", "group:203", "task:204"]);
  env.table.callbacks.onToggleGroup(203);
  assert.ok(!keys().includes("task:204"));
  env.table.callbacks.onToggleGroup(203);
  assert.ok(keys().includes("task:204"));
  env.table.callbacks.onRenameGroup(203, " CYCLE 1 bis ");
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 203, { Taches: "CYCLE 1 bis" }]]);
  assert.equal(env.lastRender().lines.find((line) => line.key === "group:203").name, "CYCLE 1 bis");
  env.table.callbacks.onRenameGroup(203, "   ");
  assert.equal(env.table.statuses.at(-1).text, "Le nom ne peut pas être vide.");
});

test("supprimer un cycle : confirmation avec le nombre de tâches, tout son contenu en une écriture", async () => {
  const questions = [];
  const env = setup({ rows: ss1Rows(), confirm: (question) => { questions.push(question); return true; } });
  await activate(env);
  await env.table.callbacks.onDeleteGroup(210);
  assert.deepEqual(questions, ["Supprimer « CYCLE 2 » et ses 5 tâches ?"]);
  assert.equal(env.writes[0][0][0], "BulkRemoveRecord");
  assert.deepEqual([...env.writes[0][0][2]].sort((a, b) => a - b), [210, 211, 212, 213, 214, 215, 216]);
  assert.ok(!env.lastRender().lines.some((line) => line.key === "group:210" || line.key === "task:213"));
});

test("ajouter une tâche dans un sous-groupe : Parent écrit, sous-groupe et cycle dépliés", async () => {
  const env = setup({ rows: ss1Rows(), applyUserActions: () => ({ retValues: [400] }) });
  await activate(env);
  env.table.callbacks.onToggleGroup(210);
  await env.table.callbacks.onAddTask(Z2A, "ss1", 212);
  const [[verb, table, id, fields]] = env.writes[0];
  assert.deepEqual([verb, table, id], ["AddRecord", "Planning_Projet", null]);
  assert.deepEqual([fields.Parent, fields.Groupe, fields.Zone], ["212", "SS1", "Zone Z2A"]);
  const line = env.lastRender().lines.find((candidate) => candidate.key === "task:400");
  assert.deepEqual([line.groupRowId, line.level], [212, 4]);
  assert.deepEqual(env.table.editing.at(-1), { taskId: 400, field: "name" });
});

test("glisser une tâche dans un cycle : Parent écrit, rangée dedans tout de suite", async () => {
  const env = setup({ rows: ss1Rows() });
  await activate(env);
  env.table.callbacks.onMoveTask(202, {
    key: "group:203", zoneKey: Z2A, zoneName: "Zone Z2A", floorKey: "ss1", floorName: "SS1", groupRowId: 203,
  });
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 202, { Parent: "203" }]]);
  const line = env.lastRender().lines.find((candidate) => candidate.key === "task:202");
  assert.deepEqual([line.groupRowId, line.level], [203, 3]);
});

// Review Focus 3 : renommer l'étage juste après sa création.
test("renommer l'étage du modèle : noms NIV / GO et cycles suivent, en une écriture", async () => {
  const env = setup({ rows: ss1Rows() });
  await activate(env);
  env.table.callbacks.onRenameFloor(Z2A, "ss1", "SS2");
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].length, 3);
  const line = (key) => env.lastRender().lines.find((candidate) => candidate.key === key);
  assert.ok(line(`floor:${Z2A}/ss2`));
  assert.equal(line("task:204").name, "FOND DE PLAN DE SYNTHESE NIV SS2");
  assert.equal(line("group:203").floorKey, "ss2");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run : `node --test tests/syntheseTasksController.test.mjs`
Expected: FAIL — la création d'étage écrit encore un `AddRecord`, pas de `onToggleGroup`…

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/ui/syntheseTasksController.js` :

**3a.** Remplacer le bloc d'imports par :

```js
import {
  NO_ZONE_KEY,
  PLANNING_TABLE,
  TASK_COLUMNS,
  applyTaskEdit,
  buildFloorDeleteActions,
  buildFloorDeleteQuestion,
  buildFloorRenameActions,
  buildFloorRenameChanges,
  buildGroupDeleteActions,
  buildGroupDeleteQuestion,
  buildGroupRenameAction,
  buildMoveFields,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
  dateFieldsOf,
  detectFloorColumn,
  detectTemplateColumns,
  findGroup,
  floorCollapseKey,
  floorKeyOf,
  floorRemovalIds,
  groupCollapseKey,
  groupRemovalIds,
  nextFloorName,
  validateFloorName,
  validateGroupName,
} from "../services/syntheseTaskModel.js";
import {
  buildBulkAddAction,
  buildFloorFromTemplate,
  buildTemplateLinks,
} from "../services/syntheseFloorTemplate.js";
import { cascadeFrom } from "../services/syntheseLinks.js";
```

**3b.** Après `const SAVING_DELAY_MS = 1000;`, ajouter :

```js
// Saisies qui changent les dates : les tâches liées en aval suivent.
const DATE_FIELDS = new Set(["start", "end", "duration"]);
```

et ajouter dans `MESSAGES`, après `noFloorColumn` :

```js
  noTemplateColumns: "Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des étages.",
  templateFailed: "L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez.",
```

**3c.** Dans `describeWriteError`, juste après la ligne `if (/\bEtage\b/.test(message)) return MESSAGES.noFloorColumn;`, ajouter :

```js
  // Colonnes du modèle d'étage inconnues de Grist.
  if (/\b(Nature|Parent|Lien)\b/.test(message)) return MESSAGES.noTemplateColumns;
```

**3d.** Après `function describeWriteError…` (avant `export function createSyntheseTasksController`), ajouter :

```js
// Champs de plusieurs lignes (mêmes colonnes) → colonnes d'un BulkUpdateRecord.
function toColumns(fieldsList) {
  const columns = {};
  fieldsList.forEach((fields, index) => Object.entries(fields).forEach(([name, value]) => {
    if (!columns[name]) columns[name] = new Array(fieldsList.length).fill(null);
    columns[name][index] = value;
  }));
  return columns;
}
```

**3e.** Dans l'état du contrôleur, après `const collapsedFloorKeys = new Set();`, ajouter :

```js
  const collapsedGroupKeys = new Set();
```

et après `let floorColumn = null;` :

```js
  // Colonnes Nature, Parent et Lien (modèle d'étage) : même principe que Etage.
  let templateColumns = null;
```

**3f.** Remplacer l'objet passé à `createTable(...)` par :

```js
  const table = createTable({
    onEdit: (taskId, field, rawValue) => handleEdit(taskId, field, rawValue),
    onRenameFloor: (zoneKey, floorKey, rawValue) => handleRenameFloor(zoneKey, floorKey, rawValue),
    onRenameGroup: (groupRowId, rawValue) => handleRenameGroup(groupRowId, rawValue),
    onAddTask: (zoneKey, floorKey = "", groupRowId = null) => handleAddTask(zoneKey, floorKey, groupRowId),
    onAddFloor: (zoneKey) => handleAddFloor(zoneKey),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onDeleteFloor: (zoneKey, floorKey) => handleDeleteFloor(zoneKey, floorKey),
    onDeleteGroup: (groupRowId) => handleDeleteGroup(groupRowId),
    onMoveTask: (taskId, target) => handleMoveTask(taskId, target),
    onToggleZone: (zoneKey) => toggleZone(zoneKey),
    onToggleFloor: (zoneKey, floorKey) => toggleFloor(zoneKey, floorKey),
    onToggleGroup: (groupRowId) => toggleGroup(groupRowId),
    onLockedAttempt: () => setStatus(lockedMessage(), "error"),
  });
```

**3g.** Dans `render()` :

```js
    const lines = buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys, collapsedGroupKeys });
```

et la dernière ligne :

```js
    table.render(lines, {
      editable: isEditable(),
      emptyMessage,
      canAddFloor: floorColumn !== false && templateColumns !== false,
    });
```

**3h.** Dans `load()` : dans le bloc de changement de projet, après `collapsedFloorKeys.clear();` ajouter `collapsedGroupKeys.clear();` et après `floorColumn = null;` ajouter `templateColumns = null;` ; après `floorColumn = detectFloorColumn(rows);` ajouter :

```js
    templateColumns = detectTemplateColumns(rows);
```

**3i.** Après `findTask`, ajouter :

```js
  function allTasks() {
    return sections.flatMap((section) => section.tasks);
  }
```

**3j.** Remplacer `createOp` et, dans `submit`, la ligne `result = await write(op.actions);` :

```js
  // Une opération : ce qu'elle change à l'affichage en attendant Grist (valeurs par ligne,
  // lignes retirées), ses actions Grist — ou `perform`, quand l'écriture se fait en plusieurs
  // temps — et le contexte où elle a été demandée.
  function createOp({ changes = new Map(), removals = [], actions = [], perform = null }) {
    return { changes, removals: new Set(removals), actions, perform, context: captureContext() };
  }
```

```js
        result = op.perform ? await op.perform() : await write(op.actions);
```

**3k.** Remplacer `handleEdit` par :

```js
  // Saisie : affichée tout de suite, enregistrée ensuite en arrière-plan, dans l'ordre. Une
  // date ou une durée changée entraîne les tâches liées en aval, dans la même écriture. Le
  // tableau passe aussitôt à la cellule suivante : rien de ce qui est tapé entre-temps n'est
  // perdu.
  function handleEdit(taskId, field, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId)) return;
    const result = applyTaskEdit(task, field, rawValue, { today: now() });
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (!Object.keys(result.fields).length) {
      render();
      return;
    }
    const changes = new Map([[taskId, result.fields]]);
    const actions = [["UpdateRecord", PLANNING_TABLE, taskId, result.fields]];
    if (DATE_FIELDS.has(field)) {
      const updates = cascadeFrom(result.task, allTasks());
      if (updates.length) {
        const fieldsList = updates.map(dateFieldsOf);
        updates.forEach((update, index) => changes.set(update.id, fieldsList[index]));
        actions.push(["BulkUpdateRecord", PLANNING_TABLE, updates.map((update) => update.id), toColumns(fieldsList)]);
      }
    }
    clearStatus();
    void submit(createOp({ changes, actions }), {
      onFailure: (error, dropped) => fail("Modification de la tâche impossible :", error, dropped),
    });
  }
```

**3l.** Remplacer `handleAddTask` par :

```js
  // Nouvelle tâche dans un conteneur : un groupe (cycle ou sous-groupe), un étage, ou le
  // niveau zone.
  function handleAddTask(zoneKey, floorKey = "", groupRowId = null) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const project = getProject();
    const group = groupRowId ? findGroup(sections, groupRowId) : null;
    if (groupRowId && !group) return Promise.resolve();
    const section = findSection(group ? group.zoneKey : zoneKey);
    const wantedFloorKey = group ? group.floorKey : floorKey;
    const floor = wantedFloorKey ? findFloor(section, wantedFloorKey) : null;
    if (!project || !section || (wantedFloorKey && !floor)) return Promise.resolve();
    const groupTasks = group
      ? group.tasks
      : floor
        ? floor.tasks
        : section.items.filter((item) => item.kind === "task").map((item) => item.task);
    const task = buildNewTask({
      zoneName: section.zoneName,
      groupName: floor ? floor.name : "",
      groupTasks,
      today: now(),
      parentId: group ? group.rowId : null,
    });
    const fields = buildTaskFields(task, { projectName: project.name });
    const where = group ? `« ${group.name} »` : floor ? `l'étage « ${floor.name} »` : `« ${section.label} »`;
    clearStatus();
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(section.zoneKey);
        if (floor) collapsedFloorKeys.delete(floorCollapseKey(section.zoneKey, floor.key));
        for (let container = group; container; container = container.parentGroup) {
          collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
        }
        render();
        if (hasId) table.startEditing(newId, "name");
        info(`Tâche ajoutée dans ${where}.`);
      },
      onFailure: (error, dropped) => fail("Ajout de la tâche impossible :", error, dropped),
    });
  }
```

**3m.** Remplacer `handleAddFloor` par :

```js
  // Nouvel étage d'après le modèle : ses 26 lignes, puis Parent et Lien une fois les ids
  // connus. Si le second temps échoue, les lignes créées sont retirées : rien de bancal ne
  // reste dans Grist.
  function handleAddFloor(zoneKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    if (floorColumn === false) {
      setStatus(MESSAGES.noFloorColumn, "error");
      return Promise.resolve();
    }
    if (templateColumns === false) {
      setStatus(MESSAGES.noTemplateColumns, "error");
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    if (!project || !section || section.zoneKey === NO_ZONE_KEY) return Promise.resolve();
    const name = nextFloorName(section.floors);
    const newRows = buildFloorFromTemplate({ floorName: name, zoneName: section.zoneName, projectName: project.name });
    clearStatus();
    return submit(createOp({
      perform: async () => {
        const added = await write([buildBulkAddAction(newRows)]);
        const ids = Array.isArray(added?.retValues?.[0]) ? added.retValues[0].map(Number) : [];
        try {
          const links = buildTemplateLinks(ids);
          await write([links.action]);
          return { ids, linkFields: links.fieldsById };
        } catch (error) {
          const created = ids.filter((id) => Number.isInteger(id) && id > 0);
          if (created.length) {
            try {
              await write([["BulkRemoveRecord", PLANNING_TABLE, created]]);
            } catch (cleanupError) {
              console.error("Lignes de l'étage incomplet non retirées :", cleanupError);
            }
          }
          const failure = new Error(MESSAGES.templateFailed, { cause: error });
          failure.userMessage = describeWriteError(error) === MESSAGES.noTemplateColumns
            ? MESSAGES.noTemplateColumns
            : MESSAGES.templateFailed;
          throw failure;
        }
      },
    }), {
      onSuccess: ({ ids, linkFields }) => {
        const known = new Set(rows.map((row) => Number(row?.[TASK_COLUMNS.id])));
        const added = newRows
          .map((fields, index) => ({ id: ids[index], ...fields, ...(linkFields.get(ids[index]) || {}) }))
          .filter((row) => !known.has(row.id));
        rows = [...rows, ...added];
        collapsedZoneKeys.delete(zoneKey);
        render();
        table.startEditingFloor(zoneKey, floorKeyOf(name));
        info(`Étage ajouté dans « ${section.label} ».`);
      },
      onFailure: (error, dropped) => {
        const message = describeWriteError(error);
        if (message === MESSAGES.noFloorColumn) floorColumn = false;
        if (message === MESSAGES.noTemplateColumns) templateColumns = false;
        render();
        fail("Ajout de l'étage impossible :", error, dropped);
      },
    });
  }
```

**3n.** Dans `handleRenameFloor`, remplacer les trois lignes qui construisent `changes` (`const changes = new Map();` et les deux `forEach`) par :

```js
    const changes = buildFloorRenameChanges(floor, result.name);
```

**3o.** Dans `handleDeleteFloor`, remplacer `removals: [...floor.rowIds, ...floor.tasks.map((task) => task.id)],` par :

```js
      removals: floorRemovalIds(floor),
```

**3p.** Après `handleDeleteFloor`, ajouter :

```js
  // Renommer un cycle ou un sous-groupe : sa ligne seulement (ses tâches pointent vers son id).
  function handleRenameGroup(groupRowId, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const group = findGroup(sections, groupRowId);
    if (!group) return;
    const result = validateGroupName(rawValue);
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (result.name === group.name) {
      render();
      return;
    }
    clearStatus();
    void submit(createOp({
      changes: new Map([[group.rowId, { [TASK_COLUMNS.name]: result.name }]]),
      actions: [buildGroupRenameAction(group, result.name)],
    }), {
      onFailure: (error, dropped) => fail("Renommage impossible :", error, dropped),
    });
  }

  // Supprimer un cycle ou un sous-groupe : sa ligne et tout son contenu, après confirmation.
  function handleDeleteGroup(groupRowId) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const group = findGroup(sections, groupRowId);
    if (!group) return Promise.resolve();
    if (!confirm(buildGroupDeleteQuestion(group))) return Promise.resolve();
    clearStatus();
    return submit(createOp({ removals: groupRemovalIds(group), actions: buildGroupDeleteActions(group) }), {
      onSuccess: () => info(`« ${group.name} » supprimé.`),
      onFailure: (error, dropped) => fail("Suppression impossible :", error, dropped),
    });
  }
```

**3q.** Dans `handleMoveTask`, après la ligne `if (target.floorKey) collapsedFloorKeys.delete(…);`, ajouter :

```js
    for (let container = findGroup(sections, target.groupRowId); container; container = container.parentGroup) {
      collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
    }
```

**3r.** Après `toggleFloor`, ajouter :

```js
  function toggleGroup(groupRowId) {
    const key = groupCollapseKey(groupRowId);
    if (collapsedGroupKeys.has(key)) collapsedGroupKeys.delete(key);
    else collapsedGroupKeys.add(key);
    render();
  }
```

**3s.** Retirer `buildFloorFields` des imports s'il n'est plus utilisé dans le fichier.

- [ ] **Step 4: Run tests to verify they pass**

Run : `node --test tests/*.test.mjs`
Expected: tous verts.

- [ ] **Step 5: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 7: Tableau — colonnes N° / Indice, lignes de groupe, couleurs

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseTaskTable.js`
- Modify: `Planning Projet/assets/css/styles.css` (section `.stt`, l. ~2613-2780)
- Modify: `Planning Projet/tests/syntheseTaskTable.test.mjs`

**Interfaces:**
- Consumes : lignes de la tâche 4 (`kind: "group"`, `groupRowId`, `groupLabel`, `nature`, `id2`, `indice`, `level`) ; callbacks de la tâche 6 (`onRenameGroup`, `onDeleteGroup`, `onToggleGroup`, `onAddTask(zoneKey, floorKey, groupRowId)`).
- Produces : `buildMenuItems(line, { canAddFloor })` gère les lignes de groupe ; l'API rendue devient `{ render, startEditing, startEditingFloor, setStatus, startEditingGroup }`.

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTaskTable.test.mjs` :

1. Dans le test « styles des étages, de la poignée… », remplacer `assert.match(css, /--stt-floor-bg:\s*#c6e0b4;/);` par :

```js
  assert.match(css, /--stt-floor-bg:\s*#fce4d6;/);
```

2. Ajouter à la fin du fichier :

```js
test("menu : cycle, sous-groupe et tâche d'un groupe", () => {
  const cycle = { kind: "group", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, nature: "cycle" };
  assert.deepEqual(buildMenuItems(cycle), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203 },
    { label: "Supprimer le cycle", action: "deleteGroup", groupRowId: 203, danger: true },
  ]);
  assert.equal(buildMenuItems({ ...cycle, nature: "sous-groupe", groupRowId: 212 })[1].label, "Supprimer le sous-groupe");
  assert.deepEqual(
    buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, taskId: 204 })[0],
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203 }
  );
});

test("colonnes N° et Indice ; lignes de groupe : saisie du nom, repli, suppression", () => {
  assert.match(source, /\{ field: "id2", label: "N°" \}/);
  assert.match(source, /\{ field: "indice", label: "Indice" \}/);
  assert.match(source, /function startEditingGroup\(groupRowId\)/);
  assert.match(source, /await onRenameGroup\?\.\(target\.groupRowId, value\)/);
  assert.match(source, /\{ type: "toggleGroup", groupRowId: Number\(groupRowId\) \}/);
  assert.match(source, /onDeleteGroup\?\.\(item\.groupRowId\)/);
  assert.match(source, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null\)/);
  assert.match(source, /setStatus,\s*startEditingGroup,/);
  assert.match(source, /input\.maxLength = 50;/);
});

test("styles : couleurs de la capture, colonnes N° et Indice, retraits par niveau", () => {
  assert.match(css, /--stt-cycle-bg:\s*#bfbfbf;/);
  assert.match(css, /--stt-meeting-bg:\s*#bdd7ee;/);
  assert.match(css, /--stt-kickoff-bg:\s*#e6b8b7;/);
  assert.match(css, /--stt-col-code:\s*56px;/);
  assert.match(css, /\.stt-left\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--stt-col-code\) var\(--stt-col-code\) var\(--stt-col-duration\) var\(--stt-col-date\) var\(--stt-col-date\);/);
  assert.match(css, /\.stt-line--floor \.stt-left\s*\{[^}]*background:\s*var\(--stt-floor-bg\);/);
  assert.match(css, /\.stt-line--group\.is-nature-cycle \.stt-left\s*\{[^}]*background:\s*var\(--stt-cycle-bg\);/);
  assert.match(css, /\.stt-line--task\.is-nature-reunion \.stt-left\s*\{[^}]*background:\s*var\(--stt-meeting-bg\);/);
  assert.match(css, /\.stt-line--task\.is-nature-demarrage \.stt-left\s*\{[^}]*background:\s*var\(--stt-kickoff-bg\);/);
  assert.match(css, /\.stt-line--group\.is-level-3 \.stt-cell--name\s*\{[^}]*padding-left:\s*48px;/);
  assert.match(css, /\.stt-line--task\.is-level-4 \.stt-cell--name\s*\{[^}]*padding-left:\s*78px;/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run : `node --test tests/syntheseTaskTable.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement — `syntheseTaskTable.js`**

**3a.** Remplacer `DEFAULT_LEFT_WIDTH` et `COLUMNS` :

```js
const DEFAULT_LEFT_WIDTH = 740;
```

```js
const COLUMNS = Object.freeze([
  { field: "name", label: "Nom de la tâche" },
  { field: "id2", label: "N°" },
  { field: "indice", label: "Indice" },
  { field: "duration", label: "Durée" },
  { field: "start", label: "Début" },
  { field: "end", label: "Fin" },
]);
const EDITABLE_FIELDS = COLUMNS.map((column) => column.field);
const CODE_FIELDS = new Set(["id2", "indice"]);
// Lignes récapitulatives : triangle de repli, Durée / Début / Fin calculés.
const SUMMARY_KINDS = new Set(["zone", "floor", "group"]);
// Actions qui ouvrent une saisie.
const EDIT_ACTIONS = new Set(["edit", "editFloor", "editGroup"]);
```

**3b.** Remplacer `buildMenuItems` (et son commentaire) par :

```js
// Entrées du menu contextuel selon la ligne visée : zone (sauf « Sans zone ») → tâche ou
// étage ; « Sans zone » → tâche ; étage → tâche dans l'étage ou suppression de l'étage ;
// cycle / sous-groupe → tâche dans le groupe ou suppression du groupe ; tâche → tâche dans
// le même conteneur ou suppression de la tâche.
export function buildMenuItems(line, { canAddFloor = true } = {}) {
  if (!line) return [];
  if (line.kind === "zone") {
    const items = [{ label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: "" }];
    if (line.zoneKey) {
      items.push({ label: "Ajouter un étage", action: "addFloor", zoneKey: line.zoneKey, disabled: !canAddFloor });
    }
    return items;
  }
  if (line.kind === "floor") {
    return [
      { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey },
      { label: "Supprimer l'étage", action: "deleteFloor", zoneKey: line.zoneKey, floorKey: line.floorKey, danger: true },
    ];
  }
  if (line.kind === "group") {
    return [
      { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey, groupRowId: line.groupRowId },
      {
        label: line.nature === "cycle" ? "Supprimer le cycle" : "Supprimer le sous-groupe",
        action: "deleteGroup",
        groupRowId: line.groupRowId,
        danger: true,
      },
    ];
  }
  if (line.kind === "task") {
    const addTask = { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey || "" };
    if (line.groupRowId) addTask.groupRowId = line.groupRowId;
    return [addTask, { label: "Supprimer la tâche", action: "deleteTask", taskId: line.taskId, danger: true }];
  }
  return [];
}
```

**3c.** Remplacer `formatCellValue` par :

```js
// Une ligne récapitulative sans tâche datée n'a pas de récapitulatif : cellules vides. Une
// tâche sans dates affiche « — » (et sa durée prévue). N° et Indice : tâches seulement.
function formatCellValue(line, field) {
  if (CODE_FIELDS.has(field)) return line.kind === "task" ? (line[field] || "") : "";
  if (SUMMARY_KINDS.has(line.kind) && line.durationDays == null) return "";
  if (field === "duration") return formatDuration(line.durationDays);
  if (field === "start") return formatDate(line.start);
  return formatDate(line.end);
}
```

**3d.** Ajouter `onRenameGroup`, `onDeleteGroup`, `onToggleGroup` aux paramètres de `createSyntheseTaskTable` (après `onRenameFloor`, `onDeleteFloor`, `onToggleFloor` respectivement).

**3e.** Dans `buildNameCell`, remplacer `if (line.kind === "zone" || line.kind === "floor") {` par `if (SUMMARY_KINDS.has(line.kind)) {`.

**3f.** Remplacer `buildLine` par :

```js
  function buildLine(line) {
    const element = createElement("div", `stt-line stt-line--${line.kind} is-level-${line.level}`);
    element.setAttribute("role", "row");
    element.setAttribute("aria-level", String(line.level + 1));
    element.dataset.kind = line.kind;
    element.dataset.lineKey = line.key;
    element.dataset.zoneKey = line.zoneKey;
    element.dataset.floorKey = line.floorKey || "";
    element.dataset.groupRowId = line.groupRowId ? String(line.groupRowId) : "";
    if (SUMMARY_KINDS.has(line.kind)) element.setAttribute("aria-expanded", String(!line.collapsed));
    if (line.kind === "task") element.dataset.taskId = String(line.taskId);
    if (line.kind === "task" && line.floorKey) element.classList.add("is-in-floor");
    // Couleur de la capture : cycle (gris), réunion (bleu), démarrage (rouge).
    if (line.nature) element.classList.add(`is-nature-${line.nature}`);
    if (line.isMilestone) element.classList.add("is-milestone");
    if (line.key === dropTargetKey) element.classList.add("is-drop-target");
    if (line.key === dragSourceKey) element.classList.add("is-drag-source");

    const left = createElement("div", "stt-left");
    COLUMNS.forEach(({ field }) => {
      const cell = field === "name"
        ? buildNameCell(line)
        : createElement("div", `stt-cell stt-cell--${field}`, formatCellValue(line, field));
      if (field !== "name") {
        cell.setAttribute("role", "gridcell");
        cell.dataset.field = field;
      }
      const nameOnly = line.kind === "floor" || line.kind === "group";
      if (editable && (line.kind === "task" || (nameOnly && field === "name"))) {
        cell.classList.add("is-editable");
        cell.tabIndex = 0;
      }
      left.appendChild(cell);
    });
    // Emplacement de la ligne dans le Gantt : même hauteur, même ordre.
    element.append(left, createElement("div", "stt-right"));
    return element;
  }
```

**3g.** Après `findFloorCell`, ajouter :

```js
  function findGroupCell(groupRowId) {
    return body.querySelector(`.stt-line--group[data-group-row-id="${groupRowId}"] .stt-cell--name`);
  }
```

et après `startEditingFloor`, ajouter :

```js
  // Nom d'un cycle ou d'un sous-groupe : même saisie que le nom d'une tâche.
  function startEditingGroup(groupRowId) {
    if (!editable) return;
    if (editor) {
      queuedAction = { type: "editGroup", groupRowId };
      return;
    }
    const line = lines.find((candidate) => candidate.kind === "group" && candidate.groupRowId === groupRowId);
    const cell = findGroupCell(groupRowId);
    if (!line || !cell) return;
    openEditor({ target: { kind: "group", groupRowId }, field: "name", cell, input: createInput("name", line) });
  }
```

**3h.** Dans `createInput` :

- ajouter, avant `} else if (field === "duration") {` :

```js
    } else if (CODE_FIELDS.has(field)) {
      input.type = "text";
      input.maxLength = 50;
      input.autocomplete = "off";
      input.value = line[field] || "";
```

- remplacer l'appel `input.setAttribute("aria-label", …)` par :

```js
    const labels = { floor: "Nom de l'étage", group: "Nom du groupe" };
    input.setAttribute("aria-label", labels[line.kind] || COLUMNS.find((column) => column.field === field).label);
```

**3i.** Dans `openEditor`, remplacer `if (field === "name" || field === "duration") {` par :

```js
    if (field === "name" || field === "duration" || CODE_FIELDS.has(field)) {
```

**3j.** Dans `finishEditing` :

- remplacer les deux lignes d'enregistrement par :

```js
        if (target.kind === "floor") await onRenameFloor?.(target.zoneKey, target.floorKey, value);
        else if (target.kind === "group") await onRenameGroup?.(target.groupRowId, value);
        else await onEdit?.(target.taskId, current.field, value);
```

- remplacer la branche de retour du focus par :

```js
    } else if (refocus || (move && target.kind !== "task")) {
      // Un étage renommé change de clé : on le retrouve sous l'ancienne (refus, même clé) ou
      // sous la nouvelle.
      let cell;
      if (target.kind === "floor") {
        cell = findFloorCell(target.zoneKey, target.floorKey) || findFloorCell(target.zoneKey, floorKeyOf(value));
      } else if (target.kind === "group") {
        cell = findGroupCell(target.groupRowId);
      } else {
        cell = findCell(target.taskId, current.field);
      }
      cell?.focus();
    }
```

**3k.** Dans `runMenuItem`, remplacer la ligne `addTask` et ajouter `deleteGroup` :

```js
    if (item.action === "addTask") return onAddTask?.(item.zoneKey, item.floorKey, item.groupRowId ?? null);
```

```js
    if (item.action === "deleteGroup") return onDeleteGroup?.(item.groupRowId);
```

**3l.** Remplacer `actionAt` et `runAction` par :

```js
  // Action d'un appui, d'un clic ou d'une touche sur une ligne : replier / déplier une zone,
  // un étage ou un groupe, ou ouvrir la saisie d'une cellule de tâche ou d'un nom d'étage ou
  // de groupe.
  function actionAt(target, lineElement) {
    const { kind = "", zoneKey = "", floorKey = "", groupRowId = "" } = lineElement.dataset;
    if (target.closest('[data-action="toggle"]')) {
      if (kind === "group") return { type: "toggleGroup", groupRowId: Number(groupRowId) };
      return kind === "floor" ? { type: "toggleFloor", zoneKey, floorKey } : { type: "toggle", zoneKey };
    }
    const cell = target.closest(".stt-cell[data-field]");
    if (!cell || cell.classList.contains("is-editing")) return null;
    if (kind === "task") return { type: "edit", taskId: Number(lineElement.dataset.taskId), field: cell.dataset.field };
    if (kind === "floor" && cell.dataset.field === "name") return { type: "editFloor", zoneKey, floorKey };
    if (kind === "group" && cell.dataset.field === "name") return { type: "editGroup", groupRowId: Number(groupRowId) };
    return null;
  }

  function runAction(action) {
    if (action.type === "edit") startEditing(action.taskId, action.field);
    else if (action.type === "editFloor") startEditingFloor(action.zoneKey, action.floorKey);
    else if (action.type === "editGroup") startEditingGroup(action.groupRowId);
    else if (action.type === "toggle") onToggleZone?.(action.zoneKey);
    else if (action.type === "toggleFloor") onToggleFloor?.(action.zoneKey, action.floorKey);
    else if (action.type === "toggleGroup") onToggleGroup?.(action.groupRowId);
  }
```

**3m.** Dans l'écouteur `click` du corps, remplacer `if ((action.type === "edit" || action.type === "editFloor") && !editable) {` par :

```js
    if (EDIT_ACTIONS.has(action.type) && !editable) {
```

et dans l'écouteur `keydown`, remplacer `if (action?.type !== "edit" && action?.type !== "editFloor") return;` par :

```js
      if (!EDIT_ACTIONS.has(action?.type)) return;
```

**3n.** Remplacer l'objet rendu à la fin par :

```js
  return {
    render(nextLines, options = {}) {
      renderer.render({ lines: nextLines, options });
    },
    startEditing,
    startEditingFloor,
    setStatus,
    startEditingGroup,
  };
```

- [ ] **Step 4: Implement — `styles.css`**

Dans le bloc `.stt { … }`, remplacer `--stt-left-width: 620px;` par `--stt-left-width: 740px;`, `--stt-floor-bg: #c6e0b4;` par `--stt-floor-bg: #fce4d6;`, et ajouter après `--stt-col-date: 116px;` :

```css
  --stt-col-code: 56px;
  --stt-cycle-bg: #bfbfbf;
  --stt-meeting-bg: #bdd7ee;
  --stt-kickoff-bg: #e6b8b7;
```

Remplacer la règle `grid-template-columns` de `.stt-left` par :

```css
  grid-template-columns: minmax(0, 1fr) var(--stt-col-code) var(--stt-col-code) var(--stt-col-duration) var(--stt-col-date) var(--stt-col-date);
```

Remplacer le commentaire de `.stt-line--floor .stt-toggle:focus-visible` (« lisible sur le vert clair de l'étage ») par « lisible sur l'orange clair de l'étage ». Puis ajouter, **juste après** la règle `.stt-line--task.is-in-floor .stt-cell--name.is-editing { … }` :

```css
/* Couleurs de la capture MS Project, sur toute la partie gauche de la ligne : étage (orange
   clair), cycle (gris), réunion (bleu), démarrage GO (rouge). */
.stt-line--floor .stt-left {
  background: var(--stt-floor-bg);
}

.stt-line--group.is-nature-cycle .stt-left {
  background: var(--stt-cycle-bg);
}

.stt-line--task.is-nature-reunion .stt-left {
  background: var(--stt-meeting-bg);
}

.stt-line--task.is-nature-demarrage .stt-left {
  background: var(--stt-kickoff-bg);
}

/* Cycles et sous-groupes : en gras, avec triangle de repli, un cran de retrait par niveau. */
.stt-line--group .stt-cell {
  font-weight: 700;
}

.stt-line--group .stt-cell--name {
  gap: 4px;
  padding-left: 32px;
}

.stt-line--group.is-level-3 .stt-cell--name {
  padding-left: 48px;
}

.stt-line--group .stt-toggle:focus-visible {
  outline-color: var(--stt-accent);
}

/* Tâches d'un cycle (niveau 3) et d'un sous-groupe (niveau 4). */
.stt-line--task.is-level-3 .stt-cell--name {
  padding-left: 62px;
}

.stt-line--task.is-level-4 .stt-cell--name {
  padding-left: 78px;
}

.stt-line--group .stt-cell--name.is-editing,
.stt-line--task.is-level-3 .stt-cell--name.is-editing,
.stt-line--task.is-level-4 .stt-cell--name.is-editing {
  padding-left: 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run : `node --test tests/*.test.mjs`
Expected: tous verts. Si un test existant fixe la largeur par défaut à 620 px, la passer à 740.

- [ ] **Step 6: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 8: Gantt — crochets des groupes, flèches des liens

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseGanttGeometry.js` (`buildGanttShapes`, `buildGanttLinks` et ses voisins)
- Modify: `Planning Projet/assets/js/ui/syntheseGantt.js` (`drawLink`)
- Test: `Planning Projet/tests/syntheseGanttLinks.test.mjs` (nouveau), `Planning Projet/tests/syntheseGantt.test.mjs`

**Interfaces:**
- Consumes : lignes de la tâche 4 (`kind: "group"`, `groupRowId`, `link`, `taskId`).
- Produces : `buildGanttShapes` rend un `floorBracket` pour une ligne de groupe ; `buildGanttLinks` rend des flèches `{ fromRow, toRow, points, head: { x, y, direction: "down"|"up"|"right"|"left" } }` d'après les liens, et les flèches dessinées d'avant seulement dans un conteneur sans aucun lien ; `drawLink` dessine les quatre pointes.

- [ ] **Step 1: Write the failing tests**

Créer `Planning Projet/tests/syntheseGanttLinks.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import { buildGanttLinks, buildGanttShapes, createTimeScale } from "../assets/js/services/syntheseGanttGeometry.js";

// Janvier 2026 sur 310 px : 10 px par jour, le 1er janvier à x = 0.
const scale = createTimeScale({ start: new Date(2026, 0, 1), end: new Date(2026, 1, 1), width: 310 });
const day = (date) => new Date(2026, 0, date);
const task = (taskId, start, end, extra = {}) => ({
  kind: "task", taskId, zoneKey: "z", floorKey: "f", groupRowId: 9, start, end, isMilestone: false, link: null, ...extra,
});
const rows = (links) => links.map((link) => [link.fromRow, link.toRow]);

test("lien FD : du prédécesseur, plusieurs lignes plus haut, jusqu'au début du successeur", () => {
  const lines = [
    task(1, day(5), day(6)),
    task(2, day(7), day(7), { link: { predId: 99, type: "FD", lag: 0 } }),
    task(3, day(7), day(8), { link: { predId: 1, type: "FD", lag: 0 } }),
  ];
  const links = buildGanttLinks(lines, scale);
  assert.deepEqual(rows(links), [[0, 2]], "lien vers une tâche absente : pas de flèche");
  assert.deepEqual(links[0].points, [[60, 13], [60, 13], [60, 58]]);
  assert.deepEqual(links[0].head, { x: 60, y: 58, direction: "down" });
});

test("lien DD : du début du prédécesseur (pointe gauche d'un jalon) au début du successeur", () => {
  const lines = [
    task(1, day(5), day(5), { isMilestone: true }),
    task(2, day(5), day(6), { link: { predId: 1, type: "DD", lag: 0 } }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[39, 13], [33, 13], [33, 39], [40, 39]]);
  assert.deepEqual(link.head, { x: 40, y: 39, direction: "right" });
});

test("lien FF : de la fin du prédécesseur à la fin du successeur, pointe vers la gauche", () => {
  const lines = [
    task(1, day(5), day(9)),
    task(2, day(8), day(9), { link: { predId: 1, type: "FF", lag: 0 } }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[90, 13], [96, 13], [96, 39], [90, 39]]);
  assert.deepEqual(link.head, { x: 90, y: 39, direction: "left" });
});

test("prédécesseur sous son successeur : flèche vers le haut", () => {
  const lines = [
    task(2, day(12), day(13), { link: { predId: 1, type: "FD", lag: 0 } }),
    task(1, day(5), day(6)),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(rows([link]), [[1, 0]]);
  assert.deepEqual(link.head, { x: 110, y: 20, direction: "up" });
});

test("conteneur avec des liens : plus de flèches dessinées entre voisines ; sans lien : comme avant", () => {
  const linked = [
    task(1, day(5), day(6)),
    task(2, day(12), day(13)),
    task(3, day(14), day(15), { link: { predId: 1, type: "FD", lag: 0 } }),
  ];
  assert.deepEqual(rows(buildGanttLinks(linked, scale)), [[0, 2]]);
  const plain = [task(1, day(5), day(6), { groupRowId: null }), task(2, day(12), day(13), { groupRowId: null })];
  assert.deepEqual(rows(buildGanttLinks(plain, scale)), [[0, 1]]);
  const otherGroups = [task(1, day(5), day(6), { groupRowId: 9 }), task(2, day(12), day(13), { groupRowId: 10 })];
  assert.deepEqual(rows(buildGanttLinks(otherGroups, scale)), [], "deux groupes différents");
});

test("cycle et sous-groupe : crochet comme un étage", () => {
  const group = {
    kind: "group", key: "group:203", name: "CYCLE 1", start: day(5), end: day(9), startsWithMilestone: false, endsWithMilestone: false,
  };
  const [shape] = buildGanttShapes([group], scale);
  assert.deepEqual([shape.type, shape.x1, shape.x2, shape.label], ["floorBracket", 40, 90, "CYCLE 1"]);
});
```

Dans `Planning Projet/tests/syntheseGantt.test.mjs`, ajouter à la fin :

```js
test("pointes des flèches dans les quatre directions", () => {
  for (const direction of ["down", "up", "right", "left"]) {
    assert.match(source, new RegExp(`${direction}: \\(x, y\\) =>`));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run : `node --test tests/syntheseGanttLinks.test.mjs tests/syntheseGantt.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement — géométrie**

Dans `Planning Projet/assets/js/services/syntheseGanttGeometry.js` :

**3a.** Dans `buildGanttShapes`, remplacer le commentaire et la condition `if (line.kind === "zone" || line.kind === "floor") {` par :

```js
    // Zone (barre noire), étage, cycle et sous-groupe (crochet) : du Début à la Fin du
    // récapitulatif, au centre du jour quand il commence ou finit par un jalon.
    if (line.kind === "zone" || line.kind === "floor" || line.kind === "group") {
```

(le `type` reste `line.kind === "zone" ? "zoneBar" : "floorBracket"`).

**3b.** Remplacer `buildGanttLinks` (et son commentaire) par :

```js
// Conteneur d'une tâche pour les flèches dessinées : son groupe, son étage ou le niveau zone.
function containerOf(line) {
  return line.groupRowId ? `group:${line.groupRowId}` : `${line.zoneKey}/${line.floorKey || ""}`;
}

// Fin → début : du bout droit du prédécesseur jusqu'au début du successeur ; pointe vers le
// bas (ou le haut) quand il commence au même x ou après, sinon détour en S, pointe à droite.
function finishToStartLink(from, fromRow, to, toRow, scale, rowHeight) {
  const a = taskSpan(from, scale);
  const b = taskSpan(to, scale);
  const fromY = fromRow * rowHeight + rowHeight / 2;
  const toMiddle = toRow * rowHeight + rowHeight / 2;
  const down = toRow > fromRow;
  if (b.entryX >= a.x2) {
    const edge = down ? toMiddle - b.halfHeight : toMiddle + b.halfHeight;
    return {
      fromRow,
      toRow,
      points: [[a.x2, fromY], [b.entryX, fromY], [b.entryX, edge]],
      head: { x: b.entryX, y: edge, direction: down ? "down" : "up" },
    };
  }
  const between = down ? toRow * rowHeight : (toRow + 1) * rowHeight;
  return {
    fromRow,
    toRow,
    points: [
      [a.x2, fromY],
      [a.x2 + LINK_GAP_PX, fromY],
      [a.x2 + LINK_GAP_PX, between],
      [b.x1 - LINK_GAP_PX, between],
      [b.x1 - LINK_GAP_PX, toMiddle],
      [b.x1, toMiddle],
    ],
    head: { x: b.x1, y: toMiddle, direction: "right" },
  };
}

// Début → début : du bout gauche du prédécesseur, un peu à gauche, puis jusqu'au début du
// successeur, pointe vers la droite.
function startToStartLink(from, fromRow, to, toRow, scale, rowHeight) {
  const a = taskSpan(from, scale);
  const b = taskSpan(to, scale);
  const fromY = fromRow * rowHeight + rowHeight / 2;
  const toMiddle = toRow * rowHeight + rowHeight / 2;
  const elbow = Math.min(a.x1, b.x1) - LINK_GAP_PX;
  return {
    fromRow,
    toRow,
    points: [[a.x1, fromY], [elbow, fromY], [elbow, toMiddle], [b.x1, toMiddle]],
    head: { x: b.x1, y: toMiddle, direction: "right" },
  };
}

// Fin → fin : du bout droit du prédécesseur, un peu à droite, puis jusqu'à la fin du
// successeur, pointe vers la gauche.
function finishToFinishLink(from, fromRow, to, toRow, scale, rowHeight) {
  const a = taskSpan(from, scale);
  const b = taskSpan(to, scale);
  const fromY = fromRow * rowHeight + rowHeight / 2;
  const toMiddle = toRow * rowHeight + rowHeight / 2;
  const elbow = Math.max(a.x2, b.x2) + LINK_GAP_PX;
  return {
    fromRow,
    toRow,
    points: [[a.x2, fromY], [elbow, fromY], [elbow, toMiddle], [b.x2, toMiddle]],
    head: { x: b.x2, y: toMiddle, direction: "left" },
  };
}

const LINK_BUILDERS = Object.freeze({ FD: finishToStartLink, DD: startToStartLink, FF: finishToFinishLink });

// Flèches : une par lien (colonne Lien) entre deux tâches visibles et datées, quel que soit
// l'écart entre leurs lignes. Dans un conteneur où aucune tâche n'a de lien, flèches dessinées
// comme avant : une tâche datée vers la tâche datée juste en dessous, du même conteneur.
export function buildGanttLinks(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const list = lines || [];
  const rowByTaskId = new Map();
  const linkedContainers = new Set();
  list.forEach((line, row) => {
    if (line?.kind !== "task") return;
    rowByTaskId.set(line.taskId, row);
    if (line.link) linkedContainers.add(containerOf(line));
  });
  const links = [];
  list.forEach((line, row) => {
    if (!isDatedTask(line)) return;
    if (line.link) {
      const predRow = rowByTaskId.get(line.link.predId);
      const build = LINK_BUILDERS[line.link.type];
      if (predRow == null || !build || !isDatedTask(list[predRow])) return;
      links.push(build(list[predRow], predRow, line, row, scale, rowHeight));
      return;
    }
    const next = list[row + 1];
    if (!isDatedTask(next) || linkedContainers.has(containerOf(line))) return;
    if (containerOf(line) !== containerOf(next)) return;
    links.push(finishToStartLink(line, row, next, row + 1, scale, rowHeight));
  });
  return links;
}
```

- [ ] **Step 4: Implement — dessin**

Dans `Planning Projet/assets/js/ui/syntheseGantt.js`, après `const LINK_HEAD_PX = 4;`, ajouter :

```js
// Pointe pleine d'une flèche, selon sa direction.
const LINK_HEADS = Object.freeze({
  down: (x, y) => [[x - LINK_HEAD_PX, y - LINK_HEAD_PX], [x + LINK_HEAD_PX, y - LINK_HEAD_PX], [x, y]],
  up: (x, y) => [[x - LINK_HEAD_PX, y + LINK_HEAD_PX], [x + LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]],
  right: (x, y) => [[x - LINK_HEAD_PX, y - LINK_HEAD_PX], [x - LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]],
  left: (x, y) => [[x + LINK_HEAD_PX, y - LINK_HEAD_PX], [x + LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]],
});
```

et remplacer `drawLink` par :

```js
  // Flèche entre deux tâches : trait, puis pointe pleine dans sa direction.
  function drawLink(link) {
    const { x, y, direction } = link.head;
    const head = (LINK_HEADS[direction] || LINK_HEADS.right)(x, y);
    return [
      svgElement("polyline", { class: "stg-link", points: toPoints(link.points) }),
      svgElement("polygon", { class: "stg-link-head", points: toPoints(head) }),
    ];
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run : `node --test tests/*.test.mjs`
Expected: tous verts (les tests existants des flèches passent : sans `link` ni `groupRowId`, le conteneur reste zone + étage et le tracé entre lignes voisines est identique).

- [ ] **Step 6: Checkpoint (pas de commit)**

`node --test tests/*.test.mjs` vert. Ne pas commiter.

---

### Task 9: Protections dans les autres widgets

**Files:**
- Modify: `ListeDePlan/affichage.js` (par script, fins de ligne mélangées)
- Modify: `planning-synchro/assets/js/bottom/documentCharge.js:34-38`
- Modify: `gestion-depenses2/assets/js/utils/planningRealisation.js`, `gestion-depenses2/assets/js/services/projectService.js` (imports l. 17-24, boucle des tâches de planning l. ~516-566)
- Test: `planning-synchro/tests/documentCharge.test.mjs`, `gestion-depenses2/tests/synthesePlanningTask.test.mjs` (nouveau)

**Interfaces:**
- Consumes : rien des tâches précédentes (chaque widget a sa propre copie de la règle : `Service` = Synthese sans accents ni casse, `Type_doc` vide).
- Produces : `isDocumentRow(row, columns)` (planning-synchro) écarte une tâche Synthese ; `isSynthesePlanningTask({ service, typeDoc })` exporté par `gestion-depenses2/assets/js/utils/planningRealisation.js`.

- [ ] **Step 1: Write the failing tests**

Ajouter à la fin de `planning-synchro/tests/documentCharge.test.mjs` :

```js
// Review Focus 5 : une tâche de la vue Synthese de Planning Projet garde son N° sans devenir
// un document à charger.
test("isDocumentRow : une tâche Synthese avec un N° n'est pas un document", () => {
  const cols = { ...COLS, service: "Service" };
  assert.equal(isDocumentRow({ ID2: "2001", Taches: "PLAN", Service: "Synthese" }, cols), false);
  assert.equal(isDocumentRow({ ID2: "2001", Taches: "PLAN", Service: "Synthèse" }, cols), false);
  assert.equal(isDocumentRow({ ID2: "2001", Type_doc: "RESEAUX", Service: "Synthese" }, cols), true);
  assert.equal(isDocumentRow({ ID2: "2001", Service: "Structure" }, cols), true);
  assert.equal(isDocumentRow({ ID2: "2001", Service: "Synthese" }, COLS), false, "colonne Service par défaut");
});
```

Créer `gestion-depenses2/tests/synthesePlanningTask.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computePlanningRealisationValue,
  isSynthesePlanningTask,
} from "../assets/js/utils/planningRealisation.js";

const projectService = await readFile(new URL("../assets/js/services/projectService.js", import.meta.url), "utf8");

// Review Focus 5 : l'Indice d'une tâche Synthese, saisi à la main, ne fait pas « 100 % réalisé ».
test("tâche Synthese : service Synthese sans type de document", () => {
  assert.equal(isSynthesePlanningTask({ service: "Synthese", typeDoc: "" }), true);
  assert.equal(isSynthesePlanningTask({ service: " Synthèse ", typeDoc: null }), true);
  assert.equal(isSynthesePlanningTask({ service: "Synthese", typeDoc: "COFFRAGE" }), false);
  assert.equal(isSynthesePlanningTask({ service: "Structure", typeDoc: "" }), false);
  assert.equal(isSynthesePlanningTask(), false);
  assert.equal(computePlanningRealisationValue("", ""), 0, "Indice ignoré : 0 %, pas 100 %");
});

test("l'avancement des tâches de planning ignore l'Indice d'une tâche Synthese", () => {
  assert.match(
    projectService,
    /isSynthesePlanningTask\(\{ service: row\?\.\[planningColumns\.service\], typeDoc \}\)\s*\?\s*""\s*:\s*toText\(row\?\.\[planningColumns\.indice\]\)/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run : `(cd planning-synchro && node --test tests/documentCharge.test.mjs)` puis `(cd gestion-depenses2 && node --test tests/synthesePlanningTask.test.mjs)`
Expected: FAIL (isDocumentRow rend `true` ; `isSynthesePlanningTask` n'existe pas).

- [ ] **Step 3: Implement — planning-synchro**

Dans `planning-synchro/assets/js/bottom/documentCharge.js`, remplacer `isDocumentRow` (et son commentaire) par :

```js
// Tache de la vue Synthese de Planning Projet (service Synthese, sans type de document) :
// meme avec un N° (ID2), ce n'est pas un document.
function isSynthesePlanningTask(row, columns) {
  const service = toText(row?.[columns?.service ?? "Service"])
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return service === "synthese" && !toText(row?.[columns?.typeDoc]);
}

// Les en-tetes de zone de Planning_Projet n'ont ni ID2 ni Type_doc : elles
// structurent l'affichage et ne representent aucun document.
export function isDocumentRow(row, columns) {
  if (isSynthesePlanningTask(row, columns)) return false;
  return Boolean(toText(row?.[columns?.id2]) || toText(row?.[columns?.typeDoc]));
}
```

- [ ] **Step 4: Implement — gestion-depenses2**

Dans `gestion-depenses2/assets/js/utils/planningRealisation.js`, ajouter juste après `normalizePlanningDocumentType` :

```js
// Tâche de la vue Synthese de Planning Projet (service Synthese, sans type de document) : son
// Indice, saisi à la main, ne dit rien de l'avancement d'un document.
export function isSynthesePlanningTask({ service, typeDoc } = {}) {
  const key = String(service ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return key === "synthese" && !String(typeDoc ?? "").trim();
}
```

Dans `gestion-depenses2/assets/js/services/projectService.js` :

- ajouter `isSynthesePlanningTask,` à la liste importée de `"../utils/planningRealisation.js"` (après `getTargetIndiceForDocumentType,`) ;
- dans la boucle `(planningProjectRows || []).forEach(…)`, remplacer `const indice = toText(row?.[planningColumns.indice]);` par :

```js
      // Une tâche Synthese garde son Indice pour elle : il ne compte pas dans l'avancement.
      const indice = isSynthesePlanningTask({ service: row?.[planningColumns.service], typeDoc })
        ? ""
        : toText(row?.[planningColumns.indice]);
```

- [ ] **Step 5: Implement — ListeDePlan (sans l'outil Edit)**

`ListeDePlan/affichage.js` mélange CRLF et LF : l'outil Edit réécrirait toutes les fins de ligne. Créer à la racine du dépôt `patch-liste-de-plan.mjs` :

```js
// Insère le saut des tâches Synthese dans la synchro des indices, sans toucher aux fins de ligne.
import { readFileSync, writeFileSync } from "node:fs";

const file = "ListeDePlan/affichage.js";
const text = readFileSync(file, "utf8");
const fnStart = text.indexOf("async function syncPlanningProjetIndicesFromListeDePlan() {");
if (fnStart < 0) throw new Error("fonction introuvable");
const loopAt = text.indexOf("if (planningId == null) continue;", fnStart);
if (loopAt < 0) throw new Error("boucle introuvable");
const lineEnd = text.indexOf("\n", loopAt);
const eol = text[lineEnd - 1] === "\r" ? "\r\n" : "\n";
const helper = [
  "// Tâche de la vue Synthese de Planning Projet (service Synthese, sans type de document) :",
  "// son Indice se saisit à la main ; la synchro des indices de ListeDePlan n'y touche pas.",
  "function isSynthesePlanningTask(row) {",
  "  const service = String(row?.Service ?? \"\").normalize(\"NFD\").replace(/\\p{M}/gu, \"\").trim().toLowerCase();",
  "  return service === \"synthese\" && !String(row?.Type_doc ?? \"\").trim();",
  "}",
  "",
  "",
].join(eol);
const skip = `      if (isSynthesePlanningTask(p)) continue;${eol}`;
const patched = text.slice(0, fnStart) + helper + text.slice(fnStart, lineEnd + 1) + skip + text.slice(lineEnd + 1);
writeFileSync(file, patched, "utf8");
```

Run (racine du dépôt) : `node patch-liste-de-plan.mjs && rm patch-liste-de-plan.mjs`

Vérifier :
- `git diff --numstat ListeDePlan/affichage.js` → `8	0	ListeDePlan/affichage.js` (8 lignes ajoutées : 6 pour la fonction, 1 vide, 1 pour le saut ; aucune retirée) ; `git diff -w --numstat` donne la même chose. Sinon : `git checkout -- ListeDePlan/affichage.js` et recommencer.
- `git diff ListeDePlan/affichage.js` montre la fonction `isSynthesePlanningTask` juste avant `async function syncPlanningProjetIndicesFromListeDePlan()` et la ligne `if (isSynthesePlanningTask(p)) continue;` juste après `if (planningId == null) continue;`.
- `grep -n "replace(/\\\\p{M}/gu" ListeDePlan/affichage.js` trouve la ligne : le motif écrit est bien `/\p{M}/gu`.

- [ ] **Step 6: Run tests to verify they pass**

Run :
- `(cd planning-synchro && node --test tests/*.test.mjs)` → 365 verts
- `(cd gestion-depenses2 && node --test tests/*.test.mjs)` → 178 verts
- `(cd ListeDePlan && node --test tests/*.test.cjs)` → verts
- `(cd "Planning Projet" && node --test tests/*.test.mjs)` → verts

- [ ] **Step 7: Checkpoint (pas de commit)**

Ne pas commiter.

---

### Task 10: Versions des scripts et vérification finale

**Files:**
- Modify: `Planning Projet/index.html` (paramètres `?v=`)
- Modify: `Planning Projet/tests/syntheseGanttWiring.test.mjs:45-46`, `Planning Projet/tests/syntheseTasksWiring.test.mjs:47`

- [ ] **Step 1: Update the expected version in the wiring tests**

Dans les deux fichiers de tests, remplacer `20260928-dates1` par `20261005-modele1`.

- [ ] **Step 2: Run tests to verify they fail**

Run : `node --test tests/syntheseGanttWiring.test.mjs tests/syntheseTasksWiring.test.mjs`
Expected: FAIL (index.html porte encore l'ancienne version).

- [ ] **Step 3: Bump the versions**

Dans `Planning Projet/index.html`, remplacer **toutes** les occurrences de `?v=20260928-dates1` par `?v=20261005-modele1` (scripts partagés, `main.js`, `styles.css`) :

Run (depuis `Planning Projet/`) : `sed -i 's/?v=20260928-dates1/?v=20261005-modele1/g' index.html && grep -c "20261005-modele1" index.html`
Expected : le même nombre qu'avant pour l'ancienne version (au moins 5) ; `grep -c 20260928-dates1 index.html` → 0.

- [ ] **Step 4: Run every suite**

Run :
- `(cd "Planning Projet" && node --test tests/*.test.mjs)`
- `(cd planning-synchro && node --test tests/*.test.mjs)`
- `(cd gestion-depenses2 && node --test tests/*.test.mjs)`
- `(cd ListeDePlan && node --test tests/*.test.cjs)`
- `(cd shared && node --test tests/*.test.cjs)`

Expected : tout vert.

- [ ] **Step 5: Checkpoint (pas de commit)**

Ne pas commiter. Pour le test manuel de l'utilisateur sur localhost : **Ctrl+F5** (les sous-modules n'ont pas de `?v=`), service Synthese, clic droit sur une zone → « Ajouter un étage », saisir le Début de « RECEPTION ARCH/TOPO/STR ».
