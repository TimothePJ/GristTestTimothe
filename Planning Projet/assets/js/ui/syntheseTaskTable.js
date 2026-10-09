// Tableau de tâches de la vue Synthese, façon MS Project : en-tête collant, une ligne
// par entrée du modèle de lignes (zone, étage ou tâche), hauteur de ligne fixe, panneau
// droit réservé au Gantt et séparateur déplaçable. Il gère l'édition dans les cellules
// (tâches, nom des étages), le menu contextuel et les poignées de glisser, mais ne lit ni
// n'écrit jamais Grist : il signale les intentions au contrôleur.
import { floorKeyOf, formatDate, formatDuration, stepDurationText } from "../services/syntheseTaskModel.js";
import { createTaskDrag } from "./syntheseTaskDrag.js";

// « .v2 » : la largeur mémorisée avant les colonnes réglables (plus larges) est oubliée une fois.
const LEFT_WIDTH_STORAGE_KEY = "planning-projet.synthese-tasks.left-width.v2";
const COLUMN_WIDTHS_STORAGE_KEY = "planning-projet.synthese-tasks.column-widths";
// Largeur par défaut des colonnes à droite du nom (px), identique aux --stt-col-* de
// styles.css ; le nom prend le reste du tableau.
export const DEFAULT_COLUMN_WIDTHS = Object.freeze({ id2: 56, indice: 56, duration: 60, start: 92, end: 92 });
export const MIN_COLUMN_WIDTH = 36;
export const MIN_NAME_WIDTH = 120;
const DEFAULT_NAME_WIDTH = 320;
const MIN_RIGHT_WIDTH = 160;
// Hauteur d'une ligne, identique à --stt-row-height (styles.css) : le Gantt s'aligne dessus.
const ROW_HEIGHT_PX = 26;
// Hauteur de l'en-tête collant, identique à --stt-head-height (styles.css).
const HEAD_HEIGHT_PX = 32;
const KEYBOARD_STEP_PX = 24;
const INFO_STATUS_DELAY_MS = 6000;
const GRIP_GLYPH = "⠿";
const COLUMNS = Object.freeze([
  { field: "name", label: "Nom de la tâche" },
  { field: "id2", label: "N°" },
  { field: "indice", label: "Indice" },
  { field: "duration", label: "Durée" },
  { field: "start", label: "Début" },
  { field: "end", label: "Fin" },
]);
const EDITABLE_FIELDS = COLUMNS.map((column) => column.field);
const CODE_FIELDS = new Set(["id2", "indice"]);
// Lignes récapitulatives : triangle de repli, Durée / Début / Fin calculés.
const SUMMARY_KINDS = new Set(["zone", "floor", "group"]);
// Actions qui ouvrent une saisie.
const EDIT_ACTIONS = new Set(["edit", "editFloor", "editGroup"]);

// Un rafraîchissement arrivant pendant une saisie (écriture, relecture, signal d'un
// autre widget) détruirait la cellule en cours : on garde le dernier état demandé et
// on le dessine à la fermeture de la saisie.
export function createDeferredRenderer(draw) {
  let latest = null;
  let hasLatest = false;
  let editing = false;
  return {
    render(payload) {
      latest = payload;
      hasLatest = true;
      if (!editing) draw(payload);
    },
    beginEditing() {
      editing = true;
    },
    endEditing() {
      editing = false;
      if (hasLatest) draw(latest);
    },
    get isEditing() {
      return editing;
    },
  };
}

// Entrées du menu contextuel selon la ligne visée : zone (sauf « Sans zone ») → tâche ou
// étage ; « Sans zone » → tâche ; étage → tâche dans l'étage ou suppression de l'étage ;
// cycle / sous-groupe → tâche dans le groupe ou suppression du groupe ; tâche → tâche dans
// le même conteneur ou suppression de la tâche.
export function buildMenuItems(line, { canAddFloor = true } = {}) {
  if (!line) return [];
  if (line.kind === "zone") {
    const items = [{ label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: "" }];
    if (line.zoneKey) {
      items.push({ label: "Ajouter un étage", action: "addFloor", zoneKey: line.zoneKey, disabled: !canAddFloor });
    }
    return items;
  }
  if (line.kind === "floor") {
    return [
      { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey },
      { label: "Supprimer l'étage", action: "deleteFloor", zoneKey: line.zoneKey, floorKey: line.floorKey, danger: true },
    ];
  }
  if (line.kind === "group") {
    return [
      { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey, groupRowId: line.groupRowId },
      {
        label: line.nature === "cycle" ? "Supprimer le cycle" : "Supprimer le sous-groupe",
        action: "deleteGroup",
        groupRowId: line.groupRowId,
        danger: true,
      },
    ];
  }
  if (line.kind === "task") {
    const addTask = { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey || "" };
    if (line.groupRowId) addTask.groupRowId = line.groupRowId;
    return [addTask, { label: "Supprimer la tâche", action: "deleteTask", taskId: line.taskId, danger: true }];
  }
  return [];
}

function sumWidths(widths) {
  return Object.values(widths).reduce((total, width) => total + width, 0);
}

const DEFAULT_LEFT_WIDTH = DEFAULT_NAME_WIDTH + sumWidths(DEFAULT_COLUMN_WIDTHS);

// Largeur minimale du tableau : toutes les colonnes, plus un nom lisible.
export function minLeftWidth(widths) {
  return sumWidths(widths) + MIN_NAME_WIDTH;
}

// Largeurs mémorisées (texte JSON) : chaque colonne connue reprend la sienne, au moins
// MIN_COLUMN_WIDTH ; ce qui manque ou ne se lit pas garde la largeur par défaut.
export function readColumnWidths(raw) {
  let stored = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch (_error) {
    stored = null;
  }
  const widths = { ...DEFAULT_COLUMN_WIDTHS };
  if (stored && typeof stored === "object") {
    Object.keys(widths).forEach((field) => {
      const value = Number(stored[field]);
      if (Number.isFinite(value) && value > 0) widths[field] = Math.max(MIN_COLUMN_WIDTH, Math.round(value));
    });
  }
  return widths;
}

// Glisser le bord droit d'une colonne de `delta` px : la colonne change de largeur et le
// tableau avec elle (le Gantt se décale), les autres colonnes gardent la leur. Le nom prend
// le reste du tableau : son bord déplace la limite du tableau, sans descendre sous un nom
// de MIN_NAME_WIDTH.
export function dragColumn({ widths, leftWidth }, field, delta) {
  if (field === "name") {
    return { widths: { ...widths }, leftWidth: Math.max(minLeftWidth(widths), leftWidth + delta) };
  }
  const width = Math.max(MIN_COLUMN_WIDTH, Math.round(widths[field] + delta));
  return { widths: { ...widths, [field]: width }, leftWidth: leftWidth + width - widths[field] };
}

function readStoredWidth() {
  try {
    const value = Number(window.localStorage.getItem(LEFT_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_LEFT_WIDTH;
  } catch (_error) {
    return DEFAULT_LEFT_WIDTH;
  }
}

function storeWidth(width) {
  try {
    window.localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch (_error) {
    // Stockage indisponible : la largeur reste celle de la session.
  }
}

function readStoredColumnWidths() {
  try {
    return readColumnWidths(window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY));
  } catch (_error) {
    return { ...DEFAULT_COLUMN_WIDTHS };
  }
}

function storeColumnWidths(widths) {
  try {
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch (_error) {
    // Stockage indisponible : les largeurs restent celles de la session.
  }
}

function toInputDate(date) {
  if (!(date instanceof Date)) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// Emblème de lien d'un étage, à côté de son nom : deux maillons (dessinés en CSS), verts quand
// l'étage est lié à un coffrage de Structure, rouges sinon. Le survol le dit en toutes lettres.
export function buildLinkBadge(line, doc = document) {
  const badge = doc.createElement("span");
  badge.className = `stt-floor-link ${line.structureLink ? "is-linked" : "is-unlinked"}`;
  badge.title = line.structureLinkNote;
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", line.structureLinkNote);
  return badge;
}

// Une ligne récapitulative sans tâche datée n'a pas de récapitulatif : cellules vides. Une
// tâche sans dates affiche « — » (et sa durée prévue). N° et Indice : tâches seulement.
function formatCellValue(line, field) {
  if (CODE_FIELDS.has(field)) return line.kind === "task" ? (line[field] || "") : "";
  if (SUMMARY_KINDS.has(line.kind) && line.durationDays == null) return "";
  if (field === "duration") return formatDuration(line.durationDays);
  if (field === "start") return formatDate(line.start);
  return formatDate(line.end);
}

export function createSyntheseTaskTable(host, {
  onEdit,
  onRenameFloor,
  onRenameGroup,
  onAddTask,
  onAddFloor,
  onDeleteTask,
  onDeleteFloor,
  onDeleteGroup,
  onMoveTask,
  onToggleZone,
  onToggleFloor,
  onToggleGroup,
  onLockedAttempt,
} = {}, { createGantt } = {}) {
  const root = createElement("div", "stt");
  const scroller = createElement("div", "stt-scroll");
  scroller.setAttribute("role", "treegrid");
  scroller.setAttribute("aria-label", "Tâches du projet");

  const head = createElement("div", "stt-line stt-line--head");
  head.setAttribute("role", "row");
  const headLeft = createElement("div", "stt-left");
  COLUMNS.forEach(({ field, label }) => {
    const cell = createElement("div", `stt-cell stt-cell--${field}`, label);
    cell.setAttribute("role", "columnheader");
    // Poignée de largeur sur le bord droit de l'en-tête, comme dans MS Project.
    const handle = createElement("span", "stt-col-resize");
    handle.dataset.field = field;
    handle.setAttribute("aria-hidden", "true");
    handle.title = `Glisser pour changer la largeur de « ${label} » ; double-clic : largeur par défaut`;
    cell.appendChild(handle);
    headLeft.appendChild(cell);
  });
  // Bande réservée à l'échelle des dates du Gantt.
  const headRight = createElement("div", "stt-right stt-right--head");
  head.append(headLeft, headRight);

  const body = createElement("div", "stt-body");
  body.setAttribute("role", "rowgroup");
  const empty = createElement("p", "stt-empty");
  empty.hidden = true;
  scroller.append(head, body, empty);

  // Couche du Gantt : enfant du conteneur défilant mais hors du corps, que chaque rendu
  // reconstruit ; alignée sur les lignes par la hauteur fixe.
  const ganttLayer = createElement("div", "stt-gantt-layer");
  scroller.appendChild(ganttLayer);
  const gantt = typeof createGantt === "function"
    ? createGantt({ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX })
    : null;

  const splitter = createElement("div", "stt-splitter");
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Largeur du tableau des tâches");
  splitter.tabIndex = 0;

  const status = createElement("p", "stt-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  const menu = createElement("div", "stt-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  root.append(scroller, splitter, status, menu);
  host.replaceChildren(root);

  let lines = [];
  let editable = false;
  let canAddFloor = true;
  let dropTargetKey = null;
  let dragSourceKey = null;
  let taskDrag = null;
  let editor = null;
  let queuedAction = null;
  let ignoreNextClick = false;
  let statusTimer = 0;
  let leftWidth = readStoredWidth();
  let columnWidths = readStoredColumnWidths();

  /* ---------- Largeur du panneau gauche et des colonnes ---------- */

  function clampWidth(width) {
    const min = minLeftWidth(columnWidths);
    const available = root.clientWidth;
    const max = available ? Math.max(min, available - MIN_RIGHT_WIDTH) : Infinity;
    return Math.min(max, Math.max(min, width));
  }

  function applyColumnWidths() {
    Object.entries(columnWidths).forEach(([field, width]) => {
      root.style.setProperty(`--stt-col-${field}`, `${width}px`);
    });
  }

  // Nouvelle largeur d'une colonne (et du tableau, qui la suit).
  function resizeColumn(next, { persist = false } = {}) {
    columnWidths = next.widths;
    applyColumnWidths();
    applyWidth(next.leftWidth, { persist });
    if (persist) storeColumnWidths(columnWidths);
  }

  function applyWidth(width, { persist = false } = {}) {
    leftWidth = clampWidth(width);
    root.style.setProperty("--stt-left-width", `${Math.round(leftWidth)}px`);
    splitter.setAttribute("aria-valuenow", String(Math.round(leftWidth)));
    if (persist) storeWidth(leftWidth);
    gantt?.resize();
  }

  /* ---------- Rendu ---------- */

  function buildNameCell(line) {
    const cell = createElement("div", "stt-cell stt-cell--name");
    cell.setAttribute("role", "gridcell");
    cell.dataset.field = "name";
    cell.title = line.name;
    if (SUMMARY_KINDS.has(line.kind)) {
      const toggle = createElement("button", "stt-toggle", line.collapsed ? "▸" : "▾");
      toggle.type = "button";
      toggle.dataset.action = "toggle";
      // Replier / déplier n'écrit rien : bouton de navigation, que le contexte partagé laisse
      // actif en lecture seule (le nom de zone pourrait ressembler à une action d'écriture).
      toggle.dataset.serviceContextNavigation = "";
      toggle.setAttribute("aria-label", `${line.collapsed ? "Déplier" : "Replier"} ${line.name}`);
      cell.appendChild(toggle);
    }
    // Poignée pour glisser la tâche vers un autre étage ou une autre zone.
    if (line.kind === "task" && editable) {
      const grip = createElement("span", "stt-grip", GRIP_GLYPH);
      grip.setAttribute("aria-hidden", "true");
      grip.title = "Glisser pour déplacer la tâche";
      cell.appendChild(grip);
    }
    cell.appendChild(createElement("span", "stt-text", line.name));
    if (line.kind === "floor" && line.structureLinkNote) cell.appendChild(buildLinkBadge(line));
    return cell;
  }

  function buildLine(line) {
    const element = createElement("div", `stt-line stt-line--${line.kind} is-level-${line.level}`);
    element.setAttribute("role", "row");
    element.setAttribute("aria-level", String(line.level + 1));
    element.dataset.kind = line.kind;
    element.dataset.lineKey = line.key;
    element.dataset.zoneKey = line.zoneKey;
    element.dataset.floorKey = line.floorKey || "";
    element.dataset.groupRowId = line.groupRowId ? String(line.groupRowId) : "";
    if (SUMMARY_KINDS.has(line.kind)) element.setAttribute("aria-expanded", String(!line.collapsed));
    if (line.kind === "task") element.dataset.taskId = String(line.taskId);
    if (line.kind === "task" && line.floorKey) element.classList.add("is-in-floor");
    // Couleur de la capture : cycle (gris), réunion (bleu), démarrage (rouge).
    if (line.nature) element.classList.add(`is-nature-${line.nature}`);
    if (line.isMilestone) element.classList.add("is-milestone");
    // Plan de réservations du cycle 3 dont la Fin dépasse le début du plan de coffrage de son étage.
    if (line.isOverEndLimit) element.classList.add("is-over-limit");
    if (line.key === dropTargetKey) element.classList.add("is-drop-target");
    if (line.key === dragSourceKey) element.classList.add("is-drag-source");

    const left = createElement("div", "stt-left");
    COLUMNS.forEach(({ field }) => {
      const cell = field === "name"
        ? buildNameCell(line)
        : createElement("div", `stt-cell stt-cell--${field}`, formatCellValue(line, field));
      if (field !== "name") {
        cell.setAttribute("role", "gridcell");
        cell.dataset.field = field;
      }
      if (field === "end" && line.endLimitNote) cell.title = line.endLimitNote;
      const nameOnly = line.kind === "floor" || line.kind === "group";
      if (editable && (line.kind === "task" || (nameOnly && field === "name"))) {
        cell.classList.add("is-editable");
        cell.tabIndex = 0;
      }
      left.appendChild(cell);
    });
    // Emplacement de la ligne dans le Gantt : même hauteur, même ordre.
    element.append(left, createElement("div", "stt-right"));
    return element;
  }

  function draw({ lines: nextLines, options }) {
    lines = Array.isArray(nextLines) ? nextLines : [];
    editable = Boolean(options?.editable);
    canAddFloor = options?.canAddFloor !== false;
    // Tableau devenu non modifiable : un glisser en cours est abandonné, sans dépôt.
    if (!editable) taskDrag?.cancel();
    applyWidth(leftWidth);
    root.classList.toggle("is-readonly", !editable);
    const message = options?.emptyMessage || "";
    empty.textContent = message;
    empty.hidden = !message;
    body.hidden = Boolean(message);
    body.replaceChildren(...(message ? [] : lines.map(buildLine)));
    gantt?.render(message ? [] : lines);
  }

  const renderer = createDeferredRenderer(draw);

  /* ---------- Édition dans les cellules ---------- */

  function findCell(taskId, field) {
    return body.querySelector(`.stt-line--task[data-task-id="${taskId}"] .stt-cell--${field}`);
  }

  function findFloorCell(zoneKey, floorKey) {
    return body.querySelector(
      `.stt-line--floor[data-zone-key="${zoneKey}"][data-floor-key="${floorKey}"] .stt-cell--name`
    );
  }

  function findGroupCell(groupRowId) {
    return body.querySelector(`.stt-line--group[data-group-row-id="${groupRowId}"] .stt-cell--name`);
  }

  function startEditing(taskId, field) {
    if (!editable || !EDITABLE_FIELDS.includes(field)) return;
    if (editor) {
      queuedAction = { type: "edit", taskId, field };
      return;
    }
    const line = lines.find((candidate) => candidate.kind === "task" && candidate.taskId === taskId);
    const cell = findCell(taskId, field);
    if (!line || !cell) return;
    openEditor({ target: { kind: "task", taskId }, field, cell, input: createInput(field, line) });
  }

  // Nom d'un étage : même saisie que le nom d'une tâche ; la validation le renomme.
  function startEditingFloor(zoneKey, floorKey) {
    if (!editable) return;
    if (editor) {
      queuedAction = { type: "editFloor", zoneKey, floorKey };
      return;
    }
    const line = lines.find((candidate) => (
      candidate.kind === "floor" && candidate.zoneKey === zoneKey && candidate.floorKey === floorKey
    ));
    const cell = findFloorCell(zoneKey, floorKey);
    if (!line || !cell) return;
    openEditor({ target: { kind: "floor", zoneKey, floorKey }, field: "name", cell, input: createInput("name", line) });
  }

  // Nom d'un cycle ou d'un sous-groupe : même saisie que le nom d'une tâche.
  function startEditingGroup(groupRowId) {
    if (!editable) return;
    if (editor) {
      queuedAction = { type: "editGroup", groupRowId };
      return;
    }
    const line = lines.find((candidate) => candidate.kind === "group" && candidate.groupRowId === groupRowId);
    const cell = findGroupCell(groupRowId);
    if (!line || !cell) return;
    openEditor({ target: { kind: "group", groupRowId }, field: "name", cell, input: createInput("name", line) });
  }

  function createInput(field, line) {
    const input = document.createElement("input");
    input.className = "stt-input";
    if (field === "name") {
      input.type = "text";
      input.maxLength = 200;
      input.value = line.name;
    } else if (CODE_FIELDS.has(field)) {
      input.type = "text";
      input.maxLength = 50;
      input.autocomplete = "off";
      input.value = line[field] || "";
    } else if (field === "duration") {
      // Texte et non « number » : la molette sur un champ numérique actif changerait la
      // valeur au lieu de faire défiler le tableau.
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.value = line.durationDays == null ? "" : String(line.durationDays);
    } else {
      input.type = "date";
      input.value = toInputDate(line[field]);
    }
    const labels = { floor: "Nom de l'étage", group: "Nom du groupe" };
    input.setAttribute("aria-label", labels[line.kind] || COLUMNS.find((column) => column.field === field).label);
    return input;
  }

  // ↑ / ↓ ou ▲▼ dans la saisie de la Durée : ±1 jour ; la valeur reste sélectionnée pour
  // enchaîner ou retaper. Enregistrée à la validation, comme une durée tapée.
  function stepDuration(step) {
    if (editor?.field !== "duration" || editor.finalized) return;
    editor.input.value = stepDurationText(editor.input.value, step);
    editor.input.select();
  }

  // Boutons ▲▼ de la saisie de la Durée, comme dans MS Project. L'appui ne prend pas le
  // focus : sinon la saisie, en le perdant, serait enregistrée et fermée.
  function createDurationSpin() {
    const spin = createElement("div", "stt-spin");
    [
      [1, "▲", "Augmenter la durée d'un jour"],
      [-1, "▼", "Diminuer la durée d'un jour"],
    ].forEach(([step, glyph, label]) => {
      const button = createElement("button", "stt-spin__button", glyph);
      button.type = "button";
      button.tabIndex = -1;
      button.setAttribute("aria-label", label);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => stepDuration(step));
      spin.appendChild(button);
    });
    return spin;
  }

  function openEditor({ target, field, cell, input }) {
    editor = { target, field, input, cell, initialValue: input.value, finalized: false };
    renderer.beginEditing();
    cell.replaceChildren(input);
    if (field === "duration") cell.appendChild(createDurationSpin());
    cell.classList.add("is-editing");

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finishEditing({ commit: true, refocus: true });
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finishEditing({ commit: false, refocus: true });
      } else if (event.key === "Tab") {
        event.preventDefault();
        void finishEditing({ commit: true, move: event.shiftKey ? -1 : 1 });
      } else if (field === "duration" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        stepDuration(event.key === "ArrowUp" ? 1 : -1);
      }
    });
    input.addEventListener("blur", () => {
      void finishEditing({ commit: true });
    });

    cell.scrollIntoView?.({ block: "nearest" });
    input.focus();
    if (field === "name" || field === "duration" || CODE_FIELDS.has(field)) {
      try {
        input.select();
      } catch (_error) {
        // Certains types de champ ne permettent pas la sélection.
      }
    }
  }

  async function finishEditing({ commit, move = 0, refocus = false }) {
    const current = editor;
    if (!current || current.finalized) return;
    current.finalized = true;
    const value = current.input.value;
    const { target } = current;
    // Le contrôleur affiche la saisie et l'enregistre en arrière-plan : on enchaîne tout de
    // suite, sans bloquer le clavier.
    if (commit && value !== current.initialValue) {
      try {
        if (target.kind === "floor") await onRenameFloor?.(target.zoneKey, target.floorKey, value);
        else if (target.kind === "group") await onRenameGroup?.(target.groupRowId, value);
        else await onEdit?.(target.taskId, current.field, value);
      } catch (error) {
        console.error("Saisie de tâche non enregistrée :", error);
      }
    }
    editor = null;
    renderer.endEditing();

    const queued = queuedAction;
    queuedAction = null;
    const nextIndex = EDITABLE_FIELDS.indexOf(current.field) + move;
    if (target.kind === "task" && move && nextIndex >= 0 && nextIndex < EDITABLE_FIELDS.length) {
      startEditing(target.taskId, EDITABLE_FIELDS[nextIndex]);
    } else if (queued) {
      runAction(queued);
    } else if (refocus || (move && target.kind !== "task")) {
      // Un étage renommé change de clé : on le retrouve sous l'ancienne (refus, même clé) ou
      // sous la nouvelle.
      let cell;
      if (target.kind === "floor") {
        cell = findFloorCell(target.zoneKey, target.floorKey) || findFloorCell(target.zoneKey, floorKeyOf(value));
      } else if (target.kind === "group") {
        cell = findGroupCell(target.groupRowId);
      } else {
        cell = findCell(target.taskId, current.field);
      }
      cell?.focus();
    }
  }

  /* ---------- Menu contextuel ---------- */

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
  }

  function runMenuItem(item) {
    if (item.action === "addTask") return onAddTask?.(item.zoneKey, item.floorKey, item.groupRowId ?? null);
    if (item.action === "addFloor") return onAddFloor?.(item.zoneKey);
    if (item.action === "deleteFloor") return onDeleteFloor?.(item.zoneKey, item.floorKey);
    if (item.action === "deleteGroup") return onDeleteGroup?.(item.groupRowId);
    if (item.action === "deleteTask") return onDeleteTask?.(item.taskId);
    return undefined;
  }

  function openMenu(lineElement, clientX, clientY) {
    if (!editable) {
      onLockedAttempt?.();
      return;
    }
    const line = lines.find((candidate) => candidate.key === lineElement.dataset.lineKey);
    const items = buildMenuItems(line, { canAddFloor });
    if (!items.length) return;
    menu.replaceChildren(...items.map((item) => {
      const classes = ["stt-menu__item"];
      if (item.danger) classes.push("is-danger");
      if (item.disabled) classes.push("is-disabled");
      const button = createElement("button", classes.join(" "), item.label);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      // Grisée mais cliquable : le contrôleur explique pourquoi l'action est impossible.
      if (item.disabled) button.setAttribute("aria-disabled", "true");
      button.addEventListener("click", () => {
        closeMenu();
        void runMenuItem(item);
      });
      return button;
    }));
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY, window.innerHeight - rect.height - 4))}px`;
    menu.querySelector("button")?.focus();
  }

  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) closeMenu();
  }, true);
  scroller.addEventListener("scroll", closeMenu, { passive: true });
  window.addEventListener("blur", closeMenu);

  /* ---------- Souris et clavier sur les lignes ---------- */

  // Action d'un appui, d'un clic ou d'une touche sur une ligne : replier / déplier une zone,
  // un étage ou un groupe, ou ouvrir la saisie d'une cellule de tâche ou d'un nom d'étage ou
  // de groupe.
  function actionAt(target, lineElement) {
    const { kind = "", zoneKey = "", floorKey = "", groupRowId = "" } = lineElement.dataset;
    if (target.closest('[data-action="toggle"]')) {
      if (kind === "group") return { type: "toggleGroup", groupRowId: Number(groupRowId) };
      return kind === "floor" ? { type: "toggleFloor", zoneKey, floorKey } : { type: "toggle", zoneKey };
    }
    const cell = target.closest(".stt-cell[data-field]");
    if (!cell || cell.classList.contains("is-editing")) return null;
    if (kind === "task") return { type: "edit", taskId: Number(lineElement.dataset.taskId), field: cell.dataset.field };
    if (kind === "floor" && cell.dataset.field === "name") return { type: "editFloor", zoneKey, floorKey };
    if (kind === "group" && cell.dataset.field === "name") return { type: "editGroup", groupRowId: Number(groupRowId) };
    return null;
  }

  function runAction(action) {
    if (action.type === "edit") startEditing(action.taskId, action.field);
    else if (action.type === "editFloor") startEditingFloor(action.zoneKey, action.floorKey);
    else if (action.type === "editGroup") startEditingGroup(action.groupRowId);
    else if (action.type === "toggle") onToggleZone?.(action.zoneKey);
    else if (action.type === "toggleFloor") onToggleFloor?.(action.zoneKey, action.floorKey);
    else if (action.type === "toggleGroup") onToggleGroup?.(action.groupRowId);
  }

  // Un appui ailleurs pendant une saisie la ferme (perte du focus) et redessine le
  // tableau avant l'arrivée du click, que le navigateur perd alors. L'action est donc
  // mémorisée dès l'appui et rejouée à la fermeture de la saisie ; le click qui suit,
  // s'il arrive, est ignoré pour ne pas la jouer deux fois. La poignée de glisser n'est
  // pas une action de ligne.
  body.addEventListener("pointerdown", (event) => {
    ignoreNextClick = false;
    if (!editor || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement || target.closest(".stt-grip")) return;
    const action = actionAt(target, lineElement);
    if (!action) return;
    queuedAction = action;
    ignoreNextClick = true;
  });

  body.addEventListener("click", (event) => {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement || target.closest(".stt-grip")) return;
    const action = actionAt(target, lineElement);
    if (!action) return;
    if (EDIT_ACTIONS.has(action.type) && !editable) {
      onLockedAttempt?.();
      return;
    }
    runAction(action);
  });

  body.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-line");
    if (!lineElement) return;
    event.preventDefault();
    openMenu(lineElement, event.clientX, event.clientY);
  });

  body.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest(".stt-cell[data-field]");
    const lineElement = target?.closest(".stt-line");
    if (!cell || !lineElement || cell.classList.contains("is-editing")) return;
    if (event.key === "Enter" || event.key === "F2") {
      const action = actionAt(target, lineElement);
      if (!EDIT_ACTIONS.has(action?.type)) return;
      event.preventDefault();
      if (!editable) {
        onLockedAttempt?.();
        return;
      }
      runAction(action);
    } else if (
      (event.key === "ArrowUp" || event.key === "ArrowDown")
      && cell.dataset.field === "duration"
      && lineElement.dataset.kind === "task"
    ) {
      // Durée sélectionnée sans saisie : ↑ / ↓ ouvre la saisie avec la valeur déjà changée.
      event.preventDefault();
      if (!editable) {
        onLockedAttempt?.();
        return;
      }
      const taskId = Number(lineElement.dataset.taskId);
      startEditing(taskId, "duration");
      stepDuration(event.key === "ArrowUp" ? 1 : -1);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      openMenu(lineElement, rect.left + 8, rect.bottom);
    }
  });

  /* ---------- Glisser-déposer des tâches ---------- */

  // Surligne l'en-tête du conteneur visé (zone ou étage) ; réappliqué à chaque redessin.
  function highlightDropTarget(key) {
    if (key === dropTargetKey) return;
    if (dropTargetKey) body.querySelector(`[data-line-key="${dropTargetKey}"]`)?.classList.remove("is-drop-target");
    dropTargetKey = key;
    if (key) body.querySelector(`[data-line-key="${key}"]`)?.classList.add("is-drop-target");
  }

  // Estompe la ligne de la tâche glissée ; réappliqué à chaque redessin.
  function markDragSource(key) {
    if (key === dragSourceKey) return;
    if (dragSourceKey) body.querySelector(`[data-line-key="${dragSourceKey}"]`)?.classList.remove("is-drag-source");
    dragSourceKey = key;
    if (key) body.querySelector(`[data-line-key="${key}"]`)?.classList.add("is-drag-source");
  }

  // Copie de la ligne glissée, tenue sous le pointeur : même rendu que dans le tableau, sans
  // la partie Gantt ni l'estompage.
  function renderDragPreview(line) {
    const element = buildLine(line);
    element.classList.remove("is-drag-source");
    element.querySelector(".stt-right")?.remove();
    return element;
  }

  taskDrag = createTaskDrag({
    root,
    scroller,
    body,
    rowHeight: ROW_HEIGHT_PX,
    headHeight: HEAD_HEIGHT_PX,
    getLines: () => lines,
    isEnabled: () => editable,
    highlight: highlightDropTarget,
    renderPreview: renderDragPreview,
    markSource: markDragSource,
    onDrop: (taskId, target) => onMoveTask?.(taskId, target),
  });

  /* ---------- Largeur des colonnes (poignées de l'en-tête) ---------- */

  head.addEventListener("pointerdown", (event) => {
    const handle = event.target instanceof Element ? event.target.closest(".stt-col-resize") : null;
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const { field } = handle.dataset;
    const startX = event.clientX;
    const start = { widths: { ...columnWidths }, leftWidth };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché.
    }
    root.classList.add("is-resizing");
    const onMove = (moveEvent) => resizeColumn(dragColumn(start, field, moveEvent.clientX - startX));
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      root.classList.remove("is-resizing");
      resizeColumn({ widths: columnWidths, leftWidth }, { persist: true });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  });

  // Double-clic sur une poignée : la colonne reprend sa largeur par défaut.
  head.addEventListener("dblclick", (event) => {
    const handle = event.target instanceof Element ? event.target.closest(".stt-col-resize") : null;
    if (!handle) return;
    const { field } = handle.dataset;
    const current = field === "name" ? leftWidth - sumWidths(columnWidths) : columnWidths[field];
    const wanted = field === "name" ? DEFAULT_NAME_WIDTH : DEFAULT_COLUMN_WIDTHS[field];
    resizeColumn(dragColumn({ widths: columnWidths, leftWidth }, field, wanted - current), { persist: true });
  });

  /* ---------- Séparateur ---------- */

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    try {
      splitter.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché.
    }
    root.classList.add("is-resizing");
    const onMove = (moveEvent) => applyWidth(startWidth + moveEvent.clientX - startX);
    const onEnd = () => {
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onEnd);
      splitter.removeEventListener("pointercancel", onEnd);
      root.classList.remove("is-resizing");
      applyWidth(leftWidth, { persist: true });
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onEnd);
    splitter.addEventListener("pointercancel", onEnd);
  });

  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX;
    applyWidth(leftWidth + step, { persist: true });
  });

  window.addEventListener("resize", () => {
    closeMenu();
    applyWidth(leftWidth);
  });

  /* ---------- Barre d'état ---------- */

  function setStatus(text, tone = "info") {
    window.clearTimeout(statusTimer);
    status.textContent = text || "";
    status.dataset.tone = tone;
    status.hidden = !text;
    if (text && tone === "info") {
      statusTimer = window.setTimeout(() => {
        status.hidden = true;
        status.textContent = "";
      }, INFO_STATUS_DELAY_MS);
    }
  }

  applyColumnWidths();
  applyWidth(leftWidth);

  return {
    render(nextLines, options = {}) {
      renderer.render({ lines: nextLines, options });
    },
    startEditing,
    startEditingFloor,
    setStatus,
    startEditingGroup,
  };
}
