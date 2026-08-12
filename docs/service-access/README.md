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
- vérifie que les lignes modifiées ou supprimées appartiennent au contexte, en
  s'appuyant d'abord sur les lignes déjà chargées du contexte et en ne rechargeant
  la table complète que pour les identifiants introuvables ;
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
deux vues concernées de `ListeDePlan`, `Bordereau` et `Avancement`.

**Aucune interrogation périodique.** Un rechargement re-livre les lignes, donc
re-rend le widget : le défilement, la sélection et les graphiques repartent de
zéro. Un timer rendrait la page inutilisable. Les watchers se rafraîchissent donc
sur évènement uniquement — écriture locale, changement de projet ou de service,
retour de focus, signal natif Grist — et un widget qui veut malgré tout un timer
passe explicitement `pollIntervalMs`.

Ces déclencheurs n'ont pas la même exigence. Une écriture doit court-circuiter le
cache : ce qui vient d'être écrit doit être relu. Un retour de focus veut
seulement une fraîcheur raisonnable et passe donc par le cache : revenir deux fois
sur l'onglet en dix secondes ne déclenche aucune requête.

**Une livraison n'a lieu que si quelque chose a changé.** Avant de rappeler
l'abonné, le runtime compare une empreinte des lignes livrées (nombre de lignes +
hachage du contenu) combinée au projet, au service et à la source. Empreinte
identique, pas de rappel : un rechargement inutile n'a donc plus d'effet visible.

**Le flux natif `onRecords` sert de signal, dans tous les modes.** Grist pousse
déjà les modifications du document vers chaque client ouvert : écouter ce flux ne
coûte aucune requête, c'est le rafraîchissement le moins cher disponible. Il ne
fournit jamais les lignes — la section hôte n'est plus forcément la table
surveillée — il invalide les copies en cache de la table surveillée puis déclenche
une relecture, filtrée comme les autres.

Portée exacte : ce flux ne signale que les changements de **la table source de la
section**. Un widget dont la section est posée sur `Projets2` est donc prévenu des
écritures dans `Projets2`, pas de celles faites dans `ListePlan_NDC_COF` ou
`References2`. Pour couvrir ces dernières sans interrogation périodique, il faut
que la section repose sur une table qui bouge avec elles — une table de synthèse
du domaine surveillé.

## Revalidation conditionnelle

Chaque lot REST mémorise l'`ETag` renvoyé par Grist. Tout rechargement ultérieur
du même lot renvoie cet `ETag` dans un en-tête `If-None-Match` et force
`cache: "no-store"`, afin que le navigateur ne transforme pas un `304` serveur en
`200` servi localement.

Deux cas :

- le serveur répond `304` : aucun corps n'est transmis, les enregistrements déjà
  détenus sont réutilisés tels quels ;
- le serveur répond `200` : les nouvelles lignes remplacent celles du lot.

Les lots sont appariés par position, et les `ETag` mémorisés ne sont réutilisés
que si le découpage du filtre est rigoureusement identique. Un filtre découpé
autrement, un repli `fetchTable()` ou une invalidation de table rompent la chaîne
et le passage suivant repart d'un chargement complet.

Lorsque **tous** les lots répondent `304`, la table précédente est réutilisée sans
refiltrage, la trace `[GristData][REST INCHANGE]` est émise, et les abonnés ne
sont pas re-notifiés : le widget ne se re-rend pas inutilement. Un service depuis
le cache reste en revanche une livraison normale.

Le coût d'un rechargement cesse ainsi de dépendre de la taille de la table : une
relecture qui ne trouve aucun changement coûte quelques centaines d'octets au lieu
d'une réponse complète.

Ce mécanisme suppose que Grist émette un `ETag` sur `/records`. S'il n'en émet
pas, `revalidations` reste à `0` dans les traces et chaque relecture retélécharge
la tranche complète — sans erreur, mais sans économie. Les rechargements étant
désormais déclenchés par évènement et non par un timer, leur fréquence reste
faible dans les deux cas.

Comme le filtre projet et service fait partie de l'URL, l'`ETag` ne porte que sur
la tranche demandée : une modification faite sur un autre projet laisse la
réponse inchangée, et l'utilisateur concerné ne retélécharge rien.

## Rafraîchissement sans rechargement

Une modification doit s'afficher immédiatement, sans que l'utilisateur recharge
la page. Trois maillons y concourent, et il faut les trois : l'absence d'un seul
ramène le symptôme « il faut recharger pour voir ».

**1. Le widget déclare les tables dont dépend son affichage.**
`watchContextTables(tables, rendu)` enregistre une surveillance par table, groupe
les livraisons rapprochées en un seul rendu, et ignore la première livraison de
chaque table — le widget vient de dessiner ces données. Un widget qui ne surveille
que sa table principale reste figé quand une table secondaire change : le tableau
de bord d'avancement croise cinq tables, le suivi des dépenses sept.

**2. Une écriture rafraîchit dans les deux modes d'intégration.**
En mode `automatic`, `applyUserActions` est détourné pour réécrire les actions et
appliquer les gardes de service. En mode `rest-first` il ne l'est pas, et ce
n'est pas un oubli : les widgets d'administration écrivent sans réécriture ni
filtre. La conséquence tenait de l'angle mort — rien n'invalidait les copies
locales après l'écriture, et l'écran gardait l'état d'avant. Les deux modes
partagent désormais la même reprise après écriture ; seule la réécriture des
actions reste propre au mode `automatic`.

**3. L'écriture est annoncée aux widgets voisins.**
Deux widgets côte à côte sur une page Grist sont deux iframes : ni les caches ni
les surveillances de l'un n'atteignent l'autre. Après chaque écriture, la liste
des tables modifiées est publiée dans `localStorage` sous
`grist.service-context.data-changed`. Chaque runtime à l'écoute invalide ces
tables et ne réveille que les surveillances concernées. Le signal ne sort pas du
navigateur : il ne coûte rien au serveur.

`gestion-acces-interservices` lit les tables sans filtre et ne charge donc pas le
runtime ; il écoute directement ce même signal, avec la même clé.

### Ce que ce dispositif ne couvre pas

La modification d'un **autre utilisateur** n'emprunte aucun de ces trois chemins :
elle n'est ni une écriture locale, ni un signal du même navigateur. Elle n'arrive
que par le flux natif de Grist, que le runtime utilise comme signal de changement
— et ce flux ne concerne que la table source de la section hôte. Pour les autres
tables, la modification distante apparaît au retour de focus, qui traverse le
cache de 30 secondes.

Aucune minuterie n'est armée nulle part : le défaut d'intervalle de surveillance
vaut zéro, et deux tests de contrat interdisent à un widget de rouvrir un
`setInterval` ou de reprendre l'abonnement natif à son compte.

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
segments par ces personnes. Ces tables utilisent REST complet sans filtre
serveur, puis reviennent à `fetchTable()` si REST est indisponible ou incohérent.
Aucun filtre indirect n'est supposé sans schéma fiable.

Le widget MS Project n'embarque pas le runtime Projet/Service. Le chargement des
tâches utilise une requête REST autonome avec un filtre exact sur
`MsProject.Nom`, avec la valeur choisie dans `projectDropdown`. La défense
cliente applique ensuite une égalité stricte sur le même nom et il n'existe
aucun fallback complet sur `MsProject`. La liste est alimentée exclusivement par
la petite table `MsProjectNom` (colonne texte `Nom`) via
`fetchTable("MsProjectNom")`. Les valeurs sont
nettoyées, les vides ignorés, les doublons supprimés et le résultat trié.
L'ouverture du widget ne demande donc jamais `MsProject`. Après la réussite des
écritures d'un import, le nom est ajouté à `MsProjectNom` uniquement s'il est
absent ; un remplacement portant le même nom ne crée aucune ligne de catalogue.
Le cache local de `MsProjectNom` est invalidé après ces mutations. Aucun filtre
`Service` ou `NomProjet` n'est inventé pour ces tables.

Avant la première lecture métier REST de chaque jeton, une sonde légère demande
au plus une ligne de `Projets2`, sans cache. Si le catalogue brut déjà chargé
contient des projets mais que le jeton REST répond en HTTP `200` avec
`records: []`, le runtime considère que ce jeton ne voit pas le contenu du
document et active le repli historique pour la session du jeton.
Lorsqu'une lecture métier filtrée est vide malgré une sonde globale réussie,
une seconde vérification limitée à une ligne est faite sur cette table. Si REST
la voit vide alors que `fetchTable()` y voit des lignes ou un schéma nécessaire,
le repli est activé uniquement pour cette table. Les autres tables continuent
de tenter REST. Cette vérification supplémentaire n'a lieu que pour une réponse
vide.

Lorsqu'un endpoint de table répond avec une erreur REST avérée ou une réponse
inexploitable (colonne obligatoire absente), cette indisponibilité est mémorisée
pour la session. Les sélections suivantes passent directement par le snapshot
`fetchTable()` en cache, sans répéter en boucle le même appel REST en échec.

Si `getAccessToken`, `fetch` ou l'endpoint REST est indisponible, si le réseau
échoue, si la réponse JSON est invalide ou si cette sonde de visibilité échoue,
le runtime revient à `fetchTable()` puis applique les filtres clients existants.
Le watcher continue de lire la table surveillée, par `fetchTable()` cette fois.
Son abonnement `onRecords` reste ce qu'il est en REST : un signal, pas une source
de lignes. Si le service ou le projet requis est vide, aucune requête métier
complète n'est cependant lancée : une table vide est retournée immédiatement.

Sur un serveur ancien, notamment Grist 1.3.3, un jeton temporaire peut apparaître
anonyme aux règles d'accès identitaires et REST peut répondre `200` avec
`records: []`. Une réponse vide ne prouve cependant pas à elle seule cette cause :
REST peut être indisponible, la table peut ne pas être visible avec ce jeton ou
la table peut être réellement vide. Le runtime journalise donc une explication
neutre et active le repli RPC seulement lorsqu'une erreur ou la comparaison avec
`fetchTable()` le justifie. Les tables complètes du repli sont conservées 30
secondes en mémoire afin qu'un changement de projet ou de service ne retransfère
pas immédiatement les mêmes données.

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
- `creation-projet` (REST-first complet ; mutations préservées)
- `MS Project` (catalogue `MsProjectNom` ; tâches `MsProject` filtrées par `Nom` sélectionné)
- `Time-Out` (REST complet sans filtre inventé)
- `gestion-equipe` (snapshots REST complets ; mutations préservées)

Le mode `rest-first` garde les snapshots globaux de `creation-projet`,
`Time-Out` et `gestion-equipe` complets. Il remplace leurs lectures par
REST + fallback sans jamais réécrire leurs actions d'écriture ni leur imposer un
contrôle de service. Leurs mutations passent malgré tout par une enveloppe
minimale : elle appelle l'écriture telle quelle, puis invalide les copies locales
des tables touchées et prévient les widgets voisins. Sans elle, l'écran resterait
sur l'état d'avant l'écriture jusqu'au rechargement de la page. L'audit détaillé est dans
[WIDGET_INTEGRATION_AUDIT.md](./WIDGET_INTEGRATION_AUDIT.md).

Le mode Grist « Voir en tant que » ne modifie que la session RPC ; le jeton REST
reste celui du compte réellement connecté. Aucune détection client officielle et
fiable n'est utilisée actuellement. Le runtime n'ajoute jamais `aclAsUser` et ne
prétend pas simuler l'utilisateur sélectionné via REST.

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
