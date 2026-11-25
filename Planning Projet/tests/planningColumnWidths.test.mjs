import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  COLUMN_WIDTHS_STORAGE_KEY,
  MIN_COLUMN_WIDTH,
  PANE_MIN_TIMELINE_WIDTH,
  PANE_MIN_WIDTH,
  PLANNING_COLUMNS,
  columnCssVar,
  fitColumnWidths,
  maxColumnWidth,
  paneRoom,
  paneWidthBounds,
  paneWidthDuringResize,
  readColumnWidths,
  resizeColumn,
} from "../assets/js/services/planningColumnWidths.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8");

test("les colonnes réglables sont celles de l'en-tête du planning, dans le même ordre", () => {
  const left = html.slice(
    html.indexOf('<div class="planning-header-left">'),
    html.indexOf('<div class="planning-header-right">')
  );
  const headerKeys = [...left.matchAll(/class="hcol c-([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.equal(headerKeys.length, 11);
  assert.deepEqual(PLANNING_COLUMNS.map((column) => column.key), headerKeys);
});

test("chaque colonne a un libellé et sa variable de largeur dans la feuille de style", () => {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  PLANNING_COLUMNS.forEach(({ key, label }) => {
    assert.ok(label, `libellé manquant pour ${key}`);
    assert.equal(columnCssVar(key), `--col-${key}`);
    assert.match(root, new RegExp(`${columnCssVar(key)}: \\d+px;`), `${columnCssVar(key)} absente de :root`);
  });
});

test("les largeurs mémorisées ne gardent que les colonnes connues, arrondies et au moins au minimum", () => {
  assert.equal(MIN_COLUMN_WIDTH, 36);
  assert.equal(COLUMN_WIDTHS_STORAGE_KEY, "planning-projet.structure.column-widths");
  assert.deepEqual(
    readColumnWidths(JSON.stringify({ task: 260.4, start: 10, inconnue: 300, indice: "abc", end: -5, realise: "150" })),
    { task: 260, start: 36, realise: 150 }
  );
});

test("un stockage vide ou illisible ne règle aucune colonne", () => {
  assert.deepEqual(readColumnWidths(null), {});
  assert.deepEqual(readColumnWidths(""), {});
  assert.deepEqual(readColumnWidths("pas du json"), {});
  assert.deepEqual(readColumnWidths("[260]"), {});
  assert.deepEqual(readColumnWidths("260"), {});
});

test("glisser le bord d'une colonne l'élargit ou la rétrécit, jamais sous le minimum", () => {
  assert.equal(resizeColumn(196, 64), 260);
  assert.equal(resizeColumn(196, -60.4), 136);
  assert.equal(resizeColumn(196, -1000), MIN_COLUMN_WIDTH);
});

test("une colonne ne s'élargit pas au-delà de la largeur permise", () => {
  assert.equal(resizeColumn(196, 500, 400), 400);
  assert.equal(resizeColumn(196, 100, 400), 296);
});

// Fenêtre rétrécie depuis le dernier réglage : la colonne dépasse déjà la limite. Elle ne grandit
// plus, mais le premier mouvement ne la ramène pas d'un coup à la limite.
test("une colonne déjà plus large que la limite garde sa largeur tant qu'on ne la rétrécit pas", () => {
  assert.equal(resizeColumn(500, 0, 400), 500);
  assert.equal(resizeColumn(500, 80, 400), 500);
  assert.equal(resizeColumn(500, -30, 400), 470);
});

test("le volet peut occuper la fenêtre moins 320 px pour le planning, ou ce qu'il occupe déjà s'il a plus", () => {
  assert.equal(PANE_MIN_TIMELINE_WIDTH, 320);
  assert.equal(paneRoom({ viewportWidth: 1600 }), 1280);
  assert.equal(paneRoom({ viewportWidth: 1600, paneWidth: 1050 }), 1280);
  // Fenêtre étroite où le volet montre déjà toutes ses colonnes (état d'ouverture habituel).
  assert.equal(paneRoom({ viewportWidth: 1100, paneWidth: 1044 }), 1044);
});

// Le bord droit d'un titre ne dépasse pas la place que le volet gauche peut prendre : au-delà, la
// poignée passerait sous le planning et la colonne ne pourrait plus être rétrécie.
test("la largeur permise laisse la poignée dans le volet gauche", () => {
  // Place de 1280 px, marge de 4 px : le bord droit du titre peut aller jusqu'à 1276 px.
  assert.equal(maxColumnWidth({ width: 196, cellRight: 252, room: 1280, padX: 4 }), 196 + 1276 - 252);
});

const DEFAULTS = {
  id2: 52,
  task: 196,
  "ligne-planning": 84,
  start: 84,
  "duration-1": 64,
  end: 84,
  "duration-2": 64,
  demarrage: 100,
  indice: 60,
  realise: 190,
  retards: 64,
};

test("des largeurs réglées qui tiennent dans la fenêtre sont affichées telles quelles", () => {
  assert.deepEqual(
    fitColumnWidths({ custom: { task: 376, realise: 100 }, defaults: DEFAULTS, viewportWidth: 1682, padX: 4 }),
    { task: 376, realise: 100 }
  );
});

// « Tâches » élargie à 1540 px sur un grand écran, planning rouvert dans une fenêtre de 1100 px :
// sans retenue, sa poignée serait à 1596 px, sous le planning, et plus rien ne permettrait de la rétrécir.
test("une colonne réglée trop large pour la fenêtre est affichée à ce qui laisse sa poignée atteignable", () => {
  const fitted = fitColumnWidths({ custom: { task: 1540 }, defaults: DEFAULTS, viewportWidth: 1100, padX: 4 });
  // Volet d'au plus 780 px : marge 4 + Id 52 + Tâches 720 + marge 4.
  assert.deepEqual(fitted, { task: 720 });
});

test("une colonne retenue ne descend pas sous la largeur de la feuille de style", () => {
  // « Réalisation » commence déjà au-delà de la place disponible, comme pour tout le monde dans une
  // fenêtre étroite : elle garde au moins sa largeur d'origine, elle n'est pas écrasée.
  assert.deepEqual(
    fitColumnWidths({ custom: { realise: 250 }, defaults: DEFAULTS, viewportWidth: 1100, padX: 4 }),
    { realise: 190 }
  );
});

test("une colonne réglée plus étroite que l'origine le reste, quelle que soit la fenêtre", () => {
  assert.deepEqual(
    fitColumnWidths({ custom: { realise: 100, id2: 36 }, defaults: DEFAULTS, viewportWidth: 1100, padX: 4 }),
    { id2: 36, realise: 100 }
  );
});

// Widget chargé dans un cadre encore masqué : la fenêtre n'a pas de largeur, rien n'est retenu.
test("sans largeur de fenêtre connue, les largeurs réglées sont affichées telles quelles", () => {
  assert.deepEqual(
    fitColumnWidths({ custom: { task: 1540 }, defaults: DEFAULTS, viewportWidth: 0, padX: 4 }),
    { task: 1540 }
  );
});

test("la place d'une colonne tient compte des colonnes réglées à sa gauche", () => {
  // Tâches 500 tient (bord droit à 556) ; Début 400 commencerait à 640 et finirait à 1040 > 776 :
  // elle est ramenée à 136 px, la place qui reste.
  assert.deepEqual(
    fitColumnWidths({ custom: { task: 500, start: 400 }, defaults: DEFAULTS, viewportWidth: 1100, padX: 4 }),
    { task: 500, start: 136 }
  );
});

test("le volet gauche fait au plus toutes ses colonnes, en laissant 320 px au planning", () => {
  assert.equal(PANE_MIN_WIDTH, 260);
  assert.deepEqual(paneWidthBounds({ naturalWidth: 1060, viewportWidth: 1900 }), { minWidth: 260, maxWidth: 1060 });
  assert.deepEqual(paneWidthBounds({ naturalWidth: 1060, viewportWidth: 1200 }), { minWidth: 260, maxWidth: 880 });
  assert.deepEqual(paneWidthBounds({ naturalWidth: 1060, viewportWidth: 400 }), { minWidth: 260, maxWidth: 260 });
  assert.deepEqual(paneWidthBounds({ naturalWidth: 0, viewportWidth: 1900 }), { minWidth: 260, maxWidth: 260 });
});

test("le volet gauche suit la colonne qu'on élargit ou rétrécit", () => {
  const start = { paneWidth: 1060, naturalWidth: 1060, viewportWidth: 1900 };
  assert.equal(paneWidthDuringResize(start, 64), 1124);
  assert.equal(paneWidthDuringResize(start, -100), 960);
});

test("un volet réduit à la main garde les mêmes colonnes visibles", () => {
  const start = { paneWidth: 500, naturalWidth: 1060, viewportWidth: 1900 };
  assert.equal(paneWidthDuringResize(start, 64), 564);
  assert.equal(paneWidthDuringResize(start, -100), 400);
  assert.equal(paneWidthDuringResize(start, -400), 260, "jamais sous la largeur minimale du volet");
});

test("le volet qui suit une colonne laisse toujours 320 px au planning", () => {
  const start = { paneWidth: 1060, naturalWidth: 1060, viewportWidth: 1500 };
  assert.equal(paneWidthDuringResize(start, 300), 1180);
});

// « Tâches » élargie jusqu'à la limite : le volet est borné par la fenêtre (1362 px sur 1682) et les
// colonnes de droite sont cachées. La rétrécir doit les faire revenir, pas réduire le volet d'autant.
test("un volet borné par la fenêtre reste aussi large que possible quand la colonne rétrécit", () => {
  const start = { paneWidth: 1362, naturalWidth: 2156, viewportWidth: 1682 };
  assert.equal(paneWidthDuringResize(start, -500), 1362, "il reste des colonnes cachées : le volet ne bouge pas");
  assert.equal(paneWidthDuringResize(start, -1106), 1050, "toutes les colonnes tiennent : le volet les montre toutes");
});

// Fenêtre étroite (1100 px) : à l'ouverture le volet montre toutes ses colonnes (1044 px) et dépasse
// ce que la fenêtre « permet » (780 px). Régler une colonne ne doit pas le rétrécir d'un coup.
test("un volet plus large que ce que la fenêtre permet ne saute pas quand on règle une colonne", () => {
  const start = { paneWidth: 1044, naturalWidth: 1044, viewportWidth: 1100 };
  assert.equal(paneWidthDuringResize(start, 1), 1044, "il ne prend pas plus de place qu'il n'en a déjà");
  assert.equal(paneWidthDuringResize(start, 50), 1044);
  assert.equal(paneWidthDuringResize(start, -100), 944, "il suit la colonne qui rétrécit");
});
