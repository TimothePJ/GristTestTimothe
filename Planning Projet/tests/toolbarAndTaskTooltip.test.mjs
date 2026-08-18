import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const timelineJs = await readFile(new URL("../assets/js/ui/timeline.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

// La navigation temporelle passe par le zoom et le défilement de la timeline : les
// trois boutons de la barre d'outils faisaient double emploi. Retirés partout, pas
// seulement masqués — un identifiant orphelin réapparaît au premier copier-coller.
test("les boutons de navigation ont disparu du balisage comme du code", () => {
  ["btn-prev", "btn-today", "btn-next", "nav-buttons"].forEach((token) => {
    assert.equal(html.includes(token), false, `${token} encore présent dans index.html`);
    assert.equal(timelineJs.includes(token), false, `${token} encore référencé dans timeline.js`);
    assert.equal(css.includes(token), false, `${token} encore stylé`);
  });
});

test("le libellé dynamique du bouton central ne survit pas en code mort", () => {
  ["updateNavCenterButtonLabel", "getDynamicNavLabel"].forEach((name) => {
    assert.equal(timelineJs.includes(name), false, `${name} devrait avoir disparu`);
  });
});

// Le nom de tâche est coupé par la largeur de sa colonne : le survol doit en montrer
// la totalité, dans la bulle déjà utilisée pour les phases.
test("le survol d'un nom de tâche affiche la bulle de survol", () => {
  assert.match(timelineJs, /function showTaskNameTooltip\(/);
  assert.match(timelineJs, /closest\("\.cell-task"\)/);
  assert.match(timelineJs, /showTaskNameTooltip\(taskCell, pointerEvent\)/);
});

// La recherche de phase renvoie null sur le volet gauche : si elle passait en premier,
// le survol d'un nom de tâche se contenterait de masquer la bulle.
test("le volet gauche est traité avant la recherche d'une phase", () => {
  const handler = timelineJs.slice(
    timelineJs.indexOf("function bindHoverTooltip("),
    timelineJs.indexOf("containerEl.addEventListener(\"mouseleave\"")
  );
  assert.ok(handler.includes("closest(\".cell-task\")"), "le volet gauche doit être testé");
  assert.ok(
    handler.indexOf("closest(\".cell-task\")") < handler.indexOf("getHoverElementFromPoint("),
    "le nom de tâche doit être testé avant la recherche d'élément de timeline"
  );
});
