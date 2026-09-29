import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildMenuItems, createDeferredRenderer } from "../assets/js/ui/syntheseTaskTable.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const source = await readFile(new URL("../assets/js/ui/syntheseTaskTable.js", import.meta.url), "utf8");

function sliceBetween(text, startToken, endToken) {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `bornes introuvables : ${startToken} → ${endToken}`);
  return text.slice(start, end);
}

// Review Focus 1 : une relecture pendant une saisie ne doit pas détruire la cellule.
test("un rafraîchissement pendant une saisie attend la fin de la saisie", () => {
  const drawn = [];
  const renderer = createDeferredRenderer((payload) => drawn.push(payload));
  renderer.render("v1");
  renderer.beginEditing();
  assert.equal(renderer.isEditing, true);
  renderer.render("v2");
  renderer.render("v3");
  assert.deepEqual(drawn, ["v1"]);
  renderer.endEditing();
  assert.deepEqual(drawn, ["v1", "v3"]);
  assert.equal(renderer.isEditing, false);
});

test("fin de saisie sans rafraîchissement : le dernier état est redessiné (annulation)", () => {
  const drawn = [];
  const renderer = createDeferredRenderer((payload) => drawn.push(payload));
  renderer.render("v1");
  renderer.beginEditing();
  renderer.endEditing();
  assert.deepEqual(drawn, ["v1", "v1"]);
});

test("styles : vue masquable, hauteur de ligne fixe, en-tête collant", () => {
  assert.match(css, /\.synthese-space\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /--stt-row-height:\s*26px;/);
  assert.match(css, /\.stt-line--head\s*\{[^}]*position:\s*sticky;/);
  assert.match(css, /\.stt-menu\[hidden\]\s*\{\s*display:\s*none;/);
});

// Grist impose son thème (clair ou sombre) au widget : les boutons et les champs de
// saisie prennent alors les couleurs système, blanches en thème sombre, sur nos fonds
// blancs. Le tableau fixe donc ses couleurs, comme le champ Durée du planning Structure.
test("menu et saisie gardent un texte foncé sur fond clair, même en thème sombre", () => {
  assert.match(css, /\.stt\s*\{[^}]*color-scheme:\s*light;/);
  assert.match(css, /\.stt-menu__item\s*\{[^}]*[\s{;]color:\s*#1f2937;/);
  assert.match(css, /\.stt-input\s*\{[^}]*[\s{;]color:\s*#1f1f1f;/);
  assert.match(css, /\.stt-input\s*\{[^}]*caret-color:\s*#1f1f1f;/);
});

test("Durée saisie en texte : la molette ne change pas la valeur ; rien n'est bloqué pendant l'enregistrement", () => {
  const editing = sliceBetween(source, "function startEditing(", "async function finishEditing(");
  assert.match(editing, /input\.type = "text";\s*input\.inputMode = "numeric";/);
  assert.equal(editing.includes('input.type = "number"'), false);
  const finishing = sliceBetween(source, "async function finishEditing(", "/* ---------- Menu contextuel ---------- */");
  assert.equal(finishing.includes("disabled = true"), false);
  assert.equal(finishing.includes("is-saving"), false);
});

test("replier / déplier une zone reste possible en lecture seule", () => {
  assert.match(source, /toggle\.dataset\.serviceContextNavigation = "";/);
});

test("l'en-tête collant ne masque pas la ligne en saisie", () => {
  assert.match(css, /\.stt-scroll\s*\{[^}]*scroll-padding-top:\s*var\(--stt-head-height\);/);
  assert.equal(/\.stt-cell\.is-saving/.test(css), false);
});

test("menu contextuel selon la ligne", () => {
  const zone = { kind: "zone", zoneKey: "zonez3a", floorKey: "" };
  assert.deepEqual(buildMenuItems(zone), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "" },
    { label: "Ajouter un étage", action: "addFloor", zoneKey: "zonez3a", disabled: false },
  ]);
  assert.equal(buildMenuItems(zone, { canAddFloor: false })[1].disabled, true);
  assert.deepEqual(buildMenuItems({ kind: "zone", zoneKey: "", floorKey: "" }).map((item) => item.action), ["addTask"]);
  assert.deepEqual(buildMenuItems({ kind: "floor", zoneKey: "zonez3a", floorKey: "phrdb" }), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb" },
    { label: "Supprimer l'étage", action: "deleteFloor", zoneKey: "zonez3a", floorKey: "phrdb", danger: true },
  ]);
  assert.deepEqual(buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "phrdb", taskId: 5 }), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb" },
    { label: "Supprimer la tâche", action: "deleteTask", taskId: 5, danger: true },
  ]);
  assert.deepEqual(buildMenuItems(null), []);
});

test("étages dans le tableau : saisie du nom, repli, poignée seulement en mode modifiable", () => {
  assert.match(source, /function startEditingFloor\(zoneKey, floorKey\)/);
  assert.match(source, /await onRenameFloor\?\.\(target\.zoneKey, target\.floorKey, value\)/);
  assert.match(source, /\{ type: "toggleFloor", zoneKey, floorKey \}/);
  assert.match(source, /if \(line\.kind === "task" && editable\) \{\s*const grip = createElement\("span", "stt-grip"/);
  assert.match(source, /startEditingFloor,\s*setStatus,/);
});

test("styles des étages, de la poignée et de l'enregistrement en cours", () => {
  assert.match(css, /--stt-floor-bg:\s*#c6e0b4;/);
  assert.match(css, /\.stt-line--floor \.stt-cell--name\s*\{[^}]*background:\s*var\(--stt-floor-bg\);/);
  assert.match(css, /\.stt-line--task\.is-in-floor \.stt-cell--name\s*\{[^}]*padding-left:\s*46px;/);
  assert.match(css, /\.stt-grip\s*\{[^}]*visibility:\s*hidden;/);
  assert.match(css, /\.stt-line--task:hover \.stt-grip\s*\{[^}]*visibility:\s*visible;/);
  assert.match(css, /\.stt-status\[data-tone="saving"\]\s*\{/);
  assert.match(css, /\.stt-menu__item\.is-disabled\s*\{/);
});

test("étages au clavier et en saisie : Entrée sur le triangle replie, focus retrouvé, champ pleine largeur", () => {
  assert.match(
    source,
    /if \(event\.key === "Enter" \|\| event\.key === "F2"\) \{\s*const action = actionAt\(target, lineElement\);/
  );
  assert.match(
    source,
    /findFloorCell\(target\.zoneKey, target\.floorKey\)\s*\|\| findFloorCell\(target\.zoneKey, floorKeyOf\(value\)\)/
  );
  assert.match(css, /\.stt-line--task\.is-in-floor \.stt-cell--name\.is-editing\s*\{[^}]*padding-left:\s*0;/);
  assert.match(css, /\.stt-line--floor \.stt-toggle:focus-visible\s*\{[^}]*outline-color:\s*var\(--stt-accent\);/);
});

test("le tableau branche le glisser-déposer sur le déplacement de tâche", () => {
  assert.match(source, /import \{ createTaskDrag \} from "\.\/syntheseTaskDrag\.js";/);
  assert.match(source, /onDrop: \(taskId, target\) => onMoveTask\?\.\(taskId, target\),/);
  assert.match(source, /isEnabled: \(\) => editable,/);
  assert.match(source, /if \(line\.key === dropTargetKey\) element\.classList\.add\("is-drop-target"\);/);
  assert.match(css, /\.stt-drag-ghost\s*\{[^}]*position:\s*fixed;/);
  assert.match(css, /\.stt-line\.is-drop-target \.stt-cell--name\s*\{/);
});

test("tableau devenu non modifiable pendant un glisser : le glisser est annulé ; poignée tactile", () => {
  assert.match(source, /taskDrag = createTaskDrag\(\{/);
  assert.match(source, /if \(!editable\) taskDrag\?\.cancel\(\);/);
  assert.match(css, /\.stt-grip\s*\{[^}]*touch-action:\s*none;/);
});

test("Tab sur le nom d'un étage garde le focus sur l'étage", () => {
  assert.match(source, /\} else if \(refocus \|\| \(move && target\.kind === "floor"\)\) \{/);
});

test("glisser : copie de la ligne tenue par la poignée, ligne d'origine estompée, main fermée partout", () => {
  assert.match(source, /renderPreview: renderDragPreview,/);
  assert.match(source, /markSource: markDragSource,/);
  assert.match(source, /const element = buildLine\(line\);/);
  assert.match(source, /if \(line\.key === dragSourceKey\) element\.classList\.add\("is-drag-source"\);/);
  assert.match(css, /\.stt-line\.is-drag-source\s*\{[^}]*opacity:/);
  assert.match(css, /\.stt-drag-ghost \.stt-grip\s*\{[^}]*visibility:\s*visible;/);
  assert.match(css, /\.stt-drag-ghost__label\[hidden\]\s*\{[^}]*display:\s*none;/);
  assert.match(css, /html\.is-stt-dragging \*\s*\{[^}]*cursor:\s*grabbing !important;/);
});

test("Durée : ↑ / ↓ et boutons ▲▼ changent la valeur d'un jour sans fermer la saisie", () => {
  assert.match(source, /import \{ floorKeyOf, formatDate, formatDuration, stepDurationText \} from/);
  // Dans la saisie : ↑ / ↓ ; la valeur reste sélectionnée.
  assert.match(
    source,
    /\} else if \(field === "duration" && \(event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"\)\) \{\s*event\.preventDefault\(\);\s*stepDuration\(event\.key === "ArrowUp" \? 1 : -1\);/
  );
  assert.match(source, /editor\.input\.value = stepDurationText\(editor\.input\.value, step\);/);
  // Boutons ▲▼ : l'appui ne prend pas le focus (la saisie resterait sinon fermée par la perte du focus).
  assert.match(source, /button\.addEventListener\("mousedown", \(event\) => event\.preventDefault\(\)\);/);
  assert.match(source, /button\.addEventListener\("click", \(\) => stepDuration\(step\)\);/);
  assert.match(source, /button\.tabIndex = -1;/);
  // Cellule Durée sélectionnée sans saisie : ↑ / ↓ ouvre la saisie avec la valeur déjà changée.
  assert.match(
    source,
    /startEditing\(taskId, "duration"\);\s*stepDuration\(event\.key === "ArrowUp" \? 1 : -1\);/
  );
  assert.match(css, /\.stt-spin\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.stt-spin__button\s*\{[^}]*color:\s*#1f1f1f;/);
  assert.match(css, /\.stt-cell--duration\.is-editing \.stt-input\s*\{[^}]*min-width:\s*0;/);
});
