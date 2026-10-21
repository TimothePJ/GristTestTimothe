# Vue Synthese — cycles imbriqués à profondeur libre

Date : 20/10/2026. Widget : Planning Projet, vue Synthese (tableau de tâches + Gantt). Statut : à
relire par l'utilisateur.

## 1. Objectif

Aujourd'hui, la hiérarchie d'un étage est figée : étage → cycle → sous-groupe → tâche. Seul le
modèle « Ajouter un étage » crée des cycles, et ni les cycles ni les sous-groupes ne se déplacent.

On veut :

- **Créer des cycles à la main** : un cycle dans un étage, un sous-cycle dans un cycle, un
  sous-cycle dans un sous-cycle, et ainsi de suite, sans limite de profondeur.
- **Déplacer les cycles par glisser-déposer** pour les intervertir ou les ranger dans un autre
  cycle.
- **Tout réaligner** quand un cycle bouge : la chaîne de liens se refait à l'ancienne et à la
  nouvelle place, et toutes les dates suivent.

Exemple de l'utilisateur, sur son étage SS1 (zone « Zone 1 / BAT BC ») : intervertir CYCLE 2 et
CYCLE 1, ou CYCLE 3 et CYCLE 2, et voir les dates se recaler.

## 2. Décisions de l'utilisateur (20/10/2026)

| Sujet | Décision |
|---|---|
| Où vivent les cycles | Un cycle est **sous un étage** ; un sous-cycle est **sous un cycle ou un sous-cycle**. Jamais sous une tâche. |
| Création | Clic droit sur un **étage** → nouveau cycle ; clic droit sur un **cycle ou un sous-cycle** → nouveau sous-cycle. **Rien de nouveau dans le menu d'une tâche.** |
| Profondeur | Libre (« et ainsi de suite »). |
| Glisser-déposer | Les cycles se glissent pour s'intervertir. |
| Liens et dates | Un cycle déplacé **re-chaîne et recale tout** (règle du bloc, §7.4). |
| Cycle qui prend la tête | Si la place visée était tenue par un lien autre que FD (cas de CYCLE 1, dont le FOND DE PLAN est en DD sur la RECEPTION), le cycle qui arrive **reprend ce lien d'entrée** et l'ancien occupant le suit en FD. L'utilisateur accepte que le contrôle « fond de plan / 0 Prev » le signale ensuite. |

## 3. Données

**Aucune nouvelle colonne.** Un cycle reste une ligne de `Planning_Projet` du service Synthese,
sans `Type_doc` :

| Colonne | Valeur sur une ligne de cycle |
|---|---|
| `Taches` | nom du cycle |
| `Nature` | `Cycle` s'il est directement dans l'étage, `Sous-groupe` s'il est dans un autre cycle |
| `Parent` | id (texte) du cycle qui le contient ; vide s'il est directement dans l'étage |
| `Groupe` | nom de l'étage |
| `Zone`, `NomProjet` | ceux de l'étage |
| `Ordre` | rang dans son conteneur (même suite que les tâches) |
| `Duree_1` | 0 ; pas de dates (les dates d'un cycle sont le récapitulatif de ses tâches) |

- Les valeurs `Cycle` et `Sous-groupe` sont lues **à l'identique** : toutes deux font de la ligne
  un cycle. C'est la **place** de la ligne (son `Parent`) qui dit s'il s'agit d'un cycle ou d'un
  sous-cycle, pas la valeur stockée.
- Le widget écrit quand même la valeur qui correspond à la place (création et déplacement), pour
  que la table reste lisible dans Grist.
- Les « PLAN SYT CYCLE n » existants (`Sous-groupe` avec `Parent` = un cycle) deviennent des
  sous-cycles ordinaires : on peut les déplacer, y créer des sous-cycles, etc.
- Aucun autre widget ne lit `Nature` (vérifié le 20/10/2026) ; le planning Structure ignore les
  lignes Synthese.

## 4. Lecture de la hiérarchie

Pour chaque étage (zone + nom d'étage, comme aujourd'hui) :

1. **Parent d'un cycle** : le cycle du **même étage** dont l'id vaut son `Parent`. Si `Parent` est
   vide, illisible, désigne la ligne elle-même, ou désigne une ligne qui n'est pas un cycle de cet
   étage, le cycle est **directement dans l'étage**.
   - Changement par rapport à aujourd'hui : un sous-groupe pouvait seulement être dans un cycle,
     et un cycle était toujours dans l'étage, quel que soit son `Parent`. Les données actuelles
     (cycles sans `Parent`, sous-groupes dont le `Parent` est un cycle) s'affichent à l'identique.
2. **Boucle** (A dans B, B dans A, ou plus long) : données corrompues. Le cycle de la boucle qui a
   le plus petit id est placé directement dans l'étage, ce qui casse la boucle. Rien n'est écrit
   pour réparer.
3. **Tâche** : dans le cycle de l'étage désigné par son `Parent`, sinon directement dans l'étage
   (inchangé).
4. **Contenu d'un conteneur** (étage ou cycle) : ses tâches et ses cycles enfants, d'abord par
   `Ordre`, puis par id (inchangé).
5. **Récapitulatif d'un cycle** (Début, Fin, Durée) : toutes les tâches qu'il contient, à toute
   profondeur (inchangé dans son principe).
6. **Profondeur** d'un cycle : 1 s'il est directement dans l'étage, 2 dans un cycle de
   profondeur 1, etc.

## 5. Affichage

- **Niveaux** : zone 0, étage 1, contenu d'un étage 2, et un cran de plus par cycle imbriqué, sans
  limite (le modèle de lignes est déjà récursif).
- **Retrait du nom** : 16 px par niveau, sans plafond. Mêmes valeurs qu'aujourd'hui pour les
  niveaux existants : ligne de cycle = 16 × niveau px (32 px au niveau 2, 48 px au niveau 3) ;
  tâche d'étage = 14 + 16 × niveau px (46, 62, 78 px aux niveaux 2, 3, 4). Les classes CSS par
  niveau sont remplacées par une variable CSS posée sur la ligne.
- **Aspect** :
  - cycle de profondeur 1 : bande grise, comme les cycles d'aujourd'hui ;
  - sous-cycle (profondeur ≥ 2) : en gras sans bande, comme les sous-groupes d'aujourd'hui.
  L'aspect suit la profondeur, pas la valeur stockée de `Nature`.
- **Libellés** : l'interface dit « sous-cycle » là où elle disait « sous-groupe » (menu, aide à la
  saisie, messages). La saisie du nom d'un cycle s'intitule « Nom du cycle ». Les tests existants
  qui fixent les anciens libellés et les classes par niveau sont mis à jour en conséquence.
- **Gantt** : une accolade par cycle, à toute profondeur (déjà le cas pour toute ligne de cycle).
- **Vue Global** : les lignes Synthèse d'un étage suivent la même imbrication (son arbre est
  construit niveau par niveau depuis le même modèle de lignes) ; la bande grise y suit aussi la
  profondeur.

## 6. Création

### 6.1 Menu clic droit

| Ligne cliquée | Entrées du menu, dans l'ordre |
|---|---|
| Étage | Ajouter une tâche · **Ajouter un cycle** · Supprimer l'étage |
| Cycle ou sous-cycle | Ajouter une tâche · **Ajouter un sous-cycle** · Supprimer le cycle / Supprimer le sous-cycle |
| Tâche, zone, « Sans zone » | inchangé (aucune entrée de cycle) |

Le menu ne s'ouvre qu'en mode « Editer », comme aujourd'hui.

### 6.2 Résultat

- **Ajouter un cycle** (sur un étage) : un cycle vide nommé « Nouveau cycle », à la **fin** du
  contenu de l'étage.
- **Ajouter un sous-cycle** (sur un cycle ou un sous-cycle C) : un sous-cycle vide nommé
  « Nouveau sous-cycle », à la **fin** du contenu de C.
- Colonnes écrites : celles du §3. `Etage` n'est pas écrit (faux par défaut dans Grist).
- Avec `Ordre` : le conteneur est renuméroté 1, 2, 3… dans la même écriture, le nouveau cycle en
  dernier. Sans `Ordre` : pas de rang ; le nouveau cycle, d'id le plus grand, vient de toute façon
  en dernier.
- Aucun lien ni aucune date n'est écrit : le cycle est vide.
- Le nouveau cycle apparaît quand Grist a répondu (il faut son id), comme une tâche ajoutée. La
  zone, l'étage et toute la chaîne des cycles qui le contiennent sont dépliés, puis la **saisie de
  son nom s'ouvre** tout de suite.
- Barre d'état : « Cycle ajouté dans l'étage « SS1 ». » / « Sous-cycle ajouté dans « CYCLE 2 ». ».

### 6.3 Colonnes manquantes

La création demande `Nature` et `Parent`. On réutilise la détection existante des colonnes du
modèle d'étage (`Nature`, `Parent`, `Lien` ensemble) : sans elles, les deux entrées sont **grisées
mais cliquables**, et le clic explique : « Les colonnes « Nature », « Parent » et « Lien » (Texte)
manquent dans Planning_Projet : ajoutez-les pour créer des cycles. »

## 7. Glisser-déposer

### 7.1 Ce qui se glisse

- Les **cycles et sous-cycles**, à toute profondeur, par la poignée ⠿, en mode « Editer », comme
  les tâches. Le cycle part avec tout son contenu.
- Il faut les colonnes `Ordre` et `Nature`/`Parent` (même détection qu'au §6.3). Sans elles, pas
  de poignée sur les cycles.
- Les étages et les zones ne se glissent pas.
- La copie qui suit le pointeur est la ligne du cycle seule ; le repli du cycle déplacé est gardé.

### 7.2 Où lâcher

Pour un cycle **C** de l'étage **F** :

| Ligne survolée | Moitié haute | Moitié basse |
|---|---|---|
| Tâche T de F, hors de C | Placer avant T (dans le conteneur de T) | Placer après T (dans le conteneur de T) |
| Cycle K de F, hors de C | Placer avant K (dans le conteneur de K) | Déplacer à la fin de K (dedans) |
| Étage F | Déplacer à la fin de l'étage | idem |
| C lui-même, ou toute ligne contenue dans C | rien | rien |
| Autre étage, zone, tâche hors étage, ligne d'un autre étage | rien | rien |

- « Rien » : pas de légende, pas de trait, et lâcher ne fait rien.
- Lâcher à la même place ne fait rien (aucune écriture).
- Un cycle ne quitte jamais son étage : pas de déplacement vers un autre étage ni une autre zone.

**Tâches glissées** (comportement existant, une seule nouveauté) : sur une ligne de cycle, la
moitié haute place maintenant la tâche **avant le cycle**, dans le conteneur du cycle ; la moitié
basse la met, comme aujourd'hui, à la fin du cycle. Le reste ne change pas.

**Repères visuels** :
- « Placer avant / après » : trait d'insertion à la limite des deux lignes. Le trait **commence au
  retrait du niveau visé**, pour distinguer « après la dernière tâche de CYCLE 1 » (dans CYCLE 1)
  de « avant CYCLE 2 » (dans l'étage), qui tombent sur la même limite.
- « À la fin de » : l'en-tête du conteneur est surligné, comme aujourd'hui.
- La légende dit la destination (« Placer avant « CYCLE 1 » », « Déplacer à la fin de
  « CYCLE 2 » »).

### 7.3 Écritures

Une seule écriture Grist, tout ou rien :

- le cycle C : `Parent` (id du cycle d'arrivée, vide dans l'étage) et `Nature` (`Cycle` ou
  `Sous-groupe` selon sa nouvelle profondeur), seulement s'ils changent ;
- son contenu (tâches et sous-cycles) : rien, sa chaîne de `Parent` reste valable et l'étage ne
  change pas ;
- `Ordre` : tout le conteneur d'arrivée renuméroté 1, 2, 3…, C compris ; le conteneur de départ
  n'est pas renuméroté (un trou dans la suite ne change rien), comme pour les tâches ;
- avec `Lien` : les liens et les dates du §7.4.

Le conteneur d'arrivée et ses parents sont dépliés.

### 7.4 Liens et dates : la règle du bloc

**Idée** : un cycle se déplace comme un **bloc de tâches**, et le lien d'entrée appartient à la
place, pas au bloc.

**Définitions**
- **Ordre de chaîne** : la liste des tâches de l'étage dans l'ordre affiché, cycles traversés
  (c'est l'ordre déjà utilisé pour enchaîner les tâches ; il ne traverse ni étages ni zones).
- **Bloc** : les tâches de C dans cet ordre, à toute profondeur. **D** est sa première tâche,
  **L** sa dernière. Un cycle sans tâche ne change ni lien ni date : seul l'ordre bouge.
- **Lien d'entrée du bloc** : le lien de D s'il désigne une tâche hors du bloc (quel que soit son
  type, décalage compris) ; sinon, aucun.
- **Tâche de sortie X** : la tâche du bloc que suivait en FD la tâche juste en dessous du bloc, à
  son ancienne place ; à défaut, la tâche du bloc qui finit le plus tard (à égalité, la dernière
  dans l'ordre de chaîne ; si rien n'est daté, L). Dans un « PLAN SYT CYCLE n » du modèle d'étage,
  X est le plan RESEAUX (la REUNION qui suit le sous-cycle est liée à lui, pas à TERMINAUX, la
  dernière ligne affichée).

**1. Ancienne place : la chaîne se referme.** B est la tâche juste en dessous du bloc. Si B
suivait en FD une tâche du bloc, B **reprend le lien d'entrée** :
- lien d'entrée FD sur une tâche → B suit cette tâche en FD, avec son propre décalage (même règle
  que pour une tâche) ;
- lien d'entrée d'un autre type (DD, FF…) → B le reprend exactement ;
- aucun lien d'entrée (le bloc était en tête, ou D n'avait pas de lien) → B n'a plus de lien et
  garde ses dates.

Sinon, rien ne change ici.

**2. Nouvelle place : le bloc s'insère.** P est la tâche juste au-dessus du bloc à sa nouvelle
place, N celle juste en dessous (après l'étape 1) :
- **N suivait P en FD** → D suit P (son lien est gardé s'il désigne déjà P, sinon « P FD ») ; N
  suit X en FD, avec son propre décalage ;
- **N était liée à P autrement (DD, FF…)** → D reprend exactement ce lien ; N suit X en FD, sans
  décalage ;
- **N n'était pas liée à P, ou pas de N** → D suit P comme dans le premier cas ; N ne change pas ;
- **pas de P** (le bloc arrive tout en haut de l'étage) → D n'a plus de lien et garde ses dates ;
  N ne change pas.

**3. Jamais de boucle.** Si, en remontant les prédécesseurs de P, une tâche dépend d'une tâche du
bloc, elle reprend l'ancien lien de D (s'il ne la désigne pas elle-même), sinon elle perd son
lien. C'est la règle existante pour une tâche, étendue au bloc. Plus généralement, un lien posé
par le déplacement qui fermerait une boucle n'est pas posé : la tâche garde son lien précédent.

**4. Le reste ne bouge pas** : les liens internes au bloc, et les autres liens qui désignent une
tâche du bloc (FF, FD+5 non adjacents…).

**5. Dates** : les tâches dont le lien a changé prennent les dates que leur donne leur lien (FD,
DD, FF, décalages en jours ouvrés, fériés français exclus), puis tout l'aval suit en cascade. Seules
les dates qui changent sont écrites, dans la même écriture que le déplacement.

**Exemple 1 — CYCLE 3 au-dessus de CYCLE 2** (étage SS1, zone 1) :
- Ancienne place : CYCLE 3 est le dernier de l'étage, pas de B : rien à refermer.
- Nouvelle place : P = « REUNION + DIFFUSION SYT RSX Indice 0 » (dernière tâche de CYCLE 1), N =
  « RECEPTION RENDU CET RSX RESA TER » de CYCLE 2, qui suivait P en FD. La première tâche de
  CYCLE 3 suit maintenant P en FD ; la première tâche de CYCLE 2 suit « DEMARRAGE GO SS1 »,
  dernière tâche de CYCLE 3.
- Les dates de CYCLE 3, puis de CYCLE 2, se recalent.

**Exemple 2 — CYCLE 2 au-dessus de CYCLE 1** :
- Ancienne place : la première tâche de CYCLE 3 suivait la dernière de CYCLE 2 ; elle suit
  maintenant la dernière de CYCLE 1.
- Nouvelle place : P = « RECEPTION ARCH/TOPO/STR » (tâche directe de l'étage), N = « FOND DE PLAN
  DE SYNTHESE NIV SS1 », liée à P en **DD**. La première tâche de CYCLE 2 reprend ce lien
  (« DD » sur la réception) ; le FOND DE PLAN suit la dernière tâche de CYCLE 2 en FD.
- Ordre final : CYCLE 2, CYCLE 1, CYCLE 3, tous enchaînés.
- Conséquence acceptée : le fond de plan n'est plus calé sur la réception ; la vue Global le
  signale « à mettre à jour », et « Mettre à jour » du Lien Structure posera la date 0 Prev sur
  le fond de plan lui-même.

**Exemple 3 — le sous-cycle « PLAN SYT CYCLE 2 » glissé en tête de CYCLE 3** (avant sa
« RECEPTION RENDU CET RSX RESA TER ») :
- Bloc : RESEAUX (D, « FD » sur la RECEPTION de CYCLE 2), RESERVATIONS et TERMINAUX (« FF » sur
  RESEAUX). La REUNION de CYCLE 2 suivait RESEAUX en FD : X = RESEAUX.
- Ancienne place : la REUNION de CYCLE 2 reprend le lien d'entrée et suit la RECEPTION de CYCLE 2
  en FD.
- Nouvelle place : P = la REUNION de CYCLE 2, N = la RECEPTION de CYCLE 3, qui suivait P en FD.
  RESEAUX suit la REUNION de CYCLE 2 ; la RECEPTION de CYCLE 3 suit RESEAUX ; RESERVATIONS et
  TERMINAUX restent en FF sur RESEAUX ; le reste de CYCLE 3 suit sa RECEPTION, comme avant.

**Tâches** : la règle de chaînage des tâches déplacées ne change pas (seuls les liens FD sont
repris). La reprise du lien d'entrée (DD, FF) ne s'applique qu'aux cycles.

## 8. Suppression d'un cycle

- « Supprimer le cycle / le sous-cycle » retire sa ligne, **tous** ses sous-cycles (à toute
  profondeur) et toutes ses tâches, après confirmation.
- La question donne le compte : « Supprimer « CYCLE 2 », son sous-cycle et ses 6 tâches ? »
  (variantes : sans sous-cycle, sans tâche, pluriels).
- Avec `Lien` : la chaîne **se referme** à sa place comme au départ d'un déplacement (§7.4,
  étape 1), puis les liens des tâches restantes qui désignaient une ligne supprimée sont effacés,
  et les dates suivent. Aujourd'hui, seuls les liens orphelins sont effacés.
- Les replis mémorisés du cycle et de tous ses sous-cycles sont oubliés (Grist réutilise les ids).

## 9. Effets ailleurs

- **Tâche contrôlée par défaut** (plan de réservations du cycle 3) : la règle cherche aujourd'hui
  le cycle de la tâche, ou celui de son sous-groupe. Elle cherche désormais **parmi tous les
  cycles qui contiennent la tâche** un cycle nommé « CYCLE 3 ». Avec le modèle d'étage, le
  résultat est le même qu'aujourd'hui.
- **Lien Structure** : inchangé (le fond de plan se cherche parmi toutes les tâches de l'étage).
- **Modèle d'étage** : inchangé (il crée toujours CYCLE 1 à 3 et deux « PLAN SYT CYCLE n »).
- **Vue Global** : voir §5 ; ses contrôles s'appuient sur la tâche contrôlée ci-dessus.
- **Planning Structure et autres widgets** : non concernés.

## 10. Hors périmètre

- Cycles au niveau zone ou dans « Sans zone ».
- Déplacer un cycle vers un autre étage ou une autre zone.
- Glisser un étage ou une zone.
- Créer un cycle depuis le menu d'une tâche (refusé par l'utilisateur).
- Déplacer un cycle au clavier, dupliquer un cycle.
- Changer la règle de chaînage des tâches seules.
- Créer les colonnes en production (`Nature`, `Parent`, `Lien`, `Ordre` : à faire par
  l'utilisateur, comme pour les fonctions précédentes).

## 11. Choix faits sans l'utilisateur

1. `Nature` écrite selon la place (`Cycle` / `Sous-groupe`), mais l'affichage suit la place réelle
   (§3, §5).
2. Les nouveaux cycles se créent **à la fin** de leur conteneur.
3. Noms par défaut « Nouveau cycle » / « Nouveau sous-cycle », saisie du nom ouverte aussitôt.
4. Sur une ligne de cycle : moitié haute = avant le cycle, moitié basse = à la fin du cycle (aussi
   pour les tâches glissées).
5. Trait d'insertion décalé au retrait du niveau visé.
6. Un cycle ne quitte pas son étage.
7. Glisser un cycle demande `Ordre` ; créer un cycle demande `Nature`, `Parent`, `Lien` (détection
   existante).
8. « Le lien d'entrée appartient à la place », appliqué aussi au départ : la tâche qui prend la
   place reprend le lien d'entrée du bloc, quel qu'il soit, y compris « aucun lien » (miroir de
   la décision du §2).
9. Tâche de sortie d'un bloc : celle que suivait la tâche du dessous, sinon celle qui finit le
   plus tard (§7.4).
10. Supprimer un cycle referme la chaîne.
11. Boucle de `Parent` dans les données : le cycle de plus petit id passe dans l'étage.

## 12. Vérification

- Tests `node:test` des modules purs (lancés depuis `Planning Projet/` avec
  `node --test tests/*.test.mjs`) : lecture de la hiérarchie (profondeur, boucles, données
  actuelles inchangées), modèle de lignes et retraits, menu, cibles de dépôt, création, règle du
  bloc (les trois exemples du §7.4, absence de boucle, cycle vide, bloc en tête), suppression
  récursive, tâche contrôlée par défaut. Toute la suite existante reste verte.
- Données des exemples : l'étage SS1 de la zone « Zone 1 / BAT BC » de l'export de l'utilisateur
  (`BaseDRTO-Planning_Projet (6).csv`, 20/10/2026, hors dépôt), reproduit dans une aide de test.
  L'export n'a pas de colonne id : les ids se déduisent de `Parent` et `Lien` (la ligne-étage SS1
  a l'id 983, RECEPTION ARCH/TOPO/STR 984, CYCLE 1 985).
- Rendu vérifié dans Chrome sans interface avec les modules réels (zone 1 du CSV : retraits,
  bandes, accolades, trait d'insertion).
- L'utilisateur teste ensuite sur localhost (Ctrl+F5 : les sous-modules n'ont pas de `?v=`),
  notamment le glisser-déposer réel.
