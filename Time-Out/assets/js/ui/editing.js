// Leave-board editing interactions — drag-to-create + reason pop-up handoff.
// Ported from `planning-synchro/assets/js/bottom/chargeEditing.js` and stripped
// to the leave planner's needs (see docs/superpowers/plans/2026-07-10-time-out.md,
// Task 10). Deltas vs the source:
//   - `attachChargeEditing(boardEl, { getProjectNumber, ... })` becomes
//     `attachLeaveEditing(rootEl, { getVisibleSlots, canEditTrack, openReasonModal,
//     onChanged, openEditModal })`.
//   - The `mode:"resize"` branch machinery (resize handles + resize commit) is
//     removed — this widget is drag-create + modal-edit only.
//   - `handlePointerDown` / `handleContextMenuEvent` gate on the track's owner via
//     `canEditTrack(trackEl.dataset.ownerEmail)` (ownership: own line or admin).
//   - The create-commit in `handlePointerUp` hands off to `openReasonModal({
//     ownerEmail, startAt, endAt })`; the returned `{ write }` (from the reason
//     modal, Task 11) owns the actual `createSegment` write.
//   - The context menu (Modifier / Supprimer) is displayed + gated here (Task 13):
//       * "Modifier" seeds `openEditModal({ segmentId, startAt, endAt, type,
//         checkOverlap })` from the bar's data-* attributes; the modal owns the
//         updateSegment/removeSegment write and resolves true when a change was
//         written, upon which `onChanged()` refreshes the board.
//       * "Supprimer" runs `persistWrite(() => removeSegment(segmentId))`.
//     `checkOverlap` reuses this module's `trackHasOverlap` against the segment's
//     OWN track, excluding the edited segment via `ignoreSegmentId` (Task 14
//     edit-path overlap guard) — so it never crosses a module boundary.
//     `removeSegment` is the ONLY gristService write helper this module imports;
//     the create write still belongs to the reason modal.
//
// The pure half-day slot selection math (`buildSelectionFromSlotIndexes`) and the
// DOM-sourced overlap check (`trackHasOverlap`) are kept verbatim from the source,
// as are the `.charge-plan-*` DOM hooks / `data-*` attributes the board emits.
//
// DOM/event module: window/document/HTMLElement are only referenced inside
// `attachLeaveEditing()`'s closures (never at module top level or inside the
// exported pure functions), so `buildSelectionFromSlotIndexes` / `trackHasOverlap`
// import and run cleanly under Node — see tests/editing.test.mjs.

// `removeSegment` (context-menu "Supprimer") is the only gristService write helper
// used here; it is a plain async function with no DOM/module side effects at import
// time, so the exported pure helpers still import cleanly under Node.
import { removeSegment } from "../services/gristService.js";

// --- inlined numeric helpers (Time-Out ships no utils/format.js) ---------------

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDayValue(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  const text = rounded.toFixed(2).replace(".", ",");
  return text.endsWith(",00") ? text.slice(0, -3) : text;
}

const TRACK_SELECTOR = ".charge-plan-track";
const SEGMENT_BAR_SELECTOR = ".charge-plan-segment-bar";
const CONTEXT_MENU_SELECTOR = ".charge-plan-context-menu";
const CONTEXT_ACTION_SELECTOR = ".charge-plan-context-action";

// --- pure half-day slot selection math (port of buildSelectionFromSlots) ------

// Builds a selection { startDate, endDate, allocationDays, leftPx, widthPx,
// startSlotIndex, endSlotIndex } spanning [firstSlotIndex..lastSlotIndex]
// (inclusive, order-independent) out of a flat slots array (board.js's
// getVisibleSlots() shape: { slotIndex, leftPx, widthPx, startAt: Date,
// endAt: Date, isWorkingDay }). Pure: no DOM access anywhere in this
// function. Returns null if either index isn't present in `slots`.
export function buildSelectionFromSlotIndexes(slots, firstSlotIndex, lastSlotIndex) {
  const list = Array.isArray(slots) ? slots : [];
  const firstSlot = list.find((slot) => slot.slotIndex === Number(firstSlotIndex));
  const lastSlot = list.find((slot) => slot.slotIndex === Number(lastSlotIndex));
  if (!firstSlot || !lastSlot) return null;

  const orderedFirst = firstSlot.slotIndex <= lastSlot.slotIndex ? firstSlot : lastSlot;
  const orderedLast = firstSlot.slotIndex <= lastSlot.slotIndex ? lastSlot : firstSlot;

  const selectedSlots = list.filter(
    (slot) => slot.slotIndex >= orderedFirst.slotIndex && slot.slotIndex <= orderedLast.slotIndex
  );
  const workingSlotCount = selectedSlots.filter((slot) => slot.isWorkingDay).length;
  const allocationDays = Math.round((workingSlotCount / 2) * 100) / 100;

  return {
    startDate: orderedFirst.startAt.toISOString(),
    endDate: orderedLast.endAt.toISOString(),
    allocationDays,
    leftPx: orderedFirst.leftPx,
    widthPx: orderedLast.leftPx + orderedLast.widthPx - orderedFirst.leftPx,
    startSlotIndex: orderedFirst.slotIndex,
    endSlotIndex: orderedLast.slotIndex,
  };
}

// --- DOM-dependent slot lookup (port of getSlotIndexFromClientX) --------------

function getSlotIndexAtClientX(trackEl, slots, clientX) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return -1;

  const trackRect = trackEl.getBoundingClientRect();
  const x = clamp(clientX - trackRect.left, 0, trackRect.width - 1);

  for (const slot of list) {
    const startX = slot.leftPx;
    const endX = slot.leftPx + slot.widthPx;
    if (x >= startX && x < endX) {
      return slot.slotIndex;
    }
  }

  return list[list.length - 1].slotIndex;
}

function computeSelectionFromClientX(trackEl, slots, startClientX, endClientX) {
  const firstSlotIndex = getSlotIndexAtClientX(trackEl, slots, startClientX);
  const lastSlotIndex = getSlotIndexAtClientX(trackEl, slots, endClientX);
  if (firstSlotIndex < 0 || lastSlotIndex < 0) return null;
  return buildSelectionFromSlotIndexes(slots, firstSlotIndex, lastSlotIndex);
}

// --- overlap check (port of selectionOverlapsWorkerSegments, DOM-sourced) -----

export function trackHasOverlap(trackEl, selection, { ignoreSegmentId } = {}) {
  if (!(trackEl instanceof HTMLElement) || !selection) return false;

  const selectionStart = new Date(selection.startDate).getTime();
  const selectionEnd = new Date(selection.endDate).getTime();
  if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd)) return false;

  const barEls = trackEl.querySelectorAll(SEGMENT_BAR_SELECTOR);
  for (const barEl of barEls) {
    if (ignoreSegmentId != null && String(barEl.dataset.segmentId) === String(ignoreSegmentId)) {
      continue;
    }
    const startMs = Number(barEl.dataset.startAtMs);
    const endMs = Number(barEl.dataset.endAtMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (selectionStart < endMs && selectionEnd > startMs) return true;
  }
  return false;
}

function annotateOverlap(trackEl, selection, options = {}) {
  if (!selection) return null;
  return { ...selection, hasOverlap: trackHasOverlap(trackEl, selection, options) };
}

// --- selection preview (port of updateChargePlanSelectionPreview / clear...) --

function updateSelectionPreview(trackEl, selection) {
  const previewEl = trackEl?.querySelector(".charge-plan-selection-preview");
  const labelEl = previewEl?.querySelector(".charge-plan-selection-label");
  if (!(previewEl instanceof HTMLElement) || !(labelEl instanceof HTMLElement)) return;

  if (!selection || selection.widthPx <= 0 || selection.allocationDays <= 0) {
    clearSelectionPreview(trackEl);
    return;
  }

  previewEl.hidden = false;
  previewEl.style.left = `${selection.leftPx}px`;
  previewEl.style.width = `${selection.widthPx}px`;
  previewEl.classList.toggle("is-invalid", Boolean(selection.hasOverlap));
  labelEl.textContent = `${formatDayValue(selection.allocationDays)} j`;
}

function clearSelectionPreview(trackEl) {
  const previewEl = trackEl?.querySelector(".charge-plan-selection-preview");
  if (!(previewEl instanceof HTMLElement)) return;

  previewEl.hidden = true;
  previewEl.style.left = "0px";
  previewEl.style.width = "0px";
  previewEl.classList.remove("is-invalid");

  const labelEl = previewEl.querySelector(".charge-plan-selection-label");
  if (labelEl instanceof HTMLElement) {
    labelEl.textContent = "";
  }
}

// --- context menu (port of showChargePlanContextMenu / hideChargePlanContextMenu) --

function hideContextMenu(boardEl) {
  const menuEl = boardEl?.querySelector(CONTEXT_MENU_SELECTOR);
  if (!(menuEl instanceof HTMLElement)) return;

  menuEl.hidden = true;
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  delete menuEl.dataset.segmentId;

  menuEl.querySelectorAll(CONTEXT_ACTION_SELECTOR).forEach((actionEl) => {
    delete actionEl.dataset.segmentId;
  });
}

function showContextMenu(boardEl, { clientX, clientY, segmentId }) {
  const menuEl = boardEl?.querySelector(CONTEXT_MENU_SELECTOR);
  if (!(menuEl instanceof HTMLElement)) return;

  menuEl.hidden = false;
  menuEl.dataset.segmentId = String(segmentId);
  menuEl.querySelectorAll(CONTEXT_ACTION_SELECTOR).forEach((actionEl) => {
    actionEl.dataset.segmentId = String(segmentId);
  });

  menuEl.style.left = `${clientX}px`;
  menuEl.style.top = `${clientY}px`;

  const margin = 8;
  const menuRect = menuEl.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
  menuEl.style.left = `${Math.min(clientX, maxLeft)}px`;
  menuEl.style.top = `${Math.min(clientY, maxTop)}px`;
}

// --- public factory -------------------------------------------------------------

// attachLeaveEditing(rootEl, { getVisibleSlots, canEditTrack, openReasonModal,
//   onChanged, openEditModal }) → { detach() }
//
// Editing is always on (no lock/unlock toggle). Wires drag-to-create and the
// Modifier/Supprimer context menu onto `rootEl` (board.js's leave-board
// container). All listeners are delegated on
// `rootEl`/window/document (never on inner elements), so they survive
// `rootEl.innerHTML` being replaced by a subsequent `board.render()` call triggered
// from `onChanged()`.
//
// `openEditModal({ segmentId, startAt, endAt, type, checkOverlap }) ->
// Promise<boolean>` is injected by main.js (the edit modal is created ONCE on the
// body-level `#to-edit-modal` sibling and reused, so re-attaching this controller on
// every render never re-binds the modal's listeners). It resolves true when a change
// was written.
export function attachLeaveEditing(
  rootEl,
  { getVisibleSlots, canEditTrack, openReasonModal, onChanged, openEditModal } = {}
) {
  const boardEl = rootEl;
  if (!(boardEl instanceof HTMLElement)) {
    return { detach() {} };
  }

  let dragState = null;

  function resolveSlots() {
    const slots = typeof getVisibleSlots === "function" ? getVisibleSlots() : [];
    return Array.isArray(slots) ? slots : [];
  }

  // Editing is always on for this widget (no lock/unlock toggle). Keep the
  // "enabled" hook class so the track edit-affordance CSS applies; the real
  // guards are the ownership gate (canEditTrack) + Grist Access Rules.
  function applyEditModeToDom() {
    boardEl.classList.add("is-segment-editing-enabled");
    boardEl.classList.remove("is-segment-editing-locked");
    boardEl.dataset.segmentEditMode = "enabled";
  }

  function cancelDrag() {
    if (!dragState) return;
    clearSelectionPreview(dragState.trackEl);
    dragState = null;
  }

  // Runs a CRUD write, refreshes the board via onChanged(), then re-asserts this
  // module's edit-mode UI regardless of success/failure so the toggle never
  // silently reverts (onChanged() triggers board.render() which replaces innerHTML).
  async function persistWrite(writeFn) {
    try {
      await writeFn();
      if (typeof onChanged === "function") {
        await onChanged();
      }
    } catch (error) {
      console.error("Erreur ecriture Time-Out (conge) :", error);
    } finally {
      applyEditModeToDom();
    }
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(CONTEXT_MENU_SELECTOR)) return;

    hideContextMenu(boardEl);

    const trackEl = event.target.closest(TRACK_SELECTOR);
    if (!(trackEl instanceof HTMLElement)) return;

    // Ownership gate: only the line's owner (or an admin) may create here.
    const ownerEmail = trackEl.dataset.ownerEmail || "";
    if (typeof canEditTrack === "function" && !canEditTrack(ownerEmail)) return;

    // Clicking an existing bar starts no create-drag (bars are edited via the
    // right-click context menu, not dragged over).
    const segmentEl = event.target.closest(SEGMENT_BAR_SELECTOR);
    if (segmentEl instanceof HTMLElement) return;

    const workerName = trackEl.dataset.workerName || "";
    if (!workerName) return;

    event.preventDefault();
    const slots = resolveSlots();
    const initialSelection = annotateOverlap(
      trackEl,
      computeSelectionFromClientX(trackEl, slots, event.clientX, event.clientX)
    );

    dragState = {
      mode: "create",
      trackEl,
      workerName,
      startClientX: event.clientX,
      currentSelection: initialSelection,
    };
    updateSelectionPreview(trackEl, initialSelection);
  }

  function handlePointerMove(event) {
    if (!dragState) return;

    const slots = resolveSlots();
    dragState.currentSelection = annotateOverlap(
      dragState.trackEl,
      computeSelectionFromClientX(dragState.trackEl, slots, dragState.startClientX, event.clientX)
    );

    updateSelectionPreview(dragState.trackEl, dragState.currentSelection);
  }

  // Drag released: hand the finished selection to the reason modal. The modal's
  // returned `{ write }` owns the actual createSegment write; a null result means
  // the user cancelled. Overlap is re-checked just before the write (board state
  // may have changed while the pop-up was open).
  async function handlePointerUp() {
    if (!dragState) return;

    const finished = dragState;
    clearSelectionPreview(finished.trackEl);
    dragState = null;

    const selection = finished.currentSelection;
    if (!selection || selection.allocationDays <= 0 || selection.hasOverlap) {
      return;
    }
    if (typeof openReasonModal !== "function") return;

    const chosen = await openReasonModal({
      ownerEmail: finished.trackEl.dataset.ownerEmail || "",
      startAt: new Date(selection.startDate),
      endAt: new Date(selection.endDate),
    });
    if (!chosen) return; // cancelled — nothing written

    // Overlap re-check just before write (state may have changed).
    const rechecked = annotateOverlap(finished.trackEl, selection);
    if (rechecked.hasOverlap) return;

    await persistWrite(() => chosen.write()); // chosen.write() calls createSegment
  }

  function handlePointerUpSafe(event) {
    handlePointerUp(event).catch((error) => {
      console.error("Erreur pointerup Time-Out :", error);
    });
  }

  function handleContextMenuEvent(event) {
    if (!(event.target instanceof Element)) return;

    const segmentEl = event.target.closest(SEGMENT_BAR_SELECTOR);
    if (!(segmentEl instanceof HTMLElement)) {
      hideContextMenu(boardEl);
      return;
    }

    event.preventDefault();

    // Ownership gate: only the bar owner (or an admin) gets the context menu.
    const trackEl = segmentEl.closest(TRACK_SELECTOR);
    const ownerEmail = trackEl instanceof HTMLElement ? trackEl.dataset.ownerEmail || "" : "";
    if (typeof canEditTrack === "function" && !canEditTrack(ownerEmail)) {
      hideContextMenu(boardEl);
      return;
    }

    const segmentId = segmentEl.dataset.segmentId;
    if (!segmentId) {
      hideContextMenu(boardEl);
      return;
    }

    showContextMenu(boardEl, { clientX: event.clientX, clientY: event.clientY, segmentId });
  }

  // Finds the rendered `.charge-plan-segment-bar` for a given segment id (its data-*
  // attributes carry the segment's start/end/type used to seed the edit modal).
  function findSegmentBar(segmentId) {
    if (segmentId == null || segmentId === "") return null;
    const barEls = boardEl.querySelectorAll(SEGMENT_BAR_SELECTOR);
    for (const barEl of barEls) {
      if (String(barEl.dataset.segmentId) === String(segmentId)) return barEl;
    }
    return null;
  }

  // Opens the edit/delete modal seeded from the bar's data-* attributes. The
  // checkOverlap closure reuses trackHasOverlap against the segment's OWN track,
  // excluding the edited segment (Task 14). On a written change, refresh the board.
  async function handleModifySegment(barEl, trackEl, segmentId) {
    const startAtMs = Number(barEl.dataset.startAtMs);
    const endAtMs = Number(barEl.dataset.endAtMs);
    const startAt = Number.isFinite(startAtMs) ? new Date(startAtMs) : null;
    const endAt = Number.isFinite(endAtMs) ? new Date(endAtMs) : null;
    const type = barEl.dataset.leaveType || "";

    const changed = await openEditModal({
      segmentId,
      startAt,
      endAt,
      type,
      checkOverlap: (nextStartAt, nextEndAt) =>
        trackHasOverlap(
          trackEl,
          { startDate: nextStartAt.toISOString(), endDate: nextEndAt.toISOString() },
          { ignoreSegmentId: segmentId }
        ),
    });

    if (changed && typeof onChanged === "function") {
      await onChanged();
    }
  }

  // Context-menu action dispatch (Task 13): Modifier -> edit modal, Supprimer ->
  // removeSegment via persistWrite. Both re-check ownership (defense in depth; the
  // menu was already gated on show). The action's segmentId must be read BEFORE
  // hideContextMenu(), which clears the actions' data-segment-id.
  function handleContextAction(event) {
    if (!(event.target instanceof Element)) return;

    const actionEl = event.target.closest(CONTEXT_ACTION_SELECTOR);
    if (!(actionEl instanceof HTMLElement)) return;

    event.preventDefault();

    const action = actionEl.dataset.action || "";
    const segmentId = actionEl.dataset.segmentId || "";
    const barEl = findSegmentBar(segmentId);
    const trackEl = barEl instanceof HTMLElement ? barEl.closest(TRACK_SELECTOR) : null;

    hideContextMenu(boardEl);
    if (!segmentId) return;

    const ownerEmail = trackEl instanceof HTMLElement ? trackEl.dataset.ownerEmail || "" : "";
    if (typeof canEditTrack === "function" && !canEditTrack(ownerEmail)) return;

    if (action === "delete-segment") {
      void persistWrite(() => removeSegment(segmentId));
      return;
    }

    if (action === "edit-segment") {
      if (typeof openEditModal !== "function" || !(barEl instanceof HTMLElement)) return;
      handleModifySegment(barEl, trackEl, segmentId).catch((error) => {
        console.error("Erreur modification absence (menu) :", error);
      });
    }
  }

  function handleDocumentClick(event) {
    if (!(event.target instanceof Element)) {
      hideContextMenu(boardEl);
      return;
    }
    if (event.target.closest(CONTEXT_MENU_SELECTOR)) return;
    hideContextMenu(boardEl);
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    cancelDrag();
    hideContextMenu(boardEl);
  }

  boardEl.addEventListener("pointerdown", handlePointerDown);
  boardEl.addEventListener("contextmenu", handleContextMenuEvent);
  boardEl.addEventListener("click", handleContextAction);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUpSafe);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleKeyDown);

  applyEditModeToDom();

  function detach() {
    boardEl.removeEventListener("pointerdown", handlePointerDown);
    boardEl.removeEventListener("contextmenu", handleContextMenuEvent);
    boardEl.removeEventListener("click", handleContextAction);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUpSafe);
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleKeyDown);
    dragState = null;
  }

  return { detach };
}
