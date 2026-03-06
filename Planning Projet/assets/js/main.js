import { APP_CONFIG } from "./config.js";
import { state, setState } from "./state.js";
import {
  initGrist,
  buildProjectOptions,
  fetchPlanningRows,
  syncCoffrageDiffCoffrageFromGroups,
  updatePlanningDurationAndLeftDate,
  toText,
} from "./services/gristService.js";
import { buildTimelineDataFromPlanningRows } from "./services/planningService.js";
import {
  initProjectSelector,
  initZoneSelector,
  updateZoneSelector,
} from "./ui/selectors.js";
import {
  renderPlanningTimeline,
  clearPlanningTimeline,
  bindTimelineToolbar,
  setPlanningDurationEditHandler,
} from "./ui/timeline.js";

let toolbarBound = false;
let refreshInProgress = false;

function setPlanningStatus(message = "") {
  const el = document.getElementById("planningStatus");
  if (el) {
    el.textContent = message;
  }
}

function parseIsoDate(isoDate) {
  const text = String(isoDate ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function subtractWeeksFromIsoDate(isoDate, weeks) {
  const rightDate = parseIsoDate(isoDate);
  if (!rightDate) return "";

  const leftDate = new Date(rightDate);
  leftDate.setDate(leftDate.getDate() - (weeks * 7));
  return formatIsoDate(leftDate);
}

function resolvePlanningColumnName(columnKey) {
  const columns = APP_CONFIG.grist.planningTable?.columns || {};
  return String(columns[columnKey] ?? "").trim();
}

function buildZoneOptionsForSelectedProject(planningRows, selectedProject = "") {
  const projectName = toText(selectedProject);
  if (!projectName) return [];

  const columns = APP_CONFIG.grist.planningTable?.columns || {};
  const projectCol = columns.projectLink || columns.nomProjet;
  const zoneCol = columns.zone;
  const zoneValues = new Set();

  for (const row of planningRows || []) {
    if (toText(row?.[projectCol]) !== projectName) continue;
    const zone = toText(row?.[zoneCol]);
    if (!zone) continue;
    zoneValues.add(zone);
  }

  return [...zoneValues].sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base", numeric: true })
  );
}

function normalizeSelectedZone(zoneOptions, selectedZone) {
  const wantedZone = toText(selectedZone);
  if (!wantedZone) return "";

  const wantedKey = wantedZone.toLocaleLowerCase("fr");
  const exact = zoneOptions.find(
    (zone) => toText(zone).toLocaleLowerCase("fr") === wantedKey
  );

  return exact || "";
}

async function handleDurationCellEdit({
  rowId,
  durationWeeks,
  durationSlot,
  durationColumnKey,
  leftDateColumnKey,
  rightIsoDate,
}) {
  const durationColumnName = resolvePlanningColumnName(durationColumnKey);
  if (!durationColumnName) {
    throw new Error("Colonne de durée introuvable dans la configuration.");
  }

  const leftDateColumnName = resolvePlanningColumnName(leftDateColumnKey);
  if (!leftDateColumnName) {
    throw new Error("Colonne de date de gauche introuvable dans la configuration.");
  }

  const normalizedWeeks = Number(durationWeeks);
  if (!Number.isInteger(normalizedWeeks) || normalizedWeeks < 0) {
    throw new Error("La durée doit être un nombre entier de semaines.");
  }

  const normalizedRightIsoDate = String(rightIsoDate ?? "").trim();
  if (!parseIsoDate(normalizedRightIsoDate)) {
    throw new Error("Date de référence à droite introuvable.");
  }

  const leftIsoDate = subtractWeeksFromIsoDate(
    normalizedRightIsoDate,
    normalizedWeeks
  );
  if (!leftIsoDate) {
    throw new Error("Impossible de calculer la date de gauche.");
  }

  const slotLabel = durationSlot === "2" ? "Durée 2" : "Durée 1";
  try {
    setPlanningStatus(`Mise à jour ${slotLabel} en cours...`);

    await updatePlanningDurationAndLeftDate(
      rowId,
      durationColumnName,
      normalizedWeeks,
      leftDateColumnName,
      leftIsoDate
    );

    await refreshPlanning();
  } catch (error) {
    setPlanningStatus(
      `Erreur mise à jour ${slotLabel.toLowerCase()} : ${error.message}`
    );
    throw error;
  }
}

async function refreshPlanning() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    setPlanningStatus("Chargement du planning...");

    const selectedProject = state.selectedProject || "";
    let planningRows = await fetchPlanningRows();
    let syncResult = { updatedCount: 0 };

    try {
      syncResult = await syncCoffrageDiffCoffrageFromGroups(
        planningRows,
        selectedProject
      );
      if (syncResult.updatedCount > 0) {
        planningRows = await fetchPlanningRows();
      }
    } catch (syncError) {
      console.error("Erreur sync Diff_coffrage (groupes) :", syncError);
    }

    const zoneOptions = buildZoneOptionsForSelectedProject(
      planningRows,
      selectedProject
    );
    const normalizedZone = normalizeSelectedZone(zoneOptions, state.selectedZone);
    if (normalizedZone !== (state.selectedZone || "")) {
      setState({ selectedZone: normalizedZone });
    }

    updateZoneSelector(zoneOptions, {
      selectedValue: normalizedZone,
      enabled: Boolean(selectedProject),
    });

    const timelineData = buildTimelineDataFromPlanningRows(
      planningRows,
      selectedProject,
      normalizedZone
    );

    if (!timelineData.rowCount) {
      clearPlanningTimeline();

      if (!selectedProject) {
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

    const projectLabel = selectedProject
      ? `Projet : ${selectedProject}`
      : "Tous les projets";
    const zoneLabel = normalizedZone
      ? `Zone : ${normalizedZone}`
      : "Toutes les zones";

    const emptyPhaseSuffix =
      !timelineData.items || timelineData.items.length === 0
        ? " | Aucune phase exploitable"
        : "";

    setPlanningStatus(
      `${timelineData.rowCount} ligne(s) planning affichée(s) | ${projectLabel} | ${zoneLabel}${emptyPhaseSuffix}`
    );
    if (syncResult.updatedCount > 0) {
      const currentStatus = document.getElementById("planningStatus")?.textContent || "";
      setPlanningStatus(
        `${currentStatus} | Sync Diff_coffrage: ${syncResult.updatedCount} ligne(s)`
      );
    }
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

async function handleZoneChange(currentState) {
  console.log("Zone sélectionnée :", currentState.selectedZone || "(toutes)");
  await refreshPlanning();
}

async function bootstrap() {
  try {
    setState({ selectedProject: "", selectedZone: "" });

    initGrist();
    setPlanningDurationEditHandler(handleDurationCellEdit);

    const projectOptions = await buildProjectOptions();

    initZoneSelector({
      onChange: handleZoneChange,
    });

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
    const zone = document.getElementById("zoneDropdown");
    if (zone) {
      zone.disabled = true;
      zone.innerHTML = `<option value="">Toutes les zones</option>`;
    }

    setPlanningStatus(`Erreur initialisation : ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
