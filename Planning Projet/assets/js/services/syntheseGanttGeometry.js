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
export const LINK_GAP_PX = 6;

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

// Une forme par ligne datée du modèle de lignes, à la hauteur de sa ligne. Les lignes
// sans dates ne dessinent rien mais gardent leur rang.
export function buildGanttShapes(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const shapes = [];
  (lines || []).forEach((line, row) => {
    if (!(line?.start instanceof Date) || !(line?.end instanceof Date)) return;
    const y = row * rowHeight;
    // Zone (barre noire) et étage (crochet) : du Début à la Fin du récapitulatif, au centre
    // du jour quand il commence ou finit par un jalon.
    if (line.kind === "zone" || line.kind === "floor") {
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
        x: scale.dateToX(dayCenter(line.start)),
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
    const center = scale.dateToX(dayCenter(line.start));
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

// Flèches (dessin seul) : une tâche datée vers la tâche datée juste en dessous, si les deux
// sont du même groupe (même zone et même étage, ou toutes deux au niveau zone). Tracé MS
// Project : du bout de la tâche jusqu'au début de la suivante, pointe vers le bas quand
// elle commence au même x ou après ; sinon détour en S et pointe vers la droite.
export function buildGanttLinks(lines, scale, { rowHeight = ROW_HEIGHT_PX } = {}) {
  const links = [];
  (lines || []).forEach((line, row) => {
    const next = lines[row + 1];
    if (!isDatedTask(line) || !isDatedTask(next)) return;
    if (line.zoneKey !== next.zoneKey || (line.floorKey || "") !== (next.floorKey || "")) return;
    const from = taskSpan(line, scale);
    const to = taskSpan(next, scale);
    const fromY = row * rowHeight + rowHeight / 2;
    const toMiddle = (row + 1) * rowHeight + rowHeight / 2;
    if (to.entryX >= from.x2) {
      const toTop = toMiddle - to.halfHeight;
      links.push({
        fromRow: row,
        toRow: row + 1,
        points: [[from.x2, fromY], [to.entryX, fromY], [to.entryX, toTop]],
        head: { x: to.entryX, y: toTop, direction: "down" },
      });
      return;
    }
    const between = (row + 1) * rowHeight;
    links.push({
      fromRow: row,
      toRow: row + 1,
      points: [
        [from.x2, fromY],
        [from.x2 + LINK_GAP_PX, fromY],
        [from.x2 + LINK_GAP_PX, between],
        [to.x1 - LINK_GAP_PX, between],
        [to.x1 - LINK_GAP_PX, toMiddle],
        [to.x1, toMiddle],
      ],
      head: { x: to.x1, y: toMiddle, direction: "right" },
    });
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
