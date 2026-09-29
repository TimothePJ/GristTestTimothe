// Glisser-déposer des tâches du tableau Synthese : on attrape une tâche par sa poignée et
// on la lâche sur une zone, un étage ou une autre tâche ; la ligne visée se déduit de la
// position verticale du pointeur (hauteur de ligne fixe), pas de l'élément survolé, si
// bien qu'un redessin du tableau pendant le glisser ne le perturbe pas. Pendant le glisser,
// une copie de la ligne (rendue par le tableau) suit le pointeur, tenue là où on l'a
// attrapée, avec la destination en légende. Le module ne décide que de la cible : le
// déplacement lui-même est confié à onDrop.
import { containerKeyOf, resolveDropTarget } from "../services/syntheseTaskModel.js";

export const DRAG_THRESHOLD_PX = 4;
export const AUTO_SCROLL_EDGE_PX = 24;
export const AUTO_SCROLL_STEP_PX = 12;

// Rang de la ligne sous le pointeur, ou -1 hors des lignes.
export function lineIndexAt(clientY, bodyTop, rowHeight, count) {
  const index = Math.floor((clientY - bodyTop) / rowHeight);
  return index >= 0 && index < count ? index : -1;
}

export function createTaskDrag({
  root,
  scroller,
  body,
  rowHeight,
  headHeight = 0,
  getLines = () => [],
  isEnabled = () => true,
  highlight = () => {},
  // Copie de la ligne glissée (élément), placée sous le pointeur ; null : légende seule.
  renderPreview = () => null,
  // Ligne d'origine à estomper (clé de ligne), puis null à la fin du glisser.
  markSource = () => {},
  onDrop = () => {},
  doc = document,
  win = window,
} = {}) {
  let drag = null;
  let ghost = null;
  let caption = null;
  let scrollFrame = 0;

  function onKeyDown(event) {
    if (event.key !== "Escape" || !drag) return;
    event.preventDefault();
    finish();
  }

  function begin() {
    drag.started = true;
    ghost = doc.createElement("div");
    ghost.className = "stt-drag-ghost";
    // Simple image de la ligne : ni focus ni lecteur d'écran.
    ghost.inert = true;
    const preview = renderPreview(drag.line);
    if (preview) ghost.appendChild(preview);
    caption = doc.createElement("div");
    caption.className = "stt-drag-ghost__label";
    caption.hidden = true;
    ghost.appendChild(caption);
    root.appendChild(ghost);
    root.classList.add("is-dragging");
    doc.documentElement.classList.add("is-stt-dragging");
    markSource(drag.line.key);
    doc.addEventListener("keydown", onKeyDown, true);
  }

  // Défilement automatique quand le pointeur approche du haut (sous l'en-tête) ou du bas.
  function updateAutoScroll(rect) {
    if (drag.clientY < rect.top + headHeight + AUTO_SCROLL_EDGE_PX) drag.scrollDirection = -1;
    else if (drag.clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) drag.scrollDirection = 1;
    else drag.scrollDirection = 0;
    if (drag.scrollDirection && !scrollFrame) scrollFrame = win.requestAnimationFrame(autoScroll);
  }

  function autoScroll() {
    scrollFrame = 0;
    if (!drag?.started || !drag.scrollDirection) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += drag.scrollDirection * AUTO_SCROLL_STEP_PX;
    // En butée (haut ou bas de la liste) : on s'arrête, sans demander d'autre image.
    if (scroller.scrollTop === before) return;
    update();
  }

  // Cible sous le pointeur, seulement dans la bande visible des lignes (sous l'en-tête collant,
  // dans le conteneur défilant) : ailleurs rien n'est visé, et lâcher annule.
  function update() {
    const rect = scroller.getBoundingClientRect();
    const inRows = drag.clientY >= rect.top + headHeight && drag.clientY < rect.bottom &&
      drag.clientX >= rect.left && drag.clientX < rect.right;
    const lines = getLines();
    const index = inRows
      ? lineIndexAt(drag.clientY, body.getBoundingClientRect().top, rowHeight, lines.length)
      : -1;
    const target = index >= 0 ? resolveDropTarget(lines[index]) : null;
    drag.target = target && target.key !== drag.sourceKey ? target : null;
    const label = drag.target ? drag.target.label : "";
    if (caption.textContent !== label) caption.textContent = label;
    caption.hidden = !label;
    // La copie garde l'écart entre le pointeur et le coin de la ligne au moment de l'appui.
    ghost.style.left = `${drag.clientX - drag.offsetX}px`;
    ghost.style.top = `${drag.clientY - drag.offsetY}px`;
    highlight(drag.target ? drag.target.key : null);
    updateAutoScroll(rect);
  }

  function finish() {
    if (!drag) return;
    const { pointerId, started } = drag;
    drag = null;
    if (scrollFrame) win.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    try {
      scroller.releasePointerCapture(pointerId);
    } catch (_error) {
      // Capture déjà rendue par le navigateur.
    }
    if (!started) return;
    ghost?.remove();
    ghost = null;
    caption = null;
    root.classList.remove("is-dragging");
    doc.documentElement.classList.remove("is-stt-dragging");
    highlight(null);
    markSource(null);
    doc.removeEventListener("keydown", onKeyDown, true);
  }

  // Appui sur une poignée : on suit le pointeur (capturé par le conteneur défilant, qui
  // survit aux redessins) ; le glisser ne commence qu'au-delà du seuil.
  body.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== 0 || !isEnabled()) return;
    const target = event.target instanceof Element ? event.target : null;
    const lineElement = target?.closest(".stt-grip")?.closest(".stt-line");
    if (!lineElement || lineElement.dataset.kind !== "task") return;
    const taskId = Number(lineElement.dataset.taskId);
    const line = getLines().find((candidate) => candidate.kind === "task" && candidate.taskId === taskId);
    if (!line) return;
    const lineRect = lineElement.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      taskId,
      line,
      sourceKey: containerKeyOf(line),
      offsetX: event.clientX - lineRect.left,
      offsetY: event.clientY - lineRect.top,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      started: false,
      target: null,
      scrollDirection: 0,
    };
    try {
      scroller.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché : le glisser s'arrêtera au prochain mouvement.
    }
  });

  scroller.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Bouton relâché sans pointerup (changement de fenêtre) : fin du glisser, sans dépôt.
    if (!(event.buttons & 1)) {
      finish();
      return;
    }
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return;
      begin();
    }
    update();
  });

  scroller.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { started, target, taskId } = drag;
    finish();
    if (started && target) onDrop(taskId, target);
  });

  // La liste peut défiler sans que le pointeur bouge (molette, clavier) : la cible suit.
  scroller.addEventListener("scroll", () => {
    if (drag?.started) update();
  }, { passive: true });

  const cancel = (event) => {
    if (drag && event.pointerId === drag.pointerId) finish();
  };
  scroller.addEventListener("pointercancel", cancel);
  scroller.addEventListener("lostpointercapture", cancel);

  return { cancel: finish };
}
