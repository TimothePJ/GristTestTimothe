# Dossier source — Plateforme d'applications Grist du bureau d'études

> **Nature de ce document.** Ce n'est pas le document final. C'est le **dossier
> source** : l'analyse complète de la plateforme telle qu'elle fonctionne
> aujourd'hui, destinée à être mise en forme par un rédacteur (humain ou IA)
> pour produire le document qui sera transmis au service informatique.
>
> **Objet du document final** : le service informatique **découvre l'existence
> de cette plateforme**. L'objectif, tel que formulé par l'auteur, est
> **« qu'il sache ce qui est fait »**. Le document est donc avant tout
> **informatif** : expliquer ce qui a été construit, pourquoi, comment cela
> fonctionne, ce que cela apporte, et où sont les limites — sans rien demander.
> Ce n'est ni un appel d'offres, ni une commande de développement, ni une
> demande de moyens.
>
> **Périmètre d'analyse** : **branche `main` exclusivement**, c'est-à-dire ce qui
> est réellement déployé et utilisé. Les travaux en cours sur les branches de
> développement sont volontairement exclus.
>
> Version : 2026-08-07 · 15 applications + socle commun

---

## 0. Notice pour le rédacteur

### 0.1 Le cadrage, en une phrase

> Un collaborateur du bureau d'études a construit, seul, sur deux ans, une
> plateforme de 15 applications métier qui tourne aujourd'hui en production pour
> une vingtaine d'utilisateurs. Le service informatique ne le sait pas. Ce
> document le lui présente.

### 0.2 Conséquences sur la rédaction

| Principe | Application |
|---|---|
| **Pédagogie avant tout** | Le lecteur ne connaît ni le métier du bureau d'études, ni Grist, ni ce qui a été construit. Chaque notion doit être introduite. |
| **Informer, pas demander** | L'objectif est que le service informatique **sache**. Aucune demande de moyens, de budget, de validation ou de reprise. |
| **Transparence** | Les limites, les raccourcis et les points d'attention sont énoncés par l'auteur lui-même. C'est ce qui rend le document crédible. |
| **Démontrer la maîtrise** | La plateforme est documentée, testée par endroits, conçue avec méthode. Le document doit le montrer factuellement, sans autopromotion. |
| **Ouvrir la porte, sans forcer** | Les points techniques sensibles sont exposés en indiquant qu'un avis serait le bienvenu — jamais sous forme d'exigence. |

### 0.3 Structure suggérée du document final

1. **Note de synthèse** (2 pages) — de quoi s'agit-il, pourquoi cela existe, où
   en est-on, ce qui est demandé.
2. **Le besoin métier** — ce que faisait le bureau d'études avant, ce qui posait
   problème.
3. **Ce qui a été construit** — vue d'ensemble des 15 applications.
4. **Comment cela fonctionne** — architecture, Grist, déploiement.
5. **Le modèle de données** — les tables et leurs relations.
6. **La gestion des accès** — état actuel et sa limite principale.
7. **Description détaillée des 15 applications**
8. **Règles de gestion métier** — ce qui est automatisé.
9. **Qualité, tests et documentation existants**
10. **Limites connues et points d'attention**
11. **Points ouverts à l'avis du service informatique**
12. **Questions restant à trancher**
13. **Annexes**

### 0.4 Marquages utilisés

- `[FACTUEL]` — vérifié dans le code de la branche `main` ou dans la
  documentation du dépôt.
- `[INFÉRÉ]` — déduit de la structure du code, à formuler avec prudence.
- `[À TRANCHER]` — décision ou vérification restant à faire.

### 0.5 Décisions de cadrage déjà prises

`[FACTUEL]` — arbitrages confirmés par l'auteur de la plateforme :

| Sujet | Décision |
|---|---|
| **Objectif** | **Que le service informatique sache ce qui est fait.** Document informatif, aucune demande. |
| Lecteur | Le **service informatique** |
| Socle technique | **Grist est conservé** |
| Version Grist | 1.3.3 aujourd'hui, montée prévue — **information de contexte, ne pas en faire un sujet du document** |
| Périmètre décrit | **État courant de la plateforme**, chantier de synchronisation inter-widgets inclus (terminé, en attente de fusion vers `main`) |
| Lecture des données | **REST Grist en premier**, avec repli automatique sur l'API historique `fetchTable()` — cf. §6.9 bis |
| Synchronisation inter-widgets | **Colonnes-signal dans `Projets2`** (7 colonnes `*_Sync`), sans interrogation périodique — cf. §8.1 |
| Traitement des 15 applications | **À plat**, sans hiérarchisation par fréquence d'usage |
| Dossiers hérités | **Hors périmètre** — conservés uniquement comme traces historiques |
| Situation antérieure | **Fichiers Excel** : macros cassées, duplication de fichiers non mis à jour |
| Mise en service | `Reference2` (données d'entrée) : **plus d'un an** · les 14 autres : **environ un mois et demi** |
| Utilisateurs | **~20 personnes**, **4 projets**, **service Structure uniquement** ; déploiement au tout début |
| Extension | Construite pour le service Structure, **en cours d'extension à tous les autres services** : Méthodes, Topographie, Synthèse, etc. |
| Collaborateurs externes | **Aucun** n'accède à la plateforme |
| Documentation utilisateur | **Existe** — manuel PDF couvrant l'ensemble de la plateforme, sur le partage réseau du service |
| Soutien hiérarchique | **Acquis** — chefs du service et niveau supérieur favorables |
| Développement | **Un seul contributeur** |
| Règles d'accès serveur | **Seules celles de `Time-Out` sont configurées** dans Grist |
| Applications hors filtrage projet/service | **Choix assumé** pour `creation-projet`, `MS Project`, `Time-Out`, `gestion-equipe` |
| Validation des congés | **Volontairement absente**, de façon durable |
| Table `Ventilation` | **N'existe plus** — référence morte dans le code |

**Sujets à ne pas aborder dans le document** — décisions de cadrage explicites :

| Sujet exclu | Raison |
|---|---|
| Hébergement et administration du serveur Grist | Géré par le tuteur de l'auteur, hors de son périmètre |
| Hébergement du dépôt de code | Décision de cadrage |
| Données personnelles / RGPD | Décision de cadrage |
| Jours fériés dans `Time-Out` | Décision de cadrage |
| Identité nominative des administrateurs | Parler d'« administrateurs / responsables » sans nommer ni chiffrer |
| Les trois logos du dossier `Bordereau` | Sans objet |

---

## 1. Contexte

### 1.1 Le métier

`[INFÉRÉ]` — reconstitué à partir du vocabulaire, des tables et des écrans.

Un bureau d'études travaux produit, pour chaque projet de construction, des
**documents d'études** : plans de coffrage, plans d'armature, notes de calcul,
plans de démolition, fonds de plans, coupes et détails. Chaque document existe
en plusieurs **indices** (versions successives : `0`, `A`, `B`, `C`…) et est
rattaché à une **zone** du projet.

La production de ces documents dépend de **données d'entrée** fournies par des
tiers (architecte, géomètre, bureau de contrôle, entreprise). Certaines sont
**bloquantes** : sans elles, le plan ne peut pas être produit. Le suivi de ces
données d'entrée, de leur date limite et de leur retard est une activité de
pilotage à part entière.

Les documents produits sont ensuite **transmis** aux destinataires via des
**bordereaux de transmission** numérotés.

En parallèle, il faut piloter l'**économie** du projet (budget par chapitre,
dépenses prévisionnelles et réelles, facturation mensuelle) et les
**ressources** (qui travaille sur quoi, combien de jours, quand, avec quelles
absences).

Enfin, le **planning d'études** doit rester cohérent avec le **planning
travaux** du chantier, généralement produit sous Microsoft Project.

### 1.2 Ce qui existait avant

`[FACTUEL]` — confirmé par l'auteur.

**Avant la plateforme, tout se faisait sur des fichiers Excel.**

Deux difficultés concrètes sont citées par l'auteur :

1. **Des macros cassées.** Les classeurs reposaient sur des macros qui se
   dégradaient avec le temps — changements de version d'Excel, copies partielles,
   modifications par différents utilisateurs. Une macro cassée bloque un
   processus entier et personne n'est en mesure de la réparer.
2. **La duplication de fichiers non mis à jour.** Chacun travaillait sur sa
   copie ; les versions divergeaient et l'on ne savait plus laquelle faisait foi.

C'est le point de départ à mettre en tête du document : la plateforme n'est pas
née d'une envie technique, mais du besoin de sortir d'une gestion sur tableurs
devenue fragile.

> **Angle à exploiter dans la rédaction** : les deux problèmes cités sont
> exactement ceux qu'une base de données partagée résout par construction —
> une seule source de données, pas de copie, pas de macro. Cela justifie le
> choix de Grist sans avoir à argumenter davantage.

Autres éléments de contexte présents dans le dépôt :

- Un dossier `import-access-grist/` existe, ce qui suggère qu'une base Microsoft
  Access a aussi été concernée. `[INFÉRÉ]`
- Deux fichiers HTML monolithiques à la racine (`Affichage.html`,
  `AffichageGantt.html`) constituent une première génération d'outils.
- Le premier commit date du **6 septembre 2024**.

### 1.3 État actuel

`[FACTUEL]`

| Indicateur | Valeur |
|---|---|
| Développement démarré | septembre 2024 |
| **`Reference2` en usage réel depuis** | **plus d'un an** |
| **Les 14 autres applications mises à disposition depuis** | **environ un mois et demi** |
| Dernière évolution déployée | août 2026 |
| Commits | 887 |
| Utilisateurs | ~20 |
| **Projets gérés sur la plateforme** | **4** — le déploiement ne fait que commencer |
| Services couverts | **`Structure` uniquement** (extension en cours) |
| Collaborateurs externes | aucun |
| Applications en production | 15 |
| Lignes de code | ~104 200 |
| Fichiers source | 164 |
| Fichiers de tests | 50 (352 tests, tous au vert) |
| Contributeurs | 1 |

**Nuance importante à faire passer** `[FACTUEL]` : la mise en service s'est faite
en deux temps.

- **`Reference2`** (suivi des données d'entrée) est en usage réel **depuis plus
  d'un an**. C'est donc la brique **éprouvée** de la plateforme : plus d'un an
  d'utilisation quotidienne, sur le sujet le plus sensible du bureau d'études.
- **Les 14 autres applications** n'ont été mises à disposition qu'il y a
  **environ un mois et demi**. Elles sont donc **fonctionnellement complètes
  mais peu éprouvées en usage**.

Cette distinction est honnête et utile : elle explique pourquoi certaines
briques sont très abouties et pourquoi les retours d'usage restent à venir sur
la majorité du périmètre.

Le développement se fait par **branches de fonctionnalité et pull requests**
(`feature/Filtre_Service_Projet`, `feature/Forcer_Cloture_Plan`,
`feature/Modifier_Dupplication`…), avec une documentation de conception écrite
**avant** implémentation (`docs/superpowers/specs/` puis
`docs/superpowers/plans/`).

**Message à faire passer** : ce n'est pas un bricolage. C'est un développement
mené avec méthode, mais par une seule personne et hors du cadre informatique de
l'entreprise.

### 1.4 Pourquoi ce document maintenant

**Le déclencheur, en une phrase** `[FACTUEL]` : la plateforme a été construite
**pour le seul service Structure**, et elle est **en cours d'extension à tous
les autres services du bureau d'études** — Méthodes, Topographie, Synthèse et
les suivants. Elle sort donc du périmètre d'un service pour devenir un **outil
transverse** : il est normal que le service informatique en soit informé.

Deux éléments de calendrier rendent le moment opportun :

1. **Le déploiement ne fait que commencer** — 4 projets, une vingtaine
   d'utilisateurs, un seul service. Le périmètre fonctionnel est stabilisé, mais
   rien n'est encore figé à grande échelle.
2. **L'ouverture à d'autres services** transforme le cloisonnement
   projet/service, aujourd'hui construit en anticipation, en question réelle.

> **Formulation suggérée pour la note de synthèse** : « J'ai développé, pour le
> service Structure, une plateforme de 15 applications qui remplace notre
> gestion sur fichiers Excel. Elle est aujourd'hui utilisée sur 4 projets par
> une vingtaine de personnes, et nous commençons à l'étendre à d'autres
> services. Je souhaitais vous présenter ce qui a été fait, comment cela
> fonctionne, et les points techniques dont j'ai conscience. »

`[INFÉRÉ]` — À mentionner brièvement, sans en faire un argument : cette
démarche s'inscrit dans un cadre où l'auteur poursuit le développement de la
plateforme pour d'autres services. La hiérarchie du service et le niveau
supérieur soutiennent la démarche.

---

## 2. Périmètre

### 2.1 Les 15 applications

`[FACTUEL]` — lignes de code sur `main`

| # | Application | LOC | Rôle en une phrase |
|---|---|---|---|
| 1 | `gestion-depenses2` | 19 305 | Gestion économique complète d'un projet |
| 2 | `Planning Projet` | 16 770 | Planning de production documentaire |
| 3 | `ListeDePlan` | 11 664 | Liste des plans et éditions PDF |
| 4 | `Reference2` | 11 089 | Suivi des données d'entrée |
| 5 | `planning-synchro` | 10 650 | Planning + plan de charge sur une frise unique |
| 6 | `MS Project` | 6 110 | Import et visualisation du planning travaux |
| 7 | `Time-Out` | 4 268 | Congés et absences |
| 8 | `creation-projet` | 3 910 | Assistant de création de projet |
| 9 | `Avancement` | 2 740 | Tableau de bord d'avancement |
| 10 | `Gestion-globale` | 2 724 | Vue consolidée multiprojets |
| 11 | `Gestion-User` | 2 540 | Taux d'occupation des collaborateurs |
| 12 | `Bordereau` | 2 392 | Bordereaux de transmission |
| 13 | `gestion-equipe` | 2 358 | Administration de l'équipe et des projets |
| 14 | `EnAttente` | 1 879 | Tableau de bord des données d'entrée manquantes |
| 15 | `gestion-acces-interservices` | 1 175 | Administration des affectations projet/personne |
| — | `shared` (socle commun) | 4 656 | Contexte projet/service, chargement REST et synchronisation |
| | **Total** | **~104 200** | |

### 2.2 Hors périmètre

`[FACTUEL]` — décision de l'auteur : **ne pas prendre en compte**. Ces dossiers
sont conservés dans le dépôt uniquement à titre de trace historique.

```
gestion-depenses/, gestion-depenses3/      versions antérieures de gestion-depenses2
Synchro/, synchronisation-plannings/       ancêtres de planning-synchro
Gestion-Prev/                              jumeau de Gestion-User
Gantt/, calendar/, event-stats/,
timeline-calendar/                         widgets génériques / anciens
Affichage.html, AffichageGantt.html        première génération d'outils
```

**Le document final doit le dire explicitement** pour éviter que le service
informatique ne s'inquiète en découvrant 26 dossiers là où 15 sont vivants.

---

## 3. Comment cela fonctionne

### 3.1 Le principe : des « widgets » Grist

`[FACTUEL]` — Notion à introduire, le lecteur ne connaissant probablement pas
Grist.

**Grist** est un tableur-base de données collaboratif. Il permet d'insérer dans
une page des **widgets personnalisés** : des pages web développées séparément,
affichées dans une iframe à l'intérieur de Grist, et qui dialoguent avec le
document via une API.

Chaque application de la plateforme est un tel widget :

```
┌─────────── Document Grist ────────────────────────────────┐
│  Tables : Projets2, Team, Planning_Projet, Budget, …      │
│                                                            │
│  ┌──── Page « Planning » ─────────────────────────────┐   │
│  │  ┌── iframe ──────────────────────────────────┐    │   │
│  │  │  Application « Planning Projet »           │    │   │
│  │  │  (HTML + JavaScript hébergés à part)       │    │   │
│  │  │        ▲                    │              │    │   │
│  │  │        │ lecture            │ écriture     │    │   │
│  │  └────────┼────────────────────┼──────────────┘    │   │
│  └───────────┼────────────────────┼───────────────────┘   │
│              └─── API Grist ──────┘                       │
└───────────────────────────────────────────────────────────┘
```

Séquence type au démarrage d'un widget :

1. `grist.ready({ requiredAccess: "full" })` — le widget déclare avoir besoin
   d'accéder à l'ensemble du document (nécessaire dès qu'il lit plusieurs
   tables).
2. `grist.docApi.fetchTable("<table>")` — lecture d'une table.
3. `grist.docApi.applyUserActions([...])` — écriture (`AddRecord`,
   `UpdateRecord`, `RemoveRecord`, `BulkUpdateRecord`).
4. `grist.onRecords(...)` — abonnement aux changements de la table courante.

**Point structurant à expliquer clairement** : un widget s'exécute avec **les
droits de l'utilisateur connecté sur le document Grist**. Ce que le widget
affiche ou masque relève de l'ergonomie ; ce que l'utilisateur a *le droit* de
voir relève des règles d'accès configurées dans Grist. Voir §6.

### 3.2 Choix techniques

`[FACTUEL]`

| Couche | Choix | Conséquence |
|---|---|---|
| Base de données | **Grist**, un seul document | Aucun backend propre à développer et à héberger |
| Langage | **JavaScript natif**, modules ES | Pas de framework, pas de dépendance à un écosystème |
| Build | **aucun** | Le code déployé est le code écrit — lisible et auditable, mais non optimisé |
| Dépendances | **CDN publics** | Pas de gestionnaire de paquets, pas de fichier de verrouillage |
| Tests | `node --test` | 37 fichiers, exécution manuelle |
| Déploiement | Automatisé au push sur `main` | Pas d'étape de validation intermédiaire |

**Ce que ces choix ont apporté** : une plateforme complète développée par une
personne, sans infrastructure à monter, sans chaîne de build à maintenir, et
dont le code reste directement lisible.

**Ce qu'ils coûtent** : pas de gestion des versions de dépendances, pas
d'environnement de recette, pas d'exécution automatique des tests. Ce sont
précisément les points sur lesquels un accompagnement est utile (§11).

### 3.3 Bibliothèques tierces

`[FACTUEL]` — chargées depuis des CDN publics au démarrage de chaque page :

| Bibliothèque | Usage | Version épinglée |
|---|---|---|
| `grist-plugin-api.js` | API widget Grist | non |
| `vis-timeline` | frises chronologiques (3 applications) | **non** |
| `Chart.js` | graphiques (5 applications) | **non** |
| `chartjs-plugin-datalabels` | étiquettes de graphiques | partiellement |
| `flatpickr` (+ locale `fr`) | sélecteurs de dates | **non** |
| `jsPDF` | génération PDF | oui — `2.5.1` |
| `jspdf-autotable` | tableaux dans les PDF | oui — `3.5.23` |
| `html2canvas` | capture d'écran pour PDF | partiellement — `1.4.1` |

**Conséquence à signaler** : une mise à jour majeure publiée par l'éditeur de
`vis-timeline` ou de `Chart.js` peut modifier le comportement des applications
**sans aucune intervention ni déploiement de notre côté**. C'est le point le
plus simple à corriger (épinglage des versions) et un bon premier sujet de
collaboration.

### 3.4 Déploiement

`[FACTUEL]`

```
Push sur la branche main
        ↓
Chaîne d'intégration automatique
        ↓
Publication des fichiers statiques
        ↓
URLs référencées dans Grist comme widgets personnalisés
```

Caractéristiques :
- Déclenchement : **push sur `main`**, ou lancement manuel.
- Un seul déploiement à la fois ; ceux en cours ne sont pas interrompus.
- **Aucun test n'est exécuté** avant publication.
- **Aucun environnement de recette** : ce qui est poussé sur `main` est
  immédiatement en service.

**Point à présenter honnêtement** : le développement passe par des branches et
des pull requests, ce qui donne une relecture ; mais il n'existe pas d'étape de
validation automatisée ni de préproduction.

### 3.5 Organisation du code

`[FACTUEL]` — deux générations coexistent.

**Génération 1 — une page, un gros script** (8 applications : `Reference2`,
`ListeDePlan`, `Bordereau`, `EnAttente`, `creation-projet`, `gestion-equipe`,
`gestion-acces-interservices`, `Avancement`)

```
<application>/
  index.html
  app.js | script.js        (1 000 à 4 000 lignes)
  style.css
```

**Génération 2 — découpage en modules** (7 applications : `Planning Projet`,
`MS Project`, `gestion-depenses2`, `planning-synchro`, `Time-Out`,
`Gestion-User`, `Gestion-globale`)

```
<application>/
  index.html
  assets/css/{variables,styles,timeline}.css
  assets/js/
    config.js        identifiants des tables et colonnes, constantes
    state.js         état applicatif + mémorisation locale
    main.js          démarrage et orchestration
    services/        accès aux données, règles métier
    ui/              affichage et interactions
    utils/           fonctions pures (dates, formats, calculs)
  tests/             tests unitaires
```

La génération 2 est le modèle vers lequel converger. `[INFÉRÉ]`

### 3.6 Partage de code entre applications

`[FACTUEL]` — trois mécanismes coexistent :

| Mécanisme | Exemple | Inconvénient |
|---|---|---|
| **Socle commun `shared/`** | contexte projet/service, règles de clôture | aucun — c'est la bonne approche |
| **Import par chemin relatif** | `Gestion-globale` importe 5 modules de `gestion-depenses2` | couplage invisible : déplacer un dossier casse l'autre |
| **Copie** | `planning-synchro` contient 3 modules copiés de `Planning Projet` | les deux copies divergent avec le temps |

**Modules dupliqués identifiés** `[FACTUEL]` :

| Module | Dupliqué dans |
|---|---|
| `utils/timeSegments.js` | `gestion-depenses2`, `planning-synchro` |
| `utils/frenchHolidays.js` | `gestion-depenses2`, `planning-synchro`, `Time-Out` |
| `utils/leaveAbsences.js` | `gestion-depenses2`, `planning-synchro` |
| `planningRealisation.js`, `planningProjetBuilder.js`, `columnsConfig.js` | copiés de `Planning Projet` vers `planning-synchro` |

**Risque concret** : les jours fériés, les demi-journées ou le calcul du réalisé
peuvent finir par être calculés différemment selon l'écran. À présenter comme un
chantier de consolidation identifié.

### 3.7 Le socle commun `shared/`

`[FACTUEL]` — **5 fichiers, 4 656 lignes**, chargés par la quasi-totalité des
pages :

| Fichier | Lignes | Rôle |
|---|---|---|
| `grist-service-context.js` | 2 440 | **Moteur navigateur** : lecture REST filtrée, cache, repli automatique, interception des lectures et des écritures, mise en lecture seule de l'interface |
| `service-context-core.js` | 1 423 | **Noyau de calcul** : droits, normalisation des noms, politique de filtrage par table, sérialisation de `Projets2.Avancement`. Écrit pour être testable hors navigateur |
| `project-mutation-sync-relay.js` | 329 | **Relais de synchronisation générique** : émission et écoute des colonnes-signal (§4.7 bis) |
| `planning-closure-core.js` | 271 | Règles de **clôture** d'une ligne de planning, sans dérive de fuseau horaire |
| `reference-project-sync-relay.js` | 193 | Relais de synchronisation dédié aux **données d'entrée** |

C'est la pièce d'architecture la plus intéressante à présenter : la logique
d'accès, de chargement et de synchronisation est **factorisée en un socle unique**
plutôt que répétée dans chaque application. Le noyau de calcul est séparé du
moteur navigateur précisément pour pouvoir être testé automatiquement — ce qui
est fait, avec 149 tests sur le seul socle.

`[FACTUEL]` — Un huitième relais existe côté application
(`ListeDePlan/liste-plan-sync-relay.js`, 198 lignes) pour la liste des plans.
`[INFÉRÉ]` — Il gagnerait à rejoindre `shared/`, comme les deux autres.

---

## 4. Le modèle de données

### 4.1 Vue d'ensemble

`[FACTUEL]` — Le document Grist contient 24 tables. Schéma complet en annexe
13.2.

```
┌─ RÉFÉRENTIELS ──────────────────────────────────────────────┐
│  Projets2       le catalogue des projets (canonique)        │
│  Team           l'annuaire des collaborateurs               │
│  Emetteurs      les émetteurs de documents + registre DOP   │
│  Projets        ancienne version, plus utilisée             │
└─────────────────────────────────────────────────────────────┘
┌─ SUIVI DOCUMENTAIRE ────────────────────────────────────────┐
│  References2         données d'entrée attendues / reçues    │
│  ListePlan_NDC_COF   liste des plans produits               │
│  Envois              bordereaux de transmission             │
│  References,                                                │
│  Transfert           anciennes versions, plus utilisées     │
└─────────────────────────────────────────────────────────────┘
┌─ PLANIFICATION ─────────────────────────────────────────────┐
│  Planning_Projet   planning de production documentaire      │
│  MsProject         planning travaux importé de MS Project   │
└─────────────────────────────────────────────────────────────┘
┌─ ÉCONOMIE ──────────────────────────────────────────────────┐
│  Budget        budget par chapitre                          │
│  ProjectTeam   qui travaille sur le projet, à quel taux     │
│  TimeSegment   plan de charge prévisionnel (au demi-jour)   │
│  TimeReal      pointage réel                                │
│  Timesheet     feuille de temps mensuelle                   │
└─────────────────────────────────────────────────────────────┘
┌─ RESSOURCES HUMAINES ───────────────────────────────────────┐
│  Time-Out      congés et absences                           │
└─────────────────────────────────────────────────────────────┘
┌─ TECHNIQUE ─────────────────────────────────────────────────┐
│  HTML, Hidden, HiddenResp    tables de support d'affichage  │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Les deux tables pivots

Tout repose sur deux tables. Un incident sur l'une des deux affecte l'ensemble
de la plateforme.

#### `Projets2` — le catalogue des projets

| Colonne | Type | Rôle |
|---|---|---|
| `Numero_de_projet` | Text | **Identifiant métier canonique** (ex. `252035`) |
| `Nom_de_projet` | Text | Libellé — sert de clé de jointure vers plusieurs tables |
| `DOP` | Text | Direction opérationnelle (`1`…`5`, ou vide) |
| `Avancement` | Text | **JSON** — configuration d'avancement par service (§4.5) |
| `Pourcentage_Facturation_Par_Mois` | Text | **JSON** — facturation mensuelle |
| `TypeDoc` | Text | Types de documents propres au projet |
| `Pourcentage` | Text | — |
| **7 colonnes `*_Sync`** | Text | **Colonnes techniques de synchronisation entre écrans** — cf. §4.7 bis |

> Particularité importante : un même **numéro** de projet peut porter
> **plusieurs noms** (alias historiques). Le code gère explicitement cette
> multiplicité.

#### `Team` — l'annuaire

| Colonne | Type | Rôle |
|---|---|---|
| `Prenom`, `Nom`, `PrenomNom` | Text | Identité |
| `Email` | Text | **Clé d'identité Grist** (`user.Email`) |
| `Service` | Text | `Structure` \| `Synthese` \| `Topographie` — détermine le périmètre d'écriture |
| `Role` | Text | `Projeteur`, `Ingénieur`, … |
| `Externe` | Bool | Collaborateur externe |
| `IdTrefle` | Text | Identifiant dans un SI tiers (« Trèfle ») |
| `Admin` | Bool | Accès à tous les projets ; gestion de toutes les lignes `Time-Out` |
| `Moi` | Bool | **Marqueur d'identité** — voir §6.5 |
| `Projets_Access` | Text | Affectations manuelles, une par ligne : `NumeroProjet\|NomProjet` |

### 4.3 Les tables métier

`[FACTUEL]` — description synthétique ; détail complet en annexe 13.2.

| Table | Contenu | Clé projet |
|---|---|---|
| `References2` | Une donnée d'entrée attendue ou reçue : émetteur, référence, indice, date de réception, date limite, caractère **bloquant**, retard, archivage | `NomProjet` (nom) |
| `ListePlan_NDC_COF` | Un plan produit : n°, désignation, type, indice, zone, date de diffusion | `Nom_projet` (nom) |
| `Envois` | Une ligne de bordereau : n° de bordereau (`Ref`), date, n° de plan, indice, nb d'exemplaires, indicateur `Envoye` | `Projet` (nom) |
| `Planning_Projet` | Une tâche de planning : zone, groupe, tâche, type de document, chaîne de dates et de durées, réalisé, retard, clôture | `NomProjet` (nom) |
| `MsProject` | Une tâche du planning travaux importée : n° unique, libellé, début, durée, fin, équipe, style de barre | `NomProjet` (nom) |
| `Budget` | Un chapitre budgétaire et son montant | `NumeroProjet` |
| `ProjectTeam` | Une affectation de personne à un projet, avec rôle et **taux journalier** | `NumeroProjet` |
| `TimeSegment` | Un segment de charge prévisionnelle au demi-jour | `NumeroProjet` |
| `TimeReal` | Un pointage réel mensuel | `NumeroProjet` |
| `Timesheet` | Une feuille de temps mensuelle | via `Team_Member` |
| `Time-Out` | Une absence : propriétaire (email), dates et demi-journées de début/fin, type | aucune |
| `Emetteurs` | Un émetteur de document ; la **ligne 1** sert de registre des valeurs DOP | aucune |

**Chaîne temporelle de `Planning_Projet`** — règle métier centrale :

```
Date_limite ──(Duree_1)──▶ Diff_coffrage ──(Duree_2)──▶ Diff_armature
                                          ──(Duree_3)──▶ Demarrages_travaux
```

### 4.4 Le point de fragilité : deux familles de clés

`[FACTUEL]` — C'est le sujet technique le plus important du modèle de données.

| Famille | Colonne | Tables concernées |
|---|---|---|
| **Par nom de projet** | `NomProjet` / `Nom_projet` / `Projet` | `References2`, `ListePlan_NDC_COF`, `Planning_Projet`, `Envois`, `MsProject` |
| **Par numéro de projet** | `NumeroProjet` | `Budget`, `ProjectTeam`, `TimeSegment`, `TimeReal` |

Il n'y a **pas de clé étrangère** : les jointures se font par comparaison de
texte. Conséquences, toutes traitées explicitement dans le code :

1. **Renommer un projet** oblige à propager le nouveau nom dans 5 tables.
   L'application `gestion-equipe` fait cette propagation avec prévisualisation
   du nombre de lignes impactées par table (§7.14).
2. **Alias de noms** : un numéro peut porter plusieurs noms ; les recherches
   envoient tous les alias connus.
3. **Tolérance orthographique** : le code maintient des listes de colonnes
   candidates. Exemple pour la date de début d'un segment : `Start_At`,
   `StartAt`, `Debut`, `DateDebut`, `Date_Debut`. Pour le numéro de projet :
   6 variantes, dont des versions mal encodées en UTF-8 (`NumÃ©ro de projet`).
4. **Comparaison de numéros stricte** : `2520` ne doit jamais correspondre à
   `252035`. Règle documentée et testée.
5. **Variantes de nom de table** gérées : `Planning_Projet` /
   `Planning_Project`, `ListePlan_NDC_COF` / `ListePlan NDC+COF`,
   `Time-Out` / `Time_Out` / `TimeOut`.

De la même façon, `ProjectTeam.Name` est du **texte libre** rapproché de `Team`
par heuristique (§6.4) — alors que cette table est l'une des deux sources des
droits d'accès.

**Évolution recommandée**, déjà écrite dans la documentation du dépôt :
remplacer ces jointures textuelles par des **références Grist stables** vers
`Projets2` et `Team`. Bon sujet d'accompagnement (§11).

### 4.5 Le cas `Projets2.Avancement`

`[FACTUEL]` — Une colonne `Text` contenant un JSON structuré par service :

```jsonc
{
  "Structure":   [ /* indices cibles par type de document, progression budget */ ],
  "Synthese":    [ /* … */ ],
  "Topographie": [ /* … */ ]
}
```

Un ancien format « plat » (tableau sans clé de service) est rattaché à
`Structure` pour compatibilité. Le socle commun expose une fonction dédiée afin
de ne lire et n'écrire que le bloc du service courant.

**Limites, déjà documentées par l'auteur** :
- **Aucun cloisonnement possible entre services** : qui lit la ligne lit les
  trois blocs.
- **Risque d'écrasement** si deux services enregistrent simultanément.
- La séparation propre nécessiterait une table avec **une ligne par
  `NumeroProjet` + `Service`**.

Ce point devient concret dès l'ouverture de la plateforme à `Synthese` et
`Topographie`.

### 4.6 Autres structures stockées en texte

`[FACTUEL]`

| Colonne | Contenu réel |
|---|---|
| `Projets2.Avancement` | JSON multi-services |
| `Projets2.Pourcentage_Facturation_Par_Mois` | JSON |
| `Projets2.TypeDoc` | liste de types |
| `Team.Projets_Access` | lignes `NumeroProjet\|NomProjet` |
| `Emetteurs.DOP` (ligne 1) | registre des valeurs DOP |

Ces structures fonctionnent, mais elles expliquent une grande part du code de
lecture défensive présent dans les applications.

### 4.7 Références obsolètes à nettoyer

`[FACTUEL]` — confirmé par l'auteur :

| Élément | Statut |
|---|---|
| Table `Ventilation` | **N'existe plus** — encore référencée par `ListeDePlan` (code mort) |
| Tables `Projets`, `References`, `Transfert` | Anciennes versions, **plus utilisées** par aucune des 15 applications |
| Colonnes `Team.Projets_Lecture_Structure` / `_Synthese` / `_Topographie` | **Ne donnent plus aucun droit** ; conservées pour historique |

### 4.7 bis — Les colonnes de synchronisation de `Projets2`

`[FACTUEL]` — Ajout récent, à présenter comme une **évolution d'architecture
aboutie**, pas comme un détail technique.

**Le problème résolu.** Quand un utilisateur modifie une donnée dans un écran,
les autres écrans ouverts — sur son poste comme sur celui d'un collègue —
affichent encore l'ancienne valeur. La première réponse avait été
d'**interroger périodiquement** le serveur toutes les 30 secondes : coûteux en
réseau, et malgré tout en retard d'une demi-minute.

**La solution retenue.** Sept colonnes techniques ont été ajoutées à `Projets2`,
une par domaine fonctionnel :

| Colonne | Domaine | Écrite par |
|---|---|---|
| `References2_Sync` | données d'entrée | `Reference2` |
| `ListePlan_Sync` | liste des plans | `ListeDePlan` |
| `PlanningProjet_Sync` | planning d'études | `Planning Projet`, `planning-synchro`, `gestion-depenses2` |
| `ChargePlanning_Sync` | plan de charge | `Planning Projet`, `planning-synchro`, `gestion-depenses2` |
| `Avancement_Sync` | avancement | `Avancement`, `Planning Projet`, `planning-synchro`, `gestion-depenses2` |
| `Bordereau_Sync` | bordereaux | `Bordereau` |
| `GestionDepenses_Sync` | économie du projet | `gestion-depenses2` |

**Le principe.** Après avoir écrit une donnée, un écran inscrit une nouvelle
valeur dans la colonne-signal correspondante, **sur la ligne du projet
concerné**. Comme `Projets2` est déjà chargée et surveillée par tous les écrans,
Grist pousse ce changement à tous les postes connectés. Chaque écran regarde
alors si le signal le concerne, et **ne recharge que les tables réellement
touchées**.

```
Utilisateur A modifie un plan dans ListeDePlan
        │
        ├─▶ écriture dans ListePlan_NDC_COF
        └─▶ Projets2[projet].ListePlan_Sync = nouvelle valeur
                    │
                    └─▶ Grist pousse le changement à tous les postes
                              │
                              ├─▶ Bordereau     recharge ListePlan_NDC_COF
                              ├─▶ Avancement    recharge ListePlan_NDC_COF
                              ├─▶ Planning Projet recharge ListePlan_NDC_COF
                              └─▶ les autres écrans ignorent le signal
```

Chaque écran déclare, dans sa page, **ce qu'il émet** et **ce qu'il observe** —
avec pour chaque signal la liste des tables à relire. La configuration est donc
lisible et vérifiable, écran par écran.

**Résultats.** `[FACTUEL]`

- **L'interrogation périodique a été supprimée** : l'intervalle par défaut est
  désormais à zéro. Des tests automatisés vérifient qu'**aucun widget n'arme de
  minuterie de relecture** et qu'**aucun n'impose d'intervalle**.
- La mise à jour est **immédiate** au lieu d'être différée jusqu'à 30 secondes.
- Un test vérifie que **chaque écran branché sur le socle observe au moins une
  table**, et un autre que `gestion-depenses2` **surveille bien toutes les
  tables qu'il relit**.

**Point à signaler honnêtement** `[FACTUEL]` : les colonnes-signal sont
**créées automatiquement** dans `Projets2` (action `AddColumn`, type `Text`) si
elles sont absentes. C'est un **écart avec le principe posé pour l'outil
d'administration des accès**, qui refuse au contraire de démarrer si une colonne
manque et ne modifie jamais le schéma (§6.8). L'écart est défendable — il s'agit
de colonnes purement techniques, sans donnée métier — mais il mérite d'être
énoncé plutôt que découvert.

### 4.8 Matrice Application × Table

`[FACTUEL]` — L = lecture, **E** = écriture

| Table | Ref2 | créat. | EnAtt | LDP | Bord | PlanP | MSP | T-Out | Avanc | p-sync | dep2 | G-glob | G-User | g-equ | g-acces |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Projets2` | L**E** | L**E** | L | L**E** | L | L | L | – | L**E** | L | L**E** | L | L | L**E** | L |
| `Team` | L | L | – | L | – | – | – | L | – | L | L | – | L | L**E** | L**E** |
| `ProjectTeam` | – | **E** | – | – | – | – | – | – | L | L | L**E** | L | – | L**E** | L |
| `References2` | L**E** | **E** | L | L**E** | – | L**E** | – | – | – | L | – | – | – | L**E** | – |
| `ListePlan_NDC_COF` | L**E** | **E** | – | L**E** | L | L | – | – | L | – | L | L | – | L**E** | – |
| `Planning_Projet` | L**E** | **E** | – | L**E** | – | L**E** | L**E** | – | L | L | L | L | – | L**E** | – |
| `Envois` | – | – | – | – | L**E** | – | – | – | – | – | – | – | – | L**E** | – |
| `Budget` | – | **E** | – | – | – | – | – | – | L | – | L**E** | L | – | L**E** | – |
| `TimeSegment` | – | – | – | – | – | – | – | – | – | L**E** | L**E** | L | L | L**E** | – |
| `TimeReal` | – | – | – | – | – | – | – | – | L | – | L | L | – | L**E** | – |
| `Timesheet` | – | – | – | – | – | – | – | – | – | – | L**E** | L | – | – | – |
| `Time-Out` | – | – | – | – | – | – | – | L**E** | – | L | L | – | – | – | – |
| `MsProject` | – | – | – | – | – | – | L**E** | – | – | – | – | – | – | L**E** | – |
| `Emetteurs` | L | L**E** | – | L | – | – | – | – | – | – | L | L | – | L**E** | – |
| métadonnées Grist | – | – | – | L | – | – | – | – | – | – | – | – | – | L | – |

Deux enseignements :
- `Projets2` et `Team` sont lues par presque tout le monde.
- **`gestion-equipe` écrit dans 13 tables** — c'est l'application la plus
  puissante, et celle qui mérite le plus d'attention (§7.14).

---

## 5. Vue d'ensemble fonctionnelle

`[INFÉRÉ]` — Enchaînement métier reconstitué, utile pour introduire les 15
applications au lecteur.

```
        ┌──────────────────────┐
        │  1. creation-projet  │  Créer le projet, son budget,
        │                      │  son équipe, ses documents
        └──────────┬───────────┘
                   ▼
   ┌───────────────────────────────────────┐
   │            SUIVI DOCUMENTAIRE          │
   │  2. Reference2   données d'entrée      │
   │  3. EnAttente    ce qui manque         │
   │  4. ListeDePlan  plans produits        │
   │  5. Bordereau    transmission          │
   └───────────────────┬───────────────────┘
                       ▼
   ┌───────────────────────────────────────┐
   │             PLANIFICATION              │
   │  6. Planning Projet   planning études  │
   │  7. MS Project        planning travaux │
   │  8. planning-synchro  planning+charge  │
   └───────────────────┬───────────────────┘
                       ▼
   ┌───────────────────────────────────────┐
   │           PILOTAGE ÉCONOMIQUE          │
   │  9.  gestion-depenses2  un projet      │
   │  10. Gestion-globale    multiprojets   │
   │  11. Avancement         avancement     │
   └───────────────────┬───────────────────┘
                       ▼
   ┌───────────────────────────────────────┐
   │              RESSOURCES                │
   │  12. Gestion-User  taux d'occupation   │
   │  13. Time-Out      congés / absences   │
   └───────────────────┬───────────────────┘
                       ▼
   ┌───────────────────────────────────────┐
   │            ADMINISTRATION              │
   │  14. gestion-equipe                    │
   │  15. gestion-acces-interservices       │
   └───────────────────────────────────────┘
```

---

## 6. La gestion des accès

> Chapitre à traiter avec soin : c'est le sujet principal sur lequel un
> accompagnement du service informatique est attendu.

### 6.1 Le besoin

Deux cloisonnements sont visés :

1. **Par projet** — une personne ne doit voir que les projets sur lesquels elle
   est affectée.
2. **Par service** — une personne modifie les données de son service et consulte
   celles des autres en lecture seule.

> **Contexte important** : aujourd'hui **seul le service `Structure` utilise la
> plateforme**. Le cloisonnement par service a donc été construit **en
> anticipation** de l'ouverture aux autres services. Il n'est pas encore
> réellement éprouvé en usage.

### 6.1 bis — Prérequis identifié pour l'ouverture aux autres services

`[FACTUEL]` — **Constat technique important, à faire figurer dans le document.**

La liste des services est aujourd'hui **figée dans le code**, dans le socle
commun (`shared/service-context-core.js`) :

```js
const SERVICES = Object.freeze(["Structure", "Synthese", "Topographie"]);
```

Cette liste est utilisée à une dizaine d'endroits du noyau. La fonction qui
normalise un service **renvoie une valeur vide pour tout libellé absent de la
liste** — la comparaison ignore la casse et les accents, mais pas un nom
inconnu.

Conséquence directe : conformément à la règle du §6.3, une personne dont
`Team.Service` vaut par exemple `Méthodes` obtiendrait **un service vide, donc
aucun contexte exploitable** — elle ne pourrait pas utiliser la plateforme.

S'y ajoute un second point : le formulaire d'ajout de membre de
`gestion-equipe` ne propose aujourd'hui que **`Structure` et `Topographie`**
(`Synthese` n'y figure pas), alors que le noyau en connaît trois.

**Ce que cela implique concrètement** : l'ouverture à `Méthodes` ou à tout autre
service **suppose une modification du code**, à trois endroits au moins :

1. la constante `SERVICES` du socle commun ;
2. les listes déroulantes de `gestion-equipe` ;
3. la structure JSON de `Projets2.Avancement`, qui contient un bloc par service
   (§4.5).

**Pourquoi c'est utile de le dire dans le document** : cela montre que l'auteur a
identifié le chemin technique de l'extension qu'il annonce, et cela ouvre
naturellement la discussion sur le point du §6.7 — puisque c'est au même moment
que le cloisonnement doit passer côté serveur.

`[INFÉRÉ]` — L'évolution naturelle serait de **lire la liste des services depuis
une table Grist** plutôt que de la figer dans le code, sur le modèle du registre
des DOP déjà en place.

### 6.2 La règle d'affectation

`[FACTUEL]` — `docs/service-access/README.md`

```
AccèsProjet(personne) = ProjectTeam(personne) ∪ Team.Projets_Access(personne)
```

Une personne accède à un projet si **au moins une** des conditions est vraie :

1. une ligne `ProjectTeam` du projet correspond à sa ligne `Team` ;
2. le projet figure dans sa cellule `Team.Projets_Access`
   (format `NumeroProjet|NomProjet`, une affectation par ligne).

Les deux sources sont fusionnées et **dédupliquées par `NumeroProjet`**. Le
numéro est l'identifiant canonique ; plusieurs lignes peuvent conserver les
différents noms d'un même numéro afin de reconnaître les tables historiques qui
n'ont qu'un nom de projet.

### 6.3 La matrice de droits

`[FACTUEL]`

| Situation | Effet |
|---|---|
| Personne non affectée | **Ne voit pas le projet** |
| Ancienne sélection devenue interdite | **Rejetée automatiquement** |
| Personne affectée | Consulte les trois services |
| Service = son `Team.Service` | **Écriture autorisée** |
| Autres services | **Lecture seule** |
| `Team.Admin = true` | Accès à **tous** les projets |
| Administrateur | Écrit dans son service, lit les autres |
| `Team` sans service valide | Aucun contexte exploitable |
| Ligne métier au `Service` vide | N'est **plus** interprétée comme `Structure` |

`Structure` n'a **plus** d'accès implicite au catalogue complet — changement de
règle explicite par rapport à la version précédente.

Le socle expose trois états : `editable`, `readonly`, `hidden`. En `readonly`,
les commandes d'écriture de l'interface sont désactivées et les modifications
sont bloquées.

### 6.4 Le rapprochement `ProjectTeam.Name` → `Team`

`[FACTUEL]` — `ProjectTeam.Name` étant du texte libre, une heuristique en 4
étapes est appliquée, dans l'ordre :

1. identifiant de ligne, si `Name` est une référence Grist vers `Team` ;
2. correspondance normalisée avec `Team.PrenomNom` ;
3. correspondance avec `Team.Prenom + Team.Nom` ;
4. correspondance avec un **prénom seul**, *uniquement si ce prénom est unique*.

La normalisation ignore la casse, les accents, les espaces répétés et la
ponctuation.

Cas particuliers gérés :
- plusieurs lignes `Team` de même nom complet (deux emails) → **fusionnées** en
  une personne, tous les comptes reçoivent l'accès ;
- prénom correspondant à plusieurs noms complets → **ambigu**, **aucun accès** ;
- nom inconnu ou ambigu → **jamais d'accès arbitraire**, remonté dans le
  diagnostic de l'application d'administration.

**C'est un point de fragilité assumé** : une erreur de saisie de nom peut ouvrir
ou fermer un accès. L'évolution recommandée est une référence stable.

### 6.5 Comment le widget sait qui est connecté

`[FACTUEL]` — Un widget Grist ne peut pas lire directement l'identité de
l'utilisateur. La solution retenue mérite d'être expliquée, elle est élégante :

1. La colonne `Team.Moi` est cochée sur **toutes** les lignes.
2. Une règle d'accès Grist **censure la lecture de cette colonne** partout, sauf
   sur la ligne dont l'email correspond à l'utilisateur connecté.
3. Le widget lit `Team` : il voit toutes les lignes (donc toute l'équipe), mais
   `Moi` n'est visible que sur **une seule** — celle de l'utilisateur courant.
4. Repli : si aucune ligne n'est identifiée, le widget passe en lecture seule.

### 6.6 Ce qui est réellement en place aujourd'hui

`[FACTUEL]` — état de la production, confirmé par l'auteur.

**Règles d'accès configurées côté serveur Grist** — uniquement pour `Time-Out` :

```
1. User Attribute « TeamRec » : table Team, Email = user.Email

2. Règle de colonne sur Team.Moi :
     user.Email != rec.Email  →  Deny Read

3. Règles de table sur Time-Out :
     user.TeamRec.Admin != True and user.Email != rec.Owner
        → Deny Update + Delete
     user.TeamRec.Admin != True and user.Email != newRec.Owner
        → Deny Create
     Défaut : Read autorisé à tous
```

Propriétés obtenues : chacun voit toutes les absences, chacun ne modifie que les
siennes, les administrateurs modifient tout, **et c'est appliqué côté serveur** —
un widget modifié ne peut pas contourner la règle. Un utilisateur sans ligne
`Team` est traité comme non-administrateur propriétaire de rien, donc en lecture
seule : comportement sûr par défaut.

**Filtrage projet + service** — réalisé **dans le JavaScript des widgets** :

| Application | Sous filtrage projet/service |
|---|---|
| `Reference2` | oui |
| `EnAttente` | oui |
| `ListeDePlan` (2 pages) | oui |
| `Bordereau` | oui |
| `Planning Projet` | oui |
| `Avancement` | oui |
| `planning-synchro` | oui |
| `gestion-depenses2` | oui |
| `Gestion-globale` | oui |
| `Gestion-User` | oui |
| `gestion-acces-interservices` | outil d'administration (utilise le noyau) |
| `creation-projet` | **non — choix assumé** |
| `MS Project` | **non — choix assumé** |
| `Time-Out` | **non — protégé par les règles d'accès serveur** |
| `gestion-equipe` | **non — outil d'administration, choix assumé** |

Fonctionnement du filtrage JavaScript :

```
1. Lecture brute de Team, Projets2 et ProjectTeam
      ↳ obligatoire : on ne peut pas filtrer ProjectTeam
        avant de s'en servir comme source des droits
2. Calcul des projets et services autorisés
3. Réconciliation de la sélection en cours
4. Interception des lectures  → filtrage
   Interception des écritures → contrôle
5. Passage de l'interface en lecture seule si nécessaire
```

Le socle vérifie notamment que les lignes modifiées ou supprimées appartiennent
bien au contexte autorisé, et injecte automatiquement le projet et le service
dans les créations.

### 6.7 La limite principale — à énoncer clairement

`[FACTUEL]` — citation de la documentation du dépôt, écrite par l'auteur :

> « La protection est actuellement réalisée dans les widgets JavaScript. Elle
> protège les parcours applicatifs couverts, **mais ne remplace pas une sécurité
> côté Grist : un utilisateur disposant de droits directs sur le document peut
> contourner un contrôle client.** »
>
> « Les permissions avancées seront conçues et activées lors d'une phase
> ultérieure. Ne pas présenter le runtime actuel comme une frontière de
> sécurité serveur. »

Ce que cela signifie concrètement :

| Constat | Conséquence |
|---|---|
| Les widgets demandent un accès complet au document | Ils obtiennent les droits complets de l'utilisateur |
| Le cloisonnement projet/service est calculé dans le navigateur | Il relève de l'ergonomie, pas de la sécurité |
| Aucune règle serveur n'implémente `ProjectTeam ∪ Projets_Access` | Le cloisonnement inter-projets et inter-services n'est pas garanti techniquement |
| `Projets2.Avancement` mélange trois services dans une cellule | Le cloisonnement y est structurellement impossible |

**Nuance indispensable** : aujourd'hui, **un seul service** utilise la
plateforme, tous les utilisateurs appartiennent au même bureau d'études, et
**aucun collaborateur externe** n'y accède. Le risque est donc **modéré en
l'état**. Il devient réel au moment de l'ouverture à d'autres services — c'est
précisément ce qui motive le calendrier de cette démarche.

**Le modèle appliqué à `Time-Out` (§6.6) démontre que c'est faisable.** Le sujet
est de le généraliser, avec l'aide du service informatique.

Élément de contexte technique déjà identifié : les règles d'accès Grist devront
pouvoir exprimer de manière fiable l'appartenance `ProjectTeam`, ce qui **peut
nécessiter des références, des formules ou une table d'accès dédiée**.

### 6.8 L'outil d'administration des accès

`[FACTUEL]` — `gestion-acces-interservices` (§7.15) est l'écran par lequel un
administrateur attribue ou révoque les accès. Deux règles de sécurité
fonctionnelle y sont implémentées :

1. **Refus de démarrage** si la colonne `Team.Projets_Access` n'existe pas.
   L'application ne modifie **jamais** le schéma silencieusement.
2. **Ne supprime jamais une ligne `ProjectTeam`.** Retirer un ajout manuel ne
   retire donc pas l'accès si la personne reste présente dans `ProjectTeam`.

### 6.9 Le mode « Voir en tant que »

`[FACTUEL]` — Limitation documentée : le mode Grist « Voir en tant que » modifie
la session, mais il n'existe pas de détection fiable côté widget. La
recommandation est de **recetter avec de vrais comptes de test** plutôt qu'avec
ce mode.

### 6.9 bis — Chargement des données : REST d'abord, repli automatique

`[FACTUEL]` — Deuxième évolution majeure récente, à présenter comme un travail
d'optimisation abouti.

**Le problème résolu.** Historiquement, chaque écran demandait à Grist la
**table entière**, puis filtrait dans le navigateur. Sur un document qui grossit,
cela transfère beaucoup de lignes qu'on jette aussitôt.

**La solution retenue.** Le socle commun demande désormais à Grist, via son
**API REST**, uniquement les lignes du projet et du service en cours. Le filtre
est appliqué **côté serveur**. Une politique explicite est déclarée par table :

| Politique | Filtre envoyé au serveur | Tables concernées |
|---|---|---|
| **Projet + Service** | numéro ou nom de projet **et** service | `References2`, `ListePlan_NDC_COF`, `Planning_Projet`, `Envois`, `Budget`, `ProjectTeam`, `TimeSegment`, `TimeReal` |
| **Service seul** | service | `Emetteurs` |
| **Lecture complète** | aucun filtre | `Team`, `Projets2`, `Time-Out`, `Timesheet`, `MsProject`, métadonnées Grist, alias non confirmés |
| **API historique** | — | réservée au repli |

Deux principes de prudence méritent d'être soulignés :

1. **Aucun filtre n'est inventé.** Une table sans colonne `Service` fiable est
   lue en entier plutôt que filtrée sur une colonne supposée. C'est explicite
   dans le code, table par table, avec la raison inscrite à côté.
2. **Le filtre serveur ne remplace pas le filtre client.** Toute réponse REST
   est **re-filtrée dans le navigateur** avant d'être livrée à l'écran.

**Le repli, en cascade.** Si quoi que ce soit empêche la lecture REST, l'écran
revient automatiquement à l'API historique `fetchTable()` puis applique les
filtres dans le navigateur :

```
Lecture REST filtrée
   ↓  erreur réseau · jeton indisponible · réponse illisible
   ↓  colonne obligatoire absente de la réponse
   ↓  réponse vide contredite par l'API historique
Lecture complète via fetchTable() + filtrage dans le navigateur
   ↓
Table vide immédiate si le projet ou le service requis est vide
```

Le repli est **ciblé** : il s'applique à la table concernée, pas à tout l'écran,
et l'indisponibilité constatée est mémorisée pour la session afin de ne pas
répéter un appel voué à l'échec.

**Aucune perte de fonctionnalité en cas de repli.** C'est le point important
pour un lecteur extérieur : le mode REST est une **optimisation**. S'il ne
fonctionne pas — serveur ancien, jeton restreint, table non filtrable — les
écrans continuent de fonctionner exactement comme avant, simplement en
transférant plus de données.

**Trois modes d'intégration** selon les besoins de l'écran :

| Mode | Écrans | Comportement |
|---|---|---|
| Automatique | les 11 écrans de production courante | filtrage projet + service complet, lectures **et** écritures contrôlées |
| Lecture complète prioritaire | `creation-projet`, `gestion-equipe`, `Time-Out` | lectures REST sans filtre inventé ; écritures **non** interceptées, car ces écrans travaillent par nature sur l'ensemble du document |
| Contexte seul | *(aucun actuellement)* | contexte exposé, aucune interception |

**Comment le vérifier** `[FACTUEL]` : chaque lecture est journalisée dans la
console du navigateur sous une étiquette explicite — `[GristData][REST FILTRE]`,
`[GristData][REST COMPLET]`, `[GristData][FALLBACK FETCHTABLE]` (avec la raison
du repli), `[GristData][CACHE]`. C'est un point à mentionner : le comportement
est **observable et diagnosticable**, il n'y a pas de boîte noire.

**Dépendance à la version du serveur** `[FACTUEL]` : le jeton REST demandé est
volontairement en lecture seule et n'est jamais stocké. Sur un serveur Grist
ancien, ce jeton peut ne pas être reconnu par les règles d'accès et renvoyer une
réponse vide ; le mécanisme de sonde détecte cette situation et bascule sur le
repli pour la durée de la session. **C'est le comportement attendu, pas une
panne.**

### 6.9 ter — Effet estimé sur la charge serveur

`[INFÉRÉ]` — **Modèle d'estimation**, à présenter comme tel : calculé à partir du
schéma réel des tables et d'hypothèses explicites, non mesuré en production. Il
donne un **ordre de grandeur** et un **facteur de réduction**.

**Hypothèses**

| Paramètre | Valeur |
|---|---|
| Projets | 40 (donc 40 lignes dans `Projets2` et `MsProjectNom`) |
| Tables métier | 25 000 lignes |
| Part d'un projet dans une table | ~625 lignes |
| Avant | relecture complète de chaque table surveillée toutes les 30 s |
| Après | rechargement des seules tables concernées, uniquement sur modification réelle |
| Compression HTTP | ~10× (JSON très répétitif) |

**Un choix d'architecture déterminant : la table de section**

`[FACTUEL]` — Un widget Grist reçoit **toute la table à laquelle sa section est
rattachée**, indépendamment de ce qu'il lit ensuite lui-même. Ce flux natif
échappe complètement à l'optimisation REST. Le choix des tables de section est
donc structurant, et il a été bien fait :

| Table de section | Lignes | Widgets rattachés | Coût du flux natif |
|---|---|---|---|
| `Projets2` | 40 | 11 widgets | **~40 Ko chacun** |
| `MsProjectNom` | 40 | `MS Project` | **~2 Ko** |
| `Team` | ~60 | `gestion-equipe`, `gestion-acces-interservices` | **~18 Ko** |
| `TimeSegment` | 25 000 | `Gestion-User` | **~4,6 Mo** |

Rattacher 11 widgets à un catalogue de 40 lignes plutôt qu'à leur table métier
ramène le flux natif de plusieurs mégaoctets à quelques dizaines de kilooctets.
C'est aussi ce qui rend le mécanisme de colonnes-signal (§4.7 bis) pratiquement
gratuit : le signal voyage sur une table que les widgets reçoivent déjà.

**Résultat, 15 écrans ouverts, une heure de régime établi**

| Poste | Volume |
|---|---|
| Flux natif Grist (sections) | 5,0 Mo — dont **4,6 Mo pour `Gestion-User` seul** |
| `MS Project` (`MsProject` lue en entier) | 18,7 Mo |
| Widgets à colonnes-signal (rechargement ciblé) | 13,3 Mo |
| Autres écrans | 9,7 Mo |
| **Total après** | **~47 Mo/h** |
| **Total avant** | **~24 770 Mo/h** |
| **Facteur de réduction** | **× 530** |

**Trois effets se cumulent**, et il est utile de les distinguer car ils ne
dépendent pas des mêmes conditions :

1. **Le choix des tables de section** — acquis, indépendant de tout le reste.
2. **La suppression de l'interrogation périodique** — acquise, **indépendante de
   la version du serveur**. À elle seule, elle divise le nombre de lectures par
   ~20.
3. **Le filtrage serveur** — divise le volume de chaque lecture par ~40
   (25 000 lignes → 625). C'est le seul des trois qui attend la montée de
   version.

Autrement dit : même si le filtrage REST devait rester indisponible, l'essentiel
du gain est déjà acquis.

**Le rechargement est ciblé, pas global** `[FACTUEL]` : chaque colonne-signal
déclare les tables qu'elle invalide. Un signal « liste des plans modifiée » ne
recharge que la liste des plans, pas les sept tables surveillées par l'écran.
Sur `gestion-depenses2`, cette précision divise le trafic récurrent par quatre.

**Les deux points qui restent** `[FACTUEL]`

| Point | Poids | Nature |
|---|---|---|
| `MsProject` est déclarée en lecture complète alors que le widget filtre lui-même sur `Nom` | **~40 % du trafic résiduel** | La colonne existe et la valeur est connue : le filtrage serveur est possible |
| `Gestion-User` a sa section sur `TimeSegment` (25 000 lignes) | **~10 % du trafic résiduel**, et incompressible par REST | Déplacer sa section vers une petite table réglerait le point |

Traiter ces deux points ferait passer la réduction de × 530 à environ × 1 000.

### 6.10 Prérequis de données

`[FACTUEL]` — `docs/service-access/MIGRATION.md`

1. Sauvegarder le document Grist avant toute modification.
2. Créer `Team.Projets_Access` (type `Text`) — manuellement.
3. Vérifier dans `Team` : noms complets cohérents, `PrenomNom` ou
   `Prenom`+`Nom`, `Service` valide, `Email` en minuscules, colonne `Moi`.
4. Vérifier dans `Projets2` : `Numero_de_projet` et `Nom_de_projet` remplis ;
   numéros identiques = même groupe d'accès ; noms multiples = alias légitimes.
5. Vérifier la présence d'un `Service` valide dans `References2`,
   `ListePlan_NDC_COF`, `Planning_Projet`, `Envois`, `Budget`, `ProjectTeam`,
   `TimeSegment`, `TimeReal`, `Emetteurs`.

**Plan de recette existant — 12 cas, à reprendre tels quels :**

1. Une personne `Structure` sans affectation ne voit aucun projet.
2. Une affectation `ProjectTeam` ouvre le projet.
3. Une affectation `Projets_Access` ouvre le projet.
4. Les deux sources ne créent pas de doublon.
5. Le service personnel est modifiable.
6. Les deux autres services sont en lecture seule.
7. Une révocation manuelle fait disparaître le projet **sauf** présence
   `ProjectTeam`.
8. Un nom `ProjectTeam` ambigu ne donne aucun accès.
9. Une sélection locale révoquée est remplacée ou vidée.
10. Deux lignes de même nom complet affichent leurs deux emails et reçoivent
    l'accès.
11. Un administrateur voit tous les projets.
12. `2520` ne donne **jamais** accès à `252035`.

---

## 7. Les 15 applications en détail

> Format identique pour chacune : **Objet · Utilisateurs · Données · Fonctions ·
> Écritures · Points d'attention**.

### 7.1 `Reference2` — Suivi des données d'entrée

**Objet.** Suivre les **données d'entrée** attendues ou reçues pour chaque
document du projet, avec leur caractère bloquant et leur retard.

**Utilisateurs.** Chargés d'études, projeteurs, responsables d'affaire.

**Données.** L `Projets2`, `Team`, `Emetteurs`, `Planning_Projet`,
`ListePlan_NDC_COF` · L/**E** `References2`.

**Fonctions.** `[FACTUEL]`

- **Filtres en cascade** : Projet → Document (« étage ») → Type → Zone, plus une
  case « afficher les archivés ».
- **Tableau** : ID, Émetteur, Référence, Indice, Reçu, Description/Observations,
  **Date limite calculée**, Bloquant, Archive.
- **Actions** : Ajouter · Modifier · **Archiver** · Supprimer (menu contextuel
  et barre d'actions).
- **Formulaire de référence** en trois sections :
  - *Identification* — Émetteur\*, Référence\* (avec **sélection de fichier** qui
    renseigne automatiquement la référence), Indice\*.
  - *Réception et informations* — Date reçue, **Durée limite (semaines)**,
    Description\*, **Remarque** (`Conservatoire` \| `Officiel`).
  - *Documents concernés* — duplication de la référence sur plusieurs documents.
- **Création de documents**, trois modes :
  1. un document (n°, nom, zone, type, durée limite par défaut, émetteurs) ;
  2. plusieurs documents (saisie tabulaire) ;
  3. **assistant** à onglets **Manuel / Avec motif** — préfixe, suffixe, plage
     numérique (début, pas, remplissage 2/3/4 chiffres) ou plage alphabétique
     (A → Z), avec **prévisualisation** avant création.
- **Calcul de la date limite** à partir de la durée en semaines et de la date de
  départ issue du planning.
- **Copier / coller** de lignes.
- **Contrôle d'unicité** des documents créés.

**Écritures.** `References2` (création, modification, archivage, suppression),
création coordonnée de documents dans `ListePlan_NDC_COF` et `Planning_Projet`,
mise à jour de `Projets2.TypeDoc`, propagation de la date limite vers
`Planning_Projet`.

**Points d'attention.** 10 894 lignes réparties en 8 modules plus un fichier
historique. Émet un signal vers les autres applications quand les données
d'entrée changent.

---

### 7.2 `creation-projet` — Assistant de création de projet

**Objet.** Créer un projet complet en **5 étapes**, avec toutes ses données
associées.

**Utilisateurs.** Responsables d'affaire, direction d'études.

**Données.** L `Emetteurs`, `Team`, `Projets2`, `References2`, variantes
`ListePlan_NDC_COF` et `Planning_Projet`.

**Fonctions.** `[FACTUEL]`

| Étape | Contenu |
|---|---|
| **1 — Détails du projet** | Nom, numéro, **DOP** (liste alimentée par le registre `Emetteurs`, ou « Sans DOP ») |
| **2 — Lignes budgétaires** | Budget total indicatif et **14 chapitres pré-remplis** (annexe 13.4), ajout/suppression/édition, contrôle de doublon |
| **3 — Sélection de l'équipe** | Choix des membres depuis `Team`, avec rôle |
| **4 — Documents & Émetteurs** | Même assistant Manuel / Avec motif que `Reference2`, plus les émetteurs et les données d'entrée |
| **5 — Révision et création** | Récapitulatif complet, puis création |

**Écritures.** Création coordonnée dans `Projets2`, `Budget`, `ProjectTeam`,
`References2`, `ListePlan_NDC_COF`, `Planning_Projet` ; mise à jour du registre
DOP dans `Emetteurs`.

**Points d'attention.**
- **Hors filtrage projet/service** — choix assumé (c'est l'écran qui *crée* le
  projet, il n'y a rien à filtrer en amont).
- Contrôle d'unicité des identités de documents avant création.
- **Pas de transaction atomique** : la création se fait en plusieurs appels
  successifs. En cas d'échec partiel, le projet peut rester incomplet.
  `[INFÉRÉ]` — point à signaler.

---

### 7.3 `EnAttente` — Ce qui manque pour produire

**Objet.** Visualiser, pour un projet, la proportion de données d'entrée reçues,
en attente et bloquantes.

**Utilisateurs.** Chargés d'études, pilotage.

**Données.** L `Projets2`, `References2`.

**Fonctions.** `[FACTUEL]`

- Filtres : Projet → Document → Type de document → Zone.
- **Camembert** dessiné entièrement en Canvas natif (sans bibliothèque
  graphique), avec étiquettes de pourcentage dans les parts, légende, et
  **détection du clic sur une part**.
- **Filtrage par part** : cliquer une part filtre le tableau de détail.
- **Tableau de détail** : Émetteur, Référence, Indice, Reçu, Observation,
  Bloquant — avec **fusion des cellules répétées** en première colonne.

**Écritures.** Aucune — consultation pure.

**Points d'attention.** Environ 250 lignes de rendu graphique développées à la
main. `[À TRANCHER]` — pourrait être remplacé par Chart.js, déjà utilisé
ailleurs.

---

### 7.4 `ListeDePlan` — Liste des plans et éditions

**Objet.** Gérer la liste des plans du projet, leur indice, leur date de
diffusion, et produire les éditions PDF.

**Utilisateurs.** Projeteurs, chargés d'études, secrétariat technique.

**Données.** L `Projets2`, `References2`, `Planning_Projet`, `Emetteurs`,
`Team`, métadonnées Grist · L/**E** `ListePlan_NDC_COF`.

**Fonctions.** `[FACTUEL]` — 5 pages :

**Vue principale**
- Filtres : Projet, **Types de document en cases à cocher**, Zone.
- Tableau **groupé par Zone puis par Type**, avec repli/dépli des groupes.
- **Édition des dates en masse** :
  - application sur une sélection de cellules,
  - application sur toute la colonne,
  - **sélection par glisser** sur les cellules de date,
  - **sélection Ctrl+clic**,
  - fenêtre de date flottante repositionnée automatiquement dans l'écran.
- **Menu contextuel** : modification du type de document, suppressions liées,
  réorganisation des dates de planning.
- **Gestion des zones** : ajout, renommage, suppression, avec propagation
  multi-tables et contrôle de doublon.
- **Ajout de documents** : assistant Manuel / Avec motif + date limite de
  réception par défaut.
- **Impression PDF** : fenêtre « Préparer l'impression » avec sélection des
  types de document et des zones, et **ordre des zones personnalisable**.

**Autres pages** : vue d'avancement dédiée, dialogue d'ajout de document avec
émetteurs par défaut, ajout de référence documentaire depuis le contexte
courant, et une vue Gantt.

**Écritures.** `ListePlan_NDC_COF` (complet), `Planning_Projet` et `References2`
(synchronisations), `Projets2` (types de documents).

**Points d'attention.**
- 11 344 lignes, 5 pages, environ 19 fichiers JavaScript non modulaires.
- **Découverte dynamique du schéma** via les métadonnées Grist : l'application
  s'adapte aux colonnes réellement présentes.
- Les écritures sont appliquées **par lots**.
- **Aucun test unitaire** malgré la taille et la criticité.
- Contient la référence morte à la table `Ventilation` (§4.7).

---

### 7.5 `Bordereau` — Bordereaux de transmission

**Objet.** Constituer et éditer les bordereaux de transmission de plans, et
générer le PDF à en-tête.

**Utilisateurs.** Secrétariat technique, projeteurs.

**Données.** L `Projets2`, `ListePlan_NDC_COF` · L/**E** `Envois`.

**Fonctions.** `[FACTUEL]`

- Sélection **Projet** et **numéro de bordereau**, avec boutons ▲ / ▼ pour
  naviguer entre bordereaux existants.
- **Date** du bordereau.
- Case **« Envoyé »** → **gel du bordereau** : un bordereau envoyé n'est plus
  modifiable.
- **Tableau** : N° Plan, Indice, Désignation, Date de diffusion (non imprimée),
  **Nbr Exemplaires** avec **remplissage en masse** depuis l'en-tête.
- **Fenêtre « Ajouter des éléments »** :
  - liste des plans du projet,
  - **« Sélectionner par date »** — tous les plans diffusés à une date donnée,
  - **« Tout sélectionner »**,
  - **sélection par glisser**,
  - deux modes : dernier indice seulement, ou tous les indices,
  - **exclusion automatique des plans déjà envoyés** (clé `N° Plan + Indice`).
- **Génération du PDF** avec logo.

**Écritures.** `Envois`.

**Points d'attention.**
- Le bordereau est un **document transmis à des tiers** : son gabarit (logo,
  mentions, numérotation) mérite d'être spécifié formellement.

---

### 7.6 `Planning Projet` — Planning de production documentaire

**Objet.** Piloter, pour chaque tâche, la chaîne données d'entrée → coffrage →
armature → démarrage travaux, avec suivi du réalisé, des retards et de la
clôture. **Application la plus riche fonctionnellement.**

**Utilisateurs.** Chargés d'études, responsables d'affaire.

**Données.** L `Projets2`, `ListePlan_NDC_COF`, `References2` ·
L/**E** `Planning_Projet`.

**Fonctions.** `[FACTUEL]` — 16 730 lignes.

**Barre d'outils**
- Navigation : `<` période précédente · **Aujourd'hui** · `>` période suivante.
- Zoom : **Semaine / Mois / Année**, avec libellé dynamique de la période.
- Filtres : **Projet**, **Zone**.
- **Bascule Édition** : le planning est en lecture seule par défaut ; l'édition
  doit être déverrouillée explicitement, et chaque action vérifie ce
  déverrouillage.

**Frise chronologique**
- Une ligne par tâche, ordonnée Zone → Ligne de planning → ID → Type de document
  → Tâche, avec **en-têtes de zone**.
- **Phases colorées par type de document** (coffrage, armature, note de calcul,
  coupes, démolition, générique).
- **Scission de chaque phase à l'instant présent** : la portion écoulée est plus
  foncée, la portion à venir garde la couleur normale — le tout sur une seule
  barre continue dont la couleur change au niveau du trait « aujourd'hui ».
- **Trait rouge vertical « aujourd'hui »**.
- **Marqueur de démarrage de travaux** (vert clair, pleine hauteur).
- **Bande « Données d'entrées »** : réception des documents bloquants, rattachée
  à la ligne de planning.
- **Axe de temps figé** en haut, **volet gauche redimensionnable** (largeur
  mémorisée).

**Édition**
- **Édition des durées directement en cellule** (`Duree_1`, `Duree_2`,
  `Duree_3`).
- **Glisser-déposer des lignes** pour les réordonner, avec aperçu, détection de
  la zone cible, et **déplacement automatique des lignes armature liées** à une
  ligne coffrage.
- **Dépôt d'une tâche MS Project** sur une ligne de planning → liaison et
  récupération de la date de démarrage travaux.
- **Gestion des zones** : fenêtres « Ajouter une zone » et « Modifier Zone »
  (renommer / supprimer), avec propagation multi-tables et contrôle d'unicité.
- **Justification de retard** → colonne `Remarque`.
- **Détail de référence** : consultation et mise à jour des données d'entrée
  directement depuis le planning.
- **Clôture** d'une ligne de planning (§8.6).

**Calculs automatiques**
Recalcul des retards, du pourcentage réalisé à partir des indices,
synchronisation avec la liste de plans, calcul des dates de diffusion coffrage.

**Alertes**
Les alertes de planning calculées ici sont exposées aux autres applications et
consommées par `gestion-depenses2` (fenêtre « Alertes planning »).

**Écritures.** `Planning_Projet` (massif), `References2` (dates limites),
`ListePlan_NDC_COF` et `Projets2` (zones).

**Points d'attention.**
- **Mises à jour optimistes** : l'interface est mise à jour avant confirmation
  de Grist, pour la fluidité.
- **File d'attente de rafraîchissement** pour éviter les rafraîchissements
  concurrents.
- Traces de performance instrumentées dans le code.
- Un seul test unitaire (sur la clôture).

---

### 7.7 `MS Project` — Import et visualisation du planning travaux

**Objet.** Importer le **planning travaux produit par le service Méthodes** sous
Microsoft Project, et le visualiser pour le confronter au planning d'études.

**Origine des fichiers** `[FACTUEL]` : les plannings travaux sont établis et
maintenus par le **service Méthodes** sous Microsoft Project. L'application les
importe au format XML de Microsoft Project.

C'est le **seul point d'interface de la plateforme avec un autre service**, et
donc une dépendance externe à signaler dans le document. À noter que Méthodes
fait partie des services vers lesquels la plateforme doit s'étendre : ce qui est
aujourd'hui un échange de fichiers pourrait devenir un usage partagé du même
outil.

**Utilisateurs.** Chargés d'études, planificateurs.

**Données.** L/**E** `MsProject`, L/**E** `Planning_Projet`, L `Projets2`.

**Fonctions.** `[FACTUEL]`

- **Sélecteur de planning**, alimenté depuis les plannings déjà importés.
- **Import XML** — le cœur de l'application (environ 180 lignes) :
  - contrôle de l'extension `.xml`,
  - analyse de la structure MS Project : tâches, identifiants uniques, niveaux
    hiérarchiques, dates de début et de fin, **durées ISO 8601 converties en
    jours ouvrés**,
  - lecture des **attributs étendus** et des **codes hiérarchiques**
    personnalisés, par identifiant de champ ou par alias,
  - résolution des **styles de barre** — **21 catégories reconnues**
    (annexe 13.6),
  - **remplacement ou ajout** : réimporter un planning du même nom remplace les
    lignes existantes,
  - écriture **par lots de 200 actions**.
- **Frise chronologique** : navigation, zoom Semaine / Mois / Année, axe figé,
  grille et repère « heure courante » dessinés à la main.
- **Trois modes de tri** : ordre du fichier XML (défaut), chronologique, numéro
  de planning.
- **Édition des dates** en cellule.
- **Glisser-déposer d'une tâche** vers `Planning Projet`.
- **Synchronisation des démarrages de travaux** : après un import ou une
  modification de date de début, les lignes de `Planning_Projet` liées sont
  mises à jour automatiquement (environ 210 lignes de code dédiées).
- **Info-bulles au survol**.

**Écritures.** `MsProject` (remplacement / ajout / modification),
`Planning_Projet` (colonne `Demarrages_travaux`).

**Points d'attention.**
- **Hors filtrage projet/service** — choix assumé.
- L'ouverture de l'écran charge la table `MsProject` complète.
- Le **format attendu n'est pas documenté** : champs personnalisés et codes
  hiérarchiques utilisés. Comme les fichiers viennent du service Méthodes, un
  changement de leur côté (renommage d'un champ personnalisé, nouvelle
  convention de nommage des styles de barre) peut casser l'import sans
  prévenir. C'est le point le plus utile à formaliser sur cette
  application. `[INFÉRÉ]`
- **Aucun test unitaire.**

---

### 7.8 `Time-Out` — Congés et absences

**Objet.** Permettre à chaque collaborateur de poser ses jours d'absence au
demi-jour, sur un planning d'équipe partagé.

**Utilisateurs.** Tous les collaborateurs, plus les administrateurs.

**Données.** L `Team` · L/**E** `Time-Out`.

**Fonctions.** `[FACTUEL]` — Application entièrement spécifiée avant
développement (`docs/superpowers/specs/2026-07-10-time-out-design.md`).

- **Quatre types d'absence exactement** : `Congé Payé` (bleu), `RTT` (vert),
  `Congé Parental` (violet), `Congé Non Payé` (gris). Volontairement : ni
  commentaire, ni statut, ni solde, **ni circuit de validation** — c'est un
  choix durable, l'outil sert à voir qui est absent, pas à approuver.
- **Tableau** : une ligne par membre de `Team`, **groupées par service**.
- **Granularité demi-journée** (matin / après-midi), **week-ends exclus et
  grisés**.
- **Navigation** : `‹` / Aujourd'hui / `›`, zoom **Semaine / Mois / Trimestre**,
  libellé de plage lisible (« 1 juillet 2026 → 29 septembre 2026 »).
- **Création par glisser** : segment fantôme aimanté au demi-jour, **rouge en
  cas de chevauchement** avec une absence existante de la même personne.
- **Fenêtre de choix du type** au relâchement ; annuler n'écrit rien.
- **Clic droit** sur une absence → Modifier / Supprimer.
- **Grisage** : sa propre ligne est modifiable, les autres sont grisées ; pour
  un administrateur, aucune ligne n'est grisée.
- **Identification de l'utilisateur** via la colonne censurée `Team.Moi` (§6.5).
- Mémorisation locale de la période affichée.

**Écritures.** `Time-Out` — une ligne par absence.

**Points d'attention.**
- **Seule application dont la sécurité est appliquée côté serveur** (§6.6).
  C'est la référence à généraliser.
- **Stockage 100 % en colonnes Text, sans aucune formule** — décision explicite
  de **portabilité** en cas de migration hors Grist. Bon exemple à valoriser.
- **11 fichiers de tests unitaires** — l'application la mieux testée après
  `planning-synchro`.
- Prérequis : chaque utilisateur doit se connecter avec **l'email exact** de sa
  ligne `Team`.

---

### 7.9 `Avancement` — Tableau de bord d'avancement

**Objet.** Mesurer l'avancement de la production d'un projet en croisant les
plans produits, les indices atteints, le budget et les dépenses.

**Utilisateurs.** Responsables d'affaire, direction.

**Données.** L `Budget`, `ProjectTeam`, `TimeReal`, `Planning_Projet`,
`ListePlan_NDC_COF` · L/**E** `Projets2.Avancement`.

**Fonctions.** `[FACTUEL]`

- **Configuration des indices cibles par type de document** : quel indice
  signifie qu'un document est terminé (minimum sélectionnable `0`, `A`, `B` ;
  défaut coffrage `A`).
- **Configuration de la progression budgétaire** par chapitre.
- **Ordre imposé des types de documents** : NDC → Démolition → Fond de plans →
  Coffrage → Coupes/Détails → Armatures.
- **Trois graphiques** : Avancement détaillé par type (barres empilées),
  Avancement des dépenses (réelles vs budget restant), Avancement général
  (valeur faite vs restante).
- **Indices moyens** par type de document.
- **Statistiques** : nombre de plans par type, par indice, totaux.
- **Ventilation budgétaire**.
- **Dépenses réelles** = pointage réel × taux journalier.

**Écritures.** `Projets2.Avancement`, uniquement le bloc du service actif.

**Points d'attention.**
- Messages d'erreur explicites en cas de JSON invalide dans la colonne
  `Avancement` — bon exemple de robustesse.
- En service externe, l'écran passe en consultation seule.
- Cette application est **réimplémentée sous forme de module** dans
  `gestion-depenses2` et réutilisée par `Gestion-globale` : trois écrans
  affichent la même chose par trois chemins de code. `[À TRANCHER]` —
  consolidation à envisager.

---

### 7.10 `planning-synchro` — Planning et plan de charge sur une frise unique

**Objet.** Afficher, **sur une seule frise chronologique**, le planning projet
(lecture seule, en haut) au-dessus du **plan de charge prévisionnel** (éditable,
en bas), pour ajuster la charge en regard des jalons d'étude.

**Utilisateurs.** Responsables d'affaire, chefs de groupe.

**Données.** L `Projets2`, `Planning_Projet`, `ProjectTeam`, `Team`,
`Time-Out`, `References2` · L/**E** `TimeSegment`.

**Histoire de cette application** `[FACTUEL]` — à raconter dans le document,
c'est un bon exemple de maturité technique :

> Deux versions précédentes résolvaient le même besoin en **embarquant deux
> applications dans deux iframes**, synchronisées par mesure du DOM, décalage en
> pixels et ré-essais temporisés. Trois familles de bugs revenaient sans cesse :
> désynchronisation des deux frises au zoom ou au déplacement, lenteurs et
> à-coups dus à la boucle de mesure-correction, et instabilité au chargement ou
> au changement de projet.
>
> `planning-synchro` remplace cette architecture par **deux moteurs de rendu
> dans un seul document**, pilotés par un **unique contrôleur**. Une définition
> unique de la fenêtre temporelle est calculée par toute interaction et
> appliquée aux deux volets dans un seul cycle d'affichage. Les deux volets
> vivant dans le même document, à la même largeur, et recevant les mêmes
> nombres, **l'alignement au pixel devient une propriété arithmétique vraie par
> construction** plutôt qu'un résultat à mesurer puis corriger. La boucle de
> correction disparaît, remplacée par une simple alerte de contrôle.

**Volet haut — planning (lecture seule)**
- Reproduit exactement le rendu de `Planning Projet` : mêmes phases, couleurs,
  états réalisé/retard, en-têtes de zone, info-bulles.
- Colonne de gauche réduite au libellé de tâche ; l'identité complète est en
  info-bulle.
- Hauteur bornée entre **5 et 16 lignes** (défaut 10), avec **séparateur
  déplaçable** (souris et clavier), **axe de temps figé** et défilement vertical
  interne.
- **Glisser horizontal** = déplacement dans le temps ; **molette sur l'axe** =
  zoom ; **molette sur les lignes** = défilement vertical.
- **Mode « Rassembler visuellement le planning »** : agrégation par type de
  document, une ligne par type, info-bulle listant toutes les tâches concernées.
- **Vue « Graphique »** en alternative à la frise : courbes du nombre de tâches
  à réaliser par mois, une ligne par type de document plus une ligne Total,
  **chaque ligne doublée d'une courbe pointillée « (réalisé) »**, axe temporel
  coordonné avec la frise, et **filtre par cases à cocher** par type.
- Bornes de la frise = union de la plage de charge et de la plage des phases de
  planning ; fenêtre maximale de **14 mois**.

**Volet bas — plan de charge (éditable)**
- **Toutes les personnes** affectées au projet, même sans charge planifiée.
- Regroupement par rôle : Projeteurs / Ingénieurs / Autres.
- **Segments créés par glisser** au demi-jour, avec aperçu aimanté et détection
  de chevauchement.
- **Clic droit** → Modifier / Supprimer.
- **Fenêtre « Modifier le segment »** : début et fin au demi-jour
  (Matin / Après-midi), **jours effectifs travaillés** optionnel, **jours
  disponibles dans la plage** recalculés en direct, avec contrôles de
  chevauchement et de cohérence (multiple de 0,5, inférieur ou égal aux jours
  disponibles).
- **Ligne « Total »** en lecture seule : par mois visible, total des
  jours-personne planifiés, avec barre de remplissage proportionnelle.

**Écritures.** `TimeSegment`.

**Points d'attention.**
- **19 fichiers de tests unitaires** — l'application la mieux testée.
- **Harnais de développement** permettant de travailler et de recetter **sans
  document Grist**, avec un faux `window.grist`, des données fictives, et les
  écritures capturées pour vérification automatisée. **Bonne pratique à
  généraliser.**
- Contient trois modules **copiés** depuis `Planning Projet` → risque de
  divergence du rendu entre les deux écrans.

---

### 7.11 `gestion-depenses2` — Gestion économique d'un projet

**Objet.** Piloter l'économie d'un projet : budget, équipe, plan de charge,
pointage prévisionnel et réel, dépenses, facturation. **Application la plus
volumineuse (18 922 lignes).**

**Utilisateurs.** Responsables d'affaire, contrôle de gestion, direction.

**Données.** L/**E** `Projets2`, `Budget`, `ProjectTeam`, `Timesheet`,
`TimeSegment` · L `ListePlan_NDC_COF`, `Planning_Projet`, `TimeReal`, `Team`,
`Time-Out`, `Emetteurs`.

**Fonctions.** `[FACTUEL]` — organisées en sections :

| Section | Contenu |
|---|---|
| **Projets** | Liste, création rapide avec lignes de budget |
| **Avancement des plans** | Reprise du tableau de bord d'avancement (§7.9) |
| **Rapport KPI** | Indicateurs synthétiques du projet |
| **Gestion — Plan** | Vue de gestion mensuelle, distinguant jours ouvrés et jours calendaires |
| **Gestion — Équipe** | Ajout/retrait de collaborateurs, **taux journalier** éditable, regroupement par rôle |
| **Prévisionnel — Pointage** | Plan de charge au demi-jour (voir ci-dessous) |
| **Prévisionnel — Dépense** | Frise mensuelle : jours de charge × taux journalier |
| **Réel — Pointage** | Jours réellement travaillés par collaborateur et par mois, groupés par année puis par rôle |
| **Dépenses réelles** | Calcul depuis le pointage réel |
| **Graphique des dépenses** | Graphique avec **éditeur de pourcentage de facturation intégré** |
| **Modifier le budget** | Fenêtre d'édition des lignes budgétaires |
| **Alertes planning** | Fenêtre listant les alertes remontées par `Planning Projet` |

**Le plan de charge** — pièce technique notable :
- Segments créés, déplacés et redimensionnés par glisser, au demi-jour.
- **Attribution automatique de couloirs** en cas de chevauchement.
- **Zoom molette** avec pas adaptatif (1 à 21 jours par cran).
- **Défilement virtuel** permettant de tenir **144 mois** de plage sans dégrader
  l'affichage.
- Trois modes de densité : Semaine (34 px/jour), Mois (16), Année (7).
- **Comptage des tâches de planning chevauchant la plage** — mise en regard
  directe de la charge et de la production prévue.

**Règles de calcul notables** : dépenses prévisionnelles et réelles, cumuls
antérieurs de dépense et de facturation, conversion pourcentage ↔ montant de
facturation, détermination automatique des bornes temporelles d'un projet.

**Écritures.** `Projets2` (facturation, avancement), `Budget`, `ProjectTeam`,
`Timesheet`, `TimeSegment`.

**Points d'attention.**
- Synchronisation avec les autres écrans via le navigateur, avec des mécanismes
  de suppression de boucles — héritage de l'ancienne architecture en iframes.
- 3 fichiers de tests pour 18 922 lignes.

---

### 7.12 `Gestion-globale` — Vue consolidée multiprojets

**Objet.** Consolider les indicateurs économiques et d'avancement sur plusieurs
projets, avec filtre par direction opérationnelle.

**Utilisateurs.** Direction, contrôle de gestion.

**Fonctions.** `[FACTUEL]`

- **Deux modes de sélection** : « Un projet » / « Plusieurs projets », avec
  « Tout sélectionner ».
- **Filtre DOP** multi-valeurs (+ « Sans DOP »).
- **Synthèse** : indicateurs globaux agrégés.
- **Avancement des plans** agrégé sur plusieurs projets.
- **Navigation Mois / Année** sur les dépenses.
- Prévisionnel, dépenses réelles et graphique, agrégés.
- **Diagnostics** : conflits de DOP, lignes non appariées.

**Écritures.** Aucune identifiée — consultation. `[INFÉRÉ]`

**Points d'attention.**
- Réutilise `gestion-depenses2` **par import de chemin relatif** : déplacer ou
  renommer `gestion-depenses2` casse cette application, sans avertissement.

---

### 7.13 `Gestion-User` — Taux d'occupation des collaborateurs

**Objet.** Visualiser la répartition hebdomadaire de la charge par collaborateur
et par projet, sur une année.

**Utilisateurs.** Chefs de groupe, direction.

**Données.** L `TimeSegment`, `Team`, `Projets2`.

**Fonctions.** `[FACTUEL]`

- **Navigation par année**.
- **Filtres** : Service, Rôle, DOP, et **sélection multiple de projets**.
- **Tableau « Répartition hebdomadaire par employé et projet »** avec **colonne
  d'en-tête figée** et zone temporelle défilante.
- **Matrice de taux d'occupation hebdomadaire**, cellules colorées selon le
  taux, regroupement par semaines ISO.
- **Comptage en demi-journées ouvrées**.
- Signalement des collaborateurs présents dans les segments mais absents de
  l'annuaire.

**Écritures.** Aucune — consultation.

**Points d'attention.** Aucun test unitaire.

---

### 7.14 `gestion-equipe` — Administration de l'équipe et des projets

**Objet.** Administrer l'annuaire, le registre des DOP, et réaliser les
opérations sensibles de **renommage et renumérotation de projet** avec
propagation dans toutes les tables.

**Utilisateurs.** Administrateurs.

**Données.** L/**E** `Team`, `Projets2`, `Emetteurs` · propagation en écriture
dans `Planning_Projet`, `References2`, `ListePlan_NDC_COF`, `MsProject`,
`Envois`, `Budget`, `ProjectTeam`, `TimeSegment`, `TimeReal` ·
L métadonnées Grist.

**Fonctions.** `[FACTUEL]`

**Gestion des membres**
- Tableau `Team` **groupé par service puis par rôle**, avec repli/dépli des
  groupes et conservation de la position de défilement.
- Ajouter / Modifier / Supprimer un membre : Prénom, Nom, Email, Service, Rôle,
  IdTrefle, Externe.
- **Détection de doublon** avant enregistrement.

**Attribution DOP**
- Sélection Projet + DOP, écriture dans `Projets2.DOP`.
- **Registre des DOP** extensible.

**Modification d'un projet — la fonction la plus sensible de la plateforme**
- Saisie d'un nouveau nom et/ou d'un nouveau numéro.
- **Prévisualisation obligatoire** avant application :
  - découverte dynamique du schéma via les métadonnées Grist,
  - identification des **colonnes réellement inscriptibles** — exclusion des
    colonnes-formules, prise en compte des colonnes de type Référence,
  - recherche dans **11 tables**, chacune avec jusqu'à **7 noms de colonnes
    candidats**,
  - **refus si la mise à jour est ambiguë** (plusieurs correspondances
    possibles, doublon de valeur),
  - **tableau de prévisualisation** : Table / Nombre de lignes modifiées,
  - **signature de contrôle** garantissant que ce qui est appliqué correspond
    exactement à ce qui a été affiché.

**Écritures.** `Team`, `Projets2`, `Emetteurs`, et **propagation en masse dans
11 tables**.

**Points d'attention.**
- **Application la plus puissante** du périmètre : 13 tables en écriture.
- **Hors filtrage projet/service** — choix assumé (c'est un outil
  d'administration).
- `[INFÉRÉ]` Aucun contrôle vérifiant que l'utilisateur est bien administrateur
  n'a été identifié dans le code : la protection repose sur le fait que la page
  n'est pas exposée aux non-administrateurs dans Grist.
- **Aucun journal des modifications de masse** : après une propagation sur 11
  tables, il n'existe pas de trace exploitable de ce qui a été modifié.
- **Aucun test unitaire.**

Ces trois derniers points sont ceux sur lesquels l'avis du service informatique
est le plus utile.

---

### 7.15 `gestion-acces-interservices` — Administration des affectations

**Objet.** Administrer les affectations projet ↔ personne, c'est-à-dire les
droits d'accès au sens de la règle du §6.2.

**Utilisateurs.** Administrateurs.

**Données.** L `Projets2`, `ProjectTeam` · L/**E** `Team.Projets_Access`.

**Fonctions.** `[FACTUEL]`

- **Contrôle de prérequis au démarrage** : si `Team.Projets_Access` n'existe
  pas, l'écran affiche « Configuration requise » et **refuse de fonctionner**.
  Il ne crée jamais la colonne.
- **Sélection d'un projet** : liste, recherche par numéro ou par nom, affichage
  du numéro, du nom et des **alias** connus.
- **Personnes affectées** : liste avec, pour chacune, le service, le rôle et la
  **source** de l'affectation (`ProjectTeam`, ajout manuel, ou les deux).
- **Ajouter des personnes** : recherche, sélection multiple, ajout au projet.
- **Révocation** d'un ajout manuel.
- **Diagnostic** des noms `ProjectTeam` non reconnus ou ambigus (§6.4).
- Tri respectant l'ordre alphabétique français.
- Émet un signal invitant les autres écrans à recharger leurs droits.

**Écritures.** `Team.Projets_Access` uniquement.

**Règle de sécurité fonctionnelle** : **ne supprime jamais une ligne
`ProjectTeam`**. Retirer un ajout manuel ne retire donc pas l'accès si la
personne reste affectée au projet.

**Points d'attention.**
- C'est l'outil qui **donne et retire les accès** : le sujet de la traçabilité
  s'y pose directement. `[INFÉRÉ]` Aucun journal d'audit identifié.
- **Aucun test unitaire.**

---

## 8. Règles de gestion automatisées

### 8.1 Sélection de projet partagée entre écrans

`[FACTUEL]` — Deux mécanismes complémentaires, chacun sur son terrain.

**1. Le projet sélectionné — stockage local du navigateur.**
Quand un écran change de projet, les autres écrans **du même poste** suivent.

| Clé | Rôle |
|---|---|
| `grist.selected-project-id` | identifiant du projet courant |
| `grist.selected-project` | nom du projet courant |
| `grist.selected-service` | service actif |
| `grist.project-access-changed` | signal : droits modifiés |
| `grist.dop-data-changed` | signal : registre DOP modifié |
| `grist.project-data-changed` | signal : projet renommé ou renuméroté |

Ce mécanisme est adapté à ce qu'il fait : une préférence d'affichage locale n'a
pas à traverser le réseau. `[INFÉRÉ]` — Sa limite est qu'il ne franchit pas la
frontière du poste.

**2. Les données modifiées — colonnes-signal dans `Projets2`.**
C'est le mécanisme décrit en **§4.7 bis**, et c'est lui qui a remplacé
l'interrogation périodique. Il passe par Grist, donc il **traverse les postes** :
une modification faite par un collègue se répercute immédiatement sur l'écran
d'un autre.

**Ce que cela change concrètement** :

| Avant | Maintenant |
|---|---|
| Relecture toutes les 30 secondes, que quelque chose ait changé ou non | Relecture **uniquement quand une donnée a changé** |
| Jusqu'à 30 secondes de retard | Mise à jour immédiate |
| Toutes les tables surveillées rechargées | **Seules les tables concernées** par le signal |
| Trafic réseau permanent | Trafic proportionnel à l'activité réelle |

### 8.2 Segments au demi-jour

`[FACTUEL]` — Modèle commun à `gestion-depenses2`, `planning-synchro` et
`Time-Out`.

Conventions : matin = 08:00 → 12:00, après-midi = 13:00 → 17:00. Week-ends
exclus du décompte.

Règles de validation lors de la modification d'un segment :
- effectif **multiple de 0,5** ;
- effectif **inférieur ou égal** au nombre de jours disponibles dans la plage ;
- **pas de chevauchement** avec un autre segment de la même personne ;
- aimantation au demi-jour pendant le glisser.

### 8.3 Jours fériés français

`[FACTUEL]` — Module dédié, avec tests. Calcul des jours fériés fixes et mobiles
(Pâques et dérivés). Utilisé pour exclure les jours non travaillés du calcul de
charge.

### 8.4 Prise en compte des absences dans la charge

`[FACTUEL]` — Le plan de charge tient compte des absences saisies dans
`Time-Out` : les demi-journées d'absence sont retirées des jours disponibles.
Fonctionnalité spécifiée puis testée.

### 8.5 Calcul du réalisé

`[FACTUEL]`

```
Réalisé(tâche) = f( indice courant , indice cible du type de document )
```

- Les indices sont ordonnés (`0` < `A` < `B` < `C` …).
- L'indice cible est lu dans `Projets2.Avancement`, bloc du service actif.
- Une valeur par défaut s'applique si rien n'est configuré (coffrage : `A`).
- Une tâche est considérée réalisée à 100 % quand la valeur atteint 100.

### 8.6 « Réalisation forcée » d'une ligne de planning

`[FACTUEL]` — Fonctionnalité récente (août 2026), portée par le socle commun
(`shared/planning-closure-core.js`) et couverte par des tests dans deux
applications. Appelée « réalisation forcée » dans l'interface, elle s'appuie sur
la colonne `Planning_Projet.Date_Cloture`.

**Règle en vigueur** — un document de planning est compté comme *fait* si :

```
   une date de clôture est renseignée        (réalisation forcée)
OU son indice a atteint l'indice cible       (réalisation normale)
```

Détail de la seconde branche : si aucun indice n'est renseigné → non fait ; si
aucun indice cible n'est défini pour le type de document → considéré comme fait ;
sinon comparaison de rang (`0` < `A` < `B` < `C` …).

**Ce que l'utilisateur peut faire** : renseigner une date de clôture sur une
ligne, ou la retirer. L'action est donc **réversible**.

**Propagation** : la clôture est rapprochée du plan correspondant dans la liste
des plans, par identité de document (numéro, type, zone). Un rapprochement
**ambigu** — par exemple le même numéro dans deux zones alors que la zone source
est vide — **ne propage jamais** la clôture, pour éviter de clôturer le mauvais
plan.

**Garde-fou technique** : si la colonne `Date_Cloture` est absente de
l'environnement, la fonction est désactivée avec un message explicite plutôt que
de produire une erreur.

**Traitement des dates** : le module traite les dates comme des **dates
calendaires** et non comme des instants, en conservant la partie `AAAA-MM-JJ`
sans conversion UTC — correction explicite d'un bug de décalage d'un jour.

**Le cas d'usage métier** `[FACTUEL]` — indispensable pour rendre la règle
compréhensible :

> Chaque type de plan a un **indice par défaut** qui marque son achèvement (par
> exemple `A` pour un plan de coffrage). Il arrive qu'**un plan soit validé
> avant d'avoir atteint cet indice** : il est bon, il est diffusé, il n'a pas
> besoin d'une révision supplémentaire. Sans la réalisation forcée, ce plan
> resterait indéfiniment compté comme non terminé et fausserait l'avancement du
> projet.
>
> La réalisation forcée permet donc de dire : « ce plan est terminé à cette
> date », indépendamment de son indice. L'action est réversible et la date
> saisie est conservée, ce qui garde la décision traçable.

### 8.7 Génération des documents PDF

`[FACTUEL]` — Deux producteurs :
- **Bordereau de transmission** : logo, en-tête projet, tableau des plans,
  numéro et date.
- **Liste des plans** : sélection des types, **ordre des zones personnalisable**.

Ces documents sortent de l'entreprise : leur gabarit est un livrable à part
entière.

### 8.8 Propagations automatiques entre tables

`[FACTUEL]` — Récapitulatif des automatismes. C'est le cœur de la valeur métier
de la plateforme : la saisie unique.

| Déclencheur | Effet automatique |
|---|---|
| Import MS Project | Création des tâches ; mise à jour des démarrages de travaux dans `Planning_Projet` pour les lignes liées |
| Modification d'une date MS Project | Même mise à jour |
| Dépôt d'une tâche MS Project sur le planning | Création de la liaison entre les deux |
| Création d'un document (3 écrans possibles) | Lignes créées simultanément dans `ListePlan_NDC_COF`, `Planning_Projet` et `References2` |
| Modification d'une date limite de donnée d'entrée | Répercutée dans `Planning_Projet` |
| Renommage ou suppression d'une zone | Propagée dans 4 tables |
| Modification d'un type de document | Propagée entre liste de plans et planning |
| Renommage ou renumérotation d'un projet | Propagée dans 11 tables |
| Recalcul du planning | Retards, réalisé, dates de diffusion coffrage |

**Point à signaler** : ces règles sont implémentées **dans le JavaScript des
applications**. Les déplacer côté Grist (formules, colonnes calculées) les
rendrait indépendantes de l'écran utilisé. Bon sujet de discussion technique
avec le service informatique.

### 8.9 Robustesse : les défenses présentes dans le code

`[FACTUEL]` — Motifs récurrents, chacun documentant un problème réellement
rencontré :

| Défense | Problème traité |
|---|---|
| Normalisation systématique des valeurs (`null`, objets, tableaux) | Les valeurs renvoyées par Grist ne sont pas toujours du type attendu |
| Listes de noms de colonnes candidats | Les noms de colonnes ont varié dans le temps |
| Listes de noms de tables candidats | Idem pour les tables |
| Traitement des dates en calendrier local | **Décalages de fuseau horaire** — bug récurrent |
| Écritures découpées en lots | Limites de taille des actions Grist |
| Normalisation des textes (accents, casse, ponctuation) | Qualité des saisies |
| Lecture des nombres au format français | Virgule décimale |
| Mises à jour optimistes + file de rafraîchissement | Latence des allers-retours avec Grist |

Ces défenses expliquent une part importante du volume de code. Les supprimer
suppose de **traiter leur cause** : typage strict des colonnes, références
stables, fuseau horaire unique. C'est un axe d'amélioration structurel.

---

## 9. Qualité, tests et documentation

### 9.1 Tests unitaires

`[FACTUEL]` — **50 fichiers de tests, 352 tests, exécutés avec `node --test`.
Résultat au 12 août 2026 : 352 réussites, 0 échec.**

| Périmètre | Tests | Couverture |
|---|---|---|
| `shared` (socle) | **149** | droits, politique de filtrage par table, repli REST, relais de synchronisation, **couverture de synchronisation de tous les widgets** |
| `planning-synchro` | **86** | fenêtre temporelle, dates, phases, segments, plan de charge, graphique, accès aux données, réception des références, jours fériés, absences |
| `Time-Out` | **36** | tableau, configuration, dates, édition, jours fériés, accès aux données, identités, segments texte |
| `Reference2` | **32** | édition groupée, dates limites, rendu du tableau |
| `gestion-depenses2` | **23** | jours fériés, absences, clôture, lecture seule, sélecteurs, couverture de synchronisation |
| `ListeDePlan` | **14** | format de dates, relais de synchronisation |
| `Planning Projet` | 7 | clôture |
| `MS Project` | 5 | accès aux données |

**Point remarquable à mettre en avant** : le socle contient des tests qui
vérifient l'**architecture elle-même**, pas seulement des fonctions isolées —
par exemple que tous les widgets livrés sont bien déclarés, qu'aucun n'arme de
minuterie de relecture, que chaque écran branché sur le socle observe au moins
une table, et que `gestion-depenses2` surveille bien toutes les tables qu'il
relit. Ce sont des garde-fous contre la régression d'architecture, ce qui est
rare dans un projet de cette taille.

**Sans test dédié** : `creation-projet`, `Bordereau`, `EnAttente`,
`gestion-equipe`, `Gestion-globale`, `Gestion-User`, `Avancement`,
`gestion-acces-interservices` — étant entendu que leur comportement de
synchronisation est couvert par les tests du socle.

### 9.2 Exécution

```bash
cd planning-synchro && node --test "tests/**/*.test.mjs"
```

**Les tests ne sont pas exécutés automatiquement** : le déploiement ne les
déclenche pas. Correction simple et à fort rendement.

### 9.3 Harnais de développement

`[FACTUEL]` — `planning-synchro` dispose d'un environnement de développement
autonome :

```
planning-synchro/dev/
  harness.html     page de développement, hors Grist
  mock-grist.js    faux window.grist
  fixtures.js      jeu de données fictives
```

Les écritures faites via ce faux Grist sont **appliquées aux données fictives en
mémoire** et **capturées** pour pouvoir vérifier par script qu'une interaction
produit bien les actions attendues.

C'est la seule façon de développer et de recetter sans toucher au document réel.
**À généraliser.**

### 9.4 Documentation existante

`[FACTUEL]` — Point fort réel du projet, à mettre en avant :

| Document | Contenu |
|---|---|
| `docs/service-access/README.md` | Architecture de la gestion des accès |
| `docs/service-access/MIGRATION.md` | Prérequis de données + 12 cas de recette |
| `docs/service-access/PERMISSIONS_AVANCEES.md` | Cadrage des règles d'accès à venir |
| `docs/superpowers/specs/` | **8 spécifications de conception datées**, écrites avant développement |
| `docs/superpowers/plans/` | **8 plans d'implémentation** correspondants |
| `planning-synchro/README.md` | Conception détaillée de l'application |
| `graphify-out/GRAPH_REPORT.md` | Cartographie automatique du code : 3 364 éléments, 8 059 relations |

Les spécifications de `docs/superpowers/specs/` sont particulièrement
convaincantes : décisions de conception explicitées, argumentées et datées, avec
un périmètre volontairement borné (section « hors périmètre » assumée).

**Documentation utilisateur** `[FACTUEL]` — elle existe aussi, et **couvre
l'ensemble de la plateforme** : un **manuel PDF** (`Manuel_Gestion.pdf`) est
déposé sur le serveur de fichiers du service, dans l'arborescence qualité
(processus général). Le dossier `guide/` est une petite page qui affiche ce
chemin réseau et permet de le copier en un clic depuis les widgets.

C'est un point fort à mentionner : les utilisateurs disposent d'un manuel
complet, rangé dans le référentiel qualité du service — la plateforme n'est pas
livrée sans mode d'emploi.

Deux remarques mineures :
- le manuel est un **PDF sur un partage réseau**, donc hors du dépôt et sans
  versionnement lié au code : son actualisation au fil des évolutions repose sur
  une discipline manuelle ;
- la page `guide/` réutilise la feuille de style du dossier `Gestion-Prev/`,
  classé hors périmètre. Un petit nettoyage la rendrait autonome.

### 9.5 Ce qui manque

| Manque | Conséquence |
|---|---|
| Aucun gestionnaire de dépendances | Dépendances non tracées |
| Aucun linter ni formateur | Style hétérogène entre générations de code |
| Tests non exécutés automatiquement | Régressions possibles |
| Aucun environnement de recette | Validation en production |
| Aucun journal d'audit applicatif | Pas de trace des actions sensibles |
| Aucune supervision | Pannes signalées par les utilisateurs |
| Procédure de sauvegarde et de restauration documentée | Risque en cas d'incident |

> La documentation utilisateur, elle, **existe** (manuel PDF sur le partage
> réseau) — voir §9.4.

---

## 10. Limites connues et points d'attention

### 10.1 Synthèse

| # | Point | Portée | Statut |
|---|---|---|---|
| L1 | **Le cloisonnement projet/service est calculé dans le navigateur**, donc contournable. Seule `Time-Out` est protégée côté serveur. | Sécurité | Connu, documenté, non traité |
| L2 | **`Projets2.Avancement`** mélange les trois services dans une cellule : cloisonnement impossible, risque d'écrasement | Sécurité + données | Connu, documenté |
| L3 | **Jointures par texte** entre projets, données et personnes | Données | Connu, évolution recommandée par l'auteur |
| L4 | **`gestion-equipe`** écrit dans 13 tables, sans contrôle d'habilitation identifié ni journal | Sécurité + exploitation | À traiter |
| L5 | **Dépendances CDN non épinglées** | Technique | Correction simple |
| L6 | **Aucun environnement de recette**, aucun test automatique au déploiement | Exploitation | Correction simple |
| L7 | **Développement mono-contributeur** depuis 2 ans | Continuité | **Point majeur** |
| L8 | **Code dupliqué** : plusieurs modules présents en 2 ou 3 exemplaires | Maintenance | À consolider |
| L9 | **Couplage par chemin relatif** entre `Gestion-globale` et `gestion-depenses2` | Maintenance | À corriger |
| L10 | **Couverture de tests inégale** : 10 applications sur 15 sans test | Qualité | À rattraper progressivement |
| L11 | **Création de projet non transactionnelle** (6 tables) | Données | À évaluer |
| L12 | **Création automatique des colonnes-signal** dans `Projets2` — écart avec le principe « aucune modification silencieuse du schéma » appliqué ailleurs (§4.7 bis) | Données | Assumé, à énoncer |
| L13 | **Aucune trace** des attributions d'accès et des propagations de masse | Exploitation | À traiter |
| L14 | **Format XML MS Project non documenté**, alors que les fichiers viennent d'un autre service | Fonctionnel | À formaliser |
| L15 | Référence morte à la table `Ventilation` | Données | Nettoyage simple |
| L16 | **14 applications sur 15 en service depuis un mois et demi seulement** — peu de recul d'usage | Fonctionnel | Constat de calendrier |
| L17 | **Liste des services figée dans le code** (`Structure`, `Synthese`, `Topographie`) — ajouter `Méthodes` ou un autre service suppose une modification du code (cf. §6.1 bis) | Fonctionnel + technique | **Prérequis de l'extension annoncée** |

### 10.2 Mise en perspective

Deux de ces points sont structurels : **L1** (cloisonnement calculé côté
navigateur) et **L7** (un seul contributeur). Ils sont connus, documentés dans
le dépôt, et la solution du premier a déjà été démontrée sur `Time-Out`.

Les autres sont des corrections d'ingénierie classiques, dont plusieurs (L5, L6,
L15) demandent quelques heures.

**À rappeler pour garder la juste mesure** : la plateforme est utilisée par une
vingtaine de personnes d'un même service, sur 4 projets, sans intervenant
externe. Aucun de ces points ne constitue aujourd'hui un incident ; ils
deviennent significatifs avec l'élargissement de l'usage.

### 10.3 Limites fonctionnelles assumées

`[FACTUEL]` — Choix volontaires, documentés au moment de la conception :

1. **`Time-Out`** : pas de solde de congés, **pas de circuit de validation**
   (choix durable — l'outil sert à visualiser les absences, pas à les
   approuver), pas de statut, pas de commentaire, pas de redimensionnement de
   segment. Périmètre volontairement minimal.
2. **`planning-synchro`** : la bande « Données d'entrées » a été retirée à la
   demande ; le code est conservé pour une éventuelle réactivation.
3. **Tables sans colonne `Service`** (`Team`, `Projets2`, `Time-Out`,
   `Timesheet`) : aucun filtrage par service n'est inventé pour elles.
4. **`ProjectTeam`** est nécessairement chargée en entier au démarrage,
   puisqu'elle est la source des droits.

### 10.4 Points forts à préserver

À faire figurer explicitement dans le document : ce qui fonctionne bien et ne
doit pas être perdu.

1. **La conception de l'alignement des deux frises** dans `planning-synchro` :
   une propriété arithmétique plutôt qu'une boucle de correction. Élimine
   définitivement une classe entière de bugs.
2. **Le modèle de règles d'accès de `Time-Out`** : simple, appliqué côté
   serveur, avec un comportement sûr par défaut.
3. **L'astuce d'identification via la colonne censurée `Team.Moi`** : résout
   proprement un problème sans solution directe.
4. **La prévisualisation avec signature de contrôle** avant modification de
   masse dans `gestion-equipe`.
5. **Le refus de démarrage** de `gestion-acces-interservices` si le prérequis de
   schéma manque : aucune modification silencieuse du schéma.
6. **La règle « ne jamais supprimer une ligne `ProjectTeam` »** : prévient les
   pertes d'accès accidentelles.
7. **Le harnais de développement** de `planning-synchro`.
8. **Le choix « tout en texte, aucune formule »** pour `Time-Out`, motivé par la
   portabilité.
9. **Les spécifications de conception écrites avant développement**, datées, au
   périmètre borné.
10. **L'assistant de génération de documents par motif**, cohérent entre trois
    applications.

---

## 11. Points ouverts à l'avis du service informatique

> **Consigne de rédaction essentielle.** L'objectif du document est que le
> service informatique **sache ce qui est fait**. Ce chapitre ne doit donc
> **pas** être une liste de demandes. Il présente les points techniques que
> l'auteur a identifiés lui-même, sur lesquels un regard extérieur serait
> apprécié — sans engagement attendu.
>
> **Formulation à privilégier** : « J'ai identifié ce point, voici où j'en suis,
> votre avis m'intéresserait. »
> **Formulation à proscrire** : « Le service informatique devra… ».

### 11.0 Ce que ce document ne demande pas

À écrire explicitement, dès la note de synthèse, pour éviter tout malentendu :

- **aucune demande de budget** ;
- **aucune demande de moyens humains** ;
- **aucune demande de reprise du développement** — l'auteur poursuit ;
- **aucune demande de refonte** — Grist reste le socle ;
- **aucune demande de validation formelle** conditionnant la poursuite du projet.

### 11.1 Les deux points que l'auteur signale de lui-même

| Sujet | Où l'on en est |
|---|---|
| **Cloisonnement des accès** | Le filtrage projet/service est aujourd'hui calculé dans le navigateur, donc contournable par quelqu'un qui aurait des droits directs sur le document Grist. La solution est connue et a déjà été appliquée à l'application `Time-Out` : des règles d'accès configurées côté serveur. Reste à la généraliser, et le point technique à résoudre est l'expression fiable de l'appartenance `ProjectTeam`. Cela devient concret avec l'ouverture aux autres services. |
| **Une seule personne** | La plateforme est développée et maintenue par une seule personne. La documentation de conception existe, mais aucun dispositif de reprise n'est formalisé. |

Ces deux points doivent être **énoncés sans dramatisation et sans les
minimiser** : ils sont documentés dans le dépôt depuis longtemps, ce ne sont pas
des découvertes.

### 11.2 Améliorations techniques identifiées

À présenter comme une **feuille de route personnelle**, pas comme des demandes.
Elles montrent que l'auteur connaît son sujet.

| Sujet | Constat |
|---|---|
| **Tests automatiques au déploiement** | 352 tests existent et passent, mais ne sont pas exécutés automatiquement à chaque modification. |
| **Environnement de recette** | Il n'en existe pas ; les évolutions passent directement en service. |
| **Dépendances tierces** | Plusieurs bibliothèques sont chargées sans version épinglée. |
| **Traçabilité des actions sensibles** | Les attributions d'accès et les renommages de projet ne laissent pas de trace exploitable. |
| **Références stables dans le modèle** | Les liens entre projets, données et personnes reposent sur du texte plutôt que sur des références. |
| **Séparation de `Projets2.Avancement`** | Les trois services partagent une même cellule ; une table dédiée serait plus propre. |
| **Filtrage serveur de `MsProject`** | Seule table métier encore lue en entier ; ~40 % du trafic résiduel (§6.9 ter). |
| **Table de section de `Gestion-User`** | Rattachée à `TimeSegment` (25 000 lignes) ; ~10 % du trafic résiduel, incompressible par REST (§6.9 ter). |
| **Consolidation du code partagé** | Quelques modules existent en double ou en triple. |
| **Couverture de tests** | Inégale : très bonne sur les applications récentes, absente sur les plus anciennes. |
| **Nettoyage** | Référence morte à `Ventilation` ; page `guide/` à rendre autonome ; dossiers hérités à archiver. |

### 11.3 Sujets d'exploitation

À mentionner en une phrase chacun, comme des questions que l'auteur se pose,
sans les instruire :

- la **sauvegarde et la restauration** du document Grist ;
- la **supervision** (aujourd'hui, une panne est signalée par les utilisateurs) ;
- le **maintien à jour du manuel utilisateur** au rythme des évolutions.

> **Rappel de cadrage** : ne pas aborder l'hébergement ni l'administration du
> serveur Grist — ces sujets sont hors du périmètre de l'auteur.

---

## 12. Questions restant à trancher

**Aucune question ne reste ouverte.** Le cadrage est complet et le document peut
être rédigé en l'état.

Un seul point mérite d'être vérifié par l'auteur **avant l'extension annoncée**,
mais il ne conditionne pas la rédaction :

| # | Point | Référence |
|---|---|---|
| Q1 | La liste des services est figée dans le code (`Structure`, `Synthese`, `Topographie`). Ouvrir la plateforme à `Méthodes` ou à un autre service suppose de modifier le socle commun, les listes déroulantes de `gestion-equipe` et la structure de `Projets2.Avancement`. | §6.1 bis, §10.1 (L17) |

Le calendrier précis de l'extension (quel service, quand) pourra être ajouté au
document s'il est arrêté d'ici sa transmission.

---

## 13. Annexes

### 13.1 Arborescence du périmètre

```
Dépôt/
├── shared/                          SOCLE COMMUN (2 448 l.)
│   ├── service-context-core.js      noyau de calcul des droits    1 094 l.
│   ├── grist-service-context.js     runtime navigateur            1 083 l.
│   ├── planning-closure-core.js     règles de clôture               271 l.
│   └── tests/                       2 fichiers
│
├── docs/
│   ├── service-access/              README, MIGRATION, PERMISSIONS
│   └── superpowers/{specs,plans}/   16 documents de conception datés
│
├── Reference2/                      Données d'entrée           10 894 l.  +  1 test
├── creation-projet/                 Création de projet          3 871 l.
├── EnAttente/                       Données manquantes          1 805 l.
├── ListeDePlan/                     Liste des plans + PDF      11 344 l.
├── Bordereau/                       Bordereaux                  2 327 l.
├── Planning Projet/                 Planning d'études          16 730 l.  +  1 test
├── MS Project/                      Import planning travaux     5 902 l.
├── Time-Out/                        Congés et absences          4 218 l.  + 11 tests
├── Avancement/                      Avancement des plans        2 658 l.
├── planning-synchro/                Planning + charge          10 884 l.  + 19 tests
├── gestion-depenses2/               Gestion économique         18 922 l.  +  3 tests
├── Gestion-globale/                 Vue multiprojets            2 634 l.
├── Gestion-User/                    Taux d'occupation           2 516 l.
├── gestion-equipe/                  Administration équipe       2 298 l.
└── gestion-acces-interservices/     Administration des accès    1 121 l.

Hors périmètre (traces historiques) :
    gestion-depenses/, gestion-depenses3/, Synchro/,
    synchronisation-plannings/, Gestion-Prev/, Gantt/, calendar/,
    event-stats/, timeline-calendar/, Affichage.html, AffichageGantt.html
```

### 13.2 Schéma Grist complet

```python
import grist
from functions import *
import datetime, math, re


@grist.UserTable
class Budget:
  NumeroProjet = grist.Text()
  Chapter = grist.Text()
  Amount = grist.Numeric()
  Service = grist.Text()


@grist.UserTable
class Emetteurs:
  Emetteurs = grist.Text()
  Service = grist.Text()
  DOP = grist.Text()
  Service2 = grist.Text()


@grist.UserTable
class Envois:
  Projet = grist.Text()
  Ref = grist.Int()
  Date_Bordereau = grist.Date()
  N_Plan = grist.Text()
  Indice = grist.Text()
  Designation = grist.Text()
  NbrExemplaires = grist.Text()
  Envoye = grist.Bool()
  Service = grist.Text()


@grist.UserTable
class HTML:
  A = grist.Text()
  def B(rec, table): return None
  def C(rec, table): return None


@grist.UserTable
class Hidden:
  def A(rec, table): return None
  def B(rec, table): return None
  def C(rec, table): return None


@grist.UserTable
class HiddenResp:
  def A(rec, table): return None
  def B(rec, table): return None
  def C(rec, table): return None


@grist.UserTable
class ListePlan_NDC_COF:
  Nom_projet = grist.Text()
  Type_document = grist.Text()
  NumeroDocument = grist.Text()
  Designation = grist.Text()
  Indice = grist.Text()
  DateDiffusion = grist.Date()
  Zone = grist.Text()
  Service = grist.Text()


@grist.UserTable
class MsProject:
  NomProjet = grist.Text()
  Indicateur = grist.Numeric()
  Nom_Tache = grist.Text()
  Bold = grist.Text()
  Debut = grist.Date()
  Duree = grist.Numeric()
  Fin = grist.Date()
  Equipe = grist.Text()
  Sous_Equipe = grist.Text()
  Eff = grist.Text()
  Style_Barre = grist.Text()
  Numero_Unique = grist.Text()
  Titre = grist.Text()
  Nom = grist.Text()

  @grist.formulaType(grist.Text())
  def Niveau(rec, table): return ''


@grist.UserTable
class MsProjectNom:
  Nom = grist.Text()


@grist.UserTable
class Planning_Projet:
  NomProjet = grist.Text()
  ID2 = grist.Text()
  Indice = grist.Text()
  Groupe = grist.Text()
  Zone = grist.Text()
  Taches = grist.Text()
  Type_doc = grist.Text()
  Ligne_planning = grist.Text()
  Prev_Indice_0 = grist.Text()
  Date_limite = grist.Date()
  Duree_1 = grist.Numeric()
  Diff_coffrage = grist.Date()
  Duree_2 = grist.Numeric()
  Diff_armature = grist.Date()
  Duree_3 = grist.Numeric()
  Demarrages_travaux = grist.Date()
  Retards = grist.Numeric()
  Realise = grist.Numeric()
  Date_Realise = grist.Date()
  Nom_XML = grist.Text()
  Remarque = grist.Text()
  Service = grist.Text()

  @grist.formulaType(grist.Date())
  def Date_Cloture(rec, table): return None


@grist.UserTable
class ProjectTeam:
  NumeroProjet = grist.Text()
  Role = grist.Text()
  Name = grist.Text()
  Daily_Rate = grist.Numeric()
  Service = grist.Text()


@grist.UserTable
class Projets:                     # ancienne version, plus utilisée
  Numero_de_projet = grist.Text()
  Nom_de_projet = grist.Text()

  @grist.formulaType(grist.Text())
  def Pourcentage_Facturation_Par_Mois(rec, table): return ''
  @grist.formulaType(grist.Text())
  def TypeDoc(rec, table): return ''
  @grist.formulaType(grist.Text())
  def Avancement(rec, table): return ''
  @grist.formulaType(grist.Text())
  def Pourcentage(rec, table): return ''
  @grist.formulaType(grist.Text())
  def DOP(rec, table): return ''

  class _Summary:
    @grist.formulaType(grist.ReferenceList('Projets'))
    def group(rec, table): return table.getSummarySourceGroup(rec)
    @grist.formulaType(grist.Int())
    def count(rec, table): return len(rec.group)


@grist.UserTable
class Projets2:                    # référentiel canonique
  Numero_de_projet = grist.Text()
  Nom_de_projet = grist.Text()
  Pourcentage_Facturation_Par_Mois = grist.Text()
  TypeDoc = grist.Text()
  Avancement = grist.Text()
  DOP = grist.Text()

  @grist.formulaType(grist.Text())
  def Pourcentage(rec, table): return ''


@grist.UserTable
class References:                  # ancienne version, plus utilisée
  NomProjet = grist.Reference('Projets')
  NomDocument = grist.Text()
  Emetteur = grist.Text()
  Reference = grist.Text()
  Indice = grist.Text()
  Recu = grist.Date()
  DescriptionObservations = grist.Text()
  DateLimite = grist.Date()
  Bloquant = grist.Bool()
  Archive = grist.Bool()
  Service = grist.Text()

  @grist.formulaType(grist.Bool())
  def Bloquant_Retard_(rec, table):
    return bool(rec.DateLimite) and rec.DateLimite < TODAY()

  def MoisLimite(rec, table):
    return rec.DateLimite and rec.DateLimite.strftime("%Y-%m")

  @grist.formulaType(grist.Numeric())
  def RetardNum(rec, table):
    if rec.Bloquant_Retard_ and rec.Bloquant: return 1
    else: return 0

  def NomProjetString(rec, table):
    return rec.NomProjet.Nom_de_projet

  def RecuString(rec, table):
    return "-" if rec.Recu == datetime.date(1900, 1, 1) else rec.Recu.strftime("%d/%m/%Y") if rec.Recu else ""

  def Delai(rec, table):
    if rec.Recu == datetime.date(1900, 1, 1): return None
    elif rec.Recu and rec.DateLimite: return (rec.Recu - rec.DateLimite).days
    else: return None

  class _Summary:
    @grist.formulaType(grist.ReferenceList('References'))
    def group(rec, table): return table.getSummarySourceGroup(rec)
    @grist.formulaType(grist.Int())
    def count(rec, table): return len(rec.group)
    @grist.formulaType(grist.Numeric())
    def RetardNum(rec, table): return SUM(rec.group.RetardNum)
    def gristHelper_Display(rec, table): return rec.NomProjet.Nom_de_projet


@grist.UserTable
class References2:                 # référentiel canonique
  NomProjet = grist.Text()
  NumeroDocument = grist.Text()
  NomDocument = grist.Text()
  Emetteur = grist.Text()
  Reference = grist.Text()
  Indice = grist.Text()
  Recu = grist.Date()
  DescriptionObservations = grist.Text()
  DateLimite = grist.Date()
  Bloquant = grist.Bool()
  Service = grist.Text()
  Type_document = grist.Text()
  Zone = grist.Text()
  Remarque = grist.Text()
  DureeLimite = grist.Text()
  Retard = grist.Numeric()
  Archive = grist.Bool()


@grist.UserTable
class Team:
  Prenom = grist.Text()
  Nom = grist.Text()
  Email = grist.Text()
  Service = grist.Text()
  Role = grist.Text()
  Externe = grist.Bool()
  IdTrefle = grist.Text()
  PrenomNom = grist.Text()
  Admin = grist.Bool()
  Moi = grist.Bool()
  Projets_Access = grist.Text()


@grist.UserTable
class TimeReal:
  Allocation_Days = grist.Numeric()
  Name = grist.Text()
  NumeroProjet = grist.Text()
  Mois = grist.Text()
  ID_Collaborateur = grist.Text()
  Service = grist.Text()


@grist.UserTable
class TimeSegment:
  Name = grist.Text()
  Start_At = grist.DateTime('Europe/Paris')
  End_At = grist.DateTime('Europe/Paris')
  Allocation_Days = grist.Numeric()
  Effectif = grist.Text()
  NumeroProjet = grist.Text()
  Service = grist.Text()

  def Label(rec, table): return None


@grist.UserTable
class Time_Out:
  Owner = grist.Text()
  Start_Date = grist.Text()
  Start_Period = grist.Text()
  End_Date = grist.Text()
  End_Period = grist.Text()
  Type = grist.Text()


@grist.UserTable
class Timesheet:
  Team_Member = grist.Numeric()
  Month = grist.Date()
  Provisional_Days = grist.Numeric()
  Worked_Days = grist.Numeric()
  Service = grist.Text()


@grist.UserTable
class Transfert:                   # ancienne version, plus utilisée
  NomProjet = grist.Reference('Projets')
  NomDocument = grist.Text()
  Emetteur = grist.Text()
  Reference = grist.Text()
  Indice = grist.Text()
  Recu = grist.Date()
  DescriptionObservation = grist.Text()
  DateLimite = grist.Date()
  Bloquant = grist.Bool()
  Archive = grist.Bool()
  Delai = grist.Numeric()
  Bloquant_retard_ = grist.Bool()
  MoisLimite = grist.Date()
  RetardNum = grist.Numeric()
  NomProjetString = grist.Text()
  RecuString = grist.Text()
  Service = grist.Text()
```

> `MsProjectNom` figure dans le schéma Grist mais n'est pas exploitée par la
> version en production.

### 13.3 Glossaire

| Terme | Définition |
|---|---|
| **Grist** | Tableur-base de données collaboratif servant de socle à la plateforme |
| **Widget** | Application web affichée dans une page Grist et connectée à ses données |
| **DOP** | Direction opérationnelle (`1`…`5`, ou « Commun ») |
| **Service** | Entité du bureau d'études. Détermine le périmètre d'écriture d'une personne. Trois valeurs sont aujourd'hui reconnues par le code (`Structure`, `Synthese`, `Topographie`) ; seul `Structure` est actif. L'extension vise l'ensemble des autres services (Méthodes, Topographie, Synthèse…). |
| **Donnée d'entrée** | Document ou information reçu d'un tiers, nécessaire pour produire un plan |
| **Bloquant** | Qualifie une donnée d'entrée dont l'absence empêche la production |
| **Indice** | Version d'un document : `0`, `A`, `B`, `C`… Un indice cible définit ce qui est « terminé » |
| **Zone** | Découpage d'un projet |
| **NDC** | Note de calcul |
| **Coffrage** | Plan de coffrage |
| **Armature** | Plan d'armature (ferraillage), produit après le coffrage |
| **Fond de plans** | Plan de base fourni par l'architecte ou le géomètre |
| **DOE** | Dossier des ouvrages exécutés |
| **Bordereau de transmission** | Document listant les plans envoyés à un destinataire |
| **Ligne planning** | Identifiant reliant une ligne du planning d'études à une tâche du planning travaux |
| **Segment de charge** | Plage de temps allouée à une personne sur un projet, au demi-jour |
| **Effectif** | Jours réellement travaillés dans un segment, pouvant différer de sa durée calendaire |
| **Réalisé** | Pourcentage d'avancement d'une tâche, calculé depuis l'indice atteint |
| **Clôture** | Marquage d'une ligne de planning comme terminée à une date donnée |
| **Trèfle** | SI tiers dont `Team.IdTrefle` porte l'identifiant |

### 13.4 Chapitres budgétaires par défaut

```
01 - Analyse Dossier - Organisation      08 - Modélisation - Calcul
02 - Réunions - Visite sur chantier      09 - Etude ouvrages provisoires
03 - Fond de plans                       10 - DOE
04 - Plan de coffrage                    11 - Sous-traitance - Calculs
05 - Plan de démolition                  12 - Sous-traitance - Armatures
06 - Plan d'armature                     13 - Base
07 - Note de calcul                      14 - Travaux supplémentaires
```

### 13.5 Types de documents et ordre d'affichage

| Rang | Type |
|---|---|
| 10 | NDC |
| 20 | Démolition |
| 30 | Fond de plans |
| 40 | Coffrage |
| 50 | Coupes / Détails |
| 60 | Armatures |

### 13.6 Styles de barre MS Project reconnus à l'import

```
Base (défaut)            Structure métal          Terrassement
Dépollution              VRD                      CES
RSO                      Fondations               Stabilité provisoire
Matériel                 Installation chantier    Main d'œuvre temporelle
Sécurité                 EDT Études               EDT Préparation
Autre chemin critique    Autres temporisation     Divers travaux
Divers TSC               Divers finitions         (générique)
```

### 13.7 Types d'absence

| Type | Couleur |
|---|---|
| Congé Payé | bleu |
| RTT | vert |
| Congé Parental | violet |
| Congé Non Payé | gris |

### 13.8 Documents du dépôt à joindre en annexe

| Document | Usage |
|---|---|
| `docs/service-access/README.md` | Architecture de la gestion des accès |
| `docs/service-access/MIGRATION.md` | Prérequis de données + 12 cas de recette |
| `docs/service-access/PERMISSIONS_AVANCEES.md` | Cadrage des règles d'accès à venir |
| `docs/superpowers/specs/2026-07-10-time-out-design.md` | Exemple de spécification, et modèle de règles d'accès serveur |
| `planning-synchro/README.md` | Exemple de documentation technique d'application |

---

*Fin du dossier source. Périmètre : branche `main` uniquement. Les mentions
`[À TRANCHER]` signalent les points restant à préciser avant transmission.*
