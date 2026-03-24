const planningFrameEl = document.getElementById("planning-projet-frame");
const expensesFrameEl = document.getElementById("gestion-depenses2-frame");
const projectSelectEl = document.getElementById("shared-project-select");
const statusValueEl = document.getElementById("hub-status-value");
const lastSourceValueEl = document.getElementById("last-source-value");
const lastRangeValueEl = document.getElementById("last-range-value");
const logEl = document.getElementById("sync-log");
const clearLogBtn = document.getElementById("clear-log-btn");
const expensesModeButtons = Array.from(
  document.querySelectorAll("[data-expenses-sync-mode]")
);
const expensesDateTriggerEl = document.getElementById("expenses-sync-date-trigger");
const expensesDateValueEl = document.getElementById("expenses-sync-date-value");
const expensesDateInputEl = document.getElementById("expenses-sync-date-input");
const expensesTodayBtnEl = document.getElementById("expenses-sync-today-btn");

let planningApi = null;
let expensesApi = null;
let activeProjectKey = "";
let projectSyncInProgress = false;
let viewportSyncInProgress = false;
let pendingViewportPayload = null;
let lastAppliedViewportSignature = "";
let sharedViewportState = null;
let expensesFramePresentationTimer = 0;
const SHARED_VIEWPORT_RULES = {
  referenceMonthDays: 30.4375,
  minVisibleDays: 7,
  yearMaxVisibleMonths: 14,
};

function setHubStatus(message) {
  if (statusValueEl) {
    statusValueEl.textContent = String(message || "").trim() || "-";
  }
}

function setLastSource(message) {
  if (lastSourceValueEl) {
    lastSourceValueEl.textContent = String(message || "").trim() || "-";
  }
}

function setLastRange(viewport = null) {
  if (!lastRangeValueEl) {
    return;
  }

  if (!viewport) {
    lastRangeValueEl.textContent = "-";
    return;
  }

  const visibleDays = Number(viewport.visibleDays);
  const start = String(viewport.firstVisibleDate || viewport.rangeStartDate || "").trim();
  const end =
    String(viewport.rangeEndDate || "").trim() ||
    shiftIsoDateValue(start, Math.max(0, visibleDays - 1));
  const mode = String(viewport.mode || "").trim();

  lastRangeValueEl.textContent = [
    start && end ? `${start} -> ${end}` : start || end || "-",
    mode || "mode ?",
    Number.isFinite(visibleDays) ? `${visibleDays} j` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function setExpensesPlanningControlsDisabled(disabled = true) {
  expensesModeButtons.forEach((buttonEl) => {
    buttonEl.disabled = Boolean(disabled);
  });

  if (expensesDateTriggerEl instanceof HTMLButtonElement) {
    expensesDateTriggerEl.disabled = Boolean(disabled);
  }

  if (expensesDateInputEl instanceof HTMLInputElement) {
    expensesDateInputEl.disabled = Boolean(disabled);
  }

  if (expensesTodayBtnEl instanceof HTMLButtonElement) {
    expensesTodayBtnEl.disabled = Boolean(disabled);
  }
}

function formatViewportDateLabel(dateValue) {
  const normalizedDateValue = normalizeIsoDate(dateValue);
  if (!normalizedDateValue) {
    return "--";
  }

  const date = new Date(`${normalizedDateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function syncExpensesPlanningShell(viewport = null) {
  const canonicalViewport = viewport ? buildCanonicalSharedViewport(viewport) : null;
  if (canonicalViewport) {
    sharedViewportState = canonicalViewport;
  }

  const activeViewport = canonicalViewport || sharedViewportState;
  const activeMode = String(activeViewport?.mode || "").trim();
  const activeDateValue =
    normalizeIsoDate(activeViewport?.firstVisibleDate) ||
    normalizeIsoDate(activeViewport?.rangeStartDate) ||
    "";

  expensesModeButtons.forEach((buttonEl) => {
    const buttonMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
    const isActive = buttonMode && buttonMode === activeMode;
    buttonEl.classList.toggle("is-active", isActive);
    buttonEl.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (expensesDateValueEl instanceof HTMLElement) {
    expensesDateValueEl.textContent = formatViewportDateLabel(activeDateValue);
  }

  if (expensesDateTriggerEl instanceof HTMLButtonElement) {
    expensesDateTriggerEl.dataset.dateValue = activeDateValue;
  }

  if (expensesDateInputEl instanceof HTMLInputElement) {
    expensesDateInputEl.value = activeDateValue;
  }
}

function appendLog(message) {
  if (!(logEl instanceof HTMLElement)) {
    return;
  }

  const existing = logEl.textContent === "En attente d'activite..." ? "" : logEl.textContent;
  logEl.textContent = [`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`, existing]
    .filter(Boolean)
    .join("\n");
}

function normalizeProjectKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getViewportSignature(projectKey, viewport = {}) {
  const normalizedProjectKey = normalizeProjectKey(projectKey || activeProjectKey || "");
  const rangeStartDate = String(viewport?.firstVisibleDate || viewport?.rangeStartDate || "").trim();
  const mode = String(viewport?.mode || "").trim();
  const visibleDays = Number(viewport?.visibleDays);

  return [
    normalizedProjectKey,
    rangeStartDate,
    mode,
    Number.isFinite(visibleDays) ? visibleDays : "",
  ].join("|");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeIsoDate(value) {
  const normalizedValue = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) ? normalizedValue : "";
}

function shiftIsoDateValue(dateValue, dayDelta = 0) {
  const normalizedDate = normalizeIsoDate(dateValue);
  if (!normalizedDate) {
    return "";
  }

  const date = new Date(`${normalizedDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setDate(date.getDate() + Number(dayDelta || 0));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getInclusiveDaySpan(startDateValue, endDateValue) {
  const normalizedStartDate = normalizeIsoDate(startDateValue);
  const normalizedEndDate = normalizeIsoDate(endDateValue);
  if (!normalizedStartDate || !normalizedEndDate) {
    return 0;
  }

  const startDate = new Date(`${normalizedStartDate}T12:00:00`);
  const endDate = new Date(`${normalizedEndDate}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }

  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}

function getSharedVisibleDaysBounds(viewport = {}) {
  const fallbackMonthVisibleDays = Number(SHARED_VIEWPORT_RULES.referenceMonthDays) || 30.4375;
  const fallbackMinVisibleDays = Number(SHARED_VIEWPORT_RULES.minVisibleDays) || 7;
  const fallbackMaxVisibleDays =
    fallbackMonthVisibleDays *
    Math.max(1, Number(SHARED_VIEWPORT_RULES.yearMaxVisibleMonths) || 14);
  let sourceBounds = null;

  if (expensesApi?.getViewportBounds) {
    try {
      sourceBounds = expensesApi.getViewportBounds(viewport) || null;
    } catch (error) {
      console.warn("Impossible de lire les bornes de gestion-depenses2 :", error);
    }
  }

  const monthVisibleDays =
    Number(sourceBounds?.monthVisibleDays) > 0
      ? Number(sourceBounds.monthVisibleDays)
      : fallbackMonthVisibleDays;
  const minVisibleDays =
    Number(sourceBounds?.minVisibleDays) > 0
      ? Number(sourceBounds.minVisibleDays)
      : fallbackMinVisibleDays;
  const maxVisibleDays =
    Number(sourceBounds?.maxVisibleDays) > 0
      ? Math.max(monthVisibleDays, Number(sourceBounds.maxVisibleDays))
      : Math.max(monthVisibleDays, fallbackMaxVisibleDays);
  const yearThreshold =
    Number(sourceBounds?.yearThreshold) > 0
      ? Number(sourceBounds.yearThreshold)
      : monthVisibleDays * 10;

  return {
    monthVisibleDays,
    minVisibleDays,
    maxVisibleDays,
    yearThreshold,
  };
}

function isSupportedSharedMode(mode) {
  return mode === "week" || mode === "month" || mode === "year";
}

function deriveSharedModeFromVisibleDays(nextVisibleDays, viewport = {}) {
  const { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold } =
    getSharedVisibleDaysBounds(viewport);
  const visibleDays = clamp(Math.round(nextVisibleDays || 0), minVisibleDays, maxVisibleDays);

  if (visibleDays < monthVisibleDays) {
    return "week";
  }

  if (visibleDays >= yearThreshold) {
    return "year";
  }

  return "month";
}

function buildCanonicalSharedViewport(viewport = {}) {
  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds(viewport);
  const rawVisibleDays = Number(viewport.visibleDays);
  const fallbackStartDate = normalizeIsoDate(viewport.rangeStartDate);
  const firstVisibleDate = normalizeIsoDate(viewport.firstVisibleDate) || fallbackStartDate;
  const visibleDays = clamp(
    Number.isFinite(rawVisibleDays) && rawVisibleDays > 0 ? Math.round(rawVisibleDays) : 31,
    minVisibleDays,
    maxVisibleDays
  );
  const rangeEndDate = shiftIsoDateValue(firstVisibleDate, visibleDays - 1);
  const anchorDate =
    normalizeIsoDate(viewport.anchorDate) ||
    shiftIsoDateValue(firstVisibleDate, Math.floor(visibleDays / 2)) ||
    firstVisibleDate;
  const explicitMode = String(viewport.mode || "").trim();

  return {
    ...viewport,
    mode: isSupportedSharedMode(explicitMode)
      ? explicitMode
      : deriveSharedModeFromVisibleDays(visibleDays, {
          ...viewport,
          firstVisibleDate,
          rangeStartDate: firstVisibleDate,
          visibleDays,
        }),
    anchorDate,
    firstVisibleDate,
    visibleDays,
    rangeStartDate: firstVisibleDate,
    rangeEndDate,
  };
}

function buildProjectSelectionViewport(projectDateBounds = null, fallbackViewport = {}) {
  const fallbackSharedViewport = buildCanonicalSharedViewport(fallbackViewport);
  const projectStartDate = normalizeIsoDate(
    projectDateBounds?.startDate || projectDateBounds?.firstDate
  );
  const projectEndDate = normalizeIsoDate(
    projectDateBounds?.endDate || projectDateBounds?.lastDate
  );

  if (!projectStartDate || !projectEndDate) {
    return fallbackSharedViewport;
  }

  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds({
    ...fallbackViewport,
    firstVisibleDate: projectStartDate,
    rangeStartDate: projectStartDate,
    anchorDate: projectStartDate,
  });
  const projectSpanDays = clamp(
    Number(projectDateBounds?.spanDays) || getInclusiveDaySpan(projectStartDate, projectEndDate) || minVisibleDays,
    minVisibleDays,
    maxVisibleDays
  );

  return buildCanonicalSharedViewport({
    ...fallbackSharedViewport,
    anchorDate: projectStartDate,
    firstVisibleDate: projectStartDate,
    rangeStartDate: projectStartDate,
    visibleDays: projectSpanDays,
    rangeEndDate: shiftIsoDateValue(projectStartDate, projectSpanDays - 1),
  });
}

function getTargetVisibleDaysForMode(nextMode, viewport = {}) {
  const { monthVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds(viewport);

  if (nextMode === "week") {
    return 7;
  }

  if (nextMode === "year") {
    return Math.round(Math.min(maxVisibleDays, monthVisibleDays * 12));
  }

  return Math.ceil(monthVisibleDays);
}

function getCurrentSharedViewport() {
  const baseViewport =
    sharedViewportState ||
    expensesApi?.getViewport?.() ||
    planningApi?.getViewport?.() ||
    null;

  return baseViewport ? buildCanonicalSharedViewport(baseViewport) : null;
}

function syncPlanningViewportBounds(viewport = {}) {
  if (!planningApi?.setViewportBounds || !expensesApi?.getViewportBounds) {
    return;
  }

  try {
    const bounds = expensesApi.getViewportBounds(viewport) || null;
    if (bounds) {
      planningApi.setViewportBounds(bounds);
    }
  } catch (error) {
    console.warn("Impossible de synchroniser les bornes du planning :", error);
  }
}

async function alignExpensesViewportToPlanning(maxAttempts = 4) {
  if (!planningApi || !expensesApi) {
    return null;
  }

  let planningViewport = buildCanonicalSharedViewport(
    planningApi.getViewport?.() || sharedViewportState || {}
  );
  if (!planningViewport.firstVisibleDate) {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    syncPlanningViewportBounds(planningViewport);
    await Promise.resolve(expensesApi.applyViewport(planningViewport));
    scheduleExpensesFramePresentation();
    await sleep(attempt === 0 ? 90 : 140);

    const refreshedPlanningViewport = buildCanonicalSharedViewport(
      planningApi.getViewport?.() || planningViewport
    );
    const refreshedExpensesViewport = buildCanonicalSharedViewport(
      expensesApi.getViewport?.() || planningViewport
    );

    const isAligned =
      refreshedPlanningViewport.firstVisibleDate === refreshedExpensesViewport.firstVisibleDate &&
      refreshedPlanningViewport.visibleDays === refreshedExpensesViewport.visibleDays &&
      refreshedPlanningViewport.mode === refreshedExpensesViewport.mode;

    planningViewport = refreshedPlanningViewport;
    if (isAligned) {
      return refreshedPlanningViewport;
    }
  }

  return planningViewport;
}

async function applyViewportFromParentControls(viewport = {}) {
  if (!planningApi || !expensesApi || projectSyncInProgress || viewportSyncInProgress) {
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportSignature = getViewportSignature(activeProjectKey, canonicalViewport);
  viewportSyncInProgress = true;

  try {
    await Promise.all([
      Promise.resolve(planningApi.applyViewport(canonicalViewport)),
      Promise.resolve(expensesApi.applyViewport(canonicalViewport)),
    ]);

    lastAppliedViewportSignature = viewportSignature;
    sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    setLastSource("Pilotage commun");
    setLastRange(canonicalViewport);
    setHubStatus("Synchro active depuis Pilotage commun");
    appendLog(
      `pilotage commun -> ${canonicalViewport.firstVisibleDate || "?"} / ${
        canonicalViewport.rangeEndDate || "?"
      } / ${canonicalViewport.mode || "?"}`
    );
  } catch (error) {
    console.error("Erreur controle planning synchronise :", error);
    setHubStatus(`Erreur pilotage : ${error.message}`);
    appendLog(`Erreur pilotage : ${error.message}`);
  } finally {
    viewportSyncInProgress = false;
    if (pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

function ensureExpensesFramePresentation() {
  const frameDocument = expensesFrameEl?.contentDocument;
  if (!frameDocument?.head || !frameDocument?.body) {
    return false;
  }

  const boardEl = frameDocument.getElementById("charge-plan-board");
  if (!boardEl) {
    return false;
  }

  const styleId = "sync-expenses-planning-style";
  let styleEl = frameDocument.getElementById(styleId);
  if (!(styleEl instanceof frameDocument.defaultView.HTMLStyleElement)) {
    styleEl = frameDocument.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      body.planning-sync-embedded {
        background: transparent !important;
      }

      body.planning-sync-embedded [data-sync-externalized="charge-plan-header"] {
        display: none !important;
      }

      body.planning-sync-embedded .main-content {
        padding: 0 !important;
        background: transparent !important;
      }

      body.planning-sync-embedded .container {
        width: 100% !important;
        max-width: none !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-helper {
        display: none !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-row--header {
        min-height: 0 !important;
        height: 0 !important;
        border: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-row--header > .charge-plan-cell {
        min-height: 0 !important;
        height: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        border: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-row--header .charge-plan-header-track {
        min-height: 0 !important;
        height: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-scroll {
        border-top: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board .charge-plan-timeline {
        padding-top: 0 !important;
      }

      body.planning-sync-embedded #charge-plan-board {
        margin-bottom: 0 !important;
      }
    `;
    frameDocument.head.appendChild(styleEl);
  }

  const chargePlanHeaderEl = boardEl.previousElementSibling;
  if (chargePlanHeaderEl?.classList?.contains("table-header")) {
    chargePlanHeaderEl.setAttribute("data-sync-externalized", "charge-plan-header");
  }

  const measuredHeight = Math.max(
    620,
    Math.ceil(
      Math.max(
        frameDocument.documentElement.scrollHeight || 0,
        frameDocument.body.scrollHeight || 0,
        boardEl.scrollHeight || 0
      )
    )
  );

  if (expensesFrameEl instanceof HTMLIFrameElement) {
    expensesFrameEl.style.height = `${measuredHeight}px`;
    expensesFrameEl.style.minHeight = `${measuredHeight}px`;
  }

  expensesFrameEl?.classList.add("is-ready");
  return true;
}

function scheduleExpensesFramePresentation(attempt = 0) {
  window.clearTimeout(expensesFramePresentationTimer);
  expensesFramePresentationTimer = window.setTimeout(() => {
    const applied = ensureExpensesFramePresentation();
    if (applied || attempt >= 20) {
      expensesFrameEl?.classList.add("is-ready");
      return;
    }

    scheduleExpensesFramePresentation(attempt + 1);
  }, attempt === 0 ? 0 : 120);
}

function bindExpensesPlanningShellControls() {
  expensesModeButtons.forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const nextMode = String(buttonEl.dataset.expensesSyncMode || "").trim();
      const currentViewport = getCurrentSharedViewport();
      if (!currentViewport || !nextMode) {
        return;
      }

      void applyViewportFromParentControls({
        ...currentViewport,
        mode: nextMode,
        visibleDays: getTargetVisibleDaysForMode(nextMode, currentViewport),
        rangeEndDate: "",
      });
    });
  });

  expensesDateTriggerEl?.addEventListener("click", () => {
    if (!(expensesDateInputEl instanceof HTMLInputElement) || expensesDateInputEl.disabled) {
      return;
    }

    if (typeof expensesDateInputEl.showPicker === "function") {
      expensesDateInputEl.showPicker();
      return;
    }

    expensesDateInputEl.focus();
    expensesDateInputEl.click();
  });

  expensesDateInputEl?.addEventListener("change", () => {
    const nextDateValue = normalizeIsoDate(expensesDateInputEl.value);
    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport || !nextDateValue) {
      return;
    }

    void applyViewportFromParentControls({
      ...currentViewport,
      anchorDate: nextDateValue,
      firstVisibleDate: nextDateValue,
      rangeStartDate: nextDateValue,
      rangeEndDate: "",
    });
  });

  expensesTodayBtnEl?.addEventListener("click", () => {
    const currentViewport = getCurrentSharedViewport();
    if (!currentViewport) {
      return;
    }

    const todayDateValue = getTodayIsoDate();
    void applyViewportFromParentControls({
      ...currentViewport,
      anchorDate: todayDateValue,
      firstVisibleDate: todayDateValue,
      rangeStartDate: todayDateValue,
      rangeEndDate: "",
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForFrameLoad(frameEl) {
  if (!(frameEl instanceof HTMLIFrameElement)) {
    throw new Error("Iframe introuvable.");
  }

  if (frameEl.contentWindow?.document?.readyState === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      frameEl.removeEventListener("load", handleLoad);
      reject(new Error(`Timeout chargement iframe ${frameEl.id}`));
    }, 30000);

    function handleLoad() {
      window.clearTimeout(timeoutId);
      resolve();
    }

    frameEl.addEventListener("load", handleLoad, { once: true });
  });
}

async function waitForChildApi(frameEl, apiName, timeoutMs = 30000) {
  await waitForFrameLoad(frameEl);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const api = frameEl.contentWindow?.[apiName];
    if (api?.isReady) {
      return api;
    }
    await sleep(120);
  }

  throw new Error(`API ${apiName} indisponible.`);
}

function renderProjectOptions(projectKeys) {
  if (!(projectSelectEl instanceof HTMLSelectElement)) {
    return;
  }

  projectSelectEl.innerHTML = "";

  const placeholderOptionEl = document.createElement("option");
  placeholderOptionEl.value = "";
  placeholderOptionEl.textContent = "Choisir un projet";
  projectSelectEl.appendChild(placeholderOptionEl);

  projectKeys.forEach((projectKey) => {
    const optionEl = document.createElement("option");
    optionEl.value = projectKey;
    optionEl.textContent = projectKey;
    projectSelectEl.appendChild(optionEl);
  });

  projectSelectEl.disabled = projectKeys.length === 0;
}

async function applySharedProject(projectKey) {
  const normalizedProjectKey = String(projectKey || "").trim();
  if (!normalizedProjectKey || !planningApi || !expensesApi) {
    return;
  }

  projectSyncInProgress = true;
  pendingViewportPayload = null;
  setHubStatus(`Chargement du projet ${normalizedProjectKey}...`);

  try {
    await Promise.all([
      Promise.resolve(planningApi.setSelectedProject(normalizedProjectKey)),
      Promise.resolve(expensesApi.setSelectedProject(normalizedProjectKey)),
    ]);
    activeProjectKey = normalizedProjectKey;
    scheduleExpensesFramePresentation();

    let sharedViewport = buildProjectSelectionViewport(
      planningApi.getProjectDateBounds?.() || null,
      expensesApi.getViewport?.() || planningApi.getViewport?.() || {}
    );
    if (sharedViewport?.firstVisibleDate) {
      syncPlanningViewportBounds(sharedViewport);
      await Promise.all([
        Promise.resolve(planningApi.applyViewport(sharedViewport)),
        Promise.resolve(expensesApi.applyViewport(sharedViewport)),
      ]);

      await sleep(180);
      const planningViewportAfterSelection = planningApi.getViewport?.() || null;
      sharedViewport = buildCanonicalSharedViewport({
        ...sharedViewport,
        ...(planningViewportAfterSelection || {}),
        firstVisibleDate:
          planningViewportAfterSelection?.firstVisibleDate ||
          planningViewportAfterSelection?.rangeStartDate ||
          sharedViewport.firstVisibleDate,
        rangeStartDate:
          planningViewportAfterSelection?.firstVisibleDate ||
          planningViewportAfterSelection?.rangeStartDate ||
          sharedViewport.rangeStartDate,
        visibleDays:
          Number(planningViewportAfterSelection?.visibleDays) || sharedViewport.visibleDays,
        mode: String(planningViewportAfterSelection?.mode || sharedViewport.mode || "").trim(),
        anchorDate:
          planningViewportAfterSelection?.anchorDate ||
          planningViewportAfterSelection?.firstVisibleDate ||
          sharedViewport.anchorDate,
      });
      syncPlanningViewportBounds(sharedViewport);
      await Promise.all([
        Promise.resolve(planningApi.applyViewport(sharedViewport)),
        Promise.resolve(expensesApi.applyViewport(sharedViewport)),
      ]);

      const stabilizedViewport = await alignExpensesViewportToPlanning();
      if (stabilizedViewport?.firstVisibleDate) {
        sharedViewport = buildCanonicalSharedViewport({
          ...sharedViewport,
          ...stabilizedViewport,
        });
      }

      lastAppliedViewportSignature = getViewportSignature(normalizedProjectKey, sharedViewport);
      sharedViewportState = sharedViewport;
      setLastRange(sharedViewport);
      syncExpensesPlanningShell(sharedViewport);
      scheduleExpensesFramePresentation();
    }

    if (projectSelectEl instanceof HTMLSelectElement) {
      projectSelectEl.value = normalizedProjectKey;
    }

    setLastSource("Pilotage commun");
    setHubStatus(`Projet synchronise : ${normalizedProjectKey}`);
    appendLog(`Projet partage applique : ${normalizedProjectKey}`);
  } finally {
    projectSyncInProgress = false;
    void flushViewportSyncQueue();
  }
}

function getTargetApi(sourceApp) {
  if (sourceApp === "planning-projet") {
    return expensesApi;
  }

  if (sourceApp === "gestion-depenses2") {
    return planningApi;
  }

  return null;
}

async function flushViewportSyncQueue() {
  if (projectSyncInProgress || viewportSyncInProgress || !pendingViewportPayload) {
    return;
  }

  const payload = pendingViewportPayload;
  pendingViewportPayload = null;
  const payloadProjectKey = String(payload.projectKey || "").trim();
  if (
    activeProjectKey &&
    payloadProjectKey &&
    normalizeProjectKey(payloadProjectKey) !== normalizeProjectKey(activeProjectKey)
  ) {
    void flushViewportSyncQueue();
    return;
  }

  const targetApi = getTargetApi(payload.app);
  if (!targetApi) {
    void flushViewportSyncQueue();
    return;
  }

  const canonicalViewport = buildCanonicalSharedViewport(payload.viewport);
  syncPlanningViewportBounds(canonicalViewport);
  const viewportSignature = getViewportSignature(payloadProjectKey, canonicalViewport);
  if (viewportSignature && viewportSignature === lastAppliedViewportSignature) {
    sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    void flushViewportSyncQueue();
    return;
  }

  viewportSyncInProgress = true;

  try {
    const sourceApi =
      payload.app === "planning-projet"
        ? planningApi
        : payload.app === "gestion-depenses2"
        ? expensesApi
        : null;
    const sourceSignature = getViewportSignature(payloadProjectKey, payload.viewport);
    const applyCalls = [Promise.resolve(targetApi.applyViewport(canonicalViewport))];

    if (sourceApi && sourceSignature !== viewportSignature) {
      applyCalls.push(Promise.resolve(sourceApi.applyViewport(canonicalViewport)));
    }

    await Promise.all(applyCalls);
    lastAppliedViewportSignature = viewportSignature;
    sharedViewportState = canonicalViewport;
    syncExpensesPlanningShell(canonicalViewport);
    setLastSource(payload.app);
    setLastRange(canonicalViewport);
    setHubStatus(`Synchro active depuis ${payload.app}`);
    appendLog(
      `${payload.app} -> ${canonicalViewport.firstVisibleDate || "?"} / ${
        canonicalViewport.rangeEndDate || "?"
      } / ${canonicalViewport.mode || "?"}`
    );
  } catch (error) {
    console.error("Erreur synchro viewport :", error);
    setHubStatus(`Erreur synchro : ${error.message}`);
    appendLog(`Erreur synchro viewport : ${error.message}`);
  } finally {
    viewportSyncInProgress = false;
    if (pendingViewportPayload) {
      void flushViewportSyncQueue();
    }
  }
}

function handleViewportChange(payload) {
  if (!payload || projectSyncInProgress) {
    return;
  }

  pendingViewportPayload = payload;
  void flushViewportSyncQueue();
}

async function bootstrap() {
  try {
    if (window.grist && typeof window.grist.ready === "function") {
      window.grist.ready({ requiredAccess: "full" });
    }

    setHubStatus("Connexion aux plannings...");

    [planningApi, expensesApi] = await Promise.all([
      waitForChildApi(planningFrameEl, "__planningProjetSyncApi"),
      waitForChildApi(expensesFrameEl, "__gestionDepenses2PlanningSyncApi"),
    ]);
    bindExpensesPlanningShellControls();
    scheduleExpensesFramePresentation();

    expensesFrameEl?.addEventListener("load", () => {
      scheduleExpensesFramePresentation();
    });

    const planningProjects = (planningApi.listProjects?.() || []).filter(Boolean);
    renderProjectOptions(planningProjects);
    setExpensesPlanningControlsDisabled(planningProjects.length === 0);

    const initialProject =
      String(planningApi.getSelectedProject?.() || "").trim() ||
      planningProjects[0] ||
      "";

    planningApi.subscribeViewportChange(handleViewportChange);
    expensesApi.subscribeViewportChange(handleViewportChange);

    if (projectSelectEl instanceof HTMLSelectElement) {
      projectSelectEl.disabled = planningProjects.length === 0;
      projectSelectEl.addEventListener("change", () => {
        applySharedProject(projectSelectEl.value).catch((error) => {
          console.error(error);
          setHubStatus(`Erreur projet : ${error.message}`);
          appendLog(`Erreur projet : ${error.message}`);
        });
      });
    }

    if (initialProject) {
      await applySharedProject(initialProject);
    } else {
      setHubStatus("Aucun projet disponible.");
    }
  } catch (error) {
    console.error("Erreur synchronisation plannings :", error);
    setHubStatus(`Erreur : ${error.message}`);
    appendLog(`Erreur initialisation : ${error.message}`);
  }
}

clearLogBtn?.addEventListener("click", () => {
  if (logEl) {
    logEl.textContent = "En attente d'activite...";
  }
});

bootstrap();
