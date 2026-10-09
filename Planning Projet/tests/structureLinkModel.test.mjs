import test from "node:test";
import assert from "node:assert/strict";

import {
  LINK_STATES,
  applyEndLimits,
  applyFloorLinks,
  buildStructureLink,
  findFloorStart,
  formworkIssueDates,
  formworkLabel,
  isFormworkRow,
  numberKeyOf,
  readFloorLinks,
  reservationEndLimits,
} from "../assets/js/services/structureLinkModel.js";
import { readTask, zoneKeyOf } from "../assets/js/services/syntheseTaskModel.js";

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : date);

function row(id, fields = {}) {
  return {
    id,
    NomProjet: "HOTEL DIEU",
    Taches: "",
    Type_doc: "",
    ID2: "",
    Zone: "",
    Groupe: "",
    Etage: false,
    Service: "",
    Nature: "",
    Parent: "",
    Lien: "",
    Lien_Structure: "",
    Diff_coffrage: null,
    Diff_armature: null,
    Duree_1: 0,
    ...fields,
  };
}

const structure = (id, fields) => row(id, { Service: "Structure", ...fields });
const synthese = (id, fields) => row(id, { Service: "Synthese", ...fields });
const coffrage = (id, zone, number, name) => structure(id, { Type_doc: "COFFRAGE", Zone: zone, ID2: number, Taches: name });
const floor = (id, zone, name, link = "") => synthese(id, { Zone: zone, Taches: name, Etage: true, Lien_Structure: link });
const floorTask = (id, zone, floorName, name, fields = {}) => synthese(id, { Zone: zone, Groupe: floorName, Taches: name, ...fields });
// Une ligne de la liste de plans (ListePlan_NDC_COF).
const plan = (number, indice, date, fields = {}) => ({
  Nom_projet: "HOTEL DIEU",
  Type_document: "COFFRAGE",
  NumeroDocument: number,
  Indice: indice,
  DateDiffusion: date,
  Service: "Structure",
  ...fields,
});

test("coffrage de Structure : service Structure, type COFFRAGE, nommé", () => {
  assert.equal(isFormworkRow(coffrage(1, "Zone 1", "3001", "PH SS1")), true);
  assert.equal(isFormworkRow(structure(2, { Type_doc: " Coffrage ", Taches: "PH SS1" })), true, "casse et espaces ignorés");
  assert.equal(isFormworkRow(structure(3, { Type_doc: "ARMATURES", Taches: "PH SS1" })), false, "autre type");
  assert.equal(isFormworkRow(synthese(4, { Type_doc: "COFFRAGE", Taches: "PH SS1" })), false, "autre service");
  assert.equal(isFormworkRow(structure(5, { Type_doc: "COFFRAGE", Taches: "  " })), false, "ligne de zone");
  assert.equal(isFormworkRow(structure(0, { Type_doc: "COFFRAGE", Taches: "PH SS1" })), false, "id invalide");
  assert.equal(isFormworkRow(null), false);
});

test("libellé d'un coffrage : « N° — nom », le nom seul sans N°", () => {
  assert.equal(formworkLabel({ number: "3001", name: "PH SS1" }), "3001 — PH SS1");
  assert.equal(formworkLabel({ number: "", name: "PH SS1" }), "PH SS1");
});

test("clé d'un N° : sans accents ni casse, ponctuation et espaces équivalents, zéros gardés", () => {
  assert.equal(numberKeyOf(" 30  21 "), "30 21");
  assert.equal(numberKeyOf(3021), "3021");
  assert.equal(numberKeyOf("COF-A"), "cof a");
  assert.equal(numberKeyOf("Cof  a"), numberKeyOf("COF-A"));
  assert.equal(numberKeyOf("N°-É1"), "n e1");
  assert.notEqual(numberKeyOf("0110"), numberKeyOf("110"));
  assert.equal(numberKeyOf(null), "");
});

test("date 0 Prev : la plus ancienne date lisible des lignes COFFRAGE à l'indice « Prev 0 »", () => {
  const dates = formworkIssueDates([
    plan("3021", "Prev 0", "2025-11-27"),
    plan("3021", "0", "2025-11-20"), // diffusion réelle, même plus ancienne : ce n'est pas la prévision
    plan("3021", "A", "2026-03-06"),
    plan("3021", "Prev 0", "2025-12-02"), // doublon plus tardif
    plan("3031", "Prev 0", ""),
    plan("3031", "Prev 0", "pas une date"),
    plan("3041", "Prev 0", "2025-11-27", { Type_document: "ARMATURES" }),
    plan("3051", "Prev 0", "2025-11-27", { Service: "Synthese" }),
    plan("3061", " prev 0 ", 1764201600, { Service: "" }), // casse libre, date en nombre (secondes Grist), service vide
    plan(" 3071 ", "Prev 0", "27/11/2025", { Type_document: " Coffrage " }),
    plan("3081", "0", "2025-11-27"), // diffusé à l'indice 0, sans prévision
    null,
  ]);
  assert.deepEqual([...dates.keys()].sort(), ["3021", "3061", "3071"]);
  assert.equal(iso(dates.get("3021")), "2025-11-27");
  assert.equal(iso(dates.get("3061")), "2025-11-27");
  assert.equal(iso(dates.get("3071")), "2025-11-27");
  assert.equal(formworkIssueDates(null).size, 0);
});

test("lien d'un étage : lu sur sa ligne-étage, la plus ancienne d'abord", () => {
  const links = readFloorLinks([
    floor(11, "Zone 1", "SS1", " 3021 "),
    floor(12, "Zone 1", "SS2"),
    floor(13, "Zone 2", "SS1", "3022"),
    floorTask(14, "Zone 1", "SS1", "FOND DE PLAN", { Lien_Structure: "9999" }), // pas une ligne-étage
    floor(15, "Zone 1", "ss1", "4000"), // doublon de l'étage SS1
  ]);
  assert.deepEqual([...links.entries()], [
    [`${zoneKeyOf("Zone 1")}/ss1`, "3021"],
    [`${zoneKeyOf("Zone 2")}/ss1`, "3022"],
  ]);
  assert.equal(readFloorLinks(null).size, 0);
});

test("tâche visée : le fond de plan, et son prédécesseur s'il lui est lié « même début » sans décalage", () => {
  const taskOf = (fields) => readTask({ Type_doc: "", ID2: "", Zone: "Zone 1", Groupe: "SS1", ...fields });
  const reception = taskOf({ id: 30, Taches: "RECEPTION ARCH/TOPO/STR" });
  const other = taskOf({ id: 31, Taches: "PLAN DE SYNTHESE RESEAUX NIV SS1" });
  const fond = (lien) => taskOf({ id: 32, Taches: "Fond de plan de synthèse  niv SS1", Lien: lien });
  const ids = ({ plan: found, anchor }) => ({ plan: found?.id ?? null, anchor: anchor?.id ?? null });
  assert.deepEqual(ids(findFloorStart([other, fond("30 DD"), reception])), { plan: 32, anchor: 30 });
  assert.deepEqual(ids(findFloorStart([reception, fond("30 DD+2")])), { plan: 32, anchor: 32 }, "décalage : le fond de plan lui-même");
  assert.deepEqual(ids(findFloorStart([reception, fond("30 FD")])), { plan: 32, anchor: 32 });
  assert.deepEqual(ids(findFloorStart([reception, fond("")])), { plan: 32, anchor: 32 });
  assert.deepEqual(ids(findFloorStart([fond("99 DD")])), { plan: 32, anchor: 32 }, "prédécesseur hors de l'étage");
  assert.deepEqual(findFloorStart([reception, other]), { plan: null, anchor: null });
  assert.deepEqual(findFloorStart(null), { plan: null, anchor: null });
  const second = taskOf({ id: 40, Taches: "FOND DE PLAN DE SYNTHESE NIV SS1 bis" });
  assert.equal(findFloorStart([second, fond("")]).plan.id, 32, "deux fonds de plan : le plus ancien");
});

test("les zones du projet, étages de Synthese à gauche et coffrages de Structure à droite", () => {
  const syntheseRows = [
    synthese(10, { Zone: "Zone 2" }),
    floor(11, "Zone 1", "SS2"),
    floor(12, "Zone 1", "SS1"),
    floorTask(13, "Zone 1", "SS1", "FOND DE PLAN"),
    floorTask(14, "Zone 1", "SS1", "CYCLE 1", { Nature: "Cycle" }),
  ];
  const projectRows = [
    ...syntheseRows,
    coffrage(20, "Zone 1", "3002", "PH SS2"),
    coffrage(21, "Zone 1", "3001", "PH SS1"),
    coffrage(22, "Zone 3", "3010", "RDC"),
    structure(23, { Type_doc: "ARMATURES", Zone: "Zone 1", ID2: "4001", Taches: "PH SS1" }),
    structure(24, { Zone: "Zone 4" }),
    row(25, { Service: "Topographie", Zone: "Zone 5", Taches: "Relevé", Type_doc: "COFFRAGE" }),
  ];
  const model = buildStructureLink({ syntheseRows, projectRows });
  assert.deepEqual(model.zones.map((zone) => zone.label), ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]);
  const [zone1, zone2, zone3] = model.zones;
  assert.deepEqual(zone1.floors.map((item) => item.name), ["SS1", "SS2"]);
  assert.deepEqual(zone1.formworks.map(({ id, number, name, label }) => ({ id, number, name, label })), [
    { id: 21, number: "3001", name: "PH SS1", label: "3001 — PH SS1" },
    { id: 20, number: "3002", name: "PH SS2", label: "3002 — PH SS2" },
  ]);
  assert.deepEqual([zone2.floors, zone2.formworks], [[], []], "zone sans étage ni coffrage : affichée quand même");
  assert.deepEqual(zone3.floors, []);
  assert.deepEqual(zone3.formworks.map((item) => item.label), ["3010 — RDC"]);
});

test("une même zone écrite différemment dans les deux services n'apparaît qu'une fois", () => {
  const syntheseRows = [floor(11, "Zone 1", "SS1")];
  const model = buildStructureLink({
    syntheseRows,
    projectRows: [...syntheseRows, coffrage(20, "ZONE-1", "3001", "PH SS1")],
  });
  assert.equal(model.zones.length, 1);
  assert.deepEqual(model.zones[0].floors.map((item) => item.name), ["SS1"]);
  assert.deepEqual(model.zones[0].formworks.map((item) => item.label), ["3001 — PH SS1"]);
});

test("coffrages triés par N° (ordre naturel) puis par nom ; coffrage sans zone dans « Sans zone », à la fin", () => {
  const model = buildStructureLink({
    projectRows: [
      coffrage(1, "Zone 1", "3010", "B"),
      coffrage(2, "Zone 1", "302", "A"),
      coffrage(3, "Zone 1", "", "Sans numéro"),
      coffrage(4, "Zone 1", "302", "0 avant A"),
      coffrage(5, "", "3099", "Hors zone"),
    ],
  });
  assert.deepEqual(model.zones.map((zone) => zone.label), ["Zone 1", "Sans zone"]);
  assert.deepEqual(model.zones[0].formworks.map((item) => item.label), [
    "302 — 0 avant A",
    "302 — A",
    "3010 — B",
    "Sans numéro",
  ]);
  assert.deepEqual(model.zones[1].formworks.map((item) => item.label), ["3099 — Hors zone"]);
  assert.deepEqual(model.zones[1].floors, []);
});

test("projet sans ligne : aucune zone", () => {
  assert.deepEqual(buildStructureLink({}), { zones: [] });
  assert.deepEqual(buildStructureLink(), { zones: [] });
  assert.deepEqual(buildStructureLink({ syntheseRows: null, projectRows: null, planRows: null }), { zones: [] });
});

test("état du lien de chaque étage, date 0 Prev et étages servis de chaque coffrage", () => {
  const zone = "Zone 1";
  const fondDePlan = (id, floorName, start) => floorTask(id, zone, floorName, `FOND DE PLAN DE SYNTHESE NIV ${floorName}`, {
    Diff_coffrage: start,
    Diff_armature: start,
    Duree_1: 1,
  });
  const syntheseRows = [
    floor(1, zone, "A"), // pas de lien
    floor(2, zone, "B", "9999"), // coffrage introuvable
    floor(3, zone, "C", "3001"), // pas de fond de plan
    floor(4, zone, "D", "3002"), fondDePlan(40, "D", null), // pas de 0 Prev, même diffusé à l'indice 0
    floor(5, zone, "E", "3001"), fondDePlan(50, "E", "2025-11-27"), // à jour
    floor(6, zone, "F", "3001"), fondDePlan(60, "F", "2026-01-02"), // autre date
    floor(7, zone, "G", "3001"), fondDePlan(70, "G", null), // pas encore daté
    floor(8, zone, "H", "3003"), fondDePlan(80, "H", "2025-12-01"), // 0 Prev un samedi : à jour le lundi
  ];
  const projectRows = [
    coffrage(20, zone, "3001", "PH A"),
    coffrage(21, zone, "3002", "PH B"),
    coffrage(22, zone, "3003", "PH C"),
  ];
  const planRows = [
    plan("3001", "Prev 0", "2025-11-27"),
    plan("3002", "0", "2025-11-27"),
    plan("3003", "Prev 0", "2025-11-29"),
  ];
  const [section] = buildStructureLink({ syntheseRows, projectRows, planRows }).zones;
  const byName = Object.fromEntries(section.floors.map((item) => [item.name, item]));
  assert.deepEqual(Object.fromEntries(section.floors.map((item) => [item.name, item.state])), {
    A: LINK_STATES.none,
    B: LINK_STATES.missing,
    C: LINK_STATES.noPlan,
    D: LINK_STATES.waiting,
    E: LINK_STATES.current,
    F: LINK_STATES.stale,
    G: LINK_STATES.stale,
    H: LINK_STATES.current,
  });
  assert.equal(byName.A.formworkNumber, "");
  assert.deepEqual([byName.B.formworkNumber, byName.B.formwork], ["9999", null]);
  assert.equal(byName.C.plan, null);
  assert.equal(byName.D.expectedStart, null);
  assert.equal(byName.E.formwork.label, "3001 — PH A");
  assert.deepEqual([byName.E.plan.id, byName.E.plan.name, iso(byName.E.plan.start)], [50, "FOND DE PLAN DE SYNTHESE NIV E", "2025-11-27"]);
  assert.equal(iso(byName.H.expectedStart), "2025-12-01");
  const formworks = Object.fromEntries(section.formworks.map((item) => [item.number, item]));
  assert.equal(iso(formworks["3001"].issueDate), "2025-11-27");
  assert.equal(formworks["3002"].issueDate, null);
  assert.deepEqual(formworks["3001"].floorNames.slice().sort(), ["C", "E", "F", "G"]);
  assert.deepEqual(formworks["3002"].floorNames, ["D"]);
  assert.equal(formworks["3001"].zoneKey, zoneKeyOf(zone));
});

test("deux coffrages de même N° : celui de la zone de l'étage ; sinon le premier du projet", () => {
  const syntheseRows = [
    floor(1, "Zone 1", "SS1", "3001"),
    floor(2, "Zone 2", "SS1", "3001"),
    floor(3, "Zone 3", "SS1", "3001"),
  ];
  const projectRows = [coffrage(20, "Zone 1", "3001", "Zone 1 COF"), coffrage(21, "Zone 2", "3001", "Zone 2 COF")];
  const zones = buildStructureLink({ syntheseRows, projectRows }).zones;
  assert.deepEqual(zones.map((zone) => zone.floors[0].formwork?.id), [20, 21, 20]);
});

// Review Focus 2.
test("N° écrit différemment dans les deux tables (nombre, espaces, casse) : la date est trouvée", () => {
  const projectRows = [
    coffrage(20, "Zone 1", 3021, "PH SS1"),
    coffrage(21, "Zone 1", "cof-A", "PH SS2"),
    coffrage(22, "Zone 1", "0110", "PB"),
  ];
  const planRows = [plan(" 3021 ", "Prev 0", "2025-11-27"), plan("COF-A", "Prev 0", "2025-11-28"), plan("110", "Prev 0", "2025-11-27")];
  const [zone] = buildStructureLink({ projectRows, planRows }).zones;
  assert.deepEqual(zone.formworks.map((item) => [item.number, iso(item.issueDate)]), [
    ["0110", null],
    ["3021", "2025-11-27"],
    ["cof-A", "2025-11-28"],
  ]);
});

// ---------- Plan de réservations du cycle 3 : fin au plus tard au début du plan de coffrage ----------

test("limite de fin du plan de réservations du cycle 3 : le début du plan de coffrage lié à l'étage", () => {
  const zone = "Zone 1";
  const RESA = "PLAN DE SYNTHESE RESERVATIONS NIV SS1";
  const cycle = (id, zoneName, floorName, name) => synthese(id, { Zone: zoneName, Groupe: floorName, Taches: name, Nature: "Cycle" });
  const subgroup = (id, zoneName, floorName, name, parentId) => synthese(id, {
    Zone: zoneName, Groupe: floorName, Taches: name, Nature: "Sous-groupe", Parent: String(parentId),
  });
  const inGroup = (id, zoneName, floorName, name, parentId) => floorTask(id, zoneName, floorName, name, { Parent: String(parentId) });
  const syntheseRows = [
    floor(1, zone, "SS1", "3001"),
    cycle(5, zone, "SS1", "CYCLE 2"),
    subgroup(6, zone, "SS1", "PLAN SYT CYCLE 2", 5),
    inGroup(11, zone, "SS1", RESA, 6), // cycle 2 : pas concerné
    cycle(7, zone, "SS1", "Cycle 3"),
    subgroup(8, zone, "SS1", "PLAN SYT CYCLE 3", 7),
    inGroup(12, zone, "SS1", RESA, 8), // dans le sous-groupe du cycle 3
    inGroup(13, zone, "SS1", "Plan de synthèse  réservations niv SS1", 7), // dans le cycle 3 ; casse, accents, espaces
    inGroup(14, zone, "SS1", "PLAN DE SYNTHESE RESEAUX NIV SS1", 8), // autre tâche du cycle 3
    floorTask(15, zone, "SS1", RESA), // hors cycle
    cycle(9, zone, "SS1", "CYCLE 30"),
    inGroup(16, zone, "SS1", RESA, 9), // « CYCLE 30 » n'est pas le cycle 3
    floor(2, zone, "SS2"), // étage sans lien
    cycle(20, zone, "SS2", "CYCLE 3"),
    inGroup(21, zone, "SS2", "PLAN DE SYNTHESE RESERVATIONS NIV SS2", 20),
    floor(3, zone, "SS3", "3002"), // coffrage sans date de début
    cycle(30, zone, "SS3", "CYCLE 3"),
    inGroup(31, zone, "SS3", "PLAN DE SYNTHESE RESERVATIONS NIV SS3", 30),
    floor(4, "Zone 2", "SS1", " 3003 "), // même nom d'étage, autre zone, autre coffrage
    cycle(40, "Zone 2", "SS1", "CYCLE 3"),
    inGroup(41, "Zone 2", "SS1", RESA, 40),
  ];
  // Coffrages de Structure : N°, zone et début de leur plan (colonne « Début » du planning).
  const formworkStarts = [
    { number: "3001", zoneName: zone, start: new Date(2026, 1, 19) },
    { number: "3002", zoneName: zone, start: null },
    { number: " 3003", zoneName: "Zone 9", start: new Date(2026, 2, 30) }, // même N° dans une autre zone
    { number: "3003", zoneName: "Zone 2", start: new Date(2026, 3, 1) }, // celui de la zone de l'étage : préféré
  ];
  const limits = reservationEndLimits({ syntheseRows, formworkStarts });
  assert.deepEqual(
    [...limits.entries()].map(([taskId, entry]) => [taskId, iso(entry.limit), entry.formworkNumber]),
    [[12, "2026-02-19", "3001"], [13, "2026-02-19", "3001"], [41, "2026-04-01", "3003"]]
  );
  assert.equal(reservationEndLimits().size, 0);
  assert.equal(reservationEndLimits({ syntheseRows: null, formworkStarts: null }).size, 0);
});

test("report des limites sur les lignes : la Fin ne doit pas dépasser le jour limite", () => {
  const limit = new Date(2026, 1, 19);
  const limits = new Map([11, 12, 13, 14].map((taskId) => [taskId, { limit, formworkNumber: "3001" }]));
  const taskLine = (taskId, end) => ({ key: `task:${taskId}`, kind: "task", taskId, name: "T", end });
  const lines = applyEndLimits([
    { key: "floor:zone1/ss1", kind: "floor", taskId: null, name: "SS1", end: new Date(2026, 2, 1) },
    taskLine(10, new Date(2026, 2, 1)), // tâche sans limite
    taskLine(11, new Date(2026, 1, 18)), // la veille : tenu
    taskLine(12, new Date(2026, 1, 19)), // le jour limite : encore tenu
    taskLine(13, new Date(2026, 1, 20)), // le lendemain : trop tard
    taskLine(14, null), // pas encore datée
  ], limits);
  assert.deepEqual(lines.map((line) => [line.taskId, iso(line.endLimit ?? null), line.isOverEndLimit ?? null]), [
    [null, null, null],
    [10, null, null],
    [11, "2026-02-19", false],
    [12, "2026-02-19", false],
    [13, "2026-02-19", true],
    [14, "2026-02-19", false],
  ]);
  assert.equal(
    lines[3].endLimitNote,
    "À finir au plus tard le Jeu 19/02/26 (début du plan de coffrage 3001 dans le planning Structure)."
  );
  assert.equal(
    lines[4].endLimitNote,
    "Fin trop tardive : à finir au plus tard le Jeu 19/02/26 (début du plan de coffrage 3001 dans le planning Structure)."
  );
});

test("emblème de lien des étages : lié à son coffrage, ou non lié", () => {
  const zoneKey = zoneKeyOf("Zone 1");
  const links = new Map([[`${zoneKey}/ss1`, "3021"]]);
  const floorLine = (floorKey, name) => ({ key: `floor:${zoneKey}/${floorKey}`, kind: "floor", zoneKey, floorKey, name });
  const lines = applyFloorLinks([
    { key: `zone:${zoneKey}`, kind: "zone", zoneKey, floorKey: "", name: "Zone 1" },
    floorLine("ss1", "SS1"),
    { key: "task:5", kind: "task", zoneKey, floorKey: "ss1", taskId: 5, name: "T" },
    floorLine("ss2", "SS2"),
  ], links);
  assert.deepEqual(lines.map((line) => [line.kind, line.structureLink ?? null, line.structureLinkNote ?? null]), [
    ["zone", null, null],
    ["floor", "3021", "Étage lié au coffrage 3021 de Structure."],
    ["task", null, null],
    ["floor", "", "Étage non lié à un coffrage de Structure."],
  ]);
});
