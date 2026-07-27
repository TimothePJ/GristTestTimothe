# Permissions avancées Grist

Les filtres des widgets protègent l'interface. Les règles ci-dessous assurent la
sécurité côté Grist et doivent être appliquées après la migration.

Les exemples supposent que l'attribut utilisateur `TeamRec` existe déjà et
retourne la ligne `Team` correspondant à l'adresse e-mail Grist.

Adapter le test administrateur au champ déjà utilisé dans le document. Les
exemples utilisent :

```python
user.TeamRec.Admin
```

## Tables projet + service

Appliquer le principe aux tables suivantes :

- `References2`
- `ListePlan_NDC_COF`
- `Planning_Projet`
- `Envois`
- `Budget`
- `ProjectTeam`
- `TimeSegment`
- `TimeReal`

### Lecture du service principal

Condition :

```python
rec.Service == user.TeamRec.Service
```

Permission : `+R`

### Lecture externe Structure

```python
rec.Service == "Structure" and (
  "\n" + user.TeamRec.Projets_Lecture_Structure + "\n"
).find("\n" + str(rec.NumeroProjet) + "|") >= 0
```

Permission : `+R`

Créer la même règle pour Synthese et Topographie en remplaçant le nom du
service et la colonne `Team`.

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
rec.Service == "Structure" and user.TeamRec.Projets_Lecture_Structure != ""
```

Permission : `+R`

Décliner pour les deux autres services. Les écritures externes restent
interdites.

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
