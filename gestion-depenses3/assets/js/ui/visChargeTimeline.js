import {
  clearChargePlanSelectionPreview,
  clearChargePlanTimeline,
  clearRealChargeTimeline,
  computeChargePlanSelection,
  computeChargePlanSelectionFromSlotIndexes,
  getChargePlanSlotIndexAtClientX,
  hideChargePlanContextMenu,
  hideChargePlanDatePicker,
  renderChargePlanTimeline,
  renderRealChargeTimeline,
  setChargePlanFeedback,
  showChargePlanContextMenu,
  showChargePlanDatePicker,
  updateChargePlanSelectionPreview,
} from "./chargeTimeline.js";

export {
  clearChargePlanSelectionPreview,
  clearChargePlanTimeline,
  clearRealChargeTimeline,
  computeChargePlanSelection,
  computeChargePlanSelectionFromSlotIndexes,
  getChargePlanSlotIndexAtClientX,
  hideChargePlanContextMenu,
  hideChargePlanDatePicker,
  renderChargePlanTimeline,
  renderRealChargeTimeline,
  setChargePlanFeedback,
  showChargePlanContextMenu,
  showChargePlanDatePicker,
  updateChargePlanSelectionPreview,
};

export function setChargePlanTimelineCallbacks() {
  // No-op while gestion-depenses3 relies on the historique DOM renderer.
}

export function getChargePlanTimelineViewport() {
  return null;
}

export function applyChargePlanTimelineViewport() {
  return false;
}

export function nudgeChargePlanTimelineViewport() {
  return false;
}
