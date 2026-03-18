import { APP_CONFIG } from "./config.js";

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInputValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function getAnchorMonthDayCount(dateValue) {
  const configuredReferenceMonthDays = Number(
    APP_CONFIG.chargeTimeline.referenceMonthDays
  );
  if (Number.isFinite(configuredReferenceMonthDays) && configuredReferenceMonthDays > 0) {
    return configuredReferenceMonthDays;
  }

  const normalizedDateValue = isDateInputValue(dateValue)
    ? String(dateValue).trim()
    : toDateInputValue(new Date());
  const anchorDate = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(anchorDate.getTime())) {
    return APP_CONFIG.chargeTimeline.defaultVisibleDays;
  }

  return new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
}

function deriveVisibleDaysFromLegacyZoom(mode, scale, anchorDateValue) {
  const monthDayCount = getAnchorMonthDayCount(anchorDateValue);
  const safeScale = Number.isFinite(Number(scale))
    ? Math.min(
        APP_CONFIG.chargeTimeline.maxZoomScale,
        Math.max(
          APP_CONFIG.chargeTimeline.minZoomScale,
          Number(scale)
        )
      )
    : APP_CONFIG.chargeTimeline.defaultZoomScale;

  if (mode === "week") {
    return 7 / safeScale;
  }

  if (mode === "year") {
    return 365 / safeScale;
  }

  return monthDayCount / safeScale;
}

function normalizeVisibleDays(value, anchorDateValue) {
  const monthDayCount = getAnchorMonthDayCount(anchorDateValue);
  const minVisibleDays = APP_CONFIG.chargeTimeline.minVisibleDays;
  const maxVisibleDays =
    monthDayCount * Math.max(1, APP_CONFIG.chargeTimeline.yearMaxVisibleMonths || 14);
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return Math.min(
      Math.max(APP_CONFIG.chargeTimeline.defaultVisibleDays, minVisibleDays),
      maxVisibleDays
    );
  }

  return Math.min(Math.max(numericValue, minVisibleDays), maxVisibleDays);
}

function getNowState() {
  const now = new Date();
  const anchorDate = toDateInputValue(now);
  return {
    selectedProjectId: null,
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    monthSpan: APP_CONFIG.defaultMonthSpan,
    chargePlanZoomMode: APP_CONFIG.defaultChargePlanZoomMode,
    chargePlanZoomScale: APP_CONFIG.chargeTimeline.defaultZoomScale,
    chargePlanVisibleDays: normalizeVisibleDays(
      APP_CONFIG.chargeTimeline.defaultVisibleDays,
      anchorDate
    ),
    chargePlanAnchorDate: anchorDate,
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
    const parsedAnchorDate = isDateInputValue(parsed?.chargePlanAnchorDate)
      ? String(parsed.chargePlanAnchorDate).trim()
      : fallback.chargePlanAnchorDate;
    const parsedZoomMode =
      typeof parsed?.chargePlanZoomMode === "string" &&
      Object.prototype.hasOwnProperty.call(
        APP_CONFIG.chargeTimeline.zoomModes,
        parsed.chargePlanZoomMode
      )
        ? parsed.chargePlanZoomMode
        : fallback.chargePlanZoomMode;
    const parsedZoomScale = Number.isFinite(Number(parsed?.chargePlanZoomScale))
      ? Math.min(
          APP_CONFIG.chargeTimeline.maxZoomScale,
          Math.max(
            APP_CONFIG.chargeTimeline.minZoomScale,
            Number(parsed.chargePlanZoomScale)
          )
        )
      : fallback.chargePlanZoomScale;

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
      chargePlanZoomMode: parsedZoomMode,
      chargePlanZoomScale: parsedZoomScale,
      chargePlanVisibleDays: normalizeVisibleDays(
        parsed?.chargePlanVisibleDays ??
          deriveVisibleDaysFromLegacyZoom(
            parsedZoomMode,
            parsedZoomScale,
            parsedAnchorDate
          ),
        parsedAnchorDate
      ),
      chargePlanAnchorDate: parsedAnchorDate,
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
        chargePlanZoomScale: state.chargePlanZoomScale,
        chargePlanVisibleDays: state.chargePlanVisibleDays,
        chargePlanAnchorDate: state.chargePlanAnchorDate,
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
  chargePlanZoomScale: persisted.chargePlanZoomScale,
  chargePlanVisibleDays: persisted.chargePlanVisibleDays,
  chargePlanAnchorDate: persisted.chargePlanAnchorDate,
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
