// Export Excel du planning (frise Structure / Topographie) : transforme les lignes que la frise
// affiche (les « groups » de buildTimelineDataFromPlanningRows, dans leur ordre) en un modèle de
// feuille — en-tête du fichier, colonnes, bandeaux de zone, lignes. Module pur : aucune
// dépendance au DOM ni à ExcelJS ; planningExcelWriter.js en fait le classeur.

// Même ordre et mêmes libellés que l'en-tête du planning (index.html, .planning-header-left) ;
// un test vérifie qu'ils ne divergent pas.
export const PLANNING_EXPORT_COLUMNS = Object.freeze([
  { key: "id2", header: "Id", kind: "code", width: 9, align: "left" },
  { key: "taches", header: "Tâches", kind: "text", width: 46, align: "left" },
  { key: "lignePlanning", header: "Ligne\nplanning", kind: "code", width: 10, align: "left" },
  {
    key: "debut",
    header: "Début",
    kind: "date",
    width: 12,
    align: "left",
    note: "Date limite de réception des données d'entrées",
  },
  { key: "dureeDebutFin", header: "Durée", kind: "number", width: 8, align: "center" },
  { key: "fin", header: "Fin", kind: "date", width: 12, align: "left" },
  { key: "dureeFinDemarrage", header: "Durée", kind: "number", width: 8, align: "center" },
  { key: "demarrage", header: "Démarrage\nTravaux", kind: "date", width: 12, align: "left" },
  { key: "indice", header: "Indice", kind: "text", width: 8, align: "center" },
  // Assez large pour « 100 % — réalisation forcée le 15/07/2026 » sur deux lignes.
  { key: "realise", header: "Realisation\n(En %)", kind: "number", width: 16, align: "center" },
  { key: "retards", header: "Retard\n(j)", kind: "number", width: 9, align: "center" },
].map((column) => Object.freeze(column)));

function toText(value) {
  return String(value ?? "").trim();
}

// Id et Ligne planning : un entier simple devient un nombre (Excel ne signale pas de « nombre
// stocké en texte ») ; un zéro de tête ou une lettre gardent le texte tel quel.
function toCodeValue(text) {
  const value = toText(text);
  if (!value) return null;
  return /^(?:0|[1-9]\d{0,14})$/.test(value) ? Number(value) : value;
}

function toNumberValue(text) {
  const value = toText(text);
  if (!value) return null;
  const number = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : value;
}

// Jour calendaire à minuit UTC : Excel compte en jours entiers, sans décalage horaire.
function toDateValue(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toText(iso));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// Même règle que la colonne « Retard (j) » de l'écran : entier positif, sinon rien.
function toPositiveRetard(text) {
  const number = Number(toText(text).replace(",", "."));
  return toText(text) && Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function isComplete(realiseText) {
  const number = Number(toText(realiseText).replace(",", "."));
  return Number.isFinite(number) && number >= 100;
}

// Couleur de fond des lignes : mêmes mots-clés que la frise (timeline.js) et même priorité que
// sa feuille de style, où la dernière règle l'emporte (coffrage < NDC < coupes < démolition).
// Les armatures n'ont pas de fond.
function hasKeyword(typeDoc, keyword) {
  return typeDoc.toUpperCase().includes(keyword);
}

export function planningExportRowTone(typeDocLabel) {
  const typeDoc = toText(typeDocLabel);
  if (!typeDoc) return "";
  const withoutAccents = typeDoc.normalize("NFD").replace(/\p{M}/gu, "");
  const isCoffrage = hasKeyword(typeDoc, "COFFRAGE");
  const isArmature = hasKeyword(typeDoc, "ARMATURE");
  const isNdc = hasKeyword(typeDoc, "NDC")
    || hasKeyword(typeDoc, "NOTE DE CALCUL")
    || hasKeyword(typeDoc, "NOTE CALCUL");
  const isCoupes = hasKeyword(typeDoc, "COUPE");
  const isDemolition = hasKeyword(withoutAccents, "DEMOLITION");
  if (isDemolition) return "demolition";
  if (isCoupes) return "coupes";
  if (isNdc) return "ndc";
  if (isCoffrage) return "coffrage";
  if (isArmature) return "armature";
  return "generic";
}

function buildTaskRow(group) {
  const forcedClosureLabel = toText(group?.dateClotureLabel);
  const remarque = toText(group?.remarqueLabel);
  const retard = toPositiveRetard(group?.retardsLabel);
  const retardCell = { value: retard };
  if (remarque) retardCell.note = remarque;

  return {
    kind: "task",
    tone: planningExportRowTone(group?.typeDocLabel),
    forcedClosure: Boolean(forcedClosureLabel),
    realiseComplete: Boolean(forcedClosureLabel) || isComplete(group?.realiseLabel),
    late: retard != null,
    justified: Boolean(remarque),
    cells: [
      { value: toCodeValue(group?.id2Label) },
      { value: toText(group?.tachesLabel) || null },
      { value: toCodeValue(group?.lignePlanningLabel) },
      { value: toDateValue(group?.debutIso) },
      { value: toNumberValue(group?.dureeDebutFinLabel) },
      { value: toDateValue(group?.finIso) },
      { value: toNumberValue(group?.dureeFinDemarrageLabel) },
      { value: toDateValue(group?.demarrageIso) },
      { value: toText(group?.indiceLabel) || null },
      {
        value: forcedClosureLabel
          ? `100 % — réalisation forcée le ${forcedClosureLabel}`
          : toNumberValue(group?.realiseLabel),
      },
      retardCell,
    ],
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatFrenchDate(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatIsoDay(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

// Nom de fichier lisible sous Windows : « / \ : | » deviennent un tiret, « * ? " < > » et les
// caractères de contrôle disparaissent.
function cleanFileNamePart(value) {
  return toText(value)
    .replace(/[\\/:|]/g, "-")
    .replace(/[*?"<>]|\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

// Nom d'onglet Excel : 31 caractères au plus, sans « \ / ? * [ ] : ».
function cleanSheetName(value) {
  const cleaned = toText(value).replace(/[\\/?*[\]:]/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "Planning").slice(0, 31).trim();
}

export function buildPlanningExportModel({
  groups = [],
  projectName = "",
  projectNumber = "",
  serviceName = "",
  exportedAt = new Date(),
} = {}) {
  const rows = [];
  let zoneCount = 0;
  let taskCount = 0;
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!group || group.isAggregateGroup) return;
    if (group.isZoneHeader) {
      zoneCount += 1;
      rows.push({ kind: "zone", label: toText(group.zoneHeaderLabel) || "Sans zone" });
      return;
    }
    taskCount += 1;
    rows.push(buildTaskRow(group));
  });

  const service = toText(serviceName);
  const title = service ? `Planning ${service}` : "Planning projet";
  const project = toText(projectName);
  const number = toText(projectNumber);
  const time = `${pad2(exportedAt.getHours())}:${pad2(exportedAt.getMinutes())}`;
  const details = [
    ...(number ? [`N° de projet : ${number}`] : []),
    `Exporté le ${formatFrenchDate(exportedAt)} à ${time}`,
    `${plural(zoneCount, "zone", "zones")}, ${plural(taskCount, "ligne", "lignes")}`,
  ];
  const fileName = [title, project, formatIsoDay(exportedAt)]
    .map(cleanFileNamePart)
    .filter(Boolean)
    .join(" - ");

  return {
    title,
    projectName: project,
    details,
    sheetName: cleanSheetName(title),
    fileName: `${fileName}.xlsx`,
    exportedAt,
    columns: PLANNING_EXPORT_COLUMNS,
    rows,
    zoneCount,
    taskCount,
  };
}
