// Gantt de la vue Global : les ajouts au Gantt de la vue Synthese — barres d'un document
// Structure reprises du planning Structure (mêmes segments, mêmes couleurs), crochet de niveau,
// formes en alerte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SEGMENT_INSET_PX,
  buildGanttLinks,
  buildGanttShapes,
  createTimeScale,
} from "../assets/js/services/syntheseGanttGeometry.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const source = await readFile(new URL("../assets/js/ui/syntheseGantt.js", import.meta.url), "utf8");

// Semaine du lundi 14/09/26 sur 700 px : 100 px par jour, le 14 à x = 0.
const scale = createTimeScale({ start: new Date(2026, 8, 14), end: new Date(2026, 8, 21), width: 700 });
const day = (date, hours = 0) => new Date(2026, 8, date, hours);
const segment = (kind, classes, label, start, end, paint = null) => ({ kind, classes, label, start, end, paint });
const doc = (key, fields = {}) => ({
  key, kind: "doc", role: "doc", name: "PH RDC - COF", start: null, end: null, isMilestone: false, variant: "coffrage", segments: [], ...fields,
});

test("document Structure : ses barres du planning Structure, à leur heure exacte, son nom après la dernière", () => {
  const paint = { realise: 40, done: "#fef3c7", late: "#d99b9b", border: "#fde68a", text: "#92400e" };
  const [shape, ...rest] = buildGanttShapes([doc("doc:1", {
    start: day(15),
    end: day(16),
    segments: [
      segment("phase", "phase-coffrage phase-past", "", day(15), day(15, 12)),
      segment("phase", "phase-coffrage", "Coffrage", day(15, 12), day(16), paint),
      segment("reference", "phase-reference-reception phase-reference-reception--missing", "Données d'entrées", day(14), day(15)),
      segment("works", "phase-demarrage", "", day(18), day(19)),
    ],
  })], scale);
  assert.deepEqual(rest, []);
  assert.deepEqual(shape, {
    type: "segments",
    row: 0,
    key: "doc:1",
    y: 0,
    label: "PH RDC - COF",
    labelX: 500,
    pieces: [
      { kind: "phase", classes: "phase-coffrage phase-past", label: "", paint: null, x1: 100, x2: 150 },
      { kind: "phase", classes: "phase-coffrage", label: "Coffrage", paint, x1: 150, x2: 200 },
      { kind: "reference", classes: "phase-reference-reception phase-reference-reception--missing", label: "Données d'entrées", paint: null, x1: 0, x2: 100 },
      { kind: "works", classes: "phase-demarrage", label: "", paint: null, x1: 400, x2: 500 },
    ],
  });
});

test("barre très courte : largeur minimale ; document sans barre : rien, même avec des dates", () => {
  const [shape] = buildGanttShapes([doc("doc:1", { segments: [segment("phase", "phase-ndc", "NDC", day(15), day(15))] })], scale);
  assert.deepEqual([shape.pieces[0].x1, shape.pieces[0].x2], [100, 102]);
  assert.deepEqual(buildGanttShapes([doc("doc:2", { start: day(15), end: day(16), segments: [] })], scale), []);
});

test("hauteur des barres : celle du planning Structure, 4 px de marge en haut et en bas", () => {
  assert.equal(SEGMENT_INSET_PX, 4);
});

test("pas de flèche entre documents Structure", () => {
  const lines = [
    doc("doc:1", { start: day(15), end: day(15), segments: [segment("phase", "phase-coffrage", "Coffrage", day(15), day(16))] }),
    doc("doc:2", { start: day(16), end: day(17), segments: [segment("phase", "phase-armature", "Armature", day(16), day(18))] }),
  ];
  assert.deepEqual(buildGanttLinks(lines, scale), []);
});

test("niveau lié : un crochet, de la première à la dernière date de son contenu", () => {
  const [bracket] = buildGanttShapes([
    { key: "level:113", kind: "level", name: "RDC ⇄ 3032", start: day(15), end: day(17) },
  ], scale);
  assert.deepEqual(bracket, { type: "floorBracket", row: 0, key: "level:113", y: 0, x1: 100, x2: 400, label: "RDC ⇄ 3032" });
});

test("groupe d'un type : replié, la barre de sa section ; déplié, un crochet sur ses documents", () => {
  const typeLine = (fields) => ({ key: "type:z/demolition", kind: "type", name: "DÉMOLITION", start: day(15), end: day(17), ...fields });
  const [bar] = buildGanttShapes([typeLine({ segments: [segment("phase", "phase-demolition", "DÉMOLITION", day(15), day(18))] })], scale);
  assert.deepEqual([bar.type, bar.pieces.length, bar.pieces[0].x1], ["segments", 1, 100]);
  assert.equal(bar.label, "", "le nom du type est déjà dans sa barre : pas de nom répété après elle");
  const [bracket] = buildGanttShapes([typeLine({})], scale);
  assert.deepEqual(bracket, { type: "floorBracket", row: 0, key: "type:z/demolition", y: 0, x1: 100, x2: 400, label: "DÉMOLITION" });
});

test("en alerte : crochets du niveau, de l'étage et du cycle en rouge ; la barre de zone reste noire", () => {
  const summary = (kind) => ({ key: `${kind}:1`, kind, name: kind, start: day(15), end: day(17), tone: "late" });
  const shapes = buildGanttShapes(["level", "floor", "group", "zone"].map(summary), scale);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.tone ?? null]), [
    ["floorBracket", "late"], ["floorBracket", "late"], ["floorBracket", "late"], ["zoneBar", null],
  ]);
});

test("tâche en retard sans limite de fin (jalon de démarrage) : dessinée en alerte ; un document garde ses couleurs", () => {
  const task = (fields) => ({ key: "task:1", kind: "task", taskId: 1, name: "DEMARRAGE GO", start: day(16), end: day(16), isMilestone: true, link: null, ...fields });
  assert.equal(buildGanttShapes([task({ tone: "late" })], scale)[0].overLimit, true);
  assert.equal("overLimit" in buildGanttShapes([task({})], scale)[0], false);
  const [late] = buildGanttShapes([doc("doc:1", { tone: "late", segments: [segment("phase", "phase-coffrage", "Coffrage", day(15), day(16))] })], scale);
  assert.equal("overLimit" in late, false);
});

test("vue Synthese inchangée : ni barres Structure, ni ton, ni repère sur ses lignes", () => {
  const shapes = buildGanttShapes([
    { key: "floor:z/f", kind: "floor", name: "SS1", start: day(15), end: day(17) },
    { key: "task:1", kind: "task", taskId: 1, name: "Visa", start: day(15), end: day(16), isMilestone: false, link: null },
  ], scale);
  assert.deepEqual(shapes.map((shape) => Object.keys(shape).sort().join(",")), [
    "key,label,row,type,x1,x2,y",
    "key,label,row,type,x1,x2,y",
  ]);
});

test("dessin : une barre par segment, aux couleurs de ses classes ou de son retard, libellé coupé à la barre", () => {
  assert.match(source, /shape\.type === "segments"/);
  assert.match(source, /class: `stg-seg \$\{piece\.classes\}`/);
  // Retard : part réalisée à sa couleur, le reste à la couleur de retard, bord de retard.
  assert.match(source, /piece\.paint\.done/);
  assert.match(source, /piece\.paint\.late/);
  assert.match(source, /piece\.paint\.border/);
  assert.match(source, /piece\.paint\.realise/);
  // Libellé dans une fenêtre de la taille de la barre, qui le coupe comme le planning Structure.
  assert.match(source, /svgElement\("svg", \{/);
  assert.match(source, /x: px\(shape\.labelX \+ LABEL_GAP_PX\)/);
  assert.match(source, /\.\.\.\(shape\.label \? \[svgElement\("text", \{ class: "stg-label"/, "pas de texte vide");
  assert.equal(/stg-marker|MARKER_HALF_PX|stg-task--/.test(source), false, "plus de barre unique ni de triangle");
  assert.match(source, /class: shape\.tone === "late" \? "stg-floor is-late" : "stg-floor",/);
});

// Règles de couleur du planning Structure (`#planningTimeline .vis-item.phase-…`) et leurs
// jumelles du Gantt (`.stg-seg.phase-…`) : fond → --seg-bg, bord → --seg-border, texte → --seg-text.
function declarations(body) {
  return Object.fromEntries(body.split(";").map((part) => part.split(":")).filter((pair) => pair.length === 2)
    .map(([name, value]) => [name.trim(), value.replace("!important", "").trim().toLowerCase()]));
}

function rulesOf(prefix) {
  const pattern = new RegExp(`^${prefix.replace(/[.#]/g, "\\$&")}((?:\\.phase-[a-z-]+)+) \\{([^}]*)\\}`, "gm");
  return new Map([...css.matchAll(pattern)].map((match) => [match[1], declarations(match[2])]));
}

test("couleurs : chaque règle de barre du planning Structure a sa jumelle dans le Gantt, aux mêmes couleurs", () => {
  const structure = rulesOf("#planningTimeline .vis-item");
  const gantt = rulesOf(".stg-seg");
  assert.ok(structure.size >= 24, `règles Structure lues : ${structure.size}`);
  structure.forEach((rule, classes) => {
    const twin = gantt.get(classes);
    assert.ok(twin, `jumelle manquante : .stg-seg${classes}`);
    const expected = {};
    if (rule["background-color"]) expected["--seg-bg"] = rule["background-color"];
    if (rule["border-color"]) expected["--seg-border"] = rule["border-color"];
    if (rule.color) expected["--seg-text"] = rule.color;
    const actual = Object.fromEntries(Object.keys(expected).map((name) => [name, twin[name]]));
    assert.deepEqual(actual, expected, classes);
  });
  assert.deepEqual([...gantt.keys()].filter((classes) => !structure.has(classes)), [], "aucune couleur inventée");
});

test("couleurs : barre et libellé lisent les couleurs de leurs classes ; crochet rouge", () => {
  assert.match(css, /\.stg-seg-box\s*\{[^}]*fill:\s*var\(--seg-bg\);[^}]*stroke:\s*var\(--seg-border\);/);
  assert.match(css, /\.stg-seg-text\s*\{[^}]*fill:\s*var\(--seg-text\);/);
  assert.equal(/\.stg-task--|\.stg-marker/.test(css), false);
  assert.match(css, /\.stg-floor\.is-late\s*\{[^}]*stroke:\s*#c00000;/);
});
