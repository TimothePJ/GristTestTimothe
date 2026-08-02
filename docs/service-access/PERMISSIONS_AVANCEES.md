# Permissions avancées Grist — phase ultérieure

Les permissions avancées ne font pas partie de l'implémentation actuelle.

La matrice précédente fondée sur les colonnes `Projets_Lecture_*` est devenue
obsolète et ne doit pas être appliquée à la nouvelle architecture.

La version actuelle protège uniquement les parcours des widgets JavaScript avec
la règle :

```text
AccèsProjet = ProjectTeam ∪ Team.Projets_Access
```

Une future conception ACL devra reproduire côté Grist :

- l'union des deux sources d'affectation ;
- l'absence d'exception pour Structure ;
- l'accès de tous les projets aux administrateurs ;
- l'écriture limitée à `Team.Service` ;
- la lecture seule dans les autres services ;
- l'identification stable entre `ProjectTeam` et `Team`.

Ne pas activer les anciennes règles sans une nouvelle étude : les prédicats ACL
Grist devront pouvoir exprimer de manière fiable l'appartenance `ProjectTeam`,
ce qui pourra nécessiter des références, formules ou tables d'accès dédiées.
