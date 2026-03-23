# Synchronisation des plannings

Premiere version d'une brique partagee pour synchroniser la chronologie entre :

- `gestion-depenses2`
- `Planning Projet`

L'objectif de cette V1 est de poser une base propre, reutilisable et testable sans toucher tout de suite aux deux apps existantes.

## Arborescence

```text
synchronisation-plannings/
  README.md
  index.html
  docs/
    INTEGRATION.md
  assets/
    css/
      styles.css
    js/
      main.js
      core/
        contracts.js
        channel.js
        syncBridge.js
      utils/
        date.js
      adapters/
        gestionDepenses2Adapter.example.js
        planningProjetAdapter.example.js
      demo/
        createMockPlanningApp.js
```

## Ce que contient cette V1

- un contrat commun de viewport planning
- un canal de synchronisation via `localStorage`
- un bridge `publish/subscribe` pour relier une app au canal
- deux adaptateurs d'exemple pour montrer comment brancher les apps existantes
- une page de demo pour valider le comportement avant integration

## Contrat de synchronisation

Chaque message publie :

- `appId`
- `scope.projectId`
- `scope.zoneId`
- `viewport.mode`
- `viewport.anchorDate`
- `viewport.firstVisibleDate`
- `viewport.visibleDays`
- `viewport.rangeStartDate`
- `viewport.rangeEndDate`

La synchro ne s'applique que si le `projectId` correspond. Le `zoneId` peut aussi etre utilise pour filtrer plus finement.

## Choix de cette premiere version

- Canal : `localStorage`
  - simple a tester
  - fonctionne bien si les widgets partagent la meme origine
  - facile a remplacer plus tard par une table Grist ou un autre transport
- Source de verite : un viewport normalise
  - pas de couplage direct entre les deux moteurs de planning
  - chaque app garde sa logique interne
- Integration progressive
  - on branche d'abord le contrat
  - puis les adaptateurs
  - ensuite seulement la synchro automatique live

## Demarrer la demo

Ouvre [index.html](./index.html) dans un navigateur. La demo affiche deux faux plannings :

- un panneau `gestion-depenses2`
- un panneau `Planning Projet`

Quand ils pointent sur le meme projet, un changement de chronologie dans l'un se repercute dans l'autre.

## Suite logique

Quand tu voudras qu'on aille plus loin, la prochaine etape propre sera :

1. brancher l'adaptateur `gestion-depenses2`
2. brancher l'adaptateur `Planning Projet`
3. choisir le vrai canal de synchro final
   - `localStorage`
   - table Grist dediee
   - `BroadcastChannel`
   - autre
