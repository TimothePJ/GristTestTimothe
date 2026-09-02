// Teinte de SURCHARGE sur une barre de segment du plan de charge.
//
// La barre vire a l'ambre quand la PERSONNE depasse sa capacite du mois, tous
// projets confondus — donc pas forcement a cause du segment affiche : un segment
// de 2 j peut alerter parce que la personne en a 25 ailleurs. C'est voulu ; la
// couleur parle de la personne, pas du projet regarde, et l'infobulle le dit.
//
// A ne pas confondre avec l'etat rouge « incoherent », qui compare l'effectif
// d'UN segment au disponible de son mois : celui-la denonce une saisie fausse.
// Le rouge l'emporte — une donnee fausse doit rester plus visible qu'une charge
// lourde.
//
// COMMENT ON TESTE : `buildVisibleSegmentBars` et `renderSegmentBars` restent
// module-prives dans chargeBoard.js. On suit le motif de chargeRowRender.test.mjs
// et postWriteRefresh.test.mjs : on extrait le TEXTE REEL des fonctions et on
// l'execute dans un `vm`, aux cotes de leurs VRAIES dependances — aucune
// reimplementation parallele. L'extraction ECHOUE BRUYAMMENT si un en-tete
// disparait ou devient ambigu, sinon « aucun test ne tombe » serait
// indiscernable d'une vraie garde.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { getSegmentEffectiveDays } from "../assets/js/utils/timeSegments.js";
import { getMonthAvailableDays, getMonthBounds } from "../assets/js/utils/monthSegments.js";
import { countPlanningTasksOverlappingRange } from "../assets/js/top/phases.js";
import { formatNumber } from "../assets/js/utils/format.js";
import { buildMonthOverloadIndex } from "../assets/js/utils/monthLoad.js";

const source = fs.readFileSync(
  new URL("../assets/js/bottom/chargeBoard.js", import.meta.url),
  "utf8"
);

// Les fins de ligne du depot sont mixtes : deriver EOL de la source evite un
// echec d'extraction deroutant si chargeBoard.js changeait de convention.
const SOURCE_EOL = source.includes("\r\n") ? "\r\n" : "\n";

function extractBlock(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `bloc introuvable dans chargeBoard.js : ${header}`);
  assert.equal(
    source.indexOf(header, start + 1),
    -1,
    `en-tete ambigue dans chargeBoard.js : ${header}`
  );

  const open = start + header.length - 1;
  assert.equal(source[open], "{", `l'en-tete doit se terminer par une accolade : ${header}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`accolades non equilibrees : ${header}`);
}

const BLOCKS = [
  "function escapeHtml(value) {",
  "function formatDayValue(value) {",
  "function getVisibleSlotRange(startAt, endAt, visibleSlots) {",
  [
    "function buildVisibleSegmentBars(",
    "  worker,",
    "  visibleSlots,",
    "  planningTasks = [],",
    "  absenceSet = new Set(),",
    "  overloadIndex = null",
    ") {",
  ].join(SOURCE_EOL),
  "function renderSegmentBars(assignedBars) {",
].map(extractBlock);

// Septembre 2026 : 22 jours ouvres, aucun ferie.
const MONTH = "2026-09";
const COLS = {
  id: "id",
  mois: "Mois",
  name: "Name",
  effectif: "Effectif",
  projectNumber: "NumeroProjet",
};

// Une seule case couvrant tout le mois : la geometrie n'est pas le sujet ici.
function visibleSlots() {
  const bounds = getMonthBounds(MONTH);
  return [
    {
      slotIndex: 0,
      leftPx: 0,
      widthPx: 100,
      startAt: bounds.startAt,
      endAt: bounds.endAt,
    },
  ];
}

function segmentRow(id, name, effectif, projectNumber) {
  return { id, Mois: "2026-09-01", Name: name, Effectif: effectif, NumeroProjet: projectNumber };
}

// Monte les vraies fonctions de chargeBoard.js et rend la barre produite.
function renderBars({ workerName = "Marie Dupont", segments, allSegmentRows, absenceSet = null }) {
  const sandbox = {
    Math,
    Number,
    String,
    Set,
    Array,
    Object,
    Boolean,
    Date,
    getSegmentEffectiveDays,
    getMonthAvailableDays,
    countPlanningTasksOverlappingRange,
    formatNumber,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    [...BLOCKS, "globalThis.__api = { buildVisibleSegmentBars, renderSegmentBars };"].join("\n\n"),
    context,
    { filename: "chargeBoard.js (extrait)" }
  );

  const bounds = getMonthBounds(MONTH);
  const worker = {
    name: workerName,
    segments: segments.map((seg) => ({
      id: seg.id,
      monthKey: MONTH,
      startAt: bounds.startAt,
      endAt: bounds.endAt,
      effectif: seg.effectif,
    })),
  };

  const overloadIndex = buildMonthOverloadIndex({
    entries: worker.segments.map((seg) => ({ personName: worker.name, monthKey: seg.monthKey })),
    allSegmentRows,
    columns: COLS,
    resolveAbsenceSet: () => absenceSet,
  });

  const bars = context.__api.buildVisibleSegmentBars(
    worker,
    visibleSlots(),
    [],
    absenceSet instanceof Set ? absenceSet : new Set(),
    overloadIndex
  );

  return {
    bars,
    html: context.__api.renderSegmentBars(bars.map((bar) => ({ ...bar, laneIndex: 0 }))),
  };
}

test("un segment vire a l'ambre quand la personne deborde SUR UN AUTRE projet", () => {
  // 15 j ici + 12 j ailleurs = 27 j pour 22 disponibles. Le segment affiche
  // (15 j) ne depasse pas tout seul : sans le comptage inter-projets il
  // resterait neutre, et la surcharge serait invisible depuis ce planning.
  const { html } = renderBars({
    segments: [{ id: 1, effectif: 15 }],
    allSegmentRows: [
      segmentRow(1, "Marie Dupont", 15, "A"),
      segmentRow(2, "Marie Dupont", 12, "B"),
    ],
  });

  assert.match(html, /class="charge-plan-segment-bar[^"]*is-overloaded/);
  assert.doesNotMatch(html, /is-incoherent/);
});

test("l'infobulle donne les chiffres, sinon la couleur est muette", () => {
  // Sans eux, l'utilisateur voit une barre ambre sur un projet ou tout va bien,
  // et n'a aucun moyen de savoir que la charge est ailleurs.
  const { html } = renderBars({
    segments: [{ id: 1, effectif: 15 }],
    allSegmentRows: [
      segmentRow(1, "Marie Dupont", 15, "A"),
      segmentRow(2, "Marie Dupont", 12, "B"),
    ],
  });

  assert.match(html, /Surcharge : 27 j sur 22 j disponibles ce mois, tous projets confondus/);
});

test("un mois PILE plein ne vire pas", () => {
  const { html } = renderBars({
    segments: [{ id: 1, effectif: 14 }],
    allSegmentRows: [
      segmentRow(1, "Marie Dupont", 14, "A"),
      segmentRow(2, "Marie Dupont", 8, "B"),
    ],
  });

  assert.doesNotMatch(html, /is-overloaded/);
});

test("le rouge « incoherent » l'emporte sur l'ambre", () => {
  // 25 j sur un mois de 22 : la SAISIE elle-meme est fausse. Les deux conditions
  // sont vraies, mais une donnee aberrante doit rester plus visible qu'une
  // charge lourde — et les deux classes ne doivent jamais coexister.
  const { html } = renderBars({
    segments: [{ id: 1, effectif: 25 }],
    allSegmentRows: [segmentRow(1, "Marie Dupont", 25, "A")],
  });

  assert.match(html, /is-incoherent/);
  assert.doesNotMatch(html, /is-overloaded/);
});

test("sans surcharge, l'infobulle reste celle des taches Planning Projet", () => {
  const { html } = renderBars({
    segments: [{ id: 1, effectif: 5 }],
    allSegmentRows: [segmentRow(1, "Marie Dupont", 5, "A")],
  });

  assert.doesNotMatch(html, /is-overloaded/);
  assert.match(html, /Planning Projet/);
});

test("le nom du segment est apparie sans egard aux accents ni a la casse", () => {
  // Les lignes TimeSegment et les noms affiches (Team) ne s'ecrivent pas
  // toujours pareil. Sans normalisation la barre resterait neutre EN SILENCE,
  // ce qui est indiscernable d'une personne qui n'est pas en surcharge.
  const { html } = renderBars({
    workerName: "MARIE DUPONT",
    segments: [{ id: 1, effectif: 15 }],
    allSegmentRows: [
      segmentRow(1, "Marie Dupont", 15, "A"),
      segmentRow(2, "Marie Dupont", 12, "B"),
    ],
  });

  assert.match(html, /is-overloaded/);
});
