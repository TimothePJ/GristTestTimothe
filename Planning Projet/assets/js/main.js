import { state, setState } from "./state.js";
import { initGrist, buildProjectOptions, fetchPlanningRows } from "./services/gristService.js";
import { buildTimelineDataFromPlanningRows } from "./services/planningService.js";
import { initProjectSelector } from "./ui/selectors.js";
import { renderPlanningTimeline, clearPlanningTimeline } from "./ui/timeline.js";

function setPlanningStatus(message) {
  const el = document.getElementById("planningStatus");
  if (el) el.textContent = message || "";
}

async function refreshPlanning() {
  try {
    setPlanningStatus("Chargement du planning…");

    const planningRows = await fetchPlanningRows();

    const timelineData = buildTimelineDataFromPlanningRows(
      planningRows,
      state.selectedProject // filtrage effectif plus tard si colonne projetLink configurée
    );

    if (!timelineData.items.length) {
      clearPlanningTimeline();
      setPlanningStatus(
        timelineData.rowCount
          ? "Aucune phase exploitable (dates/durées manquantes) pour les lignes affichées."
          : "Aucune ligne dans la table Planning_Projet."
      );
      return;
    }

    renderPlanningTimeline(timelineData);

    let msg = `${timelineData.rowCount} ligne(s) planning affichée(s).`;
    // Petite info honnête : pas de filtre réel tant que projectLink = null
    if (state.selectedProject) {
      msg += ` Projet sélectionné : ${state.selectedProject}`;
    }
    setPlanningStatus(msg);
  } catch (error) {
    console.error("Erreur refresh planning :", error);
    clearPlanningTimeline();
    setPlanningStatus(`Erreur planning : ${error.message}`);
  }
}

async function bootstrap() {
  try {
    setState({ selectedProject: "" });

    initGrist();

    const projectOptions = await buildProjectOptions();

    initProjectSelector(projectOptions, {
      onChange: async (currentState) => {
        console.log("Projet sélectionné :", currentState.selectedProject);
        await refreshPlanning();
      },
    });

    // Premier affichage (même sans projet sélectionné)
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