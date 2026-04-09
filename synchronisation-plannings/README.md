# Synchronisation des plannings

Hub de synchronisation entre :

- `Planning Projet`
- `gestion-depenses2`

La page [`index.html`](./index.html) embarque les deux applications, un axe temporel commun et le graphique des dépenses. Le hub pilote :

- la sélection de projet partagée ;
- la propagation des viewports ;
- l’alignement du planning `gestion-depenses2` sur la frise / le planning de référence ;
- la présentation visuelle des iframes embarquées.

## Architecture réelle

```text
synchronisation-plannings/
  index.html
  README.md
  docs/
    INTEGRATION.md
  assets/
    css/
      main.css
      base.css
      layout.css
      components.css
      embeds.css
      debug.css
    js/
      main.js
      app/
        bootstrap.js
        constants.js
        dom.js
        state.js
      services/
        childApi.js
        projectSync.js
        viewportSync.js
      viewport/
        normalize.js
        bounds.js
        build.js
        alignment.js
      layout/
        shell.js
        framePresentation.js
        resizeHandle.js
        debugLayout.js
      utils/
        date.js
      legacy/
        core/
        adapters/
        demo/
```

## Rôle des modules

- `app/` : point d’entrée, constantes, DOM partagé, état mutable.
- `services/` : orchestration des APIs iframe, changement de projet, synchronisation des viewports.
- `viewport/` : logique pure de normalisation / construction / alignement des fenêtres visibles.
- `layout/` : shell commun, redimensionnement, présentation des iframes, instrumentation debug.
- `legacy/` : ancienne V1 contractuelle / démo conservée hors du chemin de prod.

## Flux de démarrage

1. `assets/js/main.js` appelle `bootstrapHubApp()`.
2. Le bootstrap récupère les APIs embarquées de `Planning Projet`.
3. Le hub construit la liste des projets, branche les contrôles et initialise le projet actif.
4. Les iframes `gestion-depenses2` et graphique sont attachées ensuite et se calent sur l’état partagé.

## Contrat public conservé

Le hub continue d’utiliser les mêmes APIs exposées par les iframes :

- `setSelectedProject(...)`
- `getViewport()`
- `applyViewport(...)`
- `subscribeViewportChange(...)`
- `getProjectDateBounds(...)`

L’HTML garde aussi les mêmes IDs structurants déjà consommés par le hub.
