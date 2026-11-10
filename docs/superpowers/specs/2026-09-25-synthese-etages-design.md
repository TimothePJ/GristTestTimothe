# Spec — Étages, glisser-déposer et flèches du tableau de tâches Synthese (Planning Projet)

Date : 2026-09-25
Statut : design validé en conversation, en attente de relecture avant plan d'implémentation.
Prolonge :
- `docs/superpowers/specs/2026-09-23-synthese-taches-design.md` (tableau de tâches, modèle de
  lignes, écritures) ;
- `docs/superpowers/specs/2026-09-25-synthese-gantt-design.md` (Gantt SVG aligné sur le tableau).

## 1. Objectif

Donner à la vue Synthese le second niveau de MS Project, comme sur la capture de l'utilisateur
(« Zone Z3A » → « Jalon démarrage GO », étage « PH RDB » et ses tâches, étage « PH RDH »…) :

1. **Étages** : dans une zone, on peut créer des étages (clic droit sur la zone → « Ajouter un
   étage ») ; un étage contient des tâches ; pas d'étage dans un étage. Une zone contient donc
   des tâches et des étages, un étage seulement des tâches.
2. **Récapitulatif d'étage** : Durée / Début / Fin calculés à partir de ses tâches, avec la même
   règle que les zones.
3. **Glisser-déposer** : une tâche se déplace à la souris vers un étage, vers le niveau zone
   (hors étage), et inversement, y compris d'une zone à l'autre.
4. **Flèches** dans le Gantt : chaque tâche est reliée à la suivante de son groupe, comme sur la
   capture — dessin seul, les dates ne changent pas.
5. **File d'écritures** plus sûre (corrections laissées de côté à la fin du Gantt, incluses ici
   parce que les étages ajoutent des écritures groupées) : vérification du projet et du service
   au départ de chaque écriture, indicateur « Enregistrement… », suppressions en attente
   masquées, message d'erreur jamais remplacé par un succès en arrière-plan.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Stockage d'un étage | Une ligne Planning_Projet : `Taches` = nom de l'étage, `Etage` = true, `Zone` = sa zone, `Groupe` vide, `NomProjet`, `Service` (posé par le contexte partagé, comme d'habitude), sans dates. |
| Tâche d'un étage | `Groupe` = nom de l'étage, `Zone` = sa zone. Tâche du niveau zone : `Groupe` vide (cas de toutes les tâches existantes). |
| Hiérarchie | Zone → tâches et étages ; étage → tâches seulement. |
| Flèches | **Dessin seul** : chaque tâche datée reliée à la tâche datée juste en dessous si elles sont du même groupe. Aucune écriture, aucune colonne nouvelle. |
| Suppression d'un étage | L'étage **et ses tâches**, après une confirmation qui annonce leur nombre ; une seule écriture (tout ou rien). |
| Glisser-déposer | Partout : l'endroit où l'on lâche décide de la zone et de l'étage. |
| Prise pour glisser | Une **poignée** (⠿) à gauche du nom d'une tâche, visible au survol ; le clic sur une cellule garde son rôle (saisie). |
| Ordre | Dans une zone, les tâches hors étage en haut, puis les étages, chacun par date de début ; dans un étage, tâches par date ; le non daté à la fin de son groupe. La position d'une tâche déposée reste chronologique. |
| Git | **Aucun commit, aucun push.** |

## 3. Données (Planning_Projet)

Colonnes utilisées, en plus de celles du tableau de tâches (`Taches`, `Zone`, `NomProjet`,
`Diff_coffrage`, `Diff_armature`, `Duree_1`, `Type_doc`, `ID2`, `Service`) :

| Colonne | Type Grist | Rôle |
|---|---|---|
| `Etage` | Booléen (Toggle) | `true` : la ligne est un étage. Lecture tolérante : le booléen `true` ou le texte « true » (sans casse). Écriture : le booléen `true`. |
| `Groupe` | Texte | Nom de l'étage d'une tâche ; vide au niveau zone. |

- **Ligne-étage** : `Taches` non vide, `Type_doc` et `ID2` vides, `Etage` vrai. Ce n'est jamais
  une tâche (la reconnaissance d'une tâche exclut désormais `Etage` vrai).
- **Nouvel étage** : `AddRecord` avec `Taches`, `Zone`, `Groupe` = "", `Etage` = true,
  `NomProjet` ; pas de dates ni de durée. Des dates ou une durée éventuellement présentes sur une
  ligne-étage (saisies à la main dans Grist) sont ignorées : le récapitulatif vient des tâches.
- **Vue Structure** : elle écarte déjà les lignes-tâches du planning Structure ; elle écarte
  aussi les lignes-étages (sans quoi elles y apparaîtraient comme des documents).
- **Colonne `Etage` absente** (document pas encore mis à jour, par exemple en production) :
  détectée quand au moins une ligne du projet a été lue et qu'aucune ne porte le champ `Etage`.
  « Ajouter un étage » est alors grisé et un message l'explique : « La colonne « Etage » n'existe
  pas dans Planning_Projet : ajoutez-la (type Booléen) pour créer des étages. » Si rien ne
  permet de le savoir (projet sans aucune ligne), l'écriture est tentée et son refus par Grist
  affiche le même message.

## 4. Modèle (calcul pur)

### 4.1 Étages d'une zone

- Les étages d'une zone sont la réunion des **lignes-étages** de la zone et des **noms trouvés
  dans le `Groupe`** de ses tâches : une tâche dont l'étage n'a pas (ou plus) de ligne reste
  visible, dans un étage portant ce nom. Un tel étage « sans ligne » se renomme et se supprime
  comme les autres (seules ses tâches sont alors écrites).
- **Clé d'étage** : même normalisation que les zones (sans accents, sans casse, sans ponctuation),
  unique **dans sa zone**. Deux lignes-étages de même clé dans une zone (saisie à la main dans
  Grist) forment un seul étage ; renommer ou supprimer agit sur toutes ses lignes.
- Le même nom d'étage dans deux zones différentes est permis (deux étages distincts).
- Pas d'étage dans « Sans zone » : une ligne-étage sans zone est ignorée ; une tâche sans zone
  qui a un `Groupe` s'affiche au niveau « Sans zone ».

### 4.2 Ordre et récapitulatifs

- **Zone** : ses tâches du niveau zone et ses étages, triés ensemble par date de début (Début de
  la tâche, ou Début du récapitulatif de l'étage), puis par Fin, puis par nom ; tâches et étages
  non datés à la fin, par nom.
- **Étage** : ses tâches, même tri que les tâches d'une zone aujourd'hui.
- **Récapitulatif d'étage** : exactement celui d'une zone (`summarizeTasks` : premier Début,
  dernière Fin, Durée en jours ouvrés, un jalon final ne compte pas son propre jour, drapeaux
  « commence / finit par un jalon ») appliqué aux tâches de l'étage.
- **Récapitulatif de zone** : toutes les tâches de la zone, étages compris.

### 4.3 Modèle de lignes

Le modèle de lignes reste le contrat unique entre le tableau et le Gantt (hauteur fixe 26 px).

| Ligne | `kind` | `level` | Particularités |
|---|---|---|---|
| Zone | `zone` | 0 | inchangée ; `childCount` = tâches du niveau zone + étages |
| Étage | `floor` | 1 | clé `floor:<zoneKey>/<floorKey>` ; `floorKey`, `floorName`, `floorRowIds` (lignes-étages, peut être vide) ; récapitulatif et drapeaux de jalon comme une zone ; `collapsed`, `childCount` |
| Tâche du niveau zone | `task` | 1 | `floorKey` = "" |
| Tâche d'un étage | `task` | 2 | `floorKey`, `floorName` de son étage |

- Replier une zone masque tout ce qu'elle contient ; replier un étage masque ses tâches (clé de
  repli `<zoneKey>/<floorKey>`). Les états de repli sont oubliés au changement de projet, comme
  aujourd'hui.

### 4.4 Règles d'écriture (préparées par le modèle, écrites par le contrôleur)

- **Nom d'étage** : obligatoire, 200 caractères au plus (comme une tâche), clé unique dans la
  zone ; sinon refus : « Un étage « PH RDB » existe déjà dans cette zone. » /
  « Le nom de l'étage ne peut pas être vide. »
- **Nom par défaut** : « Nouvel étage », puis « Nouvel étage 2 », « Nouvel étage 3 »… selon les
  noms déjà pris dans la zone.
- **Renommer** : une seule écriture Grist contenant `UpdateRecord` (ou `BulkUpdateRecord`) des
  lignes-étages (`Taches`) et `BulkUpdateRecord` du `Groupe` de toutes ses tâches.
- **Supprimer** : une seule écriture contenant `BulkRemoveRecord` des lignes-étages et de toutes
  ses tâches.
- **Déplacer une tâche** : `UpdateRecord` de `Zone` et `Groupe` (seulement ce qui change ;
  rien si la cible est son conteneur actuel).
- **Nouvelle tâche** : dans son groupe (étage ou niveau zone), elle commence le jour ouvré qui
  suit la dernière Fin **de ce groupe** (aujourd'hui, ou le jour ouvré suivant, s'il n'a rien de
  daté) et dure un jour ; `Groupe` = nom de l'étage ou vide.
- **Cible d'un dépôt**, selon la ligne sous le pointeur :
  - ligne de zone → niveau zone de cette zone ;
  - ligne d'étage ou tâche d'un étage → cet étage (zone comprise) ;
  - tâche du niveau zone → niveau zone de sa zone.

## 5. Tableau et menu contextuel

- **Ligne d'étage** : fond vert clair (`#c6e0b4`) sur la cellule du nom, texte en gras, triangle
  de repli ; Durée / Début / Fin = récapitulatif (non modifiables) ; les tâches de l'étage sont
  décalées d'un cran de plus que celles du niveau zone. Le bouton de repli d'un étage porte,
  comme celui des zones, l'attribut qui le laisse actif en lecture seule.
- **Renommer** : clic (ou Entrée / F2) sur le nom d'un étage ouvre la saisie, comme pour une
  tâche ; la validation passe par la règle 4.4.
- **Menu du clic droit** :

| Ligne | Entrées |
|---|---|
| Zone (sauf « Sans zone ») | « Ajouter une tâche » (niveau zone), « Ajouter un étage » |
| « Sans zone » | « Ajouter une tâche » |
| Étage | « Ajouter une tâche » (dans l'étage), « Supprimer l'étage » |
| Tâche | « Ajouter une tâche » (même groupe), « Supprimer la tâche » |

- **Ajouter un étage** : l'étage apparaît (zone dépliée) et son nom s'ouvre en saisie, comme une
  nouvelle tâche.
- **Supprimer l'étage** : confirmation « Supprimer l'étage « PH RDB » et ses 24 tâches ? »
  (« …et sa tâche ? » pour une seule, « Supprimer l'étage « PH RDB » ? » s'il est vide).

## 6. Glisser-déposer

- **Poignée** ⠿ à gauche du nom de chaque tâche, visible au survol de la ligne, seulement quand
  le tableau est modifiable (« Editer » actif et service modifiable). Ni les zones ni les étages
  ne se glissent.
- **Démarrage** : appui du bouton principal sur la poignée puis mouvement de plus de 4 px ; un
  simple clic sur la poignée ne fait rien. Pendant une saisie en cours, la saisie est d'abord
  validée (comme un clic ailleurs).
- **Pendant le glisser** : une copie de la ligne de la tâche (poignée, nom, durée, dates) suit
  le pointeur, tenue là où on l'a attrapée, avec la destination en légende (« Déplacer dans
  « PH RDB » » ou « Déplacer au niveau de la zone « Zone Z3A » ») ; la ligne d'origine
  s'estompe et le curseur reste une main fermée sur tout le widget ; la ligne d'en-tête du
  conteneur visé (zone ou étage) est surlignée ; la liste défile d'elle-même quand le pointeur
  approche à moins de 24 px du haut ou du bas de la zone défilante. La ligne visée se déduit de
  la position verticale du pointeur (hauteur de ligne fixe), pas de l'élément survolé.
- **Lâcher** : sur une cible valide différente du conteneur actuel → déplacement (règle 4.4) ;
  même conteneur, hors des lignes ou Échap → annulé, rien n'est écrit.
- **Écriture** : affichée tout de suite et enregistrée en arrière-plan par la file d'écritures
  (section 8), comme une saisie ; en cas d'échec, la tâche revient à sa place avec un message.

## 7. Gantt

- **Étage** : crochet fin et foncé (`#1f1f1f`, 1,5 px) du Début à la Fin de l'étage, dans le
  haut de la ligne, avec une patte de 6 px vers le bas à chaque bout ; mêmes règles que la barre
  de zone pour un début ou une fin sur un jalon (centre du jour) ; nom de l'étage en gras à
  **droite** du crochet (comme « PH RDB » sur la capture). Étage sans date : rien. Étage replié :
  le crochet reste.
- **Flèches** (dessin seul) :
  - une flèche relie la tâche de la ligne *i* à celle de la ligne *i + 1* quand les deux sont des
    tâches datées du même groupe (même zone et même étage, ou toutes deux au niveau zone) ; il
    n'y a donc pas de flèche entre deux tâches du niveau zone séparées par un étage, ni vers une
    tâche non datée ou masquée ;
  - départ : bout droit du segment, ou pointe droite du losange, au milieu de la ligne ;
  - si la suivante commence au même x ou après : trait horizontal jusqu'à son début, puis
    vertical jusqu'au haut de son segment (ou de son losange), pointe vers le bas ;
  - sinon (la suivante commence avant) : détour en S — 6 px à droite, descente jusqu'entre les
    deux lignes, retour à gauche jusqu'à 6 px avant son début, descente au milieu de sa ligne,
    pointe vers la droite ;
  - couleur des segments (`#3b9bb0`), trait de 1 px, pointe pleine ; dessinées sous les barres.
- Rien d'autre ne change (zones, jalons, segments, échelle, glisser / zoom de la période).

## 8. File d'écritures

Toutes les écritures du tableau (saisies, ajouts, suppressions, déplacements, étages) passent
par la file existante : une écriture à la fois, dans l'ordre, affichée tout de suite en
surimpression des lignes lues. En plus :

- **(B) Contexte vérifié au départ** : chaque écriture mémorise le service et le projet courants
  au moment où elle est demandée ; si l'un a changé quand vient son tour, elle n'est pas envoyée
  et échoue avec « Le projet ou le service a changé avant l'enregistrement : recommencez. » —
  jamais une tâche ou un étage créé dans un autre service.
- **(C) Indicateur** : quand une écriture est en cours depuis plus d'une seconde, la barre d'état
  affiche « Enregistrement… » (sans disparition automatique) jusqu'à ce que la file soit vide ;
  il ne remplace jamais un message d'erreur affiché.
- **(A) Suppressions en attente** : les lignes dont la suppression attend son tour (tâche,
  étage et ses tâches) sont masquées de l'affichage jusqu'à la fin de l'écriture, même si une
  relecture les ramène entre-temps ; en cas d'échec elles réapparaissent telles que lues dans
  Grist (plus de restauration d'une ancienne photo des lignes).
- **(D) Messages** : un message d'information (ajout, suppression réussis) qui arrive en
  arrière-plan ne remplace pas un message d'erreur affiché ; un message d'erreur est effacé par
  la saisie acceptée suivante, comme aujourd'hui.
- **Échec d'une écriture groupée** (renommage, suppression d'étage) : rien n'est écrit (Grist
  applique tout ou rien) ; l'affichage revient à l'état lu ; les écritures suivantes qui
  touchent les mêmes lignes sont annulées aussi, avec le message habituel.

## 9. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Colonne `Etage` absente | Section 3 : « Ajouter un étage » grisé + message ; écriture refusée → même message. |
| Nom d'étage vide ou déjà pris dans la zone | Refus, message (4.4), rien n'est écrit. |
| Tâches dont le `Groupe` nomme un étage sans ligne | Étage affiché quand même (4.1). |
| Deux lignes-étages de même clé dans une zone | Un seul étage ; renommer / supprimer agit sur toutes. |
| Ligne-étage sans zone | Ignorée (pas d'étage dans « Sans zone »). |
| Dépôt sur le conteneur actuel, hors des lignes, Échap | Annulé, rien n'est écrit. |
| Lecture seule ou « Editer » inactif | Pas de poignée ; menu refusé comme aujourd'hui ; renommer refusé. |
| Projet ou service changé avant le départ d'une écriture | Section 8 (B). |
| Écriture lente | Section 8 (C). |

## 10. Architecture

| Fichier | Rôle |
|---|---|
| `services/syntheseTaskModel.js` | Reconnaissance des étages (`isFloorRow`, lecture tolérante d'`Etage`), exclusion des étages de `isTaskRow`, étages d'une zone (lignes + `Groupe`), clés d'étage, tri du niveau zone (tâches hors étage, puis étages), récapitulatifs, modèle de lignes à trois niveaux, règles de nom d'étage, cible d'un dépôt, préparation des actions Grist (nouvel étage, renommage, suppression, déplacement), détection de la colonne `Etage`. Pur, testé sous Node. |
| `ui/syntheseTasksController.js` | Nouvelles intentions : ajouter / renommer / supprimer un étage, déplacer une tâche, ajouter une tâche dans un groupe ; file d'écritures étendue (écritures de plusieurs lignes en surimpression, B, C, A, D). Dépendances injectées, testé avec des doublures. |
| `ui/syntheseTaskTable.js` | Ligne d'étage, saisie du nom d'étage, menu contextuel selon la ligne, poignée ; délègue le glisser au module ci-dessous. |
| `ui/syntheseTaskDrag.js` (nouveau) | Glisser-déposer : seuil, copie de la ligne et légende, surlignage, défilement automatique, Échap, ligne visée d'après la position verticale ; appelle `onDrop(taskId, cible)`. Testé sur faux DOM. |
| `services/syntheseGanttGeometry.js` | Forme du crochet d'étage et tracés des flèches (pur, testé). |
| `ui/syntheseGantt.js` | Dessin des crochets et des flèches (sous les barres). |
| `services/planningSyncCoordinator.js` | Écarte aussi les lignes-étages du planning Structure. |
| `assets/css/styles.css` | Ligne d'étage, poignée, copie de la ligne glissée, estompage, surlignage, tons de la barre d'état, crochet et flèches. |
| `index.html` | Versions des scripts et de la feuille de style relevées. |

## 11. Tests

- **Modèle** : reconnaissance (booléen, texte « true », `Etage` faux, ligne sans nom) ; une
  ligne-étage n'est pas une tâche ; étages issus des lignes et des `Groupe` ; clés et doublons ;
  étage sans zone ignoré ; tri du niveau zone (tâches hors étage en haut, puis étages ; non
  daté à la fin de chaque groupe) ; récapitulatifs
  d'étage (jalon final) et de zone (étages compris) ; modèle de lignes (niveaux, clés, repli
  d'étage, zone repliée) ; noms d'étage (vide, trop long, doublon, « Nouvel étage 2 ») ; cible
  d'un dépôt pour chaque genre de ligne ; actions de renommage / suppression / déplacement
  (étages avec et sans ligne) ; détection de la colonne `Etage`.
- **Contrôleur** : ajouter un étage (nom par défaut, saisie ouverte, zone dépliée) ; renommer
  (une seule écriture, refus de doublon) ; supprimer (confirmation avec le nombre, une seule
  écriture, échec → tout revient) ; déplacer (affiché tout de suite, `Zone` / `Groupe` écrits) ;
  nouvelle tâche dans un étage (dates d'après l'étage) ; B (projet ou service changé avant le
  départ) ; C (indicateur après une seconde, pas sur une erreur) ; A (suppression en attente
  masquée malgré une relecture) ; D.
- **Tableau** : ligne d'étage et décalage ; menu selon la ligne ; poignée seulement en mode
  modifiable ; saisie du nom d'étage.
- **Glisser** (faux DOM) : seuil de 4 px ; ligne visée d'après la position verticale et le
  défilement ; copie de la ligne tenue au point d'appui, légende, estompage et surlignage ;
  défilement automatique ; Échap ; dépôt sur le conteneur
  actuel ignoré ; `onDrop` appelé avec la bonne cible.
- **Gantt** : crochet (bornes, pattes, jalons au début ou à la fin, libellé à droite) ; flèches
  (même groupe seulement, pas au-dessus d'un étage, pas vers le non daté, tracé simple et
  détour en S, départ d'un losange) ; dessin (faux DOM) des crochets et flèches.
- **Branchement** : la vue Structure écarte les lignes-étages ; versions de `index.html`.
- **Vérification visuelle** : test manuel de l'utilisateur sur localhost.

## 12. Hors périmètre

- Flèches qui décalent les dates, liens choisis à la main (colonne de prédécesseurs).
- Glisser une zone ou un étage ; réordonner à la main (l'ordre reste chronologique).
- Glisser dans le Gantt (le glisser y déplace toujours la période).
- Documents (lignes bleues de la capture), colonne `Ressource`.
- Affichage des lignes-étages dans les autres widgets qui lisent Planning_Projet.
