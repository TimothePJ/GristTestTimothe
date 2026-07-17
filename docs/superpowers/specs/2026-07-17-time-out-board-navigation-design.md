# Spec — Time-Out : affichage global par service, ligne « moi » épinglée, zooms calendaires

Date : 2026-07-17
Statut : design validé, en attente de relecture avant plan.

## 1. Objectif — 3 volets

- **A. Tout le monde visible, son service en premier.** On retire le filtre par service (chacun ne voyait que le sien) : tout le monde voit tout le monde. Groupé par service (rôles mélangés, alphabétique par nom, sans doublons — déjà le cas), mais le **service de l'utilisateur courant est affiché en premier**, les autres services alphabétiquement en dessous.
- **B. Ligne « moi » épinglée.** Une **copie** de la ligne de l'utilisateur courant est collée sous la frise chronologique, en `position: sticky`, toujours visible au scroll. C'est un vrai double de sa ligne (mêmes segments) : l'éditer écrit la même donnée Grist → sa ligne épinglée ET sa ligne dans son groupe service se mettent à jour ensemble. Sa ligne reste aussi présente dans son groupe.
- **C. Zooms alignés sur le calendrier.** Semaine = lundi→dimanche ; Mois = 1er→dernier jour ; Trimestre = trimestre civil (Jan-Mar / Avr-Juin / Juil-Sep / Oct-Déc), uniquement les 3 mois. Navigation ‹/› par période ; « Aujourd'hui » = période du jour ; changement de zoom = période contenant le début de la vue actuelle.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Filtre service | **Supprimé** : tout le monde voit tout le monde. Le helper `filterMembersByService` (+ son test) est retiré. |
| Ordre des services | Service de l'utilisateur courant **en premier**, puis les autres par ordre alphabétique. |
| Ligne épinglée | Copie sticky de la ligne courante, sous la frise ; éditable ; synchronisée via re-fetch/re-render (les deux copies portent les mêmes segments). |
| Modes de zoom | `week` (lun→dim), `month` (1er→dernier), `quarter` (trimestre civil). Ancrage zoom = période contenant `firstVisibleDate`. « Aujourd'hui » = période du jour. |
| Mode initial | `quarter` (trimestre contenant aujourd'hui) — préserve l'ampleur actuelle (~90 j). Ajustable. |
| Périmètre | Widget Time-Out uniquement. Widgets de charge inchangés. Aucune écriture Grist nouvelle. |

## 3. Volet A — ordre par service (courant en premier)

- `main.js render()` : passer **tous** les membres (`state.teamMembers`) à `board.render(...)` (retirer l'appel à `filterMembersByService`).
- `board.js` : `groupMembersByService` reste (alphabétique, rôles mélangés). Dans `render()`, après groupement, **réordonner** les entrées : mettre en tête le groupe dont le label normalisé == `normalize(currentUser.service)`, puis les autres dans l'ordre alphabétique existant. Normalisation via `normalizeName` (importé de `./utils/teamPeople.js`) ou un helper local équivalent (NFD/accents/casse). Si le service courant est vide ou introuvable → aucun réordonnancement (ordre alphabétique normal).
- Doublons : déjà gérés par la déduplication (`dedupeTeamMembers`). Rien à ajouter.

## 4. Volet B — ligne « moi » épinglée

- `board.js render()` : après `renderTimelineHeader(...)` (la frise), si `currentUser.personKey` est renseigné, retrouver le worker construit (`buildMembersFromLeaves`) dont `personKey === currentUser.personKey`, et rendre une **copie** via `renderWorkerRow(...)` enveloppée dans un conteneur classé `charge-plan-pinned-row` (juste après la frise, avant les groupes).
- La piste de la copie porte les mêmes `data-person-key`/`data-owner-email` → éditable par l'utilisateur courant (`canEditTrack` inchangé). L'aperçu de drag, l'overlap (par piste) et les barres fonctionnent : la copie et la ligne du groupe portent les **mêmes** segments (issus du même worker), donc l'overlap voit toutes les barres sur chaque piste.
- **Sync** : toute écriture (create/edit/delete) passe par Grist → `onChanged` re-fetch + re-render → la copie épinglée et la ligne du groupe sont reconstruites avec les mêmes segments. Cohérence garantie.
- CSS (`styles.css`) :
  - `.charge-plan-pinned-row { position: sticky; top: 48px; z-index: 18; }` (48px = hauteur de la frise `.charge-plan-axis-row`).
  - Distinction visuelle : fond légèrement teinté + bordure basse (ex. `background: var(--color-primary-soft, rgba(0,73,144,0.08)); box-shadow: inset 0 -2px 0 rgba(0,73,144,0.18);`).
  - La cellule nom reste `sticky left` (héritée de `.charge-plan-cell--name`). Ajouter un préfixe « Moi — » dans la cellule nom de la copie (ou un badge) pour la distinguer.
- Le scroll interne (`.charge-plan-scroll`, `overflow-y:auto`) contient frise (top:0) + ligne épinglée (top:48) + contenu : les deux restent collées en haut pendant le scroll vertical.

## 5. Volet C — zooms calendaires

Le viewport gagne un champ `mode` ∈ `"week" | "month" | "quarter"`. Toute la logique dans `main.js` ; le board consomme toujours `{ firstVisibleDate, visibleDays, rangeStartDate, rangeEndDate }` (inchangé).

Helpers purs (testables) :
- `startOfWeek(date)` : lundi de la semaine — `offset = (getDay() + 6) % 7`, `monday = date - offset j`.
- `computeViewport(mode, anchorDate) -> { mode, firstVisibleDate, rangeStartDate, rangeEndDate, visibleDays }` :
  - `week` : `first = startOfWeek(anchor)`, `end = first + 6 j`, `visibleDays = 7`.
  - `month` : `first = new Date(y, m, 1)`, `end = new Date(y, m+1, 0)`, `visibleDays = end.getDate()`.
  - `quarter` : `q = floor(m/3)`, `first = new Date(y, q*3, 1)`, `end = new Date(y, q*3+3, 0)`, `visibleDays = round((end-first)/86400000)+1`.
  - `firstVisibleDate = rangeStartDate = iso(first)`, `rangeEndDate = iso(end)`.

Handlers (`main.js`) :
- **Zoom** (boutons `data-to-zoom="week|month|quarter"`) : `anchor = parseCalendarDate(vp.firstVisibleDate)`; `state.viewport = computeViewport(mode, anchor)`; render + persist.
- **‹ / ›** : décaler l'ancre d'**une période** selon `vp.mode` puis `computeViewport` :
  - `week` : `anchor = firstVisibleDate ∓ 7 j`.
  - `month` : `anchor = new Date(y, m ∓ 1, 1)`.
  - `quarter` : `anchor = new Date(y, firstMonthDuTrimestre ∓ 3, 1)`.
- **Aujourd'hui** : `computeViewport(vp.mode, today)`.
- `updateZoomButtons(mode)` : surligner le bouton dont `data-to-zoom === vp.mode`.
- `buildInitialViewport()` : `computeViewport("quarter", today)` (ou lecture du viewport persisté s'il contient `mode`).
- `index.html` : boutons zoom `data-to-zoom="week"` (Semaine), `"month"` (Mois), `"quarter"` (Trimestre).

## 6. Fichiers touchés

- `Time-Out/assets/js/utils/viewportModes.js` (nouveau, pur, testé) : `startOfWeek`, `computeViewport`, `shiftAnchor(mode, firstVisibleDate, direction)`.
- `Time-Out/assets/js/main.js` : retrait du filtre service ; `buildInitialViewport`/handlers zoom/prev/next/today via `viewportModes` ; passe tous les membres au board.
- `Time-Out/assets/js/ui/board.js` : réordonnancement service courant en premier ; rendu de la ligne épinglée après la frise.
- `Time-Out/assets/css/styles.css` : `.charge-plan-pinned-row`.
- `Time-Out/index.html` : `data-to-zoom` = modes.
- `Time-Out/assets/js/utils/teamPeople.js` + `tests/teamPeople.test.mjs` : retrait de `filterMembersByService` (+ son test).

## 7. Cas limites

- Utilisateur non reconnu (`personKey` vide) : board masqué (comportement existant conservé) → pas de ligne épinglée.
- Service courant vide/introuvable : pas de réordonnancement (alphabétique) ; la ligne épinglée reste (elle dépend de `personKey`, pas du service).
- Utilisateur courant présent dans le groupe « Sans service » : son groupe passe premier si `normalize("")` matche le label normalisé du groupe « Sans service » — à défaut on compare le service brut ; on accepte que « Sans service » remonte en tête si l'utilisateur n'a pas de service.
- Mois : `visibleDays` varie (28/29/30/31) ; février bissextile géré par `new Date(y, m+1, 0).getDate()`.
- Trimestre : `visibleDays` = 90/91/92 selon l'année/le trimestre.
- Ligne épinglée + ligne du groupe : mêmes `data-segment-id` → l'édition par id et l'overlap par piste restent corrects (chaque piste a toutes les barres de la personne).
- Sticky : la ligne épinglée à `top:48px` reste sous la frise (`top:0`, z-index 20 > 18) sans chevauchement.

## 8. Tests

- `viewportModes.js` (`node --test`) :
  - `startOfWeek` : un mercredi → le lundi ; un dimanche → le lundi précédent.
  - `computeViewport("week", 2026-07-17)` (vendredi) → first=2026-07-13 (lundi), end=2026-07-19 (dimanche), visibleDays=7.
  - `computeViewport("month", 2026-07-17)` → 2026-07-01 → 2026-07-31, visibleDays=31 ; février 2028 (bissextile) → 29.
  - `computeViewport("quarter", 2026-07-17)` → 2026-07-01 → 2026-09-30, visibleDays=92.
  - `shiftAnchor` : semaine ±7 j ; mois ±1 mois (1er) ; trimestre ±3 mois (1er du trimestre).
- Non-régression : suite Time-Out reste verte (les tests board `buildMembersFromLeaves`/`groupMembersByService` inchangés ; suppression du test `filterMembersByService`).
- DOM (ligne épinglée sticky, ordre des services, boutons zoom) : vérification manuelle Grist.

## 9. Hors périmètre

Widgets de charge inchangés. Pas de vraie sécurité serveur (l'ACL reste Read-all ; l'affichage global est UX). Pas de sélecteur de service. Pas de sauvegarde du mode par utilisateur au-delà du `localStorage` viewport existant.

## 10. Plan (aperçu)

- Tâche 1 : `viewportModes.js` + tests.
- Tâche 2 : `main.js` (retrait filtre, viewport modes, handlers) + `index.html` (data-to-zoom) + retrait `filterMembersByService`.
- Tâche 3 : `board.js` (ordre service courant en premier + ligne épinglée) + `styles.css`.
- Tâche 4 : vérif suites + vérification manuelle Grist.
