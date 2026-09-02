# Spec — `TimeSegment` passe au mois (`Mois` remplace `Start_At`/`End_At`)

Date : 2026-08-25
Statut : design validé, en attente de relecture avant plan d'implémentation.

## 1. Objectif

Changer la granularité du plan de charge prévisionnel : **un segment `TimeSegment` ne
couvre plus une plage libre au demi-jour près, mais exactement un mois**.

1. La colonne **`Mois`** devient la source unique de vérité temporelle. `Start_At` et
   `End_At` ne sont plus écrites.
2. Dans les deux plannings (`gestion-depenses2`, `planning-synchro`), **un clic** sur une
   ligne crée un segment couvrant **tout le mois** cliqué — plus de glisser-déposer, plus
   de poignées de redimensionnement.
3. La fenêtre « Modifier le segment » perd `Début` / `Fin` / `Matin` / `Après-midi` : elle
   ne sert plus qu'à saisir les **jours effectifs travaillés** dans le mois.
4. **`Gestion-User`** conserve sa vue hebdomadaire, alimentée par répartition du mois, et
   passe à une capacité **réelle** : week-ends, jours fériés **et congés Time-Out**.

Exemple de référence : 8 jours effectifs sur septembre 2026 (22 jours ouvrés, dont 2 jours
de congé) → la fenêtre affiche « 20 j disponibles », et `Gestion-User` étale ces 8 jours
sur les semaines de septembre au prorata des jours réellement disponibles de la personne.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Type de la colonne `Mois` | **Date Grist, valeur = 1er du mois.** Identique à `TimeReal.Mois`. |
| Lecture du mois | `getMonthKeyFromRawMonth()` → `"YYYY-MM"`. Tolère Date, epoch, `"YYYY-MM"`, `"YYYY-MM-DD"`, `"MM/YYYY"`. |
| Écriture du mois | `toGristMonthValue("YYYY-MM")` → epoch secondes du 1er du mois. |
| Unicité | Clé métier **(`NumeroProjet`, `Name`, `Mois`)**. Un clic sur un mois déjà occupé **édite** le segment existant, il n'en crée pas un second. |
| Quantité faisant foi | **`Effectif`** (jours effectifs travaillés), partout — y compris dans `Gestion-User`, qui utilisait `Allocation_Days`. |
| `Allocation_Days` | Reste **écrite** (= jours ouvrés du mois) pour le confort de lecture dans Grist, mais **plus jamais lue** par le code. |
| `Effectif` | **Obligatoire, > 0, multiple de 0,5.** Vide / 0 / 2,3 → enregistrement bloqué. |
| Dépassement des jours disponibles | **Rouge non bloquant** — comportement actuel conservé. |
| Flux de création | Clic → barre provisoire + fenêtre ; **écriture Grist uniquement à `Enregistrer`**. `Annuler` n'écrit rien. |
| Lignes existantes | **Repli en lecture** : `Mois` sinon `Start_At`. Aucun outillage de migration — la colonne est créée et remplie manuellement dans Grist. |
| Périmètre | `gestion-depenses2`, `planning-synchro`, `Gestion-User`. |
| Hors périmètre | `gestion-equipe` (vérifié : ne lit aucune date, aucun changement nécessaire). |
| Partage de code | **Vendorisation** d'un module `monthSegments.js` par widget + **test de parité** octet à octet. |
| Git | **Aucun commit, aucun push.** Le dépôt est laissé propre pour relecture manuelle. |

## 3. Modèle de données

```
TimeSegment
  NumeroProjet     inchangé  ─┐
  Name             inchangé   ├─ clé métier UNIQUE
  Mois             Date = 1er du mois          ← source unique de vérité ─┘
  Effectif         jours travaillés, > 0, multiple de 0,5   ← LA CHARGE
  Allocation_Days  = jours ouvrés du mois — écrite, jamais lue
  Label            inchangé
  Service          inchangé
  Segment_Type     inchangé (filtre « previsionnel » de gestion-depenses2 conservé)
  Start_At/End_At  PLUS JAMAIS ÉCRITES ; lues en repli si Mois est vide
```

**Résolution du mois d'une ligne**, identique dans les trois widgets :

```
resolveSegmentMonthKey(row, cols)
  = getMonthKeyFromRawMonth(row[cols.mois])          // 1. Mois
 || getMonthKeyFromRawMonth(row[cols.startDate])     // 2. repli legacy
 || ""                                               // 3. ligne ignorée
```

Le repli devient **inerte sans erreur** le jour où `Start_At` est supprimée de la table :
`row[cols.startDate]` vaut alors `undefined`, `getMonthKeyFromRawMonth` renvoie `""`, la
ligne est ignorée. Aucun garde-fou supplémentaire n'est nécessaire.

## 4. Ancrage dans le code existant (grounding)

### gestion-depenses2

- **Config** : `assets/js/config.js:147-158` — bloc `timeSegment`. Ajouter `mois: "Mois"`.
- **Lecture** : `assets/js/services/projectService.js:629-672` — la boucle `timeSegmentRows`
  construit `segment.startAt/endAt` via `parseRawDateTime`, puis appelle
  `getSegmentAllocationByMonth(segment)` pour ventiler sur `worker.provisionalDays`.
- **Ventilation** : `assets/js/utils/timeSegments.js:203-267` — `getSegmentAllocationByMonth`
  (répartition multi-mois au plus grand reste, ~65 lignes). **Devient inutile : supprimée.**
- **Effectif** : `getSegmentEffectiveDays` (`utils/timeSegments.js:184-194`) =
  `min(getSegmentAllocationDays(segment), effectif)`. L'écrêtage reste, mais le plafond
  vient désormais des jours ouvrés du mois.
- **Barres** : `assets/js/ui/chargeTimeline.js:665-721` `buildVisibleSegmentBars` →
  `assignSegmentLanes` (723-739) → `renderSegmentBars` (741-782).
- **Créneaux** : `buildVisibleSlots` (`ui/chargeTimeline.js:392-437`) produit un créneau par
  demi-journée avec `leftPx`/`widthPx`. **Conservé** : la grille week-end/férié/absence
  (`renderTrackGrid`, 579-640) continue de s'appuyer dessus.
- **Interaction** : `assets/js/main.js` — `handleChargePlanPointerDown` (5330),
  `handleChargePlanPointerMove` (5467), `handleChargePlanPointerUp` (5540),
  `createChargePlanSegment` (3000), `resizeChargePlanSegment` (3174),
  `updateChargePlanSegmentSelection` (3096), `selectionOverlapsWorkerSegments` (3188).
- **Écriture** : `assets/js/services/gristService.js` — `createTimeSegment` /
  `updateTimeSegment` / `removeTimeSegment`.
- **Modale** : `index.html:220-284` (`#edit-segment-modal`) + les helpers de `main.js`
  (`buildChargePlanSelectionFromEditValues`, `syncEditChargePlanDerivedValues`,
  `openEditChargePlanModal`, `saveEditedChargePlanSegment`).

### planning-synchro

- **Config** : `assets/js/config.js:40-44`. Ajouter `mois: "Mois"`.
- **Construction des workers** : `assets/js/bottom/chargeBoard.js:104-149`
  `buildWorkersFromSegments` — lit `startDate`/`endDate` via `parseDateTime`.
- **Bornes de la frise** : `assets/js/top/bounds.js` `computeTimeSegmentBounds` — min/max sur
  `Start_At`/`End_At`. Devient min/max sur `Mois` (1er du mois → dernier jour du mois).
- **Ligne Total** : `chargeBoard.js:464-561` — `computeMonthTotalDays` proratise chaque
  segment sur le mois. **Devient une somme directe par `monthKey`.**
- **Barres** : `chargeBoard.js:300-416`, même trio que gestion-depenses2.
- **Interaction** : `assets/js/bottom/chargeEditing.js` — `handlePointerDown` (347),
  `handlePointerMove` (424), `handlePointerUp` (457), `trackHasOverlap` (159),
  `buildSelectionFromSlotIndexes` (104).
- **Modale** : `assets/js/bottom/editSegmentModal.js` + `index.html:88-143`.
- **Fixtures** : `dev/fixtures.js` — à basculer sur `Mois`.

### Gestion-User

- **Config** : `assets/js/config.js` — `TABLES` (3 tables) et `COLUMN_CANDIDATES.timeSegment`.
- **Lecture** : `assets/js/dataService.js:78-105` `buildSegments` — construit
  `{ startDate, endDate, startTime, endTime, allocationDays, fullHalfDayUnits }`.
- **Calcul** : `assets/js/utilizationService.js:18-30` `getSegmentDaysInRange` — proratise
  **`allocationDays`** (et non `Effectif`) sur l'intersection segment ∩ semaine.
- **Capacité** : `assets/js/dateRange.js:194-206` `countWorkingDays` /
  `countWorkingHalfDayUnits` (212-236) — **ne comptent que les week-ends**, ni fériés ni
  congés. `getRangeCapacityDays` (244) est appelée une fois par semaine dans
  `getPreparedWeeks` (`utilizationService.js:90-98`), donc **partagée entre tous les
  collaborateurs**.

## 5. Le module `monthSegments.js` (nouveau, vendorisé ×3)

Pur : aucun DOM, aucun Grist, testable sous `node --test`. Emplacements :

- `gestion-depenses2/assets/js/utils/monthSegments.js`
- `planning-synchro/assets/js/utils/monthSegments.js`
- `Gestion-User/assets/js/monthSegments.js`

Les trois fichiers sont **identiques octet pour octet**, garanti par
`shared/tests/vendored-charge-modules-parity.test.cjs` — qui verrouille de la
même façon les **trois** modules vendorisés du plan de charge :
`monthSegments.js`, `leaveAbsences.js` et `frenchHolidays.js`.

```js
// Résolution
resolveSegmentMonthKey(row, cols) -> "YYYY-MM" | ""
monthKeyFromDate(date)            -> "YYYY-MM" | ""

// Bornes
getMonthBounds(monthKey)          -> { startAt, endAt } | null
//   startAt = 1er du mois 00:00:00
//   endAt   = dernier jour du mois 23:59:59.999

// Capacité
getMonthBusinessDays(monthKey)                -> number   // hors WK + fériés
getMonthAvailableDays(monthKey, absenceSet)   -> number   // ... hors congés

// Répartition (Gestion-User)
getMonthShareForRange(monthKey, rangeStart, rangeEnd, absenceSet) -> number  // 0..1
```

`getMonthShareForRange` renvoie
`dispo(rangeStart..rangeEnd ∩ mois) / dispo(mois)`, et **retombe sur un ratio en jours
ouvrés** (ignorant les congés) quand `dispo(mois) == 0` — sans quoi la charge d'une personne
absente tout le mois disparaîtrait silencieusement.

Le calcul de disponibilité réutilise `availableDaysAfterLeave()` de `leaveAbsences.js`, qui
couvre déjà **les trois exigences d'un coup** : week-ends et jours fériés (via
`isBusinessDay` → `frenchHolidays.js`) et congés (via l'`absenceSet`).

## 6. Interaction du planning

| Aujourd'hui | Demain |
|---|---|
| Glisser sur une piste = créer au demi-jour | **Clic** sur une piste = le mois entier |
| Poignées `.charge-plan-segment-handle` | **Supprimées** du DOM et du CSS |
| Aperçu `.charge-plan-selection-preview` au demi-jour | **Surlignage du mois** survolé |
| Contrôle de chevauchement | Remplacé par l'unicité (mois occupé → édition) |
| Clic droit → Modifier / Supprimer | **Inchangé** |
| Bouton `Editer` / `Verrouiller` | **Inchangé** — reste le garde-fou d'écriture |

La frise reste **jour par jour** : c'est indispensable à l'alignement arithmétique avec le
pane haut de `planning-synchro` (`sync/viewportMath.getDayBoundaryLeftPx`), et la grille
conserve le grisé week-ends / fériés / absences. Seule la **barre** est calée sur
`getMonthBounds(monthKey)`.

`assignSegmentLanes` est **conservée** : si des doublons (`NumeroProjet`, `Name`, `Mois`)
subsistent en base — legacy, ou saisie concurrente depuis deux widgets — ils s'empilent
proprement au lieu de se superposer.

**Cycle de création**

```
pointerdown sur une piste, mois vide
  -> barre provisoire hachurée sur tout le mois
  -> ouverture de la fenêtre
     Enregistrer -> AddRecord (1 seule écriture) -> onChanged/refresh
     Annuler     -> barre retirée, RIEN en base

pointerdown sur une piste, mois déjà occupé
  -> ouverture de la fenêtre sur le segment existant
     Enregistrer -> UpdateRecord
```

## 7. La fenêtre « segment »

```
┌─ Segment de septembre 2026 — Marie DUPONT ──────────┐
│                                                      │
│  Jours effectifs travaillés   [  8,0  ]              │
│  Jours disponibles dans le mois        20 j          │
│      (22 jours ouvrés − 2 j d'absence)               │
│                                                      │
│                          [ Annuler ] [ Enregistrer ] │
└──────────────────────────────────────────────────────┘
```

- **Supprimés** : `#edit-segment-start-date`, `#edit-segment-end-date`,
  `#edit-segment-start-part`, `#edit-segment-end-part` (et leurs jumeaux `#ps-…`).
- **Renommé** : « Jours disponibles dans la plage » → **« Jours disponibles dans le mois »**.
- **Ajouté** : un en-tête en lecture seule rappelant le mois et la personne — sans dates de
  début/fin, l'utilisateur perdrait sinon tout repère sur ce qu'il édite.
- **Validation** : `""` / `0` / négatif / non-multiple de 0,5 → **bloquant**, message sous le
  champ. Effectif > jours disponibles → **rouge non bloquant** (inchangé).

## 8. Agrégations

| Emplacement | Avant | Après |
|---|---|---|
| `projectService.buildExpenseData` | `getSegmentAllocationByMonth(segment)` puis `mergeMonthlyDays` sur N mois | `provisionalDays[monthKey] += Effectif` |
| `utils/timeSegments.js` | `getSegmentAllocationByMonth` (~65 lignes) | **supprimée** |
| `chargeTimeline.renderReadonlyTrack` | somme de `provisionalDays[month.monthKey]` | **inchangé** (l'entrée est déjà bonne) |
| `chargeBoard.computeMonthTotalDays` | prorata jours ouvrés du segment ∩ mois | somme directe des `Effectif` du `monthKey` |
| `getSegmentEffectiveDays` | `min(jours ouvrés de la plage, Effectif)` | `min(jours ouvrés du mois, Effectif)` |

Le contrat de `renderReadonlyTrack` / `renderTotalRow` ne bouge pas : ils consomment déjà un
dictionnaire `{ monthKey: jours }`.

## 9. Gestion-User

### 9.1 Nouvelles dépendances

Trois modules vendorisés arrivent dans `Gestion-User/assets/js/` :
`frenchHolidays.js`, `leaveAbsences.js` (copies conformes des existants), `monthSegments.js`.

`TABLES` gagne `timeOut: "Time-Out"`, avec la résolution d'identifiant à trois essais
(`Time-Out` / `Time_Out` / `TimeOut`) déjà éprouvée dans
`planning-synchro/services/gristService.js:248-258`. `COLUMN_CANDIDATES` gagne le bloc
`timeOut` (`Owner`, `Start_Date`, `Start_Period`, `End_Date`, `End_Period`, `Type`) et
`timeSegment.mois`.

### 9.2 ⚠️ Piège de normalisation des noms

`buildAbsenceIndex` renvoie une `Map` **clée par `leaveAbsences.normalizeName`** :

| Fonction | `"Jean-Pierre Dupont"` donne |
|---|---|
| `leaveAbsences.normalizeName` (NFD, diacritiques, espaces) | `jean-pierre dupont` |
| `Gestion-User.normalizePersonName` (…**+ ponctuation → espace**) | `jean pierre dupont` |

Utiliser la clé locale ferait **échouer silencieusement les congés de tous les prénoms
composés**. Chaque employé porte donc **deux clés** : `key` (interne, inchangée, pour la
matrice) et `absenceKey = normalizeName(fullName)` (pour l'index d'absences) — exactement le
schéma de `gestion-depenses2/services/projectService.js:599`.

Aucun des deux normaliseurs n'est modifié.

### 9.3 Arithmétique

```
dispo(E, P)   = availableDaysAfterLeave(P.start, P.end, absenceSet(E))
              // WK + fériés + congés, en une seule fonction

charge(S, W)  = Effectif(S) × getMonthShareForRange(mois(S), W.start, W.end, absenceSet(E))
capacité(E,W) = dispo(E, W)                        ← désormais PAR COLLABORATEUR
%             = charge / capacité × 100            si capacité > 0
```

Propriété de contrôle : pour un segment donné, `Σ charge(S, W)` sur toutes les semaines
touchant son mois `== Effectif(S)` (aux arrondis flottants près). C'est l'assertion
principale des tests.

### 9.4 Impacts structurels

- `getRangeCapacityDays` sort de `getPreparedWeeks` : la capacité n'est plus une propriété de
  la semaine mais du couple **(collaborateur, semaine)**. Elle est pré-calculée une fois par
  employé dans une `Map<weekValue, number>` en entrée de la boucle, pour ne pas re-parcourir
  les jours à chaque projet.
- **Capacité nulle** (semaine entièrement fériée ou en congé) : la cellule affiche un état
  **« Congé »** distinct, et non `0 %` — un `0 %` se lirait « disponible », soit l'inverse de
  la réalité.
- `buildSegments` ne produit plus `startDate`/`endDate`/`fullHalfDayUnits`/`allocationDays`
  mais `{ monthKey, effectif, employeeKey, absenceKey, projectNumber }`. Une ligne sans mois
  résoluble ou sans `Effectif > 0` est ignorée.

## 10. Écriture Grist

`createTimeSegment` / `updateTimeSegment` (les deux widgets éditeurs) :

- **Écrivent** `Mois` (via `toGristMonthValue`), `Effectif`, `Allocation_Days`
  (= `getMonthBusinessDays(monthKey)`), plus `NumeroProjet` / `Name` / `Service` inchangés.
- **N'écrivent plus** `Start_At` / `End_At`.
- Les alias de colonnes (`TIME_SEGMENT_COLUMN_ALIASES`) gagnent `mois: ["Mois", "Month"]`.
- `removeTimeSegment` est inchangée.

`gestion-depenses2` conserve sa **mutation optimiste** (barre affichée avant la réponse
Grist, rollback sur erreur) ; `planning-synchro` conserve son **refetch complet** via
`onChanged()`. Ces deux stratégies restent en l'état — elles ne sont pas concernées par le
changement de granularité.

## 11. Tests

| Fichier | Couvre |
|---|---|
| `*/tests/monthSegments.test.mjs` (×3) | résolution `Mois`/repli, bornes du mois, jours ouvrés, dispo après congés, `getMonthShareForRange` (somme = 1, mois à dispo nulle) |
| `shared/tests/vendored-charge-modules-parity.test.cjs` | les 3 copies de **chacun** des modules vendorisés (`monthSegments.js`, `leaveAbsences.js`, `frenchHolidays.js`) sont identiques octet à octet |
| `gestion-depenses2/tests/gristService.test.mjs` | `createTimeSegment` écrit `Mois`, n'écrit plus `Start_At`/`End_At` |
| `planning-synchro/tests/gristService.test.mjs` | idem |
| `planning-synchro/tests/chargeWorkers.test.mjs` | `buildWorkersFromSegments` sur `Mois` + repli legacy |
| `planning-synchro/tests/segmentBounds.test.mjs` | `computeTimeSegmentBounds` depuis `Mois` |
| `planning-synchro/tests/editSegmentModal.test.mjs` | validation Effectif obligatoire / multiple de 0,5 |
| **`Gestion-User/tests/`** (nouveau dossier) | `buildSegments`, `getSegmentDaysInRange`, capacité par collaborateur, piège de normalisation des prénoms composés |

Le dossier `Gestion-User/tests/` **n'existe pas aujourd'hui** : c'est le premier filet de
sécurité de ce widget, et le calcul qu'on y touche est précisément celui qui n'a jamais été
testé.

Vérification navigateur : le harnais `planning-synchro/dev/harness.html` (mock Grist +
fixtures, écritures appliquées en mémoire) sert de banc d'essai pour le nouveau cycle
clic → fenêtre → `AddRecord`.

## 12. Risques et points de vigilance

| Risque | Traitement |
|---|---|
| Prénoms composés → congés ignorés dans Gestion-User | Clé `absenceKey` dédiée (§9.2) + test dédié |
| Doublons (projet, personne, mois) en base legacy | `assignSegmentLanes` conservée : empilement propre, pas de superposition |
| Lignes legacy sans `Mois` | Repli en lecture sur `Start_At` ; première ré-édition les bascule |
| Divergence des 3 copies de `monthSegments.js` | Test de parité octet à octet |
| Perte du repère temporel dans la fenêtre | En-tête « mois — personne » en lecture seule |
| Charge invisible si dispo mensuelle nulle | Repli sur prorata jours ouvrés dans `getMonthShareForRange` |
| **Lignes legacy à `Effectif` vide** | `Gestion-User` proratisait `Allocation_Days` : ces lignes y comptaient une charge alors qu'elles comptaient déjà **0 jour** dans `gestion-depenses2`. En passant à `Effectif`, elles tombent à 0 **dans les deux** — les deux widgets deviennent cohérents, mais des pourcentages **baisseront** dans `Gestion-User` au moment de la bascule. Comportement voulu, signalé ici pour qu'il ne soit pas pris pour une régression. |

## 13. Hors périmètre

- **`gestion-equipe`** — vérifié : `app.js:57` ne référence `TimeSegment` que pour le
  filtrage par numéro de projet, aucune colonne de date lue. Rien à faire.
- **Suppression effective de `Start_At` / `End_At` dans Grist** — opération manuelle, à ta
  main, quand tu jugeras la bascule terminée. Le code n'en dépend plus dès cette livraison.
