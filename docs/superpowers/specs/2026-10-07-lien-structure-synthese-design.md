# Spec — Lien Structure ↔ Synthese : lier un étage à un coffrage et reprendre sa date d'indice 0 (Planning Projet)

Date : 2026-10-07
Statut : design validé en conversation, en attente de relecture avant plan d'implémentation.
Prolonge :
- `docs/superpowers/specs/2026-10-05-synthese-modele-etage-design.md` (modèle d'étage, liens,
  cascade des dates) ;
- l'étape 1 du lien, déjà en place et non commitée : bouton « Lien Structure » et fenêtre en
  lecture seule (étages de Synthese à gauche, coffrages de Structure à droite, zone par zone).

## 1. Objectif

Dans la fenêtre « Lien Structure », l'utilisateur **fait glisser un coffrage** (à droite) **sur
un étage** (à gauche) de la même zone. Ce geste :

1. **mémorise le lien** : l'étage retient le N° de son coffrage, et la fenêtre montre ensuite
   qui est lié à qui ;
2. **reprend la date** : la date de diffusion du coffrage **à l'indice 0**, lue dans la liste de
   plans, devient le **Début de « FOND DE PLAN DE SYNTHESE NIV … »** de l'étage ; les tâches
   liées derrière suivent, comme pour une saisie.

Quand la date d'indice 0 change ou arrive plus tard, rien ne bouge tout seul : la fenêtre signale
l'étage « à mettre à jour » et un bouton applique la nouvelle date.

Exemple (ERA QUAI D'ORSAY, Zone 1 / BAT BC) : le coffrage 3021 « PH 1er SOUS-SOL - COF » a été
diffusé à l'indice 0 le jeudi 27/11/2025. Déposé sur l'étage SS1, il place « RECEPTION
ARCH/TOPO/STR » au 27/11/2025 ; « FOND DE PLAN DE SYNTHESE NIV SS1 », lié « même début », démarre
le 27/11/2025 et garde sa durée ; le reste de l'étage se décale.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Geste | Glisser un coffrage sur un étage **de la même zone**. Un dépôt dans une autre zone est refusé. |
| Date reprise | Date de diffusion du coffrage à l'**indice 0** dans `ListePlan_NDC_COF`. |
| Tâche qui reçoit la date | Le jalon **RECEPTION ARCH/TOPO/STR** ; FOND DE PLAN suit par son lien « même début ». Sans ce lien, FOND DE PLAN reçoit la date directement (§ 4.3). |
| Effet sur les dates | La tâche **se déplace en gardant sa durée** ; week-end ou férié → jour ouvré suivant ; une date déjà présente est remplacée ; cascade vers l'aval, en une seule écriture. |
| Mémoire | Le lien est **mémorisé** sur la ligne de l'étage. |
| Stockage | Une colonne **Texte** `Lien_Structure` créée par l'utilisateur dans `Planning_Projet` (document de test, puis production). Elle contient le **N° du coffrage**. |
| Mise à jour | **À la demande** : bouton « Mettre à jour » par étage. Aucune écriture automatique. |
| Cardinalité | Un étage a **au plus un** coffrage (un nouveau dépôt remplace l'ancien). Un coffrage peut servir à plusieurs étages. |
| Droits | Il faut « Editer » actif et le droit d'écrire dans le service Synthese. Sinon la fenêtre reste en lecture seule et le dit. |
| Git | **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même. |

## 3. Données

### 3.1 `Planning_Projet`

Nouvelle colonne `Lien_Structure` (Texte). Elle n'est remplie que sur une **ligne-étage** de
Synthese (`Etage` = vrai, `Service` = Synthese) : elle y porte le N° (`ID2`) du coffrage lié.
Vide = pas de lien. Sur toute autre ligne elle est ignorée.

Un **coffrage** est, comme à l'étape 1, une ligne `Service` = Structure dont `Type_doc` contient
« COFFRAGE » et dont `Taches` est rempli. Seul un coffrage qui a un N° peut être lié.

### 3.2 `ListePlan_NDC_COF`

Colonnes lues : `Nom_projet`, `Type_document`, `NumeroDocument`, `Indice`, `DateDiffusion`,
`Service`. La table est lue pour le projet courant, tous services confondus, par la lecture
partagée existante `fetchProjectRows("ListePlan_NDC_COF")` (aucun changement dans `shared/`).

## 4. Règles (calcul pur)

### 4.1 Date d'indice 0 d'un coffrage

Parmi les lignes de la liste de plans du projet, on garde celles dont :

- `Type_document` contient « COFFRAGE » (sans accents ni casse) ;
- `Service` est vide ou vaut Structure ;
- `NumeroDocument` est le N° du coffrage, comparé comme le fait déjà la reconnaissance des
  documents du planning : sans accents ni casse, toute ponctuation vaut une espace (« COF-A » =
  « cof a ») ; les zéros comptent (« 0110 » ≠ « 110 ») ;
- `Indice` vaut « 0 » ;
- `DateDiffusion` est une date lisible (secondes Grist, ISO ou jj/mm/aaaa).

La date d'indice 0 est **la plus ancienne** de ces dates. S'il n'y en a aucune, le coffrage n'a
pas encore d'indice 0.

### 4.2 Lien d'un étage

Le N° lié est la première valeur non vide de `Lien_Structure` parmi les lignes-étages de l'étage.
Le coffrage correspondant est cherché par N° parmi les coffrages du projet, d'abord dans la zone
de l'étage, sinon dans tout le projet.

### 4.3 Tâche visée

- **Fond de plan** : la tâche de l'étage, de plus petit id, dont le nom commence par « FOND DE
  PLAN DE SYNTHESE » (sans accents ni casse, espaces resserrés).
- **Ancre** (la tâche qui reçoit la date) : si le fond de plan a un lien **DD sans décalage**
  vers une tâche du même étage, cette tâche — RECEPTION ARCH/TOPO/STR dans le modèle. Sinon, le
  fond de plan lui-même.

Dans les deux cas, le Début du fond de plan est le jour ouvré de la date d'indice 0. Un étage
sans fond de plan (créé avant le modèle, tâche renommée ou supprimée) peut être lié, mais aucune
date n'y est posée.

### 4.4 Déplacer le début d'une tâche

`moveTaskStart(task, date)` : Début = jour ouvré à partir de la date ; durée conservée (0 :
jalon ; inconnue : un jour) ; Fin recalculée. Mêmes bornes d'années que les saisies (2000–2100).
Renvoie, comme `applyTaskEdit`, la tâche recalculée et les seules colonnes à écrire (rien si rien
ne change). La cascade existante (`cascadeFrom`) s'applique ensuite.

Différence voulue avec une saisie dans « Début », qui allonge ou raccourcit la tâche : ici la
tâche est décalée, comme une tâche liée dont le prédécesseur bouge.

### 4.5 État d'un étage

Attendu = jour ouvré de la date d'indice 0 du coffrage lié.

| État | Condition | Affichage |
|---|---|---|
| `none` | pas de N° | « Déposez un coffrage ici » (ou « Aucun coffrage lié » en lecture seule) |
| `missing` | N° sans coffrage dans le projet | « Coffrage 3021 introuvable » |
| `noPlan` | coffrage trouvé, pas de fond de plan | « … · pas de tâche « FOND DE PLAN DE SYNTHESE » dans cet étage » |
| `waiting` | coffrage trouvé, pas d'indice 0 | « … · en attente de l'indice 0 » |
| `current` | Début du fond de plan = attendu | « … · à jour » |
| `stale` | Début du fond de plan vide ou différent | « … · à mettre à jour : ind. 0 le Jeu 27/11/25 » + bouton « Mettre à jour » |

« … » = « N° — nom » du coffrage. Les conditions se lisent de haut en bas.

## 5. Contrôleur (`ui/syntheseTasksController.js`)

Le contrôleur du tableau reste le seul à écrire les lignes Synthese : la fenêtre passe par lui,
ce qui lui donne la file d'écritures, l'affichage immédiat, la vérification du contexte et la
cascade.

- `getStructureLinkSource()` → `{ ready, rows, editable, lockedMessage, linkColumn }` : les
  lignes Synthese **telles qu'affichées** (écritures en attente comprises), si elles sont
  chargées, si l'on peut écrire, le message à montrer sinon, et si `Lien_Structure` existe
  (`true` / `false` / `null` tant qu'aucune ligne ne permet de le savoir, comme pour `Etage`).
- `applyStructureLink({ zoneKey, floorKey, formworkNumber, date })` →
  `Promise<{ ok, error? }>` :
  - `formworkNumber` : N° à mémoriser (`""` : délier ; absent : inchangé) ;
  - `date` : date d'indice 0 à poser (absente : aucune date).

  L'étage est cherché dans **toutes** les zones, même si le bandeau en filtre une. Le lien
  s'écrit sur toutes les lignes-étages de l'étage ; la date passe par `moveTaskStart` sur l'ancre
  puis `cascadeFrom`. Le tout part en **une opération** de la file (`createOp` / `submit`) : ou
  tout est écrit, ou rien. Sans changement réel, rien n'est écrit et la réponse est `ok`.

Refus, sans écriture : « Editer » inactif ou service en lecture seule ; colonne `Lien_Structure`
absente ; étage introuvable ; étage sans ligne-étage (le lien n'a nulle part où s'écrire) ; date
demandée alors que l'étage n'a pas de fond de plan.

## 6. Fenêtre (`ui/structureLinkDialog.js`, `services/structureLinkModel.js`)

### 6.1 Lecture

À l'ouverture : les lignes Synthese viennent du contrôleur (fraîches) ; les coffrages et la liste
de plans sont lus par `fetchProjectRows` (`Planning_Projet` et `ListePlan_NDC_COF`, en
parallèle). Les zones affichées restent celles de tous les services du projet. Après chaque
action, la fenêtre se redessine à partir du contrôleur, sans nouvelle lecture réseau : une fois
tout de suite (affichage immédiat), une fois à la réponse de Grist.

### 6.2 Côté Synthèse (gauche)

Chaque étage est une cible de dépôt et affiche : son nom ; « Fond de plan : début Jeu 27/11/25 »
(ou « — ») ; son lien dans l'état du § 4.5 ; si l'on peut écrire, « Mettre à jour » (état
`stale`) et « × » pour **délier** (les dates restent).

### 6.3 Côté Structure (droite)

Chaque coffrage affiche « N° — nom », puis « ind. 0 : Jeu 27/11/25 » ou « pas d'indice 0 », puis
« lié : SS1, SS2 » s'il sert à des étages. Il se déplace si l'on peut écrire et s'il a un N° ; un
coffrage sans indice 0 se déplace aussi (le lien est gardé, la date viendra par « Mettre à
jour »).

### 6.4 Glisser-déposer

Glisser-déposer natif du navigateur (`draggable`, `dragstart`, `dragover`, `drop`, `dragend`).
Pendant le glisser, les étages de la zone du coffrage sont mis en évidence ; un étage d'une autre
zone n'accepte pas le dépôt. Au dépôt : `applyStructureLink` avec le N°, et la date si le
coffrage a un indice 0 et l'étage un fond de plan.

### 6.5 Messages (ligne d'état de la fenêtre)

- prête à écrire : « Faites glisser un coffrage sur un étage de la même zone. »
- pendant l'écriture : « Enregistrement… »
- lié et daté : « SS1 lié au coffrage 3021 : le fond de plan débute le Jeu 27/11/25. »
- lié sans indice 0 : « SS1 lié au coffrage 3021. La date sera à reprendre quand l'indice 0 sera
  diffusé. »
- lié sans fond de plan : « SS1 lié au coffrage 3021. Aucune date posée : l'étage n'a pas de
  tâche « FOND DE PLAN DE SYNTHESE ». »
- mis à jour : « SS1 : le fond de plan débute le Jeu 27/11/25. »
- délié : « SS1 n'est plus lié à un coffrage. »
- lecture seule : le message du contrôleur (« Activez « Editer »… » ou service en lecture seule).
- colonne absente : « La colonne « Lien_Structure » (Texte) manque dans Planning_Projet :
  ajoutez-la pour lier les étages aux coffrages. »
- lignes Synthese pas encore chargées : « Les étages ne sont pas encore chargés : fermez la
  fenêtre puis rouvrez-la. »
- échec d'écriture : le message du contrôleur ; l'affichage revient à l'état d'avant.
- écriture faite mais affichage impossible : « L'enregistrement est fait, mais l'affichage n'a pas
  pu être mis à jour : fermez la fenêtre puis rouvrez-la. »

### 6.6 Une action à la fois

Tant qu'une écriture est en route, la fenêtre n'accepte ni nouveau glisser ni bouton : le
redessin fait à la réponse de Grist ne coupe donc jamais un glisser en cours, et les messages de
deux actions ne se recouvrent pas. « Enregistrement… » reste affiché jusqu'à la réponse.

## 7. Erreurs et cas limites

- **Coffrage renuméroté ou supprimé** par Structure : l'étage passe à « introuvable » ; rien
  n'est nettoyé tout seul, l'utilisateur délie ou relie.
- **Coffrage sans zone** : il reste affiché dans « Sans zone », qui n'a pas d'étage ; il ne peut
  donc pas être lié.
- **Deux coffrages de même N°** dans le projet : celui de la zone de l'étage est retenu.
- **Plusieurs dates à l'indice 0** : la plus ancienne.
- **Date un week-end ou un férié** : le Début passe au jour ouvré suivant ; l'état « à jour » se
  juge sur ce jour.
- **Zone filtrée dans le bandeau** : la fenêtre montre toutes les zones et l'écriture fonctionne
  dans toutes.
- **Étage renommé** : le lien est sur la ligne-étage, il suit. **Étage supprimé** : le lien
  disparaît avec la ligne.
- **Projet ou service changé** pendant l'écriture : refus par la vérification de contexte
  existante.
- **Projet ou service changé pendant que la fenêtre est ouverte** (autre widget, autre onglet) :
  la fenêtre se ferme. Si elle est encore affichée, toute action est refusée : « Le projet a
  changé depuis l'ouverture de cette fenêtre : fermez-la puis rouvrez-la. » Rien ne part vers
  l'autre projet.
- **Date d'indice 0 hors de 2000–2100** (faute de frappe dans la liste de plans) : le dépôt est
  refusé en entier — « La date de diffusion à l'indice 0 de ce coffrage n'est pas utilisable
  (elle doit être entre 2000 et 2100) : corrigez-la dans la liste de plans. »
- **Autres glisser de la page** : la donnée glissée porte un type privé
  (`application/x-planning-coffrage`) pour que le planning Structure, qui écoute tous les glisser
  de la page, ne la prenne pas pour une ligne MS Project.
- **Autres widgets** : `Lien_Structure` ne vit que sur des lignes-étages de Synthese, que les
  synchronisations de documents ignorent déjà. Aucune protection à ajouter.

## 8. Architecture

| Fichier | Rôle |
|---|---|
| `services/syntheseTaskModel.js` | `TASK_COLUMNS.structureLink`, `moveTaskStart`, `detectStructureLinkColumn`. |
| `services/structureLinkModel.js` | Dates d'indice 0, liens des étages, tâche visée, états ; `buildStructureLink({ syntheseRows, projectRows, planRows })`. |
| `ui/syntheseTasksController.js` | `getStructureLinkSource`, `applyStructureLink`, détection de la colonne, message d'erreur de colonne. |
| `ui/structureLinkDialog.js` | Rendu des états, glisser-déposer, boutons, messages. |
| `main.js` | Branchement : source et écriture par le contrôleur, lecture des deux tables. |
| `index.html`, `styles.css` | Styles des cibles, des états et des boutons ; versions `?v=`. |

`shared/` n'est pas modifié. `buildSections` non plus : les liens se lisent à part, à partir des
lignes-étages.

## 9. Tests (`node --test tests/*.test.mjs`)

- **Modèle du lien** : date d'indice 0 (type, service, N°, indice, date illisible, la plus
  ancienne) ; lien lu sur la ligne-étage ; coffrage de la zone préféré ; tâche visée (DD sans
  décalage → prédécesseur ; DD avec décalage, FD, sans lien → fond de plan ; aucun fond de
  plan) ; les six états ; « lié : … » côté coffrage.
- **`moveTaskStart`** : jalon, tâche datée (durée gardée), tâche sans dates (durée prévue),
  week-end, rien à écrire, bornes d'années.
- **Contrôleur** : lien + date + cascade en une écriture ; mise à jour seule ; déliaison ; zone
  filtrée ; refus (verrouillé, colonne absente, étage introuvable, sans ligne-étage, sans fond de
  plan) ; échec d'écriture (affichage rétabli, erreur renvoyée) ; aucun changement → aucune
  écriture.
- **Fenêtre** : rendu des états ; glisser dans la zone, refus hors zone ; lecture seule (rien ne
  se déplace, pas de bouton) ; « Mettre à jour » et « × » ; messages ; redessin immédiat puis à
  la réponse.
- **Branchement** : `main.js`, `index.html`, CSS, versions.

## 10. Hors périmètre

- Mise à jour automatique des dates (décision : à la demande).
- Bouton « Tout mettre à jour ».
- Affichage du lien dans le tableau de tâches ou le Gantt.
- Liens vers autre chose qu'un coffrage, ou vers un autre indice que 0.
- Alternative clavier au glisser-déposer.
- Création de la colonne `Lien_Structure` : faite par l'utilisateur, en test puis en production.
