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
| `Planning_Projet` | Planning projet (haut, lecture seule), filtré par `NomProjet` | `NomProjet`, `Taches`/`Tache`, `Type_doc`, `Ligne_planning`, `Zone`, `Date_limite`, `Diff_coffrage`, `Diff_armature`, `Demarrages_travaux` |
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
correction). Les bornes de la frise viennent **uniquement** de `TimeSegment`
(`min(Start_At)` → `max(End_At)`) ; `Planning_Projet` ne les élargit jamais et
son contenu hors bornes est simplement hors champ.

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

Les écritures `TimeSegment` faites via le mock sont capturées dans
`window.__appliedActions` (tuples `["AddRecord"|"UpdateRecord"|"RemoveRecord", "TimeSegment", ...]`),
utile pour vérifier par script (CDP/console) que le bouton **Editer** produit
bien les actions attendues sans dépendre d'un document Grist réel.
