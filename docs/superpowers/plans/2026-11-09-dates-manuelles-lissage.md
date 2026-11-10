# Dates manuelles du lissage — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objectif :** imposer, depuis la fenêtre « Lissage », la date de fin d'un plan
en mode lissé (colonne `Planning_Projet.Date_Manuel_Lissage`). Le plan compte
dans le maximum de son mois, et les autres plans se lissent autour de lui.

**Architecture :**
- **Calcul.** Les dates manuelles entrent dans `smoothTasks` par
  `settings.manualDates` (`{rowId: "AAAA-MM-JJ"}`), ce qui garde le module pur.
  Elles sont lues dans les lignes de `Planning_Projet`.
- **Écriture.** Elles partent dans le même `applyUserActions` que la cellule
  `Projets2.Lissage`.
- **Interface.** La fenêtre « Choisir les plans » réutilise `planSearchModal.js`
  avec un autre préfixe d'id et une colonne date.

**Technique :** modules ES en JavaScript sans build, tests `node --test`, mock
Grist dans `dev/`.

**Spec :** `docs/superpowers/specs/2026-11-09-dates-manuelles-lissage-design.md`.
Elle est citée « S§ ». La spec du lissage, `2026-10-23-lissage-taches-design.md`,
est citée « L§ ».

## Contraintes globales

- **Commits.** Ne JAMAIS faire de commit, de push ni de déploiement :
  l'utilisateur commite lui-même et teste sur localhost. Les étapes « commit »
  de ce plan sont remplacées par « ne pas commiter ».
- **Langue.** Tous les textes visibles, commentaires et noms de tests sont en
  français, dans le style des fichiers voisins. Le texte venant des données est
  échappé avant d'entrer dans le HTML.
- **Fins de ligne.** Les CRLF ou LF de chaque fichier sont conservés.
  `index.html`, `dev/harness.html` et `assets/css/styles.css` sont en CRLF.
  Vérifier avec `tr -cd '\r' < f | wc -c` comparé à `wc -l`. Ne pas utiliser
  `sed -i`.
- **Échappements dans les outils.** Write et Edit décodent `\uXXXX` en
  caractères bruts : pour les accents, écrire `/\p{M}/gu`.
- **Commandes de test** (depuis `planning-synchro/`) :
  `node --test tests/*.test.mjs`. Depuis la racine :
  `node --test shared/tests/*.test.cjs`.
- **Nom de colonne.** `Date_Manuel_Lissage`, de type Date. Grist rend des
  secondes UTC ; le widget écrit `Date.UTC(a, m-1, j) / 1000`, ou `null` pour
  effacer.
- **Textes exacts** (S§5) :
  - le titre « Plan particulier » ;
  - les boutons « Ajouter ce plan », « Choisir dans la liste… » et « Terminé » ;
  - le titre de fenêtre « Choisir les plans » ;
  - « Choisissez une date à partir du JJ/MM/AAAA. » ;
  - « Aucun plan particulier : le lissage place chaque plan lui-même. » ;
  - « Ajoutez une colonne Date « Date_Manuel_Lissage » dans Planning_Projet
    pour imposer la date d'un plan. » ;
  - « date manuelle », et la raison « dates manuelles ».
- **Visuels.** Pas de couleur inventée : on réutilise les classes, pastilles et
  couleurs des fenêtres existantes (`.ps-plan-search-*`, `.ps-smoothing-*`).

## Points à surveiller en relecture

1. **Frappe dans une case date pendant le recalcul de l'aperçu.** Le recalcul
   ne doit ni voler le focus ni effacer la saisie, ni dans la section ni dans la
   fenêtre par-dessus. Les tests des tâches 5 et 6 couvrent ce cas.
2. **Échap avec la fenêtre « Choisir les plans » ouverte.** Seule celle-ci se
   ferme, dans les deux ordres possibles des écouteurs (tâche 6).
3. **Date enregistrée sur un plan réalisé, ou sur un plan absent des tâches.**
   Elle n'est ni affichée comme modifiable, ni effacée par un enregistrement qui
   ne la touche pas : l'écriture ne porte que sur un diff (tâches 6 et 7).
4. **Colonne absente dans le document Grist.** La section est désactivée avec
   son message, aucune écriture ne vise la colonne, et le reste du lissage
   marche (tâches 6 et 7).
5. **Relecture où seule la date manuelle change.** C'est le cas après notre
   propre écriture : pas de `loadProject`, donc pas de rechargement visible.
   L'ajout de la colonne, lui, recharge tout (tâche 8).

---

### Tâche 1 : module pur `manualDates.js` et configuration

**Fichiers :**
- Créer : `planning-synchro/assets/js/top/manualDates.js`
- Modifier : `planning-synchro/assets/js/config.js`, en ajoutant
  `manualSmoothingDate: "Date_Manuel_Lissage"` dans `columns.planningProject`
- Test : `planning-synchro/tests/manualDates.test.mjs`

**Interfaces produites :**
- `readManualDates(rows, columns) -> { hasColumn: boolean, dates: { [rowId:string]: "AAAA-MM-JJ" } }`
  - `columns` est `APP_CONFIG.grist.columns.planningProject`.
  - `hasColumn` est vrai si au moins une ligne porte la propriété
    `columns.manualSmoothingDate`.
  - La valeur passe par `parseCalendarDate` puis `formatIsoDate`
    (`../utils/dates.js`). Une valeur vide ou illisible est ignorée.
  - La clé est `String(row[columns.id])`.
- `isoToGristDate(iso) -> number | null` : secondes à minuit UTC ; `null` pour
  une date invalide ou vide.
- `diffManualDates(before, after) -> Array<{ rowId: number, iso: string | null }>`
  - Une entrée par clé dont la valeur diffère ; une clé absente vaut `null`.
  - Le résultat est trié par `rowId` croissant.
- `sameManualDates(a, b) -> boolean`.
- `firstAllowedManualIso(startMonthKey, todayIso) -> "AAAA-MM-JJ"` :
  `todayIso` si `startMonthKey === monthKeyOf(todayIso)`, sinon
  `` `${startMonthKey}-01` ``.
- `isIsoDate(value) -> boolean` : vrai pour une date AAAA-MM-JJ réelle.

- [ ] **Étape 1 : écrire les tests qui échouent**

  Les tests vérifient :
  - **lecture des secondes :** `readManualDates([{id: 3, Date_Manuel_Lissage: Date.UTC(2027, 0, 16) / 1000}], cols)`
    donne `{ hasColumn: true, dates: { "3": "2027-01-16" } }` ;
  - **lecture des textes :** ISO `"2027-02-03"` et FR `"03/02/2027"` donnent
    tous deux `"2027-02-03"` ;
  - **valeurs ignorées :** `""`, `null` et `"abc"` n'ont pas d'entrée ;
  - **colonne absente :** des lignes sans la propriété donnent
    `hasColumn: false` et `dates: {}` ;
  - **conversion :** `isoToGristDate("2027-01-16") === Date.UTC(2027, 0, 16) / 1000`,
    et `isoToGristDate("2027-02-30") === null` ;
  - **diff :** `diffManualDates({ "2": "2027-01-01", "5": "2027-03-01" }, { "5": "2027-03-02", "7": "2027-04-01" })`
    donne
    `[{rowId: 2, iso: null}, {rowId: 5, iso: "2027-03-02"}, {rowId: 7, iso: "2027-04-01"}]` ;
  - **comparaison :** `sameManualDates({"1": "2027-01-01"}, {"1": "2027-01-01"})`
    est vrai, et faux si une valeur change ;
  - **première date permise :**
    `firstAllowedManualIso("2027-01", "2027-01-10") === "2027-01-10"`, et
    `firstAllowedManualIso("2026-10", "2027-01-10") === "2026-10-01"`.
- [ ] **Étape 2 :** `node --test tests/manualDates.test.mjs` échoue, faute de
  module.
- [ ] **Étape 3 :** écrire le module, avec un commentaire d'en-tête dans le
  style du dépôt.
- [ ] **Étape 4 :** les tests passent ; la suite complète passe.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 2 : plans fixés dans `taskSmoothing.js`

**Fichiers :**
- Modifier : `planning-synchro/assets/js/top/taskSmoothing.js` (en-tête,
  `smoothTasks`, `buildSmoothedTasks`, `collectViolations`)
- Modifier : `planning-synchro/assets/js/top/taskLabels.js`, en ajoutant
  `"dates-manuelles": "dates manuelles"` dans `OVERFLOW_REASON_LABELS`
- Tests : `planning-synchro/tests/taskSmoothing.test.mjs` (nouveaux
  scénarios, aussi enregistrés dans `SCENARIOS`) et
  `planning-synchro/tests/taskSmoothingFuzz.test.mjs`

**Interfaces :**
- **Consommées :** `settings.manualDates` (`{[rowId]: "AAAA-MM-JJ"}`), lu dans
  `smoothTasks` et dans `collectViolations`.
- **Produites :**
  - `SmoothedTask.manual: boolean` : plan fixé, S§4.1.
  - `SmoothedTask.forced: boolean` : coffrage placé sans place, S§4.2.
  - `SmoothedTask.followsManual: boolean` : coffrage replacé à cause d'une
    armature fixée, soit au pré-placement, soit par la borne de jour.
  - `SmoothingResult.manualCount` et `SmoothingResult.delayedCount` :
    `delayedCount` compte les plans fixés dont `smoothedIso > dueIso`.
  - Raison de dépassement `"dates-manuelles"`.
  - `moved` reste « `!manual && monthsAdvanced > 0` », et `movedCount` en
    découle. `monthsAdvanced` d'un plan fixé vaut mois de l'échéance moins mois
    de la date manuelle, et peut être négatif.

**Règles de mise en œuvre** (S§4, à respecter à la lettre) :
- **Plan fixé.** Un plan est fixé s'il n'est pas réalisé, si `rowId != null`,
  et si `settings.manualDates[String(rowId)]` est une date ISO réelle.
- **Entrée de travail.** L'entrée d'un plan fixé prend
  `month = mois de la date manuelle`, `frozen = true` et `manualIso = date`.
  Les comptes initiaux (`counter`) la mettent donc dans son mois.
- **Retour anticipé.** Le retour « sans maximum » n'a lieu que si
  `!limits.active` **et** aucun plan n'est fixé.
- **Pré-placement (S§4.2).** Il a lieu une fois `latestFit` défini, avant
  `placeCandidates`. Pour chaque armature fixée, dans l'ordre
  `compareChartTasks`, on prend ses coffrages (`coffragesOf`) non figés et
  non fixés dont `month > armature.month`, du plus tardif au plus tôt. Pour
  chacun :
  - `target = latestFit(COFFRAGE, armature.month)` ;
  - si `target` est `null`, alors `target = armature.month` et
    `forced = true` ;
  - puis `moveEntry`, `pulledFor = id2 de l'armature`, `followsManual = true`,
    et ajout dans `pullInvolved`. **L'armature fixée n'est pas ajoutée** à
    `pullInvolved`.
- **Dates (`buildSmoothedTasks`).**
  - Un plan fixé prend sa date manuelle.
  - Ensuite, pour chaque armature fixée, tout coffrage non figé et non fixé
    de son groupe, dans le même mois et de date `> manualIso`, est borné à
    `manualIso`. Il prend alors `followsManual = true` et `pulledFor = id2`.
  - Seulement après vient la boucle existante qui relève une armature avancée
    à la date de son coffrage. Elle **ignore** les plans fixés.
- **Raisons de dépassement.**
  - `frozenCounter` exclut les plans fixés, `manualCounter` compte les plans
    fixés et les coffrages `forced`, et `forcedCounter` compte les seuls
    `forced`.
  - Si `frozen > max`, la raison existante s'applique.
  - Sinon, si `frozen + manual > max` ou si
    `forcedCounter.get(month, série) > 0` (le Total compte tout forcé du mois),
    la raison est `"dates-manuelles"`.
  - Sinon, la chaîne existante s'applique.
- **Violations (`collectViolations`).**
  - Un plan fixé n'est vérifié par **aucune** règle, mais il reste compté dans
    les comptes du mois.
  - Une tâche `followsManual` n'est vérifiée ni par la règle 2 ni par la
    règle 5. La règle 1 reste vérifiée.
  - Mettre à jour l'en-tête et le commentaire de `smoothTasks` en conséquence.

- [ ] **Étape 1 : écrire les scénarios qui échouent**

  Aujourd'hui = `JANUARY` (2027-01-10), et l'assistant est `t()`. Les
  scénarios :
  - **P1. Un plan fixé compte dans son mois.**
    - Réglages : `maxTotal 2`.
    - Tâches : `t(1,"COFFRAGE","2027-03-05")`, `t(2,"NDC","2027-03-20")`,
      `t(3,"NDC","2027-04-10")`, avec `manualDates {"3": "2027-03-25"}`.
    - Attendu : 1 a `smoothedIso "2027-02-05"` ; 2 reste au `"2027-03-20"` ;
      3 a `smoothedIso "2027-03-25"`, `manual true`, `moved false` et
      `monthsAdvanced 1`.
    - Comptes : `movedCount 1`, `manualCount 1`, `delayedCount 0`.
  - **P2. Un plan fixé plus tard libère son mois.**
    - Réglages : `maxTotal 1`.
    - Tâches : `t(1,"NDC","2027-03-05")` avec la date manuelle
      `"2027-05-12"`, et `t(2,"NDC","2027-03-20")`.
    - Attendu : 2 reste au `"2027-03-20"` ; 1 a `smoothedIso "2027-05-12"` et
      `monthsAdvanced -2`.
    - Comptes : `delayedCount 1`, `movedCount 0`.
  - **P3. Un plan réalisé ignore sa date.**
    - Tâche : `t(1,"NDC","2027-03-05",{realized:true})` avec la date manuelle
      `"2027-06-01"`.
    - Attendu : `smoothedIso "2027-03-05"`, `manual false`, `manualCount 0`.
  - **P4. Une armature fixée entraîne son coffrage, sans maximum.**
    - Tâches : `t(1,"COFFRAGE","2027-04-20",{groupKey:"g"})` et
      `t(2,"ARMATURES","2027-05-10",{groupKey:"g"})`, avec la date manuelle
      `{"2": "2027-03-10"}`.
    - Attendu : `active true` ; 1 a `smoothedIso "2027-03-10"` (borné),
      `pulledFor "2"`, `followsManual true`, `forced false` ; `overflows []`.
  - **P5. Coffrage forcé.**
    - Réglages : `maxByType {COFFRAGE: 1}`.
    - Tâches : `t(10,"COFFRAGE","2027-01-15")`, `t(11,"COFFRAGE","2027-02-15")`,
      `t(12,"COFFRAGE","2027-03-15")`, `t(1,"COFFRAGE","2027-05-20",{groupKey:"g"})`
      et `t(2,"ARMATURES","2027-06-10",{groupKey:"g"})`, avec la date manuelle
      `{"2": "2027-03-12"}`.
    - Attendu : 1 a `smoothedIso "2027-03-12"` et `forced true` ; `overflows`
      contient
      `{month:"2027-03", series:"COFFRAGE", count:2, max:1, reason:"dates-manuelles"}`.
  - **P6. Un coffrage fixé après son armature la bloque.**
    - Réglages : `maxTotal 1`.
    - Tâches : `t(1,"COFFRAGE","2027-03-05",{groupKey:"g"})` avec la date
      manuelle `"2027-04-25"`, `t(2,"ARMATURES","2027-04-10",{groupKey:"g"})`
      et `t(3,"NDC","2027-04-20")`.
    - Attendu : 2 a `smoothedIso "2027-04-10"` et `rule4Exception true` ; 3 est
      dans le mois `"2027-03"`.
  - **P7. Des dates seules suffisent.**
    - Réglages : `{maxTotal: null, maxByType: {}, manualDates: {"1": "2027-02-01"}}`.
    - Tâches : `t(1,"NDC","2027-03-05")` et `t(2,"NDC","2027-03-06")`.
    - Attendu : `active true`, `overflows []`, 1 au `"2027-02-01"`, 2 inchangé.
  - Pour tous : `findSmoothingViolations(...)` est vide (enregistrés dans
    `SCENARIOS`), et aucun `console.warn`.
- [ ] **Étape 2 : étendre le fuzz.**
  - **Tirage.** Dans `makeCase`, chaque tâche non réalisée reçoit, avec une
    probabilité de 15 %, une date manuelle tirée uniformément dans
    [`FIRST_DAY`, `LAST_DAY`].
  - **Nouvelles vérifications :**
    - un plan fixé a `smoothedIso === date manuelle` et `manual === true` ;
    - un coffrage dont `pulledFor` nomme une armature fixée de son groupe a
      `smoothedIso <=` la date manuelle de cette armature.
  - **Adaptations :**
    - « l'armature que nomme `pulledFor` est avancée » devient « avancée ou
      fixée » ;
    - les plans fixés sont exclus du contrôle de la préférence 4 (ils ne sont
      pas mobiles) et du contrôle « `rule4Exception` ne vise que des tâches
      mobiles ».
  - **Inchangé :** les contrôles d'absence de `console.warn`, de déterminisme
    et d'indépendance à l'ordre d'entrée restent actifs.
- [ ] **Étape 3 :** lancer les deux fichiers. P1 à P7 et le fuzz échouent.
- [ ] **Étape 4 :** mettre en œuvre les règles ci-dessus.
- [ ] **Étape 5 :** les deux fichiers passent (fuzz compris), et toute la suite
  passe.
- [ ] **Étape 6 :** ne pas commiter.

### Tâche 3 : `hasSmoothing` et la sérialisation (`smoothingSettings.js`)

**Fichiers :**
- Modifier : `planning-synchro/assets/js/top/smoothingSettings.js`
- Test : `planning-synchro/tests/smoothingSettings.test.mjs`

**Interfaces produites :**
- `hasManualDates(settings) -> boolean` : vrai si `settings.manualDates` a au
  moins une clé.
- `hasSmoothing(settings) -> boolean` : `hasAnyMax(settings) || hasManualDates(settings)`.
- `serializeSmoothingCell` garde l'entrée du service si `hasAnyMax(settings)`,
  ou si `settings.startMonth` et `hasManualDates(settings)` sont tous deux
  vrais. Dans ce second cas, l'entrée vaut `{maxParType: {}, debut}`. Les
  dates manuelles n'y figurent **jamais**.

- [ ] **Étape 1 : écrire les tests qui échouent**
  - **Mois de départ gardé :**
    `serializeSmoothingCell("", "Structure", {maxTotal: null, maxByType: {}, startMonth: "2026-10", manualDates: {"1": "2027-01-02"}})`
    donne `{"version":1,"services":{"Structure":{"maxParType":{},"debut":"2026-10"}}}`.
    La relecture par `getServiceSettings` rend `startMonth "2026-10"`, et
    `hasAnyMax` est faux.
  - **Mois de départ seul :** sans dates manuelles, le même appel donne `""`.
  - **`hasSmoothing` :** vrai avec `manualDates {"1": "…"}` seul, et faux avec
    `{}`.
  - **Aucune fuite :** `manualDates` n'apparaît jamais dans la cellule.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** mettre en œuvre.
- [ ] **Étape 4 :** les tests et la suite passent.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 4 : écriture en un lot (`gristService.js`)

**Fichiers :**
- Modifier : `planning-synchro/assets/js/services/gristService.js`, fonction
  `updateProjectSmoothing`
- Test : `planning-synchro/tests/gristService.test.mjs`

**Interfaces :**
- **Consommée :** `isoToGristDate`, de la tâche 1.
- **Produite :**
  `updateProjectSmoothing(projectId, value, manualWrites = []) -> Promise<void>`.
  - `manualWrites` est une liste `[{rowId, iso | null}]`.
  - Tous les ids sont validés par `toReferenceId` avant toute écriture. Un id
    invalide lève « Ligne de planning invalide : id manquant. ». Un `iso` non
    nul invalide lève « Date manuelle invalide. ».
  - **Un seul** `applyActions`, avec l'`UpdateRecord` de `Projets2` d'abord,
    puis une
    `["UpdateRecord", "Planning_Projet", rowId, {Date_Manuel_Lissage: secondes | null}]`
    par écriture.

- [ ] **Étape 1 : écrire les tests qui échouent, sur le modèle des tests
  d'`updatePlanningDurations`**
  - Un appel avec 2 écritures produit **un** `applyUserActions` de 3 actions,
    dans cet ordre et avec les valeurs exactes en secondes ou `null`.
  - Sans écriture, le comportement reste celui d'aujourd'hui (1 action).
  - Un id invalide lève l'erreur, et aucun `applyUserActions` n'est appelé.
  - Le lot traverse les **vraies** fonctions partagées
    (`core.isProtectedMutationAction`, `core.rowMatchesContext`,
    `core.transformActions`), comme le test « updatePlanningDurations : le lot
    traverse la couche de contexte partagée ».
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** mettre en œuvre, en mettant à jour le commentaire.
- [ ] **Étape 4 :** les tests passent ; la suite de planning-synchro et
  `shared/tests` passent.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 5 : `planSearchModal.js`, réutilisable pour « Choisir les plans »

**Fichiers :**
- Modifier : `planning-synchro/assets/js/top/planSearchModal.js`
- Modifier : `planning-synchro/index.html` et `planning-synchro/dev/harness.html`,
  avec un balisage `#ps-plan-pick-modal` identique dans les deux, placé après
  `#ps-smoothing-modal`
- Modifier : `planning-synchro/assets/css/styles.css`
- Modifier : `planning-synchro/tests/editSegmentModalDom.test.mjs`, en ajoutant
  le préfixe de parité `"ps-plan-pick"`
- Test : `planning-synchro/tests/planSearchModal.test.mjs`

**Interfaces :**
- **Consommées :** `SmoothedTask.manual`, `monthsAdvanced` (éventuellement
  négatif), `followsManual` (tâche 2).
- **Produites :**
  - `createPlanSearchModal(rootEl, { idPrefix = "ps-plan-search", onManualDateChange = null } = {})`
    - Les ids internes deviennent
      `${idPrefix}-{title,subtitle,close,number,name,zone,type,status,summary,lissage,reset,results}`,
      plus `${idPrefix}-done`, facultatif, qui ferme la fenêtre.
    - **Mode choix.** Si `onManualDateChange` est une fonction :
      - un événement `input` sur `input[data-manual-row]` appelle
        `onManualDateChange(Number(rowId), value)` ;
      - un clic sur `[data-manual-clear]` appelle
        `onManualDateChange(Number(rowId), "")`.
    - **Échap.** Quand la fenêtre est ouverte, Échap la ferme et appelle
      `event.preventDefault()`.
    - **Focus.** Si une case date des résultats a le focus, `update()` diffère
      le rendu du tableau jusqu'au `focusout` des résultats.
  - Le modèle de `open`/`update` gagne
    `manual?: { dates: {[rowId]: iso}, minIso: string, readOnly: boolean }`.
  - `buildPlanSearchEntries` ajoute `manual: Boolean(active && task.manual)`.
  - `renderPlanSearchResults({ entries, active, manual = null })`.
    - Avec `manual`, une colonne « Date manuelle » s'ajoute en dernier :
      - plan réalisé : `<span class="ps-plan-search-note">réalisé, ne bouge pas</span>` ;
      - lecture seule : la date au format JJ/MM/AAAA, ou « — » ;
      - sinon : `<input type="date" class="ps-plan-pick-date" data-manual-row=… value=… min=…>`,
        avec un `aria-label` « Date manuelle, N° x ». Il est suivi d'un bouton
        ✕ `data-manual-clear` quand une valeur existe.
    - Échéance lissée d'un plan fixé (classe `ps-plan-search-date--manual`) :
      la date en gras, puis « date manuelle », puis « N mois plus tôt »,
      « N mois plus tard » ou « même mois ».
  - Filtre État : `PLAN_STATUS.MANUAL = "manuels"`. L'option « Dates manuelles »
    n'est proposée que si `active` et qu'au moins une entrée est `manual`.
  - Le texte du lissage ajoute « · N date(s) manuelle(s) » quand ce nombre est
    supérieur à 0.
- **Balisage `#ps-plan-pick-modal`.**
  - C'est une copie de `#ps-plan-search-modal` avec le préfixe `ps-plan-pick`.
  - Racine :
    `class="ps-modal ps-modal--over"`, avec
    `style="display: none;" aria-hidden="true"`.
  - Titre « Choisir les plans ».
  - Aide : « Changez la date manuelle d'un plan : la fenêtre « Lissage » en
    dessous suit. Rien n'est enregistré avant « Enregistrer ». »
  - Pied avec le bouton `#ps-plan-pick-done` « Terminé ».
  - CSS : `.ps-modal--over { z-index: 25; }`, plus le style de la colonne date,
    avec les classes et couleurs existantes.

- [ ] **Étape 1 : écrire les tests qui échouent**
  - **Préfixe :** une racine portant les ids `ps-plan-pick-*` est pilotée, et
    `#ps-plan-pick-done` la ferme.
  - **Colonne date :** `renderPlanSearchResults` avec `manual` rend une case
    date (`value`, `min`, `data-manual-row`) ; pour un plan réalisé, « réalisé,
    ne bouge pas » ; en lecture seule, la date sans case.
  - **Saisie :** un `input` sur la case appelle `onManualDateChange(3, "2027-02-14")`,
    et un clic ✕ appelle `onManualDateChange(3, "")`.
  - **Plan fixé :** la classe `ps-plan-search-date--manual` est présente, avec
    « date manuelle » et « 2 mois plus tard » (`monthsAdvanced -2`).
  - **Filtre « Dates manuelles » :** il garde les seules entrées `manual`, et
    son option est absente sans plan fixé.
  - **Échap :** il appelle `preventDefault`.
  - **Focus :** `update()` pendant qu'une case date a le focus ne remplace pas
    `innerHTML` avant le `focusout`.
  - **Non-régression :** les 14 tests existants passent sans changement.
  - **Parité :** le test de parité couvre `ps-plan-pick`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** mettre en œuvre le module, le balisage (CRLF) et la CSS
  (CRLF).
- [ ] **Étape 4 :** les tests et la suite passent ; les fins de ligne sont
  vérifiées.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 6 : section « Plan particulier » et fenêtre par-dessus (`smoothingModal.js`)

**Fichiers :**
- Modifier : `planning-synchro/assets/js/top/smoothingModal.js`
- Modifier : `planning-synchro/index.html` et `planning-synchro/dev/harness.html`,
  avec une section identique dans les deux, placée après
  `.ps-smoothing-add-month` et avant `#ps-smoothing-field-error`
- Modifier : `planning-synchro/assets/css/styles.css`
- Test : `planning-synchro/tests/smoothingModal.test.mjs`

**Interfaces :**
- **Consommées :**
  - `createPlanSearchModal(el, {idPrefix: "ps-plan-pick", onManualDateChange})`
    et `buildPlanSearchEntries` (tâche 5) ;
  - `firstAllowedManualIso` et `isIsoDate` (tâche 1) ;
  - `SmoothedTask.manual` et `monthsAdvanced` (tâche 2).
- **Produites :**
  - `createSmoothingModal(rootEl, { compute, onSubmit, onDelete, debounceMs, pickerEl = null, createPicker = createPlanSearchModal })`.
  - Le contexte d'`open` et de `refresh` gagne :
    - `manualDates` (état enregistré, `{rowId: iso}`) ;
    - `hasManualColumn` ;
    - `subtitle` (« Projet · Service ») ;
    - `service`.
  - `refresh` accepte en plus `manualDates`. La saisie garde un ensemble
    `touched` des `rowId` ajoutés, modifiés ou retirés pendant la session.
    - **Arrivée de nouvelles dates.** Pour chaque `rowId` **non touché**, la
      saisie prend la nouvelle valeur ; l'absence d'une valeur retire l'entrée.
      Les plans touchés gardent la saisie.
    - **Rendu.** Les lignes et les choix sont ensuite rendus de nouveau, et
      l'aperçu est relancé.
    - **Remise à zéro.** `open` vide `touched`.
  - `readDraft().settings.manualDates` est **toujours présent** quand
    `hasManualColumn`, même vide `{}`, et absent sinon. Il contient toutes les
    entrées non vides de la saisie, y compris celles des plans non affichés
    (réalisés ou absents), qui sont gardées telles quelles.
  - Fonctions pures exportées :
    - `buildManualPlanRows({ tasks, draftManual, result }) -> Array<{ rowId, id2, name, place, type, typeLabel, typeColor, dueIso, value, note }>`
      - On ne garde que les tâches non réalisées dont le `rowId` est dans
        `draftManual`.
      - Tri par `value`, les vides en dernier, puis par `compareChartTasks`.
      - `note` est faite des morceaux suivants, joints par « · » :
        - « N mois plus tôt », « N mois plus tard » ou « même mois », pris
          dans `result.tasks` ;
        - pour un COFFRAGE, « après son armature N° a » pour chaque armature
          non réalisée du même `groupKey` dont la date lissée (sinon
          l'échéance) est antérieure à `value`.
    - `buildPlanChoices(tasks, draftManual) -> Array<{ value: String(rowId), label }>`
      - Plans non réalisés, `rowId != null`, absents de `draftManual`, dans
        l'ordre des tâches.
      - Libellé « N° id2 — nom », suivi de « (zone) » si la zone existe.
- **Balisage**, qui contient :
  - le titre « Plan particulier », et l'aide de S§5.1 ;
  - `<p id="ps-smoothing-plans-unavailable" class="ps-smoothing-hint" hidden>`
    portant le message « colonne absente » ;
  - `<div id="ps-smoothing-plans" class="ps-smoothing-plans">` ;
  - `<div class="ps-smoothing-add-plan">`, qui contient la liste
    `#ps-smoothing-plan-select` (`aria-label` « Plan à ajouter »), le bouton
    `#ps-smoothing-plan-add` « Ajouter ce plan » et le bouton
    `#ps-smoothing-plan-browse` « Choisir dans la liste… ».

**Comportement** (S§5.1 à S§5.4) :
- **Ajouter.** La ligne prend la date lissée du plan dans le **dernier aperçu
  calculé** (garder `lastResult` dans `renderPreviewNow`), à défaut son
  échéance. Le focus va dans la case de la ligne.
- **Rendu des lignes.**
  - Avec les mêmes `rowId` et le même mode (lecture ou écriture) qu'au dernier
    rendu, seules les notes (`[data-note-for]`) sont mises à jour.
  - Sinon le tableau est reconstruit, comme `renderMonths` et `syncMonthCells`.
- **Validation.** Pour chaque entrée affichée et non vide, la date doit être
  `isIsoDate`, et `>= firstAllowedManualIso(startKeyNow(), todayIso)` ou
  égale à la valeur enregistrée. Sinon le message est
  `Choisissez une date à partir du ${formatDateFr(min)}.`, et « Enregistrer »
  est désactivé.
- **Fenêtre par-dessus.**
  - « Choisir dans la liste… » ouvre le sélecteur avec le modèle suivant :
    - `{ subtitle, service, active: lastResult.active }` ;
    - `entries` : `buildPlanSearchEntries` sur `lastResult.tasks` si le
      lissage est actif, sinon sur `context.tasks` ;
    - `manual: { dates: saisie valide, minIso, readOnly }`.
  - `onManualDateChange(rowId, iso)` : une valeur vide supprime l'entrée de la
    saisie, sinon la date est posée. Puis la fenêtre rend les lignes et les
    choix, appelle `syncButtons()` et lance l'aperçu.
  - Après chaque `renderPreviewNow`, si le sélecteur est ouvert, il reçoit
    `picker.update(modèle)`.
  - `close()` et `destroy()` ferment ou détruisent aussi le sélecteur.
- **Échap.** Le gestionnaire d'Échap de la fenêtre « Lissage » ne fait rien si
  `event.defaultPrevented` ou si `picker.isOpen()`.
- **Colonne absente.** Le message est visible, la liste et les boutons sont
  désactivés, le tableau est vide, et `manualDates` est absent de `readDraft`.
- **Lecture seule.** Les cases sont désactivées et la ligne d'ajout est
  masquée, sauf « Choisir dans la liste… », qui ouvre le sélecteur en lecture
  seule.
- **Aperçu.** Le résumé de `renderPreview` devient
  `${movedText} · ${n} date(s) manuelle(s) · aucune tâche retardée`. La partie
  du milieu n'apparaît que si `manualCount > 0`, et la dernière devient
  `${n} retardée(s) par une date manuelle` si `delayedCount > 0`. Le texte
  inactif reste celui d'aujourd'hui.

- [ ] **Étape 1 : écrire les tests qui échouent.** Un faux sélecteur est
  injecté par `createPicker`, et le `FakeElement` existant est étendu au
  besoin. Les tests :
  - `buildManualPlanRows` : tri, note « 2 mois plus tard », note « après son
    armature N° 2 », et exclusion des plans réalisés ;
  - `buildPlanChoices` : plans réalisés et déjà ajoutés exclus, et libellé
    exact ;
  - `open` avec des `manualDates` enregistrées : une ligne par plan, et la
    case porte la date ;
  - ajouter un plan : la date vient du dernier aperçu, et `Enregistrer`
    transmet `onSubmit({..., manualDates: {"3": "2027-02-15"}})` ;
  - retirer un plan : `manualDates` ne le contient plus ;
  - une date trop tôt affiche le message exact et désactive « Enregistrer » ;
    une date enregistrée plus ancienne, non modifiée, reste acceptée ;
  - la colonne absente : message visible, contrôles désactivés, et
    `onSubmit` reçoit des réglages sans `manualDates` ;
  - une entrée d'un plan réalisé est gardée telle quelle dans `manualDates` ;
  - « Choisir dans la liste… » appelle `picker.open` avec un modèle qui porte
    `manual.minIso` ; un `onManualDateChange` met à jour la section et relance
    l'aperçu, et le sélecteur reçoit `update` ;
  - Échap avec le sélecteur ouvert ne ferme pas la fenêtre « Lissage » (les
    deux ordres) ;
  - le résumé de l'aperçu avec des dates manuelles et une date en retard ;
  - la lecture seule ;
  - les tests existants passent sans changement.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** mettre en œuvre le module, le balisage et la CSS, puis
  mettre à jour l'en-tête du module.
- [ ] **Étape 4 :** les tests et la suite passent ; les fins de ligne et la
  parité sont vérifiées.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 7 : contrôleur (`smoothingController.js`)

**Fichiers :**
- Modifier : `planning-synchro/assets/js/top/smoothingController.js`
- Test : `planning-synchro/tests/smoothingController.test.mjs`

**Interfaces :**
- **Consommées :** `diffManualDates` et `sameManualDates` (tâche 1),
  `hasSmoothing` (tâche 3), `saveCell(projectId, value, manualWrites)`
  (tâche 4, injecté), et le contexte de la tâche 6.
- **Produites :**
  - `els.planPickModalEl`, passé en `pickerEl` à `createSmoothingModal`.
  - `setProjectData({ contextKey, project, tasks, projectRow, manualDates = {}, hasManualColumn = false })`.
  - `setManualDates(dates) -> boolean`.
    - Le résultat est faux sans projet, ou si `sameManualDates`.
    - Sinon : mise à jour de l'état, `recompute`, `renderHeader`, puis
      `smoothingModal.refresh({ tasks, todayIso, manualDates })` si la fenêtre
      est ouverte, `updateReadWindows` et `notify`, et le résultat est vrai.
  - `recompute` : `settings = { ...getServiceSettings(rawCell, service), manualDates }`
    si `hasManualColumn`, en gardant l'existant sans colonne. Le lissage
    « Lissage » sans colonne `Projets2.Lissage` reste désactivé comme
    aujourd'hui.
  - `writeSettings` :
    - `manualWrites = hasManualColumn ? diffManualDates(manualDates, nextSettings.manualDates ?? manualDates) : []`,
      puis `await saveCell(target.id, value, manualWrites)` ;
    - en cas de succès, `manualDates = { ...(nextSettings.manualDates ?? manualDates) }`
      si `hasManualColumn` ;
    - le mode passe à « Les deux » si `hasSmoothing(nextSettings)`.
  - `onDelete` vaut
    `saveSettings({ maxTotal: null, maxByType: {}, manualDates: {} })`.
  - `smoothingContext` ajoute `manualDates`, `hasManualColumn`,
    `subtitle: contextLabel()` et `service: displayedService()`, et
    `saved: hasSmoothing(settings)`.
  - L'API rendue ajoute `setManualDates`.

- [ ] **Étape 1 : écrire les tests qui échouent**, sur les faux existants :
  - **Lot d'écriture :** l'enregistrement de `manualDates {"3": "2027-02-15"}`,
    depuis un état `{"5": "2027-03-01"}`, appelle `saveCell(id, cellule,
    [{rowId: 3, iso: "2027-02-15"}, {rowId: 5, iso: null}])`.
  - **Succès :** le résultat recalculé place 3 au `"2027-02-15"`.
  - **Échec de `saveCell` :** l'état local est inchangé.
  - **Supprimer :** il envoie un diff qui efface toutes les dates, et « Lissage
    actif » disparaît.
  - **`setManualDates` :** des dates identiques donnent `false`, sans
    `onChange` ; des dates différentes donnent `true`, avec un recalcul, un
    `onChange` et la fenêtre de recherche mise à jour.
  - **Dates seules :** le lissage est actif et le groupe « Afficher » est
    visible.
  - **Colonne absente :** aucune écriture manuelle (`manualWrites` vide).
  - **Contexte :** `smoothingModal.open` reçoit `manualDates`,
    `hasManualColumn`, `subtitle` et `service`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** mettre en œuvre, en mettant à jour l'en-tête et le
  commentaire `els`.
- [ ] **Étape 4 :** les tests et la suite passent.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 8 : `main.js`, lecture et chemin léger

**Fichiers :**
- Modifier : `planning-synchro/assets/js/main.js`
- Test : `planning-synchro/tests/postWriteRefresh.test.mjs`, et
  `smoothingWiring.test.mjs` s'il vérifie le câblage

**Interfaces :**
- **Consommées :** `readManualDates` et `sameManualDates` (tâche 1),
  `smoothing.setManualDates` et le nouveau `setProjectData` (tâche 7).
- **Changements :**
  - `els.planPickModal = document.getElementById("ps-plan-pick-modal")`,
    passé en `planPickModalEl`.
  - Dans `loadProject`,
    `const manual = readManualDates(planningRows, pc.planningProject)`, puis
    `smoothing.setProjectData({ ..., manualDates: manual.dates, hasManualColumn: manual.hasColumn })`.
  - `planningRowsSignature(rows, columns, durationsOnly)` garde **exactement**
    son en-tête. Avec `durationsOnly = false`, il exclut maintenant aussi
    `columns.manualSmoothingDate`.
  - Dans `reloadChargeFromGrist`, juste après le contrôle de la moitié « tout
    le reste » :
    - si le `hasColumn` lu diffère de l'actuel, `reconcileAndLoad({ force: true })`,
      puis `return` ;
    - sinon, si `!sameManualDates(lu, actuel)`, recopier la colonne dans les
      lignes **en mémoire** (même référence, comme les durées), puis
      `smoothing.setManualDates(lu.dates)` ;
    - le reste de la fonction ne change pas.

- [ ] **Étape 1 : écrire les tests qui échouent**, sur le harnais existant
  (son faux `smoothing` reçoit `setManualDates`) :
  - **Seule la date manuelle change :** une relecture sans autre changement ne
    relance pas `loadProject`. Elle appelle
    `setManualDates({"<id>": "AAAA-MM-JJ"})`, et la ligne en mémoire porte la
    nouvelle valeur.
  - **Colonne apparue :** une relecture où la colonne apparaît relance
    `loadProject`.
  - **Chargement :** `loadProject` passe `manualDates` et `hasManualColumn` à
    `setProjectData`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** mettre en œuvre, en mettant à jour les commentaires de
  `planningRowsSignature` et de `reloadChargeFromGrist`.
- [ ] **Étape 4 :** les tests et la suite passent.
- [ ] **Étape 5 :** ne pas commiter.

### Tâche 9 : « Tâches du mois », données d'essai, README et vérification réelle

**Fichiers :**
- Modifier : `planning-synchro/assets/js/top/monthTasksModal.js` et
  `planning-synchro/tests/monthTasksModal.test.mjs`
- Modifier : `planning-synchro/dev/fixtures.js`, en ajoutant
  `Date_Manuel_Lissage: "2027-02-15"` sur la ligne `id: 3` d'ERA
- Modifier : `planning-synchro/README.md`, avec une section « Plan
  particulier » dans la partie lissage

**Interfaces :**
- Dans `buildBucketTaskList`, un item gagne
  `manualNote = showSmoothed && task.manual ? \`date manuelle (échéance ${formatDateFr(task.dueIso)})\` : null`,
  et `renderItem` l'ajoute aux notes secondaires.

- [ ] **Étape 1 : écrire le test qui échoue.** En mode lissé, un plan fixé a
  la note « date manuelle (échéance 16/03/2027) » ; en mode brut, il n'en a
  pas.
- [ ] **Étape 2 :** mettre en œuvre, puis faire passer le test et la suite.
- [ ] **Étape 3 : vérification dans le vrai widget**, avec `dev/harness.html` et
  Chrome sans fenêtre (voir la mémoire « headless-chrome-preview »). Sur ERA,
  vue Graphique :
  - la fenêtre « Lissage » montre la ligne du plan 3 au 15/02/2027 ;
  - l'aperçu le compte ;
  - « Choisir dans la liste… » ouvre la fenêtre par-dessus ;
  - modifier une date met à jour la section ;
  - Échap ne ferme que la fenêtre par-dessus ;
  - « Rechercher un plan » affiche « date manuelle ».

  Prendre des captures, y compris à environ 760×560.
- [ ] **Étape 4 :** passer toutes les suites (planning-synchro, gestion-depenses2,
  Gestion-globale, shared). Vérifier la syntaxe et les fins de ligne.
- [ ] **Étape 5 :** ne pas commiter.
