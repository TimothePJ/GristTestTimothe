# Spec — Charge de référence par document (ligne « Charge » de `planning-synchro`)

Date : 2026-08-28
Statut : design validé, en attente de relecture avant plan d'implémentation.

## 1. Objectif

Aujourd'hui `Planning_Projet` ne porte que des **durées d'écoulement** (`Duree_1/2/3`, en
semaines), qui servent à déduire les dates de fin de phase. Elles disent « ce plan doit
sortir dans 3 semaines », jamais « ce plan coûte 2 jours de travail ».

On ajoute la seconde notion : une **charge de référence**, en jours, résolue par
spécificité du général au particulier, et confrontée mois par mois à la charge réellement
planifiée dans `TimeSegment`.

Le résultat est une **nouvelle ligne « Charge »**, sous la ligne « Total » du pane bas de
`planning-synchro`, qui affiche pour chaque mois visible les jours de travail requis, et se
colore selon que le planifié couvre ou non le requis.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Emplacement des durées | **Trois colonnes sur `Planning_Projet`** : `Duree_Projet`, `Duree_Zone`, `Duree_Force`. |
| Résolution | `Duree_Force` → sinon `Duree_Zone` → sinon `Duree_Projet` → sinon aucune charge. |
| Stockage de la charge résolue | **Jamais stockée.** Recalculée à chaque lecture. |
| Périmètre widget | **`planning-synchro` uniquement.** `gestion-depenses2` n'est pas touché. |
| Unité | Jours, **multiples de 0,5**, comme `Effectif`. |
| Plage de travail d'un document | Celle de `buildRowPhases` (`top/phases.js`), déjà en place et testée. |
| Prorata mensuel | **Jours ouvrés** (week-ends et fériés exclus), comme partout ailleurs. |
| Arrondi | 0,5 jour, report au **plus grand reliquat** pour que la somme des mois égale la charge du document. |
| Documents sans dates | Totalisés dans une cellule **« non placé »**, hors calendrier. Jamais ignorés. |
| Documents réalisés | Comptés normalement. Leur plage étant passée, ils se placent dans des mois passés. |
| Couleurs | Sur la **ligne Charge**, **mois par mois**, en comparant planifié (ligne Total) et requis. |
| Divergence `Duree_Projet` | Valeur **majoritaire**, plus un avertissement listant les `ID` divergents. |
| Lignes d'en-tête de zone | **Exclues** : ce sont des séparateurs, pas des documents. |
| Git | **Aucun commit, aucun push.** L'utilisateur commite lui-même. |

## 3. Modèle de données

### 3.1 Les trois colonnes

```
Planning_Projet
  ... colonnes existantes inchangees ...
  Duree_Projet   defaut du type de document pour ce projet
  Duree_Zone     ce type de document, dans cette zone
  Duree_Force    ce document precis
```

### 3.2 La cascade

```
resolveDocumentCharge(row, columns)
  = Duree_Force   si renseignee et > 0
 || Duree_Zone    si renseignee et > 0
 || Duree_Projet  si renseignee et > 0
 || null          -> le document ne porte aucune charge
```

Une valeur vide, nulle, négative ou non numérique est traitée comme « non renseignée » et
laisse la main au niveau suivant. Un `0` explicite ne vaut donc **pas** « zéro jour » : pour
exprimer « ce document ne coûte rien », il faut laisser les trois colonnes vides.

### 3.3 Pourquoi la charge résolue n'est jamais stockée

C'est ce qui répond à l'exigence « si un document est ajouté ou déplacé, il doit recevoir la
bonne durée ». La cascade lit `Type_doc` et `Zone` **au moment du calcul** : un document qui
change de type ou de zone est reclassé au rafraîchissement suivant, sans qu'aucun code
n'ait à « réassigner » quoi que ce soit.

Stocker la valeur résolue obligerait au contraire à la maintenir à chaque déplacement — et
c'est exactement là que naîtraient les incohérences silencieuses.

### 3.4 Lignes exclues du calcul

Une ligne est ignorée si elle n'a **ni** `ID` **ni** `Type_doc` : ce sont les en-têtes de
zone de `Planning_Projet` (par exemple `ERA QUAI D'ORSAY,,,,Zone 1 / BAT BC,,,,...`), qui
existent pour structurer l'affichage et ne représentent aucun document.

## 4. Ancrage dans le code existant

- **Config** : `planning-synchro/assets/js/config.js`, bloc `planningProject` — ajouter
  `dureeProjet`, `dureeZone`, `dureeForce`.
- **Plage d'un document** : `assets/js/top/phases.js` → `buildRowPhases(row, columns)`.
  Retourne les phases d'une ligne ; chaque document a **exactement une** phase de travail
  (plus un éventuel marqueur `Demarrages_travaux`, de largeur nulle, à ignorer ici).
  - COFFRAGE : `Date_limite` → `Diff_coffrage`
  - ARMATURES : `Diff_coffrage` → `Diff_armature`
  - NDC / COUPES / DÉMOLITION / type non reconnu : `Date_limite` → `Diff_coffrage`
- **Données déjà chargées** : `assets/js/main.js` → `loadProject()` détient `planningRows`
  (filtrées par `NomProjet`). Aucun chargement supplémentaire n'est nécessaire.
- **Ligne Total** : `assets/js/bottom/chargeBoard.js` → `renderTotalRow(workers, months,
  timelineWidth)` et `renderReadonlyMonthTrack(workers, months)`. La ligne Charge reprend
  la même structure (`.charge-plan-row`, cellule nom, cellule piste `--readonly`, un
  `.charge-plan-month-segment` par mois).
- **Mois visibles** : `getWindowMonths(windowDays, dayWidth)` (même fichier) fournit déjà
  la liste des mois de la fenêtre avec leur largeur en pixels.
- **Jours ouvrés** : `assets/js/utils/monthSegments.js` → `getMonthBusinessDays(monthKey)`,
  `getMonthBounds(monthKey)`. **Module vendorisé, intouchable** (parité verrouillée par
  `shared/tests/vendored-charge-modules-parity.test.cjs`).
- **Teintes** : reprises de `Gestion-User/assets/css/styles.css` — `--color-balanced`
  `#d7eccb`, `--color-partial` `#edf4fb`, `--color-overload` `#ffe1a8` (texte `#6d3b00`).

  ⚠️ Elles existent déjà dans `planning-synchro` sous les noms `--load-balanced` /
  `--load-partial` / `--load-overload` (`assets/css/styles.css:1500-1502`), **mais elles
  sont déclarées sur `.ps-segment-edit-load`**, c'est-à-dire scopées à la barre de charge de
  la fenêtre de segment. La ligne Charge vit ailleurs dans le DOM et **n'en hérite pas**.

  L'implémentation doit donc **remonter ces trois déclarations à une portée commune**
  (`:root`, ou le conteneur du board) et laisser la fenêtre de segment les consommer depuis
  là. Sans ce déplacement, la ligne Charge se rendrait **sans aucune couleur** — une
  variable CSS non définie ne lève aucune erreur, elle ne s'applique simplement pas. Un test
  doit épingler le fait que les deux surfaces lisent la même déclaration.

## 5. La répartition mensuelle

Pour chaque document portant une charge :

1. Récupérer sa plage de travail via `buildRowPhases`.
2. Si aucune plage → sa charge va dans le compteur **« non placé »**, et on s'arrête là.
3. Sinon, compter les **jours ouvrés** de la plage dans chaque mois qu'elle touche.
4. Répartir la charge au prorata de ces comptes.
5. Arrondir chaque part au **0,5 jour** inférieur, puis distribuer le reliquat par
   **plus grand reste**, de sorte que la somme des parts égale exactement la charge.

```
Tache 24/08 -> 07/09, charge 2 j
  aout       5 jours ouvres  ->  2 x (5/10) = 1,0 j
  septembre  5 jours ouvres  ->  2 x (5/10) = 1,0 j
                                 somme = 2,0 j  OK
```

Le report au plus grand reliquat est l'algorithme que portait `getSegmentAllocationByMonth`
avant sa suppression lors de la bascule de `TimeSegment` au mois. Il redevient utile ici,
pour un autre usage : sans lui, arrondir chaque mois indépendamment ferait dériver le total
du projet de plusieurs jours.

**Propriété de contrôle**, à faire porter par les tests : pour un document donné, la somme
de ses parts mensuelles vaut exactement sa charge résolue.

## 6. La ligne « Charge »

### 6.1 Structure

```
              non place | aout | sept | oct  |
Total            —      | 12 j | 18 j |  8 j |
Charge        240 j     | 12 j | 22 j |  5 j |
                          VERT  AMBRE  BLEU
```

- Première cellule : le libellé **« Charge »** et le bouton qui ouvre la fenêtre.
- Deuxième cellule : **« non placé »**, total des documents sans plage de dates. Masquée
  quand elle vaut zéro. C'est là qu'atterrissent les 112 lignes COFFRAGE de PRD et celles
  de HOTEL DIEU tant qu'elles ne sont pas datées ; la cellule se vide d'elle-même à mesure
  que les dates sont saisies.
- Puis une cellule par mois visible, alignée sur la ligne Total.

### 6.2 Couleurs

Comparaison, pour chaque mois : **jours planifiés** contre **jours requis**.

« Jours planifiés » est **exactement le nombre que la ligne Total affiche déjà** pour ce
mois — la valeur produite par `computeMonthTotalDays(workers, month)`, somme des
`getSegmentEffectiveDays` de tous les collaborateurs sur ce mois. On ne recalcule rien : les
deux lignes doivent, par construction, parler du même chiffre.

« Jours requis » est la charge répartie du §5, agrégée sur le même mois.

| Situation | Couleur | Reprise de |
|---|---|---|
| planifié = requis | `#d7eccb` | Charge 100 % |
| planifié < requis | `#ffe1a8`, texte `#6d3b00` | Surcharge |
| planifié > requis | `#edf4fb` | Charge partielle |

L'égalité se teste avec la même tolérance que `monthLoad.js` (comparaison à epsilon près),
pour ne pas colorer en ambre un écart de 1e-9 issu de l'arithmétique flottante.

Un mois où le requis vaut 0 **et** le planifié vaut 0 reste neutre, sans couleur : il n'y a
rien à signaler.

### 6.4 Quand la ligne ne s'affiche pas

Aucun projet sélectionné → le pane bas est déjà vide, la ligne Charge ne se rend pas non
plus. En revanche, un projet **sans aucune durée renseignée** rend bien la ligne, avec des
cellules à zéro et sans couleur : c'est ce qui rend le bouton « Charge » découvrable, alors
qu'une ligne absente laisserait l'utilisateur sans point d'entrée.

### 6.3 Contenu d'une cellule

Le nombre de jours requis, plus une barre de remplissage proportionnelle, sur le modèle de
`renderReadonlyMonthTrack` qui le fait déjà pour la ligne Total.

## 7. La fenêtre d'assignation

### 7.1 Dépliage à trois niveaux

```
COFFRAGE                    [ 2 ] j    [x] par zone
   Bloc 1                   [ 3 ] j    [x] par document
      1011 PH N-U Coffrage  [   ] j
      1021 PH N-V Coffrage  [ 4 ] j
   Bloc 2                   [ 2 ] j    [ ] par document
ARMATURES                   [ 1,5 ] j  [ ] par zone
```

- Niveau 1 : un bloc par **type de document présent dans le projet**.
- Cocher « par zone » déplie les **zones du projet où ce type apparaît**.
- Cocher « par document » sur une zone déplie les **documents de cette zone**.
- Un champ laissé vide hérite du niveau au-dessus.

### 7.2 Ce que la fenêtre écrit

| Niveau | Colonne | Lignes touchées |
|---|---|---|
| Type | `Duree_Projet` | toutes les lignes (projet, type) |
| Zone | `Duree_Zone` | toutes les lignes (projet, type, zone) |
| Document | `Duree_Force` | la seule ligne visée |

Écrire `Duree_Projet` pour le COFFRAGE de PRD touche donc **112 lignes** en un lot. C'est la
contrepartie assumée du choix des trois colonnes : la fenêtre absorbe la répétition pour que
l'utilisateur n'ait pas à la faire à la main.

Les écritures partent en **un seul `applyUserActions`** par enregistrement, pour que la
synchronisation inter-widgets ne se déclenche qu'une fois.

### 7.3 Divergence

Si les lignes d'un groupe (projet, type) portent des `Duree_Projet` différentes — ce qui ne
peut venir que d'une édition manuelle dans la grille Grist, la fenêtre écrivant toujours
tout le groupe —, on retient la **valeur majoritaire** et la fenêtre affiche un
avertissement listant les `ID` divergents. Même règle au niveau zone.

Retenir la majorité plutôt que la première valeur rencontrée évite qu'une seule ligne
aberrante fasse basculer tout le groupe.

## 8. Accès en écriture à `Planning_Projet`

`planning-synchro` n'écrivait jusqu'ici que dans `TimeSegment`. **Vérifié avant rédaction de
cette spec** : l'écriture dans `Planning_Projet` est autorisée, sous trois conditions que le
widget satisfait déjà.

`shared/grist-service-context.js` → `validateProtectedMutationTargets` valide chaque ligne
mutée via `core.rowMatchesContext` (`shared/service-context-core.js:1178`). Pour
`Planning_Projet` :

- la table est dans `SERVICE_AWARE_TABLES` → le `Service` de la ligne doit correspondre au
  service sélectionné ;
- son identité projet est **le nom** (`PROJECT_NAME_COLUMNS.Planning_Projet = "NomProjet"`,
  `projectIdentity: "name"`) → le `NomProjet` de la ligne doit figurer parmi les noms
  autorisés du projet courant ;
- un projet doit être sélectionné **et porter un numéro** : `rowMatchesContext` renvoie
  `false` d'emblée si `projectNumber` est vide.

Les trois sont vraies dans `planning-synchro`, qui sélectionne toujours un projet par nom et
numéro issus de `Projets2`, et dont les lignes de planning sont déjà filtrées par ce nom.

⚠️ L'implémentation doit néanmoins **couvrir ce chemin par un test** : c'est la première
écriture de ce widget hors `TimeSegment`, et un refus ne se manifesterait qu'à
l'enregistrement, en production.

## 9. Découpage en modules

- **`assets/js/bottom/documentCharge.js`** (nouveau, pur) — la cascade de résolution, la
  répartition mensuelle avec report au plus grand reliquat, l'agrégation par mois et le
  compteur « non placé », la détection de divergence. Aucun DOM, aucun Grist : testable
  sous `node --test`.
- **`assets/js/bottom/chargeBoard.js`** — rendu de la ligne Charge, à côté de
  `renderTotalRow`.
- **`assets/js/bottom/chargeAssignModal.js`** (nouveau) — le contrôleur DOM de la fenêtre,
  sur le modèle de `editSegmentModal.js` : helpers purs exportés et testés, contrôleur
  browser-only vérifié par sonde.
- **`assets/js/services/gristService.js`** — l'écriture par lot dans `Planning_Projet`.
- **`index.html`** + **`dev/harness.html`** — le markup de la fenêtre, **identiques** entre
  les deux fichiers.
- **`assets/css/styles.css`** — la ligne Charge et la fenêtre.

Ce module `documentCharge.js` n'est **pas** vendorisé : le périmètre étant limité à
`planning-synchro`, il n'a pas de jumeau, et rien ne justifie de l'ajouter au test de
parité.

## 10. Tests

| Fichier | Couvre |
|---|---|
| `tests/documentCharge.test.mjs` | cascade (les 4 cas, dont `0` explicite qui ne coupe pas la cascade), exclusion des en-têtes de zone, répartition (somme = charge), report au plus grand reliquat, document sans plage → « non placé », détection de divergence |
| `tests/chargeRowRender.test.mjs` | les trois couleurs, le mois neutre à 0/0, l'affichage de « non placé » et son masquage à zéro |
| `tests/chargeAssignModal.test.mjs` | dépliage à trois niveaux, héritage d'un champ vide, écriture par lot sur les bons groupes de lignes, avertissement de divergence |
| `tests/gristService.test.mjs` | l'écriture `Planning_Projet` part bien, avec les bons champs, en un seul lot |

Vérification navigateur via `dev/harness.html`, servi depuis **la racine du dépôt** (cf.
`README.md`) : rendu de la ligne, couleurs, dépliage de la fenêtre, et absence de
rechargement après enregistrement.

## 11. Risques

| Risque | Traitement |
|---|---|
| Écriture `Planning_Projet` refusée par la couche partagée | Analysé en §8 : autorisée. À couvrir par un test, c'est la première écriture hors `TimeSegment` de ce widget. |
| 112 écritures d'un coup déclenchent 112 rafraîchissements | Un seul `applyUserActions` par enregistrement ; le routage de signal posé récemment retombe déjà sur un rafraîchissement léger. |
| Mojibake sur `Type_doc` (`DÃMOLITION` au lieu de `DÉMOLITION`) | Présent dans l'export réel. La fenêtre liste les types **tels qu'ils apparaissent dans les données**, elle ne les compare à aucune constante — le mojibake n'empêche donc pas de leur assigner une durée. |
| Zones hétérogènes entre projets | Sans objet : la fenêtre ne propose que les zones **du projet courant**, où l'orthographe est cohérente. |
| Sur PRD et HOTEL DIEU, aucun document n'est daté | La cellule « non placé » rend la charge visible malgré tout, au lieu d'afficher une ligne vide inexplicable. |
| Divergence entre lignes d'un même groupe | Valeur majoritaire + avertissement (§7.3). |

## 12. Hors périmètre

- **`gestion-depenses2`** — non touché. Il conserve sa ligne Total sans pendant Charge.
- **Pré-remplissage de `TimeSegment` depuis la charge de référence** — la confrontation est
  affichée, jamais appliquée. Ce serait un chantier distinct.
- **Coefficient par indice** — un document réédité en indice B coûte aujourd'hui le même
  barème que l'indice A. À trancher plus tard si le besoin se confirme.
- **Charge dépendant d'une quantité** (m², nombre de niveaux) — le barème reste un nombre de
  jours par document, pas un ratio.
