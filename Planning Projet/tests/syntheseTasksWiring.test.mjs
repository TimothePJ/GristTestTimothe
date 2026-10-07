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

test("la vue Synthese héberge le tableau de tâches", () => {
  assert.match(html, /<section id="syntheseSpace"[^>]*hidden/);
  assert.match(mainJs, /import \{ createSyntheseTaskTable \} from "\.\/ui\/syntheseTaskTable\.js";/);
  assert.match(mainJs, /import \{ createSyntheseTasksController \} from "\.\/ui\/syntheseTasksController\.js";/);
  assert.match(mainJs, /createTable: \(callbacks\) => createSyntheseTaskTable\(host, callbacks, \{ createGantt: createSyntheseGanttForTable \}\)/);
});

test("le tableau suit le service, le bouton Editer et le filtre Zone", () => {
  const apply = sliceBetween(mainJs, "function applySyntheseSpace(", "function bindSyntheseSpace(");
  assert.match(apply, /getSyntheseTasks\(\)\?\.setActive\(true\)/);
  assert.match(apply, /syntheseTasks\?\.setActive\(false\)/);
  const editing = sliceBetween(mainJs, "function setPlanningEditingEnabled(", "function requirePlanningEditing(");
  assert.match(editing, /syntheseTasks\?\.setEditingEnabled\(isPlanningEditingUnlocked\(\)\)/);
  const zoneChange = sliceBetween(mainJs, "async function handleZoneChange(", "async function bootstrap(");
  assert.match(zoneChange, /syncSyntheseTasksZoneFilter\(\);/);
  const calls = mainJs.split("syncSyntheseTasksZoneFilter();").length - 1;
  assert.ok(calls >= 3, `le filtre doit suivre aussi les normalisations de zone (${calls} appels)`);
});

test("le contrôleur est déclaré avec l'état du module, avant tout usage", () => {
  const declaration = mainJs.indexOf("let syntheseTasks = null;");
  assert.ok(declaration > 0, "déclaration absente");
  assert.ok(declaration < mainJs.indexOf("function setPlanningEditingEnabled("));
});

test("le bouton Durées est masqué dans la vue Synthese", () => {
  assert.match(css, /body\.is-synthese-space #durationDefaultsToggle/);
});

test("les scripts sont servis dans leur nouvelle version", () => {
  assert.equal(html.includes("20260923-zones1"), false);
  assert.ok(html.includes("main.js?v=20261007-lien2"));
});

test("la surveillance de Planning_Projet de main.js rafraîchit aussi le tableau de tâches", () => {
  const watcher = sliceBetween(mainJs, "function bindPlanningDataRefresh(", "function bindPlanningServiceRefresh(");
  assert.match(watcher, /if \(tables\.includes\("Planning_Projet"\)\) void syntheseTasks\?\.refresh\(\);/);
});

test("changement de projet : le filtre de zone du tableau suit tout de suite", () => {
  const handler = sliceBetween(mainJs, "async function handleProjectChange(", "async function handleZoneChange(");
  assert.match(handler, /syncSyntheseTasksZoneFilter\(\);\s*await refreshPlanning\(/);
});
