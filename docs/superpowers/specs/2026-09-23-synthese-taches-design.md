# Spec — Tableau de tâches de la vue Synthese (Planning Projet)

Date : 2026-09-23
Statut : design validé en conversation, en attente de relecture avant plan d'implémentation.

## 1. Objectif

Dans le widget **Planning Projet**, quand le service sélectionné est **Synthese**, l'espace
vide actuel (`#syntheseSpace`) devient un **tableau de tâches façon MS Project** :

1. À gauche, 4 colonnes : **Nom de la tâche**, **Durée**, **Début**, **Fin**.
2. Les tâches sont regroupées par **zone**. Chaque zone a une ligne récapitulative dont le
   Début, la Fin et la Durée se calculent seuls à partir de ses tâches.
3. On **modifie** une tâche directement dans les cellules. Durée → recalcule la Fin ;
   Début ou Fin → recalcule la Durée.
4. On **ajoute** une tâche par clic droit dans la zone concernée, on la **supprime** par
   clic droit sur la tâche.
5. À droite, un **grand panneau vide**, réservé à un **diagramme de Gantt** qui viendra plus
   tard. Toute la conception est faite pour qu'il se branche sans rien refaire.

Référence visuelle : capture MS Project fournie par l'utilisateur (zones « PH SS1 »,
« Zone Z1A », « Zone Z2A » ; tâches « Plans avant synthèse des CET » 18 jours du
Mar 15/09/26 au Jeu 08/10/26, jalons à 0 jour…). La colonne « Initiales de la ressource »
est ignorée.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Où | Vue du service **Synthese** de Planning Projet, dans `#syntheseSpace`. Les autres services gardent le planning Structure. |
| Construction | **Tableau HTML maison** (pas de vis-timeline, pas de bibliothèque de grille). |
| Lien avec le futur Gantt | Un **modèle de lignes** partagé : liste ordonnée des lignes visibles, **hauteur de ligne fixe**, deux panneaux dans **un seul défilement vertical**. Le Gantt dessinera la même liste. |
| Hiérarchie | **Zone → tâches** (2 niveaux). Le niveau intermédiaire vert clair de la capture (« PH RDB ») viendra plus tard. |
| Nom de la tâche | Colonne **`Taches`**. |
| Début / Fin | Colonnes **`Diff_coffrage`** / **`Diff_armature`**. |
| Durée | Jours ouvrés du Début à la Fin, **bornes incluses** (comme MS Project). Écrite aussi dans **`Duree_1`**. |
| Jours ouvrés | Lundi → vendredi, **hors jours fériés français** (même calendrier que Time-Out et les autres widgets). Différence connue avec le MS Project de la capture, qui compte les fériés comme travaillés. |
| Jalon | **Durée 0** : Début = Fin. `Duree_1 = 0` le distingue d'une tâche d'un jour. |
| Ce qu'est une tâche | Ligne `Planning_Projet` du service courant avec **`Taches` non vide, `Type_doc` vide, `ID2` vide**. Aucune autre colonne de marquage. |
| Documents | Les lignes documents du service Synthese (avec type / ID, ex. « RDC » de Test Synthese) **ne s'affichent pas** pour l'instant. |
| Zones affichées | Toutes les zones du projet, **tous services confondus** (via `watchProjectZones`), même vides. Ordre alphabétique naturel. Section « Sans zone » en dernier si des tâches n'ont pas de zone. |
| Ordre des tâches | Par Début croissant, puis Fin, puis nom, puis id. Tâches sans dates en fin de zone. |
| Droits | Toute modification exige **« Editer » activé** dans le bandeau **et** un service modifiable pour l'utilisateur (règle du contexte partagé). |
| Bandeau | Le filtre **Zone** filtre le tableau (comparaison sans accents, casse ni ponctuation, comme partout ailleurs). Le bouton **« Durées »** est masqué dans ce mode. |
| Git | **Aucun commit, aucun push.** L'utilisateur teste en local et commite lui-même. |

## 3. Données

```
Planning_Projet (service Synthese, projet courant)
  Taches          nom de la tâche (obligatoire, non vide)
  Diff_coffrage   Début (Date Grist, écrite en "YYYY-MM-DD")
  Diff_armature   Fin   (Date Grist, écrite en "YYYY-MM-DD")
  Duree_1         durée en jours ouvrés, 0 = jalon
  NomProjet       nom du projet (contrôlé aussi par le contexte partagé)
  Zone            nom de la zone ("" = sans zone)
  Service         rempli automatiquement par le contexte partagé
  Type_doc, ID2   laissés vides — c'est ce qui fait d'une ligne une tâche
```

Types de lignes du service Synthese dans `Planning_Projet` :

| Taches | Type_doc | ID2 | Nature |
|---|---|---|---|
| vide | vide | vide | ligne de zone (existant, créée par « Ajouter une zone » etc.) |
| rempli | vide | vide | **tâche** (nouveau) |
| rempli | rempli | rempli | document (ListeDePlan / Reference2) — ignoré ici |

Les autres widgets qui lisent `Planning_Projet` (planning-synchro, Avancement, MS Project)
ignorent déjà les lignes sans type ni ID : les tâches ne leur apparaissent pas.

**Protection du recalcul automatique** : `planningSyncCoordinator` exclut déjà les lignes
`SYNTHESE` de la v1 ; il exclura aussi les lignes-tâches, pour que la future saisie d'un
avancement ne soit jamais écrasée.

## 4. Règles de calcul

**Dates lues** : `Diff_coffrage` / `Diff_armature` arrivent en secondes (REST / fetchTable),
en ISO ou en `jj/mm/aaaa` ; lecture par `parseGristDate` (existant, testé).

**Durée affichée d'une tâche**
- Deux dates valides, `Duree_1 = 0` et Début = Fin → **0** (jalon).
- Sinon → jours ouvrés du Début à la Fin, bornes incluses. Les dates font foi : une
  `Duree_1` différente est ignorée (sauf le cas jalon ci-dessus).
- Dates manquantes → Durée, Début, Fin affichent « — ».

**Recalage sur les jours ouvrés** (à chaque saisie)
- Début un week-end / férié → avancé au jour ouvré suivant.
- Fin un week-end / férié → reculée au jour ouvré précédent.
- Jalon : sa date est avancée au jour ouvré suivant.

**Modifications**

| Saisie | Tâche normale | Jalon (Durée 0) | Tâche sans dates |
|---|---|---|---|
| Durée N ≥ 1 | Fin = N-ième jour ouvré depuis le Début | idem (devient une tâche) | Début = prochain jour ouvré (aujourd'hui compris), Fin calculée |
| Durée 0 | devient jalon : Fin = Début | inchangé | Début = Fin = prochain jour ouvré |
| Début | Fin inchangée, Durée recalculée ; Début après la Fin → la tâche se **décale**, Durée gardée (Fin recalculée) | le jalon se **déplace** (Fin = Début) | tâche d'un jour à cette date |
| Fin | Début inchangé, Durée recalculée ; Fin avant le Début → la tâche se **décale**, Durée gardée (Début recalculé) | le jalon se **déplace** (Début = Fin) | tâche d'un jour à cette date |
| Nom | nouveau nom | idem | idem |

Refus (message dans la barre d'état, ancienne valeur remise, rien n'est écrit) :
- tâche à une seule date : l'autre date saisie la croise (pas de Durée à garder) ;
- Durée non entière, négative, vide ou > 9999 ;
- date vide ou invalide ;
- nom vide (une ligne sans nom deviendrait une ligne de zone) ou de plus de 200 caractères.

Colonnes écrites : nom → `Taches` ; toute modification de date ou de durée →
`Diff_coffrage`, `Diff_armature` et `Duree_1` ensemble.

**Ligne de zone** (non modifiable), sur les tâches datées de la zone, règle MS Project :
- chaque tâche occupe l'intervalle [début du jour de Début ; fin du jour de Fin] ; un jalon
  occupe un **instant** : le début de son jour ;
- Début de zone = le plus tôt des débuts ; Fin de zone = le jour de l'instant de fin le
  plus tardif ;
- Durée de zone = jours ouvrés entre ces deux instants. Conséquence : un jalon placé en
  dernier ne compte pas son propre jour (capture : « PH RDB » 115 jours du Lun 14/09/26
  au Lun 22/02/27, fini par un jalon) ; une zone réduite à un jalon fait 0 jour ;
- aucune tâche datée → Durée, Début, Fin vides.

**Nouvelle tâche** (clic droit « Ajouter une tâche » dans une zone)
- Nom « Nouvelle tâche », zone = celle du clic ;
- Début = jour ouvré suivant la plus tardive des Fins de la zone ; zone sans tâche datée →
  aujourd'hui s'il est ouvré, sinon le jour ouvré suivant ;
- Durée 1 jour (Fin = Début), `Duree_1 = 1` ;
- le curseur est placé aussitôt dans le nom de la nouvelle ligne.

**Affichage** : Durée « 0 jour », « 1 jour », « 18 jours » ; dates « Lun 14/09/26 »
(`formatDays` / `formatTaskDate` existants).

## 5. Architecture

Trois modules nouveaux dans `Planning Projet/assets/js/`, chacun avec un rôle unique.

### 5.1 `services/syntheseTaskModel.js` — calculs (pur, sans DOM ni Grist)

Réutilise les fonctions testées de `services/syntheseTasks.js` (`isWorkingDay`,
`countWorkingDays`, `endAfterWorkingDays`, `parseGristDate`, `toIsoDate`, `formatTaskDate`,
`formatDays`).

```js
TASK_COLUMNS                      // noms de colonnes ci-dessus
isTaskRow(row)                    // Taches rempli, Type_doc et ID2 vides
readTask(row)                     // → Task
zoneKeyOf(name)                   // clé souple (accents, casse, ponctuation) ; "" = sans zone
nextWorkingDay(date) / previousWorkingDay(date)   // date elle-même si ouvrée
summarizeTasks(tasks)             // → { start, end, durationDays } | null (règle MS Project)
buildSections({ rows, sharedZones, zoneFilter })  // → Section[] (zones triées, tâches triées)
buildRowModel(sections, { collapsedZoneKeys })    // → Row[] : le modèle partagé avec le Gantt
applyTaskEdit(task, field, rawValue, { today })   // → { ok: true, task, fields } | { ok: false, error }
buildNewTask({ zoneName, zoneTasks, today })      // → { task, fields } (sans id)
buildTaskFields(task, { projectName })            // → champs d'un AddRecord
formatDuration(days) / formatDate(date)
```

Formes :

```js
Task    = { id, name, zoneName, zoneKey, start: Date|null, end: Date|null,
            durationDays: number|null, isMilestone: boolean }
Section = { zoneKey, zoneName, label, tasks: Task[], summary }
Row     = { key, kind: "zone"|"task", level: 0|1, zoneKey, zoneName, taskId,
            name, start, end, durationDays, isMilestone, collapsed, childCount }
```

`Row` est **le contrat avec le futur Gantt** : ligne n°i du tableau = ligne n°i du Gantt,
à la même hauteur ; `start`, `end`, `isMilestone` suffisent pour dessiner barres, jalons et
barres récapitulatives de zone.

### 5.2 `ui/syntheseTaskTable.js` — affichage (DOM, sans Grist)

```js
createSyntheseTaskTable(host, {
  onEdit(taskId, field, rawValue),  // Promise ; la cellule montre « enregistrement… »
  onAddTask(zoneKey),
  onDeleteTask(taskId),
  onToggleZone(zoneKey),
  onLockedAttempt(),
}) → { render(rows, { editable, emptyMessage }), startEditing(taskId, field), setStatus(text, tone) }
```

Il dessine, gère l'édition dans les cellules, le menu contextuel, le repli, le séparateur ;
il ne lit ni n'écrit jamais Grist.

### 5.3 `ui/syntheseTasksController.js` — chef d'orchestre

Créé par une fabrique à **dépendances injectées** (testable sous Node avec des doublures) :

```js
createSyntheseTasksController({ context, docApi, createTable, confirm, now })
  // createTable(callbacks) → tableau ; les callbacks relient le tableau au contrôleur
  → { setActive(bool), setEditingEnabled(bool), setZoneFilter(zoneName), refresh() }
```

- Lecture : `context.fetchContextRows("Planning_Projet", { forceRefresh })` (projet et service
  courants), jeton de chargement pour ignorer les réponses périmées.
- Mise à jour : `context.watchContextTables(["Planning_Projet"])`, `context.subscribe`
  (projet / service), `context.watchProjectZones` (zones des autres services, appliquées
  seulement si `meta.projectNames` correspond au projet courant).
- Écriture : `docApi.applyUserActions` — `UpdateRecord`, `AddRecord`, `RemoveRecord` sur
  `Planning_Projet`. Le contexte partagé vérifie les droits et impose `Service` / `NomProjet`.
- Affichage immédiat (mise à jour optimiste), puis relecture ; en cas d'échec, retour à
  l'état précédent + message.
- Après un ajout, l'id renvoyé par Grist sert à ouvrir l'édition du nom de la nouvelle ligne.
- Zones repliées : en mémoire, remises à zéro au changement de projet.
- Inactif (autre service) : aucune lecture ; les abonnements ignorent les signaux.

### 5.4 Intégration

- `main.js` : crée le contrôleur avec les vraies dépendances ; `applySyntheseSpace` →
  `setActive` ; `setPlanningEditingEnabled` → `setEditingEnabled(isPlanningEditingUnlocked())` ;
  changement ou normalisation de `state.selectedZone` → `setZoneFilter`.
- `services/planningSyncCoordinator.js` : exclut aussi les lignes-tâches (`isTaskRow`).
- `index.html` : `#syntheseSpace` reste le conteneur (contenu construit par le JS) ;
  numéro de version des scripts relevé.
- `assets/css/styles.css` : nouvelle section du tableau ; masquage de `#durationDefaultsToggle`
  sous `body.is-synthese-space`.
- Emplacement réservé, non créé : `ui/syntheseGantt.js`, qui consommera `Row[]` et suivra la
  fenêtre de dates du bandeau (`getPlanningWindow` / `subscribePlanningWindowChanges`,
  déjà exportées par `timeline.js`).

## 6. Écran et interactions

**Mise en page**
```
┌───────────────────────────────────────────┬┬──────────────────────────────┐
│ Nom de la tâche          │Durée │Début │Fin││ (en-tête réservé : échelle)  │ ← en-tête collant
├───────────────────────────────────────────┼┼──────────────────────────────┤
│▾ Zone Z2A                │271 j │…     │…  ││                              │
│    Plans avant synthèse… │18 j  │…     │…  ││        (futur Gantt)         │
│    Réunion de synthèse   │0 jour│…     │…  ││                              │
└───────────────────────────────────────────┴┴──────────────────────────────┘
                                             ↑ séparateur déplaçable
```
- Un seul conteneur défilant contient l'en-tête (collant en haut) et toutes les lignes ;
  chaque ligne = partie gauche (4 cellules) + partie droite (vide). Largeurs communes via une
  variable CSS, donc l'alignement vertical et horizontal est garanti.
- Hauteur de ligne fixe : 26 px (variable CSS unique).
- Séparateur : largeur du panneau gauche ajustable à la souris et au clavier (flèches),
  bornée, mémorisée dans le navigateur (`localStorage`, accès protégé par try/catch).
- Colonnes gauches : Nom (souple), Durée ~84 px, Début ~116 px, Fin ~116 px ; texte trop
  long coupé avec « … » et infobulle.

**Style** (repris de la capture)
- En-tête foncé, texte blanc.
- Ligne de zone : cellule du nom sur fond vert foncé, texte noir gras souligné plus grand,
  triangle ▾ / ▸ pour replier ; valeurs en gras.
- Tâches : texte normal, nom décalé sous la zone ; lignes séparées par un filet gris clair.
- Panneau droit : blanc, vide.

**Édition** (seulement « Editer » activé et service modifiable)
- Un clic sur une cellule de tâche ouvre l'éditeur : texte (nom), nombre (Durée), date
  (Début, Fin).
- Entrée ou clic ailleurs : valide. Échap : annule. Tab / Maj+Tab : valide et passe à la
  cellule suivante / précédente de la même ligne, sans boucler (Tab sur Fin valide
  seulement).
- Durée : ↑ / ↓ au clavier ou boutons ▲▼ à droite du champ (comme MS Project) : ±1 jour,
  de 0 (jalon) à 9999, valeur gardée sélectionnée ; enregistrée à la validation. Sur une
  cellule Durée sélectionnée sans saisie, ↑ / ↓ ouvre la saisie avec la valeur déjà changée.
  La molette ne change pas la durée (le tableau défile).
- Pendant l'enregistrement, la cellule est grisée ; en cas d'échec, l'ancienne valeur revient.
- Lignes de zone : non modifiables (clic sur le triangle = replier / déplier).

**Clic droit**
- Sur une ligne de zone : « Ajouter une tâche » (y compris « Sans zone » : la tâche est
  alors créée sans zone).
- Sur une tâche : « Ajouter une tâche » (même zone), « Supprimer la tâche » (confirmation).
- Sans droit d'édition : pas de menu, message « Activez « Editer » pour modifier. » (ou
  « Ce service est en lecture seule pour vous. »).
- Le menu se ferme au clic extérieur, à Échap, au défilement ; utilisable au clavier.

**Messages** : barre d'état en bas de la vue (`aria-live`), pour les refus, erreurs
d'écriture et confirmations.

**États vides**
- Aucun projet : « Choisissez un projet pour afficher ses tâches. »
- Projet sans zone ni tâche : « Aucune zone pour ce projet. Ajoutez-en une avec la liste
  « Zone » du bandeau (« Ajouter une zone »). »
- Filtre sur une zone sans tâche : la ligne de zone seule (clic droit pour ajouter).

## 7. Erreurs

| Cas | Comportement |
|---|---|
| Écriture refusée (lecture seule, projet / service changé, réseau) | Valeur précédente remise, message explicite (lecture seule / échec d'enregistrement). |
| « Editer » coupé pendant une saisie | L'écriture est refusée au moment d'enregistrer (revérification), message. |
| Lecture impossible | Message à la place des lignes ; nouvel essai au prochain signal. |
| Réponse de lecture périmée (changement de projet entre-temps) | Ignorée (jeton de chargement). |
| Zones des autres services indisponibles | Zones du service courant seulement ; la liste se complète quand elles arrivent. |

## 8. Tests

`Planning Projet/tests/syntheseTaskModel.test.mjs` (pur) :
- reconnaissance des lignes (tâche / zone / document) ;
- lecture des dates (secondes, ISO, `jj/mm/aaaa`) et durée, jalon via `Duree_1 = 0` ;
- jours ouvrés avec fériés (ex. 11/11, 25/12, 01/01) et recalage week-end ;
- toutes les cases du tableau « Modifications » et tous les refus ;
- récapitulatif de zone : tâches seules, jalon final (règle MS Project, cas « PH RDB »),
  zone réduite à un jalon, zone sans date ;
- nouvelle tâche : après la dernière Fin, zone vide (aujourd'hui ouvré / week-end) ;
- colonnes écrites (`buildTaskFields`, `fields` des modifications) ;
- sections : zones partagées fusionnées sans doublon (graphies différentes), « Sans zone »,
  filtre de zone, tri ;
- modèle de lignes : repli, niveaux, clés stables.

`Planning Projet/tests/syntheseTasksController.test.mjs` (doublures de contexte, docApi,
tableau) :
- chargement et rendu ; réponse périmée ignorée ;
- modification : écriture `UpdateRecord` attendue, affichage immédiat, retour arrière si
  l'écriture échoue ;
- ajout : `AddRecord` attendu (champs, zone, projet), édition du nom ouverte sur l'id renvoyé ;
- suppression : confirmation acceptée / refusée ;
- verrou : sans « Editer », aucune écriture et `onLockedAttempt` ;
- filtre de zone et zones partagées d'un autre projet ignorées.

Plus : suites existantes (Planning Projet, shared) toujours vertes, dont le test de
`planningSyncCoordinator` étendu aux lignes-tâches.

Vérification visuelle : Playwright / Chrome DevTools s'ils sont connectés ; sinon test
manuel de l'utilisateur sur localhost.

## 9. Hors périmètre (étapes suivantes)

- Diagramme de Gantt dans le panneau droit.
- Niveau intermédiaire (« PH RDB », vert clair).
- Documents du service Synthese en lignes bleues (jalons liés aux indices).
- Ressources, % achevé, liens entre tâches, ordre manuel, copier-coller, multi-sélection,
  annulation.
- Mémorisation du repli des zones entre deux sessions.
