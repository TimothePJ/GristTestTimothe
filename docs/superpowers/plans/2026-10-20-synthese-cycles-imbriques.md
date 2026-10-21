# Cycles imbriqués à profondeur libre — plan d'implémentation

> **Pour les agents :** compétence requise : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** dans la vue Synthese de Planning Projet, créer des cycles et des sous-cycles à toute profondeur par le menu clic droit, les déplacer par glisser-déposer, et re-chaîner liens et dates selon la règle du bloc.

**Architecture :** le modèle (`syntheseTaskModel.js`) lit une hiérarchie de cycles sans plafond et donne à chaque ligne sa profondeur et son chemin de cycles. Un nouveau module pur `services/syntheseCycles.js` calcule tout ce qui est propre aux cycles : création, cibles de dépôt, déplacement (règle du bloc) et suppression. Il s'appuie sur les briques de chaînage de `syntheseTaskOrder.js`, désormais exportées. Le tableau, le glisser et le contrôleur ne font que brancher ces plans ; la vue Global suit sans code propre.

**Pile :** JavaScript (modules ES), sans dépendance ; tests `node:test` (Node 25), lancés depuis `Planning Projet/` avec `node --test tests/*.test.mjs` (jamais `node --test tests/`).

**Spec :** `docs/superpowers/specs/2026-10-20-synthese-cycles-imbriques-design.md` (approuvée le 20/10/2026). Les règles y sont définies ; ce plan dit où et comment les coder.

## Contraintes globales

- **Aucune nouvelle colonne Grist.** Un cycle : `Taches`, `Nature` (`Cycle` directement dans l'étage, `Sous-groupe` dans un autre cycle), `Parent` (id texte du cycle conteneur, vide dans l'étage), `Groupe` (nom de l'étage), `Zone`, `NomProjet`, `Ordre`, `Duree_1` = 0, pas de dates.
- `Cycle` et `Sous-groupe` se lisent à l'identique ; l'**affichage suit la place réelle** (profondeur), jamais la valeur stockée.
- Libellés exacts : « Ajouter un cycle », « Ajouter un sous-cycle », « Supprimer le cycle », « Supprimer le sous-cycle », « Nouveau cycle », « Nouveau sous-cycle », « Nom du cycle », « Placer avant « … » », « Placer après « … » », « Déplacer à la fin de « … » ».
- Créer un cycle demande les colonnes du modèle d'étage (`templateColumns === true`, détection existante de `Nature`, `Parent`, `Lien`). Glisser un cycle demande en plus `Ordre` (`orderColumn === true`).
- Un cycle ne quitte jamais son étage. Pas de cycle au niveau zone ni dans « Sans zone ».
- Une action = **une** écriture Grist (tout ou rien). Planification toujours sur `allSections()` (toutes les zones, sans le filtre du bandeau).
- La règle de chaînage des **tâches** seules ne change pas ; la reprise du lien d'entrée (DD, FF) ne vaut que pour les cycles.
- `shared/` n'est pas touché. Fichiers en **LF** ; commentaires et messages en français, avec la densité de commentaires du code existant.
- Les outils Write/Edit décodent `\uXXXX` en caractères : pour les accents, utiliser `/\p{M}/gu`, jamais un intervalle `̀-ͯ`.
- **Aucun commit** : l'utilisateur commite lui-même. Chaque tâche se termine sur la suite verte.
- Suite actuelle : **616 tests verts**. Elle doit rester verte après chaque tâche ; les tests existants qui fixent un ancien comportement voulu changé (libellés, classes `is-level-*`, question de suppression, menus) sont mis à jour dans la tâche qui change ce comportement.

## Points de vigilance (Review Focus)

1. **`Parent` désignant un cycle d'un autre étage** (étage renommé, ligne copiée) : le cycle reste directement dans son étage — test « Parent étranger » (tâche 1).
2. **Bloc non daté** (étage du modèle sans dates) : les liens sont refaits, aucune date n'est écrite — test « bloc non daté » (tâche 4).
3. **Cycle lâché à sa propre place** (juste avant le cycle qui le suit, ou à la fin de son propre conteneur s'il y est déjà dernier) : aucune écriture — test « à la même place » (tâche 4).
4. **Cycle lâché dans un cycle replié** : le cycle d'arrivée et tous ses parents sont dépliés — test « cycle replié déplié » (tâche 6).
5. **Production partielle** (`Nature`, `Parent`, `Lien` présents, `Ordre` absent) : création possible, pas de poignée sur les cycles — tests « sans Ordre » (tâches 3 et 6).

---

### Tâche 1 : Hiérarchie de cycles à profondeur libre

**Fichiers :**
- Modifier : `Planning Projet/assets/js/services/syntheseTaskModel.js` (`placeFloorContent` l. 784-806, `buildRowModel` l. 973-1084, `groupRemovalIds` l. 554, `buildGroupDeleteQuestion` l. 566)
- Modifier : `Planning Projet/assets/js/services/structureLinkModel.js` (`cycleNameOf` l. ~140 et son appel dans `readControlTasks`)
- Créer : `Planning Projet/tests/helpers/eraSs1Rows.mjs`
- Créer : `Planning Projet/tests/syntheseCycleHierarchy.test.mjs`
- Modifier : `Planning Projet/tests/syntheseGroupRules.test.mjs` (l. 83, question de suppression de CYCLE 2)

**Interfaces :**
- Produit (objets cycle des sections, `floor.groups[]`) : `rowId`, `name`, `natureKey`, `parentId`, `zoneKey`, `zoneName`, `floorKey`, `floorName`, `order`, **`parentGroup`** (cycle conteneur ou `null`), **`depth`** (1 = directement dans l'étage), `groups` (cycles **enfants directs**, ordre d'affichage), `items` (contenu trié), `tasks` (toutes les tâches à toute profondeur), `summary`.
- Produit : `descendantGroups(group) → Group[]` (tous les sous-cycles, à toute profondeur, en profondeur d'abord dans l'ordre d'affichage).
- Produit : `groupRemovalIds(group) → number[]` = `[group.rowId, ...descendantGroups(group).map(rowId), ...group.tasks.map(id)]`.
- Produit (modèle de lignes) : **toute ligne** porte `cyclePath: number[]` (ids des cycles qui la contiennent, du plus extérieur au plus intérieur ; une ligne de cycle se termine par son propre id ; `[]` pour zone, étage et tâches hors cycle). Les lignes de cycle portent en plus `depth`, `parentGroupRowId` (id du cycle conteneur ou `null`) et `nature` = `"cycle"` si `depth === 1`, sinon `"sous-groupe"`.
- Produit (aide de test) : `ERA_PROJECT = "ERA QUAI D'ORSAY"`, `ERA_ZONE = "Zone 1 / BAT BC"`, `ERA_ZONE_KEY = "zone1batbc"`, `eraSs1Rows() → Row[]`.

- [ ] **Étape 1 : écrire l'aide de test `eraSs1Rows.mjs`**

L'étage SS1 de la zone « Zone 1 / BAT BC », tiré de l'export de l'utilisateur du 20/10/2026. Les ids ont été déduits de `Parent` et `Lien`. Chaque ligne a aussi `NomProjet: ERA_PROJECT`, `Zone: ERA_ZONE`, `Service: "Synthese"`, `Type_doc: ""`, `ID2: ""`, `Indice: ""`, `Lien_Structure: ""` (sauf l'étage), `Controle_Coffrage: false`. `Etage` vaut `false` sauf pour 983. Les colonnes vides valent `""` (dates `null`). `Groupe` vaut `"SS1"` sauf pour l'étage (`""`).

| id | Taches | Nature | Parent | Lien | Duree_1 | Diff_coffrage | Diff_armature | Ordre |
|---|---|---|---|---|---|---|---|---|
| 983 | SS1 (Etage `true`, Lien_Structure `"3021"`) | | | | 0 | | | |
| 984 | RECEPTION ARCH/TOPO/STR | | | | 0 | 2025-11-14 | 2025-11-14 | |
| 985 | CYCLE 1 | Cycle | | | 0 | | | |
| 986 | FOND DE PLAN DE SYNTHESE NIV SS1 | | 985 | 984 DD | 2 | 2025-11-14 | 2025-11-17 | 1 |
| 987 | DIFFUSION FDS Indice 0 | | 985 | 986 FD | 0 | 2025-11-17 | 2025-11-17 | 2 |
| 988 | RECEPTION RENDU CET RESEAUX (GED) | | 985 | 987 FD | 10 | 2025-11-18 | 2025-12-01 | 3 |
| 989 | VISA Indice 0 | | 985 | 1061 FD | 10 | 2025-12-03 | 2025-12-16 | 5 |
| 990 | PLAN DE SYNTHESE RESEAUX NIV SS1 | | 985 | 988 FD | 5 | 2025-12-02 | 2025-12-08 | 6 |
| 991 | REUNION + DIFFUSION SYT RSX Indice 0 | Reunion | 985 | 990 FD | 0 | 2025-12-08 | 2025-12-08 | 7 |
| 992 | CYCLE 2 | Cycle | | | 0 | | | |
| 993 | RECEPTION RENDU CET RSX RESA TER | | 992 | 991 FD | 5 | 2025-12-09 | 2025-12-15 | |
| 994 | PLAN SYT CYCLE 2 | Sous-groupe | 992 | | 0 | | | |
| 995 | PLAN DE SYNTHESE RESEAUX NIV SS1 | | 994 | 993 FD | 5 | 2025-12-16 | 2025-12-22 | 1 |
| 996 | PLAN DE SYNTHESE RESERVATIONS NIV SS1 | | 994 | 995 FF | 2 | 2025-12-19 | 2025-12-22 | 2 |
| 997 | PLAN DE SYNTHESE TERMINAUX NIV SS1 | | 994 | 995 FF | 2 | 2025-12-19 | 2025-12-22 | 4 |
| 998 | REUNION + DIFFUSION SYT | Reunion | 992 | 995 FD | 0 | 2025-12-22 | 2025-12-22 | |
| 999 | CYCLE 3 | Cycle | | | 0 | | | |
| 1000 | RECEPTION RENDU CET RSX RESA TER | | 999 | 998 FD | 5 | 2025-12-23 | 2025-12-30 | |
| 1001 | VISA Indice A | | 999 | 1000 FD | 10 | 2025-12-31 | 2026-01-14 | |
| 1002 | PLAN SYT CYCLE 3 | Sous-groupe | 999 | | 0 | | | |
| 1003 | PLAN DE SYNTHESE RESEAUX NIV SS1 | | 1002 | 1000 FD | 5 | 2025-12-31 | 2026-01-07 | |
| 1004 | PLAN DE SYNTHESE RESERVATIONS NIV SS1 | | 1002 | 1003 FF | 2 | 2026-01-06 | 2026-01-07 | |
| 1005 | PLAN DE SYNTHESE TERMINAUX NIV SS1 | | 1002 | 1003 FF | 2 | 2026-01-06 | 2026-01-07 | |
| 1006 | REUNION + DIFFUSION SYT | Reunion | 999 | 1003 FD | 0 | 2026-01-07 | 2026-01-07 | |
| 1007 | SIGNATURE PLANS SYNTHESE | | 999 | 1001 FD+5 | 0 | 2026-01-21 | 2026-01-21 | |
| 1008 | DEMARRAGE GO SS1 (date prévisionnelle) | Demarrage | 999 | 1007 FD | 0 | 2026-01-21 | 2026-01-21 | |
| 1061 | test | | 985 | 988 FD | 1 | 2025-12-02 | 2025-12-02 | 4 |

Ordre affiché attendu (tout déplié) : `zone:zone1batbc`, `floor:zone1batbc/ss1`, `task:984`, `group:985`, `task:986`, `task:987`, `task:988`, `task:1061`, `task:989`, `task:990`, `task:991`, `group:992`, `task:993`, `group:994`, `task:995`, `task:996`, `task:997`, `task:998`, `group:999`, `task:1000`, `task:1001`, `group:1002`, `task:1003`, `task:1004`, `task:1005`, `task:1006`, `task:1007`, `task:1008`.

- [ ] **Étape 2 : écrire les tests en échec** dans `tests/syntheseCycleHierarchy.test.mjs` (lignes = `buildRowModel(buildSections({ rows }))`) :
  - `export de l'utilisateur : l'étage SS1 se lit comme avant` — les clés ci-dessus ; `group:985` → `level 2, depth 1, nature "cycle", parentGroupRowId null, cyclePath [985]` ; `group:994` → `level 3, depth 2, nature "sous-groupe", parentGroupRowId 992, cyclePath [992, 994]` ; `task:995` → `level 4, cyclePath [992, 994]` ; `task:984` → `cyclePath []`.
  - `sous-cycle dans un sous-cycle : profondeur et niveaux sans plafond` — avec en plus 2001 (« SOUS-SOUS », `Nature "Cycle"`, `Parent "994"`), 2002 (« NIVEAU 4 », `Nature "Cycle"`, `Parent "2001"`) et la tâche 2003 (`Parent "2002"`, 2026-02-02 → 2026-02-03, `Duree_1` 2) : `group:2001` niveau 4, profondeur 3, `nature "sous-groupe"` ; `group:2002` niveau 5, profondeur 4 ; `task:2003` niveau 6, `cyclePath [992, 994, 2001, 2002]` ; la Fin récapitulée de `group:992` vaut le 03/02/2026.
  - `Parent étranger, illisible ou lui-même : le cycle est directement dans son étage` — un étage « R+1 » (Etage, même zone) avec le cycle 3001 (`Groupe "R+1"`) ; dans SS1, 3002 `Parent "3001"`, 3003 `Parent "abc"`, 3004 `Parent "3004"` : les trois ont `depth 1` et `parentGroupRowId null`.
  - `boucle de Parent : le cycle de plus petit id passe dans l'étage` — 4001 `Parent "4002"`, 4002 `Parent "4001"` (tous deux `Cycle`, SS1) : 4001 `depth 1`, 4002 `depth 2` et `parentGroupRowId 4001`.
  - `suppression : toutes les lignes, à toute profondeur` — `groupRemovalIds(findGroup(sections, 992))` trié = `[992, 993, 994, 995, 996, 997, 998]` ; avec les lignes 2001-2003, il contient aussi 2001, 2002 et 2003 ; `descendantGroups(findGroup(sections, 992)).map((g) => g.rowId)` = `[994, 2001, 2002]`.
  - `question de suppression` — `buildGroupDeleteQuestion(findGroup(sections, 992))` = « Supprimer « CYCLE 2 », son sous-cycle et ses 5 tâches ? ». Sur des objets `{ name, tasks, groups }` :
    - `{ name: "VIDE", tasks: [], groups: [] }` → « Supprimer « VIDE » ? » ;
    - une tâche → « Supprimer « UN » et sa tâche ? » ;
    - 3 tâches → « Supprimer « X » et ses 3 tâches ? » ;
    - un sous-cycle sans tâche → « Supprimer « X » et son sous-cycle ? » ;
    - deux sous-cycles sans tâche → « Supprimer « X » et ses 2 sous-cycles ? » ;
    - deux sous-cycles et une tâche → « Supprimer « X », ses 2 sous-cycles et sa tâche ? ».
    Le compte de sous-cycles est celui de `descendantGroups`.
  - `tâche contrôlée par défaut : un plan de réservations sous CYCLE 3, à toute profondeur` — `readControlTasks(eraSs1Rows())` contient 1004 (`chosen: false`) et pas 996. Si 1004 passe dans un nouveau cycle 2010 (`Parent "1002"`), elle reste contrôlée.

- [ ] **Étape 3 : lancer, constater l'échec**

Lancer : `node --test tests/syntheseCycleHierarchy.test.mjs`
Attendu : ÉCHEC (`descendantGroups` non exporté, `depth`/`cyclePath` absents).

- [ ] **Étape 4 : coder `placeFloorContent(floor)`**

Le parent d'un cycle est le cycle du même étage dont l'id vaut son `parentId`, sauf s'il s'agit de lui-même (sinon : `null`). Boucles : en remontant les parents, un cycle qui se retrouve lui-même est dans une boucle ; pour chaque boucle, le cycle de plus petit id prend `parentGroup = null`. `depth` = 1 + profondeur du parent. Les éléments se rangent comme aujourd'hui : chaque cycle dans `items` de son parent (ou de l'étage) et dans `groups` de son parent. Chaque tâche va dans `tasks` de tous ses ancêtres ; tri `compareRanked`/`byRowId` inchangé, récapitulatifs inchangés.

- [ ] **Étape 5 : coder les lignes et la suppression**

Dans `buildRowModel`, propager `cyclePath` : `pushItems` reçoit le chemin courant. Les lignes de cycle reçoivent `depth`, `parentGroupRowId` et la `nature` dérivée. Ajouter `descendantGroups`, puis réécrire `groupRemovalIds` et `buildGroupDeleteQuestion` comme dans les Interfaces et les tests.

- [ ] **Étape 6 : tâche contrôlée par défaut**

Dans `structureLinkModel.js`, remplacer `cycleNameOf` par une recherche parmi **tous** les cycles qui contiennent la tâche (remontée par `parentId` dans `groupsById`, avec une garde contre les boucles) : la tâche est contrôlée par défaut si l'un d'eux correspond à `RESERVATION_CYCLE`.

- [ ] **Étape 7 : lancer toute la suite**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe. Mettre à jour `syntheseGroupRules.test.mjs:83` vers « Supprimer « CYCLE 2 », son sous-cycle et ses 5 tâches ? ». Aucun autre test existant ne doit changer : les données actuelles s'affichent à l'identique.

---

### Tâche 2 : Retraits sans plafond et vue Global

**Fichiers :**
- Modifier : `Planning Projet/assets/js/ui/syntheseTaskTable.js` (`buildLine` l. 387-427, `createInput` l. 528)
- Modifier : `Planning Projet/assets/css/styles.css` (règles de retrait l. 3057-3122)
- Modifier : `Planning Projet/tests/syntheseTaskTable.test.mjs` (tests « styles des étages… » et « styles : couleurs… retraits par niveau »)
- Modifier : `Planning Projet/tests/globalRowModel.test.mjs` (nouveau test)

**Interfaces :**
- Consomme : `line.level` (tâche 1).
- Produit : la variable CSS `--stt-level` posée sur chaque ligne (`element.style.setProperty("--stt-level", String(line.level))`) ; plus de classe `is-level-N`.

- [ ] **Étape 1 : écrire les tests en échec**
  - Dans `syntheseTaskTable.test.mjs`, remplacer les assertions de retrait par :
    - `css` contient `.stt-line--group .stt-cell--name { … padding-left: calc(var(--stt-level, 2) * 16px); }` ;
    - `css` contient `.stt-line--task.is-in-floor .stt-cell--name { … padding-left: calc(14px + var(--stt-level, 2) * 16px); }` ;
    - ni `css` ni `source` ne contiennent `is-level-` ;
    - `source` contient `element.style.setProperty("--stt-level", String(line.level))` ;
    - `source` contient `group: "Nom du cycle"`.
    Les règles `.is-editing { padding-left: 0; }` restent exigées pour les lignes de cycle et les tâches d'étage.
  - Dans `globalRowModel.test.mjs` : `vue Global : un sous-cycle imbriqué est un cran plus bas que son parent`. Aux `projectRows()`, ajouter le cycle 700 (`Nature "Cycle"`, `Parent "419"`, Zone `ZONE_2`, `Groupe "RDC"`, `Service "Synthese"`) et la tâche 701 (`Parent "700"`, datée le 12/10/2026, `Duree_1` 1). Avec `toggledKeys` = `RDC_PATH` + `"group:700"`, on attend : `level(group:700) === level(group:419) + 1` et `level(task:701) === level(group:700) + 1`.

- [ ] **Étape 2 : lancer, constater l'échec**

Lancer : `node --test tests/syntheseTaskTable.test.mjs tests/globalRowModel.test.mjs`
Attendu : ÉCHEC sur les règles CSS et la variable. Le test Global peut déjà passer : il fixe le comportement.

- [ ] **Étape 3 : coder**

Dans `buildLine`, retirer la classe `is-level-${line.level}` et poser la variable. Dans le CSS, deux règles `calc` remplacent les règles par niveau (32/48 px et 46/62/78 px restent les valeurs aux niveaux existants), et les deux règles `.is-editing` sont gardées. Le libellé de saisie d'un cycle devient « Nom du cycle ».

- [ ] **Étape 4 : lancer toute la suite**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe.

---

### Tâche 3 : Créer un cycle ou un sous-cycle

**Fichiers :**
- Créer : `Planning Projet/assets/js/services/syntheseCycles.js`
- Modifier : `Planning Projet/assets/js/ui/syntheseTaskTable.js` (`buildMenuItems` l. 84-122, `runMenuItem` l. 647, options de `draw` l. 429-433, paramètres de `createSyntheseTaskTable`)
- Modifier : `Planning Projet/assets/js/ui/syntheseTasksController.js` (`MESSAGES`, `createTable` l. 185, `render` l. 307-312, nouveau `handleAddCycle`)
- Créer : `Planning Projet/tests/syntheseCycles.test.mjs`
- Créer : `Planning Projet/tests/syntheseCyclesController.test.mjs`
- Modifier : `Planning Projet/tests/syntheseTaskTable.test.mjs` (menus d'étage et de cycle, libellé « Supprimer le sous-cycle »)

**Interfaces :**
- Consomme : `findContainer`, `renumberItems` (syntheseTaskOrder.js) ; `NATURES`, `TASK_COLUMNS` ; objets cycle de la tâche 1.
- Produit (`syntheseCycles.js`) :
  - `NEW_CYCLE_NAME = "Nouveau cycle"`, `NEW_SUBCYCLE_NAME = "Nouveau sous-cycle"` ;
  - `natureForDepth(depth) → "Cycle" | "Sous-groupe"` (`NATURES.cycle` si `depth <= 1`, sinon `NATURES.subgroup`) ;
  - `planCycleInsert({ sections, zoneKey, floorKey, parentGroupRowId = null, canOrder = false, projectName = "" }) → { fields, changes, depth, name, floor, parent } | null` :
    - `null` si le conteneur n'existe pas ou n'est pas dans un étage ;
    - `fields` = `{ Taches, Zone, Groupe, NomProjet, Nature, Duree_1: 0 }`, plus `Parent: String(parentId)` dans un cycle et `Ordre: String(n + 1)` avec `canOrder` ;
    - `changes` = `renumberItems(contenu actuel)` avec `canOrder`, sinon `new Map()`.
- Produit (tableau) : `buildMenuItems(line, { canAddFloor = true, canAddCycle = true } = {})` ; option de rendu `canAddCycle` (vrai par défaut) ; rappel `onAddCycle(zoneKey, floorKey, parentGroupRowId)`.
- Produit (contrôleur) : `handleAddCycle(zoneKey, floorKey, parentGroupRowId = null) → Promise` ; `MESSAGES.noCycleColumns` = « Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les pour créer des cycles. »

- [ ] **Étape 1 : écrire les tests en échec**
  - `syntheseCycles.test.mjs` (sections de `eraSs1Rows()`) :
    - `nouveau cycle dans l'étage : fin de l'étage, Nature Cycle, sans Parent` — `planCycleInsert({ …, zoneKey: ERA_ZONE_KEY, floorKey: "ss1", canOrder: true, projectName: ERA_PROJECT })`. `fields` = `{ Taches: "Nouveau cycle", Zone: ERA_ZONE, Groupe: "SS1", NomProjet: ERA_PROJECT, Nature: "Cycle", Duree_1: 0, Ordre: "5" }`. `changes` donne `Ordre` "1" à 984, "2" à 985, "3" à 992 et "4" à 999. `depth` vaut 1.
    - `nouveau sous-cycle dans PLAN SYT CYCLE 2 : Parent, Nature Sous-groupe, fin du sous-cycle` — `parentGroupRowId: 994`. `fields.Parent` = "994", `fields.Nature` = "Sous-groupe", `fields.Taches` = "Nouveau sous-cycle", `fields.Ordre` = "4". `changes` = `{ 997 → { Ordre: "3" } }`. `depth` vaut 3.
    - `sans Ordre : pas de rang` — `canOrder: false` : pas de clé `Ordre`, `changes.size === 0`.
    - `conteneur introuvable ou niveau zone : null` (`floorKey: ""` ; `parentGroupRowId: 9999`).
  - `syntheseTaskTable.test.mjs` : le menu d'étage devient `[addTask, { label: "Ajouter un cycle", action: "addCycle", zoneKey, floorKey, parentGroupRowId: null, disabled: false }, deleteFloor]`. Le menu de cycle devient `[addTask, { label: "Ajouter un sous-cycle", action: "addCycle", zoneKey, floorKey, parentGroupRowId: 203, disabled: false }, { label: "Supprimer le cycle", … }]`. Avec `canAddCycle: false`, l'entrée a `disabled: true`. Avec `nature: "sous-groupe"`, le libellé de suppression est « Supprimer le sous-cycle ». Le menu d'une tâche ne change pas. `source` contient `onAddCycle?.(item.zoneKey, item.floorKey, item.parentGroupRowId ?? null)`.
  - `syntheseCyclesController.test.mjs`. Le harnais est celui de `syntheseTaskOrderController.test.mjs`, sur `eraSs1Rows()`, avec projet `ERA_PROJECT` et `startEditingGroup` enregistré par le faux tableau :
    - `Ajouter un cycle : une écriture, nom en saisie, message` — `applyUserActions` rend `{ retValues: [3000] }`. `writes[0]` = `[["AddRecord", "Planning_Projet", null, fields], …buildUpdateActions(changes)]`. Ensuite, `startEditingGroup(3000)`, la dernière ligne rendue contient `group:3000`, et le dernier statut est le texte exact `Cycle ajouté dans l'étage « SS1 ».`.
    - `Ajouter un sous-cycle dans un cycle replié : la chaîne de ses cycles est dépliée` — après `onToggleGroup(992)` puis `onAddCycle(ERA_ZONE_KEY, "ss1", 994)`, les lignes rendues contiennent `group:994` et le nouveau cycle. Le dernier statut est le texte exact `Sous-cycle ajouté dans « PLAN SYT CYCLE 2 ».`.
    - `colonnes du modèle absentes : entrée grisée, clic expliqué, rien n'est écrit` — lignes sans les clés `Nature`, `Parent`, `Lien` : `options.canAddCycle === false`. `onAddCycle` donne le statut `noCycleColumns` (ton `error`) et aucune écriture.
    - `verrouillé : refus` — `setEditingEnabled(false)` : statut « Activez « Editer »… », aucune écriture.
    - `sans Ordre : création possible, sans rang` (Review Focus 5) — lignes sans clé `Ordre` : `canAddCycle === true`, et `writes[0][0][3]` n'a pas de clé `Ordre`.

- [ ] **Étape 2 : lancer, constater l'échec**

Lancer : `node --test tests/syntheseCycles.test.mjs tests/syntheseCyclesController.test.mjs tests/syntheseTaskTable.test.mjs`
Attendu : ÉCHEC (module introuvable, menus différents).

- [ ] **Étape 3 : coder `syntheseCycles.js` (création)** selon les Interfaces. Le module est pur et documenté comme les autres services : un en-tête qui dit son rôle.

- [ ] **Étape 4 : coder le menu et le rappel du tableau** selon les Interfaces. `draw` lit `canAddCycle = options?.canAddCycle !== false`.

- [ ] **Étape 5 : coder `handleAddCycle`** sur le modèle de `handleAddTask`.
  - Refus si non modifiable (`refuseLocked`). Si `templateColumns === false`, statut `noCycleColumns`.
  - Plan sur `allSections()`, avec `canOrder: orderColumn === true`.
  - Écriture : `[["AddRecord", PLANNING_TABLE, null, plan.fields], ...buildUpdateActions(plan.changes)]`.
  - Au succès :
    - ajouter la ligne `{ id, ...fields }` si elle manque ;
    - déplier la zone, l'étage et toute la chaîne `plan.parent` → `parentGroup` ;
    - `render()`, puis `table.startEditingGroup(id)` ;
    - `info(\`Sous-cycle ajouté dans « ${parent.name} ».\`)` dans un cycle, sinon `info(\`Cycle ajouté dans l'étage « ${floor.name} ».\`)`.
  - À l'échec : si `describeWriteError` rend `noTemplateColumns`, passer `templateColumns = false`, redessiner et afficher `noCycleColumns` ; sinon `fail("Ajout du cycle impossible :", …)`.
  - `render` passe `canAddCycle: templateColumns !== false`.

- [ ] **Étape 6 : lancer toute la suite**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe.

---

### Tâche 4 : Règle du bloc — déplacer et supprimer un cycle (module pur)

**Fichiers :**
- Modifier : `Planning Projet/assets/js/services/syntheseTaskOrder.js`. Exporter, sans changer leur comportement : `allTasksOf`, `mergeChanges`, `linkMap`, `linkChanges`, `recomputeDates`, `clearOrphans`, `slotIndex`. `slotIndex` accepte aussi `position = { groupRowId, side: "before" }` : place avant l'élément cycle d'id `groupRowId`.
- Modifier : `Planning Projet/assets/js/services/syntheseCycles.js`
- Créer : `Planning Projet/tests/syntheseCycleMove.test.mjs`

**Interfaces :**
- Consomme : briques exportées ci-dessus, `findContainer`, `taskOrder`, `renumberItems`, `findGroup`, `groupRemovalIds`, `natureKeyOf`.
- **Cible** (produite par la tâche 5, consommée ici) : `{ key, label, zoneKey, zoneName, floorKey, floorName, groupRowId, position? }`.
  - `groupRowId` : le conteneur d'arrivée (id du cycle, ou `null` pour l'étage).
  - `position` : `{ taskId, side: "before" | "after" }` ou `{ groupRowId, side: "before" }` ; absente = fin du conteneur.
- Produit : `planCycleMove({ sections, groupRowId, target, canLink = false }) → Map<rowId, fields>` (vide si refus ou même place).
- Produit : `planCycleRemoval({ sections, groupRowId, canLink = false }) → Map<rowId, fields>` (champs des lignes restantes ; vide sans `canLink`).

- [ ] **Étape 1 : écrire les tests en échec** dans `tests/syntheseCycleMove.test.mjs`, sur `buildSections({ rows: eraSs1Rows() })` avec `canLink: true` sauf mention. Une aide `target(groupRowId, position)` complète `zoneKey`, `zoneName`, `floorKey: "ss1"` et `floorName: "SS1"`.
  - `exemple 1 de la spec : CYCLE 3 au-dessus de CYCLE 2` — `planCycleMove(999, target(null, { groupRowId: 992, side: "before" }))`.
    - `Ordre` : 984 "1", 985 "2", 999 "3", 992 "4" ; aucune clé `Parent` ni `Nature` pour 999.
    - `Lien` : 1000 "991 FD", 993 "1008 FD".
    - Dates : 1000 du 2025-12-09 au 2025-12-15, et `changes.get(993).Diff_coffrage > changes.get(1008).Diff_armature`.
  - `exemple 2 : CYCLE 2 au-dessus de CYCLE 1, reprise du lien d'entrée` — `planCycleMove(992, target(null, { groupRowId: 985, side: "before" }))`.
    - `Ordre` : 984 "1", 992 "2", 985 "3", 999 "4".
    - `Lien` : 993 "984 DD", 986 "998 FD", 1000 "991 FD".
    - Dates : 993 commence le 2025-11-14.
  - `exemple 3 : PLAN SYT CYCLE 2 en tête de CYCLE 3` — `planCycleMove(994, target(999, { taskId: 1000, side: "before" }))`.
    - 994 : `Parent` "999", `Ordre` "1", pas de `Nature`.
    - `Ordre` : 1000 "2", 1001 "3", 1002 "4", 1006 "5", 1007 "6", 1008 "7".
    - `Lien` : 998 "993 FD", 995 "998 FD", 1000 "995 FD" ; aucune clé `Lien` pour 996 et 997.
  - `CYCLE 2 à la fin de CYCLE 1 : il devient sous-cycle, la chaîne est déjà bonne` — `planCycleMove(992, target(985))` donne exactement `{ 992 → { Parent: "985", Nature: "Sous-groupe", Ordre: "8" } }`.
  - `PLAN SYT CYCLE 3 sorti à la fin de l'étage : il redevient cycle` — `planCycleMove(1002, target(null))`.
    - 1002 : `{ Parent: "", Nature: "Cycle", Ordre: "5" }`.
    - `Lien` : 1006 "1000 FD", 1003 "1008 FD".
  - `refus : dans lui-même, dans un de ses sous-cycles, dans un autre étage` — la taille vaut 0 pour `target(992)`, `target(994)` (déplacement de 992), et pour une cible de `floorKey: "rp1"` (étage « R+1 » ajouté aux lignes).
  - `à la même place : rien` (Review Focus 3) — taille 0 pour `planCycleMove(992, target(null, { groupRowId: 999, side: "before" }))` et pour `planCycleMove(999, target(null))`.
  - `cycle vide : seul l'ordre bouge` — avec le cycle vide 2000 (`Nature "Cycle"`, `Groupe "SS1"`), `planCycleMove(2000, target(null, { groupRowId: 985, side: "before" }))` n'écrit que `Ordre`.
  - `bloc arrivé tout en haut : plus de lien d'entrée, dates gardées` — `planCycleMove(992, target(null, { taskId: 984, side: "before" }))`.
    - 993 : `Lien` "", sans clé de date.
    - 1000 : `Lien` "991 FD".
    - Aucune clé `Lien` pour 984.
  - `jamais de boucle` — avec 991 en `Lien "996 FF"`, `planCycleMove(992, target(null))` donne `Lien` "" à 991.
  - `bloc non daté : liens refaits, aucune date` (Review Focus 2) — sur `templateRows()` (zone `zonez3a`, étage `ss1`) avec `Ordre: ""` sur chaque ligne, `planCycleMove(210, cible de l'étage avec position { groupRowId: 203, side: "before" })`.
    - `Lien` : 211 "202 DD", 204 "216 FD", 218 "209 FD".
    - Aucune clé `Diff_coffrage` dans les changements.
  - `sans la colonne Lien : seulement Parent, Nature, Ordre` — l'exemple 2 avec `canLink: false` ne produit aucune clé `Lien` ni de date.
  - `supprimer un cycle referme la chaîne` — `planCycleRemoval(992)` donne 1000 avec `Lien` "991 FD" et `Diff_coffrage` "2025-12-09". `planCycleRemoval(994)` donne 998 avec `Lien` "993 FD" et `Diff_coffrage` "2025-12-15". Avec `canLink: false`, la taille vaut 0.

- [ ] **Étape 2 : lancer, constater l'échec**

Lancer : `node --test tests/syntheseCycleMove.test.mjs`
Attendu : ÉCHEC (`planCycleMove` non exporté).

- [ ] **Étape 3 : exporter les briques de `syntheseTaskOrder.js`** et étendre `slotIndex`. Lancer `node --test tests/syntheseTaskOrder.test.mjs tests/syntheseTaskChain.test.mjs` : ils restent verts.

- [ ] **Étape 4 : coder `planCycleMove`**

D'abord la partie ordre :
- conteneur de départ = le parent du cycle ou l'étage ; conteneur d'arrivée = `findContainer(sections, target)` ;
- refus si l'arrivée est hors de l'étage du cycle, ou si son cycle est le cycle déplacé ou l'un de ses descendants ;
- `placed` = contenu d'arrivée sans le cycle, avec le cycle inséré à `slotIndex(...)` ; même conteneur et même ordre → `Map` vide ;
- champs du cycle : `Parent` et `Nature` (`natureForDepth(nouvelle profondeur)` comparée à `group.natureKey`), seulement s'ils changent ;
- puis `renumberItems(placed)`.

Ensuite, si `canLink` : la règle du bloc de la spec (§7.4). `oldOrder` = `taskOrder(étage)`. `newOrder` = `taskOrder(étage, overrides)`, où `overrides` remplace le contenu d'arrivée par `placed` et celui de départ par son contenu sans le cycle. Le bloc est `taskOrder({ key: \`group:${id}\`, items: group.items })`.

```text
D, L = premier et dernier du bloc ; bloc vide → s'arrêter (seul l'ordre)
entrée = lien(D) s'il désigne une tâche hors du bloc, sinon null
B = oldOrder[index(L) + 1]
X = prédécesseur de B si B suit en FD une tâche du bloc
    sinon la tâche du bloc qui finit le plus tard (égalité : la dernière dans l'ordre ; rien de daté : L)
1. si B suit en FD une tâche du bloc :
     lien(B) = entrée ? (entrée FD ? { entrée.pred, FD, décalage de B } : copie de entrée) : null
2. P = newOrder[index(D) - 1], N = newOrder[index(L) + 1], ancien = lien(D)
     pas de P            → lien(D) = null
     N suit P en FD      → lien(D) = ancien s'il désigne P, sinon { P, FD, 0 } ; lien(N) = { X, FD, décalage de N }
     N liée à P autrement → lien(D) = copie de lien(N) ; lien(N) = { X, FD, 0 }
     sinon               → lien(D) = ancien s'il désigne P, sinon { P, FD, 0 }
3. en remontant depuis P : la première tâche dont le prédécesseur est dans le bloc
     reprend `ancien` (s'il ne la désigne pas elle-même), sinon null
   un lien posé à l'étape 2 sur N qui fermerait une boucle n'est pas posé (N garde son lien)
4. dates : recomputeDates(tâches, liens, [B, tâche de l'étape 3, D, N] sans doublon ni null)
résultat = mergeChanges(ordre, linkChanges(liens d'origine, liens), dates)
```

- [ ] **Étape 5 : coder `planCycleRemoval`** : sans `canLink`, `Map` vide. Sinon, l'étape 1 ci-dessus, puis `clearOrphans` sur `groupRemovalIds(group)`. Les lignes supprimées sont retirées des liens et des tâches, puis `recomputeDates` part de B.

- [ ] **Étape 6 : lancer toute la suite**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe.

---

### Tâche 5 : Glisser un cycle — cibles, poignée, trait d'insertion

**Fichiers :**
- Modifier : `Planning Projet/assets/js/services/syntheseTaskOrder.js` (`resolveDropSlot` l. 121-138)
- Modifier : `Planning Projet/assets/js/services/syntheseCycles.js` (nouveau `resolveCycleDropSlot`)
- Modifier : `Planning Projet/assets/js/ui/syntheseTaskDrag.js`
- Modifier : `Planning Projet/assets/js/ui/syntheseTaskTable.js` (`buildNameCell` l. 360-385, `placeDropLine` l. 832-841, `draw`, `createTaskDrag(...)` l. 857-871, nouvelle fonction pure exportée)
- Modifier : `Planning Projet/assets/css/styles.css` (survol de la poignée d'un cycle)
- Modifier : `Planning Projet/tests/syntheseTaskOrder.test.mjs`, `tests/syntheseCycles.test.mjs`, `tests/syntheseTaskDrag.test.mjs`, `tests/syntheseTaskTable.test.mjs`

**Interfaces :**
- Consomme : `line.cyclePath`, `line.parentGroupRowId`, `line.level` (tâche 1) ; forme de la cible (tâche 4).
- Produit : `resolveCycleDropSlot(line, side, { groupRowId, zoneKey, floorKey }) → cible | null`. Les trois options décrivent le cycle glissé ; les règles sont celles du tableau du §7.2 de la spec. Clés et libellés :
  - avant ou après une tâche : `key: "slot:<taskId>:<side>"`, `label: « Placer avant « nom » »` ou `« Placer après « nom » »`, `groupRowId` = cycle de la tâche (`line.groupRowId`), `position: { taskId, side }` ;
  - moitié haute d'un cycle K : `key: "slot:group:<K>:before"`, `label: « Placer avant « K » »`, `groupRowId: line.parentGroupRowId`, `position: { groupRowId: K, side: "before" }` ;
  - moitié basse d'un cycle K : `key: "group:<K>"`, `label: « Déplacer à la fin de « K » »`, `groupRowId: K` ;
  - ligne de l'étage : `key: "floor:<zone>/<étage>"`, `label: « Déplacer à la fin de « étage » »`, `groupRowId: null`.
- Modifie : `resolveDropSlot` (tâches glissées). Avec `canOrder`, la **moitié haute d'une ligne de cycle** rend la même cible « Placer avant « K » » que ci-dessus ; la moitié basse ne change pas (fin du cycle).
- Produit (`syntheseTaskTable.js`) : `placeOfDropSlot(lines, slot, { headHeight = 32, rowHeight = 26, indentPx = 16 } = {}) → { top, left } | null`. La ligne visée est la tâche `slot.taskId` ou le cycle `slot.groupRowId`. `top = headHeight + (index + (side === "after" ? 1 : 0)) * rowHeight`, `left = line.level * indentPx`.
- Produit (`createTaskDrag`) : options `canMoveCycles = () => false` et `onDropCycle = (groupRowId, target) => {}`. La poignée d'une ligne `data-kind="group"` ne glisse que si `canMoveCycles()`.
- Produit (tableau) : option de rendu `canMoveCycles` ; rappel `onMoveCycle(groupRowId, target)`.

- [ ] **Étape 1 : écrire les tests en échec**
  - `syntheseCycles.test.mjs` : `cibles d'un cycle glissé`, sur les lignes de `eraSs1Rows()`.
    - Glisser 994 sur `task:1000` (« before ») donne exactement `{ key: "slot:1000:before", zoneKey: ERA_ZONE_KEY, zoneName: ERA_ZONE, floorKey: "ss1", floorName: "SS1", groupRowId: 999, label: "Placer avant « RECEPTION RENDU CET RSX RESA TER »", position: { taskId: 1000, side: "before" } }`.
    - Glisser 992 sur `group:985` : « before » donne `{ key: "slot:group:985:before", groupRowId: null, label: "Placer avant « CYCLE 1 »", position: { groupRowId: 985, side: "before" } }` (plus zone et étage) ; « after » donne `{ key: "group:985", groupRowId: 985, label: "Déplacer à la fin de « CYCLE 1 »" }`.
    - Sur la ligne d'étage : « Déplacer à la fin de « SS1 » ».
    - `null` pour `group:992`, `group:994`, `task:995` et `task:998` (dans le cycle glissé), pour la ligne de zone et pour toute ligne d'un étage « R+1 » ajouté.
  - `syntheseTaskOrder.test.mjs` : `tâche glissée sur la moitié haute d'un cycle : avant le cycle, dans son conteneur`. Sur les lignes du modèle (ids 2xx), `resolveDropSlot(line("group:217"), "before", { canOrder: true })` donne `position: { groupRowId: 217, side: "before" }`, `groupRowId: null` et `label: "Placer avant « CYCLE 3 »"`. Sans `canOrder`, rien ne change. Puis, sur `eraSs1Rows()`, `planTaskMove` de 1061 vers `{ zoneKey: ERA_ZONE_KEY, floorKey: "ss1", groupRowId: null, position: { groupRowId: 992, side: "before" } }` (`canOrder: true, canLink: false`) écrit 1061 `{ Parent: "", Ordre: "3" }`, avec les rangs de l'étage 984 "1", 985 "2", 992 "4" et 999 "5".
  - `syntheseTaskDrag.test.mjs` : `glisser un cycle par sa poignée`. Le jeu de lignes contient étage, cycles et tâches ; le corps factice pose une poignée sur les lignes de cycle (`data-kind="group"`, `data-group-row-id`).
    - Avec `canMoveCycles` et `canOrder` vrais : glisser la poignée du cycle B sur la moitié haute du cycle A appelle `onDropCycle(B, cible)` avec `cible.position = { groupRowId: A, side: "before" }`, et non `onDrop`.
    - `markSlot` reçoit `{ groupRowId: A, side: "before" }`.
    - Avec `canMoveCycles` faux, la poignée ne glisse pas.
  - `syntheseTaskTable.test.mjs` :
    - `placeOfDropSlot` sur les lignes de `eraSs1Rows()` : `{ groupRowId: 985, side: "before" }` donne `{ top: 32 + 26 * 3, left: 32 }` ; `{ taskId: 1000, side: "after" }` donne `{ top: 32 + 26 * 20, left: 48 }` ; un slot inconnu donne `null`.
    - `source` contient `line.kind === "group" && editable && canMoveCycles`.
    - `css` contient `.stt-line--group:hover .stt-grip { visibility: visible; }`.

- [ ] **Étape 2 : lancer, constater l'échec**

Lancer : `node --test tests/syntheseCycles.test.mjs tests/syntheseTaskOrder.test.mjs tests/syntheseTaskDrag.test.mjs tests/syntheseTaskTable.test.mjs`
Attendu : ÉCHEC.

- [ ] **Étape 3 : coder les cibles** (`resolveCycleDropSlot`, extension de `resolveDropSlot`).

- [ ] **Étape 4 : coder le glisser**

L'état du glisser porte `kind: "task" | "group"`. Pour un cycle :
- la cible vient de `resolveCycleDropSlot(lines[index], side, { groupRowId, zoneKey, floorKey })`, sans filtre de conteneur source ;
- au lâcher, `onDropCycle(groupRowId, target)` ;
- copie, estompage, défilement et Échap fonctionnent comme pour une tâche.

- [ ] **Étape 5 : coder le tableau**
  - La poignée d'une ligne de cycle va **avant** le triangle de repli, avec le titre « Glisser pour déplacer le cycle » ou « Glisser pour déplacer le sous-cycle » selon `line.nature`.
  - `placeDropLine` utilise `placeOfDropSlot` et pose `top` et `left`.
  - `draw` lit `canMoveCycles` ; `createTaskDrag` reçoit `canMoveCycles: () => canMoveCycles && editable` et `onDropCycle: (id, target) => onMoveCycle?.(id, target)`.
  - CSS : règle de survol de la poignée sur `.stt-line--group`.

- [ ] **Étape 6 : lancer toute la suite**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe.

---

### Tâche 6 : Contrôleur — déplacer et supprimer un cycle

**Fichiers :**
- Modifier : `Planning Projet/assets/js/ui/syntheseTasksController.js` (`createTable` l. 185, `render` l. 307-312, `handleDeleteGroup` l. 863-889, nouveau `handleMoveCycle`)
- Modifier : `Planning Projet/tests/syntheseCyclesController.test.mjs`

**Interfaces :**
- Consomme : `planCycleMove`, `planCycleRemoval` (tâche 4) ; `descendantGroups`, `groupRemovalIds` (tâche 1) ; rappel `onMoveCycle` et option `canMoveCycles` (tâche 5).
- Produit : `handleMoveCycle(groupRowId, target)`. `render` passe `canMoveCycles: orderColumn === true && templateColumns === true`.

- [ ] **Étape 1 : écrire les tests en échec** (même harnais que la tâche 3)
  - `glisser CYCLE 2 avant CYCLE 1 : une écriture, celle du plan` — après `onMoveCycle(992, cible)`, `writes[0]` vaut exactement `buildUpdateActions(planCycleMove({ sections: buildSections({ rows: eraSs1Rows() }), groupRowId: 992, target: cible, canLink: true }))`.
  - `cycle replié déplié` (Review Focus 4) — après `onToggleGroup(985)` puis `onMoveCycle(992, cible dans 985)`, les dernières lignes rendues contiennent `group:985` déplié et `group:992`.
  - `sans Ordre : pas de poignée, rien n'est écrit` (Review Focus 5) — lignes sans clé `Ordre` : `options.canMoveCycles === false`, et `onMoveCycle` n'écrit rien.
  - `verrouillé : refus` — `setEditingEnabled(false)` : statut « Activez « Editer »… », aucune écriture.
  - `supprimer CYCLE 2 : toutes ses lignes, la chaîne se referme` — `confirm` reçoit « Supprimer « CYCLE 2 », son sous-cycle et ses 5 tâches ? ». `writes[0][0]` est un `BulkRemoveRecord` dont les ids, triés, sont `[992, 993, 994, 995, 996, 997, 998]`. La suite de `writes[0]` donne à 1000 le `Lien` « 991 FD ».

- [ ] **Étape 2 : lancer, constater l'échec**

Lancer : `node --test tests/syntheseCyclesController.test.mjs`
Attendu : ÉCHEC.

- [ ] **Étape 3 : coder `handleMoveCycle`**, sur le modèle de `handleMoveTask`.
  - Refus si non modifiable.
  - Rien sans `orderColumn === true && templateColumns === true`, sans cible, ou si le plan est vide.
  - Plan sur `allSections()` avec `canLink: templateColumns === true`.
  - Déplier la zone, l'étage, le cycle d'arrivée et ses parents.
  - `submit(createOp({ changes, actions: buildUpdateActions(changes) }))`, avec `fail("Déplacement du cycle impossible :", …)` en cas d'échec.
  - Brancher `onMoveCycle` dans `createTable`.

- [ ] **Étape 4 : coder la suppression**
  - `handleDeleteGroup` remplace `planOrphanLinks` par `planCycleRemoval({ sections: allSections(), groupRowId, canLink: templateColumns === true })`.
  - Au succès, il oublie les replis du cycle et de **tous** ses `descendantGroups`.

- [ ] **Étape 5 : lancer toute la suite**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe.

---

### Tâche 7 : Vérification finale

**Fichiers :**
- Modifier : `Planning Projet/index.html` (`?v=` de `styles.css` et `main.js` : `20261020-cycles1`)

- [ ] **Étape 1 : version des ressources** — remplacer `?v=20261013-global1` par `?v=20261020-cycles1` sur `styles.css` et `main.js` uniquement. Les scripts `shared/` gardent leur version.
- [ ] **Étape 2 : suite complète**

Lancer : `node --test tests/*.test.mjs`
Attendu : tout passe, 616 + les nouveaux tests, 0 échec.

- [ ] **Étape 3 : rendu réel dans Chrome sans interface**

Rendre le tableau Synthese avec les vrais modules et le CSS. Données : `eraSs1Rows()`, plus un sous-sous-cycle (lignes 2001-2003 de la tâche 1). Vérifier sur la capture :
- retraits progressifs ;
- bande grise sur les seuls cycles de profondeur 1 ;
- poignées sur les cycles en mode modifiable ;
- accolades du Gantt à chaque niveau.
- [ ] **Étape 4 : bilan** — lister pour l'utilisateur les fichiers modifiés et ce qu'il doit tester sur localhost (Ctrl+F5 : les sous-modules n'ont pas de `?v=`) : création, glisser réel, les trois exemples de la spec. Pas de commit.
