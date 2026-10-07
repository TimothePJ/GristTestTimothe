// Fenêtre « Lien Structure » de la vue Synthese : zone par zone, les étages de Synthese en
// face des coffrages de Structure (documents de type COFFRAGE), le coffrage lié à chaque
// étage (colonne Lien_Structure de sa ligne-étage) et la date de diffusion à l'indice 0 de
// chaque coffrage (table ListePlan_NDC_COF). Module pur, sans DOM ni Grist.
import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  TASK_COLUMNS,
  buildSections,
  floorKeyOf,
  isFloorRow,
  nextWorkingDay,
  zoneKeyOf,
} from "./syntheseTaskModel.js";
import { parseGristDate } from "./syntheseTasks.js";

const STRUCTURE_SERVICE_KEY = "structure";
const FORMWORK_TYPE = "COFFRAGE";
const FIRST_INDICE = "0";
const PLAN_NAME_START = "fond de plan de synthese";

// Colonnes lues dans ListePlan_NDC_COF.
const PLAN_COLUMNS = Object.freeze({
  type: "Type_document",
  number: "NumeroDocument",
  indice: "Indice",
  date: "DateDiffusion",
  service: "Service",
});

// État du lien d'un étage : pas de lien ; coffrage introuvable ; étage sans fond de plan ;
// coffrage sans indice 0 ; fond de plan à la date d'indice 0 ; fond de plan à une autre date.
export const LINK_STATES = Object.freeze({
  none: "none",
  missing: "missing",
  noPlan: "noPlan",
  waiting: "waiting",
  current: "current",
  stale: "stale",
});

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function plain(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "");
}

// Sans accents, sans casse, espaces resserrés.
function plainKey(value) {
  return plain(value).replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function compareNatural(left, right) {
  return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
}

function isSameDay(left, right) {
  return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
}

function floorId(zoneKey, floorKey) {
  return `${zoneKey}/${floorKey}`;
}

// Clé de comparaison d'un N° de document, comme la reconnaissance des documents du planning
// (shared/planning-closure-core.js) : sans accents ni casse, toute ponctuation vaut une
// espace. Les zéros comptent : « 0110 » n'est pas « 110 ».
export function numberKeyOf(value) {
  return plain(value).toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim();
}

// Coffrage de Structure : une ligne nommée du service Structure dont le type de document
// contient « COFFRAGE » (même règle que le planning Structure).
export function isFormworkRow(row) {
  const id = Number(row?.[TASK_COLUMNS.id]);
  return Number.isInteger(id) && id > 0 &&
    plainKey(row?.[TASK_COLUMNS.service]) === STRUCTURE_SERVICE_KEY &&
    plain(row?.[TASK_COLUMNS.typeDoc]).toLocaleUpperCase("fr").includes(FORMWORK_TYPE) &&
    Boolean(toText(row?.[TASK_COLUMNS.name]));
}

export function formworkLabel({ number = "", name = "" } = {}) {
  return number ? `${number} — ${name}` : name;
}

// Date de diffusion à l'indice 0 de chaque coffrage, par clé de N° : la plus ancienne des
// dates lisibles des lignes COFFRAGE (service Structure, ou sans service) à l'indice « 0 ».
export function formworkIssueDates(planRows) {
  const dates = new Map();
  (Array.isArray(planRows) ? planRows : []).forEach((row) => {
    const service = plainKey(row?.[PLAN_COLUMNS.service]);
    if (service && service !== STRUCTURE_SERVICE_KEY) return;
    if (!plain(row?.[PLAN_COLUMNS.type]).toLocaleUpperCase("fr").includes(FORMWORK_TYPE)) return;
    if (toText(row?.[PLAN_COLUMNS.indice]) !== FIRST_INDICE) return;
    const key = numberKeyOf(row?.[PLAN_COLUMNS.number]);
    const date = parseGristDate(row?.[PLAN_COLUMNS.date]);
    if (!key || !date) return;
    const known = dates.get(key);
    if (!known || date < known) dates.set(key, date);
  });
  return dates;
}

// N° du coffrage lié à chaque étage (clé « zone/étage »), lu sur ses lignes-étages : la
// première valeur non vide, de la plus ancienne ligne à la plus récente.
export function readFloorLinks(syntheseRows) {
  const links = new Map();
  (Array.isArray(syntheseRows) ? syntheseRows : [])
    .filter(isFloorRow)
    .sort((left, right) => Number(left[TASK_COLUMNS.id]) - Number(right[TASK_COLUMNS.id]))
    .forEach((row) => {
      const number = toText(row[TASK_COLUMNS.structureLink]);
      const key = floorId(zoneKeyOf(row[TASK_COLUMNS.zone]), floorKeyOf(row[TASK_COLUMNS.name]));
      if (number && !links.has(key)) links.set(key, number);
    });
  return links;
}

// Le fond de plan d'un étage (sa plus ancienne tâche « FOND DE PLAN DE SYNTHESE … ») et son
// ancre, la tâche qui reçoit la date : le prédécesseur du fond de plan quand il lui est lié
// « même début » sans décalage (RECEPTION ARCH/TOPO/STR dans le modèle), sinon le fond de plan.
export function findFloorStart(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const plan = list
    .filter((task) => plainKey(task?.name).startsWith(PLAN_NAME_START))
    .sort((left, right) => left.id - right.id)[0] || null;
  if (!plan) return { plan: null, anchor: null };
  const link = plan.link;
  const pred = link?.type === "DD" && !link.lag ? list.find((task) => task.id === link.predId) : null;
  return { plan, anchor: pred || plan };
}

function readFormwork(row) {
  const number = toText(row?.[TASK_COLUMNS.id2]);
  const name = toText(row?.[TASK_COLUMNS.name]);
  return { id: Number(row?.[TASK_COLUMNS.id]), number, name, label: formworkLabel({ number, name }) };
}

// Par N° (ordre naturel), les coffrages sans N° à la fin, puis par nom.
function compareFormworks(left, right) {
  if (Boolean(left.number) !== Boolean(right.number)) return left.number ? -1 : 1;
  return compareNatural(left.number, right.number) || compareNatural(left.name, right.name) || left.id - right.id;
}

// Conditions lues de haut en bas (voir LINK_STATES).
function linkStateOf({ number, formwork, plan, expectedStart }) {
  if (!number) return LINK_STATES.none;
  if (!formwork) return LINK_STATES.missing;
  if (!plan) return LINK_STATES.noPlan;
  if (!expectedStart) return LINK_STATES.waiting;
  return isSameDay(plan.start, expectedStart) ? LINK_STATES.current : LINK_STATES.stale;
}

// Les zones du projet (celles de tous les services, une seule par graphie, triées), chacune
// avec ses étages de Synthese — leur coffrage lié, leur fond de plan, l'état du lien — et ses
// coffrages de Structure — leur date d'indice 0, les étages qu'ils servent ; « Sans zone » à
// la fin pour les coffrages qui n'en ont pas. `syntheseRows` : les lignes du tableau de tâches
// (service Synthese) ; `projectRows` : Planning_Projet du projet, tous services ; `planRows` :
// ListePlan_NDC_COF du projet.
export function buildStructureLink({ syntheseRows = [], projectRows = [], planRows = [] } = {}) {
  const synthese = Array.isArray(syntheseRows) ? syntheseRows : [];
  const project = Array.isArray(projectRows) ? projectRows : [];
  const issueDates = formworkIssueDates(planRows);
  const links = readFloorLinks(synthese);

  const allFormworks = project.filter(isFormworkRow).map((row) => {
    const formwork = readFormwork(row);
    return {
      ...formwork,
      zoneKey: zoneKeyOf(row?.[TASK_COLUMNS.zone]),
      issueDate: (formwork.number && issueDates.get(numberKeyOf(formwork.number))) || null,
      floorNames: [],
    };
  }).sort(compareFormworks);
  const formworksByZone = new Map();
  allFormworks.forEach((formwork) => {
    if (!formworksByZone.has(formwork.zoneKey)) formworksByZone.set(formwork.zoneKey, []);
    formworksByZone.get(formwork.zoneKey).push(formwork);
  });
  // Coffrage d'un N° : celui de la zone de l'étage d'abord, sinon le premier du projet.
  const findFormwork = (number, zoneKey) => {
    const key = numberKeyOf(number);
    const sameNumber = (formwork) => numberKeyOf(formwork.number) === key;
    return (formworksByZone.get(zoneKey) || []).find(sameNumber) || allFormworks.find(sameNumber) || null;
  };

  const sections = buildSections({
    rows: synthese,
    sharedZones: project.map((row) => row?.[TASK_COLUMNS.zone]),
  });
  const zones = sections.map((section) => ({
    zoneKey: section.zoneKey,
    zoneName: section.zoneName,
    label: section.label,
    floors: section.floors.map((floor) => {
      const number = links.get(floorId(section.zoneKey, floor.key)) || "";
      const formwork = number ? findFormwork(number, section.zoneKey) : null;
      const { plan } = findFloorStart(floor.tasks);
      const expectedStart = formwork?.issueDate ? nextWorkingDay(formwork.issueDate) : null;
      if (formwork) formwork.floorNames.push(floor.name);
      return {
        key: floor.key,
        name: floor.name,
        formworkNumber: number,
        formwork,
        plan: plan ? { id: plan.id, name: plan.name, start: plan.start } : null,
        expectedStart,
        state: linkStateOf({ number, formwork, plan, expectedStart }),
      };
    }),
    formworks: formworksByZone.get(section.zoneKey) || [],
  }));
  if (formworksByZone.has(NO_ZONE_KEY) && !zones.some((zone) => zone.zoneKey === NO_ZONE_KEY)) {
    zones.push({
      zoneKey: NO_ZONE_KEY,
      zoneName: "",
      label: NO_ZONE_LABEL,
      floors: [],
      formworks: formworksByZone.get(NO_ZONE_KEY),
    });
  }
  return { zones };
}
