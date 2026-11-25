import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const timelineJs = await readFile(new URL("../assets/js/ui/timeline.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return source.slice(start, end);
}

const bindFn = sliceBetween(timelineJs, "export function bindPlanningColumnWidths(", "\n}\n");

test("timeline.js branche les poignées de largeur sur les titres de colonne du planning", () => {
  assert.match(timelineJs, /import \{ bindPlanningColumnResize \} from "\.\/planningColumnResize\.js";/);
  assert.match(bindFn, /document\.querySelector\("\.planning-header-left"\)/);
  assert.match(bindFn, /bindPlanningColumnResize\(\{/);
  assert.match(bindFn, /root: document\.documentElement/);
});

// Dans Synchro et synchronisation-plannings, le planning est intégré avec ses colonnes masquées :
// ni poignées, ni largeurs mémorisées.
test("les vues intégrées n'ont pas le réglage des colonnes", () => {
  const guard = bindFn.indexOf("!isPlanningPaneResizeEnabled()");
  assert.ok(guard >= 0, "garde des vues intégrées absente");
  assert.ok(guard < bindFn.indexOf("bindPlanningColumnResize({"), "la garde doit précéder le branchement");
});

test("les poignées ne sont branchées qu'une fois", () => {
  assert.match(bindFn, /if \(planningColumnResize \|\| !isPlanningPaneResizeEnabled\(\)\) return;/);
});

// Chaque mouvement écrit deux variables ; une lecture de style entre les deux doublerait le
// recalcul de toute la page. L'état du volet est relevé une fois, au début du glisser.
test("pendant le glisser, le volet gauche suit la colonne sans rien relire", () => {
  const onResize = sliceBetween(bindFn, "onResize: (delta) => {", "\n    },");
  assert.match(onResize, /paneWidthDuringResize\(planningColumnResizeStart, delta\)/);
  assert.match(onResize, /setProperty\(\s*"--planning-left-panel-width"/);
  ["getComputedStyle", "getCurrentPlanningPaneWidth", "getPlanningPaneNaturalWidth", "readPlanningCssPixelVar", "innerWidth"]
    .forEach((reader) => assert.equal(onResize.includes(reader), false, `${reader} relit le style pendant le glisser`));
  const onStart = sliceBetween(bindFn, "onResizeStart: () => {", "\n    },");
  assert.match(onStart, /paneWidth: getCurrentPlanningPaneWidth\(\)/);
  assert.match(onStart, /getPlanningPaneNaturalWidth\(\)/);
  assert.match(onStart, /viewportWidth: getPlanningViewportWidth\(naturalWidth\)/);
});

// Le séparateur entre le tableau et le planning montre ou cache des colonnes, il n'en règle pas la
// largeur : son libellé ne doit pas se confondre avec celui des poignées des titres.
test("le séparateur du volet ne se présente plus comme le réglage de la largeur des colonnes", () => {
  const separator = sliceBetween(html, 'id="planningPaneResizer"', "></button>");
  assert.doesNotMatch(separator, /largeur des colonnes/);
  assert.doesNotMatch(separator, /Redimensionner les colonnes/);
  assert.match(separator, /title="Glisser pour agrandir ou réduire le tableau ; double-clic : toutes les colonnes"/);
  assert.match(separator, /aria-label="Largeur du tableau du planning"/);
});

const onEnd = sliceBetween(bindFn, "onResizeEnd: ({ moved }) => {", "\n    },");

// Le volet a suivi la colonne dès le premier mouvement : la timeline doit être redessinée même si
// la colonne est revenue à sa largeur de départ. Un simple clic, lui, ne redessine rien.
test("la timeline est redessinée à la fin dès que le glisser a bougé", () => {
  assert.ok(onEnd.indexOf("if (!moved) return;") >= 0);
  assert.ok(onEnd.indexOf("if (!moved) return;") < onEnd.indexOf("refreshPlanningPaneLayout()"));
});

// La largeur du volet a été calculée pendant le glisser : la re-borner à la fin le ferait sauter
// dans une fenêtre étroite, où il s'ouvre plus large que ce que la fenêtre « permet ».
test("la fin du glisser ne re-borne pas le volet", () => {
  assert.equal(onEnd.includes("setPlanningPaneWidth("), false);
  assert.equal(onEnd.includes("clampPlanningPaneWidth("), false);
});

// Un volet laissé à une largeur fixe ne suivrait plus ses colonnes (fenêtre agrandie, largeurs
// d'origine qui changent sous 1250 px).
test("un volet qui montre toutes ses colonnes reprend sa largeur automatique", () => {
  assert.match(
    onEnd,
    /if \(getCurrentPlanningPaneWidth\(\) >= getPlanningPaneNaturalWidth\(\)\) \{\s*document\.documentElement\.style\.removeProperty\("--planning-left-panel-width"\);/
  );
});

test("une colonne ne s'élargit pas jusqu'à passer sous le planning", () => {
  const getMax = sliceBetween(bindFn, "getMaxWidth: (", "\n    }),");
  assert.match(getMax, /maxColumnWidth\(\{/);
  assert.match(getMax, /cellRight: cell\.getBoundingClientRect\(\)\.right/);
  assert.match(getMax, /room: paneRoom\(planningColumnResizeStart\)/);
});

// Colonne élargie sur un grand écran, planning rouvert dans une fenêtre étroite : sa poignée doit
// rester atteignable, à l'ouverture comme quand la fenêtre change de largeur.
test("les largeurs réglées sont ajustées à la fenêtre, à l'ouverture et quand elle change", () => {
  const fit = sliceBetween(bindFn, "fitWidths: (", "\n    }),");
  assert.match(fit, /fitColumnWidths\(\{/);
  assert.match(fit, /viewportWidth: getPlanningViewportWidth\(\)/);
  const paneBind = sliceBetween(timelineJs, "function bindPlanningPaneResizer(", "\n}\n");
  const listener = paneBind.slice(paneBind.indexOf('window.addEventListener("resize"'));
  const refit = listener.indexOf("planningColumnResize?.refit();");
  assert.ok(refit >= 0, "réajustement absent du changement de taille de la fenêtre");
  assert.ok(refit < listener.indexOf("setPlanningPaneWidth("), "les colonnes d'abord, le volet ensuite");
});

test("les bornes et la largeur naturelle du volet viennent du module des colonnes", () => {
  assert.equal(timelineJs.includes("PLANNING_PANE_MIN_WIDTH ="), false, "bornes encore définies dans timeline.js");
  assert.equal(timelineJs.includes("PLANNING_PANE_MIN_TIMELINE_WIDTH"), false);
  assert.match(sliceBetween(timelineJs, "function getPlanningPaneWidthBounds(", "\n}\n"), /paneWidthBounds\(\{ naturalWidth, viewportWidth \}\)/);
  const natural = sliceBetween(timelineJs, "function getPlanningPaneNaturalWidth(", "\n}\n");
  assert.match(natural, /PLANNING_COLUMNS\.reduce\(/);
  assert.match(natural, /columnCssVar\(key\)/);
  assert.equal(timelineJs.includes('"--col-id2"'), false, "liste de colonnes encore écrite en dur dans timeline.js");
});

// Colonnes élargies sur un grand écran puis planning rouvert sur un petit : sans borne, le volet
// gauche prendrait toute la fenêtre et le planning disparaîtrait.
test("à l'ouverture, des colonnes élargies laissent sa place au planning", () => {
  const initial = sliceBetween(timelineJs, "function applyInitialPlanningPaneWidth(", "\n}\n");
  assert.match(initial, /removeProperty\("--planning-left-panel-width"\)/);
  assert.match(initial, /planningColumnResize\?\.hasCustomWidths\(\)/);
  assert.match(initial, /setPlanningPaneWidth\(/);
  assert.match(bindFn, /applyInitialPlanningPaneWidth\(\)/);
  assert.match(sliceBetween(timelineJs, "function bindPlanningPaneResizer(", "\n}\n"), /applyInitialPlanningPaneWidth\(\)/);
  assert.match(sliceBetween(timelineJs, "function resetPlanningPaneWidth(", "\n}\n"), /applyInitialPlanningPaneWidth\(\)/);
});

test("main.js règle les colonnes dès le démarrage, avant de charger les données", () => {
  const imports = sliceBetween(mainJs, "import {\n  applyPlanningViewportState,", '} from "./ui/timeline.js";');
  assert.match(imports, /\bbindPlanningColumnWidths\b/);
  const bootstrap = sliceBetween(mainJs, "async function bootstrap() {", "bindSyntheseSpace();");
  const call = bootstrap.indexOf("bindPlanningColumnWidths();");
  assert.ok(call >= 0, "appel absent du démarrage");
  assert.ok(call < bootstrap.indexOf("initGrist();"), "les largeurs doivent être posées avant le chargement");
});

test("styles : une poignée sur le bord droit de chaque titre, visible au survol", () => {
  assert.match(sliceBetween(css, ".planning-header-left .hcol {", "}"), /position: relative;/);
  const handle = sliceBetween(css, "\n.planning-col-resize {", "}");
  assert.match(handle, /position: absolute;/);
  assert.match(handle, /right: 0;/);
  assert.match(handle, /cursor: col-resize;/);
  assert.match(handle, /touch-action: none;/);
  assert.match(css, /\.planning-col-resize:hover::after/);
});

test("styles : curseur de largeur partout pendant le glisser d'une colonne", () => {
  const cursorRule = sliceBetween(css, "html.is-planning-pane-resizing,", "}");
  assert.match(cursorRule, /html\.is-planning-col-resizing,\s*\nhtml\.is-planning-col-resizing \* \{/);
  assert.match(cursorRule, /cursor: col-resize !important;/);
  assert.match(cursorRule, /user-select: none !important;/);
});

// Les poignées sont ajoutées par le code : le balisage de l'en-tête reste celui que lit l'export Excel.
test("index.html garde son en-tête et charge la nouvelle version", () => {
  assert.equal(html.includes("planning-col-resize"), false);
  assert.ok(html.includes("main.js?v=20261125-colonnes1"));
  assert.ok(html.includes("styles.css?v=20261125-colonnes1"));
});
