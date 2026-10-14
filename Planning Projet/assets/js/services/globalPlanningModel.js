// Modèle de la vue Global (Planning Projet) : le planning Synthèse et le planning Structure
// d'un projet dans un même arbre de lignes. Zone → niveau (étage de Synthèse ⇄ coffrage de
// Structure) → étage et coffrage côte à côte ; les armatures sous leur coffrage ; le reste au
// niveau zone. Puis le modèle de lignes affichées, avec l'état de chaque ligne.
// Module pur, sans DOM ni Grist : il ne lit que des lignes déjà chargées et n'écrit rien.
import {
  buildPhaseClassName,
  buildTimelineDataFromPlanningRows,
  createSplitPhaseItems,
  retardPhasePaint,
} from "./planningService.js";
import {
  NO_ZONE_KEY,
  NO_ZONE_LABEL,
  TASK_COLUMNS,
  buildRowModel,
  buildSections,
  formatDuration,
  isSyntheseServiceRow,
  zoneKeyOf,
} from "./syntheseTaskModel.js";
import {
  applyEndLimits,
  buildStructureLink,
  controlTaskEndLimits,
  formworkLabel,
  isFormworkRow,
  readControlTasks,
} from "./structureLinkModel.js";
import { parseGristDate } from "./syntheseTasks.js";
import {
  addCounts,
  checkDocument,
  checkFloor,
  countAlerts,
  emptyCounts,
  floorState,
  formworkState,
  hasAlerts,
  levelState,
  summaryState,
  taskState,
} from "./globalChecks.js";

// Colonnes de Planning_Projet lues en plus de celles du planning Structure.
const DOC_COLUMNS = Object.freeze({ realise: "Realise", retards: "Retards", remarque: "Remarque" });

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function plainUpper(value) {
  return toText(value).normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("fr");
}

function compareNames(left, right) {
  return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
}

function isStructureRow(row) {
  return plainUpper(row?.[TASK_COLUMNS.service]) === "STRUCTURE";
}

// Type d'un document Structure, pour sa couleur : coffrage, armature, ndc, coupes, demolition,
// autre (mêmes familles que les barres du planning Structure).
export function docTypeKeyOf(typeDoc) {
  const type = plainUpper(typeDoc);
  if (type.includes("COFFRAGE")) return "coffrage";
  if (type.includes("ARMATURES")) return "armature";
  if (type === "NDC") return "ndc";
  if (type === "COUPES") return "coupes";
  if (type === "DEMOLITION") return "demolition";
  return "autre";
}

// Type d'un document pour la couleur de sa ligne, décidé comme le tableau du planning Structure
// (ui/timeline.js, classes row-type-…) : coffrage, armature, ndc, coupes, demolition, generic.
// Quand plusieurs conviennent, celui dont la règle vient en dernier dans la feuille de style,
// c'est-à-dire celui dont la couleur s'affiche.
export function structureRowTypeOf(typeDoc) {
  const text = String(typeDoc ?? "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  const has = (keyword) => upper.includes(keyword);
  const ndc = has("NDC") || has("NOTE DE CALCUL") || has("NOTE CALCUL");
  const coupes = has("COUPE");
  const demolition = upper.normalize("NFD").replace(/\p{M}/gu, "").includes("DEMOLITION");
  if (!(has("COFFRAGE") || has("ARMATURE") || ndc || coupes || demolition)) return "generic";
  if (demolition) return "demolition";
  if (coupes) return "coupes";
  if (ndc) return "ndc";
  return has("COFFRAGE") ? "coffrage" : "armature";
}

function segmentKindOf(classes) {
  if (classes.includes("phase-demarrage")) return "works";
  if (classes.includes("phase-reference-reception")) return "reference";
  return "phase";
}

// Les barres que le planning Structure dessine sur la ligne d'un document, dans son ordre : sa
// phase (coupée à l'heure actuelle en partie passée et partie à venir), ses données d'entrées,
// son démarrage des travaux. Une phase en retard porte les couleurs de retard du planning
// Structure, selon le réalisé qu'il affiche.
function readSegments(items, group) {
  return items
    .filter((item) => item.type !== "background" && item.start instanceof Date && item.end instanceof Date)
    .map((item) => {
      const classes = toText(item.className);
      const kind = segmentKindOf(classes);
      return {
        kind,
        classes,
        label: toText(item.content),
        start: new Date(item.start.getTime()),
        end: new Date(item.end.getTime()),
        paint: kind === "phase" ? retardPhasePaint(classes, group.realiseLabel, group.retardsLabel) : null,
      };
    });
}

// Les documents Structure du projet, dans l'ordre du planning Structure, avec les dates qu'il
// affiche (Début, Fin, Démarrage travaux) et les barres qu'il dessine : elles lui sont
// demandées, pas recalculées ici. Réalisé, Retard et Remarque sont les valeurs stockées.
// `projectRows` : Planning_Projet du projet, tous services ; `targetLookup` : indices de
// référence du service Structure (réalisé des barres) ; `referenceLookup` : données d'entrées
// par ligne — ceux que le planning Structure reçoit.
export function readStructureDocs(projectRows, { targetLookup = null, referenceLookup = null } = {}) {
  const rows = (Array.isArray(projectRows) ? projectRows : []).filter(isStructureRow);
  const rawById = new Map(rows.map((row) => [Number(row[TASK_COLUMNS.id]), row]));
  // Le planning Structure ne retient que les lignes écrites au nom du projet qu'on lui donne.
  const projectNames = [...new Set(rows.map((row) => toText(row[TASK_COLUMNS.project])))].filter(Boolean);
  const docs = [];
  projectNames.forEach((projectName) => {
    const timeline = buildTimelineDataFromPlanningRows(rows, projectName, "", targetLookup, referenceLookup);
    const itemsByGroup = new Map();
    timeline.items.forEach((item) => {
      if (!itemsByGroup.has(item.group)) itemsByGroup.set(item.group, []);
      itemsByGroup.get(item.group).push(item);
    });
    timeline.groups.forEach((group) => {
      const id = Number(group.rowId);
      if (group.isZoneHeader || !Number.isInteger(id) || id <= 0) return;
      const raw = rawById.get(id) || {};
      const weeks = Number(group.dureeDebutFinLabel);
      const zoneName = toText(group.zoneLabel);
      docs.push({
        id,
        number: toText(group.id2Label),
        name: toText(group.tachesLabel),
        typeDoc: toText(group.typeDocLabel),
        typeKey: docTypeKeyOf(group.typeDocLabel),
        rowType: structureRowTypeOf(group.typeDocLabel),
        zoneName,
        zoneKey: zoneKeyOf(zoneName),
        // Zone et Groupe réunis : vide hors coffrage et armature, ou sans Groupe.
        groupKey: toText(group.meta?.groupCompositeKey),
        start: parseGristDate(group.debutIso),
        end: parseGristDate(group.finIso),
        worksStart: parseGristDate(group.demarrageIso),
        weeks: Number.isFinite(weeks) && weeks > 0 ? weeks : null,
        indice: toText(group.indiceLabel),
        realise: Number(raw[DOC_COLUMNS.realise]) || 0,
        storedRetard: Number(raw[DOC_COLUMNS.retards]) || 0,
        remarque: toText(raw[DOC_COLUMNS.remarque]),
        // Coffrage qu'un étage peut lier (nommé, voir « Lien Structure »).
        isFormwork: isFormworkRow(raw),
        segments: readSegments(itemsByGroup.get(group.id) || [], group),
        // Réalisé et retard avec lesquels le planning Structure colore ses barres.
        barRealise: Number(group.realiseLabel) || 0,
        barRetard: group.retardsLabel,
      });
    });
  });
  return docs;
}

// Barre unique d'une section repliée (un coffrage et ses armatures, ou les documents d'un même
// type dans une zone) : du début de la première phase de ses documents à la fin de la dernière,
// dans la classe de barre `phase` (« phase-coffrage »…) et coupée à l'heure actuelle par le code
// même du planning Structure. Couleurs de retard dès qu'un de ses documents est en retard sans
// être réalisé ; bord vert quand tous sont réalisés.
function sectionSegments(docs, { id, phase, label }) {
  const phases = docs.flatMap((doc) => doc.segments.filter((segment) => segment.kind === "phase"));
  if (!phases.length) return [];
  const start = new Date(Math.min(...phases.map((segment) => segment.start.getTime())));
  const end = new Date(Math.max(...phases.map((segment) => segment.end.getTime())));
  const late = docs.some((doc) => retardPhasePaint(phase, doc.barRealise, doc.barRetard));
  const done = docs.every((doc) => doc.barRealise >= 100);
  return createSplitPhaseItems({
    itemIdBase: id,
    groupId: id,
    start,
    end,
    label,
    className: buildPhaseClassName(phase, done ? 100 : 0),
    title: "",
  }).map((item) => ({
    kind: "phase",
    classes: item.className,
    label: toText(item.content),
    start: new Date(item.start.getTime()),
    end: new Date(item.end.getTime()),
    paint: late ? retardPhasePaint(item.className, 0, 1) : null,
  }));
}

// Libellés des barres du planning Structure, par type ; un type personnalisé garde son nom.
const TYPE_LABELS = Object.freeze({ ndc: "NDC", coupes: "COUPES", demolition: "DÉMOLITION" });

// Groupe d'un document qui n'est ni un coffrage ni une armature : un par type, les types
// personnalisés réunis par nom sans tenir compte de la casse (comme le mode agrégé du planning
// Structure). null : le document reste une ligne simple (armature sans coffrage).
function typeGroupOf(doc) {
  if (!["ndc", "coupes", "demolition", "generic"].includes(doc.rowType)) return null;
  if (doc.rowType !== "generic") return { key: doc.rowType, rowType: doc.rowType, label: TYPE_LABELS[doc.rowType] };
  const name = toText(doc.typeDoc);
  return { key: `generic:${name.toLocaleUpperCase("fr")}`, rowType: "generic", label: name };
}

// Les autres documents Structure d'une zone, dans l'ordre du planning Structure : un groupe par
// type, à la place de son premier document, avec la barre de toute sa section ; les autres
// documents seuls.
function otherDocEntries(zone) {
  const entries = [];
  const groups = new Map();
  zone.docs.forEach((doc) => {
    const type = typeGroupOf(doc);
    if (!type) {
      entries.push({ kind: "doc", doc });
      return;
    }
    if (!groups.has(type.key)) {
      const entry = { kind: "type", ...type, docs: [] };
      groups.set(type.key, entry);
      entries.push(entry);
    }
    groups.get(type.key).docs.push(doc);
  });
  groups.forEach((entry) => {
    entry.section = sectionSegments(entry.docs, {
      id: `type-${zone.zoneKey}-${entry.key}`,
      phase: `phase-${entry.rowType}`,
      label: entry.label,
    });
  });
  return entries;
}

function earliest(dates) {
  const list = dates.filter((date) => date instanceof Date);
  return list.length ? new Date(Math.min(...list.map((date) => date.getTime()))) : null;
}

// Le planning fusionné d'un projet : ses zones (triées par nom, « Sans zone » à la fin), et
// dans chacune ses entrées, dans l'ordre d'affichage — niveaux liés et coffrages sans étage
// (ordre du planning Structure), étages de Synthèse hors niveau, tâches de Synthèse hors étage,
// autres documents Structure. `projectRows` : Planning_Projet du projet, tous services ;
// `planRows` : ListePlan_NDC_COF du projet ; `today` : le jour des retards ; `targetLookup` et
// `referenceLookup` : voir readStructureDocs.
export function buildGlobalPlanning({
  projectRows = [],
  planRows = [],
  today = new Date(),
  targetLookup = null,
  referenceLookup = null,
} = {}) {
  const rows = Array.isArray(projectRows) ? projectRows : [];
  const syntheseRows = rows.filter(isSyntheseServiceRow);
  const docs = readStructureDocs(rows, { targetLookup, referenceLookup });
  docs.forEach((doc) => {
    doc.check = checkDocument(doc, today);
  });

  const zones = new Map();
  const zoneFor = (zoneKey, zoneName) => {
    if (!zones.has(zoneKey)) {
      zones.set(zoneKey, { zoneKey, zoneName, label: zoneName || NO_ZONE_LABEL, heads: [], floors: [], tasks: [], docs: [] });
    }
    return zones.get(zoneKey);
  };

  // Structure : chaque coffrage ouvre un bloc ; les armatures de son Groupe s'y rangent (sous
  // le premier coffrage du groupe) ; tout le reste est un document simple de sa zone.
  const headsById = new Map();
  const headByGroup = new Map();
  docs.forEach((doc) => {
    if (doc.typeKey !== "coffrage") return;
    const head = { doc, rebars: [], floors: [] };
    zoneFor(doc.zoneKey, doc.zoneName).heads.push(head);
    headsById.set(doc.id, head);
    if (doc.groupKey && !headByGroup.has(doc.groupKey)) headByGroup.set(doc.groupKey, head);
  });
  docs.forEach((doc) => {
    if (doc.typeKey === "coffrage") return;
    const head = doc.typeKey === "armature" && doc.groupKey ? headByGroup.get(doc.groupKey) : null;
    if (head) head.rebars.push(doc);
    else zoneFor(doc.zoneKey, doc.zoneName).docs.push(doc);
  });
  // Coffrage replié sur ses armatures : une barre pour toute la section ; sans armature, ses
  // propres barres suffisent.
  headsById.forEach((head) => {
    head.section = head.rebars.length
      ? sectionSegments([head.doc, ...head.rebars], { id: `section-${head.doc.id}`, phase: "phase-coffrage", label: "Coffrage" })
      : null;
  });

  // Synthèse : un étage rejoint le bloc de son coffrage quand ils sont dans la même zone.
  const link = buildStructureLink({ syntheseRows, projectRows: rows, planRows });
  const linkFloors = new Map();
  link.zones.forEach((zone) => zone.floors.forEach((floor) => linkFloors.set(`${zone.zoneKey}/${floor.key}`, floor)));
  const controls = readControlTasks(syntheseRows);
  const limits = controlTaskEndLimits({
    syntheseRows,
    formworkStarts: docs
      .filter((doc) => doc.isFormwork)
      .sort((left, right) => left.id - right.id)
      .map((doc) => ({ number: doc.number, zoneName: doc.zoneName, start: doc.start })),
  });
  buildSections({ rows: syntheseRows }).forEach((section) => {
    section.items.forEach((item) => {
      if (item.kind === "task") {
        zoneFor(section.zoneKey, section.zoneName).tasks.push(item.task);
        return;
      }
      const { floor } = item;
      const floorLink = linkFloors.get(`${section.zoneKey}/${floor.key}`) || { state: "none", formworkNumber: "", formwork: null };
      const head = floorLink.formwork ? headsById.get(floorLink.formwork.id) || null : null;
      const sameZone = Boolean(head) && head.doc.zoneKey === section.zoneKey;
      const node = {
        key: floor.key,
        name: floor.name,
        zoneKey: section.zoneKey,
        zoneName: section.zoneName,
        floor,
        link: floorLink,
        check: checkFloor({
          tasks: floor.tasks,
          link: floorLink,
          controls,
          limits,
          worksStart: head ? earliest([head.doc.worksStart, ...head.rebars.map((rebar) => rebar.worksStart)]) : null,
        }),
        otherZoneLabel: head && !sameZone ? head.doc.zoneName || NO_ZONE_LABEL : "",
      };
      if (sameZone) head.floors.push(node);
      else zoneFor(section.zoneKey, section.zoneName).floors.push(node);
    });
  });

  const ordered = [...zones.values()]
    .sort((left, right) => {
      if ((left.zoneKey === NO_ZONE_KEY) !== (right.zoneKey === NO_ZONE_KEY)) return left.zoneKey === NO_ZONE_KEY ? 1 : -1;
      return compareNames(left.zoneName, right.zoneName);
    })
    .map((zone) => ({
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      label: zone.label,
      entries: [
        ...zone.heads.map((head) => ({ kind: head.floors.length ? "level" : "formwork", ...head })),
        ...zone.floors.map((node) => ({ kind: "floor", node })),
        ...zone.tasks.map((task) => ({ kind: "task", task })),
        ...otherDocEntries(zone),
      ],
    }));
  return { zones: ordered, limits };
}

/* ---------- Modèle de lignes ---------- */

function latest(dates) {
  const list = dates.filter((date) => date instanceof Date);
  return list.length ? new Date(Math.max(...list.map((date) => date.getTime()))) : null;
}

const NO_DATES = Object.freeze({
  start: null,
  end: null,
  durationDays: null,
  isMilestone: false,
  startsWithMilestone: false,
  endsWithMilestone: false,
});

function baseLine(fields) {
  return {
    service: "",
    zoneKey: "",
    zoneName: "",
    floorKey: "",
    groupRowId: null,
    taskId: null,
    link: null,
    nature: "",
    id2: "",
    indice: "",
    durationLabel: "",
    variant: "",
    countLabel: "",
    ...NO_DATES,
    ...fields,
  };
}

function docNode(doc, role, level, zone) {
  const alert = doc.check?.alert || null;
  return {
    line: baseLine({
      key: `doc:${doc.id}`,
      kind: "doc",
      role,
      service: "structure",
      level,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: doc.name,
      id2: doc.number,
      indice: doc.indice,
      durationLabel: doc.weeks ? `${doc.weeks} sem.` : "",
      start: doc.start,
      end: doc.end,
      // Couleur de la ligne : celle de son type dans le tableau du planning Structure.
      variant: doc.rowType,
      // Dans le Gantt : les barres du planning Structure, pas une barre Début → Fin.
      segments: doc.segments,
    }),
    own: countAlerts(alert ? [alert] : []),
    doc,
    children: [],
  };
}

function formworkNode(head, level, zone) {
  const node = docNode(head.doc, "formwork", level, zone);
  node.children = head.rebars.map((rebar) => docNode(rebar, "rebar", level + 1, zone));
  const count = head.rebars.length;
  node.line.countLabel = count ? `${count} armature${count > 1 ? "s" : ""}` : "";
  node.section = head.section;
  return node;
}

// Lignes de Synthèse d'un contenu de zone (un étage, ou une tâche hors étage), toutes
// dépliées, telles que les donne le modèle de la vue Synthese — la ligne de zone en moins.
function syntheseLines(zone, items, limits) {
  const section = { zoneKey: zone.zoneKey, zoneName: zone.zoneName, label: zone.label, summary: null, items };
  return applyEndLimits(buildRowModel([section]).slice(1), limits);
}

function syntheseLine(line, level, name = line.name) {
  const summary = line.kind !== "task";
  return baseLine({
    ...line,
    role: line.kind,
    service: "synthese",
    level,
    name,
    durationLabel: summary && line.durationDays == null ? "" : formatDuration(line.durationDays),
  });
}

// Arbre d'un étage : la ligne « Synthèse · étage », puis son contenu, un cran par niveau du
// modèle Synthese. Chaque tâche en retard porte ses alertes.
function floorNode(floorEntry, level, zone, limits) {
  const lines = syntheseLines(zone, [{ kind: "floor", floor: floorEntry.floor }], limits);
  const { check } = floorEntry;
  const root = {
    line: syntheseLine(lines[0], level, `Synthèse · ${floorEntry.name}`),
    own: countAlerts(check.alerts),
    floorEntry,
    children: [],
  };
  const stack = [{ depth: lines[0].level, node: root }];
  lines.slice(1).forEach((line) => {
    while (stack.at(-1).depth >= line.level) stack.pop();
    const alerts = line.kind === "task" ? check.taskAlerts.get(line.taskId) || [] : [];
    const node = {
      line: syntheseLine(line, level + line.level - lines[0].level),
      own: countAlerts(alerts),
      alerts,
      children: [],
    };
    stack.at(-1).node.children.push(node);
    stack.push({ depth: line.level, node });
  });
  return root;
}

function levelNode(entry, zone, limits) {
  const { doc } = entry;
  return {
    line: baseLine({
      key: `level:${doc.id}`,
      kind: "level",
      role: "level",
      level: 1,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: `${entry.floors.map((floor) => floor.name).join(", ")} ⇄ ${formworkLabel({ number: doc.number, name: doc.name })}`,
    }),
    own: emptyCounts(),
    floorEntries: entry.floors,
    children: [
      ...entry.floors.map((floorEntry) => floorNode(floorEntry, 2, zone, limits)),
      formworkNode(entry, 2, zone),
    ],
  };
}

// Groupe des documents d'un même type dans une zone (« DÉMOLITION »…) : sa ligne, à la couleur
// du type dans le tableau Structure, puis ses documents ; replié, la barre de toute sa section.
function typeNode(entry, zone) {
  const count = entry.docs.length;
  return {
    line: baseLine({
      key: `type:${zone.zoneKey}/${entry.key}`,
      kind: "type",
      role: "type",
      service: "structure",
      level: 1,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: entry.label,
      variant: entry.rowType,
      countLabel: `${count} document${count > 1 ? "s" : ""}`,
    }),
    own: emptyCounts(),
    children: entry.docs.map((doc) => docNode(doc, "doc", 2, zone)),
    section: entry.section,
  };
}

function zoneNode(zone, limits) {
  const children = zone.entries.map((entry) => {
    if (entry.kind === "level") return levelNode(entry, zone, limits);
    if (entry.kind === "formwork") return formworkNode(entry, 1, zone);
    if (entry.kind === "floor") return floorNode(entry.node, 1, zone, limits);
    if (entry.kind === "type") return typeNode(entry, zone);
    if (entry.kind === "doc") return docNode(entry.doc, "doc", 1, zone);
    const [line] = syntheseLines(zone, [{ kind: "task", task: entry.task }], limits);
    return { line: syntheseLine(line, 1), own: emptyCounts(), alerts: [], children: [] };
  });
  return {
    line: baseLine({
      key: `zone:${zone.zoneKey}`,
      kind: "zone",
      role: "zone",
      level: 0,
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      name: zone.label,
    }),
    own: emptyCounts(),
    children,
  };
}

// Compteurs d'alertes (les siennes et celles de son contenu) et étendue des dates de chaque
// nœud, de bas en haut. Zone, niveau et groupe d'un type prennent l'étendue de leur contenu.
function settle(node) {
  node.children.forEach(settle);
  node.inner = node.children.reduce((total, child) => addCounts(total, child.counts), emptyCounts());
  node.counts = addCounts(addCounts(emptyCounts(), node.own), node.inner);
  node.bounds = {
    start: earliest([node.line.start, ...node.children.map((child) => child.bounds.start)]),
    end: latest([node.line.end, ...node.children.map((child) => child.bounds.end)]),
  };
  if (node.line.kind === "zone" || node.line.kind === "level" || node.line.kind === "type") {
    node.line.start = node.bounds.start;
    node.line.end = node.bounds.end;
  }
}

function stateOf(node) {
  const { line } = node;
  if (line.role === "zone" || line.role === "group" || line.role === "type") return summaryState(node.counts);
  if (line.role === "level") {
    return levelState({ checks: node.floorEntries.map((floorEntry) => floorEntry.check), counts: node.counts });
  }
  if (line.role === "floor") {
    const { check, link, otherZoneLabel } = node.floorEntry;
    return floorState({ check, link, counts: node.inner, otherZoneLabel });
  }
  if (line.role === "task") return taskState(node.alerts);
  if (line.role === "formwork") return formworkState({ own: node.doc.check, lateRebars: node.inner.structure });
  const { part, title } = node.doc.check;
  return part ? { parts: [part], title } : null;
}

// Les lignes affichées, dans l'ordre, avec leur état, et les compteurs de la barre d'état.
// Par défaut : zones dépliées, tout le reste replié ; `toggledKeys` porte les clés des lignes
// que l'utilisateur a basculées. `alertsOnly` : seulement les lignes en alerte et leurs
// parentes, dépliées. `zoneFilter` : le nom de la zone du bandeau ("" : toutes).
export function buildGlobalRowModel(planning, { zoneFilter = "", toggledKeys = new Set(), alertsOnly = false } = {}) {
  const filterKey = zoneKeyOf(zoneFilter);
  const zones = (planning?.zones || []).filter((zone) => !filterKey || zone.zoneKey === filterKey);
  const totals = { linkedFloors: 0, unlinkedFloors: 0, ...emptyCounts() };
  const lines = [];
  const visit = (node) => {
    if (alertsOnly && !hasAlerts(node.counts)) return;
    const expandable = node.children.some((child) => !alertsOnly || hasAlerts(child.counts));
    const collapsedByDefault = !alertsOnly && node.line.kind !== "zone";
    const collapsed = expandable && (toggledKeys.has(node.line.key) ? !collapsedByDefault : collapsedByDefault);
    const late = node.counts.synthese > 0;
    // Coffrage ou groupe d'un type dont les documents ne sont pas affichés dessous (replié, ou
    // aucun en alerte en « Alertes seulement ») : une seule barre pour toute sa section.
    const folded = Boolean(node.section) && (collapsed || !expandable);
    lines.push({
      ...node.line,
      ...(folded ? { segments: node.section } : {}),
      collapsed,
      expandable,
      childCount: node.children.length,
      state: stateOf(node),
      // Fin en rouge sur la tâche fautive ; crochet rouge sur ce qui la contient.
      lateEnd: node.line.role === "task" && late,
      tone: late && node.line.kind !== "zone" ? "late" : "",
    });
    if (!collapsed) node.children.forEach(visit);
  };
  zones.forEach((zone) => {
    const node = zoneNode(zone, planning.limits);
    settle(node);
    addCounts(totals, node.counts);
    zone.entries.forEach((entry) => {
      const floorEntries = entry.kind === "level" ? entry.floors : entry.kind === "floor" ? [entry.node] : [];
      floorEntries.forEach((floorEntry) => {
        if (floorEntry.check.linked) totals.linkedFloors += 1;
        else if (floorEntry.link.state === "none") totals.unlinkedFloors += 1;
      });
    });
    visit(node);
  });
  return { lines, totals };
}
