# planning-synchro

Widget Grist mono-page qui affiche, sur **une seule frise chronologique
partagée**, le planning projet (`Planning_Projet`, lecture seule) au-dessus
du plan de charge prévisionnel (`TimeSegment`, éditable) — sans iframe.

## Pourquoi ce widget

`Synchro/` (et son prédécesseur `synchronisation-plannings/`) résolvait déjà
ce besoin en embarquant `Planning Projet` et `gestion-depenses2` dans deux
**iframes** synchronisées par mesure DOM + `nudgeViewportByPixels` + retries
temporisés. Cette approche souffrait de trois classes de bugs récurrents :
**désynchronisation de la frise** au zoom/déplacement (dérive pixel entre les
deux iframes), **lenteur/à-coups** (boucle de mesure-et-correction), et
**chargement/changement de projet instable**.

`planning-synchro` remplace cette architecture par **deux moteurs de rendu
dans une seule fenêtre/document** (vis-timeline en haut, grille DOM custom en
bas), pilotés par un **unique contrôleur de synchronisation** — voir
"Conception" ci-dessous. Aucun `postMessage`, aucun iframe, aucune boucle de
correction pixel.

## Tables et colonnes Grist requises

| Table | Rôle | Colonnes utilisées |
|---|---|---|
| `Projets2` | Registre canonique des projets, pont nom ↔ numéro | `id`, `Nom_de_projet`, `Numero_de_projet` |
| `Planning_Projet` | Planning projet (haut, lecture seule), filtré par `NomProjet` | `id`, `ID2`, `NomProjet`, `Taches`/`Tache`, `Type_doc`, `Groupe`, `Ligne_planning`, `Zone`, `Date_limite`, `Diff_coffrage`, `Diff_armature`, `Demarrages_travaux` |
| `TimeSegment` | Plan de charge prévisionnel (bas, éditable), filtré par `NumeroProjet` | `NumeroProjet`, `Name`, `Start_At`, `End_At`, `Allocation_Days`, `Effectif`, `Label` |
| `ProjectTeam` | Rôle de chaque personne pour le regroupement (Projeteurs / Ingénieurs / Autres), filtré par `NumeroProjet` | `NumeroProjet`, `Name`, `Role`, `Daily_Rate` |

La tolérance d'alias sur les colonnes `TimeSegment`
(`Start_At`/`Start_Date`/`StartAt`/`StartDate`/`Start`, etc. — voir
`assets/js/services/gristService.js`) s'applique **uniquement au chemin
d'écriture** (`createTimeSegment`/`updateTimeSegment`). Le chemin de
**lecture** (filtre `fetchProjectData`, `buildWorkersFromSegments`,
`computeTimeSegmentBounds`) utilise les identifiants de colonnes tels que
configurés dans `assets/js/config.js`, qui correspondent aux noms réels des
tables livrées.

## Accès Grist

Le widget appelle `grist.ready({ requiredAccess: "full" })` au démarrage
(`assets/js/services/gristService.js`, `initGrist()`) : lecture de
`Projets2`/`Planning_Projet`/`TimeSegment`/`ProjectTeam`, et écriture sur
`TimeSegment` (création/modification/suppression de segments depuis le pane
bas).

## Conception : frise partagée et alignement arithmétique

Un **viewport canonique** unique (`{ mode, firstVisibleDate, visibleDays,
rangeStartDate, rangeEndDate, anchorDate }`) est produit par toute
interaction (toolbar semaine/mois/année, précédent/suivant/aujourd'hui,
molette-zoom) et appliqué aux **deux** panes de façon synchrone, dans un
seul `requestAnimationFrame` (`assets/js/sync/controller.js`). Comme les deux
panes vivent dans le **même document**, à la **même largeur de contenu**, en
recevant **les mêmes nombres** (`firstVisibleDate`/`visibleDays`), la largeur
de jour (`dayWidth = contentWidthPx / visibleDays`) — et donc l'alignement
pixel des deux frises — est **arithmétique, vraie par construction**, plutôt
que mesurée puis corrigée après coup : l'ancienne boucle
mesure-DOM-puis-nudge-puis-retry de `Synchro/` disparaît, remplacée par une
unique assertion de garde (`console.warn` si écart > 1px, jamais de boucle de
correction). Les bornes de la frise sont l'**union** de la plage `TimeSegment`
(`min(Start_At)` → `max(End_At)`) **et** de la plage de toutes les phases
`Planning_Projet` (dateBounds du builder, via `computePlanningPhaseBounds` +
`unionDateBounds` dans `main.js`), afin qu'une tâche dont les phases tombent hors
du prévisionnel reste visible et navigable. La fenêtre visible se déplace
librement dans ces bornes (toolbar / molette-zoom sur l'axe / glisser) et
s'ouvre au maximum sur **14 mois** (`viewport.maxVisibleDays`).

## Pane haut = rendu Planning Projet exact (lecture seule, colonne Tâche)

Le pane haut reproduit **exactement** le planning de `Planning Projet` : mêmes
phases (coffrage/armature/NDC/coupes/démolition/générique + démarrage), mêmes
couleurs, **états réalisé/retard** (bandes `phase-past`, styles inline de retard),
en-têtes de zone et info-bulles. Il **réutilise le vrai builder** de Planning
Projet, *vendorisé* (copié pour rester auto-contenu) sous
`assets/js/top/vendor/planningProjetBuilder.js` (avec `planningRealisation.js` et
`columnsConfig.js`) : `buildTimelineDataFromPlanningRows()` produit une ligne par
enregistrement + les en-têtes de zone, ordonnées Zone → `Ligne_planning` → `ID2` →
`Type_doc` → `Taches`. Les états réalisé/retard viennent des colonnes `Realise` /
`Retards` / `Indice` du record (aucun appel Grist supplémentaire), avec repli sur
`Projets2.Avancement` (target-indice). `assets/js/top/phases.js` **adapte** cette
sortie au pane partagé : la **colonne de gauche n'affiche que la Tâche** (une ligne,
tronquée) — ou le nom de zone sur une ligne d'en-tête — pour garder l'alignement de
la frise ; l'identité (**ID2 · Zone · Groupe**) est portée par l'info-bulle. Le
rendu reste **strictement en lecture seule** (aucune édition, aucun drag, aucune
modale), piloté par le contrôleur de synchro (on ne réutilise pas `timeline.js` de
Planning Projet, qui a son propre contrôleur de viewport).

La bande **« Données d'entrées »** (réception) est incluse :
`assets/js/services/referenceReception.js` lit la table `References2` et lie chaque
ligne planning à ses documents **bloquants** (clé `NomProjet` + `ID2` +
`Type_doc` + `Taches` + `Zone`, repli zone vide) pour produire un statut
**complet / manquant / mixte** (bande verte / rouge / orange), exactement comme
Planning Projet — sans dépendre de son moteur générique de correspondance.

## Mise en page du pane haut (frise sticky, séparateur, libellés)

Le pane haut a une **hauteur visible bornée** entre **5 et 16 lignes de tâches**
(défaut : 10). Un **séparateur** déplaçable entre les deux panes (poignée sous le
planning, `#ps-splitter`, aussi pilotable au clavier ↑/↓) ajuste cette hauteur et
se fige à l'endroit relâché. Sous le contenu, la hauteur s'adapte au nombre réel
de tâches (aucune ligne vide) ; au-delà de 16 lignes, le pane haut **scrolle
verticalement en interne** tandis que la **frise (axe de temps) reste figée en
haut** (sticky). Mécanisme : option `maxHeight` + `verticalScroll` de
vis-timeline, cap calculé par `assets/js/top/paneMath.js` (pur, testé) et appliqué
par `assets/js/ui/topPaneResizer.js` (mesure de l'axe et de la hauteur de ligne,
drag pointer/clavier). Chaque **libellé de tâche tient sur une seule ligne**,
tronqué en `…` si trop long, avec le nom complet en info-bulle native (`title`).

### Navigation dans la frise

- **Glisser-déposer horizontal** : attraper la frise du pane haut et la faire
  glisser gauche/droite panote dans le temps ; les **deux panes suivent** (via
  `sync/controller.js` → `bindPan`, même chemin `setViewport` que la toolbar,
  donc alignement conservé).
- **Molette** : sur l'**axe de temps (frise)** = zoom / dézoom ; sur les **lignes
  de tâches** = **scroll vertical** interne (frise sticky) ; sur le **pane bas** =
  zoom. Le handler molette du contrôleur distingue la région (axe vs lignes).
- **Toolbar** (semaine/mois/année, précédent/suivant/aujourd'hui) inchangée.

Le segment **démarrage de travaux** est rendu comme un **segment vert plein de
même hauteur que les autres barres** (avec une largeur minimale pour rester
visible au dézoom), produit pour les armatures (toujours) et coffrages liés au
planning ; il est simplement **retiré du mode « Rassembler visuellement le
planning »** (agrégat par `Type_doc`, dont l'info-bulle HTML liste **toutes les
tâches** composant un segment). La **colonne de gauche** (tâches) est **teintée
par type de document** comme dans Planning Projet (coffrage, NDC, coupes,
démolition, générique ; armature sans teinte). Le **pane bas** affiche **toutes
les personnes** liées au projet (`ProjectTeam`), même sans `TimeSegment`, comme
`gestion-depenses2`.

Les items dont la date est **hors de la fenêtre visible** ne sont plus
« épinglés » au bord gauche de la frise : l'option vis `align:'center'` ancre le
contenu de chaque segment à sa propre boîte, donc un segment hors chronologie
n'est tout simplement pas visible tant qu'on n'a pas navigué jusqu'à lui.

En mode **Editer**, le **clic droit** sur un segment ouvre le menu contextuel
**Modifier** / **Supprimer le segment**, avec la **même fenêtre et les mêmes
fonctionnalités que `gestion-depenses2`** : **Modifier** ouvre la modale
« Modifier le segment » (`bottom/editSegmentModal.js`, portée depuis
`#edit-segment-modal`) — plage au demi-jour près (Début / Fin + Matin /
Après-midi), « jours effectifs travaillés » optionnel et « jours disponibles
dans la plage » recalculés en direct, avec contrôle de chevauchement et
d'effectif (multiple de 0,5, ≤ jours de la plage) avant écriture
(`updateTimeSegment` + rafraîchissement). **Supprimer le segment** appelle
`removeTimeSegment` (comme `gestion-depenses2`, sans confirmation).

## Développement

Tests unitaires purs (parsing dates/décimales, modèle de phases, agrégation,
viewport, etc.) :

```bash
cd planning-synchro
node --test "tests/**/*.test.mjs"
```

Vérification visuelle/interaction (rendu vis-timeline, édition du plan de
charge, alignement des deux panes) : servir le dossier en HTTP — les modules
ES échouent sous `file://` — et ouvrir le harnais de dev, qui charge un mock
`window.grist` (`dev/mock-grist.js`) avec des données fictives
(`dev/fixtures.js`) au lieu d'un vrai document Grist :

```bash
cd planning-synchro
python -m http.server 8791
# puis ouvrir http://localhost:8791/dev/harness.html
```

Les écritures `TimeSegment` faites via le mock sont **appliquées aux fixtures
en mémoire** (`AddRecord` / `UpdateRecord` / `RemoveRecord`) — le harnais se
comporte donc comme un vrai Grist : créer / modifier / supprimer un segment se
reflète après re-rendu. Elles sont aussi capturées dans `window.__appliedActions`
(mêmes tuples), utile pour vérifier par script (CDP/console) que le bouton
**Editer** et la modale **Modifier** produisent bien les actions attendues sans
dépendre d'un document Grist réel.
