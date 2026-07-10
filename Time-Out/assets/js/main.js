// Time-Out/assets/js/main.js
import { APP_CONFIG, LEAVE_TYPES } from "./config.js";
import { initGrist, fetchTeamRows, fetchSegments, getResolvedTeamColumns, getResolvedTimeOutColumns, findCurrentUser } from "./services/gristService.js";
import { createLeaveBoard } from "./ui/board.js";
import { attachLeaveEditing } from "./ui/editing.js";
import { createReasonModal } from "./ui/reasonModal.js";
import { createEditModal } from "./ui/editModal.js";
import { segmentToDates } from "./utils/textSegments.js";
import { toText, parseCalendarDate } from "./utils/dates.js";
import { dedupeTeamMembers, findPersonKeyForEmail, filterMembersByService } from "./utils/teamPeople.js";
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
function addDaysIso(iso, days) {
  const base = parseCalendarDate(iso);
  if (!base) return iso;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
// Highlight the zoom button matching the current window width (Task 16).
function updateZoomButtons(visibleDays) {
  document.querySelectorAll("[data-to-zoom]").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.toZoom) === Number(visibleDays));
  });
}
function buildInitialViewport() {
  const persisted = loadPersistedViewport();
  if (persisted && persisted.firstVisibleDate && persisted.rangeEndDate) return persisted;
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstVisibleDate = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`;
  const visibleDays = APP_CONFIG.initialWindowDays;
  return {
    firstVisibleDate,
    visibleDays,
    rangeStartDate: firstVisibleDate,
    rangeEndDate: addDaysIso(firstVisibleDate, visibleDays - 1),
  };
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
  function render() {
    // Preserve scroll across the board's innerHTML rebuild (onChanged → render
    // after a write) so the user is not thrown back to the top.
    const prevScroll = els.main.querySelector(".charge-plan-scroll");
    const savedTop = prevScroll ? prevScroll.scrollTop : 0;
    const savedLeft = prevScroll ? prevScroll.scrollLeft : 0;

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

    // Service visibility: a non-admin sees only their own service; an admin, all.
    const visibleMembers = filterMembersByService(
      state.teamMembers,
      state.currentUser.service,
      state.currentUser.isAdmin
    );

    board = createLeaveBoard(els.main);
    board.render({ members: visibleMembers, segments: state.segments, viewport: state.viewport, currentUser: state.currentUser });

    // Restore the pre-render scroll on the freshly rebuilt scroll container.
    const newScroll = els.main.querySelector(".charge-plan-scroll");
    if (newScroll) { newScroll.scrollTop = savedTop; newScroll.scrollLeft = savedLeft; }

    persistViewport(state.viewport);
    renderLegend();
    if (els.range) els.range.textContent = formatViewportRange(state.viewport);
    updateZoomButtons(state.viewport.visibleDays);

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
    const recalcRange = (vp) => {
      vp.rangeStartDate = vp.firstVisibleDate;
      vp.rangeEndDate = addDaysIso(vp.firstVisibleDate, vp.visibleDays - 1);
    };
    const commit = (mutate) => {
      const vp = ensureVp();
      mutate(vp);
      recalcRange(vp);
      render();
      persistViewport(state.viewport);
    };
    const prev = document.getElementById("to-prev");
    const next = document.getElementById("to-next");
    const today = document.getElementById("to-today");
    if (prev) prev.addEventListener("click", () => commit((vp) => {
      vp.firstVisibleDate = addDaysIso(vp.firstVisibleDate, -vp.visibleDays);
    }));
    if (next) next.addEventListener("click", () => commit((vp) => {
      vp.firstVisibleDate = addDaysIso(vp.firstVisibleDate, vp.visibleDays);
    }));
    if (today) today.addEventListener("click", () => commit((vp) => {
      const now = new Date();
      vp.firstVisibleDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }));
    document.querySelectorAll("[data-to-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.toZoom);
        if (!Number.isFinite(n) || n <= 0) return;
        commit((vp) => { vp.visibleDays = n; });
      });
    });
  }

  async function bootstrap() {
    wireViewportControls();
    try { initGrist(); } catch (e) { console.error("Grist init:", e); }
    try { await fetchAll(); } catch (e) { console.error("Chargement Time-Out:", e); }
    render();
    if (window.grist && typeof window.grist.onRecords === "function") {
      try { window.grist.onRecords(async () => { await fetchAll(); render(); }); } catch (_e) {}
    }
  }
  bootstrap().catch((e) => console.error("Init time-out:", e));
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrapApp);
  else bootstrapApp();
}
