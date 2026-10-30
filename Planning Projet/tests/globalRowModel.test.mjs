// Vue Global : les lignes affichées — replis, états, remontée des alertes, « Alertes
// seulement », filtre de zone, compteurs de la barre d'état.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

// gristService lit `window.grist` au moment de l'appel seulement, mais son import
// exige que `window` existe.
globalThis.window = { location: { search: "" } };

const { buildGlobalPlanning, buildGlobalRowModel } = await import("../assets/js/services/globalPlanningModel.js");
const { TODAY, ZONE_1, planRows, projectRows } = await import("./helpers/globalRows.mjs");

const iso = (date) => (date instanceof Date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : date);
const planningOf = (rows = projectRows()) => buildGlobalPlanning({ projectRows: rows, planRows: planRows(), today: TODAY });
const model = (options = {}, rows) => buildGlobalRowModel(planningOf(rows), options);
const keys = (lines) => lines.map((line) => line.key);
const texts = (line) => (line.state ? line.state.parts.map((part) => part.text) : []);
const lineOf = (lines, key) => lines.find((line) => line.key === key);
// Chemin déplié jusqu'à la tâche contrôlée de l'étage RDC (id 420).
const RDC_PATH = ["level:113", "floor:zone2batb/rdc", "group:416", "group:419", "doc:113"];

test("par défaut : zones dépliées, niveaux, étages, coffrages et groupes de type repliés", () => {
  const { lines } = model();
  assert.deepEqual(keys(lines), [
    "zone:zone1batbc", "level:101",
    "zone:zone2batb", "level:113", "doc:111", "level:112", "floor:zone2batb/rp1", "task:600", "type:zone2batb/coupes", "doc:142",
    "zone:", "type:/ndc",
  ]);
  assert.deepEqual(lines.map((line) => line.level), [0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
  assert.deepEqual(lines.map((line) => line.collapsed), [
    false, true, false, true, true, true, true, false, true, false, false, true,
  ]);
  assert.deepEqual(lines.map((line) => line.expandable), [
    true, true, true, true, true, true, true, false, true, false, true, true,
  ]);
});

test("groupe d'un type replié : sa ligne et la barre de toute sa section ; déplié : ses documents", () => {
  const folded = lineOf(model().lines, "type:zone2batb/coupes");
  assert.deepEqual(
    [folded.kind, folded.role, folded.service, folded.name, folded.variant, folded.countLabel, folded.durationLabel, folded.state],
    ["type", "type", "structure", "COUPES", "coupes", "1 document", "", null]
  );
  assert.deepEqual([iso(folded.start), iso(folded.end)], ["2027-02-23", "2027-03-09"], "de son premier Début à sa dernière Fin");
  assert.deepEqual(folded.segments.map((segment) => [segment.kind, segment.classes, segment.label]), [
    ["phase", "phase-coupes", "COUPES"],
  ], "une seule barre, sans le démarrage des travaux");
  const { lines } = model({ toggledKeys: new Set(["type:zone2batb/coupes"]) });
  const open = lineOf(lines, "type:zone2batb/coupes");
  assert.equal("segments" in open, false, "déplié : un crochet, les barres sont sur les documents");
  const doc = lines[lines.indexOf(open) + 1];
  assert.deepEqual([doc.key, doc.level, doc.role], ["doc:131", 2, "doc"]);
  assert.deepEqual(doc.segments.map((segment) => segment.kind), ["phase", "works"]);
  // Un retard Structure dans le groupe se lit sur sa ligne, comme sur une zone.
  assert.deepEqual(texts(lineOf(model({}, projectRows().map((row) => (row.id === 141 ? { ...row, Realise: 0, Date_limite: "2026-09-01", Duree_1: 2, Diff_coffrage: "2026-09-15" } : row))).lines, "type:/ndc")), [
    "1 retard Structure",
  ]);
});

test("compteurs de la barre d'état", () => {
  assert.deepEqual(model().totals, { linkedFloors: 3, unlinkedFloors: 1, synthese: 1, missing: 0, stale: 1, structure: 2 });
  assert.deepEqual(buildGlobalRowModel({ zones: [] }).totals, {
    linkedFloors: 0, unlinkedFloors: 0, synthese: 0, missing: 0, stale: 0, structure: 0,
  });
  assert.deepEqual(buildGlobalRowModel(null).lines, []);
});

test("niveau déplié : l'étage de Synthèse puis le coffrage, repliés tous les deux", () => {
  const { lines } = model({ toggledKeys: new Set(["level:113"]) });
  const at = keys(lines).indexOf("level:113");
  assert.deepEqual(keys(lines).slice(at, at + 4), ["level:113", "floor:zone2batb/rdc", "doc:113", "doc:111"]);
  const level = lines[at];
  assert.deepEqual([level.kind, level.role, level.service, level.name, level.collapsed], [
    "level", "level", "", "RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF", false,
  ]);
  assert.deepEqual([iso(level.start), iso(level.end), level.durationLabel], ["2026-01-02", "2026-11-30", ""]);
  const floor = lines[at + 1];
  assert.deepEqual([floor.kind, floor.role, floor.service, floor.level, floor.name, floor.durationLabel, floor.collapsed], [
    "floor", "floor", "synthese", 2, "Synthèse · RDC", "230 jours", true,
  ]);
  const formwork = lines[at + 2];
  assert.deepEqual(
    [formwork.kind, formwork.role, formwork.service, formwork.level, formwork.name, formwork.id2, formwork.indice],
    ["doc", "formwork", "structure", 2, "PH REZ DE CHAUSSEE - COF", "3032", "A"]
  );
  assert.deepEqual(
    [formwork.durationLabel, iso(formwork.start), iso(formwork.end), formwork.variant, formwork.countLabel, formwork.childCount],
    ["2 sem.", "2026-08-19", "2026-09-02", "coffrage", "1 armature", 1]
  );
});

test("coffrage déplié : ses armatures, avec les barres du planning Structure", () => {
  const { lines } = model({ toggledKeys: new Set(["level:113", "doc:113"]) });
  const rebar = lineOf(lines, "doc:123");
  assert.deepEqual([rebar.role, rebar.level, rebar.name, rebar.id2, rebar.variant, rebar.expandable], [
    "rebar", 3, "PH REZ DE CHAUSSEE - DALLES", "3314", "armature", false,
  ]);
  assert.deepEqual(rebar.segments.map((segment) => [segment.kind, segment.label]), [["phase", "Armature"], ["works", ""]]);
  assert.equal("marker" in rebar, false, "le démarrage des travaux est une de ses barres");
  assert.deepEqual(lineOf(lines, "floor:zone2batb/rdc").segments, undefined, "lignes de Synthèse : sans barres Structure");
  assert.deepEqual(texts(rebar), ["retard 23 j"]);
  assert.deepEqual(texts(lineOf(lines, "doc:113")), ["retard 37 j", "1 armature en retard"]);
  const { lines: zoneLevel } = model({ toggledKeys: new Set(["doc:111"]) });
  assert.deepEqual([lineOf(zoneLevel, "doc:121").level, lineOf(zoneLevel, "doc:111").level], [2, 1], "coffrage sans étage");
});

// La coupe des barres à l'heure actuelle dépend de l'horloge : arrêtée au 09/10/26 à 10 h.
function atNow(run) {
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 9, 10, 0, 0) });
  try {
    return run();
  } finally {
    mock.timers.reset();
  }
}
const brief = (segments) => segments.map((segment) => [segment.kind, segment.label, iso(segment.start), iso(segment.end)]);

test("coffrage replié avec armatures : une seule barre pour toute la section ; déplié : le détail", () => {
  const planning = atNow(() => planningOf());
  const folded = lineOf(buildGlobalRowModel(planning).lines, "doc:111");
  assert.deepEqual(brief(folded.segments), [
    ["phase", "", "2026-10-05", "2026-10-09"],
    ["phase", "Coffrage", "2026-10-09", "2026-11-02"],
  ], "du coffrage 3012 à la fin de son armature 3306");
  const { lines } = buildGlobalRowModel(planning, { toggledKeys: new Set(["doc:111"]) });
  assert.deepEqual(brief(lineOf(lines, "doc:111").segments), [
    ["phase", "", "2026-10-05", "2026-10-09"],
    ["phase", "Coffrage", "2026-10-09", "2026-10-19"],
  ], "déplié : ses propres barres");
  assert.deepEqual(brief(lineOf(lines, "doc:121").segments), [
    ["phase", "Armature", "2026-10-19", "2026-11-02"],
    ["works", "", "2026-11-30", "2026-12-01"],
  ], "et celles de son armature, comme dans le planning Structure");
});

test("« Alertes seulement » : coffrage dont les armatures n'apparaissent pas → barre de la section", () => {
  // Armature 3314 réalisée (indice A) : plus d'alerte, elle disparaît sous son coffrage en retard.
  const rows = projectRows().map((row) => (row.id === 123 ? { ...row, Indice: "A", Realise: 100 } : row));
  const planning = atNow(() => planningOf(rows));
  const { lines } = buildGlobalRowModel(planning, { alertsOnly: true });
  const formwork = lineOf(lines, "doc:113");
  assert.equal(lineOf(lines, "doc:123"), undefined);
  assert.deepEqual(brief(formwork.segments), [["phase", "Coffrage", "2026-08-19", "2026-09-16"]]);
  const alerted = buildGlobalRowModel(atNow(() => planningOf()), { alertsOnly: true }).lines;
  assert.ok(lineOf(alerted, "doc:123"), "armature en alerte : le détail");
  assert.deepEqual(brief(lineOf(alerted, "doc:113").segments), [["phase", "Coffrage", "2026-08-19", "2026-09-02"]]);
});

test("étage déplié : le contenu de la vue Synthese, un cran sous l'étage", () => {
  const { lines } = model({ toggledKeys: new Set(RDC_PATH) });
  const levels = Object.fromEntries(lines.map((line) => [line.key, line.level]));
  assert.deepEqual(
    [levels["floor:zone2batb/rdc"], levels["task:401"], levels["group:416"], levels["task:417"], levels["group:419"], levels["task:420"]],
    [2, 3, 3, 4, 4, 5]
  );
  assert.equal(lineOf(lines, "group:402").collapsed, true, "cycle 1 non basculé : replié");
  assert.equal(lineOf(lines, "task:403"), undefined);
  const task = lineOf(lines, "task:420");
  assert.deepEqual([task.kind, task.role, task.service, task.taskId, task.durationLabel], ["task", "task", "synthese", 420, "198 jours"]);
  assert.equal(task.link.predId, 417, "le lien de la tâche suit, pour les flèches du Gantt");
  assert.deepEqual([lineOf(lines, "group:416").nature, lineOf(lines, "task:425").nature], ["cycle", "demarrage"]);
});

test("tâche contrôlée en retard : Fin en rouge, limite de fin, alerte remontée jusqu'à la zone", () => {
  const { lines } = model({ toggledKeys: new Set(RDC_PATH) });
  const task = lineOf(lines, "task:420");
  assert.deepEqual(task.state.parts, [{ text: "retard 103 j", tone: "late" }]);
  assert.match(task.state.title, /à finir au plus tard le Mer 19\/08\/26 \(début du plan de coffrage 3032/);
  assert.deepEqual([task.lateEnd, task.isOverEndLimit, iso(task.endLimit), task.tone], [true, true, "2026-08-19", "late"]);
  assert.equal(lineOf(lines, "task:421").lateEnd, false);
  for (const key of ["group:419", "group:416", "floor:zone2batb/rdc"]) {
    assert.deepEqual(lineOf(lines, key).state.parts, [{ text: "1 retard Synthèse", tone: "late" }], key);
    assert.equal(lineOf(lines, key).tone, "late", key);
  }
  const level = lineOf(lines, "level:113");
  assert.deepEqual(texts(level), ["Synthèse en retard de 103 j", "2 retards Structure"]);
  assert.equal(level.tone, "late");
  assert.match(level.state.title, /Non vérifiable : le coffrage 3032 n'a pas de date 0 Prev\./);
  const zone = lineOf(lines, "zone:zone2batb");
  assert.deepEqual(texts(zone), ["1 retard Synthèse", "2 retards Structure"]);
  assert.equal(zone.tone, "", "la barre de zone reste noire");
});

test("états sans retard : cohérent, à mettre à jour, non lié, terminé, rien", () => {
  const { lines } = model({ toggledKeys: new Set(["level:101", "type:/ndc"]) });
  assert.deepEqual(lineOf(lines, "level:112").state.parts, [{ text: "✓ cohérent", tone: "ok" }]);
  assert.deepEqual(texts(lineOf(lines, "level:101")), ["à mettre à jour"]);
  assert.deepEqual(texts(lineOf(lines, "floor:zone1batbc/ss1")), ["à mettre à jour : 0 Prev le Jeu 27/11/25"]);
  assert.deepEqual(texts(lineOf(lines, "zone:zone1batbc")), ["1 à mettre à jour"]);
  assert.deepEqual(lineOf(lines, "floor:zone2batb/rp1").state.parts, [{ text: "non lié à un coffrage", tone: "muted" }]);
  assert.deepEqual(texts(lineOf(lines, "doc:142")), ["terminé (retard 8 j)"]);
  assert.deepEqual(texts(lineOf(lines, "doc:141")), ["terminé"]);
  assert.equal(lineOf(lines, "doc:111").state, null);
  assert.equal(lineOf(lines, "task:600").state, null);
  assert.equal(lineOf(lines, "zone:").state, null);
  assert.equal(lineOf(lines, "type:/ndc").state, null, "document terminé : pas d’alerte dans le groupe");
  assert.equal(lineOf(lines, "level:112").tone, "");
});

test("zone repliée par l'utilisateur : plus que sa ligne", () => {
  const { lines } = model({ toggledKeys: new Set(["zone:zone2batb"]) });
  assert.deepEqual(keys(lines), ["zone:zone1batbc", "level:101", "zone:zone2batb", "zone:", "type:/ndc"]);
  assert.equal(lineOf(lines, "zone:zone2batb").collapsed, true);
});

test("« Alertes seulement » : les lignes en alerte et leurs parentes, dépliées", () => {
  const { lines, totals } = model({ alertsOnly: true });
  assert.deepEqual(keys(lines), [
    "zone:zone1batbc", "level:101", "floor:zone1batbc/ss1",
    "zone:zone2batb", "level:113", "floor:zone2batb/rdc", "group:416", "group:419", "task:420", "doc:113", "doc:123",
  ]);
  assert.equal(lines.some((line) => line.collapsed), false);
  const floor = lineOf(lines, "floor:zone1batbc/ss1");
  assert.deepEqual([floor.expandable, floor.collapsed], [false, false], "son seul souci est le sien : rien dessous");
  ["level:101", "floor:zone2batb/rdc", "doc:113"].forEach((key) => assert.equal(lineOf(lines, key).expandable, true, key));
  assert.equal(totals.structure, 2, "les compteurs restent ceux du projet");
  const folded = model({ alertsOnly: true, toggledKeys: new Set(["level:113"]) }).lines;
  assert.equal(lineOf(folded, "level:113").collapsed, true, "un appui replie");
  assert.equal(lineOf(folded, "task:420"), undefined);
});

test("filtre de zone : une seule section, compteurs de cette zone", () => {
  const { lines, totals } = model({ zoneFilter: ZONE_1 });
  assert.deepEqual(keys(lines), ["zone:zone1batbc", "level:101"]);
  assert.deepEqual(totals, { linkedFloors: 1, unlinkedFloors: 0, synthese: 0, missing: 0, stale: 1, structure: 0 });
  assert.deepEqual(model({ zoneFilter: "Zone inconnue" }).lines, []);
});

// L'armature 3314 avance son démarrage des travaux au 25/02/26 : le jalon « DEMARRAGE GO RDC »
// (09/03/26) tombe 12 jours après.
test("démarrage du gros œuvre après le démarrage des travaux : seconde alerte de retard", () => {
  const rows = projectRows().map((row) => (row.id === 123 ? { ...row, Demarrages_travaux: "2026-02-25" } : row));
  const { lines, totals } = model({ toggledKeys: new Set(RDC_PATH) }, rows);
  const kickoff = lineOf(lines, "task:425");
  assert.deepEqual(kickoff.state.parts, [{ text: "retard 12 j", tone: "late" }]);
  assert.equal(kickoff.state.title, "Démarrage prévu après le démarrage des travaux de Structure (Mer 25/02/26).");
  assert.deepEqual([kickoff.lateEnd, kickoff.tone], [true, "late"]);
  assert.deepEqual(texts(lineOf(lines, "group:416")), ["2 retards Synthèse"]);
  assert.deepEqual(texts(lineOf(lines, "level:113")), ["Synthèse en retard de 103 j", "2 retards Structure"]);
  assert.equal(totals.synthese, 2);
});

test("étage lié à un coffrage d'une autre zone, étage au coffrage introuvable", () => {
  const other = projectRows().map((row) => (row.id === 500 ? { ...row, Lien_Structure: "3031" } : row));
  const otherModel = model({}, other);
  assert.deepEqual(texts(lineOf(otherModel.lines, "floor:zone2batb/rp1")), ["lié au coffrage 3031 (Zone 1 / BAT BC)"]);
  assert.deepEqual([otherModel.totals.linkedFloors, otherModel.totals.unlinkedFloors], [4, 0]);

  const missing = projectRows().map((row) => (row.id === 400 ? { ...row, Lien_Structure: "3099" } : row));
  const missingModel = model({}, missing);
  assert.deepEqual(lineOf(missingModel.lines, "floor:zone2batb/rdc").state.parts, [
    { text: "coffrage 3099 introuvable", tone: "error" },
  ]);
  assert.deepEqual(texts(lineOf(missingModel.lines, "zone:zone2batb")), ["1 coffrage introuvable", "2 retards Structure"]);
  assert.deepEqual(missingModel.totals, { linkedFloors: 2, unlinkedFloors: 1, synthese: 0, missing: 1, stale: 1, structure: 2 });
});

test("récapitulatif d'une zone : de la première à la dernière date de son contenu", () => {
  const { lines } = model();
  const zone = lineOf(lines, "zone:zone2batb");
  assert.deepEqual([iso(zone.start), iso(zone.end), zone.durationLabel], ["2025-12-01", "2027-03-09", ""]);
  const empty = lineOf(lines, "zone:");
  assert.deepEqual([empty.start, empty.end, empty.name], [null, null, "Sans zone"]);
});

// Ordre libre de la vue Synthese (colonne Ordre) : même modèle d'étage, même ordre dans la vue
// Global. PLAN SYT CYCLE 3 de RDC (419) : RÉSEAUX 420, RÉSERVATIONS 421, TERMINAUX 422, rangés à
// l'envers.
test("ordre libre de la vue Synthese : la vue Global le reprend", () => {
  const ranks = { 420: "3", 421: "2", 422: "1" };
  const rows = projectRows().map((row) => (row.id in ranks ? { ...row, Ordre: ranks[row.id] } : row));
  const { lines } = model({ toggledKeys: new Set(RDC_PATH) }, rows);
  const at = keys(lines).indexOf("group:419");
  assert.deepEqual(keys(lines).slice(at + 1, at + 4), ["task:422", "task:421", "task:420"]);
});
