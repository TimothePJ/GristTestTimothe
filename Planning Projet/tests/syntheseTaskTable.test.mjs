import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  TABLE_COLUMNS,
  cellText,
  isEditableCell,
  MIN_NAME_WIDTH,
  buildLinkBadge,
  buildMenuItems,
  createDeferredRenderer,
  dragColumn,
  minLeftWidth,
  placeOfDropSlot,
  readColumnWidths,
  readLeftWidth,
} from "../assets/js/ui/syntheseTaskTable.js";

import { buildRowModel, buildSections } from "../assets/js/services/syntheseTaskModel.js";
import { eraSs1Rows } from "./helpers/eraSs1Rows.mjs";

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
    { label: "Ajouter un cycle", action: "addCycle", zoneKey: "zonez3a", floorKey: "phrdb", parentGroupRowId: null, disabled: false },
    { label: "Supprimer l'étage", action: "deleteFloor", zoneKey: "zonez3a", floorKey: "phrdb", danger: true },
  ]);
  assert.deepEqual(buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "phrdb", taskId: 5 }), [
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "phrdb", afterTaskId: 5 },
    { label: "Modifier le lien…", action: "editLink", taskId: 5, disabled: false },
    { label: "Contrôler par rapport au coffrage", action: "setFormworkCheck", taskId: 5, checked: true },
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
  assert.match(css, /\.stt-line--task\.is-in-floor \.stt-cell--name\s*\{[^}]*padding-left:\s*calc\(14px \+ var\(--stt-level, 2\) \* 16px\);/);
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
    { label: "Ajouter un sous-cycle", action: "addCycle", zoneKey: "zonez3a", floorKey: "ss1", parentGroupRowId: 203, disabled: false },
    { label: "Supprimer le cycle", action: "deleteGroup", groupRowId: 203, danger: true },
  ]);
  assert.equal(buildMenuItems(cycle, { canAddCycle: false })[1].disabled, true);
  assert.equal(buildMenuItems({ ...cycle, nature: "sous-groupe", groupRowId: 212 })[2].label, "Supprimer le sous-cycle");
  assert.deepEqual(
    buildMenuItems({ kind: "task", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, taskId: 204 })[0],
    { label: "Ajouter une tâche", action: "addTask", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 203, afterTaskId: 204 }
  );
});

test("menu d'étage : « Ajouter un cycle » grisé sans les colonnes du modèle", () => {
  const floor = { kind: "floor", zoneKey: "zonez3a", floorKey: "ss1" };
  assert.equal(buildMenuItems(floor, { canAddCycle: false })[1].disabled, true);
});

test("menu d'un cycle : passer en escalier ou en parallèle selon son mode actuel", () => {
  const cycle = { kind: "group", zoneKey: "zonez3a", floorKey: "ss1", groupRowId: 212, nature: "sous-groupe" };
  const toSeries = { label: "Passer en escalier", action: "setCycleMode", groupRowId: 212, mode: "series" };
  const toParallel = { label: "Passer en parallèle", action: "setCycleMode", groupRowId: 212, mode: "parallel" };
  const modeItems = (line, options) => buildMenuItems(line, options).filter((item) => item.action === "setCycleMode");
  assert.deepEqual(modeItems({ ...cycle, cycleMode: "parallel" }), [toSeries]);
  assert.deepEqual(modeItems({ ...cycle, cycleMode: "series" }), [toParallel]);
  assert.deepEqual(modeItems({ ...cycle, cycleMode: "mixed" }), [toSeries, toParallel]);
  assert.deepEqual(modeItems({ ...cycle, cycleMode: null }), []);
  assert.deepEqual(modeItems({ ...cycle, cycleMode: "mixed" }, { canSetCycleMode: false }), []);
  // Juste avant la suppression du cycle.
  assert.deepEqual(buildMenuItems({ ...cycle, cycleMode: "series" }).map((item) => item.action), [
    "addTask", "addCycle", "setCycleMode", "deleteGroup",
  ]);
  assert.ok(source.includes("onSetCycleMode?.(item.groupRowId, item.mode)"));
  assert.ok(source.includes("canSetCycleMode = options?.canSetCycleMode !== false;"));
});

test("l'entrée « Ajouter un cycle » appelle onAddCycle ; l'option canAddCycle est lue au rendu", () => {
  assert.ok(source.includes("onAddCycle?.(item.zoneKey, item.floorKey, item.parentGroupRowId ?? null)"));
  assert.ok(source.includes("canAddCycle = options?.canAddCycle !== false;"));
});

test("colonnes N° et Indice ; lignes de groupe : saisie du nom, repli, suppression", () => {
  assert.match(source, /\{ field: "id2", label: "N°" \}/);
  assert.match(source, /\{ field: "indice", label: "Indice" \}/);
  assert.match(source, /function startEditingGroup\(groupRowId\)/);
  assert.match(source, /await onRenameGroup\?\.\(target\.groupRowId, value\)/);
  assert.match(source, /\{ type: "toggleGroup", groupRowId: Number\(groupRowId\) \}/);
  assert.match(source, /onDeleteGroup\?\.\(item\.groupRowId\)/);
  assert.match(source, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null, item\.afterTaskId \?\? null\)/);
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
  assert.match(css, /\.stt-line--group \.stt-cell--name\s*\{[^}]*padding-left:\s*calc\(var\(--stt-level, 2\) \* 16px\);/);
  assert.match(css, /\.stt-line--group \.stt-cell--name\.is-editing\s*\{[^}]*padding-left:\s*0;/);
  // Retrait sans plafond : une variable par ligne, plus de classe par niveau.
  assert.doesNotMatch(css, /is-level-/);
  assert.doesNotMatch(source, /is-level-/);
  assert.match(source, /element\.style\.setProperty\("--stt-level", String\(line\.level\)\)/);
  assert.match(source, /group: "Nom du cycle"/);
});

test("ligne de zone : le vert couvre toutes ses cellules, pas seulement le nom ; texte noir", () => {
  assert.match(css, /--stt-zone-bg:\s*#5a8a3c;/);
  assert.match(css, /\.stt-line--zone \.stt-left\s*\{[^}]*background:\s*var\(--stt-zone-bg\);/);
  assert.match(css, /\.stt-line--zone \.stt-cell\s*\{[^}]*color:\s*#000;/);
});

// ---------- Largeur des colonnes ----------

test("largeurs par défaut : Durée, Début et Fin plus étroites ; le nom prend le reste", () => {
  assert.deepEqual({ ...DEFAULT_COLUMN_WIDTHS }, { line: 36, id2: 56, indice: 56, duration: 60, start: 92, end: 92, link: 72 });
  assert.equal(MIN_COLUMN_WIDTH, 36);
  assert.equal(MIN_NAME_WIDTH, 120);
  assert.equal(minLeftWidth(DEFAULT_COLUMN_WIDTHS), 584, "les colonnes + 120 px de nom au moins");
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
  assert.equal(dragColumn(start, "name", -1000).leftWidth, 584, "le nom garde 120 px");
  assert.deepEqual(start, { widths: { ...DEFAULT_COLUMN_WIDTHS }, leftWidth: 676 }, "l'état de départ n'est pas modifié");
});

test("en-tête : une poignée par colonne, double-clic pour revenir à la largeur par défaut, largeurs mémorisées", () => {
  assert.match(source, /createElement\("span", "stt-col-resize"\)/);
  assert.match(source, /head\.addEventListener\("dblclick"/);
  assert.match(source, /setProperty\(`--stt-col-\$\{field\}`/);
  assert.match(source, /COLUMN_WIDTHS_STORAGE_KEY = "planning-projet\.synthese-tasks\.column-widths"/);
  // Nouvelle clé : l'ancienne largeur mémorisée (sans les colonnes N° de ligne et Lien) est oubliée une fois.
  assert.match(source, /LEFT_WIDTH_STORAGE_KEY = "planning-projet\.synthese-tasks\.left-width\.v3"/);
});

test("styles : une largeur par colonne, poignées dans l'en-tête, séparateur sous l'en-tête", () => {
  assert.match(css, /--stt-left-width:\s*784px;/);
  assert.match(css, /--stt-col-line:\s*36px;/);
  assert.match(css, /--stt-col-link:\s*72px;/);
  assert.match(css, /--stt-col-id2:\s*56px;/);
  assert.match(css, /--stt-col-indice:\s*56px;/);
  assert.match(css, /--stt-col-duration:\s*60px;/);
  assert.match(css, /--stt-col-start:\s*92px;/);
  assert.match(css, /--stt-col-end:\s*92px;/);
  assert.match(css, /\.stt-left\s*\{[^}]*grid-template-columns:\s*var\(--stt-col-line\) minmax\(0, 1fr\) var\(--stt-col-id2\) var\(--stt-col-indice\) var\(--stt-col-duration\) var\(--stt-col-start\) var\(--stt-col-end\) var\(--stt-col-link\);/);
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

// ---------- Ordre libre (colonne Ordre) ----------

test("« Ajouter une tâche » sur une tâche : la tâche cliquée va au contrôleur", () => {
  const running = sliceBetween(source, "function runMenuItem(", "function openMenu(");
  assert.match(running, /onAddTask\?\.\(item\.zoneKey, item\.floorKey, item\.groupRowId \?\? null, item\.afterTaskId \?\? null\)/);
});

test("glisser entre deux tâches : seulement avec la colonne Ordre, en mode modifiable ; trait d'insertion", () => {
  assert.match(source, /canOrder = Boolean\(options\?\.canOrder\);/);
  assert.match(source, /canOrder: \(\) => canOrder && editable,/);
  assert.match(source, /markSlot: markDropSlot,/);
  const placing = sliceBetween(source, "function placeDropLine(", "function markDropSlot(");
  assert.match(placing, /placeOfDropSlot\(lines, dropSlot, \{ headHeight: HEAD_HEIGHT_PX, rowHeight: ROW_HEIGHT_PX, offsetPx: columnWidths\.line \}\)/);
  assert.match(placing, /dropLine\.style\.top = \`\$\{place\.top\}px\`;/);
  assert.match(placing, /dropLine\.style\.left = \`\$\{place\.left\}px\`;/);
  assert.match(sliceBetween(source, "function draw(", "const renderer ="), /placeDropLine\(\);/);
  assert.match(css, /\.stt-drop-line\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*1;[^}]*height:\s*2px;[^}]*background:\s*var\(--stt-accent\);[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.stt-drop-line\[hidden\]\s*\{\s*display:\s*none;/);
});

test("place du trait d'insertion : limite haute ou basse de la ligne visée, au retrait de son niveau", () => {
  const lines = buildRowModel(buildSections({ rows: eraSs1Rows() }));
  assert.deepEqual(placeOfDropSlot(lines, { groupRowId: 985, side: "before" }), { top: 32 + 26 * 3, left: 32 });
  assert.deepEqual(placeOfDropSlot(lines, { taskId: 1000, side: "after" }), { top: 32 + 26 * 20, left: 48 });
  assert.deepEqual(placeOfDropSlot(lines, { taskId: 1000, side: "before" }, { headHeight: 0, rowHeight: 10, indentPx: 1 }), { top: 190, left: 3 });
  assert.equal(placeOfDropSlot(lines, { taskId: 9999, side: "after" }), null);
  assert.equal(placeOfDropSlot(lines, { groupRowId: 9999, side: "before" }), null);
  assert.equal(placeOfDropSlot(lines, null), null);
});

test("poignée d'un cycle : avant le triangle de repli, seulement avec canMoveCycles ; survol au CSS", () => {
  assert.match(source, /line\.kind === "group" && editable && canMoveCycles/);
  assert.match(source, /Glisser pour déplacer le sous-cycle/);
  assert.match(source, /Glisser pour déplacer le cycle/);
  assert.match(source, /canMoveCycles = options\?\.canMoveCycles === true;/);
  assert.match(source, /canMoveCycles: \(\) => canMoveCycles && editable,/);
  assert.match(source, /onDropCycle: \(groupRowId, target\) => onMoveCycle\?\.\(groupRowId, target\),/);
  assert.match(css, /\.stt-line--group:hover \.stt-grip\s*\{[^}]*visibility:\s*visible;/);
  assert.match(css, /\.stt-line--group \.stt-grip\s*\{[^}]*margin-right:\s*0;/);
  const naming = sliceBetween(source, "function buildNameCell(", "function buildLine(");
  assert.ok(naming.indexOf('"stt-grip"') < naming.indexOf('"stt-toggle"'), "la poignée précède le triangle");
});

// ---------- Colonnes N° de ligne et Lien ----------

test("colonnes : N° de ligne tout à gauche, Lien après Fin", () => {
  assert.deepEqual(TABLE_COLUMNS.map((column) => column.field), ["line", "name", "id2", "indice", "duration", "start", "end", "link"]);
  assert.deepEqual(TABLE_COLUMNS.filter((column) => ["line", "link"].includes(column.field)).map((column) => column.label), ["", "Lien"]);
});

test("cellules : chaque ligne montre son numéro, une tâche son lien ; le reste comme avant", () => {
  const task = { kind: "task", lineNumber: 21, linkText: "20FD", durationDays: 10, start: null, end: null };
  const group = { kind: "group", lineNumber: 22, linkText: "", durationDays: null };
  assert.deepEqual([cellText(task, "line"), cellText(task, "link"), cellText(task, "duration")], ["21", "20FD", "10 jours"]);
  assert.deepEqual([cellText(group, "line"), cellText(group, "link")], ["22", ""]);
  assert.equal(cellText({ kind: "task", lineNumber: null, linkText: "" }, "line"), "");
});

test("saisie dans le tableau : ni le lien ni le numéro de ligne (le lien se choisit par le clic droit)", () => {
  const task = { kind: "task" };
  const group = { kind: "group" };
  const on = { editable: true, canEditLink: true };
  assert.deepEqual(["line", "name", "duration", "link"].map((field) => isEditableCell(task, field, on)), [false, true, true, false]);
  assert.deepEqual(["name", "link", "line"].map((field) => isEditableCell(group, field, on)), [true, false, false]);
  assert.doesNotMatch(source, /input\.value = line\.linkText/);
  assert.match(css, /\.stt-cell--line\s*\{[^}]*justify-content:\s*center;/);
});

test("menu d'une tâche : « Modifier le lien… » ouvre la fenêtre du contrôleur ; grisé sans la colonne Lien", () => {
  const task = { kind: "task", zoneKey: "zonez3a", floorKey: "ss1", taskId: 5 };
  assert.equal(buildMenuItems(task, { canEditLink: false })[1].disabled, true);
  assert.match(source, /if \(item\.action === "editLink"\) return onEditLink\?\.\(item\.taskId\);/);
  assert.match(source, /buildMenuItems\(line, \{ canAddFloor, canAddCycle, canSetCycleMode, canEditLink \}\)/);
});

test("trait d'insertion : décalé de la largeur de la colonne N° de ligne", () => {
  const lines = buildRowModel(buildSections({ rows: eraSs1Rows() }));
  assert.deepEqual(placeOfDropSlot(lines, { taskId: 1000, side: "after" }, { offsetPx: 36 }), { top: 32 + 26 * 20, left: 36 + 48 });
});

test("le numéro de ligne n'est pas une cellule de saisie : un clic dessus ne dit pas « verrouillé »", () => {
  assert.match(source, /if \(field !== "name" && field !== "line"\) \{/);
});

test("largeur du tableau : la nouvelle clé, sinon l'ancienne (sans les colonnes N° de ligne et Lien) + 108 px", () => {
  assert.equal(readLeftWidth("900", "676"), 900);
  assert.equal(readLeftWidth(null, "676"), 784);
  assert.equal(readLeftWidth(null, null), 784);
  assert.equal(readLeftWidth("x", "y"), 784);
});
