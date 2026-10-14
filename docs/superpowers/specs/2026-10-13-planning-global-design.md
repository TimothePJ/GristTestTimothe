# Spec — Vue « Global » : le planning Synthèse et le planning Structure fusionnés, en lecture seule (Planning Projet)

Date : 2026-10-13
Statut : design validé en conversation, en attente de relecture avant plan d'implémentation.
S'appuie sur :
- `docs/superpowers/specs/2026-09-23-synthese-taches-design.md`, `2026-09-25-synthese-gantt-design.md`,
  `2026-09-25-synthese-etages-design.md`, `2026-10-05-synthese-modele-etage-design.md` (tableau,
  Gantt, étages, modèle d'étage de la vue Synthese) ;
- `docs/superpowers/specs/2026-10-07-lien-structure-synthese-design.md` (lien étage ↔ coffrage,
  date « 0 Prev ») ;
- la tâche contrôlée par rapport au coffrage (colonne `Controle_Coffrage`), en place et non
  commitée.

## 1. Objectif

Planning Projet gagne une vue **« Global »** qui montre, pour un projet, le planning du service
Synthèse et celui du service Structure **dans un même tableau avec un même Gantt**. On y
supervise : on ne peut rien y modifier.

La vue répond à trois besoins :

1. **Lire les deux plannings ensemble**, là où ils se rencontrent : un étage de Synthèse et le
   coffrage de Structure auquel il est lié forment un **niveau**, affiché d'un bloc.
2. **Ranger les armatures sous leur coffrage** : la liste se déplie depuis la ligne du coffrage.
3. **Voir les incohérences et les retards** entre les deux services : une date en rouge quand la
   Synthèse est en retard sur ce que Structure attend, et l'alerte qui remonte jusqu'à la zone
   (la date clignotait d'abord ; clignotement retiré à la demande de l'utilisateur le 14/10/2026).

Exemple (ERA QUAI D'ORSAY, Zone 2 / BAT B, base de test) : l'étage RDC est lié au coffrage 3032
« PH REZ DE CHAUSSEE - COF », dont le plan commence le 19/08/2026. La tâche contrôlée de l'étage,
« PLAN DE SYNTHESE RESEAUX NIV RDC », finit le 30/11/2026 : sa date de fin est en rouge, le
niveau « RDC ⇄ 3032 » affiche « Synthèse en retard de 103 j » et la zone porte l'alerte. Les deux
autres étages liés du projet (SS1 ⇄ 3031, SS1 ⇄ 3022) sont cohérents.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Nom et accès | Un bouton **« Global »** dans le bandeau de Planning Projet. Rien dans la liste Service, rien dans `shared/`, rien dans les autres widgets. |
| Lecture seule | La vue **n'écrit jamais** dans Grist : ni saisie, ni menu, ni glisser. |
| Organisation | **Par niveau lié** : zone → niveau (étage ⇄ coffrage) → étage de Synthèse et coffrage côte à côte. |
| Armatures | Sous leur coffrage (même zone, même `Groupe`), dépliables depuis la ligne du coffrage. |
| Documents Structure | **Tous** : coffrages, armatures, coupes, démolition, NDC, types personnalisés. |
| Contrôles | Retard Synthèse (tâche contrôlée) ; démarrage GO / travaux ; fond de plan / « 0 Prev » ; retard des documents Structure (§ 5). |
| Clignotement | **Aucun** (décisions du 14/10/2026 : d'abord l'état, puis la date de fin). La date de fin d'une tâche de Synthèse en retard est rouge et grasse, comme dans le tableau Synthese. |
| Unité des retards | **Jours calendaires**, comme la colonne « Retard (j) » du planning Structure. |
| Données | Aucune colonne à créer. Tout se déduit de `Planning_Projet` et de `ListePlan_NDC_COF`. |
| Services | Synthèse et Structure. Topographie n'entre pas dans la vue. |
| Git | **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même. |

## 3. Données lues

La vue lit, pour le projet courant et **tous services confondus**, par la lecture partagée
existante `GristServiceContext.fetchProjectRows` :

- `Planning_Projet` : les lignes des deux services ;
- `ListePlan_NDC_COF` : la date « 0 Prev » des coffrages (lignes d'indice « Prev 0 »).

Tri des lignes de `Planning_Projet` :

- **Structure** : `Service` = Structure. Un document est une ligne dont `Type_doc` est rempli.
  Ses dates, ses durées et son rang sont ceux que calcule déjà le planning Structure
  (`buildTimelineDataFromPlanningRows`, comme le fait `formworkStarts.js`) : « Début », « Fin »,
  « Démarrage travaux », durée Début → Fin en semaines.
- **Synthèse** : `Service` = Synthese, lues par le modèle de la vue Synthese (`buildSections`) :
  étages, cycles, sous-groupes, tâches, liens.
- **Ignorées** : les lignes de Topographie, et les anciens segments de la vue Synthese v1
  (`Type_doc` = SYNTHESE).

`Réalisé` et `Indice` d'un document Structure sont les valeurs stockées, telles que le planning
Structure les a écrites à sa dernière synchronisation.

## 4. Arbre des lignes (calcul pur)

### 4.1 Zones

Une section par zone qui contient au moins une ligne, triées par nom (ordre naturel), puis
« Sans zone ». Les deux services partagent leurs zones : elles se comparent avec `zoneKeyOf`
(sans accents, casse ni ponctuation). Le filtre « Zone » du bandeau n'en garde qu'une.

### 4.2 Niveau lié

Un **niveau** réunit un coffrage et le ou les étages de Synthèse qui lui sont liés. Le lien est
celui de la fenêtre « Lien Structure » : la colonne `Lien_Structure` de la ligne-étage porte le
N° du coffrage, et le coffrage est retrouvé par les mêmes règles (`buildStructureLink`).

La ligne du niveau s'intitule « *étage* ⇄ *N° — nom du coffrage* » (« RDC ⇄ 3032 — PH REZ DE
CHAUSSEE - COF » ; plusieurs étages liés au même coffrage : « RDC, R+1 ⇄ … »). Elle contient,
dans cet ordre :

1. chaque étage lié, sous le nom « Synthèse · *étage* », avec son contenu habituel (tâches,
   cycles, sous-groupes, dans l'ordre de la vue Synthese) ;
2. la ligne du coffrage, avec ses armatures.

Les contrôles du § 5 se font étage par étage : quand plusieurs étages partagent un coffrage,
chacun porte son état, et celui du niveau les réunit.

Un étage n'est rangé dans un niveau que si son coffrage est **dans sa zone**. S'il est lié à un
coffrage d'une autre zone, il reste une ligne à part de sa propre zone ; ses contrôles sont
calculés quand même et son état nomme le coffrage et sa zone.

### 4.3 Coffrage et armatures

Les armatures d'un coffrage sont les documents ARMATURES de la même zone et du même `Groupe`,
dans l'ordre du planning Structure. La ligne du coffrage porte le triangle de repli et le nombre
d'armatures. Un coffrage sans étage lié est une ligne du niveau zone, avec ses armatures de la
même façon.

Si un groupe contient plusieurs coffrages, chacun a sa ligne et les armatures se rangent sous le
premier (ordre du planning Structure). Les armatures d'un groupe sans coffrage, ou sans `Groupe`,
sont des documents simples (§ 4.4).

### 4.4 Ce qui n'entre dans aucun niveau

- **Étage de Synthèse non lié**, ou dont le coffrage est introuvable ou dans une autre zone :
  ligne « Synthèse · *étage* » au niveau zone, avec son contenu.
- **Tâche de Synthèse hors étage** : ligne de tâche au niveau zone.
- **Autres documents Structure** (décision du 14/10/2026) : coupes, démolition, NDC et types
  personnalisés sont **rassemblés par type dans leur zone** — une ligne « COUPES »,
  « DÉMOLITION », « NDC » ou au nom du type personnalisé (types personnalisés réunis sans
  tenir compte de la casse, comme le mode agrégé du planning Structure), avec le nombre de ses
  documents, à la couleur de ligne du type dans le tableau Structure, repliée par défaut ; ses
  documents dessous, un cran plus bas. Toujours un groupe, même pour un seul document. Type
  décidé par les règles du tableau Structure (`structureRowTypeOf`).
- **Armature sans coffrage** (groupe sans coffrage, ou sans `Groupe`) : ligne simple au niveau
  zone.

### 4.5 Ordre dans une zone

1. Les niveaux liés et les coffrages sans étage, dans l'ordre du planning Structure — un niveau
   prend le rang de son coffrage.
2. Les étages de Synthèse hors niveau, puis les tâches de Synthèse hors étage, dans l'ordre de la
   vue Synthese.
3. Les autres documents Structure, dans l'ordre du planning Structure ; un groupe de type prend
   le rang de son premier document.

### 4.6 Récapitulatifs

Zone, niveau et groupe d'un type : Début = la plus ancienne date de leur contenu, Fin = la plus
tardive ; état = résumé des alertes de leur contenu (« 1 retard Structure ») ; pas de
durée (les deux services ne comptent pas dans la même unité). Étage, cycle et sous-groupe de
Synthèse gardent leur récapitulatif en jours ouvrés.

### 4.7 Repli

Par défaut : zones dépliées ; niveaux, étages et coffrages repliés — on voit une ligne par niveau,
avec son état. L'état de repli est propre à la vue Global, gardé le temps de la session et remis
à zéro au changement de projet.

## 5. Contrôles de cohérence (calcul pur)

« Aujourd'hui » et les dates sont comparés au jour près. Un retard se compte en jours
calendaires.

### 5.1 Retard Synthèse — la tâche contrôlée

Règle existante (`controlTaskEndLimits`) : la tâche contrôlée d'un étage lié — celle cochée
`Controle_Coffrage`, sinon le plan de réservations du cycle 3 — doit finir **au plus tard le jour
où commence le plan de coffrage** lié (« Début » du planning Structure). Si sa Fin dépasse cette
limite : alerte **rouge** (la Fin de la tâche en rouge), retard = nombre de jours entre la limite et la Fin.
Plusieurs tâches cochées dans un étage sont toutes contrôlées.

Non vérifiable : pas de tâche contrôlée, tâche contrôlée sans Fin, coffrage sans « Début ».

### 5.2 Retard Synthèse — le démarrage du gros œuvre

Nouveau. Le jalon de démarrage d'un étage lié est sa tâche de `Nature` Démarrage (« DEMARRAGE GO
… (date prévisionnelle) » dans le modèle ; la plus ancienne par id s'il y en a plusieurs). Le
démarrage des travaux du niveau est la plus ancienne date « Démarrage travaux » affichée par le
planning Structure pour le coffrage et ses armatures. Si le jalon tombe **après** ce démarrage :
alerte **rouge** (la Fin du jalon en rouge), retard = nombre de jours entre les deux.

Non vérifiable : pas de jalon de démarrage daté, aucun « Démarrage travaux » dans le niveau.

### 5.3 Fond de plan à mettre à jour

Règle existante (état `stale` de `buildStructureLink`) : le Début du fond de plan de synthèse de
l'étage n'est pas le jour ouvré de la date « 0 Prev » du coffrage lié. Alerte **orange fixe**.

Non vérifiable : étage sans fond de plan (`noPlan`), coffrage sans « 0 Prev » (`waiting`).

### 5.4 Coffrage introuvable

Le N° mémorisé sur l'étage ne correspond à aucun coffrage du projet (`missing`). Alerte **rouge
fixe**. Les trois contrôles précédents ne s'appliquent pas.

### 5.5 Retard d'un document Structure

Pour chaque document Structure :

- non terminé (`Réalisé` < 100) : retard = nombre de jours entre sa « Fin » et aujourd'hui, 0 si
  la Fin n'est pas passée ou manque — la règle du planning Structure, recalculée à l'affichage
  pour ne pas dépendre de la dernière synchronisation. Retard > 0 : alerte **rouge fixe** ;
  **orange fixe** si une justification est saisie (`Remarque`), qui s'affiche au survol. Un
  retard justifié compte dans les compteurs comme les autres ;
- terminé (`Réalisé` = 100) : le retard stocké reste lisible, en gris, et ne compte plus comme
  une alerte.

### 5.6 État d'une ligne (colonne « État »)

| Ligne | État | Ton |
|---|---|---|
| Tâche contrôlée en retard | « retard 103 j » ; au survol : « Fin trop tardive : à finir au plus tard le Mer 19/08/26 (début du plan de coffrage 3032 dans le planning Structure). » | rouge |
| Jalon de démarrage en retard | « retard 12 j » ; au survol : « Démarrage prévu après le démarrage des travaux de Structure (Mer 14/10/26). » | rouge |
| Niveau lié, tous contrôles passés | « ✓ cohérent » | vert |
| Niveau lié, contrôles non vérifiables | « ✓ cohérent (1 contrôle non vérifiable) » ; au survol : la raison de chacun | gris |
| Niveau lié, aucun contrôle vérifiable | « non vérifiable » ; au survol : les raisons | gris |
| Niveau lié en défaut | ses alertes, la plus grave d'abord : « Synthèse en retard de 103 j · à mettre à jour » | celui de chaque alerte |
| Étage « Synthèse · … » lié | le plus grave d'abord : les retards de son contenu (« 1 retard Synthèse », § 5.7), puis sa propre alerte s'il en a une (« à mettre à jour : 0 Prev le Jeu 27/11/25 », § 5.3) | celui de chaque alerte |
| Étage non lié | « non lié à un coffrage » | gris |
| Étage au coffrage introuvable | « coffrage 3099 introuvable » | rouge fixe |
| Document Structure en retard | « retard 23 j », « retard 23 j (justifié) » | rouge fixe / orange |
| Document Structure terminé | « terminé », « terminé (retard 23 j) » | gris |

### 5.7 Remontée

Une alerte se lit aussi sur ses lignes parentes, pour rester visible quand elles sont repliées :
cycle, étage, niveau, zone affichent le **résumé de leur contenu**, par famille et la plus grave
d'abord — « 1 retard Synthèse · 1 à mettre à jour · 3 retards Structure », en couleur fixe. Une ligne sans alerte dans son contenu n'affiche rien, sauf le
niveau lié (§ 5.6).

## 6. Affichage

### 6.1 Bandeau

- Bouton « Global », à droite de la liste « Zone » : enfoncé quand la vue est active. Il n'est
  jamais désactivé par le mode lecture seule du contexte partagé.
- Vue active : la frise Structure et le tableau Synthese sont masqués ; « Editer », « Durées » et
  « Lien Structure » aussi ; les entrées « Ajouter une zone » et « Modifier Zone » de la liste
  Zone également. « Editer » repasse à l'état verrouillé.
- Restent : Projet, Zone, Semaine / Mois / Année, la plage de dates, la liste Service. Changer de
  service ne quitte pas la vue et ne change pas son contenu.
- Le choix est mémorisé avec le projet et la zone du widget (`localStorage`).
- Modes embarqués (planning-synchro, en-tête seul) : pas de bouton, vue jamais active.

### 6.2 Tableau

Même mise en page que le tableau Synthese (en-tête collant, lignes de 26 px, retrait par niveau,
séparateur déplaçable entre tableau et Gantt, largeur mémorisée à part). Colonnes : **Nom, N°,
Indice, Durée, Début, Fin, État**.

- Largeur : le tableau ne descend pas sous 660 px. Quand on le resserre, la colonne « État » se
  réduit d'abord (jusqu'à 120 px, le texte complet restant au survol) et le « Nom » garde au
  moins 180 px : aucune colonne ne déborde sur le Gantt.
- Durée : « 5 jours » pour une tâche de Synthèse ; « 2 sem. » pour un document Structure (rien
  si sa durée est vide ou nulle) ; rien pour une zone ou un niveau.
- Dates au format du tableau Synthese (« Mer 19/08/26 »).
- Chaque ligne garde les couleurs de sa vue d'origine (décision du 14/10/2026 : « les couleurs
  utilisées doivent être les mêmes que les tableaux Structure et Synthèse ») : zone verte, étage
  orange, cycle gris, réunion bleue, démarrage rouge pour la Synthèse ; pour un document
  Structure, la couleur de ligne de son type dans le tableau du planning Structure — coffrage
  #fff8dc, NDC #e9e6f2, coupes #d4f7e6, démolition #fde8e8, type personnalisé #ede9ff, armature
  sans couleur —, type décidé par les mêmes règles que ce tableau (`ui/timeline.js`). Un niveau
  lié, propre à la vue Global, a sa propre couleur (bleu-gris). Des tests comparent chaque
  couleur à sa règle d'origine.
- Triangles de repli sur zone, niveau, étage, cycle, sous-groupe et coffrage ; le coffrage
  indique son nombre d'armatures.
- Aucune cellule ne s'ouvre en saisie ; pas de menu contextuel ; pas de poignée de glisser.

### 6.3 Retard de la Synthèse dans le tableau

- Sur la ligne fautive (tâche contrôlée, jalon de démarrage) : la cellule **« Fin »** en rouge
  gras (#c00000, comme un plan de réservations en retard dans le tableau Synthese). Son état
  (« retard 103 j ») est rouge.
- Les lignes parentes (cycle, étage, niveau, zone) affichent leur résumé.
- Rien ne clignote (décisions du 14/10/2026).

### 6.4 Gantt

Le Gantt de la vue Synthese, sur les lignes de la vue Global, avec la même période que le bandeau
(glisser pour se déplacer, Ctrl + molette pour zoomer). Lecture seule.

- Synthèse : inchangé — barres, losanges, crochets d'étage et de cycle, flèches des liens.
- Document Structure : **les barres que le planning Structure dessine pour lui**, demandées à
  `buildTimelineDataFromPlanningRows` et non recalculées (décision du 14/10/2026) — sa phase,
  coupée à l'heure actuelle en partie passée (plus foncée, sans libellé) et partie à venir
  (libellé « Coffrage », « Armature »…) ; en retard et pas réalisée, la part réalisée à sa
  couleur et le reste à la couleur de retard (`retardPhasePaint`, la règle même du planning
  Structure) ; bord vert une fois réalisée ; la case « Données d'entrées » (verte, orange ou
  rouge selon les réceptions) ; la case verte d'un jour du « Démarrage travaux ». Mêmes heures
  de début et de fin que dans la frise, même hauteur relative (4 px libres en haut et en bas),
  mêmes couleurs : chaque règle `#planningTimeline .vis-item.phase-…` a sa jumelle
  `.stg-seg.phase-…`, comparée par un test. Libellé coupé au bord de sa barre ; le nom du
  document à droite de sa dernière barre. Le réalisé est calculé avec les indices de référence
  du service Structure, quel que soit le service affiché, et les données d'entrées sont lues
  comme le fait le planning Structure. Pas de flèche entre documents.
- Coffrage replié sur ses armatures (décision du 14/10/2026) : **une seule barre pour toute sa
  section**, du début de la première phase (coffrage ou armature) à la fin de la dernière, aux
  couleurs d'une barre de coffrage, libellé « Coffrage », coupée à l'heure actuelle par le code
  du planning Structure (`createSplitPhaseItems`). Couleurs de retard dès qu'un document de la
  section est en retard sans être réalisé ; bord vert quand tous sont réalisés. Ni démarrage
  des travaux ni données d'entrées sur cette barre. Déplié : les barres de chaque document,
  comme dans le planning Structure. En « Alertes seulement », un coffrage dont aucune armature
  n'est affichée montre aussi la barre de sa section. Les colonnes Début et Fin restent celles
  du coffrage.
- Groupe d'un type replié (décision du 14/10/2026) : de même, **une seule barre** pour tous
  ses documents, dans la classe de barre du type (`phase-ndc`, `phase-coupes`,
  `phase-demolition`, `phase-generic`), libellée comme dans le planning Structure (« NDC »,
  « COUPES », « DÉMOLITION », nom du type) ; pas de nom répété après la barre. Déplié : un
  crochet de sa première à sa dernière date, et les barres de chaque document.
- Zone : barre noire ; niveau : crochet, de la première à la dernière date de son contenu.
- Limite de fin de la tâche contrôlée : le trait pointillé rouge existant, sur sa ligne.
- En alerte rouge : la barre de la tâche fautive (existant) et le crochet de son étage et de son
  niveau passent au rouge.

### 6.5 Barre d'état

- Compteurs du projet (ou de la zone filtrée) : « 3 étages liés · 2 non liés · 1 retard
  Synthèse · 0 à mettre à jour · 12 retards Structure », suivis de « · 1 coffrage
  introuvable » quand il y en a.
- Bouton **« Alertes seulement »** : ne garde que les lignes en alerte et leurs parentes,
  dépliées jusqu'à la ligne fautive. Un second appui rend l'affichage précédent.
- Bouton **« Actualiser »** : relit les deux tables.

### 6.6 Messages

- pas de projet : « Choisissez un projet pour afficher son planning global. »
- lecture en cours, ou contexte partagé pas encore prêt : « Chargement du planning global… »
- projet sans ligne : « Aucune ligne de planning pour ce projet. » ; zone filtrée sans ligne :
  « Aucune ligne de planning dans cette zone. »
- « Alertes seulement » sans alerte : « Aucune alerte sur ce projet. » ; avec une zone filtrée :
  « Aucune alerte dans cette zone. »
- première lecture impossible : « Le planning global n'a pas pu être lu. Cliquez sur
  « Actualiser ». »
- relecture impossible, données déjà affichées : elles restent, avec « La dernière relecture a
  échoué : les dates affichées peuvent être anciennes. »

## 7. Chargement et rafraîchissement

La vue lit ses deux tables en parallèle :

- quand elle devient active ;
- quand le projet change ;
- à chaque rappel de la surveillance de tables existante de `main.js`, quelle que soit la table
  signalée. Cette surveillance ne compare que les lignes du service affiché : une écriture faite
  par l'autre service depuis un widget lui parvient par les colonnes de signal du projet
  (`…_Sync` de `Projets2`), donc sous le nom d'une autre table ;
- sur « Actualiser » — seul moyen de voir une modification faite par l'autre service directement
  dans une table Grist, hors widget.

Inactive, elle ne lit rien. Une réponse arrivée après un changement de projet ou une
désactivation est ignorée. Aucune minuterie n'est ajoutée.

La synchronisation automatique du planning Structure (colonnes dérivées du service affiché) est
celle du widget : la vue Global ne la déclenche pas et ne la modifie pas.

## 8. Erreurs et cas limites

- **Projet sans Synthèse** : la vue montre le planning Structure, coffrages et armatures groupés ;
  aucun état de liaison n'est affiché sur les coffrages.
- **Projet sans Structure** : les étages apparaissent « non lié à un coffrage ».
- **Deux coffrages de même N°** dans le projet : celui de la zone de l'étage est retenu, comme
  dans « Lien Structure ».
- **Coffrage sans N°** : il ne peut pas être lié ; c'est un coffrage sans étage.
- **Coffrage ou document sans dates** : ligne sans barre, sans retard ; les contrôles qui en
  dépendent sont « non vérifiables ».
- **Étage sans ligne-étage** (ancien étage déduit du `Groupe` des tâches) : jamais lié, affiché
  « non lié à un coffrage ».
- **Colonnes absentes** (`Etage`, `Nature`, `Parent`, `Lien`, `Lien_Structure`,
  `Controle_Coffrage`, par exemple en production) : la vue s'affiche avec ce qui existe — sans
  étages, sans liens ou sans tâche choisie selon le cas — et ne signale rien.
- **Zone filtrée** : sections, compteurs et « Alertes seulement » se limitent à cette zone.
- **Utilisateur en lecture seule sur un service** : sans effet, la vue ne fait que lire.
- **Retour à Structure ou à Synthese** : la vue du service réapparaît dans l'état où elle était ;
  la frise Structure recalcule ses dimensions.

## 9. Architecture

| Fichier | Rôle |
|---|---|
| `services/globalPlanningModel.js` (nouveau) | Pur. Fusionne les deux plannings : zones, niveaux, armatures sous coffrage, ordre, récapitulatifs ; puis le modèle de lignes affichées selon les replis et « Alertes seulement ». |
| `services/globalChecks.js` (nouveau) | Pur. Les contrôles du § 5, l'état de chaque ligne, la remontée et les compteurs. |
| `ui/globalPlanningTable.js` (nouveau) | DOM, lecture seule : lignes, colonnes, replis, séparateur, barre d'état ; monte le Gantt. |
| `ui/globalPlanningController.js` (nouveau) | Lecture des deux tables, rafraîchissement, filtre de zone, replis ; dépendances injectées (contexte, fabrique du tableau, horloge). |
| `services/syntheseGanttGeometry.js`, `ui/syntheseGantt.js` | Ajouts sans effet sur la vue Synthese : barres d'un document Structure reprises du planning Structure, crochet en alerte. |
| `services/planningService.js` | Exporte la règle de couleur d'une barre en retard (`retardPhasePaint`) — le style du planning Structure en est tiré, inchangé (tests de caractérisation) — et, tels quels, `createSplitPhaseItems` et `buildPhaseClassName` pour la barre de section. |
| `services/structureLinkModel.js`, `services/formworkStarts.js`, `services/syntheseTaskModel.js` | Réutilisés. Au besoin, export de fonctions déjà présentes ; aucune règle changée. |
| `main.js`, `state.js` | Bouton, bascule de vue, mémorisation, branchement sur la surveillance existante. |
| `index.html`, `styles.css` | Bouton, conteneur de la vue, styles, versions `?v=`. |

Non modifiés : `shared/`, `ui/syntheseTaskTable.js`, `ui/syntheseTasksController.js`,
`ui/timeline.js`, les autres widgets.

## 10. Tests (`node --test tests/*.test.mjs`)

- **Modèle** : zones communes aux deux services ; niveau lié (un étage, plusieurs étages, coffrage
  d'une autre zone) ; armatures sous leur coffrage, groupe à plusieurs coffrages, armatures sans
  coffrage ; étages non liés ; ordre dans une zone ; récapitulatifs ; filtre de zone ; replis par
  défaut ; « Alertes seulement » ; projet sans Synthèse, sans Structure ; colonnes absentes.
- **Contrôles** : chacun des cinq, avec ses cas non vérifiables ; nombre de jours ; document
  terminé ; justification ; état du niveau (cohérent, partiel, non vérifiable, en défaut) ;
  remontée et compteurs. Jeu d'essai : les lignes ERA QUAI D'ORSAY de la base de test, dont le
  retard de l'étage RDC (103 j).
- **Gantt** : barres d'un document reprises du planning Structure (partie passée et à venir,
  retard, données d'entrées, démarrage), couleurs jumelles de la frise, pas de flèche entre
  documents, crochet en alerte ; la vue Synthese dessine comme avant.
- **Tableau** : rendu des lignes et des états, Fin en retard, replis, aucune cellule
  modifiable, barre d'état, messages.
- **Contrôleur** : lecture à l'activation, au changement de projet, au signal, sur « Actualiser » ;
  rien quand la vue est inactive ; réponse périmée ignorée ; échec de lecture.
- **Branchement** : `main.js`, `state.js`, `index.html`, CSS, versions ; modes embarqués.

## 11. Hors périmètre

- Toute modification depuis la vue Global (dates, liens, tâche contrôlée, zones).
- Topographie.
- La vue Global dans un autre widget, ou comme entrée de la liste Service.
- Export, impression.
- Largeur réglable colonne par colonne.
- Relecture périodique automatique.
- Recalcul du `Réalisé` et de l'`Indice` des documents Structure (valeurs stockées).
