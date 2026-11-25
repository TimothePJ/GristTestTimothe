// Largeur réglable des colonnes du planning Structure : une poignée sur le bord droit de chaque
// titre de colonne, comme dans le tableau de Synthèse. Glisser change la largeur de la colonne,
// un double-clic lui rend celle de la feuille de style. Les largeurs réglées sont posées en ligne
// sur les variables --col-* de `root` et mémorisées dans le navigateur, jamais dans Grist.
// Le volet gauche et la timeline suivent par les fonctions reçues (ui/timeline.js).
import {
  COLUMN_WIDTHS_STORAGE_KEY,
  PLANNING_COLUMNS,
  columnCssVar,
  readColumnWidths,
  resizeColumn,
} from "../services/planningColumnWidths.js";

const HANDLE_CLASS = "planning-col-resize";
// Posée sur `root` le temps du glisser : curseur de largeur partout, pas de sélection de texte.
const RESIZING_CLASS = "is-planning-col-resizing";

function readStoredWidths(storage) {
  try {
    return readColumnWidths(storage?.getItem(COLUMN_WIDTHS_STORAGE_KEY));
  } catch (_error) {
    return {};
  }
}

function storeWidths(storage, widths) {
  try {
    if (Object.keys(widths).length) storage?.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
    else storage?.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
  } catch (_error) {
    // Stockage indisponible : les largeurs restent celles de la session.
  }
}

// `header` : la rangée des titres ; `root` : l'élément qui porte les variables --col-*.
// `readWidth(key)` : largeur affichée d'une colonne (px). `getMaxWidth({ key, width, cell })` : la
// plus grande largeur permise, demandée au début du glisser, après `onResizeStart()`.
// `fitWidths({ custom, defaults })` : largeurs à afficher pour les colonnes réglées, ajustées à la
// fenêtre (par défaut, telles quelles). `onResize(delta)` (écart depuis le début du glisser) et
// `onResizeEnd({ moved })` : le volet gauche suit, puis la timeline est redessinée si ça a bougé.
export function bindPlanningColumnResize({
  header,
  root,
  doc = document,
  storage = null,
  readWidth,
  getMaxWidth = () => Infinity,
  fitWidths = ({ custom }) => custom,
  onResizeStart,
  onResize,
  onResizeEnd,
}) {
  // Largeurs voulues par l'utilisateur, pour les seules colonnes qu'il a réglées ; les autres
  // suivent la feuille de style. La largeur affichée peut être plus petite (fenêtre étroite).
  let widths = readStoredWidths(storage);
  // Fin du glisser en cours, s'il y en a un.
  let endActiveDrag = null;

  function applyWidths() {
    const keys = Object.keys(widths);
    if (!keys.length) return;
    // Les largeurs de la feuille de style se lisent sans les réglages.
    keys.forEach((key) => root.style.removeProperty(columnCssVar(key)));
    const defaults = Object.fromEntries(PLANNING_COLUMNS.map(({ key }) => [key, readWidth(key)]));
    const fitted = fitWidths({ custom: { ...widths }, defaults });
    keys.forEach((key) => {
      root.style.setProperty(columnCssVar(key), `${fitted[key] ?? widths[key]}px`);
    });
  }

  applyWidths();

  Array.from(header.children).forEach((cell) => {
    const column = PLANNING_COLUMNS.find(({ key }) => cell.classList.contains(`c-${key}`));
    if (!column) return;
    const handle = doc.createElement("span");
    handle.className = HANDLE_CLASS;
    handle.dataset.column = column.key;
    handle.setAttribute("aria-hidden", "true");
    handle.title = `Glisser pour changer la largeur de « ${column.label} » ; double-clic : largeur par défaut`;
    cell.appendChild(handle);
  });

  const handleOf = (event) => event.target?.closest?.(`.${HANDLE_CLASS}`) || null;

  header.addEventListener("pointerdown", (event) => {
    const handle = handleOf(event);
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    // Glisser précédent jamais relâché : il se termine ici.
    endActiveDrag?.();
    const key = handle.dataset.column;
    const cssVar = columnCssVar(key);
    const startX = event.clientX;
    const startWidth = readWidth(key);
    const startInline = root.style.getPropertyValue(cssVar);
    let width = startWidth;
    let moved = false;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointeur déjà relâché.
    }
    root.classList.add(RESIZING_CLASS);
    onResizeStart?.();
    const maxWidth = getMaxWidth({ key, width: startWidth, cell: handle.parentNode });

    function onEnd() {
      endActiveDrag = null;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      handle.removeEventListener("lostpointercapture", onEnd);
      root.classList.remove(RESIZING_CLASS);
      if (width !== startWidth) {
        widths = { ...widths, [key]: width };
        storeWidths(storage, widths);
      } else if (moved) {
        // Revenue à sa largeur de départ : la colonne retrouve l'état qu'elle avait.
        if (startInline) root.style.setProperty(cssVar, startInline);
        else root.style.removeProperty(cssVar);
      }
      onResizeEnd?.({ moved });
    }

    function onMove(moveEvent) {
      // Bouton relâché sans que le relâchement ait été reçu : le survol ne règle plus rien.
      if (moveEvent.buttons === 0) {
        onEnd();
        return;
      }
      const next = resizeColumn(startWidth, moveEvent.clientX - startX, maxWidth);
      if (next === width) return;
      width = next;
      moved = true;
      root.style.setProperty(cssVar, `${width}px`);
      onResize?.(width - startWidth);
    }

    endActiveDrag = onEnd;
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    handle.addEventListener("lostpointercapture", onEnd);
  });

  // Double-clic sur une poignée : la colonne reprend la largeur de la feuille de style.
  header.addEventListener("dblclick", (event) => {
    const handle = handleOf(event);
    if (!handle) return;
    const key = handle.dataset.column;
    if (!(key in widths)) return;
    const before = readWidth(key);
    onResizeStart?.();
    root.style.removeProperty(columnCssVar(key));
    const { [key]: _reset, ...kept } = widths;
    widths = kept;
    storeWidths(storage, widths);
    onResize?.(readWidth(key) - before);
    onResizeEnd?.({ moved: true });
  });

  return {
    // Au moins une colonne a une largeur réglée par l'utilisateur.
    hasCustomWidths: () => Object.keys(widths).length > 0,
    // La fenêtre a changé de largeur : les largeurs réglées sont réajustées à ce qui tient.
    refit() {
      if (endActiveDrag) return;
      applyWidths();
    },
  };
}
