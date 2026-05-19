import { state } from "../app/state.js";
import {
  closePlanningWarningsPopup,
  showPlanningWarningsPopup,
} from "../layout/shell.js";

function normalizeWarningForSignature(warning = {}) {
  return {
    severity: String(warning?.severity || "").trim(),
    label: String(warning?.label || "").trim(),
    days: Number(warning?.days) || 0,
    segmentEndDate: String(warning?.segmentEndDate || "").trim(),
  };
}

function buildPlanningWarningsPopupSignature(projectKey = "", warnings = []) {
  return JSON.stringify({
    projectKey: String(projectKey || "").trim(),
    warnings: warnings.map(normalizeWarningForSignature),
  });
}

function getActivePlanningProjectKey(fallbackProjectKey = "") {
  return String(
    state.activeProjectKey ||
      state.requestedProjectKey ||
      fallbackProjectKey ||
      state.planningApi?.getSelectedProject?.() ||
      ""
  ).trim();
}

export function showCurrentPlanningWarningsPopup({ force = false } = {}) {
  const projectKey = getActivePlanningProjectKey();
  if (!projectKey) {
    closePlanningWarningsPopup();
    return false;
  }

  const warnings = Array.isArray(state.planningApi?.getWarnings?.())
    ? state.planningApi.getWarnings().filter(Boolean)
    : [];

  if (!warnings.length) {
    closePlanningWarningsPopup();
    state.lastPlanningWarningsPopupSignature = "";
    return false;
  }

  const popupSignature = buildPlanningWarningsPopupSignature(projectKey, warnings);
  if (!force && popupSignature === state.lastPlanningWarningsPopupSignature) {
    return false;
  }

  state.lastPlanningWarningsPopupSignature = popupSignature;
  showPlanningWarningsPopup(projectKey, warnings);
  return true;
}

export function handlePlanningWarningsChange(payload = {}) {
  const payloadProjectKey = String(payload?.projectKey || "").trim();
  const expectedProjectKey = String(
    state.requestedProjectKey ||
      state.activeProjectKey ||
      state.planningApi?.getSelectedProject?.() ||
      payloadProjectKey ||
      ""
  ).trim();

  if (
    payloadProjectKey &&
    expectedProjectKey &&
    payloadProjectKey !== expectedProjectKey
  ) {
    return false;
  }

  const projectKey = expectedProjectKey || payloadProjectKey;
  if (!projectKey) {
    closePlanningWarningsPopup();
    return false;
  }

  const warnings = Array.isArray(payload?.warnings) ? payload.warnings.filter(Boolean) : [];
  if (!warnings.length) {
    closePlanningWarningsPopup();
    state.lastPlanningWarningsPopupSignature = "";
    return false;
  }

  const popupSignature = buildPlanningWarningsPopupSignature(projectKey, warnings);
  if (popupSignature === state.lastPlanningWarningsPopupSignature) {
    return false;
  }

  state.lastPlanningWarningsPopupSignature = popupSignature;
  showPlanningWarningsPopup(projectKey, warnings);
  return true;
}
