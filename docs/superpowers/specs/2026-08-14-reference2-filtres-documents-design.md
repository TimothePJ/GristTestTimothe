# Spec — Reference2 : filtres Type + Zone + recherche numéro/nom dans « Ajouter » et « Modifier »

Date : 2026-08-14
Statut : design validé par l'utilisateur, prêt pour le plan.

## 1. Objectif

Les deux dialogues du menu contextuel de `Reference2` qui listent des documents à cocher
reçoivent la **même barre de filtres à trois contrôles** :

| Contrôle | Portée |
|---|---|
| `Rechercher un document` | `NumeroDocument` + `NomDocument` **uniquement** |
| `Type document` | `Type_document` |
| `Zone` | `Zone` |

Les trois se composent (ET logique). Taper `PH N-D` affiche les ~10 documents nommés
`PH N-D` tous types et zones confondus ; les deux menus permettent ensuite de resserrer
sur `Coupes` puis `Bloc 2`.

## 2. État de départ

| Dialogue | Section | Existant |
|---|---|---|
| `addRowDialog` (« Ajouter ») | « Documents concernés » — [`renderDocumentCheckboxList`](../../../Reference2/js/legacy.js) L5992 | recherche (matche label + type + zone + numéro) + menu `Type document` qui **re-rend toute la liste** |
| `editRowDialog` (« Modifier ») | « Autres documents » — [`renderReferenceEditMatchingRows`](../../../Reference2/js/legacy.js) L857 | recherche seule (matche numéro + nom + type + zone). Aucun menu. |

Les deux listes partagent déjà la même structure DOM et le même CSS
(`.duplicate-toolbar`, `.duplicate-document-group`, `.duplicate-zone-group`,
`.duplicate-document-item`) et deux fonctions de filtrage quasi jumelles
(`filterDuplicateDocumentList` L5899, `filterReferenceEditMatchList` L769).

## 3. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Périmètre | Les **deux** dialogues. « Modifier » gagne Type + Zone, « Ajouter » gagne Zone. |
| Recherche | **Tous les mots, ordre libre**, sur `"<numero> <nom>"` seulement. Insensible à la casse, aux accents et aux espaces multiples. |
| Contenu des menus | **Uniquement les valeurs présentes**, avec compteur. Chaque menu est calculé sur les entrées qui passent **les autres** filtres (facettes croisées) → aucune option ne peut produire une liste vide. |
| Menu Zone absent | Si aucune entrée du projet ne porte de zone, le menu Zone n'est pas rendu. |
| Menu Type | Passe du **re-rendu** au **masquage client**, comme la recherche. |
| Liste du dialogue « Ajouter » | Construite sur **tout le projet** (tous types, toutes zones), et non plus sur la zone de la barre du haut. Les menus Type et Zone du dialogue sont **pré-remplis** sur la sélection de la barre du haut. |
| Poussée Git | Aucune. Travail local uniquement. |

### 3.1 Justification du changement de source de la liste « Ajouter »

[`collectProjectDocumentEntries`](../../../Reference2/js/legacy.js) L2221 filtre déjà sur
`matchesReferenceZoneSelection(record.Zone, getCurrentSelectedZone())`. Un menu Zone interne
au dialogue serait donc inopérant tant que la barre du haut est sur une zone précise.
La liste du dialogue devient indépendante ; les menus pré-remplis conservent la vue par
défaut d'aujourd'hui tout en laissant l'utilisateur élargir.

## 4. Architecture

### 4.1 Nouveau module pur — `Reference2/js/document-filter-utils.js`

Même patron UMD que [`edit-group-utils.js`](../../../Reference2/js/edit-group-utils.js) :
IIFE exposant `window.ReferenceDocumentFilterUtils` et `module.exports`. **Aucun accès au DOM**,
donc testable sous `node --test`.

```
buildDocumentSearchKey({ numero, name })  -> "1101 ph n-d"
matchesDocumentSearch(searchKey, query)   -> boolean  (tous les mots, ordre libre)
computeDocumentFacets(entries, filters)   -> { visibleKeys, typeOptions, zoneOptions, visibleCount }
```

- `buildDocumentSearchKey` : `String(numero) + ' ' + String(name)`, passé en minuscules
  locale `fr`, décomposé NFD avec suppression des diacritiques, espaces compressés,
  bords rognés. `"4011"` + `"PH  N-U"` → `"4011 ph n-u"`.
- `matchesDocumentSearch` : la requête est normalisée par la même fonction puis découpée
  sur les espaces ; chaque jeton doit être une sous-chaîne de la clé. Requête vide → `true`.
- `computeDocumentFacets(entries, { query, type, zone })` où chaque `entry` porte
  `{ key, searchKey, typeKey, typeLabel, zoneKey, zoneLabel }` :
  - `visibleKeys` : les `key` des entrées passant **les trois** filtres.
  - `typeOptions` : calculé sur les entrées passant `query` + `zone` (pas `type`).
  - `zoneOptions` : calculé sur les entrées passant `query` + `type` (pas `zone`).
  - Chaque option : `{ value, label, count }`. L'option « tous » porte le total de son
    ensemble de calcul. Si la valeur actuellement sélectionnée est absente du résultat,
    elle est ajoutée avec `count: 0` pour que le `<select>` ne se réinitialise pas seul.
  - L'ordre des options suit celui d'apparition des entrées (les entrées arrivent déjà
    triées par `collectProjectDocumentEntries` / `buildReferenceEditMatchListMarkup`).

### 4.2 Fusion des deux filtres DOM dans `legacy.js`

`filterDuplicateDocumentList` et `filterReferenceEditMatchList` sont remplacées par une
fonction unique :

```
applyReferenceDocumentListFilters(container, { query, type, zone, emptyElementId })
```

Elle lit `data-doc-search`, `data-doc-type`, `data-doc-zone` sur chaque
`.duplicate-document-item`, délègue le calcul à `computeDocumentFacets`, puis :
1. masque/affiche les items,
2. masque les `.duplicate-zone-group` puis les `.duplicate-document-group` devenus vides,
3. reconstruit les `<option>` des deux menus avec leurs compteurs,
4. bascule le message « aucun document ne correspond »,
5. appelle le rafraîchissement de sélection propre au dialogue
   (`refreshDuplicateSelectionUi` ou `updateReferenceEditGroupSelectionUi`).

### 4.3 Attributs de données unifiés

Les deux générateurs de markup (`buildDuplicateDocumentCheckboxMarkup` L5831 et le bloc
d'item de `buildReferenceEditMatchListMarkup` L828) émettent désormais :

| Attribut | Contenu |
|---|---|
| `data-doc-search` | `buildDocumentSearchKey({numero, name})` — **plus de type ni de zone** |
| `data-doc-type` | `normalizeReferenceDocumentIdentityPart(type)` ou `__sans_type__` |
| `data-doc-zone` | `normalizeZoneMatchKey(zone)` ou `__sans_zone__` |

`data-duplicate-search` et `data-edit-match-search` disparaissent.

### 4.4 Barre d'outils partagée

Une fonction de rendu commune produit le HTML des trois contrôles pour les deux dialogues,
paramétrée par un préfixe d'identifiants (`duplicate` / `editOtherDocuments`) afin de
conserver les `id` existants attendus par le reste du code et par le CSS.

Placeholder de la recherche : `Numéro ou nom…` (il ne mentionne plus le type ni la zone).

### 4.5 Signature élargie de `collectProjectDocumentEntries`

```
collectProjectDocumentEntries(projectName, typeValue = '', { zoneSelection = getCurrentSelectedZone() } = {})
```

Les appelants existants sont inchangés. Le dialogue « Ajouter » passe
`REFERENCE_ALL_ZONES_VALUE` et `typeValue = ''` pour obtenir tout le projet.

## 5. Comportements attendus

- Changer un menu **ne re-rend pas** la liste : le défilement et les cases cochées survivent.
- « Tout sélectionner (filtrés) » continue de n'agir que sur les items visibles
  (`getVisibleDuplicateDocumentCheckboxes` / `getVisibleReferenceEditMatchCheckboxes` filtrent
  déjà sur `.duplicate-document-item[hidden]`).
- Les cases cochées puis masquées par un filtre **restent sélectionnées** : la sélection est
  portée par `duplicateSelectedDocumentValues` / `referenceEditSelectedRecordIds`, pas par
  la visibilité. Le compteur « N autres sélectionnés » reste donc juste.
- Les en-têtes de groupe Type et Zone restent affichés dans la liste.
- Le dialogue « Modifier » n'affiche que les lignes identiques trouvées ; les menus reflètent
  ce sous-ensemble, pas tout le projet.

## 6. Tests — `Reference2/tests/document-filter-utils.test.cjs`

Fixture : extrait réel du projet de l'utilisateur — `PH N-D` et `PH N-U` déclinés sur
`Coffrage` / `Coupes` / `Démolition` × `Bloc 1` … `Bloc 4`, `Bloc 1-2`, `Bloc 3-4`,
plus `Fondations` et `ESC IV-1` pour le bruit.

| Cas | Attendu |
|---|---|
| `PH N-D` | les 10 documents `PH N-D`, tous types et zones |
| `PH N-D` + Type `Coupes` | les 4 de COUPES |
| `PH N-D` + Type `Coupes` + Zone `Bloc 2` | `2102` seul |
| `PH  N-U` (double espace en donnée) | trouvé par la requête `PH N-U` |
| `demolition` sans accent | trouve `Démolition`… |
| …mais uniquement via le **menu** Type | la requête `demolition` ne renvoie **rien** (le type n'est plus cherché) |
| `N-D 1101` | trouve `1101 PH N-D` (ordre des mots libre) |
| `110` | trouve `1101`, `1102`, `1103`… (sous-chaîne sur le numéro) |
| requête vide | tout est visible |
| compteurs | `typeOptions` reflète la requête + la zone active ; `zoneOptions` reflète la requête + le type actif |
| sélection orpheline | un type sélectionné devenu introuvable reste présent avec `count: 0` |

Exécution : `node --test Reference2/tests/`.

## 7. Hors périmètre

- Les listes déroulantes de la barre du haut (`thirdColumnDropdown`, `zoneDropdown`) ne changent pas.
- Aucune écriture Grist nouvelle ; aucun schéma modifié.
- Les autres widgets qui écrivent dans `References2` ne sont pas touchés.
- Aucun commit, aucun push.
