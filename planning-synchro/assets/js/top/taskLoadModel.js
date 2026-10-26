// Modele des taches du graphique : la liste des taches telle que le planning les
// DESSINE.
//
// Le graphique (et le lissage) ne relisent plus les colonnes brutes de
// Planning_Projet (Date_limite / Diff_coffrage / Diff_armature / Realise) : le
// constructeur vendorise (top/vendor/planningProjetBuilder.js) RECALCULE les dates
// comme Planning Projet (coffrage lie a MS Project : demarrage - Duree_3 ; coffrage
// de groupe : plus petite Diff_coffrage des armatures ; debut = fin - Duree_1...) et
// l'etat realise de la barre (indice, indice cible, Date_Cloture). Ce module prend
// ses taches dans la sortie de ce constructeur, donc une tache est comptee le mois
// ou sa barre se termine, et pas ailleurs.
//
// Une ligne que le planning ne dessine pas (pas de type, dates manquantes) n'est
// pas une tache.
//
// Module PUR, sans DOM. Les types sont ceux de top/taskLabels.js (TYPE_ORDER).

import { buildTimelineDataFromPlanningRows } from "./vendor/planningProjetBuilder.js";
import { formatIsoDate } from "../utils/dates.js";

// Suffixe d'un identifiant de barre principale -> type de tache. Les barres
// dessinees sont `${group.id}-p-<phase>` (phase-coffrage, -armature, -ndc,
// -coupes, -demolition, -generic), suffixees -past / -current quand le constructeur
// coupe la barre au jour. Les autres items d'une ligne (`-demarrage`,
// `-reference-reception`) ne portent pas `-p-` et ne sont jamais une tache.
const PHASE_TYPE = {
  coffrage: "COFFRAGE",
  armature: "ARMATURES",
  ndc: "NDC",
  coupes: "COUPES",
  demolition: "DEMOLITION",
  generic: "AUTRES",
};
const PHASE_SUFFIX = /^(coffrage|armature|ndc|coupes|demolition|generic)(?:-past|-current)?$/;

// Pour chaque groupe (ligne du planning), sa barre principale : le premier item
// `${group.id}-p-<phase>` dans l'ordre du constructeur (la moitie passee d'une
// barre coupee precede sa moitie en cours ; les deux portent la meme fin).
function mainPhaseByGroup(items) {
  const byGroup = new Map();
  (items || []).forEach((item) => {
    const groupId = item?.group;
    if (!groupId || byGroup.has(groupId)) return;
    const prefix = `${groupId}-p-`;
    const id = String(item.id ?? "");
    if (!id.startsWith(prefix)) return;
    const match = PHASE_SUFFIX.exec(id.slice(prefix.length));
    if (!match) return;
    byGroup.set(groupId, { item, type: PHASE_TYPE[match[1]] });
  });
  return byGroup;
}

function numericId2(task) {
  const value = Number(String(task.id2).replace(",", "."));
  return task.id2 !== "" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

// Ordre stable : echeance, puis ID2 numerique (les ID2 non numeriques en dernier),
// puis rowId (null en dernier). Exporte : le lissage (top/taskSmoothing.js)
// departage ses taches avec ce meme ordre.
export function compareChartTasks(a, b) {
  if (a.dueIso !== b.dueIso) return a.dueIso < b.dueIso ? -1 : 1;
  const id2A = numericId2(a);
  const id2B = numericId2(b);
  if (id2A !== id2B) return id2A < id2B ? -1 : 1;
  const rowA = a.rowId == null ? Number.POSITIVE_INFINITY : a.rowId;
  const rowB = b.rowId == null ? Number.POSITIVE_INFINITY : b.rowId;
  if (rowA === rowB) return 0;
  return rowA < rowB ? -1 : 1;
}

// rows (lignes brutes Planning_Projet) + projet (+ table des indices cibles) ->
// ChartTask[] triee :
//   { rowId, id2, name, zone, groupe, groupKey, type, dueIso, realized }
//   - dueIso   : fin (date metier) de la barre principale, AAAA-MM-JJ ;
//   - type     : COFFRAGE | ARMATURES | NDC | COUPES | DEMOLITION | AUTRES ;
//   - realized : la barre est realisee a 100 % (pas la colonne Realise stockee) ;
//   - groupKey : cle zone + groupe d'un coffrage / d'une armature (vide sinon),
//                la meme que celle du constructeur (comparaison en minuscules).
export function buildChartTasks(rows, { project = "", targetLookup = null } = {}) {
  const { groups, items } = buildTimelineDataFromPlanningRows(
    rows || [],
    project,
    "",
    targetLookup,
    null
  );
  const mainPhases = mainPhaseByGroup(items);

  const tasks = [];
  (groups || []).forEach((group) => {
    if (!group || group.isZoneHeader) return;
    const phase = mainPhases.get(group.id);
    if (!phase) return;
    const dueIso = formatIsoDate(phase.item.businessEnd);
    if (!dueIso) return;
    tasks.push({
      rowId: group.rowId ?? null,
      id2: group.id2Label ?? "",
      name: group.tachesLabel ?? "",
      zone: group.zoneLabel ?? "",
      groupe: group.groupeLabel ?? "",
      groupKey: group.meta?.groupCompositeKey || "",
      type: phase.type,
      dueIso,
      realized: Number(group.realiseLabel) >= 100,
    });
  });

  return tasks.sort(compareChartTasks);
}
