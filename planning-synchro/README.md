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
bas).

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

La charge résolue est répartie sur les **mois que sa plage de dates touche**
(mois du `Demarrages_travaux` jusqu'au mois de la `Date_limite`), **au prorata
des jours ouvrés** de chaque mois. Ainsi un document de 10 jours en septembre et
octobre sera réparti selon le nombre de jours ouvrés de chaque mois. La répartition
utilise l'**algorithme du plus grand reste** pour garantir que les parts mensuelles
somment exactement à la charge d'entrée. Un document qui n'a aucune date de
planning (pas de phases) **ne peut s'attacher à aucun mois** ; sa charge apparaît
dans une figure **« non placé »** affichée sur la ligne du document.

Le **pane bas** affiche une ligne **Charge** sous la ligne **Total**. Par mois
visible, elle compare les jours *planifiés* (de `TimeSegment`, calculés comme pour
la ligne Total) contre les jours *requis* (somme des charges des documents). Trois
couleurs indiquent la tension :

- `--load-balanced` `#d7eccb` (vert clair) : jours planifiés = jours requis ;
- `--load-overload` `#ffe1a8` (beige clair) : **moins** de jours planifiés que
  requis ;
- `--load-partial` `#edf4fb` (bleu clair) : **plus** de jours planifiés que
  requis.

La charge n'est pas plafonnée : un mois peut requérir plus de jours qu'il n'en
contient.

Un **bouton Charge** sur cette ligne ouvre une **fenêtre de saisie** qui répartit
les durées sur trois niveaux : Type de document → Zone → Document. À chaque
niveau, un champ vide affiche la valeur héritée du niveau au-dessus (grisée, en
lecture seule) ; seules les valeurs **explicites** sont modifiables. L'enregistrement
écrit chaque ligne affectée en un **seul lot** d'`UpdateRecord`.

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
(1er jour du plus petit `Mois` → dernier jour du plus grand,
`top/bounds.computeTimeSegmentBounds`) **et** de la plage de toutes les phases
`Planning_Projet` (dateBounds du builder, via `computePlanningPhaseBounds` +
`unionDateBounds` dans `main.js`), afin qu'une tâche dont les phases tombent hors
du prévisionnel reste visible et navigable. La fenêtre visible se déplace
librement dans ces bornes (toolbar / molette-zoom sur l'axe / glisser) et
s'ouvre au maximum sur **14 mois** (`viewport.maxVisibleDays`).

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
avec le **total général** dans la cellule de nom.

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

Quand la case **« Rassembler visuellement le planning »** est cochée, un
sélecteur **Planning / Graphique** apparaît au-dessus du pane haut. **Graphique**
**remplace** la timeline par un graphique en **courbes** (`top/planningChart.js`)
utilisant **Chart.js** — la **même technologie** que la section « Graphique des
dépenses » de `gestion-depenses2` (`assets/js/ui/chart.js`). Il trace, par mois,
le **nombre de tâches à réaliser** (date de diffusion de la phase) avec **une
ligne par type de document** (Coffrage / Armature / NDC / Coupes / Démolition /
Autres) **et une ligne Total**. **Chaque ligne est doublée d'une ligne en
pointillé « (réalisé) »** montrant, aux mêmes dates, le sous-ensemble de ces
tâches **réalisées à 100 %** (colonne `Realise` ≥ 100).

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
départ. Décocher un type **masque** ses deux lignes (pleine + « réalisé »), le
cocher les ré-affiche ; on affiche donc uniquement les types voulus. Le filtre
est conservé au **zoom / déplacement** (ré-appliqué à chaque reconstruction des
séries) et se réinitialise (tout coché) au changement de projet.

**Légende** (`#ps-chart-legend`, colonne de gauche du graphique) : la légende
intégrée de Chart.js est désactivée (`plugins.legend.display: false` — placée en
bas, sa hauteur rognait le tracé) au profit d'une liste HTML verticale dans la
colonne de gauche, à la même largeur que la colonne des noms du planning du bas.
Elle porte le titre de l'axe Y (« Tâches à réaliser », sorti du canvas où il
consommait une partie de la bande d'axe) et rappelle la convention
plein / pointillé. Elle est **en lecture seule** : le filtre ci-dessus pilote la
visibilité, et la légende **grise** (`.is-off`) les types décochés.

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
