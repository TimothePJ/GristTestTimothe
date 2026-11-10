# Gantt Synthese — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dessiner dans le panneau droit du tableau de tâches Synthese un diagramme de Gantt SVG façon MS Project (barres noires de zone, losanges des jalons, segments des tâches, échelle des dates), aligné ligne par ligne sur le tableau et piloté par la période du planning.

**Architecture:** Un module de géométrie pur (`syntheseGanttGeometry.js` : date ↔ pixel, formes, graduations, jours non travaillés, glisser / zoom) testé sous Node ; un module de dessin SVG (`syntheseGantt.js`) que le tableau crée par une fabrique injectée et redessine dans sa propre fonction de dessin (même report pendant une saisie) ; `main.js` fournit la période du planning (`getPlanningWindow` / `setPlanningWindow` / `subscribePlanningWindowChanges`).

**Tech Stack:** JavaScript ES modules sans build (widget Grist), SVG, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-25-synthese-gantt-design.md` (prolonge `docs/superpowers/specs/2026-09-23-synthese-taches-design.md`).

## Global Constraints

- **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même. Les étapes « Checkpoint » ne font que vérifier.
- **Fins de ligne :** les fichiers de `Planning Projet/` sont en LF ; ne jamais convertir les fins de ligne d'un fichier existant. Contrôle octet par octet : aucun `\r` ajouté.
- **Pas de séquence `\u` + 4 chiffres hexadécimaux dans les fichiers écrits avec les outils Write/Edit** (l'outil la remplace par le caractère). Écrire directement les caractères (« · », « é », « — »).
- Une journée va de son minuit local au minuit local suivant (heure locale, changements d'heure compris).
- Formes : segment = début du jour de Début → fin du jour de Fin (largeur ≥ 2 px) ; jalon = losange au centre du jour, nom à gauche, date « jj/mm » à droite ; barre de zone = début (centre du jour si la zone commence par un jalon, sinon début du jour) → fin (centre du jour si la zone finit par un jalon, sinon fin du jour), largeur ≥ 2 px, nom à gauche.
- Couleurs : segment `#7cc7d8` contour `#3b9bb0` ; losange `#2f8fa3` ; barre de zone `#1f1f1f` ; étiquettes `#1f1f1f` ; jours non travaillés `#f1f1f1` (seulement si une journée fait au moins 6 px) ; aujourd'hui `#d92d20`.
- Échelle : < 14,5 jours → semaines « sept. 2026 · S38 » / jours « lun 14 » ; < 104,6 jours → mois « septembre 2026 » / jours « 14 » (si ≥ 18 px par jour) sinon semaines « S38 » ; au-delà → années « 2026 » / mois « sept. ».
- Zoom : facteur 1,25, étendue bornée entre 2 jours et 3650 jours. Glisser : la date saisie reste sous le curseur.
- Le Gantt est en lecture seule ; hauteur de ligne 26 px (`--stt-row-height`).
- Commandes de test, depuis la racine du dépôt : `node --test "Planning Projet/tests/"*.test.mjs` et `node --test shared/tests/*.cjs`.

## Review Focus

1. **Passage à l'heure d'hiver (25/10/2026)** : une journée de 25 h reste une journée complète — bandes et segments calés sur les minuits locaux. → test Task 2.
2. **Panneau de largeur nulle** (service changé, fenêtre très étroite) : aucune coordonnée invalide, rien dessiné. → test Task 2.
3. **Période du planning indisponible** (planning pas encore prêt) : la semaine en cours. → test Task 3.
4. **Molette répétée jusqu'aux limites** : étendue bornée à 2 jours et 10 ans. → test Task 3.
5. **Zone repliée** (ses tâches absentes du modèle de lignes) : sa barre reste, sur sa ligne. → test Task 2.

---

## Fichiers

| Fichier | Action | Rôle |
|---|---|---|
| `Planning Projet/assets/js/services/syntheseTaskModel.js` | Modifier | Indicateurs `startsWithMilestone` / `endsWithMilestone` |
| `Planning Projet/assets/js/services/syntheseGanttGeometry.js` | Créer | Géométrie pure du Gantt |
| `Planning Projet/assets/js/ui/syntheseGantt.js` | Créer | Dessin SVG, glisser, zoom |
| `Planning Projet/assets/js/ui/syntheseTaskTable.js` | Modifier | Crée la couche du Gantt, la redessine avec ses lignes |
| `Planning Projet/assets/js/main.js` | Modifier | Fournit la période du planning au Gantt |
| `Planning Projet/assets/css/styles.css` | Modifier | Styles du Gantt |
| `Planning Projet/index.html` | Modifier | Versions des scripts et de la feuille de style |
| `Planning Projet/tests/syntheseTaskZoneAnchors.test.mjs` | Créer | Tests Task 1 |
| `Planning Projet/tests/syntheseGanttGeometry.test.mjs` | Créer | Tests Task 2 |
| `Planning Projet/tests/syntheseGanttScale.test.mjs` | Créer | Tests Task 3 |
| `Planning Projet/tests/syntheseGantt.test.mjs` | Créer | Tests Task 4 |
| `Planning Projet/tests/syntheseGanttWiring.test.mjs` | Créer | Tests Task 5 |
| `Planning Projet/tests/syntheseTasksWiring.test.mjs` | Modifier | Suit le nouveau branchement (Task 5) |

---

### Task 1: Modèle — la zone indique si elle commence ou finit par un jalon

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (fonctions `summarizeTasks` et `buildRowModel`)
- Test: `Planning Projet/tests/syntheseTaskZoneAnchors.test.mjs`

**Interfaces:**
- Consumes (existant) : `summarizeTasks(tasks)`, `buildSections({ rows })`, `buildRowModel(sections, { collapsedZoneKeys })`, `readTask(row)`.
- Produces : `summarizeTasks(tasks)` renvoie en plus `startsWithMilestone: boolean` (tous les éléments datés qui commencent le premier jour de la zone sont des jalons) et `endsWithMilestone: boolean` (l'instant de fin le plus tardif est un jalon, règle MS Project déjà utilisée pour la durée) ; chaque `Row` du modèle de lignes porte `startsWithMilestone` et `endsWithMilestone` (`false` pour les tâches et pour une zone sans dates).

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseTaskZoneAnchors.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowModel,
  buildSections,
  readTask,
  summarizeTasks,
} from "../assets/js/services/syntheseTaskModel.js";

function task(id, name, start, end, duration) {
  return readTask({
    id,
    Taches: name,
    Type_doc: "",
    ID2: "",
    Zone: "Z",
    Diff_coffrage: start,
    Diff_armature: end,
    Duree_1: duration,
  });
}

test("une zone qui commence et finit par un jalon le signale", () => {
  const summary = summarizeTasks([
    task(1, "FOND DE PLAN", "2026-09-14", "2026-09-14", 0),
    task(2, "Plans avant synthèse", "2026-09-15", "2026-10-08", 18),
    task(3, "Démarrage", "2027-02-22", "2027-02-22", 0),
  ]);
  assert.equal(summary.startsWithMilestone, true);
  assert.equal(summary.endsWithMilestone, true);
});

test("un segment qui commence le même jour que le jalon l'emporte", () => {
  const summary = summarizeTasks([
    task(1, "Jalon", "2026-09-14", "2026-09-14", 0),
    task(2, "Segment", "2026-09-14", "2026-09-18", 5),
  ]);
  assert.equal(summary.startsWithMilestone, false);
  assert.equal(summary.endsWithMilestone, false);
});

test("une tâche qui finit le jour du dernier jalon l'emporte", () => {
  const summary = summarizeTasks([
    task(1, "Segment", "2026-09-21", "2026-09-25", 5),
    task(2, "Jalon", "2026-09-25", "2026-09-25", 0),
  ]);
  assert.equal(summary.endsWithMilestone, false);
});

test("le modèle de lignes porte les indicateurs sur la ligne de zone seulement", () => {
  const rows = [
    { id: 1, Taches: "Jalon", Type_doc: "", ID2: "", Zone: "Z", Diff_coffrage: "2026-09-14", Diff_armature: "2026-09-14", Duree_1: 0 },
    { id: 2, Taches: "Segment", Type_doc: "", ID2: "", Zone: "Z", Diff_coffrage: "2026-09-15", Diff_armature: "2026-09-18", Duree_1: 4 },
  ];
  const [zone, first, second] = buildRowModel(buildSections({ rows }));
  assert.equal(zone.startsWithMilestone, true);
  assert.equal(zone.endsWithMilestone, false);
  assert.equal(first.startsWithMilestone, false);
  assert.equal(second.endsWithMilestone, false);
});

test("zone sans dates : indicateurs faux", () => {
  const [zone] = buildRowModel(buildSections({
    rows: [{ id: 3, Taches: "", Type_doc: "", ID2: "", Zone: "Vide" }],
  }));
  assert.equal(zone.startsWithMilestone, false);
  assert.equal(zone.endsWithMilestone, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseTaskZoneAnchors.test.mjs"`
Expected: FAIL — `summary.startsWithMilestone` vaut `undefined` au lieu de `true`.

- [ ] **Step 3: Write minimal implementation**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js`, dans `summarizeTasks`, remplacer :

```js
  const counted = countWorkingDays(start, last.end) -
    (last.endsAtDayStart && isWorkingDay(last.end) ? 1 : 0);
  return { start, end: last.end, durationDays: Math.max(0, counted) };
}
```

par :

```js
  const counted = countWorkingDays(start, last.end) -
    (last.endsAtDayStart && isWorkingDay(last.end) ? 1 : 0);
  // Le Gantt fait partir (ou s'arrêter) la barre de zone au centre du losange quand la
  // zone commence (ou finit) par un jalon.
  const startsWithMilestone = dated
    .filter((task) => isSameDay(task.start, start))
    .every((task) => task.isMilestone);
  return {
    start,
    end: last.end,
    durationDays: Math.max(0, counted),
    startsWithMilestone,
    endsWithMilestone: last.endsAtDayStart,
  };
}
```

Puis, dans `buildRowModel`, remplacer dans l'objet de la ligne de zone :

```js
      isMilestone: false,
      collapsed,
      childCount: section.tasks.length,
```

par :

```js
      isMilestone: false,
      startsWithMilestone: Boolean(section.summary?.startsWithMilestone),
      endsWithMilestone: Boolean(section.summary?.endsWithMilestone),
      collapsed,
      childCount: section.tasks.length,
```

et dans l'objet de la ligne de tâche :

```js
        isMilestone: task.isMilestone,
        collapsed: false,
        childCount: 0,
```

par :

```js
        isMilestone: task.isMilestone,
        startsWithMilestone: false,
        endsWithMilestone: false,
        collapsed: false,
        childCount: 0,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseTaskZoneAnchors.test.mjs" "Planning Projet/tests/syntheseTaskSections.test.mjs"`
Expected: PASS (5 + 7 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node -e 'const s=require("fs").readFileSync("Planning Projet/assets/js/services/syntheseTaskModel.js","utf8");console.log("CR:",(s.match(/\r/g)||[]).length)'`
Expected: toutes les suites PASS, puis `CR: 0`.

---

### Task 2: Géométrie — échelle, formes, jours non travaillés, aujourd'hui

**Files:**
- Create: `Planning Projet/assets/js/services/syntheseGanttGeometry.js`
- Test: `Planning Projet/tests/syntheseGanttGeometry.test.mjs`

**Interfaces:**
- Consumes (existant) : `isWorkingDay(date)` de `services/syntheseTasks.js`, `isFrenchHoliday(date)` de `utils/frenchHolidays.js`. Les lignes reçues suivent le contrat `Row` du modèle de lignes : `{ key, kind: "zone"|"task", name, start: Date|null, end: Date|null, isMilestone, startsWithMilestone, endsWithMilestone }` (Task 1).
- Produces :
  - constantes `DAY_MS`, `ROW_HEIGHT_PX` (26), `MIN_BAR_WIDTH_PX` (2), `MIN_PX_PER_DAY_FOR_OFF_DAYS` (6) ;
  - `dayStart(date) → ms`, `dayEnd(date) → ms`, `dayCenter(date) → ms` ;
  - `createTimeScale({ start, end, width }) → { start: ms, end: ms, width, pxPerDay, dateToX(date|ms) → number, xToDate(x) → Date }` ;
  - `buildGanttShapes(lines, scale, { rowHeight }) → Shape[]` avec `Shape = { type: "zoneBar"|"taskBar", row, key, y, x1, x2, label }` ou `{ type: "milestone", row, key, y, x, label, dateLabel }` ;
  - `buildNonWorkingBands(scale) → { x1, x2, holiday }[]` ;
  - `todayX(scale, now) → number | null`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseGanttGeometry.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DAY_MS,
  buildGanttShapes,
  buildNonWorkingBands,
  createTimeScale,
  dayCenter,
  dayEnd,
  dayStart,
  todayX,
} from "../assets/js/services/syntheseGanttGeometry.js";

const day = (year, month, date) => new Date(year, month - 1, date);
// Semaine du lun 14/09/2026 au lun 21/09/2026 sur 700 px : 100 px par jour.
const WEEK = createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 700 });

function line(fields = {}) {
  return {
    key: "task:0",
    kind: "task",
    name: "T",
    start: null,
    end: null,
    durationDays: null,
    isMilestone: false,
    startsWithMilestone: false,
    endsWithMilestone: false,
    collapsed: false,
    childCount: 0,
    ...fields,
  };
}

test("échelle linéaire date ↔ pixel", () => {
  assert.equal(WEEK.pxPerDay, 100);
  assert.equal(WEEK.dateToX(day(2026, 9, 14)), 0);
  assert.equal(WEEK.dateToX(day(2026, 9, 16)), 200);
  assert.equal(WEEK.xToDate(350).getTime(), day(2026, 9, 17).getTime() + DAY_MS / 2);
});

test("bornes d'une journée", () => {
  assert.equal(dayStart(new Date(2026, 8, 15, 14, 30)), day(2026, 9, 15).getTime());
  assert.equal(dayEnd(day(2026, 9, 15)), day(2026, 9, 16).getTime());
  assert.equal(dayCenter(day(2026, 9, 15)), day(2026, 9, 15).getTime() + DAY_MS / 2);
});

test("segment d'un jour = une journée, segment de plusieurs jours, largeur minimale", () => {
  const [one, three] = buildGanttShapes([
    line({ key: "task:1", name: "Un jour", start: day(2026, 9, 15), end: day(2026, 9, 15), durationDays: 1 }),
    line({ key: "task:2", name: "Trois jours", start: day(2026, 9, 15), end: day(2026, 9, 17), durationDays: 3 }),
  ], WEEK, { rowHeight: 26 });
  assert.deepEqual([one.type, one.x1, one.x2, one.y, one.row, one.label], ["taskBar", 100, 200, 0, 0, "Un jour"]);
  assert.deepEqual([three.x1, three.x2, three.y, three.row], [100, 400, 26, 1]);
  const decade = createTimeScale({ start: day(2026, 1, 1), end: day(2036, 1, 1), width: 700 });
  const [bar] = buildGanttShapes([line({ start: day(2026, 9, 15), end: day(2026, 9, 15), durationDays: 1 })], decade);
  assert.ok(bar.x2 - bar.x1 >= 2);
});

test("jalon au centre du jour avec nom et date jj/mm", () => {
  const [shape] = buildGanttShapes([
    line({ key: "task:3", name: "Réunion", start: day(2026, 9, 16), end: day(2026, 9, 16), durationDays: 0, isMilestone: true }),
  ], WEEK);
  assert.deepEqual([shape.type, shape.x, shape.label, shape.dateLabel], ["milestone", 250, "Réunion", "16/09"]);
});

test("barre de zone : bornes normales, ou centre du jalon au début et à la fin", () => {
  const zone = (fields) => line({
    kind: "zone",
    key: "zone:z",
    name: "Zone Z3A",
    start: day(2026, 9, 14),
    end: day(2026, 9, 18),
    durationDays: 5,
    ...fields,
  });
  const [plain] = buildGanttShapes([zone({})], WEEK);
  assert.deepEqual([plain.type, plain.x1, plain.x2, plain.label], ["zoneBar", 0, 500, "Zone Z3A"]);
  const [anchored] = buildGanttShapes([zone({ startsWithMilestone: true, endsWithMilestone: true })], WEEK);
  assert.deepEqual([anchored.x1, anchored.x2], [50, 450]);
});

// Review Focus 5.
test("zone repliée : sa barre reste sur sa ligne", () => {
  const shapes = buildGanttShapes([
    line({ kind: "zone", key: "zone:a", name: "Zone A", start: day(2026, 9, 14), end: day(2026, 9, 15), durationDays: 2, collapsed: true, childCount: 3 }),
    line({ kind: "zone", key: "zone:b", name: "Zone B", start: day(2026, 9, 16), end: day(2026, 9, 16), durationDays: 1 }),
  ], WEEK);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.row, shape.x1, shape.x2]), [
    ["zoneBar", 0, 0, 200],
    ["zoneBar", 1, 200, 300],
  ]);
});

test("lignes sans dates ignorées, rang conservé", () => {
  const shapes = buildGanttShapes([
    line({ key: "zone:vide", kind: "zone", name: "Vide" }),
    line({ key: "task:9", name: "Daté", start: day(2026, 9, 15), end: day(2026, 9, 15), durationDays: 1 }),
  ], WEEK);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].row, 1);
  assert.equal(shapes[0].y, 26);
});

test("jours non travaillés : week-end et férié, rien sous 6 px par jour", () => {
  assert.deepEqual(buildNonWorkingBands(WEEK).map((band) => [band.x1, band.x2, band.holiday]), [
    [500, 600, false],
    [600, 700, false],
  ]);
  const armistice = createTimeScale({ start: day(2026, 11, 9), end: day(2026, 11, 16), width: 700 });
  assert.deepEqual(buildNonWorkingBands(armistice).map((band) => [band.x1, band.holiday]), [
    [200, true],
    [500, false],
    [600, false],
  ]);
  const year = createTimeScale({ start: day(2026, 1, 1), end: day(2027, 1, 1), width: 700 });
  assert.deepEqual(buildNonWorkingBands(year), []);
});

// Review Focus 1 : les bandes suivent les minuits locaux, même un jour de 25 h.
test("changement d'heure : chaque journée va d'un minuit local au suivant", () => {
  const scale = createTimeScale({ start: day(2026, 10, 19), end: day(2026, 10, 26), width: 700 });
  const sunday = buildNonWorkingBands(scale).at(-1);
  assert.equal(sunday.x1, scale.dateToX(day(2026, 10, 25)));
  assert.equal(sunday.x2, scale.dateToX(day(2026, 10, 26)));
  const [bar] = buildGanttShapes([line({ start: day(2026, 10, 23), end: day(2026, 10, 23), durationDays: 1 })], scale);
  assert.equal(bar.x1, scale.dateToX(day(2026, 10, 23)));
  assert.equal(bar.x2, scale.dateToX(day(2026, 10, 24)));
});

// Review Focus 2.
test("panneau de largeur nulle : aucune coordonnée invalide", () => {
  const empty = createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 0 });
  assert.equal(empty.pxPerDay, 0);
  const shapes = buildGanttShapes([line({ start: day(2026, 9, 15), end: day(2026, 9, 16), durationDays: 2 })], empty);
  assert.ok(shapes.every((shape) => [shape.x1, shape.x2].every(Number.isFinite)));
  assert.ok(Number.isFinite(empty.xToDate(10).getTime()));
  assert.deepEqual(buildNonWorkingBands(empty), []);
});

test("aujourd'hui dans ou hors période", () => {
  assert.equal(todayX(WEEK, new Date(2026, 8, 16, 12)), 250);
  assert.equal(todayX(WEEK, new Date(2026, 8, 30)), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseGanttGeometry.test.mjs"`
Expected: FAIL — `Cannot find module .../syntheseGanttGeometry.js`.

- [ ] **Step 3: Write minimal implementation**

Créer `Planning Projet/assets/js/services/syntheseGanttGeometry.js` :

```js
// Géométrie du diagramme de Gantt de la vue Synthese. Module pur (sans DOM) :
// conversion date ↔ pixel, formes à dessiner pour chaque ligne du modèle de lignes,
// graduations de l'échelle, jours non travaillés, position d'aujourd'hui, et période
// après un glisser ou un zoom. Testable sous Node.
import { isWorkingDay } from "./syntheseTasks.js";
import { isFrenchHoliday } from "../utils/frenchHolidays.js";

export const DAY_MS = 86400000;
export const ROW_HEIGHT_PX = 26;
export const MIN_BAR_WIDTH_PX = 2;
export const MIN_PX_PER_DAY_FOR_OFF_DAYS = 6;

function toMs(value) {
  return value instanceof Date ? value.getTime() : Number(value);
}

function toLocalDay(value) {
  const date = new Date(toMs(value));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

// Une journée va de son minuit local au minuit local suivant (23 h ou 25 h les jours
// de changement d'heure).
export function dayStart(date) {
  return toLocalDay(date).getTime();
}

export function dayEnd(date) {
  return nextLocalDay(toLocalDay(date)).getTime();
}

export function dayCenter(date) {
  return (dayStart(date) + dayEnd(date)) / 2;
}

// Conversion linéaire date ↔ pixel de la période [start ; end] sur `width` pixels. Les
// produits sont calculés avant les divisions pour garder des positions exactes.
export function createTimeScale({ start, end, width }) {
  const startMs = toMs(start);
  const span = Math.max(1, toMs(end) - startMs);
  const safeWidth = Math.max(0, Number(width) || 0);
  return {
    start: startMs,
    end: startMs + span,
    width: safeWidth,
    pxPerDay: (safeWidth * DAY_MS) / span,
    dateToX(value) {
      return ((toMs(value) - startMs) * safeWidth) / span;
    },
    xToDate(x) {
      return new Date(startMs + ((Number(x) || 0) * span) / (safeWidth || 1));
    },
  };
}

function formatDayMonth(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

// Une forme par ligne datée du modèle de lignes, à la hauteur de sa ligne. Les lignes
// sans dates ne dessinent rien mais gardent leur rang.
export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const shapes = [];
  (lines || []).forEach((line, row) => {
    if (!(line?.start instanceof Date) || !(line?.end instanceof Date)) return;
    const y = row * rowHeight;
    if (line.kind === "zone") {
      const from = line.startsWithMilestone ? dayCenter(line.start) : dayStart(line.start);
      const to = line.endsWithMilestone ? dayCenter(line.end) : dayEnd(line.end);
      const x1 = scale.dateToX(from);
      shapes.push({
        type: "zoneBar",
        row,
        key: line.key,
        y,
        x1,
        x2: Math.max(scale.dateToX(to), x1 + MIN_BAR_WIDTH_PX),
        label: line.name,
      });
      return;
    }
    if (line.isMilestone) {
      shapes.push({
        type: "milestone",
        row,
        key: line.key,
        y,
        x: scale.dateToX(dayCenter(line.start)),
        label: line.name,
        dateLabel: formatDayMonth(line.start),
      });
      return;
    }
    const x1 = scale.dateToX(dayStart(line.start));
    shapes.push({
      type: "taskBar",
      row,
      key: line.key,
      y,
      x1,
      x2: Math.max(scale.dateToX(dayEnd(line.end)), x1 + MIN_BAR_WIDTH_PX),
      label: line.name,
    });
  });
  return shapes;
}

// Week-ends et fériés, seulement quand une journée est assez large pour être lisible.
export function buildNonWorkingBands(scale) {
  if (!(scale.pxPerDay >= MIN_PX_PER_DAY_FOR_OFF_DAYS)) return [];
  const bands = [];
  for (let day = toLocalDay(scale.start); day.getTime() < scale.end; day = nextLocalDay(day)) {
    if (isWorkingDay(day)) continue;
    bands.push({
      x1: scale.dateToX(day),
      x2: scale.dateToX(nextLocalDay(day)),
      holiday: isFrenchHoliday(day),
    });
  }
  return bands;
}

export function todayX(scale, now = new Date()) {
  const ms = toMs(now);
  if (!(ms >= scale.start && ms <= scale.end)) return null;
  return scale.dateToX(ms);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseGanttGeometry.test.mjs"`
Expected: PASS (11 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node -e 'const s=require("fs").readFileSync("Planning Projet/assets/js/services/syntheseGanttGeometry.js","utf8");console.log("CR:",(s.match(/\r/g)||[]).length)'`
Expected: toutes les suites PASS, puis `CR: 0`.

---

### Task 3: Géométrie — graduations de l'échelle, glisser, zoom, semaine par défaut

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseGanttGeometry.js` (ajouts en fin de fichier)
- Test: `Planning Projet/tests/syntheseGanttScale.test.mjs`

**Interfaces:**
- Consumes (Task 2) : `DAY_MS`, `createTimeScale`, les fonctions privées `toLocalDay`, `nextLocalDay`, `toMs` du même fichier.
- Produces :
  - constantes `MIN_SPAN_MS` (2 jours), `MAX_SPAN_MS` (3650 jours), `ZOOM_FACTOR` (1,25) ;
  - `isoWeekNumber(date) → number` ;
  - `buildScaleTiers(scale) → { mode: "week"|"month"|"year", top: Tick[], bottom: Tick[] }`, `Tick = { x1, x2, label }` (bornes coupées à [0 ; width], libellé `""` s'il ne tient pas) ;
  - `panWindow({ start, end }, deltaPx, widthPx) → { start: Date, end: Date }` ;
  - `zoomWindow({ start, end }, ratio, zoomIn) → { start: Date, end: Date }` ;
  - `currentWeekWindow(now) → { start: Date (lundi 00:00), end: Date (lundi suivant − 1 ms) }`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseGanttScale.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DAY_MS,
  MAX_SPAN_MS,
  MIN_SPAN_MS,
  buildScaleTiers,
  createTimeScale,
  currentWeekWindow,
  isoWeekNumber,
  panWindow,
  zoomWindow,
} from "../assets/js/services/syntheseGanttGeometry.js";

const day = (year, month, date) => new Date(year, month - 1, date);

test("numéro de semaine ISO", () => {
  assert.equal(isoWeekNumber(day(2026, 9, 14)), 38);
  assert.equal(isoWeekNumber(day(2027, 1, 1)), 53);
  assert.equal(isoWeekNumber(day(2027, 1, 4)), 1);
});

test("échelle Semaine : semaines ISO en haut, jours en bas", () => {
  const tiers = buildScaleTiers(createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 700 }));
  assert.equal(tiers.mode, "week");
  assert.deepEqual(tiers.top.map((tick) => [tick.x1, tick.x2, tick.label]), [[0, 700, "sept. 2026 · S38"]]);
  assert.deepEqual(tiers.bottom.map((tick) => tick.label), [
    "lun 14", "mar 15", "mer 16", "jeu 17", "ven 18", "sam 19", "dim 20",
  ]);
  assert.deepEqual([tiers.bottom[1].x1, tiers.bottom[1].x2], [100, 200]);
});

test("échelle Mois : mois en haut, jours (ou semaines si trop serré) en bas", () => {
  const month = buildScaleTiers(createTimeScale({ start: day(2026, 9, 1), end: day(2026, 10, 1), width: 900 }));
  assert.equal(month.mode, "month");
  assert.deepEqual(month.top.map((tick) => tick.label), ["septembre 2026"]);
  assert.equal(month.bottom.length, 30);
  assert.deepEqual([month.bottom[0].label, month.bottom[29].label], ["1", "30"]);
  const narrow = buildScaleTiers(createTimeScale({ start: day(2026, 9, 1), end: day(2026, 10, 1), width: 300 }));
  assert.equal(narrow.bottom[0].label, "S36");
});

test("échelle Année : années en haut, mois en bas", () => {
  const year = buildScaleTiers(createTimeScale({ start: day(2026, 1, 1), end: day(2027, 1, 1), width: 1200 }));
  assert.equal(year.mode, "year");
  assert.deepEqual(year.top.map((tick) => tick.label), ["2026"]);
  assert.deepEqual(year.bottom.map((tick) => tick.label), [
    "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  ]);
});

test("graduations coupées aux bords, libellés trop longs masqués", () => {
  const tiers = buildScaleTiers(createTimeScale({
    start: new Date(2026, 8, 16, 12),
    end: new Date(2026, 8, 23, 12),
    width: 700,
  }));
  assert.deepEqual([tiers.bottom[0].x1, tiers.bottom[0].x2, tiers.bottom[0].label], [0, 50, "mer 16"]);
  assert.equal(tiers.bottom.at(-1).x2, 700);
  const tight = buildScaleTiers(createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 140 }));
  assert.equal(tight.bottom[0].label, "", "20 px ne suffisent pas pour « lun 14 »");
});

test("glisser : la date saisie reste sous le curseur", () => {
  const next = panWindow({ start: day(2026, 9, 14), end: day(2026, 9, 21) }, 100, 700);
  assert.equal(next.start.getTime(), day(2026, 9, 13).getTime());
  assert.equal(next.end.getTime(), day(2026, 9, 20).getTime());
});

// Review Focus 4.
test("zoom centré sous le curseur, étendue bornée", () => {
  const zoomed = zoomWindow({ start: day(2026, 9, 14), end: day(2026, 9, 21) }, 0.5, true);
  const center = day(2026, 9, 14).getTime() + 3.5 * DAY_MS;
  assert.equal((zoomed.start.getTime() + zoomed.end.getTime()) / 2, center);
  assert.equal(zoomed.end - zoomed.start, (7 * DAY_MS) / 1.25);
  const min = zoomWindow({ start: day(2026, 9, 14), end: day(2026, 9, 16) }, 0, true);
  assert.equal(min.end - min.start, MIN_SPAN_MS);
  const max = zoomWindow({ start: day(2020, 1, 1), end: day(2029, 12, 31) }, 1, false);
  assert.equal(max.end - max.start, MAX_SPAN_MS);
});

// Review Focus 3.
test("semaine en cours quand la période du planning manque", () => {
  const week = currentWeekWindow(new Date(2026, 8, 23, 15));
  assert.equal(week.start.getTime(), day(2026, 9, 21).getTime());
  assert.equal(week.end.getTime(), day(2026, 9, 28).getTime() - 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseGanttScale.test.mjs"`
Expected: FAIL — `does not provide an export named 'MAX_SPAN_MS'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter à la fin de `Planning Projet/assets/js/services/syntheseGanttGeometry.js` :

```js
// Seuils des boutons Semaine / Mois / Année du bandeau (moyennes géométriques de 7, 30
// et 365 jours), pour que l'échelle change au même moment que le bouton actif.
const WEEK_SCALE_MAX_DAYS = Math.sqrt(7 * 30);
const MONTH_SCALE_MAX_DAYS = Math.sqrt(30 * 365);
const DAY_NUMBER_MIN_PX = 18;
const LABEL_CHAR_PX = 6.5;
const LABEL_PADDING_PX = 6;
export const MIN_SPAN_MS = 2 * DAY_MS;
export const MAX_SPAN_MS = 3650 * DAY_MS;
export const ZOOM_FACTOR = 1.25;

const WEEKDAYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function isoWeekNumber(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekDay = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekDay);
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  return Math.ceil(((utc.getTime() - yearStart) / DAY_MS + 1) / 7);
}

function startOfWeek(date) {
  const localDay = toLocalDay(date);
  return new Date(localDay.getFullYear(), localDay.getMonth(), localDay.getDate() - ((localDay.getDay() + 6) % 7));
}

function nextWeek(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function nextMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function nextYear(date) {
  return new Date(date.getFullYear() + 1, 0, 1);
}

function fitLabel(label, width) {
  return width >= label.length * LABEL_CHAR_PX + LABEL_PADDING_PX ? label : "";
}

// Cases consécutives (jours, semaines, mois ou années) couvrant la période, coupées à
// ses bords.
function buildTicks(scale, firstBoundary, nextBoundary, labelOf) {
  const ticks = [];
  for (
    let cursor = firstBoundary(new Date(scale.start));
    cursor.getTime() < scale.end;
    cursor = nextBoundary(cursor)
  ) {
    const x1 = Math.max(0, scale.dateToX(cursor));
    const x2 = Math.min(scale.width, scale.dateToX(nextBoundary(cursor)));
    if (x2 > x1) ticks.push({ x1, x2, label: fitLabel(labelOf(cursor), x2 - x1) });
  }
  return ticks;
}

export function buildScaleTiers(scale) {
  const spanDays = (scale.end - scale.start) / DAY_MS;
  if (spanDays < WEEK_SCALE_MAX_DAYS) {
    return {
      mode: "week",
      top: buildTicks(scale, startOfWeek, nextWeek, (date) => (
        `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()} · S${isoWeekNumber(date)}`
      )),
      bottom: buildTicks(scale, toLocalDay, nextLocalDay, (date) => `${WEEKDAYS[date.getDay()]} ${date.getDate()}`),
    };
  }
  if (spanDays < MONTH_SCALE_MAX_DAYS) {
    return {
      mode: "month",
      top: buildTicks(scale, startOfMonth, nextMonth, (date) => `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`),
      bottom: scale.pxPerDay >= DAY_NUMBER_MIN_PX
        ? buildTicks(scale, toLocalDay, nextLocalDay, (date) => String(date.getDate()))
        : buildTicks(scale, startOfWeek, nextWeek, (date) => `S${isoWeekNumber(date)}`),
    };
  }
  return {
    mode: "year",
    top: buildTicks(scale, startOfYear, nextYear, (date) => String(date.getFullYear())),
    bottom: buildTicks(scale, startOfMonth, nextMonth, (date) => MONTHS_SHORT[date.getMonth()]),
  };
}

// Glisser de `deltaPx` pixels sur un panneau de `widthPx` : la date saisie reste sous le
// curseur (la période se déplace en sens inverse).
export function panWindow({ start, end }, deltaPx, widthPx) {
  const startMs = toMs(start);
  const endMs = toMs(end);
  if (!(widthPx > 0)) return { start: new Date(startMs), end: new Date(endMs) };
  const shift = -((Number(deltaPx) || 0) * (endMs - startMs)) / widthPx;
  return { start: new Date(startMs + shift), end: new Date(endMs + shift) };
}

// Zoom centré sur la date sous le curseur (`ratio` = position relative de 0 à 1).
export function zoomWindow({ start, end }, ratio, zoomIn) {
  const startMs = toMs(start);
  const span = toMs(end) - startMs;
  const position = Math.min(1, Math.max(0, Number(ratio) || 0));
  const pointer = startMs + position * span;
  const wanted = zoomIn ? span / ZOOM_FACTOR : span * ZOOM_FACTOR;
  const nextSpan = Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, wanted));
  const nextStart = pointer - position * nextSpan;
  return { start: new Date(nextStart), end: new Date(nextStart + nextSpan) };
}

export function currentWeekWindow(now = new Date()) {
  const monday = startOfWeek(now);
  return { start: monday, end: new Date(nextWeek(monday).getTime() - 1) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseGanttScale.test.mjs" "Planning Projet/tests/syntheseGanttGeometry.test.mjs"`
Expected: PASS (8 + 11 tests).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node -e 'const s=require("fs").readFileSync("Planning Projet/assets/js/services/syntheseGanttGeometry.js","utf8");console.log("CR:",(s.match(/\r/g)||[]).length,"combinants:",(s.normalize("NFD").length-s.length))'`
Expected: toutes les suites PASS, puis `CR: 0` (le second nombre peut être non nul : les accents normaux « é » se décomposent en NFD ; seul `CR` compte ici).

---

### Task 4: Dessin SVG du Gantt, glisser, zoom, styles

**Files:**
- Create: `Planning Projet/assets/js/ui/syntheseGantt.js`
- Modify: `Planning Projet/assets/css/styles.css` (règles `.stt-scroll` et `.stt-right` ; ajout d'un bloc après la règle `.stt-menu__item.is-danger`)
- Test: `Planning Projet/tests/syntheseGantt.test.mjs`

**Interfaces:**
- Consumes (Tasks 2-3) : `ROW_HEIGHT_PX`, `buildGanttShapes`, `buildNonWorkingBands`, `buildScaleTiers`, `createTimeScale`, `currentWeekWindow`, `panWindow`, `todayX`, `zoomWindow`.
- Produces : `createSyntheseGantt({ headHost, layerHost, interactionHost, rowHeight }, { getWindow, setWindow, subscribe, now }) → { render(lines), resize() }` — `headHost` = cellule d'en-tête droite du tableau, `layerHost` = couche positionnée sur la colonne droite, `interactionHost` = conteneur défilant du tableau (écoute du glisser et de la molette sur les éléments `.stt-right`), `getWindow() → { start, end } | null`, `setWindow(start: Date, end: Date)`, `subscribe(listener) → unsubscribe`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseGantt.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createSyntheseGantt } from "../assets/js/ui/syntheseGantt.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const source = await readFile(new URL("../assets/js/ui/syntheseGantt.js", import.meta.url), "utf8");

test("le module du Gantt expose sa fabrique", () => {
  assert.equal(typeof createSyntheseGantt, "function");
});

test("couleurs de la capture MS Project, fixes", () => {
  assert.match(css, /\.stg-task\s*\{[^}]*fill:\s*#7cc7d8;[^}]*stroke:\s*#3b9bb0;/);
  assert.match(css, /\.stg-milestone\s*\{[^}]*fill:\s*#2f8fa3;/);
  assert.match(css, /\.stg-zone\s*\{[^}]*fill:\s*#1f1f1f;/);
  assert.match(css, /\.stg-today\s*\{[^}]*stroke:\s*#d92d20;/);
  assert.match(css, /\.stg-off\s*\{[^}]*fill:\s*#f1f1f1;/);
  assert.match(css, /\.stg-label\s*\{[^}]*fill:\s*#1f1f1f;/);
});

test("la couche du Gantt suit la colonne droite et laisse passer la souris", () => {
  assert.match(css, /\.stt-gantt-layer\s*\{[^}]*position:\s*absolute;/);
  assert.match(css, /\.stt-gantt-layer\s*\{[^}]*left:\s*var\(--stt-left-width\);/);
  assert.match(css, /\.stt-gantt-layer\s*\{[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.stt-scroll\s*\{[^}]*position:\s*relative;/);
});

test("un dessin par image au plus, molette non passive pour le zoom", () => {
  assert.match(source, /requestAnimationFrame\(draw\)/);
  assert.match(source, /addEventListener\("wheel",[\s\S]*?\{ passive: false \}\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseGantt.test.mjs"`
Expected: FAIL — `Cannot find module .../syntheseGantt.js`.

- [ ] **Step 3: Write minimal implementation**

Créer `Planning Projet/assets/js/ui/syntheseGantt.js` :

```js
// Diagramme de Gantt de la vue Synthese, dessiné en SVG dans le panneau droit du tableau
// de tâches : échelle des dates dans l'en-tête, une couche de formes alignée sur les
// lignes (même modèle de lignes, même hauteur de ligne). La période est celle du
// planning : glisser la déplace, Ctrl + molette (ou la molette sur l'échelle) zoome.
// Lecture seule : les dates se modifient dans le tableau.
import {
  ROW_HEIGHT_PX,
  buildGanttShapes,
  buildNonWorkingBands,
  buildScaleTiers,
  createTimeScale,
  currentWeekWindow,
  panWindow,
  todayX,
  zoomWindow,
} from "../services/syntheseGanttGeometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SCALE_TIER_HEIGHT_PX = 16;
const LABEL_GAP_PX = 6;
const LABEL_BASELINE_PX = 4;
const TASK_BAR_HEIGHT_PX = 14;
const MILESTONE_HALF_PX = 6;
const ZONE_BAR_TOP_PX = 7;
const ZONE_BAR_HEIGHT_PX = 5;
const ZONE_CAP_PX = 6;

function svgElement(tag, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  if (text != null) element.textContent = text;
  return element;
}

function px(value) {
  return Math.round(value * 10) / 10;
}

function toPoints(points) {
  return points.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
}

function isGanttTarget(target) {
  return target instanceof Element && Boolean(target.closest(".stt-right"));
}

export function createSyntheseGantt({ headHost, layerHost, interactionHost, rowHeight = ROW_HEIGHT_PX }, {
  getWindow = () => null,
  setWindow = () => {},
  subscribe = () => () => {},
  now = () => new Date(),
} = {}) {
  let lines = [];
  let frame = 0;
  let drag = null;

  const scaleSvg = svgElement("svg", { class: "stg-scale", "aria-hidden": "true" });
  const layerSvg = svgElement("svg", { class: "stg-layer", "aria-hidden": "true" });
  headHost.replaceChildren(scaleSvg);
  layerHost.replaceChildren(layerSvg);

  // Période du planning ; la semaine en cours tant qu'il n'est pas prêt.
  function currentWindow() {
    const range = getWindow();
    const start = range?.start ? new Date(+range.start) : null;
    const end = range?.end ? new Date(+range.end) : null;
    if (start && end && end > start) return { start, end };
    return currentWeekWindow(now());
  }

  /* ---------- Dessin ---------- */

  function drawScale(scale) {
    const tiers = buildScaleTiers(scale);
    const nodes = [];
    [tiers.top, tiers.bottom].forEach((ticks, tierIndex) => {
      const top = tierIndex * SCALE_TIER_HEIGHT_PX;
      ticks.forEach((tick) => {
        nodes.push(svgElement("line", {
          class: "stg-scale-tick",
          x1: px(tick.x1),
          x2: px(tick.x1),
          y1: top,
          y2: top + SCALE_TIER_HEIGHT_PX,
        }));
        if (tick.label) {
          nodes.push(svgElement("text", {
            class: "stg-scale-text",
            x: px((tick.x1 + tick.x2) / 2),
            y: top + 12,
            "text-anchor": "middle",
          }, tick.label));
        }
      });
    });
    nodes.push(svgElement("line", {
      class: "stg-scale-tick",
      x1: 0,
      x2: px(scale.width),
      y1: SCALE_TIER_HEIGHT_PX,
      y2: SCALE_TIER_HEIGHT_PX,
    }));
    scaleSvg.setAttribute("width", String(px(scale.width)));
    scaleSvg.setAttribute("height", String(SCALE_TIER_HEIGHT_PX * 2));
    scaleSvg.replaceChildren(...nodes);
  }

  function drawShape(shape) {
    const middle = shape.y + rowHeight / 2;
    const baseline = middle + LABEL_BASELINE_PX;
    if (shape.type === "taskBar") {
      return [
        svgElement("rect", {
          class: "stg-task",
          x: px(shape.x1),
          y: px(middle - TASK_BAR_HEIGHT_PX / 2),
          width: px(shape.x2 - shape.x1),
          height: TASK_BAR_HEIGHT_PX,
        }),
        svgElement("text", { class: "stg-label", x: px(shape.x2 + LABEL_GAP_PX), y: px(baseline) }, shape.label),
      ];
    }
    if (shape.type === "milestone") {
      const half = MILESTONE_HALF_PX;
      return [
        svgElement("polygon", {
          class: "stg-milestone",
          points: toPoints([
            [shape.x, middle - half],
            [shape.x + half, middle],
            [shape.x, middle + half],
            [shape.x - half, middle],
          ]),
        }),
        svgElement("text", {
          class: "stg-label",
          x: px(shape.x - half - LABEL_GAP_PX),
          y: px(baseline),
          "text-anchor": "end",
        }, shape.label),
        svgElement("text", { class: "stg-date", x: px(shape.x + half + LABEL_GAP_PX), y: px(baseline) }, shape.dateLabel),
      ];
    }
    // Barre de zone : trait noir, une pointe vers le bas à chaque extrémité.
    const top = shape.y + ZONE_BAR_TOP_PX;
    const bottom = top + ZONE_BAR_HEIGHT_PX;
    const cap = Math.min(ZONE_CAP_PX, Math.max(0, (shape.x2 - shape.x1) / 2));
    return [
      svgElement("polygon", {
        class: "stg-zone",
        points: toPoints([
          [shape.x1, top],
          [shape.x2, top],
          [shape.x2, bottom + ZONE_CAP_PX],
          [shape.x2 - cap, bottom],
          [shape.x1 + cap, bottom],
          [shape.x1, bottom + ZONE_CAP_PX],
        ]),
      }),
      svgElement("text", {
        class: "stg-label",
        x: px(shape.x1 - LABEL_GAP_PX),
        y: px(baseline),
        "text-anchor": "end",
      }, shape.label),
    ];
  }

  function drawLayer(scale, height) {
    const nodes = buildNonWorkingBands(scale).map((band) => svgElement("rect", {
      class: "stg-off",
      x: px(band.x1),
      y: 0,
      width: px(band.x2 - band.x1),
      height,
    }));
    const today = todayX(scale, now());
    if (today != null) {
      nodes.push(svgElement("line", { class: "stg-today", x1: px(today), x2: px(today), y1: 0, y2: height }));
    }
    buildGanttShapes(lines, scale, { rowHeight }).forEach((shape) => nodes.push(...drawShape(shape)));
    layerSvg.setAttribute("width", String(px(scale.width)));
    layerSvg.setAttribute("height", String(height));
    layerSvg.replaceChildren(...nodes);
  }

  function draw() {
    frame = 0;
    const height = lines.length * rowHeight;
    layerHost.style.height = `${height}px`;
    const width = layerHost.clientWidth;
    if (!(width > 0)) {
      scaleSvg.replaceChildren();
      layerSvg.replaceChildren();
      return;
    }
    const range = currentWindow();
    const scale = createTimeScale({ start: range.start, end: range.end, width });
    drawScale(scale);
    drawLayer(scale, height);
  }

  // Un seul dessin par image, quel que soit le nombre de demandes (lignes, période, taille).
  function schedule() {
    if (frame) return;
    frame = window.requestAnimationFrame(draw);
  }

  /* ---------- Glisser et zoom ---------- */

  interactionHost.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !isGanttTarget(event.target)) return;
    const rect = layerHost.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, startX: event.clientX, width: rect.width, range: currentWindow() };
    try {
      interactionHost.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché : le glisser s'arrêtera au prochain pointerup.
    }
    interactionHost.classList.add("is-panning");
  });

  interactionHost.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = panWindow(drag.range, event.clientX - drag.startX, drag.width);
    setWindow(next.start, next.end);
  });

  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try {
      interactionHost.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Capture déjà rendue par le navigateur.
    }
    interactionHost.classList.remove("is-panning");
    drag = null;
  };
  interactionHost.addEventListener("pointerup", endDrag);
  interactionHost.addEventListener("pointercancel", endDrag);

  // Ctrl + molette sur le Gantt, ou molette sur l'échelle : zoom centré sous le curseur.
  // La molette seule sur les lignes garde le défilement vertical du tableau.
  interactionHost.addEventListener("wheel", (event) => {
    if (!event.deltaY || !isGanttTarget(event.target)) return;
    if (!event.ctrlKey && !headHost.contains(event.target)) return;
    const rect = layerHost.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    event.preventDefault();
    const next = zoomWindow(currentWindow(), (event.clientX - rect.left) / rect.width, event.deltaY < 0);
    setWindow(next.start, next.end);
  }, { passive: false });

  subscribe(() => schedule());

  return {
    render(nextLines) {
      lines = Array.isArray(nextLines) ? nextLines : [];
      schedule();
    },
    resize() {
      schedule();
    },
  };
}
```

Dans `Planning Projet/assets/css/styles.css` :

1. Remplacer la règle :

```css
.stt-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
```

par :

```css
.stt-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
```

2. Remplacer la règle :

```css
.stt-right {
  min-width: 0;
}
```

par :

```css
.stt-right {
  min-width: 0;
  cursor: grab;
}
```

3. Juste après la règle existante :

```css
.stt-menu__item.is-danger {
  color: #b42318;
}
```

ajouter :

```css

/* Diagramme de Gantt (panneau droit) : couche SVG alignée sur les lignes du tableau,
   couleurs fixes reprises de MS Project, indépendantes du thème Grist. */
.stt-gantt-layer {
  position: absolute;
  top: var(--stt-head-height);
  left: var(--stt-left-width);
  right: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}

.stt-scroll.is-panning,
.stt-scroll.is-panning * {
  cursor: grabbing !important;
  user-select: none;
}

.stg-scale,
.stg-layer {
  display: block;
  overflow: hidden;
}

.stg-scale-tick {
  stroke: #555555;
  stroke-width: 1;
}

.stg-scale-text {
  fill: #ffffff;
  font-size: 11px;
}

.stg-off {
  fill: #f1f1f1;
}

.stg-today {
  stroke: #d92d20;
  stroke-width: 1.5;
}

.stg-task {
  fill: #7cc7d8;
  stroke: #3b9bb0;
  stroke-width: 1;
}

.stg-milestone {
  fill: #2f8fa3;
}

.stg-zone {
  fill: #1f1f1f;
}

.stg-label {
  fill: #1f1f1f;
  font-size: 11px;
  font-weight: 700;
}

.stg-date {
  fill: #1f1f1f;
  font-size: 11px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseGantt.test.mjs" && node --check "Planning Projet/assets/js/ui/syntheseGantt.js"`
Expected: PASS (4 tests), aucune erreur de syntaxe.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node -e 'for (const f of ["Planning Projet/assets/js/ui/syntheseGantt.js","Planning Projet/assets/css/styles.css"]) { const s=require("fs").readFileSync(f,"utf8"); console.log(f,"CR:",(s.match(/\r/g)||[]).length); }'`
Expected: toutes les suites PASS, `CR: 0` pour les deux fichiers.

---

### Task 5: Intégration — le tableau crée le Gantt, main.js fournit la période

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseTaskTable.js` (constantes ; signature de `createSyntheseTaskTable` ; création de la couche ; `applyWidth` ; `draw`)
- Modify: `Planning Projet/assets/js/main.js` (imports ; nouvelle fonction avant `getSyntheseTasks` ; ligne `createTable`)
- Modify: `Planning Projet/index.html` (versions)
- Modify: `Planning Projet/tests/syntheseTasksWiring.test.mjs` (deux assertions)
- Test: `Planning Projet/tests/syntheseGanttWiring.test.mjs`

**Interfaces:**
- Consumes (Task 4) : `createSyntheseGantt({ headHost, layerHost, interactionHost, rowHeight }, { getWindow, setWindow, subscribe })`.
- Consumes (existant, `ui/timeline.js`) : `getPlanningWindow() → { start, end } | null`, `setPlanningWindow(start, end, { byUser })`, `subscribePlanningWindowChanges(listener) → unsubscribe`.
- Produces : `createSyntheseTaskTable(host, callbacks, { createGantt })` — `createGantt(hosts) → { render(lines), resize() }` optionnel ; fonction `createSyntheseGanttForTable(hosts)` dans `main.js`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/syntheseGanttWiring.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const tableJs = await readFile(new URL("../assets/js/ui/syntheseTaskTable.js", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

test("le tableau crée la couche du Gantt hors du corps redessiné", () => {
  assert.match(tableJs, /\} = \{\}, \{ createGantt \} = \{\}\) \{/);
  assert.match(tableJs, /const ganttLayer = createElement\("div", "stt-gantt-layer"\);/);
  assert.match(tableJs, /scroller\.appendChild\(ganttLayer\);/);
  assert.match(tableJs, /createGantt\(\{ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX \}\)/);
});

test("le Gantt est redessiné avec les lignes du tableau, et à chaque changement de largeur", () => {
  const draw = sliceBetween(tableJs, "function draw(", "const renderer = createDeferredRenderer(draw);");
  assert.match(draw, /gantt\?\.render\(message \? \[\] : lines\);/);
  const width = sliceBetween(tableJs, "function applyWidth(", "/* ---------- Rendu ---------- */");
  assert.match(width, /gantt\?\.resize\(\);/);
});

test("main.js branche le Gantt sur la période du planning", () => {
  assert.match(mainJs, /import \{ createSyntheseGantt \} from "\.\/ui\/syntheseGantt\.js";/);
  const timelineImport = sliceBetween(mainJs, "  applyPlanningViewportState,", "} from \"./ui/timeline.js\";");
  ["getPlanningWindow,", "setPlanningWindow,", "subscribePlanningWindowChanges,"].forEach((name) => {
    assert.ok(timelineImport.includes(name), `${name} doit être importé de timeline.js`);
  });
  const factory = sliceBetween(mainJs, "function createSyntheseGanttForTable(", "function getSyntheseTasks(");
  assert.match(factory, /getWindow: getPlanningWindow,/);
  assert.match(factory, /setWindow: \(start, end\) => setPlanningWindow\(start, end, \{ byUser: true \}\),/);
  assert.match(factory, /subscribe: subscribePlanningWindowChanges,/);
});

test("scripts et feuille de style servis dans leur nouvelle version", () => {
  assert.equal(html.includes("20260923-taches1"), false);
  assert.equal(html.includes("20260925-couleurs1"), false);
  assert.ok(html.includes("main.js?v=20260925-gantt1"));
  assert.ok(html.includes("styles.css?v=20260925-gantt1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "Planning Projet/tests/syntheseGanttWiring.test.mjs"`
Expected: FAIL (4 tests).

- [ ] **Step 3: Write minimal implementation**

1. `Planning Projet/assets/js/ui/syntheseTaskTable.js` — sous la ligne `const MIN_RIGHT_WIDTH = 160;`, ajouter :

```js
// Hauteur d'une ligne, identique à --stt-row-height (styles.css) : le Gantt s'aligne dessus.
const ROW_HEIGHT_PX = 26;
```

2. Même fichier, dans la signature de `createSyntheseTaskTable`, remplacer :

```js
  onLockedAttempt,
} = {}) {
```

par :

```js
  onLockedAttempt,
} = {}, { createGantt } = {}) {
```

3. Même fichier, remplacer :

```js
  scroller.append(head, body, empty);
```

par :

```js
  scroller.append(head, body, empty);

  // Couche du Gantt : enfant du conteneur défilant mais hors du corps, que chaque rendu
  // reconstruit ; alignée sur les lignes par la hauteur fixe.
  const ganttLayer = createElement("div", "stt-gantt-layer");
  scroller.appendChild(ganttLayer);
  const gantt = typeof createGantt === "function"
    ? createGantt({ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX })
    : null;
```

4. Même fichier, dans `applyWidth`, remplacer :

```js
    if (persist) storeWidth(leftWidth);
```

par :

```js
    if (persist) storeWidth(leftWidth);
    gantt?.resize();
```

5. Même fichier, dans `draw`, remplacer :

```js
    body.replaceChildren(...(message ? [] : lines.map(buildLine)));
```

par :

```js
    body.replaceChildren(...(message ? [] : lines.map(buildLine)));
    gantt?.render(message ? [] : lines);
```

6. `Planning Projet/assets/js/main.js` — dans l'import depuis `./ui/timeline.js`, remplacer :

```js
  subscribePlanningSelectionChanges,
  subscribePlanningViewportChanges,
} from "./ui/timeline.js";
```

par :

```js
  subscribePlanningSelectionChanges,
  subscribePlanningViewportChanges,
  getPlanningWindow,
  setPlanningWindow,
  subscribePlanningWindowChanges,
} from "./ui/timeline.js";
```

7. Même fichier, remplacer :

```js
import { createSyntheseTasksController } from "./ui/syntheseTasksController.js";
```

par :

```js
import { createSyntheseTasksController } from "./ui/syntheseTasksController.js";
import { createSyntheseGantt } from "./ui/syntheseGantt.js";
```

8. Même fichier, juste avant `function getSyntheseTasks() {`, ajouter :

```js
// Le Gantt du tableau de tâches suit la période du planning (boutons Semaine / Mois /
// Année, plage de dates du bandeau) et la modifie quand on le fait glisser ou zoomer.
function createSyntheseGanttForTable(hosts) {
  return createSyntheseGantt(hosts, {
    getWindow: getPlanningWindow,
    setWindow: (start, end) => setPlanningWindow(start, end, { byUser: true }),
    subscribe: subscribePlanningWindowChanges,
  });
}

```

9. Même fichier, dans `getSyntheseTasks`, remplacer :

```js
    createTable: (callbacks) => createSyntheseTaskTable(host, callbacks),
```

par :

```js
    createTable: (callbacks) => createSyntheseTaskTable(host, callbacks, { createGantt: createSyntheseGanttForTable }),
```

10. `Planning Projet/index.html` : remplacer toutes les occurrences de `20260923-taches1` (4) et de `20260925-couleurs1` (1) par `20260925-gantt1`.

11. `Planning Projet/tests/syntheseTasksWiring.test.mjs` : remplacer

```js
  assert.match(mainJs, /createTable: \(callbacks\) => createSyntheseTaskTable\(host, callbacks\)/);
```

par

```js
  assert.match(mainJs, /createTable: \(callbacks\) => createSyntheseTaskTable\(host, callbacks, \{ createGantt: createSyntheseGanttForTable \}\)/);
```

et

```js
  assert.ok(html.includes("main.js?v=20260923-taches1"));
```

par

```js
  assert.ok(html.includes("main.js?v=20260925-gantt1"));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "Planning Projet/tests/syntheseGanttWiring.test.mjs" "Planning Projet/tests/syntheseTasksWiring.test.mjs" && node --check "Planning Projet/assets/js/main.js" && node --check "Planning Projet/assets/js/ui/syntheseTaskTable.js"`
Expected: PASS (4 + 6 tests), aucune erreur de syntaxe.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node --test shared/tests/*.cjs && node -e 'for (const f of ["Planning Projet/assets/js/main.js","Planning Projet/assets/js/ui/syntheseTaskTable.js","Planning Projet/index.html"]) { const s=require("fs").readFileSync(f,"utf8"); console.log(f,"CR:",(s.match(/\r/g)||[]).length); }'`
Expected: toutes les suites PASS, `CR: 0` pour les trois fichiers.

---

### Task 6: Vérification finale

**Files:** aucun nouveau.

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces : rapport de vérification pour l'utilisateur.

- [ ] **Step 1: Suites complètes et syntaxe**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node --test shared/tests/*.cjs && for f in "Planning Projet/assets/js/services/syntheseGanttGeometry.js" "Planning Projet/assets/js/ui/syntheseGantt.js" "Planning Projet/assets/js/ui/syntheseTaskTable.js" "Planning Projet/assets/js/services/syntheseTaskModel.js" "Planning Projet/assets/js/main.js"; do node --check "$f" || echo "ERREUR $f"; done`
Expected: toutes les suites PASS, aucune ligne « ERREUR ».

- [ ] **Step 2: Aucun caractère combinant introduit par erreur**

Run: `node -e 'const fs=require("fs");for (const f of ["Planning Projet/assets/js/services/syntheseGanttGeometry.js","Planning Projet/assets/js/ui/syntheseGantt.js","Planning Projet/assets/css/styles.css"]) { const s=fs.readFileSync(f,"utf8"); const n=[...s].filter((c)=>c.codePointAt(0)>=0x300&&c.codePointAt(0)<=0x36f).length; console.log(f,n); }'`
Expected: `0` pour chaque fichier.

- [ ] **Step 3: Vérification à l'écran**

Transmettre à l'utilisateur, pour son test sur localhost (Planning Projet, service Synthese, projet avec des tâches datées) :
1. l'échelle des dates apparaît dans l'en-tête droit et suit Semaine / Mois / Année ;
2. chaque zone datée a sa barre noire à pointes, son nom à gauche ;
3. une tâche de 0 jour = losange, nom à gauche, « jj/mm » à droite ; 1 jour et plus = segment bleu-vert, nom à droite ;
4. glisser dans le panneau droit déplace la période (la plage du bandeau suit) ; Ctrl + molette zoome ; molette seule fait défiler les lignes ;
5. replier une zone garde sa barre ; modifier une durée dans le tableau redessine le segment ;
6. week-ends grisés en vue Semaine / Mois, trait rouge sur aujourd'hui ;
7. clic droit dans le panneau droit ouvre le menu Ajouter / Supprimer.

- [ ] **Step 4: Revue indépendante**

Revue finale de l'ensemble (spec, plan et ce diff) ; corriger les problèmes confirmés, relancer les suites.
