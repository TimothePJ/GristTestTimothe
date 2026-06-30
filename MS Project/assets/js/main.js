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
import { state, setState } from "./state.js";
import { initProjectSelector, updateProjectSelector } from "./ui/selectors.js";
import {
  renderMsProjectTimeline,
  clearMsProjectTimeline,
  bindTimelineToolbar,
  setMsProjectDateEditHandler,
} from "./ui/timeline.js";

let toolbarBound = false;
let refreshInProgress = false;
let importButtonBound = false;
let importFileInputEl = null;
let importInProgress = false;
let sortMode = "xml-order";
let cachedMsProjectRows = null;

const MS_PROJECT_PERF_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("msProjectDebug") === "1";

function setMsProjectStatus(message = "") {
  const el = document.getElementById("msProjectStatus");
  if (el) el.textContent = message;
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

      setMsProjectStatus(
        `Import termine (${result.sourceFileName}) : ${result.deletedCount || 0} ancienne(s) ligne(s) supprimee(s), ${result.importedCount} ligne(s) ajoutee(s)${planningSyncSuffix}.`
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
function renderMsProjectFromCache() {
  if (!Array.isArray(cachedMsProjectRows) || !state.selectedProject) return;

  const timelineData = buildTimelineDataFromMsProjectRows(
    cachedMsProjectRows,
    state.selectedProject || "",
    sortMode
  );
  if (!timelineData.rowCount) return;
  renderMsProjectTimeline(timelineData);
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
      planningSyncResult = await syncPlanningDemarrageFromMsProjectStart(rowId, isoDate);
    }

    await refreshMsProject();

    if (planningSyncResult && !planningSyncResult.skipped) {
      const baseStatus = document.getElementById("msProjectStatus")?.textContent || "";
      if (planningSyncResult.updatedCount > 0) {
        setMsProjectStatus(
          `${baseStatus} | Sync Planning_Projet: ${planningSyncResult.updatedCount} ligne(s)`
        );
      } else {
        setMsProjectStatus(
          `${baseStatus} | Sync Planning_Projet: aucune correspondance`
        );
      }
    }
  } catch (error) {
    setMsProjectStatus(`Erreur mise a jour ${fieldLabel.toLowerCase()} : ${error.message}`);
    throw error;
  }
}

async function refreshMsProject() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  const startedAt = performance.now();
  const diagnosticsBefore = getMsProjectServiceDiagnostics();
  let fetchDurationMs = 0;
  let buildDurationMs = 0;
  let renderDurationMs = 0;

  try {
    if (!isMsProjectEnabled()) {
      clearMsProjectTimeline();
      setMsProjectStatus(getMsProjectSetupMessage());
      return;
    }

    setMsProjectStatus("Chargement des donnees MS Project...");

    const fetchStartedAt = performance.now();
    const rows = await fetchMsProjectRows();
    fetchDurationMs += performance.now() - fetchStartedAt;
    cachedMsProjectRows = rows;

    const buildStartedAt = performance.now();
    const timelineData = buildTimelineDataFromMsProjectRows(
      rows,
      state.selectedProject || "",
      sortMode
    );
    buildDurationMs += performance.now() - buildStartedAt;

    if (!timelineData.rowCount) {
      clearMsProjectTimeline();

      if (!state.selectedProject) {
        setMsProjectStatus("");
      } else {
        setMsProjectStatus("Aucune tache exploitable trouvee pour le projet selectionne.");
      }
      return;
    }

    const renderStartedAt = performance.now();
    renderMsProjectTimeline(timelineData);
    renderDurationMs += performance.now() - renderStartedAt;

    if (!toolbarBound) {
      bindTimelineToolbar({
        onSortChange: handleSortModeChange,
      });
      toolbarBound = true;
    }

    setMsProjectStatus(
      `${timelineData.rowCount} tache(s) affichee(s) | Projet : ${state.selectedProject || "Tous les projets"}`
    );
  } catch (error) {
    console.error("Erreur MS Project :", error);
    clearMsProjectTimeline();
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
      actionBatchCount:
        diagnosticsAfter.actionBatchCount - diagnosticsBefore.actionBatchCount,
      actionCount:
        diagnosticsAfter.actionCount - diagnosticsBefore.actionCount,
      actionDurationMs:
        Math.round((diagnosticsAfter.actionDurationMs - diagnosticsBefore.actionDurationMs) * 10) / 10,
    });
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
