import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  MIN_NAME_WIDTH,
  buildLinkBadge,
  buildMenuItems,
  createDeferredRenderer,
  dragColumn,
  minLeftWidth,
  readColumnWidths,
} from "../assets/js/ui/syntheseTaskTable.js";

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
  assert.match(css, /--stt-floor-bg:\s*#fce4d6;/);
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

test("Tab sur le nom d'un étage ou d'un groupe garde le focus sur l'étage ou le groupe", () => {
  assert.match(source, /\} else if \(refocus \|\| \(move && target\.kind !== "task"\)\) \{/);
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

test("menu : cycle, sous-groupe et tâche d'un groupe", () => {
  const cycle = { kind: "group", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, nature: "cycle" };
  assert.deepEqual(buildMenuItems(cycle), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203 },
    { label: "Supprimer le cycle", action: "deleteGroup", groupRowId: 203, danger: true },
  ]);
  assert.equal(buildMenuItems({ ...cycle, nature: "sous-groupe", groupRowId: 212 })[1].label, "Supprimer le sous-groupe");
  assert.deepEqual(
    buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, taskId: 204 })[0],
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203 }
  );
});

test("colonnes N° et Indice ; lignes de groupe : saisie du nom, repli, suppression", () => {
  assert.match(source, /\{ field: "id2", label: "N°" \}/);
  assert.match(source, /\{ field: "indice", label: "Indice" \}/);
  assert.match(source, /function startEditingGroup\(groupRowId\)/);
  assert.match(source, /await onRenameGroup\?\.\(target\.groupRowId, value\)/);
  assert.match(source, /\{ type: "toggleGroup", groupRowId: Number\(groupRowId\) \}/);
  assert.match(source, /onDeleteGroup\?\.\(item\.groupRowId\)/);
  assert.match(source, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null\)/);
  assert.match(source, /setStatus,\s*startEditingGroup,/);
  assert.match(source, /input\.maxLength = 50;/);
});

test("styles : couleurs de la capture, colonnes N° et Indice, retraits par niveau", () => {
  assert.match(css, /--stt-cycle-bg:\s*#bfbfbf;/);
  assert.match(css, /--stt-meeting-bg:\s*#bdd7ee;/);
  assert.match(css, /--stt-kickoff-bg:\s*#e6b8b7;/);
  assert.match(css, /\.stt-line--floor \.stt-left\s*\{[^}]*background:\s*var\(--stt-floor-bg\);/);
  assert.match(css, /\.stt-line--group\.is-nature-cycle \.stt-left\s*\{[^}]*background:\s*var\(--stt-cycle-bg\);/);
  assert.match(css, /\.stt-line--task\.is-nature-reunion \.stt-left\s*\{[^}]*background:\s*var\(--stt-meeting-bg\);/);
  assert.match(css, /\.stt-line--task\.is-nature-demarrage \.stt-left\s*\{[^}]*background:\s*var\(--stt-kickoff-bg\);/);
  assert.match(css, /\.stt-line--group\.is-level-3 \.stt-cell--name\s*\{[^}]*padding-left:\s*48px;/);
  assert.match(css, /\.stt-line--task\.is-level-4 \.stt-cell--name\s*\{[^}]*padding-left:\s*78px;/);
});

test("ligne de zone : le vert couvre toutes ses cellules, pas seulement le nom ; texte noir", () => {
  assert.match(css, /--stt-zone-bg:\s*#5a8a3c;/);
  assert.match(css, /\.stt-line--zone \.stt-left\s*\{[^}]*background:\s*var\(--stt-zone-bg\);/);
  assert.match(css, /\.stt-line--zone \.stt-cell\s*\{[^}]*color:\s*#000;/);
});

// ---------- Largeur des colonnes ----------

test("largeurs par défaut : Durée, Début et Fin plus étroites ; le nom prend le reste", () => {
  assert.deepEqual({ ...DEFAULT_COLUMN_WIDTHS }, { id2: 56, indice: 56, duration: 60, start: 92, end: 92 });
  assert.equal(MIN_COLUMN_WIDTH, 36);
  assert.equal(MIN_NAME_WIDTH, 120);
  assert.equal(minLeftWidth(DEFAULT_COLUMN_WIDTHS), 476, "les colonnes + 120 px de nom au moins");
});

test("largeurs mémorisées : relues, bornées, valeurs par défaut pour ce qui manque ou ne va pas", () => {
  assert.deepEqual(readColumnWidths(null), { ...DEFAULT_COLUMN_WIDTHS });
  assert.deepEqual(readColumnWidths("pas du json"), { ...DEFAULT_COLUMN_WIDTHS });
  assert.deepEqual(
    readColumnWidths(JSON.stringify({ duration: 80, start: 10, end: "x", inconnu: 50 })),
    { ...DEFAULT_COLUMN_WIDTHS, duration: 80, start: 36 }
  );
});

test("glisser le bord d'une colonne : elle change de largeur et pousse le Gantt, le nom ne bouge pas", () => {
  const start = { widths: { ...DEFAULT_COLUMN_WIDTHS }, leftWidth: 676 };
  assert.deepEqual(dragColumn(start, "duration", 20), {
    widths: { ...DEFAULT_COLUMN_WIDTHS, duration: 80 },
    leftWidth: 696,
  });
  assert.deepEqual(dragColumn(start, "start", -100), {
    widths: { ...DEFAULT_COLUMN_WIDTHS, start: 36 },
    leftWidth: 620,
  }, "jamais sous 36 px");
  assert.deepEqual(dragColumn(start, "name", 50), { widths: { ...DEFAULT_COLUMN_WIDTHS }, leftWidth: 726 });
  assert.equal(dragColumn(start, "name", -1000).leftWidth, 476, "le nom garde 120 px");
  assert.deepEqual(start, { widths: { ...DEFAULT_COLUMN_WIDTHS }, leftWidth: 676 }, "l'état de départ n'est pas modifié");
});

test("en-tête : une poignée par colonne, double-clic pour revenir à la largeur par défaut, largeurs mémorisées", () => {
  assert.match(source, /createElement\("span", "stt-col-resize"\)/);
  assert.match(source, /head\.addEventListener\("dblclick"/);
  assert.match(source, /setProperty\(`--stt-col-\$\{field\}`/);
  assert.match(source, /COLUMN_WIDTHS_STORAGE_KEY = "planning-projet\.synthese-tasks\.column-widths"/);
  // Nouvelle clé : l'ancienne largeur mémorisée (620 px, colonnes plus larges) est oubliée une fois.
  assert.match(source, /LEFT_WIDTH_STORAGE_KEY = "planning-projet\.synthese-tasks\.left-width\.v2"/);
});

test("styles : une largeur par colonne, poignées dans l'en-tête, séparateur sous l'en-tête", () => {
  assert.match(css, /--stt-left-width:\s*676px;/);
  assert.match(css, /--stt-col-id2:\s*56px;/);
  assert.match(css, /--stt-col-indice:\s*56px;/);
  assert.match(css, /--stt-col-duration:\s*60px;/);
  assert.match(css, /--stt-col-start:\s*92px;/);
  assert.match(css, /--stt-col-end:\s*92px;/);
  assert.match(css, /\.stt-left\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--stt-col-id2\) var\(--stt-col-indice\) var\(--stt-col-duration\) var\(--stt-col-start\) var\(--stt-col-end\);/);
  assert.match(css, /\.stt-line--head \.stt-cell\s*\{[^}]*position:\s*relative;/);
  assert.match(css, /\.stt-col-resize\s*\{[^}]*position:\s*absolute;[^}]*cursor:\s*col-resize;/);
  // Le bord droit de « Fin » dans l'en-tête est sa poignée ; le séparateur commence dessous.
  assert.match(css, /\.stt-splitter\s*\{[^}]*top:\s*var\(--stt-head-height\);/);
});

// Plan de réservations du cycle 3 qui dépasse sa limite de fin (début du plan de coffrage de son étage).
test("limite de fin dépassée : Fin en rouge, la limite en infobulle", () => {
  assert.match(css, /\.stt-line--task\.is-over-limit \.stt-cell--end\s*\{[^}]*color:\s*#c00000;/);
  const building = sliceBetween(source, "function buildLine(", "function draw(");
  assert.match(building, /if \(line\.isOverEndLimit\) element\.classList\.add\("is-over-limit"\);/);
  assert.match(building, /if \(field === "end" && line\.endLimitNote\) cell\.title = line\.endLimitNote;/);
});

// Emblème de lien d'un étage : deux maillons à côté de son nom, verts quand il est lié à un
// coffrage de Structure, rouges sinon ; le survol le dit en toutes lettres.
test("emblème de lien d'un étage : classe et phrase selon le lien", () => {
  const doc = {
    createElement: (tag) => ({ tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
  };
  const linked = buildLinkBadge({ structureLink: "3021", structureLinkNote: "Étage lié au coffrage 3021 de Structure." }, doc);
  assert.deepEqual(
    [linked.tag, linked.className, linked.title, linked.attributes["aria-label"]],
    ["span", "stt-floor-link is-linked", "Étage lié au coffrage 3021 de Structure.", "Étage lié au coffrage 3021 de Structure."]
  );
  const unlinked = buildLinkBadge({ structureLink: "", structureLinkNote: "Étage non lié à un coffrage de Structure." }, doc);
  assert.deepEqual(
    [unlinked.className, unlinked.title],
    ["stt-floor-link is-unlinked", "Étage non lié à un coffrage de Structure."]
  );
});

test("emblème de lien : à côté du nom de l'étage, vert quand il est lié, rouge sinon", () => {
  assert.match(css, /\.stt-floor-link\s*\{[^}]*color:\s*#2e7d32;/);
  assert.match(css, /\.stt-floor-link\.is-unlinked\s*\{[^}]*color:\s*#c00000;/);
  const naming = sliceBetween(source, "function buildNameCell(", "function buildLine(");
  assert.match(naming, /if \(line\.kind === "floor" && line\.structureLinkNote\) cell\.appendChild\(buildLinkBadge\(line\)\);/);
});
