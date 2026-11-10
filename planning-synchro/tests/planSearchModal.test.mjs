// Tests de la fenetre « Rechercher un plan » (top/planSearchModal.js), ouverte
// par la loupe de la vue Graphique.
//
// Les plans sont les taches du graphique : ChartTask de buildChartTasks sans
// lissage, SmoothedTask de smoothTasks avec lissage. Les tests partent donc de
// lignes Planning_Projet brutes passees dans ces deux fonctions memes, pour que
// la recherche donne les dates que dessine le graphique.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  PLAN_STATUS,
  buildPlanSearchEntries,
  createPlanSearchModal,
  filterPlanEntries,
  planFilterOptions,
  renderPlanSearchResults,
} from "../assets/js/top/planSearchModal.js";
import { buildChartTasks } from "../assets/js/top/taskLoadModel.js";
import { smoothTasks } from "../assets/js/top/taskSmoothing.js";

const TODAY = "2026-11-09";
const PROJECT = "P1";

function row(fields) {
  return { NomProjet: PROJECT, ...fields };
}

// Dates en 2027 : toutes a venir, donc mobiles pour le lissage.
const ROWS = [
  row({ id: 1, ID2: "101", Taches: "NDC mur A", Type_doc: "NDC", Zone: "Zone A", Duree_1: 1, Diff_coffrage: "2027-03-02" }),
  row({ id: 2, ID2: "102", Taches: "NDC mur B", Type_doc: "NDC", Zone: "Zone B", Duree_1: 1, Diff_coffrage: "2027-03-09" }),
  row({ id: 3, ID2: "103", Taches: "Coupes dalle", Type_doc: "COUPES", Zone: "Zone A", Date_limite: "2027-03-01", Diff_coffrage: "2027-03-16" }),
  row({ id: 4, ID2: "104", Taches: "NDC voile", Type_doc: "NDC", Zone: "Zone B", Duree_1: 1, Diff_coffrage: "2027-03-23" }),
  // Indice A = cible par defaut d'un coffrage : plan realise.
  row({ id: 5, ID2: "105", Taches: "Coffrage réalisé", Type_doc: "COFFRAGE", Zone: "Zone A", Date_limite: "2027-04-01", Diff_coffrage: "2027-04-20", Indice: "A" }),
];

const TASKS = buildChartTasks(ROWS, { project: PROJECT });
// Maximum 2 par mois : mars 2027 en compte 4, les deux premiers avancent.
const RESULT = smoothTasks(TASKS, { maxTotal: 2, maxByType: {} }, TODAY);

const rawEntries = () => buildPlanSearchEntries({ tasks: TASKS, active: false });
const smoothedEntries = () => buildPlanSearchEntries({ tasks: RESULT.tasks, active: true });
const ids = (entries) => entries.map((entry) => entry.id2);

test("sans lissage : un plan par tache du graphique, a son echeance, sans date lissee", () => {
  const entries = rawEntries();

  assert.deepEqual(
    entries.map((entry) => [entry.rowId, entry.id2, entry.name, entry.zone, entry.type, entry.dueIso]),
    TASKS.map((task) => [task.rowId, task.id2, task.name, task.zone, task.type, task.dueIso])
  );
  entries.forEach((entry) => {
    assert.equal(entry.smoothedIso, null);
    assert.equal(entry.moved, false);
  });
  assert.equal(entries.find((entry) => entry.id2 === "101").dueIso, "2027-03-02");
});

test("avec lissage : chaque plan porte la date lissee du graphique", () => {
  const entries = smoothedEntries();

  assert.deepEqual(
    entries.map((entry) => [entry.rowId, entry.smoothedIso, entry.monthsAdvanced, entry.moved]),
    RESULT.tasks.map((task) => [task.rowId, task.smoothedIso, task.monthsAdvanced, task.moved])
  );
  const moved = entries.filter((entry) => entry.moved);
  assert.deepEqual(ids(moved), ["101", "102"]);
  moved.forEach((entry) => {
    assert.equal(entry.smoothedIso.slice(0, 7), "2027-02");
    assert.equal(entry.monthsAdvanced, 1);
  });
});

test("un plan realise est marque, avec son avancement en %", () => {
  const entries = rawEntries();
  const realised = entries.find((entry) => entry.id2 === "105");

  assert.equal(realised.realized, true);
  assert.equal(realised.progressLabel, "100 %");
  assert.equal(entries.find((entry) => entry.id2 === "101").progressLabel, "0 %");
});

test("filtre par N° : le texte saisi est cherche dans le N° du plan", () => {
  const entries = rawEntries();

  assert.deepEqual(ids(filterPlanEntries(entries, { number: "103" })), ["103"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { number: " 10 " })), ["101", "102", "103", "104", "105"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { number: "999" })), []);
});

test("filtre par nom : sans tenir compte des accents ni des majuscules", () => {
  const entries = rawEntries();

  assert.deepEqual(ids(filterPlanEntries(entries, { name: "MUR" })), ["101", "102"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { name: "realise" })), ["105"]);
});

test("N° et nom ensemble : les deux doivent correspondre", () => {
  const entries = rawEntries();

  assert.deepEqual(ids(filterPlanEntries(entries, { number: "10", name: "voile" })), ["104"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { number: "101", name: "voile" })), []);
});

test("filtres zone, type de document et etat", () => {
  const entries = smoothedEntries();

  assert.deepEqual(ids(filterPlanEntries(entries, { zone: "Zone A" })), ["101", "103", "105"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { type: "NDC" })), ["101", "102", "104"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { zone: "Zone B", type: "NDC" })), ["102", "104"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { status: PLAN_STATUS.DONE })), ["105"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { status: PLAN_STATUS.TODO })), ["101", "102", "103", "104"]);
  assert.deepEqual(ids(filterPlanEntries(entries, { status: PLAN_STATUS.ADVANCED })), ["101", "102"]);
  assert.deepEqual(ids(filterPlanEntries(entries, {})), ["101", "102", "103", "104", "105"]);
});

test("les listes des filtres ne proposent que les zones et types presents", () => {
  const options = planFilterOptions(rawEntries());

  assert.deepEqual(options.zones, ["Zone A", "Zone B"]);
  // Ordre et libelles du graphique (TYPE_ORDER / TYPE_META).
  assert.deepEqual(options.types, [
    { value: "COFFRAGE", label: "Coffrage" },
    { value: "NDC", label: "NDC" },
    { value: "COUPES", label: "Coupes" },
  ]);
});

test("resultats avec lissage : echeance sans lissage et echeance lissee cote a cote", () => {
  const html = renderPlanSearchResults({ entries: smoothedEntries(), active: true });

  assert.match(html, /Échéance sans lissage/);
  assert.match(html, /Échéance lissée/);
  assert.match(html, /02\/03\/2027/);
  assert.match(html, /1 mois plus tôt/);
  assert.match(html, /class="ps-plan-search-row is-realized"/);
});

test("resultats sans lissage : pas de colonne de date lissee", () => {
  const html = renderPlanSearchResults({ entries: rawEntries(), active: false });

  assert.doesNotMatch(html, /Échéance lissée/);
  assert.match(html, /NDC mur A/);
});

test("resultats : les textes des plans sont echappes", () => {
  const tasks = buildChartTasks(
    [row({ id: 1, ID2: "1<b>", Taches: "Mur <script>", Type_doc: "NDC", Zone: "A & B", Duree_1: 1, Diff_coffrage: "2027-03-02" })],
    { project: PROJECT }
  );
  const html = renderPlanSearchResults({ entries: buildPlanSearchEntries({ tasks, active: false }), active: false });

  assert.doesNotMatch(html, /<script>|1<b>/);
  assert.match(html, /Mur &lt;script&gt;/);
  assert.match(html, /A &amp; B/);
});

test("resultats vides : un message dit quoi changer", () => {
  assert.match(renderPlanSearchResults({ entries: [], active: false }), /Aucun plan ne correspond/);
});

test("balisage absent : fenetre inerte, sans exception", () => {
  const modal = createPlanSearchModal(undefined);

  assert.equal(modal.isOpen(), false);
  modal.open({ entries: [], active: false });
  modal.update({ entries: [], active: false });
  modal.close();
  modal.destroy();
  assert.equal(modal.isOpen(), false);
});

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("la loupe et la fenetre sont dans la page et confiees au controleur du lissage", () => {
  const html = read("../index.html");
  const main = read("../assets/js/main.js");

  const toolbar = html.match(/<div id="ps-chart-smoothing"[\s\S]*?\n {8}<\/div>/);
  assert.ok(toolbar, "barre du graphique introuvable");
  assert.match(toolbar[0], /id="ps-search-open"[^>]*aria-label="Rechercher un plan"/);
  ["ps-plan-search-modal", "ps-plan-search-number", "ps-plan-search-name", "ps-plan-search-zone",
    "ps-plan-search-type", "ps-plan-search-status", "ps-plan-search-results"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} manquant`);
  });
  assert.match(main, /planSearchButton: els\.planSearchOpen/);
  assert.match(main, /planSearchModalEl: els\.planSearchModal/);
});

// --- Fenetre « Choisir les plans » : meme module, autre prefixe, colonne date ------

// DOM minimal (aucun jsdom dans le depot) : juste ce que le controleur touche.
function installFakeDom(prefix) {
  const saved = {
    HTMLElement: globalThis.HTMLElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    document: globalThis.document,
  };

  class FakeElement {
    constructor(id = "") {
      this.id = id;
      this.value = "";
      this.textContent = "";
      this.innerHTML = "";
      this.style = {};
      this.dataset = {};
      this.attrs = {};
      this.parent = null;
      this.listeners = {};
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== fn);
    }
    contains(node) {
      for (let current = node; current; current = current.parent) if (current === this) return true;
      return false;
    }
    focus() { globalThis.document.activeElement = this; }
    blur() {}
    get isConnected() { return true; }
  }
  class FakeSelect extends FakeElement {}

  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLSelectElement = FakeSelect;
  const docListeners = {};
  globalThis.document = {
    activeElement: null,
    body: new FakeElement("body"),
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter((item) => item !== fn); },
  };

  const root = new FakeElement(`${prefix}-modal`);
  const byId = {};
  ["title", "subtitle", "close", "number", "name", "zone", "type", "status", "summary", "lissage", "reset", "results", "done"]
    .forEach((suffix) => {
      const Cls = ["zone", "type", "status"].includes(suffix) ? FakeSelect : FakeElement;
      const el = new Cls(`${prefix}-${suffix}`);
      el.parent = root;
      byId[suffix] = el;
    });
  root.querySelector = (selector) => byId[selector.replace(`#${prefix}-`, "")] || null;

  const dateInput = (rowId, value = "") => {
    const input = new FakeElement();
    input.tagName = "INPUT";
    input.dataset.manualRow = String(rowId);
    input.value = value;
    input.parent = byId.results;
    return input;
  };
  const clearButton = (rowId) => {
    const button = new FakeElement();
    button.tagName = "BUTTON";
    button.dataset.manualClear = String(rowId);
    button.closest = (selector) => (selector === "[data-manual-clear]" ? button : null);
    button.parent = byId.results;
    return button;
  };
  // Un evenement visant un element de la fenetre remonte jusqu'a la racine,
  // comme dans le navigateur (cible, resultats, racine).
  const fire = (target, type, extra = {}) => {
    const event = { type, target, preventDefault() { this.defaultPrevented = true; }, ...extra };
    [...new Set([target, byId.results, root])].forEach((node) => {
      (node.listeners[type] || []).forEach((fn) => fn(event));
    });
    return event;
  };
  const press = (key) => {
    const event = { type: "keydown", key, preventDefault() { this.defaultPrevented = true; } };
    (docListeners.keydown || []).forEach((fn) => fn(event));
    return event;
  };
  const restore = () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  };
  return { root, els: byId, dateInput, clearButton, fire, press, restore };
}

// Plans synthetiques (SmoothedTask) : le 103 est fixe a une date manuelle.
function manualTask(fields) {
  return {
    rowId: 1, id2: "101", name: "Plan", zone: "Zone A", type: "NDC", dueIso: "2027-03-02",
    smoothedIso: "2027-03-02", monthsAdvanced: 0, moved: false, manual: false, realized: false,
    ...fields,
  };
}

const MANUAL_TASKS = [
  manualTask({ rowId: 1, id2: "101", name: "Libre" }),
  manualTask({ rowId: 3, id2: "103", name: "Fixe", smoothedIso: "2027-05-10", monthsAdvanced: -2, manual: true }),
  manualTask({ rowId: 5, id2: "105", name: "Fait", realized: true }),
];
const manualEntries = () => buildPlanSearchEntries({ tasks: MANUAL_TASKS, active: true });
const MANUAL_MODEL = { dates: { 3: "2027-05-10" }, minIso: "2027-02-01", readOnly: false };
const openModel = (extra = {}) => ({ subtitle: "", service: "S", active: true, entries: manualEntries(), ...extra });

test("entrees : manual vient de la tache, et seulement quand le lissage est actif", () => {
  assert.deepEqual(manualEntries().map((entry) => entry.manual), [false, true, false]);
  const inactive = buildPlanSearchEntries({ tasks: MANUAL_TASKS, active: false });
  assert.deepEqual(inactive.map((entry) => entry.manual), [false, false, false]);
});

test("colonne date : une case date avec value, min et data-manual-row", () => {
  const html = renderPlanSearchResults({ entries: manualEntries(), active: true, manual: MANUAL_MODEL });

  assert.match(html, /<th[^>]*>Date manuelle<\/th>/);
  assert.match(html, /<input type="date" class="ps-plan-pick-date" data-manual-row="3" value="2027-05-10" min="2027-02-01"/);
  assert.match(html, /aria-label="Date manuelle, N° 103"/);
  // Une case sans date : value vide, et pas de bouton ✕.
  assert.match(html, /data-manual-row="1" value=""/);
  assert.equal((html.match(/data-manual-clear=/g) || []).length, 1);
  assert.match(html, /data-manual-clear="3"/);
});

test("colonne date : un plan realise ne bouge pas, sans case", () => {
  const html = renderPlanSearchResults({ entries: manualEntries(), active: true, manual: MANUAL_MODEL });

  assert.match(html, /<span class="ps-plan-search-note">réalisé, ne bouge pas<\/span>/);
  assert.doesNotMatch(html, /data-manual-row="5"/);
});

test("colonne date : en lecture seule, la date en JJ/MM/AAAA ou un tiret, sans case", () => {
  const html = renderPlanSearchResults({
    entries: manualEntries(), active: true, manual: { ...MANUAL_MODEL, readOnly: true },
  });

  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /data-manual-clear/);
  assert.match(html, /10\/05\/2027/);
  assert.match(html, />—</);
});

test("sans modele manual : aucune colonne date (rendu inchange)", () => {
  const html = renderPlanSearchResults({ entries: manualEntries(), active: true });
  assert.doesNotMatch(html, /Date manuelle/);
  assert.doesNotMatch(html, /<input/);
});

test("plan fixe : echeance lissee en gras, « date manuelle » et l'ecart en mois", () => {
  const html = renderPlanSearchResults({ entries: manualEntries(), active: true });

  assert.match(html, /ps-plan-search-date--manual/);
  assert.match(html, /<strong>10\/05\/2027<\/strong>/);
  assert.match(html, /date manuelle/);
  assert.match(html, /2 mois plus tard/);
});

test("plan fixe : « N mois plus tot » et « meme mois »", () => {
  const early = buildPlanSearchEntries({
    tasks: [manualTask({ manual: true, monthsAdvanced: 1, smoothedIso: "2027-02-10" })], active: true,
  });
  const same = buildPlanSearchEntries({
    tasks: [manualTask({ manual: true, monthsAdvanced: 0, smoothedIso: "2027-03-20" })], active: true,
  });

  assert.match(renderPlanSearchResults({ entries: early, active: true }), /1 mois plus tôt/);
  assert.match(renderPlanSearchResults({ entries: same, active: true }), /même mois/);
});

test("filtre « Dates manuelles » : seules les entrees manual", () => {
  assert.equal(PLAN_STATUS.MANUAL, "manuels");
  const kept = filterPlanEntries(manualEntries(), { status: PLAN_STATUS.MANUAL });
  assert.deepEqual(ids(kept), ["103"]);
});

test("option « Dates manuelles » : proposee seulement avec un plan fixe, lissage actif", () => {
  const dom = installFakeDom("ps-plan-search");
  try {
    const modal = createPlanSearchModal(dom.root);
    modal.open(openModel());
    assert.match(dom.els.status.innerHTML, /Dates manuelles/);

    modal.update(openModel({ entries: buildPlanSearchEntries({ tasks: [MANUAL_TASKS[0]], active: true }) }));
    assert.doesNotMatch(dom.els.status.innerHTML, /Dates manuelles/);

    modal.update(openModel({ active: false, entries: buildPlanSearchEntries({ tasks: MANUAL_TASKS, active: false }) }));
    assert.doesNotMatch(dom.els.status.innerHTML, /Dates manuelles/);
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("texte du lissage : ajoute le nombre de dates manuelles", () => {
  const dom = installFakeDom("ps-plan-search");
  try {
    const modal = createPlanSearchModal(dom.root);
    modal.open(openModel());
    assert.match(dom.els.lissage.textContent, /· 1 date manuelle/);

    const two = buildPlanSearchEntries({
      tasks: [manualTask({ rowId: 1, manual: true }), manualTask({ rowId: 2, id2: "102", manual: true })], active: true,
    });
    modal.update(openModel({ entries: two }));
    assert.match(dom.els.lissage.textContent, /· 2 dates manuelles/);

    modal.update(openModel({ entries: buildPlanSearchEntries({ tasks: [MANUAL_TASKS[0]], active: true }) }));
    assert.doesNotMatch(dom.els.lissage.textContent, /manuelle/);
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("prefixe : une racine ps-plan-pick-* est pilotee et « Terminé » la ferme", () => {
  const dom = installFakeDom("ps-plan-pick");
  try {
    const modal = createPlanSearchModal(dom.root, { idPrefix: "ps-plan-pick" });
    modal.open(openModel({ subtitle: "Projet P1", manual: MANUAL_MODEL }));

    assert.equal(modal.isOpen(), true);
    assert.equal(dom.els.subtitle.textContent, "Projet P1");
    assert.match(dom.els.results.innerHTML, /data-manual-row="3"/);

    dom.fire(dom.els.done, "click");
    assert.equal(modal.isOpen(), false);
    assert.equal(dom.root.style.display, "none");
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("saisie : un input sur la case date appelle onManualDateChange sans refaire le tableau", () => {
  const dom = installFakeDom("ps-plan-pick");
  try {
    const calls = [];
    const modal = createPlanSearchModal(dom.root, {
      idPrefix: "ps-plan-pick", onManualDateChange: (rowId, value) => calls.push([rowId, value]),
    });
    modal.open(openModel({ manual: MANUAL_MODEL }));
    dom.els.results.innerHTML = "<!--marqueur-->";

    dom.fire(dom.dateInput(3, "2027-02-14"), "input");

    assert.deepEqual(calls, [[3, "2027-02-14"]]);
    assert.equal(dom.els.results.innerHTML, "<!--marqueur-->", "le tableau n'est pas reconstruit pendant la frappe");
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("saisie : un clic sur ✕ appelle onManualDateChange avec une chaine vide", () => {
  const dom = installFakeDom("ps-plan-pick");
  try {
    const calls = [];
    const modal = createPlanSearchModal(dom.root, {
      idPrefix: "ps-plan-pick", onManualDateChange: (rowId, value) => calls.push([rowId, value]),
    });
    modal.open(openModel({ manual: MANUAL_MODEL }));

    dom.fire(dom.clearButton(3), "click");

    assert.deepEqual(calls, [[3, ""]]);
    assert.equal(modal.isOpen(), true);
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("Echap : ferme la fenetre ouverte et appelle preventDefault", () => {
  const dom = installFakeDom("ps-plan-pick");
  try {
    const modal = createPlanSearchModal(dom.root, { idPrefix: "ps-plan-pick" });
    assert.equal(dom.press("Escape").defaultPrevented, undefined, "fermee : rien a faire");

    modal.open(openModel({ manual: MANUAL_MODEL }));
    const event = dom.press("Escape");

    assert.equal(event.defaultPrevented, true);
    assert.equal(modal.isOpen(), false);
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("focus : update() pendant la frappe dans une case date attend le focusout", () => {
  const dom = installFakeDom("ps-plan-pick");
  try {
    const modal = createPlanSearchModal(dom.root, { idPrefix: "ps-plan-pick" });
    modal.open(openModel({ manual: MANUAL_MODEL }));
    dom.els.results.innerHTML = "<!--saisie en cours-->";
    document.activeElement = dom.dateInput(3);

    modal.update(openModel({ manual: { ...MANUAL_MODEL, dates: { 3: "2027-06-01" } } }));
    assert.equal(dom.els.results.innerHTML, "<!--saisie en cours-->", "pas de rendu tant que la case a le focus");

    // Le focus quitte la case vers l'exterieur : le rendu differe est applique.
    document.activeElement = dom.els.number;
    dom.fire(dom.els.results, "focusout", { relatedTarget: null });
    assert.match(dom.els.results.innerHTML, /value="2027-06-01"/);
    modal.destroy();
  } finally {
    dom.restore();
  }
});

test("colonne date : sans N° (id2 vide), les aria-label retombent sur le nom du plan", () => {
  const entries = [{ ...manualEntries()[1], id2: "", name: "FONDATIONS" }];
  const html = renderPlanSearchResults({ entries, active: true, manual: MANUAL_MODEL });
  assert.match(html, /aria-label="Date manuelle, FONDATIONS"/);
  assert.match(html, /aria-label="Effacer la date manuelle, FONDATIONS"/);
  assert.doesNotMatch(html, /N° (?:"|,)/);
});
