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
} from "./services/gristService.js";
import { buildTimelineDataFromMsProjectRows } from "./services/msProjectService.js";
import { state, setState } from "./state.js";
import { initProjectSelector } from "./ui/selectors.js";
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

function setMsProjectStatus(message = "") {
  const el = document.getElementById("msProjectStatus");
  if (el) el.textContent = message;
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
      await refreshMsProject();

      setMsProjectStatus(
        `Import termine (${result.sourceFileName}) : ${result.importedCount} ligne(s) ajoutee(s).`
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

async function handleDateCellEdit({ rowId, field, isoDate }) {
  const columnName = resolveDateColumnName(field);
  if (!columnName) {
    throw new Error(`Colonne date inconnue pour le champ "${field}".`);
  }

  const fieldLabel = field === "end" ? "Fin" : "Debut";
  try {
    setMsProjectStatus(`Mise a jour ${fieldLabel} en cours...`);
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

  try {
    if (!isMsProjectEnabled()) {
      clearMsProjectTimeline();
      setMsProjectStatus(getMsProjectSetupMessage());
      return;
    }

    setMsProjectStatus("Chargement des donnees MS Project...");

    const rows = await fetchMsProjectRows();
    const timelineData = buildTimelineDataFromMsProjectRows(
      rows,
      state.selectedProject || ""
    );

    if (!timelineData.rowCount) {
      clearMsProjectTimeline();

      if (!state.selectedProject) {
        setMsProjectStatus("");
      } else {
        setMsProjectStatus("Aucune tache exploitable trouvee pour le projet selectionne.");
      }
      return;
    }

    renderMsProjectTimeline(timelineData);

    if (!toolbarBound) {
      bindTimelineToolbar();
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
  }
}

async function handleProjectChange(currentState) {
  console.log("Projet selectionne :", currentState.selectedProject || "(aucun)");
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
