// Charge-plan editing interactions — Editer mode, drag-create / resize / delete
// writes to TimeSegment. Ported/adapted from
// `gestion-depenses2/assets/js/ui/chargeTimeline.js` (getSlotIndexFromClientX,
// buildSelectionFromSlots, computeChargePlanSelection,
// computeChargePlanSelectionFromSlotIndexes, updateChargePlanSelectionPreview,
// clearChargePlanSelectionPreview, showChargePlanContextMenu,
// hideChargePlanContextMenu, setChargePlanFeedback) and the previsionnel
// charge-board interaction wiring in `gestion-depenses2/assets/js/main.js`
// (handleChargePlanEditModeToggle, handleChargePlanPointerDown/Move/Up,
// handleChargePlanContextMenu, handleChargePlanContextAction,
// createChargePlanSegment, resizeChargePlanSegment /
// updateChargePlanSegmentSelection, deleteChargePlanSegment).
//
// KEY ADAPTATIONS vs the source (see task-12 brief):
// 1. Slots come from the passed `getVisibleSlots()` accessor (Task 11's
//    `createChargeBoard().getVisibleSlots()`) instead of the source's internal
//    `activeVisibleSlotsByBoard` WeakMap keyed by board element.
// 2. Task 11's rendered DOM keys tracks/bars by `data-worker-name` (workers here
//    are grouped-by-name TimeSegment rows with no stable numeric id), not the
//    source's `data-worker-id` — create reads the worker name straight off
//    `trackEl.dataset.workerName`; resize/delete/edit key off
//    `segmentEl.dataset.segmentId`.
// 3. No local optimistic segment cache (the source mutates `state.projects[...]`
//    directly for instant UI feedback, then reconciles with the Grist
//    response). This widget has no such client-side project/segment cache to
//    mutate, so every write is a plain CRUD call followed by `await
//    onChanged()` (a full re-fetch + re-render) — simpler, at the cost of a
//    brief round-trip latency instead of the source's instant optimistic row.
// 4. Overlap detection reads `data-start-at-ms`/`data-end-at-ms` directly off
//    the sibling `.charge-plan-segment-bar` elements already rendered in the
//    target track (Task 11 emits those attributes per bar) instead of the
//    source's `selectionOverlapsWorkerSegments` scanning an in-memory
//    `worker.segments` array — same overlap math (`selectionStart < segEnd &&
//    selectionEnd > segStart`), just DOM-sourced since this module keeps no
//    worker/segment model of its own.
// 5. No pan/zoom/date-picker chrome: Task 11's board renders none of that
//    (only the Editer toggle, tracks, segment bars, selection preview and
//    context menu exist), so only the create/resize/delete/edit-mode wiring
//    is ported.
// 6. `is-segment-editing-enabled`/`-locked` and the toggle button's
//    label/`aria-pressed` are re-applied after every write
//    (`applyEditModeToDom()`), because `onChanged()` triggers a full
//    `board.render()` that replaces `boardEl.innerHTML` (wiping whatever this
//    module set). The source never hits this because its
//    `renderChargePlanTimeline` is itself driven by state that already
//    carries `chargePlanSegmentEditModeEnabled`. Here, `editModeEnabled` is
//    tracked locally in this module's closure (seeded once from
//    `boardEl.classList.contains("is-segment-editing-enabled")` at attach
//    time) and stays "sticky" across writes so the user doesn't fall back to
//    Verrouiller after every create/resize/delete.
// 7. "Modifier" (the `edit-segment` context action) opens the same edit-segment
//    modal as the source: `#ps-edit-segment-modal` (bottom/editSegmentModal.js,
//    a port of gestion-depenses2's #edit-segment-modal). The modal element lives
//    OUTSIDE `boardEl` (a body-level sibling of #ps-charge) so it survives the
//    `boardEl.innerHTML` re-render an `onChanged()` write triggers. The modal
//    only builds/validates the new range + Effectif; the overlap check and the
//    `updateTimeSegment({ segmentId, startDate, endDate, allocationDays,
//    effectif })` write happen here in `handleEditSegmentSubmit` (this module
//    owns the track DOM the overlap check reads). The Modifier action degrades to
//    a `window.prompt()` Effectif-only fallback if no modal element is provided.
//
// DOM/event module: window/document/HTMLElement are only referenced inside
// `attachChargeEditing()`'s closures (never at module top level or inside the
// exported pure function), so `buildSelectionFromSlotIndexes` (the pure
// half-day-slot selection math) imports and runs cleanly under Node — see
// tests/chargeSelection.test.mjs. `attachChargeEditing()` itself is
// browser-only, verified here by `node --check` + structural read-through;
// interactive pointer/click behavior is browser-verified once Task 14 wires
// main.js (dev harness needs the controller to mount this module).

import { clamp, formatNumber } from "../utils/format.js";
import { createTimeSegment, updateTimeSegment, removeTimeSegment } from "../services/gristService.js";
import { createEditSegmentModal } from "./editSegmentModal.js";

function cssEscapeValue(value) {
  const text = String(value);
  if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(text);
  }
  // Minimal fallback for the ids we emit (digits or `s-N`): escape quotes/backslashes.
  return text.replace(/["\\]/g, "\\$&");
}

const EDIT_TOGGLE_SELECTOR = "[data-charge-plan-edit-toggle]";
const TRACK_SELECTOR = ".charge-plan-track";
const SEGMENT_BAR_SELECTOR = ".charge-plan-segment-bar";
const SEGMENT_HANDLE_SELECTOR = ".charge-plan-segment-handle";
const CONTEXT_MENU_SELECTOR = ".charge-plan-context-menu";
const CONTEXT_ACTION_SELECTOR = ".charge-plan-context-action";

function formatDayValue(value) {
  const formatted = formatNumber(value);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

// --- pure half-day slot selection math (port of buildSelectionFromSlots) ------

// Builds a selection { startDate, endDate, allocationDays, leftPx, widthPx,
// startSlotIndex, endSlotIndex } spanning [firstSlotIndex..lastSlotIndex]
// (inclusive, order-independent) out of a flat slots array (Task 11's
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

function trackHasOverlap(trackEl, selection, { ignoreSegmentId } = {}) {
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

// attachChargeEditing(boardEl, { getProjectNumber, getVisibleSlots, onChanged })
//   → { detach() }
//
// Wires the Editer toggle, drag-to-create, handle-resize and the
// Modifier/Supprimer context menu onto `boardEl` (Task 11's charge-board
// container). All listeners are delegated on `boardEl`/window/document (never
// on inner elements), so they survive `boardEl.innerHTML` being replaced by a
// subsequent `chargeBoard.render()` call triggered from `onChanged()`.
export function attachChargeEditing(
  boardEl,
  { getProjectNumber, getVisibleSlots, onChanged, editSegmentModalEl, getAbsenceSet } = {}
) {
  if (!(boardEl instanceof HTMLElement)) {
    return { detach() {} };
  }

  let editModeEnabled = boardEl.classList.contains("is-segment-editing-enabled");
  let dragState = null;

  // "Modifier" modal (same window/functionality as gestion-depenses2). Its
  // element is a body-level sibling of the board, so it is not wiped by the
  // board's re-render. `onSubmit` runs the overlap check against THIS module's
  // track DOM, then persists via updateTimeSegment + onChanged().
  const editSegmentModal =
    editSegmentModalEl instanceof HTMLElement
      ? createEditSegmentModal(editSegmentModalEl, { onSubmit: handleEditSegmentSubmit })
      : null;

  function findSegmentBar(segmentId) {
    return boardEl.querySelector(
      `${SEGMENT_BAR_SELECTOR}[data-segment-id="${cssEscapeValue(segmentId)}"]`
    );
  }

  function resolveSlots() {
    const slots = typeof getVisibleSlots === "function" ? getVisibleSlots() : [];
    return Array.isArray(slots) ? slots : [];
  }

  function applyEditModeToDom() {
    boardEl.classList.toggle("is-segment-editing-enabled", editModeEnabled);
    boardEl.classList.toggle("is-segment-editing-locked", !editModeEnabled);
    boardEl.dataset.segmentEditMode = editModeEnabled ? "enabled" : "locked";

    const toggleEl = boardEl.querySelector(EDIT_TOGGLE_SELECTOR);
    if (toggleEl instanceof HTMLElement) {
      toggleEl.textContent = editModeEnabled ? "Verrouiller" : "Editer";
      toggleEl.classList.toggle("is-active", editModeEnabled);
      toggleEl.setAttribute("aria-pressed", editModeEnabled ? "true" : "false");
    }
  }

  function cancelDrag() {
    if (!dragState) return;
    if (dragState.segmentEl instanceof HTMLElement) {
      dragState.segmentEl.classList.remove("is-resizing");
    }
    clearSelectionPreview(dragState.trackEl);
    dragState = null;
  }

  // Runs a CRUD write, refreshes the board via onChanged(), then re-asserts
  // this module's edit-mode UI (see adaptation #6 above) regardless of
  // success/failure so the toggle never silently reverts.
  async function persistWrite(writeFn) {
    try {
      await writeFn();
      if (typeof onChanged === "function") {
        await onChanged();
      }
    } catch (error) {
      console.error("Erreur ecriture TimeSegment (plan de charge) :", error);
    } finally {
      applyEditModeToDom();
    }
  }

  function handleToggleClick(event) {
    const target = event.target instanceof Element ? event.target.closest(EDIT_TOGGLE_SELECTOR) : null;
    if (!(target instanceof HTMLElement)) return;

    event.preventDefault();
    editModeEnabled = !editModeEnabled;
    applyEditModeToDom();
    if (!editModeEnabled) {
      cancelDrag();
      hideContextMenu(boardEl);
    }
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(CONTEXT_MENU_SELECTOR)) return;

    hideContextMenu(boardEl);
    if (!editModeEnabled) return; // gate: no create/resize while locked

    const trackEl = event.target.closest(TRACK_SELECTOR);
    if (!(trackEl instanceof HTMLElement)) return;

    const segmentEl = event.target.closest(SEGMENT_BAR_SELECTOR);
    const handleEl = event.target.closest(SEGMENT_HANDLE_SELECTOR);

    if (segmentEl instanceof HTMLElement && handleEl instanceof HTMLElement) {
      const segmentId = segmentEl.dataset.segmentId;
      const startSlotIndex = Number(segmentEl.dataset.startSlotIndex);
      const endSlotIndex = Number(segmentEl.dataset.endSlotIndex);
      const edge = handleEl.dataset.resizeEdge;

      if (
        !segmentId ||
        !Number.isInteger(startSlotIndex) ||
        !Number.isInteger(endSlotIndex) ||
        (edge !== "start" && edge !== "end")
      ) {
        return;
      }

      event.preventDefault();
      const slots = resolveSlots();
      const initialSelection = annotateOverlap(
        trackEl,
        buildSelectionFromSlotIndexes(slots, startSlotIndex, endSlotIndex),
        { ignoreSegmentId: segmentId }
      );

      segmentEl.classList.add("is-resizing");
      dragState = {
        mode: "resize",
        trackEl,
        segmentEl,
        segmentId,
        edge,
        fixedSlotIndex: edge === "start" ? endSlotIndex : startSlotIndex,
        currentSelection: initialSelection,
      };
      updateSelectionPreview(trackEl, initialSelection);
      return;
    }

    if (segmentEl instanceof HTMLElement) {
      // Clicked the bar body (not a resize handle): resize is handle-only,
      // and whole-segment relocation-by-drag is out of scope for this task.
      return;
    }

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

    if (dragState.mode === "resize") {
      const movingSlotIndex = getSlotIndexAtClientX(dragState.trackEl, slots, event.clientX);
      if (movingSlotIndex < 0) return;

      const startSlotIndex =
        dragState.edge === "start"
          ? Math.min(movingSlotIndex, dragState.fixedSlotIndex)
          : dragState.fixedSlotIndex;
      const endSlotIndex =
        dragState.edge === "end"
          ? Math.max(movingSlotIndex, dragState.fixedSlotIndex)
          : dragState.fixedSlotIndex;

      dragState.currentSelection = annotateOverlap(
        dragState.trackEl,
        buildSelectionFromSlotIndexes(slots, startSlotIndex, endSlotIndex),
        { ignoreSegmentId: dragState.segmentId }
      );
    } else {
      dragState.currentSelection = annotateOverlap(
        dragState.trackEl,
        computeSelectionFromClientX(dragState.trackEl, slots, dragState.startClientX, event.clientX)
      );
    }

    updateSelectionPreview(dragState.trackEl, dragState.currentSelection);
  }

  async function handlePointerUp() {
    if (!dragState) return;

    const finished = dragState;
    if (finished.segmentEl instanceof HTMLElement) {
      finished.segmentEl.classList.remove("is-resizing");
    }
    clearSelectionPreview(finished.trackEl);
    dragState = null;

    const selection = finished.currentSelection;
    if (!selection || selection.allocationDays <= 0 || selection.hasOverlap) {
      return;
    }

    if (finished.mode === "resize") {
      await persistWrite(() => {
        const patch = { segmentId: finished.segmentId, allocationDays: selection.allocationDays };
        if (finished.edge === "start") {
          patch.startDate = selection.startDate;
        } else {
          patch.endDate = selection.endDate;
        }
        return updateTimeSegment(patch);
      });
      return;
    }

    await persistWrite(() =>
      createTimeSegment({
        projectNumber: typeof getProjectNumber === "function" ? getProjectNumber() : undefined,
        name: finished.workerName,
        startDate: selection.startDate,
        endDate: selection.endDate,
        allocationDays: selection.allocationDays,
      })
    );
  }

  function handlePointerUpSafe(event) {
    handlePointerUp(event).catch((error) => {
      console.error("Erreur pointerup plan de charge :", error);
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
    if (!editModeEnabled) {
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

  // "Modifier": open the edit-segment modal seeded from the clicked bar's
  // dataset (start/end from data-*-at-ms, current Effectif from data-effectif).
  // If no modal element was provided, fall back to the minimal Effectif-only
  // window.prompt() (legacy behaviour).
  function handleModifySegment(segmentId) {
    const barEl = findSegmentBar(segmentId);
    if (!(barEl instanceof HTMLElement)) return;

    if (!editSegmentModal) {
      void handleModifySegmentPrompt(segmentId);
      return;
    }

    const startAtMs = Number(barEl.dataset.startAtMs);
    const endAtMs = Number(barEl.dataset.endAtMs);
    if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) return;

    // Leave-aware readout: pass the edited segment's OWNER absence set so the
    // modal can subtract absence half-days from "jours disponibles" and flag an
    // over-available Effectif in red (non-blocking). Worker name comes off the
    // owning track's dataset (Task 11 emits data-worker-name per track).
    const trackEl = barEl.closest(TRACK_SELECTOR);
    const workerName = trackEl instanceof HTMLElement ? trackEl.dataset.workerName || "" : "";
    const absenceSet =
      typeof getAbsenceSet === "function" ? getAbsenceSet(workerName) : undefined;

    editSegmentModal.open({
      segmentId,
      startAt: new Date(startAtMs),
      endAt: new Date(endAtMs),
      effectif: barEl.dataset.effectif ?? "",
      absenceSet,
    });
  }

  // Called by the modal on Enregistrer with an already-internally-valid range +
  // Effectif. Rejects overlaps against the segment's own track (DOM-sourced,
  // ignoring the edited bar), then writes and refreshes. Returns { ok, error }.
  async function handleEditSegmentSubmit({ segmentId, selection }) {
    if (!editModeEnabled) {
      return { ok: false, error: "Cliquez sur Editer pour modifier le planning." };
    }

    const barEl = findSegmentBar(segmentId);
    const trackEl = barEl instanceof HTMLElement ? barEl.closest(TRACK_SELECTOR) : null;
    const annotated = annotateOverlap(
      trackEl,
      { startDate: selection.startDate, endDate: selection.endDate },
      { ignoreSegmentId: segmentId }
    );
    if (annotated?.hasOverlap) {
      return {
        ok: false,
        error:
          "Impossible de definir un segment qui chevauche deja une autre barre pour cette personne.",
      };
    }

    let writeError = null;
    await persistWrite(async () => {
      try {
        await updateTimeSegment({
          segmentId,
          startDate: selection.startDate,
          endDate: selection.endDate,
          allocationDays: selection.totalDays,
          effectif: selection.effectifValueForSave,
        });
      } catch (error) {
        writeError = error;
        throw error;
      }
    });

    if (writeError) {
      return { ok: false, error: "La mise a jour du segment a echoue." };
    }
    return { ok: true };
  }

  // Legacy Effectif-only fallback (no modal element wired). Cancelling the
  // prompt (null) or leaving it blank is a no-op; a non-numeric/negative value
  // shows an alert and aborts without writing.
  async function handleModifySegmentPrompt(segmentId) {
    const input = window.prompt("Nouvel effectif pour ce segment :", "");
    if (input == null) return;

    const trimmed = input.trim();
    if (!trimmed) return;

    const effectif = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(effectif) || effectif < 0) {
      window.alert("Valeur d'effectif invalide.");
      return;
    }

    await persistWrite(() => updateTimeSegment({ segmentId, effectif }));
  }

  function handleContextAction(event) {
    if (!(event.target instanceof Element)) return;

    const actionEl = event.target.closest(CONTEXT_ACTION_SELECTOR);
    if (!(actionEl instanceof HTMLElement)) return;

    event.preventDefault();
    const menuEl = actionEl.closest(CONTEXT_MENU_SELECTOR);
    const segmentId = actionEl.dataset.segmentId || menuEl?.dataset.segmentId;
    const action = actionEl.dataset.action || "";
    hideContextMenu(boardEl);

    if (!segmentId || !editModeEnabled) return;

    if (action === "delete-segment") {
      void persistWrite(() => removeTimeSegment(segmentId));
      return;
    }

    if (action === "edit-segment") {
      void handleModifySegment(segmentId);
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

  boardEl.addEventListener("click", handleToggleClick);
  boardEl.addEventListener("pointerdown", handlePointerDown);
  boardEl.addEventListener("contextmenu", handleContextMenuEvent);
  boardEl.addEventListener("click", handleContextAction);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUpSafe);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleKeyDown);

  applyEditModeToDom();

  function detach() {
    boardEl.removeEventListener("click", handleToggleClick);
    boardEl.removeEventListener("pointerdown", handlePointerDown);
    boardEl.removeEventListener("contextmenu", handleContextMenuEvent);
    boardEl.removeEventListener("click", handleContextAction);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUpSafe);
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleKeyDown);
    if (editSegmentModal) editSegmentModal.destroy();
    dragState = null;
  }

  // Exposes the live edit-mode flag so main.js's onChanged() can re-render the
  // charge board with the CORRECT editMode instead of a hardcoded false: this
  // module's persistWrite().finally re-asserts the sticky edit mode
  // synchronously after a write, but a subsequent chargeBoard.render()/
  // setWindow() (triggered by onChanged + the controller's follow-up rAF)
  // would otherwise overwrite it back to locked using chargeBoard.lastEditMode.
  // Reading editModeEnabled here keeps ONE source of truth.
  function isEditModeEnabled() {
    return editModeEnabled;
  }

  return { detach, isEditModeEnabled };
}
