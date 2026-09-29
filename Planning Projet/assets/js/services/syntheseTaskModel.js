// Modèle du tableau de tâches de la vue Synthese (Planning Projet).
// Module pur, sans DOM ni Grist : reconnaissance des lignes-tâches, dates en jours
// ouvrés, règles de saisie, récapitulatif des zones et modèle de lignes — la liste
// ordonnée des lignes visibles, partagée entre le tableau et le Gantt.
import {
  countWorkingDays,
  endAfterWorkingDays,
  formatDays,
  formatTaskDate,
  isWorkingDay,
  parseGristDate,
  toIsoDate,
} from "./syntheseTasks.js";

export const PLANNING_TABLE = "Planning_Projet";

export const TASK_COLUMNS = Object.freeze({
  id: "id",
  project: "NomProjet",
  name: "Taches",
  typeDoc: "Type_doc",
  id2: "ID2",
  zone: "Zone",
  group: "Groupe",
  floor: "Etage",
  start: "Diff_coffrage",
  end: "Diff_armature",
  duration: "Duree_1",
});

export const NEW_TASK_NAME = "Nouvelle tâche";
export const NO_ZONE_KEY = "";
export const NO_ZONE_LABEL = "Sans zone";
export const MAX_TASK_NAME_LENGTH = 200;
export const MAX_DURATION_DAYS = 9999;

// Bornes des dates saisies : au-delà, une faute de frappe (an 9999…) ferait compter des
// millions de jours ouvrés à chaque dessin.
export const MIN_TASK_YEAR = 2000;
export const MAX_TASK_YEAR = 2100;

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isSameDay(left, right) {
  if (!(left instanceof Date) || !(right instanceof Date)) return left == null && right == null;
  return left.getTime() === right.getTime();
}

// Un Début tombant un week-end ou un férié avance au jour ouvré suivant ; une Fin
// recule au jour ouvré précédent. Une date déjà ouvrée est gardée telle quelle.
export function nextWorkingDay(date) {
  let cursor = toDay(date);
  while (!isWorkingDay(cursor)) cursor = shiftDays(cursor, 1);
  return cursor;
}

export function previousWorkingDay(date) {
  let cursor = toDay(date);
  while (!isWorkingDay(cursor)) cursor = shiftDays(cursor, -1);
  return cursor;
}

// Début d'un segment de `days` jours ouvrés finissant à `end` (déjà ouvré) : l'inverse de
// endAfterWorkingDays.
function startBeforeWorkingDays(end, days) {
  const wanted = Math.max(1, Math.round(Number(days) || 1));
  let cursor = toDay(end);
  let counted = isWorkingDay(cursor) ? 1 : 0;
  while (counted < wanted) {
    cursor = shiftDays(cursor, -1);
    if (isWorkingDay(cursor)) counted += 1;
  }
  return cursor;
}

// Clé de comparaison d'une zone : « ZONE 1A (BAT A3, A4) » = « zone-1a bat a3 a4 ».
// Même règle que le contexte partagé ; "" pour une zone vide ou « Sans zone ».
export function zoneKeyOf(value) {
  const text = toText(value);
  if (!text || text.toLocaleLowerCase("fr") === "sans zone") return NO_ZONE_KEY;
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "");
}

// Clé de comparaison d'un étage dans sa zone : « PH RDB » = « ph-rdb » = « Ph Rdb ». Un signe
// placé devant un chiffre compte (« R+1 » au-dessus du sol, « R-1 » au-dessous) : « + » devient
// « p », « - », « – » ou « − » devient « m » ; le reste de la ponctuation disparaît.
export function floorKeyOf(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/\+\s*(?=\d)/g, "p")
    .replace(/[-–−]\s*(?=\d)/g, "m")
    .replace(/[^a-z0-9]+/g, "");
}

// Ligne propre à la vue Synthese : nommée, sans type de document ni ID (les lignes de
// zone n'ont pas de nom, les documents ont un type et un numéro).
function isNamedPlainRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    Boolean(toText(row?.[TASK_COLUMNS.name])) &&
    !toText(row?.[TASK_COLUMNS.typeDoc]) &&
    !toText(row?.[TASK_COLUMNS.id2]);
}

// Colonne Etage : booléen Grist, ou le texte « true » si la colonne est du texte.
export function isFloorValue(value) {
  return value === true || toText(value).toLocaleLowerCase("fr") === "true";
}

// Un étage est une ligne Synthese marquée Etage ; une tâche, une ligne Synthese qui ne
// l'est pas.
export function isFloorRow(row) {
  return isNamedPlainRow(row) && isFloorValue(row?.[TASK_COLUMNS.floor]);
}

export function isTaskRow(row) {
  return isNamedPlainRow(row) && !isFloorValue(row?.[TASK_COLUMNS.floor]);
}

// Tâches et étages : le planning Structure les ignore.
export function isSyntheseRow(row) {
  return isNamedPlainRow(row);
}

function isStoredMilestone(value) {
  return value !== "" && value != null && Number(value) === 0;
}

// Les dates font foi pour la Durée ; Duree_1 ne sert qu'à reconnaître un jalon
// (0 jour) d'une tâche d'un jour, qui ont toutes deux Début = Fin.
export function readTask(row) {
  const zoneName = toText(row?.[TASK_COLUMNS.zone]);
  let start = parseGristDate(row?.[TASK_COLUMNS.start]);
  let end = parseGristDate(row?.[TASK_COLUMNS.end]);
  if (start && end && end < start) [start, end] = [end, start];
  const hasDates = Boolean(start && end);
  const isMilestone = hasDates && isSameDay(start, end) &&
    isStoredMilestone(row?.[TASK_COLUMNS.duration]);
  return {
    id: Number(row?.[TASK_COLUMNS.id]),
    name: toText(row?.[TASK_COLUMNS.name]),
    zoneName,
    zoneKey: zoneKeyOf(zoneName),
    groupName: toText(row?.[TASK_COLUMNS.group]),
    floorKey: floorKeyOf(row?.[TASK_COLUMNS.group]),
    start,
    end,
    durationDays: hasDates ? (isMilestone ? 0 : countWorkingDays(start, end)) : null,
    isMilestone,
  };
}

export function formatDuration(days) {
  return days == null ? "—" : formatDays(days);
}

export function formatDate(date) {
  return date instanceof Date ? formatTaskDate(date) : "—";
}

function refuse(error) {
  return { ok: false, error };
}

function accept(task, fields) {
  return { ok: true, task, fields };
}

function withDates(task, start, end, isMilestone) {
  const durationDays = isMilestone ? 0 : countWorkingDays(start, end);
  const next = { ...task, start, end, durationDays, isMilestone };
  const unchanged = isSameDay(task.start, start) && isSameDay(task.end, end) &&
    task.isMilestone === isMilestone;
  return accept(next, unchanged ? {} : {
    [TASK_COLUMNS.start]: toIsoDate(start),
    [TASK_COLUMNS.end]: toIsoDate(end),
    [TASK_COLUMNS.duration]: durationDays,
  });
}

// Flèche ↑ / ↓ (ou bouton ▲▼) dans la saisie de la Durée : ±1 jour à partir du nombre qui
// commence la saisie (0 s'il n'y en a pas), de 0 (jalon) à MAX_DURATION_DAYS.
export function stepDurationText(text, step) {
  const match = /^\s*(\d+)/.exec(String(text ?? ""));
  const days = match ? Number(match[1]) : 0;
  return String(Math.min(MAX_DURATION_DAYS, Math.max(0, days + step)));
}

// Applique une saisie du tableau à une tâche. Renvoie la tâche recalculée et les
// seules colonnes Grist à écrire ({} si rien ne change), ou le motif du refus.
// Durée → la Fin suit ; Début ou Fin → la Durée suit, sauf si la date saisie croise
// l'autre : la tâche se décale alors en gardant sa Durée ; un jalon se déplace.
export function applyTaskEdit(task, field, rawValue, { today = new Date() } = {}) {
  if (field === "name") {
    const name = toText(rawValue);
    if (!name) return refuse("Le nom de la tâche ne peut pas être vide.");
    if (name.length > MAX_TASK_NAME_LENGTH) {
      return refuse(`Le nom de la tâche est limité à ${MAX_TASK_NAME_LENGTH} caractères.`);
    }
    return accept({ ...task, name }, name === task.name ? {} : { [TASK_COLUMNS.name]: name });
  }

  if (field === "duration") {
    // « 5 », « 5j », « 5 j » ou « 5 jours », comme dans MS Project.
    const match = /^(\d+)\s*(?:j|jours?)?$/i.exec(toText(rawValue));
    if (!match || Number(match[1]) > MAX_DURATION_DAYS) {
      return refuse(`La durée doit être un nombre entier de jours, de 0 (jalon) à ${MAX_DURATION_DAYS}.`);
    }
    const days = Number(match[1]);
    const start = task.start || nextWorkingDay(today);
    if (days === 0) return withDates(task, start, start, true);
    return withDates(task, start, endAfterWorkingDays(start, days), false);
  }

  if (field === "start" || field === "end") {
    const date = parseGristDate(rawValue);
    if (!date) return refuse("Date invalide.");
    if (date.getFullYear() < MIN_TASK_YEAR || date.getFullYear() > MAX_TASK_YEAR) {
      return refuse(`Date invalide : choisissez une date entre ${MIN_TASK_YEAR} et ${MAX_TASK_YEAR}.`);
    }
    if (task.isMilestone) {
      const moved = nextWorkingDay(date);
      return withDates(task, moved, moved, true);
    }
    // Tâche à une seule date : la date saisie complète l'autre. Sans aucune date, la
    // tâche devient une tâche d'un jour.
    if (!task.start || !task.end) {
      const start = field === "start" ? nextWorkingDay(date) : task.start;
      const end = field === "end" ? previousWorkingDay(date) : task.end;
      if (!start || !end) {
        const only = start || end;
        return withDates(task, only, only, false);
      }
      if (start > end) {
        return refuse(field === "start"
          ? "Le début ne peut pas être après la fin."
          : "La fin ne peut pas être avant le début.");
      }
      return withDates(task, start, end, false);
    }
    // Début après la Fin, ou Fin avant le Début : la tâche se décale, même Durée.
    if (field === "start") {
      const start = nextWorkingDay(date);
      if (start > task.end) return withDates(task, start, endAfterWorkingDays(start, task.durationDays), false);
      return withDates(task, start, task.end, false);
    }
    const end = previousWorkingDay(date);
    if (end < task.start) return withDates(task, startBeforeWorkingDays(end, task.durationDays), end, false);
    return withDates(task, task.start, end, false);
  }

  return refuse("Cette colonne ne se modifie pas.");
}

// Une nouvelle tâche démarre le jour ouvré qui suit la plus tardive des Fins de son
// groupe — l'étage, ou le niveau zone — (aujourd'hui, ou le jour ouvré suivant, si le
// groupe n'a rien de daté) et dure un jour.
export function buildNewTask({ zoneName = "", groupName = "", groupTasks = [], today = new Date() } = {}) {
  const ends = (groupTasks || [])
    .map((groupTask) => groupTask?.end)
    .filter((end) => end instanceof Date);
  const latestEnd = ends.length ? new Date(Math.max(...ends.map((end) => end.getTime()))) : null;
  const start = latestEnd ? nextWorkingDay(shiftDays(latestEnd, 1)) : nextWorkingDay(today);
  const name = toText(zoneName);
  const group = toText(groupName);
  return {
    id: null,
    name: NEW_TASK_NAME,
    zoneName: name,
    zoneKey: zoneKeyOf(name),
    groupName: group,
    floorKey: floorKeyOf(group),
    start,
    end: start,
    durationDays: 1,
    isMilestone: false,
  };
}

export function buildTaskFields(task, { projectName = "" } = {}) {
  const fields = {
    [TASK_COLUMNS.name]: toText(task?.name),
    [TASK_COLUMNS.start]: task?.start instanceof Date ? toIsoDate(task.start) : null,
    [TASK_COLUMNS.end]: task?.end instanceof Date ? toIsoDate(task.end) : null,
    [TASK_COLUMNS.duration]: Number.isFinite(task?.durationDays) ? task.durationDays : 0,
    [TASK_COLUMNS.project]: toText(projectName),
    [TASK_COLUMNS.zone]: toText(task?.zoneName),
  };
  // Tâche d'un étage : le nom de l'étage dans Groupe (rien au niveau zone).
  const group = toText(task?.groupName);
  if (group) fields[TASK_COLUMNS.group] = group;
  return fields;
}

export const NEW_FLOOR_NAME = "Nouvel étage";

// Nom d'un étage : obligatoire, limité comme un nom de tâche, avec au moins une lettre
// ou un chiffre, unique dans sa zone (même clé qu'un autre étage = doublon ; changer
// seulement la casse ou les accents de son propre nom reste permis).
export function validateFloorName(rawValue, { floors = [], currentKey = "" } = {}) {
  const name = toText(rawValue);
  if (!name) return refuse("Le nom de l'étage ne peut pas être vide.");
  if (name.length > MAX_TASK_NAME_LENGTH) {
    return refuse(`Le nom de l'étage est limité à ${MAX_TASK_NAME_LENGTH} caractères.`);
  }
  const key = floorKeyOf(name);
  if (!key) return refuse("Le nom de l'étage doit contenir au moins une lettre ou un chiffre.");
  const other = (floors || []).find((floor) => floor.key === key && floor.key !== currentKey);
  if (other) return refuse(`Un étage « ${other.name} » existe déjà dans cette zone.`);
  return { ok: true, name, key };
}

// « Nouvel étage », puis « Nouvel étage 2 », « Nouvel étage 3 »… selon les noms pris.
export function nextFloorName(floors = []) {
  const taken = new Set((floors || []).map((floor) => floor.key));
  if (!taken.has(floorKeyOf(NEW_FLOOR_NAME))) return NEW_FLOOR_NAME;
  let index = 2;
  while (taken.has(floorKeyOf(`${NEW_FLOOR_NAME} ${index}`))) index += 1;
  return `${NEW_FLOOR_NAME} ${index}`;
}

// Colonnes d'une nouvelle ligne-étage (le Service est posé par le contexte partagé).
export function buildFloorFields({ name = "", zoneName = "", projectName = "" } = {}) {
  return {
    [TASK_COLUMNS.name]: toText(name),
    [TASK_COLUMNS.zone]: toText(zoneName),
    [TASK_COLUMNS.group]: "",
    [TASK_COLUMNS.floor]: true,
    [TASK_COLUMNS.project]: toText(projectName),
  };
}

// Renommer un étage : ses lignes-étages et le Groupe de ses tâches, en une seule écriture.
export function buildFloorRenameActions(floor, name) {
  const actions = [];
  const rowIds = floor?.rowIds || [];
  if (rowIds.length === 1) {
    actions.push(["UpdateRecord", PLANNING_TABLE, rowIds[0], { [TASK_COLUMNS.name]: name }]);
  } else if (rowIds.length > 1) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, [...rowIds], { [TASK_COLUMNS.name]: rowIds.map(() => name) }]);
  }
  const taskIds = (floor?.tasks || []).map((task) => task.id);
  if (taskIds.length) {
    actions.push(["BulkUpdateRecord", PLANNING_TABLE, taskIds, { [TASK_COLUMNS.group]: taskIds.map(() => name) }]);
  }
  return actions;
}

// Supprimer un étage : ses lignes-étages et toutes ses tâches, en une seule écriture.
export function buildFloorDeleteActions(floor) {
  const ids = [...(floor?.rowIds || []), ...(floor?.tasks || []).map((task) => task.id)];
  return ids.length ? [["BulkRemoveRecord", PLANNING_TABLE, ids]] : [];
}

export function buildFloorDeleteQuestion(floor) {
  const count = (floor?.tasks || []).length;
  if (!count) return `Supprimer l'étage « ${floor.name} » ?`;
  if (count === 1) return `Supprimer l'étage « ${floor.name} » et sa tâche ?`;
  return `Supprimer l'étage « ${floor.name} » et ses ${count} tâches ?`;
}

// Conteneur d'une ligne de tâche : son étage, ou le niveau zone de sa zone (même format
// que la clé de la ligne d'en-tête du conteneur).
export function containerKeyOf(line) {
  return line?.floorKey ? `floor:${line.zoneKey}/${line.floorKey}` : `zone:${line?.zoneKey ?? ""}`;
}

// Cible d'un dépôt d'après la ligne visée : ligne de zone → niveau zone de cette zone ;
// ligne d'étage ou tâche d'un étage → cet étage ; tâche du niveau zone → niveau zone.
export function resolveDropTarget(line) {
  if (!line || !["zone", "floor", "task"].includes(line.kind)) return null;
  if (line.kind === "floor" || (line.kind === "task" && line.floorKey)) {
    return {
      key: `floor:${line.zoneKey}/${line.floorKey}`,
      zoneKey: line.zoneKey,
      zoneName: line.zoneName,
      floorKey: line.floorKey,
      floorName: line.floorName,
      label: `Déplacer dans « ${line.floorName} »`,
    };
  }
  return {
    key: `zone:${line.zoneKey}`,
    zoneKey: line.zoneKey,
    zoneName: line.zoneName,
    floorKey: "",
    floorName: "",
    label: `Déplacer au niveau de la zone « ${line.zoneName || NO_ZONE_LABEL} »`,
  };
}

// Colonnes à écrire pour déplacer une tâche vers une cible : seulement ce qui change,
// rien si la cible est son conteneur actuel (dans « Sans zone », la tâche est au niveau
// zone même si son Groupe nomme un étage).
export function buildMoveFields(task, target) {
  if (!task || !target) return {};
  const currentFloorKey = task.zoneKey === NO_ZONE_KEY ? "" : task.floorKey;
  if (target.zoneKey === task.zoneKey && target.floorKey === currentFloorKey) return {};
  const fields = {};
  if (target.zoneKey !== task.zoneKey) fields[TASK_COLUMNS.zone] = toText(target.zoneName);
  const group = target.floorKey ? toText(target.floorName) : "";
  if (group !== task.groupName) fields[TASK_COLUMNS.group] = group;
  return fields;
}

// La colonne Etage existe-t-elle ? Réponse d'après les lignes lues dans Grist : null si
// aucune ligne ne permet de le savoir.
export function detectFloorColumn(rows = []) {
  if (!rows?.length) return null;
  return rows.some((row) => row != null && Object.prototype.hasOwnProperty.call(row, TASK_COLUMNS.floor));
}

function hasDates(task) {
  return task?.start instanceof Date && task?.end instanceof Date;
}

// Récapitulatif d'une zone, règle MS Project : une tâche occupe ses jours du Début
// à la Fin ; un jalon n'occupe que l'instant du début de son jour. La Durée compte
// les jours ouvrés entre le premier début et la dernière fin : un jalon placé en
// dernier ne compte donc pas son propre jour.
export function summarizeTasks(tasks) {
  const dated = (tasks || []).filter(hasDates);
  if (!dated.length) return null;
  const start = new Date(Math.min(...dated.map((task) => task.start.getTime())));
  let last = null;
  dated.forEach((task) => {
    const endsAtDayStart = Boolean(task.isMilestone);
    if (
      !last ||
      task.end > last.end ||
      (isSameDay(task.end, last.end) && last.endsAtDayStart && !endsAtDayStart)
    ) {
      last = { end: task.end, endsAtDayStart };
    }
  });
  const counted = countWorkingDays(start, last.end) -
    (last.endsAtDayStart && isWorkingDay(last.end) ? 1 : 0);
  // Le Gantt fait partir (ou s'arrêter) la barre de zone au centre du losange quand la
  // zone commence (ou finit) par un jalon.
  const startsWithMilestone = dated
    .filter((task) => isSameDay(task.start, start))
    .every((task) => task.isMilestone);
  return {
    start,
    end: last.end,
    durationDays: Math.max(0, counted),
    startsWithMilestone,
    endsWithMilestone: last.endsAtDayStart,
  };
}

function compareNames(left, right) {
  return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
}

function compareTasks(left, right) {
  const leftDated = hasDates(left);
  const rightDated = hasDates(right);
  if (leftDated !== rightDated) return leftDated ? -1 : 1;
  if (leftDated) {
    const byStart = left.start - right.start;
    if (byStart) return byStart;
    const byEnd = left.end - right.end;
    if (byEnd) return byEnd;
  }
  return compareNames(left.name, right.name) || left.id - right.id;
}

// Un étage d'une zone, lu depuis sa ligne-étage.
function readFloor(row) {
  const name = toText(row?.[TASK_COLUMNS.name]);
  const zoneName = toText(row?.[TASK_COLUMNS.zone]);
  return {
    rowId: Number(row?.[TASK_COLUMNS.id]),
    name,
    zoneKey: zoneKeyOf(zoneName),
    floorKey: floorKeyOf(name),
  };
}

function itemBounds(item) {
  if (item.kind === "floor") {
    return { start: item.floor.summary?.start ?? null, end: item.floor.summary?.end ?? null, name: item.floor.name };
  }
  return { start: item.task.start, end: item.task.end, name: item.task.name };
}

// Niveau zone : les tâches hors étage en haut, puis les étages ; dans chaque groupe, par date
// de début, puis de fin, puis par nom ; le non daté à la fin du groupe.
function compareItems(left, right) {
  if (left.kind !== right.kind) return left.kind === "task" ? -1 : 1;
  const a = itemBounds(left);
  const b = itemBounds(right);
  const aDated = a.start instanceof Date && a.end instanceof Date;
  const bDated = b.start instanceof Date && b.end instanceof Date;
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated) {
    const byStart = a.start - b.start;
    if (byStart) return byStart;
    const byEnd = a.end - b.end;
    if (byEnd) return byEnd;
  }
  const byName = compareNames(a.name, b.name);
  if (byName) return byName;
  return left.kind === "task" ? left.task.id - right.task.id : 0;
}

// Sections du tableau : une par zone du projet (celles des lignes lues et celles des
// autres services), triées par nom, puis « Sans zone » si des tâches n'ont pas de zone.
// Chaque section porte toutes ses tâches (récapitulatif de zone), ses étages (lignes-étages
// et noms trouvés dans le Groupe des tâches) et son niveau zone : tâches hors étage en haut,
// puis étages, chacun par date. Pas d'étage dans « Sans zone ». Un filtre de zone n'en garde
// qu'une.
export function buildSections({ rows = [], sharedZones = [], zoneFilter = "" } = {}) {
  const zoneNames = new Map();
  const rememberZone = (value) => {
    const name = toText(value);
    const key = zoneKeyOf(name);
    if (key && !zoneNames.has(key)) zoneNames.set(key, name);
  };
  rows.forEach((row) => rememberZone(row?.[TASK_COLUMNS.zone]));
  (sharedZones || []).forEach(rememberZone);

  const tasksByZone = new Map();
  rows.filter(isTaskRow).map(readTask).forEach((task) => {
    if (!tasksByZone.has(task.zoneKey)) tasksByZone.set(task.zoneKey, []);
    tasksByZone.get(task.zoneKey).push(task);
  });

  const floorRowsByZone = new Map();
  rows.filter(isFloorRow).map(readFloor).forEach((floorRow) => {
    if (floorRow.zoneKey === NO_ZONE_KEY || !floorRow.floorKey) return;
    if (!floorRowsByZone.has(floorRow.zoneKey)) floorRowsByZone.set(floorRow.zoneKey, []);
    floorRowsByZone.get(floorRow.zoneKey).push(floorRow);
  });

  const toSection = (zoneKey, zoneName) => {
    const tasks = (tasksByZone.get(zoneKey) || []).slice().sort(compareTasks);
    const floors = new Map();
    const floorFor = (key, name) => {
      if (!floors.has(key)) floors.set(key, { key, name, rowIds: [], tasks: [], summary: null });
      return floors.get(key);
    };
    (floorRowsByZone.get(zoneKey) || []).forEach((floorRow) => {
      floorFor(floorRow.floorKey, floorRow.name).rowIds.push(floorRow.rowId);
    });
    const items = [];
    tasks.forEach((task) => {
      if (zoneKey !== NO_ZONE_KEY && task.floorKey) floorFor(task.floorKey, task.groupName).tasks.push(task);
      else items.push({ kind: "task", task });
    });
    floors.forEach((floor) => {
      floor.summary = summarizeTasks(floor.tasks);
      items.push({ kind: "floor", floor });
    });
    items.sort(compareItems);
    return {
      zoneKey,
      zoneName,
      label: zoneName || NO_ZONE_LABEL,
      tasks,
      summary: summarizeTasks(tasks),
      floors: items.filter((item) => item.kind === "floor").map((item) => item.floor),
      items,
    };
  };

  const sections = [...zoneNames.entries()]
    .sort((left, right) => compareNames(left[1], right[1]))
    .map(([zoneKey, zoneName]) => toSection(zoneKey, zoneName));
  if (tasksByZone.has(NO_ZONE_KEY)) sections.push(toSection(NO_ZONE_KEY, ""));

  const filterKey = zoneKeyOf(zoneFilter);
  if (!filterKey) return sections;
  const filtered = sections.filter((section) => section.zoneKey === filterKey);
  return filtered.length ? filtered : [toSection(filterKey, toText(zoneFilter))];
}

// Clé de repli d'un étage (un même nom d'étage peut exister dans deux zones).
export function floorCollapseKey(zoneKey, floorKey) {
  return `${zoneKey}/${floorKey}`;
}

function summaryFields(summary) {
  return {
    start: summary?.start ?? null,
    end: summary?.end ?? null,
    durationDays: summary?.durationDays ?? null,
    isMilestone: false,
    startsWithMilestone: Boolean(summary?.startsWithMilestone),
    endsWithMilestone: Boolean(summary?.endsWithMilestone),
  };
}

// Le modèle de lignes : exactement ce qui est affiché, dans l'ordre, une entrée par
// ligne — la zone (niveau 0), puis son niveau zone : tâches hors étage (niveau 1) et
// étages (niveau 1) suivis de leurs tâches (niveau 2). Le tableau le dessine ; le Gantt
// dessine la même liste, à la même hauteur de ligne.
export function buildRowModel(sections = [], {
  collapsedZoneKeys = new Set(),
  collapsedFloorKeys = new Set(),
} = {}) {
  const lines = [];
  const taskLine = (section, task, floor) => ({
    key: `task:${task.id}`,
    kind: "task",
    level: floor ? 2 : 1,
    zoneKey: section.zoneKey,
    zoneName: section.zoneName,
    floorKey: floor ? floor.key : "",
    floorName: floor ? floor.name : "",
    floorRowIds: [],
    taskId: task.id,
    name: task.name,
    start: task.start,
    end: task.end,
    durationDays: task.durationDays,
    isMilestone: task.isMilestone,
    startsWithMilestone: false,
    endsWithMilestone: false,
    collapsed: false,
    childCount: 0,
  });
  sections.forEach((section) => {
    const collapsed = collapsedZoneKeys.has(section.zoneKey);
    lines.push({
      key: `zone:${section.zoneKey}`,
      kind: "zone",
      level: 0,
      zoneKey: section.zoneKey,
      zoneName: section.zoneName,
      floorKey: "",
      floorName: "",
      floorRowIds: [],
      taskId: null,
      name: section.label,
      ...summaryFields(section.summary),
      collapsed,
      childCount: section.items.length,
    });
    if (collapsed) return;
    section.items.forEach((item) => {
      if (item.kind === "task") {
        lines.push(taskLine(section, item.task, null));
        return;
      }
      const { floor } = item;
      const floorCollapsed = collapsedFloorKeys.has(floorCollapseKey(section.zoneKey, floor.key));
      lines.push({
        key: `floor:${section.zoneKey}/${floor.key}`,
        kind: "floor",
        level: 1,
        zoneKey: section.zoneKey,
        zoneName: section.zoneName,
        floorKey: floor.key,
        floorName: floor.name,
        floorRowIds: [...floor.rowIds],
        taskId: null,
        name: floor.name,
        ...summaryFields(floor.summary),
        collapsed: floorCollapsed,
        childCount: floor.tasks.length,
      });
      if (floorCollapsed) return;
      floor.tasks.forEach((task) => lines.push(taskLine(section, task, floor)));
    });
  });
  return lines;
}
