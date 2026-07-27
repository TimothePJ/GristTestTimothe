# Préparation et migration des données

Faire une copie du document Grist avant toute modification.

## 1. Colonnes ordinaires requises

Toutes les colonnes ci-dessous sont des colonnes `Text` ordinaires. Aucune
colonne formule ni nouvelle colonne `NumeroProjet` n'est nécessaire dans les
tables historiques identifiées par le nom du projet.

Vérifier la présence de `Service` dans :

- `References2`
- `ListePlan_NDC_COF`
- `Planning_Projet`
- `Envois`
- `Budget`
- `ProjectTeam`
- `TimeSegment`
- `TimeReal`
- `Emetteurs`

Vérifier dans `Team` :

- `Service`
- `Email`, entièrement en minuscules
- `Projets_Lecture_Structure`
- `Projets_Lecture_Synthese`
- `Projets_Lecture_Topographie`

Les trois colonnes `Projets_Lecture_*` restent de type `Text`.

Grist normalise l'adresse des utilisateurs partagés en minuscules. La propriété
utilisateur associe `user.Email` à `Team.Email` par égalité exacte : convertir
toutes les anciennes valeurs de `Team.Email` en minuscules et vérifier qu'il
n'existe qu'une seule ligne par adresse.

## 2. Remplissage des anciennes lignes

Les widgets traitent temporairement une valeur `Service` vide comme
`Structure`, afin de ne pas masquer les anciennes données pendant la migration.
Cette compatibilité est transitoire : remplir explicitement `Service` avant
d'activer les permissions avancées.

Vérifier que les identifiants projet existants sont remplis et correspondent
exactement aux valeurs de `Projets2` :

- `References2.NomProjet`
- `ListePlan_NDC_COF.Nom_projet`
- `Planning_Projet.NomProjet`
- `Envois.Projet`
- `Budget.NumeroProjet`
- `ProjectTeam.NumeroProjet`
- `TimeSegment.NumeroProjet`
- `TimeReal.NumeroProjet`

Un numéro partagé reste un seul groupe d'accès. Lorsque ce numéro possède
plusieurs noms, une ligne `NumeroProjet|NomProjet` est conservée pour chaque
nom afin que les tables historiques puissent toutes être reconnues.

## 3. Budget

L'identité d'une ligne de budget devient :

```text
NumeroProjet + Service + Chapter
```

Vérifier qu'un même chapitre peut exister séparément pour Structure, Synthese
et Topographie.

## 4. Avancement

Le format attendu est :

```json
{
  "version": 2,
  "services": {
    "Structure": [],
    "Synthese": [],
    "Topographie": []
  }
}
```

Les widgets savent encore lire un ancien tableau JSON et l'interprètent comme
`Structure`. Toute nouvelle sauvegarde utilise la version 2 et préserve les
autres services.

Les trois valeurs historiques présentes dans l'export fourni ont été
converties dans
[`AVANCEMENT_V2_A_IMPORTER.csv`](./AVANCEMENT_V2_A_IMPORTER.csv). Ce fichier
contient uniquement `NumeroProjet`, `NomProjet` et la nouvelle valeur
`Avancement`, afin de faciliter une mise à jour contrôlée dans Grist. Les
valeurs d'origine ont été affectées à `Structure`; les deux autres services
ont été initialisés avec des tableaux vides.

Les colonnes suivantes restent communes au projet :

- `Pourcentage_Facturation_Par_Mois`
- `Pourcentage`

## 5. Contrôles avant ACL

- aucune ligne métier ne doit conserver un `Service` vide ;
- les noms et numéros projet existants doivent être remplis ;
- les noms doivent correspondre exactement au libellé enregistré après `|` ;
- les budgets doivent être cohérents par service ;
- les écritures doivent produire `Service`, ainsi que `NumeroProjet` seulement
  dans les tables qui possèdent déjà cette colonne ;
- le scénario ERA QUAI D'ORSAY doit fonctionner avec un utilisateur Synthese
  et un accès Structure.
