import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { FakeElement, createFakeEnvironment, dispatch } from "./helpers/fakeDom.mjs";
import { AUTO_SCROLL_STEP_PX, createTaskDrag, lineIndexAt } from "../assets/js/ui/syntheseTaskDrag.js";

const ROW = 26;
// Zone Z3A : une tâche au niveau zone, l'étage PH RDB et ses deux tâches.
const LINES = [
  { key: "zone:zonez3a", kind: "zone", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" },
  { key: "task:1", kind: "task", taskId: 1, name: "Jalon démarrage GO", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "", floorName: "" },
  { key: "floor:zonez3a/phrdb", kind: "floor", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" },
  { key: "task:2", kind: "task", taskId: 2, name: "FOND DE PLAN", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" },
  { key: "task:3", kind: "task", taskId: 3, name: "Visa MOE", zoneKey: "zonez3a", zoneName: "Zone Z3A", floorKey: "phrdb", floorName: "PH RDB" },
];
// Centre vertical de la ligne `index` (le corps commence en y = 100).
const rowY = (index) => 100 + index * ROW + ROW / 2;

afterEach(() => {
  delete globalThis.Element;
});

// (Re)construit les lignes du corps, comme un redessin du tableau ; renvoie les poignées.
function buildBody(body) {
  body.children = [];
  const grips = new Map();
  LINES.forEach((line, index) => {
    const element = body.appendChild(new FakeElement("div", `stt-line stt-line--${line.kind}`));
    element.rect = { left: 0, top: 100 + index * ROW, width: 600, height: ROW };
    element.dataset.kind = line.kind;
    if (line.kind !== "task") return;
    element.dataset.taskId = String(line.taskId);
    const cell = element.appendChild(new FakeElement("div", "stt-cell stt-cell--name"));
    grips.set(line.taskId, cell.appendChild(new FakeElement("span", "stt-grip")));
  });
  return grips;
}

function setup({ enabled = true } = {}) {
  globalThis.Element = FakeElement;
  const env = createFakeEnvironment();
  const root = new FakeElement("div", "stt");
  const scroller = root.appendChild(new FakeElement("div", "stt-scroll"));
  // En-tête collant de 32 px : les lignes commencent en y = 100 ; bas du conteneur en y = 368.
  scroller.rect = { left: 0, top: 68, width: 600, height: 300 };
  const body = scroller.appendChild(new FakeElement("div", "stt-body"));
  body.rect = { left: 0, top: 100, width: 600, height: LINES.length * ROW };
  const grips = buildBody(body);
  const drops = [];
  const highlights = [];
  const previews = [];
  const sources = [];
  createTaskDrag({
    root,
    scroller,
    body,
    rowHeight: ROW,
    headHeight: 32,
    getLines: () => LINES,
    isEnabled: () => enabled,
    highlight: (key) => highlights.push(key),
    // Copie de la ligne : le tableau la construit avec son propre rendu.
    renderPreview: (line) => {
      previews.push(line);
      const preview = new FakeElement("div", "stt-line stt-line--task");
      preview.textContent = line.name;
      return preview;
    },
    markSource: (key) => sources.push(key),
    onDrop: (taskId, target) => drops.push({ taskId, target }),
    doc: env.doc,
    win: env.win,
  });
  const ghost = () => root.children.find((node) => node.classes.has("stt-drag-ghost")) || null;
  const caption = () => ghost()?.children.find((node) => node.classes.has("stt-drag-ghost__label")) || null;
  return { env, root, scroller, body, grips, drops, highlights, previews, sources, ghost, caption };
}

// Appui à x = 20 ; les mouvements se font par défaut à x = 30 (au-delà du seuil de 4 px).
const press = (grip, y) => dispatch(grip, "pointerdown", { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: y });
const move = (scroller, y, { x = 30, buttons = 1 } = {}) => dispatch(scroller, "pointermove", { pointerId: 1, buttons, clientX: x, clientY: y });
const release = (scroller, y, { x = 30 } = {}) => dispatch(scroller, "pointerup", { pointerId: 1, buttons: 0, clientX: x, clientY: y });

test("ligne sous le pointeur d'après la position verticale", () => {
  assert.equal(lineIndexAt(100, 100, ROW, 5), 0);
  assert.equal(lineIndexAt(125.9, 100, ROW, 5), 0);
  assert.equal(lineIndexAt(126, 100, ROW, 5), 1);
  assert.equal(lineIndexAt(99, 100, ROW, 5), -1);
  assert.equal(lineIndexAt(230, 100, ROW, 5), -1);
});

test("un simple clic sur la poignée ne déplace rien (seuil de 4 px)", () => {
  const { scroller, grips, drops, highlights, previews, sources, root, ghost } = setup();
  // Appui en bas de la ligne 1, puis 3 px plus bas : sur la ligne de l'étage (un autre conteneur).
  dispatch(grips.get(1), "pointerdown", { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 150 });
  assert.equal(scroller.captures.has(1), true);
  dispatch(scroller, "pointermove", { pointerId: 1, buttons: 1, clientX: 20, clientY: 153 });
  dispatch(scroller, "pointerup", { pointerId: 1, buttons: 0, clientX: 20, clientY: 153 });
  assert.deepEqual(highlights, []);
  assert.equal(drops.length, 0);
  assert.equal(ghost(), null);
  assert.deepEqual(previews, [], "pas de copie de la ligne");
  assert.deepEqual(sources, [], "ligne d'origine intacte");
  assert.equal(root.classes.has("is-dragging"), false);
  assert.equal(scroller.captures.has(1), false);
});

test("glisser une tâche de zone sur une tâche d'étage : copie de la ligne, destination, surlignage, dépôt dans l'étage", () => {
  const { env, scroller, grips, drops, root, highlights, previews, sources, ghost, caption } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  assert.equal(root.classes.has("is-dragging"), true);
  assert.equal(env.doc.documentElement.classes.has("is-stt-dragging"), true, "main fermée sur tout le widget");
  assert.deepEqual(previews.map((line) => line.key), ["task:1"]);
  assert.equal(ghost().children[0].textContent, "Jalon démarrage GO", "la copie de la ligne, puis la légende");
  assert.equal(ghost().inert, true, "ni focus ni lecteur d'écran dans la copie");
  assert.equal(caption().textContent, "Déplacer dans « PH RDB »");
  assert.equal(caption().hidden, false);
  assert.deepEqual(sources, ["task:1"], "ligne d'origine estompée");
  assert.equal(highlights.at(-1), "floor:zonez3a/phrdb");
  release(scroller, rowY(3));
  assert.deepEqual(drops.map((drop) => [drop.taskId, drop.target.key]), [[1, "floor:zonez3a/phrdb"]]);
  assert.equal(ghost(), null);
  assert.equal(highlights.at(-1), null);
  assert.deepEqual(sources, ["task:1", null]);
  assert.equal(root.classes.has("is-dragging"), false);
  assert.equal(env.doc.documentElement.classes.has("is-stt-dragging"), false);
});

test("la copie de la ligne suit le pointeur, tenue là où on l'a attrapée ; sans cible, pas de légende", () => {
  const { scroller, grips, ghost, caption } = setup();
  // Ligne de la tâche 1 : de y = 126 à 152 ; appui à x = 20, 13 px sous son bord haut.
  press(grips.get(1), rowY(1));
  move(scroller, rowY(1) + 5);
  assert.equal(ghost().style.left, "10px");
  assert.equal(ghost().style.top, `${rowY(1) + 5 - 13}px`);
  assert.equal(caption().hidden, true, "son propre conteneur : aucune destination");
  move(scroller, rowY(3), { x: 45 });
  assert.equal(ghost().style.left, "25px");
  assert.equal(ghost().style.top, `${rowY(3) - 13}px`);
  assert.equal(caption().hidden, false);
});

test("lâcher dans son conteneur actuel ou hors des lignes : rien", () => {
  const { scroller, grips, drops, highlights } = setup();
  press(grips.get(2), rowY(3));
  move(scroller, rowY(2));
  assert.equal(highlights.at(-1), null, "l'étage de la tâche : même conteneur");
  move(scroller, rowY(6));
  assert.equal(highlights.at(-1), null, "sous la dernière ligne");
  release(scroller, rowY(6));
  assert.equal(drops.length, 0);
});

test("Échap annule le glisser", () => {
  const { env, scroller, grips, drops, root, sources, ghost } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  const escape = dispatch(env.doc, "keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(root.classes.has("is-dragging"), false);
  assert.equal(ghost(), null);
  assert.deepEqual(sources, ["task:1", null], "ligne d'origine rendue");
  assert.equal(env.doc.documentElement.classes.has("is-stt-dragging"), false);
  assert.equal((env.doc.listeners.get("keydown") || []).length, 0, "écouteur Échap retiré");
  release(scroller, rowY(3));
  assert.equal(drops.length, 0);
});

test("près du bas de la liste, elle défile d'elle-même", () => {
  const { env, scroller, grips } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, 360);
  assert.equal(env.frames.size, 1);
  env.runFrames();
  assert.equal(scroller.scrollTop, AUTO_SCROLL_STEP_PX);
  assert.equal(env.frames.size, 1, "toujours au bord : le défilement continue");
  move(scroller, rowY(2));
  env.runFrames();
  assert.equal(scroller.scrollTop, AUTO_SCROLL_STEP_PX, "loin du bord : il s'arrête");
});

// Review Focus 4 : une relecture de Grist reconstruit le corps pendant le glisser.
test("un redessin du tableau pendant le glisser ne l'interrompt pas", () => {
  const { scroller, body, grips, drops } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(4));
  buildBody(body);
  move(scroller, rowY(4));
  release(scroller, rowY(4));
  assert.deepEqual(drops.map((drop) => [drop.taskId, drop.target.key]), [[1, "floor:zonez3a/phrdb"]]);
});

test("tableau non modifiable : la poignée ne glisse pas", () => {
  const { scroller, grips, drops, root } = setup({ enabled: false });
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  release(scroller, rowY(3));
  assert.equal(drops.length, 0);
  assert.equal(root.classes.has("is-dragging"), false);
  assert.equal(scroller.captures.size, 0);
});

test("bouton relâché hors de la fenêtre : le glisser s'arrête sans dépôt", () => {
  const { scroller, grips, drops, root } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  move(scroller, rowY(4), { buttons: 0 });
  assert.equal(root.classes.has("is-dragging"), false);
  release(scroller, rowY(4));
  assert.equal(drops.length, 0);
});

test("liste défilée : sur l'en-tête ou au-dessus du tableau, rien n'est visé et lâcher annule", () => {
  const { scroller, body, grips, drops, highlights } = setup();
  body.rect = { ...body.rect, top: 48 };
  // Liste défilée de 2 lignes ; la tâche 2 (ligne 3) est en y = 48 + 78 + 13 = 139.
  dispatch(grips.get(2), "pointerdown", { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 139 });
  move(scroller, 80);
  assert.equal(highlights.at(-1), null, "sur l'en-tête collant (68 à 100)");
  move(scroller, 60);
  assert.equal(highlights.at(-1), null, "au-dessus du tableau");
  release(scroller, 60);
  assert.equal(drops.length, 0);
});

test("la liste défile à la molette pendant le glisser : la cible suit la position", () => {
  const { scroller, body, grips, drops, highlights } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  assert.equal(highlights.at(-1), "floor:zonez3a/phrdb");
  body.rect = { ...body.rect, top: 100 - 3 * ROW };
  dispatch(scroller, "scroll", {});
  assert.equal(highlights.at(-1), null, "sous la dernière ligne après le défilement");
  release(scroller, rowY(3));
  assert.equal(drops.length, 0);
});

test("pointercancel ou perte de capture : le glisser s'arrête sans dépôt", () => {
  const { scroller, grips, drops, root } = setup();
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  dispatch(scroller, "pointercancel", { pointerId: 1 });
  assert.equal(root.classes.has("is-dragging"), false);
  release(scroller, rowY(3));
  press(grips.get(1), rowY(1));
  move(scroller, rowY(3));
  dispatch(scroller, "lostpointercapture", { pointerId: 1 });
  assert.equal(root.classes.has("is-dragging"), false);
  release(scroller, rowY(3));
  assert.equal(drops.length, 0);
});

test("près du haut, sous l'en-tête, la liste remonte d'elle-même", () => {
  const { env, scroller, grips } = setup();
  scroller.scrollTop = 50;
  press(grips.get(3), rowY(4));
  move(scroller, 110);
  assert.equal(env.frames.size, 1);
  env.runFrames();
  assert.equal(scroller.scrollTop, 50 - AUTO_SCROLL_STEP_PX);
});

test("en butée, le défilement automatique s'arrête", () => {
  const { env, scroller, grips } = setup();
  let top = 0;
  Object.defineProperty(scroller, "scrollTop", {
    get: () => top,
    set: (value) => {
      top = Math.max(0, value);
    },
  });
  press(grips.get(3), rowY(4));
  move(scroller, 110);
  env.runFrames();
  assert.equal(scroller.scrollTop, 0);
  assert.equal(env.frames.size, 0, "plus d'image demandée en haut de la liste");
});
