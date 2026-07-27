# Permissions avancées Grist

Les filtres des widgets protègent l'interface. Les règles ci-dessous assurent la
sécurité côté Grist et doivent être appliquées après la migration.

Les exemples supposent que l'attribut utilisateur `TeamRec` existe déjà et
retourne la ligne `Team` correspondant à l'adresse e-mail Grist.

La colonne `Team.Email` doit être stockée en minuscules, comme `user.Email`.
L'appariement est exact et chaque adresse doit identifier une seule ligne
`Team`.

Adapter le test administrateur au champ déjà utilisé dans le document. Les
exemples utilisent :

```python
user.TeamRec.Admin
```

## Tables projet + service

### Lecture du service principal

Condition :

```python
rec.Service == user.TeamRec.Service
```

Permission : `+R`

### Lecture externe des tables identifiées par nom

Ajouter une seule règle couvrant les trois services, avec `+R` uniquement,
juste avant le refus final. Le modèle ci-dessous utilise `rec.NomProjet` :

```python
(
  rec.Service == "Structure"
  and ("|" + rec.NomProjet + "\n") in (
    "\n" + (user.TeamRec.Projets_Lecture_Structure or "") + "\n"
  )
) or (
  rec.Service == "Synthese"
  and ("|" + rec.NomProjet + "\n") in (
    "\n" + (user.TeamRec.Projets_Lecture_Synthese or "") + "\n"
  )
) or (
  rec.Service == "Topographie"
  and ("|" + rec.NomProjet + "\n") in (
    "\n" + (user.TeamRec.Projets_Lecture_Topographie or "") + "\n"
  )
)
```

Adapter uniquement le nom de colonne :

- `References2` : `rec.NomProjet`
- `ListePlan_NDC_COF` : `rec.Nom_projet`
- `Planning_Projet` : `rec.NomProjet`
- `Envois` : `rec.Projet`

### Lecture externe des tables identifiées par numéro

Ajouter une seule règle avec `+R` uniquement dans `Budget`, `ProjectTeam`,
`TimeSegment` et `TimeReal` :

```python
(
  rec.Service == "Structure"
  and ("\n" + rec.NumeroProjet + "|") in (
    "\n" + (user.TeamRec.Projets_Lecture_Structure or "") + "\n"
  )
) or (
  rec.Service == "Synthese"
  and ("\n" + rec.NumeroProjet + "|") in (
    "\n" + (user.TeamRec.Projets_Lecture_Synthese or "") + "\n"
  )
) or (
  rec.Service == "Topographie"
  and ("\n" + rec.NumeroProjet + "|") in (
    "\n" + (user.TeamRec.Projets_Lecture_Topographie or "") + "\n"
  )
)
```

### Création dans le service principal

```python
newRec.Service == user.TeamRec.Service
```

Permission : `+C`

### Modification sans déplacement de service

```python
rec.Service == user.TeamRec.Service and newRec.Service == user.TeamRec.Service
```

Permission : `+U`

### Suppression dans le service principal

```python
rec.Service == user.TeamRec.Service
```

Permission : `+D`

Les règles de lecture externe ne reçoivent jamais `C`, `U` ou `D`.

Ajouter en première position la règle administrateur existante avec `+CRUD`,
puis terminer par une règle par défaut refusant les permissions non accordées.

## Emetteurs

`Emetteurs` est une table de service sans projet. Conserver les droits complets
sur le service principal. Pour lire un service externe dès qu'au moins un
projet de ce service est accordé :

```python
(
  rec.Service == "Structure"
  and (user.TeamRec.Projets_Lecture_Structure or "") != ""
) or (
  rec.Service == "Synthese"
  and (user.TeamRec.Projets_Lecture_Synthese or "") != ""
) or (
  rec.Service == "Topographie"
  and (user.TeamRec.Projets_Lecture_Topographie or "") != ""
)
```

Permission : `+R`. Les écritures externes restent interdites. Une éventuelle
règle de colonne sur `Emetteurs.Service` ne doit pas refuser `R`, faute de quoi
la valeur nécessaire au filtrage du widget est censurée.

## Time-Out

Ne pas ajouter de filtre projet. Conserver la règle existante permettant la
lecture des absences conformément au fonctionnement validé.

## Team

Créer une règle de colonnes portant sur :

- `Projets_Lecture_Structure`
- `Projets_Lecture_Synthese`
- `Projets_Lecture_Topographie`

Autoriser la modification uniquement aux administrateurs/Owners. Refuser la
modification à tous les autres utilisateurs, y compris sur leur propre ligne
`Team`.

## Projets2 et Avancement

`Projets2` n'a pas de colonne `Service`. Conserver les règles actuelles du
catalogue projet. Une permission Grist ne peut pas contrôler séparément
`services.Structure`, `services.Synthese` et `services.Topographie` à
l'intérieur de la même cellule `Avancement`.

## Tests « Voir en tant que »

Avec une personne Synthese :

1. sans droit Structure, le service Structure ne doit pas être proposé ;
2. avec `252035|ERA QUAI D'ORSAY`, Structure doit être proposé sur ce projet ;
3. les lignes Structure du projet doivent être lisibles ;
4. une création, modification ou suppression directe doit être refusée ;
5. les autres projets Structure doivent rester invisibles ;
6. après révocation, l'accès doit disparaître ;
7. le service Synthese doit rester modifiable normalement.
