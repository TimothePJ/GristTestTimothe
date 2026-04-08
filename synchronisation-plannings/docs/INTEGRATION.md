# Intégration du hub

## Vue d’ensemble

Le hub `synchronisation-plannings` n’utilise pas un bus générique externe. Il orchestre directement quatre vues embarquées :

- la frise `PlanningProjet`
- le planning principal `PlanningProjet`
- le planning `gestion-depenses2`
- le graphique des dépenses

Le point d’entrée prod est `assets/js/main.js`, qui démarre `bootstrapHubApp()` dans `assets/js/app/bootstrap.js`.

## Contrat attendu des iframes

Chaque iframe embarquée doit exposer une API globale prête (`isReady`) avec, selon le cas :

- `listProjects()`
- `getSelectedProject()`
- `setSelectedProject(projectKey)`
- `getViewport()`
- `applyViewport(viewport)`
- `subscribeViewportChange(handler)`
- `getProjectDateBounds()`
- éventuellement `setViewportBounds()` / `getViewportBounds()` / `moveViewportByMode()` / `setZoomMode()`

Le hub ne change pas ce contrat ; il l’encapsule simplement dans `services/childApi.js`.

## Répartition des responsabilités

- `services/projectSync.js`
  - applique un projet partagé à toutes les vues prêtes ;
  - recalcule le viewport initial du projet ;
  - stabilise le planning de référence puis recale `gestion-depenses2`.
- `services/viewportSync.js`
  - reçoit les changements de viewport ;
  - évite les boucles de propagation ;
  - pilote les boutons de navigation / zoom du shell commun.
- `viewport/alignment.js`
  - mesure les écarts visuels entre la frise de référence et `gestion-depenses2` ;
  - corrige la largeur visible, l’offset pixel et les alignements jour par jour.
- `layout/framePresentation.js`
  - injecte la présentation embarquée dans `gestion-depenses2` ;
  - ajuste les hauteurs d’iframe sans modifier le contrat de l’app embarquée.

## Debug

Deux paramètres d’URL sont conservés :

- `debugLayout=1` active les snapshots de layout dans la console.
- `noStickyShell=1` désactive le comportement sticky du shell partagé.

## Legacy

Les anciens modules `core/`, `adapters/` et `demo/` ont été déplacés dans `assets/js/legacy/`.
Ils ne participent plus au chargement prod et servent uniquement de référence historique.
