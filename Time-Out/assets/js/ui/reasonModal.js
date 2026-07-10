// Time-Out/assets/js/ui/reasonModal.js
// Reason pop-up (4 leave types) shown at drag-create. Its `open({ownerEmail,
// startAt, endAt})` resolves to `{ type, write }` (or null on cancel); `write()`
// owns the actual createSegment call so the editing layer stays write-agnostic.
import { LEAVE_TYPES } from "../config.js";
import { datesToSegmentText } from "../utils/textSegments.js";
import { createSegment } from "../services/gristService.js";

export function buildLeaveWritePayload(ownerEmail, startAt, endAt, type) {
  const text = datesToSegmentText(startAt, endAt);
  return { owner: ownerEmail, startDate: text.startDate, startPeriod: text.startPeriod, endDate: text.endDate, endPeriod: text.endPeriod, type };
}

export function createReasonModal(rootEl) {
  rootEl.innerHTML = `
    <div class="to-modal-content">
      <h2>Motif de l'absence</h2>
      <div class="to-reason-buttons">
        ${LEAVE_TYPES.map((t) => `<button type="button" class="to-reason-btn" data-type="${t.label}" style="--c:${t.color}">${t.label}</button>`).join("")}
      </div>
      <button type="button" class="to-reason-cancel">Annuler</button>
    </div>`;
  let resolver = null;
  // Hides the modal and resolves the pending open() promise exactly once (nulling
  // resolver first guards against a double-resolve from overlapping dismiss paths —
  // button + backdrop + Escape), matching editModal.js's settle().
  function close(result) { const r = resolver; resolver = null; rootEl.style.display = "none"; if (r) r(result); }
  rootEl.querySelectorAll(".to-reason-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      close({ type, write: () => createSegment(buildLeaveWritePayload(currentCtx.ownerEmail, currentCtx.startAt, currentCtx.endAt, type)) });
    });
  });
  rootEl.querySelector(".to-reason-cancel").addEventListener("click", () => close(null));
  // Cancel (resolve null) on backdrop click or Escape, like editModal.js. The
  // resolver guard makes Escape a no-op when the modal is closed.
  rootEl.addEventListener("click", (event) => { if (event.target === rootEl) close(null); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && resolver) close(null); });
  let currentCtx = null;
  return {
    open(ctx) {
      currentCtx = ctx;
      rootEl.style.display = "flex";
      return new Promise((resolve) => { resolver = resolve; });
    },
  };
}
