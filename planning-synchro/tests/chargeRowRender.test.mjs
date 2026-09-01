// Tests de la ligne « Charge » du board (bas de planning-synchro) : compare, par
// mois visible, les jours PLANIFIES (memes chiffres que la ligne Total, via
// computeMonthTotalDays) aux jours REQUIS par le bareme de reference (Task 1,
// documentCharge.js). Trois teintes signalent l'ecart ; sans elles la ligne
// n'aurait aucune valeur au-dela d'un doublon de Total.
//
// COMMENT ON TESTE : `renderChargeRow` / `renderChargeMonthTrack` /
// `getChargeCellState` restent module-prives dans chargeBoard.js (comme
// `renderTotalRow` avant elles) — un import ES ordinaire ne les atteint pas. On
// suit donc le motif deja en place dans tests/postWriteRefresh.test.mjs : on
// extrait le TEXTE REEL des fonctions depuis le fichier source et on l'execute
// dans un `vm`, aux cotes de leurs VRAIES dependances pures deja importables
// (getSegmentEffectiveDays, formatNumber) — aucune reimplementation parallele.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { getSegmentEffectiveDays } from "../assets/js/utils/timeSegments.js";
import { getMonthBusinessDays } from "../assets/js/utils/monthSegments.js";
import { formatNumber } from "../assets/js/utils/format.js";

const CHARGE_BOARD_PATH = new URL("../assets/js/bottom/chargeBoard.js", import.meta.url);
const source = fs.readFileSync(CHARGE_BOARD_PATH, "utf8");

// --- extraction du texte reel de chargeBoard.js -------------------------------

// Extrait un bloc de fonction a partir de son en-tete (qui doit se terminer par
// « { ») en equilibrant les accolades. ECHOUE BRUYAMMENT si l'en-tete a disparu :
// une extraction muette produirait « aucun test ne tombe », indiscernable d'une
// vraie garde.
function extractBlock(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `bloc introuvable dans chargeBoard.js : ${header}`);
  assert.equal(
    source.indexOf(header, start + 1),
    -1,
    `en-tete ambigue dans chargeBoard.js (plusieurs occurrences) : ${header}`
  );

  const open = start + header.length - 1;
  assert.equal(source[open], "{", `l'en-tete doit se terminer par une accolade : ${header}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`accolades non equilibrees dans chargeBoard.js : ${header}`);
}

// Ligne unique (pas de bloc a accolades) : on la retrouve par regex plutot que
// de la recopier a la main, sinon un changement de valeur dans chargeBoard.js
// laisserait la suite verte sur une epsilon perimee.
function extractLine(pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `ligne introuvable dans chargeBoard.js : ${label}`);
  return match[0];
}

const CHARGE_EPSILON_LINE = extractLine(/const CHARGE_EPSILON = [^;]+;/, "CHARGE_EPSILON");

const BLOCK_HEADERS = [
  "function formatDayValue(value) {",
  "function computeMonthTotalDays(workers, month) {",
  // Partagee avec la ligne Total (renderReadonlyMonthTrack) depuis la
  // deduplication de la pastille : renderChargeMonthTrack en depend.
  "function renderMonthFillPill(value, month) {",
  "function getChargeCellState(plannedDays, requiredDays) {",
  "function renderChargeMonthTrack(workers, months, chargeByMonth) {",
  "function renderChargeRow(workers, months, timelineWidth, charge) {",
];

// L'extraction elle-meme est la garde : `extractBlock`/`extractLine` font
// `assert.ok` des l'import du fichier (avant le premier test), donc un en-tete
// disparu ou ambigu fait echouer bruyamment tout le fichier — inutile d'y
// consacrer un test nomme separement (cf. tests/postWriteRefresh.test.mjs, qui
// EN a un, mais qui verifie aussi la NON-troncature de blocs multi-lignes bien
// plus longs ; ici chaque bloc tient sur quelques lignes et une troncature
// romprait `node --check` avant meme d'atteindre ce fichier).
const BLOCKS = BLOCK_HEADERS.map(extractBlock);

// --- montage dans un vm, avec les VRAIES dependances pures --------------------

function buildApi() {
  const sandbox = {
    getSegmentEffectiveDays,
    formatNumber,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    [
      CHARGE_EPSILON_LINE,
      ...BLOCKS,
      `globalThis.__api = {
         getChargeCellState,
         renderChargeMonthTrack,
         renderChargeRow,
         formatDayValue,
         computeMonthTotalDays,
       };`,
    ].join("\n\n"),
    context,
    { filename: "chargeBoard.js (extrait)" }
  );
  return context.__api;
}

// --- fixtures ------------------------------------------------------------------

// Un mois avec largement assez de jours ouvres pour ne jamais plafonner les
// effectifs choisis ci-dessous (12/18/8 j) : la capacite reelle du mois n'est
// pas ce qu'on teste ici, on la lit en vrai pour ne pas la deviner a la main.
const MONTH_KEY = "2026-08";
const MONTH_BUSINESS_DAYS = getMonthBusinessDays(MONTH_KEY);

function month(overrides = {}) {
  return { key: MONTH_KEY, widthPx: 100, businessDayCount: MONTH_BUSINESS_DAYS, ...overrides };
}

function worker(name, effectif, monthKey = MONTH_KEY) {
  return { name, segments: [{ monthKey, effectif }] };
}

function chargeByMonth(entries) {
  return new Map(entries);
}

// --- 1. planifie = requis ------------------------------------------------------

test("une cellule ou planifie = requis est verte", () => {
  const api = buildApi();
  assert.ok(MONTH_BUSINESS_DAYS >= 12, "fixture invalide : le mois choisi n'a pas assez de jours ouvres");

  const workers = [worker("Alice", 12)];
  const html = api.renderChargeMonthTrack(workers, [month()], chargeByMonth([[MONTH_KEY, 12]]));

  assert.match(html, /class="charge-plan-month-segment is-balanced"/);
  assert.ok(!html.includes("is-overload"));
  assert.ok(!html.includes("is-partial"));
});

// --- 2. planifie < requis -------------------------------------------------------

test("une cellule ou planifie < requis prend la teinte de surcharge", () => {
  const api = buildApi();
  assert.ok(MONTH_BUSINESS_DAYS >= 18, "fixture invalide : le mois choisi n'a pas assez de jours ouvres");

  const workers = [worker("Alice", 18)];
  const html = api.renderChargeMonthTrack(workers, [month()], chargeByMonth([[MONTH_KEY, 22]]));

  assert.match(html, /class="charge-plan-month-segment is-overload"/);
});

// --- 3. planifie > requis -------------------------------------------------------

test("une cellule ou planifie > requis prend la teinte partielle", () => {
  const api = buildApi();
  assert.ok(MONTH_BUSINESS_DAYS >= 8, "fixture invalide : le mois choisi n'a pas assez de jours ouvres");

  const workers = [worker("Alice", 8)];
  const html = api.renderChargeMonthTrack(workers, [month()], chargeByMonth([[MONTH_KEY, 5]]));

  assert.match(html, /class="charge-plan-month-segment is-partial"/);
});

// --- 3 bis. 0 requis MAIS planifie non nul : partiel, pas neutre ----------------
// getChargeCellState court-circuite en neutre uniquement quand LES DEUX sont a
// 0 : un mois sans charge requise mais avec des jours deja poses (planning
// devance le bareme, ou document non recense) doit rester visible comme un
// exces de planification, pas disparaitre dans le cas neutre.

test("0 requis avec du planifie prend la teinte partielle, pas le neutre", () => {
  const api = buildApi();

  const workers = [worker("Alice", 6)];
  const html = api.renderChargeMonthTrack(workers, [month()], chargeByMonth([]));

  assert.match(html, /class="charge-plan-month-segment is-partial"/);
  assert.ok(!html.includes("is-balanced"));
  assert.ok(!html.includes("is-overload"));
});

// --- 4. 0 requis ET 0 planifie : neutre -----------------------------------------

test("un mois a 0 requis ET 0 planifie reste neutre", () => {
  const api = buildApi();

  const html = api.renderChargeMonthTrack([], [month()], chargeByMonth([]));

  assert.match(html, /class="charge-plan-month-segment\s*"/, "aucune classe d'etat");
  assert.ok(!html.includes("is-balanced"));
  assert.ok(!html.includes("is-overload"));
  assert.ok(!html.includes("is-partial"));
});

// --- 5. tolerance a l'arithmetique flottante ------------------------------------

test("l'egalite tolere l'arithmetique flottante", () => {
  const api = buildApi();
  assert.ok(MONTH_BUSINESS_DAYS >= 12, "fixture invalide : le mois choisi n'a pas assez de jours ouvres");

  // La meme paire testee directement sur getChargeCellState (le coeur de la
  // regle) ET a travers le rendu complet, pour epingler les deux niveaux.
  assert.equal(api.getChargeCellState(12, 12.0000000001), "is-balanced");

  const workers = [worker("Alice", 12)];
  const html = api.renderChargeMonthTrack(workers, [month()], chargeByMonth([[MONTH_KEY, 12.0000000001]]));

  assert.match(html, /class="charge-plan-month-segment is-balanced"/);
  assert.ok(!html.includes("is-overload"), "12 vs 12,0000000001 ne doit pas se lire comme une surcharge");
});

// --- 6. cellule « non place » ---------------------------------------------------

test("la cellule « non place » s'affiche puis se masque a zero", () => {
  const api = buildApi();

  const shown = api.renderChargeRow([], [], 1000, {
    byMonth: chargeByMonth([]),
    unplacedDays: 240,
    totalDays: 240,
    divergences: [],
  });
  assert.match(shown, /charge-plan-charge-unplaced/);
  // Scope au badge lui-meme : un simple /240/ matcherait n'importe ou dans le
  // HTML de la ligne (par ex. une largeur de piste ou un autre nombre qui
  // vaudrait 240 par coincidence), pas forcement le texte du badge.
  assert.match(
    shown,
    /charge-plan-charge-unplaced"[^>]*>[\s\S]*?240/,
    "le nombre de jours non places doit apparaitre DANS le badge"
  );

  // Le badge ne porte QUE la valeur. La cellule de nom fait 220 px FIXES et loge
  // deja le bouton « Charge » ; avec le prefixe « non place : », le badge
  // (`white-space: nowrap`) debordait ou se faisait rogner des que le total
  // atteignait quatre chiffres — l'etat de deploiement attendu, ou les 112
  // lignes COFFRAGE d'un projet sont encore sans dates. Le libelle vit dans
  // l'infobulle, deja survolee (la pastille est en `cursor: help`).
  const badge = shown.match(/<span class="charge-plan-charge-unplaced"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(badge, "badge trouve dans le rendu");
  assert.equal(badge[1].trim(), "240 j", "seule la valeur tient dans le badge");
  assert.match(
    shown,
    /title="Charge non placee : 240 j/,
    "le libelle et la valeur restent lisibles dans l'infobulle"
  );

  const hidden = api.renderChargeRow([], [], 1000, {
    byMonth: chargeByMonth([]),
    unplacedDays: 0,
    totalDays: 0,
    divergences: [],
  });
  assert.ok(!hidden.includes("charge-plan-charge-unplaced"));
});

// --- 7. la ligne se rend meme sans aucune duree renseignee ----------------------

test("la ligne se rend meme sans aucune duree renseignee", () => {
  const api = buildApi();

  // Aucun document charge : documentCharge.computeProjectCharge renverrait
  // exactement cette forme (Map vide, tout a 0).
  const html = api.renderChargeRow([], [], 1000, {
    byMonth: chargeByMonth([]),
    unplacedDays: 0,
    totalDays: 0,
    divergences: [],
  });

  // Sans cette garantie, le bouton « Charge » — seul point d'entree de la
  // fenetre d'assignation (Task 4) — serait tout simplement introuvable.
  assert.match(html, /class="charge-plan-row charge-plan-row--charge"/);
  assert.match(html, /class="charge-plan-charge-btn"[^>]*data-charge-assign-open/);
});
