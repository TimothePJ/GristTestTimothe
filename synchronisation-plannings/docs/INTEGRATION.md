# Plan d'integration

## Idee generale

Les deux apps n'ont pas le meme moteur de chronologie :

- `gestion-depenses2` pilote une timeline maison avec `anchorDate`, `visibleDays` et un mode `week/month/year`
- `Planning Projet` pilote une `vis.Timeline` avec une fenetre visible et des actions de zoom/navigation

La bonne approche consiste donc a partager un **contrat de viewport**, pas des appels directs entre apps.

## Etapes conseillees

### 1. gestion-depenses2

Mapper ces informations vers le contrat commun :

- `projectId`
- `zoneId` si besoin
- `mode`
- `anchorDate`
- `firstVisibleDate`
- `visibleDays`

Points de raccord probables :

- lecture : `state.chargePlanAnchorDate`, `state.chargePlanVisibleDays`, `state.chargePlanZoomMode`
- application : `setChargePlanZoomMode(...)`, `navigateChargePlanToDate(...)`, restauration de viewport
- emission locale : fin de zoom molette, fin de pan, clic sur `Semaine/Mois/Annee`, `Aujourd'hui`, date picker

### 2. Planning Projet

Mapper vers le meme contrat :

- `projectId`
- `zoneId`
- `mode`
- `anchorDate`
- `firstVisibleDate`
- `visibleDays`

Points de raccord probables :

- lecture : `timelineInstance.getWindow()`, `getCurrentZoomMode()`, centre de fenetre
- application : `setWindowForMode(...)`, `setActiveZoomButton(...)`
- emission locale : `rangechanged`, clic zoom, prev/next, today

### 3. Choix du canal

Cette V1 utilise `localStorage`, mais tu peux le remplacer plus tard.

Options :

- `localStorage`
  - simple
  - bien pour une preuve de concept
- `BroadcastChannel`
  - propre pour plusieurs onglets ou widgets
- table Grist dediee
  - robuste si tu veux partager l'etat entre widgets heterogenes
  - utile si les widgets ne partagent pas la meme origine

## Resultat attendu

Une fois les deux adaptateurs branches :

- changement de vue dans une app => l'autre se recale
- scroll/zoom/navigation => meme chronologie
- changement de projet => la synchro ne s'applique plus au mauvais projet
