import { APP_CONFIG } from "./config.js";
import {
  initGrist,
  buildProjectOptions,
  fetchMsProjectRows,
  isMsProjectEnabled,
  getMsProjectSetupMessage,
  updateMsProjectDate,
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

function setMsProjectStatus(message = "") {
  const el = document.getElementById("msProjectStatus");
  if (el) el.textContent = message;
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
    await refreshMsProject();
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
