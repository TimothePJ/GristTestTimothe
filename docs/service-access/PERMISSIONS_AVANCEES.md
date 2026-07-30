# Permissions avancées Grist

Les filtres des widgets protègent l'interface. Ces règles assurent la sécurité
côté Grist et doivent être appliquées manuellement après la migration.

## Propriété utilisateur

Créer ou conserver une propriété utilisateur nommée `TeamAccess` :

- propriété d'appariage : `user.Email` ;
- table : `Team` ;
- colonne cible : `Email`.

`Team.Email` doit être en minuscules et identifier une seule ligne.

Ne pas utiliser `champ or ""` dans les conditions ACL. Dans le langage restreint
des prédicats Grist, `and` et `or` produisent des booléens. Les conditions
ci-dessous concatènent directement les colonnes Text.

## Matrice d'accès

- `Structure` lit et modifie tous les projets `Structure` ;
- `Structure` lit un autre service uniquement lorsque le projet est attribué ;
- `Synthese` et `Topographie` ne lisent que leurs projets attribués, y compris
  dans leur service personnel ;
- une attribution dans le service personnel est modifiable ;
- une attribution dans un autre service est en lecture seule ;
- un projet non attribué est invisible.

## Ordre commun des règles projet + service

Dans chaque groupe `All`, utiliser cet ordre :

1. `user.Access == OWNER` : `+R +U +C +D` ;
2. condition de lecture : `+R` uniquement ;
3. condition de modification : `+U` uniquement ;
4. condition de création : `+C` uniquement ;
5. condition de suppression : `+D` uniquement ;
6. tous les autres : `-R -U -C -D`.

Conserver les règles de colonnes particulières déjà validées, par exemple la
règle `References2.Bloquant`.

## Tables identifiées par le nom du projet

Correspondances :

- `References2` : `NomProjet` ;
- `ListePlan_NDC_COF` : `Nom_projet` ;
- `Planning_Projet` : `NomProjet` ;
- `Envois` : `Projet`.

Les exemples utilisent `rec.NomProjet`. Remplacer littéralement `NomProjet` par
la colonne indiquée ci-dessus dans la table concernée.

### Lecture

```python
(
  user.TeamAccess.Service == "Structure"
  and rec.Service == "Structure"
)
or (
  rec.Service == "Structure"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Structure + "\n"
  )
)
or (
  rec.Service == "Synthese"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
)
or (
  rec.Service == "Topographie"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
)
```

### Modification

```python
(
  user.TeamAccess.Service == "Structure"
  and rec.Service == "Structure"
  and newRec.Service == "Structure"
)
or (
  user.TeamAccess.Service == "Synthese"
  and rec.Service == "Synthese"
  and newRec.Service == "Synthese"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
  and ("|" + newRec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
)
or (
  user.TeamAccess.Service == "Topographie"
  and rec.Service == "Topographie"
  and newRec.Service == "Topographie"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
  and ("|" + newRec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
)
```

### Création

```python
(
  user.TeamAccess.Service == "Structure"
  and newRec.Service == "Structure"
)
or (
  user.TeamAccess.Service == "Synthese"
  and newRec.Service == "Synthese"
  and ("|" + newRec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
)
or (
  user.TeamAccess.Service == "Topographie"
  and newRec.Service == "Topographie"
  and ("|" + newRec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
)
```

### Suppression

```python
(
  user.TeamAccess.Service == "Structure"
  and rec.Service == "Structure"
)
or (
  user.TeamAccess.Service == "Synthese"
  and rec.Service == "Synthese"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
)
or (
  user.TeamAccess.Service == "Topographie"
  and rec.Service == "Topographie"
  and ("|" + rec.NomProjet + "\n") in (
    user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
)
```

## Tables identifiées par `NumeroProjet`

Appliquer les mêmes règles dans :

- `Budget` ;
- `ProjectTeam` ;
- `TimeSegment` ;
- `TimeReal`.

Dans les quatre conditions précédentes, remplacer chaque test de nom :

```python
("|" + rec.NomProjet + "\n") in (
  user.TeamAccess.Projets_Lecture_Synthese + "\n"
)
```

par le test de numéro correspondant :

```python
("\n" + rec.NumeroProjet + "|") in (
  "\n" + user.TeamAccess.Projets_Lecture_Synthese + "\n"
)
```

Pour une création ou le nouvel état d'une modification, utiliser
`newRec.NumeroProjet`. Appliquer la même substitution pour `Structure` et
`Topographie`.

## Projets2

`Projets2` n'a pas de colonne `Service`. Le catalogue doit être filtré par
`Numero_de_projet`.

Ordre :

1. Owner : CRUD ;
2. condition ci-dessous : R uniquement ;
3. condition de modification ci-dessous : U uniquement ;
4. tous les autres : refus total.

### Lecture du catalogue

```python
user.TeamAccess.Admin == True
or user.TeamAccess.Service == "Structure"
or ("\n" + rec.Numero_de_projet + "|") in (
  "\n" + user.TeamAccess.Projets_Lecture_Structure + "\n"
)
or ("\n" + rec.Numero_de_projet + "|") in (
  "\n" + user.TeamAccess.Projets_Lecture_Synthese + "\n"
)
or ("\n" + rec.Numero_de_projet + "|") in (
  "\n" + user.TeamAccess.Projets_Lecture_Topographie + "\n"
)
```

La clause `Admin` permet au widget d'administration de charger le catalogue.
Elle ne constitue pas un droit automatique sur les tables opérationnelles.

### Modification d'une ligne existante

```python
user.TeamAccess.Service == "Structure"
or (
  user.TeamAccess.Service == "Synthese"
  and ("\n" + rec.Numero_de_projet + "|") in (
    "\n" + user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
  and ("\n" + newRec.Numero_de_projet + "|") in (
    "\n" + user.TeamAccess.Projets_Lecture_Synthese + "\n"
  )
)
or (
  user.TeamAccess.Service == "Topographie"
  and ("\n" + rec.Numero_de_projet + "|") in (
    "\n" + user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
  and ("\n" + newRec.Numero_de_projet + "|") in (
    "\n" + user.TeamAccess.Projets_Lecture_Topographie + "\n"
  )
)
```

Ne pas accorder C ou D aux utilisateurs ordinaires sur `Projets2`.

`Avancement` reste une cellule JSON commune : Grist ne peut pas sécuriser
séparément ses blocs `services.Structure`, `services.Synthese` et
`services.Topographie`.

## Emetteurs

Supprimer toute ancienne règle de colonne `Service` qui refuse R. Puis utiliser :

```python
(
  rec.Service == "Structure"
  and (
    user.TeamAccess.Service == "Structure"
    or user.TeamAccess.Projets_Lecture_Structure not in [None, ""]
  )
)
or (
  rec.Service == "Synthese"
  and user.TeamAccess.Projets_Lecture_Synthese not in [None, ""]
)
or (
  rec.Service == "Topographie"
  and user.TeamAccess.Projets_Lecture_Topographie not in [None, ""]
)
```

Permission R uniquement. Les écritures restent réservées aux Owners. Comme
`Emetteurs` n'a pas de projet, une attribution dans un service ouvre la liste
d'émetteurs de ce service.

## Team

Créer une règle de colonnes sur :

- `Projets_Lecture_Structure` ;
- `Projets_Lecture_Synthese` ;
- `Projets_Lecture_Topographie`.

Ordre de cette règle de colonnes :

1. Owner : R/U ;
2. `user.TeamAccess.Admin == True` : R/U ;
3. `user.Email == rec.Email` : R autorisé, U refusé ;
4. tous les autres : R/U refusés.

Règles `All` de `Team` :

1. Owner : CRUD ;
2. `user.TeamAccess.Admin == True` : R ;
3. `user.Email == rec.Email` : R ;
4. `rec.Service == user.TeamAccess.Service` : R ;
5. tous les autres : refus total.

Conserver une règle de colonne `Moi` qui autorise Owner, autorise R uniquement
sur la propre ligne de l'utilisateur, puis refuse R/U à tous les autres.

## Time_Out

Ne pas ajouter de filtre projet. Conserver le fonctionnement validé des
absences. Remplacer seulement les anciennes références `TeamRec.Admin` par
`TeamAccess.Admin` lors de l'uniformisation des propriétés utilisateur.

## Tests « Voir en tant que »

Tester au minimum :

1. Structure sans attribution : tous les projets Structure sont visibles et
   modifiables ;
2. Synthese sans attribution : aucun projet n'est visible ;
3. projet attribué en Synthese à une personne Synthese : modification permise ;
4. projet attribué en Structure à cette personne : lecture seule ;
5. autre projet Structure non attribué : invisible ;
6. tentative d'écriture directe dans un service externe : refusée ;
7. révocation : le projet disparaît après actualisation ;
8. `2520` ne donne jamais accès à `252035`.
