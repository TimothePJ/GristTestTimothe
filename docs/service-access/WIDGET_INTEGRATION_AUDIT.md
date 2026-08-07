# Audit des widgets ajoutés au contexte Service

Audit réalisé le 6 août 2026. Les classifications ci-dessous décrivent le
comportement du code du dépôt ; elles ne remplacent pas les ACL Grist.

## Résultat par widget

| Widget | Entrée et `grist.ready()` | Lectures | Écritures / portée | Intégration retenue |
|---|---|---|---|---|
| `creation-projet` | `creation-projet/index.html`, puis `app.js` ; accès `full` | `Emetteurs`, `Team`, `Projets2`, `References2`, variantes `ListePlan_NDC_COF` et `Planning_Projet` | Création coordonnée dans `Projets2`, `Budget`, `ProjectTeam`, `References2`, la liste de plans et le planning ; mise à jour du registre DOP dans `Emetteurs` | Runtime en mode `rest-first`. Les lectures globales, schémas et contrôles de doublons utilisent REST complet puis `fetchTable()` en fallback. `Emetteurs` utilise REST Service lorsque le contexte est complet. Les mutations ne sont ni filtrées ni transformées par le runtime. |
| `MS Project` | `MS Project/Index.html`, puis `assets/js/main.js` ; accès `full` conservé dans `services/gristService.js` | Catalogue `MsProjectNom.Nom` pour la liste ; lignes `MsProject` filtrées pour l'affichage ; `Planning_Projet` pour les correspondances | Remplacement/ajout/mise à jour de `MsProject` ; ajout dédupliqué dans `MsProjectNom` après import réussi ; mise à jour des lignes correspondantes de `Planning_Projet` | Runtime automatique. Au démarrage, seule la petite table `MsProjectNom` est demandée en REST complet, avec fallback `fetchTable()` automatique. Dès qu'une valeur est choisie, les tâches sont demandées avec le filtre REST exact `MsProject.Nom = valeur sélectionnée`, puis filtrées strictement une seconde fois côté client. Le fallback complet de `MsProject` est mis en cache entre sélections et invalidé après mutation. |
| `Time-Out` | `Time-Out/index.html`, puis `assets/js/main.js` ; accès `full` conservé dans `services/gristService.js` | `Team` et la première table disponible parmi `Time-Out`, `Time_Out`, `TimeOut` | Ajout, mise à jour et suppression dans la table Time-Out résolue ; rafraîchissement via `grist.onRecords` | Runtime en mode `rest-first`. `Team` et la table Time-Out utilisent REST complet puis fallback `fetchTable()`, sans filtre Service ou projet inventé. `onRecords` et les mutations historiques restent directs. |
| `gestion-equipe` | `gestion-equipe/index.html`, puis `app.js` ; accès `full` | Section courante via `onRecords`; snapshots globaux de `_grist_Tables`, `_grist_Tables_column`, `Projets2`, `Emetteurs` et de toutes les tables liées au nom/numéro projet (`Planning_Projet`, `References2`, listes de plans, `MsProject`, `Envois`, `Budget`, `ProjectTeam`, `TimeSegment`, `TimeReal`) | CRUD `Team`, registre DOP, DOP projet, renommage/renumérotation et propagation en masse dans toutes les tables liées | Runtime en mode `rest-first`. Tous les snapshots restent complets mais passent d'abord par REST ; `fetchTable()` prend le relais en cas d'échec ou de réponse vide incompatible. Les mutations administratives et `onRecords` restent inchangés. |

## Politique par table

| Table | Politique principale | Filtre confirmé | Repli / justification |
|---|---|---|---|
| `References2` | REST projet + Service | `NomProjet`, `Service` | fallback `fetchTable()` filtré ; REST complet dans les audits globaux |
| `ListePlan_NDC_COF` | REST projet + Service | `Nom_projet`, `Service` | fallback `fetchTable()` filtré ; alias non confirmés en REST complet |
| `Planning_Projet` | REST projet + Service | `NomProjet`, `Service` | fallback RPC filtré côté client |
| `Envois` | REST projet + Service | `Projet`, `Service` | fallback RPC filtré côté client |
| `Budget` | REST projet + Service | `NumeroProjet`, `Service` | fallback RPC filtré côté client |
| `ProjectTeam` | REST projet + Service pour les lectures métier | `NumeroProjet`, `Service` | bootstrap des droits via RPC, puis REST ; fallback `fetchTable()` |
| `TimeSegment` | REST projet + Service | `NumeroProjet`, `Service` | fallback RPC filtré côté client |
| `TimeReal` | REST projet + Service | `NumeroProjet`, `Service` | fallback RPC filtré côté client |
| `Emetteurs` | REST Service uniquement | `Service` | fallback `fetchTable()` filtré ; REST complet dans `gestion-equipe` |
| `Team` | REST complet | aucun filtre serveur | bootstrap des droits via RPC ; autres lectures REST puis fallback `fetchTable()` |
| `Projets2` | REST complet | aucun filtre serveur | bootstrap des droits via RPC ; filtrage client conservé en mode automatique |
| `Time-Out`, `Time_Out`, `TimeOut` | REST complet | aucun | fallback `fetchTable()` ; aucun filtre Service inventé |
| `Timesheet` | REST complet | aucun | fallback `fetchTable()` ; aucun filtre indirect inventé |
| `Ventilation` | REST complet | aucun | fallback `fetchTable()` ; aucun filtre indirect inventé |
| `MsProjectNom` | REST complet au démarrage | aucune colonne de contexte ; lecture de `Nom` uniquement par le widget | fallback `fetchTable()` ; nettoyage, déduplication et tri côté widget |
| `MsProject` | REST filtré pour l'affichage et le remplacement ; REST complet seulement pour les audits administratifs | `Nom` exact choisi dans `projectDropdown` | fallback `fetchTable()` mis en cache, puis filtré strictement sur le même `Nom` ; aucun filtre `Service` ou `NomProjet` inventé |
| `_grist_Tables`, `_grist_Tables_column` | REST complet | aucun | fallback `fetchTable()` pour les métadonnées administratives |
| Variantes/alias non confirmés (`Planning_Project`, listes avec espaces ou `+`) | REST complet | aucun filtre déduit | fallback `fetchTable()` |

Aucune table n'est actuellement configurée en REST « projet uniquement ». Le
noyau sait représenter cette politique et un test garantit qu'elle n'ajouterait
pas de filtre `Service`, mais elle ne sera associée à une table qu'après
confirmation de son schéma et de son identité projet.

## Fallback et versions

- Avec Grist 1.3.3, une indisponibilité REST, une erreur réseau/authentification
  ou une visibilité vide contredite par `fetchTable()` active le fallback RPC.
- Avec Grist 1.7.17 et un compte réel reconnu par les ACL, les tables configurées
  journalisent `[GristData][REST FILTRE]` ou `[GristData][REST COMPLET]`.
- Une table réellement vide reste une réponse REST vide légitime lorsque la
  sonde et `fetchTable()` ne démontrent pas de contradiction.
- Une incohérence vide/non vide déclenche le repli uniquement pour la table
  concernée ; les autres tables retentent REST normalement.
- Le jeton est demandé uniquement avec `getAccessToken({ readOnly: true })`,
  conservé en mémoire, absent des stockages et absent des traces du runtime.

## Mode « Voir en tant que »

Le dépôt ne dispose pas d'une détection client officielle et fiable du mode
« Voir en tant que ». Le RPC peut refléter l'utilisateur simulé tandis que le
jeton REST représente le compte réellement connecté. Aucun `aclAsUser` n'est
ajouté à une URL et aucune identité client n'est utilisée pour usurper un
utilisateur. En conséquence, il ne faut pas valider un scénario « Voir en tant
que » comme une simulation REST : utiliser un vrai compte de test ou forcer le
parcours RPC depuis l'environnement Grist tant qu'une détection officielle
n'est pas disponible.
