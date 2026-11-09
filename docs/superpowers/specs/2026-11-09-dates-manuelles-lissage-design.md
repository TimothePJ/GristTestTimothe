# Spec — Dates manuelles d'un plan dans le lissage de `planning-synchro`

Date : 2026-11-09. Complète la spec du lissage
(`2026-10-23-lissage-taches-design.md`, citée « L§ ») et la loupe « Rechercher
un plan » (`planning-synchro/assets/js/top/planSearchModal.js`).

## 1. Objectif

Dans la fenêtre « Lissage des tâches », l'utilisateur peut **imposer la date de
fin d'un plan précis**. Cette date ne vaut **qu'en mode lissé**. L'échéance
« sans lissage » (la fin de la barre dessinée par le planning) ne change jamais.

Le plan à date manuelle **compte dans le maximum de son mois**, et les autres
plans se lissent autour de lui (décision de l'utilisateur). Une date manuelle
seule, sans aucun maximum, suffit à rendre le lissage actif.

## 2. Décisions

Prises par l'utilisateur, ou proposées et acceptées telles quelles.

1. **Stockage.** Une colonne `Date_Manuel_Lissage` de type **Date** dans
   `Planning_Projet`, au format d'affichage DD/MM/YYYY dans Grist. Vide = pas de
   date manuelle. Rien d'autre n'est ajouté dans Grist.
2. **Interface.** Une section « Plan particulier » sous « Mois particuliers »
   dans la fenêtre « Lissage ». Elle contient :
   - la liste des plans à date manuelle ;
   - une liste déroulante pour ajouter un plan ;
   - un bouton qui ouvre une **fenêtre par-dessus**. Celle-ci liste les plans
     **comme « Rechercher un plan »** (mêmes champs, filtres et colonnes), avec
     en plus une case date par plan.
3. **Enregistrement.** Comme les mois particuliers : l'aperçu suit la saisie, et
   rien n'est écrit avant « Enregistrer ». « Enregistrer » écrit en **une seule
   fois** la cellule `Projets2.Lissage` et les dates des plans modifiés.
4. **Règles.**
   - Le plan à date manuelle compte dans le maximum de son mois (Total et son
     type), et les autres plans se lissent autour.
   - Un plan réalisé ne peut pas recevoir de date manuelle ; une date stockée
     sur un plan réalisé est ignorée.
   - La date manuelle peut être plus tôt **ou plus tard** que l'échéance.
   - Une armature à date manuelle entraîne ses coffrages, comme le lissage le
     fait déjà (L§4.6).
   - Si l'échéance d'origine change ensuite, la date manuelle reste celle
     saisie.
   - « Supprimer le lissage » efface aussi les dates manuelles du service.
5. **Affichage.** Dans le graphique « Lissé » et dans « Rechercher un plan », le
   plan apparaît à sa date manuelle, marqué « date manuelle ».

## 3. Donnée : `Planning_Projet.Date_Manuel_Lissage`

- **Configuration.** `APP_CONFIG.grist.columns.planningProject.manualSmoothingDate
  = "Date_Manuel_Lissage"`.
- **Service.** Chaque ligne de `Planning_Projet` porte déjà son `Service` : une
  date manuelle appartient donc d'office au service de son plan. Aucune clé de
  service n'est nécessaire.
- **Lecture.**
  - La valeur passe par `parseCalendarDate`, puis `formatIsoDate`, pour donner
    une date `AAAA-MM-JJ`. Grist renvoie des secondes UTC ; le mock du banc
    d'essai renvoie un texte ISO ou FR.
  - Une valeur vide ou illisible veut dire « pas de date manuelle ».
  - Le résultat est une table `rowId -> AAAA-MM-JJ`, limitée aux lignes qui ont
    une valeur.
- **Colonne absente** (aucune ligne lue ne porte la propriété) :
  - la section « Plan particulier » est désactivée ;
  - elle affiche « Ajoutez une colonne Date « Date_Manuel_Lissage » dans
    Planning_Projet pour imposer la date d'un plan. » ;
  - le reste du lissage marche comme avant.
- **Écriture.**
  - Le format d'écriture est le nombre de secondes depuis l'époque à **minuit
    UTC** : `Date.UTC(a, m-1, j) / 1000`. Une date effacée s'écrit `null`.
  - Une `UpdateRecord` par ligne **dont la date change** (différence entre
    l'état connu et la saisie), jamais d'autre colonne.
  - Ces actions partent dans le **même `applyUserActions`** que l'`UpdateRecord`
    de `Projets2.Lissage`. La couche partagée valide chaque action, comme pour
    `updatePlanningDurations`.
- **Indépendance du planning.** Le constructeur vendorisé ne lit pas cette
  colonne : l'échéance sans lissage ne peut donc pas bouger. Les autres widgets
  qui lisent `Planning_Projet` l'ignorent.

## 4. Règle de lissage

`smoothTasks(tasks, settings, todayIso)` reçoit les dates manuelles dans
`settings.manualDates`, un objet `{ [rowId]: "AAAA-MM-JJ" }`. Le module reste
pur, et l'aperçu de la fenêtre passe par le même chemin.

### 4.1 Plan à date manuelle (« plan fixé »)

Un plan est **fixé** s'il remplit les trois conditions :
- il n'est pas réalisé ;
- son `rowId` figure dans `manualDates` ;
- sa date est valide.

Un plan fixé se comporte ainsi :
- **Mois.** Son mois de travail est celui de la date manuelle, et sa date
  lissée est la date manuelle.
- **Immobilité.** Il ne bouge jamais : il est traité comme une tâche figée
  (L§3.3) pour le placement et la remise en ordre.
- **Comptes.** Il compte dans les comptes de son mois (Total et son type) dès le
  départ. Les autres tâches mobiles se lissent donc autour de lui : un mois
  rempli par des plans fixés pousse ses autres tâches à venir plus tôt.
- **Date plus tard.** La date manuelle peut être après l'échéance. Le plan quitte
  alors le mois de son échéance (une place s'y libère) et occupe le mois de sa
  date manuelle.
- **Bornes.** La date manuelle n'est jamais bornée par le mois de départ ni par
  aujourd'hui. La fenêtre empêche seulement d'en **saisir** une plus tôt (§5.3).

### 4.2 Armature fixée : ses coffrages suivent

Ce pré-placement a lieu avant l'étape 1 de L§4. Il est fait pour chaque armature
fixée, dans l'ordre des tâches (`compareChartTasks`). Il concerne chacun des
coffrages de son groupe (même `groupKey` non vide) qui remplit trois conditions :
- il n'est pas réalisé ;
- il est **mobile**, c'est-à-dire ni figé ni fixé ;
- il est dans un mois **après** celui de l'armature.

Chacun de ces coffrages part dans le mois le plus tardif où il tient, entre le
mois de départ et le mois de l'armature (même recherche que `latestFit`). Il
porte alors `pulledFor` = N° de l'armature.

**Sans place.** S'il ne tient dans aucun de ces mois, le coffrage est placé
**quand même** dans le mois de l'armature et marqué `forced: true`. Le mois
dépasse alors son maximum, et ce dépassement est rapporté avec la raison
`dates-manuelles` (§4.5).

**Jour du coffrage.** Un coffrage entraîné dans le même mois que l'armature
garde la règle de date de L§4.5, mais sa date est **bornée à la date manuelle de
l'armature**. Il n'est donc jamais après elle.

**Coffrage déjà dans le mois de l'armature, mais un jour plus tard.** C'est le
cas le plus courant (L§4.6). Ce coffrage mobile est lui aussi borné à la date
manuelle de l'armature. Il porte alors `pulledFor` et `followsManual`, mais
`monthsAdvanced` reste 0, donc il n'est pas compté comme avancé.

**Date manuelle passée** (le temps a passé), ou antérieure au mois de départ.
Le coffrage suit quand même l'armature : il est borné à sa date, ou forcé dans
son mois si la recherche ne trouve aucun mois. Ces cas sont permis par
l'exemption de §4.6.

**Exclusion de la remise en ordre.** Ces coffrages entrent dans l'ensemble des
tâches d'un entraînement (`pullInvolved`, `rule4Exception`) : ils restent hors
de la remise en ordre. L'armature fixée n'y entre pas : elle est déjà immobile,
donc jamais dans une file.

Un coffrage fixé ou figé n'est jamais entraîné.

### 4.3 Coffrage fixé après son armature

L'armature n'est pas retardée, car le lissage ne retarde jamais une tâche
mobile. Elle ne peut pas non plus être avancée avant ce coffrage : c'est le
filet de sécurité existant de `placeEntry`, qui traite un coffrage figé comme
bloquant.

La fenêtre signale ce cas sur la ligne du coffrage : « après son armature N° … ».

### 4.4 Lissage actif

`result.active` est vrai dès qu'un maximum existe **ou** qu'au moins un plan est
fixé. Sans maximum, seuls les plans fixés et leurs coffrages entraînés bougent ;
aucun dépassement n'est rapporté, faute de maximum.

`smoothingSettings.hasSmoothing(settings)` vaut `hasAnyMax(settings)` ou « au
moins une date manuelle ». Il remplace `hasAnyMax` là où il décide :
- si « Supprimer le lissage » est visible (`saved`) ;
- si le mode passe à « Les deux » après un enregistrement.

### 4.5 Résultat

`SmoothedTask` gagne trois champs :
- `manual` : vrai pour un plan fixé ;
- `forced` : vrai pour un coffrage placé sans place (§4.2) ;
- `followsManual` : vrai pour un coffrage replacé à cause d'une armature fixée
  (§4.6).

Pour un plan fixé, `monthsAdvanced` vaut mois de l'échéance moins mois de la
date manuelle. Il est négatif quand la date est plus tard. `moved` garde son
sens, « avancé d'au moins un mois par le lissage », et vaut **faux** pour un
plan fixé.

`SmoothingResult` gagne deux comptes, et `movedCount` ne compte plus les plans
fixés :
- `manualCount` : nombre de plans fixés ;
- `delayedCount` : plans fixés dont la date manuelle est après l'échéance.

**Raison du dépassement.** Nouvelle raison `dates-manuelles`, avec le libellé
« dates manuelles » dans `OVERFLOW_REASON_LABELS`. Elle s'applique quand les
tâches figées seules ne dépassent pas le maximum, et que l'une de ces deux
conditions est vraie :
- les tâches figées, les plans fixés et les coffrages forcés le dépassent
  ensemble ;
- le mois contient un coffrage forcé de la série. Pour le Total, tout coffrage
  forcé du mois compte.

Elle se teste juste après `taches-passees` et `taches-realisees`, avant les
autres raisons.

### 4.6 Règles strictes (L§4.2) avec des plans fixés

`collectViolations` connaît les plans fixés par `settings.manualDates`. Un plan
fixé n'est vérifié par **aucune** règle, mais il compte dans les comptes du mois.

Un coffrage replacé à cause d'une armature fixée porte `followsManual: true`.
C'est le cas s'il a été entraîné au pré-placement de §4.2, ou borné à la date
de l'armature. Un tel coffrage n'est visé ni par la règle 2 ni par la règle 5 :
ces deux règles cèdent devant la date choisie par l'utilisateur. Il reste visé
par la règle 1.

Toutes les autres vérifications restent identiques.

Les fuzz (`tests/taskSmoothingFuzz.test.mjs`) tirent en plus des dates
manuelles. Ils vérifient :
- l'absence de violation ;
- que chaque plan fixé est à sa date ;
- qu'aucun coffrage entraîné n'est après son armature fixée.

## 5. Interface

### 5.1 Section « Plan particulier » (fenêtre « Lissage »)

Elle est placée sous « Mois particuliers », avant le message d'erreur de saisie
et l'« Aperçu ».

- **Titre.** `<h3 class="ps-smoothing-heading">Plan particulier</h3>`.
- **Aide.** « Imposez la date de fin d'un plan en mode lissé. Il compte dans le
  maximum de son mois et les autres plans se lissent autour. L'échéance sans
  lissage ne change pas. »
- **Tableau `#ps-smoothing-plans`.** Une ligne par plan à date manuelle de la
  saisie, triée par date manuelle puis N°. Colonnes :
  - N° ;
  - Plan : nom, avec la zone et le groupe en dessous (`placeOf`) ;
  - le type, avec sa pastille ;
  - « Échéance sans lissage » ;
  - « Date manuelle » : `<input type="date">` ;
  - une note (« N mois plus tôt / plus tard », « après son armature N° … ») ;
  - un bouton « Retirer » (✕).
- **Tableau vide.** « Aucun plan particulier : le lissage place chaque plan
  lui-même. »
- **Ligne d'ajout.** Elle a trois éléments :
  - une liste `#ps-smoothing-plan-select` : les plans non réalisés sans date
    manuelle dans la saisie, dans l'ordre du graphique, libellés
    « N° — nom (zone) » ;
  - le bouton `#ps-smoothing-plan-add` « Ajouter ce plan ». Il ajoute la ligne
    avec pour date la **date lissée actuelle** du plan (celle de l'aperçu), à
    défaut son échéance, et place le curseur dans sa case date ;
  - le bouton `#ps-smoothing-plan-browse` « Choisir dans la liste… », qui ouvre
    la fenêtre de §5.2.

### 5.2 Fenêtre « Choisir les plans » (`#ps-plan-pick-modal`, par-dessus)

- **Base.** C'est la fenêtre « Rechercher un plan » réutilisée :
  - même module `planSearchModal.js` ;
  - même balisage, avec le préfixe d'id `ps-plan-pick` au lieu de
    `ps-plan-search` ;
  - mêmes champs N° et nom, mêmes filtres Zone, Type et État, même tableau.
- **Contenu.**
  - Titre « Choisir les plans », et le même sous-titre « Projet · Service ».
  - Les colonnes sont celles de la recherche, plus une colonne
    « Date manuelle » : une case date, et un ✕ pour l'effacer quand elle a une
    valeur.
  - Un plan réalisé n'a pas de case : il affiche « réalisé, ne bouge pas ».
- **Saisie.** Une case modifiée met à jour **la saisie de la fenêtre
  « Lissage »**, qui reste dessous et dont la section et l'aperçu suivent. La
  colonne « Échéance lissée » de cette fenêtre-ci suit aussi : elle est
  recalculée sur la saisie, après le même délai que l'aperçu.
- **Fermeture.** Le bouton « Terminé » referme cette fenêtre seule, tout comme
  Échap, Fermer et un clic sur le fond. Rien n'est écrit dans Grist à ce moment.
- **Superposition.** La fenêtre vient après `#ps-smoothing-modal` dans le
  document et a un `z-index` supérieur. Échap ne ferme qu'elle quand elle est
  ouverte.

### 5.3 Saisie et validation

- **Date au plus tôt.** On ne peut pas saisir une date avant la première date
  permise. Celle-ci vaut :
  - aujourd'hui, quand le mois de départ est le mois courant ;
  - sinon, le 1er du mois de départ de la saisie.

  Une date enregistrée plus tôt (le temps a passé) reste acceptée tant qu'elle
  n'est pas modifiée.
- **Case vidée.** Dans la section, vider la case retire la date. La ligne reste
  jusqu'à « Retirer » ou la fermeture, et une ligne sans date n'est pas
  enregistrée.
- **Date invalide.** Une date invalide ou trop tôt affiche son message dans
  `#ps-smoothing-field-error` et désactive « Enregistrer », comme un maximum
  invalide. Le message est : « Choisissez une date à partir du JJ/MM/AAAA. »
- **Lecture seule.** Les cases sont désactivées et la ligne d'ajout est
  masquée. La fenêtre §5.2 reste consultable, sans cases.

### 5.4 Enregistrer, Annuler, Supprimer

- **Enregistrer** remet au contrôleur `settings`, avec `manualDates` (la saisie
  complète du service). Le contrôleur écrit la cellule et les dates qui
  changent, en un seul lot.
  - **Succès.** L'état local est mis à jour tout de suite, et le mode passe à
    « Les deux » si `hasSmoothing`.
  - **Échec.** Rien n'est changé localement et la fenêtre affiche l'erreur.
- **Plans touchés seuls.** La saisie distingue les plans touchés pendant la
  session (ajoutés, modifiés ou retirés) des autres.
  - Quand une relecture apporte de nouvelles dates (`refresh({ manualDates })`),
    les plans non touchés prennent la nouvelle valeur, et les plans touchés
    gardent la saisie.
  - Le diff « état connu → saisie » ne contient donc que les plans touchés : on
    n'écrase jamais la date qu'un collègue vient d'enregistrer sur un autre
    plan.
- **Dates non affichées.** Les dates de plans réalisés ou de lignes que le
  graphique ne dessine pas ne sont pas listées. Elles sont ignorées par le
  calcul, gardées telles quelles par « Enregistrer » (jamais écrites), et
  effacées par « Supprimer le lissage ». Une telle date suffit à rendre
  `hasSmoothing` vrai, donc « Supprimer » visible, ce qui permet de l'effacer.
  Si le plan redevient non réalisé, sa date s'applique de nouveau.
- **Annuler** perd la saisie, dates comprises.
- **Supprimer le lissage** efface la cellule du service et toutes ses dates
  manuelles. Il est visible si `hasSmoothing(settings)`.
- **Cellule `Lissage`.** L'entrée du service est gardée si un maximum existe, ou
  si un mois de départ est choisi avec au moins une date manuelle. Sans cette
  seconde condition, le mois de départ d'un lissage fait de dates seules serait
  perdu.

### 5.5 Ailleurs

- **Rechercher un plan.** Pour un plan fixé, la colonne « Échéance lissée »
  affiche la date manuelle en gras. Elle ajoute « date manuelle » et
  « N mois plus tôt », « N mois plus tard » ou « même mois ».
  - Le filtre État gagne « Date manuelle » quand au moins un plan est fixé.
  - Le résumé ajoute « N date(s) manuelle(s) ».
- **Tâches du mois.** En mode lissé, la note d'un plan fixé dit « date manuelle
  (échéance JJ/MM/AAAA) ».
- **Aperçu de la fenêtre « Lissage ».** Le résumé devient
  « N tâches avancées · N dates manuelles · aucune tâche retardée ». Quand
  `delayedCount > 0`, la dernière partie devient
  « N retardée(s) par une date manuelle ».
- **Graphique.** Rien à changer : il compte par `smoothedIso`.

## 6. Rafraîchissement (`main.js`)

- **Lecture.** Les dates manuelles sont lues dans `planningRows`, à chaque
  `loadProject`, puis passées à `smoothing.setProjectData({ …, manualDates,
  hasManualColumn })`.
- **Empreinte des lignes.** Dans `reloadChargeFromGrist`, la moitié « tout le
  reste » de `planningRowsSignature` exclut maintenant aussi la colonne
  `Date_Manuel_Lissage`. Une empreinte dédiée suit cette colonne.
- **Seule la date manuelle a changé.** C'est notre propre écriture, ou celle d'un
  collègue. On recopie la colonne dans les lignes en mémoire, puis on appelle
  `smoothing.setManualDates(manualDates)`.
  - Le contrôleur ne fait rien si les dates sont identiques.
  - Sinon il recalcule, rafraîchit les fenêtres ouvertes et appelle `onChange`.
  - **Aucun `loadProject`**, donc aucun rechargement visible.
- **Une autre colonne a changé.** On recharge tout, comme aujourd'hui.

## 7. Ancrage dans le code

| Fichier | Changement |
|---|---|
| `config.js` | colonne `manualSmoothingDate` |
| `top/manualDates.js` (nouveau, pur) | lecture des lignes en `{rowId: iso}`, conversion ISO ↔ secondes, diff entre deux états en écritures, première date permise |
| `top/taskSmoothing.js` | plans fixés, pré-placement §4.2, `manual`, `forced`, comptes, raison, violations |
| `top/taskLabels.js` | raison `dates-manuelles` |
| `top/smoothingSettings.js` | `hasSmoothing` ; la sérialisation garde le mois de départ selon §5.4 |
| `top/smoothingModal.js` | section §5.1, saisie et validation des dates, création et pilotage de la fenêtre §5.2, Échap |
| `top/planSearchModal.js` | préfixe d'id paramétrable, colonne « Date manuelle » optionnelle, affichage des plans fixés, filtre État |
| `top/monthTasksModal.js` | note « date manuelle » |
| `top/smoothingController.js` | `manualDates` et `hasManualColumn` dans l'état et les réglages, `setManualDates`, écriture en un lot, contexte de la fenêtre |
| `services/gristService.js` | `updateProjectSmoothing(projectId, value, manualWrites = [])` : un seul lot |
| `main.js` | lecture, empreinte, chemin léger |
| `index.html` et `dev/harness.html` | balisage identique (parité testée) |
| `assets/css/styles.css` | styles de la section et de la fenêtre §5.2 |
| `dev/fixtures.js` | `Date_Manuel_Lissage` sur une ligne d'ERA pour le banc d'essai |
| `README.md` | documentation utilisateur |

## 8. Tests

- **Purs.**
  - `manualDates` : lecture des secondes, de l'ISO, du FR, du vide et de
    l'illisible ; diff ; conversion à minuit UTC ; première date permise.
  - `taskSmoothing` :
    - un plan fixé compte dans son mois et un autre plan avance ;
    - un plan fixé plus tard libère son mois ;
    - un plan réalisé ignore sa date ;
    - une armature fixée entraîne son coffrage, avec la borne de jour ;
    - un coffrage forcé est rapporté avec la raison `dates-manuelles` ;
    - un coffrage fixé après son armature bloque l'armature ;
    - des dates seules sans maximum rendent le lissage actif ;
    - les comptes sont justes.
  - Fuzz : voir §4.6.
- **Fenêtres.**
  - `smoothingModal` : section, ajout, retrait, validation, enregistrement avec
    `manualDates`, lecture seule, colonne absente, Échap avec la fenêtre
    par-dessus ouverte.
  - `planSearchModal` : préfixe, colonne date, affichage d'un plan fixé.
- **Contrôleur.** Lot d'écriture (cellule et diffs), `setManualDates` sans
  effet ou avec recalcul, `hasSmoothing` pour « Supprimer ».
- **Service.** `updateProjectSmoothing` construit un seul lot, qui traverse les
  vraies fonctions de la couche partagée, comme le test de
  `updatePlanningDurations`.
- **Rafraîchissement.** `postWriteRefresh` : une relecture où seule la date
  manuelle change ne relance pas `loadProject` et appelle `setManualDates`.
- **Parité.** Le balisage de `index.html` et de `dev/harness.html` est identique
  (préfixe `ps-plan-pick` ajouté).

## 9. Hors périmètre

- Déplacer un plan à la souris dans le graphique.
- Imposer une date à plusieurs plans d'un coup.
- Modifier les dates du planning lui-même (sans lissage).

## 10. Laissé au builder

- Le style exact de la section et de la fenêtre §5.2, dans la ligne visuelle des
  fenêtres existantes : mêmes boutons, pastilles et couleurs.
- La forme interne des entrées de travail de `smoothTasks`, tant que §4 tient.
- Les textes d'aide, tant qu'ils disent la même chose.
