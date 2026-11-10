# Étages, glisser-déposer et flèches de la vue Synthese — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au tableau de tâches Synthese de Planning Projet les étages (niveau entre la zone et
ses tâches), le glisser-déposer des tâches entre conteneurs, les crochets d'étage et les flèches du
Gantt, et une file d'écritures plus sûre.

**Architecture:** Le modèle pur (`syntheseTaskModel.js`) reconnaît les lignes-étages (`Etage` vrai),
range les tâches par `Groupe`, calcule les récapitulatifs et prépare toutes les écritures Grist ; le
contrôleur les affiche tout de suite en surimpression et les écrit en arrière-plan dans une file
unique ; le tableau dessine les lignes d'étage, le menu et les poignées, et confie le glisser à un
petit module ; la géométrie du Gantt calcule crochets et flèches, le module SVG les dessine.

**Tech Stack:** modules ES sans compilation (widget Grist), tests `node --test` (Node 25), aucune
dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-09-25-synthese-etages-design.md` (fait autorité ; prolonge
`docs/superpowers/specs/2026-09-23-synthese-taches-design.md` et
`docs/superpowers/specs/2026-09-25-synthese-gantt-design.md`).

## Global Constraints

- **Aucun commit, aucun `git add`, aucun push** : l'utilisateur teste l'arbre de travail sur localhost et commite lui-même. Là où une méthode dit « commit », faire le checkpoint (tests + contrôle des octets).
- Fins de ligne **LF** uniquement (0 `\r` dans chaque fichier touché, vérifié avec node) ; ne jamais écrire, via les outils d'écriture, une séquence « barre oblique inverse + u + 4 chiffres hexadécimaux » (ils la décodent) ; accents et signes en caractères directs ; pour retirer les accents : `/\p{M}/gu`.
- Ligne-étage : `Taches` = nom, `Etage` = booléen `true`, `Zone`, `Groupe` = "", `NomProjet` ; pas de dates. Lecture de `Etage` tolérante : `true` ou le texte « true » (sans casse ni espaces).
- Tâche d'un étage : `Groupe` = nom de l'étage ; tâche du niveau zone : `Groupe` vide.
- Nom d'étage : obligatoire, 200 caractères au plus, au moins une lettre ou un chiffre, clé unique dans sa zone (`floorKeyOf` : sans accents, sans casse, sans ponctuation).
- Hauteur de ligne 26 px ; en-tête 32 px.
- Couleurs : cellule du nom d'étage `#c6e0b4` ; crochet d'étage `#1f1f1f`, 1,5 px ; flèches `#3b9bb0`, 1 px, pointe pleine.
- Messages (exacts) :
  - « La colonne « Etage » n'existe pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages. »
  - « Le projet ou le service a changé avant l'enregistrement : recommencez. »
  - « Enregistrement… »
  - « Le nom de l'étage ne peut pas être vide. » / « Le nom de l'étage est limité à 200 caractères. » / « Le nom de l'étage doit contenir au moins une lettre ou un chiffre. » / « Un étage « PH RDB » existe déjà dans cette zone. »
  - « Supprimer l'étage « PH RDB » ? » / « …et sa tâche ? » / « …et ses 24 tâches ? »
- Version des scripts et de la feuille de style à la fin : `20260925-etages1`.

## Review Focus

1. **Dates au format de la ligne d'exemple de l'utilisateur** (`"2026-11-30T00:00:00.000Z"`) : lues au 30/11, pas au 29 ni au 1er — test en Task 1.
2. **`Etage` sous toutes ses formes** (`true`, « true », « TRUE », `false`, vide, colonne absente) : seul le vrai fait un étage — test en Task 1.
3. **Renommer un étage en changeant seulement la casse** (« PH RDB » → « Ph Rdb ») : accepté, pas un doublon de lui-même — test en Task 3.
4. **Relecture de Grist pendant un glisser** (le corps du tableau est reconstruit, la poignée remplacée) : le glisser continue et dépose au bon endroit — test en Task 7.
5. **Tâche dont le `Groupe` nomme l'étage d'une autre zone** : elle reste dans sa zone, dans un étage de ce nom — test en Task 2.

---

### Task 1: Reconnaissance des étages et vue Structure

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (constantes de colonnes, `floorKeyOf`, reconnaissance des lignes, `readTask`)
- Modify: `Planning Projet/assets/js/services/planningSyncCoordinator.js:14` et `:31`
- Test: `Planning Projet/tests/syntheseTaskModel.test.mjs`, `Planning Projet/tests/planningSyncTaskRows.test.mjs`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces :
  - `PLANNING_TABLE = "Planning_Projet"` ;
  - `TASK_COLUMNS.group = "Groupe"`, `TASK_COLUMNS.floor = "Etage"` ;
  - `floorKeyOf(value) → string` ;
  - `isFloorValue(value) → boolean`, `isFloorRow(row) → boolean`, `isTaskRow(row) → boolean` (exclut désormais les étages), `isSyntheseRow(row) → boolean` (tâche ou étage) ;
  - `readTask(row)` renvoie en plus `groupName` (texte du `Groupe`) et `floorKey` (`floorKeyOf(Groupe)`).

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTaskModel.test.mjs`, remplace le bloc d'import par :

```js
import {
  NO_ZONE_KEY,
  PLANNING_TABLE,
  TASK_COLUMNS,
  floorKeyOf,
  formatDate,
  formatDuration,
  isFloorRow,
  isSyntheseRow,
  isTaskRow,
  nextWorkingDay,
  previousWorkingDay,
  readTask,
  zoneKeyOf,
} from "../assets/js/services/syntheseTaskModel.js";
```

Remplace tout le test `test("les colonnes Grist utilisées", () => { … });` par :

```js
test("les colonnes Grist utilisées", () => {
  assert.equal(PLANNING_TABLE, "Planning_Projet");
  assert.deepEqual({ ...TASK_COLUMNS }, {
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
  });
});
```

Puis ajoute à la fin du fichier :

```js
// Review Focus 2 : Etage sous toutes ses formes.
test("un étage est une ligne nommée, sans type ni ID, marquée Etage", () => {
  assert.equal(isFloorRow(taskRow({ Etage: true })), true);
  assert.equal(isFloorRow(taskRow({ Etage: "true" })), true);
  assert.equal(isFloorRow(taskRow({ Etage: " TRUE " })), true);
  assert.equal(isFloorRow(taskRow({ Etage: false })), false);
  assert.equal(isFloorRow(taskRow({ Etage: "" })), false);
  assert.equal(isFloorRow(taskRow()), false, "colonne absente");
  assert.equal(isFloorRow(taskRow({ Etage: true, Type_doc: "COFFRAGE" })), false);
  assert.equal(isFloorRow(taskRow({ Etage: true, Taches: " " })), false);
});

test("un étage n'est pas une tâche ; tâches et étages sont des lignes Synthese", () => {
  assert.equal(isTaskRow(taskRow({ Etage: true })), false);
  assert.equal(isTaskRow(taskRow({ Etage: false })), true);
  assert.equal(isSyntheseRow(taskRow({ Etage: true })), true);
  assert.equal(isSyntheseRow(taskRow()), true);
  assert.equal(isSyntheseRow(taskRow({ Type_doc: "COFFRAGE" })), false);
  assert.equal(isSyntheseRow(taskRow({ Taches: "" })), false);
});

test("readTask lit le Groupe : l'étage de la tâche", () => {
  const inFloor = readTask(taskRow({ Groupe: " PH RDB " }));
  assert.equal(inFloor.groupName, "PH RDB");
  assert.equal(inFloor.floorKey, "phrdb");
  const atZone = readTask(taskRow());
  assert.equal(atZone.groupName, "");
  assert.equal(atZone.floorKey, "");
});

// Review Focus 1 : dates au format de la ligne d'exemple (ISO avec heure).
test("dates ISO avec heure (« 2026-11-30T00:00:00.000Z ») lues au bon jour", () => {
  const task = readTask(taskRow({
    Diff_coffrage: "2026-11-30T00:00:00.000Z",
    Diff_armature: "2026-11-30T00:00:00.000Z",
    Duree_1: 0,
  }));
  assert.equal(iso(task.start), "2026-11-30");
  assert.equal(iso(task.end), "2026-11-30");
  assert.equal(task.isMilestone, true);
});

test("floorKeyOf ignore casse, accents et ponctuation", () => {
  assert.equal(floorKeyOf("PH RDB"), "phrdb");
  assert.equal(floorKeyOf(" Ph-Rdb "), "phrdb");
  assert.equal(floorKeyOf("Étage R+1"), "etager1");
  assert.equal(floorKeyOf(""), "");
  assert.equal(floorKeyOf(null), "");
});
```

Dans `Planning Projet/tests/planningSyncTaskRows.test.mjs`, ajoute à la fin :

```js
test("le recalcul automatique ignore aussi les étages Synthese", () => {
  const rows = [
    { id: 1, NomProjet: "P", Taches: "RDC", Type_doc: "COFFRAGE", ID2: "001" },
    { id: 6, NomProjet: "P", Taches: "PH RDB", Type_doc: "", ID2: "", Zone: "Z1", Etage: true },
    { id: 7, NomProjet: "P", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Z1", Groupe: "PH RDB", Etage: false },
  ];
  assert.deepEqual(getProjectPlanningRows(rows, "P").map((row) => row.id), [1]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseTaskModel.test.mjs" "Planning Projet/tests/planningSyncTaskRows.test.mjs"`
Expected: FAIL du fichier du modèle (`PLANNING_TABLE`, `floorKeyOf`, `isFloorRow`, `isSyntheseRow` ne sont pas exportés). Le test du coordinateur passe encore (aujourd'hui une ligne-étage est vue comme une tâche) : c'est un test de garde, il échouera à l'étape 4.

- [ ] **Step 3: Implement the model**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js`, remplace le bloc :

```js
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
```

par :

```js
export const PLANNING_TABLE = "Planning_Projet";

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
});
```

Juste après la fonction `zoneKeyOf` (après son `}`), ajoute :

```js

// Clé de comparaison d'un étage dans sa zone : « PH RDB » = « ph-rdb » = « Ph Rdb ».
export function floorKeyOf(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}
```

Remplace le bloc :

```js
// Une tâche est une ligne nommée sans type de document ni ID : les lignes de zone
// n'ont pas de nom, les documents ont un type et un numéro.
export function isTaskRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    Boolean(toText(row?.[TASK_COLUMNS.name])) &&
    !toText(row?.[TASK_COLUMNS.typeDoc]) &&
    !toText(row?.[TASK_COLUMNS.id2]);
}
```

par :

```js
// Ligne propre à la vue Synthese : nommée, sans type de document ni ID (les lignes de
// zone n'ont pas de nom, les documents ont un type et un numéro).
function isNamedPlainRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    Boolean(toText(row?.[TASK_COLUMNS.name])) &&
    !toText(row?.[TASK_COLUMNS.typeDoc]) &&
    !toText(row?.[TASK_COLUMNS.id2]);
}

// Colonne Etage : booléen Grist, ou le texte « true » si la colonne est du texte.
export function isFloorValue(value) {
  return value === true || toText(value).toLocaleLowerCase("fr") === "true";
}

// Un étage est une ligne Synthese marquée Etage ; une tâche, une ligne Synthese qui ne
// l'est pas.
export function isFloorRow(row) {
  return isNamedPlainRow(row) && isFloorValue(row?.[TASK_COLUMNS.floor]);
}

export function isTaskRow(row) {
  return isNamedPlainRow(row) && !isFloorValue(row?.[TASK_COLUMNS.floor]);
}

// Tâches et étages : le planning Structure les ignore.
export function isSyntheseRow(row) {
  return isNamedPlainRow(row);
}
```

Dans `readTask`, sous la ligne `    zoneKey: zoneKeyOf(zoneName),` ajoute :

```js
    groupName: toText(row?.[TASK_COLUMNS.group]),
    floorKey: floorKeyOf(row?.[TASK_COLUMNS.group]),
```

- [ ] **Step 4: Run tests — the guard test now fails**

Run: `node --test "Planning Projet/tests/syntheseTaskModel.test.mjs" "Planning Projet/tests/planningSyncTaskRows.test.mjs"`
Expected: le fichier du modèle PASS ; « le recalcul automatique ignore aussi les étages Synthese » FAIL (la ligne 6, un étage, n'est plus une tâche et passe dans le planning Structure).

- [ ] **Step 5: Exclude floors from the Structure planning**

Dans `Planning Projet/assets/js/services/planningSyncCoordinator.js`, remplace
`import { isTaskRow } from "./syntheseTaskModel.js";` par
`import { isSyntheseRow } from "./syntheseTaskModel.js";`, et `    !isTaskRow(row)` par
`    !isSyntheseRow(row)`.

Run: `node --test "Planning Projet/tests/syntheseTaskModel.test.mjs" "Planning Projet/tests/planningSyncTaskRows.test.mjs"`
Expected: PASS.

- [ ] **Step 6: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs` puis
`node -e 'for (const f of ["Planning Projet/assets/js/services/syntheseTaskModel.js","Planning Projet/assets/js/services/planningSyncCoordinator.js","Planning Projet/tests/syntheseTaskModel.test.mjs","Planning Projet/tests/planningSyncTaskRows.test.mjs"]) { const s=require("fs").readFileSync(f,"utf8"); console.log(f,"CR:",(s.match(/\r/g)||[]).length,"marques:",(s.match(/\p{M}/gu)||[]).length); }'`
Expected: toute la suite PASS (6 tests de plus) ; `CR: 0` et `marques: 0` partout.

---

### Task 2: Sections et modèle de lignes à étages

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (`buildSections`, `buildRowModel`, aides nouvelles)
- Test: `Planning Projet/tests/syntheseTaskSections.test.mjs`

**Interfaces:**
- Consumes (Task 1) : `isFloorRow`, `isTaskRow`, `readTask` (`groupName`, `floorKey`), `floorKeyOf`, `TASK_COLUMNS`.
- Produces :
  - `buildSections({ rows, sharedZones, zoneFilter })` → sections `{ zoneKey, zoneName, label, tasks, summary, floors, items }` :
    - `tasks` : toutes les tâches de la zone, étages compris, triées par date ;
    - `summary` : récapitulatif de ces tâches ;
    - `floors` : `{ key, name, rowIds, tasks, summary }[]`, dans l'ordre des `items` ;
    - `items` : niveau zone trié, `{ kind: "task", task }` ou `{ kind: "floor", floor }`.
  - `floorCollapseKey(zoneKey, floorKey) → "zoneKey/floorKey"`.
  - `buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys })` → lignes avec en plus `floorKey`, `floorName`, `floorRowIds` :
    - zone (niveau 0, `childCount` = nombre d'`items`) ;
    - étage (`kind: "floor"`, niveau 1, clé `floor:<zoneKey>/<floorKey>`, récapitulatif et drapeaux de jalon) ;
    - tâche du niveau zone (niveau 1, `floorKey` "") ;
    - tâche d'étage (niveau 2).

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTaskSections.test.mjs`, ajoute `floorCollapseKey,` à la liste d'import (entre `buildSections,` et `readTask,`), puis ajoute à la fin du fichier :

```js
function floor(id, name, zone) {
  return row(id, { Taches: name, Zone: zone, Etage: true });
}

function floorTask(id, name, zone, group, start, end, duration) {
  return row(id, { Taches: name, Zone: zone, Groupe: group, Diff_coffrage: start, Diff_armature: end, Duree_1: duration });
}

// Capture MS Project : Zone Z3A = un jalon au niveau zone, puis les étages PH RDB et PH RDH.
function z3aRows() {
  return [
    task(1, "Jalon démarrage GO", "Zone Z3A", "2026-02-02", "2026-02-02", 0),
    floor(20, "PH RDB", "Zone Z3A"),
    floorTask(2, "FOND DE PLAN NIV PH RDB ind 0", "Zone Z3A", "PH RDB", "2026-08-10", "2026-08-10", 0),
    floorTask(3, "Plans avant synthèse des CET", "Zone Z3A", "PH RDB", "2026-08-11", "2026-09-03", 18),
    floor(21, "PH RDH", "Zone Z3A"),
    floorTask(4, "FOND DE PLAN NIV PH RDH ind 0", "Zone Z3A", "PH RDH", "2026-08-24", "2026-08-24", 0),
  ];
}

test("étages : tâches rangées sous leur étage, tâches de zone et étages mêlés par date", () => {
  const [section] = buildSections({ rows: z3aRows() });
  assert.deepEqual(
    section.items.map((item) => (item.kind === "task" ? `task:${item.task.id}` : `floor:${item.floor.key}`)),
    ["task:1", "floor:phrdb", "floor:phrdh"]
  );
  const rdb = section.floors[0];
  assert.equal(rdb.name, "PH RDB");
  assert.deepEqual(rdb.rowIds, [20]);
  assert.deepEqual(rdb.tasks.map((item) => item.id), [2, 3]);
  assert.equal(iso(rdb.summary.start), "2026-08-10");
  assert.equal(iso(rdb.summary.end), "2026-09-03");
  assert.equal(rdb.summary.durationDays, 19);
  assert.equal(rdb.summary.startsWithMilestone, true);
  assert.deepEqual(section.tasks.map((item) => item.id), [1, 2, 3, 4], "toutes les tâches de la zone");
  assert.equal(iso(section.summary.start), "2026-02-02");
  assert.equal(iso(section.summary.end), "2026-09-03");
});

// Review Focus 5 : un Groupe qui nomme l'étage d'une autre zone.
test("étages issus du Groupe, doublons fusionnés, pas d'étage sans zone ni dans « Sans zone »", () => {
  const rows = [
    ...z3aRows(),
    floor(22, "ph rdb", "Zone Z3A"),
    floorTask(5, "Orpheline", "Zone Z3A", "PH RDC", "2026-09-07", "2026-09-11", 5),
    floor(23, "PH X", ""),
    floorTask(6, "Sans zone", "", "PH RDB", "2026-09-07", "2026-09-07", 1),
    floorTask(7, "Ailleurs", "Zone Z2A", "PH RDB", "2026-09-07", "2026-09-07", 1),
  ];
  const sections = buildSections({ rows });
  assert.deepEqual(sections.map((section) => section.label), ["Zone Z2A", "Zone Z3A", NO_ZONE_LABEL]);
  const z3a = sections[1];
  assert.deepEqual(z3a.floors.map((item) => [item.key, item.name, item.rowIds]), [
    ["phrdb", "PH RDB", [20, 22]],
    ["phrdh", "PH RDH", [21]],
    ["phrdc", "PH RDC", []],
  ]);
  const z2a = sections[0];
  assert.deepEqual(z2a.floors.map((item) => [item.key, item.rowIds, item.tasks.map((entry) => entry.id)]), [
    ["phrdb", [], [7]],
  ]);
  const noZone = sections[2];
  assert.deepEqual(noZone.floors, []);
  assert.deepEqual(noZone.items.map((item) => item.task.id), [6]);
});

test("modèle de lignes : zone, tâches de zone, étages puis leurs tâches ; repli d'un étage", () => {
  const sections = buildSections({ rows: z3aRows() });
  const open = buildRowModel(sections);
  assert.deepEqual(open.map((line) => [line.key, line.kind, line.level, line.floorKey]), [
    ["zone:zonez3a", "zone", 0, ""],
    ["task:1", "task", 1, ""],
    ["floor:zonez3a/phrdb", "floor", 1, "phrdb"],
    ["task:2", "task", 2, "phrdb"],
    ["task:3", "task", 2, "phrdb"],
    ["floor:zonez3a/phrdh", "floor", 1, "phrdh"],
    ["task:4", "task", 2, "phrdh"],
  ]);
  const rdb = open[2];
  assert.equal(rdb.name, "PH RDB");
  assert.equal(rdb.floorName, "PH RDB");
  assert.deepEqual(rdb.floorRowIds, [20]);
  assert.equal(rdb.durationDays, 19);
  assert.equal(rdb.startsWithMilestone, true);
  assert.equal(rdb.childCount, 2);
  assert.equal(open[0].childCount, 3);
  assert.equal(open[3].floorName, "PH RDB");
  const folded = buildRowModel(sections, { collapsedFloorKeys: new Set([floorCollapseKey("zonez3a", "phrdb")]) });
  assert.deepEqual(folded.map((line) => line.key), [
    "zone:zonez3a",
    "task:1",
    "floor:zonez3a/phrdb",
    "floor:zonez3a/phrdh",
    "task:4",
  ]);
  assert.equal(folded[2].collapsed, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseTaskSections.test.mjs"`
Expected: FAIL (`floorCollapseKey` n'est pas exporté).

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js`, remplace tout le texte qui va du commentaire
`// Sections du tableau : une par zone du projet (celles des lignes lues et celles des`
jusqu'à la fin du fichier par :

```js
// Un étage d'une zone, lu depuis sa ligne-étage.
function readFloor(row) {
  const name = toText(row?.[TASK_COLUMNS.name]);
  const zoneName = toText(row?.[TASK_COLUMNS.zone]);
  return {
    rowId: Number(row?.[TASK_COLUMNS.id]),
    name,
    zoneKey: zoneKeyOf(zoneName),
    floorKey: floorKeyOf(name),
  };
}

function itemBounds(item) {
  if (item.kind === "floor") {
    return { start: item.floor.summary?.start ?? null, end: item.floor.summary?.end ?? null, name: item.floor.name };
  }
  return { start: item.task.start, end: item.task.end, name: item.task.name };
}

// Niveau zone : tâches et étages mêlés par date de début, puis de fin, puis par nom ; le
// non daté à la fin.
function compareItems(left, right) {
  const a = itemBounds(left);
  const b = itemBounds(right);
  const aDated = a.start instanceof Date && a.end instanceof Date;
  const bDated = b.start instanceof Date && b.end instanceof Date;
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated) {
    const byStart = a.start - b.start;
    if (byStart) return byStart;
    const byEnd = a.end - b.end;
    if (byEnd) return byEnd;
  }
  const byName = compareNames(a.name, b.name);
  if (byName) return byName;
  if (left.kind !== right.kind) return left.kind === "task" ? -1 : 1;
  return left.kind === "task" ? left.task.id - right.task.id : 0;
}

// Sections du tableau : une par zone du projet (celles des lignes lues et celles des
// autres services), triées par nom, puis « Sans zone » si des tâches n'ont pas de zone.
// Chaque section porte toutes ses tâches (récapitulatif de zone), ses étages (lignes-étages
// et noms trouvés dans le Groupe des tâches) et son niveau zone : tâches hors étage et
// étages, mêlés par date. Pas d'étage dans « Sans zone ». Un filtre de zone n'en garde
// qu'une.
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

  const floorRowsByZone = new Map();
  rows.filter(isFloorRow).map(readFloor).forEach((floorRow) => {
    if (floorRow.zoneKey === NO_ZONE_KEY || !floorRow.floorKey) return;
    if (!floorRowsByZone.has(floorRow.zoneKey)) floorRowsByZone.set(floorRow.zoneKey, []);
    floorRowsByZone.get(floorRow.zoneKey).push(floorRow);
  });

  const toSection = (zoneKey, zoneName) => {
    const tasks = (tasksByZone.get(zoneKey) || []).slice().sort(compareTasks);
    const floors = new Map();
    const floorFor = (key, name) => {
      if (!floors.has(key)) floors.set(key, { key, name, rowIds: [], tasks: [], summary: null });
      return floors.get(key);
    };
    (floorRowsByZone.get(zoneKey) || []).forEach((floorRow) => {
      floorFor(floorRow.floorKey, floorRow.name).rowIds.push(floorRow.rowId);
    });
    const items = [];
    tasks.forEach((task) => {
      if (zoneKey !== NO_ZONE_KEY && task.floorKey) floorFor(task.floorKey, task.groupName).tasks.push(task);
      else items.push({ kind: "task", task });
    });
    floors.forEach((floor) => {
      floor.summary = summarizeTasks(floor.tasks);
      items.push({ kind: "floor", floor });
    });
    items.sort(compareItems);
    return {
      zoneKey,
      zoneName,
      label: zoneName || NO_ZONE_LABEL,
      tasks,
      summary: summarizeTasks(tasks),
      floors: items.filter((item) => item.kind === "floor").map((item) => item.floor),
      items,
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

// Clé de repli d'un étage (un même nom d'étage peut exister dans deux zones).
export function floorCollapseKey(zoneKey, floorKey) {
  return `${zoneKey}/${floorKey}`;
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

// Le modèle de lignes : exactement ce qui est affiché, dans l'ordre, une entrée par
// ligne — la zone (niveau 0), puis son niveau zone : tâches hors étage (niveau 1) et
// étages (niveau 1) suivis de leurs tâches (niveau 2). Le tableau le dessine ; le Gantt
// dessine la même liste, à la même hauteur de ligne.
export function buildRowModel(sections = [], {
  collapsedZoneKeys = new Set(),
  collapsedFloorKeys = new Set(),
} = {}) {
  const lines = [];
  const taskLine = (section, task, floor) => ({
    key: `task:${task.id}`,
    kind: "task",
    level: floor ? 2 : 1,
    zoneKey: section.zoneKey,
    zoneName: section.zoneName,
    floorKey: floor ? floor.key : "",
    floorName: floor ? floor.name : "",
    floorRowIds: [],
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
      taskId: null,
      name: section.label,
      ...summaryFields(section.summary),
      collapsed,
      childCount: section.items.length,
    });
    if (collapsed) return;
    section.items.forEach((item) => {
      if (item.kind === "task") {
        lines.push(taskLine(section, item.task, null));
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
        taskId: null,
        name: floor.name,
        ...summaryFields(floor.summary),
        collapsed: floorCollapsed,
        childCount: floor.tasks.length,
      });
      if (floorCollapsed) return;
      floor.tasks.forEach((task) => lines.push(taskLine(section, task, floor)));
    });
  });
  return lines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseTaskSections.test.mjs" "Planning Projet/tests/syntheseTaskZoneAnchors.test.mjs"`
Expected: PASS (les tests existants des sections et des ancres de zone restent verts).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: `node --test "Planning Projet/tests/"*.test.mjs` et le contrôle CR / marques de la Task 1 sur `syntheseTaskModel.js` et `syntheseTaskSections.test.mjs`.
Expected: toute la suite PASS (3 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 3: Règles d'écriture des étages et des déplacements (modèle pur)

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseTaskModel.js` (`buildNewTask`, `buildTaskFields`, règles nouvelles)
- Modify: `Planning Projet/assets/js/ui/syntheseTasksController.js` (un seul appel de `buildNewTask`)
- Modify: `Planning Projet/tests/syntheseTaskEdits.test.mjs` (paramètre renommé)
- Test: `Planning Projet/tests/syntheseFloorRules.test.mjs` (nouveau)

**Interfaces:**
- Consumes (Tasks 1-2) : `floorKeyOf`, `readTask`, `PLANNING_TABLE`, `TASK_COLUMNS`, forme des sections et des lignes.
- Produces :
  - `buildNewTask({ zoneName, groupName, groupTasks, today })` → tâche avec en plus `groupName`, `floorKey` (le paramètre `zoneTasks` devient `groupTasks`) ;
  - `buildTaskFields(task, { projectName })` → ajoute `Groupe` seulement si `task.groupName` n'est pas vide ;
  - `NEW_FLOOR_NAME = "Nouvel étage"` ;
  - `validateFloorName(rawValue, { floors, currentKey }) → { ok: true, name, key } | { ok: false, error }` ;
  - `nextFloorName(floors) → string` ;
  - `buildFloorFields({ name, zoneName, projectName }) → fields` ;
  - `buildFloorRenameActions(floor, name) → actions[]` ;
  - `buildFloorDeleteActions(floor) → actions[]` ;
  - `buildFloorDeleteQuestion(floor) → string` ;
  - `containerKeyOf(line) → "floor:<zoneKey>/<floorKey>" | "zone:<zoneKey>"` ;
  - `resolveDropTarget(line) → { key, zoneKey, zoneName, floorKey, floorName, label } | null` ;
  - `buildMoveFields(task, target) → fields` ;
  - `detectFloorColumn(rows) → true | false | null`.

- [ ] **Step 1: Write the failing tests**

Crée `Planning Projet/tests/syntheseFloorRules.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  NEW_FLOOR_NAME,
  buildFloorDeleteActions,
  buildFloorDeleteQuestion,
  buildFloorFields,
  buildFloorRenameActions,
  buildMoveFields,
  buildNewTask,
  buildTaskFields,
  containerKeyOf,
  detectFloorColumn,
  nextFloorName,
  readTask,
  resolveDropTarget,
  validateFloorName,
} from "../assets/js/services/syntheseTaskModel.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const TODAY = new Date(2026, 8, 23);

const RDB = { key: "phrdb", name: "PH RDB", rowIds: [20], tasks: [{ id: 2 }, { id: 3 }] };
const RDH = { key: "phrdh", name: "PH RDH", rowIds: [21], tasks: [] };

// Visa MOE : Ven 09/10/26 → Ven 23/10/26, dans la Zone Z3A.
function task(fields = {}) {
  return readTask({
    id: 7,
    Taches: "Visa MOE",
    Type_doc: "",
    ID2: "",
    Zone: "Zone Z3A",
    Groupe: "",
    Diff_coffrage: "2026-10-09",
    Diff_armature: "2026-10-23",
    Duree_1: 11,
    ...fields,
  });
}

test("nom d'étage : obligatoire, limité, avec une lettre ou un chiffre", () => {
  assert.equal(validateFloorName("   ").error, "Le nom de l'étage ne peut pas être vide.");
  assert.equal(validateFloorName("x".repeat(201)).error, "Le nom de l'étage est limité à 200 caractères.");
  assert.equal(validateFloorName("---").error, "Le nom de l'étage doit contenir au moins une lettre ou un chiffre.");
  assert.deepEqual(validateFloorName("  PH R+1 "), { ok: true, name: "PH R+1", key: "phr1" });
});

test("nom d'étage : unique dans la zone, sans tenir compte de la casse ni des accents", () => {
  const floors = [RDB, RDH];
  assert.equal(validateFloorName("ph-rdh", { floors }).error, "Un étage « PH RDH » existe déjà dans cette zone.");
  // Review Focus 3 : changer la casse de son propre nom n'est pas un doublon.
  assert.equal(validateFloorName("Ph Rdb", { floors, currentKey: "phrdb" }).ok, true);
  assert.equal(validateFloorName("PH RDH", { floors, currentKey: "phrdb" }).ok, false);
});

test("nom par défaut : « Nouvel étage », puis numéroté", () => {
  assert.equal(nextFloorName([]), NEW_FLOOR_NAME);
  assert.equal(nextFloorName([{ key: "nouveletage" }]), "Nouvel étage 2");
  assert.equal(nextFloorName([{ key: "nouveletage" }, { key: "nouveletage2" }]), "Nouvel étage 3");
});

test("colonnes d'une nouvelle ligne-étage", () => {
  assert.deepEqual(buildFloorFields({ name: "PH RDB", zoneName: "Zone Z3A", projectName: "HOTEL DIEU" }), {
    Taches: "PH RDB",
    Zone: "Zone Z3A",
    Groupe: "",
    Etage: true,
    NomProjet: "HOTEL DIEU",
  });
});

test("renommer : lignes-étages et Groupe des tâches en une seule écriture", () => {
  assert.deepEqual(buildFloorRenameActions(RDB, "PH R+1"), [
    ["UpdateRecord", "Planning_Projet", 20, { Taches: "PH R+1" }],
    ["BulkUpdateRecord", "Planning_Projet", [2, 3], { Groupe: ["PH R+1", "PH R+1"] }],
  ]);
  assert.deepEqual(buildFloorRenameActions({ ...RDB, rowIds: [20, 22], tasks: [] }, "PH R+1"), [
    ["BulkUpdateRecord", "Planning_Projet", [20, 22], { Taches: ["PH R+1", "PH R+1"] }],
  ]);
  // Étage sans ligne (issu du Groupe des tâches) : seules ses tâches sont écrites.
  assert.deepEqual(buildFloorRenameActions({ ...RDB, rowIds: [] }, "PH R+1"), [
    ["BulkUpdateRecord", "Planning_Projet", [2, 3], { Groupe: ["PH R+1", "PH R+1"] }],
  ]);
});

test("supprimer : lignes-étages et tâches en une seule écriture ; question avec le nombre de tâches", () => {
  assert.deepEqual(buildFloorDeleteActions(RDB), [["BulkRemoveRecord", "Planning_Projet", [20, 2, 3]]]);
  assert.deepEqual(buildFloorDeleteActions(RDH), [["BulkRemoveRecord", "Planning_Projet", [21]]]);
  assert.equal(buildFloorDeleteQuestion(RDH), "Supprimer l'étage « PH RDH » ?");
  assert.equal(buildFloorDeleteQuestion({ ...RDB, tasks: [{ id: 2 }] }), "Supprimer l'étage « PH RDB » et sa tâche ?");
  const many = { ...RDB, tasks: Array.from({ length: 24 }, (_, index) => ({ id: index + 1 })) };
  assert.equal(buildFloorDeleteQuestion(many), "Supprimer l'étage « PH RDB » et ses 24 tâches ?");
});

test("cible d'un dépôt selon la ligne visée ; conteneur d'une tâche", () => {
  const zone = { kind: "zone", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  const floorLine = { kind: "floor", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" };
  const floorTask = { kind: "task", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" };
  const zoneTask = { kind: "task", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  const toFloor = {
    key: "floor:zonez3a/phrdb",
    zoneKey: "zonez3a",
    zoneName: "Zone Z3A",
    floorKey: "phrdb",
    floorName: "PH RDB",
    label: "Déplacer dans « PH RDB »",
  };
  const toZone = {
    key: "zone:zonez3a",
    zoneKey: "zonez3a",
    zoneName: "Zone Z3A",
    floorKey: "",
    floorName: "",
    label: "Déplacer au niveau de la zone « Zone Z3A »",
  };
  assert.deepEqual(resolveDropTarget(zone), toZone);
  assert.deepEqual(resolveDropTarget(floorLine), toFloor);
  assert.deepEqual(resolveDropTarget(floorTask), toFloor);
  assert.deepEqual(resolveDropTarget(zoneTask), toZone);
  const noZone = { kind: "zone", zoneKey: "", zoneName: "", floorKey: "", floorName: "" };
  assert.equal(resolveDropTarget(noZone).label, "Déplacer au niveau de la zone « Sans zone »");
  assert.equal(resolveDropTarget(null), null);
  assert.equal(containerKeyOf(floorTask), "floor:zonez3a/phrdb");
  assert.equal(containerKeyOf(zoneTask), "zone:zonez3a");
});

test("déplacer une tâche : seulement ce qui change, rien vers son conteneur actuel", () => {
  const toFloor = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" };
  const toZone = { zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" };
  const toOtherZone = { zoneKey: "zonez2a", zoneName: "Zone Z2A", floorKey: "", floorName: "" };
  const atZone = task();
  const inFloor = task({ Groupe: "PH RDB" });
  assert.deepEqual(buildMoveFields(atZone, toFloor), { Groupe: "PH RDB" });
  assert.deepEqual(buildMoveFields(inFloor, toZone), { Groupe: "" });
  assert.deepEqual(buildMoveFields(inFloor, toOtherZone), { Zone: "Zone Z2A", Groupe: "" });
  assert.deepEqual(buildMoveFields(inFloor, toFloor), {});
  assert.deepEqual(buildMoveFields(atZone, toZone), {});
  // Dans « Sans zone », la tâche est au niveau zone même si son Groupe nomme un étage.
  const orphan = task({ Zone: "", Groupe: "PH RDB" });
  assert.deepEqual(buildMoveFields(orphan, { zoneKey: "", zoneName: "", floorKey: "", floorName: "" }), {});
});

test("nouvelle tâche dans un étage : après la dernière Fin de l'étage, Groupe écrit", () => {
  const created = buildNewTask({
    zoneName: "Zone Z3A",
    groupName: "PH RDB",
    groupTasks: [task({ Groupe: "PH RDB" })],
    today: TODAY,
  });
  assert.equal(iso(created.start), "2026-10-26");
  assert.equal(created.groupName, "PH RDB");
  assert.equal(created.floorKey, "phrdb");
  assert.deepEqual(buildTaskFields(created, { projectName: "HOTEL DIEU" }), {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z3A",
    Groupe: "PH RDB",
  });
});

test("colonne Etage : présente, absente, ou inconnue sans ligne", () => {
  assert.equal(detectFloorColumn([]), null);
  assert.equal(detectFloorColumn([{ id: 1, Taches: "" }]), false);
  assert.equal(detectFloorColumn([{ id: 1 }, { id: 2, Etage: false }]), true);
});
```

Dans `Planning Projet/tests/syntheseTaskEdits.test.mjs`, remplace les 5 occurrences de `zoneTasks:` par `groupTasks:` (rien d'autre ne change).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseFloorRules.test.mjs" "Planning Projet/tests/syntheseTaskEdits.test.mjs"`
Expected: FAIL (exports absents ; les tests de nouvelle tâche échouent : `groupTasks` n'est pas encore lu, la tâche part d'aujourd'hui).

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/services/syntheseTaskModel.js`, remplace tout le bloc qui va du commentaire
`// Une nouvelle tâche démarre le jour ouvré qui suit la plus tardive des Fins de sa`
jusqu'à la fin de la fonction `buildTaskFields` (son `}` qui précède `function hasDates(task) {`) par :

```js
// Une nouvelle tâche démarre le jour ouvré qui suit la plus tardive des Fins de son
// groupe — l'étage, ou le niveau zone — (aujourd'hui, ou le jour ouvré suivant, si le
// groupe n'a rien de daté) et dure un jour.
export function buildNewTask({ zoneName = "", groupName = "", groupTasks = [], today = new Date() } = {}) {
  const ends = (groupTasks || [])
    .map((groupTask) => groupTask?.end)
    .filter((end) => end instanceof Date);
  const latestEnd = ends.length ? new Date(Math.max(...ends.map((end) => end.getTime()))) : null;
  const start = latestEnd ? nextWorkingDay(shiftDays(latestEnd, 1)) : nextWorkingDay(today);
  const name = toText(zoneName);
  const group = toText(groupName);
  return {
    id: null,
    name: NEW_TASK_NAME,
    zoneName: name,
    zoneKey: zoneKeyOf(name),
    groupName: group,
    floorKey: floorKeyOf(group),
    start,
    end: start,
    durationDays: 1,
    isMilestone: false,
  };
}

export function buildTaskFields(task, { projectName = "" } = {}) {
  const fields = {
    [TASK_COLUMNS.name]: toText(task?.name),
    [TASK_COLUMNS.start]: task?.start instanceof Date ? toIsoDate(task.start) : null,
    [TASK_COLUMNS.end]: task?.end instanceof Date ? toIsoDate(task.end) : null,
    [TASK_COLUMNS.duration]: Number.isFinite(task?.durationDays) ? task.durationDays : 0,
    [TASK_COLUMNS.project]: toText(projectName),
    [TASK_COLUMNS.zone]: toText(task?.zoneName),
  };
  // Tâche d'un étage : le nom de l'étage dans Groupe (rien au niveau zone).
  const group = toText(task?.groupName);
  if (group) fields[TASK_COLUMNS.group] = group;
  return fields;
}

export const NEW_FLOOR_NAME = "Nouvel étage";

// Nom d'un étage : obligatoire, limité comme un nom de tâche, avec au moins une lettre
// ou un chiffre, unique dans sa zone (même clé qu'un autre étage = doublon ; changer
// seulement la casse ou les accents de son propre nom reste permis).
export function validateFloorName(rawValue, { floors = [], currentKey = "" } = {}) {
  const name = toText(rawValue);
  if (!name) return refuse("Le nom de l'étage ne peut pas être vide.");
  if (name.length > MAX_TASK_NAME_LENGTH) {
    return refuse(`Le nom de l'étage est limité à ${MAX_TASK_NAME_LENGTH} caractères.`);
  }
  const key = floorKeyOf(name);
  if (!key) return refuse("Le nom de l'étage doit contenir au moins une lettre ou un chiffre.");
  const other = (floors || []).find((floor) => floor.key === key && floor.key !== currentKey);
  if (other) return refuse(`Un étage « ${other.name} » existe déjà dans cette zone.`);
  return { ok: true, name, key };
}

// « Nouvel étage », puis « Nouvel étage 2 », « Nouvel étage 3 »… selon les noms pris.
export function nextFloorName(floors = []) {
  const taken = new Set((floors || []).map((floor) => floor.key));
  if (!taken.has(floorKeyOf(NEW_FLOOR_NAME))) return NEW_FLOOR_NAME;
  let index = 2;
  while (taken.has(floorKeyOf(`${NEW_FLOOR_NAME} ${index}`))) index += 1;
  return `${NEW_FLOOR_NAME} ${index}`;
}

// Colonnes d'une nouvelle ligne-étage (le Service est posé par le contexte partagé).
export function buildFloorFields({ name = "", zoneName = "", projectName = "" } = {}) {
  return {
    [TASK_COLUMNS.name]: toText(name),
    [TASK_COLUMNS.zone]: toText(zoneName),
    [TASK_COLUMNS.group]: "",
    [TASK_COLUMNS.floor]: true,
    [TASK_COLUMNS.project]: toText(projectName),
  };
}

// Renommer un étage : ses lignes-étages et le Groupe de ses tâches, en une seule écriture.
export function buildFloorRenameActions(floor, name) {
  const actions = [];
  const rowIds = floor?.rowIds || [];
  if (rowIds.length === 1) {
    actions.push(["UpdateRecord", PLANNING_TABLE, rowIds[0], { [TASK_COLUMNS.name]: name }]);
  } else if (rowIds.length > 1) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, [...rowIds], { [TASK_COLUMNS.name]: rowIds.map(() => name) }]);
  }
  const taskIds = (floor?.tasks || []).map((task) => task.id);
  if (taskIds.length) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, taskIds, { [TASK_COLUMNS.group]: taskIds.map(() => name) }]);
  }
  return actions;
}

// Supprimer un étage : ses lignes-étages et toutes ses tâches, en une seule écriture.
export function buildFloorDeleteActions(floor) {
  const ids = [...(floor?.rowIds || []), ...(floor?.tasks || []).map((task) => task.id)];
  return ids.length ? [["BulkRemoveRecord", PLANNING_TABLE, ids]] : [];
}

export function buildFloorDeleteQuestion(floor) {
  const count = (floor?.tasks || []).length;
  if (!count) return `Supprimer l'étage « ${floor.name} » ?`;
  if (count === 1) return `Supprimer l'étage « ${floor.name} » et sa tâche ?`;
  return `Supprimer l'étage « ${floor.name} » et ses ${count} tâches ?`;
}

// Conteneur d'une ligne de tâche : son étage, ou le niveau zone de sa zone (même format
// que la clé de la ligne d'en-tête du conteneur).
export function containerKeyOf(line) {
  return line?.floorKey ? `floor:${line.zoneKey}/${line.floorKey}` : `zone:${line?.zoneKey ?? ""}`;
}

// Cible d'un dépôt d'après la ligne visée : ligne de zone → niveau zone de cette zone ;
// ligne d'étage ou tâche d'un étage → cet étage ; tâche du niveau zone → niveau zone.
export function resolveDropTarget(line) {
  if (!line || !["zone", "floor", "task"].includes(line.kind)) return null;
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

// Colonnes à écrire pour déplacer une tâche vers une cible : seulement ce qui change,
// rien si la cible est son conteneur actuel (dans « Sans zone », la tâche est au niveau
// zone même si son Groupe nomme un étage).
export function buildMoveFields(task, target) {
  if (!task || !target) return {};
  const currentFloorKey = task.zoneKey === NO_ZONE_KEY ? "" : task.floorKey;
  if (target.zoneKey === task.zoneKey && target.floorKey === currentFloorKey) return {};
  const fields = {};
  if (target.zoneKey !== task.zoneKey) fields[TASK_COLUMNS.zone] = toText(target.zoneName);
  const group = target.floorKey ? toText(target.floorName) : "";
  if (group !== task.groupName) fields[TASK_COLUMNS.group] = group;
  return fields;
}

// La colonne Etage existe-t-elle ? Réponse d'après les lignes lues dans Grist : null si
// aucune ligne ne permet de le savoir.
export function detectFloorColumn(rows = []) {
  if (!rows?.length) return null;
  return rows.some((row) => row != null && Object.prototype.hasOwnProperty.call(row, TASK_COLUMNS.floor));
}
```

Dans `Planning Projet/assets/js/ui/syntheseTasksController.js`, remplace
`    const task = buildNewTask({ zoneName: section.zoneName, zoneTasks: section.tasks, today: now() });`
par
`    const task = buildNewTask({ zoneName: section.zoneName, groupTasks: section.tasks, today: now() });`
(comportement inchangé jusqu'à la Task 4).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseFloorRules.test.mjs" "Planning Projet/tests/syntheseTaskEdits.test.mjs" "Planning Projet/tests/syntheseTasksController.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: toute la suite, puis le contrôle CR / marques sur les 4 fichiers touchés.
Expected: PASS (10 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 4: File d'écritures du contrôleur (surimpression, contexte, indicateur, messages)

**Files:**
- Modify (réécriture complète): `Planning Projet/assets/js/ui/syntheseTasksController.js`
- Test: `Planning Projet/tests/syntheseTasksController.test.mjs`

**Interfaces:**
- Consumes (Tasks 1-3) : `PLANNING_TABLE`, `TASK_COLUMNS`, `applyTaskEdit`, `buildNewTask({ zoneName, groupTasks, today })`, `buildRowModel`, `buildSections` (sections avec `items`), `buildTaskFields`.
- Produces :
  - `createSyntheseTasksController({ context, docApi, createTable, confirm, now, timers })` où `timers = { setTimeout(callback, delay), clearTimeout(handle) }` (par défaut les minuteries globales) ;
  - rappels du tableau inchangés (`onEdit`, `onAddTask(zoneKey)`, `onDeleteTask`, `onToggleZone`, `onLockedAttempt`) ;
  - statut nouveau `table.setStatus("Enregistrement…", "saving")` ;
  - fonctions internes `submit(op, { onSuccess, onFailure })`, `createOp({ changes, removals, actions })`, `setStatus`, `info`, `fail`, réutilisées par la Task 5.

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTasksController.test.mjs` :

1. Juste après la fonction `flush`, ajoute :

```js
// Minuteries réglées à la main : rien ne part tout seul pendant les tests.
function manualTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    pending,
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    runAll() {
      const entries = [...pending.values()];
      pending.clear();
      entries.forEach(({ callback }) => callback());
    },
  };
}
```

2. Dans la signature de `setup`, remplace
`function setup({ rows = planningRows(), accessMode = "editable", applyUserActions = null, confirm = () => true } = {}) {`
par
`function setup({ rows = planningRows(), accessMode = "editable", applyUserActions = null, confirm = () => true, timers = manualTimers() } = {}) {`,
dans l'appel `createSyntheseTasksController({ … })` ajoute `    timers,` sous `    now: () => TODAY,`,
et remplace `  return { state, listeners, context, writes, table, controller, lastRender, taskLine };`
par `  return { state, listeners, context, writes, table, controller, lastRender, taskLine, timers };`.

3. Ajoute à la fin du fichier :

```js
test("écriture en attente : pas envoyée si le service a changé avant son tour", async () => {
  const manual = manualWrites();
  const env = setup({ rows: twoTaskRows(), applyUserActions: manual.applyUserActions });
  env.state.selectedService = "Synthese";
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(6, "duration", "3");
  env.state.selectedService = "Structure";
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.equal(env.writes.length, 1, "la seconde écriture n'est pas partie");
  assert.equal(env.taskLine(6).durationDays, 5, "sa saisie est retirée de l'affichage");
  assert.equal(env.table.statuses.at(-1).text, "Le projet ou le service a changé avant l'enregistrement : recommencez.");
});

test("enregistrement lent : « Enregistrement… » après une seconde, effacé à la fin", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  assert.deepEqual([...env.timers.pending.values()].map((entry) => entry.delay), [1000]);
  env.timers.runAll();
  assert.deepEqual(env.table.statuses.at(-1), { text: "Enregistrement…", tone: "saving" });
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.deepEqual(env.table.statuses.at(-1), { text: "", tone: "info" });
});

test("« Enregistrement… » ne remplace pas une erreur affichée", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  env.table.callbacks.onEdit(5, "start", "2026-10-26");
  env.timers.runAll();
  assert.match(env.table.statuses.at(-1).text, /après la fin/);
  manual.calls[0].resolve({ retValues: [null] });
  await flush();
  assert.match(env.table.statuses.at(-1).text, /après la fin/);
});

test("suppression en attente : la tâche reste masquée même si une relecture la ramène", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  const deleting = env.table.callbacks.onDeleteTask(5);
  assert.equal(env.taskLine(5), undefined);
  await env.controller.refresh();
  assert.equal(env.taskLine(5), undefined, "la relecture ne la fait pas revenir");
  manual.calls[0].resolve({ retValues: [null] });
  await deleting;
  assert.equal(env.taskLine(5), undefined);
});

test("suppression refusée : la tâche revient telle que lue dans Grist", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  const deleting = env.table.callbacks.onDeleteTask(5);
  manual.calls[0].reject(new Error("réseau"));
  await deleting;
  assert.equal(env.taskLine(5).durationDays, 11);
  assert.match(env.table.statuses.at(-1).text, /échoué/);
});

test("un ajout réussi en arrière-plan ne remplace pas une erreur affichée", async () => {
  const manual = manualWrites();
  const env = setup({ applyUserActions: manual.applyUserActions });
  await activate(env);
  env.table.callbacks.onEdit(5, "duration", "5");
  const adding = env.table.callbacks.onAddTask(Z2A);
  manual.calls[0].reject(new Error("réseau"));
  await flush();
  manual.calls[1].resolve({ retValues: [42] });
  await adding;
  assert.ok(env.taskLine(42), "la tâche est bien ajoutée");
  assert.match(env.table.statuses.at(-1).text, /échoué/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseTasksController.test.mjs"`
Expected: FAIL des 6 nouveaux tests (la seconde écriture part malgré le changement de service ; aucune minuterie ; la tâche supprimée revient après la relecture ; le succès de l'ajout remplace l'erreur).

- [ ] **Step 3: Implement — replace the whole file**

Remplace tout le contenu de `Planning Projet/assets/js/ui/syntheseTasksController.js` par :

```js
// Chef d'orchestre du tableau de tâches de la vue Synthese : charge les lignes
// Planning_Projet du projet et du service courants, se tient à jour, applique les
// saisies dans Grist et redessine le tableau. Ses dépendances sont injectées (le
// contexte partagé, l'API Grist, la fabrique du tableau, les minuteries) : doublures en
// test.
import {
  PLANNING_TABLE,
  TASK_COLUMNS,
  applyTaskEdit,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
} from "../services/syntheseTaskModel.js";

const SAVING_DELAY_MS = 1000;

const MESSAGES = Object.freeze({
  noProject: "Choisissez un projet pour afficher ses tâches.",
  loading: "Chargement des tâches…",
  noZone: "Aucune zone pour ce projet. Ajoutez-en une avec la liste « Zone » du bandeau (« Ajouter une zone »).",
  readFailed: "Les tâches du projet n'ont pas pu être lues. Elles seront relues au prochain changement.",
  locked: "Activez « Editer » dans le bandeau pour modifier les tâches.",
  readOnly: "Ce service est en lecture seule pour vous : les tâches ne sont pas modifiables.",
  saving: "Enregistrement…",
  contextChanged: "Le projet ou le service a changé avant l'enregistrement : recommencez.",
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
  timers = {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
  },
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
  // Opérations affichées mais pas encore enregistrées, dans l'ordre (voir submit).
  let pendingOps = [];
  let writeQueue = Promise.resolve();
  let queuedWrites = 0;
  let savingTimer = null;
  let savingShown = false;
  let errorShown = false;

  const table = createTable({
    onEdit: (taskId, field, rawValue) => handleEdit(taskId, field, rawValue),
    onAddTask: (zoneKey) => handleAddTask(zoneKey),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onToggleZone: (zoneKey) => toggleZone(zoneKey),
    onLockedAttempt: () => setStatus(lockedMessage(), "error"),
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

  // Barre d'état : une erreur reste jusqu'à la saisie acceptée suivante ; ni un message
  // d'information arrivé en arrière-plan ni « Enregistrement… » ne la remplacent.
  function setStatus(text, tone = "info") {
    errorShown = Boolean(text) && tone === "error";
    savingShown = Boolean(text) && tone === "saving";
    table.setStatus(text, tone);
  }

  function info(text) {
    if (!errorShown) setStatus(text, "info");
  }

  function fail(label, error, dropped = []) {
    console.error(label, error);
    const message = describeWriteError(error);
    setStatus(
      dropped.length > 1 ? `${message} Les saisies suivantes sur les mêmes lignes sont annulées aussi.` : message,
      "error"
    );
  }

  // Lignes lues dans Grist, avec par-dessus les opérations pas encore enregistrées : une
  // relecture pendant une écriture ne fait ni réapparaître une ancienne valeur, ni revenir
  // une ligne en cours de suppression.
  function displayedRows() {
    if (!pendingOps.length) return rows;
    const overlay = new Map();
    const removed = new Set();
    pendingOps.forEach((op) => {
      op.changes.forEach((fields, rowId) => overlay.set(rowId, { ...overlay.get(rowId), ...fields }));
      op.removals.forEach((rowId) => removed.add(rowId));
    });
    return rows
      .filter((row) => !removed.has(Number(row?.[TASK_COLUMNS.id])))
      .map((row) => {
        const fields = overlay.get(Number(row?.[TASK_COLUMNS.id]));
        return fields ? { ...row, ...fields } : row;
      });
  }

  function render() {
    if (!active) return;
    const project = getProject();
    sections = project
      ? buildSections({ rows: displayedRows(), sharedZones: getSharedZones(project), zoneFilter })
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
        setStatus(MESSAGES.readFailed, "error");
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

  function findSection(zoneKey) {
    return sections.find((section) => section.zoneKey === zoneKey) || null;
  }

  function findTask(taskId) {
    for (const section of sections) {
      const task = section.tasks.find((candidate) => candidate.id === taskId);
      if (task) return task;
    }
    return null;
  }

  function findRow(rowId) {
    return rows.find((row) => Number(row?.[TASK_COLUMNS.id]) === rowId) || null;
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

  // Contexte d'une écriture, mémorisé quand elle est demandée et revérifié quand vient son
  // tour : une écriture en attente ne part jamais dans un autre projet ou service.
  function captureContext() {
    const state = getState();
    return { service: toText(state.selectedService), projectKey: toProjectKey(state.currentProject?.name) };
  }

  function assertSameContext(expected) {
    const current = captureContext();
    if (current.service === expected.service && current.projectKey === expected.projectKey) return;
    const error = new Error(MESSAGES.contextChanged);
    error.userMessage = MESSAGES.contextChanged;
    throw error;
  }

  // « Enregistrement… » quand la file est occupée depuis plus d'une seconde.
  function startSavingTimer() {
    timers.clearTimeout(savingTimer);
    savingTimer = timers.setTimeout(() => {
      savingTimer = null;
      if (queuedWrites && !errorShown) setStatus(MESSAGES.saving, "saving");
    }, SAVING_DELAY_MS);
  }

  function stopSavingIndicator() {
    timers.clearTimeout(savingTimer);
    savingTimer = null;
    if (savingShown) setStatus("", "info");
  }

  // Les écritures partent une à une, dans l'ordre des demandes : une saisie peut s'appuyer
  // sur la précédente, encore en route vers Grist. Sans écriture en cours, elle part tout
  // de suite.
  function enqueue(job) {
    const run = queuedWrites ? writeQueue.then(job) : job();
    queuedWrites += 1;
    if (queuedWrites === 1) startSavingTimer();
    writeQueue = run.then(() => {}, () => {}).then(() => {
      queuedWrites -= 1;
      if (!queuedWrites) stopSavingIndicator();
    });
    return run;
  }

  // Une opération : ce qu'elle change à l'affichage en attendant Grist (valeurs par ligne,
  // lignes retirées), ses actions Grist et le contexte où elle a été demandée.
  function createOp({ changes = new Map(), removals = [], actions }) {
    return { changes, removals: new Set(removals), actions, context: captureContext() };
  }

  // Échec : l'opération est retirée, et avec elle les suivantes qui touchent les mêmes
  // lignes (elles avaient été calculées à partir de ce qu'elle affichait).
  function dropFrom(op) {
    const from = pendingOps.indexOf(op);
    const touched = new Set([...op.changes.keys(), ...op.removals]);
    const dropped = [op];
    pendingOps.slice(from + 1).forEach((candidate) => {
      const rowIds = [...candidate.changes.keys(), ...candidate.removals];
      if (!rowIds.some((rowId) => touched.has(rowId))) return;
      dropped.push(candidate);
      rowIds.forEach((rowId) => touched.add(rowId));
    });
    pendingOps = pendingOps.filter((candidate) => !dropped.includes(candidate));
    return dropped;
  }

  // Une opération est affichée tout de suite puis écrite dans la file. Réussie, les lignes
  // lues prennent ses valeurs en attendant la relecture ; échouée, elle disparaît de
  // l'affichage, avec les suivantes qui en dépendaient.
  function submit(op, { onSuccess, onFailure } = {}) {
    pendingOps.push(op);
    render();
    return enqueue(async () => {
      if (!pendingOps.includes(op)) return;
      let result;
      try {
        assertSameContext(op.context);
        result = await write(op.actions);
      } catch (error) {
        const dropped = dropFrom(op);
        render();
        onFailure?.(error, dropped);
        return;
      }
      op.changes.forEach((fields, rowId) => {
        const row = findRow(rowId);
        if (row) Object.assign(row, fields);
      });
      if (op.removals.size) rows = rows.filter((row) => !op.removals.has(Number(row?.[TASK_COLUMNS.id])));
      pendingOps = pendingOps.filter((candidate) => candidate !== op);
      onSuccess?.(result);
    });
  }

  function refuseLocked() {
    setStatus(lockedMessage(), "error");
    render();
  }

  // Saisie : affichée tout de suite, enregistrée ensuite en arrière-plan, dans l'ordre. Le
  // tableau passe aussitôt à la cellule suivante : rien de ce qui est tapé entre-temps
  // n'est perdu.
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
    setStatus("", "info");
    void submit(createOp({
      changes: new Map([[taskId, result.fields]]),
      actions: [["UpdateRecord", PLANNING_TABLE, taskId, result.fields]],
    }), {
      onFailure: (error, dropped) => fail("Modification de la tâche impossible :", error, dropped),
    });
  }

  function handleAddTask(zoneKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    if (!project || !section) return Promise.resolve();
    const groupTasks = section.items.filter((item) => item.kind === "task").map((item) => item.task);
    const task = buildNewTask({ zoneName: section.zoneName, groupTasks, today: now() });
    const fields = buildTaskFields(task, { projectName: project.name });
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(zoneKey);
        render();
        if (hasId) table.startEditing(newId, "name");
        info(`Tâche ajoutée dans « ${section.label} ».`);
      },
      onFailure: (error, dropped) => fail("Ajout de la tâche impossible :", error, dropped),
    });
  }

  function handleDeleteTask(taskId) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId)) return Promise.resolve();
    if (!confirm(`Supprimer la tâche « ${task.name} » ?`)) return Promise.resolve();
    return submit(createOp({
      removals: [taskId],
      actions: [["RemoveRecord", PLANNING_TABLE, taskId]],
    }), {
      onSuccess: () => info(`Tâche « ${task.name} » supprimée.`),
      onFailure: (error, dropped) => fail("Suppression de la tâche impossible :", error, dropped),
    });
  }

  function toggleZone(zoneKey) {
    if (collapsedZoneKeys.has(zoneKey)) collapsedZoneKeys.delete(zoneKey);
    else collapsedZoneKeys.add(zoneKey);
    render();
  }

  function bind() {
    if (bound) return;
    bound = true;
    // Les changements de Planning_Projet arrivent par la surveillance de main.js
    // (options de signal du relais, sans sondage), qui appelle refresh().
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
    // Appelée par la surveillance de Planning_Projet de main.js, qui vient de relire
    // la table : le cache partagé est frais, inutile de forcer une nouvelle lecture.
    refresh({ forceRefresh = false } = {}) {
      return load({ forceRefresh });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseTasksController.test.mjs" "Planning Projet/tests/syntheseTasksWiring.test.mjs"`
Expected: PASS (tous les tests existants du contrôleur, dont « écriture refusée : la saisie et les suivantes de la même tâche sont annulées… », restent verts).

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: toute la suite + contrôle CR / marques sur les 2 fichiers.
Expected: PASS (6 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 5: Étages dans le contrôleur (ajouter, renommer, supprimer, déplacer, replier)

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseTasksController.js` (version de la Task 4)
- Test: `Planning Projet/tests/syntheseTasksController.test.mjs`

**Interfaces:**
- Consumes (Tasks 1-4) : `NO_ZONE_KEY`, `buildFloorDeleteActions`, `buildFloorDeleteQuestion`, `buildFloorFields`, `buildFloorRenameActions`, `buildMoveFields`, `detectFloorColumn`, `floorCollapseKey`, `floorKeyOf`, `nextFloorName`, `validateFloorName`, `submit`, `createOp`, `setStatus`, `info`, `fail`.
- Produces (rappels passés au tableau, utilisés par les Tasks 6-7) :
  - `onEdit(taskId, field, rawValue)` ;
  - `onRenameFloor(zoneKey, floorKey, rawValue)` ;
  - `onAddTask(zoneKey, floorKey = "")` ;
  - `onAddFloor(zoneKey)` ;
  - `onDeleteTask(taskId)` ;
  - `onDeleteFloor(zoneKey, floorKey)` ;
  - `onMoveTask(taskId, target)` avec `target = { key, zoneKey, zoneName, floorKey, floorName, label }` ;
  - `onToggleZone(zoneKey)`, `onToggleFloor(zoneKey, floorKey)` ;
  - `onLockedAttempt()`.
- Le contrôleur appelle `table.render(lines, { editable, emptyMessage, canAddFloor })` et `table.startEditingFloor(zoneKey, floorKey)`.

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTasksController.test.mjs` :

1. Dans la doublure du tableau de `setup`, sous la ligne
`        startEditing: (taskId, field) => table.editing.push({ taskId, field }),` ajoute :

```js
        startEditingFloor: (zoneKey, floorKey) => table.editing.push({ zoneKey, floorKey }),
```

2. Juste après la fonction `manualWrites`, ajoute :

```js
// Zone Z2A : l'étage PH RDB (Visa MOE dedans) et la tâche Plans CET au niveau zone.
function floorRows() {
  return [
    { id: 10, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: false, Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { id: 20, NomProjet: "HOTEL DIEU", Taches: "PH RDB", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: true, Diff_coffrage: null, Diff_armature: null, Duree_1: 0 },
    { id: 5, NomProjet: "HOTEL DIEU", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "PH RDB", Etage: false, Diff_coffrage: "2026-10-09", Diff_armature: "2026-10-23", Duree_1: 11 },
    { id: 6, NomProjet: "HOTEL DIEU", Taches: "Plans CET", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: false, Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-16", Duree_1: 5 },
  ];
}
```

3. Ajoute à la fin du fichier :

```js
test("étages : ligne d'étage, tâches rangées dessous ; colonne Etage présente", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  assert.deepEqual(env.lastRender().lines.map((line) => [line.key, line.level]), [
    [`zone:${Z2A}`, 0],
    [`floor:${Z2A}/phrdb`, 1],
    ["task:5", 2],
    ["task:6", 1],
  ]);
  assert.equal(env.lastRender().options.canAddFloor, true);
});

test("ajouter un étage : nom par défaut, AddRecord, nom en saisie", async () => {
  const env = setup({ rows: floorRows(), applyUserActions: () => ({ retValues: [50] }) });
  await activate(env);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.deepEqual(env.writes[0], [["AddRecord", "Planning_Projet", null, {
    Taches: "Nouvel étage",
    Zone: "Zone Z2A",
    Groupe: "",
    Etage: true,
    NomProjet: "HOTEL DIEU",
  }]]);
  assert.ok(env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/nouveletage`));
  assert.deepEqual(env.table.editing.at(-1), { zoneKey: Z2A, floorKey: "nouveletage" });
});

test("colonne Etage absente : pas d'étage, message", async () => {
  const env = setup();
  await activate(env);
  assert.equal(env.lastRender().options.canAddFloor, false);
  await env.table.callbacks.onAddFloor(Z2A);
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.table.statuses.at(-1).text,
    "La colonne « Etage » n'existe pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages."
  );
});

test("renommer un étage : ligne-étage et Groupe des tâches en une écriture, affiché tout de suite", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onRenameFloor(Z2A, "phrdb", "PH R+1");
  assert.deepEqual(env.writes[0], [
    ["UpdateRecord", "Planning_Projet", 20, { Taches: "PH R+1" }],
    ["BulkUpdateRecord", "Planning_Projet", [5], { Groupe: ["PH R+1"] }],
  ]);
  assert.ok(env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/phr1`));
  assert.equal(env.lastRender().lines.find((line) => line.taskId === 5).floorName, "PH R+1");
});

test("renommer un étage avec le nom d'un autre étage de la zone : refusé", async () => {
  const rows = [
    ...floorRows(),
    { id: 21, NomProjet: "HOTEL DIEU", Taches: "PH RDH", Type_doc: "", ID2: "", Zone: "Zone Z2A", Groupe: "", Etage: true },
  ];
  const env = setup({ rows });
  await activate(env);
  env.table.callbacks.onRenameFloor(Z2A, "phrdb", "ph rdh");
  assert.equal(env.writes.length, 0);
  assert.equal(env.table.statuses.at(-1).text, "Un étage « PH RDH » existe déjà dans cette zone.");
});

test("supprimer un étage : confirmation avec le nombre de tâches, une écriture, masqué tout de suite", async () => {
  let question = "";
  const env = setup({ rows: floorRows(), confirm: (message) => { question = message; return true; } });
  await activate(env);
  await env.table.callbacks.onDeleteFloor(Z2A, "phrdb");
  assert.equal(question, "Supprimer l'étage « PH RDB » et sa tâche ?");
  assert.deepEqual(env.writes[0], [["BulkRemoveRecord", "Planning_Projet", [20, 5]]]);
  assert.equal(env.lastRender().lines.some((line) => line.key === `floor:${Z2A}/phrdb` || line.taskId === 5), false);
});

test("déplacer une tâche dans un étage : Groupe écrit, rangée dessous tout de suite", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onMoveTask(6, {
    key: `floor:${Z2A}/phrdb`,
    zoneKey: Z2A,
    zoneName: "Zone Z2A",
    floorKey: "phrdb",
    floorName: "PH RDB",
    label: "Déplacer dans « PH RDB »",
  });
  assert.deepEqual(env.writes[0], [["UpdateRecord", "Planning_Projet", 6, { Groupe: "PH RDB" }]]);
  const moved = env.lastRender().lines.find((line) => line.taskId === 6);
  assert.equal(moved.floorKey, "phrdb");
  assert.equal(moved.level, 2);
});

test("déplacer une tâche vers son conteneur actuel : rien", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onMoveTask(6, { key: `zone:${Z2A}`, zoneKey: Z2A, zoneName: "Zone Z2A", floorKey: "", floorName: "", label: "" });
  assert.equal(env.writes.length, 0);
});

test("ajouter une tâche dans un étage : Groupe rempli, dates d'après l'étage", async () => {
  const env = setup({ rows: floorRows(), applyUserActions: () => ({ retValues: [42] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(Z2A, "phrdb");
  assert.deepEqual(env.writes[0], [["AddRecord", "Planning_Projet", null, {
    Taches: "Nouvelle tâche",
    Diff_coffrage: "2026-10-26",
    Diff_armature: "2026-10-26",
    Duree_1: 1,
    NomProjet: "HOTEL DIEU",
    Zone: "Zone Z2A",
    Groupe: "PH RDB",
  }]]);
  assert.equal(env.lastRender().lines.find((line) => line.taskId === 42).floorKey, "phrdb");
  assert.deepEqual(env.table.editing.at(-1), { taskId: 42, field: "name" });
});

test("replier un étage masque ses tâches", async () => {
  const env = setup({ rows: floorRows() });
  await activate(env);
  env.table.callbacks.onToggleFloor(Z2A, "phrdb");
  assert.equal(env.lastRender().lines.some((line) => line.taskId === 5), false);
  assert.equal(env.lastRender().lines.find((line) => line.key === `floor:${Z2A}/phrdb`).collapsed, true);
  env.table.callbacks.onToggleFloor(Z2A, "phrdb");
  assert.equal(env.lastRender().lines.some((line) => line.taskId === 5), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseTasksController.test.mjs"`
Expected: FAIL des 10 nouveaux tests (`onAddFloor`, `onRenameFloor`, `onDeleteFloor`, `onMoveTask`, `onToggleFloor` absents ; `canAddFloor` absent des options).

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/ui/syntheseTasksController.js` (version de la Task 4) :

1. Remplace le bloc d'import par :

```js
import {
  NO_ZONE_KEY,
  PLANNING_TABLE,
  TASK_COLUMNS,
  applyTaskEdit,
  buildFloorDeleteActions,
  buildFloorDeleteQuestion,
  buildFloorFields,
  buildFloorRenameActions,
  buildMoveFields,
  buildNewTask,
  buildRowModel,
  buildSections,
  buildTaskFields,
  detectFloorColumn,
  floorCollapseKey,
  floorKeyOf,
  nextFloorName,
  validateFloorName,
} from "../services/syntheseTaskModel.js";
```

2. Dans `MESSAGES`, sous la ligne
`  contextChanged: "Le projet ou le service a changé avant l'enregistrement : recommencez.",` ajoute :

```js
  noFloorColumn: "La colonne « Etage » n'existe pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages.",
```

3. Dans `describeWriteError`, juste avant la ligne `  return "L'enregistrement dans Grist a échoué. Réessayez.";` ajoute :

```js
  // Grist refuse une colonne inconnue : seule l'écriture d'un étage utilise Etage.
  if (/\bEtage\b/.test(message)) return MESSAGES.noFloorColumn;
```

4. Sous la ligne `  const collapsedZoneKeys = new Set();` ajoute :

```js
  const collapsedFloorKeys = new Set();
  // Colonne Etage : true / false d'après les lignes lues, null tant qu'on ne sait pas.
  let floorColumn = null;
```

5. Remplace tout le bloc `  const table = createTable({ … });` par :

```js
  const table = createTable({
    onEdit: (taskId, field, rawValue) => handleEdit(taskId, field, rawValue),
    onRenameFloor: (zoneKey, floorKey, rawValue) => handleRenameFloor(zoneKey, floorKey, rawValue),
    onAddTask: (zoneKey, floorKey = "") => handleAddTask(zoneKey, floorKey),
    onAddFloor: (zoneKey) => handleAddFloor(zoneKey),
    onDeleteTask: (taskId) => handleDeleteTask(taskId),
    onDeleteFloor: (zoneKey, floorKey) => handleDeleteFloor(zoneKey, floorKey),
    onMoveTask: (taskId, target) => handleMoveTask(taskId, target),
    onToggleZone: (zoneKey) => toggleZone(zoneKey),
    onToggleFloor: (zoneKey, floorKey) => toggleFloor(zoneKey, floorKey),
    onLockedAttempt: () => setStatus(lockedMessage(), "error"),
  });
```

6. Dans `render()`, remplace `    const lines = buildRowModel(sections, { collapsedZoneKeys });` par
`    const lines = buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys });` et
`    table.render(lines, { editable: isEditable(), emptyMessage });` par
`    table.render(lines, { editable: isEditable(), emptyMessage, canAddFloor: floorColumn !== false });`.

7. Dans `load()`, sous `      collapsedZoneKeys.clear();` ajoute :

```js
      collapsedFloorKeys.clear();
      floorColumn = null;
```

et sous `    rows = Array.isArray(nextRows) ? nextRows : [];` ajoute :

```js
    floorColumn = detectFloorColumn(rows);
```

8. Remplace toute la fonction `function handleAddTask(zoneKey) { … }` par :

```js
  function findFloor(section, floorKey) {
    return section?.floors.find((floor) => floor.key === floorKey) || null;
  }

  // Nouvelle tâche dans un groupe : l'étage floorKey, ou le niveau zone ("").
  function handleAddTask(zoneKey, floorKey = "") {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    const floor = floorKey ? findFloor(section, floorKey) : null;
    if (!project || !section || (floorKey && !floor)) return Promise.resolve();
    const groupTasks = floor
      ? floor.tasks
      : section.items.filter((item) => item.kind === "task").map((item) => item.task);
    const task = buildNewTask({
      zoneName: section.zoneName,
      groupName: floor ? floor.name : "",
      groupTasks,
      today: now(),
    });
    const fields = buildTaskFields(task, { projectName: project.name });
    const where = floor ? `l'étage « ${floor.name} »` : `« ${section.label} »`;
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(zoneKey);
        if (floor) collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floor.key));
        render();
        if (hasId) table.startEditing(newId, "name");
        info(`Tâche ajoutée dans ${where}.`);
      },
      onFailure: (error, dropped) => fail("Ajout de la tâche impossible :", error, dropped),
    });
  }
```

9. Juste après la fonction `handleDeleteTask` (après son `}`), ajoute :

```js

  function handleAddFloor(zoneKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    if (floorColumn === false) {
      setStatus(MESSAGES.noFloorColumn, "error");
      return Promise.resolve();
    }
    const project = getProject();
    const section = findSection(zoneKey);
    if (!project || !section || section.zoneKey === NO_ZONE_KEY) return Promise.resolve();
    const name = nextFloorName(section.floors);
    const fields = buildFloorFields({ name, zoneName: section.zoneName, projectName: project.name });
    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
      onSuccess: (result) => {
        const newId = Number(result?.retValues?.[0]);
        const hasId = Number.isInteger(newId) && newId > 0;
        if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
        collapsedZoneKeys.delete(zoneKey);
        render();
        if (hasId) table.startEditingFloor(zoneKey, floorKeyOf(name));
        info(`Étage ajouté dans « ${section.label} ».`);
      },
      onFailure: (error, dropped) => {
        if (describeWriteError(error) === MESSAGES.noFloorColumn) {
          floorColumn = false;
          render();
        }
        fail("Ajout de l'étage impossible :", error, dropped);
      },
    });
  }

  // Renommer : la ligne-étage et le Groupe de ses tâches changent ensemble, affichés tout de
  // suite comme une saisie.
  function handleRenameFloor(zoneKey, floorKey, rawValue) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const section = findSection(zoneKey);
    const floor = findFloor(section, floorKey);
    if (!floor) return;
    const result = validateFloorName(rawValue, { floors: section.floors, currentKey: floor.key });
    if (!result.ok) {
      setStatus(result.error, "error");
      render();
      return;
    }
    if (result.name === floor.name) {
      render();
      return;
    }
    const changes = new Map();
    floor.rowIds.forEach((rowId) => changes.set(rowId, { [TASK_COLUMNS.name]: result.name }));
    floor.tasks.forEach((task) => changes.set(task.id, { [TASK_COLUMNS.group]: result.name }));
    // Le repli suit l'étage sous son nouveau nom.
    if (collapsedFloorKeys.delete(floorCollapseKey(zoneKey, floor.key))) {
      collapsedFloorKeys.add(floorCollapseKey(zoneKey, result.key));
    }
    setStatus("", "info");
    void submit(createOp({ changes, actions: buildFloorRenameActions(floor, result.name) }), {
      onFailure: (error, dropped) => fail("Renommage de l'étage impossible :", error, dropped),
    });
  }

  function handleDeleteFloor(zoneKey, floorKey) {
    if (!isEditable()) {
      refuseLocked();
      return Promise.resolve();
    }
    const floor = findFloor(findSection(zoneKey), floorKey);
    if (!floor) return Promise.resolve();
    if (!confirm(buildFloorDeleteQuestion(floor))) return Promise.resolve();
    return submit(createOp({
      removals: [...floor.rowIds, ...floor.tasks.map((task) => task.id)],
      actions: buildFloorDeleteActions(floor),
    }), {
      onSuccess: () => info(`Étage « ${floor.name} » supprimé.`),
      onFailure: (error, dropped) => fail("Suppression de l'étage impossible :", error, dropped),
    });
  }

  // Glisser-déposer : la tâche change de zone et / ou d'étage ; le conteneur visé est déplié.
  function handleMoveTask(taskId, target) {
    if (!isEditable()) {
      refuseLocked();
      return;
    }
    const task = findTask(taskId);
    if (!task || !findRow(taskId) || !target) return;
    const fields = buildMoveFields(task, target);
    if (!Object.keys(fields).length) return;
    collapsedZoneKeys.delete(target.zoneKey);
    if (target.floorKey) collapsedFloorKeys.delete(floorCollapseKey(target.zoneKey, target.floorKey));
    setStatus("", "info");
    void submit(createOp({
      changes: new Map([[taskId, fields]]),
      actions: [["UpdateRecord", PLANNING_TABLE, taskId, fields]],
    }), {
      onFailure: (error, dropped) => fail("Déplacement de la tâche impossible :", error, dropped),
    });
  }
```

10. Juste après la fonction `toggleZone` (après son `}`), ajoute :

```js

  function toggleFloor(zoneKey, floorKey) {
    const key = floorCollapseKey(zoneKey, floorKey);
    if (collapsedFloorKeys.has(key)) collapsedFloorKeys.delete(key);
    else collapsedFloorKeys.add(key);
    render();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseTasksController.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: toute la suite + contrôle CR / marques sur les 2 fichiers.
Expected: PASS (10 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 6: Tableau — lignes d'étage, saisie du nom, menu selon la ligne, poignée

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseTaskTable.js`
- Modify: `Planning Projet/assets/css/styles.css`
- Test: `Planning Projet/tests/syntheseTaskTable.test.mjs`

**Interfaces:**
- Consumes (Task 5) : rappels `onEdit`, `onRenameFloor`, `onAddTask(zoneKey, floorKey)`, `onAddFloor`, `onDeleteTask`, `onDeleteFloor`, `onToggleZone`, `onToggleFloor`, `onLockedAttempt` ; options de rendu `{ editable, emptyMessage, canAddFloor }`.
- Produces :
  - `buildMenuItems(line, { canAddFloor }) → { label, action, … }[]` (exporté, pur) ;
  - API du tableau `{ render, startEditing, startEditingFloor, setStatus }` ;
  - éléments de ligne avec `data-line-key`, `data-zone-key`, `data-floor-key`, classe `is-in-floor` pour une tâche d'étage ;
  - poignée `.stt-grip` dans la cellule du nom d'une tâche quand le tableau est modifiable (utilisée par la Task 7).

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseTaskTable.test.mjs`, remplace
`import { createDeferredRenderer } from "../assets/js/ui/syntheseTaskTable.js";`
par
`import { buildMenuItems, createDeferredRenderer } from "../assets/js/ui/syntheseTaskTable.js";`
et ajoute à la fin du fichier :

```js
test("menu contextuel selon la ligne", () => {
  const zone = { kind: "zone", zoneKey: "zonez3a", floorKey: "" };
  assert.deepEqual(buildMenuItems(zone), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "" },
    { label: "Ajouter un étage", action: "addFloor", zoneKey: "zonez3a", disabled: false },
  ]);
  assert.equal(buildMenuItems(zone, { canAddFloor: false })[1].disabled, true);
  assert.deepEqual(buildMenuItems({ kind: "zone", zoneKey: "", floorKey: "" }).map((item) => item.action), ["addTask"]);
  assert.deepEqual(buildMenuItems({ kind: "floor", zoneKey: "zonez3a", floorKey: "phrdb" }), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb" },
    { label: "Supprimer l'étage", action: "deleteFloor", zoneKey: "zonez3a", floorKey: "phrdb", danger: true },
  ]);
  assert.deepEqual(buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "phrdb", taskId: 5 }), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb" },
    { label: "Supprimer la tâche", action: "deleteTask", taskId: 5, danger: true },
  ]);
  assert.deepEqual(buildMenuItems(null), []);
});

test("étages dans le tableau : saisie du nom, repli, poignée seulement en mode modifiable", () => {
  assert.match(source, /function startEditingFloor\(zoneKey, floorKey\)/);
  assert.match(source, /await onRenameFloor\?\.\(target\.zoneKey, target\.floorKey, value\)/);
  assert.match(source, /\{ type: "toggleFloor", zoneKey, floorKey \}/);
  assert.match(source, /if \(line\.kind === "task" && editable\) \{\s*const grip = createElement\("span", "stt-grip"/);
  assert.match(source, /startEditingFloor,\s*setStatus,/);
});

test("styles des étages, de la poignée et de l'enregistrement en cours", () => {
  assert.match(css, /--stt-floor-bg:\s*#c6e0b4;/);
  assert.match(css, /\.stt-line--floor \.stt-cell--name\s*\{[^}]*background:\s*var\(--stt-floor-bg\);/);
  assert.match(css, /\.stt-line--task\.is-in-floor \.stt-cell--name\s*\{[^}]*padding-left:\s*46px;/);
  assert.match(css, /\.stt-grip\s*\{[^}]*visibility:\s*hidden;/);
  assert.match(css, /\.stt-line--task:hover \.stt-grip\s*\{[^}]*visibility:\s*visible;/);
  assert.match(css, /\.stt-status\[data-tone="saving"\]\s*\{/);
  assert.match(css, /\.stt-menu__item\.is-disabled\s*\{/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseTaskTable.test.mjs"`
Expected: FAIL (`buildMenuItems` n'est pas exporté).

- [ ] **Step 3: Implement the table**

Dans `Planning Projet/assets/js/ui/syntheseTaskTable.js` :

1. Remplace les 5 lignes du commentaire d'en-tête du fichier (de `// Tableau de tâches de la vue Synthese, façon MS Project : en-tête collant, une ligne` à `// intentions au contrôleur.`) par :

```js
// Tableau de tâches de la vue Synthese, façon MS Project : en-tête collant, une ligne
// par entrée du modèle de lignes (zone, étage ou tâche), hauteur de ligne fixe, panneau
// droit réservé au Gantt et séparateur déplaçable. Il gère l'édition dans les cellules
// (tâches, nom des étages), le menu contextuel et les poignées de glisser, mais ne lit ni
// n'écrit jamais Grist : il signale les intentions au contrôleur.
```

2. Sous la ligne `const INFO_STATUS_DELAY_MS = 6000;` ajoute :

```js
const GRIP_GLYPH = "⠿";
```

3. Juste avant la fonction `readStoredWidth` (avant `function readStoredWidth() {`), ajoute :

```js
// Entrées du menu contextuel selon la ligne visée : zone (sauf « Sans zone ») → tâche ou
// étage ; « Sans zone » → tâche ; étage → tâche dans l'étage ou suppression de l'étage ;
// tâche → tâche dans le même groupe ou suppression de la tâche.
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
  if (line.kind === "task") {
    return [
      { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey || "" },
      { label: "Supprimer la tâche", action: "deleteTask", taskId: line.taskId, danger: true },
    ];
  }
  return [];
}

```

4. Remplace la fonction `formatCellValue` et son commentaire (de `// Une zone sans tâche datée n'a pas de récapitulatif : cellules vides. Une tâche sans` jusqu'au `}` de la fonction) par :

```js
// Une zone ou un étage sans tâche datée n'a pas de récapitulatif : cellules vides. Une
// tâche sans dates affiche « — ».
function formatCellValue(line, field) {
  if ((line.kind === "zone" || line.kind === "floor") && line.durationDays == null) return "";
  if (field === "duration") return formatDuration(line.durationDays);
  if (field === "start") return formatDate(line.start);
  return formatDate(line.end);
}
```

5. Remplace la signature :

```js
export function createSyntheseTaskTable(host, {
  onEdit,
  onAddTask,
  onDeleteTask,
  onToggleZone,
  onLockedAttempt,
} = {}, { createGantt } = {}) {
```

par :

```js
export function createSyntheseTaskTable(host, {
  onEdit,
  onRenameFloor,
  onAddTask,
  onAddFloor,
  onDeleteTask,
  onDeleteFloor,
  onToggleZone,
  onToggleFloor,
  onLockedAttempt,
} = {}, { createGantt } = {}) {
```

6. Sous la ligne `  let editable = false;` ajoute `  let canAddFloor = true;`.

7. Remplace toute la fonction `buildNameCell` par :

```js
  function buildNameCell(line) {
    const cell = createElement("div", "stt-cell stt-cell--name");
    cell.setAttribute("role", "gridcell");
    cell.dataset.field = "name";
    cell.title = line.name;
    if (line.kind === "zone" || line.kind === "floor") {
      const toggle = createElement("button", "stt-toggle", line.collapsed ? "▸" : "▾");
      toggle.type = "button";
      toggle.dataset.action = "toggle";
      // Replier / déplier n'écrit rien : bouton de navigation, que le contexte partagé laisse
      // actif en lecture seule (le nom de zone pourrait ressembler à une action d'écriture).
      toggle.dataset.serviceContextNavigation = "";
      toggle.setAttribute("aria-label", `${line.collapsed ? "Déplier" : "Replier"} ${line.name}`);
      cell.appendChild(toggle);
    }
    // Poignée pour glisser la tâche vers un autre étage ou une autre zone.
    if (line.kind === "task" && editable) {
      const grip = createElement("span", "stt-grip", GRIP_GLYPH);
      grip.setAttribute("aria-hidden", "true");
      grip.title = "Glisser pour déplacer la tâche";
      cell.appendChild(grip);
    }
    cell.appendChild(createElement("span", "stt-text", line.name));
    return cell;
  }
```

8. Remplace toute la fonction `buildLine` par :

```js
  function buildLine(line) {
    const element = createElement("div", `stt-line stt-line--${line.kind}`);
    element.setAttribute("role", "row");
    element.setAttribute("aria-level", String(line.level + 1));
    element.dataset.kind = line.kind;
    element.dataset.lineKey = line.key;
    element.dataset.zoneKey = line.zoneKey;
    element.dataset.floorKey = line.floorKey || "";
    if (line.kind === "zone" || line.kind === "floor") {
      element.setAttribute("aria-expanded", String(!line.collapsed));
    }
    if (line.kind === "task") element.dataset.taskId = String(line.taskId);
    if (line.kind === "task" && line.floorKey) element.classList.add("is-in-floor");
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
      if (editable && (line.kind === "task" || (line.kind === "floor" && field === "name"))) {
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

9. Dans `draw`, sous la ligne `    editable = Boolean(options?.editable);` ajoute
`    canAddFloor = options?.canAddFloor !== false;`.

10. Remplace tout le texte qui va de la ligne `  /* ---------- Édition dans les cellules ---------- */`
jusqu'à la ligne qui précède `  /* ---------- Menu contextuel ---------- */` (exclue) par :

```js
  /* ---------- Édition dans les cellules ---------- */

  function findCell(taskId, field) {
    return body.querySelector(`.stt-line--task[data-task-id="${taskId}"] .stt-cell--${field}`);
  }

  function findFloorCell(zoneKey, floorKey) {
    return body.querySelector(
      `.stt-line--floor[data-zone-key="${zoneKey}"][data-floor-key="${floorKey}"] .stt-cell--name`
    );
  }

  function startEditing(taskId, field) {
    if (!editable || !EDITABLE_FIELDS.includes(field)) return;
    if (editor) {
      queuedAction = { type: "edit", taskId, field };
      return;
    }
    const line = lines.find((candidate) => candidate.kind === "task" && candidate.taskId === taskId);
    const cell = findCell(taskId, field);
    if (!line || !cell) return;
    openEditor({ target: { kind: "task", taskId }, field, cell, input: createInput(field, line) });
  }

  // Nom d'un étage : même saisie que le nom d'une tâche ; la validation le renomme.
  function startEditingFloor(zoneKey, floorKey) {
    if (!editable) return;
    if (editor) {
      queuedAction = { type: "editFloor", zoneKey, floorKey };
      return;
    }
    const line = lines.find((candidate) => (
      candidate.kind === "floor" && candidate.zoneKey === zoneKey && candidate.floorKey === floorKey
    ));
    const cell = findFloorCell(zoneKey, floorKey);
    if (!line || !cell) return;
    openEditor({ target: { kind: "floor", zoneKey, floorKey }, field: "name", cell, input: createInput("name", line) });
  }

  function createInput(field, line) {
    const input = document.createElement("input");
    input.className = "stt-input";
    if (field === "name") {
      input.type = "text";
      input.maxLength = 200;
      input.value = line.name;
    } else if (field === "duration") {
      // Texte et non « number » : la molette sur un champ numérique actif changerait la
      // valeur au lieu de faire défiler le tableau.
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.value = line.durationDays == null ? "" : String(line.durationDays);
    } else {
      input.type = "date";
      input.value = toInputDate(line[field]);
    }
    input.setAttribute(
      "aria-label",
      line.kind === "floor" ? "Nom de l'étage" : COLUMNS.find((column) => column.field === field).label
    );
    return input;
  }

  function openEditor({ target, field, cell, input }) {
    editor = { target, field, input, cell, initialValue: input.value, finalized: false };
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
    const { target } = current;
    // Le contrôleur affiche la saisie et l'enregistre en arrière-plan : on enchaîne tout de
    // suite, sans bloquer le clavier.
    if (commit && value !== current.initialValue) {
      try {
        if (target.kind === "floor") await onRenameFloor?.(target.zoneKey, target.floorKey, value);
        else await onEdit?.(target.taskId, current.field, value);
      } catch (error) {
        console.error("Saisie de tâche non enregistrée :", error);
      }
    }
    editor = null;
    renderer.endEditing();

    const queued = queuedAction;
    queuedAction = null;
    const nextIndex = EDITABLE_FIELDS.indexOf(current.field) + move;
    if (target.kind === "task" && move && nextIndex >= 0 && nextIndex < EDITABLE_FIELDS.length) {
      startEditing(target.taskId, EDITABLE_FIELDS[nextIndex]);
    } else if (queued) {
      runAction(queued);
    } else if (refocus) {
      const cell = target.kind === "floor"
        ? findFloorCell(target.zoneKey, target.floorKey)
        : findCell(target.taskId, current.field);
      cell?.focus();
    }
  }

```

11. Remplace toute la fonction `openMenu` (de `  function openMenu(lineElement, clientX, clientY) {` jusqu'à son `}` de fin, juste avant `  menu.addEventListener("keydown", (event) => {`) par :

```js
  function runMenuItem(item) {
    if (item.action === "addTask") return onAddTask?.(item.zoneKey, item.floorKey);
    if (item.action === "addFloor") return onAddFloor?.(item.zoneKey);
    if (item.action === "deleteFloor") return onDeleteFloor?.(item.zoneKey, item.floorKey);
    if (item.action === "deleteTask") return onDeleteTask?.(item.taskId);
    return undefined;
  }

  function openMenu(lineElement, clientX, clientY) {
    if (!editable) {
      onLockedAttempt?.();
      return;
    }
    const line = lines.find((candidate) => candidate.key === lineElement.dataset.lineKey);
    const items = buildMenuItems(line, { canAddFloor });
    if (!items.length) return;
    menu.replaceChildren(...items.map((item) => {
      const classes = ["stt-menu__item"];
      if (item.danger) classes.push("is-danger");
      if (item.disabled) classes.push("is-disabled");
      const button = createElement("button", classes.join(" "), item.label);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      // Grisée mais cliquable : le contrôleur explique pourquoi l'action est impossible.
      if (item.disabled) button.setAttribute("aria-disabled", "true");
      button.addEventListener("click", () => {
        closeMenu();
        void runMenuItem(item);
      });
      return button;
    }));
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY, window.innerHeight - rect.height - 4))}px`;
    menu.querySelector("button")?.focus();
  }
```

12. Remplace tout le texte qui va de la ligne `  /* ---------- Souris et clavier sur les lignes ---------- */`
jusqu'à la ligne qui précède `  /* ---------- Séparateur ---------- */` (exclue) par :

```js
  /* ---------- Souris et clavier sur les lignes ---------- */

  // Action d'un appui, d'un clic ou d'une touche sur une ligne : replier / déplier une zone
  // ou un étage, ou ouvrir la saisie d'une cellule de tâche ou du nom d'un étage.
  function actionAt(target, lineElement) {
    const { kind = "", zoneKey = "", floorKey = "" } = lineElement.dataset;
    if (target.closest('[data-action="toggle"]')) {
      return kind === "floor" ? { type: "toggleFloor", zoneKey, floorKey } : { type: "toggle", zoneKey };
    }
    const cell = target.closest(".stt-cell[data-field]");
    if (!cell || cell.classList.contains("is-editing")) return null;
    if (kind === "task") return { type: "edit", taskId: Number(lineElement.dataset.taskId), field: cell.dataset.field };
    if (kind === "floor" && cell.dataset.field === "name") return { type: "editFloor", zoneKey, floorKey };
    return null;
  }

  function runAction(action) {
    if (action.type === "edit") startEditing(action.taskId, action.field);
    else if (action.type === "editFloor") startEditingFloor(action.zoneKey, action.floorKey);
    else if (action.type === "toggle") onToggleZone?.(action.zoneKey);
    else if (action.type === "toggleFloor") onToggleFloor?.(action.zoneKey, action.floorKey);
  }

  // Un appui ailleurs pendant une saisie la ferme (perte du focus) et redessine le
  // tableau avant l'arrivée du click, que le navigateur perd alors. L'action est donc
  // mémorisée dès l'appui et rejouée à la fermeture de la saisie ; le click qui suit,
  // s'il arrive, est ignoré pour ne pas la jouer deux fois. La poignée de glisser n'est
  // pas une action de ligne.
  body.addEventListener("pointerdown", (event) => {
    ignoreNextClick = false;
    if (!editor || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement || target.closest(".stt-grip")) return;
    const action = actionAt(target, lineElement);
    if (!action) return;
    queuedAction = action;
    ignoreNextClick = true;
  });

  body.addEventListener("click", (event) => {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement || target.closest(".stt-grip")) return;
    const action = actionAt(target, lineElement);
    if (!action) return;
    if ((action.type === "edit" || action.type === "editFloor") && !editable) {
      onLockedAttempt?.();
      return;
    }
    runAction(action);
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
    if (event.key === "Enter" || event.key === "F2") {
      const action = actionAt(cell, lineElement);
      if (action?.type !== "edit" && action?.type !== "editFloor") return;
      event.preventDefault();
      if (!editable) {
        onLockedAttempt?.();
        return;
      }
      runAction(action);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      openMenu(lineElement, rect.left + 8, rect.bottom);
    }
  });

```

13. Dans l'objet renvoyé à la fin de `createSyntheseTaskTable`, remplace

```js
    startEditing,
    setStatus,
```

par

```js
    startEditing,
    startEditingFloor,
    setStatus,
```

- [ ] **Step 4: Implement the styles**

Dans `Planning Projet/assets/css/styles.css` :

1. Dans la règle `.stt { … }`, sous la ligne `  --stt-zone-bg: #5a8a3c;` ajoute `  --stt-floor-bg: #c6e0b4;`.

2. Juste après la règle

```css
.stt-line--task .stt-cell--name {
  padding-left: 30px;
}
```

ajoute :

```css

.stt-line--floor .stt-cell {
  font-weight: 700;
}

.stt-line--floor .stt-cell--name {
  gap: 4px;
  padding-left: 16px;
  background: var(--stt-floor-bg);
  color: #1f1f1f;
}

.stt-line--task.is-in-floor .stt-cell--name {
  padding-left: 46px;
}

/* Poignée de glisser d'une tâche, visible au survol ; placée dans le retrait du nom. */
.stt-grip {
  flex: 0 0 auto;
  width: 12px;
  margin-left: -16px;
  margin-right: 4px;
  color: #8a8a8a;
  font-size: 12px;
  line-height: 1;
  cursor: grab;
  user-select: none;
  visibility: hidden;
}

.stt-line--task:hover .stt-grip {
  visibility: visible;
}
```

3. Juste après la règle `.stt-status[data-tone="error"] { … }` ajoute :

```css

.stt-status[data-tone="saving"] {
  color: #555555;
  font-style: italic;
}
```

4. Juste après la règle `.stt-menu__item.is-danger { … }` ajoute :

```css

.stt-menu__item.is-disabled {
  color: #9ca3af;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseTaskTable.test.mjs" "Planning Projet/tests/syntheseGanttWiring.test.mjs" "Planning Projet/tests/syntheseTasksWiring.test.mjs"` puis `node --check "Planning Projet/assets/js/ui/syntheseTaskTable.js"`
Expected: PASS (les tests de source existants — `input.type = "text";\s*input.inputMode = "numeric";` entre `function startEditing(` et `async function finishEditing(`, `toggle.dataset.serviceContextNavigation = "";`, branchement du Gantt — restent verts) ; aucune erreur de syntaxe.

- [ ] **Step 6: Checkpoint (pas de commit)**

Run: toute la suite + contrôle CR / marques sur les 3 fichiers.
Expected: PASS (3 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 7: Glisser-déposer des tâches

**Files:**
- Create: `Planning Projet/assets/js/ui/syntheseTaskDrag.js`
- Create: `Planning Projet/tests/helpers/fakeDom.mjs`
- Create: `Planning Projet/tests/syntheseTaskDrag.test.mjs`
- Modify: `Planning Projet/assets/js/ui/syntheseTaskTable.js` (branchement)
- Modify: `Planning Projet/assets/css/styles.css`
- Test: `Planning Projet/tests/syntheseTaskTable.test.mjs`

**Interfaces:**
- Consumes (Tasks 3, 5, 6) : `containerKeyOf(line)`, `resolveDropTarget(line)`, rappel `onMoveTask(taskId, target)`, poignées `.stt-grip` dans des lignes `.stt-line` portant `data-kind` et `data-task-id`, attribut `data-line-key` des lignes.
- Produces :
  - `lineIndexAt(clientY, bodyTop, rowHeight, count) → number` (-1 hors des lignes) ;
  - `createTaskDrag({ root, scroller, body, rowHeight, headHeight, getLines, isEnabled, highlight, onDrop, doc, win }) → { cancel() }` ;
  - constantes `DRAG_THRESHOLD_PX = 4`, `AUTO_SCROLL_EDGE_PX = 24`, `AUTO_SCROLL_STEP_PX = 12`.

- [ ] **Step 1: Write the fake DOM helper and the failing tests**

Crée `Planning Projet/tests/helpers/fakeDom.mjs` :

```js
// DOM minimal pour tester les modules d'interface sous Node : arbre, classes, dataset,
// écouteurs, capture du pointeur, rectangles réglables, images d'animation à la main.
export class FakeElement {
  constructor(tag = "div", className = "") {
    this.tagName = String(tag).toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set(String(className).split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
    this.dataset = {};
    this.style = {};
    this.textContent = "";
    this.scrollTop = 0;
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    this.captures = new Set();
  }

  get className() {
    return [...this.classes].join(" ");
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }

  closest(selector) {
    const name = selector.replace(/^\./, "");
    for (let node = this; node; node = node.parentNode) {
      if (node.classes?.has(name)) return node;
    }
    return null;
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  setPointerCapture(pointerId) {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
  }
}

// Évènement qui remonte de la cible jusqu'à la racine, comme dans le navigateur.
export function dispatch(target, type, init = {}) {
  const event = {
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...init,
  };
  for (let node = target; node; node = node.parentNode) {
    (node.listeners.get(type) || []).forEach((listener) => listener(event));
  }
  return event;
}

// Document et fenêtre factices : createElement, écouteurs, images d'animation lancées à la main.
export function createFakeEnvironment() {
  const doc = new FakeElement("#document");
  doc.createElement = (tag) => new FakeElement(tag);
  const frames = new Map();
  let nextFrame = 1;
  const win = {
    requestAnimationFrame(callback) {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  return {
    doc,
    win,
    frames,
    runFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
```

Crée `Planning Projet/tests/syntheseTaskDrag.test.mjs` :

```js
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";
import { AUTO_SCROLL_STEP_PX, createTaskDrag, lineIndexAt } from "../assets/js/ui/syntheseTaskDrag.js";

const ROW = 26;
// Zone Z3A : une tâche au niveau zone, l'étage PH RDB et ses deux tâches.
const LINES = [
  { key: "zone:zonez3a", kind: "zone", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" },
  { key: "task:1", kind: "task", taskId: 1, name: "Jalon démarrage GO", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" },
  { key: "floor:zonez3a/phrdb", kind: "floor", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" },
  { key: "task:2", kind: "task", taskId: 2, name: "FOND DE PLAN", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" },
  { key: "task:3", kind: "task", taskId: 3, name: "Visa MOE", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" },
];
// Centre vertical de la ligne `index` (le corps commence en y = 100).
const rowY = (index) => 100 + index * ROW + ROW / 2;

afterEach(() => {
  delete globalThis.Element;
});

// (Re)construit les lignes du corps, comme un redessin du tableau ; renvoie les poignées.
function buildBody(body) {
  body.children = [];
  const grips = new Map();
  LINES.forEach((line) => {
    const element = body.appendChild(new FakeElement("div", `stt-line stt-line--${line.kind}`));
    element.dataset.kind = line.kind;
    if (line.kind !== "task") return;
    element.dataset.taskId = String(line.taskId);
    const cell = element.appendChild(new FakeElement("div", "stt-cell stt-cell--name"));
    grips.set(line.taskId, cell.appendChild(new FakeElement("span", "stt-grip")));
  });
  return grips;
}

function setup({ enabled = true } = {}) {
  globalThis.Element = FakeElement;
  const env = createFakeEnvironment();
  const root = new FakeElement("div", "stt");
  const scroller = root.appendChild(new FakeElement("div", "stt-scroll"));
  // En-tête collant de 32 px : les lignes commencent en y = 100 ; bas du conteneur en y = 368.
  scroller.rect = { left: 0, top: 68, width: 600, height: 300 };
  const body = scroller.appendChild(new FakeElement("div", "stt-body"));
  body.rect = { left: 0, top: 100, width: 600, height: LINES.length * ROW };
  const grips = buildBody(body);
  const drops = [];
  const highlights = [];
  createTaskDrag({
    root,
    scroller,
    body,
    rowHeight: ROW,
    headHeight: 32,
    getLines: () => LINES,
    isEnabled: () => enabled,
    highlight: (key) => highlights.push(key),
    onDrop: (taskId, target) => drops.push({ taskId, target }),
    doc: env.doc,
    win: env.win,
  });
  const ghost = () => root.children.find((node) => node.classes.has("stt-drag-ghost")) || null;
  return { env, root, scroller, body, grips, drops, highlights, ghost };
}

// Appui à x = 20 ; les mouvements se font par défaut à x = 30 (au-delà du seuil de 4 px).
const press = (grip, y) => dispatch(grip, "pointerdown", { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: y });
const move = (scroller, y, { x = 30, buttons = 1 } = {}) => dispatch(scroller, "pointermove", { pointerId: 1, buttons, clientX: x, clientY: y });
const release = (scroller, y, { x = 30 } = {}) => dispatch(scroller, "pointerup", { pointerId: 1, buttons: 0, clientX: x, clientY: y });

test("ligne sous le pointeur d'après la position verticale", () => {
  assert.equal(lineIndexAt(100, 100, ROW, 5), 0);
  assert.equal(lineIndexAt(125.9, 100, ROW, 5), 0);
  assert.equal(lineIndexAt(126, 100, ROW, 5), 1);
  assert.equal(lineIndexAt(99, 100, ROW, 5), -1);
  assert.equal(lineIndexAt(230, 100, ROW, 5), -1);
});

test("un simple clic sur la poignée ne déplace rien", () => {
  const { scroller, grips, drops, root, ghost } = setup();
  press(grips.get(1), rowY(1));
  assert.equal(scroller.captures.has(1), true);
  move(scroller, rowY(1) + 2, { x: 22 });
  release(scroller, rowY(1) + 2, { x: 22 });
  assert.equal(drops.length, 0);
  assert.equal(ghost(), null);
  assert.equal(root.classes.has("is-dragging"), false);
  assert.equal(scroller.captures.has(1), false);
});

test("glisser une tâche de zone sur une tâche d'étage : étiquette, surlignage, dépôt dans l'étage", () => {
  const { scroller, grips, drops, root, highlights, ghost } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  assert.equal(root.classes.has("is-dragging"), true);
  assert.equal(ghost().textContent, "Jalon démarrage GO — Déplacer dans « PH RDB »");
  assert.equal(highlights.at(-1), "floor:zonez3a/phrdb");
  release(scroller, rowY(3));
  assert.deepEqual(drops.map((drop) => [drop.taskId, drop.target.key]), [[1, "floor:zonez3a/phrdb"]]);
  assert.equal(ghost(), null);
  assert.equal(highlights.at(-1), null);
  assert.equal(root.classes.has("is-dragging"), false);
});

test("lâcher dans son conteneur actuel ou hors des lignes : rien", () => {
  const { scroller, grips, drops, highlights } = setup();
  press(grips.get(2), rowY(3));
  move(scroller, rowY(2));
  assert.equal(highlights.at(-1), null, "l'étage de la tâche : même conteneur");
  move(scroller, rowY(6));
  assert.equal(highlights.at(-1), null, "sous la dernière ligne");
  release(scroller, rowY(6));
  assert.equal(drops.length, 0);
});

test("Échap annule le glisser", () => {
  const { env, scroller, grips, drops, root } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  const escape = dispatch(env.doc, "keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(root.classes.has("is-dragging"), false);
  release(scroller, rowY(3));
  assert.equal(drops.length, 0);
});

test("près du bas de la liste, elle défile d'elle-même", () => {
  const { env, scroller, grips } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, 360);
  assert.equal(env.frames.size, 1);
  env.runFrames();
  assert.equal(scroller.scrollTop, AUTO_SCROLL_STEP_PX);
  assert.equal(env.frames.size, 1, "toujours au bord : le défilement continue");
  move(scroller, rowY(2));
  env.runFrames();
  assert.equal(scroller.scrollTop, AUTO_SCROLL_STEP_PX, "loin du bord : il s'arrête");
});

// Review Focus 4 : une relecture de Grist reconstruit le corps pendant le glisser.
test("un redessin du tableau pendant le glisser ne l'interrompt pas", () => {
  const { scroller, body, grips, drops } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(4));
  buildBody(body);
  move(scroller, rowY(4));
  release(scroller, rowY(4));
  assert.deepEqual(drops.map((drop) => [drop.taskId, drop.target.key]), [[1, "floor:zonez3a/phrdb"]]);
});

test("tableau non modifiable : la poignée ne glisse pas", () => {
  const { scroller, grips, drops, root } = setup({ enabled: false });
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  release(scroller, rowY(3));
  assert.equal(drops.length, 0);
  assert.equal(root.classes.has("is-dragging"), false);
  assert.equal(scroller.captures.size, 0);
});

test("bouton relâché hors de la fenêtre : le glisser s'arrête sans dépôt", () => {
  const { scroller, grips, drops, root } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  move(scroller, rowY(4), { buttons: 0 });
  assert.equal(root.classes.has("is-dragging"), false);
  release(scroller, rowY(4));
  assert.equal(drops.length, 0);
});
```

Dans `Planning Projet/tests/syntheseTaskTable.test.mjs`, ajoute à la fin :

```js
test("le tableau branche le glisser-déposer sur le déplacement de tâche", () => {
  assert.match(source, /import \{ createTaskDrag \} from "\.\/syntheseTaskDrag\.js";/);
  assert.match(source, /onDrop: \(taskId, target\) => onMoveTask\?\.\(taskId, target\),/);
  assert.match(source, /isEnabled: \(\) => editable,/);
  assert.match(source, /if \(line\.key === dropTargetKey\) element\.classList\.add\("is-drop-target"\);/);
  assert.match(css, /\.stt-drag-ghost\s*\{[^}]*position:\s*fixed;/);
  assert.match(css, /\.stt-line\.is-drop-target \.stt-cell--name\s*\{/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseTaskDrag.test.mjs" "Planning Projet/tests/syntheseTaskTable.test.mjs"`
Expected: FAIL (module `syntheseTaskDrag.js` introuvable ; branchement absent du tableau).

- [ ] **Step 3: Implement the drag module**

Crée `Planning Projet/assets/js/ui/syntheseTaskDrag.js` :

```js
// Glisser-déposer des tâches du tableau Synthese : on attrape une tâche par sa poignée et
// on la lâche sur une zone, un étage ou une autre tâche ; la ligne visée se déduit de la
// position verticale du pointeur (hauteur de ligne fixe), pas de l'élément survolé, si
// bien qu'un redessin du tableau pendant le glisser ne le perturbe pas. Le module ne
// décide que de la cible : le déplacement lui-même est confié à onDrop.
import { containerKeyOf, resolveDropTarget } from "../services/syntheseTaskModel.js";

export const DRAG_THRESHOLD_PX = 4;
export const AUTO_SCROLL_EDGE_PX = 24;
export const AUTO_SCROLL_STEP_PX = 12;

// Rang de la ligne sous le pointeur, ou -1 hors des lignes.
export function lineIndexAt(clientY, bodyTop, rowHeight, count) {
  const index = Math.floor((clientY - bodyTop) / rowHeight);
  return index >= 0 && index < count ? index : -1;
}

export function createTaskDrag({
  root,
  scroller,
  body,
  rowHeight,
  headHeight = 0,
  getLines = () => [],
  isEnabled = () => true,
  highlight = () => {},
  onDrop = () => {},
  doc = document,
  win = window,
} = {}) {
  let drag = null;
  let ghost = null;
  let scrollFrame = 0;

  function onKeyDown(event) {
    if (event.key !== "Escape" || !drag) return;
    event.preventDefault();
    finish();
  }

  function begin() {
    drag.started = true;
    ghost = doc.createElement("div");
    ghost.className = "stt-drag-ghost";
    root.appendChild(ghost);
    root.classList.add("is-dragging");
    doc.addEventListener("keydown", onKeyDown, true);
  }

  // Défilement automatique quand le pointeur approche du haut (sous l'en-tête) ou du bas.
  function updateAutoScroll() {
    const rect = scroller.getBoundingClientRect();
    if (drag.clientY < rect.top + headHeight + AUTO_SCROLL_EDGE_PX) drag.scrollDirection = -1;
    else if (drag.clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) drag.scrollDirection = 1;
    else drag.scrollDirection = 0;
    if (drag.scrollDirection && !scrollFrame) scrollFrame = win.requestAnimationFrame(autoScroll);
  }

  function autoScroll() {
    scrollFrame = 0;
    if (!drag?.started || !drag.scrollDirection) return;
    scroller.scrollTop += drag.scrollDirection * AUTO_SCROLL_STEP_PX;
    update();
  }

  function update() {
    const lines = getLines();
    const index = lineIndexAt(drag.clientY, body.getBoundingClientRect().top, rowHeight, lines.length);
    const target = index >= 0 ? resolveDropTarget(lines[index]) : null;
    drag.target = target && target.key !== drag.sourceKey ? target : null;
    ghost.textContent = drag.target ? `${drag.name} — ${drag.target.label}` : drag.name;
    ghost.style.left = `${drag.clientX + 12}px`;
    ghost.style.top = `${drag.clientY + 12}px`;
    highlight(drag.target ? drag.target.key : null);
    updateAutoScroll();
  }

  function finish() {
    if (!drag) return;
    const { pointerId, started } = drag;
    drag = null;
    if (scrollFrame) win.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    try {
      scroller.releasePointerCapture(pointerId);
    } catch (_error) {
      // Capture déjà rendue par le navigateur.
    }
    if (!started) return;
    ghost?.remove();
    ghost = null;
    root.classList.remove("is-dragging");
    highlight(null);
    doc.removeEventListener("keydown", onKeyDown, true);
  }

  // Appui sur une poignée : on suit le pointeur (capturé par le conteneur défilant, qui
  // survit aux redessins) ; le glisser ne commence qu'au-delà du seuil.
  body.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== 0 || !isEnabled()) return;
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-grip")?.closest(".stt-line");
    if (!lineElement || lineElement.dataset.kind !== "task") return;
    const taskId = Number(lineElement.dataset.taskId);
    const line = getLines().find((candidate) => candidate.kind === "task" && candidate.taskId === taskId);
    if (!line) return;
    drag = {
      pointerId: event.pointerId,
      taskId,
      name: line.name,
      sourceKey: containerKeyOf(line),
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      started: false,
      target: null,
      scrollDirection: 0,
    };
    try {
      scroller.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché : le glisser s'arrêtera au prochain mouvement.
    }
  });

  scroller.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Bouton relâché sans pointerup (changement de fenêtre) : fin du glisser, sans dépôt.
    if (!(event.buttons & 1)) {
      finish();
      return;
    }
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return;
      begin();
    }
    update();
  });

  scroller.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { started, target, taskId } = drag;
    finish();
    if (started && target) onDrop(taskId, target);
  });

  const cancel = (event) => {
    if (drag && event.pointerId === drag.pointerId) finish();
  };
  scroller.addEventListener("pointercancel", cancel);
  scroller.addEventListener("lostpointercapture", cancel);

  return { cancel: finish };
}
```

- [ ] **Step 4: Wire it in the table**

Dans `Planning Projet/assets/js/ui/syntheseTaskTable.js` :

1. Sous la ligne `import { formatDate, formatDuration } from "../services/syntheseTaskModel.js";` ajoute :

```js
import { createTaskDrag } from "./syntheseTaskDrag.js";
```

2. Sous la ligne `const ROW_HEIGHT_PX = 26;` ajoute :

```js
// Hauteur de l'en-tête collant, identique à --stt-head-height (styles.css).
const HEAD_HEIGHT_PX = 32;
```

3. Dans la signature de `createSyntheseTaskTable`, sous `  onDeleteFloor,` ajoute `  onMoveTask,`.

4. Sous la ligne `  let canAddFloor = true;` ajoute `  let dropTargetKey = null;`.

5. Dans `buildLine`, sous la ligne `    if (line.isMilestone) element.classList.add("is-milestone");` ajoute :

```js
    if (line.key === dropTargetKey) element.classList.add("is-drop-target");
```

6. Juste avant la ligne `  /* ---------- Séparateur ---------- */` ajoute :

```js
  /* ---------- Glisser-déposer des tâches ---------- */

  // Surligne l'en-tête du conteneur visé (zone ou étage) ; réappliqué à chaque redessin.
  function highlightDropTarget(key) {
    if (key === dropTargetKey) return;
    if (dropTargetKey) body.querySelector(`[data-line-key="${dropTargetKey}"]`)?.classList.remove("is-drop-target");
    dropTargetKey = key;
    if (key) body.querySelector(`[data-line-key="${key}"]`)?.classList.add("is-drop-target");
  }

  createTaskDrag({
    root,
    scroller,
    body,
    rowHeight: ROW_HEIGHT_PX,
    headHeight: HEAD_HEIGHT_PX,
    getLines: () => lines,
    isEnabled: () => editable,
    highlight: highlightDropTarget,
    onDrop: (taskId, target) => onMoveTask?.(taskId, target),
  });

```

- [ ] **Step 5: Styles**

Dans `Planning Projet/assets/css/styles.css`, juste avant le commentaire
`/* Diagramme de Gantt (panneau droit) : couche SVG alignée sur les lignes du tableau,`
ajoute :

```css
/* Glisser-déposer d'une tâche : étiquette qui suit le pointeur, conteneur visé surligné. */
.stt.is-dragging,
.stt.is-dragging * {
  cursor: grabbing !important;
  user-select: none;
}

.stt-drag-ghost {
  position: fixed;
  z-index: 1001;
  max-width: 360px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #1f1f1f;
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.stt-line.is-drop-target .stt-cell--name {
  outline: 2px solid var(--stt-accent);
  outline-offset: -2px;
}

```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseTaskDrag.test.mjs" "Planning Projet/tests/syntheseTaskTable.test.mjs"` puis `node --check "Planning Projet/assets/js/ui/syntheseTaskDrag.js" && node --check "Planning Projet/assets/js/ui/syntheseTaskTable.js"`
Expected: PASS ; aucune erreur de syntaxe.

- [ ] **Step 7: Checkpoint (pas de commit)**

Run: toute la suite (le motif `"Planning Projet/tests/"*.test.mjs` n'inclut pas `tests/helpers/`) + contrôle CR / marques sur les 6 fichiers.
Expected: PASS (10 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 8: Géométrie du Gantt — crochets d'étage et flèches

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseGanttGeometry.js`
- Test: `Planning Projet/tests/syntheseGanttGeometry.test.mjs`

**Interfaces:**
- Consumes (Task 2) : lignes `kind: "floor"` avec récapitulatif et drapeaux de jalon ; lignes de tâche avec `zoneKey`, `floorKey`.
- Produces :
  - forme `{ type: "floorBracket", row, key, y, x1, x2, label }` dans `buildGanttShapes` ;
  - `buildGanttLinks(lines, scale, { rowHeight }) → { fromRow, toRow, points: [x, y][], head: { x, y, direction: "down" | "right" } }[]` ;
  - constantes exportées `TASK_BAR_HEIGHT_PX = 14`, `MILESTONE_HALF_PX = 6`, `LINK_GAP_PX = 6` (reprises par la Task 9).

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseGanttGeometry.test.mjs`, ajoute `buildGanttLinks,` à la liste d'import (entre `DAY_MS,` et `buildGanttShapes,`), puis ajoute à la fin du fichier :

```js
test("étage : crochet du Début à la Fin, mêmes règles de jalon que la zone", () => {
  const shapes = buildGanttShapes([
    line({ kind: "floor", key: "floor:z/f", name: "PH RDB", start: day(2026, 9, 14), end: day(2026, 9, 16), durationDays: 3 }),
    line({
      kind: "floor",
      key: "floor:z/g",
      name: "PH RDH",
      start: day(2026, 9, 15),
      end: day(2026, 9, 17),
      startsWithMilestone: true,
      endsWithMilestone: true,
    }),
    line({ kind: "floor", key: "floor:z/h", name: "Vide" }),
  ], WEEK);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.row, shape.x1, shape.x2, shape.label]), [
    ["floorBracket", 0, 0, 300, "PH RDB"],
    ["floorBracket", 1, 150, 350, "PH RDH"],
  ]);
});

const groupTask = (id, start, end, fields = {}) => line({
  key: `task:${id}`,
  taskId: id,
  zoneKey: "z",
  floorKey: "f",
  start,
  end,
  durationDays: 1,
  ...fields,
});

test("flèches : vers la tâche datée juste en dessous, du même groupe seulement", () => {
  const links = buildGanttLinks([
    line({ kind: "floor", key: "floor:z/f", zoneKey: "z", floorKey: "f", start: day(2026, 9, 14), end: day(2026, 9, 18) }),
    groupTask(1, day(2026, 9, 14), day(2026, 9, 15)),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16)),
    groupTask(3, null, null),
    groupTask(4, day(2026, 9, 17), day(2026, 9, 17)),
    groupTask(5, day(2026, 9, 18), day(2026, 9, 18), { floorKey: "g" }),
    groupTask(6, day(2026, 9, 18), day(2026, 9, 18), { floorKey: "" }),
    line({ kind: "floor", key: "floor:z/g", zoneKey: "z", floorKey: "g", start: day(2026, 9, 18), end: day(2026, 9, 18) }),
    groupTask(7, day(2026, 9, 18), day(2026, 9, 18), { floorKey: "" }),
  ], WEEK);
  assert.deepEqual(links.map((link) => [link.fromRow, link.toRow]), [[1, 2]]);
});

test("flèche simple : du bout de la tâche, puis vers le bas sur le début de la suivante", () => {
  const [link] = buildGanttLinks([
    groupTask(1, day(2026, 9, 14), day(2026, 9, 15)),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16)),
  ], WEEK);
  assert.deepEqual(link.points, [[200, 13], [200, 13], [200, 32]]);
  assert.deepEqual(link.head, { x: 200, y: 32, direction: "down" });
});

test("détour en S quand la suivante commence avant la fin de la précédente", () => {
  const [link] = buildGanttLinks([
    groupTask(1, day(2026, 9, 14), day(2026, 9, 16)),
    groupTask(2, day(2026, 9, 15), day(2026, 9, 17)),
  ], WEEK);
  assert.deepEqual(link.points, [[300, 13], [306, 13], [306, 26], [94, 26], [94, 39], [100, 39]]);
  assert.deepEqual(link.head, { x: 100, y: 39, direction: "right" });
});

test("jalons : départ de la pointe droite du losange, arrivée sur son sommet", () => {
  const [fromMilestone] = buildGanttLinks([
    groupTask(1, day(2026, 9, 15), day(2026, 9, 15), { isMilestone: true, durationDays: 0 }),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16)),
  ], WEEK);
  assert.deepEqual(fromMilestone.points, [[156, 13], [200, 13], [200, 32]]);
  const [toMilestone] = buildGanttLinks([
    groupTask(1, day(2026, 9, 14), day(2026, 9, 14)),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16), { isMilestone: true, durationDays: 0 }),
  ], WEEK);
  assert.deepEqual(toMilestone.points, [[100, 13], [250, 13], [250, 33]]);
  assert.deepEqual(toMilestone.head, { x: 250, y: 33, direction: "down" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseGanttGeometry.test.mjs"`
Expected: FAIL (`buildGanttLinks` n'est pas exporté).

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/services/syntheseGanttGeometry.js` :

1. Sous la ligne `export const MIN_PX_PER_DAY_FOR_OFF_DAYS = 6;` ajoute :

```js
// Formes dans une ligne de 26 px (partagées avec le dessin) et écart des flèches.
export const TASK_BAR_HEIGHT_PX = 14;
export const MILESTONE_HALF_PX = 6;
export const LINK_GAP_PX = 6;
```

2. Dans `buildGanttShapes`, remplace le bloc :

```js
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
```

par :

```js
    // Zone (barre noire) et étage (crochet) : du Début à la Fin du récapitulatif, au centre
    // du jour quand il commence ou finit par un jalon.
    if (line.kind === "zone" || line.kind === "floor") {
      const from = line.startsWithMilestone ? dayCenter(line.start) : dayStart(line.start);
      const to = line.endsWithMilestone ? dayCenter(line.end) : dayEnd(line.end);
      const x1 = scale.dateToX(from);
      shapes.push({
        type: line.kind === "zone" ? "zoneBar" : "floorBracket",
        row,
        key: line.key,
        y,
        x1,
        x2: Math.max(scale.dateToX(to), x1 + MIN_BAR_WIDTH_PX),
        label: line.name,
      });
      return;
    }
```

3. Juste après la fonction `buildGanttShapes` (après son `}` de fin, avant le commentaire `// Week-ends et fériés, seulement quand une journée est assez large pour être lisible.`), ajoute :

```js
function isDatedTask(line) {
  return line?.kind === "task" && line.start instanceof Date && line.end instanceof Date;
}

// Étendue horizontale d'une tâche : segment du début de son premier jour à la fin du
// dernier, ou losange ; point d'arrivée d'une flèche (début du segment, sommet du losange).
function taskSpan(line, scale) {
  if (line.isMilestone) {
    const center = scale.dateToX(dayCenter(line.start));
    return { x1: center - MILESTONE_HALF_PX, x2: center + MILESTONE_HALF_PX, entryX: center, halfHeight: MILESTONE_HALF_PX };
  }
  const x1 = scale.dateToX(dayStart(line.start));
  return {
    x1,
    x2: Math.max(scale.dateToX(dayEnd(line.end)), x1 + MIN_BAR_WIDTH_PX),
    entryX: x1,
    halfHeight: TASK_BAR_HEIGHT_PX / 2,
  };
}

// Flèches (dessin seul) : une tâche datée vers la tâche datée juste en dessous, si les deux
// sont du même groupe (même zone et même étage, ou toutes deux au niveau zone). Tracé MS
// Project : du bout de la tâche jusqu'au début de la suivante, pointe vers le bas quand
// elle commence au même x ou après ; sinon détour en S et pointe vers la droite.
export function buildGanttLinks(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const links = [];
  (lines || []).forEach((line, row) => {
    const next = lines[row + 1];
    if (!isDatedTask(line) || !isDatedTask(next)) return;
    if (line.zoneKey !== next.zoneKey || (line.floorKey || "") !== (next.floorKey || "")) return;
    const from = taskSpan(line, scale);
    const to = taskSpan(next, scale);
    const fromY = row * rowHeight + rowHeight / 2;
    const toMiddle = (row + 1) * rowHeight + rowHeight / 2;
    if (to.entryX >= from.x2) {
      const toTop = toMiddle - to.halfHeight;
      links.push({
        fromRow: row,
        toRow: row + 1,
        points: [[from.x2, fromY], [to.entryX, fromY], [to.entryX, toTop]],
        head: { x: to.entryX, y: toTop, direction: "down" },
      });
      return;
    }
    const between = (row + 1) * rowHeight;
    links.push({
      fromRow: row,
      toRow: row + 1,
      points: [
        [from.x2, fromY],
        [from.x2 + LINK_GAP_PX, fromY],
        [from.x2 + LINK_GAP_PX, between],
        [to.x1 - LINK_GAP_PX, between],
        [to.x1 - LINK_GAP_PX, toMiddle],
        [to.x1, toMiddle],
      ],
      head: { x: to.x1, y: toMiddle, direction: "right" },
    });
  });
  return links;
}

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseGanttGeometry.test.mjs" "Planning Projet/tests/syntheseGanttScale.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: toute la suite + contrôle CR / marques sur les 2 fichiers.
Expected: PASS (5 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 9: Dessin du Gantt — crochets et flèches

**Files:**
- Modify: `Planning Projet/assets/js/ui/syntheseGantt.js`
- Modify: `Planning Projet/assets/css/styles.css`
- Test: `Planning Projet/tests/syntheseGanttEvents.test.mjs`, `Planning Projet/tests/syntheseGantt.test.mjs`

**Interfaces:**
- Consumes (Task 8) : `MILESTONE_HALF_PX`, `TASK_BAR_HEIGHT_PX`, `buildGanttLinks`, forme `floorBracket`.
- Produces : éléments SVG `polyline.stg-floor` (+ `text.stg-label` à droite), `polyline.stg-link`, `polygon.stg-link-head`, les flèches dessinées avant les barres.

- [ ] **Step 1: Write the failing tests**

Dans `Planning Projet/tests/syntheseGanttEvents.test.mjs`, ajoute à la fin :

```js
test("étages et flèches dessinés : crochet, trait et pointe, sous les barres", () => {
  const context = setup();
  const floorLine = { ...ZONE, key: "floor:a/f", kind: "floor", level: 1, floorKey: "f", floorName: "PH RDB", name: "PH RDB" };
  const first = {
    ...ZONE,
    key: "task:1",
    kind: "task",
    level: 2,
    floorKey: "f",
    taskId: 1,
    name: "Plans",
    start: day(2026, 9, 15),
    end: day(2026, 9, 15),
    durationDays: 1,
  };
  const second = { ...first, key: "task:2", taskId: 2, name: "Visa", start: day(2026, 9, 16), end: day(2026, 9, 17), durationDays: 2 };
  context.gantt.render([ZONE, floorLine, first, second]);
  context.frames.shift()();
  const classes = layerSvg(context).children.map((node) => node.getAttribute("class"));
  assert.ok(classes.includes("stg-floor"));
  assert.ok(classes.includes("stg-link"));
  assert.ok(classes.includes("stg-link-head"));
  assert.ok(classes.indexOf("stg-link") < classes.indexOf("stg-task"), "flèches sous les barres");
});
```

Dans `Planning Projet/tests/syntheseGantt.test.mjs`, ajoute à la fin :

```js
test("couleurs des crochets d'étage et des flèches", () => {
  assert.match(css, /\.stg-floor\s*\{[^}]*stroke:\s*#1f1f1f;[^}]*stroke-width:\s*1\.5;/);
  assert.match(css, /\.stg-link\s*\{[^}]*stroke:\s*#3b9bb0;/);
  assert.match(css, /\.stg-link-head\s*\{[^}]*fill:\s*#3b9bb0;/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Planning Projet/tests/syntheseGanttEvents.test.mjs" "Planning Projet/tests/syntheseGantt.test.mjs"`
Expected: FAIL (aucun crochet ni flèche dessiné ; styles absents).

- [ ] **Step 3: Implement**

Dans `Planning Projet/assets/js/ui/syntheseGantt.js` :

1. Remplace le bloc d'import depuis `../services/syntheseGanttGeometry.js` par :

```js
import {
  MILESTONE_HALF_PX,
  ROW_HEIGHT_PX,
  TASK_BAR_HEIGHT_PX,
  buildGanttLinks,
  buildGanttShapes,
  buildNonWorkingBands,
  buildScaleTiers,
  createTimeScale,
  currentWeekWindow,
  panWindow,
  todayX,
  wheelZoomSteps,
  zoomWindow,
} from "../services/syntheseGanttGeometry.js";
```

2. Supprime les deux lignes `const TASK_BAR_HEIGHT_PX = 14;` et `const MILESTONE_HALF_PX = 6;` (désormais importées), puis sous la ligne `const ZONE_CAP_PX = 6;` ajoute :

```js
const FLOOR_BRACKET_TOP_PX = 8;
const FLOOR_TICK_PX = 6;
const LINK_HEAD_PX = 4;
```

3. Dans `drawShape`, juste avant le commentaire `    // Barre de zone : trait noir, une pointe vers le bas à chaque extrémité.` ajoute :

```js
    // Étage : crochet fin, une patte vers le bas à chaque bout, nom à droite.
    if (shape.type === "floorBracket") {
      const top = shape.y + FLOOR_BRACKET_TOP_PX;
      return [
        svgElement("polyline", {
          class: "stg-floor",
          points: toPoints([
            [shape.x1, top + FLOOR_TICK_PX],
            [shape.x1, top],
            [shape.x2, top],
            [shape.x2, top + FLOOR_TICK_PX],
          ]),
        }),
        svgElement("text", { class: "stg-label", x: px(shape.x2 + LABEL_GAP_PX), y: px(baseline) }, shape.label),
      ];
    }
```

4. Juste après la fonction `drawShape` (après son `}` de fin, avant `  function drawLayer(scale, height) {`), ajoute :

```js
  // Flèche entre deux tâches : trait, puis pointe pleine vers le bas ou vers la droite.
  function drawLink(link) {
    const { x, y, direction } = link.head;
    const head = direction === "down"
      ? [[x - LINK_HEAD_PX, y - LINK_HEAD_PX], [x + LINK_HEAD_PX, y - LINK_HEAD_PX], [x, y]]
      : [[x - LINK_HEAD_PX, y - LINK_HEAD_PX], [x - LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]];
    return [
      svgElement("polyline", { class: "stg-link", points: toPoints(link.points) }),
      svgElement("polygon", { class: "stg-link-head", points: toPoints(head) }),
    ];
  }

```

5. Dans `drawLayer`, juste avant la ligne
`    buildGanttShapes(lines, scale, { rowHeight }).forEach((shape) => nodes.push(...drawShape(shape)));`
ajoute :

```js
    buildGanttLinks(lines, scale, { rowHeight }).forEach((link) => nodes.push(...drawLink(link)));
```

Dans `Planning Projet/assets/css/styles.css`, juste après la règle `.stg-date { … }` ajoute :

```css

.stg-floor {
  fill: none;
  stroke: #1f1f1f;
  stroke-width: 1.5;
}

.stg-link {
  fill: none;
  stroke: #3b9bb0;
  stroke-width: 1;
}

.stg-link-head {
  fill: #3b9bb0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Planning Projet/tests/syntheseGanttEvents.test.mjs" "Planning Projet/tests/syntheseGantt.test.mjs"` puis `node --check "Planning Projet/assets/js/ui/syntheseGantt.js"`
Expected: PASS ; aucune erreur de syntaxe.

- [ ] **Step 5: Checkpoint (pas de commit)**

Run: toute la suite + contrôle CR / marques sur les 4 fichiers.
Expected: PASS (2 tests de plus) ; `CR: 0`, `marques: 0`.

---

### Task 10: Versions et vérification finale

**Files:**
- Modify: `Planning Projet/index.html` (versions)
- Modify: `Planning Projet/tests/syntheseGanttWiring.test.mjs`, `Planning Projet/tests/syntheseTasksWiring.test.mjs` (versions attendues)

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces : scripts et feuille de style servis en `20260925-etages1` ; rapport de vérification.

- [ ] **Step 1: Update the expected versions (failing)**

Dans `Planning Projet/tests/syntheseGanttWiring.test.mjs`, remplace `main.js?v=20260925-gantt2` par `main.js?v=20260925-etages1` et `styles.css?v=20260925-gantt2` par `styles.css?v=20260925-etages1`. Dans `Planning Projet/tests/syntheseTasksWiring.test.mjs`, remplace `main.js?v=20260925-gantt2` par `main.js?v=20260925-etages1`.

Run: `node --test "Planning Projet/tests/syntheseGanttWiring.test.mjs" "Planning Projet/tests/syntheseTasksWiring.test.mjs"`
Expected: FAIL (index.html sert encore `20260925-gantt2`).

- [ ] **Step 2: Bump the versions**

Dans `Planning Projet/index.html`, remplace les 5 occurrences de `20260925-gantt2` par `20260925-etages1` (rien d'autre).

Run: la même commande. Expected: PASS.

- [ ] **Step 3: Full suites and syntax**

Run: `node --test "Planning Projet/tests/"*.test.mjs && node --test shared/tests/*.cjs && for f in "Planning Projet/assets/js/services/syntheseTaskModel.js" "Planning Projet/assets/js/ui/syntheseTasksController.js" "Planning Projet/assets/js/ui/syntheseTaskTable.js" "Planning Projet/assets/js/ui/syntheseTaskDrag.js" "Planning Projet/assets/js/services/syntheseGanttGeometry.js" "Planning Projet/assets/js/ui/syntheseGantt.js" "Planning Projet/assets/js/services/planningSyncCoordinator.js" "Planning Projet/assets/js/main.js"; do node --check "$f" || echo "ERREUR $f"; done`
Expected: toutes les suites PASS (Planning Projet : 177 au départ + 55 = 232 ; shared : 172) ; aucune ligne « ERREUR ».

- [ ] **Step 4: Bytes**

Run: le contrôle CR / marques (Task 1, Step 6) sur tous les fichiers créés ou modifiés par ce plan.
Expected: `CR: 0` et `marques: 0` partout ; `git status --short` ne montre, en plus de l'état de départ, que les fichiers listés dans ce plan.

- [ ] **Step 5: Manual check (utilisateur, localhost)**

À transmettre à l'utilisateur (Planning Projet, service Synthese, « Editer » actif ; recharger le widget en forçant, Ctrl+Maj+R, car les modules ne portent pas de numéro de version) :
1. clic droit sur une zone → « Ajouter un étage » : « Nouvel étage » apparaît, nom en saisie ; le renommer « PH RDB » ;
2. clic droit sur l'étage → « Ajouter une tâche » : la tâche est dans l'étage (Groupe = « PH RDB » dans Grist) ;
3. l'étage affiche Durée / Début / Fin de ses tâches ; le triangle le replie ;
4. poignée ⠿ au survol d'une tâche : la glisser sur l'étage, sur la zone, sur une autre zone ; Échap annule ;
5. Gantt : crochet fin au-dessus des tâches de l'étage, nom à droite ; flèches entre les tâches successives d'un même étage ;
6. renommer l'étage : ses tâches suivent (Groupe mis à jour dans Grist) ; nom en double refusé ;
7. supprimer l'étage : la confirmation annonce le nombre de tâches ; l'étage et ses tâches disparaissent ;
8. couper le réseau ou ralentir Grist : « Enregistrement… » apparaît après une seconde ;
9. document sans colonne `Etage` : « Ajouter un étage » grisé, message au clic.

- [ ] **Step 6: Independent review**

Revue finale de l'ensemble (spec, plan et diff) ; corriger les problèmes confirmés, relancer les suites.
