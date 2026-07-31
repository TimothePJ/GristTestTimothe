# Préparation des données

Faire une copie du document Grist avant toute modification manuelle.

## 1. Team.Projets_Access

Créer dans `Team` une colonne ordinaire :

```text
Projets_Access
```

Type : `Text`.

Le widget d'administration vérifie sa présence et refuse de démarrer si elle
manque. Il ne crée pas la colonne automatiquement.

Une cellule peut contenir plusieurs lignes :

```text
252035|ERA QUAI D'ORSAY
222073|AUTRE PROJET
```

Les anciennes colonnes `Projets_Lecture_*` peuvent être conservées pour
historique, mais elles ne donnent plus aucun accès. Aucune migration automatique
ou suppression n'est réalisée.

## 2. Identité des personnes

Vérifier dans `Team` :

- des noms complets cohérents pour une même personne ;
- `PrenomNom`, ou à défaut `Prenom` et `Nom` ;
- un `Service` parmi `Structure`, `Synthese`, `Topographie` ;
- `Email` en minuscules lorsque cette colonne sert à l'identité Grist ;
- une colonne `Moi` permettant de retrouver la ligne courante.

Plusieurs lignes portant exactement le même nom complet, par exemple pour deux
emails, sont fusionnées et reçoivent toutes l'accès. Les prénoms seuls ne sont
acceptés que lorsqu'ils désignent un seul nom complet. Corriger les vrais noms
ambigus et les entrées sans correspondance signalées par le widget.

À terme, remplacer la correspondance de texte par une référence stable vers
`Team`.

## 3. Projets

Vérifier dans `Projets2` :

- `Numero_de_projet` rempli ;
- `Nom_de_projet` rempli ;
- les numéros identiques représentent un même groupe d'accès ;
- les différents noms d'un même numéro sont des alias légitimes.

Les comparaisons de numéro sont exactes : `2520` ne correspond pas à `252035`.

## 4. Données par service

Vérifier la présence d'un `Service` valide dans :

- `References2`
- `ListePlan_NDC_COF`
- `Planning_Projet`
- `Envois`
- `Budget`
- `ProjectTeam`
- `TimeSegment`
- `TimeReal`
- `Emetteurs`

Une valeur vide n'est plus traitée comme `Structure`. La colonne
`ProjectTeam.Service` reste une propriété de la ligne métier ; le droit
d'écriture de la personne dépend de `Team.Service`.

## 5. Contrôles fonctionnels

Tester au minimum :

1. une personne Structure sans affectation ne voit aucun projet ;
2. une affectation ProjectTeam ouvre le projet ;
3. une affectation Projets_Access ouvre le projet ;
4. les deux sources ne créent pas de doublon ;
5. le service personnel est modifiable ;
6. les deux autres services sont en lecture seule ;
7. une révocation manuelle fait disparaître le projet sauf présence ProjectTeam ;
8. un nom ProjectTeam ambigu ne donne aucun accès ;
9. une sélection locale révoquée est remplacée ou vidée ;
10. deux lignes du même nom complet affichent leurs deux emails et reçoivent l'accès ;
11. un administrateur voit tous les projets ;
12. `2520` ne donne jamais accès à `252035`.

## 6. Sécurité

Cette migration prépare uniquement la protection JavaScript des widgets. Elle
n'ajoute aucune permission avancée Grist. La sécurité serveur fera l'objet d'une
phase séparée.
