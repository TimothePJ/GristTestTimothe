# Spec — Déduplication des personnes dans le widget Time-Out

Date : 2026-07-11
Statut : design validé (clé de dédup choisie), en attente de relecture avant plan.

## 1. Problème

La table `Team` contient des **doublons intentionnels** : une même personne y a plusieurs lignes (adresses mail multiples ou changées), partageant `Prenom`/`Nom`/`IdTrefle` mais avec des `Email` différents. Le widget Time-Out construit aujourd'hui **une ligne par ligne `Team`** (`main.js buildTeamMembers`) et rattache les congés **par email exact** (`board.js buildMembersFromLeaves`). Conséquences :
- une personne apparaît en **plusieurs lignes** ;
- ses congés sont **éclatés** entre ses adresses (un congé posé sous l'email A n'apparaît pas sur la ligne de l'email B).

Cas réels (CSV Team) : Maria Fernandes (2 lignes, dont une avec `PrenomNom` vide), Thadone Viraphan (2), Boussad Hamadache (2), Omid Mokhtarivafer (`PrenomNom` erroné « Laurent Orven »).

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Clé de déduplication | **`normalize(Prenom + " " + Nom)`** (NFD, sans accents, casse/espaces normalisés). Fallback email si le nom composé est vide. |
| Nom affiché (canonique) | **`Prenom + " " + Nom`** — pas `PrenomNom` (erroné pour Omid, vide pour une ligne de Maria). |
| Rattachement des congés | Par **appartenance à l'ensemble d'emails** de la personne, pas par email unique. |
| Identité utilisateur | Inchangée : colonne `Moi` censurée → email de connexion → personne dont l'ensemble d'emails le contient. |
| Éditabilité | Par **personne** (`personKey`), plus par email. |
| Owner écrit à la création | Utilisateur normal sur sa ligne = son email de connexion (respecte l'ACL `user.Email == newRec.Owner`) ; admin sur la ligne de X = `primaryEmail` de X. |
| Widget de charge | **Inchangé** (il dédup déjà les absences par nom normalisé). |

## 3. Modèle de données (Time-Out)

Un membre dédupliqué :
```
{
  personKey: string,      // normalize(Prenom + " " + Nom)
  name: string,           // Prenom + " " + Nom (canonique, jamais vide)
  service: string,
  emails: string[],       // toutes ses adresses, normalisées lowercase
  primaryEmail: string,   // email à écrire comme Owner pour un admin (déterministe)
}
```

- `buildTeamMembers(rows, cols)` regroupe les lignes `Team` par `personKey` : première ligne rencontrée fixe `name`/`service` ; toutes les adresses non vides alimentent `emails` (dédupliquées) ; `primaryEmail` = première adresse `@vinci-construction.*` non `-ext`/non `@vc-partner.net` si présente, sinon la première adresse.
- `service` : pris de la première ligne (les lignes d'une même personne partagent le même Service dans les données).

## 4. Rattachement des congés

- `buildMembersFromLeaves(members, segments)` construit `emailToPerson : Map<emailLower, member>` à partir des `emails` de chaque membre, puis attache chaque segment au membre dont l'ensemble d'emails contient `segment.owner` (lowercase). Les segments dont l'`Owner` ne correspond à aucun membre sont ignorés (personne hors équipe).
- Résultat : une ligne par personne, portant **tous** ses congés.

## 5. Identité & éditabilité

- `findCurrentUser` (inchangé) renvoie `{ email, isAdmin }` depuis la ligne où `Moi` est visible.
- `currentUserPersonKey` = `personKey` du membre dont `emails` contient `currentUser.email` (`""` si non trouvé → lecture seule).
- Board : chaque piste porte `data-person-key` (+ `data-owner-email` = email à écrire : `currentUser.email` si c'est la ligne de l'utilisateur courant, sinon `member.primaryEmail`). Grisage `is-not-editable` si `!isAdmin && personKey !== currentUserPersonKey`.
- `canEditTrack(personKey)` = `isAdmin || personKey === currentUserPersonKey`.
- Création (drag → pop-up) : `Owner` écrit = `data-owner-email` de la piste. Édition/suppression : gate par `personKey`.

## 6. Fichiers touchés

- Nouveau : `Time-Out/assets/js/utils/teamPeople.js` — helper pur `dedupeTeamMembers(teamRows, cols)` → membres dédupliqués ; `findPersonKeyForEmail(members, email)`. Testé `node --test`.
- `Time-Out/assets/js/main.js` : `buildTeamMembers` → `dedupeTeamMembers` ; calcule `currentUserPersonKey` ; `canEditTrack` par `personKey` ; `openReasonModal`/edit prennent `data-owner-email`/`data-person-key`.
- `Time-Out/assets/js/ui/board.js` : `buildMembersFromLeaves` (rattachement par ensemble d'emails) ; `renderWorkerRow` émet `data-person-key` + `data-owner-email` ; grisage par `personKey`.
- `Time-Out/assets/js/ui/editing.js` : `handlePointerDown`/`handleContextMenuEvent` lisent `data-person-key` (pour `canEditTrack`) et `data-owner-email` (pour le pop-up) ; l'ouverture de l'edit modal gate par `personKey`.
- `Time-Out/assets/js/config.js` : inchangé (colonnes `prenom`/`nom`/`email`/`service` déjà présentes ; pas besoin d'`IdTrefle`).

## 7. Cas limites

- `Prenom + Nom` vide (improbable) → `personKey`/`name` = email en repli (une personne never sans clé).
- `PrenomNom` erroné/vide → ignoré, on utilise `Prenom + Nom`.
- Un `Owner` de congé qui ne correspond à aucune adresse d'aucun membre → congé ignoré (pas de crash, pas de ligne fantôme).
- Utilisateur connecté dont l'email n'est dans aucune ligne `Team` → `currentUserPersonKey = ""` → board en lecture seule (bannière existante).
- Admin créant sur la ligne de X : `Owner = X.primaryEmail` (dans l'ensemble d'emails de X → se rattache bien à sa ligne ; ACL admin l'autorise).

## 8. Hors périmètre

Widget de charge (leave-aware) inchangé. Pas de modification de la table `Team` ni des Règles d'accès. Pas de fusion des lignes `Team` côté Grist (la dédup est purement côté widget, à l'affichage).

## 9. Tests

- `teamPeople.js` (`node --test`) : dédup de 2 lignes même Prenom/Nom emails différents → 1 membre à 2 emails ; `PrenomNom` vide/erroné ignoré (nom = Prenom+Nom) ; `primaryEmail` = adresse principale non-ext ; `findPersonKeyForEmail` retrouve la personne par n'importe laquelle de ses adresses.
- Vérification manuelle Grist (DOM) : une seule ligne par personne ; congés posés sous 2 adresses regroupés ; ma ligne éditable, autres grisées ; admin édite tout ; réf. Maria/Thadone/Boussad n'apparaissent qu'une fois.

## 10. Plan (aperçu)

- Phase 1 : `teamPeople.js` + tests.
- Phase 2 : `main.js` (dédup + personKey courant + canEditTrack + owner-email).
- Phase 3 : `board.js` (rattachement par emails + data-person-key + grisage).
- Phase 4 : `editing.js` (gate par personKey + email à écrire) + vérif manuelle.
