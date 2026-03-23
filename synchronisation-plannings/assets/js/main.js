const planningFrameEl = document.getElementById("planning-projet-frame");
const expensesFrameEl = document.getElementById("gestion-depenses2-frame");
const projectSelectEl = document.getElementById("shared-project-select");
const statusValueEl = document.getElementById("hub-status-value");
const lastSourceValueEl = document.getElementById("last-source-value");
const lastRangeValueEl = document.getElementById("last-range-value");
const logEl = document.getElementById("sync-log");
const clearLogBtn = document.getElementById("clear-log-btn");

let planningApi = null;
let expensesApi = null;
let activeProjectKey = "";
let projectSyncInProgress = false;
let viewportSyncInProgress = false;
let pendingViewportPayload = null;
let lastAppliedViewportSignature = "";
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

function getSharedVisibleDaysBounds() {
  const monthVisibleDays = Number(SHARED_VIEWPORT_RULES.referenceMonthDays) || 30.4375;
  return {
    monthVisibleDays,
    minVisibleDays: Number(SHARED_VIEWPORT_RULES.minVisibleDays) || 7,
    maxVisibleDays:
      monthVisibleDays * Math.max(1, Number(SHARED_VIEWPORT_RULES.yearMaxVisibleMonths) || 14),
    yearThreshold: monthVisibleDays * 10,
  };
}

function deriveSharedModeFromVisibleDays(nextVisibleDays) {
  const { monthVisibleDays, minVisibleDays, maxVisibleDays, yearThreshold } =
    getSharedVisibleDaysBounds();
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
  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds();
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

  return {
    ...viewport,
    mode: deriveSharedModeFromVisibleDays(visibleDays),
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

  const { minVisibleDays, maxVisibleDays } = getSharedVisibleDaysBounds();
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

    let sharedViewport = buildProjectSelectionViewport(
      planningApi.getProjectDateBounds?.() || null,
      expensesApi.getViewport?.() || planningApi.getViewport?.() || {}
    );
    if (sharedViewport?.firstVisibleDate) {
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
      await Promise.all([
        Promise.resolve(planningApi.applyViewport(sharedViewport)),
        Promise.resolve(expensesApi.applyViewport(sharedViewport)),
      ]);

      lastAppliedViewportSignature = getViewportSignature(normalizedProjectKey, sharedViewport);
      setLastRange(sharedViewport);
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
  const viewportSignature = getViewportSignature(payloadProjectKey, canonicalViewport);
  if (viewportSignature && viewportSignature === lastAppliedViewportSignature) {
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

    const planningProjects = (planningApi.listProjects?.() || []).filter(Boolean);
    renderProjectOptions(planningProjects);

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
