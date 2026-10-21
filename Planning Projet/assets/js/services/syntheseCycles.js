// Cycles et sous-cycles imbriqués de la vue Synthese : où naît un cycle (à la fin de l'étage ou
// d'un autre cycle), les champs de sa ligne Planning_Projet et la renumérotation (colonne Ordre)
// de son conteneur ; un cycle déplacé ou supprimé, selon la règle du bloc : ses tâches bougent
// d'un seul tenant, la chaîne de liens se referme à l'ancienne place et se renoue à la nouvelle,
// et les dates suivent. Module pur, sans DOM ni Grist : il rend les champs à écrire, par ligne.
import { NATURES, TASK_COLUMNS, findGroup, groupRemovalIds, natureKeyOf } from "./syntheseTaskModel.js";
import {
  allTasksOf,
  clearOrphans,
  findContainer,
  findUpstream,
  groupBeforeSlot,
  linkChanges,
  linkMap,
  mergeChanges,
  recomputeDates,
  renumberItems,
  slotIndex,
  taskOrder,
  taskSlot,
} from "./syntheseTaskOrder.js";

export const NEW_CYCLE_NAME = "Nouveau cycle";
export const NEW_SUBCYCLE_NAME = "Nouveau sous-cycle";

// Valeur de Nature écrite selon la profondeur : « Cycle » directement dans l'étage, « Sous-groupe »
// dans un autre cycle. L'affichage suit la place réelle, jamais cette valeur.
export function natureForDepth(depth) {
  return depth <= 1 ? NATURES.cycle : NATURES.subgroup;
}

// Création d'un cycle (parentGroupRowId null : directement dans l'étage) ou d'un sous-cycle (dans
// ce cycle), toujours à la fin de son conteneur. Avec la colonne Ordre (`canOrder`), le nouveau
// cycle prend le rang suivant et le contenu actuel est renuméroté 1, 2, 3… ; sans elle, aucun
// rang. null si le conteneur n'existe pas ou n'est pas dans un étage (pas de cycle au niveau
// zone).
export function planCycleInsert({
  sections,
  zoneKey,
  floorKey,
  parentGroupRowId = null,
  canOrder = false,
  projectName = "",
} = {}) {
  const container = findContainer(sections, { zoneKey, floorKey, groupRowId: parentGroupRowId });
  if (!container || !container.floor) return null;
  const { section, floor, group: parent, items } = container;
  const depth = parent ? parent.depth + 1 : 1;
  const name = parent ? NEW_SUBCYCLE_NAME : NEW_CYCLE_NAME;
  const fields = {
    [TASK_COLUMNS.name]: name,
    [TASK_COLUMNS.zone]: section.zoneName,
    [TASK_COLUMNS.group]: floor.name,
    [TASK_COLUMNS.project]: String(projectName ?? "").trim(),
    [TASK_COLUMNS.nature]: natureForDepth(depth),
    [TASK_COLUMNS.duration]: 0,
  };
  if (parent) fields[TASK_COLUMNS.parent] = String(parent.rowId);
  if (canOrder) fields[TASK_COLUMNS.order] = String(items.length + 1);
  return { fields, changes: canOrder ? renumberItems(items) : new Map(), depth, name, floor, parent };
}

/* ---------- Déplacer et supprimer un cycle : la règle du bloc ---------- */

// Le conteneur d'un cycle : son cycle parent, ou son étage.
function containerOf(sections, group) {
  return findContainer(sections, {
    zoneKey: group.zoneKey,
    floorKey: group.floorKey,
    groupRowId: group.parentGroup ? group.parentGroup.rowId : null,
  });
}

// `candidate` est-il le cycle `group` ou l'un de ses sous-cycles, à toute profondeur ?
function isWithin(candidate, group) {
  for (let up = candidate; up; up = up.parentGroup) if (up === group) return true;
  return false;
}

// La position d'un dépôt désigne-t-elle le cycle lui-même ou une ligne qu'il contient (sous-cycle
// ou tâche, à toute profondeur) ?
function pointsInside(position, group) {
  if (!position) return false;
  return groupRemovalIds(group).includes(position.groupRowId ?? position.taskId);
}

// Parent et Nature d'un cycle à sa nouvelle place (dans le cycle `parent`, ou dans l'étage),
// seulement s'ils changent. Le contenu du cycle garde ses Parent : sa chaîne reste valable.
function placeFields(group, parent) {
  const fields = {};
  const parentId = parent ? String(parent.rowId) : "";
  if (parentId !== (group.parentId ? String(group.parentId) : "")) fields[TASK_COLUMNS.parent] = parentId;
  const nature = natureForDepth(parent ? parent.depth + 1 : 1);
  if (natureKeyOf(nature) !== group.natureKey) fields[TASK_COLUMNS.nature] = nature;
  return fields;
}

// Le bloc d'un cycle : ses tâches dans l'ordre de chaîne, à toute profondeur ; `first` (D) et
// `last` (L) sont la première et la dernière.
function blockOf(group) {
  const ids = taskOrder({ key: `group:${group.rowId}`, items: group.items });
  const members = new Set(ids);
  return { ids, has: (rowId) => members.has(rowId), first: ids[0], last: ids[ids.length - 1] };
}

// Les tâches juste au-dessus et juste en dessous du bloc dans `order` (null : aucune).
function neighboursOf(order, block) {
  const start = order.indexOf(block.first);
  const end = order.indexOf(block.last);
  return {
    above: start > 0 ? order[start - 1] : null,
    below: end >= 0 && end < order.length - 1 ? order[end + 1] : null,
  };
}

function followsBlock(link, block) {
  return link?.type === "FD" && block.has(link.predId);
}

// Lien d'entrée du bloc : le lien de sa première tâche s'il désigne une tâche hors du bloc
// (quel que soit son type, décalage compris), sinon null.
function entryLink(links, block) {
  const link = links.get(block.first) || null;
  return link && !block.has(link.predId) ? link : null;
}

// Tâche de sortie du bloc : celle que suivait en fin → début la tâche du dessous à l'ancienne
// place ; à défaut, celle qui finit le plus tard (à égalité, la dernière dans l'ordre de chaîne ;
// rien de daté : la dernière du bloc).
function exitTask(links, block, below, tasksById) {
  const belowLink = below != null ? links.get(below) : null;
  if (followsBlock(belowLink, block)) return belowLink.predId;
  let exit = block.last;
  let latest = null;
  block.ids.forEach((rowId) => {
    const end = tasksById.get(rowId)?.end;
    if (!(end instanceof Date) || (latest && end < latest)) return;
    exit = rowId;
    latest = end;
  });
  return exit;
}

// Poser `link` sur la tâche `taskId` fermerait-il une boucle ? Oui si son prédécesseur est la
// tâche elle-même ou dépend d'elle, de proche en proche.
function closesLoop(links, taskId, link) {
  return Boolean(link) && findUpstream(links, link.predId, (rowId) => rowId === taskId) != null;
}

// Ancienne place, la chaîne se referme : si la tâche du dessous (B) suivait en fin → début une
// tâche du bloc, elle reprend le lien d'entrée — fin → début : avec son propre décalage ; autre
// type : tel quel ; aucun : plus de lien, ses dates sont gardées. Un lien d'entrée qui fermerait
// une boucle (il désigne B ou une tâche qui dépend d'elle) n'est pas posé : B garde le sien.
// Renvoie B rattachée, ou null.
function closeBlock(links, block, below, entry) {
  if (below == null || !followsBlock(links.get(below), block)) return null;
  let link = null;
  if (entry?.type === "FD") link = { predId: entry.predId, type: "FD", lag: links.get(below).lag || 0 };
  else if (entry) link = { ...entry };
  if (closesLoop(links, below, link)) return null;
  links.set(below, link);
  return below;
}

// Jamais de boucle : en remontant les prédécesseurs de P, la première tâche qui dépend d'une
// tâche du bloc reprend le lien d'entrée, sinon — pas de lien d'entrée, ou il fermerait une boucle
// (il la désigne elle-même ou une tâche qui dépend d'elle) — n'a plus de lien.
function breakLoop(links, block, above, entry) {
  const current = findUpstream(links, above, (rowId) => block.has(links.get(rowId)?.predId));
  if (current == null) return;
  links.set(current, entry && !closesLoop(links, current, entry) ? { ...entry } : null);
}

// Nouvelle place, le bloc s'insère entre P (au-dessus) et N (en dessous) dans `order`. La
// première tâche du bloc suit P — son lien est gardé s'il désigne déjà P, sinon « P FD » — ou,
// si N était liée à P autrement qu'en fin → début, reprend exactement ce lien ; sans P, plus de
// lien. N, si elle était liée à P, suit la tâche de sortie en fin → début (avec son décalage
// s'il était en fin → début), sauf si ce lien fermait une boucle : elle garde alors le sien.
function placeBlock(links, order, block, { exit, entry }) {
  const { above, below } = neighboursOf(order, block);
  const former = links.get(block.first) || null;
  const belowLink = above != null && below != null ? links.get(below) : null;
  const tied = belowLink != null && belowLink.predId === above;
  if (above == null) links.set(block.first, null);
  else if (tied && belowLink.type !== "FD") links.set(block.first, { ...belowLink });
  else if (former?.predId !== above) links.set(block.first, { predId: above, type: "FD", lag: 0 });
  breakLoop(links, block, above, entry);
  if (!tied) return;
  const next = { predId: exit, type: "FD", lag: belowLink.type === "FD" ? belowLink.lag || 0 : 0 };
  if (!closesLoop(links, below, next)) links.set(below, next);
}

// Liens et dates d'un cycle déplacé : `before` et `after` sont l'ordre de chaîne de l'étage
// avant et après le déplacement. Les tâches dont le lien change prennent les dates que leur
// donne leur lien, puis tout l'aval suit. Un cycle sans tâche, ou un déplacement qui ne change
// pas l'ordre de chaîne, ne change ni lien ni date.
function chainMovedBlock(sections, group, before, after) {
  const block = blockOf(group);
  if (!block.ids.length || after.every((rowId, at) => rowId === before[at])) return new Map();
  const tasks = allTasksOf(sections);
  const links = linkMap(tasks);
  const original = new Map(links);
  const entry = entryLink(links, block);
  const { below } = neighboursOf(before, block);
  const exit = exitTask(links, block, below, new Map(tasks.map((task) => [task.id, task])));
  closeBlock(links, block, below, entry);
  placeBlock(links, after, block, { exit, entry });
  const changes = linkChanges(original, links);
  return mergeChanges(changes, recomputeDates(tasks, links, [...changes.keys()]));
}

// Glisser un cycle vers une cible : conteneur `groupRowId` (null : l'étage) et `position`
// ({ taskId, side } ou { groupRowId, side: "before" } ; absente : la fin du conteneur). Le cycle
// ne quitte pas son étage, n'entre ni en lui-même ni dans l'un de ses sous-cycles, et ne se
// place ni par rapport à lui-même ni par rapport à une ligne qu'il contient. Champs par ligne :
// Parent et Nature du cycle s'ils changent, les rangs du conteneur d'arrivée (celui de départ
// n'est pas renuméroté) et, avec Lien (`canLink`), les liens et les dates de la règle du bloc.
// Vide si le déplacement est refusé ou si le cycle reste à sa place.
export function planCycleMove({ sections, groupRowId, target, canLink = false } = {}) {
  const group = findGroup(sections, groupRowId);
  const source = group ? containerOf(sections, group) : null;
  const destination = findContainer(sections, target || {});
  if (
    !source || !destination || destination.floor !== source.floor ||
    isWithin(destination.group, group) || pointsInside(target.position, group)
  ) {
    return new Map();
  }
  const item = source.items.find((candidate) => candidate.kind === "group" && candidate.group === group);
  const remaining = destination.items.filter((candidate) => candidate !== item);
  const index = slotIndex(remaining, target.position);
  const placed = [...remaining.slice(0, index), item, ...remaining.slice(index)];
  if (source.key === destination.key && placed.every((candidate, at) => candidate === destination.items[at])) {
    return new Map();
  }
  const changes = new Map();
  const fields = placeFields(group, destination.group);
  if (Object.keys(fields).length) changes.set(group.rowId, fields);
  mergeChanges(changes, renumberItems(placed));
  if (!canLink) return changes;
  const overrides = new Map([[destination.key, placed]]);
  if (source.key !== destination.key) overrides.set(source.key, source.items.filter((candidate) => candidate !== item));
  return mergeChanges(changes, chainMovedBlock(sections, group, taskOrder(source), taskOrder(source, overrides)));
}

// Supprimer un cycle (sa ligne, ses sous-cycles et ses tâches) : avec Lien, la chaîne se referme
// à sa place comme au départ d'un déplacement (puis les dates suivent), et les liens des tâches
// restantes qui désignaient une ligne supprimée sont effacés. Champs des lignes restantes ; vide
// sans Lien.
export function planCycleRemoval({ sections, groupRowId, canLink = false } = {}) {
  const group = canLink ? findGroup(sections, groupRowId) : null;
  if (!group) return new Map();
  const removed = new Set(groupRemovalIds(group));
  const tasks = allTasksOf(sections);
  const links = linkMap(tasks);
  const original = new Map(links);
  const block = blockOf(group);
  let closed = null;
  if (block.ids.length) {
    const { below } = neighboursOf(taskOrder(containerOf(sections, group)), block);
    closed = closeBlock(links, block, below, entryLink(links, block));
  }
  clearOrphans(links, removed);
  removed.forEach((rowId) => {
    links.delete(rowId);
    original.delete(rowId);
  });
  const remaining = tasks.filter((task) => !removed.has(task.id));
  return mergeChanges(linkChanges(original, links), recomputeDates(remaining, links, closed ? [closed] : []));
}

/* ---------- Où lâcher un cycle glissé ---------- */

// Cible d'un dépôt du cycle `groupRowId` (de l'étage `floorKey` de la zone `zoneKey`) d'après la
// ligne survolée et sa moitié (`side` : "before" pour la haute, "after" pour la basse) — le tableau
// du §7.2 de la spec. Sur une tâche : avant ou après elle, dans son conteneur ; sur un autre cycle :
// avant lui (moitié haute, dans son conteneur) ou à sa fin (moitié basse) ; sur l'étage : la fin de
// l'étage. null (rien n'est visé) sur le cycle glissé et tout ce qu'il contient, sur une zone et sur
// tout ce qui n'est pas dans l'étage du cycle : il ne quitte jamais son étage.
export function resolveCycleDropSlot(line, side, { groupRowId, zoneKey, floorKey } = {}) {
  if (!line || !floorKey || line.zoneKey !== zoneKey || line.floorKey !== floorKey) return null;
  if (line.cyclePath?.includes(groupRowId)) return null;
  const place = { zoneKey: line.zoneKey, zoneName: line.zoneName, floorKey: line.floorKey, floorName: line.floorName };
  if (line.kind === "task") {
    return taskSlot({ ...place, groupRowId: line.groupRowId }, line, side);
  }
  if (line.kind === "group" && side === "before") return groupBeforeSlot(place, line);
  if (line.kind === "group") {
    return { ...place, key: `group:${line.groupRowId}`, groupRowId: line.groupRowId, label: `Déplacer à la fin de « ${line.groupLabel} »` };
  }
  if (line.kind === "floor") {
    return { ...place, key: `floor:${line.zoneKey}/${line.floorKey}`, groupRowId: null, label: `Déplacer à la fin de « ${line.floorName} »` };
  }
  return null;
}
