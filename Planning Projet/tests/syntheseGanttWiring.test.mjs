import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const tableJs = await readFile(new URL("../assets/js/ui/syntheseTaskTable.js", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

test("le tableau crée la couche du Gantt hors du corps redessiné", () => {
  assert.match(tableJs, /\} = \{\}, \{ createGantt \} = \{\}\) \{/);
  assert.match(tableJs, /const ganttLayer = createElement\("div", "stt-gantt-layer"\);/);
  assert.match(tableJs, /scroller\.appendChild\(ganttLayer\);/);
  assert.match(tableJs, /createGantt\(\{ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX \}\)/);
});

test("le Gantt est redessiné avec les lignes du tableau, et à chaque changement de largeur", () => {
  const draw = sliceBetween(tableJs, "function draw(", "const renderer = createDeferredRenderer(draw);");
  assert.match(draw, /gantt\?\.render\(message \? \[\] : lines\);/);
  const width = sliceBetween(tableJs, "function applyWidth(", "/* ---------- Rendu ---------- */");
  assert.match(width, /gantt\?\.resize\(\);/);
});

test("main.js branche le Gantt sur la période du planning", () => {
  assert.match(mainJs, /import \{ createSyntheseGantt \} from "\.\/ui\/syntheseGantt\.js";/);
  const timelineImport = sliceBetween(mainJs, "  applyPlanningViewportState,", "} from \"./ui/timeline.js\";");
  ["getPlanningWindow,", "setPlanningWindow,", "subscribePlanningWindowChanges,"].forEach((name) => {
    assert.ok(timelineImport.includes(name), `${name} doit être importé de timeline.js`);
  });
  const factory = sliceBetween(mainJs, "function createSyntheseGanttForTable(", "function getSyntheseTasks(");
  assert.match(factory, /getWindow: getPlanningWindow,/);
  assert.match(factory, /setWindow: \(start, end\) => setPlanningWindow\(start, end, \{ byUser: true \}\),/);
  assert.match(factory, /subscribe: subscribePlanningWindowChanges,/);
});

test("scripts et feuille de style servis dans leur nouvelle version", () => {
  assert.equal(html.includes("20260923-taches1"), false);
  assert.equal(html.includes("20260925-couleurs1"), false);
  assert.ok(html.includes("main.js?v=20261007-lien2"));
  assert.ok(html.includes("styles.css?v=20261007-lien2"));
});
