// Barre de charge mensuelle de la fenetre segment (#ps-edit-segment-load).
//
// Ce fichier pilote la CHAINE REELLE, pas une reimplementation : le vrai
// `attachChargeEditing()` (qui transmet l'accesseur), la vraie fenetre
// `createEditSegmentModal()` (qui rend la barre) et le vrai module vendorise
// `utils/monthLoad.js` (qui calcule). Seuls le DOM et `window.grist` sont faux.
//
// POURQUOI CE FICHIER EXISTE : `monthLoad.test.mjs` prouve que le CALCUL est
// juste ; il ne dit rien du CABLAGE. Or c'est le cablage qui porte les defauts
// couteux — des lignes filtrees par projet (la barre montrerait une
// disponibilite qui n'existe pas), un `excludeSegmentId` oublie (l'effectif
// stocke compte EN PLUS de la saisie), une barre qui ne suit pas la frappe.
// C'est exactement ce que ce fichier epingle.
//
// Mois de reference : NOVEMBRE 2026 = 20 jours ouvres (11 novembre ferie), soit
// l'exemple litteral de la specification (20 j disponibles, 5 j ailleurs,
// saisie 8 j -> 13 j / 20 j, il reste 7 j).
//
// ISOLATION : le verrou et la session de `editSegmentModal.js` sont des
// singletons de module ; chaque scenario reimporte donc `chargeEditing.js` avec
// une URL differente pour repartir d'un etat neuf.

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM minimal (meme charpente que chargeEditingWrites.test.mjs) -----------

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
    this.attributes = {};
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
  dispatch(type, event = {}) {
    (this.listeners.get(type) || [])
      .slice()
      .forEach((fn) => fn({ preventDefault() {}, target: this, ...event }));
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }
  removeAttribute(name) {
    delete this[name];
    delete this.attributes[name];
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
globalThis.window = { innerWidth: 1280, innerHeight: 800 };

// --- montage : board + fenetre, cables par le VRAI attachChargeEditing -------

const CHARGE_EDITING_URL = new URL("../assets/js/bottom/chargeEditing.js", import.meta.url).href;

const MONTH = "2026-11"; // 20 jours ouvres (11 novembre ferie)
const AVAILABLE_DAYS = 20;
const BOARD_PROJECT = "25-0142";

function buildModalRoot() {
  const root = new FakeElement("ps-edit-segment-modal");
  const load = new FakeElement("ps-edit-segment-load");
  load.hidden = true;
  load.append(
    new FakeElement("ps-edit-segment-load-days"),
    new FakeElement("ps-edit-segment-load-track").append(
      new FakeElement("ps-edit-segment-load-fill")
    ),
    new FakeElement("ps-edit-segment-load-message")
  );
  root.append(
    new FakeElement("ps-edit-segment-month-label"),
    new FakeElement("ps-edit-segment-worker-label"),
    new FakeInput("ps-edit-segment-effectif"),
    new FakeElement("ps-edit-segment-calculated-days"),
    load,
    new FakeElement("ps-edit-segment-feedback"),
    new FakeButton("ps-edit-segment-save"),
    new FakeButton("ps-edit-segment-cancel")
  );
  return root;
}

// Board minimal : une piste « Marie Dupont », une barre sur le mois de reference.
function buildBoard({ segmentId = "42", monthKey = MONTH, effectif = "6" } = {}) {
  const board = new FakeElement("ps-charge", { classNames: ["is-segment-editing-enabled"] });
  const track = new FakeElement("", {
    classNames: ["charge-plan-track"],
    dataset: { workerName: "Marie Dupont" },
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

  board.append(track, toggle, feedback, menu);
  return { board, track, bar };
}

let freshCounter = 0;

// Monte la chaine complete et rend de quoi la piloter/observer.
async function mountChain({
  allSegmentRows = [],
  segmentId = "42",
  effectif = "6",
  absenceSet = null,
  withAccessor = true,
} = {}) {
  freshCounter += 1;
  const mod = await import(`${CHARGE_EDITING_URL}?fresh=${freshCounter}`);
  const modalRoot = buildModalRoot();
  const dom = buildBoard({ segmentId, effectif });
  // Une reference MUTABLE : c'est tout l'interet de l'accesseur — un
  // rechargement (onChanged) doit se voir dans la barre sans re-cabler la fenetre.
  let rows = allSegmentRows;

  const controller = mod.attachChargeEditing(dom.board, {
    getProjectNumber: () => BOARD_PROJECT,
    getVisibleSlots: () => [],
    onChanged: async () => {},
    editSegmentModalEl: modalRoot,
    getAbsenceSet: () => (absenceSet instanceof Set ? absenceSet : new Set()),
    ...(withAccessor ? { getAllTimeSegmentRows: () => rows } : {}),
  });

  const el = (id) => modalRoot.querySelector(`#${id}`);
  return {
    controller,
    modalRoot,
    dom,
    setRows: (next) => {
      rows = next;
    },
    input: () => el("ps-edit-segment-effectif"),
    loadRoot: () => el("ps-edit-segment-load"),
    loadFill: () => el("ps-edit-segment-load-fill"),
    loadTrack: () => el("ps-edit-segment-load-track"),
    loadDays: () => el("ps-edit-segment-load-days"),
    loadMessage: () => el("ps-edit-segment-load-message"),
    // Clic gauche sur la barre : la fenetre s'ouvre en edition du segment.
    openFromBar: () => dom.board.dispatch("pointerdown", { target: dom.bar, button: 0, clientX: 10 }),
    // Clic dans le vide de la piste sur un mois libre : ouverture en CREATION.
    type: (value) => {
      el("ps-edit-segment-effectif").value = value;
      el("ps-edit-segment-effectif").dispatch("input");
    },
    state: () => {
      const root = el("ps-edit-segment-load");
      if (root.classList.contains("is-overload")) return "overload";
      if (root.classList.contains("is-balanced")) return "balanced";
      if (root.classList.contains("is-partial")) return "partial";
      return "";
    },
  };
}

// Ligne TimeSegment telle qu'elle sort de Grist (colonne `Mois` en timestamp).
const monthTimestamp = (year, monthIndex) =>
  Math.floor(new Date(year, monthIndex, 1).getTime() / 1000);

function row(id, name, effectif, extra = {}) {
  return {
    id,
    Name: name,
    Effectif: effectif,
    Mois: monthTimestamp(2026, 10), // novembre 2026
    NumeroProjet: BOARD_PROJECT,
    Service: "Structure",
    ...extra,
  };
}

// --- les trois etats ---------------------------------------------------------

test("etat PARTIELLE : 5 j ailleurs + 8 j saisis = 13 j / 20 j, il reste 7 j", async () => {
  const h = await mountChain({
    // Segment edite (42) a 6 j stockes + 5 j sur un AUTRE projet.
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009", Service: "Fluides" }),
    ],
  });
  try {
    h.openFromBar();
    h.type("8");

    assert.equal(h.loadRoot().hidden, false, "la barre est visible");
    assert.equal(h.loadDays().textContent, `13 j / ${AVAILABLE_DAYS} j`);
    assert.equal(h.loadMessage().textContent, "il reste 7 j avant 100 %");
    assert.equal(h.state(), "partial");
    assert.equal(h.loadFill().style.width, "65%");
    assert.equal(h.loadTrack().getAttribute("aria-valuenow"), "65");
  } finally {
    h.controller.detach();
  }
});

test("etat PLEINE : 20 j / 20 j, charge complete, remplissage a 100 %", async () => {
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" }),
    ],
  });
  try {
    h.openFromBar();
    h.type("15");

    assert.equal(h.loadDays().textContent, "20 j / 20 j");
    assert.equal(h.loadMessage().textContent, "charge complete");
    assert.equal(h.state(), "balanced");
    assert.equal(h.loadFill().style.width, "100%");
  } finally {
    h.controller.detach();
  }
});

test("etat SURCHARGE : 25 j / 20 j, 5 j de trop, remplissage sature a 100 %", async () => {
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" }),
    ],
  });
  try {
    h.openFromBar();
    h.type("20");

    assert.equal(h.loadDays().textContent, "25 j / 20 j");
    assert.equal(h.loadMessage().textContent, "SURCHARGE : 5 j de trop");
    assert.equal(h.state(), "overload");
    assert.equal(
      h.loadFill().style.width,
      "100%",
      "sature : une largeur de 125 % deborderait du conteneur"
    );
    assert.equal(h.loadTrack().getAttribute("aria-valuenow"), "100");
  } finally {
    h.controller.detach();
  }
});

// --- recalcul en direct ------------------------------------------------------

test("la barre suit la frappe, chiffre par chiffre", async () => {
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" }),
    ],
  });
  try {
    h.openFromBar();

    h.type("1");
    assert.equal(h.loadDays().textContent, "6 j / 20 j", "5 j ailleurs + 1 j saisi");
    assert.equal(h.state(), "partial");

    h.type("18");
    assert.equal(h.loadDays().textContent, "23 j / 20 j");
    assert.equal(h.state(), "overload", "la surcharge apparait sans rien valider");

    h.type("");
    assert.equal(h.loadDays().textContent, "5 j / 20 j", "champ vide = 0 j saisi");
    assert.equal(h.loadMessage().textContent, "il reste 15 j avant 100 %");
    assert.equal(h.state(), "partial");
  } finally {
    h.controller.detach();
  }
});

test("la barre est rendue des l'ouverture, avant toute frappe", async () => {
  const h = await mountChain({
    // La fenetre s'ouvre avec l'effectif STOCKE du segment (6 j) prerempli.
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" }),
    ],
  });
  try {
    h.openFromBar();
    assert.equal(h.loadRoot().hidden, false);
    assert.equal(h.loadDays().textContent, "11 j / 20 j", "5 j ailleurs + les 6 j preremplis");
  } finally {
    h.controller.detach();
  }
});

// --- exclusion du segment edite ---------------------------------------------

test("edition : l'effectif deja stocke n'est PAS compte en plus de la saisie", async () => {
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6), // le segment ouvert : 6 j deja en base
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" }),
    ],
  });
  try {
    h.openFromBar();
    h.type("8");

    assert.equal(
      h.loadDays().textContent,
      "13 j / 20 j",
      "sans excludeSegmentId la barre afficherait 19 j (6 stockes + 5 ailleurs + 8 saisis)"
    );
  } finally {
    h.controller.detach();
  }
});

test("creation : rien a exclure, tout ce qui existe s'ajoute a la saisie", async () => {
  // Le mois clique est LIBRE (aucune barre) : resolveSegmentClickIntent renvoie
  // « create », donc segmentId null et aucune ligne n'est ecartee.
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" }),
    ],
    segmentId: "", // barre sans id Grist exploitable -> le clic cree
  });
  try {
    h.openFromBar();
    h.type("8");

    assert.equal(h.loadDays().textContent, "19 j / 20 j", "6 + 5 + 8, rien n'est exclu");
    assert.equal(h.state(), "partial");
  } finally {
    h.controller.detach();
  }
});

// --- la barre voit bien les AUTRES projets / services ------------------------

test("la barre compte les segments d'autres projets ET d'autres services", async () => {
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(80, "Marie Dupont", 4, { NumeroProjet: "24-0009", Service: "Fluides" }),
      row(81, "Marie Dupont", 3, { NumeroProjet: "23-0500", Service: "Methodes" }),
    ],
  });
  try {
    h.openFromBar();
    h.type("2");

    assert.equal(
      h.loadDays().textContent,
      "9 j / 20 j",
      "4 j (Fluides, autre projet) + 3 j (Methodes, autre projet) + 2 j saisis"
    );
  } finally {
    h.controller.detach();
  }
});

test("une autre personne et un autre mois n'entrent pas dans la barre", async () => {
  const h = await mountChain({
    allSegmentRows: [
      row(42, "Marie Dupont", 6),
      row(90, "Paul Durand", 12, { NumeroProjet: "24-0009" }),
      row(91, "Marie Dupont", 9, { Mois: monthTimestamp(2026, 11) }), // decembre
    ],
  });
  try {
    h.openFromBar();
    h.type("4");

    assert.equal(h.loadDays().textContent, "4 j / 20 j", "seule la saisie compte");
  } finally {
    h.controller.detach();
  }
});

// --- disponibilite et cas limites -------------------------------------------

test("les absences reduisent le disponible affiche par la barre", async () => {
  // Deux jours ouvres poses (les 2 et 3 novembre 2026, lundi et mardi).
  const absenceSet = new Set([
    "2026-11-02:am",
    "2026-11-02:pm",
    "2026-11-03:am",
    "2026-11-03:pm",
  ]);
  const h = await mountChain({
    allSegmentRows: [row(42, "Marie Dupont", 6)],
    absenceSet,
  });
  try {
    h.openFromBar();
    h.type("18");

    assert.equal(h.loadDays().textContent, "18 j / 18 j", "20 - 2 jours poses");
    assert.equal(h.state(), "balanced");
    assert.equal(h.loadMessage().textContent, "charge complete");
  } finally {
    h.controller.detach();
  }
});

test("fermer la fenetre efface la barre au lieu de laisser des chiffres perimes", async () => {
  const h = await mountChain({
    allSegmentRows: [row(42, "Marie Dupont", 6), row(77, "Marie Dupont", 5)],
  });
  try {
    h.openFromBar();
    h.type("8");
    assert.equal(h.loadRoot().hidden, false);

    h.modalRoot.querySelector("#ps-edit-segment-cancel").dispatch("click");

    assert.equal(h.loadRoot().hidden, true, "barre masquee");
    assert.equal(h.state(), "", "aucune classe d'etat residuelle");
    assert.equal(h.loadFill().style.width, "0%");
    assert.equal(h.loadDays().textContent, "--");
    assert.equal(h.loadMessage().textContent, "");
  } finally {
    h.controller.detach();
  }
});

test("sans accesseur (option absente) la fenetre fonctionne toujours", async () => {
  const h = await mountChain({ withAccessor: false });
  try {
    h.openFromBar();
    h.type("8");

    assert.equal(h.loadDays().textContent, "8 j / 20 j", "seule la saisie est connue");
    assert.equal(h.state(), "partial");
  } finally {
    h.controller.detach();
  }
});

test("un rechargement des lignes se voit a la reouverture (accesseur, pas instantane fige)", async () => {
  const h = await mountChain({ allSegmentRows: [row(42, "Marie Dupont", 6)] });
  try {
    h.openFromBar();
    h.type("4");
    assert.equal(h.loadDays().textContent, "4 j / 20 j");

    h.modalRoot.querySelector("#ps-edit-segment-cancel").dispatch("click");
    // onChanged a rechargé la table : une ligne est apparue sur un autre projet.
    h.setRows([row(42, "Marie Dupont", 6), row(77, "Marie Dupont", 5, { NumeroProjet: "24-0009" })]);

    h.openFromBar();
    h.type("4");
    assert.equal(h.loadDays().textContent, "9 j / 20 j", "la barre lit les lignes FRAICHES");
  } finally {
    h.controller.detach();
  }
});

// --- circulation des donnees : les deux chemins de main.js -------------------
//
// La barre lit ce que main.js lui donne — au chargement, apres une ecriture
// locale, et apres un rafraichissement declenche par un autre widget. Ce cablage
// etait epingle ici par des expressions regulieres sur le TEXTE de main.js : une
// simple reecriture (`allTimeSegmentRows = ...` devenu `const nextAllRows = ...`)
// les faisait tomber sans qu'aucun comportement ait change, et inversement un
// renommage bien choisi les aurait satisfaites sans rien alimenter du tout.
//
// Ces trois chemins sont desormais EXECUTES, sur le vrai `loadProject`, dans
// tests/postWriteRefresh.test.mjs (« la fenetre voit ... »).

// --- BOUT EN BOUT : Grist -> fetchProjectData -> la barre --------------------
//
// LE test du bug « Charge du mois — tous projets ne prend pas tous les projets en
// compte ». Tous les tests ci-dessus donnent les lignes a la main : ils ne
// pouvaient donc pas voir que la LECTURE, elle, n en ramenait qu un seul projet.
//
// `grist.docApi.fetchTable` est patche par shared/grist-service-context.js et
// TimeSegment y a une politique REST_PROJECT_SERVICE : une lecture ordinaire est
// filtree par projet ET par service. Le faux docApi ci-dessous imite ce contrat a
// la lettre (verifie sur le vrai module partage dans
// shared/tests/service-context-runtime.test.cjs) : il ne rend la table entiere
// que sur { fullTable: true }.

test("bout en bout : la barre voit la charge d un AUTRE projet lue depuis Grist", async () => {
  const rows = [
    { id: 42, NumeroProjet: BOARD_PROJECT, Name: "Marie Dupont", Effectif: 6, Service: "Structure", Mois: monthTimestamp(2026, 10) },
    { id: 77, NumeroProjet: "24-0009", Name: "Marie Dupont", Effectif: 5, Service: "Fluides", Mois: monthTimestamp(2026, 10) },
  ];
  const columnar = (list) => ({
    id: list.map((row) => row.id),
    NumeroProjet: list.map((row) => row.NumeroProjet),
    Name: list.map((row) => row.Name),
    Effectif: list.map((row) => row.Effectif),
    Service: list.map((row) => row.Service),
    Mois: list.map((row) => row.Mois),
  });

  const previousWindow = globalThis.window;
  globalThis.window = {
    grist: {
      docApi: {
        __serviceContextPatched: true,
        async fetchTable(tableName, options) {
          if (tableName !== "TimeSegment") return { id: [] };
          if (options && options.fullTable === true) return columnar(rows);
          // Le filtre projet + service de la couche de contexte partagee.
          return columnar(rows.filter((row) => (
            row.NumeroProjet === BOARD_PROJECT && row.Service === "Structure"
          )));
        },
      },
    },
  };

  let data;
  try {
    const serviceUrl = new URL("../assets/js/services/gristService.js", import.meta.url);
    serviceUrl.searchParams.set("test", "month-load-bar-end-to-end");
    const service = await import(serviceUrl.href);
    data = await service.fetchProjectData({ name: "Projet A", number: BOARD_PROJECT });
  } finally {
    globalThis.window = previousWindow;
  }

  assert.deepEqual(
    data.timeSegmentRows.map((row) => row.id),
    [42],
    "le pane bas ne montre que le projet affiche (non-regression)"
  );

  const h = await mountChain({ allSegmentRows: data.allTimeSegmentRows });
  try {
    h.openFromBar();
    h.type("8");

    // 5 j sur le projet 24-0009 (service Fluides) + 8 j saisis = 13 j sur 20.
    // Sans la lecture complete, la barre annoncerait 8 j / 20 j.
    assert.equal(h.loadDays().textContent, `13 j / ${AVAILABLE_DAYS} j`);
    assert.equal(h.loadMessage().textContent, "il reste 7 j avant 100 %");
  } finally {
    h.controller.detach();
  }
});
