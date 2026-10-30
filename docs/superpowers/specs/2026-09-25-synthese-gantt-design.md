# Spec — Diagramme de Gantt du tableau de tâches Synthese (Planning Projet)

Date : 2026-09-25
Statut : design validé en conversation, en attente de relecture avant plan d'implémentation.
Prolonge : `docs/superpowers/specs/2026-09-23-synthese-taches-design.md` (tableau de tâches,
modèle de lignes, panneau droit réservé au Gantt).

## 1. Objectif

Remplir le panneau droit du tableau de tâches de la vue Synthese avec un **diagramme de
Gantt façon MS Project**, aligné ligne par ligne sur le tableau :

1. **Zone** : barre noire du Début à la Fin de la zone, extrémités en pointe, nom à gauche.
2. **Tâche de 0 jour (jalon)** : losange (carré tourné), nom à gauche en gras, date « jj/mm »
   à droite.
3. **Tâche de 1 jour et plus** : segment couvrant ses jours, nom à droite en gras. Une tâche
   d'1 jour garde ses dates (Début = Fin) et s'affiche comme un segment d'une journée.
4. **Échelle des dates** sur deux niveaux dans l'en-tête du panneau droit, qui suit les
   boutons Semaine / Mois / Année du bandeau.

Référence visuelle : capture MS Project fournie par l'utilisateur (« Zone Z3A », « Jalon
démarrage GO 02/02 », « FOND DE PLAN NIV PH RDB ind 0 10/08 », segments « Plans avant synthèse
des CET », « Visa MOE »…).

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Moteur | **Dessin maison en SVG** (pas vis-timeline, pas de bibliothèque). |
| Alignement | Une couche SVG unique sur la colonne droite, dans le même conteneur défilant que le tableau ; ligne n°i à i × 26 px (modèle de lignes, hauteur fixe). |
| Période affichée | Celle du planning (fenêtre de la timeline Structure, masquée mais active) : lue par `getPlanningWindow`, suivie par `subscribePlanningWindowChanges`, modifiée par `setPlanningWindow(start, end, { byUser: true })`. Les boutons Semaine / Mois / Année et la plage de dates du bandeau restent la référence. |
| Flèches | **Hors périmètre** (viendront avec les étages). |
| Étages (« PH RDB ») | **Hors périmètre.** |
| Édition | Le Gantt est **en lecture seule** : pas de glisser de barre, pas d'info-bulle. Les dates se modifient dans le tableau. |
| Git | **Aucun commit, aucun push.** |

## 3. Règles de dessin

**Axe du temps** : une journée va de 0 h à 24 h (heure locale). Conversion linéaire
date → x sur la largeur du panneau droit pour la fenêtre [début ; fin] du planning.

| Ligne | Forme | Position horizontale | Étiquettes |
|---|---|---|---|
| Tâche ≥ 1 jour | segment (rectangle) | début du jour de Début → fin du jour de Fin (largeur ≥ 2 px) | nom en gras à droite du segment |
| Jalon (0 jour) | losange | centre du jour | nom en gras à gauche, date « jj/mm » à droite |
| Zone datée | barre noire + pointes aux deux extrémités | début : centre du jour si la zone commence par un jalon (aucun segment ne commence ce jour-là), sinon début du jour ; fin : centre du jour si la zone finit par un jalon (règle de fin MS Project du récapitulatif), sinon fin du jour | nom de la zone à gauche |
| Tâche ou zone sans dates | rien | — | — |

Zone repliée : sa barre reste ; ses tâches, absentes du modèle de lignes, ne sont pas
dessinées.

Géométrie verticale dans une ligne de 26 px : segment de 14 px centré ; losange de 12 px ;
barre de zone de 5 px dans la moitié haute, pointes de 6 px vers le bas.

**Couleurs** (reprises de la capture, indépendantes du thème Grist) : segment `#7cc7d8`
contour `#3b9bb0` ; losange `#2f8fa3` ; barre de zone `#1f1f1f` ; étiquettes `#1f1f1f` ;
jours non travaillés `#f1f1f1` ; aujourd'hui trait rouge `#d92d20`.

**Jours non travaillés** (week-ends et fériés français) : bandes grises sur toute la hauteur,
seulement quand une journée fait au moins 6 px.

**Aujourd'hui** : trait vertical sur toute la hauteur, s'il est dans la période.

**Échelle** (en-tête foncé du panneau droit, texte blanc), selon l'étendue de la période —
mêmes seuils que les boutons du bandeau (≈ 14,5 jours et ≈ 104,6 jours) :

| Étendue | Niveau haut | Niveau bas |
|---|---|---|
| < 14,5 jours (Semaine) | semaines : « sept. 2026 · S38 » (mois et année du lundi, semaine ISO) | jours : « lun 14 » |
| < 104,6 jours (Mois) | mois : « septembre 2026 » | jours « 14 » si une journée fait ≥ 18 px, sinon semaines « S38 » |
| au-delà (Année) | années : « 2026 » | mois : « sept. » |

Chaque graduation est coupée aux bords de la période ; un libellé trop long pour sa case
n'est pas affiché.

## 4. Interactions

- **Glisser** (bouton principal) dans le panneau droit, lignes ou échelle : déplace la
  période à la vitesse du curseur (la date saisie reste sous la souris).
- **Ctrl + molette** dans le panneau droit, ou **molette** sur l'échelle : zoom centré sur
  la date sous le curseur, facteur 1,25, étendue bornée entre 2 jours et 10 ans.
- **Molette seule** sur les lignes : défilement vertical normal du tableau.
- **Clic droit** sur une ligne dans le panneau droit : même menu que dans le tableau
  (déjà le cas : la couche SVG laisse passer les évènements).
- Les boutons Semaine / Mois / Année et tout changement de période redessinent le Gantt.

## 5. Architecture

### 5.1 `services/syntheseGanttGeometry.js` — calcul pur (sans DOM), testé sous Node

```js
createTimeScale({ start, end, width }) → { start, end, width, pxPerDay, dateToX(date|ms), xToDate(x) }
dayStart(date) / dayEnd(date) / dayCenter(date) → ms
buildGanttShapes(lines, scale, { rowHeight }) → Shape[]
  // Shape = { type: "zoneBar"|"taskBar"|"milestone", row, key, x1, x2, x, y, label, dateLabel }
buildScaleTiers(scale) → { mode: "week"|"month"|"year", top: Tick[], bottom: Tick[] }
  // Tick = { x1, x2, label }
buildNonWorkingBands(scale) → { x1, x2, holiday }[]   // [] si une journée < 6 px
todayX(scale, now) → number | null
```

### 5.2 `ui/syntheseGantt.js` — dessin SVG

```js
createSyntheseGantt({ headHost, layerHost, interactionHost, rowHeight }, {
  // interactionHost : conteneur défilant du tableau, qui reçoit le glisser et la molette
  getWindow,      // () → { start, end } | null   (null : semaine en cours)
  setWindow,      // (start, end) → void          (déplacement / zoom par l'utilisateur)
  subscribe,      // (listener) → unsubscribe     (changements de période)
  now = () => new Date(),
}) → { render(lines), resize() }
```

- Dessine l'échelle dans `headHost` et la couche SVG dans `layerHost`.
- Redessin groupé par `requestAnimationFrame` (lignes, période, taille).
- Glisser et zoom : écoute les pointeurs / la molette sur les zones du panneau droit et
  appelle `setWindow`.

### 5.3 Modifications

- `services/syntheseTaskModel.js` : `summarizeTasks` renvoie aussi `startsWithMilestone`
  et `endsWithMilestone` ; la ligne de zone du modèle de lignes les porte (`false` pour les
  tâches).
- `ui/syntheseTaskTable.js` : troisième argument optionnel `{ createGantt }`. Le tableau
  crée la couche du Gantt (enfant du conteneur défilant, hors du corps redessiné) et appelle
  `gantt.render(lines)` **dans sa propre fonction de dessin** (même report pendant une
  saisie → alignement garanti ; `[]` quand un message remplace les lignes), et
  `gantt.resize()` quand le séparateur bouge ou que la fenêtre change de taille.
- `main.js` : fournit `createGantt` au tableau avec les fonctions de période du planning
  (`getPlanningWindow`, `setPlanningWindow(…, { byUser: true })`,
  `subscribePlanningWindowChanges`), importées de `ui/timeline.js`.
- `assets/css/styles.css` : styles du Gantt (couleurs par classes, `color-scheme` clair
  hérité du tableau), conteneur défilant en `position: relative`, couche en
  `pointer-events: none`, curseur « main » sur le panneau droit.
- `index.html` : numéros de version des scripts et de la feuille de style relevés.

## 6. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Période du planning indisponible | Semaine en cours (lundi → dimanche). |
| Panneau droit de largeur nulle (masqué) | Rien n'est dessiné ; redessin au prochain `resize`/`render`. |
| Libellés débordant de la période | Coupés par le panneau (overflow caché). |
| Centaines de lignes | Un redessin complet par image au plus (`requestAnimationFrame`). |

## 7. Tests

`Planning Projet/tests/syntheseGanttGeometry.test.mjs` :
- conversion date → x et x → date ;
- segment d'1 jour = une journée de large ; segment de plusieurs jours ; largeur minimale ;
- losange au centre du jour, étiquettes nom / « jj/mm » ;
- barre de zone : début / fin normaux, début par un jalon, fin par un jalon ;
- lignes sans dates ignorées ;
- graduations des trois étendues (libellés, bornes coupées) ;
- jours non travaillés (week-end, férié, rien sous 6 px/jour) ;
- aujourd'hui dans / hors période.

Modèle : `startsWithMilestone` / `endsWithMilestone` (tests de `summarizeTasks` et du modèle
de lignes). Contrats de source : le tableau appelle `gantt.render` dans son dessin et
`gantt.resize` au séparateur ; `main.js` fournit les fonctions de période ; CSS de la couche.
Vérification visuelle : test manuel de l'utilisateur sur localhost.

## 8. Hors périmètre

Flèches, étages, glisser / redimensionner les barres, info-bulles, impression.
