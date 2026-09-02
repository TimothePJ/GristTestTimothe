// Tests du CHEMIN D'ECRITURE COMPLET du pane bas : le vrai
// `attachChargeEditing()`, la vraie fenetre `createEditSegmentModal()` et le vrai
// `gristService` — seul `window.grist` est bouchonne. On observe donc les actions
// utilisateur Grist reellement emises.
//
// POURQUOI CE FICHIER EXISTE : `gristService.test.mjs` prouve que
// `updateTimeSegment` SAIT ecrire la colonne `Mois`, et `editSegmentModalDom`
// prouve que la fenetre appelle bien son `onSubmit`. Aucun des deux ne regarde ce
// que l'APPELANT demande : `chargeEditing.js` a longtemps omis `monthKey` dans sa
// mise a jour, si bien qu'une ligne legacy (`Start_At` renseigne, `Mois` vide)
// n'etait jamais basculee — la promesse « la premiere re-edition les bascule »
// (spec §12) n'etait tenue nulle part. C'est ce raccord-la qui est epingle ici,
// avec la visibilite de l'echec de suppression.
//
// DOM minimal : uniquement ce que `chargeEditing.js` et `editSegmentModal.js`
// touchent (classList, dataset, closest, querySelector/All, evenements delegues).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HALF_DAY_PARTS, getHalfDaySlotRange } from "../assets/js/utils/timeSegments.js";

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

// Sous-ensemble de selecteurs suffisant pour les deux modules : `#id`, `.classe`,
// `[data-x]` et `[data-x="valeur"]`, eventuellement combines.
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
    this.rect = { left: 0, top: 0, width: 1000, height: 60 };
  }
  append(...nodes) {
    nodes.forEach((node) => {
      node.parent = this;
      this.children.push(node);
    });
    return this;
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
  // sur le board avec `target` positionne sur le noeud reellement clique.
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
class FakeInput extends FakeElement {
  constructor(id) {
    super(id);
    this.value = "";
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
globalThis.HTMLInputElement = FakeInput;
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

// --- Grist bouchonne ---------------------------------------------------------

// Schema realiste d'une table encore porteuse des colonnes legacy : `Start_At` et
// `End_At` existent toujours, `Mois` aussi. C'est exactement l'etat de transition
// decrit par la spec §13.
function legacyTimeSegmentSchema() {
  return {
    id: [],
    NumeroProjet: [],
    Name: [],
    Mois: [],
    Start_At: [],
    End_At: [],
    Allocation_Days: [],
    Effectif: [],
    Label: [],
    Service: [],
  };
}

function installGrist({ failApply = false } = {}) {
  const appliedActions = [];
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    grist: {
      docApi: {
        async fetchTable() {
          return legacyTimeSegmentSchema();
        },
        async applyUserActions(actions) {
          appliedActions.push(...actions);
          if (failApply) {
            throw new Error("ACL Grist : TimeSegment en lecture seule.");
          }
          return { retValues: [1] };
        },
      },
    },
  };
  return appliedActions;
}

// --- montage du board --------------------------------------------------------

const CHARGE_EDITING_URL = new URL("../assets/js/bottom/chargeEditing.js", import.meta.url).href;

function buildModalRoot() {
  const root = new FakeElement("ps-edit-segment-modal");
  root.append(
    new FakeElement("ps-edit-segment-month-label"),
    new FakeElement("ps-edit-segment-worker-label"),
    new FakeInput("ps-edit-segment-effectif"),
    new FakeElement("ps-edit-segment-calculated-days"),
    new FakeElement("ps-edit-segment-feedback"),
    new FakeButton("ps-edit-segment-save"),
    new FakeButton("ps-edit-segment-cancel")
  );
  return root;
}

// Board minimal : une piste, une barre, la barre d'outils Editer, le message
// d'etat et le menu contextuel — la meme charpente que `chargeBoard.render()`.
function buildBoard({ segmentId = "41", monthKey = "2026-09", effectif = "5" } = {}) {
  const board = new FakeElement("ps-charge", { classNames: ["is-segment-editing-enabled"] });
  const track = new FakeElement("", {
    classNames: ["charge-plan-track"],
    dataset: { workerName: "Alice" },
  });
  const bar = new FakeElement("", {
    classNames: ["charge-plan-segment-bar"],
    dataset: { segmentId, monthKey, effectif },
  });
  track.append(bar);

  const toggle = new FakeButton("", {
    classNames: ["charge-plan-edit-mode-toggle"],
    dataset: { chargePlanEditToggle: "segments" },
  });
  const feedback = new FakeElement("", { classNames: ["charge-plan-feedback"] });
  feedback.hidden = true;

  const menu = new FakeElement("", { classNames: ["charge-plan-context-menu"] });
  menu.hidden = true;
  const editAction = new FakeButton("", {
    classNames: ["charge-plan-context-action"],
    dataset: { action: "edit-segment" },
  });
  const deleteAction = new FakeButton("", {
    classNames: ["charge-plan-context-action"],
    dataset: { action: "delete-segment" },
  });
  menu.append(editAction, deleteAction);

  board.append(track, toggle, feedback, menu);
  return { board, track, bar, toggle, feedback, menu, editAction, deleteAction };
}

let freshCounter = 0;

// Laisse tourner la chaine d'await (fenetre -> chargeEditing -> gristService).
const flush = async () => {
  for (let index = 0; index < 25; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const monthTimestamp = (year, monthIndex) =>
  Math.floor(new Date(year, monthIndex, 1).getTime() / 1000);

// --- CORRECTIF 1 : la re-edition d'une ligne legacy bascule bien `Mois` -------

test("re-editer un segment ecrit la colonne Mois (bascule d'une ligne legacy)", async () => {
  const appliedActions = installGrist();
  const modalRoot = buildModalRoot();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const changes = [];

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async () => changes.push("refresh"),
    editSegmentModalEl: modalRoot,
  });

  try {
    // Clic gauche sur la barre du mois : la fenetre s'ouvre en edition.
    dom.board.dispatch("pointerdown", { target: dom.bar, button: 0, clientX: 10 });
    assert.equal(modalRoot.classList.contains("is-open"), true, "la fenetre s'ouvre");

    modalRoot.querySelector("#ps-edit-segment-effectif").value = "8";
    modalRoot.querySelector("#ps-edit-segment-save").dispatch("click");
    await flush();

    const lastAction = appliedActions.at(-1);
    assert.ok(lastAction, "une action Grist a bien ete emise");
    const [actionName, tableName, recordId, fields] = lastAction;
    assert.equal(actionName, "UpdateRecord");
    assert.equal(tableName, "TimeSegment");
    assert.equal(recordId, 41);
    assert.equal(fields.Effectif, 8, "l'effectif saisi est bien enregistre");
    assert.equal(
      fields.Mois,
      monthTimestamp(2026, 8),
      "spec §12 : la premiere re-edition bascule la ligne legacy sur Mois"
    );
    assert.equal(fields.Allocation_Days, 22, "septembre 2026 = 22 jours ouvres");
    assert.equal(changes.length, 1, "le board est rafraichi apres l'ecriture");
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});

test("le mois ecrit est celui de la barre editee, pas un mois fige", async () => {
  const appliedActions = installGrist();
  const modalRoot = buildModalRoot();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "77", monthKey: "2026-02", effectif: "3" });

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async () => {},
    editSegmentModalEl: modalRoot,
  });

  try {
    dom.board.dispatch("pointerdown", { target: dom.bar, button: 0, clientX: 10 });
    modalRoot.querySelector("#ps-edit-segment-effectif").value = "2";
    modalRoot.querySelector("#ps-edit-segment-save").dispatch("click");
    await flush();

    const fields = appliedActions.at(-1)[3];
    assert.equal(fields.Mois, monthTimestamp(2026, 1), "fevrier 2026");
    assert.equal(fields.Allocation_Days, 20, "fevrier 2026 = 20 jours ouvres");
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});

// --- CORRECTIF 2 (contrat partage) : l'effectif est stocke brut --------------

test("un effectif au-dela des jours ouvres est stocke brut, sans ecretage", async () => {
  const appliedActions = installGrist();
  const modalRoot = buildModalRoot();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async () => {},
    editSegmentModalEl: modalRoot,
  });

  try {
    dom.board.dispatch("pointerdown", { target: dom.bar, button: 0, clientX: 10 });
    modalRoot.querySelector("#ps-edit-segment-effectif").value = "30";
    modalRoot.querySelector("#ps-edit-segment-save").dispatch("click");
    await flush();

    assert.equal(
      appliedActions.at(-1)[3].Effectif,
      30,
      "le depassement est rouge non bloquant : la saisie n'est jamais corrigee en base"
    );
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});

// --- CORRECTIF 3 : l'echec de suppression doit etre VISIBLE -----------------
//
// C'etait le seul chemin d'ecriture des deux widgets dont l'echec etait 100 %
// invisible : `void persistWrite(() => removeTimeSegment(id))` jetait la promesse,
// `persistWrite` se contentait d'un `console.error`, `onChanged()` n'etait jamais
// appele — la barre restait affichee a l'identique. Sur une ACL en lecture seule
// ou une coupure reseau, l'utilisateur repartait en croyant le segment supprime.

const DELETE_FAILURE_MESSAGE = "La suppression du segment a echoue.";

function deleteSegmentThroughContextMenu(dom) {
  // Clic droit sur la barre : le menu s'ouvre et porte l'id du segment.
  dom.board.dispatch("contextmenu", { target: dom.bar, clientX: 120, clientY: 60 });
  // Puis « Supprimer le segment ».
  dom.board.dispatch("click", { target: dom.deleteAction });
}

test("l'echec d'une suppression est annonce sur le board", async () => {
  const appliedActions = installGrist({ failApply: true });
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const changes = [];
  const originalError = console.error;
  console.error = () => {};

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async () => changes.push("refresh"),
    editSegmentModalEl: buildModalRoot(),
  });

  try {
    assert.equal(dom.menu.hidden, true, "menu ferme au depart");
    deleteSegmentThroughContextMenu(dom);
    await flush();

    assert.equal(
      appliedActions.at(-1)[0],
      "RemoveRecord",
      "la suppression a bien ete tentee"
    );
    assert.equal(changes.length, 0, "l'echec n'a declenche aucun rafraichissement");
    assert.equal(
      dom.feedback.textContent,
      DELETE_FAILURE_MESSAGE,
      "sans message, l'utilisateur croit le segment supprime alors qu'il ne l'est pas"
    );
    assert.equal(dom.feedback.hidden, false, "le message doit etre affiche, pas juste ecrit");
    assert.equal(
      mod.DELETE_SEGMENT_FAILURE_MESSAGE,
      DELETE_FAILURE_MESSAGE,
      "meme libelle que le jumeau gestion-depenses2 (main.js:1601)"
    );
  } finally {
    console.error = originalError;
    controller.detach();
    delete globalThis.window;
  }
});

test("une suppression reussie n'affiche aucun message d'echec", async () => {
  const appliedActions = installGrist();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const changes = [];

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async () => changes.push("refresh"),
    editSegmentModalEl: buildModalRoot(),
  });

  try {
    deleteSegmentThroughContextMenu(dom);
    await flush();

    assert.equal(appliedActions.at(-1)[0], "RemoveRecord");
    assert.equal(changes.length, 1, "le board est rafraichi");
    assert.equal(dom.feedback.textContent, "", "aucun message parasite");
    assert.equal(dom.feedback.hidden, true);
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});

test("un message d'echec est retire des la tentative d'ecriture suivante", async () => {
  const appliedActions = installGrist({ failApply: true });
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const originalError = console.error;
  console.error = () => {};

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async () => {},
    editSegmentModalEl: buildModalRoot(),
  });

  try {
    deleteSegmentThroughContextMenu(dom);
    await flush();
    assert.equal(dom.feedback.textContent, DELETE_FAILURE_MESSAGE);

    // Grist redevient joignable : la tentative suivante ne doit pas laisser
    // trainer le message perime.
    globalThis.window.grist.docApi.applyUserActions = async (actions) => {
      appliedActions.push(...actions);
      return { retValues: [1] };
    };
    deleteSegmentThroughContextMenu(dom);
    await flush();

    assert.equal(dom.feedback.textContent, "", "message perime retire");
    assert.equal(dom.feedback.hidden, true);
  } finally {
    console.error = originalError;
    controller.detach();
    delete globalThis.window;
  }
});

// Le DOM de test ci-dessus est fabrique a la main : sans cette garde, retirer
// l'element de la vraie charpente du board laisserait la suite verte alors que
// `setBoardFeedback` n'aurait plus rien a ecrire en production.
test("le board rend bien l'element de message que chargeEditing alimente", () => {
  const boardSource = fs.readFileSync(
    new URL("../assets/js/bottom/chargeBoard.js", import.meta.url),
    "utf8"
  );
  assert.match(
    boardSource,
    /class="charge-plan-feedback"/,
    "chargeBoard doit rendre .charge-plan-feedback (comme le jumeau gestion-depenses2)"
  );
});

// --- CORRECTIF 4 : ce que l’ecriture ANNONCE a l’appelant --------------------
//
// Depuis la suppression du rechargement complet apres chaque ecriture, main.js
// n’a plus le droit de re-interroger Grist pour savoir ce qui a change : c’est
// l’ecriture elle-meme qui doit le decrire. Sans ce contrat, la mise a jour
// locale ne saurait ni quelle ligne toucher, ni avec quelles valeurs.

function buildSlotsForBoard(startIso, endIso, dayWidth = 10) {
  const [startYear, startMonth, startDay] = startIso.split("-").map(Number);
  const [endYear, endMonth, endDay] = endIso.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, startDay);
  const last = new Date(endYear, endMonth - 1, endDay);
  const slots = [];
  let dayIndex = 0;

  while (cursor <= last) {
    HALF_DAY_PARTS.forEach((part, partIndex) => {
      const range = getHalfDaySlotRange(cursor, part);
      slots.push({
        slotIndex: slots.length,
        part,
        isWorkingDay: true,
        leftPx: dayIndex * dayWidth + (partIndex * dayWidth) / 2,
        widthPx: dayWidth / 2,
        startAt: range.startAt,
        endAt: range.endAt,
      });
    });
    cursor.setDate(cursor.getDate() + 1);
    dayIndex += 1;
  }

  return slots;
}

test("une mise a jour annonce a l’appelant la ligne et les valeurs ecrites", async () => {
  installGrist();
  const modalRoot = buildModalRoot();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const changes = [];

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async (change) => changes.push(change),
    editSegmentModalEl: modalRoot,
  });

  try {
    dom.board.dispatch("pointerdown", { target: dom.bar, button: 0, clientX: 10 });
    modalRoot.querySelector("#ps-edit-segment-effectif").value = "8";
    modalRoot.querySelector("#ps-edit-segment-save").dispatch("click");
    await flush();

    assert.deepEqual(changes, [
      { type: "update", segmentId: 41, monthKey: "2026-09", workerName: "Alice", effectif: 8 },
    ]);
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});

test("une creation annonce l’id Grist du nouvel enregistrement", async () => {
  installGrist();
  const modalRoot = buildModalRoot();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const changes = [];

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => buildSlotsForBoard("2026-09-01", "2026-10-31"),
    onChanged: async (change) => changes.push(change),
    editSegmentModalEl: modalRoot,
  });

  try {
    // Clic dans le vide d’octobre (aucune barre) : la fenetre s’ouvre en creation.
    dom.board.dispatch("pointerdown", { target: dom.track, button: 0, clientX: 420 });
    assert.equal(modalRoot.classList.contains("is-open"), true, "la fenetre s’ouvre");

    modalRoot.querySelector("#ps-edit-segment-effectif").value = "4";
    modalRoot.querySelector("#ps-edit-segment-save").dispatch("click");
    await flush();

    assert.deepEqual(changes, [
      { type: "create", segmentId: 1, monthKey: "2026-10", workerName: "Alice", effectif: 4 },
    ], "sans l’id renvoye par Grist, la barre creee ne serait pas editable");
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});

test("une suppression annonce la ligne retiree", async () => {
  installGrist();
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const dom = buildBoard({ segmentId: "41", monthKey: "2026-09", effectif: "5" });
  const changes = [];

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => "25-0142",
    getVisibleSlots: () => [],
    onChanged: async (change) => changes.push(change),
    editSegmentModalEl: buildModalRoot(),
  });

  try {
    deleteSegmentThroughContextMenu(dom);
    await flush();

    assert.deepEqual(changes, [{ type: "delete", segmentId: 41 }]);
  } finally {
    controller.detach();
    delete globalThis.window;
  }
});
