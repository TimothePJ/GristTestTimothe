// Time-Out/assets/js/ui/editModal.js
// Edit/delete modal for an existing leave segment. Mirrors
// `planning-synchro/assets/js/bottom/editSegmentModal.js`, simplified for the
// leave planner: a Type <select> (the 4 LEAVE_TYPES labels) replaces the source's
// "Effectif" field, and the write goes straight through gristService's
// updateSegment / removeSegment (all-Text CRUD) instead of the source's
// caller-owned onSubmit.
//
// createEditModal(rootEl) -> { open({ segmentId, startAt, endAt, type,
//   checkOverlap }) -> Promise<boolean> } where the promise resolves TRUE when a
// change was written (save or delete) and FALSE when the user closed the modal
// (Fermer / backdrop / Escape) with no write.
//
// The optional `checkOverlap(startAt, endAt) -> boolean` callback (passed in by
// editing.js, which owns the track DOM) is consulted on save BEFORE writing: if it
// returns true the modal stays open with an error and nothing is written (Task 14
// edit-path overlap guard).
//
// Pure/DOM split (same discipline as reasonModal.js / editSegmentModal.js):
// `buildEditPayload` is DOM-free and unit-tested (tests/editModal.test.mjs);
// `createEditModal` is the browser-only controller (document/HTMLElement only
// touched inside its body), so importing `buildEditPayload` runs cleanly in Node.

import { LEAVE_TYPES } from "../config.js";
import { segmentToDates, datesToSegmentText } from "../utils/textSegments.js";
import { updateSegment, removeSegment } from "../services/gristService.js";

// --- pure helper (no DOM) ----------------------------------------------------

// Builds the Grist update payload from the modal's raw form values. Rebuilds the
// boundary Dates from each date-input value ("YYYY-MM-DD") + AM/PM period using the
// half-day hour rules (AM 08:00->12:00, PM 13:00->17:00) via segmentToDates,
// validates endAt > startAt, then maps the boundaries back to text fields via
// datesToSegmentText. Returns { error } on invalid/empty input or an inverted
// range; otherwise { segmentId, startAt, endAt, patch } where `patch` is the
// updateSegment field set { startDate, startPeriod, endDate, endPeriod, type }.
export function buildEditPayload({ segmentId, startDate, startPeriod, endDate, endPeriod, type } = {}) {
  const dates = segmentToDates({ startDate, startPeriod, endDate, endPeriod });
  if (!dates) {
    return { error: "Veuillez choisir une date de début et une date de fin valides." };
  }
  if (dates.endAt <= dates.startAt) {
    return { error: "La fin doit être strictement après le début." };
  }
  const text = datesToSegmentText(dates.startAt, dates.endAt);
  return {
    segmentId,
    startAt: dates.startAt,
    endAt: dates.endAt,
    patch: {
      startDate: text.startDate,
      startPeriod: text.startPeriod,
      endDate: text.endDate,
      endPeriod: text.endPeriod,
      type,
    },
  };
}

// --- DOM controller (browser-only) -------------------------------------------

export function createEditModal(rootEl) {
  if (!(rootEl instanceof HTMLElement)) {
    return { open() { return Promise.resolve(false); } };
  }

  const periodOptions = `
    <option value="AM">Matin</option>
    <option value="PM">Après-midi</option>
  `;
  const typeOptions = LEAVE_TYPES.map(
    (t) => `<option value="${t.label}">${t.label}</option>`
  ).join("");

  rootEl.innerHTML = `
    <div class="to-modal-content to-edit-content">
      <h2>Modifier l'absence</h2>
      <div class="to-edit-grid">
        <label class="to-edit-field">
          <span>Début</span>
          <input type="date" class="to-edit-start-date" />
        </label>
        <label class="to-edit-field">
          <span>Demi-journée</span>
          <select class="to-edit-start-period">${periodOptions}</select>
        </label>
        <label class="to-edit-field">
          <span>Fin</span>
          <input type="date" class="to-edit-end-date" />
        </label>
        <label class="to-edit-field">
          <span>Demi-journée</span>
          <select class="to-edit-end-period">${periodOptions}</select>
        </label>
        <label class="to-edit-field to-edit-field--type">
          <span>Type</span>
          <select class="to-edit-type">${typeOptions}</select>
        </label>
      </div>
      <p class="to-edit-feedback" hidden></p>
      <div class="to-edit-footer">
        <button type="button" class="to-edit-delete">Supprimer</button>
        <button type="button" class="to-edit-close">Fermer</button>
        <button type="button" class="to-edit-save">Enregistrer</button>
      </div>
    </div>`;

  const startDateEl = rootEl.querySelector(".to-edit-start-date");
  const startPeriodEl = rootEl.querySelector(".to-edit-start-period");
  const endDateEl = rootEl.querySelector(".to-edit-end-date");
  const endPeriodEl = rootEl.querySelector(".to-edit-end-period");
  const typeEl = rootEl.querySelector(".to-edit-type");
  const feedbackEl = rootEl.querySelector(".to-edit-feedback");
  const saveBtn = rootEl.querySelector(".to-edit-save");
  const deleteBtn = rootEl.querySelector(".to-edit-delete");
  const closeBtn = rootEl.querySelector(".to-edit-close");

  let resolver = null;
  let currentSegmentId = null;
  let currentCheckOverlap = null;
  let submitting = false;

  function isOpen() {
    return resolver != null;
  }

  function setFeedback(message) {
    const text = String(message || "").trim();
    feedbackEl.textContent = text;
    feedbackEl.hidden = !text;
  }

  // Hides the modal and resolves the pending open() promise with `result` exactly
  // once (guards against double-settle from overlapping close paths).
  function settle(result) {
    const r = resolver;
    resolver = null;
    currentSegmentId = null;
    currentCheckOverlap = null;
    submitting = false;
    rootEl.style.display = "none";
    setFeedback("");
    if (r) r(result);
  }

  async function handleSave() {
    if (currentSegmentId == null || submitting) return;

    const payload = buildEditPayload({
      segmentId: currentSegmentId,
      startDate: startDateEl.value,
      startPeriod: startPeriodEl.value,
      endDate: endDateEl.value,
      endPeriod: endPeriodEl.value,
      type: typeEl.value,
    });
    if (payload.error) {
      setFeedback(payload.error);
      return;
    }

    // Edit-path overlap guard (Task 14): block a range overlapping ANOTHER of this
    // person's bars (the edited segment is excluded by editing.js via ignoreSegmentId).
    if (typeof currentCheckOverlap === "function" && currentCheckOverlap(payload.startAt, payload.endAt)) {
      setFeedback("Ce créneau chevauche une autre absence de cette personne.");
      return;
    }

    submitting = true;
    setFeedback("");
    try {
      await updateSegment(currentSegmentId, payload.patch);
      settle(true);
    } catch (error) {
      console.error("Erreur mise à jour absence (modale) :", error);
      setFeedback("La mise à jour a échoué.");
      submitting = false;
    }
  }

  async function handleDelete() {
    if (currentSegmentId == null || submitting) return;

    submitting = true;
    setFeedback("");
    try {
      await removeSegment(currentSegmentId);
      settle(true);
    } catch (error) {
      console.error("Erreur suppression absence (modale) :", error);
      setFeedback("La suppression a échoué.");
      submitting = false;
    }
  }

  function handleSaveClick(event) {
    event.preventDefault();
    void handleSave();
  }
  function handleDeleteClick(event) {
    event.preventDefault();
    void handleDelete();
  }
  function handleCloseClick(event) {
    event.preventDefault();
    settle(false);
  }
  function handleBackdropClick(event) {
    if (event.target === rootEl) settle(false);
  }
  function handleKeyDown(event) {
    if (event.key === "Escape" && isOpen()) settle(false);
  }

  saveBtn.addEventListener("click", handleSaveClick);
  deleteBtn.addEventListener("click", handleDeleteClick);
  closeBtn.addEventListener("click", handleCloseClick);
  rootEl.addEventListener("click", handleBackdropClick);
  document.addEventListener("keydown", handleKeyDown);

  // Seeds the form from the segment's current Dates + type and shows the modal.
  // Reuses datesToSegmentText so the date-input values ("YYYY-MM-DD") and AM/PM
  // selects match the stored half-day boundaries exactly.
  function open({ segmentId, startAt, endAt, type, checkOverlap } = {}) {
    currentSegmentId = segmentId != null ? String(segmentId) : null;
    currentCheckOverlap = typeof checkOverlap === "function" ? checkOverlap : null;

    const seed = datesToSegmentText(startAt, endAt);
    startDateEl.value = seed ? seed.startDate : "";
    startPeriodEl.value = seed ? seed.startPeriod : "AM";
    endDateEl.value = seed ? seed.endDate : "";
    endPeriodEl.value = seed ? seed.endPeriod : "AM";
    typeEl.value = LEAVE_TYPES.some((t) => t.label === type) ? type : LEAVE_TYPES[0].label;

    setFeedback("");
    submitting = false;
    rootEl.style.display = "flex";
    return new Promise((resolve) => { resolver = resolve; });
  }

  return { open };
}
