import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const configJs = await readFile(new URL("../assets/js/config.js", import.meta.url), "utf8");
const serviceJs = await readFile(new URL("../assets/js/services/gristService.js", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

test("main.js importe layoutForProject et définit syncSyntheseLayout", () => {
  assert.match(mainJs, /import \{[^}]*\blayoutForProject\b[^}]*\} from "\.\/services\/syntheseLayout\.js";/);
  const sync = sliceBetween(mainJs, "function syncSyntheseLayout(", "function syncSyntheseTasksZoneFilter(");
  assert.match(sync, /layoutForProject\(\s*cachedProjectAvancementConfigs,/);
  assert.match(sync, /syntheseTasks\?\.setLayout\(layout\)/);
  assert.match(sync, /GristServiceContext\?\.getState\?\.\(\)\?\.currentProject/);
});

test("le mode est resynchronisé à la création, au rechargement des projets et au changement de projet", () => {
  assert.match(sliceBetween(mainJs, "function getSyntheseTasks(", "function syncSyntheseLayout("), /syncSyntheseLayout\(\);/);
  assert.match(sliceBetween(mainJs, "function applyProjectBootstrapData(", "function refreshProjectRegistryFromGrist("), /syncSyntheseLayout\(\);/);
  assert.match(sliceBetween(mainJs, "function bindSyntheseSpace(", "function bindStructureLinkDialog("), /syncSyntheseLayout\(\);/);
});

// Au chargement du widget, le contrôleur naît (notification du contexte partagé) avant la lecture
// de Projets2 : bootstrap doit resynchroniser le mode dès que les configurations sont lues.
test("au démarrage, le mode est resynchronisé juste après la lecture des configurations Projets2", () => {
  const boot = sliceBetween(mainJs, "async function bootstrap(", 'document.addEventListener("DOMContentLoaded", bootstrap);');
  const read = sliceBetween(boot, "cachedProjectAvancementConfigs = projectAvancementConfigs;", "initZoneSelector(");
  assert.match(read, /syncSyntheseLayout\(\);/);
});

test("la surveillance de Projets2 relit le registre en forçant les caches", () => {
  const watch = sliceBetween(mainJs, "function bindPlanningDataRefresh(", "globalPlanning?.refresh()");
  assert.match(watch, /tables\.includes\("Projets2"\)/);
  assert.match(watch, /refreshProjectRegistryFromGrist\(\{[^}]*notify: false[^}]*forceRefresh: true[^}]*\}\)/s);
  const refresh = sliceBetween(mainJs, "const requestProjectRegistryRefresh", "function bindPlanningLifecycleRefresh(");
  assert.match(refresh, /forceRefresh = false/);
  assert.match(refresh, /fetchProjectBootstrapData\(\{ forceRefresh \}\)/);
});

test("la colonne Mode est configurée et lue", () => {
  assert.match(configJs, /mode: "Mode"/);
  assert.match(sliceBetween(serviceJs, "function buildProjectAvancementConfigsFromRows(", "export async function fetchProjectBootstrapData("), /modeRaw: row\?\.\[columns\.mode\]/);
  assert.match(sliceBetween(serviceJs, "export async function fetchProjectBootstrapData(", "/* ---------- Planning"), /forceRawRefresh: true/);
});

test("config.js et gristService.js restent en CRLF", () => {
  for (const source of [configJs, serviceJs]) {
    const cr = (source.match(/\r/g) || []).length;
    const lf = (source.match(/\n/g) || []).length;
    assert.equal(cr, lf);
  }
});

// --- Bouton « Par étage » ---

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const stylesCss = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

test("index.html : bouton « Par étage » après « Lien Structure », masqué au départ", () => {
  const link = indexHtml.indexOf('id="structureLinkToggle"');
  const button = indexHtml.indexOf('id="syntheseLayoutToggle"');
  assert.ok(link >= 0 && button > link);
  const markup = sliceBetween(indexHtml.slice(button - 20), "<button", "</button>");
  assert.match(markup, /class="planning-synthese-layout-toggle"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /\bhidden\b/);
  assert.match(markup, />Par &eacute;tage\s*$/);
  assert.match(markup, /title="[^"]*enregistré[^"]*"/);
  assert.doesNotMatch(markup, /data-service-context-navigation/);
});

test("styles.css : le bouton suit l'allure de « Global » et se masque hors Synthese / en Global", () => {
  for (const suffix of ["", ":hover", ".is-active", ".is-active:hover"]) {
    const selector = `#toolbar .planning-synthese-layout-toggle${suffix}`;
    assert.ok(stylesCss.includes(selector), selector);
  }
  assert.match(stylesCss, /body:not\(\.is-synthese-space\) #syntheseLayoutToggle,\s*#syntheseLayoutToggle\[hidden\]\s*\{\s*display: none !important;/);
  assert.match(sliceBetween(stylesCss, "body.is-global-space .planning-header-row,", "{"), /body\.is-global-space #syntheseLayoutToggle/);
});

test("syncSyntheseLayout met aussi le bouton à jour (colonne Mode présente ?)", () => {
  const sync = sliceBetween(mainJs, "function syncSyntheseLayout(", "function syncSyntheseTasksZoneFilter(");
  assert.match(sync, /updateSyntheseLayoutToggle\(\s*layout,\s*hasLayoutModeColumn\(cachedProjectAvancementConfigs,\s*project\)/);
  const update = sliceBetween(mainJs, "function updateSyntheseLayoutToggle(", "async function saveSyntheseLayout(");
  assert.match(update, /hidden = !available \|\| EMBEDDED_PLANNING_SYNC_MODE/);
  assert.match(update, /aria-pressed/);
  assert.match(update, /is-active/);
});

test("getSyntheseTasks passe saveLayout au contrôleur", () => {
  assert.match(sliceBetween(mainJs, "function getSyntheseTasks(", "function syncSyntheseLayout("),
    /saveLayout: \(layout\) => saveSyntheseLayout\(layout\)/);
});

test("saveSyntheseLayout : écrit, patche le cache courant, applique puis relit hors cache", () => {
  const save = sliceBetween(mainJs, "async function saveSyntheseLayout(", "function bindSyntheseLayoutToggle(");
  const order = [
    "applyUserActions",
    "withLayoutMode(cachedProjectAvancementConfigs",
    "syncSyntheseLayout();",
    "refreshProjectRegistryFromGrist(",
  ].map((token) => save.indexOf(token));
  assert.ok(order.every((index) => index >= 0), `jetons manquants : ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(save, /refreshProjectRegistryFromGrist\(\{[^}]*forceRefresh: true[^}]*\}\)/s);
  assert.match(save, /buildLayoutModeActions\(/);
});

test("bootstrap lie le bouton ; son clic appelle changeLayout du contrôleur", () => {
  const boot = sliceBetween(mainJs, "async function bootstrap(", 'document.addEventListener("DOMContentLoaded", bootstrap);');
  assert.match(boot, /bindGlobalSpace\(\);\s*bindSyntheseLayoutToggle\(\);/);
  const bind = sliceBetween(mainJs, "function bindSyntheseLayoutToggle(", "function bindStructureLinkDialog(");
  assert.match(bind, /if \(EMBEDDED_PLANNING_SYNC_MODE\) return;/);
  assert.match(bind, /getElementById\("syntheseLayoutToggle"\)/);
  assert.match(bind, /\.changeLayout\(/);
});
