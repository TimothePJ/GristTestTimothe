import { APP_CONFIG } from "./config.js";
import { state, setState } from "./state.js";
import {
  initGrist,
  buildProjectOptions,
  fetchPlanningRows,
  syncPlanningRealiseValues,
  syncCoffrageDiffCoffrageFromGroups,
  updatePlanningDurationAndLeftDate,
  updatePlanningFromMsProjectDrop,
  updatePlanningGroupZoneFromPlanningDrop,
  updatePlanningZoneFromZoneHeaderDrop,
  addPlanningZoneRow,
  toText,
} from "./services/gristService.js";
import {
  buildPlanningRealiseUpdates,
  buildTimelineDataFromPlanningRows,
} from "./services/planningService.js";
import {
  initProjectSelector,
  initZoneSelector,
  updateZoneSelector,
} from "./ui/selectors.js";
import {
  applyPlanningViewportState,
  renderPlanningTimeline,
  clearPlanningTimeline,
  bindTimelineToolbar,
  getPlanningViewportState,
  setPlanningDurationEditHandler,
  setPlanningMsProjectDropHandler,
  setPlanningRowDropHandler,
  subscribePlanningViewportChanges,
} from "./ui/timeline.js";

let toolbarBound = false;
let refreshInProgress = false;
let addZoneModalBound = false;
let addZoneModalOpen = false;
let planningProjectOptions = [];
let planningSyncApiReady = false;
let suppressPlanningSyncEvents = false;
let currentPlanningDateBounds = null;

const EMBEDDED_PLANNING_SYNC_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("embedded") === "planning-sync";

function setPlanningStatus(message = "") {
  const el = document.getElementById("planningStatus");
  if (el) {
    el.textContent = message;
  }
}

function applyEmbeddedPlanningSyncMode() {
  if (!EMBEDDED_PLANNING_SYNC_MODE || typeof document === "undefined") {
    return;
  }

  document.body.classList.add("planning-sync-embedded");
}

function getAddZoneModalElements() {
  const root = document.getElementById("addZoneModal");
  if (!(root instanceof HTMLElement)) return null;

  return {
    root,
    closeBtn: document.getElementById("addZoneModalCloseBtn"),
    cancelBtn: document.getElementById("addZoneCancelBtn"),
    form: document.getElementById("addZoneForm"),
    projectName: document.getElementById("addZoneProjectName"),
    zoneName: document.getElementById("addZoneName"),
    hint: document.getElementById("addZoneModalHint"),
  };
}

function setAddZoneModalHint(message = "") {
  const els = getAddZoneModalElements();
  if (!els || !(els.hint instanceof HTMLElement)) return;
  els.hint.textContent = String(message ?? "").trim();
}

function closeAddZoneModal() {
  const els = getAddZoneModalElements();
  if (!els) return;

  addZoneModalOpen = false;
  els.root.classList.remove("is-open");
  els.root.setAttribute("aria-hidden", "true");
  els.root.hidden = true;
  document.body.classList.remove("is-add-zone-modal-open");
  setAddZoneModalHint("");
}

function openAddZoneModal() {
  const els = getAddZoneModalElements();
  if (!els) return;

  if (els.projectName instanceof HTMLInputElement) {
    els.projectName.value = state.selectedProject || "";
  }
  if (els.zoneName instanceof HTMLInputElement) {
    els.zoneName.value = "";
  }
  setAddZoneModalHint("");

  els.root.hidden = false;
  els.root.setAttribute("aria-hidden", "false");
  addZoneModalOpen = true;
  document.body.classList.add("is-add-zone-modal-open");
  requestAnimationFrame(() => {
    els.root.classList.add("is-open");
    if (els.zoneName instanceof HTMLInputElement) {
      els.zoneName.focus();
    }
  });
}

function bindAddZoneModal() {
  if (addZoneModalBound) return;
  const els = getAddZoneModalElements();
  if (!els) return;
  addZoneModalBound = true;

  els.root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-zone-modal-close]")) {
      closeAddZoneModal();
    }
  });

  if (els.closeBtn instanceof HTMLElement) {
    els.closeBtn.addEventListener("click", () => closeAddZoneModal());
  }
  if (els.cancelBtn instanceof HTMLElement) {
    els.cancelBtn.addEventListener("click", () => closeAddZoneModal());
  }

  if (els.form instanceof HTMLFormElement) {
    els.form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const projectName = state.selectedProject || "";
      const zoneValue =
        els.zoneName instanceof HTMLInputElement ? els.zoneName.value : "";
      const normalizedZone = toText(zoneValue);

      if (!projectName) {
        setAddZoneModalHint("Selectionne d'abord un projet.");
        return;
      }
      if (!normalizedZone) {
        setAddZoneModalHint("Renseigne un nom de zone.");
        if (els.zoneName instanceof HTMLInputElement) {
          els.zoneName.focus();
        }
        return;
      }

      try {
        setAddZoneModalHint("");
        await addPlanningZoneRow({
          projectName,
          zoneName: normalizedZone,
        });
        closeAddZoneModal();
        await refreshPlanning();
        setPlanningStatus(`Zone ajoutee: ${normalizedZone}`);
      } catch (error) {
        setAddZoneModalHint(`Erreur: ${error.message}`);
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!addZoneModalOpen) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeAddZoneModal();
  });
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

async function handleMsProjectRowDrop({
  planningRowId,
  uniqueNumber,
  payload = null,
  targetTask = "",
}) {
  const targetRowId = Number(planningRowId);
  if (!Number.isInteger(targetRowId) || targetRowId <= 0) {
    throw new Error("Ligne planning cible invalide.");
  }

  const normalizedUniqueNumber = toText(uniqueNumber);
  if (!normalizedUniqueNumber) {
    throw new Error("Numero unique MS Project vide.");
  }

  const taskSuffix = toText(targetTask) ? ` (${toText(targetTask)})` : "";
  const droppedStartIso = toText(payload?.startIso || "");
  const droppedEndIso = toText(payload?.endIso || "");
  const droppedDateLabel =
    droppedStartIso && droppedEndIso
      ? `${droppedStartIso} -> ${droppedEndIso}`
      : (droppedEndIso || droppedStartIso || "");

  try {
    const dateSuffix = droppedDateLabel ? ` | Date: ${droppedDateLabel}` : "";
    setPlanningStatus(`Mise a jour ligne planning${taskSuffix}${dateSuffix}...`);
    await updatePlanningFromMsProjectDrop({
      rowId: targetRowId,
      uniqueNumber: normalizedUniqueNumber,
      msStartIso: droppedStartIso,
      msEndIso: droppedEndIso,
    });
    await refreshPlanning();
    const appliedDateSuffix = droppedDateLabel ? ` | ${droppedDateLabel}` : "";
    setPlanningStatus(
      `Drop applique: Ligne_planning=${normalizedUniqueNumber}${taskSuffix}${appliedDateSuffix}`
    );
  } catch (error) {
    setPlanningStatus(`Erreur drop MS Project : ${error.message}`);
    throw error;
  }
}

async function handlePlanningRowDrop({
  sourcePlanningRowId,
  targetPlanningRowId = null,
  payload = null,
  targetTask = "",
  targetGroupe = "",
  targetZone = "",
  targetZoneKey = "",
}) {
  const sourceRowId = Number(sourcePlanningRowId);
  const destinationRowId = Number(targetPlanningRowId);
  const hasRowDestination =
    Number.isInteger(destinationRowId) && destinationRowId > 0;
  const zoneLabel = toText(targetZone);
  const zoneKey = toText(targetZoneKey);
  const linkedArmatureRowIds = Array.isArray(payload?.linkedArmatureRowIds)
    ? [...new Set(
      payload.linkedArmatureRowIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== sourceRowId)
    )]
    : [];

  if (!Number.isInteger(sourceRowId) || sourceRowId <= 0) {
    throw new Error("Ligne source planning invalide.");
  }
  if (!hasRowDestination && !zoneLabel) {
    throw new Error("Cible planning invalide.");
  }
  if (hasRowDestination && sourceRowId === destinationRowId) {
    return;
  }

  const taskSuffix = toText(targetTask) ? ` (${toText(targetTask)})` : "";
  const unchangedTask = toText(payload?.task);

  try {
    if (hasRowDestination) {
      const groupeLabel = toText(targetGroupe);
      const targetLabelParts = [];
      if (groupeLabel) targetLabelParts.push(`Groupe=${groupeLabel}`);
      if (zoneLabel) targetLabelParts.push(`Zone=${zoneLabel}`);
      const targetLabel = targetLabelParts.length
        ? targetLabelParts.join(" | ")
        : "ligne cible";

      setPlanningStatus(`Deplacement ligne planning vers ${targetLabel}${taskSuffix}...`);
      const result = await updatePlanningGroupZoneFromPlanningDrop({
        sourceRowId,
        targetRowId: destinationRowId,
        linkedRowIds: linkedArmatureRowIds,
      });

      if (result?.updated) {
        await refreshPlanning();
        const appliedParts = [];
        if (toText(result.groupe)) appliedParts.push(`Groupe=${toText(result.groupe)}`);
        if (toText(result.zone)) appliedParts.push(`Zone=${toText(result.zone)}`);
        if (Number(result?.linkedUpdatedCount) > 0) {
          appliedParts.push(`Armatures suiveuses=${Number(result.linkedUpdatedCount)}`);
        }
        const appliedLabel = appliedParts.length ? appliedParts.join(" | ") : targetLabel;
        setPlanningStatus(`Deplacement applique: ${appliedLabel}${taskSuffix}`);
        return;
      }

      if (unchangedTask) {
        setPlanningStatus(`Aucun changement (meme Groupe/Zone) pour ${unchangedTask}.`);
      } else {
        setPlanningStatus("Aucun changement (meme Groupe/Zone).");
      }
      return;
    }

    const zoneTargetLabel = zoneLabel || zoneKey || "zone cible";
    setPlanningStatus(`Deplacement ligne planning vers Zone=${zoneTargetLabel}${taskSuffix}...`);
    const zoneResult = await updatePlanningZoneFromZoneHeaderDrop({
      sourceRowId,
      targetZone: zoneTargetLabel,
      targetZoneKey: zoneKey,
      linkedRowIds: linkedArmatureRowIds,
    });

    if (zoneResult?.updated) {
      await refreshPlanning();
      const appliedZoneLabel = toText(zoneResult?.zone) || "Sans zone";
      const zoneGroupLabel = toText(zoneResult?.groupe);
      const linkedCount = Number(zoneResult?.linkedUpdatedCount) || 0;
      const groupSuffix = zoneGroupLabel ? ` | Groupe=${zoneGroupLabel}` : "";
      const linkedSuffix = linkedCount > 0 ? ` | Armatures suiveuses=${linkedCount}` : "";
      setPlanningStatus(
        `Deplacement applique: Zone=${appliedZoneLabel}${groupSuffix}${linkedSuffix}${taskSuffix}`
      );
      return;
    }

    if (unchangedTask) {
      setPlanningStatus(`Aucun changement (deja dans Zone=${zoneTargetLabel}) pour ${unchangedTask}.`);
    } else {
      setPlanningStatus(`Aucun changement (deja dans Zone=${zoneTargetLabel}).`);
    }
  } catch (error) {
    setPlanningStatus(`Erreur drop Planning : ${error.message}`);
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

    let realiseSyncResult = { updatedCount: 0 };
    try {
      const realiseUpdates = buildPlanningRealiseUpdates(planningRows);
      if (realiseUpdates.length > 0) {
        realiseSyncResult = await syncPlanningRealiseValues(realiseUpdates);
        planningRows = await fetchPlanningRows();
      }
    } catch (realiseSyncError) {
      console.error("Erreur sync Realise (Indice) :", realiseSyncError);
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
    currentPlanningDateBounds = timelineData?.dateBounds || null;

    if (!timelineData.rowCount) {
      currentPlanningDateBounds = null;
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
    if (realiseSyncResult.updatedCount > 0) {
      const currentStatus = document.getElementById("planningStatus")?.textContent || "";
      setPlanningStatus(
        `${currentStatus} | Sync Realise: ${realiseSyncResult.updatedCount} ligne(s)`
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
    applyEmbeddedPlanningSyncMode();
    setState({ selectedProject: "", selectedZone: "" });

    initGrist();
    bindAddZoneModal();
    setPlanningDurationEditHandler(handleDurationCellEdit);
    setPlanningMsProjectDropHandler(handleMsProjectRowDrop);
    setPlanningRowDropHandler(handlePlanningRowDrop);

    const projectOptions = await buildProjectOptions();
    planningProjectOptions = [...projectOptions];

    initZoneSelector({
      onChange: handleZoneChange,
      onAddZone: () => {
        openAddZoneModal();
      },
    });

    initProjectSelector(projectOptions, {
      onChange: handleProjectChange,
    });

    await refreshPlanning();
    planningSyncApiReady = true;
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

function exposePlanningSyncApi() {
  if (typeof window === "undefined") {
    return;
  }

  window.__planningProjetSyncApi = {
    get isReady() {
      return planningSyncApiReady;
    },
    listProjects() {
      return [...planningProjectOptions];
    },
    getSelectedProject() {
      return state.selectedProject || "";
    },
    async setSelectedProject(projectName = "") {
      const normalizedProject = toText(projectName);
      setState({
        selectedProject: normalizedProject,
        selectedZone: "",
      });

      const projectSelect = document.getElementById("projectDropdown");
      if (projectSelect instanceof HTMLSelectElement) {
        projectSelect.value = normalizedProject;
      }

      const zoneSelect = document.getElementById("zoneDropdown");
      if (zoneSelect instanceof HTMLSelectElement) {
        zoneSelect.value = "";
      }

      await refreshPlanning();
      return Boolean(normalizedProject);
    },
    getViewport() {
      return getPlanningViewportState();
    },
    getProjectDateBounds() {
      return currentPlanningDateBounds ? { ...currentPlanningDateBounds } : null;
    },
    applyViewport(viewport = {}) {
      suppressPlanningSyncEvents = true;
      try {
        applyPlanningViewportState(viewport);
      } finally {
        setTimeout(() => {
          suppressPlanningSyncEvents = false;
        }, 0);
      }
    },
    subscribeViewportChange(listener) {
      return subscribePlanningViewportChanges((viewport, meta = {}) => {
        if (suppressPlanningSyncEvents) {
          return;
        }

        if (typeof listener === "function") {
          listener({
            app: "planning-projet",
            projectKey: state.selectedProject || "",
            viewport,
            meta,
          });
        }
      });
    },
  };
}

exposePlanningSyncApi();

document.addEventListener("DOMContentLoaded", bootstrap);
