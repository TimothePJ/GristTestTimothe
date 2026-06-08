import { APP_CONFIG } from "../config.js";
import {
  buildCoffrageDiffCoffrageUpdates,
  fetchListePlanRows,
  syncPlanningDerivedValues,
  toText,
} from "./gristService.js";
import {
  buildPlanningListePlanSyncUpdates,
  buildPlanningRealiseUpdates,
  buildPlanningRetardUpdates,
} from "./planningService.js";

const PLANNING_SYNC_LOCK_NAME = "planning-projet-derived-sync";
const PLANNING_SYNC_LOCK_STORAGE_KEY = "planning-projet.derived-sync-lock";

function getProjectPlanningRows(planningRows, selectedProject) {
  const columns = APP_CONFIG.grist.planningTable?.columns || {};
  const projectCol = columns.projectLink || columns.nomProjet || "NomProjet";
  const projectName = toText(selectedProject);
  if (!projectName) return [];
  return (planningRows || []).filter((row) => toText(row?.[projectCol]) === projectName);
}

function mergeDerivedUpdatesIntoRows(rows, updates = []) {
  const columns = APP_CONFIG.grist.planningTable?.columns || {};
  const idCol = columns.id || "id";
  const fieldsById = new Map();

  updates.forEach((update) => {
    const rowId = Number(update?.id);
    if (!Number.isInteger(rowId) || rowId <= 0) return;
    const fields = {
      ...(fieldsById.get(rowId) || {}),
      ...(update?.fields || {}),
    };
    if (Object.prototype.hasOwnProperty.call(update, "indice")) {
      fields[columns.indice || "Indice"] = update.indice;
    }
    if (Object.prototype.hasOwnProperty.call(update, "realise")) {
      fields[columns.realise || "Realise"] = update.realise;
    }
    if (Object.prototype.hasOwnProperty.call(update, "dateRealise")) {
      fields[columns.dateRealise || "Date_Realise"] = update.dateRealise;
    }
    if (Object.prototype.hasOwnProperty.call(update, "retards")) {
      fields[columns.retards || "Retards"] = update.retards;
    }
    fieldsById.set(rowId, fields);
  });

  return (rows || []).map((row) => {
    const fields = fieldsById.get(Number(row?.[idCol]));
    return fields ? { ...row, ...fields } : row;
  });
}

async function withPlanningSyncLock(task) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    try {
      return await navigator.locks.request(
        PLANNING_SYNC_LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => lock ? task() : { skippedByLock: true, updatedCount: 0 }
      );
    } catch (error) {
      console.warn("Verrou navigateur Planning Projet indisponible :", error);
    }
  }

  const token = `${Date.now()}-${Math.random()}`;
  const now = Date.now();
  let acquiredLocally = false;
  try {
    const current = JSON.parse(localStorage.getItem(PLANNING_SYNC_LOCK_STORAGE_KEY) || "null");
    if (current?.expiresAt > now) {
      return { skippedByLock: true, updatedCount: 0 };
    }
    localStorage.setItem(
      PLANNING_SYNC_LOCK_STORAGE_KEY,
      JSON.stringify({ token, expiresAt: now + 30000 })
    );
    const acquired = JSON.parse(
      localStorage.getItem(PLANNING_SYNC_LOCK_STORAGE_KEY) || "null"
    );
    if (acquired?.token !== token) {
      return { skippedByLock: true, updatedCount: 0 };
    }
    acquiredLocally = true;
    return await task();
  } catch (error) {
    if (!acquiredLocally) {
      console.warn("Verrou local Planning Projet indisponible :", error);
      return task();
    }
    throw error;
  } finally {
    try {
      const current = JSON.parse(localStorage.getItem(PLANNING_SYNC_LOCK_STORAGE_KEY) || "null");
      if (current?.token === token) {
        localStorage.removeItem(PLANNING_SYNC_LOCK_STORAGE_KEY);
      }
    } catch (_error) {
      // Le verrou expirera naturellement.
    }
  }
}

async function runPlanningDerivedSync({
  planningRows,
  selectedProject,
  projectAvancementConfigs,
  realisationTargetLookup,
}) {
  const projectRows = getProjectPlanningRows(planningRows, selectedProject);
  if (!projectRows.length) {
    return { updatedCount: 0 };
  }

  const coffrageResult = buildCoffrageDiffCoffrageUpdates(projectRows, selectedProject);
  let workingRows = coffrageResult.rows;
  const allUpdates = [...coffrageResult.updates];

  const listePlanResult = await fetchListePlanRows();
  if (listePlanResult?.tableName) {
    const listePlanUpdates = buildPlanningListePlanSyncUpdates(
      workingRows,
      listePlanResult.rows,
      projectAvancementConfigs,
      realisationTargetLookup
    );
    allUpdates.push(...listePlanUpdates);
    workingRows = mergeDerivedUpdatesIntoRows(workingRows, listePlanUpdates);
  }

  const realiseUpdates = buildPlanningRealiseUpdates(workingRows, realisationTargetLookup);
  allUpdates.push(...realiseUpdates);
  workingRows = mergeDerivedUpdatesIntoRows(workingRows, realiseUpdates);

  const retardUpdates = buildPlanningRetardUpdates(
    workingRows,
    undefined,
    realisationTargetLookup
  );
  allUpdates.push(...retardUpdates);

  const syncResult = await syncPlanningDerivedValues({
    planningRows: projectRows,
    updates: allUpdates,
  });
  return {
    ...syncResult,
    coffrageUpdatedCount: coffrageResult.updates.length,
  };
}

export function synchronizePlanningDerivedData(options = {}) {
  return withPlanningSyncLock(() => runPlanningDerivedSync(options));
}
