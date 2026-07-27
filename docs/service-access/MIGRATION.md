# Préparation et migration des données

Faire une copie du document Grist avant toute modification.

## 1. Colonnes ordinaires requises

Toutes les colonnes ci-dessous sont des colonnes `Text` ordinaires. Aucune
colonne formule n'est nécessaire.

Ajouter `NumeroProjet` si elle n'existe pas dans :

- `References2`
- `ListePlan_NDC_COF`
- `Planning_Projet`
- `Envois`

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
- `Projets_Lecture_Structure`
- `Projets_Lecture_Synthese`
- `Projets_Lecture_Topographie`

Les trois colonnes `Projets_Lecture_*` restent de type `Text`.

## 2. Remplissage des anciennes lignes

Les widgets traitent temporairement une valeur `Service` vide comme
`Structure`, afin de ne pas masquer les anciennes données pendant la migration.
Cette compatibilité est transitoire : remplir explicitement `Service` avant
d'activer les permissions avancées.

Pour les quatre nouvelles colonnes `NumeroProjet` :

1. retrouver le projet grâce au nom existant ;
2. copier `Projets2.Numero_de_projet` ;
3. ne pas convertir automatiquement un nom correspondant à plusieurs numéros ;
4. traiter manuellement les noms ambigus, notamment les variantes de `TMM` et
   `Test`.

Plusieurs noms portant le même numéro restent un seul groupe d'accès.

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
- les nouvelles colonnes `NumeroProjet` doivent être remplies ;
- les lignes ambiguës doivent avoir été corrigées manuellement ;
- les budgets doivent être cohérents par service ;
- les écritures depuis chaque widget doivent produire `Service` et
  `NumeroProjet` ;
- le scénario ERA QUAI D'ORSAY doit fonctionner avec un utilisateur Synthese
  et un accès Structure.
