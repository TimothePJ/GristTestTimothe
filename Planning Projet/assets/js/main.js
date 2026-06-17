import { APP_CONFIG } from "./config.js";
import { state, loadState, setState } from "./state.js";
import {
  initGrist,
  fetchProjectBootstrapData,
  fetchPlanningRows,
  fetchPlanningReferenceReceptionSummaries,
  getPlanningServiceDiagnostics,
  updatePlanningDurationAndLeftDate,
  updatePlanningRetardJustification,
  fetchPlanningReferenceDetails,
  updatePlanningReferenceDetails,
  updatePlanningFromMsProjectDrop,
  updatePlanningGroupZoneFromPlanningDrop,
  updatePlanningZoneFromZoneHeaderDrop,
  addPlanningZoneRow,
  renameProjectZone,
  clearProjectZone,
  initializePlanningRow,
  toText,
} from "./services/gristService.js";
import {
  buildProjectRealisationTargetLookup,
  buildTimelineDataFromPlanningRows,
} from "./services/planningService.js";
import { synchronizePlanningDerivedData } from "./services/planningSyncCoordinator.js";
import {
  applyProjectSelection,
  initProjectSelector,
  initZoneSelector,
  updateProjectSelectorOptions,
  updateZoneSelector,
} from "./ui/selectors.js";
import {
  applyPlanningViewportState,
  renderPlanningTimeline,
  clearPlanningTimeline,
  bindTimelineToolbar,
  getPlanningViewportState,
  refreshPlanningTimelineLayout,
  setPlanningZoomMode,
  movePlanningViewportByMode,
  focusPlanningDataAnchor,
  getPlanningPreferredEmbeddedHeight,
  waitForPlanningViewportSettled,
  setPlanningViewportBounds,
  setPlanningVisualAggregateMode,
  setPlanningDurationEditHandler,
  setPlanningRetardJustificationHandler,
  setPlanningReferenceDetailsHandler,
  setPlanningMsProjectDropHandler,
  setPlanningRowDropHandler,
  setPlanningInitializeHandler,
  subscribePlanningSelectionChanges,
  subscribePlanningViewportChanges,
} from "./ui/timeline.js";

let toolbarBound = false;
let pendingRefreshOptions = null;
let refreshQueuePromise = null;
let resolveRefreshQueue = null;
let cachedPlanningRows = null;
let cachedProjectAvancementConfigs = [];
let cachedRealisationTargetLookup = null;
let cachedPlanningReferenceReceptionLookup = null;
let lastAutoSyncAt = 0;
let lastAutoSyncProject = "";
let lastRenderedProject = "";
let planningLifecycleRefreshBound = false;
let planningLifecycleRefreshTimer = 0;
let projectRegistryRefreshPromise = null;
let addZoneModalBound = false;
let addZoneModalOpen = false;
let manageZoneModalBound = false;
let manageZoneModalOpen = false;
let planningProjectOptions = [];
let planningSyncApiReady = false;
let currentPlanningDateBounds = null;
let planningEditingEnabled = false;
let planningEditToggleBound = false;
const planningWarningListeners = new Set();
let currentPlanningWarnings = [];
let lastPlanningWarningsSignature = "";

const EMBEDDED_PLANNING_SYNC_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("embedded") === "planning-sync";
const AXIS_ONLY_EMBEDDED_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("axisOnly") === "1";
const HEADER_ONLY_EMBEDDED_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("headerOnly") === "1";
const EXTERNAL_AXIS_EMBEDDED_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("externalAxis") === "1";
const PLANNING_AUTO_SYNC_INTERVAL_MS = 60000;
const PLANNING_REFRESH_DEBOUNCE_MS = 30;
const PLANNING_LIFECYCLE_REFRESH_DELAY_MS = 50;
const PLANNING_PERF_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("planningDebug") === "1";

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getDayStart(rawDate) {
  const nextDate = rawDate instanceof Date ? new Date(rawDate) : new Date(rawDate);
  if (Number.isNaN(nextDate.getTime())) {
    return null;
  }

  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function buildPlanningWarningsFromGroups(groups = []) {
  const today = getDayStart(new Date());
  if (!today) {
    return [];
  }

  return (groups || [])
    .filter((group) => group && !group.isZoneHeader)
    .map((group) => {
      const label = [String(group?.id2Label || "").trim(), String(group?.tachesLabel || "").trim()]
        .filter(Boolean)
        .join(" - ") || "Page";
      const realizeValue = toFiniteNumber(group?.realiseLabel);
      const retardDays = toFiniteNumber(group?.retardsLabel) || 0;
      const segmentEndIso = String(group?.finIso || "").trim();
      const segmentEndDate = segmentEndIso ? new Date(`${segmentEndIso}T12:00:00`) : null;
      const normalizedEndDate =
        segmentEndDate instanceof Date && !Number.isNaN(segmentEndDate.getTime())
          ? segmentEndDate
          : null;
      const isCompleted = realizeValue != null && realizeValue >= 100;

      if (isCompleted) {
        return null;
      }

      if (retardDays > 0) {
        return {
          label,
          severity: "danger",
          days: retardDays,
          segmentEndDate: segmentEndIso,
          message: `${label} : ${retardDays} jour(s) de retard.`,
        };
      }

      if (!(realizeValue != null && realizeValue < 100) || !normalizedEndDate) {
        return null;
      }

      const endDay = getDayStart(normalizedEndDate);
      if (!endDay) {
        return null;
      }

      const diffDays = Math.round((endDay.getTime() - today.getTime()) / 86400000);
      if (diffDays < 0 || diffDays >= 7) {
        return null;
      }

      return {
        label,
        severity: "warning",
        days: diffDays,
        segmentEndDate: segmentEndIso,
        message:
          diffDays === 0
            ? `${label} : fin de segment aujourd'hui.`
            : diffDays === 1
            ? `${label} : fin de segment demain.`
            : `${label} : fin de segment dans ${diffDays} jour(s).`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const severityScore = (warning) => (warning?.severity === "danger" ? 0 : 1);
      const severityDelta = severityScore(left) - severityScore(right);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      if (left?.severity === "danger") {
        return (right?.days || 0) - (left?.days || 0);
      }

      return (left?.days || 0) - (right?.days || 0);
    });
}

function emitPlanningWarningsChange(projectKey = "", warnings = []) {
  currentPlanningWarnings = Array.isArray(warnings) ? warnings : [];
  const nextSignature = JSON.stringify({
    projectKey: String(projectKey || "").trim(),
    warnings: currentPlanningWarnings,
  });

  if (nextSignature === lastPlanningWarningsSignature) {
    return;
  }

  lastPlanningWarningsSignature = nextSignature;
  planningWarningListeners.forEach((listener) => {
    listener({
      app: "planning-projet",
      projectKey: String(projectKey || "").trim(),
      warnings: [...currentPlanningWarnings],
    });
  });
}

function setPlanningStatus(message = "") {
  const el = document.getElementById("planningStatus");
  if (el) {
    el.textContent = message;
  }
}

function isPlanningEditingUnlocked() {
  return planningEditingEnabled && !EMBEDDED_PLANNING_SYNC_MODE && !HEADER_ONLY_EMBEDDED_MODE;
}

function updatePlanningEditToggle() {
  if (typeof document === "undefined") return;

  const btn = document.getElementById("planningEditToggle");
  if (!(btn instanceof HTMLButtonElement)) return;

  const isAvailable = !EMBEDDED_PLANNING_SYNC_MODE && !HEADER_ONLY_EMBEDDED_MODE;
  btn.hidden = !isAvailable;
  if (!isAvailable) {
    document.body?.classList.remove("planning-editing-enabled");
    document.body?.classList.add("planning-editing-locked");
    return;
  }

  const enabled = isPlanningEditingUnlocked();
  btn.textContent = enabled ? "Verrouiller" : "Editer";
  btn.setAttribute("aria-pressed", enabled ? "true" : "false");
  btn.title = enabled ? "Verrouiller le planning" : "Activer l'edition du planning";
  btn.classList.toggle("is-editing", enabled);
  document.body?.classList.toggle("planning-editing-enabled", enabled);
  document.body?.classList.toggle("planning-editing-locked", !enabled);
}

function setPlanningEditingEnabled(nextEnabled, { rerender = true, notify = true } = {}) {
  planningEditingEnabled =
    Boolean(nextEnabled) && !EMBEDDED_PLANNING_SYNC_MODE && !HEADER_ONLY_EMBEDDED_MODE;
  updatePlanningEditToggle();

  if (notify) {
    setPlanningStatus(
      planningEditingEnabled
        ? "Edition du planning activee."
        : "Planning verrouille."
    );
  }

  if (rerender) {
    renderPlanningFromCache();
  }
}

function requirePlanningEditing(actionLabel = "modifier le planning") {
  if (isPlanningEditingUnlocked()) {
    return true;
  }

  setPlanningStatus(`Planning verrouille : clique sur Editer pour ${actionLabel}.`);
  return false;
}

function assertPlanningEditing(actionLabel = "modifier le planning") {
  if (requirePlanningEditing(actionLabel)) return;
  throw new Error("Planning verrouille.");
}

function bindPlanningEditToggle() {
  if (planningEditToggleBound) return;
  planningEditToggleBound = true;

  const btn = document.getElementById("planningEditToggle");
  if (!(btn instanceof HTMLButtonElement)) return;

  btn.addEventListener("click", () => {
    setPlanningEditingEnabled(!planningEditingEnabled, {
      rerender: true,
      notify: true,
    });
  });
  updatePlanningEditToggle();
}

function applyEmbeddedPlanningSyncMode() {
  if (!EMBEDDED_PLANNING_SYNC_MODE || typeof document === "undefined") {
    return;
  }

  document.body.classList.add("planning-sync-embedded");
  if (AXIS_ONLY_EMBEDDED_MODE) {
    document.body.classList.add("planning-sync-axis-only");
  }
  if (HEADER_ONLY_EMBEDDED_MODE) {
    document.body.classList.add("planning-sync-header-only");
  }
  if (EXTERNAL_AXIS_EMBEDDED_MODE) {
    document.body.classList.add("planning-sync-external-axis");
  }
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
  if (!requirePlanningEditing("ajouter une zone")) return;

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

      if (!requirePlanningEditing("ajouter une zone")) {
        return;
      }

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
        await refreshPlanning({
          sync: true,
          forceLoad: true,
          forceSync: true,
          reason: "zone-add",
        });
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

function normalizeManageZoneKey(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}

function getManageZoneModalElements() {
  const root = document.getElementById("manageZoneModal");
  if (!(root instanceof HTMLElement)) return null;

  return {
    root,
    closeBtn: document.getElementById("manageZoneModalCloseBtn"),
    projectName: document.getElementById("manageZoneProjectName"),
    zoneSelect: document.getElementById("manageZoneSelect"),
    newName: document.getElementById("manageZoneNewName"),
    renameBtn: document.getElementById("manageZoneRenameBtn"),
    deleteBtn: document.getElementById("manageZoneDeleteBtn"),
    hint: document.getElementById("manageZoneModalHint"),
  };
}

function setManageZoneModalHint(message = "") {
  const els = getManageZoneModalElements();
  if (!els || !(els.hint instanceof HTMLElement)) return;
  els.hint.textContent = String(message ?? "").trim();
}

function getCurrentManageableZoneOptions() {
  const zoneSelect = document.getElementById("zoneDropdown");
  if (!(zoneSelect instanceof HTMLSelectElement)) return [];

  const options = [];
  const seenKeys = new Set();

  for (const option of Array.from(zoneSelect.options || [])) {
    const value = toText(option.value);
    if (!value || value === "__add_zone__" || value === "__manage_zone__" || option.disabled) continue;

    const key = normalizeManageZoneKey(value);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    options.push(value);
  }

  return options;
}

function populateManageZoneSelect(options = [], preferredZone = "") {
  const els = getManageZoneModalElements();
  if (!els || !(els.zoneSelect instanceof HTMLSelectElement)) return "";

  els.zoneSelect.innerHTML = "";

  const preferredKey = normalizeManageZoneKey(preferredZone);
  let selectedValue = "";

  options.forEach((zone) => {
    const value = toText(zone);
    if (!value) return;

    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    els.zoneSelect.appendChild(option);

    if (!selectedValue || normalizeManageZoneKey(value) === preferredKey) {
      selectedValue = value;
    }
  });

  if (selectedValue) {
    els.zoneSelect.value = selectedValue;
  }

  if (els.newName instanceof HTMLInputElement) {
    els.newName.value = selectedValue;
  }

  return selectedValue;
}

function setManageZoneModalBusy(isBusy) {
  const els = getManageZoneModalElements();
  if (!els) return;

  [els.zoneSelect, els.newName, els.renameBtn, els.deleteBtn].forEach((el) => {
    if (el instanceof HTMLElement) {
      el.toggleAttribute("disabled", Boolean(isBusy));
    }
  });
}

function restorePlanningZoneSelection(zoneValue = state.selectedZone || "") {
  const zoneSelect = document.getElementById("zoneDropdown");
  if (!(zoneSelect instanceof HTMLSelectElement)) return;

  const normalizedZone = toText(zoneValue);
  zoneSelect.value = normalizedZone;
  if (zoneSelect.value !== normalizedZone) {
    zoneSelect.value = "";
  }
}

function closeManageZoneModal({ restoreSelection = true } = {}) {
  const els = getManageZoneModalElements();
  if (!els) return;

  manageZoneModalOpen = false;
  els.root.classList.remove("is-open");
  els.root.setAttribute("aria-hidden", "true");
  els.root.hidden = true;
  document.body.classList.remove("is-manage-zone-modal-open");
  setManageZoneModalHint("");
  setManageZoneModalBusy(false);
  if (restoreSelection) {
    restorePlanningZoneSelection();
  }
}

function openManageZoneModal() {
  if (!requirePlanningEditing("modifier les zones")) return;

  const els = getManageZoneModalElements();
  if (!els) return;

  const projectName = toText(state.selectedProject);
  const options = getCurrentManageableZoneOptions();

  if (!projectName) {
    setPlanningStatus("Selectionne d'abord un projet.");
    return;
  }
  if (!options.length) {
    setPlanningStatus("Aucune zone nommee a modifier pour ce projet.");
    return;
  }

  if (els.projectName instanceof HTMLInputElement) {
    els.projectName.value = projectName;
  }

  populateManageZoneSelect(options, state.selectedZone || "");
  setManageZoneModalHint("");
  setManageZoneModalBusy(false);

  els.root.hidden = false;
  els.root.setAttribute("aria-hidden", "false");
  manageZoneModalOpen = true;
  document.body.classList.add("is-manage-zone-modal-open");
  requestAnimationFrame(() => {
    els.root.classList.add("is-open");
    if (els.newName instanceof HTMLInputElement) {
      els.newName.focus();
      els.newName.select();
    }
  });
}

function bindManageZoneModal() {
  if (manageZoneModalBound) return;
  const els = getManageZoneModalElements();
  if (!els) return;
  manageZoneModalBound = true;

  if (els.closeBtn instanceof HTMLElement) {
    els.closeBtn.addEventListener("click", () => closeManageZoneModal());
  }

  if (els.zoneSelect instanceof HTMLSelectElement) {
    els.zoneSelect.addEventListener("change", () => {
      if (els.newName instanceof HTMLInputElement) {
        els.newName.value = els.zoneSelect.value;
        els.newName.focus();
        els.newName.select();
      }
      setManageZoneModalHint("");
    });
  }

  if (els.renameBtn instanceof HTMLElement) {
    els.renameBtn.addEventListener("click", async () => {
      if (!requirePlanningEditing("modifier les zones")) {
        return;
      }

      const projectName = toText(state.selectedProject);
      const sourceZone =
        els.zoneSelect instanceof HTMLSelectElement ? toText(els.zoneSelect.value) : "";
      const targetZone =
        els.newName instanceof HTMLInputElement ? toText(els.newName.value) : "";
      const sourceKey = normalizeManageZoneKey(sourceZone);
      const targetKey = normalizeManageZoneKey(targetZone);

      if (!projectName) {
        setManageZoneModalHint("Selectionne d'abord un projet.");
        return;
      }
      if (!sourceKey) {
        setManageZoneModalHint("Selectionne une zone a renommer.");
        return;
      }
      if (!targetKey) {
        setManageZoneModalHint("Renseigne le nouveau nom de zone.");
        if (els.newName instanceof HTMLInputElement) {
          els.newName.focus();
        }
        return;
      }

      const duplicate = getCurrentManageableZoneOptions().some((zone) => {
        const key = normalizeManageZoneKey(zone);
        return key === targetKey && key !== sourceKey;
      });
      if (duplicate) {
        setManageZoneModalHint("Une zone avec ce nom existe deja pour ce projet.");
        return;
      }

      try {
        setManageZoneModalBusy(true);
        setManageZoneModalHint("Renommage en cours...");
        await renameProjectZone({
          projectName,
          sourceZone,
          targetZone,
        });
        closeManageZoneModal({ restoreSelection: false });
        setState({ selectedZone: targetZone });
        await refreshPlanning({
          sync: true,
          forceLoad: true,
          forceSync: true,
          reason: "zone-rename",
        });
        setPlanningStatus(`Zone renommee: ${sourceZone} -> ${targetZone}.`);
      } catch (error) {
        setManageZoneModalBusy(false);
        setManageZoneModalHint(`Erreur: ${error.message}`);
      }
    });
  }

  if (els.deleteBtn instanceof HTMLElement) {
    els.deleteBtn.addEventListener("click", async () => {
      if (!requirePlanningEditing("modifier les zones")) {
        return;
      }

      const projectName = toText(state.selectedProject);
      const sourceZone =
        els.zoneSelect instanceof HTMLSelectElement ? toText(els.zoneSelect.value) : "";
      const sourceKey = normalizeManageZoneKey(sourceZone);

      if (!projectName) {
        setManageZoneModalHint("Selectionne d'abord un projet.");
        return;
      }
      if (!sourceKey) {
        setManageZoneModalHint("Selectionne une zone a supprimer.");
        return;
      }

      const confirmed = window.confirm(
        `Supprimer la zone "${sourceZone}" ? Les documents seront conserves et passeront en Sans zone.`
      );
      if (!confirmed) return;

      try {
        setManageZoneModalBusy(true);
        setManageZoneModalHint("Suppression de la zone en cours...");
        await clearProjectZone({
          projectName,
          sourceZone,
        });
        closeManageZoneModal({ restoreSelection: false });
        setState({ selectedZone: "" });
        await refreshPlanning({
          sync: true,
          forceLoad: true,
          forceSync: true,
          reason: "zone-delete",
        });
        setPlanningStatus(`Zone supprimee: ${sourceZone}.`);
      } catch (error) {
        setManageZoneModalBusy(false);
        setManageZoneModalHint(`Erreur: ${error.message}`);
      }
    });
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

// Ré-affiche immédiatement le planning à partir du cache local (sans aller
// chercher les données sur Grist), pour donner un retour visuel instantané
// après une édition. La réconciliation complète arrive ensuite via
// refreshPlanning({ forceLoad: true, ... }).
function renderPlanningFromCache() {
  const selectedProject = state.selectedProject || "";
  if (!selectedProject || !Array.isArray(cachedPlanningRows)) return;

  const zoneOptions = buildZoneOptionsForSelectedProject(cachedPlanningRows, selectedProject);
  const normalizedZone = normalizeSelectedZone(zoneOptions, state.selectedZone);
  const timelineData = buildTimelineDataFromPlanningRows(
    cachedPlanningRows,
    selectedProject,
    normalizedZone,
    cachedRealisationTargetLookup,
    cachedPlanningReferenceReceptionLookup
  );
  if (!timelineData.rowCount) return;
  timelineData.resetViewport = false;
  timelineData.editingEnabled = isPlanningEditingUnlocked();
  renderPlanningTimeline(timelineData);
}

// Applique localement les champs modifiés sur la ligne en cache (mise à jour
// optimiste) et redessine immédiatement, avant que l'écriture Grist et la
// réconciliation complète ne se terminent.
function applyOptimisticPlanningRowUpdate(rowId, fieldUpdates) {
  if (!Array.isArray(cachedPlanningRows)) return;

  const cfg = APP_CONFIG.grist.planningTable?.columns || {};
  const targetId = Number(rowId);
  const index = cachedPlanningRows.findIndex((row) => Number(row?.[cfg.id]) === targetId);
  if (index === -1) return;

  cachedPlanningRows = cachedPlanningRows.slice();
  cachedPlanningRows[index] = { ...cachedPlanningRows[index], ...fieldUpdates };

  renderPlanningFromCache();
}

async function handleDurationCellEdit({
  rowId,
  durationWeeks,
  durationSlot,
  durationColumnKey,
  leftDateColumnKey,
  rightIsoDate,
}) {
  assertPlanningEditing("modifier les durees");

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

    // Mise à jour optimiste : retour visuel immédiat avant la confirmation
    // Grist, qui arrive via la réconciliation complète ci-dessous.
    applyOptimisticPlanningRowUpdate(rowId, {
      [durationColumnName]: normalizedWeeks,
      [leftDateColumnName]: leftIsoDate,
    });

    await updatePlanningDurationAndLeftDate(
      rowId,
      durationColumnName,
      normalizedWeeks,
      leftDateColumnName,
      leftIsoDate
    );

    await refreshPlanning({
      sync: true,
      forceLoad: true,
      forceSync: true,
      reason: "duration-edit",
    });
  } catch (error) {
    setPlanningStatus(
      `Erreur mise à jour ${slotLabel.toLowerCase()} : ${error.message}`
    );
    throw error;
  }
}

async function handleRetardJustificationEdit({ rowId, remarque }) {
  assertPlanningEditing("modifier les justifications");

  const recordId = Number(rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  try {
    setPlanningStatus("Sauvegarde de la justification du retard...");
    await updatePlanningRetardJustification(recordId, remarque);
    await refreshPlanning({ forceLoad: true, reason: "retard-justification" });
  } catch (error) {
    setPlanningStatus(`Erreur justification retard : ${error.message}`);
    throw error;
  }
}

async function handleReferenceDetailsAction({ action, context = {}, updates = [] } = {}) {
  const recordId = Number(context?.rowId);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Identifiant de ligne Planning_Projet invalide.");
  }

  if (action === "load") {
    return fetchPlanningReferenceDetails(recordId);
  }

  if (action === "save") {
    assertPlanningEditing("modifier les details references");

    setPlanningStatus("Sauvegarde des détails références...");
    const result = await updatePlanningReferenceDetails(recordId, updates);
    await refreshPlanning({ forceLoad: true, reason: "reference-details-save" });
    return result;
  }

  throw new Error("Action détails références invalide.");
}

async function handlePlanningRowInitialize({ rowId }) {
  assertPlanningEditing("initialiser une ligne");

  try {
    setPlanningStatus("Initialisation de la ligne...");
    await initializePlanningRow(rowId);
    await refreshPlanning({
      sync: false,
      forceLoad: true,
      reason: "initialize-row",
    });
  } catch (err) {
    setPlanningStatus(`Erreur initialisation : ${err.message}`);
    throw err;
  }
}

async function handleMsProjectRowDrop({
  planningRowId,
  uniqueNumber,
  payload = null,
  targetTask = "",
}) {
  assertPlanningEditing("deposer un planning MS Project");

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
  const droppedXmlName = toText(payload?.xmlName || "");
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
      xmlName: droppedXmlName,
      msStartIso: droppedStartIso,
      msEndIso: droppedEndIso,
    });
    await refreshPlanning({
      sync: true,
      forceLoad: true,
      forceSync: true,
      reason: "ms-project-drop",
    });
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
  assertPlanningEditing("deplacer une ligne");

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
        await refreshPlanning({
          sync: true,
          forceLoad: true,
          forceSync: true,
          reason: "planning-row-drop",
        });
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
      await refreshPlanning({
        sync: true,
        forceLoad: true,
        forceSync: true,
        reason: "planning-zone-drop",
      });
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

function mergeRefreshOptions(current = null, next = {}) {
  return {
    sync: Boolean(current?.sync || next?.sync),
    forceLoad: Boolean(current?.forceLoad || next?.forceLoad),
    forceSync: Boolean(current?.forceSync || next?.forceSync),
    reason: [current?.reason, next?.reason].filter(Boolean).join(",") || "refresh",
  };
}

function tracePlanningPerformance(label, details = {}) {
  if (!PLANNING_PERF_DEBUG) return;
  console.info(`[Planning Projet perf] ${label}`, details);
}

async function performPlanningRefresh(options = {}) {
  const startedAt = performance.now();
  const diagnosticsBefore = getPlanningServiceDiagnostics();
  let fetchDurationMs = 0;
  let syncDurationMs = 0;
  let buildDurationMs = 0;
  let renderDurationMs = 0;
  try {
    if (HEADER_ONLY_EMBEDDED_MODE) {
      return;
    }

    const selectedProject = state.selectedProject || "";
    if (!selectedProject) {
      currentPlanningDateBounds = null;
      cachedPlanningReferenceReceptionLookup = null;
      lastRenderedProject = "";
      clearPlanningTimeline();
      emitPlanningWarningsChange("", []);
      updateZoneSelector([], { selectedValue: "", enabled: false });
      setPlanningStatus("");
      return;
    }

    setPlanningStatus("Chargement du planning...");
    if (options.forceLoad || !Array.isArray(cachedPlanningRows)) {
      const fetchStartedAt = performance.now();
      cachedPlanningRows = await fetchPlanningRows();
      fetchDurationMs += performance.now() - fetchStartedAt;
    }

    let syncResult = { updatedCount: 0 };
    const syncDue =
      options.forceSync ||
      lastAutoSyncProject !== selectedProject ||
      !lastAutoSyncAt ||
      Date.now() - lastAutoSyncAt >= PLANNING_AUTO_SYNC_INTERVAL_MS;
    if (options.sync && syncDue) {
      const syncStartedAt = performance.now();
      try {
        syncResult = await synchronizePlanningDerivedData({
          planningRows: cachedPlanningRows,
          selectedProject,
          projectAvancementConfigs: cachedProjectAvancementConfigs,
          realisationTargetLookup: cachedRealisationTargetLookup,
        });
        lastAutoSyncAt = Date.now();
        lastAutoSyncProject = selectedProject;
        if (syncResult.updatedCount > 0) {
          const resyncStartedAt = performance.now();
          cachedPlanningRows = await fetchPlanningRows();
          fetchDurationMs += performance.now() - resyncStartedAt;
        }
      } catch (syncError) {
        console.error("Erreur synchronisation Planning Projet :", syncError);
      } finally {
        syncDurationMs += performance.now() - syncStartedAt;
      }
    }

    const planningRows = cachedPlanningRows || [];
    const referenceSummaryStartedAt = performance.now();
    cachedPlanningReferenceReceptionLookup =
      await fetchPlanningReferenceReceptionSummaries(planningRows);
    fetchDurationMs += performance.now() - referenceSummaryStartedAt;

    const zoneOptions = buildZoneOptionsForSelectedProject(planningRows, selectedProject);
    const normalizedZone = normalizeSelectedZone(zoneOptions, state.selectedZone);
    if (normalizedZone !== (state.selectedZone || "")) {
      setState({ selectedZone: normalizedZone });
    }

    updateZoneSelector(zoneOptions, {
      selectedValue: normalizedZone,
      enabled: Boolean(selectedProject),
    });

    const buildStartedAt = performance.now();
    const timelineData = buildTimelineDataFromPlanningRows(
      planningRows,
      selectedProject,
      normalizedZone,
      cachedRealisationTargetLookup,
      cachedPlanningReferenceReceptionLookup
    );
    buildDurationMs += performance.now() - buildStartedAt;
    timelineData.resetViewport = lastRenderedProject !== selectedProject;
    timelineData.editingEnabled = isPlanningEditingUnlocked();
    lastRenderedProject = selectedProject;
    const planningWarnings = buildPlanningWarningsFromGroups(
      timelineData?.groups || []
    );
    currentPlanningDateBounds = timelineData?.dateBounds || null;

    if (!timelineData.rowCount) {
      currentPlanningDateBounds = null;
      clearPlanningTimeline();
      emitPlanningWarningsChange(selectedProject, []);

      if (!selectedProject) {
        setPlanningStatus("");
      } else {
        setPlanningStatus("Aucune ligne trouvée dans la table de planning.");
      }
      return;
    }

    const renderStartedAt = performance.now();
    renderPlanningTimeline(timelineData);
    await waitForPlanningViewportSettled();
    renderDurationMs += performance.now() - renderStartedAt;
    emitPlanningWarningsChange(selectedProject, planningWarnings);

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
        `${currentStatus} | Synchronisation: ${syncResult.updatedCount} ligne(s)`
      );
    }
  } catch (error) {
    console.error("Erreur refresh planning :", error);
    clearPlanningTimeline();
    emitPlanningWarningsChange(state.selectedProject || "", []);
    setPlanningStatus(`Erreur planning : ${error.message}`);
  } finally {
    const diagnosticsAfter = getPlanningServiceDiagnostics();
    tracePlanningPerformance("refresh", {
      reason: options.reason,
      sync: Boolean(options.sync),
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      cachedRowCount: cachedPlanningRows?.length || 0,
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
      fetchDurationMs: Math.round(fetchDurationMs * 10) / 10,
      syncDurationMs: Math.round(syncDurationMs * 10) / 10,
      buildDurationMs: Math.round(buildDurationMs * 10) / 10,
      renderDurationMs: Math.round(renderDurationMs * 10) / 10,
    });
  }
}

async function drainPlanningRefreshQueue() {
  try {
    while (pendingRefreshOptions) {
      const options = pendingRefreshOptions;
      pendingRefreshOptions = null;
      await performPlanningRefresh(options);
    }
  } finally {
    const resolve = resolveRefreshQueue;
    refreshQueuePromise = null;
    resolveRefreshQueue = null;
    resolve?.();
  }
}

function refreshPlanning(options = {}) {
  pendingRefreshOptions = mergeRefreshOptions(pendingRefreshOptions, options);
  if (!refreshQueuePromise) {
    refreshQueuePromise = new Promise((resolve) => {
      resolveRefreshQueue = resolve;
    });
    window.setTimeout(() => {
      void drainPlanningRefreshQueue();
    }, PLANNING_REFRESH_DEBOUNCE_MS);
  }
  return refreshQueuePromise;
}

function applyProjectBootstrapData({
  projectOptions = [],
  projectAvancementConfigs = [],
} = {}, {
  notify = false,
  clearInvalid = true,
  fallbackToState = false,
} = {}) {
  cachedProjectAvancementConfigs = projectAvancementConfigs;
  cachedRealisationTargetLookup = buildProjectRealisationTargetLookup(
    cachedProjectAvancementConfigs
  );
  planningProjectOptions = projectOptions.map((project) => project.name);
  return updateProjectSelectorOptions(projectOptions, {
    notify,
    clearInvalid,
    fallbackToState,
  });
}

function refreshProjectRegistryFromGrist({
  notify = true,
  clearInvalid = true,
} = {}) {
  if (HEADER_ONLY_EMBEDDED_MODE) {
    return Promise.resolve({ project: null, changed: false, missing: false });
  }
  if (projectRegistryRefreshPromise) {
    return projectRegistryRefreshPromise;
  }

  projectRegistryRefreshPromise = fetchProjectBootstrapData()
    .then((bootstrapData) => {
      const result = applyProjectBootstrapData(bootstrapData, {
        notify,
        clearInvalid,
        fallbackToState: false,
      });
      return result;
    })
    .catch((error) => {
      console.warn("Impossible de recharger la liste des projets :", error);
      return { project: null, changed: false, missing: true };
    })
    .finally(() => {
      projectRegistryRefreshPromise = null;
    });
  return projectRegistryRefreshPromise;
}

function bindPlanningLifecycleRefresh() {
  if (planningLifecycleRefreshBound || HEADER_ONLY_EMBEDDED_MODE) return;
  planningLifecycleRefreshBound = true;

  const requestIfDue = async () => {
    const projectResult = await refreshProjectRegistryFromGrist({
      notify: true,
      clearInvalid: true,
    });
    if (projectResult.changed) {
      return;
    }
    if (
      !state.selectedProject ||
      (
        lastAutoSyncProject === state.selectedProject &&
        Date.now() - lastAutoSyncAt < PLANNING_AUTO_SYNC_INTERVAL_MS
      )
    ) {
      return;
    }
    void refreshPlanning({
      sync: true,
      forceLoad: true,
      reason: "widget-resume",
    });
  };

  const scheduleRequest = () => {
    if (planningLifecycleRefreshTimer) {
      window.clearTimeout(planningLifecycleRefreshTimer);
    }
    planningLifecycleRefreshTimer = window.setTimeout(() => {
      planningLifecycleRefreshTimer = 0;
      void requestIfDue();
    }, PLANNING_LIFECYCLE_REFRESH_DELAY_MS);
  };

  window.addEventListener("pageshow", scheduleRequest);
  window.addEventListener("focus", scheduleRequest);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleRequest();
    }
  });
}

async function handleProjectChange(currentState) {
  console.log("Projet sélectionné :", currentState.selectedProject || "(aucun)");
  await refreshPlanning({ sync: true, forceLoad: true, reason: "project-change" });
}

async function handleZoneChange(currentState) {
  console.log("Zone sélectionnée :", currentState.selectedZone || "(toutes)");
  await refreshPlanning({ reason: "zone-change" });
}

async function bootstrap() {
  try {
    applyEmbeddedPlanningSyncMode();
    loadState();
    bindPlanningEditToggle();

    initGrist();
    if (HEADER_ONLY_EMBEDDED_MODE) {
      renderPlanningTimeline({ groups: [], items: [], editingEnabled: false });
      bindTimelineToolbar();
      toolbarBound = true;
      await waitForPlanningViewportSettled();
      planningSyncApiReady = true;
      return;
    }

    bindAddZoneModal();
    bindManageZoneModal();
    setPlanningDurationEditHandler(handleDurationCellEdit);
    setPlanningRetardJustificationHandler(handleRetardJustificationEdit);
    if (!EMBEDDED_PLANNING_SYNC_MODE) {
      setPlanningReferenceDetailsHandler(handleReferenceDetailsAction);
    }
    setPlanningMsProjectDropHandler(handleMsProjectRowDrop);
    setPlanningRowDropHandler(handlePlanningRowDrop);
    setPlanningInitializeHandler(handlePlanningRowInitialize);
    const {
      projectOptions,
      projectAvancementConfigs,
    } = await fetchProjectBootstrapData();
    cachedProjectAvancementConfigs = projectAvancementConfigs;
    cachedRealisationTargetLookup = buildProjectRealisationTargetLookup(
      cachedProjectAvancementConfigs
    );
    planningProjectOptions = projectOptions.map((project) => project.name);

    initZoneSelector({
      onChange: handleZoneChange,
      onAddZone: () => {
        if (!requirePlanningEditing("ajouter une zone")) return;
        openAddZoneModal();
      },
      onManageZone: () => {
        if (!requirePlanningEditing("modifier les zones")) return;
        openManageZoneModal();
      },
    });

    initProjectSelector(projectOptions, {
      onChange: handleProjectChange,
      onMissingProject: () =>
        refreshProjectRegistryFromGrist({
          notify: true,
          clearInvalid: true,
        }),
      emitInitialChange: false,
    });
    bindPlanningLifecycleRefresh();

    await refreshPlanning({
      sync: true,
      forceLoad: true,
      reason: "bootstrap",
    });
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
      if (HEADER_ONLY_EMBEDDED_MODE) {
        setState({
          selectedProject: normalizedProject,
          selectedZone: "",
        });
      } else {
        let selectionResult = applyProjectSelection(normalizedProject, {
          notify: false,
          persist: true,
          clearInvalid: !normalizedProject,
        });
        if (selectionResult.missing) {
          await refreshProjectRegistryFromGrist({
            notify: false,
            clearInvalid: false,
          });
          selectionResult = applyProjectSelection(normalizedProject, {
            notify: false,
            persist: true,
            clearInvalid: false,
          });
        }
        if (normalizedProject && !selectionResult.project) {
          return false;
        }
      }

      const zoneSelect = document.getElementById("zoneDropdown");
      if (zoneSelect instanceof HTMLSelectElement) {
        zoneSelect.value = "";
      }

      await refreshPlanning({
        sync: !HEADER_ONLY_EMBEDDED_MODE,
        forceLoad: !HEADER_ONLY_EMBEDDED_MODE,
        reason: "sync-api-project-change",
      });
      await waitForPlanningViewportSettled();
      return Boolean(normalizedProject);
    },
    getViewport() {
      return getPlanningViewportState();
    },
    refreshLayout() {
      return refreshPlanningTimelineLayout();
    },
    getProjectDateBounds() {
      return currentPlanningDateBounds ? { ...currentPlanningDateBounds } : null;
    },
    setViewportBounds(bounds = {}) {
      setPlanningViewportBounds(bounds);
    },
    setVisualAggregateMode(enabled = false) {
      return setPlanningVisualAggregateMode(enabled);
    },
    getPreferredEmbeddedHeight() {
      return getPlanningPreferredEmbeddedHeight();
    },
    setZoomMode(mode, anchorDate = "") {
      return setPlanningZoomMode(mode, anchorDate);
    },
    moveViewportByMode(direction = 1) {
      return movePlanningViewportByMode(direction);
    },
    focusDataAnchor() {
      return focusPlanningDataAnchor();
    },
    async applyViewport(viewport = {}) {
      return await Promise.resolve(applyPlanningViewportState(viewport));
    },
    subscribeViewportChange(listener) {
      return subscribePlanningViewportChanges((viewport, meta = {}) => {
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
    subscribeSelectionChange(listener) {
      return subscribePlanningSelectionChanges((selection, meta = {}) => {
        if (typeof listener === "function") {
          listener({
            app: "planning-projet",
            projectKey: state.selectedProject || "",
            selection,
            meta,
          });
        }
      });
    },
    getWarnings() {
      return [...currentPlanningWarnings];
    },
    subscribeWarningsChange(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      planningWarningListeners.add(listener);
      return () => {
        planningWarningListeners.delete(listener);
      };
    },
  };
}

exposePlanningSyncApi();

document.addEventListener("DOMContentLoaded", bootstrap);
