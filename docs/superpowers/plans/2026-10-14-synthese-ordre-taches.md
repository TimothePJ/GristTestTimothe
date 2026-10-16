# Ordre libre des tâches et chaînage automatique — plan d'implémentation

> **Pour les agents :** compétence requise : superpowers:executing-plans (ou subagent-driven-development) pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** dans la vue Synthese de Planning Projet, « Ajouter une tâche » insère la tâche sous la ligne cliquée, on glisse une tâche avant ou après une autre, et le chaînage façon MS Project réajuste liens et dates.

**Architecture :** un module pur `services/syntheseTaskOrder.js` calcule tout (conteneurs, rangs, liens, dates) et rend des champs à écrire par ligne ; le modèle trie les conteneurs par la colonne `Ordre` ; le contrôleur transforme les plans en une écriture Grist (deux temps dans un seul cas) ; le glisser vise une place selon la moitié de ligne survolée et le tableau dessine un trait d'insertion. La vue Global reprend l'ordre sans changement de code.

**Pile :** JavaScript (modules ES), sans dépendance ; tests `node:test` (Node 25), lancés depuis `Planning Projet/` avec `node --test tests/*.test.mjs` (jamais `node --test tests/`).

**Spec :** `docs/superpowers/specs/2026-10-14-synthese-ordre-taches-design.md` (approuvée le 14/10/2026).

## Contraintes globales

- Colonne **`Ordre`** de `Planning_Projet`, **Texte** (créée par l'utilisateur dans le document de test) : la vue écrit « 1 », « 2 », « 3 »… et lit la valeur comme un nombre (`readOrder`) ; vide ou illisible = pas de rang.
- **Sans `Ordre`** : tout comme aujourd'hui — fin de conteneur, glisser vers les conteneurs seulement, pas de chaînage. **Sans `Lien`** (colonnes du modèle d'étage absentes) : pas de chaînage, pas de lien écrit.
- Le chaînage n'écrit que des liens « fin → début » (`FD`) ; une tâche déjà liée à la tâche du dessus garde son lien ; la tâche du dessous ne se rattache que si elle suivait la tâche du dessus en `FD` ; jamais de boucle.
- Une action = **une** écriture Grist, sauf l'ajout dont la tâche du dessous doit suivre la nouvelle (deux temps, annulation si le second échoue).
- Planification sur **toutes** les zones (`allSections()`), même avec un filtre de zone au bandeau.
- Fichiers en **LF** ; commentaires et messages en français ; **aucun commit** (l'utilisateur commite).
- Nombre de tests attendu : 567 avant le plan, **609** après.

## Points de vigilance (Review Focus)

1. **Rang saisi à la main en double** (« 1 » sur deux lignes) : l'ordre reste stable, par id à égalité — test « rang en double » (tâche 1).
2. **Tâche lâchée sur sa propre place** (juste avant la suivante, juste après la précédente) : aucune écriture — test « à la même place » (tâche 3).
3. **Étage du modèle pas encore daté** : une nouvelle tâche liée à une tâche sans dates est créée sans dates, durée prévue 1 jour — test « tâche du dessus sans dates » (tâche 3).
4. **Boucle de liens** (une tâche glissée après celle qui la suivait) : la boucle est cassée — test « jamais de boucle » (tâche 3).
5. **Production sans les colonnes** : comportement d'avant, message quand une place sous une tâche était demandée — tests « sans la colonne Lien… sans Ordre » (tâche 3) et « sans la colonne Ordre » (tâche 4).

## Fichiers

| Fichier | Tâche | Rôle |
|---|---|---|
| `assets/js/services/syntheseTaskModel.js` | 1 | Colonne `order`, `readOrder`, `detectOrderColumn`, tri par rang (`compareRanked`). |
| `assets/js/services/syntheseTaskOrder.js` (nouveau) | 2, 3 | Conteneurs, liste des tâches d'un étage, renumérotation, écritures groupées, cible d'un dépôt ; chaînage et plans (ajout, suite d'un ajout, déplacement, suppressions). |
| `assets/js/ui/syntheseTasksController.js` | 4 | Ajout à une place (une ou deux écritures), déplacement, suppressions avec chaîne refermée / liens orphelins, option `canOrder`. |
| `assets/js/ui/syntheseTaskDrag.js`, `assets/js/ui/syntheseTaskTable.js`, `assets/css/styles.css` | 5 | Place visée selon la moitié de ligne, trait d'insertion, tâche cliquée transmise au menu. |
| `tests/globalRowModel.test.mjs` | 6 | La vue Global reprend l'ordre. |

---

### Tâche 1 : lire la colonne Ordre et trier les conteneurs par rang

**Fichiers :**
- Créer : `tests/syntheseTaskOrderSort.test.mjs`
- Modifier : `tests/syntheseTaskModel.test.mjs` (liste des colonnes), `assets/js/services/syntheseTaskModel.js`

**Interfaces produites :**
- `TASK_COLUMNS.order === "Ordre"` ; `readOrder(value) → number | null` ; `detectOrderColumn(rows) → true | false | null` ;
- `readTask(row).order` et le groupe lu (`floor.groups[].order`) : rang ou null ;
- `compareRanked(left, right, fallback)` : éléments rangés d'abord (rang puis id), sinon `fallback` ;
- `buildSections` trie : étage, cycle, sous-groupe par rang puis par id ; niveau zone : tâches rangées d'abord puis par date, étages par date.

- [ ] **Étape 1 : écrire les tests**

Créer `tests/syntheseTaskOrderSort.test.mjs` :

```js
// Ordre libre des tâches (colonne Ordre) : lecture du rang et tri du contenu des conteneurs de
// la vue Synthese. Sans rang, l'ordre d'aujourd'hui ; avec rang, les éléments rangés d'abord.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TASK_COLUMNS,
  buildRowModel,
  buildSections,
  detectOrderColumn,
  readOrder,
} from "../assets/js/services/syntheseTaskModel.js";
import { templateRows } from "./helpers/templateRows.mjs";

// Modèle d'étage SS1 (Zone Z3A), ids 201 à 226 : CYCLE 3 = 217 ; dans le cycle 3, RECEPTION
// RENDU 218, VISA A 219, PLAN SYT CYCLE 3 220 (RÉSEAUX 221, RÉSERVATIONS 222, TERMINAUX 223),
// REUNION 224, SIGNATURE 225, DÉMARRAGE GO 226.
const withOrder = (rows, orders) => rows.map((row) => (row.id in orders ? { ...row, Ordre: orders[row.id] } : row));
const keysAfter = (lines, key) => {
  const keys = lines.map((line) => line.key);
  return keys.slice(keys.indexOf(key));
};

test("colonne Ordre : texte ou nombre lu comme un nombre ; vide ou illisible = pas de rang", () => {
  assert.equal(TASK_COLUMNS.order, "Ordre");
  assert.deepEqual(
    ["3", " 12 ", 4, "2,5", "", null, undefined, "abc", "4 bis"].map(readOrder),
    [3, 12, 4, 2.5, null, null, null, null, null]
  );
});

test("colonne Ordre présente ou non, d'après les lignes lues", () => {
  assert.equal(detectOrderColumn([]), null);
  assert.equal(detectOrderColumn([{ id: 1 }]), false);
  assert.equal(detectOrderColumn([{ id: 1 }, { id: 2, Ordre: "" }]), true);
});

test("sans rang : l'ordre de création dans l'étage, ses cycles et ses sous-groupes, comme avant", () => {
  const lines = buildRowModel(buildSections({ rows: templateRows() }));
  assert.deepEqual(keysAfter(lines, "group:217"), [
    "group:217", "task:218", "task:219", "group:220", "task:221", "task:222", "task:223",
    "task:224", "task:225", "task:226",
  ]);
});

test("avec rang : les éléments rangés d'abord (par rang, « 10 » après « 9 »), puis les autres par création", () => {
  const rows = withOrder(templateRows(), { 219: "1", 218: "2", 220: "3", 226: "4", 221: "10", 222: "9" });
  const lines = buildRowModel(buildSections({ rows }));
  assert.deepEqual(keysAfter(lines, "group:217"), [
    "group:217", "task:219", "task:218", "group:220", "task:222", "task:221", "task:223",
    "task:226", "task:224", "task:225",
  ]);
  const task = buildSections({ rows })[0].floors[0].tasks.find((candidate) => candidate.id === 221);
  assert.equal(task.order, 10);
  assert.equal(buildSections({ rows })[0].floors[0].groups.find((group) => group.rowId === 220).order, 3);
});

// Review Focus 1 : un rang saisi à la main en double reste stable (même rang : par id).
test("rang en double (saisi à la main) : à égalité, par création", () => {
  const rows = withOrder(templateRows(), { 224: "1", 218: "1" });
  const lines = buildRowModel(buildSections({ rows }));
  assert.deepEqual(keysAfter(lines, "group:217").slice(0, 5), ["group:217", "task:218", "task:224", "task:219", "group:220"]);
});

test("niveau zone : sans rang par date, rangées d'abord ; les étages restent après, par date", () => {
  const plain = { NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: false, Nature: "", Parent: "", Lien: "", Duree_1: 5 };
  const rows = [
    ...templateRows(),
    { ...plain, id: 301, Taches: "Visa tardif", Diff_coffrage: "2026-03-02", Diff_armature: "2026-03-06" },
    { ...plain, id: 302, Taches: "Visa précoce", Diff_coffrage: "2025-12-01", Diff_armature: "2025-12-05" },
    { ...plain, id: 303, Taches: "Visa sans date", Diff_coffrage: null, Diff_armature: null },
  ];
  const zoneLevel = (lines) => lines.filter((line) => line.level === 1).map((line) => line.key);
  assert.deepEqual(zoneLevel(buildRowModel(buildSections({ rows }))), ["task:302", "task:301", "task:303", "floor:zonez3a/ss1"]);
  const ranked = withOrder(rows, { 303: "1", 301: "2" });
  assert.deepEqual(zoneLevel(buildRowModel(buildSections({ rows: ranked }))), ["task:303", "task:301", "task:302", "floor:zonez3a/ss1"]);
});
```

Et, dans `tests/syntheseTaskModel.test.mjs` :

```diff
--- a/Planning Projet/tests/syntheseTaskModel.test.mjs
+++ b/Planning Projet/tests/syntheseTaskModel.test.mjs
@@ -138,6 +138,7 @@
     link: "Lien",
     structureLink: "Lien_Structure",
     formworkCheck: "Controle_Coffrage",
+    order: "Ordre",
   });
 });
 
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : échec — « does not provide an export named 'detectOrderColumn' » ; et « les colonnes Grist utilisées » en échec.

- [ ] **Étape 3 : implémenter**

```diff
--- a/Planning Projet/assets/js/services/syntheseTaskModel.js
+++ b/Planning Projet/assets/js/services/syntheseTaskModel.js
@@ -42,6 +42,7 @@
   link: "Lien",
   structureLink: "Lien_Structure",
   formworkCheck: "Controle_Coffrage",
+  order: "Ordre",
 });
 
 export const NEW_TASK_NAME = "Nouvelle tâche";
@@ -177,6 +178,15 @@
   return Number.isInteger(days) && days >= 0 && days <= MAX_DURATION_DAYS ? days : null;
 }
 
+// Colonne Ordre (texte ou nombre) : le rang d'une tâche ou d'un groupe dans son conteneur, lu
+// comme un nombre (« 10 » vient après « 9 ») ; vide ou illisible → null.
+export function readOrder(value) {
+  const text = toText(value).replace(",", ".");
+  if (!text) return null;
+  const number = Number(text);
+  return Number.isFinite(number) ? number : null;
+}
+
 // Les dates font foi pour la Durée ; Duree_1 sert à reconnaître un jalon (0 jour) d'une
 // tâche d'un jour, qui ont toutes deux Début = Fin, et donne la durée prévue d'une tâche
 // sans dates (modèle d'étage).
@@ -210,6 +220,7 @@
     link: link && link.predId !== id ? link : null,
     id2: toText(row?.[TASK_COLUMNS.id2]),
     indice: toText(row?.[TASK_COLUMNS.indice]),
+    order: readOrder(row?.[TASK_COLUMNS.order]),
   };
 }
 
@@ -650,6 +661,13 @@
   return rows.some((row) => row != null && Object.prototype.hasOwnProperty.call(row, TASK_COLUMNS.formworkCheck));
 }
 
+// La colonne Ordre (rang libre des tâches) existe-t-elle ? Comme pour Etage : null si aucune
+// ligne ne permet de le savoir.
+export function detectOrderColumn(rows = []) {
+  if (!rows?.length) return null;
+  return rows.some((row) => row != null && Object.prototype.hasOwnProperty.call(row, TASK_COLUMNS.order));
+}
+
 function hasDates(task) {
   return task?.start instanceof Date && task?.end instanceof Date;
 }
@@ -732,6 +750,7 @@
     zoneKey: zoneKeyOf(zoneName),
     floorKey: floorKeyOf(floorName),
     floorName,
+    order: readOrder(row?.[TASK_COLUMNS.order]),
   };
 }
 
@@ -739,7 +758,25 @@
   return item.kind === "task" ? item.task.id : item.group.rowId;
 }
 
-// Contenu d'un étage, dans l'ordre de création (ordre du modèle) : ses tâches et ses cycles ;
+// Rang d'un élément de conteneur (tâche ou groupe), ou null.
+function itemOrder(item) {
+  if (item.kind === "task") return item.task.order ?? null;
+  if (item.kind === "group") return item.group.order ?? null;
+  return null;
+}
+
+// Contenu d'un conteneur : d'abord les éléments rangés (colonne Ordre), par rang puis par id ;
+// ensuite les autres, dans l'ordre par défaut du conteneur (`fallback`).
+export function compareRanked(left, right, fallback) {
+  const leftOrder = itemOrder(left);
+  const rightOrder = itemOrder(right);
+  if ((leftOrder == null) !== (rightOrder == null)) return leftOrder == null ? 1 : -1;
+  if (leftOrder != null) return leftOrder - rightOrder || itemRowId(left) - itemRowId(right);
+  return fallback(left, right);
+}
+
+// Contenu d'un étage, par rang (colonne Ordre) puis dans l'ordre de création (ordre du
+// modèle) : ses tâches et ses cycles ;
 // dans un cycle, ses tâches et ses sous-groupes ; dans un sous-groupe, ses tâches. Une ligne
 // dont le Parent ne désigne pas un groupe de l'étage (ou un sous-groupe dont le Parent n'est
 // pas un cycle) se range directement dans l'étage. Récapitulatif d'un groupe : toutes ses
@@ -759,9 +796,10 @@
     for (let container = group; container; container = container.parentGroup) container.tasks.push(task);
   });
   const byRowId = (left, right) => itemRowId(left) - itemRowId(right);
-  floor.items.sort(byRowId);
+  const byRank = (left, right) => compareRanked(left, right, byRowId);
+  floor.items.sort(byRank);
   floor.groups.forEach((group) => {
-    group.items.sort(byRowId);
+    group.items.sort(byRank);
     group.summary = summarizeTasks(group.tasks);
   });
   floor.summary = summarizeTasks(floor.tasks);
@@ -785,10 +823,15 @@
   return { start: item.task.start, end: item.task.end, name: item.task.name };
 }
 
-// Niveau zone : les tâches hors étage en haut, puis les étages ; dans chaque groupe, par date
-// de début, puis de fin, puis par nom ; le non daté à la fin du groupe.
+// Niveau zone : les tâches hors étage en haut, puis les étages. Tâches : rangées d'abord
+// (colonne Ordre), puis par date ; étages : par date. Par date : début, puis fin, puis nom ; le
+// non daté à la fin.
 function compareItems(left, right) {
   if (left.kind !== right.kind) return left.kind === "task" ? -1 : 1;
+  return left.kind === "task" ? compareRanked(left, right, compareByDates) : compareByDates(left, right);
+}
+
+function compareByDates(left, right) {
   const a = itemBounds(left);
   const b = itemBounds(right);
   const aDated = a.start instanceof Date && a.end instanceof Date;
```

- [ ] **Étape 4 : vérifier qu'ils passent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : **573** tests, 0 échec.

- [ ] **Pas de commit** : l'utilisateur commite lui-même (il teste l'arbre de travail sur localhost). Vérifier seulement `git status` : rien hors des fichiers de la tâche.

---

### Tâche 2 : module d'ordre — conteneurs, renumérotation, écritures, cible d'un dépôt

**Fichiers :**
- Créer : `tests/syntheseTaskOrder.test.mjs`, `assets/js/services/syntheseTaskOrder.js`

**Interfaces :**
- Consomme : `resolveDropTarget(line)`, `TASK_COLUMNS`, `PLANNING_TABLE`, `NO_ZONE_LABEL` (modèle) ; `order` des tâches et des groupes (tâche 1).
- Produit :
  - `NEW_TASK_ID = 0` ;
  - `findContainer(sections, { zoneKey, floorKey, groupRowId }) → { key, section, floor, group, items } | null` (clés « zone:… », « floor:zone/étage », « group:id ») ;
  - `locateTask(sections, taskId) → conteneur | null` ;
  - `taskOrder(container, overrides = Map(clé → éléments)) → number[]` (tâches de l'étage, groupes traversés, ou du niveau zone) ;
  - `renumberItems(items) → Map(rowId → { Ordre: "k" })` (seulement ce qui change ; NEW_TASK_ID ignoré) ;
  - `buildUpdateActions(Map(rowId → champs)) → actions Grist` (une BulkUpdateRecord par jeu de colonnes, UpdateRecord pour une ligne seule, ids triés) ;
  - `resolveDropSlot(line, side, { canOrder, draggedTaskId }) → cible | null` : sans `canOrder`, `resolveDropTarget(line)` ; avec, sur une tâche `{ ...conteneur, key: "slot:id:before|after", label: "Placer avant|après « nom »", position: { taskId, side } }`, sur une ligne d'en-tête « Déplacer à la fin de « nom » » (zone : « … du niveau de la zone « nom » »).

- [ ] **Étape 1 : écrire les tests**

Créer `tests/syntheseTaskOrder.test.mjs` :

```js
// Ordre libre des tâches : conteneurs, liste des tâches d'un étage, renumérotation, écritures
// groupées et cible d'un dépôt (module pur syntheseTaskOrder.js).
import test from "node:test";
import assert from "node:assert/strict";

import { buildRowModel, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import {
  NEW_TASK_ID,
  buildUpdateActions,
  findContainer,
  locateTask,
  renumberItems,
  resolveDropSlot,
  taskOrder,
} from "../assets/js/services/syntheseTaskOrder.js";
import { templateRows } from "./helpers/templateRows.mjs";

// Modèle d'étage SS1 (Zone Z3A), ids 201 à 226 (voir tests/helpers/templateRows.mjs) ; plus une
// tâche « Visa MOE » (301) au niveau zone.
const ZONE = "zonez3a";
function rows() {
  return [
    ...templateRows(),
    {
      id: 301, NomProjet: "HOTEL DIEU", Taches: "Visa MOE", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "",
      Etage: false, Nature: "", Parent: "", Lien: "", Diff_coffrage: "2026-02-02", Diff_armature: "2026-02-06", Duree_1: 5,
    },
  ];
}
const sections = () => buildSections({ rows: rows() });
const idsOf = (items) => items.map((item) => (item.kind === "task" ? item.task.id : item.group.rowId));
const FLOOR_ORDER = [202, 204, 205, 206, 207, 208, 209, 211, 213, 214, 215, 216, 218, 219, 221, 222, 223, 224, 225, 226];

test("conteneurs : niveau zone (ses tâches), étage, cycle, sous-groupe ; introuvable → null", () => {
  const all = sections();
  const zone = findContainer(all, { zoneKey: ZONE });
  assert.deepEqual([zone.key, idsOf(zone.items), zone.floor], [`zone:${ZONE}`, [301], null]);
  const floor = findContainer(all, { zoneKey: ZONE, floorKey: "ss1" });
  assert.deepEqual([floor.key, idsOf(floor.items)], [`floor:${ZONE}/ss1`, [202, 203, 210, 217]]);
  const cycle = findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 217 });
  assert.deepEqual([cycle.key, idsOf(cycle.items), cycle.floor.key], ["group:217", [218, 219, 220, 224, 225, 226], "ss1"]);
  assert.deepEqual(idsOf(findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 220 }).items), [221, 222, 223]);
  assert.equal(findContainer(all, { zoneKey: "inconnue" }), null);
  assert.equal(findContainer(all, { zoneKey: ZONE, floorKey: "r1" }), null);
  assert.equal(findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 999 }), null);
});

test("conteneur d'une tâche : son sous-groupe, son cycle, son étage ou le niveau zone", () => {
  const all = sections();
  assert.equal(locateTask(all, 222).key, "group:220");
  assert.equal(locateTask(all, 219).key, "group:217");
  assert.equal(locateTask(all, 202).key, `floor:${ZONE}/ss1`);
  assert.equal(locateTask(all, 301).key, `zone:${ZONE}`);
  assert.equal(locateTask(all, 999), null);
});

test("liste des tâches d'un étage : cycles et sous-groupes traversés, dans l'ordre affiché", () => {
  const all = sections();
  assert.deepEqual(taskOrder(findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 220 })), FLOOR_ORDER);
  assert.deepEqual(taskOrder(findContainer(all, { zoneKey: ZONE })), [301]);
  // Contenu d'un conteneur remplacé : simulation d'un placement.
  const group = findContainer(all, { zoneKey: ZONE, floorKey: "ss1", groupRowId: 220 });
  const reversed = new Map([["group:220", group.items.slice().reverse()]]);
  assert.deepEqual(taskOrder(group, reversed).slice(14, 17), [223, 222, 221]);
  const placeholder = { kind: "task", task: { id: NEW_TASK_ID } };
  const withNew = new Map([["group:220", [...group.items, placeholder]]]);
  assert.deepEqual(taskOrder(group, withNew).slice(14, 18), [221, 222, 223, NEW_TASK_ID]);
});

test("renumérotation : 1, 2, 3… en texte, seulement pour les lignes dont le rang change", () => {
  const group = findContainer(sections(), { zoneKey: ZONE, floorKey: "ss1", groupRowId: 217 });
  const changes = renumberItems(group.items);
  assert.deepEqual([...changes.entries()], [
    [218, { Ordre: "1" }], [219, { Ordre: "2" }], [220, { Ordre: "3" }],
    [224, { Ordre: "4" }], [225, { Ordre: "5" }], [226, { Ordre: "6" }],
  ]);
  const ranked = group.items.map((item, index) => (item.kind === "task"
    ? { kind: "task", task: { ...item.task, order: index + 1 } }
    : { kind: "group", group: { ...item.group, order: index + 1 } }));
  assert.equal(renumberItems(ranked).size, 0, "déjà rangés");
  const withNew = [{ kind: "task", task: { id: NEW_TASK_ID, order: null } }, ...ranked];
  assert.deepEqual([...renumberItems(withNew).keys()], [218, 219, 220, 224, 225, 226], "la nouvelle tâche est ignorée");
});

test("écritures : une par jeu de colonnes, ids triés ; une seule ligne → UpdateRecord", () => {
  const changes = new Map([
    [223, { Ordre: "3" }],
    [221, { Ordre: "1" }],
    [225, { Lien: "219 FD+5", Diff_coffrage: "2026-04-01" }],
    [222, { Ordre: "2" }],
    [230, {}],
  ]);
  assert.deepEqual(buildUpdateActions(changes), [
    ["BulkUpdateRecord", "Planning_Projet", [221, 222, 223], { Ordre: ["1", "2", "3"] }],
    ["UpdateRecord", "Planning_Projet", 225, { Lien: "219 FD+5", Diff_coffrage: "2026-04-01" }],
  ]);
  assert.deepEqual(buildUpdateActions(new Map()), []);
});

test("cible d'un dépôt : sans colonne Ordre, le conteneur seul, comme avant", () => {
  const lines = buildRowModel(sections());
  const line = (key) => lines.find((candidate) => candidate.key === key);
  assert.deepEqual(resolveDropSlot(line("task:222"), "before"), {
    key: "group:220", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 220,
    label: "Déplacer dans « PLAN SYT CYCLE 3 »",
  });
});

test("cible d'un dépôt avec la colonne Ordre : avant ou après une tâche ; fin d'un conteneur", () => {
  const lines = buildRowModel(sections());
  const line = (key) => lines.find((candidate) => candidate.key === key);
  const before = resolveDropSlot(line("task:219"), "before", { canOrder: true, draggedTaskId: 301 });
  assert.deepEqual(before, {
    key: "slot:219:before", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 217,
    label: "Placer avant « VISA Indice A »", position: { taskId: 219, side: "before" },
  });
  const after = resolveDropSlot(line("task:223"), "after", { canOrder: true });
  assert.deepEqual([after.key, after.label, after.position], [
    "slot:223:after", "Placer après « PLAN DE SYNTHESE TERMINAUX NIV SS1 »", { taskId: 223, side: "after" },
  ]);
  assert.equal(resolveDropSlot(line("task:219"), "after", { canOrder: true, draggedTaskId: 219 }), null, "sur elle-même");
  assert.deepEqual(
    ["group:220", "group:217", `floor:${ZONE}/ss1`, `zone:${ZONE}`].map((key) => {
      const target = resolveDropSlot(line(key), "after", { canOrder: true });
      return [target.key, target.label, target.position ?? null];
    }),
    [
      ["group:220", "Déplacer à la fin de « PLAN SYT CYCLE 3 »", null],
      ["group:217", "Déplacer à la fin de « CYCLE 3 »", null],
      [`floor:${ZONE}/ss1`, "Déplacer à la fin de « SS1 »", null],
      [`zone:${ZONE}`, "Déplacer à la fin du niveau de la zone « Zone Z3A »", null],
    ]
  );
  assert.equal(resolveDropSlot(null, "after", { canOrder: true }), null);
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : échec — module `syntheseTaskOrder.js` introuvable.

- [ ] **Étape 3 : implémenter**

Créer `assets/js/services/syntheseTaskOrder.js` :

```js
// Ordre libre des tâches de la vue Synthese et chaînage automatique, façon MS Project : où va
// une tâche ajoutée ou déplacée, la renumérotation de son conteneur (colonne Ordre), les liens
// qui changent (la tâche suit celle du dessus, la chaîne se referme là où elle était) et les
// dates qui suivent. Module pur, sans DOM ni Grist : il rend les champs à écrire, par ligne.
import {
  NO_ZONE_LABEL,
  PLANNING_TABLE,
  TASK_COLUMNS,
  resolveDropTarget,
} from "./syntheseTaskModel.js";

// Place d'une tâche pas encore créée, dans un conteneur simulé (aucune ligne Grist n'a l'id 0).
export const NEW_TASK_ID = 0;

function rowIdOf(item) {
  return item.kind === "task" ? item.task.id : item.group.rowId;
}

function orderOf(item) {
  return (item.kind === "task" ? item.task.order : item.group.order) ?? null;
}

// Un conteneur des sections : le niveau zone d'une zone (ses tâches hors étage), un étage, un
// cycle ou un sous-groupe. `key` suit le format des lignes d'en-tête (« zone:… », « floor:…/… »,
// « group:… ») ; `floor` est l'étage du conteneur (null au niveau zone) ; `items` son contenu
// dans l'ordre affiché. null s'il n'existe pas.
export function findContainer(sections, { zoneKey = "", floorKey = "", groupRowId = null } = {}) {
  const section = (sections || []).find((candidate) => candidate.zoneKey === zoneKey);
  if (!section) return null;
  if (groupRowId) {
    for (const floor of section.floors) {
      const group = floor.groups.find((candidate) => candidate.rowId === groupRowId);
      if (group) return { key: `group:${groupRowId}`, section, floor, group, items: group.items };
    }
    return null;
  }
  if (floorKey) {
    const floor = section.floors.find((candidate) => candidate.key === floorKey);
    return floor ? { key: `floor:${zoneKey}/${floorKey}`, section, floor, group: null, items: floor.items } : null;
  }
  return {
    key: `zone:${zoneKey}`,
    section,
    floor: null,
    group: null,
    items: section.items.filter((item) => item.kind === "task"),
  };
}

// Le conteneur d'une tâche, ou null.
export function locateTask(sections, taskId) {
  for (const section of sections || []) {
    if (section.items.some((item) => item.kind === "task" && item.task.id === taskId)) {
      return findContainer(sections, { zoneKey: section.zoneKey });
    }
    for (const floor of section.floors) {
      const task = floor.tasks.find((candidate) => candidate.id === taskId);
      if (task) return findContainer(sections, { zoneKey: section.zoneKey, floorKey: floor.key, groupRowId: task.groupRowId });
    }
  }
  return null;
}

// Ids des tâches de l'étage d'un conteneur — cycles et sous-groupes traversés, lignes de groupe
// ignorées — ou des tâches du niveau zone, dans l'ordre affiché. `overrides` (clé de conteneur →
// éléments) remplace le contenu de conteneurs pour simuler un placement.
export function taskOrder(container, overrides = new Map()) {
  const ids = [];
  const walk = (key, items) => (overrides.get(key) || items).forEach((item) => {
    if (item.kind === "task") ids.push(item.task.id);
    else if (item.kind === "group") walk(`group:${item.group.rowId}`, item.group.items);
  });
  if (container.floor) walk(`floor:${container.section.zoneKey}/${container.floor.key}`, container.floor.items);
  else walk(container.key, container.items);
  return ids;
}

// Rangs 1, 2, 3… (texte) du contenu d'un conteneur dans l'ordre voulu : seulement les lignes
// dont le rang change. La place d'une nouvelle tâche (NEW_TASK_ID) est ignorée : son rang va
// dans ses propres champs.
export function renumberItems(items) {
  const changes = new Map();
  (items || []).forEach((item, index) => {
    const rowId = rowIdOf(item);
    if (!rowId || orderOf(item) === index + 1) return;
    changes.set(rowId, { [TASK_COLUMNS.order]: String(index + 1) });
  });
  return changes;
}

// Champs par ligne → écritures Grist : une BulkUpdateRecord par jeu de colonnes identique (une
// UpdateRecord pour une ligne seule), ids triés. Une ligne n'est jamais écrite dans une colonne
// qu'elle ne change pas.
export function buildUpdateActions(changes) {
  const groups = new Map();
  [...changes.keys()].sort((left, right) => left - right).forEach((rowId) => {
    const fields = changes.get(rowId);
    const columns = Object.keys(fields).sort();
    if (!columns.length) return;
    const signature = columns.join("\n");
    if (!groups.has(signature)) groups.set(signature, { columns, rowIds: [] });
    groups.get(signature).rowIds.push(rowId);
  });
  return [...groups.values()].map(({ columns, rowIds }) => {
    if (rowIds.length === 1) return ["UpdateRecord", PLANNING_TABLE, rowIds[0], changes.get(rowIds[0])];
    const values = Object.fromEntries(columns.map((column) => [column, rowIds.map((rowId) => changes.get(rowId)[column])]));
    return ["BulkUpdateRecord", PLANNING_TABLE, rowIds, values];
  });
}

// Cible d'un dépôt d'après la ligne survolée et sa moitié (`side` : "before" pour la moitié
// haute, "after" pour la basse). Sans la colonne Ordre (`canOrder` faux) : le conteneur de la
// ligne, comme avant. Avec : sur une tâche, une place avant ou après elle dans son conteneur (rien
// sur la tâche glissée elle-même) ; sur une ligne de zone, d'étage ou de groupe, la fin de ce
// conteneur.
export function resolveDropSlot(line, side, { canOrder = false, draggedTaskId = null } = {}) {
  const target = resolveDropTarget(line);
  if (!target || !canOrder) return target;
  if (line.kind === "task") {
    if (line.taskId === draggedTaskId) return null;
    const placement = side === "before" ? "before" : "after";
    return {
      ...target,
      key: `slot:${line.taskId}:${placement}`,
      label: `${placement === "before" ? "Placer avant" : "Placer après"} « ${line.name} »`,
      position: { taskId: line.taskId, side: placement },
    };
  }
  if (line.kind === "zone") {
    return { ...target, label: `Déplacer à la fin du niveau de la zone « ${line.zoneName || NO_ZONE_LABEL} »` };
  }
  return { ...target, label: `Déplacer à la fin de « ${line.kind === "group" ? line.groupLabel : line.floorName} »` };
}
```

- [ ] **Étape 4 : vérifier qu'ils passent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : **580** tests, 0 échec.

- [ ] **Pas de commit** : l'utilisateur commite lui-même (il teste l'arbre de travail sur localhost). Vérifier seulement `git status` : rien hors des fichiers de la tâche.

---

### Tâche 3 : chaînage automatique et plans d'action

**Fichiers :**
- Créer : `tests/syntheseTaskChain.test.mjs`
- Modifier : `assets/js/services/syntheseTaskOrder.js` (imports, puis le chaînage ajouté en fin de fichier)

**Interfaces :**
- Consomme : tâche 2 ; `buildMoveFields`, `buildNewTask`, `buildTaskFields`, `dateFieldsOf` (modèle) ; `cascadeFrom`, `computeLinkedDates`, `formatLink` (`syntheseLinks.js`).
- Produit (tous rendent des champs par ligne, `Map(rowId → champs)`, sauf l'ajout) :
  - `planTaskInsert({ sections, container, afterTaskId, canOrder, canLink, today, projectName }) → { task, fields, changes, follow, atEnd } | null` — `follow = { successorId, lag } | null` : la tâche du dessous qui devra suivre la nouvelle ; `atEnd` : place sous une tâche demandée sans la colonne Ordre ;
  - `planInsertFollowUp({ sections, newTask, successorId, lag }) → Map` ;
  - `planTaskMove({ sections, taskId, target, canOrder, canLink }) → Map` (vide : rien à faire) ;
  - `planTaskRemoval({ sections, taskId, canLink }) → Map` (lignes restantes) ;
  - `planOrphanLinks({ sections, removedIds, canLink }) → Map`.

- [ ] **Étape 1 : écrire les tests**

Créer `tests/syntheseTaskChain.test.mjs` (valeurs vérifiées à la main sur l'étage du modèle daté : jours ouvrés, fériés français, jalons) :

```js
// Chaînage automatique de la vue Synthese, façon MS Project : nouvelle tâche à sa place, tâche
// glissée, chaîne refermée, dates qui suivent, suppressions (module pur syntheseTaskOrder.js).
// Étage SS1 du modèle daté (Zone Z3A, ids 201 à 226) : dans le cycle 1 (203), FOND DE PLAN 204,
// DIFFUSION FDS 205 (« 204 FD », jalon), RECEPTION RENDU 206 (« 205 FD »), VISA 0 207
// (« 206 FD ») ; dans le cycle 3 (217), RECEPTION RENDU 218, VISA A 219 (« 218 FD »), PLAN SYT
// CYCLE 3 220 : RÉSEAUX 221 (« 218 FD »), RÉSERVATIONS 222 et TERMINAUX 223 (« 221 FF »), puis
// REUNION 224 (« 221 FD »), SIGNATURE 225 (« 219 FD+5 »), DÉMARRAGE GO 226 (« 225 FD »).
import test from "node:test";
import assert from "node:assert/strict";

import { buildSections } from "../assets/js/services/syntheseTaskModel.js";
import {
  planInsertFollowUp,
  planOrphanLinks,
  planTaskInsert,
  planTaskMove,
  planTaskRemoval,
} from "../assets/js/services/syntheseTaskOrder.js";
import { datedRows, templateRows } from "./helpers/templateRows.mjs";

const ZONE = "zonez3a";
const TODAY = new Date(2026, 8, 23);
const sectionsOf = (rows) => buildSections({ rows });
const entries = (changes) => [...changes.entries()];
const target = (fields) => ({ zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", ...fields });
const insertInto = (rows, container, afterTaskId, options = {}) => planTaskInsert({
  sections: sectionsOf(rows), container: { zoneKey: ZONE, floorKey: "ss1", ...container }, afterTaskId,
  canOrder: true, canLink: true, today: TODAY, projectName: "HOTEL DIEU", ...options,
});
const move = (rows, taskId, fields, options = {}) => planTaskMove({
  sections: sectionsOf(rows), taskId, target: target(fields), canOrder: true, canLink: true, ...options,
});

test("exemple 1 : « Ajouter une tâche » sur TERMINAUX → à la fin de PLAN SYT CYCLE 3, après TERMINAUX", () => {
  const plan = insertInto(datedRows(), { groupRowId: 220 }, 223);
  assert.deepEqual(plan.fields, {
    Taches: "Nouvelle tâche", Diff_coffrage: "2026-02-24", Diff_armature: "2026-02-24", Duree_1: 1,
    NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "220", Ordre: "4", Lien: "223 FD",
  }, "le jour ouvré après la Fin de TERMINAUX (lun. 23/02), 1 jour");
  assert.deepEqual(entries(plan.changes), [[221, { Ordre: "1" }], [222, { Ordre: "2" }], [223, { Ordre: "3" }]]);
  assert.equal(plan.follow, null, "REUNION suit RÉSEAUX, pas TERMINAUX : inchangée");
  assert.equal(plan.atEnd, false);
});

// « Test » créé à l'exemple 1 (id 400), rangs 1 à 3 déjà écrits dans PLAN SYT CYCLE 3.
function rowsWithTest() {
  const rows = datedRows().map((row) => ([221, 222, 223].includes(row.id) ? { ...row, Ordre: String(row.id - 220) } : row));
  const fields = insertInto(datedRows(), { groupRowId: 220 }, 223).fields;
  return [...rows, { id: 400, Type_doc: "", ID2: "", Etage: false, Nature: "", ...fields }];
}

test("exemple 2 : « Test » glissé avant VISA A → suit RECEPTION RENDU, VISA le suit, SIGNATURE et DÉMARRAGE suivent", () => {
  const changes = move(rowsWithTest(), 400, { groupRowId: 217, position: { taskId: 219, side: "before" } });
  assert.deepEqual(entries(changes), [
    [400, { Parent: "217", Ordre: "2", Lien: "218 FD", Diff_coffrage: "2026-02-17", Diff_armature: "2026-02-17", Duree_1: 1 }],
    [218, { Ordre: "1" }],
    [219, { Ordre: "3", Lien: "400 FD", Diff_coffrage: "2026-02-18", Diff_armature: "2026-03-03", Duree_1: 10 }],
    [220, { Ordre: "4" }],
    [224, { Ordre: "5" }],
    [225, { Ordre: "6", Diff_coffrage: "2026-03-10", Diff_armature: "2026-03-10", Duree_1: 0 }],
    [226, { Ordre: "7", Diff_coffrage: "2026-03-10", Diff_armature: "2026-03-10", Duree_1: 0 }],
  ]);
  assert.equal(changes.has(221), false, "RÉSEAUX suit RECEPTION RENDU mais n'est pas juste en dessous : inchangé");
});

test("exemple 3 : TERMINAUX avant RÉSERVATIONS → déjà liée à RÉSEAUX, seul l'ordre change", () => {
  const changes = move(datedRows(), 223, { groupRowId: 220, position: { taskId: 222, side: "before" } });
  assert.deepEqual(entries(changes), [[221, { Ordre: "1" }], [223, { Ordre: "2" }], [222, { Ordre: "3" }]]);
});

test("exemple 4 : suppression de VISA A → pas de chaîne à refermer, SIGNATURE perd son lien et garde ses dates", () => {
  assert.deepEqual(entries(planTaskRemoval({ sections: sectionsOf(datedRows()), taskId: 219, canLink: true })), [
    [225, { Lien: "" }],
  ]);
});

test("intervertir deux tâches d'une chaîne fin → début : la chaîne se referme puis se renoue", () => {
  // DIFFUSION FDS (205, jalon) glissé après RECEPTION RENDU (206) : 204 → 206 → 205 → 207.
  const changes = move(datedRows(), 205, { groupRowId: 203, position: { taskId: 206, side: "after" } });
  assert.deepEqual(entries(changes), [
    [204, { Ordre: "1" }],
    [206, { Ordre: "2", Lien: "204 FD" }],
    [205, { Ordre: "3", Lien: "206 FD", Diff_coffrage: "2026-01-19", Diff_armature: "2026-01-19", Duree_1: 0 }],
    [207, { Ordre: "4", Lien: "205 FD" }],
    [208, { Ordre: "5" }],
    [209, { Ordre: "6" }],
  ]);
});

test("nouvelle tâche dans une chaîne : la tâche du dessous la suivra, avec son décalage", () => {
  const rows = datedRows().map((row) => (row.id === 207 ? { ...row, Lien: "206 FD+2" } : row));
  const plan = insertInto(rows, { groupRowId: 203 }, 206);
  assert.deepEqual(plan.follow, { successorId: 207, lag: 2 });
  assert.deepEqual([plan.fields.Lien, plan.fields.Diff_coffrage, plan.fields.Diff_armature], ["206 FD", "2026-01-20", "2026-01-20"]);
});

test("second temps de l'ajout : avec son id, la tâche du dessous suit la nouvelle et ses dates suivent", () => {
  const plan = insertInto(datedRows(), { groupRowId: 203 }, 206);
  assert.deepEqual(plan.follow, { successorId: 207, lag: 0 });
  const changes = planInsertFollowUp({
    sections: sectionsOf(datedRows()), newTask: { ...plan.task, id: 500 }, successorId: 207, lag: 0,
  });
  assert.deepEqual(entries(changes), [
    [207, { Lien: "500 FD", Diff_coffrage: "2026-01-21", Diff_armature: "2026-02-03", Duree_1: 10 }],
  ]);
});

test("en tête de l'étage : plus de lien ; la chaîne se referme à l'ancienne place", () => {
  const changes = move(datedRows(), 205, { position: { taskId: 202, side: "before" } });
  assert.deepEqual(entries(changes), [
    [205, { Parent: "", Ordre: "1", Lien: "" }],
    [202, { Ordre: "2" }],
    [203, { Ordre: "3" }],
    [210, { Ordre: "4" }],
    [217, { Ordre: "5" }],
    [206, { Lien: "204 FD" }],
  ]);
});

test("jamais de boucle : la tâche qui suivait la tâche glissée reprend son ancien lien", () => {
  const plain = { NomProjet: "HOTEL DIEU", Type_doc: "", ID2: "", Zone: "Zone Z3A", Groupe: "", Etage: false, Nature: "", Parent: "", Duree_1: 5 };
  const rows = [
    ...datedRows(),
    { ...plain, id: 301, Taches: "X", Lien: "", Diff_coffrage: "2025-12-01", Diff_armature: "2025-12-05" },
    { ...plain, id: 302, Taches: "Y", Lien: "301 FD", Diff_coffrage: "2025-12-08", Diff_armature: "2025-12-12" },
  ];
  const changes = move(rows, 301, { floorKey: "", floorName: "", position: { taskId: 302, side: "after" } });
  assert.deepEqual(entries(changes), [
    [302, { Ordre: "1", Lien: "" }],
    [301, { Ordre: "2", Lien: "302 FD", Diff_coffrage: "2025-12-15", Diff_armature: "2025-12-19", Duree_1: 5 }],
  ]);
});

test("tâche du dessus sans dates (modèle pas encore planifié) : nouvelle tâche sans dates, durée prévue 1 jour", () => {
  const plan = insertInto(templateRows(), { groupRowId: 220 }, 221);
  assert.deepEqual(plan.fields, {
    Taches: "Nouvelle tâche", Diff_coffrage: null, Diff_armature: null, Duree_1: 1,
    NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "220", Ordre: "2", Lien: "221 FD",
  });
  assert.equal(plan.follow, null, "RÉSERVATIONS suit RÉSEAUX en fin → fin : inchangée");
});

test("sans tâche du dessus (niveau zone vide) : règle d'avant, sans lien", () => {
  const rows = [...datedRows(), { id: 11, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", Zone: "Zone Z9", Groupe: "" }];
  const plan = planTaskInsert({
    sections: sectionsOf(rows), container: { zoneKey: "zonez9" }, canOrder: true, canLink: true, today: TODAY, projectName: "HOTEL DIEU",
  });
  assert.deepEqual(plan.fields, {
    Taches: "Nouvelle tâche", Diff_coffrage: "2026-09-23", Diff_armature: "2026-09-23", Duree_1: 1,
    NomProjet: "HOTEL DIEU", Zone: "Zone Z9", Ordre: "1",
  });
});

test("vers un autre étage : elle suit la tâche du dessus de l'étage d'arrivée", () => {
  const rows = [...datedRows(), ...datedRows({ floorName: "RDC", firstId: 401 }).filter((row) => row.id !== 10)];
  const changes = move(rows, 223, { floorKey: "rdc", floorName: "RDC", groupRowId: 420, position: { taskId: 421, side: "after" } });
  assert.deepEqual(entries(changes), [
    [223, { Groupe: "RDC", Parent: "420", Ordre: "2", Lien: "421 FD", Diff_coffrage: "2026-02-24", Diff_armature: "2026-02-25", Duree_1: 2 }],
    [421, { Ordre: "1" }],
    [422, { Ordre: "3" }],
    [423, { Ordre: "4" }],
  ]);
});

test("à la même place, ou vers une tâche inconnue de son conteneur : rien, ou la fin", () => {
  assert.equal(move(datedRows(), 222, { groupRowId: 220, position: { taskId: 221, side: "after" } }).size, 0);
  assert.equal(move(datedRows(), 222, { groupRowId: 220, position: { taskId: 223, side: "before" } }).size, 0);
  assert.equal(planTaskMove({ sections: sectionsOf(datedRows()), taskId: 999, target: target({ groupRowId: 220 }) }).size, 0);
  // Sur la ligne du sous-groupe : à la fin (ordre seul, sans la colonne Lien).
  const end = move(datedRows(), 221, { groupRowId: 220 }, { canLink: false });
  assert.deepEqual(entries(end).map(([rowId, fields]) => [rowId, fields.Ordre]), [[222, "1"], [223, "2"], [221, "3"]]);
});

test("sans la colonne Lien : seul l'ordre change ; sans Ordre : le déplacement d'avant", () => {
  const ordered = move(datedRows(), 400, {}, {});
  assert.equal(ordered.size, 0, "tâche introuvable");
  const noLink = move(rowsWithTest(), 400, { groupRowId: 217, position: { taskId: 219, side: "before" } }, { canLink: false });
  assert.deepEqual(noLink.get(400), { Parent: "217", Ordre: "2" });
  assert.deepEqual(noLink.get(219), { Ordre: "3" });
  const noOrder = move(rowsWithTest(), 400, { groupRowId: 217, position: { taskId: 219, side: "before" } }, { canOrder: false });
  assert.deepEqual(entries(noOrder), [[400, { Parent: "217" }]]);
  const plan = insertInto(datedRows(), { groupRowId: 220 }, 221, { canOrder: false });
  assert.deepEqual([plan.fields.Ordre, plan.fields.Lien, plan.changes.size, plan.atEnd], [undefined, undefined, 0, true]);
  assert.equal(insertInto(datedRows(), { groupRowId: 220 }, 221, { canLink: false }).fields.Lien, undefined);
});

test("suppression d'une tâche : la chaîne se referme ; sans Lien, rien", () => {
  // DIFFUSION FDS (205) entre FOND DE PLAN (204) et RECEPTION RENDU (206), en fin → début.
  assert.deepEqual(entries(planTaskRemoval({ sections: sectionsOf(datedRows()), taskId: 205, canLink: true })), [
    [206, { Lien: "204 FD" }],
  ]);
  assert.equal(planTaskRemoval({ sections: sectionsOf(datedRows()), taskId: 205 }).size, 0);
});

test("suppression d'un cycle : les liens vers ses lignes sont effacés", () => {
  const removedIds = [210, 211, 212, 213, 214, 215, 216];
  assert.deepEqual(entries(planOrphanLinks({ sections: sectionsOf(datedRows()), removedIds, canLink: true })), [
    [218, { Lien: "" }],
  ]);
  assert.equal(planOrphanLinks({ sections: sectionsOf(datedRows()), removedIds }).size, 0);
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : échec — « does not provide an export named 'planInsertFollowUp' ».

- [ ] **Étape 3 : implémenter**

```diff
--- a/Planning Projet/assets/js/services/syntheseTaskOrder.js
+++ b/Planning Projet/assets/js/services/syntheseTaskOrder.js
@@ -6,8 +6,13 @@
   NO_ZONE_LABEL,
   PLANNING_TABLE,
   TASK_COLUMNS,
+  buildMoveFields,
+  buildNewTask,
+  buildTaskFields,
+  dateFieldsOf,
   resolveDropTarget,
 } from "./syntheseTaskModel.js";
+import { cascadeFrom, computeLinkedDates, formatLink } from "./syntheseLinks.js";
 
 // Place d'une tâche pas encore créée, dans un conteneur simulé (aucune ligne Grist n'a l'id 0).
 export const NEW_TASK_ID = 0;
@@ -131,3 +136,255 @@
   }
   return { ...target, label: `Déplacer à la fin de « ${line.kind === "group" ? line.groupLabel : line.floorName} »` };
 }
+
+/* ---------- Chaînage automatique ---------- */
+
+function allTasksOf(sections) {
+  return (sections || []).flatMap((section) => section.tasks);
+}
+
+function mergeChanges(target, source) {
+  source.forEach((fields, rowId) => target.set(rowId, { ...target.get(rowId), ...fields }));
+  return target;
+}
+
+function isFinishToStart(link, predId) {
+  return link?.type === "FD" && link.predId === predId;
+}
+
+function sameLink(left, right) {
+  if (!left || !right) return !left && !right;
+  return left.predId === right.predId && left.type === right.type && (left.lag || 0) === (right.lag || 0);
+}
+
+function sameDay(left, right) {
+  if (!(left instanceof Date) || !(right instanceof Date)) return left == null && right == null;
+  return left.getTime() === right.getTime();
+}
+
+// Lien de chaque tâche (id → { predId, type, lag } ou null).
+function linkMap(tasks) {
+  return new Map(tasks.map((task) => [task.id, task.link || null]));
+}
+
+// Colonne Lien des seules tâches dont le lien change ("" : plus de lien).
+function linkChanges(original, links) {
+  const changes = new Map();
+  links.forEach((link, rowId) => {
+    if (sameLink(original.get(rowId) || null, link)) return;
+    changes.set(rowId, { [TASK_COLUMNS.link]: link ? formatLink(link) : "" });
+  });
+  return changes;
+}
+
+// La chaîne se referme à l'ancienne place d'une tâche (A au-dessus, B en dessous, dans `order`) :
+// si elle suivait A et que B la suivait, en fin → début, B suit A avec son propre décalage.
+// Renvoie l'id de B rattachée, ou null.
+function closeChain(links, order, taskId) {
+  const index = order.indexOf(taskId);
+  if (index <= 0 || index >= order.length - 1) return null;
+  const above = order[index - 1];
+  const below = order[index + 1];
+  if (!isFinishToStart(links.get(taskId), above) || !isFinishToStart(links.get(below), taskId)) return null;
+  links.set(below, { predId: above, type: "FD", lag: links.get(below).lag || 0 });
+  return below;
+}
+
+// Une tâche à sa nouvelle place dans `order` (P au-dessus, N en dessous) : elle suit P — son lien
+// est gardé s'il désigne déjà P, quel que soit son type ; sans P, plus de lien. N la suit si N
+// suivait P en fin → début (décalage gardé). Jamais de boucle : si P dépend d'elle, la tâche de
+// la chaîne de P qui la suivait reprend son ancien lien (`former`), ou plus de lien.
+function placeInChain(links, order, taskId, former) {
+  const index = order.indexOf(taskId);
+  const above = index > 0 ? order[index - 1] : null;
+  const below = index >= 0 && index < order.length - 1 ? order[index + 1] : null;
+  if (above === null) links.set(taskId, null);
+  else if (links.get(taskId)?.predId !== above) links.set(taskId, { predId: above, type: "FD", lag: 0 });
+  if (above !== null && below !== null && isFinishToStart(links.get(below), above)) {
+    links.set(below, { predId: taskId, type: "FD", lag: links.get(below).lag || 0 });
+  }
+  const seen = new Set();
+  for (let current = above; current != null && !seen.has(current); current = links.get(current)?.predId ?? null) {
+    seen.add(current);
+    if (links.get(current)?.predId !== taskId) continue;
+    links.set(current, former && former.predId !== current ? { ...former } : null);
+    break;
+  }
+}
+
+// Les liens d'une ligne supprimée disparaissent avec elle : les tâches restantes qui la
+// désignaient n'ont plus de lien (Grist réutilise les ids).
+function clearOrphans(links, removed) {
+  links.forEach((link, rowId) => {
+    if (link && removed.has(link.predId) && !removed.has(rowId)) links.set(rowId, null);
+  });
+}
+
+// Dates après un changement de liens : chaque tâche racine prend les dates que lui donne son lien
+// (son prédécesseur doit être daté), puis ses tâches liées en aval suivent. Renvoie les champs de
+// dates des seules tâches qui changent.
+function recomputeDates(tasks, links, rootIds) {
+  const original = new Map(tasks.map((task) => [task.id, task]));
+  const current = new Map(tasks.map((task) => [task.id, { ...task, link: links.has(task.id) ? links.get(task.id) : task.link }]));
+  rootIds.forEach((rootId) => {
+    const root = current.get(rootId);
+    if (!root) return;
+    const pred = root.link ? current.get(root.link.predId) : null;
+    const dates = pred ? computeLinkedDates(pred, root.link, root.durationDays) : null;
+    const next = dates ? { ...root, ...dates } : root;
+    current.set(rootId, next);
+    cascadeFrom(next, [...current.values()]).forEach((update) => current.set(update.id, update));
+  });
+  const changes = new Map();
+  current.forEach((task, rowId) => {
+    const before = original.get(rowId);
+    if (sameDay(before.start, task.start) && sameDay(before.end, task.end) && before.isMilestone === task.isMilestone) return;
+    changes.set(rowId, dateFieldsOf(task));
+  });
+  return changes;
+}
+
+// Place d'une nouvelle tâche dans son conteneur : juste sous la tâche cliquée, sinon à la fin.
+function insertionIndex(items, afterTaskId) {
+  const index = afterTaskId ? items.findIndex((item) => item.kind === "task" && item.task.id === afterTaskId) : -1;
+  return index >= 0 ? index + 1 : items.length;
+}
+
+// Place visée par un dépôt dans `items` (sans la tâche déplacée) : avant ou après une tâche ;
+// sans position (ligne d'en-tête), ou tâche introuvable : à la fin.
+function slotIndex(items, position) {
+  const index = position ? items.findIndex((item) => item.kind === "task" && item.task.id === position.taskId) : -1;
+  if (index < 0) return items.length;
+  return position.side === "before" ? index : index + 1;
+}
+
+// « Ajouter une tâche » dans un conteneur ({ zoneKey, floorKey, groupRowId }), juste sous
+// `afterTaskId` s'il en fait partie, sinon à la fin. Sans la colonne Ordre (`canOrder` faux) : à
+// la fin, sans rang ni lien, comme avant ; `atEnd` dit qu'une place sous une tâche était demandée.
+// Avec Ordre et Lien (`canLink`) : la tâche suit la tâche du dessus (FD) et en prend ses dates —
+// sans dates si celle-ci n'en a pas ; `follow` désigne la tâche du dessous qui devra la suivre une
+// fois son id connu. Renvoie la tâche, ses champs Grist, les rangs des autres lignes, `follow`,
+// `atEnd` ; null si le conteneur n'existe pas.
+export function planTaskInsert({
+  sections,
+  container,
+  afterTaskId = null,
+  canOrder = false,
+  canLink = false,
+  today = new Date(),
+  projectName = "",
+} = {}) {
+  const destination = findContainer(sections, container || {});
+  if (!destination) return null;
+  const { section, floor, group } = destination;
+  let task = buildNewTask({
+    zoneName: section.zoneName,
+    groupName: floor ? floor.name : "",
+    groupTasks: group ? group.tasks : floor ? floor.tasks : destination.items.map((item) => item.task),
+    today,
+    parentId: group ? group.rowId : null,
+  });
+  const changes = new Map();
+  const extra = {};
+  let follow = null;
+  if (canOrder) {
+    const index = insertionIndex(destination.items, afterTaskId);
+    const placeholder = { kind: "task", task: { id: NEW_TASK_ID, order: null } };
+    const placed = [...destination.items.slice(0, index), placeholder, ...destination.items.slice(index)];
+    mergeChanges(changes, renumberItems(placed));
+    extra[TASK_COLUMNS.order] = String(index + 1);
+    if (canLink) {
+      const order = taskOrder(destination, new Map([[destination.key, placed]]));
+      const at = order.indexOf(NEW_TASK_ID);
+      const tasksById = new Map(allTasksOf(sections).map((candidate) => [candidate.id, candidate]));
+      const above = at > 0 ? tasksById.get(order[at - 1]) : null;
+      const below = at < order.length - 1 ? tasksById.get(order[at + 1]) : null;
+      if (above) {
+        const link = { predId: above.id, type: "FD", lag: 0 };
+        const dates = computeLinkedDates(above, link, 1) || { start: null, end: null, durationDays: 1, isMilestone: false };
+        task = { ...task, ...dates, link };
+        extra[TASK_COLUMNS.link] = formatLink(link);
+        if (below && isFinishToStart(below.link, above.id)) follow = { successorId: below.id, lag: below.link.lag || 0 };
+      }
+    }
+  }
+  return {
+    task,
+    fields: { ...buildTaskFields(task, { projectName }), ...extra },
+    changes,
+    follow,
+    atEnd: Boolean(afterTaskId) && !canOrder,
+  };
+}
+
+// Second temps d'un ajout (voir planTaskInsert) : une fois connu l'id de la nouvelle tâche, la
+// tâche du dessous la suit (avec son décalage) et ses dates suivent en cascade.
+export function planInsertFollowUp({ sections, newTask, successorId, lag = 0 } = {}) {
+  const tasks = [...allTasksOf(sections).filter((task) => task.id !== newTask.id), newTask];
+  const links = linkMap(tasks);
+  if (!links.has(successorId)) return new Map();
+  const original = new Map(links);
+  links.set(successorId, { predId: newTask.id, type: "FD", lag });
+  return mergeChanges(linkChanges(original, links), recomputeDates(tasks, links, [successorId]));
+}
+
+// Glisser une tâche vers une cible (conteneur, et `position` { taskId, side } avec la colonne
+// Ordre) : ses champs de déplacement (Zone, Groupe, Parent), les rangs du conteneur d'arrivée,
+// et avec Lien (`canLink`) la chaîne refermée à l'ancienne place, la tâche chaînée à la nouvelle
+// et les dates qui suivent. Champs par ligne ; vide si rien ne change (même place).
+export function planTaskMove({ sections, taskId, target, canOrder = false, canLink = false } = {}) {
+  const source = locateTask(sections, taskId);
+  const destination = findContainer(sections, target || {});
+  if (!source || !destination) return new Map();
+  const item = source.items.find((candidate) => candidate.kind === "task" && candidate.task.id === taskId);
+  const moveFields = buildMoveFields(item.task, target);
+  const changes = new Map();
+  if (Object.keys(moveFields).length) changes.set(taskId, moveFields);
+  if (!canOrder) return changes;
+  const remaining = destination.items.filter((candidate) => candidate !== item);
+  const index = slotIndex(remaining, target.position);
+  const placed = [...remaining.slice(0, index), item, ...remaining.slice(index)];
+  if (source.key === destination.key && placed.every((candidate, at) => candidate === destination.items[at])) {
+    return new Map();
+  }
+  mergeChanges(changes, renumberItems(placed));
+  if (!canLink) return changes;
+  const overrides = new Map([[destination.key, placed]]);
+  if (source.key !== destination.key) overrides.set(source.key, source.items.filter((candidate) => candidate !== item));
+  const tasks = allTasksOf(sections);
+  const links = linkMap(tasks);
+  const original = new Map(links);
+  const former = links.get(taskId);
+  const closed = closeChain(links, taskOrder(source), taskId);
+  placeInChain(links, taskOrder(destination, overrides), taskId, former);
+  mergeChanges(changes, linkChanges(original, links));
+  return mergeChanges(changes, recomputeDates(tasks, links, [closed, taskId].filter((rowId) => rowId != null)));
+}
+
+// Supprimer une tâche : avec Lien, la chaîne se referme à sa place (puis les dates suivent) et
+// les autres liens qui la désignaient sont effacés. Champs des lignes restantes.
+export function planTaskRemoval({ sections, taskId, canLink = false } = {}) {
+  if (!canLink) return new Map();
+  const container = locateTask(sections, taskId);
+  const tasks = allTasksOf(sections);
+  const links = linkMap(tasks);
+  const original = new Map(links);
+  const closed = container ? closeChain(links, taskOrder(container), taskId) : null;
+  clearOrphans(links, new Set([taskId]));
+  links.delete(taskId);
+  original.delete(taskId);
+  const remaining = tasks.filter((task) => task.id !== taskId);
+  return mergeChanges(linkChanges(original, links), recomputeDates(remaining, links, closed ? [closed] : []));
+}
+
+// Supprimer un étage, un cycle ou un sous-groupe (`removedIds` : toutes ses lignes) : avec Lien,
+// les liens des tâches restantes qui désignaient une ligne supprimée sont effacés.
+export function planOrphanLinks({ sections, removedIds = [], canLink = false } = {}) {
+  if (!canLink) return new Map();
+  const removed = new Set(removedIds);
+  const tasks = allTasksOf(sections).filter((task) => !removed.has(task.id));
+  const links = linkMap(tasks);
+  const original = new Map(links);
+  clearOrphans(links, removed);
+  return linkChanges(original, links);
+}
```

- [ ] **Étape 4 : vérifier qu'ils passent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : **596** tests, 0 échec.

- [ ] **Pas de commit** : l'utilisateur commite lui-même (il teste l'arbre de travail sur localhost). Vérifier seulement `git status` : rien hors des fichiers de la tâche.

---

### Tâche 4 : le contrôleur écrit les plans

**Fichiers :**
- Créer : `tests/syntheseTaskOrderController.test.mjs`
- Modifier : `assets/js/ui/syntheseTasksController.js`

**Interfaces :**
- Consomme : `detectOrderColumn` (tâche 1) ; `buildUpdateActions`, `planTaskInsert`, `planInsertFollowUp`, `planTaskMove`, `planTaskRemoval`, `planOrphanLinks` (tâches 2 et 3).
- Produit : rappel du tableau `onAddTask(zoneKey, floorKey, groupRowId, afterTaskId)` ; option de rendu `canOrder` (colonne Ordre présente) ; `onMoveTask(taskId, target)` accepte `target.position`.

- [ ] **Étape 1 : écrire les tests**

Créer `tests/syntheseTaskOrderController.test.mjs` :

```js
// Contrôleur du tableau Synthese avec la colonne Ordre : ajout sous la tâche cliquée, ajout en deux
// temps quand la tâche du dessous doit suivre, déplacement à une place, suppression qui referme la
// chaîne ; sans la colonne, comme avant.
import test from "node:test";
import assert from "node:assert/strict";

import { createSyntheseTasksController } from "../assets/js/ui/syntheseTasksController.js";
import { datedRows } from "./helpers/templateRows.mjs";

const ZONE = "zonez3a";
const TODAY = new Date(2026, 8, 23);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Étage SS1 du modèle daté (ids 201 à 226) ; `withOrder` : la colonne Ordre existe (vide).
function floorRows({ withOrder = true } = {}) {
  return datedRows().map((row) => (withOrder ? { ...row, Ordre: "" } : row));
}

function setup({ rows = floorRows(), applyUserActions = null } = {}) {
  const state = { currentProject: { name: "HOTEL DIEU", names: ["HOTEL DIEU"] }, accessMode: "editable", selectedService: "Synthese" };
  const context = {
    async fetchContextRows() {
      return rows.map((row) => ({ ...row }));
    },
    getState: () => ({ ...state, currentProject: { ...state.currentProject } }),
    subscribe() { return () => {}; },
    watchProjectZones() { return () => {}; },
  };
  const writes = [];
  const docApi = {
    async applyUserActions(actions) {
      writes.push(actions);
      return applyUserActions ? applyUserActions(actions, writes.length) : { retValues: [] };
    },
  };
  const table = { renders: [], statuses: [], editing: [] };
  const controller = createSyntheseTasksController({
    context,
    docApi,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return {
        render: (lines, options) => table.renders.push({ lines, options }),
        setStatus: (text, tone) => table.statuses.push({ text, tone }),
        startEditing: (taskId, field) => table.editing.push({ taskId, field }),
        startEditingFloor: () => {},
      };
    },
    confirm: () => true,
    now: () => TODAY,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const keys = () => table.renders.at(-1).lines.map((line) => line.key);
  return { writes, table, controller, keys };
}

async function activate(env) {
  env.controller.setEditingEnabled(true);
  env.controller.setActive(true);
  await flush();
}

test("colonne Ordre : le tableau le sait (glisser entre deux tâches)", async () => {
  const withColumn = setup();
  await activate(withColumn);
  assert.equal(withColumn.table.renders.at(-1).options.canOrder, true);
  const without = setup({ rows: floorRows({ withOrder: false }) });
  await activate(without);
  assert.equal(without.table.renders.at(-1).options.canOrder, false);
});

test("« Ajouter une tâche » sur TERMINAUX : une écriture — la tâche, son rang, son lien, les rangs des autres", async () => {
  const env = setup({ applyUserActions: () => ({ retValues: [400] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 220, 223);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.writes[0], [
    ["AddRecord", "Planning_Projet", null, {
      Taches: "Nouvelle tâche", Diff_coffrage: "2026-02-24", Diff_armature: "2026-02-24", Duree_1: 1,
      NomProjet: "HOTEL DIEU", Zone: "Zone Z3A", Groupe: "SS1", Parent: "220", Ordre: "4", Lien: "223 FD",
    }],
    ["BulkUpdateRecord", "Planning_Projet", [221, 222, 223], { Ordre: ["1", "2", "3"] }],
  ]);
  const keys = env.keys();
  assert.deepEqual(keys.slice(keys.indexOf("task:221"), keys.indexOf("task:221") + 4), ["task:221", "task:222", "task:223", "task:400"]);
  assert.deepEqual(env.table.editing.at(-1), { taskId: 400, field: "name" });
  assert.equal(env.table.statuses.at(-1).text, "Tâche ajoutée dans « PLAN SYT CYCLE 3 ».");
});

test("ajout dans une chaîne : la tâche d'abord, puis la tâche du dessous la suit (deuxième écriture)", async () => {
  const env = setup({ applyUserActions: (_actions, count) => ({ retValues: count === 1 ? [400] : [] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 203, 206);
  assert.equal(env.writes.length, 2);
  assert.deepEqual(env.writes[0][0][3].Lien, "206 FD");
  assert.deepEqual(env.writes[1], [
    ["UpdateRecord", "Planning_Projet", 207, { Lien: "400 FD", Diff_coffrage: "2026-01-21", Diff_armature: "2026-02-03", Duree_1: 10 }],
  ]);
  const visa = env.table.renders.at(-1).lines.find((line) => line.key === "task:207");
  assert.equal(visa.link.predId, 400, "VISA 0 suit la nouvelle tâche à l'affichage");
});

test("second temps refusé : la tâche créée est retirée, rien n'est gardé", async () => {
  const env = setup({
    applyUserActions: (actions, count) => {
      if (count === 2) throw new Error("refus Grist");
      return { retValues: count === 1 ? [400] : [] };
    },
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await activate(env);
    await env.table.callbacks.onAddTask(ZONE, "ss1", 203, 206);
  } finally {
    console.error = original;
  }
  assert.deepEqual(env.writes[2], [["RemoveRecord", "Planning_Projet", 400]]);
  assert.equal(env.table.statuses.at(-1).text, "La tâche n'a pas pu être ajoutée complètement : rien n'a été gardé. Réessayez.");
  assert.equal(env.keys().includes("task:400"), false);
});

test("glisser TERMINAUX avant RÉSERVATIONS : les rangs, en une écriture, affichés tout de suite", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onMoveTask(223, {
    key: "slot:222:before", zoneKey: ZONE, zoneName: "Zone Z3A", floorKey: "ss1", floorName: "SS1", groupRowId: 220,
    label: "", position: { taskId: 222, side: "before" },
  });
  assert.deepEqual(env.writes[0], [
    ["BulkUpdateRecord", "Planning_Projet", [221, 222, 223], { Ordre: ["1", "3", "2"] }],
  ]);
  const keys = env.keys();
  assert.deepEqual(keys.slice(keys.indexOf("task:221"), keys.indexOf("task:221") + 3), ["task:221", "task:223", "task:222"]);
});

test("supprimer DIFFUSION FDS : la chaîne se referme dans la même écriture", async () => {
  const env = setup();
  await activate(env);
  await env.table.callbacks.onDeleteTask(205);
  assert.deepEqual(env.writes[0], [
    ["RemoveRecord", "Planning_Projet", 205],
    ["UpdateRecord", "Planning_Projet", 206, { Lien: "204 FD" }],
  ]);
});

test("sans la colonne Ordre : la tâche va à la fin, sans rang ni lien, et la barre d'état le dit", async () => {
  const env = setup({ rows: floorRows({ withOrder: false }), applyUserActions: () => ({ retValues: [400] }) });
  await activate(env);
  await env.table.callbacks.onAddTask(ZONE, "ss1", 220, 221);
  assert.equal(env.writes[0].length, 1);
  const fields = env.writes[0][0][3];
  assert.deepEqual([fields.Ordre, fields.Lien, fields.Parent], [undefined, undefined, "220"]);
  assert.equal(
    env.table.statuses.at(-1).text,
    "Tâche ajoutée à la fin de « PLAN SYT CYCLE 3 » : la colonne « Ordre » (Texte) manque dans Planning_Projet pour la placer sous « PLAN DE SYNTHESE RESEAUX NIV SS1 »."
  );
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : 7 échecs dans ce fichier (pas d'option `canOrder`, écritures d'avant).

- [ ] **Étape 3 : implémenter**

```diff
--- a/Planning Projet/assets/js/ui/syntheseTasksController.js
+++ b/Planning Projet/assets/js/ui/syntheseTasksController.js
@@ -15,14 +15,12 @@
   buildGroupDeleteActions,
   buildGroupDeleteQuestion,
   buildGroupRenameAction,
-  buildMoveFields,
-  buildNewTask,
   buildRowModel,
   buildSections,
-  buildTaskFields,
   dateFieldsOf,
   detectFloorColumn,
   detectFormworkCheckColumn,
+  detectOrderColumn,
   detectStructureLinkColumn,
   detectTemplateColumns,
   findGroup,
@@ -43,6 +41,14 @@
 } from "../services/syntheseFloorTemplate.js";
 import { cascadeFrom } from "../services/syntheseLinks.js";
 import {
+  buildUpdateActions,
+  planInsertFollowUp,
+  planOrphanLinks,
+  planTaskInsert,
+  planTaskMove,
+  planTaskRemoval,
+} from "../services/syntheseTaskOrder.js";
+import {
   applyControlTasks,
   applyEndLimits,
   applyFloorLinks,
@@ -75,6 +81,8 @@
   noFloorRow: "Cet étage n'a pas de ligne « étage » dans Planning_Projet : le lien ne peut pas être mémorisé.",
   noPlanTask: "Cet étage n'a pas de tâche « FOND DE PLAN DE SYNTHESE » : aucune date ne peut être posée.",
   badIssueDate: "La date 0 Prev de ce coffrage n'est pas utilisable (elle doit être entre 2000 et 2100) : corrigez-la dans la liste de plans.",
+  insertFailed: "La tâche n'a pas pu être ajoutée complètement : rien n'a été gardé. Réessayez.",
+  insertCleanupFailed: "La tâche n'a pas pu être ajoutée complètement et n'a pas pu être retirée : supprimez « Nouvelle tâche » à la main.",
 });
 
 // Seul cas où la création d'un étage ne peut ni réussir ni être annulée : le dire précisément.
@@ -161,6 +169,9 @@
   let structureLinkColumn = null;
   // Colonne Controle_Coffrage (tâche contrôlée choisie à la main) : même principe que Etage.
   let formworkCheckColumn = null;
+  // Colonne Ordre (rang libre des tâches) : même principe que Etage. Sans elle, ni ordre libre
+  // ni chaînage automatique.
+  let orderColumn = null;
   // Opérations affichées mais pas encore enregistrées, dans l'ordre (voir submit).
   let pendingOps = [];
   let writeQueue = Promise.resolve();
@@ -175,7 +186,9 @@
     onEdit: (taskId, field, rawValue) => handleEdit(taskId, field, rawValue),
     onRenameFloor: (zoneKey, floorKey, rawValue) => handleRenameFloor(zoneKey, floorKey, rawValue),
     onRenameGroup: (groupRowId, rawValue) => handleRenameGroup(groupRowId, rawValue),
-    onAddTask: (zoneKey, floorKey = "", groupRowId = null) => handleAddTask(zoneKey, floorKey, groupRowId),
+    onAddTask: (zoneKey, floorKey = "", groupRowId = null, afterTaskId = null) => (
+      handleAddTask(zoneKey, floorKey, groupRowId, afterTaskId)
+    ),
     onAddFloor: (zoneKey) => handleAddFloor(zoneKey),
     onDeleteTask: (taskId) => handleDeleteTask(taskId),
     onDeleteFloor: (zoneKey, floorKey) => handleDeleteFloor(zoneKey, floorKey),
@@ -295,6 +308,7 @@
       editable: isEditable(),
       emptyMessage,
       canAddFloor: floorColumn !== false && templateColumns !== false,
+      canOrder: orderColumn === true,
     });
   }
 
@@ -331,6 +345,7 @@
       templateColumns = null;
       structureLinkColumn = null;
       formworkCheckColumn = null;
+      orderColumn = null;
       rows = [];
       formworkStarts = [];
       startsDue = true;
@@ -370,6 +385,7 @@
     templateColumns = detectTemplateColumns(rows);
     structureLinkColumn = detectStructureLinkColumn(rows);
     formworkCheckColumn = detectFormworkCheckColumn(rows);
+    orderColumn = detectOrderColumn(rows);
     readError = false;
     loaded = true;
     render();
@@ -549,9 +565,46 @@
     return section?.floors.find((floor) => floor.key === floorKey) || null;
   }
 
+  // Second temps d'un ajout dont la tâche du dessous doit suivre la nouvelle : la tâche (son id
+  // d'abord), puis le lien de la tâche du dessous et les dates qui suivent. Si ce second temps
+  // échoue, la tâche créée est retirée : rien de bancal ne reste dans Grist.
+  async function addThenFollow(op, plan, addActions) {
+    const added = await write(addActions);
+    const newId = Number(added?.retValues?.[0]);
+    if (!Number.isInteger(newId) || newId <= 0) return { newId: null, followChanges: new Map() };
+    try {
+      assertSameContext(op.context);
+      const followChanges = planInsertFollowUp({
+        sections: allSections(),
+        newTask: { ...plan.task, id: newId },
+        successorId: plan.follow.successorId,
+        lag: plan.follow.lag,
+      });
+      if (followChanges.size) await write(buildUpdateActions(followChanges));
+      return { newId, followChanges };
+    } catch (error) {
+      let cleanupFailed = false;
+      try {
+        // Annulation de notre propre écriture : directement par docApi, comme pour un étage.
+        await docApi.applyUserActions([["RemoveRecord", PLANNING_TABLE, newId]]);
+      } catch (cleanupError) {
+        console.error("Tâche incomplète non retirée :", cleanupError);
+        cleanupFailed = true;
+      }
+      const failure = new Error(MESSAGES.insertFailed, { cause: error });
+      failure.userMessage = cleanupFailed
+        ? MESSAGES.insertCleanupFailed
+        : describeWriteError(error) === MESSAGES.contextChanged
+          ? MESSAGES.contextChanged
+          : MESSAGES.insertFailed;
+      throw failure;
+    }
+  }
+
   // Nouvelle tâche dans un conteneur : un groupe (cycle ou sous-groupe), un étage, ou le
-  // niveau zone.
-  function handleAddTask(zoneKey, floorKey = "", groupRowId = null) {
+  // niveau zone ; juste sous la tâche cliquée (`afterTaskId`) avec la colonne Ordre, sinon à la
+  // fin. Avec Ordre et Lien, elle suit la tâche du dessus (voir planTaskInsert).
+  function handleAddTask(zoneKey, floorKey = "", groupRowId = null, afterTaskId = null) {
     if (!isEditable()) {
       refuseLocked();
       return Promise.resolve();
@@ -563,26 +616,37 @@
     const wantedFloorKey = group ? group.floorKey : floorKey;
     const floor = wantedFloorKey ? findFloor(section, wantedFloorKey) : null;
     if (!project || !section || (wantedFloorKey && !floor)) return Promise.resolve();
-    const groupTasks = group
-      ? group.tasks
-      : floor
-        ? floor.tasks
-        : section.items.filter((item) => item.kind === "task").map((item) => item.task);
-    const task = buildNewTask({
-      zoneName: section.zoneName,
-      groupName: floor ? floor.name : "",
-      groupTasks,
+    const plan = planTaskInsert({
+      sections: allSections(),
+      container: { zoneKey: section.zoneKey, floorKey: floor ? floor.key : "", groupRowId: group ? group.rowId : null },
+      afterTaskId,
+      canOrder: orderColumn === true,
+      canLink: templateColumns === true,
       today: now(),
-      parentId: group ? group.rowId : null,
+      projectName: project.name,
     });
-    const fields = buildTaskFields(task, { projectName: project.name });
+    if (!plan) return Promise.resolve();
+    const { fields } = plan;
     const where = group ? `« ${group.name} »` : floor ? `l'étage « ${floor.name} »` : `« ${section.label} »`;
+    const clicked = plan.atEnd ? findTask(afterTaskId) : null;
+    const addedText = clicked
+      ? `Tâche ajoutée à la fin de ${where} : la colonne « Ordre » (Texte) manque dans Planning_Projet pour la placer sous « ${clicked.name} ».`
+      : `Tâche ajoutée dans ${where}.`;
+    const addActions = [["AddRecord", PLANNING_TABLE, null, fields], ...buildUpdateActions(plan.changes)];
     clearStatus();
-    return submit(createOp({ actions: [["AddRecord", PLANNING_TABLE, null, fields]] }), {
+    const op = createOp({
+      changes: plan.changes,
+      ...(plan.follow ? { perform: () => addThenFollow(op, plan, addActions) } : { actions: addActions }),
+    });
+    return submit(op, {
       onSuccess: (result) => {
-        const newId = Number(result?.retValues?.[0]);
+        const newId = Number(plan.follow ? result?.newId : result?.retValues?.[0]);
         const hasId = Number.isInteger(newId) && newId > 0;
         if (hasId && !findRow(newId)) rows = [...rows, { id: newId, ...fields }];
+        (result?.followChanges || new Map()).forEach((followFields, rowId) => {
+          const row = findRow(rowId);
+          if (row) Object.assign(row, followFields);
+        });
         collapsedZoneKeys.delete(section.zoneKey);
         if (floor) collapsedFloorKeys.delete(floorCollapseKey(section.zoneKey, floor.key));
         for (let container = group; container; container = container.parentGroup) {
@@ -590,7 +654,7 @@
         }
         render();
         if (hasId) table.startEditing(newId, "name");
-        info(`Tâche ajoutée dans ${where}.`);
+        info(addedText);
       },
       onFailure: (error, dropped) => fail("Ajout de la tâche impossible :", error, dropped),
     });
@@ -604,10 +668,13 @@
     const task = findTask(taskId);
     if (!task || !findRow(taskId)) return Promise.resolve();
     if (!confirm(`Supprimer la tâche « ${task.name} » ?`)) return Promise.resolve();
+    // Avec Lien : la chaîne se referme à sa place, les liens qui la désignaient sont effacés.
+    const changes = planTaskRemoval({ sections: allSections(), taskId, canLink: templateColumns === true });
     clearStatus();
     return submit(createOp({
+      changes,
       removals: [taskId],
-      actions: [["RemoveRecord", PLANNING_TABLE, taskId]],
+      actions: [["RemoveRecord", PLANNING_TABLE, taskId], ...buildUpdateActions(changes)],
     }), {
       onSuccess: () => info(`Tâche « ${task.name} » supprimée.`),
       onFailure: (error, dropped) => fail("Suppression de la tâche impossible :", error, dropped),
@@ -745,10 +812,14 @@
     const floor = findFloor(findSection(zoneKey), floorKey);
     if (!floor) return Promise.resolve();
     if (!confirm(buildFloorDeleteQuestion(floor))) return Promise.resolve();
+    const removals = floorRemovalIds(floor);
+    // Avec Lien : les liens des autres tâches vers les lignes supprimées sont effacés.
+    const changes = planOrphanLinks({ sections: allSections(), removedIds: removals, canLink: templateColumns === true });
     clearStatus();
     return submit(createOp({
-      removals: floorRemovalIds(floor),
-      actions: buildFloorDeleteActions(floor),
+      changes,
+      removals,
+      actions: [...buildFloorDeleteActions(floor), ...buildUpdateActions(changes)],
     }), {
       onSuccess: () => {
         // Grist réutilise les ids : sans ce nettoyage, un étage recréé plus tard avec les
@@ -797,8 +868,15 @@
     const group = findGroup(sections, groupRowId);
     if (!group) return Promise.resolve();
     if (!confirm(buildGroupDeleteQuestion(group))) return Promise.resolve();
+    const removals = groupRemovalIds(group);
+    // Avec Lien : les liens des autres tâches vers les lignes supprimées sont effacés.
+    const changes = planOrphanLinks({ sections: allSections(), removedIds: removals, canLink: templateColumns === true });
     clearStatus();
-    return submit(createOp({ removals: groupRemovalIds(group), actions: buildGroupDeleteActions(group) }), {
+    return submit(createOp({
+      changes,
+      removals,
+      actions: [...buildGroupDeleteActions(group), ...buildUpdateActions(changes)],
+    }), {
       onSuccess: () => {
         // Même raison que pour un étage supprimé : les ids réutilisés ne doivent pas hériter
         // d'un repli du cycle ou sous-groupe supprimé.
@@ -810,7 +888,9 @@
     });
   }
 
-  // Glisser-déposer : la tâche change de zone et / ou d'étage ; le conteneur visé est déplié.
+  // Glisser-déposer : la tâche change de conteneur et / ou de place (colonne Ordre) ; avec Ordre
+  // et Lien, la chaîne se referme à l'ancienne place et se renoue à la nouvelle, et les dates
+  // suivent (voir planTaskMove). Le conteneur visé est déplié.
   function handleMoveTask(taskId, target) {
     if (!isEditable()) {
       refuseLocked();
@@ -818,18 +898,21 @@
     }
     const task = findTask(taskId);
     if (!task || !findRow(taskId) || !target) return;
-    const fields = buildMoveFields(task, target);
-    if (!Object.keys(fields).length) return;
+    const changes = planTaskMove({
+      sections: allSections(),
+      taskId,
+      target,
+      canOrder: orderColumn === true,
+      canLink: templateColumns === true,
+    });
+    if (!changes.size) return;
     collapsedZoneKeys.delete(target.zoneKey);
     if (target.floorKey) collapsedFloorKeys.delete(floorCollapseKey(target.zoneKey, target.floorKey));
     for (let container = findGroup(sections, target.groupRowId); container; container = container.parentGroup) {
       collapsedGroupKeys.delete(groupCollapseKey(container.rowId));
     }
     clearStatus();
-    void submit(createOp({
-      changes: new Map([[taskId, fields]]),
-      actions: [["UpdateRecord", PLANNING_TABLE, taskId, fields]],
-    }), {
+    void submit(createOp({ changes, actions: buildUpdateActions(changes) }), {
       onFailure: (error, dropped) => fail("Déplacement de la tâche impossible :", error, dropped),
     });
   }
```

- [ ] **Étape 4 : vérifier qu'ils passent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : **603** tests, 0 échec. Les tests existants du contrôleur passent sans changement (leurs lignes n'ont pas de colonne Ordre ; la suppression d'un cycle du modèle ajoute une écriture de lien orphelin, que le test existant ne vérifie pas).

- [ ] **Pas de commit** : l'utilisateur commite lui-même (il teste l'arbre de travail sur localhost). Vérifier seulement `git status` : rien hors des fichiers de la tâche.

---

### Tâche 5 : glisser entre deux tâches, trait d'insertion, menu

**Fichiers :**
- Modifier : `tests/syntheseTaskDrag.test.mjs`, `tests/syntheseTaskTable.test.mjs`, `assets/js/ui/syntheseTaskDrag.js`, `assets/js/ui/syntheseTaskTable.js`, `assets/css/styles.css`

**Interfaces :**
- Consomme : `resolveDropSlot` (tâche 2) ; option `canOrder` et rappel `onAddTask(…, afterTaskId)` (tâche 4).
- Produit : `createTaskDrag({ …, canOrder: () => boolean, markSlot: (slot | null) => void })` (défauts : faux, rien) ; le menu d'une tâche porte `afterTaskId`.

- [ ] **Étape 1 : écrire les tests**

```diff
--- a/Planning Projet/tests/syntheseTaskDrag.test.mjs
+++ b/Planning Projet/tests/syntheseTaskDrag.test.mjs
@@ -36,7 +36,7 @@
   return grips;
 }
 
-function setup({ enabled = true } = {}) {
+function setup({ enabled = true, canOrder = false } = {}) {
   globalThis.Element = FakeElement;
   const env = createFakeEnvironment();
   const root = new FakeElement("div", "stt");
@@ -50,6 +50,7 @@
   const highlights = [];
   const previews = [];
   const sources = [];
+  const slots = [];
   createTaskDrag({
     root,
     scroller,
@@ -67,13 +68,15 @@
       return preview;
     },
     markSource: (key) => sources.push(key),
+    canOrder: () => canOrder,
+    markSlot: (slot) => slots.push(slot),
     onDrop: (taskId, target) => drops.push({ taskId, target }),
     doc: env.doc,
     win: env.win,
   });
   const ghost = () => root.children.find((node) => node.classes.has("stt-drag-ghost")) || null;
   const caption = () => ghost()?.children.find((node) => node.classes.has("stt-drag-ghost__label")) || null;
-  return { env, root, scroller, body, grips, drops, highlights, previews, sources, ghost, caption };
+  return { env, root, scroller, body, grips, drops, highlights, previews, sources, slots, ghost, caption };
 }
 
 // Appui à x = 20 ; les mouvements se font par défaut à x = 30 (au-delà du seuil de 4 px).
@@ -276,3 +279,39 @@
   assert.equal(scroller.scrollTop, 0);
   assert.equal(env.frames.size, 0, "plus d'image demandée en haut de la liste");
 });
+
+// ---------- Ordre libre (colonne Ordre) : placer une tâche avant ou après une autre ----------
+
+test("avec la colonne Ordre : moitié haute d'une tâche → « Placer avant », trait d'insertion, dépôt à cette place", () => {
+  const { scroller, grips, drops, highlights, slots, caption } = setup({ canOrder: true });
+  press(grips.get(1), rowY(1));
+  move(scroller, 100 + 3 * ROW + 4);
+  assert.equal(caption().textContent, "Placer avant « FOND DE PLAN »");
+  assert.deepEqual(slots.at(-1), { taskId: 2, side: "before" });
+  assert.equal(highlights.at(-1), null, "pas de conteneur surligné : le trait suffit");
+  release(scroller, 100 + 3 * ROW + 4);
+  assert.deepEqual(drops.map((drop) => [drop.taskId, drop.target.key, drop.target.position]), [
+    [1, "slot:2:before", { taskId: 2, side: "before" }],
+  ]);
+  assert.equal(slots.at(-1), null, "trait retiré à la fin du glisser");
+});
+
+test("avec la colonne Ordre : moitié basse → « Placer après » ; dans son propre conteneur aussi", () => {
+  const { scroller, grips, slots, caption } = setup({ canOrder: true });
+  press(grips.get(2), rowY(3));
+  move(scroller, 100 + 4 * ROW + 20);
+  assert.equal(caption().textContent, "Placer après « Visa MOE »");
+  assert.deepEqual(slots.at(-1), { taskId: 3, side: "after" });
+  move(scroller, rowY(3));
+  assert.equal(caption().hidden, true, "sur elle-même : nulle part");
+  assert.equal(slots.at(-1), null);
+});
+
+test("avec la colonne Ordre : sur une ligne d'étage, la fin de l'étage, surligné", () => {
+  const { scroller, grips, highlights, slots, caption } = setup({ canOrder: true });
+  press(grips.get(3), rowY(4));
+  move(scroller, rowY(2));
+  assert.equal(caption().textContent, "Déplacer à la fin de « PH RDB »", "son propre étage : la fin");
+  assert.equal(highlights.at(-1), "floor:zonez3a/phrdb");
+  assert.equal(slots.at(-1), null);
+});
```

```diff
--- a/Planning Projet/tests/syntheseTaskTable.test.mjs
+++ b/Planning Projet/tests/syntheseTaskTable.test.mjs
@@ -96,7 +96,7 @@
     { label: "Supprimer l'étage", action: "deleteFloor", zoneKey: "zonez3a", floorKey: "phrdb", danger: true },
   ]);
   assert.deepEqual(buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "phrdb", taskId: 5 }), [
-    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb" },
+    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb", afterTaskId: 5 },
     { label: "Contrôler par rapport au coffrage", action: "setFormworkCheck", taskId: 5, checked: true },
     { label: "Supprimer la tâche", action: "deleteTask", taskId: 5, danger: true },
   ]);
@@ -195,7 +195,7 @@
   assert.equal(buildMenuItems({ ...cycle, nature: "sous-groupe", groupRowId: 212 })[1].label, "Supprimer le sous-groupe");
   assert.deepEqual(
     buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, taskId: 204 })[0],
-    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203 }
+    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, afterTaskId: 204 }
   );
 });
 
@@ -206,7 +206,7 @@
   assert.match(source, /await onRenameGroup\?\.\(target\.groupRowId, value\)/);
   assert.match(source, /\{ type: "toggleGroup", groupRowId: Number\(groupRowId\) \}/);
   assert.match(source, /onDeleteGroup\?\.\(item\.groupRowId\)/);
-  assert.match(source, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null\)/);
+  assert.match(source, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null, item\.afterTaskId \?\? null\)/);
   assert.match(source, /setStatus,\s*startEditingGroup,/);
   assert.match(source, /input\.maxLength = 50;/);
 });
@@ -317,3 +317,22 @@
   const naming = sliceBetween(source, "function buildNameCell(", "function buildLine(");
   assert.match(naming, /if \(line\.kind === "floor" && line\.structureLinkNote\) cell\.appendChild\(buildLinkBadge\(line\)\);/);
 });
+
+// ---------- Ordre libre (colonne Ordre) ----------
+
+test("« Ajouter une tâche » sur une tâche : la tâche cliquée va au contrôleur", () => {
+  const running = sliceBetween(source, "function runMenuItem(", "function openMenu(");
+  assert.match(running, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null, item\.afterTaskId \?\? null\)/);
+});
+
+test("glisser entre deux tâches : seulement avec la colonne Ordre, en mode modifiable ; trait d'insertion", () => {
+  assert.match(source, /canOrder = Boolean\(options\?\.canOrder\);/);
+  assert.match(source, /canOrder: \(\) => canOrder && editable,/);
+  assert.match(source, /markSlot: markDropSlot,/);
+  const placing = sliceBetween(source, "function placeDropLine(", "function markDropSlot(");
+  assert.match(placing, /const boundary = index \+ \(dropSlot\.side === "after" \? 1 : 0\);/);
+  assert.match(placing, /dropLine\.style\.top = \`\$\{HEAD_HEIGHT_PX \+ boundary \* ROW_HEIGHT_PX\}px\`;/);
+  assert.match(sliceBetween(source, "function draw(", "const renderer ="), /placeDropLine\(\);/);
+  assert.match(css, /\.stt-drop-line\s*\{[^}]*position:\s*absolute;[^}]*height:\s*2px;[^}]*background:\s*var\(--stt-accent\);[^}]*pointer-events:\s*none;/);
+  assert.match(css, /\.stt-drop-line\[hidden\]\s*\{\s*display:\s*none;/);
+});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : 8 échecs (3 tests du glisser, menus, câblage du tableau, trait d'insertion).

- [ ] **Étape 3 : implémenter**

```diff
--- a/Planning Projet/assets/js/ui/syntheseTaskDrag.js
+++ b/Planning Projet/assets/js/ui/syntheseTaskDrag.js
@@ -3,9 +3,11 @@
 // position verticale du pointeur (hauteur de ligne fixe), pas de l'élément survolé, si
 // bien qu'un redessin du tableau pendant le glisser ne le perturbe pas. Pendant le glisser,
 // une copie de la ligne (rendue par le tableau) suit le pointeur, tenue là où on l'a
-// attrapée, avec la destination en légende. Le module ne décide que de la cible : le
-// déplacement lui-même est confié à onDrop.
-import { containerKeyOf, resolveDropTarget } from "../services/syntheseTaskModel.js";
+// attrapée, avec la destination en légende. Avec la colonne Ordre (`canOrder`), la moitié
+// haute ou basse d'une tâche vise la place avant ou après elle, montrée par `markSlot` (trait
+// d'insertion). Le module ne décide que de la cible : le déplacement lui-même est confié à onDrop.
+import { containerKeyOf } from "../services/syntheseTaskModel.js";
+import { resolveDropSlot } from "../services/syntheseTaskOrder.js";
 
 export const DRAG_THRESHOLD_PX = 4;
 export const AUTO_SCROLL_EDGE_PX = 24;
@@ -30,6 +32,10 @@
   renderPreview = () => null,
   // Ligne d'origine à estomper (clé de ligne), puis null à la fin du glisser.
   markSource = () => {},
+  // La colonne Ordre existe : on peut viser une place entre deux tâches.
+  canOrder = () => false,
+  // Place visée ({ taskId, side }) pour le trait d'insertion, ou null.
+  markSlot = () => {},
   onDrop = () => {},
   doc = document,
   win = window,
@@ -83,24 +89,30 @@
   }
 
   // Cible sous le pointeur, seulement dans la bande visible des lignes (sous l'en-tête collant,
-  // dans le conteneur défilant) : ailleurs rien n'est visé, et lâcher annule.
+  // dans le conteneur défilant) : ailleurs rien n'est visé, et lâcher annule. Sans la colonne
+  // Ordre, son propre conteneur n'est pas une destination ; avec, toute autre place l'est.
   function update() {
     const rect = scroller.getBoundingClientRect();
     const inRows = drag.clientY >= rect.top + headHeight && drag.clientY < rect.bottom &&
       drag.clientX >= rect.left && drag.clientX < rect.right;
     const lines = getLines();
-    const index = inRows
-      ? lineIndexAt(drag.clientY, body.getBoundingClientRect().top, rowHeight, lines.length)
-      : -1;
-    const target = index >= 0 ? resolveDropTarget(lines[index]) : null;
-    drag.target = target && target.key !== drag.sourceKey ? target : null;
+    const bodyTop = body.getBoundingClientRect().top;
+    const index = inRows ? lineIndexAt(drag.clientY, bodyTop, rowHeight, lines.length) : -1;
+    const ordering = Boolean(canOrder());
+    const side = drag.clientY - bodyTop - index * rowHeight < rowHeight / 2 ? "before" : "after";
+    const target = index >= 0
+      ? resolveDropSlot(lines[index], side, { canOrder: ordering, draggedTaskId: drag.taskId })
+      : null;
+    drag.target = target && (ordering || target.key !== drag.sourceKey) ? target : null;
     const label = drag.target ? drag.target.label : "";
     if (caption.textContent !== label) caption.textContent = label;
     caption.hidden = !label;
     // La copie garde l'écart entre le pointeur et le coin de la ligne au moment de l'appui.
     ghost.style.left = `${drag.clientX - drag.offsetX}px`;
     ghost.style.top = `${drag.clientY - drag.offsetY}px`;
-    highlight(drag.target ? drag.target.key : null);
+    // Une place entre deux tâches se montre par le trait d'insertion ; un conteneur, surligné.
+    highlight(drag.target && !drag.target.position ? drag.target.key : null);
+    markSlot(drag.target?.position ? { ...drag.target.position } : null);
     updateAutoScroll(rect);
   }
 
@@ -122,6 +134,7 @@
     root.classList.remove("is-dragging");
     doc.documentElement.classList.remove("is-stt-dragging");
     highlight(null);
+    markSlot(null);
     markSource(null);
     doc.removeEventListener("keydown", onKeyDown, true);
   }
```

```diff
--- a/Planning Projet/assets/js/ui/syntheseTaskTable.js
+++ b/Planning Projet/assets/js/ui/syntheseTaskTable.js
@@ -110,6 +110,8 @@
   if (line.kind === "task") {
     const addTask = { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey || "" };
     if (line.groupRowId) addTask.groupRowId = line.groupRowId;
+    // Avec la colonne Ordre, la nouvelle tâche va juste sous la tâche cliquée.
+    addTask.afterTaskId = line.taskId;
     return [
       addTask,
       ...(line.floorKey ? [formworkCheckItem(line)] : []),
@@ -278,6 +280,11 @@
   // reconstruit ; alignée sur les lignes par la hauteur fixe.
   const ganttLayer = createElement("div", "stt-gantt-layer");
   scroller.appendChild(ganttLayer);
+  // Trait d'insertion du glisser, à la limite de deux lignes.
+  const dropLine = createElement("div", "stt-drop-line");
+  dropLine.setAttribute("aria-hidden", "true");
+  dropLine.hidden = true;
+  scroller.appendChild(dropLine);
   const gantt = typeof createGantt === "function"
     ? createGantt({ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX })
     : null;
@@ -303,7 +310,11 @@
   let lines = [];
   let editable = false;
   let canAddFloor = true;
+  // Colonne Ordre présente : glisser une tâche entre deux autres.
+  let canOrder = false;
   let dropTargetKey = null;
+  // Place visée par le glisser ({ taskId, side }), montrée par le trait d'insertion.
+  let dropSlot = null;
   let dragSourceKey = null;
   let taskDrag = null;
   let editor = null;
@@ -419,6 +430,7 @@
     lines = Array.isArray(nextLines) ? nextLines : [];
     editable = Boolean(options?.editable);
     canAddFloor = options?.canAddFloor !== false;
+    canOrder = Boolean(options?.canOrder);
     // Tableau devenu non modifiable : un glisser en cours est abandonné, sans dépôt.
     if (!editable) taskDrag?.cancel();
     applyWidth(leftWidth);
@@ -429,6 +441,7 @@
     body.hidden = Boolean(message);
     body.replaceChildren(...(message ? [] : lines.map(buildLine)));
     gantt?.render(message ? [] : lines);
+    placeDropLine();
   }
 
   const renderer = createDeferredRenderer(draw);
@@ -632,7 +645,9 @@
   }
 
   function runMenuItem(item) {
-    if (item.action === "addTask") return onAddTask?.(item.zoneKey, item.floorKey, item.groupRowId ?? null);
+    if (item.action === "addTask") {
+      return onAddTask?.(item.zoneKey, item.floorKey, item.groupRowId ?? null, item.afterTaskId ?? null);
+    }
     if (item.action === "addFloor") return onAddFloor?.(item.zoneKey);
     if (item.action === "deleteFloor") return onDeleteFloor?.(item.zoneKey, item.floorKey);
     if (item.action === "deleteGroup") return onDeleteGroup?.(item.groupRowId);
@@ -812,6 +827,24 @@
     if (key) body.querySelector(`[data-line-key="${key}"]`)?.classList.add("is-drag-source");
   }
 
+  // Trait d'insertion à la limite haute (avant) ou basse (après) de la tâche visée ; caché sans
+  // place visée ou si la tâche n'est plus affichée. Replacé à chaque redessin.
+  function placeDropLine() {
+    const index = dropSlot ? lines.findIndex((line) => line.kind === "task" && line.taskId === dropSlot.taskId) : -1;
+    if (index < 0) {
+      dropLine.hidden = true;
+      return;
+    }
+    const boundary = index + (dropSlot.side === "after" ? 1 : 0);
+    dropLine.style.top = `${HEAD_HEIGHT_PX + boundary * ROW_HEIGHT_PX}px`;
+    dropLine.hidden = false;
+  }
+
+  function markDropSlot(slot) {
+    dropSlot = slot;
+    placeDropLine();
+  }
+
   // Copie de la ligne glissée, tenue sous le pointeur : même rendu que dans le tableau, sans
   // la partie Gantt ni l'estompage.
   function renderDragPreview(line) {
@@ -832,6 +865,8 @@
     highlight: highlightDropTarget,
     renderPreview: renderDragPreview,
     markSource: markDragSource,
+    canOrder: () => canOrder && editable,
+    markSlot: markDropSlot,
     onDrop: (taskId, target) => onMoveTask?.(taskId, target),
   });
 
```

```diff
--- a/Planning Projet/assets/css/styles.css
+++ b/Planning Projet/assets/css/styles.css
@@ -3365,6 +3365,23 @@
   outline-offset: -2px;
 }
 
+/* Glisser une tâche entre deux autres (colonne Ordre) : trait d'insertion à la limite des deux
+   lignes, là où elle arrivera. */
+.stt-drop-line {
+  position: absolute;
+  left: 0;
+  right: 0;
+  z-index: 3;
+  height: 2px;
+  margin-top: -1px;
+  background: var(--stt-accent);
+  pointer-events: none;
+}
+
+.stt-drop-line[hidden] {
+  display: none;
+}
+
 /* Diagramme de Gantt (panneau droit) : couche SVG alignée sur les lignes du tableau,
    couleurs fixes reprises de MS Project, indépendantes du thème Grist. */
 .stt-gantt-layer {
```

- [ ] **Étape 4 : vérifier qu'ils passent**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : **608** tests, 0 échec.

- [ ] **Pas de commit** : l'utilisateur commite lui-même (il teste l'arbre de travail sur localhost). Vérifier seulement `git status` : rien hors des fichiers de la tâche.

---

### Tâche 6 : la vue Global reprend l'ordre ; vérification finale

**Fichiers :**
- Modifier : `tests/globalRowModel.test.mjs`

- [ ] **Étape 1 : écrire le test**

```diff
--- a/Planning Projet/tests/globalRowModel.test.mjs
+++ b/Planning Projet/tests/globalRowModel.test.mjs
@@ -264,3 +264,14 @@
   const empty = lineOf(lines, "zone:");
   assert.deepEqual([empty.start, empty.end, empty.name], [null, null, "Sans zone"]);
 });
+
+// Ordre libre de la vue Synthese (colonne Ordre) : même modèle d'étage, même ordre dans la vue
+// Global. PLAN SYT CYCLE 3 de RDC (419) : RÉSEAUX 420, RÉSERVATIONS 421, TERMINAUX 422, rangés à
+// l'envers.
+test("ordre libre de la vue Synthese : la vue Global le reprend", () => {
+  const ranks = { 420: "3", 421: "2", 422: "1" };
+  const rows = projectRows().map((row) => (row.id in ranks ? { ...row, Ordre: ranks[row.id] } : row));
+  const { lines } = model({ toggledKeys: new Set(RDC_PATH) }, rows);
+  const at = keys(lines).indexOf("group:419");
+  assert.deepEqual(keys(lines).slice(at + 1, at + 4), ["task:422", "task:421", "task:420"]);
+});
```

- [ ] **Étape 2 : le lancer**

Lancer (depuis `Planning Projet/`) : `node --test tests/*.test.mjs`
Attendu : **609** tests, 0 échec (aucun code à écrire : la vue Global trie avec `buildSections`).

- [ ] **Étape 3 : vérification finale**

- `node --check assets/js/main.js` ;
- fins de ligne : `tr -cd '\r' < fichier | wc -c` = 0 pour chaque fichier touché ;
- `git status` : seuls les fichiers de ce plan (et ceux déjà modifiés avant lui) apparaissent ;
- rendu : tableau Synthese avec la colonne Ordre (Ctrl + F5 sur localhost) — clic droit sur une tâche → « Ajouter une tâche » sous elle ; glisser une tâche sur la moitié haute / basse d'une autre (trait bleu, légende « Placer avant / après ») ; flèches du Gantt et dates qui suivent ; vue Global dans le même ordre.

- [ ] **Pas de commit** : l'utilisateur commite lui-même (il teste l'arbre de travail sur localhost). Vérifier seulement `git status` : rien hors des fichiers de la tâche.
