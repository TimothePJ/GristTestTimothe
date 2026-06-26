# Integration Synchro

`Synchro` reprend le hub de synchronisation existant avec deux iframes :

- `../Planning Projet/index.html?embedded=planning-sync&externalAxis=1`
- `../gestion-depenses2/index.html?embedded=planning-sync`

Une troisieme iframe `Planning Projet` en `headerOnly=1` sert de chronologie commune.

Au changement de projet, `Synchro` applique le projet aux iframes `Planning Projet`, lit `getFirstRowFirstSegment()` depuis l'API embarquee, construit une fenetre d'un an a partir de cette date, puis applique ce viewport aux deux plannings. Si aucun segment n'est disponible, le debut des bornes projet sert de fallback.
