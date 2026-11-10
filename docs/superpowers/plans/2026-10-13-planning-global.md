# Vue « Global » (planning Synthèse + Structure fusionné, lecture seule) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bouton « Global » du bandeau de Planning Projet affiche, à la place du planning du service, le planning Synthèse et le planning Structure du projet dans un même tableau avec un même Gantt, en lecture seule : niveaux liés (étage ⇄ coffrage), armatures sous leur coffrage, et les retards de la Synthèse par rapport à Structure signalés par une date qui clignote en rouge.

**Architecture:** Deux modules purs — `globalChecks.js` (contrôles, états, compteurs) et `globalPlanningModel.js` (fusion des deux plannings en un arbre, puis lignes affichées) — réutilisent le calcul des dates du planning Structure (`buildTimelineDataFromPlanningRows`) et le modèle de la vue Synthese (`buildSections`, `buildRowModel`, `buildStructureLink`, `controlTaskEndLimits`). Un tableau DOM en lecture seule (`globalPlanningTable.js`) reprend la mise en page `.stt` et le Gantt SVG existant, auquel trois ajouts sans effet sur la vue Synthese donnent les barres de documents. Un contrôleur à dépendances injectées (`globalPlanningController.js`) lit les deux tables par `fetchProjectRows` et ne connaît aucune écriture ; `main.js` le branche sur un bouton, mémorisé dans `state.js`.

**Tech Stack:** JavaScript ES modules sans dépendance, widgets Grist, SVG, tests `node:test` (Node 25).

**Spec:** `docs/superpowers/specs/2026-10-13-planning-global-design.md`

## Global Constraints

- **Aucun commit, aucun push.** L'utilisateur teste sur localhost et commite lui-même : chaque tâche finit par un point de contrôle (tests verts), jamais par `git commit`.
- **La vue n'écrit jamais dans Grist** : aucun `applyUserActions`, aucun `docApi` dans les fichiers `global*`.
- Textes de l'interface en français, **mot pour mot** comme dans ce plan (« Global », « Alertes seulement », « Actualiser », messages, états).
- Aucune colonne à créer dans Grist. Tables lues : `Planning_Projet` et `ListePlan_NDC_COF`, par `GristServiceContext.fetchProjectRows` (projet courant, tous services).
- Non modifiés : `shared/`, `ui/syntheseTaskTable.js`, `ui/syntheseTasksController.js`, `ui/timeline.js`, `ui/selectors.js`, les autres widgets. Dans `syntheseGanttGeometry.js` et `syntheseGantt.js`, seuls les ajouts de la tâche 4 : la vue Synthese doit dessiner comme avant.
- Le dépôt contient du travail non commité (tâche contrôlée `Controle_Coffrage`) dans `structureLinkModel.js`, `syntheseTaskModel.js`, `syntheseTaskTable.js`, `syntheseTasksController.js` et leurs tests : ne pas y toucher, ne rien « nettoyer ».
- Retards en **jours calendaires**. Dates affichées avec `formatDate` de `syntheseTaskModel.js` (« Mer 19/08/26 »).
- N'écrivez jamais de séquence `\uXXXX` dans un fichier avec Write/Edit : elle devient un caractère brut. Tapez les caractères directement (« ⇄ », « ▸ », « ▾ », « · », « ✓ », « … ») ; pour retirer les accents : `.normalize("NFD").replace(/\p{M}/gu, "")`.
- `Planning Projet/assets/js/state.js` est en fins de ligne **CRLF** ; tous les autres fichiers touchés sont en LF. Ne pas utiliser `sed -i`. Après modification de `state.js`, vérifier que le nombre de retours chariot égale le nombre de lignes (commande à la tâche 7).
- Tests de Planning Projet : depuis `Planning Projet/`, `node --test tests/*.test.mjs` — **443 tests verts au départ**. Les modules qui importent `planningService.js` exigent `globalThis.window = { location: { search: "" } }` avant un `await import(...)` (voir `tests/formworkStarts.test.mjs`).
- Les sous-modules n'ont pas de `?v=` : seuls `index.html` et ses cinq versions changent (tâche 7).

## Review Focus

1. **Dates lues en secondes Grist** (l'API REST renvoie les colonnes Date en secondes depuis 1970, pas en texte) : mêmes dates, mêmes retards. Test : tâche 2.
2. **Même zone écrite différemment par les deux services** (« ZONE 2 / bat b » et « Zone 2 / BAT B ») : une seule section, l'étage rejoint quand même son coffrage. Test : tâche 2.
3. **Projet connu sous deux noms** (lignes écrites sous l'un et sous l'autre) : tous ses documents Structure apparaissent, une seule fois. Test : tâche 2.
4. **Utilisateur en lecture seule sur le service** : le contexte partagé grise les contrôles qui ressemblent à une écriture ; le bouton « Global », les triangles de repli et les deux boutons de la barre doivent rester actifs. Tests : tâches 5 et 7.
5. **Réponse de lecture arrivée trop tard** (projet changé, vue quittée pendant la lecture) : rien de l'ancien projet ne s'affiche. Test : tâche 6.

## Fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `Planning Projet/assets/js/services/globalChecks.js` (nouveau) | Contrôles de cohérence, état de chaque ligne, compteurs. | 1 |
| `Planning Projet/assets/js/services/globalPlanningModel.js` (nouveau) | Documents Structure, fusion en zones et entrées ; puis lignes affichées. | 2, 3 |
| `Planning Projet/tests/helpers/globalRows.mjs` (nouveau) | Jeu d'essai repris de la base de test (ERA QUAI D'ORSAY). | 2 |
| `Planning Projet/assets/js/services/syntheseGanttGeometry.js`, `assets/js/ui/syntheseGantt.js` | Barre de document par type, repère « Démarrage travaux », crochet de niveau, formes en alerte. | 4 |
| `Planning Projet/assets/js/ui/globalPlanningTable.js` (nouveau) | Tableau en lecture seule, colonne « État », barre d'état, séparateur. | 5 |
| `Planning Projet/assets/js/ui/globalPlanningController.js` (nouveau) | Lecture, rafraîchissement, replis, « Alertes seulement », messages. | 6 |
| `Planning Projet/assets/js/main.js`, `assets/js/state.js`, `index.html`, `assets/css/styles.css` | Bouton, bascule de vue, mémorisation, styles, clignotement, versions. | 4 (CSS du Gantt), 7 |

Dépendances entre modules (pas de cycle) : `globalChecks.js` → `syntheseTaskModel.js` ; `globalPlanningModel.js` → `planningService.js`, `syntheseTaskModel.js`, `structureLinkModel.js`, `syntheseTasks.js`, `globalChecks.js` ; `globalPlanningTable.js` → `syntheseTaskModel.js`, `globalChecks.js` ; `globalPlanningController.js` → `globalPlanningModel.js` ; `main.js` → les deux modules `ui/global*`.

Repères du jeu d'essai (`tests/helpers/globalRows.mjs`, aujourd'hui = vendredi 09/10/26) :

- Structure, Zone 2 / BAT B, dans l'ordre du planning Structure : coffrage **3032** (id 113, début 19/08/26, fin 02/09/26, retard 37 j) et son armature 3314 (123, fin 16/09/26, retard 23 j, démarrage travaux 14/10/26) ; coffrage 3012 (111) et son armature 3306 (121) ; coffrage 3022 (112) et son armature 3310 (122) ; coupes 3820 (131) ; armature sans groupe 3724 (142, terminée). Zone 1 / BAT BC : coffrage 3031 (101) et son armature 3216 (102). Sans zone : NDC 3999 (141).
- Synthèse : étages du modèle (`datedRows`), ligne-étage à `firstId`, tâche de rang *n* du modèle à `firstId + 1 + n`. Zone 1 : SS1 (200) lié à 3031. Zone 2 : SS1 (300) lié à 3022 ; **RDC (400) lié à 3032**, dont CYCLE 3 = 416, PLAN SYT CYCLE 3 = 419, la tâche contrôlée choisie « PLAN DE SYNTHESE RESEAUX NIV RDC » = **420** (fin 30/11/26 → retard **103 j**), DEMARRAGE GO = 425 ; R+1 (500) non lié ; « Réunion de lancement » (600) hors étage.
- Clés de ligne : `zone:zone1batbc`, `zone:zone2batb`, `zone:` (« Sans zone »), `level:113`, `floor:zone2batb/rdc`, `floor:zone2batb/rp1` (R+1), `group:416`, `task:420`, `doc:113`.

---

### Task 1: Contrôles de cohérence et états (`globalChecks.js`)

**Files:**
- Create: `Planning Projet/assets/js/services/globalChecks.js`
- Test: `Planning Projet/tests/globalChecks.test.mjs` (nouveau)

**Interfaces:**
- Consumes: `formatDate(date) → "Mer 19/08/26"` de `services/syntheseTaskModel.js`.
- Produces (tous exportés) :
  - `daysBetween(from: Date, to: Date) → number` — jours calendaires, négatif si `to` est avant.
  - `emptyCounts() → { synthese, missing, stale, structure }` ; `addCounts(target, source) → target` ; `hasAlerts(counts) → boolean` ; `countAlerts(alerts) → counts`.
  - `checkDocument(doc, today) → { alert, part, title }` — `doc` : `{ realise, end, storedRetard, remarque }`.
  - `checkFloor({ tasks, link, controls, limits, worksStart }) → { linked, alerts, taskAlerts, unverifiable, passed }` — `taskAlerts` : `Map<id de tâche, alerte[]>`.
  - `floorAlerts(check) → alerte[]`.
  - `taskState(alerts)`, `summaryState(counts)`, `floorState({ check, link, counts, otherZoneLabel })`, `levelState({ checks, counts })`, `formworkState({ own, lateRebars })` → `{ parts: [{ text, tone, blink }], title } | null`.
  - `describeCounts(totals) → string`.
  - Une alerte : `{ code: "late" | "goLate" | "stale" | "missing" | "docLate", family: "synthese" | "stale" | "missing" | "structure", tone, blink, days, text, title }`. Tons d'une part : `late` (rouge clignotant), `error`, `warn`, `ok`, `muted`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/globalChecks.test.mjs` :

```js
// Contrôles de cohérence de la vue Global : retards de la Synthèse par rapport à Structure,
// fond de plan à mettre à jour, coffrage introuvable, retard des documents Structure.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addCounts,
  checkDocument,
  checkFloor,
  countAlerts,
  daysBetween,
  describeCounts,
  emptyCounts,
  floorAlerts,
  floorState,
  formworkState,
  hasAlerts,
  levelState,
  summaryState,
  taskState,
} from "../assets/js/services/globalChecks.js";

const day = (year, month, date) => new Date(year, month - 1, date);
const TODAY = day(2026, 10, 9);

// Étage RDC lié au coffrage 3032, dont le plan commence le mercredi 19/08/26.
const LIMIT = day(2026, 8, 19);
const linked = (state = "current", extra = {}) => ({
  state,
  formworkNumber: "3032",
  formwork: { number: "3032", issueDate: day(2025, 11, 27) },
  ...extra,
});
const controlTask = (end) => ({ id: 1, name: "PLAN DE SYNTHESE RESEAUX NIV RDC", natureKey: "", start: day(2026, 2, 13), end });
const kickoff = (start) => ({ id: 9, name: "DEMARRAGE GO RDC", natureKey: "demarrage", start, end: start });
const controls = new Map([[1, { chosen: true }]]);
const limits = new Map([[1, { limit: LIMIT, formworkNumber: "3032" }]]);
const texts = (state) => state.parts.map((part) => part.text);

test("jours calendaires entre deux dates, changement d'heure compris", () => {
  assert.equal(daysBetween(LIMIT, day(2026, 11, 30)), 103);
  assert.equal(daysBetween(day(2026, 10, 24), day(2026, 10, 26)), 2, "nuit du passage à l'heure d'hiver");
  assert.equal(daysBetween(day(2026, 3, 28), day(2026, 3, 30)), 2, "nuit du passage à l'heure d'été");
  assert.equal(daysBetween(day(2026, 8, 20), LIMIT), -1);
  assert.equal(daysBetween(null, LIMIT), 0);
});

test("document Structure non terminé : retard compté depuis sa Fin jusqu'à aujourd'hui", () => {
  const late = checkDocument({ realise: 67, end: day(2026, 9, 16), storedRetard: 5, remarque: "" }, TODAY);
  assert.deepEqual(late.part, { text: "retard 23 j", tone: "error", blink: false });
  assert.equal(late.alert.family, "structure");
  assert.equal(late.alert.days, 23);
  assert.equal(late.title, "Fin prévue le Mer 16/09/26 : 23 j de retard.");
  assert.equal(checkDocument({ realise: 0, end: TODAY }, TODAY).alert, null, "Fin aujourd'hui : pas de retard");
  assert.equal(checkDocument({ realise: 0, end: day(2026, 12, 1) }, TODAY).part, null);
  assert.equal(checkDocument({ realise: 0, end: null, storedRetard: 12 }, TODAY).part, null, "sans Fin : rien");
});

test("retard justifié : orange, la justification au survol, et il compte toujours", () => {
  const result = checkDocument({ realise: 33, end: day(2026, 9, 16), remarque: " Attente plans archi " }, TODAY);
  assert.deepEqual(result.part, { text: "retard 23 j (justifié)", tone: "warn", blink: false });
  assert.equal(result.title, "Retard justifié : Attente plans archi");
  assert.equal(result.alert.family, "structure");
});

test("document terminé : le retard stocké reste lisible, sans alerte", () => {
  const done = checkDocument({ realise: 100, end: day(2026, 6, 10), storedRetard: 8 }, TODAY);
  assert.deepEqual(done, { alert: null, part: { text: "terminé (retard 8 j)", tone: "muted", blink: false }, title: "" });
  assert.equal(checkDocument({ realise: 100, end: day(2026, 6, 10), storedRetard: 0 }, TODAY).part.text, "terminé");
});

test("étage non lié ou au coffrage introuvable : aucun des trois contrôles", () => {
  const none = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: { state: "none" }, controls, limits });
  assert.deepEqual([none.linked, none.alerts.length, none.taskAlerts.size, none.passed], [false, 0, 0, 0]);
  assert.equal(checkFloor().linked, false);
  const missing = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked("missing", { formwork: null }), controls, limits });
  assert.equal(missing.linked, false);
  assert.deepEqual(missing.alerts.map((alert) => [alert.code, alert.tone, alert.text]), [
    ["missing", "error", "coffrage 3032 introuvable"],
  ]);
  assert.equal(missing.taskAlerts.size, 0);
});

test("tâche contrôlée qui finit après le début du plan de coffrage : retard rouge clignotant", () => {
  const check = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked(), controls, limits, worksStart: null });
  const [alert] = check.taskAlerts.get(1);
  assert.deepEqual([alert.code, alert.family, alert.tone, alert.blink, alert.days, alert.text], [
    "late", "synthese", "late", true, 103, "retard 103 j",
  ]);
  assert.equal(
    alert.title,
    "Fin trop tardive : à finir au plus tard le Mer 19/08/26 (début du plan de coffrage 3032 dans le planning Structure)."
  );
  assert.equal(check.linked, true);
});

test("tâche contrôlée qui finit le jour du début du plan : contrôle passé", () => {
  const check = checkFloor({ tasks: [controlTask(LIMIT)], link: linked(), controls, limits, worksStart: null });
  assert.equal(check.taskAlerts.size, 0);
  assert.equal(check.passed, 2, "tâche contrôlée et fond de plan");
});

test("plusieurs tâches contrôlées : une seule en retard suffit à faire échouer le contrôle", () => {
  const second = { id: 2, name: "VISA Indice A", natureKey: "", start: day(2026, 2, 1), end: day(2026, 3, 1) };
  const check = checkFloor({
    tasks: [controlTask(day(2026, 8, 20)), second],
    link: linked(),
    controls: new Map([[1, {}], [2, {}]]),
    limits: new Map([[1, { limit: LIMIT, formworkNumber: "3032" }], [2, { limit: LIMIT, formworkNumber: "3032" }]]),
  });
  assert.deepEqual([...check.taskAlerts.keys()], [1]);
  assert.equal(check.taskAlerts.get(1)[0].days, 1);
  assert.equal(check.passed, 1, "seul le fond de plan passe");
});

test("tâche contrôlée non vérifiable : aucune, sans Fin, coffrage sans début", () => {
  const reasons = (options) => checkFloor({ link: linked(), worksStart: null, ...options }).unverifiable;
  assert.ok(reasons({ tasks: [] }).includes("pas de tâche contrôlée dans l'étage"));
  assert.ok(reasons({ tasks: [controlTask(null)], controls, limits })
    .includes("la tâche contrôlée « PLAN DE SYNTHESE RESEAUX NIV RDC » n'a pas de date de fin"));
  assert.ok(reasons({ tasks: [controlTask(day(2026, 11, 30))], controls, limits: new Map() })
    .includes("le coffrage 3032 n'a pas de date de début"));
});

test("jalon de démarrage après le démarrage des travaux de Structure : retard rouge clignotant", () => {
  const works = day(2026, 10, 14);
  const late = checkFloor({ tasks: [kickoff(day(2026, 10, 26))], link: linked(), worksStart: works });
  const [alert] = late.taskAlerts.get(9);
  assert.deepEqual([alert.code, alert.family, alert.blink, alert.days, alert.text], ["goLate", "synthese", true, 12, "retard 12 j"]);
  assert.equal(alert.title, "Démarrage prévu après le démarrage des travaux de Structure (Mer 14/10/26).");
  const onTime = checkFloor({ tasks: [kickoff(works)], link: linked(), worksStart: works });
  assert.equal(onTime.taskAlerts.size, 0);
  assert.equal(onTime.passed, 2, "démarrage et fond de plan");
});

test("démarrage non vérifiable : pas de jalon daté, ou pas de démarrage des travaux", () => {
  const noKickoff = checkFloor({ tasks: [kickoff(null)], link: linked(), worksStart: day(2026, 10, 14) });
  assert.ok(noKickoff.unverifiable.includes("pas de jalon de démarrage daté dans l'étage"));
  const noWorks = checkFloor({ tasks: [kickoff(day(2026, 10, 26))], link: linked(), worksStart: null });
  assert.ok(noWorks.unverifiable.includes("aucun démarrage des travaux pour le coffrage 3032"));
  assert.equal(noWorks.taskAlerts.size, 0);
});

test("fond de plan : à mettre à jour, sans fond de plan, sans 0 Prev, à jour", () => {
  const stale = checkFloor({ link: linked("stale") });
  assert.deepEqual(stale.alerts.map((alert) => [alert.code, alert.family, alert.tone, alert.blink, alert.text]), [
    ["stale", "stale", "warn", false, "à mettre à jour : 0 Prev le Jeu 27/11/25"],
  ]);
  assert.ok(checkFloor({ link: linked("noPlan") }).unverifiable.includes("pas de tâche « FOND DE PLAN DE SYNTHESE » dans l'étage"));
  assert.ok(checkFloor({ link: linked("waiting") }).unverifiable.includes("le coffrage 3032 n'a pas de date 0 Prev"));
  const current = checkFloor({ link: linked("current") });
  assert.equal(current.alerts.length, 0);
  assert.equal(current.passed, 1);
});

test("compteurs : par famille, cumulables", () => {
  const check = checkFloor({
    tasks: [controlTask(day(2026, 11, 30)), kickoff(day(2026, 10, 26))],
    link: linked("stale"),
    controls,
    limits,
    worksStart: day(2026, 10, 14),
  });
  const counts = countAlerts(floorAlerts(check));
  assert.deepEqual(counts, { synthese: 2, missing: 0, stale: 1, structure: 0 });
  assert.deepEqual(addCounts(emptyCounts(), counts), counts);
  assert.equal(hasAlerts(counts), true);
  assert.equal(hasAlerts(emptyCounts()), false);
});

test("état d'une tâche en retard : son plus grand retard, les explications au survol", () => {
  assert.equal(taskState([]), null);
  const state = taskState([
    { days: 12, title: "Démarrage tardif." },
    { days: 103, title: "Fin trop tardive." },
  ]);
  assert.deepEqual(state.parts, [{ text: "retard 103 j", tone: "late", blink: true }]);
  assert.equal(state.title, "Démarrage tardif.\nFin trop tardive.");
});

test("résumé d'un contenu : une part par famille, la plus grave d'abord, accordée", () => {
  assert.equal(summaryState(emptyCounts()), null);
  const state = summaryState({ synthese: 1, missing: 2, stale: 1, structure: 3 });
  assert.deepEqual(state.parts, [
    { text: "1 retard Synthèse", tone: "late", blink: true },
    { text: "2 coffrages introuvables", tone: "error", blink: false },
    { text: "1 à mettre à jour", tone: "warn", blink: false },
    { text: "3 retards Structure", tone: "error", blink: false },
  ]);
  assert.deepEqual(texts(summaryState({ synthese: 2, missing: 1, stale: 0, structure: 1 })), [
    "2 retards Synthèse", "1 coffrage introuvable", "1 retard Structure",
  ]);
});

test("état d'un étage : non lié, introuvable, à mettre à jour, retards de son contenu", () => {
  assert.deepEqual(floorState({ link: { state: "none" } }).parts, [
    { text: "non lié à un coffrage", tone: "muted", blink: false },
  ]);
  const missing = checkFloor({ link: linked("missing", { formwork: null }) });
  assert.deepEqual(texts(floorState({ check: missing, link: linked("missing"), counts: emptyCounts() })), ["coffrage 3032 introuvable"]);
  const check = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked("stale"), controls, limits });
  const state = floorState({ check, link: linked("stale"), counts: countAlerts(floorAlerts(check)) });
  assert.deepEqual(state.parts, [
    { text: "1 retard Synthèse", tone: "late", blink: true },
    { text: "à mettre à jour : 0 Prev le Jeu 27/11/25", tone: "warn", blink: false },
  ]);
  assert.match(state.title, /Fin trop tardive/);
  assert.match(state.title, /Non vérifiable : pas de jalon de démarrage daté dans l'étage\./);
  const fine = checkFloor({ tasks: [controlTask(LIMIT)], link: linked(), controls, limits });
  assert.equal(floorState({ check: fine, link: linked(), counts: emptyCounts() }), null, "étage lié sans alerte : rien");
});

test("étage lié à un coffrage d'une autre zone : son état le dit", () => {
  const check = checkFloor({ tasks: [controlTask(LIMIT)], link: linked(), controls, limits });
  const state = floorState({ check, link: linked(), counts: emptyCounts(), otherZoneLabel: "Zone 2 / BAT B" });
  assert.deepEqual(state.parts, [{ text: "lié au coffrage 3032 (Zone 2 / BAT B)", tone: "muted", blink: false }]);
});

test("état d'un niveau lié : cohérent, partiel, non vérifiable, en défaut", () => {
  const works = day(2026, 10, 14);
  const all = checkFloor({ tasks: [controlTask(LIMIT), kickoff(works)], link: linked(), controls, limits, worksStart: works });
  assert.deepEqual(levelState({ checks: [all] }).parts, [{ text: "✓ cohérent", tone: "ok", blink: false }]);

  const partial = checkFloor({ tasks: [controlTask(LIMIT)], link: linked("waiting"), controls, limits });
  const partialState = levelState({ checks: [partial] });
  assert.deepEqual(partialState.parts, [{ text: "✓ cohérent (2 contrôles non vérifiables)", tone: "muted", blink: false }]);
  assert.match(partialState.title, /Non vérifiable : le coffrage 3032 n'a pas de date 0 Prev\./);

  const nothing = checkFloor({ tasks: [], link: linked("waiting") });
  assert.deepEqual(texts(levelState({ checks: [nothing] })), ["non vérifiable"]);

  const late = checkFloor({ tasks: [controlTask(day(2026, 11, 30))], link: linked("stale"), controls, limits });
  const lateState = levelState({ checks: [late, all], counts: { synthese: 1, missing: 0, stale: 1, structure: 2 } });
  assert.deepEqual(lateState.parts, [
    { text: "Synthèse en retard de 103 j", tone: "late", blink: true },
    { text: "à mettre à jour", tone: "warn", blink: false },
    { text: "2 retards Structure", tone: "error", blink: false },
  ]);
  assert.deepEqual(texts(levelState({ checks: [all], counts: { synthese: 0, missing: 0, stale: 0, structure: 1 } })), [
    "✓ cohérent", "1 retard Structure",
  ]);
});

test("état d'un coffrage : le sien, puis ses armatures en retard", () => {
  assert.equal(formworkState({ own: checkDocument({ realise: 0, end: null }, TODAY), lateRebars: 0 }), null);
  const own = checkDocument({ realise: 67, end: day(2026, 9, 2) }, TODAY);
  assert.deepEqual(texts(formworkState({ own, lateRebars: 2 })), ["retard 37 j", "2 armatures en retard"]);
  assert.deepEqual(texts(formworkState({ own: null, lateRebars: 1 })), ["1 armature en retard"]);
});

test("barre d'état : compteurs accordés, coffrage introuvable seulement s'il y en a", () => {
  assert.equal(
    describeCounts({ linkedFloors: 3, unlinkedFloors: 2, synthese: 1, stale: 0, structure: 12, missing: 0 }),
    "3 étages liés · 2 non liés · 1 retard Synthèse · 0 à mettre à jour · 12 retards Structure"
  );
  assert.equal(
    describeCounts({ linkedFloors: 1, unlinkedFloors: 1, synthese: 2, stale: 1, structure: 1, missing: 1 }),
    "1 étage lié · 1 non lié · 2 retards Synthèse · 1 à mettre à jour · 1 retard Structure · 1 coffrage introuvable"
  );
  assert.equal(describeCounts(), "0 étage lié · 0 non lié · 0 retard Synthèse · 0 à mettre à jour · 0 retard Structure");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (depuis `Planning Projet/`) : `node --test tests/globalChecks.test.mjs`
Expected: FAIL — `Cannot find module '…/assets/js/services/globalChecks.js'`.

- [ ] **Step 3: Write the implementation**

Créer `Planning Projet/assets/js/services/globalChecks.js` :

```js
// Contrôles de cohérence de la vue Global (Planning Projet) : retard de la Synthèse par
// rapport à Structure (tâche contrôlée, démarrage du gros œuvre), fond de plan à mettre à
// jour, coffrage introuvable, retard d'un document Structure ; puis ce que chaque ligne
// affiche dans sa colonne « État » et les compteurs de la barre d'état.
// Module pur, sans DOM ni Grist. Les retards se comptent en jours calendaires.
import { formatDate } from "./syntheseTaskModel.js";

const DAY_MS = 86400000;

// Familles d'alertes, de la plus grave à la moins grave.
export const FAMILIES = Object.freeze(["synthese", "missing", "stale", "structure"]);

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function plural(count) {
  return count > 1 ? "s" : "";
}

// Nombre de jours calendaires de `from` à `to` (négatif si `to` est avant).
export function daysBetween(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  return Math.round((toDay(to).getTime() - toDay(from).getTime()) / DAY_MS);
}

export function emptyCounts() {
  return { synthese: 0, missing: 0, stale: 0, structure: 0 };
}

export function addCounts(target, source) {
  FAMILIES.forEach((family) => {
    target[family] += source?.[family] || 0;
  });
  return target;
}

export function hasAlerts(counts) {
  return FAMILIES.some((family) => counts?.[family] > 0);
}

export function countAlerts(alerts) {
  const counts = emptyCounts();
  (alerts || []).forEach((alert) => {
    if (alert?.family in counts) counts[alert.family] += 1;
  });
  return counts;
}

// Retard d'un document Structure. Non terminé : jours entre sa Fin et aujourd'hui ; une
// justification (Remarque) le passe en orange. Terminé : le retard stocké reste lisible,
// sans alerte. Renvoie l'alerte (ou null), ce que la ligne affiche (ou null) et l'infobulle.
export function checkDocument(doc, today) {
  if (Number(doc?.realise) >= 100) {
    const stored = Number(doc?.storedRetard);
    const text = stored > 0 ? `terminé (retard ${stored} j)` : "terminé";
    return { alert: null, part: { text, tone: "muted", blink: false }, title: "" };
  }
  const days = doc?.end instanceof Date ? Math.max(0, daysBetween(doc.end, today)) : 0;
  if (!days) return { alert: null, part: null, title: "" };
  const justification = toText(doc.remarque);
  const tone = justification ? "warn" : "error";
  const text = justification ? `retard ${days} j (justifié)` : `retard ${days} j`;
  const title = justification
    ? `Retard justifié : ${justification}`
    : `Fin prévue le ${formatDate(doc.end)} : ${days} j de retard.`;
  return {
    alert: { code: "docLate", family: "structure", tone, blink: false, days, text, title },
    part: { text, tone, blink: false },
    title,
  };
}

function lateAlert(code, days, title) {
  return { code, family: "synthese", tone: "late", blink: true, days, text: `retard ${days} j`, title };
}

// Contrôles d'un étage de Synthèse. `tasks` : ses tâches ; `link` : l'étage vu par
// buildStructureLink (state, formworkNumber, formwork) ; `controls` : les tâches contrôlées
// (readControlTasks) ; `limits` : leur limite de fin (controlTaskEndLimits) ; `worksStart` : le
// plus ancien « Démarrage travaux » du coffrage et de ses armatures.
// Renvoie : linked (un coffrage est trouvé), alerts (portées par l'étage : à mettre à jour,
// coffrage introuvable), taskAlerts (id de tâche → alertes de retard), unverifiable (raisons)
// et passed (nombre de contrôles faits et passés).
export function checkFloor({ tasks = [], link = null, controls = new Map(), limits = new Map(), worksStart = null } = {}) {
  const result = { linked: false, alerts: [], taskAlerts: new Map(), unverifiable: [], passed: 0 };
  const state = link?.state || "none";
  if (state === "none") return result;
  const number = toText(link.formworkNumber);
  if (state === "missing") {
    result.alerts.push({
      code: "missing",
      family: "missing",
      tone: "error",
      blink: false,
      days: 0,
      text: `coffrage ${number} introuvable`,
      title: `Le coffrage ${number} mémorisé sur cet étage n'existe plus dans le planning Structure.`,
    });
    return result;
  }
  result.linked = true;
  const list = Array.isArray(tasks) ? tasks : [];
  const addTaskAlert = (taskId, alert) => {
    if (!result.taskAlerts.has(taskId)) result.taskAlerts.set(taskId, []);
    result.taskAlerts.get(taskId).push(alert);
  };

  // 1. La tâche contrôlée finit au plus tard le jour où commence le plan de coffrage.
  const controlled = list.filter((task) => controls.has(task.id));
  if (!controlled.length) {
    result.unverifiable.push("pas de tâche contrôlée dans l'étage");
  } else {
    let late = 0;
    let checked = 0;
    controlled.forEach((task) => {
      const entry = limits.get(task.id);
      if (!entry) {
        const reason = `le coffrage ${number} n'a pas de date de début`;
        if (!result.unverifiable.includes(reason)) result.unverifiable.push(reason);
        return;
      }
      if (!(task.end instanceof Date)) {
        result.unverifiable.push(`la tâche contrôlée « ${task.name} » n'a pas de date de fin`);
        return;
      }
      checked += 1;
      if (task.end <= entry.limit) return;
      late += 1;
      addTaskAlert(task.id, lateAlert(
        "late",
        daysBetween(entry.limit, task.end),
        `Fin trop tardive : à finir au plus tard le ${formatDate(entry.limit)} ` +
          `(début du plan de coffrage ${entry.formworkNumber} dans le planning Structure).`
      ));
    });
    if (checked && !late) result.passed += 1;
  }

  // 2. Le jalon de démarrage du gros œuvre ne tombe pas après le démarrage des travaux.
  const kickoff = list
    .filter((task) => task.natureKey === "demarrage")
    .sort((left, right) => left.id - right.id)[0];
  if (!(kickoff?.start instanceof Date)) {
    result.unverifiable.push("pas de jalon de démarrage daté dans l'étage");
  } else if (!(worksStart instanceof Date)) {
    result.unverifiable.push(`aucun démarrage des travaux pour le coffrage ${number}`);
  } else if (kickoff.start > worksStart) {
    addTaskAlert(kickoff.id, lateAlert(
      "goLate",
      daysBetween(worksStart, kickoff.start),
      `Démarrage prévu après le démarrage des travaux de Structure (${formatDate(worksStart)}).`
    ));
  } else {
    result.passed += 1;
  }

  // 3. Le fond de plan démarre à la date 0 Prev du coffrage.
  if (state === "stale") {
    result.alerts.push({
      code: "stale",
      family: "stale",
      tone: "warn",
      blink: false,
      days: 0,
      text: `à mettre à jour : 0 Prev le ${formatDate(link.formwork?.issueDate)}`,
      title: `Le fond de plan de synthèse ne démarre pas à la date 0 Prev du coffrage ${number}.`,
    });
  } else if (state === "noPlan") {
    result.unverifiable.push("pas de tâche « FOND DE PLAN DE SYNTHESE » dans l'étage");
  } else if (state === "waiting") {
    result.unverifiable.push(`le coffrage ${number} n'a pas de date 0 Prev`);
  } else {
    result.passed += 1;
  }
  return result;
}

// Toutes les alertes d'un étage : les siennes, puis celles de ses tâches.
export function floorAlerts(check) {
  return [...(check?.alerts || []), ...[...(check?.taskAlerts?.values() || [])].flat()];
}

function joinTitles(lines) {
  return lines.filter(Boolean).join("\n");
}

function unverifiableLines(reasons) {
  return (reasons || []).map((reason) => `Non vérifiable : ${reason}.`);
}

// État d'une tâche en retard : le plus grand de ses retards, clignotant.
export function taskState(alerts) {
  if (!alerts?.length) return null;
  const days = Math.max(...alerts.map((alert) => alert.days));
  return {
    parts: [{ text: `retard ${days} j`, tone: "late", blink: true }],
    title: joinTitles(alerts.map((alert) => alert.title)),
  };
}

// Résumé du contenu d'une ligne (cycle, étage, zone) : une part par famille, la plus grave
// d'abord ; null sans alerte.
export function summaryState(counts) {
  const parts = [];
  if (counts?.synthese) {
    parts.push({ text: `${counts.synthese} retard${plural(counts.synthese)} Synthèse`, tone: "late", blink: true });
  }
  if (counts?.missing) {
    parts.push({
      text: `${counts.missing} coffrage${plural(counts.missing)} introuvable${plural(counts.missing)}`,
      tone: "error",
      blink: false,
    });
  }
  if (counts?.stale) parts.push({ text: `${counts.stale} à mettre à jour`, tone: "warn", blink: false });
  if (counts?.structure) {
    parts.push({ text: `${counts.structure} retard${plural(counts.structure)} Structure`, tone: "error", blink: false });
  }
  return parts.length ? { parts, title: "" } : null;
}

// État d'une ligne « Synthèse · étage ». `check` : checkFloor ; `link` : l'étage vu par
// buildStructureLink ; `counts` : les alertes de son contenu ; `otherZoneLabel` : la zone du
// coffrage quand elle n'est pas celle de l'étage.
export function floorState({ check, link, counts, otherZoneLabel = "" } = {}) {
  const state = link?.state || "none";
  if (state === "none") {
    return { parts: [{ text: "non lié à un coffrage", tone: "muted", blink: false }], title: "" };
  }
  const parts = (check?.alerts || []).map((alert) => ({ text: alert.text, tone: alert.tone, blink: alert.blink }));
  if (counts?.synthese) {
    parts.unshift({ text: `${counts.synthese} retard${plural(counts.synthese)} Synthèse`, tone: "late", blink: true });
  }
  if (otherZoneLabel) {
    parts.push({ text: `lié au coffrage ${toText(link.formworkNumber)} (${otherZoneLabel})`, tone: "muted", blink: false });
  }
  if (!parts.length) return null;
  return {
    parts,
    title: joinTitles([...floorAlerts(check).map((alert) => alert.title), ...unverifiableLines(check?.unverifiable)]),
  };
}

// État d'un niveau lié (étage ⇄ coffrage). `checks` : checkFloor de chacun de ses étages ;
// `counts` : les alertes de tout son contenu (étages, coffrage, armatures).
export function levelState({ checks = [], counts = emptyCounts() } = {}) {
  const alerts = checks.flatMap(floorAlerts);
  const late = alerts.filter((alert) => alert.family === "synthese");
  const stale = alerts.filter((alert) => alert.family === "stale");
  const unverifiable = checks.flatMap((check) => check.unverifiable || []);
  const passed = checks.reduce((total, check) => total + (check.passed || 0), 0);
  const parts = [];
  if (late.length) {
    const days = Math.max(...late.map((alert) => alert.days));
    parts.push({ text: `Synthèse en retard de ${days} j`, tone: "late", blink: true });
  }
  if (stale.length) {
    parts.push({ text: stale.length > 1 ? `${stale.length} à mettre à jour` : "à mettre à jour", tone: "warn", blink: false });
  }
  if (!parts.length) {
    if (!passed) parts.push({ text: "non vérifiable", tone: "muted", blink: false });
    else if (unverifiable.length) {
      parts.push({
        text: `✓ cohérent (${unverifiable.length} contrôle${plural(unverifiable.length)} non vérifiable${plural(unverifiable.length)})`,
        tone: "muted",
        blink: false,
      });
    } else parts.push({ text: "✓ cohérent", tone: "ok", blink: false });
  }
  if (counts?.structure) {
    parts.push({ text: `${counts.structure} retard${plural(counts.structure)} Structure`, tone: "error", blink: false });
  }
  return { parts, title: joinTitles([...alerts.map((alert) => alert.title), ...unverifiableLines(unverifiable)]) };
}

// État d'un coffrage : le sien (checkDocument), puis ses armatures en retard.
export function formworkState({ own = null, lateRebars = 0 } = {}) {
  const parts = own?.part ? [own.part] : [];
  if (lateRebars) {
    parts.push({ text: `${lateRebars} armature${plural(lateRebars)} en retard`, tone: "error", blink: false });
  }
  return parts.length ? { parts, title: own?.title || "" } : null;
}

// Phrase de la barre d'état. `totals` : linkedFloors, unlinkedFloors et les compteurs d'alertes.
export function describeCounts(totals = {}) {
  const linked = totals.linkedFloors || 0;
  const unlinked = totals.unlinkedFloors || 0;
  const synthese = totals.synthese || 0;
  const stale = totals.stale || 0;
  const structure = totals.structure || 0;
  const missing = totals.missing || 0;
  const parts = [
    `${linked} étage${plural(linked)} lié${plural(linked)}`,
    `${unlinked} non lié${plural(unlinked)}`,
    `${synthese} retard${plural(synthese)} Synthèse`,
    `${stale} à mettre à jour`,
    `${structure} retard${plural(structure)} Structure`,
  ];
  if (missing) parts.push(`${missing} coffrage${plural(missing)} introuvable${plural(missing)}`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/globalChecks.test.mjs`
Expected: PASS — 20 tests.

- [ ] **Step 5: Point de contrôle (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 463 tests, 0 échec.

---

### Task 2: Fusion des deux plannings (`globalPlanningModel.js`, première moitié)

**Files:**
- Create: `Planning Projet/assets/js/services/globalPlanningModel.js`
- Create: `Planning Projet/tests/helpers/globalRows.mjs`
- Test: `Planning Projet/tests/globalPlanningModel.test.mjs` (nouveau)

**Interfaces:**
- Consumes:
  - `checkDocument`, `checkFloor` (tâche 1).
  - `buildTimelineDataFromPlanningRows(rows, projectName).groups` de `services/planningService.js` : un groupe par document, dans l'ordre du planning Structure, avec `rowId`, `isZoneHeader`, `id2Label`, `tachesLabel`, `typeDocLabel`, `zoneLabel`, `debutIso`, `finIso`, `demarrageIso`, `dureeDebutFinLabel`, `indiceLabel`, `meta.groupCompositeKey`. Ne pas utiliser `realiseLabel` : il est recalculé sans les cibles du service ; le `Réalisé` vient de la ligne brute.
  - `buildSections({ rows })`, `isSyntheseServiceRow(row)`, `zoneKeyOf(name)`, `TASK_COLUMNS`, `NO_ZONE_KEY`, `NO_ZONE_LABEL` de `services/syntheseTaskModel.js`.
  - `buildStructureLink({ syntheseRows, projectRows, planRows }) → { zones: [{ zoneKey, floors: [{ key, state, formworkNumber, formwork: { id, number, issueDate, … } }] }] }`, `controlTaskEndLimits({ syntheseRows, formworkStarts }) → Map<id, { limit, formworkNumber }>`, `readControlTasks(syntheseRows) → Map<id, …>`, `isFormworkRow(row)` de `services/structureLinkModel.js`.
  - `parseGristDate(value)` de `services/syntheseTasks.js`.
- Produces :
  - `docTypeKeyOf(typeDoc) → "coffrage" | "armature" | "ndc" | "coupes" | "demolition" | "autre"`.
  - `readStructureDocs(projectRows) → doc[]` — `doc` : `{ id, number, name, typeDoc, typeKey, zoneName, zoneKey, groupKey, start, end, worksStart, weeks, indice, realise, storedRetard, remarque, isFormwork }` (dates : `Date | null`).
  - `buildGlobalPlanning({ projectRows, planRows, today }) → { zones, limits }` — `zones` : `[{ zoneKey, zoneName, label, entries }]` ; une entrée : `{ kind: "level" | "formwork", doc, rebars: doc[], floors: floorEntry[] }`, `{ kind: "floor", node: floorEntry }`, `{ kind: "task", task }` ou `{ kind: "doc", doc }` ; `floorEntry` : `{ key, name, zoneKey, zoneName, floor, link, check, otherZoneLabel }` ; chaque `doc` porte `doc.check` (`checkDocument`). `limits` : la `Map` de `controlTaskEndLimits`.
  - `tests/helpers/globalRows.mjs` : `PROJECT`, `ZONE_1`, `ZONE_2`, `TODAY`, `structureRows()`, `syntheseRows()`, `projectRows()`, `planRows()`.

- [ ] **Step 1: Write the test fixture**

Créer `Planning Projet/tests/helpers/globalRows.mjs` :

```js
// Jeu d'essai de la vue Global, repris de la base de test (ERA QUAI D'ORSAY) : Planning_Projet
// du projet, tous services, et sa liste de plans. Aujourd'hui = vendredi 09/10/26.
//
// Structure
//   Zone 1 / BAT BC : coffrage 3031 (id 101, groupe 4) et son armature 3216 (102).
//   Zone 2 / BAT B  : coffrages 3032 (113, groupe 13), 3012 (111, groupe 11), 3022 (112,
//                     groupe 12), chacun avec une armature (123, 121, 122) ; coupes 3820 (131) ;
//                     armature sans groupe 3724 (142, terminée).
//   Sans zone       : NDC 3999 (141, terminée).
// Synthèse (étages créés d'après le modèle, durées de la capture, RECEPTION au 02/01/26)
//   Zone 1 / BAT BC : SS1 (ligne-étage 200) lié au coffrage 3031.
//   Zone 2 / BAT B  : SS1 (300) lié à 3022 ; RDC (400) lié à 3032, dont la tâche contrôlée
//                     choisie (420) finit le 30/11/26 ; R+1 (500) non lié, une tâche (501) ;
//                     « Réunion de lancement » (600) hors étage.
// Liste de plans : 0 Prev de 3022 au 02/01/26 (fond de plan à jour), de 3031 au 27/11/25 (à
// mettre à jour), rien pour 3032.
import { datedRows } from "./templateRows.mjs";

export const PROJECT = "ERA QUAI D'ORSAY";
export const ZONE_1 = "Zone 1 / BAT BC";
export const ZONE_2 = "Zone 2 / BAT B";
export const TODAY = new Date(2026, 9, 9);

function structureRow(id, fields = {}) {
  return {
    id,
    NomProjet: PROJECT,
    Service: "Structure",
    ID2: "",
    Taches: "",
    Type_doc: "",
    Zone: "",
    Groupe: "",
    Ligne_planning: "",
    Indice: "",
    Duree_1: 0,
    Duree_2: 0,
    Duree_3: 0,
    Date_limite: null,
    Diff_coffrage: null,
    Diff_armature: null,
    Demarrages_travaux: null,
    Retards: 0,
    Realise: 0,
    Date_Realise: null,
    Date_Cloture: null,
    Remarque: "",
    ...fields,
  };
}

const formwork = (id, number, name, zone, group, start, end, fields = {}) => structureRow(id, {
  ID2: number, Taches: name, Type_doc: "COFFRAGE", Zone: zone, Groupe: group, Indice: "A",
  Date_limite: start, Duree_1: 2, Diff_coffrage: end, Realise: 67, ...fields,
});

const rebar = (id, number, name, zone, group, start, end, works, fields = {}) => structureRow(id, {
  ID2: number, Taches: name, Type_doc: "ARMATURES", Zone: zone, Groupe: group, Ligne_planning: "900",
  Diff_coffrage: start, Duree_2: 2, Diff_armature: end, Duree_3: 4, Demarrages_travaux: works, ...fields,
});

export function structureRows() {
  return [
    structureRow(1, { Zone: ZONE_1 }),
    structureRow(2, { Zone: ZONE_2 }),
    formwork(101, "3031", "PH REZ DE CHAUSSEE - COF", ZONE_1, "4", "2027-03-03", "2027-03-17"),
    rebar(102, "3216", "PH REZ DE CHAUSSEE - VOILES", ZONE_1, "4", "2027-03-17", "2027-03-31", "2027-04-28"),
    formwork(111, "3012", "PBAS 1er SOUS-SOL - COF", ZONE_2, "11", "2026-10-05", "2026-10-19"),
    formwork(112, "3022", "PH 1er SOUS-SOL - COF", ZONE_2, "12", "2026-10-29", "2026-11-12"),
    formwork(113, "3032", "PH REZ DE CHAUSSEE - COF", ZONE_2, "13", "2026-08-19", "2026-09-02", { Retards: 37 }),
    rebar(121, "3306", "CARNEAUX + DALLES BASSES", ZONE_2, "11", "2026-10-19", "2026-11-02", "2026-11-30"),
    rebar(122, "3310", "PH 1er SOUS-SOL - DALLES", ZONE_2, "12", "2026-11-12", "2026-11-26", "2026-12-24"),
    rebar(123, "3314", "PH REZ DE CHAUSSEE - DALLES", ZONE_2, "13", "2026-09-02", "2026-09-16", "2026-10-14", { Retards: 23 }),
    structureRow(131, {
      ID2: "3820", Taches: "BAT B - ASCENSEURS 1-2 FILE 3", Type_doc: "COUPES", Zone: ZONE_2, Ligne_planning: "832",
      Date_limite: "2027-02-23", Duree_1: 2, Diff_coffrage: "2027-03-09", Duree_3: 6, Demarrages_travaux: "2027-04-20",
    }),
    structureRow(141, { ID2: "3999", Taches: "Note d'hypothèses générales", Type_doc: "NDC", Indice: "0", Realise: 100 }),
    structureRow(142, { ID2: "3724", Taches: "GRUE ARM", Type_doc: "ARMATURES", Zone: ZONE_2, Indice: "A", Realise: 100, Retards: 8 }),
  ];
}

// Un étage du modèle, au service Synthese, sans la ligne de zone de l'aide (id 10).
function floorRows({ zoneName, floorName, firstId, link }) {
  return datedRows({ zoneName, floorName, firstId })
    .filter((row) => row.id !== 10)
    .map((row) => ({
      ...row,
      NomProjet: PROJECT,
      Service: "Synthese",
      Lien_Structure: row.id === firstId ? link : "",
      Controle_Coffrage: false,
    }));
}

export function syntheseRows() {
  const plain = {
    NomProjet: PROJECT, Service: "Synthese", Type_doc: "", ID2: "", Groupe: "", Etage: false, Nature: "", Parent: "",
    Lien: "", Lien_Structure: "", Controle_Coffrage: false, Diff_coffrage: null, Diff_armature: null, Duree_1: 0,
  };
  const rdc = floorRows({ zoneName: ZONE_2, floorName: "RDC", firstId: 400, link: "3032" });
  // La tâche contrôlée choisie de RDC : « PLAN DE SYNTHESE RESEAUX NIV RDC » du cycle 3.
  Object.assign(rdc.find((row) => row.id === 420), { Controle_Coffrage: true, Diff_armature: "2026-11-30", Duree_1: 200 });
  return [
    ...floorRows({ zoneName: ZONE_1, floorName: "SS1", firstId: 200, link: "3031" }),
    ...floorRows({ zoneName: ZONE_2, floorName: "SS1", firstId: 300, link: "3022" }),
    ...rdc,
    { ...plain, id: 500, Taches: "R+1", Zone: ZONE_2, Etage: true },
    { ...plain, id: 501, Taches: "Visa MOE", Zone: ZONE_2, Groupe: "R+1", Diff_coffrage: "2026-10-12", Diff_armature: "2026-10-16", Duree_1: 5 },
    { ...plain, id: 600, Taches: "Réunion de lancement", Zone: ZONE_2, Diff_coffrage: "2025-12-01", Diff_armature: "2025-12-01", Duree_1: 0 },
  ];
}

// Planning_Projet du projet, tous services : Structure, Synthèse, et ce que la vue ignore.
export function projectRows() {
  return [
    ...structureRows(),
    ...syntheseRows(),
    structureRow(901, { Service: "Topographie", ID2: "7001", Taches: "Implantation", Type_doc: "COUPES", Zone: ZONE_2 }),
    { id: 902, NomProjet: PROJECT, Service: "Synthese", Taches: "Segment v1", Type_doc: "SYNTHESE", Zone: "", Diff_coffrage: "2026-09-17", Diff_armature: "2026-09-18" },
  ];
}

export function planRows() {
  const plan = (number, date) => ({ Type_document: "COFFRAGE", NumeroDocument: number, Indice: "Prev 0", DateDiffusion: date, Service: "Structure" });
  return [plan("3022", "2026-01-02"), plan("3031", "2025-11-27")];
}
```

- [ ] **Step 2: Write the failing test**

Créer `Planning Projet/tests/globalPlanningModel.test.mjs` :

```js
// Vue Global : fusion du planning Synthèse et du planning Structure d'un projet — documents
// Structure, zones, niveaux liés, armatures sous leur coffrage, ordre des entrées.
import test from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const { buildGlobalPlanning, docTypeKeyOf, readStructureDocs } = await import("../assets/js/services/globalPlanningModel.js");
const { zoneKeyOf } = await import("../assets/js/services/syntheseTaskModel.js");
const {
  PROJECT, TODAY, ZONE_1, ZONE_2, planRows, projectRows, structureRows, syntheseRows,
} = await import("./helpers/globalRows.mjs");

const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);
const build = (rows = projectRows(), plans = planRows()) => buildGlobalPlanning({ projectRows: rows, planRows: plans, today: TODAY });
// Entrée résumée : son genre et ce qu'elle désigne.
const brief = (entry) => {
  if (entry.kind === "level") return `level:${entry.doc.number}<${entry.floors.map((floor) => floor.name).join(",")}>+${entry.rebars.length}`;
  if (entry.kind === "formwork") return `formwork:${entry.doc.number}+${entry.rebars.length}`;
  if (entry.kind === "floor") return `floor:${entry.node.name}`;
  if (entry.kind === "task") return `task:${entry.task.id}`;
  return `doc:${entry.doc.number}`;
};
const zoneOf = (planning, zoneName) => planning.zones.find((zone) => zone.zoneKey === zoneKeyOf(zoneName));

test("type d'un document Structure, sans accents ni casse", () => {
  assert.deepEqual(
    ["COFFRAGE", "Armatures", "NDC", "coupes", "DÉMOLITION", "Carnet", ""].map(docTypeKeyOf),
    ["coffrage", "armature", "ndc", "coupes", "demolition", "autre", "autre"]
  );
});

test("documents Structure : l'ordre et les dates du planning Structure, les valeurs stockées", () => {
  const docs = readStructureDocs(projectRows());
  assert.deepEqual(docs.map((doc) => doc.number), [
    "3031", "3216", "3032", "3314", "3012", "3306", "3022", "3310", "3820", "3724", "3999",
  ]);
  const formwork = docs.find((doc) => doc.number === "3032");
  assert.deepEqual(
    [formwork.id, formwork.typeKey, formwork.zoneName, iso(formwork.start), iso(formwork.end), formwork.worksStart, formwork.weeks],
    [113, "coffrage", ZONE_2, "2026-08-19", "2026-09-02", null, 2]
  );
  assert.deepEqual([formwork.indice, formwork.realise, formwork.storedRetard, formwork.isFormwork], ["A", 67, 37, true]);
  const rebar = docs.find((doc) => doc.number === "3314");
  assert.deepEqual([rebar.typeKey, iso(rebar.start), iso(rebar.end), iso(rebar.worksStart), rebar.groupKey], [
    "armature", "2026-09-02", "2026-09-16", "2026-10-14", formwork.groupKey,
  ]);
  assert.equal(docs.find((doc) => doc.number === "3820").groupKey, "", "coupes : hors groupe");
  assert.equal(docs.find((doc) => doc.number === "3724").weeks, null);
  assert.deepEqual(readStructureDocs(null), []);
});

test("Topographie et anciens segments de Synthese v1 : ignorés", () => {
  assert.equal(readStructureDocs(projectRows()).some((doc) => doc.number === "7001"), false, "document de Topographie");
  const taskIds = build().zones.flatMap((zone) => zone.entries.filter((entry) => entry.kind === "task").map((entry) => entry.task.id));
  assert.deepEqual(taskIds, [600], "le segment v1 (id 902) n'est pas une tâche");
});

test("zones communes aux deux services, triées, « Sans zone » à la fin", () => {
  assert.deepEqual(build().zones.map((zone) => [zone.label, zone.zoneKey]), [
    [ZONE_1, zoneKeyOf(ZONE_1)],
    [ZONE_2, zoneKeyOf(ZONE_2)],
    ["Sans zone", ""],
  ]);
});

test("une zone : niveaux et coffrages dans l'ordre de Structure, puis le reste de la Synthèse, puis les autres documents", () => {
  const planning = build();
  assert.deepEqual(zoneOf(planning, ZONE_1).entries.map(brief), ["level:3031<SS1>+1"]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief), [
    "level:3032<RDC>+1",
    "formwork:3012+1",
    "level:3022<SS1>+1",
    "floor:R+1",
    "task:600",
    "doc:3820",
    "doc:3724",
  ]);
  assert.deepEqual(planning.zones.at(-1).entries.map(brief), ["doc:3999"]);
});

test("armatures : sous le coffrage de leur zone et de leur Groupe", () => {
  const level = zoneOf(build(), ZONE_2).entries[0];
  assert.deepEqual(level.rebars.map((rebar) => rebar.number), ["3314"]);
  assert.equal(level.doc.check.alert.days, 37, "retard du coffrage, compté jusqu'à aujourd'hui");
  assert.equal(level.rebars[0].check.alert.days, 23);
});

// Deux coffrages d'un même groupe prennent les dates de son armature : à dates égales, le
// planning Structure les range par N°, et 3022 passe devant 3032.
test("groupe à plusieurs coffrages : les armatures sous le premier ; armature sans coffrage : document simple", () => {
  const rows = structureRows().map((row) => {
    if (row.id === 112) return { ...row, Groupe: "13" }; // 3022 rejoint le groupe de 3032
    if (row.id === 122) return { ...row, Groupe: "99" }; // 3310 : groupe sans coffrage
    return row;
  });
  const entries = zoneOf(build(rows, []), ZONE_2).entries.map(brief);
  assert.deepEqual(entries, ["formwork:3022+1", "formwork:3032+0", "formwork:3012+1", "doc:3310", "doc:3820", "doc:3724"]);
});

test("étage lié : ses contrôles, avec le démarrage des travaux de son niveau", () => {
  const planning = build();
  const [rdc] = zoneOf(planning, ZONE_2).entries[0].floors;
  assert.deepEqual([rdc.key, rdc.link.state, rdc.check.linked, rdc.otherZoneLabel], ["rdc", "waiting", true, ""]);
  const [alert] = rdc.check.taskAlerts.get(420);
  assert.deepEqual([alert.code, alert.days], ["late", 103]);
  assert.equal(rdc.check.passed, 1, "démarrage du gros œuvre avant le démarrage des travaux (14/10/26)");
  assert.deepEqual(rdc.check.unverifiable, ["le coffrage 3032 n'a pas de date 0 Prev"]);
  const [ss1] = zoneOf(planning, ZONE_2).entries[2].floors;
  assert.deepEqual([ss1.link.state, ss1.check.passed, ss1.check.taskAlerts.size], ["current", 3, 0]);
  const [stale] = zoneOf(planning, ZONE_1).entries[0].floors;
  assert.deepEqual(stale.check.alerts.map((entry) => entry.code), ["stale"]);
});

test("plusieurs étages liés au même coffrage : un seul niveau", () => {
  const rows = projectRows().map((row) => (row.id === 500 ? { ...row, Lien_Structure: "3032" } : row));
  const [level] = zoneOf(build(rows), ZONE_2).entries;
  assert.equal(brief(level), "level:3032<RDC,R+1>+1");
});

test("étage lié à un coffrage d'une autre zone : hors niveau, contrôlé quand même", () => {
  const rows = projectRows().map((row) => (row.id === 500 ? { ...row, Lien_Structure: "3031" } : row));
  const planning = build(rows);
  const entry = zoneOf(planning, ZONE_2).entries.find((candidate) => candidate.kind === "floor");
  assert.deepEqual([entry.node.name, entry.node.check.linked, entry.node.otherZoneLabel], ["R+1", true, ZONE_1]);
  assert.equal(brief(zoneOf(planning, ZONE_1).entries[0]), "level:3031<SS1>+1", "le coffrage garde son seul étage de sa zone");
});

test("coffrage introuvable ou étage non lié : hors niveau", () => {
  const rows = projectRows().map((row) => (row.id === 400 ? { ...row, Lien_Structure: "3099" } : row));
  const entries = zoneOf(build(rows), ZONE_2).entries;
  assert.deepEqual(entries.map(brief).slice(0, 5), ["formwork:3032+1", "formwork:3012+1", "level:3022<SS1>+1", "floor:RDC", "floor:R+1"]);
  const rdc = entries.find((entry) => entry.kind === "floor" && entry.node.name === "RDC").node;
  assert.deepEqual(rdc.check.alerts.map((alert) => alert.text), ["coffrage 3099 introuvable"]);
  const unlinked = entries.find((entry) => entry.kind === "floor" && entry.node.name === "R+1").node;
  assert.deepEqual([unlinked.link.state, unlinked.check.linked], ["none", false]);
});

test("projet sans Synthèse : le planning Structure, coffrages et armatures groupés", () => {
  const planning = build(structureRows(), []);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief), [
    "formwork:3032+1", "formwork:3012+1", "formwork:3022+1", "doc:3820", "doc:3724",
  ]);
});

test("projet sans Structure : les étages, tous non liés ou introuvables", () => {
  const planning = build(syntheseRows(), []);
  assert.deepEqual(planning.zones.map((zone) => zone.label), [ZONE_1, ZONE_2]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief), ["floor:SS1", "floor:RDC", "floor:R+1", "task:600"]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries[1].node.check.alerts.map((alert) => alert.code), ["missing"]);
});

test("colonnes de la Synthèse absentes (production) : rien ne casse, la Structure s'affiche", () => {
  const stripped = projectRows().map((row) => {
    const { Etage, Nature, Parent, Lien, Lien_Structure, Controle_Coffrage, ...rest } = row;
    return rest;
  });
  const planning = build(stripped);
  const entries = zoneOf(planning, ZONE_2).entries;
  assert.deepEqual(entries.filter((entry) => entry.kind !== "task").map(brief), [
    "formwork:3032+1", "formwork:3012+1", "formwork:3022+1", "floor:SS1", "floor:RDC", "floor:R+1", "doc:3820", "doc:3724",
  ]);
  assert.ok(entries.some((entry) => entry.kind === "task"), "les lignes-étages, sans la colonne Etage, sont des tâches");
});

// Lues par l'API REST de Grist, les colonnes Date arrivent en secondes depuis 1970 (minuit UTC),
// pas en texte.
test("dates en secondes Grist : mêmes dates, mêmes retards qu'en texte", () => {
  const DATE_COLUMNS = ["Date_limite", "Diff_coffrage", "Diff_armature", "Demarrages_travaux", "DateDiffusion"];
  const toSeconds = (row) => {
    const copy = { ...row };
    DATE_COLUMNS.forEach((column) => {
      if (typeof copy[column] === "string" && copy[column]) copy[column] = Date.parse(`${copy[column]}T00:00:00Z`) / 1000;
    });
    return copy;
  };
  const planning = build(projectRows().map(toSeconds), planRows().map(toSeconds));
  const level = zoneOf(planning, ZONE_2).entries[0];
  assert.equal(brief(level), "level:3032<RDC>+1");
  assert.deepEqual([iso(level.doc.start), iso(level.doc.end), iso(level.rebars[0].worksStart)], ["2026-08-19", "2026-09-02", "2026-10-14"]);
  assert.equal(level.doc.check.alert.days, 37);
  assert.equal(level.floors[0].check.taskAlerts.get(420)[0].days, 103);
  assert.equal(zoneOf(planning, ZONE_2).entries[2].floors[0].link.state, "current", "0 Prev lu en secondes");
});

test("même zone écrite différemment par les deux services : une seule section, l'étage rejoint son coffrage", () => {
  const rows = projectRows().map((row) => (
    row.Service === "Synthese" && row.Zone === ZONE_2 ? { ...row, Zone: "ZONE 2 / bat b" } : row
  ));
  const planning = build(rows);
  assert.equal(planning.zones.filter((zone) => zone.zoneKey === zoneKeyOf(ZONE_2)).length, 1);
  assert.equal(planning.zones.length, 3);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief).slice(0, 3), [
    "level:3032<RDC>+1", "formwork:3012+1", "level:3022<SS1>+1",
  ]);
});

test("projet connu sous deux noms : tous ses documents Structure, une seule fois", () => {
  const rows = projectRows().map((row) => (
    row.Service === "Structure" && row.Zone === ZONE_1 ? { ...row, NomProjet: "ERA QUAI D ORSAY" } : row
  ));
  const numbers = readStructureDocs(rows).map((doc) => doc.number);
  assert.deepEqual([...numbers].sort(), ["3012", "3022", "3031", "3032", "3216", "3306", "3310", "3314", "3724", "3820", "3999"]);
  assert.equal(brief(zoneOf(build(rows), ZONE_1).entries[0]), "level:3031<SS1>+1");
});

test("aucune ligne : aucune zone", () => {
  assert.deepEqual(build([], []).zones, []);
  assert.deepEqual(buildGlobalPlanning().zones, []);
  assert.equal(PROJECT, "ERA QUAI D'ORSAY");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run : `node --test tests/globalPlanningModel.test.mjs`
Expected: FAIL — `Cannot find module '…/assets/js/services/globalPlanningModel.js'`.

- [ ] **Step 4: Write the implementation**

Créer `Planning Projet/assets/js/services/globalPlanningModel.js` :

```js
// Modèle de la vue Global (Planning Projet) : le planning Synthèse et le planning Structure
// d'un projet dans un même arbre. Zone → niveau (étage de Synthèse ⇄ coffrage de Structure) →
// étage et coffrage côte à côte ; les armatures sous leur coffrage ; le reste au niveau zone.
// Module pur, sans DOM ni Grist : il ne lit que des lignes déjà chargées et n'écrit rien.
import { buildTimelineDataFromPlanningRows } from "./planningService.js";
import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  TASK_COLUMNS,
  buildSections,
  isSyntheseServiceRow,
  zoneKeyOf,
} from "./syntheseTaskModel.js";
import {
  buildStructureLink,
  controlTaskEndLimits,
  isFormworkRow,
  readControlTasks,
} from "./structureLinkModel.js";
import { parseGristDate } from "./syntheseTasks.js";
import { checkDocument, checkFloor } from "./globalChecks.js";

// Colonnes de Planning_Projet lues en plus de celles du planning Structure.
const DOC_COLUMNS = Object.freeze({ realise: "Realise", retards: "Retards", remarque: "Remarque" });

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function plainUpper(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("fr");
}

function compareNames(left, right) {
  return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
}

function isStructureRow(row) {
  return plainUpper(row?.[TASK_COLUMNS.service]) === "STRUCTURE";
}

// Type d'un document Structure, pour sa couleur : coffrage, armature, ndc, coupes, demolition,
// autre (mêmes familles que les barres du planning Structure).
export function docTypeKeyOf(typeDoc) {
  const type = plainUpper(typeDoc);
  if (type.includes("COFFRAGE")) return "coffrage";
  if (type.includes("ARMATURES")) return "armature";
  if (type === "NDC") return "ndc";
  if (type === "COUPES") return "coupes";
  if (type === "DEMOLITION") return "demolition";
  return "autre";
}

// Les documents Structure du projet, dans l'ordre du planning Structure, avec les dates qu'il
// affiche (Début, Fin, Démarrage travaux) : elles lui sont demandées, pas recalculées ici.
// Réalisé, Retard et Remarque sont les valeurs stockées. `projectRows` : Planning_Projet du
// projet, tous services.
export function readStructureDocs(projectRows) {
  const rows = (Array.isArray(projectRows) ? projectRows : []).filter(isStructureRow);
  const rawById = new Map(rows.map((row) => [Number(row[TASK_COLUMNS.id]), row]));
  // Le planning Structure ne retient que les lignes écrites au nom du projet qu'on lui donne.
  const projectNames = [...new Set(rows.map((row) => toText(row[TASK_COLUMNS.project])))].filter(Boolean);
  const docs = [];
  projectNames.forEach((projectName) => {
    buildTimelineDataFromPlanningRows(rows, projectName).groups.forEach((group) => {
      const id = Number(group.rowId);
      if (group.isZoneHeader || !Number.isInteger(id) || id <= 0) return;
      const raw = rawById.get(id) || {};
      const weeks = Number(group.dureeDebutFinLabel);
      const zoneName = toText(group.zoneLabel);
      docs.push({
        id,
        number: toText(group.id2Label),
        name: toText(group.tachesLabel),
        typeDoc: toText(group.typeDocLabel),
        typeKey: docTypeKeyOf(group.typeDocLabel),
        zoneName,
        zoneKey: zoneKeyOf(zoneName),
        // Zone et Groupe réunis : vide hors coffrage et armature, ou sans Groupe.
        groupKey: toText(group.meta?.groupCompositeKey),
        start: parseGristDate(group.debutIso),
        end: parseGristDate(group.finIso),
        worksStart: parseGristDate(group.demarrageIso),
        weeks: Number.isFinite(weeks) && weeks > 0 ? weeks : null,
        indice: toText(group.indiceLabel),
        realise: Number(raw[DOC_COLUMNS.realise]) || 0,
        storedRetard: Number(raw[DOC_COLUMNS.retards]) || 0,
        remarque: toText(raw[DOC_COLUMNS.remarque]),
        // Coffrage qu'un étage peut lier (nommé, voir « Lien Structure »).
        isFormwork: isFormworkRow(raw),
      });
    });
  });
  return docs;
}

function earliest(dates) {
  const list = dates.filter((date) => date instanceof Date);
  return list.length ? new Date(Math.min(...list.map((date) => date.getTime()))) : null;
}

// Le planning fusionné d'un projet : ses zones (triées par nom, « Sans zone » à la fin), et
// dans chacune ses entrées, dans l'ordre d'affichage — niveaux liés et coffrages sans étage
// (ordre du planning Structure), étages de Synthèse hors niveau, tâches de Synthèse hors étage,
// autres documents Structure. `projectRows` : Planning_Projet du projet, tous services ;
// `planRows` : ListePlan_NDC_COF du projet ; `today` : le jour des retards.
export function buildGlobalPlanning({ projectRows = [], planRows = [], today = new Date() } = {}) {
  const rows = Array.isArray(projectRows) ? projectRows : [];
  const syntheseRows = rows.filter(isSyntheseServiceRow);
  const docs = readStructureDocs(rows);
  docs.forEach((doc) => {
    doc.check = checkDocument(doc, today);
  });

  const zones = new Map();
  const zoneFor = (zoneKey, zoneName) => {
    if (!zones.has(zoneKey)) {
      zones.set(zoneKey, { zoneKey, zoneName, label: zoneName || NO_ZONE_LABEL, heads: [], floors: [], tasks: [], docs: [] });
    }
    return zones.get(zoneKey);
  };

  // Structure : chaque coffrage ouvre un bloc ; les armatures de son Groupe s'y rangent (sous
  // le premier coffrage du groupe) ; tout le reste est un document simple de sa zone.
  const headsById = new Map();
  const headByGroup = new Map();
  docs.forEach((doc) => {
    if (doc.typeKey !== "coffrage") return;
    const head = { doc, rebars: [], floors: [] };
    zoneFor(doc.zoneKey, doc.zoneName).heads.push(head);
    headsById.set(doc.id, head);
    if (doc.groupKey && !headByGroup.has(doc.groupKey)) headByGroup.set(doc.groupKey, head);
  });
  docs.forEach((doc) => {
    if (doc.typeKey === "coffrage") return;
    const head = doc.typeKey === "armature" && doc.groupKey ? headByGroup.get(doc.groupKey) : null;
    if (head) head.rebars.push(doc);
    else zoneFor(doc.zoneKey, doc.zoneName).docs.push(doc);
  });

  // Synthèse : un étage rejoint le bloc de son coffrage quand ils sont dans la même zone.
  const link = buildStructureLink({ syntheseRows, projectRows: rows, planRows });
  const linkFloors = new Map();
  link.zones.forEach((zone) => zone.floors.forEach((floor) => linkFloors.set(`${zone.zoneKey}/${floor.key}`, floor)));
  const controls = readControlTasks(syntheseRows);
  const limits = controlTaskEndLimits({
    syntheseRows,
    formworkStarts: docs
      .filter((doc) => doc.isFormwork)
      .sort((left, right) => left.id - right.id)
      .map((doc) => ({ number: doc.number, zoneName: doc.zoneName, start: doc.start })),
  });
  buildSections({ rows: syntheseRows }).forEach((section) => {
    section.items.forEach((item) => {
      if (item.kind === "task") {
        zoneFor(section.zoneKey, section.zoneName).tasks.push(item.task);
        return;
      }
      const { floor } = item;
      const floorLink = linkFloors.get(`${section.zoneKey}/${floor.key}`) || { state: "none", formworkNumber: "", formwork: null };
      const head = floorLink.formwork ? headsById.get(floorLink.formwork.id) || null : null;
      const sameZone = Boolean(head) && head.doc.zoneKey === section.zoneKey;
      const node = {
        key: floor.key,
        name: floor.name,
        zoneKey: section.zoneKey,
        zoneName: section.zoneName,
        floor,
        link: floorLink,
        check: checkFloor({
          tasks: floor.tasks,
          link: floorLink,
          controls,
          limits,
          worksStart: head ? earliest([head.doc.worksStart, ...head.rebars.map((rebar) => rebar.worksStart)]) : null,
        }),
        otherZoneLabel: head && !sameZone ? head.doc.zoneName || NO_ZONE_LABEL : "",
      };
      if (sameZone) head.floors.push(node);
      else zoneFor(section.zoneKey, section.zoneName).floors.push(node);
    });
  });

  const ordered = [...zones.values()]
    .sort((left, right) => {
      if ((left.zoneKey === NO_ZONE_KEY) !== (right.zoneKey === NO_ZONE_KEY)) return left.zoneKey === NO_ZONE_KEY ? 1 : -1;
      return compareNames(left.zoneName, right.zoneName);
    })
    .map((zone) => ({
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      label: zone.label,
      entries: [
        ...zone.heads.map((head) => ({ kind: head.floors.length ? "level" : "formwork", ...head })),
        ...zone.floors.map((node) => ({ kind: "floor", node })),
        ...zone.tasks.map((task) => ({ kind: "task", task })),
        ...zone.docs.map((doc) => ({ kind: "doc", doc })),
      ],
    }));
  return { zones: ordered, limits };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run : `node --test tests/globalPlanningModel.test.mjs`
Expected: PASS — 18 tests.

- [ ] **Step 6: Point de contrôle (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 481 tests, 0 échec.

---

### Task 3: Les lignes affichées (`globalPlanningModel.js`, seconde moitié)

**Files:**
- Modify: `Planning Projet/assets/js/services/globalPlanningModel.js`
- Test: `Planning Projet/tests/globalRowModel.test.mjs` (nouveau)

**Interfaces:**
- Consumes:
  - `buildGlobalPlanning(...)` et ses entrées (tâche 2).
  - `addCounts`, `countAlerts`, `emptyCounts`, `hasAlerts`, `taskState`, `summaryState`, `floorState`, `levelState`, `formworkState` (tâche 1).
  - `buildRowModel(sections)` de `services/syntheseTaskModel.js` : appelé sans replis, il rend toutes les lignes d'une section — la ligne de zone, puis `floor` (niveau 1), `group` et `task` (niveaux 2 à 4), avec `key` (`floor:<zone>/<étage>`, `group:<id>`, `task:<id>`), `kind`, `level`, `taskId`, `groupRowId`, `link`, `nature`, `id2`, `indice`, `start`, `end`, `durationDays`, `isMilestone`. `formatDuration(days)` du même module.
  - `applyEndLimits(lines, limits)` et `formworkLabel({ number, name }) → "3032 — nom"` de `services/structureLinkModel.js`.
- Produces : `buildGlobalRowModel(planning, { zoneFilter = "", toggledKeys = new Set(), alertsOnly = false }) → { lines, totals }`.
  - `totals` : `{ linkedFloors, unlinkedFloors, synthese, missing, stale, structure }`.
  - Une ligne : `{ key, kind: "zone" | "level" | "floor" | "group" | "task" | "doc", role: "zone" | "level" | "floor" | "group" | "task" | "formwork" | "rebar" | "doc", service: "" | "synthese" | "structure", level, name, id2, indice, durationLabel, start, end, isMilestone, nature, link, taskId, groupRowId, zoneKey, floorKey, variant, marker, countLabel, expandable, collapsed, childCount, state, blinkEnd, tone, endLimit?, isOverEndLimit?, endLimitNote? }`.
  - Par défaut une zone est dépliée et tout le reste replié ; `toggledKeys` inverse l'état des clés qu'il contient ; avec `alertsOnly`, tout est déplié par défaut et seules les lignes en alerte (et leurs parentes) restent.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/globalRowModel.test.mjs` :

```js
// Vue Global : les lignes affichées — replis, états, remontée des alertes, « Alertes
// seulement », filtre de zone, compteurs de la barre d'état.
import test from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const { buildGlobalPlanning, buildGlobalRowModel } = await import("../assets/js/services/globalPlanningModel.js");
const { TODAY, ZONE_1, planRows, projectRows } = await import("./helpers/globalRows.mjs");

const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);
const planningOf = (rows = projectRows()) => buildGlobalPlanning({ projectRows: rows, planRows: planRows(), today: TODAY });
const model = (options = {}, rows) => buildGlobalRowModel(planningOf(rows), options);
const keys = (lines) => lines.map((line) => line.key);
const texts = (line) => (line.state ? line.state.parts.map((part) => part.text) : []);
const lineOf = (lines, key) => lines.find((line) => line.key === key);
// Chemin déplié jusqu'à la tâche contrôlée de l'étage RDC (id 420).
const RDC_PATH = ["level:113", "floor:zone2batb/rdc", "group:416", "group:419", "doc:113"];

test("par défaut : zones dépliées, niveaux, étages et coffrages repliés", () => {
  const { lines } = model();
  assert.deepEqual(keys(lines), [
    "zone:zone1batbc", "level:101",
    "zone:zone2batb", "level:113", "doc:111", "level:112", "floor:zone2batb/rp1", "task:600", "doc:131", "doc:142",
    "zone:", "doc:141",
  ]);
  assert.deepEqual(lines.map((line) => line.level), [0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
  assert.deepEqual(lines.map((line) => line.collapsed), [
    false, true, false, true, true, true, true, false, false, false, false, false,
  ]);
  assert.deepEqual(lines.map((line) => line.expandable), [
    true, true, true, true, true, true, true, false, false, false, true, false,
  ]);
});

test("compteurs de la barre d'état", () => {
  assert.deepEqual(model().totals, { linkedFloors: 3, unlinkedFloors: 1, synthese: 1, missing: 0, stale: 1, structure: 2 });
  assert.deepEqual(buildGlobalRowModel({ zones: [] }).totals, {
    linkedFloors: 0, unlinkedFloors: 0, synthese: 0, missing: 0, stale: 0, structure: 0,
  });
  assert.deepEqual(buildGlobalRowModel(null).lines, []);
});

test("niveau déplié : l'étage de Synthèse puis le coffrage, repliés tous les deux", () => {
  const { lines } = model({ toggledKeys: new Set(["level:113"]) });
  const at = keys(lines).indexOf("level:113");
  assert.deepEqual(keys(lines).slice(at, at + 4), ["level:113", "floor:zone2batb/rdc", "doc:113", "doc:111"]);
  const level = lines[at];
  assert.deepEqual([level.kind, level.role, level.service, level.name, level.collapsed], [
    "level", "level", "", "RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF", false,
  ]);
  assert.deepEqual([iso(level.start), iso(level.end), level.durationLabel], ["2026-01-02", "2026-11-30", ""]);
  const floor = lines[at + 1];
  assert.deepEqual([floor.kind, floor.role, floor.service, floor.level, floor.name, floor.durationLabel, floor.collapsed], [
    "floor", "floor", "synthese", 2, "Synthèse · RDC", "230 jours", true,
  ]);
  const formwork = lines[at + 2];
  assert.deepEqual(
    [formwork.kind, formwork.role, formwork.service, formwork.level, formwork.name, formwork.id2, formwork.indice],
    ["doc", "formwork", "structure", 2, "PH REZ DE CHAUSSEE - COF", "3032", "A"]
  );
  assert.deepEqual(
    [formwork.durationLabel, iso(formwork.start), iso(formwork.end), formwork.variant, formwork.countLabel, formwork.childCount],
    ["2 sem.", "2026-08-19", "2026-09-02", "coffrage", "1 armature", 1]
  );
});

test("coffrage déplié : ses armatures, avec le repère du démarrage des travaux", () => {
  const { lines } = model({ toggledKeys: new Set(["level:113", "doc:113"]) });
  const rebar = lineOf(lines, "doc:123");
  assert.deepEqual([rebar.role, rebar.level, rebar.name, rebar.id2, rebar.variant, iso(rebar.marker), rebar.expandable], [
    "rebar", 3, "PH REZ DE CHAUSSEE - DALLES", "3314", "armature", "2026-10-14", false,
  ]);
  assert.deepEqual(texts(rebar), ["retard 23 j"]);
  assert.deepEqual(texts(lineOf(lines, "doc:113")), ["retard 37 j", "1 armature en retard"]);
  const { lines: zoneLevel } = model({ toggledKeys: new Set(["doc:111"]) });
  assert.deepEqual([lineOf(zoneLevel, "doc:121").level, lineOf(zoneLevel, "doc:111").level], [2, 1], "coffrage sans étage");
});

test("étage déplié : le contenu de la vue Synthese, un cran sous l'étage", () => {
  const { lines } = model({ toggledKeys: new Set(RDC_PATH) });
  const levels = Object.fromEntries(lines.map((line) => [line.key, line.level]));
  assert.deepEqual(
    [levels["floor:zone2batb/rdc"], levels["task:401"], levels["group:416"], levels["task:417"], levels["group:419"], levels["task:420"]],
    [2, 3, 3, 4, 4, 5]
  );
  assert.equal(lineOf(lines, "group:402").collapsed, true, "cycle 1 non basculé : replié");
  assert.equal(lineOf(lines, "task:403"), undefined);
  const task = lineOf(lines, "task:420");
  assert.deepEqual([task.kind, task.role, task.service, task.taskId, task.durationLabel], ["task", "task", "synthese", 420, "198 jours"]);
  assert.equal(task.link.predId, 417, "le lien de la tâche suit, pour les flèches du Gantt");
  assert.deepEqual([lineOf(lines, "group:416").nature, lineOf(lines, "task:425").nature], ["cycle", "demarrage"]);
});

test("tâche contrôlée en retard : Fin clignotante, limite de fin, alerte remontée jusqu'à la zone", () => {
  const { lines } = model({ toggledKeys: new Set(RDC_PATH) });
  const task = lineOf(lines, "task:420");
  assert.deepEqual(task.state.parts, [{ text: "retard 103 j", tone: "late", blink: true }]);
  assert.match(task.state.title, /à finir au plus tard le Mer 19\/08\/26 \(début du plan de coffrage 3032/);
  assert.deepEqual([task.blinkEnd, task.isOverEndLimit, iso(task.endLimit), task.tone], [true, true, "2026-08-19", "late"]);
  assert.equal(lineOf(lines, "task:421").blinkEnd, false);
  for (const key of ["group:419", "group:416", "floor:zone2batb/rdc"]) {
    assert.deepEqual(lineOf(lines, key).state.parts, [{ text: "1 retard Synthèse", tone: "late", blink: true }], key);
    assert.equal(lineOf(lines, key).tone, "late", key);
  }
  const level = lineOf(lines, "level:113");
  assert.deepEqual(texts(level), ["Synthèse en retard de 103 j", "2 retards Structure"]);
  assert.equal(level.tone, "late");
  assert.match(level.state.title, /Non vérifiable : le coffrage 3032 n'a pas de date 0 Prev\./);
  const zone = lineOf(lines, "zone:zone2batb");
  assert.deepEqual(texts(zone), ["1 retard Synthèse", "2 retards Structure"]);
  assert.equal(zone.tone, "", "la barre de zone reste noire");
});

test("états sans retard : cohérent, à mettre à jour, non lié, terminé, rien", () => {
  const { lines } = model({ toggledKeys: new Set(["level:101"]) });
  assert.deepEqual(lineOf(lines, "level:112").state.parts, [{ text: "✓ cohérent", tone: "ok", blink: false }]);
  assert.deepEqual(texts(lineOf(lines, "level:101")), ["à mettre à jour"]);
  assert.deepEqual(texts(lineOf(lines, "floor:zone1batbc/ss1")), ["à mettre à jour : 0 Prev le Jeu 27/11/25"]);
  assert.deepEqual(texts(lineOf(lines, "zone:zone1batbc")), ["1 à mettre à jour"]);
  assert.deepEqual(lineOf(lines, "floor:zone2batb/rp1").state.parts, [{ text: "non lié à un coffrage", tone: "muted", blink: false }]);
  assert.deepEqual(texts(lineOf(lines, "doc:142")), ["terminé (retard 8 j)"]);
  assert.deepEqual(texts(lineOf(lines, "doc:141")), ["terminé"]);
  assert.equal(lineOf(lines, "doc:111").state, null);
  assert.equal(lineOf(lines, "task:600").state, null);
  assert.equal(lineOf(lines, "zone:").state, null);
  assert.equal(lineOf(lines, "level:112").tone, "");
});

test("zone repliée par l'utilisateur : plus que sa ligne", () => {
  const { lines } = model({ toggledKeys: new Set(["zone:zone2batb"]) });
  assert.deepEqual(keys(lines), ["zone:zone1batbc", "level:101", "zone:zone2batb", "zone:", "doc:141"]);
  assert.equal(lineOf(lines, "zone:zone2batb").collapsed, true);
});

test("« Alertes seulement » : les lignes en alerte et leurs parentes, dépliées", () => {
  const { lines, totals } = model({ alertsOnly: true });
  assert.deepEqual(keys(lines), [
    "zone:zone1batbc", "level:101", "floor:zone1batbc/ss1",
    "zone:zone2batb", "level:113", "floor:zone2batb/rdc", "group:416", "group:419", "task:420", "doc:113", "doc:123",
  ]);
  assert.equal(lines.some((line) => line.collapsed), false);
  assert.equal(totals.structure, 2, "les compteurs restent ceux du projet");
  const folded = model({ alertsOnly: true, toggledKeys: new Set(["level:113"]) }).lines;
  assert.equal(lineOf(folded, "level:113").collapsed, true, "un appui replie");
  assert.equal(lineOf(folded, "task:420"), undefined);
});

test("filtre de zone : une seule section, compteurs de cette zone", () => {
  const { lines, totals } = model({ zoneFilter: ZONE_1 });
  assert.deepEqual(keys(lines), ["zone:zone1batbc", "level:101"]);
  assert.deepEqual(totals, { linkedFloors: 1, unlinkedFloors: 0, synthese: 0, missing: 0, stale: 1, structure: 0 });
  assert.deepEqual(model({ zoneFilter: "Zone inconnue" }).lines, []);
});

// L'armature 3314 avance son démarrage des travaux au 25/02/26 : le jalon « DEMARRAGE GO RDC »
// (09/03/26) tombe 12 jours après.
test("démarrage du gros œuvre après le démarrage des travaux : seconde alerte de retard", () => {
  const rows = projectRows().map((row) => (row.id === 123 ? { ...row, Demarrages_travaux: "2026-02-25" } : row));
  const { lines, totals } = model({ toggledKeys: new Set(RDC_PATH) }, rows);
  const kickoff = lineOf(lines, "task:425");
  assert.deepEqual(kickoff.state.parts, [{ text: "retard 12 j", tone: "late", blink: true }]);
  assert.equal(kickoff.state.title, "Démarrage prévu après le démarrage des travaux de Structure (Mer 25/02/26).");
  assert.deepEqual([kickoff.blinkEnd, kickoff.tone], [true, "late"]);
  assert.deepEqual(texts(lineOf(lines, "group:416")), ["2 retards Synthèse"]);
  assert.deepEqual(texts(lineOf(lines, "level:113")), ["Synthèse en retard de 103 j", "2 retards Structure"]);
  assert.equal(totals.synthese, 2);
});

test("étage lié à un coffrage d'une autre zone, étage au coffrage introuvable", () => {
  const other = projectRows().map((row) => (row.id === 500 ? { ...row, Lien_Structure: "3031" } : row));
  const otherModel = model({}, other);
  assert.deepEqual(texts(lineOf(otherModel.lines, "floor:zone2batb/rp1")), ["lié au coffrage 3031 (Zone 1 / BAT BC)"]);
  assert.deepEqual([otherModel.totals.linkedFloors, otherModel.totals.unlinkedFloors], [4, 0]);

  const missing = projectRows().map((row) => (row.id === 400 ? { ...row, Lien_Structure: "3099" } : row));
  const missingModel = model({}, missing);
  assert.deepEqual(lineOf(missingModel.lines, "floor:zone2batb/rdc").state.parts, [
    { text: "coffrage 3099 introuvable", tone: "error", blink: false },
  ]);
  assert.deepEqual(texts(lineOf(missingModel.lines, "zone:zone2batb")), ["1 coffrage introuvable", "2 retards Structure"]);
  assert.deepEqual(missingModel.totals, { linkedFloors: 2, unlinkedFloors: 1, synthese: 0, missing: 1, stale: 1, structure: 2 });
});

test("récapitulatif d'une zone : de la première à la dernière date de son contenu", () => {
  const { lines } = model();
  const zone = lineOf(lines, "zone:zone2batb");
  assert.deepEqual([iso(zone.start), iso(zone.end), zone.durationLabel], ["2025-12-01", "2027-03-09", ""]);
  const empty = lineOf(lines, "zone:");
  assert.deepEqual([empty.start, empty.end, empty.name], [null, null, "Sans zone"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/globalRowModel.test.mjs`
Expected: FAIL — `buildGlobalRowModel is not a function`.

- [ ] **Step 3: Extend the imports**

Dans `Planning Projet/assets/js/services/globalPlanningModel.js`, remplacer tout le début du fichier — du premier commentaire jusqu'à la ligne `import { checkDocument, checkFloor } from "./globalChecks.js";` comprise — par :

```js
// Modèle de la vue Global (Planning Projet) : le planning Synthèse et le planning Structure
// d'un projet dans un même arbre de lignes. Zone → niveau (étage de Synthèse ⇄ coffrage de
// Structure) → étage et coffrage côte à côte ; les armatures sous leur coffrage ; le reste au
// niveau zone. Puis le modèle de lignes affichées, avec l'état de chaque ligne.
// Module pur, sans DOM ni Grist : il ne lit que des lignes déjà chargées et n'écrit rien.
import { buildTimelineDataFromPlanningRows } from "./planningService.js";
import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  TASK_COLUMNS,
  buildRowModel,
  buildSections,
  formatDuration,
  isSyntheseServiceRow,
  zoneKeyOf,
} from "./syntheseTaskModel.js";
import {
  applyEndLimits,
  buildStructureLink,
  controlTaskEndLimits,
  formworkLabel,
  isFormworkRow,
  readControlTasks,
} from "./structureLinkModel.js";
import { parseGristDate } from "./syntheseTasks.js";
import {
  addCounts,
  checkDocument,
  checkFloor,
  countAlerts,
  emptyCounts,
  floorState,
  formworkState,
  hasAlerts,
  levelState,
  summaryState,
  taskState,
} from "./globalChecks.js";
```

- [ ] **Step 4: Append the row model**

À la fin du même fichier, ajouter :

```js
/* ---------- Modèle de lignes ---------- */

function latest(dates) {
  const list = dates.filter((date) => date instanceof Date);
  return list.length ? new Date(Math.max(...list.map((date) => date.getTime()))) : null;
}

const NO_DATES = Object.freeze({
  start: null,
  end: null,
  durationDays: null,
  isMilestone: false,
  startsWithMilestone: false,
  endsWithMilestone: false,
});

function baseLine(fields) {
  return {
    service: "",
    zoneKey: "",
    zoneName: "",
    floorKey: "",
    groupRowId: null,
    taskId: null,
    link: null,
    nature: "",
    id2: "",
    indice: "",
    durationLabel: "",
    variant: "",
    marker: null,
    countLabel: "",
    ...NO_DATES,
    ...fields,
  };
}

function docNode(doc, role, level, zone) {
  const alert = doc.check?.alert || null;
  return {
    line: baseLine({
      key: `doc:${doc.id}`,
      kind: "doc",
      role,
      service: "structure",
      level,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: doc.name,
      id2: doc.number,
      indice: doc.indice,
      durationLabel: doc.weeks ? `${doc.weeks} sem.` : "",
      start: doc.start,
      end: doc.end,
      variant: doc.typeKey,
      marker: doc.worksStart,
    }),
    own: countAlerts(alert ? [alert] : []),
    doc,
    children: [],
  };
}

function formworkNode(head, level, zone) {
  const node = docNode(head.doc, "formwork", level, zone);
  node.children = head.rebars.map((rebar) => docNode(rebar, "rebar", level + 1, zone));
  const count = head.rebars.length;
  node.line.countLabel = count ? `${count} armature${count > 1 ? "s" : ""}` : "";
  return node;
}

// Lignes de Synthèse d'un contenu de zone (un étage, ou une tâche hors étage), toutes
// dépliées, telles que les donne le modèle de la vue Synthese — la ligne de zone en moins.
function syntheseLines(zone, items, limits) {
  const section = { zoneKey: zone.zoneKey, zoneName: zone.zoneName, label: zone.label, summary: null, items };
  return applyEndLimits(buildRowModel([section]).slice(1), limits);
}

function syntheseLine(line, level, name = line.name) {
  const summary = line.kind !== "task";
  return baseLine({
    ...line,
    role: line.kind,
    service: "synthese",
    level,
    name,
    durationLabel: summary && line.durationDays == null ? "" : formatDuration(line.durationDays),
  });
}

// Arbre d'un étage : la ligne « Synthèse · étage », puis son contenu, un cran par niveau du
// modèle Synthese. Chaque tâche en retard porte ses alertes.
function floorNode(floorEntry, level, zone, limits) {
  const lines = syntheseLines(zone, [{ kind: "floor", floor: floorEntry.floor }], limits);
  const { check } = floorEntry;
  const root = {
    line: syntheseLine(lines[0], level, `Synthèse · ${floorEntry.name}`),
    own: countAlerts(check.alerts),
    floorEntry,
    children: [],
  };
  const stack = [{ depth: lines[0].level, node: root }];
  lines.slice(1).forEach((line) => {
    while (stack.at(-1).depth >= line.level) stack.pop();
    const alerts = line.kind === "task" ? check.taskAlerts.get(line.taskId) || [] : [];
    const node = {
      line: syntheseLine(line, level + line.level - lines[0].level),
      own: countAlerts(alerts),
      alerts,
      children: [],
    };
    stack.at(-1).node.children.push(node);
    stack.push({ depth: line.level, node });
  });
  return root;
}

function levelNode(entry, zone, limits) {
  const { doc } = entry;
  return {
    line: baseLine({
      key: `level:${doc.id}`,
      kind: "level",
      role: "level",
      level: 1,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: `${entry.floors.map((floor) => floor.name).join(", ")} ⇄ ${formworkLabel({ number: doc.number, name: doc.name })}`,
    }),
    own: emptyCounts(),
    floorEntries: entry.floors,
    children: [
      ...entry.floors.map((floorEntry) => floorNode(floorEntry, 2, zone, limits)),
      formworkNode(entry, 2, zone),
    ],
  };
}

function zoneNode(zone, limits) {
  const children = zone.entries.map((entry) => {
    if (entry.kind === "level") return levelNode(entry, zone, limits);
    if (entry.kind === "formwork") return formworkNode(entry, 1, zone);
    if (entry.kind === "floor") return floorNode(entry.node, 1, zone, limits);
    if (entry.kind === "doc") return docNode(entry.doc, "doc", 1, zone);
    const [line] = syntheseLines(zone, [{ kind: "task", task: entry.task }], limits);
    return { line: syntheseLine(line, 1), own: emptyCounts(), alerts: [], children: [] };
  });
  return {
    line: baseLine({
      key: `zone:${zone.zoneKey}`,
      kind: "zone",
      role: "zone",
      level: 0,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: zone.label,
    }),
    own: emptyCounts(),
    children,
  };
}

// Compteurs d'alertes (les siennes et celles de son contenu) et étendue des dates de chaque
// nœud, de bas en haut. Zone et niveau prennent l'étendue de leur contenu.
function settle(node) {
  node.children.forEach(settle);
  node.inner = node.children.reduce((total, child) => addCounts(total, child.counts), emptyCounts());
  node.counts = addCounts(addCounts(emptyCounts(), node.own), node.inner);
  node.bounds = {
    start: earliest([node.line.start, ...node.children.map((child) => child.bounds.start)]),
    end: latest([node.line.end, ...node.children.map((child) => child.bounds.end)]),
  };
  if (node.line.kind === "zone" || node.line.kind === "level") {
    node.line.start = node.bounds.start;
    node.line.end = node.bounds.end;
  }
}

function stateOf(node) {
  const { line } = node;
  if (line.role === "zone" || line.role === "group") return summaryState(node.counts);
  if (line.role === "level") {
    return levelState({ checks: node.floorEntries.map((floorEntry) => floorEntry.check), counts: node.counts });
  }
  if (line.role === "floor") {
    const { check, link, otherZoneLabel } = node.floorEntry;
    return floorState({ check, link, counts: node.inner, otherZoneLabel });
  }
  if (line.role === "task") return taskState(node.alerts);
  if (line.role === "formwork") return formworkState({ own: node.doc.check, lateRebars: node.inner.structure });
  const { part, title } = node.doc.check;
  return part ? { parts: [part], title } : null;
}

// Les lignes affichées, dans l'ordre, avec leur état, et les compteurs de la barre d'état.
// Par défaut : zones dépliées, tout le reste replié ; `toggledKeys` porte les clés des lignes
// que l'utilisateur a basculées. `alertsOnly` : seulement les lignes en alerte et leurs
// parentes, dépliées. `zoneFilter` : le nom de la zone du bandeau ("" : toutes).
export function buildGlobalRowModel(planning, { zoneFilter = "", toggledKeys = new Set(), alertsOnly = false } = {}) {
  const filterKey = zoneKeyOf(zoneFilter);
  const zones = (planning?.zones || []).filter((zone) => !filterKey || zone.zoneKey === filterKey);
  const totals = { linkedFloors: 0, unlinkedFloors: 0, ...emptyCounts() };
  const lines = [];
  const visit = (node) => {
    if (alertsOnly && !hasAlerts(node.counts)) return;
    const expandable = node.children.length > 0;
    const collapsedByDefault = !alertsOnly && node.line.kind !== "zone";
    const collapsed = expandable && (toggledKeys.has(node.line.key) ? !collapsedByDefault : collapsedByDefault);
    const late = node.counts.synthese > 0;
    lines.push({
      ...node.line,
      collapsed,
      expandable,
      childCount: node.children.length,
      state: stateOf(node),
      // Fin clignotante sur la tâche fautive ; crochet rouge sur ce qui la contient.
      blinkEnd: node.line.role === "task" && late,
      tone: late && node.line.kind !== "zone" ? "late" : "",
    });
    if (!collapsed) node.children.forEach(visit);
  };
  zones.forEach((zone) => {
    const node = zoneNode(zone, planning.limits);
    settle(node);
    addCounts(totals, node.counts);
    zone.entries.forEach((entry) => {
      const floorEntries = entry.kind === "level" ? entry.floors : entry.kind === "floor" ? [entry.node] : [];
      floorEntries.forEach((floorEntry) => {
        if (floorEntry.check.linked) totals.linkedFloors += 1;
        else if (floorEntry.link.state === "none") totals.unlinkedFloors += 1;
      });
    });
    visit(node);
  });
  return { lines, totals };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run : `node --test tests/globalRowModel.test.mjs tests/globalPlanningModel.test.mjs`
Expected: PASS — 31 tests.

- [ ] **Step 6: Point de contrôle (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 494 tests, 0 échec.

---

### Task 4: Le Gantt sait dessiner un document Structure

**Files:**
- Modify: `Planning Projet/assets/js/services/syntheseGanttGeometry.js`
- Modify: `Planning Projet/assets/js/ui/syntheseGantt.js`
- Modify: `Planning Projet/assets/css/styles.css`
- Test: `Planning Projet/tests/globalGantt.test.mjs` (nouveau)

**Interfaces:**
- Consumes (champs des lignes de la tâche 3) : `kind: "level"` (crochet, comme un étage), `kind: "doc"` (barre), `variant` (type du document), `marker` (`Date` du démarrage des travaux), `tone: "late"`.
- Produces :
  - `MARKER_HALF_PX = 5` exporté par la géométrie.
  - `buildGanttShapes` : une barre `taskBar` porte `variant` quand la ligne en a un, et `labelX` quand son repère tombe à droite de la barre ; une forme `{ type: "marker", row, key, y, x }` par ligne qui a un `marker` ; un crochet `floorBracket` porte `tone: "late"` quand la ligne (hors zone) l'a ; une tâche de ton `late` est dessinée `overLimit`.
  - Classes SVG : `stg-task--<variant>`, `stg-marker`, `stg-floor is-late`.
- Contrainte : une ligne de la vue Synthese n'a ni `variant`, ni `marker`, ni `tone` — ses formes gardent exactement les mêmes clés qu'avant (un test le vérifie). Dans `syntheseGantt.js`, l'expression `shape.overLimit ? "stg-task is-over-limit" : "stg-task"` doit rester telle quelle : `tests/syntheseGantt.test.mjs` la cherche mot pour mot.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/globalGantt.test.mjs` :

```js
// Gantt de la vue Global : les ajouts au Gantt de la vue Synthese — barre de document colorée
// par type, repère du démarrage des travaux, crochet de niveau, formes en alerte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildGanttLinks, buildGanttShapes, createTimeScale } from "../assets/js/services/syntheseGanttGeometry.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const source = await readFile(new URL("../assets/js/ui/syntheseGantt.js", import.meta.url), "utf8");

// Semaine du lundi 14/09/26 sur 700 px : 100 px par jour, le 14 à x = 0.
const scale = createTimeScale({ start: new Date(2026, 8, 14), end: new Date(2026, 8, 21), width: 700 });
const day = (date) => new Date(2026, 8, date);
const doc = (key, fields = {}) => ({
  key, kind: "doc", role: "doc", name: "PH RDC - COF", start: null, end: null, isMilestone: false, variant: "coffrage", marker: null, ...fields,
});

test("document Structure : une barre du Début à la Fin, à la couleur de son type", () => {
  const [bar] = buildGanttShapes([doc("doc:1", { start: day(15), end: day(16) })], scale);
  assert.deepEqual(bar, { type: "taskBar", row: 0, key: "doc:1", y: 0, x1: 100, x2: 300, label: "PH RDC - COF", variant: "coffrage" });
});

test("démarrage des travaux : un repère au milieu de son jour, même sans barre", () => {
  const shapes = buildGanttShapes([
    doc("doc:1", { start: day(15), end: day(16), marker: day(18), variant: "armature" }),
    doc("doc:2", { marker: day(17) }),
    doc("doc:3"),
  ], scale);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.row, shape.x ?? shape.x1]), [
    ["taskBar", 0, 100],
    ["marker", 0, 450],
    ["marker", 1, 350],
  ]);
  assert.deepEqual(shapes[1], { type: "marker", row: 0, key: "doc:1", y: 0, x: 450 });
  assert.equal(shapes[0].labelX, 455, "le nom de la barre se place après le repère");
});

test("repère dans la barre ou avant elle : le nom reste au bout de la barre", () => {
  const [bar] = buildGanttShapes([doc("doc:1", { start: day(15), end: day(18), marker: day(16) })], scale);
  assert.equal("labelX" in bar, false);
});

test("pas de flèche entre documents Structure", () => {
  const lines = [
    doc("doc:1", { start: day(15), end: day(15) }),
    doc("doc:2", { start: day(16), end: day(17) }),
  ];
  assert.deepEqual(buildGanttLinks(lines, scale), []);
});

test("niveau lié : un crochet, de la première à la dernière date de son contenu", () => {
  const [bracket] = buildGanttShapes([
    { key: "level:113", kind: "level", name: "RDC ⇄ 3032", start: day(15), end: day(17) },
  ], scale);
  assert.deepEqual(bracket, { type: "floorBracket", row: 0, key: "level:113", y: 0, x1: 100, x2: 400, label: "RDC ⇄ 3032" });
});

test("en alerte : crochets du niveau, de l'étage et du cycle en rouge ; la barre de zone reste noire", () => {
  const summary = (kind) => ({ key: `${kind}:1`, kind, name: kind, start: day(15), end: day(17), tone: "late" });
  const shapes = buildGanttShapes(["level", "floor", "group", "zone"].map(summary), scale);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.tone ?? null]), [
    ["floorBracket", "late"], ["floorBracket", "late"], ["floorBracket", "late"], ["zoneBar", null],
  ]);
});

test("tâche en retard sans limite de fin (jalon de démarrage) : dessinée en alerte", () => {
  const task = (fields) => ({ key: "task:1", kind: "task", taskId: 1, name: "DEMARRAGE GO", start: day(16), end: day(16), isMilestone: true, link: null, ...fields });
  assert.equal(buildGanttShapes([task({ tone: "late" })], scale)[0].overLimit, true);
  assert.equal("overLimit" in buildGanttShapes([task({})], scale)[0], false);
  assert.equal("overLimit" in buildGanttShapes([doc("doc:1", { start: day(15), end: day(16), tone: "late" })], scale)[0], false);
});

test("vue Synthese inchangée : ni couleur de type, ni ton, ni repère sur ses lignes", () => {
  const shapes = buildGanttShapes([
    { key: "floor:z/f", kind: "floor", name: "SS1", start: day(15), end: day(17) },
    { key: "task:1", kind: "task", taskId: 1, name: "Visa", start: day(15), end: day(16), isMilestone: false, link: null },
  ], scale);
  assert.deepEqual(shapes.map((shape) => Object.keys(shape).sort().join(",")), [
    "key,label,row,type,x1,x2,y",
    "key,label,row,type,x1,x2,y",
  ]);
});

test("dessin : classe du type sur la barre, triangle du repère, crochet en alerte", () => {
  assert.match(source, /const barClass = shape\.overLimit \? "stg-task is-over-limit" : "stg-task";/);
  assert.match(source, /class: shape\.variant \? `\$\{barClass\} stg-task--\$\{shape\.variant\}` : barClass,/);
  assert.match(source, /shape\.type === "marker"/);
  assert.match(source, /x: px\(\(shape\.labelX \?\? shape\.x2\) \+ LABEL_GAP_PX\)/);
  assert.match(source, /import \{[^}]*\bMARKER_HALF_PX\b[^}]*\} from "\.\.\/services\/syntheseGanttGeometry\.js";/);
  assert.match(source, /class: "stg-marker"/);
  assert.match(source, /class: shape\.tone === "late" \? "stg-floor is-late" : "stg-floor",/);
});

test("couleurs : celles des barres du planning Structure, repère noir, crochet rouge", () => {
  assert.match(css, /\.stg-task--coffrage\s*\{[^}]*fill:\s*#fde68a;[^}]*stroke:\s*#d6bd74;/);
  assert.match(css, /\.stg-task--armature\s*\{[^}]*fill:\s*#d1d5db;[^}]*stroke:\s*#94a3b8;/);
  assert.match(css, /\.stg-task--ndc\s*\{[^}]*fill:\s*#c9c0de;/);
  assert.match(css, /\.stg-task--coupes\s*\{[^}]*fill:\s*#b8e8d0;/);
  assert.match(css, /\.stg-task--demolition\s*\{[^}]*fill:\s*#f5cfcf;/);
  assert.match(css, /\.stg-task--autre\s*\{[^}]*fill:\s*#dad4ff;/);
  assert.match(css, /\.stg-marker\s*\{[^}]*fill:\s*#1f1f1f;/);
  assert.match(css, /\.stg-floor\.is-late\s*\{[^}]*stroke:\s*#c00000;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/globalGantt.test.mjs`
Expected: FAIL — la barre n'a pas de `variant`, aucune forme `marker`, styles absents.

- [ ] **Step 3: Extend the geometry**

Dans `Planning Projet/assets/js/services/syntheseGanttGeometry.js`, appliquer ces changements avec l'outil Edit (bloc par bloc ; ne pas utiliser `git apply`) :

```diff
--- a/Planning Projet/assets/js/services/syntheseGanttGeometry.js
+++ b/Planning Projet/assets/js/services/syntheseGanttGeometry.js
@@ -13,6 +13,8 @@ export const MIN_PX_PER_DAY_FOR_OFF_DAYS = 6;
 // Formes dans une ligne de 26 px (partagées avec le dessin) et écart des flèches.
 export const TASK_BAR_HEIGHT_PX = 14;
 export const MILESTONE_HALF_PX = 6;
+// Demi-largeur du repère « Démarrage travaux » d'un document Structure (vue Global).
+export const MARKER_HALF_PX = 5;
 // Couloir des flèches : les traits verticaux passent à LINK_GAP_PX du bout d'une barre, et
 // son libellé commence à LABEL_GAP_PX, si bien que le couloir reste libre.
 export const LINK_GAP_PX = 5;
@@ -79,9 +81,10 @@ function milestoneX(line, scale) {
   return scale.dateToX(line.link?.type === "FD" ? dayEnd(line.start) : dayCenter(line.start));
 }
 
-// Tâche dont la Fin dépasse sa limite : sa forme le porte, pour être dessinée en alerte.
+// Tâche en retard : sa forme le porte, pour être dessinée en alerte — Fin au-delà de sa
+// limite, ou retard signalé par la vue Global (ton « late »).
 function overLimitOf(line) {
-  return line.isOverEndLimit ? { overLimit: true } : {};
+  return line.isOverEndLimit || (line.kind === "task" && line.tone === "late") ? { overLimit: true } : {};
 }
 
 // Une forme par ligne datée du modèle de lignes, à la hauteur de sa ligne. Les lignes
@@ -91,9 +94,9 @@ export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {
   (lines || []).forEach((line, row) => {
     if (!(line?.start instanceof Date) || !(line?.end instanceof Date)) return;
     const y = row * rowHeight;
-    // Zone (barre noire), étage, cycle et sous-groupe (crochet) : du Début à la Fin du
-    // récapitulatif, au centre du jour quand il commence ou finit par un jalon.
-    if (line.kind === "zone" || line.kind === "floor" || line.kind === "group") {
+    // Zone (barre noire), étage, cycle, sous-groupe et niveau de la vue Global (crochet) : du
+    // Début à la Fin du récapitulatif, au centre du jour quand il commence ou finit par un jalon.
+    if (line.kind === "zone" || line.kind === "floor" || line.kind === "group" || line.kind === "level") {
       const from = line.startsWithMilestone ? dayCenter(line.start) : dayStart(line.start);
       const to = line.endsWithMilestone ? dayCenter(line.end) : dayEnd(line.end);
       const x1 = scale.dateToX(from);
@@ -105,6 +108,8 @@ export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {
         x1,
         x2: Math.max(scale.dateToX(to), x1 + MIN_BAR_WIDTH_PX),
         label: line.name,
+        // Crochet en alerte (vue Global) : il contient une tâche en retard.
+        ...(line.kind !== "zone" && line.tone === "late" ? { tone: "late" } : {}),
       });
       return;
     }
@@ -122,15 +127,21 @@ export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {
       return;
     }
     const x1 = scale.dateToX(dayStart(line.start));
+    const x2 = Math.max(scale.dateToX(dayEnd(line.end)), x1 + MIN_BAR_WIDTH_PX);
+    // Repère « Démarrage travaux » à droite de la barre : le libellé se place après lui.
+    const markerEnd = line.marker instanceof Date ? scale.dateToX(dayCenter(line.marker)) + MARKER_HALF_PX : null;
     shapes.push({
       type: "taskBar",
       row,
       key: line.key,
       y,
       x1,
-      x2: Math.max(scale.dateToX(dayEnd(line.end)), x1 + MIN_BAR_WIDTH_PX),
+      x2,
       label: line.name,
       ...overLimitOf(line),
+      // Document Structure (vue Global) : sa barre prend la couleur de son type.
+      ...(line.variant ? { variant: line.variant } : {}),
+      ...(markerEnd != null && markerEnd > x2 ? { labelX: markerEnd } : {}),
     });
   });
   // Limite de fin d'une tâche (plan de réservations du cycle 3) : un repère à la fin de son
@@ -147,6 +158,12 @@ export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {
       overLimit: Boolean(line.isOverEndLimit),
     });
   });
+  // Démarrage des travaux d'un document Structure (vue Global) : un repère au milieu de son
+  // jour, même pour un document sans barre.
+  (lines || []).forEach((line, row) => {
+    if (!(line?.marker instanceof Date)) return;
+    shapes.push({ type: "marker", row, key: line.key, y: row * rowHeight, x: scale.dateToX(dayCenter(line.marker)) });
+  });
   return shapes;
 }
```

- [ ] **Step 4: Extend the drawing**

Dans `Planning Projet/assets/js/ui/syntheseGantt.js` :

```diff
--- a/Planning Projet/assets/js/ui/syntheseGantt.js
+++ b/Planning Projet/assets/js/ui/syntheseGantt.js
@@ -5,6 +5,7 @@
 // Lecture seule : les dates se modifient dans le tableau.
 import {
   LABEL_GAP_PX,
+  MARKER_HALF_PX,
   MILESTONE_HALF_PX,
   ROW_HEIGHT_PX,
   TASK_BAR_HEIGHT_PX,
@@ -143,16 +144,28 @@ export function createSyntheseGantt({ headHost, layerHost, interactionHost, rowH
         y2: px(shape.y + rowHeight - LIMIT_INSET_PX),
       })];
     }
+    // Démarrage des travaux d'un document Structure : un triangle, pointe en bas.
+    if (shape.type === "marker") {
+      return [svgElement("polygon", {
+        class: "stg-marker",
+        points: toPoints([
+          [shape.x - MARKER_HALF_PX, middle - MARKER_HALF_PX],
+          [shape.x + MARKER_HALF_PX, middle - MARKER_HALF_PX],
+          [shape.x, middle + MARKER_HALF_PX],
+        ]),
+      })];
+    }
     if (shape.type === "taskBar") {
+      const barClass = shape.overLimit ? "stg-task is-over-limit" : "stg-task";
       return [
         svgElement("rect", {
-          class: shape.overLimit ? "stg-task is-over-limit" : "stg-task",
+          class: shape.variant ? `${barClass} stg-task--${shape.variant}` : barClass,
           x: px(shape.x1),
           y: px(middle - TASK_BAR_HEIGHT_PX / 2),
           width: px(shape.x2 - shape.x1),
           height: TASK_BAR_HEIGHT_PX,
         }),
-        svgElement("text", { class: "stg-label", x: px(shape.x2 + LABEL_GAP_PX), y: px(baseline) }, shape.label),
+        svgElement("text", { class: "stg-label", x: px((shape.labelX ?? shape.x2) + LABEL_GAP_PX), y: px(baseline) }, shape.label),
       ];
     }
     if (shape.type === "milestone") {
@@ -181,7 +194,7 @@ export function createSyntheseGantt({ headHost, layerHost, interactionHost, rowH
       const top = shape.y + FLOOR_BRACKET_TOP_PX;
       return [
         svgElement("polyline", {
-          class: "stg-floor",
+          class: shape.tone === "late" ? "stg-floor is-late" : "stg-floor",
           points: toPoints([
             [shape.x1, top + FLOOR_TICK_PX],
             [shape.x1, top],
```

- [ ] **Step 5: Add the Gantt styles**

Dans `Planning Projet/assets/css/styles.css`, juste après la règle `.stg-link-head { fill: #3b9bb0; }` (et donc avant le commentaire `/* ARCHIVE vue Synthese v1 (jusqu'à la fin du fichier)`), insérer :

```css
/* Vue Global : un document Structure prend la couleur de la barre de son type dans le planning
   Structure ; un triangle marque son démarrage des travaux ; le crochet d'un niveau, d'un
   étage ou d'un cycle qui contient un retard passe au rouge. */
.stg-task--coffrage {
  fill: #fde68a;
  stroke: #d6bd74;
}

.stg-task--armature {
  fill: #d1d5db;
  stroke: #94a3b8;
}

.stg-task--ndc {
  fill: #c9c0de;
  stroke: #8f83b0;
}

.stg-task--coupes {
  fill: #b8e8d0;
  stroke: #2da862;
}

.stg-task--demolition {
  fill: #f5cfcf;
  stroke: #a80000;
}

.stg-task--autre {
  fill: #dad4ff;
  stroke: #6858e0;
}

.stg-marker {
  fill: #1f1f1f;
}

.stg-floor.is-late {
  stroke: #c00000;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run : `node --test tests/globalGantt.test.mjs tests/syntheseGantt.test.mjs tests/syntheseGanttGeometry.test.mjs tests/syntheseGanttLinks.test.mjs tests/syntheseGanttEvents.test.mjs tests/syntheseGanttScale.test.mjs`
Expected: PASS — les 10 nouveaux tests, et tous les tests du Gantt de la vue Synthese.

- [ ] **Step 7: Point de contrôle (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 504 tests, 0 échec.

---

### Task 5: Le tableau en lecture seule (`globalPlanningTable.js`)

**Files:**
- Create: `Planning Projet/assets/js/ui/globalPlanningTable.js`
- Test: `Planning Projet/tests/globalPlanningTable.test.mjs` (nouveau)

**Interfaces:**
- Consumes:
  - Les lignes de `buildGlobalRowModel` (tâche 3) et `describeCounts(totals)` (tâche 1).
  - `formatDate(date)` de `services/syntheseTaskModel.js`.
  - La fabrique du Gantt, injectée : `createGantt({ headHost, layerHost, interactionHost, rowHeight }) → { render(lines), resize() }` (c'est `createSyntheseGantt`, branché à la tâche 7).
  - Le DOM de test `tests/helpers/fakeDom.mjs` (`FakeElement`, `createFakeEnvironment`, `dispatch`) : il connaît `createElement`, `className`, `classList.add/remove/contains`, `appendChild`, `replaceChildren`, `setAttribute/getAttribute`, `dataset`, `style` (objet simple), `addEventListener/removeEventListener`, `closest(".classe")`, `setPointerCapture`. Il ne connaît ni `append`, ni `querySelector`, ni `style.setProperty` : le module n'utilise que ce qui précède (et `style.setProperty?.(...)`).
- Produces :
  - `createGlobalPlanningTable(host, { onToggle, onToggleAlertsOnly, onRefresh }, { createGantt, doc, win, storage }) → { render(lines, { emptyMessage, totals, alertsOnly, notice }) }`. `onToggle(lineKey)` ; les deux autres sans argument.
  - `buildLineElement(line, doc)`, `buildStateCell(line, doc)`, `COLUMNS`, `DEFAULT_LEFT_WIDTH = 980`, `MIN_LEFT_WIDTH = 560`.
  - Classes : racine `stt gpl` ; ligne `stt-line gpl-line gpl-line--<role>` (+ `is-nature-<nature>`, `is-type-<variant>`, `is-milestone`) ; cellules `stt-cell stt-cell--<name|id2|indice|duration|start|end|state>` ; Fin en retard `is-late is-blink` ; parts d'état `gpl-state__part is-tone-<ton>` (+ `is-blink`), séparateur `gpl-state__sep` ; nombre d'armatures `gpl-count` ; barre `gpl-bar`, `gpl-bar__counts`, `gpl-bar__notice`, `gpl-bar__button` (+ `is-active`).

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/globalPlanningTable.test.mjs` :

```js
// Tableau de la vue Global : rendu des lignes et de leur état, clignotement, replis, barre
// d'état, séparateur — et rien qui permette de modifier.
import test from "node:test";
import assert from "node:assert/strict";

import {
  COLUMNS,
  DEFAULT_LEFT_WIDTH,
  MIN_LEFT_WIDTH,
  buildLineElement,
  buildStateCell,
  createGlobalPlanningTable,
} from "../assets/js/ui/globalPlanningTable.js";
import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";

const day = (year, month, date) => new Date(year, month - 1, date);

// Descendants portant une classe, dans l'ordre du document.
function all(node, className) {
  const found = [];
  const visit = (element) => {
    if (element.classes?.has(className)) found.push(element);
    element.children.forEach(visit);
  };
  visit(node);
  return found;
}
const one = (node, className) => all(node, className)[0];
const cellText = (element, field) => one(element, `stt-cell--${field}`).textContent;

function line(fields = {}) {
  return {
    key: "task:420", kind: "task", role: "task", service: "synthese", level: 5, name: "PLAN DE SYNTHESE RESEAUX NIV RDC",
    id2: "", indice: "", durationLabel: "198 jours", start: day(2026, 2, 17), end: day(2026, 11, 30), isMilestone: false,
    nature: "", variant: "", countLabel: "", expandable: false, collapsed: false, state: null, blinkEnd: false, tone: "",
    ...fields,
  };
}
const LATE = { parts: [{ text: "retard 103 j", tone: "late", blink: true }], title: "Fin trop tardive : à finir au plus tard le Mer 19/08/26." };
const LINES = [
  line({ key: "zone:z2", kind: "zone", role: "zone", service: "", level: 0, name: "Zone 2 / BAT B", durationLabel: "", expandable: true,
    state: { parts: [{ text: "1 retard Synthèse", tone: "late", blink: true }, { text: "2 retards Structure", tone: "error", blink: false }], title: "" } }),
  line({ key: "level:113", kind: "level", role: "level", service: "", level: 1, name: "RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF", durationLabel: "",
    expandable: true, collapsed: true, tone: "late" }),
  line({ state: LATE, blinkEnd: true, tone: "late", endLimitNote: "Fin trop tardive : à finir au plus tard le Mer 19/08/26." }),
  line({ key: "doc:113", kind: "doc", role: "formwork", service: "structure", level: 2, name: "PH REZ DE CHAUSSEE - COF", id2: "3032",
    indice: "A", durationLabel: "2 sem.", start: day(2026, 8, 19), end: day(2026, 9, 2), variant: "coffrage", countLabel: "1 armature",
    expandable: true, collapsed: true }),
  line({ key: "doc:141", kind: "doc", role: "doc", service: "structure", level: 1, name: "Note d'hypothèses générales", id2: "3999",
    indice: "0", durationLabel: "", start: null, end: null, variant: "ndc",
    state: { parts: [{ text: "terminé", tone: "muted", blink: false }], title: "" } }),
];
const TOTALS = { linkedFloors: 3, unlinkedFloors: 1, synthese: 1, missing: 0, stale: 1, structure: 2 };

function setup({ stored = null, clientWidth = 0 } = {}) {
  const { doc, win } = createFakeEnvironment();
  const host = new FakeElement("section");
  const calls = { toggles: [], alerts: 0, refresh: 0, ganttRenders: [], ganttResizes: 0, ganttHosts: null, stored: [] };
  const storage = {
    getItem: () => stored,
    setItem: (key, value) => calls.stored.push([key, value]),
  };
  const table = createGlobalPlanningTable(host, {
    onToggle: (key) => calls.toggles.push(key),
    onToggleAlertsOnly: () => { calls.alerts += 1; },
    onRefresh: () => { calls.refresh += 1; },
  }, {
    doc,
    win,
    storage,
    createGantt: (hosts) => {
      calls.ganttHosts = hosts;
      return { render: (lines) => calls.ganttRenders.push(lines), resize: () => { calls.ganttResizes += 1; } };
    },
  });
  const root = host.children[0];
  root.clientWidth = clientWidth;
  return { host, root, table, calls, body: one(root, "stt-body") };
}

test("colonnes : celles du tableau Synthese, plus « État »", () => {
  assert.deepEqual(COLUMNS.map((column) => column.label), ["Nom", "N°", "Indice", "Durée", "Début", "Fin", "État"]);
  const { root } = setup();
  const head = one(root, "stt-line--head");
  assert.deepEqual(all(head, "stt-cell").map((cell) => cell.textContent), ["Nom", "N°", "Indice", "Durée", "Début", "Fin", "État"]);
  assert.ok(root.classes.has("stt") && root.classes.has("gpl"));
  assert.equal(one(root, "stt-scroll").getAttribute("aria-readonly"), "true");
});

test("une ligne : ses cellules, ses classes de rôle et de type, son retrait par niveau", () => {
  const element = buildLineElement(LINES[3], createFakeEnvironment().doc);
  assert.deepEqual(["stt-line", "gpl-line", "gpl-line--formwork", "is-type-coffrage"].every((name) => element.classes.has(name)), true);
  assert.deepEqual([element.dataset.lineKey, element.getAttribute("aria-level"), element.getAttribute("aria-expanded")], ["doc:113", "3", "false"]);
  assert.deepEqual(
    ["id2", "indice", "duration", "start", "end"].map((field) => cellText(element, field)),
    ["3032", "A", "2 sem.", "Mer 19/08/26", "Mer 02/09/26"]
  );
  const name = one(element, "stt-cell--name");
  assert.equal(one(name, "stt-text").textContent, "PH REZ DE CHAUSSEE - COF");
  assert.equal(one(name, "gpl-count").textContent, "1 armature");
  assert.equal(name.style.paddingLeft, "36px", "4 + 2 niveaux de 16 px, triangle compris dans la cellule");
  assert.ok(one(element, "stt-right"), "emplacement de la ligne dans le Gantt");
});

test("triangle de repli : seulement sur une ligne qui a un contenu, jamais grisé par le contexte partagé", () => {
  const { doc } = createFakeEnvironment();
  const folded = one(buildLineElement(LINES[1], doc), "stt-toggle");
  assert.deepEqual([folded.textContent, folded.getAttribute("aria-label"), folded.type], [
    "▸", "Déplier RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF", "button",
  ]);
  assert.equal(folded.dataset.serviceContextNavigation, "");
  const open = one(buildLineElement(LINES[0], doc), "stt-toggle");
  assert.deepEqual([open.textContent, open.getAttribute("aria-label")], ["▾", "Replier Zone 2 / BAT B"]);
  const leaf = buildLineElement(LINES[2], doc);
  assert.equal(one(leaf, "stt-toggle"), undefined);
  assert.equal(leaf.getAttribute("aria-expanded"), null);
  assert.equal(one(leaf, "stt-cell--name").style.paddingLeft, "106px", "4 + 5 × 16 + 22 à la place du triangle");
});

test("retard de la Synthèse : la Fin clignote en rouge, la limite au survol", () => {
  const { doc } = createFakeEnvironment();
  const end = one(buildLineElement(LINES[2], doc), "stt-cell--end");
  assert.ok(end.classes.has("is-late") && end.classes.has("is-blink"));
  assert.equal(end.title, "Fin trop tardive : à finir au plus tard le Mer 19/08/26.");
  const calm = one(buildLineElement(LINES[3], doc), "stt-cell--end");
  assert.equal(calm.classes.has("is-blink"), false);
  assert.equal(calm.title, undefined);
});

test("cellule État : une part par alerte, son ton, son clignotement, l'explication au survol", () => {
  const { doc } = createFakeEnvironment();
  const zone = buildStateCell(LINES[0], doc);
  const parts = all(zone, "gpl-state__part");
  assert.deepEqual(parts.map((part) => part.textContent), ["1 retard Synthèse", "2 retards Structure"]);
  assert.deepEqual(parts.map((part) => [part.classes.has("is-tone-late"), part.classes.has("is-tone-error"), part.classes.has("is-blink")]), [
    [true, false, true],
    [false, true, false],
  ]);
  assert.equal(all(zone, "gpl-state__sep").length, 1);
  assert.equal(zone.title, "1 retard Synthèse · 2 retards Structure", "sans explication : le texte lui-même");
  assert.equal(buildStateCell(LINES[2], doc).title, "Fin trop tardive : à finir au plus tard le Mer 19/08/26.");
  const empty = buildStateCell(LINES[1], doc);
  assert.deepEqual([empty.children.length, empty.title], [0, undefined]);
});

test("dates absentes : cellules vides ; nature et jalon : classes de couleur de la vue Synthese", () => {
  const { doc } = createFakeEnvironment();
  const ndc = buildLineElement(LINES[4], doc);
  assert.deepEqual([cellText(ndc, "start"), cellText(ndc, "end"), cellText(ndc, "duration")], ["", "", ""]);
  const kickoff = buildLineElement(line({ nature: "demarrage", isMilestone: true }), doc);
  assert.ok(kickoff.classes.has("is-nature-demarrage") && kickoff.classes.has("is-milestone"));
});

test("rendu : une ligne du tableau par ligne du modèle, les mêmes au Gantt", () => {
  const { table, calls, body, root } = setup();
  table.render(LINES, { totals: TOTALS });
  assert.deepEqual(body.children.map((element) => element.dataset.lineKey), ["zone:z2", "level:113", "task:420", "doc:113", "doc:141"]);
  assert.equal(calls.ganttRenders.at(-1), LINES);
  assert.deepEqual(Object.keys(calls.ganttHosts).sort(), ["headHost", "interactionHost", "layerHost", "rowHeight"]);
  assert.equal(calls.ganttHosts.rowHeight, 26);
  assert.ok(calls.ganttHosts.interactionHost.classes.has("stt-scroll"));
  assert.equal(one(root, "stt-empty").hidden, true);
  assert.equal(body.hidden, false);
});

test("lecture seule : aucune cellule modifiable, aucune poignée, aucun menu", () => {
  const { table, root } = setup();
  table.render(LINES, { totals: TOTALS });
  assert.equal(all(root, "is-editable").length, 0);
  assert.equal(all(root, "stt-grip").length, 0);
  assert.equal(all(root, "stt-menu").length, 0);
  assert.equal(all(root, "stt-input").length, 0);
  assert.equal(all(root, "stt-cell").some((cell) => cell.tabIndex != null), false);
});

test("clic sur un triangle : repli demandé pour sa ligne ; clic ailleurs : rien", () => {
  const { table, calls, body } = setup();
  table.render(LINES, { totals: TOTALS });
  dispatch(one(body.children[1], "stt-toggle"), "click");
  assert.deepEqual(calls.toggles, ["level:113"]);
  dispatch(one(body.children[2], "stt-cell--end"), "click");
  dispatch(one(body.children[1], "stt-text"), "click");
  assert.deepEqual(calls.toggles, ["level:113"]);
});

test("barre d'état : compteurs, « Alertes seulement », « Actualiser », relecture en échec", () => {
  const { table, calls, root } = setup();
  table.render(LINES, { totals: TOTALS });
  assert.equal(one(root, "gpl-bar__counts").textContent, "3 étages liés · 1 non lié · 1 retard Synthèse · 1 à mettre à jour · 2 retards Structure");
  const [alerts, refresh] = all(root, "gpl-bar__button");
  assert.deepEqual([alerts.textContent, refresh.textContent], ["Alertes seulement", "Actualiser"]);
  assert.deepEqual([alerts.getAttribute("aria-pressed"), alerts.classes.has("is-active")], ["false", false]);
  assert.deepEqual([alerts.dataset.serviceContextNavigation, refresh.dataset.serviceContextNavigation], ["", ""]);
  assert.equal(one(root, "gpl-bar__notice").hidden, true);
  dispatch(alerts, "click");
  dispatch(refresh, "click");
  assert.deepEqual([calls.alerts, calls.refresh], [1, 1]);

  table.render(LINES, { totals: TOTALS, alertsOnly: true, notice: "La dernière relecture a échoué." });
  assert.deepEqual([alerts.getAttribute("aria-pressed"), alerts.classes.has("is-active")], ["true", true]);
  const notice = one(root, "gpl-bar__notice");
  assert.deepEqual([notice.textContent, notice.hidden], ["La dernière relecture a échoué.", false]);
  table.render(LINES, { totals: TOTALS });
  assert.deepEqual([alerts.classes.has("is-active"), notice.hidden], [false, true]);
});

test("message à la place des lignes : tableau vide, Gantt vide, compteurs effacés", () => {
  const { table, calls, body, root } = setup();
  table.render(LINES, { totals: TOTALS });
  table.render(LINES, { emptyMessage: "Chargement du planning global…" });
  const empty = one(root, "stt-empty");
  assert.deepEqual([empty.textContent, empty.hidden, body.hidden, body.children.length], ["Chargement du planning global…", false, true, 0]);
  assert.deepEqual(calls.ganttRenders.at(-1), []);
  assert.equal(one(root, "gpl-bar__counts").textContent, "");
  table.render(null, {});
  assert.deepEqual([body.children.length, body.hidden], [0, false]);
});

test("séparateur : glisser change la largeur du tableau et la mémorise", () => {
  const { root, calls } = setup();
  const splitter = one(root, "stt-splitter");
  assert.equal(splitter.getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH));
  const resizes = calls.ganttResizes;
  dispatch(splitter, "pointerdown", { button: 0, clientX: 500, pointerId: 1 });
  assert.ok(root.classes.has("is-resizing"));
  dispatch(splitter, "pointermove", { clientX: 440, pointerId: 1 });
  assert.equal(splitter.getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH - 60));
  assert.deepEqual(calls.stored, [], "rien n'est mémorisé avant le relâchement");
  dispatch(splitter, "pointerup", { pointerId: 1 });
  assert.equal(root.classes.has("is-resizing"), false);
  assert.deepEqual(calls.stored, [["planning-projet.global-planning.left-width", String(DEFAULT_LEFT_WIDTH - 60)]]);
  assert.ok(calls.ganttResizes > resizes, "le Gantt suit la largeur");
  dispatch(splitter, "pointermove", { clientX: 100, pointerId: 1 });
  assert.equal(splitter.getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH - 60), "glisser terminé : plus d'effet");
});

test("séparateur : bornes, clavier, largeur mémorisée reprise", () => {
  const { root, calls } = setup({ stored: "700" });
  const splitter = one(root, "stt-splitter");
  assert.equal(splitter.getAttribute("aria-valuenow"), "700");
  dispatch(splitter, "keydown", { key: "ArrowRight" });
  assert.equal(splitter.getAttribute("aria-valuenow"), "724");
  dispatch(splitter, "keydown", { key: "Enter" });
  assert.deepEqual(calls.stored, [["planning-projet.global-planning.left-width", "724"]]);
  dispatch(splitter, "pointerdown", { button: 0, clientX: 800, pointerId: 2 });
  dispatch(splitter, "pointermove", { clientX: 0, pointerId: 2 });
  assert.equal(splitter.getAttribute("aria-valuenow"), String(MIN_LEFT_WIDTH), "jamais plus étroit que le minimum");
  dispatch(splitter, "pointerup", { pointerId: 2 });
  dispatch(splitter, "pointerdown", { button: 2, clientX: 0, pointerId: 3 });
  assert.equal(root.classes.has("is-resizing"), false, "bouton droit : pas de glisser");

  const wide = setup({ clientWidth: 1000 });
  wide.table.render([], {});
  assert.equal(DEFAULT_LEFT_WIDTH, 980);
  assert.equal(one(wide.root, "stt-splitter").getAttribute("aria-valuenow"), "840", "le Gantt garde au moins 160 px");
  assert.equal(one(setup({ stored: "abc" }).root, "stt-splitter").getAttribute("aria-valuenow"), String(DEFAULT_LEFT_WIDTH));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/globalPlanningTable.test.mjs`
Expected: FAIL — `Cannot find module '…/assets/js/ui/globalPlanningTable.js'`.

- [ ] **Step 3: Write the implementation**

Créer `Planning Projet/assets/js/ui/globalPlanningTable.js` :

```js
// Tableau de la vue Global (Planning Projet) : les lignes du planning fusionné Synthèse +
// Structure, en lecture seule. Même mise en page que le tableau de tâches de la vue Synthese
// (en-tête collant, hauteur de ligne fixe, panneau droit réservé au Gantt, séparateur
// déplaçable), avec une colonne « État » et une barre d'état. Aucune saisie, aucun menu : il
// signale seulement les replis et les deux boutons de la barre. Ses dépendances sont
// injectées (document, fenêtre, stockage, fabrique du Gantt) : doublures en test.
import { formatDate } from "../services/syntheseTaskModel.js";
import { describeCounts } from "../services/globalChecks.js";

const LEFT_WIDTH_STORAGE_KEY = "planning-projet.global-planning.left-width";
// Largeur par défaut du tableau : un nom lisible, les cinq colonnes du tableau Synthese et
// l'état (voir --gpl-col-state dans styles.css).
export const DEFAULT_LEFT_WIDTH = 980;
export const MIN_LEFT_WIDTH = 560;
const MIN_RIGHT_WIDTH = 160;
// Hauteur d'une ligne, identique à --stt-row-height (styles.css) : le Gantt s'aligne dessus.
const ROW_HEIGHT_PX = 26;
const KEYBOARD_STEP_PX = 24;
// Retrait du nom : un cran par niveau ; une ligne sans triangle garde la place du triangle.
const INDENT_PX = 16;
const NAME_PADDING_PX = 4;
const TOGGLE_SPACE_PX = 22;
export const COLUMNS = Object.freeze([
  { field: "name", label: "Nom" },
  { field: "id2", label: "N°" },
  { field: "indice", label: "Indice" },
  { field: "duration", label: "Durée" },
  { field: "start", label: "Début" },
  { field: "end", label: "Fin" },
  { field: "state", label: "État" },
]);

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// L'élément portant la classe, à partir de la cible d'un évènement (un nœud de texte n'a pas
// de closest : on part de son parent).
function closestOf(target, className) {
  const element = typeof target?.closest === "function" ? target : target?.parentElement;
  return element?.closest?.(`.${className}`) || null;
}

function dateText(date) {
  return date instanceof Date ? formatDate(date) : "";
}

function textCell(doc, field, text) {
  const cell = createElement(doc, "div", `stt-cell stt-cell--${field}`, text || "");
  cell.setAttribute("role", "gridcell");
  return cell;
}

function buildNameCell(line, doc) {
  const cell = createElement(doc, "div", "stt-cell stt-cell--name");
  cell.setAttribute("role", "gridcell");
  cell.title = line.name;
  cell.style.paddingLeft = `${NAME_PADDING_PX + line.level * INDENT_PX + (line.expandable ? 0 : TOGGLE_SPACE_PX)}px`;
  if (line.expandable) {
    const toggle = createElement(doc, "button", "stt-toggle", line.collapsed ? "▸" : "▾");
    toggle.type = "button";
    // Replier / déplier n'écrit rien : le contexte partagé ne doit pas le griser en lecture seule.
    toggle.dataset.serviceContextNavigation = "";
    toggle.setAttribute("aria-label", `${line.collapsed ? "Déplier" : "Replier"} ${line.name}`);
    cell.appendChild(toggle);
  }
  cell.appendChild(createElement(doc, "span", "stt-text", line.name));
  if (line.countLabel) cell.appendChild(createElement(doc, "span", "gpl-count", line.countLabel));
  return cell;
}

// Cellule « État » : une part par alerte ou par famille, séparées par un point médian ; la
// part « retard de la Synthèse » clignote. L'explication complète est au survol.
export function buildStateCell(line, doc = document) {
  const cell = createElement(doc, "div", "stt-cell stt-cell--state");
  cell.setAttribute("role", "gridcell");
  const parts = line.state?.parts || [];
  parts.forEach((part, index) => {
    if (index) cell.appendChild(createElement(doc, "span", "gpl-state__sep", "·"));
    const classes = ["gpl-state__part", `is-tone-${part.tone}`];
    if (part.blink) classes.push("is-blink");
    cell.appendChild(createElement(doc, "span", classes.join(" "), part.text));
  });
  const title = line.state?.title || parts.map((part) => part.text).join(" · ");
  if (title) cell.title = title;
  return cell;
}

// Une ligne du tableau : partie gauche (les sept colonnes) et emplacement de sa ligne dans le
// Gantt, à la même hauteur.
export function buildLineElement(line, doc = document) {
  const classes = ["stt-line", "gpl-line", `gpl-line--${line.role}`];
  if (line.nature) classes.push(`is-nature-${line.nature}`);
  if (line.variant) classes.push(`is-type-${line.variant}`);
  if (line.isMilestone) classes.push("is-milestone");
  const element = createElement(doc, "div", classes.join(" "));
  element.setAttribute("role", "row");
  element.setAttribute("aria-level", String(line.level + 1));
  element.dataset.lineKey = line.key;
  if (line.expandable) element.setAttribute("aria-expanded", String(!line.collapsed));

  const left = createElement(doc, "div", "stt-left");
  left.appendChild(buildNameCell(line, doc));
  left.appendChild(textCell(doc, "id2", line.id2));
  left.appendChild(textCell(doc, "indice", line.indice));
  left.appendChild(textCell(doc, "duration", line.durationLabel));
  left.appendChild(textCell(doc, "start", dateText(line.start)));
  const end = textCell(doc, "end", dateText(line.end));
  // Retard de la Synthèse par rapport à Structure : la date de fin clignote en rouge.
  if (line.blinkEnd) end.classList.add("is-late", "is-blink");
  if (line.endLimitNote) end.title = line.endLimitNote;
  left.appendChild(end);
  left.appendChild(buildStateCell(line, doc));
  element.appendChild(left);
  element.appendChild(createElement(doc, "div", "stt-right"));
  return element;
}

function safeStorage(win) {
  return {
    getItem(key) {
      try {
        return win.localStorage.getItem(key);
      } catch (_error) {
        return null;
      }
    },
    setItem(key, value) {
      try {
        win.localStorage.setItem(key, value);
      } catch (_error) {
        // Stockage indisponible : la largeur reste celle de la session.
      }
    },
  };
}

export function createGlobalPlanningTable(host, {
  onToggle,
  onToggleAlertsOnly,
  onRefresh,
} = {}, {
  createGantt = null,
  doc = document,
  win = window,
  storage = safeStorage(win),
} = {}) {
  const root = createElement(doc, "div", "stt gpl");
  const scroller = createElement(doc, "div", "stt-scroll");
  scroller.setAttribute("role", "treegrid");
  scroller.setAttribute("aria-label", "Planning global du projet");
  scroller.setAttribute("aria-readonly", "true");

  const head = createElement(doc, "div", "stt-line stt-line--head");
  head.setAttribute("role", "row");
  const headLeft = createElement(doc, "div", "stt-left");
  COLUMNS.forEach(({ field, label }) => {
    const cell = createElement(doc, "div", `stt-cell stt-cell--${field}`, label);
    cell.setAttribute("role", "columnheader");
    headLeft.appendChild(cell);
  });
  // Bande réservée à l'échelle des dates du Gantt.
  const headRight = createElement(doc, "div", "stt-right stt-right--head");
  head.appendChild(headLeft);
  head.appendChild(headRight);

  const body = createElement(doc, "div", "stt-body");
  body.setAttribute("role", "rowgroup");
  const empty = createElement(doc, "p", "stt-empty");
  empty.hidden = true;
  // Couche du Gantt : dans le conteneur défilant mais hors du corps, que chaque rendu
  // reconstruit ; alignée sur les lignes par la hauteur fixe.
  const ganttLayer = createElement(doc, "div", "stt-gantt-layer");
  scroller.appendChild(head);
  scroller.appendChild(body);
  scroller.appendChild(empty);
  scroller.appendChild(ganttLayer);

  const splitter = createElement(doc, "div", "stt-splitter");
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Largeur du tableau du planning global");
  splitter.tabIndex = 0;

  const bar = createElement(doc, "div", "gpl-bar");
  const counts = createElement(doc, "span", "gpl-bar__counts");
  counts.setAttribute("role", "status");
  counts.setAttribute("aria-live", "polite");
  const notice = createElement(doc, "span", "gpl-bar__notice");
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  const alertsButton = createElement(doc, "button", "gpl-bar__button", "Alertes seulement");
  alertsButton.type = "button";
  alertsButton.dataset.serviceContextNavigation = "";
  alertsButton.setAttribute("aria-pressed", "false");
  alertsButton.title = "Ne garder que les lignes en alerte";
  const refreshButton = createElement(doc, "button", "gpl-bar__button", "Actualiser");
  refreshButton.type = "button";
  refreshButton.dataset.serviceContextNavigation = "";
  refreshButton.title = "Relire le planning du projet";
  bar.appendChild(counts);
  bar.appendChild(notice);
  bar.appendChild(alertsButton);
  bar.appendChild(refreshButton);

  root.appendChild(scroller);
  root.appendChild(splitter);
  root.appendChild(bar);
  host.replaceChildren(root);

  const gantt = typeof createGantt === "function"
    ? createGantt({ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX })
    : null;

  const storedWidth = Number(storage.getItem(LEFT_WIDTH_STORAGE_KEY));
  let leftWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : DEFAULT_LEFT_WIDTH;

  /* ---------- Largeur du tableau ---------- */

  function clampWidth(width) {
    const available = root.clientWidth || 0;
    const max = available ? Math.max(MIN_LEFT_WIDTH, available - MIN_RIGHT_WIDTH) : Infinity;
    return Math.min(max, Math.max(MIN_LEFT_WIDTH, width));
  }

  function applyWidth(width, { persist = false } = {}) {
    leftWidth = clampWidth(width);
    root.style.setProperty?.("--stt-left-width", `${Math.round(leftWidth)}px`);
    splitter.setAttribute("aria-valuenow", String(Math.round(leftWidth)));
    if (persist) storage.setItem(LEFT_WIDTH_STORAGE_KEY, String(Math.round(leftWidth)));
    gantt?.resize();
  }

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    try {
      splitter.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché.
    }
    root.classList.add("is-resizing");
    const onMove = (moveEvent) => applyWidth(startWidth + moveEvent.clientX - startX);
    const onEnd = () => {
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onEnd);
      splitter.removeEventListener("pointercancel", onEnd);
      root.classList.remove("is-resizing");
      applyWidth(leftWidth, { persist: true });
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onEnd);
    splitter.addEventListener("pointercancel", onEnd);
  });

  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    applyWidth(leftWidth + (event.key === "ArrowRight" ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX), { persist: true });
  });

  win.addEventListener?.("resize", () => applyWidth(leftWidth));

  /* ---------- Replis et boutons ---------- */

  body.addEventListener("click", (event) => {
    const toggle = closestOf(event.target, "stt-toggle");
    const lineElement = toggle ? closestOf(toggle, "stt-line") : null;
    if (lineElement) onToggle?.(lineElement.dataset.lineKey);
  });
  alertsButton.addEventListener("click", () => onToggleAlertsOnly?.());
  refreshButton.addEventListener("click", () => onRefresh?.());

  applyWidth(leftWidth);

  return {
    // `lines` : le modèle de lignes (buildGlobalRowModel). `emptyMessage` remplace les lignes ;
    // `totals` alimente la barre d'état ; `notice` y signale une relecture en échec.
    render(lines, { emptyMessage = "", totals = null, alertsOnly = false, notice: noticeText = "" } = {}) {
      const list = emptyMessage ? [] : Array.isArray(lines) ? lines : [];
      empty.textContent = emptyMessage;
      empty.hidden = !emptyMessage;
      body.hidden = Boolean(emptyMessage);
      body.replaceChildren(...list.map((line) => buildLineElement(line, doc)));
      gantt?.render(list);
      counts.textContent = totals ? describeCounts(totals) : "";
      notice.textContent = noticeText;
      notice.hidden = !noticeText;
      alertsButton.setAttribute("aria-pressed", String(Boolean(alertsOnly)));
      if (alertsOnly) alertsButton.classList.add("is-active");
      else alertsButton.classList.remove("is-active");
      applyWidth(leftWidth);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/globalPlanningTable.test.mjs`
Expected: PASS — 13 tests.

- [ ] **Step 5: Point de contrôle (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 517 tests, 0 échec.

---

### Task 6: Le contrôleur (`globalPlanningController.js`)

**Files:**
- Create: `Planning Projet/assets/js/ui/globalPlanningController.js`
- Test: `Planning Projet/tests/globalPlanningController.test.mjs` (nouveau)

**Interfaces:**
- Consumes:
  - `buildGlobalPlanning`, `buildGlobalRowModel` (tâches 2 et 3).
  - Le contexte partagé, injecté : `context.getState().currentProject` (`{ name } | null`) et `context.subscribe(listener)` — rappelé au changement de projet **et** de service.
  - `loadRows() → Promise<{ projectRows, planRows }>`, injecté.
  - `createTable({ onToggle, onToggleAlertsOnly, onRefresh }) → { render(lines, options) }`, injecté (tâche 5).
- Produces : `createGlobalPlanningController({ context, createTable, loadRows, now }) → { setActive(boolean), setZoneFilter(zoneName), refresh() → Promise }`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/globalPlanningController.test.mjs` :

```js
// Contrôleur de la vue Global : lecture des deux tables, rafraîchissement, replis, « Alertes
// seulement », filtre de zone, messages — et jamais d'écriture.
import test from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const { createGlobalPlanningController } = await import("../assets/js/ui/globalPlanningController.js");
const { PROJECT, TODAY, ZONE_1, planRows, projectRows, structureRows } = await import("./helpers/globalRows.mjs");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Lectures réglées à la main : chaque appel attend qu'on le résolve ou le rejette.
function manualLoads() {
  const calls = [];
  return { calls, loadRows: () => new Promise((resolve, reject) => calls.push({ resolve, reject })) };
}

function setup({ loadRows = null, project = { name: PROJECT } } = {}) {
  const state = { currentProject: project, selectedService: "Structure" };
  const listeners = [];
  const context = {
    getState: () => ({ ...state }),
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
  };
  const data = { projectRows: projectRows(), planRows: planRows() };
  const loads = [];
  const table = { renders: [], callbacks: null };
  const controller = createGlobalPlanningController({
    context,
    createTable(callbacks) {
      table.callbacks = callbacks;
      return { render: (lines, options) => table.renders.push({ lines, options }) };
    },
    loadRows: (...args) => {
      loads.push(args);
      return loadRows ? loadRows() : Promise.resolve(data);
    },
    now: () => TODAY,
  });
  const lastRender = () => table.renders.at(-1);
  const keys = () => lastRender().lines.map((line) => line.key);
  const notify = () => listeners.forEach((listener) => listener(context.getState()));
  return { state, context, data, loads, table, controller, lastRender, keys, notify };
}

async function activate(env) {
  env.controller.setActive(true);
  await flush();
}

const DEFAULT_KEYS = [
  "zone:zone1batbc", "level:101",
  "zone:zone2batb", "level:113", "doc:111", "level:112", "floor:zone2batb/rp1", "task:600", "doc:131", "doc:142",
  "zone:", "doc:141",
];

test("inactive : aucune lecture, aucun dessin", async () => {
  const env = setup();
  env.controller.setZoneFilter(ZONE_1);
  await env.controller.refresh();
  env.notify();
  await flush();
  assert.equal(env.loads.length, 0);
  assert.equal(env.table.renders.length, 0);
});

test("activation : « Chargement… », puis le planning fusionné et ses compteurs", async () => {
  const env = setup();
  env.controller.setActive(true);
  assert.deepEqual(env.lastRender().options, { emptyMessage: "Chargement du planning global…", alertsOnly: false });
  await flush();
  assert.equal(env.loads.length, 1);
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
  assert.deepEqual(env.lastRender().options, {
    emptyMessage: "",
    totals: { linkedFloors: 3, unlinkedFloors: 1, synthese: 1, missing: 0, stale: 1, structure: 2 },
    alertsOnly: false,
    notice: "",
  });
});

test("les retards sont comptés au jour de l'horloge", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  const formwork = env.lastRender().lines.find((line) => line.key === "doc:113");
  assert.equal(formwork.state.parts[0].text, "retard 37 j", "Fin le 02/09/26, aujourd'hui le 09/10/26");
});

test("aucun projet : invite, sans lecture", async () => {
  const env = setup({ project: null });
  await activate(env);
  assert.equal(env.lastRender().options.emptyMessage, "Choisissez un projet pour afficher son planning global.");
  assert.equal(env.loads.length, 0);
});

test("projet sans ligne : message", async () => {
  const env = setup();
  env.data.projectRows = [];
  env.data.planRows = [];
  await activate(env);
  assert.equal(env.lastRender().options.emptyMessage, "Aucune ligne de planning pour ce projet.");
  assert.deepEqual(env.lastRender().lines, []);
});

test("triangle : la ligne bascule, les autres gardent leur état", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  assert.deepEqual(env.keys().slice(3, 6), ["level:113", "floor:zone2batb/rdc", "doc:113"]);
  env.table.callbacks.onToggle("zone:zone1batbc");
  assert.deepEqual(env.keys().slice(0, 4), ["zone:zone1batbc", "zone:zone2batb", "level:113", "floor:zone2batb/rdc"]);
  env.table.callbacks.onToggle("level:113");
  env.table.callbacks.onToggle("zone:zone1batbc");
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
  assert.equal(env.loads.length, 1, "un repli ne relit rien");
});

test("« Alertes seulement » : filtre, replis à part, retour à l'affichage précédent", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("doc:111");
  const before = env.keys();
  env.table.callbacks.onToggleAlertsOnly();
  assert.equal(env.lastRender().options.alertsOnly, true);
  assert.deepEqual(env.keys(), [
    "zone:zone1batbc", "level:101", "floor:zone1batbc/ss1",
    "zone:zone2batb", "level:113", "floor:zone2batb/rdc", "group:416", "group:419", "task:420", "doc:113", "doc:123",
  ]);
  env.table.callbacks.onToggle("level:113");
  assert.equal(env.keys().includes("task:420"), false);
  env.table.callbacks.onToggleAlertsOnly();
  assert.deepEqual(env.keys(), before, "les replis d'avant sont retrouvés");
  env.table.callbacks.onToggleAlertsOnly();
  assert.equal(env.keys().includes("task:420"), true, "les replis du mode alertes repartent de zéro");
});

test("« Alertes seulement » sans alerte : message, bouton toujours enfoncé", async () => {
  const env = setup();
  env.data.projectRows = structureRows().filter((row) => row.id === 2 || row.id === 111 || row.id === 121);
  env.data.planRows = [];
  await activate(env);
  assert.deepEqual(env.keys(), ["zone:zone2batb", "doc:111"]);
  env.table.callbacks.onToggleAlertsOnly();
  assert.deepEqual([env.lastRender().options.emptyMessage, env.lastRender().options.alertsOnly], ["Aucune alerte sur ce projet.", true]);
});

test("filtre de zone du bandeau : une section, sans nouvelle lecture", async () => {
  const env = setup();
  await activate(env);
  env.controller.setZoneFilter(ZONE_1);
  assert.deepEqual(env.keys(), ["zone:zone1batbc", "level:101"]);
  assert.equal(env.lastRender().options.totals.linkedFloors, 1);
  const count = env.table.renders.length;
  env.controller.setZoneFilter(` ${ZONE_1} `);
  assert.equal(env.table.renders.length, count, "même zone : rien à redessiner");
  env.controller.setZoneFilter("");
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
  assert.equal(env.loads.length, 1);
});

test("rafraîchissement (signal ou « Actualiser ») : nouvelle lecture, replis gardés, pas de « Chargement… »", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  env.data.projectRows = projectRows().map((row) => (row.id === 420 ? { ...row, Diff_armature: "2026-08-19" } : row));
  const count = env.table.renders.length;
  await env.controller.refresh();
  assert.equal(env.loads.length, 2);
  assert.equal(env.table.renders.length, count + 1, "un seul dessin, celui des nouvelles données");
  assert.equal(env.keys().includes("floor:zone2batb/rdc"), true, "le niveau reste déplié");
  assert.equal(env.lastRender().options.totals.synthese, 0, "la tâche contrôlée finit maintenant à temps");
  env.table.callbacks.onRefresh();
  await flush();
  assert.equal(env.loads.length, 3);
});

test("changement de projet : nouvelle lecture, replis remis à zéro ; changement de service : rien", async () => {
  const env = setup();
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  env.state.selectedService = "Synthese";
  env.notify();
  await flush();
  assert.equal(env.loads.length, 1, "même projet : même contenu");
  env.state.currentProject = { name: "HOTEL DIEU" };
  env.notify();
  assert.equal(env.lastRender().options.emptyMessage, "Chargement du planning global…");
  await flush();
  assert.equal(env.loads.length, 2);
  assert.deepEqual(env.keys(), DEFAULT_KEYS, "les replis de l'ancien projet sont oubliés");
});

test("réponse arrivée après un changement de projet ou une désactivation : ignorée", async () => {
  const loads = manualLoads();
  const env = setup({ loadRows: loads.loadRows });
  await activate(env);
  env.state.currentProject = { name: "HOTEL DIEU" };
  env.notify();
  loads.calls[0].resolve(env.data);
  await flush();
  assert.equal(env.lastRender().options.emptyMessage, "Chargement du planning global…", "la lecture de l'ancien projet ne s'affiche pas");
  loads.calls[1].resolve({ projectRows: [], planRows: [] });
  await flush();
  assert.equal(env.lastRender().options.emptyMessage, "Aucune ligne de planning pour ce projet.");

  const count = env.table.renders.length;
  void env.controller.refresh();
  env.controller.setActive(false);
  loads.calls[2].resolve(env.data);
  await flush();
  assert.equal(env.table.renders.length, count, "vue inactive : plus aucun dessin");
});

test("désactivée puis réactivée : relit le projet", async () => {
  const env = setup();
  await activate(env);
  env.controller.setActive(false);
  env.controller.setActive(true);
  await flush();
  assert.equal(env.loads.length, 2);
  assert.deepEqual(env.keys(), DEFAULT_KEYS);
});

test("première lecture impossible : message, puis « Actualiser » relit", async () => {
  const loads = manualLoads();
  const env = setup({ loadRows: loads.loadRows });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await activate(env);
    loads.calls[0].reject(new Error("réseau"));
    await flush();
    assert.equal(env.lastRender().options.emptyMessage, "Le planning global n'a pas pu être lu. Cliquez sur « Actualiser ».");
    env.table.callbacks.onRefresh();
    loads.calls[1].reject(new Error("réseau"));
    await flush();
    assert.equal(env.lastRender().options.emptyMessage, "Le planning global n'a pas pu être lu. Cliquez sur « Actualiser ».");
    env.table.callbacks.onRefresh();
    loads.calls[2].resolve(env.data);
    await flush();
    assert.deepEqual(env.keys(), DEFAULT_KEYS);
    assert.equal(errors.length, 2);
  } finally {
    console.error = original;
  }
});

test("relecture impossible : les données restent, avec un avertissement jusqu'à la prochaine lecture réussie", async () => {
  const loads = manualLoads();
  const env = setup({ loadRows: loads.loadRows });
  const original = console.error;
  console.error = () => {};
  try {
    await activate(env);
    loads.calls[0].resolve(env.data);
    await flush();
    void env.controller.refresh();
    loads.calls[1].reject(new Error("réseau"));
    await flush();
    assert.deepEqual(env.keys(), DEFAULT_KEYS);
    assert.equal(env.lastRender().options.notice, "La dernière relecture a échoué : les dates affichées peuvent être anciennes.");
    void env.controller.refresh();
    loads.calls[2].resolve(env.data);
    await flush();
    assert.equal(env.lastRender().options.notice, "");
  } finally {
    console.error = original;
  }
});

test("lecture seule : le contrôleur ne connaît que la lecture des deux tables", async () => {
  const env = setup();
  env.context.docApi = { applyUserActions: () => { throw new Error("écriture interdite"); } };
  await activate(env);
  env.table.callbacks.onToggle("level:113");
  env.table.callbacks.onToggleAlertsOnly();
  env.table.callbacks.onRefresh();
  await flush();
  assert.deepEqual(Object.keys(env.table.callbacks).sort(), ["onRefresh", "onToggle", "onToggleAlertsOnly"]);
  assert.deepEqual(env.loads.map((args) => args.length), [0, 0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/globalPlanningController.test.mjs`
Expected: FAIL — `Cannot find module '…/assets/js/ui/globalPlanningController.js'`.

- [ ] **Step 3: Write the implementation**

Créer `Planning Projet/assets/js/ui/globalPlanningController.js` :

```js
// Chef d'orchestre de la vue Global (Planning Projet) : lit Planning_Projet et la liste de
// plans du projet courant, tous services confondus, construit le planning fusionné et le
// redessine. Il ne fait que lire : aucune écriture dans Grist. Ses dépendances sont injectées
// (le contexte partagé, la lecture des deux tables, la fabrique du tableau, l'horloge) :
// doublures en test.
import { buildGlobalPlanning, buildGlobalRowModel } from "../services/globalPlanningModel.js";

const MESSAGES = Object.freeze({
  noProject: "Choisissez un projet pour afficher son planning global.",
  loading: "Chargement du planning global…",
  empty: "Aucune ligne de planning pour ce projet.",
  noAlert: "Aucune alerte sur ce projet.",
  readFailed: "Le planning global n'a pas pu être lu. Cliquez sur « Actualiser ».",
  refreshFailed: "La dernière relecture a échoué : les dates affichées peuvent être anciennes.",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toProjectKey(name) {
  return toText(name).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

export function createGlobalPlanningController({
  context,
  createTable,
  // Lecture des deux tables du projet, tous services : { projectRows, planRows }.
  loadRows,
  now = () => new Date(),
} = {}) {
  let active = false;
  let bound = false;
  let zoneFilter = "";
  let planning = null;
  let loaded = false;
  let readError = false;
  let refreshError = false;
  let projectKey = "";
  let loadToken = 0;
  let alertsOnly = false;
  // Lignes basculées par l'utilisateur : par défaut les zones sont dépliées et le reste replié.
  const toggledKeys = new Set();
  // Dans « Alertes seulement », tout est déplié par défaut : ses bascules sont à part.
  const alertToggledKeys = new Set();

  const table = createTable({
    onToggle: (key) => toggle(key),
    onToggleAlertsOnly: () => toggleAlertsOnly(),
    onRefresh: () => {
      void load();
    },
  });

  function getProject() {
    return context?.getState?.().currentProject || null;
  }

  function currentProjectKey() {
    const project = getProject();
    return project ? toProjectKey(project.name) : "";
  }

  function render() {
    if (!active) return;
    let message = "";
    if (!getProject()) message = MESSAGES.noProject;
    else if (!loaded) message = MESSAGES.loading;
    else if (readError) message = MESSAGES.readFailed;
    if (message) {
      table.render([], { emptyMessage: message, alertsOnly });
      return;
    }
    const { lines, totals } = buildGlobalRowModel(planning, {
      zoneFilter,
      alertsOnly,
      toggledKeys: alertsOnly ? alertToggledKeys : toggledKeys,
    });
    table.render(lines, {
      emptyMessage: lines.length ? "" : alertsOnly ? MESSAGES.noAlert : MESSAGES.empty,
      totals,
      alertsOnly,
      notice: refreshError ? MESSAGES.refreshFailed : "",
    });
  }

  async function load() {
    if (!active) return;
    const token = ++loadToken;
    const nextProjectKey = currentProjectKey();
    if (nextProjectKey !== projectKey) {
      projectKey = nextProjectKey;
      planning = null;
      loaded = false;
      readError = false;
      refreshError = false;
      toggledKeys.clear();
      alertToggledKeys.clear();
    }
    // Sans données à garder à l'écran : l'invite ou « Chargement… ».
    if (!nextProjectKey || !loaded) render();
    if (!nextProjectKey) return;
    let rows;
    try {
      rows = await loadRows();
    } catch (error) {
      if (token !== loadToken || !active) return;
      console.error("Lecture du planning global impossible :", error);
      // Des données sont déjà affichées : elles restent, avec un avertissement.
      if (loaded && !readError) refreshError = true;
      else {
        readError = true;
        loaded = true;
      }
      render();
      return;
    }
    if (token !== loadToken || !active) return;
    planning = buildGlobalPlanning({ projectRows: rows?.projectRows, planRows: rows?.planRows, today: now() });
    loaded = true;
    readError = false;
    refreshError = false;
    render();
  }

  function toggle(key) {
    const keys = alertsOnly ? alertToggledKeys : toggledKeys;
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    render();
  }

  function toggleAlertsOnly() {
    alertsOnly = !alertsOnly;
    alertToggledKeys.clear();
    render();
  }

  function bind() {
    if (bound) return;
    bound = true;
    // Le contexte prévient aussi d'un changement de service, qui ne change rien ici : seule
    // l'arrivée d'un autre projet relance une lecture.
    context?.subscribe?.(() => {
      if (currentProjectKey() !== projectKey) void load();
    });
  }

  return {
    setActive(nextActive) {
      const wasActive = active;
      active = Boolean(nextActive);
      if (!active) {
        loadToken += 1;
        return;
      }
      bind();
      if (!wasActive) void load();
    },
    setZoneFilter(zoneName) {
      const next = toText(zoneName);
      if (next === zoneFilter) return;
      zoneFilter = next;
      render();
    },
    // Appelée par la surveillance de tables de main.js et par « Actualiser ».
    refresh() {
      return load();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run : `node --test tests/globalPlanningController.test.mjs`
Expected: PASS — 16 tests.

- [ ] **Step 5: Point de contrôle (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 533 tests, 0 échec.

---

### Task 7: Branchement — bouton, bascule de vue, mémorisation, styles

**Files:**
- Modify: `Planning Projet/index.html`
- Modify: `Planning Projet/assets/js/state.js` (CRLF)
- Modify: `Planning Projet/assets/js/main.js`
- Modify: `Planning Projet/assets/css/styles.css`
- Modify: `Planning Projet/tests/structureLinkWiring.test.mjs`, `tests/syntheseGanttWiring.test.mjs`, `tests/syntheseTasksWiring.test.mjs` (numéro de version)
- Test: `Planning Projet/tests/globalWiring.test.mjs` (nouveau)

**Interfaces:**
- Consumes:
  - `createGlobalPlanningTable` (tâche 5), `createGlobalPlanningController` (tâche 6).
  - Dans `main.js`, déjà présents : `createSyntheseGanttForTable(hosts)` (le Gantt branché sur la période du bandeau), `setPlanningEditingEnabled(enabled, { rerender, notify })`, `planningEditingEnabled`, `refreshPlanningTimelineLayout()`, `EMBEDDED_PLANNING_SYNC_MODE`, `state`, `setState(patch)`, `syncSyntheseTasksZoneFilter()`, `bindPlanningDataRefresh()`.
  - `window.GristServiceContext.fetchProjectRows(tableName)` : lignes d'une table pour le projet courant, tous services.
- Produces : bouton `#globalViewToggle`, conteneur `#globalSpace`, classe `is-global-space` sur `body`, `state.globalView` (booléen, mémorisé), version `?v=20261013-global1`.
- Contraintes des tests existants : `bindSyntheseSpace();` doit rester immédiatement suivi de `bindStructureLinkDialog();` ; dans `handleProjectChange`, `syncSyntheseTasksZoneFilter();` doit rester immédiatement suivi de `await refreshPlanning(` ; `function syncSyntheseTasksZoneFilter(` doit suivre `function getSyntheseTasks(`.

- [ ] **Step 1: Write the failing test**

Créer `Planning Projet/tests/globalWiring.test.mjs` :

```js
// Branchement de la vue Global dans Planning Projet : bouton du bandeau, bascule de vue,
// mémorisation, rafraîchissement, styles et clignotement.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

test("bouton « Global » : après la liste Zone, avant « Editer », jamais grisé par le contexte partagé", () => {
  const zoneAt = html.indexOf('id="zoneDropdown"');
  const globalAt = html.indexOf('id="globalViewToggle"');
  const editAt = html.indexOf('id="planningEditToggle"');
  assert.ok(zoneAt > 0 && globalAt > zoneAt && globalAt < editAt);
  const button = sliceBetween(html, '<button\n        id="globalViewToggle"', "</button>");
  assert.match(button, /type="button"/);
  assert.match(button, /class="planning-global-toggle"/);
  assert.match(button, /aria-pressed="false"/);
  assert.match(button, /data-service-context-navigation/);
  assert.match(button, />Global$/);
});

test("conteneur de la vue : masqué au départ, à la suite de la vue Synthese", () => {
  assert.match(html, /<section id="globalSpace" class="global-space" aria-label="Vue Global" hidden><\/section>/);
  assert.ok(html.indexOf('id="globalSpace"') > html.indexOf('id="syntheseSpace"'));
});

test("main.js : la vue lit les deux tables du projet, tous services, et n'écrit jamais", () => {
  assert.match(mainJs, /import \{ createGlobalPlanningTable \} from "\.\/ui\/globalPlanningTable\.js";/);
  assert.match(mainJs, /import \{ createGlobalPlanningController \} from "\.\/ui\/globalPlanningController\.js";/);
  const factory = sliceBetween(mainJs, "function getGlobalPlanning(", "function applyGlobalSpace(");
  assert.match(factory, /getElementById\("globalSpace"\)/);
  assert.match(factory, /context\.fetchProjectRows\("Planning_Projet"\)/);
  assert.match(factory, /context\.fetchProjectRows\("ListePlan_NDC_COF"\)/);
  assert.match(factory, /return \{ projectRows, planRows \};/);
  assert.match(factory, /createGlobalPlanningTable\(host, callbacks, \{ createGantt: createSyntheseGanttForTable \}\)/);
  assert.match(factory, /globalPlanning\.setZoneFilter\(state\.selectedZone \|\| ""\);/);
  assert.equal(/docApi|applyUserActions/.test(factory), false, "aucune écriture");
});

test("bascule : la vue remplace le planning du service, « Editer » se verrouille, la frise se recale au retour", () => {
  const apply = sliceBetween(mainJs, "function applyGlobalSpace(", "function bindGlobalSpace(");
  assert.match(apply, /button\.setAttribute\("aria-pressed", active \? "true" : "false"\);/);
  assert.match(apply, /document\.body\.classList\.toggle\("is-global-space", active\);/);
  assert.match(apply, /space\.hidden = !active;/);
  assert.match(apply, /if \(planningEditingEnabled\) setPlanningEditingEnabled\(false, \{ rerender: true, notify: false \}\);/);
  assert.match(apply, /getGlobalPlanning\(\)\?\.setActive\(true\);/);
  assert.match(apply, /globalPlanning\?\.setActive\(false\);/);
  assert.match(apply, /requestAnimationFrame\(\(\) => refreshPlanningTimelineLayout\(\)\);/);
});

test("bouton : bascule, mémorise le choix, le reprend au chargement ; rien en mode embarqué", () => {
  const bind = sliceBetween(mainJs, "function bindGlobalSpace(", "async function handleProjectChange(");
  assert.match(bind, /if \(EMBEDDED_PLANNING_SYNC_MODE\) return;/);
  assert.match(bind, /setState\(\{ globalView: next \}\);\s*applyGlobalSpace\(next\);/);
  assert.match(bind, /applyGlobalSpace\(state\.globalView\);/);
  assert.match(mainJs, /bindSyntheseSpace\(\);\s*bindStructureLinkDialog\(\);\s*bindGlobalSpace\(\);/);
  assert.match(css, /body\.planning-sync-embedded #globalViewToggle\s*\{\s*display:\s*none !important;/);
});

test("le contrôleur est déclaré avec l'état du module, avant tout usage", () => {
  const declaration = mainJs.indexOf("let globalPlanning = null;");
  assert.ok(declaration > 0 && declaration < mainJs.indexOf("function setPlanningEditingEnabled("));
  assert.ok(mainJs.indexOf("let globalSpaceActive = false;") > declaration);
});

test("rafraîchissement : à chaque rappel de la surveillance, quelle que soit la table ; même filtre de zone", () => {
  const watcher = sliceBetween(mainJs, "function bindPlanningDataRefresh(", "function bindPlanningServiceRefresh(");
  assert.match(watcher, /\n\s*void globalPlanning\?\.refresh\(\);/);
  assert.equal(/if \([^)]*\) void globalPlanning\?\.refresh\(\)/.test(watcher), false, "pas de condition sur la table");
  const sync = sliceBetween(mainJs, "function syncSyntheseTasksZoneFilter(", "function applySyntheseSpace(");
  assert.match(sync, /globalPlanning\?\.setZoneFilter\(state\.selectedZone \|\| ""\);/);
});

test("vue active : frise, tableau Synthese et boutons d'écriture masqués ; entrées de zone d'écriture aussi", () => {
  const hidden = sliceBetween(css, "body.is-global-space .planning-header-row", "}");
  for (const selector of [
    "#timelineWrapper", "#planningPaneResizer", "#planningStatus", "#syntheseSpace",
    "#planningEditToggle", "#structureLinkToggle", "#durationDefaultsToggle",
  ]) {
    assert.ok(hidden.includes(`body.is-global-space ${selector}`), selector);
  }
  assert.match(hidden, /display:\s*none !important;/);
  assert.match(css, /body\.is-global-space #zoneDropdown option\[value="__add_zone__"\]/);
  assert.match(css, /body\.is-global-space #zoneDropdown option\[value="__manage_zone__"\]/);
  assert.match(css, /\.global-space\[hidden\]\s*\{\s*display:\s*none;/);
});

test("styles du tableau : colonne « État », pastilles par ton, niveau lié, coffrage", () => {
  assert.match(css, /\.gpl \.stt-left\s*\{[^}]*var\(--stt-col-end\) var\(--gpl-col-state\);/);
  assert.match(css, /\.gpl\s*\{[^}]*--stt-left-width:\s*980px;[^}]*--gpl-col-state:\s*300px;/);
  assert.match(css, /\.gpl-state__part:first-child\s*\{\s*flex-shrink:\s*0;/);
  assert.match(css, /\.gpl-state__part\.is-tone-late,\s*\.gpl-state__part\.is-tone-error\s*\{[^}]*color:\s*#a51d1d;/);
  assert.match(css, /\.gpl-state__part\.is-tone-warn\s*\{[^}]*color:\s*#8b4e00;/);
  assert.match(css, /\.gpl-state__part\.is-tone-ok\s*\{[^}]*color:\s*#1e6b37;/);
  assert.match(css, /\.gpl-state__part\.is-tone-muted\s*\{/);
  assert.match(css, /\.gpl-line--level \.stt-left\s*\{[^}]*background:\s*var\(--gpl-level-bg\);/);
  assert.match(css, /\.gpl-line--formwork \.stt-left\s*\{[^}]*background:\s*var\(--gpl-formwork-bg\);/);
  assert.match(css, /\.gpl-line--floor \.stt-left\s*\{[^}]*background:\s*var\(--stt-floor-bg\);/);
  assert.match(css, /\.gpl-bar__button\.is-active\s*\{/);
});

test("clignotement : la Fin en rouge, animée seulement si le poste accepte les animations", () => {
  assert.match(css, /\.gpl \.stt-cell--end\.is-late\s*\{[^}]*color:\s*var\(--gpl-red\);[^}]*font-weight:\s*700;/);
  assert.match(css, /@keyframes gpl-blink\s*\{/);
  const motion = sliceBetween(css, "@media (prefers-reduced-motion: no-preference)", "/* Barre d'état");
  assert.match(motion, /\.gpl \.is-blink\s*\{\s*animation:\s*gpl-blink 1\.1s steps\(1, end\) infinite;/);
  assert.equal(css.split("animation: gpl-blink").length - 1, 1, "aucune animation hors de la requête de préférence");
});

test("les scripts sont servis dans leur nouvelle version", () => {
  assert.equal(html.includes("20261009-limite3"), false);
  assert.equal(html.split("?v=20261013-global1").length - 1, 5);
});

// state.js mémorise le choix avec le projet et la zone du widget.
test("mémorisation : la vue Global est reprise à la session suivante, fausse par défaut", async () => {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
  });
  const { state, loadState, setState } = await import("../assets/js/state.js");
  const KEY = "nouveau-projet.selected-project";
  assert.equal(state.globalView, false);
  loadState();
  assert.equal(state.globalView, false, "rien de mémorisé");
  store.set(KEY, JSON.stringify({ selectedProject: "HOTEL DIEU", selectedZone: "", globalView: true }));
  loadState();
  assert.equal(state.globalView, true);
  store.set(KEY, JSON.stringify({ selectedProject: "HOTEL DIEU", selectedZone: "", globalView: "oui" }));
  loadState();
  assert.equal(state.globalView, false, "seul un vrai booléen compte");
  setState({ globalView: true });
  assert.equal(JSON.parse(store.get(KEY)).globalView, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `node --test tests/globalWiring.test.mjs`
Expected: FAIL — bouton, conteneur, imports et styles absents.

- [ ] **Step 3: Add the button, the container and the new version (`index.html`)**

Dans `Planning Projet/index.html` :

```diff
--- a/Planning Projet/index.html
+++ b/Planning Projet/index.html
@@ -7,8 +7,8 @@
 
   <!-- Grist -->
   <script src="https://docs.getgrist.com/grist-plugin-api.js"></script>
-  <script src="../shared/service-context-core.js?v=20261009-limite3"></script>
-  <script src="../shared/grist-service-context.js?v=20261009-limite3"></script>
+  <script src="../shared/service-context-core.js?v=20261013-global1"></script>
+  <script src="../shared/grist-service-context.js?v=20261013-global1"></script>
   <script>
     window.ProjectMutationSyncConfig = {
       mutationSignals: {
@@ -29,7 +29,7 @@
       dropdownIds: ["projectDropdown"]
     };
   </script>
-  <script src="../shared/project-mutation-sync-relay.js?v=20261009-limite3"></script>
+  <script src="../shared/project-mutation-sync-relay.js?v=20261013-global1"></script>
 
   <!-- vis-timeline (même système que timeline-calendar.zip) -->
   <script src="https://unpkg.com/vis-timeline/standalone/umd/vis-timeline-graph2d.min.js"></script>
@@ -40,10 +40,10 @@
 
   <!-- Styles app -->
   <link rel="stylesheet" href="./assets/css/variables.css" />
-  <link rel="stylesheet" href="./assets/css/styles.css?v=20261009-limite3" />
+  <link rel="stylesheet" href="./assets/css/styles.css?v=20261013-global1" />
 
   <!-- App -->
-  <script type="module" src="./assets/js/main.js?v=20261009-limite3" defer></script>
+  <script type="module" src="./assets/js/main.js?v=20261013-global1" defer></script>
 </head>
 <body>
   <!-- Toolbar style timeline-calendar -->
@@ -58,6 +58,14 @@
       <select id="zoneDropdown" disabled>
         <option value="">Toutes les zones</option>
       </select>
+      <button
+        id="globalViewToggle"
+        type="button"
+        class="planning-global-toggle"
+        aria-pressed="false"
+        title="Voir ensemble le planning Synthèse et le planning Structure, en lecture seule"
+        data-service-context-navigation
+      >Global</button>
       <button
         id="planningEditToggle"
         type="button"
@@ -130,6 +138,10 @@
   <!-- Vue Synthese : tableau de tâches, construit par assets/js/ui/syntheseTaskTable.js -->
   <section id="syntheseSpace" class="synthese-space" aria-label="Vue Synthese" hidden></section>
 
+  <!-- Vue Global : planning Synthèse + Structure fusionné, en lecture seule, construit par
+       assets/js/ui/globalPlanningTable.js -->
+  <section id="globalSpace" class="global-space" aria-label="Vue Global" hidden></section>
+
   <!-- ARCHIVE vue Synthese v1 (équipe sur chronologie) : désactivée, gardée pour trace.
   <section id="syntheseView" class="synthese-view" aria-label="Équipe Synthese du projet" hidden>
     <div class="synthese-header-row">
```

Les cinq occurrences de `20261009-limite3` du fichier deviennent `20261013-global1`. Dans `tests/structureLinkWiring.test.mjs` (3 occurrences), `tests/syntheseGanttWiring.test.mjs` (2) et `tests/syntheseTasksWiring.test.mjs` (1), remplacer de même `20261009-limite3` par `20261013-global1`.

- [ ] **Step 4: Remember the choice (`state.js`, CRLF)**

Dans `Planning Projet/assets/js/state.js` :

```diff
--- a/Planning Projet/assets/js/state.js
+++ b/Planning Projet/assets/js/state.js
@@ -3,6 +3,8 @@ import { APP_CONFIG } from "./config.js";
 export const state = {
   selectedProject: "",
   selectedZone: "",
+  // Vue Global (planning Synthèse + Structure fusionné) affichée à la place du planning du service.
+  globalView: false,
 };
 
 function readStoredProjectName() {
@@ -38,6 +40,7 @@ export function loadState() {
       (typeof parsed.selectedProject === "string" ? parsed.selectedProject : "");
     state.selectedZone =
       typeof parsed.selectedZone === "string" ? parsed.selectedZone : "";
+    state.globalView = parsed.globalView === true;
   } catch (error) {
     console.warn("Erreur chargement localStorage :", error);
   }
```

Puis vérifier les fins de ligne (depuis `Planning Projet/`) :

```bash
printf 'CR=%s LF=%s\n' "$(tr -cd '\r' < assets/js/state.js | wc -c)" "$(tr -cd '\n' < assets/js/state.js | wc -c)"
```

Expected: `CR=71 LF=71`. Si les deux nombres diffèrent, rétablir le CRLF sur les lignes ajoutées avant de continuer.

- [ ] **Step 5: Wire the view (`main.js`)**

Dans `Planning Projet/assets/js/main.js` :

```diff
--- a/Planning Projet/assets/js/main.js
+++ b/Planning Projet/assets/js/main.js
@@ -85,10 +85,16 @@ import { createSyntheseTasksController } from "./ui/syntheseTasksController.js";
 import { createSyntheseGantt } from "./ui/syntheseGantt.js";
 import { createStructureLinkDialog } from "./ui/structureLinkDialog.js";
 import { buildFormworkStarts } from "./services/formworkStarts.js";
+import { createGlobalPlanningTable } from "./ui/globalPlanningTable.js";
+import { createGlobalPlanningController } from "./ui/globalPlanningController.js";
 
 let toolbarBound = false;
 // Tableau de tâches de la vue Synthese : créé à la première activation du service.
 let syntheseTasks = null;
+// Vue Global (planning Synthèse + Structure fusionné, en lecture seule) : créée à sa première
+// ouverture.
+let globalPlanning = null;
+let globalSpaceActive = false;
 let pendingRefreshOptions = null;
 let refreshQueuePromise = null;
 let resolveRefreshQueue = null;
@@ -2019,6 +2025,9 @@ function bindPlanningDataRefresh() {
       // Un coffrage déplacé dans le planning Structure déplace la limite de fin du plan de
       // réservations de son étage.
       if (tables.includes("Planning_Projet")) void syntheseTasks?.refreshFormworkStarts();
+      // La vue Global montre les deux services : elle relit ses tables quelle que soit la table
+      // signalée (une écriture de l'autre service arrive par les colonnes de signal du projet).
+      void globalPlanning?.refresh();
       void refreshPlanning({
         forceLoad: true,
         reason: `donnees-modifiees:${tables.join(",")}`,
@@ -2126,6 +2135,8 @@ function getSyntheseTasks() {
 
 function syncSyntheseTasksZoneFilter() {
   syntheseTasks?.setZoneFilter(state.selectedZone || "");
+  // La vue Global suit le même filtre de zone.
+  globalPlanning?.setZoneFilter(state.selectedZone || "");
 }
 
 function applySyntheseSpace(selectedService) {
@@ -2195,6 +2206,66 @@ function bindStructureLinkDialog() {
     });
 }
 
+// Vue Global : le planning Synthèse et le planning Structure du projet dans un même tableau,
+// en lecture seule. Le bouton « Global » du bandeau l'affiche à la place du planning du service
+// choisi ; ses deux tables sont lues pour le projet, tous services confondus.
+function getGlobalPlanning() {
+  if (globalPlanning) return globalPlanning;
+  const host = document.getElementById("globalSpace");
+  const context = window.GristServiceContext;
+  if (!host || typeof context?.fetchProjectRows !== "function") return null;
+  globalPlanning = createGlobalPlanningController({
+    context,
+    createTable: (callbacks) => createGlobalPlanningTable(host, callbacks, { createGantt: createSyntheseGanttForTable }),
+    loadRows: async () => {
+      const [projectRows, planRows] = await Promise.all([
+        context.fetchProjectRows("Planning_Projet"),
+        context.fetchProjectRows("ListePlan_NDC_COF"),
+      ]);
+      return { projectRows, planRows };
+    },
+  });
+  globalPlanning.setZoneFilter(state.selectedZone || "");
+  return globalPlanning;
+}
+
+function applyGlobalSpace(nextActive) {
+  const active = Boolean(nextActive);
+  const button = document.getElementById("globalViewToggle");
+  if (button) {
+    button.setAttribute("aria-pressed", active ? "true" : "false");
+    button.classList.toggle("is-active", active);
+    button.title = active
+      ? "Revenir au planning du service"
+      : "Voir ensemble le planning Synthèse et le planning Structure, en lecture seule";
+  }
+  if (active === globalSpaceActive) return;
+  globalSpaceActive = active;
+  document.body.classList.toggle("is-global-space", active);
+  const space = document.getElementById("globalSpace");
+  if (space) space.hidden = !active;
+  if (active) {
+    // La vue Global ne modifie rien : « Editer » repasse à l'état verrouillé.
+    if (planningEditingEnabled) setPlanningEditingEnabled(false, { rerender: true, notify: false });
+    getGlobalPlanning()?.setActive(true);
+  } else {
+    globalPlanning?.setActive(false);
+    // Le planning était masqué : vis-timeline doit recalculer ses dimensions.
+    requestAnimationFrame(() => refreshPlanningTimelineLayout());
+  }
+}
+
+function bindGlobalSpace() {
+  if (EMBEDDED_PLANNING_SYNC_MODE) return;
+  document.getElementById("globalViewToggle")?.addEventListener("click", () => {
+    const next = !globalSpaceActive;
+    setState({ globalView: next });
+    applyGlobalSpace(next);
+  });
+  // Le choix de la dernière session est repris.
+  applyGlobalSpace(state.globalView);
+}
+
 async function handleProjectChange(currentState) {
   console.log("Projet sélectionné :", currentState.selectedProject || "(aucun)");
   // La zone du bandeau vient d'être remise à zéro : le tableau de tâches la suit tout de
@@ -2228,6 +2299,7 @@ async function bootstrap() {
     // ARCHIVE vue Synthese v1 : bindSyntheseView();
     bindSyntheseSpace();
     bindStructureLinkDialog();
+    bindGlobalSpace();
     bindSharedProjectZones();
     bindAddZoneModal();
     bindManageZoneModal();
```

- [ ] **Step 6: Add the styles**

Dans `Planning Projet/assets/css/styles.css`, juste avant le commentaire `/* ARCHIVE vue Synthese v1 (jusqu'à la fin du fichier)` (donc après les styles du Gantt ajoutés à la tâche 4), insérer :

```css
/* ==========================================================
   Vue Global : planning Synthèse + Structure fusionné, en lecture seule
   ========================================================== */

/* Bouton « Global » du bandeau : même allure que « Editer », plein quand la vue est active. */
#toolbar .planning-global-toggle {
  min-width: 74px;
  border-color: #b7c7d9;
  font-weight: 700;
  color: #23415f;
  box-shadow: inset 0 0 0 1px rgba(35, 65, 95, 0.05);
}

#toolbar .planning-global-toggle:hover {
  border-color: #7fa7cf;
  background-color: #f1f7ff;
}

#toolbar .planning-global-toggle.is-active {
  border-color: #0f6bb8;
  background-color: #0f6bb8;
  color: #fff;
  box-shadow: 0 2px 8px rgba(15, 107, 184, 0.2);
}

#toolbar .planning-global-toggle.is-active:hover {
  background-color: #0b5a9c;
  border-color: #0b5a9c;
}

/* Modes embarqués (planning-synchro) : pas de vue Global. */
body.planning-sync-embedded #globalViewToggle {
  display: none !important;
}

/* Vue active : elle remplace la frise Structure et le tableau Synthese ; ce qui sert à
   modifier disparaît du bandeau. */
body.is-global-space .planning-header-row,
body.is-global-space #timelineWrapper,
body.is-global-space #planningPaneResizer,
body.is-global-space #planningStatus,
body.is-global-space #syntheseSpace,
body.is-global-space #planningEditToggle,
body.is-global-space #structureLinkToggle,
body.is-global-space #durationDefaultsToggle {
  display: none !important;
}

/* Liste « Zone » : « Ajouter Zone », « Modifier Zone » et leur séparateur n'y ont pas leur place. */
body.is-global-space #zoneDropdown option[value="__add_zone__"],
body.is-global-space #zoneDropdown option[value="__manage_zone__"],
body.is-global-space #zoneDropdown option:disabled {
  display: none;
}

.global-space {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.global-space[hidden] {
  display: none;
}

/* Le tableau reprend la mise en page du tableau de tâches (.stt) et lui ajoute la colonne
   « État ». */
.gpl {
  --stt-left-width: 980px;
  --gpl-col-state: 300px;
  --gpl-level-bg: #dbe5f1;
  --gpl-formwork-bg: #fef3c7;
  --gpl-red: #c00000;
}

.gpl .stt-left {
  grid-template-columns:
    minmax(0, 1fr) var(--stt-col-id2) var(--stt-col-indice) var(--stt-col-duration)
    var(--stt-col-start) var(--stt-col-end) var(--gpl-col-state);
}

.gpl-line .stt-cell--name {
  gap: 4px;
}

.gpl .stt-toggle:focus-visible {
  outline-color: var(--stt-accent);
}

/* Couleurs des lignes : celles de la vue Synthese pour la zone, l'étage, le cycle, la réunion
   et le démarrage ; bleu-gris pour un niveau lié ; jaune des coffrages du planning Structure. */
.gpl-line--zone .stt-left {
  background: var(--stt-zone-bg);
}

.gpl-line--zone .stt-cell {
  color: #000;
  font-weight: 700;
}

.gpl-line--zone .stt-cell--name {
  font-size: 14px;
  text-decoration: underline;
}

.gpl-line--zone .stt-toggle {
  text-decoration: none;
}

.gpl-line--level .stt-left {
  background: var(--gpl-level-bg);
}

.gpl-line--floor .stt-left {
  background: var(--stt-floor-bg);
}

.gpl-line--group.is-nature-cycle .stt-left {
  background: var(--stt-cycle-bg);
}

.gpl-line--task.is-nature-reunion .stt-left {
  background: var(--stt-meeting-bg);
}

.gpl-line--task.is-nature-demarrage .stt-left {
  background: var(--stt-kickoff-bg);
}

.gpl-line--formwork .stt-left {
  background: var(--gpl-formwork-bg);
}

.gpl-line--level .stt-cell,
.gpl-line--floor .stt-cell,
.gpl-line--group .stt-cell {
  font-weight: 700;
}

.gpl-line--formwork .stt-cell {
  font-weight: 600;
}

/* Nombre d'armatures, à côté du nom du coffrage. */
.gpl-count {
  flex: 0 0 auto;
  color: #6b7280;
  font-size: 11px;
  font-weight: 400;
}

/* Colonne « État » : une pastille par alerte, lisible sur toutes les couleurs de ligne. */
.gpl .stt-cell--state {
  gap: 4px;
}

.gpl-state__part {
  flex: 0 1 auto;
  min-width: 0;
  padding: 1px 7px;
  border-radius: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
}

/* La première part, la plus grave, ne se tronque pas. */
.gpl-state__part:first-child {
  flex-shrink: 0;
}

.gpl-state__sep {
  flex: 0 0 auto;
  color: #6b7280;
}

.gpl-state__part.is-tone-late,
.gpl-state__part.is-tone-error {
  background: #fde7e7;
  color: #a51d1d;
}

.gpl-state__part.is-tone-warn {
  background: #fff0d8;
  color: #8b4e00;
}

.gpl-state__part.is-tone-ok {
  background: #e8f5ec;
  color: #1e6b37;
}

.gpl-state__part.is-tone-muted {
  background: #f1f1f1;
  color: #555555;
  font-weight: 400;
}

/* Retard de la Synthèse par rapport à Structure : la date de fin en rouge, qui clignote —
   sauf si le poste demande moins d'animations. */
.gpl .stt-cell--end.is-late {
  color: var(--gpl-red);
  font-weight: 700;
}

@keyframes gpl-blink {
  0%,
  55% {
    opacity: 1;
  }

  56%,
  100% {
    opacity: 0.15;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .gpl .is-blink {
    animation: gpl-blink 1.1s steps(1, end) infinite;
  }
}

/* Barre d'état : compteurs du projet, avertissement de relecture, deux boutons. */
.gpl-bar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--stt-grid);
  background: #f7f7f7;
  font-size: 12px;
}

.gpl-bar__counts {
  flex: 1 1 auto;
  min-width: 0;
}

.gpl-bar__notice {
  color: #b42318;
  font-weight: 600;
}

.gpl-bar__notice[hidden] {
  display: none;
}

.gpl-bar__button {
  padding: 4px 10px;
  border: 1px solid #b7c7d9;
  border-radius: 4px;
  background: #fff;
  color: #23415f;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.gpl-bar__button:hover {
  border-color: #7fa7cf;
  background: #f1f7ff;
}

.gpl-bar__button:focus-visible {
  outline: 2px solid var(--stt-accent);
  outline-offset: 1px;
}

.gpl-bar__button.is-active {
  border-color: var(--gpl-red);
  background: var(--gpl-red);
  color: #fff;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run : `node --check assets/js/main.js && node --test tests/globalWiring.test.mjs tests/structureLinkWiring.test.mjs tests/syntheseGanttWiring.test.mjs tests/syntheseTasksWiring.test.mjs`
Expected: PASS — les 12 nouveaux tests et les trois fichiers de branchement existants.

- [ ] **Step 8: Point de contrôle final (pas de commit)**

Run : `node --test tests/*.test.mjs`
Expected: 545 tests, 0 échec.

Run (depuis la racine du dépôt) : `git status --short`
Expected: en plus des fichiers déjà modifiés avant ce plan, seulement — modifiés : `index.html`, `assets/css/styles.css`, `assets/js/main.js`, `assets/js/state.js`, `assets/js/services/syntheseGanttGeometry.js`, `assets/js/ui/syntheseGantt.js`, les trois tests de branchement ; nouveaux : les quatre fichiers `global*` de `assets/js`, `tests/helpers/globalRows.mjs`, les sept tests `global*`. Rien dans `shared/`.

---

## Vérification à l'écran (utilisateur, sur localhost)

Recharger avec **Ctrl + F5** (les sous-modules n'ont pas de numéro de version). Sur le projet ERA QUAI D'ORSAY de la base de test :

1. Le bouton « Global » est à droite de la liste « Zone ». Un clic : la frise ou le tableau de tâches laisse la place au planning fusionné ; « Editer », « Durées » et « Lien Structure » disparaissent ; le bouton est plein.
2. Zone 2 / BAT B porte « 1 retard Synthèse », clignotant. Le niveau « RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF » affiche « Synthèse en retard de … j ».
3. Déplier le niveau, l'étage, CYCLE 3, PLAN SYT CYCLE 3 : la Fin de « PLAN DE SYNTHESE RESEAUX NIV RDC » clignote en rouge ; dans le Gantt, sa barre est rouge avec le trait pointillé de la limite.
4. Déplier le coffrage 3032 : son armature apparaît dessous, avec un triangle au démarrage des travaux.
5. « Alertes seulement » ne garde que les lignes en défaut ; un second clic rend l'affichage précédent.
6. Changer de service dans la liste Service : la vue ne change pas. Filtrer une zone : une seule section.
7. Re-cliquer « Global » : le planning du service revient, verrouillé (« Editer » relâché). Recharger la page avec la vue active : elle est reprise.
8. Dans planning-synchro (mode embarqué) : pas de bouton « Global ».
