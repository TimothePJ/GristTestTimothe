# Time-Out — Architecture du widget

> Widget Grist de planning des congés / absences (Congé Payé, Congé Non Payé, RTT, Congé Parental).
> Segments jour / demi-journée avec drag + pop-up de motif. Chacun voit tout, gère sa ligne ; les admins gèrent tout.
> Spec complète : [`docs/superpowers/specs/2026-07-10-time-out-design.md`](../docs/superpowers/specs/2026-07-10-time-out-design.md).

## Lancer les tests

Depuis le dossier `Time-Out/` (Node 22+, aucune dépendance npm ni bundler) :

```bash
node --test "tests/**/*.test.mjs"
```

Les tests couvrent la logique pure et testable (config, dates, maths demi-journée,
helpers du service Grist, board, editing, reason modal). La couche DOM / drag est
vérifiée manuellement dans Grist.

> ℹ️ Prérequis Grist : les tables `Time-Out` / `Team` et les Règles d'accès (Phase 0)
> doivent exister dans le document avant que le widget fonctionne dans Grist — voir la
> [spec](../docs/superpowers/specs/2026-07-10-time-out-design.md).

## Tables Grist requises (à créer avant l'implémentation)

**`Time-Out`** (nouvelle, toutes colonnes `Text`, aucune formule) : `Owner`, `Start_Date`, `Start_Period`, `End_Date`, `End_Period`, `Type`.
- 1 ligne = 1 segment. `AM/PM` encodés en texte ; `Owner` = email.

**`Team`** (existante) : ajouter `Admin` (Toggle, admins) et `Moi` (Toggle, coché partout ; marqueur d'identité censuré par ACL sauf sur sa ligne).

**Règles d'accès** : User Attribute `TeamRec` (Team, Email=user.Email) ; colonne `Team.Moi` Deny Read si `user.Email != rec.Email` ; table `Time-Out` Deny Create/Update/Delete si `user.TeamRec.Admin != True and user.Email != (new)rec.Owner`.

## Structure des fichiers (cible)

```
Time-Out/
  index.html                 markup + <script> CDN (grist-plugin-api) + conteneurs board/modals
  assets/css/styles.css      styles du board, barres colorées par type, grisage, pop-up
  assets/js/
    config.js                TABLES/COLUMNS (+ alias), TYPES (4) + couleurs, bornes AM/PM, snap 0.5j
    state.js                 viewport (plage visible, zoom), currentUser {email, isAdmin}, cache données
    main.js                  grist.ready({requiredAccess:'full'}), fetch initial, orchestration, re-rendu
    services/gristService.js lecture Team + Time-Out ; createSegment/updateSegment/removeSegment (applyUserActions, texte, résolution d'alias colonnes + table Time-Out/Time_Out)
    utils/timeSegments.js    modèle demi-journée (AM/PM), enumération de slots, conversion AM/PM<->heures, test d'overlap ; porté et allégé de planning-synchro
    ui/board.js              buildLines(Team, segments) groupées par Service ; slots demi-jour ; barres positionnées + colorées par Type ; 1 ligne par personne
    ui/editing.js            drag-création (pointerdown/move/up délégués), aperçu aimanté, overlap, ouverture du pop-up, grisage selon rôle
    ui/reasonModal.js        pop-up des 4 types après le drag (frère du board) ; renvoie le type choisi ou annulation
    ui/editModal.js          édition/suppression d'un segment (clic droit) ; frère du board
```

## Responsabilités (une unité = un rôle clair)

- **config.js** — source unique des noms de tables/colonnes, des 4 types + couleurs, et des constantes demi-journée. Aucun accès Grist.
- **gristService.js** — seule frontière avec Grist. Lit `Team`/`Time-Out`, écrit les segments (texte). Résout les alias de colonnes et l'ID de table (`Time-Out` vs `Time_Out`). Ne connaît pas le DOM.
- **timeSegments.js** — maths pures et testables (slots demi-journée, overlap, conversions AM/PM↔heures). Aucun accès Grist ni DOM.
- **board.js** — data → HTML. Construit une ligne par membre `Team` (groupées par `Service`), place les barres colorées. N'attache aucun listener.
- **editing.js** — toute l'interaction (drag, clic droit, grisage). Listeners délégués sur le conteneur (survivent au re-rendu). Appelle le pop-up puis `gristService`.
- **reasonModal.js / editModal.js** — modals autonomes, hors du conteneur re-rendu, contrat `open()/onSubmit -> {ok}|{ok:false,error}`.

## Flux de données

1. `main.js` : `grist.ready` → `gristService.fetchAll()` → `{ members, currentUser, segments }`.
   - `currentUser` = ligne `Team` où `Moi` est visible (non censuré) → `{ email, isAdmin }`.
   - `segments` rattachés aux membres via `Owner` (email) ↔ `Team.Email`.
2. `board.render(state)` → une ligne par membre ; ma ligne éditable, les autres grisées (admin : toutes éditables).
3. Drag sur ligne autorisée → aperçu (aimanté demi-jour, rouge si overlap) → relâchement → `reasonModal.open()`.
4. Choix du type → `gristService.createSegment({ owner, start, startPeriod, end, endPeriod, type })` → re-fetch → `board.render`.
5. Clic droit → `editModal` → update/remove → re-fetch → re-render.

## Réutilisé / retiré vs planning-synchro

- **Réutilisé** : slots demi-journée, aperçu de drag, overlap, wrapper écrire→refetch→rerender, modal frère, listeners délégués.
- **Retiré** : charge %, projets, coûts, `effectif`, ligne « Total », dimension projet, synchro localStorage. Resize de segment : optionnel (non requis v1).

## Hors périmètre v1

Commentaire, validation/statut, soldes, jours fériés, synchro inter-widgets.
