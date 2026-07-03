# Design — `planning-synchro` : frise partagée Planning Projet + Plan de charge

Date : 2026-07-02
Statut : approuvé (décisions de conception validées), en attente de relecture du spec avant plan d'implémentation.

## 1. Contexte

Deux widgets Grist existent et font autorité :

- **Planning Projet** (`Planning Projet/`) — frise chronologique en lecture, rendue avec **vis-timeline**. Modèle de « phases » par tâche (coffrage, armature, NDC, coupes, démolition, générique, démarrage). Parseur de dates robuste `parseCalendarDate` (ISO + `JJ/MM/AAAA` + epoch). Fichier de rendu `assets/js/ui/timeline.js` (~5 970 lignes, très couplé au mode standalone : MS Project, références, édition de durée…).
- **gestion-depenses2** (`gestion-depenses2/`) — plan de charge prévisionnel **éditable** (table `TimeSegment`), rendu par une **grille DOM custom demi-journée** (`assets/js/ui/chargeTimeline.js`). Lignes groupées par rôle. Bouton **Editer**. Écritures via `grist.docApi.applyUserActions` (epoch secondes), colonnes résolues par alias (`Start_At`/`Start_Date`).

Un widget de fusion **existe déjà** : `Synchro/` (dernier commit « Synchro XML ») et son prédécesseur `synchronisation-plannings/`. Il embarque les deux widgets en **iframes** et synchronise une frise commune. Il implémente déjà : sélecteur partagé, frise commune (iframe `Planning Projet?headerOnly=1`), planning haut lecture seule, plan de charge bas éditable, fenêtre initiale ~1 an, **case « Rassembler visuellement le planning »**, poignée de redimensionnement.

### Pourquoi un nouveau widget malgré l'existant

`Synchro` souffre de trois classes de bugs confirmées : **désynchronisation de la frise** (dérive au zoom/déplacement), **lenteur / à-coups**, **chargement / projet instable**. Cause racine : deux moteurs de rendu différents (vis-timeline vs grille custom) reliés **à travers des iframes**, avec un alignement **par mesure DOM + nudge pixel + retries temporisés** (`Synchro/assets/js/viewport/alignment.js`, `alignExpensesViewportToPlanning` `maxAttempts=4` + sleeps). L'édition/écriture, elle, fonctionne bien.

## 2. Objectif

Créer **`planning-synchro/`**, un widget Grist **mono-page (sans iframe)** qui affiche les deux plannings empilés sur **une seule frise chronologique partagée**, en réutilisant au maximum le code existant et en supprimant la fragilité de synchronisation d'iframes.

## 3. Décisions validées

| Sujet | Décision |
|---|---|
| Architecture | **C** — deux moteurs dans une seule fenêtre : vis-timeline (haut, lecture seule) + grille custom (bas, éditable). |
| Montage | **C2** — **modules, sans iframe**. Extraire le rendu+édition du charge board et un rendu vis-timeline lecture seule (modèle de phases porté) dans `planning-synchro`. Aucun iframe. |
| Nom du dossier | `planning-synchro` |
| Fenêtre initiale « +1 an » | Fenêtre visible **large d'~1 an (365 j)**, **ancrée à gauche** sur la 1ʳᵉ date de Planning Projet (pas un décalage). |
| Bornes de la frise | **Uniquement TimeSegment** : `min(Start_At)` → `max(End_At)`. Planning Projet ne les élargit jamais. |
| Accès Grist | `grist.ready({ requiredAccess: "full" })` (lecture Planning, écriture TimeSegment) — comme les deux widgets. |
| Linking projet | Clés `localStorage` partagées `grist.selected-project` / `grist.selected-project-id` + table pivot **`Projets2`** (contient `Nom_de_projet` **et** `Numero_de_projet`). **`Nom XML` non utilisé** pour le lien nom↔numéro. |

## 4. Modèle de données (tables & colonnes)

- **`Projets2`** : `id`, `Nom_de_projet`, `Numero_de_projet`. Registre canonique + pont nom↔numéro.
- **`Planning_Projet`** (filtré par `NomProjet == nom`) : `NomProjet`, `Taches`/`Tache`, `Type_doc`, `Ligne_planning`, `Zone`, `Groupe`, `Date_limite`, `Duree_1`, `Diff_coffrage`, `Duree_2`, `Diff_armature`, `Duree_3`, `Demarrages_travaux`, `Indice`, `Realise`, `Retards`, `Nom_XML`. Lignes sans tâche (zone-only) = **exclues** de l'affichage.
- **`TimeSegment`** (filtré par `NumeroProjet == numéro`) : `Name` (personne), `Start_At`/`Start_Date`, `End_At`/`End_Date`, `Allocation_Days` (virgule → point), `Effectif`, `Label`, `NumeroProjet`. Datetimes en **epoch secondes** à l'écriture ; parseur lecture tolérant `JJ/MM/AAAA HH:mm`, ISO, epoch.
- **`ProjectTeam`** (filtré par `NumeroProjet`) : `Role`, `Name`, `Daily_Rate` — groupement rôles (Projeteurs / Ingénieurs / Autres).

## 5. Structure des modules

```
planning-synchro/
  index.html                       grist-plugin-api + vis-timeline (CDN) + une seule page
  assets/css/variables.css         tokens repris de Planning Projet + gestion-depenses2
  assets/css/styles.css            layout page + panes + toolbar + alignement colonnes gauche
  assets/js/
    main.js                        bootstrap : grist.ready(full), load Projets2, wire sélecteur, storage sync
    config.js                      tables/colonnes + zoomModes (week/month/year)
    state.js                       viewport partagé + projet sélectionné (persist localStorage)
    services/gristService.js       fetchTable + TimeSegment CRUD (porté de gestion-depenses2)
    services/projectRegistry.js    Projets2 → {id,name,number}; résolution nom↔numéro; clés partagées
    viewport/normalize.js          helpers ISO/exact-number/clamp/day-span (repris de Synchro, purs)
    viewport/bounds.js             bornes visibleDays + dérive mode ↔ visibleDays (adapté : bornes = TimeSegment)
    viewport/build.js              buildCanonicalSharedViewport, buildInitialProjectViewport (repris Synchro)
    sync/controller.js             cœur : 1 viewport → applique aux 2 panes en 1 rAF, alignement arithmétique
    top/phases.js                  ligne Planning → phases [{start,end,type,label,tooltip,aggregateTasks}] (porté timeline.js)
    top/planningRenderer.js        instance vis-timeline lecture seule ; groups (tâche|type doc) ; agrégation ; tooltip
    bottom/chargeBoard.js          rendu grille charge (porté chargeTimeline.js) : rôles + segments + Editer
    bottom/chargeEditing.js        drag-create / resize / menu contextuel / save TimeSegment (porté main.js gestion-depenses2)
    utils/dates.js                 parseCalendarDate (Planning) + parseRawDateTime (TimeSegment)
    utils/format.js                toFiniteNumber, formatNumber, buildDisplayedMonths (repris)
    utils/timeSegments.js          slots demi-journée, getSegmentEffectiveDays… (repris)
```

## 6. Contrôleur de synchronisation (cœur — corrige dérive + à-coups)

Un **viewport canonique** unique `{mode, firstVisibleDate, visibleDays, windowStartMs, windowEndMs}` (modèle repris de `Synchro/viewport/build.js`, pur).

Toute interaction (toolbar semaine/mois/année, prev/next/aujourd'hui, molette-zoom, drag-pan sur l'un des panes) produit un nouveau viewport canonique ; le contrôleur l'applique aux **deux** moteurs **de façon synchrone dans un seul `requestAnimationFrame`** :

- **Haut (vis-timeline)** : `timeline.setWindow(start, end, { animation: false })`.
- **Bas (grille)** : fixe `visibleDays` + `firstVisibleDate` de la grille pour que **largeur_jour = largeurContenu / visibleDays** soit calculée à partir des **mêmes nombres**.

Comme les deux panes vivent dans le **même document**, à la **même largeur de contenu**, en leur passant **le même nombre de jours sur la même largeur**, l'alignement est **arithmétique** → pixel-perfect **par construction**. On **supprime** la boucle mesure-DOM + `nudgeViewportByPixels` + retries. On conserve **un** garde-fou optionnel post-layout (assert de tolérance ≤ 1 px, sans boucle) pour détecter une régression.

Émission/abonnement : pas de `postMessage`. Le contrôleur appelle directement les fonctions des modules `top`/`bottom`. Les évènements d'interaction des panes remontent via callbacks JS directs.

## 7. Pane HAUT — Planning Projet, LECTURE SEULE

- **vis-timeline** `editable:false`, `selectable:false`, `zoomable:false`/pan désactivés au profit du contrôleur partagé (le zoom/pan est piloté par la toolbar commune et propagé).
- **Groups** :
  - Case décrochée (défaut) : 1 ligne par ligne de planning/tâche (comportement Planning Projet actuel).
  - Case cochée : 1 ligne par **Type doc**.
- **Items = phases** (`top/phases.js`, porté verbatim de `timeline.js`) :
  - coffrage : `Date_limite → Diff_coffrage`
  - armature : `Diff_coffrage → Diff_armature`
  - NDC / coupes / démolition / générique : `Date_limite → Diff_coffrage`
  - démarrage : point `Demarrages_travaux`
  - couleurs (`phase-*`) et tooltips repris tels quels.
- **Colonne gauche = uniquement `Taches`**, alignée à gauche (aucune autre colonne de données).
- **« Rassembler visuellement le planning »** (case cochée) : agrégation par Type doc — les phases de même type qui se chevauchent/s'accumulent sont **fusionnées en un seul segment** couvrant leur emprise combinée ; **tooltip = liste des tâches composant le segment** (`aggregateTasks`, logique reprise).
- Lignes sans tâche (zone-only) exclues.

## 8. Pane BAS — plan de charge gestion-depenses2, ÉDITABLE

- Réutilise le rendu grille `renderChargePlanTimeline` (`bottom/chargeBoard.js`) : lignes de rôle (`groupWorkersByRole` → Projeteurs / Ingénieurs / Autres) puis lignes personnes ; barres de segments positionnées sur la grille demi-journée partagée.
- **Bouton « Editer »** identique (`renderTimelineEditToolbar`, bascule Editer/Verrouiller) ; création par drag, redimensionnement par poignées, clic droit → Modifier / Supprimer.
- Écritures **TimeSegment** via `createTimeSegment` / `updateTimeSegment` / `removeTimeSegment` (epoch secondes ; alias colonnes ; décimales normalisées).
- **En-tête réduit aux rôles/sections uniquement** : on retire le chrome standalone (Nom / Total jours / « Vue » / date-picker « Aujourd'hui ») ; la **toolbar commune** pilote la vue. On garde l'en-tête de regroupement par rôle.
- Colonne gauche (noms) **alignée à gauche**, même largeur que la colonne `Taches` du haut → alignement visuel cohérent.

## 9. Bornes, position initiale, état vide

- **Bornes = TimeSegment uniquement** : `min(Start_At)` → `max(End_At)` des segments du projet. Le contenu Planning Projet est **clippé** dans ces bornes (le dépassement est hors champ). Planning **n'élargit jamais** les bornes.
- **Position initiale** : fenêtre **~1 an (365 j)** (clampée aux bornes), **ancrée à gauche** sur la **1ʳᵉ date de phase** de Planning Projet (équivalent `getFirstRowFirstSegment`), clampée dans les bornes. Si aucune phase Planning → fallback début des bornes TimeSegment.
- **Projet sans TimeSegment** : état vide propre du pane bas (« Aucun prévisionnel pour ce projet ») ; le haut reste consultable sur une fenêtre mois par défaut ; **pas de plantage**.

## 10. Robustesse

- Dates multi-format via `parseCalendarDate` (Planning) et `parseRawDateTime` (TimeSegment) — repris.
- Décimales virgule (`"8,5"`) normalisées en point (`toFiniteNumber`).
- Lignes Planning sans tâche filtrées.
- Absence de TimeSegment / ProjectTeam gérée (fetch optionnel, tableaux vides).
- Toutes les valeurs Grist passées par `toText` (gère `{details|label|name|value}`).

## 11. Carte de réutilisation

| Cible | Source réutilisée |
|---|---|
| Modèle viewport (normalize/bounds/build) | `Synchro/assets/js/viewport/*` (purs) — bounds recâblé sur TimeSegment |
| CRUD TimeSegment + fetch | `gestion-depenses2/assets/js/services/gristService.js` |
| Grille charge + rôles + Editer | `gestion-depenses2/assets/js/ui/chargeTimeline.js` |
| Édition segments (drag/resize/menu/save) | `gestion-depenses2/assets/js/main.js` (handlers charge board extraits) |
| Utils demi-journée / format | `gestion-depenses2/assets/js/utils/{timeSegments,format}.js` |
| Modèle de phases + tooltips + agrégation | `Planning Projet/assets/js/ui/timeline.js` (extrait, sans baggage standalone) |
| Parseur dates Planning | `Planning Projet/assets/js/services/planningService.js` (`parseCalendarDate`) |
| Pattern sélecteur + clés partagées | `Planning Projet/assets/js/ui/selectors.js` + `state.js` |
| Registre projet (Projets2) | `gestion-depenses2` config + `resolveProjectSelection` de Planning Projet |

## 12. Risques & mitigations

- **Risque résiduel d'alignement inter-moteurs** (assumé avec l'approche C). Mitigation : alignement **arithmétique** (mêmes nombres, même largeur, même document) au lieu de mesure/nudge ; garde-fou 1-assert.
- **Extraction de l'édition charge board** depuis un `main.js` de 5 795 lignes : périmètre borné aux handlers du charge board ; à porter proprement en module.
- **Portage du modèle de phases** depuis un `timeline.js` de 5 970 lignes : n'extraire que la construction phases + agrégation + tooltip (pas MS Project / références / édition durée).
- **vis-timeline piloté par un contrôleur externe** : désactiver ses interactions natives pour éviter les conflits d'état de fenêtre.

## 13. Critères d'acceptation (repris de la consigne)

1. Sélecteur projet en haut, lié aux autres widgets, filtre les deux tableaux.
2. Une seule frise ; déplacement/zoom synchronisent parfaitement les deux tableaux.
3. Bornes min/max issues **uniquement** de TimeSegment ; Planning ne les élargit jamais.
4. À l'ouverture d'un projet, frise ancrée sur la 1ʳᵉ date de Planning Projet, fenêtre initiale ~1 an.
5. Tableau du haut non éditable, colonne `Taches` uniquement, alignée à gauche.
6. Case « Rassembler visuellement le planning » : cochée → 1 ligne par Type doc, segments de même type fusionnés, survol = tâches composant le segment.
7. Tableau du bas éditable, bouton « Editer » identique, écriture correcte dans TimeSegment.
8. En-tête du bas réduit à l'en-tête des rôles/sections uniquement.
9. Colonnes de gauche (tâches / personnes) alignées à gauche et cohérentes entre les deux tableaux.
10. Formats dates/décimales gérés sans erreur ; projet sans données = état vide propre.

## 14. Séquence de construction (incréments testables)

1. **Squelette** : dossier, `index.html`, `grist.ready(full)`, chargement `Projets2`, sélecteur + linking clés partagées (parité avec les autres widgets).
2. **Chargement projet** : résolution nom↔numéro ; fetch Planning/TimeSegment/ProjectTeam ; état vide propre.
3. **Frise partagée + bornes** : viewport canonique ; bornes TimeSegment ; contrôleur + alignement arithmétique (2 panes vides alignés).
4. **Pane haut** : vis-timeline lecture seule + phases + colonne Taches only ; puis case « Rassembler » (agrégation + tooltip).
5. **Pane bas** : grille charge + rôles + segments ; puis édition (Editer + drag/resize/menu + écritures TimeSegment).
6. **Position initiale** : fenêtre ~1 an ancrée sur 1ʳᵉ date Planning, clampée bornes.
7. **Synchro fine + cohérence visuelle** : alignement colonnes gauche, tokens, garde-fou 1-assert ; tests navigateur (déplacement synchronisé, case à cocher, édition/écriture, position initiale).
