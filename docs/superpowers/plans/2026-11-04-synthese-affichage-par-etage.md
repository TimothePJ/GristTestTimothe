# Vue Synthese — affichage par étage : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pour les projets dont `Projets2.Mode` vaut « Étage », la vue Synthese affiche étage → zones → contenu au lieu de zone → étages → contenu, sans rien changer aux données.

**Architecture:** `buildSections` reste inchangé (sections par zone, source de toutes les écritures). Une option `layout: "floor"` de `buildRowModel` et `lineNumbersOf` produit une autre liste de lignes : une ligne `kind: "storey"` par nom d'étage, puis une ligne `kind: "floor"` (aspect zone) par zone qui a cet étage — c'est le conteneur « étage de cette zone » d'aujourd'hui —, puis le contenu ; un bloc « Sans étage » en bas. Le tableau, le Gantt et le contrôleur apprennent la ligne `storey` ; main.js lit `Mode` dans les lignes `Projets2` déjà chargées et le passe au contrôleur.

**Tech Stack:** JavaScript ES modules sans build, tests `node:test` + `node:assert/strict`, Grist (docApi).

**Spec:** `docs/superpowers/specs/2026-11-04-synthese-affichage-par-etage-design.md`

## Global Constraints

- Répertoire de travail des commandes : `Planning Projet/`. Tests : `node --test tests/*.test.mjs` — base de départ **782 tests verts** ; ils doivent tous rester verts **sans être modifiés** (le mode par zone ne change pas, ligne pour ligne).
- `layout` vaut `"zone"` (défaut, comportement actuel) ou `"floor"`. Les appels sans option (vue Global, fenêtre Lien Structure, `linkChoices`) ne doivent rien voir changer.
- Valeurs `Mode` reconnues (sans accents, casse, espaces, ponctuation) : `etage`, `paretage` → `"floor"` ; tout le reste, vide ou colonne absente → `"zone"`.
- Libellé du bloc : **« Sans étage »**. Textes en français, dans le style des messages existants.
- Aucun style ni couleur nouveaux : ligne étage = aspect `floor` existant (fond `--stt-floor-bg`, crochet de Gantt) ; ligne zone dans l'étage et zones du bloc « Sans étage » = aspect `zone` existant (barre noire de Gantt). Seuls des retraits (padding) peuvent être ajoutés en CSS, avec les valeurs déjà utilisées (`16px` par niveau).
- **Aucun commit** (l'utilisateur committe lui-même) : chaque tâche se termine par la suite de tests verte, pas par `git commit`.
- Fins de ligne : `assets/js/services/gristService.js` et `assets/js/config.js` sont en **CRLF** (autant de `\r` que de lignes) ; après modification, `tr -cd '\r' < FICHIER | wc -c` doit toujours égaler `wc -l < FICHIER` (+0 ou +1 selon la dernière ligne, comme avant). Les autres fichiers touchés sont en LF.
- Pas de nouvelle colonne dans `Planning_Projet` ; le widget n'écrit jamais `Projets2`.

## Review Focus

- Changement de mode d'un projet pendant que des lignes sont repliées : tous les replis sont remis à zéro (sinon des clés `zone:` reprises avec un autre sens cacheraient du contenu) — test Task 6.
- Même étage écrit différemment selon la zone (« SS1 » / « ss1 ») : une seule ligne étage, nom de la première zone — test Task 2.
- Filtre de zone actif : « Supprimer l'étage » et « Ajouter une zone » de la ligne étage refusés même si l'action arrive (menu grisé mais cliquable) — test Task 6.
- Renommer un étage vers un nom pris dans une de ses zones (refus nommant la zone) ou dans une autre zone seulement (accepté, les étages se rejoignent) — test Task 4.
- Numéros de ligne cohérents en mode étage partout où ils sont calculés (tableau **et** fenêtre « Modifier le lien… ») — test Task 6.

---

### Task 1: Lecture du mode d'un projet (module pur)

**Files:**
- Create: `assets/js/services/syntheseLayout.js`
- Test: `tests/syntheseLayout.test.mjs`

**Interfaces:**
- Produces:
  - `export const LAYOUT_ZONE = "zone"`, `export const LAYOUT_FLOOR = "floor"`
  - `parseLayoutMode(value: any) -> "zone" | "floor"`
  - `layoutForProject(configs: Array<{ projectId: string, projectNumber: string, modeRaw?: any }>, project: { number?: string, ids?: Array<number|string>, id?: number } | null) -> "zone" | "floor"` — lignes du projet = celles dont `projectId` (comparé en texte) est dans `project.ids` (ou égale `project.id`), ou dont `projectNumber` non vide égale `project.number` ; parmi elles, par id numérique croissant, la première `modeRaw` non vide (texte rogné) décide ; aucune → `"zone"`.

- [ ] **Step 1: Write the failing tests** (`tests/syntheseLayout.test.mjs`)
  - `parseLayoutMode` : `"Étage"`, `"Par étage"`, `"ETAGE"`, `" etage "`, `"par-étage"` → `"floor"` ; `"Zone"`, `""`, `undefined`, `null`, `"Étages"`, `"etage 2"` → `"zone"`.
  - `layoutForProject([{ projectId: "7", projectNumber: "262021", modeRaw: "" }, { projectId: "3", projectNumber: "262021", modeRaw: "Étage" }], { number: "262021", ids: [3, 7] })` → `"floor"`.
  - Ordre par id : `[{ projectId: "9", projectNumber: "1", modeRaw: "Zone" }, { projectId: "4", projectNumber: "1", modeRaw: "Étage" }]` avec `{ number: "1", ids: [4, 9] }` → `"floor"` (id 4 d'abord).
  - Colonne absente : `[{ projectId: "3", projectNumber: "262021" }]` → `"zone"` ; `project` null → `"zone"` ; config d'un autre numéro et d'un autre id ignorée → `"zone"`.
  - Rattachement par numéro seul : `{ number: "262021", ids: [] }` trouve la config `projectNumber: "262021"`.

- [ ] **Step 2: Run** `node --test tests/syntheseLayout.test.mjs` — Expected: FAIL (module introuvable).
- [ ] **Step 3: Implement** `assets/js/services/syntheseLayout.js` (clé : `normalize("NFD")`, retrait `/\p{M}/gu`, minuscules `fr`, retrait `/[^a-z0-9]+/g`).
- [ ] **Step 4: Run** `node --test tests/syntheseLayout.test.mjs` puis `node --test tests/*.test.mjs` — Expected: PASS, 782 + nouveaux.

---

### Task 2: Lignes et numéros en mode étage

**Files:**
- Modify: `assets/js/services/syntheseTaskModel.js` (`buildRowModel`, ~1055-1172 ; nouveaux exports)
- Modify: `assets/js/services/syntheseLinkColumn.js:13` (`lineNumbersOf`)
- Test: `tests/syntheseStoreyRows.test.mjs`

**Interfaces:**
- Produces (syntheseTaskModel.js):
  - `export const NO_FLOOR_LABEL = "Sans étage"`
  - `export function storeyCollapseKey(floorKey: string) -> string` → `` `storey:${floorKey}` `` (« Sans étage » : `"storey:"`).
  - `buildRowModel(sections, { collapsedZoneKeys, collapsedFloorKeys, collapsedGroupKeys, collapsedStoreyKeys = new Set(), layout = "zone" })`. `layout: "zone"` : sortie identique à aujourd'hui, **aucun champ ajouté**. `layout: "floor"` : chaque ligne porte en plus `layout: "floor"` et `look` (`"floor"` | `"zone"` | `"group"` | `"task"`) ; lignes produites :
    - **étage** : `kind: "storey"`, `key: storeyCollapseKey(floorKey)`, `level: 0`, `zoneKey: ""`, `zoneName: ""`, `floorKey`, `floorName` = `name` = nom de l'étage dans la première section (ordre des sections) qui l'a, `floorRowIds: []`, champs vides de `NO_GROUP_FIELDS`, `taskId: null`, dates = `summarizeTasks` de toutes les tâches de cet étage dans toutes les sections données, `collapsed` = `collapsedStoreyKeys.has(key)`, `childCount` = nombre de zones, `look: "floor"`, `zoneCount`, `missingZones: Array<{ zoneKey, zoneName, label }>` = sections (hors `NO_ZONE_KEY`) qui n'ont pas cet étage, dans l'ordre des sections.
    - **zone dans l'étage** : comme la ligne étage d'aujourd'hui (`kind: "floor"`, `key: floor:<zoneKey>/<floorKey>`, `floorRowIds`, récapitulatif de l'étage de cette zone, repli `collapsedFloorKeys` avec `floorCollapseKey`) mais `level: 1`, `name` = `section.label`, `look: "zone"`. Contenu : comme aujourd'hui (`pushItems`, niveau 2…).
    - **Sans étage** (après tous les étages) : `kind: "storey"`, `key: "storey:"`, `floorKey: ""`, `name: NO_FLOOR_LABEL`, `missingZones: []`, `zoneCount`/`childCount` = nombre de sections, dates = récapitulatif de toutes les tâches hors étage, `look: "floor"`. Puis pour **chaque** section (même vide, « Sans zone » compris quand elle existe) : `kind: "zone"`, `key: zone:<zoneKey>`, `level: 1`, `name: section.label`, dates = `summarizeTasks` de ses seules tâches hors étage, `childCount` = leur nombre, `collapsed` = `collapsedZoneKeys.has(zoneKey)`, `look: "zone"` ; ses tâches hors étage au niveau 2.
    - Ordre des étages : par récapitulatif fusionné (Début, puis Fin, puis nom `localeCompare` fr numérique ; non datés à la fin) ; zones dans un étage : ordre des sections.
- Produces (syntheseLinkColumn.js): `lineNumbersOf(sections, { layout = "zone" } = {})` — numérote `buildRowModel(sections, { layout })` tout déplié.

- [ ] **Step 1: Write the failing tests** (`tests/syntheseStoreyRows.test.mjs`, lignes construites avec le même helper `row(id, fields)` que `tests/syntheseTaskSections.test.mjs`). Fixture : zones « Zone 1 / BAT BC » et « Zone 2 / BAT B » ; Zone 1 : étages « SS1 » (tâche 2026-01-05→01-06) et « R+1 » (tâche 2026-03-02) ; Zone 2 : étage « ss1 » (tâche 2026-02-02→02-03) ; une tâche hors étage en Zone 2 ; une tâche sans zone. Assertions :
  - `layout: "floor"` : clés dans l'ordre `storey:ss1`, `floor:zone1batbc/ss1`, `task:…`, `floor:zone2batb/ss1`, `task:…`, `storey:rp1`, `floor:zone1batbc/rp1`, `task:…`, `storey:`, `zone:zone1batbc`, `zone:zone2batb`, `task:<hors étage>`, `zone:` (Sans zone), `task:<sans zone>` (clés exactes selon `zoneKeyOf` / `floorKeyOf`).
  - Ligne `storey:ss1` : `name === "SS1"` (première zone), `level 0`, `look "floor"`, Début 2026-01-05, Fin 2026-02-03, `zoneCount 2`, `missingZones` vide ; `storey:rp1` : `missingZones` = `[{ zoneKey: "zone2batb", … label: "Zone 2 / BAT B" }]`.
  - Ligne `floor:zone2batb/ss1` : `level 1`, `name "Zone 2 / BAT B"`, `look "zone"`, `floorName "ss1"`.
  - `collapsedStoreyKeys: new Set(["storey:ss1"])` cache les deux zones et leur contenu ; `collapsedFloorKeys: new Set([floorCollapseKey("zone1batbc", "ss1")])` ne cache que le contenu de la zone 1.
  - Projet sans aucun étage : seulement « Sans étage » puis une ligne par zone.
  - Sections filtrées sur la Zone 2 (`buildSections({ …, zoneFilter: "Zone 2 / BAT B" })`) : `storey:ss1` n'a qu'une zone et le récapitulatif de la seule Zone 2.
  - `layout` absent : `deepEqual` avec la sortie actuelle (aucun champ `layout`/`look`).
  - `lineNumbersOf(sections, { layout: "floor" }).byKey.get("storey:ss1") === 1` et `byKey.get("floor:zone1batbc/ss1") === 2`.
- [ ] **Step 2: Run** `node --test tests/syntheseStoreyRows.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** dans `buildRowModel` une branche `layout === "floor"` qui réutilise `taskLine`, `pushItems`, `summaryFields`, `summarizeTasks` ; exporter `NO_FLOOR_LABEL`, `storeyCollapseKey` ; passer `{ layout }` dans `lineNumbersOf`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS (782 + nouveaux).

---

### Task 3: Dépôts et Gantt pour les nouvelles lignes

**Files:**
- Modify: `assets/js/services/syntheseTaskModel.js:641` (`resolveDropTarget`)
- Modify: `assets/js/services/syntheseTaskOrder.js:179` (`resolveDropSlot`)
- Modify: `assets/js/services/syntheseGanttGeometry.js:133-148` (`buildGanttShapes`)
- Test: `tests/syntheseStoreyDrop.test.mjs`

**Interfaces:**
- Consumes: lignes de Task 2 (`kind: "storey"`, `layout`, `look`).
- Produces: comportements ci-dessous ; aucune nouvelle signature.

- [ ] **Step 1: Write the failing tests**
  - `resolveDropTarget` d'une ligne `storey` (étage ou « Sans étage ») → `null` ; `resolveDropSlot(storeyLine, "after", { canOrder: true })` → `null` ; `resolveCycleDropSlot(storeyLine, "after", { groupRowId, zoneKey, floorKey })` → `null`.
  - Ligne `floor` avec `layout: "floor"` (zone dans l'étage) : cible `key: "floor:zone1batbc/ss1"`, `label: "Déplacer dans « SS1 » (« Zone 1 / BAT BC »)"` ; `resolveDropSlot(…, { canOrder: true })` → `label: "Déplacer à la fin de « SS1 » (« Zone 1 / BAT BC »)"`.
  - Tâche d'étage avec `layout: "floor"` : `resolveDropTarget` label `"Déplacer dans « SS1 » (« Zone 1 / BAT BC »)"`.
  - Sans `layout` : libellés inchangés (`"Déplacer dans « SS1 »"`, `"Déplacer à la fin de « SS1 »"`).
  - `buildGanttShapes` : ligne `storey` datée → forme `floorBracket` ; ligne `floor` avec `look: "zone"` → `zoneBar` ; ligne `zone` sans `look` → `zoneBar` (inchangé).
- [ ] **Step 2: Run** `node --test tests/syntheseStoreyDrop.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** : libellés avec la zone quand `line.layout === "floor"` et la cible est un étage ; `"storey"` ajouté aux types récapitulatifs du Gantt ; type de forme et ton décidés par `line.look || line.kind`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS.

---

### Task 4: Opérations sur un étage de toutes les zones (module pur)

**Files:**
- Create: `assets/js/services/syntheseStoreys.js`
- Modify: `assets/js/services/syntheseTaskModel.js:581` (`buildFloorDeleteQuestion`)
- Test: `tests/syntheseStoreys.test.mjs`

**Interfaces:**
- Consumes: `validateFloorName`, `buildFloorRenameChanges`, `buildFloorRenameActions`, `floorRemovalIds`, `floorKeyOf` (syntheseTaskModel.js).
- Produces:
  - `storeyFloorsOf(sections, floorKey: string) -> Array<{ section, floor }>` — ordre des sections, sans `NO_ZONE_KEY`.
  - `validateStoreyRename(rawValue, { sections, floorKey }) -> { ok: true, name, key } | { ok: false, error }` — erreurs générales de `validateFloorName` (vide, trop long, sans lettre ni chiffre) telles quelles ; doublon dans une zone de l'étage : `` `Dans « ${section.label} » : ${erreur de validateFloorName}` `` (première zone en conflit).
  - `buildStoreyRename(entries, name) -> { changes: Map<number, object>, actions: Array }` — fusion zone par zone de `buildFloorRenameChanges` / `buildFloorRenameActions`.
  - `storeyRemovalIds(entries) -> number[]` — concaténation des `floorRemovalIds`.
  - `buildStoreyDeleteQuestion({ name, zoneCount, taskCount }) -> string`.
  - `buildFloorDeleteQuestion(floor, { zoneLabel = "" } = {})` — sans `zoneLabel` : inchangé.

- [ ] **Step 1: Write the failing tests**
  - `validateStoreyRename("R+1", …)` pour l'étage `ss1` (zones 1 et 2) quand la Zone 1 a déjà « R+1 » → `{ ok: false, error: "Dans « Zone 1 / BAT BC » : Un étage « R+1 » existe déjà dans cette zone." }`.
  - Même renommage quand seule une Zone 3 (pas dans l'étage) a « R+1 » → `{ ok: true, name: "R+1", key: "rp1" }`.
  - `validateStoreyRename("  ", …)` → `{ ok: false, error: "Le nom de l'étage ne peut pas être vide." }` ; changer seulement la casse (« Ss1 ») → accepté.
  - `buildStoreyRename` sur deux zones : `changes` contient les lignes-étages, groupes et tâches des deux zones ; `actions` renomme toutes les lignes-étages des deux zones (vérifier les ids dans les `UpdateRecord` / `BulkUpdateRecord`).
  - `buildStoreyDeleteQuestion({ name: "SS1", zoneCount: 2, taskCount: 52 })` → `"Supprimer l'étage « SS1 » dans 2 zones et ses 52 tâches ?"` ; `{ zoneCount: 1, taskCount: 1 }` → `"Supprimer l'étage « SS1 » dans 1 zone et sa tâche ?"` ; `taskCount: 0` → `"Supprimer l'étage « SS1 » dans 2 zones ?"`.
  - `buildFloorDeleteQuestion(floor20Tasks, { zoneLabel: "Zone 1 / BAT BC" })` → `"Supprimer l'étage « SS1 » de « Zone 1 / BAT BC » et ses 20 tâches ?"` (mêmes variantes 0 / 1 tâche que l'existant).
  - `storeyRemovalIds` = union des ids des deux zones.
- [ ] **Step 2: Run** `node --test tests/syntheseStoreys.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** `assets/js/services/syntheseStoreys.js` et le paramètre `zoneLabel`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS.

---

### Task 5: Tableau — lignes étage, menus, saisie, replis

**Files:**
- Modify: `assets/js/ui/syntheseTaskTable.js` (`SUMMARY_KINDS` :46, `buildMenuItems` :105, `buildNameCell` :455, `buildLine` :489, `findFloorCell` :566, `startEditingFloor` :589, `finishEditing` :708, menu dispatch :762, `actionAt` :826, `runAction` :840, API retournée :1091)
- Modify: `assets/css/styles.css` (retraits seulement)
- Test: `tests/syntheseStoreyTable.test.mjs` (harnais : celui de `tests/syntheseTaskTable.test.mjs` / `tests/helpers/fakeDom.mjs`)

**Interfaces:**
- Consumes: lignes de Task 2.
- Produces:
  - Nouveaux rappels de `createSyntheseTaskTable(host, callbacks, …)` : `onToggleStorey(floorKey)`, `onRenameStorey(floorKey, rawValue)`, `onAddZoneToFloor(floorKey, zoneKey)`, `onDeleteStorey(floorKey)`.
  - Nouvelle méthode de l'objet tableau : `startEditingStorey(floorKey)`.
  - Nouvelle option de `table.render(lines, options)` : `zoneFiltered: boolean`.
  - `buildMenuItems(line, { canAddFloor, canAddCycle, canSetCycleMode, canEditLink, zoneFiltered = false })` :
    - `storey` avec `floorKey` et sans filtre : une entrée par zone manquante `{ label: "Ajouter dans « <label> »", action: "addZoneToFloor", floorKey, zoneKey, disabled: !canAddFloor }` ; s'il n'en manque aucune : `{ label: "Ajouter une zone", action: "addZoneToFloor", floorKey, zoneKey: "", disabled: true }` ; puis `{ label: "Supprimer l'étage", action: "deleteStorey", floorKey, danger: true }`.
    - `storey` avec filtre : `{ label: "Ajouter une zone", action: "addZoneToFloor", floorKey, zoneKey: "", disabled: true }` et « Supprimer l'étage » `disabled: true`.
    - `storey` « Sans étage » (`floorKey === ""`) : `[]`.
    - `floor` avec `look === "zone"` : « Ajouter une tâche », « Ajouter un cycle » (comme aujourd'hui), puis `{ label: "Supprimer l'étage dans cette zone", action: "deleteFloor", zoneKey, floorKey, danger: true }`.
    - Autres lignes : inchangées.

- [ ] **Step 1: Write the failing tests**
  - Chaque cas de `buildMenuItems` ci-dessus (libellés, actions, `disabled`).
  - Rendu : la ligne `storey` a la classe `stt-line--floor`, `data-kind="storey"`, `data-look="floor"`, un triangle de repli et une Durée ; la ligne zone dans l'étage a la classe `stt-line--zone`, `data-kind="floor"`, son emblème de lien Structure quand `structureLinkNote` est posé. En mode zone, classes et attributs inchangés (`stt-line--<kind>`).
  - Clic sur le triangle d'une ligne `storey` → `onToggleStorey("ss1")` ; sur « Sans étage » → `onToggleStorey("")`.
  - Clic sur le nom d'une ligne `storey` (`floorKey` non vide, tableau éditable) ouvre la saisie ; Entrée avec « SS2 » → `onRenameStorey("ss1", "SS2")`. Clic sur le nom de « Sans étage » ou d'une ligne zone dans l'étage : aucune saisie.
  - `startEditingStorey("ss1")` ouvre la saisie du nom de cette ligne.
  - Entrées de menu `addZoneToFloor` / `deleteStorey` appellent `onAddZoneToFloor("rp1", "zone2batb")` / `onDeleteStorey("rp1")`.
- [ ] **Step 2: Run** `node --test tests/syntheseStoreyTable.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** : classe visuelle `stt-line--${line.look || line.kind}`, `data-look` posé, comportements décidés par `data-kind` (les sélecteurs de comportement sur `.stt-line--floor` passent à `[data-kind="floor"]`) ; `"storey"` dans `SUMMARY_KINDS` ; saisie `{ kind: "storey", floorKey }`. CSS : les lignes `zone` de niveau ≥ 1 et les tâches d'une ligne `layout: "floor"` sont en retrait selon `--stt-level` (formule existante `calc(14px + var(--stt-level) * 16px)` pour les tâches, `16px` par niveau pour les lignes zone), sans autre changement visuel.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS.

---

### Task 6: Contrôleur — mode, replis, actions sur l'étage

**Files:**
- Modify: `assets/js/ui/syntheseTasksController.js` (état et `createTable` :~180-222, `render` :308, `load` :367, `handleEditLink` :612, `handleAddTask`/`handleAddCycle`/`handleMoveTask`/`handleMoveCycle` (dépliages), `handleAddFloor` :879, `handleDeleteFloor` :999, toggles :1317, API retournée :1348)
- Test: `tests/syntheseStoreyController.test.mjs` (harnais calqué sur `setup()` de `tests/syntheseTasksController.test.mjs:46`)

**Interfaces:**
- Consumes: Task 2 (`buildRowModel` options, `lineNumbersOf(…, { layout })`, `storeyCollapseKey`), Task 4 (tout `syntheseStoreys.js`, `buildFloorDeleteQuestion(…, { zoneLabel })`), Task 5 (rappels, `startEditingStorey`, option `zoneFiltered`).
- Produces: méthode `setLayout(layout: "zone" | "floor")` de l'objet contrôleur (toute autre valeur = `"zone"`).

Comportements :
- `setLayout` : valeur inchangée → rien ; sinon vide les quatre ensembles de replis (`collapsedZoneKeys`, `collapsedFloorKeys`, `collapsedGroupKeys`, nouveau `collapsedStoreyKeys`) puis redessine. Le changement de projet vide aussi `collapsedStoreyKeys`.
- `render` : `buildRowModel(sections, { …, collapsedStoreyKeys, layout })`, `lineNumbersOf(numberingSections, { layout })`, `table.render(…, { …, zoneFiltered: Boolean(zoneFilter) })`. `handleEditLink` numérote avec `{ layout }`.
- `toggleStorey(floorKey)` bascule `storeyCollapseKey(floorKey)`.
- Après ajout de tâche / cycle et déplacement : en plus des dépliages actuels, `collapsedStoreyKeys.delete(storeyCollapseKey(floorKey || ""))`.
- `handleRenameStorey(floorKey, rawValue)` : verrou comme `handleRenameFloor` ; entrées = `storeyFloorsOf(allSections(), floorKey)` ; refus → `setStatus(error, "error")` + render ; même nom → render ; sinon une opération (`buildStoreyRename`), replis migrés (`storey:` et chaque `floorCollapseKey`), réussite : `info("Étage renommé dans 2 zones.")` (`"dans 1 zone."` au singulier).
- `handleDeleteStorey(floorKey)` : filtre actif → `setStatus("Retirez le filtre de zone pour supprimer l'étage dans toutes ses zones.", "error")` ; sinon `confirm(buildStoreyDeleteQuestion(…))`, une seule écriture (`BulkRemoveRecord` de `storeyRemovalIds` + mises à jour de `planOrphanLinks` sur `allSections()`), replis nettoyés, `info("Étage « SS1 » supprimé dans 2 zones.")`.
- `handleAddZoneToFloor(floorKey, zoneKey)` : verrou ; filtre actif → `"Retirez le filtre de zone pour ajouter une zone à cet étage."` ; `zoneKey` vide → `"Toutes les zones du projet ont déjà cet étage."` ; colonnes manquantes → mêmes messages que `handleAddFloor` ; zone qui a déjà l'étage → rien. Sinon même écriture en deux temps que `handleAddFloor` (factoriser le corps commun en une fonction interne), étage nommé comme la ligne étage, dans la zone choisie ; réussite : dépliage de `storey:<floorKey>` et de `floorCollapseKey(zoneKey, floorKey)`, pas de saisie ouverte, `info("Étage « SS1 » ajouté dans « Zone 3 / BAT C ».")`.
- `handleAddFloor(zoneKey)` en mode étage : nom = `nextFloorName(allSections().flatMap((s) => s.floors))` ; réussite : dépliage de `storey:<clé>`, puis `table.startEditingStorey(floorKeyOf(name))` au lieu de `startEditingFloor`. Mode zone : inchangé.
- `handleDeleteFloor` en mode étage : question `buildFloorDeleteQuestion(floor, { zoneLabel: section.label })`.

- [ ] **Step 1: Write the failing tests** (deux zones avec « SS1 », la Zone 1 avec « R+1 » ; `setLayout("floor")`)
  - Première ligne rendue `storey:ss1` ; numéro de ligne de `floor:zone1batbc/ss1` = 2 ; le `linkText` d'une tâche liée renvoie au numéro de sa prédécesseure en mode étage ; la fenêtre de lien (`createLinkDialog` doublé) reçoit des choix dont les `lineNumber` sont ceux du mode étage.
  - `setLayout("floor")` après repli de `zone:zone1batbc` : plus aucun repli ; `setLayout("floor")` de nouveau : aucun nouveau rendu forcé.
  - Renommer `ss1` en « SS2 » : **un seul** appel `applyUserActions` couvrant les lignes des deux zones ; message `Étage renommé dans 2 zones.` ; renommer en « R+1 » : refus `Dans « Zone 1 / BAT BC » : Un étage « R+1 » existe déjà dans cette zone.`, aucune écriture.
  - Supprimer l'étage `ss1` : `confirm` reçoit `Supprimer l'étage « SS1 » dans 2 zones et ses … tâches ?` ; une écriture `BulkRemoveRecord` avec les ids des deux zones.
  - Filtre de zone actif (`setZoneFilter("Zone 1 / BAT BC")`) : `handleDeleteStorey` et `handleAddZoneToFloor` refusés avec leurs messages, aucune écriture ; le rendu reçoit `zoneFiltered: true`.
  - Ajouter la Zone 2 à l'étage `rp1` : `BulkAddRecord` de 26 lignes dont la ligne-étage a `Zone = "Zone 2 / BAT B"`, `Taches = "R+1"`, puis l'écriture Parent/Lien ; message `Étage « R+1 » ajouté dans « Zone 2 / BAT B ».`
  - « Ajouter un étage » sur la Zone 2 quand la Zone 1 a déjà « Nouvel étage » : le nouvel étage s'appelle « Nouvel étage 2 » et `startEditingStorey` est appelé avec sa clé.
  - Mode zone (sans `setLayout`) : les appels existants de `startEditingFloor` et la question de suppression sont inchangés.
- [ ] **Step 2: Run** `node --test tests/syntheseStoreyController.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** les comportements ci-dessus ; brancher les quatre nouveaux rappels de Task 5.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS.

---

### Task 7: Lecture de `Projets2.Mode` et branchement dans main.js

**Files:**
- Modify: `assets/js/config.js:8-12` (CRLF)
- Modify: `assets/js/services/gristService.js:3044-3063` (CRLF)
- Modify: `assets/js/main.js` (`applyProjectBootstrapData` :1587, `refreshProjectRegistryFromGrist` :1605, `bindPlanningDataRefresh` :2013, `getSyntheseTasks` :2117, `bindSyntheseSpace` :2160)
- Test: `tests/syntheseLayoutWiring.test.mjs` (style de `tests/syntheseTasksWiring.test.mjs` : lecture du source et `sliceBetween`)

**Interfaces:**
- Consumes: `layoutForProject` (Task 1), `setLayout` (Task 6).
- Produces:
  - `APP_CONFIG.grist.projectsTable.columns.mode = "Mode"`.
  - Chaque entrée de `projectAvancementConfigs` porte `modeRaw: row?.[columns.mode]` (`undefined` quand la colonne n'existe pas).
  - `fetchProjectBootstrapData({ forceRefresh = false } = {})` : avec `forceRefresh`, `fetchTableRows(table.sourceTable, { forceRefresh: true, forceRawRefresh: true })` ; sans, appel identique à aujourd'hui.
  - `refreshProjectRegistryFromGrist({ notify, clearInvalid, forceRefresh = false })` transmet `forceRefresh`.
  - main.js : `function syncSyntheseLayout()` → `syntheseTasks?.setLayout(layoutForProject(cachedProjectAvancementConfigs, window.GristServiceContext?.getState?.()?.currentProject || null))`, appelée : à la fin de `getSyntheseTasks()` (création), dans `applyProjectBootstrapData` après la mise à jour de `cachedProjectAvancementConfigs`, et dans le rappel d'abonnement de `bindSyntheseSpace` (changement de projet ou de service).
  - Dans le rappel de `bindPlanningDataRefresh` : `if (tables.includes("Projets2")) void refreshProjectRegistryFromGrist({ notify: false, clearInvalid: false, forceRefresh: true });` (la mise à jour du mode passe par `applyProjectBootstrapData`).

- [ ] **Step 1: Write the failing tests** (`tests/syntheseLayoutWiring.test.mjs`)
  - main.js importe `layoutForProject` depuis `./services/syntheseLayout.js` ; `syncSyntheseLayout();` apparaît dans `getSyntheseTasks`, `applyProjectBootstrapData` et `bindSyntheseSpace` (bornes via `sliceBetween`) ; la surveillance contient la branche `tables.includes("Projets2")` avec `forceRefresh: true` et `notify: false`.
  - `config.js` contient `mode: "Mode"` ; `gristService.js` contient `modeRaw:` dans `buildProjectAvancementConfigsFromRows` et `forceRawRefresh: true` dans `fetchProjectBootstrapData`.
  - `config.js` et `gristService.js` : nombre de `\r` = nombre de `\n` (fichier lu en texte brut).
- [ ] **Step 2: Run** `node --test tests/syntheseLayoutWiring.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** ; vérifier dans `shared/grist-service-context.js` que `{ forceRefresh: true, forceRawRefresh: true }` contourne bien les caches de `fetchTable` (sinon le signaler dans le rapport).
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` — Expected: PASS ; contrôle CRLF : `tr -cd '\r' < assets/js/config.js | wc -c` et `wc -l < assets/js/config.js` (idem `gristService.js`) donnent les mêmes valeurs qu'avant la tâche.
