import { state, setState } from "./state.js";
import {
  initGrist,
  buildProjectOptions,
  fetchPlanningRows,
} from "./services/gristService.js";
import { buildTimelineDataFromPlanningRows } from "./services/planningService.js";
import { initProjectSelector } from "./ui/selectors.js";
import {
  renderPlanningTimeline,
  clearPlanningTimeline,
  bindTimelineToolbar,
} from "./ui/timeline.js";

let toolbarBound = false;
let refreshInProgress = false;

function setPlanningStatus(message = "") {
  const el = document.getElementById("planningStatus");
  if (el) {
    el.textContent = message;
  }
}

async function refreshPlanning() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    setPlanningStatus("Chargement du planning...");

    const planningRows = await fetchPlanningRows();
    const timelineData = buildTimelineDataFromPlanningRows(
      planningRows,
      state.selectedProject || ""
    );

    if (!timelineData.rowCount) {
      clearPlanningTimeline();

      if (!state.selectedProject) {
        setPlanningStatus("");
      } else {
        setPlanningStatus("Aucune ligne trouvée dans la table de planning.");
      }
      return;
    }

    renderPlanningTimeline(timelineData);

    if (!toolbarBound) {
      bindTimelineToolbar();
      toolbarBound = true;
    }

    const projectLabel = state.selectedProject
      ? `Projet : ${state.selectedProject}`
      : "Tous les projets";

    const emptyPhaseSuffix =
      !timelineData.items || timelineData.items.length === 0
        ? " | Aucune phase exploitable"
        : "";

    setPlanningStatus(
      `${timelineData.rowCount} ligne(s) planning affichée(s) | ${projectLabel}${emptyPhaseSuffix}`
    );
  } catch (error) {
    console.error("Erreur refresh planning :", error);
    clearPlanningTimeline();
    setPlanningStatus(`Erreur planning : ${error.message}`);
  } finally {
    refreshInProgress = false;
  }
}

async function handleProjectChange(currentState) {
  console.log("Projet sélectionné :", currentState.selectedProject || "(aucun)");
  await refreshPlanning();
}

async function bootstrap() {
  try {
    setState({ selectedProject: "" });

    initGrist();

    const projectOptions = await buildProjectOptions();

    initProjectSelector(projectOptions, {
      onChange: handleProjectChange,
    });

    await refreshPlanning();
  } catch (error) {
    console.error("Erreur d'initialisation :", error);

    const project = document.getElementById("projectDropdown");
    if (project) {
      project.disabled = true;
      project.innerHTML = `<option value="">Erreur chargement projet</option>`;
    }

    setPlanningStatus(`Erreur initialisation : ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
