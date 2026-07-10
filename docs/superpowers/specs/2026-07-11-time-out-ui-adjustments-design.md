# Spec — Time-Out : 3 ajustements UI (scroll, accès non-reconnu, visibilité par service)

Date : 2026-07-11
Statut : design validé, en attente de relecture avant plan.

## 1. Objectif

Trois ajustements au widget Time-Out (déjà codé), tous concentrés dans le flux `fetchAll()` / `render()` de `Time-Out/assets/js/main.js` :

1. **Préserver la position de scroll** à chaque re-render (création / édition / suppression de congé). Aujourd'hui `onChanged → render()` reconstruit le board (`board.destroy()` + `createLeaveBoard` + `board.render`), ce qui remet le scroll en haut.
2. **Utilisateur non reconnu → ne voit pas le tableau.** Aujourd'hui : board grisé + bannière « lecture seule ». Nouveau : board **complètement masqué**, seul un message d'accès refusé s'affiche.
3. **Visibilité par service.** Un utilisateur **non-admin** ne voit que les personnes de **son service** ; un **admin** (`Team.Admin`) voit **tous les services**.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Scroll | Capturer `scrollTop`/`scrollLeft` du `.charge-plan-scroll` avant reconstruction, réappliquer sur le nouveau après `board.render()`. |
| Non reconnu (`currentUser.personKey === ""`) | Masquer `els.main` (board) ; afficher un message « Vous n'êtes pas reconnu — accès au planning refusé. » ; ne pas construire/exposer le board pour ce rendu. |
| Filtrage service | Non-admin : membres dont `normalize(service) === normalize(currentUser.service)`. Admin : tous. Comparaison via la normalisation existante (`teamPeople.normalizeName` réutilisée pour le service, ou une normalisation équivalente). |
| Service de l'utilisateur courant | `currentUser.service` = `service` du membre dédupliqué dont `personKey === currentUser.personKey`. |
| Non-admin sans service | Voit uniquement les personnes « Sans service » (dont lui-même). Comportement accepté. |
| Périmètre | Uniquement `Time-Out/assets/js/main.js` (+ éventuellement le texte de la bannière). Widget de charge et reste de Time-Out inchangés. |

## 3. Détail des changements (main.js)

### 3.1 `fetchAll()`
Après le calcul de `cu.personKey`, ajouter le service courant :
```
cu.service = (state.teamMembers.find((m) => m.personKey === cu.personKey) || {}).service || "";
```

### 3.2 `render()`
- **Scroll (avant `board.destroy()`)** : lire l'ancien conteneur.
  ```
  const prevScroll = els.main.querySelector(".charge-plan-scroll");
  const savedTop = prevScroll ? prevScroll.scrollTop : 0;
  const savedLeft = prevScroll ? prevScroll.scrollLeft : 0;
  ```
  **Après `board.render(...)`** : réappliquer sur le nouveau.
  ```
  const newScroll = els.main.querySelector(".charge-plan-scroll");
  if (newScroll) { newScroll.scrollTop = savedTop; newScroll.scrollLeft = savedLeft; }
  ```
- **Non reconnu** : remplacer la logique `els.main.hidden = !hasMembers` + bannière lecture-seule par :
  ```
  els.empty.hidden = true;
  if (els.banner) els.banner.hidden = true;
  if (unrecognized) {
    els.main.hidden = true;
    if (els.banner) { els.banner.hidden = false; els.banner.textContent = "Vous n'êtes pas reconnu — accès au planning refusé."; }
    return; // ne construit pas le board
  }
  if (!hasMembers) { els.main.hidden = true; els.empty.hidden = false; return; }
  els.main.hidden = false;
  ```
- **Filtrage service** : calculer les membres visibles et les passer au board.
  ```
  const visibleMembers = state.currentUser.isAdmin
    ? state.teamMembers
    : state.teamMembers.filter((m) => normService(m.service) === normService(state.currentUser.service));
  board.render({ members: visibleMembers, segments: state.segments, viewport: state.viewport, currentUser: state.currentUser });
  ```
  où `normService` = normalisation (réutiliser `normalizeName` de `teamPeople.js`, importée).

## 4. Cas limites

- Scroll : si aucun `.charge-plan-scroll` (premier rendu / board masqué) → `savedTop = 0`, aucune régression.
- Non reconnu ET aucun membre → message « non reconnu » prioritaire.
- Admin non reconnu (email hors Team mais... impossible : `isAdmin` vient de `TeamRec`, donc un email hors Team → `personKey` vide → non reconnu → board masqué, même s'il était admin). Accepté : sans ligne Team, pas d'accès.
- Filtrage : le filtrage ne concerne que l'affichage ; l'identité/édition (par `personKey`) et l'ACL Grist sont inchangées. Un non-admin ne voit donc que son service, et n'édite que sa ligne dedans.
- Segments : `buildMembersFromLeaves` s'exécute sur `visibleMembers` → seuls les congés des personnes visibles s'affichent (les autres ne sont juste pas rendus).

## 5. Hors périmètre

Pas de sécurité serveur ajoutée (le masquage non-reconnu et le filtrage service sont UX ; la table reste lisible par l'ACL Read-all). Pas de sélecteur de service pour l'admin. Widget de charge inchangé.

## 6. Tests

- Logique pure minimale : si on extrait un helper `filterMembersByService(members, service, isAdmin)`, le tester (`node --test`) : admin → tous ; non-admin → même service ; service vide → « Sans service ».
- Le reste (scroll DOM, masquage) → vérification manuelle Grist.

## 7. Plan (aperçu)

- Tâche 1 : (optionnel) helper `filterMembersByService` + test.
- Tâche 2 : `main.js` — `cu.service`, scroll save/restore, masquage non-reconnu, filtrage service au rendu.
- Tâche 3 : vérification manuelle Grist.
