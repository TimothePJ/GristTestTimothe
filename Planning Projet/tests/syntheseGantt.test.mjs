import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createSyntheseGantt } from "../assets/js/ui/syntheseGantt.js";

const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");
const source = await readFile(new URL("../assets/js/ui/syntheseGantt.js", import.meta.url), "utf8");

test("le module du Gantt expose sa fabrique", () => {
  assert.equal(typeof createSyntheseGantt, "function");
});

test("couleurs de la capture MS Project, fixes", () => {
  assert.match(css, /\.stg-task\s*\{[^}]*fill:\s*#7cc7d8;[^}]*stroke:\s*#3b9bb0;/);
  assert.match(css, /\.stg-milestone\s*\{[^}]*fill:\s*#2f8fa3;/);
  assert.match(css, /\.stg-zone\s*\{[^}]*fill:\s*#1f1f1f;/);
  assert.match(css, /\.stg-today\s*\{[^}]*stroke:\s*#d92d20;/);
  assert.match(css, /\.stg-off\s*\{[^}]*fill:\s*#f1f1f1;/);
  assert.match(css, /\.stg-label\s*\{[^}]*fill:\s*#1f1f1f;/);
});

test("la couche du Gantt suit la colonne droite et laisse passer la souris", () => {
  assert.match(css, /\.stt-gantt-layer\s*\{[^}]*position:\s*absolute;/);
  assert.match(css, /\.stt-gantt-layer\s*\{[^}]*left:\s*var\(--stt-left-width\);/);
  assert.match(css, /\.stt-gantt-layer\s*\{[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.stt-scroll\s*\{[^}]*position:\s*relative;/);
});

test("un dessin par image au plus, molette non passive pour le zoom", () => {
  assert.match(source, /requestAnimationFrame\(draw\)/);
  assert.match(source, /addEventListener\("wheel",[\s\S]*?\{ passive: false \}\)/);
});

test("couleurs des crochets d'étage et des flèches", () => {
  assert.match(css, /\.stg-floor\s*\{[^}]*stroke:\s*#1f1f1f;[^}]*stroke-width:\s*1\.5;/);
  assert.match(css, /\.stg-link\s*\{[^}]*stroke:\s*#3b9bb0;/);
  assert.match(css, /\.stg-link-head\s*\{[^}]*fill:\s*#3b9bb0;/);
});

test("pointes des flèches dans les quatre directions", () => {
  for (const direction of ["down", "up", "right", "left"]) {
    assert.match(source, new RegExp(`${direction}: \\(x, y\\) =>`));
  }
});

// Les libellés laissent libre le couloir des flèches : le dessin prend son écart dans la
// géométrie, là où le tracé des flèches le prend aussi.
test("libellés à LABEL_GAP_PX de la géométrie (couloir des flèches libre)", () => {
  assert.match(source, /import \{[^}]*\bLABEL_GAP_PX\b[^}]*\} from "\.\.\/services\/syntheseGanttGeometry\.js";/);
  assert.equal(/const LABEL_GAP_PX = /.test(source), false);
});

// Plan de réservations du cycle 3 qui dépasse sa limite de fin (début du plan de coffrage de son étage).
test("limite de fin : repère rouge en pointillé, barre et jalon en rouge quand elle est dépassée", () => {
  assert.match(css, /\.stg-limit\s*\{[^}]*stroke:\s*#c00000;[^}]*stroke-dasharray:/);
  assert.match(css, /\.stg-task\.is-over-limit\s*\{[^}]*fill:\s*#f4b6ae;[^}]*stroke:\s*#c00000;/);
  assert.match(css, /\.stg-milestone\.is-over-limit\s*\{[^}]*fill:\s*#c00000;/);
  assert.match(source, /shape\.type === "endLimit"/);
  assert.match(source, /shape\.overLimit \? "stg-task is-over-limit" : "stg-task"/);
  assert.match(source, /shape\.overLimit \? "stg-milestone is-over-limit" : "stg-milestone"/);
});
