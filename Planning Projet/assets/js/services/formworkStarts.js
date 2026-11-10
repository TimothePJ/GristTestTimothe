// Début du plan de coffrage de chaque coffrage de Structure, tel que le planning Structure
// l'affiche dans sa colonne « Début » (date limite de réception des données d'entrées). Cette
// date dépend de la ligne du planning travaux, des durées et des armatures du même groupe :
// elle est donc demandée au calcul du planning Structure lui-même, pas recalculée ici.
import { buildTimelineDataFromPlanningRows } from "./planningService.js";
import { isFormworkRow } from "./structureLinkModel.js";
import { TASK_COLUMNS } from "./syntheseTaskModel.js";
import { parseGristDate } from "./syntheseTasks.js";

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function isStructureRow(row) {
  return toText(row?.[TASK_COLUMNS.service]).toLocaleLowerCase("fr") === "structure";
}

// Les coffrages du projet (N°, zone, début du plan — null sans date), dans l'ordre des ids.
// `projectRows` : Planning_Projet du projet, tous services.
export function buildFormworkStarts(projectRows) {
  const structureRows = (Array.isArray(projectRows) ? projectRows : []).filter(isStructureRow);
  const formworkIds = new Set(structureRows.filter(isFormworkRow).map((row) => Number(row[TASK_COLUMNS.id])));
  // Le planning Structure ne retient que les lignes écrites au nom du projet qu'on lui donne.
  const projectNames = [...new Set(structureRows.map((row) => toText(row[TASK_COLUMNS.project])))].filter(Boolean);
  return projectNames
    .flatMap((projectName) => buildTimelineDataFromPlanningRows(structureRows, projectName).groups)
    .filter((group) => formworkIds.has(Number(group.rowId)))
    .sort((left, right) => Number(left.rowId) - Number(right.rowId))
    .map((group) => ({
      number: toText(group.id2Label),
      zoneName: toText(group.zoneLabel),
      start: parseGristDate(group.debutIso),
    }));
}
