// Branchement de la vue Global dans Planning Projet : bouton du bandeau, bascule de vue,
// mémorisation, rafraîchissement, styles.
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
  // Barres Structure dessinées comme dans le planning Structure : ses indices de référence (ceux
  // du service Structure, quel que soit le service affiché) et ses données d'entrées.
  assert.match(factory, /buildProjectRealisationTargetLookup\(cachedProjectAvancementConfigs, "Structure"\)/);
  assert.match(factory, /await fetchPlanningReferenceReceptionSummaries\(projectRows\)\.catch\(/);
  assert.match(factory, /return \{ projectRows, planRows, targetLookup, referenceLookup \};/);
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
  assert.match(css, /\.gpl \.stt-left\s*\{\s*grid-template-columns:\s*minmax\(var\(--gpl-col-name-min\), 1fr\)[^}]*minmax\(var\(--gpl-col-state-min\), var\(--gpl-col-state\)\);/);
  assert.match(css, /\.gpl\s*\{[^}]*--stt-left-width:\s*980px;[^}]*--gpl-col-state:\s*300px;/);
  assert.match(css, /\.gpl\s*\{[^}]*--gpl-col-name-min:\s*180px;[^}]*--gpl-col-state-min:\s*120px;/);
  assert.match(css, /\.gpl-bar\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*4;/);
  assert.match(css, /\.gpl-state__part:first-child\s*\{\s*flex-shrink:\s*0;/);
  assert.match(css, /\.gpl-state__part\.is-tone-late,\s*\.gpl-state__part\.is-tone-error\s*\{[^}]*color:\s*#a51d1d;/);
  assert.match(css, /\.gpl-state__part\.is-tone-warn\s*\{[^}]*color:\s*#8b4e00;/);
  assert.match(css, /\.gpl-state__part\.is-tone-ok\s*\{[^}]*color:\s*#1e6b37;/);
  assert.match(css, /\.gpl-state__part\.is-tone-muted\s*\{/);
  assert.match(css, /\.gpl-line--level \.stt-left\s*\{[^}]*background:\s*var\(--gpl-level-bg\);/);
  assert.match(css, /\.gpl-line--group \.stt-cell,\s*\.gpl-line--type \.stt-cell\s*\{\s*font-weight:\s*700;/, "groupe d'un type : en gras");
  assert.equal(/--gpl-formwork-bg|\.gpl-line--formwork \.stt-left/.test(css), false, "coffrage : la couleur de son type, pas une couleur à part");
  assert.match(css, /\.gpl-line--floor \.stt-left\s*\{[^}]*background:\s*var\(--stt-floor-bg\);/);
  assert.match(css, /\.gpl-bar__button\.is-active\s*\{/);
});

// Lignes des documents Structure : la couleur de leur type dans le tableau du planning Structure
// (`#planningTimeline .group-row-grid.row-type-…`), règle par règle.
test("lignes Structure : mêmes couleurs que le tableau du planning Structure", () => {
  const structure = [...css.matchAll(/^#planningTimeline \.group-row-grid\.row-type-([a-z]+) \{\s*background:\s*([^;]+?)\s*!important;\s*\}/gm)]
    .map((match) => [match[1], match[2].toLowerCase()]);
  assert.deepEqual(structure.map(([type]) => type), ["coffrage", "ndc", "coupes", "demolition", "generic"]);
  const global = new Map([...css.matchAll(/^\.gpl-line\.is-type-([a-z]+) \.stt-left \{\s*background:\s*([^;]+?);\s*\}/gm)]
    .map((match) => [match[1], match[2].toLowerCase()]));
  structure.forEach(([type, color]) => assert.equal(global.get(type), color, type));
  assert.equal(global.size, structure.length, "armature : pas de couleur, comme dans le planning Structure");
});

// Décision du 14/10/2026 : plus rien ne clignote ; la Fin en retard est rouge et grasse, comme
// dans le tableau Synthese (#c00000).
test("Fin en retard : rouge et grasse comme dans le tableau Synthese, sans clignotement", () => {
  assert.match(css, /\.gpl \.stt-cell--end\.is-late\s*\{[^}]*color:\s*var\(--gpl-red\);[^}]*font-weight:\s*700;/);
  assert.match(css, /\.gpl\s*\{[^}]*--gpl-red:\s*#c00000;/);
  assert.equal(/gpl-blink|is-blink/.test(css), false);
});

test("les scripts sont servis dans leur nouvelle version", () => {
  assert.equal(html.includes("20261009-limite3"), false);
  assert.equal(html.split("?v=20261013-global1").length - 1, 3);
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
