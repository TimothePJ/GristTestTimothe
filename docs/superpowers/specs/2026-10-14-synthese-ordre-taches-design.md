# Vue Synthese — ordre libre des tâches et chaînage automatique

Date : 14/10/2026. Widget : Planning Projet, vue Synthese (tableau de tâches + Gantt). Statut : à
relire par l'utilisateur.

## 1. Objectif

- **Insérer une tâche là où l'on clique** : « Ajouter une tâche » place la nouvelle tâche selon la
  ligne visée, et non plus toujours en fin de conteneur.
- **Réordonner les tâches à volonté** en les glissant entre deux autres, dans leur conteneur ou
  dans un autre (étage, cycle, sous-groupe, niveau zone).
- **Tout réajuster** : comme MS Project avec « lier automatiquement les tâches insérées ou
  déplacées », la tâche placée suit celle du dessus, la chaîne se referme là où elle était, et les
  dates suivent en cascade.

Exemple de l'utilisateur : créer « Test » à la fin de PLAN SYT CYCLE 3, puis le remonter pour
l'intercaler où l'on veut et inverser l'ordre des tâches à volonté.

## 2. Décisions de l'utilisateur (14/10/2026)

| Sujet | Décision |
|---|---|
| Insertion | **Juste sous la ligne cliquée** ; sur un cycle, un sous-groupe ou un étage : à la fin de son contenu. |
| Dates et liens | **Chaînage automatique façon MS Project** ; à la suppression, la chaîne se referme aussi. |
| Stockage de l'ordre | **Nouvelle colonne `Ordre` (Texte)** dans `Planning_Projet`, créée par l'utilisateur dans le document de test le 14/10/2026 (production : à créer). |
| Ce qui se déplace | **Les tâches seulement**. Cycles et sous-groupes gardent l'ordre du modèle ; les étages restent triés par date dans leur zone. |

## 3. Données

- Nouvelle colonne **`Ordre`** (Texte, au choix de l'utilisateur) de `Planning_Projet`, lue sur les
  lignes Synthese (tâches, cycles, sous-groupes). La vue y écrit « 1 », « 2 », « 3 »… et lit la
  valeur comme un nombre (« 10 » vient après « 9 ») ; vide ou illisible = pas de rang.
- `Lien` (texte « 131 FD+5 ») porte déjà le prédécesseur d'une tâche ; le chaînage n'écrit que
  des liens « fin → début » (`FD`).
- Aucune autre colonne. Le planning Structure, ses synchronisations et les autres widgets
  ignorent les lignes Synthese : `Ordre` ne les concerne pas.

## 4. Ordre d'affichage

Un **conteneur** est le niveau zone d'une zone (tâches hors étage), un étage, un cycle ou un
sous-groupe. Son contenu s'affiche :

1. d'abord les éléments qui ont un `Ordre`, par `Ordre` croissant (à égalité : par id) ;
2. puis ceux qui n'en ont pas, dans l'**ordre par défaut** du conteneur — aujourd'hui : par date
   au niveau zone (Début, Fin, nom), par création (id) dans un étage, un cycle ou un sous-groupe.

Un conteneur jamais touché s'affiche donc exactement comme aujourd'hui. Dans un étage et un
cycle, les éléments sont des tâches et des groupes (cycles, sous-groupes) : ils partagent la même
suite de rangs. Au niveau zone, les tâches viennent toujours avant les étages, et les étages
restent triés par date.

**Renumérotation** : chaque insertion ou déplacement réécrit `Ordre` = 1, 2, 3… pour **tout** le
contenu du conteneur d'arrivée, groupes compris, dans l'ordre voulu (même écriture Grist que le
reste de l'action). Le conteneur de départ n'est pas renuméroté (un trou dans la suite ne change
rien à l'affichage).

## 5. « Ajouter une tâche » (menu clic droit)

| Ligne cliquée | Position de la nouvelle tâche |
|---|---|
| Une tâche | Juste sous elle, dans son conteneur |
| Un sous-groupe, un cycle, un étage | À la fin de son contenu |
| Une zone (ou « Sans zone ») | À la fin des tâches du niveau zone (avant les étages) |

Nom « Nouvelle tâche », durée 1 jour, saisie du nom ouverte comme aujourd'hui. Ses dates : voir
§ 7.4.

## 6. Glisser-déposer

La poignée ⠿ d'une tâche (en mode « Editer ») sert à la déplacer :

- **survol d'une tâche** : moitié haute → « Placer avant « *nom* » », moitié basse → « Placer
  après « *nom* » », dans le conteneur de cette tâche. Une **ligne d'insertion** (trait bleu
  entre deux lignes) montre où la tâche arrivera ; la légende sous le pointeur le dit en toutes
  lettres ;
- **survol d'une ligne de zone, d'étage, de cycle ou de sous-groupe** : « Déplacer à la fin de
  « *nom* » » (comme aujourd'hui ; utile pour un conteneur vide ou replié). Le conteneur visé est
  surligné comme aujourd'hui, et déplié au dépôt ;
- lâcher sur la tâche elle-même ou à la place qu'elle occupe déjà : rien ne change ;
- Échap, ou lâcher hors des lignes : annulation.

## 7. Chaînage automatique

### 7.1 Voisins

Dans la **liste des tâches** d'un étage — toutes ses tâches dans l'ordre affiché, cycles et
sous-groupes traversés, lignes de groupe ignorées — ou des tâches du niveau zone d'une zone :

- la **tâche du dessus** d'une position est la tâche qui la précède dans cette liste ;
- la **tâche du dessous** est celle qui la suit.

Rien ne traverse les étages ni les zones.

### 7.2 Placer une tâche (nouvelle ou déplacée)

Soit **T** la tâche placée, **P** la tâche du dessus, **N** la tâche du dessous, à sa nouvelle
place :

1. **T suit P** : si T est déjà liée à P (quel que soit le type), son lien est **gardé** ; sinon
   T reçoit « P FD » (sans décalage). Sans P (première tâche de la liste) : T n'a plus de lien.
2. **N suit T** seulement si N était liée à P en **« fin → début »** : N reçoit « T FD », avec son
   propre décalage (« P FD+2 » devient « T FD+2 »). Sinon N ne change pas.
3. **Jamais de boucle** : si P dépend de T (en remontant ses prédécesseurs on retombe sur T), la
   tâche de cette chaîne qui suivait T reprend l'ancien lien de T (ou plus de lien).

### 7.3 Refermer la chaîne (déplacement, suppression)

Soit **A** la tâche du dessus et **B** la tâche du dessous de T à son **ancienne** place (calculées
avant le déplacement ou la suppression) :

- si T suivait A en « fin → début » **et** B suivait T en « fin → début », B reçoit « A FD » avec
  son propre décalage ;
- sinon rien ne change à l'ancienne place.

Les autres tâches qui suivent T (lien non « fin → début », ou pas juste en dessous — par exemple
RÉSERVATIONS et TERMINAUX alignées en fin sur RÉSEAUX, ou SIGNATURE en FD+5 de VISA A) **gardent**
leur lien : déplacée, T les emmène.

Pour un déplacement, la chaîne se referme d'abord (§ 7.3), puis T est placée (§ 7.2) dans la liste
où elle n'est plus.

### 7.4 Dates

Puis, dans la même écriture :

- T prend les dates que lui donne son lien (règles actuelles des liens : jours ouvrés, fériés
  français, jalon gardé) ; sans lien, ou si son prédécesseur n'a pas de dates, elle garde les
  siennes ;
- B (chaîne refermée) prend les dates que lui donne A ;
- la tâche qui reprend l'ancien lien de T après une boucle cassée (§ 7.2, point 3) prend les dates
  que lui donne ce lien, puis sa chaîne suit — avant que T soit datée (T dépend d'elle) ;
- les tâches liées en aval de T et de B suivent en cascade (règle actuelle).

**Nouvelle tâche** : avec une tâche du dessus datée, elle commence le jour ouvré qui suit sa Fin et
dure 1 jour ; avec une tâche du dessus **non datée** (étage du modèle pas encore planifié), elle
est créée **sans dates**, durée prévue 1 jour, comme les tâches du modèle — elle prendra ses dates
avec la chaîne ; **sans tâche du dessus**, règle actuelle (le jour ouvré qui suit la plus tardive
des Fins de son conteneur, sinon aujourd'hui).

### 7.5 Suppression

- **Une tâche** : la chaîne se referme (§ 7.3), puis la ligne est supprimée.
- **Une tâche, un cycle, un sous-groupe ou un étage** : les liens des tâches restantes qui
  désignent une ligne supprimée sont **effacés** (leurs dates ne bougent pas). Grist réutilise les
  ids : sans cela, un lien orphelin se rattacherait plus tard à une tâche sans rapport.

### 7.6 Exemples (modèle d'étage, cycle 3)

Ordre affiché : RECEPTION RENDU CET (T12), VISA Indice A (T13, « T12 FD »), PLAN SYT CYCLE 3 :
[RÉSEAUX (T14, « T12 FD »), RÉSERVATIONS (T15, « T14 FF »), TERMINAUX (T16, « T14 FF »)],
REUNION + DIFFUSION (T17, « T14 FD »), SIGNATURE (T18, « T13 FD+5 »), DÉMARRAGE GO (T19,
« T18 FD »).

1. Clic droit sur TERMINAUX → « Ajouter une tâche » : « Test » arrive à la fin de PLAN SYT
   CYCLE 3, lié « T16 FD », daté le jour ouvré après la Fin de TERMINAUX. REUNION (« T14 FD »)
   ne suivait pas TERMINAUX : inchangée.
2. « Test » glissé sur la moitié haute de VISA Indice A : à l'ancienne place, rien ne suivait
   « Test ». À la nouvelle : P = RECEPTION (T12), N = VISA (« T12 FD ») → « Test » « T12 FD »,
   VISA « Test FD » ; SIGNATURE (FD+5 de VISA) et DÉMARRAGE GO suivent en cascade. RÉSEAUX
   (« T12 FD ») n'est pas juste en dessous : inchangé.
3. TERMINAUX glissé sur la moitié haute de RÉSERVATIONS : P = RÉSEAUX, déjà son prédécesseur →
   son lien « T14 FF » est gardé ; seul l'ordre change.
4. Suppression de VISA : A = « Test », B = RÉSEAUX ne suivait pas VISA → pas de chaîne à refermer ;
   SIGNATURE (lien vers VISA) perd son lien et garde ses dates.

## 8. Colonnes absentes (production aujourd'hui)

- **Sans `Ordre`** : tout fonctionne comme aujourd'hui — ordre actuel, nouvelle tâche **à la fin**
  de son conteneur, glisser vers les conteneurs seulement (« Déplacer dans … »), **pas de
  chaînage** (la position réelle d'une tâche dépendrait de son id, pas de l'endroit visé). La
  chaîne se referme quand même à la suppression si `Lien` existe.
- **Sans `Lien`** (colonnes du modèle d'étage absentes) : ni chaînage ni chaîne refermée ; seul
  l'ordre change (si `Ordre` existe). Aucune écriture de `Lien`.
- « Ajouter une tâche » sur une tâche, sans `Ordre` : la tâche est ajoutée à la fin du conteneur,
  et la barre d'état le dit : « Tâche ajoutée à la fin de « *conteneur* » : la colonne « Ordre »
  (Texte) manque dans Planning_Projet pour la placer sous « *tâche cliquée* ». »

## 9. Écritures

- Une action = **une seule écriture Grist** (`applyUserActions`) : ajout ou mise à jour de la
  tâche, renumérotation du conteneur, liens, dates, suppressions.
- **Exception** : une nouvelle tâche dont la tâche du dessous doit la suivre (§ 7.2, point 2) a
  besoin de son id avant d'écrire ce lien → **deux temps**, comme la création d'un étage : la
  tâche (avec son rang, son lien vers P et ses dates), puis le lien de N et la cascade. Si le
  second temps échoue, la tâche créée est retirée : rien de bancal ne reste dans Grist.
- Comme aujourd'hui : l'action s'affiche tout de suite (sauf la nouvelle tâche, affichée à la
  réponse de Grist), part dans la file d'écriture, vérifie projet, service et « Editer » au moment
  d'écrire, et disparaît de l'affichage si Grist la refuse.

## 10. Vue Global

Aucune modification : elle construit son arbre avec le même modèle (`buildSections`), donc suit
l'ordre et les liens. Ses contrôles (tâche contrôlée, démarrage GO, fond de plan) relisent les
dates chaînées.

## 11. Architecture

| Fichier | Rôle |
|---|---|
| `services/syntheseTaskOrder.js` (nouveau) | Pur. Rang lu (`Ordre`), comparaison des éléments d'un conteneur, position d'insertion (menu, glisser), renumérotation, liste des tâches d'un étage ou d'un niveau zone, chaînage (§ 7.2, 7.3, 7.5) et calcul des dates. |
| `services/syntheseTaskModel.js` | Lit `Ordre` (tâches, groupes) ; trie les conteneurs avec le module d'ordre ; colonne `order` dans `TASK_COLUMNS` ; détection de la colonne. |
| `ui/syntheseTasksController.js` | « Ajouter une tâche » à une position, déplacement à une position, suppression qui referme la chaîne et efface les liens orphelins ; une écriture (deux temps dans le cas du § 9). |
| `ui/syntheseTaskDrag.js` | Cible = position (avant / après une tâche, fin d'un conteneur) selon la moitié de ligne survolée ; ligne d'insertion. |
| `ui/syntheseTaskTable.js` | Menu : « Ajouter une tâche » sous la tâche cliquée ; dessin de la ligne d'insertion. |
| `assets/css/styles.css` | Ligne d'insertion. |

Non modifiés : vue Global, planning Structure, `shared/`, les autres widgets.

## 12. Tests (`node --test tests/*.test.mjs`)

- **Ordre** : conteneur sans rang (ordre actuel : date au niveau zone, création ailleurs) ; rangs
  avant les sans-rang ; groupes et tâches mêlés dans un étage et un cycle ; renumérotation.
- **Position** : menu sur une tâche, un groupe, un étage, une zone ; glisser avant / après une
  tâche, fin d'un conteneur, sans effet sur sa propre place.
- **Chaînage** : les quatre exemples du § 7.6 ; décalage gardé ; tâche parallèle (lien gardé) ;
  pas de boucle ; première tâche de la liste ; prédécesseur non daté ; changement d'étage et de
  zone ; suppression (chaîne refermée, liens orphelins effacés, aussi pour un groupe et un étage).
- **Écritures** : une seule écriture par action ; deux temps et annulation pour la nouvelle tâche
  suivie ; colonnes `Ordre` ou `Lien` absentes ; contexte changé ; affichage immédiat puis retrait
  si Grist refuse.
- **Glisser** : moitié haute / basse, légende, ligne d'insertion, Échap.
- **Vue Global** : l'ordre d'un étage réordonné se retrouve dans ses lignes.

## 13. Hors périmètre

- Déplacer un cycle, un sous-groupe ou un étage.
- Saisir ou afficher la colonne `Lien` dans le tableau (les liens se lisent sur les flèches du
  Gantt).
- Annuler (Ctrl + Z).
- Plusieurs tâches à la fois.
