// Géométrie du diagramme de Gantt de la vue Synthese. Module pur (sans DOM) :
// conversion date ↔ pixel, formes à dessiner pour chaque ligne du modèle de lignes,
// graduations de l'échelle, jours non travaillés, position d'aujourd'hui, et période
// après un glisser ou un zoom. Testable sous Node.
import { isWorkingDay } from "./syntheseTasks.js";
import { isFrenchHoliday } from "../utils/frenchHolidays.js";

export const DAY_MS = 86400000;
export const ROW_HEIGHT_PX = 26;
export const MIN_BAR_WIDTH_PX = 2;
export const MIN_PX_PER_DAY_FOR_OFF_DAYS = 6;

// Formes dans une ligne de 26 px (partagées avec le dessin) et écart des flèches.
export const TASK_BAR_HEIGHT_PX = 14;
export const MILESTONE_HALF_PX = 6;
// Couloir des flèches : les traits verticaux passent à LINK_GAP_PX du bout d'une barre, et
// son libellé commence à LABEL_GAP_PX, si bien que le couloir reste libre.
export const LINK_GAP_PX = 5;
export const LABEL_GAP_PX = 10;

function toMs(value) {
  return value instanceof Date ? value.getTime() : Number(value);
}

function toLocalDay(value) {
  const date = new Date(toMs(value));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

// Une journée va de son minuit local au minuit local suivant (23 h ou 25 h les jours
// de changement d'heure).
export function dayStart(date) {
  return toLocalDay(date).getTime();
}

export function dayEnd(date) {
  return nextLocalDay(toLocalDay(date)).getTime();
}

export function dayCenter(date) {
  return (dayStart(date) + dayEnd(date)) / 2;
}

// Conversion linéaire date ↔ pixel de la période [start ; end] sur `width` pixels. Les
// produits sont calculés avant les divisions pour garder des positions exactes.
export function createTimeScale({ start, end, width }) {
  const startMs = toMs(start);
  const span = Math.max(1, toMs(end) - startMs);
  const safeWidth = Math.max(0, Number(width) || 0);
  return {
    start: startMs,
    end: startMs + span,
    width: safeWidth,
    pxPerDay: (safeWidth * DAY_MS) / span,
    dateToX(value) {
      return ((toMs(value) - startMs) * safeWidth) / span;
    },
    xToDate(x) {
      return new Date(startMs + ((Number(x) || 0) * span) / (safeWidth || 1));
    },
  };
}

function formatDayMonth(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

// Abscisse d'un jalon : lié en fin → début, il tombe à l'heure de fin de son prédécesseur et se
// dessine à la fin de sa journée, comme dans MS Project ; sinon au milieu de sa journée.
function milestoneX(line, scale) {
  return scale.dateToX(line.link?.type === "FD" ? dayEnd(line.start) : dayCenter(line.start));
}

// Une forme par ligne datée du modèle de lignes, à la hauteur de sa ligne. Les lignes
// sans dates ne dessinent rien mais gardent leur rang.
export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const shapes = [];
  (lines || []).forEach((line, row) => {
    if (!(line?.start instanceof Date) || !(line?.end instanceof Date)) return;
    const y = row * rowHeight;
    // Zone (barre noire), étage, cycle et sous-groupe (crochet) : du Début à la Fin du
    // récapitulatif, au centre du jour quand il commence ou finit par un jalon.
    if (line.kind === "zone" || line.kind === "floor" || line.kind === "group") {
      const from = line.startsWithMilestone ? dayCenter(line.start) : dayStart(line.start);
      const to = line.endsWithMilestone ? dayCenter(line.end) : dayEnd(line.end);
      const x1 = scale.dateToX(from);
      shapes.push({
        type: line.kind === "zone" ? "zoneBar" : "floorBracket",
        row,
        key: line.key,
        y,
        x1,
        x2: Math.max(scale.dateToX(to), x1 + MIN_BAR_WIDTH_PX),
        label: line.name,
      });
      return;
    }
    if (line.isMilestone) {
      shapes.push({
        type: "milestone",
        row,
        key: line.key,
        y,
        x: milestoneX(line, scale),
        label: line.name,
        dateLabel: formatDayMonth(line.start),
      });
      return;
    }
    const x1 = scale.dateToX(dayStart(line.start));
    shapes.push({
      type: "taskBar",
      row,
      key: line.key,
      y,
      x1,
      x2: Math.max(scale.dateToX(dayEnd(line.end)), x1 + MIN_BAR_WIDTH_PX),
      label: line.name,
    });
  });
  return shapes;
}

function isDatedTask(line) {
  return line?.kind === "task" && line.start instanceof Date && line.end instanceof Date;
}

// Étendue horizontale d'une tâche : segment du début de son premier jour à la fin du
// dernier, ou losange ; point d'arrivée d'une flèche (début du segment, sommet du losange).
function taskSpan(line, scale) {
  if (line.isMilestone) {
    const center = milestoneX(line, scale);
    return { x1: center - MILESTONE_HALF_PX, x2: center + MILESTONE_HALF_PX, entryX: center, halfHeight: MILESTONE_HALF_PX };
  }
  const x1 = scale.dateToX(dayStart(line.start));
  return {
    x1,
    x2: Math.max(scale.dateToX(dayEnd(line.end)), x1 + MIN_BAR_WIDTH_PX),
    entryX: x1,
    halfHeight: TASK_BAR_HEIGHT_PX / 2,
  };
}

// Conteneur d'une tâche pour les flèches dessinées : son groupe, son étage ou le niveau zone.
function containerOf(line) {
  return line.groupRowId ? `group:${line.groupRowId}` : `${line.zoneKey}/${line.floorKey || ""}`;
}

/* ---------- Tracé des flèches ----------
   Convention MS Project : une flèche fin → début part du bout du prédécesseur à mi-hauteur,
   va à droite jusqu'au début du successeur et descend dans son coin haut gauche (sommet d'un
   losange) ; les successeurs qui commencent au même endroit partagent la même descente. Pour
   rester lisible : entre des barres jointives, la flèche entre LINK_GAP_PX dans la suivante
   au lieu de longer les bords ; vers un jalon plusieurs lignes plus bas, elle descend dans le
   couloir qui sépare les fins de barres de leurs libellés ; un successeur qui commence avant
   la fin de son prédécesseur est rejoint par un S passant dans l'interligne. */

function rowMiddle(row, rowHeight) {
  return row * rowHeight + rowHeight / 2;
}

function link(fromRow, toRow, points, head) {
  return { fromRow, toRow, points, head };
}

// Géométrie commune d'une flèche entre deux lignes.
function linkFrame(from, fromRow, to, toRow, scale, rowHeight) {
  const b = taskSpan(to, scale);
  const down = toRow > fromRow;
  const sign = down ? 1 : -1;
  const toMiddle = rowMiddle(toRow, rowHeight);
  return {
    a: taskSpan(from, scale),
    b,
    sign,
    vertical: down ? "down" : "up",
    fromY: rowMiddle(fromRow, rowHeight),
    toMiddle,
    // Haut (ou bas) du successeur, où entre une flèche verticale.
    edge: toMiddle - sign * b.halfHeight,
    // Interligne du côté du successeur, et du côté du prédécesseur.
    nearTo: down ? toRow * rowHeight : (toRow + 1) * rowHeight,
    nearFrom: down ? (fromRow + 1) * rowHeight : fromRow * rowHeight,
    adjacent: Math.abs(toRow - fromRow) === 1,
  };
}

// À droite au niveau du prédécesseur (depuis son bout `fromX`), puis droit sur le successeur.
function rightThenDown(frame, fromRow, toRow, fromX, x) {
  const { fromY, edge, vertical } = frame;
  return link(fromRow, toRow, [[fromX, fromY], [x, fromY], [x, edge]], { x, y: edge, direction: vertical });
}

// Aplomb depuis le dessous (ou le dessus) du prédécesseur, droit sur le successeur.
function plumb(frame, fromRow, toRow, x) {
  const { a, sign, fromY, edge, vertical } = frame;
  return link(fromRow, toRow, [[x, fromY + sign * a.halfHeight], [x, edge]], { x, y: edge, direction: vertical });
}

// Fin → début.
function finishToStartLink(from, fromRow, to, toRow, scale, rowHeight) {
  const frame = linkFrame(from, fromRow, to, toRow, scale, rowHeight);
  const { a, b, fromY, toMiddle, edge, vertical, nearTo, nearFrom, adjacent } = frame;
  const lane = a.x2 + LINK_GAP_PX;
  if (to.isMilestone) {
    if (b.entryX >= lane) return rightThenDown(frame, fromRow, toRow, a.x2, b.entryX);
    // Jalon juste sous le prédécesseur (à sa fin) : aplomb droit, comme MS Project.
    if (adjacent && b.entryX >= a.x1 && b.entryX <= a.x2) return plumb(frame, fromRow, toRow, b.entryX);
    // Plus bas : par le couloir, puis l'interligne juste au-dessus du jalon.
    return link(fromRow, toRow,
      [[a.x2, fromY], [lane, fromY], [lane, nearTo], [b.entryX, nearTo], [b.entryX, edge]],
      { x: b.entryX, y: edge, direction: vertical });
  }
  if (b.x1 >= lane) return rightThenDown(frame, fromRow, toRow, a.x2, b.x1);
  // Barres jointives : la flèche entre dans la suivante, sans longer les bords.
  if (b.x1 >= a.x2 - 0.5 && lane <= b.x2 - MIN_BAR_WIDTH_PX) return rightThenDown(frame, fromRow, toRow, a.x2, lane);
  // Le successeur commence avant la fin du prédécesseur : S par l'interligne, entrée par la gauche.
  const leftX = b.x1 - LINK_GAP_PX;
  return link(fromRow, toRow,
    [[a.x2, fromY], [lane, fromY], [lane, nearFrom], [leftX, nearFrom], [leftX, toMiddle], [b.x1, toMiddle]],
    { x: b.x1, y: toMiddle, direction: "right" });
}

// Début → début : par la gauche du début, comme MS Project. Depuis un jalon (dont le nom est
// écrit à gauche) : à droite puis vers le bas quand le successeur commence après lui, aplomb
// depuis sa pointe quand le jalon tombe dans le successeur.
function startToStartLink(from, fromRow, to, toRow, scale, rowHeight) {
  const frame = linkFrame(from, fromRow, to, toRow, scale, rowHeight);
  const { a, b, fromY, toMiddle } = frame;
  if (from.isMilestone) {
    if (b.x1 >= a.x2 + LINK_GAP_PX) return rightThenDown(frame, fromRow, toRow, a.x2, b.x1);
    if (a.entryX >= b.x1 && a.entryX <= b.x2) return plumb(frame, fromRow, toRow, a.entryX);
  }
  const lane = Math.min(a.x1, b.x1) - LINK_GAP_PX;
  return link(fromRow, toRow,
    [[a.x1, fromY], [lane, fromY], [lane, toMiddle], [b.x1, toMiddle]],
    { x: b.x1, y: toMiddle, direction: "right" });
}

// Fin → fin : du bout droit du prédécesseur dans le couloir, retour sur la fin du successeur.
function finishToFinishLink(from, fromRow, to, toRow, scale, rowHeight) {
  const { a, b, fromY, toMiddle } = linkFrame(from, fromRow, to, toRow, scale, rowHeight);
  const lane = Math.max(a.x2, b.x2) + LINK_GAP_PX;
  return link(fromRow, toRow,
    [[a.x2, fromY], [lane, fromY], [lane, toMiddle], [b.x2, toMiddle]],
    { x: b.x2, y: toMiddle, direction: "left" });
}

const LINK_BUILDERS = Object.freeze({ FD: finishToStartLink, DD: startToStartLink, FF: finishToFinishLink });

// Flèches : une par lien (colonne Lien) entre deux tâches visibles et datées, quel que soit
// l'écart entre leurs lignes. Dans un conteneur où aucune tâche n'a de lien, flèches dessinées
// comme avant : une tâche datée vers la tâche datée juste en dessous, du même conteneur.
export function buildGanttLinks(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const list = lines || [];
  const rowByTaskId = new Map();
  const linkedContainers = new Set();
  list.forEach((line, row) => {
    if (line?.kind !== "task") return;
    rowByTaskId.set(line.taskId, row);
    if (line.link) linkedContainers.add(containerOf(line));
  });
  const links = [];
  list.forEach((line, row) => {
    if (!isDatedTask(line)) return;
    if (line.link) {
      const predRow = rowByTaskId.get(line.link.predId);
      const build = LINK_BUILDERS[line.link.type];
      if (predRow == null || !build || !isDatedTask(list[predRow])) return;
      links.push(build(list[predRow], predRow, line, row, scale, rowHeight));
      return;
    }
    const next = list[row + 1];
    if (!isDatedTask(next) || linkedContainers.has(containerOf(line))) return;
    if (containerOf(line) !== containerOf(next)) return;
    links.push(finishToStartLink(line, row, next, row + 1, scale, rowHeight));
  });
  return links;
}

// Week-ends et fériés, seulement quand une journée est assez large pour être lisible.
export function buildNonWorkingBands(scale) {
  if (!(scale.pxPerDay >= MIN_PX_PER_DAY_FOR_OFF_DAYS)) return [];
  const bands = [];
  for (let day = toLocalDay(scale.start); day.getTime() < scale.end; day = nextLocalDay(day)) {
    if (isWorkingDay(day)) continue;
    bands.push({
      x1: scale.dateToX(day),
      x2: scale.dateToX(nextLocalDay(day)),
      holiday: isFrenchHoliday(day),
    });
  }
  return bands;
}

export function todayX(scale, now = new Date()) {
  const ms = toMs(now);
  if (!(ms >= scale.start && ms <= scale.end)) return null;
  return scale.dateToX(ms);
}

// Seuils des boutons Semaine / Mois / Année du bandeau (moyennes géométriques de 7, 30
// et 365 jours), pour que l'échelle change au même moment que le bouton actif.
const WEEK_SCALE_MAX_DAYS = Math.sqrt(7 * 30);
const MONTH_SCALE_MAX_DAYS = Math.sqrt(30 * 365);
const DAY_NUMBER_MIN_PX = 18;
const LABEL_CHAR_PX = 6.5;
const LABEL_PADDING_PX = 6;
export const MIN_SPAN_MS = 2 * DAY_MS;
export const MAX_SPAN_MS = 3650 * DAY_MS;
export const ZOOM_FACTOR = 1.25;

const WEEKDAYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function isoWeekNumber(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekDay = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekDay);
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  return Math.ceil(((utc.getTime() - yearStart) / DAY_MS + 1) / 7);
}

function startOfWeek(date) {
  const localDay = toLocalDay(date);
  return new Date(localDay.getFullYear(), localDay.getMonth(), localDay.getDate() - ((localDay.getDay() + 6) % 7));
}

function nextWeek(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function nextMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function nextYear(date) {
  return new Date(date.getFullYear() + 1, 0, 1);
}

function fitLabel(label, width) {
  return width >= label.length * LABEL_CHAR_PX + LABEL_PADDING_PX ? label : "";
}

// Cases consécutives (jours, semaines, mois ou années) couvrant la période, coupées à
// ses bords.
function buildTicks(scale, firstBoundary, nextBoundary, labelOf) {
  const ticks = [];
  for (
    let cursor = firstBoundary(new Date(scale.start));
    cursor.getTime() < scale.end;
    cursor = nextBoundary(cursor)
  ) {
    const x1 = Math.max(0, scale.dateToX(cursor));
    const x2 = Math.min(scale.width, scale.dateToX(nextBoundary(cursor)));
    if (x2 > x1) ticks.push({ x1, x2, label: fitLabel(labelOf(cursor), x2 - x1) });
  }
  return ticks;
}

export function buildScaleTiers(scale) {
  const spanDays = (scale.end - scale.start) / DAY_MS;
  if (spanDays < WEEK_SCALE_MAX_DAYS) {
    return {
      mode: "week",
      top: buildTicks(scale, startOfWeek, nextWeek, (date) => (
        `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()} · S${isoWeekNumber(date)}`
      )),
      bottom: buildTicks(scale, toLocalDay, nextLocalDay, (date) => `${WEEKDAYS[date.getDay()]} ${date.getDate()}`),
    };
  }
  if (spanDays < MONTH_SCALE_MAX_DAYS) {
    return {
      mode: "month",
      top: buildTicks(scale, startOfMonth, nextMonth, (date) => `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`),
      bottom: scale.pxPerDay >= DAY_NUMBER_MIN_PX
        ? buildTicks(scale, toLocalDay, nextLocalDay, (date) => String(date.getDate()))
        : buildTicks(scale, startOfWeek, nextWeek, (date) => `S${isoWeekNumber(date)}`),
    };
  }
  return {
    mode: "year",
    top: buildTicks(scale, startOfYear, nextYear, (date) => String(date.getFullYear())),
    bottom: buildTicks(scale, startOfMonth, nextMonth, (date) => MONTHS_SHORT[date.getMonth()]),
  };
}

// Glisser de `deltaPx` pixels sur un panneau de `widthPx` : la date saisie reste sous le
// curseur (la période se déplace en sens inverse).
export function panWindow({ start, end }, deltaPx, widthPx) {
  const startMs = toMs(start);
  const endMs = toMs(end);
  if (!(widthPx > 0)) return { start: new Date(startMs), end: new Date(endMs) };
  const shift = -((Number(deltaPx) || 0) * (endMs - startMs)) / widthPx;
  return { start: new Date(startMs + shift), end: new Date(endMs + shift) };
}

// Zoom centré sur la date sous le curseur (`ratio` = position relative de 0 à 1).
export function zoomWindow({ start, end }, ratio, zoomIn) {
  const startMs = toMs(start);
  const span = toMs(end) - startMs;
  const position = Math.min(1, Math.max(0, Number(ratio) || 0));
  const pointer = startMs + position * span;
  const wanted = zoomIn ? span / ZOOM_FACTOR : span * ZOOM_FACTOR;
  const nextSpan = Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, wanted));
  const nextStart = pointer - position * nextSpan;
  return { start: new Date(nextStart), end: new Date(nextStart + nextSpan) };
}

// Molette : un cran de souris (100 unités en pixels, 3 en lignes) = un pas de zoom. Les
// petits deltas du pavé tactile ou du pincement s'additionnent jusqu'à un cran ; changer de
// sens repart de zéro. Renvoie le nombre de pas (négatif : molette vers le haut, zoom avant)
// et le reste à reporter sur l'évènement suivant.
export const WHEEL_STEP_DELTA = 100;

export function wheelZoomSteps(pending, deltaY, deltaMode = 0) {
  const unit = deltaMode === 1 ? WHEEL_STEP_DELTA / 3 : deltaMode === 2 ? WHEEL_STEP_DELTA : 1;
  const delta = (Number(deltaY) || 0) * unit;
  const previous = Number(pending) || 0;
  const base = previous && delta && Math.sign(previous) !== Math.sign(delta) ? 0 : previous;
  const total = base + delta;
  const steps = Math.trunc(total / WHEEL_STEP_DELTA) || 0;
  return { steps, pending: total - steps * WHEEL_STEP_DELTA };
}

export function currentWeekWindow(now = new Date()) {
  const monday = startOfWeek(now);
  return { start: monday, end: new Date(nextWeek(monday).getTime() - 1) };
}
