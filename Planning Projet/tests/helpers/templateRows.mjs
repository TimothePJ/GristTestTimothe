// Lignes Planning_Projet d'une zone (ligne de zone id 10) avec un étage créé d'après le modèle
// (ligne-étage firstId, puis les 25 lignes du modèle), Parent et Lien déjà écrits.
import {
  FLOOR_TEMPLATE,
  buildFloorFromTemplate,
  buildTemplateLinks,
} from "../../assets/js/services/syntheseFloorTemplate.js";
import { cascadeFrom } from "../../assets/js/services/syntheseLinks.js";
import { dateFieldsOf, isTaskRow, readTask } from "../../assets/js/services/syntheseTaskModel.js";

// Durées (jours ouvrés) de la capture MS Project de l'utilisateur, par code du modèle : le
// modèle crée ses tâches à 0, les tests les saisissent comme le ferait l'utilisateur.
export const CAPTURE_DAYS = Object.freeze({
  T0: 0, T1: 2, T2: 0, T3: 10, T4: 10, T5: 5, T6: 0,
  T7: 5, T8: 5, T9: 2, T10: 2, T11: 0,
  T12: 5, T13: 10, T14: 5, T15: 2, T16: 2, T17: 0, T18: 0, T19: 0,
});

// Une entrée du modèle est une tâche, sauf les cycles et les sous-groupes.
export function isTemplateTask(item) {
  return item.nature !== "Cycle" && item.nature !== "Sous-groupe";
}

export function templateRows({ zoneName = "Zone Z3A", floorName = "SS1", firstId = 201 } = {}) {
  const fields = buildFloorFromTemplate({ floorName, zoneName, projectName: "HOTEL DIEU" });
  const ids = fields.map((_, index) => firstId + index);
  const { fieldsById } = buildTemplateLinks(ids);
  return [
    {
      id: 10, NomProjet: "HOTEL DIEU", Taches: "", Type_doc: "", ID2: "", Zone: zoneName, Groupe: "", Etage: false,
      Nature: "", Parent: "", Lien: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0,
    },
    ...fields.map((row, index) => ({
      id: ids[index],
      Type_doc: "",
      ID2: "",
      Parent: "",
      Lien: "",
      Diff_coffrage: null,
      Diff_armature: null,
      ...row,
      ...(fieldsById.get(ids[index]) || {}),
    })),
  ];
}

// Les mêmes lignes avec les durées de la capture, datées par la cascade depuis
// RECEPTION ARCH/TOPO/STR (firstId + 1) au 02/01/26.
export function datedRows(options = {}) {
  const firstId = options.firstId ?? 201;
  const rows = templateRows(options).map((row) => ({ ...row }));
  FLOOR_TEMPLATE.forEach((item, index) => {
    if (isTemplateTask(item)) rows.find((row) => row.id === firstId + 1 + index).Duree_1 = CAPTURE_DAYS[item.code];
  });
  const first = rows.find((row) => row.id === firstId + 1);
  first.Diff_coffrage = "2026-01-02";
  first.Diff_armature = "2026-01-02";
  const tasks = rows.filter(isTaskRow).map(readTask);
  cascadeFrom(tasks.find((task) => task.id === first.id), tasks).forEach((task) => {
    Object.assign(rows.find((row) => row.id === task.id), dateFieldsOf(task));
  });
  return rows;
}
