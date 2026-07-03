# Portage du pane haut planning-synchro = rendu Planning Projet (exact, lecture seule, colonne Tâche) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le rendu simplifié du pane haut de `planning-synchro` par le rendu **exact** de `Planning Projet` (mêmes phases, couleurs, états réalisé/retard, en-têtes de zone, tooltips), mais avec **une seule colonne gauche « Tâche »** alignée sur le pane bas, en **lecture seule**.

**Architecture :** On **vendorise** (copie auto-portante) le pipeline de construction de données de Planning Projet (`planningService.js` + l'util pur `planningRealisation.js`) dans `planning-synchro`, avec 3 shims d'imports. Le rendu continue d'utiliser la **vis-timeline lecture-seule pilotée par le contrôleur de synchro** de planning-synchro (on ne réutilise PAS `timeline.js` de Planning Projet, qui a son propre contrôleur de viewport et casserait la synchro). On adapte seulement la sortie : contenu de groupe = Tâche seule (les en-têtes de zone restent des lignes d'en-tête pleine largeur), items = className + style inline + tooltip tels quels.

**Tech Stack :** ES modules (navigateur), vis-timeline UMD, `node --test` pour l'unitaire, Chrome headless via CDP (Node 25 `WebSocket`/`fetch`) pour la vérif navigateur.

## Global Constraints

- Widget **auto-contenu** : aucun import relatif vers un autre dossier widget (`../../Planning Projet/…`, `../../gestion-depenses2/…`). Tout code réutilisé est **copié** dans `planning-synchro/`.
- **Ne pas régresser** : linking projet, bornes de frise (TimeSegment), synchro horizontale arithmétique (≤ 1px), édition du pane bas, séparateur/frise sticky/bornes 5–16, colonne gauche alignée à `--ps-left-col-width` (220px).
- **Lecture seule** stricte sur le pane haut : `editable:false, selectable:false, zoomable:false, moveable:false` (déjà en place), aucun handler d'édition, aucune modale.
- Noms de colonnes Grist **réels** (mêmes que Planning Projet) : `ID2`, `Taches`/`Tache`, `Groupe`, `Zone`, `Type_doc`, `Ligne_planning`, `Date_limite`, `Duree_1`, `Diff_coffrage`, `Duree_2`, `Diff_armature`, `Duree_3`, `Demarrages_travaux`, `Indice`, `Realise`, `Date_Realise`, `Retards`, `Remarque`, `Nom_XML`.
- Tests unitaires : `node --test "tests/**/*.test.mjs"`. Vérif navigateur via harnais `dev/harness.html` servi en HTTP.
- Commits fréquents, un par tâche. **Ne pas commiter avant validation utilisateur** (contrainte du brief) — les steps « Commit » ci-dessous préparent le message mais l'exécution réelle du commit attend le feu vert.

---

## Structure des fichiers

**Créés :**
- `planning-synchro/assets/js/top/vendor/planningRealisation.js` — copie verbatim de `gestion-depenses2/assets/js/utils/planningRealisation.js` (192 lignes, pur, 0 import).
- `planning-synchro/assets/js/top/vendor/columnsConfig.js` — shim exposant la config colonnes au **format Planning Projet** (`{ grist: { planningTable: { columns }, projectsTable: { columns } } }`) avec les noms réels.
- `planning-synchro/assets/js/top/vendor/planningProjetBuilder.js` — copie de `Planning Projet/assets/js/services/planningService.js`, imports re-shimés, fonctions d'écriture inutiles retirées. Exporte `buildTimelineDataFromPlanningRows`, `buildProjectRealisationTargetLookup`.
- `planning-synchro/tests/planningProjetBuilder.test.mjs` — tests unitaires du builder vendorisé.

**Modifiés :**
- `planning-synchro/assets/js/config.js` — ajouter les colonnes planning manquantes (`realise`, `retards`, `dateRealise`, `remarque`) et `Projets2.Avancement`.
- `planning-synchro/assets/js/top/phases.js` — `buildPlanningItems` délègue au builder vendorisé (garde `aggregatePlanningItems` inchangé pour le toggle « Rassembler »).
- `planning-synchro/assets/js/top/planningRenderer.js` — `toVisGroups`/`toVisItems` : contenu Tâche seule, lignes d'en-tête de zone, `className`+`style`+`title` des items.
- `planning-synchro/assets/js/main.js` — récupérer `Projets2` (Avancement) → `targetLookup`, le passer au rendu du pane haut.
- `planning-synchro/assets/css/styles.css` — porter les règles de phases (palette, `phase-past`, retard, réalisé-complet) + en-têtes de zone, scoping `#ps-planning`.
- `planning-synchro/dev/fixtures.js` — enrichir avec `Indice`/`Realise`/`Retards`, `Projets2.Avancement`, et un projet multi-zones/états.

**Stage 3 (réception, séparé — voir fin) :** `planning-synchro/assets/js/services/referenceReception.js` + config `References2` + CSS bande réception + fixtures `References2`.

---

## Stage 1 — Builder vendorisé + phases exactes + en-têtes de zone (lecture seule, colonne Tâche)

### Task 1 : Vendoriser l'util de réalisation + le shim de config

**Files:**
- Create: `planning-synchro/assets/js/top/vendor/planningRealisation.js`
- Create: `planning-synchro/assets/js/top/vendor/columnsConfig.js`

**Interfaces:**
- Produces: `planningRealisation.js` réexporte tel quel `normalizePlanningDocumentType`, `computePlanningRealisationValue`, `getTargetIndiceForDocumentType`, `buildTargetIndiceByTypeFromAvancement`, `normalizePlanningIndice`, `getPlanningIndiceRank`, `buildPlanningIndiceProgress` (mêmes signatures que la source). `columnsConfig.js` exporte `const APP_CONFIG` de forme `{ grist: { planningTable: { sourceTable, columns }, projectsTable: { sourceTable, columns } } }`.

- [ ] **Step 1 : Copier l'util verbatim**

Copier le contenu intégral de `gestion-depenses2/assets/js/utils/planningRealisation.js` vers `planning-synchro/assets/js/top/vendor/planningRealisation.js`. Ce fichier n'a **aucun import** → aucune adaptation.

- [ ] **Step 2 : Écrire le shim de config**

```js
// planning-synchro/assets/js/top/vendor/columnsConfig.js
// Config au format attendu par le builder vendorisé (planningProjetBuilder.js),
// alimentée par les noms de colonnes réels — repris de Planning Projet/config.js.
export const APP_CONFIG = {
  grist: {
    projectsTable: {
      sourceTable: "Projets2",
      columns: { project: "Nom_de_projet", projectNumber: "Numero_de_projet", avancement: "Avancement" },
    },
    planningTable: {
      sourceTable: "Planning_Projet",
      columns: {
        id: "id", nomProjet: "NomProjet", id2: "ID2", taches: "Taches", tacheAlt: "Tache",
        groupe: "Groupe", zone: "Zone", typeDoc: "Type_doc", lignePlanning: "Ligne_planning",
        nomXml: "Nom_XML", dateLimite: "Date_limite", duree1: "Duree_1", diffCoffrage: "Diff_coffrage",
        duree2: "Duree_2", diffArmature: "Diff_armature", duree3: "Duree_3",
        demarragesTravaux: "Demarrages_travaux", retards: "Retards", remarque: "Remarque",
        indice: "Indice", realise: "Realise", dateRealise: "Date_Realise", projectLink: "NomProjet",
      },
    },
  },
};
```

- [ ] **Step 3 : Vérifier le chargement**

Run: `cd planning-synchro && node --check assets/js/top/vendor/planningRealisation.js && node --check assets/js/top/vendor/columnsConfig.js`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add planning-synchro/assets/js/top/vendor/planningRealisation.js planning-synchro/assets/js/top/vendor/columnsConfig.js
git commit -m "chore(planning-synchro): vendor planningRealisation util + columns config shim"
```

### Task 2 : Vendoriser le builder Planning Projet (imports re-shimés)

**Files:**
- Create: `planning-synchro/assets/js/top/vendor/planningProjetBuilder.js`
- Test: `planning-synchro/tests/planningProjetBuilder.test.mjs`

**Interfaces:**
- Consumes: `planningRealisation.js`, `columnsConfig.js` (Task 1), `toText` de `../../utils/dates.js`.
- Produces: `buildTimelineDataFromPlanningRows(rawRows, selectedProject="", selectedZone="", targetLookup=null, referenceReceptionLookup=null) -> { groups, items }` ; `buildProjectRealisationTargetLookup(projectConfigs=[]) -> Map`. Forme de `groups[]` : `{ id, rowId, isZoneHeader, content, tachesLabel, zoneLabel, zoneHeaderLabel?, sortIndex, meta, ... }`. Forme de `items[]` : `{ id, group, start, end, businessStart, businessEnd, content, phaseLabel, className, style, title, type }`.

- [ ] **Step 1 : Copier le service verbatim**

Copier `Planning Projet/assets/js/services/planningService.js` → `planning-synchro/assets/js/top/vendor/planningProjetBuilder.js`.

- [ ] **Step 2 : Re-shimer les 3 imports (en tête de fichier)**

Remplacer les 3 lignes d'import d'origine :

```js
import { APP_CONFIG } from "../config.js";
import { toText } from "./gristService.js";
import { /* … 7 symboles … */ } from "../../../../gestion-depenses2/assets/js/utils/planningRealisation.js";
```

par :

```js
import { APP_CONFIG } from "./columnsConfig.js";
import { toText } from "../../utils/dates.js";
import {
  buildPlanningIndiceProgress,
  buildTargetIndiceByTypeFromAvancement,
  computePlanningRealisationValue,
  getPlanningIndiceRank,
  getTargetIndiceForDocumentType,
  normalizePlanningDocumentType,
  normalizePlanningIndice,
} from "./planningRealisation.js";
```

- [ ] **Step 3 : Retirer les exports d'écriture inutiles**

Supprimer (fonctions de write-back non utilisées en lecture seule, pour éviter le code mort et d'éventuelles deps) : `buildPlanningRealiseUpdates`, `buildPlanningRetardUpdates`, `buildPlanningListePlanSyncUpdates`, `buildPlanningRealiseUpdates`, et les helpers exclusivement utilisés par elles (`buildPlanningLinkKey`, `buildProjectIdToNameLookup`, `normalizePlanningLinkPart`, `hasPlanningLinkValue` seulement s'ils ne sont pas référencés ailleurs — vérifier par recherche avant suppression). **Garder** `buildTimelineDataFromPlanningRows`, `buildProjectRealisationTargetLookup`, `getReferenceReceptionSummary`, `createReferenceReceptionPhaseItem` et tous leurs helpers (`resolveBandStartDate`, `createSplitPhaseItems`, `buildPhaseClassName`, `buildRetardPhaseStyle`, palette, tooltips, comparateurs de tri, `buildGroupContent`, en-têtes de zone…).

- [ ] **Step 4 : Vérifier qu'il charge et s'exécute (test unitaire minimal)**

```js
// planning-synchro/tests/planningProjetBuilder.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimelineDataFromPlanningRows } from "../assets/js/top/vendor/planningProjetBuilder.js";

const P = "ERA";
const rows = [
  { id: 1, NomProjet: P, ID2: "3001", Zone: "Zone 1", Groupe: "1", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-01", Diff_coffrage: "2027-02-15", Realise: "0" },
  { id: 2, NomProjet: P, ID2: "3002", Zone: "Zone 2", Groupe: "1", Taches: "FONDATIONS - COF", Type_doc: "COFFRAGE", Date_limite: "2027-02-10", Diff_coffrage: "2027-02-24", Realise: "100" },
];

test("builder: 1 groupe par enregistrement + en-têtes de zone", () => {
  const { groups, items } = buildTimelineDataFromPlanningRows(rows, P, "", null, null);
  const taskGroups = groups.filter((g) => !g.isZoneHeader);
  const zoneHeaders = groups.filter((g) => g.isZoneHeader);
  assert.equal(taskGroups.length, 2, "deux enregistrements homonymes -> deux lignes");
  assert.ok(zoneHeaders.length >= 2, "en-têtes de zone présents");
  assert.ok(items.length >= 2, "au moins une bande de phase par tâche");
  items.forEach((it) => {
    assert.equal(typeof it.className, "string");
    assert.ok(it.className.includes("phase-"));
  });
});

test("builder: état réalisé influe sur la className (row.Realise=100)", () => {
  const { items } = buildTimelineDataFromPlanningRows(rows, P, "", null, null);
  const anyComplete = items.some((it) => /realise|complete|past/i.test(it.className));
  assert.ok(anyComplete, "un item porte un état de réalisation");
});
```

- [ ] **Step 5 : Lancer les tests**

Run: `cd planning-synchro && node --test tests/planningProjetBuilder.test.mjs`
Expected: PASS (2/2). Si un import manquant apparaît, corriger le re-shim (Step 2) ou une suppression trop large (Step 3) et relancer.

- [ ] **Step 6 : Commit**

```bash
git add planning-synchro/assets/js/top/vendor/planningProjetBuilder.js planning-synchro/tests/planningProjetBuilder.test.mjs
git commit -m "chore(planning-synchro): vendor Planning Projet timeline builder (read-only)"
```

### Task 3 : Brancher le builder + adapter le renderer (Tâche seule + en-têtes de zone)

**Files:**
- Modify: `planning-synchro/assets/js/config.js`
- Modify: `planning-synchro/assets/js/top/phases.js`
- Modify: `planning-synchro/assets/js/top/planningRenderer.js`

**Interfaces:**
- Consumes: `buildTimelineDataFromPlanningRows` (Task 2).
- Produces: `buildPlanningItems(rows, columns, { project, targetLookup, referenceReceptionLookup } = {})` renvoie `{ groups, items }` où chaque `group` a `label` (Tâche ou nom de zone si `isZoneHeader`), `isZoneHeader`, `titleText`, et chaque `item` a `content`, `className`, `style`, `tooltip`.

- [ ] **Step 1 : Config — colonnes manquantes**

Dans `planning-synchro/assets/js/config.js`, `grist.columns.planningProject`, ajouter `realise: "Realise", retards: "Retards", dateRealise: "Date_Realise", remarque: "Remarque"`. Dans `grist.columns.projects`, ajouter `avancement: "Avancement"`.

- [ ] **Step 2 : phases.js — déléguer au builder vendorisé**

Remplacer le corps de `buildPlanningItems` (la version per-record actuelle) par une délégation :

```js
import { buildTimelineDataFromPlanningRows } from "./vendor/planningProjetBuilder.js";

// Adapte la sortie du builder Planning Projet (groups multi-colonnes + items)
// pour le pane haut : label = Tâche seule (ou nom de zone pour un en-tête),
// titleText = linkage ID2/Zone/Groupe, items inchangés (className/style/tooltip).
export function buildPlanningItems(rows, columns, options = {}) {
  const { project = "", zone = "", targetLookup = null, referenceReceptionLookup = null } = options;
  const { groups, items } = buildTimelineDataFromPlanningRows(
    rows || [], project, zone, targetLookup, referenceReceptionLookup
  );
  const adaptedGroups = groups.map((g) => ({
    id: g.id,
    isZoneHeader: Boolean(g.isZoneHeader),
    label: g.isZoneHeader ? (g.zoneHeaderLabel || g.zoneLabel || "") : (g.tachesLabel || ""),
    titleText: g.isZoneHeader
      ? (g.zoneHeaderLabel || g.zoneLabel || "")
      : [g.tachesLabel, [
          g.id2Label && `ID2 : ${g.id2Label}`,
          g.zoneLabel && `Zone : ${g.zoneLabel}`,
          g.groupeLabel && `Groupe : ${g.groupeLabel}`,
        ].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
  }));
  const adaptedItems = items.map((it) => ({
    id: it.id, group: it.group, start: it.start, end: it.end,
    className: it.className || "", style: it.style || "",
    phaseLabel: it.phaseLabel ?? it.content ?? "",
    tooltip: it.title || it.tooltipHtml || "",
  }));
  return { groups: adaptedGroups, items: adaptedItems };
}
```

Conserver `aggregatePlanningItems`, `buildRowPhases`, `getFirstPhaseDate`, `buildPhaseTooltipHtml` (utilisés ailleurs : toggle agrégat, bornes dérivées `main.js:computePlanningDerivedBounds`, tests). NB : `getFirstPhaseDate` reste basé sur `buildRowPhases`.

- [ ] **Step 3 : planningRenderer.js — dates, styles, en-têtes de zone**

`toVisItems` : passer `start`/`end` tels quels (le builder renvoie des `Date`), ajouter `className`, `style` (inline) et `title` = plain-text de `tooltip`. `toVisGroups` : pour `isZoneHeader`, ajouter `className: "ps-zone-header"` et `content` = nom de zone échappé ; sinon contenu Tâche + `title` = titleText (comportement actuel). `render()` accepte et transmet `options` (project/targetLookup/referenceReceptionLookup) à `buildPlanningItems`.

```js
function toVisItems(items) {
  return (items || []).map((item) => ({
    id: item.id, group: item.group, start: item.start, end: item.end,
    className: item.className || "",
    style: item.style || "",
    content: escapeHtml(item.phaseLabel || ""),
    title: htmlTooltipToPlainText(item.tooltip),
  }));
}
function toVisGroups(groups) {
  return (groups || []).map((group) => {
    const label = group.label || "";
    if (group.isZoneHeader) {
      return { id: group.id, className: "ps-zone-header", content: escapeHtml(label), title: label };
    }
    return { id: group.id, content: escapeHtml(label), title: group.titleText || label };
  });
}
```

- [ ] **Step 4 : node --check + tests existants**

Run: `cd planning-synchro && node --check assets/js/top/phases.js && node --check assets/js/top/planningRenderer.js && node --test "tests/**/*.test.mjs"`
Expected: tous les tests PASS (mettre à jour `tests/phases.test.mjs` si des assertions ciblaient l'ancien `buildPlanningItems` — cf. Step 5).

- [ ] **Step 5 : Adapter tests/phases.test.mjs**

Les tests « homonym » et « order » ciblaient l'ancien `buildPlanningItems(rows, cols)`. Les réécrire pour appeler `buildPlanningItems(rows, cols, { project })` et filtrer les groupes `!isZoneHeader` avant de compter/ordonner (le builder ajoute maintenant des en-têtes de zone). Vérifier : 2 groupes tâche pour homonymes, labels = Tâche, ordre Zone→Ligne→ID2.

- [ ] **Step 6 : Commit**

```bash
git add planning-synchro/assets/js/config.js planning-synchro/assets/js/top/phases.js planning-synchro/assets/js/top/planningRenderer.js planning-synchro/tests/phases.test.mjs
git commit -m "feat(planning-synchro): render top pane via Planning Projet builder (task-only, zone headers, read-only)"
```

### Task 4 : Porter le CSS des phases + en-têtes de zone

**Files:**
- Modify: `planning-synchro/assets/css/styles.css`

**Interfaces:**
- Consumes: classes émises par le builder sur les items (`phase-coffrage`, `phase-armature`, `phase-ndc`, `phase-coupes`, `phase-demolition`, `phase-generic`, `phase-demarrage`, `phase-past`, variantes réalisé/retard) et sur les groupes (`ps-zone-header`).

- [ ] **Step 1 : Porter les règles de phases**

Depuis `Planning Projet/assets/css/styles.css`, porter dans `planning-synchro/assets/css/styles.css` les règles `.vis-item.phase-*` (fonds/bordures/couleurs), `.vis-item.phase-past`, et les variantes réalisé-complet / retard, en **préfixant chaque sélecteur par `#ps-planning`** (scoping). Remplacer les règles `#ps-planning .vis-item.phase-*` déjà présentes (jeu de base) par le jeu complet.

- [ ] **Step 2 : Style des en-têtes de zone**

Ajouter :

```css
#ps-planning .vis-labelset .vis-label.ps-zone-header .vis-inner {
  font-weight: 800;
  text-transform: uppercase;
  font-size: 0.8rem;
  color: #fff;
  background: rgba(0, 73, 144, 0.9);
  border-radius: 6px;
}
#ps-planning .vis-foreground .vis-group.ps-zone-header {
  background: rgba(0, 73, 144, 0.06);
}
```

- [ ] **Step 3 : Vérif navigateur rapide (rendu)**

Servir `dev/harness.html`, sélectionner un projet, vérifier visuellement : bandes de phases colorées comme Planning Projet, en-têtes de zone visibles, colonne gauche = Tâche seule, alignement conservé.

- [ ] **Step 4 : Commit**

```bash
git add planning-synchro/assets/css/styles.css
git commit -m "style(planning-synchro): port Planning Projet phase palette + zone headers (scoped)"
```

---

## Stage 2 — Réalisation par cible (Projets2.Avancement) + fixtures + vérif complète

### Task 5 : Câbler le targetLookup + fixtures + vérif navigateur

**Files:**
- Modify: `planning-synchro/assets/js/main.js`
- Modify: `planning-synchro/dev/fixtures.js`
- Test: script CDP `verify` (scratchpad)

**Interfaces:**
- Consumes: `buildProjectRealisationTargetLookup` (Task 2), `fetchTableRows` (gristService existant).

- [ ] **Step 1 : main.js — récupérer Projets2 + construire le targetLookup**

Au bootstrap, `Projets2` est déjà chargé (`projectRows`). Construire `const targetLookup = buildProjectRealisationTargetLookup(projectAvancementConfigs)` où `projectAvancementConfigs` dérive de `projectRows` (`{ projectId, projectName, projectNumber, avancementConfigRaw: row.Avancement }`). Le passer à `planningRenderer.render({ rows, columns, aggregate, project, targetLookup })`, et à chaque re-render (toggle agrégat inclus).

- [ ] **Step 2 : Fixtures — états réalisé/retard**

Dans `dev/fixtures.js` : ajouter `Indice`/`Realise`/`Retards` variés sur des lignes (ex. `Realise:"100"` réalisé, `Retards:"30"` en retard) et `Avancement` sur `Projets2`. Vérifier via `mock-grist.js` (union de clés déjà en place) que ces colonnes remontent.

- [ ] **Step 3 : Vérif navigateur (CDP)**

Étendre le script CDP : sélectionner un projet, vérifier : (a) items avec classes d'état (`phase-past`, réalisé-complet) présents quand `Realise=100`, (b) en-têtes de zone rendus, (c) colonne gauche = Tâche seule, (d) lecture seule (aucun handle d'édition, `editable:false`), (e) alignement ≤ 1,5px (réutiliser l'assertion existante), (f) frise sticky + séparateur 5–16 toujours OK (rejouer la suite layout 21/21).

Run: `node verify.mjs` (+ le nouveau bloc)
Expected: toutes les vérifs PASS.

- [ ] **Step 4 : Unitaire complet**

Run: `cd planning-synchro && node --test "tests/**/*.test.mjs"`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add planning-synchro/assets/js/main.js planning-synchro/dev/fixtures.js
git commit -m "feat(planning-synchro): wire realisation target lookup (Projets2.Avancement) + fixtures"
```

---

## Stage 3 — Bande « Données d'entrées » (réception, References2) — ✅ FAIT

> Implémenté via `assets/js/services/referenceReception.js` (réimplémentation
> ciblée et **pure** `buildReceptionSummaries` + fetch `fetchPlanningReference…`),
> sans vendoriser le moteur générique de correspondance de `gristService.js`.
> Tests : `tests/referenceReception.test.mjs` (3/3) + vérif navigateur (bandes
> mixte/manquante rendues). CSS déjà porté au Stage 1.

## Stage 3 (plan initial) — Bande « Données d'entrées » (réception, References2)

> **Coût élevé, isolé.** Le linking réception réutilise le moteur générique de correspondance de zones de `gristService.js` (`buildZoneSyncTableContext`, `filterMatchingRowsForZoneSync`, `buildPlanningReferenceChange`, `normalizeLookupText`, `normalizeDocumentNumberForMatch`, `getFirstNonEmptyRowValue`, `normalizeZoneValueForStorage`) + la table `References2`. À porter **après** validation du Stage 1–2. Recommandation : n'entamer ce stage que si le rendu core est validé.

### Task 6 : Vendoriser la réception (References2 + linking)

**Files:**
- Create: `planning-synchro/assets/js/services/referenceReception.js`
- Modify: `planning-synchro/assets/js/config.js` (table `References2` + colonnes `NomProjet/NumeroDocument/Type_document/NomDocument/Zone/Bloquant/DureeLimite/DateLimite/Recu/Emetteur/Reference`)
- Modify: `planning-synchro/assets/js/main.js` (fetch References2 → `fetchPlanningReferenceReceptionSummaries(planningRows)` → passer `referenceReceptionLookup` au rendu)
- Modify: `planning-synchro/assets/css/styles.css` (`.phase-reference-reception--{complete,missing,mixed}`)
- Modify: `planning-synchro/dev/fixtures.js` (+ table `References2`)

- [ ] **Step 1 :** Vendoriser dans `referenceReception.js` : `fetchPlanningReferenceReceptionSummaries` + les helpers de linking (`filterReferenceRowsForPlanningRows`, `buildLinkedReferenceLookup`, `findLinkedReferenceRowsFromLookup`, `findLinkedReferenceRowsForPlanningRow`, `getPlanningSegmentStartDate`, `formatReferenceDateIso`, `parseReferenceDurationLimit`, `subtractWeeksFromDate`, `shiftIsoDate`, `buildPlanningReferenceChange`, `buildZoneSyncTableContext`, `filterMatchingRowsForZoneSync`, `normalizeLookupText`, `normalizeDocumentNumberForMatch`, `getFirstNonEmptyRowValue`, `normalizeZoneValueForStorage`) depuis `Planning Projet/assets/js/services/gristService.js`, en shimant `toText`/`fetchTableRows`/`formatIsoDate` vers les équivalents planning-synchro. Constante `REFERENCES_TABLE_NAME = "References2"`.
- [ ] **Step 2 :** Test unitaire : un `References2` bloquant lié à une ligne planning → `fetchPlanningReferenceReceptionSummaries` renvoie une Map avec `status`/`firstTimelineDateLimiteIso`.
- [ ] **Step 3 :** `main.js` : après chargement des lignes planning, `referenceReceptionLookup = await fetchPlanningReferenceReceptionSummaries(planningRows)` ; le passer au rendu. (Le builder crée déjà la bande via `createReferenceReceptionPhaseItem`.)
- [ ] **Step 4 :** CSS bande réception (porter `.phase-reference-reception*` scoping `#ps-planning`).
- [ ] **Step 5 :** Fixtures `References2` + vérif navigateur : bande « Données d'entrées » présente avec le bon état.
- [ ] **Step 6 :** Commit `feat(planning-synchro): reception band (References2) on top pane`.

---

## Auto-revue (writing-plans)

- **Couverture spec :** phases exactes (Task 2–4), colonne Tâche seule (Task 3), lecture seule (contrainte + existant), en-têtes de zone (Task 2–4), états réalisé/retard depuis colonnes (Task 2) + cible (Task 5), alignement/synchro non régressés (Task 5 vérif), bande réception (Stage 3). ✅
- **Placeholders :** les steps de vendorisation décrivent une copie + éditions d'imports exactes (pas de « TODO ») ; le CSS liste les sélecteurs source à porter + le préfixe de scoping. ✅
- **Cohérence des types :** `buildPlanningItems(rows, columns, options)` produit `{groups:{id,isZoneHeader,label,titleText}, items:{id,group,start,end,className,style,phaseLabel,tooltip}}` consommés par `planningRenderer` (Task 3). ✅
