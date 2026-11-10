// Mode d'un cycle de la vue Synthese, escalier ou parallèle. En escalier, le contenu direct du cycle
// (ses tâches et ses sous-cycles, chacun réduit à sa tâche d'entrée et à sa tâche de sortie)
// s'enchaîne : chaque élément suit en fin → début la sortie du précédent, et un sous-cycle garde son
// propre mode. En parallèle, toutes les tâches du cycle, à toute profondeur, finissent le même jour
// que sa tâche pilote (fin → fin sans décalage), comme RESERVATIONS et TERMINAUX dans « PLAN SYT
// CYCLE n » : un sous-cycle y est bâti en parallèle lui aussi, autour de sa propre tâche pilote. La
// tâche pilote est la plus longue du cycle : elle seule suit la tâche d'avant le cycle, et comme elle
// commence avant les autres, aucune ne commence avant la Fin de la tâche d'avant. Le mode se lit dans
// les liens et les dates (rien n'est stocké) ; l'appliquer réécrit les liens, puis celui de la tâche
// qui suit le cycle, et réaligne les dates ; après un glisser-déposer, une suppression ou une durée
// changée, un cycle qui était en parallèle le reste, autour de sa tâche la plus longue. Module pur,
// sans DOM ni Grist.
import { TASK_COLUMNS, buildSections, findGroup } from "./syntheseTaskModel.js";
import { toIsoDate } from "./syntheseTasks.js";
import { blockOf, closesLoop, entryLink, exitTask, followsBlock, neighboursOf } from "./syntheseCycles.js";
import {
  allTasksOf,
  findContainer,
  linkChanges,
  linkMap,
  mergeChanges,
  parallelPilotOf,
  recomputeDates,
  taskOrder,
} from "./syntheseTaskOrder.js";

export const CYCLE_MODES = Object.freeze({ series: "series", parallel: "parallel", mixed: "mixed" });

// Tâches des sections, leurs liens (id → lien) et l'index par id.
function chainContextOf(sections) {
  const tasks = allTasksOf(sections);
  return { tasks, links: linkMap(tasks), tasksById: new Map(tasks.map((task) => [task.id, task])) };
}

// Ordre de chaîne de l'étage d'un cycle (cycles traversés).
function floorOrderOf(sections, group) {
  return taskOrder(findContainer(sections, { zoneKey: group.zoneKey, floorKey: group.floorKey }));
}

// Les éléments d'un cycle dans l'ordre affiché, réduits à leur tâche d'entrée et à leur tâche de
// sortie : une tâche est les deux ; un sous-cycle entre par la première tâche de son bloc (sa
// tâche pilote s'il est en parallèle, voir blockOf) et sort par sa tâche de sortie (voir
// subCycleExit). Un sous-cycle sans tâche est ignoré.
function chainItemsOf(group, context) {
  return group.items.flatMap((item) => {
    if (item.kind === "task") return [{ entry: item.task.id, exit: item.task.id }];
    const exit = subCycleExit(item.group, context);
    return exit == null ? [] : [{ entry: blockOf(item.group).first, exit }];
  });
}

// Tâche de sortie d'un sous-cycle : celle que suit en fin → début la tâche juste en dessous ; à
// défaut, d'après son propre mode — en parallèle, sa tâche pilote (tout y finit avec elle), en
// escalier la sortie de son dernier élément — et sinon celle qui finit le plus tard. Lue ainsi, une
// tâche qui suit en fin → début n'importe quelle tâche du sous-cycle fait de celle-ci sa sortie : un
// lien saisi à la main sur sa première tâche suffit à lire le cycle parent « en escalier ». null pour
// un sous-cycle sans tâche.
function subCycleExit(group, context) {
  const block = blockOf(group);
  if (!block.ids.length) return null;
  const { below } = neighboursOf(context.order, block);
  const belowLink = below != null ? context.links.get(below) : null;
  if (followsBlock(belowLink, block)) return belowLink.predId;
  const items = chainItemsOf(group, context);
  const mode = modeOf(group, items, context);
  if (mode === CYCLE_MODES.parallel) return parallelPilotOf(group, context.links);
  if (mode === CYCLE_MODES.series) return items[items.length - 1].exit;
  return exitTask(context.links, block, null, context.tasksById);
}

// Même prédécesseur, même type ; le décalage ne compte pas.
function matchesLink(link, wanted) {
  return link?.predId === wanted.predId && link.type === wanted.type;
}

// En escalier, chaque élément après le premier suit en fin → début la sortie du précédent (décalage
// quelconque).
function isSeries(items, links) {
  return items.slice(1).every((item, at) => matchesLink(links.get(item.entry), { predId: items[at].exit, type: "FD" }));
}

// Même lien : prédécesseur, type et décalage (null : aucun lien).
function sameLink(left, right) {
  if (!left || !right) return !left && !right;
  return matchesLink(left, right) && (left.lag || 0) === (right.lag || 0);
}

// Durée d'une tâche en jours ouvrés, pour trouver la plus longue (0 : jalon, ou durée inconnue).
function durationOf(task) {
  return Number.isInteger(task?.durationDays) && task.durationDays > 0 ? task.durationDays : 0;
}

// La plus longue des tâches `ids` (non vide) : à égalité, `preferred` s'il en est, sinon la première
// de `ids`.
function longestOf(ids, tasksById, preferred = null) {
  const longest = Math.max(...ids.map((rowId) => durationOf(tasksById.get(rowId))));
  const candidates = ids.filter((rowId) => durationOf(tasksById.get(rowId)) === longest);
  return candidates.includes(preferred) ? preferred : candidates[0];
}

// Toutes les tâches datées du cycle, à toute profondeur, finissent-elles le jour de la tâche pilote ?
// (Rien à vérifier si la tâche pilote n'est pas datée.)
function endsWithPilot(group, pilot, tasksById) {
  const end = tasksById.get(pilot)?.end;
  if (!(end instanceof Date)) return true;
  return group.tasks.every((task) => !(task.end instanceof Date) || task.end.getTime() === end.getTime());
}

// Escalier, parallèle (liens bâtis en parallèle et toutes les fins le même jour) ou mélange ; null
// pour moins de deux éléments.
function modeOf(group, items, context) {
  if (items.length < 2) return null;
  if (isSeries(items, context.links)) return CYCLE_MODES.series;
  const pilot = parallelPilotOf(group, context.links);
  if (pilot != null && endsWithPilot(group, pilot, context.tasksById)) return CYCLE_MODES.parallel;
  return CYCLE_MODES.mixed;
}

// Mode de chaque cycle des sections qui a au moins deux éléments, par id de cycle.
export function cycleModes(sections) {
  const context = chainContextOf(sections);
  const modes = new Map();
  (sections || []).forEach((section) => (section.floors || []).forEach((floor) => {
    const order = taskOrder(findContainer(sections, { zoneKey: section.zoneKey, floorKey: floor.key }));
    floor.groups.forEach((group) => {
      const floorContext = { ...context, order };
      const mode = modeOf(group, chainItemsOf(group, floorContext), floorContext);
      if (mode) modes.set(group.rowId, mode);
    });
  }));
  return modes;
}

// La tâche avec laquelle finit une tâche ajoutée dans le cycle `groupRowId` (sous l'une de ses
// tâches, ou à sa fin) quand ce cycle est en parallèle ou pris dans un cycle en parallèle : sa
// tâche pilote, ou pour un sous-cycle vide celle du plus proche parent qui en a une. null sinon.
// Si la tâche ajoutée est la plus longue, elle deviendra la tâche pilote (voir
// planParallelRealign).
export function parallelPilot(sections, groupRowId) {
  const group = findGroup(sections, groupRowId);
  if (!group) return null;
  const context = { ...chainContextOf(sections), order: floorOrderOf(sections, group) };
  const chain = [];
  for (let container = group; container; container = container.parentGroup) chain.push(container);
  let outermost = -1;
  chain.forEach((container, at) => {
    if (modeOf(container, chainItemsOf(container, context), context) === CYCLE_MODES.parallel) outermost = at;
  });
  for (let at = 0; at <= outermost; at += 1) {
    const pilot = parallelPilotOf(chain[at], context.links);
    if (pilot != null) return pilot;
  }
  return null;
}

// Reporte sur les lignes de cycle leur mode (null pour moins de deux éléments) : le menu en dépend.
// Les autres lignes portent null.
export function applyCycleModes(lines, modes) {
  return (lines || []).map((line) => ({
    ...line,
    cycleMode: line.kind === "group" ? modes.get(line.groupRowId) ?? null : null,
  }));
}

// Sortie d'un cycle passé en parallèle, que suit la tâche du dessous : la tâche de son bloc qui finit
// le plus tard une fois ses liens changés (`dated` : les dates recalculées), la tâche pilote à
// égalité ou si rien n'est daté. Tout finit d'ordinaire avec la tâche pilote ; une tâche dont le lien
// fermait une boucle peut finir plus tard, et la suite l'attend.
function parallelExit(block, pilot, { dated, tasksById }) {
  const endOf = (rowId) => dated.get(rowId)?.[TASK_COLUMNS.end] ?? toIsoDate(tasksById.get(rowId)?.end) ?? null;
  let exit = pilot;
  let latest = endOf(pilot);
  block.ids.forEach((rowId) => {
    const end = endOf(rowId);
    if (end && (!latest || end > latest)) {
      exit = rowId;
      latest = end;
    }
  });
  return exit;
}

// Bâtit un cycle en parallèle, sous-cycles compris, autour de sa tâche pilote `pilot` (une tâche de
// son bloc) : chaque autre élément finit avec elle — une tâche par un lien fin → fin sans décalage,
// un sous-cycle bâti de même autour de sa propre tâche pilote (`pilot` s'il la contient, sinon sa
// tâche la plus longue), liée ainsi à celle du cycle. Le lien de la tâche pilote n'est pas touché
// (voir giveEntry). La tâche pilote d'un sous-cycle est liée avant son contenu : elle ne dépend plus
// de lui, et aucun de ses liens ne ferme de boucle. `link(taskId, lien)` pose un lien.
function applyParallel(group, link, tasksById, pilot) {
  group.items.forEach((item) => {
    let head = item.kind === "task" ? item.task.id : null;
    let sub = null;
    if (item.kind === "group") {
      sub = blockOf(item.group);
      if (!sub.ids.length) return;
      head = sub.has(pilot) ? pilot : longestOf(sub.ids, tasksById);
    }
    if (head !== pilot) link(head, { predId: pilot, type: "FF", lag: 0 });
    if (sub) applyParallel(item.group, link, tasksById, head);
  });
}

// Le lien d'entrée du cycle (`entry`) va à sa tâche d'entrée `taskId` — sa tâche pilote en
// parallèle, son premier élément en escalier — s'il désigne une tâche hors du cycle ; sans lien
// d'entrée utilisable, elle perd seulement un lien vers une tâche du cycle (ses dates restent) —
// sauf la tâche d'entrée actuelle (la première de l'ordre de chaîne), qui garde le sien. À faire
// avant de lier les autres éléments : aucune boucle ne passe par l'ancien lien. Vrai si son lien
// change.
function giveEntry(taskId, entry, { block, links, link, tasksById }) {
  const current = links.get(taskId) || null;
  let next = current;
  if (entry && tasksById.has(entry.predId) && !block.has(entry.predId)) next = { ...entry };
  else if (taskId !== block.first && current && block.has(current.predId)) next = null;
  if (sameLink(current, next)) return false;
  link(taskId, next);
  return true;
}

// En escalier : chaque élément après le premier suit la sortie du précédent en fin → début, avec son
// décalage s'il la suivait déjà ainsi, sinon sans. Renvoie les tâches dont le lien a été posé.
function applySeries(items, link) {
  return items.slice(1).map((item, at) => {
    const wanted = { predId: items[at].exit, type: "FD" };
    const current = link.current(item.entry);
    link(item.entry, { ...wanted, lag: matchesLink(current, wanted) ? current.lag || 0 : 0 });
    return item.entry;
  });
}

// Passer un cycle en escalier (`mode` "series") ou en parallèle ("parallel"). Le lien d'entrée du
// cycle (`entry`, sinon celui de sa tâche d'entrée, voir entryLink) va d'abord à sa nouvelle tâche
// d'entrée (voir giveEntry). En escalier, c'est son premier élément affiché, et son contenu direct
// s'enchaîne (voir applySeries) ; en parallèle, c'est la tâche pilote, sa tâche la plus longue (à
// égalité, `preferredPilot` s'il en est, sinon l'actuelle tâche pilote, sinon la première), et toutes
// les autres finissent avec elle (voir applyParallel). La tâche qui suivait le cycle en fin → début
// suit sa nouvelle sortie — la sortie de son dernier élément en escalier, celle qui finit le plus
// tard en parallèle — avec son décalage. Un lien qui fermerait une boucle n'est pas posé. Les tâches
// reliées prennent les dates que leur donne leur lien (même si le lien ne change pas : une date qui
// s'en était écartée est réalignée), puis tout l'aval suit. Champs par ligne ; vide sans Lien
// (`canLink`), pour un mode inconnu, ou pour un cycle de moins de deux éléments.
export function planCycleMode({ sections, groupRowId, mode, canLink = false, preferredPilot = null, entry } = {}) {
  const known = mode === CYCLE_MODES.series || mode === CYCLE_MODES.parallel;
  const group = canLink && known ? findGroup(sections, groupRowId) : null;
  if (!group) return new Map();
  const { tasks, links, tasksById } = chainContextOf(sections);
  const order = floorOrderOf(sections, group);
  const items = chainItemsOf(group, { links, order, tasksById });
  if (items.length < 2) return new Map();
  const original = new Map(links);
  const block = blockOf(group);
  const { above, below } = neighboursOf(order, block);
  const belowLink = below != null ? links.get(below) : null;
  const cycleEntry = entry !== undefined ? entry : entryLink(links, block, above);
  const link = (taskId, next) => {
    if (!closesLoop(links, taskId, next)) links.set(taskId, next);
  };
  link.current = (taskId) => links.get(taskId) || null;
  const place = { block, links, link, tasksById };
  let exit;
  let linked;
  if (mode === CYCLE_MODES.series) {
    const first = items[0].entry;
    linked = giveEntry(first, cycleEntry, place) ? [first] : [];
    linked.push(...applySeries(items, link));
    exit = items[items.length - 1].exit;
  } else {
    const pilot = longestOf(block.ids, tasksById, preferredPilot);
    linked = giveEntry(pilot, cycleEntry, place) ? [pilot] : [];
    applyParallel(group, (taskId, next) => {
      linked.push(taskId);
      link(taskId, next);
    }, tasksById, pilot);
    exit = parallelExit(block, pilot, { dated: recomputeDates(tasks, links, linked), tasksById });
  }
  if (followsBlock(belowLink, block)) {
    linked.push(below);
    link(below, { predId: exit, type: "FD", lag: belowLink.lag || 0 });
  }
  return mergeChanges(linkChanges(original, links), recomputeDates(tasks, links, linked));
}

// Après un changement de mode du cycle `groupRowId` (`rows` : les lignes une fois changées), chaque
// cycle qui l'englobe et se lit alors en parallèle autour d'une tâche pilote qui n'est pas sa plus
// longue est rebâti autour de celle-ci (voir planCycleMode), du plus proche au plus englobant.
// Champs par ligne, à écrire avec le changement de mode ; vide si rien ne change.
export function planParentsParallel({ rows = [], groupRowId } = {}) {
  const changes = new Map();
  let sections = buildSections({ rows });
  let parent = findGroup(sections, groupRowId)?.parentGroup || null;
  while (parent) {
    const context = { ...chainContextOf(sections), order: floorOrderOf(sections, parent) };
    const pilot = modeOf(parent, chainItemsOf(parent, context), context) === CYCLE_MODES.parallel
      ? parallelPilotOf(parent, context.links)
      : null;
    if (pilot != null && longestOf(blockOf(parent).ids, context.tasksById, pilot) !== pilot) {
      const fields = planCycleMode({ sections, groupRowId: parent.rowId, mode: CYCLE_MODES.parallel, canLink: true });
      if (fields.size) {
        mergeChanges(changes, fields);
        sections = buildSections({ rows: withChanges(rows, changes) });
      }
    }
    parent = findGroup(sections, parent.rowId)?.parentGroup || null;
  }
  return changes;
}

// Lignes Grist avec, par-dessus, des champs par ligne.
function withChanges(rows, changes) {
  return rows.map((row) => {
    const fields = changes.get(Number(row?.[TASK_COLUMNS.id]));
    return fields ? { ...row, ...fields } : row;
  });
}

// Ids des tâches d'un cycle dans l'ordre affiché, à toute profondeur.
function shownIds(group) {
  return group.items.flatMap((item) => (item.kind === "task" ? [item.task.id] : item.kind === "group" ? shownIds(item.group) : []));
}

const sameIds = (left, right) => left.length === right.length && left.every((rowId, at) => rowId === right[at]);

// L'opération a-t-elle touché le cycle : une tâche ajoutée, retirée, sortie ou déplacée (à toute
// profondeur, dans l'ordre de chaîne ou affiché), ou une durée changée ? `former` : le cycle et les
// tâches d'avant.
function isTouched(former, block, tasksById, group) {
  if (!sameIds(blockOf(former.group).ids, block.ids) || !sameIds(shownIds(former.group), shownIds(group))) return true;
  return block.ids.some((rowId) => durationOf(former.tasksById.get(rowId)) !== durationOf(tasksById.get(rowId)));
}

// Un lien qui désigne une tâche existante hors du bloc, sinon null.
function outsideLink(link, block, tasksById) {
  return link && tasksById.has(link.predId) && !block.has(link.predId) ? link : null;
}

// La tâche pilote d'un cycle en parallèle est sa tâche la plus longue. Si l'opération a touché le
// cycle (voir isTouched) et que la plus longue n'est pas sa tâche pilote du moment (à égalité,
// celle du moment — ou l'ancienne — la reste ; puis la première dans l'ordre de chaîne), elle la
// devient. La tâche pilote du moment est relue dans les liens : un cycle englobant, déjà rebâti, a
// pu la changer. La nouvelle reprend le lien d'entrée : celui de la tâche pilote du moment, sinon
// celui de l'ancienne, décalage compris ; si l'ancienne est sortie juste au-dessus du cycle, elle
// la suit en fin → début ; sans lien d'entrée utilisable, plus de lien si le sien est perdu (aucun,
// ou vers l'ancienne tâche pilote, ou vers une tâche du cycle). La tâche qui suivait le cycle en
// fin → début, toujours juste en dessous, la suit si elle ne suit plus le cycle, décalage gardé. Un
// lien qui fermerait une boucle n'est pas posé. `former` : le cycle, les liens, les tâches et
// l'ordre de l'étage d'avant. Renvoie la tâche pilote voulue (null : cycle vide) et les champs par
// ligne (liens, puis dates en cascade ; vides si la tâche pilote ne change pas).
function planPilotTakeover(former, group, context) {
  const formerPilot = parallelPilotOf(former.group, former.links);
  const block = blockOf(group);
  if (formerPilot == null || !block.ids.length) return { pilot: null, changes: new Map() };
  // Tâche pilote du moment : relue dans les liens, si elle porte un vrai lien d'entrée hors du cycle —
  // un fin → fin n'en est un que vers la tâche pilote d'un cycle en parallèle qui l'englobe (sinon,
  // une tâche restée seule, qui finit encore avec une tâche pilote partie, se lirait tâche pilote sans
  // lien d'entrée) ; à défaut, l'ancienne.
  const read = parallelPilotOf(group, context.links);
  const readLink = read != null ? context.links.get(read) : null;
  let enclosingPilot = null;
  for (let up = group.parentGroup; up && enclosingPilot == null; up = up.parentGroup) {
    enclosingPilot = parallelPilotOf(up, context.links);
  }
  const entered = outsideLink(readLink, block, context.tasksById) &&
    (readLink.type !== "FF" || readLink.predId === enclosingPilot);
  const currentPilot = entered ? read : null;
  const held = currentPilot ?? (block.has(formerPilot) ? formerPilot : null);
  const pilot = isTouched(former, block, context.tasksById, group) || held == null
    ? longestOf(block.ids, context.tasksById, held)
    : held;
  if (pilot === (currentPilot ?? formerPilot)) return { pilot, changes: new Map() };
  const links = new Map(context.links);
  const original = new Map(links);
  const link = (rowId, next) => {
    if (!closesLoop(links, rowId, next)) links.set(rowId, next);
  };
  const { above } = neighboursOf(context.order, block);
  const leftAbove = !block.has(formerPilot) && above === formerPilot && context.tasksById.has(formerPilot);
  const entry = leftAbove
    ? { predId: formerPilot, type: "FD", lag: 0 }
    : outsideLink(context.links.get(currentPilot), block, context.tasksById) ||
      outsideLink(former.links.get(formerPilot), block, context.tasksById);
  const current = links.get(pilot);
  if (entry) link(pilot, { ...entry });
  else if (!current || current.predId === formerPilot || block.has(current.predId)) link(pilot, null);
  const roots = [pilot];
  const formerBlock = blockOf(former.group);
  const formerBelow = neighboursOf(former.order, formerBlock).below;
  const formerBelowLink = formerBelow != null ? former.links.get(formerBelow) : null;
  const { below } = neighboursOf(context.order, block);
  if (
    below != null && below === formerBelow && followsBlock(formerBelowLink, formerBlock) &&
    !followsBlock(links.get(below), block)
  ) {
    link(below, { predId: pilot, type: "FD", lag: formerBelowLink.lag || 0 });
    roots.push(below);
  }
  return { pilot, changes: mergeChanges(linkChanges(original, links), recomputeDates(context.tasks, links, roots)) };
}

// Après un glisser-déposer, une suppression, un ajout ou une saisie (`before` : les sections
// d'avant ; `rows` : les lignes Grist une fois l'opération faite), chaque cycle qui était en
// parallèle le reste, autour de sa tâche la plus longue : si l'opération l'a touché, la plus longue
// remplace la tâche pilote (voir planPilotTakeover), puis le cycle est rebâti en parallèle s'il ne
// l'est plus — une tâche ou un sous-cycle glissé dedans finit avec la tâche pilote, qui garde son
// lien d'entrée (ou reprend celui de l'ancienne). Un cycle que l'opération n'a pas touché garde sa
// tâche pilote. Les cycles sont repris du plus englobant au plus imbriqué. Champs par ligne, à écrire
// avec l'opération ; vide sans Lien (`canLink`) ou si rien ne change.
export function planParallelRealign({ before, rows = [], canLink = false } = {}) {
  const changes = new Map();
  if (!canLink) return changes;
  const formerContext = chainContextOf(before);
  const formerGroups = [...cycleModes(before)]
    .filter(([, mode]) => mode === CYCLE_MODES.parallel)
    .map(([rowId]) => findGroup(before, rowId))
    .sort((left, right) => left.depth - right.depth);
  let sections = buildSections({ rows });
  const contextOf = (group) => ({ ...chainContextOf(sections), order: floorOrderOf(sections, group) });
  const apply = (fields) => {
    if (!fields.size) return;
    mergeChanges(changes, fields);
    sections = buildSections({ rows: withChanges(rows, changes) });
  };
  formerGroups.forEach((formerGroup) => {
    const group = findGroup(sections, formerGroup.rowId);
    if (!group) return;
    const former = {
      group: formerGroup,
      links: formerContext.links,
      tasksById: formerContext.tasksById,
      order: floorOrderOf(before, formerGroup),
    };
    const takeover = planPilotTakeover(former, group, contextOf(group));
    apply(takeover.changes);
    const current = findGroup(sections, formerGroup.rowId);
    const context = contextOf(current);
    const mode = modeOf(current, chainItemsOf(current, context), context);
    if (mode == null || mode === CYCLE_MODES.parallel) return;
    // Lien d'entrée : celui de la tâche pilote s'il sort du cycle, sinon celui de l'ancienne.
    const block = blockOf(current);
    const formerPilot = parallelPilotOf(formerGroup, formerContext.links);
    const entry = outsideLink(context.links.get(takeover.pilot), block, context.tasksById) ||
      outsideLink(formerContext.links.get(formerPilot), block, context.tasksById) || undefined;
    apply(planCycleMode({
      sections, groupRowId: current.rowId, mode: CYCLE_MODES.parallel, canLink: true, preferredPilot: takeover.pilot, entry,
    }));
  });
  return changes;
}
