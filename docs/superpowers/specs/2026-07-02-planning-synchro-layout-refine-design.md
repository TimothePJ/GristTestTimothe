# planning-synchro — affinage mise en page & interactions (frise sticky, séparateur, bornes 5–16, libellés une ligne)

Date : 2026-07-02
Statut : validé (design), implémentation en cours (commit après validation utilisateur)

## Contexte

`planning-synchro` empile deux panes sur **une frise chronologique partagée** :
le planning projet en haut (vis-timeline, lecture seule, colonne Tâches) et le
plan de charge prévisionnel en bas (grille DOM, éditable). Ce lot **affine
uniquement la mise en page et les interactions** ; il ne touche pas au linking
projet, aux bornes de frise issues de `TimeSegment`, à la synchro horizontale
arithmétique, ni à l'édition du pane bas.

Rappel d'architecture (voir `planning-synchro/README.md`) : le pane haut est un
`vis.Timeline` (`#ps-planning`) qui **réutilise déjà** la logique de phases de
Planning Projet via `top/phases.js`. « Pane haut identique à Planning Projet »
signifie donc **ne pas régresser** ce rendu, pas le réécrire.

## Décisions validées (levée d'ambiguïtés)

1. **Plafond « 16 lignes »** = plafond de la **hauteur visible** du pane haut.
   Au-delà de 16 lignes de contenu → **scroll interne** du pane haut, frise
   **sticky**. **5 lignes** = **plancher du redimensionnement** (drag).
2. **Adaptation au contenu** : le pane haut ne dépasse **jamais** le nombre
   réel de tâches (aucune ligne vide). Le clamp 5–16 ne s'applique que quand il
   y a assez de tâches. Moins de 5 tâches → hauteur = nb réel de tâches.
3. **Navigation horizontale inchangée** : toolbar (semaine/mois/année,
   précédent/suivant/aujourd'hui) + molette-zoom, via le contrôleur de synchro.
   La frise devient simplement **sticky** ; pas de cliquer-glisser (pan) ajouté.
4. **Défaut** : 10 lignes visibles au chargement (garde le pane bas éditable
   visible), borné au contenu. **Position du séparateur : mémorisée en session**
   (variable en mémoire), ré-appliquée au changement de projet et re-bornée au
   nombre de lignes du nouveau projet ; **non persistée** en localStorage.

## Exigences

- **R2** Frise (axe de temps) **sticky** en haut du pane haut : reste visible
  pendant le scroll vertical interne des lignes. Elle reste alignée avec les
  colonnes des deux tableaux et sert à la navigation horizontale existante.
- **R3** **Séparateur draggable** entre les deux panes : glisser vers le haut
  réduit la hauteur visible du pane haut, vers le bas l'agrandit ; fluide, se
  fige exactement où on relâche.
- **R4** Bornes : **min 5 / max 16 lignes visibles**. Au-delà de 16 lignes de
  contenu → scroll interne (frise sticky) au lieu d'agrandir.
- **R5** **Une tâche = une ligne** : libellé tronqué en `…` s'il est trop long ;
  `title` natif = nom complet au survol.
- **Invariant** : alignement des colonnes de gauche et calage sur la frise
  partagée **conservés** (critère ≤ 1px de l'assertion du contrôleur).

## Conception

### Vue d'ensemble

Quatre changements **additifs**, sans modifier le calcul des phases ni le rendu
des items du pane haut :

- **A. Frise sticky + hauteur bornée** du pane haut, via la `verticalScroll`
  native de vis-timeline (l'axe `orientation.axis:'top'` reste figé, seule la
  zone des groupes/labels défile).
- **B. Séparateur draggable** pilotant la hauteur du pane haut.
- **C. Bornes 5–16 + adaptation au contenu** (math pure, testée).
- **D. Libellés une ligne** (ellipsis + `title`).

### A + C — Hauteur du pane haut & frise sticky

**Math pure** — nouveau module `assets/js/top/paneMath.js`, testable sous
`node --test` (aucun accès DOM) :

```
computeTopPaneHeight({ axisHeightPx, rowHeightPx, groupCount, desiredRows, minRows, maxRows })
  clampedRows   = clamp(desiredRows, minRows, maxRows)
  effectiveRows = min(clampedRows, groupCount)      // adaptation au contenu (R4/décision 2)
  heightPx      = axisHeightPx + effectiveRows * rowHeightPx
  scrolls       = groupCount > clampedRows
  → { heightPx, effectiveRows, clampedRows, scrolls }
```

Propriétés vérifiées par les tests :
- contenu > 16 & desired=16 → effectiveRows=16, scrolls=true (plafond + scroll).
- contenu=8, desired=12 → effectiveRows=8, scrolls=false (adaptation, 0 ligne vide).
- contenu=3 → effectiveRows=3 (< plancher 5, pas de lignes vides).
- desired hors bornes → clampé à [5,16] ; groupCount=0 → hauteur = axe seul.

**État `desiredRows`** stocké en **lignes fractionnaires** (indépendant de
`axisHeightPx`, qui change selon le zoom : bande d'axe semaine/mois/année de
hauteur différente). Le drag convertit un delta pixels en delta lignes
(`deltaPx / rowHeightPx`).

**Mesure DOM** (dans le resizer, post-layout via `requestAnimationFrame`) :
- `axisHeightPx` = hauteur de `#ps-planning .vis-panel.vis-top`.
- `rowHeightPx`  = `.vis-labelset` scrollHeight / groupCount (moyenne robuste ;
  exacte quand les lignes sont uniformes — cas courant), fallback constante.
- `groupCount`   = `planningRenderer.getGroupCount()`.

**vis-timeline** (mécanisme confirmé en navigateur) : `verticalScroll: true`,
`horizontalScroll: false`, et **cap via l'option `maxHeight`** (px) posée par le
resizer (`planningRenderer.setMaxHeight` → `timeline.setOptions({maxHeight})`).
vis rend `min(contenu, cap)` : sous le cap, hauteur = contenu (aucune ligne
vide) ; au-dessus, vis crée `.vis-vertical-scroll` sur les panneaux gauche/droite
et **fige l'axe** (`.vis-panel.vis-top`, panneau séparé). `#ps-planning` n'a pas
de hauteur fixe : il enveloppe la timeline cappée. (L'approche initiale
`height:'100%'` laissait vis grandir à pleine hauteur — abandonnée.)

Recalcul de la hauteur sur : (re)render, changement de viewport (zoom/pan → la
bande d'axe change de hauteur), drag du séparateur, resize fenêtre.

### B — Séparateur draggable

Élément réel `#ps-splitter.ps-splitter[role=separator][aria-orientation=horizontal][tabindex=0]`
inséré entre `.ps-pane--planning` et `.ps-pane--charge` dans `#ps-main`
(index.html **et** dev/harness.html).

- Pointer events : `pointerdown` → `setPointerCapture` + mémorise `startY` et
  `startRows` ; `pointermove` → `desiredRows = clamp(startRows + (clientY −
  startY)/rowHeightPx, 5, 16)` puis applique ; `pointerup` → relâche. Mise à
  jour de style peu coûteuse par frame (pas de `vis.setOptions` en boucle) →
  fluide, se fige où on relâche.
- Clavier : ↑/↓ sur le handle focalisé = ±1 ligne (accessibilité).
- `aria-valuemin=5`, `aria-valuemax=16`, `aria-valuenow` mis à jour.
- Le pane bas continue de suivre naturellement en dessous ; l'iframe Grist
  scrolle l'ensemble comme aujourd'hui.

Module `assets/js/ui/topPaneResizer.js` : `createTopPaneResizer({ planningEl,
splitterEl, getGroupCount, config, getDesiredRows, setDesiredRows })` → `{
refresh, destroy }`. `desiredRows` vit dans une closure de `main.js` (session).

### D — Libellés une ligne (ellipsis + tooltip)

Dans `toVisGroups` (`top/planningRenderer.js`) : `content` = **texte simple
échappé** et `title` = nom complet via l'**option de groupe vis `title`**
(appliquée telle quelle sur l'attribut `title` de `.vis-label` → tooltip natif).
Important : **vis assainit le HTML de `content` et retire les attributs
`class`/`title`** — injecter un `<span class title>` ne marche pas (constaté en
navigateur). CSS sur `#ps-planning .vis-label .vis-inner` :
`display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`.
La colonne gauche est déjà de largeur fixe (`--ps-left-col-width: 220px`), donc
la troncature est bornée.

### Invariant d'alignement (risque principal)

L'alignement des deux frises est **arithmétique** : il tient tant que la
**largeur de contenu** de la zone-timeline est **identique** entre les deux
panes. Un ascenseur vertical qui **réduit** la largeur du panneau center du
pane haut casserait le critère ≤ 1px.

Résultat confirmé en navigateur (Chrome headless via CDP) : avec le mécanisme
`maxHeight`+`verticalScroll`, vis place l'ascenseur vertical sur le **panneau
droite** (`.vis-panel.vis-right.vis-vertical-scroll`), **hors** de la zone de
contenu center — la largeur du panneau center **ne change pas**. L'alignement
gauche ET la largeur de contenu des deux panes restent égaux à ≤ 1,5px, même
ascenseur présent, et l'assertion `console.warn` du contrôleur ne se déclenche
pas. La gouttière-miroir envisagée n'a donc pas été nécessaire ; un léger style
d'ascenseur fin est conservé pour la cohérence visuelle. La molette reste zoom
(voir ci-dessous) ; le scroll vertical se fait à l'ascenseur/trackpad.

### Molette : zoom prioritaire sur le scroll vertical vis

`verticalScroll:true` fait défiler les lignes à la molette, ce qui entrerait en
conflit avec la molette-zoom existante (contrôleur, lié sur `#ps-main`). Pour
**ne pas régresser** (molette = zoom), le handler molette du contrôleur passe en
**capture** + `stopPropagation` sur `#ps-main`, de sorte que vis ne reçoit pas
l'événement molette (pas de double action). Le scroll vertical interne se fait
via l'ascenseur/trackpad. Petit changement ciblé dans `sync/controller.js`
(`bindWheel`), zoom inchangé par ailleurs.

## Fichiers touchés

- `planning-synchro/index.html`, `planning-synchro/dev/harness.html` — élément
  séparateur entre les panes.
- `planning-synchro/assets/css/styles.css`, `variables.css` — styles séparateur,
  ellipsis libellé, hauteur pane haut (var), ascenseur fin largeur fixe +
  gouttière miroir pane bas ; tokens réutilisés.
- `planning-synchro/assets/js/config.js` — `topPane: { minRows:5, maxRows:16,
  defaultRows:10 }`.
- `planning-synchro/assets/js/top/planningRenderer.js` — options
  `verticalScroll`/`horizontalScroll`/`maxHeight` + `setMaxHeight()`, `content`
  texte simple + option de groupe `title`, `getGroupCount()`.
- **nouveau** `planning-synchro/assets/js/top/paneMath.js` (pur, testé).
- **nouveau** `planning-synchro/assets/js/ui/topPaneResizer.js` (drag +
  mesure + application).
- `planning-synchro/assets/js/main.js` — créer/détruire le resizer avec les
  autres instances par-projet ; recalcul hauteur après render et sur changement
  de viewport ; closure `desiredRows` (session).
- `planning-synchro/assets/js/sync/controller.js` — `bindWheel` en capture +
  `stopPropagation`.
- `planning-synchro/dev/fixtures.js` — nouveau projet fixture avec > 16 tâches
  (+ quelques `TimeSegment` pour des bornes) pour vérifier le scroll interne.
- `planning-synchro/tests/paneMath.test.mjs` — tests unitaires du math pur.

## Vérification (critères d'acceptation)

Unitaire (`node --test "tests/**/*.test.mjs"`) : `paneMath` (clamp 5/16,
adaptation au contenu, scrolls, groupCount=0). **47/47 OK.**

Navigateur : Chrome headless piloté par CDP (Node 25, `WebSocket`/`fetch`
globaux) contre `dev/harness.html`. **21/21 OK** :
- [x] Frise (axe) figée pendant le scroll vertical interne (`axisDelta` = 0),
      projet 20 tâches.
- [x] Séparateur : clavier ↑/↓ et cliquer-glisser redimensionnent, clamp à 5 et
      16 (aria-valuenow 5/16), se fige où on relâche.
- [x] Au-delà de 16 : scroll interne (`.vis-vertical-scroll`, contenu > cap).
- [x] Aucun libellé sur 2 lignes (`white-space:nowrap` + `text-overflow:ellipsis`,
      `scrollWidth>clientWidth`) ; `title` = nom complet.
- [x] Alignement colonnes gauche + largeur de contenu ≤ 1,5px, ascenseur présent ;
      aucun `console.warn` de désalignement.
- [x] Adaptation au contenu (projet 4 tâches : hauteur = axe + 4 lignes, pas de
      scroll, pas de lignes vides).
- [x] Non-régression molette : la molette zoome toujours (la plage change) et ne
      scrolle PAS les lignes.
- [x] Aucune exception JS.

## Hors périmètre (YAGNI)

- Pas de cliquer-glisser (pan) sur la frise.
- Pas de persistance localStorage de la position du séparateur.
- Pas de scroll vertical à la molette (molette = zoom, inchangé).
- Pas de modification du calcul des phases / du stacking des items.
