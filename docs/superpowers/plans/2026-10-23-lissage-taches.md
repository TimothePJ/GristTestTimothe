# Lissage des tâches (vue Graphique de planning-synchro) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** dans la vue Graphique de `planning-synchro`, permettre de fixer un maximum de tâches par mois (général et/ou par type), calculer un planning lissé qui n'avance que des tâches (jamais de retard), l'afficher (non lissé / lissé / les deux) et lister les tâches d'un mois au clic.

**Architecture :** trois modules purs (`taskLoadModel` : les tâches telles que le planning les dessine ; `taskSmoothing` : la règle de lissage ; `smoothingSettings` : le JSON de `Projets2.Lissage`), deux fenêtres DOM (`smoothingModal`, `monthTasksModal`), un contrôleur créé une seule fois (`smoothingController`) qui tient l'état du lissage hors du cycle par projet, et un graphique (`planningChart`) qui ne consomme plus que des tâches. `main.js` ne fait que brancher.

**Tech Stack :** JavaScript modules ES sans build, Chart.js (CDN, inchangé), widget Grist (`grist-plugin-api`), tests `node --test` (Node 25).

**Spec :** `docs/superpowers/specs/2026-10-23-lissage-taches-design.md` (validée le 2026-10-23). Les numéros §x.y ci-dessous renvoient à la spec.

## Global Constraints

- **Aucun commit, aucun push** (règle de l'utilisateur, prioritaire sur le skill). L'étape finale de chaque tâche est `git status` pour constater les fichiers touchés.
- Ne pas modifier `Planning Projet/`, `gestion-depenses2/`, `shared/`, ni `planning-synchro/assets/js/top/vendor/*`.
- Fins de ligne : les fichiers existants de planning-synchro modifiés ici sont **CRLF sur toutes leurs lignes** (`main.js`, `top/planningChart.js`, `top/phases.js`, `services/gristService.js`, `config.js`, `state.js`, `index.html`, `assets/css/styles.css`, `README.md`) et doivent le rester. Contrôle après chaque modification : `tr -cd '\r' < FICHIER | wc -c` égale `wc -l < FICHIER`. Les **nouveaux** fichiers sont en LF.
- Clés de type : `COFFRAGE`, `ARMATURES`, `NDC`, `COUPES`, `DEMOLITION`, `AUTRES` ; série générale : `TOTAL`.
- Colonne Grist : `Projets2.Lissage` (texte), contenu `{"version":1,"services":{"<Service>":{"maxTotal":4,"maxParType":{"COFFRAGE":2}}}}` (§5.1).
- Maximums : entiers ≥ 1 ; champ vide = pas de maximum.
- La date du jour est passée **explicitement** aux fonctions pures (`todayIso`, `AAAA-MM-JJ`, horloge locale du navigateur).
- Libellés d'interface en français accentué ; commentaires du code en français, dans le style des modules voisins (`bottom/chargeAssignModal.js`).
- Tests : `node --test planning-synchro/tests/*.test.mjs` (368 verts au départ) et `node --test shared/tests/*.test.*` (175 verts) restent verts à la fin de chaque tâche.
- Commandes lancées depuis la racine du dépôt.

## Review Focus

1. **Colonne `Lissage` absente** (prod tant que l'utilisateur ne l'a pas créée) : le graphique fonctionne comme avant, le bouton « Lisser… » est grisé avec l'explication de §5.2, aucune exception — test en Tâche 8.
2. **Cellule `Lissage` illisible** (JSON cassé, `"abc"`, `0`, `2.5`, `-1`) : pas de lissage pour l'entrée concernée, un `console.warn`, et un enregistrement ultérieur réécrit une cellule propre — tests en Tâche 4.
3. **Glisser sur le graphique** (il déplace la frise) : ne doit jamais ouvrir la liste du mois — test en Tâche 5.
4. **Dates limites** : échéance au 31 avancée vers un mois de 30 jours, tâche avancée dans le mois courant à une date déjà passée, tâche d'un mois passé jamais touchée — tests en Tâche 2.
5. **Rechargement du même projet pendant une saisie** (un collègue modifie le planning) : la fenêtre « Lissage » garde la saisie et recalcule son aperçu ; un changement de projet ou de service la ferme — tests en Tâche 8.

---

### Task 1 : modèle des tâches du graphique (dates de la barre dessinée)

**Files :**
- Create : `planning-synchro/assets/js/top/taskLabels.js`
- Create : `planning-synchro/assets/js/top/taskLoadModel.js`
- Test : `planning-synchro/tests/taskLoadModel.test.mjs`

**Interfaces :**
- Consumes : `buildTimelineDataFromPlanningRows(rows, project, zone, targetLookup, referenceLookup)` de `top/vendor/planningProjetBuilder.js` (groupes avec `rowId`, `id2Label`, `tachesLabel`, `zoneLabel`, `groupeLabel`, `realiseLabel`, `meta.groupCompositeKey` ; items de phase d'id `${group.id}-p-(coffrage|armature|ndc|coupes|demolition|generic)` éventuellement suffixés `-past` / `-current`, portant `businessEnd: Date`) ; `formatIsoDate(date)` de `utils/dates.js`.
- Produces :
  - `taskLabels.js` : `TYPE_ORDER = ["COFFRAGE","ARMATURES","NDC","COUPES","DEMOLITION","AUTRES"]`, `TYPE_META` (déplacé tel quel depuis `planningChart.js` : `{ COFFRAGE: { label: "Coffrage", color: "#d97706" }, … AUTRES: { label: "Autres", color: "#8470ff" } }`), `TOTAL_META = { label: "Total", color: "#004990" }`, `formatMonthLabel(monthKey: "AAAA-MM") -> "avril 2027"` (mois accentués : janvier, février, mars, avril, mai, juin, juillet, août, septembre, octobre, novembre, décembre), `formatDateFr(iso) -> "JJ/MM/AAAA"`.
  - `taskLoadModel.js` : `buildChartTasks(rows: object[], { project: string, targetLookup?: Map|null }) -> ChartTask[]` avec `ChartTask = { rowId: number|null, id2: string, name: string, zone: string, groupe: string, groupKey: string, type: string, dueIso: string, realized: boolean }`, triées par `dueIso`, puis `id2` numérique, puis `rowId`.

- [ ] **Step 1 : écrire les tests qui échouent** (`tests/taskLoadModel.test.mjs`, projet `"P1"`, toutes les lignes avec `NomProjet: "P1"`) :
  - `coffrage lié à MS Project : échéance = démarrage − Duree_3` — ligne `{ id: 1, ID2: "10", Taches: "COF LIE", Type_doc: "COFFRAGE", Zone: "A", Ligne_planning: "12", Demarrages_travaux: "2027-06-01", Duree_3: 4, Duree_1: 3, Date_limite: "2027-01-01", Diff_coffrage: "2027-02-01" }` → une tâche `{ rowId: 1, type: "COFFRAGE", dueIso: "2027-05-04" }`.
  - `coffrage de groupe : échéance = plus petite Diff_coffrage des armatures` — coffrage `{ id: 2, ID2: "20", Type_doc: "COFFRAGE", Zone: "B", Groupe: "1", Date_limite: "2027-01-01", Diff_coffrage: "2027-03-15", Duree_1: 2 }`, armatures `{ id: 3, ID2: "21", Type_doc: "ARMATURES", Zone: "B", Groupe: "1", Diff_coffrage: "2027-02-10", Diff_armature: "2027-02-24" }` et `{ id: 4, ID2: "22", …, Diff_coffrage: "2027-02-17", Diff_armature: "2027-03-03" }` → dues `2027-02-10`, `2027-02-24`, `2027-03-03` ; `groupKey` identique pour les trois et non vide.
  - `NDC sans Date_limite mais avec Duree_1 : comptée` — `{ id: 5, ID2: "30", Type_doc: "NDC", Duree_1: 1, Diff_coffrage: "2027-03-01" }` → `{ type: "NDC", dueIso: "2027-03-01", groupKey: "" }`.
  - `ligne sans type et type « Armature » au singulier : exclues` — `{ id: 6, Taches: "X", Demarrages_travaux: "2027-01-01" }` et `{ id: 10, Type_doc: "Armature", Diff_coffrage: "2027-02-01", Diff_armature: "2027-02-15" }` → aucune tâche pour 6 et 10.
  - `type personnalisé → AUTRES` — `{ id: 7, ID2: "40", Type_doc: "PLAN SPECIAL", Date_limite: "2027-05-01", Diff_coffrage: "2027-05-15" }` → `{ type: "AUTRES", dueIso: "2027-05-15" }`.
  - `réalisé = état de la barre, pas la colonne Realise` — `{ id: 8, ID2: "50", Type_doc: "COFFRAGE", Zone: "C", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20", Indice: "A", Realise: "0" }` → `realized: true` (cible par défaut A pour un coffrage) ; `{ id: 9, ID2: "60", Type_doc: "NDC", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-10", Realise: "100" }` → `realized: false`.
  - `autre projet ignoré` — une ligne `NomProjet: "P2"` n'apparaît pas.
  - `ordre` — la liste est triée par `dueIso` puis `id2`.
  - `formatMonthLabel("2027-08") === "août 2027"`, `formatDateFr("2027-03-05") === "05/03/2027"`.

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/taskLoadModel.test.mjs`
  Expected : FAIL (module introuvable).

- [ ] **Step 3 : implémenter `taskLabels.js` puis `buildChartTasks`** — appelle le constructeur vendorisé avec `(rows, project, "", targetLookup, null)`, garde pour chaque groupe non en-tête le premier item de phase principale (`-p-…`, hors `-demarrage`), `dueIso = formatIsoDate(item.businessEnd)`, `type` d'après le suffixe (`armature` → `ARMATURES`, `generic` → `AUTRES`), `realized = Number(group.realiseLabel) >= 100`, `groupKey = group.meta?.groupCompositeKey || ""`.

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/taskLoadModel.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status` : deux nouveaux modules et un test, rien d'autre.

---

### Task 2 : règle de lissage (sans la dépendance armature / coffrage)

**Files :**
- Create : `planning-synchro/assets/js/top/taskSmoothing.js`
- Test : `planning-synchro/tests/taskSmoothing.test.mjs`

**Interfaces :**
- Consumes : `ChartTask` (Task 1), `TYPE_ORDER` (Task 1).
- Produces :
  - `smoothTasks(tasks: ChartTask[], settings: { maxTotal: number|null, maxByType: Record<string, number> }, todayIso: string) -> SmoothingResult`
  - `SmoothingResult = { active: boolean, tasks: SmoothedTask[], movedCount: number, overflows: Overflow[] }`
  - `SmoothedTask = ChartTask & { smoothedIso: string, monthsAdvanced: number, moved: boolean, frozen: boolean, pulledFor: string|null }` (même ordre que l'entrée ; `pulledFor` = `id2` de l'armature qui a entraîné un coffrage, Task 3)
  - `Overflow = { month: "AAAA-MM", series: "TOTAL"|type, count: number, max: number, reason: "taches-realisees"|"mois-en-cours"|"coffrage-sans-place"|"plus-de-place" }`, triés par mois puis par série (`TOTAL` d'abord, puis `TYPE_ORDER`)
  - `findSmoothingViolations(tasks, settings, todayIso, result) -> string[]` (vide si toutes les règles strictes de §4.2 tiennent)
  - `monthKeyOf(iso) -> "AAAA-MM"`, `shiftIsoByMonths(iso, deltaMonths) -> iso` (jour conservé, borné au dernier jour du mois)

- [ ] **Step 1 : écrire les tests qui échouent.** Aide locale `t(id, type, dueIso, extra = {})` → `{ rowId: id, id2: String(id), name: "T" + id, zone: "", groupe: "", groupKey: "", type, dueIso, realized: false, ...extra }`. Pour chaque cas on compare les mois lissés (`monthKeyOf(smoothedIso)`) par `rowId`.
  - `exemple A (utilisateur)` — today `2027-01-10`, `{ maxTotal: 4, maxByType: {} }` ; M1 COFFRAGE `2027-03-05`, M2 NDC `2027-03-20`, A1…A8 (types mêlés) `2027-04-02` … `2027-04-24` → M1, M2 en `2027-02` ; A1…A4 en `2027-03` ; A5…A8 en `2027-04` ; `movedCount === 6` ; M1 `smoothedIso === "2027-02-05"`, A1 `"2027-03-02"`.
  - `exemple B : pas de place, rien ne bouge` — today `2026-10-05`, max 4 ; octobre 4, novembre 4, décembre 8 → aucune tâche avancée ; `overflows` = `[{ month: "2026-12", series: "TOTAL", count: 8, max: 4, reason: "plus-de-place" }]`.
  - `exemple C : la place va au premier mois débordant` — today `2026-10-05`, max 4 ; octobre 2, novembre N1…N6, décembre D1…D6 → octobre = 2 d'octobre + N1, N2 ; novembre = N3…N6 ; décembre = D1…D6 ; un seul dépassement `2026-12 TOTAL 6/4 plus-de-place`.
  - `exemple D : maximum par type` — `{ maxTotal: null, maxByType: { ARMATURES: 2 } }` ; avril 4 armatures (`groupKey` vide) et 3 coffrages (`groupKey` `"z||1"`, `"z||2"`, `"z||3"`, sans armature) → les 2 armatures les plus tôt en mars, les coffrages en avril.
  - `exemple E : général et par type` — `{ maxTotal: 4, maxByType: { COFFRAGE: 2 } }` ; avril 3 coffrages + 3 armatures (sans groupe) → avril : 4 tâches dont ≤ 2 coffrages ; mars : 2 ; `movedCount === 2`.
  - `exemple F : réalisées immobiles mais comptées` — max 4 ; avril 3 réalisées + 3 mobiles → les 2 mobiles les plus tôt en mars, les réalisées inchangées et `frozen: true`.
  - `exemple G : mois en cours` — today `2027-04-03`, max 4 ; avril 6 → rien ne bouge ; `[{ month: "2027-04", series: "TOTAL", count: 6, max: 4, reason: "mois-en-cours" }]`.
  - `exemple H : ordre conservé, file unique sous maximum général` — today `2027-01-10`, `{ maxTotal: 2 }` ; F1 `2027-02-10`, M1 `2027-03-05`, M2 `2027-03-20`, A1 `2027-04-05`, A2 `2027-04-15`, A3 `2027-04-25` → février F1, M1 ; mars M2, A1 ; avril A2, A3.
  - `exemple H bis : file par type quand un maximum par type existe` — mêmes tâches (M1, M2 en NDC ; A1…A3 en ARMATURES sans groupe), `{ maxTotal: 2, maxByType: { ARMATURES: 5 } }` → A1 en février, M1 et M2 en mars.
  - `jour 31 vers un mois de 30 jours` — today `2027-01-05`, `{ maxTotal: 1 }` ; X `2027-05-31`, Y `2027-06-10`, Z `2027-06-20` → X `2027-04-30`, Y `2027-05-10`, Z `2027-06-20`.
  - `avancée dans le mois courant à une date passée → aujourd'hui` — today `2027-03-20`, `{ maxTotal: 1 }` ; P `2027-04-05`, Q `2027-04-25` → P `2027-03-20`, Q inchangée.
  - `mois passé jamais touché ni signalé` — today `2027-01-10`, `{ maxTotal: 1 }` ; 3 tâches en `2026-12` → inchangées, `frozen: true`, aucun dépassement en `2026-12`.
  - `sans maximum : inactif` — `{ maxTotal: null, maxByType: {} }` → `active: false`, `smoothedIso === dueIso` partout, `movedCount: 0`, `overflows: []`.
  - `déterministe` — deux appels sur les données de l'exemple A donnent des résultats `deepStrictEqual`.
  - `raison « taches-realisees »` — max 2 ; mai : 3 tâches réalisées → `2027-05 TOTAL 3/2 taches-realisees`.
  - `findSmoothingViolations` renvoie `[]` sur chacun des cas ci-dessus, et une liste non vide sur un résultat trafiqué où une tâche a un `smoothedIso` postérieur à son `dueIso`.

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/taskSmoothing.test.mjs`
  Expected : FAIL (module introuvable).

- [ ] **Step 3 : implémenter `smoothTasks`.** Mois courant `C = monthKeyOf(todayIso)`. Tâche **figée** si `realized` ou `monthKeyOf(dueIso) < C`. Algorithme (non imposé par les tests seuls) :
  1. **Placement (passe montante).** Pour chaque mois `m` de `C` au dernier mois portant une tâche : tant qu'une série du mois dépasse son maximum (`TOTAL` ou un type), prendre la tâche **mobile la plus tôt** du mois qui fait partie d'une série en dépassement et pas encore essayée ; chercher le mois **le plus tardif** `k` dans `[C, m-1]` où elle tient (compte de son type < maximum du type s'il existe, et total < maximum général s'il existe) ; si trouvé, la déplacer (mettre à jour les comptes), sinon elle reste (essayée). Les mois avant `C` ne sont jamais ni source ni cible.
  2. **Remise en ordre.** Files : **une file unique** (toutes les tâches mobiles) si aucun maximum par type n'est défini, sinon **une file par type**. Dans chaque file, trier les tâches mobiles par (`dueIso`, `id2` numérique, `rowId`) et leur réattribuer, dans cet ordre, la liste triée des mois obtenus à l'étape 1 (la i-ème tâche prend le i-ème mois). Les comptes par mois et par type sont inchangés.
  3. **Garde-fou.** Si `findSmoothingViolations` signale une violation après l'étape 2, revenir aux mois de l'étape 1 pour la file concernée.
  4. **Dates.** Tâche non avancée : `smoothedIso = dueIso`. Tâche avancée de `n` mois : `shiftIsoByMonths(dueIso, -n)`, puis `max(·, todayIso)` si le mois d'arrivée est `C`.
  5. **Dépassements.** Pour chaque mois `≥ C` et chaque série ayant un maximum : si compte > maximum, une entrée `Overflow` ; raison, dans cet ordre : `taches-realisees` si les figées seules dépassent ; `mois-en-cours` si le mois est `C` ; `coffrage-sans-place` (Task 3) ; sinon `plus-de-place`.
  `findSmoothingViolations` vérifie §4.2 : jamais plus tard (`smoothedIso <= dueIso`), une tâche avancée ne l'est jamais avant `C` ni avant `todayIso`, les figées sont intactes, et pour chaque tâche avancée, dans son mois d'arrivée, compte de son type ≤ maximum du type et total ≤ maximum général (règle 5) ; règle 4 ajoutée en Task 3.

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/taskSmoothing.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status`.

---

### Task 3 : armature et coffrage (le coffrage avance avec l'armature) + fuzz

**Files :**
- Modify : `planning-synchro/assets/js/top/taskSmoothing.js`
- Modify : `planning-synchro/tests/taskSmoothing.test.mjs`
- Create : `planning-synchro/tests/taskSmoothingFuzz.test.mjs`

**Interfaces :**
- Consumes : Task 2.
- Produces : même API ; `SmoothedTask.pulledFor` renseigné ; raison `coffrage-sans-place` ; `findSmoothingViolations` couvre la règle 4.

- [ ] **Step 1 : écrire les tests qui échouent** (dans `taskSmoothing.test.mjs`) :
  - `exemple I : coffrage entraîné` — today `2027-01-10`, `{ maxByType: { ARMATURES: 2 } }` ; C COFFRAGE `groupKey "a||1"` `2027-04-02`, A1…A4 ARMATURES `"a||1"` `2027-04-10`, `04-15`, `04-20`, `04-25` → mars : C (`2027-03-02`, `pulledFor: "<id2 de A1>"`), A1 (`2027-03-10`), A2 (`2027-03-15`) ; avril : A3, A4 ; `movedCount === 3`.
  - `exemple J : coffrage sans place` — today `2027-03-05`, `{ maxByType: { ARMATURES: 2, COFFRAGE: 1 } }` ; K COFFRAGE `"b||1"` `2027-03-20` ; C COFFRAGE `"a||1"` `2027-04-02` ; A1…A4 `"a||1"` en avril → rien ne bouge ; `[{ month: "2027-04", series: "ARMATURES", count: 4, max: 2, reason: "coffrage-sans-place" }]`.
  - `coffrage dans un mois intermédiaire` — today `2027-01-10`, `{ maxByType: { ARMATURES: 1 } }` ; B ARMATURES `"b||1"` `2027-03-15` ; C COFFRAGE `"a||1"` `2027-03-10` ; A1 `"a||1"` `2027-04-05`, A2 `"a||1"` `2027-04-20` → A1 et C en février ; C `2027-02-10` ; A1 `2027-02-10` (date d'armature relevée à celle du coffrage) ; B et A2 inchangées.
  - `coffrage réalisé : ne contraint plus` — `{ maxByType: { ARMATURES: 2 } }` ; C `"a||1"` `2027-04-02` `realized: true` ; A1…A3 `"a||1"` en avril → A1 en mars, C inchangé, `pulledFor` nul partout.
  - `findSmoothingViolations` signale une armature avancée avant son coffrage non réalisé (résultat trafiqué).

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/taskSmoothing.test.mjs`
  Expected : FAIL sur les nouveaux cas.

- [ ] **Step 3 : implémenter.** Dans l'étape 1 de Task 2, pour une ARMATURE candidate : parcourir `k` de `m-1` à `C` ; si l'armature tient en `k` et que tous les coffrages **non réalisés** de son `groupKey` sont déjà à un mois `≤ k`, la placer ; sinon chercher pour chaque coffrage concerné le mois le plus tardif `k' ≤ k` où il tient (maximum Coffrage et général) ; s'ils en ont tous un, déplacer armature et coffrages (`pulledFor` = `id2` de l'armature) ; sinon arrêter la recherche (un `k` plus petit n'aiderait pas) : l'armature reste, marquée « bloquée par son coffrage » pour la raison `coffrage-sans-place` (séries ARMATURES et TOTAL de ce mois). Les tâches impliquées dans un entraînement (coffrage entraîné et armatures qui l'ont entraîné) sont **exclues** de la remise en ordre de l'étape 2. Dates : traiter les coffrages avant les armatures ; une armature avancée dans le même mois que son coffrage prend `max(sa date, date lissée du coffrage)` ; un coffrage entraîné ne prend jamais une date postérieure à celle de l'armature. `findSmoothingViolations` ajoute la règle 4 : pour toute armature avancée, chaque coffrage non réalisé du même `groupKey` a `smoothedIso <= smoothedIso` de l'armature.

- [ ] **Step 4 : écrire le fuzz** (`taskSmoothingFuzz.test.mjs`) : générateur `mulberry32(seed)`, graines 1 à 2000 ; par cas : today aléatoire entre `2027-01-01` et `2027-04-28` ; 0 à 30 tâches entre `2027-01` et `2027-08` ; types tirés dans `TYPE_ORDER` ; 0 à 4 groupes `"g||n"` formés d'un coffrage puis d'armatures dont l'échéance est ≥ celle du coffrage ; 20 % de tâches réalisées ; `maxTotal` et chaque `maxByType` : `null` (60 %) ou 1 à 4. Assertions : `findSmoothingViolations(...)` vaut `[]` ; deux appels donnent des résultats égaux ; `movedCount` égale le nombre de tâches où `smoothedIso < dueIso`. En cas d'échec, le message donne la graine.

- [ ] **Step 5 : lancer**
  Run : `node --test planning-synchro/tests/taskSmoothing.test.mjs planning-synchro/tests/taskSmoothingFuzz.test.mjs`
  Expected : PASS.

- [ ] **Step 6 : constater** — `git status`.

---

### Task 4 : réglages `Projets2.Lissage` (lecture, écriture)

**Files :**
- Create : `planning-synchro/assets/js/top/smoothingSettings.js`
- Modify : `planning-synchro/assets/js/config.js` (CRLF) — `columns.projects.lissage: "Lissage"`
- Modify : `planning-synchro/assets/js/services/gristService.js` (CRLF)
- Test : `planning-synchro/tests/smoothingSettings.test.mjs`, `planning-synchro/tests/gristService.test.mjs` (ajouts)

**Interfaces :**
- Consumes : `TYPE_ORDER` (Task 1) ; `applyActions`, `fetchTableRows` (`services/gristService.js`).
- Produces :
  - `getServiceSettings(rawCell: unknown, service: string) -> { maxTotal: number|null, maxByType: Record<string, number> }`
  - `hasAnyMax(settings) -> boolean`
  - `serializeSmoothingCell(rawCell: unknown, service: string, settings) -> string` (`""` quand plus aucun service)
  - `parseMaxInput(text: string) -> { ok: true, value: number|null } | { ok: false, message: "Entrez un nombre entier supérieur ou égal à 1, ou laissez vide." }`
  - `gristService.fetchProjectRow(projectId: number) -> Promise<object|null>` (relit `Projets2`, renvoie la ligne d'`id` égal ou `null`)
  - `gristService.updateProjectSmoothing(projectId: number, value: string) -> Promise<void>` (une seule `["UpdateRecord", "Projets2", projectId, { Lissage: value }]` ; lève `"Projet invalide : id manquant."` si l'id n'est pas un entier > 0)

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `getServiceSettings` : cellule `""`, `null`, `undefined` → `{ maxTotal: null, maxByType: {} }` ; JSON valide → entrée du service demandé, autres services ignorés ; `"abc"` (JSON cassé) → vide + un `console.warn` (espion) ; valeurs `0`, `2.5`, `-1` et la chaîne `"3"` → ignorées (seuls les nombres entiers ≥ 1 sont gardés) ; clé de type inconnue ignorée.
  - `serializeSmoothingCell` : ajoute ou remplace l'entrée du service et **conserve** celle d'un autre service ; `version: 1` ; réglage sans aucun maximum → retire l'entrée du service ; plus aucun service → `""` ; cellule d'entrée illisible → nouvelle cellule propre.
  - `parseMaxInput` : `""` et `"  "` → `{ ok: true, value: null }` ; `"3"` → 3 ; `"0"`, `"2,5"`, `"-1"`, `"x"` → `ok: false` avec le message exact.
  - `hasAnyMax` : vrai dès qu'un maximum existe.
  - `gristService.test.mjs` : `updateProjectSmoothing(12, "{…}")` envoie exactement `[["UpdateRecord", "Projets2", 12, { Lissage: "{…}" }]]` ; id invalide → rejet sans appel ; `fetchProjectRow(12)` renvoie la bonne ligne, `null` si absente (même faux `grist` que les tests existants du fichier).

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/smoothingSettings.test.mjs planning-synchro/tests/gristService.test.mjs`
  Expected : FAIL sur les nouveaux cas.

- [ ] **Step 3 : implémenter** les trois fichiers ; contrôler le CRLF de `config.js` et `gristService.js`.

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/smoothingSettings.test.mjs planning-synchro/tests/gristService.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status` + contrôle CRLF.

---

### Task 5 : graphique nourri par les tâches, trois modes, clic sur un seau

**Files :**
- Modify : `planning-synchro/assets/js/top/planningChart.js` (CRLF)
- Modify : `planning-synchro/tests/planningChart.test.mjs`

**Interfaces :**
- Consumes : `ChartTask` / `SmoothedTask` (Tasks 1-2), `TYPE_ORDER`, `TYPE_META`, `TOTAL_META` (Task 1, qui remplacent les constantes locales).
- Produces :
  - `buildTaskLoadSeries(tasks, viewport, { granularity = "month", dateKey = "dueIso" } = {})` → même forme qu'aujourd'hui ; chaque point gagne `endTs` (début du seau suivant) ; le réalisé compte `task.realized`.
  - `findBucketIndexAt(points, ts) -> number|null` (seau `[startTs, endTs)`).
  - `buildDatasetSpecs({ rawSeries, smoothedSeries, mode }) -> Array<{ label, baseLabel, color, kind: "main"|"before"|"realized", values: number[] }>`
  - `createPlanningChart(canvasEl, filterEl, granularityEl, legendEl, { initialUiState = null, onBucketClick = null } = {})` → `{ render({ chartInput, viewport }), setChartInput(chartInput), setViewport, setHeight, getUiState(), destroy }` avec `chartInput = { tasks: SmoothedTask[]|ChartTask[], mode: "raw"|"smoothed"|"both", active: boolean }`, `getUiState() -> { visibleLabels: string[]|null, granularity: "month"|"week" }`, et `onBucketClick({ startIso, endIso, label, granularity, visibleTypeKeys: string[] })`.

- [ ] **Step 1 : réécrire et compléter les tests** (`planningChart.test.mjs`) : les jeux de lignes deviennent des `ChartTask` construits à la main (mêmes échéances, `realized` explicite). Garder les tests existants (comptes par mois, total = somme des types, semaines, `getChartWindowBounds`) et ajouter :
  - `dateKey "smoothedIso"` : une tâche avancée est comptée dans son mois lissé.
  - `findBucketIndexAt` : un timestamp du 31 mars tombe dans mars ; hors fenêtre → `null`.
  - `buildDatasetSpecs` : mode `raw` → par type un `main` (non lissé) et un `realized` ; `smoothed` → `main` calculé sur le lissé et un `realized` ; `both` → `main` (lissé), `before` (non lissé) et **un seul** `realized` par série.
  - `filtre conservé` : `createPlanningChart(..., { initialUiState: { visibleLabels: ["Coffrage"], granularity: "week" } })` puis `render` → seules les cases Coffrage cochées et regroupement semaine (faux DOM minimal du fichier, `globalThis.Chart` bouchonné).
  - `un glisser n'ouvre pas la liste` : `pointerdown` à x=100, `pointerup` à x=140, puis `click` → `onBucketClick` non appelé ; `pointerdown`/`pointerup` au même point puis `click` → appelé une fois avec le seau sous le pointeur.

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/planningChart.test.mjs`
  Expected : FAIL.

- [ ] **Step 3 : implémenter.** Styles : `main` = trait plein (largeur 2, Total 3) ; `before` = même couleur à 35 % d'opacité, largeur 1,5, sans pointillé ; `realized` = pointillé `[3, 3]` comme aujourd'hui. Légende de gauche : note selon le mode — `raw` : « pointillé = réalisé » ; `smoothed` : « lissé · pointillé = réalisé » ; `both` : « plein = lissé · pâle = avant lissage · pointillé = réalisé ». Clic : `options.onClick` de Chart.js → `chart.scales.x.getValueForPixel(event.x)` → `findBucketIndexAt` ; ignoré si le pointeur a parcouru plus de 4 px entre `pointerdown` et `pointerup` sur le canevas. `render` reconstruit les cases à cocher en gardant `visibleLabels` (les types nouveaux arrivent cochés). Pas de ligne horizontale de maximum dans cette version.

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/planningChart.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status` + contrôle CRLF.

---

### Task 6 : fenêtre « Tâches du mois »

**Files :**
- Create : `planning-synchro/assets/js/top/monthTasksModal.js`
- Modify : `planning-synchro/index.html` (CRLF) — bloc `#ps-month-tasks-modal`
- Modify : `planning-synchro/assets/css/styles.css` (CRLF)
- Test : `planning-synchro/tests/monthTasksModal.test.mjs`

**Interfaces :**
- Consumes : `SmoothingResult` (Tasks 2-3), `TYPE_ORDER`, `TYPE_META`, `formatMonthLabel`, `formatDateFr` (Task 1).
- Produces :
  - `buildBucketTaskList({ result, mode, bucket: { startIso, endIso, label }, visibleTypeKeys: string[], settings }) -> { title, modeLabel, banner: string|null, flat: boolean, sections: Array<{ type, label, color, countLabel, warning: string|null, items: Array<{ rowId, dateLabel, id2, name, place, realized, movedFrom: string|null, pulledFor: string|null }> }>, departed: Array<{ id2, name, toMonthLabel }>, empty: boolean }`
  - `createMonthTasksModal(rootEl) -> { open(model), update(model), close(), isOpen(), destroy() }`

- [ ] **Step 1 : écrire les tests qui échouent** (pur + faux DOM du style de `chargeAssignModalDom.test.mjs`) :
  - mode `raw` : tâches dont `dueIso` ∈ `[startIso, endIso)` ; mode `smoothed` : sur `smoothedIso` ; mode `both` : comme `smoothed` + `departed` (échéance d'origine dans le seau, avancées ailleurs, avec `toMonthLabel` « mars 2027 »).
  - filtre : `visibleTypeKeys: ["ARMATURES"]` → une seule section ; vide (seul Total coché) → tous les types ; plusieurs → une section par type dans `TYPE_ORDER`, `flat: false`.
  - tri par date puis `id2` ; `movedFrom` = « mai 2027 (12/05/2027) » pour une tâche avancée ; `pulledFor` = « N° 145 » pour un coffrage entraîné ; `place` = « Zone A · Groupe 3 ».
  - `countLabel` « 3 » sans lissage, « 3 / 2 » quand un maximum existe ; `warning` « Dépassement : 3 / 2 — coffrage sans place » si `result.overflows` contient ce mois et ce type (seau mensuel seulement) ; dépassement `TOTAL` → `banner`.
  - seau vide → `empty: true` et le texte « Aucune tâche à réaliser sur cette période. » rendu.
  - DOM : `open` affiche (`style.display = "flex"`), Échap et « Fermer » ferment, `update` remplace le contenu sans fermer, le texte des tâches est échappé.

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/monthTasksModal.test.mjs`
  Expected : FAIL.

- [ ] **Step 3 : implémenter** le module, la structure HTML (même charpente `ps-modal` / `ps-modal-header` / `ps-modal-close-btn` que `#ps-charge-assign-modal`, corps défilant) et le CSS (sections à pastille de couleur du type, ligne compacte, mentions secondaires en `--color-text-muted`, avertissement en ton orangé déjà présent dans la feuille). Lecture seule : aucun bouton d'écriture.

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/monthTasksModal.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status` + contrôle CRLF de `index.html` et `styles.css`.

---

### Task 7 : fenêtre « Lissage des tâches »

**Files :**
- Create : `planning-synchro/assets/js/top/smoothingModal.js`
- Modify : `planning-synchro/index.html` (CRLF) — bloc `#ps-smoothing-modal`
- Modify : `planning-synchro/assets/css/styles.css` (CRLF)
- Test : `planning-synchro/tests/smoothingModal.test.mjs`

**Interfaces :**
- Consumes : `smoothTasks` (Tasks 2-3), `parseMaxInput`, `hasAnyMax` (Task 4), `TYPE_META`, `formatMonthLabel` (Task 1).
- Produces :
  - `computeTypePeaks(tasks: ChartTask[], todayIso) -> Record<type, { count: number, monthKey: string }>` (mois ≥ mois courant, échéances d'origine)
  - `buildPreviewRows(result: SmoothingResult, todayIso) -> Array<{ monthKey, label, before: number, after: number, overflow: boolean }>` (mois qui changent ou restent en dépassement, du mois courant au dernier concerné)
  - `createSmoothingModal(rootEl, { compute: (settings) => SmoothingResult, onSubmit: (settings) => Promise<{ ok: boolean, error?: string }>, onDelete: () => Promise<{ ok: boolean, error?: string }>, debounceMs = 150 })` → `{ open(context), refresh({ tasks, todayIso }), close(), isOpen(), destroy() }` avec `context = { title, typesPresent: string[], tasks: ChartTask[], todayIso, settings, saved: boolean, readOnly: boolean }`

- [ ] **Step 1 : écrire les tests qui échouent** :
  - `computeTypePeaks` : pic et mois par type, mois passés ignorés.
  - `buildPreviewRows` : sur l'exemple A → lignes `février 2027 0→2`, `mars 2027 2→4`, `avril 2027 8→4`.
  - DOM : `open` remplit le champ général et une ligne par type présent (ordre `TYPE_ORDER`) avec « pic actuel 5 (avril 2027) » ; une saisie relance `compute` après le délai (horloge simulée ou `debounceMs: 0`) et l'aperçu affiche « 6 tâches avancées · aucune tâche retardée » et les dépassements restants avec leur raison en clair (`mois en cours`, `tâches réalisées`, `plus de place avant`, `coffrage sans place`) ; une saisie invalide marque le champ (`aria-invalid="true"`), affiche le message de `parseMaxInput` et désactive « Enregistrer » ; « Enregistrer » appelle `onSubmit` avec `{ maxTotal, maxByType }` et ferme sur `{ ok: true }`, garde la saisie et affiche l'erreur sur `{ ok: false }` ; « Supprimer le lissage » visible seulement si `saved`, demande `window.confirm` et appelle `onDelete` ; `readOnly` → champs désactivés, « Enregistrer » et « Supprimer » masqués, note « Lecture seule : le service affiché n'est pas votre service de rattachement. » ; `refresh` après une saisie garde les valeurs tapées et recalcule l'aperçu ; Échap, « Fermer » et « Annuler » ferment sans rien enregistrer.

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/smoothingModal.test.mjs`
  Expected : FAIL.

- [ ] **Step 3 : implémenter** le module, la structure HTML (§6.2 : titre, phrase d'explication, « Maximum général (tous types) », lignes par type avec pastille, colonne « pic actuel », zone « Aperçu », pied « Supprimer le lissage » à gauche, « Annuler » et « Enregistrer » à droite) et le CSS (largeur `min(720px, calc(100vw - 32px))`, champs numériques étroits, tableau d'aperçu compact). Utiliser la skill `frontend-design` pour la mise en page fine, dans le style existant du widget.

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/smoothingModal.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status` + contrôle CRLF.

---

### Task 8 : contrôleur du lissage, en-tête du graphique, mémoire du mode

**Files :**
- Create : `planning-synchro/assets/js/top/smoothingController.js`
- Modify : `planning-synchro/assets/js/state.js` (CRLF), `planning-synchro/assets/js/config.js` (CRLF) — `smoothingViewStorageKey: "planning-synchro.smoothing-view"`
- Modify : `planning-synchro/index.html` (CRLF), `planning-synchro/assets/css/styles.css` (CRLF)
- Test : `planning-synchro/tests/smoothingController.test.mjs`

**Interfaces :**
- Consumes : Tasks 1 à 7.
- Produces :
  - `state.js` : `loadSmoothingView() -> "raw"|"smoothed"|"both"` (défaut `"both"`, valeur inconnue → défaut), `persistSmoothingView(mode)`.
  - `createSmoothingController({ els: { displayGroup, openButton, smoothingModalEl, monthTasksModalEl }, saveCell: (projectId, value) => Promise<void>, getService: () => string, isReadOnly: () => boolean, todayIso: () => string, onChange: () => void, createSmoothingModal?, createMonthTasksModal? })` → `{ setProjectData({ contextKey, project, tasks, projectRow }), getChartInput(), openMonthTasks(bucketInfo), refreshFromProjectRows(rows) -> boolean, clear(), destroy() }`.
  - En-tête (index.html, dans `.ps-planning-header`, après `#ps-chart-granularity`) : `#ps-chart-smoothing` contenant `#ps-chart-display` (« Afficher : » + boutons `data-smoothing-view="raw|smoothed|both"` libellés « Non lissé », « Lissé », « Les deux », styles `ps-chart-gran-btn`) et le bouton `#ps-smoothing-open` « Lisser… ».

- [ ] **Step 1 : écrire les tests qui échouent** (fenêtres injectées par des espions) :
  - `setProjectData` sans colonne (`projectRow` sans propriété `Lissage`) → bouton désactivé avec `title` « Ajoutez une colonne texte « Lissage » dans Projets2 pour activer le lissage. », `getChartInput().active === false`, aucune exception.
  - aucune tâche → bouton désactivé, `title` « Aucune tâche à lisser ».
  - cellule valide pour le service → `active: true`, `#ps-chart-display` visible, bouton marqué `is-active`, mode = `loadSmoothingView()`.
  - même `contextKey` deux fois de suite → fenêtres non fermées, `refresh` / `update` appelés ; `contextKey` différent → `close` appelé sur les deux.
  - enregistrement réussi → `saveCell(projectId, <JSON de serializeSmoothingCell>)`, puis mode `both` mémorisé, `onChange` appelé, cellule en mémoire mise à jour ; échec → `{ ok: false, error: "L'enregistrement du lissage a échoué. Réessayez." }`, rien de changé.
  - suppression → `saveCell` avec la cellule sans l'entrée du service (`""` s'il n'en reste aucune).
  - `refreshFromProjectRows` : même `Lissage` → `false`, pas d'`onChange` ; valeur différente → `true` et `onChange`.
  - `isReadOnly() === true` → la fenêtre s'ouvre avec `readOnly: true`.
  - clic sur « Lissé » → `persistSmoothingView("smoothed")` et `onChange`.

- [ ] **Step 2 : lancer et constater l'échec**
  Run : `node --test planning-synchro/tests/smoothingController.test.mjs`
  Expected : FAIL.

- [ ] **Step 3 : implémenter** le contrôleur (il tient tâches, réglages, résultat et mode ; recalcule `smoothTasks(tasks, settings, todayIso())` à chaque `setProjectData`, enregistrement ou `refreshFromProjectRows`), la mémoire du mode dans `state.js`, l'en-tête et son CSS (le groupe « Afficher » n'est visible que si un lissage est actif ; le bouton « Lisser… » porte une pastille « actif »).

- [ ] **Step 4 : relancer**
  Run : `node --test planning-synchro/tests/smoothingController.test.mjs`
  Expected : PASS.

- [ ] **Step 5 : constater** — `git status` + contrôle CRLF.

---

### Task 9 : branchement dans `main.js`, documentation, vérifications finales

**Files :**
- Modify : `planning-synchro/assets/js/main.js` (CRLF)
- Modify : `planning-synchro/tests/postWriteRefresh.test.mjs` (environnement `vm` seulement)
- Modify : `planning-synchro/dev/fixtures.js` (une valeur `Lissage` sur un projet de démonstration)
- Modify : `planning-synchro/README.md` (CRLF)

**Interfaces :**
- Consumes : tout ce qui précède ; `window.GristServiceContext.getService()` et `.isReadOnly()`.
- Produces : le widget complet.

- [ ] **Step 1 : brancher.**
  - `bootstrapApp` : récupérer les nouveaux éléments ; créer **une fois** le contrôleur (`saveCell` = `updateProjectSmoothing`, `getService`, `isReadOnly`, `todayIso` = `todayIsoDate`, `onChange` = redessiner le graphique s'il est affiché).
  - `loadProject` : lire `fetchProjectRow(project.id)` en même temps que `fetchProjectData` ; `tasks = buildChartTasks(planningRows, { project: project.name, targetLookup: getRealisationTargetLookup() })` ; `contextKey = selectionKeyFor(project) + "|" + service`. Si `contextKey` est celui du chargement précédent : conserver `topView` et passer `planningChart.getUiState()` (pris **avant** `teardown()`) en `initialUiState` ; sinon `topView = "planning"` comme aujourd'hui. Appeler `smoothing.setProjectData(...)`. Créer le graphique avec `onBucketClick: (b) => smoothing.openMonthTasks(b)`. Projet vide → `smoothing.clear()`.
  - `applyTopView` : rendre avec `planningChart.render({ chartInput: smoothing.getChartInput(), viewport })` ; afficher `#ps-chart-smoothing` seulement en vue Graphique.
  - `projectCatalogHasChanged` : après la relecture de `Projets2` déjà faite, appeler `smoothing.refreshFromProjectRows(projectRows)`.
  - Supprimer l'usage de `chartRows` / `chartColumns` par le graphique (les tâches les remplacent) ; `updateViewSwitchVisibility` teste désormais la présence de tâches.
- [ ] **Step 2 : garder `postWriteRefresh.test.mjs` vert** : ajouter à son environnement `vm` les nouveaux identifiants utilisés par `loadProject` (contrôleur bouchonné aux méthodes vides, `buildChartTasks` réel, `fetchProjectRow` bouchonné) **sans toucher à ses assertions**.
  Run : `node --test planning-synchro/tests/postWriteRefresh.test.mjs`
  Expected : PASS.
- [ ] **Step 3 : documenter** — `README.md` : nouvelle section « Lissage » (règles §4.2, réglages et colonne `Projets2.Lissage`, modes, fenêtre du mois, pas de mise à jour en direct chez les collègues) ; corriger la section « Vue Graphique » (elle ne dépend plus de « Rassembler » ; échéance et réalisé lus comme la barre dessinée).
- [ ] **Step 4 : tous les tests**
  Run : `node --test planning-synchro/tests/*.test.mjs` puis `node --test shared/tests/*.test.*`
  Expected : 0 échec (368 + nouveaux ; 175).
- [ ] **Step 5 : contrôle visuel** — servir la racine du dépôt (`python -m http.server 8791`), ouvrir `planning-synchro/dev/harness.html` en Chrome sans fenêtre (`--headless=new --screenshot`, chemins via `cygpath -m`), sur le projet de démonstration qui porte un `Lissage` : captures de la vue Graphique en « Les deux », de la fenêtre « Lissage » et de la fenêtre « Tâches du mois » ; vérifier lisibilité, alignement du tracé avec la frise, absence d'erreur console (`--enable-logging=stderr`).
- [ ] **Step 6 : constater** — `git status`, contrôle CRLF de tous les fichiers existants modifiés ; ne rien committer.
