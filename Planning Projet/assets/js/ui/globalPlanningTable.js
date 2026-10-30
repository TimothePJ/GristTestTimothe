// Tableau de la vue Global (Planning Projet) : les lignes du planning fusionné Synthèse +
// Structure, en lecture seule. Même mise en page que le tableau de tâches de la vue Synthese
// (en-tête collant, hauteur de ligne fixe, panneau droit réservé au Gantt, séparateur
// déplaçable), avec une colonne « État » et une barre d'état. Aucune saisie, aucun menu : il
// signale seulement les replis et le bouton « Alertes seulement ». Ses dépendances sont
// injectées (document, fenêtre, stockage, fabrique du Gantt) : doublures en test.
import { formatDate } from "../services/syntheseTaskModel.js";
import { describeCounts } from "../services/globalChecks.js";

const LEFT_WIDTH_STORAGE_KEY = "planning-projet.global-planning.left-width";
// Largeur par défaut du tableau : un nom lisible, les cinq colonnes du tableau Synthese et
// l'état (voir --gpl-col-state dans styles.css).
export const DEFAULT_LEFT_WIDTH = 980;
// Le minimum doit rester au moins la somme des pistes minimales de la grille :
// 180 + 56 + 56 + 60 + 92 + 92 + 120 = 656 px (voir --gpl-col-name-min, --gpl-col-state-min
// et les largeurs --stt-col-* dans styles.css).
export const MIN_LEFT_WIDTH = 660;
const MIN_RIGHT_WIDTH = 160;
// Hauteur d'une ligne, identique à --stt-row-height (styles.css) : le Gantt s'aligne dessus.
const ROW_HEIGHT_PX = 26;
const KEYBOARD_STEP_PX = 24;
// Retrait du nom : un cran par niveau ; une ligne sans triangle garde la place du triangle.
const INDENT_PX = 16;
const NAME_PADDING_PX = 4;
const TOGGLE_SPACE_PX = 22;
export const COLUMNS = Object.freeze([
  { field: "name", label: "Nom" },
  { field: "id2", label: "N°" },
  { field: "indice", label: "Indice" },
  { field: "duration", label: "Durée" },
  { field: "start", label: "Début" },
  { field: "end", label: "Fin" },
  { field: "state", label: "État" },
]);

function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

// L'élément portant la classe, à partir de la cible d'un évènement (un nœud de texte n'a pas
// de closest : on part de son parent).
function closestOf(target, className) {
  const element = typeof target?.closest === "function" ? target : target?.parentElement;
  return element?.closest?.(`.${className}`) || null;
}

function dateText(date) {
  return date instanceof Date ? formatDate(date) : "";
}

function textCell(doc, field, text) {
  const cell = createElement(doc, "div", `stt-cell stt-cell--${field}`, text || "");
  cell.setAttribute("role", "gridcell");
  return cell;
}

function buildNameCell(line, doc) {
  const cell = createElement(doc, "div", "stt-cell stt-cell--name");
  cell.setAttribute("role", "gridcell");
  cell.title = line.name;
  cell.style.paddingLeft = `${NAME_PADDING_PX + line.level * INDENT_PX + (line.expandable ? 0 : TOGGLE_SPACE_PX)}px`;
  if (line.expandable) {
    const toggle = createElement(doc, "button", "stt-toggle", line.collapsed ? "▸" : "▾");
    toggle.type = "button";
    // Replier / déplier n'écrit rien : le contexte partagé ne doit pas le griser en lecture seule.
    toggle.dataset.serviceContextNavigation = "";
    toggle.setAttribute("aria-label", `${line.collapsed ? "Déplier" : "Replier"} ${line.name}`);
    cell.appendChild(toggle);
  }
  cell.appendChild(createElement(doc, "span", "stt-text", line.name));
  if (line.countLabel) cell.appendChild(createElement(doc, "span", "gpl-count", line.countLabel));
  return cell;
}

// Cellule « État » : une part par alerte ou par famille, séparées par un point médian, en
// couleur fixe. L'explication complète est au survol.
export function buildStateCell(line, doc = document) {
  const cell = createElement(doc, "div", "stt-cell stt-cell--state");
  cell.setAttribute("role", "gridcell");
  const parts = line.state?.parts || [];
  parts.forEach((part, index) => {
    if (index) cell.appendChild(createElement(doc, "span", "gpl-state__sep", "·"));
    cell.appendChild(createElement(doc, "span", `gpl-state__part is-tone-${part.tone}`, part.text));
  });
  const title = line.state?.title || parts.map((part) => part.text).join(" · ");
  if (title) cell.title = title;
  return cell;
}

// Une ligne du tableau : partie gauche (les sept colonnes) et emplacement de sa ligne dans le
// Gantt, à la même hauteur.
export function buildLineElement(line, doc = document) {
  const classes = ["stt-line", "gpl-line", `gpl-line--${line.role}`];
  if (line.nature) classes.push(`is-nature-${line.nature}`);
  if (line.variant) classes.push(`is-type-${line.variant}`);
  if (line.isMilestone) classes.push("is-milestone");
  const element = createElement(doc, "div", classes.join(" "));
  element.setAttribute("role", "row");
  element.setAttribute("aria-level", String(line.level + 1));
  element.dataset.lineKey = line.key;
  if (line.expandable) element.setAttribute("aria-expanded", String(!line.collapsed));

  const left = createElement(doc, "div", "stt-left");
  left.appendChild(buildNameCell(line, doc));
  left.appendChild(textCell(doc, "id2", line.id2));
  left.appendChild(textCell(doc, "indice", line.indice));
  left.appendChild(textCell(doc, "duration", line.durationLabel));
  left.appendChild(textCell(doc, "start", dateText(line.start)));
  const end = textCell(doc, "end", dateText(line.end));
  // Retard de la Synthèse par rapport à Structure : la date de fin en rouge.
  if (line.lateEnd) end.classList.add("is-late");
  if (line.endLimitNote) end.title = line.endLimitNote;
  left.appendChild(end);
  left.appendChild(buildStateCell(line, doc));
  element.appendChild(left);
  element.appendChild(createElement(doc, "div", "stt-right"));
  return element;
}

function safeStorage(win) {
  return {
    getItem(key) {
      try {
        return win.localStorage.getItem(key);
      } catch (_error) {
        return null;
      }
    },
    setItem(key, value) {
      try {
        win.localStorage.setItem(key, value);
      } catch (_error) {
        // Stockage indisponible : la largeur reste celle de la session.
      }
    },
  };
}

export function createGlobalPlanningTable(host, {
  onToggle,
  onToggleAlertsOnly,
} = {}, {
  createGantt = null,
  doc = document,
  win = window,
  storage = safeStorage(win),
} = {}) {
  const root = createElement(doc, "div", "stt gpl");
  const scroller = createElement(doc, "div", "stt-scroll");
  scroller.setAttribute("role", "treegrid");
  scroller.setAttribute("aria-label", "Planning global du projet");
  scroller.setAttribute("aria-readonly", "true");

  const head = createElement(doc, "div", "stt-line stt-line--head");
  head.setAttribute("role", "row");
  const headLeft = createElement(doc, "div", "stt-left");
  COLUMNS.forEach(({ field, label }) => {
    const cell = createElement(doc, "div", `stt-cell stt-cell--${field}`, label);
    cell.setAttribute("role", "columnheader");
    headLeft.appendChild(cell);
  });
  // Bande réservée à l'échelle des dates du Gantt.
  const headRight = createElement(doc, "div", "stt-right stt-right--head");
  head.appendChild(headLeft);
  head.appendChild(headRight);

  const body = createElement(doc, "div", "stt-body");
  body.setAttribute("role", "rowgroup");
  const empty = createElement(doc, "p", "stt-empty");
  empty.hidden = true;
  // Couche du Gantt : dans le conteneur défilant mais hors du corps, que chaque rendu
  // reconstruit ; alignée sur les lignes par la hauteur fixe.
  const ganttLayer = createElement(doc, "div", "stt-gantt-layer");
  scroller.appendChild(head);
  scroller.appendChild(body);
  scroller.appendChild(empty);
  scroller.appendChild(ganttLayer);

  const splitter = createElement(doc, "div", "stt-splitter");
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Largeur du tableau du planning global");
  splitter.tabIndex = 0;

  const bar = createElement(doc, "div", "gpl-bar");
  const counts = createElement(doc, "span", "gpl-bar__counts");
  counts.setAttribute("role", "status");
  counts.setAttribute("aria-live", "polite");
  const notice = createElement(doc, "span", "gpl-bar__notice");
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  const alertsButton = createElement(doc, "button", "gpl-bar__button", "Alertes seulement");
  alertsButton.type = "button";
  alertsButton.dataset.serviceContextNavigation = "";
  alertsButton.setAttribute("aria-pressed", "false");
  alertsButton.title = "Ne garder que les lignes en alerte";
  bar.appendChild(counts);
  bar.appendChild(notice);
  bar.appendChild(alertsButton);

  root.appendChild(scroller);
  root.appendChild(splitter);
  root.appendChild(bar);
  host.replaceChildren(root);

  const gantt = typeof createGantt === "function"
    ? createGantt({ headHost: headRight, layerHost: ganttLayer, interactionHost: scroller, rowHeight: ROW_HEIGHT_PX })
    : null;

  const storedWidth = Number(storage.getItem(LEFT_WIDTH_STORAGE_KEY));
  let leftWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : DEFAULT_LEFT_WIDTH;

  /* ---------- Largeur du tableau ---------- */

  function clampWidth(width) {
    const available = root.clientWidth || 0;
    const max = available ? Math.max(MIN_LEFT_WIDTH, available - MIN_RIGHT_WIDTH) : Infinity;
    return Math.min(max, Math.max(MIN_LEFT_WIDTH, width));
  }

  function applyWidth(width, { persist = false } = {}) {
    leftWidth = clampWidth(width);
    root.style.setProperty?.("--stt-left-width", `${Math.round(leftWidth)}px`);
    splitter.setAttribute("aria-valuenow", String(Math.round(leftWidth)));
    if (persist) storage.setItem(LEFT_WIDTH_STORAGE_KEY, String(Math.round(leftWidth)));
    gantt?.resize();
  }

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
    applyWidth(leftWidth + (event.key === "ArrowRight" ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX), { persist: true });
  });

  win.addEventListener?.("resize", () => applyWidth(leftWidth));

  /* ---------- Replis et bouton ---------- */

  body.addEventListener("click", (event) => {
    const toggle = closestOf(event.target, "stt-toggle");
    const lineElement = toggle ? closestOf(toggle, "stt-line") : null;
    if (lineElement) onToggle?.(lineElement.dataset.lineKey);
  });
  alertsButton.addEventListener("click", () => onToggleAlertsOnly?.());

  applyWidth(leftWidth);

  return {
    // `lines` : le modèle de lignes (buildGlobalRowModel). `emptyMessage` remplace les lignes ;
    // `totals` alimente la barre d'état ; `notice` y signale une relecture en échec.
    render(lines, { emptyMessage = "", totals = null, alertsOnly = false, notice: noticeText = "" } = {}) {
      const list = emptyMessage ? [] : Array.isArray(lines) ? lines : [];
      empty.textContent = emptyMessage;
      empty.hidden = !emptyMessage;
      body.hidden = Boolean(emptyMessage);
      body.replaceChildren(...list.map((line) => buildLineElement(line, doc)));
      gantt?.render(list);
      counts.textContent = totals ? describeCounts(totals) : "";
      notice.textContent = noticeText;
      notice.hidden = !noticeText;
      alertsButton.setAttribute("aria-pressed", String(Boolean(alertsOnly)));
      if (alertsOnly) alertsButton.classList.add("is-active");
      else alertsButton.classList.remove("is-active");
      applyWidth(leftWidth);
    },
  };
}
