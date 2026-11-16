# Synthese « Paramètre » (modèle d'étage par projet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un bouton « Paramètre » ouvre une fenêtre où l'on modifie, par projet, le modèle d'étage de la vue Synthese, avec les mêmes gestes que le tableau. Le modèle est enregistré dans `Projets2.Synthese_Parametre`, et les nouveaux étages le suivent.

**Architecture :** le modèle est une liste d'éléments, comme `FLOOR_TEMPLATE`, sérialisée en JSON (module pur). La fenêtre crée une seconde instance du tableau et du contrôleur Synthese. Elle les branche sur des lignes en mémoire, datées à partir d'un lundi fictif, et sur un faux `docApi` : aucun geste n'est réécrit. La création d'étage reçoit le modèle du projet par une option injectée.

**Tech Stack :** modules ES natifs, sans framework ni bundler. Tests avec `node:test` et `node:assert/strict`, faux DOM local comme dans `tests/syntheseStoreyTable.test.mjs`.

**Spec :** `docs/superpowers/specs/2026-11-16-synthese-parametre-modele-design.md`. Lire la spec avant chaque tâche : le plan argumente à partir d'elle.

## Global Constraints

- Les chemins sont relatifs à `Planning Projet/`. Commande de test : `cd "Planning Projet" && node --test tests/*.test.mjs`. Ne pas passer le dossier `tests/` seul.
- **Aucun commit** : l'utilisateur commite lui-même. Les étapes « Commit » sont remplacées par « Vérifier `git status` ». Les revues par tâche se font sur un instantané de l'arbre de travail.
- Fichiers en LF : vérifier avec `tr -cd '\r' < fichier | wc -c` qui doit donner 0. Écrire en UTF-8. Pour une regex d'accents, utiliser `/\p{M}/gu` et jamais `̀-ͯ` tapé : l'outil d'écriture décode `\uXXXX`.
- Colonne : `Projets2.Synthese_Parametre`, de type Texte. Clé de config : `syntheseParametre`.
- JSON : `{ "version": 1, "items": [...] }`. Les éléments suivent le format `FLOOR_TEMPLATE` plus `days`, et `id2`, `indice`, `control` facultatifs.
- Jeton du nom d'étage : `{E}`. Étage de la fenêtre : « Étage type », zone « Modèle ». Lundi fictif : le 05/01/2026.
- Durée : entier de 0 à `MAX_DURATION_DAYS`, exporté par `services/syntheseTaskModel.js`.
- Textes de l'interface exactement tels que dans la spec, en particulier :
  - le bouton « Paramètre » ;
  - le titre du bouton « Modèle d'étage du projet : cycles, tâches, liens et durées d'un nouvel étage » ;
  - « Enregistrer » / « Annuler » / « Revenir au modèle d'origine » ;
  - « Abandonner les modifications du modèle ? » ;
  - « Le modèle doit garder au moins une tâche. » ;
  - « Créez la colonne Texte « Synthese_Parametre » dans Projets2 pour enregistrer un modèle. » ;
  - « Le modèle enregistré est illisible : modèle d'origine affiché. »
- Le bouton porte `data-service-context-navigation`. Son `title` ne contient ni `ajout`, ni `modif`, ni `enregistr`, ni `suppr`, ni `valid`.
- `?v=` de `main.js` et `styles.css` : `20261116-param1`, à remplacer dans les quatre tests qui épinglent `20261116-zoom1`.

## Review Focus

1. **Lien vers un code défini plus loin dans la liste** (un élément suit une tâche placée après lui) : la création et la fenêtre doivent le résoudre. Test dans la Tâche 1.
2. **Modèle sans SIGNATURE ni DEMARRAGE**, parce que l'utilisateur les a supprimées : la création doit fonctionner sans fin d'étage fixe, et la fenêtre afficher l'avertissement « Demarrage ». Tests dans les Tâches 2 et 6.
3. **JSON retouché à la main**, avec un code en double ou un `parent` qui désigne une tâche et non un cycle : l'élément doublon est ignoré et le parent ramené à l'étage. Le reste du modèle doit tenir. Test dans la Tâche 2.
4. **« Enregistrer » cliqué juste après une saisie**, alors que la file du contrôleur n'est pas vide : le JSON doit contenir la saisie. Test dans la Tâche 6.
5. **Projet changé dans un autre widget pendant que la fenêtre est ouverte avec des modifications** : fermeture sans écriture ni confirmation. Test dans la Tâche 7.

---

### Task 1: Le modèle d'étage devient une donnée

**Files :**
- Modify : `assets/js/services/syntheseFloorTemplate.js`
- Test : `tests/syntheseFloorTemplate.test.mjs` (les tests actuels restent verts), `tests/syntheseFloorTemplateCustom.test.mjs` (nouveau)

**Interfaces :**
- Produces :
  - `buildFloorFromTemplate({ floorName, zoneName, projectName, template = FLOOR_TEMPLATE, replaceToken = true, withFormworkCheck = false }) → rows[]` : la ligne-étage puis une ligne par élément.
  - `buildTemplateLinks(ids, template = FLOOR_TEMPLATE) → { action, fieldsById }`. `ids` contient `template.length + 1` ids, sinon une erreur est levée.
  - Un élément `item` a la forme `{ code, name, nature?, parent?, link?, days?, id2?, indice?, control? }`.

- [ ] **Step 1 : écrire les tests qui échouent** (`tests/syntheseFloorTemplateCustom.test.mjs`)
  - `"modèle personnalisé : ligne-étage puis éléments, Duree_1 = days, {E} remplacé"`. Modèle de 4 éléments : `C1` cycle, `T1` (parent `C1`, `days: 3`, nom « PLAN {E} »), `T2` (parent `C1`, `link: "T1 FD+2"`, `days: 0`), `C2` (parent `C1`).
    - `rows.length === 5`.
    - `rows[2].Duree_1 === 3` et `rows[2].Taches === "PLAN R+1"`.
    - `rows[4].Nature === "Sous-groupe"`, car la Nature est réécrite selon la profondeur réelle, même si l'élément dit « Cycle ».
  - `"replaceToken: false garde {E}"` : `rows[2].Taches === "PLAN {E}"`.
  - `"N°, Indice et Contrôle : mêmes colonnes sur toutes les lignes"`. Avec `id2: "12"` sur `T1` et `control: true` sur `T2`, et `withFormworkCheck: true` :
    - chaque ligne a les clés `ID2`, `Indice` et `Controle_Coffrage` (valeurs "" et false par défaut) ;
    - `rows[2].ID2 === "12"` et `rows[3].Controle_Coffrage === true`.
    - Sans `withFormworkCheck`, aucune ligne n'a `Controle_Coffrage`.
    - Sans aucun `id2` ni `indice`, les clés `ID2` et `Indice` sont absentes. Les colonnes ne s'ajoutent que si le modèle s'en sert.
  - `"liens résolus d'après les ids, même vers un élément placé plus loin"` (Review Focus 1). `T1` a `link: "T2 FD"`. Avec `buildTemplateLinks([10, 11, 12, 13, 14], template)` :
    - `fieldsById.get(12).Lien === "13 FD"` ;
    - `fieldsById.get(12).Parent === "11"`.
  - `"buildTemplateLinks : nombre d'ids contrôlé d'après le modèle"` : `assert.throws` avec 4 ids pour 4 éléments.

- [ ] **Step 2 : lancer les tests.** `node --test tests/syntheseFloorTemplateCustom.test.mjs` → FAIL (options ignorées, longueur figée à 26).

- [ ] **Step 3 : implémenter dans `syntheseFloorTemplate.js`.**
  - La profondeur se calcule en remontant les `parent` du modèle. Profondeur 1 → `NATURES.cycle`, au-delà → `NATURES.subgroup`. Une tâche garde la `nature` de l'élément.
  - `Duree_1` vaut `days` (entier, sinon 0) pour une tâche, et 0 pour un cycle.
  - Les colonnes facultatives sont présentes sur toutes les lignes ou sur aucune, pour que `buildBulkAddAction` ne produise pas de `null`.
  - `FLOOR_TEMPLATE` est inchangé.

- [ ] **Step 4 : lancer toute la suite.** Elle doit être verte (`syntheseFloorTemplate.test.mjs` inclus).

- [ ] **Step 5 : vérifier `git status`.** Seuls les deux fichiers doivent être modifiés.

---

### Task 2: Paramètre du projet — lecture, écriture, sérialisation, lignes en mémoire, avertissements

**Files :**
- Create : `assets/js/services/syntheseFloorParameter.js`
- Modify :
  - `assets/js/services/syntheseLayout.js` (exporter `projectRows`) ;
  - `assets/js/config.js` (`syntheseParametre: "Synthese_Parametre"`) ;
  - `assets/js/services/gristService.js`, dans `buildProjectAvancementConfigsFromRows` : `parametreRaw: row?.[columns.syntheseParametre]`.
- Test : `tests/syntheseFloorParameter.test.mjs`

**Interfaces :**
- Consumes :
  - `buildFloorFromTemplate` et `buildTemplateLinks` (Task 1) ;
  - `buildSections`, `buildRowModel`, `readTask`, `isTaskRow`, `dateFieldsOf`, `MAX_DURATION_DAYS`, `TASK_COLUMNS` (`syntheseTaskModel.js`) ;
  - `cascadeFrom` (`syntheseLinks.js`) ;
  - `findFloorStart` et `readControlTasks` (`structureLinkModel.js`) ;
  - `projectRows` (`syntheseLayout.js`).
- Produces :
  - Constantes : `MODEL_ANCHOR_DATE = "2026-01-05"`, `MODEL_FLOOR_NAME = "Étage type"`, `MODEL_ZONE_NAME = "Modèle"`, `MODEL_PROJECT_NAME = "Modèle d'étage"`.
  - `parseFloorTemplate(text) → items[] | null`.
  - `serializeFloorTemplate(items) → string`.
  - `templateToRows(items, { firstId = 1 } = {}) → rows[]` : lignes en mémoire datées, noms gardant `{E}`.
  - `templateItemsFromRows(rows) → items[]`.
  - `templateWarnings(rows) → string[]`.
  - `readProjectParameter(configs, project) → { column: boolean, items: items[] | null, invalid: boolean }`.
  - `floorTemplateFor(configs, project) → { template: items[], invalid: boolean }`.
  - `buildParametreActions(configs, project, text, { table, column }) → actions[]`.
  - `withParametre(configs, project, text) → configs[]`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `"lecture : JSON valide → éléments ; vide, illisible, version inconnue ou sans tâche → null"`. Cas :
    - `""`, `"{"`, `{"version":2,"items":[…]}` et `{"version":1,"items":[{"code":"C1","name":"CYCLE","nature":"Cycle"}]}` → `null` ;
    - un modèle d'une tâche → 1 élément.
  - `"lecture tolérante : doublon ignoré, parent non-cycle ramené à l'étage, lien inconnu vidé, days hors bornes = 0"` (Review Focus 3). Un `T1` en double (le second est ignoré), `T2` avec `parent: "T1"` (→ `""`), `T3` avec `link: "X9 FD"` (→ `""`), `days: -2` et `days: 1e9` (→ 0).
  - `"aller-retour du modèle d'origine : structure identique, codes traduits"`. Avec `templateItemsFromRows(templateToRows(FLOOR_TEMPLATE))`, on compare pour chaque élément, dans l'ordre :
    - `name` ;
    - `nature` (pour une tâche) ;
    - le nom du parent ;
    - le nom de la tâche liée, avec le type et le décalage du lien ;
    - `days === 0`.
  - `"lignes en mémoire datées depuis le lundi fictif"`.
    - Avec `FLOOR_TEMPLATE` et des `days` posés : RECEPTION (racine) commence le `2026-01-05`. Chaque tâche liée prend les dates de la cascade et `Duree_1 === days`. Les noms gardent « {E} ». `Groupe === "Étage type"`.
    - Toutes les lignes ont `Service: "Synthese"`, `Ordre: ""`, `Controle_Coffrage: false` et `Zone: "Modèle"`.
  - `"modèle modifié relu à l'identique"` : on ajoute à des lignes en mémoire un cycle et une tâche de 3 jours liée à la REUNION du cycle 3. `parseFloorTemplate(serializeFloorTemplate(items))` doit être profondément égal à `items`.
  - `"avertissements : sans FOND DE PLAN, sans tâche contrôlée, sans Demarrage"`. Les trois messages de la spec §3.2, un par manque. Aucun avertissement sur `templateToRows(FLOOR_TEMPLATE)` (Review Focus 2).
  - `"Projets2 : colonne absente, vide, illisible, lue"` : avec des `configs` comme celles de `syntheseLayout.test.mjs`, où `parametreRaw` vaut `undefined`, `""`, `"{"` ou un JSON valide.
    - `readProjectParameter` → `{ column: false, items: null, invalid: false }`, puis `{ true, null, false }`, `{ true, null, true }`, `{ true, [..], false }`.
    - `floorTemplateFor` rend `FLOOR_TEMPLATE` dans les trois premiers cas.
  - `"Projets2 : une action sur toutes les lignes du projet"` : `UpdateRecord` pour une ligne, `BulkUpdateRecord` pour deux. `withParametre` met à jour `parametreRaw` sur ces lignes seulement.

- [ ] **Step 2 : lancer.** → FAIL (module absent).

- [ ] **Step 3 : implémenter.**
  - **`templateToRows`** construit les lignes avec `buildFloorFromTemplate({ ..., replaceToken: false, withFormworkCheck: true })` et `buildTemplateLinks`. Ids à partir de `firstId`. On ajoute ensuite les colonnes de la spec §6 (`Service`, `Type_doc`, `Ordre`, `Diff_coffrage`/`Diff_armature` null, `Controle_Coffrage`).
  - Puis on date les lignes. Chaque tâche sans lien reçoit `MODEL_ANCHOR_DATE` comme Début, avec sa durée (jalon si 0). On applique ensuite `cascadeFrom` sur les `readTask`, et `dateFieldsOf` donne les champs.
  - **`templateItemsFromRows`** suit l'ordre de `buildRowModel(buildSections({ rows }))` tout déplié. On ne garde que les lignes de l'étage, tâches et cycles. Les codes sont régénérés (`T1…` pour les tâches, `C1…` pour les cycles et sous-groupes), et Parent / Lien sont traduits d'id en code. `days` vient de `durationDays`, `control` de `Controle_Coffrage`, `id2` et `indice` des colonnes.

- [ ] **Step 4 : lancer toute la suite.** → verte.

- [ ] **Step 5 : vérifier `git status`.**

---

### Task 3: Le contrôleur crée les étages d'après le modèle du projet ; renommage d'un étage par défaut

**Files :**
- Modify :
  - `assets/js/ui/syntheseTasksController.js` (option `getFloorTemplate`, utilisée par `addFloorFromTemplate`) ;
  - `assets/js/services/syntheseTaskModel.js` (`buildFloorRenameActions`).
- Test : `tests/syntheseFloorParameterController.test.mjs` (nouveau ; harnais `setup` copié de `tests/syntheseCyclesController.test.mjs`), `tests/syntheseTaskModel.test.mjs` ou un nouveau fichier pour le renommage.

**Interfaces :**
- Consumes : Task 1 (`template`, `withFormworkCheck`), Task 2 (format `{ template, invalid }`).
- Produces :
  - Option `getFloorTemplate = () => ({ template: FLOOR_TEMPLATE, invalid: false })` de `createSyntheseTasksController`.
  - `isDefaultFloorName(name) → boolean` (exporté de `syntheseTaskModel.js`) : `NEW_FLOOR_NAME`, ou `NEW_FLOOR_NAME` suivi d'un espace et d'un entier ≥ 2.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `"Ajouter un étage : les lignes et les durées du modèle du projet"`. `getFloorTemplate` rend un modèle de 3 éléments, et `applyUserActions` rend des ids.
    - La première écriture est un `BulkAddRecord` de 4 lignes, avec `Duree_1` des tâches = `days`.
    - La seconde porte Parent et Lien traduits.
  - `"Controle_Coffrage écrit seulement si la colonne existe"`. Lignes avec ou sans la colonne `Controle_Coffrage` (`withoutColumns`), et un élément `control: true` : la colonne n'apparaît dans le `BulkAddRecord` que dans le premier cas.
  - `"modèle illisible : étage créé avec le modèle d'origine, message"`. Avec `invalid: true` et `template: FLOOR_TEMPLATE` : 26 lignes, puis le message d'information « Modèle d'étage du projet illisible : étage créé avec le modèle d'origine. »
  - Les trois chemins de création appellent `getFloorTemplate` : `onAddFloor` ; la fenêtre « Ajouter un étage… » (`onAddStorey`, puis le `onSubmit` de la fausse fenêtre injectée par `createFloorDialog`) ; `onAddZoneToFloor`. Un test par chemin vérifie le nombre de lignes du `BulkAddRecord`.
  - `"renommer « Nouvel étage » : le nom suit partout dans ses tâches et cycles"`. Une tâche « PLAN Nouvel étage RDC » et un cycle « CYCLE Nouvel étage » deviennent « PLAN R+1 RDC » et « CYCLE R+1 ». Un étage « R+1 » renommé « R+2 » ne change que « NIV R+1 » et « GO R+1 », comme aujourd'hui.

- [ ] **Step 2 : lancer.** → FAIL.

- [ ] **Step 3 : implémenter.**
  - `addFloorFromTemplate` lit `getFloorTemplate()` une fois par opération. Il passe `template` et `withFormworkCheck: formworkCheckColumn === true` à `buildFloorFromTemplate` (pour chaque section), puis `template` à `buildTemplateLinks`. Après un succès avec `invalid`, il appelle `info(...)` avec le message ci-dessus.
  - Dans `buildFloorRenameActions`, si `isDefaultFloorName(floor.name)`, on remplace chaque occurrence exacte de l'ancien nom (`split` / `join`) dans les noms des tâches et des groupes de l'étage. Les noms de groupes sont écrits par une `BulkUpdateRecord` en plus.

- [ ] **Step 4 : lancer toute la suite.** → verte.

- [ ] **Step 5 : vérifier `git status`.**

---

### Task 4: Faux `docApi` en mémoire

**Files :**
- Create : `assets/js/services/memoryDocApi.js`
- Test : `tests/memoryDocApi.test.mjs`

**Interfaces :**
- Produces : `createMemoryDocApi({ rows = [], table = "Planning_Projet", defaults = {}, onChange = () => {} } = {}) → { applyUserActions(actions) → Promise<{ retValues }>, getRows() → rows[] }`.
  - `getRows()` rend des copies.
  - `defaults` est appliqué à chaque ligne ajoutée, sans écraser un champ fourni.
  - `onChange()` est appelé après chaque lot accepté.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `"AddRecord / BulkAddRecord : ids croissants après le plus grand id, jamais réutilisés"`. Partir de lignes 1 à 3. `AddRecord` donne 4 ; supprimer 4, puis `BulkAddRecord` de 2 lignes donne `[5, 6]`.
  - `"Update / BulkUpdate / Remove / BulkRemove"` : valeurs vérifiées par `getRows()`.
  - `"defaults posés sur les lignes ajoutées"` : `Service: "Synthese"`, `NomProjet` ; un champ fourni l'emporte.
  - `"lot refusé en entier"` : table inconnue, id inconnu ou action inconnue → rejet. `getRows()` est inchangé et `onChange` n'est pas appelé.
  - `"retValues comme Grist"` : `[id]` pour `AddRecord`, `[[ids]]` pour `BulkAddRecord`, `null` pour une mise à jour, dans l'ordre des actions.

- [ ] **Step 2 : lancer.** → FAIL.

- [ ] **Step 3 : implémenter.** On applique le lot sur une copie, puis on remplace l'état si tout passe.

- [ ] **Step 4 : lancer toute la suite.** → verte.

- [ ] **Step 5 : vérifier `git status`.**

---

### Task 5: Options du tableau — colonnes masquées, sans panneau droit, mode modèle

**Files :**
- Modify : `assets/js/ui/syntheseTaskTable.js`, `assets/css/styles.css` (classe racine `.stt--no-right`)
- Test : `tests/syntheseTaskTableOptions.test.mjs` (nouveau ; faux DOM copié de `tests/syntheseStoreyTable.test.mjs`)

**Interfaces :**
- Produces : `createSyntheseTaskTable(host, callbacks, { createGantt, hiddenFields = [], rightPane = true, templateMode = false, storageKeys = null } = {})`.
  - `storageKeys` vaut `{ leftWidth, columnWidths }` ou `null` pour les clés actuelles.
  - `buildMenuItems(line, { ..., templateMode = false })`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `"hiddenFields: start et end : ni en-tête ni cellule, Tab saute ces champs"`. Rendre une tâche avec `editable: true` : il n'y a ni `.stt-cell--start` ni `.stt-cell--end`. Une saisie de Durée validée par Tab ouvre la saisie suivante sur un champ qui n'est pas Début.
  - `"rightPane: false : ni .stt-right, ni séparateur"`. Aucun élément `.stt-right` ni `.stt-splitter`, et la racine a la classe `stt--no-right`.
  - `"templateMode : menus réduits"`.
    - `buildMenuItems(floorLine, { templateMode: true })` → seulement les actions `addTask` et `addCycle`.
    - Une ligne de zone → `[]`.
    - Les menus de tâche et de cycle sont identiques au mode normal.
  - `"templateMode : ligne de zone masquée, nom de l'étage non modifiable"`. Aucune ligne `data-kind="zone"` n'est rendue. Un clic sur le nom de l'étage n'ouvre aucune saisie.
  - `"sans options : rendu inchangé"` : le test existant de `syntheseStoreyTable.test.mjs` reste vert.
  - `"storageKeys : largeurs lues et écrites sous les clés fournies"` : `localStorage` simulé.

- [ ] **Step 2 : lancer.** → FAIL.

- [ ] **Step 3 : implémenter.**
  - `COLUMNS` est filtré une fois par instance (`columns`) ; l'en-tête, `buildLine` et la navigation Tab l'utilisent.
  - Sans panneau droit : pas de `headRight`, pas de `.stt-right` par ligne, pas de `splitter`, et `clampWidth` sans `MIN_RIGHT_WIDTH`. En CSS, `.stt--no-right .stt-left` prend toute la largeur.
  - En mode modèle, le rendu ignore les lignes `kind === "zone"`.

- [ ] **Step 4 : lancer toute la suite.** → verte.

- [ ] **Step 5 : vérifier `git status`.**

---

### Task 6: La fenêtre « Paramètre »

**Files :**
- Create : `assets/js/ui/syntheseParameterDialog.js`
- Modify : `assets/css/styles.css` (styles de la fenêtre, dans la charte de `synthese-link-dialog`)
- Test : `tests/syntheseParameterDialog.test.mjs` (faux DOM copié de `tests/syntheseStoreyTable.test.mjs`, avec `<dialog>` simulé : `showModal`, `close`, `open`)

**Interfaces :**
- Consumes : Tasks 2, 4 et 5 ; `createSyntheseTasksController` ; `createSyntheseTaskTable`.
- Produces : `createParameterDialog({ doc = document, confirm = (m) => window.confirm(m), onSave, createController = createSyntheseTasksController, createTable = createSyntheseTaskTable } = {}) → { open(model), close(), setCanEdit(canEdit), isOpen(), openedProject() }`.
  - `model` = `{ projectName, items: items[], invalid: boolean, canEdit: boolean, columnMissing: boolean }`.
  - `onSave(text) → Promise` : la fenêtre se ferme quand elle est résolue, et affiche l'erreur si elle est rejetée.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `"ouvrir : le modèle comme un étage, sans Début ni Fin ni zone"`. Après `open` avec `FLOOR_TEMPLATE` : la ligne de l'étage « Étage type », la REUNION du cycle 3, SIGNATURE et DEMARRAGE en dernier. Aucune cellule `.stt-cell--start`, et le titre contient le nom du projet.
  - `"scénario : ajouter un cycle, une tâche de 3 jours, enregistrer"`.
    - `onAddCycle` de l'étage, puis `onAddTask` dans le cycle créé, puis `onEdit(id, "duration", "3")`.
    - Cliquer « Enregistrer » sans attendre (Review Focus 4).
    - `onSave` reçoit un JSON où le cycle arrive avant SIGNATURE et la tâche a `days: 3` et `link` vers la REUNION.
    - Avant le clic, aucun `onSave`. Le contrôleur n'a écrit que dans le faux `docApi`.
  - `"Annuler avec modifications : confirmation, rien d'enregistré ; sans modification : pas de question"`.
  - `"Revenir au modèle d'origine : contenu remplacé, rien d'enregistré tant qu'on n'enregistre pas"`.
  - `"lecture seule (canEdit false) ou colonne absente : pas de saisie, Enregistrer grisé, message de la spec"`. Le message pour la colonne absente est celui de la spec. Avec `canEdit: false`, `onEdit` ne change rien.
  - `"modèle sans tâche : refus d'enregistrer, message"`.
  - `"modèle illisible : message affiché à l'ouverture"`.
  - `"avertissements affichés et mis à jour après un geste"` : supprimer DEMARRAGE fait apparaître l'avertissement Demarrage (Review Focus 2).
  - `"échec de onSave : la fenêtre reste ouverte avec l'erreur"`.

  - Les tests peuvent injecter un `createTable` espion, qui garde les callbacks et rend un tableau factice, comme le harnais `setup` des tests de contrôleur. Un test au moins garde le vrai tableau dans le faux DOM.

- [ ] **Step 2 : lancer.** → FAIL.

- [ ] **Step 3 : implémenter.**
  - **À `open`** :
    - on crée les lignes avec `templateToRows(items)` ;
    - on crée `createMemoryDocApi({ rows, defaults: { Service: "Synthese", NomProjet: MODEL_PROJECT_NAME }, onChange })` ;
    - on monte un faux contexte : `getState()` rend `{ currentProject: { name: MODEL_PROJECT_NAME, names: [MODEL_PROJECT_NAME] }, selectedService: "Synthese", accessMode: canEdit ? "editable" : "readonly" }`, `fetchContextRows` rend `memory.getRows()`, et `subscribe` / `watchProjectZones` / `fetchProjectRows` ne font rien (`fetchProjectRows` rend `[]`) ;
    - on crée le contrôleur avec `createTable: (callbacks) => createTable(host, callbacks, { hiddenFields: ["start", "end"], rightPane: false, templateMode: true, storageKeys: { leftWidth: "planning-projet.synthese-parametre.left-width", columnWidths: "planning-projet.synthese-parametre.column-widths" } })`, `loadFormworkStarts: null` et `saveLayout: null` ;
    - puis `setEditingEnabled(canEdit)` et `setActive(true)`.
  - **`onChange`** : `dirty = true`, `controller.refresh()`, avertissements recalculés par `templateWarnings(memory.getRows())`.
  - **« Enregistrer »** attend que la file du contrôleur soit vide, puis sérialise `templateItemsFromRows(memory.getRows())`. Si la file n'est pas exposée, ajouter au contrôleur `whenIdle() → Promise` (la promesse de la file d'écriture) avec son test.
  - **À `close`** : `controller.setActive(false)` et l'instance est oubliée.

- [ ] **Step 4 : lancer toute la suite.** → verte.

- [ ] **Step 5 : vérifier `git status`.**

---

### Task 7: Bouton, câblage dans main.js, CSS du bouton, version

**Files :**
- Modify : `index.html`, `assets/js/main.js`, `assets/css/styles.css`, et les quatre tests qui épinglent `?v=` (`structureLinkWiring`, `syntheseGanttWiring`, `syntheseTasksWiring` ; `globalWiring` n'épingle que le contexte, à vérifier).
- Test : `tests/syntheseParameterWiring.test.mjs` (lecture du source, comme `tests/planningExportWiring.test.mjs`)

**Interfaces :**
- Consumes :
  - `createParameterDialog` (Task 6) ;
  - `readProjectParameter`, `floorTemplateFor`, `buildParametreActions`, `withParametre` (Task 2) ;
  - `getFloorTemplate` (Task 3).

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `"bouton Paramètre juste après Par étage"`, dans `index.html` : `id="syntheseParametreToggle"`, `type="button"`, texte « Paramètre », `data-service-context-navigation`, et le titre de la spec. Il apparaît juste après la balise fermante de `#syntheseLayoutToggle`.
  - `"bouton visible seulement en Synthese"`, dans le CSS : il est masqué par `body:not(.is-synthese-space)`, `body.is-global-space` et `body.planning-sync-embedded`.
  - `"main.js : le modèle du projet est passé au contrôleur principal"` : `getFloorTemplate: () => floorTemplateFor(cachedProjectAvancementConfigs,` dans `getSyntheseTasks`.
  - `"main.js : ouverture après relecture hors cache, droits, enregistrement dans Projets2"`. Dans `bindSyntheseParameterDialog`, on attend :
    - `refreshProjectRegistryFromGrist({ notify: false, clearInvalid: false, forceRefresh: true })` attendu avant `open` ;
    - `canEdit` = `isPlanningEditingUnlocked()`, plus `accessMode === "editable"`, plus la colonne présente ;
    - l'`onSave` appelle `buildParametreActions(...)`, puis `window.grist.docApi.applyUserActions`, puis `withParametre`.
  - `"main.js : la fenêtre se ferme au changement de projet ou de service, suit Editer"` (Review Focus 5) :
    - un `serviceContext.subscribe` ferme la fenêtre si le service n'est plus Synthese ou si le projet ouvert diffère ;
    - `setPlanningEditingEnabled` appelle `parameterDialog?.setCanEdit(...)`.
  - `"versions servies"` : `main.js?v=20261116-param1` et `styles.css?v=20261116-param1`.

- [ ] **Step 2 : lancer.** → FAIL.

- [ ] **Step 3 : implémenter.** Suivre les modèles existants : `bindStructureLinkDialog` pour la fenêtre et la fermeture, et `saveSyntheseLayout` pour l'écriture Projets2 et la relecture. Le CSS du bouton reprend celui de `.planning-structure-link-toggle`.

- [ ] **Step 4 : lancer toute la suite.** → verte. Faire ensuite un rendu Chrome headless du bandeau et de la fenêtre (mémoire `headless-chrome-preview`) : le bouton est à droite de « Par étage », et la fenêtre a ses colonnes, sans Début, Fin ni Gantt.

- [ ] **Step 5 : vérifier `git status`.**
