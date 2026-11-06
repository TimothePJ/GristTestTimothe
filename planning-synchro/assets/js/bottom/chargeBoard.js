// Charge-plan grid render — editable bottom pane for planning-synchro.
// Ported/adapted from `gestion-depenses2/assets/js/ui/chargeTimeline.js`
// (buildVisibleSlots, getMonthWidth, getTimelineViewportWidth, renderTrackGrid,
// buildVisibleSegmentBars, assignSegmentLanes, renderSegmentBars, renderRoleRow,
// renderWorkerRow, renderTimelineEditToolbar, and the context-menu/selection-preview
// DOM) and `gestion-depenses2/assets/js/services/projectService.js`
// (groupWorkersByRole role-bucket logic, ~lines 287-323, 822-847).
//
// KEY ADAPTATIONS vs the source (see task-11 brief):
// 1. Arithmetic day width only: dayWidth = timelineViewportWidth / visibleDays,
//    where timelineViewportWidth is the timeline column's measured content
//    width and visibleDays comes from the shared canonical viewport
//    ({ mode, firstVisibleDate, rangeStartDate, rangeEndDate, anchorDate,
//    visibleDays }). The source's "embedded planning-sync" CSS-var branch
//    (--sync-planning-reference-day-width / getEmbeddedPlanningReference*) is
//    dropped entirely: this widget has no iframe host to read those vars from,
//    and Task 13's controller drives both panes off the same arithmetic
//    width/day math (sync/viewportMath.js's getDayBoundaryLeftPx), so only the
//    non-embedded path is kept.
// 2. Roles-only header: no renderTimelineControls (date-picker/zoom buttons),
//    no "Vue/Aujourd'hui" controls, no renderTotalRow / "Total jours" column,
//    no header month band. Only role section rows (renderRoleRow) + worker
//    rows + a left "name" column remain; the shared toolbar (Task 13/14)
//    drives the window.
// 3. Exact-window rendering: the source lays out whole calendar months (sized
//    so their total day count approximates visibleDays) via getMonthWidth,
//    then derives a per-day width back out of each month's pixel width - which
//    is mathematically just `timelineViewportWidth / visibleDays` again, since
//    every month is sized as `dayWidth * month.calendarDayCount` up front. This
//    port skips that redundant month round-trip: buildWindowDays() calls
//    buildDisplayedMonths() for the month span touching the window (as
//    instructed) and then filters its calendarDayDates down to exactly
//    [viewport.firstVisibleDate .. viewport.rangeEndDate] (visibleDays
//    consecutive calendar days), so day index N's left edge is always
//    N * (contentWidth / visibleDays) - matching sync/viewportMath.js's
//    getDayBoundaryLeftPx exactly. A literal getMonthWidth/month-grouped
//    render would either spill days outside the window (if unfiltered) or
//    require the same filtering anyway, so no separate getMonthWidth is kept.
//    Fluidite (2026-10-27) : le board peut dessiner un peu PLUS que la fenetre
//    — un jour de plus quand elle s'arrete sur une fraction de jour, une marge
//    pendant un glisser — et decale alors ses pistes (transform) pour montrer
//    la fenetre ; le jour N de la fenetre reste a N * dayWidth de son bord
//    (voir « plage dessinee » plus bas).
// 4. No worker.id: workers are grouped-by-name TimeSegment rows (no stable
//    numeric id on the worker itself), so segment-bar/track DOM carries
//    data-worker-name instead of the source's data-worker-id; Task 12 keys
//    edits off Name + segment id.
// 5. groupWorkersByRole here buckets into exactly 3 canonical labels
//    (Projeteurs/Ingenieurs/Autres) via a normalized-role substring match
//    (adapted from the source's getRoleDisplayOrder sort helper), instead of
//    the source's literal per-role-string grouping (worker.role as-is, "Sans
//    role" fallback) - the task brief calls for a fixed roles-only header.
// 6. planningTaskCount / cross-referencing segment bars against Planning
//    Projet tasks (source's countPlanningTasksOverlappingRange + tooltip) is
//    dropped: render() has no planningTasks input in this widget's contract.
//
// DOM module: document/window are only touched inside function bodies (no
// top-level access), so buildWorkersFromSegments/groupWorkersByRole import and
// run cleanly under Node (see tests/chargeWorkers.test.mjs); createChargeBoard()
// itself is browser-only and is verified by structural read-through + node
// --check here, browser-verified once Task 14 wires main.js (see task-11-report.md).

import { toFiniteNumber, formatNumber, buildDisplayedMonths } from "../utils/format.js";
import { normalizeDecimal, toText, formatIsoDate, parseCalendarDate } from "../utils/dates.js";
import {
  HALF_DAY_PARTS,
  isBusinessDay,
  getHalfDaySlotRange,
  createHalfDaySlotKey,
  getSegmentEffectiveDays as computeSegmentEffectiveDays,
} from "../utils/timeSegments.js";
import { resolveSegmentMonthKey, getMonthBounds, getMonthAvailableDays } from "../utils/monthSegments.js";
import { countPlanningTasksOverlappingRange } from "../top/phases.js";
import { isAbsenceSlot, normalizeName } from "../utils/leaveAbsences.js";
import { computeProjectCharge } from "./documentCharge.js";
import { buildMonthOverloadIndex } from "../utils/monthLoad.js";
import { APP_CONFIG } from "../config.js";

const MIN_CONTENT_WIDTH_PX = 280;
const DEFAULT_NAME_COL_WIDTH_PX = 220;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDayValue(value) {
  const formatted = formatNumber(value);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

// Jours effectifs d'un segment, memorises par segment. Le calcul (timeSegments.js)
// recompte les jours ouvres du mois, demi-journee par demi-journee, a chaque
// appel ; un rendu le demande ~6 fois par segment (barre, totaux de role, Total,
// Charge) et c'etait le premier poste d'un zoom ou d'un pan. Un segment ne change
// jamais apres buildWorkersFromSegments (les donnees neuves recreent les objets),
// le resultat memorise reste donc exact.
const segmentEffectiveDaysMemo = new WeakMap();
function getSegmentEffectiveDays(segment) {
  if (!segment || typeof segment !== "object") return computeSegmentEffectiveDays(segment);
  let days = segmentEffectiveDaysMemo.get(segment);
  if (days === undefined) {
    days = computeSegmentEffectiveDays(segment);
    segmentEffectiveDaysMemo.set(segment, days);
  }
  return days;
}

// --- worker building (pure) --------------------------------------------------

function normalizeNameKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Groups TimeSegment rows by Name into one worker per person, with role looked
// up from ProjectTeam by normalized-name match. `columns` mirrors
// APP_CONFIG.grist.columns' shape: { timeSegment: {...}, projectTeam: {...} }.
export function buildWorkersFromSegments(timeSegmentRows, projectTeamRows, columns) {
  const tsCols = columns?.timeSegment || {};
  const ptCols = columns?.projectTeam || {};

  const workersByNameKey = new Map();
  let segmentSeq = 0;

  // Seed EVERY connected team member first (even those with no TimeSegment), the
  // way gestion-depenses2 does (projectService.buildExpenseData): all people
  // linked to the project appear in the bottom pane; segments are attached below.
  (projectTeamRows || []).forEach((row) => {
    const name = toText(row?.[ptCols.name]);
    const nameKey = normalizeNameKey(name);
    if (!nameKey || workersByNameKey.has(nameKey)) return;
    workersByNameKey.set(nameKey, { name, role: toText(row?.[ptCols.role]) || "", segments: [] });
  });

  (timeSegmentRows || []).forEach((row) => {
    const name = toText(row?.[tsCols.name]);
    if (!name) return;

    // Un segment = un mois : Mois d'abord, repli legacy sur Start_At (voir
    // monthSegments.js). Un mois non resoluble (colonnes disparues) ecarte
    // silencieusement la ligne, sans erreur.
    const monthKey = resolveSegmentMonthKey(row, tsCols);
    const bounds = getMonthBounds(monthKey);
    if (!bounds) return;

    const nameKey = normalizeNameKey(name);
    let worker = workersByNameKey.get(nameKey);
    if (!worker) {
      // A TimeSegment name absent from ProjectTeam still gets a row. Unknown role
      // ("") is bucketed into "Autres" by groupWorkersByRole.
      worker = { name, role: "", segments: [] };
      workersByNameKey.set(nameKey, worker);
    }

    worker.segments.push({
      id: row?.[tsCols.id] ?? `s-${segmentSeq++}`,
      monthKey,
      startAt: bounds.startAt,
      endAt: bounds.endAt,
      effectif: normalizeDecimal(row?.[tsCols.effectif]),
      label: toText(row?.[tsCols.label]),
    });
  });

  return [...workersByNameKey.values()];
}

// --- role grouping (pure, port of groupWorkersByRole) ------------------------

function normalizeRoleForGrouping(role) {
  return toText(role)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const OTHER_ROLE_GROUP_LABEL = "Autres";
const ROLE_GROUP_RULES = [
  { label: "Projeteurs", test: (normalized) => normalized.includes("projet") },
  { label: "Ingenieurs", test: (normalized) => normalized.includes("ingen") },
];
const ROLE_GROUP_ORDER = ["Projeteurs", "Ingenieurs", OTHER_ROLE_GROUP_LABEL];

function getRoleGroupLabel(role) {
  const normalized = normalizeRoleForGrouping(role);
  if (!normalized) return OTHER_ROLE_GROUP_LABEL;
  const rule = ROLE_GROUP_RULES.find((entry) => entry.test(normalized));
  return rule ? rule.label : OTHER_ROLE_GROUP_LABEL;
}

function compareWorkersByName(left, right) {
  return toText(left?.name).localeCompare(toText(right?.name), "fr", {
    sensitivity: "base",
    numeric: true,
  });
}

// Buckets workers into fixed role-group labels (Projeteurs/Ingenieurs/Autres),
// only including groups that actually have members, in that display order.
export function groupWorkersByRole(workers) {
  const buckets = {};
  (workers || []).forEach((worker) => {
    const label = getRoleGroupLabel(worker?.role);
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(worker);
  });

  const grouped = {};
  ROLE_GROUP_ORDER.forEach((label) => {
    if (buckets[label]) {
      grouped[label] = [...buckets[label]].sort(compareWorkersByName);
    }
  });
  return grouped;
}

// --- exact-window day enumeration ---------------------------------------------

// Returns Date[] for every calendar day in [viewport.firstVisibleDate ..
// viewport.rangeEndDate] inclusive, built via buildDisplayedMonths() over the
// month span touching the window then filtered down to the exact range.
function buildWindowDays(viewport) {
  const firstVisibleDate = parseCalendarDate(viewport?.firstVisibleDate);
  const rangeEndDate = parseCalendarDate(viewport?.rangeEndDate);
  if (!firstVisibleDate || !rangeEndDate || rangeEndDate < firstVisibleDate) {
    return [];
  }

  const monthSpan =
    rangeEndDate.getFullYear() * 12 +
    rangeEndDate.getMonth() -
    (firstVisibleDate.getFullYear() * 12 + firstVisibleDate.getMonth()) +
    1;
  const months = buildDisplayedMonths(
    firstVisibleDate.getFullYear(),
    firstVisibleDate.getMonth(),
    monthSpan,
    APP_CONFIG.months
  );

  const firstVisibleIso = formatIsoDate(firstVisibleDate);
  const rangeEndIso = formatIsoDate(rangeEndDate);
  const windowDays = [];
  months.forEach((month) => {
    (month.calendarDayDates || []).forEach((date) => {
      const iso = formatIsoDate(date);
      if (iso >= firstVisibleIso && iso <= rangeEndIso) {
        windowDays.push(date);
      }
    });
  });
  return windowDays;
}

// --- plage dessinee : fenetre visible, marge de glisser ------------------------
//
// Le board ne dessine plus exactement [firstVisibleDate .. rangeEndDate] :
//   - avec une fraction de jour (offsetDays, glisser au pixel pres), il dessine
//     un jour de plus a droite et decale ses pistes de -offsetDays x dayWidth ;
//   - pendant un glisser, il dessine en plus une MARGE de chaque cote (jusqu'a
//     une fenetre, bornee aux limites de la frise) puis se contente de DECALER
//     ses pistes (transform, rendu par le compositeur) tant que la fenetre
//     visible tient dans ce qui est dessine. Reconstruire tout le HTML a chaque
//     pixel de glisser etait le premier poste du a-coup.
// Les colonnes de la grille gardent la largeur VISIBLE (--timeline-width) et
// coupent ce qui depasse (overflow: hidden) ; seules les pistes sont plus
// larges (--charge-plan-track-width) et decalees (--charge-plan-transform).

const DAY_MS = 24 * 3600 * 1000;
// Marge maximale d'un cote : au-dela, le premier rendu du glisser coute plus
// qu'il ne fait gagner (un dezoom de 5 ans dessinerait 15 ans).
const MAX_PAN_BUFFER_DAYS = 400;

function shiftIsoDays(iso, days) {
  const date = parseCalendarDate(iso);
  if (!date) return "";
  return formatIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function daysBetweenIso(fromIso, toIso) {
  const from = parseCalendarDate(fromIso);
  const to = parseCalendarDate(toIso);
  if (!from || !to) return Number.NaN;
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      DAY_MS
  );
}

function normalizeOffsetDays(value) {
  const offset = Number(value);
  return offset > 0 && offset < 1 ? offset : 0;
}

// { startIso, endIso, leadDays, offsetDays } : jours dessines, et position de la
// fenetre visible dans ces jours (leadDays + offsetDays depuis startIso).
function resolveRenderRange(viewport, visibleDays, { panning = false, bounds = null } = {}) {
  const offsetDays = normalizeOffsetDays(viewport?.offsetDays);
  const firstIso = viewport.firstVisibleDate;
  const lastIso = offsetDays > 0 ? shiftIsoDays(viewport.rangeEndDate, 1) : viewport.rangeEndDate;
  let startIso = firstIso;
  let endIso = lastIso;
  if (panning) {
    const bufferDays = Math.min(Math.max(1, Math.round(visibleDays)), MAX_PAN_BUFFER_DAYS);
    startIso = shiftIsoDays(firstIso, -bufferDays);
    endIso = shiftIsoDays(lastIso, bufferDays);
    const boundsStart = bounds?.startDate || "";
    const boundsEnd = bounds?.endDate || "";
    if (boundsStart && startIso < boundsStart) startIso = boundsStart < firstIso ? boundsStart : firstIso;
    if (boundsEnd && endIso > boundsEnd) endIso = boundsEnd > lastIso ? boundsEnd : lastIso;
  }
  return { startIso, endIso, leadDays: daysBetweenIso(startIso, firstIso), offsetDays };
}

// --- half-day slot math (port of buildVisibleSlots, arithmetic path only) ----

function buildVisibleSlots(windowDays, dayWidth) {
  const halfDayWidth = dayWidth / 2;
  const slots = [];

  windowDays.forEach((date, dayIndex) => {
    const isWorkingDay = isBusinessDay(date);
    HALF_DAY_PARTS.forEach((part, partIndex) => {
      const slotRange = getHalfDaySlotRange(date, part);
      if (!slotRange) return;

      slots.push({
        key: createHalfDaySlotKey(date, part),
        slotIndex: slots.length,
        dateKey: formatIsoDate(date),
        part,
        isWorkingDay,
        leftPx: dayIndex * dayWidth + partIndex * halfDayWidth,
        widthPx: halfDayWidth,
        startAt: slotRange.startAt,
        endAt: slotRange.endAt,
      });
    });
  });

  return slots;
}

// --- track grid (weekend shading), port of renderTrackGrid -------------------

// Week-ends : un seul degrade CSS repete (periode 7 jours), pose en fond de la
// grille de CHAQUE piste par une variable du board (--charge-plan-weekends), au
// lieu de deux cases par week-end et par piste — ~260 noeuds par personne au
// dezoom de 5 ans, a reconstruire a chaque cran de molette. Meme teinte que
// .charge-plan-grid-day.is-weekend. Les feries tombant en semaine restent des
// cases (renderTrackGrid).
const WEEKEND_SHADE = "rgba(8, 21, 38, 0.08)";

function buildWeekendGradient(firstDate, dayWidth) {
  if (!(firstDate instanceof Date) || !(dayWidth > 0)) return "none";
  const period = 7 * dayWidth;
  // Jours entre le premier jour dessine et le samedi qui suit (ou lui-meme).
  const toSaturday = (6 - firstDate.getDay() + 7) % 7;
  const stops =
    toSaturday === 6
      ? // Premier jour = dimanche : le week-end chevauche le debut de la periode.
        [
          `${WEEKEND_SHADE} 0px`,
          `${WEEKEND_SHADE} ${dayWidth}px`,
          `transparent ${dayWidth}px`,
          `transparent ${6 * dayWidth}px`,
          `${WEEKEND_SHADE} ${6 * dayWidth}px`,
          `${WEEKEND_SHADE} ${period}px`,
        ]
      : [
          "transparent 0px",
          `transparent ${toSaturday * dayWidth}px`,
          `${WEEKEND_SHADE} ${toSaturday * dayWidth}px`,
          `${WEEKEND_SHADE} ${(toSaturday + 2) * dayWidth}px`,
          `transparent ${(toSaturday + 2) * dayWidth}px`,
          `transparent ${period}px`,
        ];
  return `repeating-linear-gradient(90deg, ${stops.join(", ")})`;
}

function isWeekendDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// Une case par SUITE de feries en semaine (les week-ends sont le degrade
// ci-dessus) et une par suite de demi-journees d'absence, plutot qu'une case par
// jour. Une absence ne tombe jamais un jour chome (leaveAbsences.js ne garde que
// les demi-journees ouvrees), les suites ne se recouvrent pas.
function renderTrackGrid(windowDays, dayWidth, absenceSet = new Set()) {
  const halfDayWidth = dayWidth / 2;
  const spans = [];
  let offRun = null;
  let absenceRun = null;
  const closeOffRun = () => {
    if (!offRun) return;
    spans.push(
      `<span class="charge-plan-grid-day is-weekend" style="left:${offRun.left}px; width:${offRun.width}px" data-date-key="${offRun.dateKey}"></span>`
    );
    offRun = null;
  };
  const closeAbsenceRun = () => {
    if (!absenceRun) return;
    spans.push(
      `<span class="charge-plan-grid-day is-absence" style="left:${absenceRun.left}px; width:${absenceRun.width}px" data-date-key="${absenceRun.dateKey}" data-part="${absenceRun.part}"></span>`
    );
    absenceRun = null;
  };

  windowDays.forEach((date, dayIndex) => {
    const dateKey = formatIsoDate(date);
    if (isWeekendDay(date)) {
      closeAbsenceRun();
      closeOffRun();
      return;
    }
    if (!isBusinessDay(date)) {
      closeAbsenceRun();
      if (offRun) offRun.width += dayWidth;
      else offRun = { left: dayIndex * dayWidth, width: dayWidth, dateKey };
      return;
    }
    closeOffRun();
    ["am", "pm"].forEach((part, partIndex) => {
      if (!isAbsenceSlot(absenceSet, dateKey, part)) {
        closeAbsenceRun();
        return;
      }
      if (absenceRun) absenceRun.width += halfDayWidth;
      else absenceRun = { left: dayIndex * dayWidth + partIndex * halfDayWidth, width: halfDayWidth, dateKey, part };
    });
  });
  closeOffRun();
  closeAbsenceRun();

  return `<div class="charge-plan-track-grid">${spans.join("")}</div>`;
}

// --- segment bars (port of buildVisibleSegmentBars / assignSegmentLanes / renderSegmentBars) ---

// Les creneaux sont chronologiques et disjoints (buildVisibleSlots) : deux
// recherches dichotomiques trouvent le premier et le dernier creneau touches.
// Le balayage lineaire d'avant coutait creneaux x barres a CHAQUE rendu (3 652
// creneaux au dezoom maximal) et dominait le cout d'un pan.
function getVisibleSlotRange(startAt, endAt, visibleSlots) {
  const slots = visibleSlots || [];
  let low = 0;
  let high = slots.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (slots[middle].endAt > startAt) high = middle;
    else low = middle + 1;
  }
  const firstIndex = low;
  if (firstIndex >= slots.length || !(slots[firstIndex].startAt < endAt)) return null;

  low = firstIndex;
  high = slots.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (slots[middle].startAt < endAt) low = middle + 1;
    else high = middle;
  }
  return { firstSlot: slots[firstIndex], lastSlot: slots[low - 1] };
}

// Ce qu'une barre doit aux DONNEES seules (taches du planning, absences,
// surcharge), jamais a la fenetre visible : `metaCache` (Map segment -> meta,
// videe par le board quand les donnees changent) le garde d'un rendu a l'autre.
// Sans lui, chaque cran de zoom et chaque pixel de pan recalculaient ces chiffres
// pour toutes les barres — l'essentiel du temps d'un rendu.
function buildVisibleSegmentBars(
  worker,
  visibleSlots,
  planningTasks = [],
  absenceSet = new Set(),
  overloadIndex = null,
  metaCache = null
) {
  return (worker?.segments || [])
    .map((segment) => {
      const startAt = segment?.startAt instanceof Date ? segment.startAt : null;
      const endAt = segment?.endAt instanceof Date ? segment.endAt : null;
      if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return null;
      }

      const slotRange = getVisibleSlotRange(startAt, endAt, visibleSlots);
      if (!slotRange) return null;

      const effectiveDays = getSegmentEffectiveDays(segment);
      const label = segment?.label || `${formatDayValue(effectiveDays)} j`;
      const leftPx = slotRange.firstSlot.leftPx;
      const widthPx =
        slotRange.lastSlot.leftPx + slotRange.lastSlot.widthPx - slotRange.firstSlot.leftPx;
      let meta = metaCache ? metaCache.get(segment) : null;
      if (!meta) {
        // Like gestion-depenses2: how many planning tasks fall within this segment's
        // period — surfaced as the bar's hover title (see renderSegmentBars).
        const planningTaskCount = countPlanningTasksOverlappingRange(planningTasks, startAt, endAt);
        // Leave-aware coherence check: the RAW stored effectif vs the days actually
        // available in the segment's MONTH after removing absence half-days (un
        // segment = un mois, donc plus de geometrie startAt/endAt arbitraire ici).
        const rawEffectif = segment?.effectif ?? segment?.effectifDays ?? null;
        const available = getMonthAvailableDays(segment.monthKey, absenceSet);
        const incoherent = rawEffectif != null && Number(rawEffectif) > available;
        // Surcharge de la PERSONNE sur ce mois, tous projets confondus : la barre
        // peut virer sans que rien ne cloche sur le projet affiche, parce que la
        // charge est ailleurs. D'ou l'infobulle, qui donne les chiffres.
        const overloadLoad = overloadIndex?.isOverloaded(worker?.name, segment.monthKey)
          ? overloadIndex.getLoad(worker?.name, segment.monthKey)
          : null;
        meta = { planningTaskCount, available, incoherent, overloadLoad };
        if (metaCache) metaCache.set(segment, meta);
      }
      const { planningTaskCount, available, incoherent, overloadLoad } = meta;

      return {
        segmentId: segment.id,
        monthKey: segment.monthKey,
        workerName: worker?.name,
        startSlotIndex: slotRange.firstSlot.slotIndex,
        endSlotIndex: slotRange.lastSlot.slotIndex,
        startAtMs: startAt.getTime(),
        endAtMs: endAt.getTime(),
        planningTaskCount,
        // Raw stored effectif (may be null) so the edit-segment modal can
        // pre-fill "jours effectifs travailles" exactly as stored, blank when
        // unset — this module is DOM-driven, so the value rides on the bar.
        effectif: segment?.effectif == null ? "" : segment.effectif,
        incoherent,
        overloadLoad,
        available,
        leftPx,
        widthPx,
        label,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.leftPx !== right.leftPx) return left.leftPx - right.leftPx;
      return left.widthPx - right.widthPx;
    });
}

function placeInLanes(entries) {
  const lanes = [];

  return entries.map((entry) => {
    let laneIndex = lanes.findIndex((laneRightEdge) => entry.leftPx >= laneRightEdge + 8);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(0);
    }

    lanes[laneIndex] = entry.leftPx + entry.widthPx;
    return { ...entry, laneIndex };
  });
}

function calendarDayNumber(date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

// Couloirs d'une personne, calcules sur TOUS ses segments et non sur les seules
// barres dessinees : ni le couloir d'une barre ni le nombre de couloirs (donc la
// hauteur de la ligne) ne dependent plus de la fenetre. Calcules sur les barres
// visibles, ils changeaient des que la premiere barre a gauche changeait (un
// mois de glisser suffisait) : toutes les barres sautaient d'un couloir a
// l'autre et la ligne grandissait ou retrecissait de 12 px ; avec le glisser par
// decalage, tout cela arrivait au relacher. Meme regle qu'avant (8 px d'ecart
// minimum), sur les memes positions a une translation pres : quand tous les
// segments sont visibles, le resultat est identique.
function computeWorkerLanes(worker, dayWidth) {
  const laneBySegmentId = new Map();
  let laneCount = 0;
  placeInLanes(
    (worker?.segments || [])
      .filter((segment) => segment?.startAt instanceof Date && segment?.endAt instanceof Date)
      .map((segment) => {
        const startDay = calendarDayNumber(segment.startAt);
        return {
          segmentId: segment.id,
          leftPx: startDay * dayWidth,
          widthPx: (calendarDayNumber(segment.endAt) + 1 - startDay) * dayWidth,
        };
      })
      .sort((left, right) => left.leftPx - right.leftPx || left.widthPx - right.widthPx)
  ).forEach((entry) => {
    laneBySegmentId.set(String(entry.segmentId), entry.laneIndex);
    laneCount = Math.max(laneCount, entry.laneIndex + 1);
  });
  return { laneBySegmentId, laneCount };
}

// `workerLanes` (computeWorkerLanes) absent : la regle d'origine sur les seules
// barres recues.
function assignSegmentLanes(bars, workerLanes = null) {
  if (!workerLanes) return placeInLanes(bars);
  return bars.map((bar) => ({
    ...bar,
    laneIndex: workerLanes.laneBySegmentId.get(String(bar.segmentId)) ?? 0,
  }));
}

function renderSegmentBars(assignedBars) {
  return assignedBars
    .map((bar) => {
      const compact = bar.widthPx < 64;
      // Hover title (like gestion-depenses2): number of planning tasks to do
      // during this segment's period.
      const taskCount = Number(bar.planningTaskCount) || 0;
      const planningTooltip = `${taskCount} tâche(s) Planning Projet sur cette période`;
      // When the stored effectif exceeds the leave-adjusted availability, the bar
      // turns red and its tooltip explains the mismatch (see is-incoherent CSS).
      // Priorite au rouge : `is-incoherent` denonce une saisie fausse, l'ambre
      // une charge trop lourde. La saisie fausse doit rester la plus visible.
      const overloadTooltip = bar.overloadLoad
        ? `Surcharge : ${formatDayValue(bar.overloadLoad.totalDays)} j sur ${formatDayValue(
            bar.overloadLoad.availableDays
          )} j disponibles ce mois, tous projets confondus`
        : "";
      const title = bar.incoherent
        ? `Effectif ${bar.effectif} j > disponible après absences ${bar.available} j`
        : overloadTooltip || planningTooltip;
      // Barre qui part du premier jour dessine : son debut peut etre hors champ
      // (fenetre arretee sur une fraction de jour), son libelle s'en ecarte
      // d'autant (styles.css, --charge-plan-lead).
      return `
        <div
          class="charge-plan-segment-bar ${compact ? "is-compact" : ""} ${bar.incoherent ? "is-incoherent" : ""} ${
            !bar.incoherent && bar.overloadLoad ? "is-overloaded" : ""
          } ${bar.startSlotIndex === 0 ? "is-window-start" : ""}"
          style="left:${bar.leftPx}px; top:${10 + bar.laneIndex * 32}px; width:${Math.max(12, bar.widthPx)}px"
          data-segment-id="${escapeHtml(String(bar.segmentId))}"
          data-month-key="${escapeHtml(String(bar.monthKey))}"
          data-worker-name="${escapeHtml(bar.workerName)}"
          data-start-slot-index="${bar.startSlotIndex}"
          data-end-slot-index="${bar.endSlotIndex}"
          data-start-at-ms="${bar.startAtMs}"
          data-end-at-ms="${bar.endAtMs}"
          data-effectif="${escapeHtml(String(bar.effectif))}"
          data-planning-tooltip="${escapeHtml(planningTooltip)}"
          title="${escapeHtml(title)}"
        >
          <span class="charge-plan-segment-label">${escapeHtml(bar.label)}</span>
        </div>
      `;
    })
    .join("");
}

// --- rows (port of renderRoleRow / renderWorkerRow) ---------------------------

// Ligne d'un role (Projeteurs / Ingenieurs / Autres) : son nom et le TOTAL des
// jours planifies de ses personnes (tous leurs segments, comme la ligne Total),
// puis, mois par mois, une pastille des jours planifies du role (meme calcul
// et meme pastille que la ligne Total, restreints aux personnes du role).
function renderRoleRow(roleLabel, roleWorkers, months, timelineWidth) {
  const roleTotal = (roleWorkers || []).reduce(
    (sum, worker) =>
      sum + (worker?.segments || []).reduce((segSum, segment) => segSum + getSegmentEffectiveDays(segment), 0),
    0
  );
  return `
    <div class="charge-plan-role-row" style="--timeline-width:${timelineWidth}px; --row-height:36px">
      <div class="charge-plan-role-cell charge-plan-role-cell--label">
        <span>${escapeHtml(roleLabel)}</span>
        <span class="charge-plan-role-total">${formatDayValue(Math.round(roleTotal * 100) / 100)} j</span>
      </div>
      <div class="charge-plan-role-cell charge-plan-role-cell--track">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderReadonlyMonthTrack(roleWorkers, months)}
        </div>
      </div>
    </div>
  `;
}

function renderWorkerRow(
  worker,
  visibleSlots,
  timelineWidth,
  windowDays,
  dayWidth,
  planningTasks = [],
  absenceSet = new Set(),
  overloadIndex = null,
  metaCache = null
) {
  const visibleSegmentBars = buildVisibleSegmentBars(
    worker,
    visibleSlots,
    planningTasks,
    absenceSet,
    overloadIndex,
    metaCache
  );
  const workerLanes = dayWidth > 0 ? computeWorkerLanes(worker, dayWidth) : null;
  const assignedBars = assignSegmentLanes(visibleSegmentBars, workerLanes);
  const laneCount = Math.max(
    1,
    workerLanes ? workerLanes.laneCount : 0,
    assignedBars.reduce((maxLane, bar) => Math.max(maxLane, bar.laneIndex + 1), 0)
  );
  const rowHeight = Math.max(72, 20 + laneCount * 32);

  return `
    <div class="charge-plan-row" style="--timeline-width:${timelineWidth}px; --row-height:${rowHeight}px">
      <div class="charge-plan-cell charge-plan-cell--name">${escapeHtml(worker.name)}</div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div
          class="charge-plan-track"
          data-worker-name="${escapeHtml(worker.name)}"
          data-timeline-width="${timelineWidth}"
        >
          ${renderTrackGrid(windowDays, dayWidth, absenceSet)}
          <!-- Surlignage du mois survole (bottom/chargeEditing.js) : un clic vaut le
               mois entier, c est la seule chose qui le montre. Absent de la piste
               Total, en lecture seule. -->
          <div class="charge-plan-month-hover" hidden></div>
          <div class="charge-plan-track-bars">${renderSegmentBars(assignedBars)}</div>
          <div class="charge-plan-selection-preview" hidden>
            <span class="charge-plan-selection-label"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --- Total row: aggregate monthly workload -----------------------------------
// Port of gestion-depenses2 chargeTimeline.renderTotalRow + renderReadonlyTrack:
// a bottom "Total" row whose read-only track shows, per visible month, the total
// effective person-days planned across ALL workers, as a proportional fill bar
// with a "X j" label, plus the grand total in the name cell.

function countMonthBusinessDays(year, monthNumber) {
  let count = 0;
  const cursor = new Date(year, monthNumber - 1, 1);
  while (cursor.getMonth() === monthNumber - 1) {
    if (isBusinessDay(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// Group the window's calendar days into months, each with its pixel span (left/
// width within the frise) and the FULL month's business-day count.
function getWindowMonths(windowDays, dayWidth) {
  const byKey = new Map();
  windowDays.forEach((date, dayIndex) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    let month = byKey.get(key);
    if (!month) {
      month = { key, year: date.getFullYear(), monthNumber: date.getMonth() + 1, firstIndex: dayIndex, dayCount: 0 };
      byKey.set(key, month);
    }
    month.dayCount += 1;
  });
  return [...byKey.values()].map((month) => ({
    ...month,
    widthPx: month.dayCount * dayWidth,
    businessDayCount: countMonthBusinessDays(month.year, month.monthNumber),
  }));
}

// Un segment = un mois : le total mensuel est une somme, plus un prorata.
function computeMonthTotalDays(workers, month) {
  let total = 0;
  (workers || []).forEach((worker) => {
    (worker?.segments || []).forEach((segment) => {
      if (segment?.monthKey !== month.key) return;
      total += getSegmentEffectiveDays(segment);
    });
  });
  return Math.round(total * 100) / 100;
}

// Pastille d'un mois : meme geometrie pour la ligne Total et la ligne Charge.
// Les deux se lisent l'une au-dessus de l'autre — une formule dupliquee finirait
// par deriver d'un seul cote, en silence.
// Le plancher a 0,08 garde une pastille visible pour une valeur infime ; les
// 12 px retranches sont les 6 px de marge de chaque cote (cf. .charge-plan-month-fill).
// `label` (ligne Charge) remplace le « X j » par defaut, et rend la pastille meme
// a 0 requis : elle porte alors encore les jours planifies.
function renderMonthFillPill(value, month, label = "") {
  if (!(value > 0) && !label) return "";
  const fillRatio = Math.min(1, Math.max(0.08, (value > 0 ? value : 0) / Math.max(1, month.businessDayCount)));
  return `<span class="charge-plan-month-fill" style="width:calc((100% - 12px) * ${fillRatio})">
               <span class="charge-plan-month-label">${label || `${formatDayValue(value)} j`}</span>
             </span>`;
}

function renderReadonlyMonthTrack(workers, months) {
  return months
    .map((month) => {
      const totalDays = computeMonthTotalDays(workers, month);
      const fill = renderMonthFillPill(totalDays, month);
      return `<span class="charge-plan-month-segment" style="width:${month.widthPx}px">${fill}</span>`;
    })
    .join("");
}

function renderTotalRow(workers, months, timelineWidth) {
  const grandTotal = (workers || []).reduce(
    (sum, worker) =>
      sum + (worker?.segments || []).reduce((segSum, segment) => segSum + getSegmentEffectiveDays(segment), 0),
    0
  );
  return `
    <div class="charge-plan-row charge-plan-row--total" style="--timeline-width:${timelineWidth}px; --row-height:72px">
      <div class="charge-plan-cell charge-plan-cell--name">
        <span>Total</span>
        <strong class="charge-plan-total-days">${formatDayValue(grandTotal)} j</strong>
      </div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderReadonlyMonthTrack(workers, months)}
        </div>
      </div>
    </div>
  `;
}

// --- Charge row: required vs. planned days, per month -------------------------
// La ligne Charge compare, mois par mois, ce qui est REQUIS par le bareme
// (Task 1, documentCharge.js) a ce qui est PLANIFIE (Task 2 fournit les
// colonnes Duree_*). Elle vit juste sous Total pour que les deux lignes
// s'alignent visuellement sur les memes colonnes de mois.

// Etat d'une cellule mensuelle : on compare les jours PLANIFIES — exactement le
// chiffre que la ligne Total affiche deja, via computeMonthTotalDays — aux jours
// REQUIS par le bareme. Les deux lignes doivent parler du meme nombre, d'ou la
// reutilisation de la meme fonction plutot qu'un calcul parallele.
const CHARGE_EPSILON = 1e-9;

function getChargeCellState(plannedDays, requiredDays) {
  if (requiredDays <= CHARGE_EPSILON && plannedDays <= CHARGE_EPSILON) return "";
  if (Math.abs(plannedDays - requiredDays) < CHARGE_EPSILON) return "is-balanced";
  return plannedDays < requiredDays ? "is-overload" : "is-partial";
}

// Pastille d'un mois de la ligne Charge : « requis / planifie » du metier, les
// deux termes que compare sa couleur (`workers` = les seules personnes de la
// section du metier, cf. renderChargeRows). « — » quand rien n'est requis.
function formatChargeLabel(requiredDays, plannedDays) {
  if (!(requiredDays > 0) && !(plannedDays > 0)) return "";
  const required = requiredDays > 0 ? `${formatDayValue(requiredDays)} j` : "—";
  return `${required} / ${formatDayValue(plannedDays > 0 ? plannedDays : 0)} j`;
}

function renderChargeMonthTrack(workers, months, chargeByMonth) {
  return months
    .map((month) => {
      const requiredDays = chargeByMonth.get(month.key) || 0;
      const plannedDays = computeMonthTotalDays(workers, month);
      const state = getChargeCellState(plannedDays, requiredDays);
      const fill = renderMonthFillPill(requiredDays, month, formatChargeLabel(requiredDays, plannedDays));
      return `<span class="charge-plan-month-segment ${state}" style="width:${month.widthPx}px">${fill}</span>`;
    })
    .join("");
}

// La ligne se rend TOUJOURS des qu'un projet est charge, meme sans aucune duree
// saisie : sinon le bouton « Charge » — seul point d'entree de la fenetre —
// serait introuvable.
// Le badge ne porte QUE la valeur : le libelle « non place » vit dans son
// `title` (deja survole — la pastille est en `cursor: help`). La cellule de nom
// fait 220 px FIXES et loge deja le bouton « Charge » ; avec le prefixe,
// « non place : 240 j » y tenait a quelques pixels pres, et l'etat de deploiement
// attendu — 112 lignes COFFRAGE encore sans dates — donne un total a QUATRE
// chiffres qui debordait ou se faisait rogner (`white-space: nowrap`).
//
// CHARGE PAR METIER (2026-10-26) : une ligne par metier (documentCharge.js,
// CHARGE_ROLES), projeteurs puis ingenieurs (CHARGE_ROW_ORDER, l'ordre des
// sections du board). Chacune compare la charge requise
// de SON metier aux jours planifies des seules personnes de ce metier (groupe
// « Ingenieurs » ou « Projeteurs » du board) ; les « Autres » ne comptent dans
// aucune. UN SEUL bouton « Charge », sur la premiere ligne, ouvre la fenetre
// qui regle les deux metiers ; chaque ligne porte le nom de son metier.
const CHARGE_ROLE_GROUPS = { ingenieurs: "Ingenieurs", projeteurs: "Projeteurs" };
// Ordre des lignes Charge a l'ecran : celui des sections du board (Projeteurs au
// dessus des Ingenieurs, ROLE_GROUP_ORDER). CHARGE_ROLES, lui, reste l'ordre de
// la cellule Grist (« ingenieurs;projeteurs ») et de la fenetre de saisie.
const CHARGE_ROW_ORDER = ["projeteurs", "ingenieurs"];
const CHARGE_ROLE_NAMES = { ingenieurs: "Ingénieurs", projeteurs: "Projeteurs" };

// `workers` : les personnes du metier ; `roleCharge` : sa charge
// ({ byMonth, unplacedDays, totalDays }, computeProjectCharge().byRole[role]) ;
// `withButton` : cette ligne porte le bouton « Charge » (la premiere). La case
// du bouton existe sur chaque ligne pour que les noms de metier s'alignent.
function renderChargeRow(workers, months, timelineWidth, roleCharge, role, withButton) {
  const unplaced =
    roleCharge.unplacedDays > 0
      ? `<span class="charge-plan-charge-unplaced" title="Charge non placee : ${formatDayValue(roleCharge.unplacedDays)} j — documents sans dates de planning, leur charge n'est encore rattachee a aucun mois.">
           ${formatDayValue(roleCharge.unplacedDays)} j
         </span>`
      : "";
  return `
    <div class="charge-plan-row charge-plan-row--charge charge-plan-row--charge-${role}" style="--timeline-width:${timelineWidth}px; --row-height:72px">
      <div class="charge-plan-cell charge-plan-cell--name">
        <span class="charge-plan-charge-action">${
          withButton ? '<button type="button" class="charge-plan-charge-btn" data-charge-assign-open>Charge</button>' : ""
        }</span>
        <span class="charge-plan-charge-role">${CHARGE_ROLE_NAMES[role]}</span>
        ${unplaced}
      </div>
      <div class="charge-plan-cell charge-plan-cell--timeline">
        <div class="charge-plan-track charge-plan-track--readonly">
          ${renderChargeMonthTrack(workers, months, roleCharge.byMonth)}
        </div>
      </div>
    </div>
  `;
}

// Les lignes Charge, une par metier, chacune face a ses seules personnes.
function renderChargeRows(workers, months, timelineWidth, charge) {
  const grouped = groupWorkersByRole(workers);
  return CHARGE_ROW_ORDER.map((role, index) =>
    renderChargeRow(grouped[CHARGE_ROLE_GROUPS[role]] || [], months, timelineWidth, charge.byRole[role], role, index === 0)
  ).join("");
}

// --- Editer toggle (port of renderTimelineEditToolbar) ------------------------

// `.charge-plan-feedback` : zone de message d'etat du board, alimentee par
// `chargeEditing.setBoardFeedback()`. Portee du jumeau gestion-depenses2
// (ui/chargeTimeline.js renderChargePlanTimeline + setChargePlanFeedback) : sans
// elle, l'echec d'une suppression n'avait AUCUN endroit ou s'afficher — la seule
// zone de message du widget vivait dans la fenetre modale, fermee a ce moment-la.
function renderTimelineEditToolbar(editModeEnabled) {
  return `
    <div class="charge-plan-edit-toolbar">
      <button
        type="button"
        class="charge-plan-edit-mode-toggle ${editModeEnabled ? "is-active" : ""}"
        data-charge-plan-edit-toggle="segments"
        aria-pressed="${editModeEnabled ? "true" : "false"}"
      >
        ${editModeEnabled ? "Verrouiller" : "Editer"}
      </button>
      <span class="charge-plan-feedback" hidden></span>
    </div>
  `;
}

function renderContextMenu() {
  return `
    <div class="charge-plan-context-menu" hidden>
      <button type="button" class="charge-plan-context-action" data-action="edit-segment">
        Modifier
      </button>
      <button type="button" class="charge-plan-context-action" data-action="delete-segment">
        Supprimer le segment
      </button>
    </div>
  `;
}

// --- content-width measurement (non-embedded arithmetic path only) -----------

function measureNameColWidthPx(containerEl) {
  if (typeof window === "undefined" || !(containerEl instanceof HTMLElement)) {
    return DEFAULT_NAME_COL_WIDTH_PX;
  }

  const styles = window.getComputedStyle(containerEl);
  const width = parseFloat(styles.getPropertyValue("--charge-plan-name-col-width"));
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_NAME_COL_WIDTH_PX;
}

function measureContentWidthPx(containerEl) {
  if (!(containerEl instanceof HTMLElement)) {
    return MIN_CONTENT_WIDTH_PX;
  }

  const nameColWidthPx = measureNameColWidthPx(containerEl);
  const scrollEl = containerEl.querySelector(".charge-plan-scroll");
  const containerWidth = Math.max(
    scrollEl?.clientWidth || 0,
    containerEl.clientWidth || 0,
    containerEl.getBoundingClientRect?.().width || 0,
    typeof window !== "undefined" ? window.innerWidth - 64 : 0,
    960
  );

  return Math.max(MIN_CONTENT_WIDTH_PX, containerWidth - nameColWidthPx);
}

// --- public factory -------------------------------------------------------------

export function createChargeBoard(containerEl) {
  let activeVisibleSlots = [];
  let contentWidthPx = 0;
  let lastWorkers = [];
  let lastEditMode = false;
  // Planning task ranges (one per Planning_Projet row) used to count, per segment
  // bar, how many planning tasks fall in its period (hover title). Kept across the
  // viewport-only re-renders (setWindow) since the tasks don't change on zoom/pan.
  let lastPlanningTasks = [];
  // Per-worker leave absence sets (Map<normalizeName, Set<slotKey>>). Like
  // lastPlanningTasks, only the data-driven render() carries it; the
  // viewport-only re-render (setWindow) omits it, so we keep the last value to
  // preserve grey shading + red bars across zoom/pan.
  let lastAbsencesByWorker = new Map();
  // Lignes Planning_Projet (Task 1's computeProjectCharge input). Comme
  // lastPlanningTasks : seul le render() pilote par les donnees (main.js) les
  // transmet, la reconstruction de fenetre (setWindow) ne les fait pas
  // transiter — sans memoire, un zoom/pan viderait la ligne Charge a chaque
  // rafraichissement de fenetre.
  let lastPlanningRows = [];
  // TOUTES les lignes TimeSegment, tous projets et tous services : la surcharge
  // d'une personne se compte sur l'ensemble de son engagement, pas sur le seul
  // projet affiche. Memorise comme lastPlanningRows, puisque le re-rendu de
  // viewport (setWindow) ne le retransmet pas.
  let lastAllTimeSegmentRows = [];
  // Tout ce que le rendu tire des DONNEES seules (index de surcharge, groupes de
  // roles, charge du projet, chiffres de chaque barre) : calcule au premier rendu
  // qui suit un changement de donnees, puis reutilise par les rendus de fenetre
  // (zoom / pan), qui ne changent que la geometrie. Null = a recalculer.
  let derived = null;
  // Ce que le dernier rendu a dessine (plage, geometrie, marge ou non) et ses
  // pistes, pour qu'un glisser les DECALE au lieu de tout reconstruire. Null =
  // rien de dessine. `renderSeq` compte les vraies reconstructions (expose sur le
  // conteneur, pour les mesures de fluidite).
  let renderedLayout = null;
  let trackEls = [];
  let renderSeq = 0;

  function clear() {
    renderedLayout = null;
    trackEls = [];
    if (containerEl instanceof HTMLElement) {
      containerEl.innerHTML = "";
      containerEl.classList.remove("is-segment-editing-enabled", "is-segment-editing-locked");
      delete containerEl.dataset.segmentEditMode;
    }
    activeVisibleSlots = [];
  }

  function render({
    workers,
    viewport,
    editMode,
    planningTasks,
    absencesByWorker,
    planningRows,
    allTimeSegmentRows,
    // Internes a setWindow : `panning` dessine la marge de glisser, `bounds`
    // (bornes de la frise) l'empeche de deborder au-dela des donnees.
    panning = false,
    bounds = null,
  } = {}) {
    if (!(containerEl instanceof HTMLElement) || !viewport) {
      clear();
      return;
    }

    renderSeq += 1;
    containerEl.dataset.psRenderSeq = String(renderSeq);

    // Le rendu de fenetre (setWindow) repasse `lastWorkers` lui-meme et aucune
    // autre donnee : tout autre appel apporte des donnees, le cache tombe.
    if (
      workers !== lastWorkers ||
      planningTasks !== undefined ||
      absencesByWorker !== undefined ||
      planningRows !== undefined ||
      allTimeSegmentRows !== undefined
    ) {
      derived = null;
    }
    lastWorkers = workers || [];
    lastEditMode = Boolean(editMode);
    // Only the data-driven render() (from main.js) carries planningTasks; the
    // viewport-only re-render (setWindow) omits it and keeps the last set.
    if (planningTasks !== undefined) lastPlanningTasks = Array.isArray(planningTasks) ? planningTasks : [];
    if (allTimeSegmentRows !== undefined) {
      lastAllTimeSegmentRows = Array.isArray(allTimeSegmentRows) ? allTimeSegmentRows : [];
    }
    if (absencesByWorker !== undefined) {
      lastAbsencesByWorker = absencesByWorker instanceof Map ? absencesByWorker : new Map();
    }
    if (planningRows !== undefined) lastPlanningRows = Array.isArray(planningRows) ? planningRows : [];

    containerEl.classList.add("charge-plan-board");

    if (!derived) {
      derived = {
        // Index de surcharge : un seul balayage de la table par couple
        // (personne, mois) affiche. Le construire ici et non dans le constructeur de
        // barres evite de rebalayer TimeSegment pour chacune des dizaines de barres.
        overloadIndex: buildMonthOverloadIndex({
          entries: lastWorkers.flatMap((worker) =>
            (worker?.segments || []).map((segment) => ({
              personName: worker?.name,
              monthKey: segment?.monthKey,
            }))
          ),
          allSegmentRows: lastAllTimeSegmentRows,
          columns: APP_CONFIG.grist.columns.timeSegment,
          resolveAbsenceSet: (personName) => lastAbsencesByWorker.get(normalizeName(personName)) || null,
        }),
        groupedWorkers: groupWorkersByRole(lastWorkers),
        charge: computeProjectCharge(lastPlanningRows, APP_CONFIG.grist.columns.planningProject),
        segmentMeta: new Map(),
      };
    }
    const { overloadIndex, groupedWorkers, charge, segmentMeta } = derived;
    const requestedDays = toFiniteNumber(viewport.visibleDays, Number.NaN);
    const visibleDays = Math.max(
      1,
      Number.isFinite(requestedDays) ? requestedDays : buildWindowDays(viewport).length || 1
    );
    const range = resolveRenderRange(viewport, visibleDays, { panning, bounds });
    const windowDays = buildWindowDays({ firstVisibleDate: range.startIso, rangeEndDate: range.endIso });
    contentWidthPx = measureContentWidthPx(containerEl);
    const dayWidth = contentWidthPx / visibleDays;
    // Largeur VISIBLE (colonnes de la grille) ; les pistes, elles, couvrent tous
    // les jours dessines et sont decalees pour montrer la fenetre.
    const timelineWidth = dayWidth * visibleDays;
    const trackWidth = dayWidth * windowDays.length;
    const shiftPx = -(range.leadDays + range.offsetDays) * dayWidth;
    // Fraction de jour hors champ a gauche : la pastille du premier mois s'en
    // ecarte, sinon elle serait rognee par le bord (cf. styles.css).
    const leadPx = range.leadDays === 0 ? range.offsetDays * dayWidth : 0;

    activeVisibleSlots = buildVisibleSlots(windowDays, dayWidth);
    // Mois visibles : pastilles des lignes de role, de Total et de Charge.
    const windowMonths = getWindowMonths(windowDays, dayWidth);

    const rowsHtml = Object.entries(groupedWorkers)
      .map(([roleLabel, roleWorkers]) =>
        [
          renderRoleRow(roleLabel, roleWorkers, windowMonths, timelineWidth),
          ...roleWorkers.map((worker) => {
            const absenceSet = lastAbsencesByWorker.get(normalizeName(worker.name)) || new Set();
            return renderWorkerRow(
              worker,
              activeVisibleSlots,
              timelineWidth,
              windowDays,
              dayWidth,
              lastPlanningTasks,
              absenceSet,
              overloadIndex,
              segmentMeta
            );
          }),
        ].join("")
      )
      .join("");

    // Aggregate "Total" row at the bottom (like gestion-depenses2): total
    // effective person-days per visible month across all workers.
    const totalRowHtml = renderTotalRow(lastWorkers, windowMonths, timelineWidth);

    // Lignes Charge, une par metier : requis (documentCharge.js, Task 1) vs
    // planifie (memes mois que Total ci-dessus, personnes du metier).
    const chargeRowHtml = renderChargeRows(lastWorkers, windowMonths, timelineWidth, charge);

    containerEl.classList.toggle("is-segment-editing-enabled", lastEditMode);
    containerEl.classList.toggle("is-segment-editing-locked", !lastEditMode);
    containerEl.dataset.segmentEditMode = lastEditMode ? "enabled" : "locked";

    const transform = shiftPx === 0 ? "none" : `translateX(${shiftPx}px)`;
    containerEl.innerHTML = `
      <div class="charge-plan-scroll">
        <div class="charge-plan-timeline" style="--timeline-width:${timelineWidth}px; --charge-plan-track-width:${trackWidth}px; --charge-plan-transform:${transform}; --charge-plan-lead:${leadPx}px; --charge-plan-weekends:${buildWeekendGradient(windowDays[0], dayWidth)}">
          ${rowsHtml}
          ${totalRowHtml}
          ${chargeRowHtml}
        </div>
      </div>
      ${renderTimelineEditToolbar(lastEditMode)}
      ${renderContextMenu()}
    `;

    trackEls = Array.from(containerEl.querySelectorAll(".charge-plan-track"));
    renderedLayout = {
      startIso: range.startIso,
      dayCount: windowDays.length,
      dayWidth,
      visibleDays,
      contentWidthPx,
      buffered: Boolean(panning),
      firstVisibleDate: viewport.firstVisibleDate,
      offsetDays: range.offsetDays,
    };
  }

  // Glisser : decale les pistes deja dessinees jusqu'a la fenetre demandee, si
  // elle tient dans ce qui est dessine (meme zoom, meme largeur). Rend false
  // sinon : il faut alors redessiner, avec une marge neuve autour de la fenetre.
  function shiftRenderedTo(viewport) {
    const layout = renderedLayout;
    if (!layout || !layout.buffered || !trackEls.length) return false;
    if (Number(viewport.visibleDays) !== layout.visibleDays) return false;
    const startDays =
      daysBetweenIso(layout.startIso, viewport.firstVisibleDate) + normalizeOffsetDays(viewport.offsetDays);
    if (!Number.isFinite(startDays) || startDays < 0 || startDays + layout.visibleDays > layout.dayCount) {
      return false;
    }
    const transform = `translateX(${-startDays * layout.dayWidth}px)`;
    trackEls.forEach((trackEl) => {
      trackEl.style.transform = transform;
    });
    return true;
  }

  // La fenetre exacte est-elle deja a l'ecran ? (meme fenetre, meme fraction,
  // meme largeur, sans marge de glisser) — evite de redessiner pour rien quand
  // main.js re-applique la fenetre juste apres un rendu de donnees.
  function isRenderedExactly(viewport) {
    const layout = renderedLayout;
    return Boolean(
      layout &&
        !layout.buffered &&
        layout.firstVisibleDate === viewport.firstVisibleDate &&
        layout.visibleDays === Number(viewport.visibleDays) &&
        layout.offsetDays === normalizeOffsetDays(viewport.offsetDays) &&
        layout.contentWidthPx === measureContentWidthPx(containerEl)
    );
  }

  // Changement de fenetre seul (zoom / glisser / toolbar), appele dans la frame
  // du controleur (sync/controller.js), la meme ou vis redessine le pane haut :
  // les deux panes bougent ensemble. Plus de bridage a 120 ms : il laissait le
  // pane bas a ~8 images/s derriere le pane haut, et le rendu, debarrasse des
  // calculs de donnees (cache `derived`), tient desormais dans la frame.
  //   - glisser (`panning`) : decaler ce qui est dessine ; sinon redessiner avec
  //     une marge, que les mouvements suivants decaleront ;
  //   - autre geste : redessiner exactement la fenetre, sauf si elle est deja a
  //     l'ecran.
  //
  // Mode Editer : celui qu'affiche le board (bottom/chargeEditing.js le pose sur
  // le conteneur a chaque bascule), pas `lastEditMode`, que la bascule ne met pas
  // a jour — sans quoi un zoom ou un glisser ramenait le bouton sur « Editer »
  // alors que l'edition restait active.
  function setWindow(viewport, { panning = false, bounds = null } = {}) {
    if (!viewport) return;
    if (panning ? shiftRenderedTo(viewport) : isRenderedExactly(viewport)) return;
    const editMode =
      containerEl instanceof HTMLElement && containerEl.dataset.segmentEditMode
        ? containerEl.dataset.segmentEditMode === "enabled"
        : lastEditMode;
    render({ workers: lastWorkers, viewport, editMode, panning, bounds });
  }

  function getVisibleSlots() {
    return activeVisibleSlots;
  }

  function getContentWidthPx() {
    return contentWidthPx;
  }

  function destroy() {
    clear();
    contentWidthPx = 0;
    lastWorkers = [];
    lastEditMode = false;
    derived = null;
    if (containerEl instanceof HTMLElement) {
      containerEl.classList.remove("charge-plan-board");
    }
  }

  return {
    render,
    setWindow,
    getVisibleSlots,
    getContentWidthPx,
    destroy,
  };
}
