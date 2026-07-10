# Spec — Widget Grist « Time-Out » (planning des congés / absences)

Date : 2026-07-10
Statut : design validé, en attente de création des tables Grist par l'utilisateur avant implémentation.

## 1. Objectif

Un widget Grist où chaque collaborateur pose ses jours d'absence (Congé Payé, Congé Non Payé, RTT, Congé Parental) sur un planning à **segments jour / demi-journée avec drag** (même modèle d'interaction que `gestion-depenses2` et `planning-synchro`). À la création d'un segment par drag, un **pop-up** demande le type d'absence. Chaque personne **voit toutes** les absences de l'équipe mais ne **gère que sa ligne** ; les **propriétaires** (admins) gèrent n'importe quelle ligne.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Types d'absence | Exactement 4 : `Congé Payé`, `Congé Non Payé`, `RTT`, `Congé Parental`. Aucun commentaire, statut ou attribut supplémentaire. |
| Stockage table `Time-Out` | **100 % colonnes `Text`** (portabilité migration). **Aucune formule** dans les colonnes. |
| Granularité | Demi-journée (matin/après-midi). Week-ends exclus. Jours fériés **non gérés**. |
| Approche widget | Build léger dédié, réutilisant `chargeBoard.js` + `timeSegments.js` de `planning-synchro`, allégés. |
| Sécurité | Règles d'accès Grist (côté serveur). Le grisage dans le widget n'est que du confort. |
| Admins | `Team.Admin` (case cochée) → peuvent gérer toutes les lignes. |
| Utilisateurs | Lus depuis la table existante `Team`. |
| Identité de l'utilisateur connecté | Table `Team` = table témoin via **censure de colonne** (`Team.Moi` visible seulement sur sa propre ligne). Pas de 2ᵉ table, pas de formule. |
| Périmètre | Board global (pas de dimension projet). |

## 3. Modèle de données

### 3.1 Table `Time-Out` (nouvelle) — 1 ligne = 1 segment, tout en `Text`

| Colonne | Type | Contenu | Écrite par le widget |
|---|---|---|---|
| `Owner` | Text | email du propriétaire de la ligne (clé ACL) | oui |
| `Start_Date` | Text | jour de début, format `YYYY-MM-DD` | oui |
| `Start_Period` | Text | `AM` ou `PM` (demi-journée de début) | oui |
| `End_Date` | Text | jour de fin, format `YYYY-MM-DD` | oui |
| `End_Period` | Text | `AM` ou `PM` (dernière demi-journée incluse) | oui |
| `Type` | Text | un des 4 libellés | oui |

Conventions de bornes (reprises du modèle demi-journée existant, mais stockées en texte) :
- `AM` → borne de début 08:00, borne de fin 12:00.
- `PM` → borne de début 13:00, borne de fin 17:00.
- Le widget convertit `AM/PM ↔ heures` uniquement en mémoire pour l'affichage / l'aimantation ; la table ne stocke que du texte.

`Owner` = **email** (et non le nom) car c'est la clé des Règles d'accès (`user.Email`). Le nom affiché est retrouvé par le widget en croisant `Owner` avec `Team.Email`.

### 3.2 Table `Team` (existante) — ajouter 2 colonnes, aucune formule

Colonnes existantes utilisées : `Email`, `PrenomNom`/`Prenom`/`Nom` (affichage), `Service` (regroupement), `Role`.

Colonnes à ajouter :

| Colonne | Type | À remplir |
|---|---|---|
| `Admin` | Toggle | cocher les propriétaires |
| `Moi` | Toggle | cocher **toutes** les lignes (marqueur d'identité, censuré par ACL sauf sur sa propre ligne) |

## 4. Sécurité — Règles d'accès Grist

1. **User Attribute** `TeamRec` : table `Team`, `Email = user.Email`.
2. **Règle de colonne** sur `Team.Moi` : `user.Email != rec.Email` → **Deny Read** (censure `Moi` sauf sur sa ligne ; les lignes et autres colonnes restent lisibles → liste complète des membres).
3. **Règles de table** sur `Time-Out` :
   - `user.TeamRec.Admin != True and user.Email != rec.Owner` → **Deny Update + Delete**
   - `user.TeamRec.Admin != True and user.Email != newRec.Owner` → **Deny Create**
   - Défaut : **Read** autorisé à tous.

Propriétés :
- Lecture pour tous → chacun voit toutes les absences.
- Écriture limitée à sa ligne, sauf admins (`Team.Admin` coché) qui gèrent tout. Enforcé côté serveur : un widget modifié ne peut pas contourner.
- Utilisateur connecté sans ligne `Team` correspondante → `TeamRec` vide → traité comme non-admin, ne possède aucune ligne → effectivement lecture seule (fail-safe).

Prérequis : chaque utilisateur se connecte avec l'email exact de sa ligne `Team`.

## 5. Identité de l'utilisateur dans le widget

Un widget Grist ne peut pas lire directement l'utilisateur connecté. On l'obtient via la censure de colonne :
- Le widget `fetchTable('Team')` reçoit toutes les lignes, mais la colonne `Moi` n'est visible (non censurée) que sur **une seule ligne : celle de l'utilisateur courant**.
- `currentUser` = la ligne où `Moi` est présent/non censuré → fournit `Email` + `Admin`.
- Repli : aucune ligne visible → widget en lecture seule.

## 6. Architecture du widget (dossier `Time-Out/`)

```
Time-Out/
  index.html
  assets/css/styles.css
  assets/js/
    config.js               ids table/colonnes + alias, 4 types + couleurs, bornes AM/PM
    state.js                viewport (zoom/plage), utilisateur courant, données
    main.js                 grist.ready({requiredAccess:'full'}), fetch initial, wiring
    services/gristService.js  lit Team + Time-Out ; create/update/remove Time-Out (texte, alias colonnes/table)
    utils/timeSegments.js   maths demi-journée portées, allégées ; conversions AM/PM <-> heures ; overlap
    ui/board.js             1 ligne par membre Team, groupées par Service ; slots demi-jour ; barres colorées par Type
    ui/editing.js           drag-création (ligne autorisée), overlap, listeners délégués, grisage selon rôle
    ui/reasonModal.js       [NOUVEAU] pop-up des 4 types après le drag
    ui/editModal.js         modifier / supprimer un segment (clic droit)
```

Réutilisation depuis `planning-synchro` : moteur de slots demi-journée, aperçu de drag aimanté, détection d'overlap, wrapper d'écriture (écrire → re-fetch → re-rendu), modal frère du board (survit au re-rendu), listeners délégués. On retire : charge %, projets, coûts, `effectif`, resize optionnel, ligne « Total », dimension projet, synchro localStorage inter-widgets.

## 7. Flux d'interaction

1. Chargement : `fetchTable('Team')` → membres (lignes groupées par `Service`) + utilisateur courant (via `Moi`) ; `fetchTable('Time-Out')` → segments, rattachés à chaque membre par `Owner` (= email) croisé avec `Team.Email`.
2. Rendu : ma ligne éditable, les autres grisées (admin : aucune grisée). Week-ends ombrés et non comptés.
3. Drag sur une ligne autorisée → segment fantôme aimanté au demi-jour (rouge si chevauchement avec un segment existant de la même personne) → au relâchement, **pop-up 4 types**.
4. Choix du type → écriture d'**1 ligne** `Time-Out` :
   - `Owner` = email de la ligne ciblée (pour un utilisateur normal = son propre email ; pour un admin = l'email de la personne).
   - `Start_Date`/`Start_Period`/`End_Date`/`End_Period` depuis la sélection.
   - `Type` = choix du pop-up.
   → re-fetch → re-rendu (barre colorée selon le type). Annuler = rien d'écrit.
5. Clic droit sur un segment géré → **Modifier / Supprimer**.

Couleurs proposées (ajustables) : Congé Payé = bleu · RTT = vert · Congé Parental = violet · Congé Non Payé = gris.

## 8. Hors périmètre (YAGNI)

Commentaire, statut/validation, soldes/compteurs, dimension projet, jours fériés, ligne « Total » mensuelle, synchro localStorage inter-widgets, resize de segment (optionnel, non requis en v1).

## 9. Plan de construction (aperçu — détaillé dans le plan d'implémentation)

- **Phase 0 (utilisateur, dans Grist)** : créer `Time-Out`, ajouter `Team.Admin` + `Team.Moi`, configurer les Règles d'accès (cf. §4).
- **Phase 1** : squelette du dossier + bootstrap Grist + board en lecture seule (toutes les lignes s'affichent, données réelles).
- **Phase 2** : maths demi-journée portées + barres colorées par type + week-ends ombrés.
- **Phase 3** : drag-création sur ligne autorisée + pop-up des 4 types + écriture texte.
- **Phase 4** : modifier/supprimer sa ligne + garde anti-chevauchement + grisage selon rôle (normal vs admin).
- **Phase 5** : finitions (légende couleurs, états vides, repli lecture seule) + vérification avec les Règles d'accès activées.

## 10. Risques / points d'attention

- Colonne `Moi` à cocher pour chaque nouveau membre `Team` (pas de formule pour l'auto-remplir).
- Représentation exacte d'une cellule « censurée » côté widget : détecter « ma ligne » = ligne où `Moi` a une valeur exploitable (≠ censuré/vide).
- Cohérence email de connexion ↔ `Team.Email` (domaines `.fr`/`.com` mélangés dans les données).
- Anomalie de données repérée : la ligne d'Omid Mokhtarivafer a `PrenomNom = "Laurent Orven"` (doublon) — le matching se fait par `Email`, donc sans impact fonctionnel, mais l'affichage du nom sera à corriger côté `Team`.
