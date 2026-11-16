# Synthese — « Paramètre » : modèle d'étage par projet

Date : 16/11/2026. Widget : `Planning Projet`, vue Synthese seulement. Branche : `feature/LissageStructure`.
Rien n'est commité par l'assistant : l'utilisateur teste sur localhost puis commite.

## 1. Intention

Quand on ajoute un étage dans une zone, ou une zone dans un étage, la vue Synthese crée aujourd'hui
toujours le même tableau : le modèle figé `FLOOR_TEMPLATE` de `services/syntheseFloorTemplate.js`.
Il compte 26 lignes : la ligne-étage, RECEPTION, CYCLE 1 à 3, deux sous-groupes « PLAN SYT CYCLE n »,
les tâches et leurs liens, puis SIGNATURE et DEMARRAGE GO en fin d'étage. Toutes les tâches sont
créées avec une durée de 0.

Chaque projet doit pouvoir régler son propre tableau de base. Un bouton « Paramètre » ouvre une
fenêtre où l'on modifie ce modèle avec les gestes du vrai tableau, et où l'on règle une durée par
défaut pour chaque tâche. Les étages créés ensuite pour ce projet suivent ce modèle. Il suffit alors
de dater la première tâche : les liens et les durées calent tout l'étage.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Un bouton « Paramètre » dans le bandeau, juste à droite de « Par étage », dans l'espace Synthese.
- Une fenêtre qui montre le modèle du projet comme un étage du tableau Synthese. Elle a les mêmes
  colonnes, sauf Début et Fin. Les gestes sont les mêmes :
  - renommer ;
  - ajouter ou supprimer une tâche, un cycle ou un sous-cycle ;
  - glisser ;
  - « Modifier le lien… » ;
  - « Passer en escalier / parallèle » ;
  - N° et Indice ;
  - « Contrôler par rapport au coffrage ».
- La Durée de chaque tâche est réglable : c'est sa durée par défaut.
- Le modèle est enregistré en texte dans `Projets2.Synthese_Parametre`, pour le projet.
- Les trois façons de créer un étage utilisent le modèle du projet :
  - « Ajouter un étage » sur une zone ;
  - la fenêtre « Ajouter un étage… » de l'affichage par étage ;
  - « Ajouter « X » dans « Zone » ».

**Non-objectifs**
- Les étages déjà créés ne changent pas quand le modèle change.
- Pas de dates dans le modèle.
- Pas de modèle par zone ni par étage : un seul modèle par projet.
- Rien pour Structure ni Topographie. Pas de bouton dans la vue Global ni en mode embarqué.
- Pas de lien vers un coffrage de Structure (`Lien_Structure`) dans le modèle.

**Anti-objectifs (échec même si « ça marche »)**
- La fenêtre se comporte autrement que le vrai tableau sur un même geste. Exemples : un lien posé
  différemment, un cycle ajouté ailleurs, SIGNATURE qui ne reste pas en fin d'étage.
- Une écriture dans `Planning_Projet` part pendant qu'on modifie le modèle : la fenêtre ne doit
  rien écrire avant « Enregistrer », et alors seulement dans `Projets2`.
- Un projet sans paramètre, ou dont le paramètre est illisible, ne peut plus créer d'étage.

## 3. Ce que voit l'utilisateur

### 3.1 Bouton

- `#syntheseParametreToggle` « Paramètre », placé dans `index.html` juste après
  `#syntheseLayoutToggle` (« Par étage »).
- Visible seulement dans l'espace Synthese, pas en vue Global ni en mode embarqué. Il suit les
  mêmes règles CSS que « Lien Structure ».
- Il porte `data-service-context-navigation`. Son `title` ne contient aucun mot que le contexte
  partagé prend pour une écriture (`ajout`, `modif`, `enregistr`, `suppr`, etc.). Ainsi il reste
  cliquable en lecture seule : on peut regarder le modèle.
  Titre proposé : « Modèle d'étage du projet : cycles, tâches, liens et durées d'un nouvel étage ».

### 3.2 Fenêtre

Une `<dialog>` modale construite en JS, sur le modèle de `ui/syntheseFloorDialog.js` et
`ui/syntheseLinkDialog.js`. Elle est grande : environ 90 % de la largeur et 85 % de la hauteur de
la fenêtre.

- **En-tête** : « Paramètre — modèle d'étage » et le nom du projet, avec un bouton × pour fermer.
- **Ligne d'aide** : « Un nouvel étage de ce projet reçoit ces lignes, ces liens et ces durées.
  {E} est remplacé par le nom de l'étage. Les étages déjà créés ne changent pas. »
- **Corps** : le tableau Synthese sur un seul étage, nommé « Étage type ».
  - La ligne de zone est masquée.
  - La ligne d'étage reste visible (triangle de repli, Durée récapitulative), mais elle ne se
    renomme pas.
  - Colonnes : n° de ligne, Nom, N°, Indice, Durée, Lien. Pas de Début, pas de Fin, pas de Gantt.
- **Pied** :
  - à gauche, « Revenir au modèle d'origine » : remplace le contenu par `FLOOR_TEMPLATE`, sans
    enregistrer ;
  - à droite, « Annuler » et « Enregistrer » (bouton principal).
  - Une zone de message (`role="status"`) affiche les refus et les erreurs.
- **Menus du clic droit**, identiques au tableau, sauf :
  - Sur la ligne d'étage : seulement « Ajouter une tâche » et « Ajouter un cycle ». Ni
    « Supprimer l'étage », ni saisie du nom.
  - Rien sur une ligne de zone, puisqu'elle est masquée.
  - Pas d'entrée d'affichage par étage : la fenêtre est toujours en affichage par zone.
  - Sur une tâche et sur un cycle : les mêmes entrées que dans le tableau.
- **Fin d'étage fixe** : SIGNATURE et DEMARRAGE GO s'y comportent comme dans le tableau. Elles
  restent en dernier, sans poignée, et rien ne se place sous elles (règles `floorEnd*`).
- **Avertissements**, sans blocage : d'autres fonctions retrouvent certaines tâches par leur nom
  ou leur Nature. Si le modèle n'en a plus, la zone de message le dit, et « Enregistrer » reste
  possible.
  - Sans tâche « FOND DE PLAN DE SYNTHESE… » : « Lien Structure » ne pourra pas poser la date
    0 Prev.
  - Sans tâche cochée « Contrôler par rapport au coffrage » et sans « PLAN DE SYNTHESE
    RESERVATIONS… » dans un cycle « CYCLE 3 » : pas de tâche contrôlée par défaut.
  - Sans tâche de Nature « Demarrage » : la vue Global ne comparera pas le démarrage à celui de
    Structure.
  Les règles exactes sont celles de `structureLinkModel.js` (`isFloorStartTask`, contrôle par
  défaut) et de `globalChecks.js`, à réutiliser plutôt qu'à recopier.
- **Fermeture** : par ×, Échap ou Annuler. S'il y a des modifications non enregistrées, une
  confirmation est demandée : « Abandonner les modifications du modèle ? ».
- La fenêtre se ferme si le projet ou le service change (comme `structureLinkDialog`), sans
  confirmation : le modèle affiché n'est plus celui du projet.

### 3.3 Droits

- Tout le monde peut ouvrir la fenêtre et parcourir le modèle (replier, déplier).
- Modifier et enregistrer exigent trois conditions :
  - « Editer » actif ;
  - service modifiable (`accessMode === "editable"`, donc Synthese comme service d'origine) ;
  - colonne `Synthese_Parametre` présente pour le projet.
- La fenêtre suit l'état de « Editer » au moment de son ouverture. Si « Editer » change pendant
  qu'elle est ouverte, elle suit ce changement, et « Enregistrer » revérifie au moment d'écrire.
- **Colonne absente** : la fenêtre s'ouvre en lecture et montre le modèle d'origine.
  « Enregistrer » est grisé avec le message : « Créez la colonne Texte « Synthese_Parametre » dans
  Projets2 pour enregistrer un modèle. » Elle se détecte comme `Mode` (`hasLayoutModeColumn`) : la
  valeur est `undefined` sur les lignes Projets2 du projet.

## 4. Données

### 4.1 Colonne

- `Projets2.Synthese_Parametre`, de type Texte, créée par l'utilisateur dans le doc de test puis en
  prod.
- Ajouter la clé `syntheseParametre: "Synthese_Parametre"` à `APP_CONFIG.grist.projectsTable.columns`.
- `buildProjectAvancementConfigsFromRows` (`gristService.js`) lit en plus
  `parametreRaw: row?.[columns.syntheseParametre]`.
- **Écriture** : la même valeur sur toutes les lignes Projets2 du projet, en une seule action
  Grist. Reprendre `projectRows` et le modèle de `buildLayoutModeActions` de
  `services/syntheseLayout.js`. Il est permis de généraliser `projectRows` en l'exportant.
- **Lecture** : la première valeur non vide des lignes du projet décide, comme pour `Mode`.

### 4.2 Format (JSON, version 1)

```json
{
  "version": 1,
  "items": [
    { "code": "T0", "name": "RECEPTION ARCH/TOPO/STR", "nature": "", "parent": "", "link": "", "days": 0 },
    { "code": "C1", "name": "CYCLE 1", "nature": "Cycle", "parent": "" },
    { "code": "T1", "name": "FOND DE PLAN DE SYNTHESE NIV {E}", "nature": "", "parent": "C1", "link": "T0 DD", "days": 2,
      "id2": "", "indice": "", "control": false }
  ]
}
```

**Les éléments**
- `items` est rangé dans l'ordre d'affichage, en profondeur d'abord : le contenu d'un cycle suit sa
  ligne. Ce rang devient l'ordre de création, donc l'ordre d'affichage du nouvel étage. C'est déjà
  ce que fait `FLOOR_TEMPLATE`.
- `code` est unique et non vide. `parent` vaut "" (dans l'étage) ou le `code` d'un cycle ou
  sous-groupe placé avant.
- `link` vaut "" ou « CODE FD|DD|FF » avec un décalage `+n` / `-n` facultatif. CODE désigne une
  tâche du modèle autre que l'élément lui-même. C'est le format de `FLOOR_TEMPLATE`.

**Nature et champs par type d'élément**
- Pour un cycle ou un sous-groupe, `nature` vaut « Cycle » ou « Sous-groupe ». À la création, la
  Nature est réécrite selon la profondeur réelle (`natureForDepth`).
- Pour une tâche, `nature` vaut "", « Reunion », « Demarrage » ou « Signature ».
- `days` est un entier de 0 à `MAX_DURATION_DAYS`, présent pour les tâches seulement (0 = jalon).
- `id2`, `indice` et `control` sont facultatifs, présents pour les tâches seulement.
- `{E}`, dans un nom, sera remplacé par le nom de l'étage.

**Lecture (`parseFloorTemplate`, module pur)**
- Le texte vide, le JSON illisible, une version inconnue ou l'absence de toute tâche donnent
  `null` : on utilise alors `FLOOR_TEMPLATE`.
- Un élément invalide est ignoré, sans faire échouer le reste : code manquant ou en double, ou nom
  vide.
- Un `parent` inconnu ramène l'élément dans l'étage.
- Un `link` illisible ou vers un code inconnu est vidé.
- Un `days` invalide vaut 0.
- Une boucle de liens ou de parents ne peut pas venir de la fenêtre. Si elle vient d'une saisie
  à la main, elle est gérée comme aujourd'hui par le tableau : boucles de Parent cassées à
  l'affichage, cascade arrêtée par `seen`.

**Écriture (`serializeFloorTemplate`, module pur)**
- Elle part des lignes en mémoire de la fenêtre et suit l'ordre du modèle de lignes, tout déplié.
- Les codes sont régénérés : « T1… » pour les tâches, « C1… » pour les cycles et sous-groupes.
- Parent et Lien sont traduits d'id en code.
- `days` vient de la durée lue de la tâche (`durationDays`), calculée sur ses dates fictives
  (§6). Les dates elles-mêmes ne sont jamais enregistrées.

**Modèle d'origine** : `FLOOR_TEMPLATE` reste la valeur par défaut, avec ses durées à 0. Sa
représentation JSON s'obtient avec la même fonction, pour que « Revenir au modèle d'origine » et la
première ouverture d'un projet sans paramètre partent du même contenu. L'aller-retour garde la
structure, mais les codes sont régénérés (T0, S2 et S3 ne reviennent pas tels quels). On compare
donc noms, natures, parents, liens et durées, en traduisant les codes.

## 5. Création d'un étage

- `buildFloorFromTemplate({ floorName, zoneName, projectName, template })` et
  `buildTemplateLinks(ids, template)` reçoivent le modèle. Par défaut, c'est `FLOOR_TEMPLATE`.
  Le nombre de lignes n'est plus fixe : il vaut `template.length + 1`.
- Une tâche reçoit `Duree_1 = days` et un cycle 0. N° (`ID2`) et Indice sont écrits s'ils sont non
  vides. `Controle_Coffrage = true` n'est écrit que si `control` est vrai et que la colonne existe
  (`formworkCheckColumn === true` dans le contrôleur). Sinon le champ est omis, pour ne pas faire
  échouer l'écriture en prod.
- L'écriture garde ses deux temps :
  - un `BulkAddRecord` des lignes ;
  - puis un `BulkUpdateRecord` de Parent et Lien d'après les ids rendus, avec l'annulation déjà en
    place en cas d'échec.
- Dans `addFloorFromTemplate` (contrôleur), le modèle vient d'une option injectée
  `getFloorTemplate()`, fournie par `main.js`. Elle rend le modèle du projet courant, déjà lu et
  validé, ou `FLOOR_TEMPLATE`. Si le paramètre est illisible, l'étage est créé avec le modèle
  d'origine et la barre d'état le dit.
- Les dates restent vides. Le premier Début saisi déclenche la cascade existante. Les durées non
  nulles prennent alors effet, sans rien de nouveau à écrire côté cascade.
- **`{E}` et le renommage** (décision de l'assistant) :
  - Aujourd'hui, renommer un étage ne réécrit que « NIV <nom> » et « GO <nom> » dans ses tâches
    (`buildFloorRenameActions`, `syntheseTaskModel.js`).
  - Or « Ajouter un étage », sur une zone, crée d'abord un nom par défaut (`nextFloorName` :
    « Nouvel étage », « Nouvel étage 2 »…) puis ouvre la saisie du nom.
  - Pour qu'un `{E}` placé ailleurs dans un nom suive aussi, la règle est étendue : quand l'ancien
    nom est un nom par défaut de `nextFloorName`, chaque occurrence exacte de cet ancien nom dans
    les noms des tâches **et des cycles** de l'étage est remplacée par le nouveau nom.
  - La règle « NIV / GO » reste inchangée pour les autres renommages.

## 6. La fenêtre : réutiliser le tableau et le contrôleur (décision)

La fenêtre ne réimplémente aucun geste. Elle crée une **seconde instance** de
`createSyntheseTaskTable` et de `createSyntheseTasksController`, branchée sur des lignes en mémoire :

- **Un faux contexte**, qui fournit :
  - `getState()` : `currentProject` est un projet fictif propre à la fenêtre,
    `selectedService: "Synthese"`, et `accessMode` vaut "editable" ou "readonly" selon les droits
    du §3.3 ;
  - `fetchContextRows()` : rend les lignes en mémoire ;
  - `subscribe` et `watchProjectZones` : sans effet ;
  - `fetchProjectRows` : rend `[]`.
- **Un faux `docApi`** (`applyUserActions`) qui applique à ces lignes `AddRecord`,
  `BulkAddRecord`, `UpdateRecord`, `BulkUpdateRecord`, `RemoveRecord` et `BulkRemoveRecord` sur
  `Planning_Projet`. Il rend `retValues` comme Grist : les nouveaux ids, croissants, jamais
  réutilisés pendant la session de la fenêtre. Il ne touche jamais au vrai `grist.docApi`.
  - Comme `transformActions` en prod (`shared/service-context-core.js`), il pose `Service:
    "Synthese"` et `NomProjet` (projet fictif) sur chaque ligne ajoutée. Sinon une tâche qui a un
    N° ne serait plus une ligne Synthese (`isNamedPlainRow`) et disparaîtrait.
  - Après chaque écriture, il prévient la fenêtre, qui appelle `controller.refresh()`. Dans le
    tableau principal, c'est la surveillance de `main.js` qui joue ce rôle.
- **Les lignes en mémoire** :
  - Elles sont **datées à partir d'un lundi fictif** (constante, par exemple le 05/01/2026). Les
    tâches sans lien (racines) commencent ce jour-là ; les autres prennent leurs dates par la
    cascade existante (`cascadeFrom`) d'après leur durée.
  - Ainsi les Durées récapitulatives des cycles et de l'étage s'affichent, et la lecture du mode
    parallèle (qui compare des fins datées) marche. Les gestes se comportent comme dans le vrai
    tableau : une Durée saisie sur une tâche liée la recale sur son lien, un ajout prend ses dates
    du dessus.
  - Une tâche ajoutée sans tâche au-dessus prend la date du jour (`buildNewTask`). C'est sans
    importance : seules les durées sont enregistrées. Début et Fin restent cachés.
  - On y trouve une ligne-étage « Étage type » (zone « Modèle ») ;
  - les éléments du modèle, avec toutes les colonnes que le contrôleur détecte : `Etage`, `Nature`,
    `Parent`, `Lien`, `Ordre`, `Controle_Coffrage`, `Service: "Synthese"`, `Type_doc` et `ID2`
    vides, `Diff_coffrage` et `Diff_armature` à null, `Duree_1`.
  - Ainsi `canOrder`, `canLink`, `canMoveCycles` et `canSetCycleMode` sont vrais.
- **Le contrôleur de la fenêtre** est créé avec `loadFormworkStarts: null`, `saveLayout: null` et un
  `confirm` réel. Il reste en affichage par zone (`setLayout` n'est jamais appelé).
  `setEditingEnabled` suit les droits du §3.3.
- **Options du tableau**, nouvelles et à ajouter sans changer le tableau principal :
  - `hiddenFields: ["start", "end"]` : les colonnes, leurs largeurs et la saisie au clavier
    sautent ces champs ;
  - `rightPane: false` : ni bande droite d'en-tête, ni cellule `.stt-right`, ni séparateur, ni
    les 160 px réservés à droite. Ne pas passer `createGantt` ne suffit pas, car le tableau crée
    toujours ces éléments ;
  - `templateMode: true` : menus réduits (§3.2), ligne de zone masquée, nom de l'étage non
    modifiable ;
  - des clés `localStorage` propres pour les largeurs, pour ne pas toucher à celles du tableau
    principal.
- **« Enregistrer »** :
  - sérialise les lignes en mémoire (§4.2), sans les opérations encore en file d'attente ;
  - si la file n'est pas vide, attend qu'elle se vide (elle est en mémoire, donc instantanée) ;
  - refuse un modèle sans aucune tâche, avec le message « Le modèle doit garder au moins une
    tâche. » ;
  - revérifie les droits ;
  - écrit `Synthese_Parametre` sur les lignes Projets2 du projet (§4.1) par `grist.docApi`, le vrai ;
  - met à jour le cache `cachedProjectAvancementConfigs`, relit le registre hors cache comme
    `saveSyntheseLayout`, puis ferme la fenêtre.
  - En cas d'échec, la fenêtre reste ouverte avec le message d'erreur.
- **À l'ouverture** : relire `Projets2` hors cache (`refreshProjectRegistryFromGrist({ notify: false,
  clearInvalid: false, forceRefresh: true })`, attendu). Cette fonction avale ses erreurs : en cas
  d'échec, le cache courant sert, sans message. Construire ensuite les lignes en mémoire depuis le paramètre du projet, ou depuis
  `FLOOR_TEMPLATE` s'il est absent ou illisible. Si le paramètre est illisible, l'afficher dans la
  zone de message : « Le modèle enregistré est illisible : modèle d'origine affiché. »

Si une fonction du contrôleur appelle ailleurs `window`, `document` ou le contexte global (et non
ses dépendances injectées), la corriger par injection plutôt que de la contourner dans la fenêtre.

## 7. Fichiers

- **Nouveaux** :
  - `services/syntheseFloorParameter.js` (pur) : `parseFloorTemplate`, `serializeFloorTemplate`,
    `templateToRows` (lignes en mémoire), `defaultTemplateItems`, et lecture / écriture Projets2
    (`parametreForProject`, `hasParametreColumn`, `buildParametreActions`, `withParametre`).
  - `services/memoryDocApi.js` (pur) : le faux `docApi` et ses lignes.
  - `ui/syntheseParameterDialog.js` : la fenêtre.
- **Modifiés** :
  - `services/syntheseFloorTemplate.js` : modèle en paramètre, `days`, `id2`, `indice`, `control`.
  - `ui/syntheseTasksController.js` : option `getFloorTemplate`.
  - `ui/syntheseTaskTable.js` : options `hiddenFields`, `templateMode` et clés de stockage.
  - `main.js` : bouton, fenêtre, lecture et écriture Projets2, `getFloorTemplate`.
  - `services/gristService.js` : `parametreRaw`.
  - `config.js`, `index.html`, `assets/css/styles.css`.
- Le numéro `?v=` de `main.js` et `styles.css` est relevé. Quatre tests l'épinglent :
  `structureLinkWiring`, `syntheseGanttWiring`, `syntheseTasksWiring` et `globalWiring` pour le
  contexte.

## 8. Tests attendus

- **Lecture** : `parseFloorTemplate` sur un JSON valide, vide, illisible, de version inconnue, et
  sur des éléments invalides (codes en double, parent ou lien inconnu, `days` hors bornes).
- **Aller-retour** : `templateToRows` puis `serializeFloorTemplate` redonnent le modèle d'origine,
  à la structure près (codes traduits, voir §4.2).
  Un modèle modifié (cycle ajouté, durée changée, lien changé) se relit à l'identique.
- **Création d'étage** avec un modèle personnalisé :
  - nombre de lignes ;
  - `Duree_1` ;
  - Parent et Lien du second temps ;
  - `{E}` remplacé ;
  - `Controle_Coffrage` écrit seulement si la colonne existe ;
  - repli sur `FLOOR_TEMPLATE` si le paramètre est absent ou illisible.
- **Faux `docApi`** : chaque action, ids croissants jamais réutilisés, erreur sur une table autre
  que `Planning_Projet` ou un id inconnu.
- **Fenêtre de bout en bout**, avec un faux DOM comme `syntheseStoreyTable.test.mjs` :
  - ouvrir ;
  - ajouter un cycle : il se place avant SIGNATURE ;
  - y ajouter une tâche ;
  - lui donner 3 jours ;
  - enregistrer.
  Puis vérifier l'action Projets2 écrite et son JSON. Aucune action ne doit partir vers le vrai
  `docApi` avant « Enregistrer ».
- **Droits** : lecture seule, « Editer » inactif, colonne absente (« Enregistrer » grisé, message),
  abandon avec ou sans modifications.
- **Tableau** : `hiddenFields` (aucune cellule Début ni Fin, Tab saute ces champs) et
  `templateMode` (menus réduits, zone masquée, étage non renommable). Rien ne change sans ces
  options : les tests actuels restent verts.
- **Renommage** d'un étage « Nouvel étage » dont une tâche et un cycle portent ce nom ailleurs
  qu'après « NIV » ou « GO » : les deux suivent. Un étage « R+1 » renommé garde la règle actuelle.
- **Avertissements** : un modèle sans FOND DE PLAN, sans tâche contrôlée, sans Demarrage.
- **Câblage** :
  - le bouton est après « Par étage » et visible seulement en Synthese ;
  - `getFloorTemplate` est passé au contrôleur principal ;
  - les trois chemins de création utilisent le modèle du projet.

## 9. Laissé au constructeur

- Le découpage exact des modules et les noms internes, dans l'esprit du §7.
- Le style de la fenêtre, dans la charte existante. S'inspirer de `structureLinkDialog` et
  `syntheseFloorDialog` : en-tête bleu VINCI, boutons `synthese-button`.
- Le texte exact des messages secondaires.
- Comment `templateMode` masque la ligne de zone : par filtrage des lignes ou par CSS, du moment
  que la numérotation des lignes reste cohérente avec ce qui est affiché.
