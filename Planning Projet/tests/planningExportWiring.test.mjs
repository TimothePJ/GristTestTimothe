import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const next = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const ends = [next, nextAsync].filter((index) => index > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test("le bouton « Exporter » suit « Durées » dans le bandeau", () => {
  const toolbar = html.slice(html.indexOf('<div class="filters">'), html.indexOf('<div class="zoom-buttons"'));
  const button = /<button\s+id="planningExportBtn"[\s\S]*?<\/button>/.exec(toolbar)?.[0];
  assert.ok(button, "bouton absent du bandeau");
  assert.ok(toolbar.indexOf('id="durationDefaultsToggle"') < toolbar.indexOf('id="planningExportBtn"'));
  assert.match(button, /type="button"/);
  assert.match(button, />Exporter<\/button>$/);
  // Lire n'est pas modifier : le bouton reste actif en lecture seule.
  assert.match(button, /data-service-context-navigation/);
});

test("le bouton n'apparaît que sur la frise Structure / Topographie", () => {
  const hidden = /([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/g;
  const selectors = [...css.matchAll(hidden)]
    .map((match) => match[1])
    .filter((selector) => selector.includes("#planningExportBtn"))
    .join(",");
  ["body.is-synthese-space", "body.is-global-space", "body.planning-sync-embedded"].forEach((scope) => {
    assert.ok(selectors.includes(`${scope} #planningExportBtn`), `${scope} devrait masquer le bouton`);
  });
});

test("main.js branche l'export au démarrage et exporte toutes les zones", () => {
  assert.match(mainJs, /import \{ buildPlanningExportModel \} from "\.\/services\/planningExport\.js";/);
  assert.match(mainJs, /import \{ createPlanningExportAction \} from "\.\/ui\/planningExportAction\.js";/);
  assert.match(functionBody(mainJs, "bootstrap"), /bindPlanningExport\(\);/);

  const bind = functionBody(mainJs, "bindPlanningExport");
  assert.match(bind, /EMBEDDED_PLANNING_SYNC_MODE/);
  assert.match(bind, /getElementById\("planningExportBtn"\)/);
  assert.match(bind, /collectModel: collectPlanningExportModel/);

  const collect = functionBody(mainJs, "collectPlanningExportModel");
  assert.match(collect, /await fetchPlanningRows\(\)/);
  // Troisième argument vide : aucune zone filtrée, quel que soit le choix du bandeau.
  assert.match(collect, /buildTimelineDataFromPlanningRows\(\s*planningRows,\s*selectedProject,\s*"",/);
  assert.doesNotMatch(collect, /selectedZone/);
  assert.match(collect, /serviceName: currentServiceName\(\)/);
});
