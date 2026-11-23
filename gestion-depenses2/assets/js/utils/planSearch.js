// Recherche d'un plan du projet affiche (fenetre « Rechercher un plan » du
// graphique des depenses).
//
// Un plan = une tache du planning telle que planning-synchro la DESSINE et la
// LISSE. Aucune date n'est recalculee ici : buildChartTasks et smoothTasks sont
// importes de planning-synchro (source unique, pas de copie), avec les memes
// entrees que lui (planning-synchro/assets/js/main.js, loadProject) :
//   - les lignes Planning_Projet du projet, rapprochees sur le nom EXACT ;
//   - les indices cibles de Projets2.Avancement (etat realise de la barre) ;
//   - les reglages Projets2.Lissage du service affiche ;
//   - la date du jour.
// La recherche retrouve donc, pour chaque plan, l'echeance que montre le
// graphique de planning-synchro sans lissage, et celle qu'il montre lisse.
//
// Dependance volontaire vers planning-synchro : si sa regle de lissage evolue,
// la recherche suit sans rien recopier.
//
// Module PUR, sans DOM.
import { buildChartTasks } from "../../../../planning-synchro/assets/js/top/taskLoadModel.js";
import { smoothTasks } from "../../../../planning-synchro/assets/js/top/taskSmoothing.js";
import {
  getServiceSettings,
  hasAnyMax,
} from "../../../../planning-synchro/assets/js/top/smoothingSettings.js";
import { TYPE_META, TYPE_ORDER } from "../../../../planning-synchro/assets/js/top/taskLabels.js";
import { buildProjectRealisationTargetLookup } from "../../../../planning-synchro/assets/js/top/vendor/planningProjetBuilder.js";
import { APP_CONFIG } from "../config.js";
import { toText } from "./format.js";

// Valeurs du filtre « Etat ».
export const PLAN_STATUS = Object.freeze({
  TODO: "a-faire",
  DONE: "realises",
  ADVANCED: "avances",
});

function normalizeSearchText(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

// task : ChartTask de buildChartTasks, ou SmoothedTask de smoothTasks (meme
// tache, avec smoothedIso, monthsAdvanced, moved, pulledFor).
function toPlan(task) {
  const meta = TYPE_META[task.type] || TYPE_META.AUTRES;
  return {
    rowId: task.rowId,
    number: toText(task.id2),
    name: toText(task.name),
    zone: toText(task.zone),
    groupe: toText(task.groupe),
    type: task.type,
    typeLabel: meta.label,
    typeColor: meta.color,
    // Echeance sans lissage : fin de la barre dessinee par le planning.
    dueIso: task.dueIso,
    // Echeance lissee (null sans lissage regle pour le service).
    smoothedIso: task.smoothedIso ?? null,
    monthsAdvanced: task.monthsAdvanced ?? 0,
    moved: Boolean(task.moved),
    // Coffrage avance pour liberer une armature : N° de cette armature.
    pulledFor: task.pulledFor == null ? null : toText(task.pulledFor),
    progress: task.progress,
    realized: task.realized,
    closureLabel: toText(task.closureLabel),
  };
}

// { planningRows, project, service, todayIso } -> {
//     projectName, service, lissageActive, movedCount, plans: Plan[] }
//   project : un projet de buildExpenseData (name, id, projectNumber,
//             avancementConfigRaw, lissageConfigRaw).
//   Plan    : { rowId, number, name, zone, groupe, type, typeLabel, typeColor,
//               dueIso, smoothedIso, monthsAdvanced, moved, pulledFor,
//               progress, realized, closureLabel }, dans l'ordre du graphique
//             de planning-synchro (echeance, N°).
export function buildPlanSearchData({ planningRows, project, service, todayIso }) {
  const projectName = toText(project?.name);
  const projectNameColumn = APP_CONFIG.grist.columns.planningProject.projectName;
  const projectRows = (planningRows || []).filter(
    (row) => toText(row?.[projectNameColumn]) === projectName
  );
  const targetLookup = buildProjectRealisationTargetLookup([{
    projectId: toText(project?.id),
    projectName,
    projectNumber: toText(project?.projectNumber),
    avancementConfigRaw: project?.avancementConfigRaw,
  }]);
  const tasks = buildChartTasks(projectRows, { project: projectName, targetLookup });

  const settings = getServiceSettings(project?.lissageConfigRaw, service);
  const lissageActive = tasks.length > 0 && hasAnyMax(settings);
  const smoothing = lissageActive ? smoothTasks(tasks, settings, todayIso) : null;

  return {
    projectName,
    service: toText(service),
    lissageActive,
    movedCount: smoothing ? smoothing.movedCount : 0,
    plans: (smoothing ? smoothing.tasks : tasks).map(toPlan),
  };
}

// Plans qui correspondent a TOUS les criteres renseignes. N° et nom : texte
// contenu, sans tenir compte des accents ni des majuscules. Zone et type :
// valeur exacte. Etat : PLAN_STATUS. Un critere vide ne filtre rien.
export function filterPlans(plans, { number = "", name = "", zone = "", type = "", status = "" } = {}) {
  const numberQuery = normalizeSearchText(number);
  const nameQuery = normalizeSearchText(name);

  return (plans || []).filter((plan) => {
    if (numberQuery && !normalizeSearchText(plan.number).includes(numberQuery)) return false;
    if (nameQuery && !normalizeSearchText(plan.name).includes(nameQuery)) return false;
    if (zone && plan.zone !== zone) return false;
    if (type && plan.type !== type) return false;
    if (status === PLAN_STATUS.TODO && plan.realized) return false;
    if (status === PLAN_STATUS.DONE && !plan.realized) return false;
    if (status === PLAN_STATUS.ADVANCED && !plan.moved) return false;
    return true;
  });
}

// Zones et types presents dans les plans, pour les listes des filtres. Types
// dans l'ordre et avec les libelles du graphique de planning-synchro.
export function getPlanFilterOptions(plans) {
  const list = plans || [];
  const zones = [...new Set(list.map((plan) => plan.zone).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "fr", { numeric: true, sensitivity: "base" })
  );
  const presentTypes = new Set(list.map((plan) => plan.type));
  const types = TYPE_ORDER.filter((type) => presentTypes.has(type)).map((type) => ({
    value: type,
    label: TYPE_META[type].label,
  }));

  return { zones, types };
}
