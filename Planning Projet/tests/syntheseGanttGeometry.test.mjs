import test from "node:test";
import assert from "node:assert/strict";

import {
  DAY_MS,
  buildGanttLinks,
  buildGanttShapes,
  buildNonWorkingBands,
  createTimeScale,
  dayCenter,
  dayEnd,
  dayStart,
  todayX,
} from "../assets/js/services/syntheseGanttGeometry.js";

const day = (year, month, date) => new Date(year, month - 1, date);
// Semaine du lun 14/09/2026 au lun 21/09/2026 sur 700 px : 100 px par jour.
const WEEK = createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 700 });

function line(fields = {}) {
  return {
    key: "task:0",
    kind: "task",
    name: "T",
    start: null,
    end: null,
    durationDays: null,
    isMilestone: false,
    startsWithMilestone: false,
    endsWithMilestone: false,
    collapsed: false,
    childCount: 0,
    ...fields,
  };
}

test("échelle linéaire date ↔ pixel", () => {
  assert.equal(WEEK.pxPerDay, 100);
  assert.equal(WEEK.dateToX(day(2026, 9, 14)), 0);
  assert.equal(WEEK.dateToX(day(2026, 9, 16)), 200);
  assert.equal(WEEK.xToDate(350).getTime(), day(2026, 9, 17).getTime() + DAY_MS / 2);
});

test("bornes d'une journée", () => {
  assert.equal(dayStart(new Date(2026, 8, 15, 14, 30)), day(2026, 9, 15).getTime());
  assert.equal(dayEnd(day(2026, 9, 15)), day(2026, 9, 16).getTime());
  assert.equal(dayCenter(day(2026, 9, 15)), day(2026, 9, 15).getTime() + DAY_MS / 2);
});

test("segment d'un jour = une journée, segment de plusieurs jours, largeur minimale", () => {
  const [one, three] = buildGanttShapes([
    line({ key: "task:1", name: "Un jour", start: day(2026, 9, 15), end: day(2026, 9, 15), durationDays: 1 }),
    line({ key: "task:2", name: "Trois jours", start: day(2026, 9, 15), end: day(2026, 9, 17), durationDays: 3 }),
  ], WEEK, { rowHeight: 26 });
  assert.deepEqual([one.type, one.x1, one.x2, one.y, one.row, one.label], ["taskBar", 100, 200, 0, 0, "Un jour"]);
  assert.deepEqual([three.x1, three.x2, three.y, three.row], [100, 400, 26, 1]);
  const decade = createTimeScale({ start: day(2026, 1, 1), end: day(2036, 1, 1), width: 700 });
  const [bar] = buildGanttShapes([line({ start: day(2026, 9, 15), end: day(2026, 9, 15), durationDays: 1 })], decade);
  assert.ok(bar.x2 - bar.x1 >= 2);
});

test("jalon au centre du jour avec nom et date jj/mm", () => {
  const [shape] = buildGanttShapes([
    line({ key: "task:3", name: "Réunion", start: day(2026, 9, 16), end: day(2026, 9, 16), durationDays: 0, isMilestone: true }),
  ], WEEK);
  assert.deepEqual([shape.type, shape.x, shape.label, shape.dateLabel], ["milestone", 250, "Réunion", "16/09"]);
});

test("barre de zone : bornes normales, ou centre du jalon au début et à la fin", () => {
  const zone = (fields) => line({
    kind: "zone",
    key: "zone:z",
    name: "Zone Z3A",
    start: day(2026, 9, 14),
    end: day(2026, 9, 18),
    durationDays: 5,
    ...fields,
  });
  const [plain] = buildGanttShapes([zone({})], WEEK);
  assert.deepEqual([plain.type, plain.x1, plain.x2, plain.label], ["zoneBar", 0, 500, "Zone Z3A"]);
  const [anchored] = buildGanttShapes([zone({ startsWithMilestone: true, endsWithMilestone: true })], WEEK);
  assert.deepEqual([anchored.x1, anchored.x2], [50, 450]);
});

// Review Focus 5.
test("zone repliée : sa barre reste sur sa ligne", () => {
  const shapes = buildGanttShapes([
    line({ kind: "zone", key: "zone:a", name: "Zone A", start: day(2026, 9, 14), end: day(2026, 9, 15), durationDays: 2, collapsed: true, childCount: 3 }),
    line({ kind: "zone", key: "zone:b", name: "Zone B", start: day(2026, 9, 16), end: day(2026, 9, 16), durationDays: 1 }),
  ], WEEK);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.row, shape.x1, shape.x2]), [
    ["zoneBar", 0, 0, 200],
    ["zoneBar", 1, 200, 300],
  ]);
});

test("lignes sans dates ignorées, rang conservé", () => {
  const shapes = buildGanttShapes([
    line({ key: "zone:vide", kind: "zone", name: "Vide" }),
    line({ key: "task:9", name: "Daté", start: day(2026, 9, 15), end: day(2026, 9, 15), durationDays: 1 }),
  ], WEEK);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].row, 1);
  assert.equal(shapes[0].y, 26);
});

test("jours non travaillés : week-end et férié, rien sous 6 px par jour", () => {
  assert.deepEqual(buildNonWorkingBands(WEEK).map((band) => [band.x1, band.x2, band.holiday]), [
    [500, 600, false],
    [600, 700, false],
  ]);
  const armistice = createTimeScale({ start: day(2026, 11, 9), end: day(2026, 11, 16), width: 700 });
  assert.deepEqual(buildNonWorkingBands(armistice).map((band) => [band.x1, band.holiday]), [
    [200, true],
    [500, false],
    [600, false],
  ]);
  const year = createTimeScale({ start: day(2026, 1, 1), end: day(2027, 1, 1), width: 700 });
  assert.deepEqual(buildNonWorkingBands(year), []);
});

// Review Focus 1 : les bandes suivent les minuits locaux, même un jour de 25 h.
test("changement d'heure : chaque journée va d'un minuit local au suivant", () => {
  const scale = createTimeScale({ start: day(2026, 10, 19), end: day(2026, 10, 26), width: 700 });
  const sunday = buildNonWorkingBands(scale).at(-1);
  assert.equal(sunday.x1, scale.dateToX(day(2026, 10, 25)));
  assert.equal(sunday.x2, scale.dateToX(day(2026, 10, 26)));
  const [bar] = buildGanttShapes([line({ start: day(2026, 10, 23), end: day(2026, 10, 23), durationDays: 1 })], scale);
  assert.equal(bar.x1, scale.dateToX(day(2026, 10, 23)));
  assert.equal(bar.x2, scale.dateToX(day(2026, 10, 24)));
});

// Review Focus 2.
test("panneau de largeur nulle : aucune coordonnée invalide", () => {
  const empty = createTimeScale({ start: day(2026, 9, 14), end: day(2026, 9, 21), width: 0 });
  assert.equal(empty.pxPerDay, 0);
  const shapes = buildGanttShapes([line({ start: day(2026, 9, 15), end: day(2026, 9, 16), durationDays: 2 })], empty);
  assert.ok(shapes.every((shape) => [shape.x1, shape.x2].every(Number.isFinite)));
  assert.ok(Number.isFinite(empty.xToDate(10).getTime()));
  assert.deepEqual(buildNonWorkingBands(empty), []);
});

test("aujourd'hui dans ou hors période", () => {
  assert.equal(todayX(WEEK, new Date(2026, 8, 16, 12)), 250);
  assert.equal(todayX(WEEK, new Date(2026, 8, 30)), null);
});

test("étage : crochet du Début à la Fin, mêmes règles de jalon que la zone", () => {
  const shapes = buildGanttShapes([
    line({ kind: "floor", key: "floor:z/f", name: "PH RDB", start: day(2026, 9, 14), end: day(2026, 9, 16), durationDays: 3 }),
    line({
      kind: "floor",
      key: "floor:z/g",
      name: "PH RDH",
      start: day(2026, 9, 15),
      end: day(2026, 9, 17),
      startsWithMilestone: true,
      endsWithMilestone: true,
    }),
    line({ kind: "floor", key: "floor:z/h", name: "Vide" }),
  ], WEEK);
  assert.deepEqual(shapes.map((shape) => [shape.type, shape.row, shape.x1, shape.x2, shape.label]), [
    ["floorBracket", 0, 0, 300, "PH RDB"],
    ["floorBracket", 1, 150, 350, "PH RDH"],
  ]);
});

const groupTask = (id, start, end, fields = {}) => line({
  key: `task:${id}`,
  taskId: id,
  zoneKey: "z",
  floorKey: "f",
  start,
  end,
  durationDays: 1,
  ...fields,
});

test("flèches : vers la tâche datée juste en dessous, du même groupe seulement", () => {
  const links = buildGanttLinks([
    line({ kind: "floor", key: "floor:z/f", zoneKey: "z", floorKey: "f", start: day(2026, 9, 14), end: day(2026, 9, 18) }),
    groupTask(1, day(2026, 9, 14), day(2026, 9, 15)),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16)),
    groupTask(3, null, null),
    groupTask(4, day(2026, 9, 17), day(2026, 9, 17)),
    groupTask(5, day(2026, 9, 18), day(2026, 9, 18), { floorKey: "g" }),
    groupTask(6, day(2026, 9, 18), day(2026, 9, 18), { floorKey: "" }),
    line({ kind: "floor", key: "floor:z/g", zoneKey: "z", floorKey: "g", start: day(2026, 9, 18), end: day(2026, 9, 18) }),
    groupTask(7, day(2026, 9, 18), day(2026, 9, 18), { floorKey: "" }),
  ], WEEK);
  assert.deepEqual(links.map((link) => [link.fromRow, link.toRow]), [[1, 2]]);
});

// Convention MS Project : la flèche part du bout de la barre à mi-hauteur, va à droite jusqu'au
// début de la suivante et descend dans son coin haut gauche. Barres jointives : elle entre 5 px
// dans la suivante, pour ne pas longer les bords.
test("barres jointives : la flèche entre 5 px dans le haut de la suivante", () => {
  const [link] = buildGanttLinks([
    groupTask(1, day(2026, 9, 14), day(2026, 9, 15)),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16)),
  ], WEEK);
  assert.deepEqual(link.points, [[200, 13], [205, 13], [205, 32]]);
  assert.deepEqual(link.head, { x: 205, y: 32, direction: "down" });
});

test("détour en S quand la suivante commence avant la fin de la précédente : par l'interligne", () => {
  const [link] = buildGanttLinks([
    groupTask(1, day(2026, 9, 14), day(2026, 9, 16)),
    groupTask(2, day(2026, 9, 15), day(2026, 9, 17)),
  ], WEEK);
  assert.deepEqual(link.points, [[300, 13], [305, 13], [305, 26], [95, 26], [95, 39], [100, 39]]);
  assert.deepEqual(link.head, { x: 100, y: 39, direction: "right" });
});

test("jalons : de la pointe droite du losange à droite puis vers le bas ; arrivée sur son sommet", () => {
  const [fromMilestone] = buildGanttLinks([
    groupTask(1, day(2026, 9, 15), day(2026, 9, 15), { isMilestone: true, durationDays: 0 }),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16)),
  ], WEEK);
  assert.deepEqual(fromMilestone.points, [[156, 13], [200, 13], [200, 32]]);
  assert.deepEqual(fromMilestone.head, { x: 200, y: 32, direction: "down" });
  const [toMilestone] = buildGanttLinks([
    groupTask(1, day(2026, 9, 14), day(2026, 9, 14)),
    groupTask(2, day(2026, 9, 16), day(2026, 9, 16), { isMilestone: true, durationDays: 0 }),
  ], WEEK);
  assert.deepEqual(toMilestone.points, [[100, 13], [250, 13], [250, 33]]);
  assert.deepEqual(toMilestone.head, { x: 250, y: 33, direction: "down" });
});
