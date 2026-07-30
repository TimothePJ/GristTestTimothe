# Accès interservices Grist

Cette fonctionnalité ajoute un contexte `Projet + Service` commun aux widgets et
un widget d'administration des affectations de projets par service.

## Services supportés

- `Structure`
- `Synthese`
- `Topographie`

Les valeurs sont volontairement strictes. Les variantes avec accent, espace ou
casse différente sont normalisées par l'interface, mais les données Grist
doivent utiliser les trois valeurs ci-dessus.

## Widgets couverts

- `Reference2`
- `EnAttente`
- `ListeDePlan`
- `Bordereau`
- `Planning Projet`
- `Avancement`
- `planning-synchro`
- `gestion-depenses2`
- `Gestion-globale`
- `Gestion-User`

Les dossiers `gestion-depenses`, `gestion-depenses3`, `Fusion` et `Ventilation`
ne font pas partie du périmètre. `Timesheet` n'est plus chargée par
`gestion-depenses2`; les données actives de charge utilisent `TimeSegment` et
`TimeReal`.

## Fonctionnement

La sélection est stockée dans :

- `grist.selected-project`
- `grist.selected-project-id`
- `grist.selected-service`

Le service principal vient de `Team.Service`. Les projets et services autorisés
viennent des colonnes texte :

- `Team.Projets_Lecture_Structure`
- `Team.Projets_Lecture_Synthese`
- `Team.Projets_Lecture_Topographie`

Chaque ligne suit le format :

```text
NumeroProjet|NomProjet
```

La matrice appliquée est la suivante :

- une personne `Structure` voit tous les projets et peut les modifier dans
  `Structure` ;
- pour cette personne, `Synthese` ou `Topographie` n'apparaît que si le projet
  est présent dans la colonne correspondante, et reste en lecture seule ;
- une personne `Synthese` ou `Topographie` ne voit que les projets présents
  dans au moins une de ses colonnes `Projets_Lecture_*` ;
- une attribution dans son service personnel est modifiable ;
- une attribution dans un autre service est en lecture seule ;
- `Team.Admin` n'accorde aucun contournement automatique dans les widgets
  opérationnels. Le widget d'administration conserve, lui, le catalogue complet.

Les tables qui possèdent `NumeroProjet` vérifient le numéro exact. Les tables
historiques qui possèdent seulement un nom de projet vérifient le libellé exact
placé après `|`. Si plusieurs lignes de `Projets2` partagent un numéro avec des
noms différents, le widget écrit une ligne d'autorisation par nom.

## Widget d'administration

Le point d'entrée est :

```text
gestion-acces-interservices/index.html
```

Dans Grist, ajouter une vue « Widget personnalisé », utiliser l'URL publiée de
ce fichier et donner l'accès complet au widget. L'interface refuse son
utilisation si la ligne `Team` courante n'est pas reconnue comme administrateur.
Elle permet aussi d'attribuer un projet dans le service personnel d'une personne
`Synthese` ou `Topographie`. Une attribution `Structure` sur une personne
`Structure` est inutile puisque cet accès est implicite.
La protection réelle des colonnes d'autorisation doit également être appliquée
dans les permissions avancées.

## Déploiement

1. Appliquer la préparation décrite dans
   [MIGRATION.md](./MIGRATION.md).
2. Publier les fichiers de la branche.
3. Ajouter le widget d'administration dans Grist.
4. Tester le filtrage visuel et les écritures.
5. Appliquer les règles de
   [PERMISSIONS_AVANCEES.md](./PERMISSIONS_AVANCEES.md).
6. Effectuer les tests « Voir en tant que » avant l'activation générale.

## Limite de `Projets2.Avancement`

Les trois services sont stockés dans une même cellule JSON. L'interface affiche
et modifie uniquement le tableau du service courant, mais Grist ne peut pas
appliquer une permission différente à chaque fragment d'une cellule texte.
Une séparation de sécurité absolue nécessiterait une table avec une ligne par
`NumeroProjet + Service`.
