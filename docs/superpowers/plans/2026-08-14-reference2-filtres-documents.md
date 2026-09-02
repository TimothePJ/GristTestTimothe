# Reference2 — filtres Type + Zone + recherche numéro/nom — Plan d'implémentation

> **Pour les agents :** exécution inline dans la session courante (voir `superpowers:executing-plans`). Étapes cochables `- [ ]`.

**Goal :** doter les sections « Documents concernés » (dialogue Ajouter) et « Autres documents » (dialogue Modifier) de `Reference2` d'une barre de filtres identique — recherche sur numéro + nom, menu Type, menu Zone — dont les trois contrôles se composent.

**Architecture :** un module pur `document-filter-utils.js` (patron UMD de `edit-group-utils.js`) porte toute la logique de correspondance et de calcul de facettes, testé sous `node --test`. `legacy.js` conserve le DOM et fait converger les deux dialogues sur une unique fonction de filtrage et un unique générateur de barre d'outils.

**Tech Stack :** JavaScript navigateur sans build ni dépendance ; tests `node:test` + `node:assert/strict` en CommonJS.

## Global Constraints

- **Aucun `git commit`, aucun `git push`.** L'utilisateur gère Git lui-même. Les étapes « Vérifier » remplacent les étapes « Commit ».
- Aucune dépendance nouvelle, aucun outil de build : `legacy.js` reste un script navigateur chargé en `defer`.
- Le nouveau module suit exactement le patron UMD de `Reference2/js/edit-group-utils.js` (IIFE, `module.exports` + `globalThis.<Nom>`), sinon les tests CommonJS ne peuvent pas le charger.
- Les identifiants DOM existants encore référencés ailleurs sont conservés : `duplicateOptionsContainer`, `duplicateSelectionSummary`, `duplicateSelectionCount`, `selectVisibleDocuments`, `clearSelectedDocuments`, `duplicateSearchEmpty`, `editOtherDocumentsContainer`, `editOtherDocumentsSummary`, `editOtherDocumentsSelectionCount`, `selectVisibleEditOtherDocuments`, `clearSelectedEditOtherDocuments`, `editOtherDocumentsSearch`, `editOtherDocumentsSearchEmpty`.
- Le CSS ne cible que des classes pour la barre d'outils : les nouveaux `id` de `<select>` n'exigent aucune règle nouvelle, seule la grille `.duplicate-toolbar` change de gabarit.
- Commande de test unique du widget : `node --test Reference2/tests/`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `Reference2/js/document-filter-utils.js` **(créé)** | Normalisation de recherche, correspondance multi-mots, calcul des facettes Type/Zone. Pur, sans DOM. |
| `Reference2/tests/document-filter-utils.test.cjs` **(créé)** | Tests du module, fixture issue du projet réel de l'utilisateur. |
| `Reference2/index.html` **(modifié)** | Charge le nouveau script avant `legacy.js`. |
| `Reference2/js/legacy.js` **(modifié)** | Barre d'outils partagée, filtrage DOM unifié, câblage des deux dialogues, ouverture de `collectProjectDocumentEntries` sur la zone. |
| `Reference2/css/style.css` **(modifié)** | Grille de `.duplicate-toolbar` à trois colonnes, y compris dans le dialogue Modifier et en écran étroit. |

---

### Task 1 : module pur de filtrage

**Files:**
- Create: `Reference2/js/document-filter-utils.js`
- Test: `Reference2/tests/document-filter-utils.test.cjs`

**Interfaces:**
- Consumes: rien.
- Produces: `globalThis.ReferenceDocumentFilterUtils` / `module.exports` exposant
  - `ALL_VALUE: '__ALL__'`, `NO_TYPE_VALUE: '__sans_type__'`, `NO_ZONE_VALUE: '__sans_zone__'`
  - `normalizeSearchText(value) -> string`
  - `buildDocumentSearchKey({ numero, name }) -> string`
  - `matchesDocumentSearch(searchKey, query) -> boolean`
  - `computeDocumentFacets(entries, { query, type, zone, typeAllLabel, zoneAllLabel }) -> { visibleKeys: Set, visibleCount: number, typeOptions: Array<{value,label,count}>, zoneOptions: Array<{value,label,count}> }`
  - forme d'une `entry` : `{ key, searchKey, typeKey, typeLabel, zoneKey, zoneLabel }`

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `Reference2/tests/document-filter-utils.test.cjs` avec la fixture du projet réel
(`PH N-D` / `PH N-U` × `Coffrage` / `Coupes` / `Démolition` × `Bloc 1..4`, `Bloc 1-2`, `Bloc 3-4`)
et les cas listés au §6 de la spec.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

Run : `node --test Reference2/tests/document-filter-utils.test.cjs`
Attendu : `Cannot find module '../js/document-filter-utils.js'`.

- [ ] **Étape 3 : écrire le module**

Normalisation : NFD + suppression des diacritiques + compression des espaces + `toLocaleLowerCase('fr')`.
Correspondance : la requête normalisée est découpée sur les espaces, chaque jeton doit être une
sous-chaîne de la clé ; requête vide → vrai.
Facettes : `typeOptions` calculé sur les entrées passant `query` + `zone` ; `zoneOptions` sur celles
passant `query` + `type` ; option « tous » en tête portant le total de son ensemble de calcul ;
une valeur sélectionnée absente est réinjectée avec `count: 0` et son libellé retrouvé dans
l'ensemble complet.

- [ ] **Étape 4 : relancer les tests**

Run : `node --test Reference2/tests/`
Attendu : tous les tests du widget passent (les 24 existants + les nouveaux).

- [ ] **Étape 5 : vérifier** — ne rien commiter.

---

### Task 2 : chargement du module et barre d'outils partagée

**Files:**
- Modify: `Reference2/index.html:557`
- Modify: `Reference2/js/legacy.js` (nouvelles fonctions, près des constantes zone L1156-1158)

**Interfaces:**
- Consumes: `ReferenceDocumentFilterUtils` (Task 1).
- Produces, dans `legacy.js` :
  - `REFERENCE_DOC_FILTER_ALL_VALUE`, `REFERENCE_DOC_FILTER_NO_TYPE`, `REFERENCE_DOC_FILTER_NO_ZONE`
  - `getReferenceDocumentFilterUtils() -> utils` (lève si le script n'est pas chargé)
  - `buildReferenceDocumentItemAttributes({ numero, name, type, zone }) -> string` — produit
    `data-doc-search="…" data-doc-type="…" data-doc-type-label="…" data-doc-zone="…" data-doc-zone-label="…"` déjà échappés
  - `buildReferenceDocumentFilterToolbarMarkup(prefix, { showZoneFilter }) -> string`
  - `collectReferenceDocumentFilterEntries(container) -> Array<entry & { element }>`
  - `renderReferenceDocumentFilterOptions(select, options, selectedValue)`
  - `applyReferenceDocumentListFilters(prefix, containerId, { onAfterFilter, preferredType, preferredZone })`
  - `bindReferenceDocumentFilterControls(prefix, containerId, { onAfterFilter })`

- [ ] **Étape 1 : ajouter le `<script>`**

Dans `Reference2/index.html`, avant `./js/legacy.js` :
`<script src="./js/document-filter-utils.js" defer></script>`

- [ ] **Étape 2 : écrire les helpers dans `legacy.js`**

Le `<select>` Zone n'est rendu que si `showZoneFilter` est vrai.
Le placeholder de la recherche devient `Numéro ou nom…`.
`applyReferenceDocumentListFilters` masque les items, puis les `.duplicate-zone-group`, puis les
`.duplicate-document-group` devenus vides, reconstruit les deux menus avec compteurs, bascule
`#<prefix>SearchEmpty`, puis appelle `onAfterFilter`.
`preferredType` / `preferredZone`, quand fournis, priment sur la valeur courante du `<select>` —
c'est le mécanisme de pré-remplissage du dialogue Ajouter.

- [ ] **Étape 3 : vérifier la non-régression**

Run : `node --test Reference2/tests/`
Attendu : PASS (aucun test ne touche encore ces fonctions ; on vérifie qu'aucune erreur de syntaxe
ne casse l'extraction de source de `legacy-source.cjs`).

- [ ] **Étape 4 : vérifier** — ne rien commiter.

---

### Task 3 : dialogue « Modifier » — Type + Zone + recherche restreinte

**Files:**
- Modify: `Reference2/js/legacy.js:769-789` (`filterReferenceEditMatchList` → supprimée)
- Modify: `Reference2/js/legacy.js:791-855` (`buildReferenceEditMatchListMarkup`)
- Modify: `Reference2/js/legacy.js:857-918` (`renderReferenceEditMatchingRows`)

**Interfaces:**
- Consumes: les helpers de la Task 2, préfixe `editOtherDocuments`.
- Produces: rien de nouveau pour les tâches suivantes.

- [ ] **Étape 1 : attributs de données sur l'item**

Dans `buildReferenceEditMatchListMarkup`, remplacer
`data-edit-match-search="${escapeHtml(searchText)}"` (qui joignait numéro + nom + type + zone)
par l'appel à `buildReferenceDocumentItemAttributes({ numero: record.NumeroDocument, name: record.NomDocument, type: record.Type_document, zone: record.Zone })`.
Supprimer la variable `searchText`.

- [ ] **Étape 2 : barre d'outils à trois contrôles**

Dans `renderReferenceEditMatchingRows`, remplacer le bloc `.duplicate-toolbar` (une seule
recherche) par `buildReferenceDocumentFilterToolbarMarkup('editOtherDocuments', { showZoneFilter })`
où `showZoneFilter = referenceEditMatchingRecords.some((record) => normalizeZoneValue(record.Zone))`.

- [ ] **Étape 3 : câbler les trois contrôles**

Remplacer l'écouteur `input` sur `#editOtherDocumentsSearch` par
`bindReferenceDocumentFilterControls('editOtherDocuments', 'editOtherDocumentsContainer', { onAfterFilter: updateReferenceEditGroupSelectionUi })`,
et appeler une première fois `applyReferenceDocumentListFilters(...)` juste après l'injection du HTML.
Supprimer `filterReferenceEditMatchList`.

- [ ] **Étape 4 : vérifier**

Run : `node --test Reference2/tests/`
Attendu : PASS.
Vérifier par recherche qu'aucune référence à `filterReferenceEditMatchList` ni à
`data-edit-match-search` ne subsiste.

- [ ] **Étape 5 : vérifier** — ne rien commiter.

---

### Task 4 : dialogue « Ajouter » — Zone, recherche restreinte, filtres composés

**Files:**
- Modify: `Reference2/js/legacy.js:2206-2280` (`collectProjectDocumentEntries` — 3ᵉ paramètre)
- Modify: `Reference2/js/legacy.js:5831-5841` (`buildDuplicateDocumentCheckboxMarkup`)
- Modify: `Reference2/js/legacy.js:5899-5920` (`filterDuplicateDocumentList` → supprimée)
- Modify: `Reference2/js/legacy.js:5992-6108` (`renderDocumentCheckboxList`)
- Modify: `Reference2/js/legacy.js:6110-6122` (appel du `change` sur `duplicateCheckbox`)

**Interfaces:**
- Consumes: les helpers de la Task 2, préfixe `duplicate`.
- Produces: `collectProjectDocumentEntries(projectName, typeValue, { zoneSelection })` — le 3ᵉ
  paramètre vaut `getCurrentSelectedZone()` par défaut, donc les appelants existants sont inchangés.

- [ ] **Étape 1 : ouvrir `collectProjectDocumentEntries` sur la zone**

Signature : `collectProjectDocumentEntries(projectName, typeValue = '', { zoneSelection = getCurrentSelectedZone() } = {})`.
Le corps utilise `zoneSelection` au lieu de `getCurrentSelectedZone()` à la ligne du filtre de zone.

- [ ] **Étape 2 : attributs de données sur l'item**

Dans `buildDuplicateDocumentCheckboxMarkup`, remplacer
`data-duplicate-search="${escapeHtml(searchText)}"` (qui joignait label + type + zone + numéro)
par `buildReferenceDocumentItemAttributes({ numero: option.numero, name: option.name, type: option.type, zone: option.zone })`.
Supprimer la variable `searchText`.

- [ ] **Étape 3 : liste sur tout le projet + barre à trois contrôles**

Dans `renderDocumentCheckboxList` :
- signature → `renderDocumentCheckboxList(checkedValues = null)` (le paramètre `typeFilterValue` disparaît) ;
- source → `collectProjectDocumentEntries(selectedProject, '', { zoneSelection: REFERENCE_ALL_ZONES_VALUE })` ;
- supprimer `typeFilterHTML`, `selectedTypeFilter`, `selectedTypeFilterKey`, l'appel à
  `collectReferenceDocumentTypesFromRecords` et l'écouteur `change` sur `duplicateTypeDocumentFilter` ;
- message vide → toujours `Aucun autre document disponible pour ce projet.` ;
- barre → `buildReferenceDocumentFilterToolbarMarkup('duplicate', { showZoneFilter })` avec
  `showZoneFilter = showZones || documentOptions.some((option) => normalizeZoneValue(option.zone))` ;
- calculer le pré-remplissage :
  `preferredType` = `getCurrentSelectedType()` non vide → `normalizeReferenceDocumentIdentityPart(...)`, sinon `REFERENCE_DOC_FILTER_ALL_VALUE` ;
  `preferredZone` = `isAllReferenceZonesSelection(getCurrentSelectedZone())` → `REFERENCE_DOC_FILTER_ALL_VALUE`,
  sinon `REFERENCE_NO_ZONE_VALUE` → `REFERENCE_DOC_FILTER_NO_ZONE`, sinon `normalizeZoneMatchKey(...)` ;
- câbler `bindReferenceDocumentFilterControls('duplicate', 'duplicateOptionsContainer', { onAfterFilter: refreshDuplicateSelectionUi })`
  puis un premier `applyReferenceDocumentListFilters` avec les valeurs pré-remplies.

- [ ] **Étape 4 : supprimer `filterDuplicateDocumentList`**

Plus aucun appelant après l'étape 3.

- [ ] **Étape 5 : mettre à jour l'appelant restant**

Ligne 6115 : `await renderDocumentCheckboxList();` reste valide (plus de premier paramètre).

- [ ] **Étape 6 : vérifier**

Run : `node --test Reference2/tests/`
Attendu : PASS.
Vérifier par recherche qu'aucune référence à `filterDuplicateDocumentList`,
`duplicateTypeDocumentFilter`, `duplicateDocumentSearch` ni `data-duplicate-search` ne subsiste.

- [ ] **Étape 7 : vérifier** — ne rien commiter.

---

### Task 5 : CSS de la barre à trois contrôles

**Files:**
- Modify: `Reference2/css/style.css:1606-1615` (`.duplicate-toolbar`)
- Modify: `Reference2/css/style.css:~1898` (règle en écran étroit)

**Interfaces:**
- Consumes: le markup de la Task 2.
- Produces: rien.

- [ ] **Étape 1 : trois colonnes**

`.duplicate-toolbar` passe à
`grid-template-columns: minmax(0, 1fr) minmax(140px, 200px) minmax(140px, 200px);`.
La surcharge `.reference-edit-other-documents .duplicate-toolbar` (aujourd'hui une seule colonne)
est supprimée pour hériter de la même grille.

- [ ] **Étape 2 : repli en écran étroit**

Dans la media query existante, `.duplicate-toolbar { grid-template-columns: 1fr; }` — les trois
contrôles s'empilent.

- [ ] **Étape 3 : neutraliser la marge basse des filtres dans la barre**

`.duplicate-toolbar .duplicate-filter-row { margin: 0; }` — la règle générale
`.duplicate-filter-row` porte `margin: 0 0 10px` héritée de son ancienne position hors barre.

- [ ] **Étape 4 : vérifier** — ne rien commiter.

---

### Task 6 : revue finale

- [ ] **Étape 1 : suite complète**

Run : `node --test Reference2/tests/`
Attendu : PASS, aucun test ignoré.

- [ ] **Étape 2 : revue de code**

Passer le diff au `code-review`, traiter les remarques de correction avant de rendre la main.

- [ ] **Étape 3 : rendre la main à l'utilisateur pour le test manuel et le commit.**
