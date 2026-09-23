// Interactions souris de la vue Synthese, sur deux timelines vis :
//  - l'équipe (une ligne par personne) et la zone « non affectées » en dessous ;
//  - survol : infobulle du segment ;
//  - glisser un segment : change seulement la personne (les dates ne bougent
//    que par « Modifier »), le fantôme ne se déplace donc que verticalement ;
//  - clic-glisser dans la zone du bas : dessine un nouveau segment ;
//  - clic droit : menu Modifier / Supprimer.
// vis écoute les pointeurs sur ses propres éléments : on intercepte en phase de
// capture sur le conteneur pour que ses déplacements de vue n'interfèrent pas.
import {
  formatDays,
  formatHours,
  formatTaskDate,
} from "../services/syntheseTasks.js";

const DRAG_THRESHOLD_PX = 5;
export const TASK_ITEM_PREFIX = "task:";

export function toTaskItemId(taskId) {
  return `${TASK_ITEM_PREFIX}${taskId}`;
}

function fromTaskItemId(itemId) {
  const text = String(itemId ?? "");
  if (!text.startsWith(TASK_ITEM_PREFIX)) return null;
  const id = Number(text.slice(TASK_ITEM_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function eventAt(clientX, clientY) {
  return {
    clientX,
    clientY,
    center: { x: clientX, y: clientY },
    target: document.elementFromPoint(clientX, clientY),
  };
}

function containsPoint(element, clientX, clientY) {
  if (!element || element.hidden) return false;
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildTooltipContent(tooltip, task) {
  tooltip.replaceChildren();
  const title = document.createElement("strong");
  title.className = "synthese-tooltip__title";
  title.textContent = task.name;
  tooltip.appendChild(title);

  const addBlock = (rows) => {
    const block = document.createElement("dl");
    block.className = "synthese-tooltip__block";
    rows.forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = `${label} :`;
      const detail = document.createElement("dd");
      detail.textContent = value;
      block.append(term, detail);
    });
    tooltip.appendChild(block);
  };
  addBlock([
    ["Début", formatTaskDate(task.start)],
    ["Fin", formatTaskDate(task.end)],
    ["Durée", formatDays(task.durationDays)],
  ]);
  addBlock([
    ["% achevé", `${task.realise}%`],
    ["Travail", formatHours(task.workHours)],
    ["Travail restant", formatHours(task.remainingHours)],
  ]);
}

export function bindSyntheseTaskInteractions({
  top,
  bottom,
  tooltip,
  menu,
  getTask,
  isEditable,
  onSelect,
  onAssign,
  onCreateRange,
  onEdit,
  onDelete,
  onDropTargetChange,
  onLockedAttempt = () => {},
}) {
  let gesture = null;
  let menuTaskId = null;

  const timelines = [top, bottom];

  function taskFromEvent(pane, event) {
    const props = pane.timeline.getEventProperties(event);
    const taskId = fromTaskItemId(props?.item);
    return { props, task: taskId ? getTask(taskId) : null };
  }

  /* ---------- Infobulle ---------- */

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function showTooltip(task, clientX, clientY) {
    buildTooltipContent(tooltip, task);
    tooltip.hidden = false;
    const margin = 14;
    const { innerWidth, innerHeight } = window;
    const rect = tooltip.getBoundingClientRect();
    const left = clientX + margin + rect.width > innerWidth ? clientX - margin - rect.width : clientX + margin;
    const topPos = clientY + margin + rect.height > innerHeight ? clientY - margin - rect.height : clientY + margin;
    tooltip.style.left = `${Math.max(4, left)}px`;
    tooltip.style.top = `${Math.max(4, topPos)}px`;
  }

  timelines.forEach((pane) => {
    pane.host.addEventListener("mousemove", (event) => {
      if (gesture?.active || !menu.hidden) return;
      const { task } = taskFromEvent(pane, event);
      if (task) showTooltip(task, event.clientX, event.clientY);
      else hideTooltip();
    });
    pane.host.addEventListener("mouseleave", hideTooltip);
  });

  /* ---------- Menu contextuel ---------- */

  function hideMenu() {
    menu.hidden = true;
    menuTaskId = null;
  }

  function showMenu(taskId, clientX, clientY) {
    menuTaskId = taskId;
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - rect.width - 4);
    const topPos = Math.min(clientY, window.innerHeight - rect.height - 4);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, topPos)}px`;
    menu.querySelector("button")?.focus();
  }

  timelines.forEach((pane) => {
    pane.host.addEventListener("contextmenu", (event) => {
      const { task } = taskFromEvent(pane, event);
      if (!task) return;
      event.preventDefault();
      hideTooltip();
      onSelect(task.id);
      if (isEditable()) showMenu(task.id, event.clientX, event.clientY);
      else onLockedAttempt();
    });
  });

  menu.addEventListener("click", (event) => {
    const action = event.target?.closest?.("[data-action]")?.dataset.action;
    const taskId = menuTaskId;
    hideMenu();
    if (!taskId) return;
    if (action === "edit") onEdit(taskId);
    if (action === "delete") onDelete(taskId);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) hideMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMenu();
      if (gesture) cancelGesture();
    }
  });
  window.addEventListener("blur", hideMenu);

  /* ---------- Glisser : attribution et création ---------- */

  function resolveDropTarget(clientX, clientY) {
    if (containsPoint(bottom.host, clientX, clientY)) return { kind: "backlog" };
    if (containsPoint(top.host, clientX, clientY)) {
      const props = top.timeline.getEventProperties(eventAt(clientX, clientY));
      if (props?.group != null) return { kind: "person", key: String(props.group) };
    }
    return null;
  }

  function cleanupGesture() {
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    gesture?.ghost?.remove();
    gesture?.preview?.remove();
    document.body.classList.remove("is-synthese-dragging");
    onDropTargetChange(null);
    gesture = null;
  }

  function cancelGesture() {
    cleanupGesture();
  }

  function beginTaskDrag(pane, task, event) {
    const itemElement = event.target?.closest?.(".vis-item");
    gesture = {
      type: "move",
      pane,
      task,
      itemElement,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
    };
  }

  function activateTaskDrag() {
    const rect = gesture.itemElement?.getBoundingClientRect();
    if (!rect) return;
    const ghost = gesture.itemElement.cloneNode(true);
    ghost.classList.add("synthese-drag-ghost");
    Object.assign(ghost.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      transform: "none",
    });
    document.body.appendChild(ghost);
    gesture.ghost = ghost;
    gesture.offsetY = gesture.startY - rect.top;
    document.body.classList.add("is-synthese-dragging");
  }

  function beginCreate(event, props) {
    const hostRect = bottom.host.getBoundingClientRect();
    const preview = document.createElement("div");
    preview.className = "synthese-create-preview";
    bottom.host.appendChild(preview);
    gesture = {
      type: "create",
      startX: event.clientX,
      startY: event.clientY,
      startTime: props.time,
      hostRect,
      preview,
      active: false,
    };
  }

  function updateCreatePreview(clientX) {
    const { hostRect, startX, startY, preview } = gesture;
    const labelRight = bottom.host.querySelector(".vis-panel.vis-center")?.getBoundingClientRect().left
      ?? hostRect.left;
    const left = Math.max(Math.min(startX, clientX), labelRight);
    const right = Math.max(startX, clientX);
    Object.assign(preview.style, {
      left: `${left - hostRect.left}px`,
      width: `${Math.max(0, right - left)}px`,
      top: `${startY - hostRect.top - 17}px`,
    });
  }

  function onPointerMove(event) {
    if (!gesture) return;
    const moved =
      Math.abs(event.clientX - gesture.startX) > DRAG_THRESHOLD_PX ||
      Math.abs(event.clientY - gesture.startY) > DRAG_THRESHOLD_PX;
    if (!gesture.active && moved) {
      gesture.active = true;
      hideTooltip();
      if (gesture.type === "move") activateTaskDrag();
    }
    if (!gesture.active) return;
    event.preventDefault();

    if (gesture.type === "move" && gesture.ghost) {
      gesture.ghost.style.top = `${event.clientY - gesture.offsetY}px`;
      const target = resolveDropTarget(event.clientX, event.clientY);
      const targetKey = target ? `${target.kind}:${target.key || ""}` : "";
      if (targetKey !== gesture.targetKey) {
        gesture.targetKey = targetKey;
        gesture.target = target;
        onDropTargetChange(target);
      }
    } else if (gesture.type === "create") {
      updateCreatePreview(event.clientX);
    }
  }

  function onPointerUp(event) {
    if (!gesture) return;
    const finished = gesture;
    if (!finished.active) {
      cleanupGesture();
      if (finished.type === "move") onSelect(finished.task.id);
      return;
    }
    if (finished.type === "move") {
      const target = resolveDropTarget(event.clientX, event.clientY);
      cleanupGesture();
      if (target) onAssign(finished.task.id, target.kind === "person" ? target.key : "");
      return;
    }
    const endProps = bottom.timeline.getEventProperties(eventAt(event.clientX, finished.startY));
    cleanupGesture();
    const times = [finished.startTime, endProps?.time].filter((time) => time instanceof Date);
    if (times.length !== 2) return;
    const [first, last] = times[0] <= times[1] ? times : [times[1], times[0]];
    // La borne de fin tombe souvent pile à minuit : elle désigne alors le jour d'avant.
    onCreateRange(startOfDay(first), startOfDay(new Date(last.getTime() - 1)));
  }

  function onPointerDown(pane, event) {
    if (event.button !== 0 || gesture) return;
    hideMenu();
    const { props, task } = taskFromEvent(pane, event);
    if (task) {
      event.stopPropagation();
      event.preventDefault();
      // Verrouillé : un clic sélectionne, un glisser n'attribue rien.
      if (isEditable()) beginTaskDrag(pane, task, event);
      else {
        onSelect(task.id);
        return;
      }
    } else if (
      pane === bottom &&
      props?.time instanceof Date &&
      // Toute la surface datée de la zone compte, fonds de week-end compris :
      // sous la ligne unique, vis ne classe plus le clic en « background ».
      event.target?.closest?.(".vis-panel.vis-center")
    ) {
      if (!isEditable()) {
        onLockedAttempt();
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      beginCreate(event, props);
    } else {
      return;
    }
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
  }

  timelines.forEach((pane) => {
    pane.host.addEventListener("pointerdown", (event) => onPointerDown(pane, event), true);
    // vis démarre aussi ses gestes sur mousedown : on le neutralise pendant les nôtres.
    pane.host.addEventListener("mousedown", (event) => {
      if (gesture) event.stopPropagation();
    }, true);
  });

  return { hideTooltip, hideMenu };
}
