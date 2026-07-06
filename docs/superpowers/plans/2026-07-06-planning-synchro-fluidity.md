# Planning‑synchro — Fluidité du zoom/dézoom (Plan d'implémentation)

> **Pour l'agent qui exécute :** SOUS‑COMPÉTENCE REQUISE — utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour implémenter ce plan tâche par tâche. Les étapes utilisent la syntaxe case à cocher (`- [ ]`).

**But :** Rendre le zoom/dézoom (et le pan) du widget `planning-synchro` fluides, en supprimant le travail lourd exécuté à chaque frame, **sans changer le comportement ni le rendu visuel** au repos.

**Architecture :** Cinq refactors de performance indépendants sur le chemin chaud « un cran de molette → `controller.setViewport` → rAF → `planningRenderer.setWindow` + `chargeBoard.setWindow` + `onRangeLabel` ». On garde le coalescing rAF existant du contrôleur ; on réduit le **coût par frame**.

**Tech Stack :** ES modules vanilla, vis‑timeline (UMD), Chart.js (UMD), grille DOM maison. Vérif : `node --test` (71 tests), `node --check`, harness navigateur (`dev/harness.html`) — piloté désormais par **Playwright** (fonctionnel) et **Chrome DevTools MCP** (mesure de perf/jank). Voir § *Outils & plugins d'optimisation*.

## Contraintes globales

- **NE JAMAIS committer.** L'assistant/agent écrit le code en local uniquement ; **c'est l'utilisateur qui commit**. Aucune étape `git commit`/`git push` (voir mémoire `no-commits-user-commits`). Les étapes « Commit » du format standard sont remplacées par « laisser à l'utilisateur ».
- **Zéro régression visuelle ou comportementale au repos.** Chaque tâche est un refactor de perf : à la fin d'un geste, le rendu doit être **pixel‑identique** à aujourd'hui.
- **Toutes les vérifs existantes doivent rester vertes** après CHAQUE tâche : `node --test` (71), et les contrôles navigateur (rendu, today, today‑align, weld, agg‑fusion, maxzoom, modale, total, chart, filtre).
- **Le trait rouge « aujourd'hui »** reste aligné sur le split (0 px) à tous les zooms — ne pas casser `updateTodayLine`/`toScreen` (voir `planningRenderer.js`).
- **Alignement des 2 panes ≤ 1 px** au repos — l'assertion dev peut être désactivée (Tâche 4) mais l'alignement réel (mesuré par le contrôle « rendu ») doit tenir.
- Node 25 (WebSocket/fetch globaux) pour les scripts CDP ; les scripts auto‑hébergés écoutent sur `:8791` — tuer `python.exe`/tout serveur sur ce port avant de les lancer.

---

## Ordre & dépendances

Tâches **indépendantes** — implémentables/mergeables séparément. Impact décroissant : **1 ≫ 2 > 3 ≈ 5 > 4**. Recommandé : 1, puis 2, puis 3/4/5 dans n'importe quel ordre.

---

## Outils & plugins d'optimisation

Cette tâche est un refactor de **performance navigateur** en JS/CSS vanilla, vérifié sans interface manuelle. Seuls les plugins ci‑dessous apportent une valeur réelle ; ils sont intégrés dans les étapes de chaque tâche.

### Rôle de chaque plugin

- **`chrome-devtools` (MCP) — mesure objective de la fluidité (pièce maîtresse).** C'est l'outil qui transforme « ça saccade » en chiffres. Pour CHAQUE tâche, prendre une trace **avant** (baseline) et **après**, sur le *même* geste de zoom scripté :
  - `navigate_page` → `dev/harness.html`, `emulate_cpu` (throttle ×4 pour rendre le jank reproductible),
  - `performance_start_trace` → dispatch de ~20 `wheel` (via `evaluate_script`) → `performance_stop_trace`,
  - `performance_analyze_insight` pour extraire : **long tasks** sur le thread principal, **forced reflows / layout thrashing**, temps de scripting par frame.
  - **Critère d'acceptation chiffré** par tâche : baisse mesurable des long tasks / reflows sur le geste, sans nouveau warning console (`list_console_messages`).
- **`playwright` (MCP) — vérification fonctionnelle automatisée.** Remplace les scripts CDP ad‑hoc pour les contrôles « navigateur » de chaque tâche (piloter molette/pointer, `browser_snapshot`, `browser_evaluate` pour lire positions/attributs, `browser_take_screenshot`). Sert notamment au **compteur de rebuilds** (Tâche 1), au **diff d'items** (Tâche 2), au **trait today 0 px** (Tâche 5).
- **`context7` (MCP) — API exactes des libs.** Avant d'écrire les Tâches 2 et 5 : `resolve-library-id` + `get-library-docs` pour **vis‑timeline** (`DataSet.add/remove/update`, `Timeline.body.util.toScreen`) et **Chart.js** (`update('none')`), afin d'utiliser les signatures/à‑côtés corrects (pas de suppositions).
- **`feature-dev:code-explorer` (agent) — cartographie avant édition.** Optionnel mais utile en Tâche 1/2 : lister tous les appelants de `chargeBoard.render`/`setWindow` et `applyWindowedItems` pour ne rien casser (édition, persistWrite, contrôleur).
- **`code-simplifier` (agent) — après chaque tâche.** Simplifier le code neuf (debounce/transform, diff de Set, coalescing rAF) en préservant le comportement, avant la revue.
- **`pr-review-toolkit` (agents) — garde‑fou anti‑régression avant « terminé ».** `silent-failure-hunter` (le debounce avale‑t‑il un render nécessaire ? le diff perd‑il un item ? la garde rAF saute‑t‑elle une mise à jour ?), puis `code-reviewer` (conventions, effets de bord). `code-review` (plugin) en second filet léger.
- **`superpowers` — exécution.** `subagent-driven-development` (un sous‑agent par tâche) ou `executing-plans` (inline). Déjà référencé au § *Handoff*.

### Mapping plugin ↔ tâche

| Tâche | context7 (API) | chrome-devtools (perf) | playwright (fonctionnel) | code-simplifier | pr-review-toolkit |
|---|---|---|---|---|---|
| 1 — rebuild pane bas | — | ✅ trace avant/après | ✅ compteur de rebuilds + positions absolues | ✅ | ✅ silent-failure |
| 2 — diff DataSet vis | ✅ `DataSet.add/remove` | ✅ trace dézoom continu | ✅ set d'items == attendu, pas de fantôme | ✅ | ✅ silent-failure |
| 3 — resizer par mode | — | ✅ absence de redraw intra‑mode | ✅ re‑borne aux transitions semaine/mois/année | ✅ | ✅ |
| 4 — assertion dev | — | ✅ 0 reflow d'assertion en prod | ✅ warn actif seulement si flag | — | ✅ |
| 5 — today coalescé | ✅ `toScreen` | ✅ 1 seul reflow/frame | ✅ today à 0 px, masqué hors fenêtre | ✅ | ✅ |

### Plugins **non** utilisés (et pourquoi)

- `commit-commands` — **exclu** : l'utilisateur commit lui‑même (contrainte globale no‑commit).
- `typescript-lsp`, `pyright-lsp` — hors sujet : codebase **JS vanilla** (ni TS, ni Python).
- `figma`, `frontend-design` — aucune nouvelle UI (refactor perf, rendu au repos identique).
- `github`, `supabase`, `vercel`, `telegram`, `desktop-commander`, `playground`, `claude-code-setup`, `claude-md-management`, `skill-creator`, `plugin-dev`, `ralph-loop`, `security-guidance` — hors périmètre de cette tâche.

> Note d'environnement : les MCP `chrome-devtools`, `playwright`, `context7` doivent être **activés/autorisés** dans la session d'exécution (sinon repli sur les scripts CDP maison + `node --test`, déjà en place).

---

### Task 1 — Pane du bas : ne plus reconstruire tout le DOM à chaque frame

> **✅ Implémenté (2026‑07‑06) — variante « throttle seul » (repli documenté).**
> La transform CSS a été **écartée** : chaque ligne est `[cellule nom | cellule frise]` et les DEUX vivent dans `.charge-plan-timeline`, donc un `scaleX` sur la couche déformerait les libellés ouvrier/rôle. À la place : `setWindow` **throttle** le rebuild complet à 1 / 120 ms (front montant + descendant), `render()` restant l'unique committeur (il réinitialise l'horloge et annule tout timer en attente). Résultat mesuré : **20 molettes rapides → 7 rebuilds** (au lieu de ~1/frame), panes alignés à **0 px** au repos, modale d'édition intacte.
> Vérifs : `node --test` 71/71 · throttle 6/6 · rendu 12/12 · total 7/7 · modale 14/14 · agg‑fusion 6/6. Fichier touché : `assets/js/bottom/chargeBoard.js` (aucun changement CSS finalement nécessaire).

**Problème :** [`chargeBoard.setWindow`](../../../planning-synchro/assets/js/bottom/chargeBoard.js) appelle `render()` qui fait `containerEl.innerHTML = …` (reconstruction totale : lignes ouvriers, barres de segments, trame week‑end, ligne Total, toolbar, menu contextuel) **à chaque** apply de viewport (chaque cran de molette / mouvement de pan). C'est le coût dominant.

**Approche :** dissocier **structure** (rare : changement de données) de **position** (chaque frame : zoom/pan). Pendant le geste, appliquer une **transform CSS bon marché** (`translateX` + `scaleX`) sur la couche `.charge-plan-timeline` existante pour qu'elle suive le viewport, et **débouncer** le `render()` complet sur le front descendant (~120 ms après le dernier `setWindow`), qui repositionne en absolu et remet la transform à zéro.

**Files:**
- Modify: `planning-synchro/assets/js/bottom/chargeBoard.js` (fonctions `render` ~L606‑656, `setWindow` L658‑660 ; nouvel état interne)
- Modify: `planning-synchro/assets/css/styles.css` (origine de transform + `will-change` sur `.charge-plan-timeline`)
- Test: `node --test` (comportement pur inchangé) + contrôle navigateur dédié (compteur de rebuilds)

**Interfaces:**
- Consomme : `viewport { firstVisibleDate, rangeEndDate, visibleDays, mode }`, `contentWidthPx` (déjà mesuré dans `render`).
- Produit : API **inchangée** (`render`, `setWindow`, `getVisibleSlots`, `getContentWidthPx`, `destroy`). `setWindow` devient « transform + rebuild débouncé » ; `render` reste synchrone/immédiat (données/édition).

- [ ] **Step 1 : Ajouter l'état de suivi du dernier rendu absolu.** Dans `createChargeBoard`, à côté des `let lastWorkers…`, ajouter :

```js
  // Viewport pour lequel le DOM a été rendu en positions ABSOLUES (dernier
  // render() complet). setWindow s'en sert pour calculer la transform de
  // transition et savoir s'il faut un rebuild immédiat (premier affichage).
  let lastRenderedViewport = null;
  let rebuildTimerId = null;
  const REBUILD_DEBOUNCE_MS = 120;
```

- [ ] **Step 2 : À la fin de `render()`, mémoriser le viewport rendu et neutraliser toute transform de transition.** Juste après l'affectation `containerEl.innerHTML = …` (L646‑655) :

```js
    lastRenderedViewport = viewport;
    const timelineEl = containerEl.querySelector(".charge-plan-timeline");
    if (timelineEl) timelineEl.style.transform = ""; // positions déjà absolues
```

- [ ] **Step 3 : Réécrire `setWindow` en chemin « transform + rebuild débouncé ».** Remplacer L658‑660 par :

```js
  // Jours (fractionnaires) entre deux dates ISO — pour la translation de transition.
  function isoDayDelta(fromIso, toIso) {
    const a = new Date(`${fromIso}T00:00:00`).getTime();
    const b = new Date(`${toIso}T00:00:00`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return (b - a) / (24 * 3600 * 1000);
  }

  function scheduleRebuild(viewport) {
    if (typeof requestAnimationFrame !== "function") {
      render({ workers: lastWorkers, viewport, editMode: lastEditMode });
      return;
    }
    if (rebuildTimerId != null) clearTimeout(rebuildTimerId);
    rebuildTimerId = setTimeout(() => {
      rebuildTimerId = null;
      render({ workers: lastWorkers, viewport, editMode: lastEditMode });
    }, REBUILD_DEBOUNCE_MS);
  }

  function setWindow(viewport) {
    // Premier affichage / pas de base absolue / largeur inconnue -> rendu immédiat.
    const timelineEl =
      containerEl instanceof HTMLElement ? containerEl.querySelector(".charge-plan-timeline") : null;
    if (!viewport || !lastRenderedViewport || !(contentWidthPx > 0) || !timelineEl) {
      render({ workers: lastWorkers, viewport, editMode: lastEditMode });
      return;
    }
    // Transform bon marché : mappe le layout rendu (lastRenderedViewport) vers le
    // nouveau viewport. x_new = x_old * scaleX - dayShift * newDayWidth.
    const oldDays = Math.max(1, Number(lastRenderedViewport.visibleDays) || 1);
    const newDays = Math.max(1, Number(viewport.visibleDays) || 1);
    const oldDayWidth = contentWidthPx / oldDays;
    const newDayWidth = contentWidthPx / newDays;
    const scaleX = oldDayWidth > 0 ? newDayWidth / oldDayWidth : 1;
    const dayShift = isoDayDelta(lastRenderedViewport.firstVisibleDate, viewport.firstVisibleDate);
    const translateX = -dayShift * newDayWidth;
    timelineEl.style.transformOrigin = "left top";
    timelineEl.style.transform = `translateX(${translateX}px) scaleX(${scaleX})`;
    // Rebuild absolu quand le geste se calme.
    scheduleRebuild(viewport);
  }
```

- [ ] **Step 4 : Annuler le timer dans `destroy()` et `clear()`.** Dans `destroy()` (L670) et au début de `clear()` (L597), ajouter :

```js
    if (rebuildTimerId != null) { clearTimeout(rebuildTimerId); rebuildTimerId = null; }
    lastRenderedViewport = null;
```

- [ ] **Step 5 : CSS — préparer la couche à être transformée sans clignotement.** Dans `styles.css`, sur `.charge-plan-timeline`, ajouter `will-change: transform;` et s'assurer que `.charge-plan-scroll` garde `overflow` géré (déjà le cas). Ne rien changer d'autre visuellement.

- [ ] **Step 6 : `node --check` + `node --test`.**
Run: `node --check planning-synchro/assets/js/bottom/chargeBoard.js` → OK ;
`cd planning-synchro && node --test` → **71/71** (le comportement pur — calcul des barres/slots — est inchangé).

- [ ] **Step 7 : Contrôle fonctionnel « compteur de rebuilds » (Playwright).** Instrumenter `render()` pour incrémenter `containerEl.dataset.psRenderSeq`. Via Playwright MCP : `browser_navigate` → harness, sélectionner `HOMONYMES`, lire `psRenderSeq`, `browser_evaluate` pour dispatcher **20 `wheel`** rapides sur `#ps-charge`, attendre ~300 ms, relire.
Attendu : la séquence a incrémenté **≤ 3 fois** (au lieu de ~20), et après stabilisation les barres sont **aux positions absolues correctes** (transform vide, `left`/`width` = valeurs attendues). `browser_take_screenshot` au repos == référence.

- [ ] **Step 8 : Mesure de perf avant/après (Chrome DevTools MCP).** Sur le *même* geste scripté (20 `wheel`, CPU throttlé ×4) : `performance_start_trace` → geste → `performance_stop_trace` → `performance_analyze_insight`.
Attendu : **baisse nette des long tasks / forced reflows** du thread principal vs la baseline prise avant la Tâche 1 ; aucun nouveau message console.

- [ ] **Step 9 : Non‑régression visuelle au repos.** Relancer les contrôles rendu (12), total (7), modale (14), agg‑fusion (6). Tous verts. Puis `code-simplifier` sur le code neuf, puis `pr-review-toolkit:silent-failure-hunter` (le debounce n'avale‑t‑il jamais le render final ?).

- [ ] **Step 10 : Laisser à l'utilisateur pour commit.** (Pas de `git commit`.)

---

### Task 2 — Pane du haut : diff du DataSet vis au lieu de clear()+add()

> **✅ Implémenté (2026‑07‑06).** `appliedItemKey` (chaîne) → `appliedItemIds` (Set) ; `applyWindowedItems` fait `remove(idsSortants)` + `add(itemsEntrants)` ; `render()` fait `clear()` + `new Set()` (nouveau jeu). Vérifs : rendu 12/12 · maxzoom 4/4 · weld 6/6 · today 6/6 · today‑align 2/2 · agg‑fusion 6/6 · 71/71. Fichier : `assets/js/top/planningRenderer.js`.

**Problème :** [`applyWindowedItems`](../../../planning-synchro/assets/js/top/planningRenderer.js) fait `itemsDataSet.clear(); itemsDataSet.add(toVisItems(visible))` dès que l'ensemble visible change (fréquent en dézoom continu) → vis **recrée le DOM de tous les segments**, pas seulement des nouveaux.

**Approche :** remplacer la clé‑chaîne `appliedItemKey` par un `Set` d'ids appliqués, et ne faire que le **delta** : `itemsDataSet.remove(idsSortis)` + `itemsDataSet.add(itemsEntrants)`. Les items déjà présents ne changent pas (leurs `start/end/className/style` ne dépendent pas de la fenêtre), donc aucun `update` nécessaire.

**Files:**
- Modify: `planning-synchro/assets/js/top/planningRenderer.js` (état `appliedItemKey` → `appliedItemIds` ; `applyWindowedItems` L205‑236 ; `render` L307‑311 ; `destroy` L389)
- Test: `node --test` + contrôles navigateur (rendu, maxzoom, weld, today)

**Interfaces:**
- Consomme : `allItems` (items du builder), `lastWindowStartMs/EndMs`.
- Produit : même effet net dans `itemsDataSet` (mêmes items présents pour une fenêtre donnée) — vérifiable identique au comportement actuel.

- [ ] **Step 1 : Remplacer la déclaration d'état.** L146 : remplacer `let appliedItemKey = null;` par :

```js
  // Ids actuellement dans le DataSet vis (fenêtrage). On diffe contre cet
  // ensemble pour ne créer/détruire que les nœuds qui entrent/sortent de la
  // fenêtre, au lieu de tout recréer (clear()+add()).
  let appliedItemIds = new Set();
```

- [ ] **Step 2 : Réécrire le corps de `applyWindowedItems` (à partir de « Skip the DataSet churn… », L228‑236).** Remplacer par un diff :

```js
    // Diff contre l'ensemble appliqué : ne toucher que le delta (vis ne recrée
    // alors que les nœuds entrants/sortants, pas tout le jeu d'items).
    const nextIds = new Set(visible.map((item) => item.id));
    const toRemove = [];
    appliedItemIds.forEach((id) => { if (!nextIds.has(id)) toRemove.push(id); });
    const toAdd = visible.filter((item) => !appliedItemIds.has(item.id));
    if (toRemove.length === 0 && toAdd.length === 0) return;
    if (toRemove.length) itemsDataSet.remove(toRemove);
    if (toAdd.length) itemsDataSet.add(toVisItems(toAdd));
    appliedItemIds = nextIds;
```

- [ ] **Step 3 : Sur nouveau jeu de données (`render`), repartir d'un DataSet vide.** L309‑311 (`allItems = items; appliedItemKey = null; applyWindowedItems();`) remplacer par :

```js
    allItems = items;
    // Nouveau projet/données : vider le DataSet et l'ensemble suivi, puis
    // laisser applyWindowedItems ajouter la fenêtre courante par diff (depuis vide).
    itemsDataSet.clear();
    appliedItemIds = new Set();
    applyWindowedItems();
```

- [ ] **Step 4 : `destroy()` — réinitialiser l'ensemble.** L389 : remplacer `appliedItemKey = null;` par `appliedItemIds = new Set();`.

- [ ] **Step 5 : `node --check` + `node --test`.** `node --check planning-synchro/assets/js/top/planningRenderer.js` → OK ; `node --test` → 71/71.

- [ ] **Step 6 : Contrôles navigateur.** Rendu (12), maxzoom (4), weld (6), today (6), today‑align (2) — tous verts. En plus : dézoom continu (10 crans) sur `HOMONYMES` et vérifier qu'aucun segment « fantôme » à gauche n'apparaît et que le set d'items final == set attendu pour la fenêtre.

- [ ] **Step 7 : Laisser à l'utilisateur pour commit.**

---

### Task 3 — Ne rafraîchir la hauteur du pane haut que si le MODE de zoom change

> **✅ Implémenté (2026‑07‑06).** `lastAppliedMode` (portée par projet) ; `onRangeLabel` n'appelle `topPaneResizer.refresh()` que si `appliedViewport.mode !== lastAppliedMode`. Vérifs : mode‑refresh 4/4 (axe re‑borné + aligné 0 px en semaine/mois/année) · rendu 12/12 · maxzoom 4/4. Fichier : `assets/js/main.js`.

**Problème :** [`main.js` `onRangeLabel`](../../../planning-synchro/assets/js/main.js) appelle `topPaneResizer.refresh()` **à chaque** apply de viewport. Or `refresh()` mesure `axisHeightPx`/`rowHeightPx` (reflow) puis `setMaxHeight` → redraw vis. Le nombre de lignes ne change jamais au zoom/pan ; la hauteur de la bande d'axe ne change **que** lors d'un changement de mode (semaine↔mois↔année).

**Approche :** dans `onRangeLabel`, ne rappeler `refresh()` que si `appliedViewport.mode` a changé depuis le dernier apply (le render de données appelle déjà `refresh()` de son côté, L372).

**Files:**
- Modify: `planning-synchro/assets/js/main.js` (bloc `onRangeLabel` ~L329‑339 ; une variable de suivi)

- [ ] **Step 1 : Ajouter le suivi de mode.** Près des autres `let` de session (ex. à côté de `let lastTopPaneHeightPx = 0;`, L160), ajouter :

```js
  // Dernier mode de zoom appliqué : la hauteur bornée du pane haut ne dépend que
  // du nombre de lignes (invariant au zoom/pan) et de la hauteur de bande d'axe,
  // qui ne change qu'au passage semaine/mois/année. On évite donc de re-mesurer
  // à chaque cran de molette.
  let lastAppliedMode = null;
```

- [ ] **Step 2 : Conditionner le `refresh()` dans `onRangeLabel`.** Remplacer la ligne `if (topPaneResizer) topPaneResizer.refresh();` (L335) par :

```js
        // Ne re-mesurer/re-borner que si le MODE a changé (axe semaine/mois/année) ;
        // un simple pan ou un zoom intra-mode ne change ni le nb de lignes ni l'axe.
        if (topPaneResizer && appliedViewport && appliedViewport.mode !== lastAppliedMode) {
          lastAppliedMode = appliedViewport.mode;
          topPaneResizer.refresh();
        }
```

- [ ] **Step 3 : Réinitialiser le suivi sur changement de données.** Là où le render de projet appelle déjà `topPaneResizer.refresh()` (L372), ajouter juste avant `lastAppliedMode = null;` pour forcer un refresh au premier apply du nouveau projet.

- [ ] **Step 4 : `node --check planning-synchro/assets/js/main.js`** → OK.

- [ ] **Step 5 : Contrôle navigateur.** Sur `HOMONYMES` : (a) zoom intra‑mois (molette) → la hauteur/scroll du pane haut ne « saute » plus et `setMaxHeight` n'est pas rappelé à chaque cran ; (b) cliquer Semaine → Mois → Année : la bande d'axe se re‑borne correctement à chaque changement de mode (pas de rognage). Rendu (12) + maxzoom (4) verts.

- [ ] **Step 6 : Laisser à l'utilisateur pour commit.**

---

### Task 4 — Passer l'assertion d'alignement (dev) derrière un flag

> **✅ Implémenté (2026‑07‑06).** `isAlignmentDebugEnabled()` (= `window.__PS_ALIGN_DEBUG === true`) ; la rAF de suivi n'est planifiée qu'en dev → 0 reflow d'assertion en prod. Alignement réel préservé (rendu 12/12, throttle align@repos 0 px). Fichier : `assets/js/sync/controller.js`.

**Problème :** [`assertAlignment`](../../../planning-synchro/assets/js/sync/controller.js) fait **2 `getBoundingClientRect`** par apply pour un simple `console.warn` de dev — 2 reflows/frame en production, planifiés via une rAF de suivi à chaque `setViewport`.

**Approche :** ne **planifier** la rAF d'assertion que si un flag dev est actif (`window.__PS_ALIGN_DEBUG === true`). Par défaut : rien (zéro reflow). Le vrai alignement reste garanti par construction (arithmétique) et couvert par le contrôle « rendu ».

**Files:**
- Modify: `planning-synchro/assets/js/sync/controller.js` (const de flag ; garde autour de la rAF de suivi L219‑222)

- [ ] **Step 1 : Déclarer le flag** (près de `ALIGNMENT_TOLERANCE_PX`, L40) :

```js
// Assertion d'alignement = filet de sécurité DEV uniquement (console.warn). Elle
// lit le DOM (2 getBoundingClientRect) à chaque apply ; on ne la planifie donc
// qu'en dev, via window.__PS_ALIGN_DEBUG === true. En prod : aucun reflow.
function isAlignmentDebugEnabled() {
  return typeof window !== "undefined" && window.__PS_ALIGN_DEBUG === true;
}
```

- [ ] **Step 2 : Garder la planification de la rAF de suivi.** Dans `setViewport`, entourer le bloc `pendingAssertFrameId = requestAnimationFrame(… assertAlignment(next) …)` (L219‑222) par :

```js
      if (isAlignmentDebugEnabled()) {
        pendingAssertFrameId = requestAnimationFrame(() => {
          pendingAssertFrameId = null;
          assertAlignment(next);
        });
      }
```

(Laisser `assertAlignment` et la logique de cancel inchangées : `destroy()`/le cancel de coalescing gèrent `pendingAssertFrameId` qui reste `null` en prod.)

- [ ] **Step 3 : `node --check planning-synchro/assets/js/sync/controller.js`** → OK.

- [ ] **Step 4 : Contrôle navigateur.** (a) Par défaut : aucun `console.warn` d'alignement, et l'alignement mesuré des 2 panes reste ≤ 1 px (contrôle « rendu » 12/12). (b) En posant `window.__PS_ALIGN_DEBUG = true` puis en zoomant, l'assertion re‑fonctionne (utile pour debug). Vérifier qu'aucun test existant ne dépend du `console.warn`.

- [ ] **Step 5 : Laisser à l'utilisateur pour commit.**

---

### Task 5 — Coalescer `updateTodayLine` à un seul passage par frame

> **✅ Implémenté (2026‑07‑06).** Corps renommé `drawTodayLine` ; `updateTodayLine` planifie un seul rAF gardé (`todayLineFrameId`) → un seul `getBoundingClientRect`/draw par frame ; annulé dans `destroy()`. Vérifs : today 6/6 · today‑align 2/2 (0 px à tous les zooms) · weld 6/6 · 71/71. Fichier : `assets/js/top/planningRenderer.js`.

**Problème :** [`updateTodayLine`](../../../planning-synchro/assets/js/top/planningRenderer.js) fait un `getBoundingClientRect().width` (reflow) et est appelé **à chaque** `changed` de vis (plusieurs fois par zoom) **plus** explicitement dans `setWindow` → reflows multiples/frame.

**Approche :** garder le calcul via `toScreen` (déjà correct), mais **coalescer** l'exécution à une fois par frame via une rAF gardée, appelée à la fois par `changed` et `setWindow`. Un seul `getBoundingClientRect` + une seule écriture de style par frame.

**Files:**
- Modify: `planning-synchro/assets/js/top/planningRenderer.js` (renommer le corps en `drawTodayLine`, ajouter `scheduleTodayLine` ; brancher `changed` L262 et `setWindow` L324)

- [ ] **Step 1 : Renommer le corps existant en `drawTodayLine`** (fonction L159‑189 : garder le corps tel quel, seulement le nom `function drawTodayLine() { … }`).

- [ ] **Step 2 : Ajouter le planificateur coalescé** juste après :

```js
  // Coalesce à un seul passage par frame : vis émet 'changed' plusieurs fois par
  // zoom et setWindow appelle aussi ; sans coalescing on force plusieurs reflows.
  let todayLineFrameId = null;
  function updateTodayLine() {
    if (typeof requestAnimationFrame !== "function") { drawTodayLine(); return; }
    if (todayLineFrameId != null) return;
    todayLineFrameId = requestAnimationFrame(() => {
      todayLineFrameId = null;
      drawTodayLine();
    });
  }
```

- [ ] **Step 3 : Points d'appel inchangés.** `timeline.on("changed", updateTodayLine)` (L262) et l'appel dans `setWindow` (L324) restent — ils pointent maintenant vers la version coalescée. (Le fallback non‑navigateur passe par `drawTodayLine` direct.)

- [ ] **Step 4 : Annuler la frame en attente dans `destroy()`** (L376‑390) :

```js
    if (todayLineFrameId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(todayLineFrameId);
      todayLineFrameId = null;
    }
```

- [ ] **Step 5 : `node --check` + `node --test`** → OK / 71‑71.

- [ ] **Step 6 : Contrôles navigateur.** today (6/6) et today‑align (2/2) — le trait reste à **0 px** du split à tous les zooms (les scripts attendent déjà des doubles rAF, donc la coalescence est transparente). Vérifier qu'il se masque toujours hors fenêtre.

- [ ] **Step 7 : Laisser à l'utilisateur pour commit.**

---

## Auto‑revue (self‑review)

- **Couverture** : Tâche 1 = pane bas (rebuild), 2 = pane haut (items), 3 = resizer, 4 = assertion dev, 5 = trait today — les 5 points de l'analyse fluidité sont couverts, un par tâche.
- **Placeholders** : aucun — chaque étape montre le code réel.
- **Cohérence des types/noms** : `appliedItemIds` (Set) remplace `appliedItemKey` partout (Tâche 2, steps 1/2/3/4) ; `drawTodayLine`/`updateTodayLine` cohérents (Tâche 5) ; `lastRenderedViewport`/`rebuildTimerId`/`scheduleRebuild` cohérents (Tâche 1).
- **Risques** : Tâche 1 est la plus large (transform de transition) ; les barres/labels s'étirent horizontalement **pendant** le geste (transitoire ≤120 ms) puis le rebuild absolu rétablit tout — acceptable et réversible. Si l'étirement gêne, variante de repli : débouncer seul (sans transform) → le pane bas reste figé pendant le geste puis se recale (moins joli mais zéro étirement).

## Handoff d'exécution

Deux options :

1. **Subagent‑Driven (recommandé)** — un sous‑agent frais par tâche, revue entre les tâches, itération rapide. SOUS‑COMPÉTENCE : `superpowers:subagent-driven-development`.
2. **Exécution inline** — tâches exécutées dans cette session, checkpoints de revue. SOUS‑COMPÉTENCE : `superpowers:executing-plans`.

**Prérequis outillage :** activer/autoriser les MCP `chrome-devtools`, `playwright` et `context7` dans la session d'exécution (voir § *Outils & plugins*). À défaut, repli sur les scripts CDP maison + `node --test` (déjà en place) — la mesure de perf chiffrée est alors dégradée mais les non‑régressions restent couvertes.

**Rappel contrainte :** aucune de ces exécutions ne doit `git commit` — l'utilisateur commit lui‑même.
