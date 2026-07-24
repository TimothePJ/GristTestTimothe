# Widget Grist — Gestion des accès projets

Ce widget permet à un administrateur d'accorder ou de retirer une lecture
exceptionnelle sur le couple **projet × service** d'une autre équipe.

Exemple enregistré dans `Team.Acces_Lecture_Projets` :

```text
P1|Structure
```

Le widget est uniquement l'interface d'administration. La sécurité réelle reste
appliquée côté serveur par les règles d'accès Grist.

## 1. Colonne à ajouter dans `Team`

Ajouter la colonne suivante :

| Colonne | Type | Formule |
| --- | --- | --- |
| `Acces_Lecture_Projets` | Choice List | aucune |

La colonne peut rester vide. Le widget écrit les clés sous la forme
`P<id interne de Projets2>|Service`. Le numéro et le nom restent affichés dans
l'interface ; l'identifiant interne évite les différences de format texte /
numérique et reste valable si le numéro ou le nom du projet est corrigé.

La détection de l'administrateur réutilise les colonnes existantes :

- `Admin` : Toggle ;
- `Moi` : cellule lisible uniquement sur la ligne de l'utilisateur connecté ;
- `Email`, `Service`, `Prenom`, `Nom`, `PrenomNom`.

Au moins une personne chargée de gérer les droits doit avoir `Admin = true`.

## 2. Attribut utilisateur

Le document utilise déjà normalement l'attribut `TeamRec`. Sinon, dans
**Règles d'accès → Ajouter des attributs utilisateur**, créer :

| Paramètre | Valeur |
| --- | --- |
| Nom | `TeamRec` |
| Propriété utilisateur | `user.Email` |
| Table | `Team` |
| Colonne de recherche | `Email` |

La variable `user.TeamRec.Acces_Lecture_Projets` devient alors disponible dans
les règles.

## 3. Clé à calculer dans les tables protégées

Ajouter une colonne formule **Texte** appelée `Cle_Acces` dans chaque table qui
contient à la fois un projet et un `Service`.

### Table avec une référence vers `Projets2`

Si la colonne `Projet` est une vraie référence vers `Projets2` :

```python
return "P{}|{}".format($Projet.id, $Service) if $Projet and $Service else ""
```

### Table avec un numéro de projet

Adapter `NumeroProjet` au véritable identifiant de colonne :

```python
project = Projets2.lookupOne(Numero_de_projet=$NumeroProjet)
return "P{}|{}".format(project.id, $Service) if project and $Service else ""
```

### Table avec un nom de projet

Pour `References2` et `Planning_Projet`, le champ est généralement `NomProjet` :

```python
project = Projets2.lookupOne(Nom_de_projet=$NomProjet)
return "P{}|{}".format(project.id, $Service) if project and $Service else ""
```

Pour `ListePlan_NDC_COF`, le champ est généralement `Nom_projet` :

```python
project = Projets2.lookupOne(Nom_de_projet=$Nom_projet)
return "P{}|{}".format(project.id, $Service) if project and $Service else ""
```

Il faut utiliser les identifiants internes réels des colonnes, pas uniquement
leurs libellés affichés.

## 4. Règles de lecture sur les tables métier

Dans chaque table protégée, placer l'exception **avant le refus général** :

```python
user.TeamRec.Acces_Lecture_Projets and rec.Cle_Acces in user.TeamRec.Acces_Lecture_Projets
```

Pour cette condition :

- `R` : autorisé ;
- `U`, `C`, `D` : ne pas autoriser ;
- conserver les interdictions d'écriture hors du service d'origine.

Ordre recommandé pour chaque permission :

1. propriétaires : droits complets ;
2. règles normales du service de l'utilisateur ;
3. règle exceptionnelle ci-dessus : lecture uniquement ;
4. refus général.

La règle doit être ajoutée à toutes les tables nécessaires au widget métier.
Une exception sur `References2` seule ne suffit pas si la page charge également
`ListePlan_NDC_COF` et `Planning_Projet`.

`Projets2` sert de catalogue commun au widget. Dans la configuration actuelle,
il est préférable de laisser cette table lisible par les collaborateurs et de
protéger les données détaillées dans les tables portant la colonne `Service`.

## 5. Protéger l'administration des droits

Créer une règle de colonne sur `Team.Acces_Lecture_Projets`.

Première condition :

```python
user.Access == OWNER or user.TeamRec.Admin == True
```

Autoriser `U`.

Condition suivante (`Everyone Else`) : refuser `U`.

Cette règle empêche un utilisateur d'ajouter lui-même un droit en appelant
directement l'API Grist. Le masquage d'un bouton dans le widget ne serait pas
une protection suffisante.

Vérifier également que les éditeurs ne disposent pas de la permission de
structure `S`. Sinon, ils pourraient modifier une formule et contourner les
règles de lecture.

## 6. Installer le widget

1. Publier ce dossier sur l'hébergement utilisé par les autres widgets.
2. Dans Grist, ajouter un **Custom Widget**.
3. Renseigner l'URL terminant par :

   ```text
   /gestion-acces-projets/index.html
   ```

4. Régler l'accès du widget sur **Full document access**.
5. Ne pas lier le widget à une table : il charge `Team` et `Projets2` avec
   `grist.docApi`.

## 7. Recette de contrôle

Pour l'exemple ERA :

1. sélectionner Baptiste CHEVAU ;
2. sélectionner `252035 — ERA QUAI D'ORSAY` ;
3. sélectionner `Structure` ;
4. cliquer **Accorder l'accès** ;
5. utiliser **Voir en tant que → Baptiste CHEVAU** ;
6. vérifier qu'il voit ERA/Structure, aucun autre projet Structure, et qu'il ne
   peut rien modifier ;
7. retirer ensuite l'autorisation depuis le widget et vérifier que les lignes
   disparaissent.
