// Tests du SURLIGNAGE DU MOIS SURVOLE : le vrai `attachChargeEditing()` est
// pilote par de vrais gestes (pointermove/pointerleave/clic Editer) sur un DOM
// minimal, comme tests/chargeEditingWrites.test.mjs.
//
// POURQUOI CE FICHIER EXISTE : depuis le passage a « un segment = un mois », un
// clic n'importe ou sur une piste vise le MOIS entier. Sans surlignage,
// l'utilisateur ne voit pas quel mois son clic va viser — le jumeau
// gestion-depenses2 eclaire ce mois, planning-synchro n'avait ni le JS ni le CSS.
//
// Les trois invariants epingles ici :
//   1. le surlignage n'apparait QU'EN mode Editer ;
//   2. il n'apparait JAMAIS sur la piste Total (.charge-plan-track--readonly) ;
//   3. il ne rebalaye pas les creneaux tant que le curseur reste dans le meme
//      mois (ce gestionnaire passe a chaque mouvement de souris).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HALF_DAY_PARTS, getHalfDaySlotRange, createHalfDaySlotKey } from "../assets/js/utils/timeSegments.js";

// --- DOM minimal -------------------------------------------------------------

class FakeClassList {
  constructor(initial = []) {
    this.names = new Set(initial);
  }
  add(name) {
    this.names.add(name);
  }
  remove(name) {
    this.names.delete(name);
  }
  contains(name) {
    return this.names.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.names.has(name) : Boolean(force);
    if (on) this.names.add(name);
    else this.names.delete(name);
    return on;
  }
}

// "data-month-key" -> "monthKey"
function datasetKey(attributeName) {
  return String(attributeName)
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  const parts = String(selector).trim().match(/#[-\w]+|\.[-\w]+|\[[^\]]+\]/g) || [];
  if (!parts.length) return false;

  return parts.every((part) => {
    if (part.startsWith("#")) return element.id === part.slice(1);
    if (part.startsWith(".")) return element.classList.contains(part.slice(1));

    const inner = part.slice(1, -1);
    const equalsAt = inner.indexOf("=");
    const key = datasetKey(equalsAt >= 0 ? inner.slice(0, equalsAt) : inner);
    if (equalsAt < 0) return element.dataset[key] !== undefined;

    const expected = inner.slice(equalsAt + 1).replace(/^["']|["']$/g, "");
    return String(element.dataset[key]) === expected;
  });
}

class FakeElement {
  constructor(id = "", { classNames = [], dataset = {} } = {}) {
    this.id = id;
    this.textContent = "";
    this.hidden = false;
    this.style = {};
    this.classList = new FakeClassList(classNames);
    this.dataset = { ...dataset };
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.rect = { left: 0, top: 0, width: 1000, height: 72 };
  }
  get parentElement() {
    return this.parent;
  }
  append(...nodes) {
    nodes.forEach((node) => {
      node.parent = this;
      this.children.push(node);
    });
    return this;
  }
  replaceChild(nextNode, previousNode) {
    const index = this.children.indexOf(previousNode);
    if (index < 0) return;
    previousNode.parent = null;
    nextNode.parent = this;
    this.children[index] = nextNode;
  }
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelector(selector) {
    return this.descendants().find((node) => matchesSelector(node, selector)) || null;
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => matchesSelector(node, selector));
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSelector(node, selector)) return node;
      node = node.parent;
    }
    return null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const bucket = this.listeners.get(type) || [];
    const index = bucket.indexOf(fn);
    if (index >= 0) bucket.splice(index, 1);
  }
  // Les ecouteurs de chargeEditing sont DELEGUES sur le board : on declenche donc
  // sur le board avec `target` positionne sur le noeud reellement survole.
  dispatch(type, event = {}) {
    (this.listeners.get(type) || [])
      .slice()
      .forEach((fn) => fn({ preventDefault() {}, target: this, ...event }));
  }
  setAttribute(name, value) {
    this[name] = String(value);
  }
  removeAttribute(name) {
    delete this[name];
  }
}
class FakeButton extends FakeElement {
  constructor(id, options) {
    super(id, options);
    this.disabled = false;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;
globalThis.HTMLButtonElement = FakeButton;

const documentListeners = new Map();
globalThis.document = {
  addEventListener(type, fn) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const bucket = documentListeners.get(type) || [];
    const index = bucket.indexOf(fn);
    if (index >= 0) bucket.splice(index, 1);
  },
};
globalThis.window = { innerWidth: 1280, innerHeight: 800 };

// --- creneaux (memes objets que createChargeBoard().getVisibleSlots()) --------

const DAY_WIDTH_PX = 10;

function buildSlots(startIso, endIso, dayWidth = DAY_WIDTH_PX) {
  const [startYear, startMonth, startDay] = startIso.split("-").map(Number);
  const [endYear, endMonth, endDay] = endIso.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, startDay);
  const last = new Date(endYear, endMonth - 1, endDay);
  const halfDayWidth = dayWidth / 2;
  const slots = [];
  let dayIndex = 0;

  while (cursor <= last) {
    HALF_DAY_PARTS.forEach((part, partIndex) => {
      const range = getHalfDaySlotRange(cursor, part);
      slots.push({
        key: createHalfDaySlotKey(cursor, part),
        slotIndex: slots.length,
        part,
        isWorkingDay: true,
        leftPx: dayIndex * dayWidth + partIndex * halfDayWidth,
        widthPx: halfDayWidth,
        startAt: range.startAt,
        endAt: range.endAt,
      });
    });
    cursor.setDate(cursor.getDate() + 1);
    dayIndex += 1;
  }

  return slots;
}

// Septembre (30 j) puis octobre (31 j) 2026 : septembre occupe [0 .. 300[ px,
// octobre [300 .. 610[ px.
const SEPTEMBER_LEFT_PX = 0;
const SEPTEMBER_WIDTH_PX = 300;
const OCTOBER_LEFT_PX = 300;
const OCTOBER_WIDTH_PX = 310;

function newHoverEl() {
  const hoverEl = new FakeElement("", { classNames: ["charge-plan-month-hover"] });
  hoverEl.hidden = true;
  return hoverEl;
}

// Board minimal : une piste editable (avec son element de surlignage), la piste
// Total en lecture seule, le bouton Editer et le menu contextuel — la meme
// charpente que `chargeBoard.render()`.
function buildBoard({ editMode = true } = {}) {
  const board = new FakeElement("ps-charge", {
    classNames: ["charge-plan-board", editMode ? "is-segment-editing-enabled" : "is-segment-editing-locked"],
  });

  const track = new FakeElement("", {
    classNames: ["charge-plan-track"],
    dataset: { workerName: "Alice" },
  });
  const hoverEl = newHoverEl();
  const bar = new FakeElement("", {
    classNames: ["charge-plan-segment-bar"],
    dataset: { segmentId: "41", monthKey: "2026-09", effectif: "5" },
  });
  track.append(hoverEl, bar);

  // Piste Total : en lecture seule. Elle porte ici un element de surlignage
  // qu'elle n'a PAS en production — pour prouver que le gestionnaire l'ignore
  // meme quand il en trouve un.
  const totalTrack = new FakeElement("", {
    classNames: ["charge-plan-track", "charge-plan-track--readonly"],
  });
  const totalHoverEl = newHoverEl();
  totalTrack.append(totalHoverEl);

  const toggle = new FakeButton("", {
    classNames: ["charge-plan-edit-mode-toggle"],
    dataset: { chargePlanEditToggle: "segments" },
  });
  const menu = new FakeElement("", { classNames: ["charge-plan-context-menu"] });
  menu.hidden = true;

  board.append(track, totalTrack, toggle, menu);
  return { board, track, hoverEl, bar, totalTrack, totalHoverEl, toggle };
}

const CHARGE_EDITING_URL = new URL("../assets/js/bottom/chargeEditing.js", import.meta.url).href;
let freshCounter = 0;

async function mount(options = {}) {
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?hover=${freshCounter}`);
  const dom = buildBoard(options);
  const slots = buildSlots("2026-09-01", "2026-10-31");
  let slotReads = 0;
  let slotsAccessor = () => {
    slotReads += 1;
    return slots;
  };

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => slotsAccessor(),
    onChanged: async () => {},
  });

  return {
    mod,
    dom,
    slots,
    controller,
    getSlotReads: () => slotReads,
    setSlotsAccessor: (fn) => {
      slotsAccessor = fn;
    },
  };
}

// --- 1. le surlignage suit le mois sous le curseur, en mode Editer -----------

test("le mois sous le curseur s'eclaire en mode Editer", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });

    assert.equal(ctx.dom.hoverEl.hidden, false, "le surlignage doit etre visible");
    assert.equal(ctx.dom.hoverEl.style.left, `${SEPTEMBER_LEFT_PX}px`);
    assert.equal(ctx.dom.hoverEl.style.width, `${SEPTEMBER_WIDTH_PX}px`);
  } finally {
    ctx.controller.detach();
  }
});

test("passer au mois suivant deplace le surlignage sur ce mois", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 420 });

    assert.equal(ctx.dom.hoverEl.style.left, `${OCTOBER_LEFT_PX}px`);
    assert.equal(ctx.dom.hoverEl.style.width, `${OCTOBER_WIDTH_PX}px`);
  } finally {
    ctx.controller.detach();
  }
});

// --- 2. jamais hors du mode Editer ------------------------------------------

test("aucun surlignage tant que le mode Editer n'est pas actif", async () => {
  const ctx = await mount({ editMode: false });
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });

    assert.equal(ctx.dom.hoverEl.hidden, true, "le mode verrouille ne surligne rien");
    assert.equal(ctx.dom.hoverEl.style.left, undefined);
  } finally {
    ctx.controller.detach();
  }
});

test("verrouiller le mode Editer efface le surlignage en place", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });
    assert.equal(ctx.dom.hoverEl.hidden, false);

    ctx.dom.board.dispatch("click", { target: ctx.dom.toggle });

    assert.equal(ctx.dom.hoverEl.hidden, true, "le surlignage ne doit pas survivre au verrouillage");
  } finally {
    ctx.controller.detach();
  }
});

// --- 3. jamais sur la piste Total (lecture seule) ----------------------------

test("la piste Total en lecture seule n'est jamais surlignee", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.totalTrack, clientX: 45 });

    assert.equal(ctx.dom.totalHoverEl.hidden, true, "Total est en lecture seule : rien a viser");
    assert.equal(ctx.dom.hoverEl.hidden, true, "aucune autre piste ne doit s'allumer non plus");
  } finally {
    ctx.controller.detach();
  }
});

test("survoler une autre piste eteint le surlignage de la precedente", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });
    assert.equal(ctx.dom.hoverEl.hidden, false);

    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.totalTrack, clientX: 45 });

    assert.equal(ctx.dom.hoverEl.hidden, true, "une seule piste surlignee a la fois");
  } finally {
    ctx.controller.detach();
  }
});

// --- 4. court-circuit : pas de rebalayage des creneaux dans le meme mois -----

test("rester dans le meme mois ne rebalaye pas les creneaux", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });
    const readsAfterFirstMove = ctx.getSlotReads();
    assert.ok(readsAfterFirstMove > 0, "le premier mouvement doit bien balayer les creneaux");

    // Ce gestionnaire passe a chaque mouvement de souris : rebalayer les ~120
    // creneaux a chaque pixel ferait ramer le pane bas.
    ctx.setSlotsAccessor(() => {
      throw new Error("les creneaux ne doivent pas etre relus dans le meme mois");
    });
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 46 });
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 299 });

    assert.equal(ctx.getSlotReads(), readsAfterFirstMove, "aucun rebalayage supplementaire");
    assert.equal(ctx.dom.hoverEl.style.left, `${SEPTEMBER_LEFT_PX}px`, "le surlignage reste sur septembre");
  } finally {
    ctx.controller.detach();
  }
});

// --- 5. sortie du board ------------------------------------------------------

test("quitter le plan de charge efface le surlignage", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });
    assert.equal(ctx.dom.hoverEl.hidden, false);

    ctx.dom.board.dispatch("pointerleave", { target: ctx.dom.board });

    assert.equal(ctx.dom.hoverEl.hidden, true);
  } finally {
    ctx.controller.detach();
  }
});

// --- 6. survie aux reconstructions du pane bas -------------------------------
//
// `chargeBoard.render()` remplace le HTML du board d'un bloc (et le fait ~8x/s
// pendant un zoom/pan, throttle). Les ecouteurs sont delegues sur le board, donc
// ils survivent ; l'element de surlignage, lui, est neuf et vierge : le mouvement
// suivant doit le recalculer au lieu de se fier a un cache perime.

test("le surlignage se reapplique apres une reconstruction du board", async () => {
  const ctx = await mount();
  try {
    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });
    assert.equal(ctx.dom.hoverEl.hidden, false);

    // Reconstruction : nouvel element de surlignage, cache vide.
    const rebuiltHoverEl = newHoverEl();
    ctx.dom.track.replaceChild(rebuiltHoverEl, ctx.dom.hoverEl);

    ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });

    assert.equal(rebuiltHoverEl.hidden, false, "le nouvel element doit etre surligne");
    assert.equal(rebuiltHoverEl.style.left, `${SEPTEMBER_LEFT_PX}px`);
    assert.equal(rebuiltHoverEl.style.width, `${SEPTEMBER_WIDTH_PX}px`);
  } finally {
    ctx.controller.detach();
  }
});

test("detach() retire l'ecouteur de survol", async () => {
  const ctx = await mount();
  ctx.controller.detach();

  ctx.dom.board.dispatch("pointermove", { target: ctx.dom.track, clientX: 45 });

  assert.equal(ctx.dom.hoverEl.hidden, true, "plus aucun surlignage apres detach()");
});

// --- 7. gardes structurelles -------------------------------------------------
//
// Le DOM ci-dessus est fabrique a la main : sans ces gardes, retirer l'element de
// la vraie charpente du board (ou la regle CSS) laisserait la suite verte alors
// que rien ne serait visible en production.

test("chargeBoard rend l'element de surlignage dans les pistes editables, jamais dans Total", () => {
  const boardSource = fs.readFileSync(
    new URL("../assets/js/bottom/chargeBoard.js", import.meta.url),
    "utf8"
  );

  assert.match(
    boardSource,
    /class="charge-plan-month-hover"/,
    "renderWorkerRow doit rendre .charge-plan-month-hover (comme le jumeau gestion-depenses2)"
  );

  const totalRowStart = boardSource.indexOf("function renderTotalRow");
  const totalRowSource = boardSource.slice(
    totalRowStart,
    boardSource.indexOf("function renderTimelineEditToolbar", totalRowStart)
  );
  assert.ok(totalRowSource.length > 0, "renderTotalRow doit rester reperable dans la source");
  assert.ok(
    !totalRowSource.includes("charge-plan-month-hover"),
    "la piste Total est en lecture seule : elle ne doit pas porter d'element de surlignage"
  );
});

test("la feuille de style definit le surlignage du mois", () => {
  const cssSource = fs.readFileSync(new URL("../assets/css/styles.css", import.meta.url), "utf8");
  assert.match(
    cssSource,
    /\.charge-plan-month-hover\s*\{/,
    "sans regle CSS, l'element existe mais reste invisible"
  );
});
