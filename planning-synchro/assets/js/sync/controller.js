// Single-window shared viewport controller — the heart of planning-synchro.
//
// ONE canonical viewport `{ mode, firstVisibleDate, visibleDays,
// rangeStartDate, rangeEndDate, anchorDate }` drives BOTH the top pane
// (Task 10's read-only vis-timeline planning renderer) and the bottom pane
// (Task 11's editable charge-plan grid) in the same animation frame, feeding
// both the SAME firstVisibleDate/visibleDays numbers (plus offsetDays, the
// fraction of a day a pixel-exact drag stops on). Because both panes live in the same document at the same content
// width and compute `dayWidth = contentWidthPx / visibleDays` off those same
// numbers (see bottom/chargeBoard.js "KEY ADAPTATIONS" #1 and
// sync/viewportMath.js's getDayBoundaryLeftPx), pixel alignment is
// ARITHMETIC — true by construction, not by measuring the DOM and nudging
// one pane toward the other. See docs/superpowers/specs/2026-07-02-planning-
// synchro-design.md section 6 ("Contrôleur de synchronisation") for the
// rationale: this replaces the fragile measure-DOM + nudgeViewportByPixels +
// retry-loop pattern with plain arithmetic, keeping only ONE post-layout
// assertion (console.warn, dev signal only — never a retry loop).
//
// DOM/orchestration module: requestAnimationFrame/window/document are only
// referenced inside function bodies (never at module top level), so this
// file imports cleanly, but createSyncController() itself cannot be
// unit-tested under `node --test` (no rAF/DOM there). Verified via
// `node --check` + structural read-through against the Task 9/10/11
// interfaces it consumes; real-browser pixel-alignment verification is
// deferred to Task 14, which wires main.js and actually mounts both panes
// against the dev harness (see task-13-report.md).

import {
  applyMode as applyViewportMode,
  panByDays,
  clampToBounds,
  getDayBoundaryLeftPx,
} from "./viewportMath.js";
import { buildCanonicalSharedViewport } from "../viewport/build.js";
import { normalizeIsoDate, shiftIsoDateValue } from "../viewport/normalize.js";
import { APP_CONFIG } from "../config.js";

// Post-layout alignment tolerance, in CSS pixels. Kept at the brief's exact
// "≤ 1px" acceptance threshold.
const ALIGNMENT_TOLERANCE_PX = 1;

// The alignment assertion is a DEV-only safety net (console.warn). It reads the
// DOM (2 getBoundingClientRect) on every apply, i.e. 2 forced reflows per zoom
// tick — pure waste in production. We therefore only SCHEDULE it when a dev opts
// in via window.__PS_ALIGN_DEBUG === true. Alignment itself is guaranteed by
// construction (arithmetic) and covered by the render acceptance check.
function isAlignmentDebugEnabled() {
  return typeof window !== "undefined" && window.__PS_ALIGN_DEBUG === true;
}

// Fixed DOM ids from index.html / dev/harness.html — this widget mounts a
// single instance per page (no multi-instance/component-reuse requirement),
// so the alignment assertion queries these directly rather than requiring
// callers to pass container elements through the constructor (the Produce
// signature is fixed to `{ planningRenderer, chargeBoard, bounds,
// onRangeLabel }` per the task interface; neither renderer object exposes
// its own containerEl).
const PLANNING_PANE_SELECTOR = "#ps-planning";
const CHARGE_PANE_SELECTOR = "#ps-charge";

// Molette : 10 % de jours visibles en plus ou en moins pour 100 px de defilement
// (un cran de souris sous Chrome). Proportionnel au geste, un pave tactile qui
// envoie des dizaines de petits deltas zoome finement au lieu de sauter de 10 %
// a chaque evenement. Un evenement exceptionnel (lancer) est borne a 3 crans.
const WHEEL_ZOOM_FACTOR_PER_100PX = 1.1;
const WHEEL_MAX_DELTA_PX = 300;
const WHEEL_LINE_PX = 100 / 3;
const WHEEL_PAGE_PX = 300;

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Fraction de jour a garder au-dela de firstVisibleDate (glisser au pixel pres,
// ancrage exact de la molette). Elle ne survit que si la fenetre demandee n'a
// pas ete ramenee dans les bornes, et si le jour qu'elle entame en fin de
// fenetre existe encore dans les bornes : en butee, la fenetre s'arrete pile
// sur un jour entier, jamais au-dela.
function resolveOffsetDays(rawOffset, requested, clamped, bounds) {
  const offset = Number(rawOffset);
  if (!(offset > 0) || offset >= 1) return 0;
  if (
    clamped.firstVisibleDate !== requested.firstVisibleDate ||
    clamped.visibleDays !== requested.visibleDays
  ) {
    return 0;
  }
  const boundsEnd = normalizeIsoDate(bounds && bounds.endDate);
  if (boundsEnd && shiftIsoDateValue(clamped.rangeEndDate, 1) > boundsEnd) return 0;
  return offset;
}

// Fenetre { firstVisibleDate, offsetDays } dont le bord gauche est a
// `exactDays` jours (fractionnaires) de `originIso`.
// Une fraction a un cheveu d'un jour entier (arrondi flottant : -1e-17 donne une
// fraction de 1) compte pour ce jour entier ; sinon resolveOffsetDays l'ecarte
// et la fenetre reculerait d'un jour pendant une image.
const WHOLE_DAY_EPSILON = 1e-9;

function splitExactStartDays(originIso, exactDays) {
  let wholeDays = Math.floor(exactDays);
  let offsetDays = exactDays - wholeDays;
  if (offsetDays > 1 - WHOLE_DAY_EPSILON) {
    wholeDays += 1;
    offsetDays = 0;
  } else if (offsetDays < WHOLE_DAY_EPSILON) {
    offsetDays = 0;
  }
  return {
    firstVisibleDate: shiftIsoDateValue(originIso, wholeDays),
    offsetDays,
  };
}

function normalizeWheelDeltaPx(event) {
  const delta = Number(event.deltaY) || 0;
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  return clampNumber(delta * unit, -WHEEL_MAX_DELTA_PX, WHEEL_MAX_DELTA_PX);
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoToFrDate(isoDate) {
  const parts = String(isoDate || "").split("-");
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

// Formats "DD/MM/YYYY - DD/MM/YYYY" out of the viewport's own
// firstVisibleDate/rangeEndDate — the brief's onRangeLabel contract accepts
// either the raw viewport ("call onRangeLabel(v)") or a formatted string
// ("or format a range string and pass it"); this passes BOTH (string first,
// full viewport second) so callers can use the ready-made label or re-derive
// their own without extra parsing.
function formatRangeLabel(viewport) {
  if (!viewport) return "";
  const start = isoToFrDate(viewport.firstVisibleDate);
  const end = isoToFrDate(viewport.rangeEndDate);
  return start && end ? `${start} - ${end}` : "";
}

export function createSyncController({ planningRenderer, chargeBoard, bounds, onRangeLabel } = {}) {
  let current = null;
  let pendingFrameId = null;
  let pendingAssertFrameId = null; // follow-up alignment-assertion rAF (see setViewport).
  let toolbarEl = null;
  let toolbarClickHandler = null;
  const wheelBindings = []; // [{ el, handler }] — bindWheel may be called once per pane.
  const panBindings = []; // [{ el }] — bindPan (drag-to-pan the frise horizontally).
  let panPointerId = null;
  let panStartX = 0;
  let panStartFirstVisibleDate = "";
  let panStartOffsetDays = 0;
  let panStartVisibleDays = 0;
  let panDayWidthPx = 0;

  function getBaseViewport() {
    // Before the first setViewport() call, `current` is null: fall back to
    // an empty canonical viewport. clampToBounds already treats a missing/
    // empty firstVisibleDate as "start at bounds.startDate" (see
    // sync/viewportMath.js), so this degrades gracefully rather than
    // throwing — callers are expected to call setViewport() once up front
    // (Task 14 does, via buildInitialProjectViewport) before wiring
    // toolbar/wheel, but nothing here requires that ordering to avoid a
    // crash.
    return current || buildCanonicalSharedViewport({});
  }

  function refreshToolbarZoomButtons() {
    if (!(toolbarEl instanceof HTMLElement)) return;
    const activeMode = current ? current.mode : null;
    toolbarEl.querySelectorAll("[data-ps-zoom]").forEach((buttonEl) => {
      buttonEl.classList.toggle("is-active", buttonEl.dataset.psZoom === activeMode);
    });
  }

  // Single post-layout alignment assertion (dev safety net, NOT a retry
  // loop): runs exactly once per setViewport(), after the rAF that applied
  // the window to both panes. Bottom pane: getDayBoundaryLeftPx(viewport,
  // viewport.firstVisibleDate, contentWidthPx) is always 0 by construction
  // (see viewportMath.js), so the bottom pane's day-0 boundary sits exactly
  // at its timeline content-area's left edge. Top pane: vis-timeline exposes
  // no public "window start x" API, and probing its internals to compute an
  // exact pixel would invite exactly the fragile measure-and-nudge pattern
  // this controller replaces — so, per the task brief's explicit fallback,
  // this compares the two panes' timeline CONTENT-AREA left offsets
  // (getBoundingClientRect().left) instead: vis-timeline's own "center"
  // panel (to the right of its left label column) is where its window start
  // renders, analogous to the bottom pane's .charge-plan-cell--timeline /
  // .charge-plan-track. If either pane isn't mounted yet (e.g. before
  // Task 14 wires main.js), this silently no-ops — it is a dev signal, not
  // a correctness gate.
  function assertAlignment(viewport) {
    if (typeof document === "undefined" || !viewport) return;

    try {
      const contentWidthPx =
        typeof chargeBoard?.getContentWidthPx === "function" ? chargeBoard.getContentWidthPx() : 0;
      if (!(contentWidthPx > 0)) return;

      // Bottom pane's day-0 boundary offset from its own content-area left
      // edge — always 0 for viewport.firstVisibleDate, kept explicit here so
      // the intent ("compare getDayBoundaryLeftPx of the shared start on
      // both panes") reads directly rather than being hard-coded as a bare 0.
      const chargeDayZeroOffsetPx = getDayBoundaryLeftPx(viewport, viewport.firstVisibleDate, contentWidthPx);

      const chargeContentEl = document.querySelector(
        `${CHARGE_PANE_SELECTOR} .charge-plan-cell--timeline, ${CHARGE_PANE_SELECTOR} .charge-plan-track`
      );
      const planningContentEl = document.querySelector(
        `${PLANNING_PANE_SELECTOR} .vis-panel.vis-center, ${PLANNING_PANE_SELECTOR} .vis-center`
      );

      if (!(chargeContentEl instanceof Element) || !(planningContentEl instanceof Element)) {
        return; // panes not mounted yet — nothing to assert
      }

      const chargeStartLeftPx = chargeContentEl.getBoundingClientRect().left + chargeDayZeroOffsetPx;
      const planningStartLeftPx = planningContentEl.getBoundingClientRect().left;
      const delta = Math.abs(planningStartLeftPx - chargeStartLeftPx);

      if (delta > ALIGNMENT_TOLERANCE_PX) {
        console.warn("[planning-synchro] pane misalignment", delta);
      }
    } catch (error) {
      // Dev safety net only — never let a measurement error break real usage.
    }
  }

  // `viewport.offsetDays` (fraction de jour, 0 par defaut) decale la fenetre au
  // dela de firstVisibleDate : c'est ce qui laisse le glisser suivre le pointeur
  // au pixel pres au lieu de sauter d'un jour entier (~200 px en zoom semaine).
  // Les dates du viewport restent des jours entiers ; seuls les deux panes et le
  // graphique lisent la fraction.
  //
  // `panning` : le geste en cours est un glisser. Le pane bas se contente alors
  // de DECALER ce qu'il a deja dessine (chargeBoard.setWindow), sans rien
  // reconstruire tant que sa marge suffit.
  //
  // `immediate` : appel depuis un geste (glisser, molette), panes visibles et
  // mis en page. Le pane haut recoit alors sa fenetre sur-le-champ (voir plus
  // bas). Les autres appels (chargement d'un projet, toolbar, re-application
  // apres un rendu de donnees) gardent la frame comme avant : au chargement,
  // #ps-main est encore masque, et vis, servi en largeur nulle, en gardait un
  // pane haut ecrase (11 px de haut, aucune barre).
  function setViewport(viewport, { panning = false, immediate = false } = {}) {
    const requested = buildCanonicalSharedViewport(viewport || {});
    const clamped = clampToBounds(requested, bounds);
    const next = {
      ...clamped,
      offsetDays: resolveOffsetDays(viewport && viewport.offsetDays, requested, clamped, bounds),
    };
    current = next;
    wheelTargetDays = null;
    refreshToolbarZoomButtons();

    // Geste : le pane haut recoit sa fenetre TOUT DE SUITE, pas dans la frame
    // ci-dessous. vis-timeline redessine dans SA propre frame (redessin bride
    // par requestAnimationFrame) : demandee depuis notre frame, elle partait a
    // la suivante et le planning du haut avait une image de retard sur le pane
    // bas. Demandee ici, dans l'evenement, elle part dans la MEME frame.
    const applyTopWindow = () => {
      if (typeof planningRenderer?.setWindow === "function") {
        planningRenderer.setWindow(next.firstVisibleDate, next.rangeEndDate, next.offsetDays);
      }
    };
    if (immediate) applyTopWindow();

    if (typeof cancelAnimationFrame === "function") {
      if (pendingFrameId != null) {
        cancelAnimationFrame(pendingFrameId);
        pendingFrameId = null;
      }
      // Also coalesce-cancel any not-yet-fired follow-up assertion rAF from a
      // prior setViewport(), so a superseded alignment check can't run against
      // a stale window (and so destroy() has a single tracked id to cancel).
      if (pendingAssertFrameId != null) {
        cancelAnimationFrame(pendingAssertFrameId);
        pendingAssertFrameId = null;
      }
    }

    if (typeof requestAnimationFrame !== "function") {
      // Non-browser environment guard (this module is never unit-tested
      // under Node, but staying defensive costs nothing here).
      return next;
    }

    pendingFrameId = requestAnimationFrame(() => {
      pendingFrameId = null;

      // The SAME window drives both panes, so alignment is arithmetic rather
      // than a race between two independently-computed updates.
      if (!immediate) applyTopWindow();
      if (typeof chargeBoard?.setWindow === "function") {
        chargeBoard.setWindow(next, { panning, bounds });
      }

      if (typeof onRangeLabel === "function") {
        onRangeLabel(formatRangeLabel(next), next);
      }

      // Follow-up rAF: run the single post-layout alignment assertion after
      // both panes have had a chance to lay out from the setWindow() calls
      // above (no retry loop — see assertAlignment's own comment). DEV-only:
      // only scheduled when window.__PS_ALIGN_DEBUG is on, so production pays no
      // per-tick reflow. Its id is tracked so destroy() and the next
      // setViewport()'s coalescing cancel can stop it before it fires.
      if (isAlignmentDebugEnabled()) {
        pendingAssertFrameId = requestAnimationFrame(() => {
          pendingAssertFrameId = null;
          assertAlignment(next);
        });
      }
    });

    return next;
  }

  function getViewport() {
    return current;
  }

  // Bornes de la frise partagee. Elles sont fixees a la construction, mais le
  // pane bas peut faire APPARAITRE un mois hors de ces bornes : une creation de
  // segment est appliquee localement (sans rechargement du projet), et sans
  // cette entree la fenetre serait ecretee juste avant la barre qui vient
  // d etre creee. L appelant n elargit jamais que vers l exterieur (main.js) :
  // retrecir les bornes deplacerait la fenetre courante sous les yeux de
  // l utilisateur.
  function setBounds(nextBounds) {
    if (!nextBounds || !nextBounds.startDate || !nextBounds.endDate) return bounds;
    bounds = nextBounds;
    return bounds;
  }

  function getBounds() {
    return bounds;
  }

  function applyMode(mode) {
    return setViewport(applyViewportMode(getBaseViewport(), mode));
  }

  function pan(deltaDays) {
    return setViewport(panByDays(getBaseViewport(), deltaDays));
  }

  function today() {
    const base = getBaseViewport();
    // Left-anchor on today; setViewport()'s clampToBounds call handles the
    // case where today falls outside bounds (clamps into range).
    return setViewport({
      mode: base.mode,
      firstVisibleDate: todayIsoDate(),
      visibleDays: base.visibleDays,
    });
  }

  function handleToolbarClick(event) {
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-ps-zoom], #ps-prev, #ps-next, #ps-today")
        : null;
    if (!target) return;

    const zoomMode = target.dataset ? target.dataset.psZoom : "";
    if (zoomMode) {
      event.preventDefault();
      applyMode(zoomMode);
      return;
    }

    if (target.id === "ps-prev") {
      event.preventDefault();
      pan(-getBaseViewport().visibleDays);
      return;
    }

    if (target.id === "ps-next") {
      event.preventDefault();
      pan(getBaseViewport().visibleDays);
      return;
    }

    if (target.id === "ps-today") {
      event.preventDefault();
      today();
    }
  }

  function bindToolbar(nextToolbarEl) {
    unbindToolbar();
    if (!(nextToolbarEl instanceof HTMLElement)) return;

    toolbarEl = nextToolbarEl;
    toolbarClickHandler = handleToolbarClick;
    toolbarEl.addEventListener("click", toolbarClickHandler);
    refreshToolbarZoomButtons();
  }

  function unbindToolbar() {
    if (toolbarEl instanceof HTMLElement && toolbarClickHandler) {
      toolbarEl.removeEventListener("click", toolbarClickHandler);
    }
    toolbarEl = null;
    toolbarClickHandler = null;
  }

  // Zone de la frise (hors colonne des noms) sous laquelle se lit le curseur : la
  // piste du pane bas, a defaut la zone des barres du pane haut. Les deux sont
  // calees au pixel (meme largeur de colonne de gauche), donc l'une vaut l'autre.
  function getTimelineContentRect(fallbackEl) {
    if (typeof document !== "undefined") {
      const candidates = [
        `${CHARGE_PANE_SELECTOR} .charge-plan-cell--timeline`,
        `${PLANNING_PANE_SELECTOR} .vis-panel.vis-center`,
        "#ps-chart .ps-chart-canvas-wrap",
      ];
      for (const selector of candidates) {
        const el = document.querySelector(selector);
        const rect = el ? el.getBoundingClientRect() : null;
        if (rect && rect.width > 0) return rect;
      }
    }
    return fallbackEl && typeof fallbackEl.getBoundingClientRect === "function"
      ? fallbackEl.getBoundingClientRect()
      : null;
  }

  // Jours visibles visés par la molette, fraction comprise : les petits deltas
  // d'un pave tactile s'accumulent ici jusqu'a faire un jour de plus ou de moins
  // (visibleDays reste entier). Remis a zero des que la fenetre change par un
  // autre chemin (glisser, toolbar), cf. setViewport ci-dessous.
  let wheelTargetDays = null;

  // Zooms visibleDays around the date under the cursor. The date under the
  // cursor stays under the cursor: its exact (fractional) day position is
  // computed in the timeline content area (not the whole pane, whose left
  // column of names would skew it), then the new window is placed around it,
  // fraction included (offsetDays) — no more one-day drift per wheel notch.
  function handleWheel(event) {
    // Wheel semantics by region:
    //   - over the top pane's TASK ROWS  -> let the vis-timeline verticalScroll
    //     the rows (do nothing here so the event reaches vis).
    //   - over the time axis (frise) OR the bottom pane -> zoom.
    // Bound in CAPTURE on #ps-main (bindWheel) so that, for the zoom regions,
    // stopPropagation() below runs BEFORE vis and prevents a double action.
    const target = event.target instanceof Element ? event.target : null;
    const overTopPane = Boolean(target && target.closest(PLANNING_PANE_SELECTOR));
    const overAxis = Boolean(target && target.closest(".vis-panel.vis-top"));
    if (overTopPane && !overAxis) {
      return; // rows: vis verticalScroll handles the wheel (scroll up/down)
    }

    event.preventDefault();
    event.stopPropagation();

    const base = getBaseViewport();
    if (!base.firstVisibleDate || !(base.visibleDays > 0)) return;

    const { minVisibleDays, maxVisibleDays } = APP_CONFIG.viewport;
    const deltaPx = normalizeWheelDeltaPx(event);
    if (deltaPx === 0) return;

    // Cible fractionnaire : un cran de souris (100 px) donne exactement le pas
    // d'avant (10 %, au moins un jour une fois arrondi), un pave tactile
    // l'atteint par petites touches. Arriver en butee efface le reliquat.
    const startDays = wheelTargetDays != null ? wheelTargetDays : base.visibleDays;
    const scaled = startDays * Math.pow(WHEEL_ZOOM_FACTOR_PER_100PX, deltaPx / 100);
    let targetDays = clampNumber(scaled, minVisibleDays, maxVisibleDays);
    let nextVisibleDays = Math.round(targetDays);
    if (nextVisibleDays === base.visibleDays && Math.abs(deltaPx) >= 100) {
      // Un cran entier fait toujours bouger d'au moins un jour (comme avant).
      nextVisibleDays = clampNumber(base.visibleDays + Math.sign(deltaPx), minVisibleDays, maxVisibleDays);
      targetDays = nextVisibleDays;
    }
    if (nextVisibleDays === base.visibleDays) {
      wheelTargetDays = targetDays;
      return;
    }

    const rect = getTimelineContentRect(
      (event.target instanceof Element && event.target.closest(".ps-pane")) || event.currentTarget
    );
    const fraction = rect && rect.width > 0 ? clampNumber((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;

    // Jour (fractionnaire) sous le curseur, compte depuis firstVisibleDate, puis
    // nouveau bord gauche qui le laisse sous le curseur.
    const cursorDays = (Number(base.offsetDays) || 0) + fraction * base.visibleDays;
    const nextStart = splitExactStartDays(base.firstVisibleDate, cursorDays - fraction * nextVisibleDays);

    // mode is intentionally left unset here: buildCanonicalSharedViewport
    // (inside setViewport) then derives mode from the new visibleDays, so a
    // wheel-zoom crossing a week/month/year threshold updates the toolbar's
    // active button — unlike applyMode/pan/today, which deliberately keep
    // the user's chosen zoom mode fixed.
    const applied = setViewport({ ...nextStart, visibleDays: nextVisibleDays }, { immediate: true });
    // setViewport vient de remettre la cible a zero : on la repose. En butee
    // (fenetre ramenee dans les bornes), on repart de ce qui a ete applique.
    wheelTargetDays = applied.visibleDays === nextVisibleDays ? targetDays : null;
  }

  // Capture phase so this ancestor handler runs BEFORE the top pane's
  // vis-timeline (a descendant) and can stopPropagation() the wheel to keep
  // zoom the sole wheel action — see handleWheel.
  const WHEEL_OPTIONS = { passive: false, capture: true };

  function bindWheel(targetEl) {
    if (!(targetEl instanceof HTMLElement)) return;
    targetEl.addEventListener("wheel", handleWheel, WHEEL_OPTIONS);
    wheelBindings.push({ el: targetEl, handler: handleWheel });
  }

  function unbindWheel() {
    wheelBindings.splice(0).forEach(({ el, handler }) => {
      el.removeEventListener("wheel", handler, WHEEL_OPTIONS);
    });
  }

  // Drag-to-pan the shared frise horizontally. Bound on the read-only top pane
  // (bindPan, from main.js). A drag shifts firstVisibleDate through the SAME
  // setViewport() path as the toolbar/wheel, so BOTH panes pan together and stay
  // pixel-aligned. Vertical dragging is ignored (rows scroll via wheel/scrollbar).
  function getSharedContentWidthPx() {
    if (typeof chargeBoard?.getContentWidthPx === "function") {
      const width = chargeBoard.getContentWidthPx();
      if (width > 0) return width;
    }
    if (typeof document !== "undefined") {
      const el = document.querySelector(`${PLANNING_PANE_SELECTOR} .vis-panel.vis-center`);
      if (el) return el.getBoundingClientRect().width;
    }
    return 0;
  }

  function onPanPointerDown(event, startFilter) {
    if (panPointerId != null) return;
    if (event.button != null && event.button !== 0) return; // primary button only
    // Restrict where a pan can START. The planning pane passes a filter that only
    // allows the date axis (the "frise"), so dragging the task ROWS never pans —
    // they scroll vertically. The chart pane passes no filter (drag anywhere pans
    // its chronology).
    if (typeof startFilter === "function" && !startFilter(event)) return;
    // Don't hijack a drag on the vertical scrollbar (rows are scrolled there).
    if (event.target instanceof Element && event.target.closest(".vis-vertical-scroll")) return;

    const base = getBaseViewport();
    if (!base.firstVisibleDate || !(base.visibleDays > 0)) return;
    const contentWidthPx = getSharedContentWidthPx();
    if (!(contentWidthPx > 0)) return;

    panPointerId = event.pointerId;
    panStartX = event.clientX;
    panStartFirstVisibleDate = base.firstVisibleDate;
    panStartOffsetDays = Number(base.offsetDays) || 0;
    panStartVisibleDays = base.visibleDays;
    panDayWidthPx = contentWidthPx / base.visibleDays;

    if (event.currentTarget && typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(panPointerId);
      } catch (_) {
        /* best-effort capture */
      }
    }
    if (typeof document !== "undefined") document.body.classList.add("ps-panning");
    // Le pane bas dessine sa marge de glisser DES L'APPUI : le premier mouvement
    // n'a plus qu'a decaler, au lieu de payer ce rendu plus large en plein geste.
    setViewport(base, { panning: true, immediate: true });
    // Bound in CAPTURE (see bindPan): stop the pointerdown here so vis-timeline's
    // own drag handler (on descendant panels) never starts — otherwise vis would
    // ALSO scroll the rows vertically in response to the drag's vertical
    // component. The frise pan must move the chronology HORIZONTALLY only.
    event.stopPropagation();
    event.preventDefault(); // suppress text selection while dragging
  }

  function onPanPointerMove(event) {
    if (event.pointerId !== panPointerId || !(panDayWidthPx > 0)) return;
    // Keep the whole gesture away from vis (belt-and-suspenders alongside the
    // pointer capture): horizontal pan only, never a vertical row scroll.
    event.stopPropagation();
    if (typeof event.preventDefault === "function") event.preventDefault();
    // Drag right => reveal EARLIER dates (content follows the cursor, like a map).
    // Au pixel pres : le deplacement garde sa fraction de jour (offsetDays) au lieu
    // d'etre arrondi au jour, qui faisait avancer la frise par a-coups d'un jour.
    const exactDays = panStartOffsetDays - (event.clientX - panStartX) / panDayWidthPx;
    setViewport(
      { ...splitExactStartDays(panStartFirstVisibleDate, exactDays), visibleDays: panStartVisibleDays },
      { panning: true, immediate: true }
    );
  }

  function endPan(event) {
    if (event.pointerId !== panPointerId) return;
    if (event.currentTarget && typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(panPointerId);
      } catch (_) {
        /* capture may already be gone */
      }
    }
    panPointerId = null;
    if (typeof document !== "undefined") document.body.classList.remove("ps-panning");
    // Fin du geste : la fenetre est reappliquee hors glisser, le pane bas
    // redessine donc EXACTEMENT la fenetre visible (sans sa marge de glisser).
    // La fenetre ne bouge pas (la fraction de jour atteinte est gardee) ; seuls
    // les libelles des mois coupes aux bords, qui ont glisse avec leur mois
    // pendant le geste, reviennent au bord de la fenetre.
    if (current) setViewport(current, { immediate: true });
  }

  function bindPan(targetEl, options = {}) {
    if (!(targetEl instanceof HTMLElement)) return;
    const startFilter = typeof options.startFilter === "function" ? options.startFilter : null;
    // Per-binding pointerdown wrapper so each pane can carry its own start filter.
    const down = (event) => onPanPointerDown(event, startFilter);
    // CAPTURE phase: run before vis-timeline's descendant drag handlers so a frise
    // pan can stopPropagation() and keep vis from vertically scrolling the rows
    // (see onPanPointerDown / onPanPointerMove).
    targetEl.addEventListener("pointerdown", down, true);
    targetEl.addEventListener("pointermove", onPanPointerMove, true);
    targetEl.addEventListener("pointerup", endPan, true);
    targetEl.addEventListener("pointercancel", endPan, true);
    panBindings.push({ el: targetEl, down });
  }

  function unbindPan() {
    panBindings.splice(0).forEach(({ el, down }) => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", onPanPointerMove, true);
      el.removeEventListener("pointerup", endPan, true);
      el.removeEventListener("pointercancel", endPan, true);
    });
    if (typeof document !== "undefined") document.body.classList.remove("ps-panning");
  }

  function destroy() {
    if (typeof cancelAnimationFrame === "function") {
      if (pendingFrameId != null) {
        cancelAnimationFrame(pendingFrameId);
        pendingFrameId = null;
      }
      if (pendingAssertFrameId != null) {
        cancelAnimationFrame(pendingAssertFrameId);
        pendingAssertFrameId = null;
      }
    }
    unbindToolbar();
    unbindWheel();
    unbindPan();
  }

  return {
    setViewport,
    getViewport,
    setBounds,
    getBounds,
    applyMode,
    pan,
    today,
    bindToolbar,
    bindWheel,
    bindPan,
    destroy,
  };
}
