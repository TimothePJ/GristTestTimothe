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
| `Projets2` | Registre canonique des projets, pont nom ↔ numéro ; indices cibles et maximums du lissage | `id`, `Nom_de_projet`, `Numero_de_projet`, `Avancement`, `Lissage` (texte, facultative — voir « Lissage des tâches ») |
| `Planning_Projet` | Planning projet (haut, lecture seule), filtré par `NomProjet` | `id`, `ID2`, `NomProjet`, `Taches`/`Tache`, `Type_doc`, `Groupe`, `Ligne_planning`, `Zone`, `Date_limite`, `Diff_coffrage`, `Diff_armature`, `Demarrages_travaux`, `Duree_Force`, `Duree_Zone`, `Duree_Projet` |
| `TimeSegment` | Plan de charge prévisionnel (bas, éditable), filtré par `NumeroProjet` — **un segment couvre un mois entier** | `NumeroProjet`, `Name`, `Mois`, `Effectif`, `Allocation_Days`, `Label` |
| `ProjectTeam` | Rôle de chaque personne pour le regroupement (Projeteurs / Ingénieurs / Autres), filtré par `NumeroProjet` | `NumeroProjet`, `Name`, `Role`, `Daily_Rate` |

`Mois` est une colonne **Date** valant le **1er du mois** ; c'est la seule
source de vérité du segment. `Allocation_Days` est **dénormalisée** : écrite à
la création/modification (jours ouvrés du mois) pour la lisibilité de la grille
Grist, elle n'est **jamais relue** — la capacité d'un segment est recalculée
depuis son mois (`getSegmentAllocationDays`, `assets/js/utils/timeSegments.js`).
`Start_At`/`End_At` ne sont **plus écrites** ; `Start_At` reste lue en **repli**
pour les lignes antérieures à la bascule (voir « Migration `TimeSegment` » plus
bas), `End_At` n'est ni lue ni écrite.

La tolérance d'alias sur les colonnes `TimeSegment` (`Mois`/`Month`,
`Start_At`/`Start_Date`/`StartAt`/`StartDate`/`Start`, etc. — voir
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
bas), sur les colonnes de durée de `Planning_Projet` (charge de référence) et
sur la seule colonne `Projets2.Lissage` (maximums du lissage).

## Charge de référence

Chaque document `Planning_Projet` déclare, dans trois colonnes, le nombre de
jours de travail qu'il requiert :

- `Duree_Force` — durée de ce document seul ;
- `Duree_Zone` — durée standard des documents de ce type, dans cette zone ;
- `Duree_Projet` — durée standard des documents de ce type, par défaut du projet.

Ces valeurs **se résolvent en cascade** à la lecture : `Duree_Force` → `Duree_Zone`
→ `Duree_Projet`. Un document consulte d'abord sa propre `Duree_Force` ; si elle
est vide, `null`, négative, non-numérique, ou **explicitement 0**, il la rejette
et descend au niveau suivant. La valeur résolue n'est **jamais stockée** : un
document qui change de zone ou de type se reclasse automatiquement avec la valeur
appropriée du nouveau niveau, sans code de migration.

Les valeurs sont exprimées en **jours, multiples de 0,5** (0, 0.5, 1, 1.5, etc.).
Pour dire « ce document n'a aucun coût », laisser les trois colonnes vides.

**Charge par métier** (2026-10-26) : chaque colonne porte **deux durées**, celle
des **ingénieurs** puis celle des **projeteurs**, séparées par `;` — `2,5;3` =
2,5 j ingénieurs et 3 j projeteurs. L'ancien format (un nombre seul, `2,5` ou
`2.5`) vaut pour les ingénieurs ; `;3` n'a de valeur que pour les projeteurs.
La cascade se résout **métier par métier** : une `Duree_Force` à `;5` ne fixe que
les projeteurs, les ingénieurs reprennent `Duree_Zone` ou `Duree_Projet`
(`bottom/documentCharge.js` : `parseDurationPair`, `formatDurationPair`,
`resolveDocumentCharge`). Le widget écrit `2,5;3`, `;3`, ou `2,5` quand seuls
les ingénieurs ont une valeur (l'ancien format), et `""` quand plus aucun.
**Les trois colonnes doivent être de type Texte dans Grist** : une colonne
Numérique garde `2,5;3` comme valeur invalide (cellule rouge) — le widget la lit
quand même, mais la grille Grist la signale.

La charge résolue est répartie sur les **mois que sa plage de dates touche**
(mois du `Demarrages_travaux` jusqu'au mois de la `Date_limite`), **au prorata
des jours ouvrés** de chaque mois. Ainsi un document de 10 jours en septembre et
octobre sera réparti selon le nombre de jours ouvrés de chaque mois. La répartition
utilise l'**algorithme du plus grand reste** pour garantir que les parts mensuelles
somment exactement à la charge d'entrée. Un document qui n'a aucune date de
planning (pas de phases) **ne peut s'attacher à aucun mois** ; sa charge apparaît
dans une figure **« non placé »** affichée sur la ligne du document.

Le **pane bas** affiche, sous la ligne **Total**, une ligne **Charge par
métier** : **Projeteurs** puis **Ingénieurs**, dans l'ordre des sections du pane
(la cellule Grist et la fenêtre de saisie gardent l'ordre ingénieurs ; projeteurs).
Par mois visible,
chacune compare les jours *planifiés* des seules personnes de ce métier (groupes
« Ingenieurs » / « Projeteurs » du pane, d'après le rôle `ProjectTeam` ; les
« Autres » ne comptent dans aucune) contre les jours *requis* de ce métier
(somme des charges des documents). Les jours planifiés d'un métier sont donc ceux
qu'affiche la ligne de sa section (« Ingenieurs », « Projeteurs ») ; la ligne
**Total** est indicative et n'entre dans aucune comparaison. Chaque pastille
porte les deux termes, **« requis / planifié »** (`39 j / 15 j`), `— / 12 j` quand
rien n'est requis ce mois-là (`formatChargeLabel`, 2026-10-27) ; dans un mois trop
étroit (coupé au bord, dézoom large), elle est coupée à la limite du mois. Chaque
ligne a son badge « non placé ». Trois couleurs indiquent la tension :

- `--load-balanced` `#d7eccb` (vert clair) : jours planifiés = jours requis ;
- `--load-overload` `#ffe1a8` (beige clair) : **moins** de jours planifiés que
  requis ;
- `--load-partial` `#edf4fb` (bleu clair) : **plus** de jours planifiés que
  requis.

La charge n'est pas plafonnée : un mois peut requérir plus de jours qu'il n'en
contient.

Un **seul bouton Charge**, sur la première de ces deux lignes (la case du
bouton reste vide sur la seconde, pour aligner les noms de métier), ouvre la
**fenêtre de saisie** qui règle les deux métiers et répartit les durées sur trois niveaux : Type de
document → Zone → Document. Chaque niveau a **deux champs**, Ingénieurs et
Projeteurs. À chaque niveau, un champ vide affiche la valeur héritée du niveau
au-dessus pour son métier (grisée, en lecture seule) ; seules les valeurs
**explicites** sont modifiables. Une saisie ne change que le métier saisi :
l'autre part de chaque ligne visée est gardée telle quelle ; aux niveaux type et
zone, une ligne où elle est **vide** reçoit la valeur affichée pour ce niveau
(sa valeur propre, jamais une valeur héritée), pour que la fenêtre ne crée pas
elle-même de divergence. L'enregistrement
écrit chaque ligne affectée en un **seul lot** d'`UpdateRecord`.

## Conception : frise partagée et alignement arithmétique

Un **viewport canonique** unique (`{ mode, firstVisibleDate, visibleDays,
rangeStartDate, rangeEndDate, anchorDate }`) est produit par toute
interaction (toolbar semaine/mois/année, précédent/suivant/aujourd'hui,
molette-zoom, glisser) et appliqué aux **deux** panes dans la **même image**
(`assets/js/sync/controller.js` ; voir « Fluidité » plus bas). Comme les deux
panes vivent dans le **même document**, à la **même largeur de contenu**, en
recevant **les mêmes nombres** (`firstVisibleDate`/`visibleDays`), la largeur
de jour (`dayWidth = contentWidthPx / visibleDays`) — et donc l'alignement
pixel des deux frises — est **arithmétique, vraie par construction**, plutôt
que mesurée puis corrigée après coup : l'ancienne boucle
mesure-DOM-puis-nudge-puis-retry de `Synchro/` disparaît, remplacée par une
unique assertion de garde (`console.warn` si écart > 1px, jamais de boucle de
correction). Les bornes de la frise sont l'**union** de la plage `TimeSegment`
(1er jour du plus petit `Mois` → dernier jour du plus grand,
`top/bounds.computeTimeSegmentBounds`) **et** de la plage de toutes les phases
`Planning_Projet` (dateBounds du builder, via `computePlanningPhaseBounds` +
`unionDateBounds` dans `main.js`), afin qu'une tâche dont les phases tombent hors
du prévisionnel reste visible et navigable — et un segment du pane bas posé plus
tôt que la première tâche ouvre la frise jusqu'à son mois. Quand un lissage est
actif, s'y ajoutent les **mois des tâches lissées** (`smoothing.getSmoothedBounds()`) :
un mois de départ passé peut avancer des tâches bien avant le planning, et la
frise s'ouvre jusqu'à elles, au chargement comme juste après un enregistrement
(elle s'élargit alors sans jamais rétrécir). La fenêtre visible se déplace
librement dans ces bornes (toolbar / molette-zoom sur l'axe / glisser) et
s'ouvre au maximum sur **5 ans** (`viewport.maxVisibleDays` = 1826 jours ; c'était
14 mois jusqu'au 2026-10-26). Le dézoom s'arrête à l'**étendue des données** :
jamais de fenêtre qui déborde des bornes, une fenêtre plus large est ramenée
exactement sur elles (`sync/viewportMath.clampToBounds`). Un projet long (ou
lissé loin en arrière) se dézoome donc sur plus d'un an, un projet court sur sa
seule durée.

## Pane haut = rendu Planning Projet exact (lecture seule, colonne Tâche)

Le pane haut reproduit **exactement** le planning de `Planning Projet` : mêmes
phases (coffrage/armature/NDC/coupes/démolition/générique + démarrage), mêmes
couleurs, **états réalisé/retard** (bandes `phase-past`, styles inline de retard),
en-têtes de zone et info-bulles. La **partie passée / en cours** d'un segment est
coloriée comme dans Planning Projet : le builder scinde chaque phase à
l'**instant courant** (`createSplitPhaseItems` / `getCurrentInstant`), la portion
écoulée prenant la classe `phase-past` (plus foncée) et la portion en cours/à
venir la couleur normale. Les deux moitiés tiennent sur **une seule ligne** (une
barre continue dont la couleur change au niveau du trait rouge) : le stacking vis
est désactivé (`stack:false`) et tous les items `.vis-range` ont une **hauteur
fixe** (comme Planning Projet), sinon la moitié « passée » (label vide) serait
écrasée ou poussée sur une 2ᵉ ligne. Un **trait rouge vertical « aujourd'hui »**
(`showCurrentTime` / vis `.vis-current-time`, comme Planning Projet) marque cette
frontière, **uniquement sur le premier planning** (pane haut). Il
**réutilise le vrai builder** de Planning
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

La bande **« Données d'entrées »** (réception) n'est **plus affichée** (retirée à
la demande) : `main.js` ne fournit plus le lookup de réception au renderer, donc
le builder ne crée aucune bande. Le module
`assets/js/services/referenceReception.js` (lecture `References2`, liaison des
lignes planning à leurs documents **bloquants**) reste présent mais **non câblé**,
au cas où la bande serait réactivée.

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

#### Fluidité (2026-10-27)

Mesuré dans Chrome sur l'export réel d'ERA QUAI D'ORSAY (190 tâches, 14
personnes sur 2 ans) : le glisser en zoom année passait à **18 images/s** (pires
images 0,5 s), la molette à **12 images/s**. Causes et remèdes :

- **Glisser au pixel près.** Le glisser s'arrondissait au jour : en zoom mois la
  frise avançait par sauts de ~44 px, en zoom semaine de ~200 px. La fenêtre
  porte désormais une **fraction de jour** (`offsetDays`, à côté de
  `firstVisibleDate` qui reste un jour entier) que les deux panes et le graphique
  appliquent ; elle est gardée au relâcher, et tombe à 0 en butée (la fenêtre
  s'arrête pile sur un jour, jamais au-delà des bornes). Toolbar et changement de
  zoom repartent d'un jour entier.
- **Le pane bas ne se reconstruit plus pendant un glisser.** Il dessine, dès
  l'appui, une **marge** d'une fenêtre de chaque côté (plafonnée à 400 jours et
  aux bornes de la frise), puis **décale** ses pistes (`transform`, un calque par
  piste pendant le geste) ; il ne redessine que si la marge est épuisée, et une
  fois au relâcher pour retrouver la fenêtre exacte (`bottom/chargeBoard.js`,
  « plage dessinée »). Les cellules de la grille gardent la largeur visible et
  coupent le reste.
- **Plus de bridage à 120 ms.** Chaque rendu du pane bas coûtait 120 à 430 ms
  (tout se recalculait à chaque pixel), le bridage ne servait donc jamais et,
  une fois le rendu allégé, il laissait le pane bas à ~8 images/s derrière le
  pane haut. Ce qui ne dépend que des données (jours effectifs, disponibilité
  après absences, surcharge, tâches par barre, charge du projet) est calculé une
  fois par changement de données ; la recherche des créneaux d'une barre est
  dichotomique ; les week-ends sont **un seul dégradé** répété (les fériés en
  semaine et les absences restent des cases, une par suite de jours). Le pane bas
  est redessiné dans la frame du contrôleur, la même que vis.
- **Les deux panes dans la même image.** vis-timeline redessine dans sa propre
  frame : pendant un geste, il reçoit la fenêtre dans l'événement même, pour
  redessiner dans la frame où le pane bas bouge (il avait une image de retard).
  Hors geste (chargement d'un projet, toolbar), rien ne change : au chargement,
  `#ps-main` est encore masqué et vis, servi en largeur nulle, écrasait le pane
  haut.
- **Molette proportionnelle et ancrée.** 10 % de jours par cran de 100 px
  (comme avant pour une souris), un pavé tactile zoome par petites touches au
  lieu de sauter de 10 % à chaque événement ; le jour sous le curseur, lu dans la
  zone de la frise (hors colonne des noms), reste sous le curseur.
- **Couloirs de barres stables.** Le couloir (1ʳᵉ ou 2ᵉ ligne) d'une barre et le
  nombre de couloirs d'une personne se calculent sur tous ses segments, plus sur
  les seules barres visibles : quand la fenêtre bouge, les barres ne changent
  plus de couloir et les lignes ne grandissent ni ne rétrécissent plus de 12 px
  (une personne aux mois contigus a toujours deux couloirs, même quand une seule
  barre est visible).
- **Mode Editer gardé.** Un zoom ou un glisser redessine le pane bas avec le mode
  qu'il affiche (posé par `bottom/chargeEditing.js`) ; il revenait sur
  « Editer » alors que l'édition restait active.

Au relâcher, les libellés des mois coupés aux bords (pastilles, barres), qui ont
glissé avec leur mois pendant le geste, reviennent au bord de la fenêtre.

Après : glisser **56 à 60 images/s** à tous les zooms, les deux panes calés à
moins d'1 px image par image ; molette ~51 images/s. Le coût restant est le
redessin de vis-timeline lui-même (191 lignes). Tests :
`tests/fluidity.test.mjs`.

Le segment **démarrage de travaux** est rendu **exactement comme Planning
Projet** — un marqueur vert clair (`#dcfce7` / `#86efac`, contenu transparent de
largeur nulle) à pleine hauteur de ligne — produit pour les armatures (toujours)
et coffrages liés au planning ; il est simplement **retiré du mode « Rassembler
visuellement le planning »** (agrégat par `Type_doc`, dont l'info-bulle HTML
liste **toutes les tâches** composant un segment). En mode agrégé, chaque type
de document tient sur **une seule ligne** : le stacking vis est désactivé
(`stack:false`) pour que deux segments de même type dans des périodes proches
restent **fusionnés visuellement** sur la même ligne (au lieu d'être poussés sur
une 2ᵉ ligne quand leurs boîtes tombent dans la marge de stacking au dézoom ;
les phases réellement chevauchantes sont déjà unies en une barre par
`aggregatePlanningItems`). Le mode non-agrégé garde le stacking (les phases /
bande de réception d'un même enregistrement peuvent légitimement partager sa
ligne). La **colonne de gauche**
(tâches) est **teintée par type de document** comme dans Planning Projet
(coffrage, NDC, coupes, démolition, générique ; armature sans teinte). Le **pane
bas** affiche **toutes les personnes** liées au projet (`ProjectTeam`), même sans
`TimeSegment`, comme `gestion-depenses2`, et se termine par une **ligne « Total »**
identique à celle de `gestion-depenses2` : une piste en lecture seule
(`bottom/chargeBoard.js` — port de `renderTotalRow` / `renderReadonlyTrack`) qui
montre, **par mois visible**, le total des **jours‑personne effectifs** planifiés
tous collaborateurs confondus (barre de remplissage proportionnelle + « X j »),
avec le **total général** dans la cellule de nom. Chaque **ligne de rôle**
(« Projeteurs », « Ingenieurs », « Autres ») porte de même le **total du rôle**
à droite de son nom et, par mois visible, une pastille des jours planifiés de
ses seules personnes (`renderRoleRow`, même calcul et même pastille que la
ligne Total). Une pastille s'élargit toujours au moins à sa valeur (« 5 j »,
jamais « 5 » rogné), dans la limite de son mois.

### Projet sans aucun `TimeSegment`

Ce que le pane bas affiche ne dépend **pas** de l'existence d'un segment, mais de
ce qu'il y a à montrer (`bottom/chargePaneState.js`, règles pures partagées par le
chargement initial et le rafraîchissement post-écriture) :

- **des personnes dans `ProjectTeam`** → leurs pistes s'affichent, vides, prêtes à
  recevoir un premier segment ; le message « Aucun prévisionnel pour ce projet. »
  ne s'affiche **pas** (il parle des personnes, pas des segments) ;
- **aucune personne mais des lignes `Planning_Projet`** → la grille reste rendue,
  pour la ligne **Charge** et son bouton, seul point d'entrée de la fenêtre
  d'assignation des charges de référence ; le message s'affiche ;
- **ni l'un ni l'autre** → le pane bas est masqué.

Les **bornes de la frise** sont l'union du prévisionnel et des phases du planning ;
sans ni l'un ni l'autre, elles s'ouvrent sur **aujourd'hui ± 1 an** et la fenêtre
s'ancre sur aujourd'hui — sinon elles se refermaient sur le mois par défaut
lui-même, rendant tout déplacement impossible. La fenêtre initiale fait **~1 an**
dans tous les cas (`APP_CONFIG.initialWindowDays`).

> Auparavant, un projet sans le moindre segment se rendait **entièrement vide** :
> `loadProject` passait `workers: []` au board. Aucune piste à cliquer, donc aucun
> moyen de créer le premier segment depuis ce widget — il fallait aller le poser
> dans `gestion-depenses2`, après quoi toute l'équipe apparaissait d'un coup.
> Fixtures de non-régression : `TEST SANS PREVISIONNEL` et `TEST EQUIPE SEULE`
> (`dev/fixtures.js`).

À la sélection d'un projet, le pane haut est **remis en haut** (première ligne) —
`planningRenderer.scrollToTop`, ré‑appliqué sur les frames suivantes car vis peut
ré‑ajuster son scroll après son propre redraw.

Aucun segment ne s'affiche **hors de la chronologie visible** : le renderer ne
pousse dans vis que les items proches de la fenêtre courante. vis-timeline laisse
un item **trop loin** hors-fenêtre **non positionné** (sans `transform`), donc
collé au **bord gauche** de la frise (`left:0`) — une bande « Données d'entrées »
avant sa phase, ou (au **dézoom max**) un segment dont la vraie date est loin à
droite. Le seuil de vis est **en pixels** : la marge de filtrage l'est donc aussi
(`WINDOW_ITEM_BUFFER_PX`, convertie en marge temporelle via la largeur du jour
courante), au lieu d'une marge proportionnelle à la fenêtre qui **grandit au
dézoom** et ré-inclut justement ces items lointains (le fantôme réapparaissait au
zoom max). On garde ainsi les items **juste** hors écran (que vis positionne)
mais on retire ceux assez loin pour être non-positionnés. `align:'center'` empêche
en plus l'épinglage du **contenu** d'un item à cheval sur le bord. Les bornes de
la frise couvrent les **phases** (union avec `TimeSegment`) mais **pas** les
bandes de réception, pour ne pas étirer la frise vers la gauche jusqu'à une bande
isolée.

À l'arrivée sur un projet, le pane haut est **remis en haut** de la liste
(`planningRenderer.scrollToTop`) et la police de la **colonne de gauche** est
réduite pour tenir plus de tâches à l'écran.

### Vue « Graphique » (premier planning)

Dès que le projet a au moins une tâche que le planning dessine, un sélecteur
**Planning / Graphique** apparaît au-dessus du pane haut — que la case
**« Rassembler visuellement le planning »** soit cochée ou non : le graphique ne
dépend plus de ce mode. **Graphique** **remplace** la timeline par un graphique en
**courbes** (`top/planningChart.js`) utilisant **Chart.js** — la **même
technologie** que la section « Graphique des dépenses » de `gestion-depenses2`
(`assets/js/ui/chart.js`). Il trace, par mois ou par semaine (**Regrouper par :
Mois | Semaine**), le **nombre de tâches à réaliser** avec **une ligne par type
de document** (Coffrage / Armature / NDC / Coupes / Démolition / Autres) **et
une ligne Total**. **Chaque ligne est doublée d'une ligne en pointillé
« (réalisé) »** montrant, aux mêmes dates, le sous-ensemble de ces tâches
**réalisées à 100 %**.

**Une tâche est datée comme la barre dessinée** (`top/taskLoadModel.js`) : le
graphique ne relit plus les colonnes brutes `Date_limite` / `Diff_coffrage` /
`Diff_armature` / `Realise`. Il prend ses tâches dans la sortie du constructeur
vendorisé, celui qui dessine le pane haut, qui **recalcule** les dates comme
Planning Projet (coffrage lié à MS Project : `Demarrages_travaux` − `Duree_3`
semaines ; coffrage de groupe : plus petite `Diff_coffrage` des armatures du
groupe ; début = fin − `Duree_1` semaines) :

- **échéance** = date de fin de la barre principale de la ligne ;
- **type** = celui de la barre (`phase-generic` → Autres) ;
- **réalisé** = état réalisé de la barre (indice, indice cible de
  `Projets2.Avancement`, `Date_Cloture`), et non la colonne `Realise` stockée.

Une ligne que le planning ne dessine pas (pas de type, dates manquantes) n'est pas
une tâche. Effet visible : pour les lignes dont les colonnes brutes ne suivent pas
les dates recalculées, les courbes ont légèrement changé ; elles collent
désormais au planning. Le lissage (section suivante) part de ces mêmes tâches.

Son axe des temps est **coordonné avec la frise** (mêmes dates visibles que le
pane bas ; `min`/`max` = fenêtre courante), donc il **suit le zoom et le
déplacement** du planning (chaque viewport appliqué est transmis via
`onRangeLabel` -> `planningChart.setViewport`).

**Calage horizontal sur le planning du bas** — même contrat que la section
« CRITICAL: left-column alignment » de `assets/css/styles.css` : la zone de
tracé démarre exactement à `--ps-left-col-width` du bord du pane, comme les
colonnes Projeteurs / Ingénieurs. Le montage est structurel, pas laissé à la
mise en page automatique de Chart.js :

- `#ps-chart` est un flex : **colonne légende** de
  `--ps-left-col-width - --ps-chart-axis-width` puis le canvas ;
- l'**axe Y est épinglé** à `--ps-chart-axis-width` (`scales.y.afterFit`), donc
  légende + axe = `--ps-left-col-width` et `chartArea.left` est déterministe ;
- `layout.autoPadding: false` + `padding` horizontal nul +
  `scales.x.afterFit` remettant `paddingLeft/Right` à 0 : sans cela Chart.js
  réserve une marge (mesurée à 8 px à droite) pour ne pas rogner les libellés
  d'extrémité, ce qui décale le tracé ;
- `min`/`max` couvrent des **journées entières** (`getChartWindowBounds` :
  `firstVisibleDate 00:00` -> `rangeEndDate + 1 jour 00:00`), comme
  `sync/viewportMath.getDayBoundaryLeftPx` ;
- les points sont au **vrai milieu** de leur bucket et les **traits verticaux
  tombent sur les frontières** de bucket (1er du mois / lundi), via
  `scales.x.afterBuildTicks`.

Écart mesuré sur les trois zooms : **0 à 0,23 px** (le résidu vient des semaines
de changement d'heure — l'axe est linéaire en millisecondes alors que la frise
donne à chaque jour calendaire la même largeur).

La **chronologie reste
navigable** dans la vue graphique : molette = zoom, **glisser sur le graphique =
déplacement** (`controller.bindPan(#ps-chart)`), toolbar semaine/mois/année — les
deux panes bougent ensemble. Sa hauteur suit le splitter (même hauteur que la
timeline remplacée).

**Filtre par cases à cocher** (`#ps-chart-filter`, au-dessus du graphique) : une
case **par type de document présent** dans le projet (+ Total), toutes cochées au
départ. Décocher un type **masque** toutes ses lignes (pleine, « réalisé » et,
en mode « Les deux », « avant lissage »), le cocher les ré-affiche ; on affiche
donc uniquement les types voulus. Le filtre est conservé au **zoom /
déplacement** (ré-appliqué à chaque reconstruction des séries) et au
**rechargement du même projet et du même service** (un collègue modifie le
planning : la vue en cours, le regroupement Mois / Semaine et le filtre restent
tels quels, un type nouveau arrive coché). Il se réinitialise (tout coché) au
changement de projet ou de service, qui ramène aussi sur la vue Planning.

**Légende** (`#ps-chart-legend`, colonne de gauche du graphique) : la légende
intégrée de Chart.js est désactivée (`plugins.legend.display: false` — placée en
bas, sa hauteur rognait le tracé) au profit d'une liste HTML verticale dans la
colonne de gauche, à la même largeur que la colonne des noms du planning du bas.
Elle porte le titre de l'axe Y (« Tâches à réaliser », sorti du canvas où il
consommait une partie de la bande d'axe) et rappelle la convention du mode
affiché (plein / pointillé, plus « pâle = avant lissage » en mode « Les deux »).
Elle est **en lecture seule** : le filtre ci-dessus pilote la visibilité, et la
légende **grise** (`.is-off`) les types décochés.

**Clic sur le graphique** : un clic **sans glisser** ouvre la liste des tâches
du mois (ou de la semaine) sous le pointeur — voir « Lissage des tâches »
ci-dessous.

### Lissage des tâches (vue Graphique)

Le graphique montre des **pics** (8 tâches en avril, 0 en mars). Le lissage
fixe un **nombre maximum de tâches par mois**, en général et/ou par type de
document, et calcule un **planning lissé** dans lequel les tâches en trop sont
**réalisées plus tôt, jamais plus tard** : aucune tâche lissée n'est en retard
sur sa date réelle. C'est un **planning cible** : il ne modifie **aucune date**
de `Planning_Projet`. Seuls les maximums sont enregistrés (`Projets2.Lissage`) ;
le lissé est **recalculé à chaque affichage** à partir des maximums et du
planning courant (`top/taskSmoothing.js`, pur et testé, dont un fuzz des règles
strictes).

**Vocabulaire.** Le **mois courant** est celui de la date du jour (horloge du
navigateur). Le **mois de départ** est le premier mois où une tâche peut être
placée : le mois courant par défaut, ou un mois passé choisi dans la fenêtre
(« Lisser à partir de »). Une tâche est **figée** si elle est réalisée ou si son
échéance tombe dans un mois passé (en retard) : elle garde son mois et y compte,
quel que soit le mois de départ. Les autres, **à venir**, sont **mobiles**. Les
maximums valent **par mois**, même quand le graphique est regroupé par semaine ;
un **mois particulier** peut avoir ses propres maximums (voir les réglages).

**Règles strictes** (jamais enfreintes) :

1. **Jamais plus tard** : le mois lissé d'une tâche est son mois d'origine ou un
   mois antérieur.
2. **Jamais avant le mois de départ** ; quand le départ est le mois courant (par
   défaut), jamais non plus à une date antérieure à aujourd'hui. Avec un départ
   passé, les mois passés à partir de lui reçoivent des tâches à venir, même
   s'ils sont vides.
3. **Les tâches figées ne bougent pas.**
4. **Armature après son coffrage** : l'échéance lissée d'une armature n'est
   jamais antérieure à celle d'un coffrage non réalisé de son groupe (même Zone
   et même Groupe). Une armature qui doit avancer avant son coffrage **entraîne
   le coffrage** : il part dans le mois le plus tardif, au plus celui de
   l'armature, où il tient sous ses propres maximums, et il est marqué « avancé
   pour libérer l'armature N° … ». Si le coffrage ne trouve pas de place,
   l'armature reste (raison « coffrage sans place »). Un coffrage réalisé ne
   contraint plus rien ; un coffrage en retard ne bouge pas mais contraint
   toujours (une armature ne passe jamais avant lui).
5. **Une tâche n'est avancée que là où elle tient** : le mois qui la reçoit
   respecte, après lissage, le maximum de **son type** et le **maximum
   général** de **ce mois**. Une tâche sans place reste dans son mois d'origine.
6. **Déterministe** : mêmes tâches, mêmes maximums, même mois courant → même
   résultat.

**Préférences**, dans l'ordre : laisser le moins de tâches possible au-dessus
des maximums ; un dépassement impossible à résorber reste dans le mois le plus
tardif (son mois d'origine), et la place libre va au **premier** mois débordant ;
avancer **le moins possible** (le mois le plus tardif où la tâche tient) ;
conserver l'**ordre chronologique** dans la file soumise au maximum qui déborde
(une file unique quand seul le maximum général existe, une file par type dès
qu'un maximum par type existe) ; à échéance égale, ordre par N° (`ID2`) puis par
identifiant de ligne. La première préférence est **visée, pas garantie** : le
calcul se fait en une passe, et dans de rares cas il laisse un dépassement qu'un
déplacement en chaîne aurait résolu. Il est alors signalé ; aucune règle stricte
n'est enfreinte.

**Date lissée** : une tâche avancée de N mois garde **son jour du mois**
(12 avril → 12 mars ; 31 mai → 30 avril) ; quand le lissage part du mois
courant, une date déjà passée dans le mois courant devient **aujourd'hui** (avec
un départ passé, le jour est gardé) ; une armature ne prend jamais une date
antérieure à l'échéance lissée de son coffrage. Une tâche non avancée garde sa
date.

**Dépassements restants**, rapportés par mois et par série (type ou Total),
chacun avec le maximum de son mois et sa raison : **mois en cours** (lissage
parti du mois courant : impossible d'avancer avant lui), **tâches réalisées**
(les tâches figées dépassent déjà le maximum), **tâches réalisées ou en retard**
(un mois passé déjà plein, avec un départ passé), **plus de place avant** (tous
les mois antérieurs, jusqu'au mois de départ, sont pleins), **coffrage sans
place**. Les mois d'avant le mois de départ ne sont ni lissés ni signalés.

**Pourquoi les tâches en retard restent à leur place** (essai sur l'export
d'ERA QUAI D'ORSAY du 2026-10-26, maximum 4 partout) : mobiles, elles
prendraient d'abord les places libres des mois passés et rien ne se libérerait
pour les mois à venir (39 tâches en trop à partir d'octobre 2026, quel que soit
le départ jusqu'à janvier 2026). Figées, elles comptent sans bouger : 30 tâches
en trop avec un départ en janvier 2026, 3 avec un départ en juin 2025.

#### Réglages : bouton « Lisser… » et colonne `Projets2.Lissage`

Le bouton **« Lisser… »** n'apparaît qu'en vue Graphique ; il porte une marque
« actif » quand un lissage est défini pour ce projet et ce service. Il ouvre la
fenêtre **« Lissage des tâches — <Projet> · <Service> »**
(`top/smoothingModal.js`) :

- **Lisser à partir de** : « Mois en cours (…) » par défaut, ou un mois passé,
  jusqu'à 5 ans avant la première échéance du projet (des mois vides) ;
- **Maximum général (tous types)** et **un champ par type présent** dans le
  projet, avec le **pic actuel** du type (plus grand nombre de tâches non lissées
  sur un mois à venir, mois courant inclus) pour aider à choisir ; ces valeurs
  valent pour **tous les mois** ;
- **Mois particuliers** : « Ajouter ce mois » ajoute une ligne (Total + une
  colonne par type) dont les cases **remplacent**, pour ce mois seulement, les
  maximums de tous les mois ; une case vide reprend la valeur de tous les mois
  (rappelée en grisé) ; « N tâches prévues » donne la charge du mois avant
  lissage ; ✕ retire le mois ;
- valeurs : **entier ≥ 1**, ou **vide** = pas de maximum ; une saisie invalide est
  signalée sur le champ et bloque « Enregistrer » ;
- **0 pour un mois particulier** (2026-10-27) : une case d'un mois particulier
  accepte **0** — aucune tâche ce mois-là (case Total), ou aucune de ce type
  (case d'un type). Ses tâches **à venir** sont avancées dans les mois d'avant,
  là où elles tiennent, et aucune tâche n'y est avancée, même s'il est vide. Les
  tâches figées (réalisées, en retard) y restent, et le mois est alors signalé en
  dépassement avec sa raison (« tâches réalisées », « mois en cours » quand le
  lissage part du mois courant, « plus de place avant »). Un 0 n'est pas permis
  dans les maximums de tous les mois : il n'y laisserait aucune tâche nulle part ;
- **Aperçu** recalculé à chaque saisie : nombre de tâches avancées, dépassements
  restants et leur raison, tableau **Avant / Après** des mois qui changent ou
  restent en dépassement ;
- **Enregistrer** écrit la cellule puis, si un maximum subsiste, passe le
  graphique en « Les deux » pour montrer l'effet ; **Supprimer le lissage** (après confirmation) retire
  l'entrée du service ; **Échap**, « Fermer » ou « Annuler » ferment sans rien
  écrire ;
- **lecture seule** quand le service affiché n'est pas votre service de
  rattachement (`GristServiceContext.isReadOnly()`) : la fenêtre s'ouvre en
  consultation, champs et boutons d'écriture désactivés.

La colonne **`Projets2.Lissage`** est une colonne **texte**, à **créer à la
main** dans Grist (document de test, puis prod). Elle contient un JSON, **une
entrée par service** (comme `Projets2.Avancement`) :

```json
{"version":1,"services":{"Structure":{"maxTotal":4,"maxParType":{"COFFRAGE":2,"ARMATURES":2}}}}
```

- clés de type : `COFFRAGE`, `ARMATURES`, `NDC`, `COUPES`, `DEMOLITION`,
  `AUTRES` ; une clé absente = pas de maximum pour ce type, `maxTotal` absent =
  pas de maximum général ; un service sans aucune valeur n'a pas d'entrée (pas de
  lissage) ;
- deux clés facultatives : `"debut":"2025-06"` (mois de départ ; absent = mois
  courant) et `"parMois":{"2027-03":{"maxTotal":10,"maxParType":{"ARMATURES":6}}}`
  (maximums d'un mois précis, même forme ; une valeur absente reprend celle de
  tous les mois ; `0` = aucune tâche, ou aucune de ce type, ce mois-là ; un mois
  sans valeur n'est pas écrit). Une version du widget qui ne les connaît pas les
  ignore et lisse avec les seuls maximums de tous les mois ; une version
  d'avant le 2026-10-27 ignore aussi un `0` de mois (avec un `console.warn`) ;
- lecture **tolérante** (`top/smoothingSettings.js`) : cellule vide, JSON
  illisible, valeur non entière ou < 1 (< 0 pour un mois précis) → ignorée avec un `console.warn`, jamais
  de plantage du graphique ; un enregistrement ultérieur réécrit une cellule
  propre ;
- **colonne absente** (la prod tant qu'elle n'est pas créée) : le bouton
  « Lisser… » est grisé avec l'explication « Ajoutez une colonne texte « Lissage »
  dans Projets2 pour activer le lissage. » ; le reste du graphique fonctionne ;
- projet sans tâche datée : bouton grisé, « Aucune tâche à lisser » ;
- **écriture** : la cellule est **relue juste avant** d'écrire, seule l'entrée
  du service courant est remplacée (les autres services sont conservés tels
  quels), en **une seule** `UpdateRecord` sur la colonne `Lissage`
  (`updateProjectSmoothing`). L'écran de celui qui enregistre se met à jour tout
  de suite, sans rechargement. En cas d'échec, un message s'affiche dans la
  fenêtre et la saisie est gardée.

La cellule est **relue à chaque chargement de projet** (`fetchProjectRow`, en
même temps que les données du projet), jamais prise dans l'instantané de
`Projets2` du démarrage ; un changement de service relit l'entrée du nouveau
service.

#### Modes « Non lissé / Lissé / Les deux »

Le groupe **« Afficher »** n'apparaît que lorsqu'un lissage est défini :

- **Non lissé** : le graphique d'avant (trait plein = toutes les tâches,
  pointillé = réalisées) ;
- **Lissé** : le même graphique, calculé sur les **dates lissées** ;
- **Les deux** : pour chaque série cochée, trait plein = **lissé**, trait **pâle
  et fin** de la même couleur = **avant lissage** ; les tâches réalisées ne
  bougeant jamais, une seule courbe en pointillé « réalisé » est tracée.

Le choix est **mémorisé par navigateur** (`localStorage`,
`planning-synchro.smoothing-view`, « Les deux » par défaut), pas dans Grist. Le
filtre par type s'applique aux trois modes.

#### Fenêtre « Tâches du mois »

Un **clic** sur le graphique (`top/monthTasksModal.js`) ouvre la liste des tâches
du **seau** sous le pointeur : le mois, ou la semaine si le graphique est
regroupé par semaine. **Un glisser n'ouvre jamais la liste** : au-delà de 4 px
parcourus, le geste est un déplacement de la frise. Le geste est reconnu sur le
document, en capture, parce que le panoramique (`bindPan(#ps-chart)`) capture le
pointeur et arrête la propagation : le canevas lui-même ne reçoit rien.

- Seuls les **types cochés** sont listés (seul « Total » coché → tous les
  types) ; plusieurs types → **une section par type** (ordre et couleur du
  graphique, avec le compte), un seul type → une liste simple ; tri par date
  puis par N°.
- Une ligne : date (lissée en mode lissé), N° (`ID2`), nom, zone et groupe,
  **pourcentage d'avancement** (le même que la colonne « Réalisé » de Planning
  Projet : indice du document face à l'indice cible du projet, recalculé par le
  constructeur vendorisé — `ChartTask.progress`), « réalisation forcée le … »
  pour une clôture forcée, « avancée de <mois> (<date d'origine>) », « avancé
  pour libérer l'armature N° … ». Une tâche **réalisée** (100 %) est **en vert**
  (fond vert pâle, liseré, texte `#15803d` comme une ligne réalisée de Planning
  Projet).
- Quand un lissage est défini, l'en-tête de section rappelle le compte face au
  maximum (« Armature (3 / 2) ») et un mois resté en dépassement l'affiche en
  avertissement, avec sa raison.
- **Non lissé** : tâches dont l'échéance d'origine tombe dans le seau ;
  **Lissé** : échéance lissée ; **Les deux** : comme Lissé, plus une section
  **« Parties plus tôt »** (tâches avancées hors du seau, avec leur mois
  d'arrivée).
- Seau vide : « Aucune tâche à réaliser sur cette période. » ; la fenêtre est
  en lecture seule.

#### Rechargement, autres utilisateurs

- **Pas de mise à jour en direct chez les collègues.** Le relais de
  synchronisation (`ProjectMutationSyncConfig` de `index.html`) ne signale pas
  les écritures dans `Projets2` : un lissage enregistré par un collègue apparaît
  quand on **rouvre ou resélectionne le projet**. Si un signal `Projets2` arrive
  malgré tout (relecture du catalogue après une autre écriture), la cellule
  relue est comparée à celle en mémoire et le graphique est redessiné si elle a
  changé — jamais de rechargement complet pour autant. Une saisie manuelle dans
  la grille Grist est prise au chargement suivant du projet.
- **Rechargement du même projet et du même service** (une date ou un avancement
  modifié ailleurs) : le lissé est recalculé sur le nouveau planning ; la vue en
  cours, le mode, le regroupement et le filtre restent ; la fenêtre « Lissage »
  garde la saisie en cours et recalcule son aperçu ; la fenêtre « Tâches du
  mois » se rafraîchit.
- **Changement de projet ou de service** : les deux fenêtres se ferment et le
  pane haut revient sur la vue Planning.

Branchement : le contrôleur `top/smoothingController.js` est créé **une seule
fois** par `main.js` (hors du cycle par projet, pour que les fenêtres survivent
au rechargement) ; `loadProject()` lui remet les tâches (`buildChartTasks`), la
ligne `Projets2` relue et la clé de contexte `projet|service`, et le graphique
trace ce qu'il renvoie (`getChartInput()`).

## Mode Editer du pane bas : un segment = un mois

Le bouton du pane bas bascule entre **Editer** et **Verrouiller**
(`bottom/chargeEditing.js`) ; hors mode Editer, un clic sur une piste n'a aucun
effet et le menu contextuel ne s'ouvre pas. Le mode est **collant** : il est
ré-appliqué après chaque écriture, parce qu'un rafraîchissement (`onChanged()`)
remplace tout le HTML du board.

**Le geste : un clic = un mois entier.** Il n'y a **ni glisser-créer, ni
poignées de redimensionnement, ni sélection au demi-jour** — un segment couvre
toujours l'intégralité de son mois. Le clic gauche sur une piste résout le mois
sous le curseur (la barre cliquée, si elle en porte une, fait foi via son
`data-month-key` ; sinon le créneau-jour sous le pointeur donne le mois), puis :

- mois **libre** → ouverture de la fenêtre en **création** ;
- mois **déjà occupé** → ouverture de la fenêtre en **édition** de ce segment.

C'est cette règle (`resolveSegmentClickIntent`) qui tient l'**unicité (projet,
personne, mois)** : un mois occupé se ré-édite, il ne se double jamais. Le
contrôle de chevauchement de l'ancien modèle a disparu — il n'a plus d'objet.
Un segment dont l'id n'est pas exploitable (id de synthèse `s-N`, quand la
colonne `id` manque) est **ignoré** plutôt que dupliqué.

**La fenêtre** (`bottom/editSegmentModal.js`, `#ps-edit-segment-modal`, même
contenu que `#edit-segment-modal` de `gestion-depenses2`) s'intitule **« Segment
mensuel »**. Le **mois et la personne** y sont en **lecture seule** (ils
viennent du clic) ; le seul champ saisissable est **« Jours effectifs
travaillés »**, en regard de **« Jours disponibles dans le mois »** — jours
ouvrés du mois (week-ends **et** jours fériés exclus) **moins les demi-journées
d'absence** de la personne (`Time-Out`), recalculés en direct.

Validation avant écriture (`validateEditSegmentEffectif`) : la valeur est
**obligatoire**, **strictement > 0** et **multiple de 0,5**. Elle n'est **pas**
plafonnée : saisir plus que le disponible reste enregistrable, le champ passe
simplement en `is-over-available` et la barre devient rouge (`is-incoherent`)
avec l'info-bulle « Effectif X j > disponible après absences Y j ».

**Rien n'est écrit dans Grist tant que la fenêtre n'a pas été validée** :
« Enregistrer » déclenche `createTimeSegment` (mois libre) ou
`updateTimeSegment` (mois occupé), puis un `onChanged()` qui re-fetch et
re-rend. Un **verrou d'écriture partagé** au niveau module interdit toute
seconde soumission tant que la première est en vol — y compris à travers un
changement de projet, qui détruit et recrée la fenêtre, et qui rendrait sinon un
verrou neuf permettant deux `AddRecord` sur le même (projet, personne, mois).
Un **délai de garde de 30 s** (`SUBMIT_STALL_TIMEOUT_MS`) rend la fenêtre
fermable si l'écriture ne répond jamais, avec un message explicatif, mais sans
relâcher le verrou d'écriture.

Le **clic droit** sur un segment ouvre le menu contextuel **Modifier** /
**Supprimer le segment** : **Modifier** rouvre exactement la même fenêtre,
amorcée depuis la barre visée ; **Supprimer le segment** appelle
`removeTimeSegment` (comme `gestion-depenses2`, sans confirmation). `Echap`, un
clic hors du menu ou la sortie du mode Editer referment le menu.

## Migration `TimeSegment` : créer et remplir la colonne `Mois`

À faire **à la main dans Grist**, sans formule.

1. **Créer la colonne `Mois`** dans `TimeSegment`, de type **Date**.
2. **La remplir** avec le **1er jour du mois** du segment (`01/09/2026` pour
   septembre 2026). Le widget ne lit que l'**année et le mois** de cette date,
   mais garder le 1er évite toute ambiguïté et correspond à ce que les widgets
   écrivent eux-mêmes (`toGristMonthValue`).
3. Une fois toutes les lignes reprises, `Start_At` et `End_At` peuvent être
   **supprimées de la table** quand tu le juges bon. Rien ne les écrit plus.

**Repli sur `Start_At`** — une ligne sans `Mois` reste lue : le mois est alors
déduit de `Start_At` (`resolveSegmentMonthKey` dans `utils/monthSegments.js`).
Ce repli est **inerte sans erreur** le jour où la colonne disparaît : la cellule
vaut `undefined`, la résolution renvoie `""`, et la ligne est simplement écartée
du rendu. Aucun message, aucun plantage.

> ⚠️ **Une ligne legacy multi-mois s'effondre sur son mois de début.** Un
> segment `Start_At = 15/09/2026`, `End_At = 20/01/2027` est lu comme un segment
> de **septembre 2026 uniquement** : **tout son effectif est compté dans ce seul
> mois**, et les mois d'octobre à janvier n'en voient plus rien. C'est inhérent
> au repli (une seule date lue, aucune répartition), mais c'est une **perte de
> données visible**. Ces lignes-là doivent être **éclatées manuellement en un
> segment par mois** — c'est le seul cas où la reprise ne peut pas se faire par
> simple recopie.

**Effet attendu dans `Gestion-User`** : certains pourcentages d'occupation vont
**baisser**. Ce widget proratisait auparavant `Allocation_Days` ; une ligne à
`Effectif` vide y comptait donc une charge, alors qu'elle comptait déjà **0
jour** dans `gestion-depenses2`. Désormais `Effectif` est **la** charge dans les
deux widgets (`buildSegments` écarte les lignes à `Effectif` ≤ 0) : ces lignes
tombent à 0 partout. Ce n'est pas une régression, c'est la fin d'une divergence
entre les deux widgets.

## Développement

Tests unitaires purs (parsing dates/décimales, modèle de phases, agrégation,
viewport, etc.) :

```bash
cd planning-synchro
node --test "tests/**/*.test.mjs"
```

Vérification visuelle/interaction (rendu vis-timeline, édition du plan de
charge, alignement des deux panes) : servir le dépôt en HTTP — les modules
ES échouent sous `file://` — et ouvrir le harnais de dev, qui charge un mock
`window.grist` (`dev/mock-grist.js`) avec des données fictives
(`dev/fixtures.js`) au lieu d'un vrai document Grist :

```bash
# depuis la RACINE du depot, pas depuis planning-synchro/
python -m http.server 8791
# puis ouvrir http://localhost:8791/planning-synchro/dev/harness.html
```

⚠️ **Servir `planning-synchro/` directement ne marche pas** :
`assets/js/top/vendor/planningRealisation.js` importe
`../../../../../shared/planning-closure-core.js`, qui sort de la racine du
serveur. Le 404 est silencieux — il casse tout le graphe de modules ES sans
lever la moindre erreur en console. Symptôme : la page se charge, mais le
sélecteur de projet reste vide et `#ps-main` reste masqué. Si tu vois ça,
vérifie d'abord depuis où tu sers.

Les écritures `TimeSegment` faites via le mock sont **appliquées aux fixtures
en mémoire** (`AddRecord` / `UpdateRecord` / `RemoveRecord`) — le harnais se
comporte donc comme un vrai Grist : créer / modifier / supprimer un segment se
reflète après re-rendu. Elles sont aussi capturées dans `window.__appliedActions`
(mêmes tuples), utile pour vérifier par script (CDP/console) que le bouton
**Editer** et la modale **Modifier** produisent bien les actions attendues sans
dépendre d'un document Grist réel.

Le mock fournit aussi un `window.GristServiceContext` minimal (service
**Structure**, jamais en lecture seule) : le lissage range ses maximums par
service. Le projet **ERA QUAI D'ORSAY** porte une cellule `Lissage` (maximum
général de 1 tâche par mois) : en vue Graphique, mode « Les deux », trois tâches
de mars et avril 2027 sont avancées en janvier, février et mars. Le balisage du
harnais (en-tête du graphique et fenêtres) doit rester identique à celui
d'`index.html`.
