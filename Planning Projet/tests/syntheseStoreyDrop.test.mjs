import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";
import { buildRowModel, buildSections, resolveDropTarget } from "../assets/js/services/syntheseTaskModel.js";
import { resolveDropSlot } from "../assets/js/services/syntheseTaskOrder.js";
import { resolveCycleDropSlot } from "../assets/js/services/syntheseCycles.js";
import { buildGanttShapes } from "../assets/js/services/syntheseGanttGeometry.js";
import { createTaskDrag } from "../assets/js/ui/syntheseTaskDrag.js";

const Z1 = "Zone 1 / BAT BC";
const rows = [
  { id: 1, NomProjet: "H", Taches: "Plans SS1", Type_doc: "", ID2: "", Zone: Z1, Diff_coffrage: "2026-01-05", Diff_armature: "2026-01-06", Duree_1: 2, Groupe: "SS1" },
  { id: 2, NomProjet: "H", Taches: "Hors étage", Type_doc: "", ID2: "", Zone: Z1, Diff_coffrage: "2026-04-01", Diff_armature: "2026-04-02", Duree_1: 2, Groupe: "" },
];
const find = (lines, key) => lines.find((line) => line.key === key);
const floorLines = buildRowModel(buildSections({ rows }), { layout: "floor" });
const zoneLines = buildRowModel(buildSections({ rows }), {});

test("lignes étage : aucune cible de dépôt", () => {
  const storey = find(floorLines, "storey:ss1");
  const noStorey = find(floorLines, "storey:");
  assert.equal(storey.kind, "storey");
  assert.equal(resolveDropTarget(storey), null);
  assert.equal(resolveDropTarget(noStorey), null);
  assert.equal(resolveDropSlot(storey, "after", { canOrder: true }), null);
  assert.equal(resolveCycleDropSlot(storey, "after", { groupRowId: 9, zoneKey: "zone1batbc", floorKey: "ss1" }), null);
});

test("zone dans l'étage et tâche d'étage : le libellé nomme la zone", () => {
  const floor = find(floorLines, "floor:zone1batbc/ss1");
  const target = resolveDropTarget(floor);
  assert.equal(target.key, "floor:zone1batbc/ss1");
  assert.equal(target.label, "Déplacer dans « SS1 » (« Zone 1 / BAT BC »)");
  assert.equal(resolveDropSlot(floor, "after", { canOrder: true }).label, "Déplacer à la fin de « SS1 » (« Zone 1 / BAT BC »)");
  assert.equal(resolveDropTarget(find(floorLines, "task:1")).label, "Déplacer dans « SS1 » (« Zone 1 / BAT BC »)");
});

test("sans layout : libellés inchangés", () => {
  const floor = find(zoneLines, "floor:zone1batbc/ss1");
  assert.equal(resolveDropTarget(floor).label, "Déplacer dans « SS1 »");
  assert.equal(resolveDropSlot(floor, "after", { canOrder: true }).label, "Déplacer à la fin de « SS1 »");
});

test("Gantt : étage → crochet, zone dans l'étage → barre de zone", () => {
  const scale = { dateToX: (date) => Number(date) / 86400000 };
  const shapes = buildGanttShapes(floorLines, scale);
  const typeOf = (key) => shapes.find((shape) => shape.key === key)?.type;
  assert.equal(typeOf("storey:ss1"), "floorBracket");
  assert.equal(typeOf("floor:zone1batbc/ss1"), "zoneBar");
  const zoneShapes = buildGanttShapes(zoneLines, scale);
  assert.equal(zoneShapes.find((shape) => shape.key === "zone:zone1batbc").type, "zoneBar");
  assert.equal(zoneShapes.find((shape) => shape.key === "floor:zone1batbc/ss1").type, "floorBracket");
});

// Deux zones bâties sur le même modèle : « CYCLE 1 » et sa tâche « Plans » dans l'étage SS1 de
// chacune. Mode étage : 0 storey:ss1, 1 floor Z1, 2 group:10, 3 task:11, 4 floor Z2, 5 group:30,
// 6 task:31, 7 « Sans étage », 8 zone Z1, 9 zone Z2. Mode zone : 0 zone Z1, 1 floor Z1, 2 group:10,
// 3 task:11, 4 zone Z2, 5 floor Z2, 6 group:30, 7 task:31.
const Z2 = "Zone 2 / BAT B";
const twin = (id, zone, fields) => ({
  id, NomProjet: "H", Taches: "", Type_doc: "", ID2: "", Zone: zone, Groupe: "SS1", Nature: "", Parent: "",
  Lien: "", Diff_coffrage: null, Diff_armature: null, Duree_1: 0, ...fields,
});
const twinRows = [
  twin(10, Z1, { Taches: "CYCLE 1", Nature: "Cycle" }),
  twin(11, Z1, { Taches: "Plans", Parent: "10", Diff_coffrage: "2026-01-05", Diff_armature: "2026-01-06", Duree_1: 2 }),
  twin(30, Z2, { Taches: "CYCLE 1", Nature: "Cycle" }),
  twin(31, Z2, { Taches: "Plans", Parent: "30", Diff_coffrage: "2026-02-02", Diff_armature: "2026-02-03", Duree_1: 2 }),
];
const twinFloor = buildRowModel(buildSections({ rows: twinRows }), { layout: "floor" });
const twinZone = buildRowModel(buildSections({ rows: twinRows }), {});

test("cycle glissé sur la zone dans l'étage : le libellé nomme la zone ; mode zone inchangé", () => {
  const options = { groupRowId: 10, zoneKey: "zone1batbc", floorKey: "ss1" };
  const slot = resolveCycleDropSlot(find(twinFloor, "floor:zone1batbc/ss1"), "after", options);
  assert.equal(slot.key, "floor:zone1batbc/ss1");
  assert.equal(slot.groupRowId, null);
  assert.equal(slot.label, "Déplacer à la fin de « SS1 » (« Zone 1 / BAT BC »)");
  assert.equal(resolveCycleDropSlot(find(twinZone, "floor:zone1batbc/ss1"), "after", options).label, "Déplacer à la fin de « SS1 »");
});

test("tâche glissée vers un cycle ou une tâche d'une autre zone : le libellé finit par cette zone", () => {
  const labelOf = (key, side, canOrder) => resolveDropSlot(find(twinFloor, key), side, {
    canOrder, draggedTaskId: 11, draggedZoneKey: "zone1batbc",
  })?.label;
  assert.equal(labelOf("group:30", "after", false), "Déplacer dans « CYCLE 1 » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("task:31", "after", false), "Déplacer dans « CYCLE 1 » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("group:30", "before", true), "Placer avant « CYCLE 1 » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("group:30", "after", true), "Déplacer à la fin de « CYCLE 1 » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("task:31", "before", true), "Placer avant « Plans » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("task:31", "after", true), "Placer après « Plans » (« Zone 2 / BAT B »)");
  // Étage et zone : la zone est déjà nommée, une seule fois.
  assert.equal(labelOf("floor:zone2batb/ss1", "after", false), "Déplacer dans « SS1 » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("floor:zone2batb/ss1", "after", true), "Déplacer à la fin de « SS1 » (« Zone 2 / BAT B »)");
  assert.equal(labelOf("zone:zone2batb", "after", false), "Déplacer au niveau de la zone « Zone 2 / BAT B »");
  assert.equal(labelOf("zone:zone2batb", "after", true), "Déplacer à la fin du niveau de la zone « Zone 2 / BAT B »");
  // Sa propre zone : libellés courts.
  assert.equal(labelOf("group:10", "after", false), "Déplacer dans « CYCLE 1 »");
  assert.equal(labelOf("group:10", "before", true), "Placer avant « CYCLE 1 »");
  assert.equal(labelOf("group:10", "after", true), "Déplacer à la fin de « CYCLE 1 »");
});

test("mode zone : libellés inchangés, même vers une autre zone", () => {
  const labelOf = (key, side, canOrder) => resolveDropSlot(find(twinZone, key), side, {
    canOrder, draggedTaskId: 11, draggedZoneKey: "zone1batbc",
  })?.label;
  assert.equal(labelOf("group:30", "after", false), "Déplacer dans « CYCLE 1 »");
  assert.equal(labelOf("group:30", "before", true), "Placer avant « CYCLE 1 »");
  assert.equal(labelOf("group:30", "after", true), "Déplacer à la fin de « CYCLE 1 »");
  assert.equal(labelOf("task:31", "before", true), "Placer avant « Plans »");
  assert.equal(labelOf("floor:zone2batb/ss1", "after", false), "Déplacer dans « SS1 »");
  assert.equal(labelOf("zone:zone2batb", "after", false), "Déplacer au niveau de la zone « Zone 2 / BAT B »");
});

/* ---------- Glisser dans le tableau (harnais de syntheseTaskDrag.test.mjs, réduit) ---------- */

const ROW = 26;
// Centre vertical de la ligne `index` (le corps commence en y = 100, sous un en-tête de 32 px).
const rowY = (index) => 100 + index * ROW + ROW / 2;
const topHalf = (index) => 100 + index * ROW + 4;
const bottomHalf = (index) => 100 + index * ROW + 20;

afterEach(() => {
  delete globalThis.Element;
});

function dragOn(lines, { canOrder = false, canMoveCycles = false } = {}) {
  globalThis.Element = FakeElement;
  const env = createFakeEnvironment();
  const root = new FakeElement("div", "stt");
  const scroller = root.appendChild(new FakeElement("div", "stt-scroll"));
  // Assez haut pour qu'aucune ligne ne soit près du bord (pas de défilement automatique).
  scroller.rect = { left: 0, top: 68, width: 600, height: 32 + lines.length * ROW + 100 };
  const body = scroller.appendChild(new FakeElement("div", "stt-body"));
  body.rect = { left: 0, top: 100, width: 600, height: lines.length * ROW };
  const grips = new Map();
  lines.forEach((line, index) => {
    const element = body.appendChild(new FakeElement("div", "stt-line"));
    element.rect = { left: 0, top: 100 + index * ROW, width: 600, height: ROW };
    element.dataset.kind = line.kind;
    if (line.kind === "task") element.dataset.taskId = String(line.taskId);
    if (line.kind === "group") element.dataset.groupRowId = String(line.groupRowId);
    if (line.kind === "task" || line.kind === "group") {
      grips.set(line.key, element.appendChild(new FakeElement("span", "stt-grip")));
    }
  });
  const highlights = [];
  const slots = [];
  const drops = [];
  createTaskDrag({
    root,
    scroller,
    body,
    rowHeight: ROW,
    headHeight: 32,
    getLines: () => lines,
    highlight: (key) => highlights.push(key),
    canOrder: () => canOrder,
    markSlot: (slot) => slots.push(slot),
    canMoveCycles: () => canMoveCycles,
    onDrop: (taskId, target) => drops.push(target),
    onDropCycle: (groupRowId, target) => drops.push(target),
    doc: env.doc,
    win: env.win,
  });
  const caption = () => root.children.find((node) => node.classes.has("stt-drag-ghost"))
    ?.children.find((node) => node.classes.has("stt-drag-ghost__label")) || null;
  const press = (key) => dispatch(grips.get(key), "pointerdown", {
    button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: rowY(lines.findIndex((line) => line.key === key)),
  });
  const move = (y) => dispatch(scroller, "pointermove", { pointerId: 1, buttons: 1, clientX: 30, clientY: y });
  const release = (y) => dispatch(scroller, "pointerup", { pointerId: 1, buttons: 0, clientX: 30, clientY: y });
  return { press, move, release, caption, highlights, slots, drops };
}

const STOREY_HINT = "Visez une zone de l'étage";

test("tâche glissée sur une ligne étage ou « Sans étage » : la légende dit de viser une zone, rien n'est déposé", () => {
  for (const canOrder of [false, true]) {
    const drag = dragOn(twinFloor, { canOrder });
    drag.press("task:11");
    drag.move(rowY(0));
    assert.equal(drag.caption().textContent, STOREY_HINT, `étage (Ordre : ${canOrder})`);
    assert.equal(drag.caption().hidden, false);
    assert.equal(drag.highlights.at(-1), null, "rien n'est surligné");
    assert.equal(drag.slots.at(-1), null, "pas de trait d'insertion");
    drag.move(rowY(7));
    assert.equal(drag.caption().textContent, STOREY_HINT, `« Sans étage » (Ordre : ${canOrder})`);
    assert.equal(drag.caption().hidden, false);
    drag.release(rowY(7));
    assert.deepEqual(drag.drops, []);
  }
});

test("cycle glissé sur une ligne étage : même légende, rien n'est déposé ; sur sa zone dans l'étage, la zone est nommée", () => {
  const drag = dragOn(twinFloor, { canOrder: true, canMoveCycles: true });
  drag.press("group:10");
  drag.move(rowY(0));
  assert.equal(drag.caption().textContent, STOREY_HINT);
  assert.equal(drag.caption().hidden, false);
  assert.equal(drag.highlights.at(-1), null);
  assert.equal(drag.slots.at(-1), null);
  drag.move(rowY(1));
  assert.equal(drag.caption().textContent, "Déplacer à la fin de « SS1 » (« Zone 1 / BAT BC »)");
  drag.move(rowY(7));
  assert.equal(drag.caption().textContent, STOREY_HINT);
  drag.release(rowY(7));
  assert.deepEqual(drag.drops, []);
});

test("glisser une tâche vers l'autre zone de l'étage : la légende nomme la zone, pas dans sa propre zone", () => {
  const drag = dragOn(twinFloor, { canOrder: true });
  drag.press("task:11");
  drag.move(topHalf(5));
  assert.equal(drag.caption().textContent, "Placer avant « CYCLE 1 » (« Zone 2 / BAT B »)");
  drag.move(topHalf(2));
  assert.equal(drag.caption().textContent, "Placer avant « CYCLE 1 »");
  drag.move(bottomHalf(6));
  assert.equal(drag.caption().textContent, "Placer après « Plans » (« Zone 2 / BAT B »)");
  drag.release(bottomHalf(6));
  assert.deepEqual(drag.drops.map((target) => [target.key, target.zoneKey]), [["slot:31:after", "zone2batb"]]);
});

test("glisser sans la colonne Ordre vers le cycle d'une autre zone : la légende nomme la zone", () => {
  const drag = dragOn(twinFloor);
  drag.press("task:11");
  drag.move(rowY(5));
  assert.equal(drag.caption().textContent, "Déplacer dans « CYCLE 1 » (« Zone 2 / BAT B »)");
  drag.move(rowY(4));
  assert.equal(drag.caption().textContent, "Déplacer dans « SS1 » (« Zone 2 / BAT B »)");
});

test("mode zone : légendes du glisser inchangées vers une autre zone", () => {
  const drag = dragOn(twinZone, { canOrder: true });
  drag.press("task:11");
  drag.move(topHalf(6));
  assert.equal(drag.caption().textContent, "Placer avant « CYCLE 1 »");
  drag.move(bottomHalf(7));
  assert.equal(drag.caption().textContent, "Placer après « Plans »");
  drag.move(rowY(4));
  assert.equal(drag.caption().textContent, "Déplacer à la fin du niveau de la zone « Zone 2 / BAT B »");
});
