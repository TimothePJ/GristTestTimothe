// Ordre libre des tâches de la vue Synthese et chaînage automatique, façon MS Project : où va
// une tâche ajoutée ou déplacée, la renumérotation de son conteneur (colonne Ordre), les liens
// qui changent (la tâche suit celle du dessus, la chaîne se referme là où elle était) et les
// dates qui suivent. Module pur, sans DOM ni Grist : il rend les champs à écrire, par ligne.
import {
  NO_ZONE_LABEL,
  PLANNING_TABLE,
  TASK_COLUMNS,
  buildMoveFields,
  buildNewTask,
  buildTaskFields,
  dateFieldsOf,
  findGroup,
  resolveDropTarget,
} from "./syntheseTaskModel.js";
import { cascadeFrom, computeLinkedDates, formatLink } from "./syntheseLinks.js";

// Place d'une tâche pas encore créée, dans un conteneur simulé (aucune ligne Grist n'a l'id 0).
export const NEW_TASK_ID = 0;

function rowIdOf(item) {
  return item.kind === "task" ? item.task.id : item.group.rowId;
}

function orderOf(item) {
  return (item.kind === "task" ? item.task.order : item.group.order) ?? null;
}

// Un conteneur des sections : le niveau zone d'une zone (ses tâches hors étage), un étage, un
// cycle ou un sous-groupe. `key` suit le format des lignes d'en-tête (« zone:… », « floor:…/… »,
// « group:… ») ; `floor` est l'étage du conteneur (null au niveau zone) ; `items` son contenu
// dans l'ordre affiché. null s'il n'existe pas.
export function findContainer(sections, { zoneKey = "", floorKey = "", groupRowId = null } = {}) {
  const section = (sections || []).find((candidate) => candidate.zoneKey === zoneKey);
  if (!section) return null;
  if (groupRowId) {
    for (const floor of section.floors) {
      const group = floor.groups.find((candidate) => candidate.rowId === groupRowId);
      if (group) return { key: `group:${groupRowId}`, section, floor, group, items: group.items };
    }
    return null;
  }
  if (floorKey) {
    const floor = section.floors.find((candidate) => candidate.key === floorKey);
    return floor ? { key: `floor:${zoneKey}/${floorKey}`, section, floor, group: null, items: floor.items } : null;
  }
  return {
    key: `zone:${zoneKey}`,
    section,
    floor: null,
    group: null,
    items: section.items.filter((item) => item.kind === "task"),
  };
}

// Le conteneur d'une tâche, ou null.
export function locateTask(sections, taskId) {
  for (const section of sections || []) {
    if (section.items.some((item) => item.kind === "task" && item.task.id === taskId)) {
      return findContainer(sections, { zoneKey: section.zoneKey });
    }
    for (const floor of section.floors) {
      const task = floor.tasks.find((candidate) => candidate.id === taskId);
      if (task) return findContainer(sections, { zoneKey: section.zoneKey, floorKey: floor.key, groupRowId: task.groupRowId });
    }
  }
  return null;
}

// La tâche pilote d'un cycle bâti en parallèle — l'une de ses tâches, à toute profondeur, d'ordinaire
// la plus longue — si chaque autre élément finit avec elle : une tâche par un lien fin → fin sans
// décalage, un sous-cycle bâti de même autour de sa propre tâche pilote, qui finit avec elle. Un
// sous-cycle sans tâche est ignoré. null sinon, ou sans tâche. `links` : id → lien.
export function parallelPilotOf(group, links) {
  const heads = [];
  for (const item of group.items) {
    if (item.kind === "group" && !item.group.tasks?.length) continue;
    const head = item.kind === "task" ? item.task.id : parallelPilotOf(item.group, links);
    if (head == null) return null;
    heads.push(head);
  }
  const finishesWith = (head, pilot) => {
    const link = links.get(head);
    return link?.type === "FF" && link.predId === pilot && !link.lag;
  };
  return heads.find((pilot) => heads.every((head) => head === pilot || finishesWith(head, pilot))) ?? null;
}

// Ids des tâches d'un contenu dans l'ordre de chaîne : l'ordre affiché, sauf dans un cycle en
// parallèle (`group`), qui commence par l'élément de sa tâche pilote — c'est elle qui suit la tâche
// d'avant le cycle.
function chainIds(key, items, overrides, group = null) {
  const chunks = (overrides.get(key) || items).map((item) => {
    if (item.kind === "task") return [item.task.id];
    if (item.kind === "group") return chainIds(`group:${item.group.rowId}`, item.group.items, overrides, item.group);
    return [];
  });
  const pilot = group ? parallelPilotOf(group, linkMap(group.tasks || [])) : null;
  const lead = pilot == null ? -1 : chunks.findIndex((chunk) => chunk.includes(pilot));
  if (lead > 0) chunks.unshift(...chunks.splice(lead, 1));
  return chunks.flat();
}

// Ids des tâches de l'étage d'un conteneur — cycles et sous-groupes traversés, lignes de groupe
// ignorées — ou des tâches du niveau zone, dans l'ordre de chaîne : l'ordre affiché, un cycle en
// parallèle commençant par sa tâche pilote (voir chainIds). `container.group` : le cycle dont on
// veut seulement le contenu (voir blockOf). `overrides` (clé de conteneur → éléments) remplace le
// contenu de conteneurs pour simuler un placement.
export function taskOrder(container, overrides = new Map()) {
  if (container.floor) {
    return chainIds(`floor:${container.section.zoneKey}/${container.floor.key}`, container.floor.items, overrides);
  }
  return chainIds(container.key, container.items, overrides, container.group || null);
}

// Rangs 1, 2, 3… (texte) du contenu d'un conteneur dans l'ordre voulu : seulement les lignes
// dont le rang change. La place d'une nouvelle tâche (NEW_TASK_ID) est ignorée : son rang va
// dans ses propres champs.
export function renumberItems(items) {
  const changes = new Map();
  (items || []).forEach((item, index) => {
    const rowId = rowIdOf(item);
    if (!rowId || orderOf(item) === index + 1) return;
    changes.set(rowId, { [TASK_COLUMNS.order]: String(index + 1) });
  });
  return changes;
}

// Champs par ligne → écritures Grist : une BulkUpdateRecord par jeu de colonnes identique (une
// UpdateRecord pour une ligne seule), ids triés. Une ligne n'est jamais écrite dans une colonne
// qu'elle ne change pas.
export function buildUpdateActions(changes) {
  const groups = new Map();
  [...changes.keys()].sort((left, right) => left - right).forEach((rowId) => {
    const fields = changes.get(rowId);
    const columns = Object.keys(fields).sort();
    if (!columns.length) return;
    const signature = columns.join("\n");
    if (!groups.has(signature)) groups.set(signature, { columns, rowIds: [] });
    groups.get(signature).rowIds.push(rowId);
  });
  return [...groups.values()].map(({ columns, rowIds }) => {
    if (rowIds.length === 1) return ["UpdateRecord", PLANNING_TABLE, rowIds[0], changes.get(rowIds[0])];
    const values = Object.fromEntries(columns.map((column) => [column, rowIds.map((rowId) => changes.get(rowId)[column])]));
    return ["BulkUpdateRecord", PLANNING_TABLE, rowIds, values];
  });
}

// Place « avant / après » une tâche, dans son conteneur : `place` porte la zone, l'étage et le
// conteneur d'arrivée (groupRowId) ; partagée avec le glisser des cycles (syntheseCycles.js).
export function taskSlot(place, line, side) {
  const placement = side === "before" ? "before" : "after";
  return {
    ...place,
    key: `slot:${line.taskId}:${placement}`,
    label: `${placement === "before" ? "Placer avant" : "Placer après"} « ${line.name} »`,
    position: { taskId: line.taskId, side: placement },
  };
}

// Place « avant » un cycle, dans le conteneur de ce cycle (`parentGroupRowId`, null : l'étage) ;
// partagée avec le glisser des cycles.
export function groupBeforeSlot(place, line) {
  return {
    ...place,
    key: `slot:group:${line.groupRowId}:before`,
    groupRowId: line.parentGroupRowId,
    label: `Placer avant « ${line.groupLabel} »`,
    position: { groupRowId: line.groupRowId, side: "before" },
  };
}

// Cible d'un dépôt d'après la ligne survolée et sa moitié (`side` : "before" pour la moitié
// haute, "after" pour la basse). Sans la colonne Ordre (`canOrder` faux) : le conteneur de la
// ligne, comme avant. Avec : sur une tâche, une place avant ou après elle dans son conteneur (rien
// sur la tâche glissée elle-même) ; sur la moitié haute d'une ligne de cycle, la place avant ce
// cycle, dans son conteneur ; sur une ligne de zone, d'étage ou de groupe (moitié basse), la fin de
// ce conteneur.
export function resolveDropSlot(line, side, { canOrder = false, draggedTaskId = null } = {}) {
  const target = resolveDropTarget(line);
  if (!target || !canOrder) return target;
  if (line.kind === "task") {
    if (line.taskId === draggedTaskId) return null;
    return taskSlot(target, line, side);
  }
  if (line.kind === "group" && side === "before") return groupBeforeSlot(target, line);
  if (line.kind === "zone") {
    return { ...target, label: `Déplacer à la fin du niveau de la zone « ${line.zoneName || NO_ZONE_LABEL} »` };
  }
  return { ...target, label: `Déplacer à la fin de « ${line.kind === "group" ? line.groupLabel : line.floorName} »` };
}

/* ---------- Chaînage automatique ---------- */

// Les briques exportées ici (tâches, liens, dates, place d'un dépôt) servent aussi à la règle du
// bloc des cycles (syntheseCycles.js) et à leur mode escalier / parallèle (syntheseCycleModes.js).
export function allTasksOf(sections) {
  return (sections || []).flatMap((section) => section.tasks);
}

export function mergeChanges(target, source) {
  source.forEach((fields, rowId) => target.set(rowId, { ...target.get(rowId), ...fields }));
  return target;
}

function isFinishToStart(link, predId) {
  return link?.type === "FD" && link.predId === predId;
}

// La tâche `taskId` (lien `link`) suit-elle en fin → début ce qui est juste au-dessus d'elle dans
// l'ordre de chaîne : la tâche `above`, ou un cycle qui finit juste au-dessus d'elle (son bloc,
// `overrides` compris, finit par `above` et contient le prédécesseur) ? La tâche sous un cycle en
// parallèle suit d'ordinaire sa tâche pilote, pas la dernière de la chaîne. `scope` : les sections
// et les contenus simulés.
export function followsAbove(link, above, taskId, { sections = [], overrides = new Map() } = {}) {
  if (link?.type !== "FD" || above == null) return false;
  if (link.predId === above) return true;
  const aboveTask = allTasksOf(sections).find((task) => task.id === above);
  for (let group = aboveTask?.groupRowId ? findGroup(sections, aboveTask.groupRowId) : null; group; group = group.parentGroup) {
    const ids = chainIds(`group:${group.rowId}`, group.items, overrides, group);
    if (ids.includes(taskId) || ids[ids.length - 1] !== above) return false;
    if (ids.includes(link.predId)) return true;
  }
  return false;
}

// La tâche que suit une tâche `taskId` placée juste sous `above` dans l'ordre de chaîne : `above`, ou
// la tâche pilote du cycle en parallèle le plus englobant qui finit en `above` sans la contenir
// (`overrides` compris) — tout y finit avec elle, et la tâche du dessous y reste accrochée quand une
// autre tâche du cycle part. null sans `above`.
export function anchorAbove(above, taskId, { sections = [], overrides = new Map() } = {}) {
  if (above == null) return null;
  let anchor = above;
  const aboveTask = allTasksOf(sections).find((task) => task.id === above);
  for (let group = aboveTask?.groupRowId ? findGroup(sections, aboveTask.groupRowId) : null; group; group = group.parentGroup) {
    const ids = chainIds(`group:${group.rowId}`, group.items, overrides, group);
    if (ids.includes(taskId) || ids[ids.length - 1] !== above) break;
    const pilot = parallelPilotOf(group, linkMap(group.tasks || []));
    if (pilot != null && pilot !== taskId && ids.includes(pilot)) anchor = pilot;
  }
  return anchor;
}

// Une tâche placée sous `above` garde-t-elle son lien `link` ? Oui s'il désigne déjà la tâche à
// suivre (`anchor`) : quel que soit son type quand c'est `above`, en fin → début seulement quand c'est
// la tâche pilote d'un cycle en parallèle (un fin → fin n'y tenait qu'au cycle).
export function keepsLink(link, anchor, above) {
  return link?.predId === anchor && (anchor === above || link.type === "FD");
}

function sameLink(left, right) {
  if (!left || !right) return !left && !right;
  return left.predId === right.predId && left.type === right.type && (left.lag || 0) === (right.lag || 0);
}

function sameDay(left, right) {
  if (!(left instanceof Date) || !(right instanceof Date)) return left == null && right == null;
  return left.getTime() === right.getTime();
}

// Lien de chaque tâche (id → { predId, type, lag } ou null).
export function linkMap(tasks) {
  return new Map(tasks.map((task) => [task.id, task.link || null]));
}

// Colonne Lien des seules tâches dont le lien change ("" : plus de lien).
export function linkChanges(original, links) {
  const changes = new Map();
  links.forEach((link, rowId) => {
    if (sameLink(original.get(rowId) || null, link)) return;
    changes.set(rowId, { [TASK_COLUMNS.link]: link ? formatLink(link) : "" });
  });
  return changes;
}

// La chaîne se referme à l'ancienne place d'une tâche (A au-dessus, B en dessous, dans `order`) :
// si elle suivait A — ou le cycle qui finit en A (voir followsAbove) — et que B la suivait, en
// fin → début, B suit ce qu'elle suivait avec son propre décalage. Renvoie l'id de B rattachée, ou
// null.
function closeChain(links, order, taskId, scope) {
  const index = order.indexOf(taskId);
  if (index <= 0 || index >= order.length - 1) return null;
  const above = order[index - 1];
  const below = order[index + 1];
  const link = links.get(taskId);
  if (!followsAbove(link, above, taskId, scope) || !isFinishToStart(links.get(below), taskId)) return null;
  links.set(below, { predId: link.predId, type: "FD", lag: links.get(below).lag || 0 });
  return below;
}

// Une tâche à sa nouvelle place dans `order` (P au-dessus, N en dessous) : elle suit P — ou la tâche
// pilote du cycle en parallèle qui finit en P (voir anchorAbove) ; son lien est gardé s'il la désigne
// déjà, quel que soit son type ; sans P, plus de lien. N la suit si N suivait P — ou le cycle qui
// finit en P (voir followsAbove) — en fin → début (décalage gardé). Jamais de boucle : si P dépend d'elle, la tâche de
// la chaîne de P qui la suivait reprend son ancien lien (`former`), ou plus de lien. Renvoie l'id
// de cette tâche rattachée à l'ancien lien (ses dates et celles de sa chaîne sont à recalculer
// avant celles de la tâche), ou null.
function placeInChain(links, order, taskId, former, scope) {
  const index = order.indexOf(taskId);
  const above = index > 0 ? order[index - 1] : null;
  const below = index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  const anchor = anchorAbove(above, taskId, scope);
  if (anchor === null) links.set(taskId, null);
  else if (!keepsLink(links.get(taskId), anchor, above)) links.set(taskId, { predId: anchor, type: "FD", lag: 0 });
  // N ne la suit pas si elle-même dépend déjà de N (boucle).
  if (
    above !== null && below !== null && followsAbove(links.get(below), above, below, scope) &&
    findUpstream(links, taskId, (rowId) => rowId === below) == null
  ) {
    links.set(below, { predId: taskId, type: "FD", lag: links.get(below).lag || 0 });
  }
  const current = findUpstream(links, anchor, (rowId) => links.get(rowId)?.predId === taskId);
  if (current == null) return null;
  // L'ancien lien n'est repris que s'il ne ferme pas à son tour une boucle.
  const loops = former ? findUpstream(links, former.predId, (rowId) => rowId === current) != null : false;
  const relinked = former && former.predId !== current && !loops ? { ...former } : null;
  links.set(current, relinked);
  return relinked ? current : null;
}

// En remontant les prédécesseurs de proche en proche depuis `fromId` (compris), la première
// tâche qui vérifie `matches`, ou null ; une boucle saisie à la main arrête la remontée.
export function findUpstream(links, fromId, matches) {
  const seen = new Set();
  for (let current = fromId; current != null && !seen.has(current); current = links.get(current)?.predId ?? null) {
    if (matches(current)) return current;
    seen.add(current);
  }
  return null;
}

// Les liens d'une ligne supprimée disparaissent avec elle : les tâches restantes qui la
// désignaient n'ont plus de lien (Grist réutilise les ids).
export function clearOrphans(links, removed) {
  links.forEach((link, rowId) => {
    if (link && removed.has(link.predId) && !removed.has(rowId)) links.set(rowId, null);
  });
}

// Dates après un changement de liens : chaque tâche racine prend les dates que lui donne son lien
// (son prédécesseur doit être daté), puis ses tâches liées en aval suivent. Renvoie les champs de
// dates des seules tâches qui changent.
export function recomputeDates(tasks, links, rootIds) {
  const original = new Map(tasks.map((task) => [task.id, task]));
  const current = new Map(tasks.map((task) => [task.id, { ...task, link: links.has(task.id) ? links.get(task.id) : task.link }]));
  rootIds.forEach((rootId) => {
    const root = current.get(rootId);
    if (!root) return;
    const pred = root.link ? current.get(root.link.predId) : null;
    const dates = pred ? computeLinkedDates(pred, root.link, root.durationDays) : null;
    const next = dates ? { ...root, ...dates } : root;
    current.set(rootId, next);
    cascadeFrom(next, [...current.values()]).forEach((update) => current.set(update.id, update));
  });
  const changes = new Map();
  current.forEach((task, rowId) => {
    const before = original.get(rowId);
    if (sameDay(before.start, task.start) && sameDay(before.end, task.end) && before.isMilestone === task.isMilestone) return;
    changes.set(rowId, dateFieldsOf(task));
  });
  return changes;
}

// Place d'une nouvelle tâche dans son conteneur : juste sous la tâche cliquée, sinon à la fin.
function insertionIndex(items, afterTaskId) {
  const index = afterTaskId ? items.findIndex((item) => item.kind === "task" && item.task.id === afterTaskId) : -1;
  return index >= 0 ? index + 1 : items.length;
}

// L'élément d'un conteneur que désigne une position de dépôt : un cycle (`groupRowId`) ou une
// tâche (`taskId`).
function isPositionItem(item, position) {
  if (position.groupRowId != null) return item.kind === "group" && item.group.rowId === position.groupRowId;
  return item.kind === "task" && item.task.id === position.taskId;
}

// Place visée par un dépôt dans `items` (sans l'élément déplacé) : avant ou après une tâche, ou
// avant un cycle ; sans position (ligne d'en-tête), ou élément introuvable : à la fin.
export function slotIndex(items, position) {
  const index = position ? items.findIndex((item) => isPositionItem(item, position)) : -1;
  if (index < 0) return items.length;
  return position.side === "before" ? index : index + 1;
}

// « Ajouter une tâche » dans un conteneur ({ zoneKey, floorKey, groupRowId }), juste sous
// `afterTaskId` s'il en fait partie, sinon à la fin. Sans la colonne Ordre (`canOrder` faux) : à
// la fin, sans rang ni lien, comme avant ; `atEnd` dit qu'une place sous une tâche était demandée.
// Avec Ordre et Lien (`canLink`) : la tâche suit la tâche du dessus (FD) et en prend ses dates —
// sans dates si celle-ci n'en a pas ; `follow` désigne la tâche du dessous qui devra la suivre une
// fois son id connu. Dans un cycle en parallèle (`finishWith` : sa tâche pilote), elle finit au
// contraire avec la tâche pilote (lien fin → fin, un jour) et personne ne la suit. Renvoie la
// tâche, ses champs Grist, les rangs des autres lignes, `follow`, `atEnd` ; null si le conteneur
// n'existe pas.
export function planTaskInsert({
  sections,
  container,
  afterTaskId = null,
  canOrder = false,
  canLink = false,
  finishWith = null,
  today = new Date(),
  projectName = "",
} = {}) {
  const destination = findContainer(sections, container || {});
  if (!destination) return null;
  const { section, floor, group } = destination;
  let task = buildNewTask({
    zoneName: section.zoneName,
    groupName: floor ? floor.name : "",
    groupTasks: group ? group.tasks : floor ? floor.tasks : destination.items.map((item) => item.task),
    today,
    parentId: group ? group.rowId : null,
  });
  const changes = new Map();
  const extra = {};
  let follow = null;
  if (canOrder) {
    const index = insertionIndex(destination.items, afterTaskId);
    const placeholder = { kind: "task", task: { id: NEW_TASK_ID, order: null } };
    const placed = [...destination.items.slice(0, index), placeholder, ...destination.items.slice(index)];
    mergeChanges(changes, renumberItems(placed));
    extra[TASK_COLUMNS.order] = String(index + 1);
    if (canLink) {
      const order = taskOrder(destination, new Map([[destination.key, placed]]));
      const at = order.indexOf(NEW_TASK_ID);
      const tasksById = new Map(allTasksOf(sections).map((candidate) => [candidate.id, candidate]));
      const scope = { sections, overrides: new Map([[destination.key, placed]]) };
      const above = at > 0 ? tasksById.get(anchorAbove(order[at - 1], NEW_TASK_ID, scope)) : null;
      const below = at < order.length - 1 ? tasksById.get(order[at + 1]) : null;
      const pilot = finishWith != null ? tasksById.get(finishWith) : null;
      if (pilot) {
        const link = { predId: pilot.id, type: "FF", lag: 0 };
        const dates = computeLinkedDates(pilot, link, 1) || { start: null, end: null, durationDays: 1, isMilestone: false };
        task = { ...task, ...dates, link };
        extra[TASK_COLUMNS.link] = formatLink(link);
      } else if (above) {
        const link = { predId: above.id, type: "FD", lag: 0 };
        const dates = computeLinkedDates(above, link, 1) || { start: null, end: null, durationDays: 1, isMilestone: false };
        task = { ...task, ...dates, link };
        extra[TASK_COLUMNS.link] = formatLink(link);
        if (below && followsAbove(below.link, order[at - 1], below.id, scope)) follow = { successorId: below.id, lag: below.link.lag || 0 };
      }
    }
  }
  return {
    task,
    fields: { ...buildTaskFields(task, { projectName }), ...extra },
    changes,
    follow,
    atEnd: Boolean(afterTaskId) && !canOrder,
  };
}

// Second temps d'un ajout (voir planTaskInsert) : une fois connu l'id de la nouvelle tâche, la
// tâche du dessous la suit (avec son décalage) et ses dates suivent en cascade.
export function planInsertFollowUp({ sections, newTask, successorId, lag = 0 } = {}) {
  const tasks = [...allTasksOf(sections).filter((task) => task.id !== newTask.id), newTask];
  const links = linkMap(tasks);
  if (!links.has(successorId)) return new Map();
  const original = new Map(links);
  links.set(successorId, { predId: newTask.id, type: "FD", lag });
  return mergeChanges(linkChanges(original, links), recomputeDates(tasks, links, [successorId]));
}

// Glisser une tâche vers une cible (conteneur, et `position` { taskId, side } avec la colonne
// Ordre) : ses champs de déplacement (Zone, Groupe, Parent), les rangs du conteneur d'arrivée,
// et avec Lien (`canLink`) la chaîne refermée à l'ancienne place, la tâche chaînée à la nouvelle
// et les dates qui suivent. Champs par ligne ; vide si rien ne change (même place).
export function planTaskMove({ sections, taskId, target, canOrder = false, canLink = false } = {}) {
  const source = locateTask(sections, taskId);
  const destination = findContainer(sections, target || {});
  if (!source || !destination) return new Map();
  const item = source.items.find((candidate) => candidate.kind === "task" && candidate.task.id === taskId);
  const moveFields = buildMoveFields(item.task, target);
  const changes = new Map();
  if (Object.keys(moveFields).length) changes.set(taskId, moveFields);
  if (!canOrder) return changes;
  const remaining = destination.items.filter((candidate) => candidate !== item);
  const index = slotIndex(remaining, target.position);
  const placed = [...remaining.slice(0, index), item, ...remaining.slice(index)];
  if (source.key === destination.key && placed.every((candidate, at) => candidate === destination.items[at])) {
    return new Map();
  }
  mergeChanges(changes, renumberItems(placed));
  if (!canLink) return changes;
  const overrides = new Map([[destination.key, placed]]);
  if (source.key !== destination.key) overrides.set(source.key, source.items.filter((candidate) => candidate !== item));
  // Même conteneur, même ordre de chaîne (la tâche pilote d'un cycle en parallèle mène la chaîne où
  // qu'elle soit affichée) : ni lien ni date ne change.
  const formerOrder = taskOrder(source);
  const order = taskOrder(destination, overrides);
  if (source.key === destination.key && order.every((rowId, at) => rowId === formerOrder[at])) return changes;
  const tasks = allTasksOf(sections);
  const links = linkMap(tasks);
  const original = new Map(links);
  const former = links.get(taskId);
  const closed = closeChain(links, formerOrder, taskId, { sections });
  const relinked = placeInChain(links, order, taskId, former, { sections, overrides });
  mergeChanges(changes, linkChanges(original, links));
  return mergeChanges(changes, recomputeDates(tasks, links, [closed, relinked, taskId].filter((rowId) => rowId != null)));
}

// Supprimer une tâche : avec Lien, la chaîne se referme à sa place (puis les dates suivent) et
// les autres liens qui la désignaient sont effacés. Champs des lignes restantes.
export function planTaskRemoval({ sections, taskId, canLink = false } = {}) {
  if (!canLink) return new Map();
  const container = locateTask(sections, taskId);
  const tasks = allTasksOf(sections);
  const links = linkMap(tasks);
  const original = new Map(links);
  const closed = container ? closeChain(links, taskOrder(container), taskId, { sections }) : null;
  clearOrphans(links, new Set([taskId]));
  links.delete(taskId);
  original.delete(taskId);
  const remaining = tasks.filter((task) => task.id !== taskId);
  return mergeChanges(linkChanges(original, links), recomputeDates(remaining, links, closed ? [closed] : []));
}

// Supprimer un étage, un cycle ou un sous-groupe (`removedIds` : toutes ses lignes) : avec Lien,
// les liens des tâches restantes qui désignaient une ligne supprimée sont effacés.
export function planOrphanLinks({ sections, removedIds = [], canLink = false } = {}) {
  if (!canLink) return new Map();
  const removed = new Set(removedIds);
  const tasks = allTasksOf(sections).filter((task) => !removed.has(task.id));
  const links = linkMap(tasks);
  const original = new Map(links);
  clearOrphans(links, removed);
  return linkChanges(original, links);
}
