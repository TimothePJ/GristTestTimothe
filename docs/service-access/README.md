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

## Chargement REST filtré

Après le calcul des droits, l'interception de `grist.docApi.fetchTable()`
utilise en priorité le point d'accès REST `records` de Grist. Le widget demande
un jeton temporaire avec `getAccessToken({ readOnly: true })`. Ce jeton et sa
promesse de chargement restent uniquement en mémoire, sont renouvelés avant
expiration, puis invalidés et redemandés une seule fois après une réponse
`401` ou `403`. Ils ne sont jamais écrits dans le stockage du navigateur.

Chaque vue qui lit plusieurs tables doit auparavant déclarer
`grist.ready({ requiredAccess: "full" })`. Sans cette demande explicite, Grist
peut délivrer au widget un jeton REST qui ne voit pas le contenu du document,
même si l'appel du jeton lui-même aboutit.

Les tables suivantes sont filtrées côté serveur :

| Table | Filtre projet | Filtre service |
| --- | --- | --- |
| `References2` | `NomProjet` avec tous les alias | `Service` |
| `ListePlan_NDC_COF` | `Nom_projet` avec tous les alias | `Service` |
| `Planning_Projet` | `NomProjet` avec tous les alias | `Service` |
| `Envois` | `Projet` avec tous les alias | `Service` |
| `Budget` | `NumeroProjet` canonique | `Service` |
| `ProjectTeam` | `NumeroProjet` canonique | `Service` |
| `TimeSegment` | `NumeroProjet` canonique | `Service` |
| `TimeReal` | `NumeroProjet` canonique | `Service` |
| `Emetteurs` | aucun | `Service` |

La valeur canonique `Synthese` est envoyée avec la variante historique
`Synthèse`. Toutes les réponses REST sont de nouveau filtrées dans le client
avant livraison au widget.

En mode multiprojets (`Gestion-globale` et `Gestion-User`), le filtre contient
tous les numéros autorisés ou tous les noms et alias autorisés. Les longues
listes sont découpées, chargées avec au plus trois requêtes simultanées, puis
fusionnées dans un ordre stable et dédupliquées par identifiant. Pour un
administrateur dont le filtre dépasserait douze groupes, la requête reste
filtrée côté serveur par le service et le contrôle projet est conservé dans le
client.

Le cache est séparé par table, service, projet ou scope multiprojets, alias et
mode. Son TTL par défaut est de 30 secondes. Il partage les promesses en cours,
accepte `forceRefresh`, ignore les anciennes générations et invalide uniquement
les tables réellement touchées par une mutation.

L'API publique propose :

- `fetchContextTable(tableName, options)` pour le format colonne de
  `fetchTable()` ;
- `fetchContextRows(tableName, options)` pour un tableau de lignes ;
- `watchContextTable(tableName, callback, options)` pour une source filtrée ;
- `invalidateContextTable(tableName)` pour une invalidation ciblée.

Les watchers filtrés remplacent `onRecords` dans `Reference2`, `EnAttente`, les
deux vues concernées de `ListeDePlan`, `Bordereau` et `Avancement`. Ils
rechargent au changement de projet ou de service, après une écriture locale, au
retour de focus et toutes les 30 secondes par défaut. Le polling est suspendu
quand la page est cachée et un seul timer existe par watcher.

## Repli et limites réseau

Le calcul initial des droits charge toujours `Team`, `Projets2` et
`ProjectTeam` en brut. `ProjectTeam` reste donc un chargement initial complet,
même si ses lectures métier ultérieures sont filtrées. `Team` est réutilisée
depuis ce cache de droits. `Projets2` est filtrée localement aux projets
autorisés ; en mode monoprojets, le catalogue autorisé reste disponible pour
ne pas casser les sélecteurs permettant de changer de projet.

`Projets2.Avancement` contient plusieurs services dans une cellule JSON et ne
peut pas être filtré à l'intérieur par REST. Le runtime conserve la lecture et
l'écriture du seul bloc du service actif, avec l'ancien format rattaché à
`Structure`.

Les tables sans colonne `Service` ne reçoivent aucun filtre inventé. Cela
concerne notamment `Team`, `Projets2`, `Time-Out`, `Timesheet` et `Ventilation`.
`Gestion-User` filtre localement les personnes de `Team` par service, puis les
segments par ces personnes. `Time-Out`, `Timesheet` et `Ventilation` conservent
leur chargement historique lorsqu'ils sont utilisés ; aucun filtre indirect
n'est supposé sans schéma fiable.

Avant la première lecture métier REST de chaque jeton, une sonde légère demande
au plus une ligne de `Projets2`, sans cache. Si le catalogue brut déjà chargé
contient des projets mais que le jeton REST répond en HTTP `200` avec
`records: []`, le runtime considère que ce jeton ne voit pas le contenu du
document et active le repli historique pour la session du jeton.
Lorsqu'une lecture métier filtrée est vide malgré une sonde globale réussie,
une seconde vérification limitée à une ligne est faite sur cette table. Si REST
la voit vide alors que `fetchTable()` y voit des lignes, le même repli est
activé. Cette vérification supplémentaire n'a lieu que pour une réponse vide.

Si `getAccessToken`, `fetch` ou l'endpoint REST est indisponible, si le réseau
échoue, si la réponse JSON est invalide ou si cette sonde de visibilité échoue,
le runtime revient à `fetchTable()` puis applique les filtres clients existants.
Un watcher revient de la même façon à `onRecords`. Si le service ou le projet
requis est vide, aucune requête métier complète n'est cependant lancée : une
table vide est retournée immédiatement.

Les versions de Grist antérieures à la correction serveur du 21 mai 2026
traitent le porteur d'un jeton temporaire comme anonyme dans les règles d'accès.
Dans un document dont les règles dépendent de l'identité, REST peut alors
répondre `200` avec `records: []`. Ce défaut ne peut pas être corrigé par
l'hébergement localhost du widget : le serveur Grist doit intégrer la correction
`edd620537f` ou une version ultérieure. En attendant, les tables complètes du
repli sont conservées 30 secondes en mémoire afin qu'un changement de projet ou
de service ne retransfère pas immédiatement les mêmes données.

Cette optimisation diminue le transfert et le traitement dans le navigateur ;
elle ne remplace pas les règles d'accès configurées côté serveur dans Grist.

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
