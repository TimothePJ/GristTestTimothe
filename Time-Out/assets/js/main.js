// Time-Out/assets/js/main.js
import { APP_CONFIG, LEAVE_TYPES } from "./config.js";
import { initGrist, fetchTeamRows, fetchSegments, getResolvedTeamColumns, getResolvedTimeOutColumns, findCurrentUser, getTimeOutTableId } from "./services/gristService.js";
import { createLeaveBoard } from "./ui/board.js";
import { attachLeaveEditing } from "./ui/editing.js";
import { createReasonModal } from "./ui/reasonModal.js";
import { createEditModal } from "./ui/editModal.js";
import { segmentToDates } from "./utils/textSegments.js";
import { toText, parseCalendarDate } from "./utils/dates.js";
import { dedupeTeamMembers, findPersonKeyForEmail } from "./utils/teamPeople.js";
import { computeViewport, shiftAnchor } from "./utils/viewportModes.js";
import { state, loadPersistedViewport, persistViewport } from "./state.js";

// Drag/editing controller (Task 12). Module-level so render() can detach the
// previous instance before a re-render replaces the board's DOM.
let editing = null;

function buildSegments(rows, cols) {
  return (rows || []).map((r) => {
    const dates = segmentToDates({
      startDate: toText(r[cols.startDate]), startPeriod: toText(r[cols.startPeriod]),
      endDate: toText(r[cols.endDate]), endPeriod: toText(r[cols.endPeriod]),
    });
    if (!dates) return null;
    return { id: r.id, owner: toText(r[cols.owner]), type: toText(r[cols.type]), startAt: dates.startAt, endAt: dates.endAt };
  }).filter(Boolean);
}
function renderLegend() {
  const el = document.getElementById("to-legend");
  if (!el) return;
  el.innerHTML = LEAVE_TYPES.map((t) =>
    `<span class="to-legend-item"><span class="to-legend-swatch" style="background:${t.color}"></span>${t.label}</span>`
  ).join("");
}
// Human range label, e.g. "1 juillet 2026 → 29 septembre 2026" (Task 16).
function formatViewportRange(viewport) {
  if (!viewport) return "";
  const start = parseCalendarDate(viewport.rangeStartDate || viewport.firstVisibleDate);
  const end = parseCalendarDate(viewport.rangeEndDate);
  if (!start || !end) return "";
  const fmt = (d) => `${d.getDate()} ${APP_CONFIG.months[d.getMonth()]} ${d.getFullYear()}`;
  return `${fmt(start)} → ${fmt(end)}`;
}
// Highlight the zoom button matching the current viewport mode.
function updateZoomButtons(mode) {
  document.querySelectorAll("[data-to-zoom]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.toZoom === mode);
  });
}
function buildInitialViewport() {
  const persisted = loadPersistedViewport();
  if (persisted && persisted.mode && persisted.firstVisibleDate && persisted.rangeEndDate) return persisted;
  return computeViewport("quarter", new Date());
}

function bootstrapApp() {
  const els = {
    main: document.getElementById("to-main"),
    empty: document.getElementById("to-empty"),
    range: document.getElementById("to-range"),
    banner: document.getElementById("to-banner"),
  };
  if (!(els.main instanceof HTMLElement)) return;
  let board = null;

  // The reason pop-up lives on a body-level sibling (#to-reason-modal) so a board
  // re-render never destroys it; created once and reused across renders.
  const reasonModalEl = document.getElementById("to-reason-modal");
  const reasonModal = reasonModalEl instanceof HTMLElement ? createReasonModal(reasonModalEl) : null;

  // The edit/delete pop-up (#to-edit-modal) is likewise a stable body-level sibling
  // created ONCE here — never inside render()/attachLeaveEditing (which re-run on
  // every refresh) — so its listeners are bound a single time. editing.js drives it
  // through the injected openEditModal callback below.
  const editModalEl = document.getElementById("to-edit-modal");
  const editModal = editModalEl instanceof HTMLElement ? createEditModal(editModalEl) : null;

  async function fetchAll() {
    const [teamRows, segRows] = await Promise.all([fetchTeamRows().catch(() => []), fetchSegments().catch(() => [])]);
    const teamCols = await getResolvedTeamColumns();
    const outCols = await getResolvedTimeOutColumns();
    state.teamMembers = dedupeTeamMembers(teamRows, teamCols);
    const cu = findCurrentUser(teamRows, teamCols) || { email: "", isAdmin: false };
    cu.personKey = findPersonKeyForEmail(state.teamMembers, cu.email);
    cu.service = (state.teamMembers.find((m) => m.personKey === cu.personKey) || {}).service || "";
    state.currentUser = cu;
    state.segments = buildSegments(segRows, outCols);
  }
  // Capture le défilement avant la reconstruction du board et le restitue après :
  // une fois tout de suite, une fois à la frame suivante, car les barres et l'axe
  // ne figent leur hauteur qu'une fois la mise en page faite. Sans cela un
  // rafraîchissement (écriture, signal Grist, retour de focus) renvoie
  // l'utilisateur en haut du planning.
  function captureBoardScroll() {
    const scroller = document.scrollingElement || document.documentElement;
    const prevScroll = els.main.querySelector(".charge-plan-scroll");
    const documentTop = scroller ? scroller.scrollTop : 0;
    const savedTop = prevScroll ? prevScroll.scrollTop : 0;
    const savedLeft = prevScroll ? prevScroll.scrollLeft : 0;

    return () => {
      const restore = () => {
        if (scroller) scroller.scrollTop = documentTop;
        const nextScroll = els.main.querySelector(".charge-plan-scroll");
        if (nextScroll) { nextScroll.scrollTop = savedTop; nextScroll.scrollLeft = savedLeft; }
      };
      restore();
      requestAnimationFrame(restore);
    };
  }
  function render() {
    const restoreScroll = captureBoardScroll();

    if (editing) editing.detach();
    if (board) board.destroy();
    state.viewport = state.viewport || buildInitialViewport();

    const hasMembers = state.teamMembers.length > 0;
    const unrecognized = !state.currentUser.personKey;

    // Unrecognized user (login email maps to no Team person) → NO access to the
    // board: hide it and show only the refusal message. Do not build the board.
    if (unrecognized) {
      els.empty.hidden = true;
      els.main.hidden = true;
      if (els.banner) {
        els.banner.hidden = false;
        els.banner.textContent = "Vous n'êtes pas reconnu — accès au planning refusé.";
      }
      return;
    }
    if (els.banner) els.banner.hidden = true;
    els.empty.hidden = hasMembers;
    els.main.hidden = !hasMembers;

    board = createLeaveBoard(els.main);
    board.render({ members: state.teamMembers, segments: state.segments, viewport: state.viewport, currentUser: state.currentUser });

    // Restore the pre-render scroll on the freshly rebuilt scroll container.
    restoreScroll();

    persistViewport(state.viewport);
    renderLegend();
    if (els.range) els.range.textContent = formatViewportRange(state.viewport);
    updateZoomButtons(state.viewport.mode);

    editing = attachLeaveEditing(els.main, {
      getVisibleSlots: () => (board ? board.getVisibleSlots() : []),
      canEditTrack: (personKey) =>
        state.currentUser.isAdmin ||
        Boolean(personKey && personKey === state.currentUser.personKey),
      openReasonModal: reasonModal
        ? ({ ownerEmail, startAt, endAt }) => reasonModal.open({ ownerEmail, startAt, endAt })
        : undefined,
      onChanged: async () => { await fetchAll(); render(); },
      openEditModal: editModal ? (opts) => editModal.open(opts) : undefined,
    });
  }
  // Zoom/pan toolbar (Task 16). Wired ONCE (from bootstrap) so listeners are not
  // duplicated by render()/onRecords re-runs. Handlers mutate the persistent
  // state.viewport in place, then re-render + persist.
  function wireViewportControls() {
    const ensureVp = () => (state.viewport = state.viewport || buildInitialViewport());
    const apply = (vp) => {
      if (!vp) return;
      state.viewport = vp;
      render();
      persistViewport(state.viewport);
    };
    const prev = document.getElementById("to-prev");
    const next = document.getElementById("to-next");
    const today = document.getElementById("to-today");
    if (prev) prev.addEventListener("click", () => {
      ensureVp();
      apply(computeViewport(state.viewport.mode, shiftAnchor(state.viewport.mode, state.viewport.firstVisibleDate, -1)));
    });
    if (next) next.addEventListener("click", () => {
      ensureVp();
      apply(computeViewport(state.viewport.mode, shiftAnchor(state.viewport.mode, state.viewport.firstVisibleDate, 1)));
    });
    if (today) today.addEventListener("click", () => {
      ensureVp();
      apply(computeViewport(state.viewport.mode, new Date()));
    });
    document.querySelectorAll("[data-to-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.toZoom;
        if (mode !== "week" && mode !== "month" && mode !== "quarter") return;
        ensureVp();
        const anchor = parseCalendarDate(state.viewport.firstVisibleDate) || new Date();
        apply(computeViewport(mode, anchor));
      });
    });
  }

  // Le runtime partagé possède déjà l'abonnement natif grist.onRecords : on passe
  // par watchContextTable, qui ne relit que sur un vrai évènement (écriture locale,
  // signal Grist, retour de focus, changement de projet/service) et ne livre que si
  // les lignes ont réellement changé. Aucune minuterie n'est demandée.
  async function watchTimeOutTable() {
    const runtime = window.GristServiceContext;
    if (typeof runtime?.watchContextTables !== "function") return;

    let tableId = "";
    try { tableId = await getTimeOutTableId(); } catch (_e) { return; }
    if (!tableId) return;

    // Le calendrier affiche les absences, mais les noms et services viennent de
    // l'annuaire : une arrivée ou un départ saisi ailleurs doit s'y voir.
    // forceRefresh:false — le chargement initial vient d'être fait, la copie en
    // cache suffit pour la première lecture.
    runtime.watchContextTables([tableId, APP_CONFIG.grist.tables.team], async () => {
      await fetchAll();
      render();
    }, { forceRefresh: false });
  }

  async function bootstrap() {
    wireViewportControls();
    try { initGrist(); } catch (e) { console.error("Grist init:", e); }
    try { await window.GristServiceContext?.whenReady?.(); } catch (e) {
      console.warn("Contexte Service indisponible, chargement RPC Time-Out conserve :", e);
    }
    try { await fetchAll(); } catch (e) { console.error("Chargement Time-Out:", e); }
    render();
    try { await watchTimeOutTable(); } catch (e) {
      console.warn("Surveillance Time-Out indisponible :", e);
    }
  }
  bootstrap().catch((e) => console.error("Init time-out:", e));
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrapApp);
  else bootstrapApp();
}
