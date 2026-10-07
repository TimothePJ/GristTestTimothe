# Spec — Modèle d'étage (cycles, liens, cascade des dates) de la vue Synthese (Planning Projet)

Date : 2026-10-05
Statut : design validé en conversation, en attente de relecture avant plan d'implémentation.
Prolonge :
- `docs/superpowers/specs/2026-09-23-synthese-taches-design.md` (tableau de tâches) ;
- `docs/superpowers/specs/2026-09-25-synthese-gantt-design.md` (Gantt SVG) ;
- `docs/superpowers/specs/2026-09-25-synthese-etages-design.md` (étages, glisser, flèches, file
  d'écritures).

## 1. Objectif

Clic droit sur une zone → « Ajouter un étage » ne crée plus un étage vide mais **un étage rempli
d'après le modèle de synthèse** de la capture MS Project de l'utilisateur (« NIVEAU Sous-Sol 1 ») :

1. trois **cycles** repliables (gris), dont les cycles 2 et 3 contiennent un **sous-groupe**
   repliable « PLAN SYT CYCLE n » ;
2. les **20 tâches** du modèle, dans l'ordre de la capture, avec leurs durées ; les réunions en
   **bleu**, le démarrage GO en **rouge** ;
3. **aucune date** à la création : les gens les saisissent ; dès qu'une date est saisie, les
   tâches qui en dépendent se datent **en cascade** d'après les **liens du modèle** (comme les
   liens MS Project) ;
4. deux nouvelles colonnes dans le tableau : **N°** (`ID2`) et **Indice** (`Indice`), vides à la
   création, saisies à la main ;
5. les dates d'un cycle, d'un sous-groupe et de l'étage sont des **récapitulatifs** : on ne les
   modifie pas, on modifie les tâches.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Déclenchement | « Ajouter un étage » crée toujours l'étage avec le modèle. Les étages déjà créés ne changent pas. |
| Dates à la création | Aucune. Les durées du modèle sont mémorisées (`Duree_1`) et affichées. |
| N° / Indice | Vides à la création, saisis par les gens. Une tâche avec un N° ou un Indice **reste une tâche Synthese**. |
| Liens | **Fixés par le modèle** (pas de colonne Prédécesseur modifiable). Une tâche ajoutée à la main n'a pas de lien (traité plus tard). |
| Cascade | Une modification de dates ou de durée se propage **vers l'aval** à toutes les tâches liées, en une seule écriture. |
| Stockage | Trois colonnes **Texte** créées par l'utilisateur dans `Planning_Projet` : `Nature`, `Parent`, `Lien`. |
| Qui gère une ligne | La colonne `Service` : une ligne `Service` = Synthese, `Taches` rempli, `Type_doc` vide est une ligne de la vue Synthese, ignorée par les synchronisations de documents des autres widgets. |
| Couleur d'étage | Orange clair `#fce4d6` (capture), à la place du vert. |
| Git | **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même. |

## 3. Le modèle d'étage

`{E}` = nom de l'étage. Durée en jours ouvrés (0 = jalon). Lien : `FD` fin → début, `DD` début →
début, `FF` fin → fin, `+n` = décalage en jours ouvrés.

| Code | Ligne | Nature | Dans | Durée | Lien |
|---|---|---|---|---|---|
| T0 | RECEPTION ARCH/TOPO/STR | | étage | 0 | — |
| C1 | CYCLE 1 | Cycle | étage | | |
| T1 | FOND DE PLAN DE SYNTHESE NIV {E} | | C1 | 2 | T0 DD |
| T2 | DIFFUSION FDS Indice 0 | | C1 | 0 | T1 FD |
| T3 | RECEPTION RENDU CET RESEAUX (GED) | | C1 | 10 | T2 FD |
| T4 | VISA Indice 0 | | C1 | 10 | T3 FD |
| T5 | PLAN DE SYNTHESE RESEAUX NIV {E} | | C1 | 5 | T3 FD |
| T6 | REUNION + DIFFUSION SYT RSX Indice 0 | Reunion | C1 | 0 | T5 FD |
| C2 | CYCLE 2 | Cycle | étage | | |
| T7 | RECEPTION RENDU CET RSX RESA TER | | C2 | 5 | T6 FD |
| S2 | PLAN SYT CYCLE 2 | Sous-groupe | C2 | | |
| T8 | PLAN DE SYNTHESE RESEAUX NIV {E} | | S2 | 5 | T7 FD |
| T9 | PLAN DE SYNTHESE RESERVATIONS NIV {E} | | S2 | 2 | T8 FF |
| T10 | PLAN DE SYNTHESE TERMINAUX NIV {E} | | S2 | 2 | T8 FF |
| T11 | REUNION + DIFFUSION SYT | Reunion | C2 | 0 | T8 FD |
| C3 | CYCLE 3 | Cycle | étage | | |
| T12 | RECEPTION RENDU CET RSX RESA TER | | C3 | 5 | T11 FD |
| T13 | VISA Indice A | | C3 | 10 | T12 FD |
| S3 | PLAN SYT CYCLE 3 | Sous-groupe | C3 | | |
| T14 | PLAN DE SYNTHESE RESEAUX NIV {E} | | S3 | 5 | T12 FD |
| T15 | PLAN DE SYNTHESE RESERVATIONS NIV {E} | | S3 | 2 | T14 FF |
| T16 | PLAN DE SYNTHESE TERMINAUX NIV {E} | | S3 | 2 | T14 FF |
| T17 | REUNION + DIFFUSION SYT | Reunion | C3 | 0 | T14 FD |
| T18 | SIGNATURE PLANS SYNTHESE | | C3 | 0 | T13 FD+5 |
| T19 | DEMARRAGE GO {E} (date prévisionnelle) | Demarrage | C3 | 0 | T18 FD |

Soit 26 lignes avec la ligne-étage (comme les lignes 2 à 27 de la capture).

**Contrôle** : en saisissant le Début de T0 au Ven 02/01/26, la cascade doit redonner exactement
la capture : T1 02/01 → 05/01 ; T2 05/01 ; T3 06/01 → 19/01 ; T4 20/01 → 02/02 ; T5 20/01 → 26/01 ;
T6 26/01 ; T7 27/01 → 02/02 ; T8 03/02 → 09/02 ; T9, T10 06/02 → 09/02 ; T11 09/02 ; T12 10/02 →
16/02 ; T13 17/02 → 02/03 ; T14 17/02 → 23/02 ; T15, T16 20/02 → 23/02 ; T17 23/02 ; T18 09/03 ;
T19 09/03. Récapitulatifs : cycle 1 = 22 jours (02/01 → 02/02), cycle 2 = 10 jours (27/01 →
09/02), cycle 3 = 20 jours (10/02 → 09/03), PLAN SYT CYCLE 2 = 5 jours (03/02 → 09/02), étage =
47 jours (02/01 → 09/03).

Le modèle vit dans un module à part (`services/syntheseFloorTemplate.js`), sous forme de données :
le changer plus tard ne touche pas au reste.

## 4. Données (Planning_Projet)

Colonnes nouvelles, toutes de type **Texte** (créées par l'utilisateur en test ; à créer en
production avant la mise en service) :

| Colonne | Contenu |
|---|---|
| `Nature` | vide = tâche normale ; `Cycle` ; `Sous-groupe` ; `Reunion` (tâche bleue) ; `Demarrage` (tâche rouge). Lecture tolérante : sans accents ni casse (« Réunion » = « reunion »). |
| `Parent` | id (texte, ex. « 123 ») de la ligne Cycle ou Sous-groupe qui contient la ligne ; vide = directement sous l'étage (ou au niveau zone hors étage). |
| `Lien` | prédécesseur : `<id> FD`, `<id> DD`, `<id> FF`, avec décalage facultatif `+n` ou `-n` (ex. `131 FD+5`). Vide = pas de lien. |

Colonnes existantes utilisées : `Taches`, `Zone`, `Groupe` (nom de l'étage), `Etage`,
`Diff_coffrage` (Début), `Diff_armature` (Fin), `Duree_1`, `ID2` (N°), `Indice`, `NomProjet`,
`Service`, `Type_doc`.

**Lignes de l'étage**

| Ligne | Etage | Groupe | Nature | Parent | Lien | Dates / Duree_1 |
|---|---|---|---|---|---|---|
| étage | true | vide | vide | vide | vide | aucune |
| cycle | — | nom de l'étage | Cycle | vide | vide | aucune (récapitulatif) |
| sous-groupe | — | nom de l'étage | Sous-groupe | id du cycle | vide | aucune (récapitulatif) |
| tâche | — | nom de l'étage | vide / Reunion / Demarrage | id du cycle ou du sous-groupe, ou vide | selon le modèle | `Duree_1` du modèle, pas de dates à la création |

Toutes les lignes de l'étage portent `Groupe` = nom de l'étage : supprimer ou renommer l'étage
les emporte toutes (règles existantes, étendues aux cycles et sous-groupes).

**Reconnaissance des lignes** (`syntheseTaskModel.js`) :
- ligne Synthese = id valide, `Taches` non vide, `Type_doc` vide, et (`ID2` vide **ou** `Service`
  = Synthese, comparé sans accents ni casse) ;
- étage = ligne Synthese avec `Etage` vrai (inchangé) ;
- cycle / sous-groupe (« groupe ») = ligne Synthese, `Etage` faux, `Nature` = Cycle / Sous-groupe ;
- tâche = ligne Synthese ni étage ni groupe.

**Colonnes absentes** : détectées comme `Etage` aujourd'hui (au moins une ligne lue et aucune ne
porte le champ). Si `Nature`, `Parent` ou `Lien` manque, « Ajouter un étage » est grisé avec :
« Les colonnes « Nature », « Parent » et « Lien » (Texte) manquent dans Planning_Projet : ajoutez-les
pour créer des étages. » Sans elles, la lecture marche : tout est lu comme des tâches simples.

## 5. Modèle (calcul pur)

### 5.1 Hiérarchie et ordre

Zone → tâches du niveau zone et étages → (tâches de l'étage et cycles) → (tâches du cycle et
sous-groupes) → tâches du sous-groupe.

- Un groupe (cycle ou sous-groupe) appartient à l'étage de son `Groupe` dans sa zone ; un
  sous-groupe à son cycle (`Parent`).
- Une tâche va dans le groupe nommé par son `Parent` s'il existe **dans le même étage** ; sinon
  directement dans son étage (lien cassé, groupe supprimé). Un groupe dont le `Parent` ne désigne
  pas un cycle du même étage se range directement dans l'étage.
- Pas de groupe hors étage : un cycle dont le `Groupe` est vide (ou qui est dans « Sans zone »)
  est ignoré et ses tâches se rangent comme si elles n'avaient pas de `Parent`. (Un `Groupe` qui
  nomme un étage sans ligne-étage fait exister cet étage, règle actuelle.)
- **Ordre** : dans un étage, un cycle ou un sous-groupe, **ordre de création** (id croissant),
  tâches et groupes mêlés — c'est l'ordre du modèle. Cela vaut aussi pour les étages existants,
  jusqu'ici triés par date. Le niveau zone garde son ordre actuel (tâches hors étage en haut par
  date, puis étages par date).

### 5.2 Lecture d'une tâche

`readTask` lit en plus `nature`, `parentId`, `link` (`{ predId, type, lag }` ou null), `id2`,
`indice`, et la **durée prévue** :
- tâche datée : comme aujourd'hui ;
- tâche sans dates : `durationDays` = `Duree_1` s'il est un entier ≥ 0, sinon null ; affichée
  « 10 jours » / « 0 jour » avec Début et Fin « — ».

### 5.3 Récapitulatifs

Étage, cycle et sous-groupe : `summarizeTasks` sur **toutes leurs tâches descendantes**. Une
précision de la règle MS Project : un jalon dont le lien est `FD` se place en **fin de journée**
et compte son jour (comme les jalons qui suivent une tâche dans MS Project) ; les autres jalons
restent au début de leur jour (règle actuelle, cas « PH RDB »). C'est ce qui donne 47 / 22 / 10 /
20 jours au § 3. `endsWithMilestone` (Gantt) est faux quand le dernier jalon est en fin de
journée.

### 5.4 Saisies

- **Durée sur une tâche sans dates** : seule `Duree_1` est écrite, aucune date n'est créée
  (changement : aujourd'hui la tâche est datée à partir d'aujourd'hui).
- **Début ou Fin sur une tâche sans dates** : la durée prévue sert — Début saisi → Fin = Début +
  durée prévue ; Fin saisie → Début calculé à rebours ; durée prévue 0 → jalon à cette date ;
  durée prévue inconnue → tâche d'un jour (comme aujourd'hui).
- **N°** (`ID2`) et **Indice** (`Indice`) : texte libre, espaces retirés aux bouts, vide permis,
  50 caractères au plus. Seulement sur les tâches.
- Le reste des saisies est inchangé.

### 5.5 Cascade

`cascadeFrom(changedTask, tasks)` → liste des tâches à réécrire (nouvelles dates + `Duree_1`).

- Successeurs = tâches dont le `Lien` désigne la tâche modifiée, puis leurs successeurs, de proche
  en proche (parcours en largeur ; une tâche déjà traitée ne l'est pas deux fois : une boucle
  saisie à la main dans Grist s'arrête).
- Successeur dont le prédécesseur n'a pas de dates : inchangé (et ses propres successeurs aussi).
- Durée du successeur : sa durée actuelle s'il est daté, sinon sa durée prévue ; inconnue → 1 jour.
- Calcul, `n` = décalage (jours ouvrés) :

| Lien | Successeur tâche (durée d ≥ 1) | Successeur jalon |
|---|---|---|
| FD+n | Début = jour ouvré suivant la Fin du prédécesseur, + n jours ouvrés ; Fin = Début + d | date = Fin du prédécesseur + n jours ouvrés |
| DD+n | Début = Début du prédécesseur + n jours ouvrés ; Fin = Début + d | date = Début du prédécesseur + n |
| FF+n | Fin = Fin du prédécesseur + n jours ouvrés ; Début à rebours de d | date = Fin du prédécesseur + n |

  Un décalage négatif recule d'autant de jours ouvrés. Le résultat est recalé sur les jours
  ouvrés (Début au suivant, Fin au précédent).
- La tâche modifiée garde la date saisie, même si elle contredit son propre lien : la propagation
  ne remonte jamais vers l'amont.
- Un `Lien` illisible ou vers une ligne absente est ignoré.

### 5.6 Création d'un étage

`buildFloorFromTemplate({ floorName, zoneName, projectName })` → `{ rows, links }` :
- `rows` : les 26 lignes dans l'ordre du § 3 (champs d'`AddRecord`, `Nature`, `Groupe`, `Duree_1`,
  pas de dates, `Parent` et `Lien` vides) ;
- `links(ids)` : à partir des ids rendus par Grist dans l'ordre des lignes, les champs `Parent` et
  `Lien` à écrire (texte).

Nom de l'étage : `nextFloorName` (« Nouvel étage », « Nouvel étage 2 »…), comme aujourd'hui.

### 5.7 Renommer un étage

En plus du `Groupe` de toutes ses lignes (tâches, cycles, sous-groupes), dans le nom de ses
tâches : « NIV <ancien nom> » → « NIV <nouveau nom> » et « GO <ancien nom> » → « GO <nouveau nom> »
(nom exact, suivi d'un espace, d'une parenthèse ou de la fin du texte). Une seule écriture.

### 5.8 Groupes

- Renommer un cycle / sous-groupe : `Taches` de sa ligne (nom non vide, 200 caractères au plus ;
  doublons permis).
- Supprimer : la ligne du groupe et **tout son contenu** (sous-groupe, tâches), une écriture
  `BulkRemoveRecord`, après confirmation : « Supprimer « CYCLE 2 » et ses 5 tâches ? » (« …et sa
  tâche ? », « Supprimer « CYCLE 2 » ? » s'il est vide). Les liens qui pointaient vers des tâches
  supprimées sont ignorés ensuite.
- Ajouter une tâche dans un groupe : à la fin du groupe (id le plus grand), `Parent` = le groupe,
  `Groupe` = l'étage, sans lien ; dates : règle actuelle (jour ouvré après la dernière Fin du
  groupe, ou aujourd'hui).

### 5.9 Modèle de lignes

| Ligne | `kind` | `level` |
|---|---|---|
| Zone | `zone` | 0 |
| Tâche du niveau zone / Étage | `task` / `floor` | 1 |
| Tâche de l'étage / Cycle | `task` / `group` | 2 |
| Tâche du cycle / Sous-groupe | `task` / `group` | 3 |
| Tâche du sous-groupe | `task` | 4 |

- Ligne de groupe : clé `group:<id>`, `groupRowId`, `nature` (`Cycle` / `Sous-groupe`),
  récapitulatif et drapeaux de jalon comme un étage, `collapsed`, `childCount`.
- Ligne de tâche : en plus, `nature`, `parentId`, `link`, `id2`, `indice`.
- Repli des groupes : clé `group:<id>`, en mémoire, oublié au changement de projet (comme les
  étages).

## 6. Contrôleur (`ui/syntheseTasksController.js`)

- **Ajouter un étage** : une opération de la file d'écritures (contexte vérifié au départ, § 8 de
  la spec étages) en deux temps : `BulkAddRecord` des 26 lignes, puis `BulkUpdateRecord` de
  `Parent` / `Lien` avec les ids rendus. Si le second temps échoue : `BulkRemoveRecord` des lignes
  créées et message « L'étage n'a pas pu être créé complètement : rien n'a été gardé. Réessayez. »
  Après succès : zone et étage dépliés, saisie du nom de l'étage ouverte (comme aujourd'hui).
- **Saisie de dates / durée** : la modification de la tâche et la cascade partent dans **une seule**
  écriture (`UpdateRecord` + `BulkUpdateRecord`), affichée tout de suite en surimpression ; en cas
  d'échec, tout revient à l'état lu.
- **N° / Indice** : `UpdateRecord` d'`ID2` / `Indice`.
- **Groupes** : renommer, supprimer (confirmation), ajouter une tâche (§ 5.8), replier.
- **Glisser** : une tâche lâchée sur un cycle / sous-groupe ou une de ses tâches y entre (`Zone`,
  `Groupe`, `Parent` écrits — seulement ce qui change) ; sur l'étage ou une tâche directe de
  l'étage → niveau étage (`Parent` vidé) ; au niveau zone → `Groupe` et `Parent` vidés. Son `Lien`
  est gardé. Les groupes ne se glissent pas.

## 7. Tableau (`ui/syntheseTaskTable.js`) et CSS

- Colonnes : **Nom | N° | Indice | Durée | Début | Fin** (N° et Indice ~56 px, modifiables sur les
  tâches, vides sur les autres lignes).
- Retrait d'un cran par niveau (§ 5.9). Triangle de repli sur les zones, étages et groupes.
- Couleurs (capture), sur toute la partie gauche de la ligne :
  - étage : orange clair `#fce4d6`, gras (remplace le vert `#c6e0b4`) ;
  - cycle : gris `#bfbfbf`, gras ;
  - sous-groupe : sans fond, gras ;
  - tâche `Reunion` : bleu `#bdd7ee` ;
  - tâche `Demarrage` : rouge `#e6b8b7`.
- Menu du clic droit :

| Ligne | Entrées |
|---|---|
| Zone (sauf « Sans zone ») | Ajouter une tâche, Ajouter un étage |
| Étage | Ajouter une tâche (niveau étage), Supprimer l'étage |
| Cycle / sous-groupe | Ajouter une tâche (dans le groupe), Supprimer le cycle / le sous-groupe |
| Tâche | Ajouter une tâche (même conteneur), Supprimer la tâche |

- Nom d'un cycle / sous-groupe : clic, Entrée ou F2 ouvre la saisie (comme un étage).

## 8. Gantt

- Cycle et sous-groupe : crochet comme l'étage (mêmes règles de jalon au début / à la fin), nom à
  droite.
- **Flèches** :
  - tâche qui a un `Lien` vers une tâche visible et datée : flèche du lien —
    - `FD` : du bout droit du prédécesseur vers le début du successeur (tracés actuels : direct,
      ou détour en S si le successeur commence avant) ;
    - `DD` : du bout gauche du prédécesseur, 6 px à gauche, descente, vers le début du successeur ;
    - `FF` : du bout droit du prédécesseur, 6 px à droite, descente au milieu de la ligne du
      successeur, retour vers sa fin, pointe vers la gauche ;
    - le prédécesseur peut être plusieurs lignes au-dessus (ou au-dessous) : le trait vertical
      traverse les lignes intermédiaires ;
  - groupe (étage, cycle, sous-groupe, niveau zone) où **aucune** tâche n'a de `Lien` : flèches
    actuelles entre tâches consécutives du groupe (dessin seul) ;
  - ligne repliée ou non datée : pas de flèche.

## 9. Autres widgets (protections)

« Tâche Synthese » = `Service` = Synthese (sans accents ni casse), `Taches` rempli, `Type_doc` vide.

| Widget | Changement |
|---|---|
| Planning Projet — recalcul automatique (`planningSyncCoordinator.js`) | Écarte déjà `isSyntheseRow` : la nouvelle reconnaissance (§ 4) y inclut les tâches avec N°. Indice, Realise, Retards ne sont plus écrasés. |
| ListeDePlan — `syncPlanningProjetIndicesFromListeDePlan` (`affichage.js`) | Saute les tâches Synthese (leur `Indice` n'est plus effacé). Attention : fichier aux fins de ligne mélangées (CRLF / LF) — vérifier `git diff` contre `git diff -w`. |
| planning-synchro — `isDocumentRow` (`bottom/documentCharge.js`) | Une tâche Synthese n'est pas un document (même avec un N°). |
| gestion-depenses2 (et Gestion-globale, qui réutilise `projectService.js`) | L'`Indice` d'une tâche Synthese est ignoré pour l'avancement (pas de faux « 100 % réalisé »). |

Les vrais documents du service Synthese (avec `Type_doc`) ne changent pas.

## 10. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Colonnes `Nature` / `Parent` / `Lien` absentes | « Ajouter un étage » grisé + message (§ 4) ; une écriture refusée par Grist sur ces colonnes donne le même message. |
| Échec du second temps de la création | Lignes créées supprimées, message (§ 6). |
| `Parent` vers une ligne absente ou d'un autre étage | La ligne se range directement dans son étage. |
| `Lien` illisible, vers une ligne absente, ou boucle | Ignoré / arrêté (§ 5.5). |
| Successeur d'une tâche non datée | Inchangé. |
| Projet ou service changé avant le départ d'une écriture | Refus (file existante). |
| Lecture seule ou « Editer » inactif | Pas de saisie, pas de menu, pas de poignée (inchangé). |

## 11. Architecture

| Fichier | Rôle |
|---|---|
| `services/syntheseFloorTemplate.js` (nouveau) | Données du modèle (§ 3) et `buildFloorFromTemplate`. Pur. |
| `services/syntheseLinks.js` (nouveau) | Lecture / écriture du texte `Lien`, calcul d'une date liée (§ 5.5), `cascadeFrom`. Pur. |
| `services/syntheseTaskModel.js` | Reconnaissance (Service, groupes), lecture `Nature` / `Parent` / `Lien` / `ID2` / `Indice` / durée prévue, hiérarchie et ordre de création, récapitulatifs (jalon FD), modèle de lignes à 5 niveaux, saisies (§ 5.4), renommage d'étage étendu, actions des groupes, cible de dépôt, détection des colonnes. |
| `ui/syntheseTasksController.js` | Création en deux temps, cascade dans l'écriture, N° / Indice, groupes, glisser vers un groupe. |
| `ui/syntheseTaskTable.js` | Colonnes N° / Indice, lignes de groupe, couleurs, menus, saisie du nom de groupe. |
| `ui/syntheseTaskDrag.js` | Cibles de dépôt sur les groupes (légende « Déplacer dans « CYCLE 2 » »). |
| `services/syntheseGanttGeometry.js`, `ui/syntheseGantt.js` | Crochets des groupes, flèches des liens (FD / DD / FF, lignes éloignées). |
| `assets/css/styles.css` | Colonnes, couleurs, retraits. |
| `index.html` | Versions des scripts et de la feuille de style relevées. |
| `ListeDePlan/affichage.js`, `planning-synchro/assets/js/bottom/documentCharge.js`, `gestion-depenses2/assets/js/services/projectService.js` | Protections (§ 9). |

## 12. Tests

- **Modèle d'étage** : 26 lignes, ordre, natures, `Groupe`, durées, pas de dates ; `links(ids)`
  donne les bons `Parent` / `Lien` ; noms avec `{E}`.
- **Liens** : lecture / écriture du texte (`131 FD+5`, `12 DD`, `7 FF-2`, illisible) ; FD / DD /
  FF, avec décalage positif / négatif, vers une tâche et vers un jalon ; week-ends et fériés ;
  **contrôle de la capture** (§ 3) : T0 au 02/01/26 → toutes les dates ; prédécesseur non daté ;
  boucle ; lien cassé.
- **Modèle de tâches** : reconnaissance (tâche Synthese avec N°, document Synthese avec type,
  ligne d'un autre service avec ID2, groupes) ; hiérarchie (Parent cassé, groupe d'un autre
  étage, cycle sans étage) ; ordre de création ; récapitulatifs (47 / 22 / 10 / 20 / 5 jours) ;
  durée prévue affichée ; saisies (§ 5.4) ; renommage d'étage (NIV / GO) ; suppression de groupe ;
  modèle de lignes (niveaux, clés, repli de groupe).
- **Contrôleur** : création en deux temps (champs, ids, `Parent` / `Lien`) et annulation si le
  second temps échoue ; cascade dans une seule écriture et retour arrière si échec ; N° / Indice ;
  groupes ; glisser vers un groupe ; colonnes absentes.
- **Tableau** : colonnes, retraits, classes de couleur, menus par genre de ligne.
- **Gantt** : crochets des groupes ; flèches FD / DD / FF, lignes éloignées, repli ; repli sur les
  flèches actuelles quand aucun lien.
- **Autres widgets** : tests existants verts ; nouveaux cas pour `isDocumentRow` et l'avancement
  de gestion-depenses2 ; ListeDePlan vérifié sur le code (pas de suite de tests dédiée).
- **Vérification visuelle** : test manuel de l'utilisateur sur localhost (Ctrl+F5).

## 13. Hors périmètre

- Colonne Prédécesseur modifiable, liens des tâches ajoutées à la main.
- Plusieurs prédécesseurs par tâche.
- Glisser un cycle ou un sous-groupe ; réordonner à la main.
- N° / Indice pré-remplis ; lien avec les documents de ListeDePlan.
- Couleurs dans le Gantt pour les réunions et le démarrage.
- Modifier le modèle depuis l'interface.
