# Spec — Jours fériés français automatiques (grisés + exclus, comme les week-ends)

Date : 2026-07-11
Statut : design validé, en attente de relecture avant plan.

## 1. Objectif

Griser automatiquement les **jours fériés français** (calculés, sans saisie ni table) **exactement comme les week-ends** dans les plannings de **Time-Out**, **gestion-depenses2** et **planning-synchro** : les fériés sont grisés dans la grille **et** exclus des décomptes (jours ouvrés / jours disponibles / jours de congé).

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Jeu de fériés | **11 fériés métropole** : Jour de l'an (1/1), Lundi de Pâques, Fête du travail (1/5), Victoire 1945 (8/5), Ascension, Lundi de Pentecôte, Fête nationale (14/7), Assomption (15/8), Toussaint (1/11), Armistice (11/11), Noël (25/12). Pas d'Alsace-Moselle. |
| Comportement | **Comme les WK** : grisés ET exclus des décomptes, via extension de `isBusinessDay`. |
| Source | 100 % **calculé** (Pâques via l'algorithme de Meeus), zéro config/table. |
| Effet accepté | Un segment de charge chevauchant un férié voit son « jours disponibles » baisser → peut passer **rouge** si l'effectif dépasse. Cohérent, assumé. |
| Périmètre | 3 widgets ; module pur dupliqué identique ; 5 `isBusinessDay` modifiés. |

## 3. Architecture

### 3.1 Module pur `frenchHolidays.js` (copie byte-identique dans chaque widget)
`assets/js/utils/frenchHolidays.js` — self-contained (aucun import), testable `node --test` :
- `computeEaster(year) -> Date` : dimanche de Pâques (Meeus/Butcher grégorien).
- Cache interne `Map<year, Set<"YYYY-MM-DD">>` : fériés fixes + `Pâques+1` (lundi de Pâques), `Pâques+39` (Ascension), `Pâques+50` (lundi de Pentecôte).
- `isFrenchHoliday(date) -> boolean` : `holidaySet(date.getFullYear()).has(dateKey(date))`. `false` si date invalide.

Clés locales `YYYY-MM-DD` (via `getFullYear/getMonth/getDate`) pour matcher la logique locale des `isBusinessDay` existants (qui utilisent `getDay()` local).

### 3.2 Branchement dans les 5 `isBusinessDay`
Chaque définition passe de :
```js
const day = date.getDay();
return day !== 0 && day !== 6;
```
à :
```js
const day = date.getDay();
return day !== 0 && day !== 6 && !isFrenchHoliday(date);
```
avec `import { isFrenchHoliday } from "./frenchHolidays.js";` en tête du fichier.

Emplacements (confirmés) :
- `Time-Out/assets/js/utils/textSegments.js:43`
- `planning-synchro/assets/js/utils/timeSegments.js:54`
- `planning-synchro/assets/js/utils/leaveAbsences.js:39` (privée)
- `gestion-depenses2/assets/js/utils/timeSegments.js:83`
- `gestion-depenses2/assets/js/utils/leaveAbsences.js:39` (privée)

`leaveAbsences.js` (ps/gd2) reste **byte-identique** entre les deux : les deux reçoivent le même import + la même ligne, et importent le même `./frenchHolidays.js` (présent dans chaque `utils/`).

## 4. Propagation automatique

Comme `isBusinessDay` est la brique bas-niveau partagée, la modification propage sans autre changement :
- **Grisage** : chaque `renderTrackGrid` grise déjà les jours où `!isBusinessDay(date)` (Time-Out board, planning-synchro chargeBoard, gestion-depenses2 chargeTimeline) → les fériés y sont grisés comme les WK. La frise de Time-Out (bande jours, classe `is-weekend`) marque aussi les fériés.
- **Exclusion des décomptes** : `getBusinessHalfDaySlotsBetween` / `getSegmentAllocationDays` (charge) et l'énumération demi-journée de Time-Out excluent les fériés → jours disponibles/ouvrés réduits ; `availableDaysAfterLeave` (leave-aware) en tient compte via `leaveAbsences.isBusinessDay`.

## 5. Cas limites

- Année non mise en cache → calculée à la volée puis mémorisée (`Map`).
- Date invalide → `isFrenchHoliday` renvoie `false` (pas de crash).
- Férié tombant un week-end (ex. 1/5 un samedi) → déjà non-ouvré via le test WK ; pas de double effet.
- Fériés mobiles : validés sur des années connues (2026 Pâques = 5 avril → lundi 6/4, Ascension 14/5, Pentecôte 25/5 ; 2027 Pâques = 28 mars).
- Aucune écriture Grist ; aucun changement de données ; purement calcul + affichage.

## 6. Tests

- `frenchHolidays.js` (`node --test`, dans chaque widget ou au moins un) :
  - `computeEaster(2026)` = 5 avril 2026 ; `computeEaster(2027)` = 28 mars 2027.
  - `isFrenchHoliday` vrai pour 2026-01-01, 2026-04-06, 2026-05-01, 2026-05-08, 2026-05-14, 2026-05-25, 2026-07-14, 2026-08-15, 2026-11-01, 2026-11-11, 2026-12-25 ; faux pour un jour ouvré normal (2026-07-15) et une date invalide.
- Non-régression : suites `node --test` existantes (Time-Out, planning-synchro, gestion-depenses2) restent vertes. Vérifier notamment que l'exemple de référence charge (29 juin→10 juillet) n'est pas cassé — le 14 juillet est hors de cette plage, donc inchangé.
- Grisage visuel : vérification manuelle Grist.

## 7. Hors périmètre

Pas d'Alsace-Moselle ; pas de ponts ; pas de fériés configurables ; pas de gestion de congés spécifiques aux fériés (ex. journée de solidarité). Widgets exclus du projet initial (Synchro, gestion-depenses, gestion-depenses3, synchronisation-plannings) non touchés.

## 8. Plan (aperçu)

- Tâche 1 : `frenchHolidays.js` + tests, créé dans les 3 widgets (identique).
- Tâche 2 : brancher les 5 `isBusinessDay` (import + `&& !isFrenchHoliday(date)`).
- Tâche 3 : lancer toutes les suites + vérification manuelle Grist (grisage des fériés).
