# Accès Projet + Service dans les widgets Grist

Cette fonctionnalité fournit un contexte commun `Projet + Service` aux widgets
et une interface d'administration des affectations.

## Règle d'affectation

Une personne accède à un projet lorsqu'au moins une des deux sources suivantes
l'affecte :

1. une ligne `ProjectTeam` du projet correspond à sa ligne `Team` ;
2. le projet figure dans `Team.Projets_Access`.

Les deux sources sont fusionnées et dédupliquées par `NumeroProjet` :

```text
AccèsProjet = ProjectTeam ∪ Team.Projets_Access
```

`Team.Projets_Access` est une colonne `Text` ordinaire. Chaque ligne respecte
le format :

```text
NumeroProjet|NomProjet
```

Le numéro est l'identifiant canonique. Plusieurs lignes peuvent conserver les
différents noms d'un même numéro afin de reconnaître les tables historiques qui
n'ont qu'un nom de projet.

Les anciennes colonnes `Projets_Lecture_Structure`,
`Projets_Lecture_Synthese` et `Projets_Lecture_Topographie` ne participent plus
au calcul des droits. Elles ne sont ni migrées ni supprimées automatiquement.

## Matrice d'accès

- une personne non affectée ne voit pas le projet ;
- une ancienne sélection locale interdite est automatiquement rejetée ;
- une personne affectée peut consulter `Structure`, `Synthese` et
  `Topographie` ;
- elle peut modifier uniquement le service défini par `Team.Service` ;
- les deux autres services sont en lecture seule ;
- `Structure` n'a plus d'accès implicite au catalogue complet ;
- `Team.Admin` donne accès à tous les projets ;
- un administrateur modifie son service et consulte les autres en lecture seule.

Une ligne `Team` sans service valide ne donne aucun contexte exploitable.
Une ligne métier dont le service est vide n'est plus interprétée comme
`Structure`.

## Résolution de ProjectTeam.Name

`ProjectTeam.Name` est rapproché de `Team` dans cet ordre :

1. identifiant de ligne lorsque `Name` est une référence Grist vers `Team` ;
2. correspondance normalisée avec `Team.PrenomNom` ;
3. correspondance avec `Team.Prenom + Team.Nom` ;
4. correspondance avec un prénom seul uniquement si ce prénom est unique.

La normalisation ignore la casse, les accents, les espaces répétés et la
ponctuation. Plusieurs lignes `Team` ayant exactement le même nom complet sont
fusionnées en une seule personne : leurs identifiants et emails sont conservés,
et l'accès bénéficie à tous les comptes correspondants. Un prénom correspondant
à plusieurs noms complets distincts reste ambigu. Un nom réellement ambigu ou
inconnu ne donne jamais un accès arbitraire et apparaît dans le diagnostic.

Une référence stable de `ProjectTeam` vers `Team` reste l'évolution recommandée
à terme.

## Widget d'administration

Le point d'entrée est :

```text
gestion-acces-interservices/index.html
```

L'administrateur sélectionne d'abord un projet. L'écran affiche ensuite les
personnes venant de `ProjectTeam`, de `Team.Projets_Access`, ou des deux sources.
Il permet :

- une recherche par numéro ou nom de projet ;
- l'ajout manuel de plusieurs personnes ;
- la consultation du service, du rôle et de la source ;
- la révocation d'un ajout manuel ;
- le diagnostic des noms ProjectTeam non reconnus ou ambigus.

Le widget ne supprime jamais une ligne `ProjectTeam`. Retirer un ajout manuel
ne retire donc pas l'accès si la personne reste présente dans `ProjectTeam`.

La colonne `Team.Projets_Access` doit être créée manuellement avant d'ouvrir le
widget. Aucun changement de schéma n'est effectué silencieusement.

## Runtime partagé

`shared/grist-service-context.js` charge les données brutes nécessaires de
`Team`, `Projets2` et `ProjectTeam` avant d'installer les filtres. Cela évite de
filtrer `ProjectTeam` avant de l'utiliser comme source d'affectation.

Le runtime :

- filtre le catalogue `Projets2` ;
- réconcilie la sélection locale ;
- filtre les tables par projet et service ;
- expose `editable`, `readonly` ou `hidden` ;
- désactive les commandes d'écriture en lecture seule ;
- bloque les mutations protégées ;
- vérifie que les lignes modifiées ou supprimées appartiennent au contexte ;
- injecte le projet et le service dans les créations et modifications ;
- propage les changements d'affectation via `localStorage` et au focus.

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

## Limite de sécurité actuelle

La protection est actuellement réalisée dans les widgets JavaScript. Elle
protège les parcours applicatifs couverts, mais ne remplace pas une sécurité
côté Grist : un utilisateur disposant de droits directs sur le document peut
contourner un contrôle client.

Les permissions avancées seront conçues et activées lors d'une phase ultérieure.
Ne pas présenter le runtime actuel comme une frontière de sécurité serveur.

## Limite de Projets2.Avancement

Les trois services sont stockés dans une même cellule JSON. Le code lit et
modifie uniquement le bloc du service courant, mais une séparation de sécurité
forte nécessiterait une table avec une ligne par `NumeroProjet + Service`.
