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

// Repli sans `navigator.locks` : on attend que le jeton posé dans localStorage expire
// ou soit rendu. L'attente est bornée — le verrou lui-même expire en 30 s, patienter
// au-delà signifierait qu'il n'est plus tenu par personne.
async function waitForFreeStorageLock({ timeoutMs = 30000, pollMs = 120 } = {}) {
  const giveUpAt = Date.now() + timeoutMs;
  for (;;) {
    let current = null;
    try {
      current = JSON.parse(localStorage.getItem(PLANNING_SYNC_LOCK_STORAGE_KEY) || "null");
    } catch (_error) {
      return;
    }
    if (!(current?.expiresAt > Date.now())) return;
    if (Date.now() >= giveUpAt) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// `blocking` distingue deux besoins opposés. La synchronisation automatique est
// opportuniste : si une autre passe tourne déjà, la sauter ne perd rien. Une écriture
// demandée par l'utilisateur, elle, doit attendre son tour — l'abandonner
// silencieusement lui ferait croire que son action n'a servi à rien.
async function withPlanningSyncLock(task, { blocking = false } = {}) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    // L'échec de la tâche et l'échec du verrou remontent par le même canal. Sans les
    // distinguer, une écriture qui échoue serait prise pour un verrou indisponible,
    // puis REJOUÉE par le chemin de repli : le lot partirait deux fois.
    let taskStarted = false;
    try {
      return await navigator.locks.request(
        PLANNING_SYNC_LOCK_NAME,
        blocking ? { mode: "exclusive" } : { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) return { skippedByLock: true, updatedCount: 0 };
          taskStarted = true;
          return task();
        }
      );
    } catch (error) {
      if (taskStarted) throw error;
      console.warn("Verrou navigateur Planning Projet indisponible :", error);
    }
  }

  const token = `${Date.now()}-${Math.random()}`;
  let acquiredLocally = false;
  try {
    if (blocking) {
      await waitForFreeStorageLock();
    }
    const now = Date.now();
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
    // Même règle ici : une fois la tâche lancée, son échec lui appartient. Le rejouer
    // enverrait le lot d'écritures une seconde fois.
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

// Écriture demandée explicitement par l'utilisateur : elle attend son tour derrière la
// synchronisation automatique plutôt que d'être sautée. Sans ce verrou, la passe
// automatique (toutes les 60 s) peut recalculer Diff_coffrage par-dessus le lot.
export function runExclusivePlanningWrite(task) {
  return withPlanningSyncLock(task, { blocking: true });
}
