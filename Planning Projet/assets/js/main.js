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

/**
 * Affiche un message de statut sous la timeline.
 */
function setPlanningStatus(message = "") {
  const el = document.getElementById("planningStatus");
  if (el) {
    el.textContent = message;
  }
}

/**
 * Recharge les données de planning et met à jour la timeline.
 * (On ne touche pas ici au tri de la liste déroulante projet)
 */
async function refreshPlanning() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    setPlanningStatus("Chargement du planning…");

    const planningRows = await fetchPlanningRows();

    // Construction des groups/items pour vis-timeline
    const timelineData = buildTimelineDataFromPlanningRows(
      planningRows,
      state.selectedProject || ""
    );

    // Aucun item affichable
    if (!timelineData.items || timelineData.items.length === 0) {
      clearPlanningTimeline();

      if (!state.selectedProject) {
        setPlanningStatus("");
      } else if (timelineData.rowCount > 0) {
        setPlanningStatus(
          "Aucune phase exploitable (dates ou durées manquantes) pour les lignes affichées."
        );
      } else {
        setPlanningStatus("Aucune ligne trouvée dans la table de planning.");
      }
      return;
    }

    // Rendu timeline
    renderPlanningTimeline(timelineData);

    // Bind toolbar une seule fois (après création de la timeline)
    if (!toolbarBound) {
      bindTimelineToolbar();
      toolbarBound = true;
    }

    const projectLabel = state.selectedProject
      ? `Projet : ${state.selectedProject}`
      : "Tous les projets";

    setPlanningStatus(
      `${timelineData.rowCount} ligne(s) planning affichée(s) | ${projectLabel}`
    );
  } catch (error) {
    console.error("Erreur refresh planning :", error);
    clearPlanningTimeline();
    setPlanningStatus(`Erreur planning : ${error.message}`);
  } finally {
    refreshInProgress = false;
  }
}

/**
 * Handler appelé quand la dropdown projet change.
 * (On garde la logique simple pour l’instant)
 */
async function handleProjectChange(currentState) {
  console.log("Projet sélectionné :", currentState.selectedProject || "(aucun)");
  await refreshPlanning();
}

/**
 * Point d'entrée de l'application
 */
async function bootstrap() {
  try {
    // On force le démarrage sur "Choisir un projet"
    setState({ selectedProject: "" });

    // Initialisation Grist
    initGrist();

    // Chargement des projets (sans modifier l'ordre/tri ici)
    const projectOptions = await buildProjectOptions();

    // Initialisation de la dropdown
    initProjectSelector(projectOptions, {
      onChange: handleProjectChange,
    });

    // Premier rendu du planning
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

// Lancement
document.addEventListener("DOMContentLoaded", bootstrap);
