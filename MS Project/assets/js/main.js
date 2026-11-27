import { APP_CONFIG } from "./config.js";
import {
  initGrist,
  buildProjectOptions,
  fetchMsProjectRows,
  isMsProjectEnabled,
  getMsProjectSetupMessage,
  updateMsProjectDate,
  syncPlanningDemarrageFromMsProjectStart,
  importMsProjectXmlFile,
  getMsProjectServiceDiagnostics,
} from "./services/gristService.js";
import { buildTimelineDataFromMsProjectRows } from "./services/msProjectService.js";
import { createOutlineStateStore } from "./outlineState.js";
import { createTwoStageRunner, planFirstUnfoldStage } from "./unfoldStages.js";
import { state, setState } from "./state.js";
import { initProjectSelector, updateProjectSelector } from "./ui/selectors.js";
import {
  renderMsProjectTimeline,
  clearMsProjectTimeline,
  bindTimelineToolbar,
  setMsProjectDateEditHandler,
  setMsProjectOutlineToggleHandler,
} from "./ui/timeline.js";

let toolbarBound = false;
let refreshInProgress = false;
let refreshPending = false;
let importButtonBound = false;
let importFileInputEl = null;
let importInProgress = false;
let sortMode = "xml-order";
let cachedMsProjectRows = null;
let lastRenderedProject = "";

const MS_PROJECT_PERF_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("msProjectDebug") === "1";

// Dans une page intégrée, le simple accès à localStorage peut être refusé par le navigateur.
function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

const outlineState = createOutlineStateStore(getBrowserStorage());

// Lignes actuellement à l'écran (identifiants vis-timeline).
let displayedGroupIds = new Set();

// Dépli d'une grosse section en deux temps : le reste part une fois le premier temps
// affiché, c'est-à-dire après la prochaine image du navigateur.
const unfoldStages = createTwoStageRunner((callback) => {
  requestAnimationFrame(() => setTimeout(callback, 0));
});

// Tout affichage du planning passe par ici : la suite d'un dépli en deux temps encore en
// attente serait périmée, elle est annulée.
function showTimelineData(timelineData, options) {
  unfoldStages.cancel();
  renderMsProjectTimeline(timelineData, options);
  displayedGroupIds = new Set(timelineData.groups.map((group) => group.id));
}

function clearTimeline() {
  unfoldStages.cancel();
  displayedGroupIds = new Set();
  clearMsProjectTimeline();
}

function setMsProjectStatus(message = "") {
  const el = document.getElementById("msProjectStatus");
  if (el) el.textContent = message;
}

function describeDisplayedTasks(rowCount, projectName) {
  return `${rowCount} tache(s) affichee(s) | Nom : ${projectName}`;
}

// Lignes et barres à afficher pour un planning, sections repliées par l'utilisateur comprises.
function buildMsProjectTimelineData(rows, projectName, requestedSortMode) {
  return buildTimelineDataFromMsProjectRows(rows, projectName, requestedSortMode, {
    collapsedIds: outlineState.getCollapsedIds(projectName),
  });
}

function traceMsProjectPerformance(label, details = {}) {
  if (!MS_PROJECT_PERF_DEBUG) return;
  console.info(`[MS Project perf] ${label}`, details);
}

function ensureImportFileInput() {
  if (importFileInputEl instanceof HTMLInputElement && importFileInputEl.isConnected) {
    return importFileInputEl;
  }

  const inputEl = document.createElement("input");
  inputEl.type = "file";
  inputEl.id = "msProjectImportInput";
  inputEl.accept = ".xml";
  inputEl.style.display = "none";

  inputEl.addEventListener("change", async () => {
    const selectedFile = inputEl.files?.[0] || null;
    if (!selectedFile) return;

    const fileName = String(selectedFile.name || "").toLowerCase();
    if (!fileName.endsWith(".xml")) {
      setMsProjectStatus("Format non supporte pour l'instant. Selectionne un fichier XML.");
      inputEl.value = "";
      return;
    }

    if (importInProgress) {
      setMsProjectStatus("Import deja en cours...");
      return;
    }

    importInProgress = true;
    try {
      setMsProjectStatus(`Import XML en cours : ${selectedFile.name}`);
      const result = await importMsProjectXmlFile(selectedFile);
      const projectOptions = await buildProjectOptions();
      setState({ selectedProject: result.sourceFileName || "" });
      const selectedProject = updateProjectSelector(
        projectOptions,
        state.selectedProject
      );
      if (selectedProject !== state.selectedProject) {
        setState({ selectedProject });
      }
      await refreshMsProject();

      const planningSyncSuffix = result.planningSyncSkipped
        ? ""
        : result.planningSyncUpdatedCount > 0
          ? `, ${result.planningSyncUpdatedCount} ligne(s) Planning_Projet synchronisee(s)`
          : result.planningSyncMatchedCount > 0
            ? ", aucune date Planning_Projet modifiee"
            : ", aucune liaison Planning_Projet trouvee";
      const referenceSyncSuffix = describeReferenceSync(
        result.planningSyncReferenceUpdatedCount,
        result.planningSyncReferenceFailed
      );

      setMsProjectStatus(
        `Import termine (${result.sourceFileName}) : ${result.deletedCount || 0} ancienne(s) ligne(s) supprimee(s), ${result.importedCount} ligne(s) ajoutee(s)${planningSyncSuffix}${referenceSyncSuffix}.`
      );
    } catch (error) {
      console.error("Erreur import XML MS Project :", error);
      setMsProjectStatus(`Erreur import XML : ${error.message}`);
    } finally {
      importInProgress = false;
      inputEl.value = "";
    }
  });

  document.body.appendChild(inputEl);
  importFileInputEl = inputEl;
  return importFileInputEl;
}

function openImportFileDialog() {
  const inputEl = ensureImportFileInput();
  if (!(inputEl instanceof HTMLInputElement)) {
    setMsProjectStatus("Impossible d'ouvrir le navigateur de fichier.");
    return;
  }

  // Allow selecting the same file twice in a row.
  inputEl.value = "";
  inputEl.click();
}

function bindImportButton() {
  if (importButtonBound) return;
  importButtonBound = true;

  const importBtn = document.getElementById("btn-import");
  if (!(importBtn instanceof HTMLButtonElement)) return;

  importBtn.addEventListener("click", (event) => {
    event.preventDefault();
    openImportFileDialog();
  });
}

// Capture le défilement avant un re-rendu et le restitue après : une fois tout
// de suite, une fois à la frame suivante, car vis-timeline ne repositionne ses
// panneaux qu'au redraw qu'il programme en requestAnimationFrame. Sans cela une
// simple édition de date renvoie l'utilisateur en haut du planning.
function captureMsProjectScroll() {
  const scroller = document.scrollingElement || document.documentElement;
  const panes = Array.from(
    document.querySelectorAll("#msProjectTimeline .vis-panel")
  );
  const documentTop = scroller ? scroller.scrollTop : 0;
  const paneTops = panes.map((pane) => pane.scrollTop);

  return () => {
    const restore = () => {
      if (scroller) scroller.scrollTop = documentTop;
      panes.forEach((pane, index) => {
        pane.scrollTop = paneTops[index];
      });
    };
    restore();
    requestAnimationFrame(restore);
  };
}

function resolveDateColumnName(field) {
  const columns = APP_CONFIG.grist.msProjectTable?.columns || {};
  if (field === "start") return columns.start;
  if (field === "end") return columns.end;
  return "";
}

// Ré-affiche immédiatement le planning MS Project à partir du cache local
// (sans aller chercher les données sur Grist), pour un retour visuel
// instantané après une édition. La réconciliation complète arrive ensuite
// via refreshMsProject().
// `inTwoStages` : si l'affichage ajoute beaucoup de lignes d'un coup (dépli d'une grosse
// section), les premières sont affichées tout de suite et le reste juste après.
function renderMsProjectFromCache({ keepWindow = false, inTwoStages = false } = {}) {
  if (!Array.isArray(cachedMsProjectRows) || !state.selectedProject) return null;

  const timelineData = buildMsProjectTimelineData(
    cachedMsProjectRows,
    state.selectedProject || "",
    sortMode
  );
  if (!timelineData.rowCount) return null;

  const show = (data) => {
    const restoreScroll = captureMsProjectScroll();
    showTimelineData(data, { keepWindow });
    restoreScroll();
  };
  const firstStage = inTwoStages
    ? planFirstUnfoldStage(timelineData, displayedGroupIds)
    : null;
  if (firstStage) {
    unfoldStages.run(
      () => show(firstStage),
      () => show(timelineData)
    );
  } else {
    show(timelineData);
  }
  return timelineData;
}

// Replie ou déplie une section. L'état est retenu dans le navigateur, puis le planning est
// redessiné depuis les lignes déjà chargées : pas de lecture Grist, et la période affichée
// ne bouge pas.
function handleOutlineToggle(taskId) {
  const projectName = state.selectedProject;
  if (!taskId || !projectName) return;

  outlineState.toggle(projectName, taskId);
  const timelineData = renderMsProjectFromCache({ keepWindow: true, inTwoStages: true });
  if (timelineData) {
    setMsProjectStatus(describeDisplayedTasks(timelineData.rowCount, projectName));
  }
}

// Applique localement le champ modifié sur la ligne en cache (mise à jour
// optimiste) et redessine immédiatement, avant que l'écriture Grist et la
// réconciliation complète ne se terminent.
function applyOptimisticMsProjectRowUpdate(rowId, fieldUpdates) {
  if (!Array.isArray(cachedMsProjectRows)) return;

  const columns = APP_CONFIG.grist.msProjectTable?.columns || {};
  const targetId = Number(rowId);
  const index = cachedMsProjectRows.findIndex(
    (row) => Number(row?.[columns.id]) === targetId
  );
  if (index === -1) return;

  cachedMsProjectRows = cachedMsProjectRows.slice();
  cachedMsProjectRows[index] = { ...cachedMsProjectRows[index], ...fieldUpdates };

  renderMsProjectFromCache();
}

function findCachedMsProjectRow(rowId) {
  const idColumn = APP_CONFIG.grist.msProjectTable?.columns?.id || "id";
  const targetId = Number(rowId);
  return (cachedMsProjectRows || []).find((row) => Number(row?.[idColumn]) === targetId) || null;
}

// Suite d'un message de synchronisation : ce que sont devenues les données d'entrée des
// lignes déplacées. Leur écriture part après celle du planning et peut être refusée seule.
function describeReferenceSync(referenceUpdatedCount = 0, referenceFailed = false) {
  if (referenceFailed) return ", donnees d'entree non recalees (ecriture refusee)";
  return referenceUpdatedCount > 0
    ? `, ${referenceUpdatedCount} donnee(s) d'entree recalee(s)`
    : "";
}

// Une ligne liée dont aucune date ne change n'est pas réécrite : le compte ne porte que sur
// les lignes réellement modifiées.
function describePlanningSync({
  updatedCount = 0,
  matchedCount = 0,
  referenceUpdatedCount = 0,
  referenceFailed = false,
} = {}) {
  if (updatedCount > 0) {
    return `Sync Planning_Projet: ${updatedCount} ligne(s)${describeReferenceSync(referenceUpdatedCount, referenceFailed)}`;
  }
  return matchedCount > 0
    ? "Sync Planning_Projet: dates deja a jour"
    : "Sync Planning_Projet: aucune correspondance";
}

async function handleDateCellEdit({ rowId, field, isoDate }) {
  const columnName = resolveDateColumnName(field);
  if (!columnName) {
    throw new Error(`Colonne date inconnue pour le champ "${field}".`);
  }

  const fieldLabel = field === "end" ? "Fin" : "Debut";
  try {
    setMsProjectStatus(`Mise a jour ${fieldLabel} en cours...`);

    // Mise à jour optimiste : retour visuel immédiat avant la confirmation
    // Grist, qui arrive via la réconciliation complète (refreshMsProject).
    applyOptimisticMsProjectRowUpdate(rowId, { [columnName]: isoDate });

    await updateMsProjectDate(rowId, columnName, isoDate);

    let planningSyncResult = null;
    if (field === "start") {
      // La tâche est déjà en mémoire, avec sa nouvelle date : la synchronisation n'a pas à
      // la relire.
      planningSyncResult = await syncPlanningDemarrageFromMsProjectStart(
        rowId,
        isoDate,
        state.selectedProject,
        { msRow: findCachedMsProjectRow(rowId) }
      );
    }

    await refreshMsProject();

    if (planningSyncResult && !planningSyncResult.skipped) {
      const baseStatus = document.getElementById("msProjectStatus")?.textContent || "";
      setMsProjectStatus(`${baseStatus} | ${describePlanningSync(planningSyncResult)}`);
    }
  } catch (error) {
    setMsProjectStatus(`Erreur mise a jour ${fieldLabel.toLowerCase()} : ${error.message}`);
    throw error;
  }
}

async function refreshMsProject() {
  if (refreshInProgress) {
    refreshPending = true;
    return;
  }
  refreshInProgress = true;
  const requestedProject = state.selectedProject;
  const requestedSortMode = sortMode;

  const startedAt = performance.now();
  const diagnosticsBefore = getMsProjectServiceDiagnostics();
  let fetchDurationMs = 0;
  let buildDurationMs = 0;
  let renderDurationMs = 0;

  try {
    if (!isMsProjectEnabled()) {
      clearTimeline();
      setMsProjectStatus(getMsProjectSetupMessage());
      return;
    }

    if (!requestedProject) {
      cachedMsProjectRows = [];
      clearTimeline();
      setMsProjectStatus("Selectionne un nom pour charger ses taches.");
      return;
    }

    setMsProjectStatus("Chargement des donnees MS Project...");

    const fetchStartedAt = performance.now();
    const rows = await fetchMsProjectRows(requestedProject);
    fetchDurationMs += performance.now() - fetchStartedAt;
    if (requestedProject !== state.selectedProject || requestedSortMode !== sortMode) {
      refreshPending = true;
      return;
    }
    cachedMsProjectRows = rows;

    const buildStartedAt = performance.now();
    const timelineData = buildMsProjectTimelineData(
      rows,
      requestedProject,
      requestedSortMode
    );
    buildDurationMs += performance.now() - buildStartedAt;

    if (!timelineData.rowCount) {
      clearTimeline();

      if (!requestedProject) {
        setMsProjectStatus("");
      } else {
        setMsProjectStatus("Aucune tache exploitable trouvee pour le nom selectionne.");
      }
      return;
    }

    // Le défilement n'est restitué que si l'on redessine le même projet :
    // changer de projet doit repartir du haut.
    const restoreScroll =
      requestedProject === lastRenderedProject ? captureMsProjectScroll() : null;

    const renderStartedAt = performance.now();
    showTimelineData(timelineData);
    renderDurationMs += performance.now() - renderStartedAt;
    restoreScroll?.();
    lastRenderedProject = requestedProject;

    if (!toolbarBound) {
      bindTimelineToolbar({
        onSortChange: handleSortModeChange,
      });
      toolbarBound = true;
    }

    setMsProjectStatus(describeDisplayedTasks(timelineData.rowCount, requestedProject));
  } catch (error) {
    console.error("Erreur MS Project :", error);
    clearTimeline();
    setMsProjectStatus(`Erreur MS Project : ${error.message}`);
  } finally {
    refreshInProgress = false;
    const diagnosticsAfter = getMsProjectServiceDiagnostics();
    traceMsProjectPerformance("refresh", {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      fetchDurationMs: Math.round(fetchDurationMs * 10) / 10,
      buildDurationMs: Math.round(buildDurationMs * 10) / 10,
      renderDurationMs: Math.round(renderDurationMs * 10) / 10,
      fetchTableCount:
        diagnosticsAfter.fetchTableCount - diagnosticsBefore.fetchTableCount,
      fetchTableDurationMs:
        Math.round((diagnosticsAfter.fetchTableDurationMs - diagnosticsBefore.fetchTableDurationMs) * 10) / 10,
      restFetchCount:
        diagnosticsAfter.restFetchCount - diagnosticsBefore.restFetchCount,
      restFetchDurationMs:
        Math.round((diagnosticsAfter.restFetchDurationMs - diagnosticsBefore.restFetchDurationMs) * 10) / 10,
      actionBatchCount:
        diagnosticsAfter.actionBatchCount - diagnosticsBefore.actionBatchCount,
      actionCount:
        diagnosticsAfter.actionCount - diagnosticsBefore.actionCount,
      actionDurationMs:
        Math.round((diagnosticsAfter.actionDurationMs - diagnosticsBefore.actionDurationMs) * 10) / 10,
    });
    if (refreshPending) {
      refreshPending = false;
      await refreshMsProject();
    }
  }
}

async function handleProjectChange(currentState) {
  console.log("Projet selectionne :", currentState.selectedProject || "(aucun)");
  await refreshMsProject();
}

async function handleSortModeChange(nextSortMode) {
  const normalizedSortMode = ["xml-order", "planning-number", "chronological"].includes(
    nextSortMode
  )
    ? nextSortMode
    : "xml-order";
  if (sortMode === normalizedSortMode) return;
  sortMode = normalizedSortMode;
  await refreshMsProject();
}

async function bootstrap() {
  try {
    initGrist();
    setMsProjectDateEditHandler(handleDateCellEdit);
    setMsProjectOutlineToggleHandler(handleOutlineToggle);
    bindImportButton();

    setState({ selectedProject: "" });

    const projectOptions = await buildProjectOptions();
    initProjectSelector(projectOptions, {
      onChange: handleProjectChange,
    });

    await refreshMsProject();

  } catch (error) {
    console.error("Erreur d'initialisation MS Project :", error);

    const project = document.getElementById("projectDropdown");
    if (project) {
      project.disabled = true;
      project.innerHTML = `<option value="">Erreur chargement projet</option>`;
    }

    setMsProjectStatus(`Erreur initialisation : ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
