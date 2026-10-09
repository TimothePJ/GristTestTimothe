// Diagramme de Gantt de la vue Synthese, dessiné en SVG dans le panneau droit du tableau
// de tâches : échelle des dates dans l'en-tête, une couche de formes alignée sur les
// lignes (même modèle de lignes, même hauteur de ligne). La période est celle du
// planning : glisser la déplace, Ctrl + molette (ou la molette sur l'échelle) zoome.
// Lecture seule : les dates se modifient dans le tableau.
import {
  LABEL_GAP_PX,
  MILESTONE_HALF_PX,
  ROW_HEIGHT_PX,
  TASK_BAR_HEIGHT_PX,
  buildGanttLinks,
  buildGanttShapes,
  buildNonWorkingBands,
  buildScaleTiers,
  createTimeScale,
  currentWeekWindow,
  panWindow,
  todayX,
  wheelZoomSteps,
  zoomWindow,
} from "../services/syntheseGanttGeometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SCALE_TIER_HEIGHT_PX = 16;
const LABEL_BASELINE_PX = 4;
const ZONE_BAR_TOP_PX = 7;
const ZONE_BAR_HEIGHT_PX = 5;
const ZONE_CAP_PX = 6;
const FLOOR_BRACKET_TOP_PX = 8;
const FLOOR_TICK_PX = 6;
const LIMIT_INSET_PX = 2;
const LINK_HEAD_PX = 4;

// Pointe pleine d'une flèche, selon sa direction.
const LINK_HEADS = Object.freeze({
  down: (x, y) => [[x - LINK_HEAD_PX, y - LINK_HEAD_PX], [x + LINK_HEAD_PX, y - LINK_HEAD_PX], [x, y]],
  up: (x, y) => [[x - LINK_HEAD_PX, y + LINK_HEAD_PX], [x + LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]],
  right: (x, y) => [[x - LINK_HEAD_PX, y - LINK_HEAD_PX], [x - LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]],
  left: (x, y) => [[x + LINK_HEAD_PX, y - LINK_HEAD_PX], [x + LINK_HEAD_PX, y + LINK_HEAD_PX], [x, y]],
});

function svgElement(tag, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  if (text != null) element.textContent = text;
  return element;
}

function px(value) {
  return Math.round(value * 10) / 10;
}

function toPoints(points) {
  return points.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
}

function isGanttTarget(target) {
  return target instanceof Element && Boolean(target.closest(".stt-right"));
}

export function createSyntheseGantt({ headHost, layerHost, interactionHost, rowHeight = ROW_HEIGHT_PX }, {
  getWindow = () => null,
  setWindow = () => {},
  subscribe = () => () => {},
  now = () => new Date(),
} = {}) {
  let lines = [];
  let frame = 0;
  let drag = null;
  let wheelPending = 0;
  let fallbackRange = null;

  const scaleSvg = svgElement("svg", { class: "stg-scale", "aria-hidden": "true" });
  const layerSvg = svgElement("svg", { class: "stg-layer", "aria-hidden": "true" });
  headHost.replaceChildren(scaleSvg);
  layerHost.replaceChildren(layerSvg);

  // Période du planning ; tant qu'il n'en a pas (timeline jamais créée), celle du Gantt,
  // qui part de la semaine en cours.
  function currentWindow() {
    const range = getWindow();
    const start = range?.start ? new Date(+range.start) : null;
    const end = range?.end ? new Date(+range.end) : null;
    if (start && end && end > start) return { start, end };
    return fallbackRange || currentWeekWindow(now());
  }

  // Déplacement ou zoom : le planning suit ; tant qu'il n'a pas de période, le Gantt garde
  // la sienne.
  function moveWindow(next) {
    fallbackRange = next;
    setWindow(next.start, next.end);
    schedule();
  }

  /* ---------- Dessin ---------- */

  function drawScale(scale) {
    const tiers = buildScaleTiers(scale);
    const nodes = [];
    [tiers.top, tiers.bottom].forEach((ticks, tierIndex) => {
      const top = tierIndex * SCALE_TIER_HEIGHT_PX;
      ticks.forEach((tick) => {
        nodes.push(svgElement("line", {
          class: "stg-scale-tick",
          x1: px(tick.x1),
          x2: px(tick.x1),
          y1: top,
          y2: top + SCALE_TIER_HEIGHT_PX,
        }));
        if (tick.label) {
          nodes.push(svgElement("text", {
            class: "stg-scale-text",
            x: px((tick.x1 + tick.x2) / 2),
            y: top + 12,
            "text-anchor": "middle",
          }, tick.label));
        }
      });
    });
    nodes.push(svgElement("line", {
      class: "stg-scale-tick",
      x1: 0,
      x2: px(scale.width),
      y1: SCALE_TIER_HEIGHT_PX,
      y2: SCALE_TIER_HEIGHT_PX,
    }));
    scaleSvg.setAttribute("width", String(px(scale.width)));
    scaleSvg.setAttribute("height", String(SCALE_TIER_HEIGHT_PX * 2));
    scaleSvg.replaceChildren(...nodes);
  }

  function drawShape(shape) {
    const middle = shape.y + rowHeight / 2;
    const baseline = middle + LABEL_BASELINE_PX;
    // Limite de fin d'un plan de réservations : un trait pointillé sur la hauteur de sa ligne.
    if (shape.type === "endLimit") {
      return [svgElement("line", {
        class: "stg-limit",
        x1: px(shape.x),
        x2: px(shape.x),
        y1: px(shape.y + LIMIT_INSET_PX),
        y2: px(shape.y + rowHeight - LIMIT_INSET_PX),
      })];
    }
    if (shape.type === "taskBar") {
      return [
        svgElement("rect", {
          class: shape.overLimit ? "stg-task is-over-limit" : "stg-task",
          x: px(shape.x1),
          y: px(middle - TASK_BAR_HEIGHT_PX / 2),
          width: px(shape.x2 - shape.x1),
          height: TASK_BAR_HEIGHT_PX,
        }),
        svgElement("text", { class: "stg-label", x: px(shape.x2 + LABEL_GAP_PX), y: px(baseline) }, shape.label),
      ];
    }
    if (shape.type === "milestone") {
      const half = MILESTONE_HALF_PX;
      return [
        svgElement("polygon", {
          class: shape.overLimit ? "stg-milestone is-over-limit" : "stg-milestone",
          points: toPoints([
            [shape.x, middle - half],
            [shape.x + half, middle],
            [shape.x, middle + half],
            [shape.x - half, middle],
          ]),
        }),
        svgElement("text", {
          class: "stg-label",
          x: px(shape.x - half - LABEL_GAP_PX),
          y: px(baseline),
          "text-anchor": "end",
        }, shape.label),
        svgElement("text", { class: "stg-date", x: px(shape.x + half + LABEL_GAP_PX), y: px(baseline) }, shape.dateLabel),
      ];
    }
    // Étage : crochet fin, une patte vers le bas à chaque bout, nom à droite.
    if (shape.type === "floorBracket") {
      const top = shape.y + FLOOR_BRACKET_TOP_PX;
      return [
        svgElement("polyline", {
          class: "stg-floor",
          points: toPoints([
            [shape.x1, top + FLOOR_TICK_PX],
            [shape.x1, top],
            [shape.x2, top],
            [shape.x2, top + FLOOR_TICK_PX],
          ]),
        }),
        svgElement("text", { class: "stg-label", x: px(shape.x2 + LABEL_GAP_PX), y: px(baseline) }, shape.label),
      ];
    }
    // Barre de zone : trait noir, une pointe vers le bas à chaque extrémité.
    const top = shape.y + ZONE_BAR_TOP_PX;
    const bottom = top + ZONE_BAR_HEIGHT_PX;
    const cap = Math.min(ZONE_CAP_PX, Math.max(0, (shape.x2 - shape.x1) / 2));
    return [
      svgElement("polygon", {
        class: "stg-zone",
        points: toPoints([
          [shape.x1, top],
          [shape.x2, top],
          [shape.x2, bottom + ZONE_CAP_PX],
          [shape.x2 - cap, bottom],
          [shape.x1 + cap, bottom],
          [shape.x1, bottom + ZONE_CAP_PX],
        ]),
      }),
      svgElement("text", {
        class: "stg-label",
        x: px(shape.x1 - LABEL_GAP_PX),
        y: px(baseline),
        "text-anchor": "end",
      }, shape.label),
    ];
  }

  // Flèche entre deux tâches : trait, puis pointe pleine dans sa direction.
  function drawLink(link) {
    const { x, y, direction } = link.head;
    const head = (LINK_HEADS[direction] || LINK_HEADS.right)(x, y);
    return [
      svgElement("polyline", { class: "stg-link", points: toPoints(link.points) }),
      svgElement("polygon", { class: "stg-link-head", points: toPoints(head) }),
    ];
  }

  function drawLayer(scale, height) {
    const nodes = buildNonWorkingBands(scale).map((band) => svgElement("rect", {
      class: "stg-off",
      x: px(band.x1),
      y: 0,
      width: px(band.x2 - band.x1),
      height,
    }));
    const today = todayX(scale, now());
    if (today != null) {
      nodes.push(svgElement("line", { class: "stg-today", x1: px(today), x2: px(today), y1: 0, y2: height }));
    }
    buildGanttLinks(lines, scale, { rowHeight }).forEach((link) => nodes.push(...drawLink(link)));
    buildGanttShapes(lines, scale, { rowHeight }).forEach((shape) => nodes.push(...drawShape(shape)));
    layerSvg.setAttribute("width", String(px(scale.width)));
    layerSvg.setAttribute("height", String(height));
    layerSvg.replaceChildren(...nodes);
  }

  function draw() {
    frame = 0;
    const height = lines.length * rowHeight;
    layerHost.style.height = `${height}px`;
    const width = layerHost.clientWidth;
    if (!(width > 0)) {
      scaleSvg.replaceChildren();
      layerSvg.replaceChildren();
      return;
    }
    const range = currentWindow();
    const scale = createTimeScale({ start: range.start, end: range.end, width });
    drawScale(scale);
    drawLayer(scale, height);
  }

  // Un seul dessin par image, quel que soit le nombre de demandes (lignes, période, taille).
  function schedule() {
    if (frame) return;
    frame = window.requestAnimationFrame(draw);
  }

  /* ---------- Glisser et zoom ---------- */

  // Évènement pour le Gantt : sur une cellule droite (ligne ou échelle), ou dans la zone vide
  // sous les lignes — le conteneur défilant lui-même — à l'aplomb de la couche, barre de
  // défilement exclue.
  function isGanttEvent(event) {
    if (isGanttTarget(event.target)) return true;
    if (event.target !== interactionHost) return false;
    const rect = layerHost.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX < rect.right;
  }

  interactionHost.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !isGanttEvent(event)) return;
    const rect = layerHost.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, startX: event.clientX, width: rect.width, range: currentWindow() };
    try {
      interactionHost.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché : le glisser s'arrêtera au prochain pointerup.
    }
    interactionHost.classList.add("is-panning");
  });

  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try {
      interactionHost.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Capture déjà rendue par le navigateur.
    }
    interactionHost.classList.remove("is-panning");
    drag = null;
  };

  interactionHost.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Bouton relâché sans pointerup (changement de fenêtre, capture refusée) : fin du glisser.
    if (!(event.buttons & 1)) {
      endDrag(event);
      return;
    }
    moveWindow(panWindow(drag.range, event.clientX - drag.startX, drag.width));
  });

  interactionHost.addEventListener("pointerup", endDrag);
  interactionHost.addEventListener("pointercancel", endDrag);
  interactionHost.addEventListener("lostpointercapture", endDrag);

  // Ctrl + molette sur le Gantt, ou molette sur l'échelle : zoom centré sous le curseur, un pas
  // x1,25 par cran. La molette seule sur les lignes garde le défilement vertical du tableau.
  interactionHost.addEventListener("wheel", (event) => {
    if (!event.deltaY || !isGanttEvent(event)) return;
    if (!event.ctrlKey && !headHost.contains(event.target)) return;
    const rect = layerHost.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    event.preventDefault();
    const { steps, pending } = wheelZoomSteps(wheelPending, event.deltaY, event.deltaMode);
    wheelPending = pending;
    if (!steps) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    let next = currentWindow();
    for (let step = 0; step < Math.abs(steps); step += 1) next = zoomWindow(next, ratio, steps < 0);
    moveWindow(next);
  }, { passive: false });

  subscribe(() => schedule());

  // Toute variation de largeur du panneau (séparateur, fenêtre, barre de défilement qui
  // apparaît) redessine ; les changements de hauteur, dus au dessin lui-même, sont ignorés.
  if (typeof ResizeObserver === "function") {
    let observedWidth = -1;
    new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect?.width ?? 0;
      if (width === observedWidth) return;
      observedWidth = width;
      schedule();
    }).observe(layerHost);
  }

  return {
    render(nextLines) {
      lines = Array.isArray(nextLines) ? nextLines : [];
      schedule();
    },
    resize() {
      schedule();
    },
  };
}
