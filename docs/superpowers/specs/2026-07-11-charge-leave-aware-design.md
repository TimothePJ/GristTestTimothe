# Spec — Planning de charge « leave-aware » (coordination Time-Out ↔ gestion-depenses2 / planning-synchro)

Date : 2026-07-11
Statut : design validé, en attente de relecture avant plan d'implémentation.

## 1. Objectif

Faire en sorte que les plannings de charge/prévisionnel de **gestion-depenses2** et **planning-synchro** (deux copies quasi identiques) tiennent compte des absences saisies dans le widget **Time-Out** :

1. Les **jours d'absence** (issus de Time-Out) apparaissent en **gris foncé** dans le planning de charge, comme les week-ends.
2. Le calcul des **« Jours disponibles dans la plage »** d'un segment de charge **soustrait** les demi-journées d'absence (en plus des week-ends).
3. Si l'**effectif** stocké (`TimeSegment.Effectif`, « Jours effectifs travaillés ») dépasse ce **dispo-après-absence**, le segment devient **rouge** pour alerter d'une incohérence — typiquement quand des congés ont été posés *après* la création du segment de charge.

Exemple de référence : segment de charge 29 juin → 10 juillet = 10 jours ouvrés ; RTT 30 juin → 3 juillet (4 jours) → **6 jours disponibles** au lieu de 10.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Types comptant comme absence | **Les 4** : `Congé Payé`, `Congé Non Payé`, `RTT`, `Congé Parental`. |
| Granularité | **Demi-journée** (matin/après-midi). Une RTT le matin = 0,5 jour retiré + demi-colonne grisée. |
| Alerte effectif > dispo | **Rouge non-bloquant** : le segment devient rouge, le champ effectif du modal passe rouge, mais la sauvegarde reste autorisée. |
| Périmètre widgets | **gestion-depenses2 ET planning-synchro**. **Time-Out inchangé** (source). |
| Portée données | Absences des **membres du projet affiché** uniquement (ProjectTeam), sur la plage visible. |
| Écriture Grist | **Aucune** : le dispo est calculé à la volée ; `Effectif`/`Allocation_Days` inchangés. |
| Owner non mappé | Absence **ignorée** silencieusement (log console optionnel). Pas de correction auto de l'anomalie `PrenomNom`. |

## 3. Ancrage dans le code existant (grounding)

Fonctions et emplacements confirmés (référence pour le plan) :

**Maths dispo/effectif (identiques dans les 2 widgets, `utils/timeSegments.js`)**
- Dispo = `getSegmentAllocationDays(segment)` = `getBusinessHalfDaySlotsBetween(startAt, endAt).length / 2` (WK exclus via `isBusinessDay`, 2 demi-journées/jour, parts `["am","pm"]`, AM 08–12 / PM 13–17).
- `getBusinessHalfDaySlotsBetween(s, e)` → 1 objet slot par demi-journée ouvrée, chaque slot portant `.key = "YYYY-MM-DD:am|pm"` (`createHalfDaySlotKey`, minuscules).
- Effectif écrêté en silence : `getSegmentEffectiveDays` fait `Math.min(allocationDays, effectif)` → l'incohérence est aujourd'hui invisible. On comparera donc l'**effectif brut stocké** (`segment.effectifDays`), pas la valeur écrêtée.

**gestion-depenses2**
- Dispo/effectif : `utils/timeSegments.js` (verbatim). Effectif lu dans `services/projectService.js:568-585` → `segment.effectifDays`.
- Barres : `ui/chargeTimeline.js` — `buildVisibleSegmentBars` (648-698, effectif à 665) → `assignSegmentLanes` (700-716) → `renderSegmentBars` (718-752, classe statique + `is-compact`).
- Grille WK : `renderTrackGrid(months, zoomMode, zoomScale, sizingContext)` (578-623), placement **par mois** : `dayWidth = monthWidth/calendarDayCount`, `left = dayIndex * dayWidth` dans le span mois. Appelée dans `renderWorkerRow` (~787).
- Modal : inline dans `main.js` — readout `syncEditChargePlanDerivedValues` (1472-1499) via `getSegmentAllocationDays` ; validation `saveEditedChargePlanSegment` (1670-1675, blocage `effectif > selection.totalDays`).
- Fetch : `services/gristService.js` `fetchProjectDataTables` (270-302) fetche déjà `Team` (`config.js:77`) MAIS colonnes `team` = `{ id, firstName:"Prenom", lastName:"Nom", role:"Role" }` (`config.js:161-166`) → **manque `Email`, `PrenomNom`**.
- Clé perso : `buildWorkerLookupKey(projectNumber, name)` = `NumeroProjet::normalizePersonName(Name)` (`projectService.js:100-117`).

**planning-synchro**
- Dispo/effectif : `utils/timeSegments.js` (port verbatim). Effectif lu dans `bottom/chargeBoard.js:142` (`normalizeDecimal`).
- Barres : `bottom/chargeBoard.js` — `buildVisibleSegmentBars` (304-347, `effectiveDays` à 316) → `assignSegmentLanes` → `renderSegmentBars` (364-393, `data-worker-name` + `data-effectif`).
- Grille WK : `renderTrackGrid(windowDays, dayWidth)` (270-285), placement **à plat** : `left = dayIndex * dayWidth`. Appelée dans `renderWorkerRow` (406-433, ~424). `render()` reçoit `planningTasks` (639/656) — même patron pour threader les absences.
- Modal : `bottom/editSegmentModal.js` — readout à 85/204-218 (`getSegmentAllocationDays`) ; validation `validateEditSegmentEffectif` (120-138, blocage `> totalDays`).
- Fetch : `services/gristService.js` `fetchProjectData` (238-251) ne fetche que `planningProject`/`timeSegment`/`projectTeam`. **Ni `Team` ni `Time-Out`**. `config.js:22-27` sans `team`/`timeOut`.
- Clé perso : `normalizeNameKey(Name)` (`chargeBoard.js:91-98`), sans préfixe projet (le fetch filtre déjà par projet).

**Rouge existant à réutiliser** : `.is-invalid` sur l'aperçu de drag (`#b42318`, rgba(180,35,24,…)) — `styles.css` (gd2 1775-1780 ; ps 1136-1143).

**Time-Out (source, inchangé)** : table Text `Owner`(email), `Start_Date`, `Start_Period` AM/PM, `End_Date`, `End_Period`, `Type`. Helpers `segmentToDates` (textSegments.js:20) + modèle AM/PM 08-12/13-17 identiques.

## 4. Couche données & mapping (par widget)

Ajouts au chargement du board :
- **Fetch `Time-Out`** (toutes les lignes ; table id `Time-Out`/`Time_Out` avec fallback) et **`Team`** (colonnes `Email`, `PrenomNom`, `Prenom`, `Nom`).
- `teamByEmail : Map<normalizeEmail(Email), teamRow>` (email = `toText(x).toLowerCase()`).
- `absenceByPerson : Map<personKey, Set<slotKey>>` où :
  - `personKey = normalizeNameKey(Team.PrenomNom || (Prenom + " " + Nom))` — **même** normalisation que la clé du board.
  - Pour chaque ligne Time-Out dont le `Type` ∈ les 4 : `range = segmentToDates({startDate,startPeriod,endDate,endPeriod})` puis `getBusinessHalfDaySlotsBetween(range.startAt, range.endAt)` → ajouter chaque `slot.key` au Set.
  - `Owner` non trouvé dans `teamByEmail`, ou `personKey` absent des membres du projet → ligne **ignorée**.
- Attache au worker : `absenceByPerson.get(normalizeNameKey(worker.name))`.

Remarque casse : ne jamais concaténer `Start_Period` brut (`AM`) dans une clé ; passer par `segmentToDates` → slots (minuscules) pour matcher les `slot.key` du board.

## 5. Maths dispo-après-absence (module pur commun)

Nouveau module `assets/js/utils/leaveAbsences.js` (dupliqué dans chaque widget, testé `node --test`) :

- `normalizeEmail(value) -> string`
- `buildAbsenceIndex(timeOutRows, teamRows, timeOutCols, teamCols, absenceTypes) -> Map<personKey, Set<slotKey>>` (utilise `segmentToDates` + `getBusinessHalfDaySlotsBetween` importés du `timeSegments.js`/`textSegments.js` du widget ; `personKey` via la fonction de normalisation du widget passée en paramètre pour rester DRY).
- `availableDaysAfterLeave(startAt, endAt, absenceSet) -> number` : `getBusinessHalfDaySlotsBetween(startAt, endAt)` filtré sur les slots dont `.key ∉ absenceSet`, `.length / 2`.
- `absenceHalfDayKeysForWorker(...)` : accès direct au Set d'un worker pour le grisage.

Base = **géométrie de la plage** (jours ouvrés dans les dates du segment), pas le `Allocation_Days` stocké (potentiellement obsolète). Ex. : 20 demi-j ouvrées − 8 demi-j RTT = 12 demi-j → 6 jours.

## 6. Rendu (3 intégrations, par widget)

**6a. Grisage demi-journée des absences**
- Threader l'`absenceSet` du worker jusqu'à `renderTrackGrid`.
- Pour chaque jour visible et chaque part (`am`/`pm`), si `slotKey ∈ absenceSet` → émettre `<span class="charge-plan-grid-day is-absence" style="left:<x>; width:<dayWidth/2>">` avec `x = base + partIndex*(dayWidth/2)` (base = `dayIndex*dayWidth` en plat ; `monthOffset + dayIndexWithinMonth*dayWidth` en mensuel).
- CSS : `.charge-plan-grid-day.is-absence { background: rgba(8,21,38,0.28); }` (plus foncé que le WK 0.08). Span séparé (un jour d'absence peut aussi être ouvré).

**6b. Segment rouge « incohérent »**
- Dans `buildVisibleSegmentBars` : `const available = availableDaysAfterLeave(startAt, endAt, absenceSet); const incoherent = effectifStocké != null && effectifStocké > available;` (effectif brut : gd2 `segment.effectifDays` ; ps `bar.effectif`/`segment.effectif`).
- Porter `bar.incoherent` à travers `assignSegmentLanes`, émettre `is-incoherent` dans `renderSegmentBars` + `title` : « Effectif (X j) > disponible après absences (Y j) ».
- CSS : `.charge-plan-segment-bar.is-incoherent { background: linear-gradient(135deg,#e5534b,#b42318); }` (rouge existant).

**6c. Modal d'édition**
- Readout « Jours disponibles dans la plage » = `availableDaysAfterLeave(range, absenceSetDuWorker)` au lieu de `getSegmentAllocationDays` seul (dans `syncDerived`/`syncEditChargePlanDerivedValues`).
- Champ effectif : ajouter la classe rouge quand `valeur > dispo-après-absence` (mise à jour live), et retirer le **blocage dur** `> totalDays` (le remplacer par un simple état visuel). Conserver les checks « négatif » et « multiple de 0,5 ». `input.max` : soit retiré, soit laissé au dispo brut (non contraignant).
- Sauvegarde autorisée même si incohérent ; le segment reste rouge sur le board.

## 7. Points d'intégration exacts par widget

**planning-synchro** (à plat, modal externalisé)
- `config.js` : ajouter `tables.team = "Team"`, `tables.timeOut = "Time-Out"` + `columns.team`/`columns.timeOut`.
- `services/gristService.js` : `fetchProjectData` fetche aussi `Team` + `Time-Out` (globaux, non filtrés par projet).
- `main.js` : construire `absencesByWorker` après fetch, le passer à `chargeBoard.render({ ..., absencesByWorker })` (call sites ~316/440).
- `bottom/chargeBoard.js` : `render` accepte `absencesByWorker` → `renderWorkerRow` → `renderTrackGrid(windowDays, dayWidth, absenceSet)` (6a) ; `buildVisibleSegmentBars` calcule `incoherent` (6b).
- `bottom/editSegmentModal.js` : `buildEditSegmentSelection`/`validateEditSegmentEffectif` prennent l'`absenceSet` pour le readout + l'état rouge (6c).

**gestion-depenses2** (par mois, modal inline)
- `config.js` : compléter `columns.team` avec `email:"Email"`, `prenomNom:"PrenomNom"` ; ajouter `tables.timeOut = "Time-Out"` + `columns.timeOut`.
- `services/gristService.js` : `fetchProjectDataTables` fetche aussi `Time-Out`.
- `services/projectService.js` : construire `absenceByPerson`, l'attacher aux workers.
- `ui/chargeTimeline.js` : `renderTrackGrid` (grisage par mois, 6a) ; `buildVisibleSegmentBars` (incoherent, 6b) ; threading depuis `renderWorkerRow`.
- `main.js` : readout + validation du modal inline (6c).

## 8. Module partagé

`leaveAbsences.js` est un fichier **pur** (aucun DOM, aucun accès Grist direct) dupliqué à l'identique dans les deux widgets — cohérent avec le vendoring existant. Il importe `segmentToDates`/`getBusinessHalfDaySlotsBetween` du widget hôte (paramètres ou imports locaux) pour rester aligné sur le modèle demi-journée de chaque widget. Le **placement en pixels** du grisage et l'accroche de `is-incoherent` restent propres à chaque widget (car dayWidth diffère).

## 9. Cas limites

- **Owner non mappé** (email absent de Team, ou personne hors ProjectTeam, ou anomalie `PrenomNom` type Omid) → absence ignorée, pas de crash, log console optionnel.
- **Time-Out absent du document** (fetch échoue) → `absenceByPerson` vide, comportement = aujourd'hui (aucune absence), pas d'erreur (fetch en `.catch(() => [])`).
- **Demi-journée** : une absence AM ne grise que la moitié matin et ne retire que 0,5 j.
- **Chevauchement absence/segment partiel** : seules les demi-journées **dans** la plage du segment sont soustraites (test d'overlap de slot existant).
- **Effectif non renseigné** (`null`) → jamais incohérent (pas de rouge).

## 10. Hors périmètre

Aucune écriture Grist ; Time-Out inchangé ; pas de correction de l'anomalie `PrenomNom` ; pas de prise en compte des absences de personnes hors projet ; pas de refonte du modal ; pas de fusion réelle des deux widgets en un package partagé.

## 11. Tests

- `leaveAbsences.js` : tests `node --test` sur `buildAbsenceIndex` (mapping email→nom, expansion demi-journée, filtre des 4 types, owner non mappé ignoré) et `availableDaysAfterLeave` (ex. de référence 20−8 → 6 ; demi-journée ; WK déjà exclus).
- Placement px du grisage + classe `is-incoherent` : vérification manuelle dans Grist (DOM).
- Non-régression : suites `node --test` existantes de planning-synchro restent vertes.

## 12. Plan de construction (aperçu)

- **Phase 0 (Grist, utilisateur)** : aucune nouvelle table (Time-Out + Team existent déjà). Vérifier que `Team.PrenomNom`/`Email` sont peuplés pour les personnes concernées.
- **Phase 1** : module pur `leaveAbsences.js` + tests, créé dans les deux widgets.
- **Phase 2 (planning-synchro)** : fetch Team+Time-Out, `absencesByWorker`, grisage demi-journée, segment rouge, modal.
- **Phase 3 (gestion-depenses2)** : colonnes Team + fetch Time-Out, index d'absence, grisage par mois, segment rouge, modal inline.
- **Phase 4** : vérification manuelle croisée dans Grist (grisage aligné, rouge correct, exemple 6 j) + non-régression.

## 13. Risques

- Le pont email→nom repose sur `PrenomNom` (valeur stockée, pas formule) : mismatch possible (ordre `Nom Prénom`, homonymes, anomalie Omid). Mitigation : ignorer proprement, ne pas attacher au mauvais.
- Deux copies du module → risque de divergence : garder `leaveAbsences.js` identique et testé des deux côtés.
- gestion-depenses2 place les jours par mois : le calcul du `left`/`width` du grisage demi-journée doit suivre exactement `buildVisibleSlots` (offset mensuel + `partIndex*halfDayWidth`).
