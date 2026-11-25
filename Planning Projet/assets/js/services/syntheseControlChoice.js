// Tâche contrôlée par rapport au coffrage, changée d'un coup dans les étages déjà créés du projet
// (fenêtre « Paramètre », onglet « Tâche contrôlée »). Une tâche d'un étage est « la même » que celle
// d'un autre étage quand elle porte le même nom dans les mêmes cycles, le nom de l'étage mis à part
// (« … NIV SS1 » et « … NIV R+1 » sont la tâche « … NIV {E} » ; voir floorTokenizer) et sans tenir
// compte de la casse, des accents ni des espaces ; deux tâches de même nom dans un même cycle se
// distinguent par leur rang.
// Un étage qui n'a pas la tâche choisie n'est pas modifié : il est signalé. Module pur, sans DOM ni
// Grist.
import { FLOOR_NAME_TOKEN } from "./syntheseFloorTemplate.js";
import { TASK_COLUMNS, isDefaultFloorName } from "./syntheseTaskModel.js";
import { readControlTasks } from "./structureLinkModel.js";

function toText(value) {
  return value == null ? "" : String(value).trim();
}

// Sans accents, sans casse, espaces resserrés.
function plainKey(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Le nom de l'étage dans les noms de ses tâches et de ses cycles, remplacé par {E} : l'inverse de ce
// que fait la création d'un étage, qui met son nom partout où le modèle écrit {E}. Trois cas, d'après
// le nom de l'étage :
//  - nom par défaut (« Nouvel étage », « Nouvel étage 2 ») : chaque occurrence exacte, comme au
//    renommage d'un étage ;
//  - nom d'un seul caractère ou tout en chiffres (« 1 », « A ») : seulement après « NIV » ou « GO »
//    — sinon l'étage « 1 » changerait aussi « CYCLE 1 » et « Indice 1 », qui ne parlent pas de lui ;
//  - tout autre nom (« SS1 », « R+1 », « RDC ») : chaque occurrence entière — en début de nom ou
//    après un espace ou une parenthèse, et suivie de la fin, d'un espace, d'une parenthèse ou d'une
//    ponctuation —, sans tenir compte de la casse.
// Rend la fonction qui fait ce remplacement dans un texte ; `name` et les textes sont dans la même
// écriture (tels quels pour l'affichage, en clé de comparaison pour reconnaître une tâche).
function floorTokenizer(floorName, name) {
  if (!name) return (text) => text;
  if (isDefaultFloorName(floorName)) return (text) => text.split(name).join(FLOOR_NAME_TOKEN);
  const escaped = escapeRegExp(name);
  const whole = floorName.length >= 2 && !/^\d+$/.test(floorName);
  const pattern = whole
    ? new RegExp(`(^|[\\s(])${escaped}(?=$|[\\s().,;:])`, "gi")
    : new RegExp(`(\\b(?:NIV|GO) )${escaped}(?=$|[\\s(])`, "gi");
  return (text) => text.replace(pattern, `$1${FLOOR_NAME_TOKEN}`);
}

// Les tâches d'un étage dans l'ordre affiché, chacune avec sa clé — les noms de ses cycles, du plus
// extérieur au plus intérieur, son nom, puis son rang parmi les tâches de même nom du même cycle —
// et ce qu'on en montre : nom ({E} à la place du nom de l'étage), cycles, rang.
function floorTasks(floor) {
  const entries = [];
  const ranks = new Map();
  const floorName = toText(floor.name);
  const shownName = floorTokenizer(floorName, floorName);
  const keyTokens = floorTokenizer(floorName, plainKey(floorName));
  const keyOf = (text) => keyTokens(plainKey(text));
  const visit = (items, path, pathKeys) => (items || []).forEach((item) => {
    if (item.kind === "group") {
      const groupName = toText(item.group.name);
      visit(item.group.items, [...path, shownName(groupName)], [...pathKeys, keyOf(groupName)]);
      return;
    }
    const taskName = toText(item.task.name);
    const name = shownName(taskName);
    const place = [...pathKeys, keyOf(taskName)];
    const base = JSON.stringify(place);
    const rank = (ranks.get(base) || 0) + 1;
    ranks.set(base, rank);
    entries.push({
      key: JSON.stringify([...place, rank]),
      pathKey: JSON.stringify(pathKeys),
      taskId: item.task.id,
      name,
      path,
      rank,
    });
  });
  visit(floor.items, [], []);
  return entries;
}

// Chaque étage du projet, dans l'ordre des zones puis des étages : son libellé (« R+1 (Zone 1) »),
// ses tâches par clé, ses tâches contrôlées aujourd'hui (cochées, ou par défaut) et, parmi elles,
// celles qui sont cochées.
function readFloors(sections, rows) {
  const controls = readControlTasks(rows);
  return (sections || []).flatMap((section) => (section.floors || []).map((floor) => {
    const entries = floorTasks(floor);
    const taskIds = entries.map((entry) => entry.taskId);
    return {
      label: `${floor.name} (${section.label})`,
      entries,
      byKey: new Map(entries.map((entry) => [entry.key, entry])),
      controlIds: new Set(taskIds.filter((taskId) => controls.has(taskId))),
      chosenIds: new Set(taskIds.filter((taskId) => controls.get(taskId)?.chosen)),
    };
  }));
}

// Ce que le choix de la tâche `key` fait à un étage : "missing" (il ne l'a pas), "current" (c'est
// déjà sa seule tâche contrôlée, cochée ou par défaut : rien à écrire) ou "change", avec les cases
// à écrire — la tâche cochée si elle ne l'est pas, les autres tâches cochées décochées.
function outcomeOf(floor, key) {
  const entry = floor.byKey.get(key);
  if (!entry) return { state: "missing", checks: [] };
  const { taskId } = entry;
  if (floor.controlIds.size === 1 && floor.controlIds.has(taskId)) return { state: "current", checks: [] };
  const checks = [];
  if (!floor.chosenIds.has(taskId)) checks.push([taskId, true]);
  floor.chosenIds.forEach((otherId) => {
    if (otherId !== taskId) checks.push([otherId, false]);
  });
  return { state: "change", checks };
}

// Le choix de la tâche `key` sur tous les étages : les libellés des étages qui changent, de ceux
// qui l'ont déjà et de ceux qui ne l'ont pas, et la colonne Controle_Coffrage à écrire, par ligne.
function reportOf(floors, key) {
  const report = { change: [], current: [], missing: [], changes: new Map() };
  floors.forEach((floor) => {
    const { state, checks } = outcomeOf(floor, key);
    report[state].push(floor.label);
    checks.forEach(([rowId, checked]) => report.changes.set(rowId, { [TASK_COLUMNS.formworkCheck]: checked }));
  });
  return report;
}

// Les tâches qu'on peut choisir : toutes celles des étages du projet, une par clé, dans l'ordre du
// tableau — une tâche que le premier étage n'a pas se range après celle qui la précède dans son
// étage. Pour chacune : sa clé, son nom, ses cycles (`path` : les mêmes noms pour toutes les tâches
// d'un même cycle, ceux du premier étage qui l'a), son rang, le nombre d'étages dont elle est
// aujourd'hui une tâche contrôlée (`controlled`) et ce que la choisir ferait (`change`, `current`,
// `missing` : libellés d'étages). `sections` : toutes les zones du projet ; `rows` : les lignes du
// tableau de tâches.
export function controlTaskChoices({ sections = [], rows = [] } = {}) {
  const floors = readFloors(sections, rows);
  const order = [];
  const shown = new Map();
  const paths = new Map();
  floors.forEach((floor) => {
    let at = -1;
    floor.entries.forEach((entry) => {
      if (!paths.has(entry.pathKey)) paths.set(entry.pathKey, entry.path);
      const known = order.indexOf(entry.key);
      if (known >= 0) {
        at = known;
        return;
      }
      at += 1;
      order.splice(at, 0, entry.key);
      shown.set(entry.key, entry);
    });
  });
  return {
    floorCount: floors.length,
    choices: order.map((key) => {
      const { name, pathKey, rank } = shown.get(key);
      const { change, current, missing } = reportOf(floors, key);
      return {
        key,
        name,
        path: paths.get(pathKey),
        rank,
        controlled: floors.filter((floor) => floor.controlIds.has(floor.byKey.get(key)?.taskId)).length,
        change,
        current,
        missing,
      };
    }),
  };
}

// Ce qu'il faut écrire pour que la tâche `key` soit la tâche contrôlée de chaque étage qui l'a :
// `changes` (colonne Controle_Coffrage par ligne), les étages qui changent, ceux qui l'ont déjà,
// ceux qui ne l'ont pas ; `found` : un étage au moins a cette tâche.
export function planControlTask({ sections = [], rows = [], key = "" } = {}) {
  const floors = readFloors(sections, rows);
  return { found: floors.some((floor) => floor.byKey.has(key)), ...reportOf(floors, key) };
}
