import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildGanttLinks, buildGanttShapes, createTimeScale } from "../assets/js/services/syntheseGanttGeometry.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

// Janvier 2026 sur 310 px : 10 px par jour, le 1er janvier à x = 0.
const scale = createTimeScale({ start: new Date(2026, 0, 1), end: new Date(2026, 1, 1), width: 310 });
const day = (date) => new Date(2026, 0, date);
const task = (taskId, start, end, extra = {}) => ({
  kind: "task", taskId, zoneKey: "z", floorKey: "f", groupRowId: 9, start, end, isMilestone: false, link: null, ...extra,
});
const rows = (links) => links.map((link) => [link.fromRow, link.toRow]);
const FD = (predId, lag = 0) => ({ predId, type: "FD", lag });

// Convention MS Project (capture de l'utilisateur) : RECEPTION RENDU → VISA et → PLAN DE
// SYNTHESE, qui commencent le même jour : à droite au niveau du prédécesseur, puis une seule
// descente partagée, qui entre dans le haut de chacune.
test("lien FD : à droite au niveau du prédécesseur, puis vers le bas dans le début du successeur", () => {
  const lines = [
    task(1, day(5), day(9)),
    task(2, day(12), day(16), { link: FD(1) }),
    task(3, day(12), day(14), { link: FD(1) }),
    task(4, day(12), day(12), { link: FD(99) }),
  ];
  const links = buildGanttLinks(lines, scale);
  assert.deepEqual(rows(links), [[0, 1], [0, 2]], "lien vers une tâche absente : pas de flèche");
  assert.deepEqual(links[0].points, [[90, 13], [110, 13], [110, 32]]);
  assert.deepEqual(links[0].head, { x: 110, y: 32, direction: "down" });
  assert.deepEqual(links[1].points, [[90, 13], [110, 13], [110, 58]], "même descente que la première");
});

// Barres jointives (fin un jour, début le lendemain) : la flèche entre 5 px dans la suivante
// au lieu de longer les deux bords.
test("lien FD entre barres jointives, plusieurs lignes plus bas : 5 px dans la suivante", () => {
  const lines = [
    task(1, day(5), day(6)),
    task(2, day(7), day(7)),
    task(3, day(7), day(8), { link: FD(1) }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[60, 13], [65, 13], [65, 58]]);
  assert.deepEqual(link.head, { x: 65, y: 58, direction: "down" });
});

// Un jalon lié en FD tombe à l'heure de fin de son prédécesseur : dessiné à la fin de sa
// journée, comme dans MS Project ; un jalon libre reste au milieu de sa journée.
test("jalon lié en FD : losange à la fin de sa journée ; jalon libre : au milieu", () => {
  const [linked] = buildGanttShapes([task(2, day(6), day(6), { isMilestone: true, link: FD(1) })], scale);
  assert.deepEqual([linked.type, linked.x], ["milestone", 60]);
  const [free] = buildGanttShapes([task(2, day(6), day(6), { isMilestone: true })], scale);
  assert.equal(free.x, 55);
});

test("jalon FD juste sous la fin de son prédécesseur : aplomb droit depuis le coin de la barre", () => {
  const lines = [
    task(1, day(5), day(6)),
    task(2, day(6), day(6), { isMilestone: true, link: FD(1) }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[60, 20], [60, 33]]);
  assert.deepEqual(link.head, { x: 60, y: 33, direction: "down" });
});

// Capture : PLAN DE SYNTHESE RESEAUX → REUNION + DIFFUSION SYT, sous RESERVATIONS et TERMINAUX
// qui finissent le même jour : la descente passe dans le couloir, entre les fins de barres et
// leurs libellés, sans traverser les barres.
test("jalon FD plusieurs lignes plus bas : descente dans le couloir, sans traverser les barres", () => {
  const lines = [
    task(1, day(5), day(6)),
    task(2, day(6), day(6)),
    task(3, day(6), day(6), { isMilestone: true, link: FD(1) }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[60, 13], [65, 13], [65, 52], [60, 52], [60, 59]]);
  assert.deepEqual(link.head, { x: 60, y: 59, direction: "down" });
});

test("jalon FD loin à droite (SIGNATURE après VISA Indice A) : à droite puis vers le bas", () => {
  const lines = [
    task(1, day(5), day(6), { name: "VISA Indice A" }),
    task(2, day(5), day(6), { name: "PLAN DE SYNTHESE RES" }),
    task(3, day(20), day(20), { isMilestone: true, name: "SIGNATURE", link: FD(1, 5) }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[60, 13], [200, 13], [200, 59]]);
  assert.deepEqual(link.head, { x: 200, y: 59, direction: "down" });
});

test("successeur qui commence avant la fin du prédécesseur : S par l'interligne, entrée par la gauche", () => {
  const lines = [
    task(1, day(5), day(9)),
    task(2, day(8), day(9), { link: FD(1, -2) }),
    task(3, day(8), day(9), { link: FD(1, -2) }),
  ];
  const [first, second] = buildGanttLinks(lines, scale);
  assert.deepEqual(first.points, [[90, 13], [95, 13], [95, 26], [65, 26], [65, 39], [70, 39]]);
  assert.deepEqual(first.head, { x: 70, y: 39, direction: "right" });
  assert.deepEqual(second.points, [[90, 13], [95, 13], [95, 26], [65, 26], [65, 65], [70, 65]], "même tronc à gauche");
});

test("lien DD depuis un jalon dans l'étendue du successeur : aplomb depuis sa pointe basse", () => {
  const lines = [
    task(1, day(5), day(5), { isMilestone: true }),
    { kind: "group", key: "group:3", name: "CYCLE 1", start: day(5), end: day(9), startsWithMilestone: false, endsWithMilestone: false },
    task(2, day(5), day(6), { link: { predId: 1, type: "DD", lag: 0 } }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[45, 19], [45, 58]]);
  assert.deepEqual(link.head, { x: 45, y: 58, direction: "down" });
});

test("lien DD depuis un jalon avant le successeur : à droite puis vers le bas, comme un FD", () => {
  const lines = [
    task(1, day(2), day(2), { isMilestone: true }),
    task(2, day(8), day(9), { link: { predId: 1, type: "DD", lag: 4 } }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[21, 13], [70, 13], [70, 32]]);
  assert.deepEqual(link.head, { x: 70, y: 32, direction: "down" });
});

test("lien DD entre tâches : par la gauche du début, comme MS Project", () => {
  const lines = [
    task(1, day(5), day(9)),
    task(2, day(7), day(9), { link: { predId: 1, type: "DD", lag: 2 } }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[40, 13], [35, 13], [35, 39], [60, 39]]);
  assert.deepEqual(link.head, { x: 60, y: 39, direction: "right" });
});

test("lien FF : de la fin du prédécesseur à la fin du successeur, retour dans le couloir", () => {
  const lines = [
    task(1, day(5), day(9)),
    task(2, day(8), day(9), { link: { predId: 1, type: "FF", lag: 0 } }),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(link.points, [[90, 13], [95, 13], [95, 39], [90, 39]]);
  assert.deepEqual(link.head, { x: 90, y: 39, direction: "left" });
});

test("prédécesseur sous son successeur : à droite puis vers le haut", () => {
  const lines = [
    task(2, day(12), day(13), { link: FD(1) }),
    task(1, day(5), day(6)),
  ];
  const [link] = buildGanttLinks(lines, scale);
  assert.deepEqual(rows([link]), [[1, 0]]);
  assert.deepEqual(link.points, [[60, 39], [110, 39], [110, 20]]);
  assert.deepEqual(link.head, { x: 110, y: 20, direction: "up" });
});

test("conteneur avec des liens : plus de flèches dessinées entre voisines ; sans lien : comme avant", () => {
  const linked = [
    task(1, day(5), day(6)),
    task(2, day(12), day(13)),
    task(3, day(14), day(15), { link: FD(1) }),
  ];
  assert.deepEqual(rows(buildGanttLinks(linked, scale)), [[0, 2]]);
  const plain = [task(1, day(5), day(6), { groupRowId: null }), task(2, day(12), day(13), { groupRowId: null })];
  assert.deepEqual(rows(buildGanttLinks(plain, scale)), [[0, 1]]);
  const otherGroups = [task(1, day(5), day(6), { groupRowId: 9 }), task(2, day(12), day(13), { groupRowId: 10 })];
  assert.deepEqual(rows(buildGanttLinks(otherGroups, scale)), [], "deux groupes différents");
});

test("cycle et sous-groupe : crochet comme un étage", () => {
  const group = {
    kind: "group", key: "group:203", name: "CYCLE 1", start: day(5), end: day(9), startsWithMilestone: false, endsWithMilestone: false,
  };
  const [shape] = buildGanttShapes([group], scale);
  assert.deepEqual([shape.type, shape.x1, shape.x2, shape.label], ["floorBracket", 40, 90, "CYCLE 1"]);
});

// Comme dans MS Project, le texte passe par-dessus les traits : un liseré blanc autour des
// lettres garde les libellés lisibles quand une flèche passe dessous.
test("libellés détourés de blanc : lisibles quand une flèche passe dessous", () => {
  assert.match(css, /\.stg-label,\s*\.stg-date\s*\{[^}]*paint-order:\s*stroke;[^}]*stroke:\s*#fff;/);
});
