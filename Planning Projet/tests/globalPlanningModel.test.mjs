// Vue Global : fusion du planning Synthèse et du planning Structure d'un projet — documents
// Structure, zones, niveaux liés, armatures sous leur coffrage, ordre des entrées.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const {
  buildGlobalPlanning, docTypeKeyOf, readStructureDocs, structureRowTypeOf,
} = await import("../assets/js/services/globalPlanningModel.js");
const { buildProjectRealisationTargetLookup } = await import("../assets/js/services/planningService.js");
const { zoneKeyOf } = await import("../assets/js/services/syntheseTaskModel.js");
const {
  PROJECT, TODAY, ZONE_1, ZONE_2, planRows, projectRows, structureRows, syntheseRows,
} = await import("./helpers/globalRows.mjs");

const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);
const build = (rows = projectRows(), plans = planRows()) => buildGlobalPlanning({ projectRows: rows, planRows: plans, today: TODAY });
// Entrée résumée : son genre et ce qu'elle désigne.
const brief = (entry) => {
  if (entry.kind === "level") return `level:${entry.doc.number}<${entry.floors.map((floor) => floor.name).join(",")}>+${entry.rebars.length}`;
  if (entry.kind === "formwork") return `formwork:${entry.doc.number}+${entry.rebars.length}`;
  if (entry.kind === "floor") return `floor:${entry.node.name}`;
  if (entry.kind === "task") return `task:${entry.task.id}`;
  if (entry.kind === "type") return `type:${entry.label}[${entry.docs.map((doc) => doc.number).join(",")}]`;
  return `doc:${entry.doc.number}`;
};
const zoneOf = (planning, zoneName) => planning.zones.find((zone) => zone.zoneKey === zoneKeyOf(zoneName));

test("type d'un document Structure, sans accents ni casse", () => {
  assert.deepEqual(
    ["COFFRAGE", "Armatures", "NDC", "coupes", "DÉMOLITION", "Carnet", ""].map(docTypeKeyOf),
    ["coffrage", "armature", "ndc", "coupes", "demolition", "autre", "autre"]
  );
});

test("couleur de ligne d'un document : le type que lui donne le tableau du planning Structure", () => {
  assert.deepEqual(
    ["COFFRAGE", "ARMATURES", "Armature", "NDC", "NOTE DE CALCUL", "COUPES", "Coupe", "DÉMOLITION", "Carnet", " ", ""]
      .map(structureRowTypeOf),
    ["coffrage", "armature", "armature", "ndc", "ndc", "coupes", "coupes", "demolition", "generic", "", ""]
  );
  // Plusieurs types reconnus : la couleur qui l'emporte dans la feuille de style du tableau.
  assert.deepEqual(["NDC COFFRAGE", "COUPE ARMATURES", "DEMOLITION COUPES"].map(structureRowTypeOf), ["ndc", "coupes", "demolition"]);
  const docs = readStructureDocs(projectRows());
  assert.deepEqual(
    ["3032", "3314", "3820", "3999"].map((number) => docs.find((doc) => doc.number === number).rowType),
    ["coffrage", "armature", "coupes", "ndc"]
  );
});

test("documents Structure : l'ordre et les dates du planning Structure, les valeurs stockées", () => {
  const docs = readStructureDocs(projectRows());
  assert.deepEqual(docs.map((doc) => doc.number), [
    "3031", "3216", "3032", "3314", "3012", "3306", "3022", "3310", "3820", "3724", "3999",
  ]);
  const formwork = docs.find((doc) => doc.number === "3032");
  assert.deepEqual(
    [formwork.id, formwork.typeKey, formwork.zoneName, iso(formwork.start), iso(formwork.end), formwork.worksStart, formwork.weeks],
    [113, "coffrage", ZONE_2, "2026-08-19", "2026-09-02", null, 2]
  );
  assert.deepEqual([formwork.indice, formwork.realise, formwork.storedRetard, formwork.isFormwork], ["A", 67, 37, true]);
  const rebar = docs.find((doc) => doc.number === "3314");
  assert.deepEqual([rebar.typeKey, iso(rebar.start), iso(rebar.end), iso(rebar.worksStart), rebar.groupKey], [
    "armature", "2026-09-02", "2026-09-16", "2026-10-14", formwork.groupKey,
  ]);
  assert.equal(docs.find((doc) => doc.number === "3820").groupKey, "", "coupes : hors groupe");
  assert.equal(docs.find((doc) => doc.number === "3724").weeks, null);
  assert.deepEqual(readStructureDocs(null), []);
});

// Les segments dépendent de l'heure (partie passée, partie à venir) : horloge arrêtée.
function atNow(now, run) {
  mock.timers.enable({ apis: ["Date"], now });
  try {
    return run();
  } finally {
    mock.timers.reset();
  }
}
const NOW = new Date(2026, 9, 9, 10, 0, 0);
const utcDay = (text) => new Date(`${text}T00:00:00.000Z`);
const briefSegment = (segment) => [segment.kind, segment.classes, segment.label, segment.start.getTime(), segment.end.getTime(), segment.paint];

test("segments : ceux que le planning Structure dessine pour le document, dans le même ordre", () => {
  const referenceLookup = new Map([[113, {
    rowId: 113, firstDateLimiteIso: "2026-07-01", firstTimelineDateLimiteIso: "2026-07-01", status: "mixed",
    receivedCount: 1, missingCount: 1, totalCount: 2, references: [],
  }]]);
  const docs = atNow(NOW, () => readStructureDocs(projectRows(), { referenceLookup }));
  const segmentsOf = (number) => docs.find((doc) => doc.number === number).segments.map(briefSegment);
  // Coffrage en cours : partie passée sans libellé, partie à venir avec « Coffrage ».
  assert.deepEqual(segmentsOf("3012"), [
    ["phase", "phase-coffrage phase-realise-complete phase-past", "", utcDay("2026-10-05").getTime(), NOW.getTime(), null],
    ["phase", "phase-coffrage phase-realise-complete", "Coffrage", NOW.getTime(), utcDay("2026-10-19").getTime(), null],
  ]);
  // Armature passée, en retard et réalisée à 0 % : couleurs de retard ; puis son démarrage.
  assert.deepEqual(segmentsOf("3314"), [
    ["phase", "phase-armature phase-past", "Armature", utcDay("2026-09-02").getTime(), utcDay("2026-09-16").getTime(),
      { realise: 0, done: "#e5e7eb", late: "#efc2c2", border: "#dc9f9f", text: "#334155" }],
    ["works", "phase-demarrage", "", utcDay("2026-10-14").getTime(), utcDay("2026-10-15").getTime(), null],
  ]);
  // Données d'entrées du coffrage 3032.
  assert.deepEqual(segmentsOf("3032"), [
    ["phase", "phase-coffrage phase-realise-complete phase-past", "Coffrage", utcDay("2026-08-19").getTime(), utcDay("2026-09-02").getTime(), null],
    ["reference", "phase-reference-reception phase-reference-reception--mixed", "Données d'entrées",
      utcDay("2026-07-01").getTime(), utcDay("2026-07-02").getTime(), null],
  ]);
  assert.deepEqual(segmentsOf("3724"), [], "sans dates : rien à dessiner");
  assert.deepEqual(atNow(NOW, () => readStructureDocs(projectRows())).find((doc) => doc.number === "3032").segments.length, 1,
    "sans données d'entrées connues : pas de case");
});

test("segments : réalisé calculé avec les indices de référence du service Structure", () => {
  const targetLookup = buildProjectRealisationTargetLookup([{
    projectName: PROJECT,
    avancementConfigRaw: JSON.stringify({ services: { Structure: [{ typeDocument: "COFFRAGE", indice: "C" }] } }),
  }], "Structure");
  const docs = atNow(NOW, () => readStructureDocs(projectRows(), { targetLookup }));
  // 3032 à l'indice A sur C : réalisé à 50 %, 37 j de retard → moitié couleur habituelle, moitié retard.
  assert.deepEqual(docs.find((doc) => doc.number === "3032").segments.map(briefSegment), [
    ["phase", "phase-coffrage phase-past", "Coffrage", utcDay("2026-08-19").getTime(), utcDay("2026-09-02").getTime(),
      { realise: 50, done: "#ead7a2", late: "#d88f8f", border: "#d6bd74", text: "#7a4b12" }],
  ]);
  const planning = atNow(NOW, () => buildGlobalPlanning({ projectRows: projectRows(), planRows: planRows(), today: TODAY, targetLookup }));
  const level = zoneOf(planning, ZONE_2).entries.find((entry) => entry.kind === "level" && entry.doc.number === "3032");
  assert.equal(level.doc.segments[0].paint.realise, 50, "transmis par buildGlobalPlanning");
});

// Coffrage replié sur ses armatures : une seule barre pour toute la section.
test("section d'un coffrage : une barre du début de sa phase à la fin de sa dernière armature", () => {
  const planning = atNow(NOW, () => build());
  const zone2 = zoneOf(planning, ZONE_2);
  const headOf = (number) => [...zoneOf(planning, ZONE_1).entries, ...zone2.entries]
    .find((entry) => (entry.kind === "level" || entry.kind === "formwork") && entry.doc.number === number);
  // 3032 et son armature 3314 : passées ; l'armature en retard à 0 % → couleurs de retard.
  assert.deepEqual(headOf("3032").section.map(briefSegment), [
    ["phase", "phase-coffrage phase-past", "Coffrage", utcDay("2026-08-19").getTime(), utcDay("2026-09-16").getTime(),
      { realise: 0, done: "#ead7a2", late: "#d88f8f", border: "#bb6b6b", text: "#7a4b12" }],
  ]);
  // 3012 et son armature 3306 : en cours, coupée à l'heure actuelle ; rien en retard.
  assert.deepEqual(headOf("3012").section.map(briefSegment), [
    ["phase", "phase-coffrage phase-past", "", utcDay("2026-10-05").getTime(), NOW.getTime(), null],
    ["phase", "phase-coffrage", "Coffrage", NOW.getTime(), utcDay("2026-11-02").getTime(), null],
  ]);
  // 3031 et 3216 : à venir.
  assert.deepEqual(headOf("3031").section.map(briefSegment), [
    ["phase", "phase-coffrage", "Coffrage", utcDay("2027-03-03").getTime(), utcDay("2027-03-31").getTime(), null],
  ]);
});

test("section d'un coffrage : bord vert quand tout est réalisé ; aucune sans armature", () => {
  // Armature 3216 passée à l'indice A : réalisée, comme son coffrage 3031.
  const done = projectRows().map((row) => (row.id === 102 ? { ...row, Indice: "A" } : row));
  const planning = atNow(NOW, () => build(done));
  const head = zoneOf(planning, ZONE_1).entries.find((entry) => entry.doc?.number === "3031");
  assert.deepEqual(head.section.map((segment) => segment.classes), ["phase-coffrage phase-realise-complete"]);
  const alone = atNow(NOW, () => build(projectRows().filter((row) => row.id !== 122)));
  assert.equal(zoneOf(alone, ZONE_2).entries.find((entry) => entry.doc?.number === "3022").section, null);
});

// Autres documents (ni coffrage, ni armature) : rassemblés par type dans leur zone.
const otherDoc = (id, number, type, start, end, fields = {}) => ({
  id, NomProjet: PROJECT, Service: "Structure", ID2: number, Taches: `${type} ${number}`, Type_doc: type, Zone: ZONE_2,
  Groupe: "", Ligne_planning: "", Indice: "", Duree_1: 2, Duree_2: 0, Duree_3: 0, Date_limite: start, Diff_coffrage: end,
  Diff_armature: null, Demarrages_travaux: null, Retards: 0, Realise: 0, Date_Realise: null, Date_Cloture: null, Remarque: "",
  ...fields,
});
const withOtherDocs = () => [
  ...projectRows(),
  otherDoc(161, "3901", "DÉMOLITION", "2026-09-01", "2026-09-15", { Retards: 5 }),
  otherDoc(162, "3902", "DÉMOLITION", "2026-10-20", "2026-11-03"),
  otherDoc(163, "3903", "Carnet", "2026-11-01", "2026-11-15"),
  otherDoc(164, "3904", "CARNET", "2026-12-01", "2026-12-15"),
];

test("autres documents : un groupe par type dans leur zone, à la place de son premier document", () => {
  const planning = build(withOtherDocs());
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief).slice(5), [
    "type:DÉMOLITION[3901,3902]", "type:Carnet[3903,3904]", "type:COUPES[3820]", "doc:3724",
  ], "types personnalisés réunis sans tenir compte de la casse, comme le planning Structure ; armature sans coffrage à part");
  const demolition = zoneOf(planning, ZONE_2).entries.find((entry) => entry.kind === "type" && entry.rowType === "demolition");
  assert.deepEqual([demolition.key, demolition.label], ["demolition", "DÉMOLITION"]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.find((entry) => entry.label === "Carnet").key, "generic:CARNET");
});

test("groupe d'un type : une barre de sa première à sa dernière phase, aux couleurs du type", () => {
  const planning = atNow(NOW, () => build(withOtherDocs()));
  const typeOf = (label) => zoneOf(planning, ZONE_2).entries.find((entry) => entry.kind === "type" && entry.label === label);
  // 3901 en retard à 0 % : toute la barre aux couleurs de retard de la démolition.
  assert.deepEqual(typeOf("DÉMOLITION").section.map(briefSegment), [
    ["phase", "phase-demolition phase-past", "", utcDay("2026-09-01").getTime(), NOW.getTime(),
      { realise: 0, done: "#f5cfcf", late: "#fde68a", border: "#f59e0b", text: "#5c0000" }],
    ["phase", "phase-demolition", "DÉMOLITION", NOW.getTime(), utcDay("2026-11-03").getTime(),
      { realise: 0, done: "#fde8e8", late: "#fef3c7", border: "#fcd34d", text: "#7a0000" }],
  ]);
  assert.deepEqual(typeOf("Carnet").section.map(briefSegment), [
    ["phase", "phase-generic", "Carnet", utcDay("2026-11-01").getTime(), utcDay("2026-12-15").getTime(), null],
  ]);
  assert.deepEqual(zoneOf(planning, "").entries[0].section, [], "NDC sans dates : rien à dessiner");
});

test("Topographie et anciens segments de Synthese v1 : ignorés", () => {
  assert.equal(readStructureDocs(projectRows()).some((doc) => doc.number === "7001"), false, "document de Topographie");
  const taskIds = build().zones.flatMap((zone) => zone.entries.filter((entry) => entry.kind === "task").map((entry) => entry.task.id));
  assert.deepEqual(taskIds, [600], "le segment v1 (id 902) n'est pas une tâche");
});

test("zones communes aux deux services, triées, « Sans zone » à la fin", () => {
  assert.deepEqual(build().zones.map((zone) => [zone.label, zone.zoneKey]), [
    [ZONE_1, zoneKeyOf(ZONE_1)],
    [ZONE_2, zoneKeyOf(ZONE_2)],
    ["Sans zone", ""],
  ]);
});

test("une zone : niveaux et coffrages dans l'ordre de Structure, puis le reste de la Synthèse, puis les autres documents", () => {
  const planning = build();
  assert.deepEqual(zoneOf(planning, ZONE_1).entries.map(brief), ["level:3031<SS1>+1"]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief), [
    "level:3032<RDC>+1",
    "formwork:3012+1",
    "level:3022<SS1>+1",
    "floor:R+1",
    "task:600",
    "type:COUPES[3820]",
    "doc:3724",
  ]);
  assert.deepEqual(planning.zones.at(-1).entries.map(brief), ["type:NDC[3999]"]);
});

test("armatures : sous le coffrage de leur zone et de leur Groupe", () => {
  const level = zoneOf(build(), ZONE_2).entries[0];
  assert.deepEqual(level.rebars.map((rebar) => rebar.number), ["3314"]);
  assert.equal(level.doc.check.alert.days, 37, "retard du coffrage, compté jusqu'à aujourd'hui");
  assert.equal(level.rebars[0].check.alert.days, 23);
});

// Deux coffrages d'un même groupe prennent les dates de son armature : à dates égales, le
// planning Structure les range par N°, et 3022 passe devant 3032.
test("groupe à plusieurs coffrages : les armatures sous le premier ; armature sans coffrage : document simple", () => {
  const rows = structureRows().map((row) => {
    if (row.id === 112) return { ...row, Groupe: "13" }; // 3022 rejoint le groupe de 3032
    if (row.id === 122) return { ...row, Groupe: "99" }; // 3310 : groupe sans coffrage
    return row;
  });
  const entries = zoneOf(build(rows, []), ZONE_2).entries.map(brief);
  assert.deepEqual(entries, ["formwork:3022+1", "formwork:3032+0", "formwork:3012+1", "doc:3310", "type:COUPES[3820]", "doc:3724"]);
});

test("étage lié : ses contrôles, avec le démarrage des travaux de son niveau", () => {
  const planning = build();
  const [rdc] = zoneOf(planning, ZONE_2).entries[0].floors;
  assert.deepEqual([rdc.key, rdc.link.state, rdc.check.linked, rdc.otherZoneLabel], ["rdc", "waiting", true, ""]);
  const [alert] = rdc.check.taskAlerts.get(420);
  assert.deepEqual([alert.code, alert.days], ["late", 103]);
  assert.equal(rdc.check.passed, 1, "démarrage du gros œuvre avant le démarrage des travaux (14/10/26)");
  assert.deepEqual(rdc.check.unverifiable, ["le coffrage 3032 n'a pas de date 0 Prev"]);
  const [ss1] = zoneOf(planning, ZONE_2).entries[2].floors;
  assert.deepEqual([ss1.link.state, ss1.check.passed, ss1.check.taskAlerts.size], ["current", 3, 0]);
  const [stale] = zoneOf(planning, ZONE_1).entries[0].floors;
  assert.deepEqual(stale.check.alerts.map((entry) => entry.code), ["stale"]);
});

test("plusieurs étages liés au même coffrage : un seul niveau", () => {
  const rows = projectRows().map((row) => (row.id === 500 ? { ...row, Lien_Structure: "3032" } : row));
  const [level] = zoneOf(build(rows), ZONE_2).entries;
  assert.equal(brief(level), "level:3032<RDC,R+1>+1");
});

test("étage lié à un coffrage d'une autre zone : hors niveau, contrôlé quand même", () => {
  const rows = projectRows().map((row) => (row.id === 500 ? { ...row, Lien_Structure: "3031" } : row));
  const planning = build(rows);
  const entry = zoneOf(planning, ZONE_2).entries.find((candidate) => candidate.kind === "floor");
  assert.deepEqual([entry.node.name, entry.node.check.linked, entry.node.otherZoneLabel], ["R+1", true, ZONE_1]);
  assert.equal(brief(zoneOf(planning, ZONE_1).entries[0]), "level:3031<SS1>+1", "le coffrage garde son seul étage de sa zone");
});

test("coffrage introuvable ou étage non lié : hors niveau", () => {
  const rows = projectRows().map((row) => (row.id === 400 ? { ...row, Lien_Structure: "3099" } : row));
  const entries = zoneOf(build(rows), ZONE_2).entries;
  assert.deepEqual(entries.map(brief).slice(0, 5), ["formwork:3032+1", "formwork:3012+1", "level:3022<SS1>+1", "floor:RDC", "floor:R+1"]);
  const rdc = entries.find((entry) => entry.kind === "floor" && entry.node.name === "RDC").node;
  assert.deepEqual(rdc.check.alerts.map((alert) => alert.text), ["coffrage 3099 introuvable"]);
  const unlinked = entries.find((entry) => entry.kind === "floor" && entry.node.name === "R+1").node;
  assert.deepEqual([unlinked.link.state, unlinked.check.linked], ["none", false]);
});

test("projet sans Synthèse : le planning Structure, coffrages et armatures groupés", () => {
  const planning = build(structureRows(), []);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief), [
    "formwork:3032+1", "formwork:3012+1", "formwork:3022+1", "type:COUPES[3820]", "doc:3724",
  ]);
});

test("projet sans Structure : les étages, tous non liés ou introuvables", () => {
  const planning = build(syntheseRows(), []);
  assert.deepEqual(planning.zones.map((zone) => zone.label), [ZONE_1, ZONE_2]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief), ["floor:SS1", "floor:RDC", "floor:R+1", "task:600"]);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries[1].node.check.alerts.map((alert) => alert.code), ["missing"]);
});

test("colonnes de la Synthèse absentes (production) : rien ne casse, la Structure s'affiche", () => {
  const stripped = projectRows().map((row) => {
    const { Etage, Nature, Parent, Lien, Lien_Structure, Controle_Coffrage, ...rest } = row;
    return rest;
  });
  const planning = build(stripped);
  const entries = zoneOf(planning, ZONE_2).entries;
  assert.deepEqual(entries.filter((entry) => entry.kind !== "task").map(brief), [
    "formwork:3032+1", "formwork:3012+1", "formwork:3022+1", "floor:SS1", "floor:RDC", "floor:R+1", "type:COUPES[3820]", "doc:3724",
  ]);
  assert.ok(entries.some((entry) => entry.kind === "task"), "les lignes-étages, sans la colonne Etage, sont des tâches");
});

// Lues par l'API REST de Grist, les colonnes Date arrivent en secondes depuis 1970 (minuit UTC),
// pas en texte.
test("dates en secondes Grist : mêmes dates, mêmes retards qu'en texte", () => {
  const DATE_COLUMNS = ["Date_limite", "Diff_coffrage", "Diff_armature", "Demarrages_travaux", "DateDiffusion"];
  const toSeconds = (row) => {
    const copy = { ...row };
    DATE_COLUMNS.forEach((column) => {
      if (typeof copy[column] === "string" && copy[column]) copy[column] = Date.parse(`${copy[column]}T00:00:00Z`) / 1000;
    });
    return copy;
  };
  const planning = build(projectRows().map(toSeconds), planRows().map(toSeconds));
  const level = zoneOf(planning, ZONE_2).entries[0];
  assert.equal(brief(level), "level:3032<RDC>+1");
  assert.deepEqual([iso(level.doc.start), iso(level.doc.end), iso(level.rebars[0].worksStart)], ["2026-08-19", "2026-09-02", "2026-10-14"]);
  assert.equal(level.doc.check.alert.days, 37);
  assert.equal(level.floors[0].check.taskAlerts.get(420)[0].days, 103);
  assert.equal(zoneOf(planning, ZONE_2).entries[2].floors[0].link.state, "current", "0 Prev lu en secondes");
});

test("même zone écrite différemment par les deux services : une seule section, l'étage rejoint son coffrage", () => {
  const rows = projectRows().map((row) => (
    row.Service === "Synthese" && row.Zone === ZONE_2 ? { ...row, Zone: "ZONE 2 / bat b" } : row
  ));
  const planning = build(rows);
  assert.equal(planning.zones.filter((zone) => zone.zoneKey === zoneKeyOf(ZONE_2)).length, 1);
  assert.equal(planning.zones.length, 3);
  assert.deepEqual(zoneOf(planning, ZONE_2).entries.map(brief).slice(0, 3), [
    "level:3032<RDC>+1", "formwork:3012+1", "level:3022<SS1>+1",
  ]);
});

test("projet connu sous deux noms : tous ses documents Structure, une seule fois", () => {
  const rows = projectRows().map((row) => (
    row.Service === "Structure" && row.Zone === ZONE_1 ? { ...row, NomProjet: "ERA QUAI D ORSAY" } : row
  ));
  const numbers = readStructureDocs(rows).map((doc) => doc.number);
  assert.deepEqual([...numbers].sort(), ["3012", "3022", "3031", "3032", "3216", "3306", "3310", "3314", "3724", "3820", "3999"]);
  assert.equal(brief(zoneOf(build(rows), ZONE_1).entries[0]), "level:3031<SS1>+1");
});

test("aucune ligne : aucune zone", () => {
  assert.deepEqual(build([], []).zones, []);
  assert.deepEqual(buildGlobalPlanning().zones, []);
  assert.equal(PROJECT, "ERA QUAI D'ORSAY");
});
