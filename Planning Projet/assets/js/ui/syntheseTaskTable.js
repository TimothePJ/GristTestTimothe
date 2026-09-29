// Tableau de tâches de la vue Synthese, façon MS Project : en-tête collant, une ligne
// par entrée du modèle de lignes (zone, étage ou tâche), hauteur de ligne fixe, panneau
// droit réservé au Gantt et séparateur déplaçable. Il gère l'édition dans les cellules
// (tâches, nom des étages), le menu contextuel et les poignées de glisser, mais ne lit ni
// n'écrit jamais Grist : il signale les intentions au contrôleur.
import { floorKeyOf, formatDate, formatDuration, stepDurationText } from "../services/syntheseTaskModel.js";
import { createTaskDrag } from "./syntheseTaskDrag.js";

const LEFT_WIDTH_STORAGE_KEY = "planning-projet.synthese-tasks.left-width";
const DEFAULT_LEFT_WIDTH = 620;
const MIN_LEFT_WIDTH = 360;
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
  { field: "duration", label: "Durée" },
  { field: "start", label: "Début" },
  { field: "end", label: "Fin" },
]);
const EDITABLE_FIELDS = COLUMNS.map((column) => column.field);

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
// tâche → tâche dans le même groupe ou suppression de la tâche.
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
  if (line.kind === "task") {
    return [
      { label: "Ajouter une tâche", action: "addTask", zoneKey: line.zoneKey, floorKey: line.floorKey || "" },
      { label: "Supprimer la tâche", action: "deleteTask", taskId: line.taskId, danger: true },
    ];
  }
  return [];
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

// Une zone ou un étage sans tâche datée n'a pas de récapitulatif : cellules vides. Une
// tâche sans dates affiche « — ».
function formatCellValue(line, field) {
  if ((line.kind === "zone" || line.kind === "floor") && line.durationDays == null) return "";
  if (field === "duration") return formatDuration(line.durationDays);
  if (field === "start") return formatDate(line.start);
  return formatDate(line.end);
}

export function createSyntheseTaskTable(host, {
  onEdit,
  onRenameFloor,
  onAddTask,
  onAddFloor,
  onDeleteTask,
  onDeleteFloor,
  onMoveTask,
  onToggleZone,
  onToggleFloor,
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

  /* ---------- Largeur du panneau gauche ---------- */

  function clampWidth(width) {
    const available = root.clientWidth;
    const max = available ? Math.max(MIN_LEFT_WIDTH, available - MIN_RIGHT_WIDTH) : Infinity;
    return Math.min(max, Math.max(MIN_LEFT_WIDTH, width));
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
    if (line.kind === "zone" || line.kind === "floor") {
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
    return cell;
  }

  function buildLine(line) {
    const element = createElement("div", `stt-line stt-line--${line.kind}`);
    element.setAttribute("role", "row");
    element.setAttribute("aria-level", String(line.level + 1));
    element.dataset.kind = line.kind;
    element.dataset.lineKey = line.key;
    element.dataset.zoneKey = line.zoneKey;
    element.dataset.floorKey = line.floorKey || "";
    if (line.kind === "zone" || line.kind === "floor") {
      element.setAttribute("aria-expanded", String(!line.collapsed));
    }
    if (line.kind === "task") element.dataset.taskId = String(line.taskId);
    if (line.kind === "task" && line.floorKey) element.classList.add("is-in-floor");
    if (line.isMilestone) element.classList.add("is-milestone");
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
      if (editable && (line.kind === "task" || (line.kind === "floor" && field === "name"))) {
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

  function createInput(field, line) {
    const input = document.createElement("input");
    input.className = "stt-input";
    if (field === "name") {
      input.type = "text";
      input.maxLength = 200;
      input.value = line.name;
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
    input.setAttribute(
      "aria-label",
      line.kind === "floor" ? "Nom de l'étage" : COLUMNS.find((column) => column.field === field).label
    );
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
    if (field === "name" || field === "duration") {
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
    } else if (refocus || (move && target.kind === "floor")) {
      // Un étage renommé change de clé : on le retrouve sous l'ancienne (refus, même clé) ou
      // sous la nouvelle.
      const cell = target.kind === "floor"
        ? findFloorCell(target.zoneKey, target.floorKey)
          || findFloorCell(target.zoneKey, floorKeyOf(value))
        : findCell(target.taskId, current.field);
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
    if (item.action === "addTask") return onAddTask?.(item.zoneKey, item.floorKey);
    if (item.action === "addFloor") return onAddFloor?.(item.zoneKey);
    if (item.action === "deleteFloor") return onDeleteFloor?.(item.zoneKey, item.floorKey);
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

  // Action d'un appui, d'un clic ou d'une touche sur une ligne : replier / déplier une zone
  // ou un étage, ou ouvrir la saisie d'une cellule de tâche ou du nom d'un étage.
  function actionAt(target, lineElement) {
    const { kind = "", zoneKey = "", floorKey = "" } = lineElement.dataset;
    if (target.closest('[data-action="toggle"]')) {
      return kind === "floor" ? { type: "toggleFloor", zoneKey, floorKey } : { type: "toggle", zoneKey };
    }
    const cell = target.closest(".stt-cell[data-field]");
    if (!cell || cell.classList.contains("is-editing")) return null;
    if (kind === "task") return { type: "edit", taskId: Number(lineElement.dataset.taskId), field: cell.dataset.field };
    if (kind === "floor" && cell.dataset.field === "name") return { type: "editFloor", zoneKey, floorKey };
    return null;
  }

  function runAction(action) {
    if (action.type === "edit") startEditing(action.taskId, action.field);
    else if (action.type === "editFloor") startEditingFloor(action.zoneKey, action.floorKey);
    else if (action.type === "toggle") onToggleZone?.(action.zoneKey);
    else if (action.type === "toggleFloor") onToggleFloor?.(action.zoneKey, action.floorKey);
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
    if ((action.type === "edit" || action.type === "editFloor") && !editable) {
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
      if (action?.type !== "edit" && action?.type !== "editFloor") return;
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

  applyWidth(leftWidth);

  return {
    render(nextLines, options = {}) {
      renderer.render({ lines: nextLines, options });
    },
    startEditing,
    startEditingFloor,
    setStatus,
  };
}
