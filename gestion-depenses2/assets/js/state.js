import { APP_CONFIG } from "./config.js";

function getNowState() {
  const now = new Date();
  return {
    selectedProjectId: null,
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    monthSpan: APP_CONFIG.defaultMonthSpan,
    chargePlanZoomMode: APP_CONFIG.defaultChargePlanZoomMode,
  };
}

function readPersistedState() {
  const fallback = getNowState();
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.getItem !== "function"
  ) {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(APP_CONFIG.storageKey);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    return {
      selectedProjectId:
        Number.isInteger(Number(parsed?.selectedProjectId))
          ? Number(parsed.selectedProjectId)
          : fallback.selectedProjectId,
      selectedYear:
        Number.isInteger(Number(parsed?.selectedYear))
          ? Number(parsed.selectedYear)
          : fallback.selectedYear,
      selectedMonth:
        Number.isInteger(Number(parsed?.selectedMonth))
          ? Number(parsed.selectedMonth)
          : fallback.selectedMonth,
      monthSpan:
        Number.isInteger(Number(parsed?.monthSpan)) && Number(parsed.monthSpan) > 0
          ? Number(parsed.monthSpan)
          : fallback.monthSpan,
      chargePlanZoomMode:
        typeof parsed?.chargePlanZoomMode === "string" &&
        Object.prototype.hasOwnProperty.call(
          APP_CONFIG.chargeTimeline.zoomModes,
          parsed.chargePlanZoomMode
        )
          ? parsed.chargePlanZoomMode
          : fallback.chargePlanZoomMode,
    };
  } catch (error) {
    console.warn("Erreur lecture localStorage gestion-depenses2 :", error);
    return fallback;
  }
}

function persistState() {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.setItem !== "function"
  ) {
    return;
  }

  try {
    localStorage.setItem(
      APP_CONFIG.storageKey,
      JSON.stringify({
        selectedProjectId: state.selectedProjectId,
        selectedYear: state.selectedYear,
        selectedMonth: state.selectedMonth,
        monthSpan: state.monthSpan,
        chargePlanZoomMode: state.chargePlanZoomMode,
      })
    );
  } catch (error) {
    console.warn("Erreur sauvegarde localStorage gestion-depenses2 :", error);
  }
}

const persisted = readPersistedState();

export const state = {
  projects: [],
  teamMembers: [],
  selectedProjectId: persisted.selectedProjectId,
  selectedYear: persisted.selectedYear,
  selectedMonth: persisted.selectedMonth,
  monthSpan: persisted.monthSpan,
  chargePlanZoomMode: persisted.chargePlanZoomMode,
  newProjectBudgetLines: [],
  editingBudgetLines: [],
  spendingChart: null,
};

export function setState(patch) {
  Object.assign(state, patch);
  persistState();
}

export function getSelectedProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}
