// Edit-segment modal ("Modifier le segment") for planning-synchro's charge
// board — a faithful port of gestion-depenses2's #edit-segment-modal: pick a new
// half-day-precise range (Debut / Fin date + Matin / Apres-midi) and an optional
// "jours effectifs travailles" value, with a live "jours disponibles dans la
// plage" readout, then Enregistrer.
//
// Ported/adapted from gestion-depenses2/assets/js/main.js
// (getSegmentHalfDayPart, buildSegmentHalfDayBoundary,
// buildChargePlanSelectionFromEditValues, syncEditChargePlanDerivedValues,
// normalizeOptionalEffectifDays, isHalfDayIncrement, formatEditSegmentInputValue,
// formatEditSegmentDayValue, openEditChargePlanModal, saveEditedChargePlanSegment)
// and index.html's #edit-segment-modal markup + styles.css's .segment-edit-* rules.
//
// KEY ADAPTATIONS vs the source:
// - No `state.projects` / `editingChargePlanSegment` model: the source resolves a
//   segmentContext from its in-memory project tree; this widget is DOM-driven, so
//   the caller (chargeEditing.js) hands `open()` the segment's id + start/end/
//   effectif read straight off the rendered `.charge-plan-segment-bar` dataset,
//   and the overlap check + Grist write happen back in chargeEditing's `onSubmit`
//   (which owns the track DOM). This module only builds/validates the selection.
// - The pure form -> selection / effectif-validation helpers are exported and
//   DOM-free (tested under node --test); `createEditSegmentModal()` is the
//   browser-only DOM controller (verified via the dev harness + CDP).

import { formatNumber, parseOptionalNumberInput } from "../utils/format.js";
import { getHalfDaySlotRange, getSegmentAllocationDays } from "../utils/timeSegments.js";

// --- pure helpers (no DOM) ---------------------------------------------------

// Which half-day a segment boundary falls on. `start` edges snap am when < noon;
// `end` edges snap am when <= noon (a segment ending at 12:00 is a morning end).
export function getSegmentHalfDayPart(date, edge = "start") {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "am";
  }
  const hours = date.getHours();
  if (edge === "end") {
    return hours <= 12 ? "am" : "pm";
  }
  return hours < 12 ? "am" : "pm";
}

// "YYYY-MM-DD" for a Date, in local time (matches an <input type="date"> value).
export function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Turns a date-input value ("YYYY-MM-DD") + half-day part into the exact
// start/end Date boundary of that half-day slot.
export function buildSegmentHalfDayBoundary(dateValue, part, edge = "start") {
  const normalizedDateValue = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateValue)) {
    return null;
  }
  const anchorDate = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(anchorDate.getTime())) {
    return null;
  }
  const slotRange = getHalfDaySlotRange(anchorDate, part);
  if (!slotRange) {
    return null;
  }
  return edge === "end" ? slotRange.endAt : slotRange.startAt;
}

// Builds { startDate, endDate, totalDays } (ISO strings + working half-day count)
// from the four form fields, or { error } describing the first problem found.
export function buildEditSegmentSelection({ startDateValue, startPart, endDateValue, endPart }) {
  const startAt = buildSegmentHalfDayBoundary(startDateValue, startPart, "start");
  const endAt = buildSegmentHalfDayBoundary(endDateValue, endPart, "end");

  if (!startAt || !endAt) {
    return { error: "Veuillez choisir une date de debut et une date de fin valides." };
  }
  if (endAt <= startAt) {
    return { error: "La fin doit etre strictement apres le debut." };
  }

  const totalDays = getSegmentAllocationDays({ startAt, endAt });
  if (totalDays <= 0) {
    return { error: "La plage choisie ne contient aucun demi-jour ouvrable." };
  }

  return {
    startDate: startAt.toISOString(),
    endDate: endAt.toISOString(),
    totalDays,
  };
}

function isHalfDayIncrement(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return false;
  }
  return Math.abs(numericValue * 2 - Math.round(numericValue * 2)) < 1e-9;
}

function normalizeOptionalEffectifDays(value) {
  if (value == null || value === "") {
    return null;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.max(0, numericValue);
}

// Validates the Effectif field against the selected range's total days. Returns
// { error } when invalid, otherwise { effectifDays, effectifValueForSave } where
// effectifValueForSave is "" (clear the field) or a number (matches
// updateTimeSegment's effectif contract).
export function validateEditSegmentEffectif(rawEffectifValue, totalDays) {
  const rawEffectifInput = parseOptionalNumberInput(rawEffectifValue);

  if (rawEffectifInput != null && rawEffectifInput < 0) {
    return { error: "Le nombre de jours effectifs ne peut pas etre negatif." };
  }
  if (rawEffectifInput != null && !isHalfDayIncrement(rawEffectifInput)) {
    return { error: "Le nombre de jours effectifs doit etre un entier ou un multiple de 0,5." };
  }
  if (rawEffectifInput != null && rawEffectifInput > totalDays) {
    return { error: "Le nombre de jours effectifs ne peut pas depasser le nombre de jours de la plage." };
  }

  const effectifDays = normalizeOptionalEffectifDays(rawEffectifInput);
  return {
    effectifDays,
    effectifValueForSave: effectifDays == null ? "" : effectifDays,
  };
}

function formatEditSegmentDayValue(value) {
  const formatted = formatNumber(value);
  return `${formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted} j`;
}

// Formats a stored effectif value for the number input (blank when unset, no
// trailing ".00"/zeros so e.g. 2 shows "2" and 1.5 shows "1.5").
export function formatEditSegmentInputValue(value) {
  if (value == null || value === "") {
    return "";
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return "";
  }
  return numericValue
    .toFixed(2)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

// --- DOM controller (browser-only) -------------------------------------------

// createEditSegmentModal(rootEl, { onSubmit }) -> { open, close, isOpen, destroy }
//
// `onSubmit({ segmentId, selection })` is called on Enregistrer once the form is
// internally valid; it may return (a Promise of) { ok: true } to close the modal,
// or { ok: false, error } to show `error` as feedback and keep the modal open.
// `selection` = { segmentId, startDate, endDate, totalDays, effectifDays,
// effectifValueForSave }.
export function createEditSegmentModal(rootEl, { onSubmit } = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    return { open() {}, close() {}, isOpen: () => false, destroy() {} };
  }

  const startDateInput = rootEl.querySelector("#ps-edit-segment-start-date");
  const startPartInput = rootEl.querySelector("#ps-edit-segment-start-part");
  const endDateInput = rootEl.querySelector("#ps-edit-segment-end-date");
  const endPartInput = rootEl.querySelector("#ps-edit-segment-end-part");
  const effectifInput = rootEl.querySelector("#ps-edit-segment-effectif");
  const calculatedEl = rootEl.querySelector("#ps-edit-segment-calculated-days");
  const feedbackEl = rootEl.querySelector("#ps-edit-segment-feedback");
  const saveBtn = rootEl.querySelector("#ps-edit-segment-save");
  const cancelBtn = rootEl.querySelector("#ps-edit-segment-cancel");

  let currentSegmentId = null;
  let submitting = false;

  function setFeedback(message) {
    if (!(feedbackEl instanceof HTMLElement)) return;
    const text = String(message || "").trim();
    feedbackEl.textContent = text;
    feedbackEl.hidden = !text;
  }

  function readSelection() {
    return buildEditSegmentSelection({
      startDateValue: startDateInput?.value,
      startPart: startPartInput?.value,
      endDateValue: endDateInput?.value,
      endPart: endPartInput?.value,
    });
  }

  function syncDerived() {
    const selection = readSelection();
    if (selection?.error) {
      if (effectifInput instanceof HTMLInputElement) {
        effectifInput.removeAttribute("max");
      }
      if (calculatedEl instanceof HTMLElement) calculatedEl.textContent = "--";
      return;
    }
    if (effectifInput instanceof HTMLInputElement) {
      effectifInput.max = String(selection.totalDays);
    }
    if (calculatedEl instanceof HTMLElement) {
      calculatedEl.textContent = formatEditSegmentDayValue(selection.totalDays);
    }
  }

  function open({ segmentId, startAt, endAt, effectif } = {}) {
    currentSegmentId = segmentId != null ? String(segmentId) : null;

    if (startDateInput instanceof HTMLInputElement) {
      startDateInput.value = toDateInputValue(startAt);
    }
    if (startPartInput instanceof HTMLSelectElement) {
      startPartInput.value = getSegmentHalfDayPart(startAt, "start");
    }
    if (endDateInput instanceof HTMLInputElement) {
      endDateInput.value = toDateInputValue(endAt);
    }
    if (endPartInput instanceof HTMLSelectElement) {
      endPartInput.value = getSegmentHalfDayPart(endAt, "end");
    }
    if (effectifInput instanceof HTMLInputElement) {
      effectifInput.value = formatEditSegmentInputValue(effectif);
    }

    syncDerived();
    setFeedback("");
    rootEl.style.display = "flex";
    rootEl.classList.add("is-open");
  }

  function close() {
    currentSegmentId = null;
    rootEl.style.display = "none";
    rootEl.classList.remove("is-open");
    setFeedback("");
  }

  function isOpen() {
    return rootEl.classList.contains("is-open");
  }

  async function handleSave() {
    if (currentSegmentId == null || submitting) return;

    const selection = readSelection();
    if (selection.error) {
      setFeedback(selection.error);
      return;
    }

    const effectifResult = validateEditSegmentEffectif(effectifInput?.value, selection.totalDays);
    if (effectifResult.error) {
      setFeedback(effectifResult.error);
      return;
    }

    if (typeof onSubmit !== "function") {
      close();
      return;
    }

    submitting = true;
    setFeedback("");
    try {
      const result = await onSubmit({
        segmentId: currentSegmentId,
        selection: {
          segmentId: currentSegmentId,
          startDate: selection.startDate,
          endDate: selection.endDate,
          totalDays: selection.totalDays,
          effectifDays: effectifResult.effectifDays,
          effectifValueForSave: effectifResult.effectifValueForSave,
        },
      });
      if (result && result.ok === false) {
        setFeedback(result.error || "La mise a jour du segment a echoue.");
        return;
      }
      close();
    } catch (error) {
      console.error("Erreur enregistrement segment (modale) :", error);
      setFeedback("Une erreur est survenue pendant la modification du segment.");
    } finally {
      submitting = false;
    }
  }

  function handleSaveClick(event) {
    event.preventDefault();
    void handleSave();
  }

  function handleCancelClick(event) {
    event.preventDefault();
    close();
  }

  function handleBackdropClick(event) {
    if (event.target === rootEl) {
      close();
    }
  }

  function handleFieldInput() {
    setFeedback("");
    syncDerived();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && isOpen()) {
      close();
    }
  }

  const fieldEls = [startDateInput, startPartInput, endDateInput, endPartInput, effectifInput];

  saveBtn?.addEventListener("click", handleSaveClick);
  cancelBtn?.addEventListener("click", handleCancelClick);
  rootEl.addEventListener("click", handleBackdropClick);
  fieldEls.forEach((fieldEl) => {
    fieldEl?.addEventListener("input", handleFieldInput);
    fieldEl?.addEventListener("change", handleFieldInput);
  });
  document.addEventListener("keydown", handleKeyDown);

  function destroy() {
    close();
    saveBtn?.removeEventListener("click", handleSaveClick);
    cancelBtn?.removeEventListener("click", handleCancelClick);
    rootEl.removeEventListener("click", handleBackdropClick);
    fieldEls.forEach((fieldEl) => {
      fieldEl?.removeEventListener("input", handleFieldInput);
      fieldEl?.removeEventListener("change", handleFieldInput);
    });
    document.removeEventListener("keydown", handleKeyDown);
  }

  return { open, close, isOpen, destroy };
}
